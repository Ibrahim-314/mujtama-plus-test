/* v2.160 — «مكافآت مجتمع كوين»: the MJT internal rewards economy (phase 4, migration 090_mjt_rewards).
 * An EXTENSION of services/mjt.js: it posts every movement through the same double-entry ledger (lib/mjt-ledger.js —
 * mjt_accounts is the wallet, created lazily; conditional balance update, idempotency key, CHECK balance >= 0) and writes the
 * same append-only mjt_audit. It adds no second balance, no second DB and no parallel ledger.
 *
 * MJT here is an INTERNAL REWARDS BALANCE ONLY: no monetary value, no price, no market, not on any blockchain, not Pi,
 * no withdrawal, no conversion, and no transfer between members from this module.
 *
 * Engine (single module):
 *   credit(uid, o) / debit(uid, o)  one DB transaction each: lock the wallet row → idempotency check → (frozen? earn → pending,
 *                                   spend → 409) → ledger post (conditional UPDATE: a debit never takes a balance below 0, a
 *                                   replay never applies twice — works on SQLite and PostgreSQL) → one journal row
 *                                   (mjt_reward_entries) with balance_after. Kinds: earn | spend | adjust_credit | adjust_debit.
 *   canSpend(uid, units)            read-only check. v2.161: debit() / canSpend() / refundCredit() are used by services/mjt-services.js
 *                                   («خدمات MJT») — the only spender.
 *   Journal rows are never updated or deleted: approving / rejecting a pending entry APPENDS a decision row (`decides`).
 *
 * Rewards: consumes v2.159 achievement events (bus ACHIEVEMENT_RECORDED). A source pays only when an admin enabled it AND
 * set its amount; every source ships disabled with amount NULL. Caps per member per day / week / month and per referenced
 * object; requires_approval → pending. Velocity check: more than `velocityPerHour` earn entries for one member within an
 * hour → the entry waits as pending for review (nothing is ever deleted). Login, likes and repeatable low-value actions
 * (saving a search, creating a collection) are not reward sources at all.
 *
 * Member API never accepts an amount: GET /api/mjt/wallet, /api/mjt/wallet/history, /api/mjt/wallet/review.
 * Admin API (admin only, 403 otherwise): /api/admin/mjt/rewards/* — stats, sources CRUD, entries search + detail,
 * pending approve / reject, wallet lookup, freeze / unfreeze (reuses mjt.freeze, reason required), corrective credit /
 * debit (reason required, actor + audit). Both rate-limited with the shared limiter (mjt_wallet / mjt_admin). */
const crypto = require("node:crypto");
const { E, HttpError, str } = require("../lib/core");
const L = require("../lib/mjt-ledger");
const { UNIT, SYS, userAcc, format } = L;
const DEF = require("../config/app-defaults");

const HOUR = 3600e3, DAY = 24 * HOUR;
/* achievement types (services/achievements.js) that may become reward sources; saved_search_created and collection_created
 * are repeatable, deletable, low-value actions and are never rewardable */
const REWARDABLE = { quiz_passed: "اجتياز اختبار درس", course_completed: "إكمال دورة", team_created: "إنشاء فريق عمل", article_published: "نشر مقال",
  /* v2.165 phase 8.1 — new sources from the master plan's earn table. Each one is its own row in mjt_reward_sources, seeded
   * DISABLED with amount NULL (caps pre-filled from the plan); nothing pays until an admin sets the amount and turns it on. */
  answer_accepted: "إجابة مقبولة", useful_post: "منشور مفيد", wiki_edit: "تحرير في الويكي", report_confirmed: "بلاغ مؤكَّد", newcomer_help: "مساعدة عضو جديد",
  friend_active: "دعوة صديق بقي نشطاً 14 يوماً", exam_certified: "اجتياز اختبار رسمي بشهادة", study_session: "حضور جلسة دراسة", daily_activity: "مكافأة النشاط اليومي", active_week: "أسبوع نشِط" };
