/* v2.125 search stage 2 — local meaning vectors + hybrid retrieval.
 * lib: the local model loads, sentence vectors are unit length, meaning beats word overlap, int8 packing round-trips, LSH bands.
 * service: a post with NO shared word is found by meaning; a followers-only post is never leaked through the semantic path;
 * deleting a post drops its vector; the background upgrade fills missing vectors; the LSH (millions-scale) path finds the same
 * post; migration 086 rolls back and forward. Runs on SQLite and PostgreSQL. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const EM = require("../lib/search-embed");
const { boot } = require("./helpers");
const { id } = require("../lib/core");

test("lib: local model, unit vectors, meaning over words, packing, LSH", () => {
  assert.equal(EM.available(), true, "model files present in server/models/m2v");
  const diet = EM.embed("كيف أنزل وزني بسرعة؟ أكلت قليل وتمشيت يومياً"), q = EM.embed("رجيم وتخسيس"), other = EM.embed("أفضل محمصة قهوة في جدة");
  let n = 0; for (const x of q) n += x * x; assert.ok(Math.abs(n - 1) < 1e-4);
  assert.ok(EM.cos(q, diet) > EM.cos(q, other) + 0.15, "diet question is nearer than coffee");
  assert.ok(EM.cos(EM.embed("لابتوب"), EM.embed("laptop")) > 0.4, "cross-lingual");
  const back = EM.unpack(EM.pack(diet)); assert.ok(EM.cos(back, diet) > 0.999);
  assert.equal(EM.bands(diet).length, 8); assert.equal(EM.probes(diet).length, 72);
  assert.equal(EM.embed(""), null);
});

let H, db, A, B, S;
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = r.user.id; return c; };
async function seed(author, text, visibility = "public") {
  const pid = id("p");
  await db.run("INSERT INTO posts(id,author,type,title,text,lang,visibility,status,created_at) VALUES($1,$2,'post',NULL,$3,'ar',$4,'published',$5)", [pid, author, text, visibility, new Date().toISOString()]);
  await S.indexPost(pid); return pid;
}
const filler = ["أفضل محمصة قهوة في جدة؟", "كم تاخذ تأشيرة شنغن من الرياض", "مباراة الهلال اليوم كانت قوية", "وش أحسن مكتبة للرسوم البيانية في جافاسكربت",
  "تجربتي مع شقة إيجار في الخبر", "خط عربي جميل للواجهات", "متى يفتح معرض الكتاب", "سيارة مستعملة بحالة ممتازة للبيع", "دورة تصوير للمبتدئين",
  "وصفة كبسة دجاج سهلة", "أفضل وقت لزيارة العلا", "كيف أرتب مكتبي في البيت", "تطبيق لتعلم الإنجليزية", "مشكلة في شحن الجوال", "رحلة بحرية في ينبع",
  "أسعار الذهب اليوم", "مسلسل جديد يستاهل المشاهدة", "نصائح للمقابلة الشخصية", "حديقة جديدة في الرياض"];
let diet, priv;
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} } });
  db = H.app.ctx.db; S = H.app.ctx.services.search; A = await mk("sem_a"); B = await mk("sem_b");
  for (const t of filler) await seed(B.id, t);
  diet = await seed(B.id, "كيف أنزل وزني بسرعة؟ أكلت قليل وتمشيت يومياً بس الميزان ما تحرك");
  priv = await seed(B.id, "نظام غذائي قاسي نزلت فيه عشرة كيلو في شهرين، أكلي صار صحي", "followers");
});
test.after(() => H.app.close());
const ids = (r) => (r.groups.posts?.items || []).map((p) => p.id);

test("hybrid: a post with no shared word is found by meaning; followers-only never leaks", async () => {
  const r = await A.req("GET", "/api/search/full?type=posts&q=" + encodeURIComponent("رجيم وتخسيس"));
  assert.equal(r.engine, "hybrid");
  assert.equal(ids(r)[0], diet);
  assert.ok(!ids(r).includes(priv), "followers-only post hidden from a stranger");
  const sem = await S.semIds("رجيم وتخسيس", ["post"], S.parseFilters({}));
  assert.ok(sem.some((x) => x.id === priv), "the vector exists — only visibility hides it");
});

test("a query unrelated to every post returns nothing rather than junk", async () => {
  const r = await A.req("GET", "/api/search/full?type=posts&ai=0&q=" + encodeURIComponent("ميكانيكا الكم والثقوب السوداء"));
  const got = (r.groups.posts?.items || []).map((p) => p.text); assert.deepEqual(got, [], JSON.stringify({ engine: r.engine, got, corrected: r.corrected }));
});

test("LSH candidate path (millions-scale) finds the same post", async () => {
  process.env.SEARCH_SEM_BRUTE_MAX = "0";
  try {
    const sem = await S.semIds("كيف أنزل وزني بسرعة؟ أكلت قليل وتمشيت يومياً", ["post"], S.parseFilters({}));
    assert.equal(sem[0].id, diet);
    const lsh = await db.all("SELECT bk FROM search_vec_lsh WHERE kind='post' AND ref_id=$1", [diet]); assert.equal(lsh.length, 8);
  } finally { delete process.env.SEARCH_SEM_BRUTE_MAX; }
});

test("delete drops the vector; the upgrade fills missing vectors; migration 086 down/up", async () => {
  const gone = await seed(B.id, "منشور مؤقت عن الطبخ");
  assert.ok(await db.get("SELECT 1 x FROM search_vec WHERE ref_id=$1", [gone]));
  await db.run("UPDATE posts SET status='removed' WHERE id=$1", [gone]); await S.indexPost(gone);
  assert.equal(await db.get("SELECT 1 x FROM search_vec WHERE ref_id=$1", [gone]), undefined);
  assert.equal(await db.get("SELECT 1 x FROM search_vec_lsh WHERE ref_id=$1", [gone]), undefined);
  await db.run("DELETE FROM search_vec WHERE ref_id=$1", [diet]);
  await S.upgradeIndex();
  assert.ok(await db.get("SELECT 1 x FROM search_vec WHERE ref_id=$1", [diet]), "refilled by the background upgrade");
  const m = require("../migrations/086_search_vectors"), exec = (sql) => db.exec ? db.exec(sql) : db.run(sql);
  await m.down(db, exec); await m.up(db, exec); await m.up(db, exec);
  await S.upgradeIndex();
  assert.ok(await db.get("SELECT 1 x FROM search_vec WHERE ref_id=$1", [diet]));
});
