/* مسار الإرشاد M2-4 — GET /api/mentors/:handle remainder: reviews paging with the `?reviewsBefore=` cursor (the default
 * response keeps its shape and only gains `reviewsNext`), the guardian card (only an active guardian of a linked MINOR
 * learner gets it; no notes / goals / feedback text / room ids), and public communities (field level "communities",
 * private / invite / archived never listed). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, owner, member, parent, kid, adultKidParent, adultKid, stranger;
const NOW = Date.parse("2027-01-03T06:00:00Z");
const db = () => H.app.ctx.db;
const HANDLE = "mpr_owner";
const ts = (ms) => new Date(ms).toISOString();
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const page = (c, q = "") => c.req("GET", "/api/mentors/" + HANDLE + q);
const session = (id, learner, status, at, minor = 0, note = "") => db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,'programming',$4,$5,60,$6,0,0,'none',$7,$8,$8)",
  [id, owner.id, learner, note, ts(at), status, minor, ts(NOW)]);

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  owner = await mk(HANDLE); member = await mk("mpr_member"); parent = await mk("mpr_parent"); kid = await mk("mpr_kid");
  adultKidParent = await mk("mpr_parent2"); adultKid = await mk("mpr_adultkid"); stranger = await mk("mpr_stranger");
  const r = await owner.req("PUT", "/api/mentor/me", { headline: "مرشد برمجة للمبتدئين", topics: ["programming"], allowMinors: true }); assert.equal(r.status, 200, r.error);
  // 25 rated reviews by `member` on 25 completed sessions; two share the same timestamp to exercise the tie-break
  for (let i = 0; i < 25; i++) {
    const sid = "mpr_s" + String(i).padStart(2, "0"), at = NOW - (30 - i) * 864e5;
    await session(sid, member.id, "completed", at);
    await db().run("INSERT INTO mentor_feedback(session_id,by_user,about_user,rating,comment,created_at) VALUES($1,$2,$3,$4,$5,$6)", [sid, member.id, owner.id, 1 + (i % 5), "تقييم رقم " + i, ts(i === 1 ? NOW - 29 * 864e5 : at + 3600e3)]);
  }
  // linked minor with sessions (one carries a private note), and a linked ADULT (not a minor) with a session
  await db().run("INSERT INTO age_profiles(user_id,birth_date,source,updated_at) VALUES($1,'2013-05-01','self',$2)", [kid.id, ts(NOW)]);
  await db().run("INSERT INTO age_profiles(user_id,birth_date,source,updated_at) VALUES($1,'1995-05-01','self',$2)", [adultKid.id, ts(NOW)]);
  await session("mpr_k1", kid.id, "completed", NOW - 10 * 864e5, 1, "ملاحظة خاصة جداً");
  await session("mpr_k2", kid.id, "confirmed", NOW + 2 * 864e5, 1, "ملاحظة سرية أخرى");
  await session("mpr_k3", kid.id, "cancelled", NOW - 3 * 864e5, 1);
  await session("mpr_a1", adultKid.id, "completed", NOW - 4 * 864e5);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_mpr',$1,$2,'active',$1,'{}',$3)", [parent.id, kid.id, ts(NOW)]);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_mpr2',$1,$2,'active',$1,'{}',$3)", [adultKidParent.id, adultKid.id, ts(NOW)]);
  // communities: public (listed), private + invite + archived public (never listed), pending membership (never listed)
  const comm = (id, type, archived = null) => db().run("INSERT INTO communities(id,name,descr,topic,type,color,owner,rules,settings,location,created_at,member_count,archived_at) VALUES($1,$2,'',NULL,$3,NULL,$4,'[]','{}',NULL,$5,3,$6)", [id, "مجتمع " + id, type, stranger.id, ts(NOW), archived]);
  await comm("mpr_pub", "public"); await comm("mpr_priv", "private"); await comm("mpr_inv", "invite"); await comm("mpr_arch", "public", ts(NOW)); await comm("mpr_pend", "public");
  for (const [c, role] of [["mpr_pub", "member"], ["mpr_priv", "member"], ["mpr_inv", "admin"], ["mpr_arch", "member"], ["mpr_pend", "pending"]])
    await db().run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES($1,$2,$3,$4)", [c, owner.id, role, ts(NOW)]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("reviews paging: first page 20 + reviewsNext; reviewsBefore returns the rest, no duplicates, newest first; existing shape intact", async () => {
  const a = await page(new H.Client()); assert.equal(a.status, 200, a.error);
  assert.equal(a.reviews.length, 20); assert.equal(typeof a.reviewsNext, "string");
  for (const k of ["mentor", "reviews", "distribution", "me", "statuses"]) assert.ok(k in a, "kept key " + k);
  assert.equal(a.distribution.reduce((x, y) => x + y, 0), 25);
  const b = await page(new H.Client(), "?reviewsBefore=" + encodeURIComponent(a.reviewsNext)); assert.equal(b.status, 200, b.error);
  for (const k of ["mentor", "me", "distribution", "guardian"]) assert.ok(!(k in b), "paging call is light: no " + k);
  assert.equal(b.reviews.length, 5); assert.equal(b.reviewsNext, null);
  const all = [...a.reviews, ...b.reviews].map((r) => r.comment);
  assert.equal(new Set(all).size, 25, "no duplicates across pages (tie-break by session id)");
  const times = [...a.reviews, ...b.reviews].map((r) => Date.parse(r.at));
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], "newest first");
});

test("reviewsBefore: malformed cursor → 400; hidden page keeps 404 for strangers even with a cursor", async () => {
  const bad = await page(new H.Client(), "?reviewsBefore=" + encodeURIComponent("x' OR 1=1 --")); assert.equal(bad.status, 400);
  assert.equal((await owner.req("PUT", "/api/mentor/me", { visibility: "hidden" })).status, 200);
  try {
    const r = await page(stranger, "?reviewsBefore=" + encodeURIComponent("2027-01-01T00:00:00.000Z|zzz")); assert.equal(r.status, 404);
    assert.equal((await page(new H.Client(), "?reviewsBefore=x")).status, 404, "access check before cursor validation: no existence leak");
  } finally { assert.equal((await owner.req("PUT", "/api/mentor/me", { visibility: "public" })).status, 200); }
});

test("guardian card: only the active guardian of a linked minor learner; counts + next date; never notes or room ids", async () => {
  const g = await page(parent); assert.equal(g.status, 200, g.error);
  assert.ok(g.guardian, "guardian gets the card");
  assert.deepEqual(g.guardian.sessions, { total: 3, upcoming: 1, completed: 1, cancelled: 1 });
  assert.ok(g.guardian.next && Date.parse(g.guardian.next.startsAt) > NOW && g.guardian.next.status === "confirmed");
  assert.deepEqual(g.guardian.learners.map((l) => l.handle), ["mpr_kid"]);
  assert.equal(g.guardian.safety.allowMinors, true); assert.equal(g.guardian.safety.notesPrivate, true);
  const raw = JSON.stringify(g.guardian);
  assert.ok(!raw.includes("ملاحظة") && !raw.includes("room") && !/mpr_k\d/.test(raw), "no notes / room ids / session ids");
  for (const c of [new H.Client(), member, stranger, adultKidParent, kid, owner]) {
    const r = await page(c); assert.equal(r.status, 200, r.error); assert.equal(r.guardian, null, "no card for " + (c.id || "guest"));
  }
  await db().run("UPDATE guardian_links SET status='revoked' WHERE id='gl_mpr'");
  try { assert.equal((await page(parent)).guardian, null, "revoked link → no card"); } finally { await db().run("UPDATE guardian_links SET status='active' WHERE id='gl_mpr'"); }
});

test("communities: absent while the field is off (default); public + non-archived + active membership only when on", async () => {
  const off = await page(member); assert.ok(!("communities" in off), "default off → key absent");
  assert.equal((await owner.req("PUT", "/api/mentor/me", { fields: { communities: "public" } })).status, 200);
  try {
    const on = await page(new H.Client()); assert.deepEqual(on.communities.map((c) => c.id), ["mpr_pub"]);
    assert.equal(on.communities[0].members, 3);
    assert.equal((await owner.req("PUT", "/api/mentor/me", { fields: { communities: "mentees" } })).status, 200);
    assert.ok(!("communities" in (await page(stranger))), "mentees level hides it from non-mentees");
    assert.deepEqual((await page(member)).communities.map((c) => c.id), ["mpr_pub"], "a mentee sees it");
  } finally { await owner.req("PUT", "/api/mentor/me", { fields: null }); }
});

test("v2.65 privacy: «التقييمات والإحصاءات» hidden → no reviews in JSON (first page and «عرض المزيد»), mentees level still serves mentees", async () => {
  const full = await page(new H.Client()); const cursor = full.reviewsNext; assert.equal(typeof cursor, "string");
  assert.equal((await owner.req("PUT", "/api/mentor/me", { fields: { stats: "off" } })).status, 200);
  try {
    for (const c of [new H.Client(), stranger, member]) {
      const r = await c.req("GET", "/api/mentors/" + HANDLE); assert.equal(r.status, 200, r.error);
      assert.deepEqual(r.reviews, [], "no reviews sent while stats are off"); assert.equal(r.reviewsNext, null); assert.equal(r.distribution, null);
      assert.ok(!("rating" in r.mentor), "no rating either");
      assert.ok(!JSON.stringify(r).includes("تقييم رقم"), "no review text anywhere in the payload");
      const more = await page(c, "?reviewsBefore=" + encodeURIComponent(cursor)); assert.equal(more.status, 200, more.error);
      assert.deepEqual(more.reviews, []); assert.equal(more.reviewsNext, null);
    }
    assert.equal((await owner.req("PUT", "/api/mentor/me", { fields: { stats: "mentees" } })).status, 200);
    assert.deepEqual((await page(stranger)).reviews, [], "mentees level hides reviews from non-mentees");
    assert.equal((await page(member)).reviews.length, 20, "a mentee still sees reviews");
  } finally { await owner.req("PUT", "/api/mentor/me", { fields: null }); }
  assert.equal((await page(new H.Client())).reviews.length, 20, "restored");
});
