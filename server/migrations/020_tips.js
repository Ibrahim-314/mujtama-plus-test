/* 020 — Tips & creator support (phase 37). Additive only: seven new tables + indexes (verify-migrations --static clean).
 * Amounts are stored as BIGINT "units" of 1e-7 Pi (Pi's 7 decimals) so sums are exact on SQLite and PostgreSQL.
 * creator_settings      opt-in per creator (enabled, default off) + whether public amounts may be shown.
 * creator_tiers         up to 3 active monthly support tiers per creator (retired tiers stay with active=0).
 * tips                  one-off tips: pending → completed | held → completed (release) | rejected; completed → refunded.
 * support_subscriptions one row per (supporter, creator): pending | active | cancelled | lapsed, with active_until.
 * support_payments      one Pi payment per supported month (Pi has no auto-debit).
 * ledger_journals       double-entry journal headers (append-only; ikey makes every posting idempotent).
 * ledger_entries        journal lines: account, debit, credit (sum of debits = sum of credits per journal). */
module.exports = {
  id: "020_tips",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS creator_settings (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0, show_amounts INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS creator_tiers (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, name TEXT NOT NULL, amount BIGINT NOT NULL, perks TEXT, position INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS creator_tiers_creator ON creator_tiers(creator_id, active, position);
CREATE TABLE IF NOT EXISTS tips (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, creator_id TEXT NOT NULL, post_id TEXT, amount BIGINT NOT NULL, fee BIGINT NOT NULL DEFAULT 0, message TEXT, anonymous INTEGER NOT NULL DEFAULT 0, show_amount INTEGER NOT NULL DEFAULT 0, intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', hold_reason TEXT, reviewed_by TEXT, reviewed_at {TS}, review_note TEXT, created_at {TS} NOT NULL, paid_at {TS}, completed_at {TS}, cancelled_at {TS}, refunded_at {TS});
CREATE INDEX IF NOT EXISTS tips_sender ON tips(sender_id, created_at);
CREATE INDEX IF NOT EXISTS tips_creator ON tips(creator_id, status, completed_at);
CREATE INDEX IF NOT EXISTS tips_post ON tips(post_id, status);
CREATE INDEX IF NOT EXISTS tips_status ON tips(status, created_at);
CREATE TABLE IF NOT EXISTS support_subscriptions (id TEXT PRIMARY KEY, supporter_id TEXT NOT NULL, creator_id TEXT NOT NULL, tier_id TEXT, tier_name TEXT, amount BIGINT NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending', anonymous INTEGER NOT NULL DEFAULT 0, show_amount INTEGER NOT NULL DEFAULT 0, active_until {TS}, started_at {TS}, last_paid_at {TS}, cancelled_at {TS}, lapsed_at {TS}, reminded_for {TS}, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS support_pair ON support_subscriptions(supporter_id, creator_id);
CREATE INDEX IF NOT EXISTS support_state ON support_subscriptions(state, active_until);
CREATE INDEX IF NOT EXISTS support_creator ON support_subscriptions(creator_id, state);
CREATE TABLE IF NOT EXISTS support_payments (id TEXT PRIMARY KEY, support_id TEXT NOT NULL, supporter_id TEXT NOT NULL, creator_id TEXT NOT NULL, tier_id TEXT, tier_name TEXT, amount BIGINT NOT NULL, fee BIGINT NOT NULL DEFAULT 0, intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', period_start {TS}, period_end {TS}, created_at {TS} NOT NULL, completed_at {TS}, cancelled_at {TS}, refunded_at {TS});
CREATE INDEX IF NOT EXISTS support_payments_support ON support_payments(support_id, created_at);
CREATE INDEX IF NOT EXISTS support_payments_supporter ON support_payments(supporter_id, created_at);
CREATE INDEX IF NOT EXISTS support_payments_creator ON support_payments(creator_id, status);
CREATE TABLE IF NOT EXISTS ledger_journals (id TEXT PRIMARY KEY, ikey TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, source TEXT NOT NULL, ref_id TEXT NOT NULL, creator_id TEXT, sender_id TEXT, post_id TEXT, anonymous INTEGER NOT NULL DEFAULT 0, show_amount INTEGER NOT NULL DEFAULT 0, reverses TEXT, pi_tx TEXT, memo TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_journals_creator ON ledger_journals(creator_id, created_at);
CREATE INDEX IF NOT EXISTS ledger_journals_ref ON ledger_journals(ref_id);
CREATE INDEX IF NOT EXISTS ledger_journals_reverses ON ledger_journals(reverses);
CREATE TABLE IF NOT EXISTS ledger_entries (id {SERIAL}, journal_id TEXT NOT NULL, account TEXT NOT NULL, user_id TEXT, debit BIGINT NOT NULL DEFAULT 0, credit BIGINT NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_entries_journal ON ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries(account);
CREATE INDEX IF NOT EXISTS ledger_entries_user ON ledger_entries(user_id, id)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS ledger_entries; DROP TABLE IF EXISTS ledger_journals; DROP TABLE IF EXISTS support_payments; DROP TABLE IF EXISTS support_subscriptions;
DROP TABLE IF EXISTS tips; DROP TABLE IF EXISTS creator_tiers; DROP TABLE IF EXISTS creator_settings`);
  }
};
