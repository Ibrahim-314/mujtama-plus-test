/* v2.134 «الذكاء في الرسائل»: catch-up summary, suggested replies, rewrite — on the reader's tap only, through the AI Hub.
 * Covers: members only, encrypted chats refused (their text never reaches a model), the Settings switch (user_prefs ai.messages)
 * turns it off server-side, invented message ids dropped from citations, catch-up cache, deleted/expired messages left out,
 * tone validation, nothing stored. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");

const prompts = [];
const freeStub = {
  label: "مجتمع بلس",
  async chat(messages) {
    const p = messages[messages.length - 1].content; prompts.push(p);
    if (p.includes("لخّص لصاحب الطلب")) {
      const msgs = JSON.parse(p.slice(p.indexOf("[", p.indexOf("الرسائل (JSON"))));
      return { text: JSON.stringify({ headline: "اتفقوا على اجتماع الخميس", forMe: true, points: [{ kind: "decision", text: "الاجتماع الخميس ٨ مساءً", cites: [msgs[0].id, "ms_invented"] }, { kind: "todo", text: "مطلوب منك ملف العرض", cites: [msgs[1].id] }, { kind: "weird", text: "نقطة", cites: [] }] }) };
    }
    if (p.includes("اقترح 3 ردود")) return { text: "```json\n" + JSON.stringify({ replies: ["تمام، أجهزه", "تمام، أجهزه", "أرد عليكم الليلة", "الخميس يناسبني"] }) + "\n```" };
    if (p.includes("أعد كتابة رسالة المستخدم")) return { text: JSON.stringify({ text: "أبشر، بجهز العرض إن شاء الله" }) };
    return { text: "{}" };
  }
};
let H, sara, bob, out;
const db = () => H.app.ctx.db;
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString();
let g, enc; const ids = [];

test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} }, aihubOpts: { env: { AIHUB_SEAL_KEY: "t" }, freeProvider: freeStub } });
  sara = await mk("mai_sara"); bob = await mk("mai_bob"); out = await mk("mai_out");
  const admin = await mk("mai_admin"); await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  assert.equal((await admin.req("PUT", "/api/admin/aihub", { freeDaily: 50 })).status, 200);
  g = (await sara.req("POST", "/api/chat/groups", { title: "فريق جدة", members: [bob.id] })).conversation.id;
  const lines = ["نسوي اجتماع المراجعة الخميس ٨ مساءً؟", "سارة تقدرين تجهزين ملف العرض؟", "يناسبني", "تمام"];
  for (const [i, t] of lines.entries()) { const mid = id("ms"); ids.push(mid); await db().run("INSERT INTO messages(id,conv,sender,text,created_at,kind) VALUES($1,$2,$3,$4,$5,'text')", [mid, g, i % 2 ? bob.id : bob.id, t, ago(60 - i)]); }
  await db().run("INSERT INTO messages(id,conv,sender,text,created_at,kind,deleted_at) VALUES($1,$2,$3,'سر محذوف',$4,'text',$4)", [id("ms"), g, bob.id, ago(30)]);
  await db().run("INSERT INTO messages(id,conv,sender,text,created_at,kind,expires_at) VALUES($1,$2,$3,'رسالة منتهية',$4,'text',$4)", [id("ms"), g, bob.id, ago(29)]);
  enc = id("cv"); await db().run("INSERT INTO conversations(id,created_at,updated_at,e2ee) VALUES($1,$2,$2,1)", [enc, ago(10)]);
  await db().run("INSERT INTO conversation_members(conv,user_id,state) VALUES($1,$2,'accepted'),($1,$3,'accepted')", [enc, sara.id, bob.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("catch-up: points cite real messages only, unknown kinds normalised, deleted/expired left out, cached", async () => {
  const r = await sara.req("POST", "/api/aihub/messages", { tool: "catchup", cid: g, n: 20 });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.headline, "اتفقوا على اجتماع الخميس"); assert.equal(r.forMe, true);
  assert.deepEqual(r.points[0].cites, [ids[0]]); assert.equal(r.points[2].kind, "info");
  const p = prompts[prompts.length - 1]; assert.ok(!p.includes("سر محذوف") && !p.includes("رسالة منتهية"));
  const n = prompts.length, again = await sara.req("POST", "/api/aihub/messages", { tool: "catchup", cid: g, n: 20 });
  assert.equal(again.cached, true); assert.equal(prompts.length, n);
});

test("replies (deduplicated, max 3) and rewrite with tone validation", async () => {
  const r = await sara.req("POST", "/api/aihub/messages", { tool: "replies", cid: g });
  assert.equal(r.status, 200, r.error); assert.deepEqual(r.replies, ["تمام، أجهزه", "أرد عليكم الليلة", "الخميس يناسبني"]);
  const w = await sara.req("POST", "/api/aihub/messages", { tool: "rewrite", cid: g, text: "اوكي بجهز العرض", tone: "kind" });
  assert.equal(w.status, 200, w.error); assert.equal(w.text, "أبشر، بجهز العرض إن شاء الله");
  assert.equal((await sara.req("POST", "/api/aihub/messages", { tool: "rewrite", text: "اوكي", tone: "angry" })).status, 400);
  assert.equal((await sara.req("POST", "/api/aihub/messages", { tool: "rewrite", text: "اوكي بجهز", tone: "fix" })).status, 200, "rewrite works without a conversation");
  assert.equal((await sara.req("POST", "/api/aihub/messages", { tool: "nope", cid: g })).status, 400);
});

test("members only; encrypted chats are never sent to a model", async () => {
  const n = prompts.length;
  const r = await out.req("POST", "/api/aihub/messages", { tool: "catchup", cid: g }); assert.equal(r.status, 403); assert.equal(r.code, "not_member");
  const e = await sara.req("POST", "/api/aihub/messages", { tool: "replies", cid: enc }); assert.equal(e.status, 403); assert.equal(e.code, "e2ee");
  assert.equal(prompts.length, n);
  assert.equal((await new H.Client().req("POST", "/api/aihub/messages", { tool: "catchup", cid: g })).status, 401);
});

test("Settings switch: ai.messages=false turns it off server-side; back on works", async () => {
  assert.equal((await sara.req("GET", "/api/aihub/messages/state")).on, true);
  assert.equal((await sara.req("PUT", "/api/prefs", { ns: "ai", values: { messages: false } })).status, 200);
  assert.equal((await sara.req("GET", "/api/aihub/messages/state")).on, false);
  const r = await sara.req("POST", "/api/aihub/messages", { tool: "replies", cid: g }); assert.equal(r.status, 403); assert.equal(r.code, "msg_ai_off");
  assert.equal((await bob.req("POST", "/api/aihub/messages", { tool: "replies", cid: g })).status, 200, "only her own switch");
  await sara.req("PUT", "/api/prefs", { ns: "ai", values: { messages: true } });
  assert.equal((await sara.req("POST", "/api/aihub/messages", { tool: "replies", cid: g })).status, 200);
});

test("nothing from the conversation is stored", async () => {
  const tables = (await db().all("SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name).filter((t) => /^ai_/.test(t));
  for (const t of tables) { const rows = JSON.stringify(await db().all(`SELECT * FROM ${t}`)); assert.ok(!rows.includes("ملف العرض"), t); }
});
