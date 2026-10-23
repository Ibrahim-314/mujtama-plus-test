/* 019 — Full Pi integration (phase 36). Additive only: four new tables + indexes (verify-migrations --static clean).
 * The legacy `pi_payments` table and `users.pi_uid` stay untouched (pi_uid is kept in sync by services/pi.js, which
 * also copies legacy rows into the new tables at startup — idempotent INSERT … ON CONFLICT DO NOTHING).
 * pi_links          one Pi account (uid) per Mujtama+ account, verified server-side via Pi /v2/me.
 * pi_transactions   the payment ledger: local intent (id) → Pi payment (payment_id) → blockchain txid.
 *                   status: created | approved | completed | cancelled | refunded | failed; direction out | in.
 * pi_tx_events      every status transition with its source (client, incomplete, reconcile, admin) — audit trail.
 * pi_reconciliation one row per reconciliation run (daily leased job or an admin "run now"). */
module.exports = {
  id: "019_pi",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS pi_links (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, pi_uid TEXT NOT NULL UNIQUE, pi_username TEXT, network TEXT NOT NULL DEFAULT 'testnet', linked_at {TS} NOT NULL, last_auth_at {TS});
CREATE TABLE IF NOT EXISTS pi_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payment_id TEXT UNIQUE, pi_uid TEXT, amount REAL NOT NULL, memo TEXT, purpose TEXT NOT NULL, ref_id TEXT, direction TEXT NOT NULL DEFAULT 'out', network TEXT NOT NULL DEFAULT 'testnet', status TEXT NOT NULL DEFAULT 'created', txid TEXT, meta {JSON}, error TEXT, refund_of TEXT, created_at {TS} NOT NULL, updated_at {TS}, approved_at {TS}, completed_at {TS}, cancelled_at {TS}, refunded_at {TS}, reconciled_at {TS});
CREATE INDEX IF NOT EXISTS pi_tx_user ON pi_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS pi_tx_status ON pi_transactions(status, created_at);
CREATE INDEX IF NOT EXISTS pi_tx_txid ON pi_transactions(txid);
CREATE TABLE IF NOT EXISTS pi_tx_events (id {SERIAL}, tx_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, source TEXT NOT NULL, detail TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS pi_tx_events_tx ON pi_tx_events(tx_id, at);
CREATE TABLE IF NOT EXISTS pi_reconciliation (id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, by_user TEXT, status TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, matched INTEGER NOT NULL DEFAULT 0, fixed INTEGER NOT NULL DEFAULT 0, expired INTEGER NOT NULL DEFAULT 0, payload {JSON}, started_at {TS} NOT NULL, finished_at {TS});
CREATE INDEX IF NOT EXISTS pi_reconciliation_date ON pi_reconciliation(date, started_at);`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS pi_reconciliation; DROP TABLE IF EXISTS pi_tx_events; DROP TABLE IF EXISTS pi_transactions; DROP TABLE IF EXISTS pi_links`);
  }
};
