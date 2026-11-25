/* v2.162 — «اقتصاد MJT» (phase 6): admin analytics, issuance control, alerts and simulation for the internal MJT balance.
 * READ-ONLY over the existing systems — no second ledger, no second balance, no edits to history:
 *   ledger      lib/mjt-ledger.js tables (061): mjt_accounts (the wallet balance), mjt_tx / mjt_entries (posted movements)
 *   rewards     services/mjt-rewards.js (090): mjt_reward_sources (amount, caps, enabled), mjt_reward_entries (journal)
 *   services    services/mjt-services.js (091): mjt_services, mjt_service_purchases
 * The only writes of this module: the economy settings (mjt_settings key 'economy': per-source monthly budgets + alert
 * thresholds, ALL NULL by default) and a manual pause / resume of a PHASE-4 reward source through mjt-rewards.saveSource()
 * (the source's existing enable flag). Legacy MJT paths (transfers, tips, mining, daily sign-in, points → MJT, owner grant,
 * /api/mjt/buy) are classified and shown here (v2.163: their on/off switches live in services/mjt-legacy.js and are shown next to their numbers). No limit is ever changed automatically; a budget or an alert only
 * ALERTS. The simulation is pure arithmetic on real baselines and writes nothing.
 *
 * Classification (derived per ledger transaction from mjt_tx.kind + ikey prefix + ref_type; RULES below, first match wins):
 *   new_issuance      earn                         phase-4 reward sources (services/mjt-rewards.js)
 *   legacy_issuance   reward, mining, checkin, conversion, conversion_reversal, clawback, adjustment owner-grant[-undo]:*,
 *                     buy (no such ledger kind today: /api/mjt/buy always answers 501)
 *   admin_correction  adjustment (staff #/admin/mjt adjust, phase-4 corrective credit / debit ref_type reward:admin)
 *   spend             spend (service purchases)
 *   refund            refund (service refunds — compensating credits)
 *   member_transfer   transfer, community_reward, community_reward_reversal (member wallet → member wallet)
 *   tip               tip (posts and live rooms)
 *   unclassified      any other kind — always shown, never hidden
 * Amounts are taken from the MEMBER side of each transaction (mjt_entries on user:* accounts): «in» = credited to member
 * wallets, «out» = debited from member wallets. Total balances (SUM mjt_accounts.balance) are reported on their own and never
 * added to issued totals.
 *
 * Admin API (admin only — 403 otherwise; rate-limited with the shared mjt_admin limiter):
 *   GET  /api/admin/mjt/economy?period=day|week|month|year   the whole dashboard
 *   GET  /api/admin/mjt/economy/mapping                      ledger kind → class table + kinds seen in the ledger
 *   GET  /api/admin/mjt/economy/alerts?period=               alert evaluation on request
 *   GET  /api/admin/mjt/economy/reconciliation               per-wallet SUM(entries) vs stored balance
 *   GET  /api/admin/mjt/economy/settings · PUT …/settings    budgets + thresholds (audited)
 *   POST /api/admin/mjt/economy/sources/:key/state           { enabled } manual pause / resume of a phase-4 source (audited)
 *   POST /api/admin/mjt/economy/simulate                     hypothetical projection («افتراضي»), nothing written
 *   GET  /api/admin/mjt/economy/export.csv?table=&period=    CSV of one table for the period (audited) */
const { E, HttpError, str } = require("../lib/core");
const { UNIT, format } = require("../lib/mjt-ledger");
const { SEC_HEADERS } = require("../lib/http");

