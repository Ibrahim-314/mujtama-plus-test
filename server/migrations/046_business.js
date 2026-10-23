/* 046 — Local business directory «دليل الأعمال المحلية» (phase 67). Additive only: two new tables + indexes.
 * A business IS a phase 66 place (pin, hours, photos, reviews, reports, moderation) plus one businesses row — nothing about
 * places is duplicated.
 * businesses       place_id → directory category, accepts-Pi declaration (+ note), contact (phone / WhatsApp / e-mail /
 *                  website / Instagram), menu or catalogue link, owner (set only by an approved claim), verified flag,
 *                  home_based (then only the area is public: the pin is the ~5 km cell centre, no street address, no map pin),
 *                  delivery / online-only flags, price level, tags.
 * business_claims  «أنا صاحب هذا النشاط» requests → moderation queue (evidence + contact for staff only) → approved (owner,
 *                  verified) | rejected (reason) | withdrawn. One open claim per member and business. */
module.exports = {
  id: "046_business",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS businesses (place_id TEXT PRIMARY KEY, category TEXT NOT NULL, owner_id TEXT, verified INTEGER NOT NULL DEFAULT 0, accepts_pi INTEGER NOT NULL DEFAULT 0, pi_note TEXT, phone TEXT, whatsapp TEXT, email TEXT, website TEXT, instagram TEXT, menu_url TEXT, home_based INTEGER NOT NULL DEFAULT 0, delivery INTEGER NOT NULL DEFAULT 0, online_only INTEGER NOT NULL DEFAULT 0, price_level INTEGER, tags TEXT, created_by TEXT NOT NULL, verified_by TEXT, verified_at {TS}, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS businesses_cat ON businesses(category, accepts_pi);
CREATE INDEX IF NOT EXISTS businesses_owner ON businesses(owner_id);
CREATE TABLE IF NOT EXISTS business_claims (id TEXT PRIMARY KEY, place_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner', evidence TEXT, contact TEXT, status TEXT NOT NULL DEFAULT 'pending', note TEXT, reviewed_by TEXT, created_at {TS} NOT NULL, decided_at {TS});
CREATE INDEX IF NOT EXISTS business_claims_status ON business_claims(status, created_at);
CREATE INDEX IF NOT EXISTS business_claims_place ON business_claims(place_id, user_id)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS business_claims; DROP TABLE IF EXISTS businesses`);
  }
};
