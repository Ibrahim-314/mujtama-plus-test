/* 016 — user protection (Track 7, phase 33). Purely additive: CREATE TABLE / INDEX IF NOT EXISTS only.
 *  user_blocks        every block a person made, with the explicit target as `root` and the accounts it pulled in
 *                     (same org owner/admins, or accounts signed in together on one device) as rows with the same root
 *  account_links      undirected link between two accounts used together (multi-account jar / org control)
 *  mute_rules         timed, scoped mutes of words, hashtags and accounts (extends prefs.mutedWords / prefs.muted)
 *  protection_modes   per-user protection mode during an abuse wave (active window, limits, suggestion state)
 *  reply_settings     who may reply to a post (everyone | followers | mentioned | community)
 *  hidden_replies     replies hidden by the post author (reversible; still readable behind a tap)
 *  content_policies   versioned, centrally edited content-policy documents served to clients
 *  safety_settings    small admin-editable key/value settings (help-center resource numbers filled by admins)
 *  report_details     the 3-step report's structured answers, attached to a row in `reports` */
module.exports = {
  id: "016_protection",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS user_blocks (owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, target TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, root TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'direct', created_at {TS} NOT NULL, PRIMARY KEY (owner, target, root));
CREATE INDEX IF NOT EXISTS user_blocks_target ON user_blocks(target);
CREATE INDEX IF NOT EXISTS user_blocks_root ON user_blocks(owner, root);
CREATE TABLE IF NOT EXISTS account_links (a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, source TEXT NOT NULL DEFAULT 'session', created_at {TS} NOT NULL, PRIMARY KEY (a, b));
CREATE INDEX IF NOT EXISTS account_links_b ON account_links(b);
CREATE TABLE IF NOT EXISTS mute_rules (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, value TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'all', whole_word INTEGER NOT NULL DEFAULT 0, expires_at {TS}, created_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS mute_rules_unique ON mute_rules(owner, kind, value);
CREATE INDEX IF NOT EXISTS mute_rules_owner ON mute_rules(owner, expires_at);
CREATE TABLE IF NOT EXISTS protection_modes (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, active INTEGER NOT NULL DEFAULT 0, started_at {TS}, ends_at {TS}, settings {JSON}, reason TEXT, suggested_at {TS}, suggestion {JSON}, dismissed_at {TS}, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS protection_modes_active ON protection_modes(active, ends_at);
CREATE TABLE IF NOT EXISTS reply_settings (post TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE, audience TEXT NOT NULL DEFAULT 'everyone', set_by TEXT, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS hidden_replies (comment TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE, post TEXT NOT NULL, hidden_by TEXT NOT NULL, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS hidden_replies_post ON hidden_replies(post);
CREATE TABLE IF NOT EXISTS content_policies (id TEXT PRIMARY KEY, slug TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', changelog TEXT, created_by TEXT, created_at {TS} NOT NULL, published_at {TS});
CREATE UNIQUE INDEX IF NOT EXISTS content_policies_slug_version ON content_policies(slug, version);
CREATE INDEX IF NOT EXISTS content_policies_status ON content_policies(status, published_at);
CREATE TABLE IF NOT EXISTS safety_settings (key TEXT PRIMARY KEY, meta {JSON}, updated_by TEXT, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS report_details (report TEXT PRIMARY KEY, category TEXT NOT NULL, subcategory TEXT, details TEXT, meta {JSON}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS report_details_category ON report_details(category, created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS report_details; DROP TABLE IF EXISTS safety_settings; DROP TABLE IF EXISTS content_policies; DROP TABLE IF EXISTS hidden_replies; DROP TABLE IF EXISTS reply_settings; DROP TABLE IF EXISTS protection_modes; DROP TABLE IF EXISTS mute_rules; DROP TABLE IF EXISTS account_links; DROP TABLE IF EXISTS user_blocks`);
  }
};
