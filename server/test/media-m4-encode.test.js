/* v2.60 M4 lean video encode (STORAGE_DRIVER=db like production, real ffmpeg on tiny lavfi clips):
 *  · never upscale: a 320p source gets no ladder, only a faststart MP4 (lossless remux); a 1080p source gets 360p+720p
 *  · every MP4 output has moov before mdat; the poster exists; variants.storedBytes is recorded and bounded
 *  · a failed run removes its partial outputs (disk + durable store) and leaves the original */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.LOG_SILENT = "1";
process.env.MEDIA_MAX_ATTEMPTS = "1";
const { createApp } = require("../server");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-m4-"));
let app, base, cookie = "";
const req = async (method, p, body, raw) => {
  const r = await fetch(base + p, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": raw ? "application/octet-stream" : "application/json", Cookie: cookie, Origin: base }, body: raw || (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };
/** a tiny test clip; `moovLast` keeps ffmpeg's default (mdat before moov) so the remux path is exercised */
function clip(name, w, h, secs, extra = []) {
  const f = path.join(tmp, name);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=24:duration=${secs}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-shortest", ...extra, f]);
  return fs.readFileSync(f);
}
const fetchBuf = async (u) => { const r = await fetch(base + u, { headers: { Cookie: cookie } }); assert.equal(r.status, 200, u); return Buffer.from(await r.arrayBuffer()); };
const boxes = (buf) => { const out = []; let o = 0; while (o + 8 <= buf.length) { let len = buf.readUInt32BE(o); out.push(buf.toString("latin1", o + 4, o + 8)); if (len === 1) len = Number(buf.readBigUInt64BE(o + 8)); if (len < 8) break; o += len; } return out; };
const faststart = (buf) => { const b = boxes(buf); return b.includes("moov") && b.includes("mdat") && b.indexOf("moov") < b.indexOf("mdat"); };
const probeH = (buf, name) => { const f = path.join(tmp, name); fs.writeFileSync(f, buf); return +execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height", "-of", "csv=p=0", f]).toString().trim(); };
async function upAndWait(buf) {
  const up = await req("POST", "/api/media", null, buf); assert.equal(up.status, 200, up.error);
  const m = await until(async () => { const r = await req("GET", "/api/media/" + up.media.id); return r.media && r.media.status !== "processing" ? r.media : null; });
  assert.ok(m, "processing finished"); return m;
}
test.before(async () => {
  app = await createApp({ databaseUrl: "sqlite:" + path.join(tmp, "db.sqlite"), storageDir: path.join(tmp, "st"), storageDriver: "db", seedDemo: false, queuePollMs: 100 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.server.address().port;
  await req("POST", "/api/auth/register", { name: "مهندس الضغط", handle: "m4enc", password: "secret123" });
});
test.after(() => app.close());

test("ladder rule: never upscale, never a rung equal to the source", () => {
  const L = (h) => app.ctx.services.media.ladderFor(h).map(r => r.h);
  assert.deepEqual(L(240), []); assert.deepEqual(L(320), []); assert.deepEqual(L(360), []);
  assert.deepEqual(L(480), [360]); assert.deepEqual(L(720), [360]); assert.deepEqual(L(1000), [360, 720]); assert.deepEqual(L(1080), [360, 720, 1080], "v2.70: 1080p rung for ≥ 1080p long videos"); assert.deepEqual(L(2160), [360, 720, 1080]);
});

test("320p source: no ladder/HLS, faststart remux, poster, bounded bytes", async () => {
  const src = clip("s320.mp4", 568, 320, 3);
  assert.equal(faststart(src), false, "fixture is a non-faststart MP4");
  const m = await upAndWait(src); assert.equal(m.status, "ready", JSON.stringify(m.variants));
  const v = m.variants;
  assert.equal(v.master, undefined); assert.equal(v.hls, undefined); assert.equal(v["720p"], undefined);
  assert.ok(v["360p"], "faststart copy of the original");
  const mp4 = await fetchBuf(v["360p"]); assert.ok(faststart(mp4), "moov before mdat");
  assert.equal(probeH(mp4, "o320.mp4"), 320, "kept at source height (no upscale)");
  assert.ok(Math.abs(mp4.length - src.length) < 4096, "a remux, not a re-encode");
  const poster = await fetchBuf(v.poster); assert.equal(poster.subarray(0, 2).toString("hex"), "ffd8", "jpeg poster");
  assert.ok(v.storedBytes >= src.length + mp4.length && v.storedBytes <= src.length * 2 + 64 * 1024, `storedBytes ${v.storedBytes} vs original ${src.length}`);
  assert.equal(v.storedBytes, src.length + v.outputBytes);
});

test("320p source that is already faststart MP4: nothing duplicated, only a poster", async () => {
  const src = clip("s320fs.mp4", 568, 320, 1, ["-movflags", "+faststart"]);
  assert.ok(faststart(src));
  const m = await upAndWait(src); assert.equal(m.status, "ready");
  assert.equal(m.variants["360p"], undefined); assert.equal(m.variants.master, undefined); assert.ok(m.variants.poster, "poster at 0 s for a 1 s clip");
  assert.ok(m.variants.outputBytes < 64 * 1024, "only the poster is stored");
});

test("1080p clip (v2.70 clip ladder 240–720p): HLS, 720p faststart MP4 fallback, poster ≤ 720, bounded bytes", async () => {
  const src = clip("s1080.mp4", 1920, 1080, 3);
  const m = await upAndWait(src); assert.equal(m.status, "ready", JSON.stringify(m.variants));
  const v = m.variants;
  assert.deepEqual(Object.keys(v.hls).sort(), ["240p", "360p", "540p", "720p"]); assert.ok(v.master);
  const master = (await fetchBuf(v.master)).toString(); assert.match(master, /RESOLUTION=640x360/); assert.match(master, /RESOLUTION=1280x720/);
  const pl = (await fetchBuf(v.hls["720p"])).toString(); assert.match(pl, /#EXT-X-ENDLIST/); const seg = pl.split("\n").find(l => l.endsWith(".ts"));
  assert.equal((await fetchBuf("/media/" + seg))[0], 0x47, "MPEG-TS segment");
  assert.ok(v["360p"]); assert.equal(v["720p"], undefined, "v2.82: 720p is HLS-only, the MP4 fallback is 360p");
  const mp4 = await fetchBuf(v["360p"]); assert.ok(faststart(mp4)); assert.equal(probeH(mp4, "o360.mp4"), 360);
  const poster = await fetchBuf(v.poster); assert.equal(poster.subarray(0, 2).toString("hex"), "ffd8");
  assert.equal(probeH(poster, "p.jpg"), 720, "poster never larger than 720p");
  assert.equal(v.storedBytes, src.length + v.outputBytes);
  assert.ok(v.outputBytes <= src.length * 3 + 512 * 1024, `outputs ${v.outputBytes} vs original ${src.length}`);
  const files = fs.readdirSync(path.join(tmp, "st")).filter(f => f.startsWith(m.id + "_"));
  assert.ok(!files.includes(m.id + "_720.mp4"), "intermediate 720p MP4 removed");
  assert.equal(files.reduce((n, f) => n + fs.statSync(path.join(tmp, "st", f)).size, 0), v.outputBytes);
});

test("a failed run removes its partial outputs (disk + durable) and keeps the original", async () => {
  const m = await upAndWait(clip("sfail.mp4", 1280, 720, 1)); assert.equal(m.status, "ready");
  const mid = m.id, dir = path.join(tmp, "st"), orig = path.join(dir, mid + ".mp4"), before = fs.readFileSync(orig);
  // leftovers of an interrupted earlier attempt, on disk and in the durable store
  fs.writeFileSync(path.join(dir, `${mid}_720_009.ts`), Buffer.alloc(1000)); await app.ctx.storage.put(`${mid}_720_009.ts`, Buffer.alloc(1000));
  // fail AFTER the 360p rung was encoded and segmented (writing the master playlist throws)
  const real = fs.writeFileSync, seen = [];
  fs.writeFileSync = function (f, ...a) { if (String(f).endsWith("_master.m3u8")) { seen.push(...fs.readdirSync(dir).filter(x => x.startsWith(mid + "_"))); throw new Error("disk full (test)"); } return real.call(this, f, ...a); };
  try { await assert.rejects(app.ctx.services.media.processVideo({ mid }), /disk full/); } finally { fs.writeFileSync = real; }
  assert.ok(seen.some(f => f.endsWith(".ts")), "partial HLS outputs existed before the failure");
  assert.ok(!seen.includes(`${mid}_720_009.ts`), "earlier leftovers were removed at the start");
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.startsWith(mid + "_")), [], "no partial outputs on disk");
  for (const f of [...seen, `${mid}_720_009.ts`, `${mid}_poster.jpg`]) assert.equal(await app.ctx.storage.has(f), false, f + " not in the durable store");
  assert.ok(fs.readFileSync(orig).equals(before), "original untouched"); assert.ok(await app.ctx.storage.has(mid + ".mp4"));
  await app.ctx.services.media.processVideo({ mid }); // and a retry succeeds from clean
  const v = (await req("GET", "/api/media/" + mid)).media.variants; assert.deepEqual(Object.keys(v.hls), ["240p", "360p", "540p"]); assert.equal(v.storedBytes, before.length + v.outputBytes);
});
