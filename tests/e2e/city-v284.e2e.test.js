/* v2.84 «مدينة المجتمع الرقمية» (city/*): its own page #/city, reached from «المزيد» only — no longer on the profile; tapping a
 * street walks the character; the MJT building opens its vault onto the hall; buildings without a hall show «قيد البناء»
 * and never leave the city; the hall's stations open the city's own rooms (#/city/mjt/<room>) with the member's real MJT
 * data; reduced motion skips the walk; English/LTR labels; axe clean. */
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
const openMe = async (p) => {
  await p.evaluate(() => { location.hash = "#/city"; });
  await p.waitForSelector("#cy-page-slot .cy-stage.cy-ready", { timeout: 45000 });
  await p.waitForTimeout(400);
};
// a tap at scene coordinates (784×1341 art pixels)
const tapScene = (p, x, y) => p.evaluate(([x, y]) => { const b = document.querySelector("#cy-page-slot .cy-hit").getBoundingClientRect(); return [b.left + (x / 784) * b.width, b.top + (y / 1341) * b.height]; }, [x, y]).then(([cx, cy]) => p.mouse.click(cx, cy));

test("390 dark: «المزيد» → مدينة المجتمع الرقمية, not on the profile, street tap walks, MJT opens the vault hall", async () => {
  const c = await S.browser.newContext({ ...MOBILE, colorScheme: "dark", timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "city_a", "ساكن المدينة"); await p.waitForTimeout(1200);
  await p.evaluate(() => { location.hash = "#/me"; }); await p.waitForSelector("#view .profile-top", { timeout: 20000 }); await p.waitForTimeout(600);
  assert.equal(await p.$("#view .cy-stage"), null, "the city is not on the profile any more");
  await p.evaluate(() => { location.hash = "#/menu"; }); await p.waitForSelector('#view a[href="#/city"]', { state: "attached", timeout: 20000 });
  await p.evaluate(() => { const a = document.querySelector('#view a[href="#/city"]'); a.closest("details")?.setAttribute("open", ""); a.click(); }); await p.waitForSelector("#cy-page-slot .cy-stage.cy-ready", { timeout: 45000 }); await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => location.hash), "#/city");
  assert.equal(await p.evaluate(() => document.querySelectorAll("#cy-page-slot .cy-sign[data-place]").length), 10, "10 live signs");
  assert.ok(await p.$("#cy-page-slot .cy-hint"), "first-time hint");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/city-390-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  // street tap → glowing route + walking
  const before = await p.evaluate(() => getComputedStyle(document.querySelector("#cy-page-slot .cy-actors")).getPropertyValue("--x"));
  await tapScene(p, 300, 742); await p.waitForTimeout(350);
  assert.ok(await p.evaluate(() => document.querySelector("#cy-page-slot .cy-trail").classList.contains("on")), "route drawn");
  assert.ok(await p.evaluate(() => document.querySelectorAll("#cy-page-slot .cy-actor").length === 1 && document.querySelector("#cy-page-slot .cy-actor").classList.contains("walk")), "one character, walking");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/city-390-walk.png" });
  await p.waitForFunction(() => !document.querySelector("#cy-page-slot .cy-actor").classList.contains("walk"), null, { timeout: 15000 });
  const after = await p.evaluate(() => getComputedStyle(document.querySelector("#cy-page-slot .cy-actors")).getPropertyValue("--x"));
  assert.notEqual(before, after, "moved"); assert.equal(await p.$("#cy-page-slot .cy-hint"), null, "hint gone after the first walk");
  // v2.85: the store opens its own hall inside the city (never an app page), then back to the city
  await tapScene(p, 120, 780); await p.waitForFunction(() => location.hash === "#/city/store", null, { timeout: 15000 }).catch(async (e) => { throw new Error("hash=" + await p.evaluate(() => location.hash + " busy=" + !!document.querySelector(".cy-portal") + " walk=" + !!document.querySelector(".cy-actor.walk"))); });
  await p.waitForSelector('.cy-hallpg[data-hall="store"]', { timeout: 15000 });
  await p.evaluate(() => { location.hash = "#/city"; }); await p.waitForSelector("#cy-page-slot .cy-stage.cy-ready", { timeout: 45000 }); await p.waitForTimeout(600);
  // building tap → walk to its door → portal → its own system
  await tapScene(p, 740, 900);
  await p.waitForSelector(".cy-portal.cy-vault .cy-v-door", { timeout: 15000 });
  if (SHOTS) { await p.waitForTimeout(700); await p.screenshot({ path: SHOTS + "/city-390-vault.png" }); }
  await p.waitForFunction(() => location.hash === "#/city/mjt", null, { timeout: 8000 });
  await p.waitForFunction(() => !document.querySelector(".cy-portal"), null, { timeout: 8000 });
  await p.waitForSelector("#cy-page-slot .cy-stage.cy-ready", { timeout: 20000 });
  assert.equal(await p.evaluate(() => document.querySelectorAll("#cy-page-slot .cy-frame-n").length), 6, "6 animated neon frames in the hall");
  assert.equal(await p.evaluate(() => document.querySelectorAll("#cy-page-slot .cy-actor").length), 1, "only the member's character in the hall");
  // back in the city the character waits at that door
  await openMe(p);
  const at = await p.evaluate(() => JSON.parse(sessionStorage.getItem("mp.city.at.main")));
  assert.deepEqual(at, [600, 934], "at the MJT door");
  assert.deepEqual(errs, []); await c.close();
});

