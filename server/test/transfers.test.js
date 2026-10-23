/* Phase 56 — Pi transfers between users + payment requests, against the stubbed Pi Platform API (same stub as tips.test.js).
 * Covers: migration 034 down/up + additive, off → 501, send (intent purpose transfer → approve → complete → ledger credit,
 * notification, history both sides, receipt visibility), limits (single, daily, new-account daily, hourly), self / minors /
 * blocked / receiving off, new-account hold + admin release / reject (reversal), requests (create, notify, pay through
 * intent with requestId → paid, decline, cancel, closed request), refund reversal, payouts + balance, ledger balanced. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const KEY = "sk_test_tr_56";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`;
const payments = new Map(); let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pay = (o) => { const p = { identifier: "trp_" + (++seq), user_uid: o.uid, amount: o.amount, memo: "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
async function fakeFetch(url, o = {}) {
  if (new URL(url).pathname === "/pi/auth/v1/login") { const m = /^at-secret-([^-]+)-(.+)$/.exec(String(JSON.parse(o.body || "{}").accessToken || "")); return m ? res(200, { sessionToken: "s", user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {}); }
  const path = new URL(url).pathname, auth = o.headers?.Authorization || "";
  if (auth !== "Key " + KEY) return res(401, {});
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path), p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, {});
  const body = o.body ? JSON.parse(o.body) : {};
  if (mm[2] === "approve") p.status.developer_approved = true;
  if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, {}); p.status.developer_completed = true; }
  if (mm[2] === "cancel") p.status.cancelled = true;
  return res(200, JSON.parse(JSON.stringify(p)));
}
const PI_ENV = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub" };
const TR_ENV = { TRANSFER_MAX_SINGLE: "40", TRANSFER_MAX_DAILY: "60", TRANSFER_NEW_ACCOUNT_DAILY: "5", TRANSFER_MAX_PER_HOUR: "6", TRANSFER_HOLD_AMOUNT: "30" };
const DAY = 864e5;
let H, admin, ali, bea, cem, newbie, kid;
const db = () => H.app.ctx.db, tr = () => H.app.ctx.services.transfers;
const mk = async (handle, { old = true } = {}) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  if (old) await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
  return c;
};
const linkPi = async (c) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(c.handle.replace(/_/g, ""), c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + c.handle.replace(/_/g, ""); };
async function payIntent(c, intent) {
  const p = pay({ uid: c.uid, amount: intent.amount, metadata: intent.metadata });
  const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
  p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
  const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
  await tr().settle(); return p;
};
const send = async (c, body, code = 200) => { const r = await c.req("POST", "/api/transfers/intent", body); assert.equal(r.status, code, r.error); return r; };
const ledgerOk = async () => { const r = await admin.req("GET", "/api/admin/ledger/check"); assert.equal(r.status, 200, r.error); assert.equal(r.balanced, true, JSON.stringify(r.imbalances)); };
const notes = async (uid, kind) => Number((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind=$2", [uid, kind]))?.n || 0);

const override = (H) => { H.Client.prototype.req = async function (method, path, body, headers = {}) {
  const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  return { ...j, body: j, status: r.status, headers: r.headers };
}; };
test.before(async () => {
  H = await boot({ piOpts: { env: PI_ENV, fetch: fakeFetch, jobs: false }, tipsOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, transfersOpts: { env: TR_ENV } });
  override(H);
  admin = await mk("tr_admin"); ali = await mk("tr_ali"); bea = await mk("tr_bea"); cem = await mk("tr_cem"); newbie = await mk("tr_newbie", { old: false }); kid = await mk("tr_kid");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  for (const c of [ali, bea, cem, newbie, kid]) await linkPi(c);
  const age = await kid.req("POST", "/api/age", { birthDate: "2013-05-01" }); assert.equal(age.status, 200, age.error);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 034: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '034_transfers' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "034_transfers"]);
  await assert.rejects(() => db().get("SELECT 1 FROM pi_transfers"));
  assert.deepEqual(await mig.up(db()), ["034_transfers", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  const L = require("../lib/compliance-lib");
  for (const m of L.DATA_MAP.filter((x) => ["pi_transfers", "pi_pay_requests", "pi_payouts"].includes(x.t))) await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [ali.id]);
  assert.equal(L.DATA_MAP.filter((x) => ["pi_transfers", "pi_pay_requests", "pi_payouts"].includes(x.t)).length, 3);
});

test("send: intent → Pi → ledger credit, notification, history both sides, receipt visibility", async () => {
  const cfg = await ali.req("GET", "/api/transfers/config"); assert.equal(cfg.enabled, true); assert.equal(cfg.receive, true); assert.equal(cfg.limits.maxSingle, 40);
  const r = await send(ali, { toHandle: "@tr_bea", amount: 2.5, note: "عشاء" });
  assert.equal(r.held, false); assert.equal(r.intent.amount, 2.5);
  const pt = await db().get("SELECT purpose, ref_id FROM pi_transactions WHERE id=$1", [r.intent.id]); assert.equal(pt.purpose, "transfer"); assert.equal(pt.ref_id, r.transferId);
  // before payment the recipient sees nothing
  assert.equal((await bea.req("GET", "/api/transfers?box=received")).items.length, 0);
  assert.equal((await bea.req("GET", "/api/transfers/" + r.transferId)).status, 404);
  await payIntent(ali, r.intent);
  const row = await db().get("SELECT * FROM pi_transfers WHERE id=$1", [r.transferId]); assert.equal(row.status, "completed");
  const hb = await bea.req("GET", "/api/transfers"); assert.equal(hb.items[0].direction, "in"); assert.equal(hb.items[0].amount, 2.5); assert.equal(hb.items[0].sender.handle, "tr_ali"); assert.equal(hb.balance.available, 2.5);
  assert.ok(hb.items[0].explorerUrl.includes("/testnet/tx/")); assert.equal(hb.items[0].holdReason, null);
  const ha = await ali.req("GET", "/api/transfers?box=sent"); assert.equal(ha.items[0].direction, "out"); assert.equal(ha.items[0].status, "completed");
  const rc = await bea.req("GET", "/api/transfers/" + r.transferId); assert.equal(rc.status, 200); assert.equal(rc.receipt.note, "عشاء");
  assert.equal((await cem.req("GET", "/api/transfers/" + r.transferId)).status, 404);
  assert.equal(await notes(bea.id, "pi_transfer_received"), 1);
  await ledgerOk();
});

test("limits and anti-fraud: single, daily, hourly, new accounts, self, minors, blocks, receiving off", async () => {
  await send(ali, { toHandle: "tr_bea", amount: 41 }, 400);
  await send(ali, { toHandle: "tr_ali", amount: 1 }, 400);
  assert.equal((await send(kid, { toHandle: "tr_bea", amount: 1 }, 403)).code, "minor_restricted");
  assert.equal((await send(ali, { toHandle: "tr_kid", amount: 1 }, 403)).code, "minor_restricted");
  assert.equal((await send(newbie, { toHandle: "tr_bea", amount: 6 }, 429)).code, "transfer_daily_limit"); // new-account cap 5
  // daily cap 60 (2.5 already sent): 25 + 25 ok, then 10 more fails
  for (const a of [25, 25]) await send(ali, { toHandle: "tr_cem", amount: a });
  assert.equal((await send(ali, { toHandle: "tr_cem", amount: 10 }, 429)).code, "transfer_daily_limit");
  // hourly count 6 (3 intents so far count, cancelled ones would not)
  for (let i = 0; i < 3; i++) await send(cem, { toHandle: "tr_bea", amount: 0.1 });
  for (let i = 0; i < 3; i++) await send(cem, { toHandle: "tr_bea", amount: 0.1 });
  assert.equal((await send(cem, { toHandle: "tr_bea", amount: 0.1 }, 429)).code, "transfer_hourly_limit");
  // receiving off
  assert.equal((await bea.req("PUT", "/api/transfers/settings", { receive: false })).receive, false);
  H.app.ctx.rl.w.clear();
  assert.equal((await send(ali, { toHandle: "tr_bea", amount: 1 }, 409)).code, "recipient_off");
  await bea.req("PUT", "/api/transfers/settings", { receive: true });
  // blocked
  await db().run("INSERT INTO user_blocks(owner,target,created_at) VALUES($1,$2,$3)", [bea.id, newbie.id, new Date().toISOString()]).catch(async () => {
    const u = await db().get("SELECT prefs FROM users WHERE id=$1", [bea.id]); await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [{ ...(u.prefs || {}), blocked: [newbie.id] }, bea.id]);
  });
  assert.equal((await send(newbie, { toHandle: "tr_bea", amount: 1 }, 403)).code, "blocked");
});

test("hold for new accounts → admin release credits; reject reverses and records the refund", async () => {
  const r = await send(newbie, { toHandle: "tr_ali", amount: 2 }); assert.equal(r.held, true);
  await payIntent(newbie, r.intent);
  assert.equal((await db().get("SELECT status FROM pi_transfers WHERE id=$1", [r.transferId])).status, "held");
  assert.equal(await notes(newbie.id, "pi_transfer_held"), 1);
  assert.equal((await ali.req("GET", "/api/admin/transfers/held")).status, 403);
  const held = await admin.req("GET", "/api/admin/transfers/held"); assert.ok(held.items.some((i) => i.id === r.transferId && i.holdReason === "new_account"));
  const before = (await ali.req("GET", "/api/transfers/balance")).available;
  const rel = await admin.req("POST", `/api/admin/transfers/${r.transferId}/release`, { note: "ok" }); assert.equal(rel.status, 200, rel.error);
  assert.equal((await ali.req("GET", "/api/transfers/balance")).available, before + 2);
  assert.equal((await admin.req("POST", `/api/admin/transfers/${r.transferId}/release`, {})).status, 409);
  H.app.ctx.rl.w.clear();
  const r2 = await send(newbie, { toHandle: "tr_ali", amount: 1 }); await payIntent(newbie, r2.intent);
  const rej = await admin.req("POST", `/api/admin/transfers/${r2.transferId}/reject`, { note: "مشبوه" }); assert.equal(rej.status, 200, rej.error);
  assert.ok(rej.refundId); await tr().settle();
  assert.equal((await db().get("SELECT status FROM pi_transfers WHERE id=$1", [r2.transferId])).status, "rejected");
  assert.equal((await db().get("SELECT status FROM pi_transactions WHERE id=$1", [r2.intent.id])).status, "refunded");
  assert.equal(await notes(newbie.id, "pi_transfer_rejected"), 1);
  await ledgerOk();
});

test("payment requests: create → notify → pay via requestId → paid; decline, cancel, closed", async () => {
  await db().run("DELETE FROM pi_transfers WHERE sender_id=$1", [cem.id]); // fresh hourly window for cem
  const q = await bea.req("POST", "/api/transfers/requests", { fromHandle: "tr_cem", amount: 3, note: "حصتك" }); assert.equal(q.status, 200, q.error);
  assert.equal(q.request.direction, "out"); assert.equal(await notes(cem.id, "pi_request_received"), 1);
  const inbox = await cem.req("GET", "/api/transfers/requests"); assert.equal(inbox.openIncoming, 1); assert.equal(inbox.items[0].requester.handle, "tr_bea");
  assert.equal((await ali.req("POST", "/api/transfers/intent", { requestId: q.request.id })).status, 404);
  const it = await send(cem, { requestId: q.request.id }); assert.equal(it.intent.amount, 3);
  await payIntent(cem, it.intent);
  const done = await db().get("SELECT * FROM pi_pay_requests WHERE id=$1", [q.request.id]); assert.equal(done.status, "paid"); assert.equal(done.transfer_id, it.transferId);
  assert.equal(await notes(bea.id, "pi_request_paid"), 1);
  assert.equal((await cem.req("POST", "/api/transfers/intent", { requestId: q.request.id })).code, "request_closed");
  const q2 = await bea.req("POST", "/api/transfers/requests", { fromHandle: "tr_cem", amount: 1 });
  assert.equal((await bea.req("POST", `/api/transfers/requests/${q2.request.id}/decline`)).status, 403);
  assert.equal((await cem.req("POST", `/api/transfers/requests/${q2.request.id}/decline`)).body.status, "declined");
  assert.equal(await notes(bea.id, "pi_request_declined"), 1);
  const q3 = await bea.req("POST", "/api/transfers/requests", { fromHandle: "tr_cem", amount: 1 });
  assert.equal((await bea.req("POST", `/api/transfers/requests/${q3.request.id}/cancel`)).body.status, "cancelled");
  assert.equal((await cem.req("POST", `/api/transfers/requests/${q3.request.id}/decline`)).code, "request_closed");
  assert.equal((await kid.req("POST", "/api/transfers/requests", { fromHandle: "tr_bea", amount: 1 })).code, "minor_restricted");
  for (let i = 0; i < 3; i++) await bea.req("POST", "/api/transfers/requests", { fromHandle: "tr_ali", amount: 1 });
  assert.equal((await bea.req("POST", "/api/transfers/requests", { fromHandle: "tr_ali", amount: 1 })).code, "request_payer_limit");
});

test("refund reverses a completed transfer; payouts reduce the balance; ledger stays balanced", async () => {
  await db().run("DELETE FROM pi_transfers WHERE sender_id=$1", [ali.id]);
  const r = await send(ali, { toHandle: "tr_cem", amount: 4 }); await payIntent(ali, r.intent);
  const b0 = (await cem.req("GET", "/api/transfers/balance")).available;
  const ref = await admin.req("POST", `/api/admin/pi/payments/${r.intent.id}/refund`, { note: "خطأ" }); assert.equal(ref.status, 200, ref.error);
  await tr().settle();
  assert.equal((await db().get("SELECT status FROM pi_transfers WHERE id=$1", [r.transferId])).status, "refunded");
  assert.equal((await cem.req("GET", "/api/transfers/balance")).available, b0 - 4);
  const r2 = await send(ali, { toHandle: "tr_cem", amount: 3 }); await payIntent(ali, r2.intent);
  const bal = (await cem.req("GET", "/api/transfers/balance")).available; assert.equal(bal, b0 - 4 + 3);
  assert.equal((await admin.req("POST", "/api/admin/transfers/payouts", { handle: "tr_cem", amount: bal + 1, txid: "tx_x" })).code, "insufficient_balance");
  const po = await admin.req("POST", "/api/admin/transfers/payouts", { handle: "tr_cem", amount: 1, txid: "tx_payout_1" }); assert.equal(po.status, 200, po.error);
  assert.equal(po.balance.available, Math.round((bal - 1) * 1e7) / 1e7); assert.equal(po.balance.paidOut, 1);
  await ledgerOk();
});

test("off: every transfer route answers 501 not_configured while Pi payments are off", async () => {
  const H2 = await boot({ piOpts: { env: {}, jobs: false }, tipsOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false } });
  try {
    const c = new H2.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو مؤقت", handle: "tr_off", password: "secret123" }); assert.equal(r.status, 200);
    const cfg = await c.req("GET", "/api/transfers/config"); assert.equal(cfg.enabled, false); assert.ok(cfg.note);
    for (const [m, p, b] of [["POST", "/api/transfers/intent", { toHandle: "x", amount: 1 }], ["GET", "/api/transfers"], ["POST", "/api/transfers/requests", { fromHandle: "x", amount: 1 }], ["GET", "/api/transfers/requests"], ["GET", "/api/transfers/balance"]]) {
      const x = await c.req(m, p, b); assert.equal(x.status, 501, p); assert.equal(x.code, "not_configured");
    }
  } finally { await H2.app.close(); }
});
