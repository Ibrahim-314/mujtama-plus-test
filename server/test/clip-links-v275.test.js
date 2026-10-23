/* v2.75 — clip ↔ product / job link: author-only, own active listing / open job only, resolved in the clips feed and
 * GET /api/clips/:id/link, hidden once the target closes, cleared by DELETE; linkables lists only the author's live targets. */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");

let H, a, b, clip, otherClip;
const db = () => H.app.ctx.db;
const now = () => new Date().toISOString();
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
  const id = "clipl_" + ++n;
  await db().run("INSERT INTO posts(id,author,type,text,visibility,status,data,created_at) VALUES($1,$2,'video',$3,'public','published',$4,$5)", [
    id,
    cl.id,
    text,
    { video: { short: true, duration: 10, status: "ready", variants: { "360p": "/media/none.mp4" } } },
    new Date(Date.now() - n * 60000).toISOString()
  ]);
  return id;
}
const listing = (id, seller, status = "active") =>
  db().run("INSERT INTO market_listings (id, seller_id, title, price, category, status, created_at, updated_at) VALUES ($1,$2,$3,$4,'other',$5,$6,$6)", [id, seller, "سماعة لاسلكية", 25e7, status, now()]);
const job = (id, poster, status = "open") =>
  db().run("INSERT INTO jobs (id, poster_id, kind, title, body, category, status, created_at, updated_at, published_at) VALUES ($1,$2,'job',$3,'وصف','dev',$4,$5,$5,$5)", [id, poster, "مطوّر واجهات", status, now()]);

test.before(async () => {
  H = await boot({});
  a = await mk("cl_a");
  b = await mk("cl_b");
  clip = await mkClip(a, "مقطع المنتج");
  otherClip = await mkClip(b, "مقطع آخر");
  await listing("ml_a1", a.id);
  await listing("ml_a2", a.id, "removed");
  await listing("ml_b1", b.id);
  await job("job_a1", a.id);
  await job("job_a2", a.id, "closed");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("linkables, set/resolve/clear, ownership and liveness guards", async () => {
  const lk = await a.req("GET", "/api/clips/linkables");
  assert.equal(lk.status, 200, lk.error);
  assert.deepEqual(lk.items.map(x => x.id).sort(), ["job_a1", "ml_a1"]);
  const set = await a.req("PUT", `/api/clips/${clip}/link`, { kind: "product", id: "ml_a1" });
  assert.equal(set.status, 200, set.error);
  assert.equal(set.link.title, "سماعة لاسلكية");
  assert.equal(set.link.sub, "25 Pi");
  assert.equal(set.link.href, "#/market/item/ml_a1");
  const view = await b.req("GET", `/api/clips/${clip}/link`);
  assert.equal(view.link.id, "ml_a1");
  const feed = await b.req("GET", "/api/clips/feed?tab=foryou");
  const it = feed.items.find(x => x.id === clip);
  assert.ok(it, "clip in feed");
  assert.equal(it.link.kind, "product");
  assert.equal(feed.items.find(x => x.id === otherClip).link, null);
  // guards
  assert.equal((await b.req("PUT", `/api/clips/${clip}/link`, { kind: "product", id: "ml_b1" })).status, 403, "not the author");
  assert.equal((await a.req("PUT", `/api/clips/${clip}/link`, { kind: "product", id: "ml_b1" })).status, 400, "someone else's listing");
  assert.equal((await a.req("PUT", `/api/clips/${clip}/link`, { kind: "product", id: "ml_a2" })).status, 400, "inactive listing");
  assert.equal((await a.req("PUT", `/api/clips/${clip}/link`, { kind: "job", id: "job_a2" })).status, 400, "closed job");
  assert.equal((await a.req("PUT", `/api/clips/${clip}/link`, { kind: "coupon", id: "x" })).status, 400, "bad kind");
  // switch to a job, then the job closes → nothing shows
  const sj = await a.req("PUT", `/api/clips/${clip}/link`, { kind: "job", id: "job_a1" });
  assert.equal(sj.link.href, "#/job/job_a1");
  await db().run("UPDATE jobs SET status='closed' WHERE id='job_a1'");
  assert.equal((await b.req("GET", `/api/clips/${clip}/link`)).link, null);
  await db().run("UPDATE jobs SET status='open' WHERE id='job_a1'");
  const del = await a.req("DELETE", `/api/clips/${clip}/link`);
  assert.equal(del.status, 200, del.error);
  assert.equal((await b.req("GET", `/api/clips/${clip}/link`)).link, null);
});
