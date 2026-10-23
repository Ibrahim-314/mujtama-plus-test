/* مجتمع بلس — «لقطات»: clean screen (video/clips/clean.js, v2.73, block marker v273-clean).
 * Part of the lazy "clips" chunk. Talks to the feed only through window.Clips.
 *  - One tap on the clip hides everything over it (tabs, back, caption, series bar, rail, player bar) so only the clip
 *    is left; the thin progress line stays. One more tap brings it all back. Double-tap like and hold-for-2× unchanged.
 *  - Pause/play moves to a small round button by the progress line (and the Space key, as before).
 *  - Optional auto-hide: Settings › «إخفاء الواجهة تلقائياً» (off · 3 · 5 · 10 s, pref "clipsAutoHide", default off).
 *    It never hides while the clip is paused, a sheet/dialog is open, or a keyboard user is moving focus.
 *  - Any key press (Tab, arrows…) reveals the controls; the hidden controls are visibility:hidden so focus can't land on them.
 *  - Clean mode carries over to the next clip, like a viewer would expect, and ends when the viewer is left.
 */
(function ClipsClean() {
  const { ic } = Clips.util;
  /* === v273-clean === */
  const B = document.body, KEY = "clipsAutoHide", HINT = "clipsCleanHint";
  const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
  const pref = (k, d) => (window.MP?.pref ? MP.pref(k, d) : d);
  const delay = () => { const n = Number(pref(KEY, 0)); return [3, 5, 10].includes(n) ? n : 0; };
  let cur = null, timer = 0;
  const vid = (sec) => sec?.querySelector(".short-player video");
  const isOn = () => B.classList.contains("cl-clean");
  const busy = () => !!document.querySelector('[aria-modal="true"], .cl-up.in') || !!(vid(cur)?.paused) || B.classList.contains("cl-kbd");

  function set(on) {
    if (on === isOn()) { if (!on) arm(); return; }
    B.classList.toggle("cl-clean", on);
    if (on) {
      clearTimeout(timer);
      if (!pref(HINT, false) && typeof toast === "function") { toast(T("المس الشاشة لإظهار الأزرار")); window.MP?.setPref?.(HINT, true); }
    } else arm();
  }
  function arm() {
    clearTimeout(timer); const s = delay();
    if (!s || !B.classList.contains("shorts-mode")) return;
    timer = setTimeout(() => { if (!B.classList.contains("shorts-mode")) return; if (busy()) { arm(); return; } set(true); }, s * 1000);
  }
  const toggle = () => set(!isOn());

  /* pause / play button by the progress line */
  function ppPaint(sec) { const b = sec?.querySelector(".cl-pp"), v = vid(sec); if (!b) return; const paused = !v || v.paused; b.innerHTML = ic(paused ? "play" : "pause", "sm"); b.setAttribute("aria-label", T(paused ? "تشغيل المقطع" : "إيقاف المقطع مؤقتاً")); }
  Clips.onSection((sec) => {
    if (sec.querySelector(".cl-pp")) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "cl-pp";
    b.addEventListener("click", (e) => {
      e.stopPropagation(); const v = vid(sec); if (!v) return;
      if (v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => { }); }); else v.pause();
      arm();
    });
    b.addEventListener("pointerup", (e) => e.stopPropagation()); // never counts toward the double-tap like
    sec.appendChild(b); ppPaint(sec);
  });
  ["play", "pause", "playing", "loadedmetadata"].forEach((t) => document.addEventListener(t, (e) => {
    const sec = e.target?.closest?.(".short"); if (!sec) return; ppPaint(sec);
    if (t === "pause" && sec === cur) clearTimeout(timer); else if (t === "play" && sec === cur && !isOn()) arm();
  }, true));

  Clips.onCurrent((sec) => { cur = sec; ppPaint(sec); if (!isOn()) arm(); });

  /* any interaction restarts the countdown; keys always reveal */
  document.addEventListener("pointerdown", () => { B.classList.remove("cl-kbd"); if (!isOn()) arm(); }, true);
  document.addEventListener("keydown", (e) => {
    if (!B.classList.contains("shorts-mode") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Tab") B.classList.add("cl-kbd");
    if (isOn()) set(false); else arm();
  }, true);
  window.addEventListener("hashchange", () => { if (!/^#\/clips/.test(location.hash)) { clearTimeout(timer); B.classList.remove("cl-clean", "cl-kbd"); } });

  Clips.clean = { toggle, set, isOn, arm, delay };
  /* === end v273-clean === */
})();
