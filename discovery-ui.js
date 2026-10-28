/* =====================================================================
 * مجتمع بلس — v2.6 discovery layer (Track 5: phases 21–25), loaded as a lazy chunk.
 * Feed: server-ranked «لك», chronological tab/option, customisable & reorderable tabs, «وصلت لآخر الجديد»
 * marker, «لماذا أرى هذا» with weighted factors, «أكثر/أقل من هذا», meaningful-read (dwell) signals.
 * Search screen: typeahead listbox (keyboard), filters, history, trending suggestions, spelling
 * correction, grouped results, saved searches with alerts. Explore: magazine layout with coloured topic
 * cards, location trends, AI summaries. Topic & hashtag pages with follow. Collections grid with
 * drag-and-drop, folders, notes, read-later reminders, sharing, offline sync (IndexedDB + outbox +
 * Background Sync). People lists. «فاتك اليوم» digest. Summary card on top of discussions.
 * Styles are injected by this chunk so the core CSS stays inside its budget.
 * ===================================================================== */
(function DiscoveryLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const h = (s) => esc(String(s ?? ""));
  const enc = encodeURIComponent;
  const nf = (n) => (window.UI ? UI.nfmt(n) : String(n || 0)) || "0";
  const cssMedia = (u) => `url('${u}') center/cover no-repeat`;
  const asClientPost = (x) => { const y = { ...x }; if (y.media && y.media.startsWith("/media/")) y.media = cssMedia(y.media); if (y.images) y.images = y.images.map(i => i.startsWith("/media/") ? cssMedia(i) : i);
    // shapes the device renderers expect from hydrated posts (bootstrap adds vote state)
    if (y.type === "discussion") { y.stances ||= []; y.stanceVoters ||= {}; }
    if (y.poll) y.poll = { ...y.poll, voters: y.poll.voters || {}, options: (y.poll.options || []).map(o => ({ v: 0, ...o })) };
    return y; };
  const live = (msg) => { const r = document.getElementById("d-live"); if (r) { r.textContent = ""; setTimeout(() => (r.textContent = msg), 30); } };
  /* async views re-render when a background refresh lands: keep the current page on screen (no skeleton
   * flash, no scroll jump, no replayed entrance motion) when it is the same route being refreshed */
  let DV = { key: null, el: null };
  const loading = (n) => { const re = DV.key === location.hash && !!DV.el && view.firstElementChild === DV.el; if (!re) view.innerHTML = skel(n); return re; };
  const painted = (re) => { DV = { key: location.hash, el: view.firstElementChild }; if (re && DV.el) DV.el.classList.add("dv-re"); };
  const TOPIC_ICON = { ai: "cpu", dev: "code", startups: "rocket", invest: "trendUp", pi: "pi", design: "palette", games: "gamepad", learn: "book" };
  const topicGlyph = (slug, emoji, cls = "lg") => TOPIC_ICON[slug] ? ic(TOPIC_ICON[slug], cls) : h(emoji || "");
  const COL_ICONS = ["book", "bulb", "target", "tool", "palette", "star"];
  const colGlyph = (c, cls = "sm") => c?.emoji && c.emoji.startsWith("i:") ? ic(c.emoji.slice(2), cls) : c?.emoji ? h(c.emoji) : ic("bookmark", cls);
  const TOPIC_NAMES = { ai: "الذكاء الاصطناعي", dev: "البرمجة", startups: "الشركات الناشئة", invest: "الاستثمار", pi: "Pi Network", design: "التصميم", games: "الألعاب", learn: "التعلم" };

  /* ---------- extra icons (appended to the shared sprite) ---------- */
  const ICONS = {
    film: '<path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/>',
    grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
    sliders: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
    down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m18 15-6-6-6 6"/>',
    thumbUp: '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/>',
    thumbDown: '<path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/><path d="M17 14V2"/>',
    offline: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
    cpu: '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    rocket: '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
    trendUp: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
    palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
    gamepad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
    book: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
    pi: '<path d="M5 7h14M9 7v11M15 7v8.5a2.5 2.5 0 0 0 4 1.5"/>',
    bellPlus: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M15 8h6"/><path d="M18 5v6"/><path d="M20.002 14.464a9 9 0 0 0 .738.863A1 1 0 0 1 20 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 8.75-5.332"/>', note: '<path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/>'
  };
  (function sprite() {
    const s = document.querySelector("svg[aria-hidden] symbol")?.parentNode; if (!s) return;
    s.insertAdjacentHTML("beforeend", Object.entries(ICONS).filter(([k]) => !document.getElementById("i-" + k)).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join(""));
  })();

  /* ---------- styles ---------- */
  const STYLES = `
.d-grip,.d-icon-btn,.ci-acts button,.col-acts button,.x-follow,.tp-follow,.s-sec button,.s-note button,.col-new,.d-tabedit,.d-cite,.d-ctrls button,.d-quick button,.s-chip{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:0}
.s-box [hidden],.s-sugg[hidden]{display:none!important}
input[type=search]::-webkit-search-cancel-button{-webkit-appearance:none;display:none}
.s-chip[aria-pressed=true]{border-color:var(--accent);background:var(--accent2);color:var(--accent-ink)}
.x-emo .ic{width:30px;height:30px;stroke-width:1.8}.tp-head .x-emo .ic{width:40px;height:40px}.col-mosaic.empty .ic{width:44px;height:44px}
.dv-re,.dv-re>*{animation:none!important}
.d-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.d-tabedit{flex:none;width:38px;height:38px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text-2);display:grid;place-items:center}
.d-tabedit:hover{border-color:var(--accent);color:var(--accent)}
.d-caught{display:flex;align-items:center;gap:10px;margin:6px 0 14px;color:var(--ok-ink);font-weight:750;font-size:13.5px}
.d-caught::before,.d-caught::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--ok) 45%,transparent),transparent)}
.d-caught span{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--ok) 11%,var(--card));color:var(--ok-ink)}
.d-why-bar{height:6px;border-radius:4px;background:var(--bg-2);overflow:hidden;margin-top:6px}.d-why-bar i{display:block;height:100%;border-radius:4px;background:var(--grad)}
.d-why-row{padding:10px 0;border-bottom:1px solid var(--line)}.d-why-row.neg i{background:var(--danger)}
.d-ctrls{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.d-ctrls button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 14px;font-weight:650;font-size:13.5px;display:inline-flex;gap:6px;align-items:center}
.d-ctrls button:hover{border-color:var(--accent);color:var(--accent)}
.d-tablist{display:flex;flex-direction:column;gap:8px;margin:8px 0 14px}
.d-tabrow{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:6px 8px;touch-action:none}
.d-tabrow input[type=text]{flex:1;min-width:0;padding:8px 10px;border-radius:10px}
.d-tabrow.off{opacity:.55}
.d-grip{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--muted);cursor:grab;flex:none}
.d-grip:hover,.d-grip:focus-visible{background:var(--bg-2);color:var(--text)}
.d-dragging{position:fixed!important;z-index:80;pointer-events:none;box-shadow:var(--sh-3)!important;transform:scale(1.03) rotate(-1deg);transition:none!important;opacity:.96}
.d-ph{border:2px dashed color-mix(in srgb,var(--accent) 45%,transparent);border-radius:var(--r);background:var(--accent2)}
.d-icon-btn{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;color:var(--muted);flex:none}
.d-icon-btn:hover{background:var(--bg-2);color:var(--text)}
.d-digest{position:relative;overflow:hidden;border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);background:linear-gradient(135deg,color-mix(in srgb,var(--accent2) 85%,var(--card)),var(--card))}
.d-digest h2{font-size:16.5px;font-weight:800;display:flex;align-items:center;gap:8px;margin:0 0 6px}
.d-digest .d-x{position:absolute;top:10px;inset-inline-end:10px}
.d-ai{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:750;color:var(--accent-ink);background:var(--accent2);border-radius:999px;padding:3px 9px}
.d-points{margin:10px 0 2px;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}
.d-points li{position:relative;padding-inline-start:20px;line-height:1.75;font-size:14.5px}
.d-points li::before{content:"";position:absolute;inset-inline-start:4px;top:.75em;width:7px;height:7px;border-radius:50%;background:var(--grad)}
.d-cite{display:inline-flex;align-items:center;margin-inline-start:4px;font-size:11.5px;font-weight:750;color:var(--accent-ink);background:var(--card);border:1px solid color-mix(in srgb,var(--accent) 25%,transparent);border-radius:999px;padding:0 8px;line-height:20px;vertical-align:1px;cursor:pointer}
.d-cite:hover{background:var(--accent2)}
.d-sum{border:1px solid color-mix(in srgb,var(--accent) 20%,transparent);background:linear-gradient(160deg,var(--accent2),var(--card) 60%)}
.d-sum-h{display:flex;align-items:center;gap:8px;justify-content:space-between}
.d-sum-h b{font-size:15.5px;display:flex;gap:7px;align-items:center}
.d-sum-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--muted)}
.d-flash{animation:dflash 1.6s var(--ease)}@keyframes dflash{0%,40%{box-shadow:0 0 0 3px var(--accent)}100%{box-shadow:0 0 0 0 transparent}}
.x-search{display:flex;align-items:center;gap:10px;background:var(--card);border:1.5px solid var(--line);border-radius:18px;padding:13px 16px;color:var(--muted);font-weight:600;box-shadow:var(--sh-1);margin-bottom:14px}
.x-search:hover{border-color:var(--accent)}
.x-kicker{font-size:12px;font-weight:800;letter-spacing:.3px;color:var(--accent-ink);text-transform:uppercase}
.x-clips{margin-bottom:6px}.x-clips .x-h{margin-top:14px}.x-clips h2{display:flex;align-items:center;gap:7px}.x-clips h2 .ic{color:var(--accent)}
.x-clip-row{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 20px)/2.6);gap:10px;overflow-x:auto;padding:2px 2px 8px;margin:0 -2px;scroll-snap-type:x mandatory;scrollbar-width:none}.x-clip-row::-webkit-scrollbar{display:none}
@media (min-width:720px){.x-clip-row{grid-auto-flow:row;grid-template-columns:repeat(6,1fr);grid-auto-columns:auto;overflow:visible}}
.x-clip{position:relative;display:block;aspect-ratio:9/16;min-height:44px;border-radius:18px;overflow:hidden;background:linear-gradient(160deg,color-mix(in srgb,var(--brand-1) 45%,black),black);box-shadow:var(--sh-1);scroll-snap-align:start;color:white;margin:0;height:auto}
.x-clip:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.x-clip img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.x-clip::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgb(0 0 0 / .7));pointer-events:none}
.x-clip-ph{position:absolute;inset:0;display:grid;place-items:center;color:rgb(255 255 255 / .85)}
.x-clip-cap{position:absolute;z-index:1;inset-inline:8px;bottom:28px;font-size:12px;font-weight:750;line-height:1.4;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;text-shadow:0 1px 3px black}
.x-clip-dur{position:absolute;z-index:1;top:8px;inset-inline-end:8px;font-size:11.5px;font-weight:800;background:rgb(0 0 0 / .65);border-radius:999px;padding:2px 8px}
.x-res-bar{position:absolute;z-index:2;inset-inline:0;bottom:0;height:4px;background:rgb(255 255 255 / .3)}.x-res-bar i{display:block;height:100%;background:var(--accent)}
.x-clip-v{position:absolute;z-index:1;bottom:8px;inset-inline-start:8px;display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:750;max-width:calc(100% - 16px);overflow:hidden;white-space:nowrap;text-shadow:0 1px 3px black}
@media (min-width:720px){.x-clip-v>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}}
.x-h{display:flex;align-items:baseline;justify-content:space-between;margin:22px 2px 10px}
.x-h h2{font-size:19px;font-weight:850;letter-spacing:-.2px;margin:0}
.x-h a{font-size:13px;font-weight:700;color:var(--accent-ink)}
.x-locs{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;margin:0 -2px;scrollbar-width:none}.x-locs::-webkit-scrollbar{display:none}
.x-locs button{flex:none;display:inline-flex;align-items:center;gap:6px}
.x-hero{position:relative;border-radius:26px;padding:22px 20px 18px;color:#fff;background:radial-gradient(120% 90% at 100% 0%,#8b5cf6 0%,transparent 55%),linear-gradient(150deg,#1e1145 0%,#3b1d8f 55%,#6d28d9 100%);box-shadow:var(--sh-2);overflow:hidden}
.x-hero::after{content:"";position:absolute;inset:auto -40px -60px auto;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,#ff7ab633,transparent 70%)}
.x-hero .x-kicker{color:#e9ddff}
.x-hero h2{font-size:27px;font-weight:900;margin:6px 0 4px;letter-spacing:-.4px;word-break:break-word}
.x-hero .x-meta{color:#e4dcff;font-size:13.5px;font-weight:600}
.x-hero .d-points li{font-size:14.5px;color:#fff}.x-hero .d-points li::before{background:#ffb4d9}
.x-hero .d-ai{background:#ffffff26;color:#fff}
.x-hero a.x-go{display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-weight:800;color:#fff;background:#ffffff1f;border-radius:999px;padding:8px 14px}
.x-topics{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.x-topic{position:relative;display:flex;flex-direction:column;justify-content:space-between;min-height:132px;border-radius:22px;padding:14px;color:#fff;overflow:hidden;box-shadow:var(--sh-1);isolation:isolate;transition:transform .2s var(--ease)}
.x-topic:hover{transform:translateY(-2px)}
.x-topic::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(160deg,transparent 30%,#0000002e)}
.x-topic .x-emo{font-size:30px;line-height:1;filter:drop-shadow(0 4px 8px #0003)}
.x-topic b{display:block;font-size:16px;font-weight:850;line-height:1.35;margin-top:8px}
.x-topic small{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;color:#fff;opacity:.92;font-size:12px;font-weight:650;margin-top:2px}
.x-topic .x-follow{position:absolute;top:10px;inset-inline-end:10px;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:800;background:#00000038;color:#fff}
.x-topic .x-follow[aria-pressed=true]{background:#fff;color:var(--tc)}
.x-topic.wide{grid-column:span 2;min-height:118px}
.x-list{background:var(--card);border-radius:var(--r);box-shadow:var(--sh-1);padding:4px 14px}
.x-tr{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.x-tr:last-child{border-bottom:0}
.x-tr .x-rank{width:28px;font-size:20px;font-weight:900;color:var(--line-2);font-variant-numeric:tabular-nums;text-align:center}
.x-tr .x-tag{font-weight:800;font-size:15px;color:var(--text)}
.x-tr .x-sub{font-size:12.5px;color:var(--muted);font-weight:600}
.x-up{margin-inline-start:auto;color:var(--ok-ink);font-size:12px;font-weight:800;background:color-mix(in srgb,var(--ok) 12%,transparent);padding:3px 8px;border-radius:999px;white-space:nowrap}
.x-row{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;margin:0 -2px;scroll-snap-type:x mandatory;scrollbar-width:none}.x-row::-webkit-scrollbar{display:none}
.x-art{flex:0 0 74%;scroll-snap-align:start;background:var(--card);border-radius:20px;box-shadow:var(--sh-1);overflow:hidden;display:flex;flex-direction:column}
.x-art .x-cover{height:104px;background:var(--grad)}
.x-art div.x-body{padding:12px 14px}.x-art b{display:block;font-size:15px;line-height:1.5;font-weight:800;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.x-art small{color:var(--muted);font-weight:600}
.x-comm{flex:0 0 46%;scroll-snap-align:start;background:var(--card);border-radius:20px;box-shadow:var(--sh-1);padding:14px;display:flex;flex-direction:column;gap:6px}
.x-comm .x-cav{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:900;font-size:18px}
.x-comm b{font-size:14.5px;line-height:1.4}.x-comm small{color:var(--muted);font-weight:600}
.s-top{position:sticky;top:calc(var(--top-h) + env(safe-area-inset-top));z-index:6;background:linear-gradient(var(--bg) 82%,transparent);margin:0 -12px;padding:2px 12px 10px}
.s-box{position:relative}
.s-box input{width:100%;padding:14px 46px 14px 44px;border-radius:18px;font-size:16px;background:var(--card);box-shadow:var(--sh-1)}
.s-box .s-ic{position:absolute;inset-inline-start:15px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
.s-box .s-clear{position:absolute;inset-inline-end:8px;top:50%;transform:translateY(-50%)}
.s-sugg{position:absolute;inset-inline:0;top:calc(100% + 6px);background:var(--elev);border-radius:18px;box-shadow:var(--sh-3);padding:6px;z-index:9;max-height:60vh;overflow:auto}
.s-opt{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;cursor:pointer;font-weight:600}
.s-opt[aria-selected=true],.s-opt:hover{background:var(--accent2)}
.s-opt .muted{font-size:12px;margin-inline-start:auto}
.s-opt mark{background:none;color:var(--accent-ink);font-weight:850}
.s-filters{display:flex;gap:8px;overflow-x:auto;padding:10px 0 4px;scrollbar-width:none}.s-filters>:focus-visible{outline-offset:-3px}.s-filters::-webkit-scrollbar{display:none}
.s-filters .tab{flex:none;padding:7px 14px;font-size:13.5px}
.s-filters select{flex:none;padding-block:7px;padding-inline:12px 30px;border-radius:999px;font-size:13.5px;font-weight:650;background:var(--card);min-height:36px}
.s-sec{display:flex;align-items:center;justify-content:space-between;margin:18px 2px 8px}
.s-sec h3{font-size:15.5px;font-weight:850;margin:0;display:flex;align-items:center;gap:8px}
.s-sec h3 span{font-size:12px;font-weight:750;color:var(--muted);background:var(--bg-2);padding:2px 8px;border-radius:999px}
.s-sec button{font-size:13px;font-weight:750;color:var(--accent-ink)}
.s-chips{display:flex;flex-wrap:wrap;gap:8px}
.s-chip{display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 13px;font-weight:650;font-size:13.5px}
.s-chip:hover{border-color:var(--accent);color:var(--accent-ink)}
.s-hist{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line)}
.s-hist a{flex:1;font-weight:650;display:flex;gap:10px;align-items:center;color:var(--text)}
.s-note{background:var(--accent2);color:var(--accent-ink);border-radius:14px;padding:10px 14px;font-weight:650;margin-top:12px}
.s-note button{font-weight:850;text-decoration:underline;text-underline-offset:3px;color:inherit}
.s-save{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-top:12px}
.s-badge{min-width:20px;height:20px;border-radius:999px;background:var(--like);color:#fff;font-size:11.5px;font-weight:800;display:inline-grid;place-items:center;padding:0 6px}
.col-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.col-tile{position:relative;background:var(--card);border-radius:22px;box-shadow:var(--sh-1);overflow:hidden;display:flex;flex-direction:column;transition:transform .18s var(--ease),box-shadow .18s;touch-action:manipulation}
.col-tile:hover{box-shadow:var(--sh-2)}
.col-mosaic{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;aspect-ratio:1/1;background:var(--bg-2)}
.col-mosaic>div{background-size:cover!important;background-position:center!important;display:flex;align-items:flex-end;padding:8px 9px;font-size:11px;font-weight:700;line-height:1.45;color:var(--text-2);overflow:hidden;min-width:0;min-height:0}
.col-mosaic>div span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.col-mosaic>div.g{color:#fff;text-shadow:0 1px 3px #0006}
.col-mosaic.n1{grid-template-columns:1fr;grid-template-rows:1fr}.col-mosaic.n1>div{font-size:14px;padding:14px}.col-mosaic.n1>div span{-webkit-line-clamp:5}
.col-mosaic.n2{grid-template-rows:1fr}.col-mosaic.n2>div span{-webkit-line-clamp:7}
.col-mosaic.n3>div:first-child{grid-row:span 2}.col-mosaic.n3>div:first-child span{-webkit-line-clamp:7}
.col-mosaic.empty{display:grid;place-items:center;grid-template-columns:1fr;grid-template-rows:1fr}
.col-mosaic.empty span{font-size:40px;opacity:.9}
.col-meta{display:flex;align-items:center;gap:6px;padding:10px 12px 12px}
.col-meta a{flex:1;min-width:0}.col-meta b{display:block;font-size:14.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.col-meta small{color:var(--muted);font-weight:650;font-size:12px;display:flex;flex-wrap:wrap;gap:2px 8px;align-items:center}.col-meta .col-sh{display:inline-flex;gap:3px;align-items:center;color:var(--accent-ink)}
.col-meta .d-grip{width:32px;height:32px;margin-inline-end:-6px;touch-action:none}
.col-new{border:2px dashed var(--line-2);background:transparent;box-shadow:none;align-items:center;justify-content:center;min-height:180px;color:var(--muted);font-weight:750;gap:8px}
.col-new:hover{border-color:var(--accent);color:var(--accent-ink)}
.col-head{border-radius:24px;padding:18px;color:#fff;box-shadow:var(--sh-2);margin-bottom:12px}
.col-head h2{margin:4px 0 2px;font-size:22px;font-weight:900;display:flex;gap:8px;align-items:center}
.col-head p{margin:0;opacity:.92;font-weight:600;font-size:13px}
.col-head .col-acts{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.col-head .col-acts button{background:#00000033;color:#fff;border-radius:999px;padding:7px 13px;font-weight:750;font-size:13px;display:inline-flex;gap:6px;align-items:center}
.col-folders{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:none}.col-folders::-webkit-scrollbar{display:none}
.col-folders span{flex:none;border:1.5px dashed var(--line-2);border-radius:999px;padding:7px 13px;font-size:13px;font-weight:700;color:var(--text-2);background:var(--card);display:inline-flex;gap:6px;align-items:center;transition:all .15s}
.col-folders span.over{border-color:var(--accent);background:var(--accent2);color:var(--accent-ink);transform:scale(1.06)}
.ci{display:flex;gap:10px;align-items:flex-start;background:var(--card);border-radius:18px;box-shadow:var(--sh-1);padding:12px;margin-bottom:10px}
.ci .ci-body{flex:1;min-width:0}
.ci .ci-by{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700}
.ci .ci-text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:6px 0;line-height:1.7;color:var(--text);font-size:14.5px}
.ci .ci-thumb{width:64px;height:64px;border-radius:14px;flex:none;background-size:cover!important;background-position:center!important}
.ci .ci-note{display:flex;gap:6px;align-items:flex-start;background:color-mix(in srgb,var(--warn) 10%,var(--card));border-radius:12px;padding:8px 10px;font-size:13px;color:var(--text-2);margin-top:6px}
.ci .ci-acts{display:flex;gap:4px;margin-top:6px;flex-wrap:wrap}
.ci .ci-acts button{font-size:12.5px;font-weight:700;color:var(--muted);padding:6px 9px;border-radius:10px;display:inline-flex;gap:5px;align-items:center}
.ci .ci-acts button:hover{background:var(--bg-2);color:var(--text)}
.ci .ci-acts .on{color:var(--accent-ink);background:var(--accent2)}.ci .ci-acts .ci-rm{margin-inline-start:auto;padding:6px 8px}
.d-back{display:inline-flex;align-items:center;gap:6px;min-height:var(--h-md);color:var(--muted);font-size:var(--fs-sm);font-weight:600}
.d-offline{display:flex;gap:8px;align-items:center;background:color-mix(in srgb,var(--warn) 14%,var(--card));color:#8a4b00;border-radius:14px;padding:9px 12px;font-weight:700;font-size:13px;margin-bottom:10px}
.d-quick{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.d-quick button{border:1px solid var(--line);border-radius:14px;padding:12px;font-weight:700;background:var(--card);text-align:start}
.d-quick button:hover{border-color:var(--accent)}
.d-quick small{display:block;color:var(--muted);font-weight:600;font-size:12px}
.tp-head{display:block;border-radius:var(--r-lg,24px);padding:22px 18px 18px;color:#fff;box-shadow:var(--sh-2);position:relative;overflow:hidden;margin-bottom:12px}
.tp-head .x-emo{font-size:42px}
.tp-head h2{font-size:var(--fs-3xl,26px);font-weight:800;margin:8px 0 4px;line-height:1.25}
.tp-head p{margin:0 0 12px;opacity:.95;font-weight:600;line-height:1.7}
.tp-head .tp-stats{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;font-weight:700;opacity:.95;margin-bottom:12px}
.tp-follow{border-radius:999px;padding:9px 18px;font-weight:850;background:#fff;color:var(--tc)}
.tp-follow[aria-pressed=true]{background:#00000038;color:#fff}
.pl-card{display:flex;gap:12px;align-items:center}
.pl-av{display:flex}.pl-av .av{margin-inline-start:-10px;border:2px solid var(--card)}.pl-av .av:first-child{margin-inline-start:0}
@media (min-width:700px){.x-topics{grid-template-columns:repeat(3,1fr)}.col-grid{grid-template-columns:repeat(3,1fr)}.x-art{flex-basis:44%}.x-comm{flex-basis:30%}}
@media (prefers-reduced-motion:reduce){.x-topic,.col-tile,.d-flash{transition:none;animation:none}}`;
  if (!document.getElementById("d-css")) { const st = document.createElement("style"); st.id = "d-css"; st.textContent = STYLES; document.head.appendChild(st); }
  if (!document.getElementById("d-live")) document.body.insertAdjacentHTML("beforeend", `<div id="d-live" class="d-sr" aria-live="polite"></div>`);

  /* ---------- shared helpers ---------- */
  function ensureUsers(users) { for (const u of users || []) if (u && !S.user(u.id)) DB.users.push({ topics: [], ...u }); }
  function card(p) { const local = S.post(p.id); if (!local && !S.user(p.author)) return ""; return postCard(local || asClientPost(p)); }
  const skel = (n = 2) => `<div class="wrap">${'<div class="skel"></div>'.repeat(n)}</div>`;
  const errBox = (msg, retry) => `<div class="empty err" role="alert">${ic("offline")}<span class="empty-t">تعذّر التحميل</span>${msg ? `<span class="empty-x">${h(msg)}</span>` : ""}${retry ? `<button class="btn ghost" id="d-retry">${ic("refresh", "sm")} إعادة المحاولة</button>` : ""}</div>`;
  const bindRetry = (fn) => { const b = document.getElementById("d-retry"); if (b) b.onclick = fn; };
  const postText = (p) => (p.title || p.text || "").replace(/\s+/g, " ").trim();
  const thumbBg = (m) => !m ? null : m.startsWith("/media/") ? cssMedia(m) : m.startsWith("url(") || m.startsWith("linear-gradient") ? m : null;
  const ago = (iso) => (typeof relTime === "function" ? relTime(iso) : "");
  function points(sum, { onCite } = {}) {
    if (!sum || !sum.points?.length) return "";
    return `<ul class="d-points">${sum.points.map(p => `<li>${h(p.text)}${(p.cites || []).map(c => `<button class="d-cite" data-cite="${h(c.id || c)}" data-kind="${h(c.kind || "post")}" aria-label="المصدر: ${h(c.author || "منشور")}">${h(c.author ? c.author.split(" ")[0] : "مصدر")}</button>`).join("")}</li>`).join("")}</ul>`;
  }
  const aiLabel = (sum) => `<span class="d-ai" title="${h(sum?.label || "ملخص مولّد آلياً")}">${ic("sparkle", "xs")} مولّد آلياً</span>`;

  /* ---------- drag & drop (pointer + keyboard), shared by tabs, folders and saved items ---------- */
  function sortable(box, { item, handle, onEnd, targets, onDrop, grid = false, longPress = 280 }) {
    let drag = null;
    const start = (el, e) => {
      const r = el.getBoundingClientRect(), ph = document.createElement("div");
      ph.className = "d-ph"; ph.style.height = r.height + "px"; if (grid) ph.style.minHeight = r.height + "px";
      el.after(ph);
      drag = { el, ph, dx: e.clientX - r.left, dy: e.clientY - r.top, over: null, moved: false };
      Object.assign(el.style, { width: r.width + "px", height: r.height + "px", left: r.left + "px", top: r.top + "px" });
      el.classList.add("d-dragging");
      try { navigator.vibrate && navigator.vibrate(10); } catch { /* no haptics */ }
    };
    const move = (e) => {
      if (!drag) return; e.preventDefault(); drag.moved = true;
      drag.el.style.left = e.clientX - drag.dx + "px"; drag.el.style.top = e.clientY - drag.dy + "px";
      const tgt = targets ? [...document.querySelectorAll(targets)].find(t => { const r = t.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }) : null;
      document.querySelectorAll(targets || "x-none").forEach(t => t.classList.toggle("over", t === tgt)); drag.over = tgt || null;
      if (tgt) return;
      const sibs = [...box.querySelectorAll(item)].filter(x => x !== drag.el);
      let best = null, bd = Infinity;
      for (const s of sibs) { const r = s.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.hypot(e.clientX - cx, (e.clientY - cy) * (grid ? 1 : 3)); if (d < bd) { bd = d; best = { s, r, cx, cy } } }
      if (!best) return;
      const after = grid ? (e.clientY > best.cy + best.r.height / 4 || (Math.abs(e.clientY - best.cy) < best.r.height / 4 && (document.dir === "rtl" ? e.clientX < best.cx : e.clientX > best.cx))) : e.clientY > best.cy;
      if (after) best.s.after(drag.ph); else best.s.before(drag.ph);
    };
    const end = () => {
      if (!drag) return; const { el, ph, over, moved } = drag; drag = null;
      document.querySelectorAll(targets || "x-none").forEach(t => t.classList.remove("over"));
      el.classList.remove("d-dragging"); el.removeAttribute("style"); ph.replaceWith(el);
      if (over && onDrop) return onDrop(over, el);
      if (moved) onEnd([...box.querySelectorAll(item)].map(x => x.dataset.id));
    };
    box.addEventListener("pointerdown", (e) => {
      const el = e.target.closest(item); if (!el || !box.contains(el) || e.button > 0) return;
      const onHandle = handle && e.target.closest(handle);
      if (onHandle) { e.preventDefault(); start(el, e); el.setPointerCapture?.(e.pointerId); return; }
      if (e.pointerType !== "touch" || !longPress) return;
      const t0 = { x: e.clientX, y: e.clientY };
      const timer = setTimeout(() => { start(el, e); }, longPress);
      const cancel = (ev) => { if (!drag && (!ev.clientX || Math.hypot(ev.clientX - t0.x, ev.clientY - t0.y) > 8)) { clearTimeout(timer); box.removeEventListener("pointermove", cancel); } };
      box.addEventListener("pointermove", cancel); box.addEventListener("pointerup", () => clearTimeout(timer), { once: true });
    });
    addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", end); addEventListener("pointercancel", end);
    box.addEventListener("click", (e) => { if (e.target.closest(".d-dragging")) e.preventDefault(); }, true);
    // keyboard: focus a handle, then arrows move the item (RTL-aware), announced to screen readers
    box.addEventListener("keydown", (e) => {
      const hd = handle && e.target.closest(handle); if (!hd) return;
      const el = hd.closest(item), list = [...box.querySelectorAll(item)], i = list.indexOf(el);
      const fwd = ["ArrowDown", document.dir === "rtl" ? "ArrowLeft" : "ArrowRight"], back = ["ArrowUp", document.dir === "rtl" ? "ArrowRight" : "ArrowLeft"];
      let j = i; if (fwd.includes(e.key)) j = Math.min(list.length - 1, i + 1); else if (back.includes(e.key)) j = Math.max(0, i - 1); else return;
      e.preventDefault(); if (j === i) return;
      if (j > i) list[j].after(el); else list[j].before(el);
      hd.focus(); live(`نُقل إلى الموضع ${j + 1} من ${list.length}`);
      onEnd([...box.querySelectorAll(item)].map(x => x.dataset.id));
    });
    return () => { removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
  }
  let dndCleanup = []; const cleanDnd = () => { dndCleanup.forEach(f => f()); dndCleanup = []; };
  addEventListener("hashchange", cleanDnd);

  /* =================== Phase 21 — smarter feed on Home =================== */
  const FD = { prefs: null, ranked: {}, fetching: {}, seenSession: new Set(), lastSeenSent: 0 };
  async function loadPrefs(force) { if (!online()) return null; if (FD.prefs && !force) return FD.prefs; try { FD.prefs = await api("GET", "/api/feed/prefs"); } catch { FD.prefs = null; } return FD.prefs; }
  async function fetchRanked(mode) {
    if (!online() || FD.fetching[mode]) return;
    FD.fetching[mode] = true;
    try {
      const r = await api("GET", `/api/feed?mode=${enc(mode)}&limit=50`);
      ensureUsers(r.users);
      FD.ranked[mode] = { at: Date.now(), posts: r.posts, set: new Set(r.posts.map(p => p.id)), seenAt: r.seenAt, fresh: r.freshCount, mode: r.mode };
    } catch { /* keep local ordering */ } finally { FD.fetching[mode] = false; }
    if (FD.ranked[mode]) reorderIfNeeded(mode);
    // phase 40: a promoted item is never shown without its «مُروَّج» label — load the ads chunk first, then repaint
    if (!window.MPAds && FD.ranked[mode]?.posts.some(p => p.promoted)) window.MPChunks?.load("ads").then(() => reorderIfNeeded(mode)).catch(() => { });
  }
  /* Home was painted from the local order (first load) or an older ranking: repaint once the server order
   * differs, but never under the viewer's thumb (scrolled down, a sheet open, typing) */
  function reorderIfNeeded(mode) {
    const eff = FD.prefs?.chrono && feedMode === "for" ? "chrono" : feedMode;
    if (mode !== eff || !/^#?\/?(home)?$|^#\/home/.test(location.hash || "#/home") || scrollY > 400 || !$("#sheet")?.classList.contains("hidden") || ["TEXTAREA", "INPUT", "SELECT"].includes(document.activeElement?.tagName)) return;
    const shown = [...view.querySelectorAll(".wrap > .post-card")].map(c => c.querySelector("[data-more]")?.dataset.more);
    if (!shown.length) return;
    const next = Feed.build(feedMode).slice(0, shown.length).map(p => p.id);
    if (shown.join() !== next.join()) rerender();
  }
  const followedTopics = { topics: [], tags: [] };
  async function loadFollows() { if (!online()) return; try { Object.assign(followedTopics, await api("GET", "/api/follows/topics")); } catch { /* optional */ } }
  function localMode(mode) {
    const vis = S.visiblePosts().filter(p => p.status === "published" && p.type !== "story" && !DB.muted.posts.includes(p.id) && !DB.blocked.includes(p.author));
    if (mode === "chrono") return vis.filter(p => p.author === DB.me || S.follows(DB.me, p.author) || (p.community && S.membership(p.community)) || followedTopics.topics.includes(p.topic) || S.hashtags(p.text).some(t => followedTopics.tags.includes(t))).sort(byNew);
    if (mode.startsWith("topic:")) return vis.filter(p => p.topic === mode.slice(6)).sort(byNew);
    if (mode.startsWith("tag:")) return vis.filter(p => S.hashtags(p.text).includes(mode.slice(4))).sort(byNew);
    return null;
  }
  const _build = Feed.build;
  Feed.build = function (mode) {
    let eff = mode;
    if (mode === "for" && FD.prefs?.chrono) eff = "chrono";
    const isServerList = mode.startsWith("list:") && !DB.lists.some(l => "list:" + l.id === mode);
    const local = localMode(eff) || (isServerList ? [] : _build.call(Feed, eff));
    const srv = online() && FD.ranked[eff];
    if (!srv || (!srv.posts.length && local.length && !isServerList)) { if (online() && (eff === "for" || eff === "chrono" || isServerList || eff.includes(":"))) fetchRanked(eff); return local; }
    if (srv.stale || Date.now() - srv.at > 60e3) fetchRanked(eff);
    const fresh = local.filter(p => !srv.set.has(p.id) && new Date(p.createdAt).getTime() > srv.at - 5000);
    const list = srv.posts.filter(sp => !sp.promoted || window.MPAds).map(sp => { const lp = S.post(sp.id); return lp ? (lp.status === "deleted" ? null : lp) : (S.user(sp.author) ? asClientPost(sp) : null); })
      .filter(p => p && !DB.muted.posts.includes(p.id) && !DB.blocked.includes(p.author) && !(DB.muted.users || []).includes(p.author));
    // what is new since the last visit comes first (in ranked order), then «وصلت لآخر الجديد», then the rest
    const seen = Date.parse(FD.prefs?.seenAt || srv.seenAt || ""), isNew = (p) => Date.parse(p.createdAt) > seen;
    return [...fresh, ...(seen ? [...list.filter(isNew), ...list.filter(p => !isNew(p))] : list)];
  };
  function tabsHTML() {
    const p = FD.prefs; if (!p) return null;
    const label = (t) => t.label || ({ for: "لك", following: "أتابع", chrono: "زمني", latest: "الأحدث", discover: "استكشف", communities: "مجتمعاتي" }[t.id] || (t.id.startsWith("topic:") ? TOPIC_NAMES[t.id.slice(6)] || t.id.slice(6) : t.id.startsWith("tag:") ? "#" + t.id.slice(4) : "قائمة"));
    const tabs = p.tabs.filter(t => !t.hidden).map(t => [t.id, label(t)]);
    for (const l of DB.lists) if (!tabs.some(([k]) => k === "list:" + l.id)) tabs.push(["list:" + l.id, l.name]);
    return tabs.map(([k, l]) => `<button class="tab ${feedMode === k ? "on" : ""}" data-mode="${h(k)}" aria-pressed="${feedMode === k}">${h(l)}</button>`).join("") +
      `<button class="d-tabedit" id="d-tabedit" aria-label="تخصيص تبويبات الخلاصة وترتيبها" title="تخصيص التبويبات">${ic("sliders", "sm")}</button>`;
  }
  function enhanceHome() {
    if (online() && (!booted || bootedFor !== DB.me)) { ready(); return; }
    if (!online() || !view || !String(location.hash || "#/home").match(/^#?\/?(home)?$|^#\/home/)) return;
    const tabs = view.querySelector(".tabs"); if (!tabs) return;
    const html = tabsHTML();
    if (html && !tabs.querySelector("#d-tabedit")) {
      tabs.innerHTML = html; tabs.setAttribute("aria-label", "تبويبات الخلاصة");
      tabs.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { feedMode = b.dataset.mode; feedLimit = 10; rerender(); });
      tabs.querySelector("#d-tabedit").onclick = tabEditor;
      { const on = tabs.querySelector(".tab.on"); if (on && on !== tabs.querySelector(".tab")) requestAnimationFrame(() => setTimeout(() => on.isConnected && on.scrollIntoView({ inline: "nearest", block: "nearest" }), 0)); } // v2.52: after the first paint (no forced layout on route change)
    }
    caughtUpMarker(); digestCard(); dwellWatch();
  }
  /* «وصلت لآخر الجديد» — placed after the last post newer than the previous visit */
  function caughtUpMarker() {
    if (!FD.prefs?.seenAt || view.querySelector(".d-caught")) return;
    const seen = Date.parse(FD.prefs.seenAt), cards = [...view.querySelectorAll(".wrap > .post-card, .wrap > .card.post-card")];
    if (!cards.length) return;
    const times = cards.map(c => { const id = c.querySelector("[data-more]")?.dataset.more; const p = id && S.post(id); return p ? Date.parse(p.createdAt) : 0; });
    let last = -1; times.forEach((t, i) => { if (t > seen) last = i; });
    if (last < 0 || last >= cards.length - 1) { if (last < 0 && times[0]) markSeenSoon(times); return; }
    cards[last].insertAdjacentHTML("afterend", `<div class="d-caught" role="status"><span>${ic("check", "sm")} وصلت لآخر الجديد</span></div>`);
    markSeenSoon(times);
  }
  function markSeenSoon(times) {
    const newest = Math.max(...times); if (!newest || Date.now() - FD.lastSeenSent < 30e3) return;
    clearTimeout(FD.seenTimer);
    FD.seenTimer = setTimeout(() => { if (!document.hidden && /home/.test(location.hash || "#/home")) { FD.lastSeenSent = Date.now(); api("POST", "/api/feed/seen", { at: new Date(newest).toISOString() }).then(r => { if (FD.prefs) FD.prefsNext = r.seenAt; }).catch(() => { }); } }, 4000);
  }
  addEventListener("hashchange", () => { if (FD.prefsNext && FD.prefs) { FD.prefs.seenAt = FD.prefsNext; FD.prefsNext = null; } });
  /* meaningful-read signal: a post ≥ 60% visible for 8 s counts as a read (once per session) */
  let dwellObs = null; const dwellT = new Map();
  function dwellWatch() {
    if (!("IntersectionObserver" in window)) return;
    dwellObs ||= new IntersectionObserver((ens) => {
      for (const en of ens) {
        const id = en.target.querySelector("[data-more]")?.dataset.more; if (!id || FD.seenSession.has(id)) continue;
        if (en.isIntersecting) dwellT.set(id, setTimeout(() => { FD.seenSession.add(id); const p = S.post(id); if (p && p.author !== DB.me) api("POST", "/api/feed/signal", { post: id, kind: "dwell", ms: 8000 }).catch(() => { }); }, 8000));
        else { clearTimeout(dwellT.get(id)); dwellT.delete(id); }
      }
    }, { threshold: 0.6 });
    view.querySelectorAll(".post-card").forEach(c => dwellObs.observe(c));
  }
  /* tab editor: reorder (drag or keyboard), rename, hide/show, add topic or hashtag tabs */
  function tabEditor() {
    const p = FD.prefs; if (!p) return;
    let tabs = p.tabs.map(t => ({ ...t }));
    const all = ["for", "following", "chrono", "latest", "discover", "communities"];
    for (const id of all) if (!tabs.some(t => t.id === id)) tabs.push({ id, hidden: true });
    const nameOf = (t) => ({ for: "لك", following: "أتابع", chrono: "زمني (الأحدث أولاً دائماً)", latest: "الأحدث", discover: "استكشف", communities: "مجتمعاتي" }[t.id] || (t.id.startsWith("topic:") ? "موضوع: " + (TOPIC_NAMES[t.id.slice(6)] || t.id.slice(6)) : t.id.startsWith("tag:") ? "وسم: #" + t.id.slice(4) : "قائمة"));
    const paint = () => {
      const s = sheet(`<h4 id="d-te-h">تخصيص الخلاصة</h4><p class="u-m0 u-mb6 muted">اسحب من المقبض ${ic("grip", "xs")} أو استخدم الأسهم لإعادة الترتيب.</p>
        <div class="d-tablist" id="d-te" role="list" aria-labelledby="d-te-h">${tabs.map((t, i) => `<div class="d-tabrow ${t.hidden ? "off" : ""}" role="listitem" data-id="${h(t.id)}">
          <button class="d-grip" aria-label="انقل «${h(nameOf(t))}» — الموضع ${i + 1}">${ic("grip", "sm")}</button>
          <input type="text" value="${h(t.label || "")}" placeholder="${h(nameOf(t))}" aria-label="اسم التبويب ${h(nameOf(t))}" maxlength="24" data-lbl>
          <label class="d-icon-btn" title="${t.hidden ? "إظهار" : "إخفاء"}"><input type="checkbox" ${t.hidden ? "" : "checked"} data-vis aria-label="إظهار ${h(nameOf(t))}"></label>
          ${all.includes(t.id) ? "" : `<button class="d-icon-btn" data-rm aria-label="حذف التبويب">${ic("trash", "sm")}</button>`}</div>`).join("")}</div>
        <div class="u-g8 row"><select id="d-te-add" aria-label="إضافة تبويب موضوع" class="u-f1"><option value="">+ أضف تبويب موضوع…</option>${Object.entries(TOPIC_NAMES).filter(([k]) => !tabs.some(t => t.id === "topic:" + k)).map(([k, v]) => `<option value="topic:${k}">${h(v)}</option>`).join("")}${followedTopics.tags.filter(tg => !tabs.some(t => t.id === "tag:" + tg)).map(tg => `<option value="tag:${h(tg)}">#${h(tg)}</option>`).join("")}</select></div>
        <label class="u-dflex u-g10 u-aic u-my14 chk"><input type="checkbox" id="d-te-chrono" ${p.chrono ? "checked" : ""}> <span><b>الخلاصة الزمنية دائماً</b><br><small class="muted">تعرض «لك» بترتيب زمني بحت دون أي ترتيب خوارزمي</small></span></label>
        <div class="u-g8 row"><button class="btn grow" id="d-te-save">حفظ</button><button class="btn ghost" id="d-te-reset">الافتراضي</button></div>`);
      const box = s.querySelector("#d-te");
      const sync = () => box.querySelectorAll(".d-tabrow").forEach(r => { const t = tabs.find(x => x.id === r.dataset.id); t.label = r.querySelector("[data-lbl]").value.trim() || undefined; t.hidden = !r.querySelector("[data-vis]").checked || undefined; });
      const stop = sortable(box, { item: ".d-tabrow", handle: ".d-grip", onEnd: (ids) => { sync(); tabs = ids.map(id => tabs.find(t => t.id === id)); box.querySelectorAll(".d-grip").forEach((g, i) => g.setAttribute("aria-label", `انقل «${nameOf(tabs[i])}» — الموضع ${i + 1}`)); } });
      s._onclose = stop;
      box.querySelectorAll("[data-vis]").forEach(c => c.onchange = () => c.closest(".d-tabrow").classList.toggle("off", !c.checked));
      box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { sync(); tabs = tabs.filter(t => t.id !== b.closest(".d-tabrow").dataset.id); paint(); });
      s.querySelector("#d-te-add").onchange = (e) => { if (!e.target.value) return; sync(); tabs.push({ id: e.target.value }); paint(); };
      s.querySelector("#d-te-save").onclick = async () => {
        sync();
        try { FD.prefs = await api("PUT", "/api/feed/prefs", { tabs, chrono: s.querySelector("#d-te-chrono").checked }); FD.ranked = {}; closeSheet(); toast("حُفظت الخلاصة"); if (!FD.prefs.tabs.some(t => t.id === feedMode && !t.hidden)) feedMode = FD.prefs.tabs.find(t => !t.hidden).id; rerender(); }
        catch (e) { toast(e.message); }
      };
      s.querySelector("#d-te-reset").onclick = async () => { try { FD.prefs = await api("PUT", "/api/feed/prefs", { tabs: null, chrono: false }); FD.ranked = {}; closeSheet(); toast("أعيدت التبويبات الافتراضية"); feedMode = "for"; rerender(); } catch (e) { toast(e.message); } };
    };
    paint();
  }
  /* «فاتك اليوم» card on Home (once per day, dismissible) */
  const DIG_KEY = "mp_digest_hidden";
  let digestCache = null;
  async function digestCard() {
    if (feedMode !== "for" || view.querySelector(".d-digest") || localStorage.getItem(DIG_KEY) === new Date().toDateString()) return;
    try { if (!digestCache || Date.now() - digestCache.at > 30 * 60e3) digestCache = { at: Date.now(), d: await api("GET", "/api/digest/daily") }; } catch { return; }
    const d = digestCache.d; if (!d.summary || !d.summary.points.length || !/home/.test(location.hash || "#/home") || view.querySelector(".d-digest")) return;
    const anchor = view.querySelector(".tabs"); if (!anchor) return;
    anchor.insertAdjacentHTML("afterend", `<section class="card d-digest" aria-labelledby="d-dig-h"><button class="d-icon-btn d-x" id="d-dig-x" aria-label="إخفاء ملخص اليوم">${ic("x", "sm")}</button>
      <h2 id="d-dig-h">${ic("sparkle", "sm")} فاتك اليوم</h2><div class="u-t-sm muted">${nf(d.counts.posts)} منشوراً جديداً من ${nf(d.counts.people)} شخصاً${d.counts.comments ? ` · ${nf(d.counts.comments)} تعليقاً على منشوراتك` : ""}</div>
      ${points({ points: d.summary.points.slice(0, 3) })}<div class="d-sum-foot">${aiLabel(d.summary)}<a href="#/digest" style="font-weight:800;color:var(--accent-ink)">الملخص كاملاً <span class="fwd" aria-hidden="true">←</span></a></div></section>`);
    $("#d-dig-x").onclick = () => { localStorage.setItem(DIG_KEY, new Date().toDateString()); view.querySelector(".d-digest")?.remove(); };
    view.querySelectorAll(".d-digest [data-cite]").forEach(b => b.onclick = () => (location.hash = "#/post/" + b.dataset.cite));
  }
  const _home = Views.home;
  Views.home = function () { _home.apply(this, arguments); try { enhanceHome(); } catch (e) { console.warn("discovery home", e); } };

  /* ---------- «لماذا أرى هذا» + «أكثر/أقل من هذا» in the post menu ---------- */
  async function whySheet(pid) {
    sheet(`<h4>لماذا أرى هذا؟</h4><div class="skel"></div>`);
    let w; try { w = await api("GET", `/api/posts/${pid}/why`); } catch { return sheet(`<h4>لماذا أرى هذا؟</h4>${Feed.why(S.post(pid)).map(r => `<p>• ${h(r)}</p>`).join("")}`); }
    const max = Math.max(1, ...w.factors.map(f => Math.abs(f.w)));
    const s = sheet(`<h4>لماذا أرى هذا؟</h4><p class="u-mt0 muted">العوامل التي رفعت هذا المنشور في خلاصتك وأوزانها:</p>
      <div role="list">${w.factors.filter(f => Math.abs(f.w) >= 0.1).map(f => `<div class="d-why-row ${f.w < 0 ? "neg" : ""}" role="listitem"><div class="row"><span class="grow">${h(f.label)}</span><b dir="ltr" style="font-variant-numeric:tabular-nums">${f.w > 0 ? "+" : ""}${f.w}</b></div><div class="d-why-bar" aria-hidden="true"><i style="width:${Math.round(Math.abs(f.w) / max * 100)}%"></i></div></div>`).join("")}</div>
      <p class="u-t-xs muted">${h(w.model)}. النقرات وحدها لا ترفع المحتوى.</p>
      <div class="d-ctrls">${w.controls.map((c, i) => `<button data-ctl="${i}">${ic(c.signal === "more" ? "thumbUp" : "thumbDown", "sm")} ${h(c.label)}</button>`).join("")}</div>`);
    s.querySelectorAll("[data-ctl]").forEach(b => b.onclick = async () => { const c = w.controls[+b.dataset.ctl]; await feedback({ post: pid, signal: c.signal, scope: c.scope, target: c.target }); });
  }
  async function feedback(body) {
    try { await api("POST", "/api/feed/feedback", body); FD.ranked = {}; closeSheet(); toast(body.signal === "more" ? "سنعرض لك المزيد من هذا" : "سنعرض لك أقل من هذا"); if (body.signal === "less" && !body.scope) { DB.muted.posts.push(body.post); } await fetchRanked(feedMode === "for" && FD.prefs?.chrono ? "chrono" : feedMode); rerender(); }
    catch (e) { toast(e.message); }
  }
  const _more = moreMenu;
  moreMenu = function (pid) {
    _more(pid);
    if (!online()) return;
    const menu = document.querySelector("#sheet .menu"); if (!menu) return;
    const old = menu.querySelector('[data-a="why"]');
    const why = document.createElement("button"); why.innerHTML = `${ic("sparkle", "sm")} لماذا أرى هذا؟`; why.onclick = () => whySheet(pid);
    if (old) old.replaceWith(why); else menu.prepend(why);
    const p = S.post(pid);
    if (p && p.author !== DB.me) {
      const more = document.createElement("button"); more.innerHTML = `${ic("thumbUp", "sm")} أكثر من هذا`; more.onclick = () => feedback({ post: pid, signal: "more" });
      const less = document.createElement("button"); less.innerHTML = `${ic("thumbDown", "sm")} أقل من هذا`; less.onclick = () => feedback({ post: pid, signal: "less" });
      why.after(more, less);
    }
  };

  /* =================== Phase 25 — summary card on top of discussions =================== */
  async function enhancePost(pid) {
    if (!online()) return;
    const p = S.post(pid); if (!p) return;
    api("POST", "/api/feed/signal", { post: pid, kind: "click" }).catch(() => { });
    const t0 = Date.now(); const leave = () => { removeEventListener("hashchange", leave); if (Date.now() - t0 >= 8000 && p.author !== DB.me) api("POST", "/api/feed/signal", { post: pid, kind: "dwell", ms: Date.now() - t0 }).catch(() => { }); }; addEventListener("hashchange", leave);
    const comments = S.commentsOf(pid).length;
    if (comments < 4 && (p.text || "").length < 600 && p.type !== "article") return;
    view.querySelector("#sum")?.remove();
    const host = [...view.querySelectorAll(".wrap > .card")][1]; if (!host || view.querySelector(".d-sum")) return;
    host.insertAdjacentHTML("beforebegin", `<section class="card d-sum" aria-labelledby="d-sum-h" aria-busy="true"><div class="d-sum-h"><b id="d-sum-h">${ic("sparkle", "sm")} ملخص النقاش</b>${aiLabel()}</div><div class="skel" style="height:64px;margin-top:10px"></div></section>`);
    const box = view.querySelector(".d-sum");
    let r; try { r = await api("GET", `/api/posts/${pid}/summary`); } catch { box.remove(); return; }
    if (!document.body.contains(box)) return;
    if (!r.summary || !r.summary.points.length) { box.remove(); return; }
    const s = r.summary;
    box.removeAttribute("aria-busy");
    box.innerHTML = `<div class="d-sum-h"><b id="d-sum-h">${ic("sparkle", "sm")} ملخص النقاش</b>${aiLabel(s)}</div>${points(s)}
      <div class="d-sum-foot"><span>من ${nf(s.sourceCount)} مصدراً · ${s.provider === "extractive" ? "جمل مقتبسة حرفياً" : "نموذج لغوي مع تحقق من المصادر"}${s.fallback === "budget" ? " · تجاوز حد التكلفة اليومي" : ""}</span><span>${h(ago(s.generatedAt))}</span></div>
      <p class="u-t-xs u-m0 u-mt6 muted">${h(s.label)}</p>`;
    box.querySelectorAll("[data-cite]").forEach(b => b.onclick = () => {
      const id = b.dataset.cite, el = b.dataset.kind === "comment" ? view.querySelector(`[data-cr="${CSS.escape(id)}"]`)?.closest(".comment") : view.querySelector(".wrap > .card");
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("d-flash"); void el.offsetWidth; el.classList.add("d-flash"); }
    });
  }
  const _post = Views.post;
  Views.post = function (pid) { _post.apply(this, arguments); try { enhancePost(pid); } catch (e) { console.warn("discovery post", e); } };

  /* =================== Phase 22 — search screen =================== */
  const SR = { q: "", type: "all", date: "", lang: "", community: "", res: null, exact: false };
  const TYPES = [["all", "الكل"], ["posts", "منشورات"], ["people", "أشخاص"], ["communities", "مجتمعات"], ["hashtags", "وسوم"]];
  const mark = (text, q) => { const t = h(text); const n = (q || "").trim(); if (!n) return t; const i = String(text).indexOf(n); return i < 0 ? t : h(String(text).slice(0, i)) + "<mark>" + h(n) + "</mark>" + h(String(text).slice(i + n.length)); };
  async function searchView(q0) {
    if (!online()) { location.replace("#/explore"); return; }
    if (q0 !== undefined) SR.q = decodeURIComponent(q0 || "");
    view.innerHTML = `<div class="wrap"><div class="s-top"><div class="s-box">
      <span class="s-ic">${ic("search", "sm")}</span><input id="sq2" type="search" role="combobox" aria-expanded="false" aria-haspopup="listbox" enterkeyhint="search" autocomplete="off" placeholder="ابحث عن أشخاص، منشورات، مجتمعات، وسوم…" value="${h(SR.q)}" aria-label="بحث" aria-autocomplete="list" aria-controls="s-sugg">
      <button class="d-icon-btn s-clear" id="s-clear" aria-label="مسح" ${SR.q ? "" : "hidden"}>${ic("x", "sm")}</button><div class="s-sugg" id="s-sugg" role="listbox" aria-label="اقتراحات" hidden></div></div>
      <div class="s-filters" role="group" aria-label="نوع النتائج">${TYPES.map(([k, l]) => `<button class="tab ${SR.type === k ? "on" : ""}" data-type="${k}" aria-pressed="${SR.type === k}">${l}</button>`).join("")}
      <select id="s-date" aria-label="التاريخ"><option value="">أي وقت</option><option value="day">آخر يوم</option><option value="week">آخر أسبوع</option><option value="month">آخر شهر</option><option value="year">آخر سنة</option></select>
      <select id="s-lang" aria-label="اللغة"><option value="">كل اللغات</option><option value="ar">العربية</option><option value="en">English</option></select>
      <select id="s-comm" aria-label="المجتمع"><option value="">كل المجتمعات</option>${DB.communities.filter(c => S.membership(c.id)).map(c => `<option value="${h(c.id)}">${h(c.name)}</option>`).join("")}</select></div></div>
      <div id="s-body" aria-live="polite"></div></div>`;
    for (const [id, k] of [["#s-date", "date"], ["#s-lang", "lang"], ["#s-comm", "community"]]) { const el = $(id); el.value = SR[k]; el.onchange = () => { SR[k] = el.value; if (SR.q) runSearch(); }; }
    view.querySelectorAll("[data-type]").forEach(b => b.onclick = () => { SR.type = b.dataset.type; view.querySelectorAll("[data-type]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); }); if (SR.q) runSearch(); });
    const inp = $("#sq2"), sugg = $("#s-sugg"), combo = inp; // ARIA 1.2: the input itself is the combobox
    let tm, active = -1, opts = [], seq = 0;
    const close = () => { clearTimeout(tm); seq++; sugg.hidden = true; combo.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); active = -1; };
    const choose = (o) => { close(); if (o.href) { location.hash = o.href; return; } inp.value = o.q; SR.q = o.q; runSearch(); };
    const paintSugg = (s) => {
      opts = [...s.history.map(q => ({ q, kind: "history" })), ...s.terms.filter(t => !s.history.includes(t)).map(q => ({ q, kind: "term" })), ...s.people.map(u => ({ href: "#/u/" + u.handle, label: u.name, sub: "@" + u.handle, user: u })), ...s.hashtags.map(t => ({ href: "#/tag/" + enc(t.tag), label: "#" + t.tag, sub: nf(t.posts) + " منشور" })), ...s.communities.map(c => ({ href: "#/c/" + c.id, label: c.name, sub: "مجتمع" }))].slice(0, 10);
      if (!opts.length || document.activeElement !== inp) return close();
      sugg.innerHTML = opts.map((o, i) => `<div class="s-opt" role="option" id="so-${i}" aria-selected="false" data-i="${i}">${o.user ? av(o.user, "sm") : ic(o.kind === "history" ? "history" : o.href ? (o.label.startsWith("#") ? "hash" : "community") : "search", "sm")}<span>${o.q ? mark(o.q, inp.value) : h(o.label)}</span>${o.sub ? `<span class="muted">${h(o.sub)}</span>` : ""}</div>`).join("");
      sugg.hidden = false; combo.setAttribute("aria-expanded", "true");
      sugg.querySelectorAll("[data-i]").forEach(el => el.onmousedown = (e) => { e.preventDefault(); choose(opts[+el.dataset.i]); });
    };
    inp.oninput = () => {
      $("#s-clear").hidden = !inp.value; clearTimeout(tm);
      const my = ++seq; tm = setTimeout(async () => { const v = inp.value; try { const s = await api("GET", "/api/search/suggest?q=" + enc(v)); if (inp.value === v && my === seq) paintSugg(s); } catch { close(); } }, 140);
    };
    inp.onfocus = () => inp.oninput();
    inp.onblur = () => setTimeout(close, 120);
    inp.onkeydown = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (sugg.hidden) return; e.preventDefault(); active = (active + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length; sugg.querySelectorAll(".s-opt").forEach((el, i) => el.setAttribute("aria-selected", i === active)); inp.setAttribute("aria-activedescendant", "so-" + active); sugg.querySelector(`#so-${active}`)?.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && !sugg.hidden) choose(opts[active]); else { close(); SR.q = inp.value.trim(); if (SR.q) runSearch(); } }
      else if (e.key === "Escape") close();
    };
    $("#s-clear").onclick = () => { inp.value = ""; SR.q = ""; SR.res = null; $("#s-clear").hidden = true; inp.focus(); history.replaceState(null, "", "#/search"); landing(); };
    if (SR.q) runSearch(); else { landing(); setTimeout(() => inp.focus({ preventScroll: true }), 60); }
  }
  async function landing() {
    const body = $("#s-body"); if (!body) return;
    body.innerHTML = '<div class="skel"></div>';
    let t, saved = { saved: [] };
    try { [t, saved] = await Promise.all([api("GET", "/api/search/trending"), api("GET", "/api/search/saved").catch(() => ({ saved: [] }))]); } catch (e) { body.innerHTML = errBox(e.message, true); return bindRetry(landing); }
    body.innerHTML = `${t.history.length ? `<div class="s-sec"><h3>${ic("history", "sm")} عمليات بحثك الأخيرة</h3><button id="s-hclear">مسح الكل</button></div>
        <div>${t.history.map(x => `<div class="s-hist"><a href="#/search/${enc(x.q)}">${ic("history", "sm")} ${h(x.q)}</a><button class="d-icon-btn" data-hdel="${h(x.id)}" aria-label="حذف «${h(x.q)}» من السجل">${ic("x", "sm")}</button></div>`).join("")}</div>` : ""}
      ${saved.saved.length ? `<div class="s-sec"><h3>${ic("bellPlus", "sm")} عمليات بحث محفوظة</h3></div><div class="s-chips">${saved.saved.map(s => `<a class="s-chip" href="#/search/${enc(s.q)}" data-ss="${h(s.id)}">${ic(s.alert ? "bell" : "search", "xs")} ${h(s.q)} ${s.newCount ? `<span class="s-badge" aria-label="${s.newCount} نتائج جديدة">${s.newCount}</span>` : ""}</a>`).join("")}</div>` : ""}
      ${t.trends.length ? `<div class="s-sec"><h3>${ic("fire", "sm")} رائج الآن</h3><a href="#/explore" class="muted" style="font-weight:750">استكشف</a></div><div class="s-chips">${t.trends.map(x => `<a class="s-chip" href="#/search/${enc("#" + x.tag)}"><bdi>#${h(x.tag)}</bdi> <small class="muted">${nf(x.posts)}</small></a>`).join("")}</div>` : ""}
      ${t.popular.length ? `<div class="s-sec"><h3>${ic("search", "sm")} يبحث عنه الآخرون</h3></div><div class="s-chips">${t.popular.map(q => `<a class="s-chip" href="#/search/${enc(q)}">${h(q)}</a>`).join("")}</div>` : ""}
      <div class="s-sec"><h3>${ic("compass", "sm")} تصفح المواضيع</h3></div><div class="s-chips">${t.topics.map(x => `<a class="s-chip" href="#/topic/${x.slug}">${h(x.name)}</a>`).join("")}</div>`;
    $("#s-hclear") && ($("#s-hclear").onclick = async () => { await api("DELETE", "/api/search/history"); landing(); });
    body.querySelectorAll("[data-hdel]").forEach(b => b.onclick = async () => { await api("DELETE", "/api/search/history/" + b.dataset.hdel); b.closest(".s-hist").remove(); live("حُذف من السجل"); });
    body.querySelectorAll("[data-ss]").forEach(a => a.addEventListener("click", () => api("POST", `/api/search/saved/${a.dataset.ss}/seen`).catch(() => { })));
  }
  async function runSearch(qOverride) {
    const q = qOverride || SR.q; const body = $("#s-body"); if (!body || !q) return;
    if (location.hash !== "#/search/" + enc(q)) history.replaceState(null, "", "#/search/" + enc(q));
    view._route = "search/" + enc(q);
    body.innerHTML = '<div class="skel"></div><div class="skel"></div>';
    const qs = new URLSearchParams({ q, type: SR.type }); for (const k of ["date", "lang", "community"]) if (SR[k]) qs.set(k, SR[k]);
    if (SR.exact) { qs.set("exact", "1"); SR.exact = false; }
    let r; try { r = await api("GET", "/api/search/full?" + qs); } catch (e) { body.innerHTML = errBox(e.message, true); return bindRetry(() => runSearch(q)); }
    if (SR.q !== q && !qOverride) return;
    ensureUsers(r.users); SR.res = r;
    const g = r.groups, sec = (key, title, inner) => g[key] && g[key].total ? `<section aria-label="${title}"><div class="s-sec"><h3>${title} <span>${nf(g[key].total)}</span></h3>${SR.type === "all" && g[key].total > (key === "posts" ? 20 : 3) ? `<button data-more-type="${key}">عرض الكل</button>` : ""}</div>${inner}</section>` : "";
    const lim = (arr, n) => SR.type === "all" ? arr.slice(0, n) : arr;
    const savedList = (await api("GET", "/api/search/saved").catch(() => ({ saved: [] }))).saved, isSaved = savedList.find(s => s.q === q);
    body.innerHTML = `${r.corrected ? `<div class="s-note" role="status">عرضنا نتائج «${h(r.corrected)}». <button id="s-orig">ابحث عن «${h(q)}» بدلاً من ذلك</button></div>` : ""}
      ${r.didYouMean ? `<div class="s-note" role="status">هل تقصد: <button id="s-dym">${h(r.didYouMean)}</button>؟</div>` : ""}
      <div class="s-save"><span class="muted" style="font-size:13px;font-weight:650">${nf(r.total)} نتيجة${r.engine === "meilisearch" ? " · Meilisearch" : ""}</span>
      <button class="btn ghost" id="s-savebtn" aria-pressed="${!!isSaved}" style="padding:8px 14px;font-size:13.5px">${ic(isSaved ? "bell" : "bellPlus", "sm")} ${isSaved ? "محفوظ مع تنبيه" : "احفظ البحث ونبّهني"}</button></div>
      ${sec("people", "الأشخاص", lim(g.people?.items || [], 3).map(userRow).join(""))}
      ${sec("communities", "المجتمعات", lim(g.communities?.items || [], 3).map(c => `<a class="u-dflex u-g12 u-aic card row" href="#/c/${h(c.id)}"><div class="av" style="background:${h(c.color || "var(--accent)")}">${h((c.icon || c.name || "?")[0])}</div><div class="u-mw0 grow"><b>${mark(c.name, q)}</b><div class="muted ell" dir="auto">${h(c.desc || "")}</div></div></a>`).join(""))}
      ${sec("hashtags", "الوسوم", `<div class="s-chips">${(g.hashtags?.items || []).map(t => `<a class="s-chip" href="#/tag/${enc(t.tag)}"><bdi>#${h(t.tag)}</bdi> <small class="muted">${nf(t.posts)}</small></a>`).join("")}</div>`)}
      ${r.topics?.length && SR.type === "all" ? `<div class="s-sec"><h3>المواضيع</h3></div><div class="s-chips">${r.topics.map(t => `<a class="s-chip" href="#/topic/${t.slug}">${h(t.name)}</a>`).join("")}</div>` : ""}
      ${sec("posts", "المنشورات", lim(g.posts?.items || [], 20).map(card).join(""))}
      ${!r.total ? `<div class="empty">${ic("search", "lg")}<br>لا نتائج لـ «${h(q)}»<br><small class="muted">جرّب كلمات أقل أو أزل بعض الفلاتر</small></div>` : ""}`;
    body.querySelectorAll("[data-more-type]").forEach(b => b.onclick = () => { SR.type = b.dataset.moreType; view.querySelectorAll("[data-type]").forEach(x => { x.classList.toggle("on", x.dataset.type === SR.type); x.setAttribute("aria-pressed", x.dataset.type === SR.type); }); runSearch(); scrollTo({ top: 0 }); });
    $("#s-dym") && ($("#s-dym").onclick = () => { SR.q = r.didYouMean; $("#sq2").value = SR.q; runSearch(); });
    $("#s-orig") && ($("#s-orig").onclick = () => { SR.exact = true; runSearch(); });
    $("#s-savebtn").onclick = async () => {
      try {
        if (isSaved) { await api("DELETE", "/api/search/saved/" + isSaved.id); toast("أُلغي حفظ البحث"); }
        else { await api("POST", "/api/search/saved", { q, filters: { type: SR.type, lang: SR.lang || undefined, community: SR.community || undefined }, alert: true }); toast("حُفظ البحث — سننبهك عند ظهور نتائج جديدة"); }
        runSearch(q);
      } catch (e) { toast(e.message); }
    };
  }

  /* =================== Phase 23 — explore (magazine), topic & hashtag pages =================== */
  const EX = { scope: null, key: null };
  async function exploreView() {
    if (!online()) return Views.explore();
    const re = loading(3);
    let x; try { x = await api("GET", `/api/explore${EX.scope ? `?scope=${EX.scope}&key=${enc(EX.key || "")}` : ""}`); } catch (e) { view.innerHTML = `<div class="wrap">${errBox(e.message, true)}</div>`; return bindRetry(exploreView); }
    if (!/explore/.test(location.hash)) return;
    ensureUsers(x.users);
    const locs = [{ scope: "global", key: "", label: "العالم العربي" }, ...x.places.filter(p => p.scope === "country"), ...x.places.filter(p => p.scope === "city")];
    const cur = x.location;
    const topic = (t, i) => `<a class="x-topic ${i === 0 ? "wide" : ""}" href="#/topic/${t.slug}" style="background:linear-gradient(150deg,${t.color},color-mix(in srgb,${t.color} 70%,#000));--tc:${t.color}">
        <span class="x-emo" aria-hidden="true">${topicGlyph(t.slug, t.emoji)}</span><span><b>${h(t.title)}</b><small>${t.posts7d ? nf(t.posts7d) + " منشور هذا الأسبوع" : h(t.descr)}</small></span>
        <button class="x-follow" data-ft="${t.slug}" aria-pressed="${t.following}" aria-label="${t.following ? "إلغاء متابعة" : "متابعة"} ${h(t.title)}">${t.following ? "✓ تتابعه" : "+ تابع"}</button></a>`;
    const hero = x.hero;
    view.innerHTML = `<div class="wrap">
      <a class="x-search" href="#/search">${ic("search", "sm")} ابحث في مجتمع بلس…</a>
      ${content_shortcuts()}
      ${clipsSec()}${resumeSec()}
      <div class="x-locs" role="group" aria-label="الرائج حسب المكان">${locs.map(l => `<button class="tab ${cur.scope === l.scope && (cur.key || "") === (l.key || "") ? "on" : ""}" data-sc="${l.scope}" data-k="${h(l.key)}" aria-pressed="${cur.scope === l.scope && (cur.key || "") === (l.key || "")}">${l.scope === "city" ? ic("mapPin", "xs") : ""}${h(l.label)}</button>`).join("")}</div>
      ${hero ? `<article class="x-hero" aria-labelledby="x-hero-t"><div class="x-kicker">${ic("fire", "xs")} الأكثر تداولاً · ${h(cur.label)}</div>
        <h2 id="x-hero-t"><bdi>#${h(hero.tag)}</bdi></h2><div class="x-meta">${nf(hero.posts)} منشور · ${nf(hero.unique)} مشارك${hero.velocity > 1 ? ` · يتسارع ×${hero.velocity}` : ""}</div>
        ${hero.summary?.points?.length ? `<div class="u-mt10">${aiLabel(hero.summary)}</div>${points({ points: hero.summary.points.slice(0, 3) })}` : ""}
        <a class="x-go" href="#/tag/${enc(hero.tag)}">ما الذي يدور؟ ←</a></article>` : `<div class="card discover"><b>${ic("fire", "sm")} لا رائج هنا بعد</b><p class="u-m0 u-mt6 muted">عندما يتحدث الناس عن وسم واحد من أماكن مختلفة سيظهر هنا، مع ملخص لما يدور.</p></div>`}
      <div class="x-h"><h2>مواضيع لك</h2><a href="#/search">كل المواضيع</a></div>
      <div class="x-topics">${x.topics.map(topic).join("")}</div>
      ${x.trends.length > 1 ? `<div class="x-h"><h2>الرائج في ${h(cur.label)}</h2></div><div class="x-list">${x.trends.slice(hero ? 1 : 0, 9).map((t, i) => `<a class="x-tr" href="#/tag/${enc(t.tag)}"><span class="x-rank" aria-hidden="true">${i + (hero ? 2 : 1)}</span><span class="u-mw0"><span class="x-tag"><bdi>#${h(t.tag)}</bdi></span><div class="x-sub">${nf(t.posts)} منشور · ${nf(t.unique)} مشارك</div></span>${t.velocity > 1 ? `<span class="x-up">${ic("arrowUp", "xs")} ×${t.velocity}</span>` : ""}</a>`).join("")}</div>` : ""}
      ${x.articles.length ? `<div class="x-h"><h2>مقالات ونقاشات تستحق القراءة</h2></div><div class="x-row">${x.articles.map(a => { const cov = thumbBg(a.cover || a.media); const u = S.user(a.author); return `<a class="x-art" href="#/post/${h(a.id)}"><div class="x-cover" style="${cov ? `background:${h(cov)}` : ""}"></div><div class="x-body"><b>${h(a.title || postText(a).slice(0, 80))}</b><small>${h(u?.name || "")} · ${h(ago(a.createdAt))}</small></div></a>`; }).join("")}</div>` : ""}
      ${x.communities.length ? `<div class="x-h"><h2>مجتمعات نشطة</h2><a href="#/communities">الدليل</a></div><div class="x-row">${x.communities.map(c => `<a class="x-comm" href="#/c/${h(c.id)}"><span class="x-cav" style="background:${h(c.accent || c.color || "var(--accent)")}" aria-hidden="true">${h(c.icon || c.name[0])}</span><b>${h(c.name)}</b><small>${nf(c.members)} عضو</small></a>`).join("")}</div>` : ""}
      <div style="height:20px"></div></div>`;
    painted(re);
    fillClips();
    view.querySelectorAll("[data-sc]").forEach(b => b.onclick = () => { EX.scope = b.dataset.sc === "global" ? null : b.dataset.sc; EX.key = b.dataset.k; exploreView(); });
    view.querySelectorAll("[data-ft]").forEach(b => b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation(); const on = b.getAttribute("aria-pressed") !== "true";
      try { await api(on ? "PUT" : "DELETE", "/api/follows/topic/" + b.dataset.ft); b.setAttribute("aria-pressed", on); b.textContent = on ? "✓ تتابعه" : "+ تابع"; live(on ? "تمت المتابعة" : "أُلغيت المتابعة"); loadFollows(); FD.ranked = {}; } catch (er) { toast(er.message); }
    });
    view.querySelectorAll(".x-hero [data-cite]").forEach(b => b.onclick = () => (location.hash = "#/post/" + b.dataset.cite));
  }
  /* v2.71 — «لقطات» row on explore: first page of GET /api/clips/feed?tab=foryou (≤6 tiles, 9:16), skeleton while loading,
   * removed when empty/offline/failed. Tiles open #/clips?start=<id> (the clips view may ignore start for now). Cached 2 min. */
  const CL = { items: null, at: 0 };
  const clDur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, "0")}`;
  const clTile = (c) => { const v = c.video || {}, po = MPVideoSources.poster(v), cap = postText(c).slice(0, 60), d = +v.duration || 0;
    return `<a class="x-clip" href="#/clips?start=${enc(c.id)}">${po ? `<img src="${h(po)}" alt="" loading="lazy" decoding="async" width="180" height="320">` : `<span class="x-clip-ph" aria-hidden="true">${ic("play", "lg")}</span>`}
      <span class="d-sr">لقطة</span>${cap ? `<span class="x-clip-cap"><bdi>${h(cap)}</bdi></span>` : ""}${d > 0 ? `<span class="x-clip-dur"><bdi>${clDur(d)}</bdi></span>` : ""}${c.views > 0 ? `<span class="x-clip-v">${ic("eye", "xs")}<bdi>${nf(c.views)}</bdi> <span>مشاهدة</span></span>` : ""}</a>`; };
  const clipsSec = () => CL.items && !CL.items.length ? "" : `<section class="x-clips" id="x-clips" aria-labelledby="x-clips-h"${CL.items ? "" : ` aria-busy="true"`}><div class="x-h"><h2 id="x-clips-h">${ic("film", "sm")} فيديوتك</h2><a href="#/clips">عرض الكل</a></div>
      <div class="x-clip-row">${CL.items ? CL.items.map(clTile).join("") : `<span class="x-clip skel" aria-hidden="true"></span>`.repeat(4)}</div></section>`;
  /* v2.73 «تابع المشاهدة»: videos left part-way on this device (window.MPResume, local only), ≤6 tiles with a progress bar;
   * hidden when there is nothing to resume. A clip resumes in the clips viewer, a long video on its post page. */
  const resumeSec = () => {
    const list = (window.MPResume?.list?.() || []).map((r) => ({ r, p: S.post(r.id) })).filter((x) => x.p && x.p.type === "video" && x.p.status === "published").slice(0, 6);
    if (!list.length) return "";
    return `<section class="x-clips x-res" id="x-res" aria-labelledby="x-res-h"><div class="x-h"><h2 id="x-res-h">${ic("play", "sm")} تابع المشاهدة</h2></div><div class="x-clip-row">${list.map(({ r, p }) => {
      const v = p.video || {}, po = MPVideoSources.poster(v), cap = postText(p).slice(0, 60), pct = Math.max(2, Math.min(100, Math.round(r.t / (r.d || 1) * 100)));
      return `<a class="x-clip" href="${v.short ? "#/clips?start=" + enc(p.id) : "#/post/" + enc(p.id)}">${po ? `<img src="${h(po)}" alt="" loading="lazy" decoding="async" width="180" height="320">` : `<span class="x-clip-ph" aria-hidden="true">${ic("play", "lg")}</span>`}<span class="d-sr">تابع المشاهدة</span>${cap ? `<span class="x-clip-cap"><bdi>${h(cap)}</bdi></span>` : ""}<span class="x-clip-dur"><bdi>${clDur(r.t)} / ${clDur(r.d)}</bdi></span><span class="x-res-bar" aria-hidden="true"><i style="width:${pct}%"></i></span></a>`;
    }).join("")}</div></section>`;
  };
  async function fillClips() {
    const sec = view.querySelector("#x-clips"); if (!sec) return;
    if (!CL.items || Date.now() - CL.at > 120e3) {
      try { const r = await api("GET", "/api/clips/feed?tab=foryou&limit=6"); CL.items = (r.items || []).slice(0, 6); CL.at = Date.now(); }
      catch { if (!CL.items) { sec.remove(); return; } }
    }
    const cur = view.querySelector("#x-clips"); if (!cur) return;
    if (!CL.items.length) { cur.remove(); return; }
    cur.outerHTML = clipsSec();
  }
  const content_shortcuts = () => `<div class="explore-shortcuts"><a href="#/shorts">${ic("play", "sm")} فيديوتك</a><a href="#/rooms">${ic("mic", "sm")} غرف صوتية</a><a href="#/digest">${ic("sparkle", "sm")} فاتك اليوم</a><a href="#/market" id="mk-ex">${ic("bag", "sm")} السوق</a></div>`;

  async function topicView(slug) {
    if (!online()) return Views.topic(slug);
    const re = loading(3);
    let t; try { t = await api("GET", `/api/topics/${enc(slug)}/page`); } catch (e) { view.innerHTML = `<div class="wrap">${errBox(e.status === 404 ? "الموضوع غير موجود" : e.message, e.status !== 404)}</div>`; return bindRetry(() => topicView(slug)); }
    ensureUsers(t.users); const m = t.topic;
    view.innerHTML = `<div class="wrap">
      <header class="tp-head" style="background:linear-gradient(150deg,${m.color},color-mix(in srgb,${m.color} 62%,#000));--tc:${m.color}"><span class="x-emo" aria-hidden="true">${m.curated && m.emoji && !TOPIC_ICON[m.slug] ? h(m.emoji) : topicGlyph(m.slug, m.emoji)}</span><h2>${h(m.title)}</h2><p>${h(m.descr)}</p>
        <div class="tp-stats"><span>${nf(t.followers)} متابع</span>${t.tags.length ? `<span>${t.tags.length} وسوم نشطة</span>` : ""}${m.curated ? `<span>${ic("check", "xs")} صفحة منسّقة</span>` : ""}</div>
        <button class="tp-follow" id="tp-f" aria-pressed="${t.following}">${t.following ? "✓ تتابع هذا الموضوع" : "+ تابع الموضوع"}</button></header>
      ${t.tags.length ? `<div class="u-mb6 s-chips">${t.tags.map(x => `<a class="s-chip" href="#/tag/${enc(x)}"><bdi>#${h(x)}</bdi></a>`).join("")}</div>` : ""}
      ${t.featured.length ? `<div class="x-h"><h2>مختارات المحررين</h2></div>${t.featured.map(card).join("")}` : ""}
      ${t.communities.length ? `<div class="x-h"><h2>مجتمعات الموضوع</h2></div><div class="x-row">${t.communities.map(c => `<a class="x-comm" href="#/c/${h(c.id)}"><span class="x-cav" style="background:${h(c.accent || c.color || m.color)}" aria-hidden="true">${h(c.icon || c.name[0])}</span><b>${h(c.name)}</b></a>`).join("")}</div>` : ""}
      ${t.people.length ? `<div class="x-h"><h2>أصوات بارزة</h2></div>${t.people.slice(0, 4).map(userRow).join("")}` : ""}
      <div class="x-h"><h2>الأكثر نقاشاً</h2></div>${t.posts.map(card).join("") || `<div class="empty">لا منشورات في هذا الموضوع خلال الأسبوعين الماضيين.<br><br><button class="btn" id="tp-new">${ic("pen", "sm")} ابدأ النقاش</button></div>`}</div>`;
    painted(re);
    $("#tp-f").onclick = async () => { const on = $("#tp-f").getAttribute("aria-pressed") !== "true"; try { await api(on ? "PUT" : "DELETE", "/api/follows/topic/" + slug); $("#tp-f").setAttribute("aria-pressed", on); $("#tp-f").textContent = on ? "✓ تتابع هذا الموضوع" : "+ تابع الموضوع"; loadFollows(); FD.ranked = {}; } catch (e) { toast(e.message); } };
    $("#tp-new") && ($("#tp-new").onclick = () => openComposer({ topic: slug }));
  }
  async function tagView(tag) {
    if (!online()) return Views.tag(tag);
    const re = loading(3);
    let d; try { d = await api("GET", "/api/trending/tag/" + enc(decodeURIComponent(tag))); } catch (e) { view.innerHTML = `<div class="wrap">${errBox(e.message, true)}</div>`; return bindRetry(() => tagView(tag)); }
    ensureUsers(d.users); const tr = d.trend;
    view.innerHTML = `<div class="wrap"><header class="tp-head" style="background:var(--hero-grad);--tc:var(--brand-1)"><span class="x-emo" aria-hidden="true">${ic("hash", "lg")}</span><h2><bdi>#${h(d.tag)}</bdi></h2>
      <div class="tp-stats"><span>${nf(d.posts.length)} منشور</span><span>${nf(d.followers)} متابع</span>${tr ? `<span>${ic("fire", "xs")} رائج #${tr.rank}</span>` : ""}</div>
      <button class="tp-follow" id="tg-f" aria-pressed="${d.following}">${d.following ? "✓ تتابع الوسم" : "+ تابع الوسم"}</button></header>
      ${tr?.summary?.points?.length ? `<section class="card d-sum" aria-label="ملخص ما يدور"><div class="d-sum-h"><b>${ic("sparkle", "sm")} ما الذي يدور حول <bdi>#${h(d.tag)}</bdi>؟</b>${aiLabel(tr.summary)}</div>${points(tr.summary)}<p class="u-t-xs u-m0 u-mt8 muted">${h(tr.summary.label)}</p></section>` : ""}
      ${d.posts.map(card).join("") || '<div class="empty">لا منشورات بهذا الوسم بعد</div>'}</div>`;
    painted(re);
    $("#tg-f").onclick = async () => { const on = $("#tg-f").getAttribute("aria-pressed") !== "true"; try { await api(on ? "PUT" : "DELETE", "/api/follows/tag/" + enc(d.tag)); $("#tg-f").setAttribute("aria-pressed", on); $("#tg-f").textContent = on ? "✓ تتابع الوسم" : "+ تابع الوسم"; loadFollows(); FD.ranked = {}; } catch (e) { toast(e.message); } };
    view.querySelectorAll(".d-sum [data-cite]").forEach(b => b.onclick = () => (location.hash = "#/post/" + b.dataset.cite));
  }

  /* =================== Phase 25 — «فاتك اليوم» page =================== */
  async function digestView() {
    if (!online()) return Views.home();
    const re = loading(3);
    let d; try { d = await api("GET", "/api/digest/daily"); } catch (e) { view.innerHTML = `<div class="wrap">${errBox(e.message, true)}</div>`; return bindRetry(digestView); }
    ensureUsers(d.users);
    view.innerHTML = `<div class="wrap"><header class="tp-head" style="background:linear-gradient(150deg,#4f22d1,#c04cf0)"><span class="x-emo" aria-hidden="true">${ic("sparkle", "lg")}</span><h2>فاتك اليوم</h2><p>خلاصة آخر ٢٤ ساعة ممن تتابعهم ومجتمعاتك ومواضيعك.</p>
      <div class="tp-stats"><span>${nf(d.counts.posts)} منشور</span><span>${nf(d.counts.people)} شخص</span>${d.counts.comments ? `<span>${nf(d.counts.comments)} تعليق عليك</span>` : ""}</div></header>
      <section class="card dbr" id="dbr" aria-live="polite"></section>
      <section class="card dbr" id="dask" hidden><div class="dbr-h">${ic("comment", "sm")}<b>اسأل عن يومك</b></div>
        <div class="dbr-c">${["وش أهم شي فاتني؟", "وش قالوا اللي أتابعهم؟", "فيه شي جديد في مجتمعاتي؟"].map(x => `<button data-ask="${h(x)}">${h(x)}</button>`).join("")}</div>
        <form class="dask-f" id="dask-f"><input id="dask-q" maxlength="300" placeholder="اكتب سؤالك عن يومك…" aria-label="سؤالك عن يومك" autocomplete="off"><button class="btn" aria-label="اسأل">${ic("arrowUp", "xs")}</button></form>
        <div id="dask-out" aria-live="polite"></div></section>
      ${d.summary?.points?.length ? `<section class="card d-sum"><div class="d-sum-h"><b>${ic("sparkle", "sm")} أبرز ما دار</b>${aiLabel(d.summary)}</div>${points(d.summary)}<p class="u-t-xs u-m0 u-mt8 muted">${h(d.summary.label)}</p></section>` : `<div class="empty">${ic("check", "lg")}<br>أنت مطّلع على كل شيء — لا جديد يستحق التلخيص الآن.</div>`}
      ${d.trends.length ? `<div class="x-h"><h2>رائج اليوم</h2></div><div class="s-chips">${d.trends.map(t => `<a class="s-chip" href="#/tag/${enc(t.tag)}"><bdi>#${h(t.tag)}</bdi></a>`).join("")}</div>
        <section class="card dbr dwhy" id="dwhy"><div class="dbr-h">${ic("sparkle", "sm")}<b>ليش رائج؟</b></div><p class="muted u-m0 u-mt6">اختر وسماً ويشرح لك الذكاء سبب رواجه والآراء حوله من المنشورات نفسها.</p><div class="dbr-c">${d.trends.map(t => `<button data-why="${h(t.tag)}"><bdi>#${h(t.tag)}</bdi></button>`).join("")}</div><div id="dwhy-out" aria-live="polite"></div></section>` : ""}
      ${d.posts.length ? `<div class="x-h"><h2>المنشورات المصدر</h2></div>${d.posts.map(card).join("")}` : ""}
      <a href="#/feedprefs" class="u-dflex u-mt12 card row">${ic("mail")}<div class="grow"><b>النشرة البريدية الأسبوعية</b><div class="muted">ملخص اختياري يصلك كل أسبوع</div></div><span class="muted">←</span></a></div>`;
    painted(re);
    view.querySelectorAll("[data-cite]").forEach(b => b.onclick = () => (location.hash = "#/post/" + b.dataset.cite));
    smartBrief($("#dbr")); dayAsk(); trendWhy();
  }
  /* v2.118 «اسأل عن يومك» + «ليش رائج؟» — answers only from the posts the reader can see; every point opens its source */
  const chips = (ids, src) => (ids || []).map((id) => src[id] ? `<button data-cite="${h(id)}" aria-label="افتح المصدر">${ic("link", "xs")} <bdi>${h(src[id].community || src[id].by || "المصدر")}</bdi></button>` : "").join("");
  const aiErr = (e) => { const link = /اربط|غير مفعّل|مجاناً اليوم/.test(e.message || "") || e.status === 503 || e.status === 429; return `<p>${h(e.message || "تعذّر الطلب")}</p>${link ? `<a class="btn sm" href="#/aihub">اربط حسابك في مركز الذكاء</a>` : ""}`; };
  const openCites = (el) => el.querySelectorAll("[data-cite]").forEach((b) => b.onclick = () => (location.hash = "#/post/" + b.dataset.cite));
  const askLog = [];
  function dayAsk() {
    const box = $("#dask"); if (!box) return;
    api("GET", "/api/aihub/brief").then((r) => { if (r.available && box.isConnected) box.hidden = false; }).catch(() => {});
    const out = $("#dask-out"), inp = $("#dask-q");
    const paint = () => { out.innerHTML = askLog.map((x) => `<div class="dbr-it dask-a"><b class="u-t-xs muted"><bdi>${h(x.q)}</bdi></b><div>${x.wait ? `<span class="muted">يبحث في يومك…</span><div class="skel"></div>` : x.err ? x.err : `<bdi>${h(x.answer)}</bdi>`}</div>${x.cites ? `<div class="dbr-c">${chips(x.cites, x.sources || {})}</div>` : ""}</div>`).join(""); openCites(out); };
    const ask = async (q) => {
      q = String(q || "").trim(); if (q.length < 2) { inp.focus(); return; }
      const item = { q, wait: true }; askLog.unshift(item); if (askLog.length > 5) askLog.pop(); inp.value = ""; paint();
      try { Object.assign(item, await api("POST", "/api/aihub/brief/ask", { q }), { wait: false }); } catch (e) { Object.assign(item, { wait: false, err: aiErr(e) }); }
      if (out.isConnected) paint();
    };
    box.querySelectorAll("[data-ask]").forEach((b) => b.onclick = () => ask(b.dataset.ask));
    $("#dask-f").onsubmit = (e) => { e.preventDefault(); ask(inp.value); };
    if (askLog.length) paint();
  }
  function trendWhy() {
    const box = $("#dwhy"); if (!box) return; const out = $("#dwhy-out");
    box.querySelectorAll("[data-why]").forEach((b) => b.onclick = async () => {
      box.querySelectorAll("[data-why]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      out.innerHTML = `<p class="muted">يقرأ منشورات #${h(b.dataset.why)}…</p><div class="skel"></div><div class="skel"></div>`;
      try {
        const r = await api("POST", "/api/aihub/trend", { tag: b.dataset.why }); if (!out.isConnected) return;
        out.innerHTML = r.why ? `<p class="dbr-lead"><bdi>${h(r.why)}</bdi></p>${r.angles.map((a) => `<div class="dbr-it"><bdi>${h(a.text)}</bdi><div class="dbr-c">${chips(a.cites, r.sources)}</div></div>`).join("")}<p class="muted u-t-xs">مولّد بالذكاء من ${nf(r.count)} منشوراً — افتح المصادر للتفاصيل · <a href="#/tag/${enc(r.tag)}">كل منشورات الوسم</a></p>` : `<p class="muted">${h(r.message || "")}</p>`;
        openCites(out);
      } catch (e) { if (out.isConnected) out.innerHTML = aiErr(e); }
    });
  }
  /* v2.117 «نشرتك الذكية» — AI from «مركز الذكاء» (member's linked account for «digest», else the free daily allowance).
   * Made on request (saves the allowance), kept 2 h server-side; every point links to the posts it came from. */
  const BR_T = { top: ["sparkle", "الأبرز اليوم"], people: ["users", "من الناس اللي تتابعهم"], communities: ["home", "في مجتمعاتك"], topics: ["hash", "مواضيع قد تهمك"] };
  if (!document.getElementById("dbr-css")) { const st = document.createElement("style"); st.id = "dbr-css"; st.textContent = ".dbr{position:relative;overflow:hidden;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--line))}.dbr:before{content:'';position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,#4f22d1,#c04cf0,#22c3e6)}.dbr-h{display:flex;gap:8px;align-items:center}.dbr-h b{flex:1}.dbr-lead{font-size:1.05em;font-weight:600;margin:10px 0 4px;line-height:1.6}.dbr-sec{margin-top:14px}.dbr-sec>h3{display:flex;gap:6px;align-items:center;font-size:.95em;margin:0 0 6px;color:var(--accent)}.dbr-it{padding:8px 0;border-top:1px solid var(--line);line-height:1.6}.dbr-it:first-of-type{border-top:0}.dbr-c{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.dbr-c button{font:inherit;font-size:.8em;min-height:32px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--bg-2);color:inherit}.dbr .btn{min-height:44px}.dbr-go{margin-top:10px;width:100%;background:linear-gradient(135deg,#4f22d1,#c04cf0);border:0;color:#fff}.dbr-f{display:flex;gap:8px;align-items:center;margin-top:12px}.dbr-f span{flex:1}.dask-f{display:flex;gap:8px;margin-top:10px}.dask-f input{flex:1;min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg-2);color:inherit;font:inherit}.dask-a b{display:block;margin-bottom:4px}.dwhy{margin-top:12px}.dbr-c button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}"; document.head.appendChild(st); }
  function briefHTML(r) {
    const b = r.brief, src = b.sources || {};
    const cite = (id) => { const m = src[id]; return m ? `<button data-cite="${h(id)}" aria-label="افتح المصدر">${ic("link", "xs")} <bdi>${h(m.community || m.by || "المصدر")}</bdi></button>` : ""; };
    return `<div class="dbr-h">${ic("sparkle", "sm")}<b>نشرتك الذكية</b><a class="btn ghost sm" href="#/aihub">مركز الذكاء</a></div>
      ${b.headline ? `<p class="dbr-lead"><bdi>${h(b.headline)}</bdi></p>` : ""}
      ${b.sections.map((sec) => `<div class="dbr-sec"><h3>${ic(BR_T[sec.kind][0], "xs")} ${BR_T[sec.kind][1]}</h3>${sec.items.map((it) => `<div class="dbr-it"><bdi>${h(it.text)}</bdi><div class="dbr-c">${it.cites.map(cite).join("")}</div></div>`).join("")}</div>`).join("")}
      <div class="dbr-f muted u-t-xs"><span>مولّدة بالذكاء من ${nf(b.count)} منشوراً — قد تغفل تفاصيل، افتح المصادر${r.free ? ` · باقي ${r.free.left} من ${r.free.daily} مجاناً اليوم` : ""}</span><button class="btn ghost sm" data-br="refresh">${ic("refresh", "xs")} حدّث</button></div>`;
  }
  let lastBrief = null;
  async function smartBrief(box, refresh) {
    if (!box) return;
    const wire = () => {
      box.querySelectorAll("[data-cite]").forEach((b) => b.onclick = () => (location.hash = "#/post/" + b.dataset.cite));
      box.querySelectorAll("[data-br]").forEach((b) => b.onclick = () => smartBrief(box, b.dataset.br === "refresh"));
    };
    const intro = (avail) => `<div class="dbr-h">${ic("sparkle", "sm")}<b>نشرتك الذكية</b></div><p class="muted u-m0 u-mt6">يقرأ الذكاء ${avail ? nf(avail) + " منشوراً" : "منشورات يومك"} ويكتب لك نشرة مرتبة: الأبرز، ومن تتابعهم، ومجتمعاتك — وكل نقطة مربوطة بمصدرها.</p><button class="btn dbr-go" data-br="make">${ic("sparkle", "xs")} اصنع نشرتي</button>`;
    try {
      if (refresh === undefined) {
        if (lastBrief && Date.now() - lastBrief.t < 2 * 3600e3) { box.innerHTML = lastBrief.r.brief ? briefHTML(lastBrief.r) : intro(lastBrief.r.available); wire(); } // the page re-renders on sync: paint at once, then confirm
        const r = await api("GET", "/api/aihub/brief");
        if (!box.isConnected) return;
        if (!r.available) { box.remove(); return; }
        lastBrief = r.available ? { r, t: Date.now() } : null;
        box.innerHTML = r.brief ? briefHTML(r) : intro(r.available); wire(); return;
      }
      box.setAttribute("aria-busy", "true");
      box.innerHTML = `<div class="dbr-h">${ic("sparkle", "sm")}<b>نشرتك الذكية</b></div><p class="muted">يقرأ يومك ويكتب لك…</p><div class="skel"></div><div class="skel"></div><div class="skel"></div>`;
      const r = await api("POST", "/api/aihub/brief", { refresh: !!refresh });
      if (r.brief) lastBrief = { r, t: Date.now() };
      if (!box.isConnected) { box = document.getElementById("dbr"); if (!box) return; }
      box.innerHTML = r.brief ? briefHTML(r) : `<p class="muted">${h(r.message || "لا جديد الآن")}</p>`; wire();
    } catch (e) {
      if (!box.isConnected) { box = document.getElementById("dbr"); if (!box) return; }
      const link = /اربط|غير مفعّل|مجاناً اليوم/.test(e.message || "") || e.status === 503 || e.status === 429;
      box.innerHTML = `<div class="dbr-h">${ic("sparkle", "sm")}<b>نشرتك الذكية</b></div><p>${h(e.message || "تعذّر الطلب")}</p><div class="row">${link ? `<a class="btn sm" href="#/aihub">اربط حسابك في مركز الذكاء</a>` : `<button class="btn sm" data-br="make">أعد المحاولة</button>`}</div>`; wire();
    } finally { box.removeAttribute("aria-busy"); }
  }
  /* feed & summaries settings page (kept off the main settings screen) */
  async function feedPrefsView() {
    if (!online()) return Views.settings();
    view.innerHTML = skel(2);
    let p, ds, fb; try { [p, ds, fb] = await Promise.all([loadPrefs(true), api("GET", "/api/digest/settings"), api("GET", "/api/feed/feedback")]); } catch (e) { view.innerHTML = `<div class="wrap">${errBox(e.message, true)}</div>`; return bindRetry(feedPrefsView); }
    const fbLabel = (f) => `${f.weight > 0 ? "أكثر من" : "أقل من"} ${{ author: "حساب", topic: "موضوع", tag: "وسم", community: "مجتمع", post: "منشور" }[f.kind]}: ${f.kind === "author" ? h(S.user(f.target)?.name || f.target) : f.kind === "topic" ? h(TOPIC_NAMES[f.target] || f.target) : f.kind === "tag" ? "#" + h(f.target) : f.kind === "community" ? h(S.community(f.target)?.name || f.target) : "منشور مخفي"}`;
    view.innerHTML = `<div class="wrap"><a href="#/settings" class="muted">→ الإعدادات</a><h2 class="u-my10">الخلاصة والملخصات</h2>
      <section class="card"><b>${ic("list", "sm")} الخلاصة</b>
        <label class="u-dflex u-g10 u-aic u-mt10 chk"><input type="checkbox" id="fp-chrono" ${p.chrono ? "checked" : ""}> <span>الخلاصة الزمنية دائماً (بدون ترتيب خوارزمي)</span></label>
        <button class="u-mt10 btn ghost block" id="fp-tabs">${ic("sliders", "sm")} تخصيص التبويبات وترتيبها</button></section>
      <section class="card"><b>${ic("thumbUp", "sm")} ما طلبت رؤيته أكثر أو أقل</b>${fb.feedback.length ? fb.feedback.map(f => `<div class="u-py10 u-bb row"><span class="grow">${fbLabel(f)}</span><button class="btn ghost" style="padding:6px 12px" data-undo="${h(f.kind)}|${h(f.target)}">تراجع</button></div>`).join("") : `<p class="muted">لم تطلب أي تعديل بعد. استخدم «أكثر/أقل من هذا» من قائمة أي منشور.</p>`}</section>
      <section class="card"><b>${ic("mail", "sm")} النشرة الأسبوعية بالبريد</b>
        ${ds.mailEnabled ? "" : `<p class="u-t-sm muted">البريد غير مفعّل على هذا الخادم بعد؛ سيُحفظ اختيارك ويبدأ الإرسال عند تفعيله.</p>`}
        <label class="u-dflex u-g10 u-aic u-mt10 chk"><input type="checkbox" id="fp-weekly" ${ds.weeklyEmail ? "checked" : ""}> <span>أرسل لي ملخصاً أسبوعياً</span></label>
        <input id="fp-email" type="email" inputmode="email" dir="ltr" placeholder="name@example.com" value="${h(ds.email || "")}" aria-label="البريد الإلكتروني" class="u-w100 u-mt10">
        <label class="u-dflex u-g10 u-aic u-mt10 chk"><input type="checkbox" id="fp-daily" ${ds.daily ? "checked" : ""}> <span>بطاقة «فاتك اليوم» في الرئيسية</span></label>
        <button class="u-mt12 btn block" id="fp-save">حفظ</button>
        <p class="u-t-xs u-mb0 muted">الملخصات مولّدة آلياً من نصوص المنشورات فقط، مع إحالة لكل نقطة إلى مصدرها.</p></section></div>`;
    $("#fp-chrono").onchange = async (e) => { FD.prefs = await api("PUT", "/api/feed/prefs", { chrono: e.target.checked }); FD.ranked = {}; toast(e.target.checked ? "الخلاصة زمنية الآن" : "عادت الخلاصة الذكية"); };
    $("#fp-tabs").onclick = tabEditor;
    view.querySelectorAll("[data-undo]").forEach(b => b.onclick = async () => { const [k, t] = b.dataset.undo.split("|"); await api("DELETE", `/api/feed/feedback/${enc(k)}/${enc(t)}`); FD.ranked = {}; if (k === "post") DB.muted.posts = DB.muted.posts.filter(x => x !== t); b.closest(".row").remove(); live("تم التراجع"); });
    $("#fp-save").onclick = async () => { try { await api("PUT", "/api/digest/settings", { weeklyEmail: $("#fp-weekly").checked, email: $("#fp-email").value.trim() || null, daily: $("#fp-daily").checked }); if (!$("#fp-daily").checked) localStorage.setItem(DIG_KEY, "never"); else if (localStorage.getItem(DIG_KEY) === "never") localStorage.removeItem(DIG_KEY); toast("حُفظت الإعدادات"); } catch (e) { toast(e.message); } };
  }

  /* =================== Phase 24 — collections, offline sync, people lists =================== */
  const OFF = {
    db: null,
    open() { return this.db ||= new Promise((res, rej) => { const r = indexedDB.open("mp-saved", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async get(k) { const db = await this.open(); return new Promise((res) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); },
    async set(k, v) { const db = await this.open(); return new Promise((res) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); }
  };
  const key = (k) => `${k}:${DB.me}`;
  let SV = null; // { serverTime, collections, items: { [colId]: [item] }, users }
  async function loadLocal() { if (SV) return SV; try { SV = (await OFF.get(key("state"))) || null; } catch { SV = null; } return SV; }
  async function saveLocal() { try { await OFF.set(key("state"), SV); } catch { /* storage full or private mode */ } }
  async function outbox() { try { return (await OFF.get(key("outbox"))) || []; } catch { return []; } }
  async function queue(op) {
    const q = await outbox(); q.push(op); await OFF.set(key("outbox"), q);
    try { const reg = await navigator.serviceWorker?.ready; await reg?.sync?.register("mp-saved"); } catch { /* Background Sync unsupported: the online event replays */ }
  }
  let syncing = null;
  async function syncNow() {
    if (!online() || !navigator.onLine) return SV;
    return syncing ||= (async () => {
      await loadLocal();
      const q = await outbox();
      if (q.length) { try { await api("POST", "/api/collections/sync", { ops: q }); await OFF.set(key("outbox"), []); } catch (e) { if (!e.status) return SV; await OFF.set(key("outbox"), []); } }
      const r = await api("GET", "/api/collections/sync" + (SV?.serverTime && !q.length ? "?since=" + enc(SV.serverTime) : ""));
      if (r.full || !SV) SV = { serverTime: r.serverTime, collections: r.collections, items: {}, users: [] };
      SV.serverTime = r.serverTime; SV.collections = r.collections;
      for (const t of r.tombstones) { if (!t.post) delete SV.items[t.collection]; else SV.items[t.collection] = (SV.items[t.collection] || []).filter(i => i.postId !== t.post); }
      for (const it of r.items) { const arr = (SV.items[it.collection] ||= []); const i = arr.findIndex(x => x.postId === it.postId); if (i >= 0) arr[i] = it; else arr.push(it); }
      const alive = new Set(SV.collections.map(c => c.id)); for (const k of Object.keys(SV.items)) if (!alive.has(k)) delete SV.items[k];
      const um = new Map((SV.users || []).map(u => [u.id, u])); for (const u of r.users) um.set(u.id, u); SV.users = [...um.values()];
      await saveLocal(); mirror();
      return SV;
    })().catch(() => SV).finally(() => { syncing = null; });
  }
  /* keep the bookmark state of post cards (DB.collections) in step with the server */
  function mirror() {
    if (!SV) return;
    DB.collections = SV.collections.map(c => ({ id: c.id, name: c.name, items: (SV.items[c.id] || []).sort((a, b) => a.position - b.position).map(i => i.postId) }));
    try { if (typeof snapshot === "function" && Remote.snap) Remote.snap = snapshot(); } catch { /* not hydrated yet */ }
  }
  if (typeof hydrate === "function") { const _hy = hydrate; hydrate = function () { _hy.apply(this, arguments); if (bootedFor !== DB.me) setTimeout(ready); else { mirror(); for (const k in FD.ranked) FD.ranked[k].stale = true; fetchRanked(FD.prefs?.chrono && feedMode === "for" ? "chrono" : feedMode); refreshPrefs(); } }; }
  /* a refresh can carry a newer last-visit mark or a digest that was empty at boot: reload both, but keep the
   * marker the viewer is looking at stable while Home is open (the new mark applies on next navigation) */
  async function refreshPrefs() {
    const shown = FD.prefs?.seenAt, onHome = /^#?\/?(home)?$|^#\/home/.test(location.hash || "#/home");
    await loadPrefs(true); if (!FD.prefs) return;
    if (onHome && shown && FD.prefs.seenAt !== shown) { FD.prefsNext = FD.prefs.seenAt; FD.prefs.seenAt = shown; }
    if (digestCache && !digestCache.d?.summary?.points?.length) digestCache = null;
    if (onHome) { caughtUpMarker(); digestCard(); }
  }
  addEventListener("online", () => syncNow().then(() => { if (/library|collection/.test(location.hash)) route(); }));
  navigator.serviceWorker?.addEventListener?.("message", (e) => { if (e.data === "mp-saved-sync") syncNow(); });
  const itemsOf = (cid) => (SV?.items[cid] || []).slice().sort((a, b) => a.position - b.position || (a.addedAt < b.addedAt ? 1 : -1));
  async function mutate(op, apply) {
    apply(); await saveLocal(); mirror();
    if (navigator.onLine && online()) { try { await api("POST", "/api/collections/sync", { ops: [op] }); syncNow(); return true; } catch (e) { if (e.status) { toast(e.message); syncNow(); return false; } } }
    await queue(op); toast("حُفظ على جهازك وسيُزامن عند عودة الاتصال"); return true;
  }
  /* save sheet (replaces the device-only one when online) */
  const _saveMenu = saveMenu;
  saveMenu = function (pid) {
    if (!online() || !SV) return _saveMenu(pid);
    const inCols = SV.collections.filter(c => itemsOf(c.id).some(i => i.postId === pid));
    const s = sheet(`<h4>حفظ في مجموعة</h4><div class="menu">${SV.collections.map(c => `<button data-c="${h(c.id)}" aria-pressed="${inCols.includes(c)}">${inCols.includes(c) ? ic("check", "sm") : colGlyph(c)} ${h(c.name)}</button>`).join("")}
      <button data-new="1">${ic("plus", "sm")} مجموعة جديدة</button></div>
      <div class="u-g8 u-mt6 row"><button class="btn ghost grow" data-later="1">${ic("clock", "sm")} احفظ وذكّرني لاحقاً</button></div>`);
    s.querySelectorAll("[data-c]").forEach(b => b.onclick = async () => {
      const cid = b.dataset.c, has = itemsOf(cid).some(i => i.postId === pid);
      closeSheet();
      await mutate(has ? { op: "remove", collection: cid, post: pid } : { op: "add", collection: cid, post: pid }, () => { SV.items[cid] = has ? itemsOf(cid).filter(i => i.postId !== pid) : [{ postId: pid, note: "", position: (itemsOf(cid)[0]?.position ?? 1) - 1, addedAt: new Date().toISOString(), post: S.post(pid) }, ...itemsOf(cid)]; });
      toast(has ? "أُزيل من المجموعة" : "تم الحفظ"); rerender();
    });
    s.querySelector("[data-new]").onclick = () => newCollection(pid);
    s.querySelector("[data-later]").onclick = () => { const cid = SV.collections[0]?.id; if (!cid) return newCollection(pid); remindSheet(cid, pid, true); };
  };
  function newCollection(pid) {
    const colors = ["#6d3cf4", "#0f766e", "#be185d", "#b45309", "#1d4ed8", "#047857"], emojis = COL_ICONS.map(i => "i:" + i);
    const s = sheet(`<h4>مجموعة جديدة</h4><input id="nc-name" placeholder="اسم المجموعة" maxlength="50" aria-label="اسم المجموعة" class="u-w100">
      <div class="u-my12 s-chips" role="group" aria-label="الرمز">${emojis.map((e, i) => `<button class="s-chip" data-emo="${e}" aria-pressed="${i === 0}" aria-label="رمز ${i + 1}">${colGlyph({ emoji: e })}</button>`).join("")}</div>
      <div class="s-chips" role="group" aria-label="اللون">${colors.map((c, i) => `<button class="s-chip" data-col="${c}" aria-pressed="${i === 0}" aria-label="لون ${i + 1}" style="background:${c};width:34px;height:34px;padding:0;border:3px solid ${i === 0 ? "var(--text)" : "transparent"}"></button>`).join("")}</div>
      <button class="u-mt14 btn block" id="nc-go">إنشاء${pid ? " وحفظ" : ""}</button>`);
    let emo = emojis[0], col = colors[0];
    s.querySelectorAll("[data-emo]").forEach(b => b.onclick = () => { emo = b.dataset.emo; s.querySelectorAll("[data-emo]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
    s.querySelectorAll("[data-col]").forEach(b => b.onclick = () => { col = b.dataset.col; s.querySelectorAll("[data-col]").forEach(x => { x.setAttribute("aria-pressed", x === b); x.style.borderColor = x === b ? "var(--text)" : "transparent"; }); });
    setTimeout(() => $("#nc-name")?.focus(), 50);
    $("#nc-go").onclick = async () => {
      const name = $("#nc-name").value.trim(); if (!name) return $("#nc-name").focus();
      const id = "col_" + Math.random().toString(36).slice(2, 12);
      closeSheet();
      await mutate({ op: "create", id, name, emoji: emo, color: col }, () => { SV.collections.push({ id, name, emoji: emo, color: col, count: 0, cover: [], position: SV.collections.length }); SV.items[id] = []; });
      if (pid) await mutate({ op: "add", collection: id, post: pid }, () => { SV.items[id] = [{ postId: pid, note: "", position: 0, addedAt: new Date().toISOString(), post: S.post(pid) }]; });
      toast(pid ? "أُنشئت المجموعة وحُفظ المنشور" : "أُنشئت المجموعة"); route();
    };
  }
  function remindSheet(cid, pid, saveFirst) {
    const at = (fn) => { const d = new Date(); fn(d); return d; };
    const opts = [["بعد ساعة", at(d => d.setHours(d.getHours() + 1))], ["الليلة", at(d => { d.setHours(20, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); })], ["غداً صباحاً", at(d => { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); })], ["نهاية الأسبوع", at(d => { d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); d.setHours(10, 0, 0, 0); })]];
    const s = sheet(`<h4>${ic("clock", "sm")} ذكّرني بقراءته</h4><div class="d-quick">${opts.map(([l, d], i) => `<button data-q="${i}">${l}<small>${d.toLocaleString((window.MPI18n?.current?.() || "ar"), { weekday: "long", hour: "numeric", minute: "2-digit" })}</small></button>`).join("")}</div>
      <label class="u-t-sm muted" for="rm-at">أو اختر موعداً</label><input type="datetime-local" id="rm-at" class="u-w100 u-mt6">
      <div class="u-g8 u-mt12 row"><button class="btn grow" id="rm-go">ضبط التذكير</button><button class="btn ghost" id="rm-clear">بلا تذكير</button></div>`);
    const set = async (iso) => {
      closeSheet();
      if (saveFirst && !itemsOf(cid).some(i => i.postId === pid)) await mutate({ op: "add", collection: cid, post: pid, remindAt: iso }, () => { SV.items[cid] = [{ postId: pid, note: "", position: (itemsOf(cid)[0]?.position ?? 1) - 1, remindAt: iso, addedAt: new Date().toISOString(), post: S.post(pid) }, ...itemsOf(cid)]; });
      else await mutate({ op: "update", collection: cid, post: pid, remindAt: iso }, () => { const it = itemsOf(cid).find(i => i.postId === pid); if (it) { it.remindAt = iso; it.reminded = false; } });
      toast(iso ? "سنذكّرك في الموعد" : "أُلغي التذكير"); if (/collection|library/.test(location.hash)) route();
    };
    s.querySelectorAll("[data-q]").forEach(b => b.onclick = () => set(opts[+b.dataset.q][1].toISOString()));
    $("#rm-go").onclick = () => { const v = $("#rm-at").value; if (!v) return $("#rm-at").focus(); set(new Date(v).toISOString()); };
    $("#rm-clear").onclick = () => set(null);
  }
  function mosaic(c) {
    const cov = (c.cover && c.cover.length ? c.cover : itemsOf(c.id).map(i => i.post).filter(Boolean).slice(0, 4).map(p => ({ media: p.cover || p.media || (p.images || [])[0], title: postText(p).slice(0, 60) })));
    if (!cov.length) return `<div class="col-mosaic empty" style="background:linear-gradient(150deg,${h(c.color || "#6d3cf4")}22,${h(c.color || "#6d3cf4")}44)"><span aria-hidden="true" style="color:${h(c.color || "#6d3cf4")}">${colGlyph(c, "lg")}</span></div>`;
    const tint = c.color || "#6d3cf4", n = Math.min(cov.length, 4);
    const cell = (t) => { const bg = thumbBg(t.media); return bg ? `<div class="g" style="background:${h(bg)}">${bg.startsWith("linear") ? `<span>${h(t.title.slice(0, 60))}</span>` : ""}</div>` : `<div class="t" style="background:color-mix(in srgb,${h(tint)} 9%,var(--card))"><span>${h(t.title.slice(0, 90))}</span></div>`; };
    return `<div class="col-mosaic n${n}" aria-hidden="true">${cov.slice(0, 4).map(cell).join("")}</div>`;
  }
  async function libraryView(tab) {
    if (!online()) return Views.library();
    tab = tab || view._dlib || "folders"; view._dlib = tab;
    view.innerHTML = `<div class="wrap">${UI.pageHead({ title: "المحفوظات", icon: "bookmark", sub: "مجموعاتك وما حفظته لتقرأه لاحقاً وقوائم الأشخاص." })}
      <div class="seg" role="group" aria-label="أقسام المحفوظات">${[["folders", "المجموعات"], ["later", "اقرأ لاحقاً"], ["lists", "القوائم"]].map(([k, l]) => `<button class="grow ${tab === k ? "on" : ""}" data-lt="${k}" aria-pressed="${tab === k}">${l}</button>`).join("")}</div><div id="lib-body">${'<div class="skel"></div>'.repeat(2)}</div></div>`;
    view.querySelectorAll("[data-lt]").forEach(b => b.onclick = () => libraryView(b.dataset.lt));
    const body = $("#lib-body");
    if (tab === "lists") return listsBody(body);
    await loadLocal();
    const offline = !navigator.onLine;
    if (!offline) await syncNow(); if (!SV) { body.innerHTML = errBox("تعذر تحميل المحفوظات", true); return bindRetry(() => libraryView(tab)); }
    ensureUsers(SV.users);
    const banner = offline ? `<div class="d-offline" role="status">${ic("offline", "sm")} أنت غير متصل — تعرض نسخة محفوظة على جهازك، وتُزامن تعديلاتك لاحقاً.</div>` : "";
    if (tab === "later") {
      const all = SV.collections.flatMap(c => itemsOf(c.id).filter(i => i.remindAt).map(i => ({ ...i, c })));
      all.sort((a, b) => (a.reminded - b.reminded) || (a.remindAt < b.remindAt ? -1 : 1));
      body.innerHTML = banner + (all.length ? `<div role="list" aria-label="للقراءة لاحقاً">${all.map(i => itemCard(i, i.c, true)).join("")}</div>` : UI.empty({ title: "لا تذكيرات بعد", text: "من زر الحفظ اختر «احفظ وذكّرني لاحقاً»." }));
      return bindItems(body);
    }
    body.innerHTML = banner + `<div class="col-grid" id="col-grid" role="list" aria-label="مجموعاتك — اسحب من المقبض لإعادة الترتيب">${SV.collections.map(c => `<div class="col-tile" role="listitem" data-id="${h(c.id)}">
        <a href="#/collection/${h(c.id)}" aria-label="${h(c.name)}، ${itemsOf(c.id).length} عنصر">${mosaic(c)}</a>
        <div class="col-meta"><a href="#/collection/${h(c.id)}" tabindex="-1"><b>${h(c.name)}</b><small><span>${nf(itemsOf(c.id).length)} عنصر</span>${c.shared ? `<span class="col-sh">${ic("link", "xs")} مشتركة</span>` : ""}</small></a><button class="d-grip" aria-label="انقل مجموعة ${h(c.name)}" title="اسحب لإعادة الترتيب">${ic("grip", "sm")}</button></div></div>`).join("")}
      <div role="listitem" style="display:contents"><button class="col-tile col-new" id="col-new">${ic("plus")} مجموعة جديدة</button></div></div>`;
    $("#col-new").onclick = () => newCollection();
    cleanDnd();
    dndCleanup.push(sortable($("#col-grid"), { item: ".col-tile[data-id]", handle: ".d-grip", grid: true, onEnd: async (ids) => {
      SV.collections = ids.map(id => SV.collections.find(c => c.id === id)); await saveLocal(); mirror();
      if (online() && navigator.onLine) api("PUT", "/api/collections/order", { ids }).then(() => live("حُفظ الترتيب")).catch(e => toast(e.message)); else toast("سيُحفظ الترتيب عند عودة الاتصال");
    } }));
  }
  function itemCard(i, c, showFolder) {
    const p = i.post || S.post(i.postId), u = p && (S.user(p.author) || (SV.users || []).find(x => x.id === p.author));
    if (!p) return `<div class="ci" role="listitem" data-id="${h(i.postId)}"><div class="ci-body muted">المنشور لم يعد متاحاً</div><button class="d-icon-btn" data-rm="${h(c.id)}|${h(i.postId)}" aria-label="إزالة">${ic("trash", "sm")}</button></div>`;
    const bg = thumbBg(p.cover || p.media || (p.images || [])[0]);
    const due = i.remindAt && !i.reminded;
    return `<div class="ci" role="listitem" data-id="${h(i.postId)}" aria-label="${h(postText(p).slice(0, 60))}">
      ${showFolder ? "" : `<button class="d-grip" aria-label="انقل العنصر">${ic("grip", "sm")}</button>`}
      <div class="ci-body"><div class="ci-by">${u ? av(u, "sm") : ""}<span>${h(u?.name || "")}</span><span class="u-fw6 muted">· ${h(ago(p.createdAt))}</span>${showFolder ? `<span class="u-m0 chip">${h(c.name)}</span>` : ""}</div>
        <a href="#/post/${h(p.id)}" class="ci-text">${h(postText(p))}</a>
        ${i.note ? `<div class="ci-note">${ic("lock", "xs")}<span><b>ملاحظتك الخاصة:</b> ${h(i.note)}</span></div>` : ""}
        <div class="ci-acts"><button data-note="${h(c.id)}|${h(i.postId)}">${ic("note", "xs")} ${i.note ? "تعديل الملاحظة" : "ملاحظة"}</button>
          <button data-rem="${h(c.id)}|${h(i.postId)}" class="${due ? "on" : ""}">${ic("clock", "xs")} ${i.remindAt ? (i.reminded ? "تم التذكير" : new Date(i.remindAt).toLocaleString("ar", { weekday: "short", hour: "numeric", minute: "2-digit" })) : "ذكّرني"}</button>
          <button data-mv="${h(c.id)}|${h(i.postId)}">${ic("folder", "xs")} نقل</button>
          <button data-rm="${h(c.id)}|${h(i.postId)}" class="ci-rm" aria-label="إزالة من المجموعة" title="إزالة">${ic("trash", "xs")}</button></div></div>
      ${bg ? `<a href="#/post/${h(p.id)}" class="ci-thumb" style="background:${h(bg)}" aria-hidden="true" tabindex="-1"></a>` : ""}</div>`;
  }
  function bindItems(root) {
    const pair = (v) => v.split("|");
    root.querySelectorAll("[data-note]").forEach(b => b.onclick = () => {
      const [cid, pid] = pair(b.dataset.note), it = itemsOf(cid).find(x => x.postId === pid);
      const s = sheet(`<h4>${ic("lock", "sm")} ملاحظة خاصة</h4><p class="u-mt0 u-t-sm muted">لا يراها أحد غيرك، ولا تظهر عند مشاركة المجموعة.</p><textarea id="nt" rows="4" maxlength="1000" class="u-w100" aria-label="الملاحظة">${h(it?.note || "")}</textarea><button class="u-mt10 btn block" id="nt-go">حفظ</button>`);
      setTimeout(() => s.querySelector("#nt").focus(), 50);
      s.querySelector("#nt-go").onclick = async () => { const note = s.querySelector("#nt").value.trim(); closeSheet(); await mutate({ op: "update", collection: cid, post: pid, note }, () => { if (it) it.note = note; }); route(); };
    });
    root.querySelectorAll("[data-rem]").forEach(b => b.onclick = () => { const [cid, pid] = pair(b.dataset.rem); remindSheet(cid, pid); });
    root.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => {
      const [cid, pid] = pair(b.dataset.mv);
      const s = sheet(`<h4>نقل إلى</h4><div class="menu">${SV.collections.filter(c => c.id !== cid).map(c => `<button data-to="${h(c.id)}">${ic("folder", "sm")} ${h(c.name)}</button>`).join("") || '<p class="muted">أنشئ مجموعة أخرى أولاً</p>'}</div>`);
      s.querySelectorAll("[data-to]").forEach(x => x.onclick = () => { closeSheet(); moveItem(cid, pid, x.dataset.to); });
    });
    root.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { const [cid, pid] = pair(b.dataset.rm); const el = b.closest(".ci"); await mutate({ op: "remove", collection: cid, post: pid }, () => { SV.items[cid] = itemsOf(cid).filter(i => i.postId !== pid); }); el?.remove(); live("أُزيل"); });
  }
  async function moveItem(cid, pid, to) {
    const it = itemsOf(cid).find(x => x.postId === pid); if (!it) return;
    await mutate({ op: "update", collection: cid, post: pid, moveTo: to }, () => { SV.items[cid] = itemsOf(cid).filter(x => x.postId !== pid); SV.items[to] = [{ ...it, position: (itemsOf(to)[0]?.position ?? 1) - 1 }, ...itemsOf(to)]; });
    const name = SV.collections.find(c => c.id === to)?.name; toast("نُقل إلى «" + name + "»"); route();
  }
  async function collectionView(cid) {
    if (!online()) return Views.library();
    await loadLocal(); if (navigator.onLine) await syncNow();
    const c = SV?.collections.find(x => x.id === cid); if (!c) { view.innerHTML = `<div class="wrap">${errBox("المجموعة غير موجودة")}</div>`; return; }
    ensureUsers(SV.users);
    const items = itemsOf(cid), color = c.color || "#6d3cf4";
    view.innerHTML = `<div class="wrap"><a class="back d-back" href="#/library"><span class="fwd" aria-hidden="true">→</span> المحفوظات</a>
      <header class="col-head" style="background:linear-gradient(150deg,${h(color)},color-mix(in srgb,${h(color)} 60%,#000));margin-top:8px"><small style="font-weight:700;opacity:.9">مجموعة${c.shared ? " مشتركة" : " خاصة"}</small><h2>${colGlyph(c, "")} ${h(c.name)}</h2><p>${nf(items.length)} عنصر · اسحب العناصر لترتيبها أو إلى مجموعة أخرى</p>
        <div class="col-acts"><button id="cv-share">${ic("link", "xs")} ${c.shared ? "إدارة المشاركة" : "مشاركة"}</button><button id="cv-ren">${ic("pen", "xs")} إعادة تسمية</button><button id="cv-del" aria-label="حذف المجموعة" title="حذف المجموعة">${ic("trash", "xs")}</button></div></header>
      ${SV.collections.length > 1 && items.length ? `<div class="col-folders" role="group" tabindex="0" aria-label="مجلداتك — أفلت عنصراً على مجلد لنقله">${SV.collections.filter(x => x.id !== cid).map(x => `<span data-folder="${h(x.id)}">${ic("folder", "xs")} ${h(x.name)}</span>`).join("")}</div>` : ""}
      <div id="cv-items" ${items.length ? `role="list" aria-label="عناصر المجموعة"` : ""}>${items.map(i => itemCard(i, c)).join("") || UI.empty({ title: "المجموعة فارغة", text: "احفظ منشورات من زر الحفظ في أي منشور لتظهر هنا." })}</div></div>`;
    bindItems(view);
    cleanDnd();
    if (items.length) dndCleanup.push(sortable($("#cv-items"), { item: ".ci[data-id]", handle: ".d-grip", targets: ".col-folders [data-folder]",
      onDrop: (t, el) => moveItem(cid, el.dataset.id, t.dataset.folder),
      onEnd: async (ids) => { ids.forEach((id, i) => { const it = itemsOf(cid).find(x => x.postId === id); if (it) it.position = i; }); await saveLocal(); mirror(); if (online() && navigator.onLine) api("PUT", `/api/collections/${cid}/items/order`, { posts: ids }).then(() => live("حُفظ الترتيب")).catch(e => toast(e.message)); } }));
    $("#cv-ren").onclick = () => { const n = prompt("الاسم الجديد", c.name); if (n && n.trim()) mutate({ op: "rename", collection: cid, name: n.trim() }, () => { c.name = n.trim(); }).then(() => route()); };
    $("#cv-del").onclick = async () => { if (!confirm(`حذف «${c.name}» وكل ما فيها؟`)) return; try { await api("DELETE", "/api/collections/" + cid); await syncNow(); location.hash = "#/library"; } catch (e) { toast(e.message); } };
    $("#cv-share").onclick = () => shareSheet(c);
  }
  async function shareSheet(c) {
    const paint = (code) => {
      const url = code ? location.origin + "/#/sc/" + code : null;
      const s = sheet(`<h4>${ic("link", "sm")} مشاركة «${h(c.name)}»</h4><p class="u-mt0 u-t-sm muted">من يملك الرابط يرى المنشورات المتاحة له فقط، ولا تُشارَك ملاحظاتك الخاصة.</p>
        ${url ? `<input readonly value="${h(url)}" dir="ltr" id="sh-url" aria-label="رابط المشاركة" class="u-w100"><div class="u-g8 u-mt10 row"><button class="btn grow" id="sh-copy">${ic("copy", "sm")} نسخ الرابط</button><button class="btn ghost" id="sh-off">إيقاف المشاركة</button></div>` : `<button class="btn block" id="sh-on">إنشاء رابط مشاركة</button>`}`);
      s.querySelector("#sh-on") && (s.querySelector("#sh-on").onclick = async () => { const r = await api("POST", `/api/collections/${c.id}/share`, {}); c.shared = true; c.shareCode = r.shareCode; await syncNow(); paint(r.shareCode); });
      s.querySelector("#sh-off") && (s.querySelector("#sh-off").onclick = async () => { await api("POST", `/api/collections/${c.id}/share`, { on: false }); c.shared = false; await syncNow(); closeSheet(); toast("أُوقفت المشاركة"); route(); });
      s.querySelector("#sh-copy") && (s.querySelector("#sh-copy").onclick = async () => { try { if (navigator.share) await navigator.share({ title: c.name, url }); else await navigator.clipboard.writeText(url); toast("تم"); } catch { s.querySelector("#sh-url").select(); } });
    };
    if (!online()) return toast("المشاركة تحتاج اتصالاً");
    paint(c.shareCode || null);
  }
  async function sharedView(code) {
    view.innerHTML = skel(2);
    let d; try { d = await api("GET", "/api/shared/collections/" + enc(code)); } catch (e) { view.innerHTML = `<div class="wrap">${errBox(e.message)}</div>`; return; }
    ensureUsers([...(d.users || []), d.owner]);
    view.innerHTML = `<div class="wrap"><header class="col-head" style="background:linear-gradient(150deg,${h(d.collection.color || "#6d3cf4")},color-mix(in srgb,${h(d.collection.color || "#6d3cf4")} 60%,#000))"><small style="font-weight:700;opacity:.9">مجموعة مشتركة من ${h(d.owner.name)}</small><h2>${colGlyph(d.collection, "")} ${h(d.collection.name)}</h2><p>${nf(d.posts.length)} منشور</p></header>${d.posts.map(card).join("") || '<div class="empty">لا منشورات متاحة لك هنا</div>'}</div>`;
  }
  /* people lists */
  async function listsBody(body) {
    let r; try { r = await api("GET", "/api/plists"); } catch (e) { body.innerHTML = errBox(e.message, true); return bindRetry(() => listsBody(body)); }
    body.innerHTML = `${r.lists.length ? `<div class="list">${r.lists.map(l => UI.li({ href: `#/list/${h(l.id)}`, icon: "list", title: l.name, sub: `${nf(l.members)} عضو · ${l.visibility === "public" ? "عامة" : "خاصة"}`, attrs: 'data-pl="1"' })).join("")}</div>` : UI.empty({ title: "لا قوائم بعد", text: "اصنع قوائم لأشخاص تحب قراءة منشوراتهم معاً." })}
      <button class="btn block" id="pl-new">${ic("plus", "sm")} قائمة جديدة</button>`;
    $("#pl-new").onclick = () => {
      const s = sheet(`<h4>قائمة أشخاص جديدة</h4><input id="pl-n" maxlength="50" placeholder="مثال: مطورون عرب" aria-label="اسم القائمة" class="u-w100"><textarea id="pl-d" rows="2" maxlength="200" placeholder="وصف (اختياري)" aria-label="الوصف" class="u-w100 u-mt8"></textarea>
        <div class="u-dflex u-mt10 seg" role="group" aria-label="الخصوصية"><button class="grow on" data-v="private" aria-pressed="true">${ic("lock", "xs")} خاصة</button><button class="grow" data-v="public" aria-pressed="false">عامة</button></div><button class="u-mt12 btn block" id="pl-go">إنشاء</button>`);
      let vis = "private"; s.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { vis = b.dataset.v; s.querySelectorAll("[data-v]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); }); });
      s.querySelector("#pl-go").onclick = async () => { const name = s.querySelector("#pl-n").value.trim(); if (!name) return; try { const l = (await api("POST", "/api/plists", { name, descr: s.querySelector("#pl-d").value.trim() || undefined, visibility: vis })).list; closeSheet(); location.hash = "#/list/" + l.id; } catch (e) { toast(e.message); } };
    };
  }
  async function listView(id) {
    if (!online()) return V12.list(id);
    const re = loading(3);
    let d, f; try { [d, f] = await Promise.all([api("GET", "/api/plists/" + enc(id)), api("GET", `/api/feed?mode=${enc("list:" + id)}&limit=30`)]); } catch (e) { view.innerHTML = `<div class="wrap">${errBox(e.status === 404 ? "القائمة غير موجودة" : e.message)}</div>`; return; }
    ensureUsers([...d.members, d.owner, ...(f.users || [])]);
    const l = d.list;
    view.innerHTML = `<div class="wrap"><a class="back d-back" href="#/library"><span class="fwd" aria-hidden="true">→</span> المحفوظات</a>
      <header class="u-mt8 card"><div class="u-g12 row"><div class="av lg" style="background:var(--grad);width:64px;height:64px;font-size:26px">${ic("list")}</div><div class="grow"><h2 class="u-m0">${h(l.name)}</h2><div class="muted">${l.visibility === "public" ? "قائمة عامة" : "قائمة خاصة"} · ${nf(l.members)} عضو · من ${h(d.owner.name)}</div></div></div>
        ${l.descr ? `<p class="u-m0 u-mt10">${h(l.descr)}</p>` : ""}
        <div class="u-mt12 pl-av">${d.members.slice(0, 8).map(u => av(u, "sm")).join("")}</div>
        ${d.mine ? `<div class="u-g8 u-mt12 row"><button class="btn ghost grow" id="pl-add">${ic("plus", "sm")} إضافة أشخاص</button><button class="btn ghost" id="pl-vis">${l.visibility === "public" ? "اجعلها خاصة" : "اجعلها عامة"}</button><button class="d-icon-btn" id="pl-del" aria-label="حذف القائمة">${ic("trash", "sm")}</button></div>` : ""}</header>
      ${f.posts.map(card).join("") || `<div class="empty">لا منشورات من أعضاء القائمة بعد</div>`}</div>`;
    painted(re);
    if (!d.mine) return;
    $("#pl-vis").onclick = async () => { await api("PATCH", "/api/plists/" + id, { visibility: l.visibility === "public" ? "private" : "public" }); listView(id); };
    $("#pl-del").onclick = async () => { if (!confirm("حذف القائمة؟")) return; await api("DELETE", "/api/plists/" + id); view._dlib = "lists"; location.hash = "#/library"; };
    $("#pl-add").onclick = () => {
      const s = sheet(`<h4>إضافة إلى «${h(l.name)}»</h4><input id="pa-q" placeholder="ابحث بالاسم أو المعرّف" aria-label="بحث عن أشخاص" class="u-w100"><div id="pa-r" class="u-mt8"></div>`);
      const members = new Set(d.members.map(u => u.id)); let tm;
      const paint = (people) => { s.querySelector("#pa-r").innerHTML = people.map(u => `<div class="u-py8 u-g10 row">${av(u, "sm")}<div class="grow"><b>${h(u.name)}</b> <span class="muted">@${h(u.handle)}</span></div><button class="btn ${members.has(u.id) ? "ghost" : ""}" data-pu="${h(u.id)}" style="padding:7px 14px">${members.has(u.id) ? "✓ مضاف" : "إضافة"}</button></div>`).join("") || '<p class="muted">اكتب للبحث</p>'; s.querySelectorAll("[data-pu]").forEach(b => b.onclick = async () => { const on = !members.has(b.dataset.pu); await api(on ? "PUT" : "DELETE", `/api/plists/${id}/members/${b.dataset.pu}`); on ? members.add(b.dataset.pu) : members.delete(b.dataset.pu); b.textContent = on ? "✓ مضاف" : "إضافة"; b.classList.toggle("ghost", on); }); };
      paint(DB.users.filter(u => u.id !== DB.me && S.follows(DB.me, u.id)).slice(0, 8));
      s.querySelector("#pa-q").oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => { const r = await api("GET", "/api/search/suggest?q=" + enc(e.target.value)).catch(() => ({ people: [] })); paint(r.people); }, 160); };
      s._onclose = () => listView(id);
    };
  }

  /* ---------- routes (override the device-only views when the server is reachable) ---------- */
  MPRoutes.extend((a, b) => ({ search: () => searchView(a),
    explore: () => exploreView(),
    topic: () => topicView(a),
    tag: () => tagView(a),
    library: () => libraryView(),
    collection: () => collectionView(a),
    sc: () => sharedView(a),
    lists: () => (online() ? libraryView("lists") : V12.lists()),
    list: () => listView(a),
    digest: () => digestView(),
    feedprefs: () => feedPrefsView() }));
  // settings: a link to the feed & summaries page, appended below the fold (keeps the screen unchanged)
  MPSettings.add(function () { if (online() && !view.querySelector("#d-fp-link")) view.querySelector(".wrap")?.insertAdjacentHTML("beforeend", `<a href="#/feedprefs" id="d-fp-link" class="u-dflex card row">${ic("sliders")}<div class="grow"><b>الخلاصة والملخصات</b><div class="muted">الترتيب الزمني، التبويبات، «أكثر/أقل»، النشرة الأسبوعية</div></div><span class="muted">←</span></a>`); });

  /* ---------- boot ---------- */
  window.MPDiscovery = { syncNow, fetchRanked, loadPrefs, state: () => ({ FD, SV }) };
  /* boot once the app is talking to the server (the chunk can load before or after sign-in) */
  let booted = null, bootedFor = null;
  const authed = () => online() && !!Remote.snap && !!DB.me;
  function ready() {
    if (!authed()) return null;
    if (bootedFor !== DB.me) { booted = null; bootedFor = DB.me; FD.prefs = null; FD.ranked = {}; SV = null; } // first sign-in or account switch
    return booted ||= (async () => {
      await Promise.all([loadPrefs(), loadFollows(), loadLocal()]);
      mirror(); fetchRanked(FD.prefs?.chrono ? "chrono" : "for"); syncNow();
      const r = (location.hash.split("/")[1] || "home").split("?")[0];
      if (r === "home") enhanceHome();
      if (r === "post") enhancePost(location.hash.split("/")[2]);
    })();
  }
  ready();
  addEventListener("hashchange", () => { if (!booted) ready(); });
})();
