/* v2.60 M1 media hotfix in a real browser (STORAGE_DRIVER=db like production, real JPEG + WebM made by ffmpeg):
 *  · a single image (images:[1], the v2.50 editor shape) shows full-width at its real proportions in the community and in the
 *    public feed — not inside the author's avatar; legacy `media` and multi-image galleries keep working
 *  · the image lightbox: tap to open, next/prev by keyboard (RTL aware) and by swipe, zoom, Escape closes and focus returns
 *  · the community editor posts a video (video button + the image button's picker accepts videos), honest size limit, clear errors
 *  · the player: vertical video at its stored aspect, fallback to a playable source, visible error box instead of a black box
 *  · processing failure → «تعذّر التجهيز» with retry for the author
 *  · axe: 0 serious/critical on the cards, the lightbox and the editor — 390 light, 1440 dark, LTR */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.MEDIA_MAX_ATTEMPTS = "1"; // a broken video gives up on its first attempt in this suite (production: 4)
const { startStack, tourDone, MOBILE, DESKTOP } = require("./harness");
let S, cid, O, U; const errors = [];
const SHOTS = process.env.MEDIA_SHOTS_DIR || null;
const FX = fs.mkdtempSync(path.join(os.tmpdir(), "m1fx-"));
const ff = (...a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
const fx = {};
const reg = async (handle, name) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name, handle, password: "secret1234" }) }); const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); await tourDone(S.base, ck); return ck; };
const api = (ck) => async (m, p, b) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + p, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const upload = async (ck, file) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/media", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: fs.readFileSync(file) }); return (await r.json()).media; };
const page = async (ck, opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); await c.addCookies(ck.split("; ").map((kv) => { const [name, ...v] = kv.split("="); return { name, value: v.join("="), url: S.base }; })); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(S.base + "/?nosw"); await p.waitForFunction(() => window.DB && typeof save === "function", null, { timeout: 20000 }); await p.evaluate(() => { DB.onboarded = true; save(); location.hash = "#/home"; route(); }); await p.waitForSelector(".bottomnav a[data-r=home]", { state: "visible", timeout: 20000 }); return p; };
const go = async (p, h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(400); };
/** open the community page; under heavy load a hash change can race the previous route, so retry until its feed is there */
const goC = async (p) => { for (let i = 0; i < 3; i++) { await go(p, "#/c/" + cid); if (await p.waitForSelector("#c-feed", { timeout: 10000 }).catch(() => null)) return; await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(500); } throw new Error("community page did not open"); };
/** open the community editor: the composer button is painted with the posts tab; under load the route can re-render between
 *  finding and clicking it, so wait for it visible, click, and try again (fresh route) until the editor is open */
const openCE = async (p) => { for (let i = 0; i < 3; i++) { await goC(p); const b = p.locator("#c-compose"); if (!(await b.waitFor({ state: "visible", timeout: 20000 }).then(() => true, () => false))) continue; await b.click().catch(() => null); if (await p.waitForSelector("#composer3[data-mode=community]", { timeout: 10000 }).catch(() => null)) return; } if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "debug-no-compose.png"), fullPage: true }); throw new Error("the community editor did not open"); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out: " + fn.toString().slice(0, 140)); await new Promise((r) => setTimeout(r, 150)); } };
async function axe(p, sel) {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async (s) => (await axe.run(s ? document.querySelectorAll(s) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")), sel);
}
/** the single gallery image of a post card: real size, outside the avatar */
const probeImg = (p, pid) => p.evaluate(async (id) => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  await frame(); await frame(); // measure what is painted: .post-card is content-visibility:auto and can report its pre-load 4:3 box until the next frame
  const po = document.querySelector(`.post-open[data-open="#/post/${id}"]`); if (!po) return null; const card = po.closest(".card");
  const imgs = [...card.querySelectorAll("img")].filter((i) => (i.getAttribute("src") || "").startsWith("/media/"));
  /* stable = the first image's box is identical over two consecutive frames (no layout still settling after .sized) */
  const box = () => { const b = imgs[0]?.getBoundingClientRect(); return b ? b.width + "x" + b.height : ""; };
  const b1 = box(); await frame(); const b2 = box(); await frame(); const stable = b1 === b2 && b2 === box();
  return { n: imgs.length, stable, inAvatar: imgs.some((i) => !!i.closest("a.av,.av")), inBody: imgs.every((i) => !!i.closest(".post-open .gallery")), w: imgs[0]?.getBoundingClientRect().width || 0, h: imgs[0]?.getBoundingClientRect().height || 0, loaded: imgs.every((i) => i.complete && i.naturalWidth > 0) && (!card.querySelector(".gallery.g1") || imgs.every((i) => i.classList.contains("sized"))) && stable, cardW: po.getBoundingClientRect().width, gal: card.querySelector(".gallery")?.className || "" };
}, pid);
/** the interface language is saved on the account: every run sets the one it needs (RTL Arabic or LTR English) */
const setDir = async (p, ltr) => { await p.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await p.evaluate((l) => window.MPI18n.setLang(l), ltr ? "en" : "ar"); await until(() => p.evaluate((d) => document.documentElement.dir === d, ltr ? "ltr" : "rtl")); };
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + ".png") }); };

