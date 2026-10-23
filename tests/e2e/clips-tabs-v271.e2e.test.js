/* v2.71 — «لقطات» tabs «لك» | «المتابَعون»: tablist semantics + arrow keys, tab kept in the hash across reload, following
 * feed requested with ?tab=following (mocked empty → friendly empty state linking to #/explore), ≤3 players, guest stays on
 * «لك» with the auth prompt, #/clips?start=<id> opens on that clip (in first page → scrolled to; otherwise prepended),
 * axe 0 serious/critical at 390 light, 1440 dark, LTR. CLIPS_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CLIPS_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const seed = (p) => p.evaluate(() => {
  for (let i = 0; i < 12; i++) if (!S.post("cltab_" + i)) DB.posts.push({ id: "cltab_" + i, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة " + (i + 1), createdAt: new Date(Date.now() - i * 60000).toISOString(), media: "#223", video: { short: true, duration: 12, variants: { "360p": "/media/none-" + i + ".mp4", poster: "" } } });
});
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};
/* following feed: the server may not have it yet → mock an empty page and record the request */
const mockFollowing = async (p) => { const urls = []; await p.route(/\/api\/clips\/feed\?tab=following/, (r) => { urls.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], next: null }) }); }); return urls; };
const tabState = (p) => p.$$eval(".cl-tabs [role=tab]", (b) => b.map(x => [x.dataset.cltab, x.getAttribute("aria-selected"), x.tabIndex, Math.round(x.getBoundingClientRect().height)]));
const noCollide = (p) => p.evaluate(() => { const a = document.querySelector(".cl-tabs").getBoundingClientRect(), b = document.querySelector(".shorts-back").getBoundingClientRect(); return !(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) && document.documentElement.scrollWidth <= innerWidth; });
const open = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForSelector(".cl-tabs"); await p.waitForTimeout(500); };
/* the seeded clips live only in the client store and a background store re-sync can drop them under load: re-seed + retry */
const openClips = async (p, hash, sel = ".shorts .short") => {
  for (let k = 0; k < 3; k++) {
    await seed(p); await p.evaluate((h) => { location.hash = h; }, hash);
    try { await p.waitForSelector(sel, { timeout: 8000 }); await p.waitForSelector(".cl-tabs"); await p.waitForTimeout(400); return; } catch { await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(600); }
  }
  throw new Error("clips did not render for " + hash);
};

test("390 light: tabs, following request + empty state, hash survives reload, arrow keys, ≤3 players, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "cltab_a", "صانع التبويبات"); await seed(p);
  const urls = await mockFollowing(p);
  await openClips(p, "#/clips");
  assert.equal(await p.getAttribute(".cl-tabs", "role"), "tablist");
  let t = await tabState(p);
  assert.deepEqual(t.map(x => x.slice(0, 3)), [["foryou", "true", 0], ["following", "false", -1]]);
  assert.ok(t.every(x => x[3] >= 44), "44px targets");
  assert.ok(await noCollide(p), "tabs clear of the back button, no overflow");
  for (let i = 1; i <= 4; i++) { await p.evaluate((i) => document.querySelectorAll(".shorts .short")[i]?.scrollIntoView({ block: "start" }), i); await p.waitForTimeout(350); }
  assert.ok(await p.$$eval("video", (v) => v.length) <= 3);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tabs-390-light.png" });
  assert.deepEqual(await axe(p), []);
  await p.click('[data-cltab="following"]');
  await p.waitForSelector(".cl-tabs-empty");
  assert.match(p.url(), /#\/clips\?tab=following$/);
  assert.ok(urls.length >= 1 && /tab=following/.test(urls[0]), "requested ?tab=following");
  assert.match(await p.textContent(".cl-tabs-empty"), /تابع صنّاعاً لتظهر لقطاتهم هنا/);
  assert.equal(await p.getAttribute('.cl-tabs-empty a', "href"), "#/explore");
  assert.equal(await p.$$eval(".shorts .short", (s) => s.length), 0, "feed cleared");
  assert.equal(await p.$$eval("video", (v) => v.length), 0);
  t = await tabState(p); assert.equal(t[1][1], "true");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tabs-390-light-following-empty.png" });
  assert.deepEqual(await axe(p), []);
  await p.reload(); await p.waitForSelector(".cl-tabs-empty", { timeout: 15000 });
  t = await tabState(p); assert.equal(t[1][1], "true", "tab kept after reload");
  await seed(p); // the seeded clips live only in the client store: put them back after the reload
  await p.focus('[data-cltab="following"]'); await p.keyboard.press("ArrowLeft");
  await p.waitForSelector(".shorts .short"); await p.waitForTimeout(300);
  t = await tabState(p); assert.equal(t[0][1], "true", "arrow key back to «لك»");
  assert.doesNotMatch(p.url(), /tab=following/);
  assert.deepEqual(errs, []);
  await c.close();
});

