/* Pricing manager + revenue / cost dashboard (phase 53). Admin only.
 * 1. Price book (price_book): one catalogue for everything paid on the platform —
 *      ai.plan.<slug>      «مجتمع+ ذكاء» monthly price            (1e-7 Pi units → ai_plans.price)
 *      fee.tips            platform fee on tips                    (basis points → tips.config.feeBps)
 *      fee.subscriptions   platform fee on creator subscriptions   (bps → tips.config.supportFeeBps, used by phase 37/57)
 *      fee.paid            platform fee on pay-per-view content    (bps → paid.config.feeBps)
 *      fee.market          platform fee on market + digital sales  (bps → market.config.feePct = bps / 100)
 *      fee.transfers       platform fee on Pi transfers            (bps → transfers.cfg.feeBps; recipient gets amount − fee)
 *      ads.cpm.min / ads.cpm.default  ad price per 1000 impressions (Pi units → ads.config.minCpm / defaultCpm)
 *    Every change is a row: scheduled (effective_at in the future) → active → superseded, or cancelled. Nothing is overwritten,
 *    so the history is complete. A change needs confirm:true. Items without any row keep their environment default ("env").
 *    The leased job pricing.apply activates due rows; every instance re-syncs its in-memory config each minute.
 * 2. Grandfathering: a price increase on an AI plan with grandfather=1 locks the previous price (price_locks) for every user
 *    whose subscription is live at activation, for grandfather_days (NULL = as long as they keep renewing; a subscription
 *    that lapsed for more than PRICING_LOCK_GRACE_DAYS drops the lock). ai.subscribe asks priceFor().
 * 3. Suggested defaults (SUGGESTED) are shown next to each item but NEVER applied automatically: the admin confirms them
 *    (POST /api/admin/pricing/suggested {confirm:true}).
 * 4. Revenue (lib/ledger.js journals): by stream (journal source; market orders of digital listings → `digital`), by day or
 *    month: money paid in, platform share (platform:fees|ai|ads), creator / seller payouts (…:earnings), refunds (credits back
 *    to user:*:pi_out), P2P transfer volume; liabilities held (escrow, held, unspent ad budgets).
 * 5. Costs: manual monthly entries (Railway, providers, other; US cents) + provider usage counters already recorded by the app
 *    (llm_usage cost, ai_period_stats cost_micros, emails sent). A usage counter is counted as a cost only when no manual entry
 *    exists for that provider in that month (no double counting). Margin and break-even need a Pi→USD rate (finance setting
 *    pi_usd_rate, else AI_PI_USD_RATE); without it they answer null with a note. CSV export (UTF-8 BOM for spreadsheets). */
const { E, HttpError, str, id } = require("../lib/core");
const { toUnits, pi } = require("../lib/ledger");

