/* global MP, Clips */
/* v2.71 — «لقطات» scrubber + gestures (clips-ui.js, block v271-scrub): single tap pauses/plays with a centred icon (after
 * the double-tap window), double-tap still likes and does not toggle, long-press ≥350 ms plays at 2× with a «2x» pill and
 * release restores 1×, the progress bar is a keyboard slider (role=slider, aria-valuenow seconds, aria-valuetext
 * "0:05 من 0:30") and a pointer drag seeks + shows the storyboard preview. MPPlayer's own .mp-seek is not shown in clips.
 * The seeded clips have no real media, so the mounted <video> gets a deterministic stub (paused/play/pause/currentTime/
 * duration); playbackRate stays the real property. axe 0 serious/critical at 390 light, 1440 dark, LTR.
 * CLIPS_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CLIPS_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const seed = (p) => p.evaluate(() => {
  for (let i = 0; i < 4; i++) DB.posts.push({ id: "clipscrub_" + i, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة الشريط رقم " + (i + 1), createdAt: new Date(Date.now() - i * 60000).toISOString(), media: "#223", video: { short: true, duration: 30, variants: { "360p": "/media/none-scrub-" + i + ".mp4", poster: "", storyboard: { sprite: "/assets/brand/logo-maskable.png", interval: 2, cols: 4, rows: 4, w: 128, h: 72 } } } });
});
const open = async (p, hash) => {
  await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForSelector(".shorts .short .cl-scrub-bar", { state: "attached", timeout: 45000 }).catch(async (e) => { console.log("DBG", await p.evaluate(() => location.hash + " | " + document.body.className + " | " + (document.getElementById("view")?.innerHTML || "").slice(0, 400))); throw e; });
  await stub(p);
};
/* a like may re-render the clip: wait for its player again and re-stub it */
const stub = async (p) => {
  await p.evaluate(() => { const f = document.querySelector(".shorts"); if (f) f.scrollTop = 0; });
  await p.waitForSelector(".shorts .short:first-child .short-player video", { state: "attached", timeout: 45000 }); await p.waitForTimeout(300);
  await p.evaluate(() => { // deterministic media stub on the clip on screen
    const sec = document.querySelector(".shorts .short"), v = sec.querySelector("video"), box = sec.querySelector(".short-player");
    let paused = false, t = 0; v.removeAttribute("src"); try { v.load(); } catch { }
    const err = box.querySelector(".mp-err"); if (err) err.hidden = true; box.classList.remove("errored");
    Object.defineProperty(v, "paused", { configurable: true, get: () => paused });
    Object.defineProperty(v, "duration", { configurable: true, get: () => 30 });
    Object.defineProperty(v, "currentTime", { configurable: true, get: () => t, set: (x) => { t = x; v.dispatchEvent(new Event("timeupdate")); } });
    v.play = () => { paused = false; v.dispatchEvent(new Event("play")); return Promise.resolve(); };
    v.pause = () => { paused = true; v.dispatchEvent(new Event("pause")); };
    v.playbackRate = 1; v.dispatchEvent(new Event("timeupdate"));
  });
};
const state = (p) => p.evaluate(() => { const sec = document.querySelector(".shorts .short"), v = sec.querySelector("video"), b = sec.querySelector(".cl-scrub-bar");
  return { paused: v?.paused, rate: v?.playbackRate, t: v?.currentTime, now: b.getAttribute("aria-valuenow"), max: b.getAttribute("aria-valuemax"), text: b.getAttribute("aria-valuetext"), pill: !sec.querySelector(".cl-scrub-pill").hidden, icon: sec.querySelector(".cl-scrub-icon").classList.contains("on") };
});
const center = (p) => p.evaluate(() => { const b = document.querySelector(".shorts .short").getBoundingClientRect(); return { x: b.left + b.width * 0.4, y: b.top + b.height * 0.4 }; });
const axe = async (p) => {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};

