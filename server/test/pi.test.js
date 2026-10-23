/* Phase 36 — Full Pi integration (+ 36b: Pi App Studio sign-in, headers, validation file). Runs against a stubbed Pi Platform API (fetch injected through config.piOpts),
 * on SQLite by default and on PostgreSQL with TEST_DATABASE_URL. Covers: config + mainnet guard, 501 when off,
 * token verification via the App Studio login exchange (browser-supplied uid/username ignored), sign-in / needsLink / linking / unlinking, payment intents, approve/complete with
 * owner/network/amount/txid checks and idempotency, cancel, incomplete payments, legacy routes in platform.js,
 * wallet cursor pagination, receipts, refunds, reconciliation (admin + daily job), migration down/up + backfill,
 * that no key or access token is ever stored or echoed, CSP / frame-ancestors / no X-Frame-Options, session cookie flags in
 * production, the CSRF exemption of the Pi login endpoint only, and /pi-app-validation.txt served byte-exact. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { Router, inlineScriptHashes } = require("../lib/http");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const APPSTUDIO = "https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login"; // the default (PI_APPSTUDIO_URL unset)
const VALIDATION = "piappstudio-0doEEbpm48dvXdC2lzWE_TFrt8RtptOc";

const KEY = "sk_test_DO_NOT_LEAK_123";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`; // access tokens look like opaque secrets
const piCalls = [];
const payments = new Map();
let seq = 0;
const pay = (o) => { const p = { identifier: "pay_" + (++seq), user_uid: o.uid, amount: o.amount, memo: o.memo || "m", metadata: o.metadata || {}, direction: "user_to_app", network: o.network || "Pi Testnet", created_at: new Date().toISOString(), status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
const onChain = (p, txid, verified = true) => { p.transaction = { txid, verified, _link: "x" }; p.status.transaction_verified = verified; };
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
/* Pi App Studio login stub: at-secret-<uid>-<name> → 200 {sessionToken, user}; "at-secret-down-*" → network error;
 * "at-secret-500-*" → 500; "at-secret-odd-*" → 200 without a user; anything else → 401 */
const studioCalls = [];
async function appStudio(o) {
  const body = JSON.parse(o.body || "{}");
  studioCalls.push({ method: o.method, contentType: o.headers?.["Content-Type"], body, auth: o.headers?.Authorization });
  const t = String(body.accessToken || "");
  if (t.startsWith("at-secret-down-")) throw new TypeError("fetch failed");
  if (t.startsWith("at-secret-500-")) return res(500, { error: "boom" });
  if (t.startsWith("at-secret-odd-")) return res(200, { ok: true });
  const m = /^at-secret-([^-]+)-(.+)$/.exec(t);
  return m ? res(200, { sessionToken: "st-secret-" + m[1], user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, { error: "invalid token" });
}
async function fakeFetch(url, o = {}) {
  if (url === APPSTUDIO) return appStudio(o);
  const u = new URL(url), path = u.pathname, method = o.method || "GET", auth = o.headers?.Authorization || "";
  piCalls.push({ method, path, auth });
  if (path === "/v2/me") {
    const m = /^Bearer at-secret-([^-]+)-(.+)$/.exec(auth);
    return m ? res(200, { uid: "uid_" + m[1], username: m[2], credentials: { scopes: ["username", "payments"] } }) : res(401, { error: "invalid" });
  }
  if (auth !== "Key " + KEY) return res(401, { error: "bad key" });
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path);
  const p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, { error: "payment_not_found" });
  const body = o.body ? JSON.parse(o.body) : {};
  if (!mm[2]) return res(200, JSON.parse(JSON.stringify(p)));
  if (mm[2] === "approve") { if (p.status.cancelled) return res(400, { error: "cancelled" }); p.status.developer_approved = true; }
  if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, { error: "txid" }); p.status.developer_completed = true; }
  if (mm[2] === "cancel") { if (p.status.developer_completed) return res(400, { error: "completed" }); p.status.cancelled = true; }
  return res(200, JSON.parse(JSON.stringify(p)));
}
const ENV = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub", PI_APP_ID: "mujtama-test", PI_MAX_AMOUNT: "100" };

let H, admin, alice, bob, carol, pending;
const db = () => H.app.ctx.db;
const events = [];
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c; };
const linkPi = async (c, uid) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(uid, c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + uid; return r; };
/** intent → Pi payment carrying the intent id (what Pi.createPayment does on the client) */
const startPayment = async (c, amount = 1.5, extra = {}) => { const it = await c.req("POST", "/api/pi/payments", { amount, memo: "دعم صانع المحتوى", purpose: "tip", refId: "post_1", ...extra }); assert.equal(it.status, 200, it.error); const p = pay({ uid: c.uid, amount, metadata: it.metadata }); return { it, p }; };