const DAY = 864e5;
const PLATFORM = ["platform:fees", "platform:ai", "platform:ads"];
const LIAB = (a) => a === "escrow:market" || a === "escrow:contracts" || a === "platform:held" || a.startsWith("ads:budget:");
const STREAM_AR = { tip: "الإكراميات", tips: "الإكراميات", support: "اشتراكات صنّاع المحتوى", ppv: "المحتوى المدفوع", market: "السوق", digital: "المنتجات الرقمية", ads: "الإعلانات", ai: "مجتمع+ ذكاء", transfer: "التحويلات" };
const COST_CATS = ["hosting", "database", "provider", "domain", "other"];
const SUGGESTED = {
  "ai.plan.ai_plus": { value: 1, reason: "يغطي سقف تكلفة المزوّد (٠٫٥$ شهرياً لكل مشترك) ما دام سعر Pi ≥ ٠٫٥$، ويبقى أقل من اشتراكات الذكاء المعروفة" },
  "fee.tips": { value: 500, reason: "٥٪ — أقل من المنصات المعروفة (٨–٢٠٪)، والإكرامية تذهب في أغلبها للصانع" },
  "fee.subscriptions": { value: 800, reason: "٨٪ — يغطي التذكير والتجديد وقناة المشتركين، أقل من Patreon (٨–١٢٪)" },
  "fee.paid": { value: 1000, reason: "١٠٪ — المحتوى المدفوع يستهلك تخزيناً وحماية للوسائط" },
  "fee.market": { value: 300, reason: "٣٪ — يغطي الضمان والنزاعات والتخزين الرقمي دون أن يدفع البائعين للتعامل خارج المنصة" },
  "fee.transfers": { value: 0, reason: "التحويلات بين الأعضاء مجانية لبناء الثقة؛ الرسوم تأتي من الخدمات" },
  "ads.cpm.min": { value: 0.01, reason: "حد أدنى منخفض يسمح للمعلنين الصغار بالبدء" },
  "ads.cpm.default": { value: 0.2, reason: "سعر افتراضي معتدل لكل ألف ظهور، يمكن للمعلن رفعه للمنافسة" }
};

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx, R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const S = () => ctx.services;
  const iso = (v) => (v == null ? null : typeof v === "string" ? v : new Date(v).toISOString());
  const lockGraceMs = Math.max(0, Number(env.PRICING_LOCK_GRACE_DAYS || 7)) * DAY;

  /* ======================= catalogue ======================= */
  const feeItem = (key, label, get, set) => ({ key, label, unit: "bps", min: 0, max: 3000, get, set });
  const piItem = (key, label, get, set, max = 1000) => ({ key, label, unit: "pi", min: toUnits(0.0001), max: toUnits(max), get, set });
  const fixed = [
    feeItem("fee.tips", "رسوم المنصة على الإكراميات", () => S().tips?.config.feeBps ?? 0, (v) => { if (S().tips) S().tips.config.feeBps = v; }),
    { ...feeItem("fee.subscriptions", "رسوم المنصة على اشتراكات صنّاع المحتوى", () => S().tips?.config.supportFeeBps ?? null, (v) => { if (S().tips) S().tips.config.supportFeeBps = v; }), show: () => S().tips?.config.supportFeeBps ?? S().tips?.config.feeBps ?? 0 }, // null = same as tips
    feeItem("fee.paid", "رسوم المنصة على المحتوى المدفوع", () => S().paid?.config.feeBps ?? 0, (v) => { if (S().paid) S().paid.config.feeBps = v; }),
    feeItem("fee.market", "رسوم المنصة على مبيعات السوق والمنتجات الرقمية", () => Math.round((S().market?.config.feePct ?? 0) * 100), (v) => { if (S().market) S().market.config.feePct = v / 100; }),
    feeItem("fee.transfers", "رسوم المنصة على تحويلات Pi", () => S().transfers?.cfg.feeBps ?? 0, (v) => { if (S().transfers) S().transfers.cfg.feeBps = v; }),
    piItem("ads.cpm.min", "أدنى سعر لكل ألف ظهور إعلاني", () => S().ads?.config.minCpm ?? 0, (v) => { if (S().ads) S().ads.config.minCpm = v; }, 100),
    piItem("ads.cpm.default", "السعر الافتراضي لكل ألف ظهور", () => S().ads?.config.defaultCpm ?? 0, (v) => { if (S().ads) S().ads.config.defaultCpm = v; }, 100)
  ];
  async function catalogue() {
    await S().ai?.ensurePlans?.().catch(() => null);
    const plans = await db.all("SELECT slug, name, price FROM ai_plans ORDER BY created_at").catch(() => []);
    const ai = plans.map((p) => piItem("ai.plan." + p.slug, `اشتراك «${p.name}» الشهري`, () => (p.price == null ? null : Number(p.price)), null));
    return [...ai, ...fixed];
  }
  const base = new Map(); // environment default of each fixed item, captured once (restored when every row is cancelled)
  for (const it of fixed) base.set(it.key, it.get());
  const fmt = (it, v) => (v == null ? null : it.unit === "pi" ? pi(v) : Number(v));
  const parseVal = (it, raw) => {
    const n = Number(raw);
    if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n)) throw fail(400, "value_invalid", "قيمة غير صالحة");
    const v = it.unit === "pi" ? toUnits(n) : Math.round(n);
    if (v < it.min || v > it.max) throw fail(400, "value_invalid", it.unit === "pi" ? `السعر بين ${pi(it.min)} و${pi(it.max)} π` : `الرسوم بين ٠ و${it.max / 100}٪`);
    return v;
  };

  /* ======================= apply / sync ======================= */
  async function activeRows() { return db.all("SELECT * FROM price_book WHERE status='active'"); }
  /** push the active value of every fixed item into the owning service's in-memory config (each instance, each minute) */
  async function sync() {
    const act = new Map((await activeRows()).map((r) => [r.item, Number(r.value)]));
    for (const it of fixed) it.set(act.has(it.key) ? act.get(it.key) : base.get(it.key));
  }
  async function lockFor(t, row, prev) {
    const slug = row.item.slice("ai.plan.".length);
    const plan = await t.get("SELECT id FROM ai_plans WHERE slug=$1", [slug]); if (!plan) return 0;
    const subs = await t.all("SELECT user_id FROM ai_subscriptions WHERE plan_id=$1 AND state='active' AND period_end > $2", [plan.id, nowIso()]);
    const until = row.grandfather_days == null ? null : new Date(clock().getTime() + Number(row.grandfather_days) * DAY).toISOString();
    for (const s of subs) await t.run("INSERT INTO price_locks(user_id,item,value,price_id,until_at,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,item) DO NOTHING", [s.user_id, row.item, prev, row.id, until, nowIso()]);
    return subs.length;
  }
  /** activate every due scheduled row (leased job; also called right after an immediate change) */
  async function applyDue() {
    const due = await db.all("SELECT * FROM price_book WHERE status='scheduled' AND effective_at <= $1 ORDER BY effective_at, created_at", [nowIso()]);
    let n = 0;
    for (const row of due) {
      const it = (await catalogue()).find((x) => x.key === row.item);
      const ok = await db.tx(async (t) => {
        const r = await t.run("UPDATE price_book SET status='active', applied_at=$1 WHERE id=$2 AND status='scheduled'", [nowIso(), row.id]);
        if (!r.changes) return false;
        await t.run("UPDATE price_book SET status='superseded' WHERE item=$1 AND status='active' AND id<>$2", [row.item, row.id]);
        let prev = it ? it.get() : null;
        if (row.item.startsWith("ai.plan.")) {
          const p = await t.get("SELECT price FROM ai_plans WHERE slug=$1", [row.item.slice(8)]);
          prev = p?.price == null ? null : Number(p.price);
          await t.run("UPDATE ai_plans SET price=$1, price_set_by='pricing', updated_at=$2 WHERE slug=$3", [Number(row.value), nowIso(), row.item.slice(8)]);
          if (Number(row.grandfather) && prev != null && Number(row.value) > prev) await lockFor(t, row, prev);
        }
        await t.run("UPDATE price_book SET prev_value=$1 WHERE id=$2", [prev, row.id]);
        return true;
      });
      if (ok) { n++; ctx.audit?.("PRICE_ACTIVATED", row.item, `${row.value}`, row.created_by || "system"); }
    }
    if (n) await sync();
    return n;
  }
  /** the price a user pays for an item now: a grandfathered lock wins when lower and still valid */
  async function priceFor(uid, item, current) {
    const lock = uid ? await db.get("SELECT * FROM price_locks WHERE user_id=$1 AND item=$2", [uid, item]) : null;
    if (!lock) return current;
    const at = clock().getTime();
    let valid = !lock.until_at || Date.parse(iso(lock.until_at)) > at;
    if (valid && item.startsWith("ai.plan.")) {
      const s = await db.get("SELECT s.period_end FROM ai_subscriptions s JOIN ai_plans p ON p.id=s.plan_id WHERE s.user_id=$1 AND p.slug=$2", [uid, item.slice(8)]);
      valid = !!s && Date.parse(iso(s.period_end)) + lockGraceMs > at;
    }
    if (!valid) { await db.run("DELETE FROM price_locks WHERE user_id=$1 AND item=$2", [uid, item]); return current; }
    return current == null ? Number(lock.value) : Math.min(Number(lock.value), current);
  }

  /* ======================= admin: price book ======================= */
  const rowClient = (r, it) => ({ id: r.id, item: r.item, value: it ? fmt(it, r.value) : Number(r.value), prevValue: it && r.prev_value != null ? fmt(it, r.prev_value) : null, status: r.status,
    effectiveAt: iso(r.effective_at), grandfather: !!Number(r.grandfather), grandfatherDays: r.grandfather_days == null ? null : Number(r.grandfather_days), note: r.note || null,
    source: r.source, createdBy: r.created_by || null, createdAt: iso(r.created_at), appliedAt: iso(r.applied_at), cancelledAt: iso(r.cancelled_at) });
  async function overview() {
    await applyDue();
    const cat = await catalogue(), rows = await db.all("SELECT * FROM price_book WHERE status IN ('active','scheduled') ORDER BY effective_at");
    const locks = await db.all("SELECT item, COUNT(*) n FROM price_locks GROUP BY item");
    return {
      items: cat.map((it) => {
        const act = rows.find((r) => r.item === it.key && r.status === "active"), sug = SUGGESTED[it.key];
        return { key: it.key, label: it.label, unit: it.unit, current: fmt(it, it.show ? it.show() : it.get()), source: act ? "price_book" : it.key.startsWith("ai.plan.") ? "plan" : "env",
          base: it.key.startsWith("ai.plan.") ? null : fmt(it, base.get(it.key)), min: fmt(it, it.min), max: fmt(it, it.max), active: act ? rowClient(act, it) : null,
          scheduled: rows.filter((r) => r.item === it.key && r.status === "scheduled").map((r) => rowClient(r, it)),
          suggested: sug ? { value: sug.value, reason: sug.reason, applied: fmt(it, it.show ? it.show() : it.get()) === sug.value } : null,
          grandfathered: Number(locks.find((l) => l.item === it.key)?.n || 0), grandfatherable: it.key.startsWith("ai.plan.") };
      }),
      note: "الأسعار المقترحة للعرض فقط ولا تُطبَّق إلا بتأكيدك. أي تغيير يُسجَّل في السجل ولا يُحذف."
    };
  }
  async function history(q) {
    const cat = await catalogue(), item = q.item ? str(q.item, 60) : null;
    const rows = await db.all(`SELECT * FROM price_book ${item ? "WHERE item=$1" : ""} ORDER BY created_at DESC LIMIT 200`, item ? [item] : []);
    return { items: rows.map((r) => rowClient(r, cat.find((x) => x.key === r.item))) };
  }
  async function schedule(by, b, source = "admin") {
    if (b?.confirm !== true) throw fail(400, "confirm_required", "أكّد التغيير (confirm: true) — الأسعار لا تتغير دون تأكيد");
    const it = (await catalogue()).find((x) => x.key === b.item);
    if (!it) throw fail(400, "item_invalid", "البند غير معروف");
    const value = parseVal(it, b.value);
    let at = clock().getTime();
    if (b.effectiveAt !== undefined && b.effectiveAt !== null && b.effectiveAt !== "") {
      at = Date.parse(String(b.effectiveAt));
      if (!Number.isFinite(at)) throw fail(400, "date_invalid", "تاريخ السريان غير صالح");
      if (at < clock().getTime() - 60e3) throw fail(400, "date_invalid", "تاريخ السريان في الماضي");
      if (at > clock().getTime() + 366 * DAY) throw fail(400, "date_invalid", "تاريخ السريان أبعد من سنة");
    }
    const gf = !!b.grandfather && it.key.startsWith("ai.plan.");
    let gdays = null;
    if (gf && b.grandfatherDays !== undefined && b.grandfatherDays !== null) { gdays = Math.floor(Number(b.grandfatherDays)); if (!(gdays >= 1 && gdays <= 3650)) throw fail(400, "value_invalid", "مدة الحماية من يوم إلى ١٠ سنوات"); }
    const rid = id("prc");
    await db.run("INSERT INTO price_book(id,item,value,status,effective_at,grandfather,grandfather_days,note,source,created_by,created_at) VALUES($1,$2,$3,'scheduled',$4,$5,$6,$7,$8,$9,$10)",
      [rid, it.key, value, new Date(at).toISOString(), gf ? 1 : 0, gdays, str(b.note, 300) || null, source, by.id, nowIso()]);
    ctx.audit?.("PRICE_SCHEDULED", it.key, `${fmt(it, value)} @ ${new Date(at).toISOString()}`, by.id);
    await applyDue();
    return { price: rowClient(await db.get("SELECT * FROM price_book WHERE id=$1", [rid]), it) };
  }
  async function cancel(by, pid) {
    const r = await db.run("UPDATE price_book SET status='cancelled', cancelled_at=$1, cancelled_by=$2 WHERE id=$3 AND status='scheduled'", [nowIso(), by.id, String(pid).slice(0, 60)]);
    if (!r.changes) throw fail(409, "not_scheduled", "يمكن إلغاء التغييرات المجدولة فقط");
    ctx.audit?.("PRICE_CANCELLED", pid, null, by.id);
    return { ok: true };
  }
  /** revert an item to its environment default: ends the active row (superseded) without touching history */
  async function revert(by, item) {
    const it = fixed.find((x) => x.key === item); if (!it) throw fail(400, "item_invalid", "يمكن إرجاع الرسوم فقط إلى الافتراضي");
    await db.run("UPDATE price_book SET status='superseded' WHERE item=$1 AND status='active'", [item]);
    ctx.audit?.("PRICE_REVERTED", item, null, by.id); await sync();
    return overview();
  }
  async function applySuggested(by, b) {
    if (b?.confirm !== true) throw fail(400, "confirm_required", "أكّد تطبيق الأسعار المقترحة (confirm: true)");
    const keys = Array.isArray(b.items) && b.items.length ? b.items.map(String) : Object.keys(SUGGESTED);
    const cat = await catalogue(), out = [];
    for (const k of keys) {
      if (!SUGGESTED[k]) throw fail(400, "item_invalid", "لا يوجد سعر مقترح لـ " + k);
      if (!cat.find((x) => x.key === k)) continue;
      out.push((await schedule(by, { item: k, value: SUGGESTED[k].value, effectiveAt: b.effectiveAt, grandfather: b.grandfather !== false, note: "سعر مقترح", confirm: true }, "suggested")).price);
    }
    return { applied: out };
  }
  async function publicPrices() {
    const cat = await catalogue();
    return { currency: "PI", items: cat.map((it) => [it, it.show ? it.show() : it.get()]).filter(([, v]) => v != null).map(([it, v]) => ({ key: it.key, label: it.label, unit: it.unit, value: fmt(it, v), ...(it.unit === "bps" ? { percent: v / 100 } : {}) })) };
  }

  /* ======================= finance settings ======================= */
  async function setting(k) { const r = await db.get("SELECT value FROM finance_settings WHERE key=$1", [k]); return r ? r.value : null; }
  async function piUsd() { const v = Number(await setting("pi_usd_rate")); if (v > 0) return { rate: v, source: "admin" }; const e = Number(env.AI_PI_USD_RATE); return e > 0 ? { rate: e, source: "env" } : { rate: null, source: null }; }
  async function putSettings(by, b) {
    if (b.piUsdRate !== undefined) {
      if (b.piUsdRate === null || b.piUsdRate === "") await db.run("DELETE FROM finance_settings WHERE key='pi_usd_rate'");
      else { const v = Number(b.piUsdRate); if (!(v > 0 && v < 1e6)) throw fail(400, "value_invalid", "سعر Pi بالدولار غير صالح");
        await db.run("INSERT INTO finance_settings(key,value,updated_by,updated_at) VALUES('pi_usd_rate',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [String(v), by.id, nowIso()]); }
    }
    return { piUsd: await piUsd() };
  }

  /* ======================= costs ======================= */
  const monthOf = (d) => new Date(d).toISOString().slice(0, 7);
  const costClient = (c) => ({ id: c.id, month: c.month, category: c.category, provider: c.provider || null, amountUsd: Number(c.amount_cents) / 100, note: c.note || null, createdAt: iso(c.created_at) });
  async function addCost(by, b) {
    const month = String(b.month || monthOf(clock()));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, "month_invalid", "الشهر بصيغة YYYY-MM");
    if (!COST_CATS.includes(b.category)) throw fail(400, "category_invalid", "التصنيف: " + COST_CATS.join(" | "));
    const usd = Number(b.amountUsd);
    if (!Number.isFinite(usd) || usd < 0 || usd > 1e6) throw fail(400, "value_invalid", "المبلغ بالدولار غير صالح");
    const cid = id("cost");
    await db.run("INSERT INTO cost_entries(id,month,category,provider,amount_cents,note,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [cid, month, b.category, str(b.provider, 60) || null, Math.round(usd * 100), str(b.note, 300) || null, by.id, nowIso()]);
    ctx.audit?.("COST_ADDED", cid, `${month} ${b.category} ${usd}`, by.id);
    return { cost: costClient(await db.get("SELECT * FROM cost_entries WHERE id=$1", [cid])) };
  }
  async function delCost(by, cid) {
    const r = await db.run("UPDATE cost_entries SET deleted_at=$1 WHERE id=$2 AND deleted_at IS NULL", [nowIso(), String(cid).slice(0, 60)]);
    if (!r.changes) throw E.nf(); ctx.audit?.("COST_DELETED", cid, null, by.id); return { ok: true };
  }
  /** provider usage counters already kept by the app, per month: { month → [{provider, kind, usd, units}] } */
  async function usage(fromM, toM) {
    const out = {}, add = (m, x) => { if (m >= fromM && m <= toM) (out[m] ||= []).push(x); };
    for (const r of await db.all("SELECT substr(day,1,7) m, provider, SUM(cost) c, SUM(calls) n FROM llm_usage GROUP BY substr(day,1,7), provider").catch(() => [])) add(r.m, { provider: r.provider, kind: "llm", usd: Number(r.c || 0), units: Number(r.n || 0) });
    for (const r of await db.all("SELECT period m, provider, feature, SUM(cost_micros) c, SUM(requests) n FROM ai_period_stats GROUP BY period, provider, feature").catch(() => [])) add(r.m, { provider: r.provider, kind: "ai:" + r.feature, usd: Number(r.c || 0) / 1e6, units: Number(r.n || 0) });
    const mails = await db.all("SELECT created_at FROM email_log WHERE status IN ('sent','delivered') AND created_at >= $1", [fromM + "-01T00:00:00.000Z"]).catch(() => []);
    const byM = {}; for (const r of mails) { const m = monthOf(iso(r.created_at)); byM[m] = (byM[m] || 0) + 1; }
    for (const [m, n] of Object.entries(byM)) add(m, { provider: "smtp", kind: "email", usd: 0, units: n });
    return out;
  }

  /* ======================= revenue ======================= */
  function range(q) {
    const to = q.to ? Date.parse(String(q.to)) : clock().getTime();
    const from = q.from ? Date.parse(String(q.from)) : to - 90 * DAY;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw fail(400, "date_invalid", "نطاق التاريخ غير صالح");
    if (to - from > 731 * DAY) throw fail(400, "date_invalid", "النطاق سنتان على الأكثر");
    return { from: new Date(from).toISOString(), to: new Date(to + (q.to && String(q.to).length <= 10 ? DAY - 1 : 0)).toISOString(), group: q.group === "month" ? "month" : "day" };
  }
  async function revenue(q) {
    const rg = range(q);
    const rows = await db.all(`SELECT j.id, j.source, j.kind, j.ref_id, j.reverses, j.created_at, e.account, e.debit, e.credit FROM ledger_journals j JOIN ledger_entries e ON e.journal_id=j.id
      WHERE j.created_at >= $1 AND j.created_at <= $2 ORDER BY j.created_at`, [rg.from, rg.to]);
    const refs = [...new Set(rows.filter((r) => r.source === "market").map((r) => r.ref_id))];
    const digital = new Set();
    for (let i = 0; i < refs.length; i += 500) {
      const part = refs.slice(i, i + 500);
      for (const r of await db.all(`SELECT o.id FROM market_orders o JOIN market_listings l ON l.id=o.listing_id WHERE l.kind='digital' AND o.id IN (${part.map((_, k) => "$" + (k + 1)).join(",")})`, part).catch(() => [])) digital.add(r.id);
    }
    const zero = () => ({ paidIn: 0, platform: 0, creators: 0, refunds: 0, transfers: 0, journals: 0 });
    const streams = {}, series = {}, tot = zero(), liab = { escrow: 0, held: 0, adBudgets: 0 }, seen = new Set();
    for (const r of rows) {
      const stream = r.source === "market" && digital.has(r.ref_id) ? "digital" : r.source;
      const at = iso(r.created_at), bucket = rg.group === "month" ? at.slice(0, 7) : at.slice(0, 10);
      const s = (streams[stream] ||= zero()), b = (series[bucket] ||= zero());
      if (!seen.has(r.id)) { seen.add(r.id); s.journals++; b.journals++; tot.journals++; }
      const d = Number(r.debit || 0), c = Number(r.credit || 0), a = r.account, net = c - d;
      const add = (k, v) => { s[k] += v; b[k] += v; tot[k] += v; };
      if (/^user:.+:pi_out$/.test(a)) { if (d) add("paidIn", d); if (c) add("refunds", c); }
      else if (PLATFORM.includes(a)) add("platform", net);
      else if (/^(creator|seller):.+:earnings$/.test(a)) add("creators", net);
      else if (/^user:.+:transfers$/.test(a)) add("transfers", net);
      if (a === "escrow:market" || a === "escrow:contracts") liab.escrow += net; else if (a === "platform:held") liab.held += net; else if (LIAB(a)) liab.adBudgets += net;
    }
    const toPi = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "journals" ? v : pi(v)]));
    // costs over the months the range touches
    const fromM = rg.from.slice(0, 7), toM = rg.to.slice(0, 7);
    const manual = await db.all("SELECT * FROM cost_entries WHERE deleted_at IS NULL AND month >= $1 AND month <= $2 ORDER BY month, created_at", [fromM, toM]);
    const use = await usage(fromM, toM), months = {};
    for (const c of manual) { const m = (months[c.month] ||= { manualUsd: 0, usageUsd: 0, providers: new Set() }); m.manualUsd += Number(c.amount_cents) / 100; if (c.provider) m.providers.add(c.provider.toLowerCase()); }
    for (const [m, list] of Object.entries(use)) { const x = (months[m] ||= { manualUsd: 0, usageUsd: 0, providers: new Set() }); for (const u of list) if (!x.providers.has(String(u.provider).toLowerCase())) x.usageUsd += u.usd; }
    const costRows = Object.keys(months).sort().map((m) => ({ month: m, manualUsd: round2(months[m].manualUsd), usageUsd: round4(months[m].usageUsd), totalUsd: round2(months[m].manualUsd + months[m].usageUsd) }));
    const costUsd = costRows.reduce((s, r) => s + r.totalUsd, 0);
    const rate = await piUsd(), monthsN = Math.max(1, monthsBetween(fromM, toM));
    const platformPi = pi(tot.platform), revUsd = rate.rate ? platformPi * rate.rate : null;
    const payers = Number((await db.get(`SELECT COUNT(DISTINCT j.sender_id) n FROM ledger_journals j WHERE j.created_at >= $1 AND j.created_at <= $2 AND j.sender_id IS NOT NULL AND j.kind<>'reversal'`, [rg.from, rg.to]))?.n || 0);
    const aiPlan = await db.get("SELECT price FROM ai_plans WHERE slug='ai_plus'").catch(() => null);
    const monthlyCost = costUsd / monthsN, perPayerUsd = revUsd != null && payers ? revUsd / monthsN / payers : null;
    return {
      range: rg, currency: "PI",
      totals: toPi(tot), liabilities: toPi(liab),
      streams: Object.entries(streams).map(([k, v]) => ({ stream: k, label: STREAM_AR[k] || k, ...toPi(v) })).sort((x, y) => y.paidIn - x.paidIn),
      series: Object.entries(series).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => ({ period: k, ...toPi(v) })),
      costs: { months: costRows, totalUsd: round2(costUsd), entries: manual.map(costClient), usage: use, categories: COST_CATS },
      margin: { piUsdRate: rate.rate, rateSource: rate.source, revenueUsd: revUsd == null ? null : round2(revUsd), costUsd: round2(costUsd), marginUsd: revUsd == null ? null : round2(revUsd - costUsd),
        marginPct: revUsd ? Math.round(((revUsd - costUsd) / revUsd) * 1000) / 10 : null, ...(rate.rate ? {} : { note: "أدخل سعر Pi بالدولار لحساب الهامش ونقطة التعادل" }) },
      breakEven: { monthlyCostUsd: round2(monthlyCost), payers, revenuePerPayerUsdMonth: perPayerUsd == null ? null : round4(perPayerUsd),
        payersNeeded: perPayerUsd ? Math.ceil(monthlyCost / perPayerUsd) : null,
        aiSubscribersNeeded: rate.rate && aiPlan?.price ? Math.ceil(monthlyCost / (pi(aiPlan.price) * rate.rate)) : null,
        reached: revUsd != null ? revUsd / monthsN >= monthlyCost : null }
    };
  }
  const round2 = (x) => Math.round(x * 100) / 100, round4 = (x) => Math.round(x * 1e4) / 1e4;
  const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
  const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@\t\r]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
  async function csv(req, res, q) {
    const r = await revenue(q), L = [];
    L.push(["section", "key", "label", "paid_in_pi", "platform_pi", "creators_pi", "refunds_pi", "transfers_pi", "journals"].join(","));
    for (const s of r.streams) L.push(["stream", s.stream, s.label, s.paidIn, s.platform, s.creators, s.refunds, s.transfers, s.journals].map(csvCell).join(","));
    for (const s of r.series) L.push(["period", s.period, "", s.paidIn, s.platform, s.creators, s.refunds, s.transfers, s.journals].map(csvCell).join(","));
    L.push(["total", "", "", r.totals.paidIn, r.totals.platform, r.totals.creators, r.totals.refunds, r.totals.transfers, r.totals.journals].map(csvCell).join(","));
    L.push(""); L.push(["section", "month", "category", "provider", "amount_usd", "note"].join(","));
    for (const c of r.costs.entries) L.push(["cost", c.month, c.category, c.provider, c.amountUsd, c.note].map(csvCell).join(","));
    for (const m of r.costs.months) L.push(["cost_usage", m.month, "usage", "", m.usageUsd, ""].map(csvCell).join(","));
    L.push(""); L.push(["margin", "pi_usd_rate", r.margin.piUsdRate, "revenue_usd", r.margin.revenueUsd, "cost_usd", r.margin.costUsd, "margin_usd", r.margin.marginUsd].map(csvCell).join(","));
    const body = "\ufeff" + L.join("\r\n") + "\r\n";
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="mujtama-revenue-${r.range.from.slice(0, 10)}_${r.range.to.slice(0, 10)}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body);
    return ctx.STREAM;
  }

  /* ======================= jobs + routes ======================= */
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.PRICING_JOBS !== "0";
  if (jobsOn) {
    if (ctx.scheduler) ctx.scheduler.every("pricing.apply", +(env.PRICING_APPLY_INTERVAL_MS || 60e3), applyDue);
    const t = setInterval(() => sync().catch((e) => logger.warn?.("pricing sync failed", { err: e.message })), +(env.PRICING_SYNC_INTERVAL_MS || 60e3)); t.unref?.();
  }
  const ready = sync().catch((e) => logger.warn?.("pricing initial sync failed", { err: e.message }));
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  R.get("/api/pricing", async () => publicPrices());
  R.get("/api/admin/pricing", admin(async () => overview()));
  R.get("/api/admin/pricing/history", admin(async (req) => history(req.query || {})));
  R.post("/api/admin/pricing", admin(async (req) => schedule(req.user, req.body || {})));
  R.del("/api/admin/pricing/:id", admin(async (req) => cancel(req.user, req.params.id)));
  R.post("/api/admin/pricing/revert", admin(async (req) => revert(req.user, String(req.body?.item || ""))));
  R.post("/api/admin/pricing/suggested", admin(async (req) => applySuggested(req.user, req.body || {})));
  R.get("/api/admin/revenue", admin(async (req) => revenue(req.query || {})));
  R.get("/api/admin/revenue.csv", admin(async (req, res) => csv(req, res, req.query || {})));
  R.get("/api/admin/costs", admin(async (req) => { const r = await revenue(req.query || {}); return { costs: r.costs, margin: r.margin, piUsd: await piUsd() }; }));
  R.post("/api/admin/costs", admin(async (req) => addCost(req.user, req.body || {})));
  R.del("/api/admin/costs/:id", admin(async (req) => delCost(req.user, req.params.id)));
  R.put("/api/admin/finance/settings", admin(async (req) => putSettings(req.user, req.body || {})));

  return { ready, sync, applyDue, priceFor, overview, revenue, SUGGESTED };
};
