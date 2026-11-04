/* v2.149.6 «المنشور يرسم مرة»: a cold open of a post page (en + ar) draws the post with its late decorations already in place —
 * the safety 🛡 button (protection chunk) and the translate button (ai chunk) are in the first frame that shows the post, so the
 * «⋯» button is never replaced and the author line never shrinks ~0.9 s after the page appeared. */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p, pid;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    window.__fr = []; window.__cls = 0; const t0 = performance.now();
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift" }); } catch { /* old engine */ }
    const tick = () => {
      const v = document.getElementById("view");
      if (v) {
        const post = v.querySelector("[data-more]"), meta = v.querySelector(".meta");
        window.__fr.push({ t: performance.now() - t0, post: !!post, shield: !!v.querySelector(".pt-shield"), metaW: meta ? Math.round(meta.getBoundingClientRect().width) : 0 });
      }
      if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  p = await ctx.newPage(); await onboard(p, S.base, "nf6_post", "منشور الوميض"); await dismissTour(p).catch(() => {});
  const mk = await p.evaluate(async () => { const r = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ text: "Learning to code step by step is the best way to start your career in tech" }) }); return r.json(); });
  pid = (mk.post || mk).id; assert.ok(pid, "post created");
});
test.after(async () => { await ctx.close(); await S.close(); });
const cold = async (h, ms = 3800) => { await p.goto("about:blank"); await p.goto(S.base + "/?nosw" + h); await p.waitForTimeout(ms); return p.evaluate(() => ({ fr: window.__fr, cls: window.__cls })); };
for (const lang of ["en", "ar"]) {
  test(`v2.149.6: cold #/post (${lang}) — the safety button is in the post's first frame; the author line never shrinks after`, async () => {
    await p.evaluate((l) => MPI18n.setLang(l), lang); await p.waitForTimeout(500); // eslint-disable-line no-undef
    const { fr, cls } = await cold("#/post/" + pid);
    const s = fr.filter((f) => f.post); assert.ok(s.length > 10, "frames with the post");
    const fin = s[s.length - 1]; assert.ok(fin.shield, "settled post has the safety button");
    const late = s.filter((f) => f.shield !== fin.shield || Math.abs(f.metaW - fin.metaW) > 8);
    assert.equal(late.length, 0, `${late.length} frames before the decorations landed (first at ${Math.round(late[0]?.t)} ms, meta ${late[0]?.metaW} → ${fin.metaW})`);
    assert.ok(cls < 0.02, "CLS " + cls.toFixed(4));
  });
}
test("v2.149.6: cold #/settings?s=help (en) — the help section's rows are there when it draws; the cards under it are not pushed down", async () => {
  await p.evaluate(() => MPI18n.setLang("en")); await p.waitForTimeout(500); // eslint-disable-line no-undef
  const { cls } = await cold("#/settings?s=help", 3500);
  assert.ok(cls < 0.04, "CLS " + cls.toFixed(4)); // was 0.24: FAQ / tickets / developers / beta / privacy rows filed in one by one
});
