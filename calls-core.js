/* =====================================================================
 * مجتمع بلس — v2.7 calls engine (Track 6, phase 30). No screens: this is the headless engine the call
 * UI (calls-ui.js) builds on. Exposed as window.MPCalls; loaded as the "calls" chunk.
 *  • signalling client: listens to the realtime stream ("call", "call_signal", "call_quality"; de-duplicated
 *    on the server's `_e` sequence so SSE + WebSocket can both deliver), sends via POST /api/calls/…
 *  • WebRTC mesh up to 8: one RTCPeerConnection per peer, perfect negotiation, the later joiner offers;
 *    every connection carries one audio + one video transceiver from the start, so mute / camera /
 *    screen share are replaceTrack() calls and never renegotiate
 *  • media: mic, camera (front/back), screen share (getDisplayMedia, contentHint "detail")
 *  • network-adaptive quality: getStats() every 2 s → rtt / loss / available bitrate → level
 *    high|medium|low|audio with hysteresis (down at once, up after 3 good samples) → encoder
 *    maxBitrate, scaleResolutionDownBy, maxFramerate (and video paused at "audio"); budget shared across
 *    mesh peers; heartbeat + level reported to the server every ~6 s
 *  • client state machine: idle → outgoing|incoming → connecting → active ⇄ reconnecting → ended
 * In Node (unit tests) the pure policy is exported instead: require("./calls-core.js").
 * ===================================================================== */
