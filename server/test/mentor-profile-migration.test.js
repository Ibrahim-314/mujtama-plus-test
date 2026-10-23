/* مسار الإرشاد M1-3 — migration 067_mentor_profile_ext: the four columns + the reviews index exist with the documented
 * defaults (visibility 'public' for an existing mentor, fields / extra / reviewed_at NULL), re-running up() is a no-op,
 * down() restores the v2.61 schema exactly and keeps every mentor row, up() again, the existing mentor API keeps working,
 * every captured statement is additive (verify-migrations rules). PG + SQLite (TEST_DATABASE_URL). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const mig = require("../lib/migrations");
const m067 = require("../migrations/067_mentor_profile_ext");

let H, mentor;
const db = () => H.app.ctx.db;
const NEW = ["visibility", "fields", "extra", "reviewed_at"];
async function cols(table) {
  if (db().dialect === "postgres") return (await db().all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
  return (await db().all(`PRAGMA table_info(${table})`)).map(r => r.name);
}
async function hasIndex(name) {
  if (db().dialect === "postgres") return !!(await db().get("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname=$1", [name]));
  return !!(await db().get("SELECT name FROM sqlite_master WHERE type='index' AND name=$1", [name]));
}
const exec = async (sql) => { for (const s of mig.render(sql, db().dialect).split(";").map(x => x.trim()).filter(Boolean)) await db().exec(s); };

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false } });
  H.app.ctx.rl.w.clear();
  mentor = new H.Client();
  const r = await mentor.req("POST", "/api/auth/register", { name: "مرشد الترحيل", handle: "mg67_mentor", password: "secret123" });
  assert.equal(r.status, 200, r.error); mentor.id = r.user.id;
  const p = await mentor.req("PUT", "/api/mentor/me", { headline: "مرشد برمجة منذ عشر سنوات", bio: "نبذة", topics: ["programming"], minutes: 45, tz: "Asia/Riyadh" });
  assert.equal(p.status, 200, p.error);
});
test.after(() => H.app.close());

test("067: columns + index exist with the documented defaults; constants match the plan", async () => {
  const c = await cols("mentor_profiles");
  for (const x of NEW) assert.ok(c.includes(x), x);
  assert.ok(await hasIndex("mentor_feedback_about_rating"));
  const row = await db().get("SELECT visibility, fields, extra, reviewed_at FROM mentor_profiles WHERE user_id=$1", [mentor.id]);
  assert.equal(row.visibility, "public", "existing / new mentors keep today's public behaviour");
  assert.equal(row.fields, null); assert.equal(row.extra, null); assert.equal(row.reviewed_at, null);
  assert.deepEqual([...m067.VISIBILITY], ["public", "members", "hidden"]);
  assert.equal(m067.VISIBILITY_DEFAULT, "public");
  assert.deepEqual([...m067.FIELD_LEVELS], ["public", "mentees", "off"]);
  const F = m067.FIELD_DEFAULTS;
  for (const k of ["age", "city", "communities"]) assert.equal(F[k], "off", k + " is opt-in");
  for (const k of ["photo", "experience", "qualifications"]) assert.equal(F[k], "public", k);
  assert.ok(Object.isFrozen(F));
  // JSON columns round-trip on both dialects
  await db().run("UPDATE mentor_profiles SET fields=$1, extra=$2 WHERE user_id=$3", [JSON.stringify({ age: "public" }), JSON.stringify({ skills: ["js"] }), mentor.id]);
  const back = await db().get("SELECT fields, extra FROM mentor_profiles WHERE user_id=$1", [mentor.id]);
  const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  assert.deepEqual(parse(back.fields), { age: "public" }); assert.deepEqual(parse(back.extra), { skills: ["js"] });
  await db().run("UPDATE mentor_profiles SET fields=NULL, extra=NULL WHERE user_id=$1", [mentor.id]);
});

test("067: up() twice is a no-op, down() restores v2.61 exactly (rows kept), up() again, mentor API still works", async () => {
  const before = await cols("mentor_profiles");
  await m067.up(db(), exec); // guarded ALTERs + IF NOT EXISTS → nothing fails, nothing changes
  assert.deepEqual(await cols("mentor_profiles"), before);
  const n0 = Number((await db().get("SELECT COUNT(*) n FROM mentor_profiles")).n);
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '067_mentor_profile_ext' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "067_mentor_profile_ext"]);
  const after = await cols("mentor_profiles");
  for (const x of NEW) assert.ok(!after.includes(x), x + " dropped");
  assert.deepEqual(after, before.filter(x => !NEW.includes(x)), "v2.61 columns, same order");
  assert.ok(!(await hasIndex("mentor_feedback_about_rating")));
  assert.ok(await hasIndex("mentor_feedback_about"), "051's index untouched");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mentor_profiles")).n), n0, "no mentor row lost");
  assert.equal((await db().get("SELECT headline FROM mentor_profiles WHERE user_id=$1", [mentor.id])).headline, "مرشد برمجة منذ عشر سنوات");
  await m067.down(db(), exec); // down twice is safe too
  assert.deepEqual(await mig.up(db()), ["067_mentor_profile_ext", ...later]);
  assert.deepEqual(await cols("mentor_profiles"), before);
  assert.equal((await db().get("SELECT visibility FROM mentor_profiles WHERE user_id=$1", [mentor.id])).visibility, "public", "re-added column backfills the default");
  H.app.ctx.rl.w.clear();
  const me = await mentor.req("GET", "/api/mentor/me");
  assert.equal(me.status, 200, me.error);
  const dir = await new H.Client().req("GET", "/api/mentors");
  assert.equal(dir.status, 200, dir.error);
});

test("067: every statement is additive (verify-migrations rules, awaited capture) and the static check passes", async () => {
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.ok(!s.problems.some(p => p.startsWith("067")), s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "067_mentor_profile_ext.js"));
  const stmts = [], fake = { dialect: "postgres", exec: async (x) => stmts.push(x), run: async () => ({ changes: 0 }), all: async () => [], get: async () => undefined };
  await m067.up(fake, async (sql) => { for (const x of mig.render(sql, "postgres").split(";").map(y => y.trim()).filter(Boolean)) stmts.push(x); });
  assert.equal(stmts.length, 5, "4 ALTERs + 1 index: " + stmts.join(" | "));
  assert.ok(stmts.some(x => /ADD COLUMN fields JSONB$/.test(x)) && stmts.some(x => /ADD COLUMN reviewed_at TIMESTAMPTZ$/.test(x)));
  for (const one of stmts.map(x => x.replace(/\s+/g, " ").trim())) {
    const add = /^ALTER TABLE \w+ ADD COLUMN \w+ (.*)$/i.exec(one);
    const ok = (add && (!/NOT NULL/i.test(add[1]) || /DEFAULT/i.test(add[1]))) || /^CREATE (UNIQUE )?INDEX IF NOT EXISTS \w+ ON \w+ ?\(/i.test(one);
    assert.ok(ok && !/\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i.test(one), "additive: " + one);
  }
});
