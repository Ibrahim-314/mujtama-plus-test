/* Observability & operations service (phase 49) — zero budget, no new services.
 * • Prometheus: GET /metrics (text format 0.0.4, own registry in lib/prom.js). Needs `Authorization: Bearer $METRICS_TOKEN`;
 *   with METRICS_TOKEN unset /metrics answers 404 (not exposed publicly). Admins can always read GET /api/metrics.
 * • Tracing: lib/otel.js, opt-in with OTEL_EXPORTER_OTLP_ENDPOINT (no-op otherwise).
 * • Per-minute request rollups in ops_rollups (per instance) → admin charts, SLO error budgets and alert rules.
 * • On-call alerts: rule evaluator (error rate, p95 latency, queue backlog, failed jobs, client errors) every minute on one
 *   instance (leased) → existing channels only: in-app notification to admins, webhook (OPS_ALERT_WEBHOOK_URL or the
 *   existing ERROR_WEBHOOK_URL), e-mail via the existing mailer (SMTP_URL + OPS_ALERT_EMAIL). OPS_ALERTS=0 turns it off.
 * • Component checks every minute → hourly uptime tallies → public status page GET /status (server-rendered, no JS) and
 *   GET /api/status/public; admins post incidents and updates.
 * • Product metrics (growth, DAU/WAU/MAU, weekly retention cohorts, engagement) computed from existing tables.
 * • DR drills: server/scripts/dr-drill.js reports its result to POST /api/ops/dr-drills (METRICS_TOKEN or admin). */
const os = require("node:os"), crypto = require("node:crypto");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const { E, str, now, id } = require("../lib/core");
const { createRegistry } = require("../lib/prom");
const { createTracer } = require("../lib/otel");

const COMPONENTS = [
  ["api", "الموقع والتطبيق"], ["database", "قاعدة البيانات"], ["realtime", "الرسائل والإشعارات الفورية"],
  ["media", "رفع ومعالجة الوسائط"], ["email", "البريد الإلكتروني"], ["pi", "مدفوعات Pi"],
  ["push", "إشعارات الجهاز (Push)"], ["translate", "الترجمة الآلية"] // phase 52
];
const COMPONENT_IDS = new Set(COMPONENTS.map(c => c[0]));
const METRICS = { error_rate: "نسبة الأخطاء ٪", latency_p95: "زمن الاستجابة p95 (مللي ثانية)", queue_backlog: "طابور المهام المتأخرة", jobs_failed: "مهام فاشلة", client_errors: "أخطاء الواجهة" };
const DEFAULT_RULES = [
  ["high_error_rate", "نسبة أخطاء الخادم مرتفعة", "error_rate", ">", 5, 5, "critical"],
  ["slow_responses", "زمن الاستجابة بطيء", "latency_p95", ">", 1500, 10, "warning"],
  ["queue_backlog", "طابور المهام متراكم", "queue_backlog", ">", 500, 5, "warning"],
  ["jobs_failing", "مهام خلفية تفشل", "jobs_failed", ">", 20, 15, "warning"]
];
const DEFAULT_SLOS = [["availability", "التوفر (بلا أخطاء خادم)", "availability", 99.5, 30], ["latency", "سرعة الاستجابة", "latency", 95, 30]];
const INCIDENT_STATUS = { investigating: "قيد التحقيق", identified: "تم تحديد السبب", monitoring: "قيد المراقبة", resolved: "تم الحل" };
const IMPACT = { minor: "تأثير طفيف", major: "تأثير كبير", critical: "انقطاع" };
const STATE_AR = { operational: "يعمل بشكل طبيعي", degraded: "أداء متراجع", outage: "انقطاع", not_configured: "غير مفعّل بعد" };