test.before(async () => {
  H = await boot({ piOpts: { env: ENV, fetch: fakeFetch, jobs: false } });
  // several Pi responses carry a payment `status` field: keep the HTTP status on `.status`, the body on `.body`
  H.Client.prototype.req = async function (method, path, body, headers = {}) {
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const j = await r.json().catch(() => ({})); return { ...j, body: j, status: r.status, headers: r.headers };
  };
  for (const e of ["PI_PAYMENT_COMPLETED", "PI_LINKED", "PI_PAYMENT_CANCELLED"]) H.app.ctx.bus.on(e, (p) => events.push({ e, ...p }));
  admin = await mk("pi_admin"); alice = await mk("pi_alice"); bob = await mk("pi_bob"); carol = await mk("pi_carol");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

const mount = (env, db = null) => { const router = new Router(); const ctx = { db, bus: { on() { }, emit() { } }, rl: { hit: () => true }, router, config: {}, requireUser: (fn) => fn, services: {} }; const s = require("../services/pi")(ctx, { env, fetch: fakeFetch, jobs: false }); return { s, router }; };
test("config: payments off by default (501 everywhere but /config and sign-in), sign-in on by default, testnet default, mainnet only with PI_MAINNET_CONFIRM=1", async () => {
  const off = mount({});
  const cfg = await off.router.match("GET", "/api/pi/config").handler({ query: {} });
  assert.deepEqual(cfg, { enabled: false, authEnabled: true, network: "testnet", sandbox: true });
  for (const [m, p] of [["GET", "/api/pi/wallet"], ["POST", "/api/pi/payments"], ["POST", "/api/pi/payments/approve"], ["POST", "/api/pi/payments/complete"], ["POST", "/api/pi/payments/cancel"], ["POST", "/api/pi/payments/incomplete"], ["GET", "/api/pi/receipts/x"]]) {
    const r = off.router.match(m, p); assert.ok(r, p);
    await assert.rejects(() => r.handler({ user: { id: "u", role: "user" }, body: { paymentId: "p", txid: "t", accessToken: "a", amount: 1, memo: "m", purpose: "tip" }, query: {}, params: r.params, ip: "1" }, {}), (e) => e.status === 501 && e.message === "مدفوعات Pi غير مفعّلة بعد", p);
  }
  // PI_AUTH_ENABLED=0 turns sign-in/linking off too
  const noAuth = mount({ PI_AUTH_ENABLED: "0" });
  assert.deepEqual(await noAuth.router.match("GET", "/api/pi/config").handler({}), { enabled: false, authEnabled: false, network: "testnet", sandbox: true });
  for (const [m, p] of [["POST", "/api/pi/auth"], ["DELETE", "/api/pi/link"], ["GET", "/api/pi/link"]]) {
    const r = noAuth.router.match(m, p);
    await assert.rejects(() => r.handler({ user: { id: "u", role: "user" }, body: { accessToken: "a" }, query: {}, params: {}, ip: "1" }, {}), (e) => e.status === 501 && e.code === "not_configured", p);
  }
  assert.equal(mount({ PI_ENABLED: "1", PI_NETWORK: "mainnet" }).s.network, "testnet", "mainnet without confirmation stays on testnet");
  const main = mount({ PI_ENABLED: "1", PI_NETWORK: "mainnet", PI_MAINNET_CONFIRM: "1" });
  assert.deepEqual(await main.router.match("GET", "/api/pi/config").handler({}), { enabled: true, authEnabled: true, network: "mainnet", sandbox: false });
  const live = await new H.Client().req("GET", "/api/pi/config");
  assert.equal(live.status, 200); assert.deepEqual(live.body, { enabled: true, authEnabled: true, network: "testnet", sandbox: true, appId: "mujtama-test" });
});

test("sign-in works with payments off (PI_ENABLED unset, no API key): App Studio exchange only, payments stay 501", async () => {
  const n0 = studioCalls.length;
  const stubDb = { get: async () => null, run: async () => ({ changes: 0 }), all: async () => [] };
  const only = mount({}, stubDb);
  const r = await only.router.match("POST", "/api/pi/auth").handler({ body: { accessToken: TOKEN("solo", "solo_pi") }, query: {}, ip: "1", headers: {}, csrfOk: true }, {});
  assert.deepEqual(r, { needsLink: true, username: "solo_pi", linked: false });
  assert.equal(studioCalls.length, n0 + 1); assert.equal(studioCalls.at(-1).body.accessToken, TOKEN("solo", "solo_pi"));
  await assert.rejects(() => only.router.match("POST", "/api/pi/payments").handler({ user: { id: "u" }, body: { amount: 1, memo: "m", purpose: "tip" } }), (e) => e.status === 501);
  // a custom PI_APPSTUDIO_URL is honoured; a non-https one is ignored (falls back to the default)
  const seen = []; const spy = (url, o) => { seen.push(url); return appStudio(o); };
  const mk2 = (env) => { const router = new Router(); require("../services/pi")({ db: stubDb, bus: { on() { }, emit() { } }, rl: { hit: () => true }, router, config: {}, requireUser: (fn) => fn, services: {} }, { env, fetch: spy, jobs: false }); return router; };
  await mk2({ PI_APPSTUDIO_URL: "https://studio.example/pi/auth/v1/login" }).match("POST", "/api/pi/auth").handler({ body: { accessToken: TOKEN("c1", "c") }, ip: "1", csrfOk: true }, {});
  await mk2({ PI_APPSTUDIO_URL: "http://evil.example/login" }).match("POST", "/api/pi/auth").handler({ body: { accessToken: TOKEN("c2", "c") }, ip: "1", csrfOk: true }, {});
  assert.deepEqual(seen, ["https://studio.example/pi/auth/v1/login", APPSTUDIO]);
});

test("auth: token exchanged once with Pi App Studio, needsLink for unknown uid, link to the signed-in account, then Pi sign-in", async () => {
  const anon = new H.Client();
  const bad = await anon.req("POST", "/api/pi/auth", { accessToken: "forged" });
  assert.equal(bad.status, 401); assert.equal(bad.code, "pi_invalid"); assert.match(bad.error, /[\u0600-\u06FF]/, "Arabic error");
  assert.equal((await anon.req("POST", "/api/pi/auth", {})).status, 400);
  const n0 = studioCalls.length;
  const nl = await anon.req("POST", "/api/pi/auth", { accessToken: TOKEN("a1", "alice_pi") });
  assert.equal(nl.status, 200); assert.equal(nl.needsLink, true); assert.equal(nl.username, "alice_pi"); assert.equal(anon.cookie, "", "no session for an unlinked Pi account");
  const call = studioCalls.at(-1);
  assert.deepEqual([call.method, call.contentType, call.body, call.auth], ["POST", "application/json", { accessToken: TOKEN("a1", "alice_pi") }, undefined], "POST {accessToken} JSON, nothing else");
  assert.equal(piCalls.filter(c => c.path === "/v2/me").length, 0, "sign-in no longer calls /v2/me");
  assert.ok(!("sessionToken" in nl.body) && !JSON.stringify(nl.body).includes("st-secret"), "App Studio sessionToken never returned");
  const l = await alice.req("POST", "/api/pi/auth", { accessToken: TOKEN("a1", "alice_pi"), link: true });
  assert.equal(studioCalls.length, n0 + 1, "needsLink → link:true with the same token: a single App Studio exchange");
  assert.equal(l.status, 200); assert.equal(l.linked, true); assert.equal(l.piUsername, "alice_pi"); assert.equal(l.user.id, alice.id); alice.uid = "uid_a1";
  assert.equal((await db().get("SELECT pi_uid FROM users WHERE id=$1", [alice.id])).pi_uid, "uid_a1", "users.pi_uid kept in sync for older services");
  assert.equal((await db().get("SELECT status FROM pi_kyc WHERE user_id=$1", [alice.id]))?.status, "linked");
  assert.equal((await alice.req("POST", "/api/pi/auth", { accessToken: TOKEN("a1", "alice_pi"), link: true })).status, 200, "re-linking the same uid is idempotent");
  const taken = await bob.req("POST", "/api/pi/auth", { accessToken: TOKEN("a1", "alice_pi"), link: true });
  assert.equal(taken.status, 409, "a Pi account links to one Mujtama+ account only");
  assert.equal((await alice.req("POST", "/api/pi/auth", { accessToken: TOKEN("zz", "other"), link: true })).status, 409, "must unlink before linking another Pi account");
  const fresh = new H.Client();
  const si = await fresh.req("POST", "/api/pi/auth", { accessToken: TOKEN("a1", "alice_pi") });
  assert.equal(si.status, 200); assert.equal(si.linked, true); assert.equal(si.user.id, alice.id); assert.ok(fresh.cookie.startsWith("mp_session="));
  assert.equal((await fresh.req("GET", "/api/me")).user.id, alice.id);
  await new Promise(r => setTimeout(r, 20)); assert.ok(events.some(e => e.e === "PI_LINKED" && e.user === alice.id));
  await linkPi(bob, "b1");
});

test("auth: uid/username supplied by the browser (body, query, headers) are ignored; only App Studio's user is trusted", async () => {
  // eve owns Pi uid_e1 and tries to pass as alice's Pi account (uid_a1)
  const eve = new H.Client();
  const r = await eve.req("POST", "/api/pi/auth?uid=uid_a1&username=alice_pi", { accessToken: TOKEN("e1", "eve_pi"), uid: "uid_a1", username: "alice_pi", user: { uid: "uid_a1", username: "alice_pi" } }, { "X-Pi-Uid": "uid_a1", "X-Pi-Username": "alice_pi" });
  assert.equal(r.status, 200); assert.equal(r.needsLink, true); assert.equal(r.username, "eve_pi"); assert.equal(eve.cookie, "", "not signed in as alice");
  assert.equal((await eve.req("GET", "/api/me")).status, 401);
  // linking also uses App Studio's uid, not the body's
  const carolLink = await carol.req("POST", "/api/pi/auth", { accessToken: TOKEN("c9", "carol_pi"), link: true, uid: "uid_a1", username: "alice_pi" });
  assert.equal(carolLink.status, 200); assert.equal(carolLink.piUsername, "carol_pi");
  assert.equal((await db().get("SELECT pi_uid FROM pi_links WHERE user_id=$1", [carol.id])).pi_uid, "uid_c9");
  assert.equal((await db().get("SELECT user_id FROM pi_links WHERE pi_uid='uid_a1'")).user_id, alice.id, "alice's link untouched");
  await carol.req("DELETE", "/api/pi/link");
});

test("auth: App Studio non-200 → 401 pi_invalid (Arabic); network error / malformed 200 → 502 pi_upstream; legacy /api/auth/pi uses the same exchange", async () => {
  for (const t of ["at-secret-500-x", "nope"]) {
    const r = await new H.Client().req("POST", "/api/pi/auth", { accessToken: t });
    assert.equal(r.status, 401, t); assert.equal(r.code, "pi_invalid"); assert.match(r.error, /Pi/); assert.ok(!JSON.stringify(r.body).includes(t), "token not echoed");
  }
  for (const t of ["at-secret-down-x", "at-secret-odd-x"]) {
    const r = await new H.Client().req("POST", "/api/pi/auth", { accessToken: t });
    assert.equal(r.status, 502, t); assert.equal(r.code, "pi_upstream");
  }
  const n0 = studioCalls.length, nMe = piCalls.filter(c => c.path === "/v2/me").length;
  const leg = new H.Client(); const r = await leg.req("POST", "/api/auth/pi", { accessToken: TOKEN("l1", "legacy_pi"), uid: "uid_a1" });
  assert.equal(r.status, 200, r.error); assert.ok(leg.cookie.startsWith("mp_session="));
  assert.equal(studioCalls.length, n0 + 1); assert.equal(piCalls.filter(c => c.path === "/v2/me").length, nMe);
  assert.equal((await db().get("SELECT pi_uid FROM users WHERE id=$1", [r.user.id])).pi_uid, "uid_l1");
  assert.equal((await new H.Client().req("POST", "/api/auth/pi", { accessToken: "nope" })).status, 401);
});

test("CSRF: only the Pi login endpoints accept a request without X-Requested-With; link:true and every other route still need it", async () => {
  const noHdr = { "X-Requested-With": "" };
  const anon = new H.Client();
  const si = await anon.req("POST", "/api/pi/auth", { accessToken: TOKEN("a1", "alice_pi") }, noHdr);
  assert.equal(si.status, 200); assert.equal(si.user.id, alice.id, "Pi sign-in without the header (Pi Browser / sandbox frame)");
  assert.equal((await alice.req("POST", "/api/pi/auth", { accessToken: TOKEN("a1", "alice_pi"), link: true }, noHdr)).status, 403, "linking acts on the session: header required");
  assert.equal((await new H.Client().req("POST", "/api/auth/pi", { accessToken: TOKEN("l1", "legacy_pi") }, noHdr)).status, 200, "legacy Pi login exempt too");
  assert.equal((await alice.req("POST", "/api/pi/payments", { amount: 1, memo: "x", purpose: "tip" }, noHdr)).status, 403);
  assert.equal((await alice.req("DELETE", "/api/pi/link", null, noHdr)).status, 403);
  assert.equal((await new H.Client().req("POST", "/api/auth/login", { handle: "pi_alice", password: "secret123" }, noHdr)).status, 403);
});

test("intents: validation, link required, metadata carries the intent id", async () => {
  const notLinked = await carol.req("POST", "/api/pi/payments", { amount: 1, memo: "x", purpose: "tip" });
  assert.equal(notLinked.status, 409); assert.equal(notLinked.code, "pi_not_linked");
  for (const b of [{ amount: 0, memo: "x", purpose: "tip" }, { amount: -1, memo: "x", purpose: "tip" }, { amount: "abc", memo: "x", purpose: "tip" }, { amount: 101, memo: "x", purpose: "tip" }, { amount: 1, memo: "x", purpose: "casino" }, { amount: 1, purpose: "tip" }])
    assert.equal((await alice.req("POST", "/api/pi/payments", b)).status, 400, JSON.stringify(b));
  const it = await alice.req("POST", "/api/pi/payments", { amount: 0.123456789, memo: "اشتراك", purpose: "subscription", refId: "c_9" });
  assert.equal(it.status, 200); assert.match(it.id, /^pit_/); assert.equal(it.amount, 0.1234568, "rounded to Pi's 7 decimals");
  assert.deepEqual(it.metadata, { intentId: it.id }); assert.equal(it.memo, "اشتراك");
  assert.equal((await new H.Client().req("POST", "/api/pi/payments", { amount: 1, memo: "x", purpose: "tip" })).status, 401);
});

test("approve → complete: owner/network/amount/txid verified with Pi, idempotent, receipt + event", async () => {
  const { it, p } = await startPayment(alice, 2);
  const a1 = await alice.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier });
  assert.equal(a1.status, 200, a1.error); assert.equal(a1.status === 200 && a1.ok, true); assert.equal(p.status.developer_approved, true);
  const approveCalls = () => piCalls.filter(c => c.path.endsWith("/approve") && c.path.includes(p.identifier)).length;
  assert.equal(approveCalls(), 1);
  assert.equal((await alice.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier })).status, 200, "approve twice is safe");
  assert.equal(approveCalls(), 1, "no second approve call to Pi");
  assert.ok(piCalls.filter(c => c.path.startsWith("/v2/payments")).every(c => c.auth === "Key " + KEY), "Server API Key used for payment calls");
  assert.equal((await bob.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier })).status, 403, "another user's payment");
  const early = await alice.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_1" });
  assert.equal(early.status, 409); assert.equal(early.code, "pi_unverified");
  onChain(p, "tx_1");
  const wrong = await alice.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_forged" });
  assert.equal(wrong.status, 409); assert.equal(wrong.code, "pi_txid_mismatch");
  const done = await alice.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_1" });
  assert.equal(done.status, 200, done.error); assert.equal(done.receipt.status, "completed"); assert.equal(p.status.developer_completed, true);
  const again = await alice.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_1" });
  assert.equal(again.status, 200); assert.equal(piCalls.filter(c => c.path.endsWith("/complete") && c.path.includes(p.identifier)).length, 1, "complete twice → one Pi call");
  const r = await alice.req("GET", "/api/pi/receipts/" + it.id);
  assert.equal(r.status, 200);
  for (const k of ["id", "amount", "memo", "status", "txid", "network", "createdAt", "completedAt", "piUsername", "purpose", "explorerUrl"]) assert.ok(k in r, k);
  assert.equal(r.amount, 2); assert.equal(r.txid, "tx_1"); assert.equal(r.network, "testnet"); assert.equal(r.piUsername, "alice_pi"); assert.equal(r.purpose, "tip");
  assert.equal(r.explorerUrl, "https://blockexplorer.minepi.com/testnet/tx/tx_1"); assert.ok(r.completedAt);
  assert.equal((await alice.req("GET", "/api/pi/receipts/" + p.identifier)).id, it.id, "receipt by Pi payment id too");
  assert.equal((await bob.req("GET", "/api/pi/receipts/" + it.id)).status, 404);
  assert.equal((await admin.req("GET", "/api/pi/receipts/" + it.id)).status, 200, "staff can open any receipt");
  await new Promise(r2 => setTimeout(r2, 20));
  const ev = events.find(e => e.e === "PI_PAYMENT_COMPLETED" && e.tx === it.id); assert.ok(ev); assert.equal(ev.purpose, "tip"); assert.equal(ev.refId, "post_1");
  const trail = await db().all("SELECT from_status, to_status, source FROM pi_tx_events WHERE tx_id=$1 ORDER BY id", [it.id]);
  assert.deepEqual(trail.map(t => t.to_status), ["created", "approved", "completed"]);
});