const P = {};
test.before(async () => {
  ff("-f", "lavfi", "-i", "testsrc2=size=1280x720", "-frames:v", "1", path.join(FX, "wide.jpg"));
  ff("-f", "lavfi", "-i", "testsrc2=size=720x1280", "-frames:v", "1", path.join(FX, "tall.jpg"));
  ff("-f", "lavfi", "-i", "testsrc2=size=360x640:rate=20", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libvpx", "-b:v", "300k", "-c:a", "libopus", "-shortest", path.join(FX, "vertical.webm"));
  fx.broken = path.join(FX, "broken.mp4"); fs.writeFileSync(fx.broken, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(3000, 7)]));
  S = await startStack({ storageDriver: "db", queuePollMs: 200 });
  O = await reg("m1_owner", "صاحبة الصور"); U = await reg("m1_member", "عضو المجتمع");
  const o = api(O);
  cid = (await o("POST", "/api/communities", { name: "مجتمع الصور", desc: "صور وفيديو", topic: "dev" })).community.id;
  await api(U)("PUT", `/api/communities/${cid}/membership`);
  const me = (await api(U)("GET", "/api/me")).user; await o("PUT", "/api/follows/" + me.id); await api(U)("PUT", "/api/follows/" + (await o("GET", "/api/me")).user.id);
  const wide = await upload(O, path.join(FX, "wide.jpg")), tall = await upload(O, path.join(FX, "tall.jpg"));
  P.comm1 = (await o("POST", "/api/posts", { type: "post", markdown: "صورة واحدة في المجتمع", images: [tall.url], alts: ["لوحة ألوان طولية"], community: cid })).post;
  P.feed1 = (await o("POST", "/api/posts", { type: "post", markdown: "صورة واحدة في الخلاصة العامة", images: [wide.url], alts: ["لوحة ألوان أفقية"], visibility: "public" })).post;
  P.noAlt = (await o("POST", "/api/posts", { type: "post", text: "صورة واحدة بلا نص بديل (صيغة قديمة)", images: [wide.url], visibility: "public" })).post;
  P.legacy = (await o("POST", "/api/posts", { type: "post", text: "الصيغة القديمة media", media: wide.url, visibility: "public" })).post;
  P.three = (await o("POST", "/api/posts", { type: "post", markdown: "ثلاث صور في المجتمع", images: [wide.url, tall.url, wide.url], alts: ["الأولى", "الثانية", "الثالثة"], community: cid })).post;
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("single image: full width at real proportions in the community and the public feed (not in the avatar); legacy + multi still render", async () => {
  for (const [tag, opts, ltr] of [["390-light", MOBILE], ["1440-dark", { ...DESKTOP, colorScheme: "dark" }], ["390-ltr", MOBILE, true]]) {
    const u = await page(U, opts);
    await setDir(u, ltr);
    await goC(u); await u.waitForSelector(`.post-open[data-open="#/post/${P.comm1.id}"] .gallery.g1 img`);
    await u.locator(`.post-open[data-open="#/post/${P.comm1.id}"] .gallery img`).scrollIntoViewIfNeeded();
    const c = await until(async () => { const r = await probeImg(u, P.comm1.id); return r && r.loaded && r.h > 150 ? r : null; });
    assert.equal(c.n, 1); assert.equal(c.inAvatar, false, tag + ": not inside the avatar"); assert.equal(c.inBody, true);
    assert.ok(c.w >= c.cardW - 2, `${tag}: full width (${c.w} of ${c.cardW})`);
    assert.ok(Math.abs(c.h / c.w - 1.25) < 0.03 || c.h >= Math.min(620, 0.75 * (await u.evaluate(() => innerHeight))) - 2, `${tag}: a tall photo gets 4:5 (${c.w}×${c.h})`);
    await shot(u, `e2e-community-${tag}`);
    const three = await probeImg(u, P.three.id); assert.equal(three.n, 3); assert.match(three.gal, /\bg3\b/); assert.equal(three.inAvatar, false);
    await go(u, "#/home"); await u.waitForSelector(`.post-open[data-open="#/post/${P.feed1.id}"] .gallery.g1 img`);
    await u.locator(`.post-open[data-open="#/post/${P.feed1.id}"] .gallery img`).scrollIntoViewIfNeeded();
    const f = await until(async () => { const r = await probeImg(u, P.feed1.id); return r && r.loaded && r.h > 100 && Math.abs(r.w / r.h - 16 / 9) < 0.05 ? r : null; }).catch(async (e) => { const r = await probeImg(u, P.feed1.id); throw new Error(`${tag}: a wide photo never settled at 16:9 (${r?.w}×${r?.h}, ${r?.gal}) — ${e.message}`); });
    assert.equal(f.inAvatar, false); assert.ok(f.w >= f.cardW - 2, `${tag}: feed image full width`); assert.ok(Math.abs(f.w / f.h - 16 / 9) < 0.05, `${tag}: a wide photo keeps 16:9 (${f.w}×${f.h})`);
    await shot(u, `e2e-feed-${tag}`);
    for (const k of ["noAlt", "legacy"]) { await u.locator(`.post-open[data-open="#/post/${P[k].id}"]`).scrollIntoViewIfNeeded(); const r = await until(async () => { const x = await probeImg(u, P[k].id); return x && x.loaded ? x : null; }); assert.equal(r.n, 1, k); assert.equal(r.inAvatar, false, k); assert.ok(r.w >= r.cardW - 2, k + " full width"); }
    const bad = await axe(u, ".post-card"); assert.deepEqual(bad, [], `${tag}: axe on the cards`);
    await u.context().close();
  }
});

test("lightbox: tap opens, keyboard + swipe move (RTL and LTR), zoom, Escape closes and returns focus; axe clean", async () => {
  for (const [tag, opts, ltr] of [["390-light", MOBILE], ["1440-dark", { ...DESKTOP, colorScheme: "dark" }], ["390-ltr", MOBILE, true]]) {
    const u = await page(U, opts);
    await setDir(u, ltr);
    await goC(u); const first = u.locator(`.post-open[data-open="#/post/${P.three.id}"] img[data-gal]`).first();
    await first.scrollIntoViewIfNeeded(); await first.click();
    await u.waitForSelector(".mp-lb[role=dialog][aria-modal=true]");
    assert.match(await u.evaluate(() => location.hash), /#\/c\//, "the tap opened the viewer, not the post page");
    assert.equal(await u.textContent(".mp-lb-n"), "1 / 3"); assert.equal(await u.textContent(".mp-lb-alt"), "الأولى");
    assert.equal(await u.evaluate(() => document.activeElement?.dataset.lb), "close", "focus moves into the dialog");
    await u.keyboard.press(ltr ? "ArrowRight" : "ArrowLeft"); assert.equal(await u.textContent(".mp-lb-n"), "2 / 3", tag + ": the reading-direction arrow goes forward");
    await u.keyboard.press(ltr ? "ArrowLeft" : "ArrowRight"); assert.equal(await u.textContent(".mp-lb-n"), "1 / 3");
    const box = await u.locator(".mp-lb-stage").boundingBox(), y = box.y + box.height / 2, x0 = box.x + box.width / 2;
    await u.mouse.move(x0, y); await u.mouse.down(); await u.mouse.move(x0 + (ltr ? -140 : 140), y, { steps: 6 }); await u.mouse.up();
    assert.equal(await u.textContent(".mp-lb-n"), "2 / 3", tag + ": swipe toward the reading direction goes forward");
    await u.click('[data-lb="zoom"]'); assert.equal(await u.getAttribute('[data-lb="zoom"]', "aria-pressed"), "true");
    assert.ok(await u.evaluate(() => /scale\(2\.5\)/.test(document.querySelector(".mp-lb-img").style.transform)), "zoomed");
    await u.keyboard.press("-"); await u.keyboard.press("-"); await u.keyboard.press("-");
    assert.equal(await u.getAttribute('[data-lb="zoom"]', "aria-pressed"), "false", "zoom out with the keyboard");
    await shot(u, `e2e-lightbox-${tag}`);
    assert.deepEqual(await axe(u, ".mp-lb"), [], `${tag}: axe on the lightbox`);
    await u.keyboard.press("Escape"); await u.waitForSelector(".mp-lb", { state: "detached" });
    assert.equal(await u.evaluate(() => document.activeElement?.dataset.gal?.endsWith(":0")), true, "focus returns to the image");
    // keyboard opens it too
    await u.keyboard.press("Enter"); await u.waitForSelector(".mp-lb"); await u.click('[data-lb="close"]'); await u.waitForSelector(".mp-lb", { state: "detached" });
    // double tap still likes the post (no viewer)
    if (tag === "390-light") {
      await go(u, "#/home"); const one = u.locator(`.post-open[data-open="#/post/${P.feed1.id}"] img[data-gal]`); await one.waitFor(); await one.scrollIntoViewIfNeeded(); await one.dblclick();
      await u.waitForSelector(`[data-react="${P.feed1.id}"].on`); await u.waitForTimeout(450); assert.equal(await u.$(".mp-lb"), null, "double tap = like, not the viewer");
    }
    await u.context().close();
  }
});

test("community editor: video button + the image picker accepts videos; honest limit and clear errors; vertical video posts and plays", async () => {
  const o = await page(O);
  await openCE(o);
  assert.deepEqual(await o.$$eval("#composer3 [data-act]", (b) => b.filter((x) => !x.hidden).map((x) => x.dataset.act)), ["img", "video", "poll", "question"]);
  assert.deepEqual(await axe(o, "#composer3"), [], "axe on the community editor");
  const [chooser] = await Promise.all([o.waitForEvent("filechooser"), o.click('[data-act="img"]')]);
  assert.match(await chooser.element().getAttribute("accept"), /image\/\*,video\/\*/, "the image button also accepts videos");
  await chooser.setFiles([]);
  await o.click("#c3-x");
  // the editor shows the real per-file limit and refuses a bigger file before uploading it
  await o.route("**/api/media/limits", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ limits: { image: 1048576, video: 50000, audio: 1048576 } }) }));
  await o.reload(); await o.waitForFunction(() => window.DB && typeof save === "function");
  await openCE(o);
  const [c2] = await Promise.all([o.waitForEvent("filechooser"), o.click('[data-act="video"]')]);
  assert.equal(await c2.element().getAttribute("accept"), "video/*");
  await c2.setFiles(path.join(FX, "vertical.webm"));
  await o.waitForSelector("#c3-err:not([hidden])"); assert.match(await o.textContent("#c3-err"), /أكبر من الحد المسموح/);
  assert.match(await o.textContent("#c3-vlim"), /الحد الأقصى للملف/, "the limit is written on the video card");
  await o.click("#c3-x"); await o.unroute("**/api/media/limits");
  await o.reload(); await o.waitForFunction(() => window.DB && typeof save === "function");
  // a real video from the community editor
  await openCE(o);
  await o.fill("#c3-text", "فيديو عمودي من داخل المجتمع");
  const [c3] = await Promise.all([o.waitForEvent("filechooser"), o.click('[data-act="video"]')]);
  await c3.setFiles(path.join(FX, "vertical.webm"));
  await o.waitForSelector("#c3-type-top video", { timeout: 20000 });
  assert.equal(await o.getAttribute('[data-act="video"]', "aria-pressed"), "true");
  await shot(o, "e2e-composer-video-390-light");
  // images cannot join a video post: said, not silently dropped
  await o.click('[data-act="img"]'); await o.waitForSelector("#c3-err:not([hidden])"); assert.match(await o.textContent("#c3-err"), /لا يجمع معه صوراً/);
  await o.click("#c3-pub"); await o.waitForSelector("#composer3", { state: "detached", timeout: 15000 });
  const row = await until(() => S.app.ctx.db.get("SELECT id, type, community, status, data FROM posts WHERE text=$1", ["فيديو عمودي من داخل المجتمع"]));
  assert.equal(row.type, "video"); assert.equal(row.community, cid);
  const pub = await until(async () => { const r = await S.app.ctx.db.get("SELECT status, data FROM posts WHERE id=$1", [row.id]); return r.status === "published" ? r : null; }, 60000);
  const d = typeof pub.data === "string" ? JSON.parse(pub.data) : pub.data; assert.equal(d.video.width, 360); assert.equal(d.video.height, 640); assert.ok(d.video.duration > 0);
  // the member sees it in the community at its real (vertical) proportions; tapping plays a source this browser supports
  const u = await page(U); await setDir(u, false); await goC(u);
  const box = `.mp-video[data-video="${row.id}"]`; await u.waitForSelector(box, { timeout: 20000 }); await u.locator(box).scrollIntoViewIfNeeded();
  const g = await u.evaluate((s) => { const e = document.querySelector(s), r = e.getBoundingClientRect(); return { cls: e.className, w: r.width, h: r.height }; }, box);
  assert.match(g.cls, /portrait/); assert.ok(Math.abs(g.w / g.h - 0.5625) < 0.02, `vertical video keeps 9:16 (${g.w}×${g.h})`); assert.ok(g.h > 400, "not tiny");
  await u.click(box + " .mp-big");
  await u.waitForFunction((s) => { const v = document.querySelector(s + " video"); return v && v.readyState >= 1 && !v.error; }, box, { timeout: 15000 });
  const v = await u.evaluate((s) => { const e = document.querySelector(s), vid = e.querySelector("video"); return { src: vid.currentSrc, poster: vid.getAttribute("poster"), inline: vid.hasAttribute("playsinline"), list: e._mpSources, err: !e.querySelector(".mp-err").hidden }; }, box);
  assert.ok(v.inline); assert.ok(v.poster, "poster shown"); assert.equal(v.err, false);
  assert.ok(v.list.length >= 1 && v.list[v.list.length - 1].endsWith(".webm"), "the original upload is the last fallback");
  assert.ok(/\.(webm|mp4|m3u8)$/.test(v.src), "plays a supported source: " + v.src);
  await shot(u, "e2e-community-video-390-light");
  await u.context().close(); await o.context().close();
});

