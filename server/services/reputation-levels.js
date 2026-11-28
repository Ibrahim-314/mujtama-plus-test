/* v2.166 — MJT phase 8.3 «السمعة 2»: one reputation number = trust. Never spent, never decays with absence.
 *   score = quality (the existing services/reputation.js score, as is — it already subtracts its moderation decisions)
 *         + contributions (contribution points total × pointsFactor, default 0.5 — points_balances.total, read only)
 *         − active penalties (reputation_penalties, 10..200 each, expire 12 months after they were applied)
 *   (achievements add reputation in phase 8.4; not here.)
 * The number is DERIVED at read time: no column is rewritten, no point is converted or deleted, old balances are untouched.
 * 8 levels (plan): مبتدئ 0 · مشارك 50 · مساهم 150 · نشِط 400 · موثوق 1,000 · خبير 2,500 · مرشد 5,000 · قدوة المجتمع 10,000.
 * Levels only ADD perks (services plan level ladder); no MJT multiplier. Perks not built yet are marked soon (قريباً).
 * v2.167: ALWAYS ON (app-defaults mjt.reputation) — the switch and the admin page were removed. «تقدير» received adds +1 a day
 * per appreciation (max +10 a day). Penalties are applied by the system (an owner emergency ban adds «تعليق مؤقت») and expire. */
const { E, HttpError, id } = require("../lib/core");
const DEF = require("../config/app-defaults");

const PENALTY_MONTHS = 12;
const LEVELS = [
  { at: 0, name: "مبتدئ", badge: "—", icon: "user" },
  { at: 50, name: "مشارك", badge: "نجمة رمادية", icon: "star" },
  { at: 150, name: "مساهم", badge: "نجمة برونزية", icon: "star" },
  { at: 400, name: "نشِط", badge: "نجمة فضية", icon: "star" },
  { at: 1000, name: "موثوق", badge: "نجمة ذهبية", icon: "star" },
  { at: 2500, name: "خبير", badge: "درع", icon: "shield" },
  { at: 5000, name: "مرشد", badge: "درع ذهبي", icon: "shield" },
  { at: 10000, name: "قدوة المجتمع", badge: "تاج", icon: "award" }
];
/* services plan «سُلّم المستويات»: free perks (built = exists in the app today) + MJT services that open for purchase (none built). */
const SVC = { 1: "إطار الصورة الموسمي", 2: "إطار مرقّم محدود", 3: "عرض الشارات الموسّع", 4: "لقب مخصّص", 5: "نقش غلاف مصمَّم", 6: "بطاقة الملف المتحركة", 7: "حزمة ملصقات المحادثة", 8: "التحليلات الممتدة 180/365", 9: "تقرير الصانع الشهري", 10: "اختبار عنوانين", 11: "مسودات لقطات إضافية", 12: "حزمة قوالب تصميم", 13: "عرض أعمال مميّز", 14: "تثبيت إضافي في الملف", 15: "فتح دورة بمجتمع كوين", 16: "محاولات اختبار إضافية", 17: "تصميم شهادة فاخر", 18: "طلب مراجعة خبير", 19: "تقدير", 20: "بطاقة شكر", 21: "كأس تحدّي المجتمع", 22: "زينة المجتمع الموسمية", 23: "سؤال للخبراء", 24: "فعالية مميّزة", 25: "إبراز المرشد", 26: "إبراز الفريق", 27: "إبراز المجتمع", 28: "زيادة حصة البحث/المجموعات", 29: "زيادة حصة الفرق", 30: "حماية السلسلة", 31: "كتيّب المجموعة", 32: "ممر الموسم", 33: "حزمة رمضان والعيد", 34: "بطاقة المعايدة" };
const P = (text, built = false) => ({ text, built });
const PERKS = [
  { free: [P("كل الأساسيات مجاناً كما هي اليوم", true), P("سقف كسب مجتمع كوين اليومي 30", true), P("حزمة ملصقات أساسية"), P("عدّاد السلسلة"), P("المسار المجاني للموسم")], buy: [7, 8, 11, 15, 16, 17, 28, 29, 30, 31, 33, 34] },
  { free: [P("شارة: نجمة رمادية", true), P("إطار المستوى الرمادي")], buy: [1, 12, 18, 19, 20, 23, 32] },
  { free: [P("شارة: نجمة برونزية", true), P("سقف كسب يومي 40", true), P("إطار برونزي"), P("«موثوق» في حدود المعدل")], buy: [3, 5, 9, 10, 14, 22, 26] },
  { free: [P("شارة: نجمة فضية", true), P("إطار فضي"), P("الترشيح لتحدّي الأسبوع"), P("لقب إنجاز مجاني")], buy: [4, 13, 21] },
  { free: [P("شارة: نجمة ذهبية", true), P("سقف كسب يومي 50", true), P("إطار ذهبي"), P("مؤهل لترشيح «مشرف مجتمع»")], buy: [2, 6, 24, 27] },
  { free: [P("شارة: درع", true), P("دور «مراجع ويكي»"), P("يستقبل طلبات المراجعة وأسئلة الخبراء ويكسب منها")], buy: [25] },
  { free: [P("شارة: درع ذهبي", true), P("إبراز في دليل المرشدين"), P("وصول مبكر 48 ساعة لقطع كل موسم"), P("حماية سلسلة مجانية شهرياً")], buy: [] },
  { free: [P("شارة: تاج", true), P("«جدار القدوات»"), P("التصويت الاستشاري (مستقبلاً)"), P("قطعة موسمية مجانية كل موسم")], buy: [] }
];
const DEFAULTS = { ...DEF.mjt.reputation }; // v2.167: always on (app-defaults)
/** services plan numbers built in the app (v2.167): extended analytics, courses, «تقدير», quota top-ups */
const BUILT = new Set([8, 15, 19, 28, 29]);
const KINDS = { content_removed: [10, "حذف محتوى بقرار إشراف"], warning: [25, "إنذار رسمي"], suspension: [100, "تعليق مؤقت"], manipulation: [200, "تلاعب مؤكَّد"], other: [null, "أخرى"] };

