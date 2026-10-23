/* 076 — v2.77 «مركز الذكاء»: a member links their own AI accounts. Additive only: four new tables, nothing existing touched.
 *   ai_links        one row per member per provider: the member's key (sealed AES-256-GCM, never returned by any API), its last-4 hint,
 *                   how it was linked (oauth | key | siwc), the chosen model, state (ok | bad_key | quota), created/updated/last used.
 *   ai_link_prefs   per member: default provider for the hub chat and which linked provider powers which app feature (JSON).
 *   ai_link_usage   per member per day per provider: request count (the app's free daily allowance is counted on provider 'free').
 *                   No message text is stored anywhere.
 *   ai_oauth_states short-lived PKCE states for the one-tap link (state, member, provider, verifier, created_at); used once.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "076_ai_hub",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS ai_links (user_id TEXT NOT NULL, provider TEXT NOT NULL, method TEXT NOT NULL, secret TEXT NOT NULL, hint TEXT NOT NULL, model TEXT, state TEXT NOT NULL DEFAULT 'ok', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT, PRIMARY KEY (user_id, provider));
CREATE TABLE IF NOT EXISTS ai_link_prefs (user_id TEXT PRIMARY KEY, default_provider TEXT, features TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_link_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, provider TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day, provider));
CREATE TABLE IF NOT EXISTS ai_oauth_states (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, verifier TEXT NOT NULL, created_at TEXT NOT NULL);
`);
  },
  async down(db, exec) {
    await exec("DROP TABLE IF EXISTS ai_oauth_states");
    await exec("DROP TABLE IF EXISTS ai_link_usage");
    await exec("DROP TABLE IF EXISTS ai_link_prefs");
    await exec("DROP TABLE IF EXISTS ai_links");
  }
};
