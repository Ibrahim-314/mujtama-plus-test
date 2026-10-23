/* v2.70 — resumable video upload backed by upload_sessions (migration 072): a real small MP4 split into 64 KB chunks
 * (MEDIA_CHUNK_MB override), out-of-order + idempotent chunks, resume via GET received, wrong owner 403, oversize rejected
 * up front, complete → the same media item as POST /api/media (same ingest), session row lifecycle + 24 h expiry sweep,
 * migration 072 down/up. SQLite (or TEST_DATABASE_URL for PostgreSQL). */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.LOG_SILENT = "1"; process.env.MEDIA_CHUNK_MB = String(64 / 1024);
const { createApp } = require("../server");
const mig = require("../lib/migrations");
const m072 = require("../migrations/072_upload_sessions");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-v270up-"));
const PORT = 7600 + Math.floor(Math.random() * 100);
let app, base;
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const A = { cookie: "" }, B = { cookie: "" };
const db = () => app.ctx.db;
const req = async (who, method, p, body, raw) => {
  const h = { "X-Requested-With": "mujtama", "Content-Type": raw ? "application/octet-stream" : "application/json", Cookie: who.cookie, Origin: base };
  const r = await fetch(base + p, { method, headers: h, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) who.cookie = sc.split(";")[0];
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const parts = (buf, cs) => { const out = []; for (let o = 0; o < buf.length; o += cs) out.push(buf.subarray(o, o + cs)); return out; };
const put = (who, up, i, buf) => req(who, "PUT", `/api/media/uploads/${up.uploadId}/chunk?index=${i}`, buf, true);
let clip = null;
function smallMp4() {
  if (clip) return clip;
  if (!hasFfmpeg) return Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), crypto.randomBytes(300 * 1024)]); // ftyp magic
  const f = path.join(tmp, "v.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x240:d=3:r=15", "-vf", "noise=alls=40:allf=t", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", f]);
  const b = fs.readFileSync(f); assert.ok(b.length > 200 * 1024, "clip spans several 64 KB chunks"); return (clip = b);
}
async function hasTable(name) {
  if (db().dialect === "postgres") return !!(await db().get("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name=$1", [name]));
  return !!(await db().get("SELECT name FROM sqlite_master WHERE type='table' AND name=$1", [name]));
}
const exec = async (sql) => { for (const s of mig.render(sql, db().dialect).split(";").map(x => x.trim()).filter(Boolean)) await db().exec(s); };

test.before(async () => {
  if (process.env.TEST_DATABASE_URL) { const { Client } = require("pg"); const c = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await c.connect(); await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); await c.end(); }
  app = await createApp({ databaseUrl: process.env.TEST_DATABASE_URL || "sqlite:" + path.join(tmp, "db.sqlite"), storageDir: path.join(tmp, "st"), seedDemo: false, queuePollMs: 100 });
  await new Promise((res, rej) => { app.server.once("error", rej); app.server.listen(PORT, "127.0.0.1", res); }); base = "http://127.0.0.1:" + PORT;
  app.ctx.rl.w?.clear?.();
  await req(A, "POST", "/api/auth/register", { name: "رافع الفيديو", handle: "v270up_a", password: "secret123" });
  await req(B, "POST", "/api/auth/register", { name: "غريب", handle: "v270up_b", password: "secret123" });
});
test.after(() => app.close());

