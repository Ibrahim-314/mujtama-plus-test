/* v2.153.0 «كل دفعة لها أثر» — Pi payment purposes sweep on the REAL chain (no bus shortcuts):
 * feature intent → Pi payment carrying the intent metadata → POST /api/pi/payments/approve → /complete (txid verified by a
 * stubbed Pi Platform API) → the feature's own effect; then staff refund → the feature unwinds. Covers the features whose
 * own tests emit PI_PAYMENT_* directly (jobs boost, contract escrow, creators fund) and the gaps found in the sweep:
 *  1. the public intent route refused feature-owned purposes (a «tip» paid there credited nobody),
 *  2. a refunded contract milestone still sitting in escrow could later be released to the worker,
 *  3. a refunded job boost kept the listing featured and its journal standing. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const KEY = "sk_test_sweep_DO_NOT_LEAK";
const APPSTUDIO = "https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login";
const payments = new Map(); let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const newPayment = (uid, amount, metadata) => { const p = { identifier: "sw_" + (++seq), user_uid: uid, amount, memo: "m", metadata: metadata || {}, direction: "user_to_app", network: "Pi Testnet", created_at: new Date().toISOString(), status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
async function fakeFetch(url, o = {}) {
  if (url === APPSTUDIO) { const t = String(JSON.parse(o.body || "{}").accessToken || ""); const m = /^at-([^-]+)-(.+)$/.exec(t); return m ? res(200, { sessionToken: "st", user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {}); }
  const path = new URL(url).pathname; if ((o.headers?.Authorization || "") !== "Key " + KEY) return res(401, {});
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path); const p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, {});
  const body = o.body ? JSON.parse(o.body) : {};
  if (mm[2] === "approve") p.status.developer_approved = true;
  if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, {}); p.status.developer_completed = true; }
  if (mm[2] === "cancel") p.status.cancelled = true;
  return res(200, JSON.parse(JSON.stringify(p)));
}
const ENV = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub", PI_MAX_AMOUNT: "1000" };

let H, admin, emp, wrk, donor;
const db = () => H.app.ctx.db;
const wait = async (cond) => { for (let i = 0; i < 80; i++) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error);
  c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 60 * 864e5).toISOString(), c.id]);
  const l = await c.req("POST", "/api/pi/auth", { accessToken: `at-${handle}-${handle}`, link: true }); assert.equal(l.status, 200, l.error); c.uid = "uid_" + handle;
  return c;
}
/** what the Pi Browser does with an intent: createPayment → server approve → user signs → server complete */
async function payThrough(c, intent) {
  const p = newPayment(c.uid, Number(intent.amount), intent.metadata);
  const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
  p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
  const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
  return p;
}
const bal = async (acc) => { const r = await db().get("SELECT COALESCE(SUM(credit),0) c, COALESCE(SUM(debit),0) d FROM ledger_entries WHERE account=$1", [acc]); return Number(r.c) - Number(r.d); };
const unbalanced = async () => Number((await db().get("SELECT COUNT(*) n FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING SUM(credit)<>SUM(debit)) x")).n);

