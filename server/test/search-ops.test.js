/* v2.128 search stage 5 — operators. Parser (incl. Arabic aliases and Arabic digits), and end to end: from:, @mention, #tag,
 * "exact phrase", -word, since:/until:, min_faves:, min_replies:, filter:media/questions/links (and -filter:), lang:, near:, and
 * operators with no free text browse newest first. Private posts stay hidden; operators never get a spelling or AI rewrite. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const OPS = require("../lib/search-ops");
const { boot } = require("./helpers");
const { id } = require("../lib/core");

test("parser", () => {
  const p = OPS.parse('من:@Sara "تعلم الآلة" -جافا منذ:٢٠٢٦-٠١-٠١ until:2026-02-01 min_faves:5 filter:media -filter:links lang:EN near:جدة #ذكاء @omar كلمة');
  assert.deepEqual(p.ops.from, ["sara"]); assert.deepEqual(p.ops.phrases, ["تعلم الآلة"]); assert.deepEqual(p.ops.exclude, ["جافا"]);
  assert.equal(new Date(p.ops.since).getUTCFullYear(), 2026); assert.ok(p.ops.until); assert.equal(p.ops.minFaves, 5);
  assert.deepEqual(p.ops.filters, ["media"]); assert.deepEqual(p.ops.notFilters, ["links"]); assert.equal(p.ops.lang, "en"); assert.equal(p.ops.near, "جدة");
  assert.deepEqual(p.ops.tags, ["ذكاء"]); assert.deepEqual(p.ops.mention, ["omar"]);
  assert.equal(p.text, "تعلم الآلة كلمة"); assert.equal(p.active, true);
  assert.equal(OPS.parse("http://x.com رابط").active, false, "a URL is not an operator");
  assert.equal(OPS.parse("react OR vue").active, false);
});

let H, db, S, A, B, C; const K = {};
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = r.user.id; return c; };
async function post(k, author, text, o = {}) {
  const pid = id("p"); K[k] = pid;
  await db.run("INSERT INTO posts(id,author,type,title,text,lang,visibility,status,location,data,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6,'published',$7,$8,$9)",
    [pid, author, o.type || "post", text, o.lang || "ar", o.vis || "public", o.loc || null, o.data ? JSON.stringify(o.data) : null, new Date(Date.parse(o.at || "2026-06-01T10:00:00Z")).toISOString()]);
  for (const t of o.tags || []) await db.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3)", [pid, t, new Date().toISOString()]);
  for (let i = 0; i < (o.likes || 0); i++) await db.run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,'like',$3)", [pid, [A.id, B.id, C.id][i], new Date().toISOString()]);
  for (let i = 0; i < (o.replies || 0); i++) await db.run("INSERT INTO comments(id,post,author,text,status,created_at) VALUES($1,$2,$3,$4,'published',$5)", [id("c"), pid, C.id, "رد " + i, new Date().toISOString()]);
  await S.indexPost(pid);
}
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} } });
  db = H.app.ctx.db; S = H.app.ctx.services.search; A = await mk("op_a"); B = await mk("op_sara"); C = await mk("op_omar");
  await post("s1", B.id, "دورة تعلم الآلة للمبتدئين بلغة بايثون", { at: "2026-01-10T10:00:00Z", likes: 3, replies: 2, tags: ["ذكاء"], data: { images: ["/media/abcdef123.jpg"] } });
  await post("s2", B.id, "تعلم الآلة مع جافا تجربة مختلفة", { at: "2026-03-10T10:00:00Z", likes: 1 });
  await post("o1", C.id, "مقال عن تعلم الآلة في جدة https://example.com/ml", { at: "2026-02-01T10:00:00Z", loc: "جدة", type: "question" });
  await post("o2", C.id, "machine learning roadmap for beginners", { lang: "en", at: "2026-02-05T10:00:00Z" });
  await post("m1", C.id, "شكراً @op_sara على شرح تعلم الآلة", { at: "2026-04-01T10:00:00Z" });
  await post("pv", B.id, "تعلم الآلة ملاحظات خاصة", { vis: "followers", at: "2026-05-01T10:00:00Z" });
});
test.after(() => H.app.close());
const find = async (q, type = "posts") => { const r = await A.req("GET", `/api/search/full?ai=0&type=${type}&q=` + encodeURIComponent(q)); const back = Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k])); return { r, got: (r.groups.posts?.items || []).map((p) => back[p.id] || "?") }; };

test("from:, @mention, #tag, phrase and -word", async () => {
  assert.deepEqual((await find("تعلم الآلة from:op_sara")).got.sort(), ["s1", "s2"]);
  assert.deepEqual((await find("تعلم الآلة @op_sara")).got, ["m1"]);
  assert.deepEqual((await find("تعلم الآلة #ذكاء")).got, ["s1"]);
  assert.equal(OPS.parse("#ذكاء").active, false, "a lone tag keeps the classic tag search"); assert.equal(OPS.parse("@op_sara").active, false);
  assert.deepEqual((await find('"مع جافا"')).got, ["s2"]);
  const nj = (await find("تعلم الآلة -جافا")).got; assert.ok(nj.includes("s1") && !nj.includes("s2") && !nj.includes("pv"));
});
test("dates, counts, filters, lang and near", async () => {
  assert.deepEqual((await find("تعلم الآلة since:2026-01-01 until:2026-01-31")).got, ["s1"]);
  assert.deepEqual((await find("تعلم الآلة min_faves:2 min_replies:1")).got, ["s1"]);
  assert.deepEqual((await find("تعلم الآلة filter:media")).got, ["s1"]);
  assert.deepEqual((await find("تعلم الآلة filter:questions filter:links")).got, ["o1"]);
  assert.ok(!(await find("تعلم الآلة -filter:links")).got.includes("o1"));
  assert.deepEqual((await find("تعلم الآلة near:جدة")).got, ["o1"]);
  assert.deepEqual((await find("machine learning lang:en")).got, ["o2"]);
});
test("operators alone browse newest first; private hidden; no rewrite", async () => {
  const { r, got } = await find("from:op_sara", "all");
  assert.equal(r.engine, "operators"); assert.deepEqual(got, ["s2", "s1"]);
  assert.equal(r.corrected, null); assert.equal(r.didYouMean, null); assert.deepEqual(r.ops.from, ["op_sara"]);
  assert.deepEqual((await find("from:nobody_here")).got, []);
});
