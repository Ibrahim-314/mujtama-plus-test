/* 022 — Community marketplace (phase 39). Additive only: six new tables + indexes (verify-migrations --static clean).
 * Amounts are BIGINT units of 1e-7 Pi (Pi's 7 decimals), like 020_tips / 021_paid. JSON lists are TEXT (parsed by the service).
 * market_listings          products & services priced in Pi: draft | active | paused | sold_out | removed.
 * market_orders            pending_payment → paid_held → shipped → delivered → completed | cancelled | refunded | disputed,
 *                          one Pi intent per order (purpose `market`), an order conversation, a timestamp per transition.
 * market_escrow            one row per paid order: held → released | refunded | split, with the ledger journal ids.
 * market_reviews           one per completed order (buyer → seller), rating 1–5, optional seller reply.
 * market_disputes          one open dispute per order: open → seller_responded → resolved (refund_buyer | release_seller | split).
 * market_dispute_messages  the dispute thread (buyer, seller, staff), with optional evidence media ids. */
module.exports = {
  id: "022_market",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS market_listings (id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'product', title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price BIGINT NOT NULL, currency TEXT NOT NULL DEFAULT 'PI', category TEXT NOT NULL, item_condition TEXT NOT NULL DEFAULT 'na', quantity INTEGER, images TEXT NOT NULL DEFAULT '[]', location TEXT, delivery TEXT NOT NULL DEFAULT 'pickup', status TEXT NOT NULL DEFAULT 'active', community_id TEXT, views INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, removed_at {TS}, removed_by TEXT);
CREATE INDEX IF NOT EXISTS market_listings_status ON market_listings(status, created_at);
CREATE INDEX IF NOT EXISTS market_listings_seller ON market_listings(seller_id, status, created_at);
CREATE INDEX IF NOT EXISTS market_listings_category ON market_listings(category, status, price);
CREATE TABLE IF NOT EXISTS market_orders (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, title TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1, unit_price BIGINT NOT NULL, total BIGINT NOT NULL, fee BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending_payment', prev_status TEXT, intent_id TEXT UNIQUE, payment_id TEXT, conversation_id TEXT, tracking TEXT, cancel_reason TEXT, cancelled_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, paid_at {TS}, shipped_at {TS}, delivered_at {TS}, completed_at {TS}, cancelled_at {TS}, refunded_at {TS}, disputed_at {TS}, auto_released INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS market_orders_buyer ON market_orders(buyer_id, created_at);
CREATE INDEX IF NOT EXISTS market_orders_seller ON market_orders(seller_id, created_at);
CREATE INDEX IF NOT EXISTS market_orders_status ON market_orders(status, delivered_at);
CREATE INDEX IF NOT EXISTS market_orders_listing ON market_orders(listing_id, status);
CREATE TABLE IF NOT EXISTS market_escrow (order_id TEXT PRIMARY KEY, amount BIGINT NOT NULL, fee BIGINT NOT NULL DEFAULT 0, buyer_amount BIGINT NOT NULL DEFAULT 0, seller_amount BIGINT NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'held', hold_journal TEXT, settle_journal TEXT, created_at {TS} NOT NULL, settled_at {TS});
CREATE INDEX IF NOT EXISTS market_escrow_state ON market_escrow(state, created_at);
CREATE TABLE IF NOT EXISTS market_reviews (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, listing_id TEXT NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, rating INTEGER NOT NULL, text TEXT, reply TEXT, replied_at {TS}, hidden INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS market_reviews_seller ON market_reviews(seller_id, hidden, created_at);
CREATE INDEX IF NOT EXISTS market_reviews_buyer ON market_reviews(buyer_id);
CREATE TABLE IF NOT EXISTS market_disputes (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, opened_by TEXT NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, reason TEXT NOT NULL, text TEXT, evidence TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open', resolution TEXT, buyer_amount BIGINT, resolver_id TEXT, resolution_note TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, responded_at {TS}, resolved_at {TS});
CREATE INDEX IF NOT EXISTS market_disputes_status ON market_disputes(status, created_at);
CREATE INDEX IF NOT EXISTS market_disputes_order ON market_disputes(order_id);
CREATE TABLE IF NOT EXISTS market_dispute_messages (id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL, author_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '[]', created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS market_dispute_messages_dispute ON market_dispute_messages(dispute_id, created_at);
CREATE INDEX IF NOT EXISTS market_dispute_messages_author ON market_dispute_messages(author_id)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS market_dispute_messages; DROP TABLE IF EXISTS market_disputes; DROP TABLE IF EXISTS market_reviews; DROP TABLE IF EXISTS market_escrow;
DROP TABLE IF EXISTS market_orders; DROP TABLE IF EXISTS market_listings`);
  }
};
