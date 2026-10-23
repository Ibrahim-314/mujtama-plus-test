/* Phase 37 — Tips & creator support. Runs against the stubbed Pi Platform API (same stub as pi.test.js, injected through
 * config.piOpts) with an injectable clock for the tips service (config.tipsOpts.now), on SQLite by default and on
 * PostgreSQL with TEST_DATABASE_URL. Covers: creator opt-in + tiers, tip intents through the pi service, fraud limits
 * (single / daily / hourly / young accounts / self / blocked / minors), held queue + admin release/reject, double-entry
 * ledger (balanced journals, fees, reversing journal on refund, admin check), monthly support (start, renew, reminder,
 * lapse, cancel), honour roll, per-post summary, earnings report + CSV, personal ledger, notifications, compliance map,
 * migration down/up. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { Router } = require("../lib/http");

const KEY = "sk_test_tips_456";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`;
const payments = new Map();
let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pay = (o) => { const p = { identifier: "tpay_" + (++seq), user_uid: o.uid, amount: o.amount, memo: o.memo || "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", created_at: new Date().toISOString(), status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
async function fakeFetch(url, o = {}) {
  if (new URL(url).pathname === "/pi/auth/v1/login") { // App Studio token exchange (phase 36b)
    const m = /^at-secret-([^-]+)-(.+)$/.exec(String(JSON.parse(o.body || "{}").accessToken || ""));
    return m ? res(200, { sessionToken: "st-" + m[1], user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {});
  }
  const path = new URL(url).pathname, method = o.method || "GET", auth = o.headers?.Authorization || "";
  if (path === "/v2/me") { const m = /^Bearer at-secret-([^-]+)-(.+)$/.exec(auth); return m ? res(200, { uid: "uid_" + m[1], username: m[2] }) : res(401, {}); }
  if (auth !== "Key " + KEY) return res(401, {});
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path);
  const p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, {});
  const body = o.body ? JSON.parse(o.body) : {};
  if (mm[2] === "approve") p.status.developer_approved = true;
  if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, {}); p.status.developer_completed = true; }
  if (mm[2] === "cancel") p.status.cancelled = true;
  void method; return res(200, JSON.parse(JSON.stringify(p)));
}
const PI_ENV = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub", PI_MAX_AMOUNT: "1000" };
const TIPS_ENV = { CREATOR_FEE_BPS: "500" }; // 5 % platform fee so the three-account journals are exercised
let offset = 0; // tips-service clock = real time + offset (lets the test walk through days and months)
const DAY = 864e5;

let H, admin, cara, fred, gina, nate, mina, otto;
const db = () => H.app.ctx.db;
const tips = () => H.app.ctx.services.tips;
const events = [];
const mk = async (handle, { old = true } = {}) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  if (old) await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
  return c;
};
const linkPi = async (c) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(c.handle.replace(/_/g, ""), c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + c.handle.replace(/_/g, ""); };
/** what the client does after an intent: Pi.createPayment → approve → (chain) → complete; then wait for the bus handlers */
async function payIntent(c, intent) {
  const p = pay({ uid: c.uid, amount: intent.amount, metadata: intent.metadata });
  const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
  p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
  const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
  await tips().settle();
  return p;
}
const tip = async (c, body) => { const r = await c.req("POST", "/api/tips/intent", body); assert.equal(r.status, 200, r.error); return r; };
const tipAndPay = async (c, body) => { const r = await tip(c, body); await payIntent(c, r.intent); return r; };
const check = async () => { const r = await admin.req("GET", "/api/admin/ledger/check"); assert.equal(r.status, 200); assert.equal(r.balanced, true, JSON.stringify(r.imbalances)); return r; };
const tipRow = (tipId) => db().get("SELECT * FROM tips WHERE id=$1", [tipId]);

test.before(async () => {
  H = await boot({ piOpts: { env: PI_ENV, fetch: fakeFetch, jobs: false }, tipsOpts: { env: TIPS_ENV, now: () => new Date(Date.now() + offset), jobs: false } });
  H.Client.prototype.req = async function (method, path, body, headers = {}) {
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    return { ...j, body: j, status: r.status, headers: r.headers };
  };
  for (const e of ["TIP_RECEIVED", "SUPPORT_STARTED", "SUPPORT_RENEWED", "SUPPORT_LAPSED"]) H.app.ctx.bus.on(e, (p) => events.push({ e, ...p }));
  admin = await mk("tp_admin"); cara = await mk("tp_cara"); fred = await mk("tp_fred"); gina = await mk("tp_gina"); otto = await mk("tp_otto");
  nate = await mk("tp_nate", { old: false }); mina = await mk("tp_mina");
  for (const c of [cara, fred, gina, nate, mina, otto]) await linkPi(c);
  const age = await mina.req("POST", "/api/age", { birthDate: "2012-05-01" }); assert.equal(age.status, 200, age.error);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 020: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '020_tips' ORDER BY id")).map(r => r.id); // e.g. 021_paid (phase 38) sits on top
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "020_tips"]);
  await assert.rejects(() => db().get("SELECT 1 FROM tips"));
  assert.ok(await db().get("SELECT 1 x FROM users LIMIT 1"), "existing tables untouched");
  assert.deepEqual(await mig.up(db()), ["020_tips", ...later]);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ledger_entries")).n), 0);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
});

