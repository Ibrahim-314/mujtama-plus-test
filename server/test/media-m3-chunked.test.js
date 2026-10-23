/* v2.60 M3 — resumable chunked uploads (server). STORAGE_DRIVER=db like production; 64 KB chunks so small files span many parts. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.LOG_SILENT = "1"; process.env.MEDIA_CHUNK_MB = String(64 / 1024);
const { createApp } = require("../server");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-m3-"));
let app, base;
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const A = { cookie: "" }, B = { cookie: "" }, V = { cookie: "" };
const req = async (who, method, p, body, raw, extra = {}) => {
  const h = { "X-Requested-With": "mujtama", "Content-Type": raw ? "application/octet-stream" : "application/json", Cookie: who.cookie, Origin: base, ...extra };
  const r = await fetch(base + p, { method, headers: h, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) who.cookie = sc.split(";")[0];
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const fetchBuf = async (u) => Buffer.from(await (await fetch(base + u, { headers: { Cookie: A.cookie } })).arrayBuffer());
const parts = (buf, cs) => { const out = []; for (let o = 0; o < buf.length; o += cs) out.push(buf.subarray(o, o + cs)); return out; };
/** noisy JPEG (~150 KB+) with a comment segment that must be stripped */
function leakyJpeg() {
  const f = path.join(tmp, "n.jpg");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "nullsrc=s=480x360,geq=random(1)*255:128:128", "-frames:v", "1", "-q:v", "1", f]);
  const j = fs.readFileSync(f), com = Buffer.from("LEAKY-GPS-21.5N", "latin1"), len = Buffer.alloc(2); len.writeUInt16BE(com.length + 2);
  return Buffer.concat([j.subarray(0, 2), Buffer.from([0xff, 0xfe]), len, com, j.subarray(2)]);
}
async function sendAll(who, up, buf, skip = []) { for (const [i, c] of parts(buf, up.chunkSize).entries()) if (!skip.includes(i)) { const r = await req(who, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=${i}`, c, true); assert.equal(r.status, 200, JSON.stringify(r)); } }

test.before(async () => {
  app = await createApp({ databaseUrl: "sqlite:" + path.join(tmp, "db.sqlite"), storageDir: path.join(tmp, "st"), storageDriver: "db", seedDemo: false, queuePollMs: 100 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r)); base = "http://127.0.0.1:" + app.server.address().port;
  await req(A, "POST", "/api/auth/register", { name: "صاحب الرفع", handle: "m3owner", password: "secret123" });
  await req(B, "POST", "/api/auth/register", { name: "غريب", handle: "m3other", password: "secret123" });
});
test.after(() => app.close());

test("full chunked image upload → same pipeline as POST /api/media (EXIF/comment stripped, dims), temp parts removed", { skip: !hasFfmpeg && "ffmpeg missing" }, async () => {
  const src = leakyJpeg();
  const init = await req(A, "POST", "/api/media/uploads", { filename: "photo.jpg", mime: "image/jpeg", size: src.length });
  assert.equal(init.status, 200); const up = init.upload;
  assert.match(up.uploadId, /^up_[a-f0-9]{24}$/); assert.equal(up.chunkSize, 64 * 1024); assert.equal(up.totalChunks, Math.ceil(src.length / up.chunkSize)); assert.ok(up.totalChunks >= 2);
  // out of order is fine
  const ps = parts(src, up.chunkSize);
  for (const i of [...ps.keys()].reverse()) assert.equal((await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=${i}`, ps[i], true)).status, 200);
  const done = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.equal(done.media.kind, "image"); assert.equal(done.media.status, "ready"); assert.equal(done.media.width, 480); assert.equal(done.media.height, 360);
  const served = await fetchBuf(done.media.url);
  assert.equal(served[0], 0xff); assert.ok(!served.toString("latin1").includes("LEAKY-GPS"), "comment segment stripped like POST /api/media");
  const dir = path.join(tmp, "st", "tmp", "uploads", up.uploadId);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes(".part")), [], "chunk parts deleted after complete");
  // a retried complete is idempotent (same media, no second row)
  const again = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(again.status, 200); assert.equal(again.media.id, done.media.id);
  // the old single-request endpoint still works unchanged
  const one = await req(A, "POST", "/api/media", src, true);
  assert.equal(one.status, 200); assert.equal(one.media.kind, "image"); assert.equal(one.media.width, 480);
});

