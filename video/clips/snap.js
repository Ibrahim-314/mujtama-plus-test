/* مجتمع بلس — «لقطات» feature: smooth one-clip navigation (keyboard, wheel, desktop backdrop) (video/clips/snap.js).
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips
 * (hooks / api / util / ext, documented in video/clips/core.js); block marker kept: v271-snap. */
(function ClipsSnap() {
  /* === v271-snap === smooth one-clip navigation: keyboard (ArrowDown/ArrowUp/PageDown/PageUp/j/k), Space play/pause,
   * one clip per mouse-wheel gesture (debounced), desktop blurred-poster backdrop. Smooth scroll, instant under
   * prefers-reduced-motion. Listeners live only while the clips screen is open (attached on view, removed on leave). */
  (function ClipsSnap() {
    const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const TYPING = "input,textarea,select,[contenteditable=''],[contenteditable='true'],[role='slider'],[role='textbox'],[role='combobox']";
    const PRESSABLE = "button,a[href],summary,[role='button'],[role='menuitem'],[role='tab'],[role='checkbox'],[role='switch'],label";
    let feed = null, target = -1, targetAt = 0, wLock = false, wT = 0, wUntil = 0;
    const secs = () => (feed ? [...feed.querySelectorAll(".short")] : []);
    const modalOpen = () => !!document.querySelector("dialog[open],[aria-modal='true'],.sheet.open,.action-sheet.open");
    const index = () => { // the clip under the snap point; while a smooth move is running, the clip it is heading to
      if (target >= 0 && Date.now() - targetAt < 600) return target;
      const h = feed.clientHeight || 1; return Math.round(feed.scrollTop / h);
    };
    const go = (d) => {
      const all = secs(); if (!all.length) return false;
      const from = index(), i = Math.max(0, Math.min(all.length - 1, from + d)); if (i === from) return false; // first/last clip: stay
      const top = feed.scrollTop + all[i].getBoundingClientRect().top - feed.getBoundingClientRect().top;
      target = i; targetAt = Date.now();
      feed.scrollTo({ top, behavior: reduced() ? "auto" : "smooth" });
      return true;
    };
    const togglePlay = () => {
      const sec = secs()[index()], v = sec?.querySelector(".short-player video"); if (!v) return false;
      if (v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => { }); }); else v.pause();
      return true;
    };
    const onKey = (e) => {
      if (!feed || !feed.isConnected || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || modalOpen()) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest(TYPING)) return;
      const k = e.key;
      if (k === " " || k === "Spacebar") { if (t?.closest(PRESSABLE)) return; if (togglePlay()) { e.preventDefault(); e.stopPropagation(); } return; }
      const d = (k === "ArrowDown" || k === "PageDown" || k === "j" || k === "J") ? 1 : (k === "ArrowUp" || k === "PageUp" || k === "k" || k === "K") ? -1 : 0;
      if (!d || e.shiftKey) return;
      e.preventDefault(); e.stopPropagation(); go(d); // handled here: the app-wide j/k "next post" shortcut would otherwise also jump to the first clip
    };
    const onWheel = (e) => { // one clip per gesture: a gesture ends after 180 ms without wheel events (covers trackpad inertia), and never sooner than 400 ms after the move
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (e.target instanceof Element && e.target.closest("[role='slider'],.mp-vol")) return;
      e.preventDefault(); clearTimeout(wT); const wait = Math.max(180, wUntil - Date.now()); wT = setTimeout(() => { wLock = false; }, wait);
      if (wLock || Math.abs(e.deltaY) < 2) return;
      wLock = true; wUntil = Date.now() + 400; go(e.deltaY > 0 ? 1 : -1);
    };
    const onScrollEnd = () => { target = -1; };
    const backdrop = (sec) => { // desktop: the current clip's poster (or colour), blurred behind the 9:16 column (CSS hides it on mobile)
      const v = feed?.closest("#view") || feed?.parentElement; if (!v) return;
      let bd = v.querySelector(".clips-backdrop");
      if (!bd) { bd = document.createElement("div"); bd.className = "clips-backdrop"; bd.setAttribute("aria-hidden", "true"); v.insertBefore(bd, feed); }
      const img = sec.style.backgroundImage; bd.style.setProperty("--clips-bd", img && img !== "none" ? img : "none");
      bd.style.setProperty("--clips-bd-c", sec.style.backgroundColor || "rgb(14 14 18)");
    };
    const detach = () => {
      removeEventListener("keydown", onKey, true);
      if (feed) { feed.removeEventListener("wheel", onWheel); feed.removeEventListener("scrollend", onScrollEnd); }
      clearTimeout(wT); feed = null; target = -1; wLock = false;
    };
    const attach = () => {
      const f = Clips.api.feed(); if (!f) return; detach(); feed = f;
      addEventListener("keydown", onKey, true); // window capture: runs before the app-wide document shortcuts
      feed.addEventListener("wheel", onWheel, { passive: false });
      feed.addEventListener("scrollend", onScrollEnd, { passive: true });
    };
    /* a same-route soft re-render (app.js rerender(), e.g. when a store sync lands) used to rebuild the feed and throw the
     * viewer back to the first clip mid-watch: keep the live feed instead (a language switch still re-renders) */
    const baseView = Clips.view; let renderedDir = "";
    Clips.view = function () {
      const f = Clips.api.feed();
      if (window.__softRender && f && f === feed && f.isConnected && f.querySelector(".short") && document.documentElement.dir === renderedDir && document.body.classList.contains("shorts-mode")) return;
      return baseView.apply(this, arguments);
    };
    Clips.onView(() => { queueMicrotask(() => { attach(); renderedDir = document.documentElement.dir; }); }); // fires before the screen markup exists; attach right after it is rendered
    Clips.onCurrent((sec) => { if (sec?.closest(".shorts") !== feed) attach(); target = -1; backdrop(sec); });
    Clips.onLeave(detach);
  })();
  /* === /v271-snap === */
})();
