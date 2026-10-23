/* مجتمع بلس — «لقطات»: viewer comfort (video/clips/viewer.js, v2.73, block marker v273-viewer).
 * Part of the lazy "clips" chunk. Talks to the feed only through window.Clips. Both options live in Settings and are off by default.
 *  - Auto-next (pref "clipsAutoNext"): when the clip on screen reaches its end it moves to the next clip instead of looping.
 *    Not while a sheet is open, while the viewer holds 2× or scrubs, and never past the last loaded clip.
 *  - Break reminder (pref "clipsBreak": 0 · 20 · 40 · 60 minutes of actual watching): pauses the clip and offers a calm
 *    choice — keep watching or leave. Counts played time only, resets after the reminder and when the viewer is left.
 */
(function ClipsViewer() {
  /* === v273-viewer === */
  const B = document.body;
  const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
  const pref = (k, d) => (window.MP?.pref ? MP.pref(k, d) : d);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const breakMin = () => { const n = Number(pref("clipsBreak", 0)); return [20, 40, 60].includes(n) ? n : 0; };
  const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const modal = () => !!document.querySelector('dialog[open],[aria-modal="true"],.sheet.open');
  let cur = null, watched = 0;

  function next(sec) {
    const n = sec?.nextElementSibling; if (!n || !n.classList.contains("short")) return false;
    const feed = sec.parentElement; feed.scrollTo({ top: feed.scrollTop + n.getBoundingClientRect().top - feed.getBoundingClientRect().top, behavior: reduced() ? "auto" : "smooth" });
    return true;
  }

  function hook(sec) {
    const v = sec.querySelector(".short-player video"); if (!v || v._clV) return; v._clV = 1;
    let last = 0;
    v.addEventListener("timeupdate", () => {
      const t = v.currentTime, d = v.duration || 0, dt = t - last; last = t;
      if (sec !== cur || !B.classList.contains("shorts-mode")) return;
      if (dt > 0 && dt < 1.5 && !v.paused) { watched += dt / (v.playbackRate || 1); checkBreak(v); }
      // auto-next: the looping clip wrapped (or is within the last 0.25 s) → move on
      if (!pref("clipsAutoNext", false) || !(d > 1) || modal() || v.playbackRate !== 1 || sec.querySelector(".cl-scrub-drag")) return;
      if (dt < -1 && last < 1 && !sec._clWrap) { sec._clWrap = 1; if (next(sec)) v.pause(); setTimeout(() => { sec._clWrap = 0; }, 1500); }
    });
  }

  function checkBreak(v) {
    const m = breakMin(); if (!m || watched < m * 60 || document.querySelector(".cl-brk")) return;
    watched = 0; v.pause();
    const d = document.createElement("div"); d.className = "cl-brk"; d.setAttribute("role", "alertdialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-labelledby", "cl-brk-h");
    d.innerHTML = `<div class="cl-brk-card"><span class="cl-brk-ic" aria-hidden="true">${Clips.util.ic("moon")}</span><h2 id="cl-brk-h">${esc(T("وقت استراحة قصيرة؟"))}</h2><p>${esc(T("صار لك {n} دقيقة تشاهد. فيديوتك ينتظرك متى ما رجعت.").replace("{n}", m))}</p><div class="cl-brk-row"><button type="button" class="btn" data-brk="go">${esc(T("أكمل المشاهدة"))}</button><button type="button" class="btn ghost" data-brk="out">${esc(T("خروج من فيديوتك"))}</button></div></div>`;
    const close = () => { d.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); v.play().catch(() => { }); } };
    d.addEventListener("click", (e) => {
      const a = e.target.closest("[data-brk]")?.dataset.brk; if (!a) return;
      close(); if (a === "go") v.play().catch(() => { }); else document.querySelector(".shorts-back")?.click();
    });
    document.addEventListener("keydown", onKey, true);
    B.appendChild(d); d.querySelector("[data-brk=go]").focus();
  }

  Clips.onCurrent((sec) => { cur = sec; hook(sec); setTimeout(() => hook(sec), 400); });
  document.addEventListener("loadedmetadata", (e) => { const sec = e.target?.closest?.(".short"); if (sec) hook(sec); }, true);
  window.addEventListener("hashchange", () => { if (!/^#\/clips/.test(location.hash)) { watched = 0; document.querySelector(".cl-brk")?.remove(); } });

  Clips.viewer = { next: () => next(cur), _watch: (s) => { watched = s; } };
  /* === end v273-viewer === */
})();
