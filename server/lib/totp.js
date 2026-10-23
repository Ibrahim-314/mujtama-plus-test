/* RFC 6238 TOTP (SHA-1, 30s, 6 digits) + RFC 4648 base32, compatible with Google Authenticator,
 * Microsoft Authenticator, 1Password, Authy. Includes replay protection via last accepted step. */
const crypto = require("node:crypto");
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf) {
  let bits = 0,
    val = 0,
    out = "";
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  s = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0,
    val = 0;
  const out = [];
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("bad base32");
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
const newSecret = () => b32encode(crypto.randomBytes(20));
function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1e6;
  return String(code).padStart(6, "0");
}
const step = (t = Date.now()) => Math.floor(t / 30e3);
const generate = (secret, t) => hotp(secret, step(t));
/* returns the matched step (for replay protection) or null; accepts ±1 step clock drift */
function verify(secret, code, { lastStep = null, t = Date.now() } = {}) {
  if (!/^\d{6}$/.test(String(code || ""))) return null;
  const s = step(t);
  for (const d of [0, -1, 1]) {
    const st = s + d;
    if (lastStep !== null && st <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, st)), Buffer.from(String(code)))) return st;
  }
  return null;
}
const uri = (secret, account, issuer = "مجتمع بلس") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
module.exports = { newSecret, generate, verify, uri, b32encode, b32decode, hotp };