test("approve rejects mismatches: amount → failed, foreign owner and wrong network → 403", async () => {
  const it = await alice.req("POST", "/api/pi/payments", { amount: 3, memo: "x", purpose: "tip" });
  const p = pay({ uid: alice.uid, amount: 30, metadata: it.metadata });
  const r = await alice.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier });
  assert.equal(r.status, 409); assert.equal((await db().get("SELECT status, error FROM pi_transactions WHERE id=$1", [it.id])).status, "failed");
  assert.equal(p.status.developer_approved, false, "never approved on Pi");
  const it2 = await alice.req("POST", "/api/pi/payments", { amount: 1, memo: "x", purpose: "tip" });
  const foreign = pay({ uid: "uid_someone", amount: 1, metadata: it2.metadata });
  assert.equal((await alice.req("POST", "/api/pi/payments/approve", { paymentId: foreign.identifier })).status, 403);
  const main = pay({ uid: alice.uid, amount: 1, metadata: it2.metadata, network: "Pi Network" });
  assert.equal((await alice.req("POST", "/api/pi/payments/approve", { paymentId: main.identifier })).status, 403, "mainnet payment refused on a testnet server");
  const stolen = pay({ uid: bob.uid, amount: 1, metadata: it2.metadata });
  assert.equal((await bob.req("POST", "/api/pi/payments/approve", { paymentId: stolen.identifier })).status, 403, "cannot bind someone else's intent");
  assert.equal((await alice.req("POST", "/api/pi/payments/approve", { paymentId: "pay_nope" })).status, 404);
});

