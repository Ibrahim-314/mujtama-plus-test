/* Community channels, content, rules & welcome (v2.58.0, «المجتمع 3.0» stage 3).
 *   • channels: categories (groups), order, icon, archive/restore (read-only, nothing widens), slow mode, approval per
 *     channel, allowed content types, role channels (who sees / who posts: base roles, «الفريق», or custom roles),
 *     the default channel for newcomers, and a light per-member unread count (channel_reads).
 *   • pins (5 per community, 3 per channel, optional expiry) and announcements (the bar on the community page: info |
 *     important, schedule, dismissible, an optional notification at most once a day).
 *   • structured rules (title, body, severity, order) with communities.rules kept as the mirror (titles), both ways.
 *   • welcome steps done on the server (community_onboarding), auto-checked steps, a one-time import from localStorage.
 *   • the knowledge base meta: page sections and the recent edits list.
 * Every permission goes through lib/cperm.js; every change lands in the unified community log (cmod.log). */
const { E, str, oneOf, id, now, HttpError } = require("../lib/core");
const CS = require("../lib/community-settings");
const STAFF = ["owner", "admin", "moderator"], ACTIVE = (r) => !!r && !["pending", "banned"].includes(r);
const DAY = 864e5, MAX_CHANNELS = 50, MAX_GROUPS = 12, PIN_COMMUNITY = 5, PIN_CHANNEL = 3;
const ICONS = ["hash", "mega", "help", "camera", "book", "bulb", "star", "trophy", "calendar", "comment", "heart", "flag", "globe", "sparkle", "cap", "brief", "store", "party", "mic", "pin", "users", "lock"];
const TYPES = ["image", "video", "audio", "poll", "question", "article", "event"]; // text is always allowed
const TYPE_AR = { image: "الصور", video: "الفيديو", audio: "الصوت", poll: "الاستطلاعات", question: "الأسئلة", article: "المقالات", event: "الفعاليات" };
const SLOW = [0, 5, 10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
const SEVERITY = ["info", "warn", "serious"];
const arr = (v) => Array.isArray(v) ? v : [];

module.exports = (ctx) => {
  const { db, router: R } = ctx; const A = ctx.requireUser; const P = ctx.cperm;
  const log = (cid, actor, o) => ctx.services.cmod.log(cid, actor, o);
  const getC = async (cid) => { const c = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf(); return c; };
  const getCh = async (cid, ch) => { const r = await db.get("SELECT * FROM community_channels WHERE id=$1 AND community=$2", [ch, cid]); if (!r) throw E.nf("القناة غير موجودة"); return r; };
  const n = async (sql, a) => Number((await db.get(sql, a)).n);
  const ph = (list, from = 1) => list.map((_, i) => "$" + (i + from)).join(",");

  /* ---------- who is the viewer in this community: role, tokens for role channels, staff ---------- */
  async function viewerOf(cid, uid) {
    if (!uid) return { uid: null, role: null, active: false, staff: false, tokens: new Set() };
    const m = await db.get("SELECT role, joined_at FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]);
    const role = m?.role || null, tokens = new Set(role ? [role] : []);
    if (STAFF.includes(role)) tokens.add("staff");
    if (ACTIVE(role) && await P.hasCustom(cid)) for (const r of await db.all("SELECT role_id FROM member_roles WHERE community=$1 AND user_id=$2", [cid, uid])) tokens.add(r.role_id);
    return { uid, role, joinedAt: m?.joined_at || null, active: ACTIVE(role), staff: STAFF.includes(role), tokens };
  }
  const gated = (list) => arr(list).length > 0;
  /** may this viewer see the channel at all (its posts follow the same rule in content.filterVisible) */
  const canView = (ch, v) => (ch.view_perm === "public" || v.active) && (!gated(ch.view_roles) || v.staff || arr(ch.view_roles).some(t => v.tokens.has(t)));
  /** may this viewer post in it (archive, mods-only, role channels) — the server re-checks in beforePost */
  const canPost = (ch, v, announce) => v.active && v.role !== "muted" && !ch.archived_at && (ch.post_perm !== "mods" || announce) && (!gated(ch.post_roles) || announce || arr(ch.post_roles).some(t => v.tokens.has(t))) && canView(ch, v);

  /** role-channel gate for many posts at once (content.filterVisible): ids of gated channels this viewer may see */
  async function roleGate(chs, viewer) {
    const ok = new Set(); if (!viewer || !chs.length) return ok;
    const cids = [...new Set(chs.map(c => c.community))];
    const ms = await db.all(`SELECT community, role FROM memberships WHERE user_id=$1 AND community IN (${ph(cids, 2)})`, [viewer, ...cids]);
    const mr = await db.all(`SELECT community, role_id FROM member_roles WHERE user_id=$1 AND community IN (${ph(cids, 2)})`, [viewer, ...cids]).catch(() => []);
    for (const ch of chs) {
      const m = ms.find(x => x.community === ch.community); if (!m || !ACTIVE(m.role)) continue;
      const t = new Set([m.role, ...(STAFF.includes(m.role) ? ["staff"] : []), ...mr.filter(x => x.community === ch.community).map(x => x.role_id)]);
      if (STAFF.includes(m.role) || arr(ch.view_roles).some(x => t.has(x))) ok.add(ch.id);
    }
    return ok;
  }

  const chClient = (ch, extra = {}) => ({ id: ch.id, name: ch.name, slug: ch.slug, desc: ch.descr, kind: ch.kind, position: ch.position, postPerm: ch.post_perm, viewPerm: ch.view_perm,
    group: ch.group_id || null, icon: ch.icon || null, archivedAt: ch.archived_at || null, slowModeSec: Number(ch.slow_mode_sec || 0), requireApproval: !!ch.require_approval, allowedTypes: arr(ch.allowed_types),
    viewRoles: arr(ch.view_roles), postRoles: arr(ch.post_roles), topicRequired: !!ch.topic_required, isDefault: !!ch.is_default, ...extra });
  const groupClient = (g) => ({ id: g.id, name: g.name, position: g.position, collapsed: !!g.collapsed_default });

  /** the channels a viewer may see, with unread counts and the slow-mode wait for members (one query each) */
  async function list(cid, uid, v) {
    v = v || await viewerOf(cid, uid);
    const rows = (await db.all("SELECT * FROM community_channels WHERE community=$1 ORDER BY position, created_at", [cid])).filter(ch => canView(ch, v));
    const announce = v.active ? await P.has(cid, uid, "announce") : false;
    const unread = {}, wait = {}, seen = {};
    if (v.active && rows.length) {
      for (const r of await db.all("SELECT channel, last_seen_at FROM channel_reads WHERE user_id=$1 AND community=$2", [uid, cid])) seen[r.channel] = new Date(r.last_seen_at).toISOString(); // «جديد منذ زيارتك»: the member's own previous read only
      const since = new Date(Math.max(Date.now() - 14 * DAY, v.joinedAt ? +new Date(v.joinedAt) : 0)).toISOString();
      for (const r of await db.all(`SELECT p.channel, COUNT(*) n FROM posts p LEFT JOIN channel_reads r ON r.channel=p.channel AND r.user_id=$2
        WHERE p.community=$1 AND p.status='published' AND p.channel IS NOT NULL AND p.author<>$2 AND p.created_at > COALESCE(r.last_seen_at, $3) GROUP BY p.channel`, [cid, uid, since])) unread[r.channel] = Math.min(99, Number(r.n));
      const slow = rows.filter(ch => ch.slow_mode_sec > 0 && !ch.archived_at);
      if (slow.length && !(await P.has(cid, uid, "queue_review"))) {
        for (const r of await db.all(`SELECT channel, MAX(created_at) t FROM posts WHERE community=$1 AND author=$2 AND channel IN (${ph(slow.map(x => x.id), 3)}) GROUP BY channel`, [cid, uid, ...slow.map(x => x.id)])) {
          const ch = slow.find(x => x.id === r.channel), left = Math.ceil((+new Date(r.t) + ch.slow_mode_sec * 1000 - Date.now()) / 1000); if (left > 0) wait[r.channel] = left;
        }
      }
    }
    const groups = (await db.all("SELECT * FROM community_channel_groups WHERE community=$1 ORDER BY position, created_at", [cid])).map(groupClient);
    return { channels: rows.map(ch => chClient(ch, { unread: unread[ch.id] || 0, lastSeenAt: seen[ch.id] || null, waitSec: wait[ch.id] || 0, canPost: canPost(ch, v, announce) })), groups };
  }

  /* ---------- the content-engine hook: archive, role channels, slow mode, allowed types, approval, topic ---------- */
  function kindsOf(b) {
    const k = new Set();
    if (b.media || (Array.isArray(b.images) && b.images.length)) k.add("image");
    if (["video", "audio", "question", "article", "event", "poll"].includes(b.type)) k.add(b.type);
    if (b.poll && Array.isArray(b.poll.options)) k.add("poll");
    return [...k];
  }
  async function checkPost(community, user, b) {
    const out = {}; const s = community.settings || {};
    const kinds = kindsOf(b), commTypes = arr(s.contentTypes);
    if (!b.channel) {
      const bad = commTypes.length ? kinds.find(k => !commTypes.includes(k)) : null;
      if (bad) throw E.bad(`${TYPE_AR[bad]} غير مسموحة في هذا المجتمع`);
      return out;
    }
    const ch = await db.get("SELECT * FROM community_channels WHERE id=$1 AND community=$2", [b.channel, community.id]); if (!ch) throw E.bad("القناة غير موجودة");
    if (ch.archived_at) throw E.forbid(`القناة «${ch.name}» مؤرشفة: للقراءة فقط`);
    const v = await viewerOf(community.id, user.id), announce = await P.has(community.id, user.id, "announce"), staff = await P.has(community.id, user.id, "queue_review");
    if (!canView(ch, v)) throw E.forbid("هذه القناة لأدوار محددة");
    if (ch.post_perm === "mods" && !announce) throw E.forbid(`النشر في «${ch.name}» للمشرفين فقط`);
    if (gated(ch.post_roles) && !announce && !arr(ch.post_roles).some(t => v.tokens.has(t))) throw E.forbid(`النشر في «${ch.name}» لأدوار محددة`);
    const allowed = arr(ch.allowed_types).length ? arr(ch.allowed_types) : commTypes;
    const bad = allowed.length ? kinds.find(k => !allowed.includes(k)) : null;
    if (bad) throw E.bad(`${TYPE_AR[bad]} غير مسموحة في «${ch.name}»`);
    if (ch.topic_required && !b.ctag && arr(s.tags).length) throw E.bad(`اختر وسماً للنشر في «${ch.name}»`);
    if (ch.slow_mode_sec > 0 && !staff) {
      const last = await db.get("SELECT MAX(created_at) t FROM posts WHERE community=$1 AND channel=$2 AND author=$3", [community.id, ch.id, user.id]);
      const left = last?.t ? Math.ceil((+new Date(last.t) + ch.slow_mode_sec * 1000 - Date.now()) / 1000) : 0;
      if (left > 0) { const e = new HttpError(429, `الوضع البطيء مفعّل في «${ch.name}»: يمكنك النشر بعد ${left} ثانية`, "slow_mode"); e.retryAfter = left; throw e; }
    }
    out.channel = ch.id; if (ch.require_approval && !staff) out.pending = true;
    return out;
  }

  /* ---------- channels: create / edit / order / archive / read ---------- */
  const parseList = (v, ok) => [...new Set(arr(v).map(String).filter(ok))].slice(0, 20);
  async function roleIds(cid) { return new Set((await db.all("SELECT id FROM community_roles WHERE community=$1 AND is_system=0", [cid])).map(r => r.id)); }
  async function chFields(cid, b, cur = {}) {
    const f = {};
    if (b.icon !== undefined) f.icon = ICONS.includes(b.icon) ? b.icon : null;
    if (b.slowModeSec !== undefined) { const s = Math.max(0, Math.min(21600, Math.round(+b.slowModeSec || 0))); f.slow_mode_sec = SLOW.reduce((a, x) => Math.abs(x - s) < Math.abs(a - s) ? x : a, 0); }
    if (b.requireApproval !== undefined) f.require_approval = b.requireApproval ? 1 : 0;
    if (b.topicRequired !== undefined) f.topic_required = b.topicRequired ? 1 : 0;
    if (b.allowedTypes !== undefined) f.allowed_types = parseList(b.allowedTypes, t => t === "text" || TYPES.includes(t)); // ["text"] = text only
    if (b.viewRoles !== undefined || b.postRoles !== undefined) {
      const ids = await roleIds(cid), ok = (t) => ["staff", "member"].includes(t) || ids.has(t);
      if (b.viewRoles !== undefined) f.view_roles = parseList(b.viewRoles, ok);
      if (b.postRoles !== undefined) f.post_roles = parseList(b.postRoles, ok);
    }
    if (b.group !== undefined) { const g = b.group ? await db.get("SELECT id FROM community_channel_groups WHERE id=$1 AND community=$2", [String(b.group), cid]) : null; f.group_id = g ? g.id : null; }
    if (b.kind !== undefined) f.kind = oneOf(b.kind, ["text", "announcements", "questions", "media"], cur.kind || "text");
    return f;
  }
  async function setFields(chId, f) { const k = Object.keys(f); if (!k.length) return; await db.run(`UPDATE community_channels SET ${k.map((x, i) => `${x}=$${i + 1}`).join(", ")} WHERE id=$${k.length + 1}`, [...k.map(x => f[x]), chId]); }
  async function setDefault(cid, chId, on) { if (on) await db.run("UPDATE community_channels SET is_default=0 WHERE community=$1 AND id<>$2", [cid, chId]); await db.run("UPDATE community_channels SET is_default=$1 WHERE id=$2", [on ? 1 : 0, chId]); }
  const slugify = CS.slugify;

  R.post("/api/communities/:id/channels", A(async (req) => {
    const c = await getC(req.params.id); await P.need(c.id, req.user.id, "manage_channels"); const b = req.body || {};
    if (c.archived_at) throw E.forbid("المجتمع مؤرشف");
    if (await n("SELECT COUNT(*) n FROM community_channels WHERE community=$1", [c.id]) >= MAX_CHANNELS) throw E.bad(`الحد الأقصى ${MAX_CHANNELS} قناة`);
    const name = str(b.name, 40, { required: true }), slug = slugify(b.slug || name); if (!slug) throw E.bad("اسم غير صالح");
    if (await db.get("SELECT 1 x FROM community_channels WHERE community=$1 AND slug=$2", [c.id, slug])) throw E.conflict("توجد قناة بهذا الاسم");
    const kind = oneOf(b.kind, ["text", "announcements", "questions", "media"], "text");
    const ch = { id: id("ch"), name, slug, descr: str(b.desc, 200) || "", kind, post_perm: oneOf(b.postPerm, ["members", "mods"], kind === "announcements" ? "mods" : "members"), view_perm: oneOf(b.viewPerm, ["public", "members"], c.type === "public" ? "public" : "members") };
    const pos = (await db.get("SELECT COALESCE(MAX(position),0)+1 n FROM community_channels WHERE community=$1", [c.id])).n;
    await db.run("INSERT INTO community_channels(id,community,name,slug,descr,kind,position,post_perm,view_perm,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [ch.id, c.id, ch.name, ch.slug, ch.descr, ch.kind, pos, ch.post_perm, ch.view_perm, now()]);
    const f = await chFields(c.id, { icon: b.icon ?? (kind === "announcements" ? "mega" : kind === "questions" ? "help" : kind === "media" ? "camera" : undefined), ...b, kind: undefined }); await setFields(ch.id, f);
    if (b.isDefault) await setDefault(c.id, ch.id, true);
    await log(c.id, req.user.id, { action: "channel_created", category: "channels", reason: ch.name });
    return { channel: chClient(await db.get("SELECT * FROM community_channels WHERE id=$1", [ch.id])) };
  }));
  R.patch("/api/communities/:id/channels/:ch", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "manage_channels"); const ch = await getCh(cid, req.params.ch), b = req.body || {};
    const name = b.name !== undefined ? str(b.name, 40, { required: true }) : ch.name;
    if (name !== ch.name) { const slug = slugify(name); if (slug !== ch.slug && await db.get("SELECT 1 x FROM community_channels WHERE community=$1 AND slug=$2 AND id<>$3", [cid, slug, ch.id])) throw E.conflict("توجد قناة بهذا الاسم"); }
    await db.run("UPDATE community_channels SET name=$1, descr=$2, post_perm=$3, view_perm=$4, position=$5 WHERE id=$6", [name, b.desc !== undefined ? str(b.desc, 200) || "" : ch.descr, oneOf(b.postPerm, ["members", "mods"], ch.post_perm), oneOf(b.viewPerm, ["public", "members"], ch.view_perm), Number.isInteger(b.position) ? b.position : ch.position, ch.id]);
    await setFields(ch.id, await chFields(cid, b, ch));
    if (b.isDefault !== undefined) await setDefault(cid, ch.id, !!b.isDefault);
    const after = await db.get("SELECT * FROM community_channels WHERE id=$1", [ch.id]);
    const d = {}; for (const [k, a, z] of [["name", ch.name, after.name], ["viewPerm", ch.view_perm, after.view_perm], ["postPerm", ch.post_perm, after.post_perm], ["slowModeSec", ch.slow_mode_sec, after.slow_mode_sec], ["requireApproval", !!ch.require_approval, !!after.require_approval], ["allowedTypes", arr(ch.allowed_types), arr(after.allowed_types)], ["viewRoles", arr(ch.view_roles), arr(after.view_roles)], ["postRoles", arr(ch.post_roles), arr(after.post_roles)]]) if (JSON.stringify(a) !== JSON.stringify(z)) d[k] = { from: a, to: z };
    if (Object.keys(d).length) await log(cid, req.user.id, { action: "channel_updated", category: "channels", reason: after.name, diff: d });
    return { channel: chClient(after) };
  }));
  R.post("/api/communities/:id/channels/:ch/archive", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "manage_channels"); const ch = await getCh(cid, req.params.ch);
    if (!ch.archived_at) { await db.run("UPDATE community_channels SET archived_at=$1, is_default=0 WHERE id=$2", [now(), ch.id]); await log(cid, req.user.id, { action: "channel_archived", category: "channels", reason: ch.name }); }
    ctx.cache?.del?.("feed:");
    return { channel: chClient(await db.get("SELECT * FROM community_channels WHERE id=$1", [ch.id])) };
  }));
  R.post("/api/communities/:id/channels/:ch/restore", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "manage_channels"); const ch = await getCh(cid, req.params.ch);
    if (ch.archived_at) { await db.run("UPDATE community_channels SET archived_at=NULL WHERE id=$1", [ch.id]); await log(cid, req.user.id, { action: "channel_restored", category: "channels", reason: ch.name }); }
    return { channel: chClient(await db.get("SELECT * FROM community_channels WHERE id=$1", [ch.id])) };
  }));
  /* the order of groups and of channels inside each group in one call (drag & drop or ↑ ↓) */
  R.put("/api/communities/:id/channels/order", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "manage_channels"); const b = req.body || {};
    const groups = new Set((await db.all("SELECT id FROM community_channel_groups WHERE community=$1", [cid])).map(g => g.id));
    const chans = new Set((await db.all("SELECT id FROM community_channels WHERE community=$1", [cid])).map(c => c.id));
    await db.tx(async t => {
      let gi = 0; for (const g of arr(b.groups)) if (groups.has(g)) await t.run("UPDATE community_channel_groups SET position=$1 WHERE id=$2", [++gi, g]);
      let ci = 0; for (const x of arr(b.channels)) { const cidx = typeof x === "string" ? x : x?.id; if (!chans.has(cidx)) continue; const g = typeof x === "object" && x.group && groups.has(x.group) ? x.group : null; await t.run("UPDATE community_channels SET position=$1, group_id=$2 WHERE id=$3", [++ci, g, cidx]); }
    });
    await log(cid, req.user.id, { action: "channels_reordered", category: "channels" });
    return list(cid, req.user.id);
  }));
  R.get("/api/communities/:id/channels", async (req) => { const c = await getC(req.params.id); if (!(await ctx.services.communities.visibleTo(c, req.user?.id)) && c.type === "invite") throw E.nf(); return list(c.id, req.user?.id); });
  R.post("/api/communities/:id/channels/:ch/read", A(async (req) => {
    const cid = req.params.id, v = await viewerOf(cid, req.user.id); if (!v.active) return { ok: false };
    const ch = await getCh(cid, req.params.ch); if (!canView(ch, v)) throw E.forbid();
    await db.run("INSERT INTO channel_reads(community,channel,user_id,last_seen_at) VALUES($1,$2,$3,$4) ON CONFLICT (channel,user_id) DO UPDATE SET last_seen_at=$4", [cid, ch.id, req.user.id, now()]);
    return { ok: true };
  }));

  /* ---------- channel groups (categories) ---------- */
  R.post("/api/communities/:id/channel-groups", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "manage_channels");
    if (await n("SELECT COUNT(*) n FROM community_channel_groups WHERE community=$1", [cid]) >= MAX_GROUPS) throw E.bad(`الحد الأقصى ${MAX_GROUPS} تصنيفاً`);
    const g = { id: id("cg"), name: str(req.body?.name, 30, { required: true }) };
    const pos = (await db.get("SELECT COALESCE(MAX(position),0)+1 n FROM community_channel_groups WHERE community=$1", [cid])).n;
    await db.run("INSERT INTO community_channel_groups(id,community,name,position,collapsed_default,created_at) VALUES($1,$2,$3,$4,$5,$6)", [g.id, cid, g.name, pos, req.body?.collapsed ? 1 : 0, now()]);
    await log(cid, req.user.id, { action: "channel_group_created", category: "channels", reason: g.name });
    return { group: groupClient(await db.get("SELECT * FROM community_channel_groups WHERE id=$1", [g.id])) };
  }));
  R.patch("/api/communities/:id/channel-groups/:gid", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "manage_channels");
    const g = await db.get("SELECT * FROM community_channel_groups WHERE id=$1 AND community=$2", [req.params.gid, cid]); if (!g) throw E.nf();
    await db.run("UPDATE community_channel_groups SET name=$1, collapsed_default=$2 WHERE id=$3", [req.body?.name !== undefined ? str(req.body.name, 30, { required: true }) : g.name, req.body?.collapsed !== undefined ? (req.body.collapsed ? 1 : 0) : g.collapsed_default, g.id]);
    return { group: groupClient(await db.get("SELECT * FROM community_channel_groups WHERE id=$1", [g.id])) };
  }));
  R.del("/api/communities/:id/channel-groups/:gid", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "manage_channels");
    const g = await db.get("SELECT * FROM community_channel_groups WHERE id=$1 AND community=$2", [req.params.gid, cid]); if (!g) throw E.nf();
    await db.run("UPDATE community_channels SET group_id=NULL WHERE community=$1 AND group_id=$2", [cid, g.id]); // the channels stay, ungrouped
    await db.run("DELETE FROM community_channel_groups WHERE id=$1", [g.id]);
    await log(cid, req.user.id, { action: "channel_group_deleted", category: "channels", reason: g.name });
    return { ok: true };
  }));

  /* ---------- pins ---------- */
  async function pinsFor(cid, uid, { all = false } = {}) {
    await db.run("DELETE FROM community_pins WHERE community=$1 AND until IS NOT NULL AND until < $2", [cid, now()]);
    const rows = await db.all("SELECT * FROM community_pins WHERE community=$1 ORDER BY CASE WHEN channel IS NULL THEN 0 ELSE 1 END, position, created_at LIMIT 200", [cid]);
    if (!rows.length) return [];
    const posts = await db.all(`SELECT * FROM posts WHERE id IN (${ph(rows.map(r => r.post))}) AND status='published'`, rows.map(r => r.post));
    const vis = new Set((await ctx.services.content.filterVisible(posts, uid)).map(p => p.id));
    const users = posts.length ? await db.all(`SELECT id, name, handle, avatar, color FROM users WHERE id IN (${ph([...new Set(posts.map(p => p.author))])})`, [...new Set(posts.map(p => p.author))]) : [];
    return rows.filter(r => all || vis.has(r.post)).map(r => { const p = posts.find(x => x.id === r.post); const u = p && users.find(x => x.id === p.author);
      return { id: r.id, channel: r.channel || null, position: r.position, until: r.until || null, pinnedAt: r.created_at, post: p ? { id: p.id, title: p.title || null, text: String(p.text || "").slice(0, 220), type: p.type, channel: p.channel || null, createdAt: p.created_at, author: u ? { id: u.id, name: u.name, handle: u.handle, avatar: u.avatar, color: u.color } : null } : null, visible: vis.has(r.post) }; }).filter(x => x.post);
  }
  R.get("/api/communities/:id/pins", async (req) => { const c = await getC(req.params.id); if (!(await ctx.services.communities.visibleTo(c, req.user?.id)) && c.type !== "public") throw E.forbid(); return { pins: await pinsFor(c.id, req.user?.id) }; });
  R.post("/api/communities/:id/pins", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "pin", "التثبيت للمشرفين"); const b = req.body || {};
    const p = await db.get("SELECT id, community, channel, status FROM posts WHERE id=$1", [String(b.post || "")]);
    if (!p || p.community !== cid || p.status !== "published") throw E.bad("المنشور غير موجود في هذا المجتمع");
    const channel = b.scope === "channel" ? (p.channel || null) : null;
    if (b.scope === "channel" && !channel) throw E.bad("المنشور ليس في قناة");
    await db.run("DELETE FROM community_pins WHERE community=$1 AND until IS NOT NULL AND until < $2", [cid, now()]);
    if (await db.get("SELECT 1 x FROM community_pins WHERE community=$1 AND post=$2", [cid, p.id])) throw E.conflict("المنشور مثبّت بالفعل");
    const cnt = await n(`SELECT COUNT(*) n FROM community_pins WHERE community=$1 AND ${channel ? "channel=$2" : "channel IS NULL"}`, channel ? [cid, channel] : [cid]);
    const cap = channel ? PIN_CHANNEL : PIN_COMMUNITY; if (cnt >= cap) throw E.bad(channel ? `الحد ${cap} مثبّتات لكل قناة` : `الحد ${cap} مثبّتات للمجتمع`);
    const days = Math.max(0, Math.min(365, Math.round(+b.days || 0)));
    const pin = { id: id("pn"), until: days ? new Date(Date.now() + days * DAY).toISOString() : null };
    await db.run("INSERT INTO community_pins(id,community,channel,post,position,pinned_by,until,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [pin.id, cid, channel, p.id, cnt + 1, req.user.id, pin.until, now()]);
    await log(cid, req.user.id, { post: p.id, action: "pinned", category: "moderation", meta: { channel, days } });
    return { pin: (await pinsFor(cid, req.user.id, { all: true })).find(x => x.id === pin.id) || { id: pin.id } };
  }));
  R.del("/api/communities/:id/pins/:pin", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "pin");
    const r = await db.get("SELECT * FROM community_pins WHERE id=$1 AND community=$2", [req.params.pin, cid]); if (!r) throw E.nf();
    await db.run("DELETE FROM community_pins WHERE id=$1", [r.id]); await log(cid, req.user.id, { post: r.post, action: "unpinned", category: "moderation" });
    return { ok: true };
  }));
  R.put("/api/communities/:id/pins/order", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "pin"); let i = 0;
    for (const pid of arr(req.body?.ids)) await db.run("UPDATE community_pins SET position=$1 WHERE id=$2 AND community=$3", [++i, String(pid), cid]);
    return { pins: await pinsFor(cid, req.user.id, { all: true }) };
  }));

  /* ---------- announcements ---------- */
  const annClient = (a, dismissed) => ({ id: a.id, title: a.title, body: a.body || "", level: a.level, startsAt: a.starts_at, endsAt: a.ends_at || null, dismissible: !!a.dismissible, notified: !!a.notified, createdAt: a.created_at, ...(dismissed !== undefined ? { dismissed } : {}),
    status: new Date(a.starts_at) > new Date() ? "scheduled" : a.ends_at && new Date(a.ends_at) <= new Date() ? "ended" : "live" });
  /** the bar on the community page: live, not dismissed by this viewer; important first, then the newest */
  async function activeAnnouncement(c, uid, v) {
    if (c.type !== "public" && !v.active) return null;
    const t = now(), rows = await db.all("SELECT * FROM community_announcements WHERE community=$1 AND starts_at <= $2 AND (ends_at IS NULL OR ends_at > $2) ORDER BY CASE level WHEN 'important' THEN 0 ELSE 1 END, starts_at DESC LIMIT 10", [c.id, t]);
    if (!rows.length) return null;
    const dis = uid ? new Set((await db.all(`SELECT announcement FROM announcement_dismissals WHERE user_id=$1 AND announcement IN (${ph(rows.map(r => r.id), 2)})`, [uid, ...rows.map(r => r.id)])).map(r => r.announcement)) : new Set();
    const a = rows.find(r => !dis.has(r.id)); return a ? annClient(a) : null;
  }
  function parseAnn(b, cur = {}) {
    const startsAt = b.startsAt ? new Date(b.startsAt) : cur.starts_at ? new Date(cur.starts_at) : new Date();
    const endsAt = b.endsAt === null ? null : b.endsAt ? new Date(b.endsAt) : cur.ends_at ? new Date(cur.ends_at) : null;
    if (isNaN(+startsAt) || (endsAt && isNaN(+endsAt))) throw E.bad("موعد غير صالح");
    if (endsAt && endsAt <= startsAt) throw E.bad("موعد الانتهاء قبل البداية");
    return { title: b.title !== undefined ? str(b.title, 120, { required: true }) : cur.title, body: b.body !== undefined ? (str(b.body, 600) || "") : (cur.body || ""), level: oneOf(b.level, ["info", "important"], cur.level || "info"),
      starts_at: startsAt.toISOString(), ends_at: endsAt ? endsAt.toISOString() : null, dismissible: b.dismissible !== undefined ? (b.dismissible ? 1 : 0) : (cur.dismissible ?? 1) };
  }
  R.get("/api/communities/:id/announcements", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "announce");
    return { announcements: (await db.all("SELECT * FROM community_announcements WHERE community=$1 ORDER BY starts_at DESC LIMIT 50", [cid])).map(a => annClient(a)) };
  }));
  R.post("/api/communities/:id/announcements", A(async (req) => {
    const cid = req.params.id, c = await getC(cid); await P.need(cid, req.user.id, "announce", "الإعلانات للمشرفين"); const b = req.body || {};
    if (await n("SELECT COUNT(*) n FROM community_announcements WHERE community=$1 AND (ends_at IS NULL OR ends_at > $2)", [cid, now()]) >= 20) throw E.bad("الحد 20 إعلاناً قائماً");
    const a = { id: id("an"), ...parseAnn(b) };
    await db.run("INSERT INTO community_announcements(id,community,title,body,level,starts_at,ends_at,dismissible,notified,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10)", [a.id, cid, a.title, a.body, a.level, a.starts_at, a.ends_at, a.dismissible, req.user.id, now()]);
    await log(cid, req.user.id, { action: "announcement_created", category: "moderation", reason: a.title, meta: { level: a.level } });
    let notified = 0, notifySkipped = false;
    /* an important announcement may notify the members — at most one notified announcement per community per day */
    if (b.notify && a.level === "important" && new Date(a.starts_at) <= new Date()) {
      const recent = await db.get("SELECT 1 x FROM community_announcements WHERE community=$1 AND notified=1 AND created_at > $2", [cid, new Date(Date.now() - DAY).toISOString()]);
      if (recent) notifySkipped = true; else {
      await db.run("UPDATE community_announcements SET notified=1 WHERE id=$1", [a.id]);
      for (const m of await db.all("SELECT user_id FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned') AND user_id<>$2 LIMIT 5000", [cid, req.user.id])) { try { await ctx.services.notify?.notify(m.user_id, "community_announcement", { actor: req.user.id, ref: c.id }); notified++; } catch { /* best effort */ } }
    } }
    return { announcement: annClient(await db.get("SELECT * FROM community_announcements WHERE id=$1", [a.id])), notified, notifySkipped };
  }));
  R.patch("/api/communities/:id/announcements/:aid", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "announce");
    const cur = await db.get("SELECT * FROM community_announcements WHERE id=$1 AND community=$2", [req.params.aid, cid]); if (!cur) throw E.nf();
    const a = parseAnn(req.body || {}, cur);
    await db.run("UPDATE community_announcements SET title=$1, body=$2, level=$3, starts_at=$4, ends_at=$5, dismissible=$6 WHERE id=$7", [a.title, a.body, a.level, a.starts_at, a.ends_at, a.dismissible, cur.id]);
    await log(cid, req.user.id, { action: "announcement_updated", category: "moderation", reason: a.title });
    return { announcement: annClient(await db.get("SELECT * FROM community_announcements WHERE id=$1", [cur.id])) };
  }));
  R.del("/api/communities/:id/announcements/:aid", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "announce");
    const cur = await db.get("SELECT * FROM community_announcements WHERE id=$1 AND community=$2", [req.params.aid, cid]); if (!cur) throw E.nf();
    await db.run("DELETE FROM community_announcements WHERE id=$1", [cur.id]); await log(cid, req.user.id, { action: "announcement_deleted", category: "moderation", reason: cur.title });
    return { ok: true };
  }));
  R.post("/api/communities/:id/announcements/:aid/dismiss", A(async (req) => {
    const a = await db.get("SELECT * FROM community_announcements WHERE id=$1 AND community=$2", [req.params.aid, req.params.id]); if (!a) throw E.nf();
    if (!a.dismissible) throw E.bad("هذا الإعلان لا يُغلق");
    await db.run("INSERT INTO announcement_dismissals(announcement,user_id,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [a.id, req.user.id, now()]);
    return { ok: true };
  }));

  /* ---------- structured rules; communities.rules (titles) is the mirror, kept identical both ways ---------- */
  const ruleClient = (r) => ({ id: r.id, title: r.title, body: r.body || "", severity: r.severity, position: r.position });
  async function ensureRules(cid, legacy) {
    if (await db.get("SELECT 1 x FROM community_rules WHERE community=$1 LIMIT 1", [cid])) return;
    const titles = arr(legacy !== undefined ? legacy : (await db.get("SELECT rules FROM communities WHERE id=$1", [cid]))?.rules).map(x => String(x || "").trim()).filter(Boolean).slice(0, 20);
    let i = 0; for (const t of titles) await db.run("INSERT INTO community_rules(id,community,position,title,body,severity,created_at) VALUES($1,$2,$3,$4,'','info',$5)", [id("rl"), cid, ++i, t.slice(0, 200), now()]);
  }
  async function rulesOf(cid) { await ensureRules(cid); return (await db.all("SELECT * FROM community_rules WHERE community=$1 ORDER BY position, created_at", [cid])).map(ruleClient); }
  /** the legacy editor (PATCH /api/communities/:id with rules[]) wrote titles: keep each existing rule whose title is unchanged (body/severity stay), add/remove the rest */
  async function syncFromLegacy(cid, titles) {
    titles = arr(titles).map(x => String(x || "").trim()).filter(Boolean).slice(0, 20);
    const cur = await db.all("SELECT * FROM community_rules WHERE community=$1 ORDER BY position, created_at", [cid]); const used = new Set();
    await db.tx(async t => {
      let i = 0;
      for (const title of titles) {
        i++; const keep = cur.find(r => !used.has(r.id) && r.title === title) || (cur[i - 1] && !used.has(cur[i - 1].id) && !titles.includes(cur[i - 1].title) ? cur[i - 1] : null);
        if (keep) { used.add(keep.id); await t.run("UPDATE community_rules SET position=$1, title=$2, body=$3, updated_at=$4 WHERE id=$5", [i, title, keep.title === title ? keep.body : "", now(), keep.id]); }
        else await t.run("INSERT INTO community_rules(id,community,position,title,body,severity,created_at) VALUES($1,$2,$3,$4,'','info',$5)", [id("rl"), cid, i, title, now()]);
      }
      for (const r of cur) if (!used.has(r.id)) await t.run("DELETE FROM community_rules WHERE id=$1", [r.id]);
    });
  }
  R.get("/api/communities/:id/rules", async (req) => { const c = await getC(req.params.id); if (c.type === "invite" && !(await ctx.services.communities.visibleTo(c, req.user?.id))) throw E.nf(); return { rules: await rulesOf(c.id), required: !!c.settings?.rulesRequired }; });
  R.put("/api/communities/:id/rules", A(async (req) => {
    const cid = req.params.id; await getC(cid); await P.need(cid, req.user.id, "edit_rules", "تعديل القواعد للمالك");
    const list = arr(req.body?.rules).slice(0, 20).map(r => ({ id: typeof r?.id === "string" && /^rl_/.test(r.id) ? r.id : null, title: str(String(r?.title ?? ""), 200), body: str(String(r?.body ?? ""), 1000) || "", severity: oneOf(r?.severity, SEVERITY, "info") })).filter(r => r.title);
    const before = await rulesOf(cid);
    await db.tx(async t => {
      const keep = new Set(list.map(r => r.id).filter(Boolean));
      for (const r of before) if (!keep.has(r.id)) await t.run("DELETE FROM community_rules WHERE id=$1", [r.id]);
      let i = 0; for (const r of list) { i++;
        if (r.id && before.some(x => x.id === r.id)) await t.run("UPDATE community_rules SET position=$1, title=$2, body=$3, severity=$4, updated_at=$5 WHERE id=$6", [i, r.title, r.body, r.severity, now(), r.id]);
        else await t.run("INSERT INTO community_rules(id,community,position,title,body,severity,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [id("rl"), cid, i, r.title, r.body, r.severity, now()]); }
      await t.run("UPDATE communities SET rules=$1 WHERE id=$2", [list.map(r => r.title), cid]); // the mirror
    });
    if (req.body?.required !== undefined) await CS.mutate(db, cid, async (s) => ({ ...s, rulesRequired: !!req.body.required }));
    const after = await rulesOf(cid);
    await log(cid, req.user.id, { action: "rules_updated", category: "settings", diff: { rules: { from: before.map(r => r.title), to: after.map(r => r.title) } } });
    return { rules: after, mirror: (await getC(cid)).rules || [], required: !!(await getC(cid)).settings?.rulesRequired };
  }));

  /* ---------- welcome steps on the server ---------- */
  const AUTO = [[/منشور|عرّف|عرف بنفسك|اكتب|شارك/, "post"], [/ملف|صورت|صورة|نبذة/, "profile"]];
  async function onboarding(c, uid) {
    const w = c.settings?.welcome; const steps = arr(w?.steps); if (!uid || !steps.length && !w?.message) return null;
    const done = new Set((await db.all("SELECT step FROM community_onboarding WHERE community=$1 AND user_id=$2", [c.id, uid])).map(r => Number(r.step)));
    let posted = null, profile = null;
    const out = [];
    for (let i = 0; i < steps.length; i++) {
      const auto = (AUTO.find(([re]) => re.test(steps[i])) || [])[1] || null; let ok = done.has(i);
      if (!ok && auto === "post") { if (posted === null) posted = !!(await db.get("SELECT 1 x FROM posts WHERE community=$1 AND author=$2 AND status IN ('published','pending') LIMIT 1", [c.id, uid])); ok = posted; }
      if (!ok && auto === "profile") { if (profile === null) { const u = await db.get("SELECT bio, avatar FROM users WHERE id=$1", [uid]).catch(() => null); profile = !!(u && ((u.bio || "").trim().length >= 10 || u.avatar)); } ok = profile; }
      out.push({ i, label: steps[i], done: !!ok, auto });
    }
    return { message: w?.message || "", steps: out, done: out.filter(s => s.done).length, total: out.length };
  }
  async function needMember(cid, uid) { const v = await viewerOf(cid, uid); if (!v.active) throw E.forbid("للأعضاء فقط"); return v; }
  R.get("/api/communities/:id/onboarding", A(async (req) => { const c = await getC(req.params.id); await needMember(c.id, req.user.id); return { onboarding: await onboarding(c, req.user.id) }; }));
  R.put("/api/communities/:id/onboarding/:step", A(async (req) => {
    const c = await getC(req.params.id); await needMember(c.id, req.user.id); const i = Number(req.params.step);
    if (!Number.isInteger(i) || i < 0 || i >= arr(c.settings?.welcome?.steps).length) throw E.bad("خطوة غير موجودة");
    if (req.body?.done === false) await db.run("DELETE FROM community_onboarding WHERE community=$1 AND user_id=$2 AND step=$3", [c.id, req.user.id, i]);
    else await db.run("INSERT INTO community_onboarding(community,user_id,step,done_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [c.id, req.user.id, i, now()]);
    return { onboarding: await onboarding(c, req.user.id) };
  }));
  /* one-time import of the steps ticked before v2.58 (localStorage mp_ob_<community>_<i>); idempotent */
  R.post("/api/communities/:id/onboarding/import", A(async (req) => {
    const c = await getC(req.params.id); await needMember(c.id, req.user.id); const max = arr(c.settings?.welcome?.steps).length; let added = 0;
    for (const i of [...new Set(arr(req.body?.done).map(Number))].filter(x => Number.isInteger(x) && x >= 0 && x < max)) added += (await db.run("INSERT INTO community_onboarding(community,user_id,step,done_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [c.id, req.user.id, i, now()])).changes || 0;
    return { imported: added, onboarding: await onboarding(c, req.user.id) };
  }));
  R.get("/api/communities/:id/onboarding/stats", A(async (req) => {
    const c = await getC(req.params.id); await P.need(c.id, req.user.id, "queue_review"); const steps = arr(c.settings?.welcome?.steps);
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const newM = await db.all("SELECT user_id FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned') AND joined_at > $2 LIMIT 2000", [c.id, since]);
    const rows = newM.length ? await db.all(`SELECT user_id, step FROM community_onboarding WHERE community=$1 AND user_id IN (${ph(newM.map(m => m.user_id), 2)})`, [c.id, ...newM.map(m => m.user_id)]) : [];
    const per = steps.map((_, i) => rows.filter(r => Number(r.step) === i).length), by = {}; for (const r of rows) by[r.user_id] = (by[r.user_id] || 0) + 1;
    return { newMembers: newM.length, started: Object.keys(by).length, completed: steps.length ? Object.values(by).filter(x => x >= steps.length).length : 0, perStep: steps.map((label, i) => ({ label, done: per[i] })) };
  }));

  /* ---------- knowledge base meta (sections, recent edits) ---------- */
  R.patch("/api/communities/:id/wiki/:slug/section", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "wiki_lock");
    const p = await db.get("SELECT id, title FROM wiki_pages WHERE community=$1 AND slug=$2", [cid, req.params.slug]); if (!p) throw E.nf("الصفحة غير موجودة");
    await db.run("UPDATE wiki_pages SET section=$1 WHERE id=$2", [str(req.body?.section ?? "", 40) || null, p.id]);
    return { ok: true };
  }));
  R.get("/api/communities/:id/wiki-recent", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "wiki_lock");
    const rows = await db.all("SELECT r.version, r.summary, r.created_at, p.slug, p.title, u.name author FROM wiki_revisions r JOIN wiki_pages p ON p.id=r.page LEFT JOIN users u ON u.id=r.author WHERE p.community=$1 ORDER BY r.created_at DESC LIMIT 20", [cid]);
    return { edits: rows.map(r => ({ slug: r.slug, title: r.title, version: r.version, summary: r.summary || null, author: r.author || null, at: r.created_at })) };
  }));

  /* runtime, idempotent backfill: community_rules from communities.rules (the migration itself stays additive) */
  (async () => { for (const c of await db.all("SELECT id, rules FROM communities")) if (arr(c.rules).length) await ensureRules(c.id, c.rules); })().catch(() => {});

  return { viewerOf, canView, canPost, roleGate, list, checkPost, pinsFor, activeAnnouncement, rulesOf, ensureRules, syncFromLegacy, onboarding, chClient, TYPES, ICONS, PIN_COMMUNITY, PIN_CHANNEL };
};
