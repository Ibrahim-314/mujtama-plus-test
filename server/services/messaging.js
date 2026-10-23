/* Notification Integration + Messaging Integration + Realtime fan-out.
 * Notifications are built purely from domain events (spec §106, §139). */
const { E, str, acceptId, now } = require("../lib/core");

module.exports = (ctx) => {
  const { db, bus, rl, realtime } = ctx;

  /* notifications moved to services/notify.js (Phase 28: channels, push, quiet hours, grouping, ranking);
   * this delegation keeps ctx.services.messaging.notify working for every caller */
  const notify = (...args) => ctx.services.notify.notify(...args);
  // any public content change nudges online clients to refresh their candidate set
  for (const ev of ["POST_PUBLISHED", "POST_UPDATED", "POST_DELETED", "COMMENT_CREATED", "POST_REACTED", "COMMUNITY_CREATED", "EVENT_CREATED"]) bus.on(ev, () => realtime.broadcast("changed", { scope: ev }));

  /* ---- Messaging ---- */
  async function member(conv, uid) { return !!(await db.get("SELECT 1 x FROM conversation_members WHERE conv=$1 AND user_id=$2", [conv, uid])); }
  async function openConversation(user, b) {
    const other = await db.get("SELECT id, prefs, privacy FROM users WHERE id=$1", [b.user]); if (!other || other.id === user.id) throw E.bad();
    if ((other.prefs?.blocked || []).includes(user.id)) throw E.forbid();
    const mode = await ctx.policy.messageMode(user.id, other);
    if (!mode) throw E.forbid("هذا المستخدم لا يستقبل رسائل منك");
    const ex = await db.get("SELECT a.conv FROM conversation_members a JOIN conversation_members b ON a.conv=b.conv JOIN conversations c ON c.id=a.conv AND c.kind='dm' WHERE a.user_id=$1 AND b.user_id=$2", [user.id, other.id]); // 1:1 only, never a group (Phase 26)
    if (ex) return { id: ex.conv, members: [user.id, other.id] };
    const cid = acceptId(b.id, "cv");
    await db.tx(async t => {
      await t.run("INSERT INTO conversations(id,created_at,updated_at) VALUES($1,$2,$2)", [cid, now()]);
      await t.run("INSERT INTO conversation_members(conv,user_id) VALUES($1,$2)", [cid, user.id]);
      await t.run("INSERT INTO conversation_members(conv,user_id,state) VALUES($1,$2,$3)", [cid, other.id, mode === "requests" ? "request" : "accepted"]);
    });
    return { id: cid, members: [user.id, other.id], updatedAt: now(), request: mode === "requests" };
  }
  async function send(user, b) {
    if (!rl.hit("message", user.id)) throw E.rate();
    if (!(await member(b.conv, user.id))) throw E.forbid();
    if ((await db.get("SELECT e2ee FROM conversations WHERE id=$1", [b.conv]))?.e2ee) throw E.bad("هذه المحادثة مشفرة: أرسل من واجهة المحادثة"); // Phase 27: never accept plaintext here
    const text = str(b.text, 4000, { required: true });
    const m = { id: acceptId(b.id, "ms"), conv: b.conv, from: user.id, text, at: now() };
    await db.run("INSERT INTO messages(id,conv,sender,text,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [m.id, m.conv, user.id, text, m.at]);
    await db.run("UPDATE conversations SET updated_at=$1 WHERE id=$2", [m.at, m.conv]);
    for (const r of await db.all("SELECT user_id FROM conversation_members WHERE conv=$1 AND user_id<>$2", [m.conv, user.id])) realtime.send(r.user_id, "message", m);
    bus.emit("MESSAGE_SENT", { conv: m.conv, actor: user.id, message: m.id });
    return m;
  }
  async function markRead(user, conv) { if (!(await member(conv, user.id))) throw E.forbid(); await db.run("UPDATE messages SET read_at=$1 WHERE conv=$2 AND sender<>$3 AND read_at IS NULL", [now(), conv, user.id]); }

  const r = ctx.router, A = ctx.requireUser;
  r.post("/api/conversations", A(async (req) => ({ conversation: await openConversation(req.user, req.body) })));
  r.post("/api/conversations/:id/read", A(async (req) => (await markRead(req.user, req.params.id), { ok: true })));
  r.get("/api/conversations/requests", A(async (req) => ({ requests: await db.all("SELECT c.id, c.updated_at AS \"updatedAt\" FROM conversations c JOIN conversation_members m ON m.conv=c.id AND m.user_id=$1 AND m.state='request' ORDER BY c.updated_at DESC", [req.user.id]) })));
  r.post("/api/conversations/:id/accept", A(async (req) => { const x = await db.run("UPDATE conversation_members SET state='accepted' WHERE conv=$1 AND user_id=$2", [req.params.id, req.user.id]); if (!x.changes) throw E.nf(); return { ok: true }; }));
  r.post("/api/conversations/:id/decline", A(async (req) => { const x = await db.run("DELETE FROM conversation_members WHERE conv=$1 AND user_id=$2 AND state='request'", [req.params.id, req.user.id]); if (!x.changes) throw E.nf(); return { ok: true }; }));
  r.post("/api/messages", A(async (req) => ({ message: await send(req.user, req.body) })));
  r.get("/api/stream", A(async (req, res) => { realtime.attach(req.user.id, res); return ctx.STREAM; }));
  return { notify };
};
