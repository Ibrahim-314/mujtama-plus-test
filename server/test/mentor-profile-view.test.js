/* مسار الإرشاد M2-2 — viewer filtering of the full mentor profile: GET /api/mentors/:handle, the directory (and so match)
 * and /slots. Page visibility public | members | hidden (hidden → 404 for anyone but owner, staff, mentees and their active
 * guardians; no existence leak), per-field levels public | mentees | off (a field the viewer may not see is ABSENT from the
 * JSON), age as whole years only (birth_date never sent), blocked → 404, suspended keeps owner+staff only.
 * Viewer matrix: guest, member, mentee, guardian, owner, staff, blocked. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, owner, member, mentee, staff, blockedC, parent, kid;
const guest = () => new H.Client();
const NOW = Date.parse("Sun 2027-01-03 9:00 AM (UTC+03:00)");
const db = () => H.app.ctx.db;
const HANDLE = "mpv_owner";
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const put = (b) => owner.req("PUT", "/api/mentor/me", b);
const page = (c) => c.req("GET", "/api/mentors/" + HANDLE);
const listed = async (c) => { const r = await c.req("GET", "/api/mentors"); assert.equal(r.status, 200, r.error); return r.mentors.some((m) => m.user.handle === HANDLE); };
const session = (learner, status, minor = 0) => db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,'programming','',$4,60,$5,0,0,'none',$6,$7,$7)",
  ["mss_" + learner.slice(-8) + status, owner.id, learner, new Date(NOW - 5 * 864e5).toISOString(), status, minor, new Date(NOW).toISOString()]);
const EXTRA = { approach: "أبدأ من مشروع صغير", skills: ["JavaScript"], experience: [{ title: "مطوّرة", org: "شركة", from: 2015, to: null }], qualifications: [{ name: "بكالوريوس حاسب", issuer: "جامعة", year: 2014, link: null }], years: 10, city: "جدة" };

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  owner = await mk(HANDLE); member = await mk("mpv_member"); mentee = await mk("mpv_mentee"); staff = await mk("mpv_staff");
  blockedC = await mk("mpv_blocked"); parent = await mk("mpv_parent"); kid = await mk("mpv_kid");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]);
  await db().run("UPDATE users SET avatar='https://cdn.example.com/a.png' WHERE id=$1", [owner.id]);
  const r = await put({ headline: "مطوّرة ويب منذ عشر سنوات", topics: ["programming"], extra: EXTRA }); assert.equal(r.status, 200, r.error);
  await db().run("INSERT INTO age_profiles(user_id,birth_date,source,updated_at) VALUES($1,'1990-06-15','self',$2)", [owner.id, new Date(NOW).toISOString()]);
  await session(mentee.id, "completed");
  await session(kid.id, "confirmed", 1);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_mpv',$1,$2,'active',$1,'{}',$3)", [parent.id, kid.id, new Date(NOW).toISOString()]);
  await db().run("INSERT INTO user_blocks(owner,target,root,source,created_at) VALUES($1,$2,$2,'direct',$3)", [owner.id, blockedC.id, new Date(NOW).toISOString()]);
});
test.after(() => H.app.close());
test.beforeEach(async () => { H.app.ctx.rl.w.clear(); await put({ visibility: "public", fields: null }); await db().run("UPDATE mentor_profiles SET status='active' WHERE user_id=$1", [owner.id]); });

test("defaults (public, FIELD_DEFAULTS): guest sees the page; age + city absent; experience/qualifications present; no settings leak", async () => {
  const r = await page(guest()); assert.equal(r.status, 200, r.error);
  const m = r.mentor;
  assert.equal(m.user.avatar, "https://cdn.example.com/a.png");
  assert.ok(!("age" in m) && !("city" in m), "age/city off by default");
  assert.deepEqual(m.experience, EXTRA.experience); assert.equal(m.years, 10); assert.equal(m.qualifications.length, 1);
  assert.equal(m.approach, EXTRA.approach); assert.deepEqual(m.skills, ["JavaScript"]);
  assert.ok(m.rating && "sessions" in m); assert.ok(Array.isArray(r.distribution));
  assert.equal(m.contact, true); assert.ok(!m.shown.includes("age"));
  assert.ok(!("visibility" in m) && !("fields" in m), "settings only for owner/staff");
  assert.equal(r.me.relation, "guest");
  assert.ok(!JSON.stringify(r).includes("1990"), "birth date never sent");
  assert.ok(await listed(guest()));
});

test("field levels across viewers: guest / member / mentee / guardian / owner / staff", async () => {
  const f = await put({ fields: { age: "mentees", city: "public", experience: "mentees", qualifications: "off", stats: "off", photo: "mentees", contact: "mentees" } });
  assert.equal(f.status, 200, f.error);
  for (const [c, rel] of [[guest(), "guest"], [member, "member"], [parent, "member"]]) {
    const r = await page(c); assert.equal(r.status, 200, r.error); const m = r.mentor;
    assert.equal(r.me.relation, rel);
    assert.equal(m.city, "جدة");
    for (const k of ["age", "experience", "years", "qualifications", "rating", "sessions"]) assert.ok(!(k in m), `${rel}: ${k} must be absent`);
    assert.equal(m.user.avatar, null); assert.equal(r.distribution, null); assert.equal(m.contact, false);
    if (rel !== "guest") { assert.equal(r.me.canBook, false); assert.match(r.me.why, /لمتعلّميه فقط/); }
    assert.ok(!JSON.stringify(r).includes("1990"));
  }
  for (const [c, rel] of [[mentee, "mentee"], [owner, "owner"], [staff, "staff"]]) {
    const r = await page(c); assert.equal(r.status, 200, r.error); const m = r.mentor;
    assert.equal(r.me.relation, rel);
    assert.equal(m.age, 36, `${rel} sees whole years`); assert.deepEqual(m.experience, EXTRA.experience); assert.equal(m.user.avatar, "https://cdn.example.com/a.png");
    assert.ok(!("qualifications" in m), "off = nobody on the page"); assert.ok(!("rating" in m)); assert.equal(r.distribution, null);
    assert.equal(m.contact, true); assert.equal("visibility" in m, rel !== "mentee");
    assert.ok(!JSON.stringify(r).includes("1990-06-15"));
  }
  const ms = await page(mentee); assert.equal(ms.me.canBook, true, ms.me.why);
  // directory never carries mentee-level fields, even for a mentee
  const d = await mentee.req("GET", "/api/mentors"); const dm = d.mentors.find((x) => x.user.handle === HANDLE);
  assert.ok(dm && !("age" in dm) && !("experience" in dm) && !("rating" in dm) && dm.user.avatar === null);
  // match still ranks with stats hidden (no crash on missing rating)
  const mt = await member.req("GET", "/api/mentors/match?topic=programming"); assert.equal(mt.status, 200, mt.error);
  // age off → nobody, not even the owner, gets it on the page
  await put({ fields: { age: "off" } });
  for (const c of [mentee, owner, staff]) assert.ok(!("age" in (await page(c)).mentor));
  await put({ fields: { age: "public" } }); assert.equal((await page(guest())).mentor.age, 36);
});

test("visibility members: guest 404 on page + slots, unlisted for guests; members see it", async () => {
  await put({ visibility: "members" });
  const g = await page(guest()); assert.equal(g.status, 404); assert.ok(!JSON.stringify(g).includes("مطوّرة"));
  assert.equal((await guest().req("GET", `/api/mentors/${HANDLE}/slots`)).status, 404);
  assert.equal(await listed(guest()), false);
  for (const c of [member, mentee, owner, staff]) assert.equal((await page(c)).status, 200);
  assert.equal(await listed(member), true);
  assert.equal((await member.req("GET", `/api/mentors/${HANDLE}/slots`)).status, 200);
});

test("visibility hidden: 404 for guest + member (same body as no profile); mentee, guardian of a minor mentee, owner, staff see it; never listed", async () => {
  await put({ visibility: "hidden" });
  const none = await guest().req("GET", "/api/mentors/mpv_member");
  for (const c of [guest(), member]) { const r = await page(c); assert.equal(r.status, 404); assert.equal(r.error, none.error); }
  assert.equal((await member.req("GET", `/api/mentors/${HANDLE}/slots`)).status, 404);
  for (const [c, rel] of [[mentee, "mentee"], [parent, "guardian"], [owner, "owner"], [staff, "staff"]]) { const r = await page(c); assert.equal(r.status, 200, rel + " " + r.error); assert.equal(r.me.relation, rel); }
  // guardian gets page access but not mentee-level fields
  await put({ fields: { age: "mentees" } });
  assert.ok(!("age" in (await page(parent)).mentor)); assert.equal((await page(mentee)).mentor.age, 36);
  for (const c of [guest(), member, mentee, parent]) assert.equal(await listed(c), false);
  // a cancelled-only learner is not a mentee
  const ex = await mk("mpv_ex"); await session(ex.id, "cancelled"); assert.equal((await page(ex)).status, 404);
  // an accepted request makes one
  await db().run("INSERT INTO mentor_requests(id,learner_id,mentor_id,topic,goal,level,status,created_at) VALUES('mrq_mpv',$1,$2,'programming','أريد تعلّم البرمجة من الصفر',NULL,'accepted',$3)", [ex.id, owner.id, new Date(NOW).toISOString()]);
  assert.equal((await page(ex)).status, 200);
});

test("blocked: 404 on a public page and slots in both directions; staff unaffected", async () => {
  assert.equal((await page(blockedC)).status, 404);
  assert.equal((await blockedC.req("GET", `/api/mentors/${HANDLE}/slots`)).status, 404);
  await db().run("INSERT INTO user_blocks(owner,target,root,source,created_at) VALUES($1,$2,$2,'direct',$3)", [member.id, owner.id, new Date(NOW).toISOString()]);
  try { assert.equal((await page(member)).status, 404); }
  finally { await db().run("DELETE FROM user_blocks WHERE owner=$1", [member.id]); }
  assert.equal((await page(member)).status, 200);
  assert.equal((await page(staff)).status, 200);
});

test("suspended: existing rule kept — owner and staff only", async () => {
  await db().run("UPDATE mentor_profiles SET status='suspended' WHERE user_id=$1", [owner.id]);
  for (const c of [guest(), member, mentee]) assert.equal((await page(c)).status, 404);
  for (const c of [owner, staff]) assert.equal((await page(c)).status, 200);
  assert.equal(await listed(member), false);
});

test("book is gated server-side by the contact field level: mentees → only mentees pass, off → nobody; hidden/blocked → 403", async () => {
  await db().run("UPDATE mentor_profiles SET open=1 WHERE user_id=$1", [owner.id]);
  const book = (c) => c.req("POST", `/api/mentors/${HANDLE}/book`, { startsAt: "not-a-date" });
  // public (default): the contact gate lets a member through to the slot check
  let r = await book(member); assert.notEqual(r.status, 403, r.error); assert.equal(r.status, 400);
  await put({ fields: { contact: "mentees" } });
  r = await book(member); assert.equal(r.status, 403); assert.equal(r.code, "not_bookable"); assert.match(r.error, /لمتعلّميه فقط/);
  r = await book(parent); assert.equal(r.status, 403); assert.match(r.error, /لمتعلّميه فقط/);
  r = await book(mentee); assert.equal(r.status, 400, "mentee passes the gate (fails later on the bad date)");
  await put({ fields: { contact: "off" } });
  for (const c of [member, mentee, staff]) { r = await book(c); assert.equal(r.status, 403); assert.match(r.error, /لا يستقبل التواصل/); }
  await put({ visibility: "hidden", fields: { contact: "public" } });
  r = await book(member); assert.equal(r.status, 403, "hidden page: a non-mentee cannot book"); assert.equal(r.code, "not_bookable");
  assert.equal((await book(blockedC)).status, 403, "blocked pair keeps the M1-1 403");
  assert.equal((await guest().req("POST", `/api/mentors/${HANDLE}/book`, { startsAt: "x" })).status, 401);
});
