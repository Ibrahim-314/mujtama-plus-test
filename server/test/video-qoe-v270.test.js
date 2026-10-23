/* v2.70 — video quality-of-experience: POST /api/video/qoe (signed-in, batch ≤ 20, validated/clamped, rate-limited,
 * beacon-friendly without the CSRF header, analytics consent respected, no PII beyond user id), staff report
 * GET /api/admin/video/qoe (401 visitor, 403 member, p50/p90 startup, stall rate, avg watched, per-day counts),
 * 30-day prune, data-map entry, migration 071 additive + down/up. PG + SQLite (TEST_DATABASE_URL). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const mig = require("../lib/migrations");
const m071 = require("../migrations/071_video_qoe");

let H, admin, mod, member, other;
const db = () => H.app.ctx.db;
const count = async () => Number((await db().get("SELECT COUNT(*) n FROM video_qoe")).n);
const ev = (o = {}) => ({ postId: "p_1", startupMs: 500, stalls: 0, stallMs: 0, watchedMs: 10000, rung: 2, source: "clips", ...o });
async function hasTable(name) {
  if (db().dialect === "postgres") return !!(await db().get("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name=$1", [name]));
  return !!(await db().get("SELECT name FROM sqlite_master WHERE type='table' AND name=$1", [name]));
}
async function cols(table) {
  if (db().dialect === "postgres") return (await db().all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1 ORDER BY ordinal_position", [table])).map(r => r.name);
  return (await db().all(`PRAGMA table_info(${table})`)).map(r => r.name);
}

test.before(async () => {
  H = await boot({ opsOpts: { noTimers: true } });
  admin = new H.Client(); mod = new H.Client(); member = new H.Client(); other = new H.Client();
  for (const [c, h] of [[admin, "qoe_admin"], [mod, "qoe_mod"], [member, "qoe_member"], [other, "qoe_other"]]) {
    const r = await c.req("POST", "/api/auth/register", { name: "مستخدم " + h, handle: h, password: "secret123" });
    assert.equal(r.status, 200, r.error); c.id = r.user.id;
  }
  await db().run("UPDATE users SET role='admin' WHERE handle='qoe_admin'");
  await db().run("UPDATE users SET role='moderator' WHERE handle='qoe_mod'");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("071: table + index exist, columns as documented, constants", async () => {
  assert.ok(await hasTable("video_qoe"));
  assert.deepEqual(await cols("video_qoe"), ["id", "user_id", "post_id", "source", "startup_ms", "stalls", "stall_ms", "watched_ms", "rung", "created_at"]);
  assert.deepEqual([...m071.SOURCES], ["clips", "post"]);
  assert.equal(m071.RETENTION_DAYS, 30); assert.equal(m071.BATCH_MAX, 20);
  assert.ok(!(await cols("video_qoe")).some(c => /ip|agent|device|email/i.test(c)), "no PII columns beyond user_id");
});

test("ingest: visitor 401; empty / oversized / non-array batch 400; invalid events dropped, others clamped and stored", async () => {
  const visitor = new H.Client();
  assert.equal((await visitor.req("POST", "/api/video/qoe", { events: [ev()] })).status, 401);
  assert.equal((await member.req("POST", "/api/video/qoe", { events: [] })).status, 400);
  assert.equal((await member.req("POST", "/api/video/qoe", { events: "x" })).status, 400);
  assert.equal((await member.req("POST", "/api/video/qoe", {})).status, 400);
  const big = await member.req("POST", "/api/video/qoe", { events: Array.from({ length: 21 }, () => ev()) });
  assert.equal(big.status, 400); assert.equal(big.code, "qoe_batch_too_large");
  const n0 = await count();
  const r = await member.req("POST", "/api/video/qoe", { events: [
    ev(), // ok
    ev({ source: "story" }), ev({ postId: "" }), ev({ postId: "a".repeat(65) }), ev({ postId: "<script>" }), ev({ startupMs: -5 }), ev({ startupMs: "abc" }),
    ev({ rung: 99 }), // clamped to 15
    ev({ startupMs: 9e9, watchedMs: 9e12, stalls: 5000, stallMs: 1e12, rung: null, source: "post" }), // clamped
    "nope", null, [1]
  ] });
  assert.equal(r.status, 200, r.error); assert.equal(r.stored, 3); assert.equal(r.rejected, 9);
  assert.equal(await count(), n0 + 3);
  const rows = await db().all("SELECT * FROM video_qoe WHERE user_id=$1 ORDER BY id", [member.id]);
  assert.equal(rows[0].post_id, "p_1"); assert.equal(Number(rows[0].rung), 2);
  assert.equal(Number(rows[1].rung), 15);
  assert.equal(Number(rows[2].startup_ms), m071.STARTUP_MAX); assert.equal(Number(rows[2].watched_ms), m071.MS_MAX);
  assert.equal(Number(rows[2].stalls), m071.STALLS_MAX); assert.equal(rows[2].rung, null); assert.equal(rows[2].source, "post");
  assert.ok(Object.keys(rows[0]).every(k => !/ip|agent/i.test(k)));
});

test("ingest: beacon works without the CSRF header (sendBeacon cannot set it), still needs the session cookie", async () => {
  const body = JSON.stringify({ events: [ev({ postId: "p_beacon" })] });
  const a = await fetch(H.base + "/api/video/qoe", { method: "POST", headers: { "Content-Type": "application/json", Cookie: member.cookie }, body });
  assert.equal(a.status, 200);
  const b = await fetch(H.base + "/api/video/qoe", { method: "POST", headers: { "Content-Type": "text/plain" }, body });
  assert.equal(b.status, 401);
});

test("ingest: rate limited per member", async () => {
  let last;
  for (let i = 0; i < 13; i++) last = await other.req("POST", "/api/video/qoe", { events: [ev({ postId: "p_rl" })] });
  assert.equal(last.status, 429);
  await db().run("DELETE FROM video_qoe WHERE post_id='p_rl'");
});

test("ingest: withdrawn analytics consent → accepted but nothing stored", async () => {
  const third = new H.Client();
  const reg = await third.req("POST", "/api/auth/register", { name: "بلا موافقة", handle: "qoe_noconsent", password: "secret123" });
  assert.equal(reg.status, 200, reg.error); third.id = reg.user.id;
  const c = await third.req("PUT", "/api/me/consents", { purposes: { analytics: false } });
  assert.equal(c.status, 200, c.error);
  assert.equal(await H.app.ctx.services.compliance.hasConsent(third.id, "analytics"), false);
  const n0 = await count();
  const r = await third.req("POST", "/api/video/qoe", { events: [ev({ postId: "p_noconsent" })] });
  assert.equal(r.status, 200); assert.equal(r.stored, 0); assert.equal(r.consent, false);
  assert.equal(await count(), n0);
});

test("report: 401 visitor, 403 member; admin + moderator get p50/p90, stall rate, avg watched, per-day counts", async () => {
  assert.equal((await new H.Client().req("GET", "/api/admin/video/qoe")).status, 401);
  assert.equal((await member.req("GET", "/api/admin/video/qoe")).status, 403);
  await db().run("DELETE FROM video_qoe");
  const at = new Date().toISOString(), old = new Date(Date.now() - 2 * 864e5).toISOString();
  const ins = (startup, stalls, stallMs, watched, source, when = at) => db().run("INSERT INTO video_qoe (user_id, post_id, source, startup_ms, stalls, stall_ms, watched_ms, rung, created_at) VALUES ($1,'p',$2,$3,$4,$5,$6,NULL,$7)", [member.id, source, startup, stalls, stallMs, watched, when]);
  for (let i = 1; i <= 10; i++) await ins(i * 100, i <= 3 ? 1 : 0, i <= 3 ? 1000 : 0, 9000, i <= 6 ? "clips" : "post");
  await ins(5000, 2, 4000, 1000, "post", old);
  await ins(100, 0, 0, 1000, "clips", new Date(Date.now() - 40 * 864e5).toISOString()); // outside every window
  const r = await admin.req("GET", "/api/admin/video/qoe?days=7");
  assert.equal(r.status, 200, r.error);
  assert.equal(r.days, 7); assert.equal(r.plays, 11);
  // startups: 100..1000 + 5000 → sorted 11 values; p50 = 6th = 600, p90 = ceil(9.9)=10th = 1000
  assert.equal(r.p50StartupMs, 600); assert.equal(r.p90StartupMs, 1000);
  assert.equal(r.stallRate, Math.round((4 / 11) * 1000) / 10);
  assert.equal(r.avgWatchedMs, Math.round((10 * 9000 + 1000) / 11));
  assert.equal(r.perDay.length, 7);
  assert.equal(r.perDay[6].day, at.slice(0, 10)); assert.equal(r.perDay[6].plays, 10);
  assert.equal(r.perDay[4].plays, 1); assert.equal(r.perDay[0].plays, 0); assert.equal(r.perDay[0].p50StartupMs, null);
  assert.equal(r.bySource.clips.plays, 6); assert.equal(r.bySource.post.plays, 5);
  assert.equal(r.bySource.clips.p50StartupMs, 300);
  const today = await mod.req("GET", "/api/admin/video/qoe?days=1");
  assert.equal(today.status, 200); assert.equal(today.plays, 10); assert.equal(today.perDay.length, 1);
  const clamp = await admin.req("GET", "/api/admin/video/qoe?days=999");
  assert.equal(clamp.days, 30); assert.equal(clamp.plays, 11, "40-day-old row is outside the 30-day window");
  const bad = await admin.req("GET", "/api/admin/video/qoe?days=abc");
  assert.equal(bad.days, 7);
});

test("retention: prune drops rows older than 30 days only; data map lists video_qoe (analytics, erase delete)", async () => {
  const n = await count();
  await H.app.ctx.services.observability.pruneQoe();
  assert.equal(await count(), n - 1);
  const m = require("../lib/compliance-lib").DATA_MAP.find(x => x.t === "video_qoe");
  assert.ok(m); assert.equal(m.purpose, "analytics"); assert.equal(m.erase, "delete");
  await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [member.id]); // columns exist
});

test("071: additive statements, down() drops only video_qoe, up() again, ingest works", async () => {
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.ok(!s.problems.some(p => p.startsWith("071")), s.problems.join("\n"));
  const stmts = [];
  await m071.up({ dialect: "postgres" }, async (sql) => { for (const x of mig.render(sql, "postgres").split(";").map(y => y.trim()).filter(Boolean)) stmts.push(x); });
  assert.equal(stmts.length, 2);
  assert.ok(stmts.every(x => !/\{\w+\}/.test(x) && !/\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT|ALTER)\b/i.test(x)));
  assert.match(stmts[0], /id BIGSERIAL PRIMARY KEY/); assert.match(stmts[0], /created_at TIMESTAMPTZ NOT NULL/);
  const users = Number((await db().get("SELECT COUNT(*) n FROM users")).n);
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '071_video_qoe' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "071_video_qoe"]);
  assert.ok(!(await hasTable("video_qoe")));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM users")).n), users, "no other data touched");
  await m071.down(db(), async (sql) => { for (const x of mig.render(sql, db().dialect).split(";").map(y => y.trim()).filter(Boolean)) await db().exec(x); }); // twice is safe
  assert.deepEqual(await mig.up(db()), ["071_video_qoe", ...later]);
  assert.ok(await hasTable("video_qoe")); assert.equal(await count(), 0);
  const r = await member.req("POST", "/api/video/qoe", { events: [ev()] });
  assert.equal(r.status, 200, r.error); assert.equal(r.stored, 1);
});
