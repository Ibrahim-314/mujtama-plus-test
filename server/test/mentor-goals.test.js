/* M3-2 «مطوّر خادم الأهداف» — shared mentor ↔ mentee goals (068 mentor_goals).
 *  permission matrix: mentor / mentee = CRUD · guardian of a MINOR mentee = read titles+status only · staff = read only ·
 *  stranger = 404 · visitor = 401 · no pair = 404 · guardian of an ADULT = 404. Limits: ≤10 per pair, title ≤120,
 *  status enum, due YYYY-MM-DD (real date) or null; stable error codes. PG + SQLite (same helpers as other mentor tests). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const M068 = require("../migrations/068_mentor_goals");

let H; const NOW = Date.parse("2027-01-03T06:00:00"+".000Z");
let staff, mentor, learner, kid, parent, stranger, loner, sid, kidSid;
const db = () => H.app.ctx.db;
const MON18 = "2027-01-04T15:00:00.000Z", MON19 = "2027-01-11T15:00:00.000Z";
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const minors = new Set();
let realIs, realIds;

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  staff = await mk("mg_staff"); mentor = await mk("mg_mentor", "سارة"); learner = await mk("mg_learner", "فهد");
  kid = await mk("mg_kid", "ريم"); parent = await mk("mg_parent"); stranger = await mk("mg_x"); loner = await mk("mg_loner");
  const ms = H.app.ctx.services.minors; realIs = ms.isMinorUser; realIds = ms.minorIds;
  ms.isMinorUser = async (uid) => minors.has(uid) || (await realIs(uid));
  if (realIds) ms.minorIds = async (ids) => { const out = new Set(await realIds(ids)); for (const i of ids || []) if (minors.has(i)) out.add(i); return out; };
  minors.add(kid.id);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,'active',$2,'{}',$4)", ["gl_mg", parent.id, kid.id, new Date().toISOString()]);
  // the parent is also linked (revoked) to the adult learner: must not open the adult's goals
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "مرشدة خبيرة في البرمجة", topics: ["programming"], minutes: 60, tz: "Asia/Riyadh", allowMinors: true })).status, 200);
  assert.equal((await mentor.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "20:00" }] })).status, 200);
  let r = await learner.req("POST", "/api/mentors/mg_mentor/book", { startsAt: MON18 }); assert.equal(r.status, 200, r.error); sid = r.session.id;
  r = await kid.req("POST", "/api/mentors/mg_mentor/book", { startsAt: MON19 }); assert.equal(r.status, 200, r.error); kidSid = r.session.id;
});
test.after(() => { const ms = H.app.ctx.services.minors; ms.isMinorUser = realIs; if (realIds) ms.minorIds = realIds; return H.app.close(); });
test.beforeEach(() => H.app.ctx.rl.w.clear());

const q = (m, e) => `/api/mentor-goals?mentor=${m}&mentee=${e}`;

test("068 constants drive the API (statuses, title max)", async () => {
  const r = await learner.req("GET", q(mentor.id, learner.id));
  assert.equal(r.status, 200, r.error); assert.deepEqual(r.statuses, [...M068.STATUS]); assert.equal(r.titleMax, M068.TITLE_MAX); assert.equal(r.max, 10);
  assert.equal(r.access, "edit"); assert.deepEqual(r.goals, []); assert.equal(r.total, 0);
});

test("mentor and mentee both create / update / delete; session route mirrors the pair", async () => {
  let r = await learner.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: learner.id, title: "  أبني أول  موقع  ", due: "2027-02-01" });
  assert.equal(r.status, 200, r.error); assert.equal(r.goal.title, "أبني أول موقع"); assert.equal(r.goal.status, "todo"); assert.equal(r.goal.due, "2027-02-01");
  const g1 = r.goal.id;
  r = await mentor.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: learner.id, title: "أتعلّم Git", status: "doing" });
  assert.equal(r.status, 200, r.error); assert.equal(r.goal.due, null); const g2 = r.goal.id;
  r = await mentor.req("PUT", `/api/mentor-goals/${g1}`, { status: "done" }); assert.equal(r.status, 200); assert.equal(r.goal.status, "done"); assert.equal(r.goal.title, "أبني أول موقع");
  r = await learner.req("PUT", `/api/mentor-goals/${g2}`, { title: "أتعلّم Git والفروع", due: null }); assert.equal(r.status, 200); assert.equal(r.goal.title, "أتعلّم Git والفروع");
  const s = await learner.req("GET", `/api/mentor-sessions/${sid}/goals`); assert.equal(s.status, 200); assert.equal(s.total, 2); assert.equal(s.done, 1); assert.equal(s.access, "edit");
  const m = await mentor.req("GET", `/api/mentor-sessions/${sid}/goals`); assert.deepEqual(m.goals.map((g) => g.id).sort(), [g1, g2].sort()); // same clock in tests → order by created_at, id
  const sum = await mentor.req("GET", "/api/mentor-goals/summary"); assert.deepEqual(sum.mentees[learner.id], { done: 1, total: 2 });
  assert.equal((await learner.req("GET", "/api/mentor-goals/summary")).mentees[learner.id], undefined);
  r = await mentor.req("DELETE", `/api/mentor-goals/${g2}`); assert.equal(r.status, 200);
  assert.equal((await learner.req("GET", q(mentor.id, learner.id))).total, 1);
  assert.equal((await learner.req("DELETE", `/api/mentor-goals/${g2}`)).status, 404);
});

test("validation codes: title, status, due", async () => {
  const base = { mentorId: mentor.id, menteeId: learner.id };
  const code = async (b) => { const r = await learner.req("POST", "/api/mentor-goals", { ...base, ...b }); assert.equal(r.status, 400, JSON.stringify(b)); return r.code; };
  assert.equal(await code({ title: "   " }), "goal_title_required");
  assert.equal(await code({}), "goal_title_required");
  assert.equal(await code({ title: "ا".repeat(M068.TITLE_MAX + 1) }), "goal_title_too_long");
  assert.equal(await code({ title: "هدف", status: "finished" }), "goal_status_invalid");
  for (const due of ["2027-02-30", "27-1-1", "2027/02/01", "tomorrow", "2027-13-01"]) assert.equal(await code({ title: "هدف", due }), "goal_due_invalid");
  const ok = await learner.req("POST", "/api/mentor-goals", { ...base, title: "ا".repeat(M068.TITLE_MAX) }); assert.equal(ok.status, 200);
  const r = await learner.req("PUT", `/api/mentor-goals/${ok.goal.id}`, { status: "x" }); assert.equal(r.code, "goal_status_invalid");
  await learner.req("DELETE", `/api/mentor-goals/${ok.goal.id}`);
});

test("≤10 goals per pair (409 goal_limit), other pairs unaffected", async () => {
  const have = (await learner.req("GET", q(mentor.id, learner.id))).total;
  for (let i = have; i < 10; i++) assert.equal((await learner.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: learner.id, title: "هدف " + i })).status, 200);
  const r = await mentor.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: learner.id, title: "الحادي عشر" });
  assert.equal(r.status, 409); assert.equal(r.code, "goal_limit");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mentor_goals WHERE mentor_id=$1 AND mentee_id=$2", [mentor.id, learner.id])).n), 10);
  assert.equal((await kid.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: kid.id, title: "أحفظ جدول الضرب", due: "2027-03-01" })).status, 200);
});

test("guardian of a minor mentee: read-only titles + status; no due/timestamps; writes 403", async () => {
  const r = await parent.req("GET", q(mentor.id, kid.id)); assert.equal(r.status, 200, r.error);
  assert.equal(r.access, "read"); assert.equal(r.goals.length, 1);
  assert.deepEqual(Object.keys(r.goals[0]).sort(), ["id", "status", "title"]);
  const s = await parent.req("GET", `/api/mentor-sessions/${kidSid}/goals`); assert.equal(s.status, 200); assert.equal(s.goals[0].due, undefined);
  const gid = r.goals[0].id;
  let w = await parent.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: kid.id, title: "هدف من وليّ الأمر" }); assert.equal(w.status, 403); assert.equal(w.code, "goal_read_only");
  w = await parent.req("PUT", `/api/mentor-goals/${gid}`, { status: "done" }); assert.equal(w.status, 403);
  w = await parent.req("DELETE", `/api/mentor-goals/${gid}`); assert.equal(w.status, 403);
  // a guardian only sees their minor's pair, never the adult's
  assert.equal((await parent.req("GET", q(mentor.id, learner.id))).status, 404);
  // the minor and the mentor still edit
  assert.equal((await kid.req("PUT", `/api/mentor-goals/${gid}`, { status: "doing" })).status, 200);
});

test("stranger 404 everywhere; visitor 401; no pair 404; staff read-only", async () => {
  const anyGoal = (await learner.req("GET", q(mentor.id, learner.id))).goals[0].id;
  assert.equal((await stranger.req("GET", q(mentor.id, learner.id))).status, 404);
  assert.equal((await stranger.req("GET", `/api/mentor-sessions/${sid}/goals`)).status, 404);
  assert.equal((await stranger.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: learner.id, title: "تسلل" })).status, 404);
  assert.equal((await stranger.req("PUT", `/api/mentor-goals/${anyGoal}`, { status: "done" })).status, 404);
  assert.equal((await stranger.req("DELETE", `/api/mentor-goals/${anyGoal}`)).status, 404);
  // a real pair member cannot reach into another pair by naming it
  assert.equal((await learner.req("GET", q(mentor.id, kid.id))).status, 404);
  assert.equal((await learner.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: kid.id, title: "تسلل" })).status, 404);
  // no relationship = no pair, even for the two users themselves
  assert.equal((await loner.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: loner.id, title: "بلا علاقة" })).status, 404);
  assert.equal((await mentor.req("GET", q(mentor.id, mentor.id))).status, 404);
  const v = new H.Client();
  assert.equal((await v.req("GET", q(mentor.id, learner.id))).status, 401);
  assert.equal((await v.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: learner.id, title: "زائر" })).status, 401);
  assert.equal((await v.req("GET", "/api/mentor-goals/summary")).status, 401);
  const s = await staff.req("GET", q(mentor.id, learner.id)); assert.equal(s.status, 200); assert.equal(s.access, "read"); assert.equal(s.goals.length, 10);
  const w = await staff.req("PUT", `/api/mentor-goals/${anyGoal}`, { status: "done" }); assert.equal(w.status, 403); assert.equal(w.code, "goal_read_only");
  assert.equal((await staff.req("POST", "/api/mentor-goals", { mentorId: mentor.id, menteeId: learner.id, title: "من الإدارة" })).status, 403);
});

test("a block between the pair keeps reads but refuses writes (403 blocked)", async () => {
  const gid = (await learner.req("GET", q(mentor.id, learner.id))).goals[0].id;
  const tips = H.app.ctx.services.tips, real = tips.blockedBetween;
  tips.blockedBetween = async (a, b) => [a, b].includes(mentor.id) && [a, b].includes(learner.id);
  try {
    assert.equal((await learner.req("GET", q(mentor.id, learner.id))).status, 200);
    const r = await mentor.req("PUT", `/api/mentor-goals/${gid}`, { status: "done" }); assert.equal(r.status, 403); assert.equal(r.code, "blocked");
  } finally { tips.blockedBetween = real; }
});
