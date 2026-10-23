/* =====================================================================
 * مجتمع بلس — v2.7 communication core (Track 6, phases 26–27). Logic only, no UI: comms-ui.js
 * builds the screens on top of window.MPComms. Loaded as the lazy chunk "comms-core".
 *  • realtime: WebSocket (/api/ws) with reconnect + backoff, automatic SSE fallback (/api/stream)
 *  • chat API wrapper (groups, replies, reactions, read cursors, typing, blobs, delete for everyone)
 *  • E2EE with WebCrypto: per-device ECDH P-256 keys (private key non-extractable, kept in IndexedDB),
 *    per-message AES-GCM-256 key wrapped for every device of every member (multi-device), encrypted
 *    attachments, 60-digit safety numbers and verification state
 *  • disappearing-message timers and time grouping helpers for the bubble UI
 * The contract is documented in docs/COMMUNICATION.md (المرحلة 26/27).
 * ===================================================================== */
(function CommsCore(root) {
  const subtle = () => root.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const enc = encodeURIComponent;
  /* App bridge. app.js/sync.js/store.js declare `Remote` and `DB` as top-level let/const in classic scripts:
   * those are global *lexical* bindings, visible to other classic scripts by bare name but never properties
   * of window. Resolve them in this order: an explicit window.MPApp bridge ({ Remote, DB } or getters),
   * the bare global binding (typeof-guarded so Node unit tests don't throw), then window properties. */
  /* global Remote, DB */
  const bridge = () => root.MPApp || null;
  const appRemote = () => { const b = bridge(); if (b && b.Remote) return b.Remote; try { if (typeof Remote !== "undefined") return Remote; } catch { /* TDZ before sync.js ran */ } return root.Remote; };
  const appDB = () => { const b = bridge(); if (b && b.DB) return b.DB; try { if (typeof DB !== "undefined" && DB) return DB; } catch { /* TDZ before store.js ran */ } return root.DB; };
  const api = (...a) => { const R = appRemote(); if (!R) throw new Error("offline"); return R.api(...a); };
  const online = () => { const R = appRemote(); return !!(R && R.on); };
  const meId = () => { const d = appDB(); return (d && d.me) || null; };
  // v2.51: a guest (auth screen) has no chat session — never open /api/ws or /api/stream for it (they answer 401)
  const signedIn = () => { const s = root.MPSession; return !s || s.signedIn(); };

  /* ---------- pure helpers (exported as MPComms.lib for unit tests) ---------- */
  function b64(bytes) { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(str) { const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(str).length / 4) * 4, "=")); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  const concat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  /** 30 bytes → 30 digits: every 5 bytes (big-endian) mod 100000, zero-padded */
  function safetyDigits(bytes) {
    let out = "";
    for (let i = 0; i < 30; i += 5) { let n = 0; for (let j = 0; j < 5; j++) n = n * 256 + bytes[i + j]; out += String(n % 100000).padStart(5, "0"); }
    return out;
  }
  const pad2 = (n) => String(n).padStart(2, "0");
  const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  function dayLabel(iso, now = Date.now()) {
    const k = dayKey(iso);
    if (k === dayKey(now)) return "اليوم";
    if (k === dayKey(now - 864e5)) return "أمس";
    const d = new Date(iso);
    try { return d.toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) }); } catch { return k; }
  }
  /** Day groups → clusters of consecutive messages from one sender within gapMs (bubble grouping). */
  function group(messages, { gapMs = 5 * 60e3, now = Date.now() } = {}) {
    const days = [];
    for (const m of messages) {
      const key = dayKey(m.at);
      let day = days[days.length - 1];
      if (!day || day.key !== key) days.push(day = { key, day: dayLabel(m.at, now), clusters: [] });
      const last = day.clusters[day.clusters.length - 1], tail = last && last.messages[last.messages.length - 1];
      const joinable = last && m.kind !== "system" && tail.kind !== "system" && last.from === m.from && Date.parse(m.at) - Date.parse(tail.at) <= gapMs;
      if (joinable) last.messages.push(m); else day.clusters.push({ from: m.from, at: m.at, system: m.kind === "system", messages: [m] });
    }
    return days;
  }
  const TTLS = [{ value: 0, label: "إيقاف" }, { value: 300, label: "5 دقائق" }, { value: 3600, label: "ساعة" }, { value: 86400, label: "يوم" }, { value: 604800, label: "أسبوع" }];
  const ttlLabel = (sec) => (TTLS.find(t => t.value === Number(sec)) || TTLS[0]).label;
  const remaining = (m, now = Date.now()) => (m && m.expiresAt ? Math.max(0, Date.parse(m.expiresAt) - now) : null);
  const REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🙏", "🔥", "👏"];

  /* ---------- event emitter ---------- */
  const subs = new Map();
  function on(type, fn) { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); return () => subs.get(type)?.delete(fn); }
  function emit(type, data) { for (const fn of subs.get(type) || []) { try { fn(data); } catch (e) { console.error("[MPComms]", type, e); } } }
  function dispatch(type, data) {
    if (type === "chat" && data && data.type === "keys") { keyCache.delete(data.user); devCache.clear(); }
    emit(type, data);
    if (type === "chat" && data && data.type) emit(data.type, data);
  }

  /* ---------- transport: WebSocket first, SSE fallback ---------- */
  const T = { ws: null, mode: "off", tries: 0, fails: 0, timer: null, want: false, sseAttached: new WeakSet(), es: null };
  const setMode = (m) => { if (T.mode !== m) { T.mode = m; emit("status", { transport: m }); } };
  function attachSse() {
    if (typeof EventSource === "undefined") return;
    const R = appRemote(); let es = R && R.es;
    if (!es) { if (!T.es) T.es = new EventSource("/api/stream"); es = T.es; }
    if (T.sseAttached.has(es)) return;
    T.sseAttached.add(es);
    // the server pushes every event over both transports: SSE frames count only while WS is down
    for (const type of ["chat", "typing"]) es.addEventListener(type, (e) => { if (T.mode === "ws") return; try { dispatch(type, JSON.parse(e.data)); } catch { } });
  }
  const WS_MAX_FAILS = 8; // consecutive WebSocket opens that never succeeded → stay on SSE until the network/session changes
  function connect() {
    if (!signedIn()) return;
    if (!online() || typeof WebSocket === "undefined") { if (online()) { attachSse(); setMode("sse"); } return; }
    T.want = true; attachSse();
    if (T.ws && (T.ws.readyState === 0 || T.ws.readyState === 1)) return;
    let ws;
    try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/ws"); } catch { return fallback(); }
    T.ws = ws; let opened = false;
    ws.onopen = () => { opened = true; T.tries = 0; T.fails = 0; setMode("ws"); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m && m.type) dispatch(m.type, m.data); };
    ws.onclose = () => {
      if (T.ws === ws) T.ws = null;
      if (!opened) T.fails++;
      if (!T.want) return setMode("off");
      if (!signedIn()) { T.want = false; return setMode("off"); } // signed out (401): stop, no retry loop
      if (T.fails >= 2) fallback(); else setMode(online() ? "sse" : "off");
      if (T.fails >= WS_MAX_FAILS) return; // capped: realtime continues over SSE; "online"/sign-in events try WS again
      const delay = Math.min(30e3, 1000 * 2 ** Math.min(T.tries++, 5)) * (0.75 + Math.random() / 2);
      clearTimeout(T.timer); T.timer = setTimeout(connect, delay); // keep retrying WS in the background (exponential backoff + jitter)
    };
  }
  function fallback() { attachSse(); setMode("sse"); }
  function disconnect() { T.want = false; clearTimeout(T.timer); if (T.ws) T.ws.close(); T.ws = null; if (T.es) { T.es.close(); T.es = null; } setMode("off"); }
  const frame = (o) => { if (T.ws && T.ws.readyState === 1) { T.ws.send(JSON.stringify(o)); return true; } return false; };
  const lastTyping = new Map();
  async function typing(conv, isOn = true) {
    const k = conv + ":" + (isOn ? 1 : 0), t = Date.now();
    if (isOn && t - (lastTyping.get(k) || 0) < 3000) return;
    lastTyping.set(k, t);
    if (!isOn) lastTyping.delete(conv + ":1");
    if (!frame({ t: "typing", conv, on: isOn })) await api("POST", `/api/chat/conversations/${conv}/typing`, { on: isOn }).catch(() => { });
  }

  /* ---------- IndexedDB key store ---------- */
  const mem = new Map();
  function idb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === "undefined") return rej(new Error("no-idb"));
      const r = indexedDB.open("mp-comms", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("keys");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function kvGet(k) { try { const d = await idb(); return await new Promise((res, rej) => { const q = d.transaction("keys").objectStore("keys").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch { return mem.get(k); } }
  async function kvSet(k, v) { mem.set(k, v); try { const d = await idb(); await new Promise((res, rej) => { const tx = d.transaction("keys", "readwrite"); tx.objectStore("keys").put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch { } }

  /* ---------- crypto primitives ---------- */
  const rnd = (n) => root.crypto.getRandomValues(new Uint8Array(n));
  const ECDH = { name: "ECDH", namedCurve: "P-256" };
  const importPub = (jwk) => subtle().importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, ECDH, true, []);
  const aesKey = (raw, usages = ["encrypt", "decrypt"]) => subtle().importKey("raw", raw, { name: "AES-GCM" }, false, usages);
  const gcmEnc = async (key, iv, data, ad) => new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: te.encode(ad) }, key, data));
  const gcmDec = async (key, iv, data, ad) => new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv, additionalData: te.encode(ad) }, key, data));
  const pairCache = new Map();
  /** HKDF-SHA256(ECDH(myPriv, peerPub)) bound to both device ids → AES-GCM pair key */
  async function pairKey(myDev, peerId, peerJwk) {
    const ck = myDev.id + "|" + peerId + "|" + peerJwk.x;
    if (pairCache.has(ck)) return pairCache.get(ck);
    const p = (async () => {
      const bits = await subtle().deriveBits({ name: "ECDH", public: await importPub(peerJwk) }, myDev.priv, 256);
      const hk = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
      return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("mujtama-e2ee-v1"), info: te.encode([myDev.id, peerId].sort().join("|")) }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    })();
    pairCache.set(ck, p); p.catch(() => pairCache.delete(ck));
    return p;
  }
  /** Encrypt a JSON payload for a set of devices [{id, pub}] → Envelope {v, from, iv, ct, keys} */
  async function seal(myDev, devices, conv, payload) {
    const K = rnd(32), iv = rnd(12);
    const ct = await gcmEnc(await aesKey(K), iv, te.encode(JSON.stringify(payload)), conv);
    const keys = {};
    for (const d of devices) { const wiv = rnd(12); keys[d.id] = b64(wiv) + "." + b64(await gcmEnc(await pairKey(myDev, d.id, d.pub), wiv, K, conv + "|" + d.id)); }
    return { v: 1, from: myDev.id, iv: b64(iv), ct: b64(ct), keys };
  }
  /** Decrypt an envelope addressed to myDev, given the sender device's public JWK. */
  async function unseal(myDev, senderJwk, conv, env) {
    const w = env.keys && env.keys[myDev.id]; if (!w) { const e = new Error("not-for-device"); e.code = "not-for-device"; throw e; }
    const [wiv, wk] = w.split(".");
    const K = await gcmDec(await pairKey(myDev, env.from, senderJwk), unb64(wiv), unb64(wk), conv + "|" + myDev.id);
    return JSON.parse(td.decode(await gcmDec(await aesKey(K), unb64(env.iv), unb64(env.ct), conv)));
  }
  async function encryptFile(blob) {
    const k = rnd(32), iv = rnd(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, await aesKey(k), await blob.arrayBuffer()));
    return { data: new Blob([ct], { type: "application/octet-stream" }), fk: b64(k), fiv: b64(iv) };
  }
  async function decryptFile(buf, fk, fiv, mime) {
    const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(fiv) }, await aesKey(unb64(fk)), buf);
    return new Blob([pt], { type: mime || "application/octet-stream" });
  }
  /** Iterated SHA-256 over ("mp-sn-v1" | userId | sorted device pubs) → 30 digits */
  async function userDigits(userId, devices) {
    const pubs = devices.map(d => concat(unb64(d.pub.x), unb64(d.pub.y))).sort((a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; });
    const base = concat(te.encode("mp-sn-v1|" + userId + "|"), ...pubs);
    let h = base;
    for (let i = 0; i < 512; i++) h = new Uint8Array(await subtle().digest("SHA-256", concat(h, base)));
    return safetyDigits(h);
  }
  async function safetyFromKeys(a, aDevices, b, bDevices) {
    const [da, db] = await Promise.all([userDigits(a, aDevices), userDigits(b, bDevices)]);
    return a < b ? da + db : db + da;
  }
  const formatSafety = (n) => String(n).match(/.{1,5}/g).join(" ");

  /* ---------- device + key directory ---------- */
  const keyCache = new Map(), devCache = new Map();
  let device = null, readyP = null;
  function deviceName() { const ua = (typeof navigator !== "undefined" && navigator.userAgent) || ""; const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "جهاز"; const br = /PiBrowser/i.test(ua) ? "Pi Browser" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ""; return (br ? br + " · " : "") + os; }
  async function ready() {
    const uid = meId(); if (!uid) throw new Error("not-signed-in");
    if (device && device.user === uid) return device;
    return (readyP ||= (async () => {
      const slot = "device:" + uid;
      let rec = await kvGet(slot);
      const register = (r) => api("POST", "/api/e2ee/devices", { id: r.id, name: r.name, pub: r.pub });
      if (rec) {
        try { await register(rec); } catch (e) { if (e.status === 403 || e.status === 409) rec = null; else throw e; } // revoked elsewhere → new key
      }
      if (!rec) {
        const kp = await subtle().generateKey(ECDH, false, ["deriveBits"]);
        const j = await subtle().exportKey("jwk", kp.publicKey);
        rec = { id: "dk_" + b64(rnd(12)).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 16).padEnd(10, "0"), user: uid, name: deviceName(), priv: kp.privateKey, pub: { kty: "EC", crv: "P-256", x: j.x, y: j.y }, at: new Date().toISOString() };
        await register(rec);
        await kvSet(slot, rec);
      }
      device = rec; keyCache.delete(uid);
      return device;
    })().finally(() => { readyP = null; }));
  }
  async function keys(userIds, { fresh = false } = {}) {
    // cached for 60 s, and dropped at once on a "keys" event, so a peer's new device is picked up quickly
    const t = Date.now(), need = [...new Set(userIds)].filter(u => fresh || !keyCache.has(u) || t - keyCache.get(u).at > 60e3);
    if (need.length) { const r = await api("GET", "/api/e2ee/keys?users=" + need.map(enc).join(",")); for (const u of need) keyCache.set(u, { at: t, list: r.keys[u] || [] }); }
    return Object.fromEntries([...new Set(userIds)].map(u => [u, (keyCache.get(u) || {}).list || []]));
  }
  async function devicePub(did) {
    if (!devCache.has(did)) devCache.set(did, api("GET", "/api/e2ee/devices/" + enc(did)).then(r => r.device.pub).catch((e) => { devCache.delete(did); throw e; }));
    return devCache.get(did);
  }
  async function canEncrypt(userIds) { const k = await keys(userIds, { fresh: true }); return userIds.every(u => (k[u] || []).length > 0); }
  async function enable(convId) { await ready(); const r = await api("POST", `/api/e2ee/conversations/${convId}/enable`); remember({ id: convId, e2ee: true }); return r; }
  async function safetyNumber(myId, peerId) { const k = await keys([myId, peerId], { fresh: true }); if (!k[myId].length || !k[peerId].length) return null; return safetyFromKeys(myId, k[myId], peerId, k[peerId]); }
  async function verification(peerId) {
    const number = await safetyNumber(meId(), peerId);
    const v = (await api("GET", "/api/e2ee/verify/" + enc(peerId))).verification;
    return { number, at: v ? v.at : null, state: !v ? "unverified" : v.fingerprint === number ? "verified" : "changed" };
  }
  async function verify(peerId) { const n = await safetyNumber(meId(), peerId); if (!n) throw new Error("no-keys"); await api("PUT", "/api/e2ee/verify/" + enc(peerId), { fingerprint: n }); return n; }

  /* ---------- chat API ---------- */
  /* Conversation cache. E2EE is one-way (a chat can be switched to encrypted, never back), so a cached
   * `e2ee: true` is always trusted; anything else is only trusted when it came from the detail endpoint within
   * FRESH_MS. List rows, partial patches and caller-supplied objects never prove a chat is still plaintext:
   * the peer may have enabled encryption while our realtime transport was down. */
  const convCache = new Map(), FRESH_MS = 15e3;
  const remember = (c, fresh = false) => {
    if (!c || !c.id) return c;
    const prev = convCache.get(c.id) || {};
    convCache.set(c.id, { ...prev, ...c, e2ee: !!(prev.e2ee || c.e2ee), _fresh: fresh ? Date.now() : prev._fresh || 0 });
    return c;
  };
  async function conversations() { const r = await api("GET", "/api/chat/conversations"); r.conversations.forEach(c => remember(c)); return r; }
  async function conversation(id) { const r = await api("GET", "/api/chat/conversations/" + enc(id)); remember({ ...r.conversation, members: r.conversation.members.map(m => m.user), memberInfo: r.conversation.members }, true); return r; }
  async function getConv(ref, { refresh = false } = {}) {
    const cid = ref && typeof ref === "object" ? ref.id : ref;
    if (!cid) throw new Error("no-conversation");
    if (ref && typeof ref === "object") remember({ id: cid, ...(ref.e2ee ? { e2ee: true } : {}), ...(Array.isArray(ref.members) && typeof ref.members[0] === "string" ? { members: ref.members } : {}) });
    const c = convCache.get(cid);
    const trusted = c && c.members && (c.e2ee || Date.now() - (c._fresh || 0) < FRESH_MS);
    if (refresh || !trusted) await conversation(cid);
    return convCache.get(cid);
  }
  async function openDM(userId) {
    const { conversation: c } = await api("POST", "/api/conversations", { user: userId });
    try { const info = (await conversation(c.id)).conversation; if (!info.e2ee) { await ready(); if (await canEncrypt([meId(), userId])) await enable(c.id); } } catch { }
    return (await conversation(c.id)).conversation;
  }
  const messages = (id, { before, limit } = {}) => api("GET", `/api/chat/conversations/${enc(id)}/messages?` + new URLSearchParams({ ...(before ? { before } : {}), ...(limit ? { limit: String(limit) } : {}) }));
  const createGroup = (title, members) => api("POST", "/api/chat/groups", { title, members });
  const addMembers = (id, users) => api("POST", `/api/chat/conversations/${enc(id)}/members`, { users });
  const removeMember = (id, user) => api("DELETE", `/api/chat/conversations/${enc(id)}/members/${enc(user)}`);
  const leave = (id) => removeMember(id, meId());
  const update = (id, patch) => api("PATCH", `/api/chat/conversations/${enc(id)}`, patch).then(r => (r && r.conversation ? remember({ ...r.conversation, members: r.conversation.members.map(m => m.user || m), memberInfo: r.conversation.members }, true) : remember({ id, ...patch }), r));
  const setTimer = (id, ttl) => update(id, { ttl });
  async function markRead(id) { if (frame({ t: "read", conv: id })) return { ok: true }; return api("POST", `/api/chat/conversations/${enc(id)}/read`); }
  const react = (msgId, emoji) => api("POST", `/api/chat/messages/${enc(msgId)}/react`, { emoji: emoji || null });
  const deleteForEveryone = (msgId) => api("DELETE", `/api/chat/messages/${enc(msgId)}`);
  const uploadBlob = (conv, blob, { encrypted = false } = {}) => api("POST", `/api/chat/conversations/${enc(conv)}/blobs${encrypted ? "?enc=1" : ""}`, null, blob).then(r => r.blob);
  const newId = () => "ms_" + b64(rnd(12)).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 16).padEnd(8, "0");
  /** send(conv, {text, kind, replyTo, file, meta}); encrypts automatically in E2EE conversations */
  async function send(convRef, opts = {}) {
    opts = { ...opts, id: opts.id || newId() };
    const c = await getConv(convRef);
    try { return await sendTo(c, opts); }
    catch (e) {
      // plaintext refused: encryption was enabled meanwhile → refresh and send encrypted (same client id, idempotent)
      if (e && e.status === 400 && !c.e2ee) { const fresh = await getConv(c.id, { refresh: true }); if (fresh.e2ee) return sendTo(fresh, opts); }
      throw e;
    }
  }
  async function sendTo(c, { text = "", kind, replyTo, file, meta = {}, id } = {}) {
    kind = kind || (file ? (/^audio\//.test(file.type) ? "voice" : "image") : "text");
    const body = { id: id || newId(), kind, ...(replyTo ? { replyTo } : {}) };
    const fileMeta = file ? { mime: file.type, size: file.size, ...meta } : { ...meta };
    if (c.e2ee) {
      const dev = await ready();
      const members = c.members || (await conversation(c.id)).conversation.members.map(m => m.user);
      const k = await keys(members);
      const devices = members.flatMap(u => (k[u] || []).map(d => ({ id: d.id, pub: d.pub })));
      if (!devices.some(d => d.id === dev.id)) devices.push({ id: dev.id, pub: dev.pub });
      const secret = { text, kind, meta: fileMeta };
      if (file) { const f = await encryptFile(file); const bl = await uploadBlob(c.id, f.data, { encrypted: true }); body.meta = { blob: bl.id }; secret.file = { fk: f.fk, fiv: f.fiv }; }
      body.enc = await seal(dev, devices, c.id, secret);
    } else {
      body.text = text;
      if (file) { const bl = await uploadBlob(c.id, file); body.meta = { ...fileMeta, blob: bl.id, mime: bl.mime }; }
      else if (Object.keys(meta).length) body.meta = meta;
    }
    const r = await api("POST", `/api/chat/conversations/${enc(c.id)}/messages`, body);
    return c.e2ee ? open(r.message, c) : r.message;
  }
  /** Decrypt an E2EE message in place (never throws; sets .error) */
  async function open(m, convRef) {
    if (!m || !m.enc || m.deleted) return m;
    const cid = (convRef && (convRef.id || convRef)) || m.conv;
    const out = { ...m, encrypted: true };
    try {
      const dev = await ready().catch(() => null);
      if (!dev) return { ...out, error: "no-device" };
      const pub = m.enc.from === dev.id ? dev.pub : await devicePub(m.enc.from);
      const p = await unseal(dev, pub, cid, m.enc);
      out.text = p.text || ""; out.kind = p.kind || m.kind; out.meta = { ...(p.meta || {}), ...(m.meta && m.meta.blob ? { blob: m.meta.blob } : {}) };
      if (p.file) out.file = p.file;
    } catch (e) { out.error = e.code === "not-for-device" ? "not-for-device" : "bad"; }
    if (m.reply && m.reply.enc) { try { const dev = await ready(); const pub = m.reply.enc.from === dev.id ? dev.pub : await devicePub(m.reply.enc.from); const p = await unseal(dev, pub, cid, m.reply.enc); out.reply = { ...m.reply, text: p.text || "", kind: p.kind }; } catch { out.reply = { ...m.reply, error: true }; } }
    return out;
  }
  /** URL to display an attachment: blob: URL for encrypted media (decrypted locally), else the member-only endpoint */
  async function attachmentUrl(m) {
    const blob = m.meta && m.meta.blob; if (!blob) return null;
    if (!m.file) return "/api/chat/blobs/" + blob;
    const r = await fetch("/api/chat/blobs/" + blob, { credentials: "same-origin" });
    if (!r.ok) throw new Error("blob " + r.status);
    return URL.createObjectURL(await decryptFile(await r.arrayBuffer(), m.file.fk, m.file.fiv, m.meta.mime));
  }
  const release = (url) => { if (url && url.startsWith("blob:")) URL.revokeObjectURL(url); };

  /* ---------- disappearing timers ---------- */
  function watchExpiry(list, onExpire) {
    const timers = [];
    for (const m of list) { const ms = remaining(m); if (ms === null) continue; timers.push(setTimeout(() => onExpire(m.id), Math.min(ms, 2 ** 31 - 1))); }
    return () => timers.forEach(clearTimeout);
  }

  /* ---------- wiring ---------- */
  // the key set of a peer changed: forget derived pair keys so the next message uses fresh keys
  on("keys", () => pairCache.clear());
  on("conv", (d) => convCache.delete(d.conv));
  if (typeof addEventListener === "function" && typeof document !== "undefined") {
    const start = () => { if (online() && meId() && signedIn()) connect(); };
    const restart = () => { T.fails = 0; T.tries = 0; start(); };
    setTimeout(start, 0);
    addEventListener("online", restart);
    addEventListener("mp:session", (e) => { if (e.detail === "in") restart(); else if (e.detail === "out") disconnect(); });
  }

  root.MPComms = {
    version: "2.7",
    connect, disconnect, transport: () => T.mode, on, typing,
    conversations, conversation, messages, openDM, createGroup, addMembers, removeMember, leave, update, setTimer, markRead, react, deleteForEveryone, uploadBlob,
    send, open, attachmentUrl, release,
    e2ee: { ready, enable, canEncrypt, keys, devices: () => api("GET", "/api/e2ee/devices").then(r => r.devices), revoke: (id) => api("DELETE", "/api/e2ee/devices/" + enc(id)), thisDevice: () => (device ? { id: device.id, name: device.name, pub: device.pub } : null),
      safetyNumber, format: formatSafety, verification, verify, unverify: (peer) => api("DELETE", "/api/e2ee/verify/" + enc(peer)) },
    TTLS, ttlLabel, remaining, watchExpiry, group, REACTIONS,
    lib: { getConv, _cache: convCache, _bridge: { appRemote, appDB, meId, online }, b64, unb64, safetyDigits, dayKey, dayLabel, seal, unseal, encryptFile, decryptFile, safetyFromKeys, userDigits, pairKey, formatSafety, _dispatch: dispatch }
  };
})(typeof window !== "undefined" ? window : globalThis);
