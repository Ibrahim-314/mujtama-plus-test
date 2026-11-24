/* 091 — v2.161 «خدمات MJT» (phase 5): spending the internal MJT rewards balance on services. Additive only: four new tables +
 * indexes. Nothing existing is renamed, retyped, dropped or rewritten; no backfill. Balances stay in the existing double-entry
 * ledger (061) and every debit / refund is a row of the phase-4 journal (090 mjt_reward_entries) — this migration adds no balance.
 *   mjt_services          the catalog: one row per service that maps to a REAL existing capability. kind 'feature' (target = a
 *                         membership feature key, e.g. studio_extended) or 'course' (target = an existing course id whose
 *                         access is already 'product' = paid). access_mode free | plus | mjt | plus_mjt; eligible all | plus
 *                         (who may buy, for access_mode 'mjt'). cost (minor units) NULL and enabled 0 by default; term NULL
 *                         (unset) | 'permanent' | 'days' with duration_days. price_version increases on every change of cost /
 *                         term / duration — a purchase stores the version and amount the member confirmed.
 *   mjt_service_prices    append-only history of every price version (service_id, version) → cost, term, duration, who, when.
 *   mjt_service_purchases one row per successful MJT purchase: the price version + cost + term the member confirmed, the journal
 *                         entry (entry_id) and ledger tx (tx_id) of the debit, status active | refunded, and — when refunded —
 *                         the compensating credit entry, reason, actor and time. (user_id, idempotency_key) is UNIQUE.
 *   mjt_entitlements      what the member obtained: user, service, target key ('course:<id>' / 'feature:<key>'), starts_at,
 *                         expires_at (NULL = permanent), status active | revoked. One per purchase (purchase_id UNIQUE).
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "091_mjt_services",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mjt_services (id TEXT PRIMARY KEY, key TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, title TEXT NOT NULL, benefit TEXT, access_mode TEXT NOT NULL DEFAULT 'mjt', eligible TEXT NOT NULL DEFAULT 'all', cost BIGINT, term TEXT, duration_days INTEGER, price_version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 0, created_by TEXT, updated_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, CHECK (cost IS NULL OR cost > 0), CHECK (kind IN ('feature','course')), CHECK (access_mode IN ('free','plus','mjt','plus_mjt')), CHECK (eligible IN ('all','plus')), CHECK (term IS NULL OR term IN ('permanent','days')), CHECK (duration_days IS NULL OR duration_days > 0));
CREATE UNIQUE INDEX IF NOT EXISTS mjt_services_key ON mjt_services(key);
CREATE UNIQUE INDEX IF NOT EXISTS mjt_services_target ON mjt_services(kind, target);
CREATE TABLE IF NOT EXISTS mjt_service_prices (service_id TEXT NOT NULL, version INTEGER NOT NULL, cost BIGINT, term TEXT, duration_days INTEGER, set_by TEXT, created_at {TS} NOT NULL, PRIMARY KEY (service_id, version));
CREATE TABLE IF NOT EXISTS mjt_service_purchases (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, user_id TEXT NOT NULL, price_version INTEGER NOT NULL, cost BIGINT NOT NULL, term TEXT NOT NULL, duration_days INTEGER, status TEXT NOT NULL DEFAULT 'active', idempotency_key TEXT NOT NULL, entry_id TEXT, tx_id TEXT, refund_entry_id TEXT, refund_reason TEXT, refunded_by TEXT, refunded_at {TS}, created_at {TS} NOT NULL, CHECK (cost > 0), CHECK (status IN ('active','refunded')));
CREATE UNIQUE INDEX IF NOT EXISTS mjt_service_purchases_ikey ON mjt_service_purchases(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS mjt_service_purchases_user ON mjt_service_purchases(user_id, created_at);
CREATE INDEX IF NOT EXISTS mjt_service_purchases_service ON mjt_service_purchases(service_id, created_at);
CREATE TABLE IF NOT EXISTS mjt_entitlements (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, service_id TEXT NOT NULL, target_key TEXT NOT NULL, purchase_id TEXT, starts_at {TS} NOT NULL, expires_at {TS}, status TEXT NOT NULL DEFAULT 'active', revoked_at {TS}, created_at {TS} NOT NULL, CHECK (status IN ('active','revoked')));
CREATE UNIQUE INDEX IF NOT EXISTS mjt_entitlements_purchase ON mjt_entitlements(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mjt_entitlements_user ON mjt_entitlements(user_id, target_key, status)`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS mjt_entitlements_user; DROP INDEX IF EXISTS mjt_entitlements_purchase; DROP TABLE IF EXISTS mjt_entitlements; DROP INDEX IF EXISTS mjt_service_purchases_service; DROP INDEX IF EXISTS mjt_service_purchases_user; DROP INDEX IF EXISTS mjt_service_purchases_ikey; DROP TABLE IF EXISTS mjt_service_purchases; DROP TABLE IF EXISTS mjt_service_prices; DROP INDEX IF EXISTS mjt_services_target; DROP INDEX IF EXISTS mjt_services_key; DROP TABLE IF EXISTS mjt_services");
  }
};
