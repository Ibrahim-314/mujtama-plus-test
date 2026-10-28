/* v2.134 demo messages: seeded only with DEMO_MESSAGES=1, idempotent, visible in the chat list with unread runs,
 * and removed cleanly (only tagged rows) when switched off. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, me, other;
const db = () => H.app.ctx.db;
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200); c.id = r.user.id; return c; };

test.before(async () => {
  H = await boot({});
  me = await mk("dm_me"); other = await mk("dm_other");
  await other.req("POST", "/api/chat/groups", { title: "مجموعة حقيقية", members: [me.id] });
});
test.after(async () => { delete process.env.DEMO_MESSAGES; await H.app.close(); });

test("off by default: nothing seeded", async () => {
  const r = await me.req("GET", "/api/chat/conversations");
  assert.equal(r.conversations.filter(c => c.id.startsWith("cv_dmsg_")).length, 0);
});

test("on: 22 demo chats with unread runs, idempotent", async () => {
  process.env.DEMO_MESSAGES = "1";
  const dm = require("../services/demo-messages")(H.app.ctx);
  const n = await dm.seedAll();
  assert.ok(n >= 250, "messages seeded: " + n);
  assert.equal(await dm.seedAll(), 0, "second run adds nothing");
  const r = await me.req("GET", "/api/chat/conversations");
  const demo = r.conversations.filter(c => c.id.startsWith("cv_dmsg_"));
  assert.equal(demo.length, 22);
  assert.equal(demo.filter(c => c.kind === "group").length, 10);
  assert.ok(demo.some(c => c.unread >= 10), "a long unread run exists for the catch-up pill");
  assert.ok(r.conversations.some(c => c.title === "مجموعة حقيقية"), "real chat kept");
  const h = await me.req("GET", `/api/chat/conversations/${demo[0].id}/messages`);
  assert.equal(h.status, 200); assert.ok(h.messages.length > 0); assert.equal(h.messages[0].meta.demo, true);
});

test("off again: only demo rows removed", async () => {
  delete process.env.DEMO_MESSAGES;
  const dm = require("../services/demo-messages")(H.app.ctx);
  assert.ok(await dm.removeAll() > 0);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM messages WHERE conv LIKE 'cv_dmsg_%'")).n), 0);
  const r = await me.req("GET", "/api/chat/conversations");
  assert.equal(r.conversations.length, 1);
  assert.equal(r.conversations[0].title, "مجموعة حقيقية");
});