test("chunked MP4: out-of-order + duplicate chunks, resume via GET received, complete → same media as POST /api/media", async () => {
  const src = smallMp4();
  const init = await req(A, "POST", "/api/media/uploads", { filename: "clip.mp4", mime: "video/mp4", size: src.length });
  assert.equal(init.status, 200, JSON.stringify(init)); const up = init.upload;
  assert.equal(up.chunkSize, 64 * 1024, "test override of the chunk size"); assert.ok(up.totalChunks >= 3);
  const row = await db().get("SELECT owner, mime, kind, size, chunk_size, total_chunks, status, received, expires_at FROM upload_sessions WHERE id=$1", [up.uploadId]);
  assert.ok(row, "session persisted in upload_sessions"); assert.equal(row.mime, "video/mp4"); assert.equal(row.kind, "video"); assert.equal(Number(row.size), src.length);
  assert.equal(Number(row.total_chunks), up.totalChunks); assert.equal(row.status, "open"); assert.deepEqual(JSON.parse(row.received), []);
  const ttl = new Date(row.expires_at).getTime() - Date.now(); assert.ok(ttl > 23 * 3600e3 && ttl <= 24 * 3600e3 + 5e3, "expires 24 h out");

  const ps = parts(src, up.chunkSize), last = ps.length - 1;
  // a "network drop" after sending the last and the first chunk, out of order; chunk 0 sent twice (a retried request)
  assert.equal((await put(A, up, last, ps[last])).status, 200);
  assert.equal((await put(A, up, 0, ps[0])).status, 200);
  assert.equal((await put(A, up, 0, ps[0])).status, 200);
  const st = await req(A, "GET", `/api/media/uploads/${up.uploadId}`);
  assert.equal(st.status, 200); assert.deepEqual(st.upload.received, [0, last]);
  assert.deepEqual(st.upload.missing, [...ps.keys()].filter(i => i !== 0 && i !== last));
  assert.deepEqual(JSON.parse((await db().get("SELECT received FROM upload_sessions WHERE id=$1", [up.uploadId])).received), [0, last], "row tracks received");
  const early = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(early.status, 409); assert.equal(early.code, "missing_chunks");
  // resume: send only what is missing, in reverse
  for (const i of [...st.upload.missing].reverse()) assert.equal((await put(A, up, i, ps[i])).status, 200);
  const done = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.equal(done.media.kind, "video"); assert.equal(done.media.status, "processing"); assert.match(done.media.id, /^md/); assert.match(done.media.url, /^\/media\/md.+\.mp4$/);
  assert.deepEqual(Object.keys(done.media).sort(), ["id", "kind", "status", "url"], "same media object shape as POST /api/media for a video");
  const served = Buffer.from(await (await fetch(base + done.media.url, { headers: { Cookie: A.cookie } })).arrayBuffer());
  assert.ok(served.equals(src), "assembled byte-for-byte");
  const mrow = await db().get("SELECT owner, kind, mime, size FROM media WHERE id=$1", [done.media.id]);
  assert.equal(mrow.kind, "video"); assert.equal(mrow.mime, "video/mp4"); assert.equal(Number(mrow.size), src.length);
  const s2 = await db().get("SELECT status, media_id FROM upload_sessions WHERE id=$1", [up.uploadId]);
  assert.equal(s2.status, "done"); assert.equal(s2.media_id, done.media.id);
  assert.deepEqual(fs.readdirSync(path.join(tmp, "st", "tmp", "uploads", up.uploadId)).filter(f => f.includes(".part")), [], "temp chunks deleted");
  const again = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(again.status, 200); assert.equal(again.media.id, done.media.id, "retried complete is idempotent");
  // let the processing job settle so it does not outlive the app
  let s = "processing"; for (let t = 0; t < 300 && s === "processing"; t++) { await new Promise(r => setTimeout(r, 100)); s = (await db().get("SELECT status FROM media WHERE id=$1", [done.media.id])).status; }
  if (hasFfmpeg) assert.equal(s, "ready", "a real clip goes through the same processing path");
});

test("same validation as POST /api/media: a non-video body declared as video/mp4 is rejected at complete", async () => {
  const junk = crypto.randomBytes(70 * 1024); junk.write("NOTAVIDEO", 0, "latin1");
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "fake.mp4", mime: "video/mp4", size: junk.length });
  for (const [i, c] of parts(junk, up.chunkSize).entries()) assert.equal((await put(A, up, i, c)).status, 200);
  const r = await req(A, "POST", `/api/media/uploads/${up.uploadId}/complete`);
  assert.equal(r.status, 400, "magic-byte validation from the shared ingest()");
});

test("wrong owner → 403 on GET / PUT / complete; unknown → 404; nothing stored", async () => {
  const src = smallMp4().subarray(0, 100 * 1024);
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "mine.mp4", mime: "video/mp4", size: src.length });
  assert.equal((await req(B, "GET", `/api/media/uploads/${up.uploadId}`)).status, 403);
  assert.equal((await put(B, up, 0, src.subarray(0, up.chunkSize))).status, 403);
  assert.equal((await req(B, "POST", `/api/media/uploads/${up.uploadId}/complete`)).status, 403);
  assert.equal((await req(B, "GET", "/api/media/uploads/up_000000000000000000000000")).status, 404);
  assert.deepEqual((await req(A, "GET", `/api/media/uploads/${up.uploadId}`)).upload.received, []);
});

