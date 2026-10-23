/* Track 3 — content & creation: rich documents, articles & SSR, drafts, assistant, templates,
 * stories, media pipeline (HLS, captions, audio waveform), live rooms, creator studio. */
const test = require("node:test"), assert = require("node:assert"), { execFileSync } = require("node:child_process");
const { boot } = require("./helpers");
let H, A, B;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const ff = (...a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...a]);
const raw = async (c, path, buf, type = "application/octet-stream") => { const r = await fetch(H.base + path, { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": type, Cookie: c.cookie }, body: buf }); return { status: r.status, ...(await r.json()) }; };
test.before(async () => {
  H = await boot({ queuePollMs: 100 }); A = new H.Client(); B = new H.Client();
  await A.req("POST", "/api/auth/register", { name: "إبراهيم", handle: "ibrahim", password: "secret123" });
  await B.req("POST", "/api/auth/register", { name: "سلمى", handle: "salma", password: "secret123" });
  const a = (await A.req("GET", "/api/me")).user.id; await B.req("PUT", "/api/follows/" + a);
});
test.after(() => H.app.close());

test("rich posts are stored as a document; unsafe links are dropped", async () => {
  const r = await A.req("POST", "/api/posts", { markdown: "نصائح **مهمة**:\n\n- أولاً\n- ثانياً\n\n[خبيث](javascript:alert(1)) و[آمن](https://example.com)" });
  assert.equal(r.status, 200); assert.deepEqual(r.post.doc.blocks.map(b => b.t), ["p", "ul", "p"]);
  const links = r.post.doc.blocks.flatMap(b => b.r || []).filter(x => x[2]).map(x => x[2]);
  assert.deepEqual(links, ["https://example.com"], "only http(s) links become links"); assert.match(r.post.text, /أولاً/);
  const plain = await A.req("POST", "/api/posts", { text: "منشور عادي بلا تنسيق" }); assert.equal(plain.post.doc, undefined);
});

test("up to 10 images with alt text", async () => {
  const imgs = Array.from({ length: 12 }, (_, i) => `/media/md_img${i}aaaaaa.jpg`);
  const r = await A.req("POST", "/api/posts", { text: "ألبوم", images: imgs, alts: imgs.map((_, i) => "وصف " + i) });
  assert.equal(r.post.images.length, 10); assert.equal(r.post.alts[9], "وصف 9");
});

test("articles: reading time, series, paragraph comments, SSR page, sitemap, robots", async () => {
  const body = "# المقدمة\n\n" + "كلمة ".repeat(450) + "\n\n## التفاصيل\n\nفقرة للنقاش\n\n# الخاتمة\n\n| أ | ب |\n|---|---|\n| ١ | ٢ |";
  const s1 = (await A.req("POST", "/api/posts", { type: "article", title: "دليل البداية مع Pi", markdown: body, series: "sr_abcdef12", part: 1, parts: 2 })).post;
  assert.equal(s1.readingMin, 2); assert.ok(s1.doc.blocks.some(b => b.t === "table"));
  await A.req("POST", "/api/posts", { type: "article", title: "الجزء الثاني", markdown: "تكملة", series: "sr_abcdef12", part: 2, parts: 2 });
  assert.equal((await B.req("GET", "/api/series/sr_abcdef12")).parts.length, 2);
  const para = s1.doc.blocks.find(b => b.t === "p" && b.r[0][0] === "فقرة للنقاش").id;
  const c = await B.req("POST", "/api/comments", { post: s1.id, text: "نقطة ممتازة", anchor: para }); assert.equal(c.comment.anchor, para);
  const pc = await A.req("GET", `/api/posts/${s1.id}/paragraphs?anchor=${para}`); assert.equal(pc.counts[para], 1); assert.equal(pc.comments.length, 1);
  const html = await (await fetch(`${H.base}/a/${s1.id}`)).text();
  assert.match(html, /<title>دليل البداية مع Pi/); assert.match(html, /og:title/); assert.match(html, /"@type":"Article"/); assert.match(html, /<table>/); assert.match(html, /سلسلة من 2 أجزاء/); assert.match(html, /rel="canonical"/);
  assert.equal((await fetch(`${H.base}/a/p_doesnotexist1`)).status, 404);
  assert.match(await (await fetch(H.base + "/sitemap.xml")).text(), new RegExp(`/a/${s1.id}`));
  assert.match(await (await fetch(H.base + "/robots.txt")).text(), /Sitemap: .*\/sitemap\.xml/);
});

test("drafts sync across devices with conflict detection", async () => {
  const d1 = await A.req("PUT", "/api/drafts/dr_abc12345", { data: { type: "article", title: "مسودة", markdown: "نص أول" }, device: "phone" }); assert.equal(d1.status, 200);
  const d2 = await A.req("PUT", "/api/drafts/dr_abc12345", { data: { markdown: "من الكمبيوتر" }, device: "laptop", base: d1.updatedAt }); assert.equal(d2.status, 200);
  const stale = await A.req("PUT", "/api/drafts/dr_abc12345", { data: { markdown: "قديم" }, device: "phone", base: d1.updatedAt });
  assert.equal(stale.status, 409); assert.equal(stale.code, "draft_conflict"); assert.equal(stale.draft.data.markdown, "من الكمبيوتر");
  assert.equal((await A.req("GET", "/api/drafts")).drafts.length, 1);
  assert.equal((await B.req("GET", "/api/drafts")).drafts.length, 0, "drafts are private");
});

test("writing assistant: Arabic spelling and hashtag suggestions", async () => {
  await A.req("POST", "/api/posts", { text: "تعلم #الذكاء_الاصطناعي اليوم" });
  const r = await A.req("POST", "/api/compose/assist", { text: "انشاء الله نتعلم الذكاء الاصطناعي، لاكن هاذا يحتاج وقت" });
  const fixes = Object.fromEntries(r.spelling.map(s => [s.from, s.to]));
  assert.equal(fixes["انشاء الله"], "إن شاء الله"); assert.equal(fixes["لاكن"], "لكن"); assert.equal(fixes["هاذا"], "هذا");
  assert.ok(r.tags.some(t => t.includes("ذكاء")), r.tags.join());
  const p = await A.req("POST", "/api/compose/preview", { markdown: "# عنوان\n\n**نص**" }); assert.match(p.html, /<strong>نص<\/strong>/);
});

test("templates: save, use, delete", async () => {
  const t = await A.req("POST", "/api/templates", { name: "ملخص أسبوعي", data: { type: "post", markdown: "## ما تعلمته هذا الأسبوع\n\n- " } });
  assert.equal((await A.req("POST", `/api/templates/${t.template.id}/use`)).template.data.markdown.startsWith("## ما تعلمته"), true);
  assert.equal((await A.req("GET", "/api/templates")).templates[0].uses, 1);
  await A.req("DELETE", "/api/templates/" + t.template.id); assert.equal((await A.req("GET", "/api/templates")).templates.length, 0);
});

test("stories: 24h, grouped by author, view receipts, hidden from the feed", async () => {
  const s = (await A.req("POST", "/api/posts", { type: "story", text: "صباح الخير من جدة", media: "linear-gradient(135deg,#5b2bd6,#e0559b)" })).post;
  assert.ok(new Date(s.expiresAt) - Date.now() > 23 * 3600e3);
  const list = await B.req("GET", "/api/stories"); assert.equal(list.stories[0].user.handle, "ibrahim"); assert.equal(list.stories[0].allSeen, false);
  await B.req("POST", `/api/stories/${s.id}/view`);
  assert.equal((await B.req("GET", "/api/stories")).stories[0].allSeen, true);
  assert.equal((await A.req("GET", `/api/stories/${s.id}/viewers`)).viewers[0].handle, "salma");
  assert.equal((await B.req("GET", `/api/stories/${s.id}/viewers`)).status, 404);
  assert.ok(!(await B.req("GET", "/api/feed?mode=latest")).posts.some(p => p.id === s.id));
});

test("video pipeline: HLS ladder, smart thumbnail, MP4 fallback, captions", async () => {
  const mp4 = ff("-f", "lavfi", "-i", "testsrc=s=854x480:d=3:r=24", "-f", "lavfi", "-i", "sine=f=440:d=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "-");
  const up = await raw(A, "/api/media", mp4); assert.equal(up.status, 200, up.error); assert.equal(up.media.status, "processing");
  const post = (await A.req("POST", "/api/posts", { type: "video", text: "فيديو قصير", video: { mediaId: up.media.id, short: true } })).post; assert.equal(post.status, "processing");
  assert.ok(await H.app.ctx.queue.drain(90e3)); await wait(200);
  const m = (await A.req("GET", "/api/media/" + up.media.id)).media; assert.equal(m.status, "ready");
  assert.ok(m.variants.master && m.variants.hls["360p"] && m.variants.poster && m.variants["360p"], JSON.stringify(m.variants));
  const master = await (await fetch(H.base + m.variants.master)).text(); assert.match(master, /#EXT-X-STREAM-INF:BANDWIDTH=\d+,(?:AVERAGE-BANDWIDTH=\d+,)?RESOLUTION=\d+x360/);
  const pl = await fetch(H.base + m.variants.hls["360p"]); assert.equal(pl.headers.get("content-type"), "application/vnd.apple.mpegurl"); assert.match(await pl.text(), /#EXTINF/);
  const srt = "1\n00:00:00,500 --> 00:00:02,000\nمرحباً بكم\n\n2\n00:00:02,100 --> 00:00:03,000\n<script>x</script>شكراً\n";
  const cc = await raw(A, `/api/media/${up.media.id}/captions?lang=ar`, Buffer.from(srt), "text/plain"); assert.equal(cc.status, 200, cc.error);
  const vtt = await (await fetch(H.base + cc.captions[0].url)).text(); assert.match(vtt, /^WEBVTT/); assert.match(vtt, /00:00:00\.500 --> 00:00:02\.000/); assert.ok(!vtt.includes("<script>"));
  const fresh = (await B.req("GET", "/api/feed?mode=latest")).posts.find(p => p.id === post.id); assert.equal(fresh.status, "published"); assert.ok(fresh.video.variants.master);
});

test("audio posts: AAC transcode, waveform, duration; transcription honest when no provider", async () => {
  const wav = ff("-f", "lavfi", "-i", "sine=f=330:d=2", "-f", "lavfi", "-i", "anoisesrc=d=2:a=0.2", "-filter_complex", "amix=inputs=2", "-f", "wav", "-");
  const up = await raw(B, "/api/media", wav); assert.equal(up.media.kind, "audio");
  const p = (await B.req("POST", "/api/posts", { type: "audio", text: "ملاحظة صوتية", audio: { mediaId: up.media.id } })).post; assert.equal(p.status, "processing");
  await H.app.ctx.queue.drain(60e3); await wait(200);
  const got = (await B.req("GET", "/api/feed?mode=latest")).posts.find(x => x.id === p.id);
  assert.equal(got.status, "published"); assert.equal(got.audio.waveform.length, 64); assert.equal(got.audio.duration, 2); assert.ok(got.audio.variants.m4a); assert.equal(got.audio.transcript, "unavailable");
});

test("queue retries failed jobs with backoff and gives up after max attempts", async () => {
  const Q = require("../lib/queue").createQueue(H.app.ctx.db, { log: { error() { } }, maxAttempts: 2 }); let calls = 0;
  Q.on("flaky", async () => { calls++; throw new Error("boom"); });
  const jid = await Q.enqueue("flaky", {}); Q.start(50);
  for (let i = 0; i < 80 && calls < 2; i++) await wait(100);
  await H.app.ctx.db.run("UPDATE media_jobs SET run_after=$1 WHERE id=$2", [new Date().toISOString(), jid]);
  for (let i = 0; i < 40; i++) { const j = await H.app.ctx.db.get("SELECT status FROM media_jobs WHERE id=$1", [jid]); if (j.status === "failed") break; await wait(100); }
  Q.stop(); const j = await H.app.ctx.db.get("SELECT status, attempts FROM media_jobs WHERE id=$1", [jid]);
  assert.equal(j.status, "failed"); assert.equal(j.attempts, 2);
});

test("live rooms: join, raise hand, promote, signalling relay, mesh vs LiveKit tokens, end", async () => {
  const r = (await A.req("POST", "/api/rooms", { title: "نقاش مفتوح عن Pi" })).room; assert.equal(r.transport, "mesh");
  let s = await B.req("POST", `/api/rooms/${r.id}/join`); assert.equal(s.members.find(m => m.handle === "salma").role, "listener");
  s = await B.req("POST", `/api/rooms/${r.id}/hand`, { up: true }); assert.equal(s.members.find(m => m.handle === "salma").hand, true);
  const salma = (await B.req("GET", "/api/me")).user.id, ibrahim = (await A.req("GET", "/api/me")).user.id;
  assert.equal((await B.req("POST", `/api/rooms/${r.id}/role`, { user: salma, role: "speaker" })).status, 403, "only the host promotes");
  s = await A.req("POST", `/api/rooms/${r.id}/role`, { user: salma, role: "speaker" }); assert.equal(s.members.find(m => m.id === salma).role, "speaker");
  assert.equal((await B.req("POST", `/api/rooms/${r.id}/signal`, { to: ibrahim, data: { type: "offer", sdp: "v=0" } })).status, 200);
  assert.equal((await A.req("GET", `/api/rooms/${r.id}/token`)).mode, "mesh");
  const tok = H.app.ctx.services.rooms.livekitToken({ key: "APIkey", secretKey: "s3cret", room: r.id, identity: salma, name: "سلمى", canPublish: false });
  const [, body] = tok.split("."); const claims = JSON.parse(Buffer.from(body, "base64url").toString()); assert.equal(claims.video.room, r.id); assert.equal(claims.video.canPublish, false); assert.equal(claims.iss, "APIkey");
  assert.equal((await A.req("GET", "/api/rooms")).rooms[0].speakers, 2);
  s = await A.req("POST", `/api/rooms/${r.id}/end`); assert.equal(s.room.status, "ended");
  assert.equal((await B.req("POST", `/api/rooms/${r.id}/hand`, { up: true })).status, 400);
});

test("creator studio: sources, per-post analytics, best time, calendar, reschedule, recycle, weekly", async () => {
  const A0 = A; A = new H.Client(); await A.req("POST", "/api/auth/register", { name: "منشئ", handle: "creator_x", password: "secret123" }); await B.req("PUT", "/api/follows/" + (await A.req("GET", "/api/me")).user.id);
  const p = (await A.req("POST", "/api/posts", { text: "منشور للتحليلات" })).post;
  await B.req("POST", `/api/posts/${p.id}/view`, { source: "search" }); await B.req("PUT", "/api/reactions/" + p.id, { type: "useful" });
  const ps = await A.req("GET", "/api/studio/posts/" + p.id); assert.equal(ps.reach, 1); assert.equal(ps.sources[0].source, "search"); assert.equal(ps.reactions.useful, 1); assert.equal(ps.first48h.length, 48);
  assert.equal((await B.req("GET", "/api/studio/posts/" + p.id)).status, 404);
  const ov = await A.req("GET", "/api/studio/overview?days=7"); assert.ok(ov.totals.views >= 1); assert.equal(ov.daily.views.length, 7); assert.ok(ov.sources.length);
  const bt = await A.req("GET", "/api/studio/best-time?tz=180"); assert.equal(bt.grid.length, 7); assert.equal(bt.grid[0].length, 24);
  const when = new Date(Date.now() + 3 * 864e5); const sch = (await A.req("POST", "/api/posts", { text: "منشور مجدول للتقويم", publishAt: when.toISOString() })).post; assert.equal(sch.status, "scheduled");
  const cal = await A.req("GET", "/api/studio/calendar?month=" + when.toISOString().slice(0, 7)); assert.ok(cal.items.some(i => i.id === sch.id && i.status === "scheduled"));
  const later = new Date(Date.now() + 5 * 864e5).toISOString(); assert.equal((await A.req("PATCH", "/api/studio/schedule/" + sch.id, { publishAt: later })).publishAt, later);
  assert.equal((await A.req("POST", `/api/studio/schedule/${sch.id}/now`)).status, 200);
  const old = new Date(Date.now() - 40 * 864e5).toISOString(); await H.app.ctx.db.run("UPDATE posts SET created_at=$1, views=50 WHERE id=$2", [old, p.id]);
  const rc = await A.req("GET", "/api/studio/recycle"); assert.equal(rc.candidates[0].id, p.id);
  const re = await A.req("POST", "/api/studio/recycle/" + p.id, { mode: "repost" }); assert.equal(re.post.repostOf, p.id);
  assert.ok(!(await A.req("GET", "/api/studio/recycle")).candidates.some(c => c.id === p.id), "recently recycled posts rest for 30 days");
  const wk = await A.req("GET", "/api/studio/weekly"); assert.equal(wk.daily.length, 7); assert.equal(wk.user.handle, "creator_x"); A = A0;
});
