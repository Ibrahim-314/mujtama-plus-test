/* Phase 72 — courses on phase 71 study groups: authoring (teachers only; modules, text / video / quiz lessons, validation,
 * reorder + move across modules, publish needs a lesson), catalogue visibility (private group → members only), enrol /
 * leave, lesson pages (enrolled only, prev / next, resume), quiz scoring on the server (answers hidden before passing,
 * attempts per day), progress %, completion → COURSE_COMPLETED + notification (once), new lesson → enrolled told and
 * progress recomputed, product access needs an entitlement, teacher view (learners + funnel), migration 047. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, T, s1, s2, out, gid, privGid, course, mods; const lessons = {};
const db = () => H.app.ctx.db;
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
test.before(async () => {
  H = await boot({ studyOpts: { jobs: false }, coursesOpts: { env: { COURSE_QUIZ_ATTEMPTS_PER_DAY: "3" } } });
  T = await mk("co_teacher"); s1 = await mk("co_s1"); s2 = await mk("co_s2"); out = await mk("co_out");
  const g = await T.req("POST", "/api/study/groups", { name: "مجموعة البرمجة للمبتدئين", type: "public", mode: "group", subject: "برمجة" });
  assert.equal(g.status, 200, g.error); gid = g.group.id;
  H.app.ctx.rl.w.clear();
  const pg = await T.req("POST", "/api/study/groups", { name: "حلقة خاصة", type: "private", mode: "halaqa" });
  assert.equal(pg.status, 200, pg.error); privGid = pg.group.id;
  for (const s of [s1, s2]) { H.app.ctx.rl.w.clear(); await s.req("POST", `/api/communities/${gid}/join`); }
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 047 reversible + additive; data map entries", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '047_courses' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "047_courses"]);
  await assert.rejects(() => db().get("SELECT 1 FROM courses"));
  assert.deepEqual(await mig.up(db()), ["047_courses", ...after]);
  for (const t of ["courses", "course_enrolments", "course_progress", "course_attempts"]) { const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [s1.id]); }
});

test("authoring: teachers only; modules + text / video / quiz lessons with validation; reorder + move; publish needs a lesson", async () => {
  assert.equal((await s1.req("POST", "/api/courses", { communityId: gid, title: "دورة طالب" })).status, 403);
  const c = await T.req("POST", "/api/courses", { communityId: gid, title: "أساسيات JavaScript", subtitle: "من الصفر إلى أول مشروع", descr: "دورة عملية قصيرة", level: "beginner", passPct: 60 });
  assert.equal(c.status, 200, c.error); course = c.course.id; assert.equal(c.course.status, "draft"); assert.equal(c.outline.length, 1);
  assert.equal((await T.req("PATCH", "/api/courses/" + course, { status: "published" })).status, 400, "no lessons yet");
  assert.equal((await s1.req("GET", "/api/courses/" + course)).status, 404, "drafts hidden");
  const m1 = c.outline[0].id;
  const m2 = (await T.req("POST", `/api/courses/${course}/modules`, { title: "الوحدة الثانية: الدوال" })).outline[1].id; mods = [m1, m2];
  assert.equal((await T.req("POST", `/api/courses/${course}/lessons`, { moduleId: m1, title: "فارغ", kind: "text" })).status, 400, "text needs a body");
  assert.equal((await T.req("POST", `/api/courses/${course}/lessons`, { moduleId: m1, title: "فيديو", kind: "video", videoUrl: "http://x.example/v" })).status, 400, "https only");
  assert.equal((await T.req("POST", `/api/courses/${course}/lessons`, { moduleId: m1, title: "اختبار", kind: "quiz", quiz: { questions: [{ q: "س؟", options: ["أ"], answer: 0 }] } })).status, 400, "two options");
  const add = async (b) => { const r = await T.req("POST", `/api/courses/${course}/lessons`, b); assert.equal(r.status, 200, r.error); return r.lesson.id; };
  lessons.intro = await add({ moduleId: m1, title: "ما هي JavaScript؟", kind: "text", body: "## مقدمة\nلغة **الويب**.\n- تعمل في المتصفح\n- وعلى الخادم", minutes: 6 });
  lessons.video = await add({ moduleId: m1, title: "إعداد بيئة العمل", kind: "video", videoUrl: "https://www.youtube.com/watch?v=abc123", minutes: 12 });
  lessons.quiz = await add({ moduleId: m2, title: "اختبار الوحدة", kind: "quiz", passPct: 50, quiz: { questions: [
    { q: "كيف تعرّف متغيراً ثابتاً؟", options: ["var", "let", "const"], answer: 2, explain: "const لا يُعاد إسناده" },
    { q: "ما ناتج typeof []؟", options: ["array", "object"], answer: 1, explain: "المصفوفات كائنات" }] } });
  lessons.fn = await add({ moduleId: m2, title: "الدوال", kind: "text", body: "الدالة كتلة قابلة لإعادة الاستخدام", minutes: 8 });
  // reorder: move «الدوال» up within module 2, then the video down → into module 2
  let o = await T.req("POST", `/api/courses/${course}/move`, { lessonId: lessons.fn, dir: "up" });
  assert.deepEqual(o.outline[1].lessons.map((l) => l.id), [lessons.fn, lessons.quiz]);
  o = await T.req("POST", `/api/courses/${course}/move`, { lessonId: lessons.video, dir: "down" });
  assert.deepEqual(o.outline[0].lessons.map((l) => l.id), [lessons.intro]); assert.equal(o.outline[1].lessons[0].id, lessons.video, "moved into the next module");
  o = await T.req("POST", `/api/courses/${course}/move`, { lessonId: lessons.video, dir: "up" });
  assert.deepEqual(o.outline[0].lessons.map((l) => l.id), [lessons.intro, lessons.video], "and back");
  o = await T.req("POST", `/api/courses/${course}/move`, { moduleId: m2, dir: "up" }); assert.equal(o.outline[0].id, m2);
  o = await T.req("POST", `/api/courses/${course}/move`, { moduleId: m2, dir: "down" }); assert.equal(o.outline[0].id, m1);
  assert.equal((await T.req("DELETE", "/api/course-modules/" + m2)).status, 400, "not while it has lessons");
  const p = await T.req("PATCH", "/api/courses/" + course, { status: "published" });
  assert.equal(p.status, 200, p.error); assert.equal(p.course.status, "published"); assert.equal(p.course.lessons, 4); assert.equal(p.course.minutes, 6 + 12 + 5 + 8);
});

test("catalogue + private groups; enrol / leave; lesson pages need enrolment; answers hidden before passing", async () => {
  const cat = await out.req("GET", "/api/courses");
  assert.ok(cat.courses.some((c) => c.id === course), "public group → visible to everyone signed in");
  const priv = await T.req("POST", "/api/courses", { communityId: privGid, title: "تجويد للمبتدئين" });
  await T.req("POST", `/api/courses/${priv.course.id}/lessons`, { moduleId: priv.outline[0].id, title: "أحكام النون الساكنة", kind: "text", body: "الإظهار والإدغام" });
  await T.req("PATCH", "/api/courses/" + priv.course.id, { status: "published" });
  assert.ok(!(await out.req("GET", "/api/courses")).courses.some((c) => c.id === priv.course.id), "private group → members only");
  assert.equal((await out.req("GET", "/api/courses/" + priv.course.id)).status, 404);
  assert.equal((await s1.req("GET", "/api/course-lessons/" + lessons.intro)).code, "not_enrolled");
  const e = await s1.req("POST", `/api/courses/${course}/enrol`);
  assert.equal(e.status, 200, e.error); assert.equal(e.me.enrolled, true); assert.equal(e.me.progress, 0); assert.equal(e.me.resume.id, lessons.intro);
  const f = await s1.req("GET", "/api/course-lessons/" + lessons.fn);
  assert.equal(f.prev.id, lessons.video, "prev across modules"); assert.equal(f.next.id, lessons.quiz); assert.equal(f.index, 3); assert.equal(f.total, 4);
  const v = await s1.req("GET", "/api/course-lessons/" + lessons.video); assert.equal(v.lesson.videoHost, "youtube.com");
  const l = await s1.req("GET", "/api/course-lessons/" + lessons.quiz);
  assert.equal(l.lesson.quiz.questions.length, 2); assert.equal(l.lesson.quiz.questions[0].answer, undefined, "answers never sent before an attempt");
  assert.equal(l.lesson.passPct, 50); assert.equal(l.next, null);
  const tl = await T.req("GET", "/api/course-lessons/" + lessons.quiz); assert.equal(tl.lesson.quiz.questions[0].answer, 2, "teachers see answers");
  const cat2 = await s1.req("GET", "/api/courses"); assert.equal(cat2.learning[0].id, course); assert.equal(cat2.learning[0].resume.id, lessons.quiz, "resume where I left off");
  await s2.req("POST", `/api/courses/${course}/enrol`); assert.equal((await s2.req("DELETE", `/api/courses/${course}/enrol`)).ok, true);
  assert.equal((await s2.req("GET", "/api/course-lessons/" + lessons.intro)).code, "not_enrolled");
});

test("progress, quizzes (server scoring, best score, attempts/day), completion once → event + notification; new lesson recomputes", async () => {
  let events = 0; H.app.ctx.bus.on("COURSE_COMPLETED", (e) => { if (e.course === course) events++; });
  let r = await s1.req("POST", `/api/course-lessons/${lessons.intro}/complete`); assert.equal(r.progress, 25);
  r = await s1.req("POST", `/api/course-lessons/${lessons.video}/complete`); assert.equal(r.progress, 50);
  assert.equal((await s1.req("POST", `/api/course-lessons/${lessons.quiz}/complete`)).status, 400, "quizzes count when passed");
  assert.equal((await s1.req("POST", `/api/course-lessons/${lessons.quiz}/quiz`, { answers: [2] })).status, 400, "answer all");
  const bad = await s1.req("POST", `/api/course-lessons/${lessons.quiz}/quiz`, { answers: [0, 0] });
  assert.equal(bad.score, 0); assert.equal(bad.passed, false); assert.equal(bad.results[0].answer, 2); assert.match(bad.results[0].explain, /const/); assert.equal(bad.progress, 50);
  const ok = await s1.req("POST", `/api/course-lessons/${lessons.quiz}/quiz`, { answers: [2, 0] });
  assert.equal(ok.score, 50); assert.equal(ok.passed, true, "pass mark 50"); assert.equal(ok.progress, 75); assert.equal(ok.attemptsLeft, 1);
  const again = await s1.req("POST", `/api/course-lessons/${lessons.quiz}/quiz`, { answers: [0, 0] });
  assert.equal(again.passed, false); assert.equal(again.progress, 75, "passing once is kept");
  assert.equal((await s1.req("POST", `/api/course-lessons/${lessons.quiz}/quiz`, { answers: [2, 1] })).code, "attempts");
  const best = await db().get("SELECT best_score, attempts FROM course_progress WHERE lesson_id=$1 AND user_id=$2", [lessons.quiz, s1.id]);
  assert.equal(Number(best.best_score), 50); assert.equal(Number(best.attempts), 3);
  const fin = await s1.req("POST", `/api/course-lessons/${lessons.fn}/complete`);
  assert.equal(fin.progress, 100); assert.equal(fin.completed, true); assert.equal(fin.completedNow, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(events, 1);
  const d = await s1.req("GET", "/api/courses/" + course);
  assert.equal(d.me.completed, true); assert.equal(d.me.completion.lessons, 4); assert.equal(d.me.completion.avgQuiz, 50);
  await s1.req("POST", `/api/course-lessons/${lessons.fn}/complete`, { undo: true }); await s1.req("POST", `/api/course-lessons/${lessons.fn}/complete`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(events, 1, "completion recorded once");
  assert.equal((await db().all("SELECT id FROM notifications WHERE user_id=$1 AND kind='course_completed'", [s1.id])).length, 1);
  // a new lesson: enrolled learners told; progress recomputed (completion kept)
  await T.req("POST", `/api/courses/${course}/lessons`, { moduleId: mods[1], title: "مشروع صغير", kind: "text", body: "ابنِ آلة حاسبة" });
  assert.equal((await db().all("SELECT id FROM notifications WHERE user_id=$1 AND kind='course_lesson'", [s1.id])).length, 1);
  const d2 = await s1.req("GET", "/api/courses/" + course); assert.equal(d2.me.progress, 80); assert.equal(d2.me.completed, true);
});

test("teacher view: learners + funnel; product access needs an entitlement; archive", async () => {
  await s2.req("POST", `/api/courses/${course}/enrol`); await s2.req("POST", `/api/course-lessons/${lessons.intro}/complete`);
  assert.equal((await s1.req("GET", `/api/courses/${course}/learners`)).status, 403);
  const lv = await T.req("GET", `/api/courses/${course}/learners`);
  assert.equal(lv.summary.learners, 2); assert.equal(lv.summary.completed, 1);
  assert.equal(lv.learners[0].handle, "co_s1"); assert.equal(lv.learners[0].quizAvg, 50);
  assert.equal(lv.funnel[0].done, 2); assert.equal(lv.funnel[0].pct, 100); assert.equal(lv.funnel.length, 5);
  // product access: an existing digital product of the author
  assert.equal((await T.req("PATCH", "/api/courses/" + course, { access: "product", listingId: "ml_none" })).status, 400);
  const at = new Date().toISOString();
  await db().run("INSERT INTO market_listings(id,seller_id,kind,title,description,price,currency,category,status,created_at,updated_at) VALUES('ml_co1',$1,'digital','حزمة الدورة','',3,'PI','education','active',$2,$2)", [T.id, at]);
  await db().run("INSERT INTO digital_products(listing_id,seller_id,ptype,files,created_at,updated_at) VALUES('ml_co1',$1,'course','[]',$2,$2)", [T.id, at]).catch(async (e) => { throw new Error("digital insert: " + e.message); });
  const pr = await T.req("PATCH", "/api/courses/" + course, { access: "product", listingId: "ml_co1" });
  assert.equal(pr.status, 200, pr.error); assert.equal(pr.course.access, "product");
  const lk = await out.req("GET", "/api/courses/" + course); assert.equal(lk.me.locked, true); assert.equal(lk.me.canEnrol, false);
  assert.equal((await out.req("POST", `/api/courses/${course}/enrol`)).code, "needs_purchase");
  await T.req("PATCH", "/api/courses/" + course, { access: "free" });
  assert.equal((await T.req("PATCH", "/api/courses/" + course, { status: "archived" })).course.status, "archived");
  assert.equal((await out.req("GET", "/api/courses/" + course)).status, 404);
});