test.before(async () => {
  H = await boot({ piOpts: { env: ENV, fetch: fakeFetch, jobs: false }, jobsOpts: {}, contractsOpts: { jobs: false }, vcreatorsOpts: { jobs: false } });
  // Pi responses carry a payment `status` field: keep the HTTP status on `.status`, the body spread around it
  H.Client.prototype.req = async function (method, path, body, headers = {}) {
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const j = await r.json().catch(() => ({})); return { ...j, body: j, status: r.status };
  };
  admin = await mk("sw_admin"); await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  emp = await mk("sw_emp", "شركة نور"); wrk = await mk("sw_wrk", "سارة"); donor = await mk("sw_donor");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("public intent route: test / donation allowed; feature-owned purposes are refused (they would credit nobody)", async () => {
  const ok = await donor.req("POST", "/api/pi/payments", { amount: 0.01, memo: "دفعة تجريبية", purpose: "test" }); assert.equal(ok.status, 200, ok.error);
  assert.equal((await donor.req("POST", "/api/pi/payments", { amount: 1, memo: "دعم التطبيق", purpose: "donation" })).status, 200);
  for (const purpose of ["tip", "subscription", "ppv", "market", "ads", "ai", "transfer", "mentor", "fund", "charity", "jobs", "contract"]) {
    const r = await donor.req("POST", "/api/pi/payments", { amount: 1, memo: "x", purpose, refId: "p_1" });
    assert.equal(r.status, 400, purpose); assert.equal(r.code, "feature_purpose", purpose);
  }
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM pi_transactions WHERE purpose='tip' AND user_id=$1", [donor.id])).n), 0);
});

test("jobs boost: real chain → featured + fee journal; staff refund → not featured, journal reversed", async () => {
  const BODY = "نبحث عن مطوّر واجهات أمامية يتقن React لبناء لوحة تحكم عربية سريعة وسهلة الوصول، مع اختبارات وتوثيق واضح.";
  const j = await emp.req("POST", "/api/jobs", { kind: "job", title: "مطوّر واجهات أمامية", body: BODY, category: "tech", skills: ["React"], mode: "remote", employment: "full", payType: "monthly", payMin: 800, payMax: 1200 });
  assert.equal(j.status, 200, j.error); assert.equal(j.state, "open");
  const b = await emp.req("POST", `/api/jobs/${j.id}/boost`, { days: 7 }); assert.equal(b.status, 200, b.error);
  assert.equal(Number(b.intent.amount), Number(b.amount), "the amount shown is the amount Pi asks for");
  await payThrough(emp, b.intent);
  assert.ok(await wait(async () => (await db().get("SELECT status FROM job_boosts WHERE id=$1", [b.boost]))?.status === "completed"), "boost completed");
  assert.equal((await emp.req("GET", "/api/jobs/" + j.id)).job?.featured ?? (await emp.req("GET", "/api/jobs/" + j.id)).featured, true);
  const out = await bal("user:" + emp.id + ":pi_out");
  const rf = await admin.req("POST", `/api/admin/pi/payments/${b.intent.id}/refund`, { note: "طلب العميل" }); assert.equal(rf.status, 200, rf.error);
  assert.ok(await wait(async () => (await db().get("SELECT status FROM job_boosts WHERE id=$1", [b.boost]))?.status === "refunded"), "boost refunded");
  const v = await emp.req("GET", "/api/jobs/" + j.id); assert.equal(v.job?.featured ?? v.featured, false, "no longer featured after refund");
  const amt = Number((await db().get("SELECT amount FROM job_boosts WHERE id=$1", [b.boost])).amount);
  assert.equal(await bal("user:" + emp.id + ":pi_out"), out + amt, "boost journal reversed");
  assert.equal(await unbalanced(), 0);
});

test("contract milestone: real chain → funded in escrow; staff refund while held → refunded to client, never releasable", async () => {
  const SCOPE = "تصميم وتنفيذ واجهة متجر عربي متجاوبة مع لوحة تحكم بسيطة، وتسليم الملفات المصدرية مع توثيق مختصر.";
  const c = await emp.req("POST", "/api/contracts", { to: "sw_wrk", title: "واجهة متجر", scope: SCOPE, maxRevisions: 1, milestones: [{ title: "التصميم", amount: 20 }] }); assert.equal(c.status, 200, c.error);
  assert.equal((await wrk.req("POST", `/api/contracts/${c.id}/respond`, { accept: true })).status, 200);
  const m = (await emp.req("GET", "/api/contracts/" + c.id)).milestones[0];
  const f = await emp.req("POST", `/api/contract-milestones/${m.id}/fund`); assert.equal(f.status, 200, f.error);
  assert.equal(Number(f.intent.amount), Number(f.amount));
  await payThrough(emp, f.intent);
  assert.ok(await wait(async () => (await db().get("SELECT status FROM contract_milestones WHERE id=$1", [m.id]))?.status === "funded"), "funded");
  const escrow = H.app.ctx.services.contracts.ESCROW, held = await bal(escrow);
  assert.ok(held > 0);
  const rf = await admin.req("POST", `/api/admin/pi/payments/${f.intent.id}/refund`, { note: "إلغاء" }); assert.equal(rf.status, 200, rf.error);
  assert.ok(await wait(async () => (await db().get("SELECT status FROM contract_milestones WHERE id=$1", [m.id]))?.status === "refunded"), "milestone refunded");
  assert.equal(await bal(escrow), 0, "escrow emptied");
  assert.notEqual((await wrk.req("POST", `/api/contract-milestones/${m.id}/submit`, { note: "سلّمت" })).status, 200, "a refunded milestone cannot be delivered / released");
  assert.equal(await unbalanced(), 0);
});

test("creators fund donation: real chain → completed + journal; refund → reversed", async () => {
  const d = await donor.req("POST", "/api/fund/donate", { amount: 2.5 }); assert.equal(d.status, 200, d.error);
  assert.equal(Number(d.intent.amount), 2.5);
  await payThrough(donor, d.intent);
  assert.ok(await wait(async () => (await db().get("SELECT status FROM fund_donations WHERE id=$1", [d.donation.id]))?.status === "completed"));
  assert.equal((await admin.req("POST", `/api/admin/pi/payments/${d.intent.id}/refund`, {})).status, 200);
  assert.ok(await wait(async () => (await db().get("SELECT status FROM fund_donations WHERE id=$1", [d.donation.id]))?.status === "refunded"));
  assert.equal(await unbalanced(), 0);
});
