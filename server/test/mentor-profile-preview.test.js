/* مسار الإرشاد M2-5 — GET /api/mentor/me/preview?as=visitor|member|mentee|guardian: the mentor's own page exactly as that
 * viewer would receive it (same viewerRel page rule + profileView field filter). Never a field hidden for that viewer, never
 * birth_date; page-hidden → visible:false with no mentor object; mentor only (401 signed-out, 404 without a profile, 400 bad as).
 * Cross-checked against what real viewers get from GET /api/mentors/:handle. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, owner, member, mentee;
const NOW = Date.parse("Sun 2027-01-03 9:00 AM (UTC+03:00)");
const db = () => H.app.ctx.db;
const HANDLE = "mpp_owner";
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const put = (b) => owner.req("PUT", "/api/mentor/me", b);
const prev = (as, c = owner) => c.req("GET", "/api/mentor/me/preview?as=" + as);
const EXTRA = { approach: "أبدأ من مشروع صغير", skills: ["JavaScript"], experience: [{ title: "مطوّرة", org: "شركة", from: 2015, to: null }], qualifications: [{ name: "بكالوريوس", issuer: "جامعة", year: 2014, link: null }], years: 10, city: "جدة" };
const strip = (m) => { const { visibility: _v, fields: _f, ...rest } = m; return rest; };

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  owner = await mk(HANDLE); member = await mk("mpp_member"); mentee = await mk("mpp_mentee");
  await db().run("UPDATE users SET avatar='https://cdn.example.com/a.png' WHERE id=$1", [owner.id]);
  const r = await put({ headline: "مطوّرة ويب منذ عشر سنوات", topics: ["programming"], extra: EXTRA }); assert.equal(r.status, 200, r.error);
  await db().run("INSERT INTO age_profiles(user_id,birth_date,source,updated_at) VALUES($1,'1990-06-15','self',$2)", [owner.id, new Date(NOW).toISOString()]);
  await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES('mss_mpp1',$1,$2,NULL,'programming','',$3,60,'completed',0,0,'none',0,$4,$4)",
    [owner.id, mentee.id, new Date(NOW - 5 * 864e5).toISOString(), new Date(NOW).toISOString()]);
});
test.after(() => H.app.close());
test.beforeEach(async () => { H.app.ctx.rl.w.clear(); await put({ visibility: "public", fields: null }); });

test("auth + validation: signed-out 401, no profile 404, bad as 400", async () => {
  assert.equal((await new H.Client().req("GET", "/api/mentor/me/preview?as=visitor")).status, 401);
  assert.equal((await prev("visitor", member)).status, 404);
  for (const as of ["", "owner", "staff", "x"]) assert.equal((await prev(as)).status, 400, as);
});

test("each viewer's preview matches what that viewer really gets, and never hidden fields or birth_date", async () => {
  const f = await put({ fields: { age: "mentees", city: "public", experience: "mentees", qualifications: "off", stats: "off", photo: "mentees", contact: "mentees" } });
  assert.equal(f.status, 200, f.error);
  const real = { visitor: await new H.Client().req("GET", "/api/mentors/" + HANDLE), member: await member.req("GET", "/api/mentors/" + HANDLE), mentee: await mentee.req("GET", "/api/mentors/" + HANDLE) };
  for (const as of ["visitor", "member", "mentee", "guardian"]) {
    const r = await prev(as); assert.equal(r.status, 200, as + " " + r.error);
    assert.equal(r.visible, true); const m = r.mentor;
    assert.ok(!JSON.stringify(r).includes("1990"), "birth date never sent (" + as + ")");
    assert.ok(!("birth_date" in m) && !("birthDate" in m));
    assert.ok(!("visibility" in m) && !("fields" in m), "no owner settings inside the previewed mentor");
    assert.ok(!("qualifications" in m), "off → absent for " + as);
    if (as === "mentee") { assert.equal(typeof m.age, "number"); assert.ok(m.experience && m.user.avatar && m.contact === true); assert.equal(r.canContact, true); }
    else { assert.ok(!("age" in m) && !("experience" in m) && !("years" in m), "mentees-only absent for " + as); assert.equal(m.user.avatar, null); assert.ok(!("rating" in m)); assert.equal(m.contact, false); }
    assert.equal(m.city, "جدة");
    if (real[as]) assert.deepEqual(m, strip(real[as].mentor), "preview == real view for " + as);
  }
});

test("page visibility: members hides from visitor; hidden only for mentee + guardian (visible:false carries no mentor)", async () => {
  await put({ visibility: "members" });
  let r = await prev("visitor"); assert.equal(r.status, 200); assert.equal(r.visible, false); assert.ok(!("mentor" in r));
  assert.equal((await new H.Client().req("GET", "/api/mentors/" + HANDLE)).status, 404, "real visitor also 404");
  assert.equal((await prev("member")).visible, true);
  await put({ visibility: "hidden" });
  for (const as of ["visitor", "member"]) { r = await prev(as); assert.equal(r.visible, false, as); assert.ok(!("mentor" in r)); assert.ok(!JSON.stringify(r).includes("جدة")); }
  for (const as of ["mentee", "guardian"]) assert.equal((await prev(as)).visible, true, as);
  assert.equal((await member.req("GET", "/api/mentors/" + HANDLE)).status, 404, "real member also 404");
});

test("age public → whole years only, still no birth date", async () => {
  await put({ fields: { age: "public" } });
  const r = await prev("visitor"); assert.equal(typeof r.mentor.age, "number"); assert.ok(r.mentor.age >= 36 && r.mentor.age <= 37);
  assert.ok(!JSON.stringify(r).includes("1990-06-15") && !JSON.stringify(r).includes("06-15"));
});
