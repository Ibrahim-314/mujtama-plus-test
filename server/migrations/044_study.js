/* 044 — Study groups and circles «حلقات» (phase 71). Additive only: seven new tables + indexes; nothing existing changes.
 * A study group IS a community (phase 16: membership, roles, moderation, posts) plus one study_groups row.
 * study_groups      community_id → mode (group | halaqa), subject, level, weekly schedule (JSON), teacher(s), goal settings.
 * study_sessions    one row per session (from the schedule or added by hand); a live session opens a live room (phase 13/14).
 * study_attendance  per session and member: present / late / excused / absent, minutes, who marked it.
 * study_notes       shared notes and links per group (optionally per session), pinned by teachers / moderators.
 * study_goals       group goals and personal goals with a target and progress.
 * study_progress    halaqa mode: recitation / memorisation / review log per student (surah + ayah range, grade, note) —
 *                   visible to the student, the group's teachers and its admins only.
 * study_reminders   idempotency ledger for reminders (one per session, member and kind).
 * study_assignments homework / assignments per group (optionally tied to a session), due date, max points.
 * study_submissions one submission per member and assignment (text and/or a link), teacher grade + feedback.
 * study_completions completion of a group/course by a member, recorded by a teacher — the hook phase 73 turns into a
 *                   verifiable certificate (criteria snapshot kept with it). */
module.exports = {
  id: "044_study",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS study_groups (community_id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'group', subject TEXT, level TEXT, schedule TEXT, teachers TEXT, settings TEXT, created_by TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS study_sessions (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, title TEXT NOT NULL, agenda TEXT, starts_at {TS} NOT NULL, duration_min INTEGER NOT NULL DEFAULT 60, status TEXT NOT NULL DEFAULT 'scheduled', room_id TEXT, auto INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, started_at {TS}, ended_at {TS}, created_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS study_sessions_slot ON study_sessions(community_id, starts_at);
CREATE INDEX IF NOT EXISTS study_sessions_due ON study_sessions(status, starts_at);
CREATE TABLE IF NOT EXISTS study_attendance (session_id TEXT NOT NULL, user_id TEXT NOT NULL, community_id TEXT NOT NULL, status TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 0, joined_at {TS}, marked_by TEXT, updated_at {TS} NOT NULL, PRIMARY KEY (session_id, user_id));
CREATE INDEX IF NOT EXISTS study_attendance_user ON study_attendance(community_id, user_id);
CREATE TABLE IF NOT EXISTS study_notes (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, session_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, url TEXT, author TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS study_notes_group ON study_notes(community_id, pinned, created_at);
CREATE TABLE IF NOT EXISTS study_goals (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, user_id TEXT, title TEXT NOT NULL, unit TEXT, target INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, due_at {TS}, created_by TEXT NOT NULL, done_at {TS}, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS study_goals_group ON study_goals(community_id, user_id);
CREATE TABLE IF NOT EXISTS study_progress (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, student_id TEXT NOT NULL, teacher_id TEXT NOT NULL, session_id TEXT, kind TEXT NOT NULL, surah INTEGER, from_ayah INTEGER, to_ayah INTEGER, ayahs INTEGER NOT NULL DEFAULT 0, grade TEXT, note TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS study_progress_student ON study_progress(community_id, student_id, at);
CREATE TABLE IF NOT EXISTS study_reminders (session_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (session_id, user_id, kind));
CREATE TABLE IF NOT EXISTS study_assignments (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, session_id TEXT, title TEXT NOT NULL, body TEXT, due_at {TS}, points INTEGER NOT NULL DEFAULT 10, status TEXT NOT NULL DEFAULT 'open', created_by TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS study_assignments_group ON study_assignments(community_id, status, due_at);
CREATE TABLE IF NOT EXISTS study_submissions (assignment_id TEXT NOT NULL, user_id TEXT NOT NULL, community_id TEXT NOT NULL, body TEXT, url TEXT, status TEXT NOT NULL DEFAULT 'submitted', grade INTEGER, feedback TEXT, submitted_at {TS} NOT NULL, reviewed_at {TS}, reviewed_by TEXT, PRIMARY KEY (assignment_id, user_id));
CREATE INDEX IF NOT EXISTS study_submissions_user ON study_submissions(community_id, user_id);
CREATE TABLE IF NOT EXISTS study_completions (community_id TEXT NOT NULL, user_id TEXT NOT NULL, issued_by TEXT NOT NULL, note TEXT, criteria TEXT, issued_at {TS} NOT NULL, PRIMARY KEY (community_id, user_id))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS study_completions; DROP TABLE IF EXISTS study_submissions; DROP TABLE IF EXISTS study_assignments; DROP TABLE IF EXISTS study_reminders; DROP TABLE IF EXISTS study_progress; DROP TABLE IF EXISTS study_goals; DROP TABLE IF EXISTS study_notes; DROP TABLE IF EXISTS study_attendance; DROP TABLE IF EXISTS study_sessions; DROP TABLE IF EXISTS study_groups`);
  }
};
