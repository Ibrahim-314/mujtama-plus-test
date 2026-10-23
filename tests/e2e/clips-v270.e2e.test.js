/* v2.70 — «لقطات» (Clips): the vertical video page is renamed, pages its items, keeps ≤3 players mounted while scrolling,

 * v2.75: the product is now «فيديوتك» / Vidtik (labels only; #/shorts and #/clips still answer).
 * answers the #/clips alias, shows "Clips" in English, and has no serious/critical axe findings (390 light, 1440 dark, LTR).
 * Seeds 12 video posts into the client store (the /api/clips/feed endpoint may be absent → local fallback is exercised).
 * CLIPS_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CLIPS_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const seed = (p) => p.evaluate(() => {
  for (let i = 0; i < 12; i++) DB.posts.push({ id: "clipv270_" + i, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة تجريبية رقم " + (i + 1), createdAt: new Date(Date.now() - i * 60000).toISOString(), media: "#223", video: { short: true, duration: 12, variants: { "360p": "/media/none-" + i + ".mp4", poster: "" } } });
});
/* scoped to #view (the clips page); the app chrome has its own a11y suites */
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const r = await p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
  return r;
};
/* v2.70 layout (v2.72: nav hidden on phones): the clip's name/caption and action buttons never sit under the nav; the page has no light strip at the top */
const layoutOk = async (p) => {
  const r = await p.evaluate(() => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const sec = [...document.querySelectorAll(".shorts .short")].find(s => { const b = s.getBoundingClientRect(); return b.top > -2 && b.top < 2; }) || document.querySelector(".shorts .short");
    const nav = box(document.querySelector(".bottomnav")), info = box(sec.querySelector(".short-info")), act = box(sec.querySelector(".short-actions")), feed = box(document.querySelector(".shorts"));
    const nv = getComputedStyle(document.querySelector(".bottomnav"));
    return { narrow: innerWidth < 760, infoHit: hit(info, nav), actHit: hit(act, nav), feedHit: hit(feed, nav), navVisible: nv.display !== "none" && nv.visibility !== "hidden" && nav.b > nav.t,
      inFeed: info.b <= feed.b && act.b <= feed.b && info.t >= feed.t && act.t >= feed.t, bodyBg: getComputedStyle(document.body).backgroundColor, padTop: getComputedStyle(document.body).paddingTop, overflowX: document.documentElement.scrollWidth > innerWidth };
  });
  // v2.72 immersive clips: the bottom nav pill is hidden on phones (<760px); from 760px it is the side rail and stays
  if (r.narrow) assert.ok(!r.navVisible, "bottom nav hidden in the clips viewer (v2.72)"); else assert.ok(r.navVisible, "side nav stays visible on wide screens");
  assert.ok(!r.infoHit, ".short-info overlaps .bottomnav"); assert.ok(!r.actHit, ".short-actions overlaps .bottomnav"); assert.ok(!r.feedHit, "clip area runs under the nav");
  assert.ok(r.inFeed, "info/actions inside the clip"); { const [R, G, B] = r.bodyBg.match(/\d+/g).map(Number); assert.ok(R + G + B < 60, "dark page background, got " + r.bodyBg); } assert.equal(r.padTop, "0px"); assert.ok(!r.overflowX, "no horizontal overflow");
};
const open = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForSelector(".shorts .short"); await p.waitForTimeout(400); };
test("390 light: «لقطات» page, ≤3 players while scrolling through 10 clips, menu + explore labels, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "clips_a", "صانع اللقطات"); await seed(p);
  await open(p, "#/shorts");
  assert.equal(await p.getAttribute(".shorts", "aria-label"), "فيديوتك");
  const n0 = await p.$$eval(".shorts .short", (s) => s.length); assert.ok(n0 >= 3 && n0 <= 12, "paged render: " + n0);
  let maxVid = 0;
  for (let i = 1; i <= 10; i++) {
    await p.evaluate((i) => { const s = document.querySelectorAll(".shorts .short")[i]; s?.scrollIntoView({ block: "start" }); }, i);
    await p.waitForTimeout(450);
    maxVid = Math.max(maxVid, await p.$$eval("video", (v) => v.length));
  }
  const total = await p.$$eval(".shorts .short", (s) => s.length);
  assert.equal(total, 12, "next pages appended near the end");
  assert.ok(maxVid <= 3 && maxVid >= 1, "mounted players ≤3, got " + maxVid);
  await layoutOk(p);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/clips-390-light.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; }); await p.waitForTimeout(200); await layoutOk(p);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/clips-390-dark.png" });
  await p.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await p.evaluate(() => { location.hash = "#/explore"; }); await p.waitForSelector('.explore-shortcuts a[href="#/shorts"]');
  assert.match(await p.textContent('.explore-shortcuts a[href="#/shorts"]'), /فيديوتك/);
  await p.evaluate(() => { location.hash = "#/menu"; }); await p.waitForTimeout(600);
  assert.ok(await p.evaluate(() => document.getElementById("view").textContent.includes("فيديوتك")), "menu entry renamed (v2.75: فيديوتك)");
  assert.deepEqual(errs, []);
  await c.close();
});
test("1440 dark: #/clips alias works, axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  await onboard(p, S.base, "clips_b", "مشاهد"); await seed(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await open(p, "#/clips");
  assert.ok(await p.evaluate(() => document.body.classList.contains("shorts-mode")));
  assert.equal(await p.getAttribute(".shorts", "aria-label"), "فيديوتك");
  await layoutOk(p);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/clips-1440-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await p.evaluate(() => { location.hash = "#/help"; }); await p.waitForTimeout(600); // leaving clips must drop shorts-mode on any route
  assert.equal(await p.evaluate(() => document.body.classList.contains("shorts-mode")), false, "shorts-mode leaked to #/help");
  await c.close();
});
test("LTR English: shows “Clips”, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, locale: "en-US" }); const p = await c.newPage();
  await onboard(p, S.base, "clips_c", "Clip Viewer");
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.waitForTimeout(1500); await seed(p); // setLang re-syncs the store; seed after it settles
  await p.evaluate(() => { location.hash = "#/explore"; }); await p.waitForSelector('.explore-shortcuts a[href="#/shorts"]'); await p.waitForTimeout(500);
  assert.match(await p.textContent('.explore-shortcuts a[href="#/shorts"]'), /Vidtik/);
  await open(p, "#/clips"); await p.waitForTimeout(300);
  assert.equal(await p.getAttribute(".shorts", "aria-label"), "Vidtik");
  if (process.env.CLIPS_DEBUG) console.log("DBG", await p.evaluate(() => document.querySelector(".shorts").outerHTML.slice(0, 600)));
  await layoutOk(p);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/clips-390-ltr.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
