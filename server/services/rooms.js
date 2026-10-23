/* Live audio rooms (Phase 14). Roles: host, speaker, listener; raise hand; host promotes, demotes,
 * mutes and ends. Media transport:
 *   • LiveKit (SFU) when LIVEKIT_URL + LIVEKIT_API_KEY + LIVEKIT_API_SECRET are set — we mint the
 *     access token (HS256 JWT) with publish rights only for host/speakers;
 *   • otherwise a built-in WebRTC mesh: the server relays SDP/ICE over the realtime stream. Good for
 *     small rooms (a handful of speakers); LiveKit takes over for scale.
 * The host can record the room in the browser and publish it as an audio episode. */
const crypto = require("node:crypto");
const { E, str, id, now } = require("../lib/core"); const { secret } = require("../lib/secrets");
const b64u = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function livekitToken({ key, secretKey, room, identity, name, canPublish, ttl = 6 * 3600 }) {
  const t = Math.floor(Date.now() / 1000), head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: key, sub: identity, name, nbf: t - 10, exp: t + ttl, video: { room, roomJoin: true, canPublish, canSubscribe: true, canPublishData: true } }));
  return `${head}.${body}.${b64u(crypto.createHmac("sha256", secretKey).update(`${head}.${body}`).digest())}`;
}
module.exports = (ctx) => {
  const { db, router: R, rl } = ctx; const A = ctx.requireUser;
  const LK = { url: process.env.LIVEKIT_URL, key: secret("LIVEKIT_API_KEY"), secretKey: secret("LIVEKIT_API_SECRET") }; const lkOn = !!(LK.url && LK.key && LK.secretKey);
  const MAX_MESH_SPEAKERS = 6;
  const member = (room, uid) => db.get("SELECT * FROM room_members WHERE room=$1 AND user_id=$2 AND left_at IS NULL", [room, uid]);
  const live = async (rid) => { const r = await db.get("SELECT * FROM rooms WHERE id=$1", [rid]); if (!r) throw E.nf(); if (r.status !== "live") throw E.bad("انتهت الغرفة"); return r; };
  async function state(rid) {
    const r = await db.get("SELECT * FROM rooms WHERE id=$1", [rid]); if (!r) throw E.nf();
    const ms = await db.all("SELECT m.user_id, m.role, m.hand, m.muted, m.joined_at, u.name, u.handle, u.avatar, u.color, u.verified FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room=$1 AND m.left_at IS NULL ORDER BY m.joined_at", [rid]);
    return { room: { id: r.id, title: r.title, topic: r.topic, host: r.host, status: r.status, startedAt: r.started_at, endedAt: r.ended_at, recordingPost: r.recording_post, transport: lkOn ? "livekit" : "mesh" },
      members: ms.map(m => ({ id: m.user_id, role: m.role, hand: !!m.hand, muted: !!m.muted, name: m.name, handle: m.handle, avatar: m.avatar, color: m.color, verified: m.verified })) };
  }
  async function broadcast(rid, type = "room", extra) {
    const s = await state(rid); for (const m of s.members) ctx.realtime.send(m.id, type, extra ? { room: rid, ...extra } : s);
    return s;
  }
  const needHost = async (rid, uid) => { const m = await member(rid, uid); if (!m || m.role !== "host") throw E.forbid("للمضيف فقط"); return m; };

  /** opens a live room hosted by `user`; phase 71 study sessions call it with notifyFollowers: false and guard joins */
  async function createRoom(user, { title, topic, notifyFollowers = true } = {}) {
    if (!rl.hit("community", "room:" + user.id)) throw E.rate();
    if (await db.get("SELECT 1 x FROM rooms WHERE host=$1 AND status='live'", [user.id])) throw E.conflict("لديك غرفة مباشرة بالفعل");
    const rid = id("rm"), at = now(), t = str(title, 100, { required: true, min: 3 });
    await db.run("INSERT INTO rooms(id,host,title,topic,status,started_at) VALUES($1,$2,$3,$4,'live',$5)", [rid, user.id, t, str(topic, 20), at]);
    await db.run("INSERT INTO room_members(room,user_id,role,muted,joined_at) VALUES($1,$2,'host',0,$3)", [rid, user.id, at]);
    if (notifyFollowers) for (const f of await db.all("SELECT src FROM follows WHERE dst=$1 LIMIT 5000", [user.id])) ctx.realtime.send(f.src, "room_live", { id: rid, title: t, host: user.id });
    return state(rid);
  }
  // phase 71: a room may belong to a study session — only that group's members may join, and it is not listed publicly
  // phase 74: a room may belong to a mentorship session — only its mentor, learner (and a minor's guardian) may join
  const DENY = ["هذه الجلسة لأعضاء مجموعة الدراسة فقط", "هذه جلسة إرشاد خاصة بالمرشد والمتعلّم"];
  const guardMsg = async (rid, uid) => { const gs = [ctx.services.study?.roomAccess, ctx.services.mentors?.roomAccess]; for (let i = 0; i < gs.length; i++) if (gs[i] && !(await gs[i](rid, uid))) return DENY[i]; return null; };
  R.post("/api/rooms", A(async (req) => createRoom(req.user, { title: req.body.title, topic: req.body.topic })));
  R.get("/api/rooms", A(async () => {
    const rooms = await db.all("SELECT r.*, u.name hn, u.handle hh, u.avatar ha, u.color hc, (SELECT COUNT(*) FROM room_members m WHERE m.room=r.id AND m.left_at IS NULL) n, (SELECT COUNT(*) FROM room_members m WHERE m.room=r.id AND m.left_at IS NULL AND m.role IN ('host','speaker')) sp FROM rooms r JOIN users u ON u.id=r.host WHERE r.status='live' AND NOT EXISTS (SELECT 1 FROM study_sessions s WHERE s.room_id=r.id) AND NOT EXISTS (SELECT 1 FROM mentor_sessions ms WHERE ms.room_id=r.id) ORDER BY n DESC, r.started_at DESC LIMIT 50");
    return { rooms: rooms.map(r => ({ id: r.id, title: r.title, topic: r.topic, startedAt: r.started_at, listeners: Number(r.n), speakers: Number(r.sp), host: { id: r.host, name: r.hn, handle: r.hh, avatar: r.ha, color: r.hc } })) };
  }));
  R.get("/api/rooms/:id", A(async (req) => { { const no = await guardMsg(req.params.id, req.user.id); if (no) throw E.forbid(no); } return state(req.params.id); }));
  R.post("/api/rooms/:id/join", A(async (req) => {
    const r = await live(req.params.id); { const no = await guardMsg(r.id, req.user.id); if (no) throw E.forbid(no); } const ex = await db.get("SELECT * FROM room_members WHERE room=$1 AND user_id=$2", [r.id, req.user.id]);
    if (ex) await db.run("UPDATE room_members SET left_at=NULL, joined_at=$1, hand=0 WHERE room=$2 AND user_id=$3", [now(), r.id, req.user.id]);
    else await db.run("INSERT INTO room_members(room,user_id,role,joined_at) VALUES($1,$2,'listener',$3)", [r.id, req.user.id, now()]);
    return broadcast(r.id);
  }));
  R.post("/api/rooms/:id/leave", A(async (req) => {
    const m = await member(req.params.id, req.user.id); if (!m) return { ok: true };
    if (m.role === "host") return endRoom(req.params.id);
    await db.run("UPDATE room_members SET left_at=$1, hand=0, role=CASE WHEN role='speaker' THEN 'listener' ELSE role END WHERE room=$2 AND user_id=$3", [now(), req.params.id, req.user.id]);
    await broadcast(req.params.id); return { ok: true };
  }));
  R.post("/api/rooms/:id/hand", A(async (req) => {
    await live(req.params.id); const m = await member(req.params.id, req.user.id); if (!m) throw E.forbid();
    await db.run("UPDATE room_members SET hand=$1 WHERE room=$2 AND user_id=$3", [req.body.up ? 1 : 0, req.params.id, req.user.id]); return broadcast(req.params.id);
  }));
  R.post("/api/rooms/:id/role", A(async (req) => {
    await live(req.params.id); await needHost(req.params.id, req.user.id);
    const role = req.body.role === "speaker" ? "speaker" : "listener"; const t = await member(req.params.id, req.body.user); if (!t || t.role === "host") throw E.bad();
    if (role === "speaker" && !lkOn && (await db.get("SELECT COUNT(*) n FROM room_members WHERE room=$1 AND left_at IS NULL AND role IN ('host','speaker')", [req.params.id])).n >= MAX_MESH_SPEAKERS) throw E.bad(`الحد الأقصى ${MAX_MESH_SPEAKERS} متحدثين بدون خادم LiveKit`);
    await db.run("UPDATE room_members SET role=$1, hand=0, muted=1 WHERE room=$2 AND user_id=$3", [role, req.params.id, req.body.user]); return broadcast(req.params.id);
  }));
  R.post("/api/rooms/:id/mute", A(async (req) => {
    await live(req.params.id); const target = req.body.user || req.user.id;
    if (target !== req.user.id) { await needHost(req.params.id, req.user.id); if (!req.body.muted) throw E.forbid("لا يمكن إلغاء كتم متحدث آخر"); }
    await db.run("UPDATE room_members SET muted=$1 WHERE room=$2 AND user_id=$3", [req.body.muted ? 1 : 0, req.params.id, target]); return broadcast(req.params.id);
  }));
  R.post("/api/rooms/:id/signal", A(async (req) => {
    if (!rl.hit("default", "sig:" + req.user.id)) throw E.rate();
    const [a, b] = await Promise.all([member(req.params.id, req.user.id), member(req.params.id, req.body.to)]); if (!a || !b) throw E.forbid();
    const data = req.body.data; if (!data || JSON.stringify(data).length > 20000) throw E.bad();
    ctx.realtime.send(req.body.to, "rtc", { room: req.params.id, from: req.user.id, data }); return { ok: true };
  }));
  R.get("/api/rooms/:id/token", A(async (req) => {
    const m = await member(req.params.id, req.user.id); if (!m) throw E.forbid();
    const ice = [{ urls: (process.env.STUN_URLS || "stun:stun.l.google.com:19302").split(",") }, ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: secret("TURN_PASSWORD") }] : [])];
    if (!lkOn) return { mode: "mesh", iceServers: ice };
    return { mode: "livekit", url: LK.url, token: livekitToken({ ...LK, room: req.params.id, identity: req.user.id, name: req.user.name, canPublish: m.role !== "listener" }) };
  }));
  async function endRoom(rid) {
    await db.run("UPDATE rooms SET status='ended', ended_at=$1 WHERE id=$2 AND status='live'", [now(), rid]);
    const s = await broadcast(rid, "room");
    await db.run("UPDATE room_members SET left_at=$1 WHERE room=$2 AND left_at IS NULL", [now(), rid]);
    return s;
  }
  R.post("/api/rooms/:id/end", A(async (req) => { await needHost(req.params.id, req.user.id); return endRoom(req.params.id); }));
  ctx.bus.on("POST_CREATED", async e => { const room = e.post?.data?.audio?.room; if (room) await db.run("UPDATE rooms SET recording_post=$1 WHERE id=$2 AND host=$3", [e.post.id, room, e.post.author]); });
  /** v2.75: a tip landed on this live room — show a cheer to everyone in it (amount + name, or anonymous) */
  async function tipCheer(rid, cheer) { try { await broadcast(rid, "room_tip", cheer); } catch { /* room gone */ } }
  return { state, livekitToken, endRoom, createRoom, tipCheer };
};
