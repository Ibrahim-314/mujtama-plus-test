/* مجتمع بلس — the shared video player (video/player/player.js, core bundle; moved out of content-ui.js in v2.73).
 * window.MPPlayer { mount(box, post, opts) → <video>, destroy(box), hlsJs(), use(plugin) }. HLS (native or hls.js lazy
 * chunk) → MP4 720p → 360p → original, captions, gestures, QoE (lazy "qoe" chunk). Source order lives in sources.js;
 * features that ride on every player (resume watching, …) are plugins registered with MPPlayer.use(). */
(function PlayerLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const fmtDur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, "0")}`;
  /* ---------- custom video player: HLS (native) or MP4 fallback, captions, gestures ---------- */
  const plugins = [];
  const runPlugins = (ctx) => { for (const f of plugins) { try { f(ctx); } catch (e) { console.error("MPPlayer plugin", e); } } };
  const MPPlayer = {
    /** v2.73 extension point: fn({video, box, post, opts, flash}) runs on every mount, after the controls exist and
     *  before autoplay. A plugin that throws is logged and skipped. Returns an unsubscribe fn. */
    use(fn) { if (typeof fn !== "function") return () => { }; plugins.push(fn); return () => { const i = plugins.indexOf(fn); if (i >= 0) plugins.splice(i, 1); }; },
    /* v2.70 adaptive streaming: where the browser has no native HLS (Chrome/Firefox/Android) but has MediaSource, the HLS
     * master plays through hls.js — a lazy «hls» chunk (vendor/hls.light.min.js), never in the core bundle — with automatic
     * quality (startLevel -1, capped to the player size, ~10 s buffer for clips). Native HLS (Safari/iOS) keeps video.src.
     * A fatal hls.js error, or the chunk failing to load, falls back to the MP4 chain (720p → 360p → original). */
    /** v2.75: remembered bandwidth (bits/s). bw() reads (saved → navigator.connection → 2.5 Mb/s), bw(n) saves (throttled). */
    bw(n) {
      const K = "mp.bw";
      if (n > 0) { const t = Date.now(); if (t - (MPPlayer._bwAt || 0) > 4000) { MPPlayer._bwAt = t; try { localStorage.setItem(K, String(Math.round(n))); } catch { } } MPPlayer._bw = n; return n; }
      if (MPPlayer._bw > 0) return MPPlayer._bw;
      let v = 0; try { v = +localStorage.getItem(K) || 0; } catch { }
      if (!(v > 0)) { const c = navigator.connection; v = c && c.downlink > 0 && !c.saveData ? c.downlink * 1e6 * 0.85 : 2.5e6; }
      return Math.min(Math.max(v, 3e5), 5e7);
    },
    hlsJs() { return window.Hls ? Promise.resolve(window.Hls) : (window.MPChunks ? MPChunks.load("hls") : Promise.reject(new Error("no chunks"))).then(() => { if (!window.Hls) throw new Error("hls.js missing"); return window.Hls; }); },
    /** free a player: pause, detach hls.js, drop the source (removeAttribute + load) so the decoder and buffers are released.
     *  The clips UI calls it to keep at most 3 live players; a destroyed box can be mounted again (tap or MPPlayer.mount). */
    destroy(el) {
      if (!el) return; el._mpGen = (el._mpGen || 0) + 1; // a pending hls.js load for the old mount is ignored
      const vid = el.querySelector("video");
      if (vid) { try { vid.pause(); } catch { } }
      if (el._mpHls) { try { el._mpHls.destroy(); } catch { } el._mpHls = null; }
      if (vid) { vid.removeAttribute("src"); try { vid.load(); } catch { } }
      el.classList.remove("mounted");
    },
    mount(el, p, { autoplay = false, loop = false, muted = false, preload = "metadata", source = "post" } = {}) {
      /* v2.60 M1: an ordered list of sources (HLS master where the browser plays it natively → MP4 720p → MP4 360p → the
       * original upload); a source that fails moves to the next one, and when none plays a visible error with «إعادة المحاولة»
       * replaces the silent black box. Poster, playsinline and the stored aspect ratio are kept. */
      const v = p.video.variants, { srcs, useHlsJs } = MPVideoSources.pick(v); // ordered sources + whether hls.js drives the master
      const pre = ["auto", "metadata", "none"].includes(preload) ? preload : "metadata";
      if (el._mpHls) MPPlayer.destroy(el); // re-mount of a live box: free the old hls.js instance first
      el.innerHTML = `<video playsinline webkit-playsinline preload="${pre}" ${loop ? "loop" : ""} ${muted ? "muted" : ""} ${MPVideoSources.poster(v) ? `poster="${esc(MPVideoSources.poster(v))}"` : ""} ${useHlsJs ? "" : `src="${esc(srcs[0] || "")}"`} crossorigin="anonymous">${(v.captions || []).map((c, i) => `<track kind="subtitles" srclang="${esc(c.lang)}" label="${esc(c.label)}" src="${esc(c.url)}" ${i === 0 ? "default" : ""}>`).join("")}</video>
        <div class="mp-ui"><div class="mp-seek" role="slider" aria-label="التقدم" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00"><i></i></div><div class="mp-bar"><button data-a="play" aria-label="تشغيل/إيقاف">${ic("play", "sm")}</button><span class="mp-time">0:00${p.video.duration > 0 ? " / " + fmtDur(p.video.duration) : ""}</span><span class="grow"></span>${v.captions?.length ? `<button data-a="cc" aria-label="الترجمة" class="on">CC</button>` : ""}<button data-a="speed" aria-label="السرعة">1×</button><button data-a="mute" aria-label="الصوت">${ic(muted ? "volumeX" : "volume", "sm")}</button><button data-a="fs" aria-label="ملء الشاشة">${ic("expand", "sm")}</button></div></div><div class="mp-toast"></div>
        <div class="mp-err" role="alert" hidden>${ic("alert", "lg")}<b>تعذّر تشغيل الفيديو</b><span>تحقّق من اتصالك ثم أعد المحاولة.</span><button type="button" class="btn" data-a="reload">${ic("refresh", "xs")} إعادة المحاولة</button></div>`;
      {
        const vid0 = el.querySelector("video"), errBox = el.querySelector(".mp-err"); let si0 = 0;
        const fail = () => { errBox.hidden = false; el.classList.add("errored"); };
        const gen = el._mpGen = (el._mpGen || 0) + 1;
        const playMp4 = (i, play) => { // MP4 chain step i (also the way out of hls.js)
          if (el._mpHls) { try { el._mpHls.destroy(); } catch { } el._mpHls = null; }
          si0 = i; if (si0 >= srcs.length || !srcs[si0]) return fail();
          vid0.src = srcs[si0]; vid0.load(); if (play) vid0.play().catch(() => { });
        };
        const startHls = (play) => {
          MPPlayer.hlsJs().then((Hls) => {
            if (el._mpGen !== gen) return; // destroyed or re-mounted meanwhile
            if (!Hls.isSupported || !Hls.isSupported()) return playMp4(0, play);
            /* v2.75 Vidtik: sharp from the first frame — the last measured bandwidth (kept across visits) seeds hls.js's
             * estimate, so startLevel -1 opens straight on the quality this connection carries instead of ramping up. */
            const bw0 = MPPlayer.bw();
            const hls = new Hls({ startLevel: -1, abrEwmaDefaultEstimate: bw0, testBandwidth: true, capLevelToPlayerSize: true, enableWorker: false /* CSP: no blob: workers */, maxBufferLength: 10, maxMaxBufferLength: 20, backBufferLength: 10, autoStartLoad: pre !== "none" });
            el._mpHls = hls;
            hls.on(Hls.Events.FRAG_LOADED, () => { const b = hls.bandwidthEstimate; if (b > 0 && isFinite(b)) MPPlayer.bw(b); });
            hls.on(Hls.Events.ERROR, (_e, d) => { if (d && d.fatal && el._mpHls === hls) playMp4(0, !vid0.paused || play); });
            hls.attachMedia(vid0); hls.loadSource(v.master);
            if (pre === "none") vid0.addEventListener("play", () => { if (el._mpHls === hls) hls.startLoad(-1); }, { once: true });
            if (play) vid0.play().catch(() => { vid0.muted = true; vid0.play().catch(() => { }); });
          }, () => { if (el._mpGen === gen) playMp4(0, play); });
        };
        vid0.addEventListener("error", () => {
          if (!vid0.getAttribute("src") || el._mpHls) return; // hls.js reports its own errors (fatal → MP4 chain)
          if (si0 + 1 < srcs.length) playMp4(si0 + 1, !vid0.paused || autoplay); else fail();
        });
        vid0.addEventListener("loadedmetadata", () => { // unknown aspect (older videos): use the real one so vertical videos are not tiny
          if (!el.style.getPropertyValue("--ar") && vid0.videoWidth && vid0.videoHeight) { const ar = Math.max(0.5, Math.min(2.4, vid0.videoWidth / vid0.videoHeight)); el.style.setProperty("--ar", ar.toFixed(4)); el.classList.add(ar < 0.95 ? "portrait" : "sized"); }
        });
        errBox.querySelector("[data-a=reload]").addEventListener("click", (e) => { e.stopPropagation(); errBox.hidden = true; el.classList.remove("errored"); if (useHlsJs) { if (el._mpHls) { try { el._mpHls.destroy(); } catch { } el._mpHls = null; } startHls(true); } else playMp4(0, true); });
        el._mpSources = useHlsJs ? [v.master, ...srcs] : srcs;
        if (useHlsJs) startHls(false); // autoplay is started below, once the controls are wired
      }
      el.classList.add("mounted");
      const vid = el.querySelector("video"), seek = el.querySelector(".mp-seek i"), time = el.querySelector(".mp-time"), toastEl = el.querySelector(".mp-toast");
      const flash = (t) => { toastEl.textContent = t; toastEl.classList.add("on"); clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove("on"), 600); };
      runPlugins({ video: vid, box: el, post: p, opts: { autoplay, loop, muted, preload, source }, flash }); // v2.73 plugins (resume watching, …)
      const setPlayIcon = () => el.querySelector('[data-a="play"]').innerHTML = ic(vid.paused ? "play" : "pause", "sm");
      vid.addEventListener("play", setPlayIcon); vid.addEventListener("pause", setPlayIcon);
      vid.addEventListener("timeupdate", () => { const d = isFinite(vid.duration) && vid.duration > 0 ? vid.duration : p.video.duration; seek.style.width = (vid.currentTime / (d || 1) * 100) + "%"; const sk = seek.parentNode; sk.setAttribute("aria-valuenow", String(d > 0 ? Math.min(100, Math.round(vid.currentTime / d * 100)) : 0)); sk.setAttribute("aria-valuetext", d > 0 ? `${fmtDur(vid.currentTime)} ${document.documentElement.lang.startsWith("en") ? "of" : "من"} ${fmtDur(d)}` : fmtDur(vid.currentTime)); time.textContent = d > 0 ? `${fmtDur(vid.currentTime)} / ${fmtDur(d)}` : fmtDur(vid.currentTime); });
      const speeds = [1, 1.25, 1.5, 2, 0.75]; let si = 0;
      el.querySelector(".mp-bar").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return; e.stopPropagation();
        if (b.dataset.a === "play") vid.paused ? vid.play() : vid.pause();
        if (b.dataset.a === "mute") { vid.muted = !vid.muted; b.innerHTML = ic(vid.muted ? "volumeX" : "volume", "sm"); }
        if (b.dataset.a === "speed") { si = (si + 1) % speeds.length; vid.playbackRate = speeds[si]; b.textContent = speeds[si] + "×"; }
        if (b.dataset.a === "cc") { const t = vid.textTracks[0]; if (t) { t.mode = t.mode === "showing" ? "hidden" : "showing"; b.classList.toggle("on", t.mode === "showing"); } }
        if (b.dataset.a === "fs") (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.())?.catch?.(() => { });
      });
      el.querySelector(".mp-seek").addEventListener("pointerdown", (e) => { const r = e.currentTarget.getBoundingClientRect(); const x = (r.right - e.clientX) / r.width; vid.currentTime = Math.max(0, Math.min(1, getComputedStyle(el).direction === "rtl" ? x : 1 - x)) * (vid.duration || 0); });
      // gestures: tap = play/pause · double-tap sides = ±10s · long-press = 2× while held
      let lastTap = 0, holdT = 0, held = false;
      vid.addEventListener("pointerdown", () => { held = false; holdT = setTimeout(() => { held = true; vid.playbackRate = 2; flash("2×"); }, 450); });
      vid.addEventListener("pointerup", (e) => {
        clearTimeout(holdT); if (held) { vid.playbackRate = speeds[si]; return; }
        const t = Date.now(), r = vid.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
        if (t - lastTap < 280) { clearTimeout(vid._single); const d = x < 0.5 ? 10 : -10; vid.currentTime = Math.max(0, vid.currentTime + d); flash(d > 0 ? "⟸ ١٠ث" : "١٠ث ⟹"); lastTap = 0; return; }
        lastTap = t; vid._single = setTimeout(() => { vid.paused ? vid.play() : vid.pause(); }, 280);
      });
      el.addEventListener("keydown", (e) => { if (e.key === " ") { e.preventDefault(); vid.paused ? vid.play() : vid.pause(); } if (e.key === "ArrowLeft") vid.currentTime += 5; if (e.key === "ArrowRight") vid.currentTime -= 5; });
      el.tabIndex = 0;
      // v2.70 QoE: the play request + first 'playing' are stamped here synchronously; the qoe chunk loads on mount and may attach late
      const qs = {}, now = () => performance.now();
      vid.addEventListener("play", () => { qs.requestedAt ??= now(); }); vid.addEventListener("playing", () => { qs.playingAt ??= now(); });
      window.MPChunks?.load("qoe").then(() => { if (vid.isConnected) window.MPQoE?.track(vid, p.id, source || "post", qs); }).catch(() => { });
      if (autoplay) vid.play().catch(() => { vid.muted = true; vid.play().catch(() => { }); });
      return vid;
    }
  };
  window.MPPlayer = MPPlayer;
  document.addEventListener("click", (e) => {
    const box = e.target.closest(".mp-video:not(.mounted)"); if (!box) return;
    e.preventDefault(); e.stopPropagation(); const p = S.post(box.dataset.video); if (p) MPPlayer.mount(box, p, { autoplay: true });
  }, true);
})();
