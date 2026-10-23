/* Community insights, events and member notifications (v2.60.0, «المجتمع 3.0» stage 5 — «التحليلات والنمو والتكاملات
 * والإشعارات»).
 *  • Incremental daily counters: POST_PUBLISHED, COMMENT_CREATED, POST_REACTED, POST_VIEWED, member events (join / approve /
 *    leave / ban / remove) and the community log (human moderation + automod catches) upsert TODAY's community_metrics row
 *    the moment they happen; who was active today goes to community_daily_actives (→ active_users without a scan).
 *  • computeMetrics() is now the RECONCILER: run nightly for the previous UTC day (and on demand for any day), it rewrites
 *    the row from the source tables, so a missed or double hook is repaired. It only visits communities that had activity
 *    that day (or already have a row to correct) instead of every community every 15 minutes.
 *  • GET /api/communities/:id/insights?days=7|30|90 — growth, engagement, DAU/WAU/MAU + stickiness, weekly cohorts,
 *    top posts / contributors / channels, best time to post (hour × weekday in the community's time zone), the invite
 *    funnel, moderation health and the health card. GET …/insights/export → CSV: aggregates for the team; the member
 *    columns (top contributors' handles, post authors) only for the OWNER.
 *  • Events section: GET …/events/manage (upcoming | past, attendance, capacity, waitlist) and the community calendar
 *    /c/:id/events.ics (public communities only); the default reminders (community setting eventReminders).
 *  • Member notifications per community: GET/PUT /api/communities/:id/notify — all | highlights (announcements and mentions)
 *    | muted, a daily digest, a timed mute. notify.js asks suppressNotify() before it writes a community notification;
 *    personal notices (approvals, decisions, warnings, removals, event reminders) are never suppressed. The admin's default
 *    for NEW members (setting notifyDefault) is applied when they join.
 * Nothing here deletes or rewrites community content; every number is recomputable from the source tables. */
const { E, oneOf, now } = require("../lib/core");
const DAY = 864e5;
const COLS = ["posts", "comments", "reactions", "new_members", "left_members", "views", "questions", "answered", "invite_joins", "mod_actions", "automod_caught"];
const HUMAN_MOD = ["approve", "reject", "remove", "dismiss", "warn", "mute", "unmute", "ban", "unban"];
const AUTOMOD = ["automod_queue", "automod_reject", "automod_flag"];
const JOIN_K = ["join", "approve"], LEAVE_K = ["leave", "ban", "remove"];
/* notifications: personal notices always reach the member; highlights = announcements + mentions */
const PERSONAL = new Set(["approved", "invite", "mod_warning", "mod_digest", "removed", "post_approved", "challenge_won", "join_request", "event", "event_1h", "event_24h", "partner_request", "autoguard_strike", "autoguard_lock"]);
const HIGHLIGHT = new Set(["community_announcement", "mention"]);
const BY_REF = new Set(["community_welcome", "community_announcement", "community_digest"]);
const BY_POST = new Set(["reaction", "comment", "reply", "mention"]);
const LEVELS = ["all", "highlights", "muted"];
const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

