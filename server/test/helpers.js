/* Shared test harness: boots an isolated app on a random port with SQLite in memory (or TEST_DATABASE_URL). */
const { createApp } = require("../server");
async function boot(extra = {}) {
  process.env.LOG_SILENT = process.env.LOG_SILENT ?? "1";
  if (process.env.TEST_DATABASE_URL) { // isolate each test file on PostgreSQL with a clean schema
    const { Client } = require("pg"); const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect(); await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); await c.end();
  }
  const app = await createApp({ databaseUrl: process.env.TEST_DATABASE_URL || "sqlite::memory:", storageDir: require("os").tmpdir() + "/mp-st-" + Date.now() + Math.random(), fakeVideoMs: 200, seedDemo: false, adaptiveRateLimits: process.env.TEST_ADAPTIVE_RL === "1", ...extra });
  await new Promise(r => app.server.listen(0, r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  class Client {
    constructor(ua = "Mozilla/5.0 (iPhone) Safari/605") { this.cookie = ""; this.ua = ua; }
    async req(method, path, body, headers = {}) {
      const r = await fetch(base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: base, ...headers }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
      const j = await r.json().catch(() => ({})); return { status: r.status, headers: r.headers, ...j };
    }
  }
  return { app, base, Client };
}
module.exports = { boot };
