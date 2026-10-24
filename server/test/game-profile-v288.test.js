/* v2.88 «المدينة الرقمية» — the game save (services/game.js, migration 080). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H;
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "لاعب " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
test.before(async () => { H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } }); });
test.after(() => H.app.close());

test("no save before the character is created; create, continue, update settings and flags", async () => {
  const a = await mk("game_a");
  let r = await a.req("GET", "/api/game/profile");
  assert.equal(r.status, 200); assert.equal(r.player, null);
  r = await a.req("PUT", "/api/game/profile", { char: "suit-f", name: "  نور   الرقمية " });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.player.char, "suit-f"); assert.equal(r.player.name, "نور الرقمية");
  assert.equal(r.player.scene, "room"); assert.equal(r.player.level, 1); assert.equal(r.player.xp, 0); assert.equal(r.player.chapter, 0);
  r = await a.req("PUT", "/api/game/profile", { pos: { x: 1.234, z: -2, r: 3.1 }, flags: { "room.window": true }, settings: { music: 0.4, quality: "low" } });
  assert.deepEqual(r.player.pos, { x: 1.23, z: -2, r: 3.1 });
  assert.equal(r.player.flags["room.window"], true); assert.equal(r.player.settings.music, 0.4); assert.equal(r.player.settings.quality, "low");
  assert.equal(r.player.name, "نور الرقمية", "name kept");
  r = await a.req("PUT", "/api/game/profile", { flags: { "room.door": 1 }, settings: { sfx: 0 } });
  assert.equal(r.player.flags["room.window"], true, "flags merge"); assert.equal(r.player.flags["room.door"], 1);
  assert.equal(r.player.settings.music, 0.4, "settings merge"); assert.equal(r.player.settings.sfx, 0);
  r = await a.req("GET", "/api/game/profile"); assert.equal(r.player.char, "suit-f");
});

test("validation: character, name, scene, position, flags, settings; level/xp/chapter are not client-writable", async () => {
  const b = await mk("game_b");
  assert.equal((await b.req("PUT", "/api/game/profile", { name: "سامي" })).status, 400, "character required on create");
  assert.equal((await b.req("PUT", "/api/game/profile", { char: "dragon", name: "سامي" })).status, 400);
  assert.equal((await b.req("PUT", "/api/game/profile", { char: "hoodie", name: "س" })).status, 400, "too short");
  assert.equal((await b.req("PUT", "/api/game/profile", { char: "hoodie", name: "<script>" })).status, 400);
  assert.equal((await b.req("PUT", "/api/game/profile", { char: "hoodie", name: "x".repeat(21) })).status, 400);
  const ok = await b.req("PUT", "/api/game/profile", { char: "hoodie", name: "Sami 01", level: 99, xp: 5000, chapter: 7 });
  assert.equal(ok.status, 200); assert.equal(ok.player.level, 1); assert.equal(ok.player.xp, 0); assert.equal(ok.player.chapter, 0);
  assert.equal((await b.req("PUT", "/api/game/profile", { scene: "moon" })).status, 400);
  assert.equal((await b.req("PUT", "/api/game/profile", { pos: { x: 999, z: 0, r: 0 } })).status, 400);
  assert.equal((await b.req("PUT", "/api/game/profile", { flags: [1] })).status, 400);
  assert.equal((await b.req("PUT", "/api/game/profile", { flags: { "bad key!": true } })).status, 400);
  assert.equal((await b.req("PUT", "/api/game/profile", { flags: { k: { deep: 1 } } })).status, 400);
  const many = {}; for (let i = 0; i < 70; i++) many["f" + i] = true;
  assert.equal((await b.req("PUT", "/api/game/profile", { flags: many })).status, 400);
  assert.equal((await b.req("PUT", "/api/game/profile", { settings: { music: 2 } })).status, 400);
  assert.equal((await b.req("PUT", "/api/game/profile", { settings: { quality: "ultra" } })).status, 400);
  const g = await new H.Client().req("GET", "/api/game/profile"); assert.equal(g.status, 401, "guests refused");
  const g2 = await new H.Client().req("PUT", "/api/game/profile", { char: "hoodie", name: "ضيف" }); assert.equal(g2.status, 401);
});

test("each member has their own save", async () => {
  const c = await mk("game_c"), d = await mk("game_d");
  await c.req("PUT", "/api/game/profile", { char: "casual", name: "سارة" });
  assert.equal((await d.req("GET", "/api/game/profile")).player, null);
  assert.equal((await c.req("GET", "/api/game/profile")).player.name, "سارة");
});
