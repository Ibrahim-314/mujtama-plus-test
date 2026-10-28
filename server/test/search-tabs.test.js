/* v2.127 search stage 4 — X-style tabs. «الأحدث» returns the same relevant posts newest first; «وسائط» keeps only relevant posts
 * that carry images/video/audio (never a paid post's hidden media); «الأبرز» (all) stays the mixed best-first view; private posts
 * stay hidden in every tab. Runs on SQLite and PostgreSQL. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
let H, db, S, A, B;
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = r.user.id; return c; };
async function post(text, { ago = 0, data = null, vis = "public", type = "post" } = {}) {
  const pid = id("p");
  await db.run("INSERT INTO posts(id,author,type,title,text,lang,visibility,status,data,created_at) VALUES($1,$2,$3,NULL,$4,'ar',$5,'published',$6,$7)", [pid, B.id, type, text, vis, data ? JSON.stringify(data) : null, new Date(Date.now() - ago * 3600e3).toISOString()]);
  await S.indexPost(pid); return pid;
}
const ids = (r) => (r.groups.posts?.items || []).map((p) => p.id);
let old, fresh, pic, priv;
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} } });
  db = H.app.ctx.db; S = H.app.ctx.services.search; A = await mk("tab_a"); B = await mk("tab_b");
  old = await post("مهرجان الطائرات الورقية في الكورنيش كان مذهل وحضره ناس كثير", { ago: 72 });
  fresh = await post("مهرجان الطائرات الورقية يبدأ اليوم العصر", { ago: 1 });
  pic = await post("صور مهرجان الطائرات الورقية", { ago: 30, data: { images: ["/media/abcdef123.jpg"] } });
  await post("مهرجان الطائرات الورقية — ألبوم كامل للمشتركين", { ago: 20, data: { paid: true, images: ["/media/zzzzzz999.jpg"] } });
  priv = await post("مهرجان الطائرات الورقية مع العائلة", { ago: 2, vis: "followers", data: { images: ["/media/qqqqqq111.jpg"] } });
});
test.after(() => H.app.close());
const q = (type) => A.req("GET", `/api/search/full?ai=0&type=${type}&q=` + encodeURIComponent("مهرجان الطائرات الورقية"));

test("latest: same relevant posts, newest first", async () => {
  const r = await q("latest"); const got = ids(r);
  assert.equal(got[0], fresh); assert.ok(got.indexOf(old) > got.indexOf(pic));
  assert.equal(r.filters.sort, "latest"); assert.ok(!got.includes(priv));
});
test("media: only posts with visible media", async () => {
  const got = ids(await q("media"));
  assert.deepEqual(got, [pic]);
});
test("top (all) keeps every group and the mixed view", async () => {
  const r = await q("all");
  assert.ok(r.groups.people && r.groups.communities && r.groups.posts);
  assert.ok(ids(r).includes(old) && ids(r).includes(fresh) && !ids(r).includes(priv));
});
