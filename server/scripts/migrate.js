/* CLI: node scripts/migrate.js [up|down [n]|status]  (uses DATABASE_URL or SQLITE_FILE) */
const { connect } = require("../lib/db"); const M = require("../lib/migrations");
(async () => {
  const [cmd = "up", n] = process.argv.slice(2); const db = await connect();
  const log = (m) => console.log("•", m);
  if (cmd === "up") { const r = await M.up(db, { log }); if (!r.length) console.log("لا توجد ترحيلات جديدة"); }
  else if (cmd === "down") await M.down(db, +(n || 1), { log });
  else if (cmd === "status") console.table(await M.status(db));
  else { console.error("usage: migrate.js up|down [n]|status"); process.exitCode = 2; }
  await db.close();
})().catch(e => { console.error(e); process.exit(1); });
