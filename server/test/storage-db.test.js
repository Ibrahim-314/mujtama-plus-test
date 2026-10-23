/* Database-backed storage (STORAGE_DRIVER=db, migration 013): uploads survive a redeploy (server re-created
 * with an empty STORAGE_DIR), /media/<name> and chat blob downloads keep their URLs, auth rules, Content-Type
 * and Range behaviour, per-file and total caps refuse writes, read-through copies disk-only files into the
 * database without deleting them, and the import script is idempotent and non-destructive.
 * Runs on SQLite (a temp file, so the database outlives the app) or PostgreSQL via TEST_DATABASE_URL. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
const { createApp } = require("../server");
const { connect } = require("../lib/db");
const { createDbStorage } = require("../lib/storage");
const { importMedia } = require("../scripts/import-media");

process.env.LOG_SILENT = "1";
const PG = process.env.TEST_DATABASE_URL;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-sdb-"));
const DB_URL = PG || "sqlite:" + path.join(tmp, "db.sqlite");
const freshDir = () => fs.mkdtempSync(path.join(tmp, "storage-"));
const png = (n = 3000) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(n)]);
const ogg = (n = 2000) => Buffer.concat([Buffer.from("OggS"), crypto.randomBytes(n)]);

let app, base, storageDir;
async function start(dir, extra = {}) {
  storageDir = dir;
  app = await createApp({ databaseUrl: DB_URL, storageDir: dir, storageDriver: "db", fakeVideoMs: 200, seedDemo: false, ...extra });
  await new Promise(r => app.server.listen(0, r));
  base = "http://127.0.0.1:" + app.server.address().port;
}
async function stop() { await app.close(); }
class Client {
  constructor() { this.cookie = ""; }
  async req(method, p, body) {
    const r = await fetch(base + p, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", Cookie: this.cookie, Origin: base }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  }
  async raw(p, buf) { const r = await fetch(base + p, { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/octet-stream", Cookie: this.cookie, Origin: base }, body: buf }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }
  get(p, headers = {}) { return fetch(base + p, { headers: { Cookie: this.cookie, ...headers } }); }
}
const A = new Client(), B = new Client(), C = new Client();
const state = {};

test.before(async () => {
  if (PG) { const { Client: PgClient } = require("pg"); const c = new PgClient({ connectionString: PG }); await c.connect(); await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); await c.end(); }
  await start(freshDir());
  for (const [c, h] of [[A, "sdb_a"], [B, "sdb_b"], [C, "sdb_c"]]) { app.ctx.rl.w.clear(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + h, handle: h, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; }
});
test.after(async () => { await stop(); fs.rmSync(tmp, { recursive: true, force: true }); });
test.beforeEach(() => app.ctx.rl.w.clear());

test("migration 013 created the blobs table and the db driver is active", async () => {
  assert.equal(app.ctx.storage.kind, "db");
  assert.ok((await app.ctx.db.all("SELECT id FROM schema_migrations")).some(r => r.id === "013_blobs"));
  assert.equal((await app.ctx.db.get("SELECT COUNT(*) AS n FROM blobs")).n, 0);
});

test("media upload is stored in the database and served at /media/<name> with type + Range", async () => {
  const img = png(5000);
  const up = await A.raw("/api/media", img); assert.equal(up.status, 200, up.error);
  assert.match(up.media.url, /^\/media\/md_[\w]+\.png$/);
  const key = up.media.url.slice(7); state.img = { key, img };
  const row = await app.ctx.db.get("SELECT size, mime, sha256 FROM blobs WHERE key=$1", [key]);
  assert.equal(row.size, img.length); assert.equal(row.mime, "image/png"); assert.equal(row.sha256, crypto.createHash("sha256").update(img).digest("hex"));
  const r = await A.get(up.media.url);
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png"); assert.equal(r.headers.get("accept-ranges"), "bytes");
  assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable"); assert.equal(+r.headers.get("content-length"), img.length);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(img));
  const part = await A.get(up.media.url, { Range: "bytes=10-99" });
  assert.equal(part.status, 206); assert.equal(part.headers.get("content-range"), `bytes 10-99/${img.length}`);
  assert.ok(Buffer.from(await part.arrayBuffer()).equals(img.subarray(10, 100)));
  const open = await A.get(up.media.url, { Range: "bytes=4000-" });
  assert.equal(open.status, 206); assert.ok(Buffer.from(await open.arrayBuffer()).equals(img.subarray(4000)));
  const bad = await A.get(up.media.url, { Range: `bytes=${img.length + 5}-` }); assert.equal(bad.status, 416); await bad.arrayBuffer();
  assert.equal((await A.get("/media/md_missing_0000.png")).status, 404);
  assert.equal((await A.get("/media/..%2f..%2fetc%2fpasswd")).status, 404);
});

test("chat blobs are stored in the database with unchanged member-only rules", async () => {
  await B.req("PUT", `/api/follows/${A.id}`);
  const cid = (await A.req("POST", "/api/conversations", { user: B.id })).conversation.id;
  const voice = ogg(4000);
  const up = await A.raw(`/api/chat/conversations/${cid}/blobs`, voice); assert.equal(up.status, 200, up.error);
  assert.equal(up.blob.mime, "audio/ogg");
  assert.ok(await app.ctx.db.get("SELECT 1 AS x FROM blobs WHERE key=$1", ["chat/" + up.blob.id]));
  state.chat = { id: up.blob.id, voice, cid };
  const got = await B.get(`/api/chat/blobs/${up.blob.id}`);
  assert.equal(got.status, 200); assert.equal(got.headers.get("content-type"), "audio/ogg"); assert.equal(got.headers.get("cache-control"), "private, max-age=86400");
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(voice));
  assert.equal((await C.get(`/api/chat/blobs/${up.blob.id}`)).status, 403, "outsider");
  assert.equal((await new Client().get(`/api/chat/blobs/${up.blob.id}`)).status, 401, "anonymous");
  assert.equal((await C.get(`/media/${up.blob.id}`)).status, 404, "chat blobs are never reachable through /media/");
  assert.equal((await C.get(`/media/chat%2F${up.blob.id}`)).status, 404);
});

test("redeploy: server re-created with an empty STORAGE_DIR still serves media and chat blobs", async () => {
  await stop();
  fs.rmSync(storageDir, { recursive: true, force: true }); // the ephemeral disk is wiped
  await start(freshDir());
  const r = await A.get("/media/" + state.img.key);
  assert.equal(r.status, 200); assert.ok(Buffer.from(await r.arrayBuffer()).equals(state.img.img));
  const g = await B.get(`/api/chat/blobs/${state.chat.id}`);
  assert.equal(g.status, 200); assert.ok(Buffer.from(await g.arrayBuffer()).equals(state.chat.voice));
  assert.equal((await C.get(`/api/chat/blobs/${state.chat.id}`)).status, 403);
  assert.equal(fs.readdirSync(storageDir).filter(f => f !== "chat").length, 0, "served from the database, not from disk");
});

test("deleting a chat message removes its blob row (disappearing content stays gone)", async () => {
  const { cid } = state.chat;
  const up = await A.raw(`/api/chat/conversations/${cid}/blobs`, ogg(500));
  const m = await A.req("POST", `/api/chat/conversations/${cid}/messages`, { kind: "voice", meta: { blob: up.blob.id, duration: 1 } }); assert.equal(m.status, 200, m.error);
  assert.equal((await A.req("DELETE", `/api/chat/messages/${m.message.id}`)).ok, true);
  assert.equal(await app.ctx.db.get("SELECT 1 AS x FROM blobs WHERE key=$1", ["chat/" + up.blob.id]), undefined);
  assert.equal((await B.get(`/api/chat/blobs/${up.blob.id}`)).status, 404);
});

test("read-through: a disk-only file is served, copied into the database, and the disk file is kept", async () => {
  const legacy = png(1200), name = "md_legacyfile01.png";
  fs.writeFileSync(path.join(storageDir, name), legacy);
  assert.equal(await app.ctx.db.get("SELECT 1 AS x FROM blobs WHERE key=$1", [name]), undefined);
  const r = await A.get("/media/" + name, { Range: "bytes=0-15" });
  assert.equal(r.status, 206); assert.ok(Buffer.from(await r.arrayBuffer()).equals(legacy.subarray(0, 16)));
  const row = await app.ctx.db.get("SELECT size FROM blobs WHERE key=$1", [name]); assert.equal(row.size, legacy.length);
  assert.ok(fs.existsSync(path.join(storageDir, name)), "disk file never deleted by read-through");
  // chat attachment written before the switch: chat_blobs row + disk file only
  const bid = "cb_legacy0001", voice = ogg(700);
  await app.ctx.db.run("INSERT INTO chat_blobs(id,conv,owner,mime,size,enc,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [bid, state.chat.cid, A.id, "audio/ogg", voice.length, 0, new Date().toISOString()]);
  fs.mkdirSync(path.join(storageDir, "chat"), { recursive: true }); fs.writeFileSync(path.join(storageDir, "chat", bid), voice);
  assert.equal((await C.get(`/api/chat/blobs/${bid}`)).status, 403, "auth still checked before any read");
  const g = await B.get(`/api/chat/blobs/${bid}`); assert.equal(g.status, 200); assert.equal(g.headers.get("content-type"), "audio/ogg");
  assert.ok(Buffer.from(await g.arrayBuffer()).equals(voice));
  assert.ok(await app.ctx.db.get("SELECT 1 AS x FROM blobs WHERE key=$1", ["chat/" + bid]));
  assert.ok(fs.existsSync(path.join(storageDir, "chat", bid)));
});

test("video pipeline outputs are persisted to the database (persistOutputs) and sources re-materialised (ensureLocal)", async () => {
  const media = app.ctx.services.media, mid = "md_vidtest0001";
  fs.writeFileSync(path.join(storageDir, `${mid}_360.m3u8`), "#EXTM3U\n");
  fs.writeFileSync(path.join(storageDir, `${mid}_360_000.ts`), crypto.randomBytes(900));
  fs.writeFileSync(path.join(storageDir, "md_other_poster.jpg"), "x");
  await media.persistOutputs(mid);
  const keys = (await app.ctx.db.all("SELECT key FROM blobs WHERE key LIKE $1 ORDER BY key", [mid + "%"])).map(r => r.key);
  assert.deepEqual(keys, [`${mid}_360.m3u8`, `${mid}_360_000.ts`]);
  const ts = await A.get(`/media/${mid}_360.m3u8`); assert.equal(ts.status, 200); assert.equal(ts.headers.get("content-type"), require("../lib/http").MIME[".m3u8"] || "application/octet-stream"); await ts.arrayBuffer();
  fs.unlinkSync(path.join(storageDir, `${mid}_360_000.ts`));
  const f = await media.ensureLocal(`${mid}_360_000.ts`); assert.ok(fs.existsSync(f));
});

test("real video (ffmpeg): processed HLS/MP4/poster outputs survive a redeploy", async () => {
  const mp4 = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=640x480:d=2:r=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "-"]);
  const up = await A.raw("/api/media", mp4); assert.equal(up.status, 200, up.error); assert.equal(up.media.kind, "video");
  let m; for (let i = 0; i < 150; i++) { m = (await A.req("GET", "/api/media/" + up.media.id)).media; if (m.status !== "processing") break; await new Promise(r => setTimeout(r, 200)); }
  assert.equal(m.status, "ready");
  await stop(); fs.rmSync(storageDir, { recursive: true, force: true }); await start(freshDir());
  for (const u of [m.variants.master, m.variants.poster, m.variants.hls["360p"], m.variants["360p"], m.variants.original]) {
    const r = await A.get(u); assert.equal(r.status, 200, u); assert.ok((await r.arrayBuffer()).byteLength > 0, u);
  }
  const seg = (await (await A.get(m.variants.hls["360p"])).text()).split("\n").find(l => l.endsWith(".ts"));
  const r = await A.get("/media/" + seg); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), require("../lib/http").MIME[".ts"] || "application/octet-stream"); await r.arrayBuffer();
});

test("caps: per-file and total limits refuse writes with 413; usage is reported", async () => {
  const db = app.ctx.db;
  const s = createDbStorage(storageDir, { db, log: { warn() {}, error() {} }, env: { STORAGE_DB_MAX_FILE_MB: "0.01", STORAGE_DB_MAX_TOTAL_MB: "100" } });
  await assert.rejects(s.put("md_toolarge000.png", png(20000)), e => e.status === 413 && e.code === "file_too_large");
  const { total } = await s.usage();
  const warns = [];
  const t = createDbStorage(storageDir, { db, log: { warn: (m) => warns.push(m), error() {} }, env: { STORAGE_DB_MAX_FILE_MB: "1", STORAGE_DB_MAX_TOTAL_MB: String((total + 6000) / 1048576), STORAGE_DB_WARN_PCT: "50" } });
  await t.put("md_capfill0001.bin", crypto.randomBytes(4000));
  assert.ok(warns.some(w => /warning threshold/.test(w)), "warning logged once over the threshold");
  await assert.rejects(t.put("md_capfill0002.bin", crypto.randomBytes(4000)), e => e.status === 413 && e.code === "storage_full");
  await t.put("md_capfill0001.bin", crypto.randomBytes(4500)); // overwriting counts only the difference
  await t.del("md_capfill0001.bin");
  assert.equal(await t.has("md_capfill0001.bin"), false);
  await assert.rejects(t.put("../escape.png", png(10)), /bad key/);
  // the HTTP layer answers 413 when an upload breaks a cap
  await stop();
  process.env.STORAGE_DB_MAX_FILE_MB = "0.002";
  try {
    await start(storageDir);
    const r = await A.raw("/api/media", png(5000)); assert.equal(r.status, 413); assert.equal(r.code, "file_too_large");
    const cid = state.chat.cid, c = await A.raw(`/api/chat/conversations/${cid}/blobs`, ogg(5000)); assert.equal(c.status, 413);
    assert.equal((await A.raw("/api/media", png(500))).status, 200, "small files still accepted");
  } finally { delete process.env.STORAGE_DB_MAX_FILE_MB; await stop(); await start(storageDir); }
});

test("import script: tar and directory imports are idempotent, verified, and never overwrite or delete", async () => {
  const src = fs.mkdtempSync(path.join(tmp, "old-storage-"));
  const files = { "md_imp00001.png": png(800), "md_imp00002.webp": Buffer.concat([Buffer.from("RIFF0000WEBP"), crypto.randomBytes(300)]), "chat/cb_imp00001": ogg(600), [state.img.key]: Buffer.from("different bytes for an existing key") };
  fs.mkdirSync(path.join(src, "chat"));
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(src, k), v);
  fs.writeFileSync(path.join(src, "bad name!.png"), "x");
  const tarFile = path.join(tmp, "storage.tar");
  execFileSync("tar", ["-cf", tarFile, "-C", src, "."]);
  const before = (await app.ctx.db.all("SELECT key, sha256 FROM blobs")).reduce((m, r) => ({ ...m, [r.key]: r.sha256 }), {});
  const db2 = await connect(DB_URL); // a separate connection, as the CLI uses
  try {
    const s1 = await importMedia({ db: db2, source: tarFile, log: () => {} });
    assert.equal(s1.files, 5); assert.equal(s1.imported, 3); assert.equal(s1.skipped, 1); assert.equal(s1.failed, 1); assert.equal(s1.mismatched, 1);
    assert.equal(s1.bytes, Object.values(files).reduce((n, b) => n + b.length, 0) + 1);
    const s2 = await importMedia({ db: db2, source: tarFile, log: () => {} });
    assert.equal(s2.imported, 0); assert.equal(s2.skipped, 4); assert.equal(s2.failed, 1);
    const s3 = await importMedia({ db: db2, source: src, log: () => {} }); // directory form
    assert.equal(s3.imported, 0); assert.equal(s3.skipped, 4);
    const gz = tarFile + ".gz"; execFileSync("sh", ["-c", `gzip -c "${tarFile}" > "${gz}"`]);
    const s4 = await importMedia({ db: db2, source: gz, log: () => {} }); assert.equal(s4.imported, 0); assert.equal(s4.skipped, 4);
  } finally { await db2.close(); }
  const after = (await app.ctx.db.all("SELECT key, sha256 FROM blobs")).reduce((m, r) => ({ ...m, [r.key]: r.sha256 }), {});
  for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, "existing rows untouched: " + k);
  assert.equal(after["chat/cb_imp00001"], crypto.createHash("sha256").update(files["chat/cb_imp00001"]).digest("hex"));
  for (const k of Object.keys(files)) assert.ok(fs.existsSync(path.join(src, k)), "source files kept");
  const r = await A.get("/media/md_imp00001.png"); assert.equal(r.status, 200); assert.ok(Buffer.from(await r.arrayBuffer()).equals(files["md_imp00001.png"]));
  const orig = await A.get("/media/" + state.img.key); assert.ok(Buffer.from(await orig.arrayBuffer()).equals(state.img.img), "existing key not overwritten");
});

test("default driver is unchanged: without STORAGE_DRIVER=db nothing is written to the blobs table", async () => {
  await stop();
  const dir = freshDir();
  await start(dir, { storageDriver: "local" });
  try {
    assert.equal(app.ctx.storage.kind, "local");
    const n0 = (await app.ctx.db.get("SELECT COUNT(*) AS n FROM blobs")).n;
    const up = await A.raw("/api/media", png(700)); assert.equal(up.status, 200, up.error);
    assert.ok(fs.existsSync(path.join(dir, up.media.url.slice(7))));
    assert.equal((await app.ctx.db.get("SELECT COUNT(*) AS n FROM blobs")).n, n0);
    const r = await A.get(up.media.url, { Range: "bytes=0-7" }); assert.equal(r.status, 206); await r.arrayBuffer();
  } finally { await stop(); await start(freshDir()); }
});
