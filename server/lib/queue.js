/* Durable job queue (Phase 13): media processing runs off the request path, survives restarts,
 * retries with exponential backoff, and scales horizontally — PostgreSQL workers claim jobs with
 * FOR UPDATE SKIP LOCKED, so any number of `node server/worker.js` processes can share the load. */
const os = require("node:os");
const { id, now } = require("./core");
function createQueue(db, { log = console, concurrency = +process.env.MEDIA_CONCURRENCY || 2, maxAttempts = +process.env.MEDIA_MAX_ATTEMPTS || 4 } = {}) {
  const handlers = {}, failHandlers = {}, workerId = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 6)}`;
  let running = 0, timer = null, stopped = false; const waiters = new Set();
  async function enqueue(kind, payload, { delayMs = 0 } = {}) {
    const jid = id("jb"); await db.run("INSERT INTO media_jobs(id,kind,payload,status,run_after,created_at) VALUES($1,$2,$3,'queued',$4,$5)", [jid, kind, payload, new Date(Date.now() + delayMs).toISOString(), now()]);
    kick(); return jid;
  }
  /* a worker only claims job kinds it has handlers for, so specialised workers can share one table */
  async function claim() {
    const t = now(), kinds = Object.keys(handlers); if (!kinds.length) return null;
    const ph = kinds.map((_, i) => "$" + (i + 3)).join(",");
    if (db.dialect === "postgres") return db.get(`UPDATE media_jobs SET status='running', locked_by=$1, locked_at=$2, attempts=attempts+1 WHERE id=(SELECT id FROM media_jobs WHERE status='queued' AND run_after <= $2 AND kind IN (${ph}) ORDER BY run_after LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, [workerId, t, ...kinds]);
    const j = await db.get(`SELECT * FROM media_jobs WHERE status='queued' AND run_after <= $2 AND kind IN (${ph}) AND $1=$1 ORDER BY run_after LIMIT 1`, [workerId, t, ...kinds]); if (!j) return null;
    const r = await db.run("UPDATE media_jobs SET status='running', locked_by=$1, locked_at=$2, attempts=attempts+1 WHERE id=$3 AND status='queued'", [workerId, t, j.id]);
    return r.changes ? { ...j, attempts: j.attempts + 1 } : null;
  }
  async function runOne(job) {
    const h = handlers[job.kind];
    try {
      if (!h) throw new Error("no handler for " + job.kind);
      await h(job.payload, job);
      await db.run("UPDATE media_jobs SET status='done', finished_at=$1, error=NULL WHERE id=$2", [now(), job.id]);
    } catch (e) {
      const final = job.attempts >= maxAttempts;
      await db.run("UPDATE media_jobs SET status=$1, error=$2, run_after=$3, locked_by=NULL WHERE id=$4", [final ? "failed" : "queued", String(e.message).slice(0, 500), new Date(Date.now() + 2000 * 2 ** job.attempts).toISOString(), job.id]);
      log.error?.("job failed", { job: job.kind, id: job.id, attempt: job.attempts, final, err: e.message });
      if (final && failHandlers[job.kind]) try { await failHandlers[job.kind](job.payload, e, job); } catch (fe) { log.error?.("job fail handler", { job: job.kind, err: fe.message }); } // v2.60 M1: surface a final failure
    }
  }
  async function pump() {
    if (stopped) return;
    while (running < concurrency) {
      const job = await claim().catch(() => null); if (!job) break;
      running++; runOne(job).finally(() => { running--; for (const w of waiters) w(); kick(); });
    }
  }
  function kick() { if (!stopped) setImmediate(() => pump()); }
  return {
    workerId, enqueue,
    on(kind, fn) { handlers[kind] = fn; },
    /** v2.60 M1: called once when a job of this kind fails for the last time (attempts exhausted) */
    onFailed(kind, fn) { failHandlers[kind] = fn; },
    start(pollMs = 1000) { stopped = false; timer = setInterval(() => { pump(); db.run("UPDATE media_jobs SET status='queued', locked_by=NULL WHERE status='running' AND locked_at < $1", [new Date(Date.now() - 15 * 60e3).toISOString()]).catch(() => { }); }, pollMs); kick(); return this; },
    stop() { stopped = true; clearInterval(timer); },
    /* resolves when the queue has no due work (tests, graceful shutdown) */
    async drain(timeoutMs = 60e3) { const end = Date.now() + timeoutMs; while (Date.now() < end) { const n = (await db.get("SELECT COUNT(*) n FROM media_jobs WHERE status IN ('queued','running') AND run_after <= $1", [new Date(Date.now() + 5000).toISOString()])).n; if (!n && !running) return true; await new Promise(r => { waiters.add(r); setTimeout(r, 200); }); } return false; },
    stats: async () => Object.fromEntries((await db.all("SELECT status, COUNT(*) n FROM media_jobs GROUP BY status")).map(r => [r.status, Number(r.n)]))
  };
}
module.exports = { createQueue };
