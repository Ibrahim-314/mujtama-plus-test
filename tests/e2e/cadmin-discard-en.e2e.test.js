/* v2.149.8: the unsaved-changes bar of community settings says «Discard» in English (was «Skip»), «تجاهل» in Arabic. */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p, cid;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); await onboard(p, S.base, "dc_o", "مالك"); await dismissTour(p).catch(() => {});
  cid = await p.evaluate(async () => { const r = await fetch("/api/communities", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ name: "مجتمع زر", desc: "وصف للفحص", topic: "dev" }) }); return (await r.json()).community.id; });
});
test.after(async () => { await ctx.close(); await S.close(); });
for (const [lang, want] of [["ar", "تجاهل"], ["en", "Discard"]]) {
  test(`unsaved changes bar discard button (${lang})`, async () => {
    await p.goto("about:blank"); await p.goto(`${S.base}/?nosw#/cadmin/${cid}?s=rules`); await p.waitForSelector(".ca-rl");
    await p.evaluate((l) => MPI18n.setLang(l), lang); await p.waitForTimeout(400); // eslint-disable-line no-undef
    await p.click(".ca-radd"); await p.fill(".ca-rl .ca-ru .ca-rt", "قاعدة"); await p.waitForSelector("#ca-save:not([hidden])");
    assert.equal((await p.textContent('[data-ca="discard"]')).trim(), want);
    await p.click('[data-ca="discard"]');
  });
}
