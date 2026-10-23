/* مجتمع بلس — «لقطات» feature: «لك» | «المتابَعون» tabs + ?start=<id> (sets the Clips.ext feed policies) (video/clips/tabs.js).
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips
 * (hooks / api / util / ext, documented in video/clips/core.js); block marker kept: v271-tabs. */
(function ClipsTabs() {
  /* === v271-tabs === «لك» | «المتابَعون» tabs over the clip (v2.71). Tab lives in the hash (#/clips?tab=following) so
   * back/refresh keep it; switching = location.replace → the core hashchange leave logic sends the watch beacon, then the
   * route re-renders a fresh feed for that tab (≤3 players). #/clips?start=<id> opens on that clip (prepended when it is
   * not in the first page). Guests (MPSession "out") get the existing auth screen and stay on «لك». */
  function clipsQuery() { return new URLSearchParams(location.hash.split("?")[1] || ""); }
  function clipsGuest() { return window.MPSession?.state === "out"; }
  function clipsTab() { return clipsQuery().get("tab") === "following" && !clipsGuest() ? "following" : "foryou"; }
  function clipsFollowEmpty() { return `<div class="empty cl-tabs-empty" role="status"><p>تابع صنّاعاً لتظهر لقطاتهم هنا</p><a class="btn" href="#/explore">استكشف صنّاعاً</a></div>`; }
  function clipsStart(r, cursor) { // first page only: honour ?start=<id>
    const id = clipsQuery().get("start"); if (cursor || !id || !r || r.items.some(p => p.id === id)) return r;
    const p = S.post(id); if (p && p.type === "video" && p.status !== "deleted") r.items.unshift(p);
    return r;
  }
  (() => {
    const TABS = [["foryou", "لك"], ["following", "المتابَعون"]];
    const go = (tab) => {
      if (tab === clipsTab()) return;
      if (tab === "following" && clipsGuest()) { if (typeof showAuth === "function") showAuth("login"); return; } // stays on «لك»
      const base = (location.hash.split("?")[0] || "#/clips");
      location.replace(tab === "following" ? base + "?tab=following" : base); // no history entry per tap; back leaves the page
    };
    Clips.onView(() => queueMicrotask(() => { // after shortsView has painted its shell
      const feed = Clips.api.feed(); if (!feed || feed.parentNode.querySelector(".cl-tabs")) return;
      const cur = clipsTab();
      feed.insertAdjacentHTML("beforebegin", `<div class="cl-tabs" role="tablist" aria-label="أقسام فيديوتك">${TABS.map(([k, l]) => `<button type="button" role="tab" class="cl-tabs-tab" data-cltab="${k}" aria-selected="${k === cur}" tabindex="${k === cur ? 0 : -1}">${l}</button>`).join("")}</div>`);
      const bar = feed.parentNode.querySelector(".cl-tabs");
      bar.addEventListener("click", (e) => { const b = e.target.closest("[data-cltab]"); if (b) go(b.dataset.cltab); });
      bar.addEventListener("keydown", (e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault();
        const i = TABS.findIndex(([k]) => k === cur), n = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + 1) % TABS.length;
        bar.querySelectorAll("[data-cltab]")[n].focus(); go(TABS[n][0]);
      });
      const start = clipsQuery().get("start"); let done = !start;
      const off = Clips.onSection((sec) => { if (done || sec.dataset.short !== start) return; done = true; off(); requestAnimationFrame(() => sec.scrollIntoView({ block: "start" })); });
      const place = () => { if (!feed.isConnected) return; const r = feed.getBoundingClientRect(); bar.style.setProperty("--cl-tabs-x", Math.round(r.left + r.width / 2) + "px"); }; // centred over the video column (desktop has a side column)
      place(); requestAnimationFrame(place); setTimeout(place, 500); const host = feed.parentNode; host.addEventListener("animationend", place); addEventListener("resize", place); // re-measured after the route entrance animation
      const offLeave = Clips.onLeave(() => { off(); offLeave(); removeEventListener("resize", place); host.removeEventListener("animationend", place); }); // per-visit hook cleanup
    }));
  })();
  /* === /v271-tabs === */
  /* v2.80 watch source: the clip opened with ?start=<id> came from the page the visitor was on just before (profile grid,
   * #tag / sound page, challenge, a «يظهر في فيديوتك» strip on a product / job page); every other clip came from the tab.
   * Read from the previous hash, so no tile link changes. Unknown (first load, explore before the chunk loaded) = "other". */
  let fromHash = "";
  addEventListener("hashchange", (e) => { try { const o = new URL(e.oldURL).hash; if (!/^#\/clips(\?|$)/.test(o)) fromHash = o; } catch { /* keep */ } });
  function originOf(h) {
    if (/^#\/clips\/@/.test(h)) return "profile";
    if (/^#\/clips\/tag\//.test(h)) return "tag";
    if (/^#\/clips\/sound\//.test(h)) return "sound";
    if (/^#\/clips\/challenge/.test(h)) return "challenge";
    if (/^#\/(market\/item|job|c|event|course)\//.test(h)) return "link";
    return "other";
  }
  function clipsSrc(sec) {
    const start = clipsQuery().get("start");
    if (start && sec?.dataset?.short === start) return originOf(fromHash);
    return clipsTab();
  }
  Object.assign(Clips.ext, { tab: clipsTab, start: clipsStart, followEmpty: clipsFollowEmpty, src: clipsSrc }); // feed policies used by core.js
})();
