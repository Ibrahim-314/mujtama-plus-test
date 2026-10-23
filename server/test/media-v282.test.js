/* v2.82 media: trim before publish (re-cut from the untouched original), MEDIA_SKIP_MP4_WHEN_HLS=0 keeps the legacy 720p MP4,
 * admin storage panel (totals + orphan dry run → confirmed cleanup that never touches referenced media). Real ffmpeg, db store. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.LOG_SILENT = "1";
process.env.MEDIA_MAX_ATTEMPTS = "1";
const { createApp } = require("../server");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-v282-"));
let app, base, cookie = "";
const req = async (method, p, body, raw) => {
  const r = await fetch(base + p, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": raw ? "application/octet-stream" : "application/json", Cookie: cookie, Origin: base }, body: raw || (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const until = async (fn, ms = 90000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };
function clip(name, w, h, secs) {
  const f = path.join(tmp, name);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=30:duration=${secs}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-shortest", f]);
  return fs.readFileSync(f);
}
const settled = (mid) => until(async () => { const r = await req("GET", "/api/media/" + mid); return r.media && r.media.status !== "processing" ? r.media : null; });
test.before(async () => {
  app = await createApp({ databaseUrl: "sqlite:" + path.join(tmp, "db.sqlite"), storageDir: path.join(tmp, "st"), storageDriver: "db", seedDemo: false, queuePollMs: 100 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.server.address().port;
  await req("POST", "/api/auth/register", { name: "قصّاص المقاطع", handle: "v282trim", password: "secret123" });
});
test.after(() => app.close());

test("validTrim: rounding, minimum 1 s, bad input", () => {
  const V = app.ctx.services.media.validTrim;
  assert.deepEqual(V({ start: 1.04, end: 3.26 }), { start: 1, end: 3.3 });
  assert.equal(V({ start: 2, end: 2.5 }), null); assert.equal(V({ start: -1, end: 3 }), null); assert.equal(V({ start: "x", end: 3 }), null); assert.equal(V(null), null);
});

test("trim: a ready 6 s video re-processes to the 2–5 s range; original kept; clearing the trim restores the full length", async () => {
  const src = clip("t.mp4", 640, 480, 6);
  const up = await req("POST", "/api/media", null, src); assert.equal(up.status, 200);
  let m = await settled(up.media.id); assert.equal(m.status, "ready"); assert.equal(m.variants.duration, 6);
  const bad = await req("POST", `/api/media/${m.id}/trim`, { start: 3, end: 3.4 }); assert.equal(bad.status, 400);
  const t = await req("POST", `/api/media/${m.id}/trim`, { start: 2, end: 5 }); assert.equal(t.status, 200, t.error); assert.equal(t.media.status, "processing");
  m = await settled(m.id); assert.equal(m.status, "ready", JSON.stringify(m.variants));
  assert.deepEqual(m.variants.trim, { start: 2, end: 5 }); assert.equal(m.variants.duration, 3);
  assert.ok(fs.existsSync(path.join(tmp, "st", path.basename(m.variants.original))), "original untouched");
  assert.equal(fs.statSync(path.join(tmp, "st", path.basename(m.variants.original))).size, src.length);
  assert.ok(!fs.readdirSync(path.join(tmp, "st")).some(f => f.endsWith("_trimsrc.mp4")), "working cut removed");
  const same = await req("POST", `/api/media/${m.id}/trim`, { start: 2, end: 5 }); assert.equal(same.media.status, "ready", "same trim = no re-process");
  const clear = await req("POST", `/api/media/${m.id}/trim`, {}); assert.equal(clear.media.status, "processing");
  m = await settled(m.id); assert.equal(m.variants.trim, undefined); assert.equal(m.variants.duration, 6);
  // someone else's media → 404
  const c0 = cookie; cookie = ""; await req("POST", "/api/auth/register", { name: "آخر", handle: "v282other", password: "secret123" });
  assert.equal((await req("POST", `/api/media/${m.id}/trim`, { start: 1, end: 3 })).status, 404); cookie = c0;
  // once the video is live in a published post it can no longer be re-cut
  const p = await req("POST", "/api/posts", { type: "video", visibility: "public", text: "قص", video: { mediaId: m.id } });
  assert.equal(p.status, 200, p.error);
  const late = await req("POST", `/api/media/${m.id}/trim`, { start: 1, end: 3 }); assert.equal(late.status, 409); assert.equal(late.code || late.body?.code || "already_published", "already_published");
});

test("MEDIA_SKIP_MP4_WHEN_HLS=0 keeps the legacy 720p MP4", async () => {
  process.env.MEDIA_SKIP_MP4_WHEN_HLS = "0";
  try {
    const up = await req("POST", "/api/media", null, clip("l.mp4", 1280, 960, 3));
    const m = await settled(up.media.id); assert.equal(m.status, "ready");
    assert.ok(m.variants["720p"]); assert.equal(m.variants["360p"], undefined); assert.equal(m.variants.mp4Policy, undefined);
  } finally { delete process.env.MEDIA_SKIP_MP4_WHEN_HLS; }
});

test("admin storage: totals, orphan dry run, confirmed cleanup keeps referenced media", async () => {
  const db = app.ctx.db;
  const c0 = cookie; cookie = ""; await req("POST", "/api/auth/register", { name: "عضو عادي", handle: "v282plain", password: "secret123" });
  assert.equal((await req("GET", "/api/admin/storage")).status, 403, "admin only"); cookie = c0;
  const me = await req("GET", "/api/me"); await db.run("UPDATE users SET role='admin' WHERE id=$1", [me.user.id]);
  const old = new Date(Date.now() - 9 * 864e5).toISOString();
  // two old videos: one referenced by a post, one not; plus a loose file whose media row does not exist
  const a = await settled((await req("POST", "/api/media", null, clip("a.mp4", 320, 240, 2))).media.id);
  const b = await settled((await req("POST", "/api/media", null, clip("b.mp4", 320, 240, 2))).media.id);
  await db.run("UPDATE media SET created_at=$1 WHERE id IN ($2,$3)", [old, a.id, b.id]);
  await db.run("INSERT INTO posts(id,author,type,text,data,status,created_at) VALUES($1,$2,'video','',$3,'published',$4)", ["p_v282ref", me.user.id, { video: { mediaId: a.id } }, old]);
  const loose = path.join(tmp, "st", "md_ghost282_poster.jpg"); fs.writeFileSync(loose, Buffer.alloc(2048, 1)); const past = (Date.now() - 9 * 864e5) / 1000; fs.utimesSync(loose, past, past);
  const r = await req("GET", "/api/admin/storage"); assert.equal(r.status, 200, r.error);
  assert.ok(r.storage.total > 0 && r.storage.byKind.originals && r.storage.byKind.thumbs); assert.equal(r.storage.orphans, undefined);
  const d = (await req("GET", "/api/admin/storage?orphans=1")).storage.orphans;
  assert.ok(d.files.some(f => f.name === "md_ghost282_poster.jpg"), "loose file listed");
  assert.ok(d.unused.some(u => u.id === b.id), "unreferenced video listed"); assert.ok(!d.unused.some(u => u.id === a.id), "referenced video never listed");
  assert.equal((await req("POST", "/api/admin/storage/cleanup", {})).status, 400);
  const c = await req("POST", "/api/admin/storage/cleanup", { files: ["md_ghost282_poster.jpg", "../db.sqlite"], unused: [b.id, a.id] }); assert.equal(c.status, 200, c.error);
  assert.deepEqual([c.cleaned.files, c.cleaned.media], [1, 1]);
  assert.ok(!fs.existsSync(loose)); assert.ok(fs.existsSync(path.join(tmp, "db.sqlite")));
  assert.equal((await db.get("SELECT status FROM media WHERE id=$1", [b.id])).status, "purged");
  assert.equal((await db.get("SELECT status FROM media WHERE id=$1", [a.id])).status, "ready", "referenced media kept");
  assert.ok(fs.existsSync(path.join(tmp, "st", path.basename(a.variants.original))));
  assert.ok(!fs.readdirSync(path.join(tmp, "st")).some(f => f.startsWith(b.id)), "purged media files gone");
});
