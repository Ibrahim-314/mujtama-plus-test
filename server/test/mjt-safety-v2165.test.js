/* v2.165 — MJT phase 8.1 «محرك آمن» (services/mjt-safety.js, mjt-rewards.js offers, mjt.js transfer holds, migration 093).
 * Every switch OFF by default = the v2.164 behaviour exactly (new account earns + transfers at once, no overall cap, new sources
 * pay nothing and write nothing). Each switch ON = its rule enforced: identity (account age, Pi-authenticated, linked accounts by
 * shared public IP, own content, fan-in on transfers) → earns wait as pending and transfers are held (never lost, nothing moves);
 * overall caps 50/250/800 with the level-based daily cap 30/40/50; new sources (accepted answer, helping a new member, daily
 * activity, active week, course per lesson, exam, study session) with their own switch and the «no back-pay» gate; the admin
 * review queue lists, approves and rejects both kinds; admin only. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const AD = (...a) => require("./admin-shim").shim(H)(...a); // v2.167: removed admin routes → service fixtures (see admin-shim.js)
const DEF = require("../config/app-defaults");
const { UNIT } = require("../lib/mjt-ledger");

const DAY = 864e5;
let H, admin, a, b, c, d;
const db = () => H.app.ctx.db, S = () => H.app.ctx.services, RW = () => S().mjtRewards, SF = () => S().mjtSafety, ACH = () => S().achievements;
const clear = () => H.app.ctx.rl.w.clear();
const n = async (sql, p = []) => Number((await db().get(sql, p)).n);
const bal = async (u) => Number((await db().get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + u.id]))?.balance || 0);
let seq = 0; const key = (p = "k") => `${p}${Date.now().toString(36)}_${++seq}_sf`;
async function mk(handle, { ageDays = 40, pi = true } = {}) {
  clear(); const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle;
  await db().run("UPDATE users SET created_at=$1, pi_uid=$2 WHERE id=$3", [new Date(Date.now() - ageDays * DAY).toISOString(), pi ? "pi_" + handle : null, cl.id]);
  return cl;
}
const age = (u, days) => db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - days * DAY).toISOString(), u.id]);
const fund = async (u, amount) => { clear(); const r = await AD(admin, "POST", "/api/admin/mjt/adjust", { ikey: key("f"), handle: u.handle, amount: String(amount), reason: "رصيد اختبار الأمان" }); assert.equal(r.status, 200, r.error); };
/* v2.167: production runs these rules always ON with fixed values (app-defaults; see the «fixed ON» test below). This file tests
 * each RULE on its own, so it drives them through the test-only override (mjtSafetyOpts.testSettings, read on every call) and sets
 * source rows directly — the admin switch / source editor no longer exist. */
const T = { identity: { enabled: false }, caps: { enabled: false }, course: { perLesson: false } };
const safety = async (body) => { for (const [k, v] of Object.entries(body)) T[k] = { ...(T[k] || {}), ...v }; };
const COLS = { amount: "amount", enabled: "enabled" };
const setSource = async (k, body) => {
  for (const [f, v] of Object.entries(body)) await db().run(`UPDATE mjt_reward_sources SET ${COLS[f]}=$1 WHERE key=$2`, [f === "amount" ? Number(v) * UNIT : v ? 1 : 0, k]);
  if (body.enabled) { // the «no back-pay» gate: a source switched on pays only events from now (as ensureSources marks it)
    const m = JSON.parse((await db().get("SELECT value FROM mjt_settings WHERE key='reward_since'"))?.value || "{}"); m[k] = new Date().toISOString();
    await db().run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('reward_since',$1,'test',$2) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify(m), new Date().toISOString()]);
  }
};
const achieve = async (uid, type, ref) => { await ACH().record(uid, type, ref); await RW().settle(); };
const entry = (uid, type, ref) => db().get("SELECT * FROM mjt_reward_entries WHERE idempotency_key=$1", [`ach:${uid}:${type}:${ref}`]);
const xfer = async (from, to, amount) => { clear(); return from.req("POST", "/api/mjt/transfers", { to: to.handle, amount: String(amount), ikey: key("x") }); };
const sessionIp = (u, ip) => db().run("INSERT INTO sessions(token_hash,user_id,ip,ua,created_at,expires_at) VALUES($1,$2,$3,'test',$4,$5)", ["th_" + key(), u.id, ip, new Date().toISOString(), new Date(Date.now() + DAY).toISOString()]);
const offAll = async () => { for (const k of Object.keys(T)) delete T[k]; Object.assign(T, { identity: { enabled: false }, caps: { enabled: false }, course: { perLesson: false } }); };

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false }, mjtSafetyOpts: { testSettings: T }, mjtRewardsOpts: { testEngine: { velocityPerHour: 1000 } } });
  await S().mjt.ready; await RW().ready;
  // production boot turns every approved source ON (checked in the «fixed ON» test); the rule tests below start from all off
  await db().run("UPDATE mjt_reward_sources SET enabled=0, amount=NULL");
  admin = await mk("sf_admin"); a = await mk("sf_a"); b = await mk("sf_b"); c = await mk("sf_c"); d = await mk("sf_d");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]); await db().run("UPDATE users SET role='member' WHERE id<>$1", [admin.id]);
  await S().mjt.dropMinAge();
});
test.after(() => H.app.close());
test.beforeEach(clear);

