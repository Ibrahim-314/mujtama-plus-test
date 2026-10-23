/* Provider activation helpers (phase 52). Zero dependencies.
 * • vapidPolicy(env): "env-only" only when VAPID_ENV_ONLY=1 is set explicitly; otherwise "auto" — the server generates one
 *   VAPID pair on first start and keeps it in notify_keys (production included), so web push works with no env change.
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the environment always override the stored pair.
 * • seal / unseal: AES-256-GCM for secret fields of admin-entered provider settings (key: PROVIDER_SEAL_KEY or a random key
 *   kept in notify_keys — protects a leaked provider_settings export, not a full database dump; the env is the stronger home).
 * • switchableMailer(m): a stable object every service can hold (services/mail.js destructures ctx.mailer once) whose
 *   transport can be swapped at runtime when an admin saves or clears SMTP settings.
 * • smtpUrlFrom(fields): builds smtp(s)://user:pass@host:port from form fields (no free-text URL needed on a phone).
 * • translateEnv(cfg): maps a stored translation config onto the env keys lib/translate.js already understands. */
const crypto = require("node:crypto");

const vapidPolicy = (env = process.env) => (env.VAPID_ENV_ONLY === "1" ? "env-only" : "auto");

function seal(keyB64, plain) {
  const key = Buffer.from(keyB64, "base64url"), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv), body = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return "v1." + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
function unseal(keyB64, sealed) {
  if (typeof sealed !== "string" || !sealed.startsWith("v1.")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64url"), key = Buffer.from(keyB64, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; }
}

function switchableMailer(initial) {
  let cur = initial;
  const m = {
    get enabled() { return !!cur.enabled; }, get transport() { return cur.transport || null; }, get from() { return cur.from; },
    get fromAddr() { return cur.fromAddr; }, get dkim() { return cur.dkim; }, get outbox() { return cur.outbox; },
    compose: (x) => cur.compose(x), send: (x) => cur.send(x),
    swap(next, source = "db") { cur = next; m.source = next.enabled ? source : "none"; return m; }, current: () => cur, source: initial.enabled ? "env" : "none"
  };
  return m;
}

const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
function smtpUrlFrom(f = {}) {
  if (f.url) { const u = new URL(String(f.url)); if (!["smtp:", "smtps:"].includes(u.protocol) || !u.hostname) throw new Error("smtp_url"); return u.toString(); }
  const host = String(f.host || "").trim(); if (!HOST_RE.test(host)) throw new Error("smtp_host");
  const port = Number(f.port || (f.secure ? 465 : 587)); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("smtp_port");
  const user = f.user ? encodeURIComponent(String(f.user)) : "", pass = f.pass ? encodeURIComponent(String(f.pass)) : "";
  return `${f.secure || port === 465 ? "smtps" : "smtp"}://${user ? user + (pass ? ":" + pass : "") + "@" : ""}${host}:${port}`;
}
const maskSmtp = (url) => { try { const u = new URL(url); return { host: u.hostname, port: Number(u.port) || (u.protocol === "smtps:" ? 465 : 587), secure: u.protocol === "smtps:", user: decodeURIComponent(u.username || ""), passSet: !!u.password }; } catch { return null; } };

/** stored translate config → env-shaped object for lib/translate.createProvider (only the chosen provider's keys) */
function translateEnv(c = {}) {
  const e = { AI_TRANSLATE_PROVIDER: c.provider };
  if (c.provider === "libre") { e.TRANSLATE_URL = c.url; if (c.key) e.TRANSLATE_KEY = c.key; if (c.private) e.TRANSLATE_PRIVATE = "1"; }
  if (c.provider === "deepl") e.DEEPL_API_KEY = c.key;
  if (c.provider === "openai") { e.OPENAI_API_KEY = c.key; if (c.baseUrl) e.OPENAI_BASE_URL = c.baseUrl; if (c.model) e.TRANSLATE_MODEL = c.model; e.TRANSLATE_USD_PER_MTOK_IN = String(c.rateIn ?? 0); e.TRANSLATE_USD_PER_MTOK_OUT = String(c.rateOut ?? 0); }
  return e;
}
const TRANSLATE_ENV_KEYS = ["AI_TRANSLATE_PROVIDER", "DEEPL_API_KEY", "OPENAI_API_KEY", "TRANSLATE_URL"];

module.exports = { vapidPolicy, seal, unseal, switchableMailer, smtpUrlFrom, maskSmtp, translateEnv, TRANSLATE_ENV_KEYS };
