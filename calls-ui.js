/* =====================================================================
 * مجتمع بلس — v2.7 calls UI (Track 6, phase 30), loaded as the lazy "calls" chunk.
 * Presentation only: the WebRTC engine, signalling and TURN live in calls-core.js (window.MPCalls).
 * • Voice / video call buttons in chat and profile headers (and a public hook for the chat UI:
 *   MPCallsUI.buttons(target) / <span data-call-slot data-call-to="…"> / MPCallsUI.start(target, {video})).
 * • Incoming call sheet (accept · accept with voice only · decline) with a gentle ring + vibration.
 * • Full-screen call: 1:1 (remote full-bleed, draggable self view) or a grid of up to 8; mute, camera,
 *   switch camera, screen share, hang up; call timer; network quality indicator.
 * • Floating mini window while browsing the app (draggable, snaps to a corner, tap to return), plus
 *   Document Picture-in-Picture where supported (video element PiP as the fallback).
 * Engine: window.MPCalls (calls-core.js, docs/COMMUNICATION.md §30). The view model is derived from
 *   MPCalls.state / .call / .media / .peers() / .local / .speaker / .level on every engine event
 *   ("incoming", "state", "call", "local", "peer", "peer-left", "media", "screen", "speaker", "quality",
 *   "remote-quality", "ended", "waiting", "error"); actions call start/accept/decline/hangup/setMic/
 *   setCamera/switchCamera/startScreen/stopScreen. Chat UIs add buttons with MPCallsUI.buttons(target),
 *   a <span data-call-slot data-call-to="conv:<id>|<userId>"> placeholder, or MPCallsUI.start(target, {video}).
 * ===================================================================== */
