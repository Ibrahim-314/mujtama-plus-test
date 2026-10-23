/* AI subscriptions & entitlements — «مجتمع+ ذكاء» (phase 41, generic for phase 42+). Contract: docs/integration/p41-contract.md.
 * • Plans bundle feature keys (`translate` now; `assistant` and later AI systems just add keys). Monthly period (AI_PERIOD_DAYS).
 *   Price is never hard-coded: AI_PLAN_PRICE seeds it, an admin edits it (price_set_by=admin wins over env); no price → 409 price_unset.
 * • Subscribe = one Pi payment per period (purpose `ai`) through ctx.services.pi.createIntent; effects only on bus events
 *   PI_PAYMENT_COMPLETED / CANCELLED / REFUNDED. Renewing early extends from the current end. Cancel = no renewal, access to the end.
 * • Ledger (lib/ledger.js): `user:<id>:pi_out` → `platform:ai` (source ai); refunds post the reversing journal and cut the period.
 * • Staff grants (no money), leased job ai.maintain: renewal reminder 3 days before the end (once per period), expiry.
 * • Metering: meter(uid, feature, {chars, costMicros, cached, provider}) → ai_usage (user's own) + ai_period_stats (operator, no ids);
 *   caps per plan.limits[feature] (chars, costUsd) with env defaults; a global monthly provider budget (AI_PROVIDER_MONTHLY_USD).
 * • Minors cannot buy (403 minor_restricted), like tips/paid/ads. Pi off → 409 not_configured «مدفوعات Pi غير مفعّلة بعد». */
const { E, HttpError, id } = require("../lib/core");
const { toUnits, pi, ACC, createLedger } = require("../lib/ledger");

