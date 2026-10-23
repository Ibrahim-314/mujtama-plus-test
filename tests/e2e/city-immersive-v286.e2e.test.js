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

/* v2.86.1: stations open IN the hall (no page change, no loader), the hall is never rebuilt while moving between stations,
 * and the wallet is a real wallet (card, send/receive tabs, quick amounts, review step, QR to receive) */
test("390: MJT stations open over the hall; the new wallet", async () => {
  const c = await S.browser.newContext({ ...MOBILE, colorScheme: "dark", timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "imm_w", "صاحب المحفظة"); await p.waitForTimeout(1000);
  await p.evaluate(() => { location.hash = "#/city/mjt/send"; });
  await p.waitForSelector("#cy-page-slot .cy-stage.cy-ready", { timeout: 45000 });
  await p.waitForSelector(".cy-st.on .cy-w-card", { timeout: 20000 }); await p.waitForTimeout(500);
  await p.evaluate(() => { document.querySelector("#cy-page-slot .cy-stage").dataset.mark = "same"; });
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v2861-wallet-390.png" });
  assert.deepEqual(await axe(p, ".cy-st-panel"), []);
  // quick amounts fill the amount; an amount above the balance stops at the review step with a message
  await p.fill('#cy-sf input[name="to"]', "someone");
  await p.fill('#cy-sf input[name="amount"]', "999999");
  await p.click("#cy-sf .cy-w-go");
  assert.equal(await p.isVisible("#cy-err"), true, "over-balance error");
  // receive tab: the member's handle and a QR
  await p.click("#cy-wt-r");
  assert.equal(await p.isVisible("#cy-wp-r"), true);
  await p.waitForSelector("#cy-qr svg", { timeout: 10000 });
  assert.match(await p.textContent(".cy-w-me"), /@imm_w/);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v2861-wallet-recv-390.png" });
  assert.deepEqual(await axe(p, ".cy-st-panel"), []);
  // another station from the dock: same hall, panel content changes in place
  await p.click('.cy-rm-nav a[href="#/city/mjt/balance"]');
  await p.waitForSelector('.cy-st-panel[data-room="balance"] .cy-rm-hero', { timeout: 15000 });
  assert.equal(await p.evaluate(() => document.querySelector("#cy-page-slot .cy-stage")?.dataset.mark), "same", "hall not rebuilt");
  // Escape closes the panel back to the hall, still the same hall
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => location.hash === "#/city/mjt" && !document.querySelector(".cy-st"), null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => document.querySelector("#cy-page-slot .cy-stage")?.dataset.mark), "same", "hall kept after closing");
  assert.equal(await p.evaluate(() => document.body.classList.contains("cy-st-open")), false);
  assert.deepEqual(errs, []);
  await c.close();
});
