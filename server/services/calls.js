/* Calls (Track 6, phase 30): 1:1 and group (≤ 8) voice/video calls over a WebRTC mesh.
 * The server owns the call lifecycle and relays signalling; media never touches it.
 *   • lifecycle  call: ringing → active → ended (reason: completed|missed|declined|busy|cancelled)
 *                participant: ringing → joined|declined|missed|busy ; joined → left ; left|declined|missed|busy → joined (group rejoin)
 *   • privacy    only people allowed to message the callee can ring them (policy.messageMode "inbox", or an
 *                accepted conversation, or fellow accepted members of the conversation the call is placed from);
 *                blocks cut both ways
 *   • signalling realtime events "call" (full state), "call_signal" (SDP/ICE relay), "call_quality" over the SSE
 *                stream (the same ctx.realtime fan-out the chat WebSocket mirrors); POST endpoints for client → server
 *   • offline    bus events CALL_INCOMING / CALL_MISSED / CALL_ENDED (push + email live in the notify service)
 *   • ICE        public STUN by default; self-hosted coturn with time-limited HMAC credentials (TURN REST API,
 *                use-auth-secret): username "<expiry>:<userId>", credential base64(HMAC-SHA1(TURN_SECRET, username));
 *                or managed Cloudflare Realtime TURN minted per user (CF_TURN_KEY_ID + CF_TURN_API_TOKEN) — see iceConfigLive
 *   • liveness   ring timeout (CALL_RING_SECONDS, default 35) and a heartbeat (POST …/stats every ~5 s) — peers
 *                silent for CALL_STALE_SECONDS (default 45) are retired by a leased sweep job. */
const crypto = require("node:crypto");
const { E, id, now } = require("../lib/core");
const { secret } = require("../lib/secrets");
const { log } = require("../lib/log");

const MAX_PARTICIPANTS = 8;
const KINDS = ["voice", "video"];
const LEVELS = ["high", "medium", "low", "audio"];
const PARTICIPANT_FLOW = { ringing: ["joined", "declined", "missed", "busy", "left"], joined: ["left"], left: ["joined", "ringing"], declined: ["joined", "ringing"], missed: ["joined", "ringing"], busy: ["joined", "ringing"] };
const CALL_FLOW = { ringing: ["active", "ended"], active: ["ended"], ended: [] };
/** @param {Record<string,string[]>} flow @param {string} from @param {string} to */
const canMove = (flow, from, to) => (flow[from] || []).includes(to);

/* Time-limited TURN credentials per the coturn REST API spec (draft-uberti-behave-turn-rest). */
function turnCredentials({ secret: key, userId, ttl = 86400, at = Date.now() }) {
  const expiry = Math.floor(at / 1000) + ttl, username = `${expiry}:${userId}`;
  const credential = crypto.createHmac("sha1", key).update(username).digest("base64");
  return { username, credential, ttl, expiresAt: new Date(expiry * 1000).toISOString() };
}
const DEFAULT_STUN = "stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478";
const list = (s) => String(s || "").split(",").map(x => x.trim()).filter(Boolean);
/** ICE servers for one user. env: STUN_URLS, TURN_URLS + TURN_SECRET (+ TURN_TTL), legacy static TURN_URL/TURN_USER/TURN_PASSWORD, CALL_FORCE_RELAY=1 */
function iceConfig(userId, { env = process.env, getSecret = secret, at = Date.now() } = {}) {
  const iceServers = [{ urls: list(env.STUN_URLS || DEFAULT_STUN) }];
  const turnUrls = list(env.TURN_URLS), key = getSecret("TURN_SECRET"), ttl = Math.max(60, +(env.TURN_TTL || 86400));
  let expiresAt = null;
  if (turnUrls.length && key) { const c = turnCredentials({ secret: key, userId, ttl, at }); iceServers.push({ urls: turnUrls, username: c.username, credential: c.credential }); expiresAt = c.expiresAt; }
  else if (env.TURN_URL) iceServers.push({ urls: list(env.TURN_URL), username: env.TURN_USER, credential: getSecret("TURN_PASSWORD") });
  const turn = iceServers.length > 1;
  return { iceServers, iceTransportPolicy: env.CALL_FORCE_RELAY === "1" && turn ? "relay" : "all", turn, ttl: turn ? ttl : null, expiresAt };
}
/* Managed TURN (Cloudflare Realtime): with CF_TURN_KEY_ID + CF_TURN_API_TOKEN (accepts _FILE) the server mints short-lived
 * per-user credentials (TTL ≤ 48 h) from rtc.live.cloudflare.com and puts them first; any configured coturn/static TURN from
 * iceConfig() is kept as a second server. Port-53 URLs are dropped (browsers block them). Credentials are cached per user for
 * half their TTL; on any API failure it degrades to iceConfig() so calls keep working over STUN/coturn. */