test("cancel: approved payment cancelled on Pi and locally, idempotent, cannot complete afterwards; intent-only cancel", async () => {
  const { it, p } = await startPayment(alice, 1);
  await alice.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier });
  const c = await alice.req("POST", "/api/pi/payments/cancel", { paymentId: p.identifier });
  assert.equal(c.status, 200); assert.equal(c.id, it.id); assert.equal(p.status.cancelled, true);
  assert.equal((await alice.req("POST", "/api/pi/payments/cancel", { paymentId: p.identifier })).status, 200);
  onChain(p, "tx_late");
  assert.equal((await alice.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_late" })).status, 409);
  const only = await alice.req("POST", "/api/pi/payments", { amount: 1, memo: "x", purpose: "tip" });
  assert.equal((await bob.req("POST", "/api/pi/payments/cancel", { intentId: only.id })).status, 404);
  assert.equal((await alice.req("POST", "/api/pi/payments/cancel", { intentId: only.id })).status, 200);
  const { p: p2 } = await startPayment(alice, 1); await alice.req("POST", "/api/pi/payments/approve", { paymentId: p2.identifier }); onChain(p2, "tx_moving");
  assert.equal((await alice.req("POST", "/api/pi/payments/cancel", { paymentId: p2.identifier })).status, 409, "a verified transaction is never cancelled");
  await new Promise(r => setTimeout(r, 20)); assert.ok(events.some(e => e.e === "PI_PAYMENT_CANCELLED" && e.tx === it.id));
});

