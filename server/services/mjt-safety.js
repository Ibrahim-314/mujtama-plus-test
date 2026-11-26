/* v2.165 — MJT phase 8.1 «محرك آمن»: identity / abuse checks, overall earning caps and the admin review queue for the internal
 * MJT rewards balance. EVERY new rule ships behind an admin switch that defaults to OFF (mjt_settings key 'safety'; a missing
 * row = all OFF), so deploying this changes nothing for members until an admin turns a switch on.
 *
 *   identity (switch identity.enabled, OFF)   applies to the reward engine (services/mjt-rewards.js — every phase-4 and 8.1
 *       source) and to member → member transfers (services/mjt.js transfer()). Checks: minimum account age (default 7 days),
 *       Pi-authenticated account (users.pi_uid), integrity-flagged account, linked accounts beyond the same device: shared device
 *       id / fingerprint+network (services/integrity.js) PLUS a shared public IP in recent sessions (an IP used by more than
 *       ipMaxAccounts accounts is treated as a carrier / NAT address and ignored; private and loopback addresses never count),
 *       the earner's own content, a linked-account cluster of ≥ clusterMin accounts, and — for transfers — fan-in: ≥ fanInSenders
 *       distinct weak senders (new, not Pi-authenticated, or linked to the recipient) paying one account within fanInDays.
 *       A blocked EARN is not lost: it is written as a pending journal entry (mjt_reward_entries, reason = the check codes).
 *       A blocked TRANSFER is not sent and not lost: it waits in mjt_transfer_holds (migration 093) — nothing moves until an
 *       admin approves (the transfer is posted then) or rejects (nothing ever moves).
 *   caps (switch caps.enabled, OFF)           overall earning caps per member: 50 / day, 250 / week (ISO week, UTC), 800 / month
 *       (calendar month, UTC); the daily cap follows the member's contribution level (points_balances.level; v2.166: the unified
 *       reputation level from services/reputation-levels.js when «السمعة 2» is on): levels 1–2 → 30,
 *       3–4 → 40, 5+ → 50. Counts every reward-engine earn (posted + waiting) and, with countLegacy, the legacy issuance into the
 *       wallet (points rewards, mining, daily sign-in) — the legacy paths themselves are NOT capped or changed here (phase 8.2).
 *       Above the cap a new engine earn is reduced to the room left, or skipped («وصلت حد اليوم»).
 *   course.perLesson (switch, OFF)            «إكمال دورة» pays amountPerLesson × lessons, clamped to [min, max] (2 / 10 / 50).
 *   activeWeek.days                           how many active days in an ISO week earn «أسبوع نشِط» (default 5).
 *
 * Admin API (admin only — 403 members, 401 signed out; rate-limited with the shared mjt_admin limiter; every change audited):
 *   GET  /api/admin/mjt/safety                      settings + suggested source values + which sources are wired
 *   PUT  /api/admin/mjt/safety                      { identity?, caps?, course?, activeWeek?, reason } (reason ≥ 5 chars)
 *   GET  /api/admin/mjt/review?kind=all|earn|transfer   the review queue: waiting earns + held transfers + member signals
 *   POST /api/admin/mjt/review/:kind/:id/approve    kind earn | transfer
 *   POST /api/admin/mjt/review/:kind/:id/reject     { reason ≥ 5 }
 * No balance is changed and no data is deleted by this module except through an admin approval. */
const { E, HttpError, str, id } = require("../lib/core");
const { format } = require("../lib/mjt-ledger");

const DAY = 864e5;
const DEFAULTS = {
  identity: { enabled: false, minAccountDays: 7, requirePi: true, linkedDetection: true, sharedIp: true, ipDays: 30, ipMaxAccounts: 5, clusterMin: 3, fanInDays: 7, fanInSenders: 3, applyEarn: true, applyTransfers: true, maxHeldPerSender: 5 },
  caps: { enabled: false, daily: 50, weekly: 250, monthly: 800, byLevel: true, level12: 30, level34: 40, level5: 50, countLegacy: true },
  course: { perLesson: false, amountPerLesson: 2, min: 10, max: 50 },
  activeWeek: { days: 5 },
  newcomerDays: 30
};
/* the plan's earn table (master plan §3) — suggested values the admin page offers; no source pays until an admin sets its
 * amount and turns it on. wired = the app already has the event the source listens to. */