test("390 light: tap clean screen + pause button + auto-hide, double-tap like, long-press 2×, keyboard + drag seek, preview, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "scrub_a", "شريط اللقطات"); await p.waitForTimeout(1500); await seed(p); // the store re-syncs after onboarding: seed after it settles
  await open(p, "#/clips");
  // MPPlayer's own progress slider is replaced in clips mode (one slider for AT)
  assert.equal(await p.$$eval(".shorts .short:first-child [role=slider]", (s) => s.filter(x => getComputedStyle(x).display !== "none").length), 1);
  let s = await state(p); assert.equal(s.paused, false); assert.equal(s.max, "30"); assert.equal(s.text, "0:00 من 0:30");
  // single tap → pause (after the double-tap window) with the centred icon, tap again → play
  const pt = await center(p);
  // v2.73: single tap = clean screen on/off (the clip keeps playing); pause/play is the .cl-pp button by the progress line
  const clean = () => p.evaluate(() => document.body.classList.contains("cl-clean"));
  await p.mouse.click(pt.x, pt.y); assert.equal(await clean(), false, "single tap waits for the double-tap window");
  await p.waitForTimeout(380); assert.equal(await clean(), true, "tap hides the overlay"); assert.equal((await state(p)).paused, false, "tap does not pause");
  await p.waitForTimeout(300); assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".shorts .short .short-actions")).visibility), "hidden", "rail hidden after the fade (not focusable)");
  await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(380); assert.equal(await clean(), false, "tap shows it again");
  await p.click(".shorts .short:first-child .cl-pp"); s = await state(p); assert.equal(s.paused, true, "pause button pauses");
  assert.match(await p.getAttribute(".shorts .short:first-child .cl-pp", "aria-label"), /تشغيل/);
  await p.click(".shorts .short:first-child .cl-pp"); await p.waitForTimeout(150); assert.equal((await state(p)).paused, false, "pause button plays");
  // auto-hide (Settings › إخفاء الواجهة تلقائياً): 3 s of no touch → clean; never while paused
  await p.evaluate(() => { MP.setPref("clipsAutoHide", 3); Clips.clean.arm(); }); await p.waitForTimeout(3400);
  assert.equal(await clean(), true, "auto-hide after 3 s"); await p.keyboard.press("Shift"); assert.equal(await clean(), false, "a key press reveals");
  await p.evaluate(() => { MP.setPref("clipsAutoHide", 0); Clips.clean.arm(); });
  // double-tap → like (the core handler clicks [data-react]), no pause toggle. The seeded clips exist only in this client
  // store, so the click is counted and stopped here (a real like re-syncs the store from the server and drops them).
  // (window capture runs before the app's own capture-phase like handler, which re-renders the screen)
  await p.evaluate(() => { window.__likes = 0; addEventListener("click", (e) => { if (e.target.closest?.(".shorts [data-react]")) { window.__likes++; e.stopImmediatePropagation(); e.preventDefault(); } }, true); });
  await p.mouse.dblclick(pt.x, pt.y, { delay: 20 }); await p.waitForTimeout(450);
  s = await state(p); assert.equal(s.paused, false, "double-tap does not toggle play"); assert.equal(await p.evaluate(() => window.__likes), 1, "double-tap still likes (once)");
  // long-press → 2× + pill, release → 1×, no toggle
  await p.waitForTimeout(350);
  await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.waitForTimeout(480);
  s = await state(p); assert.equal(s.rate, 2, "2× while held"); assert.ok(s.pill, "«2x» pill");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/scrub-390-light-2x.png" });
  await p.mouse.up(); await p.waitForTimeout(400);
  s = await state(p); assert.equal(s.rate, 1, "release → 1×"); assert.ok(!s.pill); assert.equal(s.paused, false, "hold is not a tap");
  // a press that moves (swipe) never speeds up
  await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x, pt.y - 60, { steps: 4 }); await p.waitForTimeout(450);
  assert.equal((await state(p)).rate, 1, "swipe does not trigger 2×"); await p.mouse.up(); await p.waitForTimeout(350);
  // keyboard slider
  await p.focus(".shorts .short:first-child .cl-scrub-bar");
  await p.keyboard.press("ArrowRight"); s = await state(p); assert.equal(s.t, 5); assert.equal(s.now, "5"); assert.equal(s.text, "0:05 من 0:30");
  await p.keyboard.press("PageUp"); assert.equal((await state(p)).t, 15);
  await p.keyboard.press("ArrowLeft"); assert.equal((await state(p)).t, 10);
  await p.keyboard.press("End"); s = await state(p); assert.ok(s.t > 29.9 && s.t < 30); assert.equal(s.now, "30");
  await p.keyboard.press("Home"); assert.equal((await state(p)).t, 0);
  // drag: LTR timeline (left → right), preview tip with storyboard frame while dragging, seek on release
  const bb = await p.$eval(".shorts .short:first-child .cl-scrub-bar", (b) => { const r = b.getBoundingClientRect(); return { l: r.left, w: r.width, y: r.top + r.height / 2 }; });
  await p.mouse.move(bb.l + bb.w * 0.2, bb.y); await p.mouse.down(); await p.mouse.move(bb.l + bb.w * 0.5, bb.y, { steps: 5 }); await p.waitForTimeout(250);
  const tip = await p.evaluate(() => { const sec = document.querySelector(".shorts .short"); return { tip: !sec.querySelector(".cl-scrub-tip").hidden, thumb: !sec.querySelector(".cl-scrub-thumb").hidden, time: sec.querySelector(".cl-scrub-time").textContent }; });
  assert.ok(tip.tip, "preview tip while dragging"); assert.ok(tip.thumb, "storyboard frame shown"); assert.equal(tip.time, "0:15");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/scrub-390-light-drag.png" });
  await p.mouse.up(); await p.waitForTimeout(150);
  s = await state(p); assert.ok(Math.abs(s.t - 15) < 0.6, "seeked to the middle, got " + s.t);
  assert.ok(await p.evaluate(() => document.querySelector(".shorts .short .cl-scrub-tip").hidden), "tip hidden after release");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/scrub-390-light.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark: slider + reduced motion icon, axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", reducedMotion: "reduce" }); const p = await c.newPage();
  await onboard(p, S.base, "scrub_b", "مشاهد الشريط"); await p.waitForTimeout(1500); await seed(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await open(p, "#/clips");
  await p.focus(".shorts .short:first-child .cl-scrub-bar"); await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowRight");
  const s = await state(p); assert.equal(s.t, 10); assert.equal(s.text, "0:10 من 0:30");
  assert.equal(await p.$eval(".shorts .short:first-child .cl-scrub-track", (t) => getComputedStyle(t).height), "6px", "focused bar grows to 6px");
  // v2.73: tap = clean screen; with reduced motion the overlay switches instantly (no fade)
  const pt = await center(p); await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(380);
  assert.equal(await p.evaluate(() => document.body.classList.contains("cl-clean")), true);
  assert.equal(await p.$eval(".shorts .short:first-child .short-info", (i) => getComputedStyle(i).transitionDuration.split(",")[0]), "0s", "reduced motion: no fade");
  await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(380);
  await p.click(".shorts .short:first-child .cl-pp"); assert.equal((await state(p)).paused, true, "pause button");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/scrub-1440-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});

test("LTR English: slider label/valuetext in English, timeline still left → right, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, locale: "en-US" }); const p = await c.newPage();
  await onboard(p, S.base, "scrub_c", "Scrub Viewer");
  await p.waitForFunction(() => window.MPI18n);
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.waitForTimeout(1500); await seed(p);
  await open(p, "#/clips");
  await p.focus(".shorts .short:first-child .cl-scrub-bar"); await p.keyboard.press("ArrowRight");
  const s = await state(p); assert.equal(s.text, "0:05 of 0:30");
  assert.equal(await p.getAttribute(".shorts .short:first-child .cl-scrub-bar", "aria-label"), "Progress");
  assert.equal(await p.$eval(".shorts .short:first-child .cl-scrub", (e) => getComputedStyle(e).direction), "ltr");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/scrub-390-ltr.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
