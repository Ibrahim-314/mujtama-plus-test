/* Formal quizzes «اختبارات» (phase 73) on phase 71 study groups, optionally tied to a phase 72 course.
 *  1. Authoring (group teachers / admins): question bank — single choice, multiple choice (all-or-nothing), true / false,
 *     short answer (accepted answers compared after Arabic normalisation: hamza forms, tashkeel, ta marbuta, case);
 *     points per question and an explanation. Settings: time limit, attempts, pass mark, shuffle questions / options,
 *     review policy (never | after submitting | after passing), opening window, certificate on pass. Questions lock once
 *     someone has submitted (duplicate to change them) so every score stays comparable.
 *  2. Taking: start (or resume) an attempt → questions in a per-attempt order with options shuffled, NEVER the answers; the
 *     server holds the deadline; answers autosave; submit scores on the server; an attempt past its deadline is
 *     auto-submitted with what was saved (30 s grace for the network).
 *  3. Results: score, pass, per-question review as the policy allows; a pass with «certificate on pass» issues a signed
 *     certificate (services/certs.js) and links it.
 *  4. Teacher view: attempts, average / pass rate, score distribution, per-question correct rate (item analysis), CSV. */
const crypto = require("node:crypto");
const { E, str, oneOf, id } = require("../lib/core");
const { normalize } = require("../lib/arabic");

const TYPES = { single: "اختيار واحد", multi: "اختيار متعدد", tf: "صح أو خطأ", short: "إجابة قصيرة" };
const REVIEW = { never: "لا تُعرض الإجابات", submit: "بعد التسليم", pass: "بعد النجاح" };
const MEMBER_ROLES = ["owner", "admin", "moderator", "member", "muted"];
const GRACE = 30e3, DAY = 864e5;

