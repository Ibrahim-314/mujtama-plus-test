/* global route */
/* Track 7 — Phase 34 in a real browser: «بياناتي وخصوصيتي» (consent switch, request form, schedule + cancel account
 * deletion), the reporter's report timeline, the account decision log with an inline appeal opened from the
 * notification link (?appeal=…), the in-app policy reader and transparency report, the admin compliance console
 * (breach log), and an axe audit of the new screens. The service and compliance-ui.js are attached exactly as
 * INTEGRATION.md tells the integrator (service registration + lazy "compliance" chunk). */
const test = require("node:test"),
  assert = require("node:assert"),
  path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const UI = path.join(__dirname, "..", "..", "compliance-ui.js");
let S, ADM, U;
const errors = [],
  ids = {};
const until = async (P, fn, arg, timeout = 10000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await P.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 140));
    await P.waitForTimeout(100);
  }
};
const call = (P, method, p, body) =>
  P.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(u, {
        method: m,
        headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" },
        body: b ? JSON.stringify(b) : undefined
      });
      return { status: r.status, ...(await r.json().catch(() => ({}))) };
    },
    [method, p, body]
  );
async function user(handle, name) {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  const P = await ctx.newPage();
  P.on("pageerror", e => errors.push(handle + ": " + e.message));
  await onboard(P, S.base, handle, name);
  ids[handle] = (await call(P, "GET", "/api/me")).user.id;
  return P;
}
/** open a hash route with the compliance chunk attached and wait until its body rendered */
async function attach(P, hash) {
  await P.goto(S.base + "/?nosw" + hash);
  await P.waitForSelector(".bottomnav a[data-r=home]");
  await P.addScriptTag({ path: UI });
  await P.evaluate(() => route());
}
async function open(P, hash) {
  await attach(P, hash);
  await until(P, () => {
    const b = document.getElementById("cmp-body");
    return b && !b.querySelector(".skel") ? true : null;
  });
}

test.before(async () => {
  S = await startStack();
  S.app.ctx.services.compliance ||= require("../../server/services/compliance")(S.app.ctx); // INTEGRATION.md step 1
  ADM = await user("adm_cp", "مدير");
  U = await user("noor_cp", "نور");
  assert.equal((await call(ADM, "GET", "/api/me")).user.role, "admin");
});
test.after(async () => {
  await S.close();
  assert.deepEqual(errors, [], "no uncaught page errors");
});

test("settings links to «بياناتي وخصوصيتي»; consent switch saves; request form; deletion scheduled then cancelled", async () => {
  await attach(U, "#/settings?s=privacy"); // v2.38: «الخصوصية والأمان»
  await U.waitForSelector("#cmp-entry");
  assert.match(await U.textContent("#cmp-entry"), /بياناتي وخصوصيتي/);
  await open(U, "#/mydata");
  assert.ok(await U.$('a[href="/api/me/privacy/export?format=zip"][download]'));
  assert.equal(await U.isDisabled("#cs-service"), true, "required purposes cannot be switched off");
  await U.click('label[for="cs-analytics"]');
  await until(U, async () => {
    const r = await fetch("/api/me/consents");
    const j = await r.json();
    return j.consents.find(c => c.purpose === "analytics").granted === false;
  });
  await U.click("text=طلب بخصوص بياناتي");
  await U.selectOption("#cmp-rk", "rectify");
  await U.fill("#cmp-rt", "تاريخ ميلادي غير صحيح في ملفي");
  await U.click("#cmp-rsend");
  await until(U, () => [...document.querySelectorAll("#cmp-body td")].some(td => /تصحيح بيانات/.test(td.textContent)));
  await U.click("text=أريد حذف حسابي");
  await U.fill("#cmp-pw", "secret1234");
  await U.fill("#cmp-cf", "حذف");
  await U.click("#cmp-del");
  await U.waitForSelector("#cmp-undo");
  assert.match(await U.textContent(".warnbox"), /مجدول للحذف/);
  assert.equal((await call(U, "GET", "/api/me/privacy")).deletion.status, "scheduled");
  await U.click("#cmp-undo");
  await until(U, () => !document.getElementById("cmp-undo") && !!document.getElementById("cmp-del"));
  assert.equal((await call(U, "GET", "/api/me/privacy")).deletion, null);
});

