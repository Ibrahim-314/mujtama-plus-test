/* v2.75 — «فيديوتك» editor + creator profile (v275-create / v275-creator).
 * 390 light RTL author: the «＋» on the feed opens the full-screen editor → «اختر من الجهاز» → a real 9:16 MP4 uploads while
 * the caption is written → «نشر» → the author's فيديوتك profile (processing tile, then the clip). axe clean, no page errors.
 * 1440 dark EN viewer: #/clips/@author shows the header (counts, Follow, full profile link) and the 3-column grid; a tile
 * opens the viewer on that clip; the overlay name links back to the profile. Gestures are covered by the clips suites. */
const test = require("node:test"),
  assert = require("node:assert");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
let S, mp4;
const authorHandle = "vt_author";
test.before(async () => {
  S = await startStack({ fakeVideoMs: 1 });
  mp4 = path.join(os.tmpdir(), "vidtik-e2e.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=360x640:d=2:r=24", "-f", "lavfi", "-i", "sine=f=440:d=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", mp4]);
});
test.after(async () => {
  await S.close();
  try { fs.unlinkSync(mp4); } catch { }
});
const axe = async (p, sel) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async sel =>
    (await window.axe.run(document.querySelector(sel), { resultTypes: ["violations"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(v => v.id + ": " + v.nodes.map(n => n.target.join(" ")).join(", ")), sel);
};

test("390 light RTL: editor → upload → publish → own profile", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, authorHandle, "صانعة فيديوتك");
  await p.evaluate(() => { location.hash = "#/clips"; });
  await p.waitForSelector(".vt-new", { timeout: 30000 });
  await p.click(".vt-new");
  await p.waitForSelector(".vt-ed [data-vt=gallery]");
  assert.ok(await p.evaluate(() => document.body.classList.contains("vt-ed-mode")));
  assert.deepEqual(await axe(p, ".vt-ed"), []);
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click(".vt-ed [data-vt=gallery]")]);
  await chooser.setFiles(mp4);
  // the edit step replaces the picker (the picker must really be gone, not just flagged hidden)
  await p.waitForSelector(".vt-edit:not([hidden]) .vt-frame");
  assert.equal(await p.isVisible(".vt-pick"), false, "picker hidden once a file is chosen");
  // test Chromium has no H.264 decoder: either the preview plays, or the «preview unavailable» note shows — never a blank frame
  await p.waitForFunction(() => { const f = document.querySelector(".vt-frame"), v = f?.querySelector("video");
    return (v && v.readyState >= 2) || (f.classList.contains("nopv") && getComputedStyle(f.querySelector(".vt-nopv")).display !== "none"); }, null, { timeout: 15000 });
  await p.fill("#vt-cap", "أول فيديو #تجربة");
  await p.waitForFunction(() => document.querySelector(".vt-tags")?.textContent.includes("تجربة"));
  await p.waitForSelector(".vt-pub:not([disabled])", { timeout: 30000 });
  // cover frame: moving the slider draws the frame and marks the cover as chosen
  const canPreview = !(await p.evaluate(() => document.querySelector(".vt-frame").classList.contains("nopv")));
  assert.equal(await p.isVisible(".vt-cover"), canPreview, "the cover picker shows only when frames can be drawn");
  if (canPreview) await p.$eval("#vt-cr", (r) => { r.value = "500"; r.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.waitForTimeout(300);
  assert.deepEqual(await axe(p, ".vt-ed"), []);
  await p.click(".vt-pub");
  await p.waitForFunction((h) => location.hash === "#/clips/@" + h, authorHandle, { timeout: 20000 });
  await p.waitForSelector(".vt-pf-head");
  assert.equal(await p.evaluate(() => document.body.classList.contains("vt-ed-mode")), false, "editor mode cleared");
  assert.ok(await p.$(".vt-pf-new"), "owner sees «فيديو جديد»");
  // the stored post is a Vidtik clip
  const row = await S.app.ctx.db.get("SELECT data, text FROM posts WHERE author=(SELECT id FROM users WHERE handle=$1) AND type='video' ORDER BY created_at DESC LIMIT 1", [authorHandle]);
  const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  assert.equal(d.video.source, "clips");
  assert.equal(row.text, "أول فيديو #تجربة");
  if (canPreview) assert.ok(d.cover, "the chosen cover frame was uploaded"); else assert.equal(d.cover, undefined, "no cover without a preview (server poster)");
  // processing → the clip lands on the grid after a reload of the page
  await p.waitForFunction(async (h) => { const r = await fetch("/api/clips/creator/" + h, { headers: { "X-Requested-With": "mujtama" } }); const j = await r.json(); return (j.items || []).length === 1; }, authorHandle, { timeout: 90000, polling: 1000 });
  await p.evaluate(() => { location.hash = "#/home"; });
  await p.evaluate((h) => { location.hash = "#/clips/@" + h; }, authorHandle);
  await p.waitForSelector(".vt-grid .vt-tile", { timeout: 15000 });
  assert.deepEqual(await axe(p, ".vt-pf"), []);
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark EN viewer: creator profile, follow, tile opens the viewer", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "vt_viewer", "Viewer");
  await p.evaluate(() => window.MPI18n.setLang("en"));
  await p.waitForTimeout(300);
  await p.evaluate((h) => { location.hash = "#/clips/@" + h; }, authorHandle);
  await p.waitForSelector(".vt-grid .vt-tile", { timeout: 30000 });
  const head = await p.textContent(".vt-pf-head");
  assert.match(head, /@vt_author/);
  assert.match(head, /Videos?/);
  assert.equal(await p.getAttribute(".vt-pf-acts a.btn.ghost", "href"), "#/u/" + authorHandle);
  assert.equal(await p.$(".vt-pf-new"), null, "a visitor gets Follow, not New video");
  const cols = await p.$eval(".vt-grid", (g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);
  assert.equal(cols, 3);
  assert.deepEqual(await axe(p, ".vt-pf"), []);
  await p.click(".vt-pf-follow");
  await p.waitForFunction(() => document.querySelector(".vt-pf-follow")?.getAttribute("aria-pressed") === "true", null, { timeout: 10000 });
  await p.click(".vt-grid .vt-tile");
  await p.waitForFunction(() => location.hash.startsWith("#/clips?start="), null, { timeout: 10000 });
  await p.waitForSelector(".short .cl-ov-name", { timeout: 30000 });
  const href = await p.getAttribute(".short .cl-ov-name", "href");
  assert.equal(href, "#/clips/@" + authorHandle);
  assert.deepEqual(errs, []);
  await c.close();
});
