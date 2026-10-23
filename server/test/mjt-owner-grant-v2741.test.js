/* v2.74.1 — MJT_OWNER_GRANT: one-time test balance for the platform owner (oldest admin). Idempotent by key; ledger verifies. */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");

let H;
test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } });
});
test.after(() => H.app.close());

test("owner grant mints once to the oldest admin, replays by key, ignores bad specs", async () => {
  const M = H.app.ctx.services.mjt,
    db = H.app.ctx.db;
  await M.ready;
  H.app.ctx.rl.w.clear();
  const cl = new H.Client();
  const r = await cl.req("POST", "/api/auth/register", { name: "المالك", handle: "owner_g", password: "secret123" });
  assert.equal(r.status, 200, r.error);
  const owner = await db.get("SELECT id, handle FROM users WHERE role='admin' AND status='active' ORDER BY created_at, id LIMIT 1");
  assert.ok(owner, "an admin exists");
  const before = Number((await M.me({ id: owner.id })).balance?.mjt ?? 0);
  const g1 = await M.ownerGrant("100000:owner_test_1");
  assert.equal(g1.replayed, false);
  assert.equal(g1.handle, owner.handle);
  const g2 = await M.ownerGrant("100000:owner_test_1");
  assert.equal(g2.replayed, true);
  const after = Number(String((await M.me({ id: owner.id })).balance?.mjt ?? 0).replace(/,/g, ""));
  assert.equal(after - before, 100000);
  assert.equal(await M.ownerGrant("abc"), null);
  assert.equal(await M.ownerGrant("0:k123"), null);
  const v = await M.verify();
  assert.ok(v.ok !== false, JSON.stringify(v));
});

test("v2.74.2: grant to an explicit handle, undo a misdirected grant, transfer wait defaults to 0", async () => {
  const M = H.app.ctx.services.mjt;
  H.app.ctx.rl.w.clear();
  const cl = new H.Client();
  const r = await cl.req("POST", "/api/auth/register", { name: "صاحب التطبيق", handle: "Owner_Real", password: "secret123" });
  assert.equal(r.status, 200, r.error);
  const g = await M.ownerGrant("100000:owner_test_2:owner_real");
  assert.equal(g.handle, "Owner_Real");
  assert.equal((await cl.req("GET", "/api/mjt/me")).balance.mjt.replace(/,/g, ""), "100000");
  const u1 = await M.ownerGrantUndo("owner_test_1");
  assert.equal(u1.replayed, false);
  assert.equal((await M.ownerGrantUndo("owner_test_1")).replayed, true);
  assert.equal(await M.ownerGrantUndo("nope_key"), null);
  assert.equal((await M.settings()).transfers.minAccountDays, 0);
  const v = await M.verify();
  assert.ok(v.ok !== false, JSON.stringify(v));
});
