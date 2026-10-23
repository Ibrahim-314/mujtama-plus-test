/* v2.60 M2 — image privacy for post/community uploads (no native deps):
 *  · strips EXIF (incl. GPS), XMP, IPTC/Photoshop, comments from JPEG; eXIf/text chunks from PNG; EXIF/XMP from WebP;
 *    comment/XMP extensions are left in GIF only as pixels-neutral (GIF carries no EXIF/GPS).
 *  · applies the EXIF orientation to the pixels first (ffmpeg transpose, only when orientation ≠ 1), so the photo
 *    still looks upright once the tag is gone. Without ffmpeg the pixels stay as they are and a minimal EXIF holding
 *    ONLY the Orientation tag is kept (no GPS, no camera data) so browsers still show it upright.
 *  · reads the real displayed width/height so the client can reserve the aspect ratio before load.
 * A file that does not parse cleanly is returned unchanged (never corrupted); dims are then 0 (unknown). */
const { execFile } = require("node:child_process"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");

/* ---------- EXIF orientation (TIFF IFD0 tag 0x0112) ---------- */
function exifOrientation(tiff) {
  try {
    if (tiff.length < 8) return 1;
    const le = tiff.toString("latin1", 0, 2) === "II"; if (!le && tiff.toString("latin1", 0, 2) !== "MM") return 1;
    const u16 = (o) => le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o), u32 = (o) => le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);
    const ifd = u32(4); if (ifd + 2 > tiff.length) return 1;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 12 > tiff.length) break; if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; } }
  } catch { /* malformed EXIF → treat as upright */ }
  return 1;
}
/** a minimal big-endian EXIF APP1 holding only Orientation */
function orientationApp1(o) {
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]), len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), len, body]);
}

/* ---------- JPEG ---------- */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function parseJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const keep = [buf.subarray(0, 2)]; let p = 2, w = 0, h = 0, orientation = 1, stripped = 0;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; }                        // fill byte
    if (m === 0xd9) { keep.push(buf.subarray(p)); p = buf.length; break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { keep.push(buf.subarray(p, p + 2)); p += 2; continue; }
    const len = buf.readUInt16BE(p + 2); if (len < 2 || p + 2 + len > buf.length) return null;
    const seg = buf.subarray(p, p + 2 + len), data = buf.subarray(p + 4, p + 2 + len);
    if (SOF.has(m) && data.length >= 5) { h = data.readUInt16BE(1); w = data.readUInt16BE(3); }
    if (m === 0xda) { keep.push(buf.subarray(p)); p = buf.length; break; } // start of scan: the rest is image data
    const isExif = m === 0xe1 && data.subarray(0, 6).toString("latin1") === "Exif\0\0";
    if (isExif && orientation === 1) orientation = exifOrientation(data.subarray(6));
    // drop: APP1 (EXIF/XMP), APP2–APP15 except ICC (APP2 ICC_PROFILE) and Adobe (APP14, colour transform), COM
    const icc = m === 0xe2 && data.subarray(0, 12).toString("latin1") === "ICC_PROFILE\0";
    const drop = m === 0xfe || (m >= 0xe1 && m <= 0xef && !icc && m !== 0xee);
    if (drop) stripped++; else keep.push(seg);
    p += 2 + len;
  }
  if (!w || !h) return null;
  return { type: "jpeg", out: Buffer.concat(keep), width: w, height: h, orientation, stripped };
}
const insertAfterSoi = (jpeg, seg) => Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);

/* ---------- PNG ---------- */
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
function parsePng(buf) {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  const keep = [buf.subarray(0, 8)]; let p = 8, w = 0, h = 0, orientation = 1, stripped = 0, end = false;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8); if (!/^[A-Za-z]{4}$/.test(type) || p + 12 + len > buf.length) return null;
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === "eXIf") orientation = exifOrientation(data);
    if (PNG_DROP.has(type)) stripped++; else keep.push(buf.subarray(p, p + 12 + len));
    p += 12 + len; if (type === "IEND") { end = true; break; }
  }
  if (!end || !w || !h) return null;
  return { type: "png", out: Buffer.concat(keep), width: w, height: h, orientation, stripped };
}

