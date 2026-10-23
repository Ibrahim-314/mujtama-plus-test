/* 026 — full accessibility (phase 43). Additive only: four new tables + indexes (no ALTER, nothing dropped, no data copied).
 * a11y_prefs       the user's display settings, one row per `a11y.*` key (font scale, contrast, dyslexia mode, spacing,
 *                  motion, link underline, focus ring, captions by default, alt-text reminder). Free for everyone.
 * media_alt        alternative text per image: source user | auto (vision provider, public images only) ; the heuristic
 *                  fallback is computed on read and never stored.
 * video_captions   editable WebVTT per video + language: source manual | auto (speech-to-text when configured).
 * a11y_audits      periodic accessibility audit runs: kind server (cheap scheduled DB check) | ci (axe report posted by staff). */
module.exports = {
  id: "026_a11y",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS a11y_prefs (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at {TS} NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS media_alt (media_id TEXT PRIMARY KEY, owner TEXT NOT NULL, alt TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user', lang TEXT, provider TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS media_alt_owner ON media_alt(owner, updated_at);
CREATE TABLE IF NOT EXISTS video_captions (media_id TEXT NOT NULL, lang TEXT NOT NULL, owner TEXT NOT NULL, label TEXT NOT NULL, vtt TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', created_at {TS} NOT NULL, updated_at {TS} NOT NULL, PRIMARY KEY (media_id, lang));
CREATE INDEX IF NOT EXISTS video_captions_owner ON video_captions(owner, updated_at);
CREATE TABLE IF NOT EXISTS a11y_audits (id TEXT PRIMARY KEY, kind TEXT NOT NULL, started_at {TS} NOT NULL, finished_at {TS}, ok INTEGER NOT NULL DEFAULT 1, issues INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '{}', created_by TEXT);
CREATE INDEX IF NOT EXISTS a11y_audits_kind ON a11y_audits(kind, started_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS a11y_audits; DROP TABLE IF EXISTS video_captions; DROP TABLE IF EXISTS media_alt; DROP TABLE IF EXISTS a11y_prefs`);
  }
};
