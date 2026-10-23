/* 047 — Courses and lessons with progress tracking «دورات ودروس» (phase 72). Additive only: six new tables + indexes.
 * A course belongs to a phase 71 study group (community): the group's teachers / admins author it; members (or anyone,
 * for a public group) enrol.
 * courses            title, subtitle, description, level, cover, draft | published | archived, access free | product (an
 *                    existing phase 58 digital product of the author — only usable when the store is enabled), pass mark.
 * course_modules     ordered sections of a course.
 * course_lessons     ordered lessons inside a module: text (markdown-lite), video link (https, opened externally / embedded
 *                    only from an allow-list), or quiz (questions JSON: single choice, explanation; pass mark per quiz).
 * course_enrolments  per member: enrolled, last lesson + time (resume), progress %, completed_at + completion snapshot —
 *                    the hook phase 73 turns into a verifiable certificate.
 * course_progress    per member and lesson: done, best quiz score, attempts.
 * course_attempts    every quiz attempt (answers, score, passed) for the teacher's view and integrity. */
module.exports = {
  id: "047_courses",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, author TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, descr TEXT, level TEXT NOT NULL DEFAULT 'all', cover TEXT, status TEXT NOT NULL DEFAULT 'draft', access TEXT NOT NULL DEFAULT 'free', listing_id TEXT, pass_pct INTEGER NOT NULL DEFAULT 70, enrolled INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, published_at {TS});
CREATE INDEX IF NOT EXISTS courses_group ON courses(community_id, status);
CREATE INDEX IF NOT EXISTS courses_status ON courses(status, published_at);
CREATE TABLE IF NOT EXISTS course_modules (id TEXT PRIMARY KEY, course_id TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS course_modules_course ON course_modules(course_id, position);
CREATE TABLE IF NOT EXISTS course_lessons (id TEXT PRIMARY KEY, course_id TEXT NOT NULL, module_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text', body TEXT, video_url TEXT, minutes INTEGER NOT NULL DEFAULT 5, position INTEGER NOT NULL, quiz TEXT, pass_pct INTEGER, status TEXT NOT NULL DEFAULT 'published', created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS course_lessons_course ON course_lessons(course_id, module_id, position);
CREATE TABLE IF NOT EXISTS course_enrolments (course_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', enrolled_at {TS} NOT NULL, last_lesson_id TEXT, last_at {TS}, progress INTEGER NOT NULL DEFAULT 0, completed_at {TS}, completion TEXT, PRIMARY KEY (course_id, user_id));
CREATE INDEX IF NOT EXISTS course_enrolments_user ON course_enrolments(user_id, last_at);
CREATE TABLE IF NOT EXISTS course_progress (lesson_id TEXT NOT NULL, user_id TEXT NOT NULL, course_id TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, best_score INTEGER, attempts INTEGER NOT NULL DEFAULT 0, done_at {TS}, updated_at {TS} NOT NULL, PRIMARY KEY (lesson_id, user_id));
CREATE INDEX IF NOT EXISTS course_progress_user ON course_progress(course_id, user_id);
CREATE TABLE IF NOT EXISTS course_attempts (id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, course_id TEXT NOT NULL, user_id TEXT NOT NULL, answers TEXT NOT NULL, score INTEGER NOT NULL, passed INTEGER NOT NULL, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS course_attempts_user ON course_attempts(lesson_id, user_id, at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS course_attempts; DROP TABLE IF EXISTS course_progress; DROP TABLE IF EXISTS course_enrolments; DROP TABLE IF EXISTS course_lessons; DROP TABLE IF EXISTS course_modules; DROP TABLE IF EXISTS courses`);
  }
};
