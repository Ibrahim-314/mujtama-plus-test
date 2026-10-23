/* Mentorship «إرشاد وربط الخبراء بالمتعلمين» (phase 74). Free; no external service, no new keys.
 *  1. Expert profiles: any adult member opens a mentor profile (headline, bio, up to 5 topics from a fixed list, languages,
 *     session length 30/45/60/90 min, free or a Pi price, time zone, open / paused) and a weekly availability grid in their
 *     own time zone. Ratings are aggregated from learners' reviews; completed sessions are counted.
 *  2. Discovery and matching: directory with topic / language / free-paid filters and search; «اقترح لي مرشداً» ranks the
 *     best three for a topic + goal with plain reasons (topic, rating, language, free slots this week).
 *  3. Requests: a learner asks one mentor directly, or posts an open request that every mentor of that topic sees; a mentor
 *     accepts (with a reply) or declines; the learner may withdraw. At most 5 open requests per learner.
 *  4. Booking: free slots are generated server-side from the weekly grid (14 days ahead, 12 h notice, existing sessions of
 *     the mentor AND the learner excluded), so a booking can only land on a real free slot. pending → the mentor confirms →
 *     confirmed → completed | no-show; either side can cancel with a reason before the end. iCal: one .ics per session and a
 *     private, revocable feed /mentor-feed/<token>.ics for any calendar app. Reminder one hour before (leased job).
 *  5. Live session: the mentor opens a private live room (phase 14 rooms) 10 min before the start; only the two sides (and,
 *     for a minor, the linked guardian) may join; such rooms are never listed publicly.
 *  6. Notes and feedback: one private note per side per session (the mentor can share a summary with the learner); after a
 *     completed session the learner rates 1–5 with a comment (public, aggregated), the mentor leaves private feedback (never
 *     returned to the learner or a guardian). A block between the two sides after booking closes the room; cancel stays.
 *  7. Pi-paid sessions (optional): with Pi payments on, a priced session is paid at booking into escrow (platform:held) and
 *     released to the mentor (minus the platform fee) when the mentor marks it completed or no-show; a cancellation of a held
 *     payment reverses the escrow journal and marks the session refund_due for staff to return the Pi. With Pi payments off
 *     (production today) priced mentors cannot be booked: free mentoring keeps working.
 *  8. Minors (phase 35): no mentor profile under 18; a minor can book only mentors who opted in to minors, only free
 *     sessions, and only with an active guardian link — every request / booking / change is notified to the guardian, who
 *     sees the sessions (not the notes) and may join the session room. Minors appear in public reviews as «متعلّم».
 *  9. Staff: totals, low-rated mentors, refund-due sessions; suspend / restore a mentor (upcoming sessions are cancelled and
 *     learners told), every decision audited. */
const crypto = require("node:crypto");
const { E, str, oneOf, id } = require("../lib/core");
const { pi, toUnits, createLedger, ACC } = require("../lib/ledger");

const TOPICS = { programming: "برمجة وتطوير", design: "تصميم وتجربة مستخدم", data: "بيانات وذكاء اصطناعي", business: "ريادة أعمال", marketing: "تسويق ومحتوى", career: "مسار مهني ومقابلات", languages: "لغات", english: "اللغة الإنجليزية", arabic: "اللغة العربية والكتابة", quran: "تلاوة وتجويد", math: "رياضيات وعلوم", finance: "إدارة المال", pi: "منظومة Pi", study: "مهارات الدراسة", other: "أخرى" };
const LEVELS = { beginner: "مبتدئ", intermediate: "متوسط", advanced: "متقدم" };
const STATUSES = { pending: "بانتظار التأكيد", confirmed: "مؤكدة", completed: "مكتملة", cancelled: "ملغاة", no_show: "لم يحضر المتعلّم" };
const REQ_STATUSES = { open: "مفتوح", accepted: "مقبول", declined: "معتذر عنه", withdrawn: "مسحوب", closed: "مغلق" };
const LENGTHS = [30, 45, 60, 90];
const DAY = 864e5, MIN = 6e4;
const icsEsc = (s = "") => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = (line) => { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = " " + s.slice(n); } out.push(s); return out.join("\r\n"); };

/* ---------- time zones (no library): wall time in tz ↔ UTC ---------- */
const validTz = (t) => { try { if (!t) return false; new Intl.DateTimeFormat("en", { timeZone: t }); return true; } catch { return false; } };
const fmtCache = new Map();
function partsAt(tz, ms) {
  let f = fmtCache.get(tz); if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); fmtCache.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