test("390 light reduced motion + keyboard: no walk animation, Enter on MJT opens the hall, old #/town redirects", async () => {
  const c = await S.browser.newContext({ ...MOBILE, colorScheme: "light", reducedMotion: "reduce", timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "city_b", "ساكنة هادئة"); await p.waitForTimeout(1200);
  await openMe(p);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/city-390-light.png" });
  await p.focus('#cy-page-slot .cy-area[data-place="mjt"]'); await p.keyboard.press("Enter");
  await p.waitForFunction(() => location.hash === "#/city/mjt", null, { timeout: 6000 });
  await p.evaluate(() => { location.hash = "#/town"; }); await p.waitForFunction(() => location.hash === "#/city", null, { timeout: 6000 });
  assert.deepEqual(errs, []); await c.close();
});

test("1440 English LTR: labels translated, city centred on its page", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "city_c", "City Walker"); await p.waitForTimeout(1200);
  await openMe(p);
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForTimeout(1200);
  const labels = await p.evaluate(() => [...document.querySelectorAll("#cy-page-slot .cy-sign-t")].map(t => t.textContent));
  assert.ok(labels.includes("Communities") && labels.includes("MJT Coin"), labels.join(","));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/city-1440-en.png" });
  const w = await p.evaluate(() => document.querySelector("#cy-page-slot .cy-stage").getBoundingClientRect().width); assert.ok(w <= 641, "capped width " + w);
  const v = await axe(p, "#cy-page-slot"); assert.deepEqual(v, [], v.join("\n"));
  assert.deepEqual(errs, []); await c.close();
});

test("390 character profile: «شخصيتي» → أنثى → سيدة الأعمال, saved and synced, one character in the city", async () => {
  const c = await S.browser.newContext({ ...MOBILE, colorScheme: "dark", timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "city_d", "مختار الشخصية"); await p.waitForTimeout(1200);
  await openMe(p);
  await p.click("#cy-page-slot .cy-me"); await p.waitForSelector(".cy-pick.on");
  assert.equal(await p.evaluate(() => document.querySelectorAll(".cy-char").length), 3, "ذكر: 3 characters");
  await p.click('.cy-seg [data-g="f"]');
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".cy-char")].map((b) => b.dataset.c)), ["casual-f", "suit-f"], "أنثى: 2 characters");
  await p.click('.cy-char[data-c="suit-f"]');
  if (SHOTS) { await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + "/city-390-picker.png" }); }
  const v = await axe(p, ".cy-pick"); assert.deepEqual(v, [], v.join("\n"));
  await p.click(".cy-pick-ok"); await p.waitForFunction(() => !document.querySelector(".cy-pick"));
  assert.equal(await p.evaluate(() => localStorage.getItem("mp.city.char")), "suit-f");
  assert.equal(await p.evaluate(() => document.querySelectorAll("#cy-page-slot .cy-actor").length), 1, "only the member's own character");
  await p.waitForTimeout(800);
  const srv = await p.evaluate(() => Remote.api("GET", "/api/prefs?ns=city"));
  assert.equal(srv.prefs.city.char, "suit-f", "synced: " + JSON.stringify(srv));
  assert.ok((await p.getAttribute("#cy-page-slot .cy-me img", "src")).includes("suit-f"));
  assert.deepEqual(errs, []); await c.close();
});

