/* Track 6 — chat (Phases 26–27): message requests, groups ≤256 with roles, replies, reactions,
 * voice/image member-only blobs, typing + read cursors, WebSocket handshake/frames with the SSE
 * fallback, delete-for-everyone (48 h window, group admins), disappearing messages (sweeper),
 * E2EE: device-key directory (multi-device), envelopes only, server stores ciphertext only. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const { boot } = require("./helpers");
const { wsConnect, sseConnect } = require("./ws-client");
const { encodeFrame, OP } = require("../lib/ws");
const subtle = crypto.webcrypto.subtle;

let H, A, B, C, D;
const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };
const db = () => H.app.ctx.db;
const raw = async (c, path, buf, ct = "application/octet-stream") => { const r = await fetch(H.base + path, { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": ct, Cookie: c.cookie, Origin: H.base }, body: buf }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** accepted DM: `to` follows `from` first so the message lands in the inbox */
async function dm(from, to) { await to.req("PUT", `/api/follows/${from.id}`); const r = await from.req("POST", "/api/conversations", { user: to.id }); assert.equal(r.status, 200, r.error); return r.conversation.id; }

test.before(async () => { H = await boot(); A = await mk("chat_a"); B = await mk("chat_b"); C = await mk("chat_c"); D = await mk("chat_d"); });
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("message requests: stranger capped at 3, no read/typing leak, accept / decline, reply accepts", async () => {
  const r = await C.req("POST", "/api/conversations", { user: D.id }); assert.equal(r.status, 200, r.error); assert.equal(r.conversation.request, true);
  const cid = r.conversation.id;
  for (let i = 1; i <= 3; i++) assert.equal((await C.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "مرحبا " + i })).status, 200);
  const fourth = await C.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "رابعة" }); assert.equal(fourth.status, 403); assert.match(fourth.error, /بانتظار قبول/);
  const reqs = await D.req("GET", "/api/conversations/requests"); assert.ok(reqs.requests.some(x => x.id === cid));
  const lst = await D.req("GET", "/api/chat/conversations"); assert.equal(lst.conversations.find(x => x.id === cid).state, "request");
  // reading a request does not move the read cursor the sender can see; typing from the requester reaches nobody unaccepted
  const sse = await sseConnect(H.base, D.cookie);
  assert.equal((await D.req("POST", `/api/chat/conversations/${cid}/read`)).at, null);
  assert.equal((await C.req("GET", `/api/chat/conversations/${cid}/messages`)).reads[D.id], undefined, "no read cursor leak to an unaccepted sender");
  assert.equal((await D.req("POST", `/api/chat/conversations/${cid}/typing`, { on: true })).ok, false, "request recipient typing is not broadcast");
  await C.req("POST", `/api/chat/conversations/${cid}/typing`, { on: true }); await sleep(150);
  assert.ok(!sse.events.some(e => e.type === "typing"), "typing never reaches an unaccepted member");
  sse.close();
  // accept → cap lifted
  assert.equal((await D.req("POST", `/api/conversations/${cid}/accept`)).ok, true);
  assert.equal((await C.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "شكراً للقبول" })).status, 200);
  // decline path
  const B2 = await mk("chat_req2"); const r2 = (await B2.req("POST", "/api/conversations", { user: D.id })).conversation;
  assert.equal((await D.req("POST", `/api/conversations/${r2.id}/decline`)).ok, true);
  assert.equal((await D.req("GET", `/api/chat/conversations/${r2.id}/messages`)).status, 403);
  // replying to a request accepts it implicitly
  const B3 = await mk("chat_req3"); const r3 = (await B3.req("POST", "/api/conversations", { user: D.id })).conversation;
  await B3.req("POST", `/api/chat/conversations/${r3.id}/messages`, { text: "سؤال" });
  assert.equal((await D.req("POST", `/api/chat/conversations/${r3.id}/messages`, { text: "أهلاً" })).status, 200);
  assert.equal((await D.req("GET", `/api/chat/conversations/${r3.id}`)).conversation.members.find(m => m.user === D.id).state, "accepted");
  // privacy dm=nobody and blocks close the door
  await D.req("PUT", "/api/privacy", { dm: "nobody" });
  const B4 = await mk("chat_req4"); assert.equal((await B4.req("POST", "/api/conversations", { user: D.id })).status, 403);
  await D.req("PUT", "/api/privacy", { dm: "everyone" });
  await D.req("PUT", "/api/me/prefs", { blocked: [B4.id] }); assert.equal((await B4.req("POST", "/api/conversations", { user: D.id })).status, 403);
  assert.equal((await C.req("GET", "/api/chat/conversations/nope/messages")).status, 404);
  assert.equal((await new H.Client().req("GET", "/api/chat/conversations")).status, 401);
});

