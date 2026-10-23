/* 058 — Contracts, milestones and escrow «العقود والمراحل» (phase 78). Additive only: five new tables. Pi amounts are BIGINT
 * units of 1e-7 π on PostgreSQL.
 * contracts              an agreement between a client and a worker: from an accepted job application (phase 77) or a direct
 *                        offer; title, scope, revisions allowed per milestone, status offer | active | completed | declined |
 *                        cancelled, total (sum of milestones), paid flag.
 * contract_milestones    ordered milestones: title, details, amount (0 = unpaid), due date, status pending | funded | submitted |
 *                        revision | approved | released | refunded | cancelled, revisions used, escrow intent + journals,
 *                        dispute freeze, worker share after a split.
 * contract_deliverables  what the worker hands over for a milestone: a note and up to 5 links.
 * contract_events        one timeline both sides see: offers, acceptances, funding, submissions, approvals, messages.
 * contract_disputes      a dispute on a milestone, resolved by staff: release / refund / split (worker share). */
module.exports = {
  id: "058_contracts",
  async up(db, exec, dialect) {
    const BIG = dialect === "postgres" ? "BIGINT" : "INTEGER";
    await exec(`
CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, worker_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'offer', job_id TEXT, app_id TEXT, title TEXT NOT NULL, scope TEXT NOT NULL, max_revisions INTEGER NOT NULL DEFAULT 2, total ${BIG} NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'offer', decline_note TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, accepted_at {TS}, completed_at {TS}, closed_at {TS});
CREATE INDEX IF NOT EXISTS contracts_client ON contracts(client_id, status);
CREATE INDEX IF NOT EXISTS contracts_worker ON contracts(worker_id, status);
CREATE INDEX IF NOT EXISTS contracts_app ON contracts(app_id);
CREATE TABLE IF NOT EXISTS contract_milestones (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, pos INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, amount ${BIG} NOT NULL DEFAULT 0, due TEXT, status TEXT NOT NULL DEFAULT 'pending', revisions INTEGER NOT NULL DEFAULT 0, intent_id TEXT, hold_journal TEXT, settle_journal TEXT, worker_amount ${BIG}, fee ${BIG}, disputed INTEGER NOT NULL DEFAULT 0, funded_at {TS}, submitted_at {TS}, approved_at {TS}, settled_at {TS});
CREATE INDEX IF NOT EXISTS contract_ms_c ON contract_milestones(contract_id, pos);
CREATE INDEX IF NOT EXISTS contract_ms_intent ON contract_milestones(intent_id);
CREATE INDEX IF NOT EXISTS contract_ms_status ON contract_milestones(status, submitted_at);
CREATE TABLE IF NOT EXISTS contract_deliverables (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, milestone_id TEXT NOT NULL, user_id TEXT NOT NULL, note TEXT NOT NULL, links TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS contract_dl_ms ON contract_deliverables(milestone_id, created_at);
CREATE TABLE IF NOT EXISTS contract_events (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, milestone_id TEXT, actor_id TEXT, kind TEXT NOT NULL, body TEXT, warn INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS contract_ev_c ON contract_events(contract_id, created_at);
CREATE TABLE IF NOT EXISTS contract_disputes (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, milestone_id TEXT NOT NULL, opened_by TEXT NOT NULL, reason TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', outcome TEXT, worker_share ${BIG}, staff_id TEXT, staff_note TEXT, created_at {TS} NOT NULL, resolved_at {TS});
CREATE INDEX IF NOT EXISTS contract_dp_status ON contract_disputes(status, created_at);
CREATE INDEX IF NOT EXISTS contract_dp_c ON contract_disputes(contract_id)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS contract_disputes; DROP TABLE IF EXISTS contract_events; DROP TABLE IF EXISTS contract_deliverables; DROP TABLE IF EXISTS contract_milestones; DROP TABLE IF EXISTS contracts`);
  }
};
