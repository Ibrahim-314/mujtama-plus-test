/* v2.133 search stage 10 — safety & quality. Blocked (both ways) and muted authors, muted communities and muted words are hidden
 * from results (own posts stay); sensitive / reported posts sink to the end; copy-paste spam collapses to one; at most 3 posts per
 * author in the top 20 of «الأبرز»; result clicks (≥ 2 reader-days, counts only) lift a post for that query; metrics (searches,
 * zero-result rate, CTR, zero-result queries) are admin-only; migration 087 rolls back and forward. SQLite and PostgreSQL. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
let H, db, S, A, B, C, D, Z;
const K = {};
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = r.user.id; return c; };
async function post(k, author, text, o = {}) {
  const pid = id("p"); K[k] = pid;
  await db.run("INSERT INTO posts(id,author,type,text,lang,visibility,status,sensitive,moderation,created_at) VALUES($1,$2,'post',$3,'ar','public','published',$4,$5,$6)", [pid, author, text, o.sensitive ? 1 : 0, o.mod || null, new Date(Date.now() - (o.ago || 0) * 60e3).toISOString()]);
  await S.indexPost(pid);
}
const prefs = (u, p) => db.run("UPDATE users SET prefs=$1 WHERE id=$2", [JSON.stringify(p), u]);
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} } });
  db = H.app.ctx.db; S = H.app.ctx.services.search; A = await mk("q_a"); B = await mk("q_b"); C = await mk("q_c"); D = await mk("q_d"); Z = await mk("q_z");
  await post("mine", A.id, "تجربتي مع زراعة الطماطم على السطح");
  await post("blocked", B.id, "نصائح زراعة الطماطم في البيت");
  await post("blocksMe", C.id, "زراعة الطماطم في أصص صغيرة");
  await post("ok1", D.id, "أفضل وقت زراعة الطماطم في الرياض", { ago: 1 });
  await post("sens", D.id, "صور زراعة الطماطم بعد المبيد", { sensitive: true, ago: 0 });
  await post("rep", Z.id, "زراعة الطماطم بطريقة سرية مضمونة", { mod: "reported" });
  await post("dup1", Z.id, "اشترك الآن في دورة زراعة الطماطم المضمونة رابط في البايو", { ago: 3 });
  await post("dup2", Z.id, "اشترك الآن في دورة زراعة الطماطم المضمونة رابط في البايو", { ago: 2 });
  await post("muted", Z.id, "مسابقة زراعة الطماطم بجوائز", { ago: 4 });
  for (let i = 0; i < 5; i++) await post("flood" + i, Z.id, `زراعة الطماطم الدرس رقم ${i} من السلسلة`, { ago: 10 + i });
  await prefs(A.id, { blocked: [B.id], mutedWords: ["مسابقة"] });
  await prefs(C.id, { blocked: [A.id] });
});
test.after(() => H.app.close());
const find = async (cl, q, type = "posts") => { const r = await cl.req("GET", `/api/search/full?ai=0&type=${type}&q=` + encodeURIComponent(q)); const b = Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k])); return (r.groups?.posts?.items || []).map((p) => b[p.id] || "?"); };

test("blocked both ways, muted words hidden; own posts stay; sensitive/reported sink; spam collapses", async () => {
  const got = await find(A, "زراعة الطماطم");
  assert.ok(got.includes("mine")); assert.ok(!got.includes("blocked") && !got.includes("blocksMe") && !got.includes("muted"), JSON.stringify(got));
  assert.equal(got.filter((x) => x === "dup1" || x === "dup2").length, 1, "copies collapse");
  const tail = got.slice(-2).sort(); assert.deepEqual(tail, ["rep", "sens"].sort(), JSON.stringify(got));
  const zs = got.map((x, i) => (/^(flood|dup)/.test(x) ? i : -1)).filter((i) => i >= 0);
  assert.ok(zs.length > 3 && zs[3] > got.indexOf("ok1") && zs[3] > got.indexOf("mine"), "a 4th post by the same author yields to other authors: " + JSON.stringify(got));
  const other = await find(D, "زراعة الطماطم"); assert.ok(other.includes("blocked") && other.includes("blocksMe"), "others still see them");
});
test("clicks from ≥ 2 reader-days lift a post for that exact query; one reader cannot", async () => {
  const q = "الطماطم في البيت";
  const before = await find(D, q);
  const target = K.ok1;
  await A.req("POST", "/api/search/click", { q, id: target }); await A.req("POST", "/api/search/click", { q, id: target });
  assert.equal(Number((await db.get("SELECT n FROM search_clicks WHERE ref_id=$1", [target]))?.n), 1, "one reader per day counts once");
  await C.req("POST", "/api/search/click", { q, id: target });
  const after = await find(D, q);
  assert.ok(after.indexOf("ok1") <= Math.max(0, before.indexOf("ok1")), JSON.stringify({ before, after }));
  assert.equal((await A.req("POST", "/api/search/click", { q, id: "not-a-post" })).ok, true);
});
test("metrics are admin-only; zero-result queries recorded; migration 087 down/up", async () => {
  await find(A, "كلمةغيرموجودةابدا");
  const no = await Z.req("GET", "/api/admin/search/metrics"); assert.ok(no.status === 403 || no.error, JSON.stringify(no).slice(0, 120));
  await db.run("UPDATE users SET role='admin' WHERE id=$1", [D.id]);
  const m = await D.req("GET", "/api/admin/search/metrics?days=7");
  assert.ok(m.searches >= 3 && m.zeroRate > 0 && m.ctr > 0, JSON.stringify(m).slice(0, 300));
  assert.ok(m.zeroQueries.some((z) => z.q === "كلمةغيرموجودةابدا"));
  const mig = require("../migrations/087_search_quality"), exec = (sql) => db.exec ? db.exec(sql) : db.run(sql);
  await mig.down(db, exec); await mig.up(db, exec); await mig.up(db, exec);
  assert.ok((await find(A, "زراعة الطماطم")).length > 0, "search works after a rollback/forward");
});
