/* v2.122 search quality gate. Seeds the evaluation corpus straight into SQL (no events → the reconciler must find it), then
 * scores every query: recall@5 (share of wanted posts in the top 5) and MRR. Per-category floors only ratchet upward as stages
 * land; the report is printed and written to SEARCH_EVAL_OUT when set. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
const { posts, queries } = require("./fixtures/search-eval");
// Floors ratchet up stage by stage (baseline v2.122 stage 0: ALL recall 0.813, semantic 0.167).
// v2.124 (generic understanding on the inverted index): every lexical category at 1; «sound» = loanwords in no list.
// v2.125 (local meaning vectors, hybrid RRF, z-score floor, legacy word guesser off on the index): semantic 0.5 with no junk; the rest go
// through the AI Hub query plan in production (no AI in this test).
const FLOOR = { exact: 1, natural: 1, dialect: 1, typo: 1, morph: 1, comment: 1, article: 1, english: 1, mixed: 1, sound: 1, semantic: 0.5 };
let H, db, C; const K = {};
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} } });
  db = H.app.ctx.db; H.app.ctx.rl.w.clear();
  C = new H.Client(); const r = await C.req("POST", "/api/auth/register", { name: "مقيّم البحث", handle: "eval_reader", password: "secret123" });
  const W = new H.Client(); H.app.ctx.rl.w.clear(); const w = await W.req("POST", "/api/auth/register", { name: "كاتب", handle: "eval_writer", password: "secret123" });
  assert.ok(r.user && w.user);
  let i = 0;
  for (const p of posts) {
    const pid = id("p"); K[p.k] = pid; i++;
    await db.run("INSERT INTO posts(id,author,type,title,text,lang,visibility,status,data,created_at) VALUES($1,$2,$3,$4,$5,'ar',$6,'published',$7,$8)",
      [pid, w.user.id, p.type || "post", p.title || null, p.text || "", p.visibility || "public", p.doc ? JSON.stringify({ doc: p.doc, readingMin: 1 }) : null, new Date(Date.now() - i * 3600e3).toISOString()]);
    for (const c of p.comments || []) await db.run("INSERT INTO comments(id,post,author,text,status,created_at) VALUES($1,$2,$3,$4,'published',$5)", [id("c"), pid, w.user.id, c, new Date().toISOString()]);
  }
});
test.after(() => H.app.close());

test("coverage reconciler indexes posts written without events and drops orphans", async () => {
  const S = H.app.ctx.services.search;
  const before = await S.coverage(); assert.ok(before.docs < before.posts, JSON.stringify(before));
  const r = await S.reconcile(); assert.ok(r.added >= posts.length, JSON.stringify(r));
  const after = await S.coverage(); assert.equal(after.ratio, 1, JSON.stringify(after));
  await db.run("UPDATE posts SET status='removed' WHERE id=$1", [K.ship]);
  assert.equal((await S.reconcile()).removed, 1);
  await db.run("UPDATE posts SET status='published' WHERE id=$1", [K.ship]); await S.reconcile();
  assert.equal((await S.reconcile()).added, 0, "idempotent");
});

test("quality: recall@5 and MRR per category stay above the floors", async () => {
  const byId = Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k]));
  const cats = {}, rows = [];
  for (const q of queries) {
    const r = await C.req("GET", "/api/search/full?type=posts&limit=10&q=" + encodeURIComponent(q.q));
    const got = (r.groups?.posts?.items || []).map((p) => byId[p.id] || "?");
    assert.ok(!got.includes("priv"), "followers-only post never shown to a stranger: " + q.q);
    const top = got.slice(0, 5), hit = q.want.filter((w) => top.includes(w)).length / q.want.length;
    const rank = got.findIndex((g) => q.want.includes(g)), rr = rank < 0 ? 0 : 1 / (rank + 1);
    (cats[q.cat] ||= { n: 0, recall: 0, mrr: 0 }); cats[q.cat].n++; cats[q.cat].recall += hit; cats[q.cat].mrr += rr;
    rows.push({ q: q.q, cat: q.cat, want: q.want, got: got.slice(0, 5), recall: hit });
  }
  const rep = {}; let tr = 0, tm = 0;
  for (const [c, v] of Object.entries(cats)) { rep[c] = { n: v.n, recall: +(v.recall / v.n).toFixed(3), mrr: +(v.mrr / v.n).toFixed(3) }; tr += v.recall; tm += v.mrr; }
  rep.ALL = { n: queries.length, recall: +(tr / queries.length).toFixed(3), mrr: +(tm / queries.length).toFixed(3) };
  console.log(JSON.stringify(rep));
  for (const x of rows.filter((x) => x.recall < 1)) console.log("MISS", x.cat, x.q, "want", x.want.join(","), "got", x.got.join(","));
  if (process.env.SEARCH_EVAL_OUT) require("fs").writeFileSync(process.env.SEARCH_EVAL_OUT, JSON.stringify({ rep, rows }, null, 1));
  const low = Object.entries(FLOOR).filter(([c, f]) => rep[c] && rep[c].recall < f).map(([c, f]) => `${c} ${rep[c].recall} < ${f}`);
  assert.deepEqual(low, [], "categories under their floor");
});