/** v2.165: caps the new sources are seeded with (master plan §3); the old four keep their v2.160 seed (no caps) */
const SEED_CAPS = { answer_accepted: [5, null, null], useful_post: [3, null, null], wiki_edit: [5, null, null], report_confirmed: [5, null, null], newcomer_help: [3, null, null], friend_active: [null, null, 10], exam_certified: [null, 2, null], study_session: [null, 5, null], daily_activity: [1, null, null], active_week: [null, 1, null] };
/** derived bonuses: paid only after another posted contribution earn, never trigger themselves */
const BONUS = ["daily_activity", "active_week"];
const CREDIT = ["earn", "adjust_credit"], DEBIT = ["spend", "adjust_debit"];
const TX_KIND = { earn: "earn", spend: "spend", adjust_credit: "adjustment", adjust_debit: "adjustment" };
const KIND_AR = { earn: "مكافأة إنجاز", spend: "استخدام رصيد", adjust_credit: "تصحيح من الإدارة (إضافة)", adjust_debit: "تصحيح من الإدارة (خصم)" };
const STATUS_AR = { posted: "مُضافة", pending: "قيد المراجعة", rejected: "مرفوضة" };
const REASON_AR = { wallet_frozen: "المحفظة موقوفة مؤقتاً", requires_approval: "تحتاج موافقة الإدارة", velocity_review: "مراجعة تلقائية لكثرة المكافآت في وقت قصير",
  /* v2.165 identity checks (services/mjt-safety.js) */
  account_too_new: "عمر الحساب أقل من الحد", pi_required: "الحساب غير موثّق بـ Pi", integrity_flagged: "مراجعة أمان للحساب", linked_counterpart: "حساب مرتبط بالطرف الآخر", own_content: "محتوى العضو نفسه", linked_cluster: "حسابات مرتبطة", fan_in: "تحويلات كثيرة إلى حساب واحد" };
const NOTE = "مجتمع كوين (MJT) رصيد مكافآت داخلي فقط: ليس له قيمة نقدية، ولا يُشترى ولا يُباع ولا يُسحب، ولا يُحوَّل إلى Pi أو مال.";
const ENGINE_DEFAULTS = DEF.mjt.engine;
/** v2.167: legacy issuance that waits for the identity checks goes through this journal too (source = its path) */
const LEGACY_LABELS = { checkin: "مكافأة الدخول اليومي", mining: "التعدين اليومي", course_sale: "نصيبك من بيع دورتك بمجتمع كوين" };
const SERVICE_REFUND = "service_refund"; // v2.161: compensating credits of services/mjt-services.js (kind adjust_credit, ledger kind refund)