test("groups: create, cap of 256 members, roles, add/remove/leave, ownership hand-over, title/ttl system messages", async () => {
  const at = new Date().toISOString(), ids = [];
  await db().tx(async t => { for (let i = 0; i < 256; i++) { const id = "u_bulk" + String(i).padStart(4, "0"); ids.push(id); await t.run("INSERT INTO users(id,handle,name,created_at,prefs) VALUES($1,$2,$3,$4,$5)", [id, "bulk_" + i, "عضو " + i, at, {}]); } });
  const tooMany = await A.req("POST", "/api/chat/groups", { title: "كبيرة جداً", members: ids }); // 256 + owner = 257
  assert.equal(tooMany.status, 400); assert.match(tooMany.error, /256/);
  const big = await A.req("POST", "/api/chat/groups", { title: "مجموعة كبيرة", members: ids.slice(0, 255) });
  assert.equal(big.status, 200, big.error); assert.equal(big.conversation.members.length, 256);
  assert.equal(big.conversation.members.find(m => m.user === A.id).role, "admin");
  const over = await A.req("POST", `/api/chat/conversations/${big.conversation.id}/members`, { users: [ids[255]] }); assert.equal(over.status, 400, "257th member refused");
  assert.equal((await A.req("POST", "/api/chat/groups", { title: "فارغة", members: [] })).status, 400);
  assert.equal((await A.req("POST", "/api/chat/groups", { title: "", members: [B.id] })).status, 400);

  const g = await A.req("POST", "/api/chat/groups", { title: "فريق التطوير", members: [B.id, C.id] }); assert.equal(g.status, 200, g.error);
  const gid = g.conversation.id;
  assert.equal(g.conversation.kind, "group");
  assert.equal((await B.req("POST", `/api/chat/conversations/${gid}/members`, { users: [D.id] })).status, 403, "only admins add");
  assert.deepEqual((await A.req("POST", `/api/chat/conversations/${gid}/members`, { users: [D.id] })).added, [D.id]);
  assert.equal((await B.req("PATCH", `/api/chat/conversations/${gid}`, { title: "x" })).status, 403);
  await A.req("PATCH", `/api/chat/conversations/${gid}`, { role: { user: B.id, role: "admin" } });
  // B accepts (members added by a stranger start as requests) — replying accepts
  await B.req("POST", `/api/chat/conversations/${gid}/messages`, { text: "مرحبا بالجميع" });
  const t = await B.req("PATCH", `/api/chat/conversations/${gid}`, { title: "فريق التطوير ٢" }); assert.equal(t.status, 200, t.error); assert.equal(t.conversation.title, "فريق التطوير ٢");
  assert.equal((await B.req("DELETE", `/api/chat/conversations/${gid}/members/${A.id}`)).status, 403, "owner cannot be removed by another admin");
  assert.equal((await C.req("DELETE", `/api/chat/conversations/${gid}/members/${D.id}`)).status, 403, "members cannot remove others");
  assert.equal((await D.req("DELETE", `/api/chat/conversations/${gid}/members/${D.id}`)).ok, true, "leave");
  // owner leaves → ownership passes to the remaining admin
  assert.equal((await A.req("DELETE", `/api/chat/conversations/${gid}/members/${A.id}`)).ok, true);
  const info = await B.req("GET", `/api/chat/conversations/${gid}`); assert.equal(info.conversation.owner, B.id);
  assert.equal((await A.req("GET", `/api/chat/conversations/${gid}/messages`)).status, 403);
  const sys = (await B.req("GET", `/api/chat/conversations/${gid}/messages`)).messages.filter(m => m.kind === "system").map(m => m.meta.event);
  for (const e of ["created", "added", "title", "left"]) assert.ok(sys.includes(e), "system message " + e);
  assert.equal((await B.req("POST", `/api/e2ee/conversations/${gid}/enable`)).status, 400, "E2EE is for 1:1 chats");
});

