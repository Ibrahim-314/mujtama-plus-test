/* v2.149.5 «الإدارة ترسم مرة»: cold opens (en) of screens whose module arrives after the core —
 * a) #/admin: the hub draws once with every module's card; no card pops in (and pushes the rest down) after the first frame
 * b) #/me/paid-posts, #/admin/paid, #/admin/tips: the first screen painted is the screen itself — never the profile or the
 *    admin hub first, then swapped for the real page */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    window.__fr = []; window.__cls = 0; const t0 = performance.now();
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift" }); } catch { /* old engine */ }
    const tick = () => {
      const v = document.getElementById("view");
      if (v) {
        const w = v.querySelector(":scope > .wrap"), h = v.querySelector(".page-head h2"), skel = !!v.querySelector(".skel:not(#more-sentinel)") && !h;
        const tl = v.querySelector("#adm-tools"), cards = tl ? tl.querySelectorAll("a[href]").length : -1;
        window.__fr.push({ t: performance.now() - t0, skel, cover: !!v.querySelector(":scope > .cover"), wcls: w ? w.className : "", text: v.textContent.trim().length, cards });
      }
      if (performance.now() - t0 < 4500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  p = await ctx.newPage(); await onboard(p, S.base, "nf5_admin", "مدير الوميض"); await dismissTour(p).catch(() => {}); // first account = admin
  await p.evaluate(() => MPI18n.setLang("en")); await p.waitForTimeout(600); // eslint-disable-line no-undef
});
test.after(async () => { await ctx.close(); await S.close(); });
const cold = async (h, ms = 4600) => { await p.goto("about:blank"); await p.goto(S.base + "/?nosw" + h); await p.waitForTimeout(ms); return p.evaluate(() => ({ fr: window.__fr, cls: window.__cls })); };
const shown = (fr) => fr.filter((f) => f.text > 0 && !f.skel);

test("v2.149.5 a: cold #/admin (en) — the hub's cards are all there in its first frame; nothing is pushed down after", async () => {
  const { fr, cls } = await cold("#/admin");
  const s = shown(fr); assert.ok(s.length > 10, "frames with the hub"); // cards = rows of the «أدوات الإدارة» list (-1 = list not drawn yet)
  const last = s[s.length - 1].cards; assert.ok(last >= 5, "module cards on the hub: " + last);
  const grew = s.filter((f) => f.cards !== last);
  assert.equal(grew.length, 0, `frames with a different card count than the settled ${last}: ${grew.length} (first ${grew[0]?.cards} at ${Math.round(grew[0]?.t)} ms)`);
  assert.ok(cls < 0.05, "CLS " + cls.toFixed(4));
});
for (const [h, want] of [["#/me/paid-posts", "pd-page"], ["#/admin/paid", "pd-page"], ["#/admin/tips", "tp-page"]]) {
  test(`v2.149.5 b: cold ${h} (en) — the first screen painted is ${want}, never another screen first`, async () => {
    const { fr } = await cold(h);
    const s = shown(fr); assert.ok(s.length > 5, "frames with content");
    const other = s.filter((f) => f.cover || !f.wcls.split(/\s+/).includes(want));
    assert.equal(other.length, 0, `${other.length} frames of another screen first (${other[0]?.cover ? "profile cover" : other[0]?.wcls} at ${Math.round(other[0]?.t)} ms)`);
  });
}