test("player error state + processing failure «تعذّر التجهيز» with retry for the author", async () => {
  const o = api(O);
  // a published video whose files are all gone → visible error with retry, never a silent black box
  const gone = (await o("POST", "/api/posts", { type: "video", text: "فيديو ملفاته مفقودة", visibility: "public", media: "linear-gradient(135deg,#111111,#222222)" })).post;
  await until(async () => (await S.app.ctx.db.get("SELECT status FROM posts WHERE id=$1", [gone.id])).status === "published", 15000);
  const r0 = await S.app.ctx.db.get("SELECT data FROM posts WHERE id=$1", [gone.id]); const d0 = typeof r0.data === "string" ? JSON.parse(r0.data) : r0.data;
  d0.video = { ...d0.video, width: 1280, height: 720, variants: { master: "/media/md_missing000a_master.m3u8", "720p": "/media/md_missing000a_720.mp4", original: "/media/md_missing000a.webm", width: 1280, height: 720 } };
  await S.app.ctx.db.run("UPDATE posts SET data=$1 WHERE id=$2", [d0, gone.id]);
  const u = await page(U); await setDir(u, false); await go(u, "#/post/" + gone.id);
  const box = `.mp-video[data-video="${gone.id}"]`; await u.waitForSelector(box); await u.click(box + " .mp-big");
  await u.waitForSelector(box + " .mp-err:not([hidden])", { timeout: 15000 });
  assert.match(await u.textContent(box + " .mp-err"), /تعذّر تشغيل الفيديو/); assert.ok(await u.$(box + ' .mp-err [data-a="reload"]'));
  assert.deepEqual(await axe(u, box), [], "axe on the error box");
  await shot(u, "e2e-player-error-390-light"); await u.context().close();
  // processing gives up → the author sees «تعذّر التجهيز» and can retry
  const m = await upload(O, fx.broken);
  const bad = (await o("POST", "/api/posts", { type: "video", text: "فيديو تعذّر تجهيزه", video: { mediaId: m.id }, community: cid })).post;
  await until(async () => (await S.app.ctx.db.get("SELECT status FROM media WHERE id=$1", [m.id])).status === "failed", 30000);
  const a = await page(O); await go(a, "#/post/" + bad.id);
  await a.waitForSelector(".mp-state.failed", { timeout: 15000 });
  assert.match(await a.textContent(".mp-state.failed"), /تعذّر التجهيز/);
  assert.deepEqual(await axe(a, ".mp-state"), [], "axe on the failed state");
  await shot(a, "e2e-processing-failed-390-light");
  const jobs = async () => Number((await S.app.ctx.db.get("SELECT COUNT(*) n FROM media_jobs WHERE payload LIKE $1", ["%" + m.id + "%"])).n);
  const before = await jobs();
  await a.click(`[data-mretry="${m.id}"]`);
  await a.waitForFunction(() => /أُعيد التجهيز|اكتمل التجهيز/.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 10000 });
  await until(async () => (await jobs()) === before + 1, 10000); // re-queued once
  assert.ok(["processing", "failed"].includes((await S.app.ctx.db.get("SELECT status FROM media WHERE id=$1", [m.id])).status), "re-queued (a broken file fails again — never stuck)");
  await a.context().close();
});
