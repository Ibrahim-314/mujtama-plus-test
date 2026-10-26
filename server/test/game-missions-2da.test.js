/* Phase 2D-A — server-authoritative game missions (services/game.js + game-missions.js, migration 081_game_missions).
 * Auth, CSRF, unknown / locked missions, duplicate and concurrent claims, XP / level / chapter spoofing, forged story
 * flags, transaction rollback, the street save rules, migration up/down/up on disposable data, and proof that no MJT
 * moves. Runs on SQLite (default) and PostgreSQL (TEST_DATABASE_URL). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const m081 = require("../migrations/081_game_missions");
const mig = require("../lib/migrations");
const GM = require("../services/game-missions");

let H;
const db = () => H.app.ctx.db;
async function mk(handle, { player = true, aged = true } = {}) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "لاعب " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id;
  if (player) {
    assert.equal((await c.req("PUT", "/api/game/profile", { char: "hoodie", name: "Player " + handle.slice(-4) })).status, 200);
    if (aged) await db().run("UPDATE game_players SET created_at=$1 WHERE user_id=$2", [new Date(Date.now() - 60e3).toISOString(), c.id]); // played for a minute
  }
  return c;
}
const done = (c, id) => c.req("POST", `/api/game/missions/${id}/complete`, {});
const count = async (sql, p = []) => Number((await db().get(sql, p)).n);
const mjtSnapshot = async () => ({
  tx: await count("SELECT COUNT(*) n FROM mjt_tx"), entries: await count("SELECT COUNT(*) n FROM mjt_entries"),
  sum: Number((await db().get("SELECT COALESCE(SUM(balance),0) s FROM mjt_accounts WHERE kind<>'sys'"))?.s || 0)
});
async function hasTable(name) {
  if (db().dialect === "postgres") return !!(await db().get("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name=$1", [name]));
  return !!(await db().get("SELECT name FROM sqlite_master WHERE type='table' AND name=$1", [name]));
}
const exec = async (sql) => { for (const s of mig.render(sql, db().dialect).split(";").map((x) => x.trim()).filter(Boolean)) await db().exec(s); };

test.before(async () => { H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } }); });
test.after(() => H.app.close());

test("pure model: level curve and progress come from XP only", () => {
  assert.deepEqual([0, 99, 100, 299, 300, 600, 1000].map(GM.levelFor), [1, 1, 2, 2, 3, 4, 5]);
  assert.equal(GM.levelFor(-50), 1); assert.equal(GM.levelFor("abc"), 1);
  const p = GM.progressOf({ xp: 200, chapter: 1, level: 99 });
  assert.equal(p.level, 2, "level column is ignored, XP decides"); assert.equal(p.levelFrom, 100); assert.equal(p.levelTo, 300); assert.equal(p.pct, 50);
  for (const m of GM.MISSIONS) { assert.ok(GM.ID_RE.test(m.id), m.id); for (const r of m.requires) assert.ok(GM.BY_ID.has(r), r); assert.ok(["story", "server"].includes(m.verify)); }
});

test("unauthorized and CSRF: guests get 401, a request without the CSRF header gets 403, nothing is written", async () => {
  const g = new H.Client();
  assert.equal((await g.req("GET", "/api/game/missions")).status, 401);
  assert.equal((await g.req("POST", "/api/game/missions/c0.explore/complete", {})).status, 401);
  const a = await mk("gm2_csrf");
  const r = await a.req("POST", "/api/game/missions/c0.explore/complete", {}, { "X-Requested-With": "other" });
  assert.equal(r.status, 403);
  assert.equal(await count("SELECT COUNT(*) n FROM game_missions WHERE user_id=$1", [a.id]), 0);
  assert.equal((await a.req("GET", "/api/game/profile")).player.xp, 0);
});

test("unknown, malformed and locked missions; no character yet", async () => {
  const a = await mk("gm2_bad");
  for (const id of ["c9.nothing", "DROP TABLE", "c0.explore%27--", "x".repeat(60), "__proto__", "constructor"]) assert.equal((await done(a, encodeURIComponent(id))).status, 404, id);
  let r = await done(a, "c0.leave"); assert.equal(r.status, 409, "locked until c0.explore");
  r = await done(a, "c1.tower"); assert.equal(r.status, 409);
  const fresh = await mk("gm2_nochar", { player: false });
  assert.equal((await done(fresh, "c0.explore")).status, 409, "no game_players row → no_player");
  const quick = await mk("gm2_quick", { aged: false });
  assert.equal((await done(quick, "c0.explore")).status, 422, "story-flow minimum play time");
  assert.equal(await count("SELECT COUNT(*) n FROM game_missions WHERE user_id IN ($1,$2,$3)", [a.id, fresh.id, quick.id]), 0);
});

test("story order, fixed XP, level and chapter from the server; duplicate claims grant nothing", async () => {
  const a = await mk("gm2_flow");
  const before = await mjtSnapshot();
  let r = await done(a, "c0.explore");
  assert.equal(r.status, 200, r.error); assert.equal(r.completed, true); assert.equal(r.xpGained, 100);
  assert.equal(r.progress.xp, 100); assert.equal(r.progress.level, 2); assert.equal(r.progress.chapter, 0);
  r = await done(a, "c0.explore"); assert.equal(r.status, 200); assert.equal(r.already, true); assert.equal(r.xpGained, 0); assert.equal(r.progress.xp, 100, "a repeat grants no XP");
  r = await done(a, "c0.leave"); assert.equal(r.xpGained, 50); assert.equal(r.progress.chapter, 1, "c0.leave opens chapter 1");
  r = await done(a, "c1.tower"); assert.equal(r.xpGained, 150); assert.equal(r.progress.xp, 300); assert.equal(r.progress.level, 3);
  for (let i = 0; i < 5; i++) { r = await done(a, "c1.tower"); assert.equal(r.already, true); }
  const p = (await a.req("GET", "/api/game/profile")).player;
  assert.equal(p.xp, 300); assert.equal(p.level, 3); assert.equal(p.chapter, 1);
  const list = (await a.req("GET", "/api/game/missions")).missions;
  assert.deepEqual(list.filter((m) => m.done).map((m) => m.id).sort(), ["c0.explore", "c0.leave", "c1.tower"]);
  assert.equal(await count("SELECT COUNT(*) n FROM game_missions WHERE user_id=$1", [a.id]), 3);
  assert.deepEqual(await mjtSnapshot(), before, "no MJT transaction, entry or balance changed");
});

test("concurrent claims: 25 parallel requests grant the XP exactly once", async () => {
  const a = await mk("gm2_race");
  const rs = await Promise.all(Array.from({ length: 25 }, () => done(a, "c0.explore")));
  assert.ok(rs.every((x) => x.status === 200), rs.map((x) => x.status).join(","));
  assert.equal(rs.filter((x) => x.completed).length, 1, "exactly one winner");
  assert.equal(rs.filter((x) => x.already).length, 24);
  assert.equal((await a.req("GET", "/api/game/profile")).player.xp, 100);
  assert.equal(await count("SELECT COUNT(*) n FROM game_missions WHERE user_id=$1 AND mission_id='c0.explore'", [a.id]), 1);
  // and a direct second INSERT is refused by the PRIMARY KEY itself
  await assert.rejects(db().run("INSERT INTO game_missions(user_id,mission_id,xp,verify,completed_at) VALUES($1,'c0.explore',100,'story',$2)", [a.id, new Date().toISOString()]));
});

test("XP / level / chapter / reward spoofing and forged story flags grant nothing", async () => {
  const a = await mk("gm2_spoof");
  let r = await a.req("POST", "/api/game/missions/c0.explore/complete", { xp: 99999, level: 50, chapter: 9, reward: "1000", amount: 1000, mission: "c1.tower" });
  assert.equal(r.xpGained, 100, "body ignored"); assert.equal(r.progress.xp, 100);
  r = await a.req("PUT", "/api/game/profile", { xp: 5000, level: 40, chapter: 8, flags: { "room.done": true, "room.out": true, "street.tower": true, "m.c1.tower": true } });
  assert.equal(r.status, 200); assert.equal(r.player.xp, 100); assert.equal(r.player.level, 2); assert.equal(r.player.chapter, 0);
  r = await done(a, "c1.tower"); assert.equal(r.status, 409, "forged flags do not unlock or complete a mission");
  assert.equal((await a.req("GET", "/api/game/missions")).missions.find((m) => m.id === "c1.tower").done, false);
  assert.equal(await count("SELECT COUNT(*) n FROM game_missions WHERE user_id=$1", [a.id]), 1);
});

test("verify 'server' mission: refused until the server holds a mining session; starting one mints no MJT", async () => {
  const a = await mk("gm2_mine");
  assert.equal((await done(a, "c0.mining")).status, 422);
  const before = await mjtSnapshot();
  const st = await a.req("POST", "/api/mjt/mining/start"); assert.equal(st.status, 200, st.error);
  assert.deepEqual(await mjtSnapshot(), before, "starting a session moves no MJT");
  const r = await done(a, "c0.mining"); assert.equal(r.status, 200); assert.equal(r.xpGained, 50);
  assert.equal(r.missions.find((m) => m.id === "c0.mining").verify, "server");
  assert.deepEqual(await mjtSnapshot(), before, "completing the mission moves no MJT");
});

test("transaction rollback: a failure inside the transaction leaves no completion and no XP", async () => {
  const a = await mk("gm2_rb");
  const d = db(), orig = d.tx;
  d.tx = (fn) => orig.call(d, (t) => fn(new Proxy(t, { get(o, k) {
    if (k === "run") return async (sql, p) => { if (/SET level=/.test(sql)) throw new Error("injected failure"); return o.run(sql, p); };
    const v = o[k]; return typeof v === "function" ? v.bind(o) : v;
  } })));
  try { assert.equal((await done(a, "c0.explore")).status, 500); } finally { d.tx = orig; }
  assert.equal(await count("SELECT COUNT(*) n FROM game_missions WHERE user_id=$1", [a.id]), 0, "completion rolled back");
  const p = (await a.req("GET", "/api/game/profile")).player; assert.equal(p.xp, 0); assert.equal(p.level, 1);
  const r = await done(a, "c0.explore"); assert.equal(r.completed, true, "the retry after the failure succeeds once"); assert.equal(r.progress.xp, 100);
});

test("save/load: street scene only after leaving the room, street bounds, scene change clears the old position", async () => {
  const a = await mk("gm2_save");
  assert.equal((await a.req("PUT", "/api/game/profile", { scene: "street", pos: { x: 0, z: 2, r: 3 } })).status, 400, "still inside the room");
  await done(a, "c0.explore"); await done(a, "c0.leave");
  let r = await a.req("PUT", "/api/game/profile", { pos: { x: 1, z: 1, r: 0 } }); assert.deepEqual(r.player.pos, { x: 1, z: 1, r: 0 });
  r = await a.req("PUT", "/api/game/profile", { scene: "street" }); assert.equal(r.status, 200); assert.equal(r.player.scene, "street"); assert.equal(r.player.pos, null, "room position not carried into the street");
  assert.equal((await a.req("PUT", "/api/game/profile", { pos: { x: 20, z: 0, r: 0 } })).status, 400, "outside the boulevard");
  assert.equal((await a.req("PUT", "/api/game/profile", { pos: { x: 0, z: -45, r: 0 } })).status, 400, "inside the tower");
  r = await a.req("PUT", "/api/game/profile", { pos: { x: -3.456, z: -20, r: 1 } }); assert.deepEqual(r.player.pos, { x: -3.46, z: -20, r: 1 });
  r = await a.req("GET", "/api/game/profile"); assert.equal(r.player.scene, "street"); assert.equal(r.player.char, "hoodie"); assert.equal(r.player.xp, 150);
  r = await a.req("PUT", "/api/game/profile", { scene: "room", pos: { x: 2, z: 1.5, r: -1.57 } }); assert.equal(r.player.scene, "room");
  // a save from before missions existed (room.out flag, no missions) may still be saved in the street — it grants nothing
  const old = await mk("gm2_legacy");
  await old.req("PUT", "/api/game/profile", { flags: { "room.out": true } });
  r = await old.req("PUT", "/api/game/profile", { scene: "street" }); assert.equal(r.status, 200);
  assert.equal(r.player.xp, 0); assert.equal(await count("SELECT COUNT(*) n FROM game_missions WHERE user_id=$1", [old.id]), 0);
  assert.equal((await a.req("PUT", "/api/game/profile", { scene: "moon" })).status, 400);
  // the door's own save (room.out + scene street in ONE debounced request) is accepted, a brand-new save in the street is not
  const door = await mk("gm2_door");
  r = await door.req("PUT", "/api/game/profile", { flags: { "room.out": true }, scene: "street", pos: { x: 0, z: 2.8, r: 3.14 } });
  assert.equal(r.status, 200, r.error); assert.equal(r.player.scene, "street"); assert.equal(r.player.xp, 0, "the flag grants no XP");
  const nu = new H.Client(); H.app.ctx.rl.w.clear(); await nu.req("POST", "/api/auth/register", { name: "جديد", handle: "gm2_new", password: "secret123" });
  assert.equal((await nu.req("PUT", "/api/game/profile", { char: "suit", name: "New One", scene: "street", flags: { "room.out": true } })).status, 400, "a new save starts in the room");
});

test("migration 081: additive, re-run is a no-op, down/up on disposable data keeps every game_players row", async () => {
  const st = require("../scripts/verify-migrations.js");
  if (typeof st.staticCheck === "function") { const s = st.staticCheck("081"); assert.equal(s.ok, true, s.problems.join("\n")); }
  const a = await mk("gm2_mig"); await done(a, "c0.explore");
  const players = await count("SELECT COUNT(*) n FROM game_players");
  const xp = (await a.req("GET", "/api/game/profile")).player.xp;
  await m081.up(db(), exec); // re-run: no-op
  assert.equal(await count("SELECT COUNT(*) n FROM game_missions WHERE user_id=$1", [a.id]), 1);
  await m081.down(db(), exec);
  assert.equal(await hasTable("game_missions"), false);
  assert.equal(await count("SELECT COUNT(*) n FROM game_players"), players, "down() touches no game_players row");
  assert.equal((await a.req("GET", "/api/game/profile")).player.xp, xp, "XP kept");
  await m081.up(db(), exec);
  assert.equal(await hasTable("game_missions"), true);
  assert.equal(await count("SELECT COUNT(*) n FROM game_missions"), 0);
  const b = await mk("gm2_mig2"); assert.equal((await done(b, "c0.explore")).completed, true, "API works after up/down/up");
});
