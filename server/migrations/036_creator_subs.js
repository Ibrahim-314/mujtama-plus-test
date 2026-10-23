/* 036 — Creator monthly subscriptions with tiers (phase 57). Additive only: five new tables + indexes.
 * Extends phase 37 (creator_tiers, support_subscriptions, support_payments) and phase 38 (supporter-only posts) instead of
 * duplicating them. Amounts are BIGINT units of 1e-7 Pi (020_tips).
 * sub_tier_meta    benefits of a creator tier: posts (supporter-only posts), channel (subscriber chat), badge (label + emoji),
 *                  early (early-access hours); rank = order for upgrade/downgrade.
 * sub_changes      upgrade / downgrade / resume requests: upgrades are a prorated user-confirmed Pi payment (purpose
 *                  `subscription`, intent_id) applied at once; downgrades are scheduled for the next renewal.
 * sub_events       subscription lifecycle events for churn stats (started, renewed, lapsed, cancelled, upgraded, downgraded).
 * sub_channel_msgs messages in a creator's subscriber channel.
 * sub_early        early-access posts: supporter-only until public_at, then released to everyone. */
module.exports = {
  id: "036_creator_subs",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS sub_tier_meta (tier_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, benefits TEXT NOT NULL DEFAULT '[]', badge TEXT, badge_emoji TEXT, early_hours INTEGER NOT NULL DEFAULT 0, description TEXT, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS sub_tier_meta_creator ON sub_tier_meta(creator_id);
CREATE TABLE IF NOT EXISTS sub_changes (id TEXT PRIMARY KEY, support_id TEXT NOT NULL, supporter_id TEXT NOT NULL, creator_id TEXT NOT NULL, kind TEXT NOT NULL, from_tier_id TEXT, to_tier_id TEXT NOT NULL, from_amount BIGINT NOT NULL DEFAULT 0, to_amount BIGINT NOT NULL DEFAULT 0, charge BIGINT NOT NULL DEFAULT 0, fee BIGINT NOT NULL DEFAULT 0, remaining_ms BIGINT NOT NULL DEFAULT 0, intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', effective_at {TS}, created_at {TS} NOT NULL, applied_at {TS}, cancelled_at {TS});
CREATE INDEX IF NOT EXISTS sub_changes_support ON sub_changes(support_id, status);
CREATE TABLE IF NOT EXISTS sub_events (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, supporter_id TEXT, support_id TEXT, kind TEXT NOT NULL, tier_id TEXT, amount BIGINT NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS sub_events_creator ON sub_events(creator_id, created_at);
CREATE TABLE IF NOT EXISTS sub_channel_msgs (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL, created_at {TS} NOT NULL, deleted_at {TS});
CREATE INDEX IF NOT EXISTS sub_channel_msgs_creator ON sub_channel_msgs(creator_id, created_at);
CREATE TABLE IF NOT EXISTS sub_early (post_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, public_at {TS} NOT NULL, released_at {TS}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS sub_early_due ON sub_early(released_at, public_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS sub_early; DROP TABLE IF EXISTS sub_channel_msgs; DROP TABLE IF EXISTS sub_events; DROP TABLE IF EXISTS sub_changes; DROP TABLE IF EXISTS sub_tier_meta`);
  }
};