const HOUR = 3600e3, DAY = 24 * HOUR;
const ACTIVE_DAYS = 30; // an «active wallet» has ≥ 1 ledger movement in the last 30 days (shown in the UI)
const TOP_SHARE = 0.1; // concentration = share of all member balances held by the top 10% of wallets with a balance
const PERIODS = { day: { ms: DAY, buckets: 14, ar: "يومي" }, week: { ms: 7 * DAY, buckets: 12, ar: "أسبوعي" }, month: { ms: 30 * DAY, buckets: 12, ar: "شهري" }, year: { ms: 365 * DAY, buckets: 5, ar: "سنوي" } };
const CLASSES = ["new_issuance", "legacy_issuance", "admin_correction", "spend", "refund", "member_transfer", "tip", "unclassified"];
const CLASS_AR = { new_issuance: "إصدار جديد (مصادر المكافآت)", legacy_issuance: "إصدار قديم (مسارات سابقة)", admin_correction: "تصحيح من الإدارة", spend: "استخدام في الخدمات", refund: "استرداد", member_transfer: "تحويل بين الأعضاء", tip: "إكرامية", unclassified: "غير مصنّف" };
/* first match wins: { kind, ikey?: prefix of mjt_tx.ikey, ref?: exact mjt_tx.ref_type, cls, sub, ar } */
const RULES = [
  { kind: "earn", cls: "new_issuance", sub: "earn", ar: "مكافأة إنجاز (مصدر مكافآت)" },
  { kind: "reward", cls: "legacy_issuance", sub: "points_reward", ar: "مكافأة نقاط المساهمة" },
  { kind: "mining", cls: "legacy_issuance", sub: "mining", ar: "التعدين اليومي" },
  { kind: "checkin", cls: "legacy_issuance", sub: "checkin", ar: "مكافأة الدخول اليومي" },
  { kind: "conversion", cls: "legacy_issuance", sub: "points_conversion", ar: "تحويل نقاط المساهمة" },
  { kind: "conversion_reversal", cls: "legacy_issuance", sub: "points_conversion_reversal", ar: "إلغاء تحويل النقاط" },
  { kind: "clawback", cls: "legacy_issuance", sub: "points_reward_clawback", ar: "استرجاع مكافأة محتوى محذوف" },
  { kind: "adjustment", ikey: "owner-grant-undo:", cls: "legacy_issuance", sub: "owner_grant_undo", ar: "إلغاء رصيد تجربة المالك" },
  { kind: "adjustment", ikey: "owner-grant:", cls: "legacy_issuance", sub: "owner_grant", ar: "رصيد تجربة المالك (MJT_OWNER_GRANT)" },
  { kind: "buy", cls: "legacy_issuance", sub: "pi_buy", ar: "شراء بـ Pi (/api/mjt/buy — غير مفعّل)" },
  { kind: "adjustment", ref: "reward:admin", cls: "admin_correction", sub: "rewards_correction", ar: "تصحيح محفظة المكافآت" },
  { kind: "adjustment", cls: "admin_correction", sub: "staff_adjustment", ar: "تعديل رصيد من الإدارة" },
  { kind: "spend", cls: "spend", sub: "service", ar: "شراء خدمة" },
  { kind: "refund", cls: "refund", sub: "service_refund", ar: "استرداد خدمة" },
  { kind: "transfer", cls: "member_transfer", sub: "transfer", ar: "تحويل بين الأعضاء" },
  { kind: "community_reward", cls: "member_transfer", sub: "community_reward", ar: "مكافأة مجتمع (من رصيد مالكه)" },
  { kind: "community_reward_reversal", cls: "member_transfer", sub: "community_reward_reversal", ar: "استرجاع مكافأة مجتمع" },
  { kind: "tip", cls: "tip", sub: "tip", ar: "إكرامية" }
];
const KNOWN_KINDS = [...new Set(RULES.map((r) => r.kind))];
/** JS classifier (the SQL CASE below is generated from the same RULES) */
function classify(tx) {
  const kind = String(tx?.kind || ""), ikey = String(tx?.ikey || ""), ref = tx?.ref_type ?? tx?.refType ?? null;
  for (const r of RULES) if (r.kind === kind && (!r.ikey || ikey.startsWith(r.ikey)) && (!r.ref || r.ref === ref)) return { cls: r.cls, sub: r.sub };
  return { cls: "unclassified", sub: kind || "unknown" };
}
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const ruleSql = (r) => [`t.kind=${lit(r.kind)}`, r.ikey ? `SUBSTR(t.ikey,1,${r.ikey.length})=${lit(r.ikey)}` : null, r.ref ? `t.ref_type=${lit(r.ref)}` : null].filter(Boolean).join(" AND ");
const CASE_FULL = `CASE ${RULES.map((r) => `WHEN ${ruleSql(r)} THEN ${lit(r.cls + "|" + r.sub)}`).join(" ")} ELSE 'unclassified|' || t.kind END`;
const CASE_CLS = `CASE ${RULES.map((r) => `WHEN ${ruleSql(r)} THEN ${lit(r.cls)}`).join(" ")} ELSE 'unclassified' END`;
const ALERT_KEYS = { issuanceDailyMax: "mjt", useRateMinPct: "pct", top10ShareMaxPct: "pct", unusedGrowthMaxPct: "pct", sourceSpikeFactor: "factor", correctionsMaxCount: "count", mismatch: "bool" };
const ALERT_AR = {
  issuanceDailyMax: "إصدار غير طبيعي: الإصدار خلال آخر 24 ساعة أعلى من",
  useRateMinPct: "استخدام منخفض: نسبة استخدام الرصيد في الفترة أقل من",
  top10ShareMaxPct: "تركّز: حصة أعلى 10% من المحافظ من مجموع الأرصدة أعلى من",
  unusedGrowthMaxPct: "تراكم الأرصدة غير المستخدمة: نمو مجموع الأرصدة في الفترة أعلى من",
  sourceSpikeFactor: "نشاط غير طبيعي لمصدر: إصدار المصدر خلال 24 ساعة أعلى من متوسطه اليومي (آخر 30 يوماً) بمعامل",
  correctionsMaxCount: "تصحيحات يدوية كثيرة: عدد تصحيحات الإدارة في الفترة أعلى من",
  mismatch: "عدم تطابق الدفتر: رصيد محفظة لا يساوي مجموع حركاتها",
  budget: "تجاوز الميزانية الشهرية لمصدر"
};
const NOTE = "مجتمع كوين (MJT) رصيد مكافآت داخلي فقط: ليس له قيمة نقدية، ولا يُسحب ولا يُباع. هذه الصفحة تقرأ الدفتر ولا تغيّر أي حد تلقائياً.";
const SIM_NOTE = "افتراضي — حساب تقديري من افتراضاتك على أساس أرقام آخر 30 يوماً الحقيقية. لا يُحفظ ولا يغيّر أي إعداد ولا يختلط بالبيانات الحقيقية.";

