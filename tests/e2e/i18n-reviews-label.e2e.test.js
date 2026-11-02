/* v2.145.5: the deep sweep found «صفحة سمعتي كما يراها الآخرون» (the #/reviews link to your public reputation page) shown in
 * English as «سمعتي كما يراها الآخرون page»: the «صفحة {name}» template caught it before any exact entry. The catalogue only had
 * the already-broken output as a key. The real source string now has its own entry, so the link reads in English. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S?.close(); });

test("en: the reputation page link on #/reviews is fully English", async () => {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await ctx.newPage();
  await onboard(p, S.base, "rep_label", "سارة");
  await p.evaluate(() => window.MPChunks?.load("i18n").then(() => window.MPI18n.setLang("en")));
  await p.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => window.MPI18n.lookup("صفحة سمعتي كما يراها الآخرون", "en")), "My reputation as others see it");
  await p.evaluate(() => { location.hash = "#/reviews"; });
  await p.waitForFunction(() => document.querySelector("#view")?.textContent.trim().length > 0 && !document.querySelector("#view .skel"), null, { timeout: 15000 });
  await p.waitForTimeout(1200);
  const txt = await p.evaluate(() => document.querySelector("#view").innerText);
  assert.ok(!/سمعتي كما يراها/.test(txt), "no Arabic left in the reputation link");
  await ctx.close();
});
