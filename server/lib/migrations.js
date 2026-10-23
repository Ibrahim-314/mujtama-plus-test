/* Versioned, reversible migrations (Phase 3).
 * Each file in /migrations exports { id, up(db, t), down(db, t) } where t holds dialect types.
 * Applied ids are recorded in schema_migrations; `down` rolls back the most recent N. */
const fs = require("node:fs"),
  path = require("node:path");
const TYPES = {
  postgres: { TS: "TIMESTAMPTZ", JSON: "JSONB", SERIAL: "BIGSERIAL PRIMARY KEY", BLOB: "BYTEA" },
  sqlite: { TS: "TEXT", JSON: "TEXT", SERIAL: "INTEGER PRIMARY KEY AUTOINCREMENT", BLOB: "BLOB" }
};
const DIR = path.join(__dirname, "..", "migrations");
/** @typedef {{ id: string, file: string, up: (db: any, exec: (sql: string) => Promise<void>, dialect: string) => Promise<any>, down: (db: any, exec: (sql: string) => Promise<void>, dialect: string) => Promise<any> }} Migration */
/** @returns {Migration[]} */
const load = () =>
  fs
    .readdirSync(DIR)
    .filter(f => /^\d{3}_.+\.js$/.test(f))
    .sort()
    .map(f => ({ file: f, ...require(path.join(DIR, f)) }));
const render = (sql, d) => sql.replace(/\{(\w+)\}/g, (_, k) => TYPES[d][k]);
const execAll = async (db, sql) => {
  for (const s of render(sql, db.dialect)
    .split(";")
    .map(x => x.trim())
    .filter(Boolean))
    await db.exec(s);
};

async function ensureTable(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at ${TYPES[db.dialect].TS} NOT NULL)`);
}
async function applied(db) {
  await ensureTable(db);
  return (await db.all("SELECT id FROM schema_migrations ORDER BY id")).map(r => r.id);
}
/** @param {any} db @param {{ log?: (m: string) => void }} [opts] */
async function up(db, { log = m => {} } = {}) {
  const done = new Set(await applied(db));
  const ran = [];
  for (const m of load()) {
    if (done.has(m.id)) continue;
    await m.up(db, sql => execAll(db, sql), db.dialect);
    await db.run("INSERT INTO schema_migrations(id, applied_at) VALUES($1,$2)", [m.id, new Date().toISOString()]);
    ran.push(m.id);
    log(`migrated ${m.id}`);
  }
  return ran;
}
/** @param {any} db @param {number} [steps] @param {{ log?: (m: string) => void }} [opts] */
async function down(db, steps = 1, { log = m => {} } = {}) {
  const done = await applied(db),
    all = load(),
    ran = [];
  for (const mid of done.reverse().slice(0, steps)) {
    const m = all.find(x => x.id === mid);
    if (!m) throw new Error("migration file missing: " + mid);
    await m.down(db, sql => execAll(db, sql), db.dialect);
    await db.run("DELETE FROM schema_migrations WHERE id=$1", [mid]);
    ran.push(mid);
    log(`rolled back ${mid}`);
  }
  return ran;
}
async function status(db) {
  const done = new Set(await applied(db));
  return load().map(m => ({ id: m.id, applied: done.has(m.id) }));
}
module.exports = { up, down, status, applied, TYPES, render };
