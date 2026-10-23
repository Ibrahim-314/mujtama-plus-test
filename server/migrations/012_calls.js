/* 012 — calls (Track 6, phase 30): 1:1 and group (≤ 8, WebRTC mesh) voice/video calls.
 * call_sessions holds the call itself (kind, direct|group, optional conversation, lifecycle and end
 * reason); call_participants holds each person's state machine (ringing → joined|declined|missed|busy,
 * joined → left), live media flags (mic, camera, screen), the last network-quality report and the
 * heartbeat used to retire dead peers, plus per-user history flags (missed acknowledged, hidden). */
module.exports = {
  id: "012_calls",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS call_sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'voice', mode TEXT NOT NULL DEFAULT 'direct', conv TEXT, host TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'ringing', end_reason TEXT, created_at {TS} NOT NULL, answered_at {TS}, ended_at {TS}, duration INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS call_sessions_status ON call_sessions(status, created_at);
CREATE INDEX IF NOT EXISTS call_sessions_conv ON call_sessions(conv, created_at);
CREATE TABLE IF NOT EXISTS call_participants (call TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'guest', state TEXT NOT NULL DEFAULT 'ringing', invited_by TEXT, invited_at {TS} NOT NULL, joined_at {TS}, left_at {TS}, seen_at {TS}, mic INTEGER NOT NULL DEFAULT 1, camera INTEGER NOT NULL DEFAULT 0, screen INTEGER NOT NULL DEFAULT 0, quality {JSON}, acked INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (call, user_id));
CREATE INDEX IF NOT EXISTS call_participants_user ON call_participants(user_id, invited_at);
CREATE INDEX IF NOT EXISTS call_participants_state ON call_participants(state, invited_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS call_participants; DROP TABLE IF EXISTS call_sessions`);
  }
};
