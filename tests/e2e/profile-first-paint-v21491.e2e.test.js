/* v2.149.1 — the profile's first frame is the v3 design: no old layout while /api/profiles answers. */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, MOBILE } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
let S; test.before(async () => { ensureBuild(); S = await startStack(); }); test.after(async () => { await S.close(); });
const watch = () => { window.__pf = []; const tick = () => { const t = document.querySelector("#view .profile-top"); if (t) window.__pf.push({ h: location.hash, on: typeof Remote !== "undefined" && !!Remote.on, v3: document.querySelector("#view").classList.contains("pv3"), stats: !!t.querySelector(".pv3-stats"), cov: Math.round(document.querySelector("#view .cover")?.getBoundingClientRect().height || 0) }); if (window.__pf.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); };
test("v2.149.1: profile frames are v3 from the first one (repeat visit and reload)", async () => {
  const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "pfp_1", "أول"); await seedDiscovery(S.app.ctx, p); await p.evaluate(() => refresh());
  await p.evaluate(() => { location.hash = "#/u/reem_ai"; }); await p.waitForSelector(".pv3 .pv3-stats", { timeout: 15000 });
  // slow the API so the old layout would be visible for a while
  await p.route("**/api/profiles/**", async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); r.continue(); });
  await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(600);
  await p.evaluate(watch); await p.evaluate(() => { location.hash = "#/u/reem_ai"; }); await p.waitForTimeout(2500);
  let f = await p.evaluate(() => window.__pf);
  assert.ok(f.length > 5, "frames " + f.length);
  assert.deepEqual(f.filter((x) => !x.v3 || !x.stats || x.cov > 140).length, 0, "old-layout frames on repeat visit: " + JSON.stringify(f.slice(0, 5)));
  await c.addInitScript(watch); await p.reload(); await p.waitForTimeout(5000);
  f = await p.evaluate(() => window.__pf);
  assert.ok(f.length > 5, "frames after reload " + f.length);
  assert.deepEqual(f.filter((x) => !x.v3 || x.cov > 140).length, 0, "old-layout frames after reload " + JSON.stringify(f.filter((x) => !x.v3).slice(0, 3)));
  assert.deepEqual(errs, []);
  await c.close();
});
