/* M1-2 — mentorship query efficiency: mentor page review-author minor checks are batched (one age_profiles query instead
 * of one per review), directory aggregates stay constant-count (no N+1), sessions() list is constant-count. Output must
 * be identical to the per-id path (minors.minorIds removed → legacy per-author isMinorUser loop). PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, mentor, learner; const reviewers = [];
const db = () => H.app.ctx.db;
const MIN = () => H.app.ctx.services.minors;
const iso = (ms) => new Date(ms).toISOString();
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
/** run fn while counting SQL statements (all + get + run) and those that read age_profiles / mentor tables */
const body = async (c, path) => { const r = await c.req("GET", path); assert.equal(r.status, 200, r.error); const { status: _s, headers: _h, ...j } = r; return j; };
const anon = () => new H.Client();
async function counted(fn) {
  const d = db(), orig = { all: d.all, get: d.get, run: d.run }, log = [];
  for (const k of Object.keys(orig)) d[k] = function (sql, ...rest) { log.push(String(sql)); return orig[k].call(this, sql, ...rest); };
  try { const out = await fn(); return { out, total: log.length, age: log.filter((s) => /age_profiles/.test(s)).length, log }; }
  finally { Object.assign(d, orig); }
}

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false } });
  mentor = await mk("pf_mentor", "مرشدة الأداء"); learner = await mk("pf_learner", "متعلّم الأداء");
  const p = await mentor.req("PUT", "/api/mentor/me", { headline: "مطوّرة ويب منذ عشر سنوات", bio: "أساعد المبتدئين", topics: ["programming"], minutes: 60, tz: "Asia/Riyadh", allowMinors: true });
  assert.equal(p.status, 200, p.error);
  assert.equal((await mentor.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "20:00" }] })).status, 200);
  // 8 reviewers, 3 of them minors by declared birth date (real minors path, no mocks)
  const now = Date.now(), year = new Date().getUTCFullYear();
  for (let i = 0; i < 8; i++) {
    const r = await mk("pf_rev" + i, "مراجع " + i); reviewers.push(r);
    const birth = i < 3 ? `${year - 15}-01-01` : `${year - 30}-01-01`;
    await db().run("INSERT INTO age_profiles(user_id,birth_date,updated_at) VALUES($1,$2,$3)", [r.id, birth, iso(now)]);
    const sid = "pf_s" + i;
    await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,topic,starts_at,minutes,status,minor,created_at,updated_at,completed_at) VALUES($1,$2,$3,'programming',$4,60,'completed',$5,$4,$4,$4)", [sid, mentor.id, r.id, iso(now - (i + 2) * 864e5), i < 3 ? 1 : 0]);
    await db().run("INSERT INTO mentor_feedback(session_id,by_user,about_user,rating,comment,created_at) VALUES($1,$2,$3,$4,$5,$6)", [sid, r.id, mentor.id, 1 + (i % 5), "تعليق " + i, iso(now - (i + 1) * 864e5)]);
  }
  // learner has upcoming + past sessions with the mentor for sessions()
  for (let i = 0; i < 4; i++) await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,topic,starts_at,minutes,status,created_at,updated_at) VALUES($1,$2,$3,'programming',$4,60,$5,$6,$6)", ["pf_l" + i, mentor.id, learner.id, iso(now + (i % 2 ? 1 : -1) * (i + 3) * 864e5), i % 2 ? "confirmed" : "completed", iso(now)]);
});
test.after(() => H.app.close());

test("mentorPage: minor review authors batched into ONE age_profiles query; output identical to per-author path", async () => {
  const batched = await counted(() => body(learner, "/api/mentors/pf_mentor"));
  // legacy path: hide minorIds so mentors.js falls back to one isMinorUser call per author
  const real = MIN().minorIds; MIN().minorIds = undefined;
  let legacy; try { legacy = await counted(() => body(learner, "/api/mentors/pf_mentor")); } finally { MIN().minorIds = real; }
  assert.deepEqual(batched.out, legacy.out, "same JSON");
  assert.equal(batched.out.reviews.length, 8);
  assert.equal(batched.out.reviews.filter((r) => r.by.name === "متعلّم" && !r.by.handle).length, 3, "3 minor authors masked");
  assert.ok(batched.out.reviews.filter((r) => r.by.handle).every((r) => !/^pf_rev[012]$/.test(r.by.handle)), "no minor handle leaks");
  // review-author checks: 1 batched query vs 8 (one per author). Plus viewer isMinor + bookBlock checks, identical in both.
  const other = legacy.age - 8;
  assert.equal(batched.age, other + 1, `age_profiles queries batched=${batched.age} legacy=${legacy.age}`);
  assert.equal(legacy.total - batched.total, 7);
  console.log(`# mentorPage queries: total ${legacy.total} → ${batched.total}, age_profiles ${legacy.age} → ${batched.age}`);
  // visitor view also identical
  const v1 = await body(anon(), "/api/mentors/pf_mentor"); MIN().minorIds = undefined;
  try { assert.deepEqual(v1, await body(anon(), "/api/mentors/pf_mentor")); } finally { MIN().minorIds = real; }
});

test("mentorPage: minorIds failure degrades like isMinor failure (nobody masked, no throw)", async () => {
  const real = MIN().minorIds; MIN().minorIds = async () => { throw new Error("db down"); };
  try { const pg = await body(anon(), "/api/mentors/pf_mentor"); assert.equal(pg.reviews.length, 8); } finally { MIN().minorIds = real; }
});

test("directory + sessions(): query count does not grow with rows (no N+1)", async () => {
  const d1 = await counted(() => body(learner, "/api/mentors"));
  assert.equal(d1.out.mentors.length, 1);
  // add 5 more mentors → same number of statements
  for (let i = 0; i < 5; i++) { const m = await mk("pf_m" + i); assert.equal((await m.req("PUT", "/api/mentor/me", { headline: "مرشد إضافي رقم " + i + " للتجربة", topics: ["programming"] })).status, 200); }
  const d2 = await counted(() => body(learner, "/api/mentors"));
  assert.equal(d2.out.mentors.length, 6); assert.equal(d2.total, d1.total, `directory ${d1.total} vs ${d2.total}`);
  const s1 = await counted(() => body(learner, "/api/mentor/sessions?when=past"));
  const s2 = await counted(() => body(mentor, "/api/mentor/sessions?when=past"));
  assert.ok(s2.out.sessions.length > s1.out.sessions.length);
  assert.equal(s1.total, s2.total, `sessions ${s1.total} vs ${s2.total}`);
  console.log(`# directory queries: ${d1.total} (1 mentor) = ${d2.total} (6 mentors); sessions(): ${s1.total} (${s1.out.sessions.length} rows) = ${s2.total} (${s2.out.sessions.length} rows)`);
});
