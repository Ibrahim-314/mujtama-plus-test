/* v2.80 — «أدوات صانع فيديوتك»: Vidtik drafts (own video only, cap, other member's id never touched, future publishAt only,
 * dead link dropped), per-clip stats (author + staff only, viewers/completion/avg/sources/daily, author's own watch ignored),
 * watch source written once, best time from followers' activity, scheduled video goes through processing (never published
 * before its media is ready, scheduled notification + creator «مجدولة» list), pure helpers, migration 078 reversible. */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");
const CS = require("../services/clipstudio");

let H, staff, a, b, c;
const db = () => H.app.ctx.db;
async function mk(handle, role) {
  H.app.ctx.rl.w.clear();
  const cl = new H.Client();
  const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error);
  cl.id = r.user.id;
  if (role) await db().run("UPDATE users SET role=$1 WHERE id=$2", [role, cl.id]);
  return cl;
}
let n = 0;
async function media(cl, { status = "ready", kind = "video" } = {}) {
  const id = "m_cc" + ++n + "x";
  await db().run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,$3,'video/mp4',10,$4,$5,$6,$7)", [id, cl.id, kind, id + ".mp4", status, { "360p": "/media/" + id + "_360p.mp4", poster: "/media/" + id + "_poster.jpg", duration: 12 }, new Date().toISOString()]);
  return id;
}
async function clip(cl, { status = "published", publishAt = null } = {}) {
  const id = "ccl_" + ++n;
  await db().run("INSERT INTO posts(id,author,type,text,visibility,status,data,created_at,publish_at) VALUES($1,$2,'video','لقطة',$3,$4,$5,$6,$7)", [
    id, cl.id, "public", status, { video: { short: true, source: "clips", duration: 10, status: "ready", variants: { "360p": "/media/none.mp4" } } }, new Date().toISOString(), publishAt
  ]);
  return id;
}
const did = (s) => "cd_" + s + "zzzzzz";

test.before(async () => {
  H = await boot({});
  staff = await mk("cc_staff", "moderator");
  a = await mk("cc_alia");
  b = await mk("cc_badr");
  c = await mk("cc_ciel");
});
test.after(async () => { await H.app.close?.(); H.app.server.close(); });

test("pure helpers: completion, sources, daily buckets, best hours", () => {
  assert.equal(CS.completionPct(0, 0), 0);
  assert.equal(CS.completionPct(4, 3), 75);
  assert.deepEqual(CS.sourceShares([{ src: "foryou", n: 3 }, { src: null, n: 1 }, { src: "weird", n: 0 }]), [{ src: "foryou", n: 3, pct: 75 }, { src: "other", n: 1, pct: 25 }]);
  const now = Date.parse("2026-10-22T12:00:00Z");
  const d = CS.dayBuckets(["2026-10-22T01:00:00Z", "2026-10-21T23:00:00Z", "2026-10-22T09:00:00Z", "2026-09-01T00:00:00Z", "bad"], 3, now);
  assert.deepEqual(d, [{ day: "2026-10-20", n: 0 }, { day: "2026-10-21", n: 1 }, { day: "2026-10-22", n: 2 }]);
  const few = CS.bestHours(["2026-10-22T18:00:00Z"], 2);
  assert.equal(few.enough, false); assert.deepEqual(few.top, []);
  const many = CS.bestHours([...Array(5).fill("2026-10-22T18:10:00Z"), ...Array(3).fill("2026-10-21T07:00:00Z"), ...Array(3).fill("2026-10-21T05:00:00Z"), "2026-10-21T01:00:00Z"], 10);
  assert.equal(many.enough, true); assert.equal(many.sample, 12); assert.deepEqual(many.top, [18, 5, 7]);
});

