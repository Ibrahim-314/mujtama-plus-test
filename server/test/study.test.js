/* Phase 71 — study groups and halaqat: create on top of communities / enable an existing one, weekly schedule → automatic
 * sessions (time-zone aware), manual sessions, start in a members-only unlisted live room, join (present / late), end
 * (absent + minutes), attendance (teacher / student views, excused, CSV), streaks, notes and links (pin, permissions),
 * goals (group + personal), halaqa memorisation / recitation log with Quran coverage and strict visibility, minors never
 * teachers, reminders idempotent, migration 044. PostgreSQL + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const ST = require("../services/study");

let H, T, s1, s2, kid, out, admin, cid, gid2;
let offset = 0;
const db = () => H.app.ctx.db, S = () => H.app.ctx.services.study;
const ymd = (years) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); return d.toISOString().slice(0, 10); };
async function mk(handle, extra = {}) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123", ...extra });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const at = (min) => new Date(Date.now() + offset + min * 60e3).toISOString();
test.before(async () => {
  H = await boot({ studyOpts: { jobs: false, now: () => Date.now() + offset } });
  T = await mk("st_teacher"); s1 = await mk("st_s1"); s2 = await mk("st_s2"); kid = await mk("st_kid", { birthDate: ymd(13) }); out = await mk("st_out"); admin = await mk("st_admin");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 044 reversible + additive; data map entries", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '044_study' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "044_study"]);
  await assert.rejects(() => db().get("SELECT 1 FROM study_groups"));
  assert.deepEqual(await mig.up(db()), ["044_study", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  for (const t of ["study_attendance", "study_notes", "study_goals", "study_progress"]) { const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [s1.id]); }
});

test("create a halaqa on a community: schedule → automatic sessions in its time zone, validation, list + filters", async () => {
  assert.equal((await T.req("POST", "/api/study/groups", { name: "حلقة سيئة", schedule: { days: [], time: "19:30" } })).status, 400);
  assert.equal((await T.req("POST", "/api/study/groups", { name: "حلقة سيئة ٢", schedule: { days: [1], time: "25:00" } })).status, 400);
  H.app.ctx.rl.w.clear();
  const g = await T.req("POST", "/api/study/groups", { name: "حلقة الفجر لتحفيظ القرآن", desc: "حفظ جزء عمّ", mode: "halaqa", subject: "جزء عمّ", level: "beginner", schedule: { days: [0, 2, 4], time: "19:30", tz: "Asia/Riyadh", durationMin: 60 }, remindMinutes: 60, lateAfterMin: 10 });
  assert.equal(g.status, 200, g.error); cid = g.group.id;
  assert.equal(g.group.mode, "halaqa"); assert.equal(g.group.modeLabel, "حلقة"); assert.equal(g.group.levelLabel, "مبتدئ"); assert.deepEqual(g.group.teachers.map((t) => t.id), [T.id]);
  assert.equal(g.me.role, "owner"); assert.equal(g.me.manager, true);
  assert.equal((await db().get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, T.id])).role, "owner", "a real phase 16 community");
  const auto = await db().all("SELECT starts_at FROM study_sessions WHERE community_id=$1 AND auto=1 ORDER BY starts_at", [cid]);
  assert.ok(auto.length >= 5 && auto.length <= 7, String(auto.length));
  for (const r of auto) { const d = new Date(r.starts_at); assert.equal(d.getUTCHours(), 16); assert.equal(d.getUTCMinutes(), 30, "19:30 Riyadh = 16:30 UTC"); assert.ok([0, 2, 4].includes(new Date(d.getTime() + 3 * 3600e3).getUTCDay())); }
  assert.equal(await S().materialise(cid), 0, "idempotent");
  for (const c of [s1, s2, kid]) assert.equal((await c.req("PUT", `/api/communities/${cid}/membership`)).role, "member");
  const l = await out.req("GET", "/api/study/groups?mode=halaqa"); assert.ok(l.groups.some((x) => x.id === cid && x.nextSession));
  assert.equal((await out.req("GET", "/api/study/groups?mine=1")).groups.length, 0);
  assert.ok((await s1.req("GET", "/api/study/groups?mine=1")).groups.some((x) => x.id === cid));
  assert.ok((await out.req("GET", "/api/study/groups?q=" + encodeURIComponent("جزء"))).groups.some((x) => x.id === cid));
  assert.equal((await out.req("GET", "/api/study/groups?mode=group")).groups.filter((x) => x.id === cid).length, 0);
});

test("enable an existing community (owner only, once); private group hidden from outsiders; teachers: members, never minors", async () => {
  H.app.ctx.rl.w.clear();
  const c = (await s1.req("POST", "/api/communities", { name: "نادي الرياضيات", type: "private" })).community;
  assert.equal((await out.req("POST", `/api/study/groups/${c.id}/enable`, { mode: "group" })).status, 403);
  const e = await s1.req("POST", `/api/study/groups/${c.id}/enable`, { mode: "group", subject: "تفاضل وتكامل" }); assert.equal(e.status, 200, e.error); gid2 = c.id;
  assert.equal((await s1.req("POST", `/api/study/groups/${c.id}/enable`, { mode: "group" })).status, 409);
  assert.equal((await out.req("GET", "/api/study/groups/" + c.id)).status, 403, "private");
  assert.ok(!(await out.req("GET", "/api/study/groups")).groups.some((x) => x.id === c.id));
  assert.equal((await T.req("PATCH", "/api/study/groups/" + cid, { teachers: [T.id, kid.id] })).status, 400, "a minor is never a teacher");
  assert.equal((await T.req("PATCH", "/api/study/groups/" + cid, { teachers: [T.id, out.id] })).status, 400, "teachers are members");
  assert.equal((await s1.req("PATCH", "/api/study/groups/" + cid, { subject: "x" })).status, 403);
  const u = await T.req("PATCH", "/api/study/groups/" + cid, { teachers: [T.id, s2.id], subject: "جزء عمّ وتبارك" }); assert.equal(u.status, 200, u.error);
  assert.equal(u.group.teachers.length, 2); assert.equal(u.group.subject, "جزء عمّ وتبارك");
  await T.req("PATCH", "/api/study/groups/" + cid, { teachers: [T.id] });
});

let sA, sB;
test("sessions: manual add / conflict / edit / cancel; start opens a members-only unlisted room; join present then late; end marks absent", async () => {
  assert.equal((await s1.req("POST", `/api/study/groups/${cid}/sessions`, { title: "جلسة", startsAt: at(10) })).status, 403);
  const a = await T.req("POST", `/api/study/groups/${cid}/sessions`, { title: "مراجعة سورة النبأ", startsAt: at(10), durationMin: 45, agenda: "تسميع ثم شرح" }); assert.equal(a.status, 200, a.error); sA = a.session;
  assert.equal((await T.req("POST", `/api/study/groups/${cid}/sessions`, { title: "مكررة", startsAt: sA.startsAt })).status, 409);
  assert.equal((await T.req("POST", `/api/study/groups/${cid}/sessions`, { title: "ماضية", startsAt: at(-120) })).status, 400);
  const tmp = (await T.req("POST", `/api/study/groups/${cid}/sessions`, { title: "مؤقتة", startsAt: at(300) })).session;
  assert.equal((await T.req("PATCH", "/api/study/sessions/" + tmp.id, { title: "مؤقتة معدلة", durationMin: 30 })).session.durationMin, 30);
  assert.equal((await T.req("DELETE", "/api/study/sessions/" + tmp.id)).ok, true);
  assert.equal((await db().get("SELECT status FROM study_sessions WHERE id=$1", [tmp.id])).status, "cancelled");
  // start
  assert.equal((await s1.req("POST", `/api/study/sessions/${sA.id}/start`)).status, 403);
  assert.equal((await s1.req("POST", `/api/study/sessions/${sA.id}/join`)).status, 400, "not started yet");
  const st = await T.req("POST", `/api/study/sessions/${sA.id}/start`); assert.equal(st.status, 200, st.error);
  assert.equal(st.session.status, "live"); assert.ok(st.session.roomId);
  assert.ok(!(await out.req("GET", "/api/rooms")).rooms.some((r) => r.id === st.session.roomId), "not listed publicly");
  assert.equal((await out.req("POST", `/api/rooms/${st.session.roomId}/join`)).status, 403, "outsiders cannot enter the room");
  assert.equal((await out.req("GET", `/api/rooms/${st.session.roomId}`)).status, 403);
  assert.equal((await s1.req("POST", `/api/rooms/${st.session.roomId}/join`)).status, 200, "members can");
  assert.equal((await out.req("POST", `/api/study/sessions/${sA.id}/join`)).status, 403);
  const live = await db().all("SELECT user_id FROM notifications WHERE kind='study_session_live' AND ref=$1", [sA.id]);
  assert.deepEqual(live.map((r) => r.user_id).sort(), [s1.id, s2.id, kid.id].sort(), "every member but the teacher");
  const j = await s1.req("POST", `/api/study/sessions/${sA.id}/join`); assert.equal(j.attendance, "present"); assert.equal(j.roomId, st.session.roomId);
  offset = 25 * 60e3; // 25 minutes later (start was in 10) → late
  assert.equal((await s2.req("POST", `/api/study/sessions/${sA.id}/join`)).attendance, "late");
  assert.equal((await s1.req("POST", `/api/study/sessions/${sA.id}/join`)).attendance, "present", "joining again keeps present");
  const en = await T.req("POST", `/api/study/sessions/${sA.id}/end`); assert.equal(en.session.status, "ended");
  assert.equal((await db().get("SELECT status FROM rooms WHERE id=$1", [st.session.roomId])).status, "ended", "room closed with the session");
  const rows = Object.fromEntries((await db().all("SELECT user_id, status, minutes FROM study_attendance WHERE session_id=$1", [sA.id])).map((r) => [r.user_id, r]));
  assert.equal(rows[kid.id].status, "absent"); assert.equal(rows[T.id].status, "present"); assert.ok(Number(rows[s1.id].minutes) >= 24 && Number(rows[s1.id].minutes) <= 45, String(rows[s1.id].minutes));
  // second session held in person (no room): the teacher marks attendance
  sB = (await T.req("POST", `/api/study/groups/${cid}/sessions`, { title: "جلسة حضورية في المسجد", startsAt: at(20) })).session;
  const b = await T.req("POST", `/api/study/sessions/${sB.id}/start`, { room: false }); assert.equal(b.session.roomId, null);
  assert.equal((await T.req("PUT", `/api/study/sessions/${sB.id}/attendance/${s1.id}`, { status: "present" })).status, 200);
  assert.equal((await T.req("PUT", `/api/study/sessions/${sB.id}/attendance/${kid.id}`, { status: "excused" })).status, 200);
  assert.equal((await T.req("PUT", `/api/study/sessions/${sB.id}/attendance/${s2.id}`, { status: "sleeping" })).status, 400);
  assert.equal((await T.req("PUT", `/api/study/sessions/${sB.id}/attendance/${out.id}`, { status: "present" })).status, 404);
  assert.equal((await s1.req("PUT", `/api/study/sessions/${sB.id}/attendance/${s2.id}`, { status: "present" })).status, 403);
  await T.req("POST", `/api/study/sessions/${sB.id}/end`);
  offset = 0;
});

test("attendance views, rates, streaks (excused keeps it), CSV", async () => {
  const tv = await T.req("GET", `/api/study/sessions/${sA.id}/attendance`); assert.equal(tv.members.length, 4); assert.deepEqual(tv.counts, { present: 2, late: 1, excused: 0, absent: 1 });
  const sv = await s1.req("GET", `/api/study/sessions/${sA.id}/attendance`); assert.equal(sv.members, undefined, "students see only their own"); assert.equal(sv.mine.status, "present");
  assert.equal((await out.req("GET", `/api/study/sessions/${sA.id}/attendance`)).status, 403);
  const g = await T.req("GET", `/api/study/groups/${cid}/attendance`); const by = Object.fromEntries(g.members.map((m) => [m.handle, m]));
  assert.equal(by.st_s1.streak, 2); assert.equal(by.st_s1.rate, 100);
  assert.equal(by.st_s2.attended, 1); assert.equal(by.st_s2.streak, 0, "late then absent → broken"); assert.equal(by.st_s2.rate, 50);
  assert.equal(by.st_kid.streak, 0); assert.equal(by.st_kid.rate, 0, "excused does not count against the rate");
  assert.equal((await s1.req("GET", `/api/study/groups/${cid}/attendance`)).status, 403);
  const me = await s1.req("GET", "/api/study/groups/" + cid); assert.equal(me.me.stats.streak, 2); assert.equal(me.me.stats.longestStreak, 2);
  const r = await fetch(H.base + `/api/study/groups/${cid}/attendance.csv`, { headers: { Cookie: T.cookie, "X-Requested-With": "mujtama" } });
  assert.equal(r.status, 200); const t = (await r.text()).replace(/^\ufeff/, ""); assert.ok(t.startsWith("name,handle,sessions")); assert.match(t, /@st_s1/);
});

test("notes and links: members add (https only), teachers pin, authors edit / delete, outsiders locked out", async () => {
  const n = await s1.req("POST", `/api/study/groups/${cid}/notes`, { title: "ملخص سورة النبأ", body: "أهم الوقفات…", sessionId: sA.id }); assert.equal(n.status, 200, n.error);
  assert.equal((await s1.req("POST", `/api/study/groups/${cid}/notes`, { kind: "link", title: "تلاوة", url: "http://x.org" })).status, 400);
  assert.equal((await s1.req("POST", `/api/study/groups/${cid}/notes`, { kind: "link", title: "تلاوة" })).status, 400);
  const l = await T.req("POST", `/api/study/groups/${cid}/notes`, { kind: "link", title: "مصحف التجويد", url: "https://quran.example.org/naba" }); assert.equal(l.status, 200);
  assert.equal((await out.req("POST", `/api/study/groups/${cid}/notes`, { title: "دخيل" })).status, 403);
  assert.equal((await out.req("GET", `/api/study/groups/${cid}/notes`)).status, 403);
  assert.equal((await s1.req("POST", `/api/study/notes/${l.note.id}/pin`)).status, 403);
  assert.equal((await T.req("POST", `/api/study/notes/${l.note.id}/pin`)).pinned, true);
  const list = await s2.req("GET", `/api/study/groups/${cid}/notes`); assert.equal(list.notes[0].id, l.note.id, "pinned first"); assert.equal(list.notes.length, 2);
  assert.equal((await s2.req("GET", `/api/study/groups/${cid}/notes?session=${sA.id}`)).notes.length, 1);
  assert.equal((await s2.req("PATCH", `/api/study/notes/${n.note.id}`, { title: "تخريب" })).status, 403);
  assert.equal((await s1.req("PATCH", `/api/study/notes/${n.note.id}`, { title: "ملخص سورة النبأ (محدّث)" })).ok, true);
  assert.equal((await T.req("DELETE", `/api/study/notes/${n.note.id}`)).ok, true, "teachers can remove any note");
});

test("goals: group goals by teachers, personal goals by anyone, progress and completion", async () => {
  assert.equal((await s1.req("POST", `/api/study/groups/${cid}/goals`, { title: "هدف المجموعة", target: 5, personal: false })).status, 403);
  const g = await T.req("POST", `/api/study/groups/${cid}/goals`, { title: "إتمام جزء عمّ", unit: "سورة", target: 37, personal: false }); assert.equal(g.status, 200, g.error);
  const p = await s1.req("POST", `/api/study/groups/${cid}/goals`, { title: "حفظ ٣ سور هذا الأسبوع", unit: "سورة", target: 3 }); assert.equal(p.goal.personal, true);
  assert.equal((await s1.req("POST", `/api/study/groups/${cid}/goals`, { title: "صفر", target: 0 })).status, 400);
  assert.equal((await s2.req("POST", `/api/study/goals/${p.goal.id}/progress`, { add: 1 })).status, 403, "someone else's personal goal");
  assert.equal((await s1.req("POST", `/api/study/goals/${g.goal.id}/progress`, { add: 1 })).status, 403, "group goal: teachers");
  assert.equal((await s1.req("POST", `/api/study/goals/${p.goal.id}/progress`, { add: 2 })).goal.percent, 67);
  const done = await s1.req("POST", `/api/study/goals/${p.goal.id}/progress`, { add: 1 }); assert.equal(done.goal.done, true); assert.ok(done.goal.doneAt);
  assert.equal((await T.req("POST", `/api/study/goals/${g.goal.id}/progress`, { set: 12 })).goal.progress, 12);
  const v = await s2.req("GET", `/api/study/groups/${cid}/goals`); assert.equal(v.group.length, 1); assert.equal(v.mine.length, 0, "personal goals are private");
  assert.equal((await s1.req("DELETE", `/api/study/goals/${p.goal.id}`)).ok, true);
});

test("halaqa progress: teachers log, ranges validated, coverage, students see only their own, notification, roster", async () => {
  assert.equal((await s1.req("POST", `/api/study/groups/${cid}/progress`, { studentId: s2.id, kind: "recitation", surah: 78 })).status, 403);
  assert.equal((await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: s1.id, kind: "memorisation", surah: 115 })).status, 400);
  assert.equal((await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: s1.id, kind: "memorisation", surah: 114, fromAyah: 1, toAyah: 7 })).status, 400, "An-Nas has 6 ayahs");
  assert.equal((await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: out.id, kind: "memorisation", surah: 114 })).status, 400, "not a member");
  const e1 = await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: s1.id, kind: "memorisation", surah: 114, grade: "excellent", note: "إتقان", sessionId: sA.id }); assert.equal(e1.status, 200, e1.error);
  assert.equal(e1.entry.surahName, "الناس"); assert.equal(e1.entry.ayahs, 6); assert.equal(e1.entry.gradeLabel, "ممتاز");
  await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: s1.id, kind: "memorisation", surah: 78, fromAyah: 1, toAyah: 20, grade: "good" });
  await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: s1.id, kind: "memorisation", surah: 78, fromAyah: 15, toAyah: 30, grade: "very_good" });
  await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: s1.id, kind: "memorisation", surah: 1, grade: "needs_work" });
  await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: s1.id, kind: "review", surah: 112, grade: "excellent" });
  await T.req("POST", `/api/study/groups/${cid}/progress`, { studentId: kid.id, kind: "recitation", surah: 113, grade: "good", note: "ملاحظة خاصة بالطالب" });
  const p = await s1.req("GET", `/api/study/groups/${cid}/progress`); assert.equal(p.status, 200, p.error);
  assert.equal(p.memorised.ayahs, 6 + 30, "overlaps counted once; «needs work» not counted as memorised"); assert.equal(p.memorised.completeSurahs, 1);
  assert.equal(p.memorised.percent, Math.round((36 / 6236) * 1000) / 10); assert.equal(p.total, 6236); assert.equal(p.entries.length, 5); assert.equal(p.recitationDays, 1); assert.equal(p.canLog, false);
  const peek = await s1.req("GET", `/api/study/groups/${cid}/progress?student=${kid.id}`); assert.equal(peek.student.id, s1.id, "a student cannot read another student's record");
  assert.ok(!JSON.stringify(peek).includes("ملاحظة خاصة بالطالب"));
  const tk = await T.req("GET", `/api/study/groups/${cid}/progress?student=${kid.id}`); assert.equal(tk.student.id, kid.id); assert.equal(tk.entries[0].note, "ملاحظة خاصة بالطالب");
  assert.equal((await out.req("GET", `/api/study/groups/${cid}/progress`)).status, 403);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='study_progress' AND ref=$2", [s1.id, cid]));
  const ro = await T.req("GET", `/api/study/groups/${cid}/students`); const r1 = ro.students.find((x) => x.id === s1.id); assert.equal(r1.memorisedAyahs, 36); assert.ok(!ro.students.some((x) => x.id === T.id), "teachers are not on the roster");
  assert.equal((await s1.req("GET", `/api/study/groups/${cid}/students`)).status, 403);
  assert.equal((await s1.req("DELETE", `/api/study/progress/${e1.entry.id}`)).status, 403);
  assert.equal((await T.req("DELETE", `/api/study/progress/${e1.entry.id}`)).ok, true);
  assert.equal((await s1.req("GET", `/api/study/groups/${gid2}/progress`)).status, 403, "group mode has no memorisation log");
  const sg = await s1.req("POST", `/api/study/groups/${gid2}/progress`, { studentId: s1.id, kind: "recitation", surah: 1 }); assert.equal(sg.status, 403);
});

test("reminders: one per member and session inside the window, idempotent, re-armed when the session moves; stale live sessions end", async () => {
  const s = (await T.req("POST", `/api/study/groups/${cid}/sessions`, { title: "جلسة التذكير", startsAt: at(30) })).session;
  const r1 = await S().tick(); assert.ok(r1.reminded >= 4, JSON.stringify(r1));
  assert.deepEqual((await db().all("SELECT user_id FROM notifications WHERE kind='study_session_soon' AND ref=$1", [s.id])).map((r) => r.user_id).sort(), [T.id, s1.id, s2.id, kid.id].sort());
  assert.equal((await S().tick()).reminded, 0, "idempotent");
  await T.req("PATCH", "/api/study/sessions/" + s.id, { startsAt: at(40) });
  assert.ok((await S().tick()).reminded >= 4, "moved → reminded again");
  // a session left live far past its end is closed by the job
  const old = (await T.req("POST", `/api/study/groups/${cid}/sessions`, { title: "منسية", startsAt: at(15), durationMin: 15 })).session;
  await T.req("POST", `/api/study/sessions/${old.id}/start`, { room: false });
  offset = 4 * 3600e3; assert.ok((await S().tick()).ended >= 1); offset = 0;
  assert.equal((await db().get("SELECT status FROM study_sessions WHERE id=$1", [old.id])).status, "ended");
});

test("pure helpers: time zones, weekly occurrences, streaks, recitation day streak", () => {
  assert.equal(new Date(ST.zonedToUtc(2026, 10, 18, 19, 30, "Asia/Riyadh")).toISOString(), "2026-10-18T16:30:00.000Z");
  assert.equal(new Date(ST.zonedToUtc(2026, 7, 1, 10, 0, "Europe/London")).toISOString(), "2026-07-01T09:00:00.000Z", "summer time");
  assert.equal(new Date(ST.zonedToUtc(2026, 12, 1, 10, 0, "Europe/London")).toISOString(), "2026-12-01T10:00:00.000Z", "winter time");
  const from = Date.parse("2026-10-17T00:00:00Z"), occ = ST.occurrences({ days: [5], time: "05:00", tz: "Asia/Riyadh" }, from, 14);
  assert.deepEqual(occ.map((t) => new Date(t).toISOString()), ["2026-10-23T02:00:00.000Z", "2026-10-30T02:00:00.000Z"]);
  assert.deepEqual(ST.occurrences(null, from), []);
  assert.deepEqual(ST.streaks(["present", "excused", "late", "absent", "present", "present", "present"]), { current: 2, longest: 3 });
  assert.deepEqual(ST.streaks([]), { current: 0, longest: 0 });
  const nowMs = Date.parse("2026-10-17T12:00:00Z");
  assert.equal(ST.dayStreak(["2026-10-17T08:00:00Z", "2026-10-16T08:00:00Z", "2026-10-15T08:00:00Z", "2026-10-13T08:00:00Z"], "Asia/Riyadh", nowMs), 3);
  assert.equal(ST.dayStreak(["2026-10-16T08:00:00Z"], "Asia/Riyadh", nowMs), 1, "yesterday keeps today's streak alive");
  assert.equal(ST.dayStreak(["2026-10-14T08:00:00Z"], "Asia/Riyadh", nowMs), 0);
  const Q = require("../lib/quran-meta"); assert.equal(Q.TOTAL, 6236); assert.equal(Q.SURAHS.length, 114); assert.throws(() => Q.range(2, 0, 3)); assert.deepEqual(Q.range(114), { surah: 114, from: 1, to: 6, count: 6 });
});

test("v2.29 assignments: teacher creates (members notified), students submit (https links only), review / return, roster of missing; outsiders locked out", async () => {
  for (const u of [s1, s2]) if (!(await db().get("SELECT 1 x FROM memberships WHERE community=$1 AND user_id=$2", [cid, u.id]))) await u.req("POST", `/api/communities/${cid}/join`, { acceptRules: true });
  assert.equal((await s1.req("POST", `/api/study/groups/${cid}/assignments`, { title: "واجب الطالب" })).status, 403, "students cannot create assignments");
  const a = await T.req("POST", `/api/study/groups/${cid}/assignments`, { title: "مراجعة سورة النبأ", body: "سمّع الآيات ١–١٦ واكتب ما صعب عليك", dueAt: new Date(Date.now() + offset + 2 * 864e5).toISOString(), points: 20 });
  assert.equal(a.status, 200, a.error); const aid = a.assignment.id; assert.equal(a.assignment.points, 20); assert.equal(a.assignment.overdue, false);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='study_assignment' AND ref=$2", [s1.id, aid]), "members hear about new homework");
  assert.equal((await out.req("GET", "/api/study/assignments/" + aid)).status, 403);
  assert.equal((await s1.req("POST", `/api/study/assignments/${aid}/submit`, {})).status, 400, "empty submission refused");
  assert.equal((await s1.req("POST", `/api/study/assignments/${aid}/submit`, { url: "http://x.y" })).status, 400, "https only");
  let r = await s1.req("POST", `/api/study/assignments/${aid}/submit`, { body: "سمّعت الآيات وأخطأت في الآية ١٤", url: "https://example.com/audio" });
  assert.equal(r.status, 200, r.error); assert.equal(r.mine.status, "submitted"); assert.equal(r.roster, null, "students never see the roster");
  let t = await T.req("GET", "/api/study/assignments/" + aid); assert.equal(t.canReview, true);
  assert.deepEqual(t.roster.submissions.map((x) => x.userId), [s1.id]); assert.ok(t.roster.missing.some((m) => m.id === s2.id)); assert.ok(!t.roster.missing.some((m) => m.id === T.id), "teachers are not students");
  const list = await T.req("GET", `/api/study/groups/${cid}/assignments`); assert.equal(list.assignments[0].toReview, 1); assert.equal(list.canCreate, true);
  t = await T.req("POST", `/api/study/assignments/${aid}/review/${s1.id}`, { grade: 99, feedback: "أحسنت، انتبه للمدود" }); assert.equal(t.roster.submissions[0].grade, 20, "grade capped at the points");
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='study_feedback'", [s1.id]));
  assert.equal((await s1.req("POST", `/api/study/assignments/${aid}/submit`, { body: "تعديل" })).status, 400, "a reviewed answer is locked until returned");
  await T.req("POST", `/api/study/assignments/${aid}/review/${s1.id}`, { action: "return", feedback: "أعد التسميع للآية ١٤" });
  r = await s1.req("POST", `/api/study/assignments/${aid}/submit`, { body: "أعدت التسميع" }); assert.equal(r.mine.status, "submitted");
  const s1list = await s1.req("GET", `/api/study/groups/${cid}/assignments`); assert.equal(s1list.assignments[0].mine.status, "submitted"); assert.ok(!("toReview" in s1list.assignments[0]));
  assert.equal((await T.req("POST", `/api/study/assignments/${aid}/toggle`)).status, 200); assert.equal((await s2.req("POST", `/api/study/assignments/${aid}/submit`, { body: "متأخر" })).status, 400, "closed");
  await T.req("POST", `/api/study/assignments/${aid}/toggle`);
});

test("v2.29 teacher dashboard (managers only: attendance, streaks, overdue, at-risk first) and completion hook for certificates (criteria, override, revoke, bus event)", async () => {
  assert.equal((await s1.req("GET", `/api/study/groups/${cid}/dashboard`)).status, 403);
  const d = await T.req("GET", `/api/study/groups/${cid}/dashboard`); assert.equal(d.status, 200, d.error);
  assert.ok(d.students.length >= 2 && d.students.every((x) => x.id !== T.id), "teachers excluded");
  assert.ok(["students", "avgAttendance", "atRisk", "toReview", "assignments", "completed"].every((k) => k in d.summary), JSON.stringify(d.summary));
  assert.equal(d.summary.toReview, 1); assert.ok(Array.isArray(d.perSession)); assert.deepEqual(d.criteria, { minAttendance: 75, minAssignments: 70 });
  const risky = d.students.findIndex((x) => x.risk.length), safe = d.students.findIndex((x) => !x.risk.length); if (risky >= 0 && safe >= 0) assert.ok(risky < safe, "at-risk students listed first");
  const mine = await s1.req("GET", `/api/study/groups/${cid}/completion`); assert.equal(mine.status, 200, mine.error); assert.equal(mine.completed, false); assert.equal(mine.assignmentsTotal, 1); assert.equal(mine.assignmentsDone, 1);
  assert.equal((await s1.req("POST", `/api/study/groups/${cid}/completions/${s1.id}`, {})).status, 403, "students cannot certify themselves");
  const seen = []; H.app.ctx.bus.on("STUDY_COMPLETED", (e) => seen.push(e));
  let c = await T.req("POST", `/api/study/groups/${cid}/completions/${s2.id}`, {});
  if (c.status === 400) { assert.equal(c.code, "not_eligible"); c = await T.req("POST", `/api/study/groups/${cid}/completions/${s2.id}`, { override: true, note: "أتم الحلقة بتقدير" }); }
  assert.equal(c.status, 200, c.error); assert.equal(c.completed, true);
  assert.deepEqual(seen.map((e) => e.user), [s2.id], "phase 73 can subscribe to completions");
  const row = await db().get("SELECT criteria FROM study_completions WHERE community_id=$1 AND user_id=$2", [cid, s2.id]); assert.ok(JSON.parse(row.criteria).minAttendance === 75);
  assert.equal((await T.req("GET", `/api/study/groups/${cid}/dashboard`)).summary.completed, 1);
  assert.equal((await T.req("PATCH", `/api/study/groups/${cid}`, { completionAttendance: 50 })).status, 200);
  assert.equal((await s2.req("GET", `/api/study/groups/${cid}/completion`)).criteria.minAttendance, 50);
  c = await T.req("POST", `/api/study/groups/${cid}/completions/${s2.id}`, { revoke: true }); assert.equal(c.completed, false);
  for (const t of ["study_submissions", "study_completions", "study_assignments"]) { const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [s1.id]); }
});
