/* global moreMenu */
/* v2.140.2 — fixes from the real-account production tour.
 * • MPConfirm: in-app confirm sheet (native confirm() is suppressed by some embedded browsers) — OK resolves true,
 *   «تراجع» / Escape / backdrop resolve false; the post menu's «حذف» uses it and deletes on OK.
 * • Clips: a clip with no video file shows a clear note (no dead play button); the end of the feed says so with next
 *   steps; the shared player's error box is styled inside a clip and «إعادة المحاولة» is on top and tappable.
 * • Appearance page language segment switches the UI to English (it only wrote a setting before).
 * 390 light and 1440, no page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
const seed = (p, nosrc) => p.evaluate((nosrc) => {
  for (let i = 0; i < 4; i++) DB.posts.push({ id: "fx_" + i, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة " + (i + 1), createdAt: new Date(Date.now() - i * 60000).toISOString(), media: "#223",
    video: (nosrc && i === 0) ? { short: true, duration: 30 } : { short: true, duration: 12, variants: { "360p": "/media/none-" + i + ".mp4", poster: "" } } });
}, nosrc);

test("390: MPConfirm + post delete through the in-app sheet", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  let native = 0; p.on("dialog", (d) => { native++; d.dismiss(); });
  await onboard(p, S.base, "fx_cf", "مؤكد");
  // resolves
  const r1 = p.evaluate(() => window.MPConfirm("حذف؟", { ok: "حذف" })); await p.waitForSelector("#mp-cf-ok");
  assert.equal(await p.getAttribute(".mp-cf", "role"), "alertdialog"); await p.click("#mp-cf-ok"); assert.equal(await r1, true);
  const r2 = p.evaluate(() => window.MPConfirm("حذف؟")); await p.waitForSelector("#mp-cf-x"); await p.click("#mp-cf-x"); assert.equal(await r2, false);
  const r3 = p.evaluate(() => window.MPConfirm("حذف؟")); await p.waitForSelector("#mp-cf-ok"); await p.keyboard.press("Escape"); assert.equal(await r3, false);
  assert.ok(await p.$eval("#sheet", (s) => s.classList.contains("hidden")), "sheet closed");
  // post menu delete
  await p.evaluate(() => { DB.posts.push({ id: "fx_post", author: DB.me, type: "text", status: "published", visibility: "public", text: "منشور للحذف", createdAt: new Date().toISOString() }); moreMenu("fx_post"); });
  await p.click("#sheet [data-a=del]"); await p.waitForSelector("#mp-cf-ok"); await p.click("#mp-cf-ok"); await p.waitForTimeout(300);
  assert.notEqual(await p.evaluate(() => S.post("fx_post")?.status || "gone"), "published", "post deleted after OK");
  assert.equal(native, 0, "no native dialog"); assert.deepEqual(errs, []); await c.close();
});

for (const [name, ctxo] of [["390", MOBILE], ["1440", DESKTOP]]) test(name + ": clips — no-video note, end of feed, styled retry box", async () => {
  const c = await S.browser.newContext({ ...ctxo }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "fx_cl" + name, "مشاهد"); await seed(p, true);
  await p.evaluate(() => { location.hash = "#/clips"; }); await p.waitForSelector(".shorts .short"); await p.waitForTimeout(900);
  const first = await p.$eval(".shorts .short[data-short=fx_0]", (s) => ({ note: s.querySelector(".short-nosrc")?.textContent || "", play: !!s.querySelector(".short-ph svg use[href='#i-play']") }));
  assert.match(first.note, /لا يتوفر ملف فيديو/); assert.ok(!first.play, "no dead play icon");
  await p.waitForSelector(".shorts-end", { timeout: 5000 }); assert.match(await p.textContent(".shorts-end"), /شاهدت كل اللقطات/);
  // error box on a mounted clip: force the error state and check it sits on top and its button takes the click
  await p.evaluate(() => document.querySelector(".shorts .short[data-short=fx_1]").scrollIntoView({ block: "start" })); await p.waitForTimeout(800);
  const box = await p.evaluate(() => { const s = document.querySelector(".shorts .short[data-short=fx_1]"), pl = s.querySelector(".short-player"), e = pl.querySelector(".mp-err"); if (!e) return null;
    e.hidden = false; pl.classList.add("errored"); const b = e.querySelector("[data-a=reload]").getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { pos: getComputedStyle(e).position, onTop: !!top?.closest("[data-a=reload]") }; });
  assert.ok(box, "player mounted with an error box"); assert.equal(box.pos, "absolute"); assert.ok(box.onTop, "retry button is the top element");
  assert.deepEqual(errs.filter((m) => !/media|video|play\(\)/i.test(m)), []); await c.close();
});

for (const [nm, vp] of [["1440", DESKTOP], ["390", MOBILE]]) test(nm + ": appearance language segment switches to English", async () => {
  const c = await S.browser.newContext({ ...vp }); const p = await c.newPage();
  await onboard(p, S.base, "fx_lg" + nm, "لغة");
  await p.evaluate(() => { location.hash = "#/settings?s=display"; });
  await p.waitForSelector("[data-mplang=en]", { timeout: 10000 }); // i18n-ui swaps the hub's segment for its shared switcher
  await p.click("[data-mplang=en]");
  await p.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 8000 });
  assert.equal(await p.evaluate(() => DB.settings.lang), "en");
  await p.evaluate(() => window.MPI18n.setLang("ar")); await c.close();
});
