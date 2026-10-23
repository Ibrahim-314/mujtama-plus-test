/* v2.60 M2 (part 1) — image privacy: EXIF/GPS stripped server-side, orientation applied first, real dims stored.
 * STORAGE_DRIVER=db like production. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.LOG_SILENT = "1";
const { createApp } = require("../server");
const IM = require("../lib/imgmeta");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-m2-"));
let app, base, cookie = "";
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

/** 40×20 JPEG: left half red, right half blue (no metadata) */
function plainJpeg() {
  const f = path.join(tmp, "src.jpg");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=red:s=20x20", "-f", "lavfi", "-i", "color=blue:s=20x20", "-filter_complex", "[0][1]hstack", "-frames:v", "1", "-q:v", "2", f]);
  return fs.readFileSync(f);
}
/** big-endian TIFF: IFD0 {Make "LEAKYCAM", Orientation o, GPSInfo→} GPS IFD {LatRef "N", Latitude 21/1 29/1 0/1} */
function exifApp1(o) {
  const t = Buffer.alloc(200); let p = 0;
  t.write("MM", 0, "latin1"); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);
  const ifd0 = 8, ifd0n = 3, ifd0end = ifd0 + 2 + ifd0n * 12 + 4, make = ifd0end, gps = make + 10, gpsn = 2, lat = gps + 2 + gpsn * 12 + 4;
  const entry = (at, tag, type, count, val) => { t.writeUInt16BE(tag, at); t.writeUInt16BE(type, at + 2); t.writeUInt32BE(count, at + 4); val(at + 8); };
  t.writeUInt16BE(ifd0n, ifd0);
  entry(ifd0 + 2, 0x010f, 2, 9, (a) => t.writeUInt32BE(make, a));
  entry(ifd0 + 14, 0x0112, 3, 1, (a) => t.writeUInt16BE(o, a));
  entry(ifd0 + 26, 0x8825, 4, 1, (a) => t.writeUInt32BE(gps, a));
  t.write("LEAKYCAM\0", make, "latin1");
  t.writeUInt16BE(gpsn, gps);
  entry(gps + 2, 0x0001, 2, 2, (a) => t.write("N\0", a, "latin1"));
  entry(gps + 14, 0x0002, 5, 3, (a) => t.writeUInt32BE(lat, a));
  [21, 1, 29, 1, 0, 1].forEach((v, i) => t.writeUInt32BE(v, lat + i * 4)); p = lat + 24;
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t.subarray(0, p)]), len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), len, body]);
}
const withExif = (jpg, o) => Buffer.concat([jpg.subarray(0, 2), exifApp1(o), Buffer.from("ffe1001a", "hex"), Buffer.from("http://ns.adobe.com/xap/1.0/\0".slice(0, 24), "latin1"), Buffer.from("fffe0008", "hex"), Buffer.from("GPS!xx", "latin1"), jpg.subarray(2)]);
/** decode to rgb24 and return [w,h,pixel(x,y)] via ffmpeg (pixel orientation as stored, EXIF ignored) */
function rgbAt(buf) {
  const f = path.join(tmp, crypto.randomUUID() + ".jpg"); fs.writeFileSync(f, buf);
  const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-noautorotate", "-i", f, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", f]).toString()).streams[0];
  return { w: j.width, h: j.height, px: (x, y) => [...raw.subarray((y * j.width + x) * 3, (y * j.width + x) * 3 + 3)] };
}
const noMeta = (b) => { const s = b.toString("latin1"); return !s.includes("Exif\0\0") && !s.includes("LEAKYCAM") && !s.includes("GPS!") && !s.includes("ns.adobe.com/xap"); };
const req = async (method, p, body, raw) => {
  const r = await fetch(base + p, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": raw ? "application/octet-stream" : "application/json", Cookie: cookie, Origin: base }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const fetchBuf = async (u) => Buffer.from(await (await fetch(base + u, { headers: { Cookie: cookie } })).arrayBuffer());

test.before(async () => {
  app = await createApp({ databaseUrl: "sqlite:" + path.join(tmp, "db.sqlite"), storageDir: path.join(tmp, "st"), storageDriver: "db", seedDemo: false, queuePollMs: 100 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r)); base = "http://127.0.0.1:" + app.server.address().port;
  await req("POST", "/api/auth/register", { name: "خصوصية", handle: "m2exif", password: "secret123" });
});
test.after(() => app.close());

test("JPEG with GPS + orientation 6 → served file has no EXIF/GPS, pixels rotated upright, real dims stored", { skip: !hasFfmpeg && "ffmpeg missing" }, async () => {
  const src = withExif(plainJpeg(), 6);
  assert.ok(!noMeta(src) && IM.parse(src).orientation === 6, "fixture carries EXIF + GPS + XMP + comment");
  const up = await req("POST", "/api/media", src, true); assert.equal(up.status, 200, up.error);
  assert.equal(up.media.width, 20); assert.equal(up.media.height, 40, "orientation 6 → portrait 20×40");
  const served = await fetchBuf(up.media.url);
  assert.ok(noMeta(served), "no EXIF/GPS/XMP/comment in the served bytes");
  assert.equal(IM.parse(served).orientation, 1);
  const d = rgbAt(served); assert.deepEqual([d.w, d.h], [20, 40], "the pixels themselves are portrait");
  const top = d.px(10, 5), bottom = d.px(10, 35);
  assert.ok(top[0] > 180 && top[2] < 80, "top is red (left half rotated 90° clockwise) " + top);
  assert.ok(bottom[2] > 180 && bottom[0] < 80, "bottom is blue " + bottom);
  const meta = await req("GET", "/api/media/" + up.media.id); assert.equal(meta.media.variants.width, 20); assert.equal(meta.media.variants.height, 40);
  const row = await app.ctx.db.get("SELECT size FROM media WHERE id=$1", [up.media.id]); assert.equal(row.size, served.length, "stored size = sanitized size");
});

test("upright JPEG with GPS: stripped losslessly (scan data untouched), dims stored", { skip: !hasFfmpeg && "ffmpeg missing" }, async () => {
  const plain = plainJpeg(), src = withExif(plain, 1);
  const up = await req("POST", "/api/media", src, true); assert.equal(up.status, 200, up.error);
  assert.deepEqual([up.media.width, up.media.height], [40, 20]);
  const served = await fetchBuf(up.media.url); assert.ok(noMeta(served));
  assert.ok(served.equals(IM.parse(plain).out), "only metadata segments removed (ffmpeg's own COM goes too)");
  const sos = (b) => b.subarray(b.indexOf(Buffer.from([0xff, 0xda]))); assert.ok(sos(served).equals(sos(plain)), "compressed image data byte-identical (no re-encode)");
});

test("fallback without ffmpeg: GPS still gone, only an Orientation tag survives", () => {
  if (!hasFfmpeg) return;
  return IM.sanitize(withExif(plainJpeg(), 8), { noFfmpeg: true }).then((s) => {
    assert.deepEqual([s.width, s.height], [20, 40]); assert.equal(s.rotated, false);
    const t = s.buf.toString("latin1"); assert.ok(!t.includes("LEAKYCAM") && !t.includes("GPS!")); assert.equal(IM.parse(s.buf).orientation, 8);
  });
});

test("PNG: eXIf/tEXt chunks removed, dims read; unparsable bytes are left untouched", async () => {
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); return Buffer.concat([l, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(7, 0); ihdr.writeUInt32BE(3, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("tEXt", Buffer.from("GPS!\0here", "latin1")), chunk("eXIf", exifApp1(1).subarray(10)), chunk("IDAT", Buffer.from([1, 2, 3])), chunk("IEND", Buffer.alloc(0))]);
  const up = await req("POST", "/api/media", png, true); assert.equal(up.status, 200, up.error);
  assert.deepEqual([up.media.width, up.media.height], [7, 3]);
  const served = await fetchBuf(up.media.url); assert.ok(noMeta(served)); assert.ok(!served.includes(Buffer.from("eXIf")) && !served.includes(Buffer.from("tEXt")));
  const junk = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(300)]);
  const j = await req("POST", "/api/media", junk, true); assert.equal(j.status, 200); assert.equal(j.media.width, undefined);
  assert.ok((await fetchBuf(j.media.url)).equals(junk));
});

test("WebP: EXIF/XMP chunks removed, VP8X flags cleared, RIFF size fixed", { skip: !hasFfmpeg && "ffmpeg missing" }, async () => {
  const f = path.join(tmp, "a.webp"); execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=green:s=30x10", "-frames:v", "1", f]);
  const plain = fs.readFileSync(f), exif = Buffer.concat([Buffer.from("EXIF", "latin1"), Buffer.alloc(4), exifApp1(1).subarray(4)]); exif.writeUInt32LE(exif.length - 8, 4);
  let body = Buffer.concat([plain.subarray(12), exif]); if (body.length & 1) body = Buffer.concat([body, Buffer.alloc(1)]);
  const head = Buffer.from("RIFF0000WEBP", "latin1"); head.writeUInt32LE(body.length + 4, 4); const src = Buffer.concat([head, body]);
  const up = await req("POST", "/api/media", src, true); assert.equal(up.status, 200, up.error);
  assert.deepEqual([up.media.width, up.media.height], [30, 10]);
  const served = await fetchBuf(up.media.url); assert.ok(noMeta(served)); assert.equal(served.readUInt32LE(4), served.length - 8);
});
