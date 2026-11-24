/* v2.161.1: the guided tour must never leave a dim, untappable screen — a step whose target sits below the fold (the home hub pushes
 * #cbar down) scrolls it into view first, and the card always lands fully inside the viewport with its buttons tappable. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, ctx, p;
test.before(async () => { S = await startStack(); ctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 600 }, reducedMotion: "reduce" }); p = await ctx.newPage(); await onboard(p, S.base, "tour_user", "جولة"); });
test.after(async () => { await ctx?.close(); await S?.close(); });
test("tour card is on screen and tappable on every step, even when the target is below the fold", async () => {
  await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForSelector("#hub, #cbar", { timeout: 15000 }); await p.waitForTimeout(1200);
  // the spotlight style (A/B «tour_style» ≠ card) is the one that broke: force it for this test
  await p.route("**/api/onboarding", async (route) => { const r = await route.fetch(); const j = await r.json(); j.experiments = { ...(j.experiments || {}), tour_style: "spot" }; await route.fulfill({ response: r, json: j }); });
  await p.evaluate(() => scrollTo(0, 0)); await p.evaluate(() => window.MPTour());
  for (let step = 0; step < 8; step++) {
    const ok = await p.waitForFunction(() => !document.querySelector(".tour") || document.querySelector(".tour-card #t-next"), null, { timeout: 5000 }).catch(() => null);
    assert.ok(ok, "tour step painted");
    if (!(await p.$(".tour"))) break;
    await p.waitForTimeout(450);
    const c = await p.evaluate(() => { const r = document.querySelector(".tour-card").getBoundingClientRect(), b = document.querySelector("#t-next").getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { top: r.top, bottom: r.bottom, h: innerHeight, hit: hit?.id || hit?.closest("button")?.id }; });
    assert.ok(c.top >= 0 && c.bottom <= c.h, `card inside viewport (step ${step}): ${c.top}-${c.bottom} of ${c.h}`);
    assert.equal(c.hit, "t-next", "next button is tappable");
    await p.click("#t-next");
  }
  assert.equal(await p.$(".tour"), null, "tour closes at the end");
});
