#!/usr/bin/env node
/* v2.68 — verify or restore a «mujtama-logical-1» backup (from GET /api/ops/backup).
 *   BACKUP_PASSPHRASE_FILE=… node tools/backup-restore.mjs verify  <file.jsonl.gz.enc>
 *   BACKUP_PASSPHRASE_FILE=… node tools/backup-restore.mjs restore <file.jsonl.gz.enc> <EMPTY target postgres url>
 * verify: decrypts + gunzips the whole file, checks every table's row count against the footer, prints a summary (no row data).
 * restore: boots the app once against the empty target (creates the full current schema, no demo seed), then loads every row
 *          with json_populate_record under session_replication_role=replica, and checks counts. Refuses a non-empty target. */
import fs from "node:fs"; import zlib from "node:zlib"; import readline from "node:readline"; import { createRequire } from "node:module";
const require = createRequire(new URL("../server/package.json", import.meta.url)); // resolves pg from server/node_modules
const { opensslDecipher } = require("../server/services/backup.js");
const [, , cmd, file, target] = process.argv;
const pass = process.env.BACKUP_PASSPHRASE || (process.env.BACKUP_PASSPHRASE_FILE && fs.readFileSync(process.env.BACKUP_PASSPHRASE_FILE, "utf8").trim());
if (!["verify", "restore"].includes(cmd) || !file || !pass || (cmd === "restore" && !target)) { console.error("usage: verify <file> | restore <file> <target-url>  (BACKUP_PASSPHRASE[_FILE] required)"); process.exit(2); }

function lines() {
  const fd = fs.openSync(file, "r"); const header = Buffer.alloc(16); fs.readSync(fd, header, 0, 16, 0); fs.closeSync(fd);
  const dec = opensslDecipher(pass, header);
  const s = fs.createReadStream(file, { start: 16 }).pipe(dec).pipe(zlib.createGunzip());
  return readline.createInterface({ input: s, crlfDelay: Infinity });
}
async function run() {
  let meta = null, cur = null, footer = null; const seen = {}; let db = null, batch = [];
  if (cmd === "restore") {
    const pg = require("pg"); db = new pg.Client({ connectionString: target }); await db.connect();
    const n = (await db.query("SELECT COUNT(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n;
    if (n) throw new Error(`target is not empty (${n} tables) — refusing`);
    process.env.LOG_SILENT = "1";
    const { createApp } = require("../server/server.js");
    const app = await createApp({ databaseUrl: target, seedDemo: false, storageDir: "/tmp/mp-restore-st" }); await app.close();
    const tabs = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => `"${r.tablename}"`);
    await db.query("BEGIN"); await db.query("SET LOCAL session_replication_role = replica");
    if (tabs.length) await db.query(`TRUNCATE ${tabs.join(",")}`);
  }
  const flush = async () => {
    if (!db || !batch.length) return;
    await db.query(`INSERT INTO "${cur}" SELECT r.* FROM json_array_elements($1::json) e, json_populate_record(NULL::"${cur}", e) r`, [JSON.stringify(batch.map((b) => JSON.parse(b)))]);
    batch = [];
  };
  for await (const l of lines()) {
    if (!l) continue;
    if (!meta) { meta = JSON.parse(l); if (meta.format !== "mujtama-logical-1") throw new Error("unknown format"); continue; }
    if (l.startsWith('{"t":') && l.includes('"cols":')) { await flush(); const h = JSON.parse(l); if (h.cols && Object.keys(h).length === 2) { cur = h.t; seen[cur] = 0; continue; } }
    if (l.startsWith('{"end":true')) { await flush(); footer = JSON.parse(l); continue; }
    seen[cur]++; if (db) { batch.push(l); if (batch.length >= (l.length > 50000 ? 4 : 500)) await flush(); }
  }
  if (!footer) throw new Error("truncated backup: no footer");
  const bad = Object.keys(footer.rows).filter((t) => footer.rows[t] !== seen[t]);
  if (bad.length) throw new Error("row count mismatch: " + bad.join(","));
  if (db) {
    for (const t of Object.keys(footer.rows)) { const n = (await db.query(`SELECT COUNT(*)::int n FROM "${t}"`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n; if (n !== footer.rows[t]) throw new Error(`restored count mismatch on ${t}: ${n} vs ${footer.rows[t]}`); }
    await db.query("COMMIT"); await db.end();
  }
  const total = Object.values(footer.rows).reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ ok: true, cmd, version: meta.version, createdAt: meta.createdAt, tables: meta.tables.length, rows: total }));
}
run().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