test("migration 093 is additive and reversible", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '093_mjt_safety' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "093_mjt_safety"]);
  await assert.rejects(() => db().get("SELECT 1 FROM mjt_transfer_holds"));
  await db().get("SELECT 1 FROM mjt_reward_entries");
  assert.deepEqual(await mig.up(db()), ["093_mjt_safety", ...later]);
});

test("v2.167 fixed ON: identity checks + overall caps + per-lesson course amount always on with the plan values; the approved sources are ON; the old 'safety' row is not read", async () => {
  const P = SF().DEFAULTS;
  assert.equal(P.identity.enabled, true); assert.equal(P.caps.enabled, true); assert.equal(P.course.perLesson, true);
  assert.equal(P.identity.minAccountDays, 7); assert.equal(P.identity.requirePi, true); assert.deepEqual([P.caps.daily, P.caps.weekly, P.caps.monthly], [50, 250, 800]);
  assert.deepEqual([P.caps.level12, P.caps.level34, P.caps.level5], [30, 40, 50]);
  assert.deepEqual(P, JSON.parse(JSON.stringify(DEF.mjt.safety)));
  await db().run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('safety',$1,'old_admin',$2) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify({ identity: { enabled: false }, caps: { enabled: false } }), new Date().toISOString()]);
  const st = await SF().state(); assert.equal(st.defaults.identity.enabled, true, "an old stored 'safety' row is ignored");
  assert.equal(st.sources.length, 13); assert.ok(st.sources.every((x) => x.wired), "all wired");
  // a fresh sync turns every approved source ON with its plan amount and caps (no admin step)
  await RW().ensureSources();
  const src = (await RW().listSources()).sources;
  for (const [k, d] of Object.entries(DEF.mjt.sources)) { const x = src.find((s) => s.key === k); assert.ok(x, k); assert.equal(x.enabled, true, k); assert.equal(x.amount, String(d.amount), k); }
  assert.equal(src.find((s) => s.key === "answer_accepted").dailyCap, 5); assert.equal(src.find((s) => s.key === "friend_active").monthlyCap, 10); assert.equal(src.find((s) => s.key === "exam_certified").weeklyCap, 2);
  await db().run("UPDATE mjt_reward_sources SET enabled=0, amount=NULL"); // back to the rule-test baseline
});

test("v2.167: the admin safety / review API is gone — 404 for members, admins and guests; nothing written", async () => {
  const row0 = await db().get("SELECT value FROM mjt_settings WHERE key='safety'");
  for (const [m, p, body] of [["GET", "/api/admin/mjt/safety"], ["PUT", "/api/admin/mjt/safety", { identity: { enabled: true }, reason: "محاولة تغيير" }], ["GET", "/api/admin/mjt/review"], ["POST", "/api/admin/mjt/review/transfer/x/approve", {}]]) {
    for (const cl of [a, admin, new H.Client()]) { clear(); assert.equal((await cl.req(m, p, body)).status, 404, `${m} ${p}`); }
  }
  assert.deepEqual(await db().get("SELECT value FROM mjt_settings WHERE key='safety'"), row0, "nothing written");
});

