/* v2.85 «مدينة المجتمع الرقمية»: every building on the main street opens a hall of its own inside the city (city/halls.js)
 * with the member's real data, the gold balance chip on the map, and «دليل المدينة» under it. Nothing links out of the
 * city; items open in place; every icon the halls use exists; English/LTR; axe clean; no page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CITY_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const axe = async (p, sel = "#view") => {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async (sel) => (await window.axe.run(document.querySelector(sel), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")), sel);
};
const HALLS = ["communities", "vidtik", "work", "courses", "store", "local"];

test("390 dark: directory + balance chip; each building's hall renders real data in the city, links stay inside, axe clean", async () => {
  const c = await S.browser.newContext({ ...MOBILE, colorScheme: "dark", timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "hall_a", "زائر القاعات"); await p.waitForTimeout(1000);
  // a community of the member's own, so the square has something real to show
  await p.evaluate(async () => { try { await Remote.api("POST", "/api/communities", { name: "نادي المدينة", desc: "مجتمع تجريبي للقاعات", topic: "tech", type: "public" }); } catch { } if (typeof window.sync === "function") await window.sync().catch(() => { }); });
  await p.evaluate(() => { location.hash = "#/city"; });
  await p.waitForSelector("#cy-page-slot .cy-stage.cy-ready", { timeout: 45000 });
  await p.waitForFunction(() => /\d/.test(document.querySelector(".cy-bal bdi")?.textContent || ""), null, { timeout: 15000 });
  const dir = await p.$$eval(".cy-dir a", (as) => as.map((a) => a.getAttribute("href")));
  assert.equal(dir.length, 10, "the directory lists every building");
  assert.ok(dir.every((h) => /^#\/city\//.test(h)), "directory stays inside the city: " + dir.join(","));
  assert.deepEqual(await axe(p), []);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v285-city-390.png", fullPage: true });
  // a directory card walks the character and the building's portal opens its hall
  await p.click('.cy-dir a[data-place="communities"]');
  await p.waitForFunction(() => location.hash === "#/city/communities", null, { timeout: 15000 });
  await p.waitForSelector(".cy-hallpg .cy-hl-hero", { timeout: 15000 });
  for (const h of HALLS) {
    await p.evaluate((h) => { location.hash = "#/city/" + h; }, h);
    await p.waitForSelector(`.cy-hallpg[data-hall="${h}"] .cy-hl-hero, .cy-hallpg[data-hall="${h}"] .cy-rm-err`, { timeout: 15000 });
    await p.waitForTimeout(500);
    assert.equal(await p.$(`.cy-hallpg[data-hall="${h}"] .cy-rm-err`), null, h + " loaded");
    const out = await p.evaluate(() => [...document.querySelectorAll("#view a[href]")].map((a) => a.getAttribute("href")).filter((x) => !/^#\/(city|menu)/.test(x)));
    assert.deepEqual(out, [], h + ": links stay in the city");
    const missing = await p.evaluate(() => [...document.querySelectorAll("#view use")].map((u) => (u.getAttribute("href") || "").slice(1)).filter((id) => id && !document.getElementById(id)));
    assert.deepEqual([...new Set(missing)], [], h + ": every icon exists");
    assert.deepEqual(await axe(p), [], h + " axe");
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/v285-hall-${h}.png`, fullPage: true });
  }
  // the member's community is in the square and opens in place
  await p.evaluate(() => { location.hash = "#/city/communities"; }); await p.waitForSelector(".cy-hl-it summary");
  assert.match(await p.textContent(".cy-hallpg"), /نادي المدينة/);
  await p.click(".cy-hl-it summary"); assert.equal(await p.$eval(".cy-hl-it", (d) => d.open), true);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v285-hall-open.png", fullPage: true });
  // records / mining / wallet buildings open the MJT rooms
  const hrefs = await p.evaluate(() => Object.fromEntries(window.MPCityScenes.main.places.map((x) => [x.id, x.href])));
  assert.equal(hrefs.records, "#/city/mjt/history"); assert.equal(hrefs.harvest, "#/city/mjt/earn"); assert.equal(hrefs.wallet, "#/city/mjt/send");
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 English: halls are LTR and translated", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "hall_en", "Hall Visitor");
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForTimeout(1200);
  await p.evaluate(() => { location.hash = "#/city/courses"; });
  await p.waitForSelector(".cy-hallpg .cy-hl-hero", { timeout: 20000 });
  const t = await p.textContent(".cy-hallpg");
  assert.match(t, /City Academy/); assert.doesNotMatch(t, /أكاديمية/);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/v285-hall-1440-en.png", fullPage: true });
  assert.deepEqual(errs, []);
  await c.close();
});
