/* Phase 73 — quizzes and verifiable certificates.
 * Exams: teachers only; question types (single / multi / tf / short with Arabic normalisation) + validation; answers never
 * sent before submitting; per-attempt shuffle mapped back correctly; server deadline → auto-submit with saved answers;
 * attempt limit; window; review policy; questions lock after the first submission (duplicate instead); teacher results
 * (distribution, item analysis, CSV).
 * Certificates: exam pass → signed certificate (Ed25519 verifies with the published key, tamper fails); course completion
 * (phase 72 hook) and study completion (phase 71 hook) issue once; backfill for older completions; study revoke → certificate
 * revoked; issuer revoke / restore (not the holder, not outsiders); /cert/<code> page (status, QR, no script) + 404;
 * holder visibility; profile list; minors: initial only, unlisted, never on a profile; migration 050 reversible. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const crypto = require("node:crypto");
const { boot } = require("./helpers");

let H, T, s1, s2, out, gid, exam, NOW = Date.now();
const db = () => H.app.ctx.db;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const Q = [
  { type: "single", q: "عاصمة السعودية؟", options: ["جدة", "الرياض", "الدمام"], answer: 1, explain: "الرياض هي العاصمة" },
  { type: "multi", q: "أي مما يلي لغات برمجة؟", options: ["JavaScript", "HTML", "Python"], answer: [0, 2], points: 2 },
  { type: "tf", q: "الماء يغلي عند ١٠٠ درجة مئوية عند سطح البحر", answer: true },
  { type: "short", q: "اكتب اسم الشهر التاسع هجرياً", accepted: ["رمضان"] }
];
/** answer an attempt correctly in DISPLAY order using the bank (test knows the bank) */
function correctAnswers(view, bank) {
  const a = {};
  for (const q of view.questions) {
    const b = bank.find((x) => x.q === q.q);
    if (b.type === "short") a[q.id] = "  رمضانُ "; // tashkeel + spaces
    else if (b.type === "tf") a[q.id] = q.options.indexOf(b.answer ? "صح" : "خطأ");
    else if (b.type === "multi") a[q.id] = b.answer.map((i) => q.options.indexOf(b.options[i]));
    else a[q.id] = q.options.indexOf(b.options[b.answer]);
  }
  return a;
}
test.before(async () => {
  H = await boot({ studyOpts: { jobs: false }, examsOpts: { now: () => NOW } });
  T = await mk("ce_teacher", "المعلمة نورة"); s1 = await mk("ce_s1", "سارة الحربي"); s2 = await mk("ce_s2", "خالد العتيبي"); out = await mk("ce_out");
  const g = await T.req("POST", "/api/study/groups", { name: "مجموعة العلوم", type: "public", mode: "group", subject: "علوم" });
  assert.equal(g.status, 200, g.error); gid = g.group.id;
  for (const s of [s1, s2]) { H.app.ctx.rl.w.clear(); await s.req("POST", `/api/communities/${gid}/join`); }
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("authoring: teachers only, validation, draft hidden, publish", async () => {
  assert.equal((await s1.req("POST", "/api/exams", { communityId: gid, title: "اختبار", questions: Q })).status, 403);
  assert.equal((await T.req("POST", "/api/exams", { communityId: gid, title: "اختبار", questions: [{ type: "single", q: "س", options: ["أ"], answer: 0 }] })).status, 400);
  assert.equal((await T.req("POST", "/api/exams", { communityId: gid, title: "اختبار", questions: [{ type: "short", q: "سؤال", accepted: [] }] })).status, 400);
  const r = await T.req("POST", "/api/exams", { communityId: gid, title: "اختبار العلوم الأول", descr: "أربعة أسئلة", questions: Q, settings: { timeLimit: 10, maxAttempts: 2, passPct: 60, review: "submit", certificate: true } });
  assert.equal(r.status, 200, r.error); exam = r.exam;
  assert.equal(exam.questions, 4); assert.equal(exam.points, 5); assert.equal(exam.bank.length, 4);
  assert.equal((await s1.req("GET", "/api/exams/" + exam.id)).status, 404); // draft
  assert.equal((await T.req("PATCH", "/api/exams/" + exam.id, { status: "published" })).exam.status, "published");
  const v = await s1.req("GET", "/api/exams/" + exam.id);
  assert.equal(v.status, 200); assert.equal(v.exam.bank, undefined); assert.equal(v.me.canStart, true);
  const l = await s1.req("GET", "/api/exams?group=" + gid); assert.ok(l.exams.some((e) => e.id === exam.id));
});

test("taking: no answers leak, shuffle maps back, scoring incl. Arabic short answer, review, certificate issued and signed", async () => {
  const a = await s1.req("POST", `/api/exams/${exam.id}/start`);
  assert.equal(a.status, 200, a.error); assert.ok(a.attempt.dueAt);
  const raw = JSON.stringify(a.questions); assert.doesNotMatch(raw, /"answer"|accepted|explain/);
  const again = await s1.req("POST", `/api/exams/${exam.id}/start`); assert.equal(again.attempt.id, a.attempt.id); // resume
  const ans = correctAnswers(a, Q);
  const sv = await s1.req("PUT", `/api/exam-attempts/${a.attempt.id}/answers`, { answers: { [a.questions[0].id]: ans[a.questions[0].id] } });
  assert.equal(sv.status, 200, sv.error); assert.equal(sv.saved, 1);
  const r = await s1.req("POST", `/api/exam-attempts/${a.attempt.id}/submit`, { answers: ans });
  assert.equal(r.status, 200, r.error); assert.equal(r.attempt.score, 100); assert.equal(r.attempt.passed, true); assert.equal(r.reveal, true);
  assert.ok(r.review.every((x) => x.correct)); assert.ok(r.review.some((x) => x.explain === "الرياض هي العاصمة"));
  assert.ok(r.certificate?.code, "certificate issued"); assert.match(r.certificate.code, /^MP-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  // signature verifies with the published key; tampering fails
  const v = await new H.Client().req("GET", "/api/certificates/verify/" + r.certificate.code.toLowerCase().replace(/-/g, " "));
  assert.equal(v.status, 200, v.error); assert.equal(v.valid, true); assert.equal(v.certificate.holder, "سارة الحربي");
  const keys = await new H.Client().req("GET", "/api/certificates/keys");
  const pub = crypto.createPublicKey(keys.keys[0].spki);
  assert.equal(crypto.verify(null, Buffer.from(v.payload), pub, Buffer.from(v.signature, "base64url")), true);
  assert.equal(crypto.verify(null, Buffer.from(v.payload.replace("سارة", "سلمى")), pub, Buffer.from(v.signature, "base64url")), false);
  assert.equal(JSON.parse(v.payload).details.score, 100);
  const wk = await fetch(H.base + "/.well-known/mujtama-certificates.json"); assert.equal(wk.status, 200); assert.equal((await wk.json()).keys[0].kid, keys.keys[0].kid);
});

test("deadline auto-submits saved answers; attempt limit; questions lock after a submission; teacher results + CSV", async () => {
  const a = await s2.req("POST", `/api/exams/${exam.id}/start`);
  const ans = correctAnswers(a, Q), first = a.questions[0].id;
  await s2.req("PUT", `/api/exam-attempts/${a.attempt.id}/answers`, { answers: { [first]: ans[first] } });
  NOW += 11 * 60e3; // past the 10-minute limit + grace
  const late = await s2.req("POST", `/api/exam-attempts/${a.attempt.id}/submit`, { answers: ans });
  assert.equal(late.attempt.status, "expired"); assert.ok(late.attempt.score < 100); // only the saved answer counted
  assert.equal((await s2.req("PUT", `/api/exam-attempts/${a.attempt.id}/answers`, { answers: ans })).status, 409);
  const b = await s2.req("POST", `/api/exams/${exam.id}/start`); assert.equal(b.status, 200);
  await s2.req("POST", `/api/exam-attempts/${b.attempt.id}/submit`, { answers: {} });
  const c = await s2.req("POST", `/api/exams/${exam.id}/start`); assert.equal(c.status, 400); assert.equal(c.code, "attempts");
  assert.equal((await out.req("GET", `/api/exam-attempts/${b.attempt.id}`)).status, 404);
  const lock = await T.req("PATCH", "/api/exams/" + exam.id, { questions: Q.slice(0, 2) }); assert.equal(lock.status, 409);
  const dup = await T.req("POST", `/api/exams/${exam.id}/duplicate`); assert.equal(dup.status, 200); assert.equal(dup.exam.status, "draft");
  assert.equal((await s1.req("GET", `/api/exams/${exam.id}/results`)).status, 403);
  const res = await T.req("GET", `/api/exams/${exam.id}/results`);
  assert.equal(res.status, 200, res.error); assert.equal(res.summary.learners, 2); assert.equal(res.summary.passed, 1);
  assert.equal(res.items.length, 4); assert.equal(res.distribution.reduce((t, x) => t + x.n, 0), 2);
  const csv = await fetch(H.base + `/api/exams/${exam.id}/results?format=csv`, { headers: { Cookie: T.cookie, "X-Requested-With": "mujtama" } });
  assert.equal(csv.status, 200); assert.match(await csv.text(), /سارة الحربي/);
  NOW = Date.now();
});

test("course + study completion hooks issue once; backfill; study revoke → revoked; issuer revoke / restore; /cert page", async () => {
  // course (phase 72 hook)
  const c = await T.req("POST", "/api/courses", { communityId: gid, title: "مقدمة في الفيزياء" });
  const l = await T.req("POST", `/api/courses/${c.course.id}/lessons`, { moduleId: c.outline[0].id, title: "الدرس", kind: "text", body: "محتوى" });
  await T.req("PATCH", "/api/courses/" + c.course.id, { status: "published" });
  await s1.req("POST", `/api/courses/${c.course.id}/enrol`);
  const done = await s1.req("POST", `/api/course-lessons/${l.lesson.id}/complete`); assert.equal(done.completed, true);
  await H.app.ctx.services.certs.flush();
  const mine = await s1.req("GET", "/api/certificates");
  const cc = mine.certificates.find((x) => x.kind === "course"); assert.ok(cc, "course certificate"); assert.equal(cc.title, "مقدمة في الفيزياء");
  assert.equal(mine.certificates.length, 2);
  // backfill: an older completion without its certificate
  await db().run("DELETE FROM certificates WHERE kind='course' AND holder_id=$1", [s1.id]);
  assert.equal((await s1.req("GET", "/api/certificates")).certificates.filter((x) => x.kind === "course").length, 1);
  // study (phase 71 hook) — manual completion by the teacher
  const st = await T.req("POST", `/api/study/groups/${gid}/completions/${s2.id}`, { override: true, note: "التزام ممتاز" });
  assert.equal(st.status, 200, st.error); await H.app.ctx.services.certs.flush();
  const s2c = (await s2.req("GET", "/api/certificates")).certificates.find((x) => x.kind === "study"); assert.ok(s2c); assert.equal(s2c.status, "valid");
  await T.req("POST", `/api/study/groups/${gid}/completions/${s2.id}`, { revoke: true }); await H.app.ctx.services.certs.flush();
  assert.equal((await new H.Client().req("GET", "/api/certificates/verify/" + s2c.code)).valid, false);
  // issuer revoke / restore
  const cur = (await s1.req("GET", "/api/certificates")).certificates.find((x) => x.kind === "course");
  assert.notEqual(cur.code, cc.code); assert.equal((await new H.Client().req("GET", "/api/certificates/verify/" + cc.code)).status, 404);
  assert.equal((await s1.req("POST", `/api/certificates/${cur.code}/revoke`, { reason: "خطأ" })).status, 403);
  assert.equal((await out.req("POST", `/api/certificates/${cur.code}/revoke`, { reason: "خطأ" })).status, 403);
  const rv = await T.req("POST", `/api/certificates/${cur.code}/revoke`, { reason: "أُعيد تقييم الدورة" }); assert.equal(rv.revokeReason, "أُعيد تقييم الدورة"); assert.equal(rv.status, "revoked");
  const page = await fetch(H.base + "/cert/" + cur.code); const html = await page.text();
  assert.equal(page.status, 200); assert.match(html, /سُحبت هذه الشهادة/); assert.doesNotMatch(html, /<script(?! type="application)/);
  await T.req("POST", `/api/certificates/${cur.code}/restore`);
  const ok = await (await fetch(H.base + "/cert/" + cur.code)).text(); assert.match(ok, /شهادة صحيحة/); assert.match(ok, /<svg/); assert.match(ok, /مقدمة في الفيزياء/);
  assert.equal((await fetch(H.base + "/cert/MP-AAAA-AAAA")).status, 404);
  const issued = await T.req("GET", `/api/communities/${gid}/certificates`); assert.ok(issued.certificates.length >= 3);
  assert.ok((await s1.req("GET", "/api/certificates")).certificates.find((x) => x.code === cur.code).verifications >= 2);
});

test("holder visibility + profile list; minors: initial only, unlisted, never on a profile", async () => {
  const mine = (await s1.req("GET", "/api/certificates")).certificates;
  assert.equal((await new H.Client().req("GET", "/api/users/ce_s1/certificates")).certificates.length, mine.filter((c) => c.status === "valid").length);
  assert.equal((await s1.req("PATCH", "/api/certificates/" + mine[0].code, { visibility: "unlisted" })).visibility, "unlisted");
  assert.equal((await out.req("PATCH", "/api/certificates/" + mine[1].code, { visibility: "unlisted" })).status, 404);
  assert.equal((await new H.Client().req("GET", "/api/users/ce_s1/certificates")).certificates.length, mine.filter((c) => c.status === "valid").length - 1);
  assert.equal((await new H.Client().req("GET", "/api/certificates/verify/" + mine[0].code)).valid, true); // unlisted still verifies
  // minor
  const kid = await mk("ce_kid", "ريم عبدالله الزهراني");
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
  try {
    H.app.ctx.rl.w.clear(); await kid.req("POST", `/api/communities/${gid}/join`);
    const a = await kid.req("POST", `/api/exams/${exam.id}/start`);
    const r = await kid.req("POST", `/api/exam-attempts/${a.attempt.id}/submit`, { answers: correctAnswers(a, Q) });
    const v = await new H.Client().req("GET", "/api/certificates/verify/" + r.certificate.code);
    assert.equal(v.certificate.holder, "ريم ع."); assert.equal((await kid.req("GET", "/api/certificates")).certificates[0].visibility, "unlisted");
    assert.equal((await kid.req("PATCH", "/api/certificates/" + r.certificate.code, { visibility: "public" })).status, 403);
    assert.deepEqual((await new H.Client().req("GET", "/api/users/ce_kid/certificates")).certificates, []);
  } finally { H.app.ctx.services.minors.isMinorUser = real; }
});

test("migration 050 reversible + additive; data map", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '050_certs' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "050_certs"]);
  await assert.rejects(() => db().get("SELECT 1 FROM certificates"));
  assert.deepEqual(await mig.up(db()), ["050_certs", ...after]);
  const L = require("../lib/compliance-lib");
  for (const t of ["exams", "exam_attempts", "certificates"]) { const m = L.DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [s1.id]); }
});
