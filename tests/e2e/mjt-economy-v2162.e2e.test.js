/* v2.162 «اقتصاد MJT» admin dashboard → v2.167 «التطبيق يشتغل تلقائياً»: the admin page #/admin/mjt-economy, its lazy `mjteco`
 * chunk and /api/admin/mjt/economy were removed (issuance runs on fixed rules; the owner reads the supply on «لوحة المالك»).
 * This spec keeps the route honest: the old page renders nothing of the dashboard, the API answers 404, the chunk is gone, and
 * the owner page shows the MJT supply instead. Members' wallet pages are covered by mjt / mjt-services / mjt-clarity specs. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");

let S, ctx, p; const errors = [];
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "eco_admin", "مدير الاقتصاد"); // first account → admin
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("v2.167: #/admin/mjt-economy and its API are gone; «لوحة المالك» shows the MJT supply", async () => {
  await p.evaluate(() => { location.hash = "#/admin/mjt-economy"; }); await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => !!document.querySelector("#view svg.eco-chart, #view [data-eco]")), false, "no economy dashboard");
  const st = await p.evaluate(async () => (await fetch("/api/admin/mjt/economy", { headers: { "X-Requested-With": "mujtama" } })).status);
  assert.equal(st, 404);
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, "../..", "dist", "build.json"), "utf8"));
  assert.equal(b.files.some((f) => /chunk-mjteco-/.test(f.file)), false, "the mjteco chunk is gone");
  await p.evaluate(() => { location.hash = "#/owner"; });
  await p.waitForFunction(() => /لوحة المالك/.test(document.querySelector("#view")?.textContent || ""), null, { timeout: 15000 });
  assert.match(await p.textContent("#view"), /مجتمع كوين المتداول/);
  assert.deepEqual(errors, []);
});