test("replies, reactions (one per member, replace, remove, whitelist), history pagination", async () => {
  const cid = await dm(A, B);
  const m1 = (await A.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "هل جربت الميزة الجديدة؟" })).message;
  const m2 = await B.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "نعم، رائعة!", replyTo: m1.id });
  assert.equal(m2.message.replyTo, m1.id); assert.equal(m2.message.reply.text, "هل جربت الميزة الجديدة؟");
  const foreign = await B.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "رد على رسالة خارجية", replyTo: "ms_notinthisconv" }); assert.equal(foreign.message.replyTo, null);
  assert.equal((await B.req("POST", `/api/chat/messages/${m1.id}/react`, { emoji: "❤️" })).reactions[0].users[0], B.id);
  const re = await B.req("POST", `/api/chat/messages/${m1.id}/react`, { emoji: "😂" }); assert.deepEqual(re.reactions, [{ emoji: "😂", users: [B.id] }], "one reaction per member, replaced");
  const both = await A.req("POST", `/api/chat/messages/${m1.id}/react`, { emoji: "😂" }); assert.deepEqual(both.reactions[0].users.sort(), [A.id, B.id].sort());
  assert.equal((await A.req("POST", `/api/chat/messages/${m1.id}/react`, { emoji: "💩" })).status, 400);
  assert.equal((await C.req("POST", `/api/chat/messages/${m1.id}/react`, { emoji: "😂" })).status, 403, "outsiders cannot react");
  assert.deepEqual((await A.req("POST", `/api/chat/messages/${m1.id}/react`, { emoji: null })).reactions, [{ emoji: "😂", users: [B.id] }]);
  const h = await A.req("GET", `/api/chat/conversations/${cid}/messages`);
  const r = h.messages.find(x => x.id === m2.message.id); assert.equal(r.reply.id, m1.id);
  assert.deepEqual(h.messages.find(x => x.id === m1.id).reactions, [{ emoji: "😂", users: [B.id] }]);
  for (let i = 0; i < 5; i++) { await A.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "رسالة " + i }); await sleep(3); }
  const p1 = await A.req("GET", `/api/chat/conversations/${cid}/messages?limit=3`); assert.equal(p1.messages.length, 3); assert.equal(p1.more, true);
  const p2 = await A.req("GET", `/api/chat/conversations/${cid}/messages?limit=3&before=${encodeURIComponent(p1.messages[0].at)}`);
  assert.ok(p2.messages.every(m => m.at < p1.messages[0].at));
  // idempotent client ids
  const idm = await A.req("POST", `/api/chat/conversations/${cid}/messages`, { id: "ms_idem123456", text: "مرة واحدة" });
  const again = await A.req("POST", `/api/chat/conversations/${cid}/messages`, { id: "ms_idem123456", text: "مرة واحدة" });
  assert.equal(again.message.id, idm.message.id);
  assert.equal((await B.req("POST", `/api/chat/conversations/${cid}/messages`, { id: "ms_idem123456", text: "سرقة" })).status, 409);
  assert.equal((await A.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "x".repeat(4001) })).status, 400);
});

