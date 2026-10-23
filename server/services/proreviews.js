/* Professional reputation & verified reviews «السمعة المهنية والتقييمات الموثّقة» (phase 80). No keys, no payments.
 * (The phase 7 `reputation` service is the community trust score; this one is about work.)
 *  1. Verified only: a review needs a real engagement — a completed contract (phase 78, both parties) or a completed team /
 *     project (phase 79, members other than viewers who were in it at least PR_TEAM_MIN_DAYS (3) days and with at least
 *     one finished task). Both sides review each other within PR_WINDOW_DAYS (30) of completion: overall 1–5, three
 *     criteria that depend on the role (client → worker: quality, communication, deadlines; worker → client: clear
 *     requirements, communication, prompt review; teammate: contribution, collaboration, deadlines) and an optional text.
 *  2. Double-blind: a review stays hidden from the reviewee until the other side has reviewed too or the window closes,
 *     so nobody answers a rating with a rating. The author can edit until it is revealed.
 *  3. Anti-abuse: no self reviews; one review per engagement, author and reviewee (unique); blocked pairs cannot review;
 *     the aggregate counts only the latest review per author → reviewee pair (repeated small jobs between the same two
 *     accounts do not stack), and not reviews from accounts younger than PR_MIN_ACCOUNT_DAYS (7) or from engagements
 *     shorter than PR_MIN_ENGAGEMENT_HOURS (24) (shown, marked «لا يُحتسب»). Reports (PR_FLAG_REPORTS = 3 open reports
 *     take a review down until staff decide); staff hide / restore / dismiss (audited); staff also see reciprocal pairs.
 *  4. The reviewee may publish one public response per review (editable, removable).
 *  5. Skill endorsements: only from verified collaborators (a completed contract or team in common), only for skills on the
 *     member's professional profile, up to PR_ENDORSE_MAX (5) per endorser and member, withdrawable.
 *  6. Badges (computed): first finished job, active professional (5), trusted expert (20 + 4.5), top rated (4.7 over 5
 *     counted reviews), on time (deadlines 4.5 over 3 as a worker), team player (3 completed teams), verified skills
 *     (3+ endorsements).
 *  7. Shown with the CV (#/cv/:handle, its visibility rules), on talent-directory cards and to employers on job
 *     applications; the full page is #/reviews/u/:handle. A minor's reputation follows the minors rules of the CV (never
 *     public: the member, followers and staff only); minors review and are reviewed only through unpaid contracts and
 *     teams they could join anyway. */
const { E, str, oneOf, id } = require("../lib/core");
const { normalize } = require("../lib/arabic");

const ROLES = { client: "عميل", worker: "منفّذ", teammate: "زميل فريق" };
/** criteria by the AUTHOR's role (what the author rates in the other side) */
const CRIT = {
  client: ["جودة العمل", "التواصل", "الالتزام بالمواعيد"],
  worker: ["وضوح المتطلبات", "التواصل", "سرعة المراجعة والاعتماد"],
  teammate: ["جودة المساهمة", "التعاون والتواصل", "الالتزام بالمواعيد"]
};
/** how the REVIEWEE appears in a review: rated by a client → as a worker */
const AS = { client: "worker", worker: "client", teammate: "teammate" };
const AS_LABEL = { worker: "كمنفّذ", client: "كعميل", teammate: "في الفرق" };
const REASONS = { fake: "تقييم غير حقيقي أو متبادل مصطنع", abusive: "إساءة أو تشهير", private: "يكشف بيانات شخصية", offtopic: "لا علاقة له بالعمل", other: "سبب آخر" };
const FLAG_TXT = { young_account: "حساب المقيّم جديد", quick: "تعامل قصير جداً", repeat: "تقييم سابق من نفس العضو" };

