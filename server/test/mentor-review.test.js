/* مسار الإرشاد M5-2 «مراجَع من الفريق» — POST /api/admin/mentors/:uid/review sets / clears mentor_profiles.reviewed_at (067).
 * Admin only: 401 visitors, 403 members and the mentor themself; 404 unknown mentor; 400 non-boolean. Audited (audit_log).
 * Public payloads (page, directory, /api/mentor/me) expose `reviewed` as a boolean only — never who / when; the staff list
 * carries reviewedAt + needsReview (allowMinors && !reviewed) and totals. Accepting minors is flagged, never blocked. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, mentor, member, staff;
const guest = () => new H.Client();
const db = () => H.app.ctx.db;
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const review = (c, reviewed, uid = mentor.id) => c.req("POST", `/api/admin/mentors/${uid}/review`, { reviewed });
const noLeak = (o) => { const j = JSON.stringify(o); assert.ok(!/reviewed_?at/i.test(j), "reviewedAt must not reach non-staff: " + j.slice(0, 200)); };

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false } });
  staff = await mk("mrv_staff"); mentor = await mk("mrv_mentor"); member = await mk("mrv_member");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]);
  await db().run("UPDATE users SET role='user' WHERE id IN ($1,$2)", [mentor.id, member.id]);
  const r = await mentor.req("PUT", "/api/mentor/me", { headline: "مرشد برمجة منذ سنوات", topics: ["programming"], allowMinors: true, price: 0 }); assert.equal(r.status, 200, r.error);
});
test.after(() => H.app.close());

test("permissions: visitor 401, member 403, mentor self 403, bad body 400, unknown 404", async () => {
  assert.equal((await review(guest(), true)).status, 401);
  assert.equal((await review(member, true)).status, 403);
  assert.equal((await review(mentor, true)).status, 403);
  assert.equal((await review(staff, "yes")).status, 400);
  assert.equal((await review(staff, true, "usr_nope")).status, 404);
  assert.equal((await db().get("SELECT reviewed_at FROM mentor_profiles WHERE user_id=$1", [mentor.id])).reviewed_at, null);
});

test("unreviewed mentor accepting minors: flagged for staff, still listed and bookable (not blocked)", async () => {
  const a = await staff.req("GET", "/api/admin/mentors"); assert.equal(a.status, 200, a.error);
  const row = a.mentors.find((m) => m.user.id === mentor.id);
  assert.equal(row.reviewed, false); assert.equal(row.needsReview, true); assert.equal(row.reviewedAt, null);
  assert.ok(a.totals.needsReview >= 1 && a.totals.unreviewed >= 1);
  const dir = await member.req("GET", "/api/mentors"); assert.equal(dir.status, 200);
  const card = dir.mentors.find((m) => m.user.id === mentor.id); assert.ok(card, "still in directory"); assert.equal(card.reviewed, false); assert.equal(card.allowMinors, true);
  const me = await mentor.req("GET", "/api/mentor/me"); assert.equal(me.profile.reviewed, false); assert.equal(me.profile.allowMinors, true);
});

test("staff sets reviewed → boolean on page / directory / me, no who/when; audited; clear works", async () => {
  const r = await review(staff, true); assert.equal(r.status, 200, r.error); assert.equal(r.reviewed, true); assert.ok(r.reviewedAt);
  const at = (await db().get("SELECT reviewed_at FROM mentor_profiles WHERE user_id=$1", [mentor.id])).reviewed_at; assert.ok(at);
  assert.equal((await review(staff, true)).reviewedAt, r.reviewedAt, "idempotent: keeps first review time");
  for (const c of [guest(), member]) {
    const p = await c.req("GET", "/api/mentors/mrv_mentor"); assert.equal(p.status, 200, p.error); assert.equal(p.mentor.reviewed, true); noLeak(p);
    const d = await c.req("GET", "/api/mentors"); const m = d.mentors.find((x) => x.user.id === mentor.id); assert.equal(m.reviewed, true); noLeak(d);
  }
  const me = await mentor.req("GET", "/api/mentor/me"); assert.equal(me.profile.reviewed, true); noLeak(me);
  const a = await staff.req("GET", "/api/admin/mentors"); const row = a.mentors.find((m) => m.user.id === mentor.id);
  assert.equal(row.reviewed, true); assert.equal(row.needsReview, false); assert.ok(row.reviewedAt);
  await new Promise((res) => setTimeout(res, 60));
  const log = await db().all("SELECT action, target, by_user FROM audit_log WHERE target=$1 ORDER BY id", [mentor.id]);
  assert.ok(log.some((l) => l.action === "mentor_reviewed" && l.by_user === staff.id), "audited");
  const c = await review(staff, false); assert.equal(c.status, 200); assert.equal(c.reviewed, false);
  assert.equal((await member.req("GET", "/api/mentors/mrv_mentor")).mentor.reviewed, false);
  await new Promise((res) => setTimeout(res, 60));
  assert.ok((await db().all("SELECT action FROM audit_log WHERE target=$1", [mentor.id])).some((l) => l.action === "mentor_review_cleared"));
  const st = await db().get("SELECT status, allow_minors, open FROM mentor_profiles WHERE user_id=$1", [mentor.id]);
  assert.equal(st.status, "active"); assert.equal(Number(st.allow_minors), 1); assert.equal(Number(st.open), 1);
});
