/* v2.79 — «حماية الحساب»: own security activity, repeated failed-password alert, staff 2FA policy (grace period,
 * locked staff served as members until they enable 2FA, self-2FA required to turn it on, kill switch) and the
 * incident-response "sign out everyone" (admin + 2FA + typed confirmation, keeps the caller's own session). */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");
const TOTP = require("../lib/totp");

let H;
const db = () => H.app.ctx.db;
const sec = () => H.app.ctx.services.security;
async function mk(handle, role) {
  H.app.ctx.rl.w.clear();
  const cl = new H.Client();
  const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error);
  cl.id = r.user.id;
  cl.handle = handle;
  if (role) await db().run("UPDATE users SET role=$1 WHERE id=$2", [role, cl.id]);
  return cl;
}
async function enable2fa(cl) {
  const s = await cl.req("POST", "/api/security/2fa/setup");
  assert.equal(s.status, 200);
  const r = await cl.req("POST", "/api/security/2fa/enable", { code: TOTP.generate(s.secret) });
  assert.equal(r.status, 200);
  return r.backupCodes;
}
const setPolicy = (v) =>
  db().run("INSERT INTO provider_settings(name,value,updated_by,updated_at) VALUES('security_policy',$1,'t',$2) ON CONFLICT (name) DO UPDATE SET value=$1", [JSON.stringify(v), new Date().toISOString()]);

test.before(async () => { H = await boot({}); });
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("own security activity lists only the member's security events, newest first, with paging", async () => {
  const a = await mk("ag_act"), b = await mk("ag_act2");
  await enable2fa(a);
  let r = await a.req("GET", "/api/security/activity");
  assert.equal(r.status, 200);
  assert.equal(r.items[0].action, "2fa_enabled");
  assert.ok(r.items.every((x) => typeof x.id === "number" && x.at));
  r = await b.req("GET", "/api/security/activity");
  assert.equal(r.items.length, 0, "another member's events never show");
  for (let i = 0; i < 32; i++) H.app.ctx.audit("session_revoked", a.id, null, a.id);
  await H.app.ctx.audit("session_revoked", a.id, null, a.id);
  r = await a.req("GET", "/api/security/activity");
  assert.equal(r.items.length, 30);
  assert.equal(r.more, true);
  const next = await a.req("GET", "/api/security/activity?before=" + r.items[29].id);
  assert.ok(next.items.length >= 3 && next.items.every((x) => x.id < r.items[29].id));
  assert.equal((await new H.Client().req("GET", "/api/security/activity")).status, 401);
});

test("five failed passwords within an hour alert the owner once", async () => {
  const a = await mk("ag_fail");
  const bad = new H.Client();
  for (let i = 0; i < 7; i++) {
    H.app.ctx.rl.w.clear();
    const r = await bad.req("POST", "/api/auth/login", { handle: "ag_fail", password: "wrong" + i });
    assert.equal(r.status, 401);
  }
  await new Promise((res) => setTimeout(res, 50));
  const n = await db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='security_failed'", [a.id]);
  assert.equal(n.length, 1);
  const r = await a.req("GET", "/api/security/activity");
  assert.ok(r.items.some((x) => x.action === "login_failed_burst"));
  // unknown handles never throw or alert anyone
  assert.equal((await bad.req("POST", "/api/auth/login", { handle: "nobody_here", password: "x" })).status, 401);
});

