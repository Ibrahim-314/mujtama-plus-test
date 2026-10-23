/* Schema entry point. Storage is logically separated per service (spec §108); type-specific
 * fields live in `data` JSON so new content types need no rebuild. Versioned migrations live in
 * /migrations and are applied by lib/migrations.js (up/down, recorded in schema_migrations). */
const M = require("./migrations");
async function migrate(db, opts) {
  return M.up(db, opts);
}
module.exports = { migrate, status: M.status, down: M.down };
