/* مجتمع بلس — «لقطات» feature: progress scrubber, tap / long-press gestures (video/clips/scrub.js).
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips
 * (hooks / api / util / ext, documented in video/clips/core.js); block marker kept: v271-scrub. */
(function ClipsScrub() {
  const { ic, fmtDur } = Clips.util;
  /* === v271-scrub === */
  /* v2.71 scrubber + tap / long-press for «لقطات» (clips view only; MPPlayer itself is untouched).
   * - A thin progress bar at the bottom of every clip (2 px, 6 px while hovered/focused/dragged): role=slider with
   *   aria-valuenow (seconds) + aria-valuetext "0:12 من 0:30"; pointer drag (seek on release, preview while dragging) and
   *   keyboard (←/→ ±5 s, PageUp/PageDown ±10 s, Home/End). It replaces MPPlayer's own .mp-seek in clips mode (hidden in
   *   clips.css); the rest of MPPlayer's bar (CC, speed, mute, full screen) stays.
   * - Direction: the timeline runs left → right in Arabic and English alike (dir=ltr on the bar), like every video player;
   *   ArrowRight is always "forward".
   * - Preview: when p.video.variants carries a storyboard (WebVTT with sprite#xywh= cues, or a sprite description object)
   *   the frame under the finger is shown above the time; otherwise only the time.
   * - Single tap on the clip = pause/play with a brief centred icon. It waits ~280 ms so the core double-tap like still
   *   wins (a second tap cancels it). Long-press ≥350 ms = 2× with a «2x» pill; release restores the previous speed (1×
   *   unless the viewer picked another speed in MPPlayer's bar). A move >10 px or a pointercancel (scroll/swipe) cancels
   *   both. MPPlayer's own video gestures (tap, ±10 s double-tap, 450 ms hold) are switched off in clips mode by
   *   pointer-events:none on the <video> (clips.css), so nothing fires twice.
   * - Watch time: seeks are already ignored by the core played-time counter (forward steps <1.5 s only); 2× counts media time. */
  (function ClipsScrub() {
    const TAP_WAIT = 280, HOLD_MS = 350, MOVE_TOL = 10;
    const isEn = () => (document.documentElement.lang || "").startsWith("en");
    const vidOf = (sec) => sec.querySelector(".short-player video");
    const durOf = (sec, v) => (v && isFinite(v.duration) && v.duration > 0 ? v.duration : +(S.post(sec.dataset.short)?.video?.duration) || 0);
    const clampN = (x, a, b) => Math.max(a, Math.min(b, x));
    const IGNORE = "button,a,input,textarea,select,.mp-bar,.mp-seek,.mp-err,.cl-scrub,.short-actions,.short-info a";

    /* ----- storyboard (thumbnail sprites) ----- */
    const sbCache = new Map(); // key → Promise<cue[] | null>
    const vttTime = (s) => { const m = /(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/.exec(s || ""); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN; };
    function parseVtt(text, base) {
      const cues = [];
      for (const block of String(text).replace(/\r/g, "").split(/\n\n+/)) {
        const lines = block.split("\n"), i = lines.findIndex(l => l.includes("-->")); if (i < 0 || !lines[i + 1]) continue;
        const [a, b] = lines[i].split("-->"), ref = lines[i + 1].trim(), m = /^(.*?)#xywh=(\d+),(\d+),(\d+),(\d+)/.exec(ref);
        let url; try { url = new URL(m ? m[1] : ref, base).href; } catch { continue; }
        cues.push({ s: vttTime(a), e: vttTime(b), url, x: m ? +m[2] : 0, y: m ? +m[3] : 0, w: m ? +m[4] : 0, h: m ? +m[5] : 0 });
      }
      return cues.filter(c => isFinite(c.s) && isFinite(c.e));
    }
    /** accepted shapes: variants.storyboard = "…/sb.vtt" | { vtt | url } | { sprite, interval, cols, rows?, w, h } (also variants.thumbnails) */
    function storyboard(p) {
      const sb = p?.video?.variants?.storyboard || p?.video?.variants?.thumbnails; if (!sb) return Promise.resolve(null);
      const vtt = typeof sb === "string" ? sb : (sb.vtt || (typeof sb.url === "string" && /\.vtt(\?|$)/.test(sb.url) ? sb.url : null));
      const key = vtt || JSON.stringify(sb);
      if (!sbCache.has(key)) {
        if (vtt) sbCache.set(key, fetch(vtt, { credentials: "same-origin" }).then(r => (r.ok ? r.text() : "")).then(t => { const c = parseVtt(t, new URL(vtt, location.href).href); return c.length ? c : null; }).catch(() => null));
        else if (typeof sb === "object" && sb.sprite && +sb.interval > 0 && +sb.cols > 0 && +sb.w > 0 && +sb.h > 0) {
          const n = +sb.count || (+sb.rows > 0 ? +sb.cols * +sb.rows : 0), cues = [];
          for (let i = 0; i < (n || 400); i++) cues.push({ s: i * sb.interval, e: (i + 1) * sb.interval, url: new URL(sb.sprite, location.href).href, x: (i % sb.cols) * sb.w, y: Math.floor(i / sb.cols) * sb.h, w: +sb.w, h: +sb.h });
          sbCache.set(key, Promise.resolve(cues));
        } else sbCache.set(key, Promise.resolve(null));
      }
      return sbCache.get(key);
    }

    /* ----- per-clip UI ----- */
    Clips.onSection((sec, p) => {
      if (!sec || sec._clScrub) return; sec._clScrub = true; sec.classList.add("cl-scrub-on");
      sec.insertAdjacentHTML("beforeend", `<div class="cl-scrub" dir="ltr"><div class="cl-scrub-tip" aria-hidden="true" hidden><span class="cl-scrub-thumb" hidden></span><span class="cl-scrub-time">0:00</span></div><div class="cl-scrub-bar" role="slider" tabindex="0" aria-orientation="horizontal" aria-label="${isEn() ? "Progress" : "التقدم"}" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00"><span class="cl-scrub-track"><i class="cl-scrub-fill"></i><b class="cl-scrub-knob"></b></span></div></div><span class="cl-scrub-icon" aria-hidden="true"></span><span class="cl-scrub-pill" aria-hidden="true" hidden>2x</span>`);
      const wrap = sec.querySelector(".cl-scrub"), bar = wrap.querySelector(".cl-scrub-bar"), tip = wrap.querySelector(".cl-scrub-tip"), tipTime = tip.querySelector(".cl-scrub-time"), thumb = tip.querySelector(".cl-scrub-thumb");
      const icon = sec.querySelector(".cl-scrub-icon"), pill = sec.querySelector(".cl-scrub-pill");
      let dragging = false, dragFrac = 0;
      const paint = (t, d) => {
        const f = d > 0 ? clampN(t / d, 0, 1) : 0; wrap.style.setProperty("--cl-p", f.toFixed(4));
        bar.setAttribute("aria-valuemax", String(Math.round(d))); bar.setAttribute("aria-valuenow", String(Math.round(clampN(t, 0, d || t))));
        bar.setAttribute("aria-valuetext", d > 0 ? `${fmtDur(t)} ${isEn() ? "of" : "من"} ${fmtDur(d)}` : fmtDur(t));
      };
      const sync = () => { if (dragging) return; const v = vidOf(sec); paint(v ? v.currentTime : 0, durOf(sec, v)); };
      ["timeupdate", "loadedmetadata", "durationchange", "seeked", "emptied"].forEach(ev => sec.addEventListener(ev, (e) => { if (e.target.tagName === "VIDEO") sync(); }, true)); // media events don't bubble: capture on the section
      sync();

      /* drag + preview */
      const fracAt = (x) => { const r = bar.getBoundingClientRect(); return r.width > 0 ? clampN((x - r.left) / r.width, 0, 1) : 0; }; // LTR timeline
      const preview = (f) => {
        const d = durOf(sec, vidOf(sec)), t = f * d; dragFrac = f; paint(t, d); tipTime.textContent = fmtDur(t);
        storyboard(p).then(cues => {
          if (!dragging || dragFrac !== f) return; const c = cues && (cues.find(k => t >= k.s && t < k.e) || cues[cues.length - 1]);
          if (!c || !c.w) { thumb.hidden = true; return; }
          const sc = Math.min(1, 128 / c.w); thumb.hidden = false;
          thumb.style.setProperty("--cl-w", (c.w * sc) + "px"); thumb.style.setProperty("--cl-h", (c.h * sc) + "px");
          thumb.style.backgroundImage = `url("${c.url.replace(/"/g, "%22")}")`; thumb.style.backgroundPosition = `${-c.x * sc}px ${-c.y * sc}px`;
          if (sc === 1) thumb.style.backgroundSize = "auto";
          else { const img = new Image(); img.onload = () => { if (img.naturalWidth) thumb.style.backgroundSize = `${img.naturalWidth * sc}px ${img.naturalHeight * sc}px`; }; img.src = c.url; } // sprite scaled to the 128 px preview
        });
      };
      const endDrag = (commit) => {
        if (!dragging) return; dragging = false; wrap.classList.remove("cl-scrub-drag"); tip.hidden = true;
        const v = vidOf(sec), d = durOf(sec, v);
        if (commit && v && d > 0) { try { v.currentTime = clampN(dragFrac * d, 0, Math.max(0, d - 0.05)); } catch { /* not seekable yet */ } }
        sync();
      };
      bar.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return; e.stopPropagation(); e.preventDefault(); bar.focus({ preventScroll: true });
        dragging = true; wrap.classList.add("cl-scrub-drag"); tip.hidden = false; try { bar.setPointerCapture(e.pointerId); } catch { /* old browser */ }
        preview(fracAt(e.clientX));
      });
      bar.addEventListener("pointermove", (e) => { if (dragging) preview(fracAt(e.clientX)); });
      bar.addEventListener("pointerup", (e) => { e.stopPropagation(); endDrag(true); }); // never counts toward the double-tap like
      bar.addEventListener("pointercancel", () => endDrag(false));
      bar.addEventListener("lostpointercapture", () => endDrag(true));
      bar.addEventListener("click", (e) => e.stopPropagation());
      bar.addEventListener("keydown", (e) => {
        const v = vidOf(sec), d = durOf(sec, v); if (!v || !(d > 0)) return;
        const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 10, PageDown: -10 }[e.key];
        let t = null; if (step) t = v.currentTime + step; else if (e.key === "Home") t = 0; else if (e.key === "End") t = d - 0.05;
        if (t === null) return; e.preventDefault(); e.stopPropagation(); // keeps MPPlayer's ±5 s box handler from running too
        try { v.currentTime = clampN(t, 0, Math.max(0, d - 0.05)); } catch { /* not seekable yet */ } paint(clampN(t, 0, d), d);
      });

      /* tap = clean screen on/off (v2.73; pause/play falls back here only if clean.js is missing) · long-press = 2× */
      let downAt = null, holdT = 0, held = false, prevRate = 1, singleT = 0, lastUp = 0;
      const flashIcon = (name) => { icon.innerHTML = ic(name, "lg"); icon.classList.remove("on"); icon.getBoundingClientRect(); icon.classList.add("on"); clearTimeout(icon._t); icon._t = setTimeout(() => icon.classList.remove("on"), 650); };
      const release = () => { clearTimeout(holdT); if (!held) return; held = false; const v = vidOf(sec); if (v) v.playbackRate = prevRate; pill.hidden = true; };
      sec.addEventListener("pointerdown", (e) => {
        if (e.button > 0 || !e.isPrimary || e.target.closest(IGNORE)) { downAt = null; return; }
        downAt = { x: e.clientX, y: e.clientY, t: Date.now() }; held = false; clearTimeout(holdT);
        holdT = setTimeout(() => { const v = vidOf(sec); if (!downAt || !v || v.paused) return; held = true; prevRate = v.playbackRate || 1; v.playbackRate = 2; pill.hidden = false; }, HOLD_MS);
      });
      sec.addEventListener("pointermove", (e) => { if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > MOVE_TOL) { downAt = null; release(); } });
      sec.addEventListener("pointercancel", () => { downAt = null; release(); });
      sec.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && held) { downAt = null; release(); } });
      sec.addEventListener("pointerup", (e) => {
        if (held) { downAt = null; release(); e.stopPropagation(); return; } // a hold is not a tap: keep it out of the double-tap like too
        clearTimeout(holdT); if (!downAt) return; const t = Date.now(), long = t - downAt.t >= HOLD_MS; downAt = null;
        if (long) { lastUp = 0; return; } // a long press on a paused clip: neither 2× nor a tap
        if (t - lastUp < TAP_WAIT) { clearTimeout(singleT); lastUp = 0; return; } // second tap: the core double-tap like handles it
        lastUp = t; clearTimeout(singleT);
        singleT = setTimeout(() => { const v = vidOf(sec); if (!v || !sec.isConnected) return; if (window.Clips?.clean) { Clips.clean.toggle(); return; } /* v273-clean: tap = hide/show, pause is the .cl-pp button */ if (v.paused) { v.play().catch(() => { }); flashIcon("play"); } else { v.pause(); flashIcon("pause"); } }, TAP_WAIT);
      });
      sec.addEventListener("contextmenu", (e) => { if ((downAt || held) && !e.target.closest(IGNORE)) e.preventDefault(); }); // long-press on touch must not open the video menu
    });
  })();
  /* === end v271-scrub === */
})();
