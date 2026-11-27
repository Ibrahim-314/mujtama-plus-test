/* v2.167 test fixtures — the admin HTTP API for MJT / AI / membership was removed (the app runs on fixed values and automatic
 * rules, server/config/app-defaults.js + services/auto-rules.js). Older tests still need the same FIXTURES (fund a wallet, give a
 * test member Plus, freeze a wallet, run a conversion…). This shim calls the service functions those routes used to call,
 * in-process, and answers in the HTTP client's shape ({ status, ...body }). It is NOT an HTTP surface: the routes themselves
 * answer 404 (asserted in the tests). A non-admin actor gets 404 like the real server; an unknown path gets 404 too. */
"use strict";

/** @param {any} H the harness from boot() */
function shim(H) {
  const S = () => H.app.ctx.services, db = () => H.app.ctx.db;
  const ok = async (fn) => { try { const r = await fn(); return { status: 200, ...(r && typeof r === "object" && !Array.isArray(r) ? r : { result: r }) }; } catch (e) { return { status: e.status || 500, error: e.message, code: e.code }; } };
  const routes = [
    ["POST", /^\/api\/admin\/mjt\/adjust$/, (a, m, b) => S().mjt.adjust(a, b)],
    ["POST", /^\/api\/admin\/mjt\/accounts\/([^/]+)\/freeze$/, (a, m, b) => S().mjt.freeze(a, decodeURIComponent(m[1]), b)],
    ["GET", /^\/api\/admin\/mjt\/conversion\/dry-run$/, () => S().mjt.dryRun()],
    ["POST", /^\/api\/admin\/mjt\/conversion$/, (a) => S().mjt.convert(a.id)],
    ["POST", /^\/api\/admin\/mjt\/conversion\/([^/]+)\/rollback$/, (a, m, b) => S().mjt.rollback(decodeURIComponent(m[1]), a.id, { dryRun: !!b?.dryRun })],
    ["GET", /^\/api\/admin\/mjt\/verify$/, () => S().mjt.verify()],
    ["GET", /^\/api\/admin\/mjt$/, () => S().mjt.adminOverview()],
    ["POST", /^\/api\/admin\/ai\/grants$/, (a, m, b) => S().ai.grant(a, b)],
    ["POST", /^\/api\/admin\/ai\/grants\/revoke$/, (a, m, b) => S().ai.revoke(a, b)],
    ["GET", /^\/api\/admin\/ai\/plans$/, async () => { await S().ai.ensurePlans(); return { plans: (await db().all("SELECT * FROM ai_plans ORDER BY created_at")).map((p) => ({ ...S().ai.planClient(p), priceSetBy: p.price_set_by || null })) }; }],
    ["PUT", /^\/api\/admin\/ai\/plans\/([^/]+)$/, (a, m, b) => S().ai.updatePlan(a, decodeURIComponent(m[1]), b)],
    ["GET", /^\/api\/admin\/ai\/subscribers$/, (a, m, b, q) => S().ai.subscribers(q)],
    ["GET", /^\/api\/admin\/ai\/finance$/, (a, m, b, q) => S().ai.finance(q)],
    ["POST", /^\/api\/admin\/mjt\/rewards\/entries\/([^/]+)\/approve$/, (a, m, b) => S().mjtRewards.decide(a, decodeURIComponent(m[1]), b || {}, true)],
    ["POST", /^\/api\/admin\/mjt\/rewards\/entries\/([^/]+)\/reject$/, (a, m, b) => S().mjtRewards.decide(a, decodeURIComponent(m[1]), b || {}, false)],
    ["POST", /^\/api\/admin\/mjt\/review\/earn\/([^/]+)\/approve$/, (a, m, b) => S().mjtRewards.decide(a, decodeURIComponent(m[1]), b || {}, true)],
    ["POST", /^\/api\/admin\/mjt\/review\/earn\/([^/]+)\/reject$/, (a, m, b) => S().mjtRewards.decide(a, decodeURIComponent(m[1]), b || {}, false)],
    ["POST", /^\/api\/admin\/mjt\/review\/transfer\/([^/]+)\/approve$/, (a, m, b) => S().mjtSafety.decideHold(a, decodeURIComponent(m[1]), b || {}, true)],
    ["POST", /^\/api\/admin\/mjt\/review\/transfer\/([^/]+)\/reject$/, (a, m, b) => S().mjtSafety.decideHold(a, decodeURIComponent(m[1]), b || {}, false)],
    ["POST", /^\/api\/admin\/mjt\/services\/purchases\/([^/]+)\/refund$/, (a, m, b) => S().mjtServices.refund(a, decodeURIComponent(m[1]), b || {})],
    ["POST", /^\/api\/admin\/reputation\/penalties$/, (a, m, b) => S().repLevels.applyPenalty(a, b || {})],
    ["POST", /^\/api\/admin\/reputation\/penalties\/([^/]+)\/revoke$/, (a, m, b) => S().repLevels.revokePenalty(a, decodeURIComponent(m[1]), b || {})]
  ];
  /** call a removed admin route as `client` (must be an admin, like the old route) */
  return async function adminCall(client, method, path, body) {
    const [p, qs] = String(path).split("?"), q = Object.fromEntries(new URLSearchParams(qs || ""));
    const u = client?.id ? await db().get("SELECT id, handle, name, role FROM users WHERE id=$1", [client.id]) : null;
    if (!u) return { status: 401, error: "سجّل الدخول" };
    if (u.role !== "admin") return { status: 404, error: "المسار غير موجود" };
    for (const [m, re, fn] of routes) { const x = m === method && p.match(re); if (x) return ok(() => fn(u, x, body || {}, q)); }
    return { status: 404, error: "المسار غير موجود", code: "route_removed" };
  };
}
module.exports = { shim };
