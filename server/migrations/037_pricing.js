/* 037 — Pricing manager + revenue/cost dashboard (phase 53). Additive only: four new tables + indexes.
 * price_book      every price ever set for a paid thing (item key, e.g. `ai.plan.ai_plus` in 1e-7 Pi units, `fee.tips` in basis
 *                 points, `ads.cpm.min` in 1e-7 Pi units): scheduled → active → superseded | cancelled. The full history stays.
 *                 grandfather=1 on an AI plan price keeps the previous price for current subscribers (grandfather_days, NULL = until
 *                 their subscription lapses).
 * price_locks     grandfathered prices per user and item (the old price, until when).
 * cost_entries    monthly running costs entered by an admin (Railway, providers, other) in US cents; soft-deleted.
 * finance_settings key/value settings for the dashboard (pi_usd_rate, …). */
module.exports = {
  id: "037_pricing",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS price_book (id TEXT PRIMARY KEY, item TEXT NOT NULL, value BIGINT NOT NULL, prev_value BIGINT, status TEXT NOT NULL DEFAULT 'scheduled', effective_at {TS} NOT NULL, grandfather INTEGER NOT NULL DEFAULT 0, grandfather_days INTEGER, note TEXT, source TEXT NOT NULL DEFAULT 'admin', created_by TEXT, created_at {TS} NOT NULL, applied_at {TS}, cancelled_at {TS}, cancelled_by TEXT);
CREATE INDEX IF NOT EXISTS price_book_item ON price_book(item, status, effective_at);
CREATE INDEX IF NOT EXISTS price_book_due ON price_book(status, effective_at);
CREATE TABLE IF NOT EXISTS price_locks (user_id TEXT NOT NULL, item TEXT NOT NULL, value BIGINT NOT NULL, price_id TEXT, until_at {TS}, created_at {TS} NOT NULL, PRIMARY KEY (user_id, item));
CREATE TABLE IF NOT EXISTS cost_entries (id TEXT PRIMARY KEY, month TEXT NOT NULL, category TEXT NOT NULL, provider TEXT, amount_cents BIGINT NOT NULL, note TEXT, created_by TEXT, created_at {TS} NOT NULL, deleted_at {TS});
CREATE INDEX IF NOT EXISTS cost_entries_month ON cost_entries(month, deleted_at);
CREATE TABLE IF NOT EXISTS finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_journals_created ON ledger_journals(created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP INDEX IF EXISTS ledger_journals_created; DROP TABLE IF EXISTS finance_settings; DROP TABLE IF EXISTS cost_entries; DROP TABLE IF EXISTS price_locks; DROP TABLE IF EXISTS price_book`);
  }
};
