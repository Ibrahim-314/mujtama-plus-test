/* global require, process, console, __dirname, fetch */
/* Seed a PostgreSQL database with the v2.6.0 schema (migrations 001–009) and data, for verify-migrations.js --apply.
 *   git worktree add --detach <W> f9ece1b && rm <W>/server/migrations/01[0-2]_*.js
 *   node tools/migration-check/seed-v260.js <W> postgres://…/scratch_db      # DROPS the public schema of that DB
 * Boots the f9ece1b server (demo seed + a little API activity), then inserts rows into every table that
 * migrations 010/011 alter (conversations, conversation_members, messages, notifications, users) and media.
 * Bus handler errors from the Track 6 WIP code in that snapshot (missing users.email) are expected and harmless. */
const path = require("node:path");
const [W, url] = process.argv.slice(2);
if (!W || !url || !/^postgres/.test(url)) { console.error("usage: seed-v260.js <worktree> <postgres-url>"); process.exit(2); }
process.env.LOG_SILENT = "1";
const pg = require(path.join(__dirname, "..", "..", "server", "node_modules", "pg"));
const { createApp } = require(path.join(path.resolve(W), "server", "server.js"));
(async () => {
  const c = new pg.Client({ connectionString: url }); await c.connect(); await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); await c.end();
  const app = await createApp({ databaseUrl: url, storageDir: path.join(require("node:os").tmpdir(), "mp-v260-storage"), seedDemo: true });
  await new Promise(r => app.server.listen(0, r)); const base = "http://127.0.0.1:" + app.server.address().port;
  const mk = async (h) => { app.ctx.rl.w.clear(); let cookie = ""; const req = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", Cookie: cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; return r.json().catch(() => ({})); }; const u = await req("POST", "/api/auth/register", { name: "مستخدم " + h, handle: h, password: "secret123" }); return { req, id: u.user?.id }; };
  const a = await mk("legacy_a"), b = await mk("legacy_b");
  await a.req("POST", "/api/posts", { text: "منشور قديم من v2.6.0" });
  await b.req("PUT", `/api/follows/${a.id}`);
  const db = app.ctx.db, t = new Date().toISOString(), users = (await db.all("SELECT id FROM users ORDER BY id LIMIT 6")).map(r => r.id);
  for (let i = 0; i < 5; i++) {
    const cid = "cv_legacy" + i; await db.run("INSERT INTO conversations(id,created_at,updated_at) VALUES($1,$2,$2)", [cid, t]);
    for (const u of [users[0], users[i + 1]]) await db.run("INSERT INTO conversation_members(conv,user_id) VALUES($1,$2)", [cid, u]);
    for (let j = 0; j < 4; j++) await db.run("INSERT INTO messages(id,conv,sender,text,created_at) VALUES($1,$2,$3,$4,$5)", ["msg_legacy" + i + "_" + j, cid, j % 2 ? users[0] : users[i + 1], "رسالة " + j, t]);
    await db.run("INSERT INTO notifications(id,user_id,kind,actor,created_at) VALUES($1,$2,'follow',$3,$4)", ["nt_legacy" + i, users[0], users[i + 1], t]);
    await db.run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,'image','image/png',10,$3,'ready',$4,$5)", ["md_legacy" + i, users[0], "md_legacy" + i + ".png", JSON.stringify({ original: "/media/md_legacy" + i + ".png" }), t]);
  }
  console.log("applied:", (await db.all("SELECT id FROM schema_migrations ORDER BY id")).map(r => r.id).join(","));
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
