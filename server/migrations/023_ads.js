/* 023 — Ethical ads / الإعلانات الأخلاقية (phase 40). Additive only: eight new tables + indexes (verify-migrations --static clean).
 * Amounts are BIGINT units of 1e-7 Pi (Pi's 7 decimals), like 020–022. JSON is TEXT (parsed by the service).
 * ad_campaigns     promoted own public post + targeting {topics, languages, countries} + budget/daily cap/CPM bid + frequency cap,
 *                  draft | in_review | rejected | awaiting_funds | active | paused | completed | removed; one Pi intent (purpose `ads`).
 * ad_reviews       pre-publication decisions (automod + staff): approve | reject, reasons, note.
 * ad_stats_daily   impressions / clicks / spend per campaign per day — NO user ids.
 * ad_freq          frequency-cap counters keyed by HMAC(daily salt, userId:campaignId) — no user ids, purged after 7 days.
 * ad_tokens        single-use markers for signed feed tokens (hash of nonce + event type) — no user ids, purged after 7 days.
 * ad_prefs         the viewer's own ad choices: personalised on/off, hidden advertisers, hidden ads (personal data, exported/erased).
 * ad_feedback      "hide" reasons aggregated per campaign per day — NO user ids.
 * ad_meta          server-side keys: token signing key and the rotating daily salts (old salts are deleted by the purge job). */
module.exports = {
  id: "023_ads",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS ad_campaigns (id TEXT PRIMARY KEY, advertiser_id TEXT NOT NULL, post_id TEXT NOT NULL, name TEXT NOT NULL, objective TEXT NOT NULL DEFAULT 'reach', targeting TEXT NOT NULL DEFAULT '{}', budget_total BIGINT NOT NULL, daily_cap BIGINT NOT NULL, bid_cpm BIGINT NOT NULL, freq_impressions INTEGER NOT NULL DEFAULT 3, freq_hours INTEGER NOT NULL DEFAULT 24, start_at {TS} NOT NULL, end_at {TS} NOT NULL, status TEXT NOT NULL DEFAULT 'draft', review_note TEXT, automod TEXT, intent_id TEXT UNIQUE, funded_amount BIGINT NOT NULL DEFAULT 0, funded_at {TS}, spent BIGINT NOT NULL DEFAULT 0, charged BIGINT NOT NULL DEFAULT 0, low_notified INTEGER NOT NULL DEFAULT 0, submitted_at {TS}, completed_at {TS}, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ad_campaigns_advertiser ON ad_campaigns(advertiser_id, created_at);
CREATE INDEX IF NOT EXISTS ad_campaigns_status ON ad_campaigns(status, end_at);
CREATE INDEX IF NOT EXISTS ad_campaigns_post ON ad_campaigns(post_id);
CREATE TABLE IF NOT EXISTS ad_reviews (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, reviewer TEXT NOT NULL, decision TEXT NOT NULL, reasons TEXT NOT NULL DEFAULT '[]', note TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ad_reviews_campaign ON ad_reviews(campaign_id, at);
CREATE TABLE IF NOT EXISTS ad_stats_daily (campaign_id TEXT NOT NULL, day TEXT NOT NULL, impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, spend BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (campaign_id, day));
CREATE TABLE IF NOT EXISTS ad_freq (hash TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, window_start {TS} NOT NULL, expires_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ad_freq_expires ON ad_freq(expires_at);
CREATE TABLE IF NOT EXISTS ad_tokens (hash TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, expires_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ad_tokens_expires ON ad_tokens(expires_at);
CREATE TABLE IF NOT EXISTS ad_prefs (user_id TEXT PRIMARY KEY, personalized INTEGER NOT NULL DEFAULT 1, hidden_advertisers TEXT NOT NULL DEFAULT '[]', hidden_ads TEXT NOT NULL DEFAULT '[]', updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS ad_feedback (campaign_id TEXT NOT NULL, reason TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (campaign_id, reason, day));
CREATE TABLE IF NOT EXISTS ad_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at {TS} NOT NULL)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS ad_meta; DROP TABLE IF EXISTS ad_feedback; DROP TABLE IF EXISTS ad_prefs; DROP TABLE IF EXISTS ad_tokens; DROP TABLE IF EXISTS ad_freq;
DROP TABLE IF EXISTS ad_stats_daily; DROP TABLE IF EXISTS ad_reviews; DROP TABLE IF EXISTS ad_campaigns`);
  }
};
