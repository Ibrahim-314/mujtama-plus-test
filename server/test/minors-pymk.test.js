/* v2.67 privacy fix (fix-pymk-minors): "people you may know" never crosses age bands.
 * Matrix over GET /api/suggestions/follow and the bootstrap suggestion pool: an adult never gets a minor, a minor never
 * gets an unrelated adult, the minor's guardian link is kept, minors still see each other, and no payload carries age data. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, adult, adult2, guardian, teen, teen2;
const ymd = (y) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };
const mk = async (handle, birthDate) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123", birthDate }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };
const sugg = async (c) => { const r = await c.req("GET", "/api/suggestions/follow?limit=30"); assert.equal(r.status, 200, r.error); return r.suggestions.map(s => s.user.id); };
const pool = async (c) => { const r = await c.req("GET", "/api/bootstrap"); assert.equal(r.status, 200, r.error); return r.users.map(u => u.id); };
const AGE_KEYS = /"(birthDate|birth_date|age|ageBand|band|dob)"\s*:/;

test.before(async () => {
  H = await boot();
  await mk("pk_admin", ymd(50)); // first account becomes admin (staff see everything) — keep it out of the matrix
  adult = await mk("pk_adult", ymd(30)); adult2 = await mk("pk_adult2", ymd(41)); guardian = await mk("pk_guard", ymd(45));
  teen = await mk("pk_teen", ymd(15)); teen2 = await mk("pk_teen2", ymd(16));
  // an existing family link (pending → no follow needed to prove the link alone keeps the guardian)
  await H.app.ctx.db.run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,'active',$2,$4,$5)", ["gl_pk1", guardian.id, teen.id, {}, Date.now()]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("adult viewer: follow suggestions and bootstrap pool never include minors", async () => {
  for (const c of [adult, adult2]) {
    const s = await sugg(c), p = await pool(c);
    assert.equal(s.includes(teen.id) || s.includes(teen2.id), false, "no minors in follow suggestions");
    assert.equal(p.includes(teen.id) || p.includes(teen2.id), false, "no minors in bootstrap pool");
  }
  assert.ok((await sugg(adult)).includes(adult2.id), "adults are still suggested to adults (feature intact)");
});

test("minor viewer: no unrelated adults; other minors still suggested", async () => {
  const s = await sugg(teen2), p = await pool(teen2);
  for (const a of [adult, adult2, guardian]) { assert.equal(s.includes(a.id), false, "no unrelated adult in suggestions"); assert.equal(p.includes(a.id), false, "no unrelated adult in pool"); }
  assert.ok(s.includes(teen.id), "minors can be suggested to minors");
});

test("guardian link kept: the minor's own guardian may appear, other adults may not", async () => {
  const s = await sugg(teen), p = await pool(teen);
  assert.ok(s.includes(guardian.id), "linked guardian kept in suggestions");
  assert.ok(p.includes(guardian.id), "linked guardian kept in pool");
  assert.equal(s.includes(adult.id) || s.includes(adult2.id), false);
  // the guardian (an adult) still never gets other minors suggested, and the existing adult-side rule is unchanged
  assert.equal((await sugg(guardian)).includes(teen2.id), false);
  const fs = H.app.ctx.services.minors.filterSuggest;
  assert.deepEqual((await fs([{ id: guardian.id }, { id: adult.id }, { id: teen2.id }], teen.id)).map(u => u.id), [guardian.id, teen2.id]);
  await H.app.ctx.db.run("UPDATE guardian_links SET status='ended' WHERE id='gl_pk1'"); H.app.ctx.cache?.del?.("minors:v:" + teen.id);
  assert.equal((await sugg(teen)).includes(guardian.id), false, "an ended link no longer keeps the adult");
});

test("an existing follow keeps the connection (both directions)", async () => {
  await H.app.ctx.db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [teen2.id, adult.id, Date.now()]);
  assert.ok((await pool(teen2)).includes(adult.id), "minor keeps an adult they already follow");
  assert.ok((await pool(adult)).includes(teen2.id), "adult keeps a minor that follows them (pre-existing rule)");
});

test("no age or birth date leaks in people payloads", async () => {
  for (const [c, path] of [[adult, "/api/suggestions/follow"], [teen, "/api/suggestions/follow"], [teen, "/api/bootstrap"], [adult, "/api/search/suggest?q=" + encodeURIComponent("عضو")], [teen2, "/api/search/suggest?q=" + encodeURIComponent("عضو")], [adult, "/api/search?q=" + encodeURIComponent("عضو")]]) {
    const r = await c.req("GET", path); assert.equal(r.status, 200, path + " " + r.error);
    const txt = JSON.stringify({ s: r.suggestions, u: r.users, p: r.people });
    assert.equal(AGE_KEYS.test(txt), false, "age field in " + path);
    assert.equal(txt.includes(ymd(15)) || txt.includes(ymd(16)), false, "birth date in " + path);
  }
});

test("visitors cannot read follow suggestions", async () => {
  const r = await new H.Client().req("GET", "/api/suggestions/follow"); assert.equal(r.status, 401);
});
