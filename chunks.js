/* On-demand feature chunks (v2.5, discovery added in v2.6). In production the build splits scripts marked data-chunk into
 * their own hashed files (window.__CHUNKS); routes that need a chunk load it first, then render.
 * In development every script is already on the page, so nothing is fetched. */
(function Chunks() {
  try { const c = localStorage.getItem("mp.ui"); if (c) { const s = document.createElement("style"); s.id = "mp-ui"; s.textContent = c; document.head.append(s); } } catch { } // phase 44: saved theme/density/nav before first render
  const ROUTES = { communities: ["c", "cmod", "cset", "chealth", "wiki", "join", "event", "events", "communities"],
    discovery: ["search", "explore", "topic", "tag", "library", "collection", "sc", "lists", "list", "digest", "feedprefs"],
    comms: ["messages", "chat", "chatinfo", "newgroup", "safety", "e2ee", "devices", "message-requests"],
    notify: ["notifications", "notifsettings", "nsettings", "emailprefs", "email-prefs", "unsubscribe", "reset"],
    compliance: ["mydata", "my-reports", "account-log", "legal", "transparency", "compliance", "decisions"],
    pi: ["wallet", "receipt", "admin"],
    tips: ["support", "supporting", "creator", "earnings"],
    market: ["market", "admin/market"],
    ads: ["ads", "admin/ads", "settings/ads"],
    ai: ["ai", "admin/ai", "settings/translate"],
    i18n: ["i18n", "admin/i18n", "settings/language"],
    a11y: ["a11y", "accessibility", "admin/a11y", "settings/display"],
    prefs: ["appearance", "settings/appearance"],
    wellbeing: ["wellbeing"],
    transfers: ["transfers", "admin/pi-activation", "admin/activation", "admin/transfers"],
    subs: ["subs", "subscribers"],
    secx: ["security", "status", "admin/security", "privacy", "message-requests", "verify", "trust", "orgs", "org"],
    econ: ["admin/pricing", "admin/revenue"],
    digital: ["digital", "purchases", "admin/digital"],
    beta: ["beta", "admin/beta"],
    points: ["points", "leaderboard", "admin/points"],
    finance: ["statement", "invoice", "annual", "finance-report", "admin/finance"],
    canalytics: ["analytics"],
    nearby: ["nearby", "place", "places", "cities", "city", "admin/places"],
    study: ["study"],
    series: ["scheduled", "drafts", "series"],
    biz: ["biz", "admin/biz"],
    courses: ["courses", "course"],
    collabs: ["collabs", "admin/collabs"],
    hijri: ["hijri", "season", "admin/hijri"],
    certs: ["exams", "exam", "attempt", "certificates", "cert", "verify-cert", "mentor-certs"],
    mentor: ["mentors", "mentor", "msession", "mentoring", "admin/mentors"],
    vcreators: ["creator-program", "fund", "admin/creator-program"],
    charity: ["giving", "campaign", "organisation", "opportunity", "admin/charity"],
    knowledge: ["knowledge", "kb", "admin/knowledge"],
    work: ["cv", "talent", "admin/pro", "jobs", "job", "application", "admin/jobs", "contracts", "contract", "admin/contracts"]
  };
  ROUTES.mjt = ["mjt", "admin/mjt"]; // v2.47 «مجتمع كوين» wallet + admin (mjt-ui.js + mjt.css)
  ROUTES.proreviews = ["reviews", "admin/reviews"]; // v2.46 phase 80: professional reputation (proreviews-ui.js + proreviews.css), loads after the work chunk
  ROUTES.teams = ["teams", "team"]; // v2.45 phase 79: teams & projects (teams-ui.js + teams.css), loads after the work chunk
  ROUTES.creation = ["studio", "rooms", "room"]; // v2.42: studio + live rooms screens (creation-ui.js) with creation.css
  // v2.51: chunks that used to arrive only through the eager preload now also load when their own route opens (guests no longer preload them)
  ROUTES.cadmin = ["cadmin", "cappeal"]; // v2.57: community admin panel (cadmin-ui.js + cadmin.css), after the communities chunk (hosts its screens)
  ROUTES.menu = ["menu"]; // v2.52: «المزيد» hub (menu-ui.js + menu.css), after the feat chunk for its icons
  ROUTES.aihub = ["aihub", "admin/aihub"]; // v2.77: «مركز الذكاء» — link your own AI account (aihub-ui.js + aihub.css), after the feat chunk for its icons
  ROUTES.clips = ["shorts", "clips"]; // v2.71: «لقطات» full-screen view (clips-ui.js + clips.css); core keeps the route + MPPlayer
  ROUTES.v12x = ["series", "events", "event", "lists", "list", "interests", "trends", "admin", "decisions"]; // v2.81: the v1.2 screens (v12-screens.js) left the core bundle
  ROUTES.setx = ["settings"]; // v2.81: the settings hub (settings-hub.js) left the core bundle
  ROUTES.launch = ["faq", "tickets", "ambassadors", "waitlist", "about", "staff"]; ROUTES.pwa = ["share", "app"];
  const loaded = {}, pending = {}, cssDone = {}, cssPend = {};
  const FEAT = "market nearby study series biz courses collabs hijri certs mentor vcreators charity knowledge work teams proreviews mjt canalytics points creation communities tips transfers ads dev digital subs wellbeing menu cadmin aihub".split(" ");
  const has = (n) => !!((window.__CHUNKS || {})[n] || (window.__CSS || {})[n]);
  /* v2.32 lazy CSS: a chunk's stylesheet (window.__CSS[name]) is fetched with its JS, and the screen renders only after both
   * arrived, so a module never paints unstyled. A failed stylesheet does not block the screen. */
  function css(name) {
    const href = (window.__CSS || {})[name]; if (!href || cssDone[name]) return Promise.resolve();
    return cssPend[name] ||= new Promise((res) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; l.onload = () => { cssDone[name] = true; res(); }; l.onerror = () => { delete cssPend[name]; res(); }; document.head.appendChild(l); });
  }
  const failed = {}; // v2.55: chunks whose script failed to load (the not-found guard below then lets the 404 through)
  function load(name) {
    if (name === "tips" && !loaded.pi && (window.__CHUNKS || {}).pi) return load("pi").then(() => load("tips")); // phase 37: tips wraps the pi routes + pay flow
    if (name === "comms" && !loaded["comms-core"] && (window.__CHUNKS || {})["comms-core"]) return load("comms-core").then(() => load("comms")); // the screens need MPComms first
    if (FEAT.includes(name) && !loaded.feat && has("feat")) return load("feat").then(() => load(name)); // v2.34: shared icons + module styles first
    if ((name === "teams" || name === "proreviews") && !loaded.work && has("work")) return load("work").then(() => load(name)); // v2.45: reuses the wk-* styles
    if (name === "cadmin" && !loaded.communities && has("communities")) return load("communities").then(() => load("cadmin")); // v2.57: the panel hosts the moderation/health/channels screens
    if (name === "composer" && !loaded.composercore && has("composercore")) return load("composercore").then(() => load("composer")); // v2.50: both editors share the core
    const src = (window.__CHUNKS || {})[name]; if (loaded[name] || !has(name)) return Promise.resolve();
    // stylesheet first: a chunk may enhance the current screen as soon as its script runs
    return pending[name] ||= css(name).then(() => src && new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.dataset.chunk = name; s.onload = res; s.onerror = () => { delete pending[name]; failed[name] = true; rej(new Error("chunk " + name)); }; document.head.appendChild(s); })).then(() => { loaded[name] = true; });
  }
  window.MPChunks = { load, loaded, reroute: (n) => rerouteAfter(n) };
  // v2.52: the hub is one tap away for every signed-in member — warm it (and the feat icons it uses) once the first screen is idle
  if (window.MPSession) MPSession.whenIn(() => (window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 3000 }) : (f) => setTimeout(f, 1500))(() => load("menu").catch(() => { })));
  /* v2.51: guests (auth screen) do not preload feature chunks — a guest only downloads what its screen needs (the route's own
   * chunk, accessibility, the age field + invite code of the sign-up form, the app-install helper, and Pi sign-in when Pi is enabled).
   * Everything else warms up exactly as before, right after sign-in (MPSession "in"; offline demo mode counts as signed in). */
  const whenIn = (fn) => (window.MPSession ? MPSession.whenIn(fn) : fn());
  const idle = (timeout, ms) => (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout }) : setTimeout(f, ms));
  /* v2.81: one re-route per landing chunk — the route() wrapper and the hashchange ensure() both asked for one, so the
   * first visit to every lazy screen rendered it twice */
  const rr = {};
  const rerouteAfter = (n) => (rr[n] ||= load(n).then(() => { delete rr[n]; route(); }, (e) => { delete rr[n]; throw e; }));
  const _route = route;
  route = function () {
    const self = this, args = arguments, need = needFor();
    /* v2.81 («first clip opens twice»): a chunk ends with its own «if this is my route, route()» for development. In
     * production that call ran while the chunk was still executing, so it painted the skeleton and queued a second render
     * beside the loader's own re-route: the screen (the clips viewer, its first video) was built twice. While the chunk this
     * route needs is executing, its self-route is a no-op — the loader re-routes exactly once when it lands. */
    const cs = document.currentScript; if (need && cs && cs.dataset && cs.dataset.chunk === need) return;
    if (!need) return _route.apply(self, args);
    if (typeof view !== "undefined" && view) view.innerHTML = `<div class="wrap" aria-busy="true" aria-label="جارٍ التحميل…"><div class="skel"></div><div class="skel"></div></div>`;
    rerouteAfter(need).then(null, () => _route.apply(self, args));
  };
  // the app's own hashchange listener and first render may hold the original route(): make sure a
  // route that needs a chunk re-renders once the chunk arrives
  // a two-segment route ("admin/market") wins over its first segment ("admin")
  const needFor = () => { const s = location.hash.slice(2).split("?")[0].split("/"), r = [s[0] + "/" + s[1], s[0] || "home"].find(x => Object.values(ROUTES).some(l => l.includes(x))); return Object.keys(ROUTES).find(n => ROUTES[n].includes(r) && has(n) && !loaded[n]); };
  const ensure = () => { const n = needFor(); if (n) rerouteAfter(n).catch(() => { }); };
  /* v2.55: the app's own hashchange listener runs the original route() first; for a screen whose chunk is still on its way
   * that drew «الصفحة غير موجودة» until the chunk arrived (a 404 flash, and a race in nav-routes.e2e). Show the loading
   * skeleton instead while a chunk for this route is pending; ensure() re-renders once it lands. */
  if (typeof Views !== "undefined" && Views.notFound) { const _nf = Views.notFound; Views.notFound = function () { const n = needFor(); if (n && !failed[n] && typeof view !== "undefined" && view) { view.innerHTML = `<div class="wrap" aria-busy="true" aria-label="جارٍ التحميل…"><div class="skel"></div><div class="skel"></div></div>`; return; } return _nf.apply(this, arguments); }; }
  addEventListener("hashchange", ensure); ensure();
  // warm both chunks when the browser is idle so the first tap is instant; the discovery chunk also
  // enhances Home (feed tabs, caught-up marker, digest) and post pages (summary card) in place once loaded
  whenIn(() => (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => load("composer").catch(() => { }).then(() => load("discovery")).catch(() => { }).then(() => load("communities")).catch(() => { }).then(() => load("comms")).catch(() => { }).then(() => load("notify")).catch(() => { }).then(() => load("compliance")).catch(() => { }))); // notify-ui also shows in-app toasts
  // v2.61: page help «؟» (help-ui.js + help.css, registry help-content.js) — tiny, warmed once the first screen is idle
  whenIn(() => idle(2000, 400)(() => load("help").catch(() => { })));
  whenIn(() => idle(4000, 2000)(() => load("v12x").catch(() => { }).then(() => load("setx")).catch(() => { }))); // v2.81: the v1.2 screens (lists, events, admin…) warm once idle, so the first tap stays instant
  // calls (phase 30): the engine ("calls", calls-core.js) must be listening before the first ring, so it loads
  // early, then the call screens ("callsui"); #/calls (history) waits for both
  // phase 32/33: trust & safety screens + post safety menu load right after first paint (kept out of the core budget)
  (function safetyChunks() {
    const R = ["help", "policies", "protection", "integrity", "investigation", "investigations", "inv-user", "security"];
    const want = () => R.includes((location.hash.split("/")[1] || "").split("?")[0]);
    const go = () => load("protcore").then(() => load("protection")).then(() => load("integrity")).then(() => { if (want()) route(); }).catch(() => { });
    addEventListener("hashchange", () => { if (want() && (window.__CHUNKS || {}).protection && !loaded.integrity) go(); });
    whenIn(() => (window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 600 }) : (f) => setTimeout(f, 200))(go));
  })();
  // phase 35: minors-core (rules) then minors-ui (cover, age gate field, #/age #/family #/urgent #/safety-cases)
  (function minorsChunks() {
    const R = ["age", "family", "urgent", "safety-cases"];
    const want = () => R.includes((location.hash.split("/")[1] || "").split("?")[0]);
    const go = () => load("minorscore").then(() => load("minors")).then(() => { if (want()) route(); }).catch(() => { });
    addEventListener("hashchange", () => { if (want() && (window.__CHUNKS || {}).minors && !loaded.minors) go(); });
    (window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 800 }) : (f) => setTimeout(f, 300))(go);
  })();
  // phase 36: Pi screens + sign-in/settings/pay button load right after first paint (auth screen needs it early); phase 45: wellbeing first (usage tracker, count hiding)
  (window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 400 }) : (f) => setTimeout(f, 100))(() => load("a11y").catch(() => { })); // phase 43: keyboard/screen-reader fixes for everyone
  whenIn(() => (window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 700 }) : (f) => setTimeout(f, 250))(() => load("wellbeing").catch(() => { }).then(() => load("tips")).catch(() => { }).then(() => load("ads")).catch(() => { }).then(() => load("i18n")).catch(() => { }).then(() => load("ai")).catch(() => { }).then(() => load("prefs")).catch(() => { }).then(() => load("transfers")).catch(() => { }).then(() => load("attn")).catch(() => { })));
  // guests: the sign-up helpers (launch: invite/referral code carried into sign-up, about/waitlist/help landings), the app-install
  // helper (was riding on the notify chunk) and, only when Pi sign-in/payments are on, the Pi chunk (its button on the auth screen)
  idle(1200, 600)(() => { if (window.MPSession && MPSession.signedIn()) return; load("launch").catch(() => { }); load("pwa").catch(() => { }); if (typeof PiAdapter !== "undefined") PiAdapter.config().then((c) => { if (c && (c.authEnabled ?? c.enabled) && !(window.MPSession && MPSession.signedIn())) load("pi").catch(() => { }); }).catch(() => { }); });
  if (location.pathname === "/about" && !location.hash) load("launch").catch(() => { }); // /about landing (launch-ui rewrites it to #/about)
  { const sp = () => { if (/^#\/post\//.test(location.hash)) load("series").catch(() => { }); }; addEventListener("hashchange", sp); sp(); } // phase 62: series nav on post pages // phase 61: attention beacon
  if (typeof DB !== "undefined" && DB.settings && DB.settings.lang && DB.settings.lang !== "ar") load("i18n").catch(() => { }); if (typeof DB !== "undefined" && DB.settings && DB.settings.hijri) (window.requestIdleCallback || setTimeout)(() => load("hijri").catch(() => { })); // phase 68: Hijri labels with sighting overrides // phase 41: non-Arabic UI right away // phase 37: "tips" pulls "pi" first (tip buttons, #/me/supporting, #/admin/tips)
  (function callsChunks() {
    const want = () => (location.hash.split("/")[1] || "").split("?")[0] === "calls";
    const go = () => load("calls").then(() => load("callsui")).then(() => { if (want()) route(); }).catch(() => { });
    addEventListener("hashchange", () => { if (want() && (window.__CHUNKS || {}).callsui && !loaded.callsui) go(); });
    whenIn(() => (window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 1500 }) : (f) => setTimeout(f, 800))(go));
  })();
})();
