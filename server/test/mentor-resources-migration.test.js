/* مسار الإرشاد M4-1 — migration 069_mentor_resources_saves: mentor_resources + mentor_saves tables and their indexes
 * exist with the documented defaults, the CHECK backstops hold (https-only url, lengths, kinds, visibility, unique save),
 * re-running up() is a no-op, down() drops only what 069 created (every existing row kept), up() again, the mentor API
 * keeps working, every captured statement is additive (verify-migrations rules). PG + SQLite (TEST_DATABASE_URL). */
const test = require("node:test"), assert = require("node:assert");
const crypto = require("node:crypto");
const { boot } = require("./helpers");
const mig = require("../lib/migrations");
const m069 = require("../migrations/069_mentor_resources_saves");

let H, mentor, learner;
const db = () => H.app.ctx.db;
const RES_COLS = ["id", "mentor_id", "title", "url", "kind", "note", "visibility", "sort", "created_at", "updated_at"];
const SAVE_COLS = ["user_id", "mentor_id", "created_at", "notify_slots", "last_notified_at"];
async function cols(table) {
  if (db().dialect === "postgres") return (await db().all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1 ORDER BY ordinal_position", [table])).map(r => r.name);
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
const count = async (t) => Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n);
const insRes = (o = {}) => db().run("INSERT INTO mentor_resources (id, mentor_id, title, url, kind, note, visibility, sort, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
  [o.id || crypto.randomUUID(), mentor.id, o.title ?? "مرجع", "url" in o ? o.url : "https://example.com/a", o.kind ?? "link", o.note ?? null, o.visibility ?? "mentees", o.sort ?? 0, now(), now()]);
const SESSION_ID = "mr69_session";

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false } });
  H.app.ctx.rl.w.clear();
  mentor = new H.Client(); learner = new H.Client();
  let r = await mentor.req("POST", "/api/auth/register", { name: "مرشد الموارد", handle: "mr69_mentor", password: "secret123" });
  assert.equal(r.status, 200, r.error); mentor.id = r.user.id;
  r = await learner.req("POST", "/api/auth/register", { name: "متعلم يحفظ", handle: "mr69_learner", password: "secret123" });
  assert.equal(r.status, 200, r.error); learner.id = r.user.id;
  const p = await mentor.req("PUT", "/api/mentor/me", { headline: "مرشد مكتبة ومراجع", bio: "نبذة", topics: ["programming"], minutes: 45, tz: "Asia/Riyadh" });
  assert.equal(p.status, 200, p.error);
  await db().run("INSERT INTO mentor_sessions (id, mentor_id, learner_id, topic, starts_at, minutes, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [SESSION_ID, mentor.id, learner.id, "programming", now(), 45, now(), now()]);
  await db().run("INSERT INTO mentor_goals (id, mentor_id, mentee_id, title, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)", ["mr69_goal", mentor.id, learner.id, "هدف قائم", now(), now()]);
});
test.after(() => H.app.close());

test("069: tables + indexes exist with the documented defaults; constants match the plan", async () => {
  assert.ok(await hasTable("mentor_resources")); assert.ok(await hasTable("mentor_saves"));
  assert.deepEqual(await cols("mentor_resources"), RES_COLS);
  assert.deepEqual(await cols("mentor_saves"), SAVE_COLS);
  assert.ok(await hasIndex("mentor_resources_mentor")); assert.ok(await hasIndex("mentor_saves_mentor"));
  assert.deepEqual([...m069.KINDS], ["link", "file", "note"]);
  assert.deepEqual([...m069.VISIBILITY], ["mentees", "public"]);
  assert.equal(m069.VISIBILITY_DEFAULT, "mentees");
  assert.equal(m069.TITLE_MAX, 120); assert.equal(m069.URL_MAX, 500); assert.equal(m069.NOTE_MAX, 500);
  assert.equal(m069.URL_PREFIX, "https://"); assert.equal(m069.RESOURCES_MAX, 30);
  assert.ok(Object.isFrozen(m069.KINDS) && Object.isFrozen(m069.VISIBILITY));
  // resource defaults: visibility mentees, sort 0, note NULL
  await db().run("INSERT INTO mentor_resources (id, mentor_id, title, url, kind, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", ["r_def", mentor.id, "دليل البداية", "https://example.com/start", "link", now(), now()]);
  const r = await db().get("SELECT visibility, sort, note FROM mentor_resources WHERE id='r_def'");
  assert.equal(r.visibility, "mentees"); assert.equal(Number(r.sort), 0); assert.equal(r.note, null);
  // CHECK backstops
  await assert.rejects(insRes({ url: "http://example.com" }), "http rejected");
  await assert.rejects(insRes({ url: "javascript:alert(1)" }), "javascript: rejected");
  await assert.rejects(insRes({ url: "HTTPS://example.com" }), "prefix is case-sensitive on both dialects");
  await assert.rejects(insRes({ url: "https://" }), "bare scheme rejected");
  await assert.rejects(insRes({ url: "https://e.com/" + "a".repeat(500) }), "url > 500");
  await assert.rejects(insRes({ kind: "video" }));
  await assert.rejects(insRes({ visibility: "everyone" }));
  await assert.rejects(insRes({ title: "" }));
  await assert.rejects(insRes({ title: "م".repeat(121) }));
  await assert.rejects(insRes({ note: "ن".repeat(501) }));
  await assert.rejects(insRes({ kind: "link", url: null }), "link needs a url");
  await insRes({ id: "r_note", kind: "note", url: null, note: "ن".repeat(500), title: "م".repeat(120), visibility: "public", sort: 3 });
  await insRes({ id: "r_500", url: "https://e.com/" + "a".repeat(500 - 14), kind: "file" });
  // saves: default notify 1, last_notified_at NULL, (user, mentor) unique, notify only 0/1
  await db().run("INSERT INTO mentor_saves (user_id, mentor_id, created_at) VALUES ($1,$2,$3)", [learner.id, mentor.id, now()]);
  const s = await db().get("SELECT notify_slots, last_notified_at FROM mentor_saves WHERE user_id=$1 AND mentor_id=$2", [learner.id, mentor.id]);
  assert.equal(Number(s.notify_slots), 1); assert.equal(s.last_notified_at, null);
  await assert.rejects(db().run("INSERT INTO mentor_saves (user_id, mentor_id, created_at) VALUES ($1,$2,$3)", [learner.id, mentor.id, now()]), "duplicate save");
  await assert.rejects(db().run("INSERT INTO mentor_saves (user_id, mentor_id, created_at, notify_slots) VALUES ($1,$2,$3,$4)", [mentor.id, learner.id, now(), 2]));
  await db().run("INSERT INTO mentor_saves (user_id, mentor_id, created_at, notify_slots) VALUES ($1,$2,$3,0)", [mentor.id, learner.id, now()]);
  await db().run("UPDATE mentor_saves SET last_notified_at=$1 WHERE user_id=$2", [now(), learner.id]);
});