/** @param {any} ctx @param {{ now?: () => Date|number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const ago = (ms) => new Date(clock().getTime() - ms).toISOString();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const RW = () => ctx.services.mjtRewards;
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); if (!rl.hit("mjt_admin", req.user.id)) throw E.rate(); return fn(req, res); });
  const N = (v) => Number(v || 0);
  const mjtNum = (units) => Math.round((N(units) / UNIT) * 1e4) / 1e4; // chart values (display only)
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  const periodOf = (p) => (PERIODS[p] ? p : "month");
  const FAR = "9999-12-31T23:59:59.999Z", EPOCH = "1970-01-01T00:00:00.000Z";

  /* ---------- settings (budgets + alert thresholds; all null by default) ---------- */
  const DEFAULTS = () => ({ budgets: {}, alerts: Object.fromEntries(Object.keys(ALERT_KEYS).map((k) => [k, null])) });
  async function settings() {
    const s = parse((await db.get("SELECT value FROM mjt_settings WHERE key='economy'"))?.value, {});
    const d = DEFAULTS();
    return { budgets: { ...(s.budgets || {}) }, alerts: { ...d.alerts, ...Object.fromEntries(Object.entries(s.alerts || {}).filter(([k]) => k in ALERT_KEYS)) } };
  }
  const settingsClient = (s) => ({ budgets: Object.fromEntries(Object.entries(s.budgets).map(([k, v]) => [k, v === null ? null : format(v)])), alerts: Object.fromEntries(Object.entries(s.alerts).map(([k, v]) => [k, v === null ? null : ALERT_KEYS[k] === "mjt" ? format(v) : v])) });
  const whole = (v, lo, hi, msg) => { const s = String(v ?? "").trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))); if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || +s < lo || +s > hi) throw fail(400, "bad_value", msg); return +s; };
  async function saveSettings(user, b = {}) {
    const cur = await settings(), next = JSON.parse(JSON.stringify(cur));
    const empty = (v) => v === null || v === undefined || v === "" || v === false;
    if (b.budgets && typeof b.budgets === "object") {
      const keys = new Set((await db.all("SELECT key FROM mjt_reward_sources")).map((r) => r.key));
      for (const [k, v] of Object.entries(b.budgets)) {
        if (!keys.has(k)) throw fail(400, "unknown_source", "مصدر غير معروف: " + String(k).slice(0, 40));
        if (empty(v)) delete next.budgets[k]; else next.budgets[k] = Math.round(whole(v, 1, 100000000, "الميزانية عدد موجب من MJT")) * UNIT;
      }
    }
    if (b.alerts && typeof b.alerts === "object") {
      for (const [k, v] of Object.entries(b.alerts)) {
        const t = ALERT_KEYS[k]; if (!t) throw fail(400, "unknown_alert", "قاعدة تنبيه غير معروفة");
        if (empty(v)) { next.alerts[k] = null; continue; }
        next.alerts[k] = t === "bool" ? true : t === "mjt" ? Math.round(whole(v, 1, 100000000, "قيمة غير صالحة")) * UNIT : t === "pct" ? whole(v, 0, 100, "النسبة بين 0 و100") : t === "factor" ? whole(v, 1, 1000, "المعامل بين 1 و1000") : Math.floor(whole(v, 1, 1000000, "العدد بين 1 و1000000"));
      }
    }
    const at = nowIso();
    await db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('economy',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(next), user.id, at]);
    await db.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('economy_settings',$1,'economy',NULL,$2,$3)", [user.id, JSON.stringify({ before: settingsClient(cur), after: settingsClient(next) }), at]);
    ctx.audit?.("mjt_economy_settings", "mjt", JSON.stringify(settingsClient(next)).slice(0, 300), user.id);
    return { settings: settingsClient(next) };
  }

  /* ---------- core aggregates ---------- */
  const emptyCls = () => Object.fromEntries(CLASSES.map((c) => [c, { in: 0, out: 0, tx: 0, receivers: 0, senders: 0 }]));
  /** per (class|sub, ref_type) member-side totals in [from, to) */
  async function byClass(from, to) {
    const rows = await db.all(`SELECT ${CASE_FULL} c, t.ref_type rt, COUNT(DISTINCT t.id) n,
        COALESCE(SUM(CASE WHEN e.amount > 0 THEN e.amount ELSE 0 END),0) uin, COALESCE(SUM(CASE WHEN e.amount < 0 THEN -e.amount ELSE 0 END),0) uout
      FROM mjt_tx t JOIN mjt_entries e ON e.tx_id=t.id AND e.user_id IS NOT NULL WHERE t.created_at >= $1 AND t.created_at < $2 GROUP BY 1, 2`, [from, to]);
    const users = await db.all(`SELECT ${CASE_CLS} c, COUNT(DISTINCT CASE WHEN e.amount > 0 THEN e.account_id END) r, COUNT(DISTINCT CASE WHEN e.amount < 0 THEN e.account_id END) s
      FROM mjt_tx t JOIN mjt_entries e ON e.tx_id=t.id AND e.user_id IS NOT NULL WHERE t.created_at >= $1 AND t.created_at < $2 GROUP BY 1`, [from, to]);
    const iss = await db.get(`SELECT COUNT(DISTINCT e.account_id) n FROM mjt_tx t JOIN mjt_entries e ON e.tx_id=t.id AND e.user_id IS NOT NULL AND e.amount > 0 WHERE t.created_at >= $1 AND t.created_at < $2 AND (${CASE_CLS}) IN ('new_issuance','legacy_issuance')`, [from, to]);
    const cls = emptyCls(), subs = {}, refs = [];
    for (const r of rows) {
      const [c, sub] = String(r.c).split("|"), k = CLASSES.includes(c) ? c : "unclassified";
      cls[k].in += N(r.uin); cls[k].out += N(r.uout); cls[k].tx += N(r.n);
      const sk = k + "|" + sub; subs[sk] ||= { cls: k, sub, in: 0, out: 0, tx: 0 }; subs[sk].in += N(r.uin); subs[sk].out += N(r.uout); subs[sk].tx += N(r.n);
      refs.push({ cls: k, sub, ref: r.rt || null, in: N(r.uin), out: N(r.uout), tx: N(r.n) });
    }
    for (const u of users) { const k = CLASSES.includes(u.c) ? u.c : "unclassified"; cls[k].receivers = N(u.r); cls[k].senders = N(u.s); }
    return { cls, subs: Object.values(subs), refs, issuanceReceivers: N(iss?.n) };
  }
  async function balances() {
    const u = await db.get("SELECT COALESCE(SUM(balance),0) s, COUNT(*) n, COALESCE(SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END),0) h, COALESCE(SUM(CASE WHEN status<>'active' THEN 1 ELSE 0 END),0) f FROM mjt_accounts WHERE kind='user'");
    return { total: N(u?.s), wallets: N(u?.n), holders: N(u?.h), frozen: N(u?.f) };
  }
  async function activeWallets(days = ACTIVE_DAYS) { return N((await db.get("SELECT COUNT(DISTINCT account_id) n FROM mjt_entries WHERE user_id IS NOT NULL AND created_at >= $1", [ago(days * DAY)]))?.n); }
  async function concentration() {
    const b = await balances(); const k = Math.ceil(b.holders * TOP_SHARE);
    const top = k ? N((await db.get(`SELECT COALESCE(SUM(balance),0) s FROM (SELECT balance FROM mjt_accounts WHERE kind='user' AND balance > 0 ORDER BY balance DESC LIMIT ${Math.floor(k)}) x`))?.s) : 0;
    return { holders: b.holders, topWallets: k, topBalance: format(top), totalBalance: format(b.total), sharePct: pct(top, b.total) };
  }
  async function reconciliation() {
    const rows = await db.all("SELECT a.id, a.kind, a.user_id, a.balance, COALESCE(SUM(e.amount),0) s FROM mjt_accounts a LEFT JOIN mjt_entries e ON e.account_id=a.id GROUP BY a.id, a.kind, a.user_id, a.balance HAVING a.balance <> COALESCE(SUM(e.amount),0) ORDER BY a.id LIMIT 200");
    const checked = N((await db.get("SELECT COUNT(*) n FROM mjt_accounts"))?.n);
    const items = [];
    for (const r of rows) {
      const u = r.user_id ? await db.get("SELECT handle FROM users WHERE id=$1", [r.user_id]) : null;
      items.push({ account: r.id, handle: u?.handle || null, stored: format(r.balance), ledger: format(r.s), diff: format(N(r.balance) - N(r.s)) });
    }
    return { ok: items.length === 0, checked, mismatches: items, checkedAt: nowIso() };
  }

  /* ---------- sections ---------- */
  function overviewOf(all, win, bal, active, conc) {
    const net = (c) => c.in - c.out;
    const issuedNew = net(all.cls.new_issuance), issuedLegacy = all.cls.legacy_issuance.in, legacyReversed = all.cls.legacy_issuance.out;
    const pIssued = win.cls.new_issuance.in + win.cls.legacy_issuance.in, pSpent = win.cls.spend.out, pRefund = win.cls.refund.in, pNetSpent = Math.max(0, pSpent - pRefund);
    const pNetIssued = net(win.cls.new_issuance) + net(win.cls.legacy_issuance);
    return {
      cumulative: { issuedNew: format(issuedNew), issuedLegacy: format(issuedLegacy), legacyReversed: format(legacyReversed), issuedLegacyNet: format(issuedLegacy - legacyReversed), spentOnServices: format(all.cls.spend.out), refunded: format(all.cls.refund.in), netSpent: format(Math.max(0, all.cls.spend.out - all.cls.refund.in)), adminCredits: format(all.cls.admin_correction.in), adminDebits: format(all.cls.admin_correction.out) },
      balances: { total: format(bal.total), wallets: bal.wallets, holders: bal.holders, frozen: bal.frozen }, // NEVER added to issued totals
      activeWallets: active, activeWindowDays: ACTIVE_DAYS,
      period: { issuedNew: format(win.cls.new_issuance.in), issuedLegacy: format(win.cls.legacy_issuance.in), issued: format(pIssued), spent: format(pSpent), refunded: format(pRefund), netSpent: format(pNetSpent),
        avgEarnedPerEarner: win.issuanceReceivers ? format(Math.round(pIssued / win.issuanceReceivers)) : null, earners: win.issuanceReceivers,
        avgSpentPerSpender: win.cls.spend.senders ? format(Math.round(pSpent / win.cls.spend.senders)) : null, spenders: win.cls.spend.senders,
        avgEarnedPerActive: active ? format(Math.round(pIssued / active)) : null, avgSpentPerActive: active ? format(Math.round(pSpent / active)) : null,
        useRatePct: pNetIssued > 0 ? pct(pNetSpent, pNetIssued) : null },
      concentration: conc
    };
  }
  function classesOf(all, win) {
    const c = (o) => ({ in: format(o.in), out: format(o.out), net: format(o.in - o.out), tx: o.tx, receivers: o.receivers, senders: o.senders });
    return CLASSES.map((k) => ({ key: k, label: CLASS_AR[k], legacy: k === "legacy_issuance", period: c(win.cls[k]), all: c(all.cls[k]),
      subs: win.subs.concat(all.subs).filter((s) => s.cls === k).map((s) => s.sub).filter((s, i, a) => a.indexOf(s) === i).map((sub) => {
        const p = win.subs.find((s) => s.cls === k && s.sub === sub) || { in: 0, out: 0, tx: 0 }, a = all.subs.find((s) => s.cls === k && s.sub === sub) || { in: 0, out: 0, tx: 0 };
        return { sub, label: RULES.find((r) => r.sub === sub)?.ar || sub, period: { in: format(p.in), out: format(p.out), tx: p.tx }, all: { in: format(a.in), out: format(a.out), tx: a.tx } };
      }) }));
  }
  /** issuance control: phase-4 sources (caps next to usage, budgets, pause) + the legacy group, read-only */
  async function sourcesOf(win, S) {
    const live = "kind='earn' AND decides IS NULL AND NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id AND d.status='rejected')"; // what the engine's caps count
    const src = await db.all("SELECT * FROM mjt_reward_sources ORDER BY key");
    const winBy = {}; for (const r of win.refs.filter((x) => x.cls === "new_issuance")) { const k = String(r.ref || "").replace(/^reward:/, "") || "—"; winBy[k] = (winBy[k] || 0) + r.in; }
    const usage = async (ms) => {
      const since = ago(ms);
      const tot = await db.all(`SELECT source, COUNT(*) n, COALESCE(SUM(CASE WHEN status='posted' THEN amount ELSE 0 END),0) a FROM mjt_reward_entries p WHERE ${live} AND created_at >= $1 GROUP BY source`, [since]);
      const peak = await db.all(`SELECT source, MAX(n) m FROM (SELECT source, user_id, COUNT(*) n FROM mjt_reward_entries p WHERE ${live} AND created_at >= $1 GROUP BY source, user_id) x GROUP BY source`, [since]);
      return { tot: new Map(tot.map((r) => [r.source, r])), peak: new Map(peak.map((r) => [r.source, N(r.m)])) };
    };
    const [d1, w1, m1] = [await usage(DAY), await usage(7 * DAY), await usage(30 * DAY)];
    const perRef = new Map((await db.all(`SELECT source, MAX(n) m FROM (SELECT source, user_id, ref, COUNT(*) n FROM mjt_reward_entries p WHERE ${live} GROUP BY source, user_id, ref) x GROUP BY source`)).map((r) => [r.source, N(r.m)]));
    const allTime = new Map((await db.all("SELECT source, COUNT(*) n, COALESCE(SUM(amount),0) a FROM mjt_reward_entries WHERE kind='earn' AND status='posted' GROUP BY source")).map((r) => [r.source, r]));
    const pend = new Map((await db.all("SELECT source, COUNT(*) n FROM mjt_reward_entries p WHERE p.status='pending' AND p.kind='earn' AND NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id) GROUP BY source")).map((r) => [r.source, N(r.n)]));
    const capRow = (cap, u, key) => ({ cap: cap === null || cap === undefined ? null : N(cap), count: N(u.tot.get(key)?.n), issued: format(u.tot.get(key)?.a || 0), peakPerMember: u.peak.get(key) || 0 });
    const phase4 = src.map((s) => {
      const budget = S.budgets[s.key] ?? null, month = N(m1.tot.get(s.key)?.a);
      return { key: s.key, label: s.label, enabled: !!N(s.enabled), amount: s.amount === null || s.amount === undefined ? null : format(s.amount), requiresApproval: !!N(s.requires_approval),
        caps: { day: capRow(s.daily_cap, d1, s.key), week: capRow(s.weekly_cap, w1, s.key), month: capRow(s.monthly_cap, m1, s.key), item: { cap: s.max_per_ref === null || s.max_per_ref === undefined ? null : N(s.max_per_ref), peakPerMember: perRef.get(s.key) || 0 } },
        period: format(winBy[s.key] || 0), allTime: { count: N(allTime.get(s.key)?.n), issued: format(allTime.get(s.key)?.a || 0) }, pending: pend.get(s.key) || 0,
        budget: { monthly: budget === null ? null : format(budget), used30d: format(month), usedPct: budget ? pct(month, budget) : null, reached: budget !== null && month >= budget } };
    });
    const others = Object.keys(winBy).filter((k) => !src.some((s) => s.key === k)).map((k) => ({ key: k, period: format(winBy[k]) })); // earn credits outside a configured source (e.g. funding in tests)
    return { phase4, other: others, legacy: classesOf({ cls: emptyCls(), subs: [] }, win).find((c) => c.key === "legacy_issuance").subs, note: "المسارات القديمة ليست مصادر مكافآت: لكل مسار مفتاح تشغيل/إيقاف خاص به (مفاتيح المسارات القديمة)." };
  }
  async function servicesOf(from, to, bal, win) {
    const rows = await db.all(`SELECT s.id, s.key, s.title, s.enabled, COUNT(p.id) n, COALESCE(SUM(p.cost),0) gross, COALESCE(SUM(CASE WHEN p.status='refunded' THEN 1 ELSE 0 END),0) rn, COALESCE(SUM(CASE WHEN p.status='refunded' THEN p.cost ELSE 0 END),0) ra, COUNT(DISTINCT p.user_id) buyers
      FROM mjt_services s LEFT JOIN mjt_service_purchases p ON p.service_id=s.id AND p.created_at >= $1 AND p.created_at < $2 GROUP BY s.id, s.key, s.title, s.enabled`, [from, to]);
    const rep = new Map((await db.all("SELECT service_id, COUNT(*) n FROM (SELECT service_id, user_id FROM mjt_service_purchases WHERE created_at >= $1 AND created_at < $2 GROUP BY service_id, user_id HAVING COUNT(*) > 1) x GROUP BY service_id", [from, to])).map((r) => [r.service_id, N(r.n)]));
    const anyRepeat = N((await db.get("SELECT COUNT(*) n FROM (SELECT user_id FROM mjt_service_purchases WHERE created_at >= $1 AND created_at < $2 GROUP BY user_id HAVING COUNT(*) > 1) x", [from, to]))?.n);
    const buyers = N((await db.get("SELECT COUNT(DISTINCT user_id) n FROM mjt_service_purchases WHERE created_at >= $1 AND created_at < $2", [from, to]))?.n);
    const items = rows.map((r) => ({ id: r.id, key: r.key, title: r.title, enabled: !!N(r.enabled), purchases: N(r.n), spent: format(r.gross), refunds: N(r.rn), refunded: format(r.ra), net: format(N(r.gross) - N(r.ra)), buyers: N(r.buyers), repeatBuyers: rep.get(r.id) || 0 }))
      .sort((a, b) => b.purchases - a.purchases || a.key.localeCompare(b.key));
    return { items, mostUsed: items[0]?.purchases ? items[0].key : null, leastUsed: items.length > 1 ? items[items.length - 1].key : null, buyers, repeatBuyers: anyRepeat,
      spenders: win.cls.spend.senders, spenderSharePct: pct(win.cls.spend.senders, bal.wallets), wallets: bal.wallets, enabledCount: items.filter((x) => x.enabled).length };
  }
  async function flowsOf(win, from, bal, active) {
    const c = win.cls;
    const inflow = c.new_issuance.in + c.legacy_issuance.in + c.admin_correction.in + c.refund.in + c.unclassified.in;
    const outflow = c.new_issuance.out + c.legacy_issuance.out + c.admin_correction.out + c.spend.out + c.refund.out + c.unclassified.out;
    const gap = inflow - outflow;
    const delta = N((await db.get("SELECT COALESCE(SUM(amount),0) s FROM mjt_entries WHERE user_id IS NOT NULL AND created_at >= $1", [from]))?.s);
    const start = bal.total - delta;
    return { inflow: format(inflow), outflow: format(outflow), gap: format(gap), circulation: { transfers: format(c.member_transfer.in), tips: format(c.tip.in) },
      inflowParts: { newIssuance: format(c.new_issuance.in), legacyIssuance: format(c.legacy_issuance.in), adminCredits: format(c.admin_correction.in), refunds: format(c.refund.in), unclassified: format(c.unclassified.in) },
      outflowParts: { spend: format(c.spend.out), legacyReversals: format(c.legacy_issuance.out), adminDebits: format(c.admin_correction.out), unclassified: format(c.unclassified.out) },
      unused: { start: format(start), end: format(bal.total), accumulated: format(delta), growthPct: start > 0 ? pct(delta, start) : null }, perActive: active ? { gap: format(Math.round(gap / active)), accumulated: format(Math.round(delta / active)) } : null, activeWallets: active };
  }
  async function seriesOf(p) {
    const P = PERIODS[p], now = clock().getTime(), edges = [];
    for (let i = P.buckets; i >= 0; i--) edges.push(new Date(now - i * P.ms).toISOString());
    const args = edges.slice(0, -1).reverse(); // newest first for the CASE
    const bucket = `CASE ${args.map((_, i) => `WHEN t.created_at >= $${i + 1} THEN ${P.buckets - 1 - i}`).join(" ")} END`;
    const rows = await db.all(`SELECT ${bucket} b, ${CASE_CLS} c, COALESCE(SUM(CASE WHEN e.amount > 0 THEN e.amount ELSE 0 END),0) uin, COALESCE(SUM(CASE WHEN e.amount < 0 THEN -e.amount ELSE 0 END),0) uout
      FROM mjt_tx t JOIN mjt_entries e ON e.tx_id=t.id AND e.user_id IS NOT NULL WHERE t.created_at >= $${args.length + 1} AND t.created_at < $${args.length + 2} GROUP BY 1, 2`, [...args, edges[0], FAR]);
    const pts = edges.slice(0, -1).map((start) => ({ start, issuedNew: 0, issuedLegacy: 0, spent: 0, refunded: 0 }));
    for (const r of rows) { const b = pts[N(r.b)]; if (!b) continue; if (r.c === "new_issuance") b.issuedNew += N(r.uin); else if (r.c === "legacy_issuance") b.issuedLegacy += N(r.uin); else if (r.c === "spend") b.spent += N(r.uout); else if (r.c === "refund") b.refunded += N(r.uin); }
    return { period: p, bucketDays: P.ms / DAY, points: pts.map((x) => ({ start: x.start, issuedNew: mjtNum(x.issuedNew), issuedLegacy: mjtNum(x.issuedLegacy), spent: mjtNum(x.spent), refunded: mjtNum(x.refunded) })) };
  }

  /* ---------- alerts (rule-based, all disabled until an admin sets a threshold) ---------- */
  async function alertsOf(ov, flows, srcs, recon, win, S) {
    const A0 = S.alerts, out = [];
    const rule = (key, threshold, value, triggered, detail) => out.push({ key, label: ALERT_AR[key], enabled: threshold !== null && threshold !== undefined, threshold, value, triggered: threshold !== null && threshold !== undefined && !!triggered, detail: detail || null });
    const day = await byClass(ago(DAY), FAR), dayIssued = day.cls.new_issuance.in + day.cls.legacy_issuance.in;
    rule("issuanceDailyMax", A0.issuanceDailyMax === null ? null : format(A0.issuanceDailyMax), format(dayIssued), A0.issuanceDailyMax !== null && dayIssued > A0.issuanceDailyMax);
    const use = ov.period.useRatePct; rule("useRateMinPct", A0.useRateMinPct, use, A0.useRateMinPct !== null && use !== null && use < A0.useRateMinPct, use === null ? "لا إصدار في الفترة" : null);
    const share = ov.concentration.sharePct; rule("top10ShareMaxPct", A0.top10ShareMaxPct, share, A0.top10ShareMaxPct !== null && share !== null && share > A0.top10ShareMaxPct);
    const g = flows.unused.growthPct;
    const grew = g === null ? Number(flows.unused.accumulated) > 0 : g > A0.unusedGrowthMaxPct;
    rule("unusedGrowthMaxPct", A0.unusedGrowthMaxPct, g, A0.unusedGrowthMaxPct !== null && grew, g === null ? "لا رصيد في بداية الفترة" : null);
    // source spikes: last 24 h vs the source's own average day over the 30 days before it
    const f = A0.sourceSpikeFactor, spikes = [];
    if (f !== null) {
      const recent = new Map((await db.all("SELECT source, COALESCE(SUM(amount),0) a FROM mjt_reward_entries WHERE kind='earn' AND status='posted' AND created_at >= $1 GROUP BY source", [ago(DAY)])).map((r) => [r.source, N(r.a)]));
      const base = new Map((await db.all("SELECT source, COALESCE(SUM(amount),0) a FROM mjt_reward_entries WHERE kind='earn' AND status='posted' AND created_at >= $1 AND created_at < $2 GROUP BY source", [ago(31 * DAY), ago(DAY)])).map((r) => [r.source, N(r.a) / 30]));
      for (const [k, a] of recent) { const avg = base.get(k) || 0; if (a > 0 && a > f * avg) spikes.push({ source: k, last24h: format(a), dailyAvg: format(Math.round(avg)), noBaseline: avg === 0 }); }
    }
    rule("sourceSpikeFactor", f, spikes.length, spikes.length > 0, spikes.length ? spikes : null);
    const corr = win.cls.admin_correction.tx; rule("correctionsMaxCount", A0.correctionsMaxCount, corr, A0.correctionsMaxCount !== null && corr > A0.correctionsMaxCount);
    rule("mismatch", A0.mismatch ? true : null, recon.mismatches.length, A0.mismatch && !recon.ok, recon.ok ? null : recon.mismatches.slice(0, 10).map((m) => m.account));
    for (const s of srcs.phase4) if (s.budget.monthly !== null) out.push({ key: "budget", source: s.key, label: `${ALERT_AR.budget}: ${s.label}`, enabled: true, threshold: s.budget.monthly, value: s.budget.used30d, triggered: s.budget.reached, detail: "تنبيه فقط — لا يُوقف المصدر تلقائياً" });
    return { items: out, triggered: out.filter((x) => x.triggered).length, evaluatedAt: nowIso(), note: "كل القواعد معطّلة حتى تحدد الإدارة قيمتها. التنبيه لا يغيّر أي حد ولا يوقف أي مصدر." };
  }
  /* ---------- recommendations (text only, never applied) ---------- */
  function recommendationsOf(ov, win, srcs, svc, alerts, recon) {
    const r = [], add = (id, text) => r.push({ id, text });
    const n = (s) => Number(s || 0);
    const legacyIn = win.cls.legacy_issuance.in, newIn = win.cls.new_issuance.in;
    if (!recon.ok) add("reconcile", `يوجد ${recon.mismatches.length} محفظة لا يطابق رصيدها مجموع حركاتها. راجع «التحقق من الدفتر» في إدارة مجتمع كوين قبل أي قرار.`);
    if (win.cls.unclassified.tx) add("unclassified", `هناك ${win.cls.unclassified.tx} حركة من نوع غير مصنّف في الفترة. راجع جدول التصنيف لمعرفة مصدرها.`);
    if (legacyIn > 0 && legacyIn >= newIn) add("legacy", `${pct(legacyIn, legacyIn + newIn)}% من إصدار الفترة جاء من المسارات القديمة (التعدين، الدخول اليومي، تحويل النقاط…). قرار إبقائها أو تعديلها لك، ولم يُغيَّر فيها شيء.`);
    if (!srcs.phase4.some((s) => s.enabled)) add("sources_off", "كل مصادر المكافآت الجديدة معطّلة؛ لا يوجد إصدار جديد إلا ما تفعّله أنت.");
    if (svc.enabledCount === 0 && n(ov.balances.total) > 0) add("no_services", "لا توجد خدمة MJT مفعّلة، فلا طريقة لاستخدام الأرصدة الحالية. فكّر في تفعيل خدمة موجودة بتكلفة تختارها من صفحة خدمات MJT.");
    else if (ov.period.useRatePct !== null && ov.period.useRatePct < 10) add("low_use", `نسبة استخدام الرصيد في الفترة ${ov.period.useRatePct}% فقط. قد تفيد مراجعة الخدمات المتاحة وتكاليفها.`);
    if (ov.concentration.sharePct !== null && ov.concentration.sharePct >= 50 && ov.concentration.holders >= 10) add("concentration", `أعلى ${ov.concentration.topWallets} محفظة تملك ${ov.concentration.sharePct}% من مجموع الأرصدة. راجع مصادر هذه الأرصدة.`);
    for (const s of srcs.phase4) if (s.budget.reached) add("budget_" + s.key, `مصدر «${s.label}» تجاوز ميزانيته الشهرية (${s.budget.used30d} من ${s.budget.monthly} MJT). يمكنك إيقافه يدوياً إن رأيت ذلك — لن يتوقف تلقائياً.`);
    if (win.cls.admin_correction.tx >= 5) add("corrections", `${win.cls.admin_correction.tx} تصحيحاً يدوياً في الفترة. راجع أسبابها في سجل الحركات.`);
    if (alerts.triggered) add("alerts", `${alerts.triggered} تنبيه نشط في الفترة — راجع قسم التنبيهات.`);
    if (!r.length) add("none", "لا توصيات الآن: الأرقام لا تُظهر ما يستدعي التدخل.");
    return { items: r, note: "اقتراحات نصية فقط مستخرجة من الأرقام — لا يُطبَّق أي تغيير تلقائياً." };
  }

  /* ---------- v2.163: legacy path switches next to their own ledger numbers (services/mjt-legacy.js) ---------- */
  async function legacyOf(all, win) {
    const LG = ctx.services.mjtLegacy; if (!LG) return null;
    const st = await LG.state();
    const sum = (rows, subs) => { const o = { in: 0, out: 0, tx: 0 }; for (const x of rows) if (subs.includes(x.cls + "|" + x.sub)) { o.in += x.in; o.out += x.out; o.tx += x.tx; } return { in: format(o.in), out: format(o.out), tx: o.tx }; };
    return { switches: [...st.paths, ...st.fixed].map((p) => ({ key: p.key, label: p.label, enabled: !!p.enabled, stored: p.fixed ? false : !!p.stored, envForcedOff: !!p.envForcedOff, fixed: !!p.fixed, period: sum(win.subs, p.subs), all: sum(all.subs, p.subs) })),
      updatedAt: st.updatedAt, note: st.note };
  }

  /* ---------- the dashboard ---------- */
  async function dashboard(q = {}) {
    const p = periodOf(q.period), P = PERIODS[p], from = ago(P.ms);
    const S = await settings();
    const [all, win, bal, active, conc, recon] = [await byClass(EPOCH, FAR), await byClass(from, FAR), await balances(), await activeWallets(), await concentration(), await reconciliation()];
    const ov = overviewOf(all, win, bal, active, conc);
    const srcs = await sourcesOf(win, S), svc = await servicesOf(from, FAR, bal, win), flows = await flowsOf(win, from, bal, active), series = await seriesOf(p);
    const alerts = await alertsOf(ov, flows, srcs, recon, win, S);
    const topSources = srcs.phase4.filter((s) => Number(s.period) > 0).sort((a, b) => Number(b.period) - Number(a.period)).slice(0, 5).map((s) => ({ key: s.key, label: s.label, issued: s.period }));
    return { note: NOTE, period: { key: p, label: P.ar, from, to: nowIso(), days: P.ms / DAY }, overview: ov, classes: classesOf(all, win), topSources, issuance: srcs, legacy: await legacyOf(all, win), services: svc, flows, series, alerts,
      recommendations: recommendationsOf(ov, win, srcs, svc, alerts, recon), reconciliation: recon, settings: settingsClient(S),
      definitions: { activeWallet: `محفظة لها حركة واحدة على الأقل في آخر ${ACTIVE_DAYS} يوماً`, concentration: "حصة أعلى 10% من المحافظ التي لديها رصيد من مجموع الأرصدة", useRate: "صافي الاستخدام في الخدمات (بعد الاسترداد) ÷ صافي الإصدار (الجديد + القديم) في الفترة", avgEarned: "إصدار الفترة ÷ عدد الأعضاء الذين تلقّوا إصداراً فيها", avgSpent: "استخدام الفترة ÷ عدد الأعضاء الذين استخدموا رصيداً فيها", balances: "مجموع الأرصدة الحالية في المحافظ — رقم مستقل لا يُجمع مع الإصدار" } };
  }
  async function mapping() {
    const seen = await db.all("SELECT kind, COUNT(*) n FROM mjt_tx GROUP BY kind ORDER BY kind");
    return { rules: RULES.map((r) => ({ kind: r.kind, ikeyPrefix: r.ikey || null, refType: r.ref || null, class: r.cls, classLabel: CLASS_AR[r.cls], sub: r.sub, label: r.ar })),
      seen: seen.map((r) => ({ kind: r.kind, count: N(r.n), known: KNOWN_KINDS.includes(r.kind), class: KNOWN_KINDS.includes(r.kind) ? null : "unclassified" })), classes: CLASSES.map((k) => ({ key: k, label: CLASS_AR[k] })) };
  }
  async function alertsOnly(q = {}) { const d = await dashboard(q); return { alerts: d.alerts, recommendations: d.recommendations }; }

  /* ---------- manual pause / resume of a phase-4 source (existing enable flag; legacy paths are not sources) ---------- */
  async function setSourceState(user, key, b = {}) {
    if (typeof b.enabled !== "boolean") throw fail(400, "enabled_required", "حدّد الإيقاف أو التشغيل");
    const s = await db.get("SELECT key FROM mjt_reward_sources WHERE key=$1", [String(key || "").slice(0, 40)]);
    if (!s) throw fail(404, "not_a_source", "هذا ليس مصدر مكافآت جديداً — للمسارات القديمة مفاتيحها الخاصة");
    const r = await RW().saveSource(user, s.key, { enabled: b.enabled }); // reuses the engine: audit, amount-required check
    ctx.audit?.(b.enabled ? "mjt_economy_source_resumed" : "mjt_economy_source_paused", s.key, str(b.reason, 300) || null, user.id);
    return r;
  }

  /* ---------- simulation (pure: reads baselines, writes nothing) ---------- */
  async function simulate(b = {}) {
    const num = (v, lo, hi, d) => { if (v === undefined || v === null || v === "") return d; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw fail(400, "bad_assumption", `قيمة افتراض خارج المدى (${lo} إلى ${hi})`); return n; };
    const a = { memberGrowthPct: num(b.memberGrowthPct, -100, 1000, 0), activityPct: num(b.activityPct, -100, 1000, 0), rewardRatePct: num(b.rewardRatePct, -100, 1000, 0), serviceCostPct: num(b.serviceCostPct, -100, 1000, 0), serviceUsagePct: num(b.serviceUsagePct, -100, 1000, 0), months: Math.floor(num(b.months, 1, 24, 6)) };
    const win = await byClass(ago(30 * DAY), FAR), bal = await balances(), active = await activeWallets();
    const base = { newIssued: win.cls.new_issuance.in - win.cls.new_issuance.out, legacyIssued: win.cls.legacy_issuance.in - win.cls.legacy_issuance.out, spent: Math.max(0, win.cls.spend.out - win.cls.refund.in), balance: bal.total, activeWallets: active };
    const act = 1 + a.activityPct / 100, months = [];
    let balance = base.balance, members = active;
    for (let m = 1; m <= a.months; m++) {
      const grow = Math.pow(1 + a.memberGrowthPct / 100, m);
      const newI = Math.max(0, Math.round(base.newIssued * grow * act * (1 + a.rewardRatePct / 100)));
      const legI = Math.max(0, Math.round(base.legacyIssued * grow * act)); // legacy amounts are fixed in code: the reward-rate assumption does not apply
      const spend = Math.min(balance + newI + legI, Math.max(0, Math.round(base.spent * grow * act * (1 + a.serviceCostPct / 100) * (1 + a.serviceUsagePct / 100))));
      balance = balance + newI + legI - spend; members = Math.round(active * grow);
      months.push({ month: m, activeWallets: members, issuedNew: format(newI), issuedLegacy: format(legI), spent: format(spend), balance: format(balance), useRatePct: newI + legI > 0 ? pct(spend, newI + legI) : null });
    }
    return { hypothetical: true, label: "افتراضي", note: SIM_NOTE, assumptions: a,
      baseline: { windowDays: 30, newIssued: format(base.newIssued), legacyIssued: format(base.legacyIssued), netSpent: format(base.spent), balance: format(base.balance), activeWallets: base.activeWallets }, months };
  }

  /* ---------- CSV exports (audited) ---------- */
  const cell = (v) => { const s = String(v ?? ""); if (/^-?\d+(\.\d+)?$/.test(s)) return s; return /[",\n\r]/.test(s) || /^[=+\-@\t\r]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
  const csv = (head, rows) => "\ufeff" + [head.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
  const TABLES = ["summary", "classes", "sources", "legacy", "services", "flows", "series", "alerts", "reconciliation", "mapping"];
  async function exportCsv(req, res) {
    const table = String(req.query.table || "summary"); if (!TABLES.includes(table)) throw fail(400, "bad_table", "جدول غير معروف");
    const d = await dashboard(req.query), p = d.period.key;
    let body;
    if (table === "summary") { const o = d.overview; body = csv(["metric", "value"], [["period", p], ["from", d.period.from], ["to", d.period.to], ...Object.entries(o.cumulative).map(([k, v]) => ["all_time." + k, v]), ["balances.total (not issued)", o.balances.total], ["wallets", o.balances.wallets], ["active_wallets_" + ACTIVE_DAYS + "d", o.activeWallets], ...Object.entries(o.period).map(([k, v]) => ["period." + k, v ?? ""]), ["concentration.top10_share_pct", o.concentration.sharePct ?? ""]]); }
    else if (table === "classes") body = csv(["class", "label", "sub", "sub_label", "period_in", "period_out", "period_tx", "all_in", "all_out", "all_tx"], d.classes.flatMap((c) => [[c.key, c.label, "", "", c.period.in, c.period.out, c.period.tx, c.all.in, c.all.out, c.all.tx], ...c.subs.map((s) => [c.key, c.label, s.sub, s.label, s.period.in, s.period.out, s.period.tx, s.all.in, s.all.out, s.all.tx])]));
    else if (table === "sources") body = csv(["source", "label", "enabled", "amount", "daily_cap", "day_count", "day_peak_member", "weekly_cap", "week_count", "week_peak_member", "monthly_cap", "month_count", "month_peak_member", "item_cap", "item_peak", "period_issued", "all_time_issued", "pending", "monthly_budget", "used_30d"], d.issuance.phase4.map((s) => [s.key, s.label, s.enabled ? 1 : 0, s.amount ?? "", s.caps.day.cap ?? "", s.caps.day.count, s.caps.day.peakPerMember, s.caps.week.cap ?? "", s.caps.week.count, s.caps.week.peakPerMember, s.caps.month.cap ?? "", s.caps.month.count, s.caps.month.peakPerMember, s.caps.item.cap ?? "", s.caps.item.peakPerMember, s.period, s.allTime.issued, s.pending, s.budget.monthly ?? "", s.budget.used30d]));
    else if (table === "legacy") body = csv(["sub", "label", "period_in", "period_out", "period_tx", "all_in", "all_out", "all_tx"], (d.classes.find((c) => c.key === "legacy_issuance")?.subs || []).map((s) => [s.sub, s.label, s.period.in, s.period.out, s.period.tx, s.all.in, s.all.out, s.all.tx]));
    else if (table === "services") body = csv(["service", "title", "enabled", "purchases", "spent", "refunds", "refunded", "net", "buyers", "repeat_buyers"], d.services.items.map((s) => [s.key, s.title, s.enabled ? 1 : 0, s.purchases, s.spent, s.refunds, s.refunded, s.net, s.buyers, s.repeatBuyers]));
    else if (table === "flows") { const f = d.flows; body = csv(["metric", "value"], [["inflow", f.inflow], ["outflow", f.outflow], ["gap", f.gap], ...Object.entries(f.inflowParts).map(([k, v]) => ["inflow." + k, v]), ...Object.entries(f.outflowParts).map(([k, v]) => ["outflow." + k, v]), ["circulation.transfers", f.circulation.transfers], ["circulation.tips", f.circulation.tips], ["unused.start", f.unused.start], ["unused.end", f.unused.end], ["unused.accumulated", f.unused.accumulated], ["unused.growth_pct", f.unused.growthPct ?? ""], ["per_active.gap", f.perActive?.gap ?? ""], ["active_wallets", f.activeWallets]]); }
    else if (table === "series") body = csv(["bucket_start", "issued_new", "issued_legacy", "spent", "refunded"], d.series.points.map((x) => [x.start, x.issuedNew, x.issuedLegacy, x.spent, x.refunded]));
    else if (table === "alerts") body = csv(["rule", "label", "enabled", "threshold", "value", "triggered"], d.alerts.items.map((a) => [a.key + (a.source ? ":" + a.source : ""), a.label, a.enabled ? 1 : 0, a.threshold ?? "", typeof a.value === "object" ? JSON.stringify(a.value) : a.value ?? "", a.triggered ? 1 : 0]));
    else if (table === "reconciliation") body = csv(["account", "handle", "stored_balance", "ledger_sum", "diff"], d.reconciliation.mismatches.map((m) => [m.account, m.handle || "", m.stored, m.ledger, m.diff]));
    else { const m = await mapping(); body = csv(["kind", "ikey_prefix", "ref_type", "class", "sub", "label"], m.rules.map((r) => [r.kind, r.ikeyPrefix || "", r.refType || "", r.class, r.sub, r.label])); }
    ctx.audit?.("mjt_economy_export", table, p, req.user.id);
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="mjt-economy-${table}-${p}-${nowIso().slice(0, 10)}.csv"` });
    res.end(body); return ctx.STREAM;
  }

  /* ---------- routes ---------- */
  R.get("/api/admin/mjt/economy", admin(async (req) => dashboard(req.query)));
  R.get("/api/admin/mjt/economy/mapping", admin(async () => mapping()));
  R.get("/api/admin/mjt/economy/alerts", admin(async (req) => alertsOnly(req.query)));
  R.get("/api/admin/mjt/economy/reconciliation", admin(async () => reconciliation()));
  R.get("/api/admin/mjt/economy/settings", admin(async () => ({ settings: settingsClient(await settings()) })));
  R.put("/api/admin/mjt/economy/settings", admin(async (req) => saveSettings(req.user, req.body || {})));
  R.post("/api/admin/mjt/economy/sources/:key/state", admin(async (req) => setSourceState(req.user, req.params.key, req.body || {})));
  R.post("/api/admin/mjt/economy/simulate", admin(async (req) => simulate(req.body || {})));
  R.get("/api/admin/mjt/economy/export.csv", admin(async (req, res) => exportCsv(req, res)));

  return { classify, RULES, CLASSES, KNOWN_KINDS, ACTIVE_DAYS, dashboard, mapping, reconciliation, concentration, activeWallets, simulate, settings, saveSettings, byClass };
};
module.exports.classify = classify;
module.exports.RULES = RULES;
module.exports.CLASSES = CLASSES;
