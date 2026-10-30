/* Phase 53 — pricing manager (price book, scheduled changes, history, grandfathering, suggested prices not applied) and the
 * revenue / cost dashboard (ledger streams, costs incl. usage counters, margin, break-even, CSV), admin only. PostgreSQL. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { piStub, users, DAY } = require("./pi-stub");

const stub = piStub("sk_test_pr_53");
let H, U, admin, ali, bea, cem, T = Date.now();
const db = () => H.app.ctx.db, S = () => H.app.ctx.services;
const settle = async () => { await S().ai.settle?.(); await S().transfers.settle?.(); await S().market.settle(); for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
test.before(async () => {
  H = await boot({ piOpts: { env: stub.env, fetch: stub.fetch, jobs: false }, tipsOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, creatorSubsOpts: { jobs: false },
    transfersOpts: { env: { TRANSFER_HOLD_NEW: "0", TRANSFER_HOLD_AMOUNT: "1000" } }, aiOpts: { jobs: false }, pricingOpts: { jobs: false, now: () => new Date(T) } });
  U = users(H, stub);
  admin = await U.mk("pr_admin"); ali = await U.mk("pr_ali"); bea = await U.mk("pr_bea"); cem = await U.mk("pr_cem");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 037: down/up reversible, additive, data map", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '037_pricing' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "037_pricing"]);
  await assert.rejects(() => db().get("SELECT 1 FROM price_book"));
  assert.deepEqual(await mig.up(db()), ["037_pricing", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  for (const m of require("../lib/compliance-lib").DATA_MAP.filter((x) => x.t === "price_locks")) await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [ali.id]);
  assert.equal(H.app.ctx.config.version, require("../package.json").version);
  assert.equal(require("../package.json").version, require("../../package.json").version, "server and root package versions match");
});

test("price book: admin only, suggested shown but not applied, confirm required, immediate change syncs config", async () => {
  assert.equal((await ali.req("GET", "/api/admin/pricing")).status, 403);
  const o = await admin.req("GET", "/api/admin/pricing"); assert.equal(o.status, 200, o.error);
  const keys = o.items.map((i) => i.key);
  for (const k of ["ai.plan.ai_plus", "fee.tips", "fee.subscriptions", "fee.paid", "fee.market", "fee.transfers", "ads.cpm.min", "ads.cpm.default"]) assert.ok(keys.includes(k), k);
  const tips = o.items.find((i) => i.key === "fee.tips"); assert.equal(tips.current, 0); assert.equal(tips.source, "env"); assert.equal(tips.suggested.value, 500); assert.equal(tips.suggested.applied, false);
  assert.equal(o.items.find((i) => i.key === "ai.plan.ai_plus").current, null, "no AI price until the admin sets one");
  assert.equal((await admin.req("POST", "/api/admin/pricing", { item: "fee.market", value: 300 })).code, "confirm_required");
  assert.equal((await admin.req("POST", "/api/admin/pricing", { item: "fee.market", value: 9999, confirm: true })).code, "value_invalid");
  assert.equal((await admin.req("POST", "/api/admin/pricing", { item: "nope", value: 1, confirm: true })).code, "item_invalid");
  const r = await admin.req("POST", "/api/admin/pricing", { item: "fee.market", value: 300, confirm: true, note: "إطلاق" }); assert.equal(r.status, 200, r.error);
  assert.equal(r.price.status, "active"); assert.equal(S().market.config.feePct, 3);
  assert.equal((await ali.req("GET", "/api/pricing")).items.find((i) => i.key === "fee.market").percent, 3);
  assert.equal(S().tips.config.feeBps, 0, "suggested prices are never applied on their own");
});

test("scheduled change activates when due, history kept, cancel and revert", async () => {
  const at = new Date(T + 2 * DAY).toISOString();
  const s = await admin.req("POST", "/api/admin/pricing", { item: "fee.tips", value: 500, effectiveAt: at, confirm: true }); assert.equal(s.price.status, "scheduled");
  const s2 = await admin.req("POST", "/api/admin/pricing", { item: "fee.subscriptions", value: 800, effectiveAt: at, confirm: true });
  assert.equal(S().tips.config.feeBps, 0);
  assert.equal((await admin.req("DELETE", "/api/admin/pricing/" + s2.price.id)).status, 200);
  assert.equal((await admin.req("DELETE", "/api/admin/pricing/" + s2.price.id)).code, "not_scheduled");
  T += 3 * DAY; assert.equal(await S().pricing.applyDue(), 1);
  assert.equal(S().tips.config.feeBps, 500); assert.equal(S().tips.config.supportFeeBps ?? null, null);
  await admin.req("POST", "/api/admin/pricing", { item: "fee.tips", value: 400, confirm: true });
  const h = await admin.req("GET", "/api/admin/pricing/history?item=fee.tips");
  assert.deepEqual(h.items.map((x) => x.status), ["active", "superseded"]); assert.equal(h.items[0].prevValue, 500);
  const rv = await admin.req("POST", "/api/admin/pricing/revert", { item: "fee.tips" }); assert.equal(rv.status, 200, rv.error);
  assert.equal(S().tips.config.feeBps, 0); assert.equal(rv.items.find((i) => i.key === "fee.tips").source, "env");
  assert.equal((await admin.req("POST", "/api/admin/pricing/suggested", { items: ["fee.paid"] })).code, "confirm_required");
  const sg = await admin.req("POST", "/api/admin/pricing/suggested", { items: ["fee.paid"], confirm: true }); assert.equal(sg.applied[0].source, "suggested");
  assert.equal(S().paid.config.feeBps, 1000);
});

test("AI plan price with grandfathering: live subscribers keep the old price, newcomers pay the new one", async () => {
  const p1 = await admin.req("POST", "/api/admin/pricing", { item: "ai.plan.ai_plus", value: 1, confirm: true }); assert.equal(p1.status, 200, p1.error);
  const sub = await ali.req("POST", "/api/ai/subscribe", {}); assert.equal(sub.status, 200, sub.error); assert.equal(sub.intent.amount, 1);
  await U.payIntent(ali, sub.intent, settle); await settle();
  assert.equal((await db().get("SELECT state FROM ai_subscriptions WHERE user_id=$1", [ali.id])).state, "active");
  const p2 = await admin.req("POST", "/api/admin/pricing", { item: "ai.plan.ai_plus", value: 2, grandfather: true, confirm: true }); assert.equal(p2.status, 200, p2.error);
  assert.equal(p2.price.prevValue, 1);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM price_locks WHERE item='ai.plan.ai_plus'")).n), 1);
  assert.equal((await ali.req("POST", "/api/ai/subscribe", {})).intent.amount, 1, "grandfathered");
  assert.equal((await bea.req("POST", "/api/ai/subscribe", {})).intent.amount, 2, "new price");
  assert.equal((await admin.req("GET", "/api/admin/pricing")).items.find((i) => i.key === "ai.plan.ai_plus").grandfathered, 1);
});

test("transfer fee goes to the platform; revenue dashboard, costs, margin, break-even, CSV", async () => {
  await admin.req("POST", "/api/admin/pricing", { item: "fee.transfers", value: 100, confirm: true });
  const t = await cem.req("POST", "/api/transfers/intent", { toHandle: "pr_bea", amount: 10 }); assert.equal(t.status, 200, t.error);
  await U.payIntent(cem, t.intent, settle); await settle();
  assert.equal((await bea.req("GET", "/api/transfers")).balance.available, 9.9);
  const chk = await admin.req("GET", "/api/admin/ledger/check"); assert.equal(chk.balanced, true, JSON.stringify(chk.imbalances));
  assert.equal((await ali.req("GET", "/api/admin/revenue")).status, 403);
  const c = await admin.req("POST", "/api/admin/costs", { category: "hosting", provider: "Railway", amountUsd: 5, month: new Date(T).toISOString().slice(0, 7) }); assert.equal(c.status, 200, c.error);
  assert.equal((await admin.req("POST", "/api/admin/costs", { category: "x", amountUsd: 1 })).code, "category_invalid");
  await db().run("INSERT INTO llm_usage(day,provider,calls,tokens_in,tokens_out,cost) VALUES($1,'openai',3,10,10,0.25)", [new Date(T).toISOString().slice(0, 10)]);
  const range = `?from=${new Date(T - 10 * DAY).toISOString().slice(0, 10)}&to=${new Date(T + DAY).toISOString().slice(0, 10)}&group=month`;
  let r = await admin.req("GET", "/api/admin/revenue" + range); assert.equal(r.status, 200, r.error);
  const ai = r.streams.find((s) => s.stream === "ai"), tr = r.streams.find((s) => s.stream === "transfer");
  assert.equal(ai.platform, 1); assert.equal(ai.paidIn, 1); assert.equal(tr.platform, 0.1); assert.equal(tr.transfers, 9.9);
  assert.equal(r.totals.platform, 1.1); assert.equal(r.costs.totalUsd, 5.25); assert.equal(r.margin.revenueUsd, null); assert.ok(r.margin.note);
  assert.equal((await admin.req("PUT", "/api/admin/finance/settings", { piUsdRate: 0.5 })).piUsd.rate, 0.5);
  r = await admin.req("GET", "/api/admin/revenue" + range);
  assert.equal(r.margin.revenueUsd, 0.55); assert.equal(r.margin.marginUsd, -4.7); assert.equal(r.breakEven.reached, false); assert.ok(r.breakEven.payersNeeded > 1);
  // the monthly cost is the range's cost spread over the calendar months it touches (a range near a month end spans two)
  const mFrom = new Date(T - 10 * DAY).toISOString().slice(0, 7), mTo = new Date(T + DAY).toISOString().slice(0, 7);
  const monthsN = (Number(mTo.slice(0, 4)) - Number(mFrom.slice(0, 4))) * 12 + Number(mTo.slice(5, 7)) - Number(mFrom.slice(5, 7)) + 1;
  assert.equal(r.breakEven.aiSubscribersNeeded, Math.ceil(5.25 / monthsN / (2 * 0.5)));
  const csv = await admin.req("GET", "/api/admin/revenue.csv" + range); assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/); const text = csv.buf.toString("utf8");
  assert.ok(text.startsWith("\ufeff")); assert.match(text, /stream,ai,/); assert.match(text, /cost,.*hosting,Railway,5/);
  assert.equal((await admin.req("DELETE", "/api/admin/costs/" + c.cost.id)).status, 200);
});
