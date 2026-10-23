/* 021 — Subscriptions & paid content (phase 38). Additive only: five new tables + indexes (verify-migrations --static clean).
 * Amounts are BIGINT units of 1e-7 Pi, like 020_tips.
 * paid_posts            one row per paid post: mode supporters|ppv, price (ppv), minimum tier (supporters), state, last change
 *                       (edit / delete / moderation removal) that can make a purchase refundable.
 * paid_content          the locked body of a paid post (text + rich document). posts.text only ever holds the public teaser,
 *                       so every query that reads posts directly (search, OG pages, digests, summaries…) sees the teaser only.
 * paid_media            media ids attached to a paid post: /media/<id>… is served only to entitled viewers.
 * paid_purchases        PPV purchases: pending → completed | cancelled; completed → refunded; a second paid purchase of the
 *                       same post is kept as `duplicate` (money moved) and gets an automatic refund request.
 * paid_refund_requests  buyer refund requests (pending → approved | rejected) handled by staff. */
module.exports = {
  id: "021_paid",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS paid_posts (post_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, mode TEXT NOT NULL, price BIGINT NOT NULL DEFAULT 0, min_tier_id TEXT, min_amount BIGINT NOT NULL DEFAULT 0, teaser_custom INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'active', changed_at {TS}, change_kind TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS paid_posts_creator ON paid_posts(creator_id, state, created_at);
CREATE TABLE IF NOT EXISTS paid_content (post_id TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', data {JSON}, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS paid_media (media_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, creator_id TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS paid_media_post ON paid_media(post_id);
CREATE TABLE IF NOT EXISTS paid_purchases (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, post_id TEXT NOT NULL, creator_id TEXT NOT NULL, amount BIGINT NOT NULL, fee BIGINT NOT NULL DEFAULT 0, intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', created_at {TS} NOT NULL, completed_at {TS}, cancelled_at {TS}, refunded_at {TS}, revoked_at {TS});
CREATE INDEX IF NOT EXISTS paid_purchases_buyer ON paid_purchases(buyer_id, post_id, status);
CREATE INDEX IF NOT EXISTS paid_purchases_post ON paid_purchases(post_id, status);
CREATE INDEX IF NOT EXISTS paid_purchases_creator ON paid_purchases(creator_id, status, completed_at);
CREATE TABLE IF NOT EXISTS paid_refund_requests (id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL, buyer_id TEXT NOT NULL, post_id TEXT NOT NULL, creator_id TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at {TS}, note TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS paid_refunds_status ON paid_refund_requests(status, created_at);
CREATE INDEX IF NOT EXISTS paid_refunds_purchase ON paid_refund_requests(purchase_id);
CREATE INDEX IF NOT EXISTS paid_refunds_buyer ON paid_refund_requests(buyer_id, created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS paid_refund_requests; DROP TABLE IF EXISTS paid_purchases; DROP TABLE IF EXISTS paid_media; DROP TABLE IF EXISTS paid_content; DROP TABLE IF EXISTS paid_posts`);
  }
};
