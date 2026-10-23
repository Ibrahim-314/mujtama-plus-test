/* Financial transparency (phase 60). Everything here is READ from the append-only double-entry ledger (lib/ledger.js:
 * ledger_journals + ledger_entries) and pi_transactions; the only writes are the derived documents in finance_invoices.
 *  1. Account statement per member: every Pi line on their accounts — wallet payments (user:<id>:pi_out: tips, subscriptions,
 *     paid posts, market + digital orders, ads, AI plan, transfers) and balances owed to them (creator / seller earnings,
 *     received transfers, points rewards) incl. refunds, reversals and payouts — with date / category filters, totals and CSV.
 *  2. Documents with sequential, gap-free numbers per series and year, issued in journal order: INV (you paid), CN (credit
 *     note: Pi credited back), RC (payout receipt). Printable Arabic RTL HTML (PDF via the browser's «print → save as PDF»).
 *  3. Annual summary per member (spent by category, refunds) and per creator (earned by category, fees, reversals, payouts,
 *     month by month, distinct supporters).
 *  4. Public platform transparency report (aggregate only, k-anonymous: a month / category / reserve figure is published only
 *     when at least K distinct members are behind it): volume, platform fees, payouts, refunds, reserves. /transparency/finance.
 *  5. Admin reconciliation: ledger vs Pi payments (missing journal, amount mismatch, refunded but not reversed, orphan journal)
 *     + the ledger integrity check (balanced journals).
 * Works with Pi payments off: no journals → empty statements / reports with an explanatory note. */
const { E, HttpError, str } = require("../lib/core");
const { SEC_HEADERS } = require("../lib/http");
const { U, toUnits, pi } = require("../lib/ledger");

