/* Notification service (Phase 28). Owns everything that turns domain events into notifications:
 * • notify(user, kind, …): block/mute filters → per-kind channel settings → importance → in-app row +
 *   realtime toast → push and email deliveries through the durable queue (lib/queue.js: retries with
 *   exponential backoff, survives restarts, scales out with worker.js).
 * • Web Push (lib/webpush.js: VAPID + RFC 8291 encryption) to every subscribed browser/phone; 404/410 prune
 *   the subscription; quiet hours (user timezone) defer pushes to the end of the window, urgent kinds bypass.
 * • Notification center API: tabs, grouping («أحمد و5 آخرون أعجبهم منشورك»), importance ranking.
 * ctx.services.messaging.notify delegates here, so every existing caller keeps working. */
const { E, str, id, now, HttpError } = require("../lib/core");
const L = require("../lib/notify-lib");
const WP = require("../lib/webpush");
const { secret } = require("../lib/secrets");
const { log } = require("../lib/log");
const parseJ = (v) => { if (!v) return {}; if (typeof v === "object") return v; try { return JSON.parse(v); } catch { return {}; } };

module.exports = (ctx) => {
  const { db, bus, realtime, queue } = ctx;
  const EMAIL_DELAY = () => +(process.env.NOTIFY_EMAIL_DELAY_MS ?? 5 * 60e3);

  /* ---------- VAPID keys: environment first, otherwise generated once and kept in notify_keys ---------- */
  let vapidP = null;
  function vapid() {
    return vapidP ||= (async () => {
      const subject = process.env.VAPID_SUBJECT || `mailto:${ctx.mailer?.fromAddr || "no-reply@mujtama.plus"}`;
      const pub = secret("VAPID_PUBLIC_KEY"), priv = secret("VAPID_PRIVATE_KEY");
      if (pub && priv) return { publicKey: pub, privateKey: priv, subject, source: "env" };
      let row = await db.get("SELECT value FROM notify_keys WHERE name='vapid'");
      // phase 52: generated once and kept in notify_keys (production included) unless VAPID_ENV_ONLY=1; env keys always win
      if (!row && require("../lib/providers").vapidPolicy() === "env-only") throw new HttpError(503, "إشعارات الدفع غير مفعّلة على الخادم بعد (مفاتيح VAPID غير مضبوطة)", "push_not_configured");
      if (!row) {
        await db.run("INSERT INTO notify_keys(name,value,created_at) VALUES('vapid',$1,$2) ON CONFLICT DO NOTHING", [JSON.stringify(WP.generateVapidKeys()), now()]);
        row = await db.get("SELECT value FROM notify_keys WHERE name='vapid'");
        log.info?.("VAPID key pair generated and stored in the database (web push on); VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY override it");
      }
      return { ...JSON.parse(row.value), subject, source: "db" };
    })().catch(e => { vapidP = null; throw e; });
  }

  /* ---------- settings ---------- */
  async function settings(uid) {
    const r = await db.get("SELECT * FROM notify_settings WHERE user_id=$1", [uid]);
    const u = await db.get("SELECT tz FROM users WHERE id=$1", [uid]);
    return { channels: parseJ(r?.channels), quiet: { enabled: !!r?.quiet_enabled, start: r?.quiet_start || "22:00", end: r?.quiet_end || "07:00", tz: r?.quiet_tz || u?.tz || "Asia/Riyadh", allowUrgent: r ? !!r.quiet_urgent : true }, emailNotify: r ? !!r.email_notify : true };
  }
  async function saveSettings(uid, b = {}) {
    const cur = await settings(uid), channels = { ...cur.channels };
    if (b.channels && typeof b.channels === "object") for (const [k, v] of Object.entries(b.channels)) {
      if (!L.KINDS[k] || typeof v !== "object" || !v) continue;
      const o = { ...(channels[k] || {}) };
      for (const c of L.CHANNELS) if (v[c] !== undefined) o[c] = v[c] ? 1 : 0;
      for (const c of L.KINDS[k].lock || []) delete o[c];
      channels[k] = o;
    }
    const q = { ...cur.quiet, ...(b.quiet && typeof b.quiet === "object" ? b.quiet : {}) };
    if (L.toMin(q.start) === null || L.toMin(q.end) === null) throw E.bad("صيغة الوقت HH:MM");
    if (!L.validTz(q.tz)) throw E.bad("المنطقة الزمنية غير معروفة");
    const emailNotify = b.emailNotify !== undefined ? !!b.emailNotify : cur.emailNotify;
    await db.run(`INSERT INTO notify_settings(user_id,channels,quiet_enabled,quiet_start,quiet_end,quiet_tz,quiet_urgent,email_notify,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (user_id) DO UPDATE SET channels=$2, quiet_enabled=$3, quiet_start=$4, quiet_end=$5, quiet_tz=$6, quiet_urgent=$7, email_notify=$8, updated_at=$9`,
    [uid, JSON.stringify(channels), q.enabled ? 1 : 0, q.start, q.end, str(q.tz, 64), q.allowUrgent === false ? 0 : 1, emailNotify ? 1 : 0, now()]);
    return settings(uid);
  }
  async function settingsView(user) {
    const st = await settings(user.id), legacy = user.prefs?.settings?.notify || {};
    const subs = (await db.get("SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=$1", [user.id])).n;
    const sup = user.email ? await db.get("SELECT reason FROM email_suppressions WHERE email=$1", [user.email]) : null;
    return {
      tabs: L.TABS.filter(t => t[0] !== "all").map(([key, label]) => ({ key, label })),
      kinds: Object.entries(L.KINDS).map(([kind, K]) => ({ kind, label: K.label, tab: K.tab, ...L.channelsFor(kind, st.channels, legacy), lock: K.lock || [] })),
      quiet: st.quiet, emailNotify: st.emailNotify,
      push: { publicKey: (await vapid().catch(() => null))?.publicKey || null, subscriptions: Number(subs) },
      email: { address: user.email || null, verified: !!user.email_verified_at, suppressed: sup?.reason || null, enabled: !!ctx.mailer?.enabled }
    };
  }

  /* ---------- notify ---------- */
  async function relation(user, actor) {
    if (!actor) return {};
    const f = await db.get("SELECT (SELECT 1 FROM follows WHERE src=$1 AND dst=$2) a, (SELECT 1 FROM follows WHERE src=$2 AND dst=$1) b, (SELECT verified FROM users WHERE id=$2) v", [user, actor]).catch(() => null);
    return { follows: !!f?.a, mutual: !!(f?.a && f?.b), verified: !!f?.v };
  }
  async function notify(user, kind, { actor = null, post = null, ref = null } = {}) {
    if (!user || user === actor) return null;
    const u = await db.get("SELECT id, prefs, email, email_verified_at FROM users WHERE id=$1", [user]); if (!u) return null;
    const prefs = u.prefs || {};
    if (actor && ((prefs.blocked || []).includes(actor) || (prefs.muted?.users || []).includes(actor))) return null;
    if (actor && (await ctx.services.protection?.suppressNotify(user, kind, { actor, post, ref }))) return null; // phase 33: linked blocks, timed mutes, protection mode
    if (await ctx.services.cinsights?.suppressNotify(user, kind, { post, ref }).catch(() => false)) return null; // v2.60: the member's notifications for that community
    const st = await settings(user), ch = L.channelsFor(kind, st.channels, prefs.settings?.notify);
    if (!ch.inapp && !ch.push && !ch.email) return null;
    const importance = L.importanceAtWrite(kind, await relation(user, actor));
    const n = { id: id("n"), user, kind, actor, post, ref, at: now(), read: false, importance };
    n.groupKey = L.groupKey(n);
    if (ch.inapp) {
      await db.run("INSERT INTO notifications(id,user_id,kind,actor,post,ref,created_at,importance,group_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [n.id, user, kind, actor, post, ref, n.at, importance, n.groupKey]);
      const a = actor ? await db.get("SELECT name, handle, color, avatar FROM users WHERE id=$1", [actor]) : null;
      realtime.send(user, "notification", { ...n, text: L.sentence(kind, a ? [a.name] : [], 1, ref), href: L.hrefFor(n), actorInfo: a });
    }
    if (ch.push) await enqueuePush(n, st, { stored: !!ch.inapp }).catch(e => log.error("push enqueue failed", { err: e.message }));
    if (ch.email && st.emailNotify && u.email && u.email_verified_at) await enqueueEmail(n, { stored: !!ch.inapp }).catch(e => log.error("email enqueue failed", { err: e.message }));
    return n;
  }
  const delivery = async (n, channel, target, status) => { const did = id("dl"); await db.run("INSERT INTO notify_deliveries(id,notification,user_id,channel,target,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)", [did, n.id, n.user, channel, target, status, now()]); return did; };
  const setDelivery = (did, status, error = null, attempts = null) => db.run("UPDATE notify_deliveries SET status=$1, error=$2, attempts=COALESCE($3, attempts), updated_at=$4 WHERE id=$5", [status, error, attempts, now(), did]);
  const pushOpts = (n) => n.kind === "call" ? { urgency: "high", ttl: 60 } : n.kind === "message" ? { urgency: "high", ttl: 6 * 3600 } : n.importance >= 60 ? { urgency: "normal", ttl: 24 * 3600 } : { urgency: "low", ttl: 3 * 24 * 3600 };

  async function enqueuePush(n, st, { stored }) {
    const subs = await db.all("SELECT id FROM push_subscriptions WHERE user_id=$1", [n.user]); if (!subs.length) return 0;
    const d = L.pushDecision(new Date(), st.quiet, n.importance);
    const delayMs = d.action === "defer" ? Math.max(0, d.until - Date.now()) : 0;
    for (const s of subs) {
      const did = await delivery(n, "push", s.id, d.action === "defer" ? "deferred" : "queued");
      await queue.enqueue("notify.push", { did, sub: s.id, n, stored }, { delayMs });
    }
    return subs.length;
  }
  async function enqueueEmail(n, { stored }) {
    const urgent = n.kind.startsWith("security_");
    const did = await delivery(n, "email", null, "queued");
    await queue.enqueue("notify.email", { did, n, stored }, { delayMs: urgent || !stored ? 0 : EMAIL_DELAY() });
  }

  /** what a push shows: the whole unread group, so the OS replaces the previous banner (same tag) */
  async function pushPayload(n, stored) {
    let names = [], total = 1, unread = 0;
    if (stored && L.kindOf(n.kind).group) {
      const rows = await db.all("SELECT DISTINCT n.actor, u.name, MAX(n.created_at) at FROM notifications n LEFT JOIN users u ON u.id=n.actor WHERE n.user_id=$1 AND n.group_key=$2 AND n.read=0 AND n.created_at > $3 GROUP BY n.actor, u.name ORDER BY at DESC", [n.user, n.groupKey, new Date(Date.now() - L.GROUP_WINDOW_MS).toISOString()]);
      names = rows.map(r => r.name).filter(Boolean); total = Math.max(rows.length, 1);
    } else if (n.actor) names = [(await db.get("SELECT name FROM users WHERE id=$1", [n.actor]))?.name].filter(Boolean);
    unread = Number((await db.get("SELECT COUNT(*) c FROM notifications WHERE user_id=$1 AND read=0", [n.user])).c);
    return { title: "مجتمع بلس", body: L.sentence(n.kind, names, total, n.ref), tag: n.groupKey, url: L.hrefFor(n), nid: n.id, kind: n.kind, badge: unread, ts: Date.parse(n.at), renotify: n.importance >= 80 };
  }

  queue.on("notify.push", async (p, job) => {
    const { did, n, stored } = p;
    const sub = await db.get("SELECT * FROM push_subscriptions WHERE id=$1", [p.sub]);
    if (!sub) return setDelivery(did, "gone", null, job.attempts);
    if (stored && !p.test) { const row = await db.get("SELECT read FROM notifications WHERE id=$1", [n.id]); if (!row || row.read) return setDelivery(did, "skipped", "already read", job.attempts); }
    if (!p.test) { // settings may have changed while the job waited
      const st = await settings(n.user), d = L.pushDecision(new Date(), st.quiet, n.importance);
      if (d.action === "defer") { await setDelivery(did, "deferred", null, job.attempts); await queue.enqueue("notify.push", p, { delayMs: Math.max(1000, d.until - Date.now()) }); return; }
    }
    const payload = p.test ? { title: "مجتمع بلس", body: "إشعار تجريبي: الإشعارات تعمل على هذا الجهاز", tag: "test", url: "/#/notifications", kind: "test", ts: Date.now() } : await pushPayload(n, stored);
    let r;
    try { r = await WP.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), await vapid(), { ...pushOpts(n), topic: n.groupKey?.replace(/[^A-Za-z0-9_-]/g, "") }); }
    catch (e) { await db.run("UPDATE push_subscriptions SET fail_count=fail_count+1 WHERE id=$1", [sub.id]); await setDelivery(did, "retrying", e.message, job.attempts); throw e; }
    if (r.ok) { await db.run("UPDATE push_subscriptions SET last_ok_at=$1, fail_count=0 WHERE id=$2", [now(), sub.id]); return setDelivery(did, "sent", null, job.attempts); }
    if (r.gone) { await db.run("DELETE FROM push_subscriptions WHERE id=$1", [sub.id]); return setDelivery(did, "gone", "HTTP " + r.status, job.attempts); }
    await db.run("UPDATE push_subscriptions SET fail_count=fail_count+1 WHERE id=$1", [sub.id]);
    if (r.status === 429 || r.status >= 500) { await setDelivery(did, "retrying", "HTTP " + r.status, job.attempts); throw new Error("push service HTTP " + r.status); }
    return setDelivery(did, "failed", "HTTP " + r.status, job.attempts); // 400/401/403/413: retrying will not help
  });
  queue.on("notify.email", async (p, job) => {
    const { did, n, stored } = p;
    if (stored && !n.kind.startsWith("security_")) { const row = await db.get("SELECT read FROM notifications WHERE id=$1", [n.id]); if (!row || row.read) return setDelivery(did, "skipped", "already read", job.attempts); }
    if (!ctx.services.mail) return setDelivery(did, "skipped", "mail service missing", job.attempts);
    try { const r = await ctx.services.mail.sendNotification(n); await setDelivery(did, r.status || "sent", r.reason || null, job.attempts); }
    catch (e) { await setDelivery(did, "retrying", e.message, job.attempts); throw e; }
  });

  /* ---------- notification center ---------- */
  async function center(user, { tab = "all", sort = "rank", limit = 60 } = {}) {
    const rows = await db.all("SELECT id, kind, actor, post, ref, read, created_at AS at, importance FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 400", [user.id]);
    const list = rows.map(r => ({ ...r, read: !!r.read, importance: r.importance ?? L.kindOf(r.kind).imp }));
    const tabs = L.TABS.map(([key, label]) => ({ key, label, unread: list.filter(n => !n.read && (key === "all" || L.kindOf(n.kind).tab === key)).length }));
    const mine = tab === "all" ? list : list.filter(n => L.kindOf(n.kind).tab === tab);
    let groups = L.group(mine);
    groups = sort === "new" ? groups : L.rank(groups);
    groups = groups.slice(0, Math.min(+limit || 60, 100));
    const actorIds = [...new Set(groups.flatMap(g => g.actors.slice(0, 3)))];
    const people = actorIds.length ? await db.all(`SELECT id, name, handle, color, avatar FROM users WHERE id IN (${actorIds.map((_, i) => "$" + (i + 1)).join(",")})`, actorIds) : [];
    const P = new Map(people.map(p => [p.id, p]));
    return {
      tab, sort, tabs, unread: tabs[0].unread,
      groups: groups.map(g => {
        const actors = g.actors.slice(0, 3).map(a => P.get(a)).filter(Boolean);
        return { key: g.key, kind: g.kind, tab: L.kindOf(g.kind).tab, ids: g.ids, count: g.count, read: g.read, at: g.at, post: g.post, ref: g.ref, importance: g.importance, score: g.score,
          actors, names: L.actorsText(actors.map(a => a.name), g.count), verb: L.verbFor(g.kind, g.count), text: L.sentence(g.kind, actors.map(a => a.name), g.count, g.ref), href: L.hrefFor(g), important: g.importance >= 70 && !g.read };
      })
    };
  }
  async function markRead(user, b = {}) {
    if (Array.isArray(b.ids) && b.ids.length) {
      const ids = b.ids.slice(0, 500).map(String);
      await db.run(`UPDATE notifications SET read=1 WHERE user_id=$1 AND id IN (${ids.map((_, i) => "$" + (i + 2)).join(",")})`, [user.id, ...ids]);
    } else if (b.tab && b.tab !== "all") {
      const kinds = Object.keys(L.KINDS).filter(k => L.KINDS[k].tab === b.tab); if (!kinds.length) throw E.bad();
      await db.run(`UPDATE notifications SET read=1 WHERE user_id=$1 AND kind IN (${kinds.map((_, i) => "$" + (i + 2)).join(",")})`, [user.id, ...kinds]);
    } else await db.run("UPDATE notifications SET read=1 WHERE user_id=$1", [user.id]);
    return { ok: true, unread: Number((await db.get("SELECT COUNT(*) c FROM notifications WHERE user_id=$1 AND read=0", [user.id])).c) };
  }

  /* ---------- push subscriptions ---------- */
  async function subscribe(user, b, ua) {
    const endpoint = str(b?.endpoint, 1000, { required: true }), p256dh = str(b?.keys?.p256dh, 200, { required: true }), auth = str(b?.keys?.auth, 100, { required: true });
    if (!WP.endpointAllowed(endpoint)) throw E.bad("خدمة الإشعارات غير مدعومة");
    if (WP.unb64u(p256dh).length !== 65 || WP.unb64u(auth).length !== 16) throw E.bad("مفاتيح الاشتراك غير صالحة");
    const cnt = Number((await db.get("SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=$1", [user.id])).n);
    if (cnt >= 20) await db.run("DELETE FROM push_subscriptions WHERE id=(SELECT id FROM push_subscriptions WHERE user_id=$1 ORDER BY created_at LIMIT 1)", [user.id]);
    const sid = id("ps");
    await db.run(`INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,ua,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (endpoint) DO UPDATE SET user_id=$2, p256dh=$4, auth=$5, ua=$6, fail_count=0`, [sid, user.id, endpoint, p256dh, auth, String(ua || "").slice(0, 200), now()]);
    return { ok: true, subscriptions: Number((await db.get("SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=$1", [user.id])).n) };
  }

  /* ---------- event subscriptions (moved from messaging.js) ---------- */
  bus.on("POST_REACTED", async e => { const p = await db.get("SELECT id FROM posts WHERE id=$1", [e.target]); await notify(e.owner, "reaction", { actor: e.actor, post: p ? e.target : null, ref: e.target }); });
  bus.on("COMMENT_CREATED", async e => { await notify(e.postAuthor, "comment", { actor: e.actor, post: e.post }); if (e.parentAuthor && e.parentAuthor !== e.postAuthor) await notify(e.parentAuthor, "reply", { actor: e.actor, post: e.post }); });
  bus.on("USER_FOLLOWED", e => notify(e.to, "follow", { actor: e.from }));
  bus.on("USER_MENTIONED", e => notify(e.user, "mention", { actor: e.actor, post: e.post }));
  bus.on("COMMUNITY_JOIN_REQUESTED", e => notify(e.owner, "join_request", { actor: e.actor, ref: e.community }));
  bus.on("COMMUNITY_JOINED", e => e.approvedBy ? notify(e.actor, "approved", { actor: e.approvedBy, ref: e.community }) : null);
  bus.on("POST_APPROVED", e => notify(e.author, "post_approved", { actor: e.actor, post: e.post }));
  bus.on("INVITE_SENT", e => notify(e.to, "invite", { actor: e.actor, ref: e.ref }));
  bus.on("EVENT_REMINDER", e => notify(e.user, "event", { actor: e.actor, ref: e.event }));
  bus.on("VIDEO_PROCESSED", e => notify(e.author, "video", { post: e.post }));
  bus.on("POST_PUBLISHED", e => e.scheduled ? notify(e.post.author, "scheduled", { post: e.post.id }) : null);
  bus.on("CONTENT_REMOVED", e => notify(e.user, "removed", { post: e.post, ref: e.decision }));
  bus.on("USER_REGISTERED", e => notify(e.user, "welcome", { actor: null }));
  /* communication events (chat / calls are built alongside; payloads accepted in a few shapes):
   * MESSAGE_RECEIVED { to|user|recipients, actor|from, conv } · MESSAGE_SENT { conv, actor } (fan-out to members)
   * MESSAGE_REQUEST { to|user, actor|from, conv } · CALL_INCOMING / CALL_MISSED { to|user|recipients, actor|from, call } */
  const recipients = (e) => [].concat(e.recipients || e.to || e.user || e.users || []).filter(Boolean);
  const recent = new Map(); // de-duplicates MESSAGE_SENT + MESSAGE_RECEIVED for the same delivery
  const once = (k, ms = 3000) => { const t = Date.now(); for (const [x, at] of recent) if (t - at > ms) recent.delete(x); if (recent.has(k)) return false; recent.set(k, t); return true; };
  async function messageNotify(to, actor, conv, request, msg = null) {
    if (!once(`m:${to}:${conv}:${actor}:${msg || ""}`)) return; // per message: consecutive messages each notify
    await notify(to, request ? "message_request" : "message", { actor, ref: conv || null });
  }
  bus.on("MESSAGE_RECEIVED", async e => { const req = [].concat(e.request || []); for (const to of recipients(e)) await messageNotify(to, e.actor || e.from, e.conv || e.conversation, Array.isArray(e.request) ? req.includes(to) : !!e.request, e.message || null); });
  bus.on("MESSAGE_SENT", async e => {
    if (!e.conv || !e.actor) return;
    const rows = await db.all("SELECT * FROM conversation_members WHERE conv=$1 AND user_id<>$2", [e.conv, e.actor]).catch(() => []);
    for (const r of rows) if (!r.muted && !r.muted_until) await messageNotify(r.user_id, e.actor, e.conv, r.state === "request", e.message || null);
  });
  bus.on("MESSAGE_REQUEST", async e => { for (const to of recipients(e)) await messageNotify(to, e.actor || e.from, e.conv || e.conversation, true); });
  bus.on("CALL_INCOMING", async e => { for (const to of recipients(e)) await notify(to, "call", { actor: e.actor || e.from, ref: e.call || e.id || null }); });
  bus.on("CALL_MISSED", async e => { for (const to of recipients(e)) await notify(to, "call_missed", { actor: e.actor || e.from, ref: e.call || e.id || null }); });

  /* ---------- routes ---------- */
  const r = ctx.router, A = ctx.requireUser;
  r.get("/api/notifications", A(async (req) => {
    if (req.query.view === "center") return center(req.user, { tab: req.query.tab || "all", sort: req.query.sort === "new" ? "new" : "rank", limit: req.query.limit });
    return { notifications: await db.all("SELECT id, user_id AS \"user\", kind, actor, post, ref, read, created_at AS at, importance FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [req.user.id]) };
  }));
  r.post("/api/notifications/read", A(async (req) => markRead(req.user, req.body)));
  r.get("/api/notify/settings", A(async (req) => settingsView(req.user)));
  r.put("/api/notify/settings", A(async (req) => { await saveSettings(req.user.id, req.body); return settingsView(req.user); }));
  r.get("/api/push/vapid", async () => ({ publicKey: (await vapid()).publicKey }));
  r.post("/api/push/subscribe", A(async (req) => subscribe(req.user, req.body, req.headers["user-agent"])));
  r.post("/api/push/unsubscribe", A(async (req) => { await db.run("DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2", [req.user.id, str(req.body.endpoint, 1000, { required: true })]); return { ok: true }; }));
  r.post("/api/push/test", A(async (req) => {
    const subs = await db.all("SELECT id FROM push_subscriptions WHERE user_id=$1", [req.user.id]); if (!subs.length) throw E.bad("فعّل الإشعارات على هذا الجهاز أولاً");
    const n = { id: id("nt"), user: req.user.id, kind: "test", importance: 50, groupKey: "test" };
    for (const s of subs) await queue.enqueue("notify.push", { did: await delivery(n, "push", s.id, "queued"), sub: s.id, n, test: true });
    return { ok: true, devices: subs.length };
  }));
  r.get("/api/notify/stats", A(async (req) => {
    if (req.user.role !== "admin") throw E.forbid();
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const rows = await db.all("SELECT channel, status, COUNT(*) n FROM notify_deliveries WHERE created_at > $1 GROUP BY channel, status", [since]);
    return { since, deliveries: rows.map(x => ({ ...x, n: Number(x.n) })), subscriptions: Number((await db.get("SELECT COUNT(*) n FROM push_subscriptions")).n), vapid: (await vapid().catch(() => ({ source: "none" }))).source, queue: await queue.stats() };
  }));

  return { notify, settings, saveSettings, center, markRead, vapid, subscribe };
};
