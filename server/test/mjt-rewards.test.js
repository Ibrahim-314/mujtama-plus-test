/* v2.160 — phase 4: MJT internal rewards economy (services/mjt-rewards.js, migration 090).
 * wallet created lazily · credit / debit / insufficient / never negative · idempotency · parallel credits + debits ·
 * v2.167: sources fixed ON from app-defaults · caps · approval flow · freeze / unfreeze · velocity review · admin API 404 ·
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
/* v2.167: there is no admin source editor any more (sources are fixed in app-defaults). This file tests the ENGINE (caps, per-ref,
 * approval, velocity, freeze), so it sets a source row directly as a test fixture. */
const COLS = { amount: "amount", enabled: "enabled", dailyCap: "daily_cap", maxPerRef: "max_per_ref", requiresApproval: "requires_approval" };
const setSource = async (keyName, body) => {
  for (const [k, v] of Object.entries(body)) await db().run(`UPDATE mjt_reward_sources SET ${COLS[k]}=$1 WHERE key=$2`, [k === "amount" ? v * UNIT : typeof v === "boolean" ? (v ? 1 : 0) : v, keyName]);
};

test.before(async () => {
  // the identity checks / overall caps / per-lesson course amount have their own tests (mjt-safety-v2165, wave1-auto-v2167)
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, mjtSafetyOpts: { testSettings: { identity: { enabled: false }, caps: { enabled: false }, course: { perLesson: false } } } });
  admin = await mk("rw_admin"); a = await mk("rw_a"); b = await mk("rw_b"); c = await mk("rw_c");
  await RW().ready;
  // the automatic bonuses (daily_activity / active_week) are covered in wave1-auto-v2167; switched off here so deltas stay exact
  await setSource("daily_activity", { enabled: false }); await setSource("active_week", { enabled: false });
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
  // the table came back empty: seed it again exactly as boot does
  await RW().ensureSources();
});

