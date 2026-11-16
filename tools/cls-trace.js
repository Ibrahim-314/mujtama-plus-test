/* global require, process, window, PerformanceObserver, console, document */
/* dev tool (v2.149.7): which elements shift on a cold open, per route.
 *   node tools/cls-trace.js "#/purchases,#/admin/finance" [en|ar] [admin]
 * First account on a fresh stack is the admin, so admin routes work. */
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("../tests/e2e/harness");
const routes = process.argv[2].split(","), lang = process.argv[3] || "ar";
(async () => {
  ensureBuild(); const S = await startStack(); const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    window.__ls = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: e.sources.map((s) => { const n = s.node; return n ? (n.nodeName + "." + String(n.className || "").slice(0, 40) + "#" + (n.id || "") + " " + JSON.stringify([s.previousRect.y, s.previousRect.height, s.currentRect.y, s.currentRect.height])) : "?"; }) }); }).observe({ type: "layout-shift", buffered: true });
  });
  const p = await ctx.newPage(); await onboard(p, S.base, "clstrace", "تجربة"); await dismissTour(p).catch(() => {});
  if (lang === "en") { await p.evaluate(() => MPI18n.setLang("en")); await p.waitForTimeout(500); } // eslint-disable-line no-undef
  for (const r of routes) {
    await p.goto("about:blank"); await p.goto(S.base + "/?nosw" + r); await p.waitForTimeout(3500);
    const ls = await p.evaluate(() => window.__ls); if (process.env.SEL) console.log("H", await p.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().height, process.env.SEL));
    console.log("== " + r + " total " + ls.reduce((a, b) => a + b.v, 0).toFixed(4));
    ls.filter((x) => x.v > 0.003).forEach((x) => console.log(JSON.stringify(x).slice(0, 500)));
  }
  await ctx.close(); await S.close();
})();
