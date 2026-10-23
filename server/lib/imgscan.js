/* Image screening for sensitive content (Phase 31). Local and free by default:
 *  • exact (SHA-256) and perceptual (8×8 average hash, same as lib/images.js) block-list matching
 *  • metadata text (EXIF/XMP/PNG tEXt/comments) scanned for adult-content markers
 *  • a skin-tone heuristic: the image is decoded to 64×64 RGB with ffmpeg (already a dependency of the media
 *    pipeline); the share of skin-coloured pixels (RGB + YCbCr rules) and the size of the largest connected
 *    skin region give a 0–1 signal. It is deliberately conservative: on its own it only marks a post as
 *    sensitive (blurred behind a tap-to-view notice); it never hides or deletes anything.
 *  • optional external classifier (env-gated, disabled by default): AUTOMOD_IMAGE_URL receives the raw image
 *    (e.g. a self-hosted NSFW model) and returns JSON with a score; AUTOMOD_IMAGE_TOKEN is sent as a bearer token.
 * Without ffmpeg the hash/metadata checks still run and the result says skin analysis was unavailable. */
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");

const run = (args, input) =>
  new Promise((res, rej) => {
    const p = execFile("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { timeout: 20e3, encoding: "buffer", maxBuffer: 8 << 20 }, (e, out) =>
      e ? rej(e) : res(out)
    );
    p.stdin?.on("error", () => {});
    p.stdin?.end(input);
  });
const META = /(nsfw|porn|xxx|nude|naked|adult only|onlyfans|hentai|explicit|18\+|سكس|اباحي|إباحي|عاري|للكبار فقط)/i;

/** skin rule (Kovac et al. RGB, uniform daylight) AND a YCbCr range, to cut false positives (wood, sand) */
function isSkin(r, g, b) {
  const rgb = r > 95 && g > 40 && b > 20 && Math.max(r, g, b) - Math.min(r, g, b) > 15 && Math.abs(r - g) > 15 && r > g && r > b;
  if (!rgb) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}
/**
 * @param {Buffer} rgb raw rgb24 pixels @param {number} w @param {number} h
 * @returns {{ ratio: number, blob: number }} share of skin pixels and of the largest 4-connected skin region
 */
function skinStats(rgb, w, h) {
  const n = w * h,
    mask = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++)
    if (isSkin(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])) {
      mask[i] = 1;
      count++;
    }
  let best = 0;
  const seen = new Uint8Array(n),
    stack = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      size++;
      const x = j % w,
        y = (j / w) | 0;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1])
        if (k >= 0 && mask[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
    }
    if (size > best) best = size;
  }
  return { ratio: Math.round((count / n) * 100) / 100, blob: Math.round((best / n) * 100) / 100 };
}
/** printable text found in the first 256 KB (EXIF/XMP/PNG text chunks/JPEG comments) */
function metaText(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 256 * 1024)).toString("latin1");
  return (
    (head.match(/[\x20-\x7e]{6,}/g) || []).join(" ").slice(0, 20000) +
    " " +
    (
      buf
        .subarray(0, Math.min(buf.length, 256 * 1024))
        .toString("utf8")
        .match(/[\u0600-\u06FF ]{4,}/g) || []
    ).join(" ")
  );
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

/**
 * @param {Buffer} buf
 * @param {{ blockSha?: Set<string>|string[], blockHashes?: string[], env?: Record<string,string|undefined>, fetchImpl?: typeof fetch, ffmpeg?: boolean }} [o]
 */
async function screen(buf, o = {}) {
  const env = o.env || process.env;
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  /** @type {string[]} */ const reasons = [];
  let score = 0,
    hold = false,
    available = false,
    ahash = null,
    skin = null,
    provider = null;
  const bump = w => {
    score = score + w * (1 - score);
  };
  if (new Set(o.blockSha || []).has(sha256)) {
    reasons.push("blocklist_exact");
    score = 1;
    hold = true;
  }
  if (META.test(metaText(buf))) {
    reasons.push("metadata");
    bump(0.45);
  }
  if (o.ffmpeg !== false) {
    try {
      const gray = await run(["-i", "pipe:0", "-frames:v", "1", "-vf", "scale=8:8:flags=area,format=gray", "-f", "rawvideo", "-"], buf);
      if (gray.length >= 64) {
        const g = gray.subarray(0, 64),
          avg = g.reduce((a, b) => a + b, 0) / 64;
        let bits = "";
        for (const v of g) bits += v > avg ? "1" : "0";
        ahash = BigInt("0b" + bits)
          .toString(16)
          .padStart(16, "0");
      }
      const rgb = await run(["-i", "pipe:0", "-frames:v", "1", "-vf", "scale=64:64:flags=area,format=rgb24", "-f", "rawvideo", "-"], buf);
      if (rgb.length >= 64 * 64 * 3) {
        available = true;
        skin = skinStats(rgb, 64, 64);
        if (skin.ratio >= 0.6 && skin.blob >= 0.35) {
          reasons.push("skin_high");
          bump(0.65);
        } else if (skin.ratio >= 0.4 && skin.blob >= 0.25) {
          reasons.push("skin");
          bump(0.45);
        }
      }
    } catch {
      /* ffmpeg missing or unreadable image: hash + metadata only */
    }
  }
  if (ahash && !/^(0{16}|f{16})$/.test(ahash) && (o.blockHashes || []).some(h => hamming(h, ahash) <= 5)) {
    reasons.push("blocklist_similar");
    score = Math.max(score, 0.95);
    hold = true;
  }
  if (env.AUTOMOD_IMAGE_URL) {
    try {
      const f = o.fetchImpl || fetch;
      const r = await f(env.AUTOMOD_IMAGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", ...(env.AUTOMOD_IMAGE_TOKEN ? { Authorization: "Bearer " + env.AUTOMOD_IMAGE_TOKEN } : {}) },
        body: /** @type {any} */ (new Uint8Array(buf)),
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const j = await r.json();
        const s =
          typeof j.score === "number"
            ? j.score
            : typeof j.nsfw === "number"
              ? j.nsfw
              : typeof j.unsafe === "number"
                ? j.unsafe
                : (+j.porn || 0) + (+j.hentai || 0) + 0.5 * (+j.sexy || 0);
        provider = { score: Math.max(0, Math.min(1, s)) };
        if (provider.score >= 0.85) {
          reasons.push("provider_high");
          score = Math.max(score, provider.score);
          hold = true;
        } else if (provider.score >= 0.5) {
          reasons.push("provider");
          score = Math.max(score, provider.score);
        } else if (provider.score < 0.15 && reasons.every(x => x.startsWith("skin"))) score = Math.min(score, 0.3); // trusted model says clean: skin heuristic overruled
      }
    } catch {
      provider = { error: true };
    }
  }
  score = Math.round(Math.min(1, score) * 100) / 100;
  return { sha256, ahash, available, skin, provider, score, sensitive: score >= 0.45, hold, reasons };
}

module.exports = { screen, skinStats, isSkin, metaText, hamming };
