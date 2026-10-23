/* 033 — launch readiness (phase 50). Additive only: new tables + indexes (no ALTER, nothing dropped, no data copied).
 * help_articles          admin-editable help-center articles and FAQ entries (Arabic first; `search` = normalised text for LIKE search)
 * support_tickets        user support tickets (status open|pending|answered|resolved|closed, priority, assignee)
 * support_messages       ticket thread (user + staff replies; `internal` = staff-only note; attachments = media ids owned by the author)
 * ambassadors            community ambassador applications (pending|approved|rejected|revoked) + referral code
 * ambassador_referrals   one row per referred account (user_id unique) — aggregated in stats, never listed publicly
 * launch_invites         invite codes for LAUNCH_MODE=invite (max_uses, uses, expiry, revoked; ambassador_id when issued by one)
 * launch_invite_uses     who redeemed which code
 * launch_waitlist        waitlist sign-ups (contact = optional lower-cased email or handle; status waiting|invited|joined)
 * launch_meta            small key/value flags (e.g. help seed done) */
module.exports = {
  id: "033_launch",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS help_articles (id TEXT PRIMARY KEY, slug TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'ar', kind TEXT NOT NULL DEFAULT 'article', category TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, summary TEXT, body TEXT NOT NULL, search TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', sort INTEGER NOT NULL DEFAULT 0, author TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS help_articles_slug ON help_articles(lang, slug);
CREATE INDEX IF NOT EXISTS help_articles_list ON help_articles(status, kind, lang, sort);
CREATE TABLE IF NOT EXISTS support_tickets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subject TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', assignee TEXT, last_by TEXT NOT NULL DEFAULT 'user', created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS support_tickets_user ON support_tickets(user_id, updated_at);
CREATE INDEX IF NOT EXISTS support_tickets_queue ON support_tickets(status, updated_at);
CREATE TABLE IF NOT EXISTS support_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author_id TEXT NOT NULL, staff INTEGER NOT NULL DEFAULT 0, internal INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, attachments TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS support_messages_ticket ON support_messages(ticket_id, created_at);
CREATE TABLE IF NOT EXISTS ambassadors (user_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', motivation TEXT NOT NULL, region TEXT, links TEXT, ref_code TEXT NOT NULL, reviewed_by TEXT, reviewed_at {TS}, note TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ambassadors_ref ON ambassadors(ref_code);
CREATE INDEX IF NOT EXISTS ambassadors_status ON ambassadors(status, created_at);
CREATE TABLE IF NOT EXISTS ambassador_referrals (user_id TEXT PRIMARY KEY, ambassador_id TEXT NOT NULL, ref_code TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ambassador_referrals_amb ON ambassador_referrals(ambassador_id, created_at);
CREATE TABLE IF NOT EXISTS launch_invites (code TEXT PRIMARY KEY, created_by TEXT, ambassador_id TEXT, waitlist_id TEXT, max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, expires_at {TS}, revoked INTEGER NOT NULL DEFAULT 0, note TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS launch_invites_amb ON launch_invites(ambassador_id);
CREATE TABLE IF NOT EXISTS launch_invite_uses (code TEXT NOT NULL, user_id TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (code, user_id));
CREATE TABLE IF NOT EXISTS launch_waitlist (id TEXT PRIMARY KEY, contact TEXT NOT NULL, name TEXT, ref TEXT, status TEXT NOT NULL DEFAULT 'waiting', invite_code TEXT, user_id TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS launch_waitlist_contact ON launch_waitlist(contact);
CREATE INDEX IF NOT EXISTS launch_waitlist_status ON launch_waitlist(status, created_at);
CREATE TABLE IF NOT EXISTS launch_meta (key TEXT PRIMARY KEY, value TEXT, updated_at {TS} NOT NULL)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS launch_meta; DROP TABLE IF EXISTS launch_waitlist; DROP TABLE IF EXISTS launch_invite_uses; DROP TABLE IF EXISTS launch_invites;
DROP TABLE IF EXISTS ambassador_referrals; DROP TABLE IF EXISTS ambassadors; DROP TABLE IF EXISTS support_messages; DROP TABLE IF EXISTS support_tickets; DROP TABLE IF EXISTS help_articles`);
  }
};
