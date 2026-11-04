/* v2.149.4 «بالإنجليزي من أول إطار»: English cold opens — a screen drawn (or redrawn by a background refresh) never paints a
 * frame in Arabic first, and the «i» overlay row never stands alone in an empty #view before the screen arrives */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    window.__fr = []; const t0 = performance.now();
    const tick = () => {
      const v = document.getElementById("view");
      if (v) {
        const h = v.querySelector(".tp-head h2, .page-head h2");
        window.__fr.push({ t: performance.now() - t0, h: h ? h.textContent.trim() : "", lone: v.children.length > 0 && [...v.children].every((c) => c.classList.contains("hp-strip")), kidStrip: !!v.querySelector(":scope > .hp-strip") });
      }
      if (performance.now() - t0 < 3500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  p = await ctx.newPage(); await onboard(p, S.base, "nf4_user", "مختبر الإنجليزي"); await dismissTour(p).catch(() => {});
  await p.evaluate(() => MPI18n.setLang("en")); await p.waitForTimeout(600); // eslint-disable-line no-undef
});
test.after(async () => { await ctx.close(); await S.close(); });
const cold = async (h, ms = 3600) => { await p.goto("about:blank"); await p.goto(S.base + "/?nosw" + h); await p.waitForTimeout(ms); return p.evaluate(() => window.__fr); };
const AR = /[\u0600-\u06FF]/;

test("v2.149.4: #/digest (en) — no frame of the page title in Arabic, through every redraw", async () => {
  const fr = (await cold("#/digest")).filter((f) => f.h);
  assert.ok(fr.length > 10, "frames with a title");
  const ar = fr.filter((f) => AR.test(f.h));
  assert.equal(ar.length, 0, "Arabic title painted in " + ar.length + " frames (first at " + Math.round(ar[0]?.t) + " ms)");
});
for (const h of ["#/settings?s=help", "#/settings?s=privacy"]) {
  test(`v2.149.4: ${h} (en) — the «i» row never sits alone in #view, and never directly in #view`, async () => {
    const fr = await cold(h);
    assert.equal(fr.filter((f) => f.lone).length, 0, "lone «i» row frames");
    assert.equal(fr.filter((f) => f.kidStrip).length, 0, "«i» row as a direct child of #view");
  });
}
