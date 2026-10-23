/* M3-5/F6 «مطوّر الملخص الأسبوعي» — weekly mentoring summary to guardians of minor mentees (mentor tick + notify-lib).
 *  content (counts + goal titles, never notes/feedback), opt-out from the family link (default on), idempotent per guardian
 *  per ISO week, nobody else gets it (mentor, adult learner, stranger, guardian of an adult), i18n templates en/fr/ur. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { boot } = require("./helpers");
const N = require("../lib/notify-lib");

let H; const NOW = Date.UTC(2027, 0, 3, 6); // Sunday → ISO week 2026-W53
let mentor, learner, kid, parent, stranger, adultParent;
const db = () => H.app.ctx.db, M = () => H.app.ctx.services.mentors;
const MON18 = new Date(Date.UTC(2027, 0, 4, 15)).toISOString(), MON19 = new Date(Date.UTC(2027, 0, 11, 15)).toISOString(); // Mondays 18:00 Riyadh
const SECRET = "ملاحظة-سرية-لا-تظهر";
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const minors = new Set(); let realIs, realIds;
const weekly = (uid) => db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='mentor_weekly' ORDER BY created_at", [uid]);

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  mentor = await mk("mw_mentor", "سارة"); learner = await mk("mw_learner", "فهد"); kid = await mk("mw_kid", "ريم");
  parent = await mk("mw_parent"); stranger = await mk("mw_x"); adultParent = await mk("mw_ap");
  const ms = H.app.ctx.services.minors; realIs = ms.isMinorUser; realIds = ms.minorIds;
  ms.isMinorUser = async (uid) => minors.has(uid) || (await realIs(uid));
  if (realIds) ms.minorIds = async (ids) => { const out = new Set(await realIds(ids)); for (const i of ids || []) if (minors.has(i)) out.add(i); return out; };
  minors.add(kid.id);
  assert.equal((await kid.req("POST", "/api/age", { birthDate: "2012-05-01" })).status, 200); // a real minor too (minors service checks its own age data)
  const at = new Date(NOW).toISOString();
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,'active',$2,'{}',$4)", ["gl_mw", parent.id, kid.id, at]);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,'active',$2,'{}',$4)", ["gl_mw_adult", adultParent.id, learner.id, at]);
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "مرشدة خبيرة في البرمجة", topics: ["programming"], minutes: 60, tz: "Asia/Riyadh", allowMinors: true })).status, 200);
  assert.equal((await mentor.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "20:00" }] })).status, 200);
  let r = await learner.req("POST", "/api/mentors/mw_mentor/book", { startsAt: MON18 }); assert.equal(r.status, 200, r.error);
  r = await kid.req("POST", "/api/mentors/mw_mentor/book", { startsAt: MON19 }); assert.equal(r.status, 200, r.error); // upcoming
  // a completed session 2 days ago (with private notes/feedback that must never travel) + one 10 days ago (outside the window)
  for (const [sid, ago] of [["ms_mw_done", 2], ["ms_mw_old", 10]]) {
    const st = new Date(NOW - ago * 864e5).toISOString();
    await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,topic,note,starts_at,minutes,status,minor,created_at,updated_at,completed_at) VALUES($1,$2,$3,'programming',$4,$5,60,'completed',1,$5,$5,$5)", [sid, mentor.id, kid.id, SECRET, st]);
  }
  for (const [title, status] of [["أبني أول موقع", "done"], ["أتعلّم Git", "doing"], ["أقرأ كتاباً", "todo"]])
    assert.equal((await kid.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: kid.id, title, status })).status, 200);
  assert.equal((await learner.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: learner.id, title: "هدف البالغ" })).status, 200);
});
test.after(() => { const ms = H.app.ctx.services.minors; ms.isMinorUser = realIs; if (realIds) ms.minorIds = realIds; return H.app.close(); });
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("notify-lib: ref round-trip, caps, Arabic text, href", () => {
  const ref = N.weeklyRef("2027-W01", "u_k", { done: 2, upcoming: 1, goalsDone: 1, goalsTotal: 5, titles: ["أ|ب", " ج ", "د", "هـ"] });
  const d = N.parseWeeklyRef(ref);
  assert.deepEqual(d, { week: "2027-W01", minor: "u_k", done: 2, upcoming: 1, goalsDone: 1, goalsTotal: 5, titles: ["أ|ب", "ج", "د"] });
  assert.equal(N.parseWeeklyRef("guard|x"), null);
  assert.equal(N.parseWeeklyRef(N.weeklyRef("w", "u", { titles: ["ا".repeat(90)] })).titles[0].length, 40);
  assert.equal(N.sentence("mentor_weekly", ["ريم"], 1, ref), "ملخص الإرشاد الأسبوعي لـريم: جلسات مكتملة 2 · قادمة 1 · الأهداف المنجزة 1 من 5 — أ|ب، ج، د");
  assert.equal(N.sentence("mentor_weekly", [], 1, N.weeklyRef("w", "u", {})), "ملخص الإرشاد الأسبوعي: جلسات مكتملة 0 · قادمة 0 · الأهداف المنجزة 0 من 0");
  assert.equal(N.hrefFor({ kind: "mentor_weekly", ref }), "/#/mentors?tab=family");
  assert.ok(N.KINDS.mentor_weekly.label);
  // guard kinds still work through the generalised fmt hook
  assert.match(N.sentence("autoguard_strike", [], 1, N.guardRef("c1", { n: 1, max: 3, hours: 0 })), /تحذير/);
});

test("guardian gets one summary: counts in window, goal titles only, never notes; nobody else gets it", async () => {
  assert.equal(M().isoWeek(NOW), "2026-W53");
  const sent = await M().weeklySummaries(NOW); assert.equal(sent, 1);
  const rows = await weekly(parent.id); assert.equal(rows.length, 1);
  const d = N.parseWeeklyRef(rows[0].ref);
  assert.equal(d.week, "2026-W53"); assert.equal(d.minor, kid.id); assert.equal(rows[0].actor, kid.id);
  assert.equal(d.done, 1); assert.equal(d.upcoming, 1); assert.equal(d.goalsDone, 1); assert.equal(d.goalsTotal, 3);
  assert.deepEqual(d.titles.slice(0, 2).sort(), ["أتعلّم Git", "أقرأ كتاباً"].sort()); assert.equal(d.titles[2], "أبني أول موقع"); // open goals first (same clock → id order)
  assert.ok(!d.titles.includes("هدف البالغ"));
  assert.ok(!rows[0].ref.includes(encodeURIComponent(SECRET)) && !rows[0].ref.includes(SECRET));
  const c = await parent.req("GET", "/api/notifications?view=center&tab=all");
  const txt = JSON.stringify(c); assert.ok(!txt.includes(SECRET)); assert.ok(txt.includes("ملخص الإرشاد الأسبوعي لـريم"), txt.slice(0, 400));
  for (const u of [mentor, learner, kid, stranger, adultParent]) assert.equal((await weekly(u.id)).length, 0, u.id);
});

test("idempotent per ISO week: repeated ticks and a wiped marker do not resend; next week sends again", async () => {
  assert.equal(await M().weeklySummaries(NOW), 0);
  assert.equal(await M().weeklySummaries(NOW + 3600e3), 0);
  await db().run("UPDATE guardian_links SET settings=$1 WHERE id='gl_mw'", [{}]); // marker lost → the notifications row still blocks
  assert.equal(await M().weeklySummaries(NOW + 7200e3), 0);
  assert.equal((await weekly(parent.id)).length, 1);
  await M().tick(); assert.equal((await weekly(parent.id)).length, 1); // the mentor tick runs the same pass: still one
  const next = NOW + 2 * 864e5; assert.equal(M().isoWeek(next), "2027-W01");
  await db().run("UPDATE guardian_links SET settings=$1 WHERE id='gl_mw'", [{}]);
  assert.equal(await M().weeklySummaries(next), 1); assert.equal(await M().weeklySummaries(next), 0);
  assert.equal((await weekly(parent.id)).length, 2);
});

test("opt-out switch on the family link: default on, guardian-only, persisted, survives control changes, stops the summary", async () => {
  let f = await parent.req("GET", "/api/family"); const link = f.links.find((l) => l.id === "gl_mw");
  assert.equal(link.mentorWeekly, true);
  const kf = await kid.req("GET", "/api/family"); assert.equal(kf.links.find((l) => l.id === "gl_mw").mentorWeekly, undefined); // minor never sees the switch
  assert.equal((await kid.req("PUT", "/api/family/links/gl_mw/weekly", { on: false })).status, 404);
  assert.equal((await stranger.req("PUT", "/api/family/links/gl_mw/weekly", { on: false })).status, 404);
  assert.equal((await new H.Client().req("PUT", "/api/family/links/gl_mw/weekly", { on: false })).status, 401);
  assert.equal((await parent.req("PUT", "/api/family/links/gl_mw/weekly", { on: "no" })).status, 400);
  let r = await parent.req("PUT", "/api/family/links/gl_mw/weekly", { on: false }); assert.equal(r.status, 200, r.error); assert.equal(r.link.mentorWeekly, false);
  r = await parent.req("PUT", "/api/family/links/gl_mw/controls", { dm: "nobody" }); assert.equal(r.status, 200, r.error);
  f = await parent.req("GET", "/api/family"); const l2 = f.links.find((l) => l.id === "gl_mw"); assert.equal(l2.mentorWeekly, false); assert.equal(l2.controls.dm, "nobody");
  const later = NOW + 9 * 864e5; assert.equal(await M().weeklySummaries(later), 0);
  assert.equal((await weekly(parent.id)).filter((n) => N.parseWeeklyRef(n.ref).week === M().isoWeek(later)).length, 0);
  r = await parent.req("PUT", "/api/family/links/gl_mw/weekly", { on: true }); assert.equal(r.link.mentorWeekly, true);
  assert.equal(await M().weeklySummaries(later), 1);
});

test("i18n: en carries the notification templates and the switch strings", () => {
  const keys = ["ملخص الإرشاد الأسبوعي لـ{name}: جلسات مكتملة {n} · قادمة {n} · الأهداف المنجزة {n} من {n} — {name}", "ملخص الإرشاد الأسبوعي لـ{name}: جلسات مكتملة {n} · قادمة {n} · الأهداف المنجزة {n} من {n}",
    "ملخص الإرشاد الأسبوعي: جلسات مكتملة {n} · قادمة {n} · الأهداف المنجزة {n} من {n}", "ملخص الإرشاد الأسبوعي (وليّ الأمر)", "ملخص الإرشاد الأسبوعي", "سيصلك ملخص الإرشاد كل أسبوع", "أُوقف ملخص الإرشاد الأسبوعي"];
  for (const L of ["en"]) {
    const src = fs.readFileSync(path.join(__dirname, "../../i18n-" + L + ".js"), "utf8");
    for (const k of keys) assert.ok(src.includes(JSON.stringify(k)), `${L}: ${k}`);
  }
});
