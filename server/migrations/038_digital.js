/* 038 — Digital products store (phase 58), extending the phase 39 marketplace (a digital product IS a market_listings row with
 * kind 'digital'; orders, escrow, reviews and disputes are the market's). Additive only: five new tables + indexes.
 * digital_products     per listing: product type (ebook | template | course | file), the deliverable files, an optional public
 *                      preview file and sample text, license keys on/off, download limit, link lifetime, refund policy, status.
 * digital_files        uploaded deliverables / previews kept in the media storage (STORAGE_DRIVER=db → blobs) under private dg_ keys
 *                      (never served by /media/), with sha256 (copyright takedowns block re-uploads of the same file).
 * digital_entitlements one per paid market order: the buyer's library entry, license key, downloads used / limit, status.
 * digital_downloads    expiring download links (only the token hash is stored); each link uses one download from the limit.
 * digital_reports      abuse / copyright reports on a digital product (mirrored as a `reports` row for the moderation queue). */
module.exports = {
  id: "038_digital",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS digital_products (listing_id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, ptype TEXT NOT NULL DEFAULT 'file', files TEXT NOT NULL DEFAULT '[]', preview_file TEXT, sample_text TEXT, license INTEGER NOT NULL DEFAULT 0, download_limit INTEGER NOT NULL DEFAULT 5, link_ttl_min INTEGER NOT NULL DEFAULT 15, refund_policy TEXT NOT NULL DEFAULT 'undownloaded', status TEXT NOT NULL DEFAULT 'active', blocked_reason TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS digital_products_seller ON digital_products(seller_id, status);
CREATE TABLE IF NOT EXISTS digital_files (id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, storage_key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size BIGINT NOT NULL, sha256 TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'file', blocked INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, deleted_at {TS});
CREATE INDEX IF NOT EXISTS digital_files_seller ON digital_files(seller_id, deleted_at);
CREATE INDEX IF NOT EXISTS digital_files_sha ON digital_files(sha256, blocked);
CREATE TABLE IF NOT EXISTS digital_entitlements (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, listing_id TEXT NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, license_key TEXT UNIQUE, downloads INTEGER NOT NULL DEFAULT 0, download_limit INTEGER NOT NULL DEFAULT 5, status TEXT NOT NULL DEFAULT 'active', granted_at {TS} NOT NULL, last_download_at {TS}, revoked_at {TS}, revoke_reason TEXT);
CREATE INDEX IF NOT EXISTS digital_entitlements_buyer ON digital_entitlements(buyer_id, status, granted_at);
CREATE INDEX IF NOT EXISTS digital_entitlements_listing ON digital_entitlements(listing_id, status);
CREATE TABLE IF NOT EXISTS digital_downloads (id TEXT PRIMARY KEY, entitlement_id TEXT NOT NULL, file_id TEXT NOT NULL, buyer_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at {TS} NOT NULL, fetched INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS digital_downloads_ent ON digital_downloads(entitlement_id, created_at);
CREATE TABLE IF NOT EXISTS digital_reports (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, reporter_id TEXT NOT NULL, reason TEXT NOT NULL, details TEXT, report_id TEXT, status TEXT NOT NULL DEFAULT 'open', resolution TEXT, resolved_by TEXT, resolved_at {TS}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS digital_reports_status ON digital_reports(status, created_at);
CREATE INDEX IF NOT EXISTS digital_reports_listing ON digital_reports(listing_id, reporter_id)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS digital_reports; DROP TABLE IF EXISTS digital_downloads; DROP TABLE IF EXISTS digital_entitlements; DROP TABLE IF EXISTS digital_files; DROP TABLE IF EXISTS digital_products`);
  }
};
