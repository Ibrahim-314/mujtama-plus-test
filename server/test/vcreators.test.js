/* Phase 65 — verified creators program + support fund: eligibility checklist (adult, age, followers, posts, 2FA, profile,
 * record), application (conduct required, one pending, minors refused), staff approve → badge (only when no other
 * verification) / reject → re-apply cooldown, revoke removes only the program badge, renewal reminder + lapse job,
 * directory; fund rounds (draft → open → review → closed), verified-only applications (window, categories, max grant,
 * edit / withdraw), staff decisions within budget, Pi off → donate / fund / payout 501 not_configured and awards wait
 * «awaiting_pi»; Pi on → donation journal, reservation, payout with txid (ledger balanced), refund reversal; grant updates,
 * reports; migration 052 reversible + data map. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, adminC, cara, dan, fan, NOW = Date.parse("2027-02-01T09:00:00Z");
const db = () => H.app.ctx.db;
const V = () => H.app.ctx.services.vcreators;
const DAY = 864e5;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);
/** make a member eligible: old account, followers, posts, 2FA, avatar + bio */
async function eligible(c) {
  await db().run("UPDATE users SET created_at=$1, avatar='av.webp', bio='صانعة محتوى تعليمي عن البرمجة للمبتدئين' WHERE id=$2", [new Date(NOW - 100 * DAY).toISOString(), c.id]);
  for (let i = 0; i < 50; i++) { const fid = `vcf_${c.handle}_${i}`; await db().run("INSERT INTO users(id,handle,name,role,status,created_at) VALUES($1,$2,'متابع','user','active',$3)", [fid, fid, new Date(NOW - 200 * DAY).toISOString()]); await db().run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [fid, c.id, new Date().toISOString()]); }
  for (let i = 0; i < 10; i++) await db().run("INSERT INTO posts(id,author,type,text,status,visibility,created_at) VALUES($1,$2,'post','منشور مفيد','published','public',$3)", [`vcp_${c.handle}_${i}`, c.id, new Date(NOW - i * DAY).toISOString()]);
  await db().run("INSERT INTO user_2fa(user_id,secret,enabled,created_at) VALUES($1,'x',1,$2) ON CONFLICT DO NOTHING", [c.id, new Date().toISOString()]);
}
const APP = { category: "education", statement: "أقدّم محتوى تعليمياً أسبوعياً عن البرمجة للمبتدئين باللغة العربية منذ سنتين.", links: ["https://example.com/cara"], conduct: true };

