/* Phase 59 — contribution points: accepted answers (+ mentoring for newcomers), engaged posts (distinct trusted unlinked people),
 * confirmed reports, wiki edits (one per page per day); anti-gaming (account age, trust, integrity flags, linked accounts,
 * cooldown, per-kind + daily caps); minors earn non-redeemable points and stay off the leaderboard; levels, leaderboard opt-out,
 * history, campaigns, reversal on removal; redemption from the platform-funded pool in lib/ledger.js (rate, monthly cap, pay with
 * txid, reject → reversal), and OFF while Pi payments are off. PostgreSQL. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { piStub, users, DAY } = require("./pi-stub");
const { ACC, balance, U } = require("../lib/ledger");

const stub = piStub("sk_test_pt_59");
let H, Us, admin, asker, ans, kid, q, ansC; const fans = [];
const db = () => H.app.ctx.db, P = () => H.app.ctx.services.points;
test.before(async () => {
  H = await boot({ piOpts: { env: stub.env, fetch: stub.fetch, jobs: false }, tipsOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, creatorSubsOpts: { jobs: false }, pricingOpts: { jobs: false }, betaOpts: { jobs: false }, pointsOpts: { jobs: false }, mjtOpts: { linkPoints: false, autoConvert: false, jobs: false } }); // v2.47: legacy (unlinked) mode keeps the points → Pi redemption path covered; MJT-linked mode is in mjt.test.js
  Us = users(H, stub);
  admin = await Us.mk("pt_admin"); asker = await Us.mk("pt_asker"); ans = await Us.mk("pt_ans"); kid = await Us.mk("pt_kid");
  for (const h of ["pt_f1", "pt_f2", "pt_f3", "pt_f4"]) fans.push(await Us.mk(h));
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  assert.equal((await kid.req("POST", "/api/age", { birthDate: "2012-04-01" })).status, 200);
  await admin.req("PUT", "/api/admin/points/settings", { cooldownSec: 0 });
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 040: reversible, additive, data map; ledger rewards accounts", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '040_points' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "040_points"]);
  await assert.rejects(() => db().get("SELECT 1 FROM points_awards"));
  assert.deepEqual(await mig.up(db()), ["040_points", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  for (const m of require("../lib/compliance-lib").DATA_MAP.filter((x) => x.t.startsWith("points_"))) await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [ans.id]);
  assert.equal(ACC.rewards("u1"), "user:u1:rewards"); assert.equal(ACC.rewardsPool, "platform:rewards_pool");
});

test("accepted answer → points; newcomer asker → mentoring bonus; idempotent scan; history + level", async () => {
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 10 * DAY).toISOString(), asker.id]); // newcomer (< 30 days)
  q = (await asker.req("POST", "/api/posts", { type: "question", title: "كيف أربط محفظة Pi؟", text: "كيف أربط محفظة Pi بالتطبيق؟" })).post;
  ansC = (await ans.req("POST", "/api/comments", { post: q.id, text: "من الإعدادات ← Pi Network ← ربط الحساب" })).comment;
  const self = (await asker.req("POST", "/api/comments", { post: q.id, text: "شكراً سأجرب ذلك الآن" })).comment;
  assert.equal((await asker.req("POST", `/api/posts/${q.id}/accept`, { comment: ansC.id })).status, 200);
  const r = await P().scan(); assert.equal(r.answer_accepted, 1); assert.equal(r.mentoring, 1);
  assert.equal((await P().scan()).answer_accepted, 0); // idempotent
  const me = await ans.req("GET", "/api/points/me"); assert.equal(me.total, 35); assert.equal(me.redeemable, 35); assert.equal(me.level.level, 1); assert.equal(me.level.next.at, 50);
  const h = await ans.req("GET", "/api/points/history"); assert.deepEqual(h.items.map((x) => x.kind).sort(), ["answer_accepted", "mentoring"]);
  // accepting your own comment earns nothing
  await asker.req("POST", `/api/posts/${q.id}/accept`, { comment: self.id }); await P().scan();
  assert.equal((await asker.req("GET", "/api/points/me")).total, 0);
});

test("engaged post: needs N distinct, aged, unflagged, unlinked people; removal reverses", async () => {
  const post = (await ans.req("POST", "/api/posts", { text: "دليل مختصر لاستخدام السوق الرقمي" })).post;
  await db().run("UPDATE posts SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 2 * 3600e3).toISOString(), post.id]);
  for (const f of fans.slice(0, 2)) await f.req("PUT", "/api/reactions/" + post.id, { type: "useful" });
  await ans.req("PUT", "/api/reactions/" + post.id, { type: "like" }); // self never counts
  await P().scan(); assert.ok(!(await db().get("SELECT 1 x FROM points_awards WHERE kind='engaged_post'")));
  // a third engager who is integrity-flagged does not count …
  await db().run("INSERT INTO integrity_flags(id,kind,sig,members,score,reason,evidence,status,created_at,updated_at) VALUES('if_t','cluster','sig_t',$1,0.9,'t','{}','open',$2,$2)", [JSON.stringify([fans[2].id]), new Date().toISOString()]);
  await fans[2].req("POST", "/api/comments", { post: post.id, text: "مفيد جداً شكراً لك على الشرح" });
  await P().scan(); assert.ok(!(await db().get("SELECT 1 x FROM points_awards WHERE kind='engaged_post'")));
  // … a fourth, genuine one does
  await fans[3].req("PUT", "/api/reactions/" + post.id, { type: "support" });
  const r = await P().scan(); assert.equal(r.engaged_post, 1);
  assert.equal((await ans.req("GET", "/api/points/me")).total, 45);
  H.app.ctx.bus.emit("CONTENT_REMOVED", { post: post.id, user: ans.id, decision: "x" });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await db().get("SELECT status FROM points_awards WHERE source_id=$1", [post.id])).status, "reversed");
  assert.equal((await ans.req("GET", "/api/points/me")).total, 35);
});

test("anti-gaming: new account, low trust, linked accounts, cooldown, per-kind + daily caps", async () => {
  const fresh = await Us.mk("pt_fresh"); await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date().toISOString(), fresh.id]);
  assert.equal((await P().award(fresh.id, "report_confirmed", "r_x1")).reason, "account_too_new");
  assert.equal((await P().award(fans[2].id, "report_confirmed", "r_x2")).reason, "integrity_flagged");
  await admin.req("PUT", "/api/admin/points/settings", { minTrust: 99 });
  assert.equal((await P().award(fans[0].id, "report_confirmed", "r_x3")).reason, "low_trust");
  await admin.req("PUT", "/api/admin/points/settings", { minTrust: 35, cooldownSec: 3600 });
  assert.equal((await P().award(fans[0].id, "report_confirmed", "r_c1")).awarded, true);
  assert.equal((await P().award(fans[0].id, "report_confirmed", "r_c2")).reason, "cooldown");
  await admin.req("PUT", "/api/admin/points/settings", { cooldownSec: 0, kinds: { report_confirmed: { dailyCap: 2 } } });
  assert.equal((await P().award(fans[0].id, "report_confirmed", "r_c3")).awarded, true);
  assert.equal((await P().award(fans[0].id, "report_confirmed", "r_c4")).reason, "kind_daily_cap");
  await admin.req("PUT", "/api/admin/points/settings", { dailyCap: 14 });
  const w = await P().award(fans[0].id, "wiki_edit", "pg:1"); assert.equal(w.points, 4); // 5 + 5 + 4 = 14 → capped
  assert.equal((await P().award(fans[0].id, "wiki_edit", "pg:2")).reason, "daily_cap");
  await admin.req("PUT", "/api/admin/points/settings", { dailyCap: 150, kinds: { report_confirmed: { dailyCap: 5 } } });
  // linked accounts (same device id) never earn from each other
  const t = new Date().toISOString();
  await db().run("INSERT INTO device_signals(user_id,kind,hash,first_seen,last_seen) VALUES($1,'did','dev_same',$3,$3),($2,'did','dev_same',$3,$3)", [fans[1].id, asker.id, t]);
  assert.equal((await P().award(fans[1].id, "answer_accepted", "c_link", { counterpart: asker.id })).reason, "linked_accounts");
  assert.equal((await P().award(fans[1].id, "answer_accepted", "c_ok", { counterpart: ans.id })).awarded, true);
  // a confirmed report through the scan
  await db().run("INSERT INTO reports(id,target,kind,reason,by_user,status,resolved_by,resolved_at,created_at) VALUES('r_scan','p_x','post','spam',$1,'actioned',$2,$3,$3)", [fans[3].id, admin.id, t]);
  assert.equal((await P().scan()).report_confirmed, 1);
});

test("minors earn non-redeemable points and never appear on the leaderboard; opt-out; campaign leaderboard", async () => {
  const k = await P().award(kid.id, "report_confirmed", "r_kid"); assert.equal(k.awarded, true); assert.equal(k.redeemable, false);
  const km = await kid.req("GET", "/api/points/me"); assert.equal(km.total, 5); assert.equal(km.redeemable, 0); assert.equal(km.minor, true); assert.equal(km.rank, null);
  const lb = await new H.Client().req("GET", "/api/points/leaderboard"); assert.equal(lb.status, 200);
  assert.ok(!lb.items.some((x) => x.handle === "pt_kid")); assert.equal(lb.items[0].handle, "pt_ans");
  await ans.req("PUT", "/api/points/leaderboard-optout", { optOut: true });
  assert.ok(!(await new H.Client().req("GET", "/api/points/leaderboard?period=month")).items.some((x) => x.handle === "pt_ans"));
  assert.equal((await ans.req("GET", "/api/points/me")).rank, null);
  await ans.req("PUT", "/api/points/leaderboard-optout", { optOut: false });
  // seasonal campaign ×2 on wiki edits
  assert.equal((await ans.req("POST", "/api/admin/points/campaigns", { name: "x" })).status, 403);
  const c = await admin.req("POST", "/api/admin/points/campaigns", { name: "موسم الويكي", kinds: ["wiki_edit"], multiplier: 2, bonus: 1, startsAt: new Date(Date.now() - 3600e3).toISOString(), endsAt: new Date(Date.now() + 7 * DAY).toISOString() });
  assert.equal(c.status, 200, c.error); assert.equal(c.campaign.live, true);
  const a = await P().award(ans.id, "wiki_edit", "pg:camp"); assert.equal(a.points, 9); assert.equal(a.campaign, c.campaign.id);
  const cl = await new H.Client().req("GET", "/api/points/leaderboard?period=campaign:" + c.campaign.id); assert.equal(cl.items[0].handle, "pt_ans"); assert.equal(cl.items[0].points, 9);
  assert.equal((await new H.Client().req("GET", "/api/points/campaigns")).items.length, 1);
  assert.equal((await admin.req("POST", "/api/admin/points/campaigns", { name: "سيئة", multiplier: 9, endsAt: new Date(Date.now() + DAY).toISOString() })).status, 400);
});

test("wiki edits via the scan: substantial changes only, one per page per day", async () => {
  const t = new Date().toISOString();
  const cm = (await admin.req("POST", "/api/communities", { name: "مجتمع الويكي", description: "تجربة" }));
  const cid = cm.community?.id || cm.id; assert.ok(cid, JSON.stringify(cm).slice(0, 200));
  await db().run("INSERT INTO wiki_pages(id,community,slug,title,body,version,updated_by,updated_at,created_at) VALUES('wp1',$1,'start','البداية',$2,3,$3,$4,$4)", [cid, "x".repeat(120), fans[3].id, t]);
  await db().run("INSERT INTO wiki_revisions(id,page,version,title,body,author,created_at) VALUES('wr1','wp1',1,'t',$1,$2,$3),('wr2','wp1',2,'t',$4,$5,$3),('wr3','wp1',3,'t',$6,$2,$3)", ["x".repeat(60), fans[3].id, t, "x".repeat(62), fans[2].id, "x".repeat(130)]);
  const r = await P().scan(); assert.equal(r.wiki_edit, 1); // wr1 (new page) for fans[3]; wr2 is a 2-char tweak; wr3 same page+day as wr1
  assert.ok(await db().get("SELECT 1 x FROM points_awards WHERE user_id=$1 AND kind='wiki_edit' AND source_id='wp1:'||$2", [fans[3].id, t.slice(0, 10)]));
});

test("redemption: off until configured; pool funding + monthly cap in the ledger; pay with txid; reject restores points", async () => {
  const cfg = await ans.req("GET", "/api/points/config"); assert.equal(cfg.redemption.available, false); assert.equal(cfg.redemption.reason, "disabled");
  assert.equal((await ans.req("POST", "/api/points/redeem", { points: 10 })).code, "redemption_unavailable");
  assert.equal((await admin.req("PUT", "/api/admin/points/settings", { redemption: { enabled: true } })).code, "redemption_incomplete");
  assert.equal((await admin.req("PUT", "/api/admin/points/settings", { redemption: { enabled: true, rate: 100, monthlyCap: 0.3, minPoints: 10 } })).status, 200);
  assert.equal((await ans.req("GET", "/api/points/config")).redemption.reason, "pool_empty");
  assert.equal((await ans.req("POST", "/api/admin/points/pool/fund", { amount: 1 })).status, 403);
  const f = await admin.req("POST", "/api/admin/points/pool/fund", { amount: 1, note: "تمويل تجريبي" }); assert.equal(f.status, 200, f.error); assert.equal(f.pool.poolBalance, 1);
  assert.equal((await kid.req("POST", "/api/points/redeem", { points: 10 })).code, "minor_restricted");
  assert.equal((await ans.req("POST", "/api/points/redeem", { points: 5 })).code, "below_minimum");
  assert.equal((await ans.req("POST", "/api/points/redeem", { points: 5000 })).code, "insufficient_points");
  const me0 = await ans.req("GET", "/api/points/me");
  const r1 = await ans.req("POST", "/api/points/redeem", { points: 20 }); assert.equal(r1.status, 200, r1.error); assert.equal(r1.redemption.amount, 0.2);
  assert.equal((await ans.req("GET", "/api/points/me")).redeemable, me0.redeemable - 20);
  assert.equal(await balance(db(), ACC.rewards(ans.id)), 0.2 * U); assert.equal(await balance(db(), ACC.rewardsPool), 0.8 * U);
  assert.equal((await ans.req("POST", "/api/points/redeem", { points: 20 })).code, "monthly_limit");
  await admin.req("PUT", "/api/admin/points/settings", { redemption: { perUserMonthly: 5 } });
  assert.equal((await ans.req("POST", "/api/points/redeem", { points: 15 })).code, "monthly_pool_cap"); // 0.2 + 0.15 > 0.3
  const ov = await admin.req("GET", "/api/admin/points"); assert.equal(ov.pending.length, 1); assert.equal(ov.pool.usedThisMonth, 0.2);
  assert.equal((await admin.req("POST", `/api/admin/points/redemptions/${r1.redemption.id}/pay`, {})).status, 400); // txid required
  const pay = await admin.req("POST", `/api/admin/points/redemptions/${r1.redemption.id}/pay`, { txid: "tx_reward_1" }); assert.equal(pay.redemption.status, "paid");
  assert.equal(await balance(db(), ACC.rewards(ans.id)), 0); assert.equal(await balance(db(), ACC.payouts) >= 0.2 * U, true);
  const r2 = await ans.req("POST", "/api/points/redeem", { points: 10 }); assert.equal(r2.status, 200, r2.error);
  const rej = await admin.req("POST", `/api/admin/points/redemptions/${r2.redemption.id}/reject`, { note: "تجربة" }); assert.equal(rej.redemption.status, "rejected");
  assert.equal(await balance(db(), ACC.rewardsPool), 0.8 * U);
  assert.equal((await ans.req("GET", "/api/points/me")).redeemable, me0.redeemable - 20);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='points_redemption'", [ans.id]));
  // admin adjustments never become redeemable
  await admin.req("POST", "/api/admin/points/adjust", { handle: "pt_ans", points: 1000, reason: "مكافأة فعالية" });
  const me1 = await ans.req("GET", "/api/points/me"); assert.equal(me1.redeemable, me0.redeemable - 20); assert.ok(me1.total >= 1000); assert.ok(me1.level.level >= 5);
  // Pi payments off → redemption + funding answer 501 not_configured
  const piSvc = H.app.ctx.services.pi, orig = piSvc.diag; piSvc.diag = () => ({ ...orig(), enabled: false });
  try {
    assert.equal((await ans.req("GET", "/api/points/config")).redemption.reason, "pi_off");
    assert.equal((await ans.req("POST", "/api/points/redeem", { points: 10 })).code, "not_configured");
    assert.equal((await admin.req("POST", "/api/admin/points/pool/fund", { amount: 1 })).code, "not_configured");
  } finally { piSvc.diag = orig; }
});