const SUGGESTED = {
  answer_accepted: { amount: 10, dailyCap: 5, wired: true, event: "قبول إجابتك (حدث ANSWER_ACCEPTED)" },
  useful_post: { amount: 5, dailyCap: 3, wired: true, event: "منشور جمع تفاعلاً من ≥3 حسابات موثوقة (فحص نقاط المساهمة الدوري)" },
  article_published: { amount: 15, dailyCap: 1, weeklyCap: 4, wired: true, event: "نشر مقال (حدث POST_PUBLISHED — مصدر موجود منذ v2.160)" },
  wiki_edit: { amount: 3, dailyCap: 5, wired: true, event: "تحرير ويكي ≥40 حرفاً، مرة لكل صفحة يومياً (الفحص الدوري)" },
  report_confirmed: { amount: 3, dailyCap: 5, wired: true, event: "بلاغ أكّده المشرف (الفحص الدوري)" },
  newcomer_help: { amount: 10, dailyCap: 3, wired: true, event: "إجابة مقبولة لسؤال عضو عمره أقل من 30 يوماً" },
  friend_active: { amount: 20, monthlyCap: 10, wired: true, event: "عضو دعوته بقي نشطاً 14 يوماً (إحالات السفراء)" },
  quiz_passed: { amount: 2, dailyCap: 10, wired: true, event: "اجتياز اختبار درس أول مرة (مصدر موجود منذ v2.160)" },
  course_completed: { amount: 10, weeklyCap: 2, wired: true, event: "إكمال دورة (مصدر موجود منذ v2.160؛ 2 لكل درس بمفتاح منفصل)" },
  exam_certified: { amount: 15, weeklyCap: 2, wired: true, event: "اجتياز اختبار رسمي بشهادة (services/exams.js)" },
  study_session: { amount: 2, weeklyCap: 5, wired: true, event: "حضور جلسة دراسة يسجّله المعلّم" },
  daily_activity: { amount: 3, dailyCap: 1, wired: true, event: "أول مكافأة مساهمة مُضافة في اليوم" },
  active_week: { amount: 10, weeklyCap: 1, wired: true, event: "مساهمة مكافأة في 5 أيام من أسبوع واحد" }
};
const REASON_AR = {
  account_too_new: "عمر الحساب أقل من الحد", pi_required: "الحساب غير موثّق بـ Pi", integrity_flagged: "الحساب معلَّم في فحص النزاهة",
  linked_counterpart: "حساب مرتبط بالطرف الآخر (جهاز أو شبكة)", own_content: "محتوى العضو نفسه", linked_cluster: "ضمن مجموعة حسابات مرتبطة",
  fan_in: "تحويلات كثيرة من حسابات ضعيفة إلى حساب واحد", unknown_user: "حساب غير موجود"
};
const STATUS_AR = { pending: "قيد المراجعة", approved: "أُرسل بعد الموافقة", rejected: "مرفوض", failed: "تعذّر التنفيذ" };
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|fe80:|fc|fd|0\.0\.0\.0|localhost|unknown)/i;