test("switches OFF = old behaviour: a 1-day-old, non-Pi account earns and transfers at once; no overall cap; new sources pay and write nothing", async () => {
  const fresh = await mk("sf_fresh", { ageDays: 1, pi: false });
  await setSource("quiz_passed", { amount: "40", enabled: true });
  await achieve(fresh.id, "quiz_passed", "les_off1"); await achieve(fresh.id, "quiz_passed", "les_off2");
  assert.equal((await entry(fresh.id, "quiz_passed", "les_off1")).status, "posted"); assert.equal((await entry(fresh.id, "quiz_passed", "les_off2")).status, "posted");
  assert.equal(await bal(fresh), 80 * UNIT, "80 MJT in a day: no overall cap while caps are off");
  const r = await xfer(fresh, b, 30); assert.equal(r.status, 200, r.error); assert.ok(r.transfer && !r.pending, "sent at once, no hold");
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_transfer_holds"), 0);
  // a new source that is off: the event writes nothing
  const before = await n("SELECT COUNT(*) n FROM mjt_reward_entries");
  assert.equal((await RW().offer("answer_accepted", a.id, "c_off", { counterpart: b.id })).reason, "disabled");
  assert.equal((await RW().offer("daily_activity", a.id, "2026-01-01")).reason, "disabled");
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries"), before);
  await setSource("quiz_passed", { enabled: false });
});

test("identity ON: a new / non-Pi earner waits as pending (not lost); the queue approves (posts once) or rejects (nothing moves)", async () => {
  await safety({ identity: { enabled: true } });
  await setSource("quiz_passed", { amount: "4", enabled: true });
  const young = await mk("sf_young", { ageDays: 2, pi: true }), nopi = await mk("sf_nopi", { ageDays: 40, pi: false });
  await achieve(young.id, "quiz_passed", "les_y1"); await achieve(nopi.id, "quiz_passed", "les_p1"); await achieve(a.id, "quiz_passed", "les_ok1");
  const ey = await entry(young.id, "quiz_passed", "les_y1"), ep = await entry(nopi.id, "quiz_passed", "les_p1");
  assert.equal(ey.status, "pending"); assert.match(ey.reason, /account_too_new/);
  assert.equal(ep.status, "pending"); assert.match(ep.reason, /pi_required/);
  assert.equal((await entry(a.id, "quiz_passed", "les_ok1")).status, "posted", "an old, Pi-authenticated member is paid as before");
  assert.equal(await bal(young), 0); assert.equal(await bal(nopi), 0);
  const mr = await young.req("GET", "/api/mjt/wallet/review"); assert.equal(mr.items[0].status, "pending"); assert.match(mr.items[0].reason, /عمر الحساب/);
  const q = await AD(admin, "GET", "/api/admin/mjt/review"); assert.equal(q.status, 200, q.error);
  const qy = q.items.find((x) => x.id === ey.id); assert.ok(qy); assert.equal(qy.kind, "earn"); assert.match(qy.reasonsText, /عمر الحساب/);
  const sy = q.members.find((m) => m.member.handle === "sf_young"); assert.ok(sy && sy.signals.ageDays <= 2 && sy.signals.piLinked === true);
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/review/earn/${ey.id}/approve`, {})).status, 200);
  assert.equal(await bal(young), 4 * UNIT);
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/review/earn/${ey.id}/approve`, {})).status, 409, "decided once");
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/review/earn/${ep.id}/reject`, {})).status, 400, "reason required");
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/review/earn/${ep.id}/reject`, { reason: "حساب غير موثّق" })).status, 200);
  assert.equal(await bal(nopi), 0); assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE id=$1", [ep.id]), 1, "nothing deleted");
  await setSource("quiz_passed", { enabled: false }); await offAll();
});

