/* v2.135 «الذكاء في الرسائل» المرحلة 2: translate one message, dates/tasks extraction (cited, validated), scam explanation,
 * plus local scam signals on chat history (other people's messages only). Members only; encrypted chats refused. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
const { scamSignals } = require("../lib/msg-safety");

const prompts = [];
let firstId = "";
const freeStub = {
  label: "مجتمع بلس",
  async chat(messages) {
    const p = messages[messages.length - 1].content; prompts.push(p);
    if (p.startsWith("ترجم الرسالة")) return { text: JSON.stringify({ text: "The meeting is tomorrow at 4 PM", from: "ar" }) };
    if (p.startsWith("استخرج")) return { text: JSON.stringify({ items: [
      { kind: "event", title: "اجتماع المراجعة", date: "2026-11-05", time: "16:00", forMe: true, cites: [firstId] },
      { kind: "task", title: "تجهيز العرض", date: "bad-date", time: "25:99", cites: [firstId, "ms_invented"] },
      { kind: "event", title: "بلا مصدر", date: "2026-11-06", cites: ["ms_invented"] }] }) };
    if (p.startsWith("هل الرسالة")) return { text: JSON.stringify({ risk: "high", reasons: ["يطلب رمز تحقق"], advice: "لا ترسل الرمز لأي أحد" }) };
    return { text: "{}" };
  }
};
let H, sara, bob, out, g, enc, scam, mine;
const db = () => H.app.ctx.db;
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString();

test.before(async () => {
  H = await boot({ aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} }, aihubOpts: { env: { AIHUB_SEAL_KEY: "t" }, freeProvider: freeStub } });
  sara = await mk("m2_sara"); bob = await mk("m2_bob"); out = await mk("m2_out");
  const admin = await mk("m2_admin"); await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  assert.equal((await admin.req("PUT", "/api/admin/aihub", { freeDaily: 50 })).status, 200);
  g = (await sara.req("POST", "/api/chat/groups", { title: "فريق", members: [bob.id] })).conversation.id;
  firstId = id("ms"); await db().run("INSERT INTO messages(id,conv,sender,text,created_at,kind) VALUES($1,$2,$3,'الاجتماع بكرة الساعة 4 العصر وجهزي العرض',$4,'text')", [firstId, g, bob.id, ago(20)]);
  scam = id("ms"); await db().run("INSERT INTO messages(id,conv,sender,text,created_at,kind) VALUES($1,$2,$3,'أرسل رمز التحقق الذي وصلك خلال 10 دقائق',$4,'text')", [scam, g, bob.id, ago(10)]);
  mine = id("ms"); await db().run("INSERT INTO messages(id,conv,sender,text,created_at,kind) VALUES($1,$2,$3,'أرسل رمز التحقق الذي وصلك خلال 10 دقائق',$4,'text')", [mine, g, sara.id, ago(9)]);
  enc = id("cv"); await db().run("INSERT INTO conversations(id,created_at,updated_at,e2ee) VALUES($1,$2,$2,1)", [enc, ago(5)]);
  await db().run("INSERT INTO conversation_members(conv,user_id,state) VALUES($1,$2,'accepted'),($1,$3,'accepted')", [enc, sara.id, bob.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("local scam signals: strong patterns flagged, everyday messages not", () => {
  assert.equal(scamSignals("لإعادة التفعيل أرسل رمز التحقق خلال 10 دقائق").risky, true);
  assert.equal(scamSignals("اضغط bit.ly/x1 وأدخل بيانات بطاقتك").risky, true);
  for (const t of ["تذكير: موعد طبيب الأسنان السبت 11 الصبح", "كل واحد يدفع 25 ريال للحجز", "لا تنسى ترسل لي الكود حق الخصم", "Could you send us two screenshots?", "وأحتاج منك ترسل الفاتورة الثانية المبلغ 4500 ريال"]) assert.equal(scamSignals(t).risky, false, t);
});

test("history marks risky messages from others only", async () => {
  const r = await sara.req("GET", `/api/chat/conversations/${g}/messages`);
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.messages.map((m) => [m.id, m]));
  assert.ok(by[scam].risk?.includes("otp")); assert.equal(by[mine].risk, undefined); assert.equal(by[firstId].risk, undefined);
});

test("translate: one visible message, auto target, cached", async () => {
  const r = await sara.req("POST", "/api/aihub/messages", { tool: "translate", cid: g, mid: firstId });
  assert.equal(r.status, 200, r.error); assert.equal(r.text, "The meeting is tomorrow at 4 PM"); assert.equal(r.to, "en");
  const n = prompts.length; const again = await sara.req("POST", "/api/aihub/messages", { tool: "translate", cid: g, mid: firstId });
  assert.equal(again.cached, true); assert.equal(prompts.length, n);
  assert.equal((await sara.req("POST", "/api/aihub/messages", { tool: "translate", cid: g, mid: "ms_nope" })).status, 404);
});

test("extract: only cited items kept, bad date/time dropped, today's date given to the model", async () => {
  const r = await sara.req("POST", "/api/aihub/messages", { tool: "extract", cid: g });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0], { kind: "event", title: "اجتماع المراجعة", date: "2026-11-05", time: "16:00", forMe: true, cites: [firstId] });
  assert.equal(r.items[1].date, null); assert.equal(r.items[1].time, null); assert.deepEqual(r.items[1].cites, [firstId]);
  assert.match(prompts[prompts.length - 1], /اليوم .+ \d{4}-\d{2}-\d{2}/);
});

test("safety explanation + members only + e2ee refused + switch off", async () => {
  const r = await sara.req("POST", "/api/aihub/messages", { tool: "safety", cid: g, mid: scam });
  assert.equal(r.status, 200, r.error); assert.equal(r.risk, "high"); assert.deepEqual(r.reasons, ["يطلب رمز تحقق"]);
  const n = prompts.length;
  assert.equal((await out.req("POST", "/api/aihub/messages", { tool: "translate", cid: g, mid: firstId })).code, "not_member");
  assert.equal((await sara.req("POST", "/api/aihub/messages", { tool: "extract", cid: enc })).code, "e2ee");
  await sara.req("PUT", "/api/prefs", { ns: "ai", values: { messages: false } });
  assert.equal((await sara.req("POST", "/api/aihub/messages", { tool: "extract", cid: g })).code, "msg_ai_off");
  await sara.req("PUT", "/api/prefs", { ns: "ai", values: { messages: true } });
  assert.equal(prompts.length, n);
});
