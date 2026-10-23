/* 066 — «المجتمع 3.0» stage 5 (v2.60.0): insights, growth, integrations and member notifications. Additive only: new
 * columns (every one nullable or NOT NULL with a DEFAULT), new tables, new indexes. Nothing existing is renamed, retyped,
 * dropped or rewritten; every backfill runs at runtime and is idempotent (services/cinsights.js).
 *   community_metrics.*          views, questions, answered, invite_joins, mod_actions, automod_caught (the new insight
 *                                counters) + reconciled_at (when the nightly reconciler last rewrote the row).
 *   community_daily_actives      who was active in a community on a day (post / comment / reaction) → DAU, WAU, MAU,
 *                                stickiness and weekly cohort retention without scanning posts.
 *   community_member_prefs       a member's notifications for ONE community: level all | highlights | muted, a daily
 *                                digest, a timed mute (muted_until) and when the last digest went out.
 *   community_webhooks           a community's own signed webhooks (member.joined, post.created, report.created). The
 *   community_webhook_deliveries devapi tables are bound to a developer app, so a community gets its own pair; signing,
 *                                URL policy and backoff are the phase 47 ones (lib/devapi-lib.js: sign / checkUrl / backoff).
 *   community_mjt_rewards        one row per «مجتمع كوين» reward paid for activity in a community (post, accepted answer):
 *                                the ledger transaction that paid it and, when the content goes, the reversal. The MJT
 *                                ledger itself (mjt_* tables) is NOT touched: payments go through lib/mjt-ledger.js post().
 * The guarded ALTERs make a re-run a no-op; down() restores the v2.59 schema exactly. */
async function columns(db, table) {
  try {
    if (db.dialect === "postgres") return (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
    return (await db.all(`PRAGMA table_info(${table})`)).map(r => r.name);
  } catch { return []; }
}
const METRIC_COLS = [
  ["views", "INTEGER NOT NULL DEFAULT 0"], ["questions", "INTEGER NOT NULL DEFAULT 0"], ["answered", "INTEGER NOT NULL DEFAULT 0"],
  ["invite_joins", "INTEGER NOT NULL DEFAULT 0"], ["mod_actions", "INTEGER NOT NULL DEFAULT 0"], ["automod_caught", "INTEGER NOT NULL DEFAULT 0"], ["reconciled_at", "{TS}"]
];
module.exports = {
  id: "066_insights",
  async up(db, exec) {
    const have = await columns(db, "community_metrics");
    for (const [c, t] of METRIC_COLS) if (!have.includes(c)) await exec(`ALTER TABLE community_metrics ADD COLUMN ${c} ${t}`);
    await exec(`
CREATE TABLE IF NOT EXISTS community_daily_actives (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, day TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (community, day, user_id));
CREATE INDEX IF NOT EXISTS community_daily_actives_u ON community_daily_actives(community, user_id, day);
CREATE TABLE IF NOT EXISTS community_member_prefs (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'all', digest INTEGER NOT NULL DEFAULT 0, muted_until {TS}, last_digest_at {TS}, updated_at {TS} NOT NULL, PRIMARY KEY (community, user_id));
CREATE INDEX IF NOT EXISTS community_member_prefs_digest ON community_member_prefs(digest, community);
CREATE TABLE IF NOT EXISTS community_webhooks (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', label TEXT, created_by TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS});
CREATE INDEX IF NOT EXISTS community_webhooks_c ON community_webhooks(community, status);
CREATE TABLE IF NOT EXISTS community_webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES community_webhooks(id) ON DELETE CASCADE, community TEXT NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at {TS}, last_code INTEGER, last_error TEXT, created_at {TS} NOT NULL, delivered_at {TS});
CREATE INDEX IF NOT EXISTS community_webhook_deliveries_due ON community_webhook_deliveries(status, next_at);
CREATE INDEX IF NOT EXISTS community_webhook_deliveries_c ON community_webhook_deliveries(community, created_at);
CREATE TABLE IF NOT EXISTS community_mjt_rewards (id TEXT PRIMARY KEY, community TEXT NOT NULL, user_id TEXT NOT NULL, payer_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, amount BIGINT NOT NULL DEFAULT 0, tx_id TEXT, status TEXT NOT NULL, reason TEXT, reversed BIGINT NOT NULL DEFAULT 0, reversal_tx_id TEXT, created_at {TS} NOT NULL, reversed_at {TS});
CREATE UNIQUE INDEX IF NOT EXISTS community_mjt_rewards_ref ON community_mjt_rewards(community, kind, ref_id);
CREATE INDEX IF NOT EXISTS community_mjt_rewards_day ON community_mjt_rewards(community, user_id, created_at);
CREATE INDEX IF NOT EXISTS community_mjt_rewards_status ON community_mjt_rewards(status, community)`);
  },
  async down(db, exec) {
    await exec(`DROP INDEX IF EXISTS community_mjt_rewards_status; DROP INDEX IF EXISTS community_mjt_rewards_day; DROP INDEX IF EXISTS community_mjt_rewards_ref; DROP TABLE IF EXISTS community_mjt_rewards;
DROP INDEX IF EXISTS community_webhook_deliveries_c; DROP INDEX IF EXISTS community_webhook_deliveries_due; DROP TABLE IF EXISTS community_webhook_deliveries;
DROP INDEX IF EXISTS community_webhooks_c; DROP TABLE IF EXISTS community_webhooks;
DROP INDEX IF EXISTS community_member_prefs_digest; DROP TABLE IF EXISTS community_member_prefs;
DROP INDEX IF EXISTS community_daily_actives_u; DROP TABLE IF EXISTS community_daily_actives`);
    const have = await columns(db, "community_metrics");
    for (const [c] of [...METRIC_COLS].reverse()) if (have.includes(c)) await exec(`ALTER TABLE community_metrics DROP COLUMN ${c}`);
  }
};
