/* global MP, Clips */
/* v2.73 — «لقطات» viewer comfort (video/clips/viewer.js, v273-viewer): auto-next when a clip wraps (off by default),
 * break reminder after N minutes of watching (calm alertdialog, keep watching / leave), axe 0 serious/critical. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CLIPS_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const seed = (p) => p.evaluate(() => {
  for (let i = 0; i < 4; i++) DB.posts.push({ id: "clipview_" + i, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة الشريط رقم " + (i + 1), createdAt: new Date(Date.now() - i * 60000).toISOString(), media: "#223", video: { short: true, duration: 30, variants: { "360p": "/media/none-scrub-" + i + ".mp4", poster: "", storyboard: { sprite: "/assets/brand/logo-maskable.png", interval: 2, cols: 4, rows: 4, w: 128, h: 72 } } } });
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

const axe = async (p) => {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};

test("390 light: auto-next off by default, on moves to the next clip; break reminder", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "view_a", "مشاهد مريح"); await p.waitForTimeout(1500); await seed(p);
  await open(p, "#/clips");
  const top = () => p.evaluate(() => document.querySelector(".shorts").scrollTop);
  const wrap = () => p.evaluate(() => { const v = document.querySelector(".shorts .short video"); v.currentTime = 29.5; v.currentTime = 0.2; });
  await wrap(); await p.waitForTimeout(700); assert.equal(await top(), 0, "off by default: the clip loops");
  await p.evaluate(() => MP.setPref("clipsAutoNext", true)); await wrap(); await p.waitForTimeout(900);
  assert.ok((await top()) > 100, "auto-next scrolls to the next clip");
  await p.evaluate(() => { MP.setPref("clipsAutoNext", false); document.querySelector(".shorts").scrollTop = 0; }); await p.waitForTimeout(500); await stub(p);
  // break reminder: 20 min chosen, 20 min already watched → next played second shows the card and pauses
  await p.evaluate(() => { MP.setPref("clipsBreak", 20); Clips.viewer._watch(20 * 60); const v = document.querySelector(".shorts .short video"); v.currentTime = 1; v.currentTime = 2; });
  await p.waitForSelector(".cl-brk[role=alertdialog]", { timeout: 3000 });
  assert.equal(await p.evaluate(() => document.querySelector(".shorts .short video").paused), true, "reminder pauses");
  assert.equal(await p.evaluate(() => document.activeElement?.dataset.brk), "go", "focus on keep watching");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/break-390-light.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await p.click("[data-brk=go]"); assert.equal(await p.$(".cl-brk"), null);
  assert.equal(await p.evaluate(() => document.querySelector(".shorts .short video").paused), false, "keep watching resumes");
  assert.deepEqual(errs, []); await c.close();
});

test("1440 dark LTR: break card readable, Escape resumes, settings rows present", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  await onboard(p, S.base, "view_b", "مشاهد ليلي"); await p.waitForTimeout(1500); await seed(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; MP.setPref("lang", "en"); });
  await open(p, "#/clips");
  await p.evaluate(() => { MP.setPref("clipsBreak", 40); Clips.viewer._watch(40 * 60); const v = document.querySelector(".shorts .short video"); v.currentTime = 1; v.currentTime = 2; });
  await p.waitForSelector(".cl-brk", { timeout: 3000 });
  if (SHOTS) await p.screenshot({ path: SHOTS + "/break-1440-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await p.keyboard.press("Escape"); assert.equal(await p.$(".cl-brk"), null, "Escape closes");
  await c.close();
});
