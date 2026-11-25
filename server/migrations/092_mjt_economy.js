/* 092 — v2.162 «اقتصاد MJT» (phase 6): admin economy analytics over the EXISTING ledger. Additive only: two indexes so the
 * period / time-series reads of the dashboard (#/admin/mjt-economy, services/mjt-economy.js) stay indexed:
 *   mjt_tx_created       mjt_tx(created_at)       — totals and series by period (joined to mjt_entries by tx_id)
 *   mjt_entries_created  mjt_entries(created_at)  — active wallets (≥ 1 movement in the last 30 days)
 * No table, no column, no backfill, no data change. The economy settings (per-source monthly budgets + alert thresholds, all
 * NULL by default) live in the existing mjt_settings table under key 'economy' — no new table is needed.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "092_mjt_economy",
  async up(db, exec) {
    await exec(`
CREATE INDEX IF NOT EXISTS mjt_tx_created ON mjt_tx(created_at);
CREATE INDEX IF NOT EXISTS mjt_entries_created ON mjt_entries(created_at)`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS mjt_entries_created; DROP INDEX IF EXISTS mjt_tx_created");
  }
};
