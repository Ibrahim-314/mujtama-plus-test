/* v2.86 «المدينة تملأ الشاشة»: inside #/city the app's bottom bar steps aside (and returns on leaving); the HUD carries a
 * sound button (remembered) and a full-screen button (Fullscreen API or the immersive layout); the default character is a
 * modern one and an old pick maps to its modern look; the 3D character loads; axe clean; no page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.CITY_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const axe = async (p, sel = "#view") => {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async (sel) => (await window.axe.run(document.querySelector(sel), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")), sel);
};
const navHidden = (p) => p.evaluate(() => { const n = document.querySelector(".bottomnav"); if (!n) return true; const cs = getComputedStyle(n); return cs.visibility === "hidden" || cs.opacity === "0"; });

test("390: bottom bar hides in the city and returns; sound + full screen tools; modern character", async () => {
  const c = await S.browser.newContext({ ...MOBILE, colorScheme: "dark", timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "imm_a", "زائر المدينة"); await p.waitForTimeout(1000);
  await p.evaluate(() => localStorage.setItem("mp.city.char", "knight")); // a pick from before v2.86
  assert.equal(await navHidden(p), false, "bar visible outside the city");
  await p.evaluate(() => { location.hash = "#/city"; });
  await p.waitForSelector("#cy-page-slot .cy-stage.cy-ready", { timeout: 45000 });
  await p.waitForSelector("#cy-page-slot .cy-tool-snd", { timeout: 10000 });
  await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => document.body.classList.contains("cy-city")), true);
  assert.equal(await navHidden(p), true, "bottom bar hidden in the city");
  // the old pick maps to its modern look; the 3D character loads
  assert.equal(await p.evaluate(() => MPCity.charId()), "suit");
  assert.deepEqual(await p.evaluate(() => MPCity.chars.map((x) => x.id)), ["hoodie", "casual", "suit", "casual-f", "suit-f"]);
  await p.waitForSelector("#cy-page-slot .cy-actor.ready, #cy-page-slot .cy-actor:not(.cy-3d)", { timeout: 30000 });
  // sound: on by default, the button mutes and the choice is remembered
  assert.equal(await p.getAttribute(".cy-tool-snd", "aria-pressed"), "true");
  await p.click(".cy-tool-snd");
  assert.equal(await p.getAttribute(".cy-tool-snd", "aria-pressed"), "false");
  assert.equal(await p.evaluate(() => localStorage.getItem("mp.city.sound")), "0");
  await p.click(".cy-tool-snd");
  assert.equal(await p.evaluate(() => localStorage.getItem("mp.city.sound")), "1");
  // a tap on a street wakes the audio without errors
  const b = await p.evaluate(() => { const r = document.querySelector("#cy-page-slot .cy-hit").getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.62]; });
  await p.mouse.click(b[0], b[1]); await p.waitForTimeout(500);
  // full screen on, then off
  await p.click(".cy-tool-fs"); await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => document.body.classList.contains("cy-imm")), true, "immersive on");
  assert.equal(await p.getAttribute(".cy-tool-fs", "aria-pressed"), "true");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v286-city-fs-390.png" });
  const top = await p.evaluate(() => getComputedStyle(document.querySelector(".topbar")).opacity); assert.equal(top, "0", "top bar out of the way");
  assert.deepEqual(await axe(p), []);
  await p.click(".cy-tool-fs"); await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => document.body.classList.contains("cy-imm")), false, "immersive off");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v286-city-390.png" });
  assert.deepEqual(await axe(p), []);
  // a hall keeps the bar hidden; leaving the city brings it back and ends full screen
  await p.click(".cy-tool-fs"); await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = "#/city/work"; }); await p.waitForSelector(".cy-hallpg", { timeout: 15000 });
  assert.equal(await navHidden(p), true, "hidden in a hall");
  await p.evaluate(() => { location.hash = "#/menu"; }); await p.waitForTimeout(900);
  assert.equal(await p.evaluate(() => document.body.classList.contains("cy-city") || document.body.classList.contains("cy-imm")), false);
  assert.equal(await navHidden(p), false, "bar back after leaving");
  assert.deepEqual(errs, []);
  await c.close();
});
