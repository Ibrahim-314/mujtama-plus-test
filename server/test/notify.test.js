/* Track 6 — smart notifications (Phase 28): grouping («أحمد و5 آخرون…»), tabs, importance ranking,
 * per-kind channel preferences (with locked security channels), quiet hours in the user's timezone
 * (defer + urgent bypass), Web Push against a local fake push service (RFC 8291 payload decrypted,
 * RFC 8292 VAPID JWT verified), durable queue retry/backoff, 404/410 pruning, chat → notifications. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto"), http = require("node:http");
const { boot } = require("./helpers");
const WP = require("../lib/webpush");
const { sseConnect } = require("./ws-client");

let H, A, B, C, push;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mk = async (handle, name) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; c.name = r.user.name; return c; };
const db = () => H.app.ctx.db;
async function until(fn, ms = 8000, label = "condition") { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(50); } throw new Error("timeout: " + label + " last=" + JSON.stringify(v)); }
/** make every due-later job of a kind due now (skips the real backoff wait) and remember its delay */
async function hurry(kind) { const rows = await db().all("SELECT id, run_after FROM media_jobs WHERE kind=$1 AND status='queued'", [kind]); await db().run("UPDATE media_jobs SET run_after=$1 WHERE kind=$2 AND status='queued'", [new Date(Date.now() - 1000).toISOString(), kind]); return rows.map(r => Date.parse(r.run_after) - Date.now()); }

/* ---------- a local fake push service: decrypts with the UA keys, verifies VAPID ---------- */
function fakePush() {
  const got = [], plan = []; // plan: queued status codes to answer with (default 201)
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      const status = plan.length ? plan.shift() : 201;
      got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks), status });
      res.writeHead(status, status === 429 ? { "Retry-After": "1" } : {}); res.end();
    });
  });
  return { srv, got, plan, async start() { await new Promise(r => srv.listen(0, "127.0.0.1", r)); this.origin = "http://127.0.0.1:" + srv.address().port; return this; } };
}
function uaKeys() { const e = crypto.createECDH("prime256v1"); e.generateKeys(); return { priv: WP.b64u(e.getPrivateKey()), p256dh: WP.b64u(e.getPublicKey()), auth: WP.b64u(crypto.randomBytes(16)) }; }
function verifyVapid(authz, expectedAud) {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(authz || ""); assert.ok(m, "vapid Authorization header: " + authz);
  const pub = WP.unb64u(m[4]);
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: WP.b64u(pub.subarray(1, 33)), y: WP.b64u(pub.subarray(33)) }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(m[1] + "." + m[2]), { key, dsaEncoding: "ieee-p1363" }, WP.unb64u(m[3])), "ES256 signature verifies");
  const claims = JSON.parse(WP.unb64u(m[2])); assert.equal(claims.aud, expectedAud); assert.match(claims.sub, /^(mailto:|https:)/); assert.ok(claims.exp * 1000 > Date.now() && claims.exp * 1000 <= Date.now() + 24 * 3600e3 + 5000);
  return { claims, k: m[4] };
}
const decode = (rec, keys) => JSON.parse(WP.decrypt(rec.body, { uaPrivateKey: keys.priv, auth: keys.auth }).toString());

