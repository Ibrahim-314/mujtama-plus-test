/* Phase 60 — financial transparency: statements (all categories, filters, totals, CSV), sequential gap-free documents
 * (INV / CN / RC) with Arabic RTL printable HTML, annual summaries (member + creator), the k-anonymous public report
 * (/api/finance/transparency + /transparency/finance), admin reconciliation ledger vs Pi payments, Pi-off empty states. PostgreSQL. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { piStub, users } = require("./pi-stub");
const { createLedger, ACC, REWARDS } = require("../lib/ledger");

const stub = piStub("sk_test_fin_60");
let H, Us, admin, cara, fred, gus;
const db = () => H.app.ctx.db, F = () => H.app.ctx.services.finance;
const L = createLedger({ now: () => new Date().toISOString() });
const post = (j) => db().tx((t) => L.postJournal(t, j));
test.before(async () => {
  H = await boot({ piOpts: { env: stub.env, fetch: stub.fetch, jobs: false }, tipsOpts: { jobs: false, env: { CREATOR_FEE_BPS: "500" } }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, creatorSubsOpts: { jobs: false }, pricingOpts: { jobs: false }, betaOpts: { jobs: false }, pointsOpts: { jobs: false }, financeOpts: { jobs: false, env: { FINANCE_K_ANON: "2" } } });
  Us = users(H, stub);
  admin = await Us.mk("fn_admin"); cara = await Us.mk("fn_cara"); fred = await Us.mk("fn_fred"); gus = await Us.mk("fn_gus");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 041: reversible + additive; data map entry; empty statement before any payment", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '041_finance' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "041_finance"]);
  await assert.rejects(() => db().get("SELECT 1 FROM finance_invoices"));
  assert.deepEqual(await mig.up(db()), ["041_finance", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === "finance_invoices"); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [fred.id]);
  const st = await fred.req("GET", "/api/finance/statement"); assert.equal(st.status, 200); assert.equal(st.lines.length, 0); assert.ok(st.note); assert.ok(st.categories.length >= 9);
  assert.equal((await new H.Client().req("GET", "/api/finance/statement")).status, 401);
});

test("real tip through Pi → statement lines for payer and creator, INV document with fee, printable RTL HTML", async () => {
  assert.equal((await cara.req("PUT", "/api/me/creator", { enabled: true })).status, 200);
  const r = await fred.req("POST", "/api/tips/intent", { toHandle: "fn_cara", amount: 2 }); assert.equal(r.status, 200, r.error);
  await Us.payIntent(fred, r.intent, () => H.app.ctx.services.tips.settle());
  const s = await fred.req("GET", "/api/finance/statement");
  const l = s.lines.find((x) => x.kind === "tip"); assert.ok(l, JSON.stringify(s.lines));
  assert.equal(l.direction, "out"); assert.equal(l.account, "wallet"); assert.equal(l.amount, 2); assert.equal(l.category, "tips"); assert.equal(l.counterparty.handle, "fn_cara");
  assert.match(l.document.number, /^INV-\d{4}-000001$/); assert.equal(s.totals.paid, 2);
  const c = await cara.req("GET", "/api/finance/statement"); const cl = c.lines.find((x) => x.kind === "tip");
  assert.equal(cl.direction, "in"); assert.equal(cl.account, "balance"); assert.ok(cl.amount < 2 && cl.amount > 0); assert.equal(cl.counterparty.handle, "fn_fred");
  const d = await fred.req("GET", "/api/finance/invoices/" + l.document.id); assert.equal(d.status, 200);
  assert.equal(d.document.series, "INV"); assert.equal(d.document.amount, 2); assert.ok(d.document.fee > 0); assert.equal(d.document.payee.handle, "fn_cara");
  assert.equal((await cara.req("GET", "/api/finance/invoices/" + d.document.number)).status, 200, "payee may open it");
  assert.equal((await gus.req("GET", "/api/finance/invoices/" + d.document.id)).status, 404, "strangers may not");
  const html = await fred.req("GET", d.document.html + "?download=1"); assert.equal(html.status, 200);
  const t = html.buf.toString(); assert.match(t, /<html lang="ar" dir="rtl">/); assert.match(t, /INV-\d{4}-000001/); assert.match(t, /@media print/); assert.doesNotMatch(t, /<script/);
  assert.match(html.headers.get("content-disposition"), /attachment; filename="INV-/);
});

test("all categories: market + digital order, transfer, points reward payout, refund → CN; filters, totals, CSV; numbering gap-free", async () => {
  // a digital listing + order (market journals reference the order id)
  const now = new Date().toISOString();
  await db().run("INSERT INTO market_listings(id,seller_id,kind,title,price,category,created_at,updated_at) VALUES('ml_fd',$1,'digital','قالب',30000000,'digital',$2,$2)", [cara.id, now]).catch(async () => {
    const cols = (await db().all("SELECT column_name FROM information_schema.columns WHERE table_name='market_listings' AND is_nullable='NO' AND column_default IS NULL")).map((c) => c.column_name);
    throw new Error("market_listings required cols: " + cols.join(","));
  });
  await db().run("INSERT INTO market_orders(id,listing_id,buyer_id,seller_id,title,qty,unit_price,total,fee,status,created_at,updated_at) VALUES('mo_fd','ml_fd',$1,$2,'قالب',1,30000000,30000000,0,'paid',$3,$3)", [fred.id, cara.id, now]);
  await post({ ikey: "t:mo_fd:hold", kind: "market_hold", source: "market", refId: "mo_fd", senderId: fred.id, piTx: "pit_fake_market", lines: [{ account: ACC.out(fred.id), userId: fred.id, debit: 30000000 }, { account: "escrow:market", credit: 30000000 }] });
  await post({ ikey: "t:mo_fd:refund", kind: "market_refund", source: "market", refId: "mo_fd", senderId: fred.id, lines: [{ account: "escrow:market", debit: 30000000 }, { account: ACC.out(fred.id), userId: fred.id, credit: 30000000 }] });
  await post({ ikey: "t:tr1", kind: "transfer", source: "transfer", refId: "tr_1", creatorId: gus.id, senderId: fred.id, lines: [{ account: ACC.out(fred.id), userId: fred.id, debit: 10000000 }, { account: `user:${gus.id}:transfers`, userId: gus.id, credit: 10000000 }] });
  await post({ ikey: "t:fund", kind: "rewards_fund", source: "rewards", refId: "fund1", lines: REWARDS.fund(50000000) });
  await post({ ikey: "t:redeem", kind: "rewards_redeem", source: "rewards", refId: "rd1", creatorId: gus.id, lines: REWARDS.reserve(5000000, gus.id) });
  await post({ ikey: "t:rpay", kind: "rewards_payout", source: "rewards", refId: "rpay:rd1", creatorId: gus.id, piTx: "chain_tx_1", lines: REWARDS.payout(5000000, gus.id) });
  const s = await fred.req("GET", "/api/finance/statement");
  const cats = new Set(s.lines.map((l) => l.category)); for (const c of ["tips", "digital", "transfers"]) assert.ok(cats.has(c), c);
  const cn = s.lines.find((l) => l.kind === "market_refund"); assert.equal(cn.direction, "in"); assert.match(cn.document.number, /^CN-\d{4}-000001$/);
  assert.equal(s.totals.paid, 2 + 3 + 1); assert.equal(s.totals.refunds, 3);
  const cnDoc = await fred.req("GET", "/api/finance/invoices/" + cn.document.id); assert.equal(cnDoc.document.title, "إشعار دائن"); assert.match(cnDoc.document.creditOf, /^INV-/);
  const g = await gus.req("GET", "/api/finance/statement"); assert.ok(g.lines.some((l) => l.kind === "rewards_payout" && l.direction === "out" && l.document?.number.startsWith("RC-")));
  assert.ok(g.lines.some((l) => l.kind === "transfer" && l.direction === "in" && l.category === "transfers"));
  // filters
  assert.deepEqual([...new Set((await fred.req("GET", "/api/finance/statement?category=digital")).lines.map((l) => l.category))], ["digital"]);
  assert.equal((await fred.req("GET", "/api/finance/statement?from=2000-01-01&to=2000-12-31")).lines.length, 0);
  assert.equal((await fred.req("GET", "/api/finance/statement?from=2020-02-01&to=2020-01-01")).status, 400);
  const pg = await fred.req("GET", "/api/finance/statement?limit=2"); assert.equal(pg.lines.length, 2); assert.equal(pg.next, "2");
  const csv = await fred.req("GET", "/api/finance/statement.csv"); assert.equal(csv.status, 200); assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.ok(csv.buf.toString().split("\r\n").length >= s.count + 1);
  // documents: INV numbers 1..3 without gaps, idempotent issuing
  await F().issueAll(); await F().issueAll();
  const inv = (await db().all("SELECT seq FROM finance_invoices WHERE series='INV' ORDER BY seq")).map((r) => r.seq);
  assert.deepEqual(inv, inv.map((_, i) => i + 1)); assert.equal(inv.length, 3);
  assert.equal((await fred.req("GET", "/api/finance/invoices")).items.length, 4);
});

test("annual summary: member spend by category + creator earnings, fees, monthly, supporters; admin per user", async () => {
  const y = new Date().getUTCFullYear();
  const a = await fred.req("GET", "/api/finance/annual?year=" + y); assert.equal(a.status, 200);
  assert.equal(a.member.paid, 6); assert.equal(a.member.refunds, 3); assert.equal(a.member.net, 3); assert.equal(a.member.byCategory.tips.amount, 2); assert.equal(a.isCreator, false);
  const c = await cara.req("GET", "/api/finance/annual"); assert.equal(c.isCreator, true); assert.ok(c.creator.earned > 0 && c.creator.fees > 0); assert.equal(c.creator.supporters, 1);
  assert.equal(c.creator.monthly.length, 12); assert.ok(c.creator.monthly[new Date().getUTCMonth()] > 0);
  assert.equal((await fred.req("GET", "/api/admin/finance/annual?user=fn_cara")).status, 403);
  const ad = await admin.req("GET", "/api/admin/finance/annual?user=@fn_cara&year=" + y); assert.equal(ad.status, 200); assert.equal(ad.creator.earned, c.creator.earned);
  const empty = await fred.req("GET", "/api/finance/annual?year=2001"); assert.equal(empty.member.paid, 0); assert.ok(empty.note);
});

test("public transparency: aggregate + k-anonymous (k=2 here), reserves, SSR page; months with < k payers are suppressed", async () => {
  const t = await new H.Client().req("GET", "/api/finance/transparency"); assert.equal(t.status, 200);
  assert.equal(t.k, 2); assert.equal(t.totals.suppressed, true, "only one distinct payer so far → hidden"); assert.equal(t.totals.volume, null);
  assert.equal(t.reserves.rewardsPool, 4.5);
  await post({ ikey: "t:gus-ai", kind: "ai_subscription", source: "ai", refId: "ais1", senderId: gus.id, lines: [{ account: ACC.out(gus.id), userId: gus.id, debit: 20000000 }, { account: "platform:ai", credit: 20000000 }] });
  const t2 = await F().transparency(String(new Date().getUTCFullYear() + 0)); // cached 10 min → bust via a fresh service call below
  const fresh = require("../services/finance")({ ...H.app.ctx, router: { get() {}, post() {}, put() {} } }, { jobs: false, env: { FINANCE_K_ANON: "2" } });
  const t3 = await fresh.transparency();
  assert.equal(t3.totals.suppressed, false); assert.equal(t3.totals.payers, 2); assert.equal(t3.totals.volume, 8); assert.equal(t3.totals.refunds, 3);
  assert.ok(t3.totals.fees >= 2, "AI plan + tip fee"); assert.equal(t3.totals.payouts, 0.5);
  assert.ok(t3.categories.find((c) => c.key === "tips").suppressed, "single payer category stays hidden");
  assert.ok(t2);
  const page = await fetch(H.base + "/transparency/finance"); assert.equal(page.status, 200); const html = await page.text();
  assert.match(html, /الشفافية المالية/); assert.match(html, /dir="rtl"/); assert.doesNotMatch(html, /fn_fred|fn_cara/);
});

test("admin reconciliation: matched real payment, missing journal, amount mismatch, orphan journal, refunded-not-reversed; ledger integrity", async () => {
  assert.equal((await fred.req("GET", "/api/admin/finance/reconcile")).status, 403);
  let r = await admin.req("GET", "/api/admin/finance/reconcile"); assert.equal(r.status, 200);
  assert.ok(r.summary.matched >= 1, JSON.stringify(r)); assert.equal(r.integrity.balanced, true);
  assert.ok(r.issues.some((i) => i.type === "orphan_journal" && i.piTx === "pit_fake_market"));
  const now = new Date().toISOString();
  const ins = (id, amount, purpose, status) => db().run("INSERT INTO pi_transactions(id,user_id,amount,purpose,direction,status,created_at) VALUES($1,$2,$3,$4,'out',$5,$6)", [id, gus.id, amount, purpose, status, now]);
  await ins("pit_nojr", 1, "tip", "completed");
  await ins("pit_mis", 1, "ai", "completed"); await post({ ikey: "t:mis", kind: "ai_subscription", source: "ai", refId: "ais2", senderId: gus.id, piTx: "pit_mis", lines: [{ account: ACC.out(gus.id), userId: gus.id, debit: 9000000 }, { account: "platform:ai", credit: 9000000 }] });
  await ins("pit_ref", 1, "ai", "refunded"); await post({ ikey: "t:ref", kind: "ai_subscription", source: "ai", refId: "ais3", senderId: gus.id, piTx: "pit_ref", lines: [{ account: ACC.out(gus.id), userId: gus.id, debit: 10000000 }, { account: "platform:ai", credit: 10000000 }] });
  r = await admin.req("GET", "/api/admin/finance/reconcile");
  const types = r.issues.map((i) => i.tx + ":" + i.type);
  for (const x of ["pit_nojr:missing_journal", "pit_mis:amount_mismatch", "pit_ref:refunded_not_reversed"]) assert.ok(types.includes(x), x + " in " + types);
  assert.equal(r.result, "issues");
  assert.equal((await admin.req("GET", "/api/admin/finance/reconcile?from=2001-01-01&to=2001-01-02")).summary.payments, 0);
});

test("Pi off: every endpoint answers with empty data + note (no 501)", async () => {
  const H2 = await boot({ piOpts: { env: {}, jobs: false }, financeOpts: { jobs: false } });
  try {
    const c = new H2.Client(); const reg = await c.req("POST", "/api/auth/register", { name: "عضو تجربة", handle: "fn_off", password: "secret123" }); assert.equal(reg.status, 200, reg.error);
    for (const p of ["/api/finance/statement", "/api/finance/invoices", "/api/finance/annual"]) { const r = await c.req("GET", p); assert.equal(r.status, 200, p); assert.match(r.note, /غير مفعّلة/, p); }
    const t = await new H2.Client().req("GET", "/api/finance/transparency"); assert.equal(t.status, 200); assert.equal(t.piEnabled, false); assert.match(t.note, /غير مفعّلة/);
  } finally { await H2.app.close(); }
});

test("sequential numbers stay unique and gap-free when two instances issue at the same time", async () => {
  const hal = await Us.mk("fn_hal");
  for (let i = 0; i < 6; i++) await post({ ikey: "t:hal:" + i, kind: "ppv", source: "ppv", refId: "pp" + i, creatorId: cara.id, senderId: hal.id, lines: [{ account: ACC.out(hal.id), userId: hal.id, debit: 1000000 }, { account: ACC.earn(cara.id), userId: cara.id, credit: 1000000 }] });
  const mk = () => require("../services/finance")({ ...H.app.ctx, router: { get() {}, post() {}, put() {} } }, { jobs: false });
  await Promise.all([mk().issueAll(), mk().issueAll(), mk().issueAll()]);
  const seqs = (await db().all("SELECT seq FROM finance_invoices WHERE series='INV' ORDER BY seq")).map((r) => Number(r.seq));
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
  assert.equal((await db().get("SELECT COUNT(*) n FROM finance_invoices WHERE payer_id=$1", [hal.id])).n, 6);
});
