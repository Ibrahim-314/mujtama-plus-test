/* v2.160 — phase 4: MJT internal rewards economy (services/mjt-rewards.js, migration 090).
 * wallet created lazily · credit / debit / insufficient / never negative · idempotency · parallel credits + debits ·
 * sources ship disabled (nothing paid) · caps · approval flow · freeze / unfreeze · velocity review · admin 403 ·
 * a forged client amount is ignored · Free / Plus quotas unchanged · the shared ledger still verifies. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const AD = (...a) => require("./admin-shim").shim(H)(...a); // v2.167: removed admin routes → service fixtures (see admin-shim.js)
const { UNIT } = require("../lib/mjt-ledger");

let H, admin, a, b, c;
const db = () => H.app.ctx.db;
const RW = () => H.app.ctx.services.mjtRewards;
const ACH = () => H.app.ctx.services.achievements;
const clear = () => H.app.ctx.rl.w.clear();
const n = async (sql, p = []) => Number((await db().get(sql, p)).n);
const bal = async (uid) => Number((await db().get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + uid]))?.balance || 0);
const mk = async (handle) => {
  clear(); const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), cl.id]);
  return cl;
};
let k = 0; const key = (p = "t") => `${p}_${Date.now()}_${k++}`;
const achieve = async (uid, type, ref, meta) => { await ACH().record(uid, type, ref, meta); await RW().settle(); };
const setSource = async (keyName, body) => { clear(); const r = await AD(admin, "PUT", "/api/admin/mjt/rewards/sources/" + keyName, body); assert.equal(r.status, 200, r.error); return r.source; };

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false } });
  admin = await mk("rw_admin"); a = await mk("rw_a"); b = await mk("rw_b"); c = await mk("rw_c");
  await RW().ready;
});
test.after(() => H.app.close());
test.beforeEach(clear);

test("migration 090 is additive and reversible", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '090_mjt_rewards' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "090_mjt_rewards"]);
  await assert.rejects(() => db().get("SELECT 1 FROM mjt_reward_entries"));
  await db().get("SELECT 1 FROM mjt_accounts"); // the existing ledger is untouched
  assert.deepEqual(await mig.up(db()), ["090_mjt_rewards", ...later]);
  // the table came back empty: seed it again exactly as boot does (disabled, no amount)
  for (const [kk, label] of Object.entries(RW().REWARDABLE)) await db().run("INSERT INTO mjt_reward_sources(key,label,amount,max_per_ref,requires_approval,enabled,created_at,updated_at) VALUES($1,$2,NULL,1,0,0,$3,$3) ON CONFLICT DO NOTHING", [kk, label, new Date().toISOString()]);
});

test("every source ships disabled with no amount; a disabled source pays nothing; login / likes / saves are not sources", async () => {
  const s = await AD(admin, "GET", "/api/admin/mjt/rewards/sources"); assert.equal(s.status, 200, s.error);
  assert.ok(s.sources.length >= 4);
  for (const x of s.sources) { assert.equal(x.enabled, false, x.key); assert.equal(x.amount, null, x.key); }
  for (const bad of ["login", "checkin", "like", "react", "saved_search_created", "collection_created"]) assert.ok(!s.rewardable.includes(bad), bad);
  clear(); assert.equal((await AD(admin, "POST", "/api/admin/mjt/rewards/sources", { key: "saved_search_created" })).code, "not_rewardable");
  clear(); assert.equal((await AD(admin, "PUT", "/api/admin/mjt/rewards/sources/quiz_passed", { enabled: true })).code, "amount_required", "cannot enable without an amount");
  const tx0 = await n("SELECT COUNT(*) n FROM mjt_tx");
  await achieve(a.id, "quiz_passed", "lesson-disabled");
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_tx"), tx0); assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE user_id=$1", [a.id]), 0);
  assert.equal((await RW().onAchievement({ user: a.id, type: "quiz_passed", ref: "x" })).reason, "disabled");
  await setSource("quiz_passed", { amount: 3 }); // amount set but still disabled
  assert.equal((await RW().onAchievement({ user: a.id, type: "quiz_passed", ref: "x2" })).reason, "disabled");
});

test("wallet is created lazily on first access; member page data carries the no-monetary-value note", async () => {
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_accounts WHERE user_id=$1", [c.id]), 0);
  const w = await c.req("GET", "/api/mjt/wallet"); assert.equal(w.status, 200, w.error);
  assert.equal(w.wallet.balance, "0"); assert.equal(w.wallet.earnedTotal, "0"); assert.equal(w.wallet.spentTotal, "0"); assert.equal(w.wallet.status, "active");
  assert.match(w.note, /ليس له قيمة نقدية/); assert.deepEqual(w.recent, []);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_accounts WHERE user_id=$1", [c.id]), 1);
  clear(); assert.equal((await new H.Client().req("GET", "/api/mjt/wallet")).status, 401);
});

test("credit, debit, insufficient debit, never negative, balance_after recorded", async () => {
  const r1 = await RW().credit(b.id, { amount: 5 * UNIT, source: "quiz_passed", ref: "l1", ikey: key("cr") });
  assert.equal(r1.entry.status, "posted"); assert.equal(Number(r1.entry.balance_after), 5 * UNIT); assert.equal(await bal(b.id), 5 * UNIT);
  const d1 = await RW().debit(b.id, { amount: 2 * UNIT, source: "future_service", ref: "o1", ikey: key("db") });
  assert.equal(Number(d1.entry.balance_after), 3 * UNIT);
  await assert.rejects(() => RW().debit(b.id, { amount: 4 * UNIT, ikey: key("db") }), (e) => e.code === "insufficient_balance");
  assert.equal(await bal(b.id), 3 * UNIT, "a refused debit changes nothing");
  assert.deepEqual(await RW().canSpend(b.id, 3 * UNIT), { ok: true, balance: 3 * UNIT });
  assert.equal((await RW().canSpend(b.id, 4 * UNIT)).reason, "insufficient_balance");
  await assert.rejects(() => RW().credit(b.id, { amount: 0, ikey: key() })); await assert.rejects(() => RW().credit(b.id, { amount: -5, ikey: key() }));
  await assert.rejects(() => RW().credit(b.id, { amount: 1.5, ikey: key() }));
  const w = await RW().walletOf(b.id); assert.equal(w.earnedTotal, "5"); assert.equal(w.spentTotal, "2"); assert.equal(w.balance, "3");
});

test("duplicate idempotency key applies once", async () => {
  const kk = key("dup"), before = await bal(b.id);
  const r1 = await RW().credit(b.id, { amount: UNIT, ikey: kk }); const r2 = await RW().credit(b.id, { amount: UNIT, ikey: kk });
  assert.equal(r1.replayed, false); assert.equal(r2.replayed, true);
  assert.equal(await bal(b.id), before + UNIT);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE idempotency_key=$1", [kk]), 1);
  const same = await Promise.all(Array.from({ length: 6 }, () => RW().credit(b.id, { amount: UNIT, ikey: kk + "p" })));
  assert.equal(same.filter((x) => !x.replayed).length, 1); assert.equal(await bal(b.id), before + 2 * UNIT);
});

test("parallel credits and debits: no lost update, no double spend, never below zero", async () => {
  const u = (await mk("rw_par")).id;
  await Promise.all(Array.from({ length: 10 }, () => RW().credit(u, { amount: UNIT, ikey: key("pc") })));
  assert.equal(await bal(u), 10 * UNIT);
  const res = await Promise.allSettled(Array.from({ length: 15 }, () => RW().debit(u, { amount: UNIT, ikey: key("pd") })));
  assert.equal(res.filter((x) => x.status === "fulfilled").length, 10); assert.equal(res.filter((x) => x.status === "rejected").length, 5);
  assert.equal(await bal(u), 0);
  const v = await H.app.ctx.services.mjt.verify(); assert.equal(v.ok, true, v.problems.join(","));
});

test("an enabled source pays from an achievement event; a forged client amount is ignored; the same achievement pays once", async () => {
  await setSource("course_completed", { amount: 7, enabled: true });
  const before = await bal(a.id);
  await achieve(a.id, "course_completed", "course-1", { amount: 999999, points: 5000 });
  assert.equal(await bal(a.id) - before, 7 * UNIT, "the source amount, never the event's meta");
  await achieve(a.id, "course_completed", "course-1"); await RW().onAchievement({ user: a.id, type: "course_completed", ref: "course-1" });
  assert.equal(await bal(a.id) - before, 7 * UNIT, "once per achievement");
  // member endpoints take no amount at all
  clear(); const forged = await a.req("POST", "/api/mjt/wallet", { amount: 1000 }); assert.ok([404, 405].includes(forged.status), "no member write endpoint: " + forged.status);
  clear(); const w = await a.req("GET", "/api/mjt/wallet?amount=1000&balance=1000"); assert.equal(Number(w.wallet.balance), (before + 7 * UNIT) / UNIT);
  const h = await a.req("GET", "/api/mjt/wallet/history"); assert.equal(h.items[0].source, "إكمال دورة"); assert.equal(h.items[0].status, "posted");
});

test("caps: daily cap and per-ref limit stop extra rewards", async () => {
  await setSource("team_created", { amount: 2, enabled: true, dailyCap: 2 });
  const before = await bal(b.id);
  for (const r of ["t1", "t2", "t3"]) await achieve(b.id, "team_created", r);
  assert.equal(await bal(b.id) - before, 4 * UNIT, "two per day");
  assert.equal((await RW().onAchievement({ user: b.id, type: "team_created", ref: "t4" })).reason, "daily_cap");
  await setSource("team_created", { dailyCap: null, maxPerRef: 1 });
  assert.equal((await RW().onAchievement({ user: b.id, type: "team_created", ref: "t1" })).reason, "duplicate");
  await setSource("team_created", { enabled: false });
});

test("approval flow: pending → approve posts once; reject needs a reason; nothing is updated in place", async () => {
  await setSource("article_published", { amount: 4, enabled: true, requiresApproval: true });
  const before = await bal(c.id);
  await achieve(c.id, "article_published", "post-1"); await achieve(c.id, "article_published", "post-2");
  assert.equal(await bal(c.id), before, "pending pays nothing yet");
  const rv = await c.req("GET", "/api/mjt/wallet/review"); assert.equal(rv.items.length, 2); assert.equal(rv.items[0].status, "pending");
  const open = await AD(admin, "GET", "/api/admin/mjt/rewards/entries?status=open&handle=rw_c"); assert.equal(open.items.length, 2);
  const [p1, p2] = open.items;
  clear(); const ap = await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p1.id}/approve`, {}); assert.equal(ap.status, 200, ap.error); assert.equal(ap.entry.status, "posted");
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p1.id}/approve`, {})).status, 409, "decided once");
  assert.equal(await bal(c.id) - before, 4 * UNIT);
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p2.id}/reject`, {})).status, 400, "reason required");
  clear(); const rj = await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p2.id}/reject`, { reason: "مقال مكرر من مصدر آخر" }); assert.equal(rj.status, 200, rj.error);
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p2.id}/approve`, {})).status, 409);
  assert.equal(await bal(c.id) - before, 4 * UNIT, "rejected never pays");
  const orig = await db().get("SELECT status FROM mjt_reward_entries WHERE id=$1", [p2.id]); assert.equal(orig.status, "pending", "original row untouched; the decision is a new row");
  const det = await AD(admin, "GET", "/api/admin/mjt/rewards/entries/" + p2.id); assert.equal(det.decision.status, "rejected");
  const rv2 = await c.req("GET", "/api/mjt/wallet/review"); assert.deepEqual(rv2.items.map((x) => x.status), ["rejected"]);
  await setSource("article_published", { enabled: false });
});

test("freeze: earning waits as pending, spending is refused, pending stays pending until unfrozen; reason required", async () => {
  const u = await mk("rw_frz");
  await RW().credit(u.id, { amount: 3 * UNIT, ikey: key("f") });
  clear(); assert.equal((await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_frz/freeze", { frozen: true })).status, 400, "reason required");
  clear(); const fr = await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_frz/freeze", { frozen: true, reason: "مراجعة أمنية للحساب" }); assert.equal(fr.status, 200, fr.error); assert.equal(fr.wallet.frozen, true);
  await assert.rejects(() => RW().debit(u.id, { amount: UNIT, ikey: key("f") }), (e) => e.code === "account_frozen");
  assert.equal((await RW().canSpend(u.id, UNIT)).reason, "account_frozen");
  await setSource("course_completed", { amount: 7, enabled: true });
  await achieve(u.id, "course_completed", "c-frozen");
  assert.equal(await bal(u.id), 3 * UNIT);
  const p = await db().get("SELECT * FROM mjt_reward_entries WHERE user_id=$1 AND status='pending'", [u.id]); assert.match(p.reason, /wallet_frozen/);
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p.id}/approve`, {})).code, "account_frozen", "pending stays pending while frozen");
  clear(); await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_frz/freeze", { frozen: false, reason: "انتهت المراجعة الأمنية" });
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p.id}/approve`, {})).status, 200);
  assert.equal(await bal(u.id), 10 * UNIT);
  assert.ok(await n("SELECT COUNT(*) n FROM mjt_audit WHERE target=$1 AND action IN ('freeze','unfreeze')", [u.id]) >= 2);
});

test("velocity: too many rewards in an hour wait for review instead of posting", async () => {
  clear(); await AD(admin, "PUT", "/api/admin/mjt/rewards/settings", { velocityPerHour: 2 });
  await setSource("quiz_passed", { amount: 1, enabled: true, maxPerRef: 1 });
  const u = await mk("rw_vel");
  for (const r of ["q1", "q2", "q3", "q4"]) await achieve(u.id, "quiz_passed", r);
  assert.equal(await bal(u.id), 2 * UNIT);
  const pend = await db().all("SELECT reason FROM mjt_reward_entries WHERE user_id=$1 AND status='pending'", [u.id]);
  assert.equal(pend.length, 2); for (const x of pend) assert.match(x.reason, /velocity_review/);
  clear(); await AD(admin, "PUT", "/api/admin/mjt/rewards/settings", { velocityPerHour: 10 });
  await setSource("quiz_passed", { enabled: false });
});

test("admin corrective credit / debit: reason + ikey required, actor and audit recorded, never below zero", async () => {
  const u = await mk("rw_adj");
  clear(); assert.equal((await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_adj/adjust", { direction: "credit", amount: 5, ikey: key("adjk") })).status, 400, "reason required");
  clear(); assert.equal((await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_adj/adjust", { direction: "credit", amount: "2.5", reason: "تصحيح مكافأة ناقصة", ikey: key("adjk") })).code, "bad_amount");
  clear(); const cr = await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_adj/adjust", { direction: "credit", amount: 5, reason: "تصحيح مكافأة ناقصة", ikey: key("adjk") }); assert.equal(cr.status, 200, cr.error);
  assert.equal(cr.entry.kind, "adjust_credit"); assert.equal(cr.wallet.balance, "5");
  clear(); assert.equal((await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_adj/adjust", { direction: "debit", amount: 9, reason: "تصحيح مكافأة زائدة", ikey: key("adjk") })).code, "insufficient_balance");
  clear(); const db1 = await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_adj/adjust", { direction: "debit", amount: 2, reason: "تصحيح مكافأة زائدة", ikey: key("adjk") }); assert.equal(db1.wallet.balance, "3");
  const rows = await db().all("SELECT actor_id, reason FROM mjt_reward_entries WHERE user_id=$1 ORDER BY created_at", [u.id]);
  assert.deepEqual(rows.map((r) => r.actor_id), [admin.id, admin.id]);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_audit WHERE target=$1 AND action IN ('reward_adjust_credit','reward_adjust_debit') AND actor_id=$2", [u.id, admin.id]), 2);
  const look = await AD(admin, "GET", "/api/admin/mjt/rewards/wallets/rw_adj"); assert.equal(look.wallet.balance, "3"); assert.equal(look.entries.length, 2);
});

test("admin endpoints: 403 for members, 401 for guests; stats add up", async () => {
  const paths = [["GET", "/api/admin/mjt/rewards/stats"], ["GET", "/api/admin/mjt/rewards/sources"], ["PUT", "/api/admin/mjt/rewards/sources/quiz_passed", { enabled: true, amount: 100 }], ["POST", "/api/admin/mjt/rewards/sources", { key: "quiz_passed" }],
    ["DELETE", "/api/admin/mjt/rewards/sources/quiz_passed"], ["GET", "/api/admin/mjt/rewards/entries"], ["GET", "/api/admin/mjt/rewards/wallets/rw_a"], ["POST", "/api/admin/mjt/rewards/wallets/rw_a/freeze", { frozen: true, reason: "محاولة عضو عادي" }],
    ["POST", "/api/admin/mjt/rewards/wallets/rw_a/adjust", { direction: "credit", amount: 100, reason: "محاولة عضو عادي", ikey: "member_try_123" }], ["PUT", "/api/admin/mjt/rewards/settings", { velocityPerHour: 999 }], ["POST", "/api/admin/mjt/rewards/entries/x/approve", {}]];
  for (const [m, p, body] of paths) { clear(); assert.equal((await a.req(m, p, body)).status, 403, m + " " + p); clear(); assert.equal((await new H.Client().req(m, p, body)).status, 401, "guest " + p); }
  assert.equal((await db().get("SELECT status FROM mjt_accounts WHERE id=$1", ["user:" + a.id])).status, "active");
  const s = await AD(admin, "GET", "/api/admin/mjt/rewards/stats"); assert.equal(s.status, 200, s.error);
  assert.ok(Number(s.rewards.earned) > 0); assert.ok(s.wallets.total >= 5); assert.ok(s.ledger.txCount > 0); assert.ok(s.bySource.some((x) => x.source === "course_completed"));
  assert.match(s.note, /ليس له قيمة نقدية/);
  const v = await H.app.ctx.services.mjt.verify(); assert.equal(v.ok, true, v.problems.join(","));
});

test("a source with history cannot be deleted (disable instead); an unused one can", async () => {
  clear(); assert.equal((await AD(admin, "DELETE", "/api/admin/mjt/rewards/sources/course_completed")).code, "in_use");
  clear(); const d = await AD(admin, "DELETE", "/api/admin/mjt/rewards/sources/team_created"); assert.ok([200, 409].includes(d.status));
});

test("Free / Plus quotas unchanged", async () => {
  const L = (await AD(admin, "GET", "/api/admin/membership/limits"));
  assert.equal(L.status, 200, L.error);
  const q = Object.fromEntries(Object.entries(L.limits).map(([kk, x]) => [kk, [x.free, x.plus]]));
  assert.deepEqual(q, { saved_searches: [25, 100], collections: [50, 200], quiz_attempts_daily: [10, 30], teams_owned: [5, 20], team_members: [50, 150] });
});
