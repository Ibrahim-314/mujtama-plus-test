/* 050 — Quizzes and verifiable certificates «اختبارات وشهادات قابلة للتحقق» (phase 73). Additive only: four new tables.
 * exams           formal quizzes of a phase 71 study group (optionally tied to a phase 72 course): question bank JSON
 *                 (single / multiple choice, true-false, short answer; points; explanation), settings JSON (time limit,
 *                 attempts, pass mark, shuffling, review policy, window, certificate on pass), draft | published | closed.
 * exam_attempts   one row per attempt: the per-attempt question / option order, server deadline, autosaved answers,
 *                 score, pass, per-question results; in_progress | submitted | expired (auto-submitted after the deadline).
 * certificates    issued on course completion (phase 72 hook), study-group completion (phase 71 hook) or a passed exam:
 *                 a short public code, holder + issuer snapshots, details, Ed25519 signature over a canonical payload
 *                 (key generated once and kept sealed in notify_keys), valid | revoked (+ reason), public | unlisted,
 *                 verification counter. One certificate per kind, reference and holder.
 * cert_verifications  privacy-light verification log (day + count per certificate) for the holder's «verified N times». */
module.exports = {
  id: "050_certs",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS exams (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, course_id TEXT, author TEXT NOT NULL, title TEXT NOT NULL, descr TEXT, questions TEXT NOT NULL, settings TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', attempts_n INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, published_at {TS});
CREATE INDEX IF NOT EXISTS exams_group ON exams(community_id, status);
CREATE INDEX IF NOT EXISTS exams_course ON exams(course_id);
CREATE TABLE IF NOT EXISTS exam_attempts (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL, ord TEXT NOT NULL, answers TEXT, started_at {TS} NOT NULL, due_at {TS}, submitted_at {TS}, score INTEGER, points INTEGER, max_points INTEGER, passed INTEGER, results TEXT, status TEXT NOT NULL DEFAULT 'in_progress');
CREATE INDEX IF NOT EXISTS exam_attempts_user ON exam_attempts(exam_id, user_id, started_at);
CREATE INDEX IF NOT EXISTS exam_attempts_status ON exam_attempts(status, due_at);
CREATE TABLE IF NOT EXISTS certificates (id TEXT PRIMARY KEY, code TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, community_id TEXT, holder_id TEXT NOT NULL, holder_name TEXT NOT NULL, title TEXT NOT NULL, issuer_name TEXT NOT NULL, issuer_user TEXT, details TEXT, signed TEXT NOT NULL, signature TEXT NOT NULL, key_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'valid', visibility TEXT NOT NULL DEFAULT 'public', revoked_at {TS}, revoked_by TEXT, revoke_reason TEXT, verifications INTEGER NOT NULL DEFAULT 0, issued_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS certificates_code ON certificates(code);
CREATE UNIQUE INDEX IF NOT EXISTS certificates_once ON certificates(kind, ref_id, holder_id);
CREATE INDEX IF NOT EXISTS certificates_holder ON certificates(holder_id, issued_at);
CREATE INDEX IF NOT EXISTS certificates_group ON certificates(community_id, issued_at);
CREATE TABLE IF NOT EXISTS cert_verifications (cert_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (cert_id, day))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS cert_verifications; DROP TABLE IF EXISTS certificates; DROP TABLE IF EXISTS exam_attempts; DROP TABLE IF EXISTS exams`);
  }
};
