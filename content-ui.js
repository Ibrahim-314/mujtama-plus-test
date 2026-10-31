/* =====================================================================
 * مجتمع بلس — v2.4 creation layer (Track 3: phases 11–15)
 * (v2.50: the editors live in the lazy "composer" chunk — composer-core.js + composer-ui.js, docs/COMPOSER.md.)
 * Article reader (TOC, reading progress,
 * adjustable font, series, paragraph comments), stories, vertical shorts, custom video player
 * (HLS + captions + gestures), audio posts with waveform and a floating player.
 * v2.42: the live audio rooms and the creator studio moved to the lazy "creation" chunk (creation-ui.js).
 * ===================================================================== */
(function CreationLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const RT = window.RichText;
  const rawUrl = (css) => { const m = /url\('([^']+)'\)/.exec(css || ""); return m ? m[1] : (/^\/media\//.test(css || "") ? css : null); };
  const fmtDur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, "0")}`;
  const device = (() => { let d = localStorage.getItem("mp_device"); if (!d) { d = (/Mobi/.test(navigator.userAgent) ? "phone-" : "web-") + Math.random().toString(36).slice(2, 8); localStorage.setItem("mp_device", d); } return d; })();
  const rid = (p) => p + "_" + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

  /* ---------- traffic sources for analytics: every view says where it came from ---------- */
  const sourceNow = () => { const r = (location.hash.split("/")[1] || "home").split("?")[0]; return { home: view._htab === "following" ? "following" : "feed", u: "profile", me: "profile", explore: view._q ? "search" : "explore", search: "search", tag: "explore", topic: "explore", c: "community", communities: "community", notifications: "notification", shorts: "shorts", clips: "shorts", post: document.referrer ? "share" : "direct" }[r] || "direct"; };
  let lastSource = "direct"; addEventListener("hashchange", (e) => { const from = (new URL(e.oldURL).hash.split("/")[1] || "home").split("?")[0]; lastSource = { home: "feed", u: "profile", me: "profile", explore: "explore", c: "community", notifications: "notification", shorts: "shorts", clips: "shorts" }[from] || "direct"; });
  if (typeof Remote !== "undefined" && Remote.use) Remote.use(function viewSource(req, next) {
    if (req.method === "POST" && /^\/api\/posts\/[^/]+\/view$/.test(req.path) && !req.body) req = { ...req, body: { source: location.hash.startsWith("#/post/") ? lastSource : sourceNow() } };
    return next(req);
  });

  /* =================== Rendering: rich text, real images, audio, video =================== */
  
  PostHooks.inner("content-ui#1", 150, (_pi) => function (p, opts = {}) {
    let h = _pi(p, opts); if (!p || !RT) return h;
    if (p.doc && p.type !== "article") {
      const html = RT.toHTML(p.doc, { media: (m) => m });
      h = h.replace(/<div class="body">([\s\S]*?)<\/div>/, `<div class="body rich${opts.full ? "" : " clamp"}">${html}</div>`);
    }
    if (p.type === "article" && p.readingMin) h = h.replace(/<h3>/, `<span class="chip rt">${ic("eye", "xs")} ${p.readingMin} د قراءة</span><h3>`);
    /* v2.60 M1: images render as a gallery in the post body (the <!--mp:media--> slot of postInner), never at the first </a>
     * (that was the author's avatar link: a single image used to land inside the 46 px avatar). Works for every stored shape:
     * images[] with or without alts (1…10), and the legacy single `media` /media/ url. */
    const gal = galleryFor(p);
    if (gal) {
      h = h.replace(/<div class="grid3">(?:<div style="[^"]*"><\/div>)+<\/div>/, "");
      h = h.replace(/<div class="media(?: zoomable)?"(?: data-zoom="1")? style="background:url[^"]*"><\/div>/, "");
      h = h.includes("<!--mp:media-->") ? h.replace("<!--mp:media-->", gal) : h.includes('<div class="actions') ? h.replace(/(<div class="actions)/, gal + "$1") : h + gal;
    }
    if (p.type === "audio" && p.audio) h = h.replace(/(<div class="actions)/, audioCard(p) + "$1");
    if (p.type === "video" && p.status === "processing") h = h.replace(/<div class="u-tc card"><svg class=ei aria-hidden=true><use href=#i-hourglass \/><\/svg>[\s\S]*?<\/div><\/div>/, processingCard(p, "video"));
    if (p.type === "video" && (p.video?.variants?.master || p.video?.variants?.["360p"] || p.video?.variants?.["720p"])) {
      const v = p.video, poster = MPVideoSources.poster(v.variants), ar = aspectOf(v);
      const cls = `mp-video${v.short ? " short" : ""}${ar ? (ar < 0.95 ? " portrait" : " sized") : ""}`;
      const style = [poster ? `background-image:url('${esc(poster)}')` : "", ar ? `--ar:${ar.toFixed(4)}` : ""].filter(Boolean).join(";");
      h = h.replace(/<div class="media play"[^>]*>[\s\S]*?<\/div>/, `<div class="${cls}" data-video="${p.id}"${poster && !ar ? ` data-poster="${esc(poster)}"` : ""}${style ? ` style="${style}"` : ""}><button class="mp-big" aria-label="تشغيل الفيديو">${ic("play", "lg")}</button>${v.duration > 0 || v.variants.captions?.length ? `<span class="dur">${v.duration > 0 ? fmtDur(v.duration) : ""}${v.variants.captions?.length ? (v.duration > 0 ? " · " : "") + "CC" : ""}</span>` : ""}</div>`);
    }
    return h;
  });
  /** the stored image urls of a post → gallery markup (null when the post has no real uploaded image) */
  function galleryFor(p) {
    let urls = [], alts = [];
    if (Array.isArray(p.images) && p.images.length) { urls = p.images.map(rawUrl); alts = p.alts || []; if (!urls.every(Boolean)) return null; }
    else if (p.media && !["article", "video", "story", "audio"].includes(p.type) && rawUrl(p.media)) urls = [rawUrl(p.media)];
    if (!urls.length) return null;
    const n = urls.length;
    /* media M2: a single image whose real size was stored (imageDims[0] = [w, h]) reserves its aspect ratio on first render,
     * so the card does not jump from 4:3 to the real shape when the photo arrives; older posts keep sizing on load */
    const d0 = n === 1 && Array.isArray(p.imageDims) && Array.isArray(p.imageDims[0]) ? p.imageDims[0] : null, w0 = d0 ? Math.round(+d0[0]) : 0, h0 = d0 ? Math.round(+d0[1]) : 0;
    const sized0 = w0 > 0 && h0 > 0 ? ` class="sized" width="${w0}" height="${h0}" style="--ar:${clampAr(w0, h0).toFixed(4)}"` : "";
    return `<div class="gallery g${Math.min(n, 5)}" data-gal-post="${esc(p.id)}">${urls.slice(0, 5).map((u, i) => `<img${i === 0 ? sized0 : ""} src="${esc(u)}" alt="${esc(alts[i] || "")}" loading="lazy" decoding="async" data-gal="${esc(p.id)}:${i}" tabindex="0" role="button" aria-label="${esc(`عرض الصورة ${i + 1} من ${n}${alts[i] ? ": " + alts[i] : ""}`)}">${i === 4 && n > 5 ? `<span class="more" aria-hidden="true">+${n - 5}</span>` : ""}`).join("")}</div>`;
  }
  /** width ÷ height of a processed video when known (stored by the pipeline since v2.60) */
  function aspectOf(v) { const w = +(v.width || v.variants?.width), hh = +(v.height || v.variants?.height); return w > 0 && hh > 0 ? Math.max(0.5, Math.min(2.4, w / hh)) : 0; }
  /** processing / failed state of a media post (only its author sees a processing post) */
  function processingCard(p, field) {
    const m = p[field] || {}, mine = typeof DB !== "undefined" && p.author === DB.me, what = field === "audio" ? "المقطع الصوتي" : "الفيديو";
    if (m.status === "failed") {
      const why = m.error === "storage_full" ? "مساحة التخزين ممتلئة حالياً." : m.error === "too_large" ? "الملف أكبر من الحد المسموح للتخزين." : "حدث خطأ أثناء تجهيز الملف.";
      return `<div class="mp-state failed" role="status">${ic("alert", "sm")}<div class="grow"><b>تعذّر التجهيز</b><span class="muted">${why}</span>${mine ? `<span class="muted">منشورك لا يظهر لغيرك حتى ينجح التجهيز.</span>` : ""}</div>${mine && m.mediaId ? `<button type="button" class="btn ghost" data-mretry="${esc(m.mediaId)}" data-mretry-post="${esc(p.id)}">${ic("refresh", "xs")} إعادة المحاولة</button>` : ""}</div>`;
    }
    return `<div class="mp-state" role="status"><span class="mp-spin" aria-hidden="true"></span><div class="grow"><b>جارٍ تجهيز ${what}…</b>${mine ? `<span class="muted">سيظهر للجميع تلقائياً عند اكتماله.</span>` : ""}</div></div>`;
  }
  function audioCard(p) {
    const a = p.audio; if (a.status === "failed") return processingCard(p, "audio");
    if (p.status === "processing" || !a.waveform) return `<div class="audio-card processing">${ic("refresh", "sm")} جارٍ تجهيز المقطع الصوتي…</div>`;
    return `<div class="audio-card" data-audio="${p.id}"><button class="ap-play" data-ap="${p.id}" aria-label="تشغيل">${ic("play", "sm")}</button><div class="wave" aria-hidden="true">${a.waveform.map((v, i) => `<i style="--h:${Math.max(8, v * 100)}%;--i:${i}"></i>`).join("")}</div><span class="muted ap-t">${fmtDur(a.duration)}</span></div>${a.transcript && !["unavailable", "pending"].includes(a.transcript) ? `<details class="transcript"><summary>النص المفرّغ</summary><p>${esc(a.transcript)}</p></details>` : ""}`;
  }
  if (!window.UI || !UI.icon("play")) { /* icons added below if missing */ }

  /* v2.73: the video player (MPPlayer), its source picker (MPVideoSources) and resume watching (MPResume) moved to
   * video/player/*.js (core bundle, loaded right before this file). Same globals, same behaviour; see video/README.md. */

  /* icons the media layer needs beyond the core sprite (Lucide, ISC) */
  (function sprite() {
    const P = { chevron: '<path d="m9 18 6-6-6-6"/>' };
    const host = document.querySelector("symbol[id^='i-']")?.parentNode; if (!host) return;
    host.insertAdjacentHTML("beforeend", Object.entries(P).filter(([k]) => !document.getElementById("i-" + k)).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${v}</symbol>`).join(""));
  })();
  /* ---------- v2.60 M1: real proportions for a single image and for videos whose size is not stored yet ---------- */
  const clampAr = (w, h) => Math.max(0.8, Math.min(1.91, w / h)); // 4:5 (portrait) … 1.91:1 (panorama); the lightbox shows the whole image
  const sizeImg = (img) => { if (!img.naturalWidth || img.classList.contains("sized")) return; img.style.setProperty("--ar", clampAr(img.naturalWidth, img.naturalHeight).toFixed(4)); img.classList.add("sized"); };
  document.addEventListener("load", (e) => { const img = e.target; if (img instanceof HTMLImageElement && img.matches(".gallery.g1 img[data-gal]")) sizeImg(img); }, true);
  document.addEventListener("error", (e) => {
    const img = e.target; if (!(img instanceof HTMLImageElement) || !img.matches("img[data-gal]")) return;
    img.classList.add("broken"); img.removeAttribute("role"); img.removeAttribute("tabindex"); img.setAttribute("aria-label", "تعذّر تحميل الصورة"); img.title = "تعذّر تحميل الصورة";
  }, true);
  const posterAr = (box) => {
    if (box._ar || !box.dataset.poster) return; box._ar = 1;
    const im = new Image(); im.onload = () => { if (!im.naturalWidth || box.style.getPropertyValue("--ar")) return; const ar = Math.max(0.5, Math.min(2.4, im.naturalWidth / im.naturalHeight)); box.style.setProperty("--ar", ar.toFixed(4)); box.classList.add(ar < 0.95 ? "portrait" : "sized"); }; im.src = box.dataset.poster;
  };
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.querySelectorAll) {
    (n.matches(".mp-video[data-poster]") ? [n] : n.querySelectorAll(".mp-video[data-poster]")).forEach(posterAr);
    n.querySelectorAll(".gallery.g1 img[data-gal]").forEach(i => { if (i.complete) sizeImg(i); }); // already in the cache: no load event to wait for
  } }).observe(document.body, { childList: true, subtree: true });

  /* ---------- v2.60 M1: retry a media post whose processing failed («تعذّر التجهيز») ---------- */
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mretry]"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); if (!online()) return toast("إعادة المحاولة تحتاج اتصالاً بالإنترنت");
    b.disabled = true; b.setAttribute("aria-busy", "true");
    try {
      const r = await api("POST", `/api/media/${encodeURIComponent(b.dataset.mretry)}/retry`);
      const p = S.post(b.dataset.mretryPost); const f = p?.audio?.mediaId === b.dataset.mretry ? "audio" : "video";
      if (p && p[f]) { p[f] = { ...p[f], status: r.media.status === "ready" ? "ready" : "processing" }; delete p[f].error; }
      toast(r.media.status === "ready" ? "اكتمل التجهيز" : "أُعيد التجهيز، سيظهر المنشور عند اكتماله");
      if (typeof patchPost === "function") { try { patchPost(b.dataset.mretryPost); } catch { rerender(); } } else if (typeof rerender === "function") rerender();
      if (r.media.status === "ready" && typeof refresh === "function") refresh().catch(() => { });
    } catch (er) { b.disabled = false; b.removeAttribute("aria-busy"); toast(er.message || "تعذّرت إعادة المحاولة"); }
  }, true);

  /* ---------- v2.60 M1: image lightbox — tap to open, swipe, pinch / double-tap / wheel zoom, keyboard, RTL & LTR, a11y ---------- */
  const LB = { el: null };
  function lightboxOpen(items, start = 0, returnTo = null) {
    if (!items.length) return; LB.el?._close?.();
    const rtl = () => getComputedStyle(document.documentElement).direction === "rtl";
    const d = document.createElement("div"); d.className = "mp-lb"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", "عارض الصور");
    d.innerHTML = `<div class="mp-lb-top"><span class="mp-lb-n" aria-live="polite" dir="ltr"></span><span class="grow"></span><button type="button" class="mp-lb-b" data-lb="zoom" aria-label="تكبير" aria-pressed="false">${ic("search", "sm")}</button><button type="button" class="mp-lb-b" data-lb="close" aria-label="إغلاق العارض">${ic("x", "sm")}</button></div>
      <div class="mp-lb-stage"><img class="mp-lb-img" alt="" draggable="false"></div>
      ${items.length > 1 ? `<button type="button" class="mp-lb-b mp-lb-nav prev" data-lb="prev" aria-label="الصورة السابقة">${ic("chevron", "sm")}</button><button type="button" class="mp-lb-b mp-lb-nav next" data-lb="next" aria-label="الصورة التالية">${ic("chevron", "sm")}</button>` : ""}
      <p class="mp-lb-alt" hidden></p>`;
    document.body.appendChild(d); document.body.classList.add("mp-lb-open"); LB.el = d;
    const img = d.querySelector(".mp-lb-img"), stage = d.querySelector(".mp-lb-stage"), n = d.querySelector(".mp-lb-n"), alt = d.querySelector(".mp-lb-alt"), zb = d.querySelector('[data-lb="zoom"]');
    let i = Math.max(0, Math.min(items.length - 1, start)), sc = 1, tx = 0, ty = 0;
    const apply = (anim) => { img.style.transition = anim ? "transform .2s ease" : "none"; img.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`; zb.setAttribute("aria-pressed", String(sc > 1)); zb.setAttribute("aria-label", sc > 1 ? "إلغاء التكبير" : "تكبير"); d.classList.toggle("zoomed", sc > 1); };
    const clampPan = () => { const r = stage.getBoundingClientRect(), w = img.offsetWidth * sc, h = img.offsetHeight * sc, mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2); tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty)); };
    const zoomTo = (s, cx, cy) => { const r = img.getBoundingClientRect(), ox = cx == null ? 0 : cx - (r.left + r.width / 2), oy = cy == null ? 0 : cy - (r.top + r.height / 2), k = s / sc; tx = (tx - ox) * k + ox; ty = (ty - oy) * k + oy; sc = s; if (sc <= 1.01) { sc = 1; tx = 0; ty = 0; } clampPan(); apply(true); };
    function show(k, dir = 0) {
      i = (k + items.length) % items.length; sc = 1; tx = 0; ty = 0; apply(false);
      const it = items[i]; img.src = it.src; img.alt = it.alt || `الصورة ${i + 1}`;
      n.textContent = items.length > 1 ? `${i + 1} / ${items.length}` : ""; alt.textContent = it.alt || ""; alt.hidden = !it.alt;
      if (dir) { img.animate?.([{ opacity: 0, transform: `translateX(${dir * (rtl() ? -40 : 40)}px)` }, { opacity: 1, transform: "none" }], { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 180 }); }
    }
    const next = () => show(i + 1, 1), prev = () => show(i - 1, -1);
    function close() {
      if (!d.isConnected) return; d.remove(); document.body.classList.remove("mp-lb-open"); removeEventListener("keydown", key, true); if (LB.el === d) LB.el = null;
      try { returnTo?.focus?.({ preventScroll: true }); } catch { }
    }
    d._close = close;
    function key(e) {
      if (!d.isConnected) return;
      const fwd = rtl() ? "ArrowLeft" : "ArrowRight", back = rtl() ? "ArrowRight" : "ArrowLeft";
      const handled = ["Escape", fwd, back, "Home", "End", "+", "=", "-"].includes(e.key); if (handled) e.stopImmediatePropagation(); // the viewer owns these keys while open
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === fwd && items.length > 1 && sc === 1) { e.preventDefault(); next(); }
      else if (e.key === back && items.length > 1 && sc === 1) { e.preventDefault(); prev(); }
      else if (e.key === "Home" && items.length > 1) { e.preventDefault(); show(0); }
      else if (e.key === "End" && items.length > 1) { e.preventDefault(); show(items.length - 1); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(Math.min(4, sc * 1.5)); }
      else if (e.key === "-") { e.preventDefault(); zoomTo(Math.max(1, sc / 1.5)); }
      else if (e.key === "Tab") { const f = [...d.querySelectorAll("button")]; const at = f.indexOf(document.activeElement); if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && at === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    }
    addEventListener("keydown", key, true);
    d.addEventListener("click", (e) => {
      const b = e.target.closest("[data-lb]"); e.stopPropagation();
      if (b) { const a = b.dataset.lb; if (a === "close") close(); if (a === "next") next(); if (a === "prev") prev(); if (a === "zoom") zoomTo(sc > 1 ? 1 : 2.5); return; }
      if (dragged) { dragged = false; return; } // the click that ends a swipe / pan does not close the viewer
      if (e.target === d || e.target === stage) { if (sc === 1) close(); }
    });
    d.addEventListener("wheel", (e) => { if (!e.ctrlKey && sc === 1 && Math.abs(e.deltaY) < 1) return; e.preventDefault(); zoomTo(Math.max(1, Math.min(4, sc * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), e.clientX, e.clientY); }, { passive: false });
    img.addEventListener("dblclick", (e) => { e.preventDefault(); zoomTo(sc > 1 ? 1 : 2.5, e.clientX, e.clientY); });
    /* pointers: one finger swipes (or pans when zoomed), two fingers pinch; a quick double tap zooms on touch */
    const pts = new Map(); let g = null, lastTap = 0, dragged = false;
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return; stage.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; g = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: sc, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
      else g = { pinch: false, x0: e.clientX, y0: e.clientY, tx0: tx, ty0: ty, t0: Date.now(), moved: false };
    });
    stage.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId) || !g) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const s = Math.max(1, Math.min(4, g.s0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0)); sc = s; if (sc === 1) { tx = 0; ty = 0; } clampPan(); apply(false); return; }
      if (g.pinch) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0; if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (sc > 1) { tx = g.tx0 + dx; ty = g.ty0 + dy; clampPan(); apply(false); }
      else if (items.length > 1) { img.style.transition = "none"; img.style.transform = `translateX(${dx}px)`; }
      else if (dy > 0) { img.style.transition = "none"; img.style.transform = `translateY(${dy}px)`; d.style.setProperty("--lb-bg", String(Math.max(0.35, 1 - dy / 400))); }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (!g) return;
      if (g.pinch) { dragged = true; setTimeout(() => { dragged = false; }, 400); if (pts.size === 0) { if (sc < 1.05) zoomTo(1); g = null; } return; }
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0, quick = Date.now() - g.t0 < 300; if (g.moved) { dragged = true; setTimeout(() => { dragged = false; }, 400); }
      if (sc === 1) {
        d.style.removeProperty("--lb-bg");
        if (items.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { const forward = rtl() ? dx > 0 : dx < 0; forward ? next() : prev(); }
        else if (items.length <= 1 && dy > 110 && Math.abs(dy) > Math.abs(dx)) close();
        else apply(true);
      }
      if (!g.moved && quick && e.pointerType !== "mouse") { const t = Date.now(); if (t - lastTap < 300) { zoomTo(sc > 1 ? 1 : 2.5, e.clientX, e.clientY); lastTap = 0; } else lastTap = t; }
      g = null;
    };
    stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
    show(i); setTimeout(() => d.querySelector('[data-lb="close"]')?.focus(), 30);
    return { close, show, get index() { return i; }, get scale() { return sc; } };
  }
  window.MPLightbox = { open: lightboxOpen, get current() { return LB.el; } };
  const galItems = (img) => {
    const [pid, k] = (img.dataset.gal || "").split(":"), p = typeof S !== "undefined" ? S.post(pid) : null;
    let urls = [], alts = [];
    if (p && Array.isArray(p.images) && p.images.length) { urls = p.images.map(rawUrl).filter(Boolean); alts = p.alts || []; } else if (p && p.media && rawUrl(p.media)) urls = [rawUrl(p.media)];
    if (!urls.length) { const g = img.closest(".gallery"); [...(g ? g.querySelectorAll("img[data-gal]") : [img])].forEach(x => { urls.push(x.getAttribute("src")); alts.push(x.getAttribute("alt") || ""); }); }
    return { items: urls.map((src, j) => ({ src, alt: alts[j] || "" })), index: +k || 0 };
  };
  /* window-level capture runs before the feed's double-tap / open-post handlers: a tap on a gallery image opens the viewer,
   * a quick second tap still likes the post (same 320 ms window as the rest of the card) */
  let galTap = { t: 0, el: null, timer: 0 };
  const openFrom = (img, at) => { const { items, index } = galItems(img); lightboxOpen(items, at != null ? at : index, img); };
  addEventListener("click", (e) => {
    const t = e.target.closest?.(".gallery[data-gal-post] img[data-gal], .gallery[data-gal-post] .more"); if (!t || t.classList.contains("broken")) return;
    const img = t.matches("img") ? t : t.previousElementSibling; if (!img) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const now = Date.now(), card = img.closest(".post-card");
    if (card && galTap.el === img && now - galTap.t < 320) {
      clearTimeout(galTap.timer); galTap = { t: 0, el: null, timer: 0 };
      const rb = card.querySelector("[data-react]"); // same as a double tap anywhere on the card: a heart, and a like if not liked yet
      if (rb) { const hb = document.createElement("div"); hb.className = "heart-burst"; hb.style.left = e.clientX + "px"; hb.style.top = e.clientY + "px"; hb.innerHTML = ic("heartF", "lg"); document.body.appendChild(hb); setTimeout(() => hb.remove(), 850); if (!S.myReaction(rb.dataset.react)) rb.click(); }
      return;
    }
    clearTimeout(galTap.timer); galTap = { t: now, el: img, timer: setTimeout(() => { galTap.el = null; openFrom(img, t.matches(".more") ? 4 : null); }, card ? 300 : 0) };
  }, true);
  addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return; const img = e.target.closest?.(".gallery[data-gal-post] img[data-gal]"); if (!img || img.classList.contains("broken")) return;
    e.preventDefault(); e.stopImmediatePropagation(); openFrom(img);
  }, true);

  /* ---------- floating audio player (persists across navigation) ---------- */
  const AP = { el: null, audio: new Audio(), post: null };
  AP.audio.preload = "none";
  function apPlay(p) {
    if (AP.post?.id === p.id) { AP.audio.paused ? AP.audio.play() : AP.audio.pause(); return; }
    AP.post = p; AP.audio.src = p.audio.variants?.m4a || p.audio.variants?.original; AP.audio.play().catch(() => { });
    if (!AP.el) { AP.el = document.createElement("div"); AP.el.id = "mini-player"; AP.el.setAttribute("role", "region"); AP.el.setAttribute("aria-label", "المشغل"); document.body.appendChild(AP.el); }
    const u = S.user(p.author);
    AP.el.innerHTML = `<button class="ap-toggle" aria-label="تشغيل/إيقاف">${ic("pause", "sm")}</button><div class="u-mw0 grow"><b class="ap-title">${esc((p.title || p.text || "مقطع صوتي").slice(0, 60))}</b><div class="muted ap-sub">${esc(u?.name || "")}</div><div class="ap-prog"><i></i></div></div><button class="ap-rate" aria-label="السرعة">1×</button><button class="ap-close" aria-label="إغلاق">${ic("x", "sm")}</button>`;
    AP.el.classList.add("on");
    AP.el.querySelector(".ap-toggle").onclick = () => AP.audio.paused ? AP.audio.play() : AP.audio.pause();
    AP.el.querySelector(".ap-close").onclick = () => { AP.audio.pause(); AP.el.classList.remove("on"); AP.post = null; syncCards(); };
    const rates = [1, 1.5, 2]; let ri = 0; AP.el.querySelector(".ap-rate").onclick = (e) => { ri = (ri + 1) % 3; AP.audio.playbackRate = rates[ri]; e.target.textContent = rates[ri] + "×"; };
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: (p.title || p.text || "مقطع صوتي").slice(0, 80), artist: u?.name || "مجتمع بلس", album: "مجتمع بلس" });
  }
  function syncCards() {
    document.querySelectorAll(".audio-card").forEach(c => { const on = AP.post?.id === c.dataset.audio && !AP.audio.paused; c.classList.toggle("playing", on); const b = c.querySelector(".ap-play"); if (b) b.innerHTML = ic(on ? "pause" : "play", "sm"); });
    if (AP.el) AP.el.querySelector(".ap-toggle").innerHTML = ic(AP.audio.paused ? "play" : "pause", "sm");
  }
  ["play", "pause", "ended"].forEach(ev => AP.audio.addEventListener(ev, syncCards));
  AP.audio.addEventListener("timeupdate", () => { const pr = AP.audio.currentTime / (AP.audio.duration || 1); if (AP.el) AP.el.querySelector(".ap-prog i").style.width = pr * 100 + "%"; const c = document.querySelector(`.audio-card[data-audio="${AP.post?.id}"]`); if (c) { c.style.setProperty("--pr", pr); c.querySelector(".ap-t").textContent = fmtDur(AP.audio.currentTime); } });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-ap]"); if (!b) return; e.preventDefault(); e.stopPropagation(); const p = S.post(b.dataset.ap); if (p) apPlay(p); }, true);
  const _rerender = typeof rerender === "function" ? rerender : null;
  new MutationObserver(() => { if (AP.post) syncCards(); }).observe(document.getElementById("view") || document.body, { childList: true });

  /* v2.50: the v3 composer moved to the lazy "composer" chunk (composer-ui.js) together with the community editor */

  /* =================== Article reader =================== */
  const FONT_KEY = "mp_read_font";
  const _post = Views.post;
  Views.post = function (pid) {
    _post.apply(this, arguments);
    const p = S.post(pid); if (!p || p.type !== "article" || !RT) return;
    const doc = p.doc || RT.parse(p.text), toc = RT.toc(doc), wrap = view.querySelector(".wrap"); if (!wrap) return;
    const card = wrap.querySelector(".card"); if (!card) return;
    const u = S.user(p.author), size = +localStorage.getItem(FONT_KEY) || 19;
    const body = document.createElement("article"); body.className = "reader"; body.style.setProperty("--rf", size + "px");
    body.innerHTML = `<div class="read-progress" aria-hidden="true"><i></i></div>
      <div class="reader-tools"><button data-f="-1" aria-label="تصغير الخط">ا-</button><button data-f="1" aria-label="تكبير الخط">ا+</button><button data-calm aria-label="وضع القراءة الهادئ">${ic("eye", "xs")} هادئ</button><a href="/a/${p.id}" target="_blank" rel="noopener" class="muted" aria-label="صفحة المقال العامة">${ic("share", "xs")}</a></div>
      <h1 class="r-title">${esc(p.title)}</h1><div class="muted r-meta">${esc(u?.name || "")} · ${p.readingMin || RT.readingMinutes(doc)} د قراءة</div>
      <div id="r-series"></div>
      ${toc.length >= 3 ? `<nav class="r-toc" aria-label="المحتويات"><b>المحتويات</b>${toc.map(t => `<a href="#" data-toc="${t.id}" class="l${t.level}">${esc(t.text)}</a>`).join("")}</nav>` : ""}
      <div class="r-body rich">${RT.toHTML(doc, { anchors: true })}</div>`;
    const inner = card.querySelector(".body"); if (inner) inner.replaceWith(body); else card.prepend(body);
    card.querySelector(".media")?.remove();
    body.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { const v = Math.max(15, Math.min(28, (+localStorage.getItem(FONT_KEY) || 19) + +b.dataset.f * 2)); localStorage.setItem(FONT_KEY, v); body.style.setProperty("--rf", v + "px"); });
    body.querySelector("[data-calm]").onclick = () => document.body.classList.toggle("calm");
    body.querySelectorAll("[data-toc]").forEach(a => a.onclick = (e) => { e.preventDefault(); document.getElementById(a.dataset.toc)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    const bar = body.querySelector(".read-progress i");
    const onScroll = () => { if (!document.body.contains(body)) return removeEventListener("scroll", onScroll); const r = body.getBoundingClientRect(); const pr = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight))); bar.style.transform = `scaleX(${pr})`; };
    addEventListener("scroll", onScroll, { passive: true });
    if (online()) {
      api("GET", `/api/posts/${p.id}/paragraphs`).then(({ counts }) => { for (const [k, n] of Object.entries(counts)) { const b = body.querySelector(`[data-para="${k}"]`); if (b) { b.textContent = n; b.classList.remove("empty"); b.setAttribute("aria-label", `${n} تعليق`); } } }).catch(() => { });
      if (p.series) api("GET", "/api/series/" + p.series).then(({ parts }) => { if (parts.length > 1) body.querySelector("#r-series").innerHTML = `<nav class="r-series"><b>سلسلة من ${parts.length} أجزاء</b>${parts.map(s => s.id === p.id ? `<span class="on">${s.part}. ${esc(s.title)}</span>` : `<a href="#/post/${s.id}">${s.part}. ${esc(s.title)}</a>`).join("")}</nav>`; }).catch(() => { });
    }
    body.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-para]"); if (!b || !online()) return; e.preventDefault();
      const anchor = b.dataset.para, para = body.querySelector(`[data-block="${anchor}"]`);
      const { comments = [] } = await api("GET", `/api/posts/${p.id}/paragraphs?anchor=${anchor}`);
      sheet(`<blockquote class="para-quote">${esc((para?.textContent || "").replace(/\d+$|\+$/, "").slice(0, 220))}</blockquote>${comments.map(c => `<div class="u-g8 u-py8 u-ais row">${av(S.user(c.author) || { name: "?", handle: "", color: "#888" }, "sm")}<div><b>${esc(S.user(c.author)?.name || "")}</b> <span class="muted">${relTime(c.createdAt)}</span><div>${esc(c.text)}</div></div></div>`).join("") || '<p class="muted">كن أول من يعلّق على هذه الفقرة</p>'}
        <div class="u-g6 u-mt8 row"><input id="pc-in" placeholder="تعليقك على هذه الفقرة" aria-label="تعليق"><button class="btn" id="pc-go">إرسال</button></div>`);
      $("#pc-go").onclick = async () => { const text = $("#pc-in").value.trim(); if (!text) return; try { const r = await api("POST", "/api/comments", { post: p.id, text, anchor, id: rid("c") }); closeSheet(); if (r?.comment?.status === "pending") { toast(r.comment.review || "تعليقك بانتظار موافقة المشرفين"); return; } toast("✓ أُضيف تعليقك"); b.textContent = (+b.textContent || 0) + 1; b.classList.remove("empty"); } catch (er) { toast(er.message); } };
    });
  };

  /* =================== Stories =================== */
  let storiesCache = null, storiesAt = 0;
  document.addEventListener("mp:post-created", (e) => { if (e.detail?.type === "story") storiesCache = null; });
  async function loadStories(force) { if (!online()) return []; if (!force && storiesCache && Date.now() - storiesAt < 30e3) return storiesCache; storiesCache = (await api("GET", "/api/stories")).stories; storiesAt = Date.now(); return storiesCache; }
  async function storiesBar() {
    if (!online() || location.hash.split("/")[1] !== "home") return;
    const groups = await loadStories().catch(() => []);
    const anchor = view.querySelector("#cbar"); if (!anchor) return;
    const me = S.me(), mine = groups.find(g => g.user.id === DB.me);
    const ring = (u, seen) => `<span class="st-ring ${seen ? "seen" : ""}"><span class="av" style="background:${u.color}">${u.avatar ? `<img src="${esc(u.avatar["200"] || u.avatar["64"])}" alt="">` : esc(u.name[0])}</span></span>`;
    const others = groups.filter(g => g.user.id !== DB.me);
    // v2.139: with no stories from others (and none of mine) the bar is one compact row instead of a lone big tile
    const solo = !mine && !others.length;
    const html = solo ? `<div class="stories-bar st-solo" data-keep="stories" data-keep-before="#cbar" role="group" aria-label="القصص"><button class="st-add-row" id="st-new"><span class="st-ring add"><span class="av" style="background:${me.color}">${me.avatar ? `<img src="${esc(me.avatar["200"] || me.avatar["64"])}" alt="">` : esc(me.name[0])}</span><i>${ic("plus", "xs")}</i></span><span class="st-add-t"><b>أضف قصة</b><small>شارك لحظة تختفي بعد 24 ساعة</small></span><span class="st-add-go" aria-hidden="true">${ic("back", "xs")}</span></button></div>` : `<div class="stories-bar" data-keep="stories" data-keep-before="#cbar" role="group" aria-label="القصص"><button class="st-item" id="st-new">${mine ? ring(me, true) : `<span class="st-ring add"><span class="av" style="background:${me.color}">${me.avatar ? `<img src="${esc(me.avatar["200"])}" alt="">` : esc(me.name[0])}</span><i>${ic("plus", "xs")}</i></span>`}<span>${mine ? "قصتك" : "أضف قصة"}</span></button>${others.map(g => `<button class="st-item" data-st="${g.user.id}">${ring(g.user, g.allSeen)}<span>${esc(g.user.name.split(" ")[0])}</span></button>`).join("")}</div>`;
    const cur = view.querySelector(".stories-bar"); // v2.29: update in place (no remove + re-insert → no jump)
    if (cur && cur.outerHTML !== html) cur.outerHTML = html; else if (!cur) anchor.insertAdjacentHTML("beforebegin", html);
    document.querySelectorAll(".stories-bar").forEach((x, i) => { if (i) x.remove(); });
    $("#st-new").onclick = () => mine ? storyViewer(groups, groups.indexOf(mine)) : openComposer({ type: "story" });
    document.querySelectorAll("[data-st]").forEach(b => b.onclick = () => storyViewer(groups, groups.findIndex(g => g.user.id === b.dataset.st)));
  }
  function storyViewer(groups, gi, ii) {
    let g = groups[gi]; if (!g) return; ii ??= Math.max(0, g.items.findIndex(x => !x.seen)); if (ii < 0) ii = 0;
    document.getElementById("story-viewer")?.remove();
    const el = document.createElement("div"); el.id = "story-viewer"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "عارض القصص"); document.body.appendChild(el);
    let timer = 0, startAt = 0, paused = false, elapsed = 0; const DUR = 5000;
    const close = () => { clearInterval(timer); el.remove(); storiesCache = null; storiesBar(); };
    const show = () => {
      const s = g.items[ii]; clearInterval(timer); elapsed = 0;
      const bg = s.media && s.media.startsWith("linear") ? s.media : "#111", img = rawUrl(s.media) || (s.media?.startsWith("/media/") ? s.media : null);
      el.innerHTML = `<div class="sv-frame" style="background:${bg}">${img ? `<img src="${esc(img)}" alt="">` : ""}${s.video?.variants ? `<video src="${esc(s.video.variants["720p"] || s.video.variants["360p"] || s.video.variants.original)}" autoplay playsinline></video>` : ""}${s.text ? `<div class="sv-text">${esc(s.text)}</div>` : ""}
        <div class="sv-bars">${g.items.map((_, k) => `<i><b style="width:${k < ii ? 100 : 0}%"></b></i>`).join("")}</div>
        <div class="sv-head">${av(g.user, "sm")}<b>${esc(g.user.name)}</b><span class="muted">${relTime(s.createdAt)}</span><span class="grow"></span><button class="sv-x" aria-label="إغلاق">${ic("x")}</button></div>
        <button class="sv-nav prev" aria-label="السابق"></button><button class="sv-nav next" aria-label="التالي"></button>
        ${g.user.id === DB.me ? `<button class="sv-viewers">${ic("eye", "xs")} المشاهدات</button>` : ""}</div>`;
      el.querySelector(".sv-x").onclick = close;
      el.querySelector(".sv-nav.next").onclick = next; el.querySelector(".sv-nav.prev").onclick = prevS;
      el.querySelector(".sv-viewers")?.addEventListener("click", async (e) => { e.stopPropagation(); paused = true; const { viewers } = await api("GET", `/api/stories/${s.id}/viewers`); sheet(`<h4 class="u-mt0">${ic("eye", "sm")} شاهدها ${viewers.length}</h4>${viewers.map(v => `<div class="u-g8 u-py6 row">${av(v, "sm")}<b class="grow">${esc(v.name)}</b><span class="muted">${relTime(v.at)}</span></div>`).join("") || '<p class="muted">لا مشاهدات بعد</p>'}`); });
      const frame = el.querySelector(".sv-frame"); frame.addEventListener("pointerdown", () => paused = true); frame.addEventListener("pointerup", () => paused = false);
      if (!s.seen && g.user.id !== DB.me) { api("POST", `/api/stories/${s.id}/view`).catch(() => { }); s.seen = true; }
      const barEl = el.querySelectorAll(".sv-bars b")[ii]; startAt = Date.now();
      timer = setInterval(() => { if (paused) { startAt = Date.now() - elapsed; return; } elapsed = Date.now() - startAt; barEl.style.width = Math.min(100, elapsed / DUR * 100) + "%"; if (elapsed >= DUR) next(); }, 50);
    };
    const next = () => { if (ii < g.items.length - 1) { ii++; show(); } else if (gi < groups.length - 1) { gi++; g = groups[gi]; ii = 0; show(); } else close(); };
    const prevS = () => { if (ii > 0) { ii--; show(); } else if (gi > 0) { gi--; g = groups[gi]; ii = 0; show(); } };
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") next(); if (e.key === "ArrowRight") prevS(); }); el.tabIndex = -1; el.focus();
    show();
  }

  /* «لقطات» (Clips): the full-screen view (feed paging, windowed players, watch beacons, double-tap like) lives in the lazy
   * "clips" chunk (clips-ui.js + clips.css, v2.71). Core keeps the route below, the shorts-mode cleanup and MPPlayer. */

  /* =================== Live audio rooms =================== */

  /* realtime events (live-room "room"/"rtc" events are handled by the lazy creation chunk) */
  if (typeof connectStream === "function") {
    const _cs = connectStream;
    connectStream = function () {
      _cs();
      try {
        Remote.es?.addEventListener("room_live", (e) => { const r = JSON.parse(e.data); const u = S.user(r.host); toast(`${u?.name || "شخص تتابعه"} بدأ غرفة: ${r.title}`); });
        Remote.es?.addEventListener("draft", (e) => { const d = JSON.parse(e.data); if (d.device !== device) document.querySelector("#composer3 .c3-saved")?.replaceChildren(document.createTextNode("عُدّلت مسودة على جهاز آخر")); });
      } catch { }
    };
  }


  /* =================== wiring =================== */
  HomeHooks.section("stories", 30, function () { document.body.classList.remove("shorts-mode"); storiesBar(); });
  // v2.71: the view comes from the lazy "clips" chunk (window.Clips.view); chunks.js normally loads it before route() runs,
  // this fallback covers a direct call (app.js keeps the original route) — load, then re-render if still on the page
  const shortsView = () => { if (window.Clips?.view) return Clips.view(); view.innerHTML = `<div class="wrap" aria-busy="true" aria-label="جارٍ التحميل…"><div class="skel"></div><div class="skel"></div></div>`; /* v2.81: one shared re-route with chunks.js (it used to load + Clips.view() here AND re-route there: the first clip opened twice) */ (window.MPChunks?.reroute ? MPChunks.reroute("clips") : (window.MPChunks ? MPChunks.load("clips") : Promise.resolve()).then(() => { if (window.Clips?.view && /^#\/(shorts|clips)(\?|\/|$)/.test(location.hash)) Clips.view(); })).catch(() => toast("تعذّر التحميل")); };
  MPRoutes.extend((a, b) => ({ shorts: () => shortsView(), clips: () => shortsView() })); // v2.70: #/clips alias of «لقطات»
  const _route = route;
  route = function () {
    const r = (location.hash.split("/")[1] || "").split("?")[0];
    if (r !== "shorts" && r !== "clips") document.body.classList.remove("shorts-mode");
    return _route.apply(this, arguments);
  };
  addEventListener("hashchange", () => { const r = (location.hash.split("/")[1] || "").split("?")[0]; if (r !== "shorts" && r !== "clips") document.body.classList.remove("shorts-mode"); }, true); // v2.70: app.js calls the original route directly, so leave shorts-mode on every hash change
  /* entry points: explore shortcuts and post menu */
  MPSettings.add(function () { view.querySelector('a[href="#/privacy"]')?.insertAdjacentHTML("beforebegin", `<a href="#/studio" class="u-dflex card row">${ic("chart")}<div class="grow"><b>استوديو المنشئ</b><div class="muted">التحليلات، التقويم، أفضل وقت، القوالب</div></div><span class="muted">←</span></a><a href="#/cv" class="u-dflex card row">${ic("building")}<div class="grow"><b>الملف المهني</b></div></a><a href="#/jobs" class="u-dflex card row">${ic("bag")}<div class="grow"><b>الوظائف والعمل الحر</b></div></a><a href="#/contracts" class="u-dflex card row">${ic("shield")}<div class="grow"><b>العقود</b></div></a><a href="#/teams" class="u-dflex card row">${ic("users")}<div class="grow"><b>الفرق والمشاريع</b></div></a><a href="#/reviews" class="u-dflex card row">${ic("star")}<div class="grow"><b>التقييمات المهنية</b></div></a><a href="#/mjt" class="u-dflex card row">${ic("wallet")}<div class="grow"><b>مجتمع كوين</b></div></a>`); });
  const _explore = Views.explore;
  Views.explore = function () { _explore.apply(this, arguments); const h = view.querySelector(".wrap"); if (h && online()) h.insertAdjacentHTML("afterbegin", `<div class="explore-shortcuts"><a href="#/shorts">${ic("play", "sm")} لقطات</a><a href="#/rooms">${ic("mic", "sm")} غرف صوتية</a><a href="#/studio">${ic("chart", "sm")} الاستوديو</a><a href="#/nearby">${ic("mapPin", "sm")} بالقرب منك</a><a href="#/study"><svg class=ei aria-hidden=true><use href=#i-book /></svg> حلقات ودراسة</a><a href="#/courses"><svg class=ei aria-hidden=true><use href=#i-cap /></svg> الدورات</a><a href="#/mentors">${ic("users", "sm")} الإرشاد</a><a href="#/creator-program">${ic("verified", "sm")} الصنّاع الموثّقون</a><a href="#/giving">${ic("heart", "sm")} التطوّع والخير</a><a href="#/knowledge">${ic("bookmark", "sm")} المكتبة المعرفية</a><a href="#/jobs">${ic("building", "sm")} العمل والفرص</a><a href="#/biz"><svg class=ei aria-hidden=true><use href=#i-store /></svg> أعمال تقبل Pi</a><a href="#/series?tab=following"><svg class=ei aria-hidden=true><use href=#i-clapper /></svg> السلاسل</a><a href="#/hijri"><svg class=ei aria-hidden=true><use href=#i-moon /></svg> التقويم الهجري</a><a href="#/collabs"><svg class=ei aria-hidden=true><use href=#i-brief /></svg> التعاونات</a><a href="#/exams"><svg class=ei aria-hidden=true><use href=#i-doc /></svg> الاختبارات</a><a href="#/certificates"><svg class=ei aria-hidden=true><use href=#i-medal /></svg> شهاداتي</a></div>`); };
  document.addEventListener("click", (e) => { const m = e.target.closest("[data-more]"); if (!m || !online()) return; setTimeout(() => { const p = S.post(m.dataset.more); const menu = document.querySelector("#sheet .menu"); if (!p || !menu || menu.querySelector("[data-stats],[data-ptn]")) return; if (p.author !== DB.me) { if (!p.partner) menu.insertAdjacentHTML("beforeend", `<button data-ptn="#/collabs/report/${p.id}"><svg class=ei aria-hidden=true><use href=#i-brief /></svg> إعلان غير مُفصح عنه؟</button>`); } else menu.insertAdjacentHTML("afterbegin", `<button data-stats="${p.id}">${ic("chart", "xs")} الإحصائيات</button><button data-ptn="#/collabs/disclose/${p.id}"><svg class=ei aria-hidden=true><use href=#i-brief /></svg> ${p.partner ? "الإفصاح عن الشراكة" : "إفصاح: محتوى مدفوع أو هدية"}</button>`); menu.querySelector("[data-stats]")?.addEventListener("click", () => { closeSheet(); (window.MPChunks ? MPChunks.load("creation") : Promise.resolve()).then(() => window.MPStudio?.postStatsSheet(p.id)).catch(() => toast("تعذّر التحميل")); }); menu.querySelector("[data-ptn]").addEventListener("click", (ev) => { closeSheet(); location.hash = ev.currentTarget.dataset.ptn; }); }, 30); }); // phase 63: disclosure + undisclosed-ad report
})();
