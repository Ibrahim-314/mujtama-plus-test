/* Web Push (Phase 28), zero dependencies, node:crypto only.
 * • RFC 8291 message encryption with the RFC 8188 "aes128gcm" content coding (single record)
 * • RFC 8292 VAPID: ES256 JWT (raw r||s signature) + "Authorization: vapid t=…, k=…"
 * • RFC 8030 delivery: TTL, Urgency, Topic headers; 404/410 mean the subscription is gone. */
const crypto = require("node:crypto");
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s).replace(/=+$/, ""), "base64url");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

/** VAPID key pair as base64url: publicKey = 65-byte uncompressed P-256 point, privateKey = 32-byte scalar */
function generateVapidKeys() {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}
function privateKeyObject(publicKey, privateKey) {
  const pub = unb64u(publicKey); if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be a 65-byte uncompressed P-256 point");
  return crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: b64u(unb64u(privateKey)) }, format: "jwk" });
}
/** RFC 8292 §2: JWT signed with ES256 over the push service origin */
function vapidJwt({ audience, subject, publicKey, privateKey, expSeconds = 12 * 3600, now = Date.now() }) {
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + Math.min(expSeconds, 24 * 3600), sub: subject }));
  const sig = crypto.sign("sha256", Buffer.from(header + "." + body), { key: privateKeyObject(publicKey, privateKey), dsaEncoding: "ieee-p1363" });
  return `${header}.${body}.${b64u(sig)}`;
}
function vapidHeaders(endpoint, vapid, now) {
  const audience = new URL(endpoint).origin;
  return { Authorization: `vapid t=${vapidJwt({ audience, subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey, now })}, k=${vapid.publicKey}` };
}

/** RFC 8291 §3.4 + RFC 8188 §2: returns the full aes128gcm body (header || ciphertext).
 *  `salt` and `asPrivateKey` are injectable for the RFC test vector; otherwise random. */
function encrypt(payload, { p256dh, auth }, { salt = crypto.randomBytes(16), asPrivateKey = null, recordSize = 4096 } = {}) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth), plain = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  if (uaPublic.length !== 65) throw new Error("bad p256dh"); if (authSecret.length !== 16) throw new Error("bad auth secret");
  if (plain.length > recordSize - 17 - 86) throw new Error("payload too large");
  const ecdh = crypto.createECDH("prime256v1");
  if (asPrivateKey) ecdh.setPrivateKey(unb64u(asPrivateKey)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPublic);
  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  // CEK / NONCE = HKDF(salt, IKM, "Content-Encoding: aes128gcm|nonce" || 0x00, 16|12)
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([plain, Buffer.from([2])])), c.final(), c.getAuthTag()]); // 0x02 = last record, no padding
  const rs = Buffer.alloc(4); rs.writeUInt32BE(recordSize);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}
/** user-agent side decryption (tests, and a self-check tool) */
function decrypt(body, { uaPrivateKey, uaPublicKey, auth }) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH("prime256v1"); ecdh.setPrivateKey(unb64u(uaPrivateKey));
  const shared = ecdh.computeSecret(asPublic), uaPublic = uaPublicKey ? unb64u(uaPublicKey) : ecdh.getPublicKey();
  const ikm = hmac(hmac(unb64u(auth), shared), Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16), nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const out = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = out.length - 1; while (end >= 0 && out[end] === 0) end--; // strip padding, then the delimiter
  if (out[end] !== 2) throw new Error("bad record delimiter");
  return out.subarray(0, end);
}

/* Push services we deliver to in production (SSRF guard: the endpoint comes from the browser). */
const DEFAULT_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com", "notify.windows.com", "push.apple.com"];
function endpointAllowed(endpoint, { production = process.env.NODE_ENV === "production", hosts = (process.env.PUSH_ALLOWED_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean) } = {}) {
  let u; try { u = new URL(endpoint); } catch { return false; }
  if (!production) return u.protocol === "https:" || u.protocol === "http:";
  if (u.protocol !== "https:") return false;
  const list = hosts.length ? hosts : DEFAULT_HOSTS;
  return list.some(h => u.hostname === h || u.hostname.endsWith("." + h));
}

/** deliver one message; resolves { ok, status, gone, retryAfter } and never throws on HTTP errors */
async function sendNotification(sub, payload, vapid, { ttl = 24 * 3600, urgency = "normal", topic = null, timeoutMs = 10000 } = {}) {
  const body = encrypt(payload, sub.keys);
  /** @type {Record<string, string>} */
  const headers = { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: urgency, ...vapidHeaders(sub.endpoint, vapid) };
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const r = await fetch(sub.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const retryAfter = +(r.headers.get("retry-after") || 0) || null;
  return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410, retryAfter };
}

module.exports = { generateVapidKeys, vapidJwt, vapidHeaders, encrypt, decrypt, sendNotification, endpointAllowed, b64u, unb64u };