/* ---------- WebP ---------- */
function parseWebp(buf) {
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunks = []; let p = 12, w = 0, h = 0, orientation = 1, stripped = 0, vp8x = -1;
  while (p + 8 <= buf.length) {
    const type = buf.toString("latin1", p, p + 4), len = buf.readUInt32LE(p + 4), full = 8 + len + (len & 1);
    if (p + 8 + len > buf.length) return null;
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "VP8X" && len >= 10) { w = data.readUIntLE(4, 3) + 1; h = data.readUIntLE(7, 3) + 1; vp8x = chunks.length; }
    else if (type === "VP8 " && !w && len >= 10) { w = data.readUInt16LE(6) & 0x3fff; h = data.readUInt16LE(8) & 0x3fff; }
    else if (type === "VP8L" && !w && len >= 5) { const b = data.readUInt32LE(1); w = (b & 0x3fff) + 1; h = ((b >> 14) & 0x3fff) + 1; }
    if (type === "EXIF") { orientation = exifOrientation(data.subarray(data.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0)); stripped++; }
    else if (type === "XMP ") stripped++;
    else chunks.push(Buffer.from(buf.subarray(p, Math.min(buf.length, p + full))));
    p += full;
  }
  if (!w || !h) return null;
  if (vp8x >= 0) chunks[vp8x][8] &= ~(0x08 | 0x04); // clear EXIF + XMP flags
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]), head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1"); head.writeUInt32LE(body.length, 4);
  return { type: "webp", out: Buffer.concat([head, body]), width: w, height: h, orientation, stripped };
}

/* ---------- GIF: dims only (no EXIF/GPS in the format) ---------- */
function parseGif(buf) {
  if (buf.toString("latin1", 0, 3) !== "GIF" || buf.length < 10) return null;
  return { type: "gif", out: buf, width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), orientation: 1, stripped: 0 };
}

const parse = (buf) => { for (const f of [parseJpeg, parsePng, parseWebp, parseGif]) { try { const r = f(buf); if (r) return r; } catch { /* next */ } } return null; };

/* orientation → ffmpeg filter (EXIF 1..8) */
const ROT = { 2: "hflip", 3: "hflip,vflip", 4: "vflip", 5: "transpose=0", 6: "transpose=1", 7: "transpose=3", 8: "transpose=2" };
function ffRotate(buf, ext, o) {
  return new Promise((res) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imgmeta-")), src = path.join(dir, "in." + ext), dst = path.join(dir, "out." + ext);
    fs.writeFileSync(src, buf);
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-noautorotate", "-i", src, "-vf", ROT[o], "-map_metadata", "-1", ...(ext === "jpg" ? ["-q:v", "2"] : []), "-frames:v", "1", dst];
    execFile("ffmpeg", args, { timeout: 30e3 }, (e) => { let out = null; try { if (!e) out = fs.readFileSync(dst); } catch { /* none */ } fs.rmSync(dir, { recursive: true, force: true }); res(out); });
  });
}

/**
 * @param {Buffer} buf uploaded image bytes
 * @returns {Promise<{ buf: Buffer, width: number, height: number, orientation: number, rotated: boolean, stripped: number }>}
 */
async function sanitize(buf, o = {}) {
  const r = parse(buf);
  if (!r) return { buf, width: 0, height: 0, orientation: 1, rotated: false, stripped: 0 };
  const swap = r.orientation >= 5;
  const width = swap ? r.height : r.width, height = swap ? r.width : r.height;
  let out = r.out, rotated = false;
  if (r.orientation !== 1 && (r.type === "jpeg" || r.type === "png" || r.type === "webp")) {
    const ext = r.type === "jpeg" ? "jpg" : r.type, fixed = o.noFfmpeg ? null : await ffRotate(r.out, ext, r.orientation);
    const again = fixed && parse(fixed);
    if (again && again.width === width && again.height === height) { out = again.out; rotated = true; }
    else if (r.type === "jpeg") out = insertAfterSoi(r.out, orientationApp1(r.orientation)); // fallback: only the orientation survives
  }
  return { buf: out, width, height, orientation: r.orientation, rotated, stripped: r.stripped };
}

module.exports = { sanitize, parse, exifOrientation, orientationApp1 };
