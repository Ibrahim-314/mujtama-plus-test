#!/usr/bin/env node
/* Disaster-recovery drill (phase 49). A backup is only real once it has been restored.
 *
 *   node server/scripts/dr-drill.js backup  [--out DIR]                      portable encrypted logical backup of DATABASE_URL
 *   node server/scripts/dr-drill.js drill   [--file F] [--scratch URL] [--report-url URL]
 *
 * backup → BACKUP_DIR/mujtama-<ts>.mpb.enc (+ .sha256): gzip'd JSON lines (manifest with per-table row counts + rows),
 *          AES-256-GCM, key = scrypt(passphrase). Read-only on the source (SELECT only).
 * drill  → newest backup in BACKUP_DIR (or --file), checks the sha256, decrypts, restores into a SCRATCH database, runs the
 *          migrations there, verifies every table's row count against the manifest, then drops the scratch copy.
 *          Scratch: --scratch / DR_SCRATCH_URL. Default: a temporary SQLite file. A PostgreSQL scratch must be a database whose
 *          name contains scratch|drill|restore|test, must differ from DATABASE_URL, and is wiped (schema public) first.
 *          It never writes to DATABASE_URL. --report-url posts only counts/ok (Authorization: Bearer $METRICS_TOKEN).
 * Passphrase: BACKUP_PASSPHRASE_FILE (default /run/secrets/backup_passphrase). pg_dump backups (*.dump.enc) keep using
 * ops/backup/restore-test.sh, which needs the PostgreSQL client tools. Exit code 0 = drill passed. */
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), zlib = require("node:zlib"), crypto = require("node:crypto");
const { connect } = require("../lib/db");
const M = require("../lib/migrations");
const MAGIC = Buffer.from("MPB1");

const qi = n => (/^[a-z_][a-z0-9_]*$/i.test(n) ? `"${n}"` : (() => { throw new Error("bad identifier " + n); })());
function passphrase(o = {}) {
  if (o.passphrase) return o.passphrase;
  const f = process.env.BACKUP_PASSPHRASE_FILE || "/run/secrets/backup_passphrase";
  if (!fs.existsSync(f)) throw new Error("passphrase file missing: " + f);
  return fs.readFileSync(f, "utf8").trim();
}
function encrypt(buf, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv), body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}
function decrypt(buf, pass) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("not a mujtama backup (MPB1)");
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48), key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(48)), d.final()]);
}
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
async function tables(db) {
  const rows = db.dialect === "postgres" ? await db.all("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename") : await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map(r => r.name).filter(n => /^[a-z_][a-z0-9_]*$/i.test(n));
}
async function fkDeps(db, names) {
  const deps = Object.fromEntries(names.map(n => [n, new Set()]));
  if (db.dialect === "postgres") {
    for (const r of await db.all("SELECT tc.table_name t, ccu.table_name ref FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'"))
      if (deps[r.t] && r.ref !== r.t && deps[r.ref]) deps[r.t].add(r.ref);
  } else for (const n of names) for (const r of await db.all(`PRAGMA foreign_key_list(${qi(n)})`)) if (r.table !== n && deps[r.table]) deps[n].add(r.table);
  const out = [], seen = new Set(), visiting = new Set();
  const visit = n => { if (seen.has(n) || visiting.has(n)) return; visiting.add(n); for (const d of deps[n]) visit(d); visiting.delete(n); seen.add(n); out.push(n); };
  names.forEach(visit);
  return out;
}
const packVal = v => (Buffer.isBuffer(v) || v instanceof Uint8Array ? { $b64: Buffer.from(v).toString("base64") } : v);
const unpackVal = v => (v && typeof v === "object" && typeof v.$b64 === "string" && Object.keys(v).length === 1 ? Buffer.from(v.$b64, "base64") : v);