test("full chunked video upload → stored byte-for-byte and queued for processing", async () => {
  let src;
  if (hasFfmpeg) { const f = path.join(tmp, "v.mp4"); execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x240:d=3:r=15", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", f]); src = fs.readFileSync(f); }
  else src = Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), crypto.randomBytes(200 * 1024)]);
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "clip.mp4", mime: "video/mp4", size: src.length });
  await sendAll(A, up, src);
  const done = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done)); assert.equal(done.media.kind, "video"); assert.equal(done.media.status, "processing");
  assert.ok((await fetchBuf(done.media.url)).equals(src), "assembled file identical to the source");
  const row = await app.ctx.db.get("SELECT owner, size FROM media WHERE id=$1", [done.media.id]);
  assert.equal(row.size, src.length);
  const job = await app.ctx.db.get("SELECT kind FROM media_jobs WHERE payload LIKE $1", ["%" + done.media.id + "%"]);
  assert.equal(job.kind, "video");
  // let the worker finish (it must not outlive the app); with ffmpeg a real clip becomes ready
  let st = "processing"; for (let t = 0; t < 300 && st === "processing"; t++) { await new Promise(r => setTimeout(r, 100)); st = (await app.ctx.db.get("SELECT status FROM media WHERE id=$1", [done.media.id])).status; }
  if (hasFfmpeg) assert.equal(st, "ready");
});

test("resume after a missing chunk: status lists it, complete is 409 until it arrives", async () => {
  const src = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(3 * 64 * 1024 + 500)]); // PNG magic, 4 parts
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "a.png", mime: "image/png", size: src.length });
  assert.equal(up.totalChunks, 4);
  await sendAll(A, up, src, [1, 3]);
  const st = await req(A, "GET", `/api/media/uploads/${up.uploadId}`);
  assert.equal(st.status, 200); assert.deepEqual(st.upload.received, [0, 2]); assert.deepEqual(st.upload.missing, [1, 3]); assert.ok(Date.parse(st.upload.expiresAt) > Date.now());
  const early = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(early.status, 409); assert.equal(early.code, "missing_chunks"); assert.deepEqual(early.missing, [1, 3]);
  const ps = parts(src, up.chunkSize);
  for (const i of st.upload.missing) assert.equal((await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=${i}`, ps[i], true)).status, 200);
  assert.deepEqual((await req(A, "GET", `/api/media/uploads/${up.uploadId}`)).upload.missing, []);
  const done = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done)); assert.equal(done.media.kind, "image");
  const chunkAfter = await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=0`, ps[0], true);
  assert.equal(chunkAfter.status, 409);
});