const DAY = 864e5;
const OFF = "مدفوعات Pi غير مفعّلة بعد";
const PLATFORM = "platform:ai";
const FEATURES = { translate: "ترجمة آلية للمنشورات والتعليقات والرسائل", assistant: "المساعد الذكي: صياغة وردود مهذبة وأسئلة وبحث بالمعنى" };
const DEFAULT_PLAN = { slug: "ai_plus", name: "مجتمع+ ذكاء", features: ["translate"] };

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const periodOf = (d = clock()) => new Date(d).toISOString().slice(0, 7);
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  const fail = (status, code, msg, details) => Object.assign(new HttpError(status, msg, code), details ? { details } : {});
  const cfg = {
    periodDays: Math.max(1, Math.floor(num("AI_PERIOD_DAYS", 30))),
    remindDays: num("AI_REMIND_DAYS", 3),
    translateChars: Math.floor(num("AI_TRANSLATE_MONTHLY_CHARS", 200000)),
    translateUsd: num("AI_TRANSLATE_MONTHLY_USD", 0.5),
    budgetUsd: num("AI_PROVIDER_MONTHLY_USD", 5),
    piUsd: env.AI_PI_USD_RATE ? num("AI_PI_USD_RATE", 0) || null : null,
    envPrice: env.AI_PLAN_PRICE !== undefined && env.AI_PLAN_PRICE !== "" && Number(env.AI_PLAN_PRICE) > 0 ? toUnits(Number(env.AI_PLAN_PRICE)) : null
  };
  const { postJournal } = createLedger({ now: nowIso });
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { const x = JSON.parse(v); return x ?? d; } catch { return d; } };
  const ms = (v) => (v == null ? NaN : new Date(v).getTime());
  const iso = (v) => (v == null ? null : typeof v === "string" ? v : new Date(v).toISOString());
  const piSvc = () => ctx.services.pi;
  const piOn = () => !!piSvc()?.enabled?.();
  const notify = (uid, kind, o) => ctx.services.notify?.notify?.(uid, kind, o)?.catch?.((e) => logger.warn?.("ai notify failed", { kind, err: e.message }));
  const audit = (action, target, reason, by) => { try { ctx.audit?.(action, target, reason, by); } catch { /* best effort */ } };
  async function isMinor(uid) {
    const m = ctx.services.minors;
    if (!uid || !m?.isMinorUser) return false;
    try { return !!(await m.isMinorUser(uid)); } catch { return false; }
  }

  /* ======================= plans ======================= */
  let ready = null;
  const ensurePlans = () => (ready ||= (async () => {
    const at = nowIso();
    await db.run("INSERT INTO ai_plans(id,slug,name,features,price,price_set_by,period_days,limits,active,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'{}',1,$8,$8) ON CONFLICT DO NOTHING",
      [id("aip"), DEFAULT_PLAN.slug, DEFAULT_PLAN.name, JSON.stringify(DEFAULT_PLAN.features), cfg.envPrice, cfg.envPrice ? "env" : null, cfg.periodDays, at]);
    if (cfg.envPrice) await db.run("UPDATE ai_plans SET price=$1, price_set_by='env', updated_at=$2 WHERE slug=$3 AND (price_set_by IS NULL OR price_set_by='env') AND (price IS NULL OR price<>$1)", [cfg.envPrice, at, DEFAULT_PLAN.slug]);
  })().catch((e) => { ready = null; throw e; }));
  const planBySlug = async (slug) => { await ensurePlans(); return db.get("SELECT * FROM ai_plans WHERE slug=$1", [slug]); };
  const planById = (pid) => db.get("SELECT * FROM ai_plans WHERE id=$1", [pid]);
  function limitsOf(plan) {
    const l = parse(plan?.limits, {}) || {};
    const t = l.translate || {};
    return { translate: { chars: Number.isFinite(+t.chars) && +t.chars >= 0 ? Math.floor(+t.chars) : cfg.translateChars, costUsd: Number.isFinite(+t.costUsd) && +t.costUsd >= 0 ? +t.costUsd : cfg.translateUsd } };
  }
  const planClient = (p) => ({ slug: p.slug, name: p.name, features: parse(p.features, []), featureLabels: parse(p.features, []).map((k) => FEATURES[k] || k),
    price: p.price == null ? null : pi(p.price), ...(p.price == null ? { priceNote: "لم يُحدَّد سعر الاشتراك بعد" } : {}), currency: "PI", periodDays: Number(p.period_days), limits: limitsOf(p), active: !!Number(p.active) });

  /* ======================= subscriptions ======================= */
  const subRow = (uid, pid) => db.get("SELECT * FROM ai_subscriptions WHERE user_id=$1 AND plan_id=$2", [uid, pid]);
  const isLive = (s, t = clock().getTime()) => !!s && s.state === "active" && ms(s.period_end) > t;
  async function subClient(s) {
    if (!s) return null;
    const p = await planById(s.plan_id); const t = clock().getTime();
    const live = isLive(s, t);
    return { plan: p ? { slug: p.slug, name: p.name } : null, state: live ? "active" : s.state === "active" ? "expired" : s.state, source: s.source,
      periodStart: iso(s.period_start), periodEnd: iso(s.period_end), cancelAtPeriodEnd: !!Number(s.cancel_at_period_end),
      renewable: !!p && !!Number(p.active), daysLeft: live ? Math.max(0, Math.ceil((ms(s.period_end) - t) / DAY)) : 0 };
  }
  /** the user's live subscriptions (any plan) */
  async function liveSubs(uid) {
    if (!uid) return [];
    await ensurePlans();
    const rows = await db.all("SELECT s.*, p.features AS p_features, p.limits AS p_limits, p.slug AS p_slug FROM ai_subscriptions s JOIN ai_plans p ON p.id=s.plan_id WHERE s.user_id=$1 AND s.state='active' AND s.period_end > $2", [uid, nowIso()]);
    return rows;
  }
  /** generic entitlement check used by every AI feature (translate now, assistant in phase 42) */
  async function entitled(uid, feature) {
    const subs = await liveSubs(uid);
    const s = subs.find((x) => parse(x.p_features, []).includes(feature));
    if (!s) return { ok: false };
    return { ok: true, plan: s.p_slug, subscriptionId: s.id, limits: limitsOf({ limits: s.p_limits })[feature] || null };
  }
  async function requireFeature(uid, feature) {
    const e = await entitled(uid, feature);
    if (e.ok) return e;
    const plan = await planBySlug(DEFAULT_PLAN.slug);
    throw fail(402, "subscription_required", "هذه الميزة متاحة لمشتركي «مجتمع+ ذكاء»", { upsell: { plan: plan ? planClient(plan) : null, piEnabled: piOn(), ...(piOn() ? {} : { piNote: OFF }) } });
  }

  async function subscribe(user, b) {
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "الاشتراكات المدفوعة غير متاحة لمن هم دون ١٨ سنة");
    const plan = await planBySlug(typeof b?.plan === "string" && b.plan ? b.plan : DEFAULT_PLAN.slug);
    if (!plan) throw fail(404, "plan_not_found", "الخطة غير موجودة");
    if (!Number(plan.active)) throw fail(409, "plan_inactive", "هذه الخطة غير متاحة للاشتراك حالياً");
    if (!piOn()) throw fail(409, "not_configured", OFF);
    if (plan.price == null || !(Number(plan.price) > 0)) throw fail(409, "price_unset", "لم يُحدَّد سعر الاشتراك بعد");
    if (!rl.hit("ai_sub", user.id)) throw E.rate();
    const price = ctx.services.pricing ? await ctx.services.pricing.priceFor(user.id, "ai.plan." + plan.slug, Number(plan.price)) : Number(plan.price); // phase 53: grandfathered price
    const open = await db.get("SELECT p.*, t.status AS tx_status, t.memo AS tx_memo FROM ai_payments p LEFT JOIN pi_transactions t ON t.id=p.intent_id WHERE p.user_id=$1 AND p.plan_id=$2 AND p.status='pending' ORDER BY p.created_at DESC", [user.id, plan.id]);
    if (open && ["created", "approved"].includes(open.tx_status) && Number(open.amount) === price)
      return { intent: { id: open.intent_id, amount: pi(open.amount), memo: open.tx_memo, metadata: { intentId: open.intent_id } }, plan: planClient(plan) };
    const it = await piSvc().createIntent(user, { amount: pi(price), memo: `اشتراك شهري: ${plan.name}`.slice(0, 200), purpose: "ai", refId: plan.slug });
    await db.run("INSERT INTO ai_payments(id,user_id,plan_id,amount,intent_id,status,created_at) VALUES($1,$2,$3,$4,$5,'pending',$6)", [id("aipay"), user.id, plan.id, price, it.id, nowIso()]);
    return { intent: { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata }, plan: planClient(plan), ...(price < Number(plan.price) ? { grandfathered: pi(price) } : {}) };
  }
  /** extend (or start) a subscription by `days` from max(now, current live end) inside transaction t */
  async function extend(t, uid, plan, days, source, extra = {}) {
    const at = clock().getTime();
    const s = await t.get("SELECT * FROM ai_subscriptions WHERE user_id=$1 AND plan_id=$2", [uid, plan.id]);
    const from = s && s.state === "active" && ms(s.period_end) > at ? ms(s.period_end) : at;
    const end = from + days * DAY;
    const startIso = new Date(s && s.state === "active" && ms(s.period_end) > at ? ms(s.period_start) : at).toISOString();
    if (s) await t.run("UPDATE ai_subscriptions SET state='active', source=$1, period_start=$2, period_end=$3, cancel_at_period_end=0, cancelled_at=NULL, granted_by=$4, grant_note=$5, updated_at=$6 WHERE id=$7",
      [source === "grant" && s.source === "pi" && s.state === "active" && ms(s.period_end) > at ? "pi" : source, startIso, new Date(end).toISOString(), extra.by || s.granted_by || null, extra.note ?? s.grant_note ?? null, nowIso(), s.id]);
    else await t.run("INSERT INTO ai_subscriptions(id,user_id,plan_id,state,source,period_start,period_end,granted_by,grant_note,created_at,updated_at) VALUES($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$9)",
      [id("aisub"), uid, plan.id, source, startIso, new Date(end).toISOString(), extra.by || null, extra.note || null, nowIso()]);
    return { sub: await t.get("SELECT * FROM ai_subscriptions WHERE user_id=$1 AND plan_id=$2", [uid, plan.id]), from, end, renewed: !!s && s.state === "active" && ms(s.period_end) > at };
  }
  async function onCompleted(e) {
    const p = await db.get("SELECT * FROM ai_payments WHERE intent_id=$1", [e.tx]); if (!p) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(p.amount)) > 1) { logger.warn?.("ai amount mismatch; not activated", { payment: p.id }); return; }
    const plan = await planById(p.plan_id); if (!plan) return;
    const out = await db.tx(async (t) => {
      const r = await t.run("UPDATE ai_payments SET status='completed', completed_at=$1, period=$2 WHERE id=$3 AND status='pending'", [nowIso(), periodOf(), p.id]);
      if (!r.changes) return null;
      const x = await extend(t, p.user_id, plan, Number(plan.period_days) || cfg.periodDays, "pi");
      await t.run("UPDATE ai_payments SET subscription_id=$1, period_start=$2, period_end=$3 WHERE id=$4", [x.sub.id, new Date(x.from).toISOString(), new Date(x.end).toISOString(), p.id]);
      await postJournal(t, { ikey: `ai:pay:${p.id}`, kind: "ai_subscription", source: "ai", refId: x.sub.id, senderId: p.user_id, piTx: e.tx, memo: plan.slug,
        lines: [{ account: ACC.out(p.user_id), userId: p.user_id, debit: Number(p.amount) }, { account: PLATFORM, credit: Number(p.amount) }] });
      return x;
    });
    if (!out) return;
    await notify(p.user_id, "ai_subscribed", { ref: plan.slug });
    bus.emit(out.renewed ? "AI_SUBSCRIPTION_RENEWED" : "AI_SUBSCRIPTION_STARTED", { user: p.user_id, plan: plan.slug, until: new Date(out.end).toISOString() });
  }
  async function onRefunded(e) {
    const p = await db.get("SELECT * FROM ai_payments WHERE intent_id=$1", [e.tx]); if (!p || p.status !== "completed") return;
    await db.tx(async (t) => {
      const r = await t.run("UPDATE ai_payments SET status='refunded', refunded_at=$1 WHERE id=$2 AND status='completed'", [nowIso(), p.id]);
      if (!r.changes) return;
      await postJournal(t, { ikey: `ai:refund:${p.id}`, kind: "reversal", source: "ai", refId: p.subscription_id, senderId: p.user_id, piTx: e.tx, memo: "refund",
        lines: [{ account: PLATFORM, debit: Number(p.amount) }, { account: ACC.out(p.user_id), userId: p.user_id, credit: Number(p.amount) }] });
      const s = p.subscription_id ? await t.get("SELECT * FROM ai_subscriptions WHERE id=$1", [p.subscription_id]) : null;
      if (s && p.period_end && ms(s.period_end) === ms(p.period_end)) { // the refunded period is the latest: cut it off
        const cut = ms(p.period_start), at = clock().getTime();
        await t.run("UPDATE ai_subscriptions SET period_end=$1, state=$2, updated_at=$3 WHERE id=$4", [new Date(cut).toISOString(), cut > at ? "active" : "expired", nowIso(), s.id]);
      }
    });
  }
  async function cancel(user, b, on) {
    const plan = await planBySlug(typeof b?.plan === "string" && b.plan ? b.plan : DEFAULT_PLAN.slug); if (!plan) throw fail(404, "plan_not_found", "الخطة غير موجودة");
    const s = await subRow(user.id, plan.id);
    if (!isLive(s)) throw fail(409, "invalid_state", "لا يوجد اشتراك فعّال");
    await db.run("UPDATE ai_subscriptions SET cancel_at_period_end=$1, cancelled_at=$2, updated_at=$3 WHERE id=$4", [on ? 1 : 0, on ? nowIso() : null, nowIso(), s.id]);
    bus.emit(on ? "AI_SUBSCRIPTION_CANCELLED" : "AI_SUBSCRIPTION_RESUMED", { user: user.id, plan: plan.slug });
    return { subscription: await subClient(await subRow(user.id, plan.id)) };
  }

  /* ======================= metering & caps ======================= */
  async function usageRow(uid, feature, period = periodOf()) {
    return (await db.get("SELECT * FROM ai_usage WHERE user_id=$1 AND period=$2 AND feature=$3", [uid, period, feature])) || { requests: 0, chars: 0, cache_hits: 0, cost_micros: 0 };
  }
  async function providerSpendMicros(period = periodOf()) {
    return Number((await db.get("SELECT COALESCE(SUM(cost_micros),0) AS c FROM ai_period_stats WHERE period=$1", [period])).c);
  }
  /** throws 429 usage_limit / 503 budget_exhausted before a provider call of `chars` characters */
  async function checkCaps(uid, feature, limits, chars) {
    const u = await usageRow(uid, feature);
    if (limits && Number(u.chars) + chars > limits.chars) throw fail(429, "usage_limit", "بلغت حدّ الاستخدام الشهري لهذه الميزة", { usage: { chars: Number(u.chars), limitChars: limits.chars } });
    if (limits && Number(u.cost_micros) >= limits.costUsd * 1e6) throw fail(429, "usage_limit", "بلغت حدّ التكلفة الشهري لهذه الميزة", { usage: { chars: Number(u.chars), limitChars: limits.chars } });
    if ((await providerSpendMicros()) >= cfg.budgetUsd * 1e6) throw fail(503, "budget_exhausted", "توقفت الخدمة مؤقتاً لبلوغ ميزانيتها الشهرية");
  }
  async function meter(uid, feature, { chars = 0, costMicros = 0, cached = false, provider = "none" } = {}) {
    const period = periodOf(), at = nowIso();
    const ch = cached ? 0 : Math.max(0, Math.floor(chars)), cost = cached ? 0 : Math.max(0, Math.round(costMicros));
    await db.run(`INSERT INTO ai_usage(user_id,period,feature,requests,chars,cache_hits,cost_micros,updated_at) VALUES($1,$2,$3,1,$4,$5,$6,$7)
      ON CONFLICT (user_id, period, feature) DO UPDATE SET requests=ai_usage.requests+1, chars=ai_usage.chars+$4, cache_hits=ai_usage.cache_hits+$5, cost_micros=ai_usage.cost_micros+$6, updated_at=$7`, [uid, period, feature, ch, cached ? 1 : 0, cost, at]);
    await db.run(`INSERT INTO ai_period_stats(period,feature,provider,requests,chars,cache_hits,cost_micros) VALUES($1,$2,$3,1,$4,$5,$6)
      ON CONFLICT (period, feature, provider) DO UPDATE SET requests=ai_period_stats.requests+1, chars=ai_period_stats.chars+$4, cache_hits=ai_period_stats.cache_hits+$5, cost_micros=ai_period_stats.cost_micros+$6`, [period, feature, cached ? "cache" : provider, ch, cached ? 1 : 0, cost]);
  }

  /* ======================= read models ======================= */
  async function config() {
    await ensurePlans();
    const plans = await db.all("SELECT * FROM ai_plans WHERE active=1 ORDER BY created_at");
    const tr = ctx.services.translate?.status?.() || { available: false, provider: null, private: false };
    return { piEnabled: piOn(), ...(piOn() ? {} : { piNote: OFF }), currency: "PI", plans: plans.map(planClient),
      features: { translate: { ...tr, ...(tr.available ? {} : { note: "خدمة الترجمة غير مفعّلة بعد" }) } },
      languages: require("../lib/translate").LANGS, label: "ترجمة آلية",
      disclosure: { messages: "عند ترجمة رسالة يُرسل نصها إلى مزود الترجمة المفعّل فقط لترجمتها، ولا تُستخدم لأي غرض آخر.",
        e2ee: "هذه المحادثة مشفّرة طرفياً. للترجمة سيُرسل جهازك نص هذه الرسالة فقط إلى خادم مجتمع بلس ومزود الترجمة، ولن يُخزَّن." } };
  }
  async function me(user) {
    await ensurePlans();
    const plan = await planBySlug(DEFAULT_PLAN.slug);
    const s = plan ? await subRow(user.id, plan.id) : null;
    const tr = await entitled(user.id, "translate"), as = await entitled(user.id, "assistant");
    const u = await usageRow(user.id, "translate");
    const lim = tr.limits || limitsOf(plan).translate;
    return { subscription: await subClient(s), entitlements: { translate: tr.ok, assistant: as.ok },
      usage: { period: periodOf(), translate: { requests: Number(u.requests), chars: Number(u.chars), cacheHits: Number(u.cache_hits), limitChars: lim.chars, pct: lim.chars ? Math.min(100, Math.round((Number(u.chars) / lim.chars) * 100)) : 0 } },
      prefs: ctx.services.translate ? await ctx.services.translate.prefsOf(user.id) : null, minor: await isMinor(user.id), piEnabled: piOn(), ...(piOn() ? {} : { piNote: OFF }) };
  }

  /* ======================= admin ======================= */
  const isAdmin = (u) => u?.role === "admin";
  const admin = (fn) => A(async (req, res) => { if (!isAdmin(req.user)) throw E.forbid("للإدارة فقط"); return fn(req, res); });
  async function updatePlan(user, slug, b) {
    const p = await planBySlug(slug); if (!p) throw fail(404, "plan_not_found", "الخطة غير موجودة");
    const set = {}, bad = () => fail(400, "plan_invalid", "بيانات الخطة غير صالحة");
    if (b.name !== undefined) { if (typeof b.name !== "string" || b.name.trim().length < 2 || b.name.trim().length > 60) throw bad(); set.name = b.name.trim(); }
    if (b.price !== undefined) {
      if (b.price === null) { set.price = null; } else { const v = Number(b.price); if (!Number.isFinite(v) || v <= 0 || v > num("PI_MAX_AMOUNT", 1000)) throw bad(); set.price = toUnits(v); }
      set.price_set_by = "admin";
    }
    if (b.active !== undefined) { if (typeof b.active !== "boolean") throw bad(); set.active = b.active ? 1 : 0; }
    if (b.periodDays !== undefined) { const d = Number(b.periodDays); if (!Number.isInteger(d) || d < 1 || d > 366) throw bad(); set.period_days = d; }
    if (b.limits !== undefined) {
      const L = b.limits, next = { ...parse(p.limits, {}) }; let n = 0;
      if (!L || typeof L !== "object" || Array.isArray(L)) throw bad();
      for (const f of ["translate", "assistant"]) {
        const t = L[f]; if (t === undefined) continue; if (!t || typeof t !== "object") throw bad();
        const chars = Number(t.chars), usd = Number(t.costUsd);
        if (!Number.isInteger(chars) || chars < 0 || chars > 1e8 || !Number.isFinite(usd) || usd < 0 || usd > 1000) throw bad();
        next[f] = { chars, costUsd: usd }; n++;
      }
      if (!n) throw bad();
      set.limits = JSON.stringify(next);
    }
    if (b.features !== undefined) { if (!Array.isArray(b.features) || !b.features.every((k) => typeof k === "string" && /^[a-z_]{2,30}$/.test(k))) throw bad(); set.features = JSON.stringify([...new Set(b.features)]); }
    const keys = Object.keys(set); if (!keys.length) throw bad();
    await db.run(`UPDATE ai_plans SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map((k) => set[k]), nowIso(), p.id]);
    audit("ai_plan_updated", p.slug, JSON.stringify({ ...set, limits: undefined }), user.id);
    return { plan: planClient(await planById(p.id)) };
  }
  async function findUser(ref) {
    if (typeof ref !== "string" || !ref) throw fail(400, "bad_request", "المستخدم مطلوب");
    const u = await db.get("SELECT id, handle, name FROM users WHERE id=$1 OR LOWER(handle)=LOWER($2)", [ref, ref.replace(/^@/, "")]);
    if (!u) throw fail(404, "not_found", "المستخدم غير موجود");
    return u;
  }
  async function grant(user, b) {
    const u = await findUser(b.user), plan = await planBySlug(b.plan || DEFAULT_PLAN.slug); if (!plan) throw fail(404, "plan_not_found", "الخطة غير موجودة");
    const days = Number(b.days); if (!Number.isInteger(days) || days < 1 || days > 366) throw fail(400, "bad_request", "عدد الأيام بين 1 و366");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : null;
    await db.tx((t) => extend(t, u.id, plan, days, "grant", { by: user.id, note }));
    audit("ai_grant", u.id, `${plan.slug} ${days}d ${note || ""}`.trim(), user.id);
    await notify(u.id, "ai_subscribed", { ref: plan.slug });
    return { subscription: await subClient(await subRow(u.id, plan.id)), user: u };
  }
  async function revoke(user, b) {
    const u = await findUser(b.user), plan = await planBySlug(b.plan || DEFAULT_PLAN.slug); if (!plan) throw fail(404, "plan_not_found", "الخطة غير موجودة");
    const s = await subRow(u.id, plan.id); if (!s) throw fail(404, "not_found", "لا يوجد اشتراك");
    await db.run("UPDATE ai_subscriptions SET state='revoked', period_end=$1, updated_at=$1 WHERE id=$2", [nowIso(), s.id]);
    audit("ai_revoke", u.id, plan.slug, user.id);
    return { subscription: await subClient(await subRow(u.id, plan.id)), user: u };
  }
  async function subscribers(q) {
    const rows = await db.all("SELECT s.*, u.handle, u.name FROM ai_subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.updated_at DESC LIMIT 500");
    const out = [];
    for (const r of rows) { const c = await subClient(r); if (!q.state || c.state === q.state) out.push({ ...c, user: { id: r.user_id, handle: r.handle, name: r.name } }); }
    return { items: out };
  }
  async function finance(q) {
    const period = typeof q.period === "string" && /^\d{4}-\d{2}$/.test(q.period) ? q.period : periodOf();
    const pays = await db.all("SELECT status, amount FROM ai_payments WHERE period=$1 AND status IN ('completed','refunded')", [period]);
    const revenue = pays.reduce((s, p) => s + Number(p.amount), 0), refunds = pays.filter((p) => p.status === "refunded").reduce((s, p) => s + Number(p.amount), 0);
    const stats = await db.all("SELECT * FROM ai_period_stats WHERE period=$1 ORDER BY feature, provider", [period]);
    const costMicros = stats.reduce((s, r) => s + Number(r.cost_micros), 0);
    const at = nowIso();
    const active = Number((await db.get("SELECT COUNT(*) AS n FROM ai_subscriptions WHERE state='active' AND period_end > $1", [at])).n);
    const grants = Number((await db.get("SELECT COUNT(*) AS n FROM ai_subscriptions WHERE state='active' AND period_end > $1 AND source='grant'", [at])).n);
    const net = revenue - refunds, costUsd = costMicros / 1e6;
    const months = []; const d = new Date(period + "-01T00:00:00Z"); for (let i = 0; i < 6; i++) { months.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7)); }
    return { period, currency: "PI", revenue: pi(revenue), refunds: pi(refunds), net: pi(net), payments: pays.length, activeSubscribers: active, grants,
      providerCostUsd: Math.round(costUsd * 1e4) / 1e4, budgetUsd: cfg.budgetUsd,
      byFeature: stats.map((r) => ({ feature: r.feature, provider: r.provider, requests: Number(r.requests), chars: Number(r.chars), cacheHits: Number(r.cache_hits), costUsd: Number(r.cost_micros) / 1e6 })),
      piUsdRate: cfg.piUsd, marginUsd: cfg.piUsd ? Math.round((pi(net) * cfg.piUsd - costUsd) * 1e4) / 1e4 : null, months };
  }

  /* ======================= jobs ======================= */
  async function maintain() {
    const t = clock().getTime(), at = nowIso();
    let reminded = 0, expired = 0;
    const soon = new Date(t + cfg.remindDays * DAY).toISOString();
    for (const s of await db.all("SELECT * FROM ai_subscriptions WHERE state='active' AND source='pi' AND cancel_at_period_end=0 AND period_end > $1 AND period_end <= $2", [at, soon])) {
      const key = iso(s.period_end);
      const r = await db.run("UPDATE ai_subscriptions SET reminded_for=$1 WHERE id=$2 AND (reminded_for IS NULL OR reminded_for<>$1)", [key, s.id]);
      if (r.changes) { reminded++; const p = await planById(s.plan_id); await notify(s.user_id, "ai_renew_reminder", { ref: p?.slug || null }); }
    }
    for (const s of await db.all("SELECT * FROM ai_subscriptions WHERE state='active' AND period_end <= $1", [at])) {
      const r = await db.run("UPDATE ai_subscriptions SET state='expired', updated_at=$1 WHERE id=$2 AND state='active'", [at, s.id]);
      if (r.changes) { expired++; const p = await planById(s.plan_id); await notify(s.user_id, "ai_expired", { ref: p?.slug || null }); bus.emit("AI_SUBSCRIPTION_EXPIRED", { user: s.user_id, plan: p?.slug }); }
    }
    return { reminded, expired };
  }
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.AI_JOBS !== "0";
  if (jobsOn && ctx.scheduler) ctx.scheduler.every("ai.maintain", +(env.AI_JOB_INTERVAL_MS || 10 * 60e3), maintain);

  /* ======================= bus ======================= */
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => logger.error?.("ai handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => { if (e.purpose === "ai") await onCompleted(e); }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "ai") await db.run("UPDATE ai_payments SET status='cancelled', cancelled_at=$1 WHERE intent_id=$2 AND status='pending'", [nowIso(), e.tx]); }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => { if (e.purpose === "ai") await onRefunded(e); }));
  bus.on("USER_ANONYMISED", track(async (e) => { if (e?.user) await db.run("UPDATE ai_subscriptions SET state='revoked', grant_note=NULL, updated_at=$2 WHERE user_id=$1", [e.user, nowIso()]); }));

  /* ======================= routes ======================= */
  R.get("/api/ai/config", async () => config());
  R.get("/api/ai/me", A(async (req) => me(req.user)));
  R.post("/api/ai/subscribe", A(async (req) => subscribe(req.user, req.body || {})));
  R.post("/api/ai/subscription/cancel", A(async (req) => cancel(req.user, req.body || {}, true)));
  R.post("/api/ai/subscription/resume", A(async (req) => cancel(req.user, req.body || {}, false)));
  R.get("/api/admin/ai/plans", admin(async () => { await ensurePlans(); return { plans: (await db.all("SELECT * FROM ai_plans ORDER BY created_at")).map((p) => ({ ...planClient(p), priceSetBy: p.price_set_by || null })) }; }));
  R.put("/api/admin/ai/plans/:slug", admin(async (req) => updatePlan(req.user, req.params.slug, req.body || {})));
  R.post("/api/admin/ai/grants", admin(async (req) => grant(req.user, req.body || {})));
  R.post("/api/admin/ai/grants/revoke", admin(async (req) => revoke(req.user, req.body || {})));
  R.get("/api/admin/ai/subscribers", admin(async (req) => subscribers(req.query || {})));
  R.get("/api/admin/ai/finance", admin(async (req) => finance(req.query || {})));

  return { config: cfg, entitled, requireFeature, checkCaps, meter, maintain, settle, finance, FEATURES, ensurePlans };
};
Object.assign(module.exports, { FEATURES, DEFAULT_PLAN });