test.before(async () => {
  H = await boot({ vcreatorsOpts: { jobs: false, now: () => NOW } });
  adminC = await mk("vc_admin"); cara = await mk("vc_cara", "كارا"); dan = await mk("vc_dan", "دانة"); fan = await mk("vc_fan");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("eligibility checklist explains every rule; not eligible → cannot apply", async () => {
  const p = await cara.req("GET", "/api/creator-program");
  assert.equal(p.status, 200, p.error); assert.equal(p.eligible, false); assert.equal(p.canApply, false);
  assert.deepEqual(p.checks.map((c) => c.key), ["adult", "age", "followers", "posts", "twofa", "profile", "record"]);
  assert.equal(p.checks.find((c) => c.key === "adult").ok, true); assert.equal(p.checks.find((c) => c.key === "followers").ok, false);
  const r = await cara.req("POST", "/api/creator-program/apply", APP); assert.equal(r.status, 403); assert.equal(r.code, "not_eligible");
  const anon = await new H.Client().req("GET", "/api/creator-program"); assert.equal(anon.status, 200); assert.equal(anon.signedIn, false); assert.ok(anon.benefits.length >= 3);
});

test("apply → staff approve → badge + directory; reject → cooldown; minors refused", async () => {
  await eligible(cara); await eligible(dan);
  const p = await cara.req("GET", "/api/creator-program"); assert.equal(p.eligible, true, JSON.stringify(p.checks.filter((c) => !c.ok)));
  assert.equal((await cara.req("POST", "/api/creator-program/apply", { ...APP, conduct: false })).status, 400);
  assert.equal((await cara.req("POST", "/api/creator-program/apply", { ...APP, statement: "قصير" })).status, 400);
  assert.equal((await cara.req("POST", "/api/creator-program/apply", { ...APP, links: ["javascript:alert(1)"] })).status, 400);
  const a = await cara.req("POST", "/api/creator-program/apply", APP); assert.equal(a.status, 200, a.error); assert.equal(a.application.status, "pending");
  assert.equal((await cara.req("POST", "/api/creator-program/apply", APP)).status, 409);
  assert.equal((await cara.req("GET", "/api/admin/creator-program")).status, 403);
  const adm = await adminC.req("GET", "/api/admin/creator-program"); assert.equal(adm.applications.length, 1); assert.equal(adm.applications[0].checks.length, 7);
  assert.equal((await adminC.req("POST", `/api/admin/creator-program/applications/${a.application.id}/approve`)).status, 200);
  const me = await cara.req("GET", "/api/creator-program"); assert.equal(me.member.status, "verified"); assert.equal(me.canApply, false);
  assert.equal((await db().get("SELECT verified FROM users WHERE id=$1", [cara.id])).verified, "creator");
  assert.ok((await kinds(cara.id)).includes("vc_approved"));
  const d = await new H.Client().req("GET", "/api/creator-program/directory?category=education"); assert.equal(d.creators.length, 1); assert.equal(d.creators[0].user.handle, "vc_cara"); assert.equal(d.counts.education, 1);
  assert.equal((await new H.Client().req("GET", "/api/creator-program/badge/vc_cara")).verifiedCreator, true);
  // dan: already person-verified → program never overwrites that badge; reject first → cooldown
  await db().run("UPDATE users SET verified='person' WHERE id=$1", [dan.id]);
  const b = await dan.req("POST", "/api/creator-program/apply", { ...APP, category: "tech" }); assert.equal(b.status, 200, b.error);
  assert.equal((await adminC.req("POST", `/api/admin/creator-program/applications/${b.application.id}/reject`, {})).status, 400);
  assert.equal((await adminC.req("POST", `/api/admin/creator-program/applications/${b.application.id}/reject`, { reason: "أضف روابط لأعمالك" })).status, 200);
  const dp = await dan.req("GET", "/api/creator-program"); assert.equal(dp.canApply, false); assert.match(dp.why, /إعادة التقديم/); assert.equal(dp.application.reason, "أضف روابط لأعمالك");
  NOW += 31 * DAY;
  const b2 = await dan.req("POST", "/api/creator-program/apply", { ...APP, category: "tech" }); assert.equal(b2.status, 200, b2.error);
  await adminC.req("POST", `/api/admin/creator-program/applications/${b2.application.id}/approve`);
  assert.equal((await db().get("SELECT verified FROM users WHERE id=$1", [dan.id])).verified, "person");
  // minors
  const kid = await mk("vc_kid"); const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
  try { await eligible(kid); const r = await kid.req("POST", "/api/creator-program/apply", APP); assert.equal(r.status, 403); assert.equal(r.code, "minor_restricted"); }
  finally { H.app.ctx.services.minors.isMinorUser = real; }
});

let round, appC;
test("fund rounds: staff create → open (verified creators notified) → verified-only applications within rules", async () => {
  assert.equal((await adminC.req("POST", "/api/admin/fund/rounds", { title: "جولة", descr: "قصير" })).status, 400);
  const r = await adminC.req("POST", "/api/admin/fund/rounds", { title: "جولة الشتاء للمحتوى التعليمي", descr: "منح لدعم سلاسل تعليمية عربية مفتوحة للجميع.", criteria: "الأثر والأصالة والجدوى", categories: ["education"], budget: 100, maxGrant: 40, opensAt: new Date(NOW - DAY).toISOString(), closesAt: new Date(NOW + 20 * DAY).toISOString() });
  assert.equal(r.status, 200, r.error); round = r.round; assert.equal(round.status, "draft");
  assert.equal((await fan.req("GET", "/api/fund/rounds/" + round.id)).status, 404); // drafts are private
  assert.equal((await adminC.req("POST", `/api/admin/fund/rounds/${round.id}/status`, { status: "closed" })).status, 409);
  await adminC.req("POST", `/api/admin/fund/rounds/${round.id}/status`, { status: "open" });
  assert.ok((await kinds(cara.id)).includes("fund_round")); assert.ok(!(await kinds(dan.id)).includes("fund_round")); // other category
  const v = await fan.req("GET", "/api/fund/rounds/" + round.id); assert.equal(v.me.canApply, false); assert.match(v.me.why, /الموثّقين/);
  assert.equal((await fan.req("POST", `/api/fund/rounds/${round.id}/apply`, {})).code, "not_verified");
  assert.match((await dan.req("GET", "/api/fund/rounds/" + round.id)).me.why, /مجالات أخرى/);
  const body = { title: "سلسلة JavaScript للمبتدئين", plan: "عشرون درساً قصيراً بالعربية مع تمارين ومشاريع صغيرة، تُنشر أسبوعياً على المنصة مجاناً ويصاحبها ملف تمارين مفتوح.", amount: 50, milestones: ["الدروس ١–١٠", "الدروس ١١–٢٠"] };
  assert.equal((await cara.req("POST", `/api/fund/rounds/${round.id}/apply`, body)).status, 400); // > max grant
  assert.equal((await cara.req("POST", `/api/fund/rounds/${round.id}/apply`, { ...body, amount: 30, milestones: [] })).status, 400);
  const a = await cara.req("POST", `/api/fund/rounds/${round.id}/apply`, { ...body, amount: 30 }); assert.equal(a.status, 200, a.error);
  appC = a.me.application; assert.equal(appC.amount, 30); assert.equal(a.me.canEdit, true);
  assert.equal((await cara.req("POST", `/api/fund/rounds/${round.id}/apply`, { ...body, amount: 30 })).status, 409);
  const e = await cara.req("PUT", "/api/fund/applications/" + appC.id, { amount: 35 }); assert.equal(e.status, 200, e.error); assert.equal(e.me.application.amount, 35);
  assert.equal((await fan.req("GET", "/api/fund/grants/" + appC.id)).status, 404); // not public before a decision
});

test("Pi off: decisions recorded (awaiting_pi), donate / fund / payout → 501; public transparency page", async () => {
  await adminC.req("POST", `/api/admin/fund/rounds/${round.id}/status`, { status: "review" });
  assert.equal((await cara.req("PUT", "/api/fund/applications/" + appC.id, { amount: 20 })).status, 409); // closed for edits
  assert.equal((await adminC.req("POST", `/api/admin/fund/applications/${appC.id}/decide`, { action: "approve", award: 200 })).status, 400);
  const ok = await adminC.req("POST", `/api/admin/fund/applications/${appC.id}/decide`, { action: "approve", award: 30, reason: "خطة واضحة", score: 88 });
  assert.equal(ok.status, 200, ok.error); assert.equal(ok.applications[0].payStatus, "awaiting_pi"); assert.equal(ok.round.remaining, 70);
  assert.ok((await kinds(cara.id)).includes("fund_decision"));
  const don = await fan.req("POST", "/api/fund/donate", { amount: 5 }); assert.equal(don.status, 501); assert.equal(don.code, "not_configured"); assert.match(don.error, /مدفوعات Pi/);
  assert.equal((await adminC.req("POST", "/api/admin/fund/pool", { amount: 100, memo: "تمويل أولي" })).status, 501);
  assert.equal((await adminC.req("POST", `/api/admin/fund/applications/${appC.id}/payout`, { txid: "pitx_payout_1" })).status, 501);
  const f = await new H.Client().req("GET", "/api/fund");
  assert.equal(f.status, 200, f.error); assert.equal(f.piEnabled, false); assert.match(f.piNotice, /مدفوعات Pi/);
  assert.equal(f.totals.awarded, 30); assert.equal(f.totals.paid, 0); assert.equal(f.grants.length, 1); assert.equal(f.grants[0].payLabel, "بانتظار تفعيل مدفوعات Pi");
  assert.equal(f.grants[0].note, undefined); // staff notes never public
  const g = await fan.req("GET", "/api/fund/grants/" + appC.id); assert.equal(g.status, 200); assert.equal(g.me.canReport, true);
  // updates + report
  assert.equal((await fan.req("POST", `/api/fund/grants/${appC.id}/updates`, { body: "تحديث من شخص آخر" })).status, 404);
  assert.equal((await cara.req("POST", `/api/fund/grants/${appC.id}/updates`, { body: "نُشرت الدروس الخمسة الأولى ✔" })).status, 200);
  assert.equal((await new H.Client().req("GET", "/api/fund/grants/" + appC.id)).updates.length, 1);
  assert.equal((await fan.req("POST", `/api/fund/grants/${appC.id}/report`, { reason: "nope" })).status, 400);
  assert.equal((await fan.req("POST", `/api/fund/grants/${appC.id}/report`, { reason: "misleading", note: "الدروس غير موجودة" })).status, 200);
  assert.equal((await fan.req("POST", `/api/fund/grants/${appC.id}/report`, { reason: "misleading" })).status, 409);
  const adm = await adminC.req("GET", "/api/admin/creator-program"); assert.equal(adm.reports.length, 1); assert.equal(adm.payouts.length, 1);
  assert.equal((await adminC.req("POST", `/api/admin/fund/reports/${adm.reports[0].id}`, { action: "dismiss" })).status, 200);
});

test("Pi on: donation journal → pool; reserve + payout with txid; refund reversal; ledger balanced", async () => {
  const pis = H.app.ctx.services.pi, en = pis.enabled, ci = pis.createIntent; let k = 0;
  pis.enabled = () => true; pis.createIntent = async (u, b) => ({ id: "pitx_fd" + ++k, amount: b.amount, memo: b.memo, metadata: { purpose: b.purpose } });
  try {
    const d = await fan.req("POST", "/api/fund/donate", { amount: 12, anonymous: true }); assert.equal(d.status, 200, d.error); assert.equal(d.intent.amount, 12);
    H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { tx: d.intent.id, purpose: "fund", amount: 12 }); await V().settle();
    H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { tx: d.intent.id, purpose: "fund", amount: 12 }); await V().settle(); // idempotent
    let f = await new H.Client().req("GET", "/api/fund"); assert.equal(f.totals.pool, 12); assert.equal(f.totals.donated, 12); assert.equal(f.donations[0].by, null);
    // pool too small for the 30 π award
    assert.equal((await adminC.req("POST", `/api/admin/fund/applications/${appC.id}/payout`, { txid: "pitx_payout_1" })).code, "insufficient_pool");
    assert.equal((await adminC.req("POST", "/api/admin/fund/pool", { amount: 50, memo: "تمويل المنصة" })).status, 200);
    assert.equal((await adminC.req("POST", `/api/admin/fund/applications/${appC.id}/payout`, {})).status, 400);
    const p = await adminC.req("POST", `/api/admin/fund/applications/${appC.id}/payout`, { txid: "pitx_payout_1" }); assert.equal(p.status, 200, p.error);
    assert.equal((await adminC.req("POST", `/api/admin/fund/applications/${appC.id}/payout`, { txid: "pitx_payout_1" })).status, 409);
    f = await new H.Client().req("GET", "/api/fund"); assert.equal(f.totals.pool, 32); assert.equal(f.totals.paid, 30);
    assert.equal(Number((await db().get("SELECT SUM(credit)-SUM(debit) n FROM ledger_entries WHERE account=$1", ["creator:" + cara.id + ":grants"])).n), 0);
    assert.ok((await kinds(cara.id)).includes("fund_paid"));
    const tot = await db().get("SELECT SUM(debit) d, SUM(credit) c FROM ledger_entries"); assert.equal(Number(tot.d), Number(tot.c));
    // refunded donation is reversed
    H.app.ctx.bus.emit("PI_PAYMENT_REFUNDED", { tx: d.intent.id, purpose: "fund" }); await V().settle();
    f = await new H.Client().req("GET", "/api/fund"); assert.equal(f.totals.pool, 20); assert.equal(f.totals.donated, 0);
    // minors never donate
    const kid = await mk("vc_kid2"); const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
    try { assert.equal((await kid.req("POST", "/api/fund/donate", { amount: 1 })).code, "minor_restricted"); } finally { H.app.ctx.services.minors.isMinorUser = real; }
  } finally { pis.enabled = en; pis.createIntent = ci; }
  await adminC.req("POST", `/api/admin/fund/rounds/${round.id}/status`, { status: "closed" });
  assert.equal((await new H.Client().req("GET", "/api/fund/rounds/" + round.id)).awards.length, 1);
});

