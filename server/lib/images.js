/* Image pipeline (Phase 6): validates by magic bytes, strips metadata (EXIF/GPS) by re-encoding,
 * emits WebP variants at several sizes, and an 8×8 average hash for impersonation checks. ffmpeg-based. */
const { execFile } = require("node:child_process"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
/** @type {Array<[string, number[]]>} */
const SIG = [
  ["jpg", [0xff, 0xd8, 0xff]],
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["gif", [0x47, 0x49, 0x46]],
  ["webp", [0x52, 0x49, 0x46, 0x46]]
];
const sniff = buf => (SIG.find(([, s]) => s.every((b, i) => buf[i] === b)) || [null])[0];
const run = (args, opts = {}) =>
  new Promise((res, rej) =>
    execFile("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { timeout: 60e3, encoding: "buffer", maxBuffer: 64 << 20, ...opts }, (e, out) =>
      e ? rej(e) : res(out)
    )
  );
const SIZES = { avatar: [64, 200, 400], cover: [600, 1200, 1800] };
async function process(buf, kind) {
  const type = sniff(buf);
  if (!type) throw new Error("unsupported image");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "img-")),
    src = path.join(dir, "src." + type);
  fs.writeFileSync(src, buf);
  try {
    const out = {};
    for (const w of SIZES[kind]) {
      const dst = path.join(dir, `${w}.webp`);
      const vf = kind === "avatar" ? `scale=${w}:${w}:force_original_aspect_ratio=increase,crop=${w}:${w}` : `scale=${w}:-2`;
      await run(["-y", "-i", src, "-frames:v", "1", "-vf", vf, "-map_metadata", "-1", "-c:v", "libwebp", "-quality", "82", dst]);
      out[w] = fs.readFileSync(dst);
    }
    const gray = await run(["-i", src, "-frames:v", "1", "-vf", "scale=8:8:flags=area,format=gray", "-f", "rawvideo", "-"]);
    const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
    let bits = "";
    for (const v of gray) bits += v > avg ? "1" : "0";
    return {
      variants: out,
      ahash: BigInt("0b" + bits)
        .toString(16)
        .padStart(16, "0")
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const hamming = (a, b) => {
  if (!a || !b) return 64;
  let x = BigInt("0x" + a) ^ BigInt("0x" + b),
    n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};
const key = (owner, kind, w) => `pf-${owner}-${kind}-${crypto.randomBytes(5).toString("hex")}-${w}.webp`; // flat keys: served by /media/
module.exports = { process, sniff, hamming, key, SIZES };