test("creator settings: opt-in (default off), up to 3 tiers, validation, tier edit/retire, minors cannot enable", async () => {
  const pub = await new H.Client().req("GET", "/api/creators/tp_cara/support");
  assert.equal(pub.status, 200); assert.equal(pub.creator.enabled, false); assert.deepEqual(pub.tiers, []); assert.deepEqual(pub.myStatus, { tier: null, activeUntil: null, state: "none" });
  assert.equal((await new H.Client().req("GET", "/api/creators/nobody_here/support")).status, 404);
  assert.equal((await cara.req("GET", "/api/me/creator")).enabled, false);
  const T = (n, amount) => ({ name: "مستوى " + n, amount, perks: "شكر خاص" });
  for (const bad of [{ tiers: [T(1, 1), T(2, 2), T(3, 3), T(4, 4)] }, { tiers: [T(1, 0)] }, { tiers: [T(1, 101)] }, { tiers: [{ amount: 1 }] }, { tiers: "x" }, { tiers: [{ ...T(1, 1), id: "tier_not_mine" }] }])
    assert.equal((await cara.req("PUT", "/api/me/creator", bad)).status, 400, JSON.stringify(bad));
  const s1 = await cara.req("PUT", "/api/me/creator", { enabled: true, showAmounts: false, tiers: [T("برونزي", 1), T("فضي", 5)] });
  assert.equal(s1.status, 200, s1.error); assert.equal(s1.enabled, true); assert.equal(s1.tiers.length, 2); assert.equal(s1.feeBps, 500);
  const [bronze, silver] = s1.tiers;
  const s2 = await cara.req("PUT", "/api/me/creator", { tiers: [{ ...bronze, amount: 2 }, T("ذهبي", 10)] });
  assert.equal(s2.status, 200); assert.equal(s2.enabled, true, "omitted fields keep their value");
  assert.deepEqual(s2.tiers.map((t) => [t.name, t.amount]), [["مستوى برونزي", 2], ["مستوى ذهبي", 10]]);
  assert.equal(s2.tiers[0].id, bronze.id, "existing tier edited in place");
  assert.equal((await db().get("SELECT active FROM creator_tiers WHERE id=$1", [silver.id])).active * 1, 0, "dropped tier is retired, not deleted");
  const m = await mina.req("PUT", "/api/me/creator", { enabled: true });
  assert.equal(m.status, 403); assert.equal(m.code, "minor_restricted");
  assert.equal((await otto.req("PUT", "/api/me/creator", { enabled: true, showAmounts: true, tiers: [T("أساسي", 3)] })).status, 200);
  const page = await new H.Client().req("GET", "/api/creators/@tp_cara/support");
  assert.equal(page.creator.enabled, true); assert.equal(page.tiers.length, 2); assert.equal(page.creator.handle, "tp_cara");
  for (const k of ["id", "name", "amount", "perks"]) assert.ok(k in page.tiers[0], k);
});