module.exports = (ctx, opts = {}) => {
  const { db, router: R, config } = ctx;
  const env = opts.env || process.env, log = opts.log || require("../lib/log").log;
  const instance = `${os.hostname()}:${process.pid}`;
  const sloLatencyMs = +(env.OPS_SLO_LATENCY_MS || 800), minReq = +(env.OPS_ALERT_MIN_REQUESTS || 20);
  const metricsToken = () => (opts.env || process.env).METRICS_TOKEN || "";
  const admin = fn => ctx.requireUser(async (req, res) => { if (req.user.role !== "admin") throw E.forbid(); return fn(req, res); });
  const isPg = db.dialect === "postgres";
  const dayOf = col => (isPg ? `to_char(${col} AT TIME ZONE 'UTC','YYYY-MM-DD')` : `substr(${col},1,10)`);
  const minuteKey = t => new Date(t).toISOString().slice(0, 16);
  const hourKey = t => new Date(t).toISOString().slice(0, 13);
  const cached = (key, ms, fn) => ctx.cache.wrap("ops:" + key, ms, fn);

  /* ---------------- tracing ---------------- */
  const tracer = opts.tracer || createTracer({ env, log, version: config.version, fetchImpl: opts.fetch });
  if (tracer.enabled) tracer.wrapDb(db);

  /* ---------------- Prometheus registry ---------------- */
  const reg = createRegistry({ prefix: "mujtama_" });
  const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
  const httpTotal = reg.counter("http_requests_total", "HTTP requests by method, route pattern and status class");
  const httpDur = reg.histogram("http_request_duration_seconds", "HTTP request latency in seconds (streams excluded)");
  const inflight = reg.gauge("http_requests_in_flight", "Requests being served right now");
  const appInfo = reg.gauge("app_info", "Build information");
  const g = (name, help, fn) => { const m = reg.gauge(name, help, async () => { for (const [l, v] of await fn()) m.set(l, v); }); return m; };
  g("process_resident_memory_bytes", "Resident memory", () => [[{}, process.memoryUsage().rss]]);
  g("process_heap_used_bytes", "V8 heap used", () => [[{}, process.memoryUsage().heapUsed]]);
  g("process_uptime_seconds", "Process uptime", () => [[{}, Math.round(process.uptime())]]);
  g("event_loop_lag_p99_seconds", "Event loop delay p99", () => { const v = loop.percentile(99) / 1e9; loop.reset(); return [[{}, Math.round(v * 1e6) / 1e6]]; });
  g("db_ping_seconds", "Database round trip", async () => { const t = process.hrtime.bigint(); await db.get("SELECT 1 x"); return [[{ dialect: db.dialect }, Number(process.hrtime.bigint() - t) / 1e9]]; });
  g("queue_jobs", "Background job rows by status", async () => Object.entries(await cached("qstats", 10e3, () => ctx.queue.stats())).map(([s, n]) => [{ status: s }, n]));
  g("realtime_connections", "Open realtime connections", () => [[{}, ctx.realtime?.online?.() || 0]]);
  g("component_up", "Component health from the last check (1 up, 0 down)", () => Object.entries(lastCheck).filter(([, v]) => v !== null).map(([c, v]) => [{ component: c }, v ? 1 : 0]));
  g("alerts_firing", "On-call alerts currently firing", async () => [[{}, (await db.get("SELECT COUNT(*) n FROM ops_alerts WHERE state='firing'")).n]]);
  g("slo_error_budget_remaining_ratio", "Remaining error budget per SLO (1 = untouched, <0 = exhausted)", async () => (await cached("slos", 30e3, sloReport)).map(s => [{ slo: s.id }, s.budgetRemaining]));
  g("users_total", "Registered users", async () => [[{}, (await cached("ucount", 60e3, () => db.get("SELECT COUNT(*) n FROM users"))).n]]);
  g("posts_total", "Published posts", async () => [[{}, (await cached("pcount", 60e3, () => db.get("SELECT COUNT(*) n FROM posts WHERE status='published'"))).n]]);
  g("job_last_run_ok", "Background jobs: last run succeeded (1) or failed (0)", () => Object.entries({ ...(ctx.jobsState || {}), ...(ctx.scheduler?.state || {}) }).filter(([, v]) => v && typeof v === "object" && "ok" in v).map(([k, v]) => [{ job: k }, v.ok ? 1 : 0]));
  appInfo.set({ version: config.version, node: process.version, dialect: db.dialect }, 1);

  /* ---------------- request recording ---------------- */
  const labelOf = new WeakMap();
  function routeLabel(method, path) {
    if (path.startsWith("/media/")) return "/media/*";
    if (!path.startsWith("/api/")) return path === "/status" || path === "/metrics" ? path : "static";
    let r; try { r = ctx.router.match(method, path); } catch { return "unmatched"; } if (!r) return "unmatched";
    let l = labelOf.get(r.re); if (!l) { l = r.re.source.replace(/^\^/, "").replace(/\\\/\?\$$|\/\?\$$/, "").replace(/\(\[\^\/\]\+\)/g, ":p").replace(/\\\//g, "/"); labelOf.set(r.re, l); }
    return l;
  }
  let win = { requests: 0, errors: 0, slow: 0, durSum: 0, samples: [] }, live = 0;
  const lastMinute = { requests: 0, errors: 0, p95: 0 };
  function record(req, res, t0, span) {
    try { recordInner(req, res, t0, span); } catch (e) { /* v2.68: metrics must never crash the process */ }
  }
  function recordInner(req, res, t0, span) {
    live--;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6, path = String(req.url || "").split("?")[0];
    const route = routeLabel(req.method, path), status = res.statusCode || 0, sc = Math.floor(status / 100) + "xx";
    const stream = /event-stream/.test(String(res.getHeader("content-type") || "")) || req.headers.upgrade;
    httpTotal.inc({ method: req.method, route, status: sc });
    tracer.endRequest(span, { route, status, requestId: res.getHeader("x-request-id") });
    if (stream || route === "/metrics") return;
    httpDur.observe({ method: req.method, route }, ms / 1000);
    win.requests++; win.durSum += ms; if (status >= 500) win.errors++; if (ms > sloLatencyMs) win.slow++;
    if (win.samples.length < 4000) win.samples.push(ms); else win.samples[Math.floor(Math.random() * 4000)] = ms;
  }
  function attach(server) {
    server.prependListener("request", (req, res) => {
      const t0 = process.hrtime.bigint(); live++;
      const span = tracer.enabled && String(req.url || "").startsWith("/api/") ? tracer.startRequest(req, res) : null;
      res.once("close", () => record(req, res, t0, span));
    });
  }
  inflight.set({}, 0);
  reg.metrics.get("mujtama_http_requests_in_flight").collect = () => inflight.set({}, Math.max(0, live));

  async function queueBacklog() { return Number((await db.get("SELECT COUNT(*) n FROM media_jobs WHERE status='queued' AND run_after <= $1", [now()])).n || 0); }
  /* writes the finished minute window (per instance; additive upsert so several flushes per minute merge) */
  async function flushRollup(at = Date.now()) {
    const w = win; win = { requests: 0, errors: 0, slow: 0, durSum: 0, samples: [] };
    const s = w.samples.sort((a, b) => a - b), p95 = s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
    Object.assign(lastMinute, { requests: w.requests, errors: w.errors, p95 });
    const backlog = await queueBacklog().catch(() => 0);
    if (!w.requests && !backlog) return null;
    const b = minuteKey(at - 1);
    await db.run(`INSERT INTO ops_rollups(bucket,instance,requests,errors,slow,dur_ms_sum,p95_ms,queue_backlog) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (bucket,instance) DO UPDATE SET requests=ops_rollups.requests+$3, errors=ops_rollups.errors+$4, slow=ops_rollups.slow+$5, dur_ms_sum=ops_rollups.dur_ms_sum+$6, p95_ms=CASE WHEN ops_rollups.p95_ms > $7 THEN ops_rollups.p95_ms ELSE $7 END, queue_backlog=$8`,
    [b, instance, w.requests, w.errors, w.slow, Math.round(w.durSum * 100) / 100, Math.round(p95 * 100) / 100, backlog]);
    return { bucket: b, ...w, samples: undefined, p95, backlog };
  }

  /* ---------------- component checks + uptime ---------------- */
  const lastCheck = Object.fromEntries(COMPONENTS.map(c => [c[0], null]));
  const pushOn = () => !!ctx.services.activation?.state?.().push.on, translateOn = () => !!ctx.services.translate?.status?.().available; // phase 52
  async function checkComponents() {
    const res = {};
    const timed = async (fn, ms = 3000) => { try { return !!(await Promise.race([fn(), new Promise((_, rj) => setTimeout(() => rj(new Error("timeout")), ms).unref?.())])); } catch { return false; } };
    res.database = await timed(async () => (await db.get("SELECT 1 x")) !== undefined);
    res.api = res.database && !(lastMinute.requests >= minReq && lastMinute.errors / lastMinute.requests > 0.5);
    res.realtime = !!ctx.realtime;
    res.media = await timed(async () => (await queueBacklog()) < +(env.OPS_QUEUE_DOWN || 5000));
    res.email = ctx.mailer?.enabled ? true : null;
    res.pi = config.piEnabled ? true : null;
    res.push = pushOn() ? true : null; // phase 52
    res.translate = translateOn() ? true : null;
    const h = hourKey(Date.now());
    for (const [c, ok] of Object.entries(res)) {
      lastCheck[c] = ok;
      if (ok === null) continue;
      await db.run("INSERT INTO ops_component_checks(component,bucket,ok,total) VALUES($1,$2,$3,1) ON CONFLICT (component,bucket) DO UPDATE SET ok=ops_component_checks.ok+$3, total=ops_component_checks.total+1", [c, h, ok ? 1 : 0]);
    }
    return res;
  }
  async function prune() {
    await db.run("DELETE FROM ops_rollups WHERE bucket < $1", [minuteKey(Date.now() - 35 * 864e5)]);
    await db.run("DELETE FROM ops_component_checks WHERE bucket < $1", [hourKey(Date.now() - 95 * 864e5)]);
    await pruneQoe();
  }

  /* ---------------- SLOs ---------------- */
  async function ensureDefaults() {
    for (const [rid, name, metric, op, th, w, sev] of DEFAULT_RULES)
      await db.run("INSERT INTO ops_alert_rules(id,name,metric,op,threshold,window_min,severity,channels,enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'inapp,webhook,email',1,$8,$8) ON CONFLICT (id) DO NOTHING", [rid, name, metric, op, th, w, sev, now()]);
    for (const [sid, name, sli, target, days] of DEFAULT_SLOS)
      await db.run("INSERT INTO ops_slos(id,name,sli,target,window_days,enabled,updated_at) VALUES($1,$2,$3,$4,$5,1,$6) ON CONFLICT (id) DO NOTHING", [sid, name, sli, target, days, now()]);
  }
  const ready = ensureDefaults().catch(e => log.warn("ops defaults", { err: e.message }));
  async function windowTotals(sinceMs) {
    const r = await db.get("SELECT COALESCE(SUM(requests),0) req, COALESCE(SUM(errors),0) err, COALESCE(SUM(slow),0) slow, COALESCE(SUM(dur_ms_sum),0) dur, COALESCE(MAX(p95_ms),0) p95, COALESCE(MAX(queue_backlog),0) backlog FROM ops_rollups WHERE bucket >= $1", [minuteKey(Date.now() - sinceMs)]);
    return { requests: Number(r.req), errors: Number(r.err), slow: Number(r.slow), durSum: Number(r.dur), p95: Number(r.p95), backlog: Number(r.backlog) };
  }
  async function sloReport() {
    await ready;
    const slos = await db.all("SELECT * FROM ops_slos ORDER BY id");
    const out = [];
    for (const s of slos) {
      const bad = t => (s.sli === "latency" ? t.slow : t.errors);
      const [w, h1, h6] = [await windowTotals(s.window_days * 864e5), await windowTotals(3600e3), await windowTotals(6 * 3600e3)];
      const allowedRatio = Math.max(1e-6, 1 - s.target / 100), allowed = w.requests * allowedRatio;
      const sli = w.requests ? (1 - bad(w) / w.requests) * 100 : null;
      const budgetRemaining = w.requests ? Math.round((1 - bad(w) / Math.max(allowed, 1e-9)) * 1000) / 1000 : 1;
      const burn = t => (t.requests ? Math.round((bad(t) / t.requests / allowedRatio) * 100) / 100 : 0);
      out.push({ id: s.id, name: s.name, sli: s.sli, target: s.target, windowDays: s.window_days, enabled: !!s.enabled, thresholdMs: s.sli === "latency" ? sloLatencyMs : undefined,
        current: sli === null ? null : Math.round(sli * 1000) / 1000, requests: w.requests, bad: bad(w), allowedBad: Math.floor(allowed), budgetRemaining,
        burnRate1h: burn(h1), burnRate6h: burn(h6), state: !w.requests ? "no_data" : budgetRemaining <= 0 ? "exhausted" : budgetRemaining < 0.25 || burn(h1) > 14.4 ? "at_risk" : "ok" });
    }
    return out;
  }

  /* ---------------- alerts ---------------- */
  async function metricValue(metric, windowMin) {
    const since = windowMin * 60e3;
    if (metric === "queue_backlog") return { value: await queueBacklog(), enough: true };
    if (metric === "jobs_failed") return { value: Number((await db.get("SELECT COUNT(*) n FROM media_jobs WHERE status='failed' AND locked_at > $1", [new Date(Date.now() - since).toISOString()])).n), enough: true };
    if (metric === "client_errors") return { value: Number((await db.get("SELECT COALESCE(SUM(count),0) n FROM client_errors WHERE last_at > $1", [new Date(Date.now() - since).toISOString()])).n), enough: true };
    const t = await windowTotals(since);
    if (metric === "error_rate") return { value: t.requests ? Math.round((t.errors / t.requests) * 10000) / 100 : 0, enough: t.requests >= minReq };
    if (metric === "latency_p95") return { value: t.p95, enough: t.requests >= minReq };
    return { value: 0, enough: false };
  }
  const cmp = (op, a, b) => (op === "<" ? a < b : op === ">=" ? a >= b : op === "<=" ? a <= b : a > b);
  async function deliver(rule, state, value) {
    const channels = String(rule.channels || "").split(",").map(s => s.trim()), sent = [];
    const title = `${state === "firing" ? "🔴 تنبيه" : "✅ انتهى التنبيه"}: ${rule.name}`;
    const text = `${title} — ${METRICS[rule.metric] || rule.metric} = ${value} (الحد ${rule.op} ${rule.threshold} خلال ${rule.window_min} دقيقة) · ${config.version}`;
    if (channels.includes("inapp") && ctx.services.notify) {
      const admins = await db.all("SELECT id FROM users WHERE role='admin' AND status='active'");
      for (const a of admins) await ctx.services.notify.notify(a.id, "ops_alert", { ref: rule.id }).catch(() => null);
      if (admins.length) sent.push("inapp");
    }
    const hook = env.OPS_ALERT_WEBHOOK_URL || env.ERROR_WEBHOOK_URL, f = opts.fetch || globalThis.fetch;
    if (channels.includes("webhook") && hook) {
      try { const r = await f(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, alert: { rule: rule.id, name: rule.name, state, metric: rule.metric, value, threshold: rule.threshold, severity: rule.severity, instance, at: now() } }) }); if (r.ok) sent.push("webhook"); } catch (e) { log.warn("ops alert webhook failed", { err: e.message }); }
    }
    if (channels.includes("email") && ctx.mailer?.enabled && env.OPS_ALERT_EMAIL) {
      for (const to of String(env.OPS_ALERT_EMAIL).split(",").map(s => s.trim()).filter(Boolean)) {
        const r = await ctx.mailer.send({ to, subject: title, text, html: `<p dir="rtl">${text.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</p>` }).catch(() => null);
        if (r?.ok) sent.push("email:" + to);
      }
    }
    return sent;
  }
  async function evaluateAlerts() {
    await ready;
    const rules = await db.all("SELECT * FROM ops_alert_rules WHERE enabled=1"), out = [];
    for (const rule of rules) {
      const { value, enough } = await metricValue(rule.metric, rule.window_min);
      const open = await db.get("SELECT * FROM ops_alerts WHERE rule_id=$1 AND state='firing' ORDER BY id DESC LIMIT 1", [rule.id]);
      const bad = enough && cmp(rule.op, value, rule.threshold);
      if (bad && !open) {
        const sent = await deliver(rule, "firing", value);
        await db.run("INSERT INTO ops_alerts(rule_id,state,value,started_at,sent) VALUES($1,'firing',$2,$3,$4)", [rule.id, value, now(), sent.join(",")]);
        log.warn("ops alert firing", { rule: rule.id, value });
        out.push({ rule: rule.id, state: "firing", value, sent });
      } else if (!bad && open) {
        const sent = await deliver(rule, "resolved", value);
        await db.run("UPDATE ops_alerts SET state='resolved', resolved_at=$1, sent=$2 WHERE id=$3", [now(), [open.sent, ...sent].filter(Boolean).join(","), open.id]);
        out.push({ rule: rule.id, state: "resolved", value, sent });
      }
    }
    return out;
  }

  /* ---------------- schedule (stopped together with the scheduler on close) ---------------- */
  const timers = [];
  if (!opts.noTimers) {
    timers.push(setInterval(() => flushRollup().catch(e => log.warn("ops rollup", { err: e.message })), 60e3));
    timers.forEach(t => t.unref?.());
    ctx.scheduler.every("ops.checks", 60e3, () => checkComponents());
    if (env.OPS_ALERTS !== "0") ctx.scheduler.every("ops.alerts", 60e3, () => evaluateAlerts());
    ctx.scheduler.every("ops.prune", 6 * 3600e3, () => prune());
  }
  const stopSched = ctx.scheduler.stop.bind(ctx.scheduler);
  ctx.scheduler.stop = (...a) => { timers.forEach(clearInterval); loop.disable(); tracer.flush().catch(() => { }); return stopSched(...a); };

  /* ---------------- product metrics ---------------- */
  async function product(days = 30) {
    days = Math.max(7, Math.min(90, Math.round(+days || 30)));
    return cached("product:" + days, 300e3, async () => {
      const span = Math.max(days, 56), since = new Date(Date.now() - span * 864e5).toISOString(), today = new Date().toISOString().slice(0, 10);
      const dayList = n => Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 864e5).toISOString().slice(0, 10));
      const signupsRows = await db.all(`SELECT ${dayOf("created_at")} d, COUNT(*) n FROM users WHERE created_at > $1 GROUP BY ${dayOf("created_at")}`, [since]);
      const signups = Object.fromEntries(signupsRows.map(r => [r.d, Number(r.n)]));
      const totalUsers = Number((await db.get("SELECT COUNT(*) n FROM users")).n);
      const sources = [["posts", "author", "created_at"], ["comments", "author", "created_at"], ["reactions", "user_id", "at"], ["analytics_events", "user_id", "at"]];
      const active = new Map(), perDay = { posts: {}, comments: {}, reactions: {} };
      for (const [t, u, at] of sources) {
        const rows = await db.all(`SELECT DISTINCT ${u} AS u, ${dayOf(at)} AS d FROM ${t} WHERE ${at} > $1 AND ${u} IS NOT NULL`, [since]).catch(() => []);
        for (const r of rows) { let s = active.get(r.u); if (!s) active.set(r.u, (s = new Set())); s.add(r.d); }
        if (perDay[t]) for (const r of await db.all(`SELECT ${dayOf(at)} AS d, COUNT(*) n FROM ${t} WHERE ${at} > $1 GROUP BY ${dayOf(at)}`, [since])) perDay[t][r.d] = Number(r.n);
      }
      const byDay = {}; for (const s of active.values()) for (const d of s) byDay[d] = (byDay[d] || 0) + 1;
      const activeIn = n => { const from = new Date(Date.now() - (n - 1) * 864e5).toISOString().slice(0, 10); let c = 0; for (const s of active.values()) for (const d of s) if (d >= from) { c++; break; } return c; };
      const series = dayList(days);
      let cum = totalUsers - series.reduce((a, d) => a + (signups[d] || 0), 0);
      const growth = series.map(d => ({ day: d, signups: signups[d] || 0, users: (cum += signups[d] || 0) }));
      const dau = activeIn(1), wau = activeIn(7), mau = activeIn(30);
      const engagement = series.map(d => ({ day: d, active: byDay[d] || 0, posts: perDay.posts[d] || 0, comments: perDay.comments[d] || 0, reactions: perDay.reactions[d] || 0 }));
      const sum = k => engagement.reduce((a, e) => a + e[k], 0), actDays = engagement.reduce((a, e) => a + e.active, 0);
      // weekly cohorts: users who signed up in each of the last 8 weeks, share active in week 0..7 after signup
      const cohortUsers = await db.all("SELECT id, created_at FROM users WHERE created_at > $1", [new Date(Date.now() - 56 * 864e5).toISOString()]);
      const cohorts = [];
      const dayStr = off => new Date(Date.now() - off * 864e5).toISOString().slice(0, 10); // off days ago
      for (let w = 7; w >= 0; w--) {
        const startOff = (w + 1) * 7 - 1, from = dayStr(startOff), to = dayStr(startOff - 6); // 7 calendar days, w=0 ends today
        const members = cohortUsers.filter(u => { const d = String(u.created_at).slice(0, 10); return d >= from && d <= to; });
        const weeks = [];
        for (let k = 0; k <= w; k++) {
          const ws = dayStr(startOff - 7 * k), we = dayStr(Math.max(0, startOff - 7 * k - 6));
          const n = members.filter(u => [...(active.get(u.id) || [])].some(d => d >= ws && d <= we)).length;
          weeks.push(members.length ? Math.round((n / members.length) * 1000) / 10 : null);
        }
        cohorts.push({ week: from, size: members.length, retention: weeks });
      }
      return { days, asOf: now(), today, totals: { users: totalUsers, dau, wau, mau, stickiness: mau ? Math.round((dau / mau) * 1000) / 10 : 0, signups: sum2(growth), posts: sum("posts"), comments: sum("comments"), reactions: sum("reactions"), actionsPerActiveDay: actDays ? Math.round(((sum("posts") + sum("comments") + sum("reactions")) / actDays) * 100) / 100 : 0 }, growth, engagement, cohorts };
    });
  }
  const sum2 = g => g.reduce((a, x) => a + x.signups, 0);

  /* ---------------- status (public) ---------------- */
  async function publicStatus() {
    return cached("public", 30e3, async () => {
      await ready;
      const since90 = new Date(Date.now() - 90 * 864e5);
      const rows = await db.all("SELECT component, bucket, ok, total FROM ops_component_checks WHERE bucket >= $1", [hourKey(since90)]);
      const open = await db.all("SELECT * FROM ops_incidents WHERE status <> 'resolved' ORDER BY created_at DESC");
      const recent = await db.all("SELECT * FROM ops_incidents WHERE created_at > $1 ORDER BY created_at DESC LIMIT 20", [new Date(Date.now() - 14 * 864e5).toISOString()]);
      const incidents = [...new Map([...open, ...recent].map(i => [i.id, i])).values()];
      const updates = incidents.length ? await db.all(`SELECT incident_id, status, body, at FROM ops_incident_updates WHERE incident_id IN (${incidents.map((_, i) => "$" + (i + 1)).join(",")}) ORDER BY at DESC`, incidents.map(i => i.id)) : [];
      const days = Array.from({ length: 90 }, (_, i) => new Date(Date.now() - (89 - i) * 864e5).toISOString().slice(0, 10));
      const components = COMPONENTS.map(([cid, name]) => {
        const mine = rows.filter(r => r.component === cid), perDay = {};
        for (const r of mine) { const d = r.bucket.slice(0, 10); (perDay[d] ||= { ok: 0, total: 0 }); perDay[d].ok += Number(r.ok); perDay[d].total += Number(r.total); }
        const ok = mine.reduce((a, r) => a + Number(r.ok), 0), total = mine.reduce((a, r) => a + Number(r.total), 0);
        const hit = open.filter(i => String(i.components).split(",").includes(cid));
        const configured = cid === "email" ? !!ctx.mailer?.enabled : cid === "pi" ? !!config.piEnabled : cid === "push" ? pushOn() : cid === "translate" ? translateOn() : true;
        let state = !configured ? "not_configured" : lastCheck[cid] === false ? "outage" : "operational";
        if (configured && hit.length) state = hit.some(i => i.impact === "critical") ? "outage" : "degraded";
        return { id: cid, name, state, label: STATE_AR[state], uptimePct: total ? Math.round((ok / total) * 100000) / 1000 : null,
          days: days.map(d => ({ day: d, pct: perDay[d] ? Math.round((perDay[d].ok / perDay[d].total) * 1000) / 10 : null })) };
      });
      const live = components.filter(c => c.state !== "not_configured");
      const overall = live.some(c => c.state === "outage") ? "outage" : live.some(c => c.state === "degraded") ? "degraded" : "operational";
      return { overall, label: overall === "operational" ? "جميع الأنظمة تعمل بشكل طبيعي" : overall === "degraded" ? "بعض الخدمات تعمل بأداء متراجع" : "انقطاع في بعض الخدمات",
        components, incidents: incidents.map(i => ({ id: i.id, title: i.title, status: i.status, statusLabel: INCIDENT_STATUS[i.status], impact: i.impact, impactLabel: IMPACT[i.impact], components: String(i.components).split(",").filter(Boolean), createdAt: i.created_at, resolvedAt: i.resolved_at, updates: updates.filter(u => u.incident_id === i.id).map(u => ({ status: u.status, statusLabel: INCIDENT_STATUS[u.status], body: u.body, at: u.at })) })),
        updatedAt: now(), version: config.version };
    });
  }
  const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const COLORS = { operational: "#1f9d55", degraded: "#d97706", outage: "#dc2626", not_configured: "#94a3b8" };
  const fmt = iso => { try { return new Date(iso).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };
  function statusHtml(s) {
    const bar = c => `<svg class="bars" viewBox="0 0 450 34" preserveAspectRatio="none" role="img" aria-label="توفر ${h(c.name)} آخر 90 يوماً">${c.days.map((d, i) => `<rect x="${i * 5}" y="0" width="4" height="34" rx="1" fill="${d.pct === null ? "#e2e8f0" : d.pct >= 99.5 ? COLORS.operational : d.pct >= 95 ? COLORS.degraded : COLORS.outage}"><title>${d.day}: ${d.pct === null ? "لا بيانات" : d.pct + "٪"}</title></rect>`).join("")}</svg>`;
    const inc = s.incidents.map(i => `<article class="inc"><h3>${h(i.title)} <span class="tag ${i.status === "resolved" ? "ok" : i.impact}">${h(i.statusLabel)}</span></h3><p class="muted">${h(i.impactLabel)} · ${h(fmt(i.createdAt))}${i.components.length ? " · " + i.components.map(c => h((COMPONENTS.find(x => x[0] === c) || [c, c])[1])).join("، ") : ""}</p>${i.updates.map(u => `<p><b>${h(u.statusLabel)}</b> — ${h(u.body)} <span class="muted">(${h(fmt(u.at))})</span></p>`).join("")}</article>`).join("");
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>حالة الخدمة — مجتمع بلس</title><meta name="robots" content="noindex"><meta http-equiv="refresh" content="60">
<style>body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;margin:0;background:#f8fafc;color:#0f172a}main{max-width:760px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}.hero{border-radius:14px;padding:18px;color:#fff;margin:16px 0;font-weight:700;font-size:18px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;margin:10px 0}.row{display:flex;justify-content:space-between;gap:8px;align-items:center}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-inline-end:6px}.bars{width:100%;height:34px;margin-top:8px;direction:ltr}.muted{color:#64748b;font-size:14px}.inc h3{font-size:17px;margin:0}.tag{font-size:12px;border-radius:999px;padding:2px 8px;background:#fef3c7;color:#92400e;margin-inline-start:6px}.tag.ok{background:#dcfce7;color:#166534}.tag.critical{background:#fee2e2;color:#991b1b}a{color:#2563eb}@media (prefers-color-scheme:dark){body{background:#0b1220;color:#e2e8f0}.card{background:#111a2e;border-color:#1e293b}.muted{color:#94a3b8}}</style></head>
<body><main><h1>حالة خدمات مجتمع بلس</h1><p class="muted">تُحدَّث كل دقيقة · آخر تحديث ${h(fmt(s.updatedAt))}</p>
<div class="hero" style="background:${COLORS[s.overall]}">${h(s.label)}</div>
${s.components.map(c => `<section class="card"><div class="row"><b><span class="dot" style="background:${COLORS[c.state]}"></span>${h(c.name)}</b><span class="muted">${h(c.label)}${c.uptimePct !== null ? " · " + c.uptimePct + "٪ خلال 90 يوماً" : ""}</span></div>${c.state === "not_configured" ? "" : bar(c)}</section>`).join("")}
<h2 style="font-size:18px;margin-top:24px">الحوادث (آخر 14 يوماً)</h2>${inc || `<p class="card muted">لا توجد حوادث مسجّلة.</p>`}
<p class="muted" style="margin-top:24px"><a href="/">العودة إلى مجتمع بلس</a> · <a href="/api/status/public">JSON</a></p></main></body></html>`;
  }

  /* ---------------- auth helpers ---------------- */
  function tokenOk(req) {
    const t = metricsToken(); if (!t) return false;
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || "")); if (!m) return false;
    const a = crypto.createHash("sha256").update(m[1]).digest(), b = crypto.createHash("sha256").update(t).digest();
    return crypto.timingSafeEqual(a, b);
  }
  const TEXT = { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" };
  /* admin UI script (server/ui/ops-ui.js): public like any other static asset (it holds no data; every API it calls is admin-only) */
  let ui = null;
  function serveUi(req, res) {
    if (!ui) {
      const zlib = require("node:zlib"), src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "ui", "ops-ui.js"));
      ui = { raw: src, br: zlib.brotliCompressSync(src), gz: zlib.gzipSync(src), etag: '"' + crypto.createHash("sha1").update(src).digest("base64url").slice(0, 16) + '"' };
    }
    const { SEC_HEADERS } = require("../lib/http"), ae = String(req.headers["accept-encoding"] || "");
    const base = { ...SEC_HEADERS, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", ETag: ui.etag, Vary: "Accept-Encoding" };
    if (req.headers["if-none-match"] === ui.etag) { res.writeHead(304, base); res.end(); return true; }
    const [body, encName] = /\bbr\b/.test(ae) ? [ui.br, "br"] : /gzip/.test(ae) ? [ui.gz, "gzip"] : [ui.raw, null];
    res.writeHead(200, { ...base, ...(encName ? { "Content-Encoding": encName } : {}), "Content-Length": body.length }); res.end(body); return true;
  }
  async function ssr(req, res, url) {
    if (url.pathname === "/metrics") {
      if (!metricsToken()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found\n"); return true; }
      if (!tokenOk(req)) { res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "WWW-Authenticate": "Bearer" }); res.end("unauthorized\n"); return true; }
      res.writeHead(200, TEXT); res.end(await reg.render()); return true;
    }
    if (url.pathname === "/ops-ui.js") return serveUi(req, res);
    if (url.pathname === "/status" || url.pathname === "/status/") {
      const { SEC_HEADERS } = require("../lib/http");
      res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=30" });
      res.end(statusHtml(await publicStatus())); return true;
    }
    return false;
  }

  /* ---------------- routes ---------------- */
  R.get("/api/metrics", admin(async (req, res) => { res.writeHead(200, TEXT); res.end(await reg.render()); return ctx.STREAM; }));
  R.get("/api/status/public", async () => publicStatus());

  async function overview(hours) {
    hours = Math.max(1, Math.min(168, Math.round(+hours || 24)));
    const rows = await db.all("SELECT bucket, SUM(requests) req, SUM(errors) err, SUM(slow) slow, SUM(dur_ms_sum) dur, MAX(p95_ms) p95, MAX(queue_backlog) backlog FROM ops_rollups WHERE bucket >= $1 GROUP BY bucket ORDER BY bucket", [minuteKey(Date.now() - hours * 3600e3)]);
    const step = Math.max(1, Math.ceil((hours * 60) / 96)), byStep = new Map();
    for (const r of rows) {
      const t = Date.parse(r.bucket + ":00Z"), k = minuteKey(Math.floor(t / (step * 60e3)) * step * 60e3);
      const s = byStep.get(k) || { t: k, requests: 0, errors: 0, slow: 0, dur: 0, p95: 0, backlog: 0 };
      s.requests += Number(r.req); s.errors += Number(r.err); s.slow += Number(r.slow); s.dur += Number(r.dur); s.p95 = Math.max(s.p95, Number(r.p95)); s.backlog = Math.max(s.backlog, Number(r.backlog));
      byStep.set(k, s);
    }
    const series = [...byStep.values()].map(s => ({ t: s.t, requests: s.requests, errorRate: s.requests ? Math.round((s.errors / s.requests) * 10000) / 100 : 0, avgMs: s.requests ? Math.round(s.dur / s.requests) : 0, p95: Math.round(s.p95), backlog: s.backlog }));
    const mem = process.memoryUsage();
    return {
      hours, stepMin: step, series, instance,
      now: { inFlight: Math.max(0, live), lastMinute: { ...lastMinute }, memoryMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), uptimeSec: Math.round(process.uptime()), queue: await ctx.queue.stats(), components: { ...lastCheck } },
      slos: await sloReport(),
      alerts: { firing: await db.all("SELECT a.*, r.name FROM ops_alerts a LEFT JOIN ops_alert_rules r ON r.id=a.rule_id WHERE a.state='firing' ORDER BY a.id DESC"), recent: await db.all("SELECT a.*, r.name FROM ops_alerts a LEFT JOIN ops_alert_rules r ON r.id=a.rule_id ORDER BY a.id DESC LIMIT 20") },
      rules: await db.all("SELECT * FROM ops_alert_rules ORDER BY id"), metrics: METRICS,
      channels: { inapp: !!ctx.services.notify, webhook: !!(env.OPS_ALERT_WEBHOOK_URL || env.ERROR_WEBHOOK_URL), email: !!(ctx.mailer?.enabled && env.OPS_ALERT_EMAIL) },
      drills: await db.all("SELECT * FROM ops_dr_drills ORDER BY id DESC LIMIT 5"),
      tracing: tracer.stats(), prometheus: { endpoint: "/metrics", tokenSet: !!metricsToken() }
    };
  }
  /* ---------------- v2.70 video quality of experience (migration 071 video_qoe) ----------------
   * POST /api/video/qoe: a signed-in member's client helper (qoe.js, window.MPQoE) reports ≤ BATCH_MAX playbacks at once
   * (sendBeacon, so the route is beacon-exempt from the CSRF header like other append-only telemetry). Stored: user id +
   * post id + numbers only — no IP, no user agent. Skipped silently when the member withdrew the "analytics" consent.
   * GET /api/admin/video/qoe?days=7 (staff): p50/p90 startup, stall rate, average watched time, per-day counts. */
  const Q = require("../migrations/071_video_qoe");
  const staff = fn => ctx.requireUser(async (req, res) => { if (req.user.role !== "admin" && req.user.role !== "moderator") throw E.forbid(); return fn(req, res); });
  const qInt = (v, max) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) return null; return Math.min(max, Math.round(n)); };
  function qoeRow(e) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    const postId = typeof e.postId === "string" ? e.postId.trim() : "";
    if (!postId || postId.length > 64 || !/^[\w.:-]+$/.test(postId)) return null;
    if (!Q.SOURCES.includes(e.source)) return null;
    const startup = qInt(e.startupMs, Q.STARTUP_MAX); if (startup === null) return null;
    const stalls = qInt(e.stalls ?? 0, Q.STALLS_MAX), stallMs = qInt(e.stallMs ?? 0, Q.MS_MAX), watched = qInt(e.watchedMs ?? 0, Q.MS_MAX);
    if (stalls === null || stallMs === null || watched === null) return null;
    const rung = e.rung === null || e.rung === undefined || e.rung === -1 ? null : qInt(e.rung, Q.RUNG_MAX);
    if (rung === null && !(e.rung === null || e.rung === undefined || e.rung === -1)) return null;
    return [postId, e.source, startup, stalls, stallMs, watched, rung];
  }
  let qoeSincePrune = 0;
  async function pruneQoe() { await db.run("DELETE FROM video_qoe WHERE created_at < $1", [new Date(Date.now() - Q.RETENTION_DAYS * 864e5).toISOString()]); }
  async function ingestQoe(user, body) {
    const events = body && body.events;
    if (!Array.isArray(events) || !events.length) throw Object.assign(E.bad("لا توجد قياسات"), { code: "qoe_empty" });
    if (events.length > Q.BATCH_MAX) throw Object.assign(E.bad(`حتى ${Q.BATCH_MAX} قياساً في الدفعة`), { code: "qoe_batch_too_large" });
    if (!ctx.rl.hit("qoe", user.id)) throw E.rate();
    const rows = events.map(qoeRow).filter(Boolean);
    const consent = ctx.services.compliance?.hasConsent ? await ctx.services.compliance.hasConsent(user.id, "analytics") : true;
    if (!consent) return { ok: true, stored: 0, rejected: events.length - rows.length, consent: false };
    const at = now();
    for (const r of rows) await db.run("INSERT INTO video_qoe (user_id, post_id, source, startup_ms, stalls, stall_ms, watched_ms, rung, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [user.id, ...r, at]);
    qoeSincePrune += rows.length;
    if (opts.noTimers && qoeSincePrune >= 500) { qoeSincePrune = 0; pruneQoe().catch(() => { }); } // no scheduler (tests/workers): prune occasionally on insert
    return { ok: true, stored: rows.length, rejected: events.length - rows.length };
  }
  const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : null);
  function qoeStats(rows) {
    const st = rows.map(r => Number(r.startup_ms)).sort((a, b) => a - b);
    const n = rows.length, withStall = rows.filter(r => Number(r.stalls) > 0).length;
    const watched = rows.reduce((a, r) => a + Number(r.watched_ms), 0), stallMs = rows.reduce((a, r) => a + Number(r.stall_ms), 0);
    return {
      plays: n, p50StartupMs: pct(st, 50), p90StartupMs: pct(st, 90),
      stallRate: n ? Math.round((withStall / n) * 1000) / 10 : null, // % of playbacks that stalled at least once
      stallRatio: watched + stallMs ? Math.round((stallMs / (watched + stallMs)) * 1000) / 10 : null, // % of time spent stalled
      avgWatchedMs: n ? Math.round(watched / n) : null
    };
  }
  async function qoeReport(daysQ) {
    const days = Math.max(1, Math.min(Q.RETENTION_DAYS, Math.round(Number(daysQ) || 7)));
    const since = new Date(Date.now() - (days - 1) * 864e5); since.setUTCHours(0, 0, 0, 0);
    const rows = await db.all(`SELECT ${dayOf("created_at")} AS day, source, startup_ms, stalls, stall_ms, watched_ms FROM video_qoe WHERE created_at >= $1`, [since.toISOString()]);
    const byDay = new Map();
    for (let i = 0; i < days; i++) byDay.set(new Date(since.getTime() + i * 864e5).toISOString().slice(0, 10), []);
    for (const r of rows) { const d = String(r.day); if (byDay.has(d)) byDay.get(d).push(r); }
    return {
      days, ...qoeStats(rows),
      bySource: Object.fromEntries(Q.SOURCES.map(s => [s, qoeStats(rows.filter(r => r.source === s))])),
      perDay: [...byDay].map(([day, rs]) => ({ day, ...qoeStats(rs) }))
    };
  }
  R.post("/api/video/qoe", ctx.requireUser(async req => ingestQoe(req.user, req.body)), { beacon: true });
  R.get("/api/admin/video/qoe", staff(async req => qoeReport(req.query.days)));
  R.get("/api/admin/ops/overview", admin(async req => { await ready; return overview(req.query.hours); }));
  R.get("/api/admin/ops/product", admin(async req => product(req.query.days)));
  R.get("/api/admin/ops/incidents", admin(async () => ({ incidents: (await publicStatus()).incidents })));

  const RULE_ID = /^[a-z0-9_]{2,40}$/;
  R.put("/api/admin/ops/rules/:id", admin(async req => {
    await ready;
    const rid = req.params.id; if (!RULE_ID.test(rid)) throw E.bad("معرّف غير صالح");
    const b = req.body, ex = await db.get("SELECT * FROM ops_alert_rules WHERE id=$1", [rid]);
    const metric = b.metric ?? ex?.metric, op = b.op ?? ex?.op ?? ">", threshold = +(b.threshold ?? ex?.threshold);
    if (!METRICS[metric]) throw E.bad("مقياس غير معروف"); if (![">", "<", ">=", "<="].includes(op)) throw E.bad("عامل مقارنة غير صالح"); if (!Number.isFinite(threshold)) throw E.bad("حد غير صالح");
    const windowMin = Math.max(1, Math.min(1440, Math.round(+(b.windowMin ?? ex?.window_min ?? 5)))), severity = ["warning", "critical", "info"].includes(b.severity) ? b.severity : ex?.severity || "warning";
    const channels = (Array.isArray(b.channels) ? b.channels : String(b.channels ?? ex?.channels ?? "inapp").split(",")).map(s => String(s).trim()).filter(c => ["inapp", "webhook", "email"].includes(c)).join(",");
    const name = str(b.name, 80) || ex?.name || metric, enabled = b.enabled === undefined ? (ex ? ex.enabled : 1) : b.enabled ? 1 : 0;
    await db.run(`INSERT INTO ops_alert_rules(id,name,metric,op,threshold,window_min,severity,channels,enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
      ON CONFLICT (id) DO UPDATE SET name=$2, metric=$3, op=$4, threshold=$5, window_min=$6, severity=$7, channels=$8, enabled=$9, updated_at=$10`, [rid, name, metric, op, threshold, windowMin, severity, channels, enabled, now()]);
    ctx.audit("ops_rule_saved", rid, `${metric}${op}${threshold}/${windowMin}m`, req.user.id);
    return { rule: await db.get("SELECT * FROM ops_alert_rules WHERE id=$1", [rid]) };
  }));
  R.del("/api/admin/ops/rules/:id", admin(async req => { await db.run("DELETE FROM ops_alert_rules WHERE id=$1", [req.params.id]); ctx.audit("ops_rule_deleted", req.params.id, null, req.user.id); return { ok: true }; }));
  R.post("/api/admin/ops/alerts/evaluate", admin(async () => ({ results: await evaluateAlerts() })));
  R.post("/api/admin/ops/alerts/test", admin(async req => {
    const sent = await deliver({ id: "test", name: "تنبيه تجريبي", metric: "error_rate", op: ">", threshold: 0, window_min: 1, severity: "info", channels: "inapp,webhook,email" }, "firing", 0);
    ctx.audit("ops_alert_test", null, sent.join(","), req.user.id); return { sent };
  }));
  R.put("/api/admin/ops/slos/:id", admin(async req => {
    await ready;
    const s = await db.get("SELECT * FROM ops_slos WHERE id=$1", [req.params.id]); if (!s) throw E.nf();
    const target = req.body.target === undefined ? s.target : +req.body.target, days = req.body.windowDays === undefined ? s.window_days : Math.round(+req.body.windowDays);
    if (!(target > 50 && target < 100)) throw E.bad("الهدف بين 50 و100"); if (!(days >= 1 && days <= 90)) throw E.bad("النافذة بين 1 و90 يوماً");
    await db.run("UPDATE ops_slos SET target=$1, window_days=$2, enabled=$3, updated_at=$4 WHERE id=$5", [target, days, req.body.enabled === undefined ? s.enabled : req.body.enabled ? 1 : 0, now(), s.id]);
    ctx.cache.del("ops:slos"); ctx.audit("ops_slo_saved", s.id, `${target}/${days}d`, req.user.id);
    return { slos: await sloReport() };
  }));

  const incStatus = v => (INCIDENT_STATUS[v] ? v : null);
  R.post("/api/admin/ops/incidents", admin(async req => {
    const b = req.body, title = str(b.title, 140), body = str(b.body, 2000), status = incStatus(b.status) || "investigating", impact = IMPACT[b.impact] ? b.impact : "minor";
    if (!title || !body) throw E.bad("العنوان والوصف مطلوبان");
    const comps = (Array.isArray(b.components) ? b.components : []).filter(c => COMPONENT_IDS.has(c)).join(","), iid = id("inc"), t = now();
    await db.run("INSERT INTO ops_incidents(id,title,status,impact,components,created_by,created_at,updated_at,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8)", [iid, title, status, impact, comps, req.user.id, t, status === "resolved" ? t : null]);
    await db.run("INSERT INTO ops_incident_updates(incident_id,status,body,by_user,at) VALUES($1,$2,$3,$4,$5)", [iid, status, body, req.user.id, t]);
    ctx.cache.del("ops:public"); ctx.audit("ops_incident_created", iid, `${impact}:${status}`, req.user.id);
    return { incident: (await publicStatus()).incidents.find(i => i.id === iid) };
  }));
  R.post("/api/admin/ops/incidents/:id/updates", admin(async req => {
    const inc = await db.get("SELECT * FROM ops_incidents WHERE id=$1", [req.params.id]); if (!inc) throw E.nf();
    const status = incStatus(req.body.status) || inc.status, body = str(req.body.body, 2000); if (!body) throw E.bad("نص التحديث مطلوب");
    const t = now();
    await db.run("INSERT INTO ops_incident_updates(incident_id,status,body,by_user,at) VALUES($1,$2,$3,$4,$5)", [inc.id, status, body, req.user.id, t]);
    await db.run("UPDATE ops_incidents SET status=$1, updated_at=$2, resolved_at=$3 WHERE id=$4", [status, t, status === "resolved" ? t : null, inc.id]);
    ctx.cache.del("ops:public"); ctx.audit("ops_incident_updated", inc.id, status, req.user.id);
    return { incident: (await publicStatus()).incidents.find(i => i.id === inc.id) };
  }));

  /* DR drill results (no data — counts only). Token or admin. Beacon-style CSRF exemption is NOT used: token callers send
   * no cookies, admins use the normal header. */
  R.post("/api/ops/dr-drills", async req => {
    if (!tokenOk(req) && req.user?.role !== "admin") throw E.forbid();
    const b = req.body || {};
    await db.run("INSERT INTO ops_dr_drills(at,ok,backup,dialect,tables_n,rows_n,ms,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [now(), b.ok ? 1 : 0, str(b.backup, 200), str(b.dialect, 20), Math.round(+b.tables || 0), Math.round(+b.rows || 0), Math.round(+b.ms || 0), str(typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail || {}), 4000)]);
    return { ok: true };
  });

  return { attach, ssr, registry: reg, tracer, flushRollup, checkComponents, evaluateAlerts, sloReport, product, publicStatus, overview, record, routeLabel, instance, ingestQoe, qoeReport, pruneQoe };
};