test("voice & image attachments: magic-byte check, member-only blobs, send with waveform meta", async () => {
  const cid = await dm(A, C);
  const ogg = Buffer.concat([Buffer.from("OggS"), crypto.randomBytes(2000)]);
  const up = await raw(A, `/api/chat/conversations/${cid}/blobs`, ogg); assert.equal(up.status, 200, up.error);
  assert.equal(up.blob.mime, "audio/ogg"); assert.equal(up.blob.size, ogg.length);
  assert.equal((await raw(A, `/api/chat/conversations/${cid}/blobs`, Buffer.from("#!/bin/sh\nrm -rf /"))).status, 400, "unknown type refused");
  assert.equal((await raw(B, `/api/chat/conversations/${cid}/blobs`, ogg)).status, 403, "non-members cannot upload");
  assert.equal((await A.req("POST", `/api/chat/conversations/${cid}/messages`, { kind: "voice", meta: { duration: 3 } })).status, 400, "attachment required");
  const v = await A.req("POST", `/api/chat/conversations/${cid}/messages`, { kind: "voice", meta: { blob: up.blob.id, duration: 3.4, wave: [10, 80, 300, -5], mime: "audio/ogg" } });
  assert.equal(v.status, 200, v.error); assert.equal(v.message.kind, "voice"); assert.deepEqual(v.message.meta.wave, [10, 80, 100, 0]);
  assert.equal((await A.req("POST", `/api/chat/conversations/${cid}/messages`, { kind: "voice", meta: { blob: up.blob.id } })).status, 400, "a blob attaches to one message only");
  const get = await fetch(H.base + `/api/chat/blobs/${up.blob.id}`, { headers: { Cookie: C.cookie } });
  assert.equal(get.status, 200); assert.equal(get.headers.get("content-type"), "audio/ogg"); assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  assert.ok(Buffer.from(await get.arrayBuffer()).equals(ogg));
  assert.equal((await fetch(H.base + `/api/chat/blobs/${up.blob.id}`, { headers: { Cookie: B.cookie } })).status, 403, "outsider");
  assert.equal((await fetch(H.base + `/api/chat/blobs/${up.blob.id}`)).status, 401);
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(100)]);
  const im = await raw(C, `/api/chat/conversations/${cid}/blobs`, png); assert.equal(im.blob.mime, "image/png");
  // delete for everyone removes the attachment too
  assert.equal((await A.req("DELETE", `/api/chat/messages/${v.message.id}`)).ok, true);
  assert.equal((await fetch(H.base + `/api/chat/blobs/${up.blob.id}`, { headers: { Cookie: C.cookie } })).status, 404);
});

test("typing & read receipts over HTTP reach the peer through the SSE fallback stream", async () => {
  const cid = await dm(B, C);
  const sse = await sseConnect(H.base, C.cookie); assert.equal(sse.status, 200); assert.match(sse.contentType, /text\/event-stream/);
  await B.req("POST", `/api/chat/conversations/${cid}/typing`, { on: true });
  const ty = await sse.wait(e => e.type === "typing" && e.data.conv === cid, 3000, "typing"); assert.equal(ty.data.user, B.id); assert.equal(ty.data.on, true);
  const m = (await B.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "عبر SSE" })).message;
  const ev = await sse.wait(e => e.type === "chat" && e.data.type === "message" && e.data.message.id === m.id, 3000, "chat message"); assert.equal(ev.data.message.text, "عبر SSE");
  const sseB = await sseConnect(H.base, B.cookie);
  assert.equal((await C.req("GET", "/api/chat/conversations")).conversations.find(x => x.id === cid).unread, 1);
  const rd = await C.req("POST", `/api/chat/conversations/${cid}/read`); assert.ok(rd.at);
  const rev = await sseB.wait(e => e.type === "chat" && e.data.type === "read" && e.data.conv === cid, 3000, "read receipt"); assert.equal(rev.data.user, C.id);
  assert.equal((await B.req("GET", `/api/chat/conversations/${cid}/messages`)).reads[C.id], rd.at);
  assert.equal((await C.req("GET", "/api/chat/conversations")).conversations.find(x => x.id === cid).unread, 0);
  sse.close(); sseB.close();
});