test("staff 2FA policy: self-2FA required, grace, lock, unlock by enabling 2FA, kill switch", async () => {
  const boss = await mk("ag_boss", "admin"), mod = await mk("ag_mod", "moderator"), member = await mk("ag_mem");
  let r = await boss.req("PUT", "/api/admin/security/policy", { staff2fa: true, graceHours: 0 });
  assert.equal(r.status, 409);
  assert.equal(r.code, "self_2fa_required");
  assert.equal((await member.req("GET", "/api/admin/security/policy")).status, 403);
  await enable2fa(boss);
  assert.equal((await boss.req("PUT", "/api/admin/security/policy", { staff2fa: true, graceHours: 5 })).status, 400);
  r = await boss.req("PUT", "/api/admin/security/policy", { staff2fa: true, graceHours: 72 });
  assert.equal(r.status, 200);
  assert.ok(Date.parse(r.policy.enforceAt) > Date.now() + 71 * 3600e3);
  const nm = await db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='security_staff2fa'", [mod.id]);
  assert.equal(nm.length, 1, "staff without 2FA are told");
  assert.equal((await db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='security_staff2fa'", [boss.id])).length, 0);
  r = await boss.req("GET", "/api/admin/security/policy");
  assert.equal(r.policy.enforced, false);
  assert.deepEqual(r.staff.find((s) => s.handle === "ag_mod"), { id: mod.id, handle: "ag_mod", name: "عضو ag_mod", role: "moderator", twoFactor: false });
  let o = await mod.req("GET", "/api/security");
  assert.deepEqual({ ...o.staff, enforceAt: !!o.staff.enforceAt }, { role: "moderator", locked: false, required: true, enforceAt: true });

  // grace over → enforced
  await setPolicy({ staff2fa: true, enforceAt: new Date(Date.now() - 1000).toISOString() });
  sec().resetGuardCache();
  const lockedAdmin = await mk("ag_admin2", "admin");
  assert.equal((await lockedAdmin.req("GET", "/api/admin/security/policy")).status, 403, "admin without 2FA loses admin powers");
  o = await lockedAdmin.req("GET", "/api/security");
  assert.equal(o.staff.locked, true);
  assert.equal(o.staff.role, "admin");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [lockedAdmin.id])).role, "admin", "nothing demoted in the database");
  assert.equal((await boss.req("GET", "/api/admin/security/policy")).status, 200, "admin with 2FA keeps powers");
  await db().run("UPDATE sessions SET mfa=1 WHERE user_id=$1", [lockedAdmin.id]);
  sec().resetGuardCache();
  assert.equal((await lockedAdmin.req("GET", "/api/admin/security/policy")).status, 200, "a Pi / strong-auth session satisfies the policy");
  await db().run("UPDATE sessions SET mfa=0 WHERE user_id=$1", [lockedAdmin.id]);
  sec().resetGuardCache();
  assert.equal((await lockedAdmin.req("GET", "/api/admin/security/policy")).status, 403);
  await enable2fa(lockedAdmin);
  assert.equal((await lockedAdmin.req("GET", "/api/admin/security/policy")).status, 200, "enabling 2FA restores powers at once");
  assert.equal((await member.req("GET", "/api/security")).staff, null);

  // kill switch
  process.env.SECURITY_STAFF2FA_OFF = "1";
  await boss.req("PUT", "/api/admin/security/policy", { staff2fa: false });
  await setPolicy({ staff2fa: true, enforceAt: new Date(Date.now() - 1000).toISOString() });
  sec().resetGuardCache();
  const admin3 = await mk("ag_admin3", "admin");
  assert.equal(sec().policy && (await sec().policy()).staff2fa, false);
  assert.equal((await admin3.req("GET", "/api/admin/security/policy")).status, 200);
  delete process.env.SECURITY_STAFF2FA_OFF;
  r = await boss.req("PUT", "/api/admin/security/policy", { staff2fa: false });
  assert.equal(r.policy.staff2fa, false);
});

test("sign out everyone: admin + 2FA + typed phrase; caller stays signed in", async () => {
  const boss = await mk("ag_rv_boss", "admin"), x = await mk("ag_rv_x"), y = await mk("ag_rv_y"), member = await mk("ag_rv_m");
  assert.equal((await member.req("POST", "/api/admin/security/revoke-all", { confirm: "تسجيل خروج الجميع", code: "1" })).status, 403);
  let r = await boss.req("POST", "/api/admin/security/revoke-all", { confirm: "تسجيل خروج الجميع", code: "1" });
  assert.equal(r.status, 409, "needs 2FA on the caller");
  const codes = await enable2fa(boss);
  assert.equal((await boss.req("POST", "/api/admin/security/revoke-all", { confirm: "نعم", code: codes[0] })).status, 400);
  assert.equal((await boss.req("POST", "/api/admin/security/revoke-all", { confirm: "تسجيل خروج الجميع" })).status, 401);
  assert.equal((await boss.req("POST", "/api/admin/security/revoke-all", { confirm: "تسجيل خروج الجميع", code: "00000-00000" })).status, 401);
  H.app.ctx.rl.w.clear();
  r = await boss.req("POST", "/api/admin/security/revoke-all", { confirm: "تسجيل خروج الجميع", code: codes[1] });
  assert.equal(r.status, 200);
  assert.ok(r.revoked >= 3);
  assert.equal((await x.req("GET", "/api/me")).status, 401);
  assert.equal((await y.req("GET", "/api/me")).status, 401);
  assert.equal((await boss.req("GET", "/api/me")).status, 200, "caller keeps their session");
  const audit = await db().get("SELECT * FROM audit_log WHERE action='sessions_revoked_all' ORDER BY id DESC LIMIT 1");
  assert.equal(audit.by_user, boss.id);
});

test("security overview tips: low backup codes", async () => {
  const a = await mk("ag_tip");
  await enable2fa(a);
  await db().run("UPDATE user_2fa SET backup_codes=$1 WHERE user_id=$2", [["only-one"], a.id]);
  const o = await a.req("GET", "/api/security");
  assert.ok(o.tips.some((t) => t.key === "codes"));
});
