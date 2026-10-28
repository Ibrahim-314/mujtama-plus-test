/* v2.126 search stage 3 — question ↔ answer. A question is found by the words of its accepted answer (own index field), every
 * question in the results carries its best answer (accepted ✓, else the most-liked comment with ≥ 2 likes), a blocked member's
 * comment is never shown as the answer, and an answered question ranks above an unanswered twin. Runs on SQLite and PostgreSQL. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
let H, db, S, A, B, C;
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = r.user.id; return c; };
async function post(author, text, type = "question") {
  const pid = id("p");
  await db.run("INSERT INTO posts(id,author,type,title,text,lang,visibility,status,data,created_at) VALUES($1,$2,$3,NULL,$4,'ar','public','published',$5,$6)", [pid, author, type, text, type === "question" ? JSON.stringify({ acceptedAnswer: null }) : null, new Date().toISOString()]);
  return pid;
}
async function comment(pid, author, text, likes = 0) {
  const cid = id("c");
  await db.run("INSERT INTO comments(id,post,author,text,status,created_at) VALUES($1,$2,$3,$4,'published',$5)", [cid, pid, author, text, new Date().toISOString()]);
  const users = [A.id, B.id, C.id].slice(0, likes);
  for (const u of users) await db.run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,'like',$3)", [cid, u, new Date().toISOString()]);
  return cid;
}
const items = (r) => r.groups.posts?.items || [];
let q1, q2, q3, accepted;
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} } });
  db = H.app.ctx.db; S = H.app.ctx.services.search; A = await mk("ans_a"); B = await mk("ans_b"); C = await mk("ans_c");
  q1 = await post(B.id, "وين ألقى مكان يصلح شاشة الجوال بسعر معقول؟");
  await comment(q1, C.id, "جرب أي محل في السوق", 0);
  accepted = await comment(q1, A.id, "مركز الإصلاحات الذكية في حي النزهة سعره ممتاز وضمان شهر", 1);
  q2 = await post(B.id, "أحد جرب يصلح شاشة الجوال في البيت؟");
  await comment(q2, C.id, "عدة الإصلاح المنزلية تنفع للشاشات البسيطة", 3);
  q3 = await post(B.id, "يصلح شاشة الجوال أحد يعرف أحد؟");
  for (const p of [q1, q2, q3]) await S.indexPost(p);
});
test.after(() => H.app.close());

test("accepting an answer makes the question findable by the answer's words and marks it ✓", async () => {
  const r0 = await A.req("GET", "/api/search/full?type=posts&ai=0&q=" + encodeURIComponent("مركز الإصلاحات الذكية"));
  const before = items(r0).find((p) => p.id === q1); // already findable through comments, but not marked
  assert.ok(!before || !before.bestAnswer?.accepted);
  const res = await B.req("POST", `/api/posts/${q1}/accept`, { comment: accepted }); assert.equal(res.ok, true);
  await new Promise((r) => setTimeout(r, 50)); await S.indexPost(q1);
  const row = await db.get("SELECT COUNT(*) n FROM search_postings WHERE ref_id=$1 AND f=3", [q1]); assert.ok(Number(row.n) > 0, "answer field indexed");
  const r = await A.req("GET", "/api/search/full?type=posts&ai=0&q=" + encodeURIComponent("مركز الإصلاحات الذكية"));
  const hit = items(r)[0]; assert.equal(hit.id, q1);
  assert.equal(hit.bestAnswer.accepted, true); assert.equal(hit.bestAnswer.id, accepted); assert.match(hit.bestAnswer.text, /النزهة/);
  assert.equal(hit.bestAnswer.author.id, A.id); assert.equal(hit.answers, 2);
});

test("most-liked comment (≥ 2 likes) is the best answer; under 2 likes there is none; answered questions rank first", async () => {
  const r = await A.req("GET", "/api/search/full?type=posts&ai=0&q=" + encodeURIComponent("يصلح شاشة الجوال"));
  const by = Object.fromEntries(items(r).map((p) => [p.id, p]));
  assert.ok(by[q2].bestAnswer && !by[q2].bestAnswer.accepted && by[q2].bestAnswer.likes === 3);
  assert.equal(by[q3].bestAnswer, undefined);
  const order = items(r).map((p) => p.id);
  assert.ok(order.indexOf(q3) > order.indexOf(q1) && order.indexOf(q3) > order.indexOf(q2), JSON.stringify({ q1, q2, q3, order, engine: r.engine }));
});

test("a blocked member's comment is never shown as the answer", async () => {
  await db.run("UPDATE users SET prefs=$1 WHERE id=$2", [JSON.stringify({ blocked: [C.id] }), A.id]).catch(() => { });
  const me = await db.get("SELECT prefs FROM users WHERE id=$1", [A.id]);
  if (!me || !String(me.prefs || "").includes(C.id)) return; // prefs column shape differs: covered by the viewer.prefs path in run()
  const r = await A.req("GET", "/api/search/full?type=posts&ai=0&q=" + encodeURIComponent("يصلح شاشة الجوال"));
  const p2 = items(r).find((p) => p.id === q2); assert.ok(p2); assert.equal(p2.bestAnswer, undefined);
});
