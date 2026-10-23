/* v2.62: «عضو جديد» + anniversary badges on the community feed; owner switch in identity settings. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
let H, O, U, V, cid;
const mk = async (handle) => { H.app.ctx.rl.w?.clear?.(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const post = (c, text) => c.req("POST", "/api/posts", { id: "p_" + Math.random().toString(36).slice(2, 12), type: "text", text, community: cid });
test.before(async () => {
  H = await boot(); [O, U, V] = [await mk("mb_own"), await mk("mb_new"), await mk("mb_old")];
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع الشارات", desc: "اختبار", topic: "dev" })).community.id;
  for (const c of [U, V]) await c.req("PUT", `/api/communities/${cid}/membership`);
  const db = H.app.ctx.db;
  await db.run("UPDATE memberships SET joined_at=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 365 * 864e5 - 3600e3).toISOString(), cid, V.id]); // 1st anniversary, ~1 hour ago
  await db.run("UPDATE memberships SET joined_at=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 40 * 864e5).toISOString(), cid, O.id]); // neither
  await post(U, "منشور العضو الجديد"); await post(V, "منشور صاحب الذكرى"); await post(O, "منشور المالك");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w?.clear?.());
const feed = async (c) => { const r = await fetch(H.base + `/api/communities/${cid}/posts`); assert.equal(r.status, 200); const raw = await r.text(); return { raw, posts: JSON.parse(raw).posts }; };
test("feed carries the badge kind only (new / anniv years / none), never joined_at", async () => {
  const { raw, posts } = await feed(); const by = (id) => posts.find(p => p.author === id || p.author?.id === id);
  assert.deepStrictEqual(by(U.id).memberBadge, { kind: "new" });
  assert.deepStrictEqual(by(V.id).memberBadge, { kind: "anniv", years: 1 });
  assert.strictEqual(by(O.id).memberBadge, undefined);
  assert.doesNotMatch(raw, /joined_?at/i);
});
test("owner switch: identity.memberBadges defaults true, turning it off hides badges; members cannot change it", async () => {
  assert.strictEqual((await O.req("GET", `/api/communities/${cid}/space`)).identity.memberBadges, true);
  const denied = await U.req("PATCH", `/api/communities/${cid}/identity`, { memberBadges: false }); assert.ok([401, 403].includes(denied.status), "member → " + denied.status);
  const r = await O.req("PATCH", `/api/communities/${cid}/identity`, { memberBadges: false }); assert.strictEqual(r.identity.memberBadges, false);
  assert.ok((await feed()).posts.every(p => p.memberBadge === undefined));
  await O.req("PATCH", `/api/communities/${cid}/identity`, { memberBadges: true });
  assert.ok((await feed()).posts.some(p => p.memberBadge));
});