const CF_TURN_API = "https://rtc.live.cloudflare.com/v1/turn/keys";
async function iceConfigLive(userId, { env = process.env, getSecret = secret, fetchImpl = globalThis.fetch, at = Date.now(), cache = null, warn = () => { } } = {}) {
  const base = iceConfig(userId, { env, getSecret, at });
  const keyId = env.CF_TURN_KEY_ID, token = getSecret("CF_TURN_API_TOKEN");
  if (!keyId || !token || typeof fetchImpl !== "function") return base;
  const hit = cache?.get(userId); if (hit && hit.until > at) return hit.cfg;
  const ttl = Math.min(172800, Math.max(60, +(env.TURN_TTL || 86400)));
  try {
    const r = await fetchImpl(`${CF_TURN_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl }), signal: AbortSignal.timeout(+(env.CF_TURN_TIMEOUT_MS || 4000)) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const managed = (j.iceServers || []).filter(s => s && s.username && s.credential).map(s => ({ urls: [].concat(s.urls).filter(u => typeof u === "string" && !/:53(\?|$)/.test(u)), username: s.username, credential: s.credential })).filter(s => s.urls.length);
    if (!managed.length) throw new Error("no TURN servers in response");
    const cfg = { iceServers: [base.iceServers[0], ...managed, ...base.iceServers.slice(1)], iceTransportPolicy: env.CALL_FORCE_RELAY === "1" ? "relay" : "all", turn: true, ttl, expiresAt: new Date(at + ttl * 1000).toISOString(), provider: "cloudflare" };
    if (cache) { cache.set(userId, { cfg, until: at + ttl * 500 }); if (cache.size > 5000) cache.delete(cache.keys().next().value); }
    return cfg;
  } catch (e) { warn("cloudflare TURN credentials unavailable; falling back to STUN/coturn", { error: e.message }); return base; }
}

/* What a call becomes given its participants (pure). Returns { status, reason } — reason only when ended. */
function decide(status, parts) {
  if (status === "ended") return { status, reason: null };
  const joined = parts.filter(p => p.state === "joined"), ringing = parts.filter(p => p.state === "ringing");
  if (status === "ringing") {
    const host = parts.find(p => p.role === "host");
    if (joined.length >= 2) return { status: "active", reason: null };
    if (!host || host.state !== "joined") return { status: "ended", reason: "cancelled" };
    if (!ringing.length) return { status: "ended", reason: parts.some(p => p.state === "declined") ? "declined" : parts.some(p => p.state === "busy") ? "busy" : "missed" };
    return { status, reason: null };
  }
  if (!joined.length || (joined.length === 1 && !ringing.length)) return { status: "ended", reason: "completed" };
  return { status, reason: null };
}

module.exports = (ctx) => {
  const { db, bus, router: R } = ctx; const A = ctx.requireUser;
  /* every call event carries a per-process sequence number `_e`: realtime.send fans out to SSE *and* the
   * WebSocket hub, so a client listening on both de-duplicates on it */
  let seq = 0;
  const realtime = { send: (uid, type, data) => ctx.realtime.send(uid, type, { ...data, _e: ++seq }), get clients() { return ctx.realtime.clients; } };
  const ringMs = () => +(ctx.config.callRingMs || (+process.env.CALL_RING_SECONDS || 35) * 1000);
  const staleMs = () => +(ctx.config.callStaleMs || (+process.env.CALL_STALE_SECONDS || 45) * 1000);
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const locks = new Map();
  /** serialize all mutations of one call (accept/decline/hang-up races) */
  const lock = (cid, fn) => { const p = (locks.get(cid) || Promise.resolve()).then(fn, fn); const q = p.catch(() => { }); locks.set(cid, q); q.then(() => { if (locks.get(cid) === q) locks.delete(cid); }); return p; };
  const startHits = new Map(), sigHits = new Map();
  const limited = (m, key, max, ms) => { const t = Date.now(), a = (m.get(key) || []).filter(x => t - x < ms); if (a.length >= max) { m.set(key, a); return true; } a.push(t); m.set(key, a); if (m.size > 5000) m.delete(m.keys().next().value); return false; };

  /* ---------- state ---------- */
  const parseQ = (q) => { if (!q) return null; if (typeof q === "string") { try { return JSON.parse(q); } catch { return null; } } return q; };
  async function load(cid) {
    const c = await db.get("SELECT * FROM call_sessions WHERE id=$1", [cid]); if (!c) return null;
    const ps = await db.all("SELECT p.*, u.name, u.handle, u.avatar, u.color, u.verified FROM call_participants p JOIN users u ON u.id=p.user_id WHERE p.call=$1 ORDER BY p.invited_at, p.user_id", [cid]);
    return { c, ps };
  }
  const view = ({ c, ps }) => ({
    call: { id: c.id, kind: c.kind, mode: c.mode, conv: c.conv || null, host: c.host, status: c.status, endReason: c.end_reason || null, createdAt: c.created_at, answeredAt: c.answered_at || null, endedAt: c.ended_at || null, duration: Number(c.duration) || 0, ringMs: ringMs() },
    participants: ps.map(p => ({ id: p.user_id, name: p.name, handle: p.handle, avatar: p.avatar || null, color: p.color, verified: p.verified || null, role: p.role, state: p.state, invitedAt: p.invited_at, joinedAt: p.joined_at || null, leftAt: p.left_at || null, mic: !!p.mic, camera: !!p.camera, screen: !!p.screen, quality: parseQ(p.quality)?.level || null }))
  });
  async function state(cid) { const s = await load(cid); if (!s) throw E.nf("المكالمة غير موجودة"); return view(s); }
  async function broadcast(cid) { const s = await state(cid); for (const p of s.participants) realtime.send(p.id, "call", s); return s; }
  const part = (cid, uid) => db.get("SELECT * FROM call_participants WHERE call=$1 AND user_id=$2", [cid, uid]);
  async function mine(cid, uid) { const s = await load(cid); if (!s) throw E.nf("المكالمة غير موجودة"); const me = s.ps.find(p => p.user_id === uid); if (!me) throw E.forbid(); return { ...s, me }; }

  /* settle: apply decide(); on end retire ringing → missed and joined → left, emit bus events */
  async function settle(cid) {
    const s = await load(cid); if (!s || s.c.status === "ended") return s && view(s);
    const d = decide(s.c.status, s.ps.map(p => ({ role: p.role, state: p.state })));
    if (d.status === s.c.status) return null;
    const at = now();
    if (d.status === "active") { await db.run("UPDATE call_sessions SET status='active', answered_at=COALESCE(answered_at,$1) WHERE id=$2 AND status='ringing'", [at, cid]); return null; }
    const dur = s.c.answered_at ? Math.max(0, Math.round((Date.parse(at) - Date.parse(s.c.answered_at)) / 1000)) : 0;
    const x = await db.run("UPDATE call_sessions SET status='ended', end_reason=$1, ended_at=$2, duration=$3 WHERE id=$4 AND status<>'ended'", [d.reason, at, dur, cid]);
    if (!x.changes) return null;
    const missed = s.ps.filter(p => p.state === "ringing");
    await db.run("UPDATE call_participants SET state='missed' WHERE call=$1 AND state='ringing'", [cid]);
    await db.run("UPDATE call_participants SET state='left', left_at=$1, screen=0 WHERE call=$2 AND state='joined'", [at, cid]);
    for (const p of missed) bus.emit("CALL_MISSED", { call: cid, user: p.user_id, from: s.c.host, kind: s.c.kind, mode: s.c.mode, conv: s.c.conv || null, reason: d.reason, at });
    bus.emit("CALL_ENDED", { call: cid, host: s.c.host, kind: s.c.kind, mode: s.c.mode, reason: d.reason, duration: dur, participants: s.ps.map(p => p.user_id), at });
    clearTimeout(timers.get(cid)); timers.delete(cid);
    return null;
  }
  const change = (cid, fn) => lock(cid, async () => { await fn(); await settle(cid); return broadcast(cid); });

  /* ---------- privacy ---------- */
  async function convMembers(conv, uid) {
    const ms = await db.all("SELECT user_id, state FROM conversation_members WHERE conv=$1", [conv]);
    const me = ms.find(m => m.user_id === uid); if (!me || (me.state && me.state !== "accepted")) throw E.forbid();
    return new Set(ms.filter(m => m.user_id !== uid && (!m.state || m.state === "accepted")).map(m => m.user_id));
  }
  /** may `caller` ring `targetId`? (convSet: accepted fellow members of the conversation the call is placed from) */
  async function callable(caller, targetId, convSet) {
    const t = await db.get("SELECT id, prefs, privacy, status FROM users WHERE id=$1", [targetId]);
    if (!t || t.id === caller.id || (t.status && t.status !== "active")) return false;
    if ((t.prefs?.blocked || []).includes(caller.id) || (caller.prefs?.blocked || []).includes(t.id)) return false;
    if (convSet?.has(t.id)) return true;
    const mode = await ctx.policy.messageMode(caller.id, t);
    if (!mode) return false;
    if (mode === "inbox") return true;
    // message-request territory: only once the callee accepted a conversation with the caller
    return !!(await db.get("SELECT 1 x FROM conversation_members a JOIN conversation_members b ON a.conv=b.conv WHERE a.user_id=$1 AND b.user_id=$2 AND b.state='accepted'", [caller.id, t.id]));
  }
  const busy = async (uid, except) => !!(await db.get("SELECT 1 x FROM call_participants p JOIN call_sessions c ON c.id=p.call WHERE p.user_id=$1 AND p.call<>$2 AND c.status<>'ended' AND (p.state='ringing' OR p.state='joined')", [uid, except || ""]));
  const fresh = async (u) => ({ ...u, prefs: (await db.get("SELECT prefs FROM users WHERE id=$1", [u.id]))?.prefs || u.prefs || {} });

  /* ---------- ringing ---------- */
  const timers = new Map();
  function armRing(cid) {
    clearTimeout(timers.get(cid));
    const t = setTimeout(() => { timers.delete(cid); expire(cid).catch(() => { }); }, ringMs() + 250); t.unref?.(); timers.set(cid, t);
  }
  async function ring(c, uids, from) {
    const s = await state(c.id);
    for (const uid of uids) { realtime.send(uid, "call", s); bus.emit("CALL_INCOMING", { call: c.id, to: uid, from, kind: c.kind, mode: c.mode, conv: c.conv || null, online: realtime.clients.has(uid) || !!ctx.ws?.online?.(uid), at: now() }); }
    armRing(c.id);
  }
  async function expire(cid) {
    return change(cid, () => missRinging(cid));
  }
  /* ringing past the timeout → missed (each one gets CALL_MISSED; the call may continue for the rest) */
  async function missRinging(cid) {
    const rows = await db.all("SELECT p.user_id, c.host, c.kind, c.mode, c.conv FROM call_participants p JOIN call_sessions c ON c.id=p.call WHERE p.call=$1 AND p.state='ringing' AND p.invited_at < $2", [cid, ago(ringMs())]);
    const at = now();
    for (const r of rows) {
      const x = await db.run("UPDATE call_participants SET state='missed' WHERE call=$1 AND user_id=$2 AND state='ringing'", [cid, r.user_id]);
      if (x.changes) bus.emit("CALL_MISSED", { call: cid, user: r.user_id, from: r.host, kind: r.kind, mode: r.mode, conv: r.conv || null, reason: "timeout", at });
    }
  }
  /* leased sweep: ring timeouts (after restarts) and dead peers */
  async function sweep() {
    const rows = await db.all("SELECT DISTINCT p.call FROM call_participants p JOIN call_sessions c ON c.id=p.call WHERE c.status<>'ended' AND ((p.state='ringing' AND p.invited_at < $1) OR (p.state='joined' AND COALESCE(p.seen_at,p.joined_at) < $2))", [ago(ringMs()), ago(staleMs())]);
    for (const r of rows) await change(r.call, async () => {
      await missRinging(r.call);
      await db.run("UPDATE call_participants SET state='left', left_at=$1, screen=0 WHERE call=$2 AND state='joined' AND COALESCE(seen_at,joined_at) < $3", [now(), r.call, ago(staleMs())]);
    });
    return { swept: rows.length };
  }
  ctx.scheduler.every("callSweep", +(ctx.config.callSweepMs || 5000), sweep);

  /* ---------- actions ---------- */
  async function start(user, b) {
    if (limited(startHits, user.id, 10, 60e3)) throw E.rate();
    const kind = KINDS.includes(b.kind) ? b.kind : "voice";
    const caller = await fresh(user);
    let convSet = null, conv = null;
    if (b.conv) { conv = String(b.conv); convSet = await convMembers(conv, user.id); }
    let wanted = [...new Set([...(Array.isArray(b.users) ? b.users : []), ...(b.to ? [b.to] : [])].filter(x => typeof x === "string" && x !== user.id))];
    const fromConv = !wanted.length && !!convSet;
    if (fromConv) wanted = [...convSet];
    if (!wanted.length) throw E.bad("اختر من تريد الاتصال به");
    if (wanted.length + 1 > MAX_PARTICIPANTS) throw E.bad(`الحد الأقصى ${MAX_PARTICIPANTS} مشاركين في المكالمة`);
    const ok = [];
    for (const uid of wanted) { if (await callable(caller, uid, convSet)) ok.push(uid); else if (!fromConv) throw E.forbid("لا يمكنك الاتصال بهذا المستخدم"); }
    if (!ok.length) throw E.forbid("لا يوجد من يمكنك الاتصال به في هذه المحادثة");
    if (await busy(user.id)) throw E.conflict("أنت في مكالمة أخرى");
    const cid = id("cl"), at = now(), mode = ok.length > 1 ? "group" : "direct";
    const busyOnes = new Set(); for (const uid of ok) if (await busy(uid)) busyOnes.add(uid);
    await db.tx(async t => {
      await t.run("INSERT INTO call_sessions(id,kind,mode,conv,host,status,created_at) VALUES($1,$2,$3,$4,$5,'ringing',$6)", [cid, kind, mode, conv, user.id, at]);
      await t.run("INSERT INTO call_participants(call,user_id,role,state,invited_at,joined_at,seen_at,camera) VALUES($1,$2,'host','joined',$3,$3,$3,$4)", [cid, user.id, at, kind === "video" ? 1 : 0]);
      for (const uid of ok) await t.run("INSERT INTO call_participants(call,user_id,role,state,invited_by,invited_at) VALUES($1,$2,'guest',$3,$4,$5)", [cid, uid, busyOnes.has(uid) ? "busy" : "ringing", user.id, at]);
    });
    for (const uid of busyOnes) bus.emit("CALL_MISSED", { call: cid, user: uid, from: user.id, kind, mode, conv, reason: "busy", at });
    const c = { id: cid, kind, mode, conv };
    const ringing = ok.filter(u => !busyOnes.has(u));
    await lock(cid, () => settle(cid));
    if (ringing.length) await ring(c, ringing, user.id);
    return broadcast(cid);
  }
  async function leaveOthers(uid, except) {
    for (const r of await db.all("SELECT p.call FROM call_participants p JOIN call_sessions c ON c.id=p.call WHERE p.user_id=$1 AND p.call<>$2 AND c.status<>'ended' AND p.state='joined'", [uid, except]))
      await change(r.call, () => db.run("UPDATE call_participants SET state='left', left_at=$1, screen=0 WHERE call=$2 AND user_id=$3 AND state='joined'", [now(), r.call, uid]));
  }
  async function accept(user, cid, b) {
    const { c, me } = await mine(cid, user.id);
    if (c.status === "ended") throw E.conflict("انتهت المكالمة");
    if (me.state === "joined") return state(cid);
    if (me.state !== "ringing" && !(c.status === "active" && canMove(PARTICIPANT_FLOW, me.state, "joined"))) throw E.conflict("لم تعد المكالمة ترن");
    await leaveOthers(user.id, cid); // answering a call ends the one you were in
    const camera = b.camera === undefined ? c.kind === "video" : !!b.camera;
    return change(cid, async () => {
      const at = now();
      const x = await db.run("UPDATE call_participants SET state='joined', joined_at=$1, seen_at=$1, left_at=NULL, mic=1, camera=$2, screen=0 WHERE call=$3 AND user_id=$4 AND state<>'joined'", [at, camera ? 1 : 0, cid, user.id]);
      if (!x.changes) throw E.conflict("لم تعد المكالمة ترن");
    });
  }
  async function decline(user, cid) {
    const { c, me } = await mine(cid, user.id);
    if (c.status === "ended" || me.state !== "ringing") return state(cid);
    return change(cid, () => db.run("UPDATE call_participants SET state='declined' WHERE call=$1 AND user_id=$2 AND state='ringing'", [cid, user.id]));
  }
  async function hangup(user, cid) {
    const { c, me } = await mine(cid, user.id);
    if (c.status === "ended") return state(cid);
    if (me.state === "ringing") return decline(user, cid);
    if (me.state !== "joined") return state(cid);
    return change(cid, () => db.run("UPDATE call_participants SET state='left', left_at=$1, screen=0 WHERE call=$2 AND user_id=$3 AND state='joined'", [now(), cid, user.id]));
  }
  async function invite(user, cid, b) {
    const { c, ps, me } = await mine(cid, user.id);
    if (c.status === "ended") throw E.conflict("انتهت المكالمة");
    if (me.state !== "joined") throw E.forbid();
    const users = [...new Set((Array.isArray(b.users) ? b.users : [b.user]).filter(x => typeof x === "string" && x !== user.id))];
    if (!users.length) throw E.bad();
    const known = new Map(ps.map(p => [p.user_id, p]));
    const add = users.filter(u => !known.has(u)), reRing = users.filter(u => known.has(u) && canMove(PARTICIPANT_FLOW, known.get(u).state, "ringing"));
    if (ps.length + add.length > MAX_PARTICIPANTS) throw E.bad(`الحد الأقصى ${MAX_PARTICIPANTS} مشاركين في المكالمة`);
    const inviter = await fresh(user), convSet = c.conv ? await convMembers(c.conv, user.id).catch(() => null) : null;
    for (const u of add) if (!(await callable(inviter, u, convSet))) throw E.forbid("لا يمكنك الاتصال بهذا المستخدم");
    const ringing = [];
    await lock(cid, async () => {
      const at = now();
      for (const u of [...add, ...reRing]) {
        const st = (await busy(u, cid)) ? "busy" : "ringing";
        if (add.includes(u)) await db.run("INSERT INTO call_participants(call,user_id,role,state,invited_by,invited_at) VALUES($1,$2,'guest',$3,$4,$5) ON CONFLICT DO NOTHING", [cid, u, st, user.id, at]);
        else await db.run("UPDATE call_participants SET state=$1, invited_by=$2, invited_at=$3 WHERE call=$4 AND user_id=$5", [st, user.id, at, cid, u]);
        if (st === "ringing") ringing.push(u); else bus.emit("CALL_MISSED", { call: cid, user: u, from: user.id, kind: c.kind, mode: "group", conv: c.conv || null, reason: "busy", at });
      }
      await db.run("UPDATE call_sessions SET mode='group' WHERE id=$1", [cid]);
    });
    if (ringing.length) await ring({ id: cid, kind: c.kind, mode: "group", conv: c.conv }, ringing, user.id);
    return broadcast(cid);
  }
  async function signal(user, cid, b) {
    if (limited(sigHits, user.id, 900, 60e3)) throw E.rate();
    const data = b.data; if (!data || typeof data !== "object" || JSON.stringify(data).length > 64000) throw E.bad();
    if (typeof b.to !== "string") throw E.bad();
    const [a, t] = await Promise.all([part(cid, user.id), part(cid, b.to)]);
    if (!a || !t || a.state !== "joined" || t.state !== "joined") throw E.forbid();
    realtime.send(b.to, "call_signal", { call: cid, from: user.id, data });
    return { ok: true };
  }
  async function media(user, cid, b) {
    const { c, me } = await mine(cid, user.id); if (c.status === "ended" || me.state !== "joined") throw E.forbid();
    const v = (k) => b[k] === undefined ? me[k] : (b[k] ? 1 : 0);
    return change(cid, () => db.run("UPDATE call_participants SET mic=$1, camera=$2, screen=$3, seen_at=$4 WHERE call=$5 AND user_id=$6", [v("mic"), v("camera"), v("screen"), now(), cid, user.id]));
  }
  const num = (x, max) => (typeof x === "number" && isFinite(x) ? Math.max(0, Math.min(max, Math.round(x * 1000) / 1000)) : null);
  async function stats(user, cid, b) {
    const me = await part(cid, user.id); if (!me) throw E.forbid();
    const c = await db.get("SELECT status FROM call_sessions WHERE id=$1", [cid]);
    if (c.status === "ended" || me.state !== "joined") return { ok: true, callStatus: c.status, state: me.state };
    const q = { level: LEVELS.includes(b.level) ? b.level : null, rtt: num(b.rtt, 60), loss: num(b.loss, 1), kbps: num(b.kbps, 1e5), at: now() };
    const prev = parseQ(me.quality)?.level || null;
    await db.run("UPDATE call_participants SET seen_at=$1, quality=$2 WHERE call=$3 AND user_id=$4", [q.at, q, cid, user.id]);
    if (q.level !== prev) for (const p of await db.all("SELECT user_id FROM call_participants WHERE call=$1 AND state='joined' AND user_id<>$2", [cid, user.id])) realtime.send(p.user_id, "call_quality", { call: cid, user: user.id, level: q.level, rtt: q.rtt, loss: q.loss });
    return { ok: true, callStatus: c.status, state: me.state };
  }
  async function history(user, q) {
    const limit = Math.min(50, Math.max(1, +q.limit || 30)), before = typeof q.before === "string" ? q.before : null;
    const rows = await db.all(`SELECT c.*, p.state AS my_state, p.role AS my_role, p.acked, p.invited_at AS my_at FROM call_participants p JOIN call_sessions c ON c.id=p.call WHERE p.user_id=$1 AND p.hidden=0 ${before ? "AND p.invited_at < $3" : ""} ORDER BY p.invited_at DESC LIMIT $2`, before ? [user.id, limit, before] : [user.id, limit]);
    const ids = rows.map(r => r.id);
    const others = ids.length ? await db.all(`SELECT p.call, p.user_id, p.state, u.name, u.handle, u.avatar, u.color FROM call_participants p JOIN users u ON u.id=p.user_id WHERE p.call IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids) : [];
    const calls = rows.map(r => {
      const missed = r.my_role !== "host" && (r.my_state === "missed" || (r.my_state === "busy"));
      return { id: r.id, kind: r.kind, mode: r.mode, conv: r.conv || null, status: r.status, endReason: r.end_reason || null, direction: r.my_role === "host" ? "outgoing" : "incoming", myState: r.my_state, missed, seen: !!r.acked || !missed, at: r.my_at, answeredAt: r.answered_at || null, endedAt: r.ended_at || null, duration: Number(r.duration) || 0,
        participants: others.filter(o => o.call === r.id && o.user_id !== user.id).map(o => ({ id: o.user_id, name: o.name, handle: o.handle, avatar: o.avatar || null, color: o.color, state: o.state })) };
    });
    const unseen = (await db.get("SELECT COUNT(*) n FROM call_participants WHERE user_id=$1 AND role<>'host' AND (state='missed' OR state='busy') AND acked=0 AND hidden=0", [user.id]))?.n || 0;
    return { calls, unseenMissed: Number(unseen), next: rows.length === limit ? rows[rows.length - 1].my_at : null };
  }
  async function active(user) {
    const r = await db.get("SELECT p.call FROM call_participants p JOIN call_sessions c ON c.id=p.call WHERE p.user_id=$1 AND c.status<>'ended' AND (p.state='ringing' OR p.state='joined') ORDER BY CASE p.state WHEN 'joined' THEN 0 ELSE 1 END, p.invited_at DESC LIMIT 1", [user.id]);
    return { active: r ? await state(r.call) : null };
  }

  /* ---------- routes ---------- */
  const iceCache = new Map();
  const ice = (uid) => iceConfigLive(uid, { cache: iceCache, warn: (m, f) => log.warn(m, f) });
  R.get("/api/calls/ice", A(async (req) => ice(req.user.id)));
  R.get("/api/calls", A(async (req) => history(req.user, req.query)));
  R.get("/api/calls/active", A(async (req) => active(req.user)));
  R.post("/api/calls", A(async (req) => start(req.user, req.body)));
  R.post("/api/calls/seen", A(async (req) => (await db.run("UPDATE call_participants SET acked=1 WHERE user_id=$1 AND acked=0", [req.user.id]), { ok: true })));
  R.get("/api/calls/:id", A(async (req) => { await mine(req.params.id, req.user.id); return state(req.params.id); }));
  R.post("/api/calls/:id/accept", A(async (req) => accept(req.user, req.params.id, req.body)));
  R.post("/api/calls/:id/join", A(async (req) => accept(req.user, req.params.id, req.body)));
  R.post("/api/calls/:id/decline", A(async (req) => decline(req.user, req.params.id)));
  R.post("/api/calls/:id/hangup", A(async (req) => hangup(req.user, req.params.id)), { beacon: true });
  R.post("/api/calls/:id/invite", A(async (req) => invite(req.user, req.params.id, req.body)));
  R.post("/api/calls/:id/signal", A(async (req) => signal(req.user, req.params.id, req.body)));
  R.post("/api/calls/:id/media", A(async (req) => media(req.user, req.params.id, req.body)));
  R.post("/api/calls/:id/stats", A(async (req) => stats(req.user, req.params.id, req.body)));
  R.del("/api/calls/:id", A(async (req) => { const x = await db.run("UPDATE call_participants SET hidden=1, acked=1 WHERE call=$1 AND user_id=$2", [req.params.id, req.user.id]); if (!x.changes) throw E.nf(); return { ok: true }; }));

  // low-latency path: the same relay over the chat WebSocket hub when the client is connected to it
  if (ctx.ws?.on) ctx.ws.on("call_signal", (user, m) => typeof m.call === "string" && signal(user, m.call, m));

  return { state, start, accept, decline, hangup, invite, sweep, settle, callable, history, active, iceConfig: (uid) => ice(uid) };
};
Object.assign(module.exports, { turnCredentials, iceConfig, iceConfigLive, decide, canMove, PARTICIPANT_FLOW, CALL_FLOW, MAX_PARTICIPANTS, DEFAULT_STUN });
