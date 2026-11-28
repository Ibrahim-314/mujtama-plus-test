/* v2.163 admin switches for the LEGACY MJT paths → v2.167 «التطبيق يشتغل تلقائياً»: every legacy path is fixed ON in
 * server/config/app-defaults.js (mjt.legacy). The admin endpoints /api/admin/mjt/legacy… are gone (404), an old 'legacy' row in
 * mjt_settings is kept but not read, the MJT_LEGACY_<PATH> env override is gone, members see every flag ON, buying MJT with Pi
 * stays 501 (wave 2). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const DEF = require("../config/app-defaults");

const DAY = 864e5, OLD = new Date(Date.now() - 40 * DAY).toISOString();
let H, admin, a;
const db = () => H.app.ctx.db, S = () => H.app.ctx.services, LG = () => S().mjtLegacy;
const clear = () => H.app.ctx.rl.w.clear();
async function mk(handle) {
  clear(); const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle;
  await db().run("UPDATE users SET created_at=$1, pi_uid=$2 WHERE id=$3", [OLD, "pi_" + handle, cl.id]);
  return cl;
}

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } });
  await S().mjt.ready;
  admin = await mk("lg_admin"); a = await mk("lg_a");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
});
test.after(() => H.app.close());

test("v2.167: every legacy path is fixed ON; members see every flag ON; buy stays not available", async () => {
  for (const k of LG().KEYS) { assert.equal(DEF.mjt.legacy[k], true, k); assert.equal(await LG().isOn(k), true, k); }
  await LG().guard("transfers"); await LG().guard("mining");
  const me = await a.req("GET", "/api/mjt/me"); assert.equal(me.status, 200, me.error);
  for (const k of LG().MEMBER_KEYS) assert.equal(me.legacy?.[k], true, k);
  assert.equal((await a.req("POST", "/api/mjt/buy", { amount: "1" })).status, 501);
});

test("v2.167: the admin switch endpoints are gone for everyone (404 / 401), nothing written", async () => {
  for (const c of [admin, a]) {
    clear(); assert.equal((await c.req("GET", "/api/admin/mjt/legacy")).status, 404);
    clear(); assert.equal((await c.req("PUT", "/api/admin/mjt/legacy/transfers", { enabled: false, reason: "اختبار الإيقاف" })).status, 404);
  }
  assert.ok([401, 404].includes((await new H.Client().req("GET", "/api/admin/mjt/legacy")).status));
  assert.equal(await db().get("SELECT value FROM mjt_settings WHERE key='legacy'"), undefined);
});

test("v2.167: an old stored 'legacy' row and MJT_LEGACY_<PATH>=off no longer switch anything off", async () => {
  await db().run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('legacy',$1,'t',$2) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify({ transfers: false, mining: false, tips: false }), new Date().toISOString()]);
  process.env.MJT_LEGACY_TRANSFERS = "off";
  try {
    assert.equal(await LG().isOn("transfers"), true); assert.equal(await LG().isOn("mining"), true); assert.equal(await LG().isOn("tips"), true);
    assert.equal((await a.req("GET", "/api/mjt/me")).legacy.transfers, true);
  } finally { delete process.env.MJT_LEGACY_TRANSFERS; await db().run("DELETE FROM mjt_settings WHERE key='legacy'"); }
});
