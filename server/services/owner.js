/* v2.167 «لوحة المالك» — the ONE owner page left after the app became automatic. Read-only status + emergency ban / unban.
 * Admin role only (403 everyone else, 401 signed out). Nothing here changes a setting: every value lives in
 * server/config/app-defaults.js. A ban = the existing account suspension (users.status 'suspended', sessions ended — same as
 * POST /api/admin/users/:id/status) + a «تعليق مؤقت» reputation penalty (expires after 12 months); unban = status 'active'.
 * Both are audited. No member data is deleted.
 *   GET  /api/owner/status
 *   POST /api/owner/ban     { handle, reason (≥ 5 chars) }
 *   POST /api/owner/unban   { handle, reason? } */
"use strict";
const { E, HttpError, str } = require("../lib/core");
const DEF = require("../config/app-defaults");
const { format } = require("../lib/mjt-ledger");

/** @param {any} ctx */
module.exports = (ctx) => {
  const { db, config } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const owner = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للمالك فقط"); return fn(req, res); });
  const n = async (sql, args = []) => Number((await db.get(sql, args).catch(() => null))?.n || 0);
  const userBy = (h) => db.get("SELECT id, handle, name, role, status FROM users WHERE LOWER(handle)=LOWER($1)", [String(h || "").replace(/^@/, "").trim().slice(0, 60)]);

  /** what each AI feature still needs (names only — never values) */
  function missingKeys(S) {
    const out = [];
    if (!S.translate?.status?.().available) out.push("الترجمة: DEEPL_API_KEY أو OPENAI_API_KEY أو TRANSLATE_URL");
    return out;
  }
  /** v2.167: database size in bytes (+ the 5 largest tables by rows) — for checking the hosting plan's storage limit. Read only. */
  async function dbSize() {
    try {
      if (db.dialect === "postgres") {
        const b = await db.get("SELECT pg_database_size(current_database()) AS b");
        const top = await db.all("SELECT relname AS name, n_live_tup AS rows, pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 5");
        return { bytes: Number(b?.b || 0), tables: top.map((t) => ({ name: t.name, rows: Number(t.rows || 0), bytes: Number(t.bytes || 0) })) };
      }
      const pc = await db.get("PRAGMA page_count"), ps = await db.get("PRAGMA page_size");
      const bytes = Number(pc?.page_count || 0) * Number(ps?.page_size || 0);
      const names = (await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name).filter((x) => /^[A-Za-z0-9_]+$/.test(x));
      const rows = [];
      for (const nm of names.slice(0, 400)) rows.push({ name: nm, rows: await n(`SELECT COUNT(*) n FROM "${nm}"`) });
      return { bytes, tables: rows.sort((a, b) => b.rows - a.rows).slice(0, 5) };
    } catch { return null; }
  }
  async function status() {
    const S = ctx.services, pi = S.pi?.diag?.() || {};
    const plan = await db.get("SELECT price FROM ai_plans WHERE slug='ai_plus'").catch(() => null);
    const supply = await S.mjt?.supply?.().catch(() => null);
    const auto = S.autoRules?.last || {};
    return {
      version: config.version, network: DEF.network, database: db.dialect, dbSize: await dbSize(),
      pi: { enabled: !!pi.enabled, apiKeyPresent: !!pi.apiKeyPresent, sandbox: !!pi.sandbox, authEnabled: pi.authEnabled !== false },
      plus: { pricePi: plan?.price === null || plan?.price === undefined ? null : Number(plan.price) / 1e7, periodDays: DEF.plus.periodDays, autoRenew: false, subscribers: await n("SELECT COUNT(DISTINCT s.user_id) n FROM ai_subscriptions s JOIN ai_plans p ON p.id=s.plan_id WHERE p.slug='ai_plus' AND s.period_end > $1", [new Date().toISOString()]) },
      ai: { translate: !!S.translate?.status?.().available, assistant: !!(await S.assistant?.status?.().catch(() => null))?.available, missingKeys: missingKeys(S) },
      counts: { users: await n("SELECT COUNT(*) n FROM users"), suspended: await n("SELECT COUNT(*) n FROM users WHERE status='suspended'"), posts: await n("SELECT COUNT(*) n FROM posts WHERE status='published'"), openReports: await n("SELECT COUNT(*) n FROM reports WHERE status='open'") },
      mjt: supply ? { circulating: format(supply.circulating), minted: format(supply.minted), burned: format(supply.burned), holders: supply.holders } : null,
      waiting: { earns: await n("SELECT COUNT(*) n FROM mjt_reward_entries p WHERE p.status='pending' AND p.decides IS NULL AND NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id)"), transfers: await n("SELECT COUNT(*) n FROM mjt_transfer_holds WHERE status='pending'"), heldContent: await n("SELECT COUNT(*) n FROM automod_items WHERE state IN ('held','delayed')"), escalated: await n("SELECT COUNT(*) n FROM automod_items WHERE state='escalated'") },
      ...(await (async () => { const a = !!(await S.assistant?.status?.().catch(() => null))?.available; return a ? {} : { assistantNeeds: "المساعد: ASSISTANT_API_KEY أو OPENAI_API_KEY" }; })()),
      autoRules: { lastRun: auto.at || null, last: auto.result || null, rules: DEF.auto },
      defaults: { caps: DEF.mjt.safety.caps, sources: DEF.mjt.sources, services: { studio_extended: DEF.mjt.services.studio_extended, course: DEF.mjt.services.course.tiers.map((t) => t.cost), quota: Object.fromEntries(Object.entries(DEF.mjt.services.quota).map(([k, v]) => [k, v.cost])), appreciation: DEF.mjt.services.appreciation.amounts } },
      note: "كل القيم ثابتة في ملف app-defaults.js وتُطبَّق تلقائياً. هذه الصفحة للقراءة، وللإيقاف الطارئ لحساب فقط."
    };
  }
  async function setStatus(actor, b, ban) {
    const u = await userBy(b.handle); if (!u) throw E.nf("الحساب غير موجود");
    if (u.role === "admin") throw new HttpError(400, "لا يمكن إيقاف حساب إداري", "admin_account");
    const reason = ban ? str(b.reason, 300, { required: true, min: 5 }) : str(b.reason, 300) || null;
    await db.run("UPDATE users SET status=$1 WHERE id=$2 AND role<>'admin'", [ban ? "suspended" : "active", u.id]);
    if (ban) {
      await db.run("DELETE FROM sessions WHERE user_id=$1", [u.id]); // sign-outs only — the account and its data stay
      await ctx.services.repLevels?.applyPenalty?.(actor, { handle: u.handle, kind: "suspension", reason }).catch(() => null);
    }
    await ctx.audit?.(ban ? "OWNER_BAN" : "OWNER_UNBAN", u.id, reason, actor.id);
    return { ok: true, member: { handle: u.handle, name: u.name, status: ban ? "suspended" : "active" } };
  }
  R.get("/api/owner/status", owner(async () => status()));
  R.post("/api/owner/ban", owner(async (req) => setStatus(req.user, req.body || {}, true)));
  R.post("/api/owner/unban", owner(async (req) => setStatus(req.user, req.body || {}, false)));
  return { status, ban: (actor, b) => setStatus(actor, b, true), unban: (actor, b) => setStatus(actor, b, false) };
};
