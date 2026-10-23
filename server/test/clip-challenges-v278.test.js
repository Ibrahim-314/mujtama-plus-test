/* v2.78 — «تحدي الأسبوع»: staff-only create/edit/cancel/restore, entries = clips with the #tag inside the window,
 * top ranking keeps each creator's best clip, private / blocked / out-of-window / non-clip videos never count,
 * finalising after the end stores the top three once and notifies each winner once; migration 077 is reversible. */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");
const CH = require("../services/challenges");

let H, staff, a, b, c;
const db = () => H.app.ctx.db;
const H1 = 3600e3;
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
async function clip(cl, tag, { ago = 60e3, source = "clips", visibility = "public", likes = 0 } = {}) {
  const id = "chc_" + ++n;
  await db().run("INSERT INTO posts(id,author,type,text,visibility,status,data,created_at) VALUES($1,$2,'video',$3,$4,'published',$5,$6)", [
    id, cl.id, "لقطة #" + tag, visibility,
    { video: { short: true, source, duration: 10, status: "ready", variants: { "360p": "/media/none.mp4" } } },
    new Date(Date.now() - ago).toISOString()
  ]);
  await db().run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3)", [id, tag, new Date().toISOString()]);
  for (let i = 0; i < likes; i++) {
    const u = "lk" + i;
    await db().run("INSERT INTO users(id,handle,name,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [u, "liker" + i, "معجب " + i, new Date().toISOString()]);
    await db().run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,'like',$3)", [id, u, new Date().toISOString()]);
  }
  return id;
}
const iso = (ms) => new Date(Date.now() + ms).toISOString();

test.before(async () => {
  H = await boot({});
  staff = await mk("ch_staff", "admin");
  a = await mk("ch_a");
  b = await mk("ch_b");
  c = await mk("ch_c");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("pure: score, tag cleaning, phase, per-creator ranking", () => {
  assert.equal(CH.challengeScore({ likes: 2, comments: 1, shares: 1, completed: 3 }), 2 + 2 + 3 + 3);
  assert.equal(CH.challengeScore(), 0);
  assert.equal(CH.cleanTag("#تحدي_الطبخ"), "تحدي_الطبخ");
  assert.equal(CH.cleanTag("  طبخ سريع "), "طبخ_سريع");
  assert.equal(CH.cleanTag("#"), null);
  assert.equal(CH.cleanTag("a b!"), null);
  const c0 = { status: "active", starts_at: iso(-H1), ends_at: iso(H1) };
  assert.equal(CH.phase(c0), "live");
  assert.equal(CH.phase({ ...c0, starts_at: iso(H1), ends_at: iso(2 * H1) }), "upcoming");
  assert.equal(CH.phase({ ...c0, ends_at: iso(-1000) }), "ended");
  assert.equal(CH.phase({ ...c0, status: "cancelled" }), "cancelled");
  const r = CH.rank([{ id: "1", author: "x", score: 5, created_at: "2" }, { id: "2", author: "x", score: 9, created_at: "3" }, { id: "3", author: "y", score: 5, created_at: "1" }]);
  assert.deepEqual(r.map((e) => e.id), ["2", "3"]);
});

test("only staff can create; validation and same-tag overlap guard", async () => {
  const body = { title: "تحدي الطبخ", tag: "#طبخ_سريع", body: "أسرع وصفة في 30 ثانية", startsAt: iso(-H1), endsAt: iso(6 * 24 * H1) };
  const no = await a.req("POST", "/api/clips/challenges", body);
  assert.equal(no.status, 403);
  const bad = await staff.req("POST", "/api/clips/challenges", { ...body, tag: "!" });
  assert.equal(bad.status, 400);
  const long = await staff.req("POST", "/api/clips/challenges", { ...body, endsAt: iso(40 * 24 * H1) });
  assert.equal(long.status, 400);
  const ok = await staff.req("POST", "/api/clips/challenges", body);
  assert.equal(ok.status, 200, ok.error);
  assert.equal(ok.challenge.tag, "طبخ_سريع");
  assert.equal(ok.challenge.phase, "live");
  const dup = await staff.req("POST", "/api/clips/challenges", body);
  assert.equal(dup.status, 400);
  const guest = new H.Client();
  assert.equal((await guest.req("GET", "/api/clips/challenges")).status, 401);
});

test("entries, ranking, visibility, me, pagination", async () => {
  const tag = "رسم_سريع";
  const cr = await staff.req("POST", "/api/clips/challenges", { title: "تحدي الرسم", tag, startsAt: iso(-2 * H1), endsAt: iso(5 * 24 * H1) });
  assert.equal(cr.status, 200, cr.error);
  const cid = cr.challenge.id;
  const a1 = await clip(a, tag, { likes: 1 });
  const a2 = await clip(a, tag, { likes: 4 });
  const b1 = await clip(b, tag, { likes: 2 });
  await clip(c, tag, { ago: 3 * H1, likes: 9 }); // before the window
  await clip(c, tag, { source: "post", likes: 9 }); // regular post video, not a clip
  await clip(c, tag, { visibility: "followers", likes: 9 }); // not visible to others
  const top = await b.req("GET", `/api/clips/challenges/${cid}`);
  assert.equal(top.status, 200, top.error);
  assert.deepEqual(top.items.map((x) => x.id), [a2, b1]);
  assert.deepEqual(top.items.map((x) => x.rank), [1, 2]);
  assert.equal(top.me.rank, 2);
  assert.equal(top.me.entries, 1);
  const nw = await b.req("GET", `/api/clips/challenges/${cid}?sort=new&limit=2`);
  assert.equal(nw.items.length, 2);
  assert.ok(nw.next);
  const nw2 = await b.req("GET", `/api/clips/challenges/${cid}?sort=new&limit=2&offset=${nw.next}`);
  assert.deepEqual([...nw.items, ...nw2.items].map((x) => x.id).sort(), [a1, a2, b1].sort());
  // a viewer who blocked a creator does not see their entries
  await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [{ blocked: [a.id] }, b.id]);
  const blk = await b.req("GET", `/api/clips/challenges/${cid}`);
  assert.deepEqual(blk.items.map((x) => x.id), [b1]);
  await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [{}, b.id]);
  const ls = await c.req("GET", "/api/clips/challenges");
  assert.equal(ls.status, 200, ls.error);
  assert.ok(ls.current);
  assert.equal(ls.staff, false);
});

