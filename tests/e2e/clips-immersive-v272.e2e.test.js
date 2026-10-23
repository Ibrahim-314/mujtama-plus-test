/* v2.72 — immersive «لقطات»: on phones the bottom nav pill is hidden while the clips viewer is open (it covered the clip),
 * and comes back immediately on leaving (close X, browser back, any route change). The clip fills the viewport, the
 * close X and the «لك»|«المتابَعون» tabs stay reachable, axe 0 serious/critical. At 1440 the side nav stays (beside the
 * centred column, no overlap). CLIPS_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CLIPS_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const seed = (p) => p.evaluate(() => {
  for (let i = 0; i < 6; i++) if (!S.post("climm_" + i)) DB.posts.push({ id: "climm_" + i, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة غامرة " + (i + 1), createdAt: new Date(Date.now() - i * 60000).toISOString(), media: "#223", video: { short: true, duration: 12, variants: { "360p": "/media/none-" + i + ".mp4", poster: "" } } });
});
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};
const navShown = (p) => p.evaluate(() => { const n = document.querySelector(".bottomnav"); if (!n) return false; const s = getComputedStyle(n), b = n.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && b.height > 0 && b.width > 0; });
/* store re-syncs can drop client-seeded clips under load: re-seed + retry */
const openClips = async (p) => {
  for (let k = 0; k < 3; k++) {
    await seed(p); await p.evaluate(() => { location.hash = "#/clips"; });
    try { await p.waitForSelector(".shorts .short", { timeout: 8000 }); await p.waitForSelector(".cl-tabs"); await p.waitForTimeout(400); return; } catch { await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(600); }
  }
  throw new Error("clips did not render");
};
const goHome = async (p) => { await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForFunction(() => !document.body.classList.contains("shorts-mode")); await p.waitForTimeout(300); };
const reachable = (p) => p.evaluate(() => {
  const inView = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.width >= 44 && b.height >= 44 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth && document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(".shorts-back, .cl-tabs-tab") === el; };
  const clip = document.querySelector(".shorts .short").getBoundingClientRect();
  return { x: inView(document.querySelector(".shorts-back")), tabs: [...document.querySelectorAll(".cl-tabs-tab")].map(inView), clipH: Math.round(clip.height), vh: innerHeight, ox: document.documentElement.scrollWidth > innerWidth };
});

test("390: nav hidden in clips, back after the close X, after history back and after a route change; X + tabs reachable; axe light/dark/LTR", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "climm_a", "مشاهد غامر");
  await goHome(p); assert.ok(await navShown(p), "nav visible on home");
  // 1) close X
  await openClips(p);
  assert.ok(await p.evaluate(() => document.body.classList.contains("shorts-mode")));
  assert.equal(await navShown(p), false, "bottom nav hidden inside clips");
  const r = await reachable(p);
  assert.ok(r.x, "close X reachable"); assert.ok(r.tabs.length === 2 && r.tabs.every(Boolean), "both tabs reachable " + JSON.stringify(r.tabs));
  assert.ok(Math.abs(r.clipH - r.vh) <= 2, `clip fills the viewport (${r.clipH} vs ${r.vh})`); assert.ok(!r.ox, "no horizontal overflow");
  let v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/clips-390-light.png" });
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; }); await p.waitForTimeout(200);
  assert.equal(await navShown(p), false, "hidden in dark too");
  v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/clips-390-dark.png" });
  await p.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await p.click(".shorts-back");
  await p.waitForFunction(() => !document.body.classList.contains("shorts-mode"), null, { timeout: 8000 });
  assert.ok(await navShown(p), "nav back right after the close X");
  // 2) browser back
  await goHome(p); await openClips(p); assert.equal(await navShown(p), false);
  await p.goBack(); await p.waitForFunction(() => !document.body.classList.contains("shorts-mode"), null, { timeout: 8000 });
  assert.ok(await navShown(p), "nav back after history back");
  // 3) any route change
  await openClips(p); assert.equal(await navShown(p), false);
  await p.evaluate(() => { location.hash = "#/explore"; }); await p.waitForFunction(() => !document.body.classList.contains("shorts-mode"), null, { timeout: 8000 });
  assert.ok(await navShown(p), "nav back after a route change");
  // 4) LTR
  await p.evaluate(() => { document.documentElement.dir = "ltr"; document.documentElement.lang = "en"; });
  await openClips(p); assert.equal(await navShown(p), false, "hidden in LTR");
  const rl = await reachable(p); assert.ok(rl.x && rl.tabs.every(Boolean), "X + tabs reachable in LTR");
  v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark: side nav stays beside the clips column (no overlap), axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  await onboard(p, S.base, "climm_b", "مشاهد سطح المكتب");
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await openClips(p);
  assert.ok(await navShown(p), "desktop side nav kept");
  const hit = await p.evaluate(() => { const a = document.querySelector(".bottomnav").getBoundingClientRect(), b = document.querySelector(".shorts").getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; });
  assert.ok(!hit, "side nav does not overlap the clips column");
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