test("drafts: save, update, list, own video only, cap, foreign id untouched, delete", async () => {
  const m = await media(a);
  assert.equal((await b.req("GET", "/api/clips/drafts")).items.length, 0);
  const bad = await a.req("PUT", "/api/clips/drafts/x1", { mediaId: m });
  assert.equal(bad.status, 400);
  const foreign = await b.req("PUT", "/api/clips/drafts/" + did("a1"), { mediaId: m });
  assert.equal(foreign.status, 400, "someone else's video");
  const img = await media(a, { kind: "image" });
  assert.equal((await a.req("PUT", "/api/clips/drafts/" + did("a0"), { mediaId: img })).status, 400, "not a video");
  const past = new Date(Date.now() - 3600e3).toISOString(), fut = new Date(Date.now() + 86400e3).toISOString();
  const r = await a.req("PUT", "/api/clips/drafts/" + did("a1"), { mediaId: m, caption: "مسودة #سفر", coverPos: 420, publishAt: past, link: { kind: "product", id: "nope" } });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.draft.caption, "مسودة #سفر");
  assert.equal(r.draft.coverPos, 420);
  assert.equal(r.draft.publishAt, null, "a past time is not kept");
  assert.equal(r.draft.link, null, "a link that is not mine / not live is dropped");
  assert.match(r.draft.media.src, /_360p\.mp4$/);
  const u = await a.req("PUT", "/api/clips/drafts/" + did("a1"), { mediaId: m, caption: "x".repeat(3000), coverPos: 5000, publishAt: fut });
  assert.equal(u.status, 200, u.error);
  assert.equal(u.draft.caption.length, 2200);
  assert.equal(u.draft.coverPos, null);
  assert.equal(u.draft.publishAt, new Date(fut).toISOString());
  const hijack = await b.req("PUT", "/api/clips/drafts/" + did("a1"), { mediaId: await media(b), caption: "سرقة" });
  assert.equal(hijack.status, 404);
  assert.equal((await db().get("SELECT caption FROM clip_drafts WHERE id=$1", [did("a1")])).caption.length, 2200);
  const l = await a.req("GET", "/api/clips/drafts");
  assert.equal(l.items.length, 1); assert.equal(l.max, 20);
  assert.equal((await b.req("GET", "/api/clips/drafts")).items.length, 0, "drafts are private");
  for (let i = 2; i <= 20; i++) { H.app.ctx.rl.w.clear(); assert.equal((await a.req("PUT", "/api/clips/drafts/" + did("cap" + i), { mediaId: m })).status, 200); }
  H.app.ctx.rl.w.clear();
  assert.equal((await a.req("PUT", "/api/clips/drafts/" + did("cap21"), { mediaId: m })).status, 400, "cap of 20");
  assert.equal((await b.req("DELETE", "/api/clips/drafts/" + did("a1"))).status, 200);
  assert.ok(await db().get("SELECT 1 x FROM clip_drafts WHERE id=$1", [did("a1")]), "another member cannot delete it");
  assert.equal((await a.req("DELETE", "/api/clips/drafts/" + did("a1"))).status, 200);
  assert.equal(await db().get("SELECT 1 x FROM clip_drafts WHERE id=$1", [did("a1")]), undefined);
  await db().run("DELETE FROM clip_drafts WHERE user_id=$1", [a.id]);
  assert.equal((await a.req("GET", "/api/clips/drafts")).status, 200);
  assert.equal((await H.Client.prototype.req.call(new H.Client(), "GET", "/api/clips/drafts")).status, 401);
});

test("watch source is kept from the first watch; stats for author and staff only", async () => {
  const id = await clip(a);
  H.app.ctx.rl.w.clear();
  assert.equal((await b.req("POST", `/api/clips/${id}/watch`, { ms: 10000, durationMs: 10000, src: "profile" })).status, 200);
  assert.equal((await b.req("POST", `/api/clips/${id}/watch`, { ms: 3000, durationMs: 10000, src: "foryou" })).status, 200);
  assert.equal((await c.req("POST", `/api/clips/${id}/watch`, { ms: 2000, durationMs: 10000, src: "<script>" })).status, 200);
  assert.equal((await staff.req("POST", `/api/clips/${id}/watch`, { ms: 6000, durationMs: 10000, src: "tag" })).status, 200);
  assert.equal((await a.req("POST", `/api/clips/${id}/watch`, { ms: 10000, durationMs: 10000, src: "foryou" })).status, 200);
  const w = await db().get("SELECT src, first_at FROM clip_watch WHERE user_id=$1 AND post_id=$2", [b.id, id]);
  assert.equal(w.src, "profile"); assert.ok(w.first_at);
  const s = await a.req("GET", `/api/clips/${id}/stats`);
  assert.equal(s.status, 200, s.error);
  assert.equal(s.views, 3, "the author's own watch is not a view");
  assert.equal(s.completed, 1);
  assert.equal(s.completionPct, 33);
  assert.equal(s.avgWatchSec, 6);
  assert.deepEqual(s.sources.map((x) => x.src), ["profile", "tag", "other"]);
  assert.equal(s.daily.length, 14);
  assert.equal(s.daily[13].n, 3);
  assert.equal((await staff.req("GET", `/api/clips/${id}/stats`)).status, 200);
  assert.equal((await b.req("GET", `/api/clips/${id}/stats`)).status, 404);
  assert.equal((await a.req("GET", `/api/clips/nope/stats`)).status, 404);
});