test("edit rules, cancel hides from members, restore brings it back", async () => {
  const cr = await staff.req("POST", "/api/clips/challenges", { title: "تحدي قادم", tag: "قادم_جدا", startsAt: iso(24 * H1), endsAt: iso(3 * 24 * H1) });
  assert.equal(cr.status, 200, cr.error);
  const cid = cr.challenge.id;
  assert.equal(cr.challenge.phase, "upcoming");
  const ed = await staff.req("PATCH", `/api/clips/challenges/${cid}`, { tag: "قادم_جديد", title: "تحدي قادم جديد" });
  assert.equal(ed.status, 200, ed.error);
  assert.equal(ed.challenge.tag, "قادم_جديد");
  assert.equal((await a.req("PATCH", `/api/clips/challenges/${cid}`, { title: "xxx" })).status, 403);
  const cn = await staff.req("POST", `/api/clips/challenges/${cid}/cancel`);
  assert.equal(cn.challenge.status, "cancelled");
  assert.equal((await a.req("GET", `/api/clips/challenges/${cid}`)).status, 404);
  assert.equal((await staff.req("GET", `/api/clips/challenges/${cid}`)).status, 200);
  const ls = await staff.req("GET", "/api/clips/challenges");
  assert.ok(ls.cancelled.some((x) => x.id === cid));
  const rs = await staff.req("POST", `/api/clips/challenges/${cid}/restore`);
  assert.equal(rs.challenge.status, "active");
  // a live challenge keeps its tag and start
  const live = await staff.req("POST", "/api/clips/challenges", { title: "تحدي جارٍ", tag: "جار_الان", startsAt: iso(-H1), endsAt: iso(2 * 24 * H1) });
  assert.equal((await staff.req("PATCH", `/api/clips/challenges/${live.challenge.id}`, { tag: "اخر" })).status, 400);
  const ext = await staff.req("PATCH", `/api/clips/challenges/${live.challenge.id}`, { endsAt: iso(4 * 24 * H1) });
  assert.equal(ext.status, 200, ext.error);
});

test("finalise once after the end: top three creators with score, one notification each", async () => {
  const tag = "منتهي_الان";
  const at = new Date().toISOString();
  await db().run("INSERT INTO clip_challenges(id,title,tag,body,starts_at,ends_at,status,created_by,created_at,updated_at) VALUES('chl_done','تحدي منتهٍ',$1,'',$2,$3,'active',$4,$5,$5)", [tag, iso(-5 * H1), iso(-1000), staff.id, at]);
  const w1 = await clip(a, tag, { ago: 2 * H1, likes: 5 });
  const w2 = await clip(b, tag, { ago: 2 * H1, likes: 3 });
  await clip(c, tag, { ago: 2 * H1, likes: 0 }); // no engagement → never a winner
  const [r1, r2] = await Promise.all([a.req("GET", "/api/clips/challenges/chl_done"), b.req("GET", "/api/clips/challenges")]);
  assert.equal(r1.status, 200, r1.error);
  assert.equal(r2.status, 200, r2.error);
  assert.deepEqual(r1.challenge.winners.map((w) => w.postId), [w1, w2]);
  const p = r2.past.find((x) => x.id === "chl_done");
  assert.deepEqual(p.winners.map((w) => w.rank), [1, 2]);
  await a.req("GET", "/api/clips/challenges/chl_done");
  const na = await db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='clip_challenge_win'", [a.id]);
  const nc = await db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='clip_challenge_win'", [c.id]);
  assert.equal(na.length, 1);
  assert.equal(nc.length, 0);
  assert.equal((await staff.req("PATCH", "/api/clips/challenges/chl_done", { title: "تعديل" })).status, 400);
});

test("migration 077 down/up is reversible", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '077_clip_challenges' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "077_clip_challenges"]);
  assert.deepEqual(await mig.up(db()), ["077_clip_challenges", ...later]);
});
