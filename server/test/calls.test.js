/* Track 6 — calls (Phase 30): signalling flow over SSE and WebSocket (ring → accept → SDP/ICE relay →
 * media/quality → hang-up), decline / cancel / ring-timeout missed / busy, group mesh cap of 8 with
 * invite + rejoin, privacy (message policy, requests, blocks both ways), dead-peer sweep, history and
 * missed badge, notifications (incoming push-worthy, missed), TURN REST credential format. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const { boot } = require("./helpers");
const { wsConnect, sseConnect } = require("./ws-client");
const calls = require("../services/calls");

let H, A, B, C, D;
const RING_MS = 1200;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const db = () => H.app.ctx.db;
const mk = async (handle, name) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };
/** `callee` follows `caller` → the caller lands in the inbox and may ring */
const allow = (caller, ...callees) => Promise.all(callees.map(c => c.req("PUT", `/api/follows/${caller.id}`)));
const events = [];
async function until(fn, ms = 5000, label = "condition") { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(40); } throw new Error("timeout: " + label); }
const endAll = async () => { await db().run("UPDATE call_sessions SET status='ended', end_reason='completed' WHERE status<>'ended'"); await db().run("UPDATE call_participants SET state='left' WHERE state IN ('ringing','joined')"); };

test.before(async () => {
  H = await boot({ callRingMs: RING_MS, callSweepMs: 3600e3 });
  for (const e of ["CALL_INCOMING", "CALL_MISSED", "CALL_ENDED"]) H.app.ctx.bus.on(e, p => events.push({ e, ...p }));
  A = await mk("call_a", "أمل"); B = await mk("call_b", "بدر"); C = await mk("call_c", "جود"); D = await mk("call_d", "دانة");
  await allow(A, B, C, D); await allow(B, C); await allow(C, B);
});
test.after(() => H.app.close());
test.beforeEach(async () => { H.app.ctx.rl.w.clear(); await endAll(); });

test("TURN REST credentials and ICE config: '<expiry>:<user>' + base64 HMAC-SHA1, TTL, relay policy, STUN-only default", async () => {
  const at = Date.UTC(2026, 9, 16, 0, 0, 0);
  const c = calls.turnCredentials({ secret: "coturn-secret", userId: "u_123", ttl: 3600, at });
  assert.equal(c.username, `${at / 1000 + 3600}:u_123`);
  assert.equal(c.credential, crypto.createHmac("sha1", "coturn-secret").update(c.username).digest("base64"));
  assert.equal(Buffer.from(c.credential, "base64").length, 20, "SHA-1 HMAC is 20 bytes"); assert.equal(c.expiresAt, new Date(at + 3600e3).toISOString());
  const plain = await A.req("GET", "/api/calls/ice");
  assert.equal(plain.turn, false); assert.equal(plain.iceServers.length, 1); assert.ok(plain.iceServers[0].urls.every(u => u.startsWith("stun:"))); assert.equal(plain.iceTransportPolicy, "all");
  const env = { TURN_URLS: "turn:turn.mujtama.plus:3478?transport=udp,turns:turn.mujtama.plus:5349", TURN_TTL: "600", CALL_FORCE_RELAY: "1", STUN_URLS: "stun:stun.mujtama.plus:3478" };
  const cfg = calls.iceConfig("u_9", { env, getSecret: (n) => n === "TURN_SECRET" ? "s3" : null, at });
  assert.equal(cfg.turn, true); assert.equal(cfg.ttl, 600); assert.equal(cfg.iceTransportPolicy, "relay");
  const turn = cfg.iceServers[1]; assert.deepEqual(turn.urls, ["turn:turn.mujtama.plus:3478?transport=udp", "turns:turn.mujtama.plus:5349"]);
  assert.match(turn.username, /^\d{10}:u_9$/); assert.equal(turn.credential, crypto.createHmac("sha1", "s3").update(turn.username).digest("base64"));
  assert.equal(calls.iceConfig("u_9", { env: { ...env, TURN_TTL: "5" }, getSecret: () => "s3", at }).ttl, 60, "TTL floor of 60 s");
  // through the API, per signed-in user
  Object.assign(process.env, { TURN_URLS: "turn:turn.example.com:3478", TURN_SECRET: "api-secret" });
  try { const r = await B.req("GET", "/api/calls/ice"); assert.equal(r.turn, true); assert.ok(r.iceServers[1].username.endsWith(":" + B.id)); assert.ok(Date.parse(r.expiresAt) > Date.now()); }
  finally { delete process.env.TURN_URLS; delete process.env.TURN_SECRET; }
  assert.equal((await new H.Client().req("GET", "/api/calls/ice")).status, 401);
});

