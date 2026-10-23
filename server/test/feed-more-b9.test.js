/* v2.61.1 — B9: a video post needs a real uploaded video; an image-only post with no valid image is empty.
 * B1 (server side): the community posts cursor pages through every post with no duplicate. */
const test = require("node:test"), assert = require("node:assert"), { execFileSync } = require("node:child_process");
const { boot } = require("./helpers");
let H, A, B;
const raw = async (c, path, buf) => { const r = await fetch(H.base + path, { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/octet-stream", Cookie: c.cookie }, body: buf }); return { status: r.status, ...(await r.json()) }; };
test.before(async () => {
  H = await boot({ queuePollMs: 100 }); A = new H.Client(); B = new H.Client();
  await A.req("POST", "/api/auth/register", { name: "صاحب", handle: "b9_owner", password: "secret123" });
  await B.req("POST", "/api/auth/register", { name: "آخر", handle: "b9_other", password: "secret123" });
});
test.after(async () => { await H.app.ctx.queue.drain(30e3).catch(() => {}); await H.app.close(); });

test("B9: video post without a real video file → 400 with an Arabic error", async () => {
  for (const body of [{ type: "video", text: "فيديو بلا ملف" }, { type: "video", text: "رابط بدل ملف", video: "https://example.com/x.mp4" }, { type: "video", text: "بلا معرّف", video: { duration: 10 } }, { type: "video", text: "معرّف رقمي", video: { mediaId: 42 } }, { type: "video", text: "معرّف مجهول", video: { mediaId: "md_doesnotexist" } }]) {
    const r = await A.req("POST", "/api/posts", body);
    assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.error, /فيديو/, r.error);
  }
});

test("B9: someone else's video, or an image as video → 400; the author's real video still works", async () => {
  const mp4 = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=160x120:d=1:r=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "-"]);
  const up = await raw(A, "/api/media", mp4); assert.equal(up.status, 200, up.error);
  assert.equal((await B.req("POST", "/api/posts", { type: "video", text: "فيديو غيري", video: { mediaId: up.media.id } })).status, 400);
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]); const img = await raw(A, "/api/media", png);
  if (img.status === 200) assert.equal((await A.req("POST", "/api/posts", { type: "video", text: "صورة كفيديو", video: { mediaId: img.media.id } })).status, 400);
  const ok = await A.req("POST", "/api/posts", { type: "video", text: "فيديو حقيقي", video: { mediaId: up.media.id } });
  assert.equal(ok.status, 200, ok.error); assert.equal(ok.post.status, "processing");
  const legacy = await A.req("POST", "/api/posts", { type: "video", text: "عرض تجريبي", media: "linear-gradient(135deg,#111111,#222222)" });
  assert.equal(legacy.status, 200, "legacy demo shape (cover gradient) still accepted");
});

test("B9: image-only post whose images are all invalid → 400; text + bad image still posts (image dropped)", async () => {
  const C = new H.Client(); await C.req("POST", "/api/auth/register", { name: "صور", handle: "b9_images", password: "secret123" });
  const bad = await C.req("POST", "/api/posts", { images: ["javascript:alert(1)"] });
  assert.equal(bad.status, 400); assert.match(bad.error, /الصور/);
  const withText = await C.req("POST", "/api/posts", { text: "نص مع صورة غير صالحة", images: ["javascript:alert(1)"] });
  assert.equal(withText.status, 200); assert.ok(!withText.post.images?.length);
  const good = await C.req("POST", "/api/posts", { images: ["linear-gradient(135deg,#123456,#654321)"] });
  assert.equal(good.status, 200, good.error);
});

test("B1: community posts cursor reaches every post, no duplicates", async () => {
  const D = new H.Client(); await D.req("POST", "/api/auth/register", { name: "صفحات", handle: "b1_pages", password: "secret123" });
  const c = await D.req("POST", "/api/communities", { name: "مجتمع الصفحات", desc: "اختبار", topic: "tech", privacy: "public" });
  const cid = c.community?.id || c.id; assert.ok(cid, JSON.stringify(c).slice(0, 200));
  // one real post through the API, then 33 copies straight in the DB (the posting rate limit would stop a loop of 34)
  const first = await D.req("POST", "/api/posts", { text: "منشور الصفحات الأول", community: cid }); assert.equal(first.status, 200, first.error);
  const row = await H.app.ctx.db.get("SELECT * FROM posts WHERE id=$1", [first.post.id]), cols = Object.keys(row);
  for (let i = 0; i < 33; i++) {
    const r = { ...row, id: `p_b1pg${String(i).padStart(4, "0")}`, text: `منشور رقم ${i} للصفحات`, created_at: new Date(Date.parse(row.created_at) - (i + 1) * 1000 * (i % 3 ? 1 : 0)).toISOString() }; // some share a timestamp: the id breaks the tie
    await H.app.ctx.db.run(`INSERT INTO posts(${cols.join(",")}) VALUES(${cols.map((_, k) => "$" + (k + 1)).join(",")})`, cols.map(k => r[k]));
  }
  const p1 = await D.req("GET", `/api/communities/${cid}/posts`); assert.equal(p1.posts.length, 30); assert.ok(p1.next);
  const p2 = await D.req("GET", `/api/communities/${cid}/posts?before=${encodeURIComponent(p1.next)}`); assert.equal(p2.posts.length, 4); assert.equal(p2.next, null);
  const ids = [...p1.posts, ...p2.posts].map(p => p.id); assert.equal(new Set(ids).size, 34);
});
