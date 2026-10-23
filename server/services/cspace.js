/* Community Space (Phases 16 & 20): identity (icon, accent, cover, category), channels with
 * channel-level permissions, community post tags, mandatory rules and join questions, automatic
 * welcome & onboarding, rich community page data; growth — invite links with stats, partner
 * communities, challenges with leaderboards, health report, daily metrics, suggestions, directory,
 * and a shareable server-rendered community page. */
const { E, str, oneOf, id, now, TOPICS } = require("../lib/core");
const CS = require("../lib/community-settings");
const GRAD = /^linear-gradient\(135deg,\s?#[0-9a-f]{3,8},\s?#[0-9a-f]{3,8}\)$/i;
const MOD = ["owner", "admin", "moderator"], STAFF_R = MOD, ACTIVE = (r) => r && !["pending", "banned"].includes(r);
const DAY = 864e5;
const slugify = (t) => String(t || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);

module.exports = (ctx) => {
  const { db, router: R, bus } = ctx; const A = ctx.requireUser;
  const role = async (cid, uid) => uid ? (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]))?.role : null;
  const getC = async (cid) => { const c = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf(); return c; };
  const P = ctx.cperm;
  /* v2.56: permission keys from lib/cperm.js (same grants as the old role lists, plus strict hierarchy elsewhere) */
  const need = async (cid, uid, key, msg) => (await P.need(cid, uid, key, msg)).role;
  /* what of the identity a viewer gets: join questions only to signed-in people who could join (never for invite-only
   * communities unless they already belong), the welcome only to members */
  const identityFor = (c, viewer, r) => { const x = identity(c); if (!viewer || (c.type === "invite" && !r)) x.joinQuestions = []; if (!ACTIVE(r)) x.welcome = null; return x; };
  const identity = (c) => { const s = c.settings || {}; return { icon: s.icon || null, accent: s.accent || null, cover: s.cover || null, category: CS.categoryOf(c), tags: s.tags || [], joinQuestions: s.joinQuestions || [], rulesRequired: !!s.rulesRequired, welcome: s.welcome || null, memberBadges: s.memberBadges !== false }; };

  /* ---------- identity & settings ---------- */
  R.patch("/api/communities/:id/identity", A(async (req) => {
    const c = await getC(req.params.id); await need(c.id, req.user.id, "edit_identity"); const b = { ...req.body };
    if (b.tags !== undefined && !Array.isArray(b.tags)) delete b.tags; if (b.joinQuestions !== undefined && !Array.isArray(b.joinQuestions)) delete b.joinQuestions;
    const patch = { ...CS.parseSection("identity", b), ...CS.parseSection("joining", b) };
    const res = await CS.mutate(db, c.id, async (s) => ({ ...s, ...patch })); // atomic: no lost update against automod/general saves
    await ctx.services.cmod.log(c.id, req.user.id, { action: "identity_updated", diff: CS.diff(res.before, res.after) });
    return { identity: identity(res.community) };
  }));

  /* ---------- settings by section (schema in lib/community-settings.js) ---------- */
  R.get("/api/communities/:id/settings", A(async (req) => {
    const c = await getC(req.params.id), keys = await P.keys(c.id, req.user.id); const s = c.settings || {};
    const sections = {};
    for (const [k, f] of Object.entries(CS.FIELDS)) {
      if (!keys.has(f.perm) && !(f.section === "moderation" && keys.has("view_automod"))) continue;
      (sections[f.section] = sections[f.section] || { title: CS.SECTIONS[f.section], editable: keys.has(f.perm), values: {} }).values[k] = k === "automod" ? { ...CS.AUTOMOD_DEFAULTS, ...(s.automod || {}) } : s[k] ?? null;
    }
    if (!Object.keys(sections).length) throw E.forbid();
    return { community: c.id, sections };
  }));
  R.patch("/api/communities/:id/settings/:section", A(async (req) => {
    const c = await getC(req.params.id), section = req.params.section; if (!CS.SECTIONS[section]) throw E.nf("قسم غير معروف");
    const perm = Object.values(CS.FIELDS).find(f => f.section === section).perm; await need(c.id, req.user.id, perm);
    const patch = CS.parseSection(section, req.body || {}); if (!Object.keys(patch).length) throw E.bad("لا توجد حقول صالحة لهذا القسم");
    const res = await CS.mutate(db, c.id, async (s) => ({ ...s, ...patch, ...(patch.automod ? { automod: CS.keepV2(s.automod, patch.automod) } : {}) })); // v2.59: keep automod v2 rules a legacy patch did not send
    await ctx.services.cmod.log(c.id, req.user.id, { action: "settings_updated", category: "settings", reason: section, diff: CS.diff(res.before, res.after) });
    const out = {}; for (const k of Object.keys(patch)) out[k] = res.after[k];
    return { section, values: out };
  }));

  /* ---------- channels (v2.58: create/edit/order/archive/groups/reads live in services/cchannels.js) ---------- */
  async function channels(cid, viewer) { return (await ctx.services.cchannels.list(cid, viewer)).channels; }
  /* deleting a channel never widens who sees its posts: posts of a PUBLIC channel move to the community's general stream
   * (as before); posts of a MEMBERS-ONLY channel keep their channel id, and content visibility treats an unknown channel
   * as members-only — so they stay with the members. */
  R.del("/api/communities/:id/channels/:ch", A(async (req) => {
    await need(req.params.id, req.user.id, "manage_channels");
    const ch = await db.get("SELECT * FROM community_channels WHERE id=$1 AND community=$2", [req.params.ch, req.params.id]); if (!ch) throw E.nf();
    if (ch.view_perm === "public") await db.run("UPDATE posts SET channel=NULL WHERE channel=$1 AND community=$2", [ch.id, req.params.id]);
    await db.run("DELETE FROM community_channels WHERE id=$1 AND community=$2", [ch.id, req.params.id]);
    await db.run("DELETE FROM community_pins WHERE community=$1 AND channel=$2", [req.params.id, ch.id]); await db.run("DELETE FROM channel_reads WHERE channel=$1", [ch.id]);
    await ctx.services.cmod.log(req.params.id, req.user.id, { action: "channel_deleted", reason: ch.name, meta: { viewPerm: ch.view_perm } });
    ctx.cache.del("feed:");
    return { ok: true };
  }));

  /* called by the content engine before a community post is written */
  async function beforePost(community, user, r, b) {
    const out = {};
    /* v2.57: an archived community is read-only; a lockdown pauses posting for everyone below the moderators */
    if (community.archived_at) throw E.forbid("المجتمع مؤرشف: للقراءة فقط");
    const lock = community.settings?.lockdownUntil; if (lock && new Date(lock) > new Date() && !(await P.has(community.id, user.id, "queue_review"))) throw E.forbid("النشر متوقف مؤقتاً في هذا المجتمع");
    /* v2.58: archive, role channels, slow mode, allowed content types, per-channel approval (services/cchannels.js) */
    Object.assign(out, await ctx.services.cchannels.checkPost(community, user, b));
    if (b.ctag) { const tags = community.settings?.tags || []; if (!tags.some(t => t.slug === b.ctag)) throw E.bad("الوسم غير موجود في هذا المجتمع"); out.ctag = b.ctag; }
    if (community.settings?.rulesRequired && !MOD.includes(r)) { const m = await db.get("SELECT rules_accepted_at FROM memberships WHERE community=$1 AND user_id=$2", [community.id, user.id]); if (!m?.rules_accepted_at) throw E.forbid("وافق على قواعد المجتمع أولاً"); }
    return out;
  }

  /* ---------- join with rules acceptance & questions ---------- */
  R.post("/api/communities/:id/join", A(async (req) => {
    const c = await getC(req.params.id), s = c.settings || {}, b = req.body;
    if (s.rulesRequired && (c.rules || []).length && !b.acceptRules) throw E.bad("يجب الموافقة على قواعد المجتمع");
    const qs = s.joinQuestions || []; const answers = qs.map((q, i) => ({ q, a: str(String((b.answers || [])[i] || ""), 500) || "" }));
    if (c.type !== "public" && qs.length && answers.some(x => !x.a)) throw E.bad("أجب عن أسئلة الانضمام");
    /* invite links: the use is RESERVED atomically — the invite row is locked (PostgreSQL FOR UPDATE; SQLite transactions
     * are serialised) while used < max_uses is checked and the membership is attributed, so N parallel joins cannot
     * exceed max_uses. */
    if (c.archived_at) throw E.forbid("المجتمع مؤرشف: لا يقبل أعضاء جدداً");
    const inv = b.invite ? await db.get("SELECT * FROM community_invites WHERE code=$1 AND community=$2", [str(String(b.invite), 20), c.id]) : null;
    const live = inv && !inv.revoked_at && (!inv.expires_at || new Date(inv.expires_at) > new Date());
    const grant = live && ["member", "moderator"].includes(inv.grant_role) ? inv.grant_role : "member"; // v2.57: role granted on join
    const direct = live && (c.type === "invite" || (c.type === "private" && inv.skip_approval)); // the link itself admits
    const reserve = async (fn) => db.tx(async t => {
      const row = await t.get(`SELECT * FROM community_invites WHERE code=$1${db.dialect === "postgres" ? " FOR UPDATE" : ""}`, [inv.code]);
      const used = Number((await t.get("SELECT COUNT(*) n FROM memberships WHERE invited_via=$1", [inv.code])).n);
      if (row.max_uses && used >= row.max_uses) return false;
      return fn(t);
    });
    let res;
    if (direct) {
      const ex = await role(c.id, req.user.id); if (ex === "banned") throw E.forbid("أنت محظور من هذا المجتمع");
      if (ex && ex !== "pending") res = { role: ex };
      else {
        const ok = await reserve(async t => {
          if (ex === "pending") await t.run("UPDATE memberships SET role=$1, status='active', invited_via=COALESCE(invited_via,$2) WHERE community=$3 AND user_id=$4 AND role='pending'", [grant, inv.code, c.id, req.user.id]);
          else await t.run("INSERT INTO memberships(community,user_id,role,joined_at,invited_via) VALUES($1,$2,$3,$4,$5)", [c.id, req.user.id, grant, now(), inv.code]);
          await t.run("UPDATE community_invites SET uses=uses+1 WHERE code=$1", [inv.code]); return true;
        });
        if (!ok) throw E.forbid("اكتمل عدد استخدامات رابط الدعوة");
        bus.emit("COMMUNITY_JOINED", { community: c.id, owner: c.owner, actor: req.user.id }); await ctx.services.communities.mevent(c.id, req.user.id, "join", { via: inv.code, role: grant });
        if (ex === "pending") await db.run("UPDATE join_requests SET status='approved', decided_by='invite', decided_at=$1 WHERE community=$2 AND user_id=$3 AND status='pending'", [now(), c.id, req.user.id]);
        res = { role: grant };
      }
    } else {
      const before = live ? await role(c.id, req.user.id) : null;
      res = await ctx.services.communities.join(req.user, c.id);
      const tagged = live && await reserve(async t => { const ch = (await t.run("UPDATE memberships SET invited_via=$1 WHERE community=$2 AND user_id=$3 AND invited_via IS NULL", [inv.code, c.id, req.user.id])).changes > 0; if (ch) await t.run("UPDATE community_invites SET uses=uses+1 WHERE code=$1", [inv.code]); return ch; });
      /* v2.60: the join event fired before the code was stored, so the live «joined via invite» counter is bumped here */
      if (tagged && !before && res.role !== "pending") await ctx.services.cinsights?.bump(c.id, new Date().toISOString().slice(0, 10), "invite_joins").catch(() => {});
    }
    await db.run("UPDATE memberships SET rules_accepted_at=$1 WHERE community=$2 AND user_id=$3", [b.acceptRules ? now() : null, c.id, req.user.id]);
    /* v2.57: every request keeps a row (answers may be empty) — decided requests stay as history (status, who, when) */
    if (res.role === "pending") await db.run("INSERT INTO join_requests(community,user_id,answers,created_at,status,source) VALUES($1,$2,$3,$4,'pending',$5) ON CONFLICT (community,user_id) DO UPDATE SET answers=$3, created_at=$4, status='pending', decided_by=NULL, decided_at=NULL, reason=NULL, source=$5", [c.id, req.user.id, answers, now(), live ? "invite" : "direct"]);
    return { ...res, welcome: res.role === "member" ? identity(c).welcome : null };
  }));
  R.post("/api/communities/:id/rules/accept", A(async (req) => { await db.run("UPDATE memberships SET rules_accepted_at=$1 WHERE community=$2 AND user_id=$3", [now(), req.params.id, req.user.id]); return { ok: true }; }));
  R.get("/api/communities/:id/requests", A(async (req) => {
    await need(req.params.id, req.user.id, "approve_requests");
    const rows = await db.all("SELECT m.user_id, m.joined_at, u.name, u.handle, u.avatar, u.color, u.created_at ucreated, j.answers FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN join_requests j ON j.community=m.community AND j.user_id=m.user_id WHERE m.community=$1 AND m.role='pending' ORDER BY m.joined_at", [req.params.id]);
    return { requests: rows.map(r => ({ user: { id: r.user_id, name: r.name, handle: r.handle, avatar: r.avatar, color: r.color, createdAt: r.ucreated }, requestedAt: r.joined_at, answers: r.answers || [] })) };
  }));
  /* automatic welcome: a DM-style notification plus onboarding steps on first visit */
  bus.on("COMMUNITY_JOINED", async (e) => {
    const c = await db.get("SELECT id, settings, owner FROM communities WHERE id=$1", [e.community]); const w = c?.settings?.welcome; if (!w?.message) return;
    await ctx.services.messaging?.notify(e.actor, "community_welcome", { actor: c.owner, ref: c.id });
  });

  /* ---------- community page data ---------- */
  R.get("/api/communities/:id/space", async (req) => {
    const c = await getC(req.params.id), viewer = req.user?.id, r = await role(c.id, viewer);
    const CC = ctx.services.cchannels, v = await CC.viewerOf(c.id, viewer);
    const week = new Date(Date.now() - 7 * DAY).toISOString();
    const canSeeMembers = await ctx.services.communities.visibleTo(c, viewer); // private communities keep their members to themselves
    const staff = !!viewer && STAFF_R.includes(r);
    /* v2.58: independent reads run together (PostgreSQL pool) — the page must not open slower with the new parts */
    const [memberCount, postsWeek, activeWeek, rep, mods, m, partners, challenges, events, chs, pins, announcement, onboarding, preview, queue, study] = await Promise.all([
      db.get("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [c.id]).then(x => Number(x.n)),
      db.get("SELECT COUNT(*) n FROM posts WHERE community=$1 AND status='published' AND created_at > $2", [c.id, week]).then(x => Number(x.n)),
      db.get("SELECT COUNT(DISTINCT a) n FROM (SELECT author a FROM posts WHERE community=$1 AND status='published' AND created_at > $2 UNION SELECT cm.author a FROM comments cm JOIN posts p ON p.id=cm.post WHERE p.community=$1 AND cm.created_at > $2) x", [c.id, week]).then(x => Number(x.n)).catch(() => 0),
      canSeeMembers ? ctx.services.communities.reputation(c.id, 30) : [],
      db.all("SELECT m.user_id, m.role, u.name, u.handle, u.avatar, u.color, u.verified FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.community=$1 AND m.role IN ('owner','admin','moderator') ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END", [c.id]),
      viewer ? db.get("SELECT rules_accepted_at, joined_at FROM memberships WHERE community=$1 AND user_id=$2", [c.id, viewer]) : null,
      db.all("SELECT c.id, c.name, c.color, c.settings FROM community_partners p JOIN communities c ON c.id = CASE WHEN p.a=$1 THEN p.b ELSE p.a END WHERE (p.a=$1 OR p.b=$1) AND p.status='accepted' LIMIT 6", [c.id]),
      db.all("SELECT id, title, tag, ends_at FROM community_challenges WHERE community=$1 AND ends_at > $2 ORDER BY ends_at LIMIT 3", [c.id, now()]),
      db.get("SELECT COUNT(*) n FROM events WHERE community=$1 AND status='upcoming'", [c.id]).then(x => Number(x.n)),
      CC.list(c.id, viewer, v),
      canSeeMembers || c.type === "public" ? CC.pinsFor(c.id, viewer) : [],
      CC.activeAnnouncement(c, viewer, v),
      v.active && !staff ? CC.onboarding(c, viewer) : null, // the team does not get the newcomer card
      canSeeMembers ? db.all("SELECT u.id, u.name, u.handle, u.avatar, u.color FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.community=$1 AND m.role NOT IN ('pending','banned','muted') ORDER BY CASE WHEN m.role IN ('owner','admin','moderator') THEN 0 ELSE 1 END, m.joined_at DESC LIMIT 5", [c.id]) : [],
      staff ? db.get("SELECT (SELECT COUNT(*) FROM posts WHERE community=$1 AND status='pending') + (SELECT COUNT(*) FROM memberships WHERE community=$1 AND role='pending') n", [c.id]).then(x => Number(x.n)).catch(() => 0) : 0,
      db.get("SELECT mode FROM study_groups WHERE community_id=$1", [c.id]).catch(() => null) // phase 71: this community is a study group / halaqa
    ]);
    const topIds = rep.filter(x => !mods.some(md => md.user_id === x.user)).slice(0, 6).map(x => x.user);
    const top = topIds.length ? await db.all(`SELECT id, name, handle, avatar, color, verified FROM users WHERE id IN (${topIds.map((_, i) => "$" + (i + 1)).join(",")})`, topIds) : [];
    const newcomer = m && Date.now() - new Date(m.joined_at) < 7 * DAY;
    const ob = onboarding && (newcomer || onboarding.done < onboarding.total) && (onboarding.message || onboarding.total) ? onboarding : null;
    return {
      community: ctx.services.communities.toClient(c), identity: identityFor(c, viewer, r), role: r || null, rulesAccepted: !!m?.rules_accepted_at,
      channels: chs.channels, channelGroups: chs.groups, stats: { members: memberCount, postsWeek, activeWeek, events },
      moderators: mods.map(x => ({ id: x.user_id, role: x.role, name: x.name, handle: x.handle, avatar: x.avatar, color: x.color, verified: x.verified })), featured: topIds.map(i => top.find(u => u.id === i)).filter(Boolean),
      partners: partners.map(p => ({ id: p.id, name: p.name, color: p.color, icon: p.settings?.icon || null })), challenges,
      onboarding: ob && (newcomer || Date.now() - new Date(m.joined_at) < 30 * DAY) ? ob : null, // newcomers (7 days), or up to 30 days while steps remain
      pins, announcement, membersPreview: preview, queue, contentTypes: Array.isArray(c.settings?.contentTypes) ? c.settings.contentTypes : [],
      study: study || null
    };
  });
  R.get("/api/communities/:id/posts", async (req) => {
    const c = await getC(req.params.id); const where = ["community=$1", "status='published'"], args = [c.id];
    if (req.query.channel) { args.push(req.query.channel); where.push(`channel=$${args.length}`); }
    if (req.query.tag) { args.push(req.query.tag); where.push(`ctag=$${args.length}`); }
    if (req.query.before) { // cursor "created_at|id" (stable on equal timestamps); a bare timestamp still works
      const [t, pid] = String(req.query.before).split("|"); args.push(t);
      if (pid) { args.push(pid); where.push(`(created_at < $${args.length - 1} OR (created_at = $${args.length - 1} AND id < $${args.length}))`); } else where.push(`created_at < $${args.length}`);
    }
    const rows = await db.all(`SELECT * FROM posts WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT 30`, args);
    const vis = await ctx.services.content.filterVisible(rows, req.user?.id);
    const last = rows[rows.length - 1];
    const MB = require("../lib/member-badges"), badges = {}; // v2.62: only the badge kind leaves the server, never joined_at
    const authors = [...new Set(vis.map(p => p.author))];
    if (MB.enabled(c.settings) && authors.length) for (const m of await db.all(`SELECT user_id, joined_at, role FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned') AND user_id IN (${authors.map((_, i) => "$" + (i + 2)).join(",")})`, [c.id, ...authors])) { const b = MB.badgeFor(m.joined_at, Date.now(), m.role); if (b) badges[m.user_id] = b; }
    return { posts: vis.map(p => ({ ...ctx.services.content.toClient(p, req.user?.id), ...(badges[p.author] ? { memberBadge: badges[p.author] } : {}) })), next: rows.length === 30 ? `${last.created_at}|${last.id}` : null };
  });

  /* ---------- growth: invite links ---------- */
  const code = () => Array.from(require("node:crypto").randomBytes(6), b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  R.post("/api/communities/:id/invites", A(async (req) => {
    const me = await P.need(req.params.id, req.user.id, "invite");
    const inv = { code: code(), label: str(req.body.label, 40) || null, max: Number.isInteger(req.body.maxUses) && req.body.maxUses > 0 ? Math.min(req.body.maxUses, 10000) : null, exp: req.body.days ? new Date(Date.now() + Math.min(365, +req.body.days) * DAY).toISOString() : null, note: str(req.body.note, 120) || null };
    /* v2.57 options: a role granted on join (only one the creator could hand out themselves) and skipping the approval
     * of a private community (only for people who may approve requests) */
    const grant = req.body.grantRole === "moderator" ? "moderator" : null;
    if (grant && !(await P.has(req.params.id, req.user.id, "manage_roles"))) throw E.forbid("منح دور عند الانضمام لمن يدير الأدوار");
    if (grant && !P.assignable(me.role).includes(grant)) throw E.forbid("لا يمكنك منح رتبة تساوي رتبتك أو أعلى");
    const skip = !!req.body.skipApproval; if (skip && !(await P.has(req.params.id, req.user.id, "approve_requests"))) throw E.forbid("تجاوز الموافقة لمن يقبل الطلبات");
    await db.run("INSERT INTO community_invites(code,community,created_by,label,max_uses,expires_at,created_at,grant_role,skip_approval,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [inv.code, req.params.id, req.user.id, inv.label, inv.max, inv.exp, now(), grant, skip ? 1 : 0, inv.note]);
    if (grant || skip) await ctx.services.cmod.log(req.params.id, req.user.id, { action: "invite_created", category: "members", reason: inv.label, meta: { grantRole: grant, skipApproval: skip } });
    return { invite: { code: inv.code, label: inv.label, maxUses: inv.max, expiresAt: inv.exp, grantRole: grant, skipApproval: skip, note: inv.note, url: `/j/${inv.code}` } };
  }));
  R.get("/api/communities/:id/invites", A(async (req) => {
    const r = await role(req.params.id, req.user.id); if (!ACTIVE(r)) throw E.forbid();
    const params = [req.params.id, new Date(Date.now() - 7 * DAY).toISOString()]; let filter = "";
    if (!(await P.has(req.params.id, req.user.id, "approve_requests"))) { params.push(req.user.id); filter = " AND i.created_by=$3"; }
    const rows = await db.all(`SELECT i.*, u.name creator, (SELECT COUNT(*) FROM memberships m WHERE m.invited_via=i.code) joins,
      (SELECT COUNT(*) FROM memberships m WHERE m.invited_via=i.code AND m.role NOT IN ('pending','banned') AND EXISTS (SELECT 1 FROM posts p WHERE p.community=i.community AND p.author=m.user_id)) active,
      (SELECT COUNT(*) FROM memberships m WHERE m.invited_via=i.code AND m.role NOT IN ('pending','banned') AND m.joined_at < $2) settled
      FROM community_invites i JOIN users u ON u.id=i.created_by WHERE i.community=$1${filter} ORDER BY i.created_at DESC`, params);
    return { invites: rows.map(i => ({ code: i.code, label: i.label, creator: i.creator, clicks: i.clicks, joins: Number(i.joins), active: Number(i.active), conversion: i.clicks ? Math.round(Number(i.joins) / i.clicks * 100) : 0, maxUses: i.max_uses, expiresAt: i.expires_at, uses: Math.max(Number(i.uses || 0), Number(i.joins)), revokedAt: i.revoked_at || null, grantRole: i.grant_role || null, skipApproval: !!i.skip_approval, note: i.note || null, createdBy: i.created_by, createdAt: i.created_at, url: `/j/${i.code}` })) };
  }));
  R.get("/api/invites/:code", async (req) => {
    if (!ctx.rl.hit("default", "invcode:" + (req.ip || "anon"))) throw E.rate(); // no click inflation / code guessing at speed
    const inv = await db.get("SELECT i.*, c.name, c.descr, c.color, c.type, c.settings FROM community_invites i JOIN communities c ON c.id=i.community WHERE i.code=$1", [req.params.code]); if (!inv) throw E.nf("رابط الدعوة غير صالح");
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) throw E.bad("انتهت صلاحية الدعوة");
    if (inv.revoked_at) throw E.bad("أُلغي رابط الدعوة هذا");
    await db.run("UPDATE community_invites SET clicks=clicks+1 WHERE code=$1", [inv.code]);
    const inviter = await db.get("SELECT name, handle FROM users WHERE id=$1", [inv.created_by]);
    return { invite: { code: inv.code, community: { id: inv.community, name: inv.name, desc: inv.descr, color: inv.color, type: inv.type, icon: inv.settings?.icon || null }, inviter, members: Number((await db.get("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [inv.community])).n) } };
  });

  /* ---------- partners ---------- */
  R.post("/api/communities/:id/partners", A(async (req) => {
    await need(req.params.id, req.user.id, "manage_integrations"); if (!ctx.rl.hit("invite", "partner:" + req.user.id)) throw E.rate();
    const other = await getC(req.body.community); if (other.id === req.params.id) throw E.bad();
    const [a, b] = [req.params.id, other.id].sort(); const ex = await db.get("SELECT * FROM community_partners WHERE a=$1 AND b=$2", [a, b]);
    if (ex?.status === "accepted") return { status: "accepted" };
    if (ex && ex.proposed_by !== req.params.id) { await db.run("UPDATE community_partners SET status='accepted' WHERE a=$1 AND b=$2", [a, b]); await ctx.services.cmod.log(req.params.id, req.user.id, { action: "partner_accepted", reason: other.name }); return { status: "accepted" }; }
    if (!ex) await db.run("INSERT INTO community_partners(a,b,status,proposed_by,created_at) VALUES($1,$2,'pending',$3,$4)", [a, b, req.params.id, now()]);
    await ctx.services.messaging?.notify(other.owner, "partner_request", { actor: req.user.id, ref: req.params.id });
    return { status: "pending" };
  }));
  R.get("/api/communities/:id/partners", async (req) => {
    const rows = await db.all("SELECT p.status, p.proposed_by, c.id, c.name, c.color, c.descr, c.settings FROM community_partners p JOIN communities c ON c.id = CASE WHEN p.a=$1 THEN p.b ELSE p.a END WHERE p.a=$1 OR p.b=$1", [req.params.id]);
    return { partners: rows.map(p => ({ id: p.id, name: p.name, desc: p.descr, color: p.color, icon: p.settings?.icon || null, status: p.status, incoming: p.status === "pending" && p.proposed_by !== req.params.id })) };
  });
  R.del("/api/communities/:id/partners/:other", A(async (req) => { await need(req.params.id, req.user.id, "manage_integrations"); const [a, b] = [req.params.id, req.params.other].sort(); await db.run("DELETE FROM community_partners WHERE a=$1 AND b=$2", [a, b]); return { ok: true }; }));

  /* ---------- challenges ---------- */
  async function leaderboard(ch) {
    const tagLike = "%#" + ch.tag.toLowerCase() + "%";
    return (await db.all(`SELECT p.id, p.author, u.name, u.handle, u.avatar, u.color, p.text, (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) + 2*(SELECT COUNT(*) FROM comments c WHERE c.post=p.id) score
      FROM posts p JOIN users u ON u.id=p.author WHERE p.community=$1 AND p.status='published' AND p.created_at BETWEEN $2 AND $3 AND (LOWER(p.text) LIKE $4 OR p.ctag=$5) ORDER BY score DESC, p.created_at LIMIT 20`, [ch.community, ch.starts_at, ch.ends_at, tagLike, ch.tag]))
      .map(x => ({ post: x.id, user: { id: x.author, name: x.name, handle: x.handle, avatar: x.avatar, color: x.color }, text: x.text.slice(0, 120), score: Number(x.score) }));
  }
  R.post("/api/communities/:id/challenges", A(async (req) => {
    await need(req.params.id, req.user.id, "manage_challenges"); const b = req.body;
    const starts = b.startsAt ? new Date(b.startsAt) : new Date(), ends = new Date(b.endsAt); if (isNaN(ends) || ends <= starts) throw E.bad("موعد الانتهاء غير صالح");
    const ch = { id: id("cg"), title: str(b.title, 80, { required: true }), descr: str(b.desc, 500) || "", tag: slugify(b.tag || b.title).replace(/-/g, "_"), prize: str(b.prize, 100) };
    await db.run("INSERT INTO community_challenges(id,community,title,descr,tag,prize,starts_at,ends_at,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [ch.id, req.params.id, ch.title, ch.descr, ch.tag, ch.prize, starts.toISOString(), ends.toISOString(), req.user.id, now()]);
    return { challenge: { ...ch, startsAt: starts.toISOString(), endsAt: ends.toISOString() } };
  }));
  R.get("/api/communities/:id/challenges", async (req) => {
    const rows = await db.all("SELECT * FROM community_challenges WHERE community=$1 ORDER BY ends_at DESC LIMIT 20", [req.params.id]);
    return { challenges: await Promise.all(rows.map(async ch => ({ id: ch.id, title: ch.title, desc: ch.descr, tag: ch.tag, prize: ch.prize, startsAt: ch.starts_at, endsAt: ch.ends_at, status: new Date(ch.ends_at) < new Date() ? "ended" : new Date(ch.starts_at) > new Date() ? "upcoming" : "live", winners: ch.winners || null, leaderboard: (await leaderboard(ch)).slice(0, 10) }))) };
  });
  async function closeChallenges() {
    for (const ch of await db.all("SELECT * FROM community_challenges WHERE ends_at < $1 AND winners IS NULL", [now()])) {
      const top = (await leaderboard(ch)).slice(0, 3); await db.run("UPDATE community_challenges SET winners=$1 WHERE id=$2", [top, ch.id]);
      for (const w of top) await ctx.services.messaging?.notify(w.user.id, "challenge_won", { ref: ch.community, post: w.post });
    }
  }

  /* ---------- metrics (daily rollup job), health report, suggestions, directory ---------- */
  /* one pass per table (GROUP BY) instead of a correlated COUNT per community */
  const AGG = `SELECT c.*, COALESCE(mm.n,0) members, COALESCE(pp.n,0) recent FROM communities c
    LEFT JOIN (SELECT community, COUNT(*) n FROM memberships WHERE role NOT IN ('pending','banned') GROUP BY community) mm ON mm.community=c.id
    LEFT JOIN (SELECT community, COUNT(*) n FROM posts WHERE community IS NOT NULL AND status='published' AND created_at > $1 GROUP BY community) pp ON pp.community=c.id`;
  /* v2.60: the daily rollup is now a RECONCILER (services/cinsights.js): incremental bus counters keep today's row live and
   * this recomputes one day from the source tables (nightly for yesterday; any day on demand) for the communities that
   * had activity that day — instead of scanning every community every 15 minutes. Same signature, same row. */
  async function computeMetrics(dayIso) { return ctx.services.cinsights.computeMetrics(dayIso); }
  async function health(cid) {
    const since = (d) => new Date(Date.now() - d * DAY).toISOString(), members = Number((await db.get("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [cid])).n) || 1;
    const actors = async (d) => new Set([...(await db.all("SELECT author u FROM posts WHERE community=$1 AND status='published' AND created_at > $2", [cid, since(d)])), ...(await db.all("SELECT c.author u FROM comments c JOIN posts p ON p.id=c.post WHERE p.community=$1 AND c.created_at > $2", [cid, since(d)])), ...(await db.all("SELECT r.user_id u FROM reactions r JOIN posts p ON p.id=r.target WHERE p.community=$1 AND r.at > $2", [cid, since(d)]))].map(x => x.u)).size;
    const [dau, wau, mau] = [await actors(1), await actors(7), await actors(30)];
    const newM = await db.all("SELECT user_id, role FROM memberships WHERE community=$1 AND joined_at BETWEEN $2 AND $3", [cid, since(60), since(30)]);
    const retained = newM.filter(m => !["pending", "banned"].includes(m.role)).length;
    const qs = await db.all("SELECT p.id, p.created_at, p.data, (SELECT MIN(c.created_at) FROM comments c WHERE c.post=p.id AND c.author<>p.author) first FROM posts p WHERE p.community=$1 AND p.status='published' AND p.created_at > $2", [cid, since(30)]);
    const questions = qs.filter(q => q.data && Object.prototype.hasOwnProperty.call(q.data, "acceptedAnswer"));
    const answered = questions.filter(q => q.first).length;
    const replyTimes = qs.filter(q => q.first).map(q => (new Date(q.first) - new Date(q.created_at)) / 60e3).sort((a, b) => a - b);
    const medianReply = replyTimes.length ? Math.round(replyTimes[Math.floor(replyTimes.length / 2)]) : null;
    const backlog = Number((await db.get("SELECT COUNT(*) n FROM posts WHERE community=$1 AND status='pending'", [cid])).n) + Number((await db.get("SELECT COUNT(*) n FROM reports r JOIN posts p ON p.id=r.target WHERE p.community=$1 AND r.status='open'", [cid])).n);
    const modActions = Number((await db.get("SELECT COUNT(*) n FROM mod_actions WHERE community=$1 AND created_at > $2 AND action IN ('remove','warn','mute','ban','reject')", [cid, since(30)])).n);
    const series = await db.all("SELECT day, posts, comments, reactions, active_users, new_members FROM community_metrics WHERE community=$1 AND day >= $2 ORDER BY day", [cid, since(30).slice(0, 10)]);
    const stickiness = mau ? dau / mau : 0, activeShare = wau / members, retention = newM.length ? retained / newM.length : 1, answerRate = questions.length ? answered / questions.length : 1;
    const score = Math.round(Math.min(1, stickiness / 0.25) * 25 + Math.min(1, activeShare / 0.3) * 25 + retention * 20 + answerRate * 15 + (medianReply === null ? 0.5 : Math.max(0, 1 - medianReply / 720)) * 10 + (backlog > 20 ? 0 : 1 - backlog / 20) * 5);
    const tips = [];
    if (activeShare < 0.1) tips.push("نسبة الأعضاء النشطين منخفضة: جرّب سؤالاً أسبوعياً ثابتاً أو تحدياً قصيراً.");
    if (answerRate < 0.7 && questions.length) tips.push("أسئلة كثيرة بلا رد: عيّن مشرفاً للأسئلة أو فعّل اقتراح الإجابات السابقة.");
    if (medianReply !== null && medianReply > 240) tips.push("أول رد يتأخر أكثر من ٤ ساعات: نبّه المشرفين أو ثبّت قناة للترحيب.");
    if (backlog > 10) tips.push(`في طابور المراجعة ${backlog} عنصراً: أضف مشرفاً أو فعّل قواعد آلية.`);
    if (retention < 0.6 && newM.length) tips.push("الأعضاء الجدد يغادرون: أضف رسالة ترحيب وخطوات بداية واضحة.");
    if (!tips.length) tips.push("مجتمعك بصحة جيدة. حافظ على الإيقاع واحتفل بالأعضاء البارزين.");
    return { score, grade: score >= 80 ? "ممتاز" : score >= 60 ? "جيد" : score >= 40 ? "متوسط" : "يحتاج انتباهاً", members, dau, wau, mau, stickiness: Math.round(stickiness * 100), activeShare: Math.round(activeShare * 100), retention30: Math.round(retention * 100), answerRate: Math.round(answerRate * 100), medianReplyMin: medianReply, backlog, modActions30: modActions, series, tips };
  }
  R.get("/api/communities/:id/health", A(async (req) => { await need(req.params.id, req.user.id, "view_health"); return health(req.params.id); }));
  R.get("/api/communities/suggested", A(async (req) => {
    const u = req.user;
    const mine = new Set((await db.all("SELECT community FROM memberships WHERE user_id=$1", [u.id])).map(m => m.community));
    const topics = {}; for (const p of await db.all("SELECT topic FROM posts WHERE author=$1 AND created_at > $2", [u.id, new Date(Date.now() - 90 * DAY).toISOString()])) if (p.topic) topics[p.topic] = (topics[p.topic] || 0) + 1;
    for (const p of await db.all("SELECT p.topic FROM reactions r JOIN posts p ON p.id=r.target WHERE r.user_id=$1 AND r.at > $2", [u.id, new Date(Date.now() - 90 * DAY).toISOString()])) if (p.topic) topics[p.topic] = (topics[p.topic] || 0) + 0.5;
    for (const t of (u.prefs?.interests || [])) topics[t] = (topics[t] || 0) + 2;
    const friends = {}; for (const m of await db.all("SELECT m.community FROM memberships m JOIN follows f ON f.dst=m.user_id AND f.src=$1 WHERE m.role NOT IN ('pending','banned')", [u.id])) friends[m.community] = (friends[m.community] || 0) + 1;
    const recent = new Date(Date.now() - 14 * DAY).toISOString();
    const rows = await db.all(AGG + " WHERE c.type<>'invite'", [recent]);
    const city = (u.location || "").trim();
    const scored = rows.filter(c => !mine.has(c.id)).map(c => {
      const cat = CS.categoryOf(c), reasons = []; let s = 0;
      if (cat && topics[cat]) { s += Math.min(6, topics[cat]) * 2; reasons.push("يطابق اهتماماتك"); }
      if (friends[c.id]) { s += friends[c.id] * 3; reasons.push(`${friends[c.id]} ممن تتابعهم أعضاء فيه`); }
      if (city && c.location && c.location.includes(city)) { s += 4; reasons.push("قريب منك"); }
      s += Math.log2(1 + Number(c.recent)) + Math.log2(1 + Number(c.members)) * 0.5;
      return { id: c.id, name: c.name, desc: c.descr, color: c.color, icon: c.settings?.icon || null, members: Number(c.members), score: Math.round(s * 10) / 10, reasons: reasons.length ? reasons : ["نشط هذه الأيام"] };
    }).sort((a, b) => b.score - a.score).slice(0, 8);
    return { suggestions: scored };
  }));
  R.get("/api/communities/directory", async (req) => {
    const q = String(req.query.q || "").trim().toLowerCase(), cat = req.query.category, sort = oneOf(req.query.sort, ["active", "members", "new"], "active");
    const recent = new Date(Date.now() - 14 * DAY).toISOString();
    const args = [recent], where = ["c.type<>'invite'"];
    if (q) { args.push("%" + q.replace(/[%_]/g, "").slice(0, 60) + "%"); where.push(`(LOWER(c.name) LIKE $${args.length} OR LOWER(COALESCE(c.descr,'')) LIKE $${args.length})`); }
    let rows = await db.all(AGG + " WHERE " + where.join(" AND ") + (sort === "members" ? " ORDER BY members DESC, c.created_at DESC" : sort === "new" ? " ORDER BY c.created_at DESC" : " ORDER BY recent DESC, members DESC, c.created_at DESC") + (cat ? "" : " LIMIT 60"), args);
    if (cat) rows = rows.filter(c => CS.categoryOf(c) === cat); // category lives in the settings JSON (or the topic)
    const counts = {}; for (const c of await db.all("SELECT topic, settings FROM communities WHERE type<>'invite'")) { const k = CS.categoryOf(c); if (k) counts[k] = (counts[k] || 0) + 1; }
    return { categories: TOPICS.filter(t => counts[t.slug]).map(t => ({ ...t, count: counts[t.slug] })), communities: rows.slice(0, 60).map(c => ({ id: c.id, name: c.name, desc: c.descr, color: c.color, type: c.type, icon: c.settings?.icon || null, accent: c.settings?.accent || null, category: CS.categoryOf(c), members: Number(c.members), postsTwoWeeks: Number(c.recent) })) };
  });

  /* ---------- shareable community page (SSR, Open Graph) ---------- */
  const esc = (s = "") => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  async function ssr(req, res, url) {
    let m = /^\/c\/([a-z]{1,3}_[a-z0-9]{6,24})\/?$/i.exec(url.pathname), inv = null;
    const j = /^\/j\/([a-z0-9]{6,12})\/?$/i.exec(url.pathname);
    if (j) { inv = await db.get("SELECT * FROM community_invites WHERE code=$1", [j[1]]); if (inv) m = [null, inv.community]; }
    if (!m) return false;
    const c = await db.get("SELECT * FROM communities WHERE id=$1", [m[1]]);
    if (!c || c.type === "invite" && !inv) { res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>غير متاح</title><body style="font-family:system-ui;text-align:center;padding:60px"><h1>المجتمع غير متاح</h1><a href="/">مجتمع بلس</a></body></html>`); return true; }
    if (inv) await db.run("UPDATE community_invites SET clicks=clicks+1 WHERE code=$1", [inv.code]);
    const members = Number((await db.get("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [c.id])).n);
    const o = process.env.PUBLIC_URL || `http://${req.headers.host}`, s = c.settings || {}, cover = s.cover && s.cover.startsWith("/media/") ? o + s.cover : null;
    const target = inv ? `/#/join/${inv.code}` : `/#/c/${c.id}`;
    const desc = (c.descr || `مجتمع على مجتمع بلس · ${members} عضو`).slice(0, 160);
    res.writeHead(200, { ...require("../lib/http").SEC_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
    res.end(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.name)} · مجتمع بلس</title>
<meta name="description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:title" content="${esc((s.icon ? s.icon + " " : "") + c.name)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(o + url.pathname)}"><meta property="og:site_name" content="مجتمع بلس">${cover ? `<meta property="og:image" content="${esc(cover)}"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
<link rel="canonical" href="${esc(o + "/c/" + c.id)}"><meta http-equiv="refresh" content="2;url=${esc(target)}">
<style>body{margin:0;font-family:"IBM Plex Sans Arabic",system-ui;background:#f6f4fc;color:#1d1b26;display:grid;place-items:center;min-height:100vh}.card{width:min(420px,92vw);border-radius:28px;overflow:hidden;background:#fff;box-shadow:0 20px 60px rgba(40,20,90,.18);text-align:center}.cv{height:140px;background:${GRAD.test(c.color || "") ? c.color : "linear-gradient(135deg,#5b2bd6,#c04cf0)"}${cover ? ` url('${esc(s.cover)}') center/cover` : ""}}.ic{width:84px;height:84px;margin:-42px auto 0;border-radius:24px;background:#fff;display:grid;place-items:center;font-size:44px;box-shadow:0 6px 20px rgba(0,0,0,.12)}h1{margin:12px 16px 4px}p{color:#6b6880;margin:0 20px 16px}a{display:block;margin:0 20px 22px;padding:14px;border-radius:16px;background:#6d3df5;color:#fff;text-decoration:none;font-weight:700}</style></head>
<body><div class="card"><div class="cv"></div><div class="ic">${esc(s.icon || "👥")}</div><h1>${esc(c.name)}</h1><p>${esc(desc)}</p><p><b>${members}</b> عضو</p><a href="${esc(target)}">${inv ? "انضم الآن" : "افتح المجتمع"}</a></div></body></html>`);
    return true;
  }

  // v2.60: the 15-minute "communityMetrics" rollup is replaced by the nightly reconciler + live counters (services/cinsights.js)
  ctx.scheduler.every("challengeWinners", 5 * 60e3, () => closeChallenges());
  return { beforePost, identity, channels, computeMetrics, health, closeChallenges, ssr, leaderboard };
};
