/* Import an old STORAGE_DIR into the database-backed store (STORAGE_DRIVER=db, migration 013).
 *
 *   DATABASE_URL=postgres://… node server/scripts/import-media.js <storage.tar | storage.tar.gz | dir> [--dry-run]
 *
 * Every regular file becomes one row in `blobs`. Keys follow the app's layout: files inside a `chat/`
 * folder become `chat/<name>`, every other file is keyed by its base name (what /media/<name> serves).
 * Idempotent and non-destructive: existing keys are skipped (never overwritten), nothing is deleted
 * (neither rows nor source files), and each inserted row is read back and checked (size + sha256).
 * The per-file and total caps of the db store (STORAGE_DB_MAX_FILE_MB / STORAGE_DB_MAX_TOTAL_MB) apply.
 * Exit code: 0 when nothing failed, 1 when any file failed, 2 on bad usage. */
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  crypto = require("node:crypto");
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");

/** map a path inside the archive/directory to a storage key (null = not importable) */
function keyFor(rel) {
  const parts = rel.split(/[\\/]+/).filter(p => p && p !== ".");
  if (!parts.length || parts.some(p => p === "..")) return null;
  const name = parts[parts.length - 1];
  return parts.length >= 2 && parts[parts.length - 2] === "chat" ? "chat/" + name : name;
}

/** yields { name, data } for each regular file of a tar (ustar/GNU/pax); .gz archives are inflated in memory */
function* tarEntries(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  let off = 0,
    longName = null,
    paxPath = null;
  const cstr = (b, s, n) => {
    const x = b.subarray(s, s + n),
      z = x.indexOf(0);
    return x.subarray(0, z < 0 ? n : z).toString("utf8");
  };
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const sizeField = h.subarray(124, 136);
    const size = sizeField[0] & 0x80 ? Number(sizeField.readBigUInt64BE(4)) : parseInt(cstr(h, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 0x30);
    const prefix = h.subarray(257, 263).toString("latin1").startsWith("ustar") ? cstr(h, 345, 155) : "";
    let name = (prefix ? prefix + "/" : "") + cstr(h, 0, 100);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = cstr(data, 0, data.length); continue; }
    if (type === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === "g") continue;
    if (paxPath) name = paxPath; else if (longName) name = longName;
    paxPath = longName = null;
    if (type === "0" || type === "\0" || type === "7") yield { name, data };
  }
}
function* dirEntries(root) {
  const walk = function* (d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) yield* walk(f);
      else if (e.isFile()) yield { name: path.relative(root, f), data: fs.readFileSync(f) };
    }
  };
  yield* walk(root);
}

/** @param {{ db: any, source: string, dryRun?: boolean, log?: (s: string) => void, env?: any }} o */
async function importMedia({ db, source, dryRun = false, log = s => console.log(s), env = process.env }) {
  const { createDbStorage, mimeOf } = require("../lib/storage");
  const M = require("../lib/migrations");
  // make sure the blobs table exists (013 is CREATE … IF NOT EXISTS only; the server records it on its next start)
  const m013 = require("../migrations/013_blobs.js");
  await m013.up(db, async sql => {
    for (const s of M.render(sql, db.dialect).split(";").map(x => x.trim()).filter(Boolean)) await db.exec(s);
  });
  const store = createDbStorage(require("node:os").tmpdir() + "/mp-import-none", { db, log: { warn() {}, error() {} }, env });
  const st = fs.statSync(source);
  const entries = st.isDirectory() ? dirEntries(source) : tarEntries(source);
  const sum = { files: 0, bytes: 0, imported: 0, skipped: 0, failed: 0, mismatched: 0, failures: [] };
  const seen = new Set();
  for (const { name, data } of entries) {
    const key = keyFor(name);
    sum.files++;
    sum.bytes += data.length;
    if (!key || !store.validKey(key)) { sum.failed++; sum.failures.push({ name, error: "unsupported file name" }); continue; }
    if (seen.has(key)) { sum.skipped++; continue; }
    seen.add(key);
    const hash = sha256(data);
    try {
      const existing = await db.get("SELECT size, sha256 FROM blobs WHERE key=$1", [key]);
      if (existing) {
        sum.skipped++;
        if (Number(existing.size) !== data.length || (existing.sha256 && existing.sha256 !== hash)) { sum.mismatched++; log(`! ${key}: already in the database with different content (kept the database copy)`); }
        continue;
      }
      if (dryRun) { sum.imported++; continue; }
      let mime = mimeOf(key);
      if (key.startsWith("chat/")) mime = (await db.get("SELECT mime FROM chat_blobs WHERE id=$1", [key.slice(5)]).catch(() => null))?.mime || "application/octet-stream";
      const wrote = await store.putIfAbsent(key, data, mime);
      if (!wrote) { sum.skipped++; continue; }
      const back = await db.get("SELECT size, sha256, data AS body FROM blobs WHERE key=$1", [key]);
      const body = back && Buffer.from(back.body);
      if (!back || Number(back.size) !== data.length || back.sha256 !== hash || body.length !== data.length || sha256(body) !== hash) throw new Error("verification failed after insert");
      sum.imported++;
    } catch (e) {
      sum.failed++;
      sum.failures.push({ name, error: e.message });
    }
  }
  return sum;
}

if (require.main === module) {
  const args = process.argv.slice(2),
    dryRun = args.includes("--dry-run"),
    source = args.find(a => !a.startsWith("--"));
  if (!source || !fs.existsSync(source)) {
    console.error("usage: node server/scripts/import-media.js <storage.tar|storage.tar.gz|dir> [--dry-run]   (DATABASE_URL selects the database)");
    process.exit(2);
  }
  (async () => {
    const db = await require("../lib/db").connect(require("../lib/secrets").secret("DATABASE_URL") || undefined);
    const s = await importMedia({ db, source, dryRun });
    await db.close();
    for (const f of s.failures.slice(0, 50)) console.log(`✗ ${f.name}: ${f.error}`);
    console.log(`${dryRun ? "[dry-run] " : ""}files: ${s.files}  bytes: ${s.bytes}  imported: ${s.imported}  skipped: ${s.skipped}  failed: ${s.failed}${s.mismatched ? `  mismatched: ${s.mismatched}` : ""}`);
    process.exitCode = s.failed ? 1 : 0;
  })().catch(e => { console.error("import failed:", e.message); process.exit(1); });
}
module.exports = { importMedia, keyFor, tarEntries };