const DAY = 864e5;
const CATS = { tips: "الإكراميات", subs: "الدعم والاشتراكات", paid: "المحتوى المدفوع", market: "السوق", digital: "المنتجات الرقمية", ads: "الإعلانات", ai: "اشتراك الذكاء", transfers: "التحويلات", rewards: "مكافآت النقاط", other: "أخرى" };
const KINDS = {
  tip: "إكرامية", tip_hold: "إكرامية (قيد المراجعة)", tip_release: "إكرامية بعد المراجعة", support: "دعم شهري / اشتراك مبدع", ppv: "شراء منشور مدفوع",
  market_hold: "طلب من السوق (في الضمان)", market_release: "تسليم طلب السوق", market_refund: "استرداد طلب السوق", market_split: "تسوية نزاع في السوق",
  ads_fund: "تمويل حملة إعلانية", ads_charge: "إنفاق إعلاني", ads_refund: "استرداد ميزانية إعلان", ai_subscription: "اشتراك «مجتمع+ ذكاء»",
  transfer: "تحويل Pi", transfer_hold: "تحويل Pi (قيد المراجعة)", transfer_release: "تحويل Pi بعد المراجعة", transfer_payout: "صرف رصيد التحويلات إلى محفظتك",
  rewards_fund: "تمويل صندوق المكافآت", rewards_redeem: "استبدال نقاط المساهمة", rewards_payout: "صرف مكافأة النقاط إلى محفظتك", reversal: "عكس / استرداد"
};
const SERIES = { INV: "فاتورة", CN: "إشعار دائن", RC: "إيصال صرف" };
const PLATFORM_REV = ["platform:fees", "platform:ai", "platform:ads"];
const LEDGER_PURPOSES = ["tip", "subscription", "ppv", "market", "ads", "ai", "transfer", "jobs", "contract"];
const OUT_RE = /^user:(.+):pi_out$/;
const BAL_RE = /^(creator:.+:earnings|seller:.+:earnings|work:.+:earnings|user:.+:transfers|user:.+:rewards)$/;
const accLabel = (a) => OUT_RE.test(a) ? "محفظتك (مدفوعاتك)" : /^creator:/.test(a) ? "أرباحك كمبدع" : /^seller:/.test(a) ? "أرباحك من السوق" : /^work:/.test(a) ? "أرباحك من العقود" : /:transfers$/.test(a) ? "رصيد التحويلات" : /:rewards$/.test(a) ? "مكافآت النقاط" : a;
const catOf = (j, digital) => ({ tip: "tips", support: "subs", ppv: "paid", ads: "ads", ai: "ai", transfer: "transfers", rewards: "rewards" })[j.source] || (j.source === "market" ? (digital.has(j.ref_id) ? "digital" : "market") : "other");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (u) => (Number(u || 0) / U).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 7 });

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const K = Math.max(2, +(env.FINANCE_K_ANON || 5));
  const isStaff = (u) => !!u && ["admin", "moderator"].includes(u.role);
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const piOn = () => { const d = ctx.services.pi?.diag?.(); return !!(d && d.enabled && d.apiKeyPresent); };
  const PI_OFF_NOTE = "مدفوعات Pi غير مفعّلة بعد، لذلك لا توجد حركات مالية. ستظهر هنا تلقائياً فور تفعيلها.";

  /* ---------- helpers ---------- */
  function range(q = {}) {
    const d = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(Date.parse(v)) ? v : null);
    let from = d(q.from), to = d(q.to);
    if (q.year && /^\d{4}$/.test(String(q.year))) { from = `${q.year}-01-01`; to = `${q.year}-12-31`; }
    const f = from ? new Date(from + "T00:00:00Z").toISOString() : "1970-01-01T00:00:00.000Z";
    const t = to ? new Date(Date.parse(to + "T00:00:00Z") + DAY).toISOString() : new Date(clock().getTime() + DAY).toISOString();
    if (f >= t) throw E.bad("نطاق التاريخ غير صالح");
    return { from: from || null, to: to || null, f, t };
  }
  async function usersMap(ids) {
    const m = new Map(), list = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < list.length; i += 200) {
      const part = list.slice(i, i + 200);
      for (const u of await db.all(`SELECT id, handle, name FROM users WHERE id IN (${part.map((_, k) => "$" + (k + 1)).join(",")})`, part)) m.set(u.id, { handle: u.handle, name: u.name });
    }
    return m;
  }
  async function digitalSet(refIds) {
    const s = new Set(), list = [...new Set(refIds.filter(Boolean))];
    for (let i = 0; i < list.length; i += 200) {
      const part = list.slice(i, i + 200);
      try { for (const r of await db.all(`SELECT o.id FROM market_orders o JOIN market_listings l ON l.id=o.listing_id WHERE l.kind='digital' AND o.id IN (${part.map((_, k) => "$" + (k + 1)).join(",")})`, part)) s.add(r.id); } catch { /* market tables missing */ }
    }
    return s;
  }
  async function marketSellers(refIds) {
    const m = new Map(), list = [...new Set(refIds.filter(Boolean))];
    for (let i = 0; i < list.length; i += 200) {
      const part = list.slice(i, i + 200);
      try { for (const r of await db.all(`SELECT id, seller_id FROM market_orders WHERE id IN (${part.map((_, k) => "$" + (k + 1)).join(",")})`, part)) m.set(r.id, r.seller_id); } catch { /* none */ }
    }
    return m;
  }
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) || /^[=+\-@\t\r]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };

  /* ======================= 2. documents (invoices / credit notes / receipts) ======================= */
  function docFor(j, entries) {
    const outDebit = entries.filter((e) => OUT_RE.test(e.account) && Number(e.debit) > 0);
    const outCredit = entries.filter((e) => OUT_RE.test(e.account) && Number(e.credit) > 0);
    const payout = entries.filter((e) => e.account === "platform:payouts" && Number(e.credit) > 0);
    const fee = entries.filter((e) => e.account === "platform:fees").reduce((s, e) => s + Number(e.credit) - Number(e.debit), 0);
    if (j.kind !== "reversal" && outDebit.length) return { series: "INV", payer: OUT_RE.exec(outDebit[0].account)[1], amount: outDebit.reduce((s, e) => s + Number(e.debit), 0), fee: Math.max(0, fee) };
    if (outCredit.length) return { series: "CN", payer: OUT_RE.exec(outCredit[0].account)[1], amount: outCredit.reduce((s, e) => s + Number(e.credit), 0), fee: 0 };
    if (payout.length) { const bal = entries.find((e) => BAL_RE.test(e.account) && Number(e.debit) > 0); if (bal) return { series: "RC", payer: null, payee: bal.user_id, amount: payout.reduce((s, e) => s + Number(e.credit), 0), fee: 0 }; }
    return null;
  }
  let issuing = null;
  function issueAll() { return (issuing ||= issueRun().finally(() => { issuing = null; })); }
  async function issueRun() {
    let issued = 0;
    for (let round = 0; round < 20; round++) {
      const js = await db.all(`SELECT j.* FROM ledger_journals j LEFT JOIN finance_invoices f ON f.journal_id=j.id WHERE f.id IS NULL
        AND EXISTS (SELECT 1 FROM ledger_entries e WHERE e.journal_id=j.id AND (e.account LIKE 'user:%:pi_out' OR e.account='platform:payouts')) ORDER BY j.created_at, j.id LIMIT 200`);
      if (!js.length) break;
      const sellers = await marketSellers(js.filter((j) => j.source === "market").map((j) => j.ref_id)), digital = await digitalSet(js.filter((j) => j.source === "market").map((j) => j.ref_id));
      let progressed = 0;
      const batch = [];
      for (const j of js) { const entries = await db.all("SELECT account, user_id, debit, credit FROM ledger_entries WHERE journal_id=$1 ORDER BY id", [j.id]); batch.push({ j, d: docFor(j, entries) }); }
      // series are numbered independently, so credit notes go after the invoices of the same batch (their creditOf link exists then)
      batch.sort((x, y) => (x.d?.series === "CN") - (y.d?.series === "CN"));
      for (const { j, d } of batch) {
        const year = Number(String(j.created_at).slice(0, 4)) || clock().getUTCFullYear();
        let payee = d?.payee || j.creator_id || (j.source === "market" ? sellers.get(j.ref_id) : null) || null;
        if (d && d.series === "CN" && payee === d.payer) payee = null;
        const series = d ? d.series : "NONE";
        let creditOf = null;
        if (d?.series === "CN") {
          const orig = j.reverses ? await db.get("SELECT id FROM finance_invoices WHERE journal_id=$1", [j.reverses]) : null;
          creditOf = orig?.id || (await db.get("SELECT id FROM finance_invoices WHERE ref_id=$1 AND series='INV' ORDER BY seq LIMIT 1", [j.ref_id]))?.id || null;
        }
        const ok = await db.tx(async (t) => {
          await t.run("INSERT INTO finance_counters(series, year, n) VALUES($1,$2,0) ON CONFLICT DO NOTHING", [series, year]);
          const c = await t.get("UPDATE finance_counters SET n=n+1 WHERE series=$1 AND year=$2 RETURNING n", [series, year]); // row lock: one issuer at a time per series/year
          if (await t.get("SELECT 1 x FROM finance_invoices WHERE journal_id=$1", [j.id])) throw Object.assign(new Error("dup"), { dup: true });
          const n = Number(c.n), number = `${series}-${year}-${String(n).padStart(6, "0")}`;
          await t.run("INSERT INTO finance_invoices(id, number, series, year, seq, journal_id, ref_id, kind, source, category, payer_id, payee_id, amount, fee, credit_of, pi_tx, journal_at, issued_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
            ["fi_" + j.id, number, series, year, n, j.id, j.ref_id, j.kind, j.source, catOf(j, digital), d ? d.payer : null, payee, d ? d.amount : 0, d ? d.fee : 0, creditOf, j.pi_tx || null, j.created_at, nowIso()]);
          return true;
        }).catch((e) => { if (e.dup) return false; throw e; });
        if (ok) { progressed++; if (d) issued++; }
      }
      if (!progressed) break;
    }
    return issued;
  }
  async function docJson(row, viewer) {
    const um = await usersMap([row.payer_id, row.payee_id]);
    const j = await db.get("SELECT anonymous, memo FROM ledger_journals WHERE id=$1", [row.journal_id]);
    const anonymous = !!j?.anonymous && viewer?.id !== row.payer_id && !isStaff(viewer);
    const party = (uid, isPayer) => (uid ? (isPayer && anonymous ? { name: "داعم مجهول" } : um.get(uid) || { name: "عضو" }) : { name: "مجتمع بلس", platform: true });
    const credit = row.credit_of ? await db.get("SELECT number FROM finance_invoices WHERE id=$1", [row.credit_of]) : null;
    const amount = Number(row.amount), fee = Number(row.fee);
    return {
      id: row.id, number: row.number, series: row.series, title: SERIES[row.series], kind: row.kind, label: KINDS[row.kind] || row.kind, category: row.category, categoryLabel: CATS[row.category] || row.category,
      journalAt: row.journal_at, issuedAt: row.issued_at, payer: party(row.payer_id, true), payee: party(row.payee_id, false), mine: viewer ? { payer: viewer.id === row.payer_id, payee: viewer.id === row.payee_id } : null,
      amount: pi(amount), fee: pi(fee), net: pi(amount - fee), currency: "PI", piTx: row.pi_tx || null, creditOf: credit?.number || null, ref: row.ref_id,
      html: `/api/finance/invoices/${encodeURIComponent(row.id)}/html`
    };
  }
  async function docRow(idOrNumber, viewer) {
    const row = await db.get("SELECT * FROM finance_invoices WHERE (id=$1 OR number=$1) AND series<>'NONE'", [String(idOrNumber || "")]);
    if (!row) throw E.nf();
    if (!isStaff(viewer) && viewer.id !== row.payer_id && viewer.id !== row.payee_id) throw E.nf();
    return row;
  }
  async function listDocs(user, q = {}) {
    await issueAll();
    const r = range(q);
    const rows = await db.all("SELECT * FROM finance_invoices WHERE series<>'NONE' AND (payer_id=$1 OR payee_id=$1) AND journal_at >= $2 AND journal_at < $3 ORDER BY journal_at DESC, seq DESC LIMIT 500", [user.id, r.f, r.t]);
    const items = []; for (const x of rows) items.push(await docJson(x, user));
    return { items, from: r.from, to: r.to, note: items.length ? null : piOn() ? "لا مستندات في هذه الفترة." : PI_OFF_NOTE };
  }
  function docHtml(d) {
    const who = (p) => `${esc(p.name)}${p.handle ? ` <bdi dir="ltr">@${esc(p.handle)}</bdi>` : ""}`;
    const date = (iso) => { try { return new Intl.DateTimeFormat("ar", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " (UTC)"; } catch { return iso; } };
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)} ${esc(d.number)} · مجتمع بلس</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f6f5fb;color:#1d1b26;font:16px/1.8 "IBM Plex Sans Arabic","Noto Naskh Arabic",system-ui,sans-serif}main{max-width:720px;margin:24px auto;background:#fff;border:1px solid #e6e2f2;border-radius:16px;padding:28px}
h1{margin:0;font-size:24px}.top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;border-bottom:2px solid #5b2bd6;padding-bottom:14px}.brand{font-weight:800;color:#5b2bd6;font-size:20px}
.num{font-family:ui-monospace,monospace;direction:ltr;unicode-bidi:isolate}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}.grid h2{font-size:14px;color:#5f5b73;margin:0 0 4px}
table{width:100%;border-collapse:collapse;margin:12px 0}th,td{padding:10px 8px;border-bottom:1px solid #e6e2f2;text-align:start}td.amt,th.amt{text-align:end;direction:ltr;unicode-bidi:isolate}tfoot td{font-weight:800;font-size:18px;border-bottom:0}
.meta{color:#5f5b73;font-size:13px}.stamp{display:inline-block;padding:2px 10px;border-radius:999px;background:#ede7ff;color:#5b2bd6;font-weight:700;font-size:13px}
@media print{body{background:#fff}main{border:0;margin:0;max-width:none;padding:0}@page{size:A4;margin:16mm}}@media(max-width:560px){.grid{grid-template-columns:1fr}}</style></head>
<body><main><div class="top"><div><div class="brand">مجتمع بلس</div><div class="meta">منصة اجتماعية عربية على Pi Network</div></div><div style="text-align:end"><h1>${esc(d.title)}</h1><div class="num">${esc(d.number)}</div><span class="stamp">${esc(d.categoryLabel)}</span></div></div>
<div class="grid"><section><h2>${d.series === "RC" ? "الجهة الصارفة" : "الدافع"}</h2>${who(d.series === "CN" ? d.payee : d.payer)}</section><section><h2>${d.series === "RC" ? "المستلم" : d.series === "CN" ? "المستفيد من الاسترداد" : "المستفيد"}</h2>${who(d.series === "CN" ? d.payer : d.payee)}</section>
<section><h2>تاريخ العملية</h2>${esc(date(d.journalAt))}</section><section><h2>تاريخ الإصدار</h2>${esc(date(d.issuedAt))}</section></div>
<table><thead><tr><th scope="col">البيان</th><th scope="col" class="amt">المبلغ (π)</th></tr></thead><tbody><tr><td>${esc(d.label)}${d.creditOf ? ` — عن الفاتورة <span class="num">${esc(d.creditOf)}</span>` : ""}</td><td class="amt">${fmt(d.amount * U)}</td></tr>
${d.fee > 0 ? `<tr><td>منها رسوم المنصة</td><td class="amt">${fmt(d.fee * U)}</td></tr><tr><td>صافي المستفيد</td><td class="amt">${fmt(d.net * U)}</td></tr>` : ""}</tbody>
<tfoot><tr><td>الإجمالي</td><td class="amt">${fmt(d.amount * U)} π</td></tr></tfoot></table>
<p class="meta">العملة: Pi (π). ${d.piTx ? `مرجع الدفع: <span class="num">${esc(d.piTx)}</span>. ` : ""}مرجع العملية: <span class="num">${esc(d.ref || "")}</span>. هذا المستند مُولَّد من السجل المحاسبي للمنصة ولا يُعدَّل بعد إصداره؛ أي استرداد يصدر له إشعار دائن مستقل.</p>
<p class="meta">للطباعة أو الحفظ PDF: استخدم «طباعة» في المتصفح ثم «حفظ بصيغة PDF».</p></main></body></html>`;
  }

  /* ======================= 1. statement ======================= */
  async function statementData(user, q = {}) {
    await issueAll();
    const r = range(q);
    const rows = await db.all(`SELECT e.id eid, e.account, e.debit, e.credit, e.created_at at, j.id jid, j.kind, j.source, j.ref_id, j.creator_id, j.sender_id, j.anonymous, j.reverses, j.memo
      FROM ledger_entries e JOIN ledger_journals j ON j.id=e.journal_id WHERE e.user_id=$1 AND e.created_at >= $2 AND e.created_at < $3 ORDER BY e.created_at DESC, e.id DESC LIMIT 5000`, [user.id, r.f, r.t]);
    const own = rows.filter((x) => OUT_RE.test(x.account) || BAL_RE.test(x.account));
    const digital = await digitalSet(own.filter((x) => x.source === "market").map((x) => x.ref_id)), sellers = await marketSellers(own.filter((x) => x.source === "market").map((x) => x.ref_id));
    const um = await usersMap(own.flatMap((x) => [x.creator_id, x.sender_id, sellers.get(x.ref_id)]));
    const docs = new Map((await db.all("SELECT journal_id, id, number FROM finance_invoices WHERE series<>'NONE' AND (payer_id=$1 OR payee_id=$1)", [user.id])).map((d) => [d.journal_id, d]));
    const rev = new Map();
    for (const x of own) if (x.reverses && !rev.has(x.reverses)) { const o = await db.get("SELECT kind FROM ledger_journals WHERE id=$1", [x.reverses]); rev.set(x.reverses, o?.kind); }
    const cat = q.category && CATS[q.category] ? q.category : null;
    const totals = { paid: 0, refunds: 0, earned: 0, reversed: 0, paidOut: 0 }, byCategory = {};
    const lines = [];
    for (const x of own) {
      const c = catOf(x, digital); if (cat && c !== cat) continue;
      const debit = Number(x.debit), credit = Number(x.credit), wallet = OUT_RE.test(x.account), dir = credit > debit ? "in" : "out", amount = Math.abs(credit - debit);
      const kindLabel = x.kind === "reversal" ? `عكس: ${KINDS[rev.get(x.reverses)] || "عملية سابقة"}` : KINDS[x.kind] || x.kind;
      if (wallet) { if (dir === "out") totals.paid += amount; else totals.refunds += amount; }
      else if (dir === "in") totals.earned += amount; else if (x.kind === "reversal") totals.reversed += amount; else totals.paidOut += amount;
      const b = (byCategory[c] ||= { in: 0, out: 0 }); b[dir] += amount;
      const otherId = x.sender_id === user.id ? x.creator_id || (x.source === "market" ? sellers.get(x.ref_id) : null) : x.sender_id;
      const counterparty = otherId && otherId !== user.id ? (x.anonymous && otherId === x.sender_id ? { name: "داعم مجهول" } : um.get(otherId) || null) : null;
      const d = docs.get(x.jid);
      lines.push({ id: Number(x.eid), at: x.at, journalId: x.jid, kind: x.kind, label: kindLabel, category: c, categoryLabel: CATS[c], account: wallet ? "wallet" : "balance", accountLabel: accLabel(x.account), direction: dir, amount: pi(amount), signed: pi(credit - debit), counterparty, refId: x.ref_id, document: d ? { id: d.id, number: d.number } : null });
    }
    return { lines, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, pi(v)])), net: pi(totals.refunds + totals.earned - totals.paid - totals.reversed), byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { label: CATS[k], in: pi(v.in), out: pi(v.out) }])), from: r.from, to: r.to, category: cat };
  }
  async function statement(user, q = {}) {
    const s = await statementData(user, q);
    const lim = Math.min(100, Math.max(1, +q.limit || 50)), off = Math.max(0, +q.cursor || 0);
    const page = s.lines.slice(off, off + lim);
    return { ...s, lines: page, count: s.lines.length, next: off + lim < s.lines.length ? String(off + lim) : null, categories: Object.entries(CATS).map(([key, label]) => ({ key, label })), piEnabled: piOn(), note: s.lines.length ? null : piOn() ? "لا حركات في هذه الفترة." : PI_OFF_NOTE };
  }
  async function statementCsv(req, res) {
    const s = await statementData(req.user, req.query);
    const head = ["date", "type", "category", "account", "direction", "amount_pi", "counterparty", "document", "reference"];
    const body = "\ufeff" + [head.join(","), ...s.lines.map((l) => [l.at, l.label, l.categoryLabel, l.accountLabel, l.direction === "in" ? "وارد" : "صادر", l.signed, l.counterparty ? (l.counterparty.handle ? "@" + l.counterparty.handle : l.counterparty.name) : "", l.document?.number || "", l.refId].map(csvCell).join(","))].join("\r\n");
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="statement-${s.from || "all"}-${s.to || "now"}.csv"` });
    res.end(body); return ctx.STREAM;
  }

  /* ======================= 3. annual summary ======================= */
  async function annual(user, year) {
    const y = /^\d{4}$/.test(String(year || "")) ? Number(year) : clock().getUTCFullYear();
    const s = await statementData(user, { year: y });
    const member = { paid: 0, refunds: 0, byCategory: {} }, creator = { earned: 0, reversed: 0, fees: 0, paidOut: 0, byCategory: {}, monthly: Array(12).fill(0), supporters: 0 };
    const supporters = new Set();
    for (const l of s.lines) {
      const u = toUnits(l.amount), b = (o) => (o.byCategory[l.category] ||= { label: l.categoryLabel, amount: 0 });
      if (l.account === "wallet") { if (l.direction === "out") { member.paid += u; b(member).amount += u; } else member.refunds += u; }
      else if (l.direction === "in") { creator.earned += u; b(creator).amount += u; creator.monthly[Number(l.at.slice(5, 7)) - 1] += u; if (l.counterparty) supporters.add(l.counterparty.handle || "anon:" + l.journalId); }
      else if (l.kind === "reversal") creator.reversed += u; else creator.paidOut += u;
    }
    const f = await db.get(`SELECT COALESCE(SUM(fee),0) f FROM finance_invoices WHERE payee_id=$1 AND series='INV' AND year=$2`, [user.id, y]);
    creator.fees = Number(f?.f || 0); creator.supporters = supporters.size;
    const docs = await db.get("SELECT COUNT(*) n FROM finance_invoices WHERE series<>'NONE' AND (payer_id=$1 OR payee_id=$1) AND year=$2", [user.id, y]);
    const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? pi(v) : Array.isArray(v) ? v.map(pi) : k === "byCategory" ? Object.fromEntries(Object.entries(v).map(([c, x]) => [c, { label: x.label, amount: pi(x.amount) }])) : v]));
    const out = { year, member: { ...P(member), net: pi(member.paid - member.refunds) }, creator: { ...P(creator), supporters: creator.supporters, net: pi(creator.earned - creator.reversed) }, isCreator: creator.earned > 0, documents: Number(docs?.n || 0), user: { handle: user.handle, name: user.name }, generatedAt: nowIso(), piEnabled: piOn() };
    out.year = y; out.note = s.lines.length ? null : piOn() ? "لا حركات مالية في هذه السنة." : PI_OFF_NOTE;
    return out;
  }

  /* ======================= 4. public transparency (aggregate, k-anonymous) ======================= */
  const tCache = new Map();
  async function transparency(year) {
    const y = /^\d{4}$/.test(String(year || "")) ? Number(year) : clock().getUTCFullYear();
    const hit = tCache.get(y); if (hit && hit.at > Date.now() - 10 * 60e3) return hit.v;
    const f = `${y}-01-01T00:00:00.000Z`, t = `${y + 1}-01-01T00:00:00.000Z`;
    const rows = await db.all(`SELECT e.account, e.user_id, e.debit, e.credit, e.created_at at, j.kind, j.source, j.ref_id FROM ledger_entries e JOIN ledger_journals j ON j.id=e.journal_id WHERE e.created_at >= $1 AND e.created_at < $2`, [f, t]);
    const digital = await digitalSet(rows.filter((x) => x.source === "market").map((x) => x.ref_id));
    const zero = () => ({ volume: 0, fees: 0, payouts: 0, refunds: 0, payers: new Set(), recipients: new Set() });
    const months = Array.from({ length: 12 }, zero), year_ = zero(), cats = {};
    for (const x of rows) {
      const m = months[Number(String(x.at).slice(5, 7)) - 1], d = Number(x.debit), c = Number(x.credit);
      for (const b of [m, year_]) {
        if (OUT_RE.test(x.account)) { if (d > 0 && x.kind !== "reversal") { b.volume += d; b.payers.add(x.user_id); } if (c > 0) b.refunds += c; }
        if (PLATFORM_REV.includes(x.account)) b.fees += c - d;
        if (x.account === "platform:payouts") b.payouts += c - d;
        if (BAL_RE.test(x.account) && c > 0 && x.user_id) b.recipients.add(x.user_id);
      }
      if (OUT_RE.test(x.account) && d > 0 && x.kind !== "reversal") { const k = catOf(x, digital), o = (cats[k] ||= { volume: 0, payers: new Set() }); o.volume += d; o.payers.add(x.user_id); }
    }
    const pub = (b) => b.payers.size >= K ? { volume: pi(b.volume), fees: pi(b.fees), payouts: pi(b.payouts), refunds: pi(b.refunds), payers: b.payers.size, suppressed: false } : { volume: null, fees: null, payouts: null, refunds: null, payers: null, suppressed: true };
    // reserves = current balances (all time) the platform holds for others or for the rewards pool
    const bal = await db.all("SELECT account, COUNT(DISTINCT user_id) holders, COALESCE(SUM(credit),0) - COALESCE(SUM(debit),0) b FROM ledger_entries GROUP BY account");
    const rs = { held: 0, escrow: 0, adBudgets: 0, owed: 0, owedHolders: 0, rewardsPool: 0, liabilityUsers: new Set() };
    const holders = await db.all("SELECT user_id, account, COALESCE(SUM(credit),0) - COALESCE(SUM(debit),0) b FROM ledger_entries WHERE user_id IS NOT NULL GROUP BY user_id, account");
    for (const h of holders) if (BAL_RE.test(h.account) && Number(h.b) > 0) { rs.owed += Number(h.b); rs.liabilityUsers.add(h.user_id); }
    for (const a of bal) { const b = Number(a.b); if (a.account === "platform:held") rs.held += b; else if (a.account === "escrow:market" || a.account === "escrow:contracts") rs.escrow += b; else if (/^ads:budget:/.test(a.account)) rs.adBudgets += b; else if (a.account === "platform:rewards_pool") rs.rewardsPool += b; }
    const yearPub = pub(year_);
    const v = {
      year: y, k: K, generatedAt: nowIso(), piEnabled: piOn(), currency: "PI",
      totals: yearPub,
      months: months.map((m, i) => ({ month: `${y}-${String(i + 1).padStart(2, "0")}`, ...pub(m) })),
      categories: Object.entries(cats).map(([k, o]) => o.payers.size >= K ? { key: k, label: CATS[k], volume: pi(o.volume), suppressed: false } : { key: k, label: CATS[k], volume: null, suppressed: true }),
      reserves: {
        heldForReview: yearPub.suppressed ? null : pi(rs.held), marketEscrow: yearPub.suppressed ? null : pi(rs.escrow), adBudgets: yearPub.suppressed ? null : pi(rs.adBudgets),
        owedToMembers: rs.liabilityUsers.size >= K ? pi(rs.owed) : null, owedHolders: rs.liabilityUsers.size >= K ? rs.liabilityUsers.size : null, rewardsPool: pi(rs.rewardsPool), asOf: nowIso()
      },
      notes: [
        `تُنشر الأرقام مجمّعة فقط. أي شهر أو فئة أو رصيد وراءه أقل من ${K} أعضاء مختلفين يُحجب («—») حتى لا يمكن استنتاج معاملات شخص بعينه.`,
        "الحجم = مجموع ما دفعه الأعضاء بعملة Pi. الرسوم = حصة المنصة (رسوم الإكراميات والسوق والتحويلات، اشتراك الذكاء، الإعلانات). المدفوعات = ما صُرف من أرصدة الأعضاء إلى محافظهم. الاستردادات = ما أُعيد للأعضاء.",
        "الاحتياطيات = أرصدة تحتفظ بها المنصة الآن: إكراميات وتحويلات قيد المراجعة، ضمان طلبات السوق، ميزانيات إعلانية غير منفقة، أرصدة مستحقة للأعضاء، وصندوق مكافآت النقاط.",
        "المصدر: السجل المحاسبي مزدوج القيد للمنصة (لا يُعدَّل ولا يُحذف منه شيء)."
      ],
      note: rows.length ? null : piOn() ? "لا معاملات في هذه السنة بعد." : PI_OFF_NOTE
    };
    tCache.set(y, { at: Date.now(), v });
    return v;
  }
  function transparencyHtml(v) {
    const n = (x) => (x === null || x === undefined ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 }));
    const M = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    const stat = (x, l) => `<div class="s"><b dir="ltr">${n(x)}</b><span>${l}</span></div>`;
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الشفافية المالية ${v.year} · مجتمع بلس</title><meta name="description" content="تقرير مجمّع لحركة Pi في مجتمع بلس: الحجم والرسوم والمدفوعات والاستردادات والاحتياطيات.">
<style>:root{--fg:#1d1b26;--mut:#5f5b73;--bg:#fbfaff;--card:#fff;--acc:#5b2bd6;--line:#e6e2f2}@media(prefers-color-scheme:dark){:root{--fg:#efedf7;--mut:#b3afc6;--bg:#121019;--card:#1b1824;--acc:#b9a2ff;--line:#2e2a3d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.8 "IBM Plex Sans Arabic","Noto Naskh Arabic",system-ui,sans-serif}a{color:var(--acc)}main{max-width:820px;margin:auto;padding:20px 20px 80px}h1{font-size:1.8em;line-height:1.3;margin:.2em 0}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:16px 0}.s{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}.s b{display:block;font-size:22px}.s span{color:var(--mut);font-size:14px}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:12px;overflow:hidden;font-size:15px}th,td{padding:9px 8px;border-bottom:1px solid var(--line);text-align:start}td[dir=ltr]{text-align:end}.meta{color:var(--mut);font-size:14px}nav a{margin-inline-end:12px;display:inline-block;min-height:44px;line-height:44px}</style></head>
<body><main><nav aria-label="روابط"><a href="/">التطبيق</a><a href="/transparency">تقارير الإشراف</a>${[v.year - 1, v.year + 1].filter((x) => x <= new Date().getUTCFullYear()).map((x) => `<a href="/transparency/finance?year=${x}">${x}</a>`).join("")}</nav>
<h1>الشفافية المالية — ${v.year}</h1><p class="meta">أُعدّ ${esc(v.generatedAt.slice(0, 16).replace("T", " "))} UTC · العملة π · حد الإخفاء k = ${v.k}</p>${v.note ? `<p>${esc(v.note)}</p>` : ""}
<section><h2>إجمالي السنة</h2><div class="g">${stat(v.totals.volume, "حجم المدفوعات")}${stat(v.totals.fees, "رسوم المنصة")}${stat(v.totals.payouts, "مدفوعات للأعضاء")}${stat(v.totals.refunds, "استردادات")}${stat(v.totals.payers, "أعضاء دفعوا")}</div></section>
<section><h2>الاحتياطيات الآن</h2><div class="g">${stat(v.reserves.heldForReview, "قيد المراجعة")}${stat(v.reserves.marketEscrow, "ضمان السوق")}${stat(v.reserves.adBudgets, "ميزانيات إعلانية")}${stat(v.reserves.owedToMembers, "مستحقة للأعضاء")}${stat(v.reserves.rewardsPool, "صندوق المكافآت")}</div></section>
<section><h2>شهرياً</h2><table><thead><tr><th scope="col">الشهر</th><th scope="col">الحجم</th><th scope="col">الرسوم</th><th scope="col">المدفوعات</th><th scope="col">الاستردادات</th></tr></thead><tbody>${v.months.map((m, i) => `<tr><td>${M[i]}</td><td dir="ltr">${n(m.volume)}</td><td dir="ltr">${n(m.fees)}</td><td dir="ltr">${n(m.payouts)}</td><td dir="ltr">${n(m.refunds)}</td></tr>`).join("")}</tbody></table></section>
${v.categories.length ? `<section><h2>حسب النوع</h2><table><tbody>${v.categories.map((c) => `<tr><td>${esc(c.label)}</td><td dir="ltr">${n(c.volume)}</td></tr>`).join("")}</tbody></table></section>` : ""}
<section><h2>المنهجية</h2>${v.notes.map((x) => `<p class="meta">${esc(x)}</p>`).join("")}<p class="meta">البيانات نفسها بصيغة JSON: <a href="/api/finance/transparency?year=${v.year}">/api/finance/transparency</a></p></section></main></body></html>`;
  }
  async function ssr(req, res, url) {
    if (url.pathname !== "/transparency/finance" && url.pathname !== "/transparency/finance/") return false;
    const v = await transparency(url.searchParams.get("year"));
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" }); res.end(transparencyHtml(v)); return true;
  }

  /* ======================= 5. admin reconciliation ======================= */
  async function reconcile(q = {}) {
    const r = range(q.from || q.to ? q : { from: new Date(clock().getTime() - 30 * DAY).toISOString().slice(0, 10) });
    const txs = await db.all("SELECT id, user_id, amount, purpose, status, ref_id, direction, created_at FROM pi_transactions WHERE created_at >= $1 AND created_at < $2 AND status IN ('completed','refunded') AND direction='out' ORDER BY created_at", [r.f, r.t]);
    const js = await db.all(`SELECT j.id, j.kind, j.pi_tx, j.reverses, j.ref_id, j.created_at FROM ledger_journals j WHERE j.pi_tx IS NOT NULL AND ((j.created_at >= $1 AND j.created_at < $2) OR j.pi_tx IN (SELECT id FROM pi_transactions WHERE created_at >= $1 AND created_at < $2))`, [r.f, r.t]);
    const entries = new Map();
    for (const j of js) entries.set(j.id, await db.all("SELECT account, user_id, debit, credit FROM ledger_entries WHERE journal_id=$1", [j.id]));
    const reversed = new Set((await db.all("SELECT reverses FROM ledger_journals WHERE reverses IS NOT NULL")).map((x) => x.reverses));
    const byTx = new Map(); for (const j of js) { const l = byTx.get(j.pi_tx) || []; l.push(j); byTx.set(j.pi_tx, l); }
    const issues = []; let matched = 0, received = 0, ledgerPaid = 0, refundsPi = 0;
    for (const t of txs) {
      const units = toUnits(t.amount); received += units; if (t.status === "refunded") refundsPi += units;
      const paying = (byTx.get(t.id) || []).filter((j) => j.kind !== "reversal" && entries.get(j.id).some((e) => OUT_RE.test(e.account) && Number(e.debit) > 0));
      const paid = paying.reduce((s, j) => s + entries.get(j.id).filter((e) => OUT_RE.test(e.account)).reduce((a, e) => a + Number(e.debit), 0), 0);
      ledgerPaid += paid;
      if (!paying.length) { issues.push({ type: LEDGER_PURPOSES.includes(t.purpose) ? "missing_journal" : "unledgered", severity: LEDGER_PURPOSES.includes(t.purpose) ? "high" : "info", tx: t.id, purpose: t.purpose, amount: pi(units), at: t.created_at }); continue; }
      if (Math.abs(paid - units) > 1) { issues.push({ type: "amount_mismatch", severity: "high", tx: t.id, purpose: t.purpose, amount: pi(units), ledger: pi(paid), journals: paying.map((j) => j.id) }); continue; }
      if (t.status === "refunded") {
        const back = (byTx.get(t.id) || []).some((j) => entries.get(j.id).some((e) => OUT_RE.test(e.account) && Number(e.credit) > 0)) || paying.every((j) => reversed.has(j.id));
        if (!back) { issues.push({ type: "refunded_not_reversed", severity: "high", tx: t.id, purpose: t.purpose, amount: pi(units), journals: paying.map((j) => j.id) }); continue; }
      }
      matched++;
    }
    const txIds = new Set(txs.map((t) => t.id));
    const known = new Set(); for (const j of js) if (!txIds.has(j.pi_tx)) known.add(j.pi_tx);
    const otherTx = new Map();
    const list = [...known];
    for (let i = 0; i < list.length; i += 200) { const part = list.slice(i, i + 200); for (const x of await db.all(`SELECT id, status FROM pi_transactions WHERE id IN (${part.map((_, k) => "$" + (k + 1)).join(",")})`, part)) otherTx.set(x.id, x.status); }
    for (const j of js) {
      if (txIds.has(j.pi_tx) || j.kind === "reversal") continue;
      if (!entries.get(j.id).some((e) => OUT_RE.test(e.account) && Number(e.debit) > 0)) continue; // payouts / funding carry a chain txid, not a payment id
      const st = otherTx.get(j.pi_tx);
      if (!st) issues.push({ type: "orphan_journal", severity: "high", journal: j.id, kind: j.kind, piTx: j.pi_tx, at: j.created_at });
      else if (!["completed", "refunded"].includes(st)) issues.push({ type: "journal_for_unfinished_payment", severity: "high", journal: j.id, kind: j.kind, piTx: j.pi_tx, status: st });
    }
    const integrity = ctx.services.tips?.ledgerCheck ? await ctx.services.tips.ledgerCheck() : null;
    const high = issues.filter((i) => i.severity === "high").length + (integrity && !integrity.balanced ? 1 : 0);
    return { from: r.from, to: r.to, result: high ? "issues" : "ok", summary: { payments: txs.length, matched, issues: issues.length, high, piReceived: pi(received), ledgerPaid: pi(ledgerPaid), refunded: pi(refundsPi), journals: js.length },
      issues: issues.slice(0, 300), integrity: integrity ? { balanced: integrity.balanced, journals: integrity.journals, imbalances: integrity.imbalances.slice(0, 50) } : null, piEnabled: piOn(), checkedAt: nowIso(),
      note: txs.length || js.length ? null : piOn() ? "لا مدفوعات في هذه الفترة." : PI_OFF_NOTE };
  }

  /* ---------- routes ---------- */
  R.get("/api/finance/statement", A(async (req) => statement(req.user, req.query)));
  R.get("/api/finance/statement.csv", A(statementCsv));
  R.get("/api/finance/invoices", A(async (req) => listDocs(req.user, req.query)));
  R.get("/api/finance/invoices/:id", A(async (req) => { await issueAll(); return { document: await docJson(await docRow(req.params.id, req.user), req.user) }; }));
  R.get("/api/finance/invoices/:id/html", A(async (req, res) => {
    await issueAll();
    const d = await docJson(await docRow(req.params.id, req.user), req.user);
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", ...(req.query.download ? { "Content-Disposition": `attachment; filename="${d.number}.html"` } : {}) });
    res.end(docHtml(d)); return ctx.STREAM;
  }));
  R.get("/api/finance/annual", A(async (req) => annual(req.user, req.query.year)));
  R.get("/api/finance/transparency", async (req) => transparency(req.query.year));
  R.get("/api/admin/finance/annual", admin(async (req) => {
    const h = str(req.query.user, 60).replace(/^@/, "").toLowerCase();
    const u = await db.get("SELECT id, handle, name, role FROM users WHERE LOWER(handle)=$1 OR id=$2", [h, str(req.query.user, 60)]);
    if (!u) throw E.nf("لا يوجد مستخدم بهذا الاسم");
    return annual(u, req.query.year);
  }));
  R.get("/api/admin/finance/reconcile", admin(async (req) => reconcile(req.query)));
  R.post("/api/admin/finance/issue", admin(async () => ({ issued: await issueAll() })));

  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("finance.issue", +(env.FINANCE_ISSUE_INTERVAL_MS || 10 * 60e3), () => issueAll());
  return { issueAll, statement, annual, transparency, reconcile, ssr, docHtml, K, HttpError };
};