test("best time: followers' activity only, enough flag", async () => {
  const r0 = await c.req("GET", "/api/clips/insights/best-time");
  assert.equal(r0.status, 200, r0.error);
  assert.equal(r0.enough, false); assert.equal(r0.hours.length, 24);
  assert.equal((await b.req("PUT", `/api/follows/${c.id}`)).status, 200);
  const ids = []; for (let i = 0; i < 31; i++) ids.push(await clip(a));
  const h = new Date(); h.setUTCHours(19, 15, 0, 0); if (h > new Date()) h.setUTCDate(h.getUTCDate() - 1);
  for (const pid of ids) await db().run("INSERT INTO clip_watch(user_id,post_id,watched_ms,completed,updated_at) VALUES($1,$2,1000,0,$3)", [b.id, pid, h.toISOString()]);
  for (const pid of ids.slice(0, 5)) await db().run("INSERT INTO clip_watch(user_id,post_id,watched_ms,completed,updated_at) VALUES($1,$2,1000,0,$3)", [staff.id, pid, h.toISOString()]); // not a follower
  const r = await c.req("GET", "/api/clips/insights/best-time");
  assert.equal(r.sample, 32, "the follower's 31 + 1 earlier watch; the non-follower's are left out"); assert.equal(r.enough, true); assert.equal(r.top[0], 19); assert.equal(r.followers, 1);
});

test("scheduled clip: listed for the creator, published only through processing when due", async () => {
  const mid = await media(a, { status: "processing" });
  const fut = new Date(Date.now() + 3600e3).toISOString();
  H.app.ctx.rl.w.clear();
  const r = await a.req("POST", "/api/posts", { type: "video", visibility: "public", text: "مجدولة", short: true, publishAt: fut, video: { mediaId: mid, short: true, source: "clips", duration: 12 } });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.post.status, "scheduled");
  const me = await a.req("GET", "/api/clips/creator/cc_alia");
  assert.equal(me.status, 200, me.error);
  assert.deepEqual(me.scheduled.map((x) => x.id), [r.post.id]);
  assert.equal((await b.req("GET", "/api/clips/creator/cc_alia")).scheduled.length, 0, "only the creator sees them");
  await db().run("UPDATE posts SET publish_at=$1 WHERE id=$2", [new Date(Date.now() - 1000).toISOString(), r.post.id]);
  await H.app.ctx.services.content.publishDue();
  assert.equal((await db().get("SELECT status FROM posts WHERE id=$1", [r.post.id])).status, "processing", "media not ready → waits");
  await db().run("UPDATE media SET status='ready' WHERE id=$1", [mid]);
  H.app.ctx.bus.emit("MEDIA_READY", { media: mid });
  for (let i = 0; i < 50; i++) { if ((await db().get("SELECT status FROM posts WHERE id=$1", [r.post.id])).status === "published") break; await new Promise((x) => setTimeout(x, 20)); }
  const p = await db().get("SELECT status, data FROM posts WHERE id=$1", [r.post.id]);
  assert.equal(p.status, "published");
  assert.equal(p.data.video.status, "ready");
  for (let i = 0; i < 50; i++) { if (await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='scheduled'", [a.id])) break; await new Promise((x) => setTimeout(x, 20)); }
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='scheduled'", [a.id]), "scheduled notification once published");
  const ready = await media(a);
  const r2 = await a.req("POST", "/api/posts", { type: "video", visibility: "public", text: "جاهزة", short: true, publishAt: fut, video: { mediaId: ready, short: true, source: "clips" } });
  await db().run("UPDATE posts SET publish_at=$1 WHERE id=$2", [new Date(Date.now() - 1000).toISOString(), r2.post.id]);
  await H.app.ctx.services.content.publishDue();
  assert.equal((await db().get("SELECT status FROM posts WHERE id=$1", [r2.post.id])).status, "published", "ready media publishes at once");
});

test("migration 078 down/up is reversible", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '078_clip_creator' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "078_clip_creator"]);
  assert.deepEqual(await mig.up(db()), ["078_clip_creator", ...later]);
  assert.equal((await a.req("GET", "/api/clips/drafts")).status, 200);
});