/** @param {any} ctx @param {{ now?: () => Date|number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const led = () => ctx.services.mjt.ledger;
  const uuid = () => crypto.randomUUID();
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const int = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const member = (fn) => A(async (req, res) => { if (!rl.hit("mjt_wallet", req.user.id)) throw E.rate(); return fn(req, res); });
  const audit = (q, action, actor, target, txId, detail) => q.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)", [action, actor || null, target || null, txId || null, JSON.stringify(detail || {}), nowIso()]);
  const OPEN = "NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id)";

  /* ---------- engine settings (velocity) — v2.167: fixed (app-defaults mjt.engine) ---------- */
  async function engineSettings() { return { ...ENGINE_DEFAULTS }; }

  /* ---------- sources ---------- */
  /** v2.167: every source of the approved earn table is ON with its fixed amount and caps (app-defaults mjt.sources). The rows are
   *  synced at boot; a source switched on now pays only for events from this moment (no back-pay). Sources outside the table
   *  (team_created) keep their stored state (no approved amount → nothing pays). */
  async function ensureSources() {
    const at = nowIso();
    for (const [key, label] of Object.entries(REWARDABLE)) { const c = SEED_CAPS[key] || [null, null, null]; await db.run("INSERT INTO mjt_reward_sources(key,label,amount,daily_cap,weekly_cap,monthly_cap,max_per_ref,requires_approval,enabled,updated_by,created_at,updated_at) VALUES($1,$2,NULL,$4,$5,$6,1,0,0,'system',$3,$3) ON CONFLICT DO NOTHING", [key, label, at, c[0], c[1], c[2]]); }
    for (const [key, d] of Object.entries(DEF.mjt.sources)) {
      const cur = await db.get("SELECT * FROM mjt_reward_sources WHERE key=$1", [key]); if (!cur) continue;
      const want = { amount: d.amount * UNIT, daily_cap: d.daily ?? null, weekly_cap: d.weekly ?? null, monthly_cap: d.monthly ?? null };
      const same = Number(cur.enabled) === 1 && Number(cur.requires_approval) === 0 && Number(cur.amount) === want.amount && nOrNull(cur.daily_cap) === want.daily_cap && nOrNull(cur.weekly_cap) === want.weekly_cap && nOrNull(cur.monthly_cap) === want.monthly_cap;
      if (same) continue;
      await db.run("UPDATE mjt_reward_sources SET amount=$2, daily_cap=$3, weekly_cap=$4, monthly_cap=$5, requires_approval=0, enabled=1, updated_by='defaults', updated_at=$6 WHERE key=$1", [key, want.amount, want.daily_cap, want.weekly_cap, want.monthly_cap, at]);
      if (!Number(cur.enabled)) await markSince(key, at, "defaults");
      await audit(db, "reward_source_defaults", "system", key, null, { amount: d.amount, daily: want.daily_cap, weekly: want.weekly_cap, monthly: want.monthly_cap });
    }
  }
  const nOrNull = (v) => (v === null || v === undefined ? null : Number(v));
  const srcClient = (r) => ({ key: r.key, label: r.label, amount: r.amount === null || r.amount === undefined ? null : format(r.amount), dailyCap: nOrNull(r.daily_cap), weeklyCap: nOrNull(r.weekly_cap), monthlyCap: nOrNull(r.monthly_cap), maxPerRef: nOrNull(r.max_per_ref), requiresApproval: !!Number(r.requires_approval), enabled: !!Number(r.enabled), updatedAt: r.updated_at });
  async function listSources() { return { sources: (await db.all("SELECT * FROM mjt_reward_sources ORDER BY key")).map(srcClient), rewardable: Object.keys(REWARDABLE) }; }
  /* v2.165: when each source was last switched on — offer() pays only events that happened after it */
  async function sinceMap() { return parse((await db.get("SELECT value FROM mjt_settings WHERE key='reward_since'"))?.value, {}) || {}; }
  async function markSince(key, at, by) { const m = { ...(await sinceMap()), [key]: at }; await db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('reward_since',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(m), by, at]); }

  /* ---------- engine ---------- */
  const insertEntry = (t, e) => t.run("INSERT INTO mjt_reward_entries(id,user_id,kind,amount,balance_after,source,ref,reason,status,idempotency_key,actor_id,tx_id,decides,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [e.id, e.user_id, e.kind, e.amount, e.balance_after ?? null, e.source || null, e.ref || null, e.reason || null, e.status, e.idempotency_key, e.actor_id || null, e.tx_id || null, e.decides || null, e.created_at]);
  /** o = { amount (minor units, integer > 0), kind, ikey, source?, ref?, reason?, actorId?, decides?, pending?: reason,
   *        guard?: async (t) => null | { skip: reason } | { pending: reason } — runs after the wallet row is locked,
   *        after?: async (t, entry) => any — v2.161: runs inside the same transaction after the journal row (result → .extra),
   *        txKind?: ledger kind override (v2.161: 'refund' for service refunds) } */
  async function move(dir, uid, o) {
    if (!(dir > 0 ? CREDIT : DEBIT).includes(o.kind)) throw new Error("MJT rewards: bad kind " + o.kind);
    if (!Number.isSafeInteger(o.amount) || o.amount <= 0 || o.amount > L.MAX_LINE) throw fail(400, "bad_amount", "مبلغ غير صالح");
    if (typeof o.ikey !== "string" || !o.ikey || o.ikey.length > 180) throw new Error("MJT rewards: idempotency key required");
    if (typeof uid !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw new Error("MJT rewards: bad user");
    const acc = userAcc(uid), adjust = o.kind.startsWith("adjust_");
    return db.tx(async (t) => {
      const w = (await led().lock(t, [acc])).get(acc); // creates the wallet lazily, row-locked on PostgreSQL
      const prev = await t.get("SELECT * FROM mjt_reward_entries WHERE idempotency_key=$1", [o.ikey]);
      if (prev) return { entry: prev, replayed: true };
      const base = { id: uuid(), user_id: uid, kind: o.kind, amount: o.amount, source: o.source, ref: o.ref ? String(o.ref).slice(0, 120) : null, reason: o.reason ? String(o.reason).slice(0, 300) : null, idempotency_key: o.ikey, actor_id: o.actorId, decides: o.decides, created_at: nowIso() };
      const g = o.guard ? await o.guard(t) : null;
      if (g?.skip) return { entry: null, skipped: g.skip };
      if (g?.amount && Number.isSafeInteger(g.amount) && g.amount > 0 && g.amount < o.amount) { o = { ...o, amount: g.amount }; base.amount = g.amount; } // v2.165: overall cap room
      let pending = o.pending || g?.pending || null;
      if (w.status !== "active" && !adjust) {
        if (o.kind === "earn" && !o.decides) pending = "wallet_frozen"; // earning waits while frozen — nothing is lost
        else throw fail(409, "account_frozen", "المحفظة موقوفة مؤقتاً — تواصل مع الدعم");
      }
      if (pending) {
        if (o.kind !== "earn" || o.decides) throw new Error("MJT rewards: only new earn entries can wait");
        const e = { ...base, status: "pending", reason: base.reason ? `${base.reason} · ${pending}` : pending };
        await insertEntry(t, e); return { entry: e, pending: true };
      }
      const a = o.amount;
      const lines = dir > 0 ? [{ account: SYS.mint, amount: -a }, { account: acc, amount: a }] : [{ account: acc, amount: -a }, { account: o.kind === "spend" && !DEF.mjt.burnSpends ? SYS.treasury : SYS.burn, amount: a }];
      const r = await led().post(t, { ikey: "rw:" + o.ikey, kind: o.txKind || TX_KIND[o.kind], actorId: o.actorId || null, userId: uid, refType: o.source ? "reward:" + o.source : "rewards", refId: base.ref, memo: base.reason, allowFrozen: adjust, lines });
      if (r.replayed) return { entry: null, replayed: true, txId: r.tx.id };
      const bal = Number((await t.get("SELECT balance FROM mjt_accounts WHERE id=$1", [acc])).balance);
      const e = { ...base, status: "posted", tx_id: r.tx.id, balance_after: bal };
      await insertEntry(t, e);
      const extra = o.after ? await o.after(t, e) : undefined; // v2.161: runs in the SAME transaction (services: purchase + entitlement) — a throw rolls the debit back
      return { entry: e, replayed: false, extra };
    });
  }
  const credit = (uid, o) => move(1, uid, { kind: "earn", ...o });
  const debit = (uid, o) => move(-1, uid, { kind: "spend", ...o });
  /** v2.161: compensating credit for a service purchase (append-only; allowed on a frozen wallet so a refund is never lost) */
  const refundCredit = (uid, o) => move(1, uid, { ...o, kind: "adjust_credit", source: SERVICE_REFUND, txKind: "refund" });
  /** read-only: may this member spend `units` now? (for future services; wired to none today) */
  async function canSpend(uid, units) {
    if (!Number.isSafeInteger(units) || units <= 0) return { ok: false, reason: "bad_amount" };
    const a = await db.get("SELECT balance, status FROM mjt_accounts WHERE id=$1", [userAcc(uid)]);
    const balance = Number(a?.balance || 0);
    if (a && a.status !== "active") return { ok: false, reason: "account_frozen", balance };
    return balance >= units ? { ok: true, balance } : { ok: false, reason: "insufficient_balance", balance };
  }

  /* ---------- rewards from achievement events ---------- */
  const inflight = new Set();
  const track = (p) => { const q = Promise.resolve(p).catch((err) => logger.warn?.("mjt reward failed", { err: err?.message })).finally(() => inflight.delete(q)); inflight.add(q); return q; };
  const SF = () => ctx.services.mjtSafety;
  /** v2.165: the other member behind an existing achievement (whose lesson / course / content it is) — read only while the
   *  identity switch is on, so the v2.160 behaviour is untouched otherwise */
  async function counterpartOf(e) {
    if (e.counterpart !== undefined) return e.counterpart || null;
    try {
      if (e.type === "quiz_passed") return (await db.get("SELECT c.author FROM course_lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1", [e.ref]))?.author || null;
      if (e.type === "course_completed") return (await db.get("SELECT author FROM courses WHERE id=$1", [e.ref]))?.author || null;
    } catch { /* optional tables */ }
    return null;
  }
  /** v2.165: «إكمال دورة» per lesson (switch course.perLesson, OFF): amountPerLesson × published lessons, clamped to [min, max] */
  async function courseAmount(e, src) {
    const S = SF() ? await SF().settings() : null;
    if (e.type !== "course_completed" || !S?.course?.perLesson) return Number(src.amount);
    const n = Number((await db.get("SELECT COUNT(*) n FROM course_lessons WHERE course_id=$1 AND status='published'", [e.ref]).catch(() => ({ n: 0 })))?.n || 0);
    return Math.min(S.course.max, Math.max(S.course.min, n * S.course.amountPerLesson)) * UNIT;
  }
  async function onAchievement(e) {
    if (!e || typeof e.user !== "string" || !REWARDABLE[e.type] || !e.ref) return { paid: false, reason: "not_rewardable" };
    const src = await db.get("SELECT * FROM mjt_reward_sources WHERE key=$1", [e.type]);
    if (!src) return { paid: false, reason: "no_source" };
    if (!Number(src.enabled)) return { paid: false, reason: "disabled" };
    if (src.amount === null || src.amount === undefined || !(Number(src.amount) > 0)) return { paid: false, reason: "no_amount" };
    const S = await engineSettings(), ref = String(e.ref).slice(0, 120);
    // v2.165 identity checks (switch OFF by default → [] → exactly the v2.160 path). Read outside the wallet transaction.
    const why = SF() && (await SF().identityOn()) ? await SF().earnReasons(e.user, { counterpart: await counterpartOf(e) }) : [];
    const amount = await courseAmount(e, src);
    const live = "SELECT COUNT(*) n FROM mjt_reward_entries p WHERE p.user_id=$1 AND p.kind='earn' AND p.decides IS NULL AND NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id AND d.status='rejected')";
    const guard = async (t) => {
      const cnt = async (extra, args) => Number((await t.get(live + extra, [e.user, ...args])).n);
      const since = (ms) => new Date(clock() - ms).toISOString();
      for (const [cap, ms, why] of [[src.daily_cap, DAY, "daily_cap"], [src.weekly_cap, 7 * DAY, "weekly_cap"], [src.monthly_cap, 30 * DAY, "monthly_cap"]])
        if (cap !== null && cap !== undefined && (await cnt(" AND p.source=$2 AND p.created_at >= $3", [e.type, since(ms)])) >= Number(cap)) return { skip: why };
      if (src.max_per_ref !== null && src.max_per_ref !== undefined && (await cnt(" AND p.source=$2 AND p.ref=$3", [e.type, ref])) >= Number(src.max_per_ref)) return { skip: "max_per_ref" };
      let out = null;
      if (SF()) { // v2.165 overall caps (switch OFF by default → room Infinity)
        const c = await SF().capRoom(e.user, t);
        if (c.room <= 0) return { skip: c.why };
        if (c.room < amount) out = { amount: c.room };
      }
      if (why.length) return { ...out, pending: why.join(" · ") };
      if ((await cnt(" AND p.created_at >= $2", [since(HOUR)])) >= Number(S.velocityPerHour)) return { ...out, pending: "velocity_review" };
      if (Number(src.requires_approval)) return { ...out, pending: "requires_approval" };
      return out;
    };
    const r = await credit(e.user, { amount, source: e.type, ref, reason: src.label, ikey: `ach:${e.user}:${e.type}:${ref}`, guard });
    const paid = !!(r.entry && r.entry.status === "posted" && !r.replayed);
    if (paid && !BONUS.includes(e.type)) await bonuses(e.user).catch((err) => logger.warn?.("mjt bonus failed", { err: err?.message }));
    return { paid: !!(r.entry && r.entry.status === "posted"), pending: !!r.pending, reason: r.skipped || (r.replayed ? "duplicate" : null), entry: r.entry };
  }
  /* ---------- v2.165 offers from existing app events (each source has its own switch, OFF by default) ---------- */
  /** is this source switched on with an amount? (no write when it is not) */
  async function wants(type) { const s = await db.get("SELECT enabled, amount FROM mjt_reward_sources WHERE key=$1", [type]); return !!(s && Number(s.enabled) && s.amount !== null && s.amount !== undefined && Number(s.amount) > 0); }
  /** an app event that may pay `type`. o.at = when it happened: an event before the source was switched on never pays. */
  async function offer(type, uid, ref, o = {}) {
    if (!REWARDABLE[type] || typeof uid !== "string" || !uid || ref === null || ref === undefined || ref === "") return { paid: false, reason: "invalid" };
    if (!(await wants(type))) return { paid: false, reason: "disabled" };
    if (o.at) { const since = (await sinceMap())[type] || (await db.get("SELECT updated_at FROM mjt_reward_sources WHERE key=$1", [type]))?.updated_at; if (since && String(new Date(o.at).toISOString()) < String(since)) return { paid: false, reason: "before_enabled" }; }
    return onAchievement({ user: uid, type, ref: String(ref), counterpart: o.counterpart === undefined ? null : o.counterpart });
  }
  /** fire-and-forget form for success paths in other services (never throws, never delays the caller) */
  const emit = (type, uid, ref, o) => { track(offer(type, uid, ref, o)); };
  const isoWeek = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dn = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dn + 3); const y = x.getUTCFullYear(); const w1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${String(1 + Math.round(((x - w1) / DAY - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`; };
  /** «مكافأة النشاط اليومي» once per UTC day and «أسبوع نشِط» once per ISO week — only after a posted contribution earn */
  async function bonuses(uid) {
    const d = clock(), day = d.toISOString().slice(0, 10);
    if (await wants("daily_activity")) await offer("daily_activity", uid, day);
    if (await wants("active_week")) {
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      const rows = await db.all(`SELECT DISTINCT SUBSTR(created_at,1,10) d FROM mjt_reward_entries WHERE user_id=$1 AND kind='earn' AND status='posted' AND decides IS NULL AND created_at >= $2 AND source NOT IN ('daily_activity','active_week')`, [uid, x.toISOString()]);
      const need = SF() ? (await SF().settings()).activeWeek.days : 5;
      if (rows.length >= need) await offer("active_week", uid, isoWeek(d));
    }
  }
  /** accepted answer (+ helping a new member when the asker is new) — the event already exists (services/content.js) */
  async function onAnswer(e) {
    if (!e?.comment || !e.post) return;
    const [wa, wn] = [await wants("answer_accepted"), await wants("newcomer_help")]; if (!wa && !wn) return;
    const c = await db.get("SELECT id, author, status FROM comments WHERE id=$1 AND post=$2", [e.comment, e.post]);
    const p = await db.get("SELECT author FROM posts WHERE id=$1", [e.post]);
    if (!c || !p || c.status !== "published" || c.author === p.author) return;
    if (wa) await offer("answer_accepted", c.author, c.id, { counterpart: p.author });
    if (wn) {
      const asker = await db.get("SELECT created_at FROM users WHERE id=$1", [p.author]);
      const days = SF() ? (await SF().settings()).newcomerDays : 30;
      if (asker && Date.parse(nowIso()) - Date.parse(asker.created_at) < days * DAY) await offer("newcomer_help", c.author, "q:" + c.id, { counterpart: p.author });
    }
  }
  bus?.on?.("ANSWER_ACCEPTED", (e) => { track(onAnswer(e)); });
  bus?.on?.("ACHIEVEMENT_RECORDED", (e) => { track(onAchievement(e)); });
  /** test / shutdown helper: let queued bus deliveries (setImmediate) start, then wait for every reward in flight */
  const settle = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); await Promise.all([...inflight]); };

  /* ---------- decisions on pending entries (append-only) ---------- */
  async function decide(user, entryId, b = {}, approve) {
    const p = await db.get(`SELECT p.* FROM mjt_reward_entries p WHERE p.id=$1 AND p.status='pending' AND p.decides IS NULL`, [String(entryId)]);
    if (!p) throw E.nf("لا توجد حركة معلّقة بهذا الرقم");
    if (await db.get("SELECT id FROM mjt_reward_entries WHERE decides=$1", [p.id])) throw fail(409, "decided", "سبق البت في هذه الحركة");
    const reason = approve ? str(b.reason, 300) : str(b.reason, 300, { required: true, min: 5 });
    if (approve) {
      const r = await credit(p.user_id, { amount: Number(p.amount), source: p.source, ref: p.ref, reason: reason || "موافقة الإدارة", ikey: "decide:" + p.id, actorId: user.id, decides: p.id });
      if (r.entry) await audit(db, "reward_approved", user.id, p.user_id, r.entry.tx_id, { entry: p.id, reason: reason || null });
      ctx.audit?.("mjt_reward_approved", p.user_id, p.id, user.id);
      return { entry: entryClient(r.entry || (await db.get("SELECT * FROM mjt_reward_entries WHERE decides=$1", [p.id]))), replayed: !!r.replayed };
    }
    const e = { id: uuid(), user_id: p.user_id, kind: p.kind, amount: Number(p.amount), source: p.source, ref: p.ref, reason, status: "rejected", idempotency_key: "decide:" + p.id, actor_id: user.id, decides: p.id, created_at: nowIso() };
    await db.tx(async (t) => { await insertEntry(t, e); await audit(t, "reward_rejected", user.id, p.user_id, null, { entry: p.id, reason }); });
    ctx.audit?.("mjt_reward_rejected", p.user_id, p.id, user.id);
    return { entry: entryClient(e) };
  }

  /* ---------- reads ---------- */
  async function walletOf(uid, { create = false } = {}) {
    if (create) await led().ensureAccount(db, userAcc(uid));
    const a = await db.get("SELECT balance, status, created_at FROM mjt_accounts WHERE id=$1", [userAcc(uid)]);
    const t = await db.get("SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) e, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0) s, COUNT(*) n FROM mjt_entries WHERE account_id=$1", [userAcc(uid)]);
    const p = await db.get(`SELECT COUNT(*) n, COALESCE(SUM(p.amount),0) s FROM mjt_reward_entries p WHERE p.user_id=$1 AND p.status='pending' AND ${OPEN}`, [uid]);
    return { exists: !!a, balance: format(a?.balance || 0), earnedTotal: format(t?.e || 0), spentTotal: format(t?.s || 0), status: a?.status || "active", frozen: !!a && a.status !== "active", movements: Number(t?.n || 0),
      pending: { count: Number(p?.n || 0), total: format(p?.s || 0) }, createdAt: a?.created_at || null };
  }
  const srcLabel = (k) => REWARDABLE[k] || LEGACY_LABELS[k] || (k === "admin" ? "الإدارة" : k === SERVICE_REFUND ? "خدمات مجتمع كوين" : String(k || "").startsWith("service:") ? "خدمات مجتمع كوين" : k || null);
  const kindLabel = (kind, source) => (source === SERVICE_REFUND ? "استرداد خدمة" : kind === "spend" && String(source || "").startsWith("service:") ? "خدمة مجتمع كوين" : KIND_AR[kind] || kind); // v2.161
  const reasonText = (r) => (r ? String(r).split(" · ").map((x) => REASON_AR[x] || x).join(" · ") : null);
  function entryClient(e) {
    if (!e) return null;
    return { id: e.id, kind: e.kind, kindLabel: kindLabel(e.kind, e.source), amount: format(e.amount), balanceAfter: e.balance_after === null || e.balance_after === undefined ? null : format(e.balance_after), source: e.source || null, sourceLabel: srcLabel(e.source), ref: e.ref || null,
      reason: reasonText(e.reason), status: e.status, statusLabel: STATUS_AR[e.status], decides: e.decides || null, txId: e.tx_id || null, createdAt: e.created_at };
  }
  /** the member's full posted history (every ledger movement of the wallet, newest first, cursor-paged) with the source /
   *  reason the reward engine recorded for its own movements */
  async function memberHistory(user, q = {}) {
    const h = await ctx.services.mjt.history(user, { limit: int(q.limit, 20, 1, 50), cursor: q.cursor });
    const ids = h.items.map((x) => x.id).filter(Boolean);
    const js = ids.length ? await db.all(`SELECT * FROM mjt_reward_entries WHERE tx_id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids) : [];
    const by = new Map(js.map((j) => [j.tx_id, j]));
    return { items: h.items.map((x) => { const j = by.get(x.id); return { id: x.id, kind: j?.kind || x.kind, label: j ? kindLabel(j.kind, j.source) : x.label, amount: x.amount, balanceAfter: x.balanceAfter, source: j ? srcLabel(j.source) : null, reason: j ? reasonText(j.reason) : x.note || null, status: "posted", statusLabel: STATUS_AR.posted, createdAt: x.createdAt }; }), next: h.next };
  }
  async function memberReview(user) {
    const rows = await db.all(`SELECT p.*, (SELECT d.status FROM mjt_reward_entries d WHERE d.decides=p.id) decision FROM mjt_reward_entries p WHERE p.user_id=$1 AND p.status='pending' ORDER BY p.created_at DESC LIMIT 50`, [user.id]);
    const items = rows.filter((r) => r.decision !== "posted").map((r) => ({ ...entryClient(r), status: r.decision === "rejected" ? "rejected" : "pending", statusLabel: STATUS_AR[r.decision === "rejected" ? "rejected" : "pending"] }));
    // v2.165: transfers held by the identity checks (none exist while that switch is off)
    const holds = ctx.services.mjtSafety ? await ctx.services.mjtSafety.memberHolds(user.id).catch(() => []) : [];
    return { items: holds.length ? [...items, ...holds].sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1)) : items };
  }
  async function memberWallet(user) {
    const w = await walletOf(user.id, { create: true });
    const recent = await memberHistory(user, { limit: 5 });
    const sources = (await db.all("SELECT key, label FROM mjt_reward_sources WHERE enabled=1 AND amount IS NOT NULL ORDER BY key")).map((s) => ({ key: s.key, label: s.label }));
    return { wallet: w, recent: recent.items, ways: sources, note: NOTE };
  }

  /* ---------- routes ---------- */
  R.get("/api/mjt/wallet", member(async (req) => memberWallet(req.user)));
  R.get("/api/mjt/wallet/history", member(async (req) => memberHistory(req.user, req.query)));
  R.get("/api/mjt/wallet/review", member(async (req) => memberReview(req.user)));

  const ready = ensureSources().catch((e) => logger.error?.("mjt rewards init failed", { err: e?.message }));
  return { ready, REWARDABLE, NOTE, SERVICE_REFUND, credit, debit, refundCredit, canSpend, onAchievement, offer, emit, wants, bonuses, reasonLabel: (c) => REASON_AR[c] || null, settle, decide, walletOf, memberHistory, memberReview, listSources, engineSettings, LEGACY_LABELS };
};