test("WebSocket: handshake (accept key, origin + session checks), hello, inbound typing/read frames, outbound chat, ping, protocol errors", async () => {
  const cid = await dm(A, D);
  assert.equal((await wsConnect(H.base, { cookie: A.cookie, origin: "https://evil.example" })).status, 403, "cross-origin refused");
  assert.equal((await wsConnect(H.base, { cookie: "" })).status, 401, "no session refused");
  assert.equal((await wsConnect(H.base, { cookie: A.cookie, path: "/api/nope" })).status, 404);
  assert.equal((await wsConnect(H.base, { cookie: A.cookie, key: "short" })).status, 400, "bad Sec-WebSocket-Key");
  const a = await wsConnect(H.base, { cookie: A.cookie }); assert.equal(a.status, 101); assert.equal(a.accept, a.expectedAccept);
  const d = await wsConnect(H.base, { cookie: D.cookie }); assert.equal(d.status, 101);
  assert.equal((await a.ws.wait(m => m.type === "hello")).data.user, A.id);
  await d.ws.wait(m => m.type === "hello");
  a.ws.send({ t: "typing", conv: cid, on: true });
  const ty = await d.ws.wait(m => m.type === "typing" && m.data.conv === cid, 3000, "ws typing"); assert.equal(ty.data.user, A.id);
  const sent = (await A.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "عبر WebSocket ⚡" })).message;
  const got = await d.ws.wait(m => m.type === "chat" && m.data.type === "message" && m.data.message.id === sent.id, 3000, "ws message"); assert.equal(got.data.message.text, "عبر WebSocket ⚡");
  d.ws.send({ t: "read", conv: cid });
  const rr = await a.ws.wait(m => m.type === "chat" && m.data.type === "read", 3000, "ws read"); assert.equal(rr.data.user, D.id);
  d.ws.send({ t: "ping" }); assert.ok((await d.ws.wait(m => m.type === "pong")).data.at);
  // ws control ping → pong
  d.ws.sendRaw(encodeFrame(OP.PING, "hi", { mask: true })); assert.equal((await d.ws.wait(m => m.type === "__pong")).data, "hi");
  // large masked frame (16-bit length) and fragmented message both parse
  const big = JSON.stringify({ t: "ping", pad: "ا".repeat(200) });
  d.ws.sendRaw(Buffer.concat([encodeFrame(OP.TEXT, big.slice(0, 50), { mask: true, fin: false }), encodeFrame(OP.CONT, big.slice(50), { mask: true })]));
  await d.ws.wait(m => m.type === "pong" && m !== d.ws.msgs.find(x => x.type === "pong"), 3000, "pong after fragmented ping");
  // SSE realtime events are mirrored to WebSocket clients (notifications etc.)
  H.app.ctx.realtime.send(D.id, "notification", { id: "n_test", kind: "follow" });
  await d.ws.wait(m => m.type === "notification" && m.data.id === "n_test");
  // an unmasked client frame is a protocol error → close 1002
  d.ws.sendRaw(encodeFrame(OP.TEXT, JSON.stringify({ t: "ping" })));
  assert.equal((await d.ws.closed).code, 1002);
  // flood protection: > 40 frames in 5 s → close 1008
  const f = await wsConnect(H.base, { cookie: C.cookie }); await f.ws.wait(m => m.type === "hello");
  for (let i = 0; i < 45; i++) f.ws.send({ t: "noop" });
  assert.equal((await f.ws.closed).code, 1008);
  a.ws.close();
  await sleep(100); assert.equal(H.app.ctx.ws.online(D.id), false, "closed sockets are unregistered");
});

