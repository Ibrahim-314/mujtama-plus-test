/* Object storage adapter (Phase 6). Local disk by default; any S3-compatible store (Cloudflare R2,
 * AWS S3, MinIO, Backblaze) when S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY are set.
 * Requests are signed with AWS Signature V4 using node:crypto only. MEDIA_CDN_URL puts a CDN in front. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { secret } = require("./secrets");
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
const hash = s => crypto.createHash("sha256").update(s).digest("hex");
/** @param {{ method: string, url: string, body?: any, region: string, accessKey: string, secretKey: string, contentType?: string }} o */
function s3Sign({ method, url, body = "", region, accessKey, secretKey, contentType = "" }) {
  const u = new URL(url),
    t = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
    d = t.slice(0, 8);
  const payload = hash(body || "");
  const headers = { host: u.host, "x-amz-content-sha256": payload, "x-amz-date": t };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort(),
    signed = names.join(";");
  const canon = [
    method,
    u.pathname.split("/").map(encodeURIComponent).join("/").replace(/%2F/g, "/"),
    u.searchParams.toString(),
    names.map(n => `${n}:${headers[n]}\n`).join(""),
    signed,
    payload
  ].join("\n");
  const scope = `${d}/${region}/s3/aws4_request`,
    sts = ["AWS4-HMAC-SHA256", t, scope, hash(canon)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + secretKey, d), region), "s3"), "aws4_request");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${crypto.createHmac("sha256", key).update(sts).digest("hex")}`;
  delete headers.host;
  return headers;
}
/* Database-backed storage (STORAGE_DRIVER=db): blobs live in the `blobs` table (migration 013) of the main
 * database (PostgreSQL BYTEA / SQLite BLOB), so uploads survive redeploys on hosts whose filesystem is
 * ephemeral. Guards keep the database volume from filling: a per-file cap (STORAGE_DB_MAX_FILE_MB, default 25)
 * and a total cap (STORAGE_DB_MAX_TOTAL_MB, default 300) refuse new writes with HTTP 413; a warning is logged
 * once usage crosses STORAGE_DB_WARN_PCT (default 80) percent of the total cap.
 * Read-through: a key missing from the database but present on local disk (files written before the switch)
 * is served from disk and copied into the database; the disk file is never deleted by that copy. */
const KEY_RE = /^[\w.-]{1,120}(\/[\w.-]{1,120})?$/;
const validKey = key => typeof key === "string" && KEY_RE.test(key) && !key.split("/").some(p => p === "." || p === "..");
function mimeOf(key) {
  const { MIME } = require("./http");
  return MIME[path.extname(key).toLowerCase()] || "application/octet-stream";
}
/** @param {string} localDir @param {{ db?: any, log?: any, env?: Record<string, string | undefined>, driver?: string }} [opts] */
function createDbStorage(localDir, { db, log = console, env = process.env } = {}) {
  if (!db) throw new Error("STORAGE_DRIVER=db needs a database handle");
  const { HttpError } = require("./core");
  const MB = 1024 * 1024;
  const maxFile = Math.round(+(env.STORAGE_DB_MAX_FILE_MB || 25) * MB),
    maxTotal = Math.round(+(env.STORAGE_DB_MAX_TOTAL_MB || 300) * MB),
    warnPct = +(env.STORAGE_DB_WARN_PCT || 80);
  const cdn = env.MEDIA_CDN_URL;
  let warned = false;
  const diskFile = key => {
    const f = path.normalize(path.join(localDir, key));
    if (!f.startsWith(path.normalize(localDir) + path.sep)) throw new Error("bad key");
    return f;
  };
  const onDisk = key => {
    try {
      const f = diskFile(key),
        st = fs.statSync(f);
      return st.isFile() ? { file: f, size: st.size } : null;
    } catch {
      return null;
    }
  };
  const toBuf = v => (v == null ? null : Buffer.isBuffer(v) ? v : Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  async function usage() {
    const r = await db.get("SELECT COALESCE(SUM(size),0) AS total, COUNT(*) AS files FROM blobs");
    return { total: Number(r.total), files: Number(r.files), maxTotal, maxFile, warnPct };
  }
  /** throws 413 when the write would break a cap; `replacing` is the size of a row being overwritten */
  async function guard(size, replacing = 0) {
    if (size > maxFile) throw new HttpError(413, "الملف أكبر من الحد المسموح للتخزين", "file_too_large");
    const { total } = await usage(),
      next = total - replacing + size;
    if (next > maxTotal) {
      log.error?.("storage full: upload refused", { total, size, maxTotal });
      throw new HttpError(413, "مساحة التخزين ممتلئة مؤقتاً", "storage_full");
    }
    if (!warned && next >= (maxTotal * warnPct) / 100) {
      warned = true;
      log.warn?.("storage usage above warning threshold", { total: next, maxTotal, pct: Math.round((next / maxTotal) * 100) });
    } else if (warned && next < (maxTotal * warnPct) / 100) warned = false;
  }
  async function insert(key, buf, mime, { overwrite }) {
    const sha = hash(buf),
      at = new Date().toISOString();
    const sql = overwrite
      ? "INSERT INTO blobs(key,mime,size,sha256,data,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(key) DO UPDATE SET mime=excluded.mime, size=excluded.size, sha256=excluded.sha256, data=excluded.data, created_at=excluded.created_at"
      : "INSERT INTO blobs(key,mime,size,sha256,data,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(key) DO NOTHING";
    return (await db.run(sql, [key, mime || mimeOf(key), buf.length, sha, buf, at])).changes;
  }
  /** read-through: copy a disk-only file into the database (never deletes the disk file) */
  async function adopt(key) {
    const d = onDisk(key);
    if (!d) return null;
    const buf = fs.readFileSync(d.file);
    try {
      await guard(buf.length);
      await insert(key, buf, mimeOf(key), { overwrite: false });
    } catch (e) {
      log.warn?.("storage read-through copy skipped", { key, err: e.message });
    }
    return buf;
  }
  const api = {
    kind: "db",
    maxFile,
    maxTotal,
    usage,
    validKey,
    localPath: key => diskFile(key),
    async put(key, body, contentType) {
      if (!validKey(key)) throw new Error("bad key");
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const old = await db.get("SELECT size FROM blobs WHERE key=$1", [key]);
      await guard(buf.length, old ? Number(old.size) : 0);
      await insert(key, buf, contentType, { overwrite: true });
    },
    /** insert only when the key is absent (used by the importer); returns true when a row was written */
    async putIfAbsent(key, body, contentType) {
      if (!validKey(key)) throw new Error("bad key");
      if (await db.get("SELECT 1 AS x FROM blobs WHERE key=$1", [key])) return false;
      await guard(body.length);
      return (await insert(key, body, contentType, { overwrite: false })) > 0;
    },
    async get(key) {
      if (!validKey(key)) return null;
      const r = await db.get("SELECT data AS body FROM blobs WHERE key=$1", [key]);
      if (r) return toBuf(r.body);
      return adopt(key);
    },
    /** metadata, with read-through; `file` is set when the bytes could only be served from disk */
    async head(key) {
      if (!validKey(key)) return null;
      const r = await db.get("SELECT size, mime, sha256 FROM blobs WHERE key=$1", [key]);
      if (r) return { size: Number(r.size), mime: r.mime, sha256: r.sha256, file: null };
      const d = onDisk(key);
      if (!d) return null;
      await adopt(key);
      const r2 = await db.get("SELECT size, mime, sha256 FROM blobs WHERE key=$1", [key]);
      return r2 ? { size: Number(r2.size), mime: r2.mime, sha256: r2.sha256, file: null } : { size: d.size, mime: mimeOf(key), sha256: null, file: d.file };
    },
    /** inclusive byte range [start, end] */
    async read(key, start, end) {
      if (!validKey(key)) return null;
      const r = await db.get("SELECT SUBSTR(data, $2, $3) AS body FROM blobs WHERE key=$1", [key, start + 1, end - start + 1]);
      return r ? toBuf(r.body) : null;
    },
    async has(key) {
      return validKey(key) && !!(await db.get("SELECT 1 AS x FROM blobs WHERE key=$1", [key]));
    },
    /** explicit deletion (chat expiry, removed attachments) removes the row and any disk copy, as the local driver does */
    async del(key) {
      if (!validKey(key)) return;
      await db.run("DELETE FROM blobs WHERE key=$1", [key]);
      try {
        fs.unlinkSync(diskFile(key));
      } catch {}
    },
    publicUrl: key => (cdn ? `${cdn.replace(/\/$/, "")}/${key}` : `/media/${key}`)
  };
  return api;
}
/** @param {string} localDir @param {{ db?: any, log?: any, env?: Record<string, string | undefined>, driver?: string }} [opts] */
function createStorage(localDir, opts = {}) {
  if ((opts.driver || process.env.STORAGE_DRIVER) === "db") {
    fs.mkdirSync(localDir, { recursive: true });
    return createDbStorage(localDir, opts);
  }
  const endpoint = process.env.S3_ENDPOINT,
    bucket = process.env.S3_BUCKET,
    cdn = process.env.MEDIA_CDN_URL;
  if (endpoint && bucket) {
    const region = process.env.S3_REGION || "auto",
      accessKey = secret("S3_ACCESS_KEY"),
      secretKey = secret("S3_SECRET_KEY");
    const url = key => `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`;
    return {
      kind: "s3",
      async put(key, body, contentType) {
        const r = await fetch(url(key), {
          method: "PUT",
          body,
          headers: s3Sign({ method: "PUT", url: url(key), body, region, accessKey, secretKey, contentType })
        });
        if (!r.ok) throw new Error("storage put failed " + r.status);
      },
      async get(key) {
        const r = await fetch(url(key), { headers: s3Sign({ method: "GET", url: url(key), region, accessKey, secretKey }) });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      },
      async del(key) {
        await fetch(url(key), { method: "DELETE", headers: s3Sign({ method: "DELETE", url: url(key), region, accessKey, secretKey }) });
      },
      publicUrl: key => (cdn ? `${cdn.replace(/\/$/, "")}/${key}` : `/media/${key}`)
    };
  }
  fs.mkdirSync(localDir, { recursive: true });
  const file = key => {
    const f = path.normalize(path.join(localDir, key));
    if (!f.startsWith(path.normalize(localDir))) throw new Error("bad key");
    return f;
  };
  return {
    kind: "local",
    async put(key, body) {
      fs.mkdirSync(path.dirname(file(key)), { recursive: true });
      fs.writeFileSync(file(key), body);
    },
    async get(key) {
      try {
        return fs.readFileSync(file(key));
      } catch {
        return null;
      }
    },
    async del(key) {
      try {
        fs.unlinkSync(file(key));
      } catch {}
    },
    publicUrl: key => (cdn ? `${cdn.replace(/\/$/, "")}/${key}` : `/media/${key}`)
  };
}
module.exports = { createStorage, createDbStorage, s3Sign, validKey, mimeOf };
