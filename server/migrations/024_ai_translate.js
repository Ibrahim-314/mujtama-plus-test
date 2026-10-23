/* 024 — AI subscriptions + real translation + UI strings (phase 41). Additive only: nine new tables + indexes
 * (verify-migrations --static clean; no ALTER, nothing dropped, no data copied). Amounts are BIGINT units of 1e-7 Pi like 020–023;
 * provider cost is BIGINT micro-USD. JSON is TEXT (parsed by the services).
 * ai_plans            generic AI plans: a plan bundles feature keys (translate now, assistant in phase 42, more later); price is
 *                     NULL until set by AI_PLAN_PRICE or an admin (never hard-coded); monthly period; per-feature limits.
 * ai_subscriptions    one row per user per plan: active | expired | revoked, source pi | grant, current period, cancel at period end.
 * ai_payments         every monthly Pi payment (purpose `ai`): pending → completed | cancelled | refunded; revenue by period.
 * ai_usage            the user's own monthly metering per feature (requests, chars, cache hits, provider cost) for the caps.
 * ai_period_stats     operator view per month / feature / provider (no user ids): requests, chars, cache hits, provider cost.
 * translations_cache  machine translations keyed by sha256(scope + text) + target language (shared scope '' for public content only).
 * translate_prefs     the user's translation choices (auto-translate, target language, languages never translated).
 * ui_strings          admin-managed UI string overrides per key and language (the bundled catalogues live in the client chunks).
 * ui_string_misses    UI strings the client could not translate, aggregated per language (no user ids). */
module.exports = {
  id: "024_ai_translate",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS ai_plans (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, features TEXT NOT NULL DEFAULT '[]', price BIGINT, price_set_by TEXT, period_days INTEGER NOT NULL DEFAULT 30, limits TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS ai_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL DEFAULT 'pi', period_start {TS}, period_end {TS}, cancel_at_period_end INTEGER NOT NULL DEFAULT 0, cancelled_at {TS}, granted_by TEXT, grant_note TEXT, reminded_for TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, UNIQUE (user_id, plan_id));
CREATE INDEX IF NOT EXISTS ai_subscriptions_state ON ai_subscriptions(state, period_end);
CREATE TABLE IF NOT EXISTS ai_payments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_id TEXT NOT NULL, subscription_id TEXT, amount BIGINT NOT NULL, intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', period_start {TS}, period_end {TS}, period TEXT, created_at {TS} NOT NULL, completed_at {TS}, cancelled_at {TS}, refunded_at {TS});
CREATE INDEX IF NOT EXISTS ai_payments_user ON ai_payments(user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_payments_period ON ai_payments(period, status);
CREATE TABLE IF NOT EXISTS ai_usage (user_id TEXT NOT NULL, period TEXT NOT NULL, feature TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, chars BIGINT NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0, cost_micros BIGINT NOT NULL DEFAULT 0, updated_at {TS} NOT NULL, PRIMARY KEY (user_id, period, feature));
CREATE TABLE IF NOT EXISTS ai_period_stats (period TEXT NOT NULL, feature TEXT NOT NULL, provider TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, chars BIGINT NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0, cost_micros BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (period, feature, provider));
CREATE TABLE IF NOT EXISTS translations_cache (hash TEXT NOT NULL, target TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', source_lang TEXT, provider TEXT NOT NULL, text TEXT NOT NULL, chars INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, last_hit_at {TS}, PRIMARY KEY (hash, target));
CREATE INDEX IF NOT EXISTS translations_cache_scope ON translations_cache(scope, created_at);
CREATE TABLE IF NOT EXISTS translate_prefs (user_id TEXT PRIMARY KEY, auto INTEGER NOT NULL DEFAULT 1, target TEXT, skip TEXT NOT NULL DEFAULT '[]', updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS ui_strings (key TEXT NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, updated_by TEXT, updated_at {TS} NOT NULL, PRIMARY KEY (key, lang));
CREATE TABLE IF NOT EXISTS ui_string_misses (lang TEXT NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, last_seen {TS} NOT NULL, PRIMARY KEY (lang, key))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS ui_string_misses; DROP TABLE IF EXISTS ui_strings; DROP TABLE IF EXISTS translate_prefs; DROP TABLE IF EXISTS translations_cache;
DROP TABLE IF EXISTS ai_period_stats; DROP TABLE IF EXISTS ai_usage; DROP TABLE IF EXISTS ai_payments; DROP TABLE IF EXISTS ai_subscriptions; DROP TABLE IF EXISTS ai_plans`);
  }
};
