/* Phase 50 — scaled-down LOCAL launch load run (autocannon). The 10,000-concurrent scenario itself is tools/k6-launch.js and must run
 * on staging infrastructure; this script only proves the mix locally and reports honest numbers for one small box.
 *   node tools/load-launch.mjs                      # spawns a local server (SQLite file, demo seed) on 127.0.0.1
 *   STEPS=100,300,800 DURATION=10 node tools/load-launch.mjs
 * Refuses any non-loopback BASE. Output: a table + JSON (docs/load/LAUNCH-LOAD.md records a run). */
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const STEPS = (process.env.STEPS || "100,300,800").split(",").map(Number).filter((n) => n > 0);
const DUR = +(process.env.DURATION || 10);
let BASE = process.env.BASE || "";
if (BASE && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) { console.error("load-launch: local only (BASE must be http://127.0.0.1:<port>). Use tools/k6-launch.js on staging."); process.exit(2); }
let child = null;
if (!BASE) {
  const port = 18000 + Math.floor(Math.random() * 1000), dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-load-"));
  child = spawn(process.execPath, [path.join(ROOT, "server/server.js")], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: "sqlite:" + path.join(dir, "load.db"), STORAGE_DIR: dir, SEED_DEMO: "1", LOG_SILENT: "1", NODE_ENV: "development", LAUNCH_MODE: "open" }, stdio: ["ignore", "ignore", "inherit"] });
  BASE = "http://127.0.0.1:" + port;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch { /* booting */ } await new Promise((r) => setTimeout(r, 500)); }
}
const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
const reg = await fetch(BASE + "/api/auth/register", { method: "POST", headers: H, body: JSON.stringify({ name: "Load", handle: "load_" + Date.now().toString(36), password: "load-pass-123" }) });
if (!reg.ok) { console.error("could not create the load account", reg.status, await reg.text()); child?.kill(); process.exit(1); }
const cookie = reg.headers.get("set-cookie").split(";")[0], AH = { ...H, Cookie: cookie };
await fetch(BASE + "/api/helpcenter/articles"); // seed help content once
const mix = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/launch/config", headers: AH },
  { method: "GET", path: "/api/feed?mode=for", headers: AH },
  { method: "GET", path: "/api/helpcenter/articles?q=" + encodeURIComponent("حساب"), headers: AH },
  { method: "GET", path: "/api/feed?mode=for", headers: AH }
];
const run = (connections) => new Promise((res, rej) => autocannon({ url: BASE, connections, duration: DUR, requests: mix, timeout: 20 }, (e, r) => e ? rej(e) : res({
  connections, rps: Math.round(r.requests.average), p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max, total: r.requests.total, non2xx: r.non2xx, errors: r.errors, timeouts: r.timeouts
})));
const results = [];
for (const c of STEPS) { results.push(await run(c)); await new Promise((r) => setTimeout(r, 1500)); }
child?.kill("SIGTERM");
console.table(results);
console.log(JSON.stringify({ base: BASE, host: { cpus: os.cpus().length, model: os.cpus()[0]?.model, memGb: Math.round(os.totalmem() / 2 ** 30), node: process.version }, db: "SQLite file (single process)", durationSec: DUR, mix: mix.map((m) => m.path), results }, null, 1));
