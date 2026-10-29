/* =====================================================================
 * مجتمع بلس — v2.7 communication layer (Track 6: phases 26–27), loaded as a lazy chunk ("comms").
 * Screens: conversation list (DMs + groups, unread, message-request tab with accept/decline), bubble
 * chat (day separators, consecutive grouping, reply quotes, reactions, voice notes with waveform,
 * typing + read indicators, images via picker / drag & drop / paste, delete for everyone,
 * disappearing-message timer with a live countdown), group creation (≤ 256) and group info/members,
 * encryption lock + safety-number verification (code + QR), encryption explainer, linked devices.
 * Data: /api/chat/* and /api/e2ee/* (server/services/chat.js, e2ee.js). Cryptography, the device key and
 * the WebSocket live in comms-core.js (window.MPComms); this chunk only renders and calls into it, and
 * degrades to plaintext REST + SSE when the core is absent. Styles are injected here (core CSS budget).
 * ===================================================================== */
(function CommsLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const h = (s) => esc(String(s ?? ""));
  const MC = () => window.MPComms || null;
  /* comms-core reads window.DB / window.Remote, but both are top-level lexical bindings (let/const) of
   * classic scripts and so never become window properties: expose live getters, then start its transport */
  for (const [k, get] of [["DB", () => DB], ["Remote", () => Remote]]) if (!(k in window)) { try { Object.defineProperty(window, k, { get, configurable: true }); } catch { } }
  const kick = () => { const c = MC(); if (c?.transport && c.transport() === "off" && online()) c.connect(); };
  setTimeout(kick, 0);
  const MAX_GROUP = 256, REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🙏", "🔥", "👏"];
  const TTLS = [[0, "إيقاف"], [300, "5 دقائق"], [3600, "ساعة"], [86400, "يوم"], [604800, "أسبوع"]];
  const ttlName = (t) => (TTLS.find(x => x[0] === +t) || [0, "إيقاف"])[1];
  const lang = () => (DB.settings?.lang === "en" ? "en" : "ar");
  const fmtTime = (iso) => { try { return new Intl.DateTimeFormat(lang(), { hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return ""; } };
  const dayKey = (iso) => { const d = new Date(iso); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
  const dayName = (iso) => {
    const d = new Date(iso), t = new Date(); const y = new Date(t); y.setDate(t.getDate() - 1);
    if (dayKey(d) === dayKey(t)) return "اليوم"; if (dayKey(d) === dayKey(y)) return "أمس";
    try { return new Intl.DateTimeFormat(lang(), { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) }).format(d); } catch { return d.toDateString(); }
  };
  const listTime = (iso) => { if (!iso) return ""; const d = new Date(iso); if (dayKey(d) === dayKey(new Date())) return fmtTime(iso); const days = (Date.now() - d) / 864e5; try { return new Intl.DateTimeFormat(lang(), days < 6 ? { weekday: "short" } : { day: "numeric", month: "short" }).format(d); } catch { return ""; } };
  const dur = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 86400 ? Math.ceil(s / 86400) + "ي" : s >= 3600 ? Math.ceil(s / 3600) + "س" : s >= 60 ? Math.ceil(s / 60) + "د" : s + "ث"; };
  const live = (msg) => { const r = document.getElementById("cm-live"); if (r) { r.textContent = ""; setTimeout(() => (r.textContent = msg), 30); } };
  const errToast = (e) => toast(e?.message || "تعذر الاتصال بالخادم");

  /* ---------- icons appended to the shared sprite ---------- */
  const ICONS = {
    cmSend: '<path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"/><path d="M6 12h16"/>',
    cmImg: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    cmReply: '<path d="M20 18v-2a4 4 0 0 0-4-4H4"/><path d="m9 17-5-5 5-5"/>',
    cmTrash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    cmTimer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
    cmGroup: '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
    cmInfo: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    cmBack: '<path d="m9 18 6-6-6-6"/>',
    cmDevice: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    cmLaptop: '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>',
    cmCheck2: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    cmSmile: '<path d="M15 10V9"/><path d="M16.472 15a6 6 0 01-8.943 0"/><path d="M9 10V9"/><circle cx="12" cy="12" r="10"/>',
    cmKey: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
    cmQr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>'
  };
  (function addIcons() { const s = document.querySelector("svg[aria-hidden] symbol")?.parentNode; if (s) s.insertAdjacentHTML("beforeend", Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("")); })();

  /* ---------- styles (injected: the core CSS bundle has no room) ---------- */
  const STYLE = `
#cm-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.cm-wrap{max-width:var(--col);margin:auto;padding:0 12px 120px}
.cm-head{display:flex;align-items:center;gap:8px;padding:10px 0 6px}
.cm-head h2{margin:0;flex:1;font-size:22px}
.cm-ib{width:44px;height:44px;min-width:44px;border-radius:50%;display:inline-grid;place-items:center;background:transparent;color:var(--text);border:0;cursor:pointer}
.cm-ib:hover{background:var(--bg-2)}.cm-ib .ic{width:22px;height:22px}
.cm-ib:focus-visible,.cm-row:focus-visible,.cm-b:focus-visible,.cm-chip:focus-visible,.cm-tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cm-tabs{display:flex;gap:4px;margin:6px 0 10px;padding:4px;border-radius:var(--r-pill,999px);background:var(--surface-sunken,var(--bg-2))}
.cm-tab{flex:1;min-height:44px;border-radius:var(--r-pill,999px);border:0;background:none;color:var(--text-2);font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}
.cm-tab[aria-selected=true]{background:var(--card);color:var(--accent-ink);font-weight:700;box-shadow:var(--sh-1)}
.cm-tab .n{display:inline-block;min-width:20px;padding:0 6px;margin-inline-start:6px;border-radius:10px;background:var(--like);color:#fff;font-size:12px;line-height:20px}
.cm-msr{margin-top:14px}.cm-msr-h{font-size:14px;margin:0 0 6px;display:flex;gap:6px;align-items:center}.cm-msr .cm-prev b{font-weight:700}
.cm-search{width:100%;min-height:44px;border-radius:14px;border:1px solid var(--line-2);background:var(--card);color:var(--text);padding:0 14px;font:inherit;margin-bottom:8px}
.cm-row{display:flex;align-items:center;gap:12px;padding:10px;border-radius:16px;color:inherit;text-decoration:none;min-height:64px}
.cm-row:hover{background:var(--bg-2)}
.cm-row .av{flex:none}
.cm-mid{flex:1;min-width:0;display:block}
.cm-name{display:flex;align-items:center;gap:5px;font-weight:700;min-width:0}
.cm-name>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-name .ic{width:14px;height:14px;flex:none;color:var(--ok)}
.cm-name .cm-tm{color:var(--muted)}
.cm-prev{display:block;color:var(--muted);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-row.unread{box-shadow:none;border-inline-start:0;background:transparent}
.cm-newdiv{display:flex;align-items:center;gap:10px;margin:10px 0 6px;color:var(--accent);font-size:var(--fs-xs);font-weight:700}.cm-newdiv::before,.cm-newdiv::after{content:"";flex:1;height:1px;background:color-mix(in srgb,var(--accent) 35%,transparent)}
.cm-down{position:fixed;inset-inline-start:max(14px,calc(50% - var(--col)/2 + 14px));z-index:29;width:42px;height:42px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--text);box-shadow:var(--sh-2);display:grid;place-items:center;cursor:pointer}.cm-down svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.cm-row.unread .cm-prev{color:var(--text);font-weight:600}
.cm-side{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:12px;color:var(--muted);flex:none}
.cm-row.unread .cm-side>time{color:var(--accent);font-weight:700}
.cm-un{min-width:22px;height:22px;padding:0 7px;border-radius:11px;background:var(--accent);color:#fff;font-weight:700;display:grid;place-items:center;font-size:12px}
.cm-gav{position:relative;width:48px;height:48px;flex:none;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:18px;background:var(--grad)}
.cm-gav.lg{width:88px;height:88px;font-size:34px;margin:auto}
#cm-typ{display:contents}
.cm-req{border:1px solid var(--line);border-radius:18px;padding:12px;margin-bottom:10px;background:var(--card)}
.cm-req .cm-acts{display:flex;gap:8px;margin-top:10px}.cm-req .btn{flex:1;min-height:44px}
.cm-note{font-size:13px;color:var(--muted);line-height:1.7}
.cm-empty{text-align:center;padding:48px 16px;color:var(--muted)}
.cm-empty .ic{width:44px;height:44px;color:var(--accent);margin-bottom:8px}
body.cm-chat .bottomnav,body.cm-chat #fab{display:none!important}
body.cm-chat .topbar{display:none}
.cm-chat-head{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:6px;padding:6px 4px;background:color-mix(in srgb,var(--card) 95%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}
.cm-chat-head .who{flex:1;min-width:0;display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none;border-radius:12px;padding:2px 4px}
.cm-chat-head .who .av,.cm-chat-head .who .cm-gav{width:40px;height:40px;font-size:16px}
.cm-sub{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:4px}
.cm-sub .ic{width:12px;height:12px}
.cm-sub.typing{color:var(--accent);font-weight:650}
.cm-lockc{color:var(--ok)}
.cm-thread{max-width:var(--col);margin:auto;padding:8px 10px 8px;display:flex;flex-direction:column;min-height:calc(100vh - 140px)}
.cm-sys{align-self:center;max-width:88%;text-align:center;font-size:12.5px;color:var(--text-2);background:var(--bg-2);border-radius:12px;padding:6px 12px;margin:8px 0;line-height:1.6}
.cm-sys .ic{width:13px;height:13px;vertical-align:-2px}
.cm-e2ee{align-self:center;max-width:320px;text-align:center;font-size:12.5px;line-height:1.7;background:color-mix(in srgb,var(--warn) 14%,var(--card));color:var(--text);border-radius:14px;padding:10px 14px;margin:6px 0 10px}
.cm-e2ee a{color:var(--accent-ink);font-weight:700}
.cm-day{position:sticky;top:60px;z-index:5;align-self:center;font-size:12px;font-weight:700;color:var(--text-2);background:var(--card);box-shadow:var(--sh-1);border-radius:10px;padding:4px 12px;margin:12px 0 6px}
.cm-m{display:flex;flex-direction:column;align-items:flex-start;max-width:82%;margin-top:8px;position:relative}
.cm-m.me{align-self:flex-start}.cm-m.them{align-self:flex-end;align-items:flex-end}
.cm-m.cont{margin-top:2px}
.cm-m .cm-from{font-size:12px;font-weight:700;margin:0 12px 2px;color:var(--accent-ink)}
.cm-b{position:relative;padding:8px 12px 6px;border-radius:20px;line-height:1.6;word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap;box-shadow:var(--sh-1);cursor:default;max-width:100%;min-width:72px;-webkit-user-select:text;user-select:text}
.cm-m.me .cm-b{background:var(--accent);color:#fff;border-start-start-radius:20px}
.cm-m.them .cm-b{background:var(--card);color:var(--text)}
.cm-m.me:not(.last) .cm-b{border-end-start-radius:8px}.cm-m.me.cont .cm-b{border-start-start-radius:8px}
.cm-m.them:not(.last) .cm-b{border-end-end-radius:8px}.cm-m.them.cont .cm-b{border-start-end-radius:8px}
.cm-m.me.last .cm-b{border-end-start-radius:6px}.cm-m.them.last .cm-b{border-end-end-radius:6px}
.cm-b.del{background:transparent!important;color:var(--muted)!important;border:1px dashed var(--line-2);box-shadow:none;font-style:italic;font-size:14px}
.cm-b.del .cm-meta{opacity:1;color:var(--text-2,var(--text))}
.cm-meta{display:flex;align-items:center;gap:4px;justify-content:flex-end;font-size:11px;opacity:.85;margin-top:2px;white-space:nowrap;direction:rtl}
.cm-meta .ic{width:15px;height:15px}
.cm-m.me .cm-meta .rd{color:#bfffe6}
.cm-exp{display:inline-flex;align-items:center;gap:3px}
.cm-ring{width:11px;height:11px;opacity:.85;border-radius:50%;background:conic-gradient(currentColor calc(var(--p,0)*360deg),transparent 0);border:1.5px solid currentColor;box-sizing:border-box}
.cm-q{display:block;border-inline-start:3px solid currentColor;background:rgba(0,0,0,.08);border-radius:10px;padding:4px 8px;margin-bottom:6px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;color:inherit;text-align:start;width:100%;border-top:0;border-bottom:0;border-inline-end:0;font:inherit;font-size:13px}
.cm-m.them .cm-q{background:var(--bg-2);border-inline-start-color:var(--accent)}
.cm-q b{display:block;font-size:12px}
.cm-img{display:block;max-width:240px;width:100%;border-radius:14px;margin:-2px -6px 4px;cursor:zoom-in;background:var(--bg-2);aspect-ratio:var(--ar,4/3);object-fit:cover}
.cm-rx{display:flex;flex-wrap:wrap;gap:4px;margin:-6px 8px 0;position:relative;z-index:1}
.cm-chip{min-height:28px;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--text);padding:0 8px;font:inherit;font-size:13px;cursor:pointer;box-shadow:var(--sh-1)}
.cm-chip[aria-pressed=true]{border-color:var(--accent);background:var(--accent2)}
.cm-more{position:absolute;top:50%;transform:translateY(-50%);inset-inline-end:-40px;opacity:0;width:36px;height:36px;min-width:36px}
.cm-m.them .cm-more{inset-inline-end:auto;inset-inline-start:-40px}
.cm-m:hover .cm-more,.cm-more:focus-visible{opacity:1}
@media (hover:none){.cm-more{display:none}}
.cm-voice{display:flex;align-items:center;gap:8px;min-width:210px;padding:2px 0;white-space:normal}
.cm-play{width:38px;height:38px;min-width:38px;border-radius:50%;border:0;display:grid;place-items:center;cursor:pointer;background:rgba(255,255,255,.22);color:inherit}
.cm-m.them .cm-play{background:var(--accent);color:#fff}
.cm-play .ic{width:18px;height:18px}
.cm-wave{flex:1;display:flex;align-items:center;gap:2px;height:32px;cursor:pointer;direction:ltr}
.cm-wave i{flex:1;min-width:2px;border-radius:2px;background:currentColor;opacity:.4}
.cm-wave i.on{opacity:1}
.cm-vd{font-size:11px;min-width:32px;font-variant-numeric:tabular-nums}
.cm-typing{align-self:flex-end;background:var(--card);border-radius:18px;padding:12px 14px;margin-top:8px;display:flex;gap:4px;box-shadow:var(--sh-1)}
.cm-typing i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:cmDot 1.2s infinite}
.cm-typing i:nth-child(2){animation-delay:.15s}.cm-typing i:nth-child(3){animation-delay:.3s}
@keyframes cmDot{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}
.cm-reqbar{max-width:var(--col);margin:8px auto;padding:12px;border-radius:16px;background:var(--card);box-shadow:var(--sh-2);text-align:center}
.cm-reqbar .cm-acts{display:flex;gap:8px;margin-top:10px}.cm-reqbar .btn{flex:1;min-height:44px}
.cm-comp{position:fixed;bottom:0;inset-inline:0;z-index:30;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:var(--glass);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-top:1px solid var(--line)}
.cm-comp>div{max-width:var(--col);margin:auto}
.cm-row2{display:flex;align-items:flex-end;gap:6px}
.cm-ta{flex:1;min-height:44px;max-height:140px;resize:none;border-radius:22px;border:1px solid var(--line-2);background:var(--card);color:var(--text);padding:10px 16px;font:inherit;line-height:1.5}
.cm-ta:focus{outline:2px solid var(--accent);outline-offset:0;border-color:transparent}
.cm-sendb{background:var(--accent);color:#fff}.cm-sendb:hover{background:var(--accent-ink)}
.cm-sendb .ic{transform:scaleX(-1)}
[dir=ltr] .cm-sendb .ic{transform:none}
.cm-pre{display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:6px;border-radius:14px;background:var(--bg-2);font-size:13px;min-width:0}
.cm-pre .cm-mid{border-inline-start:3px solid var(--accent);padding-inline-start:8px}
.cm-pre img{width:56px;height:56px;border-radius:10px;object-fit:cover}
.cm-rec{display:flex;align-items:center;gap:8px;min-height:44px}
.cm-rec .dot{width:10px;height:10px;border-radius:50%;background:var(--danger);animation:cmPulse 1s infinite}
@keyframes cmPulse{50%{opacity:.25}}
.cm-rec .cm-wave{color:var(--danger);height:28px}
.cm-rec .t{font-variant-numeric:tabular-nums;min-width:40px;font-weight:700}
.cm-drop{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 22%,transparent);backdrop-filter:blur(4px);pointer-events:none}
.cm-drop div{background:var(--card);border:2px dashed var(--accent);border-radius:24px;padding:28px 36px;font-weight:800;color:var(--accent-ink);box-shadow:var(--sh-3)}
.cm-pick{display:flex;gap:6px;justify-content:space-between;padding:4px 0 12px;border-bottom:1px solid var(--line);margin-bottom:6px}
.cm-pick button{width:44px;height:44px;border-radius:50%;border:0;background:var(--bg-2);font-size:24px;cursor:pointer;transition:transform .15s var(--spring)}
.cm-pick button:hover,.cm-pick button:focus-visible{transform:scale(1.15);outline:2px solid var(--accent)}
.cm-pick button[aria-pressed=true]{background:var(--accent2);box-shadow:inset 0 0 0 2px var(--accent)}
.cm-sec{background:var(--card);border-radius:20px;padding:6px 14px;margin:12px 0;box-shadow:var(--sh-1)}
.cm-sec h3{font-size:13px;color:var(--muted);margin:10px 0 4px;font-weight:700}
.cm-li{display:flex;align-items:center;gap:12px;min-height:56px;padding:6px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none;width:100%;background:none;border-inline:0;border-bottom:0;font:inherit;text-align:start;cursor:pointer}
.cm-sec h3+.cm-li,.cm-sec>.cm-li:first-child{border-top:0}
.cm-li>.ic{width:22px;height:22px;color:var(--accent);flex:none}
.cm-li .cm-mid small{display:block;color:var(--muted);font-size:12.5px}
.cm-li.danger,.cm-li.danger>.ic{color:var(--danger)}
.cm-hero{text-align:center;padding:18px 0 4px}
.cm-hero h2{margin:10px 0 2px}
.cm-hero .av{width:88px;height:88px;font-size:34px;margin:auto}
.cm-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;border-radius:10px;padding:2px 8px;background:var(--bg-2);color:var(--text-2)}
.cm-badge.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:color-mix(in srgb,var(--ok-ink) 80%,var(--text))}
.cm-badge .ic{width:13px;height:13px}
.cm-radio{display:flex;align-items:center;gap:10px;min-height:48px;border-top:1px solid var(--line);cursor:pointer}
.cm-radio input{width:20px;height:20px;accent-color:var(--accent)}
.cm-code{direction:ltr;display:grid;grid-template-columns:repeat(4,1fr);gap:10px 8px;font:700 19px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;letter-spacing:.06em;padding:16px 8px;color:var(--text)}
.cm-qr{width:200px;height:200px;margin:8px auto;background:#fff;border-radius:16px;padding:8px;display:grid;place-items:center}
.cm-qr svg{width:100%;height:100%}
.cm-warn{border:1px solid var(--warn);background:color-mix(in srgb,var(--warn) 12%,var(--card));border-radius:16px;padding:12px;margin:10px 0;font-size:14px;line-height:1.7}
.cm-step{display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-top:1px solid var(--line)}
.cm-step:first-of-type{border-top:0}
.cm-step .n{width:40px;height:40px;flex:none;border-radius:12px;background:var(--accent2);color:var(--accent-ink);display:grid;place-items:center}
.cm-step .n .ic{width:22px;height:22px}
.cm-step p{margin:2px 0 0;color:var(--text-2);line-height:1.75;font-size:14.5px}
.cm-sel{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.cm-sel button{min-height:36px;border-radius:18px;border:0;background:var(--accent2);color:var(--accent-ink);padding:0 12px;font:inherit;font-weight:650;cursor:pointer}
.cm-ck{width:24px;height:24px;border-radius:50%;border:2px solid var(--line-2);display:grid;place-items:center;flex:none}
.cm-ck.on{background:var(--accent);border-color:var(--accent);color:#fff}.cm-ck .ic{width:14px;height:14px}
.cm-field{width:100%;min-height:48px;border-radius:14px;border:1px solid var(--line-2);background:var(--card);color:var(--text);padding:0 14px;font:inherit;font-size:16px}
.cm-sticky{position:sticky;bottom:0;padding:10px 0 calc(10px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 30%)}
.cm-flash{animation:cmFlash 1.2s}
@keyframes cmFlash{30%{box-shadow:0 0 0 4px var(--accent)}}
.cm-m.gone{transition:opacity .4s,transform .4s;opacity:0;transform:scale(.9)}
/* v2.55 — messages in the new card language */
.cm-head{padding:14px 0 10px;gap:6px}
.cm-head h2{font-size:var(--fs-3xl,28px);font-weight:800;letter-spacing:-.01em;line-height:1.3}
.cm-head .cm-act{background:var(--accent-soft);color:var(--accent-ink);border-radius:14px}
.cm-head .cm-act:hover{background:var(--accent2)}
.cm-head .cm-act .ic{width:20px;height:20px}
.cm-search{border-radius:var(--r-pill,999px);border-color:var(--card-bd,var(--line-2));padding-inline:16px}
.cm-list{background:var(--card);border:1px solid var(--card-bd,var(--line));border-radius:20px;box-shadow:var(--sh-1);padding:4px;overflow:hidden}
.cm-list>.cm-row{border-radius:16px;position:relative;padding:10px 12px}
.cm-list>.cm-row+.cm-row::before{content:"";position:absolute;top:0;inset-inline:76px 12px;border-top:1px solid var(--line)}
.cm-row .av,.cm-row .cm-gav{width:52px;height:52px;border-radius:16px}
.cm-row.unread .cm-name>span{color:var(--text)}
.cm-row.unread .cm-un{box-shadow:0 0 0 3px var(--card)}
.cm-req{border-color:var(--card-bd,var(--line));box-shadow:var(--sh-1);border-radius:20px}
.cm-empty .ic{width:28px;height:28px;margin:0;color:var(--accent)}
.cm-empty .cm-eic{width:64px;height:64px;border-radius:20px;margin:0 auto 14px;display:grid;place-items:center;background:var(--accent-soft)}
.cm-empty b{display:block;color:var(--text);font-size:var(--fs-lg,18px);margin-bottom:4px}
.cm-empty p{margin:0 0 16px}
.cm-wrap>.cm-li{background:var(--card);border:1px solid var(--card-bd,var(--line));border-radius:20px;box-shadow:var(--sh-1);padding:10px 14px;margin-top:16px}
.cm-li>.ic{width:36px;height:36px;padding:8px;border-radius:12px;background:var(--accent-soft);color:var(--accent-ink);box-sizing:border-box}
.cm-li.danger>.ic{background:var(--danger-soft,var(--bg-2))}
.cm-li .cm-mid{font-weight:600}
.cm-li .cm-mid small{font-weight:400}
.cm-sec{border:1px solid var(--card-bd,var(--line))}
.cm-m.me .cm-b{background:linear-gradient(135deg,var(--brand-1),color-mix(in srgb,var(--brand-1) 82%,var(--brand-2)))}
.cm-m.them .cm-b{border:1px solid var(--card-bd,var(--line));box-shadow:none}
.cm-chat-head{padding:8px 6px;gap:4px}
.cm-chat-head .who .av,.cm-chat-head .who .cm-gav{width:42px;height:42px;border-radius:14px}
.cm-chat-head .who b,.cm-chat-head .who strong{font-size:16px}
.cm-chat-head .cm-ib{color:var(--accent-ink);width:40px;min-width:40px}
.cm-chat-head .cm-ib:first-child{color:var(--text)}
.cm-day{box-shadow:none;border:1px solid var(--card-bd,var(--line));border-radius:var(--r-pill,999px);color:var(--muted)}
.cm-ta{border-color:var(--card-bd,var(--line-2));background:var(--bg-2)}
.cm-comp .cm-ib:not(.cm-sendb){color:var(--accent-ink)}
/* v2.134 «الذكاء في الرسائل» */
.ai-sp{width:22px;height:22px;flex:none}
.cm-comp .cm-ib.ai-ib{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
.cm-comp .cm-ib.ai-ib[aria-expanded=true]{background:var(--accent);color:var(--on-accent)}
.cm-comp .cm-ib.ai-ib[aria-expanded=true]{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
.ai-pill{position:fixed;inset-inline:0;z-index:31;display:flex;justify-content:center;pointer-events:none;bottom:calc(76px + env(safe-area-inset-bottom))}
.ai-pill>div{pointer-events:auto;display:inline-flex;align-items:center;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);background:var(--card);box-shadow:var(--sh-1)}
.ai-pill button{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 6px 0 14px;border:0;background:none;color:var(--accent-ink);font:600 14px/1.2 inherit;cursor:pointer}
.ai-pill .ai-x{padding:0 12px;color:var(--muted);font-weight:400;font-size:var(--fs-lg)}
.ai-pill .ai-sp{width:18px;height:18px;color:var(--accent)}
.ai-pill small{color:var(--muted);font-weight:500}
.ai-h{display:flex;align-items:center;gap:8px;font-weight:700;font-size:var(--fs-lg);margin:0 0 4px}
.ai-h .ai-sp{color:var(--accent)}
.ai-sub{color:var(--muted);font-size:var(--fs-sm);margin:0 0 12px}
.ai-pt{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:start;padding:11px 12px;border-radius:14px;background:var(--bg-2);border:0;color:var(--text);margin-bottom:8px;font:inherit;font-size:var(--fs-md);line-height:1.6;cursor:pointer}
.ai-pt.todo,.ai-pt.question{background:color-mix(in srgb,var(--accent) 12%,var(--bg-2))}
.ai-pt b{color:var(--accent-ink)}
.ai-pt .go{margin-inline-start:auto;color:var(--muted);font-size:var(--fs-xs);white-space:nowrap;padding-top:3px}
.ai-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:9px;flex:none}
.ai-row{display:flex;gap:8px;margin-top:12px}
.ai-btn{flex:1;min-height:46px;border-radius:14px;border:0;font:inherit;font-weight:600;font-size:var(--fs-md);background:var(--accent);color:var(--on-accent);cursor:pointer}
.ai-btn.ghost{background:var(--bg-2);color:var(--text)}
.ai-note{font-size:var(--fs-xs);color:var(--muted);text-align:center;margin:10px 0 0}
.ai-risk{display:flex;gap:6px;align-items:flex-start;margin-top:6px;padding:8px 10px;border-radius:12px;background:var(--danger-soft);color:var(--danger-ink);font-size:var(--fs-sm);line-height:1.5}.ai-risk .ei{flex:none;margin-top:2px}.ai-risk button{border:0;background:none;color:inherit;font:inherit;font-weight:700;text-decoration:underline;cursor:pointer;padding:0 2px}
.ai-it{display:flex;gap:8px;align-items:center;padding:10px 12px;border-radius:14px;background:var(--bg-2);margin-bottom:8px}.ai-it>div{flex:1;min-width:0}.ai-it small{display:block;color:var(--muted);font-size:var(--fs-xs)}.ai-it .ai-chip{flex:none}
.ai-load{display:flex;flex-direction:column;gap:8px;margin:6px 0}.ai-load i{height:44px;border-radius:14px;background:var(--bg-2);animation:cmPulse 1.4s infinite}
.ai-panel{display:flex;flex-direction:column;gap:8px;padding:2px 2px 8px}
.ai-sugg{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ai-sugg .lbl{display:inline-flex;align-items:center;gap:4px;color:var(--accent);font-size:var(--fs-sm);font-weight:600;white-space:nowrap}
.ai-sugg .lbl .ai-sp{width:16px;height:16px}
.ai-chip{white-space:nowrap;min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid var(--line-2);background:var(--card);color:var(--text);font:500 14px inherit;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.ai-chip:disabled{opacity:.55}
.ai-tone .ai-chip{min-height:32px;padding:4px 12px;font-size:var(--fs-sm);color:var(--accent-ink);border-color:color-mix(in srgb,var(--accent) 30%,transparent);background:color-mix(in srgb,var(--accent) 8%,var(--card))}
.ai-chip.sk{width:150px;color:transparent;animation:cmPulse 1.4s infinite;background:var(--bg-2);border-color:transparent}
.ai-ib:focus-visible,.ai-chip:focus-visible,.ai-pt:focus-visible,.ai-pill button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.ai-load i,.ai-chip.sk{animation:none}}
@media (min-width:760px){body.cm-chat .topbar{display:flex}.cm-comp{inset-inline:max(96px,calc(50% - 310px)) auto;width:var(--col)}}
@media (min-width:1180px){.cm-comp{inset-inline-start:var(--cx)}}
body.cm-chat{padding-bottom:calc(var(--cm-comp-h,72px) + 12px)!important}
@media (prefers-reduced-motion:reduce){.cm-typing i,.cm-rec .dot{animation:none}.cm-m.gone{transition:none}.cm-flash{animation:none;outline:2px solid var(--accent)}.cm-pick button{transition:none}}
@media (forced-colors:active){.cm-b{border:1px solid CanvasText}.cm-tab[aria-selected=true]{outline:2px solid Highlight}}
`;
  (function injectCss() { if (document.getElementById("cm-css")) return; const s = document.createElement("style"); s.id = "cm-css"; s.textContent = STYLE; document.head.appendChild(s); })();
  if (!document.getElementById("cm-live")) document.body.insertAdjacentHTML("beforeend", `<div id="cm-live" role="status" aria-live="polite"></div>`);

  /* ---------- state ---------- */
  const ST = { convs: null, people: {}, msgs: {}, info: {}, reads: {}, typing: {}, more: {}, plain: {} };
  const person = (id) => ST.people[id] || (typeof S !== "undefined" && S.user(id)) || { id, name: "مستخدم", handle: "", color: "#888" };
  const addPeople = (list) => (list || []).forEach(p => (ST.people[p.id] = p));
  const convTitle = (c) => c.kind === "group" ? (c.title || "مجموعة") : person(c.peer || (c.members || []).find(x => x !== DB.me)).name;
  const groupAv = (c, cls = "") => { const t = (c.title || "م").trim(); return `<span class="cm-gav ${cls}" aria-hidden="true">${h(t[0])}</span>`; };
  const convAv = (c, cls = "") => c.kind === "group" ? groupAv(c, cls) : av(person(c.peer || (c.members || []).find(x => x !== DB.me)), cls);

  /* ---------- crypto bridge (comms-core.js, window.MPComms) ---------- */
  const coreConv = (c) => ({ id: c.id, kind: c.kind, e2ee: !!c.e2ee, members: (c.members || []).map(m => m.user || m) });
  async function plain(m) {
    if (!m || m.deleted || !m.enc) return m;
    if (ST.plain[m.id]) return { ...m, ...ST.plain[m.id] };
    const core = MC(); if (!core?.open) return { ...m, locked: "no-core" };
    const o = await core.open(m, m.conv);
    if (o.error) return { ...m, locked: o.error };
    const p = { text: o.text, meta: o.meta, kind: o.kind, file: o.file, reply: o.reply || m.reply, encrypted: true }; ST.plain[m.id] = p; return { ...m, ...p };
  }
  const urls = {};
  async function blobSrc(m) {
    const core = MC(); if (!m.meta?.blob) return null;
    if (urls[m.id]) return urls[m.id];
    if (core?.attachmentUrl) { try { return (urls[m.id] = await core.attachmentUrl(m)); } catch { return null; } }
    return m.enc ? null : "/api/chat/blobs/" + m.meta.blob;
  }
  async function sendMsg(c, body) {
    const core = MC();
    if (core?.send) return core.send(coreConv(c), body); // uploads + encrypts as needed
    if (c.e2ee) throw new Error("هذه المحادثة مشفرة: افتحها من جهاز فُعّل عليه التشفير");
    let meta = body.meta;
    if (body.file) { const r = await api("POST", `/api/chat/conversations/${c.id}/blobs`, null, body.file); meta = { ...meta, blob: r.blob.id, mime: r.blob.mime }; }
    return (await api("POST", `/api/chat/conversations/${c.id}/messages`, { id: body.id, kind: body.kind, text: body.text, replyTo: body.replyTo, meta })).message;
  }
  const emitTyping = (cid, on) => { const core = MC(); if (core?.typing) return core.typing(cid, on); api("POST", `/api/chat/conversations/${cid}/typing`, { on }).catch(() => { }); };
  const E2 = () => MC()?.e2ee || null;
  const myDevice = () => E2()?.thisDevice?.()?.id || null;

  /* ---------- realtime ---------- */
  let esBound = null;
  function bindStream() {
    kick(); const core = MC();
    if (core?.on) { if (!core.__cmBound) { core.__cmBound = true; core.on("chat", onChat); core.on("typing", onTyping); } return; } // core covers WS + SSE
    const es = Remote.es; if (!es || es === esBound) return; esBound = es;
    es.addEventListener("chat", (e) => { try { onChat(JSON.parse(e.data)); } catch { } });
    es.addEventListener("typing", (e) => { try { onTyping(JSON.parse(e.data)); } catch { } });
  }
  const seen = new Set();
  function onChat(d) {
    if (!d) return;
    if (d.type === "message" && d.message) { const k = "m" + d.message.id; if (seen.has(k)) return; seen.add(k); }
    const cur = curConv();
    if (d.type === "message") {
      const m = d.message, arr = ST.msgs[m.conv]; if (arr && !arr.some(x => x.id === m.id)) arr.push(m);
      ST.typing[m.conv] = {}; if (cur === m.conv) { paintThread(true); markRead(m.conv); if (document.hidden) live("رسالة جديدة"); } else refreshList();
    } else if (d.type === "reaction") { const m = (ST.msgs[d.conv] || []).find(x => x.id === d.msg); if (m) { m.reactions = d.reactions; if (cur === d.conv) paintThread(); } }
    else if (d.type === "delete") { const m = (ST.msgs[d.conv] || []).find(x => x.id === d.msg); if (m) { Object.assign(m, { deleted: true, text: "", meta: null, enc: null, reactions: [] }); if (cur === d.conv) paintThread(); } refreshList(); }
    else if (d.type === "expired") { if (ST.msgs[d.conv]) ST.msgs[d.conv] = ST.msgs[d.conv].filter(x => !d.msgs.includes(x.id)); if (cur === d.conv) paintThread(); refreshList(); }
    else if (d.type === "read") { (ST.reads[d.conv] ||= {})[d.user] = d.at; if (cur === d.conv) paintThread(); }
    else if (d.type === "conv" || d.type === "keys") { delete ST.info[d.conv]; if (cur && (cur === d.conv || d.type === "keys")) loadInfo(cur).then(() => { paintHead(); paintThread(); }).catch(() => { }); refreshList(); }
  }
  function onTyping(d) {
    if (!d?.conv) return; const t = (ST.typing[d.conv] ||= {});
    clearTimeout(t["_" + d.user]); if (d.on) { t[d.user] = 1; t["_" + d.user] = setTimeout(() => { delete t[d.user]; if (curConv() === d.conv) { paintHead(); paintTyping(); } }, 6000); } else delete t[d.user];
    if (curConv() === d.conv) { paintHead(); paintTyping(); }
  }
  const curConv = () => { const [r, a] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/"); return r === "chat" ? a : null; };
  let listTimer = 0; const refreshList = () => { clearTimeout(listTimer); listTimer = setTimeout(async () => { await loadList().catch(() => { }); badge(); if (location.hash.startsWith("#/messages")) listView(true); }, 250); };

  /* ---------- data ---------- */
  async function loadList() { const r = await api("GET", "/api/chat/conversations"); addPeople(r.people); ST.convs = r.conversations; return r.conversations; }
  async function loadInfo(cid) { const r = await api("GET", `/api/chat/conversations/${cid}`); addPeople(r.people); ST.info[cid] = r.conversation; const rd = (ST.reads[cid] ||= {}); r.conversation.members.forEach(m => { if (m.user !== DB.me && m.lastReadAt) rd[m.user] = m.lastReadAt; }); return r.conversation; }
  async function loadMsgs(cid, before) {
    const r = await api("GET", `/api/chat/conversations/${cid}/messages${before ? "?before=" + encodeURIComponent(before) : ""}`);
    ST.reads[cid] = { ...(ST.reads[cid] || {}), ...Object.fromEntries(Object.entries(r.reads || {}).filter(([, v]) => v)) };
    ST.more[cid] = r.more; ST.msgs[cid] = before ? [...r.messages, ...(ST.msgs[cid] || [])] : r.messages; ST.state = r.state; return r;
  }
  let readT = 0; function markRead(cid) { clearTimeout(readT); readT = setTimeout(() => { if (document.hidden) return; const core = MC(); (core?.markRead ? Promise.resolve(core.markRead(cid)) : api("POST", `/api/chat/conversations/${cid}/read`)).catch(() => { }); const c = ST.convs?.find(x => x.id === cid); if (c) { c.unread = 0; badge(); } }, 400); }
  function badge() {
    if (!ST.convs) return; const mb = document.getElementById("msgBadge"); if (!mb) return;
    const n = ST.convs.reduce((a, c) => a + (c.state === "request" ? 0 : c.unread || 0), 0) + ST.convs.filter(c => c.state === "request").length;
    mb.textContent = n > 99 ? "99+" : n || ""; mb.classList.toggle("on", n > 0); mb.setAttribute("aria-label", n ? `${n} غير مقروءة` : "");
  }

  /* ---------- previews ---------- */
  function previewText(m, c) {
    if (!m) return "ابدأ المحادثة";
    const who = m.from === DB.me ? "أنت: " : c.kind === "group" && m.kind !== "system" ? person(m.from).name.split(" ")[0] + ": " : "";
    if (m.deleted) return who + "حُذفت هذه الرسالة";
    if (m.kind === "system") return sysText(m);
    if (m.enc && !ST.plain[m.id]) return who + (m.kind === "voice" ? "رسالة صوتية" : m.kind === "image" ? "صورة" : "رسالة مشفرة");
    const p = ST.plain[m.id] || m;
    return who + (m.kind === "voice" ? "رسالة صوتية" : m.kind === "image" ? "صورة" + (p.text ? " · " + p.text : "") : p.text);
  }
  function sysText(m) {
    const ev = m.meta?.event || m.text, me = m.from === DB.me, by = me ? "أنت" : person(m.from).name, names = (m.meta?.users || []).map(u => u === DB.me ? "أنت" : person(u).name).join("، ");
    return { created: `${by} أنشأ المجموعة «${m.meta?.title || ""}»`, added: `${by} أضاف ${names}`, removed: `${by} أزال ${names}`, left: `${names} غادر المجموعة`, title: `${by} غيّر الاسم إلى «${m.meta?.title || ""}»`,
      ttl: +m.meta?.ttl ? `${by} فعّل الرسائل المؤقتة: تختفي بعد ${ttlName(m.meta.ttl)}` : `${by} أوقف الرسائل المؤقتة`, e2ee: `${by} فعّل التشفير التام بين الطرفين` }[ev] || "تحديث في المحادثة";
  }

  /* =========================== conversation list =========================== */
  async function listView(re) {
    leaveChat();
    const tab = new URLSearchParams(location.hash.split("?")[1] || "").get("tab") === "requests" ? "requests" : "all";
    if (!re) view.innerHTML = `<div class="cm-wrap"><div class="cm-head"><h2>الرسائل</h2></div><div class="skel"></div><div class="skel"></div></div>`;
    bindStream(); E2()?.ready().catch(() => { });
    try { await loadList(); } catch (e) { if (!ST.convs) { view.innerHTML = `<div class="cm-wrap"><div class="empty err" role="alert">${ic("offline")}<span class="empty-t">تعذّر تحميل الرسائل</span><span class="empty-x">${h(e.message || "")}</span><button class="btn" id="cm-retry">إعادة المحاولة</button></div></div>`; $("#cm-retry").onclick = () => listView(); return; } }
    badge();
    const q = view._cmq || "";
    await Promise.all(ST.convs.map(c => c.last?.enc ? plain(c.last) : null));
    const reqs = ST.convs.filter(c => c.state === "request"), chats = ST.convs.filter(c => c.state !== "request");
    const match = (c) => !q || convTitle(c).includes(q) || (c.kind !== "group" && person(c.peer).handle?.includes(q));
    const row = (c) => {
      const u = c.unread > 0, t = convTitle(c);
      return `<a class="cm-row ${u ? "unread" : ""}" href="#/chat/${c.id}" aria-label="${h(t)}${c.e2ee ? "، مشفرة" : ""}${u ? `، ${c.unread} غير مقروءة` : ""}">
        ${convAv(c).replace(/^<a /, "<span ").replace(/<\/a>$/, "</span>").replace(/ href="[^"]*"/, "")}
        <span class="cm-mid"><span class="cm-name"><span>${h(t)}</span>${c.e2ee ? `<span class="cm-lockc" title="مشفرة طرفاً لطرف">${ic("lock")}</span>` : ""}${c.ttl ? `<span class="cm-tm" title="رسائل مؤقتة: ${ttlName(c.ttl)}">${ic("cmTimer")}</span>` : ""}</span>
        <span class="cm-prev" dir="auto">${h(previewText(c.last, c))}</span></span>
        <span class="cm-side"><time datetime="${h(c.last?.at || c.updatedAt)}">${h(listTime(c.last?.at || c.updatedAt))}</time>${u ? `<span class="cm-un" aria-hidden="true">${c.unread > 99 ? "99+" : c.unread}</span>` : ""}</span></a>`;
    };
    const reqCard = (c) => { const p = person(c.peer); return `<div class="cm-req" role="group" aria-label="طلب من ${h(p.name)}">
      <a class="u-p0 u-mh0 cm-row" href="#/chat/${c.id}">${av(p).replace(/^<a /, "<span ").replace(/<\/a>$/, "</span>").replace(/ href="[^"]*"/, "")}<span class="cm-mid"><span class="cm-name"><span>${h(p.name)}</span></span><span class="cm-prev">@${h(p.handle)} · ${h(previewText(c.last, c))}</span></span></a>
      <div class="cm-acts"><button class="btn" data-acc="${c.id}">قبول</button><button class="btn ghost" data-dec="${c.id}">حذف</button></div></div>`; };
    const body = tab === "requests"
      ? `<p class="cm-note">${ic("shield", "sm")} رسائل من أشخاص لا تتابعهم. لن يعرفوا أنك قرأتها حتى تقبل، ولن تصلك منهم إشعارات.</p>${reqs.filter(match).map(reqCard).join("") || `<div class="cm-empty"><span class="cm-eic">${ic("mail")}</span><div><b>لا طلبات رسائل</b></div><p>تصل هنا رسائل من أشخاص لا تتابعهم.</p></div>`}`
      : ((chats.filter(match).length ? `<div class="cm-list">${chats.filter(match).map(row).join("")}</div>` : "") || `<div class="cm-empty"><span class="cm-eic">${ic("mail")}</span><div><b>${q ? "لا نتائج" : "لا محادثات بعد"}</b></div><p>${q ? "جرّب اسماً أو معرّفاً آخر." : "ابدأ محادثة خاصة أو أنشئ مجموعة."}</p>${q ? "" : `<button class="btn" id="cm-new2">رسالة جديدة</button>`}</div>`);
    view.innerHTML = `<div class="cm-wrap">
      <div class="cm-head"><h2>الرسائل</h2>
        <a class="cm-ib cm-act" href="#/devices" aria-label="الأجهزة المرتبطة" title="الأجهزة المرتبطة">${ic("cmDevice")}</a>
        <a class="cm-ib cm-act" href="#/newgroup" aria-label="مجموعة جديدة" title="مجموعة جديدة">${ic("cmGroup")}</a>
        <button class="cm-ib cm-act" id="cm-new" aria-label="رسالة جديدة" title="رسالة جديدة">${ic("pen")}</button></div>
      <input class="cm-search" id="cm-q" type="search" placeholder="ابحث في المحادثات" aria-label="ابحث في المحادثات" value="${h(q)}">
      <div class="cm-tabs" role="tablist" aria-label="نوع المحادثات">
        <button class="cm-tab" role="tab" aria-selected="${tab === "all"}" data-tab="all">المحادثات</button>
        <button class="cm-tab" role="tab" aria-selected="${tab === "requests"}" data-tab="requests">الطلبات${reqs.length ? `<span class="n">${reqs.length}</span>` : ""}</button></div>
      <div role="tabpanel" id="cm-body">${body}</div>
      <a class="u-mt12 cm-li" href="#/e2ee">${ic("lock")}<span class="cm-mid">محادثاتك الخاصة يمكن تشفيرها تماماً<small>كيف يعمل التشفير طرفاً لطرف؟</small></span></a></div>`;
    const qi = $("#cm-q"); qi.oninput = () => { view._cmq = qi.value.trim(); clearTimeout(qi._t); qi._t = setTimeout(() => { const pos = qi.selectionStart; listView(true).then(() => { const n = $("#cm-q"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); }, 200); };
    view.querySelectorAll("[data-tab]").forEach(b => { b.onclick = () => { location.hash = "#/messages" + (b.dataset.tab === "requests" ? "?tab=requests" : ""); }; b.onkeydown = (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { const o = view.querySelector(`[data-tab]:not([data-tab="${b.dataset.tab}"])`); o.focus(); o.click(); } }; });
    $("#cm-new").onclick = newDm; const n2 = $("#cm-new2"); if (n2) n2.onclick = newDm;
    // v2.130 search stage 7: words inside your messages (server searches only your own non-encrypted conversations)
    if (q.length >= 2 && tab !== "requests") api("GET", "/api/chat/search?q=" + encodeURIComponent(q)).then((r) => {
      const box = $("#cm-body"); if (!box || view._cmq !== q || !r.results?.length) return;
      const empty = box.querySelector(".cm-empty"); if (empty) empty.remove();
      box.insertAdjacentHTML("beforeend", `<section class="cm-msr" aria-label="في الرسائل"><h3 class="cm-msr-h">في الرسائل <span class="muted">${UI.num(r.results.length)}</span></h3>${r.results.map((m) => {
        const c = ST.convs.find((x) => x.id === m.conv), t = c ? convTitle(c) : (m.title || m.sender?.name || "");
        return `<a class="cm-row" href="#/chat/${h(m.conv)}"><span class="cm-mid"><span class="cm-name"><span>${h(t)}</span></span><span class="cm-prev" dir="auto"><b>${h(m.sender?.name || "")}:</b> ${h(m.text)}</span></span><span class="cm-side"><time datetime="${h(m.createdAt)}">${h(listTime(m.createdAt))}</time></span></a>`;
      }).join("")}</section>`);
    }).catch(() => { });
    view.querySelectorAll("[data-acc]").forEach(b => b.onclick = async () => { try { await api("POST", `/api/conversations/${b.dataset.acc}/accept`); toast("قُبل الطلب"); location.hash = "#/chat/" + b.dataset.acc; } catch (e) { errToast(e); } });
    view.querySelectorAll("[data-dec]").forEach(b => b.onclick = async () => { if (!confirm("حذف طلب المراسلة؟ لن يُبلَّغ المرسل.")) return; try { await api("POST", `/api/conversations/${b.dataset.dec}/decline`); ST.convs = ST.convs.filter(c => c.id !== b.dataset.dec); live("حُذف الطلب"); listView(true); } catch (e) { errToast(e); } });
  }

  function newDm() {
    const cands = DB.users.filter(u => u.id !== DB.me && !(DB.blocked || []).includes(u.id));
    const s = sheet(`<h4 id="cm-ndh">رسالة جديدة</h4><input class="cm-search" id="cm-nq" type="search" placeholder="ابحث عن شخص" aria-label="ابحث عن شخص"><div class="menu" id="cm-nl" role="list" aria-labelledby="cm-ndh"></div>`);
    let seq = 0;
    const paint = (q, extra = [], busy = false) => {
      const ql = q.toLowerCase(), seen = new Set(), list = [...cands.filter(u => !q || u.name.toLowerCase().includes(ql) || u.handle.toLowerCase().includes(ql)), ...extra].filter(u => u.id !== DB.me && !seen.has(u.id) && seen.add(u.id)).slice(0, 40);
      s.querySelector("#cm-nl").innerHTML = list.map(u => `<button data-u="${u.id}" role="listitem">${h(u.name)} <span class="muted">@${h(u.handle)}</span></button>`).join("")
        || `<div class="cm-empty">${busy ? "جارٍ البحث…" : q ? "ما لقينا أحد بهذا الاسم" : "اكتب اسم الشخص أو معرّفه"}</div>`;
      s.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { if (!DB.users.some(x => x.id === b.dataset.u)) { const u = list.find(x => x.id === b.dataset.u); if (u) addPeople([u]); } openDm(b.dataset.u); });
    };
    const find = async (q) => {
      const my = ++seq; paint(q, [], q.length >= 2);
      if (q.length < 2) return;
      try { const r = await api("GET", "/api/search/suggest?q=" + encodeURIComponent(q)); if (my === seq) paint(q, (r.people || []).filter(u => !(DB.blocked || []).includes(u.id))); } catch { if (my === seq) paint(q); }
    };
    paint(""); const qi = s.querySelector("#cm-nq"); let t = 0; qi.oninput = () => { clearTimeout(t); t = setTimeout(() => find(qi.value.trim()), 220); }; setTimeout(() => qi.focus(), 50);
  }
  async function openDm(uid) {
    try { const core = MC(); const id = core?.openDM ? (await core.openDM(uid)).id : (await api("POST", "/api/conversations", { user: uid })).conversation.id; closeSheet(); location.hash = "#/chat/" + id; }
    catch (e) { errToast(e); }
  }

  /* =========================== conversation =========================== */
  let ctx = null; // { cid, conv, reply, img, rec, timers }
  function leaveChat() {
    document.body.classList.remove("cm-chat");
    if (ctx) { clearInterval(ctx.tick); ctx.rec?.cancel?.(); if (ctx.typingOn) emitTyping(ctx.cid, false); if (ctx.img?.url) URL.revokeObjectURL(ctx.img.url); (ctx.audio || []).forEach(a => a.pause()); }
    ctx = null;
  }
  async function chatView(cid) {
    if (ctx?.cid === cid && document.getElementById("cm-thread")) { paintHead(); paintThread(); return; }
    leaveChat();
    const mine = ctx = { cid, reply: null, img: null, rec: null, audio: [] };
    try { const dk = "mp-chat-draft:" + cid, dv = sessionStorage.getItem(dk); if (dv) { sessionStorage.removeItem(dk); mine.draft = dv.slice(0, 4000); } } catch { /* v2.76: a draft handed over from a Vidtik «اسأل البائع» tap; none in private mode */ }
    document.body.classList.add("cm-chat");
    view.innerHTML = `<div class="cm-chat-head" id="cm-ch"><a class="cm-ib" href="#/messages" aria-label="رجوع إلى الرسائل">${ic("cmBack")}</a><div class="who"><div class="skel" style="height:40px;flex:1;margin:0"></div></div></div><div class="cm-thread" id="cm-thread" role="log" aria-live="polite" aria-relevant="additions" aria-label="الرسائل"><div class="skel"></div><div class="skel"></div></div>`;
    bindStream();
    try { await Promise.all([loadInfo(cid), loadMsgs(cid)]); }
    catch (e) {
      // a conversation created offline (legacy client) may not exist on the server yet: open it by peer
      const loc = (DB.conversations || []).find(c => c.id === cid), peer = loc?.members?.find(x => x !== DB.me);
      if (e.status === 404 && peer) { try { const r = await api("POST", "/api/conversations", { id: cid, user: peer }); if (r.conversation.id !== cid) { location.replace("#/chat/" + r.conversation.id); return; } await Promise.all([loadInfo(cid), loadMsgs(cid)]); } catch (e2) { return chatFail(e2); } }
      else return chatFail(e);
    }
    if (ctx !== mine) return; // a newer render of this route took over
    ctx.conv = ST.info[cid];
    view.insertAdjacentHTML("beforeend", `<div class="cm-comp" id="cm-comp"><div></div></div>`);
    { const cp = $("#cm-comp"); if (cp && window.ResizeObserver) { ST.compRO?.disconnect(); ST.compRO = new ResizeObserver(() => { const hh = cp.offsetHeight, near = document.documentElement.scrollHeight - (innerHeight + scrollY) < 160; document.body.style.setProperty("--cm-comp-h", hh + "px"); if (near) requestAnimationFrame(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" })); const pill = $("#ai-pill"); if (pill) pill.style.bottom = (hh + 10) + "px"; }); ST.compRO.observe(cp); } }
    const unread = ST.convs?.find(x => x.id === cid)?.unread || 0;
    await aiState();
    if (ctx !== mine) return;
    paintHead(); paintThread(true); paintComposer(); bindDrop();
    if (unread >= 5 && aiOk(ctx.conv)) aiPill(unread);
    markRead(cid);
    ctx.tick = setInterval(tickExpiry, 1000);
    const th = $("#cm-thread"); window.addEventListener("scroll", onScrollTop, { passive: true });
    th.addEventListener("keydown", threadKeys);
  }
  function chatFail(e) { view.innerHTML = `<div class="cm-wrap"><div class="cm-empty">${e?.status === 403 ? "لست عضواً في هذه المحادثة" : e?.status === 404 ? "المحادثة غير موجودة" : "تعذر تحميل المحادثة"}<br><br><a class="btn" href="#/messages">الرسائل</a></div></div>`; document.body.classList.remove("cm-chat"); }

  function paintDown() { // v2.136: «↓» back to the latest message when scrolled up
    const far = !!ctx && document.documentElement.scrollHeight - (innerHeight + scrollY) > 600;
    let b = document.getElementById("cm-down");
    if (!far) { b?.remove(); return; }
    if (!b) { view.insertAdjacentHTML("beforeend", `<button class="cm-down" id="cm-down" aria-label="إلى آخر رسالة"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`); b = document.getElementById("cm-down");
      b.onclick = () => { scrollTo({ top: document.documentElement.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }; }
    b.style.bottom = `calc(var(--cm-comp-h, 72px) + 14px)`;
  }
  async function onScrollTop() {
    paintDown();
    if (!ctx || !ST.more[ctx.cid] || ctx.loadingOld || scrollY > 80) return;
    ctx.loadingOld = true; const first = ST.msgs[ctx.cid][0]; const hBefore = document.documentElement.scrollHeight;
    try { await loadMsgs(ctx.cid, first.at); paintThread(); scrollTo(0, document.documentElement.scrollHeight - hBefore + scrollY); } catch { }
    ctx.loadingOld = false;
  }

  function headSub(c) {
    const t = ST.typing[c.id] || {}, typers = Object.keys(t).filter(k => !k.startsWith("_"));
    if (typers.length) return { cls: "typing", txt: c.kind === "group" ? `${person(typers[0]).name.split(" ")[0]} يكتب…` : "يكتب…" };
    if (c.kind === "group") return { txt: `${c.members.length} عضواً${c.ttl ? " · مؤقتة " + ttlName(c.ttl) : ""}` };
    return { txt: c.e2ee ? "مشفرة طرفاً لطرف" : c.ttl ? "رسائل مؤقتة: " + ttlName(c.ttl) : "@" + (person(peerOf(c)).handle || ""), lock: c.e2ee };
  }
  const peerOf = (c) => (c.members || []).map(m => m.user || m).find(x => x !== DB.me);
  function paintHead() {
    const el = $("#cm-ch"); if (!el || !ctx?.conv) return; const c = ctx.conv, sub = headSub(c);
    el.innerHTML = `<a class="cm-ib" href="#/messages" aria-label="رجوع إلى الرسائل">${ic("cmBack")}</a>
      <a class="who" href="#/chatinfo/${c.id}" aria-label="معلومات ${h(convTitle({ ...c, peer: peerOf(c) }))}">${convAv({ ...c, peer: peerOf(c) }).replace(/^<a /, "<span ").replace(/<\/a>$/, "</span>").replace(/ href="[^"]*"/, "")}
        <span class="cm-mid"><span class="cm-name"><span>${h(convTitle({ ...c, peer: peerOf(c) }))}</span>${c.e2ee ? `<span class="cm-lockc">${ic("lock")}</span>` : ""}</span><span class="cm-sub ${sub.cls || ""}">${sub.lock ? `<span class="cm-lockc">${ic("lock")}</span>` : ""}${c.ttl && !sub.cls ? ic("cmTimer") : ""}${h(sub.txt)}</span></span></a>
      <a class="cm-ib" href="#/chatinfo/${c.id}" aria-label="تفاصيل المحادثة" title="تفاصيل المحادثة">${ic("cmInfo")}</a>`;
  }

  async function paintThread(toBottom) {
    const th = $("#cm-thread"); if (!th || !ctx?.conv) return;
    const c = ctx.conv, all = await Promise.all((ST.msgs[c.id] || []).map(plain)), byId = Object.fromEntries(all.map(m => [m.id, m]));
    if (!ctx || ctx.conv !== c) return;
    const atBottom = toBottom || innerHeight + scrollY >= document.documentElement.scrollHeight - 120;
    const reads = ST.reads[c.id] || {}, me = ST.info[c.id]?.members.find(m => m.user === DB.me);
    let out = "", prevDay = "";
    if (ctx.divAt === undefined) { // «رسائل جديدة»: decided once, when the chat opens (before it is marked read)
      const lr = me ? (me.lastReadAt || "") : null, firstNew = lr === null ? null : all.find(m => m.from !== DB.me && m.kind !== "system" && !m.deleted && m.at > lr);
      ctx.divAt = firstNew?.id || null; ctx.divFirst = true;
    }
    const divAt = ctx.divAt;
    if (ST.more[c.id]) out += `<button class="btn ghost" id="cm-older" style="align-self:center;margin:6px 0">رسائل أقدم</button>`;
    out += c.e2ee ? `<div class="cm-e2ee">${ic("lock", "sm")} الرسائل والمكالمات مشفرة طرفاً لطرف. لا يستطيع أحد خارج هذه المحادثة قراءتها، ولا حتى مجتمع بلس. <a href="#/e2ee">اعرف المزيد</a></div>`
      : c.kind !== "group" ? `<div class="cm-e2ee" style="background:var(--bg-2)">هذه المحادثة غير مشفرة طرفاً لطرف. <a href="#/chatinfo/${c.id}">فعّل التشفير</a></div>` : "";
    all.forEach((m, i) => {
      const d = dayKey(m.at); if (d !== prevDay) { out += `<div class="cm-day" role="separator">${h(dayName(m.at))}</div>`; prevDay = d; }
      if (m.kind === "system") { out += `<div class="cm-sys">${m.meta?.event === "e2ee" ? ic("lock") + " " : m.meta?.event === "ttl" ? ic("cmTimer") + " " : ""}${h(sysText(m))}</div>`; return; }
      if (m.id === divAt) out += `<div class="cm-newdiv" id="cm-newdiv" role="separator"><span>رسائل جديدة</span></div>`;
      const prev = all[i - 1], next = all[i + 1];
      const near = (a, b) => a && b && a.kind !== "system" && b.kind !== "system" && a.from === b.from && dayKey(a.at) === dayKey(b.at) && Math.abs(new Date(a.at) - new Date(b.at)) < 5 * 60e3;
      const cont = near(prev, m), last = !near(m, next), mine = m.from === DB.me;
      out += bubble(m, c, { cont, last, mine, reads, byId });
    });
    out += `<div id="cm-typ"></div>`;
    if (me?.state === "request") out += `<div class="cm-reqbar" role="region" aria-label="طلب مراسلة"><b>${h(person(peerOf(c)).name)} يريد مراسلتك</b><p class="cm-note">لن يعرف أنك قرأت رسائله حتى تقبل. يمكنك الحذف دون إبلاغه.</p><div class="cm-acts"><button class="btn" id="cm-acc">قبول</button><button class="btn ghost" id="cm-dec">حذف</button></div></div>`;
    th.innerHTML = out || `<div class="cm-empty">قل مرحباً</div>`;
    paintTyping();
    const ob = $("#cm-older"); if (ob) ob.onclick = () => { scrollTo(0, 0); onScrollTop(); };
    const acc = $("#cm-acc"); if (acc) acc.onclick = async () => { try { await api("POST", `/api/conversations/${c.id}/accept`); me.state = "accepted"; toast("قُبل الطلب"); paintThread(); paintComposer(); markRead(c.id); } catch (e) { errToast(e); } };
    const dec = $("#cm-dec"); if (dec) dec.onclick = async () => { if (!confirm("حذف طلب المراسلة؟")) return; try { await api("POST", `/api/conversations/${c.id}/decline`); location.hash = "#/messages?tab=requests"; } catch (e) { errToast(e); } };
    bindBubbles(th, byId);
    tickExpiry();
    const nd = ctx.divFirst && $("#cm-newdiv"); ctx.divFirst = false;
    if (nd && toBottom) { requestAnimationFrame(() => { const y = nd.getBoundingClientRect().top + scrollY - 120; scrollTo({ top: Math.min(y, document.documentElement.scrollHeight), behavior: "instant" }); paintDown(); }); }
    else if (atBottom) requestAnimationFrame(() => { scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); paintDown(); });
    else paintDown();
  }

  function bubble(m, c, { cont, last, mine, reads, byId }) {
    const cls = `cm-m ${mine ? "me" : "them"}${cont ? " cont" : ""}${last ? " last" : ""}`;
    const from = c.kind === "group" && !mine && !cont ? `<span class="cm-from">${h(person(m.from).name)}</span>` : "";
    const label = `${mine ? "أنت" : person(m.from).name}، ${fmtTime(m.at)}`;
    if (m.deleted) return `<div class="${cls}" data-id="${m.id}">${from}<div class="cm-b del" tabindex="0" aria-label="${h(label)}: حُذفت هذه الرسالة"><svg class=ei aria-hidden=true><use href=#i-ban /></svg> حُذفت هذه الرسالة<div class="cm-meta"><time>${fmtTime(m.at)}</time></div></div></div>`;
    let body = "";
    if (m.reply) { const r = byId[m.reply.id] || m.reply; const rt = r.deleted ? "رسالة محذوفة" : r.kind === "voice" ? "رسالة صوتية" : r.kind === "image" ? "صورة" : r.locked || r.error || (r.enc && !r.text && !ST.plain[r.id]) ? "رسالة مشفرة" : (ST.plain[r.id]?.text || r.text || "");
      body += `<button class="cm-q" data-jump="${h(m.reply.id)}" aria-label="رد على ${h(person(r.from).name)}: ${h(rt)}"><b>${h(r.from === DB.me ? "أنت" : person(r.from).name)}</b>${h(rt)}</button>`; }
    if (m.locked) body += `<span style="opacity:.85">${ic("lock", "sm")} ${m.locked === "not-for-device" ? "رسالة مشفرة لم تُرسل لهذا الجهاز" : m.locked === "bad" ? "تعذر فك تشفير هذه الرسالة" : "فعّل التشفير على هذا الجهاز لقراءتها"}</span>`;
    else if (m.kind === "image") { const ar = m.meta?.w && m.meta?.h ? `${m.meta.w}/${m.meta.h}` : "4/3"; body += `<img class="cm-img" data-img="${m.id}" alt="صورة${m.text ? ": " + h(m.text) : ""}" style="--ar:${ar}" loading="lazy">${m.text ? `<span dir="auto">${h(m.text)}</span>` : ""}`; }
    else if (m.kind === "voice") body += voiceEl(m);
    else body += `<span dir="auto">${h(m.text)}</span>`;
    if (m.risk && !mine) body += `<span class="ai-risk" role="note"><svg class=ei aria-hidden=true><use href=#i-ban /></svg><span>قد تكون رسالة احتيال. لا تشارك رمز تحقق أو بيانات بطاقة أو كلمة مرور. <button data-risk="${h(m.id)}">ليش؟</button></span></span>`;
    let tick = "";
    if (mine) { const readers = Object.entries(reads).filter(([u, at]) => u !== DB.me && at && at >= m.at).length; const read = readers > 0;
      tick = `<span role="img" class="${read ? "rd" : ""}" title="${read ? (c.kind === "group" ? `قرأها ${readers}` : "قُرئت") : "أُرسلت"}" aria-label="${read ? "قُرئت" : "أُرسلت"}">${ic(read ? "cmCheck2" : "check")}</span>`; }
    const exp = m.expiresAt ? `<span class="cm-exp" data-exp="${h(m.expiresAt)}" data-at="${h(m.at)}" title="تختفي تلقائياً" aria-label="تختفي تلقائياً"><span class="cm-ring" aria-hidden="true"></span><span class="t"></span></span>` : "";
    const rx = (m.reactions || []).length ? `<div class="cm-rx">${m.reactions.map(r => `<button class="cm-chip" data-rx="${h(r.emoji)}" aria-pressed="${r.users.includes(DB.me)}" aria-label="${h(r.emoji)} ${r.users.length}: ${h(r.users.map(u => u === DB.me ? "أنت" : person(u).name).join("، "))}">${h(r.emoji)}${r.users.length > 1 ? " " + r.users.length : ""}</button>`).join("")}</div>` : "";
    return `<div class="${cls}" data-id="${m.id}">${from}<div class="cm-b" tabindex="0" aria-label="${h(label)}" aria-haspopup="menu">${body}<div class="cm-meta">${exp}<time datetime="${h(m.at)}">${fmtTime(m.at)}</time>${tick}</div></div>
      <button class="cm-ib cm-more" data-more aria-label="خيارات الرسالة">${ic("more")}</button>${rx}</div>`;
  }
  const BARS = 36;
  function bars(wave, n = BARS) { const w = Array.isArray(wave) && wave.length ? wave : Array.from({ length: n }, (_, i) => 30 + 25 * Math.sin(i * 1.7) ** 2); const out = []; for (let i = 0; i < n; i++) out.push(w[Math.floor(i * w.length / n)] || 0); return out; }
  function voiceEl(m) {
    const d = m.meta?.duration || 0;
    return `<span class="cm-voice"><button class="cm-play" data-play="${m.id}" aria-label="تشغيل الرسالة الصوتية">${ic("play")}</button>
      <span class="cm-wave" role="slider" tabindex="0" aria-label="موضع التشغيل" aria-valuemin="0" aria-valuemax="${Math.round(d)}" aria-valuenow="0" aria-valuetext="0:00 من ${dur(d)}" data-wave="${m.id}">${bars(m.meta?.wave).map(v => `<i style="height:${Math.max(12, v)}%"></i>`).join("")}</span>
      <span class="cm-vd" data-vd="${m.id}">${dur(d)}</span></span>`;
  }
  function paintTyping() {
    const el = $("#cm-typ"); if (!el || !ctx) return; const t = ST.typing[ctx.cid] || {}, on = Object.keys(t).some(k => !k.startsWith("_"));
    el.innerHTML = on ? `<div class="cm-typing" aria-label="يكتب الآن"><i></i><i></i><i></i></div>` : "";
  }
  function tickExpiry() {
    if (!ctx) return; const now = Date.now(); let gone = false;
    document.querySelectorAll("#cm-thread [data-exp]").forEach(el => {
      const end = Date.parse(el.dataset.exp), start = Date.parse(el.dataset.at), rem = end - now;
      if (rem <= 0) { const m = el.closest(".cm-m"); if (m && !m.classList.contains("gone")) { m.classList.add("gone"); gone = true; setTimeout(() => m.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400); } return; }
      el.style.setProperty("--p", Math.max(0, Math.min(1, 1 - rem / (end - start || 1))).toFixed(3)); el.querySelector(".t").textContent = left(rem); // the pie fills up as expiry nears
    });
    if (gone) { ST.msgs[ctx.cid] = (ST.msgs[ctx.cid] || []).filter(m => !m.expiresAt || Date.parse(m.expiresAt) > now); }
  }

  /* ---- bubble interactions: menu, reactions, reply jump, images, voice ---- */
  function bindBubbles(th, byId) {
    th.querySelectorAll(".cm-m[data-id]").forEach(el => {
      const m = byId[el.dataset.id]; if (!m) return;
      const b = el.querySelector(".cm-b"); let lp;
      el.querySelector("[data-more]")?.addEventListener("click", () => msgMenu(m));
      if (!m.deleted) {
        b.addEventListener("contextmenu", e => { e.preventDefault(); msgMenu(m); });
        b.addEventListener("touchstart", () => { lp = setTimeout(() => { navigator.vibrate?.(12); msgMenu(m); }, 480); }, { passive: true });
        ["touchend", "touchmove", "touchcancel"].forEach(t => b.addEventListener(t, () => clearTimeout(lp), { passive: true }));
        b.addEventListener("dblclick", e => { if (e.target.closest("button,.cm-wave,img")) return; react(m, "❤️"); });
      }
      el.querySelectorAll("[data-rx]").forEach(x => x.onclick = () => react(m, x.dataset.rx));
      const q = el.querySelector("[data-jump]"); if (q) q.onclick = () => jumpTo(q.dataset.jump);
      const rk = el.querySelector("[data-risk]"); if (rk) rk.onclick = (e) => { e.stopPropagation(); aiRisk(m); };
      const img = el.querySelector("[data-img]"); if (img) blobSrc(m).then(u => { if (u) { img.src = u; img.onclick = () => lightbox(u, img.alt); } else img.alt = "تعذر تحميل الصورة"; });
      const pb = el.querySelector("[data-play]"); if (pb) bindVoice(el, m);
    });
  }
  function threadKeys(e) {
    const b = e.target.closest?.(".cm-b"); if (!b) return;
    if (e.key === "Enter" || e.key === " " || (e.shiftKey && e.key === "F10") || e.key === "ContextMenu") { if (e.target !== b) return; e.preventDefault(); const id = b.closest(".cm-m").dataset.id; const m = (ST.msgs[ctx.cid] || []).find(x => x.id === id); if (m && !m.deleted) msgMenu({ ...m, ...(ST.plain[m.id] || {}) }); }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { const list = [...document.querySelectorAll("#cm-thread .cm-b")], i = list.indexOf(b); const n = list[i + (e.key === "ArrowUp" ? -1 : 1)]; if (n) { e.preventDefault(); n.focus(); } }
  }
  /* =========================== v2.134 «الذكاء في الرسائل» ===========================
   * Only on a tap: ✨ in the composer (suggested replies, improve my draft, summarise) and a «لخّص لي اللي فاتني» pill when 5+ unread.
   * Never sends anything; off in encrypted chats and when the member turns it off in Settings (server checks too). */
  const AI_SP = `<svg class="ai-sp" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1-2.1-.9 2.1-.9z" opacity=".75"/></svg>`;
  const AI_TONES = [["kind", "ألطف"], ["short", "أقصر"], ["formal", "أرسمي"], ["fix", "صحّح الإملاء"]];
  async function aiState(force) {
    if (!force && ST.aiAt && Date.now() - ST.aiAt < 60e3) return ST.aiOn;
    try { ST.aiOn = (await api("GET", "/api/aihub/messages/state")).on !== false; } catch { ST.aiOn = false; }
    ST.aiAt = Date.now(); return ST.aiOn;
  }
  window.addEventListener("mp:msgai", () => { ST.aiAt = 0; });
  const aiOk = (c) => !!(ST.aiOn && c && !c.e2ee && c.members?.find(x => (x.user || x) === DB.me)?.state !== "request");
  const aiCall = (b) => api("POST", "/api/aihub/messages", { cid: ctx?.cid, ...b });
  function aiErr(e) { if (e?.code === "msg_ai_off") { ST.aiOn = false; paintComposer(); } errToast(e); }
  function aiPill(n) {
    document.getElementById("ai-pill")?.remove();
    view.insertAdjacentHTML("beforeend", `<div class="ai-pill" id="ai-pill"><div><button id="ai-pb">${AI_SP} لخّص لي اللي فاتني <small>· ${n} ${n >= 3 && n <= 10 ? "رسائل" : "رسالة"}</small></button><button class="ai-x" id="ai-px" aria-label="إخفاء">×</button></div></div>`);
    const comp = $("#cm-comp"), pill = $("#ai-pill"); if (comp && pill) pill.style.bottom = (comp.offsetHeight + 10) + "px";
    $("#ai-pb").onclick = () => { $("#ai-pill")?.remove(); aiSummary(Math.max(n, 10)); };
    $("#ai-px").onclick = () => $("#ai-pill")?.remove();
  }
  async function aiSummary(n) {
    const c = ctx?.conv; if (!c) return;
    const title = c.kind === "group" ? `اللي فاتك في «${h(convTitle({ ...c, peer: peerOf(c) }))}»` : "اللي فاتك في المحادثة";
    const s = sheet(`<h4 class="ai-h" id="ai-sh">${AI_SP} ${title}</h4><div id="ai-sb" aria-live="polite"><div class="ai-load"><i></i><i></i><i></i></div></div>`);
    const box = s.querySelector("#ai-sb"); s.querySelector(".panel")?.setAttribute("aria-labelledby", "ai-sh");
    let r; try { r = await aiCall({ tool: "catchup", n }); } catch (e) { closeSheet(); return aiErr(e); }
    if (!box.isConnected) return;
    const lbl = { decision: "اتفاق", todo: "مطلوب منك", question: "سؤال", info: "" };
    box.innerHTML = `<p class="ai-sub">${h(r.headline || "")}${r.count ? ` · ${r.count} ${r.count >= 3 && r.count <= 10 ? "رسائل" : "رسالة"}` : ""}</p>
      ${(r.points || []).map((p) => `<button class="ai-pt ${p.kind}" ${p.cites?.[0] ? `data-aigo="${h(p.cites[0])}"` : "disabled"}><span class="ai-dot"></span><span>${lbl[p.kind] ? `<b>${lbl[p.kind]}:</b> ` : ""}${h(p.text)}</span>${p.cites?.[0] ? `<span class="go">الرسالة ←</span>` : ""}</button>`).join("")}
      <div class="ai-row"><button class="ai-btn" id="ai-rp">اقترح لي رد</button><button class="ai-btn ghost" id="ai-cl">تم</button></div>
      <p class="ai-note">يعمل فقط لما تضغط · ما ينحفظ شي من المحادثة${r.free ? ` · بقي لك ${r.free.left} اليوم` : ""}</p>`;
    box.querySelectorAll("[data-aigo]").forEach((b) => b.onclick = () => { closeSheet(); setTimeout(() => jumpTo(b.dataset.aigo), 60); });
    box.querySelector("#ai-rp").onclick = () => { closeSheet(); aiOpen(); };
    box.querySelector("#ai-cl").onclick = () => closeSheet();
  }
  /* v2.135 stage 2: the bubble's «ترجمة» button (ai-ui) uses this when the paid translate service is not available;
   * a scam warning explains itself; dates/tasks are listed and added only on a tap (.ics download / copy) */
  window.MPMsgAI = { ok: () => aiOk(ctx?.conv), translate: (mid) => aiCall({ tool: "translate", mid }) };
  const RISK_TXT = { otp: "يطلب رمز تحقق", card: "يطلب بيانات بطاقة أو حساب بنكي", password: "يطلب كلمة مرور", suspended: "يدّعي تعليق حسابك", prize: "يدّعي أنك ربحت جائزة", urgent: "يستعجلك بمهلة قصيرة", transfer: "يطلب تحويل مبلغ أو رسوم", shortlink: "فيه رابط مختصر يخفي وجهته", fakeofficial: "ينتحل جهة رسمية أو دعماً فنياً" };
  async function aiRisk(m) {
    const local = (m.risk || []).map((k) => RISK_TXT[k]).filter(Boolean), smart = aiOk(ctx?.conv);
    const s = sheet(`<h4 class="ai-h" id="ai-rh"><svg class=ei aria-hidden=true><use href=#i-ban /></svg> ليش هذي الرسالة مشبوهة؟</h4><div id="ai-rb" aria-live="polite">${local.map((t) => `<div class="ai-it"><div>${h(t)}</div></div>`).join("")}${smart ? `<div class="ai-load"><i></i></div>` : ""}</div>
      <div class="ai-row"><button class="ai-btn ghost" id="ai-rc">تم</button></div><p class="ai-note">التطبيق وفريقه ما يطلبون منك رمز التحقق أبداً. إذا شكّيت، احظر المرسل وبلّغ عنه.</p>`);
    s.querySelector("#ai-rc").onclick = () => closeSheet();
    if (!smart) return;
    try {
      const r = await aiCall({ tool: "safety", mid: m.id }), box = s.querySelector("#ai-rb"); if (!box?.isConnected) return;
      const lvl = { high: "خطر عالٍ", medium: "مشبوهة", low: "خطر منخفض" }[r.risk] || "";
      box.innerHTML = `<p class="ai-sub">تقدير الذكاء: <b>${h(lvl)}</b></p>` + [...new Set([...local, ...(r.reasons || [])])].map((t) => `<div class="ai-it"><div>${h(t)}</div></div>`).join("") + (r.advice ? `<p class="ai-sub">${h(r.advice)}</p>` : "");
    } catch (e) { s.querySelector(".ai-load")?.remove(); if (e?.code === "msg_ai_off") ST.aiOn = false; }
  }
  function icsFor(it) {
    const d = it.date.replace(/-/g, ""), stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const esc = (t) => String(t).replace(/[\\;,]/g, (x) => "\\" + x).replace(/\n/g, " ");
    let when;
    if (it.time) { const [hh, mm] = it.time.split(":").map(Number), end = hh * 60 + mm + 60, eh = Math.floor(end / 60) % 24, em = end % 60;
      when = `DTSTART;TZID=Asia/Riyadh:${d}T${it.time.replace(":", "")}00\r\nDTEND;TZID=Asia/Riyadh:${d}T${String(eh).padStart(2, "0")}${String(em).padStart(2, "0")}00`; }
    else { const n = new Date(it.date + "T00:00:00Z"); n.setUTCDate(n.getUTCDate() + 1); when = `DTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${n.toISOString().slice(0, 10).replace(/-/g, "")}`; }
    return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mujtama+//msgs//AR\r\nBEGIN:VEVENT\r\nUID:${Date.now()}-${Math.random().toString(36).slice(2)}@mujtama\r\nDTSTAMP:${stamp}\r\n${when}\r\nSUMMARY:${esc(it.title)}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  }
  async function aiExtract() {
    const s = sheet(`<h4 class="ai-h" id="ai-eh">${AI_SP} مواعيد ومهام من المحادثة</h4><div id="ai-eb" aria-live="polite"><div class="ai-load"><i></i><i></i></div></div>`);
    const box = s.querySelector("#ai-eb");
    let r; try { r = await aiCall({ tool: "extract", n: 50 }); } catch (e) { closeSheet(); return aiErr(e); }
    if (!box.isConnected) return;
    const items = r.items || [];
    const fmt = (it) => it.date ? `${new Date(it.date + "T12:00:00Z").toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" })}${it.time ? " · " + it.time : ""}` : "بدون تاريخ";
    box.innerHTML = (items.length ? items.map((it, i) => `<div class="ai-it"><div><b>${h(it.title)}</b><small>${it.kind === "task" ? "مهمة" : "موعد"} · ${h(fmt(it))}${it.forMe ? " · يخصك" : ""}</small></div>
        ${it.date && it.kind === "event" ? `<button class="ai-chip" data-ics="${i}">أضف للتقويم</button>` : `<button class="ai-chip" data-cp="${i}">نسخ</button>`}${it.cites?.[0] ? `<button class="ai-chip" data-aigo="${h(it.cites[0])}">الرسالة</button>` : ""}</div>`).join("")
      : `<p class="ai-sub">ما لقيت مواعيد أو مهام واضحة في آخر الرسائل.</p>`) +
      `<div class="ai-row"><button class="ai-btn ghost" id="ai-ec">تم</button></div><p class="ai-note">ما يُضاف شي إلا لما تضغط · راجع التاريخ قبل الحفظ</p>`;
    box.querySelectorAll("[data-ics]").forEach((b) => b.onclick = () => {
      const it = items[+b.dataset.ics], url = URL.createObjectURL(new Blob([icsFor(it)], { type: "text/calendar" })), a = document.createElement("a");
      a.href = url; a.download = "موعد.ics"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); toast("جهّزت الموعد، افتحه لإضافته لتقويمك");
    });
    box.querySelectorAll("[data-cp]").forEach((b) => b.onclick = async () => { const it = items[+b.dataset.cp]; try { await navigator.clipboard.writeText(it.title + (it.date ? " — " + fmt(it) : "")); toast("نُسخت"); } catch { toast("تعذر النسخ"); } });
    box.querySelectorAll("[data-aigo]").forEach((b) => b.onclick = () => { closeSheet(); setTimeout(() => jumpTo(b.dataset.aigo), 60); });
    box.querySelector("#ai-ec").onclick = () => closeSheet();
  }
  function aiClose() { ctx.aiOpen = false; $("#ai-panel")?.remove(); $("#cm-ai")?.setAttribute("aria-expanded", "false"); }
  async function aiOpen(keep) {
    const box = $("#cm-comp > div"), ta = $("#cm-ta"); if (!box || !ta || !ctx) return;
    ctx.aiOpen = true; $("#cm-ai")?.setAttribute("aria-expanded", "true"); $("#ai-panel")?.remove();
    box.insertAdjacentHTML("afterbegin", `<div class="ai-panel" id="ai-panel" role="group" aria-label="مساعد الذكاء"><div class="ai-sugg" id="ai-sg"><span class="lbl">${AI_SP} ردود مقترحة</span><button class="ai-chip sk" disabled>…</button><button class="ai-chip sk" disabled>…</button></div>
      <div class="ai-sugg ai-tone" id="ai-tn">${AI_TONES.map(([k, l]) => `<button class="ai-chip" data-tone="${k}">${l}</button>`).join("")}<button class="ai-chip" id="ai-sum">لخّص المحادثة</button><button class="ai-chip" id="ai-ex">مواعيد ومهام</button></div></div>`);
    const tones = () => { const has = ta.value.trim().length > 1; box.querySelectorAll("[data-tone]").forEach((b) => { b.hidden = !has; }); };
    tones(); ta.addEventListener("input", tones);
    $("#ai-sum").onclick = () => aiSummary(40);
    $("#ai-ex").onclick = () => aiExtract();
    box.querySelectorAll("[data-tone]").forEach((b) => b.onclick = async () => {
      const orig = ta.value; if (orig.trim().length < 2) return;
      box.querySelectorAll("#ai-tn .ai-chip").forEach((x) => { x.disabled = true; }); b.textContent = "…";
      try { const r = await aiCall({ tool: "rewrite", text: orig, tone: b.dataset.tone }); if (!ctx) return; ta.value = r.text; ctx.draft = r.text; ta.dispatchEvent(new Event("input")); live("تم تحسين رسالتك، راجعها قبل الإرسال");
        if (!$("#ai-undo")) { $("#ai-tn")?.insertAdjacentHTML("beforeend", `<button class="ai-chip" id="ai-undo">رجوع للأصل</button>`); $("#ai-undo").onclick = () => { ta.value = orig; ctx.draft = orig; ta.dispatchEvent(new Event("input")); $("#ai-undo")?.remove(); ta.focus(); }; } }
      catch (e) { aiErr(e); }
      finally { box.querySelectorAll("#ai-tn .ai-chip").forEach((x) => { x.disabled = false; }); const t = AI_TONES.find(([k]) => k === b.dataset.tone); if (t) b.textContent = t[1]; }
    });
    if (keep && ctx.aiReplies) return paintReplies(ctx.aiReplies);
    try { const r = await aiCall({ tool: "replies", draft: ta.value.trim() }); if (!ctx?.aiOpen) return; ctx.aiReplies = r.replies; paintReplies(r.replies); }
    catch (e) { const sg = $("#ai-sg"); if (sg) sg.innerHTML = `<span class="lbl">${AI_SP} تعذّرت الاقتراحات</span>`; aiErr(e); }
    function paintReplies(list) {
      const sg = $("#ai-sg"); if (!sg) return;
      sg.innerHTML = `<span class="lbl">${AI_SP} ردود مقترحة</span>` + list.map((t) => `<button class="ai-chip" data-rp>${h(t)}</button>`).join("");
      sg.querySelectorAll("[data-rp]").forEach((b) => b.onclick = () => { ta.value = b.textContent; ctx.draft = ta.value; ta.dispatchEvent(new Event("input")); ta.focus(); live("وُضع الرد في مربع الكتابة، عدّله وأرسله"); });
    }
  }
  function jumpTo(id) { const el = document.querySelector(`#cm-thread [data-id="${CSS.escape(id)}"] .cm-b`); if (!el) return toast("الرسالة الأصلية لم تعد متاحة"); el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); el.classList.remove("cm-flash"); void el.offsetWidth; el.classList.add("cm-flash"); el.focus({ preventScroll: true }); }
  function lightbox(src, alt) { const d = document.createElement("div"); d.className = "lightbox"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "عرض الصورة"); d.style.cssText = "position:fixed;inset:0;z-index:90;background:#000e;display:grid;place-items:center;padding:16px"; d.innerHTML = `<img src="${h(src)}" alt="${h(alt)}" style="max-width:100%;max-height:100%;border-radius:12px"><button class="cm-ib" aria-label="إغلاق" style="position:absolute;top:12px;inset-inline-end:12px;color:#fff">${ic("x")}</button>`; const close = () => { d.remove(); removeEventListener("keydown", k); }; const k = (e) => { if (e.key === "Escape") close(); }; d.onclick = close; addEventListener("keydown", k); document.body.appendChild(d); d.querySelector("button").focus(); }

  function msgMenu(m) {
    if (!ctx) return; const c = ctx.conv, me = c.members.find(x => x.user === DB.me), mine = m.from === DB.me;
    const accepted = me?.state !== "request";
    const canDel = mine && Date.now() - Date.parse(m.at) < 48 * 3600e3 || (c.kind === "group" && me?.role === "admin");
    const myRx = (m.reactions || []).find(r => r.users.includes(DB.me))?.emoji;
    const txt = ST.plain[m.id]?.text ?? m.text;
    const s = sheet(`<h4 class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden">خيارات الرسالة</h4>
      ${accepted ? `<div class="cm-pick" role="group" aria-label="أضف تفاعلاً">${REACTIONS.map(e => `<button data-e="${e}" aria-pressed="${myRx === e}" aria-label="تفاعل ${e}">${e}</button>`).join("")}</div>` : ""}
      <div class="menu" role="menu">
        ${accepted ? `<button role="menuitem" data-a="reply">${ic("cmReply")} رد</button>` : ""}
        ${txt && m.kind !== "voice" ? `<button role="menuitem" data-a="copy">${ic("copy")} نسخ النص</button>` : ""}
        ${canDel ? `<button role="menuitem" data-a="del" class="u-c-dg">${ic("cmTrash")} حذف للجميع</button>` : ""}
        </div><p class="u-tc u-m0 u-mt8 cm-note">أُرسلت ${h(dayName(m.at))} ${h(fmtTime(m.at))}${m.expiresAt ? " · تختفي بعد " + left(Date.parse(m.expiresAt) - Date.now()) : ""}</p>`);
    s.querySelectorAll("[data-e]").forEach(b => b.onclick = () => { closeSheet(); react(m, b.dataset.e); });
    s.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
      const a = b.dataset.a; closeSheet();
      if (a === "reply") { ctx.reply = m; paintComposer(); $("#cm-ta")?.focus(); }
      else if (a === "copy") { try { await navigator.clipboard.writeText(txt); toast("نُسخ النص"); } catch { toast("تعذر النسخ"); } }
      else if (a === "del") delMsg(m);
    });
    setTimeout(() => s.querySelector(".cm-pick button, .menu button")?.focus(), 60);
    const back = document.querySelector(`#cm-thread [data-id="${CSS.escape(m.id)}"] .cm-b`); s._onclose = () => back?.focus({ preventScroll: true });
  }
  async function react(m, emoji) {
    const mine = (m.reactions || []).find(r => r.users.includes(DB.me))?.emoji, next = mine === emoji ? null : emoji;
    const stored = (ST.msgs[ctx.cid] || []).find(x => x.id === m.id);
    try { const core = MC(); const r = core?.react ? await core.react(m.id, next) : await api("POST", `/api/chat/messages/${m.id}/react`, { emoji: next }); if (stored) stored.reactions = r.reactions; live(next ? `تفاعلت بـ ${next}` : "أُزيل التفاعل"); paintThread(); } catch (e) { errToast(e); }
  }
  async function delMsg(m) {
    if (!confirm("حذف هذه الرسالة لدى الجميع؟ لا يمكن التراجع.")) return;
    try { await api("DELETE", `/api/chat/messages/${m.id}`); const s = (ST.msgs[ctx.cid] || []).find(x => x.id === m.id); if (s) Object.assign(s, { deleted: true, text: "", meta: null, enc: null, reactions: [] }); delete ST.plain[m.id]; live("حُذفت الرسالة للجميع"); paintThread(); } catch (e) { errToast(e); }
  }

  /* ---- voice playback ---- */
  function bindVoice(el, m) {
    const pb = el.querySelector("[data-play]"), wave = el.querySelector("[data-wave]"), vd = el.querySelector("[data-vd]"), barsEl = [...wave.children];
    let a = null, d = m.meta?.duration || 0;
    const paint = () => { const p = a && (a.duration || d) ? a.currentTime / (isFinite(a.duration) ? a.duration : d) : 0; const k = Math.round(p * barsEl.length); barsEl.forEach((b, i) => b.classList.toggle("on", i < k)); wave.setAttribute("aria-valuenow", Math.round(a?.currentTime || 0)); wave.setAttribute("aria-valuetext", `${dur(a?.currentTime || 0)} من ${dur(d)}`); vd.textContent = a && !a.paused ? dur(a.currentTime) : dur(d); };
    const ensure = async () => { if (a) return a; const src = await blobSrc(m); if (!src) { toast("تعذر تحميل الرسالة الصوتية"); return null; } a = new Audio(src); ctx?.audio.push(a); a.ontimeupdate = paint; a.onloadedmetadata = () => { if (isFinite(a.duration)) d = a.duration; paint(); }; a.onended = () => { a.currentTime = 0; set(false); paint(); }; return a; };
    const set = (on) => { pb.innerHTML = ic(on ? "pause" : "play"); pb.setAttribute("aria-label", on ? "إيقاف مؤقت" : "تشغيل الرسالة الصوتية"); };
    pb.onclick = async () => { const x = await ensure(); if (!x) return; if (x.paused) { (ctx?.audio || []).forEach(o => o !== x && !o.paused && o.pause()); try { await x.play(); set(true); } catch { toast("تعذر التشغيل"); } } else { x.pause(); set(false); } };
    const seek = async (frac) => { const x = await ensure(); if (!x) return; const D = isFinite(x.duration) ? x.duration : d; x.currentTime = Math.max(0, Math.min(D, frac * D)); paint(); };
    wave.onclick = (e) => { const r = wave.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); };
    wave.onkeydown = (e) => { const D = d || 1, cur = a?.currentTime || 0; const step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5 }[e.key]; if (step != null) { e.preventDefault(); seek((cur + (document.dir === "rtl" && e.key.startsWith("Arrow") && (e.key === "ArrowLeft" || e.key === "ArrowRight") ? -step : step)) / D); } else if (e.key === "Home") seek(0); else if (e.key === "End") seek(0.999); else if (e.key === " " || e.key === "Enter") { e.preventDefault(); pb.click(); } };
  }

  /* ---- composer ---- */
  function paintComposer() {
    const box = $("#cm-comp > div"); if (!box || !ctx) return;
    const c = ctx.conv, me = c.members.find(x => x.user === DB.me);
    if (me?.state === "request") { box.innerHTML = `<p class="cm-note" style="text-align:center;margin:6px">اقبل الطلب للرد</p>`; return; }
    if (c.e2ee && !MC()?.send) { box.innerHTML = `<p class="cm-note" style="text-align:center;margin:6px">${ic("lock", "sm")} هذه المحادثة مشفرة. فعّل التشفير على هذا الجهاز من <a href="#/devices">الأجهزة المرتبطة</a> للمراسلة.</p>`; return; }
    if (ctx.rec) return paintRec(box);
    const r = ctx.reply, img = ctx.img, prevTxt = ctx.draft ?? "";
    box.innerHTML = `${r ? `<div class="cm-pre" role="status"><span class="cm-mid"><b>رد على ${h(r.from === DB.me ? "نفسك" : person(r.from).name)}</b><div class="cm-prev">${h(r.kind === "voice" ? "رسالة صوتية" : r.kind === "image" ? "صورة" : ST.plain[r.id]?.text ?? r.text ?? "")}</div></span><button class="cm-ib" id="cm-xr" aria-label="إلغاء الرد">${ic("x")}</button></div>` : ""}
      ${img ? `<div class="cm-pre" role="status"><img src="${img.url}" alt=""><span class="cm-mid"><b>صورة جاهزة للإرسال</b><div class="cm-prev">${h(img.file.name || "صورة")} · ${(img.file.size / 1024 / 1024).toFixed(1)} م.ب — أضف تعليقاً إن شئت</div></span><button class="cm-ib" id="cm-xi" aria-label="إزالة الصورة">${ic("x")}</button></div>` : ""}
      <div class="cm-row2"><input type="file" id="cm-file" accept="image/*" hidden>
        <button class="cm-ib" id="cm-att" aria-label="إرفاق صورة" title="إرفاق صورة (أو اسحبها وأفلتها، أو الصقها)">${ic("cmImg")}</button>${aiOk(c) ? `<button class="cm-ib ai-ib" id="cm-ai" aria-label="مساعد الذكاء: ردود مقترحة وتحسين رسالتك" title="مساعد الذكاء" aria-expanded="false" aria-controls="ai-panel">${AI_SP}</button>` : ""}
        <textarea class="cm-ta" id="cm-ta" rows="1" placeholder="${img ? "أضف تعليقاً…" : c.e2ee ? "رسالة مشفرة…" : "اكتب رسالة…"}" aria-label="نص الرسالة" maxlength="4000" dir="auto">${h(prevTxt)}</textarea>
        <button class="cm-ib cm-sendb" id="cm-send" aria-label="${prevTxt || img ? "إرسال" : "تسجيل رسالة صوتية"}" title="${prevTxt || img ? "إرسال" : "تسجيل رسالة صوتية"}">${ic(prevTxt || img ? "cmSend" : "mic")}</button></div>`;
    const ta = $("#cm-ta"), send = $("#cm-send"), grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; };
    grow();
    const mode = () => { const has = ta.value.trim() || ctx.img; send.innerHTML = ic(has ? "cmSend" : "mic"); send.setAttribute("aria-label", has ? "إرسال" : "تسجيل رسالة صوتية"); send.title = send.getAttribute("aria-label"); };
    ta.oninput = () => { ctx.draft = ta.value; grow(); mode(); typingPing(); };
    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover:hover)").matches) { e.preventDefault(); submit(); } if (e.key === "Escape" && ctx.reply) { ctx.reply = null; paintComposer(); $("#cm-ta")?.focus(); } };
    ta.onpaste = (e) => { const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith("image/")); if (f) { e.preventDefault(); pickImage(f); } };
    send.onclick = () => (ta.value.trim() || ctx.img ? submit() : startRec());
    $("#cm-att").onclick = () => $("#cm-file").click();
    const aib = $("#cm-ai"); if (aib) aib.onclick = () => (ctx.aiOpen ? aiClose() : aiOpen());
    if (ctx.aiOpen && aib) aiOpen(true);
    $("#cm-file").onchange = (e) => { const f = e.target.files[0]; if (f) pickImage(f); };
    const xr = $("#cm-xr"); if (xr) xr.onclick = () => { ctx.reply = null; paintComposer(); $("#cm-ta").focus(); };
    const xi = $("#cm-xi"); if (xi) xi.onclick = () => { URL.revokeObjectURL(ctx.img.url); ctx.img = null; paintComposer(); $("#cm-ta").focus(); };
  }
  function typingPing() {
    if (!ctx) return; const now = Date.now();
    if (!ctx.typingOn || now - ctx.typingAt > 3500) { ctx.typingOn = true; ctx.typingAt = now; emitTyping(ctx.cid, true); }
    clearTimeout(ctx.typingT); ctx.typingT = setTimeout(() => { if (ctx?.typingOn) { ctx.typingOn = false; emitTyping(ctx.cid, false); } }, 4000);
  }
  function pickImage(f) {
    if (!f.type.startsWith("image/")) return toast("يمكن إرسال الصور فقط هنا");
    if (f.size > 8 * 1024 * 1024) return toast("الحد الأقصى 8 ميغابايت");
    if (ctx.img?.url) URL.revokeObjectURL(ctx.img.url);
    ctx.img = { file: f, url: URL.createObjectURL(f) }; paintComposer(); $("#cm-ta")?.focus(); live("أُرفقت صورة، اضغط إرسال");
  }
  function bindDrop() {
    let depth = 0, ov = null;
    const has = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    const show = (on) => { if (on && !ov) { ov = document.createElement("div"); ov.className = "cm-drop"; ov.innerHTML = `<div>${ic("cmImg")} أفلت الصورة لإرسالها</div>`; document.body.appendChild(ov); } else if (!on && ov) { ov.remove(); ov = null; } };
    view.ondragenter = (e) => { if (!has(e) || !ctx) return; e.preventDefault(); depth++; show(true); };
    view.ondragover = (e) => { if (has(e) && ctx) e.preventDefault(); };
    view.ondragleave = () => { if (--depth <= 0) { depth = 0; show(false); } };
    view.ondrop = (e) => { if (!ctx) return; e.preventDefault(); depth = 0; show(false); const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith("image/")); if (f) pickImage(f); else toast("يمكن إرسال الصور فقط هنا"); };
  }
  async function submit() {
    if (!ctx || ctx.sending) return; const c = ctx.conv, ta = $("#cm-ta"), text = (ta?.value || "").trim(), img = ctx.img;
    if (!text && !img) return;
    ctx.sending = true; const btn = $("#cm-send"); if (btn) btn.disabled = true;
    try {
      const body = { id: uid("ms"), kind: "text", text, replyTo: ctx.reply?.id || undefined };
      if (img) { const dims = await new Promise(r => { const i = new Image(); i.onload = () => r({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => r({}); i.src = img.url; }); Object.assign(body, { kind: "image", file: img.file, meta: dims }); }
      await deliver(body);
      ctx.draft = ""; ctx.reply = null; ctx.aiOpen = false; ctx.aiReplies = null; if (img) { URL.revokeObjectURL(img.url); ctx.img = null; }
      if (ctx.typingOn) { ctx.typingOn = false; emitTyping(c.id, false); }
      paintComposer(); $("#cm-ta")?.focus();
    } catch (e) { errToast(e); if (btn) btn.disabled = false; }
    ctx && (ctx.sending = false);
  }
  async function deliver(body) {
    const c = ctx.conv, m = await sendMsg(c, body);
    if (m?.id) { if (m.encrypted && !m.error) ST.plain[m.id] = { text: m.text, meta: m.meta, kind: m.kind, file: m.file, reply: m.reply, encrypted: true }; if (body.file && body.kind === "image") urls[m.id] = URL.createObjectURL(body.file); const arr = (ST.msgs[c.id] ||= []); if (!arr.some(x => x.id === m.id)) arr.push(m); seen.add("m" + m.id); }
    live("أُرسلت الرسالة"); ctx.divAt = null; paintThread(true);
    const lc = ST.convs?.find(x => x.id === c.id); if (lc && m?.id) { lc.last = m; lc.updatedAt = m.at; }
  }

  /* ---- voice recording ---- */
  async function startRec() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("التسجيل الصوتي غير مدعوم في هذا المتصفح");
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast("اسمح باستخدام الميكروفون لتسجيل رسالة صوتية"); }
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(t => MediaRecorder.isTypeSupported?.(t)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), parts = [], wave = [];
    const ac = new (window.AudioContext || window.webkitAudioContext)(), an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize); const t0 = Date.now();
    const R = ctx.rec = { rec, wave, t0, stream, ac, done: null,
      cancel() { clearInterval(R.iv); try { rec.state !== "inactive" && rec.stop(); } catch { } stream.getTracks().forEach(t => t.stop()); ac.close().catch(() => { }); } };
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    R.iv = setInterval(() => { an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); wave.push(Math.min(100, Math.round(peak / 128 * 180))); const s = (Date.now() - t0) / 1000; const t = $("#cm-rt"); if (t) t.textContent = dur(s); const w = $("#cm-rw"); if (w) w.innerHTML = wave.slice(-BARS).map(v => `<i class="on" style="height:${Math.max(10, v)}%"></i>`).join(""); if (s >= 120) finishRec(true); }, 100);
    rec.start(250); paintComposer(); live("بدأ التسجيل"); $("#cm-rs")?.focus();
    R.done = () => new Promise(res => { rec.onstop = () => res(new Blob(parts, { type: (rec.mimeType || "audio/webm").split(";")[0] })); try { rec.stop(); } catch { res(new Blob(parts)); } });
  }
  function paintRec(box) {
    box.innerHTML = `<div class="cm-rec" role="group" aria-label="تسجيل رسالة صوتية"><button class="cm-ib" id="cm-rc" aria-label="إلغاء التسجيل" title="إلغاء">${ic("cmTrash")}</button>
      <span class="dot" aria-hidden="true"></span><span class="t" id="cm-rt" aria-live="off">0:00</span><span class="cm-wave" id="cm-rw" aria-hidden="true"></span>
      <button class="cm-ib cm-sendb" id="cm-rs" aria-label="إرسال الرسالة الصوتية">${ic("cmSend")}</button></div>`;
    $("#cm-rc").onclick = () => { ctx.rec.cancel(); ctx.rec = null; paintComposer(); live("أُلغي التسجيل"); $("#cm-send")?.focus(); };
    $("#cm-rs").onclick = () => finishRec(true);
  }
  async function finishRec(send) {
    const R = ctx?.rec; if (!R || R.finishing) return; R.finishing = true; clearInterval(R.iv);
    const blob = await R.done(); R.stream.getTracks().forEach(t => t.stop()); R.ac.close().catch(() => { });
    const duration = (Date.now() - R.t0) / 1000; ctx.rec = null; paintComposer();
    if (!send || duration < 0.6 || !blob.size) return toast("التسجيل قصير جداً");
    const n = 48, w = R.wave, wave = Array.from({ length: n }, (_, i) => { const a = Math.floor(i * w.length / n), b = Math.max(a + 1, Math.floor((i + 1) * w.length / n)); return Math.max(...w.slice(a, b), 0); });
    try { await deliver({ id: uid("ms"), kind: "voice", text: "", replyTo: ctx.reply?.id || undefined, file: blob, meta: { duration: Math.round(duration * 10) / 10, wave } }); ctx.reply = null; paintComposer(); }
    catch (e) { errToast(e); }
  }

  /* =========================== conversation info / group =========================== */
  async function infoView(cid) {
    leaveChat();
    view.innerHTML = `<div class="cm-wrap"><div class="cm-head"><a class="cm-ib" href="#/chat/${cid}" aria-label="رجوع">${ic("cmBack")}</a><h2>التفاصيل</h2></div><div class="skel"></div></div>`;
    let c; try { c = await loadInfo(cid); } catch (e) { return chatFail(e); }
    const me = c.members.find(m => m.user === DB.me), admin = me?.role === "admin", grp = c.kind === "group", peer = peerOf(c), p = person(peer);
    let ver = null; if (!grp && c.e2ee && E2()) ver = await E2().verification(peer).then(v => v.state).catch(() => null);
    const members = grp ? [...c.members].sort((a, b) => (b.role === "admin") - (a.role === "admin") || (a.user === DB.me ? -1 : 0)) : [];
    view.innerHTML = `<div class="cm-wrap">
      <div class="cm-head"><a class="cm-ib" href="#/chat/${cid}" aria-label="رجوع إلى المحادثة">${ic("cmBack")}</a><h2>${grp ? "معلومات المجموعة" : "معلومات المحادثة"}</h2></div>
      <div class="cm-hero">${grp ? groupAv(c, "lg") : av(p, "lg")}<h2>${h(grp ? c.title : p.name)}</h2>
        <div class="muted">${grp ? `مجموعة · ${c.members.length} من ${MAX_GROUP} عضواً` : "@" + h(p.handle)}</div>
        ${grp && admin ? `<button class="u-mt10 btn ghost" id="ci-ren">${ic("pen", "sm")} تغيير الاسم</button>` : !grp ? `<a class="u-mt10 btn ghost" href="#/u/${h(p.handle)}">عرض الملف الشخصي</a>` : ""}</div>
      <section class="cm-sec" aria-labelledby="ci-enc"><h3 id="ci-enc">الخصوصية والتشفير</h3>
        ${c.e2ee ? `<a class="cm-li" href="#/safety/${h(peer)}">${ic("lock")}<span class="cm-mid">مشفرة طرفاً لطرف ${ver === "verified" ? `<span class="cm-badge ok">${ic("check")} تم التحقق</span>` : ver === "changed" ? `<span class="u-c-wn cm-badge">تغيّر رمز الأمان</span>` : ""}<small>اضغط للتحقق من رمز الأمان مع ${h(p.name)}</small></span></a>`
          : grp ? `<div class="u-cd cm-li">${ic("shield")}<span class="cm-mid">رسائل المجموعة محمية أثناء النقل<small>التشفير طرفاً لطرف متاح حالياً للمحادثات الخاصة</small></span></div>`
          : `<button class="cm-li" id="ci-e2ee">${ic("lock")}<span class="cm-mid">تفعيل التشفير طرفاً لطرف<small>بعد التفعيل لا يستطيع أحد غيركما قراءة الرسائل الجديدة</small></span></button>`}
        <a class="cm-li" href="#/e2ee">${ic("cmInfo")}<span class="cm-mid">كيف يحمي التشفير رسائلك؟</span></a>
        <a class="cm-li" href="#/devices">${ic("cmDevice")}<span class="cm-mid">الأجهزة المرتبطة</span></a></section>
      <section class="cm-sec" aria-labelledby="ci-ttl"><h3 id="ci-ttl">${ic("cmTimer", "sm")} الرسائل المؤقتة</h3>
        <p class="u-m0 u-mb6 cm-note">تختفي الرسائل الجديدة من الجميع بعد المدة المختارة.${grp && !admin ? " يغيّرها المشرفون فقط." : ""}</p>
        <div role="radiogroup" aria-labelledby="ci-ttl">${TTLS.map(([v, l]) => `<label class="cm-radio"><input type="radio" name="ttl" value="${v}" ${+c.ttl === v ? "checked" : ""} ${(grp && !admin) || me?.state !== "accepted" ? "disabled" : ""}>${l}</label>`).join("")}</div></section>
      ${grp ? `<section class="cm-sec" aria-labelledby="ci-mem"><h3 id="ci-mem">الأعضاء (${c.members.length})</h3>
        ${admin && c.members.length < MAX_GROUP ? `<button class="cm-li" id="ci-add">${ic("plus")}<span class="cm-mid">إضافة أعضاء<small>حتى ${MAX_GROUP} عضواً</small></span></button>` : ""}
        ${members.map(m => { const u = person(m.user); return `<div class="u-cd cm-li">${av(u, "sm")}<span class="cm-mid"><b>${m.user === DB.me ? "أنت" : h(u.name)}</b><small>@${h(u.handle)}${m.state === "request" ? " · بانتظار القبول" : ""}</small></span>${m.role === "admin" ? `<span class="cm-badge">${m.user === c.owner ? "المالك" : "مشرف"}</span>` : ""}${admin && m.user !== DB.me && m.user !== c.owner ? `<button class="cm-ib" data-mm="${m.user}" aria-label="خيارات ${h(u.name)}">${ic("more")}</button>` : ""}</div>`; }).join("")}
        <button class="cm-li danger" id="ci-leave">${ic("cmBack")}<span class="cm-mid">مغادرة المجموعة</span></button></section>` : ""}
    </div>`;
    view.querySelectorAll("input[name=ttl]").forEach(r => r.onchange = async () => { try { await api("PATCH", `/api/chat/conversations/${cid}`, { ttl: +r.value }); toast(+r.value ? `الرسائل تختفي بعد ${ttlName(r.value)}` : "أُوقفت الرسائل المؤقتة"); delete ST.info[cid]; } catch (e) { errToast(e); infoView(cid); } });
    const en = $("#ci-e2ee"); if (en) en.onclick = async () => {
      try { if (E2()) await E2().enable(cid); else await api("POST", `/api/e2ee/conversations/${cid}/enable`); toast("فُعّل التشفير طرفاً لطرف"); infoView(cid); }
      catch (e) { toast(e.status === 409 ? "الطرف الآخر لم يفعّل التشفير على أي جهاز بعد" : e.message); } };
    const ren = $("#ci-ren"); if (ren) ren.onclick = () => { const s = sheet(`<h4>اسم المجموعة</h4><label class="muted" for="ci-t">الاسم</label><input class="cm-field" id="ci-t" maxlength="80" value="${h(c.title)}"><br><br><button class="btn block" id="ci-ts">حفظ</button>`); const i = s.querySelector("#ci-t"); i.focus(); i.select(); s.querySelector("#ci-ts").onclick = async () => { try { await api("PATCH", `/api/chat/conversations/${cid}`, { title: i.value.trim() }); closeSheet(); infoView(cid); } catch (e) { errToast(e); } }; };
    const add = $("#ci-add"); if (add) add.onclick = () => pickPeople({ title: "إضافة أعضاء", exclude: c.members.map(m => m.user), max: MAX_GROUP - c.members.length, cta: "إضافة", async done(ids) { const r = await api("POST", `/api/chat/conversations/${cid}/members`, { users: ids }); closeSheet(); toast(r.skipped?.length ? `أُضيف ${r.added.length}، وتعذرت إضافة ${r.skipped.length} بسبب إعدادات خصوصيتهم` : `أُضيف ${r.added.length}`); infoView(cid); } });
    view.querySelectorAll("[data-mm]").forEach(b => b.onclick = () => { const m = c.members.find(x => x.user === b.dataset.mm), u = person(m.user);
      const s = sheet(`<h4>${h(u.name)}</h4><div class="menu"><button data-x="role">${m.role === "admin" ? "إلغاء الإشراف" : "تعيين مشرفاً"}</button><a href="#/u/${h(u.handle)}">عرض الملف الشخصي</a><button data-x="rm" class="u-c-dg">إزالة من المجموعة</button></div>`);
      s.querySelector("[data-x=role]").onclick = async () => { try { await api("PATCH", `/api/chat/conversations/${cid}`, { role: { user: m.user, role: m.role === "admin" ? "member" : "admin" } }); closeSheet(); infoView(cid); } catch (e) { errToast(e); } };
      s.querySelector("[data-x=rm]").onclick = async () => { if (!confirm(`إزالة ${u.name} من المجموعة؟`)) return; try { await api("DELETE", `/api/chat/conversations/${cid}/members/${m.user}`); closeSheet(); infoView(cid); } catch (e) { errToast(e); } };
      s.querySelector("button").focus(); });
    const lv = $("#ci-leave"); if (lv) lv.onclick = async () => { if (!confirm("مغادرة المجموعة؟ لن تصلك رسائلها بعد الآن.")) return; try { await api("DELETE", `/api/chat/conversations/${cid}/members/${DB.me}`); ST.convs = (ST.convs || []).filter(x => x.id !== cid); location.hash = "#/messages"; } catch (e) { errToast(e); } };
  }

  /* multi-select people picker (group creation / adding members) */
  function pickPeople({ title, exclude = [], max, cta, done, inline }) {
    const following = new Set((DB.follows || []).filter(f => f.from === DB.me).map(f => f.to));
    const cands = DB.users.filter(u => u.id !== DB.me && !exclude.includes(u.id) && !(DB.blocked || []).includes(u.id)).sort((a, b) => following.has(b.id) - following.has(a.id));
    const sel = new Set();
    const html = `${title ? `<h4>${h(title)}</h4>` : ""}<input class="cm-search" id="pp-q" type="search" placeholder="ابحث بالاسم أو المعرّف" aria-label="ابحث بالاسم أو المعرّف"><div class="cm-sel" id="pp-sel" aria-live="polite"></div><div id="pp-l" role="group" aria-label="الأشخاص"></div><div class="cm-sticky"><button class="btn block" id="pp-go" disabled>${h(cta)}</button></div>`;
    const root = inline || sheet(html); if (inline) inline.innerHTML = html;
    const q = root.querySelector("#pp-q"), list = root.querySelector("#pp-l"), go = root.querySelector("#pp-go");
    const paint = () => {
      const s = q.value.trim();
      list.innerHTML = cands.filter(u => !s || u.name.includes(s) || u.handle.includes(s)).slice(0, 60).map(u => `<button class="cm-li" role="checkbox" aria-checked="${sel.has(u.id)}" data-p="${u.id}">${av(u, "sm").replace(/^<a /, "<span ").replace(/<\/a>$/, "</span>").replace(/ href="[^"]*"/, "")}<span class="cm-mid"><b>${h(u.name)}</b><small>@${h(u.handle)}${following.has(u.id) ? " · تتابعه" : ""}</small></span><span class="cm-ck ${sel.has(u.id) ? "on" : ""}">${sel.has(u.id) ? ic("check") : ""}</span></button>`).join("") || `<div class="cm-empty">لا نتائج</div>`;
      root.querySelector("#pp-sel").innerHTML = [...sel].map(id => `<button data-un="${id}" aria-label="إزالة ${h(person(id).name)}">${h(person(id).name)} ×</button>`).join("");
      go.disabled = !sel.size; go.textContent = sel.size ? `${cta} (${sel.size}${max < MAX_GROUP ? " / " + max : ""})` : cta;
      list.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { const id = b.dataset.p; if (sel.has(id)) sel.delete(id); else if (sel.size >= max) return toast(`الحد الأقصى ${MAX_GROUP} عضواً`); else sel.add(id); paint(); list.querySelector(`[data-p="${id}"]`)?.focus(); });
      root.querySelectorAll("[data-un]").forEach(b => b.onclick = () => { sel.delete(b.dataset.un); paint(); });
    };
    q.oninput = paint; paint();
    go.onclick = async () => { go.disabled = true; try { await done([...sel]); } catch (e) { errToast(e); go.disabled = false; } };
    if (!inline) setTimeout(() => q.focus(), 50);
    return { sel };
  }
  function newGroupView() {
    leaveChat();
    view.innerHTML = `<div class="cm-wrap"><div class="cm-head"><a class="cm-ib" href="#/messages" aria-label="رجوع إلى الرسائل">${ic("cmBack")}</a><h2>مجموعة جديدة</h2></div>
      <label for="ng-t" class="u-fw7">اسم المجموعة</label><input class="u-m0 u-mt6 u-mb4 cm-field" id="ng-t" maxlength="80" placeholder="مثلاً: فريق مطوري Pi في جدة">
      <p class="cm-note">حتى ${MAX_GROUP} عضواً. يُضاف من يقبل رسائلك مباشرة، ومن لا يتابعك تصله دعوة كطلب.</p><h3 class="u-m0 u-mt14 u-mb6">الأعضاء</h3><div id="ng-p"></div></div>`;
    const t = $("#ng-t"); setTimeout(() => t.focus(), 50);
    pickPeople({ inline: $("#ng-p"), max: MAX_GROUP - 1, cta: "إنشاء المجموعة", async done(ids) {
      const title = t.value.trim(); if (!title) { t.focus(); t.setAttribute("aria-invalid", "true"); throw new Error("اكتب اسماً للمجموعة"); }
      const r = await api("POST", "/api/chat/groups", { title, members: ids });
      if (r.skipped?.length) toast(`تعذرت إضافة ${r.skipped.length} بسبب إعدادات خصوصيتهم`);
      location.hash = "#/chat/" + r.conversation.id; } });
  }

  /* =========================== safety number =========================== */
  async function safetyView(peer) {
    leaveChat(); const p = person(peer);
    view.innerHTML = `<div class="cm-wrap"><div class="cm-head"><button class="cm-ib" id="sf-back" aria-label="رجوع">${ic("cmBack")}</button><h2>التحقق من رمز الأمان</h2></div><div class="skel"></div></div>`;
    $("#sf-back").onclick = () => history.back();
    let v = { state: "unverified", number: null };
    try { if (E2()) v = await E2().verification(peer); } catch { }
    const code = v.number, changed = code && v.state === "changed", ok = code && v.state === "verified";
    const groups = code ? code.match(/.{5}/g) : [];
    view.querySelector(".cm-wrap").innerHTML = `<div class="cm-head"><button class="cm-ib" id="sf-back" aria-label="رجوع">${ic("cmBack")}</button><h2>رمز الأمان</h2></div>
      <div class="cm-hero" style="padding-top:4px">${av(p, "lg")}<h2>${h(p.name)}</h2>${ok ? `<span class="cm-badge ok">${ic("check")} تم التحقق</span>` : `<span class="cm-badge">${ic("lock")} لم يتم التحقق بعد</span>`}</div>
      ${changed ? `<div class="cm-warn" role="alert"><b>تغيّر رمز الأمان مع ${h(p.name)}</b><br>غالباً لأنه أضاف جهازاً جديداً أو أعاد تثبيت التطبيق. تحقق منه مجدداً قبل مشاركة أي شيء حساس.</div>` : ""}
      ${code ? `<section class="u-tc cm-sec"><div class="cm-qr" id="sf-qr" role="img" aria-label="رمز QR لرمز الأمان"></div>
        <div class="cm-code" aria-label="رمز الأمان: ${groups.join(" ")}">${groups.map(g => `<span>${g}</span>`).join("")}</div></section>
        <p class="cm-note">قارن هذه الأرقام مع ما يظهر على هاتف ${h(p.name)} وجهاً لوجه أو عبر مكالمة، أو امسح رمز QR من جهازه. إذا تطابقت فرسائلكما لا يقرؤها أحد غيركما.</p>
        <div class="u-dflex u-g8 u-fww u-my12">
          <button class="btn grow" id="sf-mark">${ok ? "إلغاء علامة التحقق" : "وضع علامة «تم التحقق»"}</button>
          ${"BarcodeDetector" in window ? `<button class="btn ghost grow" id="sf-scan">${ic("cmQr", "sm")} مسح الرمز</button>` : ""}
          <button class="btn ghost grow" id="sf-cmp">لصق رمز للمقارنة</button></div>
        <div id="sf-res" role="status" aria-live="polite"></div>`
        : `<div class="cm-empty">${ic("cmKey")}<div><b>لا يوجد رمز أمان بعد</b></div><p>يظهر الرمز عندما يفعّل كلاكما التشفير على جهاز واحد على الأقل.</p><a class="btn" href="#/devices">الأجهزة المرتبطة</a></div>`}`;
    $("#sf-back").onclick = () => history.back();
    if (!code) return;
    loadQR().then(() => { const q = qrcode(0, "M"); q.addData("mp-safety:" + code); q.make(); $("#sf-qr").innerHTML = q.createSvgTag({ cellSize: 5, margin: 1, scalable: true }); }).catch(() => { $("#sf-qr").textContent = "تعذر إنشاء رمز QR"; });
    $("#sf-mark").onclick = async () => { try { if (ok) await E2().unverify(peer); else await E2().verify(peer); toast(ok ? "أُلغيت علامة التحقق" : "تم التحقق ✓"); safetyView(peer); } catch (e) { errToast(e); } };
    const verdict = (other) => { const clean = String(other || "").replace(/^mp-safety:/, "").replace(/\D/g, ""); const res = $("#sf-res"); if (!clean) return;
      res.innerHTML = clean === code ? `<div class="cm-badge ok" style="font-size:15px;padding:10px 14px">${ic("check")} الرمزان متطابقان — يمكنك وضع علامة «تم التحقق»</div>` : `<div class="cm-warn"><b>الرمزان غير متطابقين.</b> قد يكون أحدكما على جهاز جديد. لا تشارك معلومات حساسة حتى تتحققا.</div>`; };
    $("#sf-cmp").onclick = () => { const s = sheet(`<h4>مقارنة رمز الأمان</h4><label for="sf-in" class="muted">الصق الرمز الذي أرسله لك (60 رقماً)</label><textarea class="u-p10 u-mh90 cm-field" id="sf-in" rows="3" dir="ltr" inputmode="numeric"></textarea><br><br><button class="btn block" id="sf-go">قارن</button>`); s.querySelector("#sf-in").focus(); s.querySelector("#sf-go").onclick = () => { const v = s.querySelector("#sf-in").value; closeSheet(); verdict(v); }; };
    const sc = $("#sf-scan"); if (sc) sc.onclick = () => scanQR(verdict);
  }
  function loadQR() { return window.qrcode ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/qrcode.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function scanQR(cb) {
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); } catch { return toast("اسمح باستخدام الكاميرا لمسح الرمز"); }
    const s = sheet(`<h4>وجّه الكاميرا إلى رمز QR على جهاز الطرف الآخر</h4><video id="sf-v" playsinline muted style="width:100%;border-radius:16px;background:#000"></video><br><br><button class="btn ghost block" id="sf-stop">إلغاء</button>`);
    const v = s.querySelector("#sf-v"); v.srcObject = stream; await v.play().catch(() => { });
    const det = new window.BarcodeDetector({ formats: ["qr_code"] }); let alive = true;
    const stop = () => { alive = false; stream.getTracks().forEach(t => t.stop()); };
    s._onclose = stop; s.querySelector("#sf-stop").onclick = closeSheet;
    (async function loop() { while (alive) { try { const r = await det.detect(v); if (r[0]) { const raw = r[0].rawValue; closeSheet(); cb(raw); return; } } catch { } await new Promise(r => setTimeout(r, 250)); } })();
  }

  /* =========================== explainer =========================== */
  function explainerView() {
    leaveChat();
    const step = (i, t, p) => `<div class="cm-step"><span class="n">${ic(i)}</span><div><b>${t}</b><p>${p}</p></div></div>`;
    view.innerHTML = `<div class="cm-wrap"><div class="cm-head"><button class="cm-ib" id="ex-back" aria-label="رجوع">${ic("cmBack")}</button><h2>التشفير طرفاً لطرف</h2></div>
      <div class="cm-hero"><span class="cm-gav lg" aria-hidden="true">${ic("lock", "lg")}</span><h2>رسائلك لك ولمن تراسله فقط</h2><p class="muted">لا يستطيع أحد غيركما قراءتها أو سماعها، ولا حتى مجتمع بلس.</p></div>
      <section class="cm-sec">
        ${step("cmKey", "مفتاح خاص على جهازك", "عند تفعيل التشفير ينشئ جهازك مفتاحاً سرياً لا يغادره أبداً. يُرسل إلى الخادم الجزء العام فقط.")}
        ${step("lock", "تُقفل الرسالة قبل أن تغادر", "تُشفَّر كل رسالة وصورة ورسالة صوتية على جهازك، ولا تُفتح إلا على أجهزة المستلم وأجهزتك المرتبطة.")}
        ${step("shield", "الخادم يرى صندوقاً مغلقاً", "يمرّر مجتمع بلس الرسالة المشفرة دون أن يستطيع فتحها. نعرف فقط أن رسالة أُرسلت ومتى.")}
        ${step("cmQr", "تحقّق من رمز الأمان", "لكل محادثة رمز من 60 رقماً. قارنه مع الطرف الآخر أو امسح رمز QR للتأكد من أنك تراسل الشخص الصحيح.")}
        ${step("cmDevice", "أجهزتك تحت سيطرتك", "كل جهاز مرتبط له مفتاحه. ألغِ أي جهاز لا تعرفه من قائمة الأجهزة المرتبطة فوراً.")}</section>
      <section class="cm-sec"><h3>أسئلة شائعة</h3>
        <details class="u-db u-cd cm-li"><summary class="u-mh44 u-dflex u-aic u-cp"><b>ماذا لو فقدت هاتفي؟</b></summary><p class="cm-note">ألغِ الجهاز من جهاز آخر مرتبط. الرسائل المشفرة القديمة تبقى على الأجهزة التي استلمتها فقط ولا يمكن استعادتها من الخادم.</p></details>
        <details class="u-db u-cd cm-li"><summary class="u-mh44 u-dflex u-aic u-cp"><b>هل يمكن الإبلاغ عن رسالة مشفرة؟</b></summary><p class="cm-note">نعم. عند الإبلاغ ترسل أنت نسخة من الرسالة إلى فريق الأمان بإرادتك، ولا يحدث ذلك تلقائياً.</p></details>
        <details class="u-db u-cd cm-li"><summary class="u-mh44 u-dflex u-aic u-cp"><b>هل المجموعات مشفرة؟</b></summary><p class="cm-note">التشفير طرفاً لطرف متاح حالياً للمحادثات الخاصة، ورسائل المجموعات محمية أثناء النقل.</p></details></section></div>`;
    $("#ex-back").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/messages"));
  }

  /* =========================== linked devices =========================== */
  async function devicesView() {
    leaveChat();
    view.innerHTML = `<div class="cm-wrap"><div class="cm-head"><a class="cm-ib" href="#/messages" aria-label="رجوع إلى الرسائل">${ic("cmBack")}</a><h2>الأجهزة المرتبطة</h2></div><div class="skel"></div></div>`;
    const e2 = E2(); if (e2 && !myDevice()) await e2.ready().catch(() => { }); // registers (or refreshes) this device's public key
    let devices = []; try { devices = (await api("GET", "/api/e2ee/devices")).devices; } catch (e) { errToast(e); }
    const mine = myDevice(), active = devices.filter(d => !d.revoked), revoked = devices.filter(d => d.revoked);
    const kind = (n) => /mac|windows|linux|desktop|حاسوب|كمبيوتر|chrome os/i.test(n || "") ? "cmLaptop" : "cmDevice";
    const row = (d) => `<div class="u-cd cm-li">${ic(kind(d.name))}<span class="cm-mid"><b>${h(d.name)}</b>${d.id === mine ? ` <span class="cm-badge ok">هذا الجهاز</span>` : ""}<small>${d.revoked ? "أُلغي" : "آخر نشاط " + h(relTime(d.lastSeen || d.createdAt))} · رُبط ${h(dayName(d.createdAt))}</small></span>${!d.revoked && d.id !== mine ? `<button class="u-mh40 u-c-dg btn ghost" data-rv="${d.id}" aria-label="إلغاء ربط ${h(d.name)}">إلغاء</button>` : ""}</div>`;
    view.querySelector(".cm-wrap").innerHTML = `<div class="cm-head"><a class="cm-ib" href="#/messages" aria-label="رجوع إلى الرسائل">${ic("cmBack")}</a><h2>الأجهزة المرتبطة</h2></div>
      <p class="cm-note">كل جهاز تسجّل الدخول منه ويفعّل التشفير يحصل على مفتاح خاص به، وتصله رسائلك المشفرة. الحد الأقصى 10 أجهزة.</p>
      ${!mine ? `<div class="cm-warn">${ic("lock", "sm")} التشفير غير مفعّل على هذا الجهاز بعد.${e2 ? `<br><button class="u-mt8 btn" id="dv-en">تفعيل على هذا الجهاز</button>` : ""}</div>` : ""}
      <section class="cm-sec"><h3>الأجهزة النشطة (${active.length})</h3>${active.map(row).join("") || `<p class="cm-note">لا أجهزة بعد</p>`}</section>
      ${revoked.length ? `<section class="cm-sec"><h3>أجهزة أُلغيت</h3>${revoked.slice(0, 5).map(row).join("")}</section>` : ""}
      <a class="cm-li" href="#/e2ee">${ic("cmInfo")}<span class="cm-mid">لربط جهاز جديد<small>سجّل الدخول من الجهاز الآخر وافتح الرسائل؛ سيظهر هنا تلقائياً. تحقّق من أي جهاز لا تعرفه وألغِه.</small></span></a>`;
    view.querySelectorAll("[data-rv]").forEach(b => b.onclick = async () => { if (!confirm("إلغاء ربط هذا الجهاز؟ لن تصله رسائلك المشفرة بعد الآن.")) return; try { await (e2 ? e2.revoke(b.dataset.rv) : api("DELETE", "/api/e2ee/devices/" + b.dataset.rv)); toast("أُلغي ربط الجهاز"); devicesView(); } catch (e) { errToast(e); } });
    const en = $("#dv-en"); if (en) en.onclick = async () => { en.disabled = true; try { await e2.ready(); toast("فُعّل التشفير على هذا الجهاز"); devicesView(); } catch (e) { errToast(e); en.disabled = false; } };
  }

  /* =========================== wiring =========================== */
  MPRoutes.extend((a, b, base) => {
    if (!online()) return base; // offline/demo mode keeps the local device chat
    return { messages: () => listView(), chat: () => chatView(a), chatinfo: () => infoView(a), newgroup: () => newGroupView(), safety: () => safetyView(a), e2ee: () => explainerView(), devices: () => devicesView(),
      "message-requests": () => location.replace("#/messages?tab=requests") };
  });
  addEventListener("hashchange", () => { const r = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0]; if (r !== "chat") leaveChat(); });
  // profile «رسالة» button: open the server conversation directly instead of a local placeholder
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("#msg"); if (!b || !online()) return;
    const handle = location.hash.split("/")[2]; const u = DB.users.find(x => x.handle === decodeURIComponent(handle || "")); if (!u) return;
    e.preventDefault(); e.stopImmediatePropagation(); openDm(u.id);
  }, true);
  const _badges = App.refreshBadges;
  App.refreshBadges = function () { _badges.apply(this, arguments); if (online() && ST.convs) badge(); };
  document.addEventListener("visibilitychange", () => { const c = curConv(); if (!document.hidden && c) markRead(c); });
  if (online()) { bindStream(); loadList().then(badge).catch(() => { }); }
  window.MPCommsUI = { listView, chatView, infoView, safetyView, devicesView, state: ST };
})();
