/* v2.149.8: community settings on phones — small buttons (36px), section chips (36px) and colour swatches (32px)
   keep their look, but their touch area reaches 44px (approved design A, 2026-11-17). */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p, cid;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); await onboard(p, S.base, "t44_o", "مالك"); await dismissTour(p).catch(() => {});
  cid = await p.evaluate(async () => { const r = await fetch("/api/communities", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ name: "مجتمع لمس", desc: "وصف للفحص", topic: "dev" }) }); return (await r.json()).community.id; });
});
test.after(async () => { await ctx.close(); await S.close(); });
// Swatches sit 8px apart, so each grows by half the gap to 40px without stealing a neighbour's taps.
// For each target: visible height unchanged, and a tap 3px (buttons/chips) outside its top and bottom edge still lands on it.
async function probe(sel, pad) {
  return p.evaluate(({ sel, pad }) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && !e.closest(".ca-nav")).slice(0, 6).map((e) => {
    e.scrollIntoView({ block: "center", inline: "center" }); const r = e.getBoundingClientRect(), x = r.left + r.width / 2;
    const hit = (y) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); };
    return { sel, txt: (e.textContent || e.dataset.sw || "").trim().slice(0, 20), h: Math.round(r.height), top: hit(r.top - pad), bottom: hit(r.bottom + pad) };
  }), { sel, pad });
}
for (const [sec, wait, targets] of [
  ["general", ".ca-sws", [[".ca-chip", 3, 36], [".ca-swb", 3, 32], [".ca-swc", 3, 32], [".ca .btn.sm", 3, 0]]],
  ["rules", ".ca-rl", [[".ca-chip", 3, 36], [".ca .btn.sm", 3, 0]]],
]) {
  test(`touch area reaches 44px without changing the look (${sec})`, async () => {
    await p.goto("about:blank"); await p.goto(`${S.base}/?nosw#/cadmin/${cid}?s=${sec}`); await p.waitForSelector(wait); await p.waitForTimeout(300);
    for (const [sel, pad, h] of targets) {
      const rows = await probe(sel, pad); assert.ok(rows.length, `${sel} present`);
      for (const r of rows) { if (h) assert.equal(r.h, h, `${sel} «${r.txt}» keeps ${h}px look`); assert.ok(r.top && r.bottom, `${sel} «${r.txt}» tappable just outside: ${JSON.stringify(r)}`); }
    }
  });
}
