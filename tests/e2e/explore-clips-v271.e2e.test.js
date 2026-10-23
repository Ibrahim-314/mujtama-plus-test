/* v2.71 — «لقطات» row on #/explore (discovery chunk): heading + «عرض الكل» → #/clips, ≤6 9:16 tiles from
 * GET /api/clips/feed?tab=foryou (mocked here so the test owns the data), lazy images with width/height, duration and
 * view badges, tile → #/clips?start=<id>, section removed when the feed is empty or fails, explore shortcuts kept,
 * 44px targets, English strings in LTR, axe 0 serious/critical at 390 light / 1440 dark / 390 LTR.
 * EXPLORE_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.EXPLORE_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });

const POSTER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs><rect width="180" height="320" fill="url(#g)"/></svg>');
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: "xc" + i, type: "video", status: "published", author: "u_x", user: { id: "u_x", handle: "xclipper", name: "صانع لقطات" }, createdAt: new Date().toISOString(), text: "لقطة من الاستكشاف رقم " + (i + 1), views: i === 1 ? 0 : 1200 + i, video: { short: true, duration: 15 + i * 7, variants: { poster: i === 2 ? "" : POSTER } }, counts: { likes: 0, comments: 0, shares: 0, watchers: 0, completion: null } }));
const mock = (p, list, status = 200) => p.route(/\/api\/clips\/feed/, (r) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(status === 200 ? { tab: "foryou", items: list, next: null } : { error: "x" }) }));
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};
const openExplore = async (p) => { await p.evaluate(() => { location.hash = "#/explore"; }); await p.waitForSelector(".explore-shortcuts"); };
const checkRow = async (p) => {
  await p.waitForSelector("#x-clips .x-clip[href]");
  const r = await p.evaluate(() => {
    const sec = document.getElementById("x-clips"), tiles = [...sec.querySelectorAll("a.x-clip")];
    return { n: tiles.length, all: sec.querySelector('.x-h a[href="#/clips"]')?.getBoundingClientRect().height, busy: sec.getAttribute("aria-busy"),
      hrefs: tiles.map(t => t.getAttribute("href")), ratio: tiles.map(t => { const b = t.getBoundingClientRect(); return b.height / b.width; }), minH: Math.min(...tiles.map(t => t.getBoundingClientRect().height)),
      imgs: [...sec.querySelectorAll("img")].map(i => [i.loading, i.getAttribute("width"), i.getAttribute("height"), i.alt]), dur: sec.querySelectorAll(".x-clip-dur").length, views: sec.querySelectorAll(".x-clip-v").length,
      ph: sec.querySelectorAll(".x-clip-ph").length, overflowX: document.documentElement.scrollWidth > innerWidth, shortcuts: !!document.querySelector('.explore-shortcuts a[href="#/shorts"]') };
  });
  assert.equal(r.n, 6, "≤6 tiles"); assert.equal(r.busy, null); assert.ok(r.shortcuts, "explore-shortcuts kept");
  assert.deepEqual(r.hrefs, Array.from({ length: 6 }, (_, i) => "#/clips?start=xc" + i));
  r.ratio.forEach(x => assert.ok(Math.abs(x - 16 / 9) < 0.05, "9:16 tile, got " + x)); assert.ok(r.minH >= 44);
  assert.equal(r.imgs.length, 5); r.imgs.forEach(i => assert.deepEqual(i, ["lazy", "180", "320", ""]));
  assert.equal(r.dur, 6); assert.equal(r.views, 5, "view badge only when views > 0"); assert.equal(r.ph, 1, "poster-less tile gets a placeholder"); assert.ok(!r.overflowX);
};

test("390 light: clips row with 6 tiles from 8, tile → #/clips?start=, keyboard focus ring, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "xclips_a", "مستكشف اللقطات"); await mock(p, items(8));
  await openExplore(p); await checkRow(p);
  assert.match(await p.textContent("#x-clips-h"), /فيديوتك/); assert.match(await p.textContent('#x-clips .x-h a'), /عرض الكل/);
  await p.focus("#x-clips .x-h a"); await p.keyboard.press("Tab"); assert.equal(await p.evaluate(() => document.activeElement.getAttribute("href")), "#/clips?start=xc0", "keyboard reaches the first tile"); const ring = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle); assert.notEqual(ring, "none", "focus ring");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/explore-clips-390-light.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await p.click("#x-clips a.x-clip >> nth=3"); await p.waitForFunction(() => location.hash === "#/clips?start=xc3");
  await p.waitForSelector(".shorts"); // router strips the query → clips view opens
  // ?start end-to-end: the clips view lands on the tapped clip as the current (on-screen) one
  await p.waitForSelector('.short[data-short="xc3"]');
  await p.waitForFunction(() => { const s = [...document.querySelectorAll(".short[data-short]")], vh = innerHeight;
    const vis = (e) => { const b = e.getBoundingClientRect(); return Math.max(0, Math.min(b.bottom, vh) - Math.max(b.top, 0)); };
    const best = s.reduce((a, e) => (vis(e) > vis(a) ? e : a), s[0]); return best && best.dataset.short === "xc3" && vis(best) > vh * 0.6; }, null, { timeout: 8000 });
  assert.equal(await p.evaluate(() => location.hash), "#/clips?start=xc3", "start stays in the hash");
  assert.deepEqual(errs, []);
  await c.close();
});
test("1440 dark: 6-column grid, axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  await onboard(p, S.base, "xclips_b", "مشاهد"); await mock(p, items(6));
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await openExplore(p); await checkRow(p);
  const rows = await p.$$eval("#x-clips a.x-clip", (t) => new Set(t.map(x => Math.round(x.getBoundingClientRect().top))).size); assert.equal(rows, 1, "one row of 6");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/explore-clips-1440-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
test("390 LTR English: “Clips” / “See all”, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, locale: "en-US" }); const p = await c.newPage();
  await onboard(p, S.base, "xclips_c", "Clip Fan"); await mock(p, items(6));
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr"); await p.waitForTimeout(1200);
  await openExplore(p); await checkRow(p); await p.waitForTimeout(500);
  assert.match(await p.textContent("#x-clips-h"), /Vidtik/); assert.match(await p.textContent("#x-clips .x-h a"), /See all/);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/explore-clips-390-ltr.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
test("empty feed and failed feed: the section is removed, explore still renders", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await onboard(p, S.base, "xclips_d", "فارغ");
  await mock(p, []); await openExplore(p); await p.waitForFunction(() => !document.getElementById("x-clips"));
  assert.ok(await p.$(".explore-shortcuts"));
  await c.close();
  const c2 = await S.browser.newContext({ ...MOBILE }); const p2 = await c2.newPage();
  await onboard(p2, S.base, "xclips_e", "خطأ");
  await mock(p2, [], 500); await openExplore(p2); await p2.waitForFunction(() => !document.getElementById("x-clips"));
  assert.ok(await p2.$(".x-search"));
  await c2.close();
});
