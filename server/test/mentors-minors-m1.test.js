/* M1-4 «مدقق سلامة القُصّر» — minors rules end-to-end for mentorship:
 *  - a minor cannot open a mentor profile;
 *  - a minor books only FREE sessions with mentors that accept minors, and only with an ACTIVE guardian link
 *    (none / pending → refused; Pi on does not open priced mentors to minors);
 *  - the guardian's family list and session page never carry notes or the mentor's private feedback;
 *  - private notes never reach the other side; shared notes do; the mentor's feedback stays with its author;
 *  - reviews by minors are masked as «متعلّم» (isMinorUser AND minorIds faked);
 *  - room: pair + active guardian only; a block made after booking shuts the room for everyone (cancel stays allowed).
 * PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, NOW = Date.parse("2027-01-03T06:00:00Z"); // Sunday 09:00 Riyadh
let mA, mB, mC, kid, parent, stranger, kid2;
const db = () => H.app.ctx.db;
const M = () => H.app.ctx.services.mentors;
const MON18 = "2027-01-04T15:00:00.000Z", MON19 = "2027-01-04T16:00:00.000Z", MON18n = "2027-01-11T15:00:00.000Z";
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const minors = new Set();
let realIs, realIds;
const prof = (extra) => ({ headline: "مرشد خبير في البرمجة", topics: ["programming"], minutes: 60, tz: "Asia/Riyadh", ...extra });
const slots = { slots: [{ weekday: 1, start: "18:00", end: "20:00" }] };
const link = (id, g, m, status) => db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,$4,$2,'{}',$5)", [id, g, m, status, new Date().toISOString()]);

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  mA = await mk("mm_a", "مرشد لا يقبل القُصّر"); mB = await mk("mm_b", "مرشدة تقبل القُصّر"); mC = await mk("mm_c", "مرشد بمقابل");
  kid = await mk("mm_kid", "ريم القاصر"); parent = await mk("mm_parent", "وليّ الأمر"); stranger = await mk("mm_x"); kid2 = await mk("mm_kid2");
  const ms = H.app.ctx.services.minors; realIs = ms.isMinorUser; realIds = ms.minorIds;
  ms.isMinorUser = async (uid) => minors.has(uid) || (await realIs(uid));
  if (realIds) ms.minorIds = async (ids) => { const out = new Set(await realIds(ids)); for (const i of ids || []) if (minors.has(i)) out.add(i); return out; };
  minors.add(kid.id); minors.add(kid2.id);
  for (const [c, x] of [[mA, {}], [mB, { allowMinors: true }], [mC, { allowMinors: true, price: 3 }]]) {
    const r = await c.req("PUT", "/api/mentor/me", prof(x)); assert.equal(r.status, 200, r.error);
    assert.equal((await c.req("PUT", "/api/mentor/me/slots", slots)).status, 200);
  }
});
test.after(() => { const ms = H.app.ctx.services.minors; ms.isMinorUser = realIs; if (realIds) ms.minorIds = realIds; return H.app.close(); });
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("minor cannot create a mentor profile (403 minor_restricted, nothing stored)", async () => {
  const r = await kid.req("PUT", "/api/mentor/me", prof({ allowMinors: true }));
  assert.equal(r.status, 403); assert.equal(r.code, "minor_restricted");
  assert.equal(await db().get("SELECT user_id FROM mentor_profiles WHERE user_id=$1", [kid.id]), undefined);
  const me = await kid.req("GET", "/api/mentor/me"); assert.equal(me.status, 200); assert.equal(me.minor, true); assert.equal(me.profile, null);
  assert.equal((await kid.req("PUT", "/api/mentor/me/slots", slots)).status >= 400, true);
});

test("minor booking: opt-in mentors only, free only, active guardian link only (Pi on does not change it)", async () => {
  // directory: only the free, opt-in mentor
  const d = await kid.req("GET", "/api/mentors"); assert.deepEqual(d.mentors.map((m) => m.user.handle), ["mm_b"]); assert.equal(d.minor, true);
  // no guardian yet: every path refused
  let r = await kid.req("POST", "/api/mentors/mm_a/book", { startsAt: MON18 }); assert.equal(r.status, 403); assert.equal(r.code, "minor_restricted");
  r = await kid.req("POST", "/api/mentors/mm_b/book", { startsAt: MON18 }); assert.equal(r.status, 403); assert.match(r.error, /وليّ أمر/);
  assert.equal((await kid.req("GET", "/api/mentors/mm_b")).me.canBook, false);
  assert.equal((await kid.req("POST", "/api/mentor/requests", { topic: "programming", goal: "أريد تعلّم البرمجة من الصفر" })).code, "guardian_required");
  // pending link is not enough
  await link("gl_m14", parent.id, kid.id, "pending");
  r = await kid.req("POST", "/api/mentors/mm_b/book", { startsAt: MON18 }); assert.equal(r.status, 403);
  await db().run("UPDATE guardian_links SET status='active' WHERE id='gl_m14'");
  // still never: a mentor who did not opt in, or a priced mentor (even with Pi payments on)
  r = await kid.req("POST", "/api/mentors/mm_a/book", { startsAt: MON18 }); assert.equal(r.status, 403); assert.equal(r.code, "minor_restricted");
  const pis = H.app.ctx.services.pi, en = pis.enabled, ci = pis.createIntent;
  pis.enabled = () => true; pis.createIntent = async (u, b) => ({ id: "pitx_m14", amount: b.amount, memo: b.memo, metadata: {} });
  try {
    r = await kid.req("POST", "/api/mentors/mm_c/book", { startsAt: MON18 }); assert.equal(r.status, 403); assert.equal(r.code, "minor_restricted");
    assert.ok(!(await kid.req("GET", "/api/mentors")).mentors.some((m) => m.user.handle === "mm_c"));
  } finally { pis.enabled = en; pis.createIntent = ci; }
  assert.equal(await db().get("SELECT id FROM mentor_sessions WHERE learner_id=$1", [kid.id]), undefined);
  // active link + free opt-in mentor → booked, flagged minor, guardian told
  r = await kid.req("POST", "/api/mentors/mm_b/book", { startsAt: MON18, note: "رسالة الحجز" }); assert.equal(r.status, 200, r.error); assert.equal(r.session.minor, true);
  assert.ok((await db().all("SELECT kind FROM notifications WHERE user_id=$1", [parent.id])).some((n) => n.kind === "mentor_guardian"));
  // a revoked link closes booking again (second minor, own link)
  await link("gl_m14b", parent.id, kid2.id, "revoked");
  assert.equal((await kid2.req("POST", "/api/mentors/mm_b/book", { startsAt: MON19 })).status, 403);
});

let sid;
test("notes + feedback privacy: private notes / mentor feedback never reach the other side or the guardian; minor reviews masked", async () => {
  sid = (await db().get("SELECT id FROM mentor_sessions WHERE learner_id=$1", [kid.id])).id;
  assert.equal((await mB.req("POST", `/api/mentor-sessions/${sid}/confirm`)).status, 200);
  NOW = Date.parse(MON18) + 5 * 60e3;
  assert.equal((await mB.req("PUT", `/api/mentor-sessions/${sid}/note`, { body: "PRIVATE-MENTOR-NOTE عن الطالبة" })).status, 200);
  assert.equal((await kid.req("PUT", `/api/mentor-sessions/${sid}/note`, { body: "PRIVATE-KID-NOTE" })).status, 200);
  const k1 = await kid.req("GET", "/api/mentor-sessions/" + sid); assert.equal(k1.session.sharedNote, null); assert.equal(k1.session.myNote.body, "PRIVATE-KID-NOTE");
  assert.ok(!JSON.stringify(k1).includes("PRIVATE-MENTOR-NOTE"));
  const m1 = await mB.req("GET", "/api/mentor-sessions/" + sid); assert.equal(m1.session.sharedNote, null); assert.ok(!JSON.stringify(m1).includes("PRIVATE-KID-NOTE"));
  // complete → feedback both ways
  assert.equal((await mB.req("POST", `/api/mentor-sessions/${sid}/complete`)).status, 200);
  assert.equal((await kid.req("POST", `/api/mentor-sessions/${sid}/feedback`, { rating: 5, comment: "KID-REVIEW شكراً" })).status, 200);
  assert.equal((await mB.req("POST", `/api/mentor-sessions/${sid}/feedback`, { comment: "MENTOR-PRIVATE-FEEDBACK تحتاج تدريباً" })).status, 200);
  const k2 = await kid.req("GET", "/api/mentor-sessions/" + sid);
  assert.equal(k2.session.feedback.other, null); assert.ok(!JSON.stringify(k2).includes("MENTOR-PRIVATE-FEEDBACK"));
  const m2 = await mB.req("GET", "/api/mentor-sessions/" + sid); assert.equal(m2.session.feedback.other.rating, 5); // the learner's review is public anyway
  // the mentor shares the note → now the minor sees it (shared summary is the designed channel)
  await mB.req("PUT", `/api/mentor-sessions/${sid}/note`, { body: "SHARED-SUMMARY ملخص", shared: true });
  const k3 = await kid.req("GET", "/api/mentor-sessions/" + sid); assert.equal(k3.session.sharedNote.body, "SHARED-SUMMARY ملخص"); assert.equal(k3.session.sharedNote.by, "mentor");
  // guardian: family list + session page carry no notes (private or shared) and no feedback
  const fam = await parent.req("GET", "/api/mentor/sessions?role=family&when=past"); assert.equal(fam.status, 200); assert.equal(fam.sessions.length, 1); assert.equal(fam.sessions[0].role, "guardian");
  const g = await parent.req("GET", "/api/mentor-sessions/" + sid); assert.equal(g.status, 200); assert.equal(g.session.myNote, null); assert.equal(g.session.sharedNote, null); assert.equal(g.session.feedback.other, null);
  for (const body of [JSON.stringify(fam), JSON.stringify(g)]) for (const secret of ["PRIVATE-KID-NOTE", "SHARED-SUMMARY", "MENTOR-PRIVATE-FEEDBACK", "KID-REVIEW"]) assert.ok(!body.includes(secret), secret);
  assert.equal((await parent.req("PUT", `/api/mentor-sessions/${sid}/note`, { body: "ولي" })).status, 403);
  assert.equal((await parent.req("POST", `/api/mentor-sessions/${sid}/feedback`, { rating: 1 })).status, 409);
  // public page: the minor's review is masked, name + handle never leak; mentor's private feedback never listed
  for (const viewer of [new H.Client(), stranger, mB]) {
    const pg = await viewer.req("GET", "/api/mentors/mm_b"); assert.equal(pg.status, 200, pg.error);
    assert.equal(pg.reviews.length, 1); assert.deepEqual(pg.reviews[0].by, { name: "متعلّم" });
    const s = JSON.stringify(pg); assert.ok(!s.includes("mm_kid") && !s.includes("ريم القاصر") && !s.includes("MENTOR-PRIVATE-FEEDBACK"));
  }
  // (both minors.isMinorUser and minors.minorIds are faked in test.before, so this holds whichever one mentorPage reads)
});

test("room: pair + active guardian only; a block after booking shuts the room (view + join) while cancel stays", async () => {
  NOW = Date.parse("2027-01-03T06:00:00Z");
  const b = await kid.req("POST", "/api/mentors/mm_b/book", { startsAt: MON18n }); assert.equal(b.status, 200, b.error);
  const s2 = b.session.id; assert.equal((await mB.req("POST", `/api/mentor-sessions/${s2}/confirm`)).status, 200);
  NOW = Date.parse(MON18n) - 5 * 60e3;
  const j = await mB.req("POST", `/api/mentor-sessions/${s2}/join`); assert.equal(j.status, 200, j.error); const rid = j.roomId; assert.ok(rid);
  assert.equal((await kid.req("POST", `/api/rooms/${rid}/join`)).status, 200);
  assert.equal((await parent.req("POST", `/api/rooms/${rid}/join`)).status, 200);
  assert.equal((await stranger.req("POST", `/api/rooms/${rid}/join`)).status, 403);
  assert.equal((await stranger.req("GET", `/api/rooms/${rid}`)).status, 403);
  assert.ok(!(await stranger.req("GET", "/api/rooms")).rooms.some((r) => r.id === rid));
  // guardian ↔ mentor block: the guardian loses the room, the pair keeps it
  await db().run("INSERT INTO user_blocks(owner,target,root,created_at) VALUES($1,$2,$2,$3)", [parent.id, mB.id, new Date().toISOString()]);
  try {
    assert.equal(await M().roomAccess(rid, parent.id), false); assert.equal(await M().roomAccess(rid, kid.id), true);
    assert.ok(!(await parent.req("GET", "/api/mentor-sessions/" + s2)).session.actions.includes("join"));
  } finally { await db().run("DELETE FROM user_blocks WHERE owner=$1", [parent.id]); }
  // revoked guardian link → no room
  await db().run("UPDATE guardian_links SET status='revoked' WHERE id='gl_m14'");
  assert.equal(await M().roomAccess(rid, parent.id), false);
  await db().run("UPDATE guardian_links SET status='active' WHERE id='gl_m14'");
  // the minor blocks the mentor after booking (legacy prefs list): nobody gets in; join hidden + refused; cancel allowed
  const u = await db().get("SELECT prefs FROM users WHERE id=$1", [kid.id]); const prefs = typeof u.prefs === "string" ? JSON.parse(u.prefs || "{}") : u.prefs || {};
  await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [JSON.stringify({ ...prefs, blocked: [mB.id] }), kid.id]);
  for (const c of [kid, mB, parent]) assert.equal(await M().roomAccess(rid, c.id), false);
  assert.equal((await kid.req("POST", `/api/rooms/${rid}/join`)).status, 403);
  assert.equal((await mB.req("GET", `/api/rooms/${rid}`)).status, 403);
  const kv = await kid.req("GET", "/api/mentor-sessions/" + s2); assert.ok(!kv.session.actions.includes("join")); assert.ok(kv.session.actions.includes("cancel"));
  assert.equal((await kid.req("POST", `/api/mentor-sessions/${s2}/join`)).status, 409);
  assert.equal((await mB.req("POST", `/api/mentor-sessions/${s2}/join`)).status, 409);
  const c = await kid.req("POST", `/api/mentor-sessions/${s2}/cancel`, { reason: "حظرت المرشد" }); assert.equal(c.status, 200, c.error); assert.equal(c.session.status, "cancelled");
  await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [JSON.stringify(prefs), kid.id]);
  // mentor → learner block via user_blocks (other direction) on a fresh confirmed session row
  const t = new Date().toISOString();
  await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,room_id,created_at,updated_at) VALUES('mss_m14',$1,$2,'programming','',$3,60,'confirmed',0,0,'none',1,'room_m14',$4,$4)", [mB.id, kid.id, new Date(NOW + 5 * 60e3).toISOString(), t]);
  try {
    assert.equal(await M().roomAccess("room_m14", kid.id), true);
    await db().run("INSERT INTO user_blocks(owner,target,root,created_at) VALUES($1,$2,$2,$3)", [mB.id, kid.id, t]);
    assert.equal(await M().roomAccess("room_m14", kid.id), false); assert.equal(await M().roomAccess("room_m14", mB.id), false);
    assert.ok((await mB.req("GET", "/api/mentor-sessions/mss_m14")).session.actions.includes("cancel"));
  } finally { await db().run("DELETE FROM user_blocks WHERE owner=$1", [mB.id]); await db().run("DELETE FROM mentor_sessions WHERE id='mss_m14'"); }
});
