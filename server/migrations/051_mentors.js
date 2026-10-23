/* 051 — Mentorship «إرشاد وربط الخبراء بالمتعلمين» (phase 74). Additive only: seven new tables, nothing existing is touched.
 * mentor_profiles   an adult member's expert profile: headline, bio, topics (JSON list of keys), languages, session length,
 *                   free or Pi-priced (price in 1e-7 Pi units, used only while Pi payments are on), whether minors may book
 *                   (guardian-linked minors only), time zone, open / paused, staff status (active | suspended) + reason.
 * mentor_slots      weekly availability in the mentor's own time zone: weekday 0–6 (Sunday = 0), start / end minute.
 * mentor_requests   a learner's request: to one mentor (direct) or open to every matching mentor (mentor_id NULL until a
 *                   mentor takes it). open | accepted | declined | withdrawn | closed.
 * mentor_sessions   a booked session: start (UTC), minutes, topic; pending → confirmed → completed | cancelled | no_show.
 *                   Paid sessions keep the Pi intent and escrow state (none | pending | held | released | refund_due);
 *                   room_id links the private live room opened for the session (members only, never listed).
 * mentor_notes      one private note per session and side; the mentor may share a summary with the learner.
 * mentor_feedback   learner → mentor rating 1–5 + comment (public, aggregated), mentor → learner feedback (private).
 * mentor_feeds      a member's secret iCal feed token (/mentor-feed/<token>.ics), revocable. */
module.exports = {
  id: "051_mentors",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mentor_profiles (user_id TEXT PRIMARY KEY, headline TEXT NOT NULL, bio TEXT, topics TEXT NOT NULL, languages TEXT, minutes INTEGER NOT NULL DEFAULT 45, price INTEGER NOT NULL DEFAULT 0, allow_minors INTEGER NOT NULL DEFAULT 0, tz TEXT NOT NULL DEFAULT 'Asia/Riyadh', open INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active', status_reason TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS mentor_profiles_open ON mentor_profiles(open, status);
CREATE TABLE IF NOT EXISTS mentor_slots (id TEXT PRIMARY KEY, mentor_id TEXT NOT NULL, weekday INTEGER NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mentor_slots_mentor ON mentor_slots(mentor_id);
CREATE TABLE IF NOT EXISTS mentor_requests (id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, mentor_id TEXT, topic TEXT NOT NULL, goal TEXT NOT NULL, level TEXT, status TEXT NOT NULL DEFAULT 'open', reply TEXT, created_at {TS} NOT NULL, decided_at {TS});
CREATE INDEX IF NOT EXISTS mentor_requests_mentor ON mentor_requests(mentor_id, status);
CREATE INDEX IF NOT EXISTS mentor_requests_learner ON mentor_requests(learner_id, status);
CREATE INDEX IF NOT EXISTS mentor_requests_topic ON mentor_requests(topic, status);
CREATE TABLE IF NOT EXISTS mentor_sessions (id TEXT PRIMARY KEY, mentor_id TEXT NOT NULL, learner_id TEXT NOT NULL, request_id TEXT, topic TEXT NOT NULL, note TEXT, starts_at {TS} NOT NULL, minutes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', price INTEGER NOT NULL DEFAULT 0, fee INTEGER NOT NULL DEFAULT 0, pay_status TEXT NOT NULL DEFAULT 'none', intent_id TEXT, room_id TEXT, minor INTEGER NOT NULL DEFAULT 0, reminded INTEGER NOT NULL DEFAULT 0, cancel_reason TEXT, cancelled_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, completed_at {TS});
CREATE INDEX IF NOT EXISTS mentor_sessions_mentor ON mentor_sessions(mentor_id, starts_at);
CREATE INDEX IF NOT EXISTS mentor_sessions_learner ON mentor_sessions(learner_id, starts_at);
CREATE INDEX IF NOT EXISTS mentor_sessions_status ON mentor_sessions(status, starts_at);
CREATE INDEX IF NOT EXISTS mentor_sessions_room ON mentor_sessions(room_id);
CREATE INDEX IF NOT EXISTS mentor_sessions_intent ON mentor_sessions(intent_id);
CREATE TABLE IF NOT EXISTS mentor_notes (session_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0, updated_at {TS} NOT NULL, PRIMARY KEY (session_id, user_id));
CREATE TABLE IF NOT EXISTS mentor_feedback (session_id TEXT NOT NULL, by_user TEXT NOT NULL, about_user TEXT NOT NULL, rating INTEGER, comment TEXT, created_at {TS} NOT NULL, PRIMARY KEY (session_id, by_user));
CREATE INDEX IF NOT EXISTS mentor_feedback_about ON mentor_feedback(about_user);
CREATE TABLE IF NOT EXISTS mentor_feeds (user_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, created_at {TS} NOT NULL)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS mentor_feeds; DROP TABLE IF EXISTS mentor_feedback; DROP TABLE IF EXISTS mentor_notes; DROP TABLE IF EXISTS mentor_sessions; DROP TABLE IF EXISTS mentor_requests; DROP TABLE IF EXISTS mentor_slots; DROP TABLE IF EXISTS mentor_profiles`);
  }
};
