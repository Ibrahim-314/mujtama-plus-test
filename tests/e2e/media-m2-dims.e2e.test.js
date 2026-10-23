/* media M2 (client) — a single image reserves its real aspect ratio before it loads:
 *  · the editors keep the size POST /api/media returns (media.width/height) and publish imageDims[] next to images[]
 *    (community editor and the general editor's public post), the server stores it index-aligned
 *  · the card renders the 1600×900 photo at 16:9 on first paint while the image request is still held back (no 4:3 → 16:9 jump)
 *  · a post without imageDims (older posts) keeps the 4:3 placeholder until the image loads
 *  · axe: 0 serious/critical on the cards — 390 light, 1440 dark, LTR */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
const { startStack, tourDone, MOBILE, DESKTOP } = require("./harness");
let S, cid, O, U; const errors = [];
const SHOTS = process.env.MEDIA_SHOTS_DIR || null;
const FX = fs.mkdtempSync(path.join(os.tmpdir(), "m2dims-"));
const reg = async (handle, name) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name, handle, password: "secret1234" }) }); const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); await tourDone(S.base, ck); return ck; };
const api = (ck) => async (m, p, b) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + p, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const upload = async (ck, file) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/media", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: fs.readFileSync(file) }); return (await r.json()).media; };
const page = async (ck, opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); await c.addCookies(ck.split("; ").map((kv) => { const [name, ...v] = kv.split("="); return { name, value: v.join("="), url: S.base }; })); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(S.base + "/?nosw"); await p.waitForFunction(() => window.DB && typeof save === "function", null, { timeout: 20000 }); await p.evaluate(() => { DB.onboarded = true; save(); location.hash = "#/home"; route(); }); await p.waitForSelector(".bottomnav a[data-r=home]", { state: "visible", timeout: 20000 }); return p; };
const go = async (p, h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(400); };
const goC = async (p) => { for (let i = 0; i < 3; i++) { await go(p, "#/c/" + cid); if (await p.waitForSelector("#c-feed", { timeout: 10000 }).catch(() => null)) return; await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(500); } throw new Error("community page did not open"); };
const openCE = async (p) => { for (let i = 0; i < 3; i++) { await goC(p); const b = p.locator("#c-compose"); if (!(await b.waitFor({ state: "visible", timeout: 20000 }).then(() => true, () => false))) continue; await b.click().catch(() => null); if (await p.waitForSelector("#composer3[data-mode=community]", { timeout: 10000 }).catch(() => null)) return; } throw new Error("the community editor did not open"); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out: " + fn.toString().slice(0, 140)); await new Promise((r) => setTimeout(r, 150)); } };
const setDir = async (p, ltr) => { await p.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await p.evaluate((l) => window.MPI18n.setLang(l), ltr ? "en" : "ar"); await until(() => p.evaluate((d) => document.documentElement.dir === d, ltr ? "ltr" : "rtl")); };
async function axe(p, sel) {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async (s) => (await axe.run(s ? document.querySelectorAll(s) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")), sel);
}
/** hold every image file request (GET /media/…) so the card is measured before the photo arrives; release() lets them through */
const holdImages = async (p) => {
  const held = []; let open = false;
  await p.route((u) => new URL(u).pathname.startsWith("/media/"), (r) => { if (open) return r.continue(); held.push(r); });
  return { release: async () => { open = true; await p.unroute((u) => new URL(u).pathname.startsWith("/media/")); for (const r of held.splice(0)) await r.continue().catch(() => null); }, count: () => held.length };
};
/** the single gallery image of a post, measured after two painted frames */
const probe = (p, pid) => p.evaluate(async (id) => {
  const img = document.querySelector(`.post-open[data-open="#/post/${id}"] .gallery.g1 img[data-gal]`); if (!img) return null;
  img.scrollIntoView({ block: "center" });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const b = img.getBoundingClientRect();
  return { complete: img.complete && img.naturalWidth > 0, ar: getComputedStyle(img).aspectRatio, w: b.width, h: b.height, sized: img.classList.contains("sized"), wAttr: img.getAttribute("width"), hAttr: img.getAttribute("height") };
}, pid);

const P = {};
test.before(async () => {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1600x900", "-frames:v", "1", path.join(FX, "wide1600.jpg")]);
  S = await startStack({ storageDriver: "db", queuePollMs: 200 });
  O = await reg("m2d_owner", "صاحبة الصور"); U = await reg("m2d_member", "عضو المجتمع");
  const o = api(O);
  cid = (await o("POST", "/api/communities", { name: "مجتمع الأبعاد", desc: "صور بأبعادها", topic: "dev" })).community.id;
  await api(U)("PUT", `/api/communities/${cid}/membership`);
  const me = (await api(U)("GET", "/api/me")).user; await o("PUT", "/api/follows/" + me.id); await api(U)("PUT", "/api/follows/" + (await o("GET", "/api/me")).user.id);
  const old = await upload(O, path.join(FX, "wide1600.jpg"));
  P.old = (await o("POST", "/api/posts", { type: "post", markdown: "منشور قديم بلا أبعاد", images: [old.url], visibility: "public" })).post;
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("server keeps imageDims aligned with images and rejects junk", async () => {
  const o = api(O), m = await upload(O, path.join(FX, "wide1600.jpg"));
  assert.deepEqual([m.width, m.height], [1600, 900], "POST /api/media returns the real size");
  const r = (await o("POST", "/api/posts", { type: "post", markdown: "اختبار الأبعاد", images: ["javascript:x", m.url, m.url], imageDims: [[1, 1], [1600, 900], { w: "abc", h: 3 }], visibility: "public" })).post;
  assert.deepEqual(r.images, [m.url, m.url]); assert.deepEqual(r.imageDims, [[1600, 900], null], "dropped image takes its size with it; junk → null");
  const n = (await o("POST", "/api/posts", { type: "post", markdown: "بلا أبعاد", images: [m.url], visibility: "public" })).post;
  assert.equal(n.imageDims, undefined, "no imageDims when none is known (old shape unchanged)");
});

test("editors publish imageDims: community post and public post", async () => {
  const o = await page(O);
  await openCE(o);
  const [c1] = await Promise.all([o.waitForEvent("filechooser"), o.click('#composer3 [data-act="img"]')]);
  await c1.setFiles(path.join(FX, "wide1600.jpg"));
  await o.waitForSelector("#composer3 .thumb[data-i]", { timeout: 20000 });
  await o.fill("#c3-text", "صورة عريضة في المجتمع");
  const [req1] = await Promise.all([o.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/posts"), o.click("#c3-pub")]);
  const b1 = req1.postDataJSON(); assert.deepEqual(b1.imageDims, [[1600, 900]], "community editor sends the stored size"); assert.equal(b1.community, cid);
  await o.waitForSelector("#composer3", { state: "detached", timeout: 15000 });
  P.comm = await until(async () => (await S.app.ctx.db.get("SELECT id, data FROM posts WHERE community=$1 AND text LIKE $2", [cid, "%عريضة في المجتمع%"])));
  assert.deepEqual(P.comm.data.imageDims, [[1600, 900]]);

  await go(o, "#/home"); await o.click("#fab"); await o.waitForSelector("#composer3[data-mode=general]");
  const [c2] = await Promise.all([o.waitForEvent("filechooser"), o.click('#composer3 [data-tool="img"]')]);
  await c2.setFiles(path.join(FX, "wide1600.jpg"));
  await o.waitForSelector("#composer3 .thumb[data-i]", { timeout: 20000 });
  await o.fill("#c3-text", "صورة عريضة للجميع");
  const [req2] = await Promise.all([o.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/posts"), o.click("#c3-pub")]);
  assert.deepEqual(req2.postDataJSON().imageDims, [[1600, 900]], "general editor sends the stored size");
  await o.waitForSelector("#composer3", { state: "detached", timeout: 15000 });
  P.pub = await until(async () => (await S.app.ctx.db.get("SELECT id, data, visibility FROM posts WHERE community IS NULL AND text LIKE $1", ["%عريضة للجميع%"])));
  assert.equal(P.pub.visibility, "public"); assert.deepEqual(P.pub.data.imageDims, [[1600, 900]]);
  await o.context().close();
});

test("cards reserve 16:9 before the photo loads (community + public feed); old posts keep 4:3 until load; axe clean", async () => {
  assert.ok(P.comm && P.pub, "posts from the editor test");
  for (const [tag, opts, ltr] of [["390-light", MOBILE], ["1440-dark", { ...DESKTOP, colorScheme: "dark" }], ["390-ltr", MOBILE, true]]) {
    const u = await page(U, opts);
    await setDir(u, ltr);
    const hold = await holdImages(u);
    await goC(u); await u.waitForSelector(`.post-open[data-open="#/post/${P.comm.id}"] .gallery.g1 img`, { timeout: 20000 });
    const c = await probe(u, P.comm.id);
    assert.equal(c.complete, false, tag + ": the photo is still held back"); assert.equal(c.sized, true);
    assert.match(c.ar, /^1\.7778|16 \/ 9|1600 \/ 900/, `${tag}: computed aspect-ratio is 16:9 before load (${c.ar})`);
    assert.ok(Math.abs(c.w / c.h - 16 / 9) < 0.03, `${tag}: community card box is 16:9 before load (${c.w}×${c.h})`);
    assert.deepEqual([c.wAttr, c.hAttr], ["1600", "900"]);
    if (SHOTS) await u.screenshot({ path: path.join(SHOTS, `m2-dims-community-${tag}.png`) });
    await go(u, "#/home"); await u.waitForSelector(`.post-open[data-open="#/post/${P.pub.id}"] .gallery.g1 img`, { timeout: 20000 });
    const f = await probe(u, P.pub.id);
    assert.equal(f.complete, false, tag + ": feed photo still held back");
    assert.ok(Math.abs(f.w / f.h - 16 / 9) < 0.03, `${tag}: public card box is 16:9 before load (${f.w}×${f.h}, ${f.ar})`);
    const old = await probe(u, P.old.id);
    assert.equal(old.sized, false, tag + ": an old post has no stored size"); assert.ok(Math.abs(old.w / old.h - 4 / 3) < 0.03, `${tag}: old post keeps the 4:3 placeholder (${old.w}×${old.h})`);
    if (SHOTS) await u.screenshot({ path: path.join(SHOTS, `m2-dims-feed-${tag}.png`) });
    assert.ok(hold.count() > 0, "image requests were held");
    await hold.release();
    const after = await until(async () => { const r = await probe(u, P.pub.id); return r && r.complete ? r : null; });
    assert.ok(Math.abs(after.w - f.w) < 1.5 && Math.abs(after.h - f.h) < 1.5, `${tag}: no jump when the photo arrives (${f.w}×${f.h} → ${after.w}×${after.h})`);
    await until(async () => { const r = await probe(u, P.old.id); return r && r.complete && r.sized && Math.abs(r.w / r.h - 16 / 9) < 0.03; });
    assert.deepEqual(await axe(u, ".post-card"), [], `${tag}: axe on the cards`);
    await u.context().close();
  }
});
