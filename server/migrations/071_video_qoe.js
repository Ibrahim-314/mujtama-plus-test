/* 071 — v2.70 video quality-of-experience (QoE) metrics: one row per finished/abandoned playback reported by the client
 * helper (qoe.js → POST /api/video/qoe, batched). Additive only: one new table + one index. Nothing existing is renamed,
 * retyped, dropped or rewritten; no backfill.
 *   video_qoe        id (autoincrement), user_id (the only personal datum — no IP, no user agent, no device id),
 *                    post_id, source clips | post, startup_ms (play request → first 'playing', 0…STARTUP_MAX),
 *                    stalls (count of 'waiting' after start, 0…STALLS_MAX), stall_ms (0…MS_MAX), watched_ms (0…MS_MAX),
 *                    rung (HLS level index or NULL when progressive/unknown, 0…RUNG_MAX), created_at.
 *   video_qoe_at     index (created_at) — every read is "the last N days" and the 30-day prune is a range delete.
 * Retention: RETENTION_DAYS (30), pruned by the observability "ops.prune" job. The CHECKs are a backstop; the service
 * validates/clamps first. IF NOT EXISTS makes a re-run a no-op; down() restores the v2.69 schema exactly. */
const SOURCES = Object.freeze(["clips", "post"]);
const STARTUP_MAX = 120000; // 2 min — anything longer is a broken measurement, clamped by the service
const STALLS_MAX = 1000;
const MS_MAX = 6 * 3600e3; // 6 h of watching/stalling in one playback
const RUNG_MAX = 15;
const RETENTION_DAYS = 30;
const BATCH_MAX = 20;
const list = a => a.map(s => `'${s}'`).join(", ");

module.exports = {
  id: "071_video_qoe",
  SOURCES, STARTUP_MAX, STALLS_MAX, MS_MAX, RUNG_MAX, RETENTION_DAYS, BATCH_MAX,
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS video_qoe (id {SERIAL}, user_id TEXT NOT NULL, post_id TEXT NOT NULL CHECK (length(post_id) BETWEEN 1 AND 64), source TEXT NOT NULL CHECK (source IN (${list(SOURCES)})), startup_ms INTEGER NOT NULL CHECK (startup_ms BETWEEN 0 AND ${STARTUP_MAX}), stalls INTEGER NOT NULL DEFAULT 0 CHECK (stalls BETWEEN 0 AND ${STALLS_MAX}), stall_ms INTEGER NOT NULL DEFAULT 0 CHECK (stall_ms BETWEEN 0 AND ${MS_MAX}), watched_ms INTEGER NOT NULL DEFAULT 0 CHECK (watched_ms BETWEEN 0 AND ${MS_MAX}), rung INTEGER CHECK (rung IS NULL OR rung BETWEEN 0 AND ${RUNG_MAX}), created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS video_qoe_at ON video_qoe(created_at);
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS video_qoe_at");
    await exec("DROP TABLE IF EXISTS video_qoe");
  }
};