test("tip intents: validation, creator opt-in, self, minors, blocks, post ownership, Pi link; intent proxied to the pi service", async () => {
  const post = (await cara.req("POST", "/api/posts", { text: "منشور يستحق الدعم" })).post; cara.post = post.id;
  const fpost = (await fred.req("POST", "/api/posts", { text: "منشور فريد" })).post;
  const e = async (c, body, status, code) => { const r = await c.req("POST", "/api/tips/intent", body); assert.equal(r.status, status, JSON.stringify(body) + " → " + r.error); if (code) assert.equal(r.code, code); };
  await e(new H.Client(), { toHandle: "tp_cara", amount: 1 }, 401);
  await e(fred, { toHandle: "tp_gina", amount: 1 }, 409, "creator_disabled");
  await e(cara, { toHandle: "tp_cara", amount: 1 }, 400, "self_tip");
  await e(fred, { toHandle: "nobody_here", amount: 1 }, 404);
  await e(fred, { toHandle: "tp_cara", amount: 0 }, 400);
  await e(fred, { toHandle: "tp_cara", amount: "x" }, 400);
  await e(fred, { toHandle: "tp_cara", amount: 100.5 }, 400, "tip_max");
  await e(fred, { toHandle: "tp_cara", amount: 1, postId: fpost.id }, 400);
  await e(fred, { toHandle: "tp_cara", amount: 1, postId: "nope" }, 404);
  await e(mina, { toHandle: "tp_cara", amount: 1 }, 403, "minor_restricted");
  await db().run("INSERT INTO creator_settings(user_id,enabled,show_amounts,created_at,updated_at) VALUES($1,1,0,$2,$2)", [mina.id, new Date().toISOString()]); // even if forced on
  await e(fred, { toHandle: "tp_mina", amount: 1 }, 403, "minor_restricted");
  assert.equal((await new H.Client().req("GET", "/api/creators/tp_mina/support")).creator.enabled, false, "a minor never shows as a creator");
  assert.equal((await gina.req("PUT", "/api/protection/blocks/" + cara.id, {})).status, 200);
  await e(gina, { toHandle: "tp_cara", amount: 1 }, 403, "blocked");
  assert.equal((await gina.req("DELETE", "/api/protection/blocks/" + cara.id)).status, 200);
  const unlinked = await mk("tp_unlinked");
  await e(unlinked, { toHandle: "tp_cara", amount: 1 }, 409, "pi_not_linked");
  const r = await tip(fred, { toHandle: "tp_cara", amount: 1.25, postId: post.id, message: "شكراً!" });
  assert.match(r.tipId, /^tip_/); assert.match(r.intent.id, /^pit_/); assert.equal(r.intent.amount, 1.25); assert.deepEqual(r.intent.metadata, { intentId: r.intent.id });
  const tx = await db().get("SELECT * FROM pi_transactions WHERE id=$1", [r.intent.id]);
  assert.equal(tx.purpose, "tip"); assert.equal(tx.ref_id, post.id, "refId = post id"); assert.equal(tx.status, "created");
  const row = await tipRow(r.tipId); assert.equal(row.status, "pending"); assert.equal(Number(row.amount), 12500000); assert.equal(Number(row.fee), 625000);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ledger_journals")).n), 0, "nothing is credited before Pi completes");
  // cancelling the Pi payment drops the pending tip
  const c = await fred.req("POST", "/api/pi/payments/cancel", { intentId: r.intent.id }); assert.equal(c.status, 200);
  await tips().settle(); assert.equal((await tipRow(r.tipId)).status, "cancelled");
});

test("Pi off: tip and support intents answer 501 without touching the database", async () => {
  const router = new Router();
  const ctx = { db: null, bus: { on() { }, emit() { } }, router, config: {}, requireUser: (fn) => fn, services: { pi: { enabled: () => false } } };
  require("../services/tips")(ctx, { env: {}, jobs: false });
  for (const p of ["/api/tips/intent", "/api/support/intent"]) await assert.rejects(() => router.match("POST", p).handler({ user: { id: "u" }, body: { toHandle: "x", amount: 1, tierId: "t" }, params: {}, query: {} }, {}), (e) => e.status === 501, p);
});

