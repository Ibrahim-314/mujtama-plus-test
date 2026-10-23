/* Track 3 — creation journeys: rich composer, images & alt text, assistant, drafts, articles &
 * paragraph comments, stories, audio, video player, live rooms (real WebRTC), studio. */
const test = require("node:test"), assert = require("node:assert"), { execFileSync } = require("node:child_process"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { startStack, onboard, dismissTour, MOBILE, DESKTOP } = require("./harness");
let S; const errors = [];
const tmp = (name, args) => { const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args])); return f; };
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });
const page = async (opts) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce", permissions: ["microphone", "camera"] }); const p = await c.newPage(); p.on("pageerror", e => errors.push(e.message)); return p; };
const login = async (p, handle) => { await p.goto(S.base + "/?nosw"); await p.fill("#a-handle", handle); await p.fill("#a-pass", "secret1234"); await p.click("#a-go"); await p.waitForSelector(".bottomnav a[data-r=home]"); await dismissTour(p); };
const openComposer = (p) => p.evaluate(() => document.getElementById("fab").click());

test("composer: formatting toolbar, spelling fix, 3 images reordered with alt text, publish", async () => {
  const p = await page(MOBILE); await onboard(p, S.base, "writer", "كاتب");
  await openComposer(p); await p.waitForSelector("#composer3");
  await p.fill("#c3-text", "انشاء الله نطلق ميزة جديدة"); await p.click('[data-tool="b"]'); await p.keyboard.type("مهمة");
  await p.waitForSelector(".c3-assist .fix", { timeout: 6000 }); await p.click(".c3-assist .fix");
  assert.match(await p.inputValue("#c3-text"), /إن شاء الله/); assert.match(await p.inputValue("#c3-text"), /\*\*مهمة\*\*/);
  const imgs = ["red", "green", "blue"].map(c => tmp(c + ".png", ["-f", "lavfi", "-i", `color=c=${c}:s=320x240`, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"]));
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click('[data-tool="img"]')]); await fc.setFiles(imgs);
  await p.waitForSelector(".thumb[data-i='2']", { timeout: 10000 });
  const first = await p.getAttribute(".thumb[data-i='0'] img", "src");
  const a = await p.$(".thumb[data-i='0']"), b = await p.$(".thumb[data-i='2']"); const ra = await a.boundingBox(), rb = await b.boundingBox();
  await p.mouse.move(ra.x + ra.width / 2, ra.y + ra.height / 2); await p.mouse.down(); await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 8 }); await p.mouse.up();
  assert.equal(await p.getAttribute(".thumb[data-i='2'] img", "src"), first, "image dragged to the end");
  p.once("dialog", d => d.accept("شعار باللون الأحمر")); await p.click("[data-alt='2']");
  await p.click('[data-m="preview"]'); await p.waitForSelector("#c3-preview strong"); await p.click('[data-m="write"]');
  await p.click("#c3-pub"); await p.waitForSelector("#composer3", { state: "detached" }); await p.waitForTimeout(800);
  const card = await p.waitForSelector(".post-card .gallery img[alt='شعار باللون الأحمر']"); assert.ok(card);
  assert.ok(await p.$(".post-card .body.rich strong"));
  await p.context().close();
});

test("drafts autosave and reopen on another device", async () => {
  const p = await page(MOBILE); await login(p, "writer");
  await openComposer(p); await p.click('[data-t="article"]'); await p.fill("#c3-title", "مسودة مقال طويل"); await p.fill("#c3-text", "# البداية\n\nفقرة أولى");
  await p.waitForSelector(".c3-saved:has-text('حُفظت')", { timeout: 6000 }); await p.click("#c3-x");
  const d = await page(DESKTOP); await login(d, "writer"); await openComposer(d); await d.click("#c3-drafts");
  await d.waitForSelector("[data-dr]"); assert.match(await d.textContent("[data-dr]"), /مسودة مقال طويل/);
  await d.click("[data-dr]"); await d.waitForSelector("#c3-title"); assert.equal(await d.inputValue("#c3-title"), "مسودة مقال طويل");
  await p.context().close(); await d.context().close();
});

test("article: TOC, font size, reading progress, paragraph comment, SSR page", async () => {
  const p = await page(MOBILE); await login(p, "writer");
  await openComposer(p); await p.click('[data-t="article"]'); await p.fill("#c3-title", "دليل الكتابة الجيدة");
  await p.fill("#c3-text", "# لماذا نكتب\n\n" + "فكرة واضحة ".repeat(120) + "\n\n# كيف نبدأ\n\nابدأ بجملة قوية\n\n# الخلاصة\n\n| النصيحة | السبب |\n|---|---|\n| اختصر | القارئ مشغول |");
  await p.click("#c3-pub"); await p.waitForSelector("#composer3", { state: "detached" }); await p.waitForTimeout(800);
  const id = await p.evaluate(() => DB.posts.find(x => x.title === "دليل الكتابة الجيدة").id);
  await p.goto(S.base + "/?nosw#/post/" + id); await p.waitForSelector(".reader .r-toc");
  assert.equal(await p.$$eval(".r-toc a", a => a.length), 3); assert.ok(await p.$(".reader table"));
  await p.click('[data-f="1"]'); assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".reader")).getPropertyValue("--rf").trim()), "21px");
  await p.click(".r-body [data-para]"); await p.waitForSelector("#pc-in"); await p.fill("#pc-in", "تعليق على هذه الفقرة"); await p.click("#pc-go"); await p.waitForTimeout(500);
  assert.equal(await p.textContent(".r-body [data-para]:not(.empty)"), "1");
  const r = await fetch(`${S.base}/a/${id}`); const html = await r.text(); assert.match(html, /<h1>دليل الكتابة الجيدة<\/h1>/); assert.match(html, /application\/ld\+json/);
  await p.context().close();
});

