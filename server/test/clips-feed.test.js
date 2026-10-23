/* v2.70 خلاصة اللقطات — services/clips.js + migration 070_clip_watch.
 * Pagination never repeats or skips across pages, the following tab, privacy (blocked / private / followers-only
 * authors left out), eligibility (only published video posts with video.short or variants), watch upsert (furthest
 * point, sticky completion, completed clips leave «لك»), 401 for visitors, migration 070 down/up. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const mig = require("../lib/migrations");
const m070 = require("../migrations/070_clip_watch");
const { clipScore, completionRate } = require("../services/clips");

let H, viewer, alice, bob, priv, blocker, visitor;
const db = () => H.app.ctx.db;
const exec = async (sql) => { for (const s of mig.render(sql, db().dialect).split(";").map(x => x.trim()).filter(Boolean)) await db().exec(s); };
async function hasTable(name) {
  if (db().dialect === "postgres") return !!(await db().get("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name=$1", [name]));
  return !!(await db().get("SELECT name FROM sqlite_master WHERE type='table' AND name=$1", [name]));
}
async function reg(handle) {
  const c = new H.Client();
  const r = await c.req("POST", "/api/auth/register", { name: "مستخدم " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
let minute = 0;
async function clip(author, { video = { short: true, duration: 12 }, visibility, type = "video" } = {}) {
  H.app.ctx.rl.w.clear();
  const r = await author.req("POST", "/api/posts", { text: "لقطة " + (++minute), ...(visibility ? { visibility } : {}) });
  assert.equal(r.status, 200, r.error);
  const at = new Date(Date.now() - minute * 60e3).toISOString();
  await db().run("UPDATE posts SET type=$1, data=$2, created_at=$3 WHERE id=$4", [type, JSON.stringify({ video }), at, r.post.id]);
  return r.post.id;
}
async function allPages(c, tab, limit) {
  const seen = []; let cursor = null, pages = 0;
  do {
    const r = await c.req("GET", `/api/clips/feed?tab=${tab}&limit=${limit}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
    assert.equal(r.status, 200, r.error);
    assert.ok(r.items.length <= limit);
    seen.push(...r.items.map(i => i.id)); cursor = r.next; pages++;
    assert.ok(pages < 50, "pagination terminates");
  } while (cursor);
  return { ids: seen, pages };
}
const cache = () => H.app.ctx.cache;
const flush = () => cache().del("clips:");

const ids = {};
test.before(async () => {
  H = await boot();
  viewer = await reg("cf_viewer"); alice = await reg("cf_alice"); bob = await reg("cf_bob"); priv = await reg("cf_priv"); blocker = await reg("cf_block");
  visitor = new H.Client();
  ids.alice = []; for (let i = 0; i < 7; i++) ids.alice.push(await clip(alice));
  ids.bob = []; for (let i = 0; i < 6; i++) ids.bob.push(await clip(bob, { video: { variants: { master: "/media/x.m3u8", poster: "/media/x.jpg" }, duration: 30 } }));
  ids.notClip = await clip(bob, { video: { duration: 30 } });            // no short / variants → not eligible
  ids.textPost = await clip(bob, { type: "text", video: { short: true } }); // not a video post
  ids.followersOnly = await clip(alice, { visibility: "followers" });
  ids.priv = await clip(priv);
  await db().run("UPDATE users SET private=1 WHERE id=$1", [priv.id]);
  ids.blocked = await clip(blocker);
  H.app.ctx.rl.w.clear();
  let r = await viewer.req("PUT", "/api/follows/" + alice.id); assert.equal(r.status, 200, r.error);
  r = await viewer.req("PUT", "/api/me/prefs", { blocked: [blocker.id] }); assert.equal(r.status, 200, r.error);
});
test.after(() => H.app.close());

test("pure model: smoothed completion, follow boost, recency decay", () => {
  assert.equal(completionRate(0, 0), 1 / 3);
  assert.ok(completionRate(10, 9) > completionRate(10, 1));
  const at = Date.now(), p = { created_at: new Date(at).toISOString(), author: "a" }, old = { created_at: new Date(at - 10 * 864e5).toISOString(), author: "a" };
  assert.ok(clipScore(p, {}, { followed: true, at }) > clipScore(p, {}, { at }));
  assert.ok(clipScore(p, { likes: 5 }, { at }) > clipScore(old, { likes: 5 }, { at }));
  assert.ok(clipScore(p, { watchers: 10, completed: 10 }, { at }) > clipScore(p, { watchers: 10, completed: 0 }, { at }));
});

test("visitor gets 401 on feed and on watch", async () => {
  assert.equal((await visitor.req("GET", "/api/clips/feed")).status, 401);
  assert.equal((await visitor.req("POST", `/api/clips/${ids.alice[0]}/watch`, { ms: 1000, durationMs: 12000 })).status, 401);
});

test("foryou: pages of 4 never repeat or skip; eligibility + privacy hold; items carry author, counts, variants", async () => {
  const { ids: got, pages } = await allPages(viewer, "foryou", 4);
  assert.equal(new Set(got).size, got.length, "no duplicates across pages");
  const expected = [...ids.alice, ...ids.bob, ids.followersOnly].sort();
  assert.deepEqual([...got].sort(), expected, "exactly the eligible, visible clips");
  assert.ok(pages >= 4);
  for (const bad of [ids.notClip, ids.textPost, ids.priv, ids.blocked]) assert.ok(!got.includes(bad), bad);
  const first = await viewer.req("GET", "/api/clips/feed?tab=foryou&limit=30");
  const b = first.items.find(i => i.id === ids.bob[0]);
  assert.ok(b.video.variants.master); assert.equal(b.user.id, bob.id); assert.equal(b.author, bob.id);
  assert.deepEqual(Object.keys(b.counts).sort(), ["comments", "completion", "likes", "shares", "watchers"]);
  // a followed author's clip gets the boost: alice's newest outranks bob's newest at equal engagement
  const order = first.items.map(i => i.id);
  assert.ok(order.indexOf(ids.alice[0]) < order.indexOf(ids.bob[0]));
});

test("cursor is opaque and tab-bound; bad cursor / tab → 400", async () => {
  const r = await viewer.req("GET", "/api/clips/feed?tab=foryou&limit=2");
  assert.ok(r.next && !/[{}"]/.test(r.next));
  assert.equal((await viewer.req("GET", "/api/clips/feed?tab=following&cursor=" + encodeURIComponent(r.next))).status, 400);
  assert.equal((await viewer.req("GET", "/api/clips/feed?cursor=%%%zz")).status, 400);
  assert.equal((await viewer.req("GET", "/api/clips/feed?tab=nope")).status, 400);
});

test("following tab: only followed authors, newest first, paginated without duplicates", async () => {
  const { ids: got } = await allPages(viewer, "following", 3);
  assert.equal(new Set(got).size, got.length);
  assert.deepEqual([...got].sort(), [...ids.alice, ids.followersOnly].sort());
  const r = await viewer.req("GET", "/api/clips/feed?tab=following&limit=30");
  const at = r.items.map(i => i.createdAt); assert.deepEqual(at, [...at].sort().reverse());
  // a stranger who follows nobody gets an empty following tab, and followers-only clips stay hidden from them
  const s = await reg("cf_stranger");
  assert.equal((await s.req("GET", "/api/clips/feed?tab=following")).items.length, 0);
  const all = (await s.req("GET", "/api/clips/feed?tab=foryou&limit=30")).items.map(i => i.id);
  assert.ok(!all.includes(ids.followersOnly) && !all.includes(ids.priv) && all.includes(ids.blocked));
});

test("watch: upsert keeps furthest point, completion is sticky, completed clip leaves foryou; hidden clip → 404", async () => {
  const pid = ids.bob[2];
  let r = await viewer.req("POST", `/api/clips/${pid}/watch`, { ms: 5000, durationMs: 30000 });
  assert.equal(r.status, 200, r.error); assert.equal(r.watchedMs, 5000); assert.equal(r.completed, false);
  r = await viewer.req("POST", `/api/clips/${pid}/watch`, { ms: 2000, durationMs: 30000 });
  assert.equal(r.watchedMs, 5000, "never moves backwards");
  r = await viewer.req("POST", `/api/clips/${pid}/watch`, { ms: 28000, durationMs: 30000 });
  assert.equal(r.completed, true, "≥90% counts as completed");
  r = await viewer.req("POST", `/api/clips/${pid}/watch`, { ms: 100, durationMs: 30000, completed: false });
  assert.equal(r.completed, true, "sticky");
  const rows = await db().all("SELECT * FROM clip_watch WHERE user_id=$1 AND post_id=$2", [viewer.id, pid]);
  assert.equal(rows.length, 1); assert.equal(Number(rows[0].watched_ms), 28000); assert.equal(Number(rows[0].completed), 1);
  const agg = await H.app.ctx.services.clips.stats([pid]); assert.deepEqual([agg[pid].watchers, agg[pid].completed], [1, 1]);
  flush();
  const got = (await allPages(viewer, "foryou", 30)).ids;
  assert.ok(!got.includes(pid), "completed recently → excluded from foryou");
  assert.ok((await viewer.req("GET", "/api/clips/feed?tab=following&limit=30")).items.length > 0);
  assert.equal((await viewer.req("POST", `/api/clips/${ids.priv}/watch`, { ms: 1 })).status, 404, "private author's clip");
  assert.equal((await viewer.req("POST", `/api/clips/${ids.blocked}/watch`, { ms: 1 })).status, 404, "blocked author's clip");
  assert.equal((await viewer.req("POST", `/api/clips/${ids.notClip}/watch`, { ms: 1 })).status, 404, "not a clip");
  assert.equal((await viewer.req("POST", `/api/clips/nope/watch`, { ms: 1 })).status, 404);
});

test("watch v2.70 fix: ms 0 never completes, ms clamped to durationMs, beacon (no CSRF header) still needs the session", async () => {
  H.app.ctx.rl.w.clear();
  const zero = ids.bob[1];
  let r = await viewer.req("POST", `/api/clips/${zero}/watch`, { ms: 0, durationMs: 12000, completed: true });
  assert.equal(r.status, 200, r.error); assert.equal(r.completed, false, "explicit completed with nothing played is ignored"); assert.equal(r.watchedMs, 0);
  r = await viewer.req("POST", `/api/clips/${zero}/watch`, { ms: 0, durationMs: 0 });
  assert.equal(r.completed, false);
  r = await viewer.req("POST", `/api/clips/${ids.bob[2]}/watch`, { ms: 99999, durationMs: 30000 });
  assert.equal(r.watchedMs, 30000, "clamped to the clip duration");
  const row = await db().get("SELECT watched_ms, completed FROM clip_watch WHERE user_id=$1 AND post_id=$2", [viewer.id, zero]);
  assert.equal(Number(row.completed), 0);
  r = await viewer.req("POST", `/api/clips/${zero}/watch`, { ms: 3000, durationMs: 12000 }, { "X-Requested-With": "" });
  assert.equal(r.status, 200, "sendBeacon-style request (no X-Requested-With) accepted with the session cookie"); assert.equal(r.watchedMs, 3000);
  assert.equal((await visitor.req("POST", `/api/clips/${zero}/watch`, { ms: 1000, durationMs: 12000 }, { "X-Requested-With": "" })).status, 401, "beacon without a session → 401");
  flush();
});

test("watch is rate-limited", async () => {
  H.app.ctx.rl.w.clear();
  let last;
  for (let i = 0; i < 130; i++) { last = await viewer.req("POST", `/api/clips/${ids.alice[1]}/watch`, { ms: i }); if (last.status === 429) break; }
  assert.equal(last.status, 429);
  H.app.ctx.rl.w.clear();
});

test("migration 070: down drops only clip_watch (posts untouched), up restores it, re-run is a no-op", async () => {
  assert.ok(await hasTable("clip_watch"));
  const posts = Number((await db().get("SELECT COUNT(*) n FROM posts")).n);
  await m070.down(db(), exec);
  assert.ok(!(await hasTable("clip_watch")));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM posts")).n), posts);
  await m070.up(db(), exec); await m070.up(db(), exec);
  assert.ok(await hasTable("clip_watch"));
  await require("../migrations/078_clip_creator").up(db(), exec); // v2.80: later migrations add columns to the table 070 recreated
  H.app.ctx.rl.w.clear();
  const r = await viewer.req("POST", `/api/clips/${ids.alice[3]}/watch`, { ms: 1000, durationMs: 12000 });
  assert.equal(r.status, 200, r.error);
  await assert.rejects(db().run("INSERT INTO clip_watch(user_id, post_id, watched_ms, completed, updated_at) VALUES('u','p',-1,0,$1)", [new Date().toISOString()]), "watched_ms ≥ 0");
  await assert.rejects(db().run("INSERT INTO clip_watch(user_id, post_id, watched_ms, completed, updated_at) VALUES('u','p',1,2,$1)", [new Date().toISOString()]), "completed 0/1");
  assert.ok(require("../lib/compliance-lib").DATA_MAP.find(m => m.t === "clip_watch" && m.erase === "delete"), "data map entry");
});

/* v2.71 — tab=following hardening: follow/unfollow, blocked-but-followed author, private community, pagination, 401, empty, 400. */
test("v2.71 following: guest 401 on tab=following; unknown tab 400; empty following → {items:[], next:null}", async () => {
  assert.equal((await visitor.req("GET", "/api/clips/feed?tab=following")).status, 401);
  assert.equal((await visitor.req("GET", "/api/clips/feed?tab=following&limit=2")).status, 401);
  assert.equal((await viewer.req("GET", "/api/clips/feed?tab=FOLLOWING")).status, 400);
  const lonely = await reg("cf_lonely");
  const r = await lonely.req("GET", "/api/clips/feed?tab=following");
  assert.equal(r.status, 200, r.error); assert.deepEqual(r.items, []); assert.equal(r.next, null);
});