test("v2.167: the approved earn sources are ON with their fixed amounts; a source with no approved amount pays nothing; login / likes / saves are not sources", async () => {
  const DEF = require("../config/app-defaults");
  const s = await RW().listSources(); assert.ok(s.sources.length >= 4);
  for (const x of s.sources) {
    const d = DEF.mjt.sources[x.key];
    if (d) { assert.equal(x.enabled, true, x.key); assert.equal(x.amount, String(d.amount), x.key); assert.equal(x.requiresApproval, false, x.key); }
    else { assert.equal(x.enabled, false, x.key); assert.equal(x.amount, null, x.key); } // e.g. team_created: no approved amount
  }
  for (const bad of ["login", "checkin", "like", "react", "saved_search_created", "collection_created"]) assert.ok(!s.rewardable.includes(bad), bad);
  for (const [m, p] of [["GET", "/api/admin/mjt/rewards/sources"], ["PUT", "/api/admin/mjt/rewards/sources/quiz_passed"], ["POST", "/api/admin/mjt/rewards/sources"]]) { clear(); assert.equal((await admin.req(m, p, m === "GET" ? undefined : { enabled: false })).status, 404, p); }
  await setSource("daily_activity", { enabled: false }); await setSource("active_week", { enabled: false }); // bonuses: see before()
  const tx0 = await n("SELECT COUNT(*) n FROM mjt_tx");
  await achieve(a.id, "team_created", "team-no-amount");
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_tx"), tx0); assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE user_id=$1", [a.id]), 0);
  assert.equal((await RW().onAchievement({ user: a.id, type: "team_created", ref: "x" })).reason, "disabled");
  // quiz_passed is ON at its fixed amount and pays automatically
  const before = await bal(a.id); await achieve(a.id, "quiz_passed", "lesson-on");
  assert.equal(await bal(a.id) - before, DEF.mjt.sources.quiz_passed.amount * UNIT);
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
  await setSource("article_published", { amount: 4, enabled: true, requiresApproval: true, dailyCap: null });
  const before = await bal(c.id);
  await achieve(c.id, "article_published", "post-1"); await achieve(c.id, "article_published", "post-2");
  assert.equal(await bal(c.id), before, "pending pays nothing yet");
  const rv = await c.req("GET", "/api/mjt/wallet/review"); assert.equal(rv.items.length, 2); assert.equal(rv.items[0].status, "pending");
  const open = await db().all("SELECT p.id FROM mjt_reward_entries p WHERE p.user_id=$1 AND p.status='pending' AND p.decides IS NULL ORDER BY p.created_at", [c.id]); assert.equal(open.length, 2);
  const [p1, p2] = open;
  clear(); const ap = await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p1.id}/approve`, {}); assert.equal(ap.status, 200, ap.error); assert.equal(ap.entry.status, "posted");
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p1.id}/approve`, {})).status, 409, "decided once");
  assert.equal(await bal(c.id) - before, 4 * UNIT);
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p2.id}/reject`, {})).status, 400, "reason required");
  clear(); const rj = await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p2.id}/reject`, { reason: "مقال مكرر من مصدر آخر" }); assert.equal(rj.status, 200, rj.error);
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/rewards/entries/${p2.id}/approve`, {})).status, 409);
  assert.equal(await bal(c.id) - before, 4 * UNIT, "rejected never pays");
  const orig = await db().get("SELECT status FROM mjt_reward_entries WHERE id=$1", [p2.id]); assert.equal(orig.status, "pending", "original row untouched; the decision is a new row");
  assert.equal((await db().get("SELECT status FROM mjt_reward_entries WHERE decides=$1", [p2.id])).status, "rejected");
  const rv2 = await c.req("GET", "/api/mjt/wallet/review"); assert.deepEqual(rv2.items.map((x) => x.status), ["rejected"]);
  await setSource("article_published", { enabled: false });
});

test("freeze: earning waits as pending, spending is refused, pending stays pending until unfrozen; reason required", async () => {
  const u = await mk("rw_frz");
  await RW().credit(u.id, { amount: 3 * UNIT, ikey: key("f") });
  clear(); assert.equal((await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_frz/freeze", { frozen: true })).status, 400, "reason required");
  clear(); const fr = await AD(admin, "POST", "/api/admin/mjt/rewards/wallets/rw_frz/freeze", { frozen: true, reason: "مراجعة أمنية للحساب" }); assert.equal(fr.status, 200, fr.error); assert.equal(fr.frozen, true);
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

test("velocity: more rewards in an hour than the fixed limit wait for review instead of posting", async () => {
  const V = (await RW().engineSettings()).velocityPerHour; assert.equal(V, require("../config/app-defaults").mjt.engine.velocityPerHour);
  await setSource("quiz_passed", { amount: 1, enabled: true, maxPerRef: 1, dailyCap: null });
  const u = await mk("rw_vel");
  for (let i = 0; i < V + 2; i++) await achieve(u.id, "quiz_passed", "q" + i);
  assert.equal(await bal(u.id), V * UNIT);
  const pend = await db().all("SELECT reason FROM mjt_reward_entries WHERE user_id=$1 AND status='pending'", [u.id]);
  assert.equal(pend.length, 2); for (const x of pend) assert.match(x.reason, /velocity_review/);
});

test("v2.167: the admin rewards API is gone (404 for members, admins and guests); nothing written; the ledger verifies", async () => {
  const paths = [["GET", "/api/admin/mjt/rewards/stats"], ["GET", "/api/admin/mjt/rewards/sources"], ["PUT", "/api/admin/mjt/rewards/sources/quiz_passed", { enabled: true, amount: 100 }], ["POST", "/api/admin/mjt/rewards/sources", { key: "quiz_passed" }],
    ["DELETE", "/api/admin/mjt/rewards/sources/quiz_passed"], ["GET", "/api/admin/mjt/rewards/entries"], ["GET", "/api/admin/mjt/rewards/wallets/rw_a"], ["POST", "/api/admin/mjt/rewards/wallets/rw_a/freeze", { frozen: true, reason: "محاولة عضو عادي" }],
    ["POST", "/api/admin/mjt/rewards/wallets/rw_a/adjust", { direction: "credit", amount: 100, reason: "محاولة عضو عادي", ikey: "member_try_123" }], ["PUT", "/api/admin/mjt/rewards/settings", { velocityPerHour: 999 }], ["POST", "/api/admin/mjt/rewards/entries/x/approve", {}]];
  const w0 = await bal(a.id);
  for (const [m, p, body] of paths) for (const cl of [a, admin, new H.Client()]) { clear(); assert.equal((await cl.req(m, p, m === "GET" ? undefined : body)).status, 404, m + " " + p); }
  assert.equal((await db().get("SELECT status FROM mjt_accounts WHERE id=$1", ["user:" + a.id])).status, "active"); assert.equal(await bal(a.id), w0);
  assert.ok(await db().get("SELECT 1 x FROM mjt_reward_sources WHERE key='course_completed'"), "source rows are never deleted");
  const v = await H.app.ctx.services.mjt.verify(); assert.equal(v.ok, true, v.problems.join(","));
});

test("Free / Plus quotas unchanged", async () => {
  const L = (await AD(admin, "GET", "/api/admin/membership/limits"));
  assert.equal(L.status, 200, L.error);
  const q = Object.fromEntries(Object.entries(L.limits).map(([kk, x]) => [kk, [x.free, x.plus]]));
  assert.deepEqual(q, { saved_searches: [25, 100], collections: [50, 200], quiz_attempts_daily: [10, 30], teams_owned: [5, 20], team_members: [50, 150] });
});
