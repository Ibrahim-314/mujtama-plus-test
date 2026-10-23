/* 030 — developer API (phase 47). Additive only: new tables + indexes (no ALTER, nothing dropped, no data copied).
 * Every credential is stored as a sha256 hash (client secrets, API keys, OAuth codes, access + refresh tokens); the plain value is
 * shown once. Webhook signing secrets are the exception: HMAC needs the value, so it is kept server-side and never returned again.
 * JSON lists (scopes, redirect uris, events, commands) are TEXT holding JSON so both dialects read them the same way. */
module.exports = {
  id: "030_devapi",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS devapi_apps (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, descr TEXT DEFAULT '', homepage TEXT, redirect_uris TEXT NOT NULL DEFAULT '[]', scopes TEXT NOT NULL DEFAULT '["read"]', secret_hash TEXT NOT NULL, secret_hint TEXT, rate_limit INTEGER, status TEXT NOT NULL DEFAULT 'active', bot_user TEXT, commands TEXT NOT NULL DEFAULT '[]', created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS devapi_apps_owner ON devapi_apps(owner, created_at);
CREATE TABLE IF NOT EXISTS devapi_keys (id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES devapi_apps(id) ON DELETE CASCADE, user_id TEXT NOT NULL, name TEXT, key_hash TEXT NOT NULL UNIQUE, hint TEXT, scopes TEXT NOT NULL DEFAULT '["read"]', rate_limit INTEGER, status TEXT NOT NULL DEFAULT 'active', last_used_at {TS}, created_at {TS} NOT NULL, revoked_at {TS});
CREATE INDEX IF NOT EXISTS devapi_keys_app ON devapi_keys(app_id, status);
CREATE TABLE IF NOT EXISTS devapi_codes (code_hash TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES devapi_apps(id) ON DELETE CASCADE, user_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scopes TEXT NOT NULL, challenge TEXT NOT NULL, method TEXT NOT NULL, expires_at {TS} NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS devapi_tokens (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, app_id TEXT NOT NULL REFERENCES devapi_apps(id) ON DELETE CASCADE, user_id TEXT NOT NULL, scopes TEXT NOT NULL, family TEXT NOT NULL, expires_at {TS} NOT NULL, revoked_at {TS}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS devapi_tokens_app_user ON devapi_tokens(app_id, user_id);
CREATE INDEX IF NOT EXISTS devapi_tokens_family ON devapi_tokens(family);
CREATE TABLE IF NOT EXISTS devapi_grants (app_id TEXT NOT NULL REFERENCES devapi_apps(id) ON DELETE CASCADE, user_id TEXT NOT NULL, scopes TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, PRIMARY KEY (app_id, user_id));
CREATE INDEX IF NOT EXISTS devapi_grants_user ON devapi_grants(user_id);
CREATE TABLE IF NOT EXISTS devapi_webhooks (id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES devapi_apps(id) ON DELETE CASCADE, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS devapi_webhooks_app ON devapi_webhooks(app_id);
CREATE TABLE IF NOT EXISTS devapi_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES devapi_webhooks(id) ON DELETE CASCADE, app_id TEXT NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at {TS}, last_code INTEGER, last_error TEXT, created_at {TS} NOT NULL, delivered_at {TS});
CREATE INDEX IF NOT EXISTS devapi_deliveries_due ON devapi_deliveries(status, next_at);
CREATE INDEX IF NOT EXISTS devapi_deliveries_app ON devapi_deliveries(app_id, created_at);
CREATE TABLE IF NOT EXISTS devapi_bot_installs (app_id TEXT NOT NULL REFERENCES devapi_apps(id) ON DELETE CASCADE, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, installed_by TEXT NOT NULL, created_at {TS} NOT NULL, PRIMARY KEY (app_id, community));
CREATE INDEX IF NOT EXISTS devapi_bot_installs_c ON devapi_bot_installs(community)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS devapi_bot_installs; DROP TABLE IF EXISTS devapi_deliveries; DROP TABLE IF EXISTS devapi_webhooks; DROP TABLE IF EXISTS devapi_grants;
DROP TABLE IF EXISTS devapi_tokens; DROP TABLE IF EXISTS devapi_codes; DROP TABLE IF EXISTS devapi_keys; DROP TABLE IF EXISTS devapi_apps`);
  }
};
