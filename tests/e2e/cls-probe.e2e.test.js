/* v2.148.1 probe: layout shifts on Home (and other routes) with their sources. Prints a report; asserts nothing. */
const test = require("node:test");
const { startStack, onboard, dismissTour, MOBILE, DESKTOP } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
const fs = require("node:fs");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
const ROUTES = (process.env.CLS_ROUTES || "home").split(",");
const OBS = () => {
  window.__ls = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__ls.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: (e.sources || []).map((s) => { const n = s.node; if (!n || !n.tagName) return "?"; const id = n.id ? "#" + n.id : ""; const cl = n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).slice(0, 3).join(".") : ""; const par = n.parentElement ? (n.parentElement.id ? "#" + n.parentElement.id : n.parentElement.className && typeof n.parentElement.className === "string" ? "." + n.parentElement.className.trim().split(/\s+/)[0] : n.parentElement.tagName) : ""; return par + ">" + n.tagName.toLowerCase() + id + cl + ` y${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)} h${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)}`; }) }); } }).observe({ type: "layout-shift", buffered: true });
  window.__mut = [];
  addEventListener("DOMContentLoaded", () => { const v = document.getElementById("view"); if (!v) return; new MutationObserver((ms) => { for (const m of ms) { if (m.target === v && m.type === "childList") window.__mut.push(["wrap", Math.round(performance.now())]); else if (m.type === "attributes") { const c = m.target.closest && m.target.closest(".post-card,.discover"); if (c) window.__mut.push(["attr:" + m.attributeName + ":" + (m.target.className || m.target.tagName).toString().slice(0, 40), Math.round(performance.now())]); } else if (m.type === "childList") { const c = m.target.closest && m.target.closest(".post-card,.discover"); if (c) window.__mut.push(["kids:" + (m.target.className || m.target.tagName).toString().slice(0, 40), Math.round(performance.now())]); } } }).observe(v, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] }); new MutationObserver((ms) => { for (const m of ms) window.__mut.push(["body/html:" + m.target.tagName + ":" + m.attributeName + "=" + String(m.target.getAttribute(m.attributeName)).slice(0, 80) + " sy=" + Math.round(scrollY), Math.round(performance.now())]); }).observe(document.body, { attributes: true }); new MutationObserver((ms) => { for (const m of ms) window.__mut.push(["html:" + m.attributeName + "=" + String(m.target.getAttribute(m.attributeName)).slice(0, 80), Math.round(performance.now())]); }).observe(document.documentElement, { attributes: true }); });
};
for (const [vpName, vp] of [["390", MOBILE], ["1440", DESKTOP]]) {
  test("cls " + vpName, async () => {
    const c = await S.browser.newContext({ ...vp }); const p = await c.newPage();
    await onboard(p, S.base, "cls_" + vpName, "قياس"); await seedDiscovery(S.app.ctx, p); await dismissTour(p);
    await p.addInitScript(OBS);
    const out = [];
    for (const r of ROUTES) {
      await p.goto(S.base + "/?nosw&cls=" + r + "#/" + r); await p.waitForTimeout(6000);
      const ls = await p.evaluate(() => window.__ls || []);
      out.push({ route: r, cls: +ls.reduce((a, e) => a + e.v, 0).toFixed(4), shifts: ls });
      // in-app navigation (route change without reload), the path users actually take
    }
    for (const r of ROUTES) {
      await p.goto(S.base + "/?nosw#/notifications"); await p.waitForTimeout(2500);
      await p.evaluate(() => { window.__ls = []; }); await p.evaluate((r) => { location.hash = "#/" + r; }, r); await p.waitForTimeout(5000);
      const ls = await p.evaluate(() => window.__ls || []);
      out.push({ route: r + " (nav)", cls: +ls.reduce((a, e) => a + e.v, 0).toFixed(4), shifts: ls });
    }
    for (const r of ["home", "explore", "communities"]) {
      await p.goto(S.base + "/?nosw&scr=" + r + "#/" + r); await p.waitForTimeout(4000); await p.evaluate(() => { window.__ls = []; });
      for (let i = 0; i < 14; i++) { await p.mouse.wheel(0, 350); await p.waitForTimeout(700); }
      for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -500); await p.waitForTimeout(700); }
      const ls = await p.evaluate(() => window.__ls || []);
      out.push({ route: r + " (scroll)", mut: await p.evaluate(() => window.__mut.slice(-400)), cls: +ls.reduce((a, e) => a + e.v, 0).toFixed(4), shifts: ls });
    }
    fs.writeFileSync(`/workspace/work/cls-${vpName}.json`, JSON.stringify(out, null, 1));
    await c.close();
  });
}