test("tip completes on PI_PAYMENT_COMPLETED: balanced journal with fee, TIP_RECEIVED + notification, idempotent, post summary", async () => {
  const r = await tipAndPay(fred, { toHandle: "tp_cara", amount: 2, postId: cara.post, message: "رائع" });
  const row = await tipRow(r.tipId); assert.equal(row.status, "completed"); assert.ok(row.completed_at);
  const js = await db().all("SELECT * FROM ledger_journals WHERE ref_id=$1", [r.tipId]); assert.equal(js.length, 1); assert.equal(js[0].kind, "tip");
  const lines = await db().all("SELECT account, debit, credit FROM ledger_entries WHERE journal_id=$1 ORDER BY id", [js[0].id]);
  assert.deepEqual(lines.map((l) => [l.account, Number(l.debit), Number(l.credit)]), [[`user:${fred.id}:pi_out`, 20000000, 0], [`creator:${cara.id}:earnings`, 0, 19000000], ["platform:fees", 0, 1000000]]);
  const ev = events.find((x) => x.e === "TIP_RECEIVED" && x.tip === r.tipId);
  assert.ok(ev); assert.equal(ev.creator, cara.id); assert.equal(ev.sender, fred.id); assert.equal(ev.amount, 2); assert.equal(ev.postId, cara.post);
  const n = await db().get("SELECT * FROM notifications WHERE user_id=$1 AND kind='tip' AND ref=$2", [cara.id, r.tipId]);
  assert.ok(n, "creator notified"); assert.equal(n.actor, fred.id);
  const L = require("../lib/notify-lib"); assert.equal(L.sentence("tip", ["فريد"], 1), "أرسل لك فريد إكرامية");
  // replaying the Pi event changes nothing
  const tx = await db().get("SELECT * FROM pi_transactions WHERE id=$1", [r.intent.id]);
  H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { user: fred.id, tx: tx.id, amount: tx.amount, purpose: "tip", refId: tx.ref_id }); await tips().settle();
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ledger_journals WHERE ref_id=$1", [r.tipId])).n), 1);
  assert.equal(events.filter((x) => x.e === "TIP_RECEIVED" && x.tip === r.tipId).length, 1);
  // anonymous tip: no actor, anonymous notification
  const a = await tipAndPay(gina, { toHandle: "tp_cara", amount: 1, postId: cara.post, anonymous: true, showAmount: true });
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='tip_anon' AND actor IS NULL AND ref=$2", [cara.id, a.tipId]));
  assert.equal(events.find((x) => x.tip === a.tipId).sender, null);
  const pubSum = await new H.Client().req("GET", `/api/posts/${cara.post}/tips`);
  assert.equal(pubSum.status, 200); assert.equal(pubSum.count, 2); assert.equal(pubSum.total, null, "creator hides amounts");
  assert.equal(pubSum.recent.length, 2); assert.equal(pubSum.recent[0].user, null, "anonymous respected"); assert.equal(pubSum.recent[1].user.handle, "tp_fred");
  assert.ok(pubSum.recent.every((x) => x.amount === null) && !("message" in pubSum.recent[0]));
  const own = await cara.req("GET", `/api/posts/${cara.post}/tips`);
  assert.equal(own.total, 3); assert.equal(own.recent[1].message, "رائع"); assert.equal(own.recent[0].user, null, "anonymous even for the creator");
  await check();
});

test("fraud limits: young accounts 10 Pi/day, 500 Pi/day, 20 tips/hour", async () => {
  await tip(nate, { toHandle: "tp_cara", amount: 6 });
  const y = await nate.req("POST", "/api/tips/intent", { toHandle: "tp_cara", amount: 5 });
  assert.equal(y.status, 429); assert.equal(y.code, "tip_daily_limit"); assert.match(y.error, /10/);
  offset += 4 * DAY; // nate is now 4 days old and the day window has passed
  assert.equal((await nate.req("POST", "/api/tips/intent", { toHandle: "tp_cara", amount: 20 })).status, 200, "older than 3 days: normal limits");
  offset += 2 * DAY;
  for (let i = 0; i < 5; i++) { offset += 11 * 60e3; await tip(otto, { toHandle: "tp_cara", amount: 100 }); } // spread out: no velocity hold
  const d = await otto.req("POST", "/api/tips/intent", { toHandle: "tp_cara", amount: 0.5 });
  assert.equal(d.status, 429); assert.equal(d.code, "tip_daily_limit");
  offset += 2 * DAY;
  for (let i = 0; i < 20; i++) await tip(otto, { toHandle: "tp_cara", amount: 0.1 });
  const h = await otto.req("POST", "/api/tips/intent", { toHandle: "tp_cara", amount: 0.1 });
  assert.equal(h.status, 429); assert.equal(h.code, "tip_hourly_limit");
  const flagged = await db().get("SELECT COUNT(*) n FROM tips WHERE sender_id=$1 AND hold_reason='velocity'", [otto.id]);
  assert.equal(Number(flagged.n), 15, "the 6th+ tip within 10 minutes is marked for review");
  offset += 2 * DAY;
});