test("incomplete payments: verified txid → completed once; no transaction → cancelled; unverified txid → pending", async () => {
  const { it, p } = await startPayment(alice, 4);
  await alice.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); onChain(p, "tx_inc");
  const forged = { ...JSON.parse(JSON.stringify(p)), transaction: { txid: "tx_client_lies", verified: true } };
  const r = await alice.req("POST", "/api/pi/payments/incomplete", { payment: forged });
  assert.equal(r.status, 200, r.error); assert.equal(r.status === 200 && r.id, it.id); assert.equal(r.txid, "tx_inc", "the txid comes from Pi, not from the client copy");
  assert.equal((await db().get("SELECT status FROM pi_transactions WHERE id=$1", [it.id])).status, "completed");
  const r2 = await alice.req("POST", "/api/pi/payments/incomplete", { payment: { identifier: p.identifier } });
  assert.equal(r2.status, 200); assert.equal(piCalls.filter(c => c.path === `/v2/payments/${p.identifier}/complete`).length, 1, "idempotent: Pi complete called once");
  // created on Pi, never reached the chain (user closed the app) → cancelled
  const { it: it3, p: p3 } = await startPayment(alice, 1); await alice.req("POST", "/api/pi/payments/approve", { paymentId: p3.identifier });
  const c = await alice.req("POST", "/api/pi/payments/incomplete", { payment: { identifier: p3.identifier } });
  assert.equal(c.status, 200); assert.equal(p3.status.cancelled, true); assert.equal((await db().get("SELECT status FROM pi_transactions WHERE id=$1", [it3.id])).status, "cancelled");
  // on chain but not yet verified by Pi → left pending for the reconciliation job
  const { it: it4, p: p4 } = await startPayment(alice, 1); await alice.req("POST", "/api/pi/payments/approve", { paymentId: p4.identifier }); onChain(p4, "tx_wait", false);
  const pend = await alice.req("POST", "/api/pi/payments/incomplete", { payment: { identifier: p4.identifier } });
  assert.equal(pend.status === 200 && pend.ok, true); assert.equal((await db().get("SELECT status FROM pi_transactions WHERE id=$1", [it4.id])).status, "approved"); assert.equal(p4.status.cancelled, false);
  // an incomplete payment unknown locally (e.g. made by the legacy client) is recorded and completed
  const legacy = pay({ uid: alice.uid, amount: 2.5, metadata: { kind: "old" } }); legacy.status.developer_approved = true; onChain(legacy, "tx_old");
  const lr = await alice.req("POST", "/api/pi/payments/incomplete", { payment: { identifier: legacy.identifier } });
  assert.equal(lr.status, 200); assert.equal((await db().get("SELECT purpose, status FROM pi_transactions WHERE payment_id=$1", [legacy.identifier])).status, "completed");
  assert.equal((await bob.req("POST", "/api/pi/payments/incomplete", { payment: { identifier: p4.identifier } })).status, 403);
  assert.equal((await alice.req("POST", "/api/pi/payments/incomplete", { payment: {} })).status, 400);
  // pending one gets verified later → the reconciliation picks it up (asserted below); store id for it
  p4.__id = it4.id; pending = p4;
});

test("legacy routes in platform.js are routed to the new service (old pi-adapter client without an intent)", async () => {
  const route = H.app.ctx.router.routes.find(r => r.method === "POST" && r.re.test("/api/pi/payments/approve"));
  assert.ok(String(route.handler).length > 0);
  const p = pay({ uid: bob.uid, amount: 1.25, memo: "legacy tip", metadata: { postId: "p1" } });
  const a = await bob.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier });
  assert.equal(a.status, 200, a.error); assert.equal(a.ok, true);
  onChain(p, "tx_leg");
  const c = await bob.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_leg" });
  assert.equal(c.status, 200); assert.equal(c.ok, true);
  const row = await db().get("SELECT * FROM pi_transactions WHERE payment_id=$1", [p.identifier]);
  assert.equal(row.purpose, "legacy"); assert.equal(row.status, "completed"); assert.equal(row.user_id, bob.id); assert.equal(row.memo, "legacy tip");
});

