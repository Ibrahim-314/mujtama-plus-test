/* v2.149.7: cold #/purchases — the paid-content and digital-products sections fill from separate requests; they now show
 * together, so the second section is never pushed down while the page loads (was CLS 0.127 cold, en, 390). */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
const { seedDiscovery } = require("./discovery-seed.js");
let S, ctx, p;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce", colorScheme: "dark", timezoneId: "Asia/Riyadh" });
  await ctx.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift" }); } catch { /* old engine */ } });
  /* real servers answer the two lists at different times; make that ordering deterministic here */
  await ctx.route(/\/api\/(me\/)?digital/, async (r) => { await new Promise((ok) => setTimeout(ok, 700)); r.continue(); });
  p = await ctx.newPage(); await onboard(p, S.base, "nf7_pu", "مشتريات الوميض"); await dismissTour(p).catch(() => {});
  await seedDiscovery(S.app.ctx, p); // a lived-in account: the sweep that found the jump (0.12) uses the same world
});
test.after(async () => { await ctx.close(); await S.close(); });
for (const lang of ["en", "ar"]) {
  test(`v2.149.7: cold #/purchases (${lang}) — both sections appear together, nothing pushed down`, async () => {
    await p.evaluate((l) => MPI18n.setLang(l), lang); await p.waitForTimeout(500); // eslint-disable-line no-undef
    await p.goto("about:blank"); await p.goto(S.base + "/?nosw#/purchases"); await p.waitForTimeout(3800);
    const r = await p.evaluate(() => ({ cls: window.__cls, a: !!document.querySelector("#pd-sec"), b: !!document.querySelector("#dg-lib"), vis: !!document.querySelector("#pd-sec")?.offsetParent && !!document.querySelector("#dg-lib")?.offsetParent }));
    assert.ok(r.a && r.b && r.vis, "both sections shown");
    assert.ok(r.cls < 0.03, "CLS " + r.cls.toFixed(4));
  });
}
