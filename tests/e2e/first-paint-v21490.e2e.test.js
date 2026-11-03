/* global DB, save, applyShell */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S; test.before(async () => { ensureBuild(); S = await startStack(); }); test.after(async () => { await S.close(); });
const EMOJI = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2630]/u;
/* v2.149.0: the first paint (before any script runs) must already be the current design: SVG tab icons, no old emoji */
test("v2.149.0: bottom nav first paint has the SVG icons, no emoji (scripts blocked)", async () => {
  const c = await S.browser.newContext({ ...MOBILE, javaScriptEnabled: false }); const p = await c.newPage();
  await p.goto(S.base + "/?nosw#/home");
  const r = await p.evaluate(() => [...document.querySelectorAll(".bottomnav a[data-r]")].map((a) => ({ r: a.dataset.r, off: a.querySelectorAll("span > svg.ic-off").length, on: a.querySelectorAll("span > svg.ic-on").length, txt: a.querySelector("span").textContent })));
  assert.ok(r.length >= 5, "tabs " + r.length);
  for (const t of r) { assert.equal(t.off, 1, t.r + " ic-off"); assert.equal(t.on, 1, t.r + " ic-on"); assert.ok(!EMOJI.test(t.txt), t.r + " emoji " + t.txt); }
  await c.close();
});
test("v2.149.0: after boot each tab keeps one icon pair and the side logo holds no tab icons", async () => {
  for (const vp of [MOBILE, { viewport: { width: 1440, height: 900 } }]) {
    const c = await S.browser.newContext({ ...vp }); const p = await c.newPage();
    await p.goto(S.base + "/?nosw#/home"); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({ tabs: [...document.querySelectorAll(".bottomnav a[data-r] > span")].map((s) => s.querySelectorAll("svg.ic").length), logo: document.querySelectorAll(".side-brand .logo svg").length }));
    for (const n of r.tabs) assert.equal(n, 2, "icons per tab " + JSON.stringify(r.tabs));
    assert.equal(r.logo, 0, "side logo svg");
    await c.close();
  }
});
test("v2.149.0: Home's first frame is the current design (no old tabs) and a saved dark shell paints dark from the start", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await onboard(p, S.base, "fp_home", "أول"); await dismissTour(p);
  await p.evaluate(() => { DB.settings.theme = "dark"; save(); applyShell(); }); await p.waitForTimeout(2500); // as the settings buttons do
  await c.addInitScript(() => { window.__fv = null; window.__th = []; const tick = () => { window.__th.push(document.documentElement.dataset.theme || ""); const t = document.querySelector("#view .tabs"); if (t && !window.__fv) window.__fv = [...t.querySelectorAll("[data-mode]")].map((b) => b.dataset.mode); if (performance.now() < 6000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await p.reload(); await p.waitForTimeout(4000);
  const r = await p.evaluate(() => ({ fv: window.__fv, th: [...new Set(window.__th)] }));
  assert.ok(r.fv && r.fv.length, "tabs seen");
  for (const k of ["latest", "discover", "chrono"]) assert.ok(!r.fv.includes(k), "old tab in first frame: " + JSON.stringify(r.fv));
  assert.deepEqual(r.th.filter((x) => x !== "dark"), [], "theme frames " + JSON.stringify(r.th));
  await c.close();
});
