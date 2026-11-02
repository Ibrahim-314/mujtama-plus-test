/* v2.145.5: content must not jump when a screen finishes loading. The deep sweep measured layout shift on in-app navigation:
 * #/faq (the support card sat under a 2-line skeleton and dropped ~150 px when the articles landed, CLS ~0.38 on 390) and
 * #/studio («ابدأ هنا» + goals mounted above the shortcuts/tabs after their own requests, pushing them ~540 px down, CLS ~0.5).
 * v2.145.6 adds #/mentoring (the saved-mentors list was prepended above «شارك خبرتك» after its own request, CLS ~0.38),
 * #/nearby (the location card replaced its skeleton after the page painted, the search row and list moved, CLS ~0.25) and
 * #/analytics (the empty-state hero was moved above the KPI grid after the insights request, CLS ~0.25).
 * Check: navigating to each from #/home, the layout shift of what is on screen stays under 0.1 (the "good" CLS line). */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S?.close(); });

for (const route of ["#/faq", "#/studio", "#/mentoring", "#/nearby", "#/analytics"]) {
  test(`${route}: no content jump after the screen shows (390)`, async () => {
    const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await ctx.newPage();
    await onboard(p, S.base, "cls_" + route.slice(2), "ثبات المحتوى");
    await p.evaluate(() => { location.hash = "#/home"; });
    await p.waitForFunction(() => document.querySelector("#view")?.textContent.trim().length > 0, null, { timeout: 15000 });
    await p.waitForTimeout(1500);
    await p.evaluate(() => { window.__cls = 0; window.__src = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__cls += e.value; window.__src.push(e.value.toFixed(3) + " " + (e.sources || []).map((s) => s.node ? (s.node.id || String(s.node.className || s.node.nodeName)).slice(0, 30) : "?").join("|")); } }).observe({ type: "layout-shift" }); });
    await p.evaluate((h) => { location.hash = h; }, route);
    await p.waitForTimeout(4000);
    const r = await p.evaluate(() => ({ cls: window.__cls, src: window.__src }));
    assert.ok(r.cls < 0.1, `${route}: CLS ${r.cls.toFixed(3)} — ${r.src.join(", ")}`);
    await ctx.close();
  });
}