test("duplicate chunk is idempotent; wrong-size / out-of-range chunks rejected", async () => {
  const src = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(100 * 1024)]); // image: no worker job outlives the test
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "d.png", mime: "image/png", size: src.length });
  const ps = parts(src, up.chunkSize);
  const a = await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=0`, ps[0], true);
  const b = await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=0`, ps[0], true);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(b.chunk.received, 1);
  assert.deepEqual((await req(A, "GET", `/api/media/uploads/${up.uploadId}`)).upload.received, [0]);
  assert.equal((await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=1`, ps[1].subarray(1), true)).status, 400, "last part must be its exact size");
  assert.equal((await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=2`, ps[1], true)).status, 400, "index out of range");
  assert.equal((await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=x`, ps[1], true)).status, 400);
  // over the chunk size: the body read is capped early (413, or the socket is cut mid-body like POST /api/media's cap)
  const over = await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=0`, Buffer.concat([ps[0], ps[1], ps[1]]), true).catch(() => ({ status: 413 }));
  assert.equal(over.status, 413, "over chunk size");
  assert.deepEqual((await req(A, "GET", `/api/media/uploads/${up.uploadId}`)).upload.received, [0], "oversize part not stored");
  await req(A, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=1`, ps[1], true);
  const done = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(done.status, 200); assert.ok((await fetchBuf(done.media.url)).equals(src));
});

test("init enforces the real limits (GET /api/media/limits): oversize 413, bad type/size 400", async () => {
  const { limits } = await req(A, "GET", "/api/media/limits");
  const big = await req(A, "POST", "/api/media/uploads", { filename: "big.jpg", mime: "image/jpeg", size: limits.image + 1 });
  assert.equal(big.status, 413); assert.equal(big.code, "file_too_large");
  const bigV = await req(A, "POST", "/api/media/uploads", { filename: "big.mp4", mime: "video/mp4", size: limits.video + 1 });
  assert.equal(bigV.status, 413);
  assert.equal((await req(A, "POST", "/api/media/uploads", { filename: "x.exe", mime: "application/x-msdownload", size: 1000 })).status, 400);
  assert.equal((await req(A, "POST", "/api/media/uploads", { filename: "x.jpg", mime: "image/jpeg", size: -5 })).status, 400);
  assert.equal((await req(A, "POST", "/api/media/uploads", { filename: "x.jpg", mime: "image/jpeg", size: "1e3" })).status, 200, "numeric strings are accepted");
});

test("owner-only (others 403 since v2.70), visitors 401, CSRF header required", async () => {
  const src = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(1000)]);
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "p.png", mime: "image/png", size: src.length });
  assert.equal((await req(B, "GET", `/api/media/uploads/${up.uploadId}`)).status, 403);
  assert.equal((await req(B, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=0`, src, true)).status, 403);
  assert.equal((await req(B, "POST", `/api/media/uploads/${up.uploadId}/complete`)).status, 403);
  assert.equal((await req(A, "GET", "/api/media/uploads/up_000000000000000000000000")).status, 404);
  assert.equal((await req(A, "GET", "/api/media/uploads/..%2F..%2Fdb")).status, 404);
  assert.equal((await req(V, "POST", "/api/media/uploads", { filename: "p.png", mime: "image/png", size: 100 })).status, 401);
  assert.equal((await req(V, "GET", `/api/media/uploads/${up.uploadId}`)).status, 401);
  const noCsrf = await fetch(base + `/api/media/uploads/${up.uploadId}/chunk?index=0`, { method: "PUT", headers: { Cookie: A.cookie, "Content-Type": "application/octet-stream" }, body: src });
  assert.equal(noCsrf.status, 403);
  assert.deepEqual((await req(A, "GET", `/api/media/uploads/${up.uploadId}`)).upload.received, [], "nothing stored by the rejected requests");
});

test("abandoned uploads expire: sweep removes them and they read as 404", async () => {
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "old.png", mime: "image/png", size: 5000 });
  const store = app.ctx.services.media.chunks;
  const dir = path.join(store.dir, up.uploadId); assert.ok(fs.existsSync(dir));
  fs.mkdirSync(path.join(store.dir, "junk-dir")); const old = (Date.now() - store.ttlMs - 60e3) / 1000; fs.utimesSync(path.join(store.dir, "junk-dir"), old, old);
  const n = store.sweep(Date.now() + store.ttlMs + 60e3);
  assert.ok(n >= 2); assert.ok(!fs.existsSync(dir)); assert.ok(!fs.existsSync(path.join(store.dir, "junk-dir")));
  assert.equal((await req(A, "GET", `/api/media/uploads/${up.uploadId}`)).status, 404);
  // the temp dir is never served as media
  assert.equal((await fetch(base + "/media/tmp")).status, 404);
});
