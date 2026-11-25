/* v2.163 — admin on/off switches for the LEGACY MJT paths (the ones that predate the phase-4 reward engine).
 * One switch per path, stored in the existing mjt_settings table (key 'legacy', JSON { <path>: true|false }). No migration.
 * DEFAULT = ENABLED: a missing row or a missing key means ON, so deploying this changes nothing until an admin turns a path off.
 * Optional env override: MJT_LEGACY_<PATH>=off (also 0 / false) forces that path OFF whatever the stored switch says
 * (e.g. MJT_LEGACY_MINING=off). An env override cannot force a path on.
 *
 * A switch only stops NEW actions of its path. It never touches balances, ledger rows, history, links, sessions or any other
 * user data, and it never blocks a reversal / clawback / rollback / refund (those finish exactly as before). Turning a switch
 * back on restores the old behaviour for new actions.
 *
 *   path              what stops while OFF                                         what keeps working
 *   transfers         POST /api/mjt/transfers (new member → member transfers)       replay of an already-sent transfer, receive switch, history
 *   tips              POST /api/mjt/posts/:id/tips and /api/mjt/rooms/:id/tips     tip summaries, «tips received», history
 *   mining            POST /api/mjt/mining/start (a new 24-hour session)           claiming a session started BEFORE the switch (its amount was fixed at start)
 *   checkin           POST /api/mjt/checkin (+1 MJT daily sign-in)                 the read-only check-in state/streak of past days
 *   conversion        applying the one-time points → MJT batch conversion          dry run, rollback of an applied batch
 *                     (POST /api/admin/mjt/conversion and the boot auto-conversion)
 *   pointRewards      minting MJT for each NEW contribution-points award           the points award itself (points, levels), clawback of earlier MJT
 *                     (the award's link is recorded as 'skipped', reason legacy_off — same as rewards_off today)
 *   ownerGrant        the MJT_OWNER_GRANT boot grant (skipped and logged)           MJT_OWNER_GRANT_UNDO (a reversal)
 *   communityRewards  community owner-funded MJT rewards (recorded 'skipped',       reversal of paid community rewards
 *                     reason legacy_off)
 *   buy               /api/mjt/buy — always 501, no switch (listed as «not available»)
 *
 * Admin API (admin only — 403 for everyone else, 401 signed out; rate-limited with the shared mjt_admin limiter):
 *   GET /api/admin/mjt/legacy             every path: switch, effective state, env override, last change
 *   PUT /api/admin/mjt/legacy/:key        { enabled: boolean, reason: ≥ 5 chars } — audited in mjt_audit + the audit log
 * Members read their own effective flags inside GET /api/mjt/me (legacy) and GET /api/mjt/mining (enabled, checkin.on). */
const { E, HttpError } = require("../lib/core");

