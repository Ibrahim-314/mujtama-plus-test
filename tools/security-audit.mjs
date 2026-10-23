/* Internal automated security audit (phase 50). LOCAL ONLY — boots an in-memory server (SQLite) on 127.0.0.1 and never
 * contacts production. It is not a substitute for the external penetration test (still pending, see docs/security/AUDIT.md).
 *   node tools/security-audit.mjs [--json out.json] [--skip-npm]
 * 1. npm audit (root + server) — counts by severity (needs registry access; reported as "unavailable" offline).
 * 2. Headers: CSP (no unsafe-eval, object-src none, frame-ancestors, base-uri), nosniff, Referrer-Policy, Permissions-Policy,
 *    cookie flags (HttpOnly, SameSite), HSTS (expected at the edge / when SECURE_COOKIES=1).
 * 3. Authz probe: every registered API route is called as anonymous, as an ordinary user ("bob") against another user's
 *    ("alice") resources, and without the CSRF header. Findings:
 *      HIGH   500 (unhandled error) on any probe (501/503 = documented not_configured) · 2xx for anonymous on a state-changing route (beyond the documented public allow-list) ·
 *             2xx for an ordinary user on /api/admin/* or /api/staff/* · state change accepted without X-Requested-With
 *      MEDIUM 2xx for bob reading alice's ticket / private resource ids (owner-scoped routes that leak)
 *    Exit code 1 when any HIGH finding exists. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2), jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
process.env.LOG_SILENT = "1";
const report = { at: new Date().toISOString(), target: "local in-memory server (127.0.0.1)", npm: {}, headers: [], probe: { routes: 0, requests: 0 }, findings: [] };
const find = (severity, area, detail) => report.findings.push({ severity, area, detail });

/* ---------- 1. npm audit ---------- */
if (!args.includes("--skip-npm")) for (const dir of [ROOT, path.join(ROOT, "server")]) {
  const key = path.relative(ROOT, dir) || ".";
  try {
    let out;
    try { out = execFileSync("npm", ["audit", "--json", "--omit=dev"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60e3 }); }
    catch (e) { out = e.stdout || ""; if (!out) throw e; } // npm audit exits 1 when it finds anything
    const j = JSON.parse(out); if (j.error) throw new Error(j.error.code + ": " + j.error.summary); const v = j.metadata?.vulnerabilities || {};
    report.npm[key] = v;
    if ((v.high || 0) + (v.critical || 0) > 0) find("HIGH", "npm", `${key}: ${v.high || 0} high, ${v.critical || 0} critical (npm audit --omit=dev)`);
  } catch (e) { report.npm[key] = { unavailable: String(e.message || e).split("\n")[0].slice(0, 160) }; }
}

/* ---------- boot ---------- */
const { createApp } = require(path.join(ROOT, "server/server.js"));
const app = await createApp({ databaseUrl: "sqlite::memory:", storageDir: fs.mkdtempSync("/tmp/mp-audit-"), seedDemo: false, fakeVideoMs: 50 });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + app.server.address().port;
const rl = () => app.ctx.rl.w.clear();
const call = async (method, p, { cookie = "", body, csrf = true } = {}) => {
  report.probe.requests++;
  let r;
  try { r = await fetch(BASE + p, { method, redirect: "manual", signal: AbortSignal.timeout(4000), headers: { ...(csrf ? { "X-Requested-With": "mujtama" } : {}), "Content-Type": "application/json", Cookie: cookie }, body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body || {}) }); }
  catch { (report.probe.streams ||= []).push(`${method} ${p}`); return { status: 0, headers: new Headers(), j: {} }; } // long-lived stream (SSE/WS) — not a finding
  if (/text\/event-stream/.test(r.headers.get("content-type") || "")) { r.body?.cancel().catch(() => { }); (report.probe.streams ||= []).push(`${method} ${p}`); return { status: r.status, headers: r.headers, j: {} }; }
  (report.probe.statuses ||= {})[r.status] = (report.probe.statuses[r.status] || 0) + 1;
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch { /* html */ }
  return { status: r.status, headers: r.headers, j };
};
const signup = async (handle) => {
  rl();
  const r = await fetch(BASE + "/api/auth/register", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ name: "Audit " + handle, handle, password: "audit-pass-123" }) });
  const j = await r.json(); return { id: j.user.id, cookie: r.headers.get("set-cookie").split(";")[0], setCookie: r.headers.get("set-cookie") };
};
const admin = await signup("audit_admin"); // first account = admin
const alice = await signup("audit_alice"), bob = await signup("audit_bob");

