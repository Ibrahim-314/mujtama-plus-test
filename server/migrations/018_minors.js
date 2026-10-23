/* 018 — child safety & sensitive content (Track 7, phase 35). Additive only.
 * age_profiles      self-declared birth date (no ID upload), band source (self | guardian | pi_kyc signal),
 *                   a pending raise that waits for staff review, sensitive-content preference, defaults stamp.
 * content_labels    publisher/moderator sensitive-content labels per post (idx -1) or per media item (idx 0–9),
 *                   stored as a comma list in `labels`.
 * safety_cases      the priority (escalation) queue for severe cases, access-restricted to safety staff.
 * case_evidence     preserved snapshots with a SHA-256 hash chain (tamper evident; survives deletion of the original).
 * case_access_log   every read/export of a case by staff.
 * safety_staff      who may work the queue besides admins (agent | lead).
 * authority_reports structured records prepared for official reporting bodies. Nothing is sent automatically.
 * guardian_links    two-sided consent links between an adult guardian and a minor, with limited controls.
 * minors_events     transparency log a minor (and staff) can read: defaults applied, guardian changes, age events. */
module.exports = {
  id: "018_minors",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS age_profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, birth_date TEXT, source TEXT NOT NULL DEFAULT 'self', declared_at {TS}, changes INTEGER NOT NULL DEFAULT 0, pending_birth_date TEXT, pending_at {TS}, kyc_signal TEXT, kyc_at {TS}, content_pref TEXT NOT NULL DEFAULT 'blur', defaults_applied_at {TS}, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS age_profiles_pending ON age_profiles(pending_at);
CREATE TABLE IF NOT EXISTS content_labels (target TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT -1, labels TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'publisher', by_user TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, PRIMARY KEY (target, idx));
CREATE TABLE IF NOT EXISTS safety_cases (id TEXT PRIMARY KEY, severity TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', target TEXT, target_kind TEXT, subject_user TEXT, report_id TEXT, summary TEXT, reasons TEXT, minor_involved INTEGER NOT NULL DEFAULT 0, hold INTEGER NOT NULL DEFAULT 0, assigned_to TEXT, created_by TEXT, priority INTEGER NOT NULL DEFAULT 0, sla_due_at {TS}, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, closed_at {TS}, outcome TEXT);
CREATE INDEX IF NOT EXISTS safety_cases_queue ON safety_cases(status, priority);
CREATE INDEX IF NOT EXISTS safety_cases_target ON safety_cases(target, status);
CREATE TABLE IF NOT EXISTS case_evidence (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES safety_cases(id), seq INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT, payload {JSON}, sha256 TEXT NOT NULL, prev_hash TEXT, hash TEXT NOT NULL, captured_by TEXT, captured_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS case_evidence_case ON case_evidence(case_id, seq);
CREATE TABLE IF NOT EXISTS case_access_log (id {SERIAL}, case_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS case_access_log_case ON case_access_log(case_id, at);
CREATE TABLE IF NOT EXISTS safety_staff (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'agent', added_by TEXT, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS authority_reports (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES safety_cases(id), body TEXT NOT NULL, jurisdiction TEXT, status TEXT NOT NULL DEFAULT 'draft', payload {JSON}, payload_sha256 TEXT, notes TEXT, created_by TEXT NOT NULL, created_at {TS} NOT NULL, exported_at {TS}, submitted_at {TS}, submitted_by TEXT, channel TEXT, external_ref TEXT);
CREATE INDEX IF NOT EXISTS authority_reports_case ON authority_reports(case_id);
CREATE TABLE IF NOT EXISTS guardian_links (id TEXT PRIMARY KEY, guardian_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, minor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending', initiated_by TEXT NOT NULL, settings {JSON}, created_at {TS} NOT NULL, accepted_at {TS}, ended_at {TS}, ended_by TEXT);
CREATE INDEX IF NOT EXISTS guardian_links_guardian ON guardian_links(guardian_id, status);
CREATE INDEX IF NOT EXISTS guardian_links_minor ON guardian_links(minor_id, status);
CREATE TABLE IF NOT EXISTS minors_events (id {SERIAL}, user_id TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS minors_events_user ON minors_events(user_id, at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS minors_events; DROP TABLE IF EXISTS guardian_links; DROP TABLE IF EXISTS authority_reports; DROP TABLE IF EXISTS safety_staff;
DROP TABLE IF EXISTS case_access_log; DROP TABLE IF EXISTS case_evidence; DROP TABLE IF EXISTS safety_cases; DROP TABLE IF EXISTS content_labels; DROP TABLE IF EXISTS age_profiles`);
  }
};
