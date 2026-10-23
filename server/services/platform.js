/* Analytics Engine, Creator Engine, Translation Layer, AI Layer, Economy Layer (Pi payments),
 * and the client bootstrap (a viewer-scoped snapshot that hydrates the web app). */
const { E, str, now, TOPICS } = require("../lib/core");
const ALLOWED = ["feed_viewed", "post_opened", "video_start", "video_complete", "video_watch", "search_performed", "community_joined", "post_created", "impression", "share", "session_start"];

module.exports = (ctx) => {
  const { db, bus, config } = ctx;
  const content = () => ctx.services.content, comms = () => ctx.services.communities, users = () => ctx.services.users;

  /* ---- Analytics (privacy: no message content, no IPs stored) ---- */
  ctx.track = (userId, name, props = {}) => { db.run("INSERT INTO analytics_events(user_id,name,props,at) VALUES($1,$2,$3,$4)", [userId || null, name, props, now()]).catch(() => { }); };
  bus.on("POST_CREATED", e => ctx.track(e.actor, "post_created", { type: e.post.type }));
  bus.on("COMMUNITY_JOINED", e => ctx.track(e.actor, "community_joined", { community: e.community }));
  async function ingest(user, events) {
    if (!Array.isArray(events)) throw E.bad();
    for (const ev of events.slice(0, 50)) if (ALLOWED.includes(ev?.name)) {
      const props = {}; for (const k of ["post", "mode", "pct", "source", "q"]) if (ev.props?.[k] !== undefined) props[k] = String(ev.props[k]).slice(0, 100);
      ctx.track(user.id, ev.name, props);
      if (ev.name === "video_start" || ev.name === "video_complete") { const p = await db.get("SELECT data FROM posts WHERE id=$1", [props.post]); if (p?.data?.video) { const v = p.data.video; v[ev.name === "video_start" ? "starts" : "completions"] = (v[ev.name === "video_start" ? "starts" : "completions"] || 0) + 1; await db.run("UPDATE posts SET data=$1 WHERE id=$2", [p.data, props.post]); } }
    }
  }
  async function creator(user) {
    const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
    const posts = await db.all(`SELECT p.id, p.title, p.text, p.views, p.created_at, (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) rx, (SELECT COUNT(*) FROM comments c WHERE c.post=p.id) cm FROM posts p WHERE p.author=$1 AND p.status='published'`, [user.id]);
    const hours = Array(24).fill(0).map(() => ({ n: 0, eng: 0 })); posts.forEach(p => { const h = hours[new Date(p.created_at).getUTCHours()]; h.n++; h.eng += p.rx + p.cm; });
    const best = hours.map((h, i) => ({ hourUTC: i, avg: h.n ? h.eng / h.n : 0 })).sort((a, b) => b.avg - a.avg).slice(0, 3).filter(h => h.avg > 0);
    const opens = await db.all(`SELECT props FROM analytics_events WHERE name='post_opened' AND at > $1`, [ago(30)]);
    const mine = new Set(posts.map(p => p.id)); const sources = {}; opens.forEach(o => { if (mine.has(o.props?.post)) sources[o.props.source || "app"] = (sources[o.props.source || "app"] || 0) + 1; });
    const reach = (await db.get(`SELECT COUNT(DISTINCT user_id) n FROM analytics_events WHERE name IN ('post_opened','impression') AND at > $1 AND CAST(props AS TEXT) LIKE $2`, [ago(30), `%${user.id}%`]))?.n || 0;
    return {
      views: posts.reduce((a, p) => a + p.views, 0), engagement: posts.reduce((a, p) => a + p.rx + p.cm, 0),
      followers: (await db.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [user.id])).n, newFollowers7d: (await db.get("SELECT COUNT(*) n FROM follows WHERE dst=$1 AND at > $2", [user.id, ago(7)])).n,
      topPosts: posts.sort((a, b) => (b.rx + b.cm) - (a.rx + a.cm)).slice(0, 5).map(p => ({ id: p.id, title: p.title || p.text.slice(0, 80), views: p.views, engagement: p.rx + p.cm })),
      bestHoursUTC: best, sources, reach
    };
  }

  /* ---- Translation Layer: provider-agnostic (LibreTranslate-compatible API via TRANSLATE_URL). Originals are never overwritten. ---- */
  async function translate(user, b) {
    // phase 41: machine translation is a subscriber feature with a pluggable provider and a shared cache (services/translate.js)
    if (ctx.services.translate) return ctx.services.translate.legacy(user, b || {});
    throw E.off("خدمة الترجمة غير مفعّلة بعد");
  }

  /* ---- AI Layer (extractive today; LLM provider plugs in here) ---- */
  // discussion summaries moved to services/summaries.js in v2.6 (cited, verified, provider-swappable)

  /* ---- Economy Layer: Pi payments (server-side approval/completion per Pi Platform API) ---- */
  async function piCall(pathname, body) {
    if (!config.piEnabled || !config.piApiKey) throw E.off("مدفوعات Pi غير مفعّلة بعد");
    const r = await fetch(config.piApi + pathname, { method: "POST", headers: { Authorization: "Key " + config.piApiKey, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw E.bad("رفضت شبكة Pi العملية"); return j;
  }
  async function piApprove(user, paymentId) {
    const pay = await (async () => { if (!config.piEnabled || !config.piApiKey) throw E.off("مدفوعات Pi غير مفعّلة بعد"); const r = await fetch(config.piApi + "/v2/payments/" + encodeURIComponent(paymentId), { headers: { Authorization: "Key " + config.piApiKey } }); if (!r.ok) throw E.bad(); return r.json(); })();
    await db.run("INSERT INTO pi_payments(payment_id,user_id,amount,memo,metadata,status,created_at) VALUES($1,$2,$3,$4,$5,'approving',$6) ON CONFLICT DO NOTHING", [paymentId, user.id, pay.amount, pay.memo, pay.metadata || {}, now()]);
    await piCall(`/v2/payments/${encodeURIComponent(paymentId)}/approve`);
    await db.run("UPDATE pi_payments SET status='approved', updated_at=$1 WHERE payment_id=$2", [now(), paymentId]);
    return { ok: true };
  }
  async function piComplete(user, paymentId, txid) {
    const row = await db.get("SELECT * FROM pi_payments WHERE payment_id=$1 AND user_id=$2", [paymentId, user.id]); if (!row) throw E.nf();
    await piCall(`/v2/payments/${encodeURIComponent(paymentId)}/complete`, { txid: str(txid, 200, { required: true }) });
    await db.run("UPDATE pi_payments SET status='completed', txid=$1, updated_at=$2 WHERE payment_id=$3", [txid, now(), paymentId]);
    return { ok: true };
  }

  /* ---- Bootstrap: viewer-scoped snapshot in the web app's store shape ---- */
  async function bootstrap(user) {
    const prefs = user.prefs || {};
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const rows = await db.all(`SELECT * FROM posts WHERE type<>'story' AND ((status IN ('published') AND created_at > $1) OR author=$2 OR status='published' AND id IN (SELECT pinned FROM users WHERE pinned IS NOT NULL)) ORDER BY created_at DESC LIMIT 400`, [since, user.id]);
    const modComms = (await db.all("SELECT community FROM memberships WHERE user_id=$1 AND role IN ('owner','admin','moderator')", [user.id])).map(r => r.community);
    if (modComms.length) rows.push(...await db.all(`SELECT * FROM posts WHERE status='pending' AND community IN (${modComms.map((_, i) => "$" + (i + 1)).join(",")})`, modComms));
    const visible = []; const seen = new Set();
    const uniqRows = [...new Map(rows.map(r => [r.id, r])).values()];
    const okIds = new Set((await content().filterVisible(uniqRows.filter(r => r.status !== "pending"), user.id)).map(r => r.id));
    for (const p of uniqRows) if (p.author === user.id || p.status === "pending" || okIds.has(p.id)) { seen.add(p.id); visible.push(p); }
    // referenced quotes/reposts
    for (const ref of [...new Set(visible.flatMap(p => [p.quote_of, p.repost_of]).filter(x => x && !seen.has(x)))]) { const q = await db.get("SELECT * FROM posts WHERE id=$1", [ref]); if (q && await content().canSee(q, user.id)) { seen.add(q.id); visible.push(q); } }
    const ids = visible.map(p => p.id), ph = ids.map((_, i) => "$" + (i + 1)).join(",");
    const posts = visible.map(p => content().toClient(p, user.id));
    if (ids.length) {
      const votes = await db.all(`SELECT post_id, user_id, option_idx FROM poll_votes WHERE post_id IN (${ph})`, ids);
      const stances = await db.all(`SELECT post_id, user_id, idx FROM stance_votes WHERE post_id IN (${ph})`, ids);
      const vers = await db.all(`SELECT post_id, text, at FROM post_versions WHERE post_id IN (${ph}) ORDER BY id`, ids);
      for (const p of posts) {
        if (p.poll) { p.poll.voters = {}; votes.filter(v => v.post_id === p.id).forEach(v => { p.poll.options[v.option_idx].v++; if (v.user_id === user.id) p.poll.voters[user.id] = p.poll.multi ? [...(p.poll.voters[user.id] || []), v.option_idx] : v.option_idx; }); }
        if (p.stances) { stances.filter(v => v.post_id === p.id).forEach(v => { p.stances[v.idx].v++; if (v.user_id === user.id) p.stanceVoters[user.id] = v.idx; }); }
        const h = vers.filter(v => v.post_id === p.id); if (h.length) p.history = h.map(v => ({ text: v.text, at: v.at }));
      }
    }
    const comments = ids.length ? await db.all(`SELECT id, post, author, parent, text, status, anchor, created_at AS "createdAt" FROM comments WHERE post IN (${ph}) AND status='published'`, ids) : [];
    const targets = [...ids, ...comments.map(c => c.id)];
    const reactions = []; for (let i = 0; i < targets.length; i += 500) { const chunk = targets.slice(i, i + 500); reactions.push(...await db.all(`SELECT target, user_id AS "user", type, at FROM reactions WHERE target IN (${chunk.map((_, j) => "$" + (j + 1)).join(",")})`, chunk)); }
    /* v2.56 privacy: invite-only communities only for people who belong to them; settings via the public allow-list
     * (toClient); memberships: everyone sees active members of PUBLIC communities, members see their own private
     * communities, and only moderators see requests, bans and mutes of the communities they moderate. */
    const commRows = await comms().listFor(user.id);
    const communities = commRows.map(comms().toClient);
    const ctype = new Map(commRows.map(c => [c.id, c.type]));
    const mine = new Map((await db.all("SELECT community, role FROM memberships WHERE user_id=$1", [user.id])).map(m => [m.community, m.role]));
    const STAFF = ["owner", "admin", "moderator"], ACT = (r) => r && !["pending", "banned"].includes(r);
    const cids = commRows.map(c => c.id);
    const rawMem = []; for (let i = 0; i < cids.length; i += 200) { const ch = cids.slice(i, i + 200); rawMem.push(...await db.all(`SELECT community, user_id AS "user", role, prev_role, joined_at AS "joinedAt" FROM memberships WHERE community IN (${ch.map((_, j) => "$" + (j + 1)).join(",")})`, ch)); }
    /* v2.57 (flag community_lean_bootstrap, admin kill switch): only your own memberships + every membership of the
     * communities you moderate; member lists come from GET /api/communities/:id/members (paged) */
    let lean = false; try { lean = !!(await ctx.services.ops?.flagsFor?.(user))?.community_lean_bootstrap; } catch { lean = false; }
    const memberships = rawMem.filter(m => {
      if (m.user === user.id || STAFF.includes(mine.get(m.community))) return true;
      if (lean) return false;
      if (["pending", "banned"].includes(m.role)) return false;
      return ctype.get(m.community) === "public" || ACT(mine.get(m.community));
    }).map(m => ({ community: m.community, user: m.user, role: m.role === "muted" && m.user !== user.id && !STAFF.includes(mine.get(m.community)) ? (m.prev_role || "member") : m.role, joinedAt: m.joinedAt }));
    const convs = await db.all("SELECT c.id, c.updated_at AS \"updatedAt\", m.state FROM conversations c JOIN conversation_members m ON m.conv=c.id AND m.user_id=$1 ORDER BY c.updated_at DESC LIMIT 50", [user.id]);
    for (const c of convs) c.members = (await db.all("SELECT user_id FROM conversation_members WHERE conv=$1", [c.id])).map(r => r.user_id);
    const messages = convs.length ? await db.all(`SELECT id, conv, sender AS "from", text, created_at AS at, CASE WHEN read_at IS NULL AND sender<>$1 THEN 0 ELSE 1 END AS read FROM messages WHERE conv IN (${convs.map((_, i) => "$" + (i + 2)).join(",")}) ORDER BY created_at`, [user.id, ...convs.map(c => c.id)]) : [];
    const userIds = new Set([user.id, ...posts.map(p => p.author), ...comments.map(c => c.author), ...memberships.map(m => m.user), ...convs.flatMap(c => c.members), ...reactions.map(r => r.user)]);
    const suggested = await db.all("SELECT * FROM users WHERE status='active' ORDER BY created_at DESC LIMIT 50");
    suggested.forEach(u => userIds.add(u.id));
    const uids = [...userIds]; const usersRows = []; for (let i = 0; i < uids.length; i += 500) { const ch = uids.slice(i, i + 500); usersRows.push(...await db.all(`SELECT * FROM users WHERE id IN (${ch.map((_, j) => "$" + (j + 1)).join(",")})`, ch)); }
    const follows = []; for (let i = 0; i < uids.length; i += 400) { const ch = uids.slice(i, i + 400), p2 = ch.map((_, j) => "$" + (j + 1)).join(","); follows.push(...await db.all(`SELECT src AS "from", dst AS "to", at FROM follows WHERE src IN (${p2}) OR dst IN (${p2})`, ch)); }
    const notifications = await db.all("SELECT id, user_id AS \"user\", kind, actor, post, ref, read, created_at AS at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [user.id]);
    const events = await comms().evClients(await comms().visibleEvents(await db.all("SELECT * FROM events WHERE status='upcoming' ORDER BY starts_at LIMIT 100"), user.id));
    const isAdmin = user.role === "admin";
    const decisions = (await db.all("SELECT id, target, user_id AS \"user\", action, reason, by_user AS \"by\", restored, created_at AS at FROM decisions WHERE user_id=$1" + (isAdmin ? " OR 1=1" : "") + " ORDER BY created_at DESC LIMIT 100", [user.id])).map(d => ({ ...d, restored: !!d.restored }));
    const appeals = await db.all("SELECT a.id, a.decision_id AS \"decisionId\", d.reason AS decision, a.text, a.by_user AS \"by\", a.status, a.created_at AS at FROM appeals a JOIN decisions d ON d.id=a.decision_id WHERE a.by_user=$1" + (isAdmin ? " OR 1=1" : ""), [user.id]);
    const reports = isAdmin ? await db.all("SELECT id, target, kind, reason, by_user AS \"by\", status, created_at AS at FROM reports ORDER BY created_at DESC LIMIT 200") : await db.all("SELECT id, target, kind, reason, by_user AS \"by\", status, created_at AS at FROM reports WHERE by_user=$1", [user.id]);
    const audit = isAdmin ? (await db.all("SELECT action, target, reason, by_user AS \"by\", at FROM audit_log ORDER BY id DESC LIMIT 100")).reverse() : [];
    return {
      version: config.version, me: user.id, isAdmin, serverTime: now(), topics: TOPICS,
      users: usersRows.map(users().pub), posts, comments, reactions, follows, communities, memberships, events,
      conversations: convs, messages: messages.map(m => ({ ...m, read: !!m.read })), notifications: notifications.map(n => ({ ...n, read: !!n.read })),
      reports, decisions, appeals, audit, prefs
    };
  }

  const r = ctx.router, A = ctx.requireUser;
  r.get("/api/health", async () => ({ ok: true, version: config.version, db: ctx.db.dialect, time: now(), pi: config.piEnabled, ...(config.demoLogin ? { demo: true } : {}), translate: !!ctx.services.translate?.status().available }));
  r.get("/api/bootstrap", A(async (req) => bootstrap(req.user)));
  r.post("/api/analytics", A(async (req) => (await ingest(req.user, req.body.events), { ok: true })));
  r.get("/api/creator/analytics", A(async (req) => creator(req.user)));
  r.post("/api/translate", A(async (req) => translate(req.user, req.body)));
  // Legacy Pi routes: delegated to services/pi.js (phase 36) when it is registered; the old direct calls remain as a fallback.
  r.post("/api/pi/payments/approve", A(async (req) => ctx.services.pi ? ctx.services.pi.approve(req.user, str(req.body.paymentId, 200, { required: true })) : piApprove(req.user, str(req.body.paymentId, 200, { required: true }))));
  r.post("/api/pi/payments/complete", A(async (req) => ctx.services.pi ? ctx.services.pi.complete(req.user, str(req.body.paymentId, 200, { required: true }), req.body.txid) : piComplete(req.user, str(req.body.paymentId, 200, { required: true }), req.body.txid)));
  return { bootstrap };
};