async function backup({ databaseUrl = process.env.DATABASE_URL, out = process.env.BACKUP_DIR || "/backups", passphrase: pp, log = console.log } = {}) {
  const t0 = Date.now(), db = await connect(databaseUrl);
  try {
    const names = await tables(db), lines = [], counts = {};
    for (const t of names) {
      let off = 0, n = 0;
      for (;;) {
        const rows = await db.all(`SELECT * FROM ${qi(t)} ORDER BY 1 LIMIT 1000 OFFSET ${off}`);
        for (const r of rows) { for (const k in r) r[k] = packVal(r[k]); lines.push(JSON.stringify({ t, r })); }
        n += rows.length; off += rows.length; if (rows.length < 1000) break;
      }
      counts[t] = n;
    }
    const migrations = names.includes("schema_migrations") ? (await db.all("SELECT id FROM schema_migrations ORDER BY id")).map(r => r.id) : [];
    const manifest = { app: "mujtama-plus", format: 1, dialect: db.dialect, createdAt: new Date().toISOString(), tables: counts, migrations };
    const enc = encrypt(zlib.gzipSync(Buffer.from([JSON.stringify({ manifest }), ...lines].join("\n"))), passphrase({ passphrase: pp }));
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `mujtama-${manifest.createdAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.mpb.enc`);
    fs.writeFileSync(file, enc, { mode: 0o600 }); fs.writeFileSync(file + ".sha256", `${sha256(enc)}  ${path.basename(file)}\n`);
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    log(`backup ok: ${file} tables=${names.length} rows=${rows} bytes=${enc.length} ms=${Date.now() - t0}`);
    return { file, tables: names.length, rows, bytes: enc.length };
  } finally { await db.close(); }
}

function latest(dir) {
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => /^mujtama-.*\.mpb\.enc$/.test(x)).sort() : [];
  if (!f.length) throw new Error("no *.mpb.enc backup in " + dir);
  return path.join(dir, f[f.length - 1]);
}
function assertSafeScratch(scratch, source) {
  const norm = u => String(u || "").replace(/\/+$/, "");
  if (source && norm(scratch) === norm(source)) throw new Error("refusing: scratch database is the source database");
  if (process.env.DATABASE_URL && norm(scratch) === norm(process.env.DATABASE_URL)) throw new Error("refusing: scratch database is DATABASE_URL");
  if (scratch.startsWith("postgres")) {
    const name = decodeURIComponent(new URL(scratch).pathname.slice(1));
    if (!/(scratch|drill|restore|test)/i.test(name)) throw new Error(`refusing: PostgreSQL scratch database name "${name}" must contain scratch|drill|restore|test`);
  }
}

