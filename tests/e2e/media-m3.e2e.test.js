/* v2.60 M3 client: resumable chunked upload from the community editor (MEDIA_CHUNK_MB=1 forces small chunks):
 *  · a ~12 MB video goes up in chunks, the editor shows a real progress bar (role=progressbar, percent) and a cancel button
 *  · one chunk request fails once (route intercept) → retried automatically, the upload finishes
 *  · the post publishes and the video becomes ready (status published, real dimensions)
 *  · axe: 0 serious/critical on the editor during the upload — 390 light, 1440 dark, LTR */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.MEDIA_CHUNK_MB = "1";
const { startStack, tourDone, MOBILE, DESKTOP } = require("./harness");
let S, cid, O; const errors = [];
const SHOTS = process.env.MEDIA_SHOTS_DIR || null;
const FX = fs.mkdtempSync(path.join(os.tmpdir(), "m3fx-")), BIG = path.join(FX, "big.webm");
const reg = async (handle, name) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name, handle, password: "secret1234" }) }); const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); await tourDone(S.base, ck); return ck; };
const api = (ck) => async (m, p, b) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + p, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const page = async (ck, opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); await c.addCookies(ck.split("; ").map((kv) => { const [name, ...v] = kv.split("="); return { name, value: v.join("="), url: S.base }; })); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(S.base + "/?nosw"); await p.waitForFunction(() => window.DB && typeof save === "function", null, { timeout: 20000 }); await p.evaluate(() => { DB.onboarded = true; save(); location.hash = "#/home"; route(); }); await p.waitForSelector(".bottomnav a[data-r=home]", { state: "visible", timeout: 20000 }); return p; };
const go = async (p, h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(400); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out: " + fn.toString().slice(0, 140)); await new Promise((r) => setTimeout(r, 150)); } };
async function axe(p, sel) {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async (s) => (await axe.run(s ? document.querySelectorAll(s) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")), sel);
}
const setDir = async (p, ltr) => { await p.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await p.evaluate((l) => window.MPI18n.setLang(l), ltr ? "en" : "ar"); await until(() => p.evaluate((d) => document.documentElement.dir === d, ltr ? "ltr" : "rtl")); };
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + ".png") }); };
const CHUNK_RE = /\/api\/media\/uploads\/[^/]+\/chunk\?index=(\d+)/;

test.before(async () => {
  // incompressible noise → a real ~12 MB WebM (12+ chunks of 1 MB)
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "nullsrc=s=480x270:rate=24,geq=random(1)*255:128:128", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "5", "-c:v", "libvpx", "-b:v", "40M", "-crf", "4", "-c:a", "libopus", "-shortest", BIG]);
  S = await startStack({ queuePollMs: 200 });
  O = await reg("m3_owner", "صاحب الفيديو");
  cid = (await api(O)("POST", "/api/communities", { name: "مجتمع الفيديو", desc: "رفع مجزّأ", topic: "dev" })).community.id;
});
test.after(async () => { await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

/** opens the community editor, slows the chunk PUTs (so the bar can be seen), optionally fails one chunk once */
async function startUpload(o, { failIndex = -1, delay = 0 } = {}) {
  const seen = {};
  await o.route(CHUNK_RE, async (r) => {
    const i = +CHUNK_RE.exec(r.request().url())[1]; seen[i] = (seen[i] || 0) + 1;
    if (delay) await new Promise((x) => setTimeout(x, delay));
    if (i === failIndex && seen[i] === 1) return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "عطل مؤقت" }) });
    return r.continue();
  });
  await go(o, "#/c/" + cid); await o.click("#c-compose"); await o.waitForSelector("#composer3[data-mode=community]");
  const [ch] = await Promise.all([o.waitForEvent("filechooser"), o.click('[data-act="video"]')]);
  await ch.setFiles(BIG);
  return seen;
}

test("community editor: ~12 MB video in 1 MB chunks — progress bar, a failed chunk is retried, post publishes and the video becomes ready", async () => {
  assert.ok(fs.statSync(BIG).size > 10 * 1024 * 1024, "fixture is large: " + fs.statSync(BIG).size);
  const o = await page(O);
  const singlePosts = []; o.on("request", (r) => { if (r.method() === "POST" && /\/api\/media(\?|$)/.test(r.url())) singlePosts.push(r.url()); });
  const seen = await startUpload(o, { failIndex: 2, delay: 120 });
  await o.waitForSelector("#c3-vprog[role=progressbar]", { timeout: 15000 });
  const pct = await until(async () => { const v = +(await o.getAttribute("#c3-vprog", "aria-valuenow")); return v > 0 && v < 100 ? v : null; });
  assert.ok(pct > 0 && pct < 100, "real percent while uploading: " + pct);
  assert.equal(await o.getAttribute("#c3-vprog", "aria-valuemax"), "100");
  assert.ok(await o.isVisible("#c3-vcancel"), "cancel button shown");
  assert.match(await o.textContent("#c3-vpct"), /%/);
  assert.deepEqual(await axe(o, "#composer3"), [], "axe on the editor while uploading (390 light)");
  await shot(o, "m3-progress-390-light");
  await o.fill("#c3-text", "فيديو كبير مرفوع على أجزاء");
  await o.waitForSelector("#c3-type-top video", { timeout: 60000 });
  assert.equal(seen[2], 2, "chunk 2 failed once and was retried");
  assert.ok(Object.keys(seen).length >= 12, "12+ chunks sent: " + Object.keys(seen).length);
  assert.deepEqual(singlePosts, [], "a big file does not use the single POST");
  assert.equal(await o.$("#c3-vprog"), null, "progress gone when done");
  await o.click("#c3-pub"); await o.waitForSelector("#composer3", { state: "detached", timeout: 15000 });
  const row = await until(() => S.app.ctx.db.get("SELECT id, type, community FROM posts WHERE text=$1", ["فيديو كبير مرفوع على أجزاء"]));
  assert.equal(row.type, "video"); assert.equal(row.community, cid);
  const pub = await until(async () => { const r = await S.app.ctx.db.get("SELECT status, data FROM posts WHERE id=$1", [row.id]); return r.status === "published" ? r : null; }, 120000);
  const d = typeof pub.data === "string" ? JSON.parse(pub.data) : pub.data; assert.equal(d.video.width, 480); assert.equal(d.video.height, 270); assert.ok(d.video.duration > 0);
  await o.context().close();
});

test("cancel stops the chunked upload; axe on the progress UI at 1440 dark and LTR", async () => {
  for (const [tag, opts, ltr] of [["1440-dark", { ...DESKTOP, colorScheme: "dark" }], ["390-ltr", MOBILE, true]]) {
    const o = await page(O, opts); await setDir(o, ltr);
    const seen = await startUpload(o, { delay: 400 });
    await o.waitForSelector("#c3-vcancel", { timeout: 15000 });
    await until(async () => +(await o.getAttribute("#c3-vprog", "aria-valuenow")) > 0);
    assert.deepEqual(await axe(o, "#composer3"), [], "axe while uploading " + tag);
    if (ltr) assert.match(await o.textContent("#c3-vcancel"), /Cancel upload/);
    await shot(o, "m3-progress-" + tag);
    await o.click("#c3-vcancel");
    await until(() => o.evaluate(() => !document.querySelector("#c3-vprog")));
    const n = Object.values(seen).reduce((a, b) => a + b, 0); await o.waitForTimeout(1200);
    assert.ok(Object.values(seen).reduce((a, b) => a + b, 0) <= n + 1, "no more chunks after cancel");
    assert.equal(await o.$("#c3-type-top video"), null, "no video attached");
    await o.context().close();
  }
});