test("identity ON: linked accounts beyond the device (shared public IP) and own content wait; a carrier IP shared by many is ignored", async () => {
  await safety({ identity: { enabled: true } });
  await sessionIp(c, "203.0.113.7"); await sessionIp(d, "203.0.113.7");
  const cl = await SF().cluster(c.id); assert.equal(cl.get(d.id), "ip");
  assert.deepEqual(await SF().earnReasons(c.id, { counterpart: d.id }), ["linked_counterpart"]);
  assert.deepEqual(await SF().earnReasons(c.id, { counterpart: c.id }), ["own_content"]);
  assert.deepEqual(await SF().earnReasons(c.id, { counterpart: b.id }), [], "an unrelated counterpart is fine");
  // a private / loopback address never links anyone
  await sessionIp(a, "10.0.0.5"); await sessionIp(b, "10.0.0.5"); assert.equal((await SF().cluster(a.id)).has(b.id), false);
  // an address used by more than ipMaxAccounts accounts is a carrier / NAT address
  const many = []; for (let i = 0; i < 6; i++) { const u = await mk("sf_nat" + i); many.push(u); await sessionIp(u, "198.51.100.9"); }
  assert.equal((await SF().cluster(many[0].id)).has(many[1].id), false);
  // three linked accounts form a cluster
  const e = await mk("sf_e"); await sessionIp(e, "203.0.113.7");
  assert.ok((await SF().earnReasons(c.id, {})).includes("linked_cluster"));
  // the reward engine uses it: an answer accepted by a linked asker waits
  await setSource("answer_accepted", { amount: "10", enabled: true });
  const r = await RW().offer("answer_accepted", c.id, "cm_link1", { counterpart: d.id }); assert.equal(r.pending, true);
  assert.match((await entry(c.id, "answer_accepted", "cm_link1")).reason, /linked_counterpart/);
  await setSource("answer_accepted", { enabled: false }); await offAll();
});

