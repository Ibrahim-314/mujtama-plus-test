/* 048 — Creator ↔ brand collaborations and sponsorships «تعاونات ورعايات» (phase 63). Additive only: seven new tables.
 * collab_profiles     a creator's media kit: open to offers, headline, categories, formats, an indicative rate in Pi
 *                     (informational — no payment runs through this feature), languages.
 * collab_brands       a brand profile on a person or organisation account: name, category (prohibited categories are not
 *                     offered), website, about, active | suspended, staff-verified flag.
 * collab_campaigns    a brand's brief: deliverables, categories, formats, indicative fee, deadline, slots; review (held by
 *                     the prohibited-terms check) → open → closed | removed.
 * collab_deals        one negotiation between a brand (or, for a creator ↔ creator collab, another creator) and a creator:
 *                     kind sponsored | gifted | affiliate | collab, deliverables JSON (each with its post and review
 *                     state), fee, whose turn it is, proposed → active → completed | declined | cancelled, both sides'
 *                     «paid» / «received» marks (record only).
 * collab_messages     the deal room thread + system events (offer, counter, accepted, delivered, approved…).
 * post_partnerships   the disclosure registry: a post that is paid / gifted / affiliate / collab content, with the brand
 *                     and the deal; locked when it came from a deal (the label cannot be removed). Mirrored into
 *                     posts.data.partner for rendering the label everywhere the post appears.
 * collab_reports      «this looks like an undisclosed ad» reports for the staff queue (label it or dismiss). */
module.exports = {
  id: "048_collabs",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS collab_profiles (user_id TEXT PRIMARY KEY, open INTEGER NOT NULL DEFAULT 0, headline TEXT, categories TEXT, formats TEXT, rate_from INTEGER, rate_note TEXT, languages TEXT, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS collab_profiles_open ON collab_profiles(open, updated_at);
CREATE TABLE IF NOT EXISTS collab_brands (user_id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, website TEXT, about TEXT, status TEXT NOT NULL DEFAULT 'active', verified INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS collab_campaigns (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, deliverables TEXT NOT NULL, categories TEXT, formats TEXT, fee INTEGER, fee_note TEXT, deadline {TS}, slots INTEGER NOT NULL DEFAULT 5, status TEXT NOT NULL DEFAULT 'open', review_note TEXT, applications INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS collab_campaigns_status ON collab_campaigns(status, created_at);
CREATE INDEX IF NOT EXISTS collab_campaigns_brand ON collab_campaigns(brand_id, status);
CREATE TABLE IF NOT EXISTS collab_deals (id TEXT PRIMARY KEY, campaign_id TEXT, brand_id TEXT NOT NULL, creator_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'sponsored', title TEXT NOT NULL, summary TEXT, deliverables TEXT NOT NULL, fee INTEGER NOT NULL DEFAULT 0, turn TEXT NOT NULL, initiator TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', paid_brand INTEGER NOT NULL DEFAULT 0, paid_creator INTEGER NOT NULL DEFAULT 0, end_reason TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, accepted_at {TS}, completed_at {TS});
CREATE INDEX IF NOT EXISTS collab_deals_brand ON collab_deals(brand_id, updated_at);
CREATE INDEX IF NOT EXISTS collab_deals_creator ON collab_deals(creator_id, updated_at);
CREATE INDEX IF NOT EXISTS collab_deals_campaign ON collab_deals(campaign_id);
CREATE TABLE IF NOT EXISTS collab_messages (id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, author TEXT, kind TEXT NOT NULL DEFAULT 'msg', body TEXT NOT NULL, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS collab_messages_deal ON collab_messages(deal_id, at);
CREATE TABLE IF NOT EXISTS post_partnerships (post_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, deal_id TEXT, brand_id TEXT, brand_name TEXT NOT NULL, kind TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'self', created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS post_partnerships_brand ON post_partnerships(brand_id, created_at);
CREATE INDEX IF NOT EXISTS post_partnerships_time ON post_partnerships(created_at);
CREATE TABLE IF NOT EXISTS collab_reports (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, by_user TEXT NOT NULL, note TEXT, brand TEXT, status TEXT NOT NULL DEFAULT 'open', resolved_by TEXT, resolved_at {TS}, created_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS collab_reports_once ON collab_reports(post_id, by_user);
CREATE INDEX IF NOT EXISTS collab_reports_status ON collab_reports(status, created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS collab_reports; DROP TABLE IF EXISTS post_partnerships; DROP TABLE IF EXISTS collab_messages; DROP TABLE IF EXISTS collab_deals; DROP TABLE IF EXISTS collab_campaigns; DROP TABLE IF EXISTS collab_brands; DROP TABLE IF EXISTS collab_profiles`);
  }
};