test("wallet: history newest first with a stable cursor, status filter, link info, 400 on a bad cursor", async () => {
  await linkPi(carol, "c1");
  for (let i = 0; i < 23; i++) assert.equal((await carol.req("POST", "/api/pi/payments", { amount: i + 1, memo: "n" + i, purpose: "donation" })).status, 200);
  const w1 = await carol.req("GET", "/api/pi/wallet");
  assert.equal(w1.status, 200); assert.equal(w1.piUsername, "pi_carol"); assert.equal(w1.network, "testnet"); assert.ok(w1.balanceNote.length > 10);
  assert.equal(w1.tx.length, 20); assert.ok(w1.nextCursor);
  for (const k of ["id", "paymentId", "amount", "memo", "status", "direction", "createdAt", "txid", "purpose", "refId"]) assert.ok(k in w1.tx[0], k);
  assert.equal(w1.tx[0].status, "created"); assert.equal(w1.tx[0].direction, "out");
  const w2 = await carol.req("GET", "/api/pi/wallet?cursor=" + encodeURIComponent(w1.nextCursor));
  assert.equal(w2.tx.length, 3); assert.equal(w2.nextCursor, null);
  const all = [...w1.tx, ...w2.tx]; assert.equal(new Set(all.map(t => t.id)).size, 23, "no duplicates across pages");
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].createdAt >= all[i].createdAt, "newest first");
  assert.equal((await carol.req("GET", "/api/pi/wallet?cursor=%%%")).status, 400);
  assert.equal((await carol.req("GET", "/api/pi/wallet?limit=5")).tx.length, 5);
  const aw = await alice.req("GET", "/api/pi/wallet?status=completed");
  assert.ok(aw.tx.length >= 2 && aw.tx.every(t => t.status === "completed" && t.txid));
  assert.equal((await new H.Client().req("GET", "/api/pi/wallet")).status, 401);
});

test("refunds: admin records a refund (original → refunded, an incoming row), only for completed payments", async () => {
  const { it, p } = await startPayment(bob, 5);
  await bob.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); onChain(p, "tx_r"); await bob.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_r" });
  assert.equal((await bob.req("POST", `/api/admin/pi/payments/${it.id}/refund`, { note: "x" })).status, 403);
  const r = await admin.req("POST", `/api/admin/pi/payments/${it.id}/refund`, { note: "خطأ في الطلب", txid: "tx_refund" });
  assert.equal(r.status, 200, r.error); assert.equal(r.status === 200 && r.ok, true);
  assert.equal((await admin.req("POST", `/api/admin/pi/payments/${it.id}/refund`, {})).status, 200, "idempotent");
  const w = await bob.req("GET", "/api/pi/wallet");
  const orig = w.tx.find(t => t.id === it.id), back = w.tx.find(t => t.id === r.refundId);
  assert.equal(orig.status, "refunded"); assert.equal(back.direction, "in"); assert.equal(back.status, "completed"); assert.equal(back.purpose, "refund"); assert.equal(back.txid, "tx_refund");
  const open = await bob.req("POST", "/api/pi/payments", { amount: 1, memo: "x", purpose: "tip" });
  assert.equal((await admin.req("POST", `/api/admin/pi/payments/${open.id}/refund`, {})).status, 409);
});