test("390: guest tapping «المتابَعون» gets the auth prompt and stays on «لك»; ?start=<id> opens on that clip", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await onboard(p, S.base, "cltab_b", "زائر"); await seed(p);
  await openClips(p, "#/clips?start=cltab_3"); await p.waitForTimeout(300);
  const top = () => p.evaluate(() => { const f = document.querySelector(".shorts").getBoundingClientRect().top; return [...document.querySelectorAll(".shorts .short")].find(s => Math.abs(s.getBoundingClientRect().top - f) < 3)?.dataset.short; });
  assert.equal(await top(), "cltab_3", "scrolled to the start clip");
  await openClips(p, "#/clips?start=cltab_11", '.shorts .short[data-short="cltab_11"]');
  assert.equal(await p.$eval(".shorts .short", (s) => s.dataset.short), "cltab_11", "prepended when not in the first page");
  await open(p, "#/clips");
  await p.evaluate(() => { window.__auth = 0; window.showAuth = () => { window.__auth++; }; window.MPSession.set("out"); });
  await p.click('[data-cltab="following"]'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.__auth), 1, "auth prompt shown");
  assert.doesNotMatch(p.url(), /tab=following/);
  assert.equal((await tabState(p))[0][1], "true");
  await c.close();
});

test("1440 dark + LTR English: tabs translated, centred over the clip, axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  await onboard(p, S.base, "cltab_c", "مشاهد"); await seed(p); await mockFollowing(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await openClips(p, "#/clips");
  const mid = await p.evaluate(() => { const a = document.querySelector(".cl-tabs").getBoundingClientRect(), f = document.querySelector(".shorts").getBoundingClientRect(); return Math.abs((a.left + a.right) / 2 - (f.left + f.right) / 2); });
  assert.ok(mid < 4, "centred over the video, off by " + mid);
  assert.ok(await noCollide(p));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tabs-1440-dark.png" });
  assert.deepEqual(await axe(p), []);
  await c.close();
  const c2 = await S.browser.newContext({ ...MOBILE, locale: "en-US" }); const q = await c2.newPage();
  await onboard(q, S.base, "cltab_d", "Tab Viewer");
  await q.evaluate(() => window.MPI18n.setLang("en")); await q.waitForFunction(() => document.documentElement.dir === "ltr");
  await q.waitForTimeout(1500); await seed(q); await mockFollowing(q);
  await openClips(q, "#/clips");
  assert.deepEqual(await q.$$eval(".cl-tabs [role=tab]", (b) => b.map(x => x.textContent.trim())), ["For you", "Following"]);
  assert.equal(await q.getAttribute(".cl-tabs", "aria-label"), "Vidtik sections");
  assert.ok(await noCollide(q));
  if (SHOTS) await q.screenshot({ path: SHOTS + "/tabs-390-ltr.png" });
  assert.deepEqual(await axe(q), []);
  await q.click('[data-cltab="following"]'); await q.waitForSelector(".cl-tabs-empty"); await q.waitForTimeout(300);
  assert.match(await q.textContent(".cl-tabs-empty"), /Follow creators to see their clips here/);
  await c2.close();
});