test.before(async () => {
  process.env.NOTIFY_EMAIL_DELAY_MS = "0";
  push = await fakePush().start();
  H = await boot({ queuePollMs: 100 });
  A = await mk("ntf_a", "أحمد"); B = await mk("ntf_b", "سارة"); C = await mk("ntf_c", "خالد");
});
test.after(async () => { await H.app.close(); push.srv.close(); });
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("grouping in the center: six likers collapse into «… و5 آخرون أعجبهم منشورك», tabs, read by tab/ids", async () => {
  const post = (await A.req("POST", "/api/posts", { text: "منشور للاختبار عن الإشعارات" })).post;
  const likers = [B, C]; for (let i = 0; i < 4; i++) likers.push(await mk("liker_" + i, "معجب " + i));
  for (const u of likers) { const r = await u.req("PUT", `/api/reactions/${post.id}`, { type: "like" }); assert.equal(r.status, 200, r.error); await sleep(5); }
  await C.req("PUT", `/api/follows/${A.id}`);
  const center = await until(async () => { const c = await A.req("GET", "/api/notifications?view=center"); return c.groups?.find(g => g.kind === "reaction" && g.count === 6) && c.groups.find(g => g.kind === "follow") ? c : null; }, 5000, "grouped reactions + follow");
  const g = center.groups.find(x => x.kind === "reaction");
  assert.equal(g.ids.length, 6); assert.equal(g.actors.length, 3, "three avatars at most");
  assert.equal(g.text, `${g.actors[0].name} و5 آخرون أعجبهم منشورك`);
  assert.equal(g.actors[0].name, "معجب 3", "newest actor first"); assert.equal(g.href, `/#/post/${post.id}`); assert.equal(g.tab, "interactions");
  const tab = (k) => center.tabs.find(t => t.key === k);
  assert.ok(tab("all").unread >= 7); assert.equal(tab("interactions").unread, 6); assert.equal(tab("follows").unread, 1);
  const follows = await A.req("GET", "/api/notifications?view=center&tab=follows"); assert.ok(follows.groups.every(x => x.tab === "follows")); assert.equal(follows.groups[0].text, "خالد بدأ بمتابعتك");
  const r1 = await A.req("POST", "/api/notifications/read", { tab: "interactions" }); assert.equal(r1.ok, true);
  const after = await A.req("GET", "/api/notifications?view=center");
  assert.equal(after.tabs.find(t => t.key === "interactions").unread, 0); assert.equal(after.tabs.find(t => t.key === "follows").unread, 1);
  const fid = follows.groups[0].ids[0];
  assert.equal((await A.req("POST", "/api/notifications/read", { ids: [fid] })).unread, after.unread - 1);
  assert.equal((await B.req("POST", "/api/notifications/read", { ids: [fid] })).status, 200); // other users' ids are silently ignored
  assert.equal((await db().get("SELECT read FROM notifications WHERE id=$1", [fid])).read, 1);
  // legacy list keeps working for older clients
  const legacy = await A.req("GET", "/api/notifications"); assert.ok(Array.isArray(legacy.notifications)); assert.ok(legacy.notifications[0].importance >= 0);
});

test("importance: relationship raises it, security outranks interactions, ranking sorts unread-important first", async () => {
  const U = await mk("ntf_imp"), F = await mk("ntf_friend"), S = await mk("ntf_stranger");
  await U.req("PUT", `/api/follows/${F.id}`); await F.req("PUT", `/api/follows/${U.id}`); // mutual
  const p = (await U.req("POST", "/api/posts", { text: "منشور الأهمية" })).post;
  await S.req("PUT", `/api/reactions/${p.id}`, { type: "like" });
  await F.req("PUT", `/api/reactions/${p.id}`, { type: "like" });
  await H.app.ctx.services.notify.notify(U.id, "security_login", { ref: "Chrome · الرياض" });
  const rows = await until(async () => { const r = await db().all("SELECT actor, kind, importance FROM notifications WHERE user_id=$1 AND kind IN ('reaction','security_login')", [U.id]); return r.length >= 3 ? r : null; });
  const imp = (actor) => rows.find(r => r.actor === actor && r.kind === "reaction").importance;
  assert.ok(imp(F.id) > imp(S.id), `mutual friend (${imp(F.id)}) > stranger (${imp(S.id)})`);
  assert.equal(rows.find(r => r.kind === "security_login").importance, 95);
  const c = await U.req("GET", "/api/notifications?view=center");
  assert.equal(c.groups[0].kind, "security_login"); assert.equal(c.groups[0].important, true); assert.equal(c.groups[0].href, "/#/security");
  const byNew = await U.req("GET", "/api/notifications?view=center&sort=new"); assert.equal(byNew.sort, "new");
  assert.ok(byNew.groups.every((g, i, a) => i === 0 || a[i - 1].at >= g.at), "chronological when asked");
});

