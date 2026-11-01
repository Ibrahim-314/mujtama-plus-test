/* v2.145.4: the top bar must not move after the first paint. Before, #tbMe was added by nav.js after the first paint (and was
 * display:none until the member was known), so 🌐 + search + messages jumped 46 px on the first screen after every load (often seen
 * on #/explore). Now the avatar slot ships in index.html and is reserved only on a device that was signed in last time (html.mp-me).
 * Checks: signed-in member (explore/home/communities) and a visitor — no layout shift inside .topbar, avatar shown/hidden correctly. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S?.close(); });
const watch = () => { window.__ls = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => e.sources.forEach((s) => { if (s.node && s.node.closest && s.node.closest(".topbar")) window.__ls.push((s.node.id || s.node.className) + ":" + Math.round(s.previousRect.x) + "→" + Math.round(s.currentRect.x)); }))).observe({ type: "layout-shift", buffered: true }); };
const settle = (p) => p.waitForFunction(() => document.querySelector("#view")?.textContent.trim().length > 0 && !document.querySelector("#view .skel"), null, { timeout: 15000 });

test("signed-in member: top bar icons do not move after the first paint; avatar visible", async () => {
  const ctx = await S.browser.newContext({ ...MOBILE }); const p = await ctx.newPage();
  await onboard(p, S.base, "cls_member", "ثبات الشريط");
  await p.addInitScript(watch);
  for (const h of ["#/explore", "#/home", "#/communities"]) {
    await p.goto(S.base + "/" + h); await settle(p); await p.waitForTimeout(800);
    const r = await p.evaluate(() => ({ ls: window.__ls, me: (() => { const m = document.querySelector("#tbMe"); const cs = getComputedStyle(m); return m && !m.hidden && cs.display !== "none" && cs.visibility === "visible"; })(), n: document.querySelectorAll("#tbMe").length }));
    assert.deepEqual(r.ls, [], `${h}: top bar shifted ${r.ls.join(", ")}`);
    assert.ok(r.me, `${h}: avatar shown`); assert.equal(r.n, 1, "one avatar slot");
  }
  await ctx.close();
});

test("visitor: no avatar slot and no shift", async () => {
  const ctx = await S.browser.newContext({ ...MOBILE }); const p = await ctx.newPage();
  await p.addInitScript(watch);
  await p.goto(S.base + "/#/explore"); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({ ls: window.__ls, shown: (() => { const m = document.querySelector("#tbMe"); return !!m && getComputedStyle(m).display !== "none"; })(), cls: document.documentElement.classList.contains("mp-me") }));
  assert.deepEqual(r.ls, [], `top bar shifted ${r.ls.join(", ")}`);
  assert.equal(r.shown, false); assert.equal(r.cls, false);
  await ctx.close();
});
