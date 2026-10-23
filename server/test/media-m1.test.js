/* v2.60 M1 media hotfix (STORAGE_DRIVER=db like production):
 *  · Range: bytes=a-b, bytes=a-, the suffix form bytes=-N (last N bytes), 416, malformed headers ignored, HEAD without a body
 *  · honest per-file limit: GET /api/media/limits = min(upload limit, STORAGE_DB_MAX_FILE_MB), a bigger upload → 413 naming the limit
 *  · a processing job that gives up → media 'failed' + post data status 'failed' (never endless «processing»), retry re-queues it
 *  · no invented duration; real video width/height are kept */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.LOG_SILENT = "1";
process.env.STORAGE_DB_MAX_FILE_MB = "1"; // a small cap so the limit test stays fast (production default: 25)
process.env.MEDIA_MAX_ATTEMPTS = "1"; // a broken video fails on its first attempt in this file (production default: 4)
const { createApp } = require("../server");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-m1-"));
let app, base;
const png = (n) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(n)]);
class Client {
  constructor() { this.cookie = ""; }
  async req(method, p, body) {
    const r = await fetch(base + p, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", Cookie: this.cookie, Origin: base }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  }
  async raw(p, buf) { const r = await fetch(base + p, { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/octet-stream", Cookie: this.cookie, Origin: base }, body: buf }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }
  get(p, headers = {}, method = "GET") { return fetch(base + p, { method, headers: { Cookie: this.cookie, ...headers } }); }
}
const A = new Client(), B = new Client();
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return null; };
test.before(async () => {
  app = await createApp({ databaseUrl: "sqlite:" + path.join(tmp, "db.sqlite"), storageDir: path.join(tmp, "st"), storageDriver: "db", seedDemo: false, queuePollMs: 100 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.server.address().port;
  await A.req("POST", "/api/auth/register", { name: "صاحب الوسائط", handle: "m1owner", password: "secret123" });
  await B.req("POST", "/api/auth/register", { name: "متفرج", handle: "m1viewer", password: "secret123" });
});
test.after(() => app.close());

test("Range on database storage: a-b, a-, suffix -N, 416, malformed, HEAD", async () => {
  assert.equal(app.ctx.storage.kind, "db");
  const img = png(5000), size = img.length;
  const up = await A.raw("/api/media", img); assert.equal(up.status, 200, up.error);
  const u = up.media.url;
  const r01 = await A.get(u, { Range: "bytes=0-1" }); assert.equal(r01.status, 206); assert.equal(r01.headers.get("content-range"), `bytes 0-1/${size}`); assert.equal((await r01.arrayBuffer()).byteLength, 2);
  const open = await A.get(u, { Range: "bytes=0-" }); assert.equal(open.status, 206); assert.equal(open.headers.get("content-range"), `bytes 0-${size - 1}/${size}`); assert.ok(Buffer.from(await open.arrayBuffer()).equals(img));
  // the bug: bytes=-500 used to answer bytes 0-500
  const suf = await A.get(u, { Range: "bytes=-500" }); assert.equal(suf.status, 206);
  assert.equal(suf.headers.get("content-range"), `bytes ${size - 500}-${size - 1}/${size}`); assert.equal(suf.headers.get("content-length"), "500");
  assert.ok(Buffer.from(await suf.arrayBuffer()).equals(img.subarray(size - 500)), "suffix range returns the LAST 500 bytes");
  const big = await A.get(u, { Range: `bytes=-${size + 999}` }); assert.equal(big.status, 206); assert.equal(big.headers.get("content-range"), `bytes 0-${size - 1}/${size}`); await big.arrayBuffer();
  const mid = await A.get(u, { Range: "bytes=500-" }); assert.equal(mid.status, 206); assert.equal(mid.headers.get("content-range"), `bytes 500-${size - 1}/${size}`); await mid.arrayBuffer();
  const zero = await A.get(u, { Range: "bytes=-0" }); assert.equal(zero.status, 416); assert.equal(zero.headers.get("content-range"), `bytes */${size}`); await zero.arrayBuffer();
  const past = await A.get(u, { Range: `bytes=${size}-` }); assert.equal(past.status, 416); await past.arrayBuffer();
  const bad = await A.get(u, { Range: "bytes=50-10" }); assert.equal(bad.status, 200, "an invalid range is ignored"); assert.equal((await bad.arrayBuffer()).byteLength, size);
  const junk = await A.get(u, { Range: "items=0-5" }); assert.equal(junk.status, 200); await junk.arrayBuffer();
  const head = await A.get(u, {}, "HEAD"); assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(size)); assert.equal(head.headers.get("content-type"), "image/png"); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const headR = await A.get(u, { Range: "bytes=-100" }, "HEAD"); assert.equal(headR.status, 206); assert.equal(headR.headers.get("content-range"), `bytes ${size - 100}-${size - 1}/${size}`); await headR.arrayBuffer();
  // unit: the parser itself
  const pr = app.ctx.services.media.parseRange;
  assert.deepEqual(pr("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(pr("bytes=0-9,20-29", 100), { start: 0, end: 9 }, "multi-range → first range");
  assert.equal(pr("bytes=-", 100), null); assert.deepEqual(pr("bytes=200-", 100), { unsat: true });
});

test("honest limits: /api/media/limits follows the storage cap; a bigger upload is refused with the limit named", async () => {
  const l = await A.req("GET", "/api/media/limits"); assert.equal(l.status, 200);
  assert.equal(l.limits.video, 1024 * 1024); assert.equal(l.limits.image, 1024 * 1024); assert.equal(l.limits.audio, 1024 * 1024);
  const tooBig = await A.raw("/api/media", png(1024 * 1024 + 10)); assert.equal(tooBig.status, 413); assert.equal(tooBig.code, "file_too_large"); assert.match(tooBig.error, /1 ميغابايت/);
  assert.equal((await new Client().req("GET", "/api/media/limits")).status, 401);
});

test("a video whose processing gives up is marked failed (post shows it to the author) and can be retried", async () => {
  const broken = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), crypto.randomBytes(4000)]); // mp4 signature, not a video
  const up = await A.raw("/api/media", broken); assert.equal(up.status, 200, up.error); assert.equal(up.media.kind, "video");
  const post = (await A.req("POST", "/api/posts", { type: "video", text: "فيديو تالف", video: { mediaId: up.media.id } })).post; assert.equal(post.status, "processing");
  const failed = await until(async () => { const m = (await A.req("GET", "/api/media/" + up.media.id)).media; return m.status === "failed" ? m : null; });
  assert.ok(failed, "media becomes failed, not processing forever"); assert.equal(failed.variants.error, "processing");
  const mine = (await A.req("GET", "/api/posts/" + post.id)).post; assert.equal(mine.status, "processing"); assert.equal(mine.video.status, "failed");
  assert.notEqual((await B.req("GET", "/api/posts/" + post.id)).status, 200, "still visible only to its author");
  assert.equal((await B.req("POST", `/api/media/${up.media.id}/retry`)).status, 404, "only the owner retries");
  const rt = await A.req("POST", `/api/media/${up.media.id}/retry`); assert.equal(rt.status, 200, rt.error); assert.equal(rt.media.status, "processing");
  const again = (await A.req("GET", "/api/posts/" + post.id)).post; assert.equal(again.video.status, "processing");
  assert.ok(await until(async () => (await A.req("GET", "/api/media/" + up.media.id)).media.status === "failed"), "a retry that fails again lands on failed again");
});

test("a real video: no invented duration, real width/height kept on the post", async () => {
  const f = path.join(tmp, "v.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=15", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", f]);
  const up = await A.raw("/api/media", fs.readFileSync(f)); assert.equal(up.status, 200, up.error);
  const post = (await A.req("POST", "/api/posts", { type: "video", text: "فيديو عمودي حقيقي", video: { mediaId: up.media.id } })).post;
  const done = await until(async () => { const p = (await A.req("GET", "/api/posts/" + post.id)).post; return p.status === "published" ? p : null; }, 60000);
  assert.ok(done, "published after processing");
  assert.equal(done.video.duration, 2); assert.equal(done.video.width, 360); assert.equal(done.video.height, 640); assert.equal(done.video.variants.height, 640);
  // a video post without a real file never gets a random duration
  const fake = (await A.req("POST", "/api/posts", { type: "video", text: "بلا ملف", media: "linear-gradient(135deg,#111111,#222222)" })).post;
  const fp = await until(async () => { const p = (await A.req("GET", "/api/posts/" + fake.id)).post; return p.status === "published" ? p : null; }, 15000);
  assert.ok(fp); assert.ok(!fp.video.duration, "unknown duration stays unknown (was 30–120 s random)");
});
