/* v2.132 search stage 9 — «اسأل الذكاء» v2. A follow-up is resolved against the thread (standalone question drives retrieval);
 * a compound question is split into ≤ 3 sub-searches whose hits are all represented; one planning call + one answer call;
 * answers cite only visible posts (a followers-only post is never offered to the model); simple questions skip the planner. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
let H, db, A, B; const calls = [], K = {};
const free = { label: "مجتمع بلس", async chat(msgs) {
  const q = msgs[msgs.length - 1].content; calls.push(q);
  if (q.includes("السؤال الحالي")) {
    if (q.includes("وللمبتدئين")) return { text: JSON.stringify({ standalone: "أفضل طريقة لتعلم بايثون للمبتدئين", subqueries: [] }), model: "m" };
    if (q.includes("قارن")) return { text: JSON.stringify({ standalone: null, subqueries: ["تعلم بايثون", "تعلم جافاسكربت"] }), model: "m" };
    return { text: JSON.stringify({ standalone: null, subqueries: [] }), model: "m" };
  }
  if (q.startsWith("حوّل سؤال البحث")) return { text: JSON.stringify({ concepts: [] }), model: "m" };
  const ids = [...q.matchAll(/"id":"(p_[a-z0-9]+)"/g)].map((m) => m[1]);
  return { text: JSON.stringify({ found: true, answer: "جواب من المنشورات.", points: ids.slice(0, 3).map((i) => ({ text: "نقطة", cites: [i] })), followups: [] }), model: "m" };
} };
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = r.user.id; return c; };
async function post(k, text, vis = "public") {
  const pid = id("p"); K[k] = pid;
  await db.run("INSERT INTO posts(id,author,type,text,lang,visibility,status,created_at) VALUES($1,$2,'post',$3,'ar',$4,'published',$5)", [pid, B.id, text, vis, new Date().toISOString()]);
  await H.app.ctx.services.search.indexPost(pid);
}
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} }, aihubOpts: { env: { AIHUB_SEAL_KEY: "t" }, freeProvider: free } });
  db = H.app.ctx.db; A = await mk("ask_a"); B = await mk("ask_b");
  await post("pyB", "أفضل طريقة لتعلم بايثون للمبتدئين: ابدأ بمشاريع صغيرة");
  await post("pyPro", "بايثون للمحترفين: الأنماط المتقدمة والأداء");
  await post("js", "تعلم جافاسكربت من الصفر عبر بناء صفحات بسيطة");
  await post("priv", "ملاحظاتي الخاصة عن تعلم بايثون للمبتدئين", "followers");
});
test.after(() => H.app.close());
const ask = (body) => A.req("POST", "/api/aihub/search", body);

test("simple question: no planner call", async () => {
  calls.length = 0; const r = await ask({ q: "تعلم بايثون" });
  assert.equal(r.found, true); assert.equal(calls.filter((c) => c.includes("السؤال الحالي")).length, 0);
});
test("follow-up resolved from the thread drives retrieval; private never offered", async () => {
  calls.length = 0;
  const r = await ask({ q: "وللمبتدئين؟", history: [{ q: "كيف أتعلم بايثون؟", a: "ابدأ بالأساسيات" }] });
  assert.equal(r.standalone, "أفضل طريقة لتعلم بايثون للمبتدئين");
  assert.ok(r.related.includes(K.pyB)); assert.ok(!r.related.includes(K.priv));
  assert.ok(calls.length >= 2 && calls.length <= 3 && calls[0].includes("السؤال الحالي"), "planner first, then (thin results) the concept plan, then the answer");
  assert.ok(!calls.join("\n").includes(K.priv), "followers-only post never sent to the model");
  assert.match(calls[calls.length - 1], /سياق المحادثة السابقة/);
});
test("compound question: sub-searches, every step represented", async () => {
  const r = await ask({ q: "قارن بين تعلم بايثون وتعلم جافاسكربت للمبتدئين؟" });
  assert.ok(r.steps, JSON.stringify(r));
  assert.deepEqual(r.steps.map((x) => x.q), ["تعلم بايثون", "تعلم جافاسكربت"]);
  assert.ok(r.related.includes(K.js) && (r.related.includes(K.pyB) || r.related.includes(K.pyPro)), JSON.stringify(r.related));
});
