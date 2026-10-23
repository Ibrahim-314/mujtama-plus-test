/* Study groups and circles «حلقات» (phase 71). A study group is a phase 16 community (membership, roles, moderation, posts,
 * join rules) plus a study_groups row — nothing about communities is duplicated.
 *  1. Group types: «group» (مجموعة دراسة) and «halaqa» (حلقة: teacher(s) + students, recitation / memorisation tracking).
 *     Create a new one, or turn an existing community into one (owner / admin).
 *  2. Weekly schedule in the group's own time zone (days + time + duration); sessions for the next 14 days are created
 *     automatically (idempotent: one per group and start time) and can be added, moved or cancelled by hand.
 *  3. Sessions run in a live room (phase 13/14 rooms service: mesh WebRTC or LiveKit) that only the group's members may
 *     join and that is not listed publicly; or in person (attendance by check-in / the teacher).
 *  4. Attendance: joining a live session marks present (late after `lateAfterMin`); teachers mark present / late /
 *     excused / absent; ending a session marks everyone else absent; per-member rates; CSV export.
 *  5. Shared notes and links per group or per session; teachers / moderators pin them.
 *  6. Goals (group and personal) with progress, and streaks: consecutive sessions attended (excused keeps the streak)
 *     and consecutive days with recorded recitation in a halaqa.
 *  7. Halaqa mode: the teacher logs memorisation / recitation / review per student (surah + ayah range validated against
 *     the 6236-ayah mushaf, grade, note); coverage of the Quran memorised. Visible to the student, the group's teachers and
 *     its admins only. Minors (phase 34/35) can be students but never teachers; nothing about them is public.
 *  8. Reminders through the notification centre (lib/notify-lib.js kinds study_session_soon / study_session_live /
 *     study_progress), idempotent per session, member and kind; members control them in notification settings. */
const { E, str, oneOf, id } = require("../lib/core");
const Q = require("../lib/quran-meta");

const DAY = 864e5;
const MODES = { group: "مجموعة دراسة", halaqa: "حلقة" };
const LEVELS = { beginner: "مبتدئ", intermediate: "متوسط", advanced: "متقدم", all: "كل المستويات" };
const ATT = { present: "حاضر", late: "متأخر", excused: "معتذر", absent: "غائب" };
const KINDS = { memorisation: "حفظ جديد", recitation: "تسميع", review: "مراجعة" };
const GRADES = { excellent: "ممتاز", very_good: "جيد جداً", good: "جيد", needs_work: "يحتاج إعادة" };
const MEMBER_ROLES = ["owner", "admin", "moderator", "member", "muted"];
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) || /^[=+\-@\t\r]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };

/* ---- time-zone helpers (Intl only; DST-safe) ---- */
function validTz(tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }
function partsIn(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
const offsetAt = (ms, tz) => { const p = partsIn(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60e3) * 60e3; };
/** wall-clock time in `tz` → UTC ms */
function zonedToUtc(y, m, d, h, min, tz) { const guess = Date.UTC(y, m - 1, d, h, min); let t = guess - offsetAt(guess, tz); t = guess - offsetAt(t, tz); return t; }
/** next `days` occurrences of a weekly schedule after `fromMs` → UTC ms list */
function occurrences(schedule, fromMs, days = 14) {
  const out = []; if (!schedule || !schedule.days?.length || !/^\d{2}:\d{2}$/.test(schedule.time || "")) return out;
  const [hh, mm] = schedule.time.split(":").map(Number), tz = validTz(schedule.tz) ? schedule.tz : "Asia/Riyadh";
  for (let i = 0; i <= days; i++) {
    const p = partsIn(fromMs + i * DAY, tz);
    if (!schedule.days.includes(p.wd)) continue;
    const t = zonedToUtc(p.y, p.m, p.d, hh, mm, tz);
    if (t > fromMs && t <= fromMs + days * DAY && !out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}
/** streaks over a member's sessions, newest first: attended (present / late) counts, excused keeps it, anything else breaks */
function streaks(statuses) {
  let current = 0, longest = 0, run = 0, broken = false;
  for (const s of statuses) {
    if (s === "present" || s === "late") { run++; if (!broken) current = run; longest = Math.max(longest, run); }
    else if (s === "excused") continue;
    else { broken = true; run = 0; }
  }
  return { current, longest };
}
/** consecutive days (ending today or yesterday, in tz) that have at least one entry */
function dayStreak(isoDates, tz, nowMs = Date.now()) {
  const key = (ms) => { const p = partsIn(ms, tz); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
  const set = new Set(isoDates.map((x) => key(Date.parse(x))));
  let n = 0, ms = nowMs; if (!set.has(key(ms))) ms -= DAY;
  while (set.has(key(ms))) { n++; ms -= DAY; }
  return n;
}

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, jobs?: boolean, now?: () => number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const isoNow = () => new Date(clock()).toISOString();
  const C = () => ctx.services.communities;
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const notify = async (uid, kind, ref) => { try { await ctx.services.notify?.notify(uid, kind, { ref }); } catch { /* best effort */ } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");

  /* ---------- access ---------- */
  async function load(cid) {
    const g = await db.get("SELECT g.*, c.name, c.descr, c.type, c.color, c.owner, c.topic FROM study_groups g JOIN communities c ON c.id=g.community_id WHERE g.community_id=$1", [cid]);
    if (!g) throw E.nf("مجموعة الدراسة غير موجودة");
    g.scheduleObj = parse(g.schedule, null); g.teacherIds = parse(g.teachers, []); g.settingsObj = { remindMinutes: 60, lateAfterMin: 10, ...parse(g.settings, {}) };
    return g;
  }
  async function roleOf(cid, uid) { return uid ? (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]))?.role || null : null; }
  async function access(g, user) {
    const role = await roleOf(g.community_id, user?.id);
    const member = MEMBER_ROLES.includes(role), admin = ["owner", "admin", "moderator"].includes(role) || user?.role === "admin";
    const teacher = !!user && member && g.teacherIds.includes(user.id);
    return { role, member, admin, teacher, manager: admin || teacher, canView: member || g.type === "public" || user?.role === "admin" };
  }
  const need = (cond, msg) => { if (!cond) throw E.forbid(msg); };
  async function members(cid) { return db.all(`SELECT m.user_id, m.role, m.joined_at, u.name, u.handle, u.avatar, u.color FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.community=$1 AND m.role IN (${ph(MEMBER_ROLES, 1)}) ORDER BY m.joined_at LIMIT 5000`, [cid, ...MEMBER_ROLES]); }

  /* ---------- 1. groups ---------- */
  function readSchedule(s) {
    if (s === null) return null; if (!s || typeof s !== "object") return undefined;
    const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) throw E.bad("اختر يوماً واحداً على الأقل للجدول");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || "")) throw E.bad("وقت الجلسة غير صالح (HH:MM)");
    const tz = validTz(s.tz) ? s.tz : "Asia/Riyadh";
    return { days, time: s.time, tz, durationMin: Math.max(15, Math.min(300, Math.round(+s.durationMin || 60))) };
  }
  async function setTeachers(cid, ids) {
    const out = [];
    for (const t of [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"))].slice(0, 10)) {
      if (!MEMBER_ROLES.includes(await roleOf(cid, t))) throw E.bad("المعلم يجب أن يكون عضواً في المجموعة");
      if (await isMinor(t)) throw E.bad("لا يمكن تعيين حساب قاصر معلماً");
      out.push(t);
    }
    return out;
  }
  async function enable(user, cid, b = {}, fresh = false) {
    if (!fresh) { const role = await roleOf(cid, user.id); need(["owner", "admin"].includes(role) || user.role === "admin", "لمالك المجتمع أو مديره فقط"); }
    if (await db.get("SELECT 1 x FROM study_groups WHERE community_id=$1", [cid])) throw E.conflict("هذا المجتمع مجموعة دراسة بالفعل");
    const mode = oneOf(b.mode, Object.keys(MODES), "group"), sched = readSchedule(b.schedule) || null;
    const teachers = b.teachers ? await setTeachers(cid, b.teachers) : (await isMinor(user.id)) ? [] : [user.id];
    const settings = { remindMinutes: Math.max(5, Math.min(1440, Math.round(+b.remindMinutes || 60))), lateAfterMin: Math.max(0, Math.min(120, Math.round(+(b.lateAfterMin ?? 10)))) };
    await db.run("INSERT INTO study_groups(community_id,mode,subject,level,schedule,teachers,settings,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
      [cid, mode, str(b.subject, 80), oneOf(b.level, Object.keys(LEVELS), "all"), sched ? JSON.stringify(sched) : null, JSON.stringify(teachers), JSON.stringify(settings), user.id, isoNow()]);
    await ctx.audit?.("STUDY_GROUP_ENABLED", cid, mode, user.id);
    await materialise(cid);
    return detail(user, cid);
  }
  async function create(user, b = {}) {
    const c = await C().create(user, { name: b.name, desc: b.desc, topic: b.topic || "learn", type: b.type, rules: b.rules, requireApproval: b.requireApproval, location: b.location });
    return enable(user, c.id, b, true);
  }
  async function update(user, cid, b = {}) {
    const g = await load(cid), a = await access(g, user); need(a.admin, "لمشرفي المجموعة فقط");
    const sched = readSchedule(b.schedule);
    const settings = { ...g.settingsObj };
    if (b.remindMinutes !== undefined) settings.remindMinutes = Math.max(5, Math.min(1440, Math.round(+b.remindMinutes || 60)));
    if (b.lateAfterMin !== undefined) settings.lateAfterMin = Math.max(0, Math.min(120, Math.round(+b.lateAfterMin || 0)));
    if (b.completionAttendance !== undefined) settings.completionAttendance = Math.max(0, Math.min(100, Math.round(+b.completionAttendance || 0)));
    if (b.completionAssignments !== undefined) settings.completionAssignments = Math.max(0, Math.min(100, Math.round(+b.completionAssignments || 0)));
    const teachers = b.teachers !== undefined ? await setTeachers(cid, b.teachers) : g.teacherIds;
    await db.run("UPDATE study_groups SET mode=$1, subject=$2, level=$3, schedule=$4, teachers=$5, settings=$6, updated_at=$7 WHERE community_id=$8",
      [oneOf(b.mode, Object.keys(MODES), g.mode), b.subject !== undefined ? str(b.subject, 80) : g.subject, oneOf(b.level, Object.keys(LEVELS), g.level), sched === undefined ? g.schedule : sched ? JSON.stringify(sched) : null, JSON.stringify(teachers), JSON.stringify(settings), isoNow(), cid]);
    if (sched !== undefined) { // the schedule changed: regenerate future automatic sessions (never touched ones)
      await db.run("DELETE FROM study_sessions WHERE community_id=$1 AND auto=1 AND status='scheduled' AND starts_at > $2 AND NOT EXISTS (SELECT 1 FROM study_attendance a WHERE a.session_id=study_sessions.id)", [cid, isoNow()]);
      await materialise(cid);
    }
    return detail(user, cid);
  }
  const sessionClient = (s) => ({ id: s.id, communityId: s.community_id, title: s.title, agenda: s.agenda || "", startsAt: s.starts_at, durationMin: s.duration_min, endsAt: new Date(Date.parse(s.starts_at) + s.duration_min * 60e3).toISOString(), status: s.status, roomId: s.room_id || null, auto: !!s.auto, startedAt: s.started_at, endedAt: s.ended_at });
  async function myStats(g, uid) {
    if (!uid) return null;
    const m = await db.get("SELECT joined_at FROM memberships WHERE community=$1 AND user_id=$2", [g.community_id, uid]); if (!m) return null;
    const rows = await db.all("SELECT s.id, s.starts_at, a.status FROM study_sessions s LEFT JOIN study_attendance a ON a.session_id=s.id AND a.user_id=$2 WHERE s.community_id=$1 AND s.status='ended' AND s.starts_at >= $3 ORDER BY s.starts_at DESC LIMIT 500", [g.community_id, uid, new Date(Date.parse(m.joined_at) - DAY).toISOString()]);
    const st = rows.map((r) => r.status || "absent"), att = st.filter((s) => s === "present" || s === "late").length, counted = st.filter((s) => s !== "excused").length;
    const s = streaks(st);
    const prog = g.mode === "halaqa" ? await db.all("SELECT at FROM study_progress WHERE community_id=$1 AND student_id=$2 ORDER BY at DESC LIMIT 400", [g.community_id, uid]) : [];
    return { sessions: rows.length, attended: att, rate: counted ? Math.round((att / counted) * 100) : null, streak: s.current, longestStreak: s.longest, recitationDays: g.mode === "halaqa" ? dayStreak(prog.map((p) => p.at), g.scheduleObj?.tz || "Asia/Riyadh", clock()) : undefined };
  }
  async function detail(user, cid) {
    const g = await load(cid), a = await access(g, user); need(a.canView, "هذه المجموعة خاصة");
    const upcoming = await db.all("SELECT * FROM study_sessions WHERE community_id=$1 AND status IN ('scheduled','live') AND starts_at > $2 ORDER BY starts_at LIMIT 6", [cid, new Date(clock() - 6 * 3600e3).toISOString()]);
    const live = upcoming.find((s) => s.status === "live") || null;
    const n = Number((await db.get(`SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role IN (${ph(MEMBER_ROLES, 1)})`, [cid, ...MEMBER_ROLES])).n);
    const teachers = g.teacherIds.length ? await db.all(`SELECT id, name, handle, avatar, color FROM users WHERE id IN (${ph(g.teacherIds)})`, g.teacherIds) : [];
    return { group: { id: cid, name: g.name, desc: g.descr, type: g.type, color: g.color, mode: g.mode, modeLabel: MODES[g.mode], subject: g.subject, level: g.level, levelLabel: LEVELS[g.level] || null, schedule: g.scheduleObj, settings: g.settingsObj, members: n,
      teachers: teachers.map((t) => ({ id: t.id, name: t.name, handle: t.handle, avatar: t.avatar, color: t.color })) },
      me: { role: a.role, member: a.member, manager: a.manager, teacher: a.teacher, admin: a.admin, stats: a.member ? await myStats(g, user.id) : null },
      live: live ? sessionClient(live) : null, upcoming: upcoming.filter((s) => s.status === "scheduled").map(sessionClient), labels: { modes: MODES, levels: LEVELS, attendance: ATT, kinds: KINDS, grades: GRADES } };
  }
  async function list(user, q = {}) {
    const rows = await db.all("SELECT g.community_id, g.mode, g.subject, g.level, g.schedule, c.name, c.descr, c.type, c.color FROM study_groups g JOIN communities c ON c.id=g.community_id ORDER BY g.created_at DESC LIMIT 300", []);
    const mineIds = user ? new Set((await db.all(`SELECT community FROM memberships WHERE user_id=$1 AND role IN (${ph(MEMBER_ROLES, 1)})`, [user.id, ...MEMBER_ROLES])).map((r) => r.community)) : new Set();
    const mode = oneOf(q.mode, Object.keys(MODES), null), text = String(q.q || "").trim().toLowerCase();
    const vis = rows.filter((r) => (r.type === "public" || mineIds.has(r.community_id)) && (!mode || r.mode === mode) && (!text || `${r.name} ${r.subject || ""} ${r.descr || ""}`.toLowerCase().includes(text)) && (q.mine !== "1" || mineIds.has(r.community_id)));
    const ids = vis.map((r) => r.community_id), next = new Map();
    if (ids.length) for (const s of await db.all(`SELECT community_id, MIN(starts_at) AS at FROM study_sessions WHERE status IN ('scheduled','live') AND starts_at > $1 AND community_id IN (${ph(ids, 1)}) GROUP BY community_id`, [new Date(clock() - 6 * 3600e3).toISOString(), ...ids])) next.set(s.community_id, s.at);
    return { groups: vis.map((r) => ({ id: r.community_id, name: r.name, desc: r.descr, type: r.type, color: r.color, mode: r.mode, modeLabel: MODES[r.mode], subject: r.subject, level: r.level, levelLabel: LEVELS[r.level] || null, schedule: parse(r.schedule, null), mine: mineIds.has(r.community_id), nextSession: next.get(r.community_id) || null })) };
  }

  /* ---------- 2. sessions ---------- */
  async function materialise(cid) {
    const g = await load(cid); if (!g.scheduleObj) return 0;
    let n = 0;
    for (const t of occurrences(g.scheduleObj, clock(), 14)) {
      const r = await db.run("INSERT INTO study_sessions(id,community_id,title,agenda,starts_at,duration_min,status,auto,created_by,created_at) VALUES($1,$2,$3,'',$4,$5,'scheduled',1,$6,$7) ON CONFLICT DO NOTHING",
        [id("ss"), cid, `${g.subject || g.name} — ${g.mode === "halaqa" ? "الحلقة" : "جلسة"}`.slice(0, 100), new Date(t).toISOString(), g.scheduleObj.durationMin, g.created_by, isoNow()]);
      n += r.changes || 0;
    }
    return n;
  }
  async function getSession(sid) { const s = await db.get("SELECT * FROM study_sessions WHERE id=$1", [sid]); if (!s) throw E.nf("الجلسة غير موجودة"); return s; }
  async function sessions(user, cid, q = {}) {
    const g = await load(cid), a = await access(g, user); need(a.canView, "هذه المجموعة خاصة");
    const past = q.range === "past";
    const rows = await db.all(`SELECT * FROM study_sessions WHERE community_id=$1 AND ${past ? "(status IN ('ended','cancelled') OR starts_at < $2)" : "status IN ('scheduled','live') AND starts_at >= $2"} ORDER BY starts_at ${past ? "DESC" : ""} LIMIT 60`, [cid, new Date(clock() - (past ? 0 : 6 * 3600e3)).toISOString()]);
    const mine = a.member && rows.length ? new Map((await db.all(`SELECT session_id, status FROM study_attendance WHERE user_id=$1 AND session_id IN (${ph(rows.map((r) => r.id), 1)})`, [user.id, ...rows.map((r) => r.id)])).map((r) => [r.session_id, r.status])) : new Map();
    return { sessions: rows.map((s) => ({ ...sessionClient(s), myAttendance: mine.get(s.id) || null })) };
  }
  async function addSession(user, cid, b = {}) {
    const g = await load(cid), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    const at = new Date(b.startsAt); if (isNaN(at) || at.getTime() < clock() - 60e3) throw E.bad("موعد الجلسة غير صالح");
    const sid = id("ss");
    const r = await db.run("INSERT INTO study_sessions(id,community_id,title,agenda,starts_at,duration_min,status,auto,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,'scheduled',0,$7,$8) ON CONFLICT DO NOTHING",
      [sid, cid, str(b.title, 100, { required: true, min: 2 }), str(b.agenda, 1000) || "", at.toISOString(), Math.max(15, Math.min(300, Math.round(+b.durationMin || g.scheduleObj?.durationMin || 60))), user.id, isoNow()]);
    if (!r.changes) throw E.conflict("توجد جلسة في هذا الموعد بالفعل");
    return { session: sessionClient(await getSession(sid)) };
  }
  async function editSession(user, sid, b = {}) {
    const s = await getSession(sid), g = await load(s.community_id), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    if (s.status !== "scheduled") throw E.bad("لا يمكن تعديل جلسة بدأت أو انتهت");
    const at = b.startsAt !== undefined ? new Date(b.startsAt) : new Date(s.starts_at); if (isNaN(at)) throw E.bad("موعد غير صالح");
    try {
      await db.run("UPDATE study_sessions SET title=$1, agenda=$2, starts_at=$3, duration_min=$4, auto=0 WHERE id=$5", [b.title !== undefined ? str(b.title, 100, { required: true, min: 2 }) : s.title, b.agenda !== undefined ? str(b.agenda, 1000) || "" : s.agenda, at.toISOString(), b.durationMin !== undefined ? Math.max(15, Math.min(300, Math.round(+b.durationMin || 60))) : s.duration_min, sid]);
    } catch (e) { if (/unique|constraint/i.test(e.message)) throw E.conflict("توجد جلسة في هذا الموعد بالفعل"); throw e; }
    if (b.startsAt !== undefined) await db.run("DELETE FROM study_reminders WHERE session_id=$1 AND kind='soon'", [sid]); // moved: remind again
    return { session: sessionClient(await getSession(sid)) };
  }
  async function cancelSession(user, sid) {
    const s = await getSession(sid), g = await load(s.community_id), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    if (s.status !== "scheduled") throw E.bad("لا يمكن إلغاء جلسة بدأت أو انتهت");
    await db.run("UPDATE study_sessions SET status='cancelled' WHERE id=$1", [sid]);
    return { ok: true };
  }
  async function start(user, sid, b = {}) {
    const s = await getSession(sid), g = await load(s.community_id), a = await access(g, user); need(a.manager, "يبدأ الجلسة المعلم أو المشرف");
    if (s.status === "live") return { session: sessionClient(s) };
    if (s.status !== "scheduled") throw E.bad("الجلسة منتهية أو ملغاة");
    if (Date.parse(s.starts_at) - clock() > 60 * 60e3) throw E.bad("يمكن بدء الجلسة قبل موعدها بساعة على الأكثر");
    let roomId = null;
    if (b.room !== false) {
      const room = await ctx.services.rooms.createRoom(user, { title: s.title, topic: "study", notifyFollowers: false });
      roomId = room.room.id;
    }
    await db.run("UPDATE study_sessions SET status='live', room_id=$1, started_at=$2 WHERE id=$3 AND status='scheduled'", [roomId, isoNow(), sid]);
    await mark(sid, s.community_id, user.id, "present", user.id, true);
    for (const m of await members(s.community_id)) {
      if (m.user_id === user.id) continue;
      const r = await db.run("INSERT INTO study_reminders(session_id,user_id,kind,at) VALUES($1,$2,'live',$3) ON CONFLICT DO NOTHING", [sid, m.user_id, isoNow()]);
      if (r.changes) await notify(m.user_id, "study_session_live", sid);
      ctx.realtime?.send?.(m.user_id, "study_live", { session: sid, community: s.community_id, room: roomId });
    }
    return { session: sessionClient(await getSession(sid)) };
  }
  async function join(user, sid) {
    const s = await getSession(sid), g = await load(s.community_id), a = await access(g, user); need(a.member, "انضم إلى المجموعة أولاً");
    if (s.status !== "live") throw E.bad(s.status === "scheduled" ? "لم تبدأ الجلسة بعد" : "انتهت الجلسة");
    const late = clock() > Date.parse(s.starts_at) + g.settingsObj.lateAfterMin * 60e3;
    const ex = await db.get("SELECT status FROM study_attendance WHERE session_id=$1 AND user_id=$2", [sid, user.id]);
    if (!ex || ex.status === "absent") await mark(sid, s.community_id, user.id, late ? "late" : "present", null, true);
    return { session: sessionClient(s), attendance: (await db.get("SELECT status FROM study_attendance WHERE session_id=$1 AND user_id=$2", [sid, user.id])).status, roomId: s.room_id };
  }
  async function end(user, sid) {
    const s = await getSession(sid), g = await load(s.community_id), a = await access(g, user); need(a.manager, "ينهي الجلسة المعلم أو المشرف");
    if (s.status !== "live") throw E.bad("الجلسة ليست مباشرة");
    return finish(s);
  }
  async function finish(s) {
    const at = isoNow();
    await db.run("UPDATE study_sessions SET status='ended', ended_at=$1 WHERE id=$2 AND status='live'", [at, s.id]);
    if (s.room_id) { try { await ctx.services.rooms.endRoom(s.room_id); } catch { /* room already gone */ } }
    // minutes for everyone who joined, capped by the session length; members with no record → absent
    const endMs = Date.parse(at), dur = s.duration_min;
    for (const r of await db.all("SELECT user_id, joined_at FROM study_attendance WHERE session_id=$1 AND status IN ('present','late') AND joined_at IS NOT NULL", [s.id]))
      await db.run("UPDATE study_attendance SET minutes=$1 WHERE session_id=$2 AND user_id=$3", [Math.max(0, Math.min(dur, Math.round((endMs - Date.parse(r.joined_at)) / 60e3))), s.id, r.user_id]);
    const have = new Set((await db.all("SELECT user_id FROM study_attendance WHERE session_id=$1", [s.id])).map((r) => r.user_id));
    for (const m of await members(s.community_id)) if (!have.has(m.user_id) && Date.parse(m.joined_at) <= Date.parse(s.starts_at) + dur * 60e3) await mark(s.id, s.community_id, m.user_id, "absent", null, false);
    return { session: sessionClient(await getSession(s.id)) };
  }

  /* ---------- 3. attendance ---------- */
  async function mark(sid, cid, uid, status, by, joined) {
    await db.run(`INSERT INTO study_attendance(session_id,user_id,community_id,status,minutes,joined_at,marked_by,updated_at) VALUES($1,$2,$3,$4,0,$5,$6,$7)
      ON CONFLICT (session_id, user_id) DO UPDATE SET status=excluded.status, joined_at=COALESCE(study_attendance.joined_at, excluded.joined_at), marked_by=excluded.marked_by, updated_at=excluded.updated_at`, [sid, uid, cid, status, joined ? isoNow() : null, by, isoNow()]);
  }
  async function setAttendance(user, sid, uid, b = {}) {
    const s = await getSession(sid), g = await load(s.community_id), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    if (s.status === "cancelled" || (s.status === "scheduled" && Date.parse(s.starts_at) > clock() + 3600e3)) throw E.bad("لا يُسجّل الحضور لجلسة لم تبدأ");
    const st = oneOf(b.status, Object.keys(ATT), null); if (!st) throw E.bad("حالة حضور غير صالحة");
    if (!MEMBER_ROLES.includes(await roleOf(s.community_id, uid))) throw E.nf("ليس عضواً في المجموعة");
    await mark(sid, s.community_id, uid, st, user.id, false);
    return { ok: true, attendance: st };
  }
  async function sessionAttendance(user, sid) {
    const s = await getSession(sid), g = await load(s.community_id), a = await access(g, user); need(a.member || a.admin, "انضم إلى المجموعة أولاً");
    const rows = await db.all("SELECT a.user_id, a.status, a.minutes, a.joined_at, u.name, u.handle FROM study_attendance a JOIN users u ON u.id=a.user_id WHERE a.session_id=$1 ORDER BY u.name", [sid]);
    if (!a.manager) { const me = rows.find((r) => r.user_id === user.id); return { session: sessionClient(s), mine: me ? { status: me.status, minutes: me.minutes } : null, counts: null }; }
    const ms = await members(s.community_id), by = new Map(rows.map((r) => [r.user_id, r]));
    const list = ms.map((m) => ({ id: m.user_id, name: m.name, handle: m.handle, status: by.get(m.user_id)?.status || null, minutes: by.get(m.user_id)?.minutes || 0, joinedAt: by.get(m.user_id)?.joined_at || null }));
    const counts = Object.fromEntries(Object.keys(ATT).map((k) => [k, list.filter((x) => x.status === k).length]));
    return { session: sessionClient(s), members: list, counts };
  }
  async function groupAttendance(user, cid) {
    const g = await load(cid), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    const ms = await members(cid), out = [];
    for (const m of ms) { const st = await myStats(g, m.user_id); out.push({ id: m.user_id, name: m.name, handle: m.handle, role: m.role, ...st }); }
    const ended = Number((await db.get("SELECT COUNT(*) n FROM study_sessions WHERE community_id=$1 AND status='ended'", [cid])).n);
    return { members: out.sort((x, y) => (y.rate ?? -1) - (x.rate ?? -1)), sessionsEnded: ended };
  }
  async function attendanceCsv(req, res) {
    const d = await groupAttendance(req.user, req.params.id);
    const body = "\ufeff" + [["name", "handle", "sessions", "attended", "rate_pct", "streak", "longest_streak"].join(","), ...d.members.map((m) => [m.name, "@" + m.handle, m.sessions, m.attended, m.rate ?? "", m.streak, m.longestStreak].map(csvCell).join(","))].join("\r\n");
    res.writeHead(200, { ...require("../lib/http").SEC_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="attendance-${req.params.id}.csv"` });
    res.end(body); return ctx.STREAM;
  }

  /* ---------- 4. notes & resources ---------- */
  const noteClient = (n, uid, manager) => ({ id: n.id, sessionId: n.session_id, kind: n.kind, title: n.title, body: n.body || "", url: n.url || null, pinned: !!n.pinned, author: { id: n.author, name: n.an, handle: n.ah }, createdAt: n.created_at, updatedAt: n.updated_at, canEdit: n.author === uid || manager });
  async function notes(user, cid, q = {}) {
    const g = await load(cid), a = await access(g, user); need(a.member || a.admin, "الملاحظات لأعضاء المجموعة");
    const rows = await db.all(`SELECT n.*, u.name an, u.handle ah FROM study_notes n JOIN users u ON u.id=n.author WHERE n.community_id=$1 ${q.session ? "AND n.session_id=$2" : ""} ORDER BY n.pinned DESC, n.created_at DESC LIMIT 200`, q.session ? [cid, String(q.session)] : [cid]);
    return { notes: rows.map((n) => noteClient(n, user.id, a.manager)) };
  }
  function readNote(b, partial) {
    const o = {};
    if (!partial || b.kind !== undefined) o.kind = oneOf(b.kind, ["note", "link"], "note");
    if (!partial || b.title !== undefined) o.title = str(b.title, 120, { required: true, min: 2 });
    if (!partial || b.body !== undefined) o.body = str(b.body, 5000) || "";
    if (!partial || b.url !== undefined) { const u = str(b.url, 500); if (u && !/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(u)) throw E.bad("الرابط يجب أن يبدأ بـ https://"); o.url = u || null; }
    return o;
  }
  async function addNote(user, cid, b = {}) {
    const g = await load(cid), a = await access(g, user); need(a.member && a.role !== "muted", "للأعضاء فقط");
    if (!rl.hit("comment", "stn:" + user.id)) throw E.rate();
    const n = readNote(b, false); if (n.kind === "link" && !n.url) throw E.bad("أضف الرابط");
    let sid = null; if (b.sessionId) { const s = await getSession(String(b.sessionId)); if (s.community_id !== cid) throw E.bad(); sid = s.id; }
    try { const v = await ctx.services.automod?.assess?.({ text: `${n.title}\n${n.body}\n${n.url || ""}`, author: user.id }); if (v && ["block", "remove"].includes(v.action)) throw E.bad("المحتوى يخالف الإرشادات"); } catch (e) { if (e.status) throw e; }
    const nid = id("sn"), at = isoNow();
    await db.run("INSERT INTO study_notes(id,community_id,session_id,kind,title,body,url,author,pinned,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$9)", [nid, cid, sid, n.kind, n.title, n.body, n.url, user.id, at]);
    return { note: noteClient({ ...(await db.get("SELECT * FROM study_notes WHERE id=$1", [nid])), an: user.name, ah: user.handle }, user.id, a.manager) };
  }
  async function noteGuard(user, nid) { const n = await db.get("SELECT * FROM study_notes WHERE id=$1", [nid]); if (!n) throw E.nf(); const g = await load(n.community_id), a = await access(g, user); return { n, a }; }
  async function editNote(user, nid, b = {}) {
    const { n, a } = await noteGuard(user, nid); need(n.author === user.id || a.manager, "لا تملك تعديل هذه الملاحظة");
    const o = readNote(b, true);
    await db.run("UPDATE study_notes SET title=$1, body=$2, url=$3, updated_at=$4 WHERE id=$5", [o.title ?? n.title, o.body ?? n.body, o.url !== undefined ? o.url : n.url, isoNow(), nid]);
    return { ok: true };
  }
  async function pinNote(user, nid, on) { const { a } = await noteGuard(user, nid); need(a.manager, "التثبيت للمعلمين والمشرفين"); await db.run("UPDATE study_notes SET pinned=$1 WHERE id=$2", [on ? 1 : 0, nid]); return { ok: true, pinned: !!on }; }
  async function delNote(user, nid) { const { n, a } = await noteGuard(user, nid); need(n.author === user.id || a.manager, "لا تملك حذف هذه الملاحظة"); await db.run("DELETE FROM study_notes WHERE id=$1", [nid]); return { ok: true }; }

  /* ---------- 5. goals & streaks ---------- */
  const goalClient = (x) => ({ id: x.id, personal: !!x.user_id, title: x.title, unit: x.unit || "", target: x.target, progress: x.progress, percent: Math.min(100, Math.round((x.progress / Math.max(1, x.target)) * 100)), dueAt: x.due_at, done: !!x.done_at, doneAt: x.done_at });
  async function goals(user, cid) {
    const g = await load(cid), a = await access(g, user); need(a.member || a.admin, "الأهداف لأعضاء المجموعة");
    const group = await db.all("SELECT * FROM study_goals WHERE community_id=$1 AND user_id IS NULL ORDER BY created_at", [cid]);
    const mine = await db.all("SELECT * FROM study_goals WHERE community_id=$1 AND user_id=$2 ORDER BY created_at", [cid, user.id]);
    return { group: group.map(goalClient), mine: mine.map(goalClient), stats: a.member ? await myStats(g, user.id) : null, canManage: a.manager };
  }
  async function addGoal(user, cid, b = {}) {
    const g = await load(cid), a = await access(g, user); need(a.member, "للأعضاء فقط");
    const personal = b.personal !== false; if (!personal) need(a.manager, "أهداف المجموعة للمعلمين والمشرفين");
    if (Number((await db.get("SELECT COUNT(*) n FROM study_goals WHERE community_id=$1 AND " + (personal ? "user_id=$2" : "user_id IS NULL"), personal ? [cid, user.id] : [cid])).n) >= 30) throw E.bad("وصلت إلى الحد الأقصى للأهداف");
    const target = Math.round(+b.target); if (!(target >= 1 && target <= 1e6)) throw E.bad("الهدف رقم من 1 فأكثر");
    const due = b.dueAt ? new Date(b.dueAt) : null; if (due && isNaN(due)) throw E.bad("تاريخ غير صالح");
    const gid = id("sg"), at = isoNow();
    await db.run("INSERT INTO study_goals(id,community_id,user_id,title,unit,target,progress,due_at,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$9)", [gid, cid, personal ? user.id : null, str(b.title, 120, { required: true, min: 2 }), str(b.unit, 30), target, due ? due.toISOString() : null, user.id, at]);
    return { goal: goalClient(await db.get("SELECT * FROM study_goals WHERE id=$1", [gid])) };
  }
  async function goalProgress(user, gid, b = {}) {
    const x = await db.get("SELECT * FROM study_goals WHERE id=$1", [gid]); if (!x) throw E.nf();
    const g = await load(x.community_id), a = await access(g, user);
    need(x.user_id ? x.user_id === user.id : a.manager, "لا تملك تحديث هذا الهدف");
    let p = b.set !== undefined ? Math.round(+b.set) : x.progress + Math.round(+b.add || 0);
    if (!Number.isFinite(p)) throw E.bad(); p = Math.max(0, Math.min(x.target * 10, p));
    const done = p >= x.target ? x.done_at || isoNow() : null;
    await db.run("UPDATE study_goals SET progress=$1, done_at=$2, updated_at=$3 WHERE id=$4", [p, done, isoNow(), gid]);
    return { goal: goalClient(await db.get("SELECT * FROM study_goals WHERE id=$1", [gid])) };
  }
  async function delGoal(user, gid) {
    const x = await db.get("SELECT * FROM study_goals WHERE id=$1", [gid]); if (!x) throw E.nf();
    const g = await load(x.community_id), a = await access(g, user); need(x.user_id ? x.user_id === user.id || a.admin : a.manager, "لا تملك حذف هذا الهدف");
    await db.run("DELETE FROM study_goals WHERE id=$1", [gid]); return { ok: true };
  }

  /* ---------- 6. halaqa progress ---------- */
  const progClient = (p) => ({ id: p.id, studentId: p.student_id, teacherId: p.teacher_id, teacherName: p.tn || null, sessionId: p.session_id, kind: p.kind, kindLabel: KINDS[p.kind], surah: p.surah, surahName: p.surah ? Q.SURAHS[p.surah - 1].name : null, fromAyah: p.from_ayah, toAyah: p.to_ayah, ayahs: p.ayahs, grade: p.grade, gradeLabel: GRADES[p.grade] || null, note: p.note || "", at: p.at });
  async function logProgress(user, cid, b = {}) {
    const g = await load(cid), a = await access(g, user); need(g.mode === "halaqa", "تتبّع الحفظ متاح في وضع الحلقة"); need(a.manager, "يسجّل التسميع المعلم أو المشرف");
    const student = String(b.studentId || ""); if (!MEMBER_ROLES.includes(await roleOf(cid, student))) throw E.bad("الطالب ليس عضواً في الحلقة");
    const kind = oneOf(b.kind, Object.keys(KINDS), null); if (!kind) throw E.bad("اختر نوع التسجيل");
    let r; try { r = Q.range(b.surah, b.fromAyah, b.toAyah); } catch (e) { throw E.bad(e.message === "surah" ? "رقم السورة من 1 إلى 114" : "نطاق الآيات غير صالح لهذه السورة"); }
    let sid = null; if (b.sessionId) { const s = await getSession(String(b.sessionId)); if (s.community_id !== cid) throw E.bad(); sid = s.id; }
    const pid = id("sp");
    await db.run("INSERT INTO study_progress(id,community_id,student_id,teacher_id,session_id,kind,surah,from_ayah,to_ayah,ayahs,grade,note,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [pid, cid, student, user.id, sid, kind, r.surah, r.from, r.to, r.count, oneOf(b.grade, Object.keys(GRADES), null), str(b.note, 500), isoNow()]);
    if (student !== user.id) await notify(student, "study_progress", cid);
    return { entry: progClient({ ...(await db.get("SELECT * FROM study_progress WHERE id=$1", [pid])), tn: user.name }) };
  }
  async function progress(user, cid, q = {}) {
    const g = await load(cid), a = await access(g, user); need(g.mode === "halaqa", "تتبّع الحفظ متاح في وضع الحلقة"); need(a.member || a.admin, "لأعضاء الحلقة فقط");
    const student = q.student && a.manager ? String(q.student) : user.id; // students only ever see their own record
    const rows = await db.all("SELECT p.*, u.name tn FROM study_progress p LEFT JOIN users u ON u.id=p.teacher_id WHERE p.community_id=$1 AND p.student_id=$2 ORDER BY p.at DESC LIMIT 1000", [cid, student]);
    const mem = Q.coverage(rows.filter((r) => r.kind === "memorisation" && r.grade !== "needs_work").map((r) => ({ surah: r.surah, from: r.from_ayah, to: r.to_ayah })));
    const grades = Object.fromEntries(Object.keys(GRADES).map((k) => [k, rows.filter((r) => r.grade === k).length]));
    const st = await db.get("SELECT id, name, handle FROM users WHERE id=$1", [student]);
    return { student: st ? { id: st.id, name: st.name, handle: st.handle } : null, entries: rows.slice(0, 100).map(progClient), memorised: { ayahs: mem.total, percent: mem.percent, completeSurahs: mem.completeSurahs, bySurah: Object.entries(mem.bySurah).map(([n, c]) => ({ surah: +n, name: Q.SURAHS[+n - 1].name, covered: c, ayahs: Q.AYAHS[+n - 1] })).sort((x, y) => x.surah - y.surah) },
      recitationDays: dayStreak(rows.map((r) => r.at), g.scheduleObj?.tz || "Asia/Riyadh", clock()), grades, total: Q.TOTAL, canLog: a.manager };
  }
  async function students(user, cid) {
    const g = await load(cid), a = await access(g, user); need(g.mode === "halaqa" && a.manager, "للمعلمين والمشرفين فقط");
    const ms = await members(cid), out = [];
    const agg = await db.all("SELECT student_id, kind, surah, from_ayah, to_ayah, grade, at FROM study_progress WHERE community_id=$1 ORDER BY at DESC LIMIT 20000", [cid]);
    for (const m of ms) {
      if (g.teacherIds.includes(m.user_id)) continue;
      const mine = agg.filter((r) => r.student_id === m.user_id);
      const cov = Q.coverage(mine.filter((r) => r.kind === "memorisation" && r.grade !== "needs_work").map((r) => ({ surah: r.surah, from: r.from_ayah, to: r.to_ayah })));
      out.push({ id: m.user_id, name: m.name, handle: m.handle, memorisedAyahs: cov.total, percent: cov.percent, lastAt: mine[0]?.at || null, entries: mine.length });
    }
    return { students: out };
  }
  async function delProgress(user, pid) {
    const p = await db.get("SELECT * FROM study_progress WHERE id=$1", [pid]); if (!p) throw E.nf();
    const g = await load(p.community_id), a = await access(g, user); need(p.teacher_id === user.id || a.admin, "يحذفه من سجّله أو المشرف");
    await db.run("DELETE FROM study_progress WHERE id=$1", [pid]); return { ok: true };
  }

  /* ---------- 9. assignments / homework (v2.29) ---------- */
  const SUB_ST = { submitted: "سُلّم", reviewed: "صُحّح", returned: "أُعيد للتعديل" };
  const asgClient = (x) => ({ id: x.id, communityId: x.community_id, sessionId: x.session_id || null, title: x.title, body: x.body || "", dueAt: x.due_at || null, points: Number(x.points), status: x.status, createdAt: x.created_at, overdue: !!x.due_at && Date.parse(x.due_at) < clock() });
  const subClient = (s) => s && ({ userId: s.user_id, body: s.body || "", url: s.url || null, status: s.status, statusLabel: SUB_ST[s.status], grade: s.grade === null || s.grade === undefined ? null : Number(s.grade), feedback: s.feedback || "", submittedAt: s.submitted_at, reviewedAt: s.reviewed_at || null, name: s.name, handle: s.handle });
  async function getAsg(aid) { const x = await db.get("SELECT * FROM study_assignments WHERE id=$1 AND status<>'deleted'", [aid]); if (!x) throw E.nf("الواجب غير موجود"); return x; }
  async function assignments(user, cid) {
    const g = await load(cid), a = await access(g, user); need(a.member || a.admin, "لأعضاء المجموعة فقط");
    const rows = await db.all("SELECT * FROM study_assignments WHERE community_id=$1 AND status<>'deleted' ORDER BY COALESCE(due_at, created_at) DESC LIMIT 200", [cid]);
    const ids = rows.map((r) => r.id);
    const mine = ids.length ? new Map((await db.all(`SELECT * FROM study_submissions WHERE user_id=$1 AND assignment_id IN (${ph(ids, 1)})`, [user.id, ...ids])).map((s) => [s.assignment_id, s])) : new Map();
    const counts = a.manager && ids.length ? new Map((await db.all(`SELECT assignment_id, COUNT(*) n, SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) p FROM study_submissions WHERE assignment_id IN (${ph(ids)}) GROUP BY assignment_id`, ids)).map((r) => [r.assignment_id, { n: Number(r.n), pending: Number(r.p || 0) }])) : new Map();
    return { assignments: rows.map((x) => ({ ...asgClient(x), mine: subClient(mine.get(x.id)) || null, ...(a.manager ? { submissions: counts.get(x.id)?.n || 0, toReview: counts.get(x.id)?.pending || 0 } : {}) })), canCreate: a.manager };
  }
  async function addAssignment(user, cid, b = {}) {
    const g = await load(cid), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    if (!rl.hit("default", "sasg:" + user.id)) throw E.rate();
    let due = null; if (b.dueAt) { const t = Date.parse(b.dueAt); if (isNaN(t)) throw E.bad("موعد التسليم غير صالح"); due = new Date(t).toISOString(); }
    let sid = null; if (b.sessionId) { const s = await getSession(String(b.sessionId)); if (s.community_id !== cid) throw E.bad(); sid = s.id; }
    const aid = id("sa"), at = isoNow();
    await db.run("INSERT INTO study_assignments(id,community_id,session_id,title,body,due_at,points,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$9)",
      [aid, cid, sid, str(b.title, 120, { required: true, min: 2 }), str(b.body, 4000) || "", due, Math.max(1, Math.min(1000, Math.round(+b.points || 10))), user.id, at]);
    for (const m of await members(cid)) if (m.user_id !== user.id && !g.teacherIds.includes(m.user_id)) await notify(m.user_id, "study_assignment", aid);
    return { assignment: asgClient(await getAsg(aid)) };
  }
  async function assignment(user, aid) {
    const x = await getAsg(aid), g = await load(x.community_id), a = await access(g, user); need(a.member || a.admin, "لأعضاء المجموعة فقط");
    const mine = await db.get("SELECT * FROM study_submissions WHERE assignment_id=$1 AND user_id=$2", [aid, user.id]);
    let roster = null;
    if (a.manager) {
      const subs = await db.all("SELECT s.*, u.name, u.handle FROM study_submissions s JOIN users u ON u.id=s.user_id WHERE s.assignment_id=$1 ORDER BY s.submitted_at", [aid]);
      const done = new Set(subs.map((s) => s.user_id));
      roster = { submissions: subs.map(subClient), missing: (await members(x.community_id)).filter((m) => !done.has(m.user_id) && !g.teacherIds.includes(m.user_id)).map((m) => ({ id: m.user_id, name: m.name, handle: m.handle })) };
    }
    return { assignment: asgClient(x), group: { id: g.community_id, name: g.name, mode: g.mode }, mine: subClient(mine), canReview: a.manager, roster };
  }
  async function submit(user, aid, b = {}) {
    const x = await getAsg(aid), g = await load(x.community_id), a = await access(g, user); need(a.member, "لأعضاء المجموعة فقط");
    if (x.status !== "open") throw E.bad("أُغلق هذا الواجب");
    const body = str(b.body, 8000) || null, url = str(b.url, 400) || null;
    if (url && !/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(url)) throw E.bad("الرابط يجب أن يبدأ بـ https://");
    if (!body && !url) throw E.bad("اكتب إجابتك أو أرفق رابطاً");
    const ex = await db.get("SELECT status FROM study_submissions WHERE assignment_id=$1 AND user_id=$2", [aid, user.id]);
    if (ex && ex.status === "reviewed") throw E.bad("صحّح المعلم إجابتك؛ اطلب منه إعادتها للتعديل");
    await db.run("INSERT INTO study_submissions(assignment_id,user_id,community_id,body,url,status,submitted_at) VALUES($1,$2,$3,$4,$5,'submitted',$6) ON CONFLICT (assignment_id, user_id) DO UPDATE SET body=$4, url=$5, status='submitted', submitted_at=$6", [aid, user.id, x.community_id, body, url, isoNow()]);
    return assignment(user, aid);
  }
  async function reviewSub(user, aid, uid, b = {}) {
    const x = await getAsg(aid), g = await load(x.community_id), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    const s = await db.get("SELECT * FROM study_submissions WHERE assignment_id=$1 AND user_id=$2", [aid, uid]); if (!s) throw E.nf("لم يسلّم هذا العضو بعد");
    const ret = b.action === "return";
    const grade = ret ? null : Math.max(0, Math.min(Number(x.points), Math.round(+b.grade)));
    if (!ret && !Number.isFinite(+b.grade)) throw E.bad("أدخل الدرجة");
    await db.run("UPDATE study_submissions SET status=$1, grade=$2, feedback=$3, reviewed_at=$4, reviewed_by=$5 WHERE assignment_id=$6 AND user_id=$7", [ret ? "returned" : "reviewed", grade, str(b.feedback, 2000) || null, isoNow(), user.id, aid, uid]);
    if (uid !== user.id) await notify(uid, "study_feedback", aid);
    return assignment(user, aid);
  }
  async function closeAssignment(user, aid, del) {
    const x = await getAsg(aid), g = await load(x.community_id), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    await db.run("UPDATE study_assignments SET status=$1, updated_at=$2 WHERE id=$3", [del ? "deleted" : x.status === "open" ? "closed" : "open", isoNow(), aid]);
    return { ok: true };
  }

  /* ---------- 10. teacher dashboard (v2.29) ---------- */
  async function dashboard(user, cid) {
    const g = await load(cid), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    const ms = (await members(cid)).filter((m) => !g.teacherIds.includes(m.user_id));
    const ended = await db.all("SELECT id, starts_at FROM study_sessions WHERE community_id=$1 AND status='ended' ORDER BY starts_at DESC LIMIT 8", [cid]);
    const eids = ended.map((s) => s.id);
    const att = eids.length ? await db.all(`SELECT session_id, user_id, status FROM study_attendance WHERE session_id IN (${ph(eids)})`, eids) : [];
    const asg = await db.all("SELECT id, due_at, points FROM study_assignments WHERE community_id=$1 AND status<>'deleted'", [cid]);
    const subs = await db.all("SELECT assignment_id, user_id, status, grade FROM study_submissions WHERE community_id=$1", [cid]);
    const comp = new Set((await db.all("SELECT user_id FROM study_completions WHERE community_id=$1", [cid])).map((r) => r.user_id));
    const dueIds = asg.filter((x) => x.due_at && Date.parse(x.due_at) < clock()).map((x) => x.id);
    const rows = ms.map((m) => {
      const mine = eids.map((sid) => { const sess = ended.find((e) => e.id === sid); if (Date.parse(sess.starts_at) < Date.parse(m.joined_at) - DAY) return null; return att.find((r) => r.session_id === sid && r.user_id === m.user_id)?.status || "absent"; }).filter(Boolean);
      const counted = mine.filter((s) => s !== "excused"), here = counted.filter((s) => s === "present" || s === "late").length;
      const ms2 = subs.filter((s) => s.user_id === m.user_id), overdue = dueIds.filter((d) => !ms2.some((s) => s.assignment_id === d)).length;
      const graded = ms2.filter((s) => s.grade !== null && s.grade !== undefined), pts = graded.reduce((t, s) => t + Number(s.grade), 0), max = graded.reduce((t, s) => t + Number(asg.find((x) => x.id === s.assignment_id)?.points || 0), 0);
      const st = streaks(mine);
      const risk = [];
      if (counted.length >= 3 && here / counted.length < 0.5) risk.push("حضور أقل من النصف");
      if (mine.length >= 2 && mine.slice(0, 2).every((s) => s === "absent")) risk.push("غاب عن آخر جلستين");
      if (overdue >= 2) risk.push(`${overdue} واجبات متأخرة`);
      return { id: m.user_id, name: m.name, handle: m.handle, color: m.color, attendanceRate: counted.length ? Math.round((here / counted.length) * 100) : null, sessions: mine.length, streak: st.current, submitted: ms2.length, assigned: asg.length, overdue, score: max ? Math.round((pts / max) * 100) : null, completed: comp.has(m.user_id), risk };
    });
    const rates = rows.map((r) => r.attendanceRate).filter((x) => x !== null);
    const perSession = ended.map((s) => ({ id: s.id, at: s.starts_at, present: att.filter((r) => r.session_id === s.id && (r.status === "present" || r.status === "late")).length })).reverse();
    return { group: { id: cid, name: g.name, mode: g.mode }, students: rows.sort((x, y) => y.risk.length - x.risk.length || (x.attendanceRate ?? 101) - (y.attendanceRate ?? 101)),
      summary: { students: rows.length, avgAttendance: rates.length ? Math.round(rates.reduce((t, x) => t + x, 0) / rates.length) : null, atRisk: rows.filter((r) => r.risk.length).length, toReview: subs.filter((s) => s.status === "submitted").length, assignments: asg.length, completed: comp.size },
      perSession, criteria: completionCriteria(g) };
  }

  /* ---------- 11. completion — the hook phase 73 turns into verifiable certificates (v2.29) ---------- */
  const completionCriteria = (g) => ({ minAttendance: Math.max(0, Math.min(100, +(g.settingsObj.completionAttendance ?? 75))), minAssignments: Math.max(0, Math.min(100, +(g.settingsObj.completionAssignments ?? 70))) });
  async function completionOf(g, uid) {
    const c = completionCriteria(g), stats = await myStats(g, uid);
    const asg = await db.all("SELECT id FROM study_assignments WHERE community_id=$1 AND status<>'deleted'", [g.community_id]);
    const done = asg.length ? Number((await db.get(`SELECT COUNT(*) n FROM study_submissions WHERE user_id=$1 AND status IN ('submitted','reviewed') AND assignment_id IN (${ph(asg.map((x) => x.id), 1)})`, [uid, ...asg.map((x) => x.id)])).n) : 0;
    const attendance = stats?.rate ?? null, assignmentsPct = asg.length ? Math.round((done / asg.length) * 100) : null;
    const okA = attendance === null ? false : attendance >= c.minAttendance, okS = assignmentsPct === null ? true : assignmentsPct >= c.minAssignments;
    const issued = await db.get("SELECT issued_at, note, issued_by FROM study_completions WHERE community_id=$1 AND user_id=$2", [g.community_id, uid]);
    return { criteria: c, attendance, sessions: stats?.sessions || 0, assignmentsDone: done, assignmentsTotal: asg.length, assignmentsPct, eligible: okA && okS, completed: !!issued, issuedAt: issued?.issued_at || null, note: issued?.note || null };
  }
  async function completion(user, cid, q = {}) {
    const g = await load(cid), a = await access(g, user); need(a.member || a.admin, "لأعضاء المجموعة فقط");
    const uid = q.user && a.manager ? String(q.user) : user.id;
    return completionOf(g, uid);
  }
  async function complete(user, cid, uid, b = {}) {
    const g = await load(cid), a = await access(g, user); need(a.manager, "للمعلمين والمشرفين فقط");
    if (!MEMBER_ROLES.includes(await roleOf(cid, uid))) throw E.bad("ليس عضواً في المجموعة");
    if (b.revoke) { await db.run("DELETE FROM study_completions WHERE community_id=$1 AND user_id=$2", [cid, uid]); ctx.bus?.emit?.("STUDY_COMPLETION_REVOKED", { community: cid, user: uid, by: user.id }); return completionOf(g, uid); } // phase 73: the certificate is revoked too
    const st = await completionOf(g, uid);
    if (!st.eligible && !b.override) throw Object.assign(E.bad("لم يستوفِ معايير الإتمام بعد؛ يمكنك التأكيد يدوياً"), { code: "not_eligible", details: st });
    await db.run("INSERT INTO study_completions(community_id,user_id,issued_by,note,criteria,issued_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (community_id, user_id) DO UPDATE SET issued_by=$3, note=$4, criteria=$5, issued_at=$6",
      [cid, uid, user.id, str(b.note, 300) || null, JSON.stringify({ ...st.criteria, attendance: st.attendance, assignmentsPct: st.assignmentsPct, override: !st.eligible }), isoNow()]);
    ctx.bus?.emit?.("STUDY_COMPLETED", { community: cid, user: uid, by: user.id }); // phase 73: certificates subscribe here
    await ctx.audit?.("STUDY_COMPLETED", cid, uid, user.id);
    return completionOf(g, uid);
  }

  /* ---------- 7. rooms guard (rooms.js asks before join / state) ---------- */
  async function roomAccess(rid, uid) {
    const s = await db.get("SELECT community_id FROM study_sessions WHERE room_id=$1", [rid]); if (!s) return true;
    return MEMBER_ROLES.includes(await roleOf(s.community_id, uid));
  }

  /* ---------- 8. reminders + housekeeping job ---------- */
  async function tick() {
    const nowMs = clock(); let created = 0, reminded = 0, ended = 0;
    for (const g of await db.all("SELECT community_id FROM study_groups WHERE schedule IS NOT NULL LIMIT 2000")) created += await materialise(g.community_id);
    const soon = await db.all("SELECT s.*, g.settings FROM study_sessions s JOIN study_groups g ON g.community_id=s.community_id WHERE s.status='scheduled' AND s.starts_at > $1 AND s.starts_at <= $2 LIMIT 500", [new Date(nowMs).toISOString(), new Date(nowMs + 1440 * 60e3).toISOString()]);
    for (const s of soon) {
      const mins = { remindMinutes: 60, ...parse(s.settings, {}) }.remindMinutes;
      if (Date.parse(s.starts_at) - nowMs > mins * 60e3) continue;
      for (const m of await members(s.community_id)) {
        const r = await db.run("INSERT INTO study_reminders(session_id,user_id,kind,at) VALUES($1,$2,'soon',$3) ON CONFLICT DO NOTHING", [s.id, m.user_id, isoNow()]);
        if (r.changes) { await notify(m.user_id, "study_session_soon", s.id); reminded++; }
      }
    }
    for (const s of await db.all("SELECT * FROM study_sessions WHERE status='live' LIMIT 200")) if (Date.parse(s.started_at || s.starts_at) + (s.duration_min + 120) * 60e3 < nowMs) { await finish(s); ended++; }
    await db.run("UPDATE study_sessions SET status='cancelled', ended_at=$1 WHERE status='scheduled' AND starts_at < $2 AND auto=1 AND NOT EXISTS (SELECT 1 FROM study_attendance a WHERE a.session_id=study_sessions.id)", [isoNow(), new Date(nowMs - DAY).toISOString()]).catch(() => { });
    return { created, reminded, ended };
  }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("study.tick", +(env.STUDY_TICK_INTERVAL_MS || 5 * 60e3), () => tick());

  /* ---------- routes ---------- */
  R.get("/api/study/groups", async (req) => list(req.user, req.query));
  R.post("/api/study/groups", A(async (req) => create(req.user, req.body || {})));
  R.get("/api/study/quran/surahs", async () => ({ surahs: Q.SURAHS, total: Q.TOTAL }));
  R.get("/api/study/groups/:id", async (req) => detail(req.user, req.params.id));
  R.patch("/api/study/groups/:id", A(async (req) => update(req.user, req.params.id, req.body || {})));
  R.post("/api/study/groups/:id/enable", A(async (req) => enable(req.user, req.params.id, req.body || {})));
  R.get("/api/study/groups/:id/sessions", async (req) => sessions(req.user, req.params.id, req.query));
  R.post("/api/study/groups/:id/sessions", A(async (req) => addSession(req.user, req.params.id, req.body || {})));
  R.get("/api/study/groups/:id/attendance", A(async (req) => groupAttendance(req.user, req.params.id)));
  R.get("/api/study/groups/:id/attendance.csv", A(attendanceCsv));
  R.get("/api/study/groups/:id/notes", A(async (req) => notes(req.user, req.params.id, req.query)));
  R.post("/api/study/groups/:id/notes", A(async (req) => addNote(req.user, req.params.id, req.body || {})));
  R.get("/api/study/groups/:id/goals", A(async (req) => goals(req.user, req.params.id)));
  R.post("/api/study/groups/:id/goals", A(async (req) => addGoal(req.user, req.params.id, req.body || {})));
  R.get("/api/study/groups/:id/progress", A(async (req) => progress(req.user, req.params.id, req.query)));
  R.post("/api/study/groups/:id/progress", A(async (req) => logProgress(req.user, req.params.id, req.body || {})));
  R.get("/api/study/groups/:id/students", A(async (req) => students(req.user, req.params.id)));
  R.get("/api/study/sessions/:id", async (req) => { const s = await getSession(req.params.id), g = await load(s.community_id), a = await access(g, req.user); need(a.canView, "هذه المجموعة خاصة"); return { session: sessionClient(s), group: { id: g.community_id, name: g.name, mode: g.mode }, me: { member: a.member, manager: a.manager } }; });
  R.patch("/api/study/sessions/:id", A(async (req) => editSession(req.user, req.params.id, req.body || {})));
  R.del("/api/study/sessions/:id", A(async (req) => cancelSession(req.user, req.params.id)));
  R.post("/api/study/sessions/:id/start", A(async (req) => start(req.user, req.params.id, req.body || {})));
  R.post("/api/study/sessions/:id/join", A(async (req) => join(req.user, req.params.id)));
  R.post("/api/study/sessions/:id/end", A(async (req) => end(req.user, req.params.id)));
  R.get("/api/study/sessions/:id/attendance", A(async (req) => sessionAttendance(req.user, req.params.id)));
  R.put("/api/study/sessions/:id/attendance/:user", A(async (req) => setAttendance(req.user, req.params.id, req.params.user, req.body || {})));
  R.patch("/api/study/notes/:id", A(async (req) => editNote(req.user, req.params.id, req.body || {})));
  R.post("/api/study/notes/:id/pin", A(async (req) => pinNote(req.user, req.params.id, req.body?.pinned !== false)));
  R.del("/api/study/notes/:id", A(async (req) => delNote(req.user, req.params.id)));
  R.post("/api/study/goals/:id/progress", A(async (req) => goalProgress(req.user, req.params.id, req.body || {})));
  R.del("/api/study/goals/:id", A(async (req) => delGoal(req.user, req.params.id)));
  R.del("/api/study/progress/:id", A(async (req) => delProgress(req.user, req.params.id)));
  R.get("/api/study/groups/:id/assignments", A(async (req) => assignments(req.user, req.params.id)));
  R.post("/api/study/groups/:id/assignments", A(async (req) => addAssignment(req.user, req.params.id, req.body || {})));
  R.get("/api/study/assignments/:id", A(async (req) => assignment(req.user, req.params.id)));
  R.post("/api/study/assignments/:id/submit", A(async (req) => submit(req.user, req.params.id, req.body || {})));
  R.post("/api/study/assignments/:id/review/:user", A(async (req) => reviewSub(req.user, req.params.id, req.params.user, req.body || {})));
  R.post("/api/study/assignments/:id/toggle", A(async (req) => closeAssignment(req.user, req.params.id, false)));
  R.del("/api/study/assignments/:id", A(async (req) => closeAssignment(req.user, req.params.id, true)));
  R.get("/api/study/groups/:id/dashboard", A(async (req) => dashboard(req.user, req.params.id)));
  R.get("/api/study/groups/:id/completion", A(async (req) => completion(req.user, req.params.id, req.query)));
  R.post("/api/study/groups/:id/completions/:user", A(async (req) => complete(req.user, req.params.id, req.params.user, req.body || {})));
  return { create, enable, update, detail, list, materialise, sessions, addSession, editSession, cancelSession, start, join, end, finish, setAttendance, sessionAttendance, groupAttendance, notes, addNote, goals, addGoal, goalProgress, logProgress, progress, students, roomAccess, tick, assignments, addAssignment, assignment, submit, reviewSub, dashboard, completion, complete };
};
module.exports.occurrences = occurrences;
module.exports.streaks = streaks;
module.exports.dayStreak = dayStreak;
module.exports.zonedToUtc = zonedToUtc;
