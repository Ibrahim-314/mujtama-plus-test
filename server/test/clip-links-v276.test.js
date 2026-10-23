/* v2.76 — Vidtik links plus: community / event / course targets (author-run only, live only), one link per clip across
 * both tables, deduped click counting visible only to the author, event reminder state, «يظهر في فيديوتك» (clips linking a
 * listing), and the pinned clip on the creator profile. */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");

let H, a, b, clip, clip2;
const db = () => H.app.ctx.db;
const now = () => new Date().toISOString();
const later = (h) => new Date(Date.now() + h * 3600e3).toISOString();
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const cl = new H.Client();
  const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error);
  cl.id = r.user.id;
  return cl;
}
let n = 0;
async function mkClip(cl, text) {
  const id = "clipp_" + ++n;
  await db().run("INSERT INTO posts(id,author,type,text,visibility,status,data,created_at) VALUES($1,$2,'video',$3,'public','published',$4,$5)", [
    id,
    cl.id,
    text,
    { video: { short: true, source: "clips", duration: 10, status: "ready", variants: { "360p": "/media/none.mp4" } } },
    new Date(Date.now() - n * 60000).toISOString()
  ]);
  return id;
}

test.before(async () => {
  H = await boot({});
  a = await mk("lp_a");
  b = await mk("lp_b");
  clip = await mkClip(a, "مقطع أول");
  clip2 = await mkClip(a, "مقطع ثانٍ");
  await db().run("INSERT INTO communities(id,name,type,owner,created_at) VALUES('cm_a','مجتمع المصممين','public',$1,$2)", [a.id, now()]);
  await db().run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES('cm_a',$1,'owner',$2)", [a.id, now()]);
  await db().run("INSERT INTO communities(id,name,type,owner,created_at) VALUES('cm_b','مجتمع آخر','public',$1,$2)", [b.id, now()]);
  await db().run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES('cm_b',$1,'member',$2)", [a.id, now()]);
  await db().run("INSERT INTO events(id,name,starts_at,place,organizer,status,created_at) VALUES('ev_a','لقاء المصممين',$1,'أونلاين',$2,'upcoming',$3)", [later(48), a.id, now()]);
  await db().run("INSERT INTO events(id,name,starts_at,place,organizer,status,created_at) VALUES('ev_old','لقاء قديم',$1,'أونلاين',$2,'past',$3)", [new Date(Date.now() - 864e5).toISOString(), a.id, now()]);
  await db().run("INSERT INTO courses(id,community_id,author,title,status,access,created_at,updated_at) VALUES('co_a','cm_a',$1,'أساسيات التصميم','published','free',$2,$2)", [a.id, now()]);
  await db().run("INSERT INTO courses(id,community_id,author,title,status,access,created_at,updated_at) VALUES('co_d','cm_a',$1,'مسودة','draft','free',$2,$2)", [a.id, now()]);
  await db().run("INSERT INTO market_listings (id, seller_id, title, price, category, status, created_at, updated_at) VALUES ('ml_p1',$1,'قلم رقمي',1e8,'other','active',$2,$2)", [a.id, now()]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("linkables include only communities I run, upcoming events I organise, published courses I wrote", async () => {
  const lk = await a.req("GET", "/api/clips/linkables");
  assert.equal(lk.status, 200, lk.error);
  const ids = lk.items.map((x) => x.kind + ":" + x.id).sort();
  assert.deepEqual(ids, ["community:cm_a", "course:co_a", "event:ev_a", "product:ml_p1"]);
  const cm = lk.items.find((x) => x.kind === "community");
  assert.equal(cm.href, "#/c/cm_a");
  assert.equal(cm.members, 1);
  assert.equal(lk.items.find((x) => x.kind === "course").sub, "دورة مجانية");
  assert.ok(lk.items.find((x) => x.kind === "event").at);
});

test("set community / event / course, one link per clip, guards", async () => {
  assert.equal((await a.req("PUT", `/api/clips/${clip}/link`, { kind: "community", id: "cm_b" })).status, 400, "a member, not a manager");
  assert.equal((await a.req("PUT", `/api/clips/${clip}/link`, { kind: "event", id: "ev_old" })).status, 400, "past event");
  assert.equal((await a.req("PUT", `/api/clips/${clip}/link`, { kind: "course", id: "co_d" })).status, 400, "draft course");
  assert.equal((await b.req("PUT", `/api/clips/${clip}/link`, { kind: "community", id: "cm_a" })).status, 403, "not the author");
  const p = await a.req("PUT", `/api/clips/${clip}/link`, { kind: "product", id: "ml_p1" });
  assert.equal(p.status, 200, p.error);
  const c = await a.req("PUT", `/api/clips/${clip}/link`, { kind: "community", id: "cm_a" });
  assert.equal(c.status, 200, c.error);
  assert.equal(c.link.kind, "community");
  const v = await b.req("GET", `/api/clips/${clip}/link`);
  assert.equal(v.link.kind, "community", "the newer link replaced the product");
  assert.equal(v.link.clicks, undefined, "viewers never see the click count");
  const e = await a.req("PUT", `/api/clips/${clip}/link`, { kind: "event", id: "ev_a" });
  assert.equal(e.link.href, "#/event/ev_a");
  assert.equal((await b.req("GET", `/api/clips/${clip}/link`)).link.reminded, false);
  await b.req("PUT", "/api/events/ev_a/rsvp/reminder");
  assert.equal((await b.req("GET", `/api/clips/${clip}/link`)).link.reminded, true);
  const co = await a.req("PUT", `/api/clips/${clip}/link`, { kind: "course", id: "co_a" });
  assert.equal(co.link.href, "#/course/co_a");
  await db().run("UPDATE courses SET status='draft' WHERE id='co_a'");
  assert.equal((await b.req("GET", `/api/clips/${clip}/link`)).link, null, "an unpublished course shows nothing");
  await db().run("UPDATE courses SET status='published' WHERE id='co_a'");
  const del = await a.req("DELETE", `/api/clips/${clip}/link`);
  assert.equal(del.status, 200, del.error);
  assert.equal((await b.req("GET", `/api/clips/${clip}/link`)).link, null);
});

test("clicks: one per viewer per day, author's own taps ignored, count only for the author", async () => {
  await a.req("PUT", `/api/clips/${clip}/link`, { kind: "product", id: "ml_p1" });
  const c1 = await b.req("POST", `/api/clips/${clip}/link/click`);
  assert.equal(c1.status, 200, c1.error);
  assert.equal(c1.counted, true);
  assert.equal((await b.req("POST", `/api/clips/${clip}/link/click`)).counted, false, "same viewer, same day");
  assert.equal((await a.req("POST", `/api/clips/${clip}/link/click`)).counted, false, "author");
  assert.equal((await a.req("GET", `/api/clips/${clip}/link`)).link.clicks, 1);
  assert.equal((await b.req("POST", `/api/clips/${clip2}/link/click`)).counted, false, "a clip with no link");
});

test("«يظهر في فيديوتك»: clips that link a listing, hidden once the listing ends", async () => {
  await a.req("PUT", `/api/clips/${clip}/link`, { kind: "product", id: "ml_p1" });
  const r = await b.req("GET", "/api/clips/linked?kind=product&id=ml_p1");
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.items.map((x) => x.id), [clip]);
  assert.ok(r.items[0].user);
  assert.equal((await b.req("GET", "/api/clips/linked?kind=course&id=co_a")).status, 400);
  await db().run("UPDATE market_listings SET status='removed' WHERE id='ml_p1'");
  assert.deepEqual((await b.req("GET", "/api/clips/linked?kind=product&id=ml_p1")).items, []);
  await db().run("UPDATE market_listings SET status='active' WHERE id='ml_p1'");
});

test("pinned clip comes first on the creator profile and is not repeated", async () => {
  assert.equal((await b.req("PUT", `/api/clips/${clip2}/pin`)).status, 403, "not your clip");
  const p = await a.req("PUT", `/api/clips/${clip2}/pin`);
  assert.equal(p.status, 200, p.error);
  const pf = await b.req("GET", "/api/clips/creator/lp_a");
  assert.equal(pf.status, 200, pf.error);
  assert.equal(pf.items[0].id, clip2);
  assert.equal(pf.items[0].pinned, true);
  assert.equal(pf.items.filter((x) => x.id === clip2).length, 1);
  assert.equal(pf.items.find((x) => x.id === clip).pinned, false);
  await a.req("PUT", `/api/clips/${clip}/pin`);
  assert.equal((await b.req("GET", "/api/clips/creator/lp_a")).items[0].id, clip, "re-pinning moves the pin");
  const u = await a.req("DELETE", "/api/clips/pin");
  assert.equal(u.status, 200, u.error);
  assert.ok((await b.req("GET", "/api/clips/creator/lp_a")).items.every((x) => !x.pinned));
});
