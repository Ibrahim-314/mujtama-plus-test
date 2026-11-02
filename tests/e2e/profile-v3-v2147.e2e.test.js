/* v2.147.0 — profile v3 (approved mockup 2026-11-02): shorter cover, four-cell stats card, «مميّز» row above underline tabs,
 * profile search on the cover, call moved into «⋯» (not removed), owner add-bio line + share. 390/1440 × ar/en × light/dark. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
const SHOTS = process.env.PV3_SHOTS;
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
const open = async (p, h) => { await p.evaluate((h) => { location.hash = h; }, h); await p.waitForSelector(".pv3 .pv3-stats", { timeout: 15000 }); await p.waitForTimeout(400); };
for (const [vw, VP] of [["390", MOBILE], ["1440", DESKTOP]]) test(vw + ": visitor + owner profile v3", async () => {
  const c = await S.browser.newContext({ ...VP, reducedMotion: "reduce" }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "pv3_" + vw, "فاحص"); await seedDiscovery(S.app.ctx, p); await p.evaluate(() => refresh());
  for (const lang of ["ar", "en"]) {
    if (lang === "en") { await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr"); }
    for (const theme of ["light", "dark"]) {
      await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await open(p, "#/u/reem_ai");
      const cells = await p.$$eval(".pv3-stats > *", (cs) => cs.map((c) => c.getBoundingClientRect().height));
      assert.equal(cells.length, 4, "posts, followers, following, reputation");
      assert.ok(cells.every((h) => h >= 44), "stat cells are 44px+ tap targets");
      assert.ok(await p.$(".cover .pv3-srch"), "profile search moved onto the cover");
      const ch = await p.$eval(".cover", (e) => e.getBoundingClientRect().height); assert.ok(ch <= (vw === "390" ? 140 : 190), "shorter cover " + ch);
      const tabsBelowFeat = await p.evaluate(() => { const f = document.querySelector(".pv3-feat"), t = document.querySelector(".wrap > .tabs"); return !f || f.getBoundingClientRect().top < t.getBoundingClientRect().top; }); assert.ok(tabsBelowFeat, "«مميّز» sits above the tabs");
      assert.equal(await p.$$eval(".psec .mini-grid", (g) => g.length), 0, "old works/articles grids folded into «مميّز»");
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no page overflow");
      if (lang === "en") { const txt = await p.$eval(".pv3-stats", (e) => e.innerText); assert.ok(!/[\u0600-\u06FF]/.test(txt), "stats in English: " + txt); }
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/v-${vw}-${lang}-${theme}.png` });
    }
  }
  // call is in «⋯»
  await p.evaluate(() => window.MPI18n.setLang("ar")); await p.waitForFunction(() => document.documentElement.dir === "rtl");
  await p.evaluate(() => { document.documentElement.dataset.theme = "light"; }); await open(p, "#/u/reem_ai");
  await p.click("#pmore"); await p.waitForSelector("#sheet .menu");
  const hasCall = await p.$('[data-call="voice"],[data-call-menu]'); if (hasCall) assert.ok(await p.$("#sheet [data-pv3call]"), "call item in «⋯» menu");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/more-${vw}.png` });
  await p.evaluate(() => closeSheet());
  // owner
  await open(p, "#/me");
  assert.ok(await p.$(".pv3-share"), "owner share button"); assert.ok(await p.$("#edit2"), "edit profile kept");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/me-${vw}.png` });
  assert.deepEqual(errs, []); await c.close();
});
