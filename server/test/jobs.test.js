/* Phase 77 — jobs & freelance board: post (validation, anti-scam review with reasons, new-account review, staff approve /
 * remove, open caps), search + filters + featured order, saved, apply with the professional profile (no profile → 409,
 * questions, freelance bid, one per member), employer pipeline (viewed automatically, transitions, private note, messages
 * with scam warning, withdraw, filled closes others), reports → paused + staff dismiss, minors (no posting, only unpaid
 * minors-ok postings), blocked members, Pi boost 501 while Pi is off and ledger journal when on; migration 057 + data map.
 * PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, adminC, emp, sara, omar, kid, anon, job, free, app1, app2;
const db = () => H.app.ctx.db;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);
const BODY = "نبحث عن مطوّر واجهات أمامية يتقن React لبناء لوحة تحكم عربية سريعة وسهلة الوصول، مع اختبارات وتوثيق واضح.";
const JOB = { kind: "job", title: "مطوّر واجهات أمامية (React)", body: BODY, category: "tech", skills: ["React", "TypeScript"], mode: "hybrid", city: "جدة", employment: "full", payType: "monthly", payMin: 800, payMax: 1200, questions: ["كم سنة خبرتك في React؟"] };
const old = async (c) => db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), c.id]);

test.before(async () => {
  H = await boot({ jobsOpts: {} });
  adminC = await mk("jb_admin"); emp = await mk("jb_emp", "شركة نور"); sara = await mk("jb_sara", "سارة"); omar = await mk("jb_omar", "عمر"); kid = await mk("jb_kid", "يافع");
  anon = new H.Client();
  for (const c of [emp, sara, omar]) await old(c);
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("posting: validation, anti-scam review, new accounts reviewed, staff approve / remove, caps", async () => {
  assert.equal((await anon.req("POST", "/api/jobs", JOB)).status, 401);
  assert.equal((await emp.req("POST", "/api/jobs", { ...JOB, body: "قصير" })).code, "too_short");
  assert.equal((await emp.req("POST", "/api/jobs", { ...JOB, city: "", mode: "onsite" })).status, 400);
  assert.equal((await emp.req("POST", "/api/jobs", { ...JOB, payMin: 900, payMax: 100 })).code, "bad_pay");
  assert.equal((await emp.req("POST", "/api/jobs", { ...JOB, payMin: null, payMax: null })).code, "bad_pay");
  assert.equal((await emp.req("POST", "/api/jobs", { ...JOB, deadline: "2000-01-01" })).code, "bad_date");
  assert.equal((await kid.req("POST", "/api/jobs", JOB)).code, "minor_restricted");
  let r = await emp.req("POST", "/api/jobs", JOB); assert.equal(r.status, 200, r.error); assert.equal(r.reasons.length, 0); assert.equal(r.state, "open"); job = r.id;
  assert.equal((await anon.req("GET", "/api/jobs/" + job)).job.status, "open");
  // scam signals → review with reasons
  r = await emp.req("POST", "/api/jobs", { ...JOB, title: "إدخال بيانات من المنزل", body: BODY + " يجب دفع رسوم التسجيل 5 Pi قبل البدء، وتواصل معنا على واتساب لإرسال عبارة المرور.", payType: "fixed", payMin: 50, payMax: 50 });
  assert.equal(r.statusLabel, "قيد المراجعة"); const keys = r.reasons.map((x) => x.key); assert.ok(keys.includes("fee") && keys.includes("offplatform") && keys.includes("phrase"), JSON.stringify(keys));
  const scam = r.id;
  assert.equal((await sara.req("GET", "/api/jobs/" + scam)).status, 404); // not public while in review
  // a brand-new account is reviewed once
  const fresh = await mk("jb_fresh"); r = await fresh.req("POST", "/api/jobs", { ...JOB, title: "مصمم شعارات لمشروع ناشئ" }); assert.equal(r.reasons[0].key, "new");
  // staff
  assert.equal((await emp.req("GET", "/api/admin/jobs")).status, 403);
  let a = await adminC.req("GET", "/api/admin/jobs"); assert.equal(a.review.length, 2);
  assert.equal((await adminC.req("POST", "/api/admin/jobs/" + scam, { action: "remove" })).status, 400);
  a = await adminC.req("POST", "/api/admin/jobs/" + scam, { action: "remove", reason: "يطلب رسوماً وعبارة المرور" }); assert.equal(a.review.length, 1);
  assert.ok((await kinds(emp.id)).includes("job_removed"));
  assert.equal((await emp.req("GET", "/api/jobs/" + scam)).job.removedReason, "يطلب رسوماً وعبارة المرور");
  await adminC.req("POST", "/api/admin/jobs/" + r.id, { action: "approve" }); assert.ok((await kinds(fresh.id)).includes("job_approved"));
  // freelance project
  r = await emp.req("POST", "/api/jobs", { kind: "freelance", title: "تصميم هوية بصرية لمتجر", body: "نحتاج شعاراً وألواناً وخطوطاً ودليل استخدام مختصر لمتجر قهوة مختصة في الرياض، مع ملفات قابلة للتعديل.", category: "design", skills: ["تصميم شعارات"], mode: "remote", payType: "fixed", payMin: 100, payMax: 300, questions: [] });
  assert.equal(r.status, 200, r.error); free = r.id;
});

test("search, filters, saved; apply with the professional profile; pipeline; messages; withdraw", async () => {
  let s = await anon.req("GET", "/api/jobs"); assert.equal(s.total, 3); assert.equal(s.piEnabled, false);
  assert.equal((await anon.req("GET", "/api/jobs?kind=freelance")).total, 1);
  assert.equal((await anon.req("GET", "/api/jobs?q=" + encodeURIComponent("واجهات"))).jobs[0].id, job);
  assert.equal((await anon.req("GET", "/api/jobs?skill=react")).total, 2); // JOB + fresh's copy
  assert.equal((await anon.req("GET", "/api/jobs?city=" + encodeURIComponent("جده"))).total, 2); // normalised
  assert.equal((await anon.req("GET", "/api/jobs?minPay=1000")).total, 2);
  s = await anon.req("GET", "/api/jobs?sort=pay"); assert.equal(s.jobs[0].pay.max, 1200);
  assert.equal((await sara.req("POST", `/api/jobs/${job}/save`, {})).saved, true);
  assert.equal((await sara.req("GET", "/api/jobs?kind=job")).jobs.find((j) => j.id === job).saved, true);
  // apply: needs a professional profile
  let v = await sara.req("GET", "/api/jobs/" + job); assert.equal(v.me.canApply, false); assert.equal(v.me.hasPro, false);
  assert.equal((await sara.req("POST", `/api/jobs/${job}/apply`, { cover: "x".repeat(40), answers: ["٦ سنوات"] })).code, "no_profile");
  await sara.req("PUT", "/api/pro/me", { headline: "مطوّرة واجهات أمامية", visibility: "private" });
  await sara.req("PUT", "/api/pro/me/skills", { skills: ["React", "إمكانية الوصول"] });
  assert.equal((await sara.req("POST", `/api/jobs/${job}/apply`, { cover: "قصير", answers: ["٦"] })).code, "too_short");
  assert.equal((await sara.req("POST", `/api/jobs/${job}/apply`, { cover: "أعمل على واجهات React منذ ست سنوات وأهتم بإمكانية الوصول.", answers: [] })).code, "answers");
  let r = await sara.req("POST", `/api/jobs/${job}/apply`, { cover: "أعمل على واجهات React منذ ست سنوات وأهتم بإمكانية الوصول.", answers: ["٦ سنوات"] }); assert.equal(r.status, 200, r.error); app1 = r.id;
  assert.equal((await sara.req("POST", `/api/jobs/${job}/apply`, { cover: "مرة ثانية".repeat(5), answers: ["x"] })).code, "already_applied");
  assert.equal((await emp.req("POST", `/api/jobs/${job}/apply`, { cover: "x".repeat(40), answers: ["x"] })).code, "own");
  assert.ok((await kinds(emp.id)).includes("job_app_new"));
  // freelance bid
  await omar.req("PUT", "/api/pro/me", { headline: "مصمم هويات بصرية" });
  assert.equal((await omar.req("POST", `/api/jobs/${free}/apply`, { cover: "صممت أكثر من ٤٠ هوية لمتاجر قهوة ومطاعم.", bid: 0 })).code, "bid");
  r = await omar.req("POST", `/api/jobs/${free}/apply`, { cover: "صممت أكثر من ٤٠ هوية لمتاجر قهوة ومطاعم.", bid: 220, days: 10 }); assert.equal(r.status, 200, r.error); app2 = r.id;
  // pipeline: employer sees the full professional profile even though it is private; viewed automatically
  assert.equal((await omar.req("GET", `/api/jobs/${job}/applications`)).status, 404);
  const pl = await emp.req("GET", `/api/jobs/${job}/applications`); assert.equal(pl.applications.length, 1); assert.equal(pl.applications[0].headline, "مطوّرة واجهات أمامية"); assert.deepEqual(pl.applications[0].skills, ["React", "إمكانية الوصول"]);
  v = await emp.req("GET", "/api/job-applications/" + app1); assert.equal(v.application.status, "viewed"); assert.equal(v.profile.profile.headline, "مطوّرة واجهات أمامية"); assert.equal(v.profile.skills.length, 2); assert.deepEqual(v.me.next, ["shortlisted", "interview", "offered", "rejected"]);
  assert.equal((await omar.req("GET", "/api/job-applications/" + app1)).status, 404);
  assert.equal((await sara.req("GET", "/api/job-applications/" + app1)).profile, null); // the applicant does not get the employer view
  assert.equal((await emp.req("POST", `/api/job-applications/${app1}/status`, { status: "hired" })).code, "bad_transition");
  v = await emp.req("POST", `/api/job-applications/${app1}/status`, { status: "interview", message: "نودّ مقابلتك يوم الأحد عبر غرفة صوتية." }); assert.equal(v.application.status, "interview");
  assert.ok((await kinds(sara.id)).includes("job_app_status"));
  assert.equal((await emp.req("PUT", `/api/job-applications/${app1}/note`, { note: "مرشحة قوية" })).status, 200);
  assert.equal((await sara.req("GET", "/api/job-applications/" + app1)).application.note, undefined); // private note
  // messages: a risky one carries a warning for the other side only
  v = await sara.req("POST", `/api/job-applications/${app1}/messages`, { body: "شكراً، الأحد يناسبني." }); assert.equal(v.events.at(-1).kind, "message");
  v = await emp.req("POST", `/api/job-applications/${app1}/messages`, { body: "أرسلي عبارة المرور لمحفظتك لنضيف راتبك" }); assert.equal(v.events.at(-1).warn, false);
  v = await sara.req("GET", "/api/job-applications/" + app1); assert.equal(v.events.at(-1).warn, true); assert.ok((await kinds(sara.id)).includes("job_app_msg"));
  // hire → the job is filled once nobody else is in progress
  await emp.req("POST", `/api/job-applications/${app1}/status`, { status: "offered" });
  v = await emp.req("POST", `/api/job-applications/${app1}/status`, { status: "hired" }); assert.equal(v.application.status, "hired");
  assert.equal((await anon.req("GET", "/api/jobs/" + job)).job.status, "filled");
  // withdraw (freelance)
  assert.equal((await omar.req("POST", `/api/job-applications/${app2}/withdraw`)).status, 200);
  assert.equal((await omar.req("POST", `/api/job-applications/${app2}/withdraw`)).code, "bad_transition");
  const me = await omar.req("GET", "/api/jobs/me"); assert.equal(me.applications[0].status, "withdrawn");
  const em = await emp.req("GET", "/api/jobs/me"); assert.ok(em.postings.length >= 2);
});

test("state changes, reports → paused, staff dismiss; minors; blocked; Pi boost off/on", async () => {
  assert.equal((await emp.req("POST", `/api/jobs/${free}/state`, { status: "paused" })).state, "paused");
  assert.equal((await anon.req("GET", "/api/jobs?kind=freelance")).total, 0);
  await emp.req("POST", `/api/jobs/${free}/state`, { status: "open" });
  // reports
  assert.equal((await emp.req("POST", `/api/jobs/${free}/report`, { reason: "scam" })).status, 400);
  for (const c of [sara, omar]) assert.equal((await c.req("POST", `/api/jobs/${free}/report`, { reason: "fee" })).flagged, false);
  assert.equal((await sara.req("POST", `/api/jobs/${free}/report`, { reason: "fee" })).code, "already_reported");
  assert.equal((await adminC.req("POST", `/api/jobs/${free}/report`, { reason: "fake" })).flagged, true);
  assert.equal((await anon.req("GET", "/api/jobs/" + free)).job.status, "paused"); assert.ok((await kinds(emp.id)).includes("job_review"));
  assert.equal((await emp.req("POST", `/api/jobs/${free}/state`, { status: "open" })).code, "flagged");
  const a = await adminC.req("GET", "/api/admin/jobs"); assert.equal(a.reports[0].reports.length, 3);
  await adminC.req("POST", "/api/admin/jobs/" + free, { action: "dismiss" });
  assert.equal((await anon.req("GET", "/api/jobs/" + free)).job.status, "open");
  // minors: only unpaid, minors-ok postings
  await kid.req("PUT", "/api/pro/me", { headline: "طالب مهتم بالتصميم", visibility: "followers" });
  assert.equal((await kid.req("GET", "/api/jobs/" + free)).code, "minor_restricted");
  const vol = await emp.req("POST", "/api/jobs", { kind: "freelance", title: "متطوعون لتصميم ملصقات حملة توعية", body: "نبحث عن متطوعين لتصميم ملصقات توعوية بسيطة عن المحافظة على البيئة في الحي، العمل تطوعي بالكامل.", category: "design", mode: "remote", payType: "none", minorsOk: true, questions: [] });
  assert.equal(vol.status, 200, vol.error);
  assert.equal((await kid.req("GET", "/api/jobs")).total, 1);
  assert.equal((await kid.req("POST", `/api/jobs/${vol.id}/apply`, { cover: "أحب التصميم وأشارك في حملات المدرسة دائماً." })).status, 200);
  // blocked members don't see each other's postings
  assert.equal((await emp.req("PUT", "/api/protection/blocks/" + omar.id, { linked: false })).status, 200);
  assert.equal((await omar.req("GET", "/api/jobs/" + free)).status, 404);
  assert.equal((await omar.req("GET", "/api/jobs")).jobs.some((j) => j.id === free), false);
  await emp.req("DELETE", "/api/protection/blocks/" + omar.id);
  // Pi boost: 501 while Pi is off
  const off = await emp.req("POST", `/api/jobs/${free}/boost`, { days: 7 }); assert.equal(off.status, 501); assert.equal(off.code, "not_configured"); assert.match(off.error, /مدفوعات Pi غير مفعّلة/);
  // … and when Pi is on: intent → completed → featured + journal
  const pis = H.app.ctx.services.pi, en = pis.enabled, ci = pis.createIntent;
  pis.enabled = () => true; pis.createIntent = async () => ({ id: "tx_boost_1" });
  try {
    const b = await emp.req("POST", `/api/jobs/${free}/boost`, { days: 7 }); assert.equal(b.status, 200, b.error); assert.equal(b.amount, 3.5);
    H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { purpose: "jobs", tx: "tx_boost_1", amount: 3.5 });
    for (let i = 0; i < 40 && !(await db().get("SELECT 1 x FROM job_boosts WHERE intent_id=$1 AND status='completed'", ["tx_boost_1"])); i++) { await H.app.ctx.services.jobs.flush(); await new Promise((r) => setTimeout(r, 25)); }
    const s = await anon.req("GET", "/api/jobs"); assert.equal(s.jobs[0].id, free); assert.equal(s.jobs[0].featured, true);
    assert.ok(await db().get("SELECT 1 x FROM ledger_journals WHERE ikey=$1", [`jobs:${b.boost}:boost`]));
  } finally { pis.enabled = en; pis.createIntent = ci; }
});

test("caps, data map, migration 057 down/up", async () => {
  const many = await mk("jb_many"); await old(many);
  for (let i = 0; i < 10; i++) { H.app.ctx.rl.w.clear(); const r = await many.req("POST", "/api/jobs", { ...JOB, title: "إعلان تجريبي رقم " + (i + 1) }); assert.equal(r.status, 200, r.error); }
  H.app.ctx.rl.w.clear(); assert.equal((await many.req("POST", "/api/jobs", { ...JOB, title: "الإعلان الحادي عشر" })).code, "limit");
  const map = JSON.stringify(require("../lib/compliance-lib.js").DATA_MAP);
  for (const t of ["\"jobs\"", "job_applications", "job_events", "job_saved", "job_reports", "job_boosts"]) assert.ok(map.includes(t), t);
  const mig = require("../migrations/057_jobs.js"), d = db().dialect, exec = async (sql) => { for (const s of sql.replace(/\{TS\}/g, d === "postgres" ? "TIMESTAMPTZ" : "TEXT").split(";").map((x) => x.trim()).filter(Boolean)) await db().exec(s); };
  await mig.down(db(), exec, d); await mig.up(db(), exec, d); await mig.up(db(), exec, d);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM jobs")).n), 0);
});