test("v2.71 following: follow → appears, unfollow → gone (fresh first page); blocked author excluded even if followed", async () => {
  const fan = await reg("cf_fan"), star = await reg("cf_star");
  const sid = [await clip(star), await clip(star)];
  H.app.ctx.rl.w.clear();
  assert.equal((await fan.req("GET", "/api/clips/feed?tab=following")).items.length, 0);
  assert.equal((await fan.req("PUT", "/api/follows/" + star.id)).status, 200);
  const got = (await fan.req("GET", "/api/clips/feed?tab=following&limit=30")).items;
  assert.deepEqual(got.map(i => i.id), sid, "newest first");
  assert.ok(got.every(i => i.user?.id === star.id && i.counts && "completion" in i.counts), "same item shape as foryou");
  H.app.ctx.rl.w.clear();
  assert.equal((await fan.req("DELETE", "/api/follows/" + star.id)).status, 200);
  assert.equal((await fan.req("GET", "/api/clips/feed?tab=following&limit=30")).items.length, 0, "unfollowed → gone");
  // follow again, then block: blocked authors never show, even when still followed
  H.app.ctx.rl.w.clear();
  assert.equal((await fan.req("PUT", "/api/follows/" + star.id)).status, 200);
  assert.equal((await fan.req("PUT", "/api/me/prefs", { blocked: [star.id] })).status, 200);
  // force a lingering follow row (blocking may already drop it) so the block filter itself is what's tested
  await db().run("INSERT INTO follows(src, dst, at) VALUES($1,$2,$3) ON CONFLICT (src, dst) DO NOTHING", [fan.id, star.id, new Date().toISOString()]);
  flush();
  assert.equal((await fan.req("GET", "/api/clips/feed?tab=following&limit=30")).items.length, 0, "blocked author excluded even while followed");
  // and the viewer's own block list is honoured for an existing followed author (alice) too
  assert.equal((await viewer.req("PUT", "/api/me/prefs", { blocked: [blocker.id, alice.id] })).status, 200);
  assert.equal((await viewer.req("GET", "/api/clips/feed?tab=following&limit=30")).items.length, 0);
  assert.equal((await viewer.req("PUT", "/api/me/prefs", { blocked: [blocker.id] })).status, 200);
  H.app.ctx.rl.w.clear();
  assert.equal((await viewer.req("PUT", "/api/follows/" + alice.id)).status, 200, "re-follow (blocking may drop the follow)");
});

