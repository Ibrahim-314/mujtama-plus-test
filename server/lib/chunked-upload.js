/* v2.60 M3 — resumable chunked uploads (server side). No DB table: each upload is a temp directory
 *   <storageDir>/tmp/uploads/<uploadId>/manifest.json + <index>.part
 * Manifests are cached in memory and re-read from disk on boot, so a client can resume after a restart
 * (same disk). Abandoned uploads expire (TTL since the last chunk) and are swept on boot and on an interval. */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");

const ID_RE = /^up_[a-f0-9]{24}$/;

/**
 * @param {{ dir: string, chunkSize?: number, ttlMs?: number, maxActivePerUser?: number, log?: any }} o
 */
function createChunkStore(o) {
  const dir = o.dir, chunkSize = o.chunkSize || 5 * 1024 * 1024, ttlMs = o.ttlMs || 24 * 3600e3, maxActive = o.maxActivePerUser || 5;
  // created lazily by the first init(): an idle server leaves nothing on disk (storage-db: media is served from the database)
  const list = (/** @type {any} */ o) => { try { return /** @type {any[]} */ (fs.readdirSync(dir, o)); } catch (e) { if (e && e.code === "ENOENT") return []; throw e; } };
  /** @type {Map<string, any>} */
  const mem = new Map();
  const updir = (uid) => path.join(dir, uid);
  const save = (m) => { const f = path.join(updir(m.id), "manifest.json"), t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(m)); fs.renameSync(t, f); };
  const load = (uid) => {
    if (!ID_RE.test(uid)) return null;
    if (mem.has(uid)) return mem.get(uid);
    try { const m = JSON.parse(fs.readFileSync(path.join(updir(uid), "manifest.json"), "utf8")); mem.set(uid, m); return m; } catch { return null; }
  };
  const expired = (m, t = Date.now()) => t - (m.updatedAt || m.createdAt || 0) > ttlMs;
  const expectedLen = (m, i) => (i < m.total - 1 ? m.chunkSize : m.size - (m.total - 1) * m.chunkSize);
  function drop(uid) { mem.delete(uid); try { fs.rmSync(updir(uid), { recursive: true, force: true }); } catch { /* already gone */ } }
  /** remove expired (or broken) upload dirs; returns how many were removed */
  function sweep(t = Date.now()) {
    let n = 0;
    for (const e of /** @type {import("fs").Dirent[]} */ (list({ withFileTypes: true }))) {
      if (!e.isDirectory()) continue;
      const m = ID_RE.test(e.name) ? load(e.name) : null;
      if (!m) { let st = null; try { st = fs.statSync(path.join(dir, e.name)); } catch { /* raced */ } if (!st || t - st.mtimeMs > ttlMs) { fs.rmSync(path.join(dir, e.name), { recursive: true, force: true }); n++; } continue; }
      if (expired(m, t)) { drop(m.id); n++; }
    }
    return n;
  }
  function active(owner) { let n = 0; for (const e of /** @type {string[]} */ (list(undefined))) { const m = load(e); if (m && m.owner === owner && !m.done && !expired(m)) n++; } return n; }
  function init({ owner, filename, mime, kind, size }) {
    if (active(owner) >= maxActive) return null;
    const m = { id: "up_" + crypto.randomBytes(12).toString("hex"), owner, filename, mime, kind, size, chunkSize, total: Math.max(1, Math.ceil(size / chunkSize)), received: [], createdAt: Date.now(), updatedAt: Date.now(), done: null };
    fs.mkdirSync(updir(m.id), { recursive: true }); save(m); mem.set(m.id, m);
    return m;
  }
  /** owner-scoped lookup: another user's (or an expired) upload is simply not there */
  function get(uid, owner) { const m = load(String(uid || "")); if (!m || m.owner !== owner) return null; if (!m.done && expired(m)) { drop(m.id); return null; } return m; }
  /** idempotent: the same index can be sent again (a retried request); the newest bytes win atomically */
  function putChunk(m, i, buf) {
    const f = path.join(updir(m.id), i + ".part"), t = f + "." + crypto.randomBytes(4).toString("hex");
    fs.writeFileSync(t, buf); fs.renameSync(t, f);
    if (!m.received.includes(i)) { m.received.push(i); m.received.sort((a, b) => a - b); }
    m.updatedAt = Date.now(); save(m);
  }
  const missing = (m) => { const have = new Set(m.received), out = []; for (let i = 0; i < m.total; i++) if (!have.has(i)) out.push(i); return out; };
  function assemble(m) {
    const parts = []; let len = 0;
    for (let i = 0; i < m.total; i++) { const b = fs.readFileSync(path.join(updir(m.id), i + ".part")); if (b.length !== expectedLen(m, i)) throw new Error("chunk length mismatch"); parts.push(b); len += b.length; }
    if (len !== m.size) throw new Error("size mismatch");
    return Buffer.concat(parts, len);
  }
  /** after a successful complete the parts are deleted; the small manifest stays (done = result) so a retried complete is idempotent until it expires */
  function finish(m, result) {
    for (const f of fs.readdirSync(updir(m.id))) if (f.endsWith(".part") || f.includes(".part.")) fs.rmSync(path.join(updir(m.id), f), { force: true });
    m.done = result; m.updatedAt = Date.now(); save(m);
  }
  const view = (m) => ({ uploadId: m.id, filename: m.filename, mime: m.mime, kind: m.kind, size: m.size, chunkSize: m.chunkSize, totalChunks: m.total, received: [...m.received], missing: missing(m), expiresAt: new Date((m.updatedAt || m.createdAt) + ttlMs).toISOString(), completed: !!m.done, ...(m.done ? { media: m.done } : {}) });
  return { dir, chunkSize, ttlMs, init, get, putChunk, missing, expectedLen, assemble, finish, drop, sweep, view };
}

module.exports = { createChunkStore };