test("reconciliation: admin run fixes drift, reports unfixable mismatches, expires stale intents; stored per date; daily job once", async () => {
  const today = new Date().toISOString().slice(0, 10);
  // A: approved locally, verified on Pi but never completed → fixed (completed)
  const { it: a, p: pa } = await startPayment(alice, 1); await alice.req("POST", "/api/pi/payments/approve", { paymentId: pa.identifier }); onChain(pa, "tx_A");
  // B: approved locally, cancelled on Pi → fixed (cancelled)
  const { it: b, p: pb } = await startPayment(alice, 1); await alice.req("POST", "/api/pi/payments/approve", { paymentId: pb.identifier }); pb.status.cancelled = true;
  // C: completed locally but Pi reports another amount → reported, not touched
  const { it: c, p: pc } = await startPayment(alice, 1); await alice.req("POST", "/api/pi/payments/approve", { paymentId: pc.identifier }); onChain(pc, "tx_C"); await alice.req("POST", "/api/pi/payments/complete", { paymentId: pc.identifier, txid: "tx_C" }); pc.amount = 9;
  // D: the pending one from the incomplete test is now verified
  const pd = pending; pd.transaction.verified = true; pd.status.transaction_verified = true;
  // E: stale intent never handed to Pi
  const e = await alice.req("POST", "/api/pi/payments", { amount: 1, memo: "old", purpose: "tip" });
  await db().run("UPDATE pi_transactions SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 3 * 864e5).toISOString(), e.id]);
  assert.equal((await alice.req("POST", "/api/admin/pi/reconcile", {})).status, 403);
  const run = await admin.req("POST", "/api/admin/pi/reconcile", { date: today });
  assert.equal(run.status, 200, run.error); assert.equal(run.date, today);
  assert.ok(run.checked >= 4); assert.ok(run.fixed >= 3, JSON.stringify(run.mismatched));
  const by = (id) => run.mismatched.find(m => m.id === id);
  assert.equal(by(a.id).issue, "verified_not_completed"); assert.equal(by(a.id).fixed, true);
  assert.equal(by(b.id).issue, "cancelled_on_pi"); assert.equal(by(b.id).fixed, true);
  assert.equal(by(c.id).issue, "amount"); assert.equal(by(c.id).fixed, false);
  assert.equal(by(pd.__id).fixed, true);
  assert.equal(run.expired, 1);
  const st = async (id) => (await db().get("SELECT status FROM pi_transactions WHERE id=$1", [id])).status;
  assert.equal(await st(a.id), "completed"); assert.equal(await st(b.id), "cancelled"); assert.equal(await st(c.id), "completed"); assert.equal(await st(pd.__id), "completed"); assert.equal(await st(e.id), "cancelled");
  assert.equal(run.matched + run.mismatched.length, run.checked);
  const rep = await admin.req("GET", "/api/admin/pi/reconciliation?date=" + today);
  assert.equal(rep.status, 200); assert.equal(rep.checked, run.checked); assert.equal(rep.fixed, run.fixed); assert.equal(rep.mismatched.length, run.mismatched.length); assert.equal(rep.ran, true);
  const second = await admin.req("POST", "/api/admin/pi/reconcile", { date: today });
  assert.equal(second.fixed, 0, "a second run has nothing left to fix"); assert.ok(second.mismatched.some(m => m.id === c.id && !m.fixed), "unfixable mismatch still reported");
  const none = await admin.req("GET", "/api/admin/pi/reconciliation?date=2001-01-01");
  assert.deepEqual([none.checked, none.matched, none.fixed, none.mismatched.length, none.ran], [0, 0, 0, 0, false]);
  assert.equal((await admin.req("GET", "/api/admin/pi/reconciliation?date=2024-13-99")).status, 400);
  assert.equal((await alice.req("GET", "/api/admin/pi/reconciliation")).status, 403);
  const pi = H.app.ctx.services.pi;
  const j1 = await pi.dailyJob(); assert.ok(j1.date && !j1.skipped, "job reconciles yesterday");
  const j2 = await pi.dailyJob(); assert.equal(j2.skipped, true, "and only once per day");
  const r = await H.app.ctx.scheduler.runOnce("pi.reconcile", () => pi.dailyJob()); assert.equal(r.ok, true, "runs under the leased scheduler");
});

test("unlink: refused for a Pi-only account without a password, otherwise clears the link and users.pi_uid", async () => {
  const dave = await mk("pi_dave"); await linkPi(dave, "d1");
  await db().run("UPDATE users SET password_hash=NULL WHERE id=$1", [dave.id]);
  assert.equal((await dave.req("DELETE", "/api/pi/link")).status, 409);
  const u = await bob.req("DELETE", "/api/pi/link"); assert.equal(u.status, 200); assert.equal(u.linked, false);
  assert.equal((await db().get("SELECT pi_uid FROM users WHERE id=$1", [bob.id])).pi_uid, null);
  assert.equal((await bob.req("GET", "/api/pi/wallet")).piUsername, null);
  assert.equal((await new H.Client().req("POST", "/api/pi/auth", { accessToken: TOKEN("b1", "pi_bob") })).needsLink, true);
  assert.equal((await bob.req("DELETE", "/api/pi/link")).status, 200, "unlink twice is harmless");
  const re = await bob.req("POST", "/api/pi/auth", { accessToken: TOKEN("b1", "pi_bob"), link: true }); assert.equal(re.status, 200, "can link again");
});

test("secrets: the API key and access tokens are never stored or echoed", async () => {
  const dump = JSON.stringify([
    await db().all("SELECT * FROM pi_links"), await db().all("SELECT * FROM pi_transactions"), await db().all("SELECT * FROM pi_tx_events"), await db().all("SELECT * FROM pi_reconciliation"),
    await db().all("SELECT * FROM audit_log")]);
  assert.ok(!dump.includes(KEY)); assert.ok(!dump.includes("at-secret-")); assert.ok(!dump.includes("st-secret-"), "App Studio sessionToken never stored");
  const bad = await new H.Client().req("POST", "/api/pi/auth", { accessToken: "at-secret-nope" });
  assert.ok(!JSON.stringify(bad).includes("at-secret-nope"));
  const src = require("node:fs").readFileSync(require.resolve("../services/pi.js"), "utf8");
  assert.ok(!/log[^\n]*(apiKey|accessToken|bearer)/i.test(src.replace(/Authorization: bearer \?/g, "")), "no logger call references a secret");
  assert.ok(!/logger\.[a-z]+\?\.\([^\n]*(sessionToken|accessToken|body\b)/.test(src), "no logger call carries the App Studio exchange");
});

test("migration 019: down/up is reversible (purely additive); startup backfill copies legacy pi_payments rows + legacy pi_uid links", async () => {
  const mig = require("../lib/migrations");
  const legacyUser = await mk("pi_legacy");
  await db().run("INSERT INTO pi_payments(payment_id,user_id,amount,memo,metadata,status,txid,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'completed','tx_legacy',$6,$6)", ["old_pay_1", legacyUser.id, 7, "قديم", { a: 1 }, new Date().toISOString()]);
  await db().run("INSERT INTO pi_payments(payment_id,user_id,amount,memo,metadata,status,created_at) VALUES($1,$2,$3,$4,$5,'approving',$6)", ["old_pay_2", legacyUser.id, 1, "قديم", {}, new Date().toISOString()]);
  await db().run("UPDATE users SET pi_uid='uid_legacy' WHERE id=$1", [legacyUser.id]);
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '019_pi' ORDER BY id")).map(r => r.id); // e.g. 020_tips (phase 37) sits on top
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "019_pi"]);
  await assert.rejects(() => db().get("SELECT 1 FROM pi_transactions"));
  assert.ok(await db().get("SELECT 1 x FROM pi_payments WHERE payment_id='old_pay_1'"), "legacy table untouched by down()");
  assert.deepEqual(await mig.up(db()), ["019_pi", ...later]);
  assert.equal((await db().get("SELECT COUNT(*) n FROM pi_transactions")).n * 1, 0, "the migration itself copies nothing (additive only)");
  await H.app.ctx.services.pi.backfill(); await H.app.ctx.services.pi.backfill(); // what a boot does; idempotent
  const rows = await db().all("SELECT * FROM pi_transactions WHERE user_id=$1 ORDER BY payment_id", [legacyUser.id]);
  assert.deepEqual(rows.map(r => [r.id, r.status, r.purpose, r.txid]), [["pil_old_pay_1", "completed", "legacy", "tx_legacy"], ["pil_old_pay_2", "created", "legacy", null]]);
  assert.equal((await db().get("SELECT pi_uid FROM pi_links WHERE user_id=$1", [legacyUser.id])).pi_uid, "uid_legacy");
  const w = await legacyUser.req("GET", "/api/pi/wallet"); assert.equal(w.tx.length, 2);
});

