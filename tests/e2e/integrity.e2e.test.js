/* Track 7 — Phase 32 in the browser: device hashes reported after sign-in, the member trust center with
 * phone OTP verification (code read from the server's test sink), the «حساب جديد» profile badge and its
 * explanation, and the staff investigations dashboard (review queue → case → confirm, account view with
 * the relationship graph), plus an axe audit of the new screens. Until the integrator adds the script tag
 * and service registration (INTEGRATION.md), the test attaches both itself. */
const test = require("node:test"),
  assert = require("node:assert"),
  path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");
let S;
const errors = [];
test.before(async () => {
  S = await startStack();
  if (!S.app.ctx.services.integrity) S.app.ctx.services.integrity = require(path.join(ROOT, "server", "services", "integrity.js"))(S.app.ctx);
});
test.after(async () => {
  await S.close();
  assert.deepEqual(errors, [], "no uncaught page errors");
});
const page = async opts => {
  const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" });
  const p = await c.newPage();
  p.on("pageerror", e => errors.push(e.message));
  return p;
};
const inject = async p => {
  if (!(await p.evaluate(() => !!window.MPIntegrity))) await p.addScriptTag({ path: path.join(ROOT, "integrity-ui.js") });
  await p.waitForFunction(() => !!window.MPIntegrity);
};
const go = async (p, hash) => {
  await p.evaluate(h => (location.hash = h), hash);
  await p.waitForTimeout(50);
};
const audit = async p => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return (
    await p.evaluate(async () =>
      (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({
        id: v.id,
        impact: v.impact,
        n: v.nodes.length,
        sel: v.nodes[0]?.target?.join(" ")
      }))
    )
  ).filter(v => ["serious", "critical"].includes(v.impact));
};

test("member: device hashes, trust center with phone OTP, «حساب جديد» badge; staff: investigations dashboard", async () => {
  const ctx = S.app.ctx,
    db = ctx.db,
    svc = ctx.services.integrity;
  // first account on a fresh server is the admin (staff)
  const A = await page(MOBILE);
  await onboard(A, S.base, "ig_staff", "مشرف الأمان");
  // a member in another browser
  const M = await page(MOBILE);
  await onboard(M, S.base, "ig_member", "عضوة جديدة");
  await inject(M);
  const meId = await M.evaluate(() => DB.me);
  await M.evaluate(() => window.MPIntegrity.reportDevice(true));
  const dev = await db.all("SELECT kind, hash FROM device_signals WHERE user_id=$1", [meId]);
  assert.deepEqual(dev.map(d => d.kind).sort(), ["did", "fp"], "browser sent both hashes");
  assert.ok(dev.every(d => /^[a-f0-9]{64}$/.test(d.hash)));

  // trust center + phone verification
  await go(M, "#/integrity");
  await M.waitForSelector("#ig-send");
  assert.match(await M.textContent("#view h2"), /التحقق والثقة/);
  assert.match(await M.textContent("#view"), /حساب جديد/);
  const axeTrust = await audit(M);
  await M.fill("#ig-num", "0551239876");
  await M.click("#ig-send");
  await M.waitForSelector("#ig-code-wrap:not([hidden])");
  const code = svc.smsOutbox.at(-1).code;
  assert.equal(svc.smsOutbox.at(-1).to, "+966551239876");
  await M.fill("#ig-code", code === "000000" ? "111111" : "000000");
  await M.click("#ig-send");
  await M.locator("#ig-perr", { hasText: "غير صحيح" }).waitFor();
  await M.fill("#ig-code", code);
  await M.click("#ig-send");
  await M.waitForSelector("#ig-unphone");
  assert.match(await M.textContent("#ig-phone"), /•••• 76/);

  // the profile shows the transparent new-account badge, with an explanation sheet
  await go(M, "#/me");
  await M.waitForSelector(".profile-top h2 .newacct");
  await M.click(".profile-top h2 .newacct");
  await M.locator("body", { hasText: "لا تعني أن الحساب مخالف" }).waitFor();
  assert.match(await M.textContent("body"), /رقم جوال موثّق/);
  await M.evaluate(() => typeof closeSheet === "function" && closeSheet());

  // settings entry point
  await go(M, "#/settings?s=acct"); // v2.38: «الحساب»
  await M.waitForSelector("#ig-entry");

  // members cannot open the dashboard
  await go(M, "#/investigations");
  await M.locator("#view", { hasText: "لفريق الأمان فقط" }).waitFor();

  // staff: a dense follow ring of four new accounts → a case in the review queue
  const ring = [];
  for (let i = 0; i < 4; i++) {
    ctx.rl.w.clear();
    const r = await fetch(S.base + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" },
      body: JSON.stringify({ name: "حلقة " + i, handle: "ig_ring" + i, password: "secret1234" })
    });
    ring.push((await r.json()).user.id);
  }
  for (const a of ring) for (const b of ring) if (a !== b) await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [a, b, new Date().toISOString()]);
  const scan = await svc.scanDensity();
  assert.equal(scan.flags.length, 1);
  await inject(A);
  await go(A, "#/investigations");
  await A.waitForSelector(".ig-kpi");
  await A.waitForSelector(`a[href="#/investigation/${scan.flags[0].id}"]`);
  const axeDash = await audit(A);
  await A.click(`a[href="#/investigation/${scan.flags[0].id}"]`);
  await A.waitForSelector("svg.ig-graph");
  assert.match(await A.textContent("#view"), /مجموعة كثيفة/);
  assert.equal(await A.locator("svg.ig-graph circle").count(), 4);
  const axeCase = await audit(A);
  A.once("dialog", d => d.accept());
  await A.fill("#ig-note", "حلقة متابعة مصطنعة");
  await A.click('[data-igd="confirm"]');
  await A.waitForSelector('[data-igd="reopen"]');
  assert.equal((await svc.limitOf(ring[0])).level, "restricted");
  // account view with the relationship graph and limit controls
  await go(A, "#/inv-user/ig_ring0");
  await A.waitForSelector("#ig-lvl");
  await A.waitForSelector("svg.ig-graph");
  assert.match(await A.textContent("#view"), /مجموعات كثيفة مشبوهة/);
  await A.selectOption("#ig-lvl", "none");
  await A.click("#ig-setl");
  await A.locator("#view", { hasText: "لا قيود" }).waitFor();
  assert.equal(await svc.limitOf(ring[0]), undefined);
  const axeUser = await audit(A);
  assert.deepEqual({ axeTrust, axeDash, axeCase, axeUser }, { axeTrust: [], axeDash: [], axeCase: [], axeUser: [] });
});