module.exports = (ctx) => {
  const { db, router: R, bus } = ctx; const A = ctx.requireUser; const P = ctx.cperm;
  const today = () => now().slice(0, 10);
  const dayOf = (v) => { const d = v instanceof Date ? v : new Date(v || Date.now()); return isNaN(+d) ? today() : d.toISOString().slice(0, 10); };
  const span = (day) => { const from = day + "T00:00:00.000Z"; return [from, new Date(+new Date(from) + DAY).toISOString()]; };
  const n = async (sql, a) => Number((await db.get(sql, a))?.n || 0);
  const getC = async (cid) => { const c = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf(); return c; };
  const safe = (fn) => async (e) => { try { await fn(e); } catch (err) { require("../lib/log").log.warn?.("insights hook failed", { err: err?.message }); } };

  /* ======================= incremental counters (today only; the reconciler owns the past) ======================= */
  async function bump(cid, day, col, by = 1) {
    if (!cid || !COLS.includes(col) || day !== today()) return;
    await db.run(`INSERT INTO community_metrics(community,day,${col}) VALUES($1,$2,$3) ON CONFLICT (community,day) DO UPDATE SET ${col}=CASE WHEN community_metrics.${col}+$4 < 0 THEN 0 ELSE community_metrics.${col}+$4 END`, [cid, day, Math.max(0, by), by]);
  }
  async function active(cid, uid, day) {
    if (!cid || !uid || day !== today()) return;
    const r = await db.run("INSERT INTO community_daily_actives(community,day,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [cid, day, uid]);
    if (r.changes) await db.run("INSERT INTO community_metrics(community,day,active_users) VALUES($1,$2,1) ON CONFLICT (community,day) DO UPDATE SET active_users=(SELECT COUNT(*) FROM community_daily_actives WHERE community=$1 AND day=$2)", [cid, day]);
  }
  /** after content goes: is this person still active in the community today? (else they leave today's active set) */
  async function recheckActive(cid, uid, day) {
    if (day !== today()) return; const [f, t] = span(day);
    const still = await db.get(`SELECT 1 x FROM posts WHERE community=$1 AND author=$2 AND status='published' AND created_at >= $3 AND created_at < $4
      UNION SELECT 1 x FROM comments c JOIN posts p ON p.id=c.post WHERE p.community=$1 AND c.author=$2 AND c.status='published' AND c.created_at >= $3 AND c.created_at < $4
      UNION SELECT 1 x FROM reactions r JOIN posts p ON p.id=r.target WHERE p.community=$1 AND r.user_id=$2 AND r.at >= $3 AND r.at < $4`, [cid, uid, f, t]);
    if (still) return;
    const r = await db.run("DELETE FROM community_daily_actives WHERE community=$1 AND day=$2 AND user_id=$3", [cid, day, uid]);
    if (r.changes) await db.run("UPDATE community_metrics SET active_users=(SELECT COUNT(*) FROM community_daily_actives WHERE community=$1 AND day=$2) WHERE community=$1 AND day=$2", [cid, day]);
  }
  const counted = new Map(); // post id → { cid, day, question, author } for posts counted today (a delete takes them back out)
  const once = new Set();
  const remember = (k) => { if (once.has(k)) return false; once.add(k); if (once.size > 20000) once.delete(once.values().next().value); return true; };
  bus.on("POST_PUBLISHED", safe(async (e) => {
    const p = e?.post?.id ? await db.get("SELECT id, community, author, type, status, created_at FROM posts WHERE id=$1", [e.post.id]) : null;
    if (!p?.community || p.status !== "published" || !remember("p:" + p.id)) return;
    const day = dayOf(p.created_at); if (day !== today()) return;
    await bump(p.community, day, "posts"); if (p.type === "question") await bump(p.community, day, "questions");
    counted.set(p.id, { cid: p.community, day, question: p.type === "question", author: p.author }); if (counted.size > 20000) counted.delete(counted.keys().next().value);
    await active(p.community, p.author, day);
  }));
  const unpublish = safe(async (e) => {
    const pid = e?.post; const c = pid && counted.get(pid); if (!c || c.day !== today()) return;
    counted.delete(pid); await bump(c.cid, c.day, "posts", -1); if (c.question) await bump(c.cid, c.day, "questions", -1);
    await recheckActive(c.cid, c.author, c.day);
  });
  bus.on("POST_DELETED", unpublish); bus.on("CONTENT_REMOVED", unpublish);
  bus.on("COMMENT_CREATED", safe(async (e) => {
    const c = e?.comment ? await db.get("SELECT c.id, c.author, c.status, c.created_at, p.id pid, p.community, p.type, p.author pauthor, p.created_at pat FROM comments c JOIN posts p ON p.id=c.post WHERE c.id=$1", [e.comment]) : null;
    if (!c?.community || c.status !== "published" || !remember("c:" + c.id)) return;
    const day = dayOf(c.created_at); if (day !== today()) return;
    await bump(c.community, day, "comments"); await active(c.community, c.author, day);
    if (c.type === "question" && c.author !== c.pauthor && dayOf(c.pat) === day) { // the first answer from someone else marks the question answered
      const others = await n("SELECT COUNT(*) n FROM comments WHERE post=$1 AND author<>$2 AND status='published'", [c.pid, c.pauthor]);
      if (others === 1) await bump(c.community, day, "answered");
    }
  }));
  bus.on("POST_REACTED", safe(async (e) => {
    const p = e?.target ? await db.get("SELECT community FROM posts WHERE id=$1", [e.target]) : null; if (!p?.community) return;
    const r = await db.get("SELECT at FROM reactions WHERE target=$1 AND user_id=$2", [e.target, e.actor]).catch(() => null);
    const day = dayOf(r?.at || now()); await bump(p.community, day, "reactions"); await active(p.community, e.actor, day);
  }));
  bus.on("POST_VIEWED", safe(async (e) => { if (e?.community) await bump(e.community, dayOf(e.at), "views"); }));
  bus.on("COMMUNITY_MEMBER_EVENT", safe(async (e) => {
    const day = dayOf(e.at);
    if (JOIN_K.includes(e.kind)) {
      await bump(e.community, day, "new_members");
      /* a direct invite join carries the code in meta.via; an approval reads the membership (the code was stored when the
       * request was made). A link join that goes through the regular join path (public community) stores the code AFTER the
       * join event, so cspace counts it itself — reading the row here would race the UPDATE (seen on PostgreSQL). */
      const meta = typeof e.meta === "string" ? (() => { try { return JSON.parse(e.meta); } catch { return null; } })() : e.meta;
      const viaInvite = e.kind === "join" ? !!meta?.via : !!(await db.get("SELECT 1 x FROM memberships WHERE community=$1 AND user_id=$2 AND invited_via IS NOT NULL", [e.community, e.user]));
      if (viaInvite) await bump(e.community, day, "invite_joins");
      await applyNotifyDefault(e.community, e.user);
    } else if (LEAVE_K.includes(e.kind)) await bump(e.community, day, "left_members");
  }));
  bus.on("COMMUNITY_LOGGED", safe(async (e) => {
    if (AUTOMOD.includes(e.action)) await bump(e.community, dayOf(e.at), "automod_caught");
    else if (HUMAN_MOD.includes(e.action) && e.actor && e.actor !== "system") await bump(e.community, dayOf(e.at), "mod_actions");
  }));

  /* ======================= reconciler (the truth, from the source tables) ======================= */
  /** every counter of one community for one UTC day, recomputed; actors = who was active that day */
  async function computeDay(cid, day) {
    const [f, t] = span(day), a = [cid, f, t];
    const posts = await db.all("SELECT author, type FROM posts WHERE community=$1 AND status='published' AND created_at >= $2 AND created_at < $3", a);
    const comments = await db.all("SELECT c.author FROM comments c JOIN posts p ON p.id=c.post WHERE p.community=$1 AND c.status='published' AND c.created_at >= $2 AND c.created_at < $3", a);
    const reactions = await db.all("SELECT r.user_id FROM reactions r JOIN posts p ON p.id=r.target WHERE p.community=$1 AND r.at >= $2 AND r.at < $3", a);
    const actors = [...new Set([...posts.map(x => x.author), ...comments.map(x => x.author), ...reactions.map(x => x.user_id)])].filter(Boolean);
    const ev = await db.all("SELECT e.kind, m.invited_via FROM community_member_events e LEFT JOIN memberships m ON m.community=e.community AND m.user_id=e.user_id WHERE e.community=$1 AND e.at >= $2 AND e.at < $3", a);
    const logs = await db.all("SELECT action, actor FROM mod_actions WHERE community=$1 AND created_at >= $2 AND created_at < $3", a);
    return {
      posts: posts.length, comments: comments.length, reactions: reactions.length, active_users: actors.length,
      new_members: ev.filter(x => JOIN_K.includes(x.kind)).length, left_members: ev.filter(x => LEAVE_K.includes(x.kind)).length,
      invite_joins: ev.filter(x => JOIN_K.includes(x.kind) && x.invited_via).length,
      views: await n("SELECT COUNT(*) n FROM post_views v JOIN posts p ON p.id=v.post WHERE p.community=$1 AND v.at >= $2 AND v.at < $3", a),
      questions: posts.filter(x => x.type === "question").length,
      answered: await n("SELECT COUNT(*) n FROM posts p WHERE p.community=$1 AND p.status='published' AND p.type='question' AND p.created_at >= $2 AND p.created_at < $3 AND EXISTS (SELECT 1 FROM comments c WHERE c.post=p.id AND c.author<>p.author AND c.status='published')", a),
      mod_actions: logs.filter(x => HUMAN_MOD.includes(x.action) && x.actor && x.actor !== "system").length,
      automod_caught: logs.filter(x => AUTOMOD.includes(x.action)).length,
      actors
    };
  }
  async function writeDay(cid, day, v) {
    const cols = ["active_users", ...COLS];
    await db.run(`INSERT INTO community_metrics(community,day,${cols.join(",")},reconciled_at) VALUES($1,$2,${cols.map((_, i) => "$" + (i + 3)).join(",")},$${cols.length + 3})
      ON CONFLICT (community,day) DO UPDATE SET ${cols.map((c, i) => `${c}=$${i + 3}`).join(", ")}, reconciled_at=$${cols.length + 3}`, [cid, day, ...cols.map(c => v[c]), now()]);
    await db.run("DELETE FROM community_daily_actives WHERE community=$1 AND day=$2", [cid, day]);
    for (let i = 0; i < v.actors.length; i += 300) {
      const ch = v.actors.slice(i, i + 300), args = [cid, day];
      await db.run(`INSERT INTO community_daily_actives(community,day,user_id) VALUES ${ch.map((u, j) => { args.push(u); return `($1,$2,$${j + 3})`; }).join(",")} ON CONFLICT DO NOTHING`, args);
    }
  }
  /** the communities that had anything happen that day (or already hold a row to correct) — not every community */
  async function touched(day) {
    const [f, t] = span(day), a = [f, t], ids = new Set();
    for (const sql of [
      "SELECT DISTINCT community c FROM posts WHERE community IS NOT NULL AND created_at >= $1 AND created_at < $2",
      "SELECT DISTINCT p.community c FROM comments x JOIN posts p ON p.id=x.post WHERE p.community IS NOT NULL AND x.created_at >= $1 AND x.created_at < $2",
      "SELECT DISTINCT p.community c FROM reactions x JOIN posts p ON p.id=x.target WHERE p.community IS NOT NULL AND x.at >= $1 AND x.at < $2",
      "SELECT DISTINCT p.community c FROM post_views x JOIN posts p ON p.id=x.post WHERE p.community IS NOT NULL AND x.at >= $1 AND x.at < $2",
      "SELECT DISTINCT community c FROM community_member_events WHERE at >= $1 AND at < $2",
      "SELECT DISTINCT community c FROM mod_actions WHERE created_at >= $1 AND created_at < $2"
    ]) for (const r of await db.all(sql, a).catch(() => [])) if (r.c) ids.add(r.c);
    for (const r of await db.all("SELECT community c FROM community_metrics WHERE day=$1", [day])) ids.add(r.c);
    const live = new Set((await db.all("SELECT id FROM communities")).map(r => r.id)); // a deleted community has nothing to reconcile
    return [...ids].filter(x => live.has(x));
  }
  /** reconcile one day (default: today, as before — the nightly job passes yesterday). Returns the communities written. */
  async function computeMetrics(dayIso, { community } = {}) {
    const day = dayOf(dayIso || now());
    const list = community ? [community] : await touched(day);
    for (const cid of list) await writeDay(cid, day, await computeDay(cid, day));
    return { day, communities: list.length };
  }
  let lastNightly = null;
  async function nightly() {
    const y = dayOf(Date.now() - DAY); if (lastNightly === y) return { skipped: true };
    const r = await computeMetrics(y); lastNightly = y;
    await ctx.services.cintegrations?.reconcileRewards?.().catch(() => {});
    return r;
  }
  ctx.scheduler.every("communityMetricsNightly", 30 * 60e3, () => nightly());

  /* one-time, idempotent: the active sets of the last 90 days for a community that has none yet (insights before v2.60) */
  const backfilled = new Set();
  async function backfillActives(cid) {
    if (backfilled.has(cid)) return; backfilled.add(cid);
    if (await db.get("SELECT 1 x FROM community_daily_actives WHERE community=$1 AND day < $2 LIMIT 1", [cid, today()])) return;
    const since = new Date(Date.now() - 90 * DAY).toISOString(), by = new Map();
    const add = (u, at) => { if (!u || !at) return; const d = dayOf(at); if (d >= today()) return; (by.get(d) || by.set(d, new Set()).get(d)).add(u); };
    for (const r of await db.all("SELECT author u, created_at at FROM posts WHERE community=$1 AND status='published' AND created_at > $2", [cid, since])) add(r.u, r.at);
    for (const r of await db.all("SELECT c.author u, c.created_at at FROM comments c JOIN posts p ON p.id=c.post WHERE p.community=$1 AND c.status='published' AND c.created_at > $2", [cid, since])) add(r.u, r.at);
    for (const r of await db.all("SELECT r.user_id u, r.at at FROM reactions r JOIN posts p ON p.id=r.target WHERE p.community=$1 AND r.at > $2", [cid, since])) add(r.u, r.at);
    for (const [d, set] of by) { const us = [...set]; for (let i = 0; i < us.length; i += 300) { const ch = us.slice(i, i + 300), args = [cid, d]; await db.run(`INSERT INTO community_daily_actives(community,day,user_id) VALUES ${ch.map((u, j) => { args.push(u); return `($1,$2,$${j + 3})`; }).join(",")} ON CONFLICT DO NOTHING`, args); } }
  }

  /* ======================= insights ======================= */
  const validTz = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)]); };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  async function insights(user, cid, q = {}) {
    const c = await getC(cid); await P.need(cid, user.id, "view_analytics", "التحليلات لفريق الإشراف");
    const days = [7, 30, 90].includes(+q.days) ? +q.days : 30, since = new Date(Date.now() - (days - 1) * DAY).toISOString().slice(0, 10), sinceIso = since + "T00:00:00.000Z";
    const prevSince = new Date(+new Date(sinceIso) - days * DAY).toISOString().slice(0, 10);
    const tz = validTz(q.tz) ? q.tz : (validTz(c.settings?.tz) ? c.settings.tz : "Asia/Riyadh");
    await backfillActives(cid);
    /* the series: one row per day (today = live incremental row), missing days are zeros */
    const rows = Object.fromEntries((await db.all("SELECT * FROM community_metrics WHERE community=$1 AND day >= $2 ORDER BY day", [cid, since])).map(r => [r.day, r]));
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const d = dayOf(Date.now() - i * DAY), r = rows[d] || {}; series.push({ day: d, ...Object.fromEntries(["active_users", ...COLS].map(k => [k, Number(r[k] || 0)])) }); }
    const sum = (k, list = series) => list.reduce((a, x) => a + x[k], 0);
    const prev = await db.all("SELECT * FROM community_metrics WHERE community=$1 AND day >= $2 AND day < $3", [cid, prevSince, since]);
    const prevSum = (k) => prev.reduce((a, x) => a + Number(x[k] || 0), 0);
    const delta = (k) => ({ value: sum(k), prev: prevSum(k), change: prevSum(k) ? Math.round(((sum(k) - prevSum(k)) / prevSum(k)) * 100) : null });
    /* actives */
    const distinct = async (fromDay) => n("SELECT COUNT(DISTINCT user_id) n FROM community_daily_actives WHERE community=$1 AND day >= $2", [cid, fromDay]);
    const dau = await n("SELECT COUNT(*) n FROM community_daily_actives WHERE community=$1 AND day=$2", [cid, today()]);
    const wau = await distinct(dayOf(Date.now() - 6 * DAY)), mau = await distinct(dayOf(Date.now() - 29 * DAY));
    const ageDays = Math.max(1, Math.min(30, Math.ceil((Date.now() - +new Date(c.created_at || now())) / DAY) || 1)); // a young community averages over its own days
    const avgDau = await n("SELECT COUNT(*) n FROM community_daily_actives WHERE community=$1 AND day >= $2", [cid, dayOf(Date.now() - 29 * DAY)]) / ageDays;
    const members = await n("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [cid]);
    /* weekly cohorts: who joined in a week, and the share active in each following week (only weeks that have passed) */
    const W = 7 * DAY, start = Date.now() - 8 * W, joins = await db.all("SELECT user_id, at FROM community_member_events WHERE community=$1 AND kind IN ('join','approve') AND at > $2", [cid, new Date(start).toISOString()]);
    const act = await db.all("SELECT user_id, day FROM community_daily_actives WHERE community=$1 AND day >= $2", [cid, dayOf(start)]);
    const actBy = new Map(); for (const r of act) (actBy.get(r.user_id) || actBy.set(r.user_id, []).get(r.user_id)).push(+new Date(r.day + "T12:00:00Z"));
    const cohorts = [];
    for (let w = 0; w < 8; w++) {
      const a0 = start + w * W, a1 = a0 + W, users = [...new Set(joins.filter(j => { const t = +new Date(j.at); return t >= a0 && t < a1; }).map(j => j.user_id))];
      const ret = []; for (let k = 1; k <= 4; k++) { const b0 = a0 + k * W, b1 = b0 + W; if (b1 > Date.now()) break; ret.push(users.length ? pct(users.filter(u => (actBy.get(u) || []).some(t => t >= b0 && t < b1)).length, users.length) : null); }
      cohorts.push({ week: dayOf(a0), size: users.length, retention: ret });
    }
    /* top posts, contributors, channels */
    const top = (await db.all(`SELECT p.id, p.title, p.text, p.type, p.views, p.created_at, u.name, u.handle, (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) reactions, (SELECT COUNT(*) FROM comments x WHERE x.post=p.id AND x.status='published') comments
      FROM posts p LEFT JOIN users u ON u.id=p.author WHERE p.community=$1 AND p.status='published' AND p.created_at >= $2`, [cid, sinceIso]))
      .map(p => ({ id: p.id, title: p.title || String(p.text || "").slice(0, 90), type: p.type, views: Number(p.views || 0), reactions: Number(p.reactions), comments: Number(p.comments), engagement: Number(p.reactions) + Number(p.comments), at: p.created_at, author: { name: p.name, handle: p.handle } }))
      .sort((a, b) => b.engagement - a.engagement || b.views - a.views).slice(0, 5);
    const pc = await db.all("SELECT author, COUNT(*) n FROM posts WHERE community=$1 AND status='published' AND created_at >= $2 GROUP BY author", [cid, sinceIso]);
    const cc = await db.all("SELECT c.author, COUNT(*) n FROM comments c JOIN posts p ON p.id=c.post WHERE p.community=$1 AND c.status='published' AND c.created_at >= $2 GROUP BY c.author", [cid, sinceIso]);
    const score = new Map(); for (const r of pc) score.set(r.author, { posts: Number(r.n), comments: 0 }); for (const r of cc) { const s = score.get(r.author) || { posts: 0, comments: 0 }; s.comments = Number(r.n); score.set(r.author, s); }
    const topIds = [...score.entries()].map(([u, s]) => ({ u, ...s, score: s.posts * 3 + s.comments })).sort((a, b) => b.score - a.score).slice(0, 10);
    const users = topIds.length ? Object.fromEntries((await db.all(`SELECT id, name, handle, avatar, color, verified FROM users WHERE id IN (${topIds.map((_, i) => "$" + (i + 1)).join(",")})`, topIds.map(x => x.u))).map(u => [u.id, u])) : {};
    const contributors = topIds.filter(x => users[x.u]).map(x => ({ user: { id: x.u, name: users[x.u].name, handle: users[x.u].handle, avatar: users[x.u].avatar, color: users[x.u].color, verified: users[x.u].verified }, posts: x.posts, comments: x.comments, score: x.score }));
    const chRows = await db.all("SELECT channel, COUNT(*) n FROM posts WHERE community=$1 AND status='published' AND created_at >= $2 GROUP BY channel", [cid, sinceIso]);
    const chNames = Object.fromEntries((await db.all("SELECT id, name, archived_at FROM community_channels WHERE community=$1", [cid])).map(r => [r.id, r]));
    const channels = chRows.map(r => ({ id: r.channel || null, name: r.channel ? chNames[r.channel]?.name || "قناة محذوفة" : "العام", archived: !!chNames[r.channel]?.archived_at, posts: Number(r.n) })).sort((a, b) => b.posts - a.posts);
    /* best time to post: posts + comments by weekday × hour in the community's time zone */
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23" }), WDI = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    const stamps = [...(await db.all("SELECT created_at at FROM posts WHERE community=$1 AND status='published' AND created_at >= $2", [cid, sinceIso])), ...(await db.all("SELECT c.created_at at FROM comments c JOIN posts p ON p.id=c.post WHERE p.community=$1 AND c.status='published' AND c.created_at >= $2", [cid, sinceIso]))];
    for (const s of stamps) { const parts = Object.fromEntries(fmt.formatToParts(new Date(s.at)).map(x => [x.type, x.value])); const w = WDI[parts.weekday], hh = +parts.hour % 24; if (w !== undefined && hh >= 0) heat[w][hh]++; }
    let best = null; heat.forEach((row, w) => row.forEach((v, hh) => { if (v && (!best || v > best.n)) best = { weekday: w, hour: hh, n: v }; }));
    /* invite funnel (clicks are per link, all time) */
    const inv = await db.get("SELECT COALESCE(SUM(clicks),0) clicks, COUNT(*) links FROM community_invites WHERE community=$1", [cid]);
    const invJoined = await db.all("SELECT m.user_id FROM memberships m WHERE m.community=$1 AND m.invited_via IS NOT NULL AND m.role NOT IN ('pending','banned')", [cid]);
    const invActive = invJoined.filter(m => (actBy.get(m.user_id) || []).length).length;
    /* moderation health */
    const decisions = await db.all("SELECT a.created_at, p.created_at pat FROM mod_actions a JOIN posts p ON p.id=a.target_post WHERE a.community=$1 AND a.action IN ('approve','reject') AND a.created_at >= $2", [cid, sinceIso]);
    const firstDecision = median(decisions.map(d => (+new Date(d.created_at) - +new Date(d.pat)) / 60e3).filter(x => x >= 0));
    const queue = await n("SELECT COUNT(*) n FROM posts WHERE community=$1 AND status='pending'", [cid]) + await n("SELECT COUNT(*) n FROM reports r JOIN posts p ON p.id=r.target WHERE p.community=$1 AND r.status='open'", [cid]);
    const appeals = await n("SELECT COUNT(*) n FROM community_appeals WHERE community=$1 AND status='open'", [cid]).catch(() => 0);
    let health = null;
    if (await P.has(cid, user.id, "view_health")) { try { const h = await ctx.services.cspace.health(cid); health = { score: h.score, grade: h.grade, tips: h.tips.slice(0, 2) }; } catch { health = null; } }
    return {
      community: { id: c.id, name: c.name, type: c.type }, days, tz, since, generatedAt: now(),
      growth: { joins: delta("new_members"), leaves: delta("left_members"), net: sum("new_members") - sum("left_members"), members },
      engagement: { posts: delta("posts"), comments: delta("comments"), reactions: delta("reactions"), views: delta("views"), questions: sum("questions"), answered: sum("answered"), answerRate: pct(sum("answered"), sum("questions")) },
      actives: { dau, wau, mau, stickiness: mau ? Math.min(100, Math.round((avgDau / mau) * 100)) : 0, activeShare: Math.min(100, pct(wau, members)) },
      series, cohorts, topPosts: top, contributors, channels,
      heatmap: { tz, weekdays: WD, grid: heat, best: best && { ...best, label: `${WD[best.weekday]} ${String(best.hour).padStart(2, "0")}:00` } },
      funnel: { links: Number(inv?.links || 0), clicks: Number(inv?.clicks || 0), joins: invJoined.length, active: invActive, inPeriod: sum("invite_joins") },
      moderation: { firstDecisionMin: firstDecision, decisions: decisions.length, queue, appeals, automodCaught: sum("automod_caught"), actions: sum("mod_actions") },
      health, canExportMembers: (await P.member(cid, user.id))?.role === "owner"
    };
  }
  R.get("/api/communities/:id/insights", A(async (req) => insights(req.user, req.params.id, req.query)));
  /* CSV: aggregates for the team; member columns only for the owner */
  R.get("/api/communities/:id/insights/export", A(async (req) => {
    const d = await insights(req.user, req.params.id, req.query), owner = d.canExportMembers, cell = ctx.services.cmod.csvCell;
    if (!ctx.rl.hit("community", "insights-export:" + req.user.id)) throw E.rate();
    const head = ["day", "posts", "comments", "reactions", "views", "active_users", "new_members", "left_members", "invite_joins", "questions", "answered", "mod_actions", "automod_caught"];
    const lines = [head.join(","), ...d.series.map(r => head.map(k => cell(k === "day" ? r.day : r[k])).join(","))];
    lines.push("", ["post", "title", "reactions", "comments", "views", ...(owner ? ["author_handle"] : [])].join(","), ...d.topPosts.map(p => [p.id, p.title, p.reactions, p.comments, p.views, ...(owner ? [p.author.handle] : [])].map(cell).join(",")));
    lines.push("", "channel,posts", ...d.channels.map(x => [x.name, x.posts].map(cell).join(",")));
    if (owner) lines.push("", "contributor_handle,contributor_name,posts,comments,score", ...d.contributors.map(x => [x.user.handle, x.user.name, x.posts, x.comments, x.score].map(cell).join(",")));
    await ctx.services.cmod.log(d.community.id, req.user.id, { action: "insights_exported", category: "settings", meta: { days: d.days, members: owner } });
    return { csv: "\uFEFF" + lines.join("\r\n"), filename: `insights-${d.community.id}-${d.days}d.csv`, members: owner };
  }));

  /* ======================= events section ======================= */
  R.get("/api/communities/:id/events/manage", A(async (req) => {
    const c = await getC(req.params.id); await P.need(c.id, req.user.id, "queue_review", "إدارة الفعاليات لفريق الإشراف");
    const tab = oneOf(req.query.tab, ["upcoming", "past"], "upcoming");
    const rows = await db.all(`SELECT e.*, u.name oname FROM events e LEFT JOIN users u ON u.id=e.organizer WHERE e.community=$1 AND e.status=$2 ORDER BY e.starts_at ${tab === "past" ? "DESC" : "ASC"} LIMIT 100`, [c.id, tab]);
    const ids = rows.map(r => r.id), counts = {};
    if (ids.length) {
      const ph = ids.map((_, i) => "$" + (i + 1)).join(",");
      for (const r of await db.all(`SELECT event, status, COUNT(*) n FROM event_tickets WHERE event IN (${ph}) GROUP BY event, status`, ids)) (counts[r.event] ||= {})[r.status] = Number(r.n);
      for (const r of await db.all(`SELECT event_id event, COUNT(*) n FROM event_rsvps WHERE event_id IN (${ph}) AND kind='going' GROUP BY event_id`, ids)) (counts[r.event] ||= {}).going = Number(r.n);
    }
    const s = c.settings || {}, rem = { day: s.eventReminders?.day !== false, hour: s.eventReminders?.hour !== false };
    return {
      tab, reminders: rem, canEdit: await P.has(c.id, req.user.id, "edit_identity"), canCreate: await P.has(c.id, req.user.id, "event"),
      ics: c.type === "public" ? `/c/${c.id}/events.ics` : null, icsNote: c.type === "public" ? null : "رابط التقويم العام متاح للمجتمعات العامة فقط",
      counts: { upcoming: await n("SELECT COUNT(*) n FROM events WHERE community=$1 AND status='upcoming'", [c.id]), past: await n("SELECT COUNT(*) n FROM events WHERE community=$1 AND status='past'", [c.id]) },
      events: rows.map(e => { const k = counts[e.id] || {}, confirmed = (k.confirmed || 0) + (k.checked_in || 0); return { id: e.id, name: e.name, startsAt: e.starts_at, endsAt: e.ends_at || null, place: e.address || e.place || (e.online_url ? "عبر الإنترنت" : null), online: !!e.online_url, recurrence: e.recurrence || null, capacity: e.capacity || null, confirmed, going: k.going || 0, waitlist: k.waitlist || 0, checkedIn: k.checked_in || 0, organizer: e.oname || null, href: `#/event/${e.id}` }; })
    };
  }));
  /** /c/:id/events.ics — the community calendar, public communities only */
  async function ics(req, res, url) {
    const m = /^\/c\/([a-z]{1,3}_[a-z0-9]{6,24})\/events\.ics$/i.exec(url.pathname); if (!m) return false;
    const c = await db.get("SELECT id, name, type FROM communities WHERE id=$1", [m[1]]);
    if (!c || c.type !== "public") { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found"); return true; }
    const evs = await db.all("SELECT * FROM events WHERE community=$1 AND starts_at > $2 ORDER BY starts_at LIMIT 300", [c.id, new Date(Date.now() - 30 * DAY).toISOString()]);
    const origin = process.env.PUBLIC_URL || `http://${req.headers.host}`;
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${c.id}.ics"`, "Cache-Control": "public, max-age=900" });
    res.end(ctx.services.eventsPlus.cal(evs, origin, `${c.name} · مجتمع بلس`)); return true;
  }
  /** does this community want this reminder sent? (events-plus asks before each one) */
  async function reminderOn(eventId, kind) {
    const e = await db.get("SELECT c.settings FROM events e JOIN communities c ON c.id=e.community WHERE e.id=$1", [eventId]).catch(() => null);
    const r = e?.settings?.eventReminders; if (!r) return true;
    return kind === "1h" ? r.hour !== false : r.day !== false;
  }

  /* ======================= member notifications per community ======================= */
  const prefsOf = async (cid, uid) => db.get("SELECT * FROM community_member_prefs WHERE community=$1 AND user_id=$2", [cid, uid]);
  const prefsClient = (r, def) => {
    const mutedUntil = r?.muted_until && +new Date(r.muted_until) > Date.now() ? r.muted_until : null;
    return { level: r?.level || "all", digest: !!Number(r?.digest || 0), mutedUntil, muted: r?.level === "muted" || !!mutedUntil, custom: !!r, communityDefault: def || "all" };
  };
  async function applyNotifyDefault(cid, uid) {
    const c = await db.get("SELECT settings FROM communities WHERE id=$1", [cid]); const d = c?.settings?.notifyDefault;
    if (!d || d === "all") return;
    await db.run("INSERT INTO community_member_prefs(community,user_id,level,digest,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [cid, uid, "highlights", d === "digest" ? 1 : 0, now()]);
  }
  R.get("/api/communities/:id/notify", A(async (req) => {
    const c = await getC(req.params.id), m = await P.member(c.id, req.user.id); if (!m || !["owner", "admin", "moderator", "member", "muted"].includes(m.role)) throw E.forbid("إعدادات الإشعارات لأعضاء المجتمع");
    return { community: { id: c.id, name: c.name }, prefs: prefsClient(await prefsOf(c.id, req.user.id), c.settings?.notifyDefault) };
  }));
  R.put("/api/communities/:id/notify", A(async (req) => {
    const c = await getC(req.params.id), m = await P.member(c.id, req.user.id); if (!m || !["owner", "admin", "moderator", "member", "muted"].includes(m.role)) throw E.forbid("إعدادات الإشعارات لأعضاء المجتمع");
    const cur = prefsClient(await prefsOf(c.id, req.user.id)), b = req.body || {};
    const level = oneOf(b.level, LEVELS, cur.level), digest = b.digest !== undefined ? !!b.digest : cur.digest;
    let until = cur.mutedUntil;
    if (b.muteHours !== undefined) { const h = Number(b.muteHours); until = h > 0 ? new Date(Date.now() + Math.min(h, 24 * 30) * 3600e3).toISOString() : null; }
    await db.run(`INSERT INTO community_member_prefs(community,user_id,level,digest,muted_until,updated_at) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT (community,user_id) DO UPDATE SET level=$3, digest=$4, muted_until=$5, updated_at=$6`, [c.id, req.user.id, level, digest ? 1 : 0, until, now()]);
    return { prefs: prefsClient(await prefsOf(c.id, req.user.id), c.settings?.notifyDefault) };
  }));
  /* the admin's view: how many members changed their notifications (counts only — never who) */
  R.get("/api/communities/:id/notify/summary", A(async (req) => {
    await P.need(req.params.id, req.user.id, "edit_identity");
    const rows = await db.all("SELECT level, digest, muted_until FROM community_member_prefs WHERE community=$1", [req.params.id]);
    const c = await getC(req.params.id);
    return { default: c.settings?.notifyDefault || "all", custom: rows.length, highlights: rows.filter(r => r.level === "highlights").length, digest: rows.filter(r => Number(r.digest)).length, muted: rows.filter(r => r.level === "muted" || (r.muted_until && +new Date(r.muted_until) > Date.now())).length };
  }));
  /** notify.js: should this notification be dropped for this member's community preferences? */
  async function suppressNotify(uid, kind, { post = null, ref = null } = {}) {
    if (!uid || PERSONAL.has(kind)) return false;
    let cid = null;
    if (BY_REF.has(kind)) cid = ref;
    else if (BY_POST.has(kind) && post) cid = (await db.get("SELECT community FROM posts WHERE id=$1", [post]).catch(() => null))?.community || null;
    if (!cid) return false;
    const r = await prefsOf(cid, uid).catch(() => null); if (!r) return false;
    if (kind === "community_digest") return !Number(r.digest);
    if (r.level === "muted" || (r.muted_until && +new Date(r.muted_until) > Date.now())) return true;
    if (r.level === "highlights") return !HIGHLIGHT.has(kind);
    return false;
  }
  /* daily digest: once a day per member who asked for it, when there was new activity in the community */
  async function digests() {
    const cutoff = new Date(Date.now() - DAY + 15 * 60e3).toISOString(); let sent = 0;
    const rows = await db.all("SELECT community, user_id, last_digest_at FROM community_member_prefs WHERE digest=1 AND (last_digest_at IS NULL OR last_digest_at < $1) LIMIT 500", [cutoff]);
    for (const r of rows) {
      const from = r.last_digest_at || new Date(Date.now() - DAY).toISOString();
      const fresh = await n("SELECT COUNT(*) n FROM posts WHERE community=$1 AND status='published' AND created_at > $2 AND author<>$3", [r.community, from, r.user_id]);
      await db.run("UPDATE community_member_prefs SET last_digest_at=$1 WHERE community=$2 AND user_id=$3", [now(), r.community, r.user_id]);
      if (fresh && !(r.muted_until && +new Date(r.muted_until) > Date.now())) { await ctx.services.notify?.notify(r.user_id, "community_digest", { ref: r.community }); sent++; }
    }
    return { sent };
  }
  ctx.scheduler.every("communityDigests", 30 * 60e3, () => digests());

  return { computeMetrics, computeDay, nightly, insights, suppressNotify, digests, ics, reminderOn, bump, applyNotifyDefault, COLS };
};
