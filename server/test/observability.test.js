/* Phase 49 — monitoring & operations: /metrics (token-gated, 404 when unset), request rollups, SLO error budgets,
 * on-call alerts (fire → in-app + webhook, resolve), component checks + public /status with incidents, product metrics
 * (growth, DAU, cohorts), OTLP tracing (traceparent propagation + exported spans), DR drill (encrypted backup → scratch restore → counts). */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { boot } = require("./helpers");

const hooks = [], otlp = [];
const fakeFetch = async (url, init) => {
  if (String(url).includes("/v1/traces")) otlp.push(JSON.parse(init.body)); else hooks.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({}) };
};
const env = { ...process.env, METRICS_TOKEN: "m-token-123", OPS_ALERT_WEBHOOK_URL: "http://hook.invalid/x", OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel.invalid:4318", OPS_ALERT_MIN_REQUESTS: "5" };
let H, A, B, O;
test.before(async () => {
  H = await boot({ opsOpts: { env, fetch: fakeFetch, noTimers: true } });
  O = H.app.ctx.services.observability;
  A = new H.Client(); B = new H.Client();
  await A.req("POST", "/api/auth/register", { name: "مدير", handle: "opsadmin", password: "secret123" });
  await B.req("POST", "/api/auth/register", { name: "سلمى", handle: "opsuser", password: "secret123" });
  await H.app.ctx.db.run("UPDATE users SET role='admin' WHERE handle='opsadmin'");
});
test.after(() => H.app.close());

test("/metrics: bearer token required, Prometheus text with route patterns; /api/metrics admin-only", async () => {
  await B.req("GET", "/api/health"); await B.req("GET", "/api/posts/nope123");
  assert.equal((await fetch(H.base + "/metrics")).status, 401);
  assert.equal((await fetch(H.base + "/metrics", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  const r = await fetch(H.base + "/metrics", { headers: { Authorization: "Bearer m-token-123" } });
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /text\/plain; version=0.0.4/);
  const t = await r.text();
  assert.match(t, /# TYPE mujtama_http_requests_total counter/);
  assert.match(t, /mujtama_http_requests_total\{method="GET",route="\/api\/health",status="2xx"\} \d+/);
  assert.match(t, /route="\/api\/posts\/:p"/, "ids are collapsed to route patterns");
  assert.match(t, /mujtama_http_request_duration_seconds_bucket\{method="GET",route="\/api\/health",le="\+Inf"\} \d+/);
  for (const m of ["mujtama_queue_jobs", "mujtama_db_ping_seconds", "mujtama_slo_error_budget_remaining_ratio", "mujtama_app_info", "mujtama_event_loop_lag_p99_seconds"]) assert.ok(t.includes(m), m);
  assert.equal((await B.req("GET", "/api/metrics")).status, 403);
  const a = await fetch(H.base + "/api/metrics", { headers: { Cookie: A.cookie, "X-Requested-With": "mujtama" } });
  assert.equal(a.status, 200); assert.match(await a.text(), /mujtama_users_total/);
});

test("/metrics is not exposed when METRICS_TOKEN is unset", async () => {
  const saved = env.METRICS_TOKEN; delete env.METRICS_TOKEN;
  try { assert.equal((await fetch(H.base + "/metrics", { headers: { Authorization: "Bearer m-token-123" } })).status, 404); }
  finally { env.METRICS_TOKEN = saved; }
});

test("tracing: traceparent continues the caller's trace; OTLP JSON spans include server + db spans", async () => {
  const trace = "4bf92f3577b34da6a3ce929d0e0e4736";
  const r = await fetch(H.base + "/api/posts/nope123", { headers: { traceparent: `00-${trace}-00f067aa0ba902b7-01` } });
  assert.match(r.headers.get("traceparent"), new RegExp(`^00-${trace}-[0-9a-f]{16}-01$`));
  await new Promise(res => setTimeout(res, 20)); await O.tracer.flush();
  const spans = otlp.flatMap(b => b.resourceSpans[0].scopeSpans[0].spans).filter(s => s.traceId === trace);
  const server = spans.find(s => s.kind === 2); assert.ok(server, "server span exported");
  assert.equal(server.name, "GET /api/posts/:p"); assert.equal(server.parentSpanId, "00f067aa0ba902b7");
  assert.ok(spans.some(s => s.kind === 3 && s.name.startsWith("db.") && s.parentSpanId === server.spanId), "db child span");
  assert.equal(otlp[0].resourceSpans[0].resource.attributes.find(a => a.key === "service.name").value.stringValue, "mujtama-plus");
});

test("rollups → overview series + SLOs; alert fires to in-app + webhook, then resolves", async () => {
  const f = await O.flushRollup(); assert.ok(f.requests >= 1);
  let ov = await A.req("GET", "/api/admin/ops/overview?hours=1");
  assert.equal(ov.status, 200); assert.ok(ov.series.length >= 1); assert.equal(ov.slos.length, 2); assert.ok(ov.rules.find(r => r.id === "high_error_rate"));
  assert.equal(ov.slos.find(s => s.id === "availability").state, "ok");
  assert.equal((await B.req("GET", "/api/admin/ops/overview")).status, 403);
  // simulate a bad minute: 40 requests, 20 server errors
  const db = H.app.ctx.db, b = new Date(Date.now() - 60e3).toISOString().slice(0, 16);
  await db.run("INSERT INTO ops_rollups(bucket,instance,requests,errors,slow,dur_ms_sum,p95_ms,queue_backlog) VALUES($1,'sim',40,20,0,400,10,0)", [b]);
  let res = await O.evaluateAlerts();
  const fired = res.find(x => x.rule === "high_error_rate"); assert.ok(fired); assert.equal(fired.state, "firing"); assert.ok(fired.sent.includes("inapp") && fired.sent.includes("webhook"));
  assert.match(hooks.at(-1).body.text, /نسبة أخطاء الخادم مرتفعة/);
  const adminId = (await A.req("GET", "/api/me")).user.id;
  assert.ok(await db.get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='ops_alert'", [adminId]), "in-app notification for admins");
  assert.equal((await O.evaluateAlerts()).length, 0, "no duplicate page while still firing");
  ov = await A.req("GET", "/api/admin/ops/overview?hours=1");
  assert.equal(ov.alerts.firing.length, 1); assert.ok(ov.slos.find(s => s.id === "availability").budgetRemaining < 0);
  await db.run("DELETE FROM ops_rollups WHERE instance='sim'");
  res = await O.evaluateAlerts(); assert.equal(res.find(x => x.rule === "high_error_rate").state, "resolved");
  // rules + SLO edits are validated and audited
  assert.equal((await A.req("PUT", "/api/admin/ops/rules/high_error_rate", { metric: "nope" })).status, 400);
  const r = await A.req("PUT", "/api/admin/ops/rules/high_error_rate", { threshold: 2.5, enabled: true }); assert.equal(r.rule.threshold, 2.5);
  assert.equal((await A.req("PUT", "/api/admin/ops/slos/availability", { target: 120 })).status, 400);
  assert.equal((await A.req("PUT", "/api/admin/ops/slos/availability", { target: 99.9 })).slos.find(s => s.id === "availability").target, 99.9);
  const t = await A.req("POST", "/api/admin/ops/alerts/test"); assert.ok(t.sent.includes("webhook"));
});

test("public /status: components, 90-day uptime, incidents posted by admins", async () => {
  const c = await O.checkComponents(); assert.equal(c.database, true); assert.equal(c.email, null);
  let s = await (await fetch(H.base + "/api/status/public")).json();
  assert.equal(s.overall, "operational"); assert.equal(s.components.find(x => x.id === "database").uptimePct, 100);
  assert.equal(s.components.find(x => x.id === "pi").state, "not_configured");
  assert.equal((await B.req("POST", "/api/admin/ops/incidents", { title: "x", body: "y" })).status, 403);
  assert.equal((await A.req("POST", "/api/admin/ops/incidents", { title: "", body: "y" })).status, 400);
  const inc = (await A.req("POST", "/api/admin/ops/incidents", { title: "بطء في رفع الصور", body: "نحقق في بطء معالجة الوسائط", impact: "major", components: ["media", "bogus"] })).incident;
  assert.deepEqual(inc.components, ["media"]);
  s = await (await fetch(H.base + "/api/status/public")).json();
  assert.equal(s.overall, "degraded"); assert.equal(s.components.find(x => x.id === "media").state, "degraded");
  const html = await (await fetch(H.base + "/status")).text();
  assert.match(html, /حالة خدمات مجتمع بلس/); assert.match(html, /بطء في رفع الصور/); assert.ok(!/<script/i.test(html), "no JS on the status page");
  await A.req("POST", `/api/admin/ops/incidents/${inc.id}/updates`, { status: "resolved", body: "عادت المعالجة إلى طبيعتها" });
  s = await (await fetch(H.base + "/api/status/public")).json();
  assert.equal(s.overall, "operational"); assert.equal(s.incidents[0].status, "resolved"); assert.equal(s.incidents[0].updates.length, 2);
});

test("product metrics: growth, active users, engagement, cohorts", async () => {
  await B.req("POST", "/api/posts", { text: "منشور لقياس التفاعل" });
  H.app.ctx.cache.del("ops:product:30");
  const p = await A.req("GET", "/api/admin/ops/product?days=30");
  assert.equal(p.status, 200); assert.equal(p.totals.users, 2); assert.ok(p.totals.dau >= 1); assert.ok(p.totals.posts >= 1);
  assert.equal(p.growth.length, 30); assert.equal(p.growth.at(-1).users, 2);
  assert.equal(p.cohorts.length, 8); assert.equal(p.cohorts[0].retention.length, 8); assert.equal(p.cohorts.at(-1).retention.length, 1); assert.equal(p.cohorts.at(-1).size, 2); assert.ok(p.cohorts.at(-1).retention[0] >= 50);
  assert.equal((await B.req("GET", "/api/admin/ops/product")).status, 403);
});

test("DR drill: encrypted backup → scratch restore → counts match; tamper detected; prod-like scratch refused", async () => {
  const D = require("../scripts/dr-drill");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-dr-")), quiet = () => { };
  let src = "sqlite:" + path.join(dir, "src.sqlite"), scratch;
  if (process.env.TEST_DATABASE_URL) { src = process.env.TEST_DATABASE_URL; scratch = process.env.TEST_DRILL_URL; if (!scratch) return; }
  else { // a small source database on disk
    const { connect } = require("../lib/db"), M = require("../lib/migrations"), sdb = await connect(src); await M.up(sdb);
    await sdb.run("INSERT INTO users(id,handle,name,role,prefs,created_at) VALUES('u1','dr1','مستخدم','user',$1,$2)", [{ a: 1 }, new Date().toISOString()]);
    await sdb.run("INSERT INTO posts(id,author,text,created_at) VALUES('p1','u1','نص',$1)", [new Date().toISOString()]).catch(async () => { await sdb.run("INSERT INTO posts(id,author,created_at) VALUES('p1','u1',$1)", [new Date().toISOString()]); });
    await sdb.close();
  }
  const b = await D.backup({ databaseUrl: src, out: dir, passphrase: "pp", log: quiet });
  assert.ok(b.rows >= 2 && fs.existsSync(b.file + ".sha256"));
  assert.ok(!fs.readFileSync(b.file).includes(Buffer.from("dr1")), "backup is encrypted");
  const reported = [];
  const r = await D.drill({ dir, scratch, passphrase: "pp", log: quiet, reportUrl: "http://x.invalid/api/ops/dr-drills", fetchImpl: async (u, i) => { reported.push(JSON.parse(i.body)); return { ok: true }; } });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.rows, b.rows - (await countMig(src))); assert.ok(r.users >= 1);
  assert.equal(reported[0].ok, true); assert.equal(reported[0].detail.mismatches.length, 0);
  assert.equal((await D.drill({ dir, scratch, passphrase: "wrong", log: quiet })).ok, false, "wrong passphrase fails");
  const raw = fs.readFileSync(b.file); raw[raw.length - 1] ^= 1; fs.writeFileSync(b.file, raw);
  assert.match((await D.drill({ dir, scratch, passphrase: "pp", log: quiet })).error, /sha256 mismatch/);
  assert.throws(() => D.assertSafeScratch("postgres://u@h:5432/mujtama", null), /must contain/);
  assert.throws(() => D.assertSafeScratch(src, src), /source/);
  // drill result recorded through the API (admin)
  assert.equal((await B.req("POST", "/api/ops/dr-drills", { ok: true })).status, 403);
  await fetch(H.base + "/api/ops/dr-drills", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Authorization: "Bearer m-token-123" }, body: JSON.stringify(reported[0]) });
  const ov = await A.req("GET", "/api/admin/ops/overview?hours=1"); assert.equal(ov.drills[0].ok, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
async function countMig(url) { const { connect } = require("../lib/db"), d = await connect(url); try { return Number((await d.get("SELECT COUNT(*) n FROM schema_migrations")).n); } finally { await d.close(); } }
