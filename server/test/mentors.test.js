/* Phase 74 — mentorship: profiles (adults only, validation), weekly availability in the mentor's time zone → free slots in
 * UTC (notice, horizon, busy sessions excluded), directory filters + matching reasons, requests (direct / open / accept /
 * decline / withdraw), booking only on a real free slot, confirm → private room (outsiders refused, never listed) → complete
 * → ratings aggregate, cancel with reason, notes (private / shared), .ics + private feed, minors (guardian required, opt-in
 * mentors only, free only, guardian notified + sees sessions + may join the room), Pi escrow (off → 501; on → held →
 * released / refund_due), reminders + expiry job, staff suspend (cancels upcoming, audited), migration 051 + data map.
 * PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

// Sunday 3 Jan 2027, 09:00 Riyadh (06:00 UTC)
let H, adminC, mentor, learner, other, NOW = Date.parse("2027-01-03T06:00:00Z");
const db = () => H.app.ctx.db;
const M = () => H.app.ctx.services.mentors;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);
test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  adminC = await mk("mt_admin"); mentor = await mk("mt_mentor", "سارة القحطاني"); learner = await mk("mt_learner", "فهد الدوسري"); other = await mk("mt_other");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("time zones: wall time ↔ UTC (Riyadh, New York across DST)", () => {
  const { zoned } = M()._tz;
  assert.equal(new Date(zoned("Asia/Riyadh", 2027, 1, 4, 18 * 60)).toISOString(), "2027-01-04T15:00:00.000Z");
  assert.equal(new Date(zoned("America/New_York", 2027, 1, 4, 9 * 60)).toISOString(), "2027-01-04T14:00:00.000Z");
  assert.equal(new Date(zoned("America/New_York", 2027, 7, 5, 9 * 60)).toISOString(), "2027-07-05T13:00:00.000Z");
});

test("profile: validation, adults only, availability → free slots in UTC", async () => {
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "قصير", topics: ["programming"] })).status, 400);
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "مطوّرة ويب منذ عشر سنوات", topics: [] })).status, 400);
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "مطوّرة ويب منذ عشر سنوات", topics: ["programming"], minutes: 50 })).status, 400);
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "مطوّرة ويب منذ عشر سنوات", topics: ["programming"], tz: "Mars/Base" })).status, 400);
  const p = await mentor.req("PUT", "/api/mentor/me", { headline: "مطوّرة ويب منذ عشر سنوات", bio: "أساعد المبتدئين في JavaScript وبناء أول مشروع", topics: ["programming", "career", "nope"], languages: "العربية، English", minutes: 60, tz: "Asia/Riyadh" });
  assert.equal(p.status, 200, p.error);
  assert.deepEqual(p.profile.topics.map((t) => t.key), ["programming", "career"]);
  assert.equal(p.profile.paid, false); assert.equal(p.profile.open, true);
  // slots: overlap / too short / bad day refused
  assert.equal((await mentor.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "20:00" }, { weekday: 1, start: "19:00", end: "21:00" }] })).status, 400);
  assert.equal((await mentor.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "18:30" }] })).status, 400);
  assert.equal((await mentor.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 9, start: "18:00", end: "20:00" }] })).status, 400);
  const s = await mentor.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "20:00" }, { weekday: 0, start: "10:00", end: "12:00" }] });
  assert.equal(s.status, 200, s.error); assert.equal(s.slots.length, 2);
  const fs = await learner.req("GET", "/api/mentors/mt_mentor/slots");
  assert.equal(fs.status, 200, fs.error);
  // Sunday 10:00 today is inside the 12 h notice → first is Monday 18:00 Riyadh = 15:00 UTC
  assert.equal(fs.slots[0], "2027-01-04T15:00:00.000Z"); assert.equal(fs.slots[1], "2027-01-04T16:00:00.000Z");
  assert.ok(fs.slots.includes("2027-01-10T07:00:00.000Z")); // Sunday 10:00 next week
  assert.ok(fs.slots.every((x) => Date.parse(x) <= NOW + 15 * 864e5));
  // minors cannot become mentors
  const kid = await mk("mt_kid0"); const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
  try { const r = await kid.req("PUT", "/api/mentor/me", { headline: "أحب البرمجة كثيراً", topics: ["programming"] }); assert.equal(r.status, 403); assert.equal(r.code, "minor_restricted"); }
  finally { H.app.ctx.services.minors.isMinorUser = real; }
});

test("directory, filters, matching with reasons, mentor page", async () => {
  const d = await new H.Client().req("GET", "/api/mentors");
  assert.equal(d.status, 200, d.error); assert.equal(d.mentors.length, 1); assert.equal(d.counts.programming, 1);
  assert.equal((await learner.req("GET", "/api/mentors?topic=design")).mentors.length, 0);
  assert.equal((await learner.req("GET", "/api/mentors?q=javascript")).mentors.length, 1);
  assert.equal((await learner.req("GET", "/api/mentors?price=paid")).mentors.length, 0);
  assert.equal((await mentor.req("GET", "/api/mentors")).mentors.length, 0); // not shown to herself
  const m = await learner.req("GET", "/api/mentors/match?topic=programming&goal=تعلم javascript");
  assert.equal(m.status, 200, m.error); assert.equal(m.matches[0].mentor.user.handle, "mt_mentor");
  assert.ok(m.matches[0].reasons.some((r) => /البرمجة|برمجة/.test(r))); assert.ok(m.matches[0].reasons.includes("متاح خلال هذا الأسبوع")); assert.ok(m.matches[0].reasons.includes("خبرته قريبة من هدفك"));
  assert.equal((await learner.req("GET", "/api/mentors/match")).status, 400);
  const pg = await learner.req("GET", "/api/mentors/mt_mentor");
  assert.equal(pg.status, 200, pg.error); assert.equal(pg.me.canBook, true); assert.equal(pg.mentor.minutes, 60);
  assert.equal((await new H.Client().req("GET", "/api/mentors/mt_other")).status, 404);
});

let rq;
test("requests: direct accept / decline, open request taken by a matching mentor, withdraw, limits", async () => {
  assert.equal((await learner.req("POST", "/api/mentor/requests", { topic: "programming", goal: "قصير" })).status, 400);
  const r = await learner.req("POST", "/api/mentor/requests", { mentor: "mt_mentor", topic: "programming", goal: "أريد بناء أول تطبيق ويب خلال شهر", level: "beginner" });
  assert.equal(r.status, 200, r.error); rq = r.request; assert.equal(rq.direct, true);
  assert.equal((await learner.req("POST", "/api/mentor/requests", { mentor: "mt_mentor", topic: "programming", goal: "طلب ثانٍ لنفس المرشد" })).status, 409);
  assert.ok((await kinds(mentor.id)).includes("mentor_request"));
  const box = await mentor.req("GET", "/api/mentor/requests"); assert.equal(box.received.length, 1); assert.equal(box.mentor, true);
  assert.equal((await other.req("POST", `/api/mentor/requests/${rq.id}/accept`)).status, 403);
  const a = await mentor.req("POST", `/api/mentor/requests/${rq.id}/accept`, { reply: "أهلاً فهد، احجز موعداً يناسبك" });
  assert.equal(a.status, 200, a.error); assert.equal(a.request.status, "accepted");
  assert.equal((await mentor.req("POST", `/api/mentor/requests/${rq.id}/decline`)).status, 409);
  assert.ok((await kinds(learner.id)).includes("mentor_reply"));
  // open request: visible to mentors of the topic only
  const o = await other.req("POST", "/api/mentor/requests", { topic: "career", goal: "أستعد لمقابلات العمل التقنية" });
  assert.equal(o.status, 200, o.error); assert.equal(o.request.direct, false);
  assert.ok((await mentor.req("GET", "/api/mentor/requests")).open.some((x) => x.id === o.request.id));
  assert.equal((await mentor.req("POST", `/api/mentor/requests/${o.request.id}/decline`)).status, 400);
  const w = await other.req("POST", "/api/mentor/requests", { topic: "design", goal: "أتعلم أساسيات التصميم" });
  assert.ok(!(await mentor.req("GET", "/api/mentor/requests")).open.some((x) => x.id === w.request.id));
  assert.equal((await other.req("POST", `/api/mentor/requests/${w.request.id}/withdraw`)).status, 200);
  assert.equal((await learner.req("POST", `/api/mentor/requests/${o.request.id}/withdraw`)).status, 404);
  const t = await mentor.req("POST", `/api/mentor/requests/${o.request.id}/accept`); assert.equal(t.request.mentor.handle, "mt_mentor");
});

let sid;
test("booking only on free slots → confirm → private room → complete → rating; conflicts; cancel; notes; .ics + feed", async () => {
  assert.equal((await learner.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T15:30:00.000Z" })).status, 409);
  assert.equal((await mentor.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T15:00:00.000Z" })).status, 403);
  const b = await learner.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T15:00:00.000Z", topic: "programming", note: "أرسلت رابط المشروع", requestId: rq.id });
  assert.equal(b.status, 200, b.error); sid = b.session.id; assert.equal(b.session.status, "pending"); assert.equal(b.intent, null);
  assert.equal((await db().get("SELECT status FROM mentor_requests WHERE id=$1", [rq.id])).status, "closed");
  assert.ok((await kinds(mentor.id)).includes("mentor_booked"));
  // the slot is gone for everyone
  assert.ok(!(await other.req("GET", "/api/mentors/mt_mentor/slots")).slots.includes("2027-01-04T15:00:00.000Z"));
  assert.equal((await other.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T15:00:00.000Z" })).status, 409);
  assert.equal((await other.req("GET", "/api/mentor-sessions/" + sid)).status, 404);
  assert.equal((await learner.req("POST", `/api/mentor-sessions/${sid}/confirm`)).status, 409);
  const c = await mentor.req("POST", `/api/mentor-sessions/${sid}/confirm`); assert.equal(c.status, 200, c.error); assert.equal(c.session.status, "confirmed");
  // join too early
  assert.equal((await mentor.req("POST", `/api/mentor-sessions/${sid}/join`)).status, 409);
  NOW = Date.parse("2027-01-04T14:55:00Z");
  assert.equal((await learner.req("POST", `/api/mentor-sessions/${sid}/join`)).status, 409); // mentor opens first
  const j = await mentor.req("POST", `/api/mentor-sessions/${sid}/join`); assert.equal(j.status, 200, j.error); assert.ok(j.roomId);
  const lj = await learner.req("POST", `/api/mentor-sessions/${sid}/join`); assert.equal(lj.roomId, j.roomId);
  assert.equal((await learner.req("POST", `/api/rooms/${j.roomId}/join`)).status, 200);
  const no = await other.req("POST", `/api/rooms/${j.roomId}/join`); assert.equal(no.status, 403); assert.match(no.error, /إرشاد/);
  assert.ok(!(await other.req("GET", "/api/rooms")).rooms.some((r) => r.id === j.roomId));
  // notes: private by default, shared summary visible to the other side
  await learner.req("PUT", `/api/mentor-sessions/${sid}/note`, { body: "ملاحظتي الخاصة" });
  assert.equal((await mentor.req("GET", "/api/mentor-sessions/" + sid)).session.sharedNote, null);
  const n = await mentor.req("PUT", `/api/mentor-sessions/${sid}/note`, { body: "الخطوة القادمة: تعلّم fetch وبناء صفحة", shared: true });
  assert.equal(n.status, 200, n.error); assert.equal(n.session.myNote.shared, true);
  assert.match((await learner.req("GET", "/api/mentor-sessions/" + sid)).session.sharedNote.body, /fetch/);
  // feedback only after completion
  assert.equal((await learner.req("POST", `/api/mentor-sessions/${sid}/feedback`, { rating: 5 })).status, 409);
  NOW = Date.parse("2027-01-04T16:00:00Z");
  assert.equal((await learner.req("POST", `/api/mentor-sessions/${sid}/complete`)).status, 409);
  const done = await mentor.req("POST", `/api/mentor-sessions/${sid}/complete`); assert.equal(done.status, 200, done.error); assert.equal(done.session.status, "completed");
  assert.equal((await db().get("SELECT status FROM rooms WHERE id=$1", [j.roomId])).status, "ended");
  assert.equal((await learner.req("POST", `/api/mentor-sessions/${sid}/feedback`, { rating: 9 })).status, 400);
  const f = await learner.req("POST", `/api/mentor-sessions/${sid}/feedback`, { rating: 5, comment: "شرح واضح وصبر جميل" });
  assert.equal(f.status, 200, f.error); assert.equal(f.session.feedback.mine.rating, 5);
  assert.equal((await learner.req("POST", `/api/mentor-sessions/${sid}/feedback`, { rating: 4 })).status, 409);
  assert.equal((await mentor.req("POST", `/api/mentor-sessions/${sid}/feedback`, {})).status, 400); // mentor: comment required
  assert.equal((await mentor.req("POST", `/api/mentor-sessions/${sid}/feedback`, { comment: "متعلّم مجتهد" })).status, 200);
  const pg = await other.req("GET", "/api/mentors/mt_mentor");
  assert.equal(pg.mentor.rating.avg, 5); assert.equal(pg.mentor.rating.count, 1); assert.equal(pg.mentor.sessions, 1); assert.equal(pg.reviews[0].by.name, "فهد الدوسري"); assert.equal(pg.distribution[4], 1);
  // lists
  const past = await learner.req("GET", "/api/mentor/sessions?when=past"); assert.ok(past.sessions.some((s) => s.id === sid));
  // .ics + feed
  const ics = await fetch(H.base + `/api/mentor-sessions/${sid}/ics`, { headers: { Cookie: learner.cookie, "X-Requested-With": "mujtama" } });
  assert.equal(ics.status, 200); const body = await ics.text(); assert.match(body, /BEGIN:VEVENT/); assert.match(body, /DTSTART:20270104T150000Z/);
  const fd = await learner.req("POST", "/api/mentor/feed", {}); assert.match(fd.path, /^\/mentor-feed\/[\w-]+\.ics$/);
  const fr = await fetch(H.base + fd.path); assert.equal(fr.status, 200); assert.match(await fr.text(), /جلسة إرشاد/);
  const rot = await learner.req("POST", "/api/mentor/feed", { rotate: true }); assert.notEqual(rot.path, fd.path);
  assert.equal((await fetch(H.base + fd.path)).status, 404);
  // cancel with a reason
  const b2 = await learner.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-10T07:00:00.000Z" }); assert.equal(b2.status, 200, b2.error);
  assert.equal((await learner.req("POST", `/api/mentor-sessions/${b2.session.id}/cancel`, {})).status, 400);
  const cx = await learner.req("POST", `/api/mentor-sessions/${b2.session.id}/cancel`, { reason: "تغيّر موعد اختباري" });
  assert.equal(cx.session.status, "cancelled"); assert.equal(cx.session.cancelledBy, "learner");
  assert.ok((await other.req("GET", "/api/mentors/mt_mentor/slots")).slots.includes("2027-01-10T07:00:00.000Z"));
});

test("minors: guardian link required, opt-in mentors only, free only; guardian notified, sees sessions, may join", async () => {
  const kid = await mk("mt_kid", "ريم عبدالله"); const parent = await mk("mt_parent");
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
  try {
    NOW = Date.parse("2027-01-03T06:00:00Z");
    assert.equal((await kid.req("GET", "/api/mentors")).mentors.length, 0); // mentor did not opt in
    let r = await kid.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T16:00:00.000Z" }); assert.equal(r.status, 403); assert.equal(r.code, "minor_restricted");
    await mentor.req("PUT", "/api/mentor/me", { allowMinors: true });
    assert.equal((await kid.req("GET", "/api/mentors")).mentors.length, 1);
    r = await kid.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T16:00:00.000Z" }); assert.equal(r.status, 403); assert.match(r.error, /وليّ أمر/);
    assert.equal((await kid.req("POST", "/api/mentor/requests", { topic: "programming", goal: "أريد تعلّم البرمجة من الصفر" })).code, "guardian_required");
    await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_mt',$1,$2,'active',$1,'{}',$3)", [parent.id, kid.id, new Date().toISOString()]);
    r = await kid.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T16:00:00.000Z" }); assert.equal(r.status, 200, r.error); assert.equal(r.session.minor, true);
    assert.ok((await kinds(parent.id)).includes("mentor_guardian"));
    const fam = await parent.req("GET", "/api/mentor/sessions?role=family"); assert.equal(fam.sessions.length, 1); assert.equal(fam.sessions[0].role, "guardian");
    const gv = await parent.req("GET", "/api/mentor-sessions/" + r.session.id); assert.equal(gv.status, 200); assert.equal(gv.session.myNote, null);
    await mentor.req("POST", `/api/mentor-sessions/${r.session.id}/confirm`);
    NOW = Date.parse("2027-01-04T15:55:00Z");
    const j = await mentor.req("POST", `/api/mentor-sessions/${r.session.id}/join`); assert.equal(j.status, 200, j.error);
    assert.equal((await parent.req("POST", `/api/rooms/${j.roomId}/join`)).status, 200);
    assert.equal((await other.req("POST", `/api/rooms/${j.roomId}/join`)).status, 403);
    await mentor.req("POST", `/api/mentor-sessions/${r.session.id}/cancel`, { reason: "انقطع الاتصال" });
    // paid mentors are never bookable by minors
    await mentor.req("PUT", "/api/mentor/me", { price: 3 });
    NOW = Date.parse("2027-01-03T06:00:00Z");
    assert.equal((await kid.req("GET", "/api/mentors")).mentors.length, 0);
    r = await kid.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-11T15:00:00.000Z" }); assert.equal(r.status, 403);
  } finally { H.app.ctx.services.minors.isMinorUser = real; }
});

test("Pi: priced mentor not bookable while payments are off; with Pi on → escrow held → released / refund_due", async () => {
  NOW = Date.parse("2027-01-03T06:00:00Z");
  const pg = await other.req("GET", "/api/mentors/mt_mentor"); assert.equal(pg.mentor.paid, true); assert.equal(pg.mentor.bookable, false); assert.match(pg.me.why, /تفعيل مدفوعات Pi/);
  const off = await other.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-11T15:00:00.000Z" }); assert.equal(off.status, 501); assert.equal(off.code, "not_configured");
  const pis = H.app.ctx.services.pi, en = pis.enabled, ci = pis.createIntent; let n = 0;
  pis.enabled = () => true; pis.createIntent = async (u, b) => ({ id: "pitx_mt" + ++n, amount: b.amount, memo: b.memo, metadata: { purpose: b.purpose } });
  try {
    const b = await other.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-11T15:00:00.000Z" }); assert.equal(b.status, 200, b.error);
    assert.equal(b.intent.amount, 3); assert.equal(b.session.payStatus, "pending"); assert.ok(b.session.actions.includes("pay"));
    assert.equal((await mentor.req("POST", `/api/mentor-sessions/${b.session.id}/confirm`)).status, 409); // not paid yet
    H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { tx: b.intent.id, purpose: "mentor", amount: 3 }); await M().settle();
    let s = await db().get("SELECT * FROM mentor_sessions WHERE id=$1", [b.session.id]); assert.equal(s.pay_status, "held");
    const held = await db().get("SELECT SUM(credit)-SUM(debit) n FROM ledger_entries WHERE account='platform:held'"); assert.equal(Number(held.n), 3e7);
    await mentor.req("POST", `/api/mentor-sessions/${b.session.id}/confirm`);
    NOW = Date.parse("2027-01-11T16:00:00Z");
    await mentor.req("POST", `/api/mentor-sessions/${b.session.id}/complete`);
    s = await db().get("SELECT * FROM mentor_sessions WHERE id=$1", [b.session.id]); assert.equal(s.pay_status, "released");
    const earn = await db().get("SELECT SUM(credit)-SUM(debit) n FROM ledger_entries WHERE account=$1", ["creator:" + mentor.id + ":earnings"]); assert.equal(Number(earn.n), 3e7 - Number(s.fee));
    assert.equal((await H.app.ctx.services.tips.ledgerCheck()).ok ?? true, true);
    // cancellation of a held payment → reversed, refund_due for staff
    NOW = Date.parse("2027-01-03T06:00:00Z");
    const b2 = await other.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T15:00:00.000Z" }); assert.equal(b2.status, 200, b2.error);
    H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { tx: b2.intent.id, purpose: "mentor", amount: 3 }); await M().settle();
    await mentor.req("POST", `/api/mentor-sessions/${b2.session.id}/decline`, {});
    s = await db().get("SELECT * FROM mentor_sessions WHERE id=$1", [b2.session.id]); assert.equal(s.pay_status, "refund_due"); assert.equal(s.status, "cancelled");
    const held2 = await db().get("SELECT SUM(credit)-SUM(debit) n FROM ledger_entries WHERE account='platform:held'"); assert.equal(Number(held2.n), 0);
    assert.equal((await adminC.req("GET", "/api/admin/mentors")).refunds.length, 1);
    // amount mismatch is ignored
    const b3 = await other.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T16:00:00.000Z" });
    H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { tx: b3.intent.id, purpose: "mentor", amount: 1 }); await M().settle();
    assert.equal((await db().get("SELECT pay_status FROM mentor_sessions WHERE id=$1", [b3.session.id])).pay_status, "pending");
    H.app.ctx.bus.emit("PI_PAYMENT_CANCELLED", { tx: b3.intent.id, purpose: "mentor" }); await M().settle();
    assert.equal((await db().get("SELECT status FROM mentor_sessions WHERE id=$1", [b3.session.id])).status, "cancelled");
  } finally { pis.enabled = en; pis.createIntent = ci; }
  await mentor.req("PUT", "/api/mentor/me", { price: 0 });
});

test("job: reminders once, unconfirmed sessions expire; staff suspend cancels upcoming + audit", async () => {
  NOW = Date.parse("2027-01-03T06:00:00Z");
  const a = await learner.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T15:00:00.000Z" }); assert.equal(a.status, 200, a.error);
  const b = await learner.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-04T16:00:00.000Z" }); assert.equal(b.status, 200, b.error);
  await mentor.req("POST", `/api/mentor-sessions/${a.session.id}/confirm`);
  NOW = Date.parse("2027-01-04T14:30:00Z");
  assert.deepEqual(await M().tick(), { reminded: 1, expired: 0 });
  assert.deepEqual(await M().tick(), { reminded: 0, expired: 0 });
  assert.ok((await kinds(learner.id)).includes("mentor_reminder"));
  NOW = Date.parse("2027-01-04T16:01:00Z");
  assert.equal((await M().tick()).expired, 1);
  assert.equal((await db().get("SELECT status FROM mentor_sessions WHERE id=$1", [b.session.id])).status, "cancelled");
  // suspend
  NOW = Date.parse("2027-01-03T06:00:00Z");
  const c = await learner.req("POST", "/api/mentors/mt_mentor/book", { startsAt: "2027-01-10T07:00:00.000Z" }); assert.equal(c.status, 200, c.error);
  assert.equal((await learner.req("GET", "/api/admin/mentors")).status, 403);
  assert.equal((await adminC.req("POST", `/api/admin/mentors/${mentor.id}/status`, { status: "suspended" })).status, 400);
  const s = await adminC.req("POST", `/api/admin/mentors/${mentor.id}/status`, { status: "suspended", reason: "شكاوى متكررة" }); assert.equal(s.status, 200, s.error);
  assert.equal((await db().get("SELECT status FROM mentor_sessions WHERE id=$1", [c.session.id])).status, "cancelled");
  assert.equal((await learner.req("GET", "/api/mentors")).mentors.length, 0);
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "تعديل بعد الإيقاف" })).status, 403);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='mentor_suspended' AND target=$1", [mentor.id]));
  const v = await adminC.req("GET", "/api/admin/mentors"); assert.equal(v.totals.suspended, 1);
  await adminC.req("POST", `/api/admin/mentors/${mentor.id}/status`, { status: "active" });
  assert.equal((await learner.req("GET", "/api/mentors")).mentors.length, 1);
});

test("M1-1 auth audit: visitor 401 on every private route, ownership → 404, guardian only via active link, blocked → 404 / hidden", async () => {
  NOW = Date.parse("2027-01-03T06:00:00.000Z");
  const anon = new H.Client();
  // 1. visitor: every private route → 401 (public: directory, mentor page, slots)
  const priv = [["GET", "/api/mentors/match?topic=programming"], ["POST", "/api/mentors/mt_mentor/book"], ["GET", "/api/mentor/me"], ["PUT", "/api/mentor/me"], ["DELETE", "/api/mentor/me"], ["PUT", "/api/mentor/me/slots"],
    ["GET", "/api/mentor/requests"], ["POST", "/api/mentor/requests"], ["POST", "/api/mentor/requests/x/accept"], ["POST", "/api/mentor/requests/x/decline"], ["POST", "/api/mentor/requests/x/withdraw"],
    ["GET", "/api/mentor/sessions"], ["GET", "/api/mentor/feed"], ["POST", "/api/mentor/feed"], ["DELETE", "/api/mentor/feed"], ["GET", "/api/mentor-sessions/x"], ["GET", "/api/mentor-sessions/x/ics"],
    ...["confirm", "decline", "cancel", "complete", "no-show", "join", "pay"].map((a) => ["POST", `/api/mentor-sessions/x/${a}`]), ["PUT", "/api/mentor-sessions/x/note"], ["POST", "/api/mentor-sessions/x/feedback"],
    ["GET", "/api/admin/mentors"], ["POST", `/api/admin/mentors/${mentor.id}/status`]];
  for (const [m, u] of priv) assert.equal((await anon.req(m, u, m === "GET" || m === "DELETE" ? undefined : {})).status, 401, `${m} ${u}`);
  for (const u of ["/api/mentors", "/api/mentors/mt_mentor", "/api/mentors/mt_mentor/slots"]) assert.equal((await anon.req("GET", u)).status, 200, u);
  assert.equal((await learner.req("POST", `/api/admin/mentors/${mentor.id}/status`, { status: "suspended", reason: "اختبار" })).status, 403);

  // a fresh free mentor for this audit
  const m2 = await mk("mt_m2", "مرشد التدقيق"), l2 = await mk("mt_l2"), x = await mk("mt_x");
  assert.equal((await m2.req("PUT", "/api/mentor/me", { headline: "مرشد لتدقيق الصلاحيات", topics: ["design"], minutes: 30, tz: "Asia/Riyadh", allowMinors: true })).status, 200);
  assert.equal((await m2.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "21:00" }] })).status, 200);
  const bk = await l2.req("POST", "/api/mentors/mt_m2/book", { startsAt: "2027-01-04T15:00:00.000Z", topic: "design" }); assert.equal(bk.status, 200, bk.error);
  const s2 = bk.session.id;
  await l2.req("PUT", `/api/mentor-sessions/${s2}/note`, { body: "ملاحظة خاصة جداً" });

  // 2. ownership: a stranger gets 404 on every session route (view, ics, note, feedback, every action), never 403
  for (const [m, u, b] of [["GET", `/api/mentor-sessions/${s2}`], ["GET", `/api/mentor-sessions/${s2}/ics`], ["PUT", `/api/mentor-sessions/${s2}/note`, { body: "تسلل" }], ["POST", `/api/mentor-sessions/${s2}/feedback`, { rating: 5 }],
    ...["confirm", "decline", "cancel", "complete", "no-show", "join", "pay"].map((a) => ["POST", `/api/mentor-sessions/${s2}/${a}`, { reason: "تجربة" }])]) assert.equal((await x.req(m, u, b)).status, 404, `${m} ${u}`);
  assert.equal((await db().get("SELECT status FROM mentor_sessions WHERE id=$1", [s2])).status, "pending");
  assert.equal((await db().get("SELECT COUNT(*) n FROM mentor_notes WHERE session_id=$1", [s2])).n, 1);
  assert.ok(!(await x.req("GET", "/api/mentor/sessions")).sessions.some((s) => s.id === s2));
  assert.equal((await x.req("GET", "/api/mentor/sessions?role=family")).sessions.length, 0);
  // the other side never sees a private (unshared) note; staff see neither note
  assert.equal((await m2.req("GET", `/api/mentor-sessions/${s2}`)).session.sharedNote, null);
  const st = await adminC.req("GET", `/api/mentor-sessions/${s2}`); assert.equal(st.status, 200); assert.equal(st.session.myNote, null); assert.equal(st.session.sharedNote, null); assert.deepEqual(st.session.actions, []);
  // requests: someone else's request → 404 (withdraw), another mentor's direct request → 404 (was 403)
  const dr = await l2.req("POST", "/api/mentor/requests", { topic: "design", mentor: "mt_m2", goal: "أريد مراجعة لتصميم تطبيقي" }); assert.equal(dr.status, 200, dr.error);
  assert.equal((await x.req("POST", `/api/mentor/requests/${dr.request.id}/withdraw`)).status, 404);
  assert.equal((await mentor.req("POST", `/api/mentor/requests/${dr.request.id}/accept`)).status, 404);
  assert.equal((await mentor.req("POST", `/api/mentor/requests/${dr.request.id}/decline`)).status, 404);
  assert.equal((await db().get("SELECT status FROM mentor_requests WHERE id=$1", [dr.request.id])).status, "open");

  // 3. guardian: only an ACTIVE link opens a minor's session (view, family list, room); pending / revoked → 404
  const kid = await mk("mt_kid2"), par = await mk("mt_par2");
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
  try {
    const t = new Date().toISOString();
    await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_mt2',$1,$2,'pending',$1,'{}',$3)", [par.id, kid.id, t]);
    await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES('mss_aud',$1,$2,'design','','2027-01-04T17:00:00.000Z',30,'confirmed',0,0,'none',1,$3,$3)", [m2.id, kid.id, t]);
    assert.equal((await par.req("GET", "/api/mentor-sessions/mss_aud")).status, 404);
    assert.equal((await par.req("GET", "/api/mentor/sessions?role=family")).sessions.length, 0);
    await db().run("UPDATE guardian_links SET status='active' WHERE id='gl_mt2'");
    const gv = await par.req("GET", "/api/mentor-sessions/mss_aud"); assert.equal(gv.status, 200); assert.equal(gv.session.role, "guardian"); assert.equal(gv.session.myNote, null);
    assert.equal((await par.req("PUT", "/api/mentor-sessions/mss_aud/note", { body: "وليّ الأمر" })).status, 403); // guardian sees, never writes notes
    assert.equal((await par.req("POST", "/api/mentor-sessions/mss_aud/cancel", { reason: "إلغاء" })).status, 409);
    await db().run("UPDATE mentor_sessions SET room_id='room_aud' WHERE id='mss_aud'");
    assert.equal(await M().roomAccess("room_aud", par.id), true);
    await db().run("UPDATE guardian_links SET status='revoked' WHERE id='gl_mt2'");
    assert.equal((await par.req("GET", "/api/mentor-sessions/mss_aud")).status, 404);
    assert.equal((await par.req("GET", "/api/mentor-sessions/mss_aud/ics")).status, 404);
    assert.equal(await M().roomAccess("room_aud", par.id), false);
    assert.equal(await M().roomAccess("room_aud", x.id), false);
  } finally { H.app.ctx.services.minors.isMinorUser = real; await db().run("DELETE FROM mentor_sessions WHERE id='mss_aud'"); }

  // 4. blocked users (either direction, user_blocks or prefs): page + slots → 404, not listed, no booking / request / decision
  assert.ok((await x.req("GET", "/api/mentors")).mentors.some((m) => m.user.handle === "mt_m2"));
  const oreq = await x.req("POST", "/api/mentor/requests", { topic: "design", goal: "أبحث عن مرشد في التصميم" }); assert.equal(oreq.status, 200, oreq.error);
  await db().run("INSERT INTO user_blocks(owner,target,root,created_at) VALUES($1,$2,$2,$3)", [m2.id, x.id, new Date().toISOString()]);
  try {
    assert.equal((await x.req("GET", "/api/mentors/mt_m2")).status, 404);
    assert.equal((await x.req("GET", "/api/mentors/mt_m2/slots")).status, 404);
    assert.ok(!(await x.req("GET", "/api/mentors")).mentors.some((m) => m.user.handle === "mt_m2"));
    assert.ok(!(await x.req("GET", "/api/mentors?topic=design")).mentors.some((m) => m.user.handle === "mt_m2"));
    assert.equal((await x.req("POST", "/api/mentors/mt_m2/book", { startsAt: "2027-01-04T16:00:00.000Z" })).status, 403);
    assert.equal((await x.req("POST", "/api/mentor/requests", { topic: "design", mentor: "mt_m2", goal: "طلب من حساب محظور" })).status, 403);
    assert.ok(!(await m2.req("GET", "/api/mentor/requests")).open.some((r) => r.id === oreq.request.id));
    assert.equal((await m2.req("POST", `/api/mentor/requests/${oreq.request.id}/accept`)).status, 404);
    assert.equal((await db().get("SELECT status FROM mentor_requests WHERE id=$1", [oreq.request.id])).status, "open");
    // the mentor keeps her own page; staff still see it; signed-out visitors see the public page
    assert.equal((await m2.req("GET", "/api/mentors/mt_m2")).status, 200);
    assert.equal((await adminC.req("GET", "/api/mentors/mt_m2")).status, 200);
  } finally { await db().run("DELETE FROM user_blocks WHERE owner=$1", [m2.id]); }
  // legacy prefs.blocked list counts too (reverse direction: the learner blocked the mentor)
  const pr = await db().get("SELECT prefs FROM users WHERE id=$1", [x.id]); const prefs = typeof pr.prefs === "string" ? JSON.parse(pr.prefs || "{}") : pr.prefs || {};
  await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [JSON.stringify({ ...prefs, blocked: [m2.id] }), x.id]);
  try {
    assert.equal((await x.req("GET", "/api/mentors/mt_m2")).status, 404);
    assert.ok(!(await x.req("GET", "/api/mentors")).mentors.some((m) => m.user.handle === "mt_m2"));
  } finally { await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [JSON.stringify(prefs), x.id]); }
  assert.equal((await x.req("GET", "/api/mentors/mt_m2")).status, 200);
  // cleanup: leave nothing open that later tests could count
  await l2.req("POST", `/api/mentor-sessions/${s2}/cancel`, { reason: "نهاية التدقيق" });
  await m2.req("PUT", "/api/mentor/me", { open: false });
});

test("migration 051 reversible + additive; data map", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '051_mentors' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "051_mentors"]);
  await assert.rejects(() => db().get("SELECT 1 FROM mentor_sessions"));
  assert.deepEqual(await mig.up(db()), ["051_mentors", ...after]);
  const L = require("../lib/compliance-lib");
  for (const t of ["mentor_profiles", "mentor_slots", "mentor_requests", "mentor_sessions", "mentor_notes", "mentor_feedback", "mentor_feeds"]) { const m = L.DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [learner.id]); }
});
