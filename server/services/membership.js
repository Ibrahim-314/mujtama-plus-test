/* v2.156 — Platform membership: Free (default for everyone) and Plus (one monthly paid plan).
 * Plus IS the existing «ai_plus» plan of services/ai.js (renamed «مجتمع بلس Plus"), so there is ONE subscription engine:
 *   • plan, price (admin-editable, never hard-coded; price book in services/pricing.js), period (30 days), features, limits → ai_plans
 *   • subscription row per member (period_start / period_end, cancel_at_period_end) → ai_subscriptions
 *   • one Pi payment (purpose "ai", testnet unless PI_MAINNET_CONFIRM) per period → ai_payments; Plus starts ONLY on the
 *     PI_PAYMENT_COMPLETED bus event, which services/pi.js emits after re-reading the payment from the Pi Platform API
 *     (owner, amount, network, verified txid). Duplicate completions are no-ops (conditional UPDATE … WHERE status='pending').
 *   • renewal is manual (Pi has no recurring payments): paying again extends from the current end.
 *   • expiry: every entitlement check compares period_end with now, so access ends on time even before the ai.maintain job
 *     flips the row to 'expired'.
 * This module adds: the stable feature registry and one server-side check (can / require), the member's state machine
 * (free · plus_active · plus_cancelling · payment_pending · payment_failed · expired), the history (membership_events +
 * ai_payments), the comparison for the membership page, and the routes under /api/membership.
 * The client never sends a tier: everything is derived from the server rows for req.user. */
const { HttpError, id } = require("../lib/core");

const PLUS = "ai_plus";
/* what every member keeps for free (existing features — nothing is moved behind Plus) */
const FREE = [
  "المجتمع والمنشورات والتعليقات والتفاعل",
  "متابعة الأعضاء والمجتمعات",
  "الملف الشخصي والسيرة المهنية",
  "الوظائف والفرص والعمل الحر",
  "المشاريع والفرق حسب صلاحياتك الحالية",
  "الدورات والمكتبة المعرفية المتاحة",
  "مركز الذكاء بحسابك الخاص (OpenRouter وغيره)",
  "تحليلات الاستوديو حتى 90 يوماً",
  "مجتمع كوين: تكسبه بمساهماتك وتستخدمه في خدماته",
  "تخصيص الصفحة الرئيسية"
];
const STATE_AR = { free: "مجانية", plus_active: "Plus فعّالة", plus_cancelling: "Plus — لن تُجدَّد", payment_pending: "دفعة قيد التحقق",
  payment_failed: "لم تكتمل الدفعة", expired: "انتهت Plus" };
const EVENT_KINDS = { AI_SUBSCRIPTION_STARTED: "started", AI_SUBSCRIPTION_RENEWED: "renewed", AI_SUBSCRIPTION_CANCELLED: "cancelled",
  AI_SUBSCRIPTION_RESUMED: "resumed", AI_SUBSCRIPTION_EXPIRED: "expired" };
/* v2.157 — usage limits per tier (approved by the owner 2026-11-23). Free keeps working at its own ceiling; Plus raises it.
 * Defaults here; an admin overrides any number from #/admin/ai (stored in membership_meta key 'quotas', no code change).
 * Every limit is enforced on the server at the moment of creation only: nothing a member already has is hidden, trimmed or deleted. */
const QUOTAS = {
  saved_searches: { free: 25, plus: 100, label: "عمليات البحث المحفوظة مع التنبيهات" },
  collections: { free: 50, plus: 200, label: "المجموعات المحفوظة" },
  quiz_attempts_daily: { free: 10, plus: 30, label: "محاولات اختبار الدرس الواحد خلال 24 ساعة" },
  teams_owned: { free: 5, plus: 20, label: "الفرق النشطة التي تملكها" },
  team_members: { free: 50, plus: 150, label: "أعضاء الفريق الواحد (حسب عضوية مالكه)" }
};
const QMAX = 100000;
const PAY_AR = { pending: "قيد التحقق", completed: "مكتملة", cancelled: "ملغاة", failed: "فشلت", refunded: "مستردّة" };

