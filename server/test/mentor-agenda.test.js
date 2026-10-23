/* M3-4 «مطوّر الأجندة» — session agenda API: GET/PUT /api/mentor-sessions/:id/agenda.
 *  - only the two participants read it; a minor's guardian reads it read-only; strangers/staff 404; visitors 401;
 *  - the learner sets ≤ 5 points (each ≤ 140 chars, non-empty) before the start only; ticks survive an edit of the same text;
 *  - the mentor only ticks (index + boolean) once the session is confirmed; cannot rewrite texts. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, NOW = Date.UTC(2027, 0, 3, 6, 0); // Sunday 09:00 Riyadh
let men, lea, kid, parent, stranger, adminC, sid, kidSid;
const db = () => H.app.ctx.db;
const MON18 = new Date(Date.UTC(2027, 0, 4, 15, 0)).toISOString(), MON19 = new Date(Date.UTC(2027, 0, 4, 16, 0)).toISOString(); // Mon 18:00 / 19:00 Riyadh
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const minors = new Set(); let realIs, realIds;
const url = (id) => `/api/mentor-sessions/${id}/agenda`;

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  men = await mk("ag_men", "مرشد الأجندة"); lea = await mk("ag_lea"); kid = await mk("ag_kid"); parent = await mk("ag_par"); stranger = await mk("ag_x"); adminC = await mk("ag_adm");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [adminC.id]);
  const ms = H.app.ctx.services.minors; realIs = ms.isMinorUser; realIds = ms.minorIds;
  ms.isMinorUser = async (uid) => minors.has(uid) || (await realIs(uid));
  if (realIds) ms.minorIds = async (ids) => { const out = new Set(await realIds(ids)); for (const i of ids || []) if (minors.has(i)) out.add(i); return out; };
  minors.add(kid.id);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_ag',$1,$2,'active',$1,'{}',$3)", [parent.id, kid.id, new Date().toISOString()]);
  assert.equal((await men.req("PUT", "/api/mentor/me", { headline: "مرشد خبير في البرمجة", topics: ["programming"], minutes: 60, tz: "Asia/Riyadh", allowMinors: true })).status, 200);
  assert.equal((await men.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "20:00" }] })).status, 200);
  let r = await lea.req("POST", "/api/mentors/ag_men/book", { startsAt: MON18 }); assert.equal(r.status, 200, r.error); sid = r.session.id;
  r = await kid.req("POST", "/api/mentors/ag_men/book", { startsAt: MON19 }); assert.equal(r.status, 200, r.error); kidSid = r.session.id;
});
test.after(() => { const ms = H.app.ctx.services.minors; ms.isMinorUser = realIs; if (realIds) ms.minorIds = realIds; return H.app.close(); });
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("read access: pair yes, guardian read-only, stranger/staff 404, visitor 401; empty by default", async () => {
  const a = await lea.req("GET", url(sid)); assert.equal(a.status, 200);
  assert.deepEqual(a.agenda.items, []); assert.equal(a.agenda.canEdit, true); assert.equal(a.agenda.canTick, false); assert.equal(a.agenda.max, 5); assert.equal(a.agenda.maxLen, 140);
  const m = await men.req("GET", url(sid)); assert.equal(m.status, 200); assert.equal(m.agenda.canEdit, false); assert.equal(m.agenda.canTick, false, "pending: no ticks yet");
  assert.equal((await stranger.req("GET", url(sid))).status, 404);
  assert.equal((await adminC.req("GET", url(sid))).status, 404, "staff do not read the pair's agenda");
  assert.equal((await new H.Client().req("GET", url(sid))).status, 401);
  const g = await parent.req("GET", url(kidSid)); assert.equal(g.status, 200); assert.equal(g.agenda.role, "guardian"); assert.equal(g.agenda.canEdit, false); assert.equal(g.agenda.canTick, false);
  assert.equal((await parent.req("GET", url(sid))).status, 404, "a guardian sees only the minor's sessions");
  assert.equal((await lea.req("GET", url("nope"))).status, 404);
});

test("learner writes: limits (≤5, ≤140, non-empty), normalised, stored as [{t,done}]", async () => {
  let r = await lea.req("PUT", url(sid), { items: ["1", "2", "3", "4", "5", "6"] }); assert.equal(r.status, 400);
  r = await lea.req("PUT", url(sid), { items: ["a".repeat(141)] }); assert.equal(r.status, 400);
  r = await lea.req("PUT", url(sid), { items: ["   "] }); assert.equal(r.status, 400);
  r = await lea.req("PUT", url(sid), { items: "x" }); assert.equal(r.status, 400);
  r = await lea.req("PUT", url(sid), { items: ["ب".repeat(140), "  مراجعة   السيرة\nالذاتية ", { t: "خطة التعلّم" }] }); assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.agenda.items.map((x) => x.t), ["ب".repeat(140), "مراجعة السيرة الذاتية", "خطة التعلّم"]);
  const row = await db().get("SELECT agenda FROM mentor_sessions WHERE id=$1", [sid]);
  const stored = typeof row.agenda === "string" ? JSON.parse(row.agenda) : row.agenda;
  assert.deepEqual(stored[1], { t: "مراجعة السيرة الذاتية", done: false });
  for (const c of [men, parent, stranger]) assert.ok([403, 404].includes((await c.req("PUT", url(sid), { items: ["x"] })).status));
  assert.equal((await parent.req("PUT", url(kidSid), { items: ["x"] })).status, 403, "guardian is read-only");
});

test("mentor ticks after confirm only; ticks survive same-text edits; learner locked after start; empty → NULL", async () => {
  assert.equal((await men.req("PUT", url(sid), { index: 0, done: true })).status, 403, "pending");
  assert.equal((await men.req("POST", `/api/mentor-sessions/${sid}/confirm`)).status, 200);
  assert.equal((await men.req("PUT", url(sid), { index: 9, done: true })).status, 400);
  assert.equal((await men.req("PUT", url(sid), { index: 1, done: "yes" })).status, 400);
  assert.equal((await men.req("PUT", url(sid), { items: ["تغيير"] })).status, 400, "mentor cannot rewrite");
  let r = await men.req("PUT", url(sid), { index: 1, done: true }); assert.equal(r.status, 200); assert.deepEqual(r.agenda.items.map((x) => x.done), [false, true, false]);
  r = await lea.req("GET", url(sid)); assert.equal(r.agenda.items[1].done, true, "learner sees the tick");
  r = await lea.req("PUT", url(sid), { items: ["مراجعة السيرة الذاتية", "نقطة جديدة"] }); assert.equal(r.status, 200);
  assert.deepEqual(r.agenda.items, [{ t: "مراجعة السيرة الذاتية", done: true }, { t: "نقطة جديدة", done: false }]);
  const saved = NOW; NOW = Date.parse(MON18) + 5 * 60e3;
  try {
    assert.equal((await lea.req("PUT", url(sid), { items: ["x"] })).status, 403, "locked after start");
    assert.equal((await lea.req("GET", url(sid))).agenda.canEdit, false);
    r = await men.req("PUT", url(sid), { index: 1, done: true }); assert.equal(r.status, 200, "ticks during the session");
  } finally { NOW = saved; }
  r = await lea.req("PUT", url(sid), { items: [] }); assert.equal(r.status, 200); assert.deepEqual(r.agenda.items, []);
  assert.equal((await db().get("SELECT agenda FROM mentor_sessions WHERE id=$1", [sid])).agenda, null);
});
