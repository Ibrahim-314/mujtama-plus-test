/* Developer API helpers (phase 47): scopes, PKCE, webhook signatures + backoff, webhook URL policy, per-key rate windows and the
 * OpenAPI 3 document builder. Pure (no db, no network) so they are unit-tested directly. Contract: docs/integration/p47.md. */
const crypto = require("node:crypto");

/** scopes an app may request. `bot` is never granted to a user token: only client_credentials for an app with a bot account. */
const SCOPES = {
  read: "قراءة المنشورات والملفات والمجتمعات العامة",
  profile: "معرفة اسمك ومعرّفك العام",
  "write:posts": "النشر والتعليق باسمك (علناً فقط)",
  bot: "حساب البوت الخاص بالتطبيق"
};
const USER_SCOPES = ["read", "profile", "write:posts"];
const EVENTS = {
  "post.created": "منشور عام جديد",
  "comment.created": "تعليق جديد على منشور عام",
  "bot.command": "أمر مائل (/أمر) في مجتمع ثُبّت فيه البوت",
  "bot.mention": "إشارة إلى البوت في مجتمع ثُبّت فيه",
  "app.authorized": "مستخدم منح التطبيق صلاحية",
  "app.revoked": "مستخدم سحب صلاحية التطبيق"
};

/** "read profile" | ["read"] → unique known scopes, in canonical order; unknown ones dropped */
function parseScopes(v, allowed = Object.keys(SCOPES)) {
  const list = Array.isArray(v) ? v : String(v || "").split(/[\s,]+/);
  const set = new Set(list.map((s) => String(s).trim()).filter(Boolean));
  return Object.keys(SCOPES).filter((s) => set.has(s) && allowed.includes(s));
}
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const secretToken = (prefix) => prefix + crypto.randomBytes(32).toString("base64url");
/** PKCE (RFC 7636): only S256 is accepted; verifier 43–128 unreserved chars */
function pkceOk(verifier, challenge, method = "S256") {
  if (method !== "S256" || typeof verifier !== "string" || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) || typeof challenge !== "string") return false;
  const calc = b64url(crypto.createHash("sha256").update(verifier).digest());
  return calc.length === challenge.length && crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(challenge));
}
const pkceChallenge = (verifier) => b64url(crypto.createHash("sha256").update(verifier).digest());

/** webhook signature: hex HMAC-SHA256 over `${timestamp}.${body}`; header value "t=<ts>,v1=<hex>" */
const sign = (secret, ts, body) => crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
function verifySignature(secret, header, body, { toleranceSec = 300, now = Date.now() } = {}) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(header || ""));
  if (!m || Math.abs(now / 1000 - +m[1]) > toleranceSec) return false;
  const want = sign(secret, m[1], body);
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
}
/** retry n (1-based) waits base·4^(n-1), capped (30 s, 2 min, 8 min, 32 min, 2 h 8 min with the default 30 s base) */
const backoff = (n, base = 30e3, cap = 6 * 3600e3) => Math.min(cap, base * 4 ** Math.max(0, n - 1));

