/* v2.159 — saved-search alerts: turning an alert back on starts counting from now (no backlog burst); one broken saved search
 * does not stop the rest of the batch; alerts never change the saved-search quota or delete anything. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
let H, u;
const db = () => H.app.ctx.db;
test.before(async () => {
  H = await boot(); H.app.ctx.rl.w.clear();
  u = new H.Client(); const r = await u.req("POST", "/api/auth/register", { name: "عضو تنبيه", handle: "alert_u", password: "secret123" }); assert.equal(r.status, 200, r.error); u.id = r.user.id;
});
test.after(() => H.app.close());

test("re-enabling an alert resets last_checked; disabling keeps it", async () => {
  H.app.ctx.rl.w.clear(); const s = (await u.req("POST", "/api/search/saved", { q: "تنبيه" })).saved;
  const old = new Date(Date.now() - 90 * 864e5).toISOString();
  await u.req("PATCH", "/api/search/saved/" + s.id, { alert: false });
  await db().run("UPDATE saved_searches SET last_checked=$1 WHERE id=$2", [old, s.id]);
  await u.req("PATCH", "/api/search/saved/" + s.id, { alert: false });
  assert.equal((await db().get("SELECT last_checked FROM saved_searches WHERE id=$1", [s.id])).last_checked, old);
  await u.req("PATCH", "/api/search/saved/" + s.id, { alert: true });
  const row = await db().get("SELECT alert, last_checked FROM saved_searches WHERE id=$1", [s.id]);
  assert.equal(Number(row.alert), 1); assert.ok(row.last_checked > old);
  const again = row.last_checked; await u.req("PATCH", "/api/search/saved/" + s.id, { alert: true });
  assert.equal((await db().get("SELECT last_checked FROM saved_searches WHERE id=$1", [s.id])).last_checked, again, "already on: untouched");
});

test("every due alert is checked and advanced; nothing deleted (per-row errors are isolated in checkAlerts)", async () => {
  const old = new Date(Date.now() - 3600e3).toISOString();
  await db().run("UPDATE saved_searches SET last_checked=$1, alert=1", [old]);
  H.app.ctx.rl.w.clear(); await u.req("POST", "/api/search/saved", { q: "ثاني" });
  await db().run("UPDATE saved_searches SET last_checked=$1", [old]);
  const S = H.app.ctx.services.search;
  const n0 = Number((await db().get("SELECT COUNT(*) n FROM saved_searches WHERE user_id=$1", [u.id])).n);
  const r = await S.checkAlerts(); // real run first: both checked
  assert.equal(r.checked, n0);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM saved_searches WHERE user_id=$1", [u.id])).n), n0, "nothing deleted");
  // an odd query on one row must not abort the others
  await db().run("UPDATE saved_searches SET last_checked=$1", [old]);
  const first = (await db().all("SELECT id FROM saved_searches WHERE user_id=$1 ORDER BY created_at", [u.id]))[0].id;
  await db().run("UPDATE saved_searches SET q=$1 WHERE id=$2", ["\u0000".repeat(3), first]);
  const r2 = await S.checkAlerts(); assert.equal(r2.checked, n0);
  for (const x of await db().all("SELECT last_checked FROM saved_searches WHERE user_id=$1", [u.id])) assert.ok(x.last_checked > old, "every row advanced");
});