test("identity ON: a transfer from a new account is held (nothing moves); approve sends it once, reject never moves anything", async () => {
  await safety({ identity: { enabled: true } });
  const young = await mk("sf_ysend", { ageDays: 1, pi: true }); await fund(young, 100);
  const b0 = await bal(b);
  let r = await xfer(young, b, 20); assert.equal(r.status, 200, r.error); assert.equal(r.pending, true); assert.equal(r.transfer, null); assert.deepEqual(r.hold.reasons, ["account_too_new"]);
  assert.equal(await bal(young), 100 * UNIT); assert.equal(await bal(b), b0, "nothing moved");
  const rv = await young.req("GET", "/api/mjt/wallet/review"); assert.ok(rv.items.some((x) => x.kind === "transfer_hold" && x.status === "pending"));
  const h1 = r.hold.id;
  r = await xfer(young, b, 15); const h2 = r.hold.id;
  const q = await AD(admin, "GET", "/api/admin/mjt/review?kind=transfer"); assert.equal(q.counts.transfer, 2); assert.ok(q.items.every((x) => x.kind === "transfer"));
  clear(); r = await AD(admin, "POST", `/api/admin/mjt/review/transfer/${h1}/approve`, {}); assert.equal(r.status, 200, r.error); assert.equal(r.item.status, "approved");
  assert.equal(await bal(young), 80 * UNIT); assert.equal(await bal(b), b0 + 20 * UNIT);
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/review/transfer/${h1}/approve`, {})).status, 409, "decided once");
  clear(); r = await AD(admin, "POST", `/api/admin/mjt/review/transfer/${h2}/reject`, { reason: "حساب جديد جداً" }); assert.equal(r.status, 200, r.error);
  assert.equal(await bal(young), 80 * UNIT); assert.equal(await bal(b), b0 + 20 * UNIT);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_audit WHERE action IN ('transfer_held','transfer_hold_approved','transfer_hold_rejected')"), 4);
  // approval re-checks the balance: an approval the sender can no longer cover fails and the hold stays pending
  r = await xfer(young, b, 70); const h3 = r.hold.id; await fund(young, 1); clear();
  await AD(admin, "POST", "/api/admin/mjt/adjust", { ikey: key("dn"), handle: young.handle, amount: "-60", reason: "خصم اختبار الأمان" });
  clear(); assert.equal((await AD(admin, "POST", `/api/admin/mjt/review/transfer/${h3}/approve`, {})).code, "insufficient_balance");
  assert.equal((await db().get("SELECT status FROM mjt_transfer_holds WHERE id=$1", [h3])).status, "pending");
  await offAll();
  r = await xfer(young, b, 5); assert.ok(r.transfer && !r.pending, "switch off again → sent at once");
});

test("identity ON: fan-in — several weak accounts paying one account are held", async () => {
  await safety({ identity: { enabled: true, minAccountDays: 7, requirePi: false } });
  const hub = await mk("sf_hub"); const farm = [];
  for (let i = 0; i < 3; i++) { const u = await mk("sf_farm" + i, { ageDays: 40, pi: true }); await fund(u, 10); farm.push(u); }
  await offAll(); // the first two farm accounts send while the switch is off
  for (const u of farm.slice(0, 2)) { await age(u, 3); assert.ok((await xfer(u, hub, 5)).transfer); }
  await safety({ identity: { enabled: true, minAccountDays: 7, requirePi: false } });
  await age(farm[2], 3); const r = await xfer(farm[2], hub, 5);
  assert.equal(r.pending, true); assert.ok(r.hold.reasons.includes("fan_in") && r.hold.reasons.includes("account_too_new"));
  await offAll();
});

test("caps ON: 50/day with the level cap (level 1 → 30); the earn is reduced to the room left, then skipped; caps OFF again → uncapped", async () => {
  await safety({ caps: { enabled: true } });
  await setSource("quiz_passed", { amount: "25", enabled: true });
  const m = await mk("sf_capper");
  await achieve(m.id, "quiz_passed", "cap1"); await achieve(m.id, "quiz_passed", "cap2"); await achieve(m.id, "quiz_passed", "cap3");
  assert.equal(await bal(m), 30 * UNIT, "level 1 daily cap 30: 25 + 5, then nothing");
  assert.equal(Number((await entry(m.id, "quiz_passed", "cap2")).amount), 5 * UNIT); assert.equal(await entry(m.id, "quiz_passed", "cap3"), undefined, "skipped above the cap");
  const caps = await SF().capsOf(m.id); assert.equal(caps.daily, 30); assert.equal(caps.used.day, "30");
  // level 5 → 50 (v2.167: «السمعة 2» is always on, so the cap level is the unified reputation level: 2000 points × 0.5 = 1000 → level 5)
  const hi = await mk("sf_level5"); await db().run("INSERT INTO points_balances(user_id,total,redeemable,redeemed,level,optout,updated_at) VALUES($1,2000,0,0,4,0,$2)", [hi.id, new Date().toISOString()]);
  for (const r of ["l1", "l2", "l3"]) await achieve(hi.id, "quiz_passed", r);
  assert.equal(await bal(hi), 50 * UNIT);
  // flat daily cap without levels; the weekly cap
  await safety({ caps: { byLevel: false, daily: 40, weekly: 45, monthly: 800 } });
  const w = await mk("sf_weekly"); for (const r of ["w1", "w2", "w3"]) await achieve(w.id, "quiz_passed", r);
  assert.equal(await bal(w), 40 * UNIT, "daily 40 (no level cap)");
  // the week's earlier days count toward the weekly cap: move today's earns to the start of the ISO week
  const d0 = new Date(), ws = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() - ((d0.getUTCDay() + 6) % 7))).toISOString();
  await db().run("UPDATE mjt_reward_entries SET created_at=$1 WHERE user_id=$2", [ws, w.id]);
  await safety({ caps: { daily: 45, weekly: 45 } }); await achieve(w.id, "quiz_passed", "w4");
  assert.equal(await bal(w), 45 * UNIT, "weekly 45 reached"); assert.ok((await SF().capRoom(w.id)).room <= 0);
  await safety({ caps: { enabled: false } });
  const free = await mk("sf_free"); for (const r of ["f1", "f2", "f3"]) await achieve(free.id, "quiz_passed", r);
  assert.equal(await bal(free), 75 * UNIT, "caps off → uncapped");
  await setSource("quiz_passed", { enabled: false }); await offAll();
});

test("new sources: accepted answer + helping a new member (ANSWER_ACCEPTED); no back-pay before the switch; each source its own switch", async () => {
  const asker = await mk("sf_asker", { ageDays: 10 }), helper = await mk("sf_helper");
  const q1 = (await asker.req("POST", "/api/posts", { type: "question", title: "سؤال قبل التفعيل", text: "كيف أبدأ في مجتمع بلس؟" })).post;
  const c1 = (await helper.req("POST", "/api/comments", { post: q1.id, text: "ابدأ من صفحة كيف أكسب" })).comment;
  clear(); assert.equal((await asker.req("POST", `/api/posts/${q1.id}/accept`, { comment: c1.id })).status, 200); await RW().settle();
  assert.equal(await bal(helper), 0, "sources off → nothing");
  await setSource("answer_accepted", { amount: "10", enabled: true }); await setSource("newcomer_help", { amount: "10", enabled: true });
  assert.equal((await RW().offer("answer_accepted", helper.id, c1.id, { at: new Date(Date.now() - DAY).toISOString(), counterpart: asker.id })).reason, "before_enabled", "no back-pay");
  const q2 = (await asker.req("POST", "/api/posts", { type: "question", title: "سؤال بعد التفعيل", text: "أين أجد الشروط؟" })).post;
  const c2 = (await helper.req("POST", "/api/comments", { post: q2.id, text: "في صفحة شروط مجتمع كوين" })).comment;
  clear(); assert.equal((await asker.req("POST", `/api/posts/${q2.id}/accept`, { comment: c2.id })).status, 200); await RW().settle();
  assert.equal((await entry(helper.id, "answer_accepted", c2.id)).status, "posted"); assert.equal((await entry(helper.id, "newcomer_help", "q:" + c2.id)).status, "posted");
  assert.equal(await bal(helper), 20 * UNIT);
  await setSource("newcomer_help", { enabled: false });
  const q3 = (await asker.req("POST", "/api/posts", { type: "question", title: "سؤال ثالث", text: "هل يُسحب الرصيد؟" })).post;
  const c3 = (await helper.req("POST", "/api/comments", { post: q3.id, text: "لا، هو رصيد داخلي فقط" })).comment;
  clear(); await asker.req("POST", `/api/posts/${q3.id}/accept`, { comment: c3.id }); await RW().settle();
  assert.equal(await bal(helper), 30 * UNIT, "answer paid, newcomer help switched off");
  await setSource("answer_accepted", { enabled: false });
});

test("new sources: daily activity bonus only after a real contribution, once a day; active week; course per lesson; exam; study session", async () => {
  await setSource("daily_activity", { amount: "3", enabled: true });
  const m2 = await mk("sf_bonus2");
  await setSource("exam_certified", { amount: "15", enabled: true });
  RW().emit("exam_certified", m2.id, "ex_1", { counterpart: admin.id }); await RW().settle();
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await entry(m2.id, "exam_certified", "ex_1")).status, "posted");
  assert.equal((await entry(m2.id, "daily_activity", day)).status, "posted", "bonus after the contribution");
  RW().emit("exam_certified", m2.id, "ex_2", { counterpart: admin.id }); await RW().settle();
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE user_id=$1 AND source='daily_activity'", [m2.id]), 1, "once a day");
  assert.equal(await bal(m2), 33 * UNIT);
  // active week (days = 1 so one active day completes it)
  await safety({ activeWeek: { days: 1 } }); await setSource("active_week", { amount: "10", enabled: true });
  await setSource("study_session", { amount: "2", enabled: true });
  const m3 = await mk("sf_week"); RW().emit("study_session", m3.id, "ss_1", { counterpart: admin.id }); await RW().settle();
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE user_id=$1 AND source='active_week' AND status='posted'", [m3.id]), 1);
  assert.equal(await bal(m3), (2 + 3 + 10) * UNIT);
  // course per lesson: 2 × lessons clamped to [10, 50]
  await setSource("course_completed", { amount: "7", enabled: true }); await setSource("daily_activity", { enabled: false }); await setSource("active_week", { enabled: false });
  const at = new Date().toISOString();
  await db().run("INSERT INTO courses(id,community_id,author,title,status,created_at,updated_at) VALUES('crs_sf','cm_x',$1,'دورة',$2,$3,$3)", [admin.id, "published", at]);
  for (let i = 0; i < 8; i++) await db().run("INSERT INTO course_lessons(id,course_id,module_id,title,position,status,created_at,updated_at) VALUES($1,'crs_sf','md','درس',$2,'published',$3,$3)", ["les_sf" + i, i, at]);
  const s1 = await mk("sf_student1"), s2 = await mk("sf_student2");
  await achieve(s1.id, "course_completed", "crs_sf"); assert.equal(await bal(s1), 7 * UNIT, "switch off → the fixed amount");
  await safety({ course: { perLesson: true } });
  await achieve(s2.id, "course_completed", "crs_sf"); assert.equal(await bal(s2), 16 * UNIT, "8 lessons × 2");
  for (const k of ["exam_certified", "study_session", "course_completed"]) await setSource(k, { enabled: false });
  await offAll();
});

test("the whole ledger still verifies; no balance changed by any switch change", async () => {
  const snap = JSON.stringify(await db().all("SELECT id, balance FROM mjt_accounts ORDER BY id"));
  await safety({ identity: { enabled: true }, caps: { enabled: true } }); await offAll();
  assert.equal(JSON.stringify(await db().all("SELECT id, balance FROM mjt_accounts ORDER BY id")), snap);
  const v = await S().mjt.verify(); assert.equal(v.ok, true, JSON.stringify(v.problems));
});