/* ---------- 2. headers ---------- */
const html = await call("GET", "/"), apiH = await call("GET", "/api/health");
for (const [name, res] of [["/ (html)", html], ["/api/health", apiH]]) {
  const csp = res.headers.get("content-security-policy") || "";
  const row = { path: name, csp: !!csp, nosniff: res.headers.get("x-content-type-options") === "nosniff", referrer: res.headers.get("referrer-policy"), permissions: !!res.headers.get("permissions-policy"), hsts: res.headers.get("strict-transport-security") };
  report.headers.push(row);
  if (!csp) find("HIGH", "headers", `${name}: no Content-Security-Policy`);
  if (/unsafe-eval/.test(csp)) find("HIGH", "headers", `${name}: CSP allows unsafe-eval`);
  if (/script-src[^;]*'unsafe-inline'/.test(csp)) find("HIGH", "headers", `${name}: CSP allows inline scripts`);
  for (const d of ["object-src 'none'", "frame-ancestors", "base-uri"]) if (!csp.includes(d)) find("MEDIUM", "headers", `${name}: CSP lacks ${d}`);
  if (!row.nosniff) find("MEDIUM", "headers", `${name}: missing X-Content-Type-Options: nosniff`);
  if (!row.hsts) find("LOW", "headers", `${name}: no Strict-Transport-Security from the app (must be set by the TLS edge; Railway terminates TLS)`);
}
if (/style-src[^;]*'unsafe-inline'/.test(html.headers.get("content-security-policy") || "")) find("LOW", "headers", "CSP style-src allows 'unsafe-inline' (needed by injected chunk styles; scripts stay hash/self-only)");
if (!/HttpOnly/i.test(alice.setCookie) || !/SameSite/i.test(alice.setCookie)) find("HIGH", "cookies", "session cookie lacks HttpOnly or SameSite");