test("v2.71 following: private-community clip of a followed author hidden from non-members; private author needs an accepted follow", async () => {
  const owner = await reg("cf_cowner"), fan = await reg("cf_cfan");
  H.app.ctx.rl.w.clear();
  const c = await owner.req("POST", "/api/communities", { name: "نادي لقطات خاص", type: "invite" });
  assert.equal(c.status, 200, c.error);
  const open = await clip(owner), inside = await clip(owner);
  await db().run("UPDATE posts SET community=$1 WHERE id=$2", [c.community.id, inside]);
  H.app.ctx.rl.w.clear();
  assert.equal((await fan.req("PUT", "/api/follows/" + owner.id)).status, 200);
  const got = (await fan.req("GET", "/api/clips/feed?tab=following&limit=30")).items.map(i => i.id);
  assert.ok(got.includes(open)); assert.ok(!got.includes(inside), "private community clip stays private");
  // following tab and foryou agree on visibility for the same viewer
  const fy = (await fan.req("GET", "/api/clips/feed?tab=foryou&limit=30")).items.map(i => i.id);
  assert.ok(!fy.includes(inside));
  // a private author: a follow attempt is only a request → nothing in following
  H.app.ctx.rl.w.clear();
  await fan.req("PUT", "/api/follows/" + priv.id);
  const accepted = await db().get("SELECT 1 x FROM follows WHERE src=$1 AND dst=$2", [fan.id, priv.id]);
  const g2 = (await fan.req("GET", "/api/clips/feed?tab=following&limit=30")).items.map(i => i.id);
  assert.equal(g2.includes(ids.priv), !!accepted, "private author's clip only with an accepted follow");
});

test("v2.71 following: limit 1 and 2 walk every page with no repeats/skips, strictly newest-first across pages", async () => {
  flush();
  const ref = (await viewer.req("GET", "/api/clips/feed?tab=following&limit=30")).items;
  assert.ok(ref.length >= 5, "fixture: viewer follows alice's clips");
  for (const lim of [1, 2]) {
    const { ids: got, pages } = await allPages(viewer, "following", lim);
    assert.deepEqual(got, ref.map(i => i.id), `limit ${lim}: same order as one big page`);
    assert.equal(pages, Math.ceil(ref.length / lim));
  }
  const last = await viewer.req("GET", "/api/clips/feed?tab=following&limit=" + ref.length);
  assert.equal(last.next, null, "exact-fit page has no next cursor");
});