test("revoke removes only the program badge; renewal reminder + lapse job; renew", async () => {
  assert.equal((await adminC.req("POST", `/api/admin/creator-program/members/${dan.id}/revoke`, { reason: "مخالفة الميثاق" })).status, 200);
  assert.equal((await db().get("SELECT verified FROM users WHERE id=$1", [dan.id])).verified, "person");
  assert.equal((await dan.req("GET", "/api/creator-program")).member.status, "revoked");
  assert.equal((await new H.Client().req("GET", "/api/creator-program/directory?category=tech")).creators.length, 0);
  await adminC.req("POST", `/api/admin/creator-program/members/${dan.id}/restore`);
  assert.equal((await dan.req("GET", "/api/creator-program")).member.status, "verified");
  // cara: 340 days later → reminder; 366 → lapsed, badge removed; renew restores
  NOW += 340 * DAY;
  let t = await V().tick(); assert.ok(t.reminded >= 1); assert.ok((await kinds(cara.id)).includes("vc_renew"));
  assert.equal((await V().tick()).reminded, 0);
  NOW += 30 * DAY;
  t = await V().tick(); assert.ok(t.lapsed >= 1);
  assert.equal((await db().get("SELECT verified FROM users WHERE id=$1", [cara.id])).verified, null);
  await eligible(cara).catch(() => null); // posts in the last 90 days again
  for (let i = 0; i < 10; i++) await db().run("INSERT INTO posts(id,author,type,text,status,visibility,created_at) VALUES($1,$2,'post','منشور جديد','published','public',$3)", [`vcr_${i}`, cara.id, new Date(NOW - i * DAY).toISOString()]);
  const r = await cara.req("POST", "/api/creator-program/renew"); assert.equal(r.status, 200, r.error); assert.equal(r.member.status, "verified");
  assert.equal((await db().get("SELECT verified FROM users WHERE id=$1", [cara.id])).verified, "creator");
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='vc_revoked' AND target=$1", [dan.id]));
});

test("migration 052 reversible + additive; data map", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '052_vcreators' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "052_vcreators"]);
  await assert.rejects(() => db().get("SELECT 1 FROM fund_rounds"));
  assert.deepEqual(await mig.up(db()), ["052_vcreators", ...after]);
  const L = require("../lib/compliance-lib");
  for (const t of ["vc_applications", "vc_creators", "fund_applications", "fund_updates", "fund_donations", "fund_reports"]) { const m = L.DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [cara.id]); }
});
