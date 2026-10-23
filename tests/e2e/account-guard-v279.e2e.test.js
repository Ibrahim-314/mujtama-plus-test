/* v2.79 — «حماية الحساب».
 * 390 light RTL: a moderator under the team 2FA policy sees the warning card on #/security; the activity list loads,
 * pages older entries and flags failed bursts; axe clean. 1440 dark EN admin with 2FA: #/admin/security shows the KPIs,
 * the staff list, the policy switch and the incident card; turning the policy on works; the sign-out-everyone sheet
 * rejects a wrong phrase; axe clean; the menu has the entry. No page errors. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const TOTP = require("../../server/lib/totp");
let S;
test.before(async () => { S = await startStack({}); });
test.after(async () => { await S.close(); });
const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
const axe = async (p, sel) => {
  await p.evaluate(async () => { if (!document.getElementById("axe-settle")) { const st = document.createElement("style"); st.id = "axe-settle"; st.textContent = "*,*::before,*::after{transition:none!important}"; document.head.append(st); } document.getAnimations().forEach((a) => { const t = a.effect?.getComputedTiming?.(); if (t && t.iterations !== Infinity) a.finish(); }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async sel =>
    (await window.axe.run(document.querySelector(sel), { resultTypes: ["violations"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(v => v.id + ": " + v.nodes.map(n => n.target.join(" ") + " [" + JSON.stringify((n.any[0]||{}).data||null) + "]").join(", ")), sel);
};

test("390 light RTL moderator: policy card, activity list with paging", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message + " @ " + String(e.stack).split("\n").slice(1, 4).join(" | ")));
  await onboard(p, S.base, "ag_mod_e2e", "مشرفة الأمان");
  const me = await p.evaluate(() => DB.me);
  const db = S.app.ctx.db;
  await db.run("UPDATE users SET role='moderator' WHERE id=$1", [me]);
  await db.run("INSERT INTO provider_settings(name,value,updated_by,updated_at) VALUES('security_policy',$1,'t',$2) ON CONFLICT (name) DO UPDATE SET value=$1",
    [JSON.stringify({ staff2fa: true, enforceAt: new Date(Date.now() + 48 * 3600e3).toISOString() }), new Date().toISOString()]);
  S.app.ctx.services.security.resetGuardCache();
  for (let i = 0; i < 31; i++) await S.app.ctx.audit("session_revoked", me, null, me);
  await S.app.ctx.audit("login_failed_burst", me, "6", null);
  await p.evaluate(() => { location.hash = "#/security"; });
  await p.waitForSelector(".sec-staff", { timeout: 20000 });
  assert.match(await p.textContent(".sec-staff"), /مطلوب منك التحقق بخطوتين/);
  assert.match(await p.textContent(".sec-staff"), /قبل/);
  const b = await p.$eval("#staff-2fa", x => x.getBoundingClientRect());
  assert.ok(b.height >= 44);
  await p.click("#act-load");
  await p.waitForSelector(".sec-act .sec-act-row");
  assert.equal(await p.$$eval(".sec-act-row", r => r.length), 30);
  assert.match(await p.textContent(".sec-act-row.is-warn"), /محاولات دخول فاشلة متكررة \(6\)/);
  assert.deepEqual(await axe(p, "#view .wrap"), []);
  await p.click("#act-more");
  await p.waitForFunction(() => document.querySelectorAll(".sec-act-row").length === 32);
  assert.equal(await p.$("#act-more"), null);
  await p.click("#staff-2fa");
  await p.waitForSelector("#tfa-code", { timeout: 10000 });
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark EN admin: platform security page, policy on, sign-out sheet guard, menu entry", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message + " @ " + String(e.stack).split("\n").slice(1, 4).join(" | ")));
  await onboard(p, S.base, "ag_admin_e2e", "مدير الأمان");
  const me = await p.evaluate(() => DB.me);
  await S.app.ctx.db.run("UPDATE users SET role='admin' WHERE id=$1", [me]);
  await S.app.ctx.db.run("DELETE FROM provider_settings WHERE name='security_policy'");
  S.app.ctx.services.security.resetGuardCache();
  S.app.ctx.rl?.w?.clear?.();
  const ok = await p.evaluate(async ([h, gen]) => {
    const s = await (await fetch("/api/security/2fa/setup", { method: "POST", headers: h })).json();
    return s.secret;
  }, [H]);
  const code = TOTP.generate(ok);
  const en = await p.evaluate(async ([h, code]) => (await fetch("/api/security/2fa/enable", { method: "POST", headers: h, body: JSON.stringify({ code }) })).status, [H, code]);
  assert.equal(en, 200);
  await p.reload();
  await p.waitForFunction(() => window.DB && DB.me && window.MPI18n, null, { timeout: 20000 });
  await p.evaluate(() => window.MPI18n.setLang("en"));
  await p.evaluate(() => { location.hash = "#/admin/security"; });
  await p.waitForSelector("#pol-on", { timeout: 20000 });
  assert.match(await p.textContent(".page-head h2"), /Platform security/);
  assert.match(await p.textContent(".kpi"), /Team accounts/);
  assert.match(await p.textContent("#view .wrap"), /On ✓/);
  assert.deepEqual(await axe(p, "#view .wrap"), []);
  await p.selectOption("#pol-grace", "24");
  await p.check("#pol-on");
  await p.waitForFunction(() => /Required from|يُلزم/.test(document.querySelector("#view .wrap")?.textContent || ""), null, { timeout: 10000 });
  const pol = await p.evaluate(async h => (await (await fetch("/api/admin/security/policy", { headers: h })).json()).policy, H);
  assert.equal(pol.staff2fa, true);
  await p.click("#rv-all");
  await p.waitForSelector("#rv-phrase");
  await p.fill("#rv-phrase", "yes");
  await p.fill("#rv-code", "000000");
  await p.click("#rv-go");
  await p.waitForFunction(() => (document.querySelector("#rv-err")?.textContent || "").length > 0);
  assert.equal((await p.evaluate(async h => (await fetch("/api/me", { headers: h })).status, H)), 200, "still signed in");
  await p.keyboard.press("Escape");
  await p.evaluate(() => { location.hash = "#/menu"; });
  await p.waitForSelector('a[href="#/admin/security"]', { timeout: 15000 });
  assert.deepEqual(errs, []);
  await c.close();
});

/* v2.82 regression: the passkey and session buttons on #/security lost their handlers in v2.79. */
test("390 RTL #/security: «إضافة مفتاح مرور» runs the passkey ceremony and session sign-out answers", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.addInitScript(() => {
    window.__pkCalls = 0;
    if (!window.PublicKeyCredential) window.PublicKeyCredential = function () {};
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: async () => { window.__pkCalls++; throw new DOMException("cancelled", "NotAllowedError"); }, get: async () => null } });
  });
  await onboard(p, S.base, "ag_pk_e2e", "مفتاح المرور");
  await p.evaluate(() => { location.hash = "#/security"; });
  await p.waitForSelector("#pk-add", { timeout: 20000 });
  await p.click("#pk-add");
  await p.waitForFunction(() => window.__pkCalls === 1, null, { timeout: 10000 });
  await p.waitForFunction(() => /أُلغيت العملية/.test(document.getElementById("toast")?.textContent || ""), null, { timeout: 10000 });
  const sess = await p.$("[data-sess]");
  if (sess) { await sess.click(); await p.waitForFunction(() => /تسجيل الخروج|✓/.test(document.getElementById("toast")?.textContent || ""), null, { timeout: 10000 }); }
  assert.deepEqual(errs, []);
  await c.close();
});
