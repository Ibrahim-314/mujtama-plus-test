/* v2.87 «التعدين» — 24-hour MJT mining sessions + daily sign-in reward (services/mining.js, migration 079). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const L = require("../lib/mjt-ledger");

const T0 = Date.parse("Sat 2026-10-24 12:00 PM (UTC+03:00)");
let H, now = T0;
const db = () => H.app.ctx.db, M = () => H.app.ctx.services.mjt;
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const bal = async (uid) => Number((await db().get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + uid]))?.balance || 0);

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false }, miningOpts: { now: () => now } });
  await M().ready;
});
test.after(() => H.app.close());

test("a session mines 5 MJT over 24 hours and pays exactly once", async () => {
  now = T0; const a = await mk("mine_a");
  let s = await a.req("GET", "/api/mjt/mining");
  assert.equal(s.status, 200); assert.equal(s.session, null); assert.equal(s.rate, "5");
  const st = await a.req("POST", "/api/mjt/mining/start");
  assert.equal(st.started, true); assert.equal(st.state.session.amount, "5"); assert.equal(st.state.session.ready, false);
  const again = await a.req("POST", "/api/mjt/mining/start"); assert.equal(again.started, false); // already mining
  now = T0 + 12 * 3600e3;
  const early = await a.req("POST", "/api/mjt/mining/claim"); assert.equal(early.status, 409); assert.equal(early.code, "not_ready");
  now = T0 + 24 * 3600e3 + 1;
  s = await a.req("GET", "/api/mjt/mining"); assert.equal(s.session.ready, true);
  const [c1, c2] = await Promise.all([a.req("POST", "/api/mjt/mining/claim"), a.req("POST", "/api/mjt/mining/claim")]);
  assert.ok([c1, c2].some((c) => c.claimed === "5"));
  assert.equal(await bal(a.id), 5 * L.UNIT);
  s = await a.req("GET", "/api/mjt/mining"); assert.equal(s.session, null); assert.equal(s.totals.mined, "5"); assert.equal(s.totals.sessions, 1);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_tx WHERE user_id=$1 AND kind='mining'", [a.id])).n), 1);
  const v = await M().verify(); assert.ok(v.ok !== false, JSON.stringify(v));
});

test("starting a new session claims the finished one first", async () => {
  now = T0; const b = await mk("mine_b");
  await b.req("POST", "/api/mjt/mining/start");
  now = T0 + 30 * 3600e3;
  const st = await b.req("POST", "/api/mjt/mining/start");
  assert.equal(st.started, true); assert.equal(st.claimed, "5"); assert.equal(st.state.session.ready, false);
  assert.equal(await bal(b.id), 5 * L.UNIT);
  assert.equal(st.state.totals.streak >= 1, true);
});

test("daily sign-in pays 1 MJT once per day and counts a streak", async () => {
  now = T0; const c = await mk("mine_c");
  const r1 = await c.req("POST", "/api/mjt/checkin"); assert.equal(r1.credited, true); assert.equal(r1.amount, "1");
  const r2 = await c.req("POST", "/api/mjt/checkin"); assert.equal(r2.credited, false);
  assert.equal(await bal(c.id), 1 * L.UNIT);
  now = T0 + 24 * 3600e3;
  const r3 = await c.req("POST", "/api/mjt/checkin"); assert.equal(r3.credited, true); assert.equal(r3.state.streak, 2);
  assert.equal(await bal(c.id), 2 * L.UNIT);
  const h = await c.req("GET", "/api/mjt/history"); assert.ok(h.items.some((i) => i.label === "مكافأة الدخول اليومي"));
});

test("frozen wallet keeps the session until unfrozen; admin settings; guests refused", async () => {
  now = T0; const d = await mk("mine_d"), adm = await mk("mine_adm");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [adm.id]);
  await d.req("POST", "/api/mjt/mining/start");
  await adm.req("POST", "/api/admin/mjt/accounts/mine_d/freeze", { frozen: true, reason: "مراجعة اختبار" });
  now = T0 + 25 * 3600e3;
  const f = await d.req("POST", "/api/mjt/mining/claim"); assert.equal(f.status, 409); assert.equal(f.code, "account_frozen");
  await adm.req("POST", "/api/admin/mjt/accounts/mine_d/freeze", { frozen: false, reason: "انتهت المراجعة" });
  const ok = await d.req("POST", "/api/mjt/mining/claim"); assert.equal(ok.claimed, "5");
  const s = await adm.req("PUT", "/api/admin/mjt/mining", { rate: "7", checkin: "2" }); assert.equal(s.rate, "7"); assert.equal(s.checkin, "2");
  const no = await d.req("PUT", "/api/admin/mjt/mining", { rate: "50" }); assert.equal(no.status, 403);
  const st = await d.req("POST", "/api/mjt/mining/start"); assert.equal(st.state.session.amount, "7");
  await adm.req("PUT", "/api/admin/mjt/mining", { rate: "5", checkin: "1" });
  const g = await new H.Client().req("GET", "/api/mjt/mining"); assert.equal(g.status, 401);
});
