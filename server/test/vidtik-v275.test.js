/* v2.75 «فيديوتك» — source separation + creator profile:
 *  • POST /api/posts stores data.video.source: "clips" only when asked, otherwise "post" (regular composer).
 *  • The clips feed shows source "clips" and LEGACY short videos (no source); a "post" video never enters it, even short.
 *  • GET /api/clips/creator/:handle: newest-first clips only, counts, follow state, self flag, processing list for the
 *    owner only, cursor paging, 404 for unknown / blocked. */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");

let H, a, b;
const db = () => H.app.ctx.db;
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const cl = new H.Client();
  const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error);
  cl.id = r.user.id; cl.handle = handle;
  return cl;
}
let n = 0;
async function mkVideo(cl, video, { status = "published", ago = 0 } = {}) {
  const id = "vt_" + ++n;
  await db().run("INSERT INTO posts(id,author,type,text,visibility,status,data,created_at) VALUES($1,$2,'video',$3,'public',$4,$5,$6)", [
    id, cl.id, "فيديو " + n, status, { video: { duration: 12, status: "ready", variants: { "360p": "/media/none.mp4" }, ...video } }, new Date(Date.now() - (ago || n) * 60000).toISOString()
  ]);
  return id;
}

test.before(async () => {
  H = await boot({});
  a = await mk("vt_a");
  b = await mk("vt_b");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("create: source is stored only when clips/post", async () => {
  for (const m of ["m_x", "m_y", "m_z"]) await db().run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,created_at) VALUES($1,$2,'video','video/mp4',10,$3,'ready',$4)", [m, a.id, "k_" + m, new Date().toISOString()]);
  for (const m of ["m_x", "m_y", "m_z"]) await db().run("UPDATE media SET variants=$1 WHERE id=$2", [{ "360p": "/media/none.mp4", duration: 12 }, m]);
  const p1 = await a.req("POST", "/api/posts", { type: "video", text: "من فيديوتك", short: true, video: { mediaId: "m_x", short: true, source: "clips" } });
  assert.equal(p1.status, 200, p1.error);
  const p2 = await a.req("POST", "/api/posts", { type: "video", text: "من المحرر", short: true, video: { mediaId: "m_y", short: true, source: "post" } });
  assert.equal(p2.status, 200, p2.error);
  const p3 = await a.req("POST", "/api/posts", { type: "video", text: "مصدر غريب", video: { mediaId: "m_z", source: "hack" } });
  assert.equal(p3.status, 200, p3.error);
  const src = async (id) => { const r = await db().get("SELECT data FROM posts WHERE id=$1", [id]); const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data; return d.video.source; };
  assert.equal(await src(p1.post.id), "clips");
  assert.equal(await src(p2.post.id), "post");
  assert.equal(await src(p3.post.id), undefined, "unknown source → legacy (none stored)");
  await new Promise((r) => setTimeout(r, 50)); // processing → published keeps the source
  assert.equal(await src(p1.post.id), "clips");
});

test("feed: clips + legacy shorts only, never regular-composer videos", async () => {
  const fromClips = await mkVideo(a, { source: "clips" });
  const legacy = await mkVideo(a, { short: true });
  const regularShort = await mkVideo(a, { source: "post", short: true });
  const regularLong = await mkVideo(a, { source: "post", short: false });
  const r = await b.req("GET", "/api/clips/feed?tab=foryou&limit=50");
  assert.equal(r.status, 200, r.error);
  const ids = r.items.map((x) => x.id);
  assert.ok(ids.includes(fromClips), "Vidtik video is in the feed");
  assert.ok(ids.includes(legacy), "old short video stays (nothing removed)");
  assert.ok(!ids.includes(regularShort), "regular post video stays out, even when short");
  assert.ok(!ids.includes(regularLong));
  const w = await b.req("POST", `/api/clips/${regularShort}/watch`, { ms: 1000, durationMs: 12000 });
  assert.equal(w.status, 404, "watch beacons only count real clips");
});

test("creator profile: grid, counts, follow, self, processing, paging, guards", async () => {
  const c = await mk("vt_c");
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await mkVideo(c, { source: "clips" }, { ago: 100 - i }));
  await mkVideo(c, { source: "post" }); // never on the Vidtik profile
  const proc = await mkVideo(c, { source: "clips" }, { status: "processing" });
  await db().run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [b.id, c.id, new Date().toISOString()]);
  await db().run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,'like',$3)", [ids[0], b.id, new Date().toISOString()]);

  const r = await b.req("GET", "/api/clips/creator/@vt_c?limit=3");
  assert.equal(r.status, 200, r.error);
  assert.equal(r.user.handle, "vt_c");
  assert.equal(r.self, false);
  assert.equal(r.counts.clips, 5);
  assert.equal(r.counts.followers, 1);
  assert.equal(r.following, true);
  assert.equal(r.counts.likes, 1);
  assert.deepEqual(r.processing, [], "others never see processing videos");
  assert.deepEqual(r.items.map((x) => x.id), [ids[4], ids[3], ids[2]], "newest first");
  assert.ok(r.next);
  const r2 = await b.req("GET", "/api/clips/creator/vt_c?limit=3&cursor=" + encodeURIComponent(r.next));
  assert.equal(r2.status, 200, r2.error);
  assert.deepEqual(r2.items.map((x) => x.id), [ids[1], ids[0]]);
  assert.equal(r2.next, null);

  const own = await c.req("GET", "/api/clips/creator/vt_c");
  assert.equal(own.self, true);
  assert.deepEqual(own.processing.map((x) => x.id), [proc]);

  assert.equal((await b.req("GET", "/api/clips/creator/nobody_here")).status, 404);
  assert.equal((await b.req("GET", "/api/clips/creator/vt_c?cursor=bad")).status, 400);
  const prefs = { blocked: [b.id] };
  await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [prefs, c.id]);
  assert.equal((await b.req("GET", "/api/clips/creator/vt_c")).status, 404, "a creator who blocked the viewer is not found");
});
