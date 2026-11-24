/* v2.161 — «خدمات MJT» (phase 5): spending the internal MJT rewards balance on services that ALREADY exist in the app.
 * Not a new engine and not a new wallet: every debit goes through mjt-rewards.debit() (phase 4: one DB transaction, wallet row
 * locked, idempotency key, conditional balance update — never below 0 — frozen wallet refused, append-only journal row) and
 * every refund through mjt-rewards.refundCredit() (a compensating, append-only credit; allowed on a frozen wallet).
 *
 * Catalog (migration 091 mjt_services). A service maps to ONE real capability, through a handler:
 *   feature  a membership feature key that exists in services/ai.js FEATURES and has a real gate in the code. Wired:
 *            studio_extended — Creator Studio analytics beyond 90 days (studio.js /api/studio/overview, days > 90).
 *   course   an existing course whose access is already 'product' (paid; services/courses.js). Free courses stay free and
 *            cannot be registered. Registering an item is an admin action; delivery = enrolment in the course.
 * Nothing else is wired (see CHANGELOG / report for the areas left out and why).
 *
 * access_mode   free     everyone has it, nothing is ever debited
 *               plus     included in Plus only (not purchasable)
 *               mjt      purchasable with MJT by `eligible` (all | plus) members
 *               plus_mjt included in Plus; other members may buy it with MJT
 * Every service ships DISABLED with cost NULL and term NULL (unset). The admin sets cost, term (permanent | days + duration)
 * and enables it; enabling an MJT-purchasable service without a cost or term is refused. No price is hard-coded anywhere.
 *
 * Price versions: every change of cost / term / duration bumps price_version and appends a mjt_service_prices row. The member's
 * client sends { priceVersion, ikey } only — any amount / cost / price field is rejected (400 amount_not_accepted); a stale
 * version is rejected (409 price_changed, with the current version); the server reads the cost itself. A purchase stores the
 * version, cost and term the member confirmed; later changes affect future purchases only.
 *
 * Purchase (one DB transaction): lock wallet → idempotency → guard (service still enabled, same price version, member does
 * not already own an active entitlement for the target) → debit (ledger + journal) → purchase row + entitlement row. Any
 * failure rolls everything back: there is never a debit without a purchase + entitlement, nor an entitlement without a debit.
 * Before debiting, the server answers «لديك وصول بالفعل» (alreadyHasAccess, no debit) when the member already has the
 * capability: owned unexpired entitlement, free mode, Plus-included mode for a Plus member, or native access (a Plus feature
 * the member's plan already includes; a course the member already bought in the digital store, or teaches).
 *
 * REFUND POLICY (documented in CHANGELOG and shown to admins):
 *   1. Atomic purchase — if anything fails before commit, nothing is debited (no refund needed).
 *   2. Delivery after commit (course enrolment) fails → automatic FULL refund of the confirmed amount as a compensating
 *      credit (ikey svcrefund:<purchase>, idempotent), purchase → refunded, entitlement → revoked, audit row. The member is told.
 *   3. Manual refund — admin only, mandatory written reason (≥ 5 chars), full confirmed amount, once per purchase, revokes the
 *      entitlement, audited (mjt_audit + hash-chained audit). No partial refunds, no member self-refund (not approved).
 *   4. Disabling a service or changing its price never refunds or revokes what members already own; natural expiry of a
 *      time-limited entitlement is not refunded.
 * Journal / ledger rows are never updated or deleted; only the purchase status and the entitlement status change.
 *
 * Member API (rate-limited, never accepts an amount): GET /api/mjt/services, POST /api/mjt/services/:id/purchase,
 * GET /api/mjt/services/mine, GET /api/mjt/services/history.
 * Admin API (admin only — 403 otherwise; rate-limited): /api/admin/mjt/services[...] — catalog + stats, candidates,
 * register, edit (new price version), enable / disable, purchases, manual refund. */
const crypto = require("node:crypto");
const { E, HttpError, str } = require("../lib/core");
const { UNIT, format } = require("../lib/mjt-ledger");

const DAY = 864e5;
const IKEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const MODES = ["free", "plus", "mjt", "plus_mjt"];
const MODE_AR = { free: "مجانية للجميع", plus: "ضمن Plus", mjt: "بمجتمع كوين", plus_mjt: "ضمن Plus أو بمجتمع كوين" };
const REASON_AR = { owned: "تملك هذه الخدمة بالفعل", free: "هذه الخدمة مجانية للجميع", plus_included: "مشمولة في عضوية Plus", native: "لديك وصول بالفعل" };
/* feature services: only membership features with a real server-side gate. translate / assistant are NOT here — they are metered
 * against the Plus plan's monthly AI caps and cost real AI spend; unlocking them with MJT needs a plan-limit decision first. */
