/* Database adapter: PostgreSQL in production (DATABASE_URL), node:sqlite for dev/tests.
 * One SQL dialect in services: $1 placeholders, ON CONFLICT, RETURNING, LOWER(..) LIKE.
 * Rows are normalized: timestamps -> ISO strings, JSON columns -> objects. */
const JSON_COLS = new Set(["allowed_types", "view_roles", "post_roles", "data", "prefs", "rules", "settings", "variants", "props", "backup_codes", "allow", "links", "expertise", "pinned_posts", "sections", "privacy", "celebrated", "docs", "avatar", "cover", "breakdown", "payload", "answers", "meta", "winners", "tabs", "filters", "brief", "points", "diff", "perms"]);
function norm(row) {
  if (!row) return row;
  for (const k in row) {
    const v = row[k];
    if (v instanceof Date) row[k] = v.toISOString();
    else if (JSON_COLS.has(k) && typeof v === "string") {
      try {
        row[k] = JSON.parse(v);
      } catch {}
    } else if (typeof v === "bigint") row[k] = Number(v);
  }
  return row;
}
const enc = p =>
  p.map(v =>
    v === undefined
      ? null
      : typeof v === "boolean"
        ? v
          ? 1
          : 0
        : v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)
          ? JSON.stringify(v)
          : v
  );

async function connect(url = process.env.DATABASE_URL) {
  if (url && url.startsWith("postgres")) {
    const pg = require("pg");
    const { Pool } = pg;
    pg.types.setTypeParser(20, v => parseInt(v, 10)); // int8 (COUNT) -> number
    pg.types.setTypeParser(1700, v => parseFloat(v)); // numeric (SUM) -> number
    const ssl = process.env.PG_SSL ? { rejectUnauthorized: process.env.PG_SSL === "verify" } : undefined;
    const pool = new Pool({ connectionString: url, max: +(process.env.PG_POOL || 10), ssl, statement_timeout: +(process.env.PG_STATEMENT_TIMEOUT || 15000), idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
    // v2.68: an idle client dropping (PG restart / network blip) emits 'error' on the pool; unhandled it killed the process
    pool.on("error", e => console.error(JSON.stringify({ level: "error", msg: "pg pool idle client error", err: String(e && e.message || e) })));
    const q = async (c, sql, p = []) => (await c.query(sql, enc(p))).rows.map(norm);
    // Read replica (Phase 3): heavy read-only queries (feed, search, trends, analytics) can use db.read
    const replicaUrl = process.env.DATABASE_REPLICA_URL;
    const replica = replicaUrl ? new Pool({ connectionString: replicaUrl, max: +(process.env.PG_POOL || 10), ssl, statement_timeout: +(process.env.PG_STATEMENT_TIMEOUT || 15000), idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 }) : null;
    if (replica) replica.on("error", e => console.error(JSON.stringify({ level: "error", msg: "pg replica idle client error", err: String(e && e.message || e) })));
    const api = {
      dialect: "postgres",
      all: (sql, p) => q(pool, sql, p),
      get: async (sql, p) => (await q(pool, sql, p))[0],
      run: async (sql, p) => {
        const r = await pool.query(sql, enc(p || []));
        return { changes: r.rowCount };
      },
      exec: sql => pool.query(sql),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const t = {
            all: (s, p) => q(c, s, p),
            get: async (s, p) => (await q(c, s, p))[0],
            run: async (s, p) => ({ changes: (await c.query(s, enc(p || []))).rowCount })
          };
          const r = await fn(t);
          await c.query("COMMIT");
          return r;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: async () => {
        await pool.end();
        if (replica) await replica.end();
      }
    };
    api.hasReplica = !!replica;
    api.read = replica
      ? { all: (sql, p) => q(replica, sql, p).catch(() => q(pool, sql, p)), get: async (sql, p) => (await q(replica, sql, p).catch(() => q(pool, sql, p)))[0] }
      : { all: api.all, get: api.get };
    return api;
  }
  const { DatabaseSync } = require("node:sqlite");
  const file = url && url.startsWith("sqlite:") ? url.slice(7) : process.env.SQLITE_FILE || require("node:path").join(__dirname, "..", "data.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;");
  const conv = sql => sql.replace(/\$(\d+)/g, "?$1");
  const cache = new Map();
  const st = sql => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(conv(sql));
      cache.set(sql, s);
    }
    return s;
  };
  let chain = Promise.resolve();
  const api = {
    dialect: "sqlite",
    all: async (sql, p = []) =>
      st(sql)
        .all(...enc(p))
        .map(r => norm({ ...r })),
    get: async (sql, p = []) => {
      const r = st(sql).get(...enc(p));
      return r ? norm({ ...r }) : undefined;
    },
    run: async (sql, p = []) => {
      const r = st(sql).run(...enc(p));
      return { changes: Number(r.changes) };
    },
    exec: async sql => db.exec(sql),
    tx(fn) {
      // serialize transactions on the single connection
      const run = chain.then(async () => {
        db.exec("BEGIN");
        try {
          const r = await fn(api);
          db.exec("COMMIT");
          return r;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      });
      chain = run.catch(() => {});
      return run;
    },
    close: () => db.close()
  };
  api.read = { all: api.all, get: api.get };
  api.hasReplica = false;
  return api;
}
module.exports = { connect };
