/* v2.61.1 (B1) — directory category «بدون» is kept: an explicit none ("none" sentinel in settings.category) is
 * distinct from unset, which still falls back to the community topic (legacy rows, no migration). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const CS = require("../lib/community-settings");
const { TOPICS } = require("../lib/core");
let H, O, cid;
test.before(async () => {
  H = await boot(); H.app.ctx.rl.w?.clear?.();
  O = new H.Client(); await O.req("POST", "/api/auth/register", { name: "مالك التصنيف", handle: "cat_own", password: "secret123" });
  H.app.ctx.rl.w?.clear?.();
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع التصنيف", desc: "اختبار التصنيف", topic: "dev" })).community.id;
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w?.clear?.());
const space = async () => (await O.req("GET", `/api/communities/${cid}/space`)).identity.category;
const dir = async () => (await O.req("GET", "/api/communities/directory")).communities.find(c => c.id === cid)?.category;
const raw = async () => { const r = await H.app.ctx.db.get("SELECT settings FROM communities WHERE id=$1", [cid]); return (typeof r.settings === "string" ? JSON.parse(r.settings) : r.settings || {}).category; };

test("unset (legacy, no settings.category) falls back to the topic", async () => {
  assert.equal(await raw(), undefined);
  assert.equal(await space(), "dev"); assert.equal(await dir(), "dev");
});

test("explicit «بدون» round-trips: stored as the sentinel, reported as null, survives a reload, leaves the directory filter", async () => {
  const r = await O.req("PATCH", `/api/communities/${cid}/identity`, { category: "none" }); assert.equal(r.status, 200);
  assert.equal(r.identity.category, null);
  assert.equal(await raw(), CS.CAT_NONE);
  assert.equal(await space(), null, "reload keeps «بدون» (no fallback to the topic)");
  assert.equal(await dir(), null);
  const f = await O.req("GET", "/api/communities/directory?category=dev"); assert.ok(!f.communities.some(c => c.id === cid), "not listed under its topic any more");
  // empty string from an older client is also an explicit none
  await O.req("PATCH", `/api/communities/${cid}/identity`, { category: "" }); assert.equal(await space(), null);
});

test("choosing a topic again works; null resets to unset (topic fallback, backward compatible)", async () => {
  const other = TOPICS.find(t => t.slug !== "dev").slug;
  await O.req("PATCH", `/api/communities/${cid}/identity`, { category: other });
  assert.equal(await space(), other); assert.equal(await dir(), other);
  await O.req("PATCH", `/api/communities/${cid}/identity`, { category: null });
  assert.equal(await raw(), null); assert.equal(await space(), "dev", "null = unset → topic");
});

test("categoryOf / parse unit", () => {
  assert.equal(CS.categoryOf({ topic: "dev", settings: {} }), "dev");
  assert.equal(CS.categoryOf({ topic: "dev", settings: { category: null } }), "dev");
  assert.equal(CS.categoryOf({ topic: "dev", settings: { category: "none" } }), null);
  assert.equal(CS.categoryOf({ topic: null, settings: null }), null);
  assert.equal(CS.FIELDS.category.parse("none"), "none"); assert.equal(CS.FIELDS.category.parse(""), "none");
  assert.equal(CS.FIELDS.category.parse("bogus"), null); assert.equal(CS.FIELDS.category.parse(null), null);
});
