/* Verify that migrations 010+ are purely additive, statically and against a real database.
 *
 *   node server/scripts/verify-migrations.js --static
 *   DATABASE_URL=postgres://… node server/scripts/verify-migrations.js --apply   # a COPY of the data, never production
 *
 * --static  every statement in the up() of migrations 010…NNN must be one of:
 *             ALTER TABLE t ADD COLUMN c …   (NOT NULL only together with a DEFAULT)
 *             CREATE TABLE IF NOT EXISTS …   |   CREATE [UNIQUE] INDEX IF NOT EXISTS …
 * --apply   counts every table of the public schema exactly (COUNT(*)), applies the pending migrations,
 *           counts again and fails if any pre-existing table lost or gained rows or lost a column.
 *           Prints table names and counts only, never row data. */
const fs = require("node:fs"), path = require("node:path");
const M = require("../lib/migrations");
const FROM = "010";

/* statements that are not "purely additive" by the pattern rules but were reviewed as data-safe */
const REVIEWED = new Set([
  "054_fund_bigint.js: ALTER TABLE fund_rounds ALTER COLUMN budget TYPE BIGINT", // INTEGER → BIGINT widening (v2.5x), lossless
]);
function staticCheck(from = FROM) {
  const dir = path.join(__dirname, "..", "migrations"), problems = [], seen = [];
  for (const f of fs.readdirSync(dir).filter(f => /^\d{3}_.+\.js$/.test(f) && f.slice(0, 3) >= from).sort()) {
    const mod = require(path.join(dir, f)), stmts = [];
    // capture the SQL the migration would run, without a database
    const fake = { dialect: "postgres", exec: async s => stmts.push(s), run: async () => ({ changes: 0 }), all: async () => [], get: async () => undefined };
    mod.up(fake, async sql => { for (const s of M.render(sql, "postgres").split(";").map(x => x.trim()).filter(Boolean)) stmts.push(s); }, "postgres");
    for (const s of stmts) {
      const one = s.replace(/\s+/g, " ").trim();
      const add = /^ALTER TABLE \w+ ADD COLUMN \w+ (.*)$/i.exec(one);
      const ok = (add && (!/NOT NULL/i.test(add[1]) || /DEFAULT/i.test(add[1])) && !/\b(DROP|RENAME|ALTER COLUMN|TYPE)\b/i.test(add[1])) || /^CREATE TABLE IF NOT EXISTS \w+ ?\(/i.test(one) || /^CREATE (UNIQUE )?INDEX IF NOT EXISTS \w+ ON \w+ ?\(/i.test(one);
      if (REVIEWED.has(`${f}: ${one}`)) continue; // a safe change reviewed by hand (widening a column type keeps every value)
      const bare = one.replace(/'(?:[^']|'')*'/g, "''").replace(/ON DELETE CASCADE/gi, ""); // keywords inside string literals (DEFAULT 'update') are data, not SQL
      if (!ok || /\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i.test(bare)) problems.push(`${f}: ${one.slice(0, 160)}`);
    }
    seen.push({ file: f, statements: stmts.length });
  }
  return { ok: problems.length === 0, problems, seen };
}

async function snapshot(db) {
  const tables = (await db.all("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).map(r => r.table_name);
  const out = {};
  for (const t of tables) {
    const n = await db.get(`SELECT COUNT(*) AS n FROM "${t}"`);
    const cols = (await db.all("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t])).map(r => r.column_name);
    out[t] = { rows: Number(n.n), cols };
  }
  return out;
}

async function applyCheck(db, log = console.log) {
  if (db.dialect !== "postgres") throw new Error("--apply needs a PostgreSQL DATABASE_URL");
  const before = await snapshot(db), pending = (await M.status(db)).filter(m => !m.applied).map(m => m.id);
  const ran = await M.up(db);
  const after = await snapshot(db), problems = [];
  for (const [t, b] of Object.entries(before)) {
    const a = after[t];
    if (t === "schema_migrations") continue; // gains one row per applied migration by design
    if (!a) { problems.push(`table ${t} disappeared`); continue; }
    if (a.rows !== b.rows) problems.push(`table ${t}: ${b.rows} → ${a.rows} rows`);
    for (const c of b.cols) if (!a.cols.includes(c)) problems.push(`table ${t}: column ${c} disappeared`);
  }
  const added = { tables: Object.keys(after).filter(t => !before[t]), columns: Object.entries(after).flatMap(([t, a]) => before[t] ? a.cols.filter(c => !before[t].cols.includes(c)).map(c => `${t}.${c}`) : []) };
  log(`pending before: ${pending.join(", ") || "none"}; applied now: ${ran.join(", ") || "none"}`);
  for (const [t, b] of Object.entries(before)) log(`  ${t.padEnd(28)} ${String(b.rows).padStart(7)} → ${after[t] ? after[t].rows : "-"}`);
  log(`new tables: ${added.tables.join(", ") || "none"}`);
  log(`new columns: ${added.columns.length}`);
  return { ok: problems.length === 0, problems, pending, ran, before, after, added };
}

if (require.main === module) {
  (async () => {
    const mode = process.argv[2] || "--static";
    const s = staticCheck();
    for (const x of s.seen) console.log(`static ${x.file}: ${x.statements} statements`);
    console.log(s.ok ? "static check: all statements additive" : "static check FAILED:\n  " + s.problems.join("\n  "));
    let ok = s.ok;
    if (mode === "--apply") {
      const db = await require("../lib/db").connect(require("../lib/secrets").secret("DATABASE_URL") || undefined);
      const r = await applyCheck(db); await db.close();
      console.log(r.ok ? "apply check: existing row counts and columns unchanged" : "apply check FAILED:\n  " + r.problems.join("\n  "));
      ok = ok && r.ok;
    }
    process.exitCode = ok ? 0 : 1;
  })().catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { staticCheck, applyCheck, snapshot };