test("390 MJT hall: 6 neon boards, stations open the city's own rooms with real data, «خروج» returns to the city", async () => {
  const c = await S.browser.newContext({ ...MOBILE, colorScheme: "dark", timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "city_e", "زائر الخزنة"); await p.waitForTimeout(1200);
  const hall = async () => { await p.evaluate(() => { location.hash = "#/city/mjt"; }); await p.waitForSelector("#cy-page-slot .cy-stage.cy-ready", { timeout: 45000 }); await p.waitForTimeout(500); };
  await hall();
  const labels = await p.evaluate(() => [...document.querySelectorAll("#cy-page-slot .cy-sign-t")].map(t => t.textContent));
  assert.deepEqual(labels.sort(), ["الإحصاءات", "التعدين", "الرصيد", "السجلات", "المحفظة", "خروج"].sort());
  assert.ok(await p.evaluate(() => getComputedStyle(document.querySelector("#cy-page-slot .cy-fr-run")).animationName === "cy-fr-run"), "frame light runs");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/mjt-hall-390.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  const tapHall = (x, y) => p.evaluate(([x, y]) => { const b = document.querySelector("#cy-page-slot .cy-hit").getBoundingClientRect(); return [b.left + (x / 768) * b.width, b.top + (y / 1376) * b.height]; }, [x, y]).then(([cx, cy]) => p.mouse.click(cx, cy));
  await tapHall(100, 600); // the wallet desk
  await p.waitForFunction(() => location.hash === "#/city/mjt/send", null, { timeout: 20000 });
  await p.waitForSelector(".cy-room #cy-sf", { timeout: 20000 });
  if (SHOTS) await p.screenshot({ path: SHOTS + "/room-send-390.png" });
  let rv = await axe(p); assert.deepEqual(rv, [], rv.join("\n"));
  // the room strip moves between rooms without leaving the city; the balance is the member's real one
  const real = await p.evaluate(() => Remote.api("GET", "/api/mjt/me"));
  await p.click('.cy-rm-nav a[href="#/city/mjt/balance"]'); await p.waitForSelector(".cy-rm-hero [data-count]", { timeout: 20000 }); await p.waitForTimeout(1200);
  assert.equal(await p.textContent(".cy-rm-hero [data-count]"), String(real.balance.mjt), "real balance");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/room-balance-390.png" });
  for (const r of ["history", "earn", "stats"]) {
    await p.click(`.cy-rm-nav a[href="#/city/mjt/${r}"]`); await p.waitForFunction(() => !document.querySelector(".cy-rm-skel"), null, { timeout: 20000 }); await p.waitForTimeout(400);
    assert.equal(await p.$(".cy-rm-err"), null, r + " loaded");
    if (SHOTS) await p.screenshot({ path: SHOTS + `/room-${r}-390.png`, fullPage: true });
    rv = await axe(p); assert.deepEqual(rv, [], r + ": " + rv.join("\n"));
  }
  assert.equal(await p.evaluate(() => [...document.querySelectorAll("#view a[href]")].filter((a) => !/^#\/(city|menu)/.test(a.getAttribute("href"))).length), 0, "rooms link only inside the city");
  await p.click(".cy-room .page-head .back"); await p.waitForFunction(() => location.hash === "#/city/mjt", null, { timeout: 10000 });
  await hall();
  await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(300);
  await tapHall(490, 1300); // the exit gate (bottom of the hall, scrolled into view)
  await p.waitForFunction(() => location.hash === "#/city", null, { timeout: 20000 });
  await p.evaluate(() => window.MPI18n.setLang("en")); await hall(); await p.waitForTimeout(800);
  const en = await p.evaluate(() => [...document.querySelectorAll("#cy-page-slot .cy-sign-t")].map(t => t.textContent));
  assert.ok(en.includes("Wallet") && en.includes("Exit"), en.join(","));
  assert.deepEqual(errs, []); await c.close();
});
