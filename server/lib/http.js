/* Minimal HTTP framework: router, JSON/raw bodies, cookies, security headers, static files, SSE hub. */
const fs = require("node:fs"),
  path = require("node:path");
const { HttpError } = require("./core");

class Router {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
    this.routes.push({ method, re, keys, handler, opts });
    return this;
  }
  get(p, h, o) {
    return this.add("GET", p, h, o);
  }
  post(p, h, o) {
    return this.add("POST", p, h, o);
  }
  put(p, h, o) {
    return this.add("PUT", p, h, o);
  }
  patch(p, h, o) {
    return this.add("PATCH", p, h, o);
  }
  del(p, h, o) {
    return this.add("DELETE", p, h, o);
  }
  match(method, url) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = url.match(r.re);
      if (m) {
        // v2.68: a malformed %-escape must never throw (it crashed the process via observability's close listener)
        try { return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; }
        catch { return undefined; }
      }
    }
  }
}
const parseCookies = (h = "") =>
  Object.fromEntries(
    h
      .split(";")
      .map(s => s.trim().split("="))
      .filter(x => x[0])
      .map(([k, ...v]) => { const raw = v.join("="); try { return [k, decodeURIComponent(raw)]; } catch { return [k, raw]; } }) // v2.68: malformed cookie never throws
  );