/** @param {any} ctx @param {{ now?: () => Date }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus } = ctx;
  const A = ctx.requireUser, R = ctx.router;
  const ai = () => ctx.services.ai;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { const x = JSON.parse(v); return x ?? d; } catch { return d; } };
  const iso = (v) => (v == null ? null : typeof v === "string" ? v : new Date(v).toISOString());

  /* the Plus plan gets `studio_extended` once (like the assistant seed); an admin can remove it later and we never re-add it */
  let seeded = null;
  const ensure = () => (seeded ||= (async () => {
    await ai().ensurePlans();
    if (await db.get("SELECT 1 x FROM membership_meta WHERE key='plus_seeded'")) return;
    const p = await db.get("SELECT id, features FROM ai_plans WHERE slug=$1", [PLUS]);
    if (p) { const f = parse(p.features, []); if (!f.includes("studio_extended")) await db.run("UPDATE ai_plans SET features=$1, updated_at=$2 WHERE id=$3", [JSON.stringify([...f, "studio_extended"]), nowIso(), p.id]); }
    await db.run("INSERT INTO membership_meta(key,value,updated_at) VALUES('plus_seeded','1',$1) ON CONFLICT (key) DO NOTHING", [nowIso()]);
  })().catch((e) => { seeded = null; throw e; }));

  /** server-side entitlement for a stable feature key (translate, assistant, studio_extended, …) */
  async function can(uid, feature) { await ensure(); return !!(await ai().entitled(uid, feature)).ok; }
  /** throws 402 subscription_required (+ upsell) for a non-Plus member */
  async function require_(uid, feature) { await ensure(); return ai().requireFeature(uid, feature); }

  /* ---------- v2.157 usage limits ---------- */
  async function quotaOverrides() { const r = await db.get("SELECT value FROM membership_meta WHERE key='quotas'"); const o = parse(r?.value, {}); return o && typeof o === "object" ? o : {}; }
  /** the limits table: admin value > the service's env default (free side only, kept for existing deployments/tests) > approved default */
  async function quotas(envFree = {}) {
    const o = await quotaOverrides(), out = {};
    for (const [k, d] of Object.entries(QUOTAS)) {
      const a = o[k] || {}, ef = Number(envFree[k]);
      out[k] = { label: d.label, free: Number.isInteger(a.free) ? a.free : Number.isInteger(ef) && ef > 0 ? ef : d.free, plus: Number.isInteger(a.plus) ? a.plus : d.plus, setBy: o[k] ? "admin" : "default" };
    }
    return out;
  }
  /** Plus = a live subscription on the Plus plan (server rows only; grants count, pending/failed payments do not) */
  async function isPlus(uid) { if (!uid) return false; await ensure(); return (await ai().liveSubs(uid)).some((s) => s.p_slug === PLUS); }
  /** the member's ceiling for one limit key */
  async function limitFor(uid, key, envFree) {
    if (!QUOTAS[key]) throw new Error("unknown quota " + key);
    const q = (await quotas(envFree ? { [key]: envFree } : {}))[key], plus = await isPlus(uid);
    return { limit: plus ? Math.max(q.plus, q.free) : q.free, tier: plus ? "plus" : "free", free: q.free, plus: Math.max(q.plus, q.free) };
  }
  /* v2.158 — what the member can do when a ceiling is reached (shown with used / allowed; never deletes anything for them) */
  const ADVICE = {
    saved_searches: "احذف بحثًا محفوظًا لا تحتاجه لتحفظ بحثًا جديدًا",
    collections: "ادمج مجموعتين أو احذف مجموعة فارغة لتنشئ مجموعة جديدة",
    quiz_attempts_daily: "راجع الدرس ثم أعد المحاولة بعد مرور 24 ساعة على أقدم محاولة",
    teams_owned: "أرشف فريقًا لم تعد تعمل عليه لتنشئ فريقًا جديدًا — يبقى محتواه محفوظًا",
    team_members: "أزل عضوًا غير نشط ليتسع الفريق لعضو جديد"
  };
  function quotaError(key, used, l, what) {
    const w = what || QUOTAS[key].label, upsell = l.tier !== "plus" && l.plus > l.free;
    const msg = `وصلت للحد: ${w} (${Number(used)} من ${l.limit}). ${ADVICE[key]}${upsell ? `، أو اشترك في Plus ليصير الحد ${l.plus}` : ""}.`;
    return Object.assign(new HttpError(409, msg, "quota_reached"), { details: { quota: { key, used: Number(used), limit: l.limit, tier: l.tier, plusLimit: l.plus, advice: ADVICE[key], upgrade: upsell ? "#/membership" : null } } });
  }
  /** throw 409 quota_reached when `used` (counted by the owning service, from its own rows) has reached the ceiling */
  async function enforce(uid, key, used, opts = {}) {
    const l = await limitFor(uid, key, opts.envFree);
    if (Number(used) < l.limit) return l;
    throw quotaError(key, used, l, opts.what);
  }
  /* v2.158 — concurrency. Two requests from the same member must not both pass the count. (1) one queue per scope in this
   * process serialises count → insert; (2) after the insert the owning service re-counts committed rows and undoes ITS OWN
   * new row if the ceiling was crossed (covers several server instances). Rows that existed before are never touched. */
  const queues = new Map();
  async function serial(scope, fn) {
    const prev = queues.get(scope) || Promise.resolve();
    let done; const mine = new Promise((r) => { done = r; });
    const tail = prev.then(() => mine);
    queues.set(scope, tail);
    try { await prev; return await fn(); } finally { done(); if (queues.get(scope) === tail) queues.delete(scope); }
  }
  /** count → enforce → create → re-count → undo own row on a race. Returns create()'s result. */
  async function guarded(uid, key, o) {
    return serial(`${key}:${o.scope || uid}`, async () => {
      const used = Number(await o.count()), l = await enforce(uid, key, used, o);
      const out = await o.create(l);
      const after = Number(await o.count());
      if (after > l.limit) { try { await o.undo(out); } catch (e) { logger.warn?.("quota undo failed", { key, err: e.message }); } throw quotaError(key, l.limit, l, o.what); }
      return out;
    });
  }
  /* usage of the per-member ceilings (per-lesson / per-team ones are shown where they apply) */
  const COUNTERS = {
    saved_searches: "SELECT COUNT(*) n FROM saved_searches WHERE user_id=$1",
    collections: "SELECT COUNT(*) n FROM collections WHERE owner=$1",
    teams_owned: "SELECT COUNT(*) n FROM wt_teams WHERE owner_id=$1 AND status<>'archived'"
  };
  async function usage(uid) {
    const [q, plus] = await Promise.all([quotas(), isPlus(uid)]), out = [];
    for (const [key, x] of Object.entries(q)) {
      const limit = plus ? Math.max(x.plus, x.free) : x.free;
      let used = null;
      if (COUNTERS[key]) { try { used = Number((await db.get(COUNTERS[key], [uid]))?.n || 0); } catch { used = null; } }
      const pct = used == null || !limit ? null : Math.min(100, Math.round((used / limit) * 100));
      out.push({ key, label: x.label, used, limit, tier: plus ? "plus" : "free", plusLimit: Math.max(x.plus, x.free), pct, near: pct != null && pct >= 80 && used < limit, full: used != null && used >= limit, over: used != null && used > limit, advice: ADVICE[key] });
    }
    return out;
  }
  async function setQuotas(user, b) {
    const L = b?.limits, bad = () => new HttpError(400, "قيم الحدود غير صالحة", "quotas_invalid");
    if (!L || typeof L !== "object" || Array.isArray(L)) throw bad();
    const cur = await quotas(), next = await quotaOverrides(); let n = 0;
    for (const [k, v] of Object.entries(L)) {
      if (!QUOTAS[k] || !v || typeof v !== "object") throw bad();
      const free = v.free === undefined ? cur[k].free : Number(v.free), plus = v.plus === undefined ? cur[k].plus : Number(v.plus);
      if (!Number.isInteger(free) || !Number.isInteger(plus) || free < 1 || plus < 1 || free > QMAX || plus > QMAX || plus < free) throw bad();
      next[k] = { free, plus }; n++;
    }
    if (!n) throw bad();
    const v = JSON.stringify(next), at = nowIso();
    await db.run("INSERT INTO membership_meta(key,value,updated_at) VALUES('quotas',$1,$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=$2", [v, at]);
    try { ctx.audit?.("membership_quotas_updated", "quotas", v, user.id); } catch { /* best effort */ }
    return { limits: await quotas() };
  }
  async function myQuotas(uid) {
    const [q, plus] = await Promise.all([quotas(), isPlus(uid)]);
    return Object.entries(q).map(([key, x]) => ({ key, label: x.label, free: x.free, plus: Math.max(x.plus, x.free), mine: plus ? Math.max(x.plus, x.free) : x.free }));
  }

  async function planInfo() {
    await ensure();
    const p = await ai().planBySlug(PLUS);
    return p ? ai().planClient(p) : null;
  }

  /** the member's state, from the server rows only */
  async function state(uid) {
    await ensure();
    const p = await ai().planBySlug(PLUS);
    const s = p ? await ai().subRow(uid, p.id) : null;
    const sub = await ai().subClient(s);
    const live = ai().isLive(s);
    const last = p ? await db.get("SELECT p.status, p.created_at, t.status AS tx_status FROM ai_payments p LEFT JOIN pi_transactions t ON t.id=p.intent_id WHERE p.user_id=$1 AND p.plan_id=$2 ORDER BY p.created_at DESC", [uid, p.id]) : null;
    const pending = !!last && last.status === "pending" && ["approved"].includes(last.tx_status); // the member approved in Pi; the server has not confirmed yet
    let st;
    if (live) st = sub.cancelAtPeriodEnd ? "plus_cancelling" : "plus_active";
    else if (pending) st = "payment_pending";
    else if (last && ["failed", "cancelled"].includes(last.status) && (!s || new Date(last.created_at) > new Date(s.updated_at))) st = "payment_failed";
    else if (s) st = "expired";
    else st = "free";
    const features = {};
    for (const k of Object.keys(ai().FEATURES)) features[k] = live && parse(p?.features, []).includes(k);
    return { tier: live ? "plus" : "free", state: st, stateLabel: STATE_AR[st], subscription: sub, plus: live, pendingPayment: pending && live ? true : undefined, features };
  }

  async function history(uid) {
    await ensure();
    const pays = await db.all("SELECT p.id, p.amount, p.status, p.intent_id, p.period_start, p.period_end, p.created_at, p.completed_at, p.cancelled_at, p.refunded_at FROM ai_payments p WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 50", [uid]);
    const evs = await db.all("SELECT kind, plan, until_at, created_at FROM membership_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [uid]);
    const { pi } = require("../lib/ledger");
    return {
      payments: pays.map((x) => ({ id: x.id, receipt: x.intent_id, amount: pi(x.amount), currency: "PI", status: x.status, statusLabel: PAY_AR[x.status] || x.status,
        periodStart: iso(x.period_start), periodEnd: iso(x.period_end), createdAt: iso(x.created_at), completedAt: iso(x.completed_at) })),
      events: evs.map((e) => ({ kind: e.kind, until: iso(e.until_at), at: iso(e.created_at) }))
    };
  }

  async function overview(user) {
    const [me, plan] = await Promise.all([state(user.id), planInfo()]);
    const piCfg = ctx.services.pi?.config ? ctx.services.pi.config() : null;
    return { ...me, plan, limits: await myQuotas(user.id), usage: await usage(user.id), piEnabled: ai().piOn(), network: piCfg?.network || "testnet", minor: await ai().isMinor(user.id),
      ...(ai().piOn() ? {} : { piNote: "مدفوعات Pi غير مفعّلة بعد" }), ...(await history(user.id)) };
  }

  async function compare() {
    const plan = await planInfo();
    return { free: { name: "Free", label: "المجانية", price: 0, features: FREE },
      plus: plan ? { name: "Plus", label: plan.name, price: plan.price, priceNote: plan.priceNote, currency: "PI", periodDays: plan.periodDays,
        features: plan.features.map((k) => ({ key: k, label: ai().FEATURES[k] || k })), limits: plan.limits,
        quotas: Object.entries(await quotas()).map(([key, x]) => ({ key, label: x.label, free: x.free, plus: Math.max(x.plus, x.free) })), renewal: "تجديد يدوي كل شهر — لا خصم تلقائي" } : null };
  }

  /* history: one row per subscription event (the member's own) */
  const track = (kind) => async (e) => {
    if (!e?.user || e.plan !== PLUS) return;
    try { await db.run("INSERT INTO membership_events(id,user_id,kind,plan,until_at,created_at) VALUES($1,$2,$3,$4,$5,$6)", [id("mev"), e.user, kind, e.plan, e.until || null, nowIso()]); }
    catch (err) { logger.warn?.("membership event not recorded", { kind, err: err.message }); }
  };
  for (const [ev, kind] of Object.entries(EVENT_KINDS)) bus.on(ev, track(kind));
  const payEv = (kind) => async (e) => { if (e?.purpose === "ai" && e.user) await track(kind)({ user: e.user, plan: PLUS }); };
  bus.on("PI_PAYMENT_FAILED", payEv("payment_failed"));
  bus.on("PI_PAYMENT_CANCELLED", payEv("payment_cancelled"));

  const safe = (fn) => async (req, res) => {
    try { return await fn(req, res); }
    catch (e) { if (e instanceof HttpError || e?.status) throw e; logger.error?.("membership failed", { err: e.message }); throw new HttpError(500, "تعذّر تحميل العضوية الآن", "server_error"); }
  };
  R.get("/api/membership/plans", safe(async () => compare()));
  R.get("/api/membership/me", A(safe(async (req) => overview(req.user))));
  R.get("/api/membership/usage", A(safe(async (req) => ({ usage: await usage(req.user.id) }))));
  R.post("/api/membership/subscribe", A(safe(async (req) => { await ensure(); return ai().subscribe(req.user, { plan: PLUS }); }))); // also renews: extends from the current end
  R.post("/api/membership/cancel", A(safe(async (req) => ai().cancel(req.user, { plan: PLUS }, true))));
  R.post("/api/membership/resume", A(safe(async (req) => ai().cancel(req.user, { plan: PLUS }, false))));

  const adminOnly = (fn) => A(safe(async (req, res) => { if (req.user?.role !== "admin") throw new HttpError(403, "للإدارة فقط", "forbidden"); return fn(req, res); }));
  R.get("/api/admin/membership/limits", adminOnly(async () => ({ limits: await quotas() })));
  R.put("/api/admin/membership/limits", adminOnly(async (req) => setQuotas(req.user, req.body || {})));

  return { can, require: require_, state, history, ensure, isPlus, quotas, limitFor, enforce, guarded, serial, quotaError, usage, PLUS, FREE, QUOTAS };
};