/** @param {any} ctx @param {{ now?: () => Date|number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const int = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); if (!rl.hit("mjt_admin", req.user.id)) throw E.rate(); return fn(req, res); });
  const reasonsText = (list) => list.map((x) => REASON_AR[x] || x).join(" · ");

  /* ---------- settings ---------- */
  let cache = null;
  async function settings() {
    if (cache && cache.at > Date.now() - 3e3) return cache.v;
    const s = parse((await db.get("SELECT value FROM mjt_settings WHERE key='safety'"))?.value, {}) || {};
    const v = { identity: { ...DEFAULTS.identity, ...(s.identity || {}) }, caps: { ...DEFAULTS.caps, ...(s.caps || {}) }, course: { ...DEFAULTS.course, ...(s.course || {}) }, activeWeek: { ...DEFAULTS.activeWeek, ...(s.activeWeek || {}) }, newcomerDays: s.newcomerDays ?? DEFAULTS.newcomerDays };
    cache = { at: Date.now(), v }; return v;
  }
  const BOOL = { identity: ["enabled", "requirePi", "linkedDetection", "sharedIp", "applyEarn", "applyTransfers"], caps: ["enabled", "byLevel", "countLegacy"], course: ["perLesson"] };
  const NUM = { identity: { minAccountDays: [0, 365], ipDays: [1, 365], ipMaxAccounts: [2, 100], clusterMin: [2, 100], fanInDays: [1, 90], fanInSenders: [2, 100], maxHeldPerSender: [1, 100] },
    caps: { daily: [1, 100000], weekly: [1, 1000000], monthly: [1, 10000000], level12: [1, 100000], level34: [1, 100000], level5: [1, 100000] },
    course: { amountPerLesson: [1, 1000], min: [1, 10000], max: [1, 10000] }, activeWeek: { days: [1, 7] } };
  async function saveSettings(user, b = {}) {
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (reason.length < 5 || reason.length > 300) throw fail(400, "reason_required", "اكتب سبب التغيير (5 أحرف على الأقل)");
    const cur = await settings(), next = JSON.parse(JSON.stringify(cur));
    for (const g of Object.keys(NUM)) {
      const x = b[g]; if (!x || typeof x !== "object") continue;
      for (const k of BOOL[g] || []) if (x[k] !== undefined) { if (typeof x[k] !== "boolean") throw fail(400, "bad_value", "قيمة غير صالحة"); next[g][k] = x[k]; }
      for (const [k, [lo, hi]] of Object.entries(NUM[g])) if (x[k] !== undefined) { const n = Number(x[k]); if (!Number.isInteger(n) || n < lo || n > hi) throw fail(400, "bad_value", `قيمة غير صالحة: ${k}`); next[g][k] = n; }
    }
    if (b.newcomerDays !== undefined) next.newcomerDays = int(b.newcomerDays, cur.newcomerDays, 1, 365);
    if (next.caps.daily > next.caps.weekly || next.caps.weekly > next.caps.monthly) throw fail(400, "caps_order", "السقف اليومي ≤ الأسبوعي ≤ الشهري");
    if (next.course.min > next.course.max) throw fail(400, "course_range", "الحد الأدنى للدورة أكبر من الأعلى");
    const at = nowIso();
    await db.tx(async (t) => {
      await t.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('safety',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(next), user.id, at]);
      await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('safety_settings',$1,'safety',NULL,$2,$3)", [user.id, JSON.stringify({ before: cur, after: next, reason }), at]);
    });
    cache = null;
    ctx.audit?.("mjt_safety_settings", "safety", reason, user.id);
    return state();
  }
  async function state() {
    const s = await settings(), row = await db.get("SELECT updated_by, updated_at FROM mjt_settings WHERE key='safety'");
    const src = await ctx.services.mjtRewards?.listSources?.().catch(() => null);
    const by = new Map((src?.sources || []).map((x) => [x.key, x]));
    return { settings: s, defaults: DEFAULTS, updatedAt: row?.updated_at || null, stored: !!row,
      sources: Object.entries(SUGGESTED).map(([key, v]) => ({ key, label: by.get(key)?.label || key, suggested: { amount: v.amount, dailyCap: v.dailyCap ?? null, weeklyCap: v.weeklyCap ?? null, monthlyCap: v.monthlyCap ?? null }, wired: v.wired, event: v.event, enabled: !!by.get(key)?.enabled, amount: by.get(key)?.amount ?? null })),
      note: "كل المفاتيح تبدأ متوقفة. التشغيل يطبّق القواعد على المكافآت والتحويلات الجديدة فقط، ولا يغيّر أي رصيد أو سجل." };
  }

  /* ---------- identity checks ---------- */
  async function flagged(uid) {
    try { if (await ctx.services.integrity?.limitOf?.(uid)) return true; } catch { /* optional */ }
    for (const f of await db.all("SELECT members FROM integrity_flags WHERE status IN ('open','confirmed') AND score >= 0.6").catch(() => [])) if (parse(f.members, []).includes(uid)) return true;
    return false;
  }
  /** accounts linked to uid: device / fingerprint+network (integrity) + a shared public IP in recent sessions */
  async function cluster(uid, S) {
    S = S || (await settings());
    const out = new Map();
    try { const m = await ctx.services.integrity?.linkedAccounts?.(uid); if (m) for (const [k, v] of m) out.set(k, v); } catch { /* optional */ }
    if (S.identity.sharedIp) {
      const since = new Date(clock() - S.identity.ipDays * DAY).toISOString();
      const ips = (await db.all("SELECT DISTINCT ip FROM sessions WHERE user_id=$1 AND ip IS NOT NULL AND created_at >= $2 LIMIT 20", [uid, since]).catch(() => [])).map((r) => String(r.ip || "").trim()).filter((ip) => ip && !PRIVATE_IP.test(ip));
      for (const ip of ips) {
        const us = (await db.all("SELECT DISTINCT user_id FROM sessions WHERE ip=$1 AND created_at >= $2 LIMIT 200", [ip, since])).map((r) => r.user_id);
        if (us.length > S.identity.ipMaxAccounts) continue; // carrier / NAT address: too many people share it to mean anything
        for (const o of us) if (o !== uid && !out.has(o)) out.set(o, "ip");
      }
    }
    return out;
  }
  async function identityReasons(uid, S, { counterpart } = {}) {
    const u = await db.get("SELECT id, created_at, pi_uid, status FROM users WHERE id=$1", [uid]);
    if (!u) return ["unknown_user"];
    const r = [], I = S.identity;
    if (Date.parse(nowIso()) - Date.parse(u.created_at) < I.minAccountDays * DAY) r.push("account_too_new");
    if (I.requirePi && !u.pi_uid) r.push("pi_required");
    if (await flagged(uid)) r.push("integrity_flagged");
    if (counterpart && counterpart === uid) r.push("own_content");
    if (I.linkedDetection) {
      const cl = await cluster(uid, S);
      if (counterpart && counterpart !== uid && cl.has(counterpart)) r.push("linked_counterpart");
      if (cl.size + 1 >= I.clusterMin) r.push("linked_cluster");
    }
    return r;
  }
  /** reward engine: [] = pay as before; otherwise the check codes the earn waits for */
  async function earnReasons(uid, o = {}) {
    const S = await settings(); if (!S.identity.enabled || !S.identity.applyEarn) return [];
    return identityReasons(uid, S, o);
  }
  async function identityOn() { const S = await settings(); return !!S.identity.enabled; }
  /** member → member transfers: [] = send as before */
  async function transferReasons(sender, recipient) {
    const S = await settings(); if (!S.identity.enabled || !S.identity.applyTransfers) return [];
    const r = await identityReasons(sender.id, S, { counterpart: recipient.id });
    const since = new Date(clock() - S.identity.fanInDays * DAY).toISOString();
    const senders = new Set((await db.all("SELECT DISTINCT user_id u FROM mjt_tx WHERE other_id=$1 AND kind='transfer' AND created_at >= $2 UNION SELECT DISTINCT from_id u FROM mjt_transfer_holds WHERE to_id=$1 AND created_at >= $2", [recipient.id, since])).map((x) => x.u));
    senders.add(sender.id);
    if (senders.size >= S.identity.fanInSenders) {
      const rc = S.identity.linkedDetection ? await cluster(recipient.id, S) : new Map();
      let weak = 0;
      for (const s of senders) {
        const u = await db.get("SELECT created_at, pi_uid FROM users WHERE id=$1", [s]); if (!u) continue;
        if (Date.parse(nowIso()) - Date.parse(u.created_at) < S.identity.minAccountDays * DAY || (S.identity.requirePi && !u.pi_uid) || rc.has(s)) weak++;
      }
      if (weak >= S.identity.fanInSenders) r.push("fan_in");
    }
    return [...new Set(r)];
  }

  /* ---------- overall caps ---------- */
  const isoWeekStart = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
  function windows() {
    const d = clock();
    return { day: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(), week: isoWeekStart(d).toISOString(), month: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString() };
  }
  async function levelOf(uid, q = db) {
    const rl8 = await ctx.services.repLevels?.capLevel?.(uid, q).catch(() => null); if (rl8) return rl8; // v2.166: the unified reputation level when «السمعة 2» is on
    const r = await q.get("SELECT level FROM points_balances WHERE user_id=$1", [uid]).catch(() => null); return Number(r?.level || 0) + 1;
  }
  async function usedSince(uid, since, S, q = db) {
    const e = await q.get("SELECT COALESCE(SUM(p.amount),0) s FROM mjt_reward_entries p WHERE p.user_id=$1 AND p.kind='earn' AND p.decides IS NULL AND p.created_at >= $2 AND NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id AND d.status='rejected')", [uid, since]);
    let n = Number(e?.s || 0);
    if (S.caps.countLegacy) n += Number((await q.get("SELECT COALESCE(SUM(amount),0) s FROM mjt_tx WHERE user_id=$1 AND kind IN ('reward','mining','checkin') AND created_at >= $2", [uid, since]))?.s || 0);
    return n;
  }
  /** room left under the overall caps, in minor units (Infinity while the switch is off) */
  async function capRoom(uid, q = db) {
    const S = await settings(); if (!S.caps.enabled) return { room: Infinity };
    const UNIT = require("../lib/mjt-ledger").UNIT, w = windows(), lvl = await levelOf(uid, q);
    const daily = S.caps.byLevel ? Math.min(S.caps.daily, lvl <= 2 ? S.caps.level12 : lvl <= 4 ? S.caps.level34 : S.caps.level5) : S.caps.daily;
    let best = { room: Infinity };
    for (const [cap, since, why] of [[daily, w.day, "overall_daily_cap"], [S.caps.weekly, w.week, "overall_weekly_cap"], [S.caps.monthly, w.month, "overall_monthly_cap"]]) {
      const room = cap * UNIT - (await usedSince(uid, since, S, q));
      if (room < best.room) best = { room, why, cap, level: lvl };
    }
    return best;
  }
  async function capsOf(uid) {
    const S = await settings(), w = windows(), lvl = await levelOf(uid);
    const daily = S.caps.byLevel ? Math.min(S.caps.daily, lvl <= 2 ? S.caps.level12 : lvl <= 4 ? S.caps.level34 : S.caps.level5) : S.caps.daily;
    return { enabled: !!S.caps.enabled, level: lvl, daily, weekly: S.caps.weekly, monthly: S.caps.monthly, used: { day: format(await usedSince(uid, w.day, S)), week: format(await usedSince(uid, w.week, S)), month: format(await usedSince(uid, w.month, S)) } };
  }

  /* ---------- held transfers ---------- */
  const holdClient = (h, ppl = new Map()) => ({ id: h.id, kind: "transfer", from: ppl.get(h.from_id) || null, to: ppl.get(h.to_id) || null, amount: format(h.amount), note: h.note || null, reasons: parse(h.reasons, []), reasonsText: reasonsText(parse(h.reasons, [])), status: h.status, statusLabel: STATUS_AR[h.status], decisionReason: h.decision_reason || null, txId: h.tx_id || null, createdAt: h.created_at, decidedAt: h.decided_at || null });
  const heldByKey = (ikey) => db.get("SELECT * FROM mjt_transfer_holds WHERE ikey=$1", [ikey]);
  async function hold(user, other, amount, note, ikey, reasons) {
    const S = await settings();
    const open = Number((await db.get("SELECT COUNT(*) n FROM mjt_transfer_holds WHERE from_id=$1 AND status='pending'", [user.id])).n);
    if (open >= S.identity.maxHeldPerSender) throw fail(429, "held_limit", "لديك تحويلات كثيرة قيد المراجعة؛ انتظر قرار الإدارة");
    const hid = id("mh"), at = nowIso();
    await db.tx(async (t) => {
      await t.run("INSERT INTO mjt_transfer_holds(id,ikey,from_id,to_id,amount,note,reasons,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8) ON CONFLICT DO NOTHING", [hid, ikey, user.id, other.id, amount, note, JSON.stringify(reasons), at]);
      await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('transfer_held','system',$1,NULL,$2,$3)", [user.id, JSON.stringify({ hold: hid, to: other.id, amount: format(amount), reasons }), at]);
    });
    return holdResponse(await heldByKey(ikey), other, false);
  }
  async function holdResponse(h, other, replayed = true) {
    other = other || (await db.get("SELECT handle, name, avatar FROM users WHERE id=$1", [h.to_id]));
    return { replayed, pending: true, transfer: null, hold: { id: h.id, amount: format(h.amount), to: other ? { handle: other.handle, name: other.name, avatar: other.avatar || null } : null, status: h.status, statusLabel: STATUS_AR[h.status], reasons: parse(h.reasons, []), reasonsText: reasonsText(parse(h.reasons, [])), createdAt: h.created_at },
      note: "التحويل قيد المراجعة: لم يُخصم شيء من رصيدك، وسيُرسل إذا وافقت الإدارة." };
  }
  async function memberHolds(uid) {
    return (await db.all("SELECT * FROM mjt_transfer_holds WHERE from_id=$1 AND status IN ('pending','rejected','failed') ORDER BY created_at DESC LIMIT 20", [uid])).map((h) => ({ id: h.id, kind: "transfer_hold", label: "تحويل قيد المراجعة", amount: format(h.amount), reason: null, status: h.status === "pending" ? "pending" : "rejected", statusLabel: STATUS_AR[h.status], createdAt: h.created_at }));
  }
  async function decideHold(user, hid, b, approve) {
    const h = await db.get("SELECT * FROM mjt_transfer_holds WHERE id=$1", [String(hid)]); if (!h) throw E.nf("لا يوجد تحويل معلّق بهذا الرقم");
    if (h.status !== "pending") throw fail(409, "decided", "سبق البت في هذا التحويل");
    const reason = approve ? str(b.reason, 300) || null : str(b.reason, 300, { required: true, min: 5 });
    const at = nowIso();
    let txId = null;
    if (approve) {
      const r = await ctx.services.mjt.executeHold(h); // throws 409 (insufficient balance / frozen / receive off) → the hold stays pending
      txId = r.tx.id;
    }
    const upd = await db.run("UPDATE mjt_transfer_holds SET status=$1, tx_id=$2, decided_by=$3, decision_reason=$4, decided_at=$5 WHERE id=$6 AND status='pending'", [approve ? "approved" : "rejected", txId, user.id, reason, at, h.id]);
    if (!upd.changes) throw fail(409, "decided", "سبق البت في هذا التحويل");
    await db.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)", [approve ? "transfer_hold_approved" : "transfer_hold_rejected", user.id, h.from_id, txId, JSON.stringify({ hold: h.id, reason }), at]);
    ctx.audit?.(approve ? "mjt_transfer_hold_approved" : "mjt_transfer_hold_rejected", h.from_id, reason, user.id);
    return { item: holdClient(await db.get("SELECT * FROM mjt_transfer_holds WHERE id=$1", [h.id]), await people([h.from_id, h.to_id])) };
  }

  /* ---------- review queue ---------- */
  async function people(ids) { const m = new Map(); for (const u of [...new Set(ids.filter(Boolean))]) { const r = await db.get("SELECT id, handle, name FROM users WHERE id=$1", [u]); if (r) m.set(u, { handle: r.handle, name: r.name }); } return m; }
  async function signals(uid, S) {
    const u = await db.get("SELECT created_at, pi_uid FROM users WHERE id=$1", [uid]);
    const cl = S.identity.linkedDetection ? await cluster(uid, S) : new Map();
    return { ageDays: u ? Math.floor((Date.parse(nowIso()) - Date.parse(u.created_at)) / DAY) : null, piLinked: !!u?.pi_uid, flagged: await flagged(uid), linked: cl.size, linkedBy: [...new Set(cl.values())] };
  }
  async function queue(q = {}) {
    const S = await settings(), kind = ["earn", "transfer"].includes(q.kind) ? q.kind : "all";
    const earns = kind === "transfer" ? [] : await db.all("SELECT p.* FROM mjt_reward_entries p WHERE p.status='pending' AND p.decides IS NULL AND NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id) ORDER BY p.created_at DESC LIMIT 100");
    const holds = kind === "earn" ? [] : await db.all("SELECT * FROM mjt_transfer_holds WHERE status='pending' ORDER BY created_at DESC LIMIT 100");
    const ppl = await people([...earns.map((e) => e.user_id), ...holds.flatMap((h) => [h.from_id, h.to_id])]);
    const labels = ctx.services.mjtRewards?.REWARDABLE || {};
    const items = [
      ...earns.map((e) => { const codes = String(e.reason || "").split(" · "); return { id: e.id, kind: "earn", member: ppl.get(e.user_id) || null, amount: format(e.amount), source: e.source, sourceLabel: labels[e.source] || e.source, reasons: codes.filter((c) => REASON_AR[c] || /cap|velocity|approval|frozen/.test(c)), reasonsText: codes.map((c) => REASON_AR[c] || ctx.services.mjtRewards?.reasonLabel?.(c) || c).join(" · "), createdAt: e.created_at, _uid: e.user_id }; }),
      ...holds.map((h) => ({ ...holdClient(h, ppl), member: ppl.get(h.from_id) || null, _uid: h.from_id }))
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const members = new Map();
    for (const it of items) { const m = members.get(it._uid) || { member: it.member, earns: 0, transfers: 0, uid: it._uid }; it.kind === "earn" ? m.earns++ : m.transfers++; members.set(it._uid, m); }
    const suspects = [];
    for (const m of [...members.values()].slice(0, 30)) suspects.push({ member: m.member, earns: m.earns, transfers: m.transfers, signals: await signals(m.uid, S) });
    return { items: items.map(({ _uid, ...x }) => x), members: suspects, counts: { earn: items.filter((x) => x.kind === "earn").length, transfer: items.filter((x) => x.kind === "transfer").length },
      switches: { identity: !!S.identity.enabled, caps: !!S.caps.enabled }, note: "الموافقة تضيف المكافأة أو ترسل التحويل الآن؛ الرفض لا يحرّك أي رصيد. لا يُحذف شيء." };
  }
  async function decide(user, kind, itemId, b = {}, approve) {
    if (kind === "earn") { const r = await ctx.services.mjtRewards.decide(user, itemId, b, approve); return { item: r.entry }; }
    if (kind === "transfer") return decideHold(user, itemId, b, approve);
    throw E.nf();
  }

  R.get("/api/admin/mjt/safety", admin(async () => state()));
  R.put("/api/admin/mjt/safety", admin(async (req) => saveSettings(req.user, req.body || {})));
  R.get("/api/admin/mjt/review", admin(async (req) => queue(req.query)));
  R.post("/api/admin/mjt/review/:kind/:id/approve", admin(async (req) => decide(req.user, req.params.kind, req.params.id, req.body || {}, true)));
  R.post("/api/admin/mjt/review/:kind/:id/reject", admin(async (req) => decide(req.user, req.params.kind, req.params.id, req.body || {}, false)));

  return { DEFAULTS, SUGGESTED, REASON_AR, settings, saveSettings, state, cluster, earnReasons, identityOn, transferReasons, capRoom, capsOf, hold, heldByKey, holdResponse, memberHolds, queue, decide, reasonsText, invalidate: () => { cache = null; } };
};
module.exports.DEFAULTS = DEFAULTS;
module.exports.SUGGESTED = SUGGESTED;