(function CallsUI() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const h = (s) => esc(String(s ?? ""));
  const E = () => window.MPCalls || null;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const say = (msg) => { const r = document.getElementById("cl-say"); if (r) { r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); } };
  const MAX = 8;

  const ICONS = {
    phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
    phoneOff: '<path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272"/><path d="M22 2 2 22"/><path d="M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    videoOff: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>',
    screen: '<path d="m9 10 3-3 3 3"/><path d="M12 13V7"/><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M12 17v4"/><path d="M8 21h8"/>',
    flip: '<path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/><path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/><circle cx="12" cy="12" r="3"/><path d="m18 22-3-3 3-3"/><path d="m6 2 3 3-3 3"/>',
    minimize: '<path d="m6 9 6 6 6-6"/>',
    pip: '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
    maximize: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>'
  };
  (function sprite() { const s = document.querySelector("svg[aria-hidden] symbol")?.parentNode; if (!s) return; s.insertAdjacentHTML("beforeend", Object.entries(ICONS).filter(([k]) => !document.getElementById("i-" + k)).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("")); })();

  /* ---------- styles ---------- */
  const CSS = `
.cl-hb{width:44px;height:44px;padding:0!important;display:inline-grid!important;place-items:center;border-radius:14px!important;flex:none}.cl-hb .ic{width:20px;height:20px}
.cl-hbs{display:inline-flex;gap:6px;margin-inline:6px;vertical-align:middle}
.cl-full{position:fixed;inset:0;z-index:95;background:radial-gradient(120% 80% at 50% 0%,#2a1d55 0%,#0d0a18 60%,#07060c 100%);color:var(--white);display:flex;flex-direction:column;
  padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);opacity:0;transform:scale(.985);transition:opacity .3s var(--ease),transform .35s var(--ease)}
.cl-full.on{opacity:1;transform:none}body.cl-on{overflow:hidden}
.cl-top{position:relative;z-index:3;display:flex;align-items:center;gap:8px;padding:10px 12px;transition:opacity .3s}
.cl-top .ttl{flex:1;min-width:0;text-align:center}.cl-top .ttl b{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cl-top .ttl small{font-size:12.5px;opacity:.78;font-variant-numeric:tabular-nums}
.cl-ib{width:44px;height:44px;border-radius:50%;border:0;background:#ffffff1f;color:var(--white);display:grid;place-items:center;cursor:pointer;flex:none;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.cl-ib:hover{background:#ffffff33}.cl-ib .ic{width:21px;height:21px}
.cl-q{display:inline-flex;align-items:flex-end;gap:2px;height:16px;padding:0 4px}.cl-q i{width:4px;border-radius:2px;background:#ffffff40}.cl-q i:nth-child(1){height:6px}.cl-q i:nth-child(2){height:10px}.cl-q i:nth-child(3){height:15px}
.cl-q[data-q=good] i{background:#3ddc97}.cl-q[data-q=fair] i:nth-child(-n+2){background:#ffc145}.cl-q[data-q=poor] i:nth-child(1){background:#ff5d6c}
.cl-qw{display:flex;align-items:center;gap:4px;font-size:11.5px;padding:0 10px;height:30px;border-radius:999px;background:#ffffff1a}
.cl-stage{position:absolute;inset:0;z-index:1}
.cl-tile{position:relative;overflow:hidden;background:#1b1530;border-radius:22px;display:grid;place-items:center;min-height:0;min-width:0;box-shadow:0 0 0 0 #3ddc97;transition:box-shadow .2s}
.cl-tile.spk{box-shadow:0 0 0 3px #3ddc97}.cl-tile.rg .ph{opacity:.55}.cl-tile video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:transparent}.cl-tile video.mirror{transform:scaleX(-1)}
.cl-tile .ph{display:flex;flex-direction:column;align-items:center;gap:8px}.cl-tile .ph .a{width:76px;height:76px;border-radius:26px;display:grid;place-items:center;font-size:30px;font-weight:800;overflow:hidden}.cl-tile .ph .a img{width:100%;height:100%;object-fit:cover}
.cl-tile .nm{position:absolute;bottom:8px;inset-inline-start:8px;max-width:calc(100% - 16px);display:inline-flex;gap:5px;align-items:center;font-size:12.5px;font-weight:650;padding:4px 10px;border-radius:999px;background:#0008;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.cl-tile .nm span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cl-tile .nm .ic{width:14px;height:14px;color:#ff8a95;flex:none}
.cl-grid{position:absolute;inset:66px 10px 118px;display:grid;gap:8px;grid-template-columns:1fr 1fr;grid-auto-rows:1fr}
.cl-grid[data-n="2"]{grid-template-columns:1fr}.cl-grid[data-n="3"] .cl-tile:first-child{grid-column:1/-1}
.cl-grid[data-n="5"] .cl-tile:first-child,.cl-grid[data-n="7"] .cl-tile:first-child{grid-column:1/-1}
@media (min-width:760px){.cl-grid{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.cl-grid[data-n="2"]{grid-template-columns:1fr 1fr}.cl-grid .cl-tile:first-child{grid-column:auto!important}}
.cl-one{position:absolute;inset:0}.cl-one>.cl-tile:not(.cl-self){position:absolute;inset:0;border-radius:0;background:transparent}.cl-one>.cl-tile:not(.cl-self) .nm{bottom:128px;z-index:3}.cl-tile.scr video{object-fit:contain}.cl-badge{position:absolute;z-index:3;bottom:186px;left:50%;transform:translateX(-50%);display:inline-flex;gap:6px;align-items:center;white-space:nowrap;font-size:12.5px;font-weight:650;padding:6px 12px;border-radius:999px;background:#0009;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}.cl-one>.cl-tile:not(.cl-self) .nm:not(.mu){display:none}.cl-one.pre video{filter:blur(16px) brightness(.5);transform:scale(1.1)}.cl-one.pre video.mirror{transform:scale(-1.1,1.1)}
.cl-self{position:absolute;z-index:4;width:104px;height:150px;top:76px;inset-inline-end:14px;border-radius:18px;box-shadow:0 10px 30px #0008,0 0 0 1.5px #ffffff2e;touch-action:none;cursor:grab;transition:top .3s var(--ease),left .3s var(--ease),right .3s var(--ease)}
.cl-self.drag{transition:none;cursor:grabbing}.cl-self .ph .a{width:44px;height:44px;border-radius:15px;font-size:18px}.cl-self .nm{display:none}
.cl-voice{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding-bottom:90px;text-align:center}
.cl-voice .a{position:relative;width:132px;height:132px;border-radius:44px;display:grid;place-items:center;font-size:52px;font-weight:800;overflow:visible}
.cl-voice .a img{width:100%;height:100%;object-fit:cover;border-radius:44px}
.cl-voice .a::before,.cl-voice .a::after{content:"";position:absolute;inset:-14px;border-radius:56px;border:2px solid #ffffff2a;animation:clring 2.4s var(--ease) infinite}
.cl-voice .a::after{animation-delay:1.2s}.cl-voice.spk .a::before{border-color:#3ddc97aa}
.cl-voice h2{margin:6px 0 0;font-size:24px}.cl-voice p{margin:0;opacity:.75;font-variant-numeric:tabular-nums}
@keyframes clring{0%{transform:scale(.92);opacity:0}30%{opacity:1}100%{transform:scale(1.25);opacity:0}}
.cl-dim{position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(#0009,#0000 30%,#0000 62%,#000b)}
.cl-ctl{position:absolute;z-index:3;bottom:0;inset-inline:0;padding:14px 8px calc(16px + env(safe-area-inset-bottom));display:flex;justify-content:center;gap:6px;transition:opacity .3s,transform .3s var(--ease)}
.cl-full.idle .cl-ctl{opacity:0;transform:translateY(16px);pointer-events:none}.cl-full.idle .cl-top{opacity:0;pointer-events:none}
.cl-b{display:flex;flex-direction:column;align-items:center;gap:6px;border:0;background:none;color:var(--white);font:inherit;font-size:11.5px;cursor:pointer;min-width:58px;white-space:nowrap}
.cl-b .o{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:#ffffff26;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);transition:background .2s,transform .2s var(--spring)}
.cl-b:active .o{transform:scale(.92)}.cl-b .ic{width:24px;height:24px}.cl-b[aria-pressed=true] .o{background:var(--white);color:#15121f}
.cl-b.end .o{background:#ff3b4e;width:62px;height:62px;margin-top:-4px}.cl-b.end .ic{width:30px;height:30px}.cl-b.ok .o{background:#21c07a;width:64px;height:64px}.cl-b.ok .ic{width:28px;height:28px}
.cl-b:focus-visible{outline:none}.cl-b:focus-visible .o{outline:3px solid var(--white);outline-offset:3px}.cl-ib:focus-visible{outline:3px solid #fff;outline-offset:2px}
.cl-mini{position:fixed;z-index:90;left:12px;top:calc(var(--top-h) + 12px);width:112px;height:156px;border-radius:20px;overflow:hidden;background:#1b1530;color:var(--white);box-shadow:0 18px 40px -10px #000a,0 0 0 1.5px #ffffff22;touch-action:none;cursor:grab;
  transition:left .35s var(--ease),top .35s var(--ease),opacity .25s,transform .3s var(--ease);opacity:0;transform:scale(.9)}
.cl-mini.on{opacity:1;transform:none}.cl-mini.drag{transition:none;cursor:grabbing}
.cl-mini .cl-tile{position:absolute;inset:0;border-radius:0}.cl-mini .cl-tile .nm{display:none}.cl-mini .cl-tile .ph .a{width:52px;height:52px;border-radius:18px;font-size:var(--fs-2xl)}
.cl-mini .bar{position:absolute;inset-inline:0;bottom:0;display:flex;align-items:center;justify-content:space-between;padding:6px;background:linear-gradient(#0000,#000c)}
.cl-mini .bar small{font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums;padding-inline-start:4px}
.cl-mini .x{width:34px;height:34px;border-radius:50%;border:0;background:#ff3b4e;color:var(--white);display:grid;place-items:center;cursor:pointer}.cl-mini .x .ic{width:18px;height:18px}
.cl-mini.voice{width:auto;height:56px;border-radius:999px;display:flex;align-items:center;gap:8px;padding:6px 6px 6px 14px;background:linear-gradient(135deg,#21c07a,#18a676)}
.cl-mini.voice .cl-tile{display:none}.cl-mini.voice .bar{position:static;background:none;padding:0;gap:10px}.cl-mini.voice .vi{display:inline-flex}.cl-mini .vi{display:none;width:20px;height:20px}
.cl-mini:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.cl-in{position:fixed;z-index:96;inset-inline:0;bottom:0;display:flex;justify-content:center;padding:0 10px calc(10px + env(safe-area-inset-bottom));pointer-events:none}
.cl-in .p{pointer-events:auto;width:min(440px,100%);border-radius:30px;padding:22px 18px 18px;background:linear-gradient(160deg,#2a1d55,#120e22);color:var(--white);box-shadow:0 30px 70px -10px #000b;text-align:center;transform:translateY(110%);transition:transform .45s var(--ease)}
.cl-in.on .p{transform:none}.cl-in .who{display:flex;align-items:center;gap:14px;text-align:start;margin-bottom:20px}
.cl-in .who .a{position:relative;flex:none;width:64px;height:64px;border-radius:22px;display:grid;place-items:center;font-size:var(--fs-3xl);font-weight:800}
.cl-in .who .a img{width:100%;height:100%;border-radius:22px;object-fit:cover}.cl-in .who .a::after{content:"";position:absolute;inset:-6px;border-radius:27px;border:2px solid #3ddc97;animation:clring 1.8s var(--ease) infinite}
.cl-in .who b{display:block;font-size:19px}.cl-in .who small{opacity:.78;font-size:13.5px;display:inline-flex;align-items:center;gap:5px}.cl-in .who small .ic{width:15px;height:15px}
.cl-in .acts{display:flex;justify-content:space-around;align-items:flex-start}
.cl-in .alt{display:block;margin:14px auto 0;border:0;background:#ffffff1a;color:var(--white);font:inherit;font-size:var(--fs-sm);font-weight:650;min-height:40px;padding:0 16px;border-radius:999px;cursor:pointer}
@media (prefers-reduced-motion:reduce){.cl-full,.cl-in .p,.cl-mini,.cl-ctl{transition:opacity .2s linear!important;transform:none!important}.cl-voice .a::before,.cl-voice .a::after,.cl-in .who .a::after{animation:none;opacity:.6}}
@media (forced-colors:active){.cl-b .o,.cl-ib{border:2px solid ButtonText}}`;
  (function inject() { if (document.getElementById("cl-css")) return; const s = document.createElement("style"); s.id = "cl-css"; s.textContent = CSS; document.head.appendChild(s);
    document.body.insertAdjacentHTML("beforeend", `<div id="cl-say" class="sr-only" aria-live="assertive" role="status" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"></div>`); })();

  /* ---------- people & targets ---------- */
  const person = (id) => { const u = (typeof S !== "undefined" && id && (S.user?.(id) || S.byHandle?.(id))) || null; return u ? { id: u.id, name: u.name, color: u.color, avatar: u.avatar, handle: u.handle } : { id, name: "مستخدم", color: "#6d3cf4" }; };
  const avImg = (p, size = "200") => { const a = p?.avatar; return !a ? "" : typeof a === "string" ? a : a[size] || a["200"] || a["64"] || ""; };
  const avHtml = (p, cls = "a") => `<span class="${cls}" style="background:${h(p?.color || "#6d3cf4")}" aria-hidden="true">${avImg(p) ? `<img src="${h(avImg(p))}" alt="">` : h((p?.name || "م")[0])}</span>`;
  const convOf = (id) => (DB.conversations || []).find(x => x.id === id);
  const membersOf = (c) => (c?.members || []).map(m => m.user || m).filter(m => m && m !== DB.me);
  /** "u1" · "@handle" · "conv:c1" · {conv} · {users:[…]} · ["u1","u2"] → { users, conv, title } */
  function resolve(target) {
    if (Array.isArray(target)) return { users: target.slice(0, MAX - 1) };
    if (target && typeof target === "object") { if (target.users) return resolve(target.users); if (target.conv) target = "conv:" + target.conv; else if (target.id) target = target.id; }
    const t = String(target || "");
    if (t.startsWith("conv:")) { const id = t.slice(5), c = convOf(id), users = membersOf(c); return { users: users.slice(0, MAX - 1), conv: id, title: c?.title || c?.name || null }; }
    const u = person(t.replace(/^@/, "")); return { users: u.id ? [u.id] : [] };
  }

  /* ---------- state: the view model is derived from MPCalls; `fb` paints the screen optimistically until the engine's first event ---------- */
  let facing = "user", scrStream = null, call = null, fb = null, mode = "none", timer = null, idleT = null, ringer = null, local = null, pipWin = null, activeAt = null, lastId = null;
  const remoteLv = {};
  const vids = new Map(); // peer id → <video>, reused across renders so streams never restart
  const titleOf = (c) => c.title || (c.peers.length === 1 ? c.peers[0].name : c.peers.slice(0, 2).map(p => p.name).join(" و") + (c.peers.length > 2 ? ` و${c.peers.length - 2} آخرون` : "")) || "مكالمة";
  const clock = (c) => { if (!c.startedAt || !["active", "reconnecting"].includes(c.state)) return { outgoing: c.kind === "group" ? "جارٍ دعوة المشاركين…" : "جارٍ الرنين…", incoming: "مكالمة واردة", connecting: "جارٍ الاتصال…", reconnecting: "إعادة الاتصال…", ended: "انتهت المكالمة" }[c.state] || "جارٍ الاتصال…";
    const s = Math.max(0, Math.floor((Date.now() - new Date(c.startedAt)) / 1000)), p = (n) => String(n).padStart(2, "0"); return (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + p(Math.floor(s / 60) % 60) + ":" + p(s % 60); };
  const qText = { good: "اتصال ممتاز", fair: "اتصال متوسط", poor: "اتصال ضعيف", unknown: "جودة الاتصال" };
  const Q = { high: "good", medium: "fair", low: "poor", audio: "poor" }, RANK = { good: 0, unknown: 0, fair: 1, poor: 2 };
  const LIVE = ["outgoing", "connecting", "active", "reconnecting"];
  function derive() {
    const c = E();
    if (!c || !c.call || !LIVE.includes(c.state)) return fb;
    const s = c.call, md = c.media || {}, infos = new Map((c.peers?.() || []).map(i => [i.id, i]));
    if (s.call.id !== lastId) { lastId = s.call.id; activeAt = null; }
    if (c.state === "active" && !activeAt) activeAt = s.call.answeredAt && Date.now() - Date.parse(s.call.answeredAt) < 6 * 3600e3 ? s.call.answeredAt : new Date().toISOString();
    const parts = s.participants.filter(p => p.id !== DB.me && (p.state === "joined" || p.state === "ringing" || (s.call.mode !== "group" && s.participants.length <= 2)));
    const peers = parts.slice(0, MAX - 1).map(p => { const i = infos.get(p.id), base = person(p.id);
      return { ...base, name: p.name || base.name, color: p.color || base.color, avatar: p.avatar || base.avatar, handle: p.handle || base.handle, stream: i?.stream || null, muted: !p.mic && p.state === "joined",
        camOff: !(p.camera || p.screen) || (i ? !i.video : true), screen: !!p.screen, speaking: c.speaker === p.id, state: p.state, level: remoteLv[p.id] || i?.level || p.quality || null }; });
    const levels = [c.level, ...peers.map(p => p.level)].filter(Boolean).map(l => Q[l] || "unknown");
    const quality = c.state === "active" || c.state === "reconnecting" ? levels.reduce((w, q) => RANK[q] > RANK[w] ? q : w, "good") : "unknown";
    local = c.local || null;
    if (md.screen && c.screenTrack) { // self view shows what I'm sharing
      if (!scrStream || scrStream.getVideoTracks()[0] !== c.screenTrack) scrStream = new MediaStream([c.screenTrack]);
      local = scrStream;
    } else scrStream = null;
    const conv = s.call.conv && convOf(s.call.conv);
    return { id: s.call.id, engine: true, video: s.call.kind === "video" || !!md.camera || !!md.screen || peers.some(p => !p.camOff), kind: s.call.mode === "group" || peers.length > 1 ? "group" : "direct",
      state: c.state, startedAt: activeAt, title: conv && (conv.title || conv.name) || null, peers, quality: c.state === "reconnecting" ? "poor" : quality,
      local: { muted: md.mic === false, camOff: !md.camera && !md.screen, sharing: !!md.screen, facing } };
  }
  let rq = 0;
  function sync() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; const m = derive(); if (!m) return; call = m; if (mode === "none") mode = "full"; render(); }); }

  /* ---------- rendering ---------- */
  function root(cls, tag = "div") { let el = document.querySelector("." + cls + ":not(.gone)"); if (!el) { el = document.createElement(tag); el.className = cls; document.body.appendChild(el); } return el; }
  function videoFor(id, stream, mirror) {
    let v = vids.get(id); if (!v) { v = document.createElement("video"); v.autoplay = true; v.playsInline = true; v.setAttribute("playsinline", ""); vids.set(id, v); }
    v.muted = id === "me"; v.classList.toggle("mirror", !!mirror);
    if (stream && v.srcObject !== stream) { v.srcObject = stream; v.play?.().catch(() => { }); }
    return v;
  }
  const hasVideo = (stream, off) => !!stream && !off && stream.getVideoTracks().some(t => t.readyState === "live" && t.enabled);
  function tile(p, isMe) {
    const el = document.createElement("div"); el.className = "cl-tile" + (p.speaking ? " spk" : "") + (p.state === "ringing" ? " rg" : ""); el.dataset.id = isMe ? "me" : p.id;
    const stream = p.stream, show = call.video && hasVideo(stream, p.camOff);
    el.setAttribute("role", "img"); el.setAttribute("aria-label", `${isMe ? "أنت" : p.name}${p.muted ? "، الميكروفون مكتوم" : ""}${show ? "" : "، الكاميرا متوقفة"}`);
    el.innerHTML = `<div class="ph">${avHtml(p)}</div>`; // stays visible under a video that has no frames yet
    if (show) el.appendChild(videoFor(isMe ? "me" : p.id, stream, isMe && call.local.facing !== "environment" && !call.local.sharing));
    else if (stream && !isMe) { const a = videoFor(p.id, stream); a.style.display = "none"; el.appendChild(a); } // keep audio playing
    el.insertAdjacentHTML("beforeend", `<span class="nm${p.muted ? " mu" : ""}">${p.muted ? ic("micOff") : ""}<span>${h(isMe ? "أنت" : p.name)}${p.state === "ringing" ? " · يرن…" : ""}</span></span>`);
    return el;
  }
  function controls(c) {
    const L = c.local, scr = E()?.supports ? !!E().supports.screen : !!navigator.mediaDevices?.getDisplayMedia;
    const b = (id, icon, label, pressed, extra = "", aria = label) => `<button class="cl-b ${extra}" data-a="${id}" ${pressed !== null ? `aria-pressed="${!!pressed}"` : ""} aria-label="${aria}"><span class="o">${ic(icon)}</span><span aria-hidden="true">${label}</span></button>`;
    return b("mute", L.muted ? "micOff" : "mic", L.muted ? "مكتوم" : "كتم", L.muted, "", "كتم الميكروفون") +
      (c.video ? b("cam", L.camOff ? "videoOff" : "video", "الكاميرا", L.camOff, "", "إيقاف الكاميرا") + b("flip", "flip", "تبديل", null) : b("cam", "video", "فيديو", false)) +
      (scr ? b("share", "screen", L.sharing ? "إيقاف" : "الشاشة", L.sharing, "", "مشاركة الشاشة") : "") +
      b("end", "phoneOff", "إنهاء", null, "end");
  }
  function renderFull() {
    const el = root("cl-full"); el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "مكالمة مع " + titleOf(call));
    const c = call, me = { ...person(DB.me), stream: local, muted: c.local.muted, camOff: c.local.camOff };
    const focused = document.activeElement?.dataset?.a;
    const docPip = "documentPictureInPicture" in window, vidPip = document.pictureInPictureEnabled && c.video;
    el.innerHTML = `<div class="cl-stage"></div>
      <div class="cl-top"><button class="cl-ib" data-a="min" aria-label="تصغير المكالمة ومتابعة التصفح">${ic("minimize")}</button>
        <div class="ttl"><b>${h(titleOf(c))}</b><small class="cl-clock" aria-live="off">${h(clock(c))}</small></div>
        <span class="cl-qw" role="img" aria-label="${qText[c.quality]}" title="${qText[c.quality]}"><span class="cl-q" data-q="${c.quality}"><i></i><i></i><i></i></span></span>
        ${docPip || vidPip ? `<button class="cl-ib" data-a="pip" aria-label="نافذة عائمة فوق التطبيقات">${ic("pip")}</button>` : ""}</div>
      <div class="cl-ctl" role="toolbar" aria-label="أدوات المكالمة">${controls(c)}</div>`;
    const stage = el.querySelector(".cl-stage");
    if (c.kind === "group") {
      const g = document.createElement("div"); g.className = "cl-grid"; const all = [me, ...c.peers].slice(0, MAX); g.dataset.n = String(all.length);
      all.forEach((p, i) => g.appendChild(tile(p, i === 0))); stage.appendChild(g);
    } else {
      const peer = c.peers[0] || person("");
      const pv = c.video && hasVideo(peer.stream, peer.camOff), lv = c.video && hasVideo(local, c.local.camOff);
      if (pv || (lv && c.state !== "active")) {
        // peer video full-bleed + draggable self view · or, while ringing, my own camera blurred behind the avatar
        const one = document.createElement("div"); one.className = "cl-one";
        if (pv) { const t = tile(peer); if (peer.screen) t.classList.add("scr"); one.appendChild(t); if (lv) { const s = tile(me, true); s.classList.add("cl-self"); one.appendChild(s); dragSelf(s); } }
        else { one.classList.add("pre"); one.appendChild(tile(me, true)); }
        one.insertAdjacentHTML("beforeend", `<div class="cl-dim"></div>`); stage.appendChild(one);
        if (!pv) stage.insertAdjacentHTML("beforeend", `<div class="cl-voice">${avHtml(peer)}<h2>${h(peer.name)}</h2><p class="cl-clock2">${h(clock(c))}</p></div>`);
        if (pv && peer.screen) stage.insertAdjacentHTML("beforeend", `<div class="cl-badge">${ic("screen", "sm")} ${h(peer.name)} يشارك الشاشة</div>`);
      } else {
        // voice call, or a video call where the other side's camera is off: their avatar, my camera as the small view
        const note = peer.muted ? `<p>${ic("micOff", "sm")} الميكروفون مكتوم لدى ${h(peer.name)}</p>` : c.video && peer.state === "joined" ? `<p>${ic("videoOff", "sm")} الكاميرا متوقفة لدى ${h(peer.name)}</p>` : "";
        stage.innerHTML = `<div class="cl-voice ${peer.speaking ? "spk" : ""}">${avHtml(peer)}<h2>${h(peer.name)}</h2><p class="cl-clock2">${h(clock(c))}</p>${note}</div>`;
        if (peer.stream) { const a = videoFor(peer.id, peer.stream); a.style.display = "none"; stage.appendChild(a); }
        if (lv) { const s = tile(me, true); s.classList.add("cl-self"); stage.appendChild(s); dragSelf(s); }
      }
    }
    if (!el.classList.contains("on")) requestAnimationFrame(() => el.classList.add("on"));
    document.body.classList.add("cl-on");
    if (focused) el.querySelector(`[data-a="${focused}"]`)?.focus(); else if (!el.contains(document.activeElement)) el.querySelector('[data-a="mute"]')?.focus({ preventScroll: true });
    armIdle();
  }
  function renderMini() {
    const el = root("cl-mini"), c = call, peer = c.peers[0] || person(""), vid = c.video && (hasVideo(peer.stream, peer.camOff) || hasVideo(local, c.local.camOff));
    el.classList.toggle("voice", !vid); el.tabIndex = 0; el.setAttribute("role", "button");
    el.setAttribute("aria-label", `العودة إلى المكالمة مع ${titleOf(c)}، ${clock(c)}`);
    el.innerHTML = "";
    if (vid) el.appendChild(tile(hasVideo(peer.stream, peer.camOff) ? peer : { ...person(DB.me), stream: local }, !hasVideo(peer.stream, peer.camOff)));
    el.insertAdjacentHTML("beforeend", `<div class="bar"><span class="vi" aria-hidden="true">${ic("phone")}</span><small class="cl-clock">${h(clock(c))}</small><button class="x" data-a="end" aria-label="إنهاء المكالمة">${ic("phoneOff")}</button></div>`);
    if (!el.classList.contains("on")) { requestAnimationFrame(() => el.classList.add("on")); dragMini(el); }
  }
  function render() {
    if (!call) return;
    if (mode === "full") { document.querySelector(".cl-mini")?.remove(); renderFull(); }
    else if (mode === "mini") { closeFull(); if (!pipWin) renderMini(); else renderPip(); }
  }
  const closeFull = () => { const f = document.querySelector(".cl-full"); if (f) { f.remove(); document.body.classList.remove("cl-on"); } };
  function tick() { if (!call) return; const t = clock(call); document.querySelectorAll(".cl-clock,.cl-clock2").forEach(x => (x.textContent = t)); pipWin?.document.querySelectorAll(".cl-clock").forEach(x => (x.textContent = t)); const m = document.querySelector(".cl-mini"); if (m) m.setAttribute("aria-label", `العودة إلى المكالمة مع ${titleOf(call)}، ${t}`); }

  /* idle: hide controls during video after 4 s without interaction */
  function armIdle() { const f = document.querySelector(".cl-full"); if (!f) return; f.classList.remove("idle"); clearTimeout(idleT); if (call?.video && call.state === "active" && !reduced()) idleT = setTimeout(() => { if (!f.contains(document.activeElement) || document.activeElement === f) f.classList.add("idle"); }, 4000); }

  /* ---------- dragging ---------- */
  function draggable(el, { onTap, bounds, snap }) {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, id = null;
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; id = e.pointerId; el.setPointerCapture(id); const r = el.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; moved = false; });
    el.addEventListener("pointermove", (e) => { if (e.pointerId !== id) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (!moved && Math.hypot(dx, dy) < 6) return; moved = true; el.classList.add("drag"); const b = bounds();
      el.style.insetInlineEnd = "auto"; el.style.right = "auto"; el.style.left = Math.min(Math.max(b.l, ox + dx), b.r - el.offsetWidth) + "px"; el.style.top = Math.min(Math.max(b.t, oy + dy), b.b - el.offsetHeight) + "px"; });
    const up = (e) => { if (e.pointerId !== id) return; id = null; el.classList.remove("drag"); if (moved) snap(); else onTap?.(); };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }
  const snapTo = (el, b) => { const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    el.style.left = (cx < (b.l + b.r) / 2 ? b.l : b.r - r.width) + "px"; el.style.top = (cy < (b.t + b.b) / 2 ? b.t : b.b - r.height) + "px";
    try { sessionStorage.setItem("mp-cl-mini", JSON.stringify({ x: cx < (b.l + b.r) / 2 ? 0 : 1, y: cy < (b.t + b.b) / 2 ? 0 : 1 })); } catch { } };
  function miniBounds() { const nav = document.querySelector(".bottomnav"), navH = nav && getComputedStyle(nav).display !== "none" && innerWidth < 760 ? nav.offsetHeight + 16 : 0; const top = document.querySelector(".topbar"); return { l: 12, r: innerWidth - 12, t: (top?.offsetHeight || 58) + 10, b: innerHeight - 12 - navH }; }
  function dragMini(el) {
    try { const s = JSON.parse(sessionStorage.getItem("mp-cl-mini") || "null"); if (s) requestAnimationFrame(() => { const b = miniBounds(); el.style.left = (s.x ? b.r - el.offsetWidth : b.l) + "px"; el.style.top = (s.y ? b.b - el.offsetHeight : b.t) + "px"; }); } catch { }
    draggable(el, { onTap: expand, bounds: miniBounds, snap: () => snapTo(el, miniBounds()) });
    el.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); expand(); } });
  }
  function dragSelf(el) { const b = () => ({ l: 10, r: innerWidth - 10, t: 70, b: innerHeight - 130 }); draggable(el, { bounds: b, snap: () => snapTo(el, b()), onTap: null }); }

  /* ---------- Document Picture-in-Picture ---------- */
  async function openPip() {
    if ("documentPictureInPicture" in window) {
      try {
        pipWin = await documentPictureInPicture.requestWindow({ width: 300, height: call.video ? 400 : 140 });
        const d = pipWin.document; d.documentElement.lang = "ar"; d.documentElement.dir = "rtl";
        for (const s of document.querySelectorAll("style,link[rel=stylesheet]")) d.head.appendChild(s.cloneNode(true));
        d.head.insertAdjacentHTML("beforeend", `<style>body{margin:0;background:#0d0a18;font-family:var(--font)}.cl-mini{position:fixed!important;inset:0!important;width:auto!important;height:auto!important;border-radius:0!important;opacity:1!important;transform:none!important}.cl-mini.voice{border-radius:0!important;justify-content:center}</style>`);
        d.body.appendChild(document.querySelector("svg[aria-hidden]")?.cloneNode(true) || d.createElement("i"));
        pipWin.addEventListener("pagehide", () => { pipWin = null; if (call && mode === "mini") renderMini(); });
        mode = "mini"; closeFull(); document.querySelector(".cl-mini")?.remove(); renderPip(); say("المكالمة في نافذة عائمة");
        return;
      } catch { pipWin = null; }
    }
    const v = [...vids.values()].find(x => x.srcObject && x.style.display !== "none" && vids.get("me") !== x) || vids.get("me");
    if (v && document.pictureInPictureEnabled) { try { await v.requestPictureInPicture(); minimize(); } catch { toast("تعذّر فتح النافذة العائمة"); } }
  }
  function renderPip() {
    const d = pipWin.document, c = call, peer = c.peers[0] || person(""), vid = c.video && hasVideo(peer.stream, peer.camOff);
    let el = d.querySelector(".cl-mini"); if (!el) { el = d.createElement("div"); el.className = "cl-mini on"; d.body.appendChild(el); }
    el.classList.toggle("voice", !vid); el.innerHTML = "";
    if (vid) { const t = document.createElement("div"); t.className = "cl-tile"; const v = d.createElement("video"); v.autoplay = true; v.playsInline = true; v.srcObject = peer.stream; t.appendChild(v); el.appendChild(t); }
    el.insertAdjacentHTML("beforeend", `<div class="bar"><span class="vi">${ic("phone")}</span><small class="cl-clock">${h(clock(c))}</small><span class="u-dflex u-g6"><button class="x" data-a="back" aria-label="العودة إلى المكالمة" style="background:#ffffff33">${ic("maximize")}</button><button class="x" data-a="end" aria-label="إنهاء المكالمة">${ic("phoneOff")}</button></span></div>`);
    el.querySelector('[data-a="end"]').onclick = () => hangup();
    el.querySelector('[data-a="back"]').onclick = () => { window.focus(); expand(); };
  }
  const closePip = () => { try { pipWin?.close(); } catch { } pipWin = null; if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => { }); };

  /* ---------- actions ---------- */
  const busy = () => !!call || (E() && LIVE.concat("incoming").includes(E().state));
  async function start(target, opts = {}) {
    if (busy()) { if (call) expand(); toast("أنت في مكالمة بالفعل"); return null; }
    const t = resolve(target), video = !!opts.video;
    if (!t.users.length && !t.conv) { toast("لا يوجد من تتصل به"); return null; }
    // paint at once (the engine needs ICE + media before the call exists); the engine model takes over on its first event
    fb = { id: "pending", video, kind: t.users.length > 1 ? "group" : "direct", state: "outgoing", title: t.title, peers: t.users.map(person), quality: "unknown", local: { muted: false, camOff: !video, facing: "user" } };
    call = fb; mode = "full"; render(); say(`جارٍ الاتصال بـ ${titleOf(call)}`); startClock();
    let c = E();
    if (!c) { try { await window.MPChunks?.load("calls"); } catch { } c = E(); bindEngine(); }
    if (!c) { toast("المكالمات غير متاحة الآن"); end("silent"); return null; }
    {
      try { await c.start(t.conv ? { conv: t.conv, kind: video ? "video" : "voice" } : t.users.length === 1 ? { to: t.users[0], kind: video ? "video" : "voice" } : { users: t.users, kind: video ? "video" : "voice" }); fb = null; sync(); }
      catch (e) { fb = null; toast(e.message || "تعذّر بدء المكالمة"); end("silent"); return null; }
      return E().call;
    }
  }
  function startClock() { clearInterval(timer); timer = setInterval(tick, 1000); }
  function expand() { if (!call) return; closePip(); mode = "full"; render(); }
  function minimize() { if (!call) return; mode = "mini"; render(); say("المكالمة مستمرة في نافذة صغيرة"); }
  async function toggle(a) {
    if (!call || !call.engine) return; const L = call.local, c = E();
    try {
      if (a === "mute") { await c.setMic(L.muted); say(L.muted ? "الميكروفون يعمل" : "الميكروفون مكتوم"); }
      if (a === "cam") { await c.setCamera(L.camOff); say(L.camOff ? "الكاميرا تعمل" : "الكاميرا متوقفة"); }
      if (a === "flip") { L.facing = L.facing === "environment" ? "user" : "environment"; facing = L.facing; await c.switchCamera(); say(L.facing === "environment" ? "الكاميرا الخلفية" : "الكاميرا الأمامية"); }
      if (a === "share") { if (L.sharing) await c.stopScreen(); else await c.startScreen(); }
    } catch (e) { toast(e.message || "تعذّر تنفيذ الأمر"); }
    sync();
  }
  async function hangup() { const c = E(); if (call?.engine && c) { try { await c.hangup(); } catch { } } else { c?.hangup().catch(() => { }); end("hangup"); } }
  const REASON = { declined: (t) => `${t} لم يقبل المكالمة`, busy: (t) => `${t} في مكالمة أخرى`, missed: () => "لم يتم الرد", "no-answer": () => "لم يتم الرد", failed: () => "تعذّر الاتصال", elsewhere: () => "تم الرد من جهاز آخر", left: () => "غادرت المكالمة" };
  function end(reason) {
    if (!call && !incomingInfo) return; const t = call ? titleOf(call) : "", dur = call?.startedAt ? clock(call) : null;
    local = null; call = null; fb = null; mode = "none"; activeAt = null; clearInterval(timer); clearTimeout(idleT); vids.forEach(v => (v.srcObject = null)); vids.clear(); closePip(); closeFull(); stopRing();
    document.querySelector(".cl-mini")?.remove(); hideIncoming();
    if (reason === "silent") return;
    const msg = REASON[reason] && !(reason === "left" && dur) ? REASON[reason](t) : dur ? `انتهت المكالمة · ${dur}` : "انتهت المكالمة";
    toast(msg); say(msg);
  }

  /* ---------- incoming ---------- */
  let incomingInfo = null, inTimer = null;
  function ring() {
    stopRing(); if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const ctx = new AC(); const beep = () => { const t0 = ctx.currentTime; [[660, 0], [880, .22]].forEach(([f, d]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(.08, t0 + d + .04); g.gain.linearRampToValueAtTime(0, t0 + d + .2); o.connect(g).connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + .22); }); };
      beep(); ringer = { ctx, i: setInterval(() => { beep(); if (navigator.vibrate) navigator.vibrate([400, 200, 400]); }, 2200) }; } catch { }
  }
  function stopRing() { if (ringer) { clearInterval(ringer.i); ringer.ctx.close?.().catch(() => { }); ringer = null; } try { navigator.vibrate?.(0); } catch { } }
  function hideIncoming() { clearTimeout(inTimer); const el = document.querySelector(".cl-in:not(.gone)"); if (el) { el.classList.remove("on"); el.classList.add("gone"); setTimeout(() => el.remove(), reduced() ? 50 : 400); } incomingInfo = null; }
  /** MPCalls "incoming": { call: CallState } */
  function incoming(info = {}) {
    let from, video, group, title, id;
    if (!info.call?.call) return;
    { const s = info.call, host = s.participants.find(p => p.id === s.call.host) || s.participants.find(p => p.id !== DB.me) || {}; from = { ...person(host.id), ...host }; video = s.call.kind === "video"; group = s.call.mode === "group" || s.participants.length > 2; id = s.call.id; const cv = s.call.conv && convOf(s.call.conv); title = group ? (cv?.title || cv?.name || `${from.name} و${s.participants.length - 2} آخرون`) : from.name; }
    if (call) return; // the engine marks us busy server-side; "waiting" surfaces it
    incomingInfo = { id, from, video };
    const el = root("cl-in"); el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "cl-in-t"); el.setAttribute("aria-describedby", "cl-in-d");
    el.innerHTML = `<div class="p"><div class="who">${avHtml(from)}<div><b id="cl-in-t">${h(title)}</b><small id="cl-in-d">${ic(video ? "video" : "phone")} ${group ? (video ? "مكالمة فيديو جماعية" : "مكالمة جماعية") : video ? "مكالمة فيديو" : "مكالمة صوتية"} واردة…</small></div></div>
      <div class="acts"><button class="cl-b end" data-a="decline" aria-label="رفض المكالمة"><span class="o">${ic("phoneOff")}</span><span aria-hidden="true">رفض</span></button>
        <button class="cl-b ok" data-a="accept" aria-label="قبول ${video ? "مكالمة الفيديو" : "المكالمة"}"><span class="o">${ic(video ? "video" : "phone")}</span><span aria-hidden="true">قبول</span></button></div>
      ${video ? `<button class="alt" data-a="voice">${ic("mic", "sm")} الرد بالصوت فقط</button>` : ""}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
    el.querySelector('[data-a="accept"]').focus({ preventScroll: true });
    el.onclick = (e) => { const a = e.target.closest("[data-a]")?.dataset.a; if (a === "decline") decline(); if (a === "accept") accept(video); if (a === "voice") accept(false); };
    el.onkeydown = (e) => { if (e.key === "Tab") { const f = [...el.querySelectorAll("button")], i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); } };
    ring(); say(`${from.name} يتصل بك`);
    clearTimeout(inTimer); inTimer = setTimeout(() => { if (incomingInfo) { stopRing(); hideIncoming(); toast(`فاتتك مكالمة من ${from.name}`); } }, (info.call?.call?.ringMs || 45000) + 2000);
  }
  async function accept(video) {
    const info = incomingInfo; if (!info) return; stopRing(); hideIncoming();
    const c = E();
    {
      fb = { id: info.id, video, kind: "direct", state: "connecting", peers: [info.from], quality: "unknown", local: { muted: false, camOff: !video, facing: "user" } };
      call = fb; mode = "full"; render(); startClock();
      try { await c.accept({ camera: video }); fb = null; sync(); } catch (e) { fb = null; toast(e.message || "تعذّر الرد"); end("silent"); }
      return;
    }
  }
  function decline() { const info = incomingInfo; stopRing(); hideIncoming(); if (info) E()?.decline().catch(() => { }); say("رُفضت المكالمة"); }

  /* ---------- engine wiring ---------- */
  function bindEngine() {
    const c = E(); if (!c || c.__ui || typeof c.on !== "function") return; c.__ui = true;
    c.on("incoming", incoming);
    c.on("state", (d) => { if (d.state === "incoming") return; if (d.state === "idle") return; if (d.state === "ended") return; if (d.state === "active" && d.prev !== "reconnecting") say("بدأت المكالمة"); if (d.state === "reconnecting") say("انقطع الاتصال، جارٍ إعادة الاتصال"); sync(); });
    for (const ev of ["call", "local", "peer", "peer-left", "media", "screen", "speaker"]) c.on(ev, () => { if (call || (c.state && LIVE.includes(c.state))) sync(); });
    c.on("quality", (d) => { if (d?.self === false && d.id) remoteLv[d.id] = d.level; sync(); });
    c.on("remote-quality", (d) => { if (d?.id) { remoteLv[d.id] = d.level; sync(); } });
    c.on("ended", (d) => { if (incomingInfo && !call) { const who = incomingInfo.from?.name; hideIncoming(); stopRing(); if (d?.reason === "missed" && who) toast(`فاتتك مكالمة من ${who}`); else if (d?.reason === "elsewhere") toast("تم الرد من جهاز آخر"); return; } end(d?.reason || "hangup"); });
    c.on("waiting", (d) => { const host = d?.call?.participants?.find(p => p.id === d.call.call.host); toast(`${host?.name || "شخص"} يحاول الاتصال بك`); });
    c.on("error", (d) => { if (d?.message) toast(d.message); });
    if (c.state === "incoming" && c.call) incoming({ call: c.call }); else if (LIVE.includes(c.state)) sync();
  }
  // the engine chunk may land after this one (or be re-created in tests)
  const bindT = setInterval(() => { if (E()) { bindEngine(); clearInterval(bindT); } }, 500); setTimeout(() => clearInterval(bindT), 120e3);
  addEventListener("mpcalls:ready", () => setTimeout(bindEngine, 0));

  /* ---------- delegated UI events ---------- */
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-call-menu]");
    if (m) { e.preventDefault(); const p = person(m.dataset.callMenu), sh = sheet(`<h4 class="u-mt0">الاتصال بـ ${h(p.name)}</h4><div class="menu"><button data-call="voice" data-call-to="${h(p.id)}">${ic("phone", "sm")} مكالمة صوتية</button><button data-call="video" data-call-to="${h(p.id)}">${ic("video", "sm")} مكالمة فيديو</button></div>`);
      sh.querySelector("[data-call]")?.focus(); sh.querySelectorAll("[data-call]").forEach(x => x.addEventListener("click", () => closeSheet())); return; }
    const b = e.target.closest("[data-call]"); if (b && !b.closest(".cl-full,.cl-in")) { e.preventDefault(); start(b.dataset.callTo, { video: b.dataset.call === "video" }); return; }
    const a = e.target.closest(".cl-full [data-a], .cl-mini [data-a]")?.dataset.a; if (!a) return;
    e.stopPropagation();
    if (a === "min") minimize(); else if (a === "pip") openPip(); else if (a === "end") hangup(); else toggle(a);
  });
  document.addEventListener("pointermove", (e) => { if (e.target.closest?.(".cl-full")) armIdle(); }, { passive: true });
  document.addEventListener("pointerdown", (e) => { const f = e.target.closest?.(".cl-full"); if (f) { if (f.classList.contains("idle") && !e.target.closest("button")) e.preventDefault(); armIdle(); } });
  document.addEventListener("keydown", (e) => {
    const f = document.querySelector(".cl-full"); if (!f || !call) return; armIdle();
    if (e.key === "Escape") { e.preventDefault(); minimize(); document.querySelector(".cl-mini")?.focus(); return; }
    if (e.key === "Tab") { const els = [...f.querySelectorAll("button")]; const i = els.indexOf(document.activeElement); e.preventDefault(); els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length]?.focus(); }
    if (!e.target.closest("input,textarea") && (e.key === "m" || e.key === "M")) toggle("mute");
  });
  addEventListener("hashchange", () => { if (call && mode === "full") minimize(); });
  addEventListener("resize", () => { const m = document.querySelector(".cl-mini"); if (m) snapTo(m, miniBounds()); });

  /* ---------- header buttons (chat + profile) ---------- */
  const buttons = (target, name = "", cls = "btn ghost cl-hb") => `<span class="cl-hbs" data-call-btns><button class="${cls}" data-call="voice" data-call-to="${h(target)}" aria-label="مكالمة صوتية${name ? " مع " + h(name) : ""}" title="مكالمة صوتية">${ic("phone")}</button><button class="${cls}" data-call="video" data-call-to="${h(target)}" aria-label="مكالمة فيديو${name ? " مع " + h(name) : ""}" title="مكالمة فيديو">${ic("video")}</button></span>`;
  const blocked = (id) => (DB.blocked || []).includes(id);
  function decorate() {
    if (typeof view === "undefined" || !view) return;
    view.querySelectorAll("[data-call-slot]:not([data-filled])").forEach(s => { s.dataset.filled = "1"; s.innerHTML = buttons(s.dataset.callTo, s.dataset.callName || "", s.dataset.callClass || "btn ghost cl-hb"); });
    if (view.querySelector("[data-call-btns],[data-call]")) return;
    const r = (location.hash.split("/")[1] || "").split("?")[0], arg = decodeURIComponent((location.hash.split("/")[2] || "").split("?")[0]);
    if (r === "chat" && arg) {
      const c = convOf(arg), others = membersOf(c); if (others.some(blocked)) return;
      const name = others.length === 1 ? person(others[0]).name : "";
      const cm = view.querySelector("#cm-ch .who"); // chat screen (comms-ui.js)
      if (cm) { cm.insertAdjacentHTML("afterend", buttons("conv:" + arg, name, "cm-ib cl-hb")); return; }
      const head = view.querySelector(".wrap > .row a.grow"); if (head) head.insertAdjacentHTML("afterend", buttons("conv:" + arg, name)); // legacy chat view
    }
    // profile header is already full on a 390px screen: one call button that offers voice / video
    if (r === "u") { const u = S.byHandle?.(arg); const msg = view.querySelector("#msg"); if (!u || u.id === DB.me || !msg || blocked(u.id)) return;
      msg.insertAdjacentHTML("beforebegin", `<button class="btn ghost cl-hb" data-call-btns data-call-menu="${h(u.id)}" aria-haspopup="dialog" aria-label="اتصال بـ ${h(u.name)}" title="اتصال" style="width:40px;height:40px;margin-inline-end:4px">${ic("phone")}</button>`); }
  }
  let dq = 0; new MutationObserver(() => { if (dq) return; dq = requestAnimationFrame(() => { dq = 0; decorate(); }); }).observe(document.getElementById("view") || document.body, { childList: true, subtree: true });
  decorate();

  /* ---------- call history (#/calls) ---------- */
  async function historyView() {
    const token = Symbol(); view._cl = token;
    view.innerHTML = `<div class="wrap"><div class="u-dflex u-aic u-g8 nf-head"><h2 class="u-m0 u-f1">المكالمات</h2></div><div class="skel"></div><div class="skel"></div></div>`;
    let d; try { d = E() ? await E().history() : { calls: [] }; } catch (e) { d = { calls: [], error: e.message }; }
    if (view._cl !== token) return;
    E()?.markSeen?.().catch(() => { });
    const row = (x) => { const p = x.participants[0] || {}, who = x.participants.length > 1 ? `${p.name} و${x.participants.length - 1} آخرون` : p.name || "مستخدم", dur = x.duration ? `${Math.floor(x.duration / 60)}:${String(Math.round(x.duration % 60)).padStart(2, "0")}` : "";
      const st = x.missed ? "فائتة" : x.direction === "outgoing" ? (x.answeredAt ? "صادرة" : "لم يُرد") : "واردة";
      return `<div class="card row cl-hr"><span class="av" style="background:${h(p.color || "#6d3cf4")}" aria-hidden="true">${avImg(p) ? `<img src="${h(avImg(p, "64"))}" alt="">` : h((p.name || "م")[0])}</span>
        <div class="u-mw0 grow"><b style="${x.missed ? "color:var(--danger)" : ""}">${h(who)}</b><div class="u-dflex u-g6 u-aic muted">${ic(x.kind === "video" ? "video" : "phone", "sm")} ${st}${dur ? " · " + dur : ""} · ${h(relTime(x.at))}</div></div>
        <button class="btn ghost cl-hb" data-call="${x.kind === "video" ? "video" : "voice"}" data-call-to="${h(x.conv ? "conv:" + x.conv : x.participants.length > 1 ? "" : p.id)}" ${x.participants.length > 1 && !x.conv ? "disabled" : ""} aria-label="معاودة الاتصال بـ ${h(who)}">${ic(x.kind === "video" ? "video" : "phone")}</button></div>`; };
    view.innerHTML = `<div class="wrap"><div class="u-dflex u-aic u-g8 u-m0 u-mt4 u-mb10"><h2 class="u-m0 u-f1">المكالمات</h2></div>
      ${d.error ? `<div class="muted">${h(d.error)}</div>` : ""}${d.calls.map(row).join("") || `<div class="empty">${ic("phone")}<span class="empty-t">لا مكالمات بعد</span><span class="empty-x">اتصل بأي شخص من محادثته أو ملفه الشخصي</span></div>`}</div>`;
  }
  MPRoutes.extend((a, b) => ({ calls: () => historyView() }));

  window.MPCallsUI = { start, incoming, accept: () => accept(!!incomingInfo?.video), decline, hangup, minimize, expand, openPip, buttons, decorate, history: historyView, get call() { return call; }, version: "__APP_VERSION__" };
  bindEngine();
})();
