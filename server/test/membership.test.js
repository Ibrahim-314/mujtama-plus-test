/* v2.156 — Free / Plus membership. Stubbed Pi Platform API (testnet), injectable clock, SQLite by default.
 * The 12 cases from the phase brief: new member is Free · Free is refused a Plus feature (server-side) · a verified testnet
 * payment activates Plus · pending does not · failed does not · a duplicate completion does not duplicate the period ·
 * Plus can use its features · expiry returns to Free · renewal extends from the current end · the client cannot change its
 * tier · history is right · the rest of the app is untouched (free features stay free, migration 088 reversible). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const AD = (...a) => require("./admin-shim").shim(H)(...a); // v2.167: removed admin routes → service fixtures (see admin-shim.js)

const KEY = "sk_test_mb_156";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`;
const payments = new Map();
let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pay = (o) => { const p = { identifier: "mbpay_" + (++seq), user_uid: o.uid, amount: o.amount, memo: o.memo || "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", created_at: new Date().toISOString(), status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
async function fakeFetch(url, o = {}) {
  if (new URL(url).pathname === "/pi/auth/v1/login") {
    const m = /^at-secret-([^-]+)-(.+)$/.exec(String(JSON.parse(o.body || "{}").accessToken || ""));
    return m ? res(200, { sessionToken: "st-" + m[1], user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {});
  }
  const path = new URL(url).pathname, auth = o.headers?.Authorization || "";
  if (auth !== "Key " + KEY) return res(401, {});
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path);
  const p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, {});
  const body = o.body ? JSON.parse(o.body) : {};
  if (mm[2] === "approve") p.status.developer_approved = true;
  if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, {}); p.status.developer_completed = true; }
  if (mm[2] === "cancel") p.status.cancelled = true;
  return res(200, JSON.parse(JSON.stringify(p)));
}
const PI_ENV = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub", PI_MAX_AMOUNT: "1000" };
const DAY = 864e5;
let offset = 0;
const now = () => new Date(Date.now() + offset);

let H, admin, free, buyer, pend, failer, minor;
const db = () => H.app.ctx.db;
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
  return c;
};
const linkPi = async (c) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(c.handle.replace(/_/g, ""), c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + c.handle.replace(/_/g, ""); };
const settle = async () => { await H.app.ctx.services.ai.settle(); for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const me = (c) => c.req("GET", "/api/membership/me");
async function intentFor(c) { H.app.ctx.rl.w.clear(); const r = await c.req("POST", "/api/membership/subscribe", {}); assert.equal(r.status, 200, r.error); return r.intent; }
async function payFull(c, intent) {
  H.app.ctx.rl.w.clear();
  const p = pay({ uid: c.uid, amount: intent.amount, metadata: intent.metadata });
  const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
  p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
  const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
  await settle();
  return p;
}

test.before(async () => {
  H = await boot({ piOpts: { env: PI_ENV, fetch: fakeFetch, jobs: false }, aiOpts: { env: {}, now, jobs: false }, membershipOpts: { now } });
  H.Client.prototype.req = async function (method, path, body, headers = {}) { // status last: Pi routes return their own `status` field
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    return { ...j, body: j, status: r.status, headers: r.headers };
  };
  admin = await mk("mb_admin"); free = await mk("mb_free"); buyer = await mk("mb_buyer"); pend = await mk("mb_pend"); failer = await mk("mb_fail"); minor = await mk("mb_minor");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [admin.id])).role, "admin");
  for (const c of [free, buyer, pend, failer, minor]) await linkPi(c);
  assert.equal((await minor.req("POST", "/api/age", { birthDate: "2012-05-01" })).status, 200);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 088 is additive and reversible", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '088_membership' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "088_membership"]);
  await assert.rejects(() => db().get("SELECT 1 FROM membership_events"));
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM ai_plans")).n) >= 0, "024 tables untouched");
  assert.deepEqual(await mig.up(db()), ["088_membership", ...later]);
});

test("1 · a new member is Free, with the comparison and no hard-coded price", async () => {
  const m = await me(free);
  assert.equal(m.status, 200, m.error);
  assert.equal(m.tier, "free"); assert.equal(m.state, "free"); assert.equal(m.subscription, null); assert.equal(m.plus, false);
  assert.deepEqual(m.features, { translate: false, assistant: false, studio_extended: false });
  assert.equal(m.network, "testnet"); assert.deepEqual(m.payments, []);
  const c = await new H.Client().req("GET", "/api/membership/plans");
  assert.equal(c.status, 200); assert.equal(c.plus.label, "مجتمع بلس Plus"); assert.equal(c.plus.price, 10, "v2.167: the fixed Plus price (app-defaults, env PLUS_PRICE_PI)");
  assert.ok(c.free.features.length >= 8); assert.deepEqual(c.plus.features.map((f) => f.key).sort(), ["studio_extended", "translate"]);
  assert.equal((await new H.Client().req("GET", "/api/membership/me")).status, 401);
});

test("v2.167: the admin price route is gone (404); a test fixture still sets a price through the service", async () => {
  assert.equal((await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { price: 2.5 })).status, 404);
  assert.equal((await AD(free, "PUT", "/api/admin/ai/plans/ai_plus", { price: 1 })).status, 404);
  const r = await AD(admin, "PUT", "/api/admin/ai/plans/ai_plus", { price: 2.5 });
  assert.equal(r.status, 200, r.error); assert.equal(r.plan.price, 2.5);
  assert.equal((await new H.Client().req("GET", "/api/membership/plans")).plus.price, 2.5);
});

test("2 · Free is refused a protected Plus feature on the server (402 + upsell); up to 90 days stays free", async () => {
  const r = await free.req("GET", "/api/studio/overview?days=365");
  assert.equal(r.status, 402); assert.equal(r.code, "subscription_required"); assert.match(r.error || r.message || "", /Plus/);
  assert.equal((await free.req("GET", "/api/studio/overview?days=90")).status, 200, "existing free range untouched");
  assert.equal((await free.req("GET", "/api/studio/overview?days=28")).status, 200);
});

test("minors cannot buy Plus", async () => {
  assert.equal((await minor.req("POST", "/api/membership/subscribe", {})).code, "minor_restricted");
});

test("4 · a pending payment (approved, not completed) does not grant Plus", async () => {
  const intent = await intentFor(pend);
  assert.equal(intent.amount, 2.5);
  const p = pay({ uid: pend.uid, amount: intent.amount, metadata: intent.metadata });
  assert.equal((await pend.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier })).status, 200);
  await settle();
  const m = await me(pend);
  assert.equal(m.state, "payment_pending"); assert.equal(m.tier, "free"); assert.equal(m.features.studio_extended, false);
  assert.equal((await pend.req("GET", "/api/studio/overview?days=365")).status, 402);
  // the Pi side is not verified yet → complete is refused, still Free
  const d = await pend.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_fake" });
  assert.equal(d.code, "pi_unverified"); assert.equal((await me(pend)).tier, "free");
  // the member cancels → payment_failed (cancelled), still Free
  assert.equal((await pend.req("POST", "/api/pi/payments/cancel", { paymentId: p.identifier })).status, 200);
  await settle();
  const m2 = await me(pend);
  assert.equal(m2.tier, "free"); assert.equal(m2.state, "payment_failed"); assert.equal(m2.payments[0].status, "cancelled");
});

test("5 · a failed payment (amount mismatch) does not grant Plus", async () => {
  const intent = await intentFor(failer);
  const p = pay({ uid: failer.uid, amount: 0.1, metadata: intent.metadata }); // the wallet shows a different amount than the intent
  const a = await failer.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier });
  assert.equal(a.status, 409);
  await settle();
  const m = await me(failer);
  assert.equal(m.tier, "free"); assert.equal(m.state, "payment_failed"); assert.equal(m.payments[0].status, "failed");
  assert.ok(m.events.some((e) => e.kind === "payment_failed"));
});

test("3 · 6 · 7 · a verified testnet payment activates Plus once; a duplicate completion changes nothing", async () => {
  offset = 0;
  const p = await payFull(buyer, await intentFor(buyer));
  const m = await me(buyer);
  assert.equal(m.tier, "plus"); assert.equal(m.state, "plus_active"); assert.equal(m.subscription.daysLeft, 30);
  assert.deepEqual(m.features, { translate: true, assistant: false, studio_extended: true });
  const end1 = m.subscription.periodEnd;
  assert.ok(Math.abs(new Date(end1) - new Date(m.subscription.periodStart) - 30 * DAY) < 5000);
  // duplicate completion (double tap / replayed callback) and a replayed bus event
  const again = await buyer.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier });
  assert.equal(again.status, 200);
  const tx = await db().get("SELECT id FROM pi_transactions WHERE payment_id=$1", [p.identifier]);
  H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { user: buyer.id, tx: tx.id, purpose: "ai", amount: 2.5 });
  await settle();
  const m2 = await me(buyer);
  assert.equal(m2.subscription.periodEnd, end1, "period not extended twice");
  assert.equal(m2.payments.filter((x) => x.status === "completed").length, 1);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ledger_journals WHERE ikey LIKE 'ai:pay:%'")).n) >= 1, true);
  // 7: Plus uses its features
  const s = await buyer.req("GET", "/api/studio/overview?days=365");
  assert.equal(s.status, 200, s.error); assert.equal(s.days, 365);
  assert.ok(m2.events.some((e) => e.kind === "started"));
});

test("10 · the client cannot give itself Plus", async () => {
  for (const b of [{ tier: "plus" }, { state: "plus_active", plan: "ai_plus" }]) {
    await free.req("PUT", "/api/prefs", { ns: "membership", data: b }).catch(() => null);
    await free.req("POST", "/api/membership/resume", b);
  }
  assert.equal((await free.req("POST", "/api/membership/resume", {})).code, "invalid_state");
  assert.equal((await AD(free, "POST", "/api/admin/ai/grants", { user: free.id, days: 30 })).status, 404);
  const m = await me(free);
  assert.equal(m.tier, "free"); assert.equal((await free.req("GET", "/api/studio/overview?days=365")).status, 402);
  // a forged header / cookie does not matter either: the tier is read from server rows for the session user
  assert.equal((await free.req("GET", "/api/studio/overview?days=365", null, { "X-Tier": "plus" })).status, 402);
});

test("9 · renewal extends from the current end, and cancel / resume keep access to the end", async () => {
  const before = (await me(buyer)).subscription.periodEnd;
  offset = 10 * DAY;
  await payFull(buyer, await intentFor(buyer));
  const m = await me(buyer);
  assert.ok(Math.abs(new Date(m.subscription.periodEnd) - (new Date(before).getTime() + 30 * DAY)) < 5000, "renewal adds 30 days to the current end");
  assert.ok(m.events.some((e) => e.kind === "renewed"));
  assert.equal((await buyer.req("POST", "/api/membership/cancel", {})).status, 200);
  const c = await me(buyer);
  assert.equal(c.state, "plus_cancelling"); assert.equal(c.tier, "plus");
  assert.equal((await buyer.req("POST", "/api/membership/resume", {})).status, 200);
  assert.equal((await me(buyer)).state, "plus_active");
});

test("8 · expiry returns the member to Free (even before the job), then the job marks it expired", async () => {
  const end = new Date((await me(buyer)).subscription.periodEnd).getTime();
  offset = end - Date.now() + 60e3;
  const m = await me(buyer);
  assert.equal(m.tier, "free"); assert.equal(m.state, "expired"); assert.equal(m.features.studio_extended, false);
  assert.equal((await buyer.req("GET", "/api/studio/overview?days=365")).status, 402);
  const j = await H.app.ctx.services.ai.maintain(); await settle();
  assert.ok(j.expired >= 1);
  assert.equal((await db().get("SELECT state FROM ai_subscriptions WHERE user_id=$1", [buyer.id])).state, "expired");
  assert.ok((await me(buyer)).events.some((e) => e.kind === "expired"));
  offset = 0;
});

test("11 · history shows the member's own payments and events only", async () => {
  const m = await me(buyer);
  assert.equal(m.payments.length, 2); assert.ok(m.payments.every((x) => x.status === "completed" && x.periodEnd));
  assert.ok(m.payments[0].createdAt >= m.payments[1].createdAt, "newest first");
  assert.deepEqual([...new Set(m.events.map((e) => e.kind))].sort(), ["cancelled", "expired", "renewed", "resumed", "started"]);
  const other = await me(free);
  assert.deepEqual(other.payments, []); assert.deepEqual(other.events, []);
  const raw = JSON.stringify(m);
  for (const k of ["user_id", "payment_id", KEY]) assert.ok(!raw.includes(k), "no internal fields: " + k);
});

test("existing «مجتمع بلس Plus» subscribers are Plus (same plan)", async () => {
  const g = await AD(admin, "POST", "/api/admin/ai/grants", { user: free.id, days: 5, note: "legacy" });
  assert.equal(g.status, 200, g.error);
  const m = await me(free);
  assert.equal(m.tier, "plus"); assert.equal(m.subscription.plan.slug, "ai_plus");
  await AD(admin, "POST", "/api/admin/ai/grants/revoke", { user: free.id });
  assert.equal((await me(free)).tier, "free");
});

test("12 · the rest of the app is unaffected: free features stay free for Free members", async () => {
  const p = await free.req("POST", "/api/posts", { text: "منشور عضو مجاني" });
  assert.equal(p.status, 200, p.error);
  assert.equal((await free.req("GET", "/api/me")).status, 200);
  assert.equal((await free.req("GET", "/api/prefs?ns=home")).status, 200);
  assert.equal((await free.req("GET", "/api/studio/overview?days=7")).status, 200);
  assert.equal((await free.req("GET", "/api/ai/config")).status, 200);
});
