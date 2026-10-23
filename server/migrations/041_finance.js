/* 041 — Financial transparency (phase 60). Additive only: two new tables + indexes; nothing existing changes.
 * finance_invoices   one row per document derived from an append-only ledger journal (lib/ledger.js):
 *                    series INV (a member paid: debit on user:<id>:pi_out), CN (credit note: Pi credited back to user:<id>:pi_out),
 *                    RC (payout receipt: an owed balance paid to the member's Pi wallet). Numbers are sequential per series and
 *                    year without gaps (INV-2026-000001), issued in journal order; the ledger itself is never modified.
 * finance_counters   last issued sequence per (series, year). */
module.exports = {
  id: "041_finance",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS finance_invoices (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, series TEXT NOT NULL, year INTEGER NOT NULL, seq INTEGER NOT NULL, journal_id TEXT NOT NULL UNIQUE, ref_id TEXT, kind TEXT NOT NULL, source TEXT NOT NULL, category TEXT NOT NULL, payer_id TEXT, payee_id TEXT, amount BIGINT NOT NULL, fee BIGINT NOT NULL DEFAULT 0, credit_of TEXT, pi_tx TEXT, journal_at {TS} NOT NULL, issued_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS finance_invoices_seq ON finance_invoices(series, year, seq);
CREATE INDEX IF NOT EXISTS finance_invoices_payer ON finance_invoices(payer_id, journal_at);
CREATE INDEX IF NOT EXISTS finance_invoices_payee ON finance_invoices(payee_id, journal_at);
CREATE TABLE IF NOT EXISTS finance_counters (series TEXT NOT NULL, year INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (series, year))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS finance_counters; DROP TABLE IF EXISTS finance_invoices`);
  }
};
