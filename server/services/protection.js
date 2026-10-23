/* User Protection (Track 7, phase 33) — extends lib/policy.js (blocks, mutes, guards) and services/safety.js
 * (reports) instead of duplicating them.
 *   1. Advanced block/mute: a block also covers linked accounts (orgs the person owns/administers, the
 *      owners/admins of a blocked org, accounts signed in together in one browser jar). Linked targets live in
 *      users.prefs.blockedLinked (server-only, policy.blocked() honours it) and user_blocks (with their root).
 *      Timed + scoped mutes of words / hashtags / accounts with Arabic-aware matching (protection-core.js).
 *   2. Protection mode: limits replies / DMs / mentions to trusted accounts for N hours; an abuse-wave
 *      heuristic only *suggests* it (or turns it on when the person opted in to auto mode).
 *   3. Who can reply to a post: everyone | followers | mentioned | community.
 *   4. Hidden replies: the post author hides a reply; it stays readable behind a tap; reversible.
 *   5. Help center + support resources (lib/help-center.js), admin-fillable placeholder numbers.
 *   6. Versioned content policies (content_policies), admin drafts → publish, served to clients with a revision.
 *   7. Per-post safety summary feeding the one-tap safety menu (protection-ui.js).
 *   8. 3-step report: category → detail → protective actions, on top of safety.report().
 * Optional env: PROTECTION_WAVE_MIN_EVENTS, PROTECTION_WAVE_MIN_STRANGERS, PROTECTION_WAVE_MIN_TOXIC, PROTECTION_WAVE_WINDOW_MIN. */
const { E, str, oneOf, id, now, sha } = require("../lib/core");
const Core = require("../../protection-core.js");
const HELP = require("../lib/help-center");
const { score: toxicity } = require("../lib/toxicity");

const J = (v) => { if (typeof v !== "string") return v ?? null; try { return JSON.parse(v); } catch { return null; } };
const LINK_LIMIT = 20;
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

