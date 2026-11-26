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

const HOUR = 3600e3, DAY = 24 * HOUR;
/* achievement types (services/achievements.js) that may become reward sources; saved_search_created and collection_created
 * are repeatable, deletable, low-value actions and are never rewardable */
const REWARDABLE = { quiz_passed: "اجتياز اختبار درس", course_completed: "إكمال دورة", team_created: "إنشاء فريق عمل", article_published: "نشر مقال" };
const CREDIT = ["earn", "adjust_credit"], DEBIT = ["spend", "adjust_debit"];
const TX_KIND = { earn: "earn", spend: "spend", adjust_credit: "adjustment", adjust_debit: "adjustment" };
const KIND_AR = { earn: "مكافأة إنجاز", spend: "استخدام رصيد", adjust_credit: "تصحيح من الإدارة (إضافة)", adjust_debit: "تصحيح من الإدارة (خصم)" };
const STATUS_AR = { posted: "مُضافة", pending: "قيد المراجعة", rejected: "مرفوضة" };
const REASON_AR = { wallet_frozen: "المحفظة موقوفة مؤقتاً", requires_approval: "تحتاج موافقة الإدارة", velocity_review: "مراجعة تلقائية لكثرة المكافآت في وقت قصير" };
const NOTE = "مجتمع كوين (MJT) رصيد مكافآت داخلي فقط: ليس له قيمة نقدية، ولا يُشترى ولا يُباع ولا يُسحب، ولا يُحوَّل إلى Pi أو مال.";
const ENGINE_DEFAULTS = { velocityPerHour: 10 };
const IKEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
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
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); if (!rl.hit("mjt_admin", req.user.id)) throw E.rate(); return fn(req, res); });
  const audit = (q, action, actor, target, txId, detail) => q.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)", [action, actor || null, target || null, txId || null, JSON.stringify(detail || {}), nowIso()]);
  const userByHandle = (h) => db.get("SELECT id, handle, name FROM users WHERE LOWER(handle)=LOWER($1)", [String(h || "").replace(/^@/, "").slice(0, 60)]);
  /** a whole, positive number of MJT typed by an admin → minor units (integers only: no fractions, no floats) */
  const wholeMjt = (v, max = 10000) => { const s = String(v ?? "").trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))); if (!/^\d{1,6}$/.test(s) || +s < 1 || +s > max) throw fail(400, "bad_amount", `المبلغ عدد صحيح من 1 إلى ${max}`); return +s * UNIT; };
  const OPEN = "NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id)";

  /* ---------- engine settings (velocity) ---------- */
  async function engineSettings() { return { ...ENGINE_DEFAULTS, ...parse((await db.get("SELECT value FROM mjt_settings WHERE key='rewards_engine'"))?.value, {}) }; }
  async function saveEngineSettings(user, b = {}) {
    const next = { ...(await engineSettings()) };
    if (b.velocityPerHour !== undefined) next.velocityPerHour = int(b.velocityPerHour, next.velocityPerHour, 1, 1000);
    await db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('rewards_engine',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(next), user.id, nowIso()]);
    await audit(db, "rewards_settings", user.id, null, null, next); ctx.audit?.("mjt_rewards_settings", "mjt", null, user.id);
    return { settings: next };
  }

  /* ---------- sources ---------- */
  async function ensureSources() {
    const at = nowIso();
    for (const [key, label] of Object.entries(REWARDABLE)) await db.run("INSERT INTO mjt_reward_sources(key,label,amount,daily_cap,weekly_cap,monthly_cap,max_per_ref,requires_approval,enabled,updated_by,created_at,updated_at) VALUES($1,$2,NULL,NULL,NULL,NULL,1,0,0,'system',$3,$3) ON CONFLICT DO NOTHING", [key, label, at]);
  }
  const nOrNull = (v) => (v === null || v === undefined ? null : Number(v));
  const srcClient = (r) => ({ key: r.key, label: r.label, amount: r.amount === null || r.amount === undefined ? null : format(r.amount), dailyCap: nOrNull(r.daily_cap), weeklyCap: nOrNull(r.weekly_cap), monthlyCap: nOrNull(r.monthly_cap), maxPerRef: nOrNull(r.max_per_ref), requiresApproval: !!Number(r.requires_approval), enabled: !!Number(r.enabled), updatedAt: r.updated_at });
  async function listSources() { return { sources: (await db.all("SELECT * FROM mjt_reward_sources ORDER BY key")).map(srcClient), rewardable: Object.keys(REWARDABLE) }; }
  async function saveSource(user, key, b = {}, { create = false } = {}) {
    key = String(key || b.key || "");
    const cur = await db.get("SELECT * FROM mjt_reward_sources WHERE key=$1", [key]);
    if (create) { if (!REWARDABLE[key]) throw fail(400, "not_rewardable", "هذا النوع لا يصلح مصدراً للمكافآت"); if (cur) throw fail(409, "exists", "المصدر موجود"); }
    else if (!cur) throw E.nf("المصدر غير موجود");
    const capOf = (v, old) => (v === undefined ? old : v === null || v === "" ? null : int(v, null, 1, 1000));
    const next = {
      label: b.label !== undefined ? str(b.label, 60, { required: true, min: 2 }) : cur?.label || REWARDABLE[key],
      amount: b.amount !== undefined ? (b.amount === null || b.amount === "" ? null : wholeMjt(b.amount)) : cur ? nOrNull(cur.amount) : null,
      daily_cap: capOf(b.dailyCap, cur ? nOrNull(cur.daily_cap) : null), weekly_cap: capOf(b.weeklyCap, cur ? nOrNull(cur.weekly_cap) : null), monthly_cap: capOf(b.monthlyCap, cur ? nOrNull(cur.monthly_cap) : null),
      max_per_ref: b.maxPerRef !== undefined ? (b.maxPerRef === null || b.maxPerRef === "" ? null : int(b.maxPerRef, 1, 1, 100)) : cur ? nOrNull(cur.max_per_ref) : 1,
      requires_approval: b.requiresApproval !== undefined ? (b.requiresApproval ? 1 : 0) : cur ? Number(cur.requires_approval) : 0,
      enabled: b.enabled !== undefined ? (b.enabled ? 1 : 0) : cur ? Number(cur.enabled) : 0
    };
    if (next.enabled && next.amount === null) throw fail(400, "amount_required", "حدّد مبلغ المكافأة قبل تفعيل المصدر");
    const at = nowIso(), vals = [key, next.label, next.amount, next.daily_cap, next.weekly_cap, next.monthly_cap, next.max_per_ref, next.requires_approval, next.enabled, user.id, at];
    if (create) await db.run("INSERT INTO mjt_reward_sources(key,label,amount,daily_cap,weekly_cap,monthly_cap,max_per_ref,requires_approval,enabled,updated_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)", vals);
    else await db.run("UPDATE mjt_reward_sources SET label=$2, amount=$3, daily_cap=$4, weekly_cap=$5, monthly_cap=$6, max_per_ref=$7, requires_approval=$8, enabled=$9, updated_by=$10, updated_at=$11 WHERE key=$1", vals);
    await audit(db, create ? "reward_source_created" : "reward_source_saved", user.id, key, null, { before: cur ? srcClient(cur) : null, after: srcClient({ key, ...next, updated_at: at }) });
    ctx.audit?.("mjt_reward_source_saved", key, JSON.stringify({ enabled: !!next.enabled, amount: next.amount === null ? null : format(next.amount) }), user.id);
    return { source: srcClient(await db.get("SELECT * FROM mjt_reward_sources WHERE key=$1", [key])) };
  }
  async function deleteSource(user, key) {
    const cur = await db.get("SELECT * FROM mjt_reward_sources WHERE key=$1", [String(key)]); if (!cur) throw E.nf("المصدر غير موجود");
    if (Number((await db.get("SELECT COUNT(*) n FROM mjt_reward_entries WHERE source=$1", [cur.key])).n)) throw fail(409, "in_use", "للمصدر حركات مسجّلة؛ عطّله بدلاً من حذفه");
    await db.run("DELETE FROM mjt_reward_sources WHERE key=$1", [cur.key]);
    await audit(db, "reward_source_deleted", user.id, cur.key, null, { before: srcClient(cur) });
    return { ok: true };
  }

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
      const lines = dir > 0 ? [{ account: SYS.mint, amount: -a }, { account: acc, amount: a }] : [{ account: acc, amount: -a }, { account: o.kind === "spend" ? SYS.treasury : SYS.burn, amount: a }];
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
  async function onAchievement(e) {
    if (!e || typeof e.user !== "string" || !REWARDABLE[e.type] || !e.ref) return { paid: false, reason: "not_rewardable" };
    const src = await db.get("SELECT * FROM mjt_reward_sources WHERE key=$1", [e.type]);
    if (!src) return { paid: false, reason: "no_source" };
    if (!Number(src.enabled)) return { paid: false, reason: "disabled" };
    if (src.amount === null || src.amount === undefined || !(Number(src.amount) > 0)) return { paid: false, reason: "no_amount" };
    const S = await engineSettings(), ref = String(e.ref).slice(0, 120);
    const live = "SELECT COUNT(*) n FROM mjt_reward_entries p WHERE p.user_id=$1 AND p.kind='earn' AND p.decides IS NULL AND NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id AND d.status='rejected')";
    const guard = async (t) => {
      const cnt = async (extra, args) => Number((await t.get(live + extra, [e.user, ...args])).n);
      const since = (ms) => new Date(clock() - ms).toISOString();
      for (const [cap, ms, why] of [[src.daily_cap, DAY, "daily_cap"], [src.weekly_cap, 7 * DAY, "weekly_cap"], [src.monthly_cap, 30 * DAY, "monthly_cap"]])
        if (cap !== null && cap !== undefined && (await cnt(" AND p.source=$2 AND p.created_at >= $3", [e.type, since(ms)])) >= Number(cap)) return { skip: why };
      if (src.max_per_ref !== null && src.max_per_ref !== undefined && (await cnt(" AND p.source=$2 AND p.ref=$3", [e.type, ref])) >= Number(src.max_per_ref)) return { skip: "max_per_ref" };
      if ((await cnt(" AND p.created_at >= $2", [since(HOUR)])) >= Number(S.velocityPerHour)) return { pending: "velocity_review" };
      if (Number(src.requires_approval)) return { pending: "requires_approval" };
      return null;
    };
    const r = await credit(e.user, { amount: Number(src.amount), source: e.type, ref, reason: src.label, ikey: `ach:${e.user}:${e.type}:${ref}`, guard });
    return { paid: !!(r.entry && r.entry.status === "posted"), pending: !!r.pending, reason: r.skipped || (r.replayed ? "duplicate" : null), entry: r.entry };
  }
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

  /* ---------- admin corrective credit / debit ---------- */
  async function adminAdjust(user, handle, b = {}) {
    const u = await userByHandle(handle); if (!u) throw E.nf("الحساب غير موجود");
    const ikeyIn = String(b.ikey || ""); if (!IKEY_RE.test(ikeyIn)) throw fail(400, "ikey_required", "مفتاح العملية مطلوب");
    const dir = b.direction === "debit" ? -1 : b.direction === "credit" ? 1 : 0; if (!dir) throw fail(400, "bad_direction", "اختر إضافة أو خصم");
    const amount = wholeMjt(b.amount), reason = str(b.reason, 300, { required: true, min: 5 });
    const r = await move(dir, u.id, { kind: dir > 0 ? "adjust_credit" : "adjust_debit", amount, reason, ikey: `adj:${user.id}:${ikeyIn}`, actorId: user.id, source: "admin" });
    if (r.entry && !r.replayed) { await audit(db, dir > 0 ? "reward_adjust_credit" : "reward_adjust_debit", user.id, u.id, r.entry.tx_id, { amount: format(amount), reason }); ctx.audit?.("mjt_reward_adjusted", u.id, `${dir > 0 ? "+" : "-"}${format(amount)} MJT: ${reason}`, user.id); }
    return { replayed: !!r.replayed, entry: r.entry ? entryClient(r.entry) : null, wallet: await walletOf(u.id) };
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
  const srcLabel = (k) => REWARDABLE[k] || (k === "admin" ? "الإدارة" : k === SERVICE_REFUND ? "خدمات مجتمع كوين" : String(k || "").startsWith("service:") ? "خدمات مجتمع كوين" : k || null);
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
    return { items: rows.filter((r) => r.decision !== "posted").map((r) => ({ ...entryClient(r), status: r.decision === "rejected" ? "rejected" : "pending", statusLabel: STATUS_AR[r.decision === "rejected" ? "rejected" : "pending"] })) };
  }
  async function memberWallet(user) {
    const w = await walletOf(user.id, { create: true });
    const recent = await memberHistory(user, { limit: 5 });
    const sources = (await db.all("SELECT key, label FROM mjt_reward_sources WHERE enabled=1 AND amount IS NOT NULL ORDER BY key")).map((s) => ({ key: s.key, label: s.label }));
    return { wallet: w, recent: recent.items, ways: sources, note: NOTE };
  }

  async function stats() {
    const s = await led().supply();
    // v2.162 fix: service refunds (refundCredit: kind adjust_credit, source service_refund) are refunds, not admin credits — they
    // were counted in «issued» / adjustCredit before
    const j = await db.all("SELECT kind, CASE WHEN source=$1 THEN 1 ELSE 0 END rf, COALESCE(SUM(amount),0) a FROM mjt_reward_entries WHERE status='posted' GROUP BY 1, 2", [SERVICE_REFUND]);
    const sum = (k) => j.filter((r) => k.includes(r.kind) && !Number(r.rf)).reduce((x, r) => x + Number(r.a), 0);
    const refunds = j.filter((r) => Number(r.rf)).reduce((x, r) => x + Number(r.a), 0);
    const bySource = await db.all("SELECT source, status, COUNT(*) n, COALESCE(SUM(amount),0) a FROM mjt_reward_entries WHERE kind='earn' AND (status='posted' OR (status='pending' AND decides IS NULL)) GROUP BY source, status");
    const src = {}; for (const r of bySource) { const k = r.source || "—"; src[k] ||= { source: k, label: srcLabel(k), posted: 0, issued: 0, pending: 0 }; if (r.status === "posted") { src[k].posted += Number(r.n); src[k].issued += Number(r.a); } else src[k].pending += Number(r.n); }
    const pend = await db.get(`SELECT COUNT(*) n FROM mjt_reward_entries p WHERE p.status='pending' AND ${OPEN}`);
    const wallets = await db.get("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) a, COALESCE(SUM(CASE WHEN status<>'active' THEN 1 ELSE 0 END),0) f FROM mjt_accounts WHERE kind='user'");
    const tx = await db.get("SELECT COUNT(*) n FROM mjt_tx"), rtx = await db.get("SELECT COUNT(*) n FROM mjt_reward_entries WHERE status='posted'");
    return { note: NOTE, totalBalances: format(s.users), rewards: { issued: format(sum(CREDIT)), earned: format(sum(["earn"])), adjustCredit: format(sum(["adjust_credit"])), refunds: format(refunds), spent: format(sum(["spend"])), adjustDebit: format(sum(["adjust_debit"])), postedEntries: Number(rtx?.n || 0), pending: Number(pend?.n || 0) },
      ledger: { minted: format(s.minted), burned: format(s.burned), circulating: format(s.circulating), txCount: Number(tx?.n || 0) },
      wallets: { total: Number(wallets?.n || 0), active: Number(wallets?.a || 0), frozen: Number(wallets?.f || 0) },
      bySource: Object.values(src).map((x) => ({ ...x, issued: format(x.issued) })), settings: await engineSettings() };
  }
  async function searchEntries(q = {}) {
    const w = [], a = [];
    const add = (sql, v) => { a.push(v); w.push(sql.replace("?", "$" + a.length)); };
    if (["posted", "pending", "rejected"].includes(q.status)) add("p.status = ?", q.status);
    if (q.status === "open") w.push(`p.status='pending' AND ${OPEN}`);
    if ([...CREDIT, ...DEBIT].includes(q.kind)) add("p.kind = ?", q.kind);
    if (q.source) add("p.source = ?", String(q.source).slice(0, 40));
    if (q.handle) { const u = await userByHandle(q.handle); if (!u) return { items: [], next: null }; add("p.user_id = ?", u.id); }
    if (q.cursor) add("p.created_at < ?", String(q.cursor).slice(0, 40));
    const lim = int(q.limit, 30, 1, 100);
    const rows = await db.all(`SELECT p.*, u.handle FROM mjt_reward_entries p LEFT JOIN users u ON u.id=p.user_id ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY p.created_at DESC, p.id DESC LIMIT ${lim + 1}`, a);
    return { items: rows.slice(0, lim).map((r) => ({ ...entryClient(r), handle: r.handle || null })), next: rows.length > lim ? rows[lim - 1].created_at : null };
  }
  async function entryDetail(eid) {
    const e = await db.get("SELECT p.*, u.handle FROM mjt_reward_entries p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1", [String(eid)]); if (!e) throw E.nf();
    const decision = await db.get("SELECT * FROM mjt_reward_entries WHERE decides=$1", [e.id]);
    const of = e.decides ? await db.get("SELECT * FROM mjt_reward_entries WHERE id=$1", [e.decides]) : null;
    const actor = e.actor_id ? await db.get("SELECT handle FROM users WHERE id=$1", [e.actor_id]) : null;
    const tx = e.tx_id ? await db.get("SELECT id, kind, amount, memo, created_at FROM mjt_tx WHERE id=$1", [e.tx_id]) : null;
    return { entry: { ...entryClient(e), handle: e.handle || null, actor: actor?.handle || null, idempotencyKey: e.idempotency_key }, decision: entryClient(decision), decides: entryClient(of), tx: tx ? { id: tx.id, kind: tx.kind, amount: format(tx.amount), memo: tx.memo, createdAt: tx.created_at } : null };
  }
  async function walletLookup(handle) {
    const u = await userByHandle(handle); if (!u) throw E.nf("الحساب غير موجود");
    const recent = await db.all("SELECT * FROM mjt_reward_entries WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 20", [u.id]);
    const log = await db.all("SELECT action, actor_id, detail, created_at FROM mjt_audit WHERE target=$1 AND action IN ('freeze','unfreeze','reward_adjust_credit','reward_adjust_debit','reward_approved','reward_rejected') ORDER BY id DESC LIMIT 20", [u.id]);
    return { user: { handle: u.handle, name: u.name }, wallet: await walletOf(u.id), entries: recent.map(entryClient), audit: log.map((x) => ({ action: x.action, detail: parse(x.detail, {}), at: x.created_at })) };
  }
  async function setFrozen(user, handle, b = {}) {
    const r = await ctx.services.mjt.freeze(user, handle, b); // reason required (≥ 5 chars), mjt_audit + hash-chained audit
    return { ...r, wallet: await walletOf((await userByHandle(handle)).id) };
  }

  /* ---------- routes ---------- */
  R.get("/api/mjt/wallet", member(async (req) => memberWallet(req.user)));
  R.get("/api/mjt/wallet/history", member(async (req) => memberHistory(req.user, req.query)));
  R.get("/api/mjt/wallet/review", member(async (req) => memberReview(req.user)));
  R.get("/api/admin/mjt/rewards/stats", admin(async () => stats()));
  R.get("/api/admin/mjt/rewards/settings", admin(async () => ({ settings: await engineSettings() })));
  R.put("/api/admin/mjt/rewards/settings", admin(async (req) => saveEngineSettings(req.user, req.body || {})));
  R.get("/api/admin/mjt/rewards/sources", admin(async () => listSources()));
  R.post("/api/admin/mjt/rewards/sources", admin(async (req) => saveSource(req.user, req.body?.key, req.body || {}, { create: true })));
  R.put("/api/admin/mjt/rewards/sources/:key", admin(async (req) => saveSource(req.user, req.params.key, req.body || {})));
  R.del("/api/admin/mjt/rewards/sources/:key", admin(async (req) => deleteSource(req.user, req.params.key)));
  R.get("/api/admin/mjt/rewards/entries", admin(async (req) => searchEntries(req.query)));
  R.get("/api/admin/mjt/rewards/entries/:id", admin(async (req) => entryDetail(req.params.id)));
  R.post("/api/admin/mjt/rewards/entries/:id/approve", admin(async (req) => decide(req.user, req.params.id, req.body || {}, true)));
  R.post("/api/admin/mjt/rewards/entries/:id/reject", admin(async (req) => decide(req.user, req.params.id, req.body || {}, false)));
  R.get("/api/admin/mjt/rewards/wallets/:handle", admin(async (req) => walletLookup(req.params.handle)));
  R.post("/api/admin/mjt/rewards/wallets/:handle/freeze", admin(async (req) => setFrozen(req.user, req.params.handle, req.body || {})));
  R.post("/api/admin/mjt/rewards/wallets/:handle/adjust", admin(async (req) => adminAdjust(req.user, req.params.handle, req.body || {})));

  const ready = ensureSources().catch((e) => logger.error?.("mjt rewards init failed", { err: e?.message }));
  return { ready, REWARDABLE, NOTE, SERVICE_REFUND, credit, debit, refundCredit, canSpend, onAchievement, settle, decide, adminAdjust, walletOf, memberHistory, memberReview, stats, listSources, saveSource, engineSettings };
};