/** webhook / redirect URL policy. Production: https only and no loopback/private/link-local hosts. allowPrivate (dev/test) lifts both. */
function privateHost(h) {
  h = String(h || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe80/.test(h) || h.startsWith("::ffff:");
  return false;
}
function checkUrl(u, { allowPrivate = false, allowCustomScheme = false } = {}) {
  let url; try { url = new URL(String(u)); } catch { return null; }
  if (url.username || url.password || url.hash || String(u).length > 500) return null;
  if (url.protocol === "https:") return allowPrivate || !privateHost(url.hostname) ? url.toString() : null;
  if (url.protocol === "http:") return allowPrivate || (allowCustomScheme && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.host.replace(/:\d+$/, ""))) ? url.toString() : null; // native apps may use loopback redirects
  if (allowCustomScheme && /^[a-z][a-z0-9+.-]{2,30}:$/.test(url.protocol) && !["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(url.protocol)) return url.toString();
  return null;
}

/** sliding one-minute window per key: { ok, limit, remaining, reset (s) } */
class RateWindow {
  constructor(windowMs = 60e3) { this.ms = windowMs; this.w = new Map(); }
  hit(key, limit, t = Date.now()) {
    const arr = (this.w.get(key) || []).filter((x) => t - x < this.ms);
    const ok = arr.length < limit;
    if (ok) arr.push(t);
    this.w.set(key, arr);
    if (this.w.size > 50000) for (const k of this.w.keys()) { this.w.delete(k); if (this.w.size < 40000) break; }
    const reset = Math.ceil(((arr[0] ?? t) + this.ms - t) / 1000);
    return { ok, limit, remaining: Math.max(0, limit - arr.length), reset };
  }
}

/** OpenAPI 3.0 document from route definitions: [{method, path:"/api/v1/posts/:id", summary, description, tag, scope, auth, query, body, response}] */
/** @param {any[]} defs @param {{ version?: string, server?: string }} [o] */
function openapi(defs, { version = "", server = "/" } = {}) {
  const paths = {};
  for (const d of defs) {
    const p = d.path.replace(/:(\w+)/g, "{$1}"), params = [];
    for (const m of d.path.matchAll(/:(\w+)/g)) params.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
    for (const [name, q] of Object.entries(d.query || {})) params.push({ name, in: "query", required: !!q.required, description: q.description, schema: { type: q.type || "string", ...(q.enum ? { enum: q.enum } : {}), ...(q.default !== undefined ? { default: q.default } : {}) } });
    const op = { operationId: d.id, summary: d.summary, description: d.description, tags: [d.tag || "عام"], parameters: params,
      responses: { 200: { description: "نجاح", content: { "application/json": { schema: d.response || { type: "object" } } } },
        ...(d.auth === "none" ? {} : { 401: { $ref: "#/components/responses/Unauthorized" }, 403: { $ref: "#/components/responses/Forbidden" } }),
        429: { $ref: "#/components/responses/RateLimited" } } };
    if (d.body) op.requestBody = { required: true, content: { [d.form ? "application/x-www-form-urlencoded" : "application/json"]: { schema: d.body }, ...(d.form ? { "application/json": { schema: d.body } } : {}) } };
    if (d.auth === "none") op.security = [];
    else if (d.scope) op.security = [{ bearer: [] }, { oauth2: [d.scope] }];
    if (d.scope) op["x-scope"] = d.scope;
    (paths[p] ||= {})[d.method.toLowerCase()] = op;
  }
  const err = { type: "object", properties: { error: { type: "string" }, code: { type: "string" }, requestId: { type: "string" } } };
  return {
    openapi: "3.0.3",
    info: { title: "واجهة مجتمع+ البرمجية", version: "v1 (" + version + ")", description: "واجهة REST عامة لقراءة المحتوى العام والنشر باسم المستخدم بعد موافقته. لا تصل التطبيقات أبداً إلى الرسائل الخاصة أو المحادثات المشفّرة أو محتوى المجتمعات الخاصة أو المنشورات غير العامة." },
    servers: [{ url: server }],
    tags: [{ name: "المحتوى العام" }, { name: "المستخدم" }, { name: "البوتات" }, { name: "OAuth" }],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "مفتاح API (mpk_…) أو رمز وصول OAuth (mpa_…)" },
        oauth2: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: "/oauth/authorize", tokenUrl: "/api/oauth/token", refreshUrl: "/api/oauth/token", scopes: SCOPES }, clientCredentials: { tokenUrl: "/api/oauth/token", scopes: { bot: SCOPES.bot } } } }
      },
      schemas: { Error: err },
      responses: {
        Unauthorized: { description: "رمز مفقود أو غير صالح", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Forbidden: { description: "الصلاحية (scope) غير كافية", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        RateLimited: { description: "تجاوزت حدّ المعدل؛ انظر X-RateLimit-* و Retry-After", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
      }
    },
    "x-webhook-events": EVENTS
  };
}

module.exports = { SCOPES, USER_SCOPES, EVENTS, parseScopes, pkceOk, pkceChallenge, sign, verifySignature, backoff, privateHost, checkUrl, RateWindow, openapi, sha, secretToken };