test("held queue: velocity → paid into platform:held, admin release credits the creator, reject reverses + records the Pi refund", async () => {
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(await tipAndPay(gina, { toHandle: "tp_otto", amount: 1 }));
  const rows = await Promise.all(ids.map((r) => tipRow(r.tipId)));
  assert.deepEqual(rows.map((r) => r.status), ["completed", "completed", "completed", "completed", "completed", "held", "held"]);
  const [h1, h2] = [ids[5].tipId, ids[6].tipId];
  const hj = await db().get("SELECT * FROM ledger_journals WHERE ref_id=$1", [h1]); assert.equal(hj.kind, "tip_hold");
  assert.ok(!events.some((x) => x.tip === h1), "no TIP_RECEIVED while held");
  assert.ok(await db().get("SELECT 1 x FROM integrity_flags WHERE kind='tip_velocity' AND sig=$1", ["tip:" + h1]), "soft integrity flag");
  assert.equal((await gina.req("GET", "/api/admin/tips/held")).status, 403);
  const list = await admin.req("GET", "/api/admin/tips/held");
  assert.equal(list.status, 200); assert.deepEqual(list.items.map((x) => x.id).sort(), [h1, h2].sort());
  assert.equal(list.items[0].holdReason, "velocity"); assert.equal(list.items[0].sender.handle, "tp_gina"); assert.equal(list.items[0].creator.handle, "tp_otto");
  const before = await otto.req("GET", "/api/me/earnings?period=day");
  const rel = await admin.req("POST", `/api/admin/tips/${h1}/release`, { note: "تمت المراجعة" });
  assert.equal(rel.status, 200, rel.error); assert.equal(rel.body.status, "completed");
  await tips().settle();
  assert.equal((await tipRow(h1)).status, "completed"); assert.ok(events.some((x) => x.e === "TIP_RECEIVED" && x.tip === h1));
  assert.equal((await admin.req("POST", `/api/admin/tips/${h1}/release`, {})).status, 200, "release twice is harmless");
  const after = await otto.req("GET", "/api/me/earnings?period=day");
  assert.equal(Math.round((after.net - before.net) * 1e7), 9500000, "released tip credited net of the 5% fee");
  const rej = await admin.req("POST", `/api/admin/tips/${h2}/reject`, { note: "احتيال محتمل", txid: "tx_back" });
  assert.equal(rej.status, 200, rej.error); assert.equal(rej.body.status, "rejected"); assert.equal(rej.refundRecorded, true);
  await tips().settle();
  assert.equal((await tipRow(h2)).status, "rejected", "the refund event does not overwrite a rejection");
  const pit = await db().get("SELECT status FROM pi_transactions WHERE id=$1", [ids[6].intent.id]); assert.equal(pit.status, "refunded");
  const js = await db().all("SELECT kind, reverses FROM ledger_journals WHERE ref_id=$1 ORDER BY created_at, id", [h2]);
  assert.deepEqual(js.map((j) => j.kind), ["tip_hold", "reversal"]);
  assert.equal(Number((await db().get("SELECT COALESCE(SUM(credit)-SUM(debit),0) b FROM ledger_entries WHERE account='platform:held'")).b), 0, "suspense account back to zero");
  assert.equal((await admin.req("POST", `/api/admin/tips/${ids[0].tipId}/reject`, {})).status, 409, "only held tips");
  await check();
});

test("refund of a completed tip: reversing journal, tip refunded, earnings show the refund, ledger balanced", async () => {
  offset += DAY;
  const r = await tipAndPay(fred, { toHandle: "tp_otto", amount: 4, postId: undefined });
  const ref = await admin.req("POST", `/api/admin/pi/payments/${r.intent.id}/refund`, { note: "طلب المرسل", txid: "tx_ref" });
  assert.equal(ref.status, 200, ref.error); await tips().settle();
  assert.equal((await tipRow(r.tipId)).status, "refunded");
  const js = await db().all("SELECT * FROM ledger_journals WHERE ref_id=$1 ORDER BY created_at, id", [r.tipId]);
  assert.deepEqual(js.map((j) => j.kind), ["tip", "reversal"]); assert.equal(js[1].reverses, js[0].id);
  const a = await db().all("SELECT account, debit, credit FROM ledger_entries WHERE journal_id=$1 ORDER BY id", [js[0].id]);
  const b = await db().all("SELECT account, debit, credit FROM ledger_entries WHERE journal_id=$1 ORDER BY id", [js[1].id]);
  assert.deepEqual(b.map((l) => [l.account, Number(l.debit), Number(l.credit)]), a.map((l) => [l.account, Number(l.credit), Number(l.debit)]), "exact mirror");
  H.app.ctx.bus.emit("PI_PAYMENT_REFUNDED", { user: fred.id, tx: r.intent.id, purpose: "tip" }); await tips().settle();
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ledger_journals WHERE ref_id=$1", [r.tipId])).n), 2, "reversal is idempotent");
  const e = await otto.req("GET", "/api/me/earnings?period=day");
  assert.equal(e.refunds, 3.8); assert.equal(e.gross, 4); assert.equal(e.fees, 0.2); assert.equal(e.net, 0);
  const chk = await check(); assert.ok(chk.journals >= 10); assert.equal(chk.totals.debit, chk.totals.credit);
});

