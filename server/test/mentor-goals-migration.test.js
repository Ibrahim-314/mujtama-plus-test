/* مسار الإرشاد M3-1 — migration 068_mentor_goals: mentor_goals table + (mentor_id, mentee_id) index + nullable
 * mentor_sessions.agenda exist with the documented defaults, the CHECK backstops hold, re-running up() is a no-op,
 * down() restores the v2.64 schema exactly (every session row kept), up() again, the existing mentor API keeps working,
 * every captured statement is additive (verify-migrations rules). PG + SQLite (TEST_DATABASE_URL). */
const test = require("node:test"), assert = require("node:assert");
const crypto = require("node:crypto");
const { boot } = require("./helpers");
const mig = require("../lib/migrations");
const m068 = require("../migrations/068_mentor_goals");

let H, mentor, mentee;
const db = () => H.app.ctx.db;
const GOAL_COLS = ["id", "mentor_id", "mentee_id", "title", "status", "due_date", "created_at", "updated_at"];
async function cols(table) {
  if (db().dialect === "postgres") return (await db().all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
  return (await db().all(`PRAGMA table_info(${table})`)).map(r => r.name);
}
async function hasIndex(name) {
  if (db().dialect === "postgres") return !!(await db().get("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname=$1", [name]));
  return !!(await db().get("SELECT name FROM sqlite_master WHERE type='index' AND name=$1", [name]));
}
async function hasTable(name) {
  if (db().dialect === "postgres") return !!(await db().get("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name=$1", [name]));
  return !!(await db().get("SELECT name FROM sqlite_master WHERE type='table' AND name=$1", [name]));
}
const exec = async (sql) => { for (const s of mig.render(sql, db().dialect).split(";").map(x => x.trim()).filter(Boolean)) await db().exec(s); };
const now = () => new Date().toISOString();
const insGoal = (o = {}) => db().run("INSERT INTO mentor_goals (id, mentor_id, mentee_id, title, status, due_date, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
  [o.id || crypto.randomUUID(), mentor.id, mentee.id, o.title ?? "هدف", o.status ?? "todo", o.due ?? null, now(), now()]);
const SESSION_ID = "mg68_session";

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false } });
  H.app.ctx.rl.w.clear();
  mentor = new H.Client(); mentee = new H.Client();
  let r = await mentor.req("POST", "/api/auth/register", { name: "مرشد الأهداف", handle: "mg68_mentor", password: "secret123" });
  assert.equal(r.status, 200, r.error); mentor.id = r.user.id;
  r = await mentee.req("POST", "/api/auth/register", { name: "متعلم الأهداف", handle: "mg68_mentee", password: "secret123" });
  assert.equal(r.status, 200, r.error); mentee.id = r.user.id;
  const p = await mentor.req("PUT", "/api/mentor/me", { headline: "مرشد أهداف وخطط", bio: "نبذة", topics: ["programming"], minutes: 45, tz: "Asia/Riyadh" });
  assert.equal(p.status, 200, p.error);
  await db().run("INSERT INTO mentor_sessions (id, mentor_id, learner_id, topic, starts_at, minutes, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [SESSION_ID, mentor.id, mentee.id, "programming", now(), 45, now(), now()]);
});
test.after(() => H.app.close());

test("068: table + index + agenda column exist with the documented defaults; constants match the plan", async () => {
  assert.ok(await hasTable("mentor_goals"));
  assert.deepEqual(await cols("mentor_goals"), GOAL_COLS);
  assert.ok(await hasIndex("mentor_goals_pair"));
  assert.ok((await cols("mentor_sessions")).includes("agenda"));
  assert.equal((await db().get("SELECT agenda FROM mentor_sessions WHERE id=$1", [SESSION_ID])).agenda, null, "existing sessions: no agenda");
  assert.deepEqual([...m068.STATUS], ["todo", "doing", "done"]);
  assert.equal(m068.STATUS_DEFAULT, "todo"); assert.equal(m068.TITLE_MAX, 120);
  assert.ok(Object.isFrozen(m068.STATUS));
  // defaults: status todo, due_date NULL
  await db().run("INSERT INTO mentor_goals (id, mentor_id, mentee_id, title, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)", ["g_def", mentor.id, mentee.id, "أنهي الدرس الأول", now(), now()]);
  const g = await db().get("SELECT status, due_date FROM mentor_goals WHERE id=$1", ["g_def"]);
  assert.equal(g.status, "todo"); assert.equal(g.due_date, null);
  // CHECK backstops: bad status, empty / over-long title rejected; exactly 120 Arabic chars accepted
  await assert.rejects(insGoal({ status: "blocked" }));
  await assert.rejects(insGoal({ title: "" }));
  await assert.rejects(insGoal({ title: "ه".repeat(121) }));
  await insGoal({ id: "g_120", title: "ه".repeat(120), status: "doing", due: "2026-12-31" });
  assert.equal((await db().get("SELECT due_date FROM mentor_goals WHERE id='g_120'")).due_date, "2026-12-31");
  // agenda JSON round-trips on both dialects
  await db().run("UPDATE mentor_sessions SET agenda=$1 WHERE id=$2", [JSON.stringify({ items: ["مراجعة"], goals: ["g_120"] }), SESSION_ID]);
  const a = (await db().get("SELECT agenda FROM mentor_sessions WHERE id=$1", [SESSION_ID])).agenda;
  assert.deepEqual(typeof a === "string" ? JSON.parse(a) : a, { items: ["مراجعة"], goals: ["g_120"] });
  await db().run("UPDATE mentor_sessions SET agenda=NULL WHERE id=$1", [SESSION_ID]);
});