/** @param {any} ctx @param {{ now?: () => number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (t = clock()) => new Date(t).toISOString();
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const need = (c, m) => { if (!c) throw E.forbid(m); };
  const ms = (v) => (v ? Date.parse(v instanceof Date ? v.toISOString() : v) : null);
  const normAns = (s) => normalize(String(s || "")).toLowerCase().replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  /* ---------- access (phase 71 rules, as courses.js) ---------- */
  async function group(cid) {
    const g = await db.get("SELECT g.community_id, g.teachers, c.name, c.type FROM study_groups g JOIN communities c ON c.id=g.community_id WHERE g.community_id=$1", [cid]);
    if (!g) throw E.nf("مجموعة الدراسة غير موجودة"); g.teacherIds = parse(g.teachers, []); return g;
  }
  async function access(g, user) {
    const role = user ? (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [g.community_id, user.id]))?.role || null : null;
    const member = MEMBER_ROLES.includes(role), admin = ["owner", "admin", "moderator"].includes(role) || user?.role === "admin";
    return { member, manager: admin || (!!user && member && g.teacherIds.includes(user.id)), canView: member || g.type === "public" || user?.role === "admin" };
  }
  async function load(eid) { const x = await db.get("SELECT * FROM exams WHERE id=$1 AND status<>'deleted'", [String(eid)]); if (!x) throw E.nf("الاختبار غير موجود"); x.q = parse(x.questions, []); x.s = settingsOf(x.settings); return x; }
  async function ctxOf(eid, user) {
    const x = await load(eid), g = await group(x.community_id), a = await access(g, user);
    if (x.status === "draft" && !a.manager) throw E.nf("الاختبار غير منشور");
    if (!a.canView && !a.manager) throw E.nf("الاختبار لأعضاء المجموعة فقط");
    return { x, g, a };
  }
  const settingsOf = (v) => ({ timeLimit: 0, maxAttempts: 0, passPct: 70, shuffle: true, shuffleOptions: true, review: "submit", opensAt: null, closesAt: null, certificate: false, ...parse(v, {}) });

  /* ---------- 1. authoring ---------- */
  function readQuestions(qs) {
    if (!Array.isArray(qs) || !qs.length) throw E.bad("أضف سؤالاً واحداً على الأقل");
    if (qs.length > 100) throw E.bad("الحد الأقصى ١٠٠ سؤال");
    return qs.map((x, i) => {
      const n = i + 1, type = oneOf(x?.type, Object.keys(TYPES), "single");
      const q = { id: /^q[a-z0-9]{4,12}$/.test(String(x?.id || "")) ? x.id : "q" + crypto.randomBytes(4).toString("hex"), type, q: str(x?.q, 500, { required: true, min: 2 }), points: Math.max(1, Math.min(10, Math.round(+x?.points || 1))), explain: str(x?.explain, 600) || null };
      if (type === "tf") { q.options = ["صح", "خطأ"]; const a = x.answer === true || x.answer === 0 || x.answer === "0" || x.answer === "true" ? 0 : x.answer === false || x.answer === 1 || x.answer === "1" || x.answer === "false" ? 1 : null; if (a === null) throw E.bad(`السؤال ${n}: حدد صح أو خطأ`); q.answer = a; }
      else if (type === "short") { const acc = (Array.isArray(x.accepted) ? x.accepted : String(x.accepted || "").split(/[\n،,]/)).map((s) => str(String(s || "").trim(), 120)).filter(Boolean).slice(0, 10); if (!acc.length) throw E.bad(`السؤال ${n}: أضف إجابة مقبولة واحدة على الأقل`); q.accepted = acc; }
      else {
        const options = (Array.isArray(x.options) ? x.options : []).map((o) => str(String(o ?? "").trim(), 200)).filter(Boolean).slice(0, 8);
        if (options.length < 2) throw E.bad(`السؤال ${n}: خياران على الأقل`); q.options = options;
        if (type === "single") { const a = Math.round(+x.answer); if (!(a >= 0 && a < options.length)) throw E.bad(`السؤال ${n}: حدد الإجابة الصحيحة`); q.answer = a; }
        else { const a = [...new Set((Array.isArray(x.answer) ? x.answer : []).map((v) => Math.round(+v)).filter((v) => v >= 0 && v < options.length))].sort((p, r) => p - r); if (!a.length) throw E.bad(`السؤال ${n}: حدد إجابة صحيحة واحدة على الأقل`); q.answer = a; }
      }
      return q;
    });
  }
  function readSettings(b, prev = {}) {
    const s = { ...settingsOf(prev) }, x = b || {};
    if (x.timeLimit !== undefined) s.timeLimit = Math.max(0, Math.min(300, Math.round(+x.timeLimit || 0)));
    if (x.maxAttempts !== undefined) s.maxAttempts = Math.max(0, Math.min(20, Math.round(+x.maxAttempts || 0)));
    if (x.passPct !== undefined) s.passPct = Math.max(1, Math.min(100, Math.round(+x.passPct || 70)));
    for (const k of ["shuffle", "shuffleOptions", "certificate"]) if (x[k] !== undefined) s[k] = !!x[k];
    if (x.review !== undefined) s.review = oneOf(x.review, Object.keys(REVIEW), "submit");
    for (const k of ["opensAt", "closesAt"]) if (x[k] !== undefined) { if (!x[k]) s[k] = null; else { const t = Date.parse(x[k]); if (isNaN(t)) throw E.bad("موعد غير صالح"); s[k] = iso(t); } }
    if (s.opensAt && s.closesAt && Date.parse(s.closesAt) <= Date.parse(s.opensAt)) throw E.bad("موعد الإغلاق يجب أن يكون بعد موعد الفتح");
    return s;
  }
  async function create(user, b = {}) {
    if (!rl.hit("default", "exam:" + user.id)) throw E.rate();
    const g = await group(String(b.communityId || "")), a = await access(g, user); need(a.manager, "ينشئ الاختبارات معلمو المجموعة ومشرفوها فقط");
    let course = null;
    if (b.courseId) { course = await db.get("SELECT id FROM courses WHERE id=$1 AND community_id=$2 AND status<>'deleted'", [String(b.courseId), g.community_id]); if (!course) throw E.bad("الدورة ليست في هذه المجموعة"); }
    const qs = readQuestions(b.questions), s = readSettings(b.settings), xid = id("ex"), at = iso();
    await db.run("INSERT INTO exams(id,community_id,course_id,author,title,descr,questions,settings,status,attempts_n,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',0,$9,$9)",
      [xid, g.community_id, course?.id || null, user.id, str(b.title, 120, { required: true, min: 3 }), str(b.descr, 2000) || null, JSON.stringify(qs), JSON.stringify(s), at]);
    await ctx.audit?.("EXAM_CREATED", xid, g.community_id, user.id);
    return detail(user, xid);
  }
  async function update(user, eid, b = {}) {
    const { x, a } = await ctxOf(eid, user); need(a.manager, "لمعلمي المجموعة فقط");
    const set = {};
    if (b.title !== undefined) set.title = str(b.title, 120, { required: true, min: 3 });
    if (b.descr !== undefined) set.descr = str(b.descr, 2000) || null;
    if (b.questions !== undefined) {
      const sub = Number((await db.get("SELECT COUNT(*) n FROM exam_attempts WHERE exam_id=$1 AND status<>'in_progress'", [x.id])).n);
      if (sub) throw Object.assign(E.conflict("الأسئلة مقفلة بعد أول تسليم حتى تبقى الدرجات قابلة للمقارنة — أنشئ نسخة لتعديلها"), { code: "locked" });
      set.questions = JSON.stringify(readQuestions(b.questions));
    }
    if (b.settings !== undefined) set.settings = JSON.stringify(readSettings(b.settings, x.s));
    if (b.status !== undefined) { set.status = oneOf(b.status, ["draft", "published", "closed"], x.status); if (set.status === "published" && !x.published_at) set.published_at = iso(); }
    const keys = Object.keys(set); if (!keys.length) throw E.bad("لا تغييرات");
    await db.run(`UPDATE exams SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map((k) => set[k]), iso(), x.id]);
    return detail(user, x.id);
  }
  async function duplicate(user, eid) {
    const { x, a } = await ctxOf(eid, user); need(a.manager, "لمعلمي المجموعة فقط");
    const nid = id("ex"), at = iso();
    await db.run("INSERT INTO exams(id,community_id,course_id,author,title,descr,questions,settings,status,attempts_n,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',0,$9,$9)", [nid, x.community_id, x.course_id, user.id, (x.title + " (نسخة)").slice(0, 120), x.descr, x.questions, x.settings, at]);
    return detail(user, nid);
  }
  async function remove(user, eid) { const { x, a } = await ctxOf(eid, user); need(a.manager, "لمعلمي المجموعة فقط"); await db.run("UPDATE exams SET status='deleted', updated_at=$1 WHERE id=$2", [iso(), x.id]); return { ok: true }; }

  /* ---------- 2. taking ---------- */
  const shuffled = (n, on) => { const a = Array.from({ length: n }, (_, i) => i); if (on) for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function windowState(x) {
    const t = clock();
    if (x.status === "closed") return { open: false, why: "أُغلق الاختبار" };
    if (x.s.opensAt && t < Date.parse(x.s.opensAt)) return { open: false, why: "لم يُفتح الاختبار بعد", opensAt: x.s.opensAt };
    if (x.s.closesAt && t > Date.parse(x.s.closesAt)) return { open: false, why: "انتهت فترة الاختبار" };
    return { open: x.status === "published", why: x.status === "published" ? null : "الاختبار غير منشور" };
  }
  /** the questions as the learner sees them: attempt order, shuffled options, no answers */
  function present(x, ord) {
    return ord.map((o, i) => { const q = x.q.find((qq) => qq.id === o.id); if (!q) return null; return { id: q.id, n: i + 1, type: q.type, typeLabel: TYPES[q.type], q: q.q, points: q.points, options: q.options ? o.opt.map((k) => q.options[k]) : null }; }).filter(Boolean);
  }
  async function attemptsOf(xid, uid) { return db.all("SELECT * FROM exam_attempts WHERE exam_id=$1 AND user_id=$2 ORDER BY started_at", [xid, uid]); }
  async function expire(at, x) { // auto-submit past the deadline with the saved answers
    if (at.status !== "in_progress" || !at.due_at || clock() <= ms(at.due_at) + GRACE) return at;
    await score(at, x, parse(at.answers, {}), "expired");
    return db.get("SELECT * FROM exam_attempts WHERE id=$1", [at.id]);
  }
  async function start(user, eid) {
    const { x, a } = await ctxOf(eid, user);
    if (!a.member && !a.manager && x.status === "published") { const g = await group(x.community_id); if (g.type !== "public") throw E.forbid("للأعضاء فقط"); }
    const w = windowState(x); if (!w.open && !a.manager) throw E.bad(w.why);
    const all = await attemptsOf(x.id, user.id);
    for (let i = 0; i < all.length; i++) all[i] = await expire(all[i], x);
    const open = all.find((t) => t.status === "in_progress"); if (open) return attemptView(user, open.id);
    if (x.s.maxAttempts && all.length >= x.s.maxAttempts) throw Object.assign(E.bad(`استنفدت المحاولات المسموحة (${x.s.maxAttempts})`), { code: "attempts" });
    if (!rl.hit("default", "examstart:" + user.id)) throw E.rate();
    const qo = shuffled(x.q.length, x.s.shuffle), ord = qo.map((i) => { const q = x.q[i]; return { id: q.id, opt: q.options ? shuffled(q.options.length, x.s.shuffleOptions && q.type !== "tf") : null }; });
    const t = clock(), due = x.s.timeLimit ? t + x.s.timeLimit * 60e3 : null;
    const closes = x.s.closesAt ? Date.parse(x.s.closesAt) : null;
    const aid = id("ea");
    await db.run("INSERT INTO exam_attempts(id,exam_id,user_id,ord,answers,started_at,due_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,'in_progress')", [aid, x.id, user.id, JSON.stringify(ord), "{}", iso(t), due || closes ? iso(Math.min(due || Infinity, closes || Infinity)) : null]);
    await db.run("UPDATE exams SET attempts_n=attempts_n+1 WHERE id=$1", [x.id]);
    return attemptView(user, aid);
  }
  function readAnswers(x, raw) {
    const out = {}, b = raw && typeof raw === "object" ? raw : {};
    for (const q of x.q) {
      const v = b[q.id]; if (v === undefined || v === null || v === "") continue;
      if (q.type === "short") out[q.id] = String(v).slice(0, 200);
      else if (q.type === "multi") out[q.id] = [...new Set((Array.isArray(v) ? v : [v]).map((n) => Math.round(+n)).filter((n) => n >= 0 && n < q.options.length))];
      else { const n = Math.round(+v); if (n >= 0 && n < q.options.length) out[q.id] = n; }
    }
    return out;
  }
  /* answers arrive in DISPLAY order of options; map them back to the bank's option index */
  function toBank(x, ord, ans) {
    const out = {};
    for (const o of ord) { const q = x.q.find((qq) => qq.id === o.id), v = ans[o.id]; if (!q || v === undefined) continue; out[o.id] = q.type === "short" ? v : Array.isArray(v) ? v.map((k) => o.opt[k]).sort((p, r) => p - r) : o.opt[v]; }
    return out;
  }
  async function own(user, aid) { const at = await db.get("SELECT * FROM exam_attempts WHERE id=$1", [String(aid)]); if (!at || at.user_id !== user.id) throw E.nf("المحاولة غير موجودة"); return at; }
  async function save(user, aid, b = {}) {
    let at = await own(user, aid); const x = await load(at.exam_id); at = await expire(at, x);
    if (at.status !== "in_progress") throw Object.assign(E.conflict("انتهى وقت المحاولة وسُلّمت تلقائياً"), { code: "closed" });
    const ord = parse(at.ord, []), ans = { ...parse(at.answers, {}), ...toBank(x, ord, readAnswers(x, b.answers)) };
    await db.run("UPDATE exam_attempts SET answers=$1 WHERE id=$2 AND status='in_progress'", [JSON.stringify(ans), at.id]);
    return { saved: Object.keys(ans).length, at: iso() };
  }
  function grade(x, ans) {
    let pts = 0, max = 0; const res = {};
    for (const q of x.q) {
      max += q.points; const v = ans[q.id]; let ok = false;
      if (q.type === "short") ok = v !== undefined && q.accepted.some((a) => normAns(a) === normAns(v));
      else if (q.type === "multi") ok = Array.isArray(v) && v.length === q.answer.length && v.every((k, i) => k === q.answer[i]);
      else ok = v === q.answer;
      if (ok) pts += q.points; res[q.id] = ok ? 1 : 0;
    }
    return { pts, max, pct: max ? Math.round((pts / max) * 100) : 0, res };
  }
  async function score(at, x, ans, status = "submitted") {
    const g = grade(x, ans), passed = g.pct >= x.s.passPct;
    const r = await db.run("UPDATE exam_attempts SET answers=$1, submitted_at=$2, score=$3, points=$4, max_points=$5, passed=$6, results=$7, status=$8 WHERE id=$9 AND status='in_progress'", [JSON.stringify(ans), iso(), g.pct, g.pts, g.max, passed ? 1 : 0, JSON.stringify(g.res), status, at.id]);
    if (r.changes && passed && x.s.certificate && ctx.services.certs) {
      const gname = (await db.get("SELECT name FROM communities WHERE id=$1", [x.community_id]))?.name || "مجتمع بلس";
      const t = await db.get("SELECT name FROM users WHERE id=$1", [x.author]);
      await ctx.services.certs.issue("exam", x.id, at.user_id, { title: x.title, issuer: gname, community: x.community_id, issuerUser: x.author, details: { score: g.pct, passPct: x.s.passPct, questions: x.q.length, teacher: t?.name || null, attempt: at.id } }).catch((e) => ctx.log?.error?.("exam certificate failed", { err: e.message }));
    }
    return g;
  }
  async function submit(user, aid, b = {}) {
    let at = await own(user, aid); const x = await load(at.exam_id); at = await expire(at, x);
    if (at.status === "in_progress") {
      const ord = parse(at.ord, []);
      const fresh = b.answers ? toBank(x, ord, readAnswers(x, b.answers)) : {};
      await score(at, x, { ...parse(at.answers, {}), ...fresh });
    }
    return attemptView(user, at.id);
  }
  async function attemptView(user, aid) {
    let at = await own(user, aid); const x = await load(at.exam_id); at = await expire(at, x);
    const ord = parse(at.ord, []), ans = parse(at.answers, {}), questions = present(x, ord);
    const exam = { id: x.id, title: x.title, passPct: x.s.passPct, timeLimit: x.s.timeLimit, review: x.s.review, certificate: x.s.certificate, groupId: x.community_id, courseId: x.course_id };
    // the learner's saved answers in DISPLAY order
    const shown = {}; for (const o of ord) { const v = ans[o.id]; if (v === undefined) continue; shown[o.id] = Array.isArray(v) ? v.map((k) => o.opt.indexOf(k)) : o.opt && typeof v === "number" ? o.opt.indexOf(v) : v; }
    if (at.status === "in_progress") return { exam, attempt: { id: at.id, status: at.status, startedAt: iso(ms(at.started_at)), dueAt: at.due_at ? iso(ms(at.due_at)) : null, serverNow: iso() }, questions, answers: shown };
    const passed = !!Number(at.passed), reveal = x.s.review === "submit" || (x.s.review === "pass" && passed);
    const res = parse(at.results, {});
    const review = questions.map((q) => { const bank = x.q.find((b) => b.id === q.id), o = ord.find((oo) => oo.id === q.id), out = { id: q.id, correct: !!res[q.id] };
      if (reveal) { out.explain = bank.explain; out.answer = bank.type === "short" ? bank.accepted : bank.type === "multi" ? bank.answer.map((k) => o.opt.indexOf(k)) : o.opt ? o.opt.indexOf(bank.answer) : bank.answer; }
      return out; });
    const cert = passed && x.s.certificate ? await db.get("SELECT code, status FROM certificates WHERE kind='exam' AND ref_id=$1 AND holder_id=$2", [x.id, user.id]) : null;
    const all = await attemptsOf(x.id, user.id);
    return { exam, attempt: { id: at.id, status: at.status, expired: at.status === "expired", startedAt: iso(ms(at.started_at)), submittedAt: at.submitted_at ? iso(ms(at.submitted_at)) : null, score: Number(at.score), points: Number(at.points), maxPoints: Number(at.max_points), passed, correct: Object.values(res).filter(Boolean).length },
      questions, answers: shown, review, reveal, certificate: cert ? { code: cert.code, status: cert.status, url: "/cert/" + cert.code } : null,
      attemptsLeft: x.s.maxAttempts ? Math.max(0, x.s.maxAttempts - all.length) : null };
  }

  /* ---------- pages ---------- */
  const examClient = (x, extra = {}) => ({ id: x.id, title: x.title, descr: x.descr || "", status: x.status, groupId: x.community_id, courseId: x.course_id || null, questions: x.q.length, points: x.q.reduce((t, q) => t + q.points, 0), settings: x.s, attempts: Number(x.attempts_n || 0), updatedAt: x.updated_at, href: `#/exam/${x.id}`, ...extra });
  async function detail(user, eid) {
    const { x, g, a } = await ctxOf(eid, user);
    const mine = user ? await attemptsOf(x.id, user.id) : [];
    for (let i = 0; i < mine.length; i++) mine[i] = await expire(mine[i], x);
    const done = mine.filter((t) => t.status !== "in_progress"), best = done.reduce((m, t) => Math.max(m, Number(t.score)), -1);
    const course = x.course_id ? await db.get("SELECT id, title FROM courses WHERE id=$1", [x.course_id]) : null;
    const cert = user ? await db.get("SELECT code, status FROM certificates WHERE kind='exam' AND ref_id=$1 AND holder_id=$2", [x.id, user.id]) : null;
    const w = windowState(x), lock = a.manager ? Number((await db.get("SELECT COUNT(*) n FROM exam_attempts WHERE exam_id=$1 AND status<>'in_progress'", [x.id])).n) > 0 : undefined;
    return { exam: examClient(x, { group: { id: g.community_id, name: g.name }, course: course ? { id: course.id, title: course.title } : null, bank: a.manager ? x.q : undefined, locked: lock }), types: TYPES, reviewPolicies: REVIEW, window: w,
      me: { manager: a.manager, member: a.member, attempts: done.map((t) => ({ id: t.id, score: Number(t.score), passed: !!Number(t.passed), at: iso(ms(t.submitted_at || t.started_at)), expired: t.status === "expired" })), inProgress: mine.find((t) => t.status === "in_progress")?.id || null,
        best: best >= 0 ? best : null, passed: done.some((t) => Number(t.passed)), attemptsLeft: x.s.maxAttempts ? Math.max(0, x.s.maxAttempts - mine.length) : null, certificate: cert ? { code: cert.code, status: cert.status } : null, canStart: !!user && (w.open || a.manager) && (!x.s.maxAttempts || mine.length < x.s.maxAttempts || !!mine.find((t) => t.status === "in_progress")) } };
  }
  async function list(user, q = {}) {
    const where = ["e.status='published'"], args = [];
    if (q.group) { args.push(String(q.group)); where.push(`e.community_id=$${args.length}`); }
    if (q.course) { args.push(String(q.course)); where.push(`e.course_id=$${args.length}`); }
    const rows = await db.all(`SELECT e.*, c.name gname, c.type gtype FROM exams e JOIN communities c ON c.id=e.community_id WHERE ${where.join(" AND ")} ORDER BY e.published_at DESC LIMIT 200`, args);
    const memberOf = user ? new Set((await db.all("SELECT community FROM memberships WHERE user_id=$1 AND role IN ('owner','admin','moderator','member','muted')", [user.id])).map((r) => r.community)) : new Set();
    const vis = rows.filter((e) => e.gtype === "public" || memberOf.has(e.community_id) || user?.role === "admin").map((e) => { e.q = parse(e.questions, []); e.s = settingsOf(e.settings); return e; });
    const best = user && vis.length ? await db.all(`SELECT exam_id, MAX(score) s, MAX(passed) p, COUNT(*) n FROM exam_attempts WHERE user_id=$1 AND status<>'in_progress' AND exam_id IN (${vis.map((_, i) => "$" + (i + 2)).join(",")}) GROUP BY exam_id`, [user.id, ...vis.map((e) => e.id)]) : [];
    let teaching = [];
    if (user && q.group) { const g = await group(String(q.group)).catch(() => null); if (g && (await access(g, user)).manager) teaching = (await db.all("SELECT * FROM exams WHERE community_id=$1 AND status IN ('draft','published','closed') ORDER BY updated_at DESC", [g.community_id])).map((e) => { e.q = parse(e.questions, []); e.s = settingsOf(e.settings); return examClient(e); }); }
    else if (user) teaching = (await db.all("SELECT * FROM exams WHERE author=$1 AND status IN ('draft','published','closed') ORDER BY updated_at DESC LIMIT 50", [user.id])).map((e) => { e.q = parse(e.questions, []); e.s = settingsOf(e.settings); return examClient(e); });
    return { exams: vis.map((e) => { const b = best.find((r) => r.exam_id === e.id); return examClient(e, { group: { id: e.community_id, name: e.gname }, mine: b ? { best: Number(b.s), passed: !!Number(b.p), attempts: Number(b.n) } : null, window: windowState(e) }); }), teaching };
  }

  /* ---------- 4. teacher view ---------- */
  async function results(user, eid, csv = false) {
    const { x, a } = await ctxOf(eid, user); need(a.manager, "لمعلمي المجموعة فقط");
    const raw = await db.all("SELECT t.*, u.name, u.handle, u.color FROM exam_attempts t JOIN users u ON u.id=t.user_id WHERE t.exam_id=$1 ORDER BY t.started_at DESC LIMIT 5000", [x.id]);
    for (let i = 0; i < raw.length; i++) if (raw[i].status === "in_progress") { const e = await expire(raw[i], x); raw[i] = { ...raw[i], ...e }; }
    const done = raw.filter((t) => t.status !== "in_progress");
    const people = [...new Set(done.map((t) => t.user_id))];
    const bestOf = people.map((uid) => done.filter((t) => t.user_id === uid).sort((p, r) => Number(r.score) - Number(p.score))[0]);
    const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, n: 0 })); for (const t of bestOf) buckets[Math.min(9, Math.floor(Number(t.score) / 10))].n++;
    const items = x.q.map((q, i) => { const rs = done.map((t) => parse(t.results, {})[q.id]).filter((v) => v !== undefined); return { id: q.id, n: i + 1, q: q.q, type: q.type, typeLabel: TYPES[q.type], answered: rs.length, correctPct: rs.length ? Math.round((rs.filter(Boolean).length / rs.length) * 100) : null }; });
    const rows = raw.map((t) => ({ id: t.id, user: { id: t.user_id, name: t.name, handle: t.handle, color: t.color }, status: t.status, score: t.score === null || t.score === undefined ? null : Number(t.score), passed: !!Number(t.passed), startedAt: iso(ms(t.started_at)), submittedAt: t.submitted_at ? iso(ms(t.submitted_at)) : null, minutes: t.submitted_at ? Math.max(1, Math.round((ms(t.submitted_at) - ms(t.started_at)) / 60e3)) : null }));
    const summary = { attempts: done.length, learners: people.length, passed: bestOf.filter((t) => Number(t.passed)).length, avg: bestOf.length ? Math.round(bestOf.reduce((s, t) => s + Number(t.score), 0) / bestOf.length) : null, inProgress: raw.filter((t) => t.status === "in_progress").length };
    if (csv) { const q = (v) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; }; return "\ufeff" + ["الاسم,المعرّف,الحالة,الدرجة,ناجح,بدأ,سلّم,الدقائق", ...rows.map((r) => [r.user.name, "@" + r.user.handle, r.status, r.score, r.passed ? "نعم" : "لا", r.startedAt, r.submittedAt || "", r.minutes || ""].map(q).join(","))].join("\n"); }
    return { exam: examClient(x), summary, distribution: buckets, items: items.sort((p, r) => (p.correctPct ?? 101) - (r.correctPct ?? 101)), attempts: rows };
  }

  /* ---------- routes ---------- */
  R.get("/api/exams", async (req) => list(req.user, req.query));
  R.post("/api/exams", A(async (req) => create(req.user, req.body || {})));
  R.get("/api/exams/:id", async (req) => detail(req.user, req.params.id));
  R.patch("/api/exams/:id", A(async (req) => update(req.user, req.params.id, req.body || {})));
  R.del("/api/exams/:id", A(async (req) => remove(req.user, req.params.id)));
  R.post("/api/exams/:id/duplicate", A(async (req) => duplicate(req.user, req.params.id)));
  R.post("/api/exams/:id/start", A(async (req) => start(req.user, req.params.id)));
  R.get("/api/exams/:id/results", A(async (req, res) => {
    if (req.query.format !== "csv") return results(req.user, req.params.id);
    const body = await results(req.user, req.params.id, true);
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="exam-${req.params.id}.csv"`, "Cache-Control": "no-store" }); res.end(body); return ctx.STREAM;
  }));
  R.get("/api/exam-attempts/:id", A(async (req) => attemptView(req.user, req.params.id)));
  R.put("/api/exam-attempts/:id/answers", A(async (req) => save(req.user, req.params.id, req.body || {})));
  R.post("/api/exam-attempts/:id/submit", A(async (req) => submit(req.user, req.params.id, req.body || {})));
  return { create, update, duplicate, remove, detail, list, start, save, submit, attemptView, results, grade, TYPES, REVIEW, DAY };
};