module.exports = (ctx) => {
  const { db, bus, rl, realtime } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const admin = (u) => { if (u.role !== "admin") throw E.forbid("للإدارة فقط"); };
  const me = (req) => req.user;
  const userRow = (uid) => db.get("SELECT id, name, handle, avatar, color, account_type, role, prefs, status FROM users WHERE id=$1", [uid]);
  const follows = async (src, dst) => !!(await db.get("SELECT 1 x FROM follows WHERE src=$1 AND dst=$2", [src, dst]));
  const pubUser = (u) => u && ({ id: u.id, name: u.name, handle: u.handle, avatar: u.avatar || null, color: u.color, accountType: u.account_type || "person" });

  /* register the notification kind used for protection suggestions (integrator may move it into notify-lib) */
  try { const NL = require("../lib/notify-lib"); NL.KINDS.protection_suggest ||= { tab: "system", imp: 85, ch: { inapp: 1, push: 1, email: 0 }, v: ["نقترح تشغيل وضع الحماية: نشاط غير معتاد على حسابك"], label: "اقتراحات وضع الحماية", system: 1 }; } catch { }

  /* =================== 1a. linked accounts & blocks =================== */
  /** accounts linked to `uid` within two hops: org control (owner/admin) both ways + account_links */
  async function linkedOf(uid, limit = LINK_LIMIT) {
    const seen = new Set([uid]), out = new Map(); let frontier = [uid];
    for (let depth = 0; depth < 2 && frontier.length && out.size < limit; depth++) {
      const next = [];
      for (const x of frontier) {
        const rows = [
          ...(await db.all("SELECT org AS id FROM org_members WHERE user_id=$1 AND role IN ('owner','admin')", [x])).map(r => [r.id, "org"]),
          ...(await db.all("SELECT user_id AS id FROM org_members WHERE org=$1 AND role IN ('owner','admin')", [x])).map(r => [r.id, "org"]),
          ...(await db.all("SELECT CASE WHEN a=$1 THEN b ELSE a END AS id, source FROM account_links WHERE a=$1 OR b=$1", [x])).map(r => [r.id, r.source || "session"])
        ];
        for (const [lid, src] of rows) if (!seen.has(lid) && out.size < limit) { seen.add(lid); out.set(lid, src); next.push(lid); }
      }
      frontier = next;
    }
    return [...out].map(([lid, source]) => ({ id: lid, source }));
  }
  /** linked accounts of `target` that `owner` may block (never the owner, their own linked accounts or orgs they belong to) */
  async function linkedFor(ownerId, targetId) {
    const mine = new Set([ownerId, ...(await linkedOf(ownerId)).map(x => x.id), ...(await db.all("SELECT org FROM org_members WHERE user_id=$1", [ownerId])).map(r => r.org)]);
    return (await linkedOf(targetId)).filter(x => x.id !== targetId && !mine.has(x.id));
  }
  const sever = async (a, b) => {
    await db.run("DELETE FROM follows WHERE (src=$1 AND dst=$2) OR (src=$2 AND dst=$1)", [a, b]);
    await db.run("DELETE FROM follow_requests WHERE (src=$1 AND dst=$2) OR (src=$2 AND dst=$1)", [a, b]);
  };
  const insBlock = (owner, target, root, source) => db.run("INSERT INTO user_blocks(owner,target,root,source,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [owner, target, root, source, now()]);
  /**
   * Reconcile one person's blocks: prefs.blocked (explicit roots, also written by the legacy /api/me/prefs path)
   * ⇄ user_blocks rows ⇄ prefs.blockedLinked. Roots removed from prefs drop their linked rows; roots added
   * elsewhere are expanded to their linked accounts unless prefs.settings.blockLinked === false.
   */
  async function sync(ownerId, { add = null, remove = null, linked = true } = {}) {
    const u = await userRow(ownerId); if (!u) return null;
    const prefs = { ...(u.prefs || {}) };
    let blocked = (Array.isArray(prefs.blocked) ? prefs.blocked : []).filter(x => typeof x === "string");
    if (add && !blocked.includes(add)) blocked.push(add);
    if (remove) blocked = blocked.filter(x => x !== remove);
    const expand = prefs.settings?.blockLinked !== false;
    const rows = await db.all("SELECT target, root, source FROM user_blocks WHERE owner=$1", [ownerId]);
    const roots = new Set(rows.map(r => r.root));
    for (const root of roots) if (!blocked.includes(root)) await db.run("DELETE FROM user_blocks WHERE owner=$1 AND root=$2", [ownerId, root]);
    const fresh = [];
    for (const b of blocked) {
      if (roots.has(b) && b !== add) continue;
      await insBlock(ownerId, b, b, "direct"); fresh.push(b);
      if (expand && (b !== add || linked)) for (const l of await linkedFor(ownerId, b)) { await insBlock(ownerId, l.id, b, l.source); fresh.push(l.id); }
    }
    for (const t of new Set(fresh)) await sever(ownerId, t);
    const after = await db.all("SELECT DISTINCT target FROM user_blocks WHERE owner=$1 AND target<>root", [ownerId]);
    prefs.blocked = blocked;
    prefs.blockedLinked = after.map(r => r.target).filter(t => !blocked.includes(t));
    await db.run("UPDATE users SET prefs=$1 WHERE id=$2", [prefs, ownerId]);
    rulesCache.delete(ownerId); ctx.cache.del("feed:" + ownerId); ctx.cache.del("card:");
    return prefs;
  }
  async function block(owner, targetId, { linked = true } = {}) {
    if (!targetId || targetId === owner.id) throw E.bad("لا يمكنك حظر نفسك");
    const t = await userRow(targetId); if (!t) throw E.nf();
    if (!linked) await db.run("DELETE FROM user_blocks WHERE owner=$1 AND root=$2 AND target<>root", [owner.id, targetId]);
    await sync(owner.id, { add: targetId, linked });
    const n = (await db.get("SELECT COUNT(*) n FROM user_blocks WHERE owner=$1 AND root=$2 AND target<>root", [owner.id, targetId])).n;
    bus.emit("USER_BLOCKED", { actor: owner.id, target: targetId, linked: n });
    return { ok: true, blocked: targetId, linkedBlocked: n };
  }
  async function unblock(owner, targetId) { await sync(owner.id, { remove: targetId }); return { ok: true }; }
  /** what blocking `targetId` would also cover; session links are counted, never named (privacy) */
  async function preview(owner, targetId) {
    const l = await linkedFor(owner.id, targetId);
    const orgish = l.filter(x => x.source === "org");
    const named = orgish.length ? await db.all(`SELECT id, name, handle, avatar, color, account_type FROM users WHERE id IN (${orgish.map((_, i) => "$" + (i + 1)).join(",")})`, orgish.map(x => x.id)) : [];
    return { linked: l.length, orgs: named.map(pubUser), hidden: l.length - named.length };
  }
  async function listBlocks(owner) {
    await sync(owner.id);
    const rows = await db.all("SELECT b.root, COUNT(*) n FROM user_blocks b WHERE b.owner=$1 GROUP BY b.root", [owner.id]);
    const out = [];
    for (const r of rows) { const u = await userRow(r.root); if (u) out.push({ ...pubUser(u), linkedBlocked: r.n - 1 }); }
    return { blocks: out, linkedTotal: (await userRow(owner.id))?.prefs?.blockedLinked?.length || 0, blockLinked: (await userRow(owner.id))?.prefs?.settings?.blockLinked !== false };
  }
  /** record that two accounts are used together; existing blocks of either are extended to the other */
  async function noteLinked(a, b, source = "session") {
    if (!a || !b || a === b) return false;
    const [x, y] = a < b ? [a, b] : [b, a];
    const r = await db.run("INSERT INTO account_links(a,b,source,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [x, y, source, now()]);
    if (!r.changes) return false;
    const owners = await db.all("SELECT DISTINCT owner FROM user_blocks WHERE target IN ($1,$2)", [x, y]);
    for (const o of owners) {
      const roots = await db.all("SELECT DISTINCT root FROM user_blocks WHERE owner=$1 AND target IN ($2,$3)", [o.owner, x, y]);
      const u = await userRow(o.owner); if (u?.prefs?.settings?.blockLinked === false) continue;
      for (const { root } of roots) for (const l of await linkedFor(o.owner, root)) await insBlock(o.owner, l.id, root, l.source);
      await sync(o.owner);
    }
    return true;
  }
  /** link every account signed in within one browser (session + HttpOnly multi-account jar) */
  async function noteJar(req) {
    const tokens = [req.cookies?.mp_session, ...String(req.cookies?.mp_jar || "").split(".")].filter(t => typeof t === "string" && /^[A-Za-z0-9_-]{20,}$/.test(t)).slice(0, 6);
    const ids = [];
    for (const t of tokens) { const s = await db.get("SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at > $2", [sha(t), now()]); if (s && !ids.includes(s.user_id)) ids.push(s.user_id); }
    let n = 0; for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) if (await noteLinked(ids[i], ids[k], "session")) n++;
    return n;
  }

  /* =================== 1b. timed / scoped mutes =================== */
  const rulesCache = new Map();
  async function rulesFor(uid) {
    // stored rules are cached briefly; legacy prefs (mutedWords, muted.users/hashtags) are read fresh every time
    let c = rulesCache.get(uid);
    if (!c || Date.now() - c.t > 15e3) {
      const rows = await db.all("SELECT id, kind, value, scope, whole_word, expires_at, created_at FROM mute_rules WHERE owner=$1 AND (expires_at IS NULL OR expires_at > $2) ORDER BY created_at DESC", [uid, now()]);
      c = { t: Date.now(), rows: rows.map(r => ({ id: r.id, kind: r.kind, value: r.value, scope: r.scope, wholeWord: !!r.whole_word, expiresAt: r.expires_at || null, createdAt: r.created_at })) };
      rulesCache.set(uid, c);
    }
    const u = await userRow(uid), p = u?.prefs || {};
    const rules = c.rows.filter(r => Core.active(r));
    for (const w of p.mutedWords || []) if (typeof w === "string" && !rules.some(r => r.kind === "word" && r.value === w)) rules.push({ id: null, kind: "word", value: w, scope: "all", wholeWord: false, expiresAt: null, legacy: true });
    for (const m of p.muted?.users || []) if (typeof m === "string" && !rules.some(r => r.kind === "user" && r.value === m)) rules.push({ id: null, kind: "user", value: m, scope: "all", wholeWord: false, expiresAt: null, legacy: true });
    for (const h of p.muted?.hashtags || []) if (typeof h === "string") rules.push({ id: null, kind: "hashtag", value: h, scope: "feed", wholeWord: false, expiresAt: null, legacy: true });
    return rules;
  }
  async function addMute(user, b) {
    const kind = oneOf(b.kind, Core.KINDS, null); if (!kind) throw E.bad("نوع الكتم غير صالح");
    let value = str(b.value, kind === "user" ? 40 : 60, { required: true });
    if (kind === "hashtag") value = value.replace(/^#/, "");
    if (kind === "user") { if (value === user.id || !(await db.get("SELECT 1 x FROM users WHERE id=$1", [value]))) throw E.bad(); }
    const scope = oneOf(b.scope, Core.SCOPES, "all"), dur = oneOf(b.duration, Object.keys(Core.DURATIONS), "forever");
    if ((await db.get("SELECT COUNT(*) n FROM mute_rules WHERE owner=$1", [user.id])).n >= 300) throw E.bad("وصلت للحد الأقصى من قواعد الكتم");
    const rid = id("mt"), exp = Core.expiryFor(dur);
    await db.run(`INSERT INTO mute_rules(id,owner,kind,value,scope,whole_word,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(owner,kind,value) DO UPDATE SET scope=excluded.scope, whole_word=excluded.whole_word, expires_at=excluded.expires_at`, [rid, user.id, kind, value, scope, b.wholeWord ? 1 : 0, exp, now()]);
    rulesCache.delete(user.id); ctx.cache.del("feed:" + user.id);
    const row = await db.get("SELECT id, kind, value, scope, whole_word, expires_at FROM mute_rules WHERE owner=$1 AND kind=$2 AND value=$3", [user.id, kind, value]);
    return { mute: { id: row.id, kind: row.kind, value: row.value, scope: row.scope, wholeWord: !!row.whole_word, expiresAt: row.expires_at || null } };
  }
  /** does `uid` mute this item in `scope`? item = { text, author } */
  async function isMuted(uid, item, scope = "feed") { return Core.muteHit(item, await rulesFor(uid), scope); }
  /** filter rows ({ text, title, author }) for a viewer — for feed / search / comments integration */
  async function filterMuted(rows, uid, scope = "feed") {
    if (!uid || !rows?.length) return rows || [];
    const rules = await rulesFor(uid); if (!rules.length) return rows;
    return rows.filter(r => !Core.muteHit({ text: [r.title, r.text].filter(Boolean).join(" "), author: r.author }, rules, scope));
  }

  /* =================== 2. protection mode =================== */
  const modeCache = new Map();
  const shapeMode = (r) => {
    const s = { replies: true, dms: true, mentions: true, auto: false, ...(J(r?.settings) || {}) };
    const on = !!r?.active && !!r.ends_at && new Date(r.ends_at).getTime() > Date.now();
    return { active: on, startedAt: on ? r.started_at : null, endsAt: on ? r.ends_at : null, limits: { replies: !!s.replies, dms: !!s.dms, mentions: !!s.mentions }, auto: !!s.auto, reason: on ? r.reason || "manual" : null,
      suggestion: r?.suggested_at && !on && !(r.dismissed_at && new Date(r.dismissed_at) >= new Date(r.suggested_at)) ? { at: r.suggested_at, ...(J(r.suggestion) || {}) } : null };
  };
  async function getMode(uid) {
    const c = modeCache.get(uid); if (c && Date.now() - c.t < 5e3) return c.m;
    const m = shapeMode(await db.get("SELECT * FROM protection_modes WHERE user_id=$1", [uid]));
    modeCache.set(uid, { t: Date.now(), m }); return m;
  }
  async function upsertMode(uid, fields) {
    const cur = await db.get("SELECT * FROM protection_modes WHERE user_id=$1", [uid]);
    const row = { active: 0, started_at: null, ends_at: null, settings: { replies: true, dms: true, mentions: true, auto: false }, reason: null, suggested_at: null, suggestion: null, dismissed_at: null, ...(cur ? { ...cur, settings: J(cur.settings) || {}, suggestion: J(cur.suggestion) } : {}), ...fields };
    await db.run(`INSERT INTO protection_modes(user_id,active,started_at,ends_at,settings,reason,suggested_at,suggestion,dismissed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(user_id) DO UPDATE SET active=excluded.active, started_at=excluded.started_at, ends_at=excluded.ends_at, settings=excluded.settings, reason=excluded.reason, suggested_at=excluded.suggested_at, suggestion=excluded.suggestion, dismissed_at=excluded.dismissed_at, updated_at=excluded.updated_at`,
      [uid, row.active ? 1 : 0, row.started_at, row.ends_at, JSON.stringify(row.settings || {}), row.reason, row.suggested_at, row.suggestion ? JSON.stringify(row.suggestion) : null, row.dismissed_at, now()]);
    modeCache.delete(uid);
    return getMode(uid);
  }
  async function setMode(user, b) {
    const cur = await db.get("SELECT settings FROM protection_modes WHERE user_id=$1", [user.id]);
    const s = { replies: true, dms: true, mentions: true, auto: false, ...(J(cur?.settings) || {}) };
    if (b.limits && typeof b.limits === "object") for (const k of Core.LIMITS) if (b.limits[k] !== undefined) s[k] = !!b.limits[k];
    if (b.auto !== undefined) s.auto = !!b.auto;
    if (b.active === undefined) return upsertMode(user.id, { settings: s });
    if (!b.active) { const m = await upsertMode(user.id, { active: 0, ends_at: now(), settings: s }); bus.emit("PROTECTION_MODE_CHANGED", { user: user.id, active: false }); return m; }
    const hours = Math.max(1, Math.min(168, Math.round(+b.hours || 24)));
    const at = Date.now();
    const m = await upsertMode(user.id, { active: 1, started_at: new Date(at).toISOString(), ends_at: new Date(at + hours * 3600e3).toISOString(), settings: s, reason: b.reason === "suggested" ? "suggested" : "manual", dismissed_at: now() });
    bus.emit("PROTECTION_MODE_CHANGED", { user: user.id, active: true, hours });
    return m;
  }
  /** may `actorId` reach `ownerId` while protection mode is on? */
  async function trusted(ownerId, actorId, startedAt) {
    const f = await db.get("SELECT at FROM follows WHERE src=$1 AND dst=$2", [actorId, ownerId]);
    return Core.trustedDuringProtection({ ownerFollows: await follows(ownerId, actorId), followedAt: f?.at || null, startedAt });
  }
  /** policy guard (see lib/policy.js addGuard): protection mode limits comments / mentions / dm */
  async function guard(actorId, target, key) {
    const limit = Core.limitFor(key); if (!limit || !target?.id) return true;
    const m = await getMode(target.id); if (!m.active || !m.limits[limit]) return true;
    return trusted(target.id, actorId, m.startedAt);
  }
  if (typeof ctx.policy?.addGuard === "function") ctx.policy.addGuard(guard);

  /* abuse-wave heuristic → suggestion (in-process sliding window; per instance) */
  const env = process.env;
  const waveCfg = () => ({ ...(env.PROTECTION_WAVE_MIN_EVENTS ? { minEvents: +env.PROTECTION_WAVE_MIN_EVENTS } : {}), ...(env.PROTECTION_WAVE_MIN_STRANGERS ? { minStrangers: +env.PROTECTION_WAVE_MIN_STRANGERS } : {}),
    ...(env.PROTECTION_WAVE_MIN_TOXIC ? { minToxicActors: +env.PROTECTION_WAVE_MIN_TOXIC } : {}), ...(env.PROTECTION_WAVE_WINDOW_MIN ? { windowMs: +env.PROTECTION_WAVE_WINDOW_MIN * 60e3 } : {}), ...(ctx.config.protectionWave || {}) });
  const windows = new Map();
  async function noteIncoming(target, actor, text) {
    if (!target || !actor || target === actor) return null;
    const cfg = { ...Core.WAVE, ...waveCfg() };
    const stranger = !(await trusted(target, actor, new Date(Date.now() - 864e5).toISOString()));
    const ev = { at: Date.now(), actor, stranger, toxic: text ? toxicity(text).score : 0 };
    const arr = (windows.get(target) || []).filter(e => ev.at - e.at <= cfg.windowMs); arr.push(ev); windows.set(target, arr.slice(-500));
    if (windows.size > 20000) windows.delete(windows.keys().next().value);
    const res = Core.detectWave(arr, cfg);
    if (res.wave) await maybeSuggest(target, res);
    return res;
  }
  async function maybeSuggest(uid, res) {
    const r = await db.get("SELECT * FROM protection_modes WHERE user_id=$1", [uid]); const m = shapeMode(r);
    if (m.active) return;
    const t = Date.now();
    if (r?.suggested_at && t - new Date(r.suggested_at).getTime() < 12 * 3600e3) return;
    if (r?.dismissed_at && t - new Date(r.dismissed_at).getTime() < 24 * 3600e3) return;
    const suggestion = { reasons: res.reasons, strangers: res.strangers, toxicActors: res.toxicActors, events: res.events, score: res.score };
    if (m.auto) {
      await upsertMode(uid, { active: 1, started_at: new Date(t).toISOString(), ends_at: new Date(t + 24 * 3600e3).toISOString(), reason: "auto", suggested_at: new Date(t).toISOString(), suggestion });
      bus.emit("PROTECTION_MODE_CHANGED", { user: uid, active: true, hours: 24, auto: true });
    } else await upsertMode(uid, { suggested_at: new Date(t).toISOString(), suggestion });
    realtime?.send(uid, "protection_suggest", { auto: m.auto, ...suggestion });
    await ctx.services.messaging?.notify(uid, "protection_suggest", { actor: null, ref: "protection" }).catch(() => { });
    await ctx.audit("PROTECTION_SUGGESTED", uid, `${res.reasons.join(",")} strangers=${res.strangers} toxic=${res.toxicActors}`, "system");
  }
  bus.on("COMMENT_CREATED", async e => { const c = await db.get("SELECT text FROM comments WHERE id=$1", [e.comment]); await noteIncoming(e.postAuthor, e.actor, c?.text); if (e.parentAuthor && e.parentAuthor !== e.postAuthor) await noteIncoming(e.parentAuthor, e.actor, c?.text); });
  bus.on("USER_MENTIONED", async e => { const p = e.post ? await db.get("SELECT text FROM posts WHERE id=$1", [e.post]) : null; await noteIncoming(e.user, e.actor, p?.text); });
  bus.on("MESSAGE_RECEIVED", async e => { if (e.group) return; for (const to of [].concat(e.request || [])) await noteIncoming(to, e.from || e.actor, e.preview); });
  bus.on("PREFS_UPDATED", e => e?.user ? sync(e.user).catch(() => { }) : null); // emitted by users.setPrefs (see INTEGRATION.md)

  /* =================== 3. who can reply =================== */
  async function audienceOf(pid) { return (await db.get("SELECT audience FROM reply_settings WHERE post=$1", [pid]))?.audience || "everyone"; }
  async function replyFacts(user, post) {
    const handle = user.handle || (await db.get("SELECT handle FROM users WHERE id=$1", [user.id]))?.handle;
    const mentioned = !!handle && (String(post.text || "").match(/@([a-zA-Z0-9_]{2,30})/g) || []).some(m => m.slice(1).toLowerCase() === handle.toLowerCase());
    const member = post.community ? !!(await db.get("SELECT 1 x FROM memberships WHERE community=$1 AND user_id=$2 AND role NOT IN ('pending','banned')", [post.community, user.id])) : false;
    return { actor: user.id, author: post.author, followsAuthor: await follows(user.id, post.author), authorFollows: await follows(post.author, user.id), mentioned, member, hasCommunity: !!post.community };
  }
  async function canReplyTo(user, post) {
    const audience = await audienceOf(post.id); if (audience === "everyone" || user.id === post.author) return { allowed: true, audience };
    return { allowed: Core.canReply({ audience, ...(await replyFacts(user, post)) }), audience };
  }
  /** called by content.comment() before inserting (see INTEGRATION.md) */
  async function checkReply(user, post) {
    if (!post) return;
    if (!(await canReplyTo(user, post)).allowed) throw E.forbid("حدّد صاحب المنشور من يمكنه الرد");
  }
  async function setAudience(user, pid, audience) {
    const p = await db.get("SELECT id, author, community FROM posts WHERE id=$1", [pid]); if (!p) throw E.nf();
    if (p.author !== user.id) throw E.forbid();
    audience = oneOf(audience, Core.AUDIENCES, null); if (!audience) throw E.bad();
    if (audience === "community" && !p.community) throw E.bad("المنشور ليس في مجتمع");
    await db.run("INSERT INTO reply_settings(post,audience,set_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(post) DO UPDATE SET audience=excluded.audience, set_by=excluded.set_by, updated_at=excluded.updated_at", [pid, audience, user.id, now()]);
    bus.emit("REPLY_AUDIENCE_CHANGED", { post: pid, audience, actor: user.id });
    return { audience };
  }

  /* =================== 4. hidden replies =================== */
  async function commentWithPost(cid) { return db.get("SELECT c.id, c.post, c.author, p.author AS post_author FROM comments c JOIN posts p ON p.id=c.post WHERE c.id=$1", [cid]); }
  async function hideReply(user, cid, hide = true) {
    const c = await commentWithPost(cid); if (!c) throw E.nf();
    if (c.post_author !== user.id && user.role !== "admin") throw E.forbid("إخفاء الردود لصاحب المنشور فقط");
    if (hide) await db.run("INSERT INTO hidden_replies(comment,post,hidden_by,at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [c.id, c.post, user.id, now()]);
    else await db.run("DELETE FROM hidden_replies WHERE comment=$1", [c.id]);
    bus.emit(hide ? "REPLY_HIDDEN" : "REPLY_UNHIDDEN", { comment: c.id, post: c.post, actor: user.id });
    return { ok: true, hidden: hide };
  }
  const hiddenOf = async (pid) => (await db.all("SELECT comment FROM hidden_replies WHERE post=$1", [pid])).map(r => r.comment);
  async function visiblePost(viewer, pid) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!p || !(await ctx.services.content.canSee(p, viewer?.id))) throw E.nf();
    return p;
  }

  /* =================== notification suppression (called by notify.notify, see INTEGRATION.md) =================== */
  async function suppressNotify(userId, kind, { actor = null, post = null, ref = null } = {}) {
    if (!userId || !actor) return false;
    const u = await userRow(userId); if (!u) return false;
    if ((u.prefs?.blockedLinked || []).includes(actor)) return "blocked";
    const rules = await rulesFor(userId);
    if (Core.muteHit({ author: actor }, rules, "notifications")) return "muted";
    if (["comment", "reply", "mention"].includes(kind)) {
      // comment notifications carry only the post: use the actor's newest comment there (notify runs right after it)
      const c = ref ? await db.get("SELECT text FROM comments WHERE id=$1", [ref])
        : kind !== "mention" && post ? await db.get("SELECT text FROM comments WHERE post=$1 AND author=$2 ORDER BY created_at DESC LIMIT 1", [post, actor]) : null;
      const text = c?.text || (post ? (await db.get("SELECT text FROM posts WHERE id=$1", [post]))?.text : null);
      if (text && Core.muteHit({ text }, rules, "notifications")) return "muted";
      if (ref && (await db.get("SELECT 1 x FROM hidden_replies WHERE comment=$1", [ref]))) return "hidden";
    }
    const limit = { comment: "replies", reply: "replies", mention: "mentions", message: "dms", message_request: "dms", call: "dms" }[kind];
    if (limit) { const m = await getMode(userId); if (m.active && m.limits[limit] && !(await trusted(userId, actor, m.startedAt))) return "protection"; }
    return false;
  }

  /* =================== 5. help center =================== */
  async function resources() {
    const rows = await db.all("SELECT key, meta, updated_at FROM safety_settings WHERE key LIKE 'resource:%'");
    const over = Object.fromEntries(rows.map(r => [r.key.slice(9), { ...(J(r.meta) || {}), updatedAt: r.updated_at }]));
    return HELP.RESOURCES.map(r => { const o = over[r.key]; if (!o) return { ...r }; const phone = o.phone !== undefined ? o.phone : r.phone, url = o.url !== undefined ? o.url : r.url; return { ...r, ...o, phone, url, verified: !!(phone || url) && (o.verified ?? true), placeholder: !(phone || url), source: o.source || r.source }; });
  }
  async function setResource(user, key, b) {
    admin(user);
    if (!HELP.RESOURCES.some(r => r.key === key)) throw E.nf();
    const phone = b.phone === null || b.phone === "" ? null : str(b.phone, 20);
    if (phone && !/^[0-9+\- ]{3,20}$/.test(phone)) throw E.bad("رقم غير صالح");
    const url = b.url === null || b.url === "" ? null : str(b.url, 300);
    if (url && !/^(https:\/\/|#\/)/.test(url)) throw E.bad("رابط غير صالح");
    const meta = { phone, url, hours: str(b.hours, 60), source: str(b.source, 300), verified: !!(phone || url), verifiedBy: user.id };
    await db.run("INSERT INTO safety_settings(key,meta,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET meta=excluded.meta, updated_by=excluded.updated_by, updated_at=excluded.updated_at", ["resource:" + key, JSON.stringify(meta), user.id, now()]);
    await ctx.audit("HELP_RESOURCE_UPDATED", key, phone || url || "cleared", user.id);
    return { resource: (await resources()).find(r => r.key === key) };
  }

  /* =================== 6. versioned content policies =================== */
  let seeded = null;
  const ensurePolicies = () => (seeded ||= (async () => {
    if ((await db.get("SELECT COUNT(*) n FROM content_policies")).n) return;
    const at = now();
    for (const p of HELP.DEFAULT_POLICIES) await db.run("INSERT INTO content_policies(id,slug,version,title,summary,body,status,changelog,created_by,created_at,published_at) VALUES($1,$2,1,$3,$4,$5,'published',$6,NULL,$7,$7) ON CONFLICT DO NOTHING", [id("pl"), p.slug, p.title, p.summary, p.body, "الإصدار الأول", at]);
  })().catch(e => { seeded = null; throw e; }));
  const shapePolicy = (r, full) => r && ({ slug: r.slug, version: r.version, title: r.title, summary: r.summary || "", status: r.status, publishedAt: r.published_at || null, changelog: r.changelog || null, ...(full ? { body: r.body, createdAt: r.created_at } : {}) });
  async function policies(since) {
    await ensurePolicies();
    const rows = await db.all("SELECT slug, version, title, summary, status, published_at, changelog FROM content_policies WHERE status='published' ORDER BY slug");
    const revision = sha(rows.map(r => r.slug + "@" + r.version).join("|")).slice(0, 12);
    if (since && since === revision) return { revision, unchanged: true };
    return { revision, policies: rows.map(r => shapePolicy(r)) };
  }
  async function policy(viewer, slug, version) {
    await ensurePolicies();
    const isAdmin = viewer?.role === "admin";
    const r = version ? await db.get(`SELECT * FROM content_policies WHERE slug=$1 AND version=$2${isAdmin ? "" : " AND status<>'draft'"}`, [slug, +version])
      : await db.get("SELECT * FROM content_policies WHERE slug=$1 AND status='published' ORDER BY version DESC LIMIT 1", [slug]);
    if (!r) throw E.nf();
    const versions = (await db.all(`SELECT version, status, published_at, changelog FROM content_policies WHERE slug=$1${isAdmin ? "" : " AND status<>'draft'"} ORDER BY version DESC`, [slug])).map(v => ({ version: v.version, status: v.status, publishedAt: v.published_at || null, changelog: v.changelog || null }));
    return { policy: shapePolicy(r, true), versions };
  }
  async function draftPolicy(user, b) {
    admin(user); await ensurePolicies();
    const slug = str(b.slug, 40, { required: true }); if (!SLUG.test(slug)) throw E.bad("معرّف السياسة: حروف إنجليزية صغيرة وأرقام و -");
    const title = str(b.title, 120, { required: true, min: 2 }), body = str(b.body, 60000, { required: true, min: 10 });
    const last = await db.get("SELECT MAX(version) v FROM content_policies WHERE slug=$1", [slug]);
    const version = (last?.v || 0) + 1, pid = id("pl");
    await db.run("INSERT INTO content_policies(id,slug,version,title,summary,body,status,changelog,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9)", [pid, slug, version, title, str(b.summary, 300), body, str(b.changelog, 500), user.id, now()]);
    await ctx.audit("POLICY_DRAFTED", `${slug}@${version}`, title, user.id);
    return { policy: shapePolicy(await db.get("SELECT * FROM content_policies WHERE id=$1", [pid]), true) };
  }
  async function publishPolicy(user, slug, version) {
    admin(user); await ensurePolicies();
    const r = await db.get("SELECT * FROM content_policies WHERE slug=$1 AND version=$2", [slug, +version]); if (!r) throw E.nf();
    if (r.status === "published") return { policy: shapePolicy(r, true) };
    await db.tx(async t => {
      await t.run("UPDATE content_policies SET status='archived' WHERE slug=$1 AND status='published'", [slug]);
      await t.run("UPDATE content_policies SET status='published', published_at=$1 WHERE id=$2", [now(), r.id]);
    });
    await ctx.audit("POLICY_PUBLISHED", `${slug}@${r.version}`, r.changelog || null, user.id);
    bus.emit("POLICY_UPDATED", { slug, version: r.version, actor: user.id });
    realtime?.broadcast("policy_updated", { slug, version: r.version, title: r.title });
    return { policy: shapePolicy(await db.get("SELECT * FROM content_policies WHERE id=$1", [r.id]), true) };
  }

  /* =================== 7. per-post safety summary (one-tap menu) =================== */
  async function postSafety(viewer, pid) {
    const p = await visiblePost(viewer, pid);
    const author = await userRow(p.author);
    const audience = await audienceOf(pid);
    const isAuthor = p.author === viewer.id;
    const rules = await rulesFor(viewer.id);
    const vp = (await userRow(viewer.id))?.prefs || {};
    return {
      post: pid, isAuthor, author: pubUser(author), audience, audienceLabel: Core.AUDIENCE_LABELS[audience], hasCommunity: !!p.community,
      canReply: isAuthor || (await canReplyTo(viewer, p)).allowed, hidden: await hiddenOf(pid),
      authorBlocked: (vp.blocked || []).includes(p.author) || (vp.blockedLinked || []).includes(p.author),
      authorMuted: rules.filter(r => r.kind === "user" && r.value === p.author).map(r => ({ id: r.id, scope: r.scope, expiresAt: r.expiresAt })),
      linkedPreview: isAuthor ? null : await preview(viewer, p.author), protection: await getMode(viewer.id)
    };
  }

  /* =================== 8. 3-step report =================== */
  async function report3(user, b) {
    const kind = oneOf(b.kind, Core.REPORT_KINDS, null); if (!kind) throw E.bad();
    const target = str(b.target, 60, { required: true });
    const r = Core.reportReason(b.category, b.subcategory); if (!r) throw E.bad("اختر سبب البلاغ");
    const details = str(b.details, 1000);
    if (typeof ctx.services.safety?.report !== "function") throw E.off("خدمة البلاغات غير متاحة");
    const { id: rid } = await ctx.services.safety.report(user, { target, kind, reason: r.reason });
    let author = null, postAuthor = null;
    if (kind === "post") author = (await db.get("SELECT author FROM posts WHERE id=$1", [target]))?.author;
    else if (kind === "comment") { const c = await commentWithPost(target); author = c?.author; postAuthor = c?.post_author; }
    else if (kind === "user") author = (await db.get("SELECT id FROM users WHERE id=$1", [target]))?.id;
    const done = [];
    if (author && author !== user.id) {
      if (b.block) { await block(user, author, { linked: b.blockLinked !== false }); done.push("block"); }
      else if (b.mute) { await addMute(user, { kind: "user", value: author, duration: oneOf(b.muteDuration, Object.keys(Core.DURATIONS), "forever") }); done.push("mute"); }
    }
    if (b.hide && kind === "comment" && postAuthor === user.id) { await hideReply(user, target, true); done.push("hide"); }
    await db.run("INSERT INTO report_details(report,category,subcategory,details,meta,created_at) VALUES($1,$2,$3,$4,$5,$6)", [rid, r.category, r.subcategory, details, JSON.stringify({ priority: r.priority, urgent: r.urgent, actions: done }), now()]);
    if (r.urgent) bus.emit("REPORT_PRIORITY", { report: rid, target, category: r.category, subcategory: r.subcategory });
    return { id: rid, priority: r.priority, actions: done, help: r.help ? { disclaimer: HELP.DISCLAIMER, resources: (await resources()).filter(x => ["emergency", "mental"].includes(x.category)) } : null };
  }
  async function adminReports(user) {
    admin(user);
    const rows = await db.all("SELECT r.id, r.target, r.kind, r.reason, r.created_at, d.category, d.subcategory, d.details, d.meta FROM reports r LEFT JOIN report_details d ON d.report=r.id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 200");
    return { reports: rows.map(x => ({ id: x.id, target: x.target, kind: x.kind, reason: x.reason, createdAt: x.created_at, category: x.category || null, subcategory: x.subcategory || null, details: x.details || null, priority: J(x.meta)?.priority || 0 })).sort((a, b) => b.priority - a.priority) };
  }

  /* =================== routes =================== */
  R.get("/api/protection", A(async (req) => ({ mode: await getMode(me(req).id), mutes: await rulesFor(me(req).id), ...(await listBlocks(me(req))) })));
  R.get("/api/protection/blocks", A(async (req) => listBlocks(me(req))));
  R.get("/api/protection/blocks/:id/preview", A(async (req) => preview(me(req), req.params.id)));
  R.put("/api/protection/blocks/:id", A(async (req) => block(me(req), req.params.id, { linked: req.body.linked !== false })));
  R.del("/api/protection/blocks/:id", A(async (req) => unblock(me(req), req.params.id)));
  R.put("/api/protection/settings", A(async (req) => {
    const u = await userRow(me(req).id), prefs = { ...(u.prefs || {}) };
    if (req.body.blockLinked !== undefined) prefs.settings = { ...(prefs.settings || {}), blockLinked: !!req.body.blockLinked };
    await db.run("UPDATE users SET prefs=$1 WHERE id=$2", [prefs, u.id]); await sync(u.id);
    return { blockLinked: prefs.settings?.blockLinked !== false };
  }));
  R.get("/api/protection/mutes", A(async (req) => ({ mutes: await rulesFor(me(req).id) })));
  R.post("/api/protection/mutes", A(async (req) => { if (!rl.hit("mute", me(req).id)) throw E.rate(); return addMute(me(req), req.body); }));
  R.del("/api/protection/mutes/:id", A(async (req) => { await db.run("DELETE FROM mute_rules WHERE id=$1 AND owner=$2", [req.params.id, me(req).id]); rulesCache.delete(me(req).id); ctx.cache.del("feed:" + me(req).id); return { ok: true }; }));
  R.get("/api/protection/mode", A(async (req) => ({ mode: await getMode(me(req).id) })));
  R.put("/api/protection/mode", A(async (req) => ({ mode: await setMode(me(req), req.body) })));
  R.post("/api/protection/mode/dismiss", A(async (req) => ({ mode: await upsertMode(me(req).id, { dismissed_at: now() }) })));
  R.get("/api/posts/:id/reply-settings", async (req) => { const p = await visiblePost(req.user, req.params.id); const audience = await audienceOf(p.id); return { audience, label: Core.AUDIENCE_LABELS[audience], canReply: req.user ? (await canReplyTo(req.user, p)).allowed : false }; });
  R.put("/api/posts/:id/reply-settings", A(async (req) => setAudience(me(req), req.params.id, req.body.audience)));
  R.get("/api/posts/:id/hidden-replies", async (req) => { const p = await visiblePost(req.user, req.params.id); return { hidden: await hiddenOf(p.id), canHide: !!req.user && (req.user.id === p.author || req.user.role === "admin") }; });
  R.put("/api/comments/:id/hidden", A(async (req) => hideReply(me(req), req.params.id, true)));
  R.del("/api/comments/:id/hidden", A(async (req) => hideReply(me(req), req.params.id, false)));
  R.get("/api/posts/:id/safety", A(async (req) => postSafety(me(req), req.params.id)));
  R.get("/api/protection/report-options", async () => ({ categories: Core.REPORT.map(c => ({ key: c.key, label: c.label, hint: c.hint, help: !!c.help, subs: c.subs.map(s => ({ key: s[0], label: s[1], urgent: !!s[2] })) })) }));
  R.post("/api/protection/reports", A(async (req) => report3(me(req), req.body)));
  R.get("/api/admin/protection/reports", A(async (req) => adminReports(req.user)));
  R.get("/api/help", async () => ({ disclaimer: HELP.DISCLAIMER, categories: HELP.CATEGORIES, resources: await resources(), articles: HELP.ARTICLES.map(a => ({ slug: a.slug, title: a.title, summary: a.summary, topic: a.topic })) }));
  R.get("/api/help/articles/:slug", async (req) => { const a = HELP.ARTICLES.find(x => x.slug === req.params.slug); if (!a) throw E.nf(); return { article: a, disclaimer: HELP.DISCLAIMER }; });
  R.get("/api/admin/help/resources", A(async (req) => { admin(req.user); return { resources: await resources() }; }));
  R.put("/api/admin/help/resources/:key", A(async (req) => setResource(req.user, req.params.key, req.body)));
  R.get("/api/policies", async (req) => policies(req.query.since));
  R.get("/api/policies/:slug", async (req) => policy(req.user, req.params.slug, req.query.version));
  R.post("/api/admin/policies", A(async (req) => draftPolicy(req.user, req.body)));
  R.post("/api/admin/policies/:slug/publish", A(async (req) => publishPolicy(req.user, req.params.slug, req.body.version)));

  ensurePolicies().catch(() => { });
  return { block, unblock, sync, linkedOf, linkedFor, noteLinked, noteJar, rulesFor, isMuted, filterMuted, addMute, getMode, setMode, guard, noteIncoming,
    audienceOf, canReplyTo, checkReply, setAudience, hideReply, hiddenOf, suppressNotify, resources, policies, report: report3 };
};
