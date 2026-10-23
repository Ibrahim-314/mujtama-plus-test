/* Reliable scheduled jobs (Phase 19): each job runs on exactly one instance at a time. An instance
 * takes a time-boxed lease row in job_leases before running; if it crashes the lease simply expires
 * and another instance takes over. Work itself is idempotent (e.g. reminder_log de-duplicates). */
const os = require("node:os");
function createScheduler(db, { log = console } = {}) {
  const holder = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 6)}`, timers = [], state = {};
  async function lease(name, ms) {
    const t = new Date(), until = new Date(t.getTime() + ms).toISOString();
    const r = await db.run("UPDATE job_leases SET holder=$1, until=$2 WHERE name=$3 AND (until < $4 OR holder=$1)", [holder, until, name, t.toISOString()]);
    if (r.changes) return true;
    const ins = await db.run("INSERT INTO job_leases(name,holder,until) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [name, holder, until]);
    return !!ins.changes;
  }
  async function runOnce(name, fn, leaseMs) {
    if (!(await lease(name, leaseMs).catch(() => false))) return { skipped: true };
    const t = Date.now();
    try { const out = await fn(); await db.run("UPDATE job_leases SET last_run=$1 WHERE name=$2", [new Date().toISOString(), name]); state[name] = { ok: true, lastRun: new Date().toISOString(), ms: Date.now() - t }; return { ok: true, out }; }
    catch (e) { state[name] = { ok: false, lastRun: new Date().toISOString(), error: e.message }; log.error?.("scheduled job failed", { job: name, err: e.message }); return { ok: false }; }
  }
  return {
    holder, state,
    every(name, ms, fn) { const lm = Math.max(ms * 2, 30e3); timers.push(setInterval(() => runOnce(name, fn, lm), ms)); return this; },
    runOnce: (name, fn, leaseMs = 60e3) => runOnce(name, fn, leaseMs),
    stop() { timers.forEach(clearInterval); }
  };
}
module.exports = { createScheduler };