/** @param {any} ctx @param {{ now?: () => number, env?: Record<string,string|undefined>, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const ms = (v) => (v ? new Date(v).getTime() || 0 : 0);
  const isoOf = (v) => (v ? new Date(v).toISOString() : null);
  const DAY = 864e5;
  const WINDOW = +(env.PR_WINDOW_DAYS || 30) * DAY, TEAM_MIN = +(env.PR_TEAM_MIN_DAYS || 3) * DAY, MIN_ACC = +(env.PR_MIN_ACCOUNT_DAYS || 7) * DAY;
  const MIN_ENG = +(env.PR_MIN_ENGAGEMENT_HOURS || 24) * 36e5, FLAG_AT = +(env.PR_FLAG_REPORTS || 3), ENDORSE_MAX = +(env.PR_ENDORSE_MAX || 5);
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref, actor = null) => { if (!uid || uid === actor) return; try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : status === 404 ? E.nf(msg) : E.bad(msg), { code });
  const parse = (v, d) => { try { return v ? (typeof v === "string" ? JSON.parse(v) : v) : d; } catch { return d; } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const risky = (text) => { try { return (ctx.services.jobs?.risks?.(text) || []).some((r) => ["fee", "offplatform", "phrase", "contact"].includes(r.key)); } catch { return false; } };
  const star = (v) => { const n = Math.round(Number(v)); if (!(n >= 1 && n <= 5)) throw fail(400, "bad_rating", "اختر تقييماً من 1 إلى 5"); return n; };
  const round1 = (x) => Math.round(x * 10) / 10;

  async function blockedBetween(a, b) {
    if (!a || !b || a === b) return false;
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    const pa = parse(ua?.prefs, {}), pb = parse(ub?.prefs, {});
    if ((pa.blocked || []).includes(b) || (pb.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  async function usersOf(ids) { const a = [...new Set(ids.filter(Boolean))]; const m = new Map(); if (!a.length) return m; for (const u of await db.all(`SELECT id, name, handle, color, avatar, verified, created_at FROM users WHERE id IN (${ph(a)})`, a)) m.set(u.id, u); return m; }
  const pubU = (u) => (u ? { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null, verified: u.verified || null } : null);
  const userByHandle = (h) => db.get("SELECT id, name, handle, color, avatar, verified, role, status, created_at FROM users WHERE LOWER(handle)=LOWER($1) AND status='active'", [String(h || "").replace(/^@/, "")]);

  /* ---------- engagements ---------- */
  async function teamDoneTasks(tid) { return Number((await db.get("SELECT COUNT(*) n FROM wt_tasks WHERE team_id=$1 AND status='done'", [tid]).catch(() => null))?.n || 0); }
  /** every completed engagement of `uid` with the people it may review: [{kind, ref, title, role, closesAt, quick, others:[uid]}] */
  async function engagements(uid) {
    const out = [];
    const cs = (await ctx.services.contracts?.completedFor?.(uid).catch(() => [])) || [];
    for (const c of cs) {
      const role = c.client_id === uid ? "client" : "worker", done = ms(c.completed_at || c.closed_at || c.updated_at);
      out.push({ kind: "contract", ref: c.id, title: c.title, role, doneAt: done, closesAt: done + WINDOW, quick: done - ms(c.created_at) < MIN_ENG, paid: !!Number(c.paid), others: [role === "client" ? c.worker_id : c.client_id] });
    }
    const ts = (await ctx.services.teams?.completedFor?.(uid).catch(() => [])) || [];
    for (const t of ts) {
      const closed = ms(t.closed_at || t.updated_at);
      const ms_ = await db.all("SELECT user_id, role, joined_at FROM wt_members WHERE team_id=$1", [t.id]);
      const ok = (m) => m && m.role !== "viewer" && closed - ms(m.joined_at) >= TEAM_MIN;
      const me = ms_.find((m) => m.user_id === uid); if (!ok(me) || !(await teamDoneTasks(t.id))) continue;
      const others = ms_.filter((m) => m.user_id !== uid && ok(m)).map((m) => m.user_id); if (!others.length) continue;
      out.push({ kind: "team", ref: t.id, title: t.name, role: "teammate", doneAt: closed, closesAt: closed + WINDOW, quick: false, paid: false, others });
    }
    return out;
  }
  /** shared completed engagements between two members (any time) — the basis of "verified collaborator" */
  async function sharedWith(a, b) { return (await engagements(a)).filter((e) => e.others.includes(b)); }

  /* ---------- review rows ---------- */
  const revealed = (r, now = clock()) => !!r.revealed_at || ms(r.closes_at) <= now;
  const row = (rid) => db.get("SELECT * FROM pr_reviews WHERE id=$1", [String(rid)]);
  /** which reviews count toward the aggregate (latest per author → reviewee pair, clean flags, published + revealed) */
  function countedSet(rows, now = clock()) {
    const latest = new Map();
    for (const r of rows) { if (r.status !== "published" || !revealed(r, now)) continue; const k = r.author_id; const p = latest.get(k); if (!p || ms(r.created_at) > ms(p.created_at)) latest.set(k, r); }
    const set = new Set(); for (const r of latest.values()) if (!parse(r.flags, []).length) set.add(r.id);
    return set;
  }
  function client(r, viewer, us, extra = {}) {
    const self = viewer && viewer.id === r.target_id, author = viewer && viewer.id === r.author_id, staff = viewer?.role === "admin";
    const crit = CRIT[r.role] || CRIT.teammate;
    return {
      id: r.id, kind: r.kind, ref: r.ref_id, role: r.role, roleLabel: ROLES[r.role], asLabel: AS_LABEL[AS[r.role]],
      author: pubU(us.get(r.author_id)), target: pubU(us.get(r.target_id)), overall: Number(r.overall),
      criteria: [r.c1, r.c2, r.c3].map((v, i) => (v === null || v === undefined ? null : { label: crit[i], value: Number(v) })).filter(Boolean),
      body: r.body || null, warn: !!Number(r.warn) && !author, status: r.status, revealed: revealed(r), closesAt: isoOf(r.closes_at),
      response: r.response ? { body: r.response, at: isoOf(r.response_at) } : null,
      counted: extra.counted, notCounted: extra.counted === false ? parse(r.flags, []).map((f) => FLAG_TXT[f] || f).concat(extra.repeat ? [FLAG_TXT.repeat] : []) : undefined,
      staffNote: author || staff ? r.staff_note || null : undefined, createdAt: isoOf(r.created_at), updatedAt: isoOf(r.updated_at),
      can: { edit: !!author && !revealed(r) && r.status !== "hidden", respond: !!self && revealed(r) && r.status === "published", report: !!viewer && !author && r.status === "published" && revealed(r) }
    };
  }

  /* ---------- aggregate ---------- */
  async function summaryOf(uid, rowsIn) {
    const rows = rowsIn || (await db.all("SELECT * FROM pr_reviews WHERE target_id=$1 AND status='published'", [uid]));
    const now = clock(), cnt = countedSet(rows, now), counted = rows.filter((r) => cnt.has(r.id));
    const avg = (arr) => (arr.length ? round1(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    const dist = [5, 4, 3, 2, 1].map((s) => ({ stars: s, n: counted.filter((r) => Number(r.overall) === s).length }));
    const as = {}; for (const k of ["worker", "client", "teammate"]) { const g = counted.filter((r) => AS[r.role] === k); if (g.length) as[k] = { label: AS_LABEL[k], avg: avg(g.map((r) => Number(r.overall))), n: g.length, criteria: (CRIT[g[0].role] || []).map((label, i) => ({ label, avg: avg(g.map((r) => r["c" + (i + 1)]).filter((v) => v !== null && v !== undefined).map(Number)) })) }; }
    const contracts = Number((await db.get("SELECT COUNT(*) n FROM contracts WHERE status='completed' AND (client_id=$1 OR worker_id=$1)", [uid]).catch(() => null))?.n || 0);
    const teams = Number((await db.get("SELECT COUNT(*) n FROM wt_teams t JOIN wt_members m ON m.team_id=t.id WHERE m.user_id=$1 AND t.status='completed' AND m.role<>'viewer'", [uid]).catch(() => null))?.n || 0);
    const asWorker = counted.filter((r) => r.role === "client");
    const skills = new Set((await db.all("SELECT norm FROM pro_skills WHERE user_id=$1", [uid]).catch(() => [])).map((s) => s.norm));
    const ends = (await db.all("SELECT norm, MIN(name) name, COUNT(*) n FROM pr_endorsements WHERE user_id=$1 GROUP BY norm ORDER BY COUNT(*) DESC, MIN(name)", [uid])).filter((e) => skills.has(e.norm)).map((e) => ({ key: e.norm, name: e.name, n: Number(e.n) }));
    const score = avg(counted.map((r) => Number(r.overall))), n = counted.length, done = contracts + teams;
    const timely = avg(asWorker.map((r) => r.c3).filter((v) => v !== null && v !== undefined).map(Number));
    const badges = [];
    if (done >= 20 && score !== null && score >= 4.5) badges.push({ key: "trusted", label: "خبير موثوق", hint: "20 عملاً منجزاً أو أكثر بتقييم 4.5 فأعلى" });
    else if (done >= 5) badges.push({ key: "active", label: "محترف نشط", hint: "5 أعمال منجزة أو أكثر" });
    else if (done >= 1) badges.push({ key: "first", label: "أول عمل منجز", hint: "أنجز عقداً أو مشروعاً موثّقاً" });
    if (n >= 5 && score >= 4.7) badges.push({ key: "top", label: "تقييم ممتاز", hint: "معدّل 4.7 فأعلى من 5 تقييمات محتسبة على الأقل" });
    if (asWorker.length >= 3 && timely !== null && timely >= 4.5) badges.push({ key: "ontime", label: "ملتزم بالمواعيد", hint: "معدّل الالتزام بالمواعيد 4.5 فأعلى كمنفّذ" });
    if (teams >= 3) badges.push({ key: "team", label: "روح الفريق", hint: "3 مشاريع جماعية مكتملة أو أكثر" });
    const verified = ends.filter((e) => e.n >= 3).map((e) => e.name);
    if (verified.length) badges.push({ key: "skills", label: "مهارات موثّقة", hint: verified.join("، ") });
    return { avg: score, count: n, total: rows.filter((r) => revealed(r, now)).length, isNew: n < 3, completed: { contracts, teams, total: done }, dist, as, endorsements: ends, verifiedSkills: verified, badges };
  }
  /** compact card for lists (talent directory, applicants): batch */
  async function cards(uids) {
    const a = [...new Set(uids.filter(Boolean))], m = new Map(); if (!a.length) return m;
    const rows = await db.all(`SELECT * FROM pr_reviews WHERE target_id IN (${ph(a)}) AND status='published'`, a);
    for (const uid of a) { const s = await summaryOf(uid, rows.filter((r) => r.target_id === uid)); m.set(uid, { avg: s.avg, count: s.count, completed: s.completed.total, badges: s.badges.slice(0, 2).map((b) => b.label) }); }
    return m;
  }
  /** the CV block (proprofile.build calls it once the CV itself is visible to the viewer) */
  async function card(uid) { const s = await summaryOf(uid); return { avg: s.avg, count: s.count, isNew: s.isNew, completed: s.completed, badges: s.badges, verifiedSkills: s.verifiedSkills, endorsements: s.endorsements.slice(0, 8) }; }

  /** may `viewer` see the reputation of `u`? (CV visibility when there is one; a minor's never beyond followers) */
  async function canSeeRep(u, viewer) {
    if (viewer && (viewer.id === u.id || viewer.role === "admin")) return true;
    if (viewer && (await blockedBetween(viewer.id, u.id))) return false;
    if (await isMinor(u.id)) return !!viewer && (await ctx.policy.follows(viewer.id, u.id));
    try { const v = await ctx.services.proprofile?.build?.(u, viewer); if (v) return !v.locked; } catch { /* no CV service */ }
    return !!viewer;
  }

  /* ---------- reads ---------- */
  async function userPage(viewer, handle) {
    const u = await userByHandle(handle); if (!u) throw E.nf();
    if (viewer && viewer.id !== u.id && (await blockedBetween(viewer.id, u.id))) throw E.nf();
    if (!(await canSeeRep(u, viewer))) return { user: pubU(u), locked: true };
    const all = await db.all("SELECT * FROM pr_reviews WHERE target_id=$1 ORDER BY created_at DESC", [u.id]);
    const staff = viewer?.role === "admin", self = viewer?.id === u.id;
    const pub = all.filter((r) => r.status === "published");
    const summary = await summaryOf(u.id, pub), cnt = countedSet(pub);
    let list = all.filter((r) => (r.status === "published" || (self && r.status === "flagged") || staff) && (revealed(r) || staff));
    const authors = [...new Set(list.map((r) => r.author_id))];
    if (viewer) { const hide = new Set(); for (const a of authors) if (a !== viewer.id && (await blockedBetween(viewer.id, a))) hide.add(a); list = list.filter((r) => !hide.has(r.author_id)); }
    const us = await usersOf([u.id, ...list.map((r) => r.author_id)]);
    const seenPair = new Set();
    const reviews = list.map((r) => { const rep = seenPair.has(r.author_id); seenPair.add(r.author_id); const c = cnt.has(r.id); return client(r, viewer, us, { counted: r.status === "published" ? c : undefined, repeat: !c && rep }); });
    const waiting = self ? all.filter((r) => r.status === "published" && !revealed(r)).length : undefined;
    let endorse = null;
    if (viewer && !self) { const sh = await sharedWith(viewer.id, u.id); if (sh.length) endorse = await endorseState(viewer, u); }
    return { user: pubU(u), self, staff, minor: self || staff ? await isMinor(u.id) : undefined, summary, reviews, waiting, endorse, reasons: REASONS };
  }

  async function hub(user) {
    const now = clock(), eng = await engagements(user.id);
    const mine = await db.all("SELECT * FROM pr_reviews WHERE author_id=$1 ORDER BY created_at DESC", [user.id]);
    const got = await db.all("SELECT * FROM pr_reviews WHERE target_id=$1 ORDER BY created_at DESC", [user.id]);
    const done = new Set(mine.map((r) => `${r.kind}:${r.ref_id}:${r.target_id}`));
    const pend = [];
    for (const e of eng) { if (now >= e.closesAt) continue; for (const o of e.others) if (!done.has(`${e.kind}:${e.ref}:${o}`) && !(await blockedBetween(user.id, o))) pend.push({ kind: e.kind, ref: e.ref, title: e.title, role: e.role, roleLabel: ROLES[e.role], criteria: CRIT[e.role], to: o, closesAt: iso(e.closesAt), theyReviewed: got.some((r) => r.kind === e.kind && r.ref_id === e.ref && r.author_id === o) }); }
    const us = await usersOf([user.id, ...pend.map((p) => p.to), ...mine.map((r) => r.target_id), ...got.map((r) => r.author_id)]);
    const gotVisible = got.filter((r) => r.status !== "hidden" && revealed(r, now));
    const cnt = countedSet(got.filter((r) => r.status === "published"), now);
    return {
      pending: pend.map((p) => ({ ...p, to: pubU(us.get(p.to)) })).sort((a, b) => ms(a.closesAt) - ms(b.closesAt)),
      given: mine.map((r) => client(r, user, us)),
      received: gotVisible.map((r) => client(r, user, us, { counted: r.status === "published" ? cnt.has(r.id) : undefined })),
      waiting: got.filter((r) => r.status === "published" && !revealed(r, now)).length,
      summary: await summaryOf(user.id), windowDays: Math.round(WINDOW / DAY)
    };
  }

  /* ---------- writes ---------- */
  async function create(user, b) {
    const kind = oneOf(b.kind, ["contract", "team"], null), ref = String(b.ref || ""); if (!kind || !ref) throw E.bad("حدّد التعامل");
    const to = String(b.to || ""); if (!to) throw E.bad("حدّد من تقيّمه");
    if (to === user.id) throw fail(403, "self_review", "لا يمكنك تقييم نفسك");
    const e = (await engagements(user.id)).find((x) => x.kind === kind && x.ref === ref);
    if (!e || !e.others.includes(to)) throw fail(403, "not_eligible", "التقييم متاح فقط بعد إكمال عقد أو مشروع جماعي مع هذا العضو");
    if (clock() >= e.closesAt) throw fail(409, "window_closed", "انتهت مهلة التقييم لهذا التعامل");
    if (await blockedBetween(user.id, to)) throw E.nf();
    if (await db.get("SELECT 1 x FROM pr_reviews WHERE kind=$1 AND ref_id=$2 AND author_id=$3 AND target_id=$4", [kind, ref, user.id, to])) throw fail(409, "already_reviewed", "قيّمت هذا التعامل من قبل");
    const f = fields(b);
    const me = await db.get("SELECT created_at FROM users WHERE id=$1", [user.id]);
    const flags = []; if (clock() - ms(me?.created_at) < MIN_ACC) flags.push("young_account"); if (e.quick) flags.push("quick");
    const rid = id("prr"), now = iso();
    const back = await db.get("SELECT id FROM pr_reviews WHERE kind=$1 AND ref_id=$2 AND author_id=$3 AND target_id=$4", [kind, ref, to, user.id]);
    try {
      await db.run(`INSERT INTO pr_reviews (id, kind, ref_id, author_id, target_id, role, overall, c1, c2, c3, body, warn, flags, status, revealed_at, closes_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'published',$14,$15,$16,$16)`,
        [rid, kind, ref, user.id, to, e.role, f.overall, f.c[0], f.c[1], f.c[2], f.body, f.warn, flags.length ? JSON.stringify(flags) : null, back ? now : null, iso(e.closesAt), now]);
    } catch { throw fail(409, "already_reviewed", "قيّمت هذا التعامل من قبل"); }
    if (back) { await db.run("UPDATE pr_reviews SET revealed_at=$1, updated_at=$1 WHERE id=$2 AND revealed_at IS NULL", [now, back.id]); await notify(to, "prr_received", rid, user.id); await notify(user.id, "prr_received", back.id, to); }
    else await notify(to, "prr_waiting", null, user.id);
    let endorsed = null;
    if (Array.isArray(b.skills) && b.skills.length) { try { endorsed = (await endorse(user, { userId: to, skills: b.skills, basis: `${kind}:${ref}`, merge: true })).skills.filter((s) => s.mine).length; } catch { endorsed = null; } }
    return { ok: true, id: rid, revealed: !!back, endorsed };
  }
  function fields(b, prev) {
    const overall = b.overall !== undefined ? star(b.overall) : Number(prev.overall);
    const c = [1, 2, 3].map((i) => { const v = b["c" + i] !== undefined ? b["c" + i] : prev ? prev["c" + i] : null; return v === null || v === undefined || v === "" ? null : star(v); });
    const body = b.body !== undefined ? str(b.body ? String(b.body) : null, 1500, { min: 10 }) : prev?.body || null;
    return { overall, c, body, warn: body && risky(body) ? 1 : 0 };
  }
  async function edit(user, rid, b) {
    const r = await row(rid); if (!r || r.author_id !== user.id) throw E.nf();
    if (revealed(r) || r.status === "hidden") throw fail(409, "locked", "ظهر التقييم ولم يعد قابلاً للتعديل");
    const f = fields(b, r);
    await db.run("UPDATE pr_reviews SET overall=$1, c1=$2, c2=$3, c3=$4, body=$5, warn=$6, updated_at=$7 WHERE id=$8", [f.overall, f.c[0], f.c[1], f.c[2], f.body, f.warn, iso(), r.id]);
    return { ok: true };
  }
  async function respond(user, rid, b) {
    const r = await row(rid); if (!r || r.target_id !== user.id) throw E.nf();
    if (!revealed(r) || r.status !== "published") throw fail(409, "not_visible", "يمكنك الرد بعد ظهور التقييم");
    const body = str(b.body ? String(b.body) : null, 800, { min: 2 });
    if (body && risky(body)) throw fail(400, "risky", "لا تضع في الرد وسائل تواصل أو دفع خارج المنصة");
    await db.run("UPDATE pr_reviews SET response=$1, response_at=$2, updated_at=$2 WHERE id=$3", [body, body ? iso() : null, r.id]);
    if (body && !r.response) await notify(r.author_id, "prr_response", r.id, user.id);
    return { ok: true, response: body ? { body, at: iso() } : null };
  }
  async function report(user, rid, b) {
    const r = await row(rid); if (!r || r.status === "hidden" || !revealed(r)) throw E.nf();
    if (r.author_id === user.id) throw fail(403, "own_review", "لا يمكنك الإبلاغ عن تقييمك");
    if (r.target_id !== user.id && (await blockedBetween(user.id, r.author_id))) throw E.nf();
    const reason = oneOf(b.reason, Object.keys(REASONS), null); if (!reason) throw E.bad("اختر سبب البلاغ");
    const note = str(b.note ? String(b.note) : null, 600);
    try { await db.run("INSERT INTO pr_reports (id, review_id, by_user, reason, note, status, created_at) VALUES ($1,$2,$3,$4,$5,'open',$6)", [id("prp"), r.id, user.id, reason, note, iso()]); } catch { throw fail(409, "reported", "أبلغت عن هذا التقييم من قبل"); }
    const n = Number((await db.get("SELECT COUNT(*) n FROM pr_reports WHERE review_id=$1 AND status='open'", [r.id]))?.n || 0);
    if (n >= FLAG_AT && r.status === "published") await db.run("UPDATE pr_reviews SET status='flagged', updated_at=$1 WHERE id=$2", [iso(), r.id]);
    return { ok: true, flagged: n >= FLAG_AT };
  }

  /* ---------- endorsements ---------- */
  async function endorseState(viewer, u) {
    const skills = await db.all("SELECT name, norm FROM pro_skills WHERE user_id=$1 ORDER BY pos, name", [u.id]).catch(() => []);
    const mine = new Set((await db.all("SELECT norm FROM pr_endorsements WHERE user_id=$1 AND by_user=$2", [u.id, viewer.id])).map((e) => e.norm));
    return { max: ENDORSE_MAX, skills: skills.map((s) => ({ key: s.norm, name: s.name, mine: mine.has(s.norm) })) };
  }
  async function endorseGet(user, handle) {
    const u = await userByHandle(handle); if (!u || u.id === user.id || (await blockedBetween(user.id, u.id))) throw E.nf();
    const sh = await sharedWith(user.id, u.id);
    return { user: pubU(u), can: sh.length > 0, basis: sh.map((e) => ({ kind: e.kind, title: e.title })), ...(sh.length ? await endorseState(user, u) : { skills: [], max: ENDORSE_MAX }) };
  }
  async function endorse(user, b) {
    const u = b.userId ? await db.get("SELECT id, handle FROM users WHERE id=$1 AND status='active'", [String(b.userId)]) : await userByHandle(b.handle);
    if (!u || u.id === user.id) throw fail(403, "self_endorse", "لا يمكنك تأييد مهاراتك");
    if (await blockedBetween(user.id, u.id)) throw E.nf();
    const sh = await sharedWith(user.id, u.id);
    if (!sh.length) throw fail(403, "not_collaborator", "التأييد متاح لمن أكمل معك عقداً أو مشروعاً جماعياً");
    const have = new Map((await db.all("SELECT name, norm FROM pro_skills WHERE user_id=$1", [u.id]).catch(() => [])).map((s) => [s.norm, s.name]));
    const want = [...new Set((Array.isArray(b.skills) ? b.skills : []).map((s) => { const k = String(s || "").trim(); const n = normalize(k).toLowerCase(); return have.has(k) ? k : have.has(n) ? n : [...have.entries()].find(([, name]) => name === k)?.[0]; }).filter(Boolean))];
    const prev = new Set((await db.all("SELECT norm FROM pr_endorsements WHERE user_id=$1 AND by_user=$2", [u.id, user.id])).map((e) => e.norm));
    const next = b.merge ? [...new Set([...prev, ...want])] : want;
    if (next.length > ENDORSE_MAX) throw fail(400, "too_many", `حتى ${ENDORSE_MAX} مهارات لكل عضو`);
    const basis = b.basis || `${sh[0].kind}:${sh[0].ref}`, now = iso();
    for (const k of prev) if (!next.includes(k)) await db.run("DELETE FROM pr_endorsements WHERE user_id=$1 AND by_user=$2 AND norm=$3", [u.id, user.id, k]);
    let added = 0; for (const k of next) if (!prev.has(k)) { await db.run("INSERT INTO pr_endorsements (user_id, by_user, norm, name, basis, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [u.id, user.id, k, have.get(k), basis, now]); added++; }
    if (added) await notify(u.id, "prr_endorsed", null, user.id);
    return { ok: true, ...(await endorseState(user, u)) };
  }

  /* ---------- staff ---------- */
  async function adminView() {
    const reps = await db.all("SELECT review_id, reason, note, by_user, created_at FROM pr_reports WHERE status='open' ORDER BY created_at");
    const ids = [...new Set([...reps.map((r) => r.review_id), ...(await db.all("SELECT id FROM pr_reviews WHERE status='flagged'")).map((r) => r.id)])];
    const rows = ids.length ? await db.all(`SELECT * FROM pr_reviews WHERE id IN (${ph(ids)})`, ids) : [];
    // reciprocal pairs: A ↔ B reviewed each other on 2+ engagements
    const pairs = await db.all("SELECT a.author_id x, a.target_id y, COUNT(*) n, AVG(a.overall) s FROM pr_reviews a JOIN pr_reviews b ON b.kind=a.kind AND b.ref_id=a.ref_id AND b.author_id=a.target_id AND b.target_id=a.author_id WHERE a.author_id < a.target_id GROUP BY a.author_id, a.target_id HAVING COUNT(*) >= 2 ORDER BY COUNT(*) DESC LIMIT 30");
    const us = await usersOf([...rows.flatMap((r) => [r.author_id, r.target_id]), ...reps.map((r) => r.by_user), ...pairs.flatMap((p) => [p.x, p.y])]);
    const staff = { id: "_staff", role: "admin" };
    return {
      queue: rows.map((r) => ({ ...client(r, staff, us), reports: reps.filter((x) => x.review_id === r.id).map((x) => ({ reason: REASONS[x.reason] || x.reason, note: x.note || null, by: pubU(us.get(x.by_user)), at: isoOf(x.created_at) })) })),
      pairs: pairs.map((p) => ({ a: pubU(us.get(p.x)), b: pubU(us.get(p.y)), engagements: Number(p.n), avg: round1(Number(p.s)) })),
      totals: { reviews: Number((await db.get("SELECT COUNT(*) n FROM pr_reviews"))?.n || 0), flagged: rows.filter((r) => r.status === "flagged").length, reports: reps.length, endorsements: Number((await db.get("SELECT COUNT(*) n FROM pr_endorsements"))?.n || 0) }
    };
  }
  async function moderate(staff, rid, b) {
    const r = await row(rid); if (!r) throw E.nf();
    const action = oneOf(b.action, ["hide", "restore", "dismiss"], null); if (!action) throw E.bad("اختر الإجراء");
    const note = str(b.note ? String(b.note) : null, 600); if (action === "hide" && !note) throw E.bad("اكتب سبب الإخفاء");
    const now = iso();
    const status = action === "hide" ? "hidden" : "published";
    await db.run("UPDATE pr_reviews SET status=$1, staff_note=$2, updated_at=$3 WHERE id=$4", [status, action === "hide" ? note : r.staff_note, now, r.id]);
    await db.run("UPDATE pr_reports SET status=$1, decided_at=$2, decided_by=$3 WHERE review_id=$4 AND status='open'", [action === "hide" ? "upheld" : "dismissed", now, staff.id, r.id]);
    ctx.audit?.("proreview_" + action, r.id, note, staff.id);
    if (action === "hide" || (action === "restore" && r.status === "hidden")) await notify(r.author_id, "prr_moderated", r.id, staff.id);
    return { ok: true, status };
  }

  /* ---------- sweep: «you can review now» + reveal at window end ---------- */
  async function sweep() {
    const now = clock(), since = iso(now - WINDOW);
    let prompted = 0, revealedN = 0;
    const cs = await db.all("SELECT id, client_id, worker_id FROM contracts WHERE status='completed' AND completed_at >= $1", [since]).catch(() => []);
    const ts = await db.all("SELECT id FROM wt_teams WHERE status='completed' AND closed_at >= $1", [since]).catch(() => []);
    const targets = [...cs.flatMap((c) => [["contract", c.id, c.client_id], ["contract", c.id, c.worker_id]])];
    for (const t of ts) for (const m of await db.all("SELECT user_id FROM wt_members WHERE team_id=$1 AND role<>'viewer'", [t.id])) targets.push(["team", t.id, m.user_id]);
    for (const [kind, ref, uid] of targets) {
      if (await db.get("SELECT 1 x FROM pr_prompts WHERE kind=$1 AND ref_id=$2 AND user_id=$3", [kind, ref, uid])) continue;
      const e = (await engagements(uid)).find((x) => x.kind === kind && x.ref === ref); if (!e) continue;
      await db.run("INSERT INTO pr_prompts (kind, ref_id, user_id, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [kind, ref, uid, iso()]);
      await notify(uid, "prr_open", null); prompted++;
    }
    for (const r of await db.all("SELECT id, target_id, author_id FROM pr_reviews WHERE revealed_at IS NULL AND closes_at <= $1", [iso(now)])) {
      await db.run("UPDATE pr_reviews SET revealed_at=$1 WHERE id=$2", [iso(now), r.id]); await notify(r.target_id, "prr_received", r.id, r.author_id); revealedN++;
    }
    return { prompted, revealed: revealedN };
  }
  if (opts.jobs !== false && !process.env.NODE_TEST_CONTEXT) { const tm = setInterval(() => sweep().catch(() => {}), 3600e3); tm.unref?.(); }

  /* ---------- routes ---------- */
  R.get("/api/proreviews", A(async (req) => hub(req.user)));
  R.post("/api/proreviews", A(async (req) => create(req.user, req.body || {})));
  R.get("/api/proreviews/u/:handle", async (req) => userPage(req.user || null, req.params.handle));
  R.get("/api/proreviews/endorse/:handle", A(async (req) => endorseGet(req.user, req.params.handle)));
  R.put("/api/proreviews/endorse/:handle", A(async (req) => endorse(req.user, { ...(req.body || {}), handle: req.params.handle, userId: null, merge: false })));
  R.patch("/api/proreviews/:id", A(async (req) => edit(req.user, req.params.id, req.body || {})));
  R.put("/api/proreviews/:id/response", A(async (req) => respond(req.user, req.params.id, req.body || {})));
  R.post("/api/proreviews/:id/report", A(async (req) => report(req.user, req.params.id, req.body || {})));
  R.get("/api/admin/proreviews", admin(async () => adminView()));
  R.post("/api/admin/proreviews/:id", admin(async (req) => moderate(req.user, req.params.id, req.body || {})));

  return { card, cards, summaryOf, engagements, sweep, ROLES, CRIT };
};
