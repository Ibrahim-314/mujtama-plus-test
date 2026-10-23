/* Analytics event sink (Phase 15). Every event lands in the primary database (post_views and
 * analytics_events) so the studio works out of the box; when CLICKHOUSE_URL is set, events are
 * also batched to ClickHouse (JSONEachRow over HTTP) so heavy reporting can move off PostgreSQL.
 *   CREATE TABLE events (at DateTime64(3), name LowCardinality(String), post String, author String,
 *                        user String, source LowCardinality(String)) ENGINE = MergeTree ORDER BY (author, at) */
const { secret } = require("./secrets");
function createAnalytics({ log = console } = {}) {
  const url = process.env.CLICKHOUSE_URL, table = process.env.CLICKHOUSE_TABLE || "events", user = process.env.CLICKHOUSE_USER || "default", pass = secret("CLICKHOUSE_PASSWORD") || "";
  let buf = [], timer = null, sent = 0, failed = 0;
  async function flush() {
    timer = null; if (!buf.length || !url) { buf = []; return; }
    const rows = buf; buf = [];
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/?query=${encodeURIComponent(`INSERT INTO ${table} FORMAT JSONEachRow`)}`, { method: "POST", body: rows.map(x => JSON.stringify(x)).join("\n"), headers: { "X-ClickHouse-User": user, "X-ClickHouse-Key": pass } });
      if (!r.ok) throw new Error("clickhouse " + r.status); sent += rows.length;
    } catch (e) { failed += rows.length; log.error?.("analytics sink failed", { err: e.message, rows: rows.length }); }
  }
  return {
    enabled: !!url,
    emit(name, props = {}) { if (!url) return; buf.push({ at: new Date().toISOString().replace("T", " ").replace("Z", ""), name, post: props.post || "", author: props.author || "", user: props.user || "", source: props.source || "" }); if (buf.length >= 500) flush(); else if (!timer) timer = setTimeout(flush, 2000); },
    flush, stats: () => ({ enabled: !!url, sent, failed, buffered: buf.length })
  };
}
module.exports = { createAnalytics };