test("delete for everyone: sender within 48 h, group admins, outsiders/others refused, peers notified", async () => {
  const cid = await dm(C, A);
  const m = (await C.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "رسالة ستحذف" })).message;
  const w = await wsConnect(H.base, { cookie: A.cookie }); await w.ws.wait(x => x.type === "hello");
  assert.equal((await A.req("DELETE", `/api/chat/messages/${m.id}`)).status, 403, "the other side of a DM cannot delete for everyone");
  assert.equal((await C.req("DELETE", `/api/chat/messages/${m.id}`)).ok, true);
  await w.ws.wait(x => x.type === "chat" && x.data.type === "delete" && x.data.msg === m.id, 3000, "delete event");
  const h = (await A.req("GET", `/api/chat/conversations/${cid}/messages`)).messages.find(x => x.id === m.id);
  assert.equal(h.deleted, true); assert.equal(h.text, undefined);
  const row = await db().get("SELECT text, payload, meta FROM messages WHERE id=$1", [m.id]); assert.equal(row.text, ""); assert.equal(row.payload, null);
  assert.equal((await C.req("DELETE", `/api/chat/messages/${m.id}`)).status, 404);
  const old = (await C.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "قديمة" })).message;
  await db().run("UPDATE messages SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 49 * 3600e3).toISOString(), old.id]);
  const late = await C.req("DELETE", `/api/chat/messages/${old.id}`); assert.equal(late.status, 403); assert.match(late.error, /48/);
  // group admins moderate any message, regardless of age
  const g = (await A.req("POST", "/api/chat/groups", { title: "إشراف", members: [C.id] })).conversation.id;
  const gm = (await C.req("POST", `/api/chat/conversations/${g}/messages`, { text: "مخالفة" })).message;
  await db().run("UPDATE messages SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 72 * 3600e3).toISOString(), gm.id]);
  assert.equal((await A.req("DELETE", `/api/chat/messages/${gm.id}`)).ok, true);
  assert.equal((await B.req("DELETE", `/api/chat/messages/${gm.id}`)).status, 404);
  w.ws.close();
});

test("disappearing messages: allowed timers, expiry stamped, hidden after expiry, sweeper deletes rows + blobs", async () => {
  const cid = await dm(B, D);
  assert.equal((await B.req("PATCH", `/api/chat/conversations/${cid}`, { ttl: 42 })).status, 400);
  assert.equal((await B.req("PATCH", `/api/chat/conversations/${cid}`, { ttl: 300 })).conversation.ttl, 300);
  const t0 = Date.now();
  const m = (await B.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "ستختفي بعد ٥ دقائق" })).message;
  assert.ok(m.expiresAt); const dt = Date.parse(m.expiresAt) - t0; assert.ok(dt > 290e3 && dt < 310e3, "expires in ~300 s, got " + dt);
  const blob = (await raw(B, `/api/chat/conversations/${cid}/blobs`, Buffer.concat([Buffer.from("OggS"), crypto.randomBytes(64)]))).blob;
  const v = (await B.req("POST", `/api/chat/conversations/${cid}/messages`, { kind: "voice", meta: { blob: blob.id } })).message;
  const keep = await B.req("PATCH", `/api/chat/conversations/${cid}`, { ttl: 0 });
  assert.equal(keep.conversation.ttl, 0);
  const forever = (await B.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "دائمة" })).message; assert.equal(forever.expiresAt, null);
  const past = new Date(Date.now() - 1000).toISOString();
  await db().run("UPDATE messages SET expires_at=$1 WHERE id IN ($2,$3)", [past, m.id, v.id]);
  const h = (await D.req("GET", `/api/chat/conversations/${cid}/messages`)).messages.map(x => x.id);
  assert.ok(!h.includes(m.id) && !h.includes(v.id), "expired messages are hidden before the sweep"); assert.ok(h.includes(forever.id));
  const w = await wsConnect(H.base, { cookie: D.cookie }); await w.ws.wait(x => x.type === "hello");
  const n = await H.app.ctx.services.chat.sweep(); assert.ok(n >= 2);
  assert.equal(await db().get("SELECT id FROM messages WHERE id=$1", [m.id]), undefined, "row deleted");
  assert.equal(await db().get("SELECT id FROM chat_blobs WHERE id=$1", [blob.id]), undefined, "blob deleted");
  const ev = await w.ws.wait(x => x.type === "chat" && x.data.type === "expired" && x.data.conv === cid, 3000, "expired event"); assert.ok(ev.data.msgs.includes(m.id));
  w.ws.close();
});