test("headers: CSP (Pi SDK, socialchain.app, hashed inline scripts, frame-ancestors without a bare wildcard), no X-Frame-Options", async () => {
  const r = await fetch(H.base + "/api/pi/config"); const csp = r.headers.get("content-security-policy");
  const dir = (name, c = csp) => (c.split(";").map(x => x.trim()).find(x => x.startsWith(name + " ")) || "").split(/\s+/).slice(1);
  assert.equal(r.headers.get("x-frame-options"), null, "X-Frame-Options removed (frame-ancestors governs framing)");
  assert.deepEqual(dir("frame-ancestors"), ["'self'", "https://*.pinet.com", "https://*.minepi.com"]);
  assert.ok(!dir("frame-ancestors").includes("*") && !dir("frame-ancestors").some(s => /^(https?:\/\/)?\*$/.test(s)), "no bare wildcard ancestor");
  assert.ok(dir("script-src").includes("https://sdk.minepi.com")); assert.ok(!dir("script-src").includes("'unsafe-inline'"), "no 'unsafe-inline' scripts");
  assert.ok(!dir("script-src").includes("'unsafe-eval'"));
  for (const o of ["'self'", "https://api.minepi.com", "https://socialchain.app"]) assert.ok(dir("connect-src").includes(o), o);
  assert.ok(!dir("connect-src").some(o => o.includes("*")), "connect-src is an explicit list");
  assert.ok(!csp.includes("piappengine"), "App Studio exchange is server-side: not in the CSP");
  assert.ok(dir("frame-src").includes("https://sdk.minepi.com"));
  // HTML: inline <script> blocks are allowed by hash only
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mp-csp-")), inline = "window.__deferRoute = location.protocol.startsWith(\"http\");";
  fs.writeFileSync(path.join(root, "index.html"), `<!doctype html><html><head><script src="https://sdk.minepi.com/pi-sdk.js"></script><script type="application/ld+json">{"a":1}</script></head><body><script>${inline}</script></body></html>`);
  const cfg = H.app.ctx.config, prevRoot = cfg.webRoot; cfg.webRoot = root;
  try {
    const h = await fetch(H.base + "/"); await h.text(); const hc = h.headers.get("content-security-policy");
    const want = "'sha256-" + require("node:crypto").createHash("sha256").update(inline).digest("base64") + "'";
    assert.ok(dir("script-src", hc).includes(want), "inline script hash present"); assert.equal(dir("script-src", hc).filter(x => x.startsWith("'sha256-")).length, 1, "ld+json data block not hashed");
    assert.ok(!dir("script-src", hc).includes("'unsafe-inline'")); assert.equal(h.headers.get("x-frame-options"), null);
  } finally { cfg.webRoot = prevRoot; }
  // the real index.html: every inline script it carries is covered
  const idx = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  assert.ok(/<script src="https:\/\/sdk\.minepi\.com\/pi-sdk\.js"( async)?( id="pi-sdk")?><\/script>/.test(idx), "Pi SDK tag in index.html (v2.51: async, non-blocking)");
  assert.ok(/<script src="https:\/\/sdk\.minepi\.com\/pi-sdk\.js"[^>]*\basync\b/.test(idx), "Pi SDK does not block rendering");
  assert.ok(inlineScriptHashes(idx).length >= 1);
  assert.ok(!/\son[a-z]+="/i.test(idx), "no inline event handlers in index.html");
});

test("cookies: production session cookie is HttpOnly; Secure; SameSite=None, local http stays SameSite=Lax", async () => {
  const cfg = H.app.ctx.config;
  const raw = async () => { const r = await fetch(H.base + "/api/pi/auth", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ accessToken: TOKEN("a1", "alice_pi") }) }); assert.equal(r.status, 200); return r.headers.get("set-cookie"); };
  const dev = await raw();
  assert.match(dev, /^mp_session=[^;]+;/); assert.match(dev, /; HttpOnly/); assert.match(dev, /; SameSite=Lax/); assert.doesNotMatch(dev, /Secure/);
  const prev = cfg.secureCookies; cfg.secureCookies = true;
  try {
    const prod = await raw();
    assert.match(prod, /; HttpOnly/); assert.match(prod, /; SameSite=None/); assert.match(prod, /; Secure/); assert.doesNotMatch(prod, /SameSite=Lax/);
    const out = await fetch(H.base + "/api/auth/logout", { method: "POST", headers: { "X-Requested-With": "mujtama" } });
    assert.match(out.headers.get("set-cookie"), /SameSite=None; Secure/, "clearing cookie uses the same attributes");
  } finally { cfg.secureCookies = prev; }
});

test("static: /pi-app-validation.txt is a plain static file, byte-exact, text/plain, not the SPA fallback", async () => {
  const ROOT = path.join(__dirname, "..", "..");
  const src = fs.readFileSync(path.join(ROOT, "public", "pi-app-validation.txt"));
  assert.equal(src.toString("utf8"), VALIDATION, "source file byte-exact (no trailing newline)");
  // serve the built dist when present (what Railway serves), else a temp web root laid out like the build does
  let root = path.join(ROOT, "dist");
  if (!fs.existsSync(path.join(root, "pi-app-validation.txt"))) { root = fs.mkdtempSync(path.join(os.tmpdir(), "mp-pub-")); fs.cpSync(path.join(ROOT, "public"), root, { recursive: true }); fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>spa</title>"); }
  if (!fs.existsSync(path.join(root, "index.html"))) fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>spa</title>");
  const cfg = H.app.ctx.config, prevRoot = cfg.webRoot; cfg.webRoot = root;
  try {
    for (const ae of ["", "br, gzip"]) {
      const r = await fetch(H.base + "/pi-app-validation.txt", { headers: ae ? { "Accept-Encoding": ae } : {} });
      const buf = Buffer.from(await r.arrayBuffer());
      assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /^text\/plain\b/);
      assert.equal(r.headers.get("content-encoding"), null);
      assert.ok(buf.equals(Buffer.from(VALIDATION, "utf8")), `byte-exact body (got ${JSON.stringify(buf.toString())})`);
    }
    const spa = await fetch(H.base + "/some/spa/route"); assert.match(spa.headers.get("content-type"), /text\/html/, "unknown paths still get the SPA");
  } finally { cfg.webRoot = prevRoot; }
});
