/* 053 — Volunteering, registered charities and transparent campaigns «تطوّع وجمعيات وحملات خيرية شفافة» (phase 70).
 * Additive only: nine new tables, nothing existing is touched.
 * charity_orgs          a charity / association / initiative / volunteer team registered by an adult member: registry and
 *                       licence number (checked by staff), contact, description; pending | verified | rejected | suspended.
 * charity_org_members   who manages an organisation (owner | editor).
 * vol_opps              volunteering opportunities of a verified organisation: place or online, dates, slots, expected hours,
 *                       skills, whether guardian-linked minors may join; open | closed | cancelled.
 * vol_signups           a member's sign-up: applied → accepted | declined | withdrawn → attended (confirmed hours) | no_show;
 *                       the volunteer certificate code once issued.
 * charity_campaigns     a fundraising campaign of a verified organisation: story, beneficiaries, goal (1e-7 Pi units), dates;
 *                       draft → review (staff) → live → ended, or rejected / paused; flagged when reports pile up.
 * charity_donations     donations to a campaign (Pi intent, pending | completed | cancelled | refunded, anonymous flag).
 * charity_updates       public updates of a campaign: news, or a spending report with amount and receipt link.
 * charity_disbursements staff transfers of raised Pi to the organisation's wallet, recorded with the Pi txid.
 * charity_reports       reports on an organisation or a campaign for the staff queue. */
module.exports = {
  id: "053_charity",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS charity_orgs (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, country TEXT, city TEXT, registry TEXT, license_no TEXT, website TEXT, email TEXT, descr TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reason TEXT, verified_by TEXT, verified_at {TS}, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS charity_orgs_status ON charity_orgs(status, created_at);
CREATE INDEX IF NOT EXISTS charity_orgs_owner ON charity_orgs(owner_id);
CREATE TABLE IF NOT EXISTS charity_org_members (org_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'editor', created_at {TS} NOT NULL, PRIMARY KEY (org_id, user_id));
CREATE INDEX IF NOT EXISTS charity_org_members_user ON charity_org_members(user_id);
CREATE TABLE IF NOT EXISTS vol_opps (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL, descr TEXT NOT NULL, city TEXT, online INTEGER NOT NULL DEFAULT 0, starts_at {TS} NOT NULL, ends_at {TS} NOT NULL, slots INTEGER NOT NULL DEFAULT 10, hours REAL NOT NULL DEFAULT 2, skills TEXT, minors INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', created_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS vol_opps_status ON vol_opps(status, starts_at);
CREATE INDEX IF NOT EXISTS vol_opps_org ON vol_opps(org_id);
CREATE TABLE IF NOT EXISTS vol_signups (id TEXT PRIMARY KEY, opp_id TEXT NOT NULL, user_id TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'applied', hours REAL, minor INTEGER NOT NULL DEFAULT 0, cert_code TEXT, created_at {TS} NOT NULL, decided_at {TS}, UNIQUE (opp_id, user_id));
CREATE INDEX IF NOT EXISTS vol_signups_user ON vol_signups(user_id, status);
CREATE TABLE IF NOT EXISTS charity_campaigns (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL, story TEXT NOT NULL, category TEXT NOT NULL, beneficiaries TEXT, goal BIGINT NOT NULL, starts_at {TS} NOT NULL, ends_at {TS} NOT NULL, status TEXT NOT NULL DEFAULT 'draft', review_reason TEXT, flagged INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, published_at {TS});
CREATE INDEX IF NOT EXISTS charity_campaigns_status ON charity_campaigns(status, ends_at);
CREATE INDEX IF NOT EXISTS charity_campaigns_org ON charity_campaigns(org_id);
CREATE TABLE IF NOT EXISTS charity_donations (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, user_id TEXT NOT NULL, amount BIGINT NOT NULL, anonymous INTEGER NOT NULL DEFAULT 0, intent_id TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at {TS} NOT NULL, completed_at {TS});
CREATE INDEX IF NOT EXISTS charity_donations_campaign ON charity_donations(campaign_id, status);
CREATE INDEX IF NOT EXISTS charity_donations_intent ON charity_donations(intent_id);
CREATE INDEX IF NOT EXISTS charity_donations_user ON charity_donations(user_id);
CREATE TABLE IF NOT EXISTS charity_updates (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'update', body TEXT NOT NULL, amount BIGINT NOT NULL DEFAULT 0, receipt_url TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS charity_updates_campaign ON charity_updates(campaign_id, created_at);
CREATE TABLE IF NOT EXISTS charity_disbursements (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, amount BIGINT NOT NULL, txid TEXT NOT NULL, memo TEXT, by_user TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS charity_disbursements_campaign ON charity_disbursements(campaign_id);
CREATE TABLE IF NOT EXISTS charity_reports (id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, by_user TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', created_at {TS} NOT NULL, decided_at {TS}, UNIQUE (target_id, by_user));
CREATE INDEX IF NOT EXISTS charity_reports_status ON charity_reports(status, created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS charity_reports; DROP TABLE IF EXISTS charity_disbursements; DROP TABLE IF EXISTS charity_updates; DROP TABLE IF EXISTS charity_donations; DROP TABLE IF EXISTS charity_campaigns; DROP TABLE IF EXISTS vol_signups; DROP TABLE IF EXISTS vol_opps; DROP TABLE IF EXISTS charity_org_members; DROP TABLE IF EXISTS charity_orgs`);
  }
};
