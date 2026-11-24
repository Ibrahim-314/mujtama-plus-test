/* v2.159 — unified achievement events (MJT readiness, migration 089_achievements).
 * One hook for every "a member reached a milestone" signal: record(uid, type, ref, meta) appends one row to
 * achievement_events, at most once per (uid, type, ref). It carries NO amount and NO balance, and it credits nothing —
 * not MJT, not points. It is only the signal a later, separately approved rewards stage may read (bus ACHIEVEMENT_RECORDED).
 *
 * Callers use emit(): fire-and-forget, never throws, never delays or breaks the action that succeeded (a failed write is
 * logged and dropped). Emitted from existing success paths only:
 *   quiz_passed          courses.quiz (ref = lesson id)          course_completed   bus COURSE_COMPLETED (ref = course id)
 *   team_created         teams.create (ref = team id)            collection_created collections.createCollection (ref = id)
 *   saved_search_created search.saveSearch (ref = saved id)      article_published  bus POST_PUBLISHED, type 'article' only
 * Admin only: GET /api/admin/achievements → counts by type (members 403). */
const { E, id } = require("../lib/core");

const TYPES = ["quiz_passed", "course_completed", "team_created", "collection_created", "saved_search_created", "article_published"];

/** @param {any} ctx */
module.exports = (ctx) => {
  const { db, bus } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const inflight = new Set();

  /** append one achievement event; idempotent on (uid, type, ref). → { recorded: true } the first time, false after. */
  async function record(uid, type, ref, meta) {
    if (typeof uid !== "string" || !uid || !TYPES.includes(type) || ref === null || ref === undefined || ref === "") return { recorded: false, reason: "invalid" };
    const r = String(ref).slice(0, 120);
    let m = null;
    if (meta && typeof meta === "object") { try { m = JSON.stringify(meta).slice(0, 1000); } catch { m = null; } }
    const at = new Date().toISOString();
    const ins = await db.run("INSERT INTO achievement_events(id,user_id,type,ref,meta,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [id("ach"), uid, type, r, m, at]);
    if (!ins.changes) return { recorded: false, reason: "duplicate" };
    try { bus?.emit?.("ACHIEVEMENT_RECORDED", { user: uid, type, ref: r, at }); } catch { /* listeners never break the record */ }
    return { recorded: true };
  }
  /** fire-and-forget wrapper for success paths: never throws, never awaited by the caller */
  function emit(uid, type, ref, meta) {
    let p;
    try { p = Promise.resolve(api.record(uid, type, ref, meta)); } catch (err) { p = Promise.reject(err); }
    p = p.catch((err) => logger.warn?.("achievement record failed", { type, err: err?.message })).finally(() => inflight.delete(p));
    inflight.add(p);
  }
  /** test helper: wait for pending emits */
  const settle = () => Promise.all([...inflight]);

  async function counts() {
    const rows = await db.all("SELECT type, COUNT(*) n, COUNT(DISTINCT user_id) u FROM achievement_events GROUP BY type");
    const by = Object.fromEntries(rows.map((x) => [x.type, { events: Number(x.n), members: Number(x.u) }]));
    return { types: TYPES.map((t) => ({ type: t, events: by[t]?.events || 0, members: by[t]?.members || 0 })), total: rows.reduce((s, x) => s + Number(x.n), 0) };
  }

  bus?.on?.("COURSE_COMPLETED", (e) => { if (e?.user && e?.course) emit(e.user, "course_completed", e.course); });
  bus?.on?.("POST_PUBLISHED", (e) => { const p = e?.post; if (p && p.type === "article" && p.author && p.id) emit(p.author, "article_published", p.id); });

  R.get("/api/admin/achievements", A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return counts(); }));

  const api = { TYPES, record, emit, settle, counts };
  return api;
};
