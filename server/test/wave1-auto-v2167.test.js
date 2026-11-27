/* v2.167 wave 1 — «التطبيق يشتغل تلقائياً» (server/config/app-defaults.js + services/auto-rules.js + services/owner.js).
 * Fixed defaults (Plus 10 Pi / 30 days, no auto-renew, caps 50 / 250 / 800 with level caps 30 / 40 / 50, every flag ON incl.
 * community_lean_bootstrap) · held MJT released automatically after 72 h unless the member is suspended (earns + transfers) ·
 * content queues: a level 3+ author is published at once, anyone else after 24 h when nobody reported it · reports: hidden after
 * 3 distinct level 3+ reporters (lower levels do not count), restored after 7 days with the reports dismissed · «لوحة المالك»:
 * owner (admin role) only, read-only status, ban / unban with a reason, no data deleted · removed admin API answers 404. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const DEF = require("../config/app-defaults");
const { UNIT } = require("../lib/mjt-ledger");

const HOUR = 3600e3, DAY = 24 * HOUR;
let H, owner, a, b;
const db = () => H.app.ctx.db, S = () => H.app.ctx.services, AR = () => S().autoRules;
const clear = () => H.app.ctx.rl.w.clear();
const bal = async (u) => Number((await db().get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + u.id]))?.balance || 0);
let seq = 0; const key = (p = "k") => `${p}${Date.now().toString(36)}_${++seq}_w1`;
async function mk(handle, { ageDays = 40, pi = true, rep = 0 } = {}) {
  clear(); const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle;
  await db().run("UPDATE users SET created_at=$1, pi_uid=$2 WHERE id=$3", [new Date(Date.now() - ageDays * DAY).toISOString(), pi ? "pi_" + handle : null, cl.id]);
  if (rep) await setRep(cl, rep);
  return cl;
}
async function setRep(u, rep) {
  await db().run("INSERT INTO user_reputation(user_id,score,breakdown,computed_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET score=$2", [u.id, rep, JSON.stringify({ penalties: 0 }), new Date().toISOString()]);
  await db().run("UPDATE users SET reputation=$1 WHERE id=$2", [rep, u.id]);
  S().repLevels.invalidate?.();
}
const later = (ms) => new Date(Date.now() + ms);
const post = async (cl, text) => { clear(); const r = await cl.req("POST", "/api/posts", { text }); assert.ok([200, 201].includes(r.status), r.error); return r.post; };
const postStatus = async (id) => (await db().get("SELECT status FROM posts WHERE id=$1", [id])).status;

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false }, autoRulesOpts: { jobs: false } });
  await S().mjt.ready; await S().mjtRewards.ready;
  owner = await mk("w1_owner"); a = await mk("w1_a"); b = await mk("w1_b");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [owner.id]);
});
test.after(() => H.app.close());
test.beforeEach(clear);

test("defaults: Plus 10 Pi / 30 days, no auto-renew; caps 50/250/800 (level 30/40/50); every flag ON; testnet only", async () => {
  assert.equal(DEF.plusPricePi({}), 10);
  assert.equal(DEF.plusPricePi({ PLUS_PRICE_PI: "12" }), 12); assert.equal(DEF.plusPricePi({ AI_PLAN_PRICE: "7" }), 7, "older alias");
  assert.equal(DEF.plus.periodDays, 30); assert.equal(DEF.plus.autoRenew, false); assert.equal(DEF.network, "testnet");
  const C = DEF.mjt.safety.caps; assert.equal(C.enabled, true); assert.deepEqual([C.daily, C.weekly, C.monthly, C.level12, C.level34, C.level5], [50, 250, 800, 30, 40, 50]);
  assert.equal(DEF.mjt.safety.identity.enabled, true); assert.equal(DEF.mjt.reputation.enabled, true);
  for (const [k, v] of Object.entries(DEF.mjt.legacy)) assert.equal(v, true, k);
  assert.deepEqual(DEF.flags, { passkeys: true, rum: true, community_lean_bootstrap: true });
  assert.deepEqual([DEF.auto.holdReleaseHours, DEF.auto.trustedLevel, DEF.auto.publishAfterHours, DEF.auto.reportHide.reports, DEF.auto.reportHide.minLevel, DEF.auto.reportHide.restoreDays], [72, 3, 24, 3, 3, 7]);
  // the live Plus plan carries the fixed price
  await S().ai.ensurePlans();
  const plan = await db().get("SELECT price FROM ai_plans WHERE slug='ai_plus'"); assert.equal(Number(plan.price) / 1e7, 10);
  // the approved earn sources are ON
  for (const x of (await S().mjtRewards.listSources()).sources.filter((s) => DEF.mjt.sources[s.key])) assert.equal(x.enabled, true, x.key);
});

test("auto-release: a held earn is posted after 72 h (not before); a suspended member's hold is kept", async () => {
  const young = await mk("w1_young", { ageDays: 1 }), susp = await mk("w1_susp", { ageDays: 1 });
  for (const u of [young, susp]) { await S().achievements.record(u.id, "quiz_passed", "w1_les_" + u.handle); await S().mjtRewards.settle(); }
  const e = await db().get("SELECT * FROM mjt_reward_entries WHERE user_id=$1 AND source='quiz_passed'", [young.id]);
  assert.equal(e.status, "pending", "identity check holds a 1-day-old account"); assert.match(e.reason, /account_too_new/);
  assert.equal(await bal(young), 0);
  await db().run("UPDATE users SET status='suspended' WHERE id=$1", [susp.id]);
  let r = await AR().sweep({ now: later(71 * HOUR) }); assert.equal(r.holds.earns, 0, "not before 72 h");
  assert.equal(await bal(young), 0);
  r = await AR().sweep({ now: later(73 * HOUR) });
  assert.ok(r.holds.earns >= 1); assert.ok(r.holds.kept >= 1, "suspended member kept");
  assert.equal(await bal(young), DEF.mjt.sources.quiz_passed.amount * UNIT, "posted once");
  assert.equal(await bal(susp), 0);
  await AR().sweep({ now: later(80 * HOUR) }); assert.equal(await bal(young), DEF.mjt.sources.quiz_passed.amount * UNIT, "never twice");
  assert.equal((await S().mjt.verify()).ok, true);
});

test("auto-release: a held member transfer is sent after 72 h", async () => {
  const young = await mk("w1_ysend", { ageDays: 1 });
  clear(); const f = await S().mjt.adjust(owner, { ikey: key("f"), handle: young.handle, amount: "20", reason: "رصيد اختبار الإفراج" }); assert.ok(f);
  clear(); const r = await young.req("POST", "/api/mjt/transfers", { to: b.handle, amount: "5", ikey: key("x") });
  assert.equal(r.status, 200, r.error); assert.ok(r.pending || r.hold, "held, nothing moved: " + JSON.stringify(r).slice(0, 200));
  const before = await bal(b);
  await AR().sweep({ now: later(10 * HOUR) }); assert.equal(await bal(b), before);
  const s = await AR().sweep({ now: later(73 * HOUR) }); assert.ok(s.holds.transfers >= 1);
  assert.equal(await bal(b) - before, 5 * UNIT);
  assert.equal((await db().get("SELECT status FROM mjt_transfer_holds WHERE from_id=$1", [young.id])).status, "approved");
});

async function heldPost(author, text) {
  const p = await post(author, text), at = new Date().toISOString();
  await db().run("UPDATE posts SET status='held' WHERE id=$1", [p.id]);
  await db().run("INSERT INTO automod_items(id,target_kind,target_id,author,state,prev_status,score,categories,reasons,signals,source,release_at,created_at,updated_at) VALUES($1,'post',$2,$3,'held','published',0.5,$4,$5,$6,'rules',NULL,$7,$7)", ["am_w1" + (++seq), p.id, author.id, JSON.stringify([]), JSON.stringify(["spam"]), JSON.stringify({}), at]);
  return p;
}

test("auto-publish: a held post by a level 3+ author is published at once; others after 24 h when nobody reported it", async () => {
  const trusted = await mk("w1_trusted", { rep: 200 }), newbie = await mk("w1_newbie");
  assert.ok((await S().repLevels.unified(trusted.id)).level >= 3);
  const p1 = await heldPost(trusted, "منشور من عضو موثوق ينتظر المراجعة"), p2 = await heldPost(newbie, "منشور من عضو جديد ينتظر المراجعة");
  await AR().sweep();
  assert.equal(await postStatus(p1.id), "published", "level 3+ → at once");
  assert.equal(await postStatus(p2.id), "held", "level 1 → waits");
  await AR().sweep({ now: later(25 * HOUR) });
  assert.equal(await postStatus(p2.id), "published", "after 24 h");
  // a reported held post is not auto-published
  const p3 = await heldPost(newbie, "منشور ثالث عليه بلاغ");
  await db().run("INSERT INTO reports(id,target,kind,reason,by_user,status,created_at) VALUES($1,$2,'post','spam',$3,'open',$4)", ["r_w1" + (++seq), p3.id, a.id, new Date().toISOString()]);
  await AR().sweep({ now: later(25 * HOUR) });
  assert.equal(await postStatus(p3.id), "held");
});

test("auto-hide after 3 trusted (level 3+) reporters; low-level reports alone do not hide; restored after 7 days, reports dismissed", async () => {
  const author = await mk("w1_author");
  const target = await post(author, "منشور سيُبلَّغ عنه من أعضاء موثوقين"), other = await post(author, "منشور يبلّغ عنه أعضاء جدد فقط");
  const trusted = [await mk("w1_rep1", { rep: 200 }), await mk("w1_rep2", { rep: 200 }), await mk("w1_rep3", { rep: 200 })];
  const low = [await mk("w1_low1"), await mk("w1_low2"), await mk("w1_low3")];
  for (const u of trusted) { clear(); const r = await u.req("POST", "/api/reports", { target: target.id, kind: "post", reason: "محتوى مخالف" }); assert.equal(r.status, 200, r.error); }
  for (const u of low) { clear(); const r = await u.req("POST", "/api/reports", { target: other.id, kind: "post", reason: "محتوى مخالف" }); assert.equal(r.status, 200, r.error); }
  const s = await AR().sweep(); assert.ok(s.reports.hidden >= 1);
  assert.equal(await postStatus(target.id), "held", "hidden after 3 trusted reporters");
  assert.equal(await postStatus(other.id), "published", "level 1 reporters do not count");
  await AR().sweep({ now: later(6 * DAY) }); assert.equal(await postStatus(target.id), "held", "still hidden before 7 days");
  const r7 = await AR().sweep({ now: later(7 * DAY + HOUR) }); assert.ok(r7.reports.restored >= 1);
  assert.equal(await postStatus(target.id), "published", "restored after 7 days");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM reports WHERE target=$1 AND status='open'", [target.id])).n), 0, "reports dismissed");
  assert.ok(await db().get("SELECT 1 x FROM posts WHERE id=$1", [target.id]), "nothing deleted");
});

test("owner endpoints: owner only (403 member, 401 guest); status; ban needs a reason, ends sessions, keeps data; unban", async () => {
  for (const [m, p, body] of [["GET", "/api/owner/status"], ["POST", "/api/owner/ban", { handle: b.handle, reason: "محاولة عضو عادي" }], ["POST", "/api/owner/unban", { handle: b.handle }]]) {
    clear(); assert.equal((await a.req(m, p, body)).status, 403, `${m} ${p}`);
    clear(); assert.equal((await new H.Client().req(m, p, body)).status, 401, `${m} ${p} guest`);
  }
  assert.equal((await db().get("SELECT status FROM users WHERE id=$1", [b.id])).status, "active", "member attempts changed nothing");
  clear(); const st = await owner.req("GET", "/api/owner/status"); assert.equal(st.status, 200, st.error);
  assert.equal(st.version, "2.167.0"); assert.equal(st.network, "testnet"); assert.equal(st.plus.periodDays, 30); assert.equal(st.plus.autoRenew, false);
  assert.ok(st.autoRules.rules.holdReleaseHours === 72); assert.ok(st.counts.users >= 3);
  const victim = await mk("w1_victim"); const vp = await post(victim, "منشور يبقى بعد الإيقاف");
  clear(); assert.equal((await owner.req("POST", "/api/owner/ban", { handle: victim.handle })).status, 400, "reason required");
  clear(); assert.equal((await owner.req("POST", "/api/owner/ban", { handle: owner.handle, reason: "إيقاف حساب المالك" })).status, 400, "an admin account cannot be banned");
  clear(); const bn = await owner.req("POST", "/api/owner/ban", { handle: victim.handle, reason: "مخالفة جسيمة متكررة" }); assert.equal(bn.status, 200, bn.error); assert.equal(bn.member.status, "suspended");
  assert.equal((await db().get("SELECT status FROM users WHERE id=$1", [victim.id])).status, "suspended");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM sessions WHERE user_id=$1", [victim.id])).n), 0, "signed out");
  assert.ok(await db().get("SELECT 1 x FROM posts WHERE id=$1", [vp.id]), "member data kept");
  clear(); const ub = await owner.req("POST", "/api/owner/unban", { handle: victim.handle }); assert.equal(ub.status, 200, ub.error); assert.equal(ub.member.status, "active");
  assert.equal((await db().get("SELECT status FROM users WHERE id=$1", [victim.id])).status, "active");
  clear(); assert.equal((await owner.req("POST", "/api/owner/ban", { handle: "nobody_w1", reason: "حساب غير موجود" })).status, 404);
});

test("removed admin approval / settings API answers 404 even for the owner", async () => {
  for (const [m, p] of [["GET", "/api/admin/mjt"], ["GET", "/api/admin/mjt/safety"], ["GET", "/api/admin/mjt/review"], ["GET", "/api/admin/mjt/rewards/sources"], ["GET", "/api/admin/mjt/services"], ["GET", "/api/admin/reputation"], ["GET", "/api/admin/mjt/legacy"]]) {
    clear(); assert.equal((await owner.req(m, p)).status, 404, p);
  }
});
