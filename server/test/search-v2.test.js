/* v2.121 search v2 («البحث الذكي»): natural questions with fillers/dialect, attached prepositions and plurals; comments make a post
 * findable (half weight); two-word queries keep AND; the background upgrade re-indexes old rows; migration 083 down/up;
 * POST /api/aihub/search answers only from visible posts with real citations, uses the AI plan only when retrieval is thin,
 * caches, and never leaks a private post. Runs on SQLite and PostgreSQL. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
let H, db, A, B, calls = [];
const free = { label: "مجتمع بلس", async chat(msgs) {
  const q = msgs[msgs.length - 1].content; calls.push(q);
  if (q.startsWith("حوّل سؤال البحث") && !q.includes("كوفي")) return { text: JSON.stringify({ concepts: [] }), model: "m" };
  if (q.startsWith("حوّل سؤال البحث")) return { text: JSON.stringify({ concepts: [["كوفي", "مقهى", "قهوه"], ["الرياض"]], date: null, type: null, rewritten: "مقهى الرياض" }), model: "m" };
  // cite the post that actually carries the answer (retrieval order is the ranker's business, not this mock's)
  const seg = q.split('{"id":"').slice(1).find((x) => x.includes("النخبة")), ids = seg ? [seg.slice(0, seg.indexOf('"'))] : [...q.matchAll(/"id":"(p_[a-z0-9]+)"/g)].map((m) => m[1]);
  return { text: JSON.stringify({ found: true, answer: "الأغلب ينصحون بمحمصة النخبة.", points: [{ text: "محمصة النخبة في الروضة", cites: [ids[0], "p_fake"] }, { text: "بلا مصدر", cites: [] }], followups: ["وش أفضل وقت للزيارة؟"] }), model: "m" };
} };
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = r.user.id; return c; };
async function seed(author, text, o = {}) {
  const pid = id("p");
  await db.run("INSERT INTO posts(id,author,type,title,text,lang,visibility,status,created_at) VALUES($1,$2,'post',$3,$4,'ar',$5,'published',$6)", [pid, author, o.title || null, text, o.visibility || "public", new Date(Date.now() - (o.ageMin || 1) * 60e3).toISOString()]);
  for (const c of o.comments || []) await db.run("INSERT INTO comments(id,post,author,text,status,created_at) VALUES($1,$2,$3,$4,'published',$5)", [id("c"), pid, author, c, new Date().toISOString()]);
  await H.app.ctx.services.search.indexPost(pid); return pid;
}
const ids = (r) => (r.groups.posts?.items || []).map((p) => p.id);
let p1, _p2, p3, pPriv;
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} }, aihubOpts: { env: { AIHUB_SEAL_KEY: "t" }, freeProvider: free } });
  db = H.app.ctx.db; A = await mk("sv2_a"); B = await mk("sv2_b");
  p1 = await seed(B.id, "مين يعرف محمصة زينة في جدة؟", { comments: ["جربوا محمصة النخبة في حي الروضة قهوتهم ممتازة"] });
  _p2 = await seed(B.id, "أفضل محامص جدة برأيي: الحمراء والشاطئ", { ageMin: 60 });
  p3 = await seed(B.id, "رحلة قصيرة إلى أبها والجو رائع");
  pPriv = await seed(B.id, "محمصة سرية في جدة لا يعرفها أحد", { visibility: "followers" });
});
test.after(() => H.app.close());

test("natural question: fillers dropped, «بجدة» matches جدة, comment hits count; 2-word AND kept", async () => {
  const S = H.app.ctx.services.search;
  assert.deepEqual(S.variants("بجده").sort(), ["بجده", "جده"]);
  const r = await A.req("GET", "/api/search/full?q=" + encodeURIComponent("وش أفضل محمصة بجدة؟ تكفون"));
  assert.ok(ids(r).includes(p1), JSON.stringify(ids(r)));
  assert.ok(!ids(r).includes(p3));
  assert.ok(!ids(r).includes(pPriv), "followers-only post hidden from a non-follower");
  const byComment = await A.req("GET", "/api/search/full?q=" + encodeURIComponent("النخبة"));
  assert.deepEqual(ids(byComment), [p1], "found through its comment");
  const and = await A.req("GET", "/api/search/full?q=" + encodeURIComponent("رحلة جدة"));
  assert.equal(ids(and).length, 0, "two concepts → both required");
});

test("background upgrade re-indexes rows of the old index version; migration 083 rolls back and forward", async () => {
  await db.run("UPDATE search_docs SET iv=1, extra=NULL WHERE ref_id=$1", [p1]);
  const u = await H.app.ctx.services.search.upgradeIndex();
  assert.ok(u.upgraded >= 1);
  const row = await db.get("SELECT iv, extra, quality FROM search_docs WHERE ref_id=$1", [p1]);
  assert.equal(Number(row.iv), H.app.ctx.services.search.IV); assert.match(row.extra, /نخبه/); assert.ok(Number(row.quality) > 0);
  const m = require("../migrations/083_search_v2");
  const exec = (sql) => db.exec ? db.exec(sql) : db.run(sql);
  await m.down(db, exec); await m.up(db, exec); await m.up(db, exec); // idempotent
  await H.app.ctx.services.search.indexPost(p1);
  assert.equal(Number((await db.get("SELECT iv FROM search_docs WHERE ref_id=$1", [p1])).iv), H.app.ctx.services.search.IV);
});

test("AI search: answers from visible posts, drops invented/uncited points, plan only when thin, cached", async () => {
  calls = [];
  const r = await A.req("POST", "/api/aihub/search", { q: "وش أفضل محمصة بجدة؟" });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.found, true); assert.match(r.answer, /النخبة/);
  assert.equal(r.points.length, 1); assert.deepEqual(r.points[0].cites, [p1]);
  assert.deepEqual(Object.keys(r.sources), [p1]);
  assert.ok(!JSON.stringify(calls).includes("سرية"), "private post never sent to the model");
  assert.ok(calls[0].includes("قهوتهم ممتازة"), "comments sent as context");
  assert.equal(calls.length, 1, "retrieval was enough → no plan call");
  const again = await A.req("POST", "/api/aihub/search", { q: "وش أفضل محمصة بجدة؟" });
  assert.equal(again.cached, true); assert.equal(calls.length, 1);
});

test("AI search: thin retrieval → query plan (synonyms) → found; nothing at all → found:false without sources", async () => {
  const pr = await seed(B.id, "افتتاح مقهى جديد في الرياض بحي الملقا");
  calls = [];
  const r = await A.req("POST", "/api/aihub/search", { q: "ابي كوفي حلو بالرياض" });
  assert.equal(r.status, 200, r.error);
  assert.ok(calls[0].startsWith("حوّل سؤال البحث"), "plan asked first");
  assert.equal(r.plan.rewritten, "مقهى الرياض"); assert.ok(r.related.includes(pr));
  const none = await A.req("POST", "/api/aihub/search", { q: "طائرات ورقية زرقاء" });
  assert.equal(none.found, false); assert.deepEqual(none.sources, {});
  assert.equal((await new H.Client().req("POST", "/api/aihub/search", { q: "x" })).status, 401);
});
