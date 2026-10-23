/* Phase 62 — scheduled publishing queue + content series: schedule with a time zone, queue, edit, publish now, cancel → draft,
 * idempotent publisher (concurrent ticks publish + notify once), scheduled story lifetime, failing author → failed + notified,
 * series CRUD, add / reorder / remove, next / previous navigation, follow → one notification per new episode (also when it
 * comes from the schedule), visibility respected, series analytics, migration 045. PostgreSQL + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, A, B, C;
const db = () => H.app.ctx.db, sv = () => H.app.ctx.services;
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const later = (min) => new Date(Date.now() + min * 60e3).toISOString();
test.before(async () => { H = await boot(); A = await mk("sr_author"); B = await mk("sr_fan"); C = await mk("sr_other"); });
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 045 reversible + additive; data map entries", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '045_series' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "045_series"]);
  await assert.rejects(() => db().get("SELECT 1 FROM content_series"));
  assert.deepEqual(await mig.up(db()), ["045_series", ...after]);
  for (const t of ["post_schedules", "content_series", "content_series_follows"]) { const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [A.id]); }
});

test("schedule with a time zone → queue; validation; edit text/time/zone; publish now", async () => {
  assert.equal((await A.req("POST", "/api/schedule", { post: { type: "post", text: "قريب جداً" }, publishAt: new Date(Date.now() + 10e3).toISOString() })).status, 400, "≥ 1 minute ahead");
  assert.equal((await A.req("POST", "/api/schedule", { post: { type: "post", text: "بعيد جداً" }, publishAt: later(60 * 24 * 400) })).status, 400, "≤ 1 year");
  const r = await A.req("POST", "/api/schedule", { post: { type: "post", text: "منشور مجدول للمساء" }, publishAt: later(120), tz: "Asia/Riyadh" });
  assert.equal(r.status, 200, r.error); assert.equal(r.post.status, "scheduled"); assert.equal(r.item.tz, "Asia/Riyadh");
  const bad = await A.req("POST", "/api/schedule", { post: { type: "post", text: "منطقة غير صالحة" }, publishAt: later(130), tz: "Mars/Olympus" });
  assert.equal(bad.status, 200); assert.equal(bad.item.tz, null, "invalid zones are dropped, not stored");
  const q = await A.req("GET", "/api/schedule");
  assert.equal(q.items.length, 2); assert.ok(q.items[0].publishAt <= q.items[1].publishAt, "sorted by time");
  assert.equal((await B.req("GET", "/api/schedule")).items.length, 0, "only my own queue");
  assert.equal((await B.req("PATCH", "/api/schedule/" + r.post.id, { text: "اختراق" })).status, 404);
  const e = await A.req("PATCH", "/api/schedule/" + r.post.id, { text: "نص معدّل قبل النشر", publishAt: later(240), tz: "Africa/Cairo" });
  assert.equal(e.status, 200, e.error); assert.equal(e.item.tz, "Africa/Cairo"); assert.match(e.item.text, /معدّل/);
  assert.ok(Date.parse(e.item.publishAt) > Date.now() + 230 * 60e3);
  assert.equal((await A.req("PATCH", "/api/schedule/" + r.post.id, { publishAt: later(-5) })).status, 400);
  const pn = await A.req("POST", `/api/schedule/${r.post.id}/now`);
  assert.equal(pn.ok, true); assert.equal((await db().get("SELECT status FROM posts WHERE id=$1", [r.post.id])).status, "published");
  assert.equal((await db().get("SELECT state FROM post_schedules WHERE post_id=$1", [r.post.id])).state, "published");
  assert.equal((await A.req("POST", `/api/schedule/${r.post.id}/now`)).status, 404, "already published");
  // composer path (POST /api/posts with publishAt) is tracked too
  const cp = await A.req("POST", "/api/posts", { type: "post", text: "من المحرر مباشرة", publishAt: later(90) });
  assert.equal(cp.post.status, "scheduled");
  await new Promise((r) => setTimeout(r, 30));
  assert.ok((await A.req("GET", "/api/schedule")).items.some((x) => x.id === cp.post.id));
});

test("cancel moves it back to drafts; the publisher never publishes a cancelled post", async () => {
  const r = await A.req("POST", "/api/schedule", { post: { type: "article", title: "مقال سيُلغى", markdown: "# عنوان\nنص المقال الكامل هنا" }, publishAt: later(60) });
  assert.equal(r.status, 200, r.error);
  const c = await A.req("DELETE", "/api/schedule/" + r.post.id);
  assert.equal(c.ok, true); assert.ok(c.draftId);
  const d = (await A.req("GET", "/api/drafts")).drafts.find((x) => x.id === c.draftId);
  assert.ok(d); assert.equal(d.data.type, "article"); assert.equal(d.data.title, "مقال سيُلغى");
  await db().run("UPDATE posts SET publish_at=$1 WHERE id=$2", [later(-1), r.post.id]);
  await sv().content.publishDue();
  assert.equal((await db().get("SELECT status FROM posts WHERE id=$1", [r.post.id])).status, "deleted");
});

test("idempotent publisher: concurrent ticks publish once and emit once; scheduled story lives 24 h from publication", async () => {
  const p = await A.req("POST", "/api/schedule", { post: { type: "post", text: "منشور السباق" }, publishAt: later(2) });
  const st = await A.req("POST", "/api/schedule", { post: { type: "story", text: "قصة مجدولة" }, publishAt: later(60 * 30) });
  assert.equal(st.post.status, "scheduled");
  await db().run("UPDATE posts SET publish_at=$1 WHERE id IN ($2,$3)", [later(-1), p.post.id, st.post.id]);
  let emitted = 0; const on = (e) => { if ([p.post.id, st.post.id].includes(e.post?.id || e.post)) emitted++; };
  H.app.ctx.bus.on("POST_PUBLISHED", on);
  const [a, b, c] = await Promise.all([sv().content.publishDue(), sv().content.publishDue(), sv().content.publishDue()]);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(a + b + c, 2, "each post claimed by exactly one tick"); assert.equal(emitted, 2);
  const story = await db().get("SELECT status, created_at, expires_at FROM posts WHERE id=$1", [st.post.id]);
  assert.equal(story.status, "published");
  assert.ok(Math.abs(Date.parse(story.expires_at) - Date.parse(story.created_at) - 864e5) < 5000, "24 h from publication");
  const n = await db().all("SELECT id FROM notifications WHERE user_id=$1 AND kind='scheduled' AND post=$2", [A.id, p.post.id]);
  assert.equal(n.length, 1, "the author is told once");
});

test("a scheduled post of a suspended author is retried, then failed + the author notified", async () => {
  const X = await mk("sr_susp");
  const r = await X.req("POST", "/api/schedule", { post: { type: "post", text: "لن يُنشر" }, publishAt: later(5) });
  await db().run("UPDATE users SET status='suspended' WHERE id=$1", [X.id]);
  for (let i = 0; i < 5; i++) { await db().run("UPDATE posts SET publish_at=$1 WHERE id=$2 AND status='scheduled'", [later(-1), r.post.id]); await sv().content.publishDue(); }
  const s = await db().get("SELECT state, attempts, last_error FROM post_schedules WHERE post_id=$1", [r.post.id]);
  assert.equal(s.state, "failed"); assert.equal(Number(s.attempts), 5); assert.ok(s.last_error);
  assert.equal((await db().get("SELECT status FROM posts WHERE id=$1", [r.post.id])).status, "scheduled", "kept, not lost");
  assert.equal((await db().all("SELECT id FROM notifications WHERE user_id=$1 AND kind='schedule_failed'", [X.id])).length, 1);
  await db().run("UPDATE users SET status='active' WHERE id=$1", [X.id]);
  const q = (await X.req("GET", "/api/schedule")).items.find((i) => i.id === r.post.id);
  assert.equal(q.state, "failed");
  const fix = await X.req("PATCH", "/api/schedule/" + r.post.id, { publishAt: later(3) });
  assert.equal(fix.item.state, "queued", "rescheduling clears the failure");
});

let sid; const eps = [];
test("series: create, add episodes (published + scheduled), reorder, next / previous navigation, permissions", async () => {
  assert.equal((await A.req("POST", "/api/cseries", { title: "x" })).status, 400);
  const s = await A.req("POST", "/api/cseries", { title: "رحلة تعلم البرمجة", descr: "سلسلة أسبوعية للمبتدئين", kind: "series" });
  assert.equal(s.status, 200, s.error); sid = s.series.id; assert.match(sid, /^cs_/);
  for (let i = 1; i <= 3; i++) { H.app.ctx.rl.w.clear(); eps.push((await A.req("POST", "/api/posts", { type: "article", title: `الحلقة ${i}: أساسيات`, markdown: `محتوى الحلقة ${i} ` + "نص ".repeat(30) })).post.id); }
  for (const e of eps) { const r = await A.req("POST", `/api/cseries/${sid}/items`, { postId: e }); assert.equal(r.status, 200, r.error); }
  assert.equal((await B.req("POST", `/api/cseries/${sid}/items`, { postId: eps[0] })).status, 404, "not my series");
  const foreign = (await C.req("POST", "/api/posts", { type: "post", text: "منشور شخص آخر" })).post.id;
  assert.equal((await A.req("POST", `/api/cseries/${sid}/items`, { postId: foreign })).status, 400, "own posts only");
  const sch = await A.req("POST", "/api/schedule", { post: { type: "article", title: "الحلقة 4: قادمة", markdown: "قريباً" }, publishAt: later(60), seriesId: sid });
  assert.equal(sch.status, 200, sch.error); assert.equal(sch.item.series.id, sid);
  let g = await A.req("GET", "/api/cseries/" + sid);
  assert.equal(g.items.length, 4); assert.equal(g.series.episodes, 3); assert.equal(g.items[3].status, "scheduled"); assert.equal(g.me.owner, true);
  g = await B.req("GET", "/api/cseries/" + sid);
  assert.equal(g.items.length, 3, "scheduled episodes hidden from readers"); assert.deepEqual(g.items.map((x) => x.episode), [1, 2, 3]);
  // reorder: move episode 3 up
  const ro = await A.req("PUT", `/api/cseries/${sid}/order`, { postId: eps[2], move: "up" });
  assert.equal(ro.status, 200, ro.error); assert.deepEqual(ro.items.filter((x) => x.episode).map((x) => x.id), [eps[0], eps[2], eps[1]]);
  assert.equal((await A.req("PUT", `/api/cseries/${sid}/order`, { postIds: [eps[0]] })).status, 400, "a full order must include every episode");
  const full = await A.req("PUT", `/api/cseries/${sid}/order`, { postIds: [eps[0], eps[1], eps[2], sch.post.id] });
  assert.equal(full.status, 200);
  const nav = await B.req("GET", "/api/cseries/for-post/" + eps[1]);
  assert.equal(nav.episode, 2); assert.equal(nav.total, 3); assert.equal(nav.prev.id, eps[0]); assert.equal(nav.next.id, eps[2]);
  const last = await B.req("GET", "/api/cseries/for-post/" + eps[2]); assert.equal(last.next, null);
  assert.equal((await B.req("GET", "/api/cseries/for-post/" + foreign)).series, null);
  // a post is in at most one series: adding it to another moves it
  const s2 = await A.req("POST", "/api/cseries", { title: "مجموعة مختارة", kind: "collection" });
  await A.req("POST", `/api/cseries/${s2.series.id}/items`, { postId: eps[2] });
  assert.equal((await db().all("SELECT series_id FROM content_series_items WHERE post_id=$1", [eps[2]])).length, 1);
  await A.req("POST", `/api/cseries/${sid}/items`, { postId: eps[2] });
  const mine = await A.req("GET", "/api/cseries?mine=1");
  assert.equal(mine.series.length, 2); assert.equal(mine.series.find((x) => x.id === sid).scheduled, 1);
  assert.equal((await B.req("GET", "/api/cseries?author=sr_author")).series.length, 2);
  const ul = await A.req("PATCH", `/api/cseries/${s2.series.id}`, { visibility: "unlisted" }); assert.equal(ul.series.visibility, "unlisted");
  assert.equal((await B.req("GET", "/api/cseries?author=sr_author")).series.length, 1, "unlisted not on the profile list");
  assert.equal((await B.req("GET", "/api/cseries/" + s2.series.id)).status, 200, "but reachable by link");
});

test("follow a series → one notification per new episode (direct, scheduled, added late); visibility respected; resume", async () => {
  const f = await B.req("PUT", `/api/cseries/${sid}/follow`); assert.equal(f.following, true); assert.equal(f.followers, 1);
  assert.equal((await A.req("PUT", `/api/cseries/${sid}/follow`)).status, 400, "not my own");
  await C.req("PUT", `/api/cseries/${sid}/follow`);
  // the scheduled episode is published by the worker
  const sched = (await A.req("GET", "/api/cseries/" + sid)).items.find((x) => x.status === "scheduled");
  await db().run("UPDATE posts SET publish_at=$1 WHERE id=$2", [later(-1), sched.id]);
  await Promise.all([sv().content.publishDue(), sv().content.publishDue()]);
  await new Promise((r) => setTimeout(r, 80));
  const nB = await db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='series_episode'", [B.id]);
  assert.equal(nB.length, 1, "once, even with two ticks"); assert.equal(nB[0].post, sched.id);
  await sv().series.episodePublished(sched.id);
  assert.equal((await db().all("SELECT id FROM notifications WHERE user_id=$1 AND kind='series_episode'", [B.id])).length, 1, "idempotent");
  // a followers-only episode: C does not follow the author → not notified
  await B.req("POST", "/api/users/" + A.id + "/follow").catch(() => { });
  const fo = await A.req("POST", "/api/posts", { type: "article", title: "حلقة للمتابعين", markdown: "خاصة " + "نص ".repeat(10), visibility: "followers" });
  await A.req("POST", `/api/cseries/${sid}/items`, { postId: fo.post.id });
  const cN = await db().all("SELECT id FROM notifications WHERE user_id=$1 AND kind='series_episode' AND post=$2", [C.id, fo.post.id]);
  assert.equal(cN.length, 0, "never told about what they cannot see");
  // mute notifications but keep following
  const m = await B.req("PUT", `/api/cseries/${sid}/follow`, { notify: false }); assert.equal(m.notify, false);
  // resume: B read episode 1 → next unread is episode 2
  const first = (await B.req("GET", "/api/cseries/" + sid)).items[0];
  await B.req("POST", `/api/posts/${first.id}/view`, { source: "series" });
  const g = await B.req("GET", "/api/cseries/" + sid);
  assert.equal(g.me.following, true); assert.equal(g.me.seen, 1); assert.equal(g.me.resume.episode, 2);
  assert.equal((await B.req("GET", "/api/cseries?following=1")).series[0].id, sid);
});

test("series analytics: readers per episode, retention, completion, followers weekly; owner only; delete", async () => {
  const items = (await A.req("GET", "/api/cseries/" + sid)).items.filter((x) => x.episode);
  for (const u of [B.id, C.id]) await db().run("INSERT INTO post_views(post,user_id,source,at) VALUES($1,$2,'series',$3)", [items[0].id, u, new Date().toISOString()]);
  await db().run("INSERT INTO post_views(post,user_id,source,at) VALUES($1,$2,'series',$3)", [items[items.length - 1].id, C.id, new Date().toISOString()]);
  const s = await A.req("GET", `/api/cseries/${sid}/stats`);
  assert.equal(s.status, 200, s.error);
  assert.equal(s.totals.readersFirst, 2); assert.equal(s.totals.completion, 50); assert.equal(s.totals.followers, 2);
  assert.equal(s.episodes[0].retention, 100); assert.equal(s.followersWeekly.length, 8); assert.match(s.episodes[0].href, /^#\/analytics\/post\//);
  assert.equal((await B.req("GET", `/api/cseries/${sid}/stats`)).status, 404);
  const d = await A.req("DELETE", "/api/cseries/" + sid); assert.equal(d.ok, true);
  assert.equal((await B.req("GET", "/api/cseries/" + sid)).status, 404);
  assert.equal((await db().get("SELECT COUNT(*) n FROM content_series_items WHERE series_id=$1", [sid])).n * 1, 0);
});