test("report timeline for the reporter, then account decision log with inline appeal from the ?appeal link", async () => {
  const pa = (await call(ADM, "POST", "/api/posts", { text: "منشور للمدير" })).post;
  const rep = await call(U, "POST", "/api/reports", { target: pa.id, kind: "post", reason: "سبام" });
  assert.equal(rep.status, 200, rep.error);
  await open(U, "#/my-reports");
  assert.match(await U.textContent("#cmp-body"), /قيد المراجعة/);
  assert.ok(await U.$('.cmp-tl li[aria-current="step"]'));
  await call(ADM, "POST", `/api/admin/reports/${rep.id}`, { action: "remove" });
  await open(U, "#/my-reports");
  assert.match(await U.textContent("#cmp-body"), /اتخذنا إجراءً/);
  // a decision on Noor's own post
  const pu = (await call(U, "POST", "/api/posts", { text: "منشور لنور سيُزال" })).post;
  const r2 = await call(ADM, "POST", "/api/reports", { target: pu.id, kind: "post", reason: "مخالفة للإرشادات" });
  await call(ADM, "POST", `/api/admin/reports/${r2.id}`, { action: "remove" });
  const dec = (await call(U, "GET", "/api/me/account-log")).items.find(i => i.source === "platform");
  await open(U, "#/account-log?appeal=" + dec.id);
  await U.waitForTimeout(1200); // the realtime «removed» notification re-renders the route once
  assert.equal(await U.evaluate(() => document.activeElement?.tagName), "TEXTAREA", "the appeal box is focused");
  await U.fill(`#apt-${dec.id}`, "كان المنشور نقاشاً مشروعاً");
  await U.click(`[data-cmp-appeal="${dec.id}"]`);
  await until(U, () => [...document.querySelectorAll(".cmp-pill")].some(p => /قيد المراجعة/.test(p.textContent)));
  assert.match(await U.textContent("#cmp-body"), /مخالفة للإرشادات/);
  // the old #/decisions route now shows the same log when online
  await open(U, "#/decisions");
  assert.match(await U.textContent("#cmp-h"), /سجل قرارات حسابي/);
});

test("policy reader and transparency report; admin console with breach log", async () => {
  await open(U, "#/legal/privacy");
  assert.match(await U.textContent(".cmp-tldr"), /باختصار/);
  assert.ok((await U.$$(".cmp-doc section")).length >= 8);
  await U.click('[data-cmp-sec="rights"]');
  assert.equal(await U.evaluate(() => document.activeElement?.id), "sh-rights");
  await open(U, "#/legal/register");
  assert.match(await U.textContent("#cmp-body"), /الأغراض والأساس/);
  const now = new Date(),
    prev = now.getUTCMonth() === 0 ? `${now.getUTCFullYear() - 1}-12` : `${now.getUTCFullYear()}-${String(now.getUTCMonth()).padStart(2, "0")}`;
  assert.equal((await call(ADM, "POST", "/api/admin/transparency/generate", { period: prev })).status, 200);
  await open(U, "#/transparency");
  await U.click(`a[href="#/transparency/${prev}"]`);
  await until(U, () => /تقرير الشفافية:/.test(document.getElementById("cmp-h")?.textContent || "") && !document.querySelector("#cmp-body .skel"));
  assert.ok((await U.$$(".cmp-stat")).length >= 8);
  await open(U, "#/compliance");
  assert.match(await U.textContent("#cmp-body"), /للإدارة فقط/);
  await open(ADM, "#/compliance/breaches");
  await ADM.click("text=تسجيل حادثة جديدة");
  await ADM.fill("#br-t", "اختبار حادثة");
  await ADM.selectOption("#br-s", "high");
  await ADM.click("#br-go");
  await until(ADM, () => [...document.querySelectorAll("#cmp-tab article b")].some(b => b.textContent === "اختبار حادثة"));
  await ADM.click('[data-cmp-f="authorityNotifiedAt"]');
  await until(ADM, () => [...document.querySelectorAll("#cmp-tab .cmp-pill")].some(p => p.textContent === "تم"));
  await open(ADM, "#/compliance/retention");
  assert.match(await ADM.textContent("#cmp-tab"), /وضع المعاينة فقط/);
  assert.equal(await ADM.isDisabled("#rt-run"), true);
});

test("accessibility: privacy center, decision log, policy reader, report timeline and admin console have no serious/critical WCAG A/AA violations", async () => {
  const report = {};
  for (const [P, r] of [
    [U, "#/mydata"],
    [U, "#/account-log"],
    [U, "#/my-reports"],
    [U, "#/legal/terms"],
    [ADM, "#/compliance/requests"],
    [ADM, "#/compliance/retention"]
  ]) {
    await open(P, r);
    await P.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    report[r] = (
      await P.evaluate(async () =>
        (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({
          id: v.id,
          impact: v.impact,
          n: v.nodes.length,
          sel: v.nodes[0]?.target?.join(" ")
        }))
      )
    ).filter(v => ["serious", "critical"].includes(v.impact));
  }
  const bad = Object.entries(report).filter(([, v]) => v.length);
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
