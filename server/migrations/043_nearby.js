/* 043 — Nearby events and places on a map (phase 66). Additive only: three new tables + indexes; nothing existing changes.
 * geo_prefs     opt-in approximate location per member: a coarse geohash (≤ 5 characters, a cell of about 5 × 5 km) that
 *               the DEVICE computes — the exact position never reaches the server — and/or a chosen city. Off by default,
 *               never allowed for minors (phase 34/35), deleted with one tap.
 * places        user-submitted public places (mosques, cafés, libraries, parks …) — moderated: pending → approved / rejected,
 *               hidden after enough reports. Coordinates of a PUBLIC place are rounded to 4 decimals (~11 m); geohash
 *               (7 chars) + lat/lng drive the bounding-box search; city / country come from the gazetteer (lib/geo.js).
 * place_reports one report per member per place (wrong / closed / inappropriate / duplicate / private home).
 * place_reviews one rating (1–5) + optional short review per member per place; screened, hidden when automod blocks it.
 * place_photos  photos members attach to an approved place (their own uploaded media), removable by them or staff.
 * place_saves   a member's saved places («أماكني المفضلة»).
 * places.hours_week  structured weekly hours (JSON: 7 × [open, close] or null) → «open now» in the place's local time. */
module.exports = {
  id: "043_nearby",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS geo_prefs (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, geohash TEXT, city TEXT, country TEXT, radius_km INTEGER NOT NULL DEFAULT 10, source TEXT, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, descr TEXT, address TEXT, lat REAL NOT NULL, lng REAL NOT NULL, geohash TEXT NOT NULL, city TEXT, country TEXT, url TEXT, hours TEXT, hours_week TEXT, status TEXT NOT NULL DEFAULT 'pending', risk REAL NOT NULL DEFAULT 0, reasons TEXT, submitted_by TEXT NOT NULL, reviewed_by TEXT, review_note TEXT, reports INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, reviewed_at {TS});
CREATE INDEX IF NOT EXISTS places_status_geo ON places(status, geohash);
CREATE INDEX IF NOT EXISTS places_latlng ON places(lat, lng);
CREATE INDEX IF NOT EXISTS places_city ON places(city, status);
CREATE INDEX IF NOT EXISTS places_submitter ON places(submitted_by, created_at);
CREATE TABLE IF NOT EXISTS place_reports (place_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, created_at {TS} NOT NULL, PRIMARY KEY (place_id, user_id));
CREATE INDEX IF NOT EXISTS events_latlng ON events(lat, lng);
CREATE TABLE IF NOT EXISTS place_reviews (place_id TEXT NOT NULL, user_id TEXT NOT NULL, rating INTEGER NOT NULL, text TEXT, status TEXT NOT NULL DEFAULT 'visible', created_at {TS} NOT NULL, updated_at {TS} NOT NULL, PRIMARY KEY (place_id, user_id));
CREATE INDEX IF NOT EXISTS place_reviews_place ON place_reviews(place_id, status, updated_at);
CREATE TABLE IF NOT EXISTS place_photos (id TEXT PRIMARY KEY, place_id TEXT NOT NULL, user_id TEXT NOT NULL, media_id TEXT NOT NULL, url TEXT NOT NULL, caption TEXT, status TEXT NOT NULL DEFAULT 'visible', created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS place_photos_place ON place_photos(place_id, status, created_at);
CREATE TABLE IF NOT EXISTS place_saves (place_id TEXT NOT NULL, user_id TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (user_id, place_id))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS place_saves; DROP TABLE IF EXISTS place_photos; DROP TABLE IF EXISTS place_reviews; DROP INDEX IF EXISTS events_latlng; DROP TABLE IF EXISTS place_reports; DROP TABLE IF EXISTS places; DROP TABLE IF EXISTS geo_prefs`);
  }
};
