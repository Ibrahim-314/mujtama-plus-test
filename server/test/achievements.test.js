/* v2.159 — unified achievement events (MJT readiness). record() is append-only and idempotent on (uid, type, ref); the table
 * has no amount / balance column and nothing is credited (no MJT tx, no points award); a failing record never breaks the
 * action that succeeded; the admin counts endpoint is 403 for members; migration 089 is additive and reversible. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, admin, m;
const db = () => H.app.ctx.db;
const S = () => H.app.ctx.services.achievements;
const clear = () => H.app.ctx.rl.w.clear();
const n = async (sql, p = []) => Number((await db().get(sql, p)).n);
const mk = async (handle) => {
  clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), c.id]);
  return c;
};
test.before(async () => { H = await boot(); admin = await mk("ach_admin"); m = await mk("ach_member"); });
test.after(() => H.app.close());
test.beforeEach(clear);

test("migration 089 is additive and reversible; the table has no amount or balance column", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '089_achievements' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "089_achievements"]);
  await assert.rejects(() => db().get("SELECT 1 FROM achievement_events"));
  assert.deepEqual(await mig.up(db()), ["089_achievements", ...later]);
  const cols = Object.keys((await db().get("SELECT * FROM achievement_events LIMIT 1")) || {});
  await db().run("INSERT INTO achievement_events(id,user_id,type,ref,created_at) VALUES('probe','u','team_created','r',$1)", [new Date().toISOString()]);
  const row = await db().get("SELECT * FROM achievement_events WHERE id='probe'");
  assert.deepEqual(Object.keys(row).sort(), ["created_at", "id", "meta", "ref", "type", "user_id"]); void cols;
  await db().run("DELETE FROM achievement_events WHERE id='probe'");
});

test("record is idempotent on (uid, type, ref) and rejects unknown types", async () => {
  assert.deepEqual(await S().record(m.id, "team_created", "t1"), { recorded: true });
  assert.equal((await S().record(m.id, "team_created", "t1")).recorded, false);
  assert.equal((await S().record(m.id, "team_created", "t2")).recorded, true);
  assert.equal((await S().record(m.id, "login", "x")).recorded, false, "only the listed milestone types");
  assert.equal((await S().record(m.id, "team_created", "")).recorded, false);
  await Promise.all(Array.from({ length: 8 }, () => S().record(m.id, "quiz_passed", "par")));
  assert.equal(await n("SELECT COUNT(*) n FROM achievement_events WHERE user_id=$1 AND type='quiz_passed' AND ref='par'", [m.id]), 1, "parallel records write once");
});

test("success paths emit once; nothing is credited (no MJT tx, no points award)", async () => {
  const tx0 = await n("SELECT COUNT(*) n FROM mjt_tx"), pa0 = await n("SELECT COUNT(*) n FROM points_awards");
  const col = await m.req("POST", "/api/collections", { name: "مجموعتي" }); assert.equal(col.status, 200, col.error);
  clear(); const ss = await m.req("POST", "/api/search/saved", { q: "بحث" }); assert.equal(ss.status, 200, ss.error);
  clear(); const t = await m.req("POST", "/api/teams", { name: "فريق الإنجاز" }); assert.equal(t.status, 200, t.error);
  await S().settle();
  const rows = await db().all("SELECT type, ref FROM achievement_events WHERE user_id=$1 AND type IN ('collection_created','saved_search_created','team_created') AND ref NOT IN ('t1','t2')", [m.id]);
  assert.deepEqual(rows.map((r) => r.type).sort(), ["collection_created", "saved_search_created", "team_created"]);
  assert.ok(rows.some((r) => r.ref === t.id));
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_tx"), tx0, "no MJT transaction"); assert.equal(await n("SELECT COUNT(*) n FROM points_awards"), pa0, "no points award");
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_accounts WHERE user_id=$1", [m.id]), 0, "no wallet / balance created");
});

test("a failing record never breaks the main action", async () => {
  const orig = S().record;
  S().record = async () => { throw new Error("db down"); };
  try {
    const col = await m.req("POST", "/api/collections", { name: "رغم العطل" }); assert.equal(col.status, 200, col.error);
    clear(); const ss = await m.req("POST", "/api/search/saved", { q: "رغم العطل" }); assert.equal(ss.status, 200, ss.error);
    await S().settle();
  } finally { S().record = orig; }
  S().record = () => { throw new Error("sync throw"); };
  try { clear(); const t = await m.req("POST", "/api/teams", { name: "فريق رغم العطل" }); assert.equal(t.status, 200, t.error); await S().settle(); }
  finally { S().record = orig; }
});

test("admin counts by type; members get 403, guests 401", async () => {
  const r = await admin.req("GET", "/api/admin/achievements"); assert.equal(r.status, 200, r.error);
  assert.ok(r.types.find((x) => x.type === "team_created").events >= 3); assert.ok(r.total >= 5);
  for (const x of r.types) assert.deepEqual(Object.keys(x).sort(), ["events", "members", "type"]);
  assert.equal((await m.req("GET", "/api/admin/achievements")).status, 403);
  assert.equal((await new H.Client().req("GET", "/api/admin/achievements")).status, 401);
});

test("an article publish is recorded; a plain post is not", async () => {
  clear(); const a = await m.req("POST", "/api/posts", { type: "article", title: "مقال عن الإنجاز", text: "نص المقال ".repeat(20) });
  clear(); const p = await m.req("POST", "/api/posts", { type: "post", text: "منشور عادي" });
  await S().settle();
  assert.equal(a.status, 200, a.error); assert.equal(await n("SELECT COUNT(*) n FROM achievement_events WHERE type='article_published' AND ref=$1", [a.post.id]), 1);
  if (p.status === 200) assert.equal(await n("SELECT COUNT(*) n FROM achievement_events WHERE type='article_published' AND ref=$1", [p.post.id]), 0);
  assert.ok(a.status === 200 || p.status === 200, "posting works: " + (a.error || p.error));
});