test("069: up() twice is a no-op, down() drops only 069 (existing rows kept), up() again, mentor API still works", async () => {
  const r0 = await count("mentor_resources"), s0 = await count("mentor_saves");
  await m069.up(db(), exec);
  assert.deepEqual(await cols("mentor_resources"), RES_COLS); assert.deepEqual(await cols("mentor_saves"), SAVE_COLS);
  assert.equal(await count("mentor_resources"), r0, "re-run keeps resources"); assert.equal(await count("mentor_saves"), s0, "re-run keeps saves");
  const n = { sessions: await count("mentor_sessions"), goals: await count("mentor_goals"), users: await count("users") };
  const sessCols = await cols("mentor_sessions");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '069_mentor_resources_saves' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "069_mentor_resources_saves"]);
  for (const t of ["mentor_resources", "mentor_saves"]) assert.ok(!(await hasTable(t)), t + " dropped");
  for (const i of ["mentor_resources_mentor", "mentor_saves_mentor"]) assert.ok(!(await hasIndex(i)), i + " dropped");
  assert.ok(await hasTable("mentor_goals") && await hasIndex("mentor_goals_pair"), "068 untouched");
  assert.ok(await hasIndex("mentor_sessions_mentor"), "051's indexes untouched");
  assert.deepEqual(await cols("mentor_sessions"), sessCols, "mentor_sessions columns unchanged");
  assert.deepEqual({ sessions: await count("mentor_sessions"), goals: await count("mentor_goals"), users: await count("users") }, n, "no existing row lost");
  assert.equal((await db().get("SELECT topic FROM mentor_sessions WHERE id=$1", [SESSION_ID])).topic, "programming");
  await m069.down(db(), exec); // down twice is safe
  assert.deepEqual(await mig.up(db()), ["069_mentor_resources_saves", ...later]);
  assert.deepEqual(await cols("mentor_resources"), RES_COLS); assert.deepEqual(await cols("mentor_saves"), SAVE_COLS);
  assert.ok(await hasIndex("mentor_resources_mentor") && await hasIndex("mentor_saves_mentor"));
  assert.equal(await count("mentor_resources"), 0); assert.equal(await count("mentor_saves"), 0);
  await db().run("INSERT INTO mentor_saves (user_id, mentor_id, created_at) VALUES ($1,$2,$3)", [learner.id, mentor.id, now()]); // usable again
  H.app.ctx.rl.w.clear();
  const me = await mentor.req("GET", "/api/mentor/me");
  assert.equal(me.status, 200, me.error);
  const dir = await new H.Client().req("GET", "/api/mentors");
  assert.equal(dir.status, 200, dir.error);
});

test("069: every statement is additive (verify-migrations rules, awaited capture) and the static check passes", async () => {
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.ok(!s.problems.some(p => p.startsWith("069")), s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "069_mentor_resources_saves.js"));
  const stmts = [], fake = { dialect: "postgres", exec: async (x) => stmts.push(x), run: async () => ({ changes: 0 }), all: async () => [], get: async () => undefined };
  await m069.up(fake, async (sql) => { for (const x of mig.render(sql, "postgres").split(";").map(y => y.trim()).filter(Boolean)) stmts.push(x); });
  assert.equal(stmts.length, 4, "2 tables + 2 indexes: " + stmts.join(" | "));
  assert.ok(stmts.every(x => !/\{\w+\}/.test(x)), "all placeholders rendered");
  assert.ok(stmts.some(x => /created_at TIMESTAMPTZ NOT NULL/.test(x) && /last_notified_at TIMESTAMPTZ/.test(x)));
  for (const one of stmts.map(x => x.replace(/\s+/g, " ").trim())) {
    const ok = /^CREATE TABLE IF NOT EXISTS \w+ ?\(/i.test(one) || /^CREATE (UNIQUE )?INDEX IF NOT EXISTS \w+ ON \w+ ?\(/i.test(one);
    assert.ok(ok && !/\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT|ALTER)\b/i.test(one), "additive: " + one);
  }
});