test("068: up() twice is a no-op, down() restores v2.64 exactly (sessions kept), up() again, mentor API still works", async () => {
  const before = await cols("mentor_sessions");
  await m068.up(db(), exec);
  assert.deepEqual(await cols("mentor_sessions"), before);
  assert.deepEqual(await cols("mentor_goals"), GOAL_COLS);
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM mentor_goals")).n) >= 2, "re-run keeps goals");
  const n0 = Number((await db().get("SELECT COUNT(*) n FROM mentor_sessions")).n);
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '068_mentor_goals' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "068_mentor_goals"]);
  const after = await cols("mentor_sessions");
  assert.ok(!after.includes("agenda"));
  assert.deepEqual(after, before.filter(x => x !== "agenda"), "v2.64 columns, same order");
  assert.ok(!(await hasTable("mentor_goals"))); assert.ok(!(await hasIndex("mentor_goals_pair")));
  assert.ok(await hasIndex("mentor_sessions_mentor"), "051's indexes untouched");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mentor_sessions")).n), n0, "no session row lost");
  assert.equal((await db().get("SELECT topic FROM mentor_sessions WHERE id=$1", [SESSION_ID])).topic, "programming");
  await m068.down(db(), exec); // down twice is safe
  assert.deepEqual(await mig.up(db()), ["068_mentor_goals", ...later]);
  assert.deepEqual(await cols("mentor_sessions"), before);
  assert.deepEqual(await cols("mentor_goals"), GOAL_COLS);
  assert.ok(await hasIndex("mentor_goals_pair"));
  H.app.ctx.rl.w.clear();
  const me = await mentor.req("GET", "/api/mentor/me");
  assert.equal(me.status, 200, me.error);
  const dir = await new H.Client().req("GET", "/api/mentors");
  assert.equal(dir.status, 200, dir.error);
});

test("068: every statement is additive (verify-migrations rules, awaited capture) and the static check passes", async () => {
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.ok(!s.problems.some(p => p.startsWith("068")), s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "068_mentor_goals.js"));
  const stmts = [], fake = { dialect: "postgres", exec: async (x) => stmts.push(x), run: async () => ({ changes: 0 }), all: async () => [], get: async () => undefined };
  await m068.up(fake, async (sql) => { for (const x of mig.render(sql, "postgres").split(";").map(y => y.trim()).filter(Boolean)) stmts.push(x); });
  assert.equal(stmts.length, 3, "1 table + 1 index + 1 ALTER: " + stmts.join(" | "));
  assert.ok(stmts.some(x => /ADD COLUMN agenda JSONB$/.test(x)));
  assert.ok(stmts.some(x => /created_at TIMESTAMPTZ NOT NULL/.test(x)));
  for (const one of stmts.map(x => x.replace(/\s+/g, " ").trim())) {
    const add = /^ALTER TABLE \w+ ADD COLUMN \w+ (.*)$/i.exec(one);
    const ok = (add && (!/NOT NULL/i.test(add[1]) || /DEFAULT/i.test(add[1]))) || /^CREATE TABLE IF NOT EXISTS \w+ ?\(/i.test(one) || /^CREATE (UNIQUE )?INDEX IF NOT EXISTS \w+ ON \w+ ?\(/i.test(one);
    assert.ok(ok && !/\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i.test(one), "additive: " + one);
  }
});
