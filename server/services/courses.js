/* Courses and lessons with progress tracking «دورات ودروس» (phase 72). Built on phase 71 study groups: a course belongs to a
 * study group (a phase 16 community); the group's teachers / admins author it, members enrol (anyone signed in for a public
 * group). Nothing about groups, membership or moderation is duplicated.
 *  1. Authoring: course → modules → lessons (text in light Markdown rendered by richtext.js, a video link (https; opened in
 *     a new tab — the CSP allows no third-party frames), or a quiz: single-choice questions with an explanation and a pass
 *     mark). Reorder modules / lessons, move lessons between modules, draft ↔ published, archive.
 *  2. Access: free, or «product» = an existing phase 58 digital product of the author (an active entitlement is required;
 *     usable only when the digital store is enabled — no new Pi payment path). Teachers always have access.
 *  3. Learning: enrol / leave, lesson pages with previous / next, «mark as done», quizzes scored on the server (answers are
 *     never sent before an attempt), best score kept, attempts limited per day, resume where you left off, progress % per
 *     course and per module.
 *  4. Completion: every published lesson done (quizzes passed) → completed_at + snapshot (lessons, average quiz score,
 *     minutes) → bus COURSE_COMPLETED (phase 73 certificates subscribe) + course_completed notification.
 *  5. Teacher view: learners with progress, last activity, quiz average, completion; per-lesson completion funnel; enrolled
 *     learners are told about new lessons in a published course (course_lesson). */
const { E, str, oneOf, id } = require("../lib/core");

