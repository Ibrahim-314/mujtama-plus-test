/* مجتمع بلس — the bridge between the app and «المدينة الرقمية» (game/bridge.js, the lazy "town" chunk).
 * The game is its own program in game/ (built to /game/game.js); this file is the ONLY place the app touches it:
 *   #/city              mounts the game full screen (the app's bars step aside) — lazy-loads /game/game.js once
 *   #/city/mjt/<page>   the MJT terminal pages (game/stations/stations.js) open as full pages over the game
 *   #/city/<name>       (not "mjt") stays the «المدن» city page of the nearby module
 *   #/town              old address → #/city
 * Leaving #/city unmounts the game (renderer, audio and listeners are released). */
(function GameBridge() {
  "use strict";
  const GAME_URL = "/game/game.js?v=__APP_VERSION__";
  const CSS_URL = "/game/game.css?v=__APP_VERSION__";
  const T = (x) => (window.MPI18n && MPI18n.t ? MPI18n.t(x) : x);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lang = () => (document.documentElement.lang === "en" ? "en" : "ar");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the small shim the terminal pages use (they were written for the old city engine)
  window.MPCity = window.MPCity || {};
  Object.assign(window.MPCity, { util: { T, esc, lang, reduced }, sound: { coin() { try { game && game.audio.sfx("coin"); } catch { /* optional */ } } } });

  let game = null, root = null, modP = null, cssP = null, lastStation = null;
  const loadCss = () => cssP || (cssP = new Promise((res) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = CSS_URL; l.onload = res; l.onerror = res; document.head.append(l); }));
  const loadMod = () => modP || (modP = import(GAME_URL).catch((e) => { modP = null; throw e; }));
  const member = () => typeof DB !== "undefined" && !!DB.me;
  const host = {
    api: (m, p, b) => Remote.api(m, p, b),
    me: () => (typeof DB !== "undefined" && DB.me ? { name: DB.me.name, handle: DB.me.handle } : null),
    lang,
    get member() { return member(); },
    openStation: (id) => { location.hash = "#/city/mjt/" + id; },
    exit: () => { location.hash = "#/menu"; }
  };

  function mount(station) {
    document.body.classList.add("gm-on");
    if (game && root && root.isConnected) return;
    root = document.createElement("div"); root.id = "gm-root"; document.body.append(root);
    root.innerHTML = `<div class="gm-boot" role="status"><i></i><span>${esc(T("جارٍ تشغيل المدينة الرقمية…"))}</span></div>`;
    Promise.all([loadCss(), loadMod()]).then(([, mod]) => {
      if (!root || !root.isConnected) return;
      game = mod.mount(root, host, { station }); window.MPGame = game;
    }).catch(() => {
      if (!root) return;
      root.innerHTML = `<div class="gm-boot err"><b>${esc(T("تعذّر تحميل اللعبة"))}</b><a href="#/menu">${esc(T("رجوع"))}</a></div>`;
    });
  }
  function unmount() {
    document.body.classList.remove("gm-on");
    if (window.MPCity.closeRoom) window.MPCity.closeRoom();
    try { game && game.unmount(); } catch (e) { console.error(e); }
    game = null; window.MPGame = null; if (root) root.remove(); root = null;
  }
  addEventListener("hashchange", () => { if (!/^#\/(city|town)(\/mjt(\/|$)|\/?$|\?)/.test(location.hash) && root) unmount(); });
  // the terminal pages tell us when they close (game/stations/stations.js dispatches mp-game-focus)
  addEventListener("mp-game-focus", () => { lastStation = null; if (game) game.stationClosed(); });

  MPRoutes.extend((a, b, prev) => {
    a = (a || "").split("?")[0]; b = (b || "").split("?")[0];
    const city = () => {
      if (a && a !== "mjt") { // #/city/<name>: the nearby module's city page
        if (root) unmount();
        if (prev.city) return prev.city();
        if (window.MPChunks) return MPChunks.load("nearby").then(() => MPChunks.reroute && MPChunks.reroute("nearby"));
        return;
      }
      // the app keeps its own view empty and quiet underneath the game
      if (typeof view !== "undefined" && view) view.innerHTML = `<div class="gm-under" aria-hidden="true"></div>`;
      const station = a === "mjt" && b && window.MPCity.room ? b : null;
      mount(station);
      if (station) {
        if (game) game.showStation(station);
        if (window.MPCity.room(station)) lastStation = station;
      } else if (lastStation || document.querySelector("body > .cy-st")) { window.MPCity.closeRoom && window.MPCity.closeRoom(); }
    };
    return { city, town: () => { location.replace("#/city" + (a ? "/" + a : "") + (b ? "/" + b : "")); } };
  });
})();