/* ---------- 3. authz probe ---------- */
rl();
const post = (await call("POST", "/api/posts", { cookie: alice.cookie, body: { text: "منشور تدقيق خاص", visibility: "followers" } })).j.post?.id || "p_none";
const ticket = (await call("POST", "/api/tickets", { cookie: alice.cookie, body: { subject: "تذكرة تدقيق", body: "سرّية" } })).j.ticket?.id || "tk_none";
const SAMPLE = { id: post, pid: post, post: post, uid: alice.id, user: alice.id, userId: alice.id, handle: "audit_alice", slug: "getting-started", code: "AAAA-BBBB" };
const OWNER_SCOPED = [[/^\/api\/tickets\/[^/]+$/, `/api/tickets/${ticket}`]]; // bob must not read alice's ticket
const PUBLIC_WRITE = [/^\/api\/auth\//, /^\/api\/launch\/waitlist$/, /^\/api\/(telemetry|errors|client-errors|rum|vitals|analytics|beacon)/, /\/events$/, /^\/api\/mail\/(unsubscribe|bounce)/, /^\/api\/pi\/webhook/, /^\/api\/ads\/events$/, /^\/api\/security\/csp-report/, /^\/api\/password\//, /^\/api\/i18n\/miss/];
const SKIP_AS_BOB = /\/(logout|sign-out|account|me\/delete|me\/privacy\/erase|sessions|password)/; // keep bob's session alive
const routes = app.ctx.router.routes.filter((r) => r.re.source.startsWith("^\\/api\\/"));
report.probe.routes = routes.length;
const toPath = (r) => r.re.source.replace(/^\^/, "").replace(/\\\/\?\$$/, "").replace(/\/\?\$$/, "").replace(/\$$/, "").replace(/\\\//g, "/").replace(/\(\[\^\/\]\+\)/g, (_, i) => "\u0000").split("\u0000").map((s, i, arr) => (i < arr.length - 1 ? s + (SAMPLE[r.keys[i]] ?? "x_" + (r.keys[i] || "p")) : s)).join("");
const crashes = new Set();
for (const r of routes) {
  const p = toPath(r), m = r.method, mutating = !["GET", "HEAD", "OPTIONS"].includes(m); // OPTIONS = CORS preflight (phase 47 /api/v1, /api/oauth): headers only, no state change
  rl();
  const anon = await call(m, p);
  if (anon.status === 500) crashes.add(`${m} ${p} (anon) → ${anon.status}`);
  if (mutating && anon.status < 300 && !r.opts.beacon && !PUBLIC_WRITE.some((x) => x.test(p))) find("HIGH", "authz", `anonymous ${m} ${p} → ${anon.status}`);
  if (SKIP_AS_BOB.test(p) && mutating) continue;
  rl();
  let asBob = await call(m, p, { cookie: bob.cookie });
  if (asBob.status === 401 && (await call("GET", "/api/me", { cookie: bob.cookie })).status === 401) { // something ended bob's session: re-login and retry once
    rl(); const lr = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ handle: "audit_bob", password: "audit-pass-123" }) });
    bob.cookie = (lr.headers.get("set-cookie") || "").split(";")[0]; (report.probe.relogins ||= []).push(`${m} ${p}`); rl(); asBob = await call(m, p, { cookie: bob.cookie });
  }
  if (asBob.status === 500) crashes.add(`${m} ${p} (user) → ${asBob.status}`);
  if (/^\/api\/(admin|staff)\//.test(p) && asBob.status < 300) find("HIGH", "authz", `ordinary user ${m} ${p} → ${asBob.status}`);
  if (mutating && !r.opts.beacon && !r.opts.piLogin) { rl(); const nc = await call(m, p, { cookie: bob.cookie, csrf: false }); if (nc.status < 300) find("HIGH", "csrf", `${m} ${p} accepted without X-Requested-With → ${nc.status}`); }
}
for (const [, p] of OWNER_SCOPED) { rl(); const r = await call("GET", p, { cookie: bob.cookie }); if (r.status < 300) find("MEDIUM", "authz", `bob can read alice's resource ${p}`); }
rl(); const pv = await call("GET", "/api/posts/" + post, { cookie: bob.cookie }); if (pv.status < 300 && JSON.stringify(pv.j).includes("منشور تدقيق خاص")) find("MEDIUM", "authz", "followers-only post readable by a non-follower");
for (const c of crashes) find("HIGH", "robustness", c + " (unhandled error on a probe with empty/invalid input)");
// is the admin's power confined to admins? (sanity: the probe user must not have been promoted)
if ((await app.ctx.db.get("SELECT role FROM users WHERE id=$1", [bob.id])).role !== "user") find("HIGH", "authz", "ordinary user was promoted during the probe");
void admin;

await app.close();
const sev = (s) => report.findings.filter((f) => f.severity === s).length;
report.summary = { high: sev("HIGH"), medium: sev("MEDIUM"), low: sev("LOW") };
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
console.log(`routes probed: ${report.probe.routes} · requests: ${report.probe.requests} · statuses ${JSON.stringify(report.probe.statuses)}`);
console.log("npm audit:", JSON.stringify(report.npm));
for (const f of report.findings) console.log(`${f.severity.padEnd(6)} ${f.area.padEnd(10)} ${f.detail}`);
console.log(`summary: ${report.summary.high} high · ${report.summary.medium} medium · ${report.summary.low} low`);
process.exit(report.summary.high ? 1 : 0);