const offsetMin = (tz, ms) => { const p = partsAt(tz, ms); return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - ms) / MIN); };
/** UTC ms of local wall time y-m-d + minute-of-day in tz */
function zoned(tz, y, m, d, minute) {
  const guess = Date.UTC(y, m - 1, d, 0, minute); const o1 = offsetMin(tz, guess); let t = guess - o1 * MIN;
  const o2 = offsetMin(tz, t); if (o2 !== o1) t = guess - o2 * MIN; return t;
}
const hm = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "")); if (!m) return null; const n = +m[1] * 60 + +m[2]; return +m[1] < 24 && +m[2] < 60 ? n : n === 1440 ? 1440 : null; };
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** @param {any} ctx @param {{ now?: () => number, jobs?: boolean, env?: Record<string,string|undefined> }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const NOTICE = +(env.MENTOR_NOTICE_HOURS || 12) * 3600e3, HORIZON = 14;
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref, actor = null) => { try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  /** ids of minors among `ids` in ONE age_profiles query (minors.minorIds); falls back to per-id isMinor when absent. Same answers as isMinor. */
  const minorSetOf = async (ids) => { const m = ctx.services.minors; if (typeof m?.minorIds !== "function") { const out = new Set(); for (const id of new Set(ids.filter(Boolean))) if (await isMinor(id)) out.add(id); return out; } try { return await m.minorIds(ids); } catch { return new Set(); } };
  const blocked = async (a, b) => { try { return !!(await ctx.services.tips?.blockedBetween?.(a, b)); } catch { return false; } };
  /** every user id in a block relation with uid (either direction; prefs.blocked + user_blocks), two queries for list filters */
  const blockSet = async (uid, rows = []) => {
    const out = new Set();
    try {
      const me = await db.get("SELECT prefs FROM users WHERE id=$1", [uid]);
      for (const x of parse(me?.prefs, {})?.blocked || []) out.add(x);
      for (const r of await db.all("SELECT owner, target FROM user_blocks WHERE owner=$1 OR target=$1", [uid]).catch(() => [])) out.add(r.owner === uid ? r.target : r.owner);
      for (const r of rows) if ((parse(r.prefs, {})?.blocked || []).includes(uid)) out.add(r.user_id);
    } catch { /* best effort, same as blocked() */ }
    return out;
  };
  const piOn = () => !!ctx.services.pi?.enabled?.();
  const feeBps = () => Number(ctx.services.tips?.config?.feeBps ?? 500);
  const { postJournal, reverseAll } = createLedger({ now: () => iso() });
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => ctx.log?.error?.("mentors handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : E.bad(msg), { code });
  const userPub = (u) => (u ? { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null, verified: !!u.verified } : null);
  async function usersOf(ids) { const a = [...new Set(ids.filter(Boolean))]; return a.length ? db.all(`SELECT id, name, handle, color, avatar, verified, status FROM users WHERE id IN (${ph(a)})`, a) : []; }
  const byHandle = async (h) => { const u = await db.get("SELECT id, name, handle, color, avatar, verified, status FROM users WHERE LOWER(handle)=LOWER($1)", [String(h || "").replace(/^@/, "")]); if (!u || u.status !== "active") throw E.nf("الحساب غير موجود"); return u; };
  const guardiansOf = async (minorId) => (await db.all("SELECT guardian_id FROM guardian_links WHERE minor_id=$1 AND status='active'", [minorId]).catch(() => [])).map((r) => r.guardian_id);
  const topicList = (v) => [...new Set((Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim()).filter((x) => TOPICS[x]))].slice(0, 5);

  /* ---------- 1. profiles + availability ---------- */
  const profileOf = (uid) => db.get("SELECT * FROM mentor_profiles WHERE user_id=$1", [uid]);
  const slotsOf = (uid) => db.all("SELECT weekday, start_min, end_min FROM mentor_slots WHERE mentor_id=$1 ORDER BY weekday, start_min", [uid]);
  async function aggregates(ids) {
    if (!ids.length) return new Map();
    const rt = await db.all(`SELECT about_user u, AVG(rating) a, COUNT(*) n FROM mentor_feedback WHERE rating IS NOT NULL AND about_user IN (${ph(ids)}) GROUP BY about_user`, ids);
    const done = await db.all(`SELECT mentor_id u, COUNT(*) n FROM mentor_sessions WHERE status='completed' AND mentor_id IN (${ph(ids)}) GROUP BY mentor_id`, ids);
    const sl = await db.all(`SELECT mentor_id u, COUNT(*) n FROM mentor_slots WHERE mentor_id IN (${ph(ids)}) GROUP BY mentor_id`, ids);
    const m = new Map(ids.map((i) => [i, { avg: null, count: 0, sessions: 0, hasSlots: false }]));
    for (const r of rt) Object.assign(m.get(r.u), { avg: Math.round(Number(r.a) * 10) / 10, count: Number(r.n) });
    for (const r of done) m.get(r.u).sessions = Number(r.n);
    for (const r of sl) m.get(r.u).hasSlots = Number(r.n) > 0;
    return m;
  }
  const mentorClient = (p, u, ag = {}) => ({ user: userPub(u), headline: p.headline, bio: p.bio || "", topics: parse(p.topics, []).map((k) => ({ key: k, label: TOPICS[k] })), languages: p.languages || "", minutes: Number(p.minutes), price: pi(p.price), paid: Number(p.price) > 0, bookable: !(Number(p.price) > 0 && !piOn()), allowMinors: !!Number(p.allow_minors), tz: p.tz, open: !!Number(p.open), status: p.status, rating: { avg: ag.avg ?? null, count: ag.count || 0 }, sessions: ag.sessions || 0, hasSlots: !!ag.hasSlots, reviewed: !!p.reviewed_at }); /* M5-2: boolean only — who/when never leaves the staff view */

  /* ---------- M2-1 full profile: visibility / per-field visibility / extra — strict validation; viewer filtering is M2-2 ---------- */
  const M067 = require("../migrations/067_mentor_profile_ext");
  const TPL_MAX = 8, TPL_TITLE = 40, TPL_BODY = 500;
  const EXTRA_DEFAULTS = Object.freeze({ approach: "", skills: [], experience: [], qualifications: [], years: null, city: "", templates: [] });
  const bad = (code, msg) => fail(400, code, msg);
  const plainObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const nowYear = () => new Date(clock()).getUTCFullYear();
  const yearOf = (v, code, { optional = false } = {}) => {
    if (v === undefined || v === null || v === "") { if (optional) return null; throw bad(code, "السنة مطلوبة"); }
    const n = typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v) : v;
    if (!Number.isInteger(n) || n < 1950 || n > nowYear()) throw bad(code, `السنة بين 1950 و${nowYear()}`);
    return n;
  };
  const httpsLink = (v) => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || v.trim().length > 300) throw bad("invalid_link", "رابط غير صالح");
    let u; try { u = new URL(v.trim()); } catch { throw bad("invalid_link", "رابط غير صالح"); }
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) throw bad("invalid_link", "الروابط المقبولة تبدأ بـ https:// فقط");
    return u.href;
  };
  const listOf = (v, max, code, label, fn) => {
    if (v === null) return [];
    if (!Array.isArray(v)) throw bad(code, `${label}: قائمة غير صالحة`);
    if (v.length > max) throw bad(code, `${label}: الحد الأقصى ${max}`);
    return v.map(fn);
  };
  const txt = (v, max, code) => { try { return str(v, max) || ""; } catch { throw bad(code, "طول النص غير مقبول"); } };
  const reqTxt = (v, max, code) => { try { return str(v, max, { required: true }); } catch { throw bad(code, "حقل مطلوب ناقص أو طويل"); } };
  const EXTRA_RULES = {
    approach: (v) => txt(v, 600, "invalid_approach"),
    city: (v) => txt(v, 60, "invalid_city"),
    years: (v) => { if (v === null || v === "") return null; const n = typeof v === "string" && /^\d{1,2}$/.test(v.trim()) ? Number(v) : v; if (!Number.isInteger(n) || n < 0 || n > 60) throw bad("invalid_years", "سنوات الخبرة بين 0 و60"); return n; },
    skills: (v) => [...new Set(listOf(v, 10, "invalid_skills", "المهارات", (x) => reqTxt(x, 40, "invalid_skills")))],
    experience: (v) => listOf(v, 8, "invalid_experience", "الخبرات", (x) => {
      if (!plainObj(x)) throw bad("invalid_experience", "خبرة غير صالحة");
      const from = yearOf(x.from, "invalid_experience"), to = yearOf(x.to, "invalid_experience", { optional: true });
      if (to !== null && to < from) throw bad("invalid_experience", "سنة النهاية قبل البداية");
      return { title: reqTxt(x.title, 80, "invalid_experience"), org: txt(x.org, 80, "invalid_experience"), from, to };
    }),
    qualifications: (v) => listOf(v, 8, "invalid_qualifications", "المؤهلات", (x) => {
      if (!plainObj(x)) throw bad("invalid_qualifications", "مؤهل غير صالح");
      return { name: reqTxt(x.name, 100, "invalid_qualifications"), issuer: txt(x.issuer, 80, "invalid_qualifications"), year: yearOf(x.year, "invalid_qualifications", { optional: true }), link: httpsLink(x.link) };
    }),
    /* M4-5/F10 private reply templates: owner-only (myProfile); profileView never copies them, so public page / preview / staff
     *  views never carry them. Whole list replaced on save; a missing/invalid id gets a fresh one. */
    templates: (v) => { const seen = new Set(); return listOf(v, TPL_MAX, "invalid_templates", "الردود الجاهزة", (x) => {
      if (!plainObj(x)) throw bad("invalid_templates", "ردّ جاهز غير صالح");
      let tid = typeof x.id === "string" && /^t[a-z0-9]{1,15}$/.test(x.id) && !seen.has(x.id) ? x.id : ""; while (!tid || seen.has(tid)) tid = "t" + Math.random().toString(36).slice(2, 10); seen.add(tid);
      const need = (v, max) => { try { return str(v, max, { required: true, min: 1 }); } catch { throw bad("invalid_templates", "العنوان والنص مطلوبان ضمن الحد المسموح"); } };
      return { id: tid, title: need(x.title, TPL_TITLE), body: need(x.body, TPL_BODY) };
    }); }
  };
  /** visibility: undefined → keep stored; otherwise must be one of VISIBILITY. */
  const cleanVisibility = (v, prev) => { if (v === undefined) return M067.VISIBILITY.includes(prev) ? prev : M067.VISIBILITY_DEFAULT; if (!M067.VISIBILITY.includes(v)) throw bad("invalid_visibility", "قيمة الظهور غير صالحة"); return v; };
  /** fields: partial patch merged over stored; unknown keys dropped; each value must be one of FIELD_LEVELS; null resets to defaults. */
  const cleanFields = (v, prev) => {
    const base = Object.fromEntries(Object.entries(plainObj(prev) ? prev : {}).filter(([k, x]) => k in M067.FIELD_DEFAULTS && M067.FIELD_LEVELS.includes(x)));
    if (v === undefined) return base; if (v === null) return {}; if (!plainObj(v)) throw bad("invalid_fields", "إعدادات ظهور الحقول غير صالحة");
    for (const [k, x] of Object.entries(v)) { if (!(k in M067.FIELD_DEFAULTS)) continue; if (!M067.FIELD_LEVELS.includes(x)) throw bad("invalid_fields", "مستوى ظهور غير صالح"); base[k] = x; }
    return base;
  };
  /** extra: partial patch merged over stored; unknown keys dropped; each known key validated; null resets all. */
  const cleanExtra = (v, prev) => {
    const base = {}; if (plainObj(prev)) for (const k of Object.keys(EXTRA_RULES)) if (k in prev) { try { base[k] = EXTRA_RULES[k](prev[k]); } catch { /* drop a stale stored value */ } }
    if (v === undefined) return base; if (v === null) return {}; if (!plainObj(v)) throw bad("invalid_extra", "بيانات الملف الإضافية غير صالحة");
    for (const k of Object.keys(EXTRA_RULES)) if (v[k] !== undefined) base[k] = EXTRA_RULES[k](v[k]);
    return base;
  };
  const withDefaults = (p) => ({ visibility: cleanVisibility(undefined, p.visibility), fields: { ...M067.FIELD_DEFAULTS, ...cleanFields(undefined, parse(p.fields, {})) }, extra: { ...EXTRA_DEFAULTS, ...cleanExtra(undefined, parse(p.extra, {})) } });

  /* ---------- M2-2 viewer filter: who may open a mentor page and which profile fields they receive (server-side only) ----------
   *  page visibility: public = everyone · members = signed-in · hidden = owner, staff, the mentor's mentees (≥1 pending /
   *  confirmed / completed session or an accepted request) and those mentees' active guardians; anyone else 404 (no leak).
   *  blocked (either direction) → 404 except staff; suspended / non-active keeps the existing owner+staff-only rule.
   *  field levels: public = whoever sees the page · mentees = owner, staff, mentees · off = nobody on the page (the owner edits
   *  it in /api/mentor/me). A field that is not visible is ABSENT from the JSON, never null-filled. Age = whole years from
   *  age_profiles.birth_date (the date itself is never sent). */
  const isStaff = (v) => v?.role === "admin";
  const menteeOf = async (mentorId, uid) => !!uid && (!!(await db.get("SELECT 1 x FROM mentor_sessions WHERE mentor_id=$1 AND learner_id=$2 AND status IN ('pending','confirmed','completed') LIMIT 1", [mentorId, uid]))
    || !!(await db.get("SELECT 1 x FROM mentor_requests WHERE mentor_id=$1 AND learner_id=$2 AND status='accepted' LIMIT 1", [mentorId, uid])));
  async function guardianOfMentee(mentorId, uid) {
    const kids = (await db.all("SELECT minor_id FROM guardian_links WHERE guardian_id=$1 AND status='active'", [uid]).catch(() => [])).map((r) => r.minor_id);
    for (const k of kids) if (await menteeOf(mentorId, k)) return true;
    return false;
  }
  /** relation of the viewer to the mentor: owner | staff | mentee | guardian | member | guest; null = must get 404. */
  async function viewerRel(viewer, p) {
    if (viewer?.id === p.user_id) return "owner";
    if (isStaff(viewer)) return "staff";
    if (viewer && (await blocked(viewer.id, p.user_id))) return null;
    const vis = withDefaults(p).visibility;
    const rel = !viewer ? "guest" : (await menteeOf(p.user_id, viewer.id)) ? "mentee" : vis === "hidden" && (await guardianOfMentee(p.user_id, viewer.id)) ? "guardian" : "member";
    if (vis === "members" && rel === "guest") return null;
    if (vis === "hidden" && !["mentee", "guardian"].includes(rel)) return null;
    return rel;
  }
  const fieldOn = (level, rel) => level === "public" || (level === "mentees" && ["owner", "staff", "mentee"].includes(rel));
  const yearsOld = (bd) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(bd || "")); if (!m) return null; const n = new Date(clock()); let a = n.getUTCFullYear() - +m[1]; if (n.getUTCMonth() + 1 < +m[2] || (n.getUTCMonth() + 1 === +m[2] && n.getUTCDate() < +m[3])) a--; return a >= 0 && a < 130 ? a : null; };
  /** the mentor object a viewer with relation `rel` may receive; `age` is passed only when the caller resolved it. */
  function profileView(rel, p, u, ag, age = null) {
    const d = withDefaults(p), on = (k) => fieldOn(d.fields[k], rel), x = d.extra;
    const out = { ...mentorClient(p, u, ag), approach: x.approach, skills: x.skills };
    if (!on("photo")) out.user = { ...out.user, avatar: null };
    if (!on("stats")) { delete out.rating; delete out.sessions; }
    if (on("experience")) { out.experience = x.experience; out.years = x.years; }
    if (on("qualifications")) out.qualifications = x.qualifications;
    if (on("city") && x.city) out.city = x.city;
    if (on("age") && age !== null) out.age = age;
    out.contact = on("contact");
    out.shown = Object.keys(M067.FIELD_DEFAULTS).filter(on);
    if (rel === "owner" || rel === "staff") { out.visibility = d.visibility; out.fields = d.fields; }
    return out;
  }
  const ageOf = async (uid) => yearsOld((await db.get("SELECT birth_date FROM age_profiles WHERE user_id=$1", [uid]).catch(() => null))?.birth_date);
  /** directory / match: hidden never listed; members only for signed-in viewers. */
  const listable = (p, viewer) => { const v = withDefaults(p).visibility; return v === "public" || (v === "members" && !!viewer); };

  /* M2-5 «معاينة كما يراه»: the mentor's own page as a visitor / member / mentee / guardian would receive it — same viewerRel
   *  page rule and the same profileView field filter (no parallel logic). Mentor only (401 signed-out, 404 without a profile).
   *  visible=false → that viewer would get 404 (page hidden for them); then no mentor object is sent. birth_date never sent. */
  const PREVIEW_AS = { visitor: "guest", member: "member", mentee: "mentee", guardian: "guardian" };
  async function previewAs(user, as) {
    const rel = PREVIEW_AS[as]; if (!rel) throw bad("invalid_preview", "نوع المعاينة غير صالح");
    const p = await profileOf(user.id); if (!p) throw E.nf("أنشئ ملف الإرشاد أولاً");
    const vis = withDefaults(p).visibility, fl = withDefaults(p).fields;
    const visible = vis === "public" || (vis === "members" && rel !== "guest") || (vis === "hidden" && (rel === "mentee" || rel === "guardian"));
    if (!visible) return { as, visible: false, visibility: vis };
    const u = (await usersOf([user.id]))[0], ag = (await aggregates([user.id])).get(user.id);
    const mentor = profileView(rel, p, u, ag, fieldOn(fl.age, rel) ? await ageOf(user.id) : null);
    return { as, visible: true, visibility: vis, mentor, canContact: fieldOn(fl.contact, rel), resources: await resourcesFor(user.id, rel === "mentee" || rel === "guardian") };
  }
  async function myProfile(user) {
    const p = await profileOf(user.id), u = (await usersOf([user.id]))[0];
    const ag = p ? (await aggregates([user.id])).get(user.id) : null;
    const t = iso();
    const counts = p ? {
      upcoming: Number((await db.get("SELECT COUNT(*) n FROM mentor_sessions WHERE mentor_id=$1 AND status IN ('pending','confirmed') AND starts_at > $2", [user.id, t]))?.n || 0),
      toConfirm: Number((await db.get("SELECT COUNT(*) n FROM mentor_sessions WHERE mentor_id=$1 AND status='pending' AND pay_status IN ('none','held') AND starts_at > $2", [user.id, t]))?.n || 0),
      requests: Number((await db.get("SELECT COUNT(*) n FROM mentor_requests WHERE mentor_id=$1 AND status='open'", [user.id]))?.n || 0)
    } : null;
    return { profile: p ? { ...mentorClient(p, u, ag), ...withDefaults(p) } : null, profileMeta: { visibility: M067.VISIBILITY, fieldLevels: M067.FIELD_LEVELS, fieldDefaults: M067.FIELD_DEFAULTS, templates: { max: TPL_MAX, title: TPL_TITLE, body: TPL_BODY } }, slots: p ? (await slotsOf(user.id)).map((s) => ({ weekday: Number(s.weekday), start: hhmm(Number(s.start_min)), end: hhmm(Number(s.end_min)) })) : [], counts, minor: await isMinor(user.id), topics: TOPICS, levels: LEVELS, lengths: LENGTHS, piEnabled: piOn() };
  }
  async function saveProfile(user, b = {}) {
    if (!rl.hit("default", "mprof:" + user.id)) throw E.rate();
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "الإرشاد كمرشد متاح لمن هم ١٨ سنة فأكثر");
    const prev = await profileOf(user.id);
    if (prev && prev.status === "suspended") throw E.forbid("ملف الإرشاد موقوف من فريق المنصة" + (prev.status_reason ? ": " + prev.status_reason : ""));
    const topics = topicList(b.topics ?? parse(prev?.topics, [])); if (!topics.length) throw E.bad("اختر موضوعاً واحداً على الأقل");
    const minutes = b.minutes !== undefined ? Number(b.minutes) : Number(prev?.minutes || 45); if (!LENGTHS.includes(minutes)) throw E.bad("مدة الجلسة غير صالحة");
    let price = prev ? Number(prev.price) : 0;
    if (b.price !== undefined && b.price !== null && b.price !== "") { const n = Number(b.price); if (!(Number.isFinite(n) && n >= 0 && n <= 1000)) throw E.bad("السعر بين 0 و1000 Pi"); price = toUnits(Math.round(n * 100) / 100); }
    const tz = b.tz !== undefined ? (validTz(String(b.tz)) ? String(b.tz) : null) : prev?.tz || "Asia/Riyadh"; if (!tz) throw E.bad("المنطقة الزمنية غير صالحة");
    const row = { headline: str(b.headline ?? prev?.headline, 120, { required: true, min: 6 }), bio: str(b.bio ?? prev?.bio ?? undefined, 2000), topics: JSON.stringify(topics), languages: str(b.languages ?? prev?.languages ?? undefined, 80), minutes, price, allow_minors: (b.allowMinors !== undefined ? !!b.allowMinors : !!Number(prev?.allow_minors)) ? 1 : 0, tz, open: (b.open !== undefined ? !!b.open : prev ? !!Number(prev.open) : true) ? 1 : 0 };
    const vis = cleanVisibility(b.visibility, prev?.visibility), fields = cleanFields(b.fields, parse(prev?.fields, {})), extra = cleanExtra(b.extra, parse(prev?.extra, {}));
    const fieldsJ = Object.keys(fields).length ? JSON.stringify(fields) : null, extraJ = Object.keys(extra).length ? JSON.stringify(extra) : null;
    const t = iso();
    if (prev) await db.run("UPDATE mentor_profiles SET headline=$1, bio=$2, topics=$3, languages=$4, minutes=$5, price=$6, allow_minors=$7, tz=$8, open=$9, updated_at=$10, visibility=$12, fields=$13, extra=$14 WHERE user_id=$11", [row.headline, row.bio, row.topics, row.languages, row.minutes, row.price, row.allow_minors, row.tz, row.open, t, user.id, vis, fieldsJ, extraJ]);
    else await db.run("INSERT INTO mentor_profiles(user_id,headline,bio,topics,languages,minutes,price,allow_minors,tz,open,status,created_at,updated_at,visibility,fields,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11,$12,$13,$14)", [user.id, row.headline, row.bio, row.topics, row.languages, row.minutes, row.price, row.allow_minors, row.tz, row.open, t, vis, fieldsJ, extraJ]);
    if (prev && !Number(prev.open) && row.open) await slotAlert(user.id); // M4-4: reopened with its weekly grid → savers (throttled)
    return myProfile(user);
  }
  async function saveSlots(user, b = {}) {
    const p = await profileOf(user.id); if (!p) throw E.bad("أنشئ ملف الإرشاد أولاً");
    const list = Array.isArray(b.slots) ? b.slots : []; if (list.length > 28) throw E.bad("الحد الأقصى 28 فترة في الأسبوع");
    const rows = list.map((s) => { const wd = Number(s?.weekday), a = hm(s?.start), z = hm(s?.end); if (!(Number.isInteger(wd) && wd >= 0 && wd <= 6) || a === null || z === null || z <= a) throw E.bad("فترة غير صالحة"); if (z - a < Number(p.minutes)) throw E.bad(`كل فترة يجب أن تتسع لجلسة واحدة على الأقل (${p.minutes} دقيقة)`); return { wd, a, z }; }).sort((x, y) => x.wd - y.wd || x.a - y.a);
    for (let i = 1; i < rows.length; i++) if (rows[i].wd === rows[i - 1].wd && rows[i].a < rows[i - 1].z) throw E.bad("فترتان متداخلتان في اليوم نفسه");
    const before = new Set((await slotsOf(user.id)).map((r) => `${r.weekday}|${r.start_min}|${r.end_min}`));
    await db.tx(async (tx) => { await tx.run("DELETE FROM mentor_slots WHERE mentor_id=$1", [user.id]); for (const r of rows) await tx.run("INSERT INTO mentor_slots(id,mentor_id,weekday,start_min,end_min) VALUES($1,$2,$3,$4,$5)", [id("ms"), user.id, r.wd, r.a, r.z]); });
    if (rows.some((r) => !before.has(`${r.wd}|${r.a}|${r.z}`))) await slotAlert(user.id); // M4-4: a new weekly period → savers (throttled)
    return myProfile(user);
  }
  async function deleteProfile(user) {
    if (await db.get("SELECT 1 x FROM mentor_sessions WHERE mentor_id=$1 AND status IN ('pending','confirmed') AND starts_at > $2", [user.id, iso(clock() - 2 * 3600e3)])) throw E.conflict("لديك جلسات قادمة؛ ألغها أو أتمّها قبل حذف الملف");
    await db.run("DELETE FROM mentor_slots WHERE mentor_id=$1", [user.id]);
    await db.run("DELETE FROM mentor_profiles WHERE user_id=$1 AND status<>'suspended'", [user.id]);
    await db.run("UPDATE mentor_requests SET status='closed', decided_at=$1 WHERE mentor_id=$2 AND status='open'", [iso(), user.id]);
    return { ok: true };
  }

  /* ---------- free slots (server-side, from the weekly grid) ---------- */
  async function freeSlots(p, learnerId = null, days = HORIZON) {
    const rules = await slotsOf(p.user_id); if (!rules.length) return [];
    const t0 = clock(), from = t0 + NOTICE, until = t0 + days * DAY + DAY, mins = Number(p.minutes), step = Math.ceil(mins / 15) * 15;
    const busy = await db.all("SELECT starts_at, minutes FROM mentor_sessions WHERE (mentor_id=$1 OR learner_id=$2 OR mentor_id=$2 OR learner_id=$1) AND status IN ('pending','confirmed') AND starts_at > $3", [p.user_id, learnerId || "-", iso(t0 - DAY)]);
    const bz = busy.map((s) => [Date.parse(s.starts_at), Date.parse(s.starts_at) + Number(s.minutes) * MIN]);
    const out = [], seen = new Set();
    for (let i = 0; i <= days; i++) {
      const lp = partsAt(p.tz, t0 + i * DAY);
      for (const r of rules.filter((x) => Number(x.weekday) === lp.wd)) {
        for (let m = Number(r.start_min); m + mins <= Number(r.end_min); m += step) {
          const s = zoned(p.tz, lp.y, lp.m, lp.d, m), e = s + mins * MIN;
          if (s < from || s > until || seen.has(s)) continue;
          if (bz.some(([a, z]) => s < z && e > a)) continue;
          seen.add(s); out.push(s);
        }
      }
    }
    return out.sort((a, b) => a - b).slice(0, 120).map((s) => iso(s));
  }

  /* ---------- 2. directory + matching ---------- */
  async function directory(viewer, q = {}) {
    const minor = viewer ? await isMinor(viewer.id) : false;
    let rows = await db.all("SELECT p.*, u.name, u.handle, u.color, u.avatar, u.verified, u.status us, u.prefs FROM mentor_profiles p JOIN users u ON u.id=p.user_id WHERE p.open=1 AND p.status='active' AND u.status='active' ORDER BY p.updated_at DESC LIMIT 400");
    const topic = TOPICS[q.topic] ? q.topic : null, lang = String(q.lang || "").trim(), text = String(q.q || "").trim().toLowerCase().slice(0, 60), price = oneOf(q.price, ["free", "paid"], null);
    if (minor) rows = rows.filter((r) => Number(r.allow_minors) && !Number(r.price));
    if (topic) rows = rows.filter((r) => parse(r.topics, []).includes(topic));
    if (lang) rows = rows.filter((r) => String(r.languages || "").includes(lang));
    if (price) rows = rows.filter((r) => (price === "free" ? !Number(r.price) : Number(r.price) > 0));
    if (text) rows = rows.filter((r) => [r.name, r.handle, r.headline, r.bio, ...parse(r.topics, []).map((k) => TOPICS[k])].join(" ").toLowerCase().includes(text));
    if (viewer) { const bs = await blockSet(viewer.id, rows); rows = rows.filter((r) => r.user_id !== viewer.id && !bs.has(r.user_id)); } // M1-1: blocked mentors never listed
    rows = rows.filter((r) => listable(r, viewer));
    const ag = await aggregates(rows.map((r) => r.user_id));
    const score = (r) => { const a = ag.get(r.user_id); return (a.avg ? a.avg * Math.log2(a.count + 1) : 0) + Math.log2(a.sessions + 1) + (a.hasSlots ? 2 : 0); };
    const list = rows.map((r) => ({ r, s: score(r) })).sort((x, y) => y.s - x.s).slice(0, 60).map(({ r }) => profileView(viewer ? "member" : "guest", r, { id: r.user_id, name: r.name, handle: r.handle, color: r.color, avatar: r.avatar, verified: r.verified }, ag.get(r.user_id)));
    const counts = {}; for (const r of rows) for (const k of parse(r.topics, [])) counts[k] = (counts[k] || 0) + 1;
    if (viewer && list.length) { const ids = list.map((m) => m.user.id); const sv = new Set((await db.all(`SELECT mentor_id FROM mentor_saves WHERE user_id=$1 AND mentor_id IN (${ph(ids, 1)})`, [viewer.id, ...ids])).map((r) => r.mentor_id)); for (const m of list) m.saved = sv.has(m.user.id); } // M4-3
    return { mentors: list, topics: TOPICS, counts, minor, piEnabled: piOn() };
  }
  async function match(viewer, q = {}) {
    const topic = TOPICS[q.topic] ? q.topic : null; if (!topic) throw E.bad("اختر موضوعاً");
    const d = await directory(viewer, { topic });
    const goal = String(q.goal || "").toLowerCase();
    const ranked = [];
    for (const m of d.mentors.filter((x) => x.bookable).slice(0, 12)) {
      const p = await profileOf(m.user.id); const slots = await freeSlots(p, viewer?.id, 7);
      const words = goal.split(/\s+/).filter((w) => w.length > 2); const hit = words.filter((w) => (m.headline + " " + m.bio).toLowerCase().includes(w)).length;
      const reasons = [`يرشد في «${TOPICS[topic]}»`];
      if (m.rating?.count) reasons.push(`تقييمه ${m.rating.avg} من ${m.rating.count}`);
      if (m.sessions) reasons.push(`أتمّ ${m.sessions} جلسة`);
      if (slots.length) reasons.push("متاح خلال هذا الأسبوع");
      if (hit) reasons.push("خبرته قريبة من هدفك");
      if (!m.paid) reasons.push("جلساته مجانية");
      ranked.push({ mentor: m, nextSlot: slots[0] || null, reasons, s: (m.rating?.avg || 3.5) * Math.log2((m.rating?.count || 0) + 2) + (slots.length ? 3 : 0) + hit * 1.5 + Math.log2((m.sessions || 0) + 1) });
    }
    return { topic: { key: topic, label: TOPICS[topic] }, matches: ranked.sort((a, b) => b.s - a.s).slice(0, 3).map(({ s, ...x }) => x) };
  }
  /* M2-4: reviews paging — opaque cursor "<created_at>|<session_id>" (newest first, ties broken by session id) */
  const REV_PAGE = 20;
  const revAt = (v) => (v instanceof Date ? v.toISOString() : String(v ?? ""));
  function parseRevCursor(c) {
    const m = /^([0-9T:.\-+Z ]{10,40})\|([A-Za-z0-9_-]{1,80})$/.exec(String(c || ""));
    if (!m) throw fail(400, "bad_cursor", "مؤشر التقييمات غير صالح");
    return [m[1], m[2]];
  }
  async function reviewsPage(uid, cursor) {
    const cur = cursor ? parseRevCursor(cursor) : null;
    const fb = await db.all(`SELECT f.rating, f.comment, f.created_at, f.by_user, f.session_id, s.topic FROM mentor_feedback f JOIN mentor_sessions s ON s.id=f.session_id WHERE f.about_user=$1 AND f.rating IS NOT NULL${cur ? " AND (f.created_at < $2 OR (f.created_at = $2 AND f.session_id < $3))" : ""} ORDER BY f.created_at DESC, f.session_id DESC LIMIT ${REV_PAGE + 1}`, cur ? [uid, cur[0], cur[1]] : [uid]);
    const more = fb.length > REV_PAGE; if (more) fb.length = REV_PAGE;
    const authors = await usersOf(fb.map((f) => f.by_user)); const minorSet = await minorSetOf(authors.map((a) => a.id));
    const last = fb[fb.length - 1];
    return { reviews: fb.map((f) => { const a = authors.find((x) => x.id === f.by_user); return { rating: Number(f.rating), comment: f.comment || "", at: f.created_at, topic: TOPICS[f.topic] || f.topic, by: minorSet.has(f.by_user) || !a || a.status !== "active" ? { name: "متعلّم" } : { name: a.name, handle: a.handle } }; }), reviewsNext: more && last ? `${revAt(last.created_at)}|${last.session_id}` : null };
  }
  /* M2-4: guardian card — only for an active guardian of a linked MINOR who is (or was) this mentor's learner. Safety facts +
   *  session counts/next date only: never notes, goals, feedback text or room ids. */
  async function guardianCard(viewer, p, u) {
    if (!viewer || viewer.id === p.user_id) return null;
    const kids = (await db.all("SELECT minor_id FROM guardian_links WHERE guardian_id=$1 AND status='active'", [viewer.id]).catch(() => [])).map((r) => r.minor_id);
    const mine = [];
    for (const k of kids) if ((await isMinor(k)) && (await menteeOf(p.user_id, k))) mine.push(k);
    if (!mine.length) return null;
    const rows = await db.all(`SELECT learner_id, status, starts_at FROM mentor_sessions WHERE mentor_id=$1 AND learner_id IN (${mine.map((_, i) => "$" + (i + 2)).join(",")})`, [p.user_id, ...mine]);
    const t = clock(), sum = { total: rows.length, upcoming: 0, completed: 0, cancelled: 0 };
    let next = null;
    for (const r of rows) {
      const st = Date.parse(revAt(r.starts_at));
      if (["pending", "confirmed"].includes(r.status) && st > t) { sum.upcoming++; if (!next || st < Date.parse(next.startsAt)) next = { startsAt: new Date(st).toISOString(), status: r.status, statusLabel: STATUSES[r.status] }; }
      else if (r.status === "completed") sum.completed++;
      else if (["cancelled", "no_show"].includes(r.status)) sum.cancelled++;
    }
    const learners = (await usersOf(mine)).map((x) => ({ name: x.name, handle: x.handle }));
    return { learners, sessions: sum, next, safety: { verified: !!u.verified, allowMinors: !!Number(p.allow_minors), active: p.status === "active", since: p.created_at, guardianNotified: true, guardianCanJoin: true, notesPrivate: true } };
  }
  /* M2-4: public communities the mentor belongs to (field level "communities"; private / invite / archived never listed) */
  async function mentorCommunities(uid) {
    const rows = await db.all("SELECT c.id, c.name, c.color, c.topic, c.member_count FROM memberships m JOIN communities c ON c.id=m.community WHERE m.user_id=$1 AND c.type='public' AND c.archived_at IS NULL AND m.role NOT IN ('pending','banned') ORDER BY m.joined_at DESC LIMIT 12", [uid]).catch(() => []);
    return rows.map((c) => ({ id: c.id, name: c.name, color: c.color || null, topic: c.topic || null, members: Number(c.member_count) || 0 }));
  }
  async function mentorPage(viewer, handle, q = {}) {
    const u = await byHandle(handle); const p = await profileOf(u.id);
    if (!p || (p.status !== "active" && viewer?.id !== u.id && viewer?.role !== "admin")) throw E.nf("لا يوجد ملف إرشاد لهذا الحساب");
    const rel = await viewerRel(viewer, p); if (!rel) throw E.nf("لا يوجد ملف إرشاد لهذا الحساب");
    const fl = withDefaults(p).fields, statsOn = fieldOn(fl.stats, rel);
    if (viewer && viewer.id !== u.id && viewer.role !== "admin" && (await blocked(viewer.id, u.id))) throw E.nf("لا يوجد ملف إرشاد لهذا الحساب"); // M1-1: blocked → 404, no existence leak
    // v2.65 privacy: «التقييمات والإحصاءات» hidden for this viewer → no reviews in JSON at all (first page or «عرض المزيد»)
    if (q.reviewsBefore !== undefined) return statsOn ? reviewsPage(u.id, q.reviewsBefore) : { reviews: [], reviewsNext: null }; // M2-4: «عرض المزيد» — reviews only, same access rules
    const ag = (await aggregates([u.id])).get(u.id);
    const rv = statsOn ? await reviewsPage(u.id, null) : { reviews: [], reviewsNext: null };
    const dist = [0, 0, 0, 0, 0]; for (const r of await db.all("SELECT rating, COUNT(*) n FROM mentor_feedback WHERE about_user=$1 AND rating IS NOT NULL GROUP BY rating", [u.id])) dist[Number(r.rating) - 1] = Number(r.n);
    const me = { self: viewer?.id === u.id, signedIn: !!viewer, canBook: false, why: null, minor: false, upcoming: [], request: null };
    if (viewer && !me.self) {
      me.minor = await isMinor(viewer.id);
      me.why = await bookBlock(viewer, p, me.minor, rel);
      if (!me.why && !fieldOn(fl.contact, rel)) me.why = fl.contact === "off" ? "المرشد لا يستقبل التواصل عبر الملف حالياً" : "التواصل مع هذا المرشد متاح لمتعلّميه فقط";
      me.canBook = !me.why;
      me.upcoming = (await db.all("SELECT * FROM mentor_sessions WHERE mentor_id=$1 AND learner_id=$2 AND status IN ('pending','confirmed') AND starts_at > $3 ORDER BY starts_at", [u.id, viewer.id, iso(clock() - 2 * 3600e3)])).map((s) => ({ id: s.id, startsAt: s.starts_at, status: s.status, statusLabel: STATUSES[s.status] }));
      const rq = await db.get("SELECT * FROM mentor_requests WHERE mentor_id=$1 AND learner_id=$2 AND status IN ('open','accepted') ORDER BY created_at DESC LIMIT 1", [u.id, viewer.id]);
      me.request = rq ? { id: rq.id, status: rq.status, statusLabel: REQ_STATUSES[rq.status], reply: rq.reply || null } : null;
    }
    if (viewer && !me.self) { const sv = await db.get("SELECT notify_slots FROM mentor_saves WHERE user_id=$1 AND mentor_id=$2", [viewer.id, u.id]); me.saved = !!sv; me.notifySlots = !!Number(sv?.notify_slots); me.canSave = me.saved || !(await saveBlock(viewer, p, me.minor)); }
    me.relation = rel;
    const resources = await resourcesFor(u.id, await seesMenteeRes(rel, u.id, viewer));
    return { mentor: profileView(rel, p, u, ag, fieldOn(fl.age, rel) ? await ageOf(u.id) : null), resources, reviews: rv.reviews, reviewsNext: rv.reviewsNext, distribution: statsOn ? dist : null, me, statuses: STATUSES, guardian: await guardianCard(viewer, p, u), communities: fieldOn(fl.communities, rel) ? await mentorCommunities(u.id) : undefined };
  }
  async function bookBlock(viewer, p, minor, rel) {
    if (viewer.id === p.user_id) return "لا يمكنك حجز جلسة مع نفسك";
    if (p.status !== "active" || !Number(p.open)) return "المرشد لا يستقبل جلسات حالياً";
    if (await blocked(viewer.id, p.user_id)) return "لا يمكن الحجز مع هذا الحساب";
    // M2: the mentor's contact field level gates booking server-side (public / mentees / off), same rule as the page's canBook
    if (rel === undefined) rel = await viewerRel(viewer, p);
    if (!rel) return "لا يمكن الحجز مع هذا الحساب";
    const contact = withDefaults(p).fields.contact;
    if (!fieldOn(contact, rel)) return contact === "off" ? "المرشد لا يستقبل التواصل عبر الملف حالياً" : "التواصل مع هذا المرشد متاح لمتعلّميه فقط";
    if (minor) {
      if (!Number(p.allow_minors)) return "هذا المرشد لا يستقبل من هم دون ١٨ سنة";
      if (Number(p.price) > 0) return "الجلسات المدفوعة غير متاحة لمن هم دون ١٨ سنة";
      if (!(await guardiansOf(viewer.id)).length) return "يلزم ربط حسابك بوليّ أمر (من «العائلة») قبل الحجز";
    }
    if (Number(p.price) > 0 && !piOn()) return "الجلسات المدفوعة متوقفة حتى تفعيل مدفوعات Pi";
    return null;
  }
  /* ---------- M4-3/M4-4 (F9) saved mentors + new-slot notice ----------
   *  A signed-in member bookmarks a mentor (mentor_saves, 069): idempotent, never self, only a mentor the viewer can see
   *  (viewerRel, blocks) and — for a minor — only one they are allowed to book (allows minors, free, active guardian link).
   *  notify_slots (default 1): when the mentor adds a new weekly period (or reopens with periods), each saver gets ONE in-app
   *  mentor_slots notification per 24 h (last_notified_at, claimed atomically). The notice carries only the public handle
   *  (ref) and the mentor as actor (public name) — never a private profile field. */
  const SAVE_GAP = 24 * 3600e3;
  const mentorRow = async (key) => {
    const k = String(key || "").replace(/^@/, "").slice(0, 80); if (!k) throw E.nf("لا يوجد ملف إرشاد لهذا الحساب");
    const u = await db.get("SELECT id, name, handle, color, avatar, verified, status FROM users WHERE id=$1 OR LOWER(handle)=LOWER($1)", [k]);
    const p = u && u.status === "active" ? await profileOf(u.id) : null;
    if (!p || p.status !== "active") throw E.nf("لا يوجد ملف إرشاد لهذا الحساب");
    return { u, p };
  };
  /** why `viewer` may not save/keep-notified mentor profile p (null = allowed); minors reuse the booking rules */
  async function saveBlock(viewer, p, minor) {
    if (viewer.id === p.user_id) return { code: "self", msg: "لا يمكنك حفظ ملفك" };
    if (!(await viewerRel(viewer, p))) return { code: "nf" };
    if (minor) {
      if (!Number(p.allow_minors)) return { code: "minor_restricted", msg: "هذا المرشد لا يستقبل من هم دون ١٨ سنة" };
      if (Number(p.price) > 0) return { code: "minor_restricted", msg: "الجلسات المدفوعة غير متاحة لمن هم دون ١٨ سنة" };
      if (!(await guardiansOf(viewer.id)).length) return { code: "guardian_required", msg: "يلزم ربط حسابك بوليّ أمر (من «العائلة») أولاً" };
    }
    return null;
  }
  async function saveMentor(user, key) {
    if (!rl.hit("default", "msave:" + user.id)) throw E.rate();
    const { u, p } = await mentorRow(key);
    const why = await saveBlock(user, p, await isMinor(user.id));
    if (why) { if (why.code === "nf") throw E.nf("لا يوجد ملف إرشاد لهذا الحساب"); throw fail(why.code === "self" ? 400 : 403, why.code, why.msg); }
    await db.run("INSERT INTO mentor_saves(user_id, mentor_id, created_at, notify_slots) VALUES($1,$2,$3,1) ON CONFLICT (user_id, mentor_id) DO NOTHING", [user.id, u.id, iso()]);
    const r = await db.get("SELECT notify_slots FROM mentor_saves WHERE user_id=$1 AND mentor_id=$2", [user.id, u.id]);
    return { saved: true, notifySlots: !!Number(r?.notify_slots) };
  }
  async function unsaveMentor(user, key) {
    const k = String(key || "").replace(/^@/, "").slice(0, 80);
    const u = await db.get("SELECT id FROM users WHERE id=$1 OR LOWER(handle)=LOWER($1)", [k]);
    if (u) await db.run("DELETE FROM mentor_saves WHERE user_id=$1 AND mentor_id=$2", [user.id, u.id]); // idempotent; works even if the mentor left
    return { saved: false, notifySlots: false };
  }
  async function setSaveNotify(user, key, b = {}) {
    if (typeof b.notify !== "boolean") throw bad("invalid_notify", "قيمة التنبيه غير صالحة");
    const k = String(key || "").replace(/^@/, "").slice(0, 80);
    const u = await db.get("SELECT id FROM users WHERE id=$1 OR LOWER(handle)=LOWER($1)", [k]);
    const ch = u ? await db.run("UPDATE mentor_saves SET notify_slots=$1 WHERE user_id=$2 AND mentor_id=$3", [b.notify ? 1 : 0, user.id, u.id]) : null;
    if (!ch || !ch.changes) throw E.nf("لم تحفظ هذا المرشد");
    return { saved: true, notifySlots: b.notify };
  }
  async function savedList(user) {
    const rows = await db.all("SELECT s.mentor_id, s.notify_slots, s.created_at saved_at, p.*, u.name, u.handle, u.color, u.avatar, u.verified FROM mentor_saves s JOIN mentor_profiles p ON p.user_id=s.mentor_id JOIN users u ON u.id=s.mentor_id WHERE s.user_id=$1 AND p.status='active' AND u.status='active' ORDER BY s.created_at DESC LIMIT 100", [user.id]);
    const keep = []; for (const r of rows) if (await viewerRel(user, r)) keep.push(r); // hidden / blocked → silently left out (row stays, no leak)
    const ag = await aggregates(keep.map((r) => r.user_id));
    return { saved: keep.map((r) => ({ mentor: profileView("member", r, { id: r.user_id, name: r.name, handle: r.handle, color: r.color, avatar: r.avatar, verified: r.verified }, ag.get(r.user_id)), notifySlots: !!Number(r.notify_slots), savedAt: r.saved_at })) };
  }
  /** M4-4: tell savers (notify_slots=1, not notified in the last 24 h, still allowed) that mentorId has new free periods */
  async function slotAlert(mentorId) {
    try {
      const p = await profileOf(mentorId); if (!p || p.status !== "active" || !Number(p.open)) return 0;
      if (!(await slotsOf(mentorId)).length) return 0;
      const now = clock(), cut = iso(now - SAVE_GAP);
      const savers = await db.all("SELECT user_id FROM mentor_saves WHERE mentor_id=$1 AND notify_slots=1 AND (last_notified_at IS NULL OR last_notified_at <= $2) LIMIT 2000", [mentorId, cut]);
      if (!savers.length) return 0;
      const u = await db.get("SELECT handle FROM users WHERE id=$1", [mentorId]); const minors = await minorSetOf(savers.map((s) => s.user_id));
      let sent = 0;
      for (const s of savers) {
        const viewer = await db.get("SELECT id, role, status FROM users WHERE id=$1", [s.user_id]); if (!viewer || viewer.status !== "active") continue;
        if (await saveBlock(viewer, p, minors.has(s.user_id))) continue;
        const ch = await db.run("UPDATE mentor_saves SET last_notified_at=$1 WHERE user_id=$2 AND mentor_id=$3 AND notify_slots=1 AND (last_notified_at IS NULL OR last_notified_at <= $4)", [iso(now), s.user_id, mentorId, cut]);
        if (!ch.changes) continue; // a concurrent save already claimed this 24 h window
        await notify(s.user_id, "mentor_slots", u.handle, mentorId); sent++;
      }
      return sent;
    } catch (err) { ctx.log?.error?.("mentor slot alert failed", { err: err.message }); return 0; }
  }
  async function slotsRoute(viewer, handle, q = {}) {
    const u = await byHandle(handle); const p = await profileOf(u.id); if (!p || p.status !== "active" || !(await viewerRel(viewer, p))) throw E.nf("لا يوجد ملف إرشاد لهذا الحساب");
    if (viewer && viewer.id !== u.id && (await blocked(viewer.id, u.id))) throw E.nf("لا يوجد ملف إرشاد لهذا الحساب"); // M1-1
    const days = Math.min(HORIZON, Math.max(1, Math.round(+q.days || HORIZON)));
    return { tz: p.tz, minutes: Number(p.minutes), slots: Number(p.open) ? await freeSlots(p, viewer?.id, days) : [] };
  }

  /* ---------- 3. requests ---------- */
  const reqClient = (r, us, role) => ({ id: r.id, topic: { key: r.topic, label: TOPICS[r.topic] || r.topic }, goal: r.goal, level: r.level ? { key: r.level, label: LEVELS[r.level] } : null, status: r.status, statusLabel: REQ_STATUSES[r.status], reply: r.reply || null, createdAt: r.created_at, decidedAt: r.decided_at || null, direct: !!r.mentor_id, role,
    learner: userPub(us.find((u) => u.id === r.learner_id)), mentor: userPub(us.find((u) => u.id === r.mentor_id)), minor: !!r.minor });
  async function createRequest(user, b = {}) {
    if (!rl.hit("default", "mreq:" + user.id)) throw E.rate();
    const topic = TOPICS[b.topic] ? b.topic : null; if (!topic) throw E.bad("اختر موضوعاً");
    const goal = str(b.goal, 1000, { required: true, min: 10 }), level = oneOf(b.level, Object.keys(LEVELS), null);
    const minor = await isMinor(user.id);
    let mentorId = null;
    if (b.mentor) {
      const mu = await byHandle(b.mentor); const p = await profileOf(mu.id); if (!p || p.status !== "active") throw E.nf("لا يوجد ملف إرشاد لهذا الحساب");
      if (mu.id === user.id) throw E.bad("لا يمكنك مراسلة نفسك");
      if (!Number(p.open)) throw E.bad("المرشد لا يستقبل طلبات حالياً");
      if (await blocked(user.id, mu.id)) throw E.forbid("لا يمكن مراسلة هذا الحساب");
      if (minor && !Number(p.allow_minors)) throw fail(403, "minor_restricted", "هذا المرشد لا يستقبل من هم دون ١٨ سنة");
      if (await db.get("SELECT 1 x FROM mentor_requests WHERE learner_id=$1 AND mentor_id=$2 AND status='open'", [user.id, mu.id])) throw E.conflict("لديك طلب مفتوح لدى هذا المرشد");
      mentorId = mu.id;
    }
    if (minor && !(await guardiansOf(user.id)).length) throw fail(403, "guardian_required", "يلزم ربط حسابك بوليّ أمر (من «العائلة») قبل طلب الإرشاد");
    if (Number((await db.get("SELECT COUNT(*) n FROM mentor_requests WHERE learner_id=$1 AND status='open'", [user.id]))?.n || 0) >= 5) throw E.bad("لديك 5 طلبات مفتوحة؛ انتظر الردود أو اسحب أحدها");
    const rid = id("mrq");
    await db.run("INSERT INTO mentor_requests(id,learner_id,mentor_id,topic,goal,level,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'open',$7)", [rid, user.id, mentorId, topic, goal, level, iso()]);
    if (mentorId) await notify(mentorId, "mentor_request", rid, user.id);
    if (minor) for (const g of await guardiansOf(user.id)) await notify(g, "mentor_guardian", rid, user.id);
    return { request: reqClient(await db.get("SELECT * FROM mentor_requests WHERE id=$1", [rid]), await usersOf([user.id, mentorId]), "learner") };
  }
  async function requests(user) {
    const sent = await db.all("SELECT * FROM mentor_requests WHERE learner_id=$1 ORDER BY created_at DESC LIMIT 60", [user.id]);
    const received = await db.all("SELECT * FROM mentor_requests WHERE mentor_id=$1 ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, created_at DESC LIMIT 60", [user.id]);
    const p = await profileOf(user.id); let open = [];
    if (p && p.status === "active") {
      const topics = parse(p.topics, []);
      if (topics.length) open = (await db.all(`SELECT * FROM mentor_requests WHERE mentor_id IS NULL AND status='open' AND learner_id<>$1 AND topic IN (${ph(topics, 1)}) ORDER BY created_at DESC LIMIT 60`, [user.id, ...topics]));
      const keep = []; for (const r of open) { const m = await isMinor(r.learner_id); if (m && !Number(p.allow_minors)) continue; if (await blocked(user.id, r.learner_id)) continue; r.minor = m; keep.push(r); } open = keep;
    }
    for (const r of received) r.minor = await isMinor(r.learner_id);
    const us = await usersOf([...sent, ...received, ...open].flatMap((r) => [r.learner_id, r.mentor_id]));
    return { sent: sent.map((r) => reqClient(r, us, "learner")), received: received.map((r) => reqClient(r, us, "mentor")), open: open.map((r) => reqClient(r, us, "mentor")), mentor: !!(p && p.status === "active"), topics: TOPICS, levels: LEVELS };
  }
  async function decideRequest(user, rid, accept, b = {}) {
    const r = await db.get("SELECT * FROM mentor_requests WHERE id=$1", [rid]); if (!r) throw E.nf();
    if (r.status !== "open") throw E.conflict("تمت معالجة هذا الطلب");
    const p = await profileOf(user.id); if (!p || p.status !== "active") throw E.forbid("للمرشدين فقط");
    if (r.mentor_id && r.mentor_id !== user.id) throw E.nf(); // M1-1: another mentor's request → 404 (no existence leak)
    if (r.learner_id === user.id || (await blocked(user.id, r.learner_id))) throw E.nf(); // M1-1: own open request / blocked pair
    if (!r.mentor_id) { if (!accept) throw E.bad("الطلبات المفتوحة تُقبل فقط"); if (!parse(p.topics, []).includes(r.topic)) throw E.forbid(); if ((await isMinor(r.learner_id)) && !Number(p.allow_minors)) throw E.forbid(); }
    const reply = str(b.reply, 600);
    const ch = await db.run(`UPDATE mentor_requests SET status=$1, mentor_id=$2, reply=$3, decided_at=$4 WHERE id=$5 AND status='open'`, [accept ? "accepted" : "declined", user.id, reply, iso(), rid]);
    if (!ch.changes) throw E.conflict("تمت معالجة هذا الطلب");
    await notify(r.learner_id, "mentor_reply", rid, user.id);
    if (await isMinor(r.learner_id)) for (const g of await guardiansOf(r.learner_id)) await notify(g, "mentor_guardian", rid, user.id);
    const nr = await db.get("SELECT * FROM mentor_requests WHERE id=$1", [rid]);
    return { request: reqClient(nr, await usersOf([nr.learner_id, nr.mentor_id]), "mentor") };
  }
  async function withdrawRequest(user, rid) {
    const ch = await db.run("UPDATE mentor_requests SET status='withdrawn', decided_at=$1 WHERE id=$2 AND learner_id=$3 AND status='open'", [iso(), rid, user.id]);
    if (!ch.changes) throw E.nf(); return { ok: true };
  }

  /* ---------- 4. booking + sessions ---------- */
  const role = (s, uid, guardians = []) => (s.mentor_id === uid ? "mentor" : s.learner_id === uid ? "learner" : guardians.includes(uid) ? "guardian" : null);
  async function sessionFor(user, sid) {
    const s = await db.get("SELECT * FROM mentor_sessions WHERE id=$1", [sid]); if (!s) throw E.nf();
    const gs = Number(s.minor) ? await guardiansOf(s.learner_id) : [];
    const r = role(s, user.id, gs); if (!r && user.role !== "admin") throw E.nf();
    return { s, r: r || "staff", gs };
  }
  /** M1-4: a block between the two sides (or a minor's guardian and the mentor) made after booking shuts the room; cancel stays */
  const roomBarred = async (s, uid) => (await blocked(s.mentor_id, s.learner_id)) || (uid !== s.mentor_id && uid !== s.learner_id && (await blocked(uid, s.mentor_id)));
  function actionsOf(s, r, fbMine, barred = false) {
    const t = clock(), st = Date.parse(s.starts_at), en = st + Number(s.minutes) * MIN, a = [];
    if (r === "mentor" && s.status === "pending" && ["none", "held"].includes(s.pay_status)) a.push("confirm", "decline");
    if ((r === "mentor" || r === "learner") && ["pending", "confirmed"].includes(s.status) && t < en) a.push("cancel");
    if (r === "mentor" && s.status === "confirmed" && t >= st) a.push("complete");
    if (r === "mentor" && s.status === "confirmed" && t >= st + 10 * MIN) a.push("no_show");
    if (["mentor", "learner", "guardian"].includes(r) && s.status === "confirmed" && t >= st - 10 * MIN && t <= en + 30 * MIN && (r === "mentor" || s.room_id) && !barred) a.push("join");
    if ((r === "mentor" || r === "learner") && s.status === "completed" && !fbMine && t <= Date.parse(s.completed_at || s.starts_at) + 30 * DAY) a.push("feedback");
    if (r === "learner" && s.status === "pending" && s.pay_status === "pending") a.push("pay");
    return a;
  }
  async function sessionClient(s, viewerId, r, us, extra = {}) {
    const st = Date.parse(s.starts_at);
    return { id: s.id, topic: { key: s.topic, label: TOPICS[s.topic] || s.topic }, note: s.note || "", startsAt: s.starts_at, endsAt: iso(st + Number(s.minutes) * MIN), minutes: Number(s.minutes), status: s.status, statusLabel: STATUSES[s.status], price: pi(s.price), payStatus: s.pay_status, minor: !!Number(s.minor), role: r,
      mentor: userPub(us.find((u) => u.id === s.mentor_id)), learner: userPub(us.find((u) => u.id === s.learner_id)), roomId: s.room_id || null, cancelReason: s.cancel_reason || null, cancelledBy: s.cancelled_by ? (s.cancelled_by === s.mentor_id ? "mentor" : s.cancelled_by === s.learner_id ? "learner" : "staff") : null, completedAt: s.completed_at || null, ...extra };
  }
  async function book(user, handle, b = {}) {
    if (!rl.hit("default", "mbook:" + user.id)) throw E.rate();
    const mu = await byHandle(handle); const p = await profileOf(mu.id); if (!p || p.status !== "active") throw E.nf("لا يوجد ملف إرشاد لهذا الحساب");
    const minor = await isMinor(user.id);
    const why = await bookBlock(user, p, minor); // resolves the viewer relation: a hidden page / blocked pair → 403 (M1-1 contract), contact level enforced
    if (why) { if (Number(p.price) > 0 && !piOn() && !minor) throw E.off(why); throw fail(403, minor ? "minor_restricted" : "not_bookable", why); }
    const want = Date.parse(String(b.startsAt || "")); if (!Number.isFinite(want)) throw E.bad("اختر موعداً");
    const free = await freeSlots(p, user.id); if (!free.includes(iso(want))) throw E.conflict("هذا الموعد لم يعد متاحاً؛ اختر موعداً آخر");
    if (Number((await db.get("SELECT COUNT(*) n FROM mentor_sessions WHERE learner_id=$1 AND mentor_id=$2 AND status IN ('pending','confirmed') AND starts_at > $3", [user.id, mu.id, iso()]))?.n || 0) >= 3) throw E.bad("لديك 3 جلسات قادمة مع هذا المرشد");
    const topics = parse(p.topics, []); const topic = topics.includes(b.topic) ? b.topic : topics[0];
    let requestId = null;
    if (b.requestId) { const rq = await db.get("SELECT * FROM mentor_requests WHERE id=$1 AND learner_id=$2 AND mentor_id=$3", [String(b.requestId), user.id, mu.id]); if (rq) requestId = rq.id; }
    const sid = id("mss"), t = iso(), price = Number(p.price), fee = Math.floor((price * feeBps()) / 10000);
    await db.run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13,$13)",
      [sid, mu.id, user.id, requestId, topic, str(b.note, 1000), iso(want), Number(p.minutes), price, fee, price > 0 ? "pending" : "none", minor ? 1 : 0, t]);
    let intent = null;
    if (price > 0) {
      try { const it = await ctx.services.pi.createIntent(user, { amount: pi(price), memo: `جلسة إرشاد مع @${mu.handle}`.slice(0, 200), purpose: "mentor", refId: sid }); intent = { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata }; await db.run("UPDATE mentor_sessions SET intent_id=$1 WHERE id=$2", [it.id, sid]); }
      catch (e) { await db.run("DELETE FROM mentor_sessions WHERE id=$1", [sid]); throw e; }
    } else await notify(mu.id, "mentor_booked", sid, user.id);
    if (requestId) await db.run("UPDATE mentor_requests SET status='closed' WHERE id=$1 AND status='accepted'", [requestId]);
    if (minor) for (const g of await guardiansOf(user.id)) await notify(g, "mentor_guardian", sid, user.id);
    const s = await db.get("SELECT * FROM mentor_sessions WHERE id=$1", [sid]);
    return { session: await sessionClient(s, user.id, "learner", await usersOf([s.mentor_id, s.learner_id]), { actions: actionsOf(s, "learner", false) }), intent };
  }
  async function sessions(user, q = {}) {
    const when = q.when === "past" ? "past" : "upcoming", t = iso(clock() - 2 * 3600e3);
    const gl = (await db.all("SELECT minor_id FROM guardian_links WHERE guardian_id=$1 AND status='active'", [user.id]).catch(() => [])).map((r) => r.minor_id);
    let where, args;
    if (q.role === "mentor") { where = "mentor_id=$1"; args = [user.id]; }
    else if (q.role === "learner") { where = "learner_id=$1"; args = [user.id]; }
    else if (q.role === "family") { if (!gl.length) return { sessions: [], family: false, statuses: STATUSES }; where = `minor=1 AND learner_id IN (${ph(gl)})`; args = [...gl]; }
    else { where = "(mentor_id=$1 OR learner_id=$1)"; args = [user.id]; }
    const n = args.length + 1;
    const sql = `SELECT * FROM mentor_sessions WHERE ${where} AND ${when === "upcoming" ? `status IN ('pending','confirmed') AND starts_at > $${n} ORDER BY starts_at` : `(status NOT IN ('pending','confirmed') OR starts_at <= $${n}) ORDER BY starts_at DESC`} LIMIT 100`;
    const rows = await db.all(sql, [...args, t]);
    const us = await usersOf(rows.flatMap((s) => [s.mentor_id, s.learner_id]));
    const fb = rows.length ? await db.all(`SELECT session_id FROM mentor_feedback WHERE by_user=$1 AND session_id IN (${ph(rows.map((r) => r.id), 1)})`, [user.id, ...rows.map((r) => r.id)]) : [];
    const out = []; for (const s of rows) { const r = role(s, user.id, gl.includes(s.learner_id) ? [user.id] : []); out.push(await sessionClient(s, user.id, r, us, { actions: actionsOf(s, r, fb.some((f) => f.session_id === s.id)) })); }
    return { sessions: out, family: gl.length > 0, statuses: STATUSES };
  }
  async function sessionView(user, sid) {
    const { s, r } = await sessionFor(user, sid);
    const us = await usersOf([s.mentor_id, s.learner_id]);
    const notes = await db.all("SELECT * FROM mentor_notes WHERE session_id=$1", [sid]);
    const mine = notes.find((n) => n.user_id === user.id), other = notes.find((n) => n.user_id !== user.id && Number(n.shared) && (r === "mentor" || r === "learner"));
    const fbs = await db.all("SELECT * FROM mentor_feedback WHERE session_id=$1", [sid]);
    const fbMine = fbs.find((f) => f.by_user === user.id), fbOther = fbs.find((f) => f.by_user !== user.id && r === "mentor" && f.by_user === s.learner_id); // M1-4: the mentor's feedback is private to its author; the learner's review is public anyway
    return { session: await sessionClient(s, user.id, r, us, {
      actions: actionsOf(s, r, !!fbMine, await roomBarred(s, user.id)), myNote: r === "mentor" || r === "learner" ? (mine ? { body: mine.body, shared: !!Number(mine.shared), updatedAt: mine.updated_at } : null) : null,
      sharedNote: other ? { body: other.body, by: other.user_id === s.mentor_id ? "mentor" : "learner", updatedAt: other.updated_at } : null,
      feedback: { mine: fbMine ? { rating: fbMine.rating === null ? null : Number(fbMine.rating), comment: fbMine.comment || "" } : null, other: fbOther ? { rating: fbOther.rating === null ? null : Number(fbOther.rating), comment: fbOther.comment || "" } : null },
      icsUrl: `/api/mentor-sessions/${encodeURIComponent(s.id)}/ics` }) };
  }
  /* ---------- M3-4 session agenda: ≤ AGENDA_MAX points (≤ AGENDA_LEN chars) the learner writes before the session; the
   * mentor ticks them during/after. Only the two participants read it (+ a minor's guardian, read-only); staff do not.
   * Stored in mentor_sessions.agenda (migration 068) as [{t, done}]; empty → NULL. ---------- */
  const AGENDA_MAX = 5, AGENDA_LEN = 140;
  const agendaOf = (s) => { const a = parse(s.agenda, []); return Array.isArray(a) ? a.filter((x) => x && typeof x.t === "string").slice(0, AGENDA_MAX).map((x) => ({ t: x.t, done: !!x.done })) : []; };
  const agendaRights = (s, r) => {
    const live = ["pending", "confirmed"].includes(s.status);
    return { canEdit: r === "learner" && live && clock() < Date.parse(s.starts_at), canTick: r === "mentor" && ["confirmed", "completed"].includes(s.status) };
  };
  async function agendaFor(user, sid) {
    const { s, r } = await sessionFor(user, sid);
    if (!["mentor", "learner", "guardian"].includes(r)) throw E.nf(); // staff: the agenda is private to the pair
    return { s, r };
  }
  const agendaClient = (s, r, items) => ({ agenda: { items, role: r, ...agendaRights(s, r), max: AGENDA_MAX, maxLen: AGENDA_LEN } });
  async function agendaView(user, sid) { const { s, r } = await agendaFor(user, sid); return agendaClient(s, r, agendaOf(s)); }
  async function saveAgenda(user, sid, b = {}) {
    if (!rl.hit("default", "magenda:" + user.id)) throw E.rate();
    const { s, r } = await agendaFor(user, sid);
    const rights = agendaRights(s, r), cur = agendaOf(s);
    let next;
    if (r === "learner") {
      if (!rights.canEdit) throw E.forbid("لا يمكن تعديل الأجندة بعد بدء الجلسة");
      if (!Array.isArray(b.items)) throw E.bad("الأجندة غير صالحة");
      if (b.items.length > AGENDA_MAX) throw E.bad(`الحد الأقصى ${AGENDA_MAX} نقاط`);
      next = b.items.map((x) => String((x && typeof x === "object" ? x.t : x) ?? "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim());
      if (next.some((t) => !t)) throw E.bad("نقطة فارغة");
      if (next.some((t) => [...t].length > AGENDA_LEN)) throw E.bad(`كل نقطة ${AGENDA_LEN} حرفاً كحد أقصى`);
      next = next.map((t) => ({ t, done: !!cur.find((c) => c.t === t)?.done }));
    } else if (r === "mentor") {
      if (!rights.canTick) throw E.forbid("تُعلَّم نقاط الأجندة بعد تأكيد الجلسة");
      const i = Number(b.index);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length || typeof b.done !== "boolean") throw E.bad("النقطة غير موجودة");
      next = cur.map((x, k) => (k === i ? { ...x, done: b.done } : x));
    } else throw E.forbid("وليّ الأمر يطّلع على الأجندة فقط");
    await db.run("UPDATE mentor_sessions SET agenda=$1, updated_at=$2 WHERE id=$3", [next.length ? JSON.stringify(next) : null, iso(), sid]);
    return agendaClient(s, r, next);
  }
  async function tell(s, kind, actorId) {
    for (const uid of [s.mentor_id, s.learner_id]) if (uid !== actorId) await notify(uid, kind, s.id, actorId);
    if (Number(s.minor)) for (const g of await guardiansOf(s.learner_id)) await notify(g, "mentor_guardian", s.id, actorId);
  }
  async function release(s) {
    if (s.pay_status !== "held") return;
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE mentor_sessions SET pay_status='released' WHERE id=$1 AND pay_status='held'", [s.id]); if (!r.changes) return;
      await postJournal(tx, { ikey: `mentor:${s.id}:release`, kind: "mentor", source: "mentor", refId: s.id, creatorId: s.mentor_id, senderId: s.learner_id, piTx: s.intent_id, lines: [{ account: ACC.held, debit: Number(s.price) }, { account: ACC.earn(s.mentor_id), userId: s.mentor_id, credit: Number(s.price) - Number(s.fee) }, { account: ACC.fees, credit: Number(s.fee) }] });
    });
  }
  async function unwind(s) { // cancellation: a held payment goes back (refund_due for staff), a pending intent is dropped
    if (s.pay_status === "held") await db.tx(async (tx) => { const r = await tx.run("UPDATE mentor_sessions SET pay_status='refund_due' WHERE id=$1 AND pay_status='held'", [s.id]); if (r.changes) await reverseAll(tx, s.id, "mentor session cancelled"); });
    else if (s.pay_status === "pending") await db.run("UPDATE mentor_sessions SET pay_status='none' WHERE id=$1 AND pay_status='pending'", [s.id]);
  }
  async function act(user, sid, action, b = {}) {
    if (!rl.hit("default", "mact:" + user.id)) throw E.rate();
    const { s, r } = await sessionFor(user, sid);
    const fbMine = !!(await db.get("SELECT 1 x FROM mentor_feedback WHERE session_id=$1 AND by_user=$2", [sid, user.id]));
    if (!actionsOf(s, r, fbMine, action === "join" && (await roomBarred(s, user.id))).includes(action)) throw E.conflict("هذا الإجراء غير متاح لهذه الجلسة الآن");
    const t = iso();
    if (action === "confirm") { await db.run("UPDATE mentor_sessions SET status='confirmed', updated_at=$1 WHERE id=$2 AND status='pending'", [t, sid]); await tell(s, "mentor_session", user.id); }
    else if (action === "decline" || action === "cancel") {
      const reason = str(b.reason, 300, { required: action === "cancel", min: 3 }) || "اعتذر المرشد عن الموعد";
      const ch = await db.run("UPDATE mentor_sessions SET status='cancelled', cancel_reason=$1, cancelled_by=$2, updated_at=$3 WHERE id=$4 AND status IN ('pending','confirmed')", [reason, user.id, t, sid]);
      if (ch.changes) { await unwind(s); if (s.room_id) await ctx.services.rooms?.endRoom?.(s.room_id).catch(() => null); await tell(s, "mentor_session", user.id); }
    } else if (action === "complete" || action === "no_show") {
      const ch = await db.run("UPDATE mentor_sessions SET status=$1, completed_at=$2, updated_at=$2 WHERE id=$3 AND status='confirmed'", [action === "complete" ? "completed" : "no_show", t, sid]);
      if (ch.changes) { await release(s); if (s.room_id) await ctx.services.rooms?.endRoom?.(s.room_id).catch(() => null); await tell(s, action === "complete" ? "mentor_feedback" : "mentor_session", user.id); }
    } else if (action === "join") {
      if (r === "mentor" && !s.room_id) {
        const live = s.room_id ? null : await db.get("SELECT id FROM rooms WHERE host=$1 AND status='live'", [user.id]);
        if (live) throw E.conflict("لديك غرفة مباشرة مفتوحة؛ أنهها أولاً");
        const st = await ctx.services.rooms.createRoom(user, { title: `جلسة إرشاد: ${TOPICS[s.topic] || s.topic}`.slice(0, 100), topic: "mentor", notifyFollowers: false });
        await db.run("UPDATE mentor_sessions SET room_id=$1, updated_at=$2 WHERE id=$3", [st.room.id, t, sid]);
        await tell({ ...s, room_id: st.room.id }, "mentor_reminder", user.id);
        return { roomId: st.room.id };
      }
      return { roomId: s.room_id };
    } else if (action === "pay") {
      if (!piOn()) throw E.off("مدفوعات Pi غير مفعّلة بعد");
      const it = await ctx.services.pi.createIntent(user, { amount: pi(s.price), memo: "جلسة إرشاد", purpose: "mentor", refId: sid });
      await db.run("UPDATE mentor_sessions SET intent_id=$1 WHERE id=$2", [it.id, sid]);
      return { intent: { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata } };
    }
    return sessionView(user, sid);
  }
  async function saveNote(user, sid, b = {}) {
    const { s, r } = await sessionFor(user, sid); if (r !== "mentor" && r !== "learner") throw E.forbid();
    if (s.status === "cancelled") throw E.conflict("الجلسة ملغاة");
    const body = str(b.body, 4000); const t = iso();
    if (!body) { await db.run("DELETE FROM mentor_notes WHERE session_id=$1 AND user_id=$2", [sid, user.id]); return sessionView(user, sid); }
    const shared = b.shared ? 1 : 0;
    const u = await db.run("UPDATE mentor_notes SET body=$1, shared=$2, updated_at=$3 WHERE session_id=$4 AND user_id=$5", [body, shared, t, sid, user.id]);
    if (!u.changes) await db.run("INSERT INTO mentor_notes(session_id,user_id,body,shared,updated_at) VALUES($1,$2,$3,$4,$5)", [sid, user.id, body, shared, t]);
    if (shared) for (const uid of [s.mentor_id, s.learner_id]) if (uid !== user.id) await notify(uid, "mentor_session", sid, user.id);
    return sessionView(user, sid);
  }
  async function feedback(user, sid, b = {}) {
    const { s, r } = await sessionFor(user, sid);
    const has = !!(await db.get("SELECT 1 x FROM mentor_feedback WHERE session_id=$1 AND by_user=$2", [sid, user.id]));
    if (has) throw E.conflict("أرسلت تقييمك لهذه الجلسة");
    if (!actionsOf(s, r, false).includes("feedback")) throw E.conflict("التقييم متاح بعد اكتمال الجلسة");
    let rating = null;
    if (r === "learner") { rating = Math.round(Number(b.rating)); if (!(rating >= 1 && rating <= 5)) throw E.bad("اختر تقييماً من 1 إلى 5"); }
    const comment = str(b.comment, 600, { required: r === "mentor", min: r === "mentor" ? 3 : 0 });
    await db.run("INSERT INTO mentor_feedback(session_id,by_user,about_user,rating,comment,created_at) VALUES($1,$2,$3,$4,$5,$6)", [sid, user.id, r === "learner" ? s.mentor_id : s.learner_id, rating, comment, iso()]);
    await notify(r === "learner" ? s.mentor_id : s.learner_id, "mentor_feedback", sid, user.id);
    return sessionView(user, sid);
  }

  /* ---------- 5. live room access (phase 14 rooms ask every guard) ---------- */
  async function roomAccess(rid, uid) {
    const s = await db.get("SELECT mentor_id, learner_id, minor FROM mentor_sessions WHERE room_id=$1", [rid]).catch(() => null);
    if (!s) return true;
    if (await roomBarred(s, uid)) return false; // M1-4: blocked after booking → no room (view or join)
    if (uid === s.mentor_id || uid === s.learner_id) return true;
    return Number(s.minor) ? (await guardiansOf(s.learner_id)).includes(uid) : false;
  }

  /* ---------- iCal: per session + private feed ---------- */
  const vevent = (s, us, origin) => {
    const m = us.find((u) => u.id === s.mentor_id), l = us.find((u) => u.id === s.learner_id), st = Date.parse(s.starts_at);
    return ["BEGIN:VEVENT", `UID:${s.id}@mujtama.plus`, `DTSTAMP:${icsDate(clock())}`, `DTSTART:${icsDate(st)}`, `DTEND:${icsDate(st + Number(s.minutes) * MIN)}`, `SUMMARY:${icsEsc(`جلسة إرشاد: ${TOPICS[s.topic] || s.topic}`)}`,
      `DESCRIPTION:${icsEsc(`المرشد: ${m?.name || ""} · المتعلّم: ${l?.name || ""}\n${origin}/#/msession/${s.id}`)}`, `URL:${origin}/#/msession/${s.id}`, `STATUS:${s.status === "cancelled" ? "CANCELLED" : s.status === "pending" ? "TENTATIVE" : "CONFIRMED"}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc("جلسة إرشاد بعد ١٥ دقيقة")}`, "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT"].map(fold);
  };
  const cal = (rows, us, origin) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mujtama Plus//Mentorship//AR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:جلسات الإرشاد — مجتمع بلس", ...rows.flatMap((s) => vevent(s, us, origin)), "END:VCALENDAR", ""].join("\r\n");
  const originOf = (req) => { const h = req.headers.host || "localhost"; const proto = req.headers["x-forwarded-proto"] || (ctx.config?.secureCookies ? "https" : "http"); return `${String(proto).split(",")[0]}://${h}`; };
  async function sessionIcs(req, res) {
    const { s } = await sessionFor(req.user, req.params.id);
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="mentor-${s.id}.ics"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(cal([s], await usersOf([s.mentor_id, s.learner_id]), originOf(req)));
    return ctx.STREAM;
  }
  async function feed(user, rotate) {
    let f = await db.get("SELECT token FROM mentor_feeds WHERE user_id=$1", [user.id]);
    if (!f || rotate) { const tok = crypto.randomBytes(18).toString("base64url"); await db.run("DELETE FROM mentor_feeds WHERE user_id=$1", [user.id]); await db.run("INSERT INTO mentor_feeds(user_id,token,created_at) VALUES($1,$2,$3)", [user.id, tok, iso()]); f = { token: tok }; }
    return { path: `/mentor-feed/${f.token}.ics` };
  }
  async function ssr(req, res, url) {
    const m = /^\/mentor-feed\/([A-Za-z0-9_-]{16,40})\.ics$/.exec(url.pathname); if (!m) return false;
    const f = await db.get("SELECT user_id FROM mentor_feeds WHERE token=$1", [m[1]]);
    if (!f) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found"); return true; }
    const rows = await db.all("SELECT * FROM mentor_sessions WHERE (mentor_id=$1 OR learner_id=$1) AND starts_at > $2 AND status IN ('pending','confirmed','completed') ORDER BY starts_at LIMIT 200", [f.user_id, iso(clock() - 30 * DAY)]);
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" });
    res.end(cal(rows, await usersOf(rows.flatMap((s) => [s.mentor_id, s.learner_id])), originOf(req)));
    return true;
  }

  /* ---------- Pi payments (only while Pi payments are on) ---------- */
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "mentor") return;
    const s = await db.get("SELECT * FROM mentor_sessions WHERE intent_id=$1", [e.tx]); if (!s) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(s.price)) > 1) { ctx.log?.warn?.("mentor amount mismatch; session not paid", { session: s.id }); return; }
    const moved = await db.tx(async (tx) => {
      const r = await tx.run("UPDATE mentor_sessions SET pay_status='held', updated_at=$1 WHERE id=$2 AND pay_status='pending'", [iso(), s.id]); if (!r.changes) return false;
      await postJournal(tx, { ikey: `mentor:${s.id}:hold`, kind: "mentor_hold", source: "mentor", refId: s.id, creatorId: s.mentor_id, senderId: s.learner_id, piTx: e.tx, lines: [{ account: ACC.out(s.learner_id), userId: s.learner_id, debit: Number(s.price) }, { account: ACC.held, credit: Number(s.price) }] });
      return true;
    });
    if (moved) { if (s.status === "cancelled") await unwind({ ...s, pay_status: "held" }); else await notify(s.mentor_id, "mentor_booked", s.id, s.learner_id); }
  }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => {
    if (e.purpose !== "mentor") return;
    await db.run("UPDATE mentor_sessions SET status='cancelled', pay_status='none', cancel_reason='لم يكتمل الدفع', updated_at=$1 WHERE intent_id=$2 AND pay_status='pending' AND status='pending'", [iso(), e.tx]);
  }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => { if (e.purpose === "mentor") await db.run("UPDATE mentor_sessions SET pay_status='refunded', updated_at=$1 WHERE intent_id=$2 AND pay_status='refund_due'", [iso(), e.tx]); }));

  /* ---------- reminders + expiry (leased job) ---------- */
  async function tick() {
    const t = clock(); let reminded = 0, expired = 0;
    for (const s of await db.all("SELECT * FROM mentor_sessions WHERE status='confirmed' AND reminded=0 AND starts_at > $1 AND starts_at <= $2", [iso(t), iso(t + 3600e3)])) {
      const ch = await db.run("UPDATE mentor_sessions SET reminded=1 WHERE id=$1 AND reminded=0", [s.id]); if (!ch.changes) continue;
      await notify(s.mentor_id, "mentor_reminder", s.id); await notify(s.learner_id, "mentor_reminder", s.id); reminded++;
    }
    for (const s of await db.all("SELECT * FROM mentor_sessions WHERE status='pending' AND starts_at <= $1", [iso(t)])) {
      const ch = await db.run("UPDATE mentor_sessions SET status='cancelled', cancel_reason='انتهى الموعد قبل تأكيد المرشد', updated_at=$1 WHERE id=$2 AND status='pending'", [iso(t), s.id]);
      if (ch.changes) { await unwind(s); await notify(s.learner_id, "mentor_session", s.id); expired++; }
    }
    await weeklySummaries(t).catch(() => 0); // M3-5/F6 (count via weeklySummaries(); tick's return shape unchanged)
    return { reminded, expired };
  }

  /* ---------- M3-5/F6 weekly summary to guardians of minor mentees (runs inside the mentor tick) ----------
   *  per active guardian link of a MINOR with mentoring activity: completed sessions in the last 7 days, upcoming sessions,
   *  goals done/total + up to 3 titles. Never notes, feedback, agenda or messages. Opt-out: guardian_links.settings.mentorWeekly=0
   *  (default on, toggled from «الإعدادات العائلية»). Idempotent per link per ISO week: settings.mentorWeeklyWeek marks the
   *  week, and an existing mentor_weekly notification for that week+minor also blocks a resend. */
  const N = require("../lib/notify-lib");
  const jsonOf = (v) => { if (v && typeof v === "object") return v; try { const o = JSON.parse(v || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
  function isoWeek(ms) {
    const d = new Date(ms); const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const wd = day.getUTCDay() || 7; day.setUTCDate(day.getUTCDate() + 4 - wd);
    const y0 = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    return `${day.getUTCFullYear()}-W${String(Math.ceil(((day - y0) / DAY + 1) / 7)).padStart(2, "0")}`;
  }
  async function weeklyFor(minorId, t) {
    const n = async (sql, a) => Number((await db.get(sql, a))?.n || 0);
    const done = await n("SELECT COUNT(*) n FROM mentor_sessions WHERE learner_id=$1 AND status='completed' AND starts_at > $2 AND starts_at <= $3", [minorId, iso(t - 7 * DAY), iso(t)]);
    const upcoming = await n("SELECT COUNT(*) n FROM mentor_sessions WHERE learner_id=$1 AND status IN ('pending','confirmed') AND starts_at > $2", [minorId, iso(t)]);
    const goals = await db.all("SELECT title, status FROM mentor_goals WHERE mentee_id=$1 ORDER BY created_at, id LIMIT 200", [minorId]).catch(() => []);
    const open = goals.filter((g) => g.status !== "done"), titles = [...open, ...goals.filter((g) => g.status === "done")].map((g) => g.title);
    return { done, upcoming, goalsDone: goals.length - open.length, goalsTotal: goals.length, titles };
  }
  async function weeklySummaries(t = clock()) {
    const week = isoWeek(t); let sent = 0;
    const links = await db.all("SELECT id, guardian_id, minor_id, settings FROM guardian_links WHERE status='active' ORDER BY id LIMIT 2000", []).catch(() => []);
    for (const l of links) {
      const st = jsonOf(l.settings);
      if (st.mentorWeekly === 0 || st.mentorWeekly === false || st.mentorWeeklyWeek === week) continue;
      if (!(await isMinor(l.minor_id))) continue;
      const mark = async () => { const cur = jsonOf((await db.get("SELECT settings FROM guardian_links WHERE id=$1", [l.id]))?.settings); await db.run("UPDATE guardian_links SET settings=$1 WHERE id=$2", [{ ...cur, mentorWeeklyWeek: week }, l.id]); };
      const d = await weeklyFor(l.minor_id, t);
      if (!d.done && !d.upcoming && !d.goalsTotal) { await mark(); continue; } // no mentoring activity: nothing to tell this week
      const prefix = `mw1|${week}|${l.minor_id}|`;
      const dup = await db.get("SELECT id FROM notifications WHERE user_id=$1 AND kind='mentor_weekly' AND substr(ref,1,$2)=$3", [l.guardian_id, prefix.length, prefix]).catch(() => null);
      await mark();
      if (dup) continue;
      await notify(l.guardian_id, "mentor_weekly", N.weeklyRef(week, l.minor_id, d), l.minor_id); sent++;
    }
    return sent;
  }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("mentors.tick", +(env.MENTOR_TICK_INTERVAL_MS || 5 * 60e3), () => tick());

  /* ---------- 9. staff ---------- */
  async function adminView() {
    const n = async (sql, a = []) => Number((await db.get(sql, a))?.n || 0);
    const totals = { mentors: await n("SELECT COUNT(*) n FROM mentor_profiles WHERE status='active'"), open: await n("SELECT COUNT(*) n FROM mentor_profiles WHERE status='active' AND open=1"), suspended: await n("SELECT COUNT(*) n FROM mentor_profiles WHERE status='suspended'"),
      upcoming: await n("SELECT COUNT(*) n FROM mentor_sessions WHERE status IN ('pending','confirmed') AND starts_at > $1", [iso()]), completed: await n("SELECT COUNT(*) n FROM mentor_sessions WHERE status='completed'"), openRequests: await n("SELECT COUNT(*) n FROM mentor_requests WHERE status='open'"), minorSessions: await n("SELECT COUNT(*) n FROM mentor_sessions WHERE minor=1") };
    const rows = await db.all("SELECT p.*, u.name, u.handle, u.color, u.avatar, u.verified FROM mentor_profiles p JOIN users u ON u.id=p.user_id ORDER BY CASE WHEN p.status='suspended' THEN 0 ELSE 1 END, p.updated_at DESC LIMIT 200");
    const ag = await aggregates(rows.map((r) => r.user_id));
    const list = rows.map((r) => { const m = mentorClient(r, { id: r.user_id, name: r.name, handle: r.handle, color: r.color, avatar: r.avatar, verified: r.verified }, ag.get(r.user_id)); return { ...m, statusReason: r.status_reason || null, reviewedAt: r.reviewed_at || null, needsReview: m.allowMinors && !m.reviewed }; });
    totals.reviewed = list.filter((m) => m.reviewed).length; totals.unreviewed = list.length - totals.reviewed; totals.needsReview = list.filter((m) => m.needsReview).length;
    const refunds = await db.all("SELECT * FROM mentor_sessions WHERE pay_status='refund_due' ORDER BY updated_at DESC LIMIT 100");
    const us = await usersOf(refunds.flatMap((s) => [s.mentor_id, s.learner_id]));
    const rf = []; for (const s of refunds) rf.push(await sessionClient(s, null, "staff", us, { intentId: s.intent_id }));
    return { totals, mentors: list, lowRated: list.filter((m) => m.rating.count >= 3 && m.rating.avg < 3), refunds: rf, piEnabled: piOn() };
  }
  async function setStatus(by, uid, b = {}) {
    const p = await profileOf(uid); if (!p) throw E.nf();
    const status = oneOf(b.status, ["active", "suspended"], null); if (!status) throw E.bad();
    const reason = str(b.reason, 300, { required: status === "suspended", min: 3 });
    await db.run("UPDATE mentor_profiles SET status=$1, status_reason=$2, updated_at=$3 WHERE user_id=$4", [status, status === "suspended" ? reason : null, iso(), uid]);
    if (status === "suspended") {
      for (const s of await db.all("SELECT * FROM mentor_sessions WHERE mentor_id=$1 AND status IN ('pending','confirmed') AND starts_at > $2", [uid, iso()])) {
        const ch = await db.run("UPDATE mentor_sessions SET status='cancelled', cancel_reason='أوقف فريق المنصة ملف المرشد', cancelled_by=$1, updated_at=$2 WHERE id=$3 AND status IN ('pending','confirmed')", [by.id, iso(), s.id]);
        if (ch.changes) { await unwind(s); await notify(s.learner_id, "mentor_session", s.id); if (Number(s.minor)) for (const g of await guardiansOf(s.learner_id)) await notify(g, "mentor_guardian", s.id); }
      }
      await db.run("UPDATE mentor_requests SET status='closed', decided_at=$1 WHERE mentor_id=$2 AND status='open'", [iso(), uid]);
    }
    ctx.audit?.(status === "suspended" ? "mentor_suspended" : "mentor_restored", uid, reason, by.id);
    return { ok: true, mentorStatus: status };
  }

  /* M5-2 «مراجَع من الفريق»: staff mark / clear mentor_profiles.reviewed_at (067). Admin only (403 others, 401 visitors);
   *  audited in the tamper-evident audit_log. Mentors who accept minors are flagged for review — never blocked or disabled. */
  async function setReviewed(by, uid, b = {}) {
    const p = await profileOf(uid); if (!p) throw E.nf();
    if (typeof b.reviewed !== "boolean") throw bad("invalid_reviewed", "قيمة المراجعة غير صالحة");
    const at = b.reviewed ? (p.reviewed_at || iso()) : null;
    await db.run("UPDATE mentor_profiles SET reviewed_at=$1 WHERE user_id=$2", [at, uid]);
    if (!!p.reviewed_at !== b.reviewed) ctx.audit?.(b.reviewed ? "mentor_reviewed" : "mentor_review_cleared", uid, null, by.id);
    return { ok: true, reviewed: b.reviewed, reviewedAt: at };
  }

  /* ---------- M3-2 shared goals: one mentor ↔ one mentee (068 mentor_goals) ----------
   *  A pair exists only when menteeOf(mentor, mentee) (pending / confirmed / completed session or an accepted request).
   *  mentor + mentee of the pair: full CRUD (≤ GOAL_MAX per pair). Active guardian of a MINOR mentee: read-only, id +
   *  title + status only (no due date, no timestamps). Staff: read-only (moderation). Anyone else: 404 (no leak); visitors 401.
   *  A block between the two sides keeps reads but refuses writes (403 blocked). Errors carry stable codes. */
  const M068 = require("../migrations/068_mentor_goals");
  const GOAL_MAX = 10;
  const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const goalBad = (code, msg) => Object.assign(E.bad(msg), { code });
  const cleanTitle = (v) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); if (!t) throw goalBad("goal_title_required", "اكتب عنوان الهدف"); if ([...t].length > M068.TITLE_MAX) throw goalBad("goal_title_too_long", `عنوان الهدف حتى ${M068.TITLE_MAX} حرفاً`); return t; };
  const cleanGoalStatus = (v) => { if (!M068.STATUS.includes(v)) throw goalBad("goal_status_invalid", "حالة الهدف غير صالحة"); return v; };
  const cleanDue = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const m = DUE_RE.exec(String(v)); const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 2000 || +m[1] > 2100) throw goalBad("goal_due_invalid", "تاريخ الاستحقاق بصيغة YYYY-MM-DD");
    return m[0];
  };
  const goalClient = (g, full) => (full ? { id: g.id, title: g.title, status: g.status, due: g.due_date || null, createdAt: g.created_at, updatedAt: g.updated_at } : { id: g.id, title: g.title, status: g.status });
  /** viewer's access to the pair: "rw" | "guardian" | "staff"; throws 404 when none (pair must exist for everyone but staff). */
  async function pairAccess(user, mentorId, menteeId) {
    if (!mentorId || !menteeId || mentorId === menteeId) throw E.nf();
    const pair = await menteeOf(mentorId, menteeId);
    if (pair && (user.id === mentorId || user.id === menteeId)) return "rw";
    if (pair && (await isMinor(menteeId)) && (await guardiansOf(menteeId)).includes(user.id)) return "guardian";
    if (isStaff(user)) return "staff";
    throw E.nf();
  }
  const pairGoals = (mentorId, menteeId) => db.all("SELECT * FROM mentor_goals WHERE mentor_id=$1 AND mentee_id=$2 ORDER BY created_at, id", [mentorId, menteeId]);
  async function goalsList(user, mentorId, menteeId) {
    const acc = await pairAccess(user, mentorId, menteeId), rows = await pairGoals(mentorId, menteeId), full = acc !== "guardian";
    return { goals: rows.map((g) => goalClient(g, full)), access: acc === "rw" ? "edit" : "read", max: GOAL_MAX, titleMax: M068.TITLE_MAX, statuses: M068.STATUS, done: rows.filter((g) => g.status === "done").length, total: rows.length };
  }
  async function goalsOfSession(user, sid) { const { s } = await sessionFor(user, sid); return { ...(await goalsList(user, s.mentor_id, s.learner_id)), mentorId: s.mentor_id, menteeId: s.learner_id }; }
  async function writable(user, mentorId, menteeId) {
    const acc = await pairAccess(user, mentorId, menteeId);
    if (acc !== "rw") throw fail(403, "goal_read_only", "الأهداف للعرض فقط");
    if (await blocked(mentorId, menteeId)) throw fail(403, "blocked", "لا يمكن تعديل الأهداف بسبب الحظر");
  }
  async function createGoal(user, b = {}) {
    const mentorId = String(b.mentorId || ""), menteeId = String(b.menteeId || "");
    await writable(user, mentorId, menteeId);
    const title = cleanTitle(b.title), status = b.status === undefined ? M068.STATUS_DEFAULT : cleanGoalStatus(b.status), due = cleanDue(b.due);
    const n = Number((await db.get("SELECT COUNT(*) n FROM mentor_goals WHERE mentor_id=$1 AND mentee_id=$2", [mentorId, menteeId]))?.n || 0);
    if (n >= GOAL_MAX) throw fail(409, "goal_limit", `الحد ${GOAL_MAX} أهداف لكل مرشد ومتعلّم`);
    const gid = id("mg"), t = iso();
    await db.run("INSERT INTO mentor_goals(id,mentor_id,mentee_id,title,status,due_date,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)", [gid, mentorId, menteeId, title, status, due, t]);
    return { goal: goalClient(await db.get("SELECT * FROM mentor_goals WHERE id=$1", [gid]), true) };
  }
  async function goalFor(user, gid) { const g = await db.get("SELECT * FROM mentor_goals WHERE id=$1", [String(gid || "")]); if (!g) throw E.nf(); await writable(user, g.mentor_id, g.mentee_id); return g; }
  async function updateGoal(user, gid, b = {}) {
    const g = await goalFor(user, gid);
    const title = b.title === undefined ? g.title : cleanTitle(b.title), status = b.status === undefined ? g.status : cleanGoalStatus(b.status), due = b.due === undefined ? g.due_date : cleanDue(b.due);
    await db.run("UPDATE mentor_goals SET title=$1, status=$2, due_date=$3, updated_at=$4 WHERE id=$5", [title, status, due, iso(), g.id]);
    return { goal: goalClient(await db.get("SELECT * FROM mentor_goals WHERE id=$1", [g.id]), true) };
  }
  async function deleteGoal(user, gid) { const g = await goalFor(user, gid); await db.run("DELETE FROM mentor_goals WHERE id=$1", [g.id]); return { ok: true }; }
  /** mentor dashboard: done/total per mentee, one query */
  async function goalsSummary(user) {
    const rows = await db.all("SELECT mentee_id, COUNT(*) total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done FROM mentor_goals WHERE mentor_id=$1 GROUP BY mentee_id", [user.id]);
    return { mentees: Object.fromEntries(rows.map((r) => [r.mentee_id, { done: Number(r.done || 0), total: Number(r.total || 0) }])) };
    }

  /* ---------- M3-6 mentor insights (#/mentoring?tab=insights): the signed-in mentor's own numbers only, five fixed aggregate
   * queries (no per-row lookups, no learner identities). Windowed to the last 6 calendar months (UTC): sessions per month
   * (completed), median request response time (created → accepted/declined by this mentor), no-show rate (no_show among
   * completed + no_show). All-time: average rating + count (learner → mentor ratings on this mentor's sessions) and the
   * repeat-mentee rate (learners with ≥ 2 completed sessions among learners with ≥ 1). */
  async function insights(user) {
    const p = await profileOf(user.id); if (!p) throw fail(403, "not_mentor", "للمرشدين فقط");
    const pg = db.dialect === "postgres", now = new Date(clock());
    const months = []; for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 7)); }
    const since = months[0] + "-01T00:00:00.000Z";
    const monthOf = pg ? "to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM')" : "substr(starts_at,1,7)";
    const perMonth = await db.all(`SELECT ${monthOf} m, COUNT(*) n FROM mentor_sessions WHERE mentor_id=$1 AND status='completed' AND starts_at >= $2 GROUP BY ${monthOf}`, [user.id, since]);
    const rt = await db.get("SELECT AVG(f.rating) a, COUNT(*) n FROM mentor_feedback f JOIN mentor_sessions s ON s.id=f.session_id WHERE s.mentor_id=$1 AND f.about_user=$1 AND f.by_user=s.learner_id AND f.rating IS NOT NULL", [user.id]);
    const ns = await db.get("SELECT SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) x, COUNT(*) n FROM mentor_sessions WHERE mentor_id=$1 AND status IN ('completed','no_show') AND starts_at >= $2", [user.id, since]);
    const rep = await db.get("SELECT COUNT(*) n, SUM(CASE WHEN c >= 2 THEN 1 ELSE 0 END) r FROM (SELECT learner_id, COUNT(*) c FROM mentor_sessions WHERE mentor_id=$1 AND status='completed' GROUP BY learner_id) t", [user.id]);
    const RQ = "FROM mentor_requests WHERE mentor_id=$1 AND status IN ('accepted','declined') AND decided_at IS NOT NULL AND created_at >= $2";
    const resp = pg
      ? await db.get(`SELECT COUNT(*) n, percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (decided_at - created_at)) / 60.0) med ${RQ}`, [user.id, since])
      : await db.get(`WITH d AS (SELECT (julianday(decided_at) - julianday(created_at)) * 1440.0 v ${RQ}) SELECT (SELECT COUNT(*) FROM d) n, (SELECT AVG(v) FROM (SELECT v FROM d ORDER BY v LIMIT 2 - (SELECT COUNT(*) FROM d) % 2 OFFSET ((SELECT COUNT(*) FROM d) - 1) / 2)) med`, [user.id, since]);
    const pm = new Map(perMonth.map((r) => [String(r.m), Number(r.n)]));
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const nsN = Number(ns?.n || 0), repN = Number(rep?.n || 0), rN = Number(rt?.n || 0), qN = Number(resp?.n || 0);
    return {
      window: { months: 6, since },
      sessionsByMonth: months.map((m) => ({ month: m, count: pm.get(m) || 0 })),
      sessionsTotal: months.reduce((t, m) => t + (pm.get(m) || 0), 0),
      rating: { avg: rN ? Math.round(Number(rt.a) * 10) / 10 : null, count: rN },
      responseMinutes: { median: qN && resp.med !== null ? Math.max(0, Math.round(Number(resp.med))) : null, count: qN },
      noShow: { rate: pct(Number(ns?.x || 0), nsN), count: Number(ns?.x || 0), of: nsN },
      repeat: { rate: pct(Number(rep?.r || 0), repN), count: Number(rep?.r || 0), of: repN }
    };
  }

  /* ---------- M4-2 mentor resources (069 mentor_resources, PLAN F8) ----------
   *  Owner CRUD at /api/mentor/me/resources (≤ RESOURCES_MAX, https:// only, reorder via sort). On the profile page:
   *  visibility=public → everyone who may see the page; visibility=mentees → only the mentor's mentees (≥1 pending /
   *  confirmed / completed session) and the active guardians of such a mentee; owner + staff see all; never strangers.
   *  Preview «كما يراه» uses the same filter: visitor/member → public only; mentee/guardian → both. */
  const M069 = require("../migrations/069_mentor_resources_saves");
  const resBad = (code, msg) => Object.assign(E.bad(msg), { code });
  const sessionMentee = async (mentorId, uid) => !!uid && !!(await db.get("SELECT 1 x FROM mentor_sessions WHERE mentor_id=$1 AND learner_id=$2 AND status IN ('pending','confirmed','completed') LIMIT 1", [mentorId, uid]));
  async function sessionGuardian(mentorId, uid) {
    const kids = (await db.all("SELECT minor_id FROM guardian_links WHERE guardian_id=$1 AND status='active'", [uid]).catch(() => [])).map((r) => r.minor_id);
    for (const k of kids) if (await sessionMentee(mentorId, k)) return true;
    return false;
  }
  /** may this viewer see mentees-only resources of mentorId? (rel = viewerRel result, page already allowed) */
  const seesMenteeRes = async (rel, mentorId, viewer) => rel === "owner" || rel === "staff" || (!!viewer && ((await sessionMentee(mentorId, viewer.id)) || (await sessionGuardian(mentorId, viewer.id))));
  const resClient = (r, full) => { const o = { id: r.id, title: r.title, kind: r.kind, url: r.url || null, note: r.note || "", visibility: r.visibility }; if (full) { o.sort = Number(r.sort); o.updatedAt = r.updated_at; } return o; };
  const resOf = (mentorId) => db.all("SELECT * FROM mentor_resources WHERE mentor_id=$1 ORDER BY sort, created_at, id", [mentorId]);
  const resUrl = (v) => {
    if (typeof v !== "string" || !v.trim()) throw resBad("resource_url_required", "الرابط مطلوب");
    const s = v.trim(); if (s.length > M069.URL_MAX) throw resBad("resource_url_invalid", "الرابط طويل جداً");
    let u; try { u = new URL(s); } catch { throw resBad("resource_url_invalid", "رابط غير صالح"); }
    if (u.protocol !== "https:" || !s.toLowerCase().startsWith(M069.URL_PREFIX) || u.username || u.password || !u.hostname.includes(".")) throw resBad("resource_url_invalid", "الروابط المقبولة تبدأ بـ https:// فقط");
    if (u.href.length > M069.URL_MAX) throw resBad("resource_url_invalid", "الرابط طويل جداً");
    return u.href;
  };
  function resFields(b, cur = null) {
    const title = b.title === undefined && cur ? cur.title : String(b.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) throw resBad("resource_title_required", "اكتب عنوان المورد");
    if ([...title].length > M069.TITLE_MAX) throw resBad("resource_title_too_long", `العنوان حتى ${M069.TITLE_MAX} حرفاً`);
    const kind = b.kind === undefined ? (cur ? cur.kind : "link") : b.kind;
    if (!M069.KINDS.includes(kind)) throw resBad("resource_kind_invalid", "نوع المورد غير صالح");
    const visibility = b.visibility === undefined ? (cur ? cur.visibility : M069.VISIBILITY_DEFAULT) : b.visibility;
    if (!M069.VISIBILITY.includes(visibility)) throw resBad("resource_visibility_invalid", "ظهور المورد غير صالح");
    const rawUrl = b.url === undefined && cur ? cur.url : b.url;
    const url = kind === "note" && (rawUrl === null || rawUrl === undefined || rawUrl === "") ? null : resUrl(rawUrl);
    const rawNote = b.note === undefined && cur ? cur.note : b.note;
    const note = rawNote === null || rawNote === undefined ? null : String(rawNote).trim() || null;
    if (note && [...note].length > M069.NOTE_MAX) throw resBad("resource_note_too_long", `الملاحظة حتى ${M069.NOTE_MAX} حرف`);
    if (kind === "note" && !note && !url) throw resBad("resource_note_required", "اكتب نص الملاحظة");
    return { title, kind, visibility, url, note };
  }
  const resMeta = () => ({ max: M069.RESOURCES_MAX, titleMax: M069.TITLE_MAX, noteMax: M069.NOTE_MAX, urlMax: M069.URL_MAX, kinds: M069.KINDS, visibility: M069.VISIBILITY, visibilityDefault: M069.VISIBILITY_DEFAULT });
  async function ownProfile(user) { const p = await profileOf(user.id); if (!p) throw E.nf("أنشئ ملف الإرشاد أولاً"); return p; }
  async function myResources(user) { await ownProfile(user); return { resources: (await resOf(user.id)).map((r) => resClient(r, true)), meta: resMeta() }; }
  async function createResource(user, b = {}) {
    await ownProfile(user); const f = resFields(b || {});
    const n = Number((await db.get("SELECT COUNT(*) n FROM mentor_resources WHERE mentor_id=$1", [user.id]))?.n || 0);
    if (n >= M069.RESOURCES_MAX) throw Object.assign(E.conflict(`الحد ${M069.RESOURCES_MAX} مورداً`), { code: "resource_limit" });
    const mx = Number((await db.get("SELECT MAX(sort) m FROM mentor_resources WHERE mentor_id=$1", [user.id]))?.m ?? -1);
    const rid = id("mr"), t = iso();
    await db.run("INSERT INTO mentor_resources(id,mentor_id,title,url,kind,note,visibility,sort,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)", [rid, user.id, f.title, f.url, f.kind, f.note, f.visibility, Number.isFinite(mx) ? mx + 1 : 0, t]);
    return { resource: resClient(await db.get("SELECT * FROM mentor_resources WHERE id=$1", [rid]), true) };
  }
  async function resFor(user, rid) { const r = await db.get("SELECT * FROM mentor_resources WHERE id=$1 AND mentor_id=$2", [String(rid || ""), user.id]); if (!r) throw E.nf(); return r; }
  async function updateResource(user, rid, b = {}) {
    const r = await resFor(user, rid); const f = resFields(b || {}, r);
    await db.run("UPDATE mentor_resources SET title=$1, url=$2, kind=$3, note=$4, visibility=$5, updated_at=$6 WHERE id=$7", [f.title, f.url, f.kind, f.note, f.visibility, iso(), r.id]);
    return { resource: resClient(await db.get("SELECT * FROM mentor_resources WHERE id=$1", [r.id]), true) };
  }
  async function deleteResource(user, rid) { const r = await resFor(user, rid); await db.run("DELETE FROM mentor_resources WHERE id=$1", [r.id]); return { ok: true }; }
  /** reorder: body { order: [id, …] } — must be exactly the mentor's ids; sort = index */
  async function reorderResources(user, b = {}) {
    await ownProfile(user); const cur = await resOf(user.id), order = Array.isArray(b?.order) ? b.order.map(String) : null;
    const have = new Set(cur.map((r) => r.id));
    if (!order || order.length !== cur.length || new Set(order).size !== order.length || order.some((x) => !have.has(x))) throw resBad("resource_order_invalid", "ترتيب غير صالح");
    const t = iso(); for (let i = 0; i < order.length; i++) await db.run("UPDATE mentor_resources SET sort=$1, updated_at=$2 WHERE id=$3 AND mentor_id=$4", [i, t, order[i], user.id]);
    return myResources(user);
  }
  /** resources a viewer may see (page access already decided by viewerRel / preview) */
  async function resourcesFor(mentorId, all) { return (await resOf(mentorId)).filter((r) => all || r.visibility === "public").map((r) => resClient(r, false)); }

  /* ---------- routes ---------- */
  R.get("/api/mentor/insights", A(async (req) => insights(req.user)));
  R.get("/api/mentors", async (req) => directory(req.user || null, req.query || {}));
  R.get("/api/mentors/match", A(async (req) => match(req.user, req.query || {})));
  R.get("/api/mentors/:handle", async (req) => mentorPage(req.user || null, req.params.handle, req.query || {}));
  R.post("/api/mentors/:handle/save", A(async (req) => saveMentor(req.user, req.params.handle)));
  R.del("/api/mentors/:handle/save", A(async (req) => unsaveMentor(req.user, req.params.handle)));
  R.get("/api/mentor/saved", A(async (req) => savedList(req.user)));
  R.put("/api/mentor/saved/:handle", A(async (req) => setSaveNotify(req.user, req.params.handle, req.body || {})));
  R.get("/api/mentors/:handle/slots", async (req) => slotsRoute(req.user || null, req.params.handle, req.query || {}));
  R.post("/api/mentors/:handle/book", A(async (req) => book(req.user, req.params.handle, req.body || {})));
  R.get("/api/mentor/me", A(async (req) => myProfile(req.user)));
  R.put("/api/mentor/me", A(async (req) => saveProfile(req.user, req.body || {})));
  R.del("/api/mentor/me", A(async (req) => deleteProfile(req.user)));
  R.get("/api/mentor/me/preview", A(async (req) => previewAs(req.user, String(req.query?.as || ""))));
  R.get("/api/mentor/me/resources", A(async (req) => myResources(req.user)));
  R.post("/api/mentor/me/resources", A(async (req) => createResource(req.user, req.body || {})));
  R.put("/api/mentor/me/resources/order", A(async (req) => reorderResources(req.user, req.body || {})));
  R.put("/api/mentor/me/resources/:id", A(async (req) => updateResource(req.user, req.params.id, req.body || {})));
  R.del("/api/mentor/me/resources/:id", A(async (req) => deleteResource(req.user, req.params.id)));
  R.put("/api/mentor/me/slots", A(async (req) => saveSlots(req.user, req.body || {})));
  R.get("/api/mentor/requests", A(async (req) => requests(req.user)));
  R.post("/api/mentor/requests", A(async (req) => createRequest(req.user, req.body || {})));
  R.post("/api/mentor/requests/:id/accept", A(async (req) => decideRequest(req.user, req.params.id, true, req.body || {})));
  R.post("/api/mentor/requests/:id/decline", A(async (req) => decideRequest(req.user, req.params.id, false, req.body || {})));
  R.post("/api/mentor/requests/:id/withdraw", A(async (req) => withdrawRequest(req.user, req.params.id)));
  R.get("/api/mentor/sessions", A(async (req) => sessions(req.user, req.query || {})));
  R.get("/api/mentor/feed", A(async (req) => feed(req.user, false)));
  R.post("/api/mentor/feed", A(async (req) => feed(req.user, !!req.body?.rotate)));
  R.del("/api/mentor/feed", A(async (req) => { await db.run("DELETE FROM mentor_feeds WHERE user_id=$1", [req.user.id]); return { ok: true }; }));
  R.get("/api/mentor-sessions/:id", A(async (req) => sessionView(req.user, req.params.id)));
  R.get("/api/mentor-sessions/:id/ics", A(sessionIcs));
  for (const a of ["confirm", "decline", "cancel", "complete", "no_show", "join", "pay"]) R.post(`/api/mentor-sessions/:id/${a.replace("_", "-")}`, A(async (req) => act(req.user, req.params.id, a, req.body || {})));
  R.get("/api/mentor-sessions/:id/agenda", A(async (req) => agendaView(req.user, req.params.id)));
  R.put("/api/mentor-sessions/:id/agenda", A(async (req) => saveAgenda(req.user, req.params.id, req.body || {})));
  R.put("/api/mentor-sessions/:id/note", A(async (req) => saveNote(req.user, req.params.id, req.body || {})));
  R.post("/api/mentor-sessions/:id/feedback", A(async (req) => feedback(req.user, req.params.id, req.body || {})));
  R.get("/api/mentor-goals", A(async (req) => goalsList(req.user, String(req.query?.mentor || ""), String(req.query?.mentee || ""))));
  R.get("/api/mentor-goals/summary", A(async (req) => goalsSummary(req.user)));
  R.post("/api/mentor-goals", A(async (req) => createGoal(req.user, req.body || {})));
  R.put("/api/mentor-goals/:id", A(async (req) => updateGoal(req.user, req.params.id, req.body || {})));
  R.del("/api/mentor-goals/:id", A(async (req) => deleteGoal(req.user, req.params.id)));
  R.get("/api/mentor-sessions/:id/goals", A(async (req) => goalsOfSession(req.user, req.params.id)));
  R.get("/api/admin/mentors", admin(async () => adminView()));
  R.post("/api/admin/mentors/:uid/status", admin(async (req) => setStatus(req.user, req.params.uid, req.body || {})));
  R.post("/api/admin/mentors/:uid/review", admin(async (req) => setReviewed(req.user, req.params.uid, req.body || {})));

  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  return { roomAccess, ssr, tick, weeklySummaries, slotAlert, isoWeek, settle, freeSlots, directory, match, book, act, adminView, TOPICS, STATUSES, _tz: { zoned, partsAt, offsetMin } };
};
