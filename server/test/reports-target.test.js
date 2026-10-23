/* H3-02 — POST /api/reports only accepts a real target the reporter can see. Missing and not-visible targets give the
 * same 404 (no existence leak), store no row and cannot flip moderation; valid post/comment/user/community reports work. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
let H, O, M, X, pub, priv, privPost, pubPost;
const clear = () => H.app.ctx.rl.w?.clear?.();
const mk = async (handle) => { clear(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const db = () => H.app.ctx.db;
const rep = (c, target, kind = "post") => { clear(); return c.req("POST", "/api/reports", { target, kind, reason: "إساءة" }); };
const rows = async (target) => (await db().all("SELECT id FROM reports WHERE target=$1", [target])).length;

test.before(async () => {
  H = await boot();
  [O, M, X] = [await mk("rt_own"), await mk("rt_mem"), await mk("rt_out")];
  pub = (await O.req("POST", "/api/communities", { name: "مجتمع البلاغات العام" })).community.id;
  priv = (await O.req("POST", "/api/communities", { name: "مجتمع البلاغات الخاص", type: "private" })).community.id;
  await db().run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES($1,$2,'member',$3) ON CONFLICT DO NOTHING", [priv, M.id, new Date().toISOString()]);
  privPost = (await O.req("POST", "/api/posts", { text: "منشور داخل مجتمع خاص", community: priv })).post;
  pubPost = (await O.req("POST", "/api/posts", { text: "منشور عام للاختبار" })).post;
});
test.after(() => H.app.close());

test("nonexistent post → 404, no row", async () => {
  const r = await rep(X, "p_fake123");
  assert.equal(r.status, 404); assert.equal(await rows("p_fake123"), 0);
});

test("private-community post invisible to outsider → identical 404, no row, moderation untouched", async () => {
  assert.equal((await X.req("GET", "/api/posts/" + privPost.id)).status, 404);
  const a = await rep(X, privPost.id), b = await rep(X, "p_fake_other");
  assert.equal(a.status, 404); assert.equal(b.status, 404);
  const body = ({ status, headers, requestId, ...rest }) => rest;
  assert.deepEqual(body(a), body(b), "same body for not-visible and missing");
  assert.equal(await rows(privPost.id), 0);
  assert.equal((await db().get("SELECT moderation FROM posts WHERE id=$1", [privPost.id])).moderation ?? null, null);
});

test("valid reports still work: member on private post, public post, comment, user, community", async () => {
  assert.equal((await rep(M, privPost.id)).status, 200);
  assert.equal((await rep(X, pubPost.id)).status, 200);
  assert.equal((await rep(X, pubPost.id)).status, 409, "duplicate still 409");
  clear(); const cm = (await O.req("POST", "/api/comments", { post: pubPost.id, text: "تعليق للاختبار" })).comment;
  assert.equal((await rep(X, cm.id, "comment")).status, 200);
  assert.equal((await rep(X, O.id, "user")).status, 200);
  assert.equal((await rep(X, pub, "community")).status, 200);
});

test("other kinds: missing comment/user/community → 404; comment on invisible post → 404", async () => {
  assert.equal((await rep(X, "c_fake", "comment")).status, 404);
  assert.equal((await rep(X, "u_fake", "user")).status, 404);
  assert.equal((await rep(X, "cm_fake", "community")).status, 404);
  assert.equal((await rep(X, "m_fake", "message")).status, 404);
  clear(); const pc = (await O.req("POST", "/api/comments", { post: privPost.id, text: "تعليق خاص" })).comment;
  assert.ok(pc && pc.id, "owner can comment in private community");
  assert.equal((await rep(X, pc.id, "comment")).status, 404);
});

test("guest → 401", async () => {
  const g = new H.Client();
  assert.equal((await g.req("POST", "/api/reports", { target: pubPost.id, kind: "post", reason: "x" })).status, 401);
});
