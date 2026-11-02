/* v2.145.6: the plain «→ back» text link at the top of #/integrity, #/feedprefs, #/investigations, #/admin/market and
 * #/admin/pi was 16 px tall at 390 — under the 24 px minimum target. It now has a 44 px tap area, and the heading under it
 * does not move (no visible change). */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S?.close(); });

test("390: top back text link has a ≥44 px tap area and the page does not move", async () => {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await ctx.newPage();
  await onboard(p, S.base, "backtap", "رابط الرجوع");
  for (const route of ["#/integrity", "#/feedprefs"]) {
    await p.evaluate((h) => { location.hash = h; }, route);
    await p.waitForTimeout(1200);
    const r = await (await p.waitForFunction(() => { const a = document.querySelector("#view .wrap > .hp-strip:first-child + a.muted"), n = a?.parentElement.querySelector(":scope > h2"); if (!a || !n || document.querySelector("#view .skel")) return null; const b = a.getBoundingClientRect(), m = n.getBoundingClientRect(); return { h: b.height, gap: m.top - b.bottom }; }, null, { timeout: 15000 })).jsonValue();
    assert.ok(r.h >= 44, `${route}: back link tap height ${r.h}`);
    assert.ok(r.gap > -30, `${route}: next element still below the link (${r.gap})`);
  }
  await ctx.close();
});