test("stories: create a story, see the ring, open the viewer", async () => {
  const p = await page(MOBILE); await login(p, "writer");
  await p.waitForSelector("#st-new"); await p.click("#st-new"); await p.waitForSelector(".story-pick");
  await p.fill("#c3-text", "صباح الخير من جدة"); await p.click("#c3-pub"); await p.waitForSelector("#composer3", { state: "detached" });
  const fan = await page(MOBILE); await onboard(fan, S.base, "fan_one", "متابع");
  await fan.evaluate(async () => { const u = DB.users.find(x => x.handle === "writer"); await fetch("/api/follows/" + u.id, { method: "PUT", headers: { "X-Requested-With": "mujtama" } }); });
  await fan.reload(); await fan.waitForSelector(".bottomnav a[data-r=home]"); await dismissTour(fan);
  await fan.waitForSelector("[data-st]"); await fan.click("[data-st]"); await fan.waitForSelector("#story-viewer .sv-text");
  assert.match(await fan.textContent(".sv-text"), /صباح الخير/);
  await fan.click(".sv-x"); await fan.waitForSelector("[data-st] .st-ring.seen");
  await p.context().close(); await fan.context().close();
});

test("audio post with waveform plays in the floating player; video gets the custom player", async () => {
  const p = await page(MOBILE); await login(p, "writer");
  await openComposer(p); await p.click('[data-t="audio"]'); const wav = tmp("a.wav", ["-f", "lavfi", "-i", "sine=f=300:d=2", "-f", "wav", "-"]);
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#rec-file")]); await fc.setFiles(wav); await p.waitForSelector("#rec-t:has-text('a.wav')", { timeout: 10000 });
  await p.fill("#c3-text", "ملاحظة صوتية"); await p.click("#c3-pub"); await p.waitForSelector("#composer3", { state: "detached" });
  for (let i = 0; i < 40 && !(await p.$(".audio-card .ap-play")); i++) { await p.waitForTimeout(500); await p.evaluate(() => refresh()); }
  await p.click(".audio-card .ap-play"); await p.waitForSelector("#mini-player.on");
  assert.equal(await p.$$eval(".audio-card .wave i", x => x.length), 64);
  await p.goto(S.base + "/?nosw#/explore"); assert.ok(await p.$("#mini-player.on"), "player persists across navigation");
  const mp4 = tmp("v.mp4", ["-f", "lavfi", "-i", "testsrc=s=640x360:d=2:r=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "-"]);
  const id = await p.evaluate(async (b64) => { const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const m = await (await fetch("/api/media", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "video/mp4" }, body: buf })).json(); const r = await (await fetch("/api/posts", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ type: "video", text: "فيديو تجريبي", video: { mediaId: m.media.id } }) })).json(); return r.post.id; }, fs.readFileSync(mp4).toString("base64"));
  for (let i = 0; i < 60; i++) { const ok = await p.evaluate(async (id) => { await refresh(); const x = DB.posts.find(q => q.id === id); return x && x.status === "published" && !!x.video?.variants; }, id); if (ok) break; await p.waitForTimeout(500); }
  await p.goto(S.base + "/?nosw#/post/" + id); await p.waitForSelector(".mp-video"); await p.click(".mp-video .mp-big");
  await p.waitForSelector(".mp-video.mounted video"); assert.ok(await p.$(".mp-bar [data-a='speed']"));
  await p.context().close();
});

test("live room: two people connect over WebRTC, raise hand, get promoted", async () => {
  const host = await page(MOBILE); await login(host, "writer");
  await host.goto(S.base + "/?nosw#/rooms"); await host.click("#rm-new"); await host.fill("#rm-t", "نقاش تجريبي مباشر"); await host.click("#rm-go");
  await host.waitForSelector(".room .spk"); const roomUrl = host.url();
  const guest = await page(MOBILE); await login(guest, "fan_one");
  await guest.goto(roomUrl.replace(/\?[^#]*/, "?nosw")); await guest.waitForSelector("#rm-hand"); await guest.click("#rm-hand");
  await host.waitForSelector("[data-promote]", { timeout: 8000 }); await host.click("[data-promote]");
  await guest.waitForSelector("#rm-mic", { timeout: 8000 });
  const connected = async (pg) => { for (let i = 0; i < 40; i++) { const st = await pg.evaluate(() => window.__rtcStates ? window.__rtcStates() : []); if (st.includes("connected")) return true; await pg.waitForTimeout(250); } return false; };
  assert.ok(await connected(host), "host peer connection reached 'connected'");
  await host.click("#rm-end").catch(() => { }); host.once("dialog", d => d.accept());
  await host.context().close(); await guest.context().close();
});

test("studio: overview, calendar, best time, weekly report card", async () => {
  const p = await page(DESKTOP); await login(p, "writer");
  await p.goto(S.base + "/?nosw#/studio"); await p.waitForSelector(".kpi-card");
  for (const t of ["calendar", "best", "recycle", "templates", "weekly"]) { await p.click(`[data-stab="${t}"]`); await p.waitForSelector("#st-body :not(.skel)"); }
  await p.waitForSelector("#wk"); const filled = await p.evaluate(() => { const g = document.getElementById("wk").getContext("2d").getImageData(540, 40, 1, 1).data; return g[3] > 0; }); assert.ok(filled, "weekly card drawn");
  await p.click('[data-stab="calendar"]'); await p.waitForSelector(".cal-day");
  await p.context().close();
});
