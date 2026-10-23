/* «مجتمع كوين» (MJT) — points → MJT conversion from the command line (the same code as the admin screen #/admin/mjt).
 *
 *   node server/scripts/mjt-convert.js --dry-run            the plan and totals; writes nothing
 *   node server/scripts/mjt-convert.js --apply              convert (idempotent: nobody is converted twice)
 *   node server/scripts/mjt-convert.js --rollback <batch>   reverse one batch (all users or none); add --dry-run to only check
 *   node server/scripts/mjt-convert.js --verify             re-derive every balance from the ledger entries
 *
 * Uses DATABASE_URL like the server. Prints totals and handles only (no balances of other tables, no secrets). */
const path = require("node:path");
(async () => {
  const args = process.argv.slice(2), has = (f) => args.includes(f);
  process.env.LOG_SILENT = process.env.LOG_SILENT ?? "1";
  const { createApp } = require(path.join(__dirname, "..", "server.js"));
  const app = await createApp({ seedDemo: false, mjtOpts: { autoConvert: false, jobs: false } });
  const M = app.ctx.services.mjt; await M.ready;
  let out, ok = true;
  try {
    if (has("--rollback")) { const id = args[args.indexOf("--rollback") + 1]; out = await M.rollback(id, "cli", { dryRun: has("--dry-run") }); }
    else if (has("--apply")) out = await M.convert("cli");
    else if (has("--verify")) { out = await M.verify(); ok = out.ok; }
    else { out = await M.dryRun(); if (!has("--details")) delete out.users; }
  } catch (e) { out = { error: e.message, code: e.code, ...(e.details || {}) }; ok = false; }
  console.log(JSON.stringify(out, null, 2));
  await app.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