test("per-kind preferences: in-app off suppresses, locked security channels stay on, validation, legacy prefs honoured", async () => {
  const U = await mk("ntf_prefs"), X = await mk("ntf_px");
  const s0 = await U.req("GET", "/api/notify/settings");
  assert.ok(s0.kinds.length >= 25); assert.equal(s0.quiet.tz, "Asia/Riyadh"); assert.match(s0.push.publicKey, /^[\w-]{87}$/);
  const sec = s0.kinds.find(k => k.kind === "security_login"); assert.deepEqual(sec.lock.sort(), ["email", "inapp"]);
  const s1 = await U.req("PUT", "/api/notify/settings", { channels: { follow: { inapp: 0, push: 0 }, security_login: { inapp: 0, email: 0, push: 0 }, bogus_kind: { inapp: 1 } } });
  assert.equal(s1.status, 200, s1.error);
  const f = s1.kinds.find(k => k.kind === "follow"); assert.equal(f.inapp, 0); assert.equal(f.push, 0);
  const sl = s1.kinds.find(k => k.kind === "security_login"); assert.equal(sl.inapp, 1); assert.equal(sl.email, 1); assert.equal(sl.push, 0, "unlocked push can be turned off");
  assert.ok(!s1.kinds.some(k => k.kind === "bogus_kind"));
  await X.req("PUT", `/api/follows/${U.id}`); await sleep(150);
  assert.equal((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind='follow'", [U.id])).n * 1, 0, "follow notification suppressed");
  await H.app.ctx.services.notify.notify(U.id, "security_login", {});
  assert.equal((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind='security_login'", [U.id])).n * 1, 1, "security still lands in-app");
  assert.equal((await U.req("PUT", "/api/notify/settings", { quiet: { start: "25:00" } })).status, 400);
  assert.equal((await U.req("PUT", "/api/notify/settings", { quiet: { tz: "Mars/Olympus" } })).status, 400);
  // pre-v2.7 per-kind switch (prefs.settings.notify[kind] === false) still turns a kind off
  const L2 = await mk("ntf_legacy"); await L2.req("PUT", "/api/me/prefs", { settings: { notify: { follow: false } } });
  await X.req("PUT", `/api/follows/${L2.id}`); await sleep(150);
  assert.equal((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind='follow'", [L2.id])).n * 1, 0);
  // blocked / muted actors never notify
  const M = await mk("ntf_mutee"); await U.req("PUT", "/api/notify/settings", { channels: { follow: { inapp: 1 } } });
  await U.req("PUT", "/api/me/prefs", { muted: { users: [M.id] } }); await M.req("PUT", `/api/follows/${U.id}`); await sleep(150);
  assert.equal((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND actor=$2", [U.id, M.id])).n * 1, 0, "muted actor");
});

test("realtime toast payload: SSE notification carries Arabic text, href and actor info", async () => {
  const U = await mk("ntf_rt"), X = await mk("ntf_rtx", "منى");
  const sse = await sseConnect(H.base, U.cookie);
  await X.req("PUT", `/api/follows/${U.id}`);
  const ev = await sse.wait(e => e.type === "notification" && e.data.kind === "follow", 3000, "notification toast");
  assert.equal(ev.data.text, "منى بدأ بمتابعتك"); assert.equal(ev.data.actorInfo.name, "منى"); assert.equal(ev.data.href, "/#/notifications"); assert.ok(ev.data.importance > 0);
  sse.close();
});

test("Web Push: subscribe validation, delivery to a local push service (RFC 8291 payload + VAPID ES256), grouping tag, test push, unsubscribe", async () => {
  const U = await mk("ntf_push"), X = await mk("ntf_pushx", "ليلى"), Y = await mk("ntf_pushy", "عمر");
  const vk = (await U.req("GET", "/api/push/vapid")).publicKey; assert.equal(WP.unb64u(vk).length, 65);
  const k = uaKeys();
  assert.equal((await U.req("POST", "/api/push/subscribe", { endpoint: push.origin + "/p/u1", keys: { p256dh: WP.b64u(crypto.randomBytes(20)), auth: k.auth } })).status, 400, "bad p256dh");
  assert.equal((await U.req("POST", "/api/push/subscribe", { endpoint: "ftp://x/y", keys: { p256dh: k.p256dh, auth: k.auth } })).status, 400, "endpoint scheme");
  const s = await U.req("POST", "/api/push/subscribe", { endpoint: push.origin + "/p/u1", keys: { p256dh: k.p256dh, auth: k.auth } }); assert.equal(s.status, 200, s.error); assert.equal(s.subscriptions, 1);
  assert.equal((await U.req("POST", "/api/push/subscribe", { endpoint: push.origin + "/p/u1", keys: { p256dh: k.p256dh, auth: k.auth } })).subscriptions, 1, "idempotent per endpoint");
  push.got.length = 0;
  const p = (await U.req("POST", "/api/posts", { text: "منشور الدفع" })).post;
  await X.req("PUT", `/api/reactions/${p.id}`, { type: "like" });
  const rec = await until(() => push.got.find(g => g.path === "/p/u1"), 8000, "push delivered");
  assert.equal(rec.headers["content-encoding"], "aes128gcm"); assert.equal(rec.headers["content-type"], "application/octet-stream");
  assert.ok(+rec.headers.ttl > 0); assert.ok(["very-low", "low", "normal", "high"].includes(rec.headers.urgency));
  const { k: kHdr } = verifyVapid(rec.headers.authorization, push.origin); assert.equal(kHdr, vk, "k= is the advertised VAPID key");
  const body = decode(rec, k);
  assert.equal(body.title, "مجتمع بلس"); assert.equal(body.body, "ليلى أعجبه منشورك"); assert.equal(body.url, `/#/post/${p.id}`); assert.equal(body.tag, `reaction:${p.id}`); assert.ok(body.badge >= 1);
  await until(async () => (await db().get("SELECT status FROM notify_deliveries WHERE user_id=$1 AND channel='push' ORDER BY created_at DESC LIMIT 1", [U.id]))?.status === "sent", 3000, "delivery marked sent");
  // a second liker → the push shows the whole group under the same tag so the OS replaces the banner
  await Y.req("PUT", `/api/reactions/${p.id}`, { type: "like" });
  const rec2 = await until(() => push.got.filter(g => g.path === "/p/u1")[1], 8000, "second push");
  const b2 = decode(rec2, k); assert.equal(b2.tag, body.tag); assert.equal(b2.body, "عمر وليلى أعجبهما منشورك", "Arabic dual for two actors");
  // test push endpoint
  const t = await U.req("POST", "/api/push/test"); assert.equal(t.devices, 1);
  const rec3 = await until(() => push.got.filter(g => g.path === "/p/u1").find(g => decode(g, k).kind === "test"), 8000, "test push"); assert.match(decode(rec3, k).body, /إشعار تجريبي/);
  assert.equal((await X.req("POST", "/api/push/test")).status, 400, "no subscription → helpful error");
  assert.equal((await U.req("POST", "/api/push/unsubscribe", { endpoint: push.origin + "/p/u1" })).ok, true);
  assert.equal((await U.req("GET", "/api/notify/settings")).push.subscriptions, 0);
});

test("push delivery queue: 503 retried with exponential backoff, 410 prunes the subscription, 400 is final", async () => {
  const U = await mk("ntf_retry"), X = await mk("ntf_retryx");
  const k = uaKeys();
  await U.req("POST", "/api/push/subscribe", { endpoint: push.origin + "/p/retry", keys: { p256dh: k.p256dh, auth: k.auth } });
  push.plan.push(503);
  await X.req("PUT", `/api/follows/${U.id}`);
  await until(() => push.got.find(g => g.path === "/p/retry" && g.status === 503), 8000, "first attempt 503");
  const d1 = await until(async () => { const d = await db().get("SELECT * FROM notify_deliveries WHERE user_id=$1 AND channel='push'", [U.id]); return d?.status === "retrying" ? d : null; }, 3000, "retrying");
  assert.match(d1.error, /503/);
  const job = await until(async () => (await db().all("SELECT * FROM media_jobs WHERE kind='notify.push' AND status='queued'")).find(j => JSON.stringify(j.payload).includes(d1.id)), 3000, "requeued job");
  assert.equal(job.attempts, 1); assert.match(job.error, /503/);
  const delays = await hurry("notify.push"); assert.ok(delays.some(ms => ms > 2500 && ms <= 4100), "backoff 2 s × 2^attempt ≈ 4 s, got " + delays);
  await until(() => push.got.filter(g => g.path === "/p/retry" && g.status === 201).length === 1, 8000, "retry succeeded");
  const d2 = await until(async () => { const d = await db().get("SELECT * FROM notify_deliveries WHERE id=$1", [d1.id]); return d.status === "sent" ? d : null; }, 3000, "sent after retry");
  assert.equal(d2.attempts, 2);
  // 410 Gone → the subscription is deleted
  push.plan.push(410);
  await H.app.ctx.services.notify.notify(U.id, "mention", { actor: X.id });
  await until(async () => !(await db().get("SELECT id FROM push_subscriptions WHERE user_id=$1", [U.id])), 8000, "subscription pruned");
  assert.ok((await db().all("SELECT status FROM notify_deliveries WHERE user_id=$1", [U.id])).some(d => d.status === "gone"));
  // 400 → failed, not retried
  await U.req("POST", "/api/push/subscribe", { endpoint: push.origin + "/p/bad", keys: { p256dh: k.p256dh, auth: k.auth } });
  push.plan.push(400);
  const n = await H.app.ctx.services.notify.notify(U.id, "mention", { actor: X.id });
  const fd = await until(async () => { const d = await db().get("SELECT * FROM notify_deliveries WHERE notification=$1", [n.id]); return d?.status === "failed" ? d : null; }, 8000, "failed");
  assert.match(fd.error, /400/);
  await sleep(300); assert.equal(push.got.filter(g => g.path === "/p/bad").length, 1, "no retry for 4xx");
});

test("quiet hours: push deferred to the end of the window in the user's timezone; urgent calls bypass; in-app still recorded", async () => {
  const U = await mk("ntf_quiet"), X = await mk("ntf_quietx", "ريم");
  const k = uaKeys();
  await U.req("POST", "/api/push/subscribe", { endpoint: push.origin + "/p/quiet", keys: { p256dh: k.p256dh, auth: k.auth } });
  // a two-hour window around "now" in Asia/Riyadh
  const nowMin = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + 180) % 1440, fmt = (m) => String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, "0") + ":" + String(((m + 1440) % 1440) % 60).padStart(2, "0");
  const q = await U.req("PUT", "/api/notify/settings", { quiet: { enabled: true, start: fmt(nowMin - 60), end: fmt(nowMin + 60), tz: "Asia/Riyadh" } });
  assert.equal(q.quiet.enabled, true);
  await X.req("PUT", `/api/follows/${U.id}`);
  const d = await until(() => db().get("SELECT * FROM notify_deliveries WHERE user_id=$1 AND channel='push'", [U.id]), 3000, "delivery row");
  assert.equal(d.status, "deferred");
  const jobs = (await db().all("SELECT * FROM media_jobs WHERE kind='notify.push' AND status='queued'")).filter(j => JSON.stringify(j.payload).includes(d.id));
  assert.equal(jobs.length, 1); const wait = Date.parse(jobs[0].run_after) - Date.now();
  assert.ok(wait > 55 * 60e3 && wait <= 61 * 60e3, "deferred until the window ends (~60 min), got " + Math.round(wait / 60e3) + " min");
  assert.ok((await db().get("SELECT id FROM notifications WHERE user_id=$1 AND kind='follow'", [U.id])), "in-app notification recorded immediately");
  // the job re-checks quiet hours when it runs: still quiet → deferred again, nothing sent
  await hurry("notify.push"); await sleep(600);
  assert.ok(!push.got.some(g => g.path === "/p/quiet" && decode(g, k).kind === "follow"), "nothing pushed during quiet hours");
  // an incoming call (importance 100) is urgent and goes out at once
  H.app.ctx.bus.emit("CALL_INCOMING", { to: U.id, from: X.id, call: "cl_test1" });
  const rec = await until(() => push.got.find(g => g.path === "/p/quiet"), 8000, "urgent push");
  const b = decode(rec, k); assert.equal(b.kind, "call"); assert.equal(b.body, "ريم يتصل بك الآن"); assert.equal(rec.headers.urgency, "high"); assert.equal(rec.headers.ttl, "60");
  // urgent bypass can be switched off
  await U.req("PUT", "/api/notify/settings", { quiet: { allowUrgent: false } });
  const before = push.got.filter(g => g.path === "/p/quiet").length;
  H.app.ctx.bus.emit("CALL_INCOMING", { to: U.id, from: X.id, call: "cl_test2" }); await sleep(500);
  assert.equal(push.got.filter(g => g.path === "/p/quiet").length, before);
  await U.req("PUT", "/api/notify/settings", { quiet: { enabled: false } });
});

test("chat → notifications: one per message, request vs inbox kinds, encrypted messages never leak plaintext into pushes", async () => {
  const U = await mk("ntf_chat"), X = await mk("ntf_chatx", "هالة");
  const k = uaKeys();
  await U.req("POST", "/api/push/subscribe", { endpoint: push.origin + "/p/chat", keys: { p256dh: k.p256dh, auth: k.auth } });
  const cv = (await X.req("POST", "/api/conversations", { user: U.id })).conversation; assert.equal(cv.request, true);
  await X.req("POST", `/api/chat/conversations/${cv.id}/messages`, { text: "سرّ لا يجب أن يظهر في الإشعار" });
  const req = await until(async () => db().get("SELECT * FROM notifications WHERE user_id=$1 AND kind='message_request'", [U.id]), 3000, "message_request");
  assert.equal(req.ref, cv.id);
  await sleep(300);
  assert.equal((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind IN ('message','message_request')", [U.id])).n * 1, 1, "MESSAGE_RECEIVED + MESSAGE_SENT de-duplicated");
  const rec = await until(() => push.got.find(g => g.path === "/p/chat"), 8000, "message push");
  const b = decode(rec, k); assert.equal(b.body, "هالة يريد مراسلتك"); assert.equal(b.url, `/#/chat/${cv.id}`);
  assert.ok(!rec.body.toString("latin1").includes("سر") && !JSON.stringify(b).includes("سرّ"), "message text never in the push");
  await U.req("POST", `/api/conversations/${cv.id}/accept`);
  push.got.length = 0;
  await X.req("POST", `/api/chat/conversations/${cv.id}/messages`, { text: "رسالة ثانية" });
  const rec2 = await until(() => push.got.find(g => g.path === "/p/chat"), 8000, "message push 2");
  const b2 = decode(rec2, k); assert.equal(b2.kind, "message"); assert.equal(b2.body, "هالة أرسل إليك رسالة"); assert.equal(rec2.headers.urgency, "high");
  assert.ok(!JSON.stringify(b2).includes("رسالة ثانية"));
  // message kind is push-only by default: no in-app row
  assert.equal((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind='message'", [U.id])).n * 1, 0);
  // missed calls group per caller
  H.app.ctx.bus.emit("CALL_MISSED", { to: U.id, from: X.id, call: "cl_m1" }); H.app.ctx.bus.emit("CALL_MISSED", { to: U.id, from: X.id, call: "cl_m2" });
  await until(async () => (await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind='call_missed'", [U.id])).n * 1 === 2, 3000, "missed calls");
  const c = await U.req("GET", "/api/notifications?view=center&tab=messages"); assert.ok(c.groups.some(g => g.kind === "call_missed"));
});

test("v2.62 auto-guard: strike + lock notifications carry «تحذير n من max» and the mute, deep link to the community, honour prefs", async () => {
  const U = await mk("ntf_guard"), NL = require("../lib/notify-lib");
  const ns = H.app.ctx.services.notify;
  await ns.notify(U.id, "autoguard_strike", { ref: NL.guardRef("c_guardtest", { n: 2, max: 3, hours: 1 }) });
  await ns.notify(U.id, "autoguard_lock", { ref: "c_guardtest" });
  const c = await U.req("GET", "/api/notifications?view=center&tab=communities");
  const st = c.groups.find(g => g.kind === "autoguard_strike"), lk = c.groups.find(g => g.kind === "autoguard_lock");
  assert.equal(st.text, "تحذير 2 من 3 في المجتمع: لم يُنشر نصك لاحتوائه عبارة ممنوعة · لا يمكنك الكتابة لمدة ساعة");
  assert.equal(st.href, "/#/c/c_guardtest"); assert.equal(lk.href, "/#/c/c_guardtest");
  assert.equal(lk.text, "أُوقفت عن الكتابة في المجتمع حتى يرفع مشرف الإيقاف");
  const s0 = await U.req("GET", "/api/notify/settings");
  assert.ok(s0.kinds.find(k => k.kind === "autoguard_strike" && k.tab === "communities" && k.label));
  assert.equal((await U.req("PUT", "/api/notify/settings", { channels: { autoguard_strike: { inapp: 0, push: 0, email: 0 } } })).status, 200);
  assert.equal(await ns.notify(U.id, "autoguard_strike", { ref: NL.guardRef("c_guardtest", { n: 3, max: 3, hours: 0 }) }), null, "turned off → not written");
});

test("admin stats require admin; anonymous VAPID key is public", async () => {
  const N = await mk("ntf_nonadmin"); assert.equal((await N.req("GET", "/api/notify/stats")).status, 403);
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [A.id]);
  const s = await A.req("GET", "/api/notify/stats"); assert.equal(s.status, 200, s.error); assert.equal(s.vapid, "db", "generated once and kept in notify_keys"); assert.ok(s.deliveries.length > 0); assert.ok(s.subscriptions >= 0);
  assert.equal((await new H.Client().req("GET", "/api/push/vapid")).publicKey, (await A.req("GET", "/api/push/vapid")).publicKey);
});