(function CallsCore() {
  /* ------------------------------------------------------------------ pure policy (unit-testable) */
  const Lib = (() => {
    const FLOW = { idle: ["outgoing", "incoming", "connecting"], outgoing: ["connecting", "ended"], incoming: ["connecting", "ended"], connecting: ["active", "ended"], active: ["reconnecting", "ended"], reconnecting: ["active", "ended"], ended: ["idle", "outgoing", "incoming"] };
    const canTransition = (from, to) => (FLOW[from] || []).includes(to);
    const LEVELS = ["high", "medium", "low", "audio"];
    const UP_AFTER = 3;
    /* mesh: the later joiner offers (ties broken by id) so exactly one side of every pair starts */
    const shouldOffer = (me, peer) => (me.joinedAt || "") > (peer.joinedAt || "") || ((me.joinedAt || "") === (peer.joinedAt || "") && me.id > peer.id);
    /* encoder settings for one outgoing video stream; `peers` = mesh connections sharing the uplink */
    const CAMERA = { high: [1500, 1, 30], medium: [600, 2, 24], low: [200, 4, 15] };
    const SCREEN = { high: [2500, 1, 15], medium: [1200, 1, 8], low: [500, 1.5, 5], audio: [250, 2, 3] };
    function encodingFor(level, { peers = 1, screen = false } = {}) {
      const n = Math.max(1, peers);
      if (!screen && level === "audio") return { active: false, maxBitrate: 0, scaleResolutionDownBy: 4, maxFramerate: 10 };
      let lv = level;
      if (!screen && n >= 4 && lv === "high") lv = "medium"; // a 4+ person mesh never sends 720p to everyone
      const [kbps, scale, fps] = (screen ? SCREEN : CAMERA)[lv] || CAMERA.medium;
      const share = n === 1 ? 1 : n === 2 ? 0.75 : 1.5 / n; // uplink split across connections
      return { active: true, maxBitrate: Math.max(screen ? 200e3 : 100e3, Math.round(kbps * 1000 * share)), scaleResolutionDownBy: scale, maxFramerate: fps };
    }
    const audioBitrate = (level) => (level === "audio" || level === "low" ? 16000 : 32000);
    /* sample → the level this connection can sustain right now */
    function classify({ rtt = null, loss = null, kbps = null, limited = null } = {}) {
      if ((loss ?? 0) > 0.15 || (rtt ?? 0) > 1.0 || (kbps != null && kbps < 120)) return "audio";
      if ((loss ?? 0) > 0.06 || (rtt ?? 0) > 0.45 || (kbps != null && kbps < 400)) return "low";
      if ((loss ?? 0) > 0.02 || (rtt ?? 0) > 0.25 || (kbps != null && kbps < 1000) || limited === "bandwidth" || limited === "cpu") return "medium";
      return "high";
    }
    /* hysteresis: degrade immediately to the target, recover one step after UP_AFTER good samples */
    function adapt(prev, sample) {
      const cur = prev?.level || "high", target = classify(sample), ci = LEVELS.indexOf(cur), ti = LEVELS.indexOf(target);
      if (ti > ci) return { level: target, good: 0, changed: true };
      if (ti < ci) { const good = (prev?.good || 0) + 1; if (good >= UP_AFTER) return { level: LEVELS[ci - 1], good: 0, changed: true }; return { level: cur, good, changed: false }; }
      return { level: cur, good: 0, changed: false };
    }
    const worst = (levels) => levels.filter(Boolean).reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), "high");
    /* RTCStatsReport (as an array of stat objects) → sample; `prev` carries counters for loss deltas */
    function sample(stats, prev = {}) {
      let rtt = null, kbps = null, limited = null, remoteLoss = null, audioLevel = 0, lost = 0, recv = 0, sentBytes = 0, ts = 0;
      const pairs = stats.filter(s => s.type === "candidate-pair" && (s.nominated || s.selected) && s.state === "succeeded");
      const pair = pairs.find(p => p.currentRoundTripTime != null) || pairs[0];
      if (pair) { if (pair.currentRoundTripTime != null) rtt = pair.currentRoundTripTime; if (pair.availableOutgoingBitrate != null) kbps = pair.availableOutgoingBitrate / 1000; }
      for (const s of stats) {
        if (s.type === "remote-inbound-rtp") {
          if (s.fractionLost != null) remoteLoss = Math.max(remoteLoss ?? 0, s.fractionLost);
          if (rtt == null && s.roundTripTime != null) rtt = s.roundTripTime;
        } else if (s.type === "outbound-rtp" && s.kind === "video") {
          if (s.qualityLimitationReason && s.qualityLimitationReason !== "none") limited = s.qualityLimitationReason;
          sentBytes += s.bytesSent || 0; ts = Math.max(ts, s.timestamp || 0);
        } else if (s.type === "inbound-rtp") {
          lost += s.packetsLost || 0; recv += s.packetsReceived || 0;
          if (s.kind === "audio" && s.audioLevel != null) audioLevel = Math.max(audioLevel, s.audioLevel);
        }
      }
      const dLost = Math.max(0, lost - (prev.lost || 0)), dRecv = Math.max(0, recv - (prev.recv || 0));
      const inLoss = dLost + dRecv > 0 ? dLost / (dLost + dRecv) : 0;
      const sendKbps = prev.ts && ts > prev.ts ? Math.round(((sentBytes - (prev.sentBytes || 0)) * 8) / (ts - prev.ts)) : null;
      const loss = remoteLoss != null ? Math.max(remoteLoss, inLoss) : inLoss;
      return { rtt, loss: Math.round(loss * 1000) / 1000, kbps: kbps != null ? Math.round(kbps) : null, limited, audioLevel, sendKbps, counters: { lost, recv, sentBytes, ts } };
    }
    return { FLOW, canTransition, LEVELS, UP_AFTER, shouldOffer, encodingFor, audioBitrate, classify, adapt, worst, sample, MAX_PARTICIPANTS: 8 };
  })();

  if (typeof window === "undefined") { if (typeof module === "object" && module.exports) module.exports = Lib; return; }
  if (window.MPCalls) return;

  /* ------------------------------------------------------------------ engine */
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const has = (k) => typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices[k] === "function";
  const supports = {
    webrtc: typeof RTCPeerConnection === "function" && has("getUserMedia"),
    screen: has("getDisplayMedia"),
    videoPip: typeof document !== "undefined" && !!document.pictureInPictureEnabled,
    docPip: "documentPictureInPicture" in window,
    sinkId: typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype
  };
  const S = {
    state: "idle", call: null, here: false, local: null, cameraTrack: null, screenTrack: null,
    mic: true, camera: false, sharing: false, facing: "user", ice: null, iceExp: 0,
    peers: new Map(), level: "high", speaker: null, ticks: 0, loop: 0, seen: [], endReason: null
  };
  const subs = new Map();
  function on(type, fn) { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); return () => off(type, fn); }
  function off(type, fn) { subs.get(type)?.delete(fn); }
  function emit(type, detail) {
    for (const fn of [...(subs.get(type) || []), ...(subs.get("*") || [])]) { try { fn(detail, type); } catch (e) { console.error("[calls]", type, e); } }
    try { window.dispatchEvent(new CustomEvent("mpcalls:" + type, { detail })); } catch { }
  }
  const fail = (code, message, extra) => emit("error", { code, message, ...extra });
  function setState(to, extra = {}) {
    const from = S.state; if (from === to) return true;
    if (!Lib.canTransition(from, to)) return false;
    S.state = to; emit("state", { state: to, prev: from, call: S.call, ...extra }); return true;
  }
  const meP = () => S.call?.participants.find(p => p.id === DB.me) || null;
  const callId = () => S.call?.call.id || null;

  /* ---------- ICE ---------- */
  async function ice() {
    if (S.ice && Date.now() < S.iceExp) return S.ice;
    S.ice = await api("GET", "/api/calls/ice");
    S.iceExp = S.ice.expiresAt ? Date.parse(S.ice.expiresAt) - 5 * 60e3 : Date.now() + 10 * 60e3;
    return S.ice;
  }

  /* ---------- local media ---------- */
  const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const videoC = () => ({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: S.facing });
  async function ensureLocal(camera) {
    if (!S.local) S.local = new MediaStream();
    if (!S.local.getAudioTracks().length) {
      try { const st = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: camera ? videoC() : false }); st.getTracks().forEach(t => S.local.addTrack(t)); S.cameraTrack = st.getVideoTracks()[0] || null; }
      catch (e) {
        if (camera) { try { const st = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }); st.getTracks().forEach(t => S.local.addTrack(t)); fail("camera", "تعذر تشغيل الكاميرا، تستمر المكالمة بالصوت"); } catch (e2) { fail("mic", "لا يمكن الوصول إلى الميكروفون", { name: e2.name }); } }
        else fail("mic", "لا يمكن الوصول إلى الميكروفون", { name: e.name });
      }
    } else if (camera && !S.cameraTrack) await cameraOn();
    S.camera = !!S.cameraTrack;
    S.local.getAudioTracks().forEach(t => (t.enabled = S.mic));
    if (S.cameraTrack) S.cameraTrack.contentHint = "motion";
    emit("local", { stream: S.local, mic: S.mic, camera: S.camera, screen: S.sharing });
    return S.local;
  }
  async function cameraOn() {
    const st = await navigator.mediaDevices.getUserMedia({ video: videoC() });
    const t = st.getVideoTracks()[0]; if (S.cameraTrack) { S.local.removeTrack(S.cameraTrack); S.cameraTrack.stop(); }
    S.cameraTrack = t; t.contentHint = "motion"; S.local.addTrack(t); return t;
  }
  const outgoingVideo = () => (S.sharing ? S.screenTrack : S.cameraTrack) || null;
  async function pushVideo() {
    const t = outgoingVideo();
    for (const p of S.peers.values()) if (p.videoT) { await p.videoT.sender.replaceTrack(t).catch(() => { }); applyEncoding(p).catch(() => { }); }
  }
  function stopLocal() {
    S.local?.getTracks().forEach(t => t.stop()); S.screenTrack?.stop();
    S.local = null; S.cameraTrack = null; S.screenTrack = null; S.sharing = false; S.camera = false; S.mic = true;
  }
  const reportMedia = () => callId() && S.here ? api("POST", `/api/calls/${callId()}/media`, { mic: S.mic, camera: S.camera, screen: S.sharing }).then(onCall).catch(() => { }) : Promise.resolve();

  /* ---------- peers ---------- */
  function peerFor(uid, sid) {
    let p = S.peers.get(uid);
    if (p && sid && p.sid && p.sid !== sid) { closePeer(uid, true); p = null; } // the peer re-joined: new session
    if (p) return p;
    const me = meP(), them = S.call?.participants.find(x => x.id === uid) || { id: uid };
    const pc = new RTCPeerConnection({ iceServers: S.ice?.iceServers || [], iceTransportPolicy: S.ice?.iceTransportPolicy || "all", bundlePolicy: "max-bundle" });
    p = { id: uid, sid: sid || them.joinedAt || null, pc, stream: new MediaStream(), polite: !(me && Lib.shouldOffer(me, them)), makingOffer: false, ignoreOffer: false, audioT: null, videoT: null,
      iceOut: [], iceTimer: 0, pendingIce: [], chain: Promise.resolve(), inChain: Promise.resolve(), adapt: { level: "high", good: 0 }, counters: {}, quality: null, connection: "new", discTimer: 0 };
    S.peers.set(uid, p);
    pc.onicecandidate = (e) => { if (!e.candidate) return; p.iceOut.push(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); if (!p.iceTimer) p.iceTimer = setTimeout(() => { p.iceTimer = 0; const ice = p.iceOut.splice(0); if (ice.length) signal(p, { ice }); }, 120); };
    pc.ontrack = (e) => {
      const t = e.track; if (!p.stream.getTracks().includes(t)) p.stream.addTrack(t);
      t.onunmute = t.onmute = t.onended = () => emit("peer", peerInfo(p));
      emit("peer", peerInfo(p));
    };
    pc.onnegotiationneeded = async () => {
      try { p.makingOffer = true; await pc.setLocalDescription(); signal(p, { sdp: pc.localDescription }); }
      catch (e) { console.warn("[calls] negotiation", e); } finally { p.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      p.connection = pc.connectionState; emit("peer", peerInfo(p)); clearTimeout(p.discTimer);
      if (pc.connectionState === "failed" && !p.polite) pc.restartIce?.();
      if (pc.connectionState === "disconnected" && !p.polite) p.discTimer = setTimeout(() => pc.connectionState === "disconnected" && pc.restartIce?.(), 4000);
      if (pc.connectionState === "connected") applyEncoding(p).catch(() => { });
      overall();
    };
    return p;
  }
  const peerInfo = (p) => ({ id: p.id, stream: p.stream, connection: p.connection, level: p.adapt.level, quality: p.quality, audio: p.stream.getAudioTracks().some(t => t.readyState === "live"), video: p.stream.getVideoTracks().some(t => t.readyState === "live" && !t.muted) });
  /* attach our tracks to the connection's transceivers (offerer adds them, answerer adopts the offered ones) */
  function attach(p, offerer) {
    const audio = S.local?.getAudioTracks()[0] || null, video = outgoingVideo(), streams = S.local ? [S.local] : [];
    if (offerer) {
      p.audioT = p.pc.addTransceiver(audio || "audio", { direction: "sendrecv", streams });
      p.videoT = p.pc.addTransceiver(video || "video", { direction: "sendrecv", streams });
      if (!video) p.videoT.sender.replaceTrack(null).catch(() => { });
    } else {
      for (const t of p.pc.getTransceivers()) {
        const kind = t.receiver.track?.kind; if (!kind || t.stopped) continue;
        if (kind === "audio" && !p.audioT) { p.audioT = t; t.direction = "sendrecv"; t.sender.replaceTrack(audio).catch(() => { }); if (S.local && t.sender.setStreams) t.sender.setStreams(S.local); }
        if (kind === "video" && !p.videoT) { p.videoT = t; t.direction = "sendrecv"; t.sender.replaceTrack(video).catch(() => { }); if (S.local && t.sender.setStreams) t.sender.setStreams(S.local); }
      }
    }
  }
  function signal(p, data) {
    const cid = callId(); if (!cid) return;
    const body = { to: p.id, data: { ...data, sid: meP()?.joinedAt || null } };
    p.chain = p.chain.then(() => api("POST", `/api/calls/${cid}/signal`, body)).catch(() => { }); // ordered per peer
  }
  async function onSignal(m) {
    if (!S.call || m.call !== callId() || !S.here) return;
    const p = peerFor(m.from, m.data?.sid);
    p.inChain = p.inChain.then(() => handleSignal(p, m.data)).catch((e) => console.warn("[calls] signal", e));
  }
  async function handleSignal(p, data) {
    const pc = p.pc;
    if (data.sdp) {
      const offer = data.sdp.type === "offer";
      const collision = offer && (p.makingOffer || pc.signalingState !== "stable");
      p.ignoreOffer = !p.polite && collision; if (p.ignoreOffer) return;
      await pc.setRemoteDescription(data.sdp);
      if (offer) {
        if (!p.audioT && !p.videoT) attach(p, false);
        await pc.setLocalDescription(); signal(p, { sdp: pc.localDescription });
      }
      for (const c of p.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => { });
    }
    if (data.ice) for (const c of [].concat(data.ice)) {
      if (!pc.remoteDescription) { p.pendingIce.push(c); continue; }
      try { await pc.addIceCandidate(c); } catch (e) { if (!p.ignoreOffer) console.warn("[calls] ice", e); }
    }
  }
  function closePeer(uid, silent) {
    const p = S.peers.get(uid); if (!p) return;
    clearTimeout(p.iceTimer); clearTimeout(p.discTimer); try { p.pc.close(); } catch { }
    S.peers.delete(uid); if (!silent) emit("peer-left", { id: uid });
  }
  function overall() {
    if (!["connecting", "active", "reconnecting"].includes(S.state)) return;
    const ps = [...S.peers.values()], up = ps.some(p => p.connection === "connected");
    if (up && S.state !== "active") setState("active");
    else if (!up && S.state === "active" && ps.length && ps.every(p => ["disconnected", "failed"].includes(p.connection))) setState("reconnecting");
  }

  /* ---------- adaptive quality ---------- */
  async function applyEncoding(p) {
    const n = Math.max(1, S.peers.size);
    if (p.videoT?.sender?.track) {
      const enc = Lib.encodingFor(p.adapt.level, { peers: n, screen: S.sharing }), s = p.videoT.sender, prm = s.getParameters();
      if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
      Object.assign(prm.encodings[0], { active: enc.active, maxFramerate: enc.maxFramerate, scaleResolutionDownBy: enc.scaleResolutionDownBy, ...(enc.maxBitrate ? { maxBitrate: enc.maxBitrate } : {}) });
      prm.degradationPreference = S.sharing ? "maintain-resolution" : "balanced";
      await s.setParameters(prm).catch(() => { });
    }
    if (p.audioT?.sender?.track) { const s = p.audioT.sender, prm = s.getParameters(); if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}]; prm.encodings[0].maxBitrate = Lib.audioBitrate(p.adapt.level); await s.setParameters(prm).catch(() => { }); }
  }
  async function tick() {
    if (!S.here || !["connecting", "active", "reconnecting"].includes(S.state)) return;
    S.ticks++;
    let loud = { id: null, lvl: 0.02 }; const self = { rtt: 0, loss: 0, kbps: null };
    for (const p of S.peers.values()) {
      if (p.pc.connectionState !== "connected") continue;
      let stats; try { stats = []; (await p.pc.getStats()).forEach(s => stats.push(s)); } catch { continue; }
      const smp = Lib.sample(stats, p.counters); p.counters = smp.counters;
      const next = Lib.adapt(p.adapt, smp); const changed = next.changed; p.adapt = { level: next.level, good: next.good };
      p.quality = { rtt: smp.rtt, loss: smp.loss, kbps: smp.kbps, sendKbps: smp.sendKbps, limited: smp.limited };
      if (changed) { await applyEncoding(p); emit("quality", { id: p.id, level: p.adapt.level, ...p.quality, videoPaused: p.adapt.level === "audio" && !S.sharing && !!S.cameraTrack, self: false }); }
      if (smp.audioLevel > loud.lvl) loud = { id: p.id, lvl: smp.audioLevel };
      self.rtt = Math.max(self.rtt, smp.rtt || 0); self.loss = Math.max(self.loss, smp.loss || 0); if (smp.kbps != null) self.kbps = self.kbps == null ? smp.kbps : Math.min(self.kbps, smp.kbps);
    }
    const lvl = Lib.worst([...S.peers.values()].map(p => p.adapt.level));
    if (lvl !== S.level) { S.level = lvl; emit("quality", { id: DB.me, level: lvl, ...self, self: true }); }
    if (loud.id !== S.speaker) { S.speaker = loud.id; emit("speaker", { id: loud.id }); }
    if (S.ticks % 3 === 1) { // heartbeat + level report (~6 s); doubles as a state check if a push was missed
      const r = await api("POST", `/api/calls/${callId()}/stats`, { level: S.level, ...self }).catch(() => null);
      if (r && (r.callStatus === "ended" || r.state !== "joined")) refreshCall();
    }
  }
  const startLoop = () => { if (!S.loop) S.loop = setInterval(() => tick().catch(() => { }), 2000); };
  const stopLoop = () => { clearInterval(S.loop); S.loop = 0; };

  /* ---------- server state → engine ---------- */
  async function refreshCall() { const id = callId(); if (!id) return; try { onCall(await api("GET", `/api/calls/${id}`)); } catch { } }
  function onCall(s) {
    if (!s?.call) return s;
    const mine = s.participants.find(p => p.id === DB.me); if (!mine) return s;
    if (S.call && s.call.id !== S.call.call.id) {
      // another call while we're busy: the server marks us busy; surface it so the UI can show "call waiting"
      if (["outgoing", "incoming", "connecting", "active", "reconnecting"].includes(S.state)) { if (mine.state === "ringing" && s.call.status !== "ended") emit("waiting", { call: s }); return s; }
    }
    if (!S.call || s.call.id !== S.call.call.id) {
      if (mine.state !== "ringing" || s.call.status === "ended") return s;
      if (S.state === "ended") setState("idle");
      S.call = s; S.here = false; S.endReason = null;
      setState("incoming"); emit("incoming", { call: s }); emit("call", { call: s });
      return s;
    }
    S.call = s; emit("call", { call: s });
    if (!busyNow()) return s; // late update for a call this device already finished
    if (s.call.status === "ended") { finish(s.call.endReason || "completed"); return s; }
    if (S.state === "incoming" && mine.state === "joined" && !S.here) { finish("elsewhere"); return s; } // answered on another device
    if (S.state === "incoming" && mine.state !== "ringing") { finish(mine.state === "declined" ? "declined" : "missed"); return s; }
    if (S.here && mine.state !== "joined") { finish("left"); return s; }
    if (!S.here) return s;
    if (S.state === "outgoing" && s.call.status === "active") setState("connecting");
    const joined = s.participants.filter(p => p.state === "joined" && p.id !== DB.me), ids = new Set(joined.map(p => p.id));
    for (const uid of [...S.peers.keys()]) if (!ids.has(uid)) closePeer(uid);
    for (const p of joined) {
      const ex = S.peers.get(p.id);
      if (ex && ex.sid && p.joinedAt && ex.sid !== p.joinedAt) closePeer(p.id, true);
      if (!S.peers.has(p.id) && Lib.shouldOffer(mine, p)) { const peer = peerFor(p.id, p.joinedAt); attach(peer, true); }
    }
    overall();
    return s;
  }
  function finish(reason) {
    stopLoop();
    for (const uid of [...S.peers.keys()]) closePeer(uid, true);
    stopLocal(); S.here = false; S.speaker = null; S.level = "high"; S.endReason = reason;
    if (busyNow()) setState("ended", { reason });
    emit("ended", { reason, call: S.call });
  }

  /* ---------- public actions ---------- */
  const busyNow = () => ["outgoing", "incoming", "connecting", "active", "reconnecting"].includes(S.state);
  /** @param {{ to?: string, users?: string[], conv?: string, kind?: "voice"|"video" }} [o] */
  async function start({ to, users, conv, kind = "voice" } = {}) {
    if (!online()) throw Object.assign(new Error("المكالمات تتطلب الاتصال بالخادم"), { code: "offline" });
    if (!supports.webrtc) throw Object.assign(new Error("المتصفح لا يدعم المكالمات"), { code: "unsupported" });
    if (busyNow()) throw Object.assign(new Error("أنت في مكالمة بالفعل"), { code: "busy" });
    if (S.state === "ended") setState("idle");
    await ice(); await ensureLocal(kind === "video");
    let s; try { s = await api("POST", "/api/calls", { to, users, conv, kind }); } catch (e) { stopLocal(); emit("local", { stream: null }); throw e; }
    S.call = s; S.here = true; S.endReason = null; setState("outgoing"); emit("call", { call: s });
    if (s.call.status === "ended") { finish(s.call.endReason || "missed"); return s; }
    startLoop(); onCall(s); reportMediaIfChanged(kind); return s;
  }
  function reportMediaIfChanged(kind) { if ((kind === "video") !== S.camera || !S.mic) reportMedia(); }
  /** @param {{ camera?: boolean }} [o] */
  async function accept({ camera } = {}) {
    if (S.state !== "incoming") throw new Error("لا توجد مكالمة واردة");
    const c = S.call.call, cam = camera === undefined ? c.kind === "video" : !!camera;
    await ice(); await ensureLocal(cam);
    S.here = true; setState("connecting");
    try { onCall(await api("POST", `/api/calls/${c.id}/accept`, { camera: S.camera })); startLoop(); }
    catch (e) { S.here = false; finish("failed"); throw e; }
    return S.call;
  }
  async function decline() {
    const id = callId(); if (!id || S.state !== "incoming") return;
    finish("declined"); await api("POST", `/api/calls/${id}/decline`).catch(() => { });
  }
  async function hangup() {
    const id = callId(); if (!id) return;
    const wasIncoming = S.state === "incoming";
    finish(wasIncoming ? "declined" : "hangup");
    await api("POST", `/api/calls/${id}/${wasIncoming ? "decline" : "hangup"}`).catch(() => { });
  }
  /* rejoin a group call still in progress (after leaving, declining or missing it) */
  /** @param {string} id @param {{ camera?: boolean }} [o] */
  async function join(id, { camera = false } = {}) {
    if (busyNow()) throw Object.assign(new Error("أنت في مكالمة بالفعل"), { code: "busy" });
    if (S.state === "ended") setState("idle");
    await ice(); await ensureLocal(camera);
    const s = await api("POST", `/api/calls/${id}/join`, { camera: S.camera });
    S.call = s; S.here = true; S.endReason = null; setState("connecting"); startLoop(); onCall(s); return s;
  }
  async function invite(users) {
    const id = callId(); if (!id || !S.here) throw new Error("لست في مكالمة");
    return onCall(await api("POST", `/api/calls/${id}/invite`, { users: [].concat(users) }));
  }
  async function setMic(onOff) { S.mic = !!onOff; S.local?.getAudioTracks().forEach(t => (t.enabled = S.mic)); emit("media", media()); await reportMedia(); }
  async function setCamera(onOff) {
    if (onOff && !S.cameraTrack) { try { if (!S.local) S.local = new MediaStream(); await cameraOn(); } catch (e) { fail("camera", "تعذر تشغيل الكاميرا", { name: e.name }); return; } }
    if (!onOff && S.cameraTrack) { S.local?.removeTrack(S.cameraTrack); S.cameraTrack.stop(); S.cameraTrack = null; }
    S.camera = !!S.cameraTrack; await pushVideo(); emit("local", { stream: S.local, ...media() }); emit("media", media()); await reportMedia();
  }
  async function switchCamera() {
    if (!S.cameraTrack) return; S.facing = S.facing === "user" ? "environment" : "user";
    try { await cameraOn(); await pushVideo(); emit("local", { stream: S.local, ...media() }); } catch (e) { fail("camera", "تعذر تبديل الكاميرا", { name: e.name }); }
  }
  async function startScreen() {
    if (!supports.screen) throw Object.assign(new Error("مشاركة الشاشة غير مدعومة في هذا المتصفح"), { code: "unsupported" });
    if (!S.here) throw new Error("لست في مكالمة");
    let st; try { st = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false }); } catch (e) { if (e.name !== "NotAllowedError") fail("screen", "تعذرت مشاركة الشاشة", { name: e.name }); return false; }
    S.screenTrack = st.getVideoTracks()[0]; S.screenTrack.contentHint = "detail"; S.screenTrack.onended = () => stopScreen();
    S.sharing = true; await pushVideo(); emit("screen", { on: true, track: S.screenTrack }); emit("media", media()); await reportMedia(); return true;
  }
  async function stopScreen() {
    if (!S.sharing) return; S.screenTrack?.stop(); S.screenTrack = null; S.sharing = false;
    await pushVideo(); emit("screen", { on: false }); emit("media", media()); await reportMedia();
  }
  const media = () => ({ mic: S.mic, camera: S.camera, screen: S.sharing });
  async function history(q = {}) { const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null)).toString(); return api("GET", "/api/calls" + (qs ? "?" + qs : "")); }

  /* ---------- realtime wiring ---------- */
  function handle(type, data) {
    if (data && data._e != null) { const k = type + ":" + data._e; if (S.seen.includes(k)) return; S.seen.push(k); if (S.seen.length > 300) S.seen.shift(); }
    if (type === "call") onCall(data);
    else if (type === "call_signal") onSignal(data);
    else if (type === "call_quality" && data.call === callId()) { const p = S.peers.get(data.user); emit("remote-quality", { id: data.user, level: data.level, rtt: data.rtt, loss: data.loss, peer: p ? peerInfo(p) : null }); }
  }
  function attachStream(es) {
    if (!es || es.__mpcalls) return; es.__mpcalls = true;
    for (const t of ["call", "call_signal", "call_quality"]) es.addEventListener(t, (e) => { try { handle(t, JSON.parse(e.data)); } catch { } });
  }
  async function resume() {
    if (!online() || typeof DB === "undefined" || !DB.me || S.call) return;
    try { const r = await api("GET", "/api/calls/active"); if (r.active) onCall(r.active); } catch { }
  }
  if (typeof connectStream === "function") {
    const _cs = connectStream;
    connectStream = function () { const out = _cs.apply(this, arguments); try { attachStream(Remote.es); resume(); } catch { } return out; };
  }
  if (typeof Remote !== "undefined" && Remote.es) { attachStream(Remote.es); resume(); }
  // leaving the page ends our leg of the call (a ringing call keeps ringing on the user's other devices)
  window.addEventListener("pagehide", () => { const id = callId(); if (id && S.here && busyNow() && navigator.sendBeacon) navigator.sendBeacon(`/api/calls/${id}/hangup`); });

  window.MPCalls = {
    version: "__APP_VERSION__", lib: Lib, supports, MAX_PARTICIPANTS: Lib.MAX_PARTICIPANTS,
    on, off,
    get state() { return S.state; }, get call() { return S.call; }, get endReason() { return S.endReason; },
    get local() { return S.local; }, get screenTrack() { return S.screenTrack; }, get media() { return media(); },
    get level() { return S.level; }, get speaker() { return S.speaker; },
    peers: () => [...S.peers.values()].map(peerInfo),
    stream: (uid) => (uid === DB.me ? S.local : S.peers.get(uid)?.stream || null),
    start, accept, decline, hangup, join, invite,
    setMic, setCamera, switchCamera, startScreen, stopScreen,
    history, markSeen: () => api("POST", "/api/calls/seen"), remove: (id) => api("DELETE", `/api/calls/${id}`),
    reset() { if (S.state === "ended") { setState("idle"); S.call = null; } },
    handle, attachStream, resume, refresh: refreshCall,
    debug: () => ({ state: S.state, call: callId(), level: S.level, peers: [...S.peers.values()].map(p => ({ id: p.id, connection: p.connection, signaling: p.pc.signalingState, level: p.adapt.level, polite: p.polite, quality: p.quality })) })
  };
  emit("ready", { supports });
})();
