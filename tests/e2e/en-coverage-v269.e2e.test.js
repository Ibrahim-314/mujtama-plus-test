/* v2.69 — English coverage sweep. With the UI in English, the main routes show no Arabic interface text
 * (user content — names, posts, bios, community names — excluded). Arabic RTL output is unchanged. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S; const errors = [];
const ROUTES = process.env.EN_SWEEP_ROUTES ? JSON.parse(require("fs").readFileSync(process.env.EN_SWEEP_ROUTES, "utf8")) : ["#/home", "#/notifications", "#/messages", "#/me", "#/search", "#/menu", "#/settings", "#/market", "#/wallet", "#/mjt", "#/events", "#/communities", "#/scheduled", "#/mydata", "#/emailprefs", "#/explore", "#/library", "#/studio", "#/jobs", "#/courses", "#/help", "#/security", "#/privacy"];
const USER = "bdi,.body,.cbody,.bio,[data-noi18n],.av,.u-name,.name,.handle,.who,.cm-b,.mp-tr-out,textarea,input,select,option";
const arabicLeft = (p) => p.evaluate((USER) => {
  const out = [], AR = /[\u0600-\u06FF]{2,}/;
  for (const root of document.querySelectorAll("#view,.topbar,.bottomnav")) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!el || !AR.test(n.nodeValue) || el.closest(USER) || !el.getClientRects().length) continue; out.push(n.nodeValue.trim().slice(0, 300)); }
  }
  return [...new Set(out)];
}, USER);
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });
test("390 EN: main routes carry no Arabic UI text; AR unchanged", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "en_sweeper", "Sweeper");
  assert.match(await p.textContent(".bottomnav"), /الرئيسية/);
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  const left = {};
  for (const r of ROUTES) {
    await p.evaluate((r) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = r; }, r);
    await p.waitForTimeout(900);
    const a = await arabicLeft(p); if (a.length) left[r] = a;
  }
  if (process.env.EN_SWEEP_OUT) require("fs").writeFileSync(process.env.EN_SWEEP_OUT, JSON.stringify(left, null, 1));
  const total = Object.values(left).reduce((s, a) => s + a.length, 0);
  assert.ok(total <= Number(process.env.EN_SWEEP_MAX ?? 0), "Arabic UI strings left in EN (" + total + "): " + JSON.stringify(left));
  await p.evaluate(() => window.MPI18n.setLang("ar")); await c.close();
});