const PATHS = [
  { key: "transfers", env: "TRANSFERS", ar: "التحويل بين الأعضاء", en: "Member transfers", subs: ["member_transfer|transfer"], stops: "POST /api/mjt/transfers" },
  { key: "tips", env: "TIPS", ar: "إكراميات MJT على المنشورات والبث المباشر", en: "MJT tips on posts and live rooms", subs: ["tip|tip"], stops: "POST /api/mjt/posts/:id/tips, POST /api/mjt/rooms/:id/tips" },
  { key: "mining", env: "MINING", ar: "التعدين اليومي", en: "Daily mining", subs: ["legacy_issuance|mining"], stops: "POST /api/mjt/mining/start" },
  { key: "checkin", env: "CHECKIN", ar: "مكافأة الدخول اليومي", en: "Daily sign-in reward", subs: ["legacy_issuance|checkin"], stops: "POST /api/mjt/checkin" },
  { key: "conversion", env: "CONVERSION", ar: "تحويل نقاط المساهمة إلى MJT (دفعة التحويل)", en: "Points → MJT conversion (batch)", subs: ["legacy_issuance|points_conversion", "legacy_issuance|points_conversion_reversal"], stops: "POST /api/admin/mjt/conversion + boot auto-conversion" },
  { key: "pointRewards", env: "POINT_REWARDS", ar: "مكافآت MJT على نقاط المساهمة الجديدة", en: "MJT for new contribution points", subs: ["legacy_issuance|points_reward", "legacy_issuance|points_reward_clawback"], stops: "MJT minting on each new points award" },
  { key: "ownerGrant", env: "OWNER_GRANT", ar: "رصيد تجربة المالك (MJT_OWNER_GRANT)", en: "Owner test grant (MJT_OWNER_GRANT)", subs: ["legacy_issuance|owner_grant", "legacy_issuance|owner_grant_undo"], stops: "MJT_OWNER_GRANT at boot" },
  { key: "communityRewards", env: "COMMUNITY_REWARDS", ar: "مكافآت المجتمعات بـ MJT", en: "Community MJT rewards", subs: ["member_transfer|community_reward", "member_transfer|community_reward_reversal"], stops: "owner-funded community rewards" }
];
const FIXED = [{ key: "buy", ar: "شراء MJT بـ Pi", en: "Buy MJT with Pi", subs: ["legacy_issuance|pi_buy"], stops: "POST /api/mjt/buy (always 501)", fixed: true }];
const KEYS = PATHS.map((p) => p.key);
const MEMBER_KEYS = ["transfers", "tips", "mining", "checkin"]; // the only flags a member's UI needs
const CODE = "mjt_legacy_disabled";

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date|number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); if (!rl.hit("mjt_admin", req.user.id)) throw E.rate(); return fn(req, res); });
  const envOff = (p) => /^(off|0|false|no)$/i.test(String(env["MJT_LEGACY_" + p.env] ?? "").trim());

  let cache = null;
  async function row() {
    if (cache && cache.at > Date.now() - 3e3) return cache.v;
    const r = await db.get("SELECT value, updated_by, updated_at FROM mjt_settings WHERE key='legacy'");
    const v = { stored: parse(r?.value, {}) || {}, updatedBy: r?.updated_by || null, updatedAt: r?.updated_at || null };
    cache = { at: Date.now(), v }; return v;
  }
  /** the stored switch (default ON) */
  const storedOn = (s, k) => s.stored[k] !== false;
  /** effective state of one path: stored switch AND no env override */
  async function isOn(key) {
    const p = PATHS.find((x) => x.key === key); if (!p) return !FIXED.some((x) => x.key === key);
    if (envOff(p)) return false;
    return storedOn(await row(), key);
  }
  async function flags(keys = KEYS) { const out = {}; for (const k of keys) out[k] = await isOn(k); return out; }
  const label = (key) => PATHS.find((p) => p.key === key) || { ar: key, en: key };
  const note = (key) => `«${label(key).ar}» متوقف مؤقتاً`;
  const noteEn = (key) => `${label(key).en} is temporarily paused`;
  /** the refusal a path answers while OFF (409, code mjt_legacy_disabled) */
  function error(key) { return Object.assign(new HttpError(409, note(key), CODE), { details: { path: key, messageEn: noteEn(key) } }); }
  async function guard(key) { if (!(await isOn(key))) throw error(key); }

  async function state() {
    const s = await row();
    const paths = PATHS.map((p) => {
      const stored = storedOn(s, p.key), forced = envOff(p);
      return { key: p.key, label: p.ar, labelEn: p.en, stops: p.stops, subs: p.subs, stored, envForcedOff: forced, envVar: "MJT_LEGACY_" + p.env, enabled: stored && !forced };
    });
    return { paths, fixed: FIXED.map((p) => ({ key: p.key, label: p.ar, labelEn: p.en, stops: p.stops, subs: p.subs, enabled: false, fixed: true, note: "غير متاح — لا يوجد مفتاح" })),
      updatedAt: s.updatedAt, updatedBy: s.updatedBy, defaults: "all enabled", note: "الإيقاف يمنع العمليات الجديدة فقط: لا يغيّر أي رصيد أو حركة أو سجل، ولا يمنع الاسترجاع أو الإلغاء." };
  }
  async function setSwitch(user, key, b = {}) {
    const p = PATHS.find((x) => x.key === String(key || ""));
    if (!p) throw Object.assign(new HttpError(404, FIXED.some((x) => x.key === key) ? "هذا المسار غير متاح أصلاً ولا مفتاح له" : "مسار غير معروف", "unknown_path"));
    if (typeof b.enabled !== "boolean") throw new HttpError(400, "حدّد التشغيل أو الإيقاف", "enabled_required");
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (reason.length < 5 || reason.length > 300) throw Object.assign(new HttpError(400, "اكتب سبب التغيير (5 أحرف على الأقل)", "reason_required"), { details: { messageEn: "Give a reason (at least 5 characters)" } });
    const at = nowIso();
    const res = await db.tx(async (t) => {
      const cur = parse((await t.get("SELECT value FROM mjt_settings WHERE key='legacy'"))?.value, {}) || {};
      const before = cur[p.key] !== false;
      const next = { ...Object.fromEntries(KEYS.map((k) => [k, cur[k] !== false])), [p.key]: b.enabled };
      await t.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('legacy',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(next), user.id, at]);
      await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('legacy_switch',$1,$2,NULL,$3,$4)", [user.id, p.key, JSON.stringify({ before, after: b.enabled, reason }), at]);
      return { before };
    });
    cache = null;
    ctx.audit?.(b.enabled ? "mjt_legacy_enabled" : "mjt_legacy_disabled", p.key, reason, user.id);
    const st = await state();
    return { path: st.paths.find((x) => x.key === p.key), changed: res.before !== b.enabled, state: st };
  }

  R.get("/api/admin/mjt/legacy", admin(async () => state()));
  R.put("/api/admin/mjt/legacy/:key", admin(async (req) => setSwitch(req.user, req.params.key, req.body || {})));

  return { PATHS, FIXED, KEYS, MEMBER_KEYS, CODE, isOn, flags, guard, error, note, state, setSwitch, invalidate: () => { cache = null; } };
};
module.exports.PATHS = PATHS;
module.exports.FIXED = FIXED;
