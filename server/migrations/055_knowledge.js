/* 055 — Open knowledge library «المكتبة المعرفية المفتوحة» (phase 75). Additive only: six new tables.
 * kb_articles   one article: current title / summary / body (lightweight Markdown, RichText), category, tags, licence (CC),
 *               status review (first version waiting) | published | hidden (staff) | archived, sensitive (adults only),
 *               flagged (reports piled up), current revision number, views, creator.
 * kb_revisions  every proposed version: number, base revision it was written on, full content, sources (JSON list of links),
 *               edit note, pending | approved | rejected | withdrawn, reviewer and reason. Approved revisions are the history.
 * kb_reviewers  trusted reviewers granted by staff (adults).
 * kb_votes      «هل كان مفيداً؟» one vote per member and article.
 * kb_reports    reports on an article for the review queue (one per member and article). */
module.exports = {
  id: "055_knowledge",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS kb_articles (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, body TEXT NOT NULL, category TEXT NOT NULL, tags TEXT, license TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'ar', status TEXT NOT NULL DEFAULT 'review', sensitive INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, hidden_reason TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, published_at {TS});
CREATE INDEX IF NOT EXISTS kb_articles_status ON kb_articles(status, updated_at);
CREATE INDEX IF NOT EXISTS kb_articles_cat ON kb_articles(category, status);
CREATE INDEX IF NOT EXISTS kb_articles_by ON kb_articles(created_by);
CREATE TABLE IF NOT EXISTS kb_revisions (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, n INTEGER, base INTEGER NOT NULL DEFAULT 0, author_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, body TEXT NOT NULL, category TEXT NOT NULL, tags TEXT, sources TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'pending', minor INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, reviewer_id TEXT, reason TEXT, created_at {TS} NOT NULL, decided_at {TS});
CREATE INDEX IF NOT EXISTS kb_revisions_article ON kb_revisions(article_id, status, n);
CREATE INDEX IF NOT EXISTS kb_revisions_status ON kb_revisions(status, created_at);
CREATE INDEX IF NOT EXISTS kb_revisions_author ON kb_revisions(author_id, created_at);
CREATE TABLE IF NOT EXISTS kb_reviewers (user_id TEXT PRIMARY KEY, granted_by TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS kb_votes (article_id TEXT NOT NULL, user_id TEXT NOT NULL, vote INTEGER NOT NULL, created_at {TS} NOT NULL, PRIMARY KEY (article_id, user_id));
CREATE TABLE IF NOT EXISTS kb_reports (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, by_user TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', created_at {TS} NOT NULL, decided_at {TS}, UNIQUE (article_id, by_user));
CREATE INDEX IF NOT EXISTS kb_reports_status ON kb_reports(status, created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS kb_reports; DROP TABLE IF EXISTS kb_votes; DROP TABLE IF EXISTS kb_reviewers; DROP TABLE IF EXISTS kb_revisions; DROP TABLE IF EXISTS kb_articles`);
  }
};