/* ---------- E2EE (Phase 27) with real WebCrypto ---------- */
const b64u = (b) => Buffer.from(b).toString("base64url");
async function device() { const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]); const jwk = await subtle.exportKey("jwk", kp.publicKey); return { id: "dk_" + crypto.randomBytes(8).toString("hex"), kp, pub: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } }; }
const importPub = (jwk) => subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDH", namedCurve: "P-256" }, false, []);
const wrapKeyFor = (priv, pub) => subtle.deriveKey({ name: "ECDH", public: pub }, priv, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
async function seal(text, fromDev, recipients) {
  const k = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.randomBytes(12); const ct = await subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(text));
  const keys = {};
  for (const r of recipients) { const wiv = crypto.randomBytes(12); const wk = await wrapKeyFor(fromDev.kp.privateKey, await importPub(r.pub)); keys[r.id] = b64u(wiv) + "." + b64u(await subtle.wrapKey("raw", k, wk, { name: "AES-GCM", iv: wiv })); }
  return { v: 1, from: fromDev.id, iv: b64u(iv), ct: b64u(ct), keys };
}
async function open(env, meDev, senderPub) {
  const [wiv, wct] = env.keys[meDev.id].split(".");
  const wk = await wrapKeyFor(meDev.kp.privateKey, await importPub(senderPub));
  const k = await subtle.unwrapKey("raw", Buffer.from(wct, "base64url"), wk, { name: "AES-GCM", iv: Buffer.from(wiv, "base64url") }, { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(env.iv, "base64url") }, k, Buffer.from(env.ct, "base64url")));
}

