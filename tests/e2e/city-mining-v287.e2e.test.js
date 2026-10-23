/* v2.87 «التعدين» + full-page stations: a station opens as a full opaque page over the MJT hall (no dialog, no scrim),
 * the hall stays mounted underneath; the mining page shows the live counter, starts a 24-hour session, the daily sign-in
 * reward is credited once; back returns to the hall instantly; axe clean; no page errors. */
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

test("390: mining page — live counter, start, sign-in reward; stations are full pages", async () => {
  const c = await S.browser.newContext({ ...MOBILE, colorScheme: "dark", timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "mine_e2e", "عضو يعدّن"); await p.waitForTimeout(2500); // the boot sign-in reward fires after 1.5 s
  await p.evaluate(() => { location.hash = "#/city/mjt"; });
  await p.waitForSelector('.cy-hall[data-scene="mjt"] .cy-stage.cy-ready', { timeout: 45000 });
  await p.evaluate(() => { location.hash = "#/city/mjt/earn"; });
  await p.waitForSelector(".cy-mn .cy-mn-go", { timeout: 15000 });
  // a full page: covers the viewport, no dialog role, no scrim, the hall still mounted underneath
  const box = await p.evaluate(() => { const r = document.querySelector("body > .cy-st").getBoundingClientRect(); return [r.width, r.height, innerWidth, innerHeight]; });
  assert.ok(box[0] >= box[2] - 1 && box[1] >= box[3] - 1, "station covers the screen " + box);
  assert.equal(await p.evaluate(() => !!document.querySelector(".cy-st [role=dialog]")), false);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".cy-st-scrim")).display), "none");
  // the sign-in reward was credited once (boot); the card shows it
  assert.equal(await p.evaluate(() => document.querySelector(".cy-mn-daily").classList.contains("done")), true);
  assert.equal(await p.getAttribute(".cy-mn", "data-phase"), "idle");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v287-mine-idle-390.png" });
  assert.deepEqual(await axe(p), []);
  await p.click(".cy-mn-go");
  await p.waitForSelector('.cy-mn[data-phase="run"]', { timeout: 10000 });
  const a = await p.textContent(".cy-mn-num [data-live]"); await p.waitForTimeout(2500);
  const b = await p.textContent(".cy-mn-num [data-live]");
  assert.ok(Number(b) > Number(a), `counter rises ${a} → ${b}`);
  assert.match(await p.textContent("[data-cd]"), /^2[34]:\d\d:\d\d$/);
  if (SHOTS) { await p.screenshot({ path: SHOTS + "/v287-mine-run-390.png" }); await p.screenshot({ path: SHOTS + "/v287-mine-full-390.png", fullPage: true }); }
  assert.deepEqual(await axe(p), []);
  // the server agrees: one active session of 5 MJT, sign-in reward 1 MJT in the balance
  const st = await p.evaluate(() => Remote.api("GET", "/api/mjt/mining"));
  assert.equal(st.session.amount, "5"); assert.equal(st.checkin.today, true); assert.equal(st.balance, "1");
  // wallet is a full page too; back returns to the hall instantly
  await p.click('.cy-rm-nav a[href="#/city/mjt/send"]');
  await p.waitForSelector(".cy-st.on .cy-w-card", { timeout: 15000 });
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v287-wallet-390.png" });
  await p.click(".cy-st-x"); await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => location.hash), "#/city/mjt");
  assert.equal(await p.evaluate(() => !!document.querySelector("body > .cy-st")), false);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.cy-hall[data-scene="mjt"] .cy-stage')).visibility), "visible");
  assert.deepEqual(errs, []);
  await c.close();
});
