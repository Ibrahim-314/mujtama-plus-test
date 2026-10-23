/* v2.71 — «لقطات» smooth snapping: one clip per snap viewport, keyboard (ArrowDown/ArrowUp/PageDown/j/k) moves exactly
 * one clip, Space toggles play but never when focus is on a button, wheel moves one clip per gesture on desktop,
 * snap CSS is mandatory + stop always + overscroll contained, no horizontal overflow at 390/1440, desktop backdrop,
 * reduced motion = instant jumps, forced colors usable, axe 0 serious/critical. CLIPS_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CLIPS_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const seed = (p) => p.evaluate(() => {
  for (let i = 0; i < 12; i++) DB.posts.push({ id: "clipsnap_" + i, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة تجريبية رقم " + (i + 1), createdAt: new Date(Date.now() - i * 60000).toISOString(), media: `hsl(${i * 30} 45% 32%)`, video: { short: true, duration: 12, variants: { "360p": "/media/none-" + i + ".mp4", poster: "" } } });
});
/* the app may re-render the current route once when a store sync lands (core behaviour): wait until the clips feed is
 * the same element for a full second before driving it, so the test measures the snap code and not that re-render */
const stable = async (p) => {
  for (let k = 0; k < 8; k++) {
    if (await p.evaluate(() => !DB.posts.some(x => x.id.startsWith("clipsnap_")))) { await seed(p); await p.evaluate(() => { const h = location.hash; location.hash = "#/explore"; setTimeout(() => { location.hash = h; }, 50); }); await p.waitForTimeout(400); } // a store sync replaced the seeded clips
    if (process.env.SNAP_DEBUG) console.log("stable", k, await p.evaluate(() => ({ secs: document.querySelectorAll(".shorts .short").length, posts: DB.posts.length, hash: location.hash })));
    await p.waitForSelector(".shorts .short");
    await p.evaluate(() => { document.querySelector(".shorts").__snapMark = 1; });
    await p.waitForTimeout(1000);
    if (await p.evaluate(() => document.querySelector(".shorts")?.__snapMark === 1 && !!document.querySelector(".shorts .short"))) return;
  }
  throw new Error("clips feed never settled");
};
const open = async (p, hash = "#/shorts") => { await p.evaluate((h) => { location.hash = h; }, hash); await stable(p); };
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};
/* index of the clip whose top sits on the feed's top edge (−1 = between snaps) */
const current = (p) => p.evaluate(() => { const f = document.querySelector(".shorts"), ft = f.getBoundingClientRect().top; return [...f.querySelectorAll(".short")].findIndex(s => Math.abs(s.getBoundingClientRect().top - ft) < 2); });
/* waits (≤6 s, the box is shared and slow) until clip n is snapped on screen, then asserts it */
const at = async (p, n, msg) => {
  await p.waitForFunction((n) => { const f = document.querySelector(".shorts"); if (!f) return false; const ft = f.getBoundingClientRect().top; return [...f.querySelectorAll(".short")].findIndex(s => Math.abs(s.getBoundingClientRect().top - ft) < 2) === n; }, n, { timeout: 6000 }).catch(() => { });
  await p.waitForTimeout(150); assert.equal(await current(p), n, msg);
};
const geometry = (p) => p.evaluate(() => {
  const f = document.querySelector(".shorts"), cs = getComputedStyle(f), fb = f.getBoundingClientRect();
  const secs = [...f.querySelectorAll(".short")], sc = getComputedStyle(secs[0]);
  return { feedH: fb.height, clientH: f.clientHeight, heights: secs.map(s => s.getBoundingClientRect().height), snapType: cs.scrollSnapType, overscroll: cs.overscrollBehaviorY, align: sc.scrollSnapAlign, stop: sc.scrollSnapStop, contain: sc.contain,
    overflowX: document.documentElement.scrollWidth > innerWidth || f.scrollWidth > f.clientWidth + 1, feedW: fb.width, vw: innerWidth };
});
const oneViewport = (g) => {
  assert.match(g.snapType, /y mandatory/); assert.equal(g.overscroll, "contain"); assert.match(g.align, /start/); assert.equal(g.stop, "always");
  assert.ok(/strict|layout/.test(g.contain), "sections are contained: " + g.contain);
  for (const h of g.heights) assert.ok(Math.abs(h - g.clientH) <= 1, `each clip = one snap viewport (${h} vs ${g.clientH})`);
  assert.ok(!g.overflowX, "no horizontal overflow");
};
const spyVideo = (p) => p.evaluate(() => { // the 404 test source can't play headless: play()/pause()/paused are stubbed on the current clip's <video>
  const f = document.querySelector(".shorts"), i = Math.round(f.scrollTop / f.clientHeight), sec = f.querySelectorAll(".short")[i];
  let v = sec.querySelector(".short-player video"); if (!v) { v = document.createElement("video"); sec.querySelector(".short-player").append(v); }
  let paused = true; Object.defineProperty(v, "paused", { get: () => paused, configurable: true }); v.__plays = 0; v.__pauses = 0;
  v.play = () => { v.__plays++; paused = false; return Promise.resolve(); }; v.pause = () => { v.__pauses++; paused = true; }; window.__v = v;
});
const calls = (p) => p.evaluate(() => ({ plays: window.__v.__plays, pauses: window.__v.__pauses }));

