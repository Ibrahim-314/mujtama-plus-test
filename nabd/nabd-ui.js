/* مجتمع بلس — «نبض النواة» (v2.105): the Godot 4 game, served as its own static program at /nabd/engine/ (single-threaded
 * Web export, no COOP/COEP). This lazy "nabd" chunk is the ONLY place the app touches it:
 *   #/city            mounts the game full screen in a same-origin iframe (the app's bars step aside)
 *   #/city/<name>     stays the «المدن» city page of the nearby module
 * The game posts "nabd:ready" when it runs and "nabd:exit" when the player leaves. Leaving #/city removes the iframe
 * (renderer, audio and memory are released with it). The game keeps its own progress on the device only. */
(function NabdBridge() {
  "use strict";
  const SRC = "/nabd/engine/index.html?v=__APP_VERSION__";
  const T = (x) => (window.MPI18n && MPI18n.t ? MPI18n.t(x) : x);
  let root = null, timer = 0;
  const onCity = () => /^#\/city(\?|$|\/?$)/.test(location.hash);
  function unmount() {
    document.body.classList.remove("nb-on");
    clearTimeout(timer); if (root) root.remove(); root = null;
  }
  function mount() {
    document.body.classList.add("nb-on");
    if (root && root.isConnected) return;
    root = document.createElement("div"); root.id = "nb-root";
    root.innerHTML = `<div class="nb-boot" role="status"><i></i><b></b><span></span></div><button type="button" class="nb-x"></button>`;
    root.querySelector(".nb-boot b").textContent = T("نبض النواة");
    root.querySelector(".nb-boot span").textContent = T("جارٍ تشغيل العالم… قد يستغرق التحميل الأول دقيقة");
    const x = root.querySelector(".nb-x"); x.textContent = "✕"; x.setAttribute("aria-label", T("خروج من اللعبة")); x.onclick = leave;
    const f = document.createElement("iframe");
    f.src = SRC; f.title = T("نبض النواة"); f.allow = "fullscreen; autoplay; gamepad"; f.setAttribute("allowfullscreen", "");
    f.addEventListener("load", () => { const b = root && root.querySelector(".nb-boot"); if (b) b.remove(); }); // the game's own loading screen takes over
    root.append(f); document.body.append(root);
    timer = setTimeout(() => { const s = root && root.querySelector(".nb-boot span"); if (s && root.querySelector(".nb-boot")) s.textContent = T("الاتصال بطيء — ما زال التحميل مستمراً"); }, 45000);
  }
  function leave() { if (history.length > 1 && document.referrer !== "") history.back(); else location.hash = "#/menu"; setTimeout(() => { if (onCity()) location.hash = "#/menu"; }, 150); }
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || !root) return;
    if (e.data === "nabd:ready") { const b = root.querySelector(".nb-boot"); if (b) b.remove(); clearTimeout(timer); root.classList.add("ready"); }
    else if (e.data === "nabd:exit") leave();
  });
  addEventListener("hashchange", () => { if (!onCity() && root) unmount(); });
  MPRoutes.extend((a, b, prev) => ({
    city: () => {
      a = (a || "").split("?")[0];
      if (a) { // #/city/<name>: the nearby module's city page
        if (root) unmount();
        if (prev.city) return prev.city();
        if (window.MPChunks) return MPChunks.load("nearby").then(() => MPChunks.reroute && MPChunks.reroute("nearby"));
        return;
      }
      if (typeof view !== "undefined" && view) view.innerHTML = `<div class="nb-under" aria-hidden="true"></div>`;
      mount();
    }
  }));
  if (onCity() && typeof route === "function") route();
})();
