/* v2.130 search stage 7 — search inside: in:<community> scopes to one community; filter:saved keeps only the reader's own
 * collections (another member's saves never leak, signed-out readers get nothing); /api/chat/search finds words (Arabic forms)
 * only in the reader's own non-encrypted conversations, never deleted/expired messages. Runs on SQLite and PostgreSQL. */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
let H, db, S, A, B, C;
const K = {};
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = r.user.id; return c; };
const now = () => new Date().toISOString();
async function post(k, text, community = null) {
  const pid = id("p"); K[k] = pid;
  await db.run("INSERT INTO posts(id,author,type,title,text,lang,visibility,status,community,created_at) VALUES($1,$2,'post',NULL,$3,'ar','public','published',$4,$5)", [pid, B.id, text, community, now()]);
  await S.indexPost(pid);
}
async function conv(members, e2ee = 0) {
  const cid = id("cv"); await db.run("INSERT INTO conversations(id,created_at,updated_at,kind,e2ee) VALUES($1,$2,$2,'dm',$3)", [cid, now(), e2ee]);
  for (const u of members) await db.run("INSERT INTO conversation_members(conv,user_id,state) VALUES($1,$2,'accepted')", [cid, u]);
  return cid;
}
const msg = (cid, from, text, extra = {}) => db.run("INSERT INTO messages(id,conv,sender,text,created_at,kind,deleted_at,expires_at) VALUES($1,$2,$3,$4,$5,'text',$6,$7)", [id("m"), cid, from, text, now(), extra.deleted || null, extra.expires || null]);
test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} } });
  db = H.app.ctx.db; S = H.app.ctx.services.search; A = await mk("in_a"); B = await mk("in_b"); C = await mk("in_c");
  const cm = id("cm");
  await db.run("INSERT INTO communities(id,name,descr,type,owner,created_at) VALUES($1,'محبي الشواء','مجتمع للشواء','public',$2,$3)", [cm, B.id, now()]).catch(async () => {
    await db.run("INSERT INTO communities(id,name,type,owner,created_at) VALUES($1,'محبي الشواء','public',$2,$3)", [cm, B.id, now()]); });
  K.cm = cm;
  await post("inC", "أفضل فحم للشواء في الشتاء", cm);
  await post("outC", "أفضل فحم للشواء على البحر");
  const col = id("col"); await db.run("INSERT INTO collections(id,owner,name,updated_at,created_at) VALUES($1,$2,'مفضلتي',$3,$3)", [col, A.id, now()]);
  await db.run("INSERT INTO collection_items(collection,post,added_at,updated_at) VALUES($1,$2,$3,$3)", [col, K.outC, now()]);
  const colC = id("col"); await db.run("INSERT INTO collections(id,owner,name,updated_at,created_at) VALUES($1,$2,'لي',$3,$3)", [colC, C.id, now()]);
  await db.run("INSERT INTO collection_items(collection,post,added_at,updated_at) VALUES($1,$2,$3,$3)", [colC, K.inC, now()]);
  K.ab = await conv([A.id, B.id]); K.bc = await conv([B.id, C.id]); K.enc = await conv([A.id, B.id], 1);
  await msg(K.ab, B.id, "موعد الشواء يوم الجمعة بعد العصر");
  await msg(K.ab, A.id, "تمام، أجيب الفحم");
  await msg(K.ab, B.id, "رسالة محذوفة عن الشواء", { deleted: now() });
  await msg(K.ab, B.id, "رسالة مؤقتة عن الشواء", { expires: new Date(Date.now() - 1000).toISOString() });
  await msg(K.bc, C.id, "سر الشواء عندي");
  await msg(K.enc, B.id, "ciphertext-شواء");
});
test.after(() => H.app.close());
const back = () => Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k]));
const find = async (cl, q) => { const r = await cl.req("GET", "/api/search/full?ai=0&type=posts&q=" + encodeURIComponent(q)); const b = back(); return (r.groups?.posts?.items || []).map((p) => b[p.id] || "?"); };

test("in:<community> scopes to the community", async () => {
  assert.deepEqual((await find(A, `فحم الشواء in:${K.cm}`)), ["inC"]);
  assert.deepEqual((await find(A, `in:${K.cm}`)), ["inC"]);
});
test("filter:saved = only my own collections", async () => {
  assert.deepEqual(await find(A, "فحم filter:saved"), ["outC"]);
  assert.deepEqual(await find(A, "filter:saved"), ["outC"]);
  assert.deepEqual(await find(C, "filter:saved"), ["inC"]);
  const anon = new H.Client(); assert.deepEqual(await find(anon, "filter:saved"), []);
});
test("chat search: my conversations only, Arabic forms, no deleted/expired/encrypted", async () => {
  const r = await A.req("GET", "/api/chat/search?q=" + encodeURIComponent("الشواء"));
  assert.deepEqual(r.results.map((m) => m.text), ["موعد الشواء يوم الجمعة بعد العصر"]);
  const r2 = await A.req("GET", "/api/chat/search?q=" + encodeURIComponent("فحم")); assert.equal(r2.results.length, 1, "«الفحم» matched by «فحم»");
  const rc = await C.req("GET", "/api/chat/search?q=" + encodeURIComponent("شواء")); assert.deepEqual(rc.results.map((m) => m.conv), [K.bc]);
  const anon = new H.Client(); const ra = await anon.req("GET", "/api/chat/search?q=x"); assert.ok(ra.error || ra.status >= 400 || !ra.results?.length);
});