test("1:1 signalling: ring over SSE, accept, SDP/ICE relay over HTTP and WebSocket, media flags, quality, hang-up, history", async () => {
  const sseB = await sseConnect(H.base, B.cookie), sseA = await sseConnect(H.base, A.cookie);
  const r = await A.req("POST", "/api/calls", { to: B.id, kind: "video" }); assert.equal(r.status, 200, r.error);
  const cid = r.call.id; assert.equal(r.call.status, "ringing"); assert.equal(r.call.mode, "direct"); assert.equal(r.call.ringMs, RING_MS);
  assert.equal(r.participants.find(p => p.id === A.id).state, "joined"); assert.equal(r.participants.find(p => p.id === B.id).state, "ringing");
  const ring = await sseB.wait(e => e.type === "call" && e.data.call.id === cid, 3000, "ring event"); assert.equal(ring.data.call.kind, "video"); assert.ok(ring.data._e > 0, "de-dup sequence");
  assert.ok(events.some(e => e.e === "CALL_INCOMING" && e.call === cid && e.to === B.id && e.online === true));
  await sleep(200);
  assert.equal(await db().get("SELECT * FROM notifications WHERE user_id=$1 AND kind='call' AND ref=$2", [B.id, cid]), undefined, "incoming call is push-only (no in-app row)");
  assert.equal((await B.req("GET", "/api/calls/active")).active.call.id, cid);
  assert.equal((await C.req("GET", `/api/calls/${cid}`)).status, 403, "outsiders cannot read a call");
  assert.equal((await A.req("POST", `/api/calls/${cid}/signal`, { to: B.id, data: { sdp: "x" } })).status, 403, "no relay before the callee joins");
  const acc = await B.req("POST", `/api/calls/${cid}/accept`, {}); assert.equal(acc.call.status, "active"); assert.ok(acc.call.answeredAt);
  assert.equal(acc.participants.find(p => p.id === B.id).camera, true, "video call starts with camera on");
  await sseA.wait(e => e.type === "call" && e.data.call.status === "active", 3000, "active to caller");
  // offer A→B over HTTP (SSE delivery), answer B→A over the WebSocket hub
  const offer = { sdp: { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" } };
  assert.equal((await A.req("POST", `/api/calls/${cid}/signal`, { to: B.id, data: offer })).ok, true);
  const got = await sseB.wait(e => e.type === "call_signal", 3000, "offer relayed"); assert.deepEqual(got.data, { call: cid, from: A.id, data: offer, _e: got.data._e });
  const wsA = await wsConnect(H.base, { cookie: A.cookie }), wsB = await wsConnect(H.base, { cookie: B.cookie });
  await wsA.ws.wait(m => m.type === "hello"); await wsB.ws.wait(m => m.type === "hello");
  wsB.ws.send({ t: "call_signal", call: cid, to: A.id, data: { sdp: { type: "answer", sdp: "v=0" } } });
  const ans = await wsA.ws.wait(m => m.type === "call_signal" && m.data.data.sdp?.type === "answer", 3000, "answer over ws"); assert.equal(ans.data.from, B.id);
  wsA.ws.send({ t: "call_signal", call: cid, to: B.id, data: { candidate: { candidate: "candidate:1 1 udp 2122260223 192.168.1.2 54400 typ host", sdpMid: "0" } } });
  await wsB.ws.wait(m => m.type === "call_signal" && m.data.data.candidate, 3000, "ICE candidate over ws");
  assert.equal((await A.req("POST", `/api/calls/${cid}/signal`, { to: C.id, data: { x: 1 } })).status, 403, "cannot relay to non-participants");
  assert.equal((await A.req("POST", `/api/calls/${cid}/signal`, { to: B.id, data: { blob: "x".repeat(70000) } })).status, 400, "oversized signal");
  // media flags + quality reports
  const m = await A.req("POST", `/api/calls/${cid}/media`, { mic: false, screen: true }); const me = m.participants.find(p => p.id === A.id);
  assert.equal(me.mic, false); assert.equal(me.screen, true); assert.equal(me.camera, true);
  assert.equal((await A.req("POST", `/api/calls/${cid}/stats`, { level: "low", rtt: 0.42, loss: 0.08, kbps: 250 })).callStatus, "active");
  const q = await wsB.ws.wait(m => m.type === "call_quality", 3000, "quality to peer"); assert.equal(q.data.level, "low"); assert.equal(q.data.user, A.id);
  await A.req("POST", `/api/calls/${cid}/stats`, { level: "low", rtt: 0.4 }); await sleep(100);
  assert.equal(wsB.ws.msgs.filter(m => m.type === "call_quality").length, 1, "quality only relayed when the level changes");
  await sleep(1100);
  const h = await B.req("POST", `/api/calls/${cid}/hangup`); assert.equal(h.call.status, "ended"); assert.equal(h.call.endReason, "completed"); assert.ok(h.call.duration >= 1);
  assert.ok(events.some(e => e.e === "CALL_ENDED" && e.call === cid && e.reason === "completed"));
  const hist = await A.req("GET", "/api/calls"); const row = hist.calls.find(x => x.id === cid);
  assert.equal(row.direction, "outgoing"); assert.equal(row.missed, false); assert.equal(row.participants[0].id, B.id);
  assert.equal((await B.req("GET", "/api/calls")).calls.find(x => x.id === cid).direction, "incoming");
  assert.equal((await A.req("POST", `/api/calls/${cid}/accept`, {})).status, 409, "cannot join an ended call");
  assert.equal((await A.req("DELETE", `/api/calls/${cid}`)).ok, true); assert.ok(!(await A.req("GET", "/api/calls")).calls.some(x => x.id === cid), "hidden from my history");
  sseA.close(); sseB.close(); wsA.ws.close(); wsB.ws.close();
});

test("decline, caller cancel, ring timeout → missed (+ notification, unseen badge, seen), busy", async () => {
  let r = await A.req("POST", "/api/calls", { to: B.id }); assert.equal(r.call.kind, "voice");
  await B.req("POST", `/api/calls/${r.call.id}/decline`);
  assert.equal((await A.req("GET", `/api/calls/${r.call.id}`)).call.endReason, "declined");
  r = await A.req("POST", "/api/calls", { to: C.id });
  const cancel = await A.req("POST", `/api/calls/${r.call.id}/hangup`); assert.equal(cancel.call.endReason, "cancelled");
  assert.equal(cancel.participants.find(p => p.id === C.id).state, "missed");
  // ring timeout
  r = await A.req("POST", "/api/calls", { to: D.id }); const cid = r.call.id;
  const ended = await until(async () => { const s = await A.req("GET", `/api/calls/${cid}`); return s.call.status === "ended" ? s : null; }, RING_MS + 3000, "ring timeout");
  assert.equal(ended.call.endReason, "missed"); assert.equal(ended.participants.find(p => p.id === D.id).state, "missed");
  assert.ok(events.some(e => e.e === "CALL_MISSED" && e.call === cid && e.user === D.id && e.reason === "timeout"));
  const n = await until(() => db().get("SELECT * FROM notifications WHERE user_id=$1 AND kind='call_missed'", [D.id]), 3000, "missed-call notification");
  assert.equal(n.actor, A.id);
  const hd = await D.req("GET", "/api/calls"); assert.ok(hd.unseenMissed >= 1); assert.equal(hd.calls.find(x => x.id === cid).missed, true);
  await D.req("POST", "/api/calls/seen"); assert.equal((await D.req("GET", "/api/calls")).unseenMissed, 0);
  // busy: B is in a call with A; C rings B
  r = await A.req("POST", "/api/calls", { to: B.id }); await B.req("POST", `/api/calls/${r.call.id}/accept`, {});
  const busy = await C.req("POST", "/api/calls", { to: B.id }); assert.equal(busy.status, 200, busy.error);
  assert.equal(busy.call.status, "ended"); assert.equal(busy.call.endReason, "busy"); assert.equal(busy.participants.find(p => p.id === B.id).state, "busy");
  assert.ok(events.some(e => e.e === "CALL_MISSED" && e.call === busy.call.id && e.reason === "busy"));
  assert.equal((await A.req("POST", "/api/calls", { to: C.id })).status, 409, "caller already in a call");
  // answering a new call leaves the current one
  await B.req("POST", `/api/calls/${r.call.id}/hangup`);
});

test("group calls: cap of 8 (mesh), invite, rejoin after leaving, call continues until one remains", async () => {
  const at = new Date().toISOString(), ids = [];
  for (let i = 0; i < 8; i++) { const id = "u_cg" + i; ids.push(id); await db().run("INSERT INTO users(id,handle,name,created_at,prefs) VALUES($1,$2,$3,$4,$5)", [id, "cg_" + i, "مشارك " + i, at, {}]); await db().run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [id, A.id, at]); }
  const over = await A.req("POST", "/api/calls", { users: ids }); assert.equal(over.status, 400); assert.match(over.error, /8/);
  const g = await A.req("POST", "/api/calls", { users: [...ids.slice(0, 5), B.id, C.id] }); assert.equal(g.status, 200, g.error);
  assert.equal(g.call.mode, "group"); assert.equal(g.participants.length, 8);
  const cid = g.call.id;
  await B.req("POST", `/api/calls/${cid}/accept`, {});
  assert.equal((await B.req("POST", `/api/calls/${cid}/invite`, { users: [D.id] })).status, 400, "9th participant refused");
  await C.req("POST", `/api/calls/${cid}/accept`, {});
  const s = await A.req("GET", `/api/calls/${cid}`); assert.equal(s.call.status, "active"); assert.equal(s.participants.filter(p => p.state === "joined").length, 3);
  await C.req("POST", `/api/calls/${cid}/hangup`);
  assert.equal((await A.req("GET", `/api/calls/${cid}`)).call.status, "active", "still active with A and B");
  assert.equal((await C.req("POST", `/api/calls/${cid}/join`, {})).participants.find(p => p.id === C.id).state, "joined", "rejoin");
  // a smaller group: invite turns a direct call into a group call
  await endAll();
  const d = await A.req("POST", "/api/calls", { to: B.id }); await B.req("POST", `/api/calls/${d.call.id}/accept`, {});
  const inv = await A.req("POST", `/api/calls/${d.call.id}/invite`, { users: [D.id] }); assert.equal(inv.call.mode, "group"); assert.equal(inv.participants.find(p => p.id === D.id).state, "ringing");
  assert.equal((await D.req("POST", `/api/calls/${d.call.id}/invite`, { users: [C.id] })).status, 403, "ringing members cannot invite");
  await D.req("POST", `/api/calls/${d.call.id}/accept`, { camera: false });
  await A.req("POST", `/api/calls/${d.call.id}/hangup`);
  assert.equal((await B.req("GET", `/api/calls/${d.call.id}`)).call.status, "active");
  await B.req("POST", `/api/calls/${d.call.id}/hangup`);
  const fin = await D.req("GET", `/api/calls/${d.call.id}`); assert.equal(fin.call.status, "ended"); assert.equal(fin.call.endReason, "completed");
  // calls placed from a group chat ring its accepted members
  await endAll();
  const chat = (await A.req("POST", "/api/chat/groups", { title: "فريق المكالمات", members: [B.id, C.id] })).conversation.id;
  await B.req("POST", `/api/chat/conversations/${chat}/messages`, { text: "جاهز" });
  const fromChat = await A.req("POST", "/api/calls", { conv: chat }); assert.equal(fromChat.status, 200, fromChat.error);
  assert.deepEqual(fromChat.participants.map(p => p.id).sort(), [A.id, B.id, C.id].sort());
  assert.equal((await D.req("POST", "/api/calls", { conv: chat })).status, 403, "non-members cannot call from the chat");
});

test("privacy: strangers need an accepted conversation, dm=nobody refuses, blocks cut both ways, sweep retires dead peers", async () => {
  const S = await mk("call_stranger", "غريب"), P = await mk("call_private", "خصوصية");
  assert.equal((await S.req("POST", "/api/calls", { to: P.id })).status, 403, "message-request territory: cannot ring");
  const cv = (await S.req("POST", "/api/conversations", { user: P.id })).conversation; await P.req("POST", `/api/conversations/${cv.id}/accept`);
  const ok = await S.req("POST", "/api/calls", { to: P.id }); assert.equal(ok.status, 200, "allowed once the callee accepted a conversation"); await S.req("POST", `/api/calls/${ok.call.id}/hangup`);
  await P.req("PUT", "/api/privacy", { dm: "nobody" }); assert.equal((await S.req("POST", "/api/calls", { to: P.id })).status, 403, "dm=nobody");
  await P.req("PUT", "/api/privacy", { dm: "everyone" });
  await P.req("PUT", "/api/me/prefs", { blocked: [S.id] }); assert.equal((await S.req("POST", "/api/calls", { to: P.id })).status, 403, "callee blocked caller");
  await P.req("PUT", "/api/me/prefs", { blocked: [] });
  await S.req("PUT", "/api/me/prefs", { blocked: [P.id] }); assert.equal((await S.req("POST", "/api/calls", { to: P.id })).status, 403, "caller blocked callee");
  await S.req("PUT", "/api/me/prefs", { blocked: [] });
  assert.equal((await S.req("POST", "/api/calls", { to: S.id })).status, 400, "cannot call yourself");
  // dead peer: P stops heart-beating → the sweep marks P left and the call ends
  const r = await S.req("POST", "/api/calls", { to: P.id }); assert.equal(r.status, 200, r.error); await P.req("POST", `/api/calls/${r.call.id}/accept`, {});
  await db().run("UPDATE call_participants SET seen_at=$1, joined_at=$1 WHERE call=$2 AND user_id=$3", [new Date(Date.now() - 120e3).toISOString(), r.call.id, P.id]);
  assert.ok((await H.app.ctx.services.calls.sweep()).swept >= 1);
  const s = await S.req("GET", `/api/calls/${r.call.id}`); assert.equal(s.participants.find(p => p.id === P.id).state, "left"); assert.equal(s.call.status, "ended");
  // call start is rate-limited per user (10/min)
  let last; for (let i = 0; i < 12; i++) { last = await S.req("POST", "/api/calls", { to: P.id }); if (last.call) await S.req("POST", `/api/calls/${last.call.id}/hangup`); }
  assert.equal(last.status, 429);
});

test("pure lifecycle: decide() and the participant state machine", () => {
  const P = (role, state) => ({ role, state });
  assert.deepEqual(calls.decide("ringing", [P("host", "joined"), P("guest", "ringing")]), { status: "ringing", reason: null });
  assert.deepEqual(calls.decide("ringing", [P("host", "joined"), P("guest", "joined")]), { status: "active", reason: null });
  assert.deepEqual(calls.decide("ringing", [P("host", "left"), P("guest", "ringing")]), { status: "ended", reason: "cancelled" });
  assert.deepEqual(calls.decide("ringing", [P("host", "joined"), P("guest", "declined")]), { status: "ended", reason: "declined" });
  assert.deepEqual(calls.decide("ringing", [P("host", "joined"), P("guest", "busy")]), { status: "ended", reason: "busy" });
  assert.deepEqual(calls.decide("ringing", [P("host", "joined"), P("guest", "missed")]), { status: "ended", reason: "missed" });
  assert.deepEqual(calls.decide("active", [P("host", "left"), P("guest", "joined"), P("guest", "joined")]), { status: "active", reason: null });
  assert.deepEqual(calls.decide("active", [P("host", "left"), P("guest", "joined")]), { status: "ended", reason: "completed" });
  assert.deepEqual(calls.decide("active", [P("host", "joined"), P("guest", "left"), P("guest", "ringing")]), { status: "active", reason: null }, "still ringing someone");
  assert.ok(calls.canMove(calls.PARTICIPANT_FLOW, "ringing", "joined")); assert.ok(!calls.canMove(calls.PARTICIPANT_FLOW, "joined", "ringing"));
  assert.ok(calls.canMove(calls.PARTICIPANT_FLOW, "left", "joined")); assert.ok(!calls.canMove(calls.CALL_FLOW, "ended", "active"));
  assert.equal(calls.MAX_PARTICIPANTS, 8);
});