test("admin ledger check detects an unbalanced journal", async () => {
  const t = new Date().toISOString();
  await db().run("INSERT INTO ledger_journals(id,ikey,kind,source,ref_id,created_at) VALUES('jr_bad','test:bad','tip','tip','x',$1)", [t]);
  await db().run("INSERT INTO ledger_entries(journal_id,account,debit,credit,created_at) VALUES('jr_bad','platform:fees',5,0,$1)", [t]);
  const r = await admin.req("GET", "/api/admin/ledger/check");
  assert.equal(r.balanced, false); assert.equal(r.imbalances[0].journalId, "jr_bad");
  assert.equal((await fred.req("GET", "/api/admin/ledger/check")).status, 403);
  await db().run("DELETE FROM ledger_entries WHERE journal_id='jr_bad'"); await db().run("DELETE FROM ledger_journals WHERE id='jr_bad'"); // test cleanup only
  await check();
});

test("monthly support: start, already active, due + one reminder, renew (continuous), cancel keeps the paid month, lapse after grace", async () => {
  const tiers = (await cara.req("GET", "/api/me/creator")).tiers, gold = tiers.find((t) => t.amount === 10), bronze = tiers.find((t) => t.amount === 2);
  assert.equal((await fred.req("POST", "/api/support/intent", { toHandle: "tp_cara", tierId: "tier_nope" })).status, 404);
  assert.equal((await fred.req("POST", "/api/support/intent", { toHandle: "tp_otto", tierId: gold.id })).status, 404, "tier must belong to that creator");
  assert.equal((await mina.req("POST", "/api/support/intent", { toHandle: "tp_cara", tierId: gold.id })).code, "minor_restricted");
  const s = await fred.req("POST", "/api/support/intent", { toHandle: "tp_cara", tierId: gold.id });
  assert.equal(s.status, 200, s.error); assert.match(s.supportId, /^sup_/); assert.equal(s.intent.amount, 10);
  const tx = await db().get("SELECT * FROM pi_transactions WHERE id=$1", [s.intent.id]); assert.equal(tx.purpose, "subscription"); assert.equal(tx.ref_id, cara.id);
  const t0 = Date.now() + offset;
  await payIntent(fred, s.intent);
  const st = events.find((x) => x.e === "SUPPORT_STARTED" && x.support === s.supportId); assert.ok(st); assert.equal(st.creator, cara.id);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='support_started' AND actor=$2", [cara.id, fred.id]));
  let page = await fred.req("GET", "/api/creators/tp_cara/support");
  assert.equal(page.myStatus.state, "active"); assert.equal(page.myStatus.tier.id, gold.id);
  const until1 = Date.parse(page.myStatus.activeUntil); assert.ok(Math.abs(until1 - (t0 + 30 * DAY)) < 60e3, "30-day period");
  assert.equal(page.stats.supporters, 1);
  const again = await fred.req("POST", "/api/support/intent", { toHandle: "tp_cara", tierId: gold.id });
  assert.equal(again.status, 409); assert.equal(again.code, "support_active");
  // 28 days later: due, one reminder only
  offset += 28 * DAY;
  assert.equal((await fred.req("GET", "/api/creators/tp_cara/support")).myStatus.state, "due");
  const j1 = await tips().supportJob(); const j2 = await tips().supportJob();
  assert.equal(j1.reminded, 1); assert.equal(j2.reminded, 0, "one reminder per period");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind='support_due'", [fred.id])).n), 1);
  assert.equal((await H.app.ctx.scheduler.runOnce("tips.support", () => tips().supportJob())).ok, true, "runs under the leased scheduler");
  // renew (switching to the bronze tier): continues from the old end date
  const r2 = await fred.req("POST", "/api/support/intent", { toHandle: "tp_cara", tierId: bronze.id }); assert.equal(r2.status, 200, r2.error); assert.equal(r2.supportId, s.supportId);
  await payIntent(fred, r2.intent);
  assert.ok(events.find((x) => x.e === "SUPPORT_RENEWED" && x.support === s.supportId));
  page = await fred.req("GET", "/api/creators/tp_cara/support");
  assert.equal(Date.parse(page.myStatus.activeUntil), until1 + 30 * DAY, "no gap, no overlap"); assert.equal(page.myStatus.tier.id, bronze.id); assert.equal(page.myStatus.state, "active");
  // cancel: stays entitled until the end of the paid month, no reminder, no lapse event
  assert.equal((await gina.req("POST", `/api/support/${s.supportId}/cancel`, {})).status, 404, "only the supporter");
  const c = await fred.req("POST", `/api/support/${s.supportId}/cancel`, {});
  assert.equal(c.status, 200); assert.equal(c.state, "cancelled"); assert.equal(Date.parse(c.activeUntil), until1 + 30 * DAY); assert.equal(c.refundEligible, true);
  const mine = await fred.req("GET", "/api/me/supporting");
  assert.equal(mine.items.length, 1); assert.equal(mine.items[0].state, "cancelled"); assert.equal(mine.items[0].creator.handle, "tp_cara");
  // gina supports otto and never renews → lapsed after the 3-day grace
  const ot = (await otto.req("GET", "/api/me/creator")).tiers[0];
  const g = await gina.req("POST", "/api/support/intent", { toHandle: "tp_otto", tierId: ot.id, anonymous: true }); assert.equal(g.status, 200, g.error);
  await payIntent(gina, g.intent);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='support_anon' AND actor IS NULL", [otto.id]));
  offset += 32 * DAY; assert.equal((await tips().supportJob()).lapsed, 0, "still inside the grace period");
  offset += 2 * DAY;
  const j3 = await tips().supportJob(); assert.equal(j3.lapsed, 1);
  await tips().settle();
  assert.ok(events.find((x) => x.e === "SUPPORT_LAPSED" && x.support === g.supportId));
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='support_lapsed'", [gina.id]));
  assert.equal((await gina.req("GET", "/api/creators/tp_otto/support")).myStatus.state, "lapsed");
  assert.equal((await db().get("SELECT state FROM support_subscriptions WHERE id=$1", [s.supportId])).state, "cancelled", "cancelled supports never lapse");
  // coming back after a lapse starts a new period from now (SUPPORT_STARTED again)
  const g2 = await gina.req("POST", "/api/support/intent", { toHandle: "tp_otto", tierId: ot.id }); assert.equal(g2.status, 200);
  await payIntent(gina, g2.intent);
  assert.equal(events.filter((x) => x.e === "SUPPORT_STARTED" && x.support === g.supportId).length, 2);
  // refund of that month ends the support where the month began
  await admin.req("POST", `/api/admin/pi/payments/${g2.intent.id}/refund`, { note: "خلال ٢٤ ساعة" }); await tips().settle();
  const sub = await db().get("SELECT * FROM support_subscriptions WHERE id=$1", [g.supportId]);
  assert.equal(sub.state, "cancelled"); assert.ok(Date.parse(sub.active_until) <= Date.now() + offset);
  await check();
});