test("oversize rejected up front (413, no session row); chunk larger than chunkSize rejected", async () => {
  const { limits } = await req(A, "GET", "/api/media/limits");
  const before = Number((await db().get("SELECT COUNT(*) AS n FROM upload_sessions")).n);
  const big = await req(A, "POST", "/api/media/uploads", { filename: "huge.mp4", mime: "video/mp4", size: limits.video + 1 });
  assert.equal(big.status, 413); assert.equal(big.code, "file_too_large");
  assert.equal(Number((await db().get("SELECT COUNT(*) AS n FROM upload_sessions")).n), before, "no row for a rejected init");
  const src = smallMp4().subarray(0, 140 * 1024);
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "s.mp4", mime: "video/mp4", size: src.length });
  const over = await put(A, up, 0, Buffer.concat([src.subarray(0, up.chunkSize), Buffer.alloc(up.chunkSize)])).catch(() => ({ status: 413 }));
  assert.equal(over.status, 413);
});

test("24 h expiry: the sweep deletes the row and the temp chunks; the session then reads 404", async () => {
  const src = smallMp4().subarray(0, 100 * 1024);
  const { upload: up } = await req(A, "POST", "/api/media/uploads", { filename: "old.mp4", mime: "video/mp4", size: src.length });
  assert.equal((await put(A, up, 0, src.subarray(0, up.chunkSize))).status, 200);
  const dir = path.join(tmp, "st", "tmp", "uploads", up.uploadId); assert.ok(fs.existsSync(path.join(dir, "0.part")));
  const n = await app.ctx.services.media.sweepUploads(Date.now() + 24 * 3600e3 + 60e3);
  assert.ok(n >= 1); assert.ok(!fs.existsSync(dir), "temp chunks deleted");
  assert.equal(await db().get("SELECT id FROM upload_sessions WHERE id=$1", [up.uploadId]), undefined, "row deleted");
  assert.equal((await req(A, "GET", `/api/media/uploads/${up.uploadId}`)).status, 404);
  // a row whose expires_at has passed (clock-only, files still on disk) is also 404 and cleaned on access
  const { upload: u2 } = await req(A, "POST", "/api/media/uploads", { filename: "old2.mp4", mime: "video/mp4", size: src.length });
  await db().run("UPDATE upload_sessions SET expires_at=$1 WHERE id=$2", [new Date(Date.now() - 1000).toISOString(), u2.uploadId]);
  assert.equal((await req(A, "GET", `/api/media/uploads/${u2.uploadId}`)).status, 404);
  assert.equal(await db().get("SELECT id FROM upload_sessions WHERE id=$1", [u2.uploadId]), undefined);
});

test("migration 072: additive, re-run no-op, down drops only upload_sessions, up again works", async () => {
  assert.ok(await hasTable("upload_sessions"));
  const stmts = []; await m072.up({ dialect: "postgres" }, async (sql) => { for (const s of mig.render(sql, "postgres").split(";").map(x => x.trim()).filter(Boolean)) stmts.push(s); });
  for (const s of stmts) assert.match(s.replace(/\s+/g, " "), /^CREATE (TABLE|INDEX) IF NOT EXISTS /, "additive only");
  await m072.up(db(), exec); // re-run: no-op
  const media = Number((await db().get("SELECT COUNT(*) AS n FROM media")).n);
  await m072.down(db(), exec);
  assert.ok(!(await hasTable("upload_sessions")));
  assert.equal(Number((await db().get("SELECT COUNT(*) AS n FROM media")).n), media, "media rows untouched");
  await m072.up(db(), exec);
  assert.ok(await hasTable("upload_sessions"));
  const init = await req(A, "POST", "/api/media/uploads", { filename: "after.mp4", mime: "video/mp4", size: 70 * 1024 });
  assert.equal(init.status, 200); assert.ok(await db().get("SELECT id FROM upload_sessions WHERE id=$1", [init.upload.uploadId]));
});