async function drill({ file, dir = process.env.BACKUP_DIR || "/backups", scratch = process.env.DR_SCRATCH_URL, passphrase: pp, reportUrl, keep = false, log = console.log, fetchImpl = globalThis.fetch } = {}) {
  const t0 = Date.now(); file = file || latest(dir);
  let tmpDir = null;
  if (!scratch) { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-drill-")); scratch = "sqlite:" + path.join(tmpDir, "scratch.sqlite"); }
  assertSafeScratch(scratch, process.env.DATABASE_URL);
  const report = { ok: false, backup: path.basename(file), dialect: scratch.startsWith("postgres") ? "postgres" : "sqlite", tables: 0, rows: 0, ms: 0, mismatches: [] };
  let db = null;
  try {
    const raw = fs.readFileSync(file);
    if (fs.existsSync(file + ".sha256")) { const want = fs.readFileSync(file + ".sha256", "utf8").split(/\s+/)[0]; if (want !== sha256(raw)) throw new Error("sha256 mismatch — backup file is corrupt"); }
    const lines = zlib.gunzipSync(decrypt(raw, passphrase({ passphrase: pp }))).toString("utf8").split("\n");
    const { manifest } = JSON.parse(lines[0]);
    if (manifest?.app !== "mujtama-plus") throw new Error("unexpected manifest");
    db = await connect(scratch);
    if (db.dialect === "postgres") await db.exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
    await M.up(db);
    const have = new Set(await tables(db)), byTable = {};
    for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const { t, r } = JSON.parse(lines[i]); (byTable[t] ||= []).push(r); }
    const order = await fkDeps(db, Object.keys(manifest.tables).filter(t => have.has(t) && t !== "schema_migrations"));
    for (const t of order) {
      const rows = byTable[t] || []; if (!rows.length) continue;
      const cols = (db.dialect === "postgres" ? (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t])) : await db.all(`PRAGMA table_info(${qi(t)})`)).map(c => c.name);
      const use = cols.filter(c => rows.some(r => c in r));
      await db.exec(`DELETE FROM ${qi(t)}`);
      const per = Math.max(1, Math.floor(900 / Math.max(1, use.length)));
      await db.tx(async tx => {
        for (let i = 0; i < rows.length; i += per) {
          const chunk = rows.slice(i, i + per), params = [];
          const values = chunk.map(r => "(" + use.map(c => { params.push(unpackVal(r[c] === undefined ? null : r[c])); return "$" + params.length; }).join(",") + ")").join(",");
          await tx.run(`INSERT INTO ${qi(t)} (${use.map(qi).join(",")}) VALUES ${values}`, params);
        }
      });
      if (db.dialect === "postgres" && use.includes("id")) { const s = await db.get("SELECT pg_get_serial_sequence($1,'id') s", [t]).catch(() => null); if (s?.s) await db.run(`SELECT setval('${s.s.replace(/'/g, "")}', COALESCE((SELECT MAX(id) FROM ${qi(t)}),1))`); }
    }
    for (const [t, n] of Object.entries(manifest.tables)) {
      if (t === "schema_migrations") continue;
      if (!have.has(t)) { report.mismatches.push({ table: t, expected: n, got: null }); continue; }
      const got = Number((await db.get(`SELECT COUNT(*) n FROM ${qi(t)}`)).n);
      if (got !== n) report.mismatches.push({ table: t, expected: n, got });
      report.tables++; report.rows += got;
    }
    const applied = new Set((await db.all("SELECT id FROM schema_migrations")).map(r => r.id));
    const missing = (manifest.migrations || []).filter(m => !applied.has(m));
    if (missing.length) report.mismatches.push({ table: "schema_migrations", missing });
    report.users = Number((await db.get("SELECT COUNT(*) n FROM users")).n); report.posts = Number((await db.get("SELECT COUNT(*) n FROM posts")).n);
    report.ok = !report.mismatches.length;
  } catch (e) { report.error = e.message; }
  finally {
    if (db) { if (!keep && db.dialect === "postgres") await db.exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public").catch(() => { }); await db.close(); }
    if (tmpDir && !keep) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  report.ms = Date.now() - t0;
  log(`${report.ok ? "drill ok" : "DRILL FAILED"}: ${report.backup} → ${report.dialect} scratch tables=${report.tables} rows=${report.rows} users=${report.users ?? "?"} posts=${report.posts ?? "?"} ms=${report.ms}${report.error ? " error=" + report.error : ""}${report.mismatches.length ? " mismatches=" + JSON.stringify(report.mismatches) : ""}`);
  if (reportUrl) {
    try { await fetchImpl(reportUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", ...(process.env.METRICS_TOKEN ? { Authorization: "Bearer " + process.env.METRICS_TOKEN } : {}) }, body: JSON.stringify({ ok: report.ok, backup: report.backup, dialect: report.dialect, tables: report.tables, rows: report.rows, ms: report.ms, detail: { users: report.users, posts: report.posts, mismatches: report.mismatches.slice(0, 20), error: report.error } }) }); }
    catch (e) { log("report failed: " + e.message); }
  }
  return report;
}

module.exports = { backup, drill, encrypt, decrypt, assertSafeScratch };
if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2), arg = k => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  process.env.LOG_SILENT = process.env.LOG_SILENT || "1";
  const run = cmd === "backup" ? backup({ out: arg("out") }) : cmd === "drill" ? drill({ file: arg("file"), scratch: arg("scratch"), reportUrl: arg("report-url"), keep: rest.includes("--keep") }) : null;
  if (!run) { console.error("usage: dr-drill.js backup [--out DIR] | drill [--file F] [--scratch URL] [--report-url URL] [--keep]"); process.exit(2); }
  run.then(r => process.exit(cmd === "drill" && !r.ok ? 1 : 0), e => { console.error(e.message); process.exit(1); });
}