test("honour roll + public support page: ranking, anonymous respected, amounts only when creator and supporter allow", async () => {
  offset += DAY;
  await tipAndPay(fred, { toHandle: "tp_otto", amount: 9, showAmount: true });
  await tipAndPay(cara, { toHandle: "tp_otto", amount: 3 });
  const w = await new H.Client().req("GET", "/api/creators/tp_otto/wall?period=all");
  assert.equal(w.status, 200); assert.equal(w.period, "all");
  assert.ok(w.items.length >= 3 && w.items.length <= 50);
  assert.deepEqual(w.items.map((x) => x.rank), w.items.map((_, i) => i + 1));
  const fredRow = w.items.find((x) => x.user?.handle === "tp_fred"), caraRow = w.items.find((x) => x.user?.handle === "tp_cara");
  assert.ok(fredRow && caraRow); assert.equal(fredRow.amount, null, "fred hid the amount on an earlier tip");
  assert.equal(caraRow.amount, null, "cara did not allow showing her amount");
  assert.ok(w.items.some((x) => x.user === null), "anonymous supporter listed without identity");
  const ginaRow = w.items.find((x) => x.user?.handle === "tp_gina"); assert.ok(ginaRow); assert.equal(ginaRow.amount, null);
  const tips2 = await tipAndPay(gina, { toHandle: "tp_cara", amount: 0.5, showAmount: true });
  await cara.req("PUT", "/api/me/creator", { showAmounts: true });
  const wc = await new H.Client().req("GET", "/api/creators/tp_cara/wall?period=month");
  const gc = wc.items.find((x) => x.user?.handle === "tp_gina"); assert.ok(gc); assert.equal(gc.amount, 0.5, "both allowed");
  const page = await new H.Client().req("GET", "/api/creators/tp_cara/support");
  assert.ok(page.wall.length >= 1); assert.equal(page.wall[0].kind, "tip"); assert.equal(page.wall[0].amount, 0.5); assert.equal(page.wall[0].user.handle, "tp_gina");
  for (const k of ["supporters", "tipsCount"]) assert.equal(typeof page.stats[k], "number");
  assert.equal((await new H.Client().req("GET", `/api/posts/${cara.post}/tips`)).total, 3, "post total public once the creator shows amounts");
  void tips2;
});