test("E2EE: multi-device key directory, enable, envelopes only, server stores only ciphertext, revocation", async () => {
  const E1 = await mk("e2ee_one"), E2 = await mk("e2ee_two");
  const cid = await dm(E1, E2);
  assert.equal((await E1.req("POST", `/api/e2ee/conversations/${cid}/enable`)).status, 409, "peer without devices");
  const a1 = await device(), a2 = await device(), b1 = await device();
  assert.equal((await E1.req("POST", "/api/e2ee/devices", { id: "bad id", pub: a1.pub })).status, 400);
  const priv = await subtle.exportKey("jwk", a1.kp.privateKey);
  assert.equal((await E1.req("POST", "/api/e2ee/devices", { id: a1.id, pub: priv })).status, 400, "a JWK with d (private key) is refused");
  assert.equal((await E1.req("POST", "/api/e2ee/devices", { id: a1.id, pub: { ...a1.pub, crv: "P-384" } })).status, 400);
  const reg = await E1.req("POST", "/api/e2ee/devices", { id: a1.id, pub: a1.pub, name: "هاتف آيفون" }); assert.equal(reg.status, 200, reg.error); assert.equal(reg.device.pub.d, undefined);
  assert.equal((await E1.req("POST", "/api/e2ee/devices", { id: a2.id, pub: a2.pub, name: "حاسوب" })).status, 200, "second device for the same user");
  assert.equal((await E1.req("POST", "/api/e2ee/devices", { id: a1.id, pub: a2.pub })).status, 409, "a registered device key cannot be swapped");
  assert.equal((await E2.req("POST", "/api/e2ee/devices", { id: a1.id, pub: a1.pub })).status, 403, "device ids are bound to their owner");
  assert.equal((await E2.req("POST", "/api/e2ee/devices", { id: b1.id, pub: b1.pub })).status, 200);
  const dir = await E1.req("GET", `/api/e2ee/keys?users=${E1.id},${E2.id}`);
  assert.equal(dir.keys[E1.id].length, 2); assert.equal(dir.keys[E2.id].length, 1); assert.equal(dir.keys[E2.id][0].pub.x, b1.pub.x);
  assert.equal((await E1.req("GET", "/api/e2ee/devices")).devices.length, 2);

  assert.equal((await E1.req("POST", `/api/e2ee/conversations/${cid}/enable`)).e2ee, true);
  const conv = (await E2.req("GET", "/api/chat/conversations")).conversations.find(x => x.id === cid); assert.equal(conv.e2ee, true);
  const SECRET = "كلمة السر السرية: زيتون-٤٢";
  assert.equal((await E1.req("POST", `/api/chat/conversations/${cid}/messages`, { text: SECRET })).status, 400, "plaintext refused in an encrypted chat");
  assert.equal((await E1.req("POST", "/api/messages", { conv: cid, text: SECRET })).status, 400, "legacy endpoint refuses plaintext too");
  const env = await seal(SECRET, a1, [a1, a2, b1]);
  assert.equal((await E1.req("POST", `/api/chat/conversations/${cid}/messages`, { enc: { ...env, from: b1.id } })).status, 400, "cannot send as someone else's device");
  assert.equal((await E1.req("POST", `/api/chat/conversations/${cid}/messages`, { enc: { ...env, ct: "<script>" } })).status, 400, "malformed envelope");
  const sent = await E1.req("POST", `/api/chat/conversations/${cid}/messages`, { text: "ignored", enc: env, meta: { mime: "x", w: 5 } });
  assert.equal(sent.status, 200, sent.error); assert.equal(sent.message.text, ""); assert.deepEqual(sent.message.enc.keys, env.keys); assert.equal(sent.message.meta, undefined, "no plaintext metadata in encrypted chats");
  // recipient (and the sender's other device) decrypt from history
  const hist = (await E2.req("GET", `/api/chat/conversations/${cid}/messages`)).messages.find(m => m.id === sent.message.id);
  const senderPub = (await E2.req("GET", `/api/e2ee/devices/${hist.enc.from}`)).device.pub;
  assert.equal(await open(hist.enc, b1, senderPub), SECRET);
  assert.equal(await open(hist.enc, a2, senderPub), SECRET, "multi-device: sender's second device reads it too");
  // the server holds no plaintext anywhere: messages, notifications, conversation list preview
  const rows = await db().all("SELECT * FROM messages WHERE conv=$1", [cid]);
  assert.ok(!JSON.stringify(rows).includes("زيتون"), "no plaintext in the messages table");
  const nrows = await db().all("SELECT * FROM notifications WHERE user_id=$1", [E2.id]);
  assert.ok(!JSON.stringify(nrows).includes("زيتون"), "no plaintext in notifications");
  const stored = rows.find(r => r.id === sent.message.id); assert.equal(stored.text, ""); assert.equal(stored.payload.ct, env.ct);
  assert.ok(!JSON.stringify((await E2.req("GET", "/api/chat/conversations")).conversations).includes("زيتون"));
  // encrypted blobs are stored opaque (no magic check, served as octet-stream)
  const encBlob = await raw(E1, `/api/chat/conversations/${cid}/blobs`, crypto.randomBytes(256)); assert.equal(encBlob.status, 200, encBlob.error); assert.equal(encBlob.blob.enc, true); assert.equal(encBlob.blob.mime, "application/octet-stream");
  // safety-number verification
  assert.equal((await E1.req("PUT", `/api/e2ee/verify/${E2.id}`, { fingerprint: "123" })).status, 400);
  const fp = "1".repeat(60); assert.equal((await E1.req("PUT", `/api/e2ee/verify/${E2.id}`, { fingerprint: fp })).ok, true);
  assert.equal((await E1.req("GET", `/api/e2ee/verify/${E2.id}`)).verification.fingerprint, fp);
  // revoke a device → leaves the directory, cannot send, its public key stays fetchable for old messages; peers told
  const w = await wsConnect(H.base, { cookie: E2.cookie }); await w.ws.wait(x => x.type === "hello");
  assert.equal((await E1.req("DELETE", `/api/e2ee/devices/${a2.id}`)).ok, true);
  await w.ws.wait(x => x.type === "chat" && x.data.type === "keys" && x.data.user === E1.id, 3000, "keys changed event");
  assert.equal((await E1.req("GET", `/api/e2ee/keys?users=${E1.id}`)).keys[E1.id].length, 1);
  assert.equal((await E1.req("POST", `/api/chat/conversations/${cid}/messages`, { enc: await seal("x", a2, [b1]) })).status, 400);
  assert.equal((await E2.req("GET", `/api/e2ee/devices/${a2.id}`)).device.revoked, true);
  assert.equal((await E1.req("POST", "/api/e2ee/devices", { id: a2.id, pub: a2.pub })).status, 403, "a revoked device cannot come back");
  assert.equal((await E2.req("DELETE", `/api/e2ee/devices/${a1.id}`)).status, 404, "cannot revoke someone else's device");
  w.ws.close();
});
