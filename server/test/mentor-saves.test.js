/* M4-3/M4-4 (F9) «مطوّر حفظ المرشدين وتنبيه المواعيد» — save / unsave a mentor (idempotent, never self, signed-in only),
 *  own list, notify_slots toggle, and the new-slot notice: one mentor_slots notification per saver per 24 h, none when the
 *  saver turned it off, minors only for mentors they may book, and the notice never carries private profile fields. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const N = require("../lib/notify-lib");

let H, T = Date.UTC(2027, 0, 3, 6);
let mentor, kidsMentor, learner, other, kid, stranger;
const db = () => H.app.ctx.db;
const SECRET_BIO = "نبذة-خاصة-للمتعلمين-فقط";
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const minors = new Set(); let realIs, realIds;
const alerts = (uid) => db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='mentor_slots' ORDER BY created_at", [uid]);
const slots = (c, list) => c.req("PUT", "/api/mentor/me/slots", { slots: list });

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => T } });
  mentor = await mk("ms_mentor", "سارة"); kidsMentor = await mk("ms_kmentor", "هدى"); learner = await mk("ms_learner", "فهد");
  other = await mk("ms_other"); kid = await mk("ms_kid", "ريم"); stranger = await mk("ms_x");
  const ms = H.app.ctx.services.minors; realIs = ms.isMinorUser; realIds = ms.minorIds;
  ms.isMinorUser = async (uid) => minors.has(uid) || (await realIs(uid));
  if (realIds) ms.minorIds = async (ids) => { const out = new Set(await realIds(ids)); for (const i of ids || []) if (minors.has(i)) out.add(i); return out; };
  minors.add(kid.id);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,'active',$2,'{}',$4)", ["gl_ms", stranger.id, kid.id, new Date(T).toISOString()]);
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "مرشدة خبيرة في البرمجة", bio: SECRET_BIO, topics: ["programming"], minutes: 60, tz: "Asia/Riyadh" })).status, 200);
  assert.equal((await slots(mentor, [{ weekday: 1, start: "18:00", end: "20:00" }])).status, 200);
  assert.equal((await kidsMentor.req("PUT", "/api/mentor/me", { headline: "مرشدة للناشئة في الرياضيات", topics: ["math"], minutes: 30, tz: "Asia/Riyadh", allowMinors: true })).status, 200);
  assert.equal((await slots(kidsMentor, [{ weekday: 2, start: "17:00", end: "18:00" }])).status, 200);
});
test.after(() => { const ms = H.app.ctx.services.minors; ms.isMinorUser = realIs; if (realIds) ms.minorIds = realIds; return H.app.close(); });
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("visitor gets 401 on every saves endpoint", async () => {
  const v = new H.Client();
  assert.equal((await v.req("POST", "/api/mentors/ms_mentor/save")).status, 401);
  assert.equal((await v.req("DELETE", "/api/mentors/ms_mentor/save")).status, 401);
  assert.equal((await v.req("GET", "/api/mentor/saved")).status, 401);
  assert.equal((await v.req("PUT", "/api/mentor/saved/ms_mentor", { notify: false })).status, 401);
});

test("save is idempotent, self is refused, unknown is 404, page + directory reflect it", async () => {
  let r = await learner.req("POST", "/api/mentors/ms_mentor/save"); assert.equal(r.status, 200, r.error); assert.deepEqual([r.saved, r.notifySlots], [true, true]);
  r = await learner.req("POST", "/api/mentors/@ms_mentor/save"); assert.equal(r.status, 200); // twice → still one row
  r = await learner.req("POST", `/api/mentors/${mentor.id}/save`); assert.equal(r.status, 200); // by id too
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mentor_saves WHERE user_id=$1", [learner.id])).n), 1);
  r = await mentor.req("POST", "/api/mentors/ms_mentor/save"); assert.equal(r.status, 400); assert.equal(r.code, "self");
  assert.equal((await learner.req("POST", "/api/mentors/nobody_here/save")).status, 404);
  assert.equal((await learner.req("POST", "/api/mentors/ms_other/save")).status, 404); // a member without a mentor profile
  const pg = await learner.req("GET", "/api/mentors/ms_mentor"); assert.equal(pg.me.saved, true); assert.equal(pg.me.notifySlots, true); assert.equal(pg.me.canSave, true);
  const dir = await learner.req("GET", "/api/mentors"); assert.equal(dir.mentors.find((m) => m.user.handle === "ms_mentor").saved, true); assert.equal(dir.mentors.find((m) => m.user.handle === "ms_kmentor").saved, false);
});

test("own list only; notify toggle; unsave idempotent", async () => {
  const l = await learner.req("GET", "/api/mentor/saved"); assert.equal(l.status, 200);
  assert.deepEqual(l.saved.map((x) => x.mentor.user.handle), ["ms_mentor"]); assert.equal(l.saved[0].notifySlots, true); assert.ok(l.saved[0].savedAt);
  assert.deepEqual((await other.req("GET", "/api/mentor/saved")).saved, []); // nobody sees another member's saves
  let r = await learner.req("PUT", "/api/mentor/saved/ms_mentor", { notify: false }); assert.equal(r.status, 200); assert.equal(r.notifySlots, false);
  assert.equal((await learner.req("GET", "/api/mentor/saved")).saved[0].notifySlots, false);
  assert.equal((await learner.req("PUT", "/api/mentor/saved/ms_mentor", { notify: "yes" })).status, 400);
  assert.equal((await other.req("PUT", "/api/mentor/saved/ms_mentor", { notify: true })).status, 404); // not saved by them
  assert.equal((await learner.req("PUT", "/api/mentor/saved/ms_mentor", { notify: true })).status, 200);
  r = await other.req("POST", "/api/mentors/ms_mentor/save"); assert.equal(r.status, 200);
  r = await other.req("DELETE", "/api/mentors/ms_mentor/save"); assert.equal(r.status, 200); assert.equal(r.saved, false);
  r = await other.req("DELETE", "/api/mentors/ms_mentor/save"); assert.equal(r.status, 200);
  assert.deepEqual((await other.req("GET", "/api/mentor/saved")).saved, []);
});

test("minor: may save only mentors they may book", async () => {
  let r = await kid.req("POST", "/api/mentors/ms_mentor/save"); assert.equal(r.status, 403); assert.equal(r.code, "minor_restricted");
  assert.equal((await kid.req("GET", "/api/mentors/ms_mentor")).me.canSave, false);
  r = await kid.req("POST", "/api/mentors/ms_kmentor/save"); assert.equal(r.status, 200, r.error);
});

test("new slot → one notice per saver per 24 h; off = none; no private fields; same grid = no notice", async () => {
  assert.equal((await other.req("POST", "/api/mentors/ms_mentor/save")).status, 200);
  assert.equal((await other.req("PUT", "/api/mentor/saved/ms_mentor", { notify: false })).status, 200);
  assert.equal((await slots(mentor, [{ weekday: 1, start: "18:00", end: "20:00" }])).status, 200); // unchanged grid
  assert.equal((await alerts(learner.id)).length, 0);
  assert.equal((await slots(mentor, [{ weekday: 1, start: "18:00", end: "20:00" }, { weekday: 3, start: "10:00", end: "12:00" }])).status, 200);
  const a = await alerts(learner.id); assert.equal(a.length, 1); assert.equal(a[0].ref, "ms_mentor"); assert.equal(a[0].actor, mentor.id);
  assert.equal((await alerts(other.id)).length, 0, "notify_slots off");
  assert.equal((await alerts(mentor.id)).length, 0);
  const c = await learner.req("GET", "/api/notifications?view=center&tab=all"); const txt = JSON.stringify(c);
  assert.ok(txt.includes("فتح سارة مواعيد إرشاد جديدة"), txt.slice(0, 500)); assert.ok(!txt.includes(SECRET_BIO));
  assert.equal(N.hrefFor({ kind: "mentor_slots", ref: "ms_mentor" }), "/#/mentor/ms_mentor");
  // another new period within 24 h → throttled
  T += 23 * 3600e3;
  assert.equal((await slots(mentor, [{ weekday: 1, start: "18:00", end: "20:00" }, { weekday: 4, start: "10:00", end: "12:00" }])).status, 200);
  assert.equal((await alerts(learner.id)).length, 1);
  // after 24 h → notified again
  T += 2 * 3600e3;
  assert.equal((await slots(mentor, [{ weekday: 1, start: "18:00", end: "20:00" }, { weekday: 5, start: "10:00", end: "12:00" }])).status, 200);
  assert.equal((await alerts(learner.id)).length, 2);
  // reopening a paused profile with its grid also counts (after the window)
  T += 25 * 3600e3;
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { open: false })).status, 200);
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { open: true })).status, 200);
  assert.equal((await alerts(learner.id)).length, 3);
});

test("minor saver: notice only while still allowed; blocked/hidden savers skipped", async () => {
  assert.equal((await slots(kidsMentor, [{ weekday: 2, start: "17:00", end: "18:00" }, { weekday: 6, start: "09:00", end: "10:00" }])).status, 200);
  assert.equal((await alerts(kid.id)).length, 1);
  T += 25 * 3600e3;
  assert.equal((await kidsMentor.req("PUT", "/api/mentor/me", { allowMinors: false })).status, 200);
  assert.equal((await slots(kidsMentor, [{ weekday: 0, start: "09:00", end: "10:00" }])).status, 200);
  assert.equal((await alerts(kid.id)).length, 1, "mentor no longer takes minors → no notice");
  const row = await db().get("SELECT last_notified_at FROM mentor_saves WHERE user_id=$1 AND mentor_id=$2", [kid.id, kidsMentor.id]);
  assert.ok(Date.parse(row.last_notified_at) < T - 24 * 3600e3, "skipped saver keeps its window");
});