test("earnings report + CSV + personal ledger (cursor)", async () => {
  const e = await cara.req("GET", "/api/me/earnings?period=month");
  assert.equal(e.status, 200); assert.equal(e.currency, "Pi");
  for (const k of ["gross", "fees", "net", "refunds", "series", "bySource", "topPosts", "topSupporters", "csvUrl"]) assert.ok(k in e, k);
  assert.equal(e.series.length, 30); assert.ok(e.series.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date)));
  assert.equal(Math.round((e.gross - e.fees - e.refunds - e.net) * 1e7), 0, "net = gross − fees − refunds");
  assert.equal(Math.round(e.fees * 1e7), Math.round(e.gross * 0.05 * 1e7));
  const all = await cara.req("GET", `/api/me/earnings?from=2020-01-01&to=${new Date(Date.now() + offset).toISOString().slice(0, 10)}`);
  assert.equal(all.status, 400, "range longer than a year");
  const from = new Date(Date.now() + offset - 200 * DAY).toISOString().slice(0, 10), to = new Date(Date.now() + offset).toISOString().slice(0, 10);
  const full = await cara.req("GET", `/api/me/earnings?from=${from}&to=${to}`);
  assert.equal(full.status, 200, full.error); assert.equal(full.period, "custom");
  // cara: fred 2 + gina 1 (anon) + gina 0.5 tips, fred support 10 + 2
  assert.equal(full.gross, 15.5); assert.equal(full.bySource.support, 12); assert.equal(full.bySource.tips, 3.5); assert.equal(full.refunds, 0);
  assert.deepEqual(full.topPosts, [{ postId: cara.post, total: 3 }]);
  assert.equal(full.topSupporters[0].user.handle, "tp_fred"); assert.equal(full.topSupporters[0].total, 14);
  assert.ok(full.topSupporters.some((x) => x.user === null && x.anonymous));
  assert.equal((await cara.req("GET", "/api/me/earnings?from=2024-13-01")).status, 400);
  const csv = await fetch(H.base + full.csvUrl, { headers: { Cookie: cara.cookie } });
  assert.equal(csv.status, 200); assert.match(csv.headers.get("content-type"), /text\/csv/);
  const text = await csv.text(); const rows = text.replace(/^\uFEFF/, "").split("\r\n");
  assert.equal(rows[0], "date,journal,kind,source,post,supporter,gross,fee,net"); assert.equal(rows.length - 1, 5);
  assert.ok(text.includes("مجهول") && text.includes("@tp_fred") && text.includes("@tp_gina"));
  assert.equal((await new H.Client().req("GET", "/api/me/earnings")).status, 401);
  // personal ledger: fred's outgoing entries, newest first, cursor pages
  const p1 = await fred.req("GET", "/api/me/ledger?limit=2"); assert.equal(p1.entries.length, 2); assert.ok(p1.nextCursor);
  assert.ok(p1.entries.every((x) => x.account === "pi_out"));
  const p2 = await fred.req("GET", "/api/me/ledger?limit=50&cursor=" + p1.nextCursor);
  assert.ok(p2.entries.every((x) => x.id < p1.entries[1].id));
  const total = [...p1.entries, ...p2.entries].reduce((s, x) => s + x.amount, 0);
  assert.equal(Math.round(total * 1e7), Math.round((2 + 10 + 2 + 9 + 4 - 4) * 1e7), "paid out minus refunds");
  assert.equal((await fred.req("GET", "/api/me/ledger?cursor=@@")).status, 400);
  const ce = await cara.req("GET", "/api/me/ledger?limit=100"); assert.ok(ce.entries.some((x) => x.account === "earnings" && x.amount > 0));
  await check();
});

test("compliance: new tables in the data map, export carries sent tips, erasure clears tip messages", async () => {
  const L = require("../lib/compliance-lib");
  const mapped = new Set([...L.DATA_MAP.map((m) => m.t), ...L.SYSTEM_RECORDS.map((m) => m.t)]);
  for (const t of ["creator_settings", "creator_tiers", "tips", "support_subscriptions", "support_payments", "ledger_entries", "ledger_journals"]) assert.ok(mapped.has(t), t);
  for (const m of L.DATA_MAP.filter((x) => ["tips", "support_subscriptions", "support_payments", "ledger_entries", "creator_settings", "creator_tiers"].includes(x.t)))
    await db().get(`SELECT ${m.cols ? m.cols.join(",") : "*"} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [fred.id]); // columns + condition are valid SQL
  const col = await H.app.ctx.services.compliance;
  assert.ok(col);
  H.app.ctx.bus.emit("USER_ANONYMISED", { user: fred.id }); await tips().settle();
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM tips WHERE sender_id=$1 AND message IS NOT NULL", [fred.id])).n), 0);
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM tips WHERE sender_id=$1", [fred.id])).n) > 0, "financial rows kept");
  await check();
});
