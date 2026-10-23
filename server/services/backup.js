/* v2.68 — off-site logical backup endpoint (audit H1: no automated backup).
 * GET /api/ops/backup  with  Authorization: Bearer $BACKUP_TOKEN
 * Streams a consistent snapshot (one REPEATABLE READ, READ ONLY transaction) of every table in schema public as gzip'd JSON lines,
 * encrypted with $BACKUP_PASSPHRASE in the OpenSSL `enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt` format, so it can be
 * opened with the openssl CLI or tools/backup-restore.mjs. The route does not exist (404) unless both env vars are set (PostgreSQL only).
 * Read-only: never writes to the database. One export at a time. Format «mujtama-logical-1»:
 *   {"format","version","createdAt","tables":[...]}  then per table {"t","cols"} + one JSON object per row,  then {"end":true,"rows":{t:n}} */
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline, Readable } = require("stream");
const { HttpError } = require("../lib/core");

const ITER = 200000;
function opensslCipher(pass) {
  const salt = crypto.randomBytes(8);
  const kiv = crypto.pbkdf2Sync(pass, salt, ITER, 48, "sha256");
  const c = crypto.createCipheriv("aes-256-cbc", kiv.subarray(0, 32), kiv.subarray(32, 48));
  return { header: Buffer.concat([Buffer.from("Salted__"), salt]), cipher: c };
}
function opensslDecipher(pass, header) {
  if (header.subarray(0, 8).toString() !== "Salted__") throw new Error("not an openssl salted file");
  const kiv = crypto.pbkdf2Sync(pass, header.subarray(8, 16), ITER, 48, "sha256");
  return crypto.createDecipheriv("aes-256-cbc", kiv.subarray(0, 32), kiv.subarray(32, 48));
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function* snapshot(url, version, log) {
  const { Client } = require("pg");
  const ssl = process.env.PG_SSL ? { rejectUnauthorized: process.env.PG_SSL === "verify" } : undefined;
  const c = new Client({ connectionString: url, ssl, statement_timeout: 120000 });
  c.on("error", (e) => log.error("backup client error", { err: e }));
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")).rows.map((r) => r.tablename);
    yield { format: "mujtama-logical-1", version, createdAt: new Date().toISOString(), tables };
    const counts = {};
    for (const t of tables) {
      const cols = (await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [t])).rows;
      yield { t, cols: cols.map((x) => x.column_name) };
      const heavy = cols.some((x) => x.data_type === "bytea"), lim = heavy ? 8 : 1000;
      const q = `SELECT ctid::text AS _c, row_to_json(x)::text AS _j FROM "${t.replace(/"/g, '""')}" x WHERE ctid > $1::tid ORDER BY ctid LIMIT ${lim}`;
      let last = "(0,0)", n = 0;
      for (;;) {
        const rows = (await c.query(q, [last])).rows;
        for (const r of rows) { n++; yield r._j; }
        if (rows.length < lim) break;
        last = rows[rows.length - 1]._c;
      }
      counts[t] = n;
    }
    yield { end: true, rows: counts };
    await c.query("COMMIT");
  } finally { await c.end().catch(() => { }); }
}

module.exports = (ctx) => {
  const { router: R, config, STREAM } = ctx;
  const { log } = require("../lib/log");
  const token = process.env.BACKUP_TOKEN, pass = process.env.BACKUP_PASSPHRASE, url = process.env.DATABASE_URL;
  let busy = false;
  const enabled = !!(token && token.length >= 32 && pass && pass.length >= 16 && url && url.startsWith("postgres"));
  if (!enabled) return { enabled: false };
  R.get("/api/ops/backup", async (req, res) => {
    const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!safeEq(auth, token)) throw new HttpError(404, "غير موجود", "not_found");
    if (busy) throw new HttpError(429, "نسخة احتياطية أخرى قيد التنفيذ", "busy");
    busy = true;
    const t0 = Date.now();
    const { header, cipher } = opensslCipher(pass);
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="mujtama-${new Date().toISOString().replace(/[:.]/g, "")}.jsonl.gz.enc"` });
    res.write(header);
    const lines = Readable.from((async function* () { for await (const o of snapshot(url, config.version, log)) yield (typeof o === "string" ? o : JSON.stringify(o)) + "\n"; })());
    await new Promise((resolve) => pipeline(lines, zlib.createGzip({ level: 6 }), cipher, res, (err) => {
      busy = false;
      if (err) log.error("backup stream failed", { err, ms: Date.now() - t0 }); else log.info("backup streamed", { ms: Date.now() - t0 });
      resolve();
    }));
    return STREAM;
  });
  return { enabled: true };
};
module.exports.opensslDecipher = opensslDecipher;
module.exports.opensslCipher = opensslCipher;
