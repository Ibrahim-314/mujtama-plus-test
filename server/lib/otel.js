/* Distributed tracing (phase 49), opt-in: OFF unless OTEL_EXPORTER_OTLP_ENDPOINT is set — then every API request
 * becomes a server span (W3C traceparent in/out) and database calls become child spans.
 * • If @opentelemetry/api is installed AND an SDK registered a tracer provider, spans go through it (loaded with a
 *   dynamic import only when present — no dependency is added).
 * • Otherwise a built-in exporter batches spans as OTLP/HTTP JSON to `${endpoint}/v1/traces`
 *   (OTEL_EXPORTER_OTLP_TRACES_ENDPOINT overrides the full URL; OTEL_EXPORTER_OTLP_HEADERS "k=v,k2=v2").
 * OTEL_SERVICE_NAME (mujtama-plus), OTEL_TRACES_SAMPLER_ARG ratio 0..1 (1). Disabled → every function is a no-op. */
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

function createTracer({ env = process.env, log = console, fetchImpl = globalThis.fetch, version = "" } = {}) {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint)
    return { enabled: false, startRequest: () => null, endRequest() {}, wrapDb: db => db, flush: async () => {}, stats: () => ({ enabled: false }) };
  const url = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || endpoint.replace(/\/$/, "") + "/v1/traces";
  const headers = { "Content-Type": "application/json" };
  for (const kv of String(env.OTEL_EXPORTER_OTLP_HEADERS || "").split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) headers[decodeURIComponent(kv.slice(0, i).trim())] = decodeURIComponent(kv.slice(i + 1).trim());
  }
  const service = env.OTEL_SERVICE_NAME || "mujtama-plus",
    ratio = Math.max(0, Math.min(1, env.OTEL_TRACES_SAMPLER_ARG === undefined ? 1 : +env.OTEL_TRACES_SAMPLER_ARG || 0));
  const als = new AsyncLocalStorage();
  let api = null,
    buf = [],
    timer = null,
    sent = 0,
    failed = 0;
  // optional official API: only when the package is resolvable (never a hard dependency)
  const OTEL_API = "@opentelemetry/api"; // name in a variable: optional, never a declared dependency
  try {
    require.resolve(OTEL_API);
    import(OTEL_API)
      .then(m => {
        const d = m.trace.getTracerProvider()?.getDelegate?.();
        if (d && d.constructor?.name !== "NoopTracerProvider") api = m;
      })
      .catch(() => {});
  } catch {
    /* not installed → built-in exporter */
  }

  const hex = n => crypto.randomBytes(n).toString("hex");
  const nowNs = () => BigInt(Date.now()) * 1000000n;
  const attrs = o =>
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([key, v]) => ({
        key,
        value:
          typeof v === "number"
            ? Number.isInteger(v)
              ? { intValue: String(v) }
              : { doubleValue: v }
            : typeof v === "boolean"
              ? { boolValue: v }
              : { stringValue: String(v) }
      }));
  function push(span) {
    buf.push(span);
    if (buf.length >= 256) flush();
    else if (!timer) {
      timer = setTimeout(flush, 2000);
      timer.unref?.();
    }
  }
  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!buf.length) return;
    const spans = buf;
    buf = [];
    const body = {
      resourceSpans: [
        {
          resource: { attributes: attrs({ "service.name": service, "service.version": version }) },
          scopeSpans: [{ scope: { name: "mujtama-plus", version }, spans }]
        }
      ]
    };
    try {
      const r = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("otlp " + r.status);
      sent += spans.length;
    } catch (e) {
      failed += spans.length;
      log.warn?.("otel export failed", { err: e.message, spans: spans.length });
    }
  }
  function startSpan(name, kind, parent, attributes = {}) {
    return {
      traceId: parent?.traceId || hex(16),
      spanId: hex(8),
      parentSpanId: parent?.spanId,
      name,
      kind,
      start: nowNs(),
      attributes,
      sampled: parent ? parent.sampled : Math.random() < ratio,
      status: 0
    };
  }
  function endSpan(s, extra = {}) {
    if (!s || !s.sampled) return;
    Object.assign(s.attributes, extra);
    if (api) {
      try {
        const t = api.trace.getTracer("mujtama-plus", version);
        const sp = t.startSpan(s.name, { kind: s.kind === 2 ? 1 : 3, startTime: new Date(Number(s.start / 1000000n)), attributes: s.attributes });
        if (s.status === 2) sp.setStatus({ code: 2 });
        sp.end();
      } catch {
        /* fall through */
      }
      return;
    }
    push({
      traceId: s.traceId,
      spanId: s.spanId,
      ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
      name: s.name,
      kind: s.kind,
      startTimeUnixNano: String(s.start),
      endTimeUnixNano: String(nowNs()),
      attributes: attrs(s.attributes),
      status: { code: s.status }
    });
  }
  return {
    enabled: true,
    url,
    service,
    /* called from the http server's first 'request' listener: the span is entered into async context for the handler */
    startRequest(req, res) {
      const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(String(req.headers.traceparent || ""));
      const parent = m && !/^0+$/.test(m[1]) ? { traceId: m[1], spanId: m[2], sampled: (parseInt(m[3], 16) & 1) === 1 } : null;
      const s = startSpan(req.method + " " + String(req.url).split("?")[0].slice(0, 120), 2, parent, {
        "http.request.method": req.method,
        "url.path": String(req.url).split("?")[0].slice(0, 200)
      });
      res.setHeader("traceparent", `00-${s.traceId}-${s.spanId}-${s.sampled ? "01" : "00"}`);
      als.enterWith(s);
      return s;
    },
    endRequest(s, { route, status, requestId }) {
      if (!s) return;
      if (route) s.name = s.attributes["http.request.method"] + " " + route;
      if (status >= 500) s.status = 2;
      endSpan(s, { "http.route": route, "http.response.status_code": status, "mujtama.request_id": requestId });
    },
    /* wraps get/all/run/exec so each query becomes a child span of the request (statement text only, never parameters) */
    wrapDb(db) {
      for (const fn of ["get", "all", "run", "exec"]) {
        const orig = db[fn];
        if (typeof orig !== "function") continue;
        db[fn] = function (sql, ...rest) {
          const parent = als.getStore();
          if (!parent || !parent.sampled) return orig.call(this, sql, ...rest);
          const s = startSpan("db." + fn, 3, parent, {
            "db.system": db.dialect === "postgres" ? "postgresql" : "sqlite",
            "db.statement": String(sql).slice(0, 300)
          });
          const p = orig.call(this, sql, ...rest);
          return Promise.resolve(p).then(
            v => (endSpan(s), v),
            e => {
              s.status = 2;
              endSpan(s, { "error.message": String(e?.message || e).slice(0, 200) });
              throw e;
            }
          );
        };
      }
      return db;
    },
    current: () => als.getStore() || null,
    flush,
    stats: () => ({ enabled: true, url, service, via: api ? "@opentelemetry/api" : "otlp-http-json", buffered: buf.length, sent, failed, ratio })
  };
}
module.exports = { createTracer };
