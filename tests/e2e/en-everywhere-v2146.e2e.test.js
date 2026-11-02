/* v2.146 «English everywhere». With the UI in English, the screens the runtime sweep flagged show no Arabic interface text —
 * neither visible text nor placeholder / aria-label / title — and no Arabic-Indic digits or Arabic month names
 * (dates and numbers follow the UI language). User content is excluded. Arabic stays exactly as it was. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S; const errors = [];
const ROUTES = ["#/hijri", "#/emailprefs", "#/integrity", "#/nearby", "#/settings/appearance", "#/help", "#/privacy", "#/policies", "#/scheduled", "#/cv", "#/jobs", "#/market",
  "#/admin/ops", "#/admin/pricing", "#/admin/activation", "#/admin/pi-activation", "#/admin/revenue", "#/admin/beta", "#/admin/hijri", "#/admin/security"];
const USER = "bdi,.body,.cbody,.bio,[data-noi18n],.av,.u-name,.name,.handle,.who,.cm-b,.mp-tr-out,textarea,select,option,.hj-occ";
const leftovers = (p) => p.evaluate((USER) => {
  const out = [], AR = /[\u0600-\u06FF]{2,}|[٠-٩]/, vis = (el) => el && el.getClientRects().length;
  const w = document.createTreeWalker(document.querySelector("#view"), NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!vis(el) || !AR.test(n.nodeValue) || el.closest(USER)) continue; out.push(n.nodeValue.trim().slice(0, 160)); }
  for (const el of document.querySelectorAll("#view [placeholder], #view [aria-label], #view [title]")) {
    if (!vis(el) || el.closest(USER.replace("textarea,", ""))) continue;
    for (const a of ["placeholder", "aria-label", "title"]) { const v = el.getAttribute(a) || ""; if (AR.test(v)) out.push(a + ": " + v.slice(0, 160)); }
  }
  return [...new Set(out)];
}, USER);
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });
test("390 EN: flagged screens carry no Arabic UI text, attributes, digits or month names", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "en_every", "Sweeper");
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  const left = {};
  for (const r of ROUTES) {
    await p.evaluate((r) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = r; }, r);
    await p.waitForFunction(() => !document.querySelector("#view .skel:not(#more-sentinel)") && document.querySelector("#view")?.textContent.trim().length > 0, null, { timeout: 12000 }).catch(() => {});
    await p.waitForTimeout(700);
    const a = await leftovers(p); if (a.length) left[r] = a;
  }
  assert.deepEqual(left, {}, "Arabic UI left in EN");
  // the Hijri hero reads as an English date, and the switch-back leaves Arabic exactly as it was
  await p.evaluate(() => { location.hash = "#/hijri"; }); await p.waitForSelector("#hj-hero .big");
  assert.match(await p.textContent("#hj-hero .big"), /^\d+ [A-Za-z' -]+ \d+ AH$/);
  await p.evaluate(() => window.MPI18n.setLang("ar")); await p.waitForFunction(() => document.documentElement.dir === "rtl");
  await p.waitForFunction(() => /هـ/.test(document.querySelector("#hj-hero .big")?.textContent || ""), null, { timeout: 8000 });
  await c.close();
});
