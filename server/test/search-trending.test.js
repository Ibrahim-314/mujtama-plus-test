/* v2.131 search stage 8 — the search landing shows trends for the reader's region (city → country → Arab world, from the profile
 * location) with a region switcher, and topics ranked by this week's public activity. Runs on SQLite and PostgreSQL. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
let H, db, A, R;
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} } });
  db = H.app.ctx.db; H.app.ctx.rl.w.clear();
  A = new H.Client(); const r = await A.req("POST", "/api/auth/register", { name: "قارئ جدة", handle: "tr_jed", password: "secret123" }); A.id = r.user.id;
  await db.run("UPDATE users SET location='جدة', country='SA' WHERE id=$1", [A.id]);
  R = new H.Client(); H.app.ctx.rl.w.clear(); const r2 = await R.req("POST", "/api/auth/register", { name: "كاتب", handle: "tr_w", password: "secret123" }); R.id = r2.user.id;
  for (let i = 0; i < 6; i++) {
    const pid = id("p"), city = i < 4 ? "جدة" : "الرياض", tag = i < 4 ? "مهرجان_البحر" : "موسم_الرياض";
    await db.run("INSERT INTO posts(id,author,type,text,lang,visibility,status,topic,location,created_at) VALUES($1,$2,'post',$3,'ar','public','published',$4,$5,$6)", [pid, i % 2 ? R.id : A.id, `#${tag} منشور ${i}`, i < 5 ? "dev" : "ai", city, new Date(Date.now() - i * 60e3).toISOString()]);
    await db.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3)", [pid, tag, new Date().toISOString()]);
  }
  await H.app.ctx.services.trends.compute();
});
test.after(() => H.app.close());

test("default region is the reader's most local scope; switcher offers city, country, Arab world", async () => {
  const t = await A.req("GET", "/api/search/trending");
  assert.deepEqual(t.scopes.map((x) => x.scope), ["global", "country", "city"]);
  assert.equal(t.scope.scope, "city"); assert.equal(t.scope.key, "جدة");
  assert.ok(t.trends.every((x) => x.tag !== "موسم_الرياض"), JSON.stringify(t.trends));
  const g = await A.req("GET", "/api/search/trending?scope=global&key=");
  assert.equal(g.scope.scope, "global");
  assert.equal(t.topics[0].slug, "dev"); assert.equal(t.topics[0].posts, 5);
});
test("signed out: Arab world trends, no personal scopes", async () => {
  const anon = new H.Client(); const t = await anon.req("GET", "/api/search/trending");
  assert.deepEqual(t.scopes.map((x) => x.scope), ["global"]); assert.equal(t.history.length, 0);
});