const FEATURES = { studio_extended: { title: "تحليلات الاستوديو الممتدة", benefit: "تحليلات استوديو المنشئ لفترات أطول (180 و365 يوماً بدل 90).", href: "#/studio" } };
const NOTE = "مجتمع كوين (MJT) رصيد مكافآت داخلي فقط: ليس له قيمة نقدية، ولا يُسحب ولا يُباع ولا يُحوَّل.";
const FORBIDDEN_BODY = ["amount", "cost", "price", "units", "total", "mjt"];

/** @param {any} ctx @param {{ now?: () => Date|number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const fail = (status, code, msg, details) => Object.assign(new HttpError(status, msg, code), details ? { details } : {});
  const RW = () => ctx.services.mjtRewards;
  const M = () => ctx.services.membership;
  const uuid = () => crypto.randomUUID();
  const int = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const member = (lim, fn) => A(async (req, res) => { if (!rl.hit(lim, req.user.id)) throw E.rate(); return fn(req, res); });
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); if (!rl.hit("mjt_admin", req.user.id)) throw E.rate(); return fn(req, res); });
  const audit = (q, action, actor, target, txId, detail) => q.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)", [action, actor || null, target || null, txId || null, JSON.stringify(detail || {}), nowIso()]);
  const wholeMjt = (v, max = 100000) => { const s = String(v ?? "").trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))); if (!/^\d{1,6}$/.test(s) || +s < 1 || +s > max) throw fail(400, "bad_amount", `التكلفة عدد صحيح من 1 إلى ${max}`); return +s * UNIT; };
  const targetKey = (s) => `${s.kind}:${s.target}`;
  const purchasable = (mode) => mode === "mjt" || mode === "plus_mjt";

  /* ---------- handlers: one per kind of REAL capability ---------- */
  const courses = () => ctx.services.courses;
  const H = {
    feature: {
      async validate(target) { if (!FEATURES[target]) throw fail(400, "not_wireable", "هذه الميزة غير قابلة للربط بخدمات MJT"); return { title: FEATURES[target].title, benefit: FEATURES[target].benefit }; },
      async view(user, s) { return { href: FEATURES[s.target]?.href || null, available: !!FEATURES[s.target] }; },
      async native(user, s) { return M().can(user.id, s.target); },
      async precheck() { /* the entitlement itself is the delivery */ },
      async deliver() { /* nothing outside the transaction */ }
    },
    course: {
      async validate(target) {
        const c = await db.get("SELECT id, title, subtitle, access, status FROM courses WHERE id=$1 AND status<>'deleted'", [String(target || "")]);
        if (!c) throw fail(404, "not_found", "الدورة غير موجودة");
        if (c.access !== "product") throw fail(400, "not_premium", "الدورات المجانية تبقى مجانية — يمكن ربط الدورات المدفوعة فقط");
        return { title: c.title, benefit: c.subtitle ? `وصول إلى دورة «${c.title}»: ${c.subtitle}` : `وصول كامل إلى دورة «${c.title}» ودروسها.` };
      },
      async view(user, s) {
        try { const d = await courses().detail(user, s.target); return { href: `#/course/${s.target}`, available: d.course.status === "published" && d.course.access === "product", locked: !!d.me.locked, manager: !!d.me.manager }; }
        catch { return { href: null, available: false }; }
      },
      async native(user, s) {
        const c = await db.get("SELECT listing_id FROM courses WHERE id=$1", [s.target]);
        if (c?.listing_id && await db.get("SELECT e.id FROM digital_entitlements e JOIN market_orders o ON o.id=e.order_id WHERE e.buyer_id=$1 AND e.listing_id=$2 AND e.status='active' AND o.status NOT IN ('refunded','cancelled')", [user.id, c.listing_id]).catch(() => null)) return true;
        const v = await H.course.view(user, s); return !!v.manager;
      },
      async precheck(user, s) { const v = await H.course.view(user, s); if (!v.available) throw fail(409, "not_available", "هذه الدورة غير متاحة لك الآن"); },
      async deliver(user, s) { await courses().enrol(user, s.target); }
    }
  };

  /* ---------- seed: only real capabilities, disabled, no cost, no term ---------- */
  async function ensureSeed() {
    const at = nowIso();
    for (const [key, f] of Object.entries(FEATURES)) {
      const r = await db.run("INSERT INTO mjt_services(id,key,kind,target,title,benefit,access_mode,eligible,cost,term,duration_days,price_version,enabled,created_by,updated_by,created_at,updated_at) VALUES($1,$2,'feature',$3,$4,$5,'plus_mjt','all',NULL,NULL,NULL,1,0,'system','system',$6,$6) ON CONFLICT DO NOTHING", ["svc_" + key, key, key, f.title, f.benefit, at]);
      if (r.changes) await db.run("INSERT INTO mjt_service_prices(service_id,version,cost,term,duration_days,set_by,created_at) VALUES($1,1,NULL,NULL,NULL,'system',$2) ON CONFLICT DO NOTHING", ["svc_" + key, at]);
    }
  }

  /* ---------- reads ---------- */
  const load = async (q, sid) => (await q.get("SELECT * FROM mjt_services WHERE id=$1 OR key=$1", [String(sid || "")])) || null;
  const activeEnt = (q, uid, tkey) => q.get("SELECT * FROM mjt_entitlements WHERE user_id=$1 AND target_key=$2 AND status='active' AND (expires_at IS NULL OR expires_at > $3) ORDER BY created_at DESC LIMIT 1", [uid, tkey, nowIso()]);
  /** does `uid` reach target 'kind:target' through MJT services? (an owned unexpired entitlement — kept even if the service is
   *  later disabled — or an ENABLED service in free mode, or Plus-included mode for a Plus member). Used by the wired gates. */
  async function allows(uid, tkey) {
    if (!uid || !tkey) return false;
    if (await activeEnt(db, uid, tkey)) return true;
    const i = tkey.indexOf(":"), s = await db.get("SELECT * FROM mjt_services WHERE kind=$1 AND target=$2", [tkey.slice(0, i), tkey.slice(i + 1)]);
    if (!s || !Number(s.enabled)) return false;
    if (s.access_mode === "free") return true;
    if ((s.access_mode === "plus" || s.access_mode === "plus_mjt") && await M().isPlus(uid)) return true;
    return false;
  }
  /** why the member already has access (→ no debit), or null */
  async function accessReason(user, s) {
    if (await activeEnt(db, user.id, targetKey(s))) return "owned";
    if (Number(s.enabled) && s.access_mode === "free") return "free";
    if (Number(s.enabled) && (s.access_mode === "plus" || s.access_mode === "plus_mjt") && await M().isPlus(user.id)) return "plus_included";
    if (await H[s.kind].native(user, s)) return "native";
    return null;
  }
  const termText = (term, days) => (term === "permanent" ? "دائم" : term === "days" && days ? `لمدة ${days} يوماً` : "غير محدد");
  const svcAdmin = (s, st = {}) => ({ id: s.id, key: s.key, kind: s.kind, target: s.target, title: s.title, benefit: s.benefit || "", accessMode: s.access_mode, accessModeLabel: MODE_AR[s.access_mode], eligible: s.eligible,
    cost: s.cost === null || s.cost === undefined ? null : format(s.cost), term: s.term || null, durationDays: s.duration_days === null || s.duration_days === undefined ? null : Number(s.duration_days), termLabel: termText(s.term, s.duration_days),
    priceVersion: Number(s.price_version), enabled: !!Number(s.enabled), updatedAt: s.updated_at, createdAt: s.created_at,
    usage: { purchases: Number(st.n || 0), active: Number(st.act || 0), refunded: Number(st.ref || 0), spent: format(Number(st.spent || 0)) } });

  async function wallet(uid) {
    const w = await RW().walletOf(uid, { create: true });
    return { balance: w.balance, frozen: w.frozen, status: w.status };
  }
  async function memberList(user) {
    const rows = await db.all("SELECT * FROM mjt_services WHERE enabled=1 ORDER BY created_at, id");
    const isPlus = await M().isPlus(user.id);
    const out = [];
    for (const s of rows) {
      const v = await H[s.kind].view(user, s);
      if (!v.available) continue;
      const reason = await accessReason(user, s);
      const ent = reason === "owned" ? await activeEnt(db, user.id, targetKey(s)) : null;
      const needsPlus = !reason && (s.access_mode === "plus" || (s.access_mode === "mjt" && s.eligible === "plus" && !isPlus));
      out.push({ id: s.id, key: s.key, kind: s.kind, title: s.title, benefit: s.benefit || "", href: v.href, accessMode: s.access_mode, accessModeLabel: MODE_AR[s.access_mode],
        cost: purchasable(s.access_mode) && s.cost !== null && s.cost !== undefined ? format(s.cost) : null, priceVersion: Number(s.price_version), term: s.term || null, durationDays: s.duration_days === null || s.duration_days === undefined ? null : Number(s.duration_days), termLabel: termText(s.term, s.duration_days),
        hasAccess: !!reason, accessReason: reason, accessReasonLabel: reason ? REASON_AR[reason] : null, expiresAt: ent?.expires_at || null,
        canBuy: !reason && !needsPlus && purchasable(s.access_mode) && s.cost !== null && s.cost !== undefined && !!s.term, needsPlus });
    }
    return { services: out, wallet: await wallet(user.id), plus: isPlus, note: NOTE };
  }
  async function mine(user) {
    const rows = await db.all("SELECT e.*, s.title, s.kind, s.target, s.key, p.cost, p.price_version, p.term, p.duration_days FROM mjt_entitlements e JOIN mjt_services s ON s.id=e.service_id LEFT JOIN mjt_service_purchases p ON p.id=e.purchase_id WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT 100", [user.id]);
    const at = nowIso();
    return { items: await Promise.all(rows.map(async (r) => {
      const state = r.status !== "active" ? "revoked" : r.expires_at && r.expires_at <= at ? "expired" : "active";
      const v = await H[r.kind].view(user, { kind: r.kind, target: r.target });
      return { id: r.id, serviceId: r.service_id, title: r.title, href: v.href, startsAt: r.starts_at, expiresAt: r.expires_at || null, permanent: !r.expires_at, state, stateLabel: { active: "فعّالة", expired: "انتهت", revoked: "أُلغيت (مستردة)" }[state],
        cost: r.cost === null || r.cost === undefined ? null : format(r.cost), priceVersion: r.price_version === null || r.price_version === undefined ? null : Number(r.price_version) };
    })) };
  }
  const purchaseClient = (p) => ({ id: p.id, serviceId: p.service_id, title: p.title || null, handle: p.handle || undefined, cost: format(p.cost), priceVersion: Number(p.price_version), term: p.term, durationDays: p.duration_days === null || p.duration_days === undefined ? null : Number(p.duration_days), termLabel: termText(p.term, p.duration_days),
    status: p.status, statusLabel: p.status === "refunded" ? "مستردة" : "مكتملة", refundReason: p.refund_reason || null, refundedAt: p.refunded_at || null, txId: p.tx_id || null, createdAt: p.created_at });
  async function history(user, q = {}) {
    const lim = int(q.limit, 30, 1, 100), args = [user.id]; let w = "p.user_id=$1";
    if (q.cursor) { args.push(String(q.cursor).slice(0, 40)); w += " AND p.created_at < $2"; }
    const rows = await db.all(`SELECT p.*, s.title FROM mjt_service_purchases p JOIN mjt_services s ON s.id=p.service_id WHERE ${w} ORDER BY p.created_at DESC, p.id DESC LIMIT ${lim + 1}`, args);
    return { items: rows.slice(0, lim).map(purchaseClient), next: rows.length > lim ? rows[lim - 1].created_at : null };
  }

  /* ---------- purchase ---------- */
  async function purchase(user, sid, b = {}) {
    for (const k of FORBIDDEN_BODY) if (Object.prototype.hasOwnProperty.call(b, k)) throw fail(400, "amount_not_accepted", "لا يُقبل مبلغ من الطلب — التكلفة يحددها الخادم");
    const s = await load(db, sid); if (!s) throw E.nf("الخدمة غير موجودة");
    if (!Number(s.enabled)) throw fail(409, "service_disabled", "هذه الخدمة غير متاحة حالياً");
    const pv = Number(b.priceVersion);
    if (!Number.isSafeInteger(pv) || pv < 1) throw fail(400, "price_version_required", "أعد تحميل الصفحة لتأكيد السعر الحالي");
    if (pv !== Number(s.price_version)) throw fail(409, "price_changed", "تغيّرت تكلفة الخدمة — راجع السعر الجديد ثم أكّد", { current: { priceVersion: Number(s.price_version), cost: s.cost === null ? null : format(s.cost) } });
    const ikeyIn = String(b.ikey || ""); if (!IKEY_RE.test(ikeyIn)) throw fail(400, "ikey_required", "مفتاح العملية مطلوب");
    const prior = await db.get("SELECT p.*, s.title FROM mjt_service_purchases p JOIN mjt_services s ON s.id=p.service_id WHERE p.user_id=$1 AND p.idempotency_key=$2", [user.id, ikeyIn]);
    if (prior) { if (prior.service_id !== s.id) throw fail(409, "ikey_reused", "مفتاح العملية مستخدم لعملية أخرى"); return { purchased: true, replayed: true, purchase: purchaseClient(prior), wallet: await wallet(user.id) }; }
    const reason = await accessReason(user, s);
    if (reason) return { purchased: false, alreadyHasAccess: true, reason, message: REASON_AR[reason], wallet: await wallet(user.id) };
    if (s.access_mode === "plus") throw fail(402, "plus_required", "هذه الخدمة مشمولة في عضوية Plus فقط");
    if (s.access_mode === "mjt" && s.eligible === "plus" && !(await M().isPlus(user.id))) throw fail(402, "plus_required", "شراء هذه الخدمة متاح لأعضاء Plus فقط");
    if (s.cost === null || s.cost === undefined || !s.term) throw fail(409, "service_disabled", "هذه الخدمة غير متاحة حالياً");
    await H[s.kind].precheck(user, s);
    const tkey = targetKey(s);
    const r = await RW().debit(user.id, { amount: Number(s.cost), source: "service:" + s.key, ref: s.id, reason: s.title, ikey: `svc:${user.id}:${ikeyIn}`,
      guard: async (t) => {
        const cur = await t.get("SELECT enabled, price_version FROM mjt_services WHERE id=$1", [s.id]);
        if (!cur || !Number(cur.enabled)) return { skip: "service_disabled" };
        if (Number(cur.price_version) !== pv) return { skip: "price_changed" };
        if (await activeEnt(t, user.id, tkey)) return { skip: "owned" };
        return null;
      },
      after: async (t, entry) => {
        const at = entry.created_at, pid = uuid();
        const exp = s.term === "days" ? new Date(Date.parse(at) + Number(s.duration_days) * DAY).toISOString() : null;
        await t.run("INSERT INTO mjt_service_purchases(id,service_id,user_id,price_version,cost,term,duration_days,status,idempotency_key,entry_id,tx_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11)",
          [pid, s.id, user.id, pv, Number(s.cost), s.term, s.term === "days" ? Number(s.duration_days) : null, ikeyIn, entry.id, entry.tx_id, at]);
        await t.run("INSERT INTO mjt_entitlements(id,user_id,service_id,target_key,purchase_id,starts_at,expires_at,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$6)", [uuid(), user.id, s.id, tkey, pid, at, exp]);
        await audit(t, "service_purchase", user.id, user.id, entry.tx_id, { service: s.id, key: s.key, purchase: pid, priceVersion: pv, cost: format(s.cost), term: s.term, expiresAt: exp });
        if (opts.faultAfterGrant) await opts.faultAfterGrant(s); // tests: prove a failure here rolls the debit back
        return pid;
      } });
    if (r.skipped) {
      if (r.skipped === "owned") return { purchased: false, alreadyHasAccess: true, reason: "owned", message: REASON_AR.owned, wallet: await wallet(user.id) };
      if (r.skipped === "price_changed") { const c = await load(db, s.id); throw fail(409, "price_changed", "تغيّرت تكلفة الخدمة — راجع السعر الجديد ثم أكّد", { current: { priceVersion: Number(c.price_version), cost: c.cost === null ? null : format(c.cost) } }); }
      throw fail(409, "service_disabled", "هذه الخدمة غير متاحة حالياً");
    }
    const p = await db.get("SELECT p.*, s.title FROM mjt_service_purchases p JOIN mjt_services s ON s.id=p.service_id WHERE p.user_id=$1 AND p.idempotency_key=$2", [user.id, ikeyIn]);
    if (r.replayed) return { purchased: true, replayed: true, purchase: p ? purchaseClient(p) : null, wallet: await wallet(user.id) };
    ctx.audit?.("mjt_service_purchase", s.id, JSON.stringify({ purchase: p.id, cost: format(s.cost), v: pv }), user.id);
    /* delivery outside the transaction (course enrolment). On failure: automatic full refund (policy 2). */
    try { await H[s.kind].deliver(user, s); }
    catch (err) {
      logger.warn?.("mjt service delivery failed — refunding", { purchase: p.id, err: err?.message });
      try { await refund(null, p.id, { reason: "تعذّر تسليم الخدمة: " + String(err?.message || "خطأ").slice(0, 200), auto: true }); }
      catch (e2) { logger.error?.("mjt service auto-refund failed", { purchase: p.id, err: e2?.message }); await audit(db, "service_refund_failed", null, user.id, p.tx_id, { purchase: p.id, err: String(e2?.message || "") }).catch(() => {}); }
      throw fail(409, "delivery_failed_refunded", "تعذّر تسليم الخدمة، وأُعيد المبلغ كاملاً إلى رصيدك", { refunded: true, wallet: await wallet(user.id) });
    }
    const fresh = await db.get("SELECT p.*, s.title FROM mjt_service_purchases p JOIN mjt_services s ON s.id=p.service_id WHERE p.id=$1", [p.id]);
    const ent = await db.get("SELECT expires_at FROM mjt_entitlements WHERE purchase_id=$1", [p.id]);
    return { purchased: true, purchase: purchaseClient(fresh), expiresAt: ent?.expires_at || null, balanceAfter: format(r.entry.balance_after), wallet: await wallet(user.id) };
  }

  /* ---------- refunds (auto: policy 2; manual: policy 3) ---------- */
  async function refund(actor, pid, { reason, auto = false } = {}) {
    const why = auto ? String(reason || "").slice(0, 300) : str(reason, 300, { required: true, min: 5 });
    if (!auto && (!why || why.length < 5)) throw fail(400, "reason_required", "اكتب سبب الاسترداد (5 أحرف على الأقل)");
    const p = await db.get("SELECT p.*, s.title, s.key FROM mjt_service_purchases p JOIN mjt_services s ON s.id=p.service_id WHERE p.id=$1", [String(pid || "")]);
    if (!p) throw E.nf("عملية الشراء غير موجودة");
    if (p.status === "refunded") throw fail(409, "already_refunded", "سبق استرداد هذه العملية");
    const r = await RW().refundCredit(p.user_id, { amount: Number(p.cost), ref: p.id, reason: `استرداد «${p.title}» — ${why}`, ikey: "svcrefund:" + p.id, actorId: actor?.id || null,
      after: async (t, e) => {
        const u = await t.run("UPDATE mjt_service_purchases SET status='refunded', refund_entry_id=$1, refund_reason=$2, refunded_by=$3, refunded_at=$4 WHERE id=$5 AND status='active'", [e.id, why, actor?.id || "system", e.created_at, p.id]);
        if (!u.changes) throw fail(409, "already_refunded", "سبق استرداد هذه العملية");
        await t.run("UPDATE mjt_entitlements SET status='revoked', revoked_at=$1 WHERE purchase_id=$2 AND status='active'", [e.created_at, p.id]);
        await audit(t, auto ? "service_refund_auto" : "service_refund", actor?.id || null, p.user_id, e.tx_id, { purchase: p.id, service: p.service_id, amount: format(p.cost), reason: why });
      } });
    if (r.replayed) throw fail(409, "already_refunded", "سبق استرداد هذه العملية");
    ctx.audit?.(auto ? "mjt_service_refund_auto" : "mjt_service_refund", p.id, `${format(p.cost)} MJT: ${why}`, actor?.id || "system");
    const fresh = await db.get("SELECT p.*, s.title FROM mjt_service_purchases p JOIN mjt_services s ON s.id=p.service_id WHERE p.id=$1", [p.id]);
    return { purchase: purchaseClient(fresh), refundEntryId: r.entry?.id || null };
  }

  /* ---------- admin ---------- */
  const statsSql = "SELECT service_id, COUNT(*) n, COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) act, COALESCE(SUM(CASE WHEN status='refunded' THEN 1 ELSE 0 END),0) ref, COALESCE(SUM(CASE WHEN status='active' THEN cost ELSE 0 END),0) spent FROM mjt_service_purchases";
  async function adminList() {
    const rows = await db.all("SELECT * FROM mjt_services ORDER BY created_at, id");
    const st = new Map((await db.all(statsSql + " GROUP BY service_id")).map((x) => [x.service_id, x]));
    const registered = new Set(rows.filter((s) => s.kind === "feature").map((s) => s.target));
    return { services: rows.map((s) => svcAdmin(s, st.get(s.id))), candidates: { features: Object.entries(FEATURES).filter(([k]) => !registered.has(k)).map(([k, f]) => ({ kind: "feature", target: k, title: f.title })) },
      modes: MODES.map((m) => ({ key: m, label: MODE_AR[m] })), note: NOTE,
      policy: ["الشراء ذرّي: الخصم والتسجيل والصلاحية في عملية واحدة — أي فشل يلغي كل شيء دون خصم.", "إذا فشل التسليم بعد الخصم (مثل التسجيل في الدورة) يُسترد المبلغ كاملاً تلقائياً بقيد تعويضي وتُلغى الصلاحية.", "الاسترداد اليدوي للإدارة فقط، بالمبلغ الكامل المؤكد، مرة واحدة، مع سبب مكتوب إلزامي، ويُسجَّل.", "تعطيل الخدمة أو تغيير سعرها لا يلغي ما يملكه الأعضاء ولا يسترده؛ انتهاء المدة لا يُسترد."] };
  }
  async function candidates(q = {}) {
    if (q.kind !== "course") return { items: [] };
    const term = String(q.q || "").trim().slice(0, 60), args = [];
    let w = "c.access='product' AND c.status<>'deleted' AND NOT EXISTS (SELECT 1 FROM mjt_services s WHERE s.kind='course' AND s.target=c.id)";
    if (term) { args.push("%" + term.toLowerCase() + "%"); w += " AND LOWER(c.title) LIKE $1"; }
    const rows = await db.all(`SELECT c.id, c.title, c.status, u.handle author FROM courses c LEFT JOIN users u ON u.id=c.author WHERE ${w} ORDER BY c.updated_at DESC LIMIT 30`, args);
    return { items: rows.map((c) => ({ kind: "course", target: c.id, title: c.title, status: c.status, author: c.author || null })) };
  }
  function readMode(b, cur) {
    const mode = b.accessMode !== undefined ? String(b.accessMode) : cur?.access_mode || "mjt";
    if (!MODES.includes(mode)) throw fail(400, "bad_mode", "نوع الإتاحة غير صالح");
    const eligible = b.eligible !== undefined ? String(b.eligible) : cur?.eligible || "all";
    if (!["all", "plus"].includes(eligible)) throw fail(400, "bad_eligible", "العضويات المؤهلة غير صالحة");
    return { mode, eligible };
  }
  async function register(user, b = {}) {
    const kind = String(b.kind || ""); if (!H[kind]) throw fail(400, "bad_kind", "نوع الخدمة غير صالح");
    const target = String(b.target || "").slice(0, 80);
    const info = await H[kind].validate(target);
    if (await db.get("SELECT id FROM mjt_services WHERE kind=$1 AND target=$2", [kind, target])) throw fail(409, "exists", "هذا العنصر مسجّل في الكتالوج بالفعل");
    const { mode, eligible } = readMode(b, null);
    const sid = "svc_" + uuid().replace(/-/g, "").slice(0, 16), key = kind === "feature" ? target : `course_${target}`.slice(0, 80), at = nowIso();
    await db.tx(async (t) => {
      await t.run("INSERT INTO mjt_services(id,key,kind,target,title,benefit,access_mode,eligible,cost,term,duration_days,price_version,enabled,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL,1,0,$9,$9,$10,$10)",
        [sid, key, kind, target, str(b.title, 80) || info.title, str(b.benefit, 300) || info.benefit, mode, eligible, user.id, at]);
      await t.run("INSERT INTO mjt_service_prices(service_id,version,cost,term,duration_days,set_by,created_at) VALUES($1,1,NULL,NULL,NULL,$2,$3)", [sid, user.id, at]);
      await audit(t, "service_registered", user.id, sid, null, { kind, target, mode, eligible });
    });
    ctx.audit?.("mjt_service_registered", sid, `${kind}:${target}`, user.id);
    return { service: svcAdmin(await load(db, sid)) };
  }
  async function edit(user, sid, b = {}) {
    const cur = await load(db, sid); if (!cur) throw E.nf("الخدمة غير موجودة");
    const { mode, eligible } = readMode(b, cur);
    const cost = b.cost !== undefined ? (b.cost === null || b.cost === "" ? null : wholeMjt(b.cost)) : cur.cost === null || cur.cost === undefined ? null : Number(cur.cost);
    const term = b.term !== undefined ? (b.term === null || b.term === "" ? null : String(b.term)) : cur.term || null;
    if (term !== null && !["permanent", "days"].includes(term)) throw fail(400, "bad_term", "اختر دائماً أو مدة بالأيام");
    let days = b.durationDays !== undefined ? (b.durationDays === null || b.durationDays === "" ? null : int(b.durationDays, NaN, -1, 3650)) : cur.duration_days === null || cur.duration_days === undefined ? null : Number(cur.duration_days);
    if (Number.isNaN(days) || (days !== null && days < 1)) throw fail(400, "bad_duration", "المدة عدد أيام صحيح من 1 إلى 3650");
    if (term === "permanent") days = null;
    if (term === "days" && !days) throw fail(400, "duration_required", "حدّد عدد الأيام للخدمة المؤقتة");
    const enabled = b.enabled !== undefined ? (b.enabled ? 1 : 0) : Number(cur.enabled);
    if (enabled && purchasable(mode) && (cost === null || !term)) throw fail(400, "cost_required", "حدّد التكلفة ونوع المدة قبل تفعيل خدمة تُشترى بمجتمع كوين");
    const title = b.title !== undefined ? str(b.title, 80, { required: true, min: 2 }) : cur.title;
    const benefit = b.benefit !== undefined ? str(b.benefit, 300) : cur.benefit;
    const priceChanged = cost !== (cur.cost === null || cur.cost === undefined ? null : Number(cur.cost)) || term !== (cur.term || null) || days !== (cur.duration_days === null || cur.duration_days === undefined ? null : Number(cur.duration_days));
    const at = nowIso(), version = Number(cur.price_version) + (priceChanged ? 1 : 0);
    await db.tx(async (t) => {
      await t.run("UPDATE mjt_services SET title=$2, benefit=$3, access_mode=$4, eligible=$5, cost=$6, term=$7, duration_days=$8, price_version=$9, enabled=$10, updated_by=$11, updated_at=$12 WHERE id=$1", [cur.id, title, benefit, mode, eligible, cost, term, days, version, enabled, user.id, at]);
      if (priceChanged) await t.run("INSERT INTO mjt_service_prices(service_id,version,cost,term,duration_days,set_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [cur.id, version, cost, term, days, user.id, at]);
      await audit(t, priceChanged ? "service_price_changed" : "service_saved", user.id, cur.id, null, { before: svcAdmin(cur), after: { mode, eligible, cost: cost === null ? null : format(cost), term, durationDays: days, priceVersion: version, enabled: !!enabled } });
    });
    ctx.audit?.("mjt_service_saved", cur.id, JSON.stringify({ enabled: !!enabled, cost: cost === null ? null : format(cost), v: version }), user.id);
    return { service: svcAdmin(await load(db, cur.id), await db.get(statsSql + " WHERE service_id=$1 GROUP BY service_id", [cur.id])) };
  }
  async function detail(sid) {
    const s = await load(db, sid); if (!s) throw E.nf("الخدمة غير موجودة");
    const prices = await db.all("SELECT * FROM mjt_service_prices WHERE service_id=$1 ORDER BY version DESC LIMIT 50", [s.id]);
    const log = await db.all("SELECT action, actor_id, detail, created_at FROM mjt_audit WHERE target=$1 AND action LIKE 'service_%' ORDER BY id DESC LIMIT 30", [s.id]);
    return { service: svcAdmin(s, await db.get(statsSql + " WHERE service_id=$1 GROUP BY service_id", [s.id])),
      prices: prices.map((p) => ({ version: Number(p.version), cost: p.cost === null || p.cost === undefined ? null : format(p.cost), term: p.term || null, durationDays: p.duration_days === null || p.duration_days === undefined ? null : Number(p.duration_days), at: p.created_at })),
      audit: log.map((x) => ({ action: x.action, detail: parse(x.detail, {}), at: x.created_at })) };
  }
  async function purchases(q = {}) {
    const w = [], a = []; const add = (sql, v) => { a.push(v); w.push(sql.replace("?", "$" + a.length)); };
    if (q.service) add("p.service_id = ?", String(q.service).slice(0, 60));
    if (["active", "refunded"].includes(q.status)) add("p.status = ?", q.status);
    if (q.handle) { const u = await db.get("SELECT id FROM users WHERE LOWER(handle)=LOWER($1)", [String(q.handle).replace(/^@/, "").slice(0, 60)]); if (!u) return { items: [], next: null }; add("p.user_id = ?", u.id); }
    if (q.cursor) add("p.created_at < ?", String(q.cursor).slice(0, 40));
    const lim = int(q.limit, 30, 1, 100);
    const rows = await db.all(`SELECT p.*, s.title, u.handle FROM mjt_service_purchases p JOIN mjt_services s ON s.id=p.service_id LEFT JOIN users u ON u.id=p.user_id ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY p.created_at DESC, p.id DESC LIMIT ${lim + 1}`, a);
    return { items: rows.slice(0, lim).map(purchaseClient), next: rows.length > lim ? rows[lim - 1].created_at : null };
  }

  /* ---------- routes ---------- */
  R.get("/api/mjt/services", member("mjt_wallet", async (req) => memberList(req.user)));
  R.get("/api/mjt/services/mine", member("mjt_wallet", async (req) => mine(req.user)));
  R.get("/api/mjt/services/history", member("mjt_wallet", async (req) => history(req.user, req.query)));
  R.post("/api/mjt/services/:id/purchase", member("mjt_services", async (req) => purchase(req.user, req.params.id, req.body || {})));
  R.get("/api/admin/mjt/services", admin(async () => adminList()));
  R.get("/api/admin/mjt/services/candidates", admin(async (req) => candidates(req.query)));
  R.get("/api/admin/mjt/services/purchases", admin(async (req) => purchases(req.query)));
  R.post("/api/admin/mjt/services/purchases/:pid/refund", admin(async (req) => refund(req.user, req.params.pid, { reason: req.body?.reason })));
  R.post("/api/admin/mjt/services", admin(async (req) => register(req.user, req.body || {})));
  R.get("/api/admin/mjt/services/:id", admin(async (req) => detail(req.params.id)));
  R.put("/api/admin/mjt/services/:id", admin(async (req) => edit(req.user, req.params.id, req.body || {})));

  const ready = ensureSeed().catch((e) => logger.error?.("mjt services init failed", { err: e?.message }));
  return { ready, FEATURES, MODES, NOTE, H, allows, accessReason, purchase, refund, register, edit, memberList, mine, history, adminList };
};
