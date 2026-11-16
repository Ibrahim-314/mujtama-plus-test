/* Fix #3 (community settings audit 2026-11-16): «تثبيت» (install bot) with an empty app id did nothing at all.
 * Now it says what is missing and puts the cursor in the field; no request is sent. */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p, cid;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); await onboard(p, S.base, "bg_o", "مالك البوت"); await dismissTour(p).catch(() => {});
  cid = await p.evaluate(async () => { const r = await fetch("/api/communities", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ name: "مجتمع البوت", desc: "وصف للفحص", topic: "dev" }) }); return (await r.json()).community.id; });
});
test.after(async () => { await ctx.close(); await S.close(); });
for (const lang of ["ar", "en"]) {
  test(`install bot with empty id explains and focuses the field (${lang})`, async () => {
    await p.evaluate((l) => MPI18n.setLang(l), lang); await p.waitForTimeout(400); // eslint-disable-line no-undef
    await p.goto(`${S.base}/?nosw#/cadmin/${cid}?s=integrations`); await p.waitForSelector("#ca-botgo");
    let posted = 0; const on = (r) => { if (/\/installs/.test(r.url()) && r.method() === "POST") posted++; }; p.on("request", on);
    await p.click("#ca-botgo"); await p.waitForTimeout(600); p.off("request", on);
    const r = await p.evaluate(() => ({ focus: document.activeElement?.id, inv: document.querySelector("#ca-botid").getAttribute("aria-invalid"), toast: [...document.querySelectorAll(".toast, #toast, [role=status]")].map((t) => t.textContent).join(" ") }));
    assert.equal(posted, 0, "no request");
    assert.equal(r.focus, "ca-botid"); assert.equal(r.inv, "true");
    assert.match(r.toast, lang === "ar" ? /اكتب معرّف التطبيق أولاً/ : /Enter the app's client id first/);
  });
}