function readBody(req, limit) {
  return new Promise((res, rej) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) {
        rej(new HttpError(413, "الملف أكبر من المسموح", "too_large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => res(Buffer.concat(chunks)));
    req.on("error", rej);
  });
}
/* Content-Security-Policy (phase 36b, Pi App Studio).
 * • script-src: our origin + the Pi SDK; no 'unsafe-inline' — inline <script> blocks in served HTML files are allowed
 *   by their sha256 hash only (computed per file in serveStatic), inline event handlers are not allowed at all.
 * • connect-src: explicit list (Pi Platform API + socialchain.app used by the SDK); the App Studio login exchange is
 *   server-side, so its origin is NOT listed. • frame-ancestors: the Pi Browser / Pi sandbox hosts (replaces X-Frame-Options;
 *   CSP_FRAME_ANCESTORS_EXTRA may add explicit https origins, a bare "*" is ignored). */
const PI_SDK_ORIGIN = "https://sdk.minepi.com";
const FRAME_ANCESTORS = ["'self'", "https://*.pinet.com", "https://*.minepi.com"];
const extraAncestors = String(process.env.CSP_FRAME_ANCESTORS_EXTRA || "")
  .split(/\s+/)
  .filter(o => /^https:\/\/(\*\.)?[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i.test(o));
function buildCsp(scriptHashes = [], scriptExtra = "") {
  const connect = ["'self'", "https://api.minepi.com", "https://socialchain.app", ...(process.env.LIVEKIT_URL ? [process.env.LIVEKIT_URL] : [])];
  return [
    "default-src 'self'",
    `script-src 'self' ${PI_SDK_ORIGIN}${scriptExtra}${scriptHashes.map(h => ` 'sha256-${h}'`).join("")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:", // map tiles (phase 66: https://tile.openstreetmap.org) are plain <img>; no connect-src needed
    "media-src 'self' blob:",
    `connect-src ${connect.join(" ")}`,
    `frame-src 'self' ${PI_SDK_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${[...FRAME_ANCESTORS, ...extraAncestors].join(" ")}`
  ].join("; ");
}
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // phase 66: geolocation for our own origin only — the nearby map turns it into a ~5 km geohash ON the device, on request
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self)",
  "Content-Security-Policy": buildCsp(),
  // v2.51: HSTS in production (HTTPS only behind Railway's edge); HSTS=1 forces it elsewhere, HSTS=0 turns it off
  ...((process.env.HSTS === "1" || (process.env.NODE_ENV === "production" && process.env.HSTS !== "0")) ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {})
};
/** sha256 (base64) of every executable inline <script> of an HTML document (data blocks such as ld+json are skipped) */
function inlineScriptHashes(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || "";
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !/^(text\/javascript|module|application\/javascript)$/.test(type)) continue;
    out.push(require("node:crypto").createHash("sha256").update(m[2], "utf8").digest("base64"));
  }
  return [...new Set(out)];
}
const htmlCsp = new Map(); // file → { mtime, csp }
function cspForHtml(file) {
  const mtime = fs.statSync(file).mtimeMs, hit = htmlCsp.get(file);
  if (hit && hit.mtime === mtime) return hit.csp;
  /* v2.105: the Godot game page (/nabd/engine/) compiles its WebAssembly engine and lets the game script call JavaScriptBridge.eval
   * (touch detection, query string, postMessage to the app), so ONLY that page gets 'wasm-unsafe-eval' 'unsafe-eval'. */
  const game = /[\\/]nabd[\\/]engine[\\/]index\.html$/.test(file);
  const csp = buildCsp(inlineScriptHashes(fs.readFileSync(file, "utf8")), game ? " 'wasm-unsafe-eval' 'unsafe-eval'" : "");
  htmlCsp.set(file, { mtime, csp });
  return csp;
}
/** Set-Cookie value. Production (secure): SameSite=None; Secure so the session survives inside the Pi Browser / Pi sandbox
 * frames (cross-site); local http dev/tests: SameSite=Lax (Secure cookies are dropped on plain http). Always HttpOnly. */
const cookieHeader = (k, v, maxAge, secure) => `${k}=${encodeURIComponent(v)}; Path=/; HttpOnly; ${secure ? "SameSite=None; Secure" : "SameSite=Lax"}; Max-Age=${maxAge}`;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".vtt": "text/vtt; charset=utf-8",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".xml": "application/xml; charset=utf-8"
};
/* Static files (Phase 5): precompressed .br/.gz variants, immutable caching for content-hashed
 * assets (/assets/name-HASH.ext), no-cache for HTML and the service worker, preload hints. */
const HASHED = /-[A-Za-z0-9_-]{8,}\.(js|css|woff2|png|webp|avif|svg)$/;
let preloadLinks = null;
function serveStatic(root, req, res, urlPath) {
  const rel = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(path.normalize(root))) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase(),
    base = path.basename(file);
  /** @type {Record<string, string>} */
  const headers = { ...SEC_HEADERS, "Content-Type": MIME[ext] || "application/octet-stream", Vary: "Accept-Encoding" };
  headers["Cache-Control"] =
    ext === ".html" || base === "sw.js" || /[\\/]nabd[\\/]engine[\\/]/.test(file) ? "no-cache" : HASHED.test(base) ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  Object.assign(headers, require("./scale").cdnHeaders({ html: ext === ".html", hashed: HASHED.test(base), sw: base === "sw.js" })); // Phase 48: CDN_CACHE=1
  if (base === "sw.js") headers["Service-Worker-Allowed"] = "/";
  if (ext === ".html") {
    headers["Content-Security-Policy"] = cspForHtml(file);
    if (preloadLinks === null) {
      try {
        preloadLinks = JSON.parse(fs.readFileSync(path.join(root, "preload.json"), "utf8"))
          .map(p => `<${p.href}>; rel=preload; as=${p.as}`)
          .join(", ");
      } catch {
        preloadLinks = "";
      }
    }
    if (preloadLinks && !/[\\/]nabd[\\/]/.test(file)) headers.Link = preloadLinks; // v2.105: not on the game page
  }
  const ae = String(req.headers["accept-encoding"] || "");
  let serve = file;
  if (/\.(js|css|html|svg|json|wasm|pck)$/.test(ext)) { // v2.105: the game engine/pack ship pre-gzipped
    if (/\bbr\b/.test(ae) && fs.existsSync(file + ".br")) {
      serve = file + ".br";
      headers["Content-Encoding"] = "br";
    } else if (/\bgzip\b/.test(ae) && fs.existsSync(file + ".gz")) {
      serve = file + ".gz";
      headers["Content-Encoding"] = "gzip";
    }
  }
  if (/[\\/]nabd[\\/]engine[\\/]/.test(file)) { // v2.107.4: game files revalidate every load (phones kept a stale pack for an hour)
    try {
      const stt = fs.statSync(serve);
      const tag = '"' + stt.size.toString(36) + "-" + Math.floor(stt.mtimeMs).toString(36) + '"';
      headers.ETag = tag;
      if (req.headers["if-none-match"] === tag) { res.writeHead(304, { ETag: tag, "Cache-Control": "no-cache" }); res.end(); return true; }
    } catch (e) {}
  }
  res.writeHead(200, headers);
  fs.createReadStream(serve).pipe(res);
  return true;
}

/* Realtime hub (Server-Sent Events). Swap for WebSocket/Redis pub-sub when scaling horizontally. */
class Realtime {
  constructor() {
    this.clients = new Map();
  }
  attach(userId, res) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    const set = this.clients.get(userId) || new Set();
    set.add(res);
    this.clients.set(userId, set);
    const ping = setInterval(() => res.write(": ping\n\n"), 25e3);
    res.on("close", () => {
      clearInterval(ping);
      set.delete(res);
      if (!set.size) this.clients.delete(userId);
    });
  }
  send(userId, type, data = {}) {
    for (const r of this.clients.get(userId) || []) r.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  broadcast(type, data = {}) {
    for (const uid of this.clients.keys()) this.send(uid, type, data);
  }
  online() {
    return this.clients.size;
  }
}
module.exports = { Router, parseCookies, readBody, serveStatic, SEC_HEADERS, Realtime, MIME, buildCsp, inlineScriptHashes, cookieHeader };
