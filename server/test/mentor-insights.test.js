/* مسار الإرشاد M3-6 — GET /api/mentor/insights: the signed-in mentor's own aggregates only.
 * Auth (guest 401, non-mentor 403), exact numbers on seeded data (sessions per month over 6 months, average rating + count,
 * median response time, no-show rate, repeat-mentee rate), another mentor's rows never counted, no learner identities. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, m1, m2, l1, l2, l3, plain;
const NOW = Date.parse("2027-03-15T09:00:00.000Z");
const db = () => H.app.ctx.db;
const ago = (days) => new Date(NOW - days * 864e5).toISOString();
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
let n = 0;
const sess = async (mentor, learner, status, startsAt, rating = null) => {
  const id = "mis_" + (++n);
  await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,'programming','',$4,60,$5,0,0,'none',0,$6,$6)", [id, mentor, learner, startsAt, status, ago(200)]);
  if (rating !== null) await db().run("INSERT INTO mentor_feedback(session_id,by_user,about_user,rating,comment,created_at) VALUES($1,$2,$3,$4,'',$5)", [id, learner, mentor, rating, startsAt]);
  return id;
};
const reqRow = (mentor, learner, status, createdAt, minutes) => db().run("INSERT INTO mentor_requests(id,learner_id,mentor_id,topic,goal,status,created_at,decided_at) VALUES($1,$2,$3,'programming','هدف',$4,$5,$6)",
  ["mir_" + (++n), learner, mentor, status, createdAt, minutes === null ? null : new Date(Date.parse(createdAt) + minutes * 60e3).toISOString()]);

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  m1 = await mk("mis_m1"); m2 = await mk("mis_m2"); l1 = await mk("mis_l1"); l2 = await mk("mis_l2"); l3 = await mk("mis_l3"); plain = await mk("mis_plain");
  for (const m of [m1, m2]) { const r = await m.req("PUT", "/api/mentor/me", { headline: "مرشد " + m.id.slice(-4), topics: ["programming"] }); assert.equal(r.status, 200, r.error); }
  // m1: completed in 2027-03 (×2: l1, l2), 2027-02 (l1), 2026-12 (l3); one completed 8 months ago (outside window); no_show ×1 in window; cancelled ignored
  await sess(m1.id, l1.id, "completed", "2027-03-02T10:00:00.000Z", 5);
  await sess(m1.id, l2.id, "completed", "2027-03-10T10:00:00.000Z", 4);
  await sess(m1.id, l1.id, "completed", "2027-02-11T10:00:00.000Z", 3);
  await sess(m1.id, l3.id, "completed", "2026-12-05T10:00:00.000Z");
  await sess(m1.id, l3.id, "completed", "2026-07-05T10:00:00.000Z", 5);   // outside the 6-month window, still counts all-time
  await sess(m1.id, l2.id, "no_show", "2027-01-20T10:00:00.000Z");
  await sess(m1.id, l2.id, "cancelled", "2027-01-21T10:00:00.000Z");
  // m1 requests: response minutes 10, 30, 60 (accepted/declined) → median 30; open/withdrawn/closed ignored
  await reqRow(m1.id, l1.id, "accepted", ago(20), 10);
  await reqRow(m1.id, l2.id, "declined", ago(15), 30);
  await reqRow(m1.id, l3.id, "accepted", ago(10), 60);
  await reqRow(m1.id, l3.id, "open", ago(1), null);
  await reqRow(m1.id, l2.id, "closed", ago(3), 5000);
  // m2 (another mentor): lots of data that must never leak into m1's numbers
  for (let i = 0; i < 4; i++) await sess(m2.id, l1.id, "completed", "2027-03-0" + (i + 3) + "T10:00:00.000Z", 1);
  await sess(m2.id, l2.id, "no_show", "2027-03-08T10:00:00.000Z");
  await reqRow(m2.id, l1.id, "accepted", ago(5), 1);
  // m1 as a LEARNER of m2, rated by m2 (mentor → learner feedback has no rating; a stray row about m1 must not count)
  const sid = await sess(m2.id, m1.id, "completed", "2027-03-12T10:00:00.000Z");
  await db().run("INSERT INTO mentor_feedback(session_id,by_user,about_user,rating,comment,created_at) VALUES($1,$2,$3,1,'x',$4)", [sid, m2.id, m1.id, ago(1)]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("auth: guest 401, member without a mentor profile 403", async () => {
  assert.equal((await new H.Client().req("GET", "/api/mentor/insights")).status, 401);
  const r = await plain.req("GET", "/api/mentor/insights"); assert.equal(r.status, 403); assert.equal(r.code, "not_mentor");
});

test("numbers on seeded data are exact (mentor 1)", async () => {
  const r = await m1.req("GET", "/api/mentor/insights"); assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.sessionsByMonth, [
    { month: "2026-10", count: 0 }, { month: "2026-11", count: 0 }, { month: "2026-12", count: 1 },
    { month: "2027-01", count: 0 }, { month: "2027-02", count: 1 }, { month: "2027-03", count: 2 }]);
  assert.equal(r.sessionsTotal, 4);
  assert.deepEqual(r.rating, { avg: 4.3, count: 4 });            // 5,4,3,5 (all time) — m2's rating of m1-as-learner excluded
  assert.deepEqual(r.responseMinutes, { median: 30, count: 3 });
  assert.deepEqual(r.noShow, { rate: 20, count: 1, of: 5 });     // 4 completed + 1 no-show in window
  assert.deepEqual(r.repeat, { rate: 66.7, count: 2, of: 3 });    // l1 (2), l3 (2) repeat; l2 once
  assert.equal(r.window.months, 6);
});

test("another mentor's data is never returned; no learner identities in the payload", async () => {
  const a = await m1.req("GET", "/api/mentor/insights"), b = await m2.req("GET", "/api/mentor/insights");
  assert.equal(b.status, 200, b.error);
  assert.equal(b.sessionsTotal, 5); assert.deepEqual(b.rating, { avg: 1, count: 4 });
  assert.deepEqual(b.responseMinutes, { median: 1, count: 1 }); assert.deepEqual(b.noShow, { rate: 16.7, count: 1, of: 6 }); assert.deepEqual(b.repeat, { rate: 50, count: 1, of: 2 });
  for (const x of [a, b]) for (const u of [l1, l2, l3, m1, m2]) assert.ok(!JSON.stringify(x).includes(u.id), "no user ids");
  assert.ok(!JSON.stringify(a).includes("mis_l"), "no handles");
});

test("a new mentor with nothing yet: zero bars and null rates (empty state)", async () => {
  const c = await mk("mis_new"); assert.equal((await c.req("PUT", "/api/mentor/me", { headline: "مرشد جديد", topics: ["career"] })).status, 200);
  const r = await c.req("GET", "/api/mentor/insights"); assert.equal(r.status, 200, r.error);
  assert.equal(r.sessionsTotal, 0); assert.ok(r.sessionsByMonth.every((x) => x.count === 0));
  assert.deepEqual([r.rating.avg, r.responseMinutes.median, r.noShow.rate, r.repeat.rate], [null, null, null, null]);
});