test("390 light: one clip per viewport, keyboard moves one clip, Space toggles play, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "snap_a", "صانع اللقطات"); await p.waitForTimeout(1200); await seed(p); await open(p); // seeded after the first store sync settles
  oneViewport(await geometry(p));
  assert.equal(await current(p), 0);
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press("ArrowDown"); await at(p, 1, "ArrowDown → next clip");
  await p.keyboard.press("j"); await at(p, 2, "j → next clip");
  await p.keyboard.press("PageDown"); await at(p, 3, "PageDown → next clip");
  await p.keyboard.press("k"); await at(p, 2, "k → previous clip");
  await p.keyboard.press("ArrowUp"); await at(p, 1, "ArrowUp → previous clip");
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown"); await at(p, 3, "two quick presses = two clips");
  await p.evaluate("rerender()"); await p.waitForTimeout(300); // a store-sync soft re-render keeps the clip being watched
  assert.equal(await current(p), 3, "soft re-render keeps the position");
  await p.waitForTimeout(500); // past the 250 ms settle (autoplay mount)
  await spyVideo(p);
  await p.keyboard.press(" "); await p.waitForTimeout(100);
  assert.deepEqual(await calls(p), { plays: 1, pauses: 0 }, "Space plays a paused clip");
  await p.keyboard.press(" "); await p.waitForTimeout(100);
  assert.deepEqual(await calls(p), { plays: 1, pauses: 1 }, "Space pauses a playing clip");
  assert.equal(await current(p), 3, "Space does not scroll the feed");
  // Space with focus on a button keeps its native meaning (no play toggle); keyup lands after blur so nothing is clicked
  await p.evaluate(() => document.querySelector(".short-actions [data-share]")?.focus() || document.querySelector(".shorts-back").focus());
  await p.keyboard.down(" "); await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.up(" ");
  assert.equal((await calls(p)).plays, 1, "Space on a button is not stolen (the paused clip did not start)"); // pause() may still be called by the feed's own visibility handling
  oneViewport(await geometry(p));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/snap-390-light.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark: centered 9:16 column, blurred backdrop, one clip per wheel gesture, axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "snap_b", "مشاهد"); await p.waitForTimeout(1200); await seed(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await open(p, "#/clips");
  const g = await geometry(p); oneViewport(g);
  assert.ok(Math.abs(g.feedW - g.feedH * 9 / 16) <= 2, `9:16 column (${g.feedW}x${g.feedH})`);
  // centred in the content column (between the side nav and the side panel), which is where the app lays out every page
  const fb = await p.evaluate(() => { const b = document.querySelector(".shorts").getBoundingClientRect(), v = document.getElementById("view").getBoundingClientRect(); return { l: b.left - v.left, r: v.right - b.right }; });
  assert.ok(Math.abs(fb.l - fb.r) <= 2, "column centered: " + JSON.stringify(fb));
  const bd = await p.evaluate(() => { const el = document.querySelector(".clips-backdrop"); return el && { shown: getComputedStyle(el).display !== "none", hidden: el.getAttribute("aria-hidden"), color: el.style.getPropertyValue("--clips-bd-c") }; });
  assert.ok(bd && bd.shown && bd.hidden === "true" && bd.color, "blurred backdrop behind the column: " + JSON.stringify(bd));
  // one mouse-wheel gesture (a burst of events) = exactly one clip
  await p.mouse.move(720, 450);
  // one flick = a burst of wheel events; sent through CDP without awaiting each so test-runner latency can't split the burst
  const cdp = await c.newCDPSession(p);
  await Promise.all(Array.from({ length: 6 }, () => cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 100 })));
  await at(p, 1, "one gesture → one clip");
  await p.mouse.wheel(0, 120); await at(p, 2, "next gesture → next clip");
  await p.mouse.wheel(0, -120); await at(p, 1, "wheel up → previous clip");
  await p.keyboard.press("ArrowDown"); await at(p, 2);
  oneViewport(await geometry(p));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/snap-1440-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await p.evaluate(() => { location.hash = "#/help"; }); await p.waitForTimeout(500);
  const y0 = await p.evaluate(() => scrollY); await p.keyboard.press("j"); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.querySelector(".shorts")), null); assert.equal(await p.evaluate(() => scrollY), y0, "keys inert after leaving the clips page");
  assert.deepEqual(errs, []);
  await c.close();
});

test("390 LTR + reduced motion + forced colors: instant jumps, still one clip per viewport, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, locale: "en-US", reducedMotion: "reduce" }); const p = await c.newPage();
  await onboard(p, S.base, "snap_c", "Clip Viewer");
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.waitForTimeout(1500); await seed(p); await open(p, "#/clips");
  oneViewport(await geometry(p));
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press("ArrowDown"); await p.waitForTimeout(60);
  assert.equal(await current(p), 1, "reduced motion: the jump is instant");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/snap-390-ltr.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await p.emulateMedia({ forcedColors: "active" }); await p.waitForTimeout(150);
  const fc = await p.evaluate(() => { const b = document.querySelector(".short-actions > *"), r = b.getBoundingClientRect(); return { w: r.width, h: r.height, vis: getComputedStyle(b).visibility }; });
  assert.ok(fc.w >= 44 && fc.h >= 44 && fc.vis === "visible", "controls usable in forced colors: " + JSON.stringify(fc));
  assert.ok(await current(p) >= 0, "still aligned on a clip in forced colors");
  oneViewport(await geometry(p));
  await c.close();
});