const LEVELS = { beginner: "مبتدئ", intermediate: "متوسط", advanced: "متقدم", all: "كل المستويات" };
const KINDS = { text: "درس مقروء", video: "فيديو", quiz: "اختبار قصير" };
const MEMBER_ROLES = ["owner", "admin", "moderator", "member", "muted"];
const DAY = 864e5;

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl, bus } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = () => new Date(clock()).toISOString();
  const MAX_ATTEMPTS = Math.max(1, +(env.COURSE_QUIZ_ATTEMPTS_PER_DAY || 10));
  const notify = async (uid, kind, ref) => { try { await ctx.services.notify?.notify(uid, kind, { ref }); } catch { /* best effort */ } };
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const need = (c, m) => { if (!c) throw E.forbid(m); };

  /* ---------- group access (phase 71 rules) ---------- */
  async function group(cid) {
    const g = await db.get("SELECT g.community_id, g.mode, g.teachers, c.name, c.type FROM study_groups g JOIN communities c ON c.id=g.community_id WHERE g.community_id=$1", [cid]);
    if (!g) throw E.nf("مجموعة الدراسة غير موجودة");
    g.teacherIds = parse(g.teachers, []); return g;
  }
  async function access(g, user) {
    const role = user ? (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [g.community_id, user.id]))?.role || null : null;
    const member = MEMBER_ROLES.includes(role), admin = ["owner", "admin", "moderator"].includes(role) || user?.role === "admin";
    const teacher = !!user && member && g.teacherIds.includes(user.id);
    return { member, admin, teacher, manager: admin || teacher, canView: member || g.type === "public" || user?.role === "admin" };
  }
  async function load(courseId) { const c = await db.get("SELECT * FROM courses WHERE id=$1 AND status<>'deleted'", [String(courseId)]); if (!c) throw E.nf("الدورة غير موجودة"); return c; }
  async function ctxOf(courseId, user) {
    const c = await load(courseId), g = await group(c.community_id), a = await access(g, user);
    if (c.status !== "published" && !a.manager) throw E.nf("الدورة غير منشورة");
    if (!a.canView && !a.manager) throw E.nf("الدورة لأعضاء المجموعة فقط");
    return { c, g, a };
  }
  async function entitled(c, user) {
    if (c.access !== "product" || !c.listing_id) return true;
    if (!user) return false;
    const e = await db.get("SELECT e.id FROM digital_entitlements e JOIN market_orders o ON o.id=e.order_id WHERE e.buyer_id=$1 AND e.listing_id=$2 AND e.status='active' AND o.status NOT IN ('refunded','cancelled')", [user.id, c.listing_id]).catch(() => null);
    return !!e;
  }

  /* ---------- 1. authoring ---------- */
  function readCourse(b, partial) {
    const o = {};
    if (!partial || b.title !== undefined) o.title = str(b.title, 100, { required: true, min: 3 });
    if (!partial || b.subtitle !== undefined) o.subtitle = str(b.subtitle, 160) || null;
    if (!partial || b.descr !== undefined) o.descr = str(b.descr, 4000) || null;
    if (!partial || b.level !== undefined) o.level = oneOf(b.level, Object.keys(LEVELS), "all");
    if (!partial || b.cover !== undefined) { const c = b.cover ? String(b.cover) : ""; if (c && !/^\/(media|uploads)\/[\w./-]{1,200}$/.test(c)) throw E.bad("صورة الغلاف غير صالحة"); o.cover = c || null; }
    if (!partial || b.passPct !== undefined) o.pass_pct = Math.max(0, Math.min(100, Math.round(+(b.passPct ?? 70))));
    return o;
  }
  async function readAccess(user, b, o) {
    if (b.access === undefined) return;
    o.access = oneOf(b.access, ["free", "product"], "free"); o.listing_id = null;
    if (o.access === "product") {
      const l = await db.get("SELECT l.id, l.seller_id FROM market_listings l JOIN digital_products d ON d.listing_id=l.id WHERE l.id=$1 AND l.status<>'removed'", [String(b.listingId || "")]).catch(() => null);
      if (!l || l.seller_id !== user.id) throw E.bad("اختر منتجاً رقمياً من منتجاتك في المتجر");
      o.listing_id = l.id;
    }
  }
  async function create(user, b = {}) {
    if (!rl.hit("default", "course:" + user.id)) throw E.rate();
    const g = await group(String(b.communityId || "")), a = await access(g, user); need(a.manager, "ينشئ الدورات معلمو المجموعة ومشرفوها فقط");
    const o = readCourse(b, false); await readAccess(user, b, o);
    const cid = id("co"), at = iso();
    await db.run("INSERT INTO courses(id,community_id,author,title,subtitle,descr,level,cover,status,access,listing_id,pass_pct,enrolled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,0,$12,$12)",
      [cid, g.community_id, user.id, o.title, o.subtitle, o.descr, o.level, o.cover, o.access || "free", o.listing_id || null, o.pass_pct, at]);
    await db.run("INSERT INTO course_modules(id,course_id,title,position,created_at) VALUES($1,$2,$3,1,$4)", [id("cm"), cid, str(b.firstModule, 80) || "الوحدة الأولى", at]);
    await ctx.audit?.("COURSE_CREATED", cid, g.community_id, user.id);
    return detail(user, cid);
  }
  async function manage(courseId, user) { const x = await ctxOf(courseId, user); need(x.a.manager, "لمعلمي المجموعة فقط"); return x; }
  async function update(user, courseId, b = {}) {
    const { c } = await manage(courseId, user), o = readCourse(b, true); await readAccess(user, b, o);
    if (b.status !== undefined) {
      o.status = oneOf(b.status, ["draft", "published", "archived"], c.status);
      if (o.status === "published") {
        const n = Number((await db.get("SELECT COUNT(*) n FROM course_lessons WHERE course_id=$1 AND status='published'", [c.id])).n);
        if (!n) throw E.bad("أضف درساً واحداً على الأقل قبل النشر");
        if (!c.published_at) o.published_at = iso();
      }
    }
    const keys = Object.keys(o); if (!keys.length) throw E.bad("لا تغييرات");
    await db.run(`UPDATE courses SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map((k) => o[k]), iso(), c.id]);
    return detail(user, c.id);
  }
  async function addModule(user, courseId, b = {}) {
    const { c } = await manage(courseId, user);
    const n = Number((await db.get("SELECT COUNT(*) n FROM course_modules WHERE course_id=$1", [c.id])).n); if (n >= 40) throw E.bad("الحد الأقصى ٤٠ وحدة");
    await db.run("INSERT INTO course_modules(id,course_id,title,position,created_at) VALUES($1,$2,$3,$4,$5)", [id("cm"), c.id, str(b.title, 80, { required: true, min: 2 }), n + 1, iso()]);
    return outline(user, c.id);
  }
  async function editModule(user, mid, b = {}) {
    const m = await db.get("SELECT * FROM course_modules WHERE id=$1", [mid]); if (!m) throw E.nf();
    await manage(m.course_id, user);
    if (b.delete) {
      const n = Number((await db.get("SELECT COUNT(*) n FROM course_lessons WHERE module_id=$1 AND status<>'deleted'", [mid])).n);
      if (n) throw E.bad("انقل دروس الوحدة أو احذفها أولاً");
      await db.run("DELETE FROM course_modules WHERE id=$1", [mid]); await renumberModules(m.course_id);
    } else await db.run("UPDATE course_modules SET title=$1 WHERE id=$2", [str(b.title, 80, { required: true, min: 2 }), mid]);
    return outline(user, m.course_id);
  }
  async function renumberModules(cid) { const ms = await db.all("SELECT id FROM course_modules WHERE course_id=$1 ORDER BY position, created_at", [cid]); for (let i = 0; i < ms.length; i++) await db.run("UPDATE course_modules SET position=$1 WHERE id=$2", [i + 1, ms[i].id]); }
  async function renumberLessons(mid) { const ls = await db.all("SELECT id FROM course_lessons WHERE module_id=$1 AND status<>'deleted' ORDER BY position, created_at", [mid]); for (let i = 0; i < ls.length; i++) await db.run("UPDATE course_lessons SET position=$1 WHERE id=$2", [i + 1, ls[i].id]); }
  function readQuiz(q) {
    const qs = Array.isArray(q?.questions) ? q.questions : null;
    if (!qs || !qs.length) throw E.bad("أضف سؤالاً واحداً على الأقل");
    if (qs.length > 30) throw E.bad("الحد الأقصى ٣٠ سؤالاً");
    return { questions: qs.map((x, i) => {
      const options = (Array.isArray(x?.options) ? x.options : []).map((o) => str(String(o ?? ""), 160)).filter(Boolean).slice(0, 6);
      if (options.length < 2) throw E.bad(`السؤال ${i + 1}: خياران على الأقل`);
      const answer = Math.round(+x.answer); if (!(answer >= 0 && answer < options.length)) throw E.bad(`السؤال ${i + 1}: حدد الإجابة الصحيحة`);
      return { q: str(x.q, 300, { required: true, min: 2 }), options, answer, explain: str(x.explain, 400) || null };
    }) };
  }
  function readLesson(b, partial, prev) {
    const o = {};
    if (!partial || b.title !== undefined) o.title = str(b.title, 120, { required: true, min: 2 });
    const kind = b.kind !== undefined ? oneOf(b.kind, Object.keys(KINDS), null) : prev?.kind || "text";
    if (!kind) throw E.bad("نوع الدرس غير صالح");
    if (!partial || b.kind !== undefined) o.kind = kind;
    if (!partial || b.body !== undefined) o.body = String(b.body ?? "").slice(0, 30000) || null;
    if (!partial || b.videoUrl !== undefined) { const u = str(b.videoUrl, 400); if (u && !/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(u)) throw E.bad("رابط الفيديو يجب أن يبدأ بـ https://"); o.video_url = u || null; }
    if (!partial || b.minutes !== undefined) o.minutes = Math.max(1, Math.min(600, Math.round(+b.minutes || 5)));
    if (!partial || b.quiz !== undefined || b.kind !== undefined) { if (kind === "quiz") { if (b.quiz !== undefined || !prev?.quiz) o.quiz = JSON.stringify(readQuiz(b.quiz)); } else if (!partial || b.kind !== undefined) o.quiz = null; }
    if (!partial || b.passPct !== undefined) o.pass_pct = b.passPct === undefined || b.passPct === null || b.passPct === "" ? null : Math.max(0, Math.min(100, Math.round(+b.passPct)));
    if (!partial || b.status !== undefined) o.status = oneOf(b.status, ["draft", "published"], "published");
    const fin = { kind, body: o.body ?? prev?.body, video: o.video_url ?? prev?.video_url };
    if (kind === "text" && !fin.body) throw E.bad("اكتب محتوى الدرس");
    if (kind === "video" && !fin.video) throw E.bad("أضف رابط الفيديو");
    return o;
  }
  async function addLesson(user, courseId, b = {}) {
    const { c } = await manage(courseId, user);
    const m = await db.get("SELECT * FROM course_modules WHERE id=$1 AND course_id=$2", [String(b.moduleId || ""), c.id]); if (!m) throw E.bad("اختر الوحدة");
    const total = Number((await db.get("SELECT COUNT(*) n FROM course_lessons WHERE course_id=$1 AND status<>'deleted'", [c.id])).n); if (total >= 300) throw E.bad("الحد الأقصى ٣٠٠ درس");
    const o = readLesson(b, false), lid = id("cl"), at = iso();
    const pos = Number((await db.get("SELECT COUNT(*) n FROM course_lessons WHERE module_id=$1 AND status<>'deleted'", [m.id])).n) + 1;
    await db.run("INSERT INTO course_lessons(id,course_id,module_id,title,kind,body,video_url,minutes,position,quiz,pass_pct,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)",
      [lid, c.id, m.id, o.title, o.kind, o.body, o.video_url, o.minutes, pos, o.quiz || null, o.pass_pct, o.status, at]);
    await db.run("UPDATE courses SET updated_at=$1 WHERE id=$2", [at, c.id]);
    if (c.status === "published" && o.status === "published") { for (const e of await db.all("SELECT user_id FROM course_enrolments WHERE course_id=$1 AND status IN ('active','completed') LIMIT 5000", [c.id])) await notify(e.user_id, "course_lesson", c.id); await recomputeAll(c.id); }
    return { lesson: { id: lid }, outline: (await outline(user, c.id)).outline };
  }
  async function editLesson(user, lid, b = {}) {
    const l = await db.get("SELECT * FROM course_lessons WHERE id=$1 AND status<>'deleted'", [lid]); if (!l) throw E.nf("الدرس غير موجود");
    const { c } = await manage(l.course_id, user);
    if (b.delete) { await db.run("UPDATE course_lessons SET status='deleted', updated_at=$1 WHERE id=$2", [iso(), lid]); await renumberLessons(l.module_id); await recomputeAll(c.id); return outline(user, c.id); }
    const o = readLesson(b, true, l);
    if (b.moduleId && b.moduleId !== l.module_id) {
      const m = await db.get("SELECT id FROM course_modules WHERE id=$1 AND course_id=$2", [String(b.moduleId), c.id]); if (!m) throw E.bad("الوحدة غير موجودة");
      o.module_id = m.id; o.position = Number((await db.get("SELECT COUNT(*) n FROM course_lessons WHERE module_id=$1 AND status<>'deleted'", [m.id])).n) + 1;
    }
    const keys = Object.keys(o); if (!keys.length) throw E.bad("لا تغييرات");
    await db.run(`UPDATE course_lessons SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map((k) => o[k]), iso(), lid]);
    if (o.module_id) { await renumberLessons(l.module_id); await renumberLessons(o.module_id); }
    if (o.status !== undefined) await recomputeAll(c.id);
    return outline(user, c.id);
  }
  async function move(user, courseId, b = {}) {
    const { c } = await manage(courseId, user);
    const dir = b.dir === "up" ? -1 : b.dir === "down" ? 1 : 0; if (!dir) throw E.bad("حدد الاتجاه");
    if (b.moduleId) {
      const ms = await db.all("SELECT id FROM course_modules WHERE course_id=$1 ORDER BY position", [c.id]), i = ms.findIndex((m) => m.id === b.moduleId), j = i + dir;
      if (i < 0) throw E.nf(); if (j >= 0 && j < ms.length) { await db.run("UPDATE course_modules SET position=$1 WHERE id=$2", [j + 1, ms[i].id]); await db.run("UPDATE course_modules SET position=$1 WHERE id=$2", [i + 1, ms[j].id]); }
    } else if (b.lessonId) {
      const l = await db.get("SELECT * FROM course_lessons WHERE id=$1 AND course_id=$2 AND status<>'deleted'", [b.lessonId, c.id]); if (!l) throw E.nf();
      const ls = await db.all("SELECT id FROM course_lessons WHERE module_id=$1 AND status<>'deleted' ORDER BY position", [l.module_id]), i = ls.findIndex((x) => x.id === l.id), j = i + dir;
      if (j >= 0 && j < ls.length) { await db.run("UPDATE course_lessons SET position=$1 WHERE id=$2", [j + 1, ls[i].id]); await db.run("UPDATE course_lessons SET position=$1 WHERE id=$2", [i + 1, ls[j].id]); }
      else { // past the edge of its module → into the neighbouring module
        const ms = await db.all("SELECT id FROM course_modules WHERE course_id=$1 ORDER BY position", [c.id]), mi = ms.findIndex((m) => m.id === l.module_id), nm = ms[mi + dir];
        if (nm) { const pos = dir < 0 ? Number((await db.get("SELECT COUNT(*) n FROM course_lessons WHERE module_id=$1 AND status<>'deleted'", [nm.id])).n) + 1 : 0; await db.run("UPDATE course_lessons SET module_id=$1, position=$2 WHERE id=$3", [nm.id, pos, l.id]); await renumberLessons(l.module_id); await renumberLessons(nm.id); }
      }
    } else throw E.bad("حدد الوحدة أو الدرس");
    return outline(user, c.id);
  }
  async function outline(user, courseId, mine = null) {
    const c = await load(courseId);
    const mods = await db.all("SELECT * FROM course_modules WHERE course_id=$1 ORDER BY position", [c.id]);
    const ls = await db.all("SELECT id, module_id, title, kind, minutes, position, status, pass_pct FROM course_lessons WHERE course_id=$1 AND status<>'deleted' ORDER BY position", [c.id]);
    const prog = user ? await db.all("SELECT lesson_id, done, best_score, attempts FROM course_progress WHERE course_id=$1 AND user_id=$2", [c.id, user.id]) : [];
    return { outline: mods.map((m) => {
      const items = ls.filter((l) => l.module_id === m.id).map((l) => { const p = prog.find((x) => x.lesson_id === l.id); return { id: l.id, title: l.title, kind: l.kind, kindLabel: KINDS[l.kind], minutes: Number(l.minutes), status: l.status, done: !!Number(p?.done), score: p?.best_score ?? null }; });
      const pub = items.filter((x) => x.status === "published");
      return { id: m.id, title: m.title, position: Number(m.position), lessons: mine === false ? pub : items, done: pub.filter((x) => x.done).length, total: pub.length };
    }) };
  }

  /* ---------- 3. learning ---------- */
  async function published(cid) { return db.all("SELECT l.id, l.kind, l.minutes, l.module_id FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE l.course_id=$1 AND l.status='published' ORDER BY m.position, l.position", [cid]); }
  async function recompute(c, uid) {
    const ls = await published(c.id); if (!ls.length) return null;
    const done = await db.all(`SELECT lesson_id, best_score FROM course_progress WHERE course_id=$1 AND user_id=$2 AND done=1 AND lesson_id IN (${ph(ls.map((l) => l.id), 2)})`, [c.id, uid, ...ls.map((l) => l.id)]);
    const pct = Math.round((done.length / ls.length) * 100);
    const e = await db.get("SELECT * FROM course_enrolments WHERE course_id=$1 AND user_id=$2", [c.id, uid]); if (!e) return null;
    let completed = !!e.completed_at;
    if (pct === 100 && !e.completed_at) {
      const quizzes = done.filter((d) => ls.find((l) => l.id === d.lesson_id)?.kind === "quiz");
      const snap = { lessons: ls.length, quizzes: quizzes.length, avgQuiz: quizzes.length ? Math.round(quizzes.reduce((t, q) => t + Number(q.best_score || 0), 0) / quizzes.length) : null, minutes: ls.reduce((t, l) => t + Number(l.minutes), 0), title: c.title };
      const r = await db.run("UPDATE course_enrolments SET progress=100, status='completed', completed_at=$1, completion=$2 WHERE course_id=$3 AND user_id=$4 AND completed_at IS NULL", [iso(), JSON.stringify(snap), c.id, uid]);
      if (r.changes) { completed = true; bus?.emit?.("COURSE_COMPLETED", { course: c.id, community: c.community_id, user: uid, snapshot: snap }); await notify(uid, "course_completed", c.id); await ctx.audit?.("COURSE_COMPLETED", c.id, uid, uid); }
    } else await db.run("UPDATE course_enrolments SET progress=$1 WHERE course_id=$2 AND user_id=$3", [pct, c.id, uid]);
    return { progress: pct, completed, done: done.length, total: ls.length };
  }
  async function recomputeAll(cid) { const c = await load(cid); for (const e of await db.all("SELECT user_id FROM course_enrolments WHERE course_id=$1 LIMIT 5000", [cid])) await recompute(c, e.user_id); }
  async function enrol(user, courseId) {
    const { c, a } = await ctxOf(courseId, user);
    if (c.status !== "published") throw E.bad("الدورة غير منشورة بعد");
    if (!(await entitled(c, user)) && !a.manager) throw Object.assign(E.forbid("هذه الدورة ضمن منتج رقمي مدفوع — اشترِه من المتجر أولاً"), { code: "needs_purchase", details: { listingId: c.listing_id } });
    const r = await db.run("INSERT INTO course_enrolments(course_id,user_id,status,enrolled_at,progress) VALUES($1,$2,'active',$3,0) ON CONFLICT (course_id, user_id) DO UPDATE SET status=CASE WHEN course_enrolments.completed_at IS NULL THEN 'active' ELSE 'completed' END", [c.id, user.id, iso()]);
    await db.run("UPDATE courses SET enrolled=(SELECT COUNT(*) FROM course_enrolments WHERE course_id=$1 AND status<>'left') WHERE id=$1", [c.id]);
    await recompute(c, user.id);
    return detail(user, c.id, r);
  }
  async function leave(user, courseId) {
    const c = await load(courseId);
    await db.run("UPDATE course_enrolments SET status='left' WHERE course_id=$1 AND user_id=$2 AND completed_at IS NULL", [c.id, user.id]);
    await db.run("UPDATE courses SET enrolled=(SELECT COUNT(*) FROM course_enrolments WHERE course_id=$1 AND status<>'left') WHERE id=$1", [c.id]);
    return { ok: true };
  }
  async function enrolment(c, uid) { return uid ? db.get("SELECT * FROM course_enrolments WHERE course_id=$1 AND user_id=$2 AND status<>'left'", [c.id, uid]) : null; }
  async function lesson(user, lid) {
    const l = await db.get("SELECT * FROM course_lessons WHERE id=$1 AND status<>'deleted'", [lid]); if (!l) throw E.nf("الدرس غير موجود");
    const { c, a } = await ctxOf(l.course_id, user);
    if (l.status !== "published" && !a.manager) throw E.nf("الدرس غير منشور");
    const e = await enrolment(c, user?.id);
    if (!e && !a.manager) throw Object.assign(E.forbid("سجّل في الدورة لتبدأ الدروس"), { code: "not_enrolled" });
    const ls = await published(c.id), i = ls.findIndex((x) => x.id === l.id);
    const titles = ls.length ? await db.all(`SELECT id, title, kind FROM course_lessons WHERE id IN (${ph(ls.map((x) => x.id))})`, ls.map((x) => x.id)) : [];
    const pick = (x) => (x ? { id: x.id, title: titles.find((t) => t.id === x.id)?.title, kind: x.kind } : null);
    const p = user ? await db.get("SELECT * FROM course_progress WHERE lesson_id=$1 AND user_id=$2", [l.id, user.id]) : null;
    if (e) await db.run("UPDATE course_enrolments SET last_lesson_id=$1, last_at=$2 WHERE course_id=$3 AND user_id=$4", [l.id, iso(), c.id, user.id]);
    const quiz = l.kind === "quiz" ? parse(l.quiz, { questions: [] }) : null;
    const reveal = a.manager || !!Number(p?.done);
    const mod = await db.get("SELECT title FROM course_modules WHERE id=$1", [l.module_id]);
    return { course: { id: c.id, title: c.title, passPct: Number(c.pass_pct) }, module: { id: l.module_id, title: mod?.title || "" },
      lesson: { id: l.id, title: l.title, kind: l.kind, kindLabel: KINDS[l.kind], body: l.body || "", videoUrl: l.video_url || null, videoHost: l.video_url ? (() => { try { return new URL(l.video_url).hostname.replace(/^www\./, ""); } catch { return null; } })() : null, minutes: Number(l.minutes), status: l.status,
        passPct: l.pass_pct ?? Number(c.pass_pct), quiz: quiz ? { questions: quiz.questions.map((q) => ({ q: q.q, options: q.options, ...(reveal ? { answer: q.answer, explain: q.explain } : {}) })) } : null },
      index: i + 1, total: ls.length, prev: pick(ls[i - 1]), next: pick(ls[i + 1]),
      me: { enrolled: !!e, manager: a.manager, done: !!Number(p?.done), bestScore: p?.best_score ?? null, attempts: Number(p?.attempts || 0), progress: e ? Number(e.progress) : null } };
  }
  async function progressRow(c, l, uid, patch) {
    const p = await db.get("SELECT * FROM course_progress WHERE lesson_id=$1 AND user_id=$2", [l.id, uid]), at = iso();
    if (!p) await db.run("INSERT INTO course_progress(lesson_id,user_id,course_id,done,best_score,attempts,done_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [l.id, uid, c.id, patch.done ? 1 : 0, patch.best ?? null, patch.attempts || 0, patch.done ? at : null, at]);
    else await db.run("UPDATE course_progress SET done=$1, best_score=$2, attempts=$3, done_at=COALESCE(done_at, $4), updated_at=$5 WHERE lesson_id=$6 AND user_id=$7",
      [patch.done || Number(p.done) ? 1 : 0, patch.best !== undefined ? Math.max(Number(p.best_score ?? -1), patch.best) : p.best_score, patch.attempts !== undefined ? patch.attempts : Number(p.attempts || 0), patch.done ? at : null, at, l.id, uid]);
  }
  async function learnable(user, lid) {
    const l = await db.get("SELECT * FROM course_lessons WHERE id=$1 AND status='published'", [lid]); if (!l) throw E.nf("الدرس غير موجود");
    const c = await load(l.course_id); if (c.status !== "published") throw E.bad("الدورة غير منشورة");
    const e = await enrolment(c, user.id); if (!e) throw Object.assign(E.forbid("سجّل في الدورة أولاً"), { code: "not_enrolled" });
    return { l, c };
  }
  async function complete(user, lid, b = {}) {
    const { l, c } = await learnable(user, lid);
    if (l.kind === "quiz") throw E.bad("يُحتسب الاختبار عند النجاح فيه");
    if (b.undo) await db.run("UPDATE course_progress SET done=0, done_at=NULL, updated_at=$1 WHERE lesson_id=$2 AND user_id=$3", [iso(), l.id, user.id]);
    else await progressRow(c, l, user.id, { done: true });
    const st = await recompute(c, user.id);
    return { ok: true, ...st, completedNow: !!st?.completed && !b.undo };
  }
  async function quiz(user, lid, b = {}) {
    const { l, c } = await learnable(user, lid);
    if (l.kind !== "quiz") throw E.bad("ليس اختباراً");
    const since = new Date(clock() - DAY).toISOString();
    const n = Number((await db.get("SELECT COUNT(*) n FROM course_attempts WHERE lesson_id=$1 AND user_id=$2 AND at > $3", [l.id, user.id, since])).n);
    if (n >= MAX_ATTEMPTS) throw Object.assign(E.bad(`استنفدت محاولاتك اليوم (${MAX_ATTEMPTS})؛ راجع الدرس وحاول غداً`), { code: "attempts" });
    const qz = parse(l.quiz, { questions: [] }), ans = Array.isArray(b.answers) ? b.answers : [];
    if (ans.length !== qz.questions.length || ans.some((x) => x === null || x === undefined || x === "")) throw E.bad("أجب عن جميع الأسئلة");
    const results = qz.questions.map((q, i) => ({ correct: Number(ans[i]) === q.answer, chosen: Number(ans[i]), answer: q.answer, explain: q.explain || null }));
    const score = Math.round((results.filter((r) => r.correct).length / results.length) * 100);
    const pass = l.pass_pct ?? Number(c.pass_pct), passed = score >= pass;
    await db.run("INSERT INTO course_attempts(id,lesson_id,course_id,user_id,answers,score,passed,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id("ca"), l.id, c.id, user.id, JSON.stringify(ans.map(Number)), score, passed ? 1 : 0, iso()]);
    const prev = await db.get("SELECT attempts FROM course_progress WHERE lesson_id=$1 AND user_id=$2", [l.id, user.id]);
    await progressRow(c, l, user.id, { done: passed, best: score, attempts: Number(prev?.attempts || 0) + 1 });
    const st = await recompute(c, user.id);
    return { score, passed, passPct: pass, results, attemptsLeft: MAX_ATTEMPTS - n - 1, ...st };
  }

  /* ---------- pages ---------- */
  const courseClient = (c, extra = {}) => ({ id: c.id, title: c.title, subtitle: c.subtitle || "", level: c.level, levelLabel: LEVELS[c.level] || LEVELS.all, cover: c.cover || null, status: c.status, access: c.access, listingId: c.listing_id || null, passPct: Number(c.pass_pct), enrolled: Number(c.enrolled || 0), groupId: c.community_id, updatedAt: c.updated_at, publishedAt: c.published_at || null, href: `#/course/${c.id}`, ...extra });
  async function detail(user, courseId) {
    const { c, g, a } = await ctxOf(courseId, user);
    const ol = (await outline(user, c.id, a.manager ? null : false)).outline;
    const ls = await published(c.id);
    const e = await enrolment(c, user?.id);
    const author = await db.get("SELECT name, handle, color FROM users WHERE id=$1", [c.author]);
    let resume = null;
    if (e) { const flat = ol.flatMap((m) => m.lessons.filter((x) => x.status === "published")); const last = flat.find((x) => x.id === e.last_lesson_id); resume = (last && !last.done ? last : flat.find((x) => !x.done)) || null; if (resume) resume = { id: resume.id, title: resume.title }; }
    const ok = await entitled(c, user);
    return { course: courseClient(c, { descr: c.descr || "", lessons: ls.length, minutes: ls.reduce((t, l) => t + Number(l.minutes), 0), quizzes: ls.filter((l) => l.kind === "quiz").length, author: author ? { name: author.name, handle: author.handle, color: author.color } : null }),
      group: { id: g.community_id, name: g.name, mode: g.mode }, outline: ol,
      me: { enrolled: !!e, progress: e ? Number(e.progress) : 0, completed: !!e?.completed_at, completedAt: e?.completed_at || null, completion: e?.completion ? parse(e.completion, null) : null, resume, manager: a.manager, member: a.member,
        canEnrol: !!user && !e && c.status === "published" && (ok || a.manager), locked: !ok && !a.manager } };
  }
  async function list(user, q = {}) {
    const mineIds = user ? await db.all("SELECT e.*, c.title, c.subtitle, c.level, c.cover, c.community_id, c.status cstatus, c.access, c.listing_id, c.pass_pct, c.enrolled, c.updated_at, c.published_at, c.id cid, c.author FROM course_enrolments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=$1 AND e.status<>'left' AND c.status='published' ORDER BY COALESCE(e.last_at, e.enrolled_at) DESC LIMIT 50", [user.id]) : [];
    const learning = [];
    for (const e of mineIds) {
      const last = e.last_lesson_id ? await db.get("SELECT id, title FROM course_lessons WHERE id=$1 AND status='published'", [e.last_lesson_id]) : null;
      learning.push(courseClient({ ...e, id: e.cid, status: e.cstatus }, { progress: Number(e.progress), completed: !!e.completed_at, lastAt: e.last_at || e.enrolled_at, resume: last && !e.completed_at ? { id: last.id, title: last.title } : null }));
    }
    const where = ["c.status='published'"], args = [];
    if (q.group) { args.push(String(q.group)); where.push(`c.community_id=$${args.length}`); }
    if (q.level && LEVELS[q.level]) { args.push(q.level); where.push(`c.level=$${args.length}`); }
    const rows = await db.all(`SELECT c.*, cm.name gname, cm.type gtype FROM courses c JOIN communities cm ON cm.id=c.community_id WHERE ${where.join(" AND ")} ORDER BY c.enrolled DESC, c.published_at DESC LIMIT 200`, args);
    const memberOf = user ? new Set((await db.all("SELECT community FROM memberships WHERE user_id=$1 AND role IN ('owner','admin','moderator','member','muted')", [user.id])).map((r) => r.community)) : new Set();
    const text = q.q ? String(q.q).slice(0, 60).toLowerCase() : "";
    const vis = rows.filter((c) => (c.gtype === "public" || memberOf.has(c.community_id) || user?.role === "admin") && (!text || `${c.title} ${c.subtitle || ""} ${c.descr || ""}`.toLowerCase().includes(text)));
    const counts = vis.length ? await db.all(`SELECT course_id, COUNT(*) n, SUM(minutes) m FROM course_lessons WHERE status='published' AND course_id IN (${ph(vis.map((c) => c.id))}) GROUP BY course_id`, vis.map((c) => c.id)) : [];
    let teaching = [];
    if (user && q.group) { const g = await group(String(q.group)).catch(() => null); if (g && (await access(g, user)).manager) teaching = (await db.all("SELECT * FROM courses WHERE community_id=$1 AND status IN ('draft','published','archived') ORDER BY updated_at DESC", [g.community_id])).map((c) => courseClient(c)); }
    else if (user) teaching = (await db.all("SELECT * FROM courses WHERE author=$1 AND status IN ('draft','published') ORDER BY updated_at DESC LIMIT 50", [user.id])).map((c) => courseClient(c));
    return { learning, teaching, courses: vis.map((c) => { const k = counts.find((x) => x.course_id === c.id); return courseClient(c, { group: { id: c.community_id, name: c.gname }, lessons: Number(k?.n || 0), minutes: Number(k?.m || 0), mine: !!learning.find((x) => x.id === c.id) }); }), levels: LEVELS };
  }

  /* ---------- 5. teacher view ---------- */
  async function learners(user, courseId) {
    const { c } = await manage(courseId, user);
    const ls = await published(c.id);
    const rows = await db.all("SELECT e.*, u.name, u.handle, u.color FROM course_enrolments e JOIN users u ON u.id=e.user_id WHERE e.course_id=$1 AND e.status<>'left' ORDER BY e.progress DESC, e.enrolled_at LIMIT 2000", [c.id]);
    const prog = await db.all("SELECT lesson_id, user_id, done, best_score FROM course_progress WHERE course_id=$1", [c.id]);
    const titles = ls.length ? await db.all(`SELECT id, title, kind FROM course_lessons WHERE id IN (${ph(ls.map((l) => l.id))})`, ls.map((l) => l.id)) : [];
    const funnel = ls.map((l, i) => { const t = titles.find((x) => x.id === l.id); const done = prog.filter((p) => p.lesson_id === l.id && Number(p.done) && rows.some((r) => r.user_id === p.user_id)).length; const sc = prog.filter((p) => p.lesson_id === l.id && p.best_score !== null && p.best_score !== undefined); return { id: l.id, index: i + 1, title: t?.title, kind: l.kind, done, pct: rows.length ? Math.round((done / rows.length) * 100) : 0, avgScore: sc.length ? Math.round(sc.reduce((s, p) => s + Number(p.best_score), 0) / sc.length) : null }; });
    const quizIds = ls.filter((l) => l.kind === "quiz").map((l) => l.id);
    return { course: courseClient(c), summary: { learners: rows.length, completed: rows.filter((r) => r.completed_at).length, avgProgress: rows.length ? Math.round(rows.reduce((t, r) => t + Number(r.progress), 0) / rows.length) : 0, active7d: rows.filter((r) => r.last_at && Date.parse(r.last_at) > clock() - 7 * DAY).length },
      learners: rows.map((r) => { const qs = prog.filter((p) => p.user_id === r.user_id && quizIds.includes(p.lesson_id) && p.best_score !== null && p.best_score !== undefined); return { id: r.user_id, name: r.name, handle: r.handle, color: r.color, progress: Number(r.progress), completed: !!r.completed_at, completedAt: r.completed_at || null, lastAt: r.last_at || r.enrolled_at, enrolledAt: r.enrolled_at, quizAvg: qs.length ? Math.round(qs.reduce((t, p) => t + Number(p.best_score), 0) / qs.length) : null }; }),
      funnel };
  }

  /* ---------- routes ---------- */
  R.get("/api/courses", async (req) => list(req.user, req.query));
  R.post("/api/courses", A(async (req) => create(req.user, req.body || {})));
  R.get("/api/courses/:id", async (req) => detail(req.user, req.params.id));
  R.patch("/api/courses/:id", A(async (req) => update(req.user, req.params.id, req.body || {})));
  R.get("/api/courses/:id/outline", A(async (req) => { await manage(req.params.id, req.user); return outline(req.user, req.params.id); }));
  R.post("/api/courses/:id/modules", A(async (req) => addModule(req.user, req.params.id, req.body || {})));
  R.post("/api/courses/:id/lessons", A(async (req) => addLesson(req.user, req.params.id, req.body || {})));
  R.post("/api/courses/:id/move", A(async (req) => move(req.user, req.params.id, req.body || {})));
  R.post("/api/courses/:id/enrol", A(async (req) => enrol(req.user, req.params.id)));
  R.del("/api/courses/:id/enrol", A(async (req) => leave(req.user, req.params.id)));
  R.get("/api/courses/:id/learners", A(async (req) => learners(req.user, req.params.id)));
  R.patch("/api/course-modules/:id", A(async (req) => editModule(req.user, req.params.id, req.body || {})));
  R.del("/api/course-modules/:id", A(async (req) => editModule(req.user, req.params.id, { delete: true })));
  R.get("/api/course-lessons/:id", async (req) => lesson(req.user, req.params.id));
  R.patch("/api/course-lessons/:id", A(async (req) => editLesson(req.user, req.params.id, req.body || {})));
  R.del("/api/course-lessons/:id", A(async (req) => editLesson(req.user, req.params.id, { delete: true })));
  R.post("/api/course-lessons/:id/complete", A(async (req) => complete(req.user, req.params.id, req.body || {})));
  R.post("/api/course-lessons/:id/quiz", A(async (req) => quiz(req.user, req.params.id, req.body || {})));
  return { create, update, detail, list, addModule, editModule, addLesson, editLesson, move, outline, enrol, leave, lesson, complete, quiz, learners, LEVELS, KINDS };
};