const levelIndex = (score) => { let l = 0; for (let i = 0; i < LEVELS.length; i++) if (score >= LEVELS[i].at) l = i; return l; };
function levelInfo(score) {
  const s = Math.max(0, Math.floor(Number(score) || 0)), i = levelIndex(s), L = LEVELS[i], N = LEVELS[i + 1];
  return { level: i + 1, name: L.name, badge: L.badge, icon: L.icon, min: L.at,
    next: N ? { level: i + 2, name: N.name, at: N.at, remaining: N.at - s } : null,
    progress: N ? Math.max(0, Math.min(100, Math.floor(((s - L.at) / (N.at - L.at)) * 100))) : 100 };
}
const levelsPublic = () => LEVELS.map((L, i) => ({ level: i + 1, at: L.at, name: L.name, badge: L.badge, icon: L.icon, perks: PERKS[i].free, opens: PERKS[i].buy.map((n) => ({ n, name: SVC[n], built: BUILT.has(n) })) }));
/** the mjt-safety daily cap band for a level (1–2 → level12, 3–4 → level34, 5+ → level5) */
const capBand = (level) => (level <= 2 ? "level12" : level <= 4 ? "level34" : "level5");

/** @param {any} ctx @param {{ now?: () => Date|number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx;
  const R = ctx.router;
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const plusMonths = (d, m) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString(); };

  /* ---------- settings — v2.167: fixed and always on (app-defaults mjt.reputation); the old 'reputation' row is not read ---------- */
  async function settings() { return { ...DEFAULTS }; }
  const enabled = async () => !!DEFAULTS.enabled;

  /* ---------- the unified number (derived, read only) ---------- */
  async function parts(uid, S, q = db) {
    const rep = await q.get("SELECT score, breakdown FROM user_reputation WHERE user_id=$1", [uid]).catch(() => null);
    const u = rep ? null : await q.get("SELECT reputation FROM users WHERE id=$1", [uid]).catch(() => null);
    const pts = await q.get("SELECT total FROM points_balances WHERE user_id=$1", [uid]).catch(() => null);
    const pen = await q.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM reputation_penalties WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > $2", [uid, nowIso()]).catch(() => null);
    const quality = Math.max(0, Math.round(Number(rep?.score ?? u?.reputation ?? 0)));
    const pointsTotal = Math.max(0, Number(pts?.total || 0));
    const contributions = Math.floor(pointsTotal * Number(S.pointsFactor ?? DEFAULTS.pointsFactor));
    const penalties = Number(pen?.s || 0);
    const appreciation = await appreciationOf(uid, q);
    const score = Math.max(0, quality + contributions + appreciation - penalties);
    return { score, breakdown: { quality, contributions, pointsTotal, achievements: 0, appreciation, penalties, activePenalties: Number(pen?.n || 0), moderation: Number(parse(rep?.breakdown, {})?.penalties || 0) } };
  }
  /** v2.167 «تقدير»: +repPerItem per appreciation received, at most repPerDay a day (journal rows of services/mjt-services.js,
   *  source 'appreciation', ref 'u:<recipient>:p:<post>') */
  async function appreciationOf(uid, q = db) {
    const A2 = DEF.mjt.services.appreciation;
    const rows = await q.all("SELECT SUBSTR(created_at,1,10) d, COUNT(*) n FROM mjt_reward_entries WHERE kind='spend' AND status='posted' AND source='appreciation' AND ref LIKE $1 GROUP BY SUBSTR(created_at,1,10)", ["u:" + uid + ":%"]).catch(() => []);
    return rows.reduce((x, r) => x + Math.min(A2.repPerDay, Number(r.n) * A2.repPerItem), 0);
  }
  async function unified(uid, q = db) { const S = await settings(); const p = await parts(uid, S, q); return { ...p, ...levelInfo(p.score) }; }
  /** level used by mjt-safety's daily cap when the switch is on; null when off (caller keeps its old source) */
  async function capLevel(uid, q = db) { if (!(await enabled())) return null; return (await unified(uid, q)).level; }
  /** profile payload addition — undefined when the switch is off so the payload is exactly v2.165 */
  async function profileLevel(uid) { if (!(await enabled())) return undefined; const u = await unified(uid); return { score: u.score, level: u.level, name: u.name, badge: u.badge, icon: u.icon, min: u.min, next: u.next, progress: u.progress, breakdown: u.breakdown }; }

  /* ---------- penalties ---------- */
  const penClient = (r, at = nowIso()) => ({ id: r.id, member: r.handle ? { handle: r.handle, name: r.name } : null, amount: Number(r.amount), kind: r.kind, kindLabel: KINDS[r.kind]?.[1] || r.kind, reason: r.reason, createdAt: r.created_at, expiresAt: r.expires_at,
    status: r.revoked_at ? "revoked" : r.expires_at > at ? "active" : "expired", revokedAt: r.revoked_at || null, revokeReason: r.revoke_reason || null });
  async function applyPenalty(user, b = {}) {
    const handle = String(b.handle || "").replace(/^@/, "").trim();
    const u = handle ? await db.get("SELECT id, handle, name FROM users WHERE LOWER(handle)=LOWER($1)", [handle]) : null; if (!u) throw fail(404, "unknown_user", "العضو غير موجود");
    const kind = KINDS[b.kind] ? b.kind : "other";
    const amount = b.amount === undefined || b.amount === "" ? KINDS[kind][0] : Number(b.amount);
    if (!Number.isInteger(amount) || amount < 10 || amount > 200) throw fail(400, "bad_amount", "مقدار العقوبة من 10 إلى 200");
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (reason.length < 5 || reason.length > 300) throw fail(400, "reason_required", "اكتب سبب العقوبة (5 أحرف على الأقل)");
    const at = nowIso(), row = { id: id("rpn"), user_id: u.id, amount, kind, reason, created_by: user.id, created_at: at, expires_at: plusMonths(at, PENALTY_MONTHS) };
    await db.tx(async (t) => {
      await t.run("INSERT INTO reputation_penalties(id,user_id,amount,kind,reason,created_by,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [row.id, row.user_id, row.amount, row.kind, row.reason, row.created_by, row.created_at, row.expires_at]);
      await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('reputation_penalty',$1,$2,NULL,$3,$4)", [user.id, "user:" + u.id, JSON.stringify({ id: row.id, amount, kind, reason, expiresAt: row.expires_at }), at]);
    });
    ctx.audit?.("reputation_penalty", u.id, `−${amount} · ${reason}`, user.id);
    return { penalty: penClient({ ...row, handle: u.handle, name: u.name }), member: await unified(u.id) };
  }
  async function revokePenalty(user, pid, b = {}) {
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (reason.length < 5 || reason.length > 300) throw fail(400, "reason_required", "اكتب سبب الإلغاء (5 أحرف على الأقل)");
    const p = await db.get("SELECT * FROM reputation_penalties WHERE id=$1", [pid]); if (!p) throw E.nf();
    if (p.revoked_at) throw fail(409, "already_revoked", "أُلغيت هذه العقوبة من قبل");
    const at = nowIso();
    await db.tx(async (t) => {
      await t.run("UPDATE reputation_penalties SET revoked_by=$1, revoked_at=$2, revoke_reason=$3 WHERE id=$4 AND revoked_at IS NULL", [user.id, at, reason, pid]);
      await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('reputation_penalty_revoked',$1,$2,NULL,$3,$4)", [user.id, "user:" + p.user_id, JSON.stringify({ id: pid, reason }), at]);
    });
    ctx.audit?.("reputation_penalty_revoked", p.user_id, reason, user.id);
    return { ok: true, member: await unified(p.user_id) };
  }
  async function penalties(q = {}) {
    const at = nowIso(), handle = String(q.handle || "").replace(/^@/, "").trim();
    const rows = await db.all(`SELECT p.*, u.handle, u.name FROM reputation_penalties p LEFT JOIN users u ON u.id=p.user_id ${handle ? "WHERE LOWER(u.handle)=LOWER($1)" : ""} ORDER BY p.created_at DESC LIMIT 100`, handle ? [handle] : []);
    return rows.map((r) => penClient(r, at));
  }
  /* ---------- routes ---------- */
  R.get("/api/rep-levels", async (req) => { if (!(await enabled())) return { enabled: false }; return { enabled: true, levels: levelsPublic(), penaltyMonths: PENALTY_MONTHS, pointsFactor: (await settings()).pointsFactor, me: req.user ? await unified(req.user.id) : null }; });

  return { LEVELS, PERKS, DEFAULTS, levelInfo, levelsPublic, capBand, settings, enabled, appreciationOf, unified, capLevel, profileLevel, applyPenalty, revokePenalty, penalties, invalidate: () => {} };
};
module.exports.LEVELS = LEVELS;
module.exports.levelInfo = levelInfo;
module.exports.capBand = capBand;
module.exports.DEFAULTS = DEFAULTS;
