/* =====================================================================
 * مجتمع بلس — v2.52 navigation core (loaded right after ui.js)
 * One place that owns how people move around the app:
 *  • Tab bar (5): الرئيسية · استكشف · المجتمعات · الإشعارات · المزيد (#/menu, the hub of every other feature — menu-ui.js).
 *    A deep screen keeps the tab it was opened from highlighted (its "owner"); tapping the active tab scrolls to the top.
 *  • Top app bar: on a tab root → brand + shortcuts (language, search, messages, your avatar → #/me);
 *    on a deep screen → a real back button + the screen title (it appears once the page's own heading scrolls away).
 *  • Back: in-app history when there is some (history.back()), otherwise the screen's logical parent (its page-head
 *    «→ parent» link, then a route map, then its tab) with location.replace — so back never leaves the app.
 *  • Scroll position is saved per history entry and restored on back; new screens start at the top.
 *  • Direction-aware page transitions (#view[data-nav=push|pop|tab]); bars hide while scrolling down on phones.
 * Registry-friendly: it adds no override chain (no route()/Views wrapping) — it listens to hashchange and observes #view.
 * ===================================================================== */
(function Nav() {
  const TABS = ["home", "explore", "communities", "notifications", "menu"];
  const FAM = {
    home: ["home", "post", "share"],
    explore: ["explore", "search", "topic", "tag", "trends", "digest", "shorts", "clips"],
    communities: ["communities", "c", "cadmin", "cappeal", "cmod", "cset", "chealth", "wiki", "join", "events", "event"],
    notifications: ["notifications", "notifsettings", "nsettings"]
  };
  const STRONG = { me: "menu", settings: "menu", menu: "menu" }; // profile and settings live under «المزيد»
  /* v2.53: every screen lights the tab it lives under, wherever it was opened from — a community page → «المجتمعات»,
   * a hub feature (jobs, wallet, courses…) → «المزيد»; only shared content (a post, a share sheet, a person's profile)
   * keeps the tab it was opened from */
  const CONTEXTUAL = ["post", "share", "u"];
  /* logical parent for screens that do not print their own «→ parent» link */
  const PARENT = { c: "#/communities", cadmin: "#/communities", cappeal: "#/communities", cmod: "#/communities", cset: "#/communities", chealth: "#/communities", event: "#/events", events: "#/communities", post: "#/home",
    topic: "#/explore", tag: "#/explore", trends: "#/explore", digest: "#/explore", shorts: "#/explore", clips: "#/explore", chat: "#/messages", chatinfo: "#/messages", newgroup: "#/messages",
    calls: "#/messages", e2ee: "#/messages", devices: "#/messages", follows: "#/me", list: "#/library", collection: "#/library", settings: "#/menu", me: "#/menu", u: "#/home",
    notifsettings: "#/notifications", nsettings: "#/notifications", admin: "#/menu", job: "#/jobs", course: "#/courses", exam: "#/exams", cert: "#/certificates", team: "#/teams",
    contract: "#/contracts", mentor: "#/mentors", campaign: "#/giving", organisation: "#/giving", opportunity: "#/giving", place: "#/nearby", city: "#/cities", kb: "#/knowledge", room: "#/rooms" };
  const LBL = { home: "الرئيسية", explore: "استكشف", communities: "المجتمعات", notifications: "الإشعارات", menu: "المزيد", messages: "الرسائل", me: "ملفك الشخصي" };
  const $ = (s) => document.querySelector(s);
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const seg = (h) => (h || "").replace(/^#\/?/, "").split("?")[0].split("/");
  const norm = (h) => (!h || h === "#" || h === "#/" ? "#/home" : h);
  const here = () => norm(location.hash);
  const key = (h = here()) => seg(h)[0] || "home";
  const isRoot = (h = here()) => { const s = seg(h); return TABS.includes(s[0] || "home") && !s[1] && !(h.split("?")[1] || "").includes("s="); };
  const defOwner = (r) => STRONG[r] || Object.keys(FAM).find((t) => FAM[t].includes(r)) || "menu";
  const ownerFor = (h, prev) => { const r = key(h); return TABS.includes(r) ? r : CONTEXTUAL.includes(r) ? prev || defOwner(r) : defOwner(r); };

  /* ---------- sprite: tab + bar icons (core; the hub's module icons come with the feat chunk) ---------- */
  const SQ = [[3, 3], [14, 3], [3, 14], [14, 14]]; // v2.53: Lucide «layout-grid» geometry
  const P = {
    menu: SQ.map(([x, y]) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5"/>`).join(""),
    menuF: SQ.map(([x, y]) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="currentColor"/>`).join(""),
    back: '<path d="m15 18-6-6 6-6"/>'
  };
  const sprite = document.querySelector("body > svg[aria-hidden]");
  if (sprite) sprite.insertAdjacentHTML("beforeend", Object.entries(P).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join(""));

  /* ---------- shell: top bar (back · title · avatar) + side-only links for the tablet/desktop rail ---------- */
  const bar = $(".topbar"), nav = $(".bottomnav"), view = $("#view");
  if (!bar || !nav || !view) return;
  bar.insertAdjacentHTML("afterbegin", `<button type="button" class="icon-btn tb-back" id="tbBack" aria-label="رجوع" hidden>${ic("back")}</button>`);
  $(".brand")?.insertAdjacentHTML("afterend", `<div class="tb-title" id="tbTitle" aria-hidden="true"></div>`);
  const acts = $(".top-actions");
  /* v2.61 CLS fix: the language button used to be added later by the lazy i18n chunk, at the avatar's side of the bar, so the avatar
   * jumped 46 px on the first screen after boot (often #/explore). Its 44 px slot now exists from the first paint; the i18n chunk
   * sees it and does not add a second one, and #/settings/language loads that chunk on demand. */
  if (acts && !acts.querySelector("#mp-lang-btn")) acts.insertAdjacentHTML("afterbegin", `<a href="#/settings/language" class="icon-btn" id="mp-lang-btn" title="اللغة" aria-label="اللغة">${ic("globe")}</a>`);
  /* v2.61 CLS fix: the page-help «؟» slot for screens without a page head (Home) is in the bar from the first paint, 44 px reserved
   * and invisible; the lazy help chunk only toggles it on/off (.on + data-help), so nothing beside it moves. Mobile keeps it
   * too (v2.61.1): the wordmark shrinks under 400 px to make room, so «؟» never floats over the screen. */
  /* v2.140: before sign-in/onboarding #/settings/language is gated, so 🌐 (and the welcome screen's language button) switch ar ⇄ en in place */
  document.addEventListener("click", (e) => {
    const g = e.target.closest?.("#mp-lang-btn,#ob-lang"); if (!g || !document.body.classList.contains("ob")) return;
    e.preventDefault(); e.stopPropagation();
    window.MPChunks?.load("i18n").then(() => window.MPI18n && MPI18n.setLang(MPI18n.current() === "en" ? "ar" : "en")).catch(() => { });
  }, true);
  if (acts && !acts.querySelector("#tbHelp")) acts.insertAdjacentHTML("afterbegin", `<button type="button" class="icon-btn hp-slot" id="tbHelp" tabindex="-1" aria-hidden="true" data-noi18n><span class="hp-q" aria-hidden="true">؟</span></button>`);
  acts?.insertAdjacentHTML("beforeend", `<a href="#/me" class="icon-btn tb-me" id="tbMe" aria-label="${LBL.me}" title="${LBL.me}"><span class="tb-av" aria-hidden="true"></span></a>`);
  const mt = nav.querySelector('a[data-r="menu"]');
  if (mt) {
    mt.insertAdjacentHTML("beforebegin", `<a href="#/messages" class="side-only" data-side="messages" aria-label="${LBL.messages}"><span>${ic("mail", "ic-off")}${ic("mail", "ic-on")}<i class="badge" id="msgBadgeSide"></i></span><small class="side-label">${LBL.messages}</small></a>` +
      `<a href="#/me" class="side-only" data-side="me" aria-label="${LBL.me}"><span>${ic("user", "ic-off")}${ic("userF", "ic-on")}</span><small class="side-label">حسابي</small></a>`);
  }
  const back = $("#tbBack"), title = $("#tbTitle"), me = $("#tbMe");
  back.onclick = () => MPNav.back();

  /* ---------- in-app history: [{ h: hash, y: scroll, o: owner tab }] in sessionStorage (survives reloads) ---------- */
  const SK = "mp.nav";
  let st; try { st = JSON.parse(sessionStorage.getItem(SK) || "null"); } catch { st = null; }
  if (!st || !Array.isArray(st.s) || !st.s.length || st.s[st.s.length - 1].h !== here()) st = { s: [{ h: here(), y: 0, o: ownerFor(here()) }] };
  const top = () => st.s[st.s.length - 1];
  const persist = () => { try { sessionStorage.setItem(SK, JSON.stringify({ s: st.s.slice(-60) })); } catch { /* private mode */ } };
  try { history.scrollRestoration = "manual"; } catch { /* old browser */ }
  let lastLen = history.length, lastAct = "boot", replacing = false, restoreT = 0, userMoved = false;

  function onHash(e) {
    const h = here(), old = e && e.oldURL ? norm("#" + (e.oldURL.split("#")[1] || "")) : null;
    if (old && top().h !== h) top().h = old; // a screen that rewrote its own URL (filters) keeps that URL in the stack
    const s = st.s, len = history.length;
    let dir;
    if (s.length > 1 && s[s.length - 2].h === h && !replacing) { s.pop(); dir = "pop"; }
    else if (top().h === h) dir = "same";
    else if (replacing || (len === lastLen && lastAct !== "pop")) { s[s.length - 1] = { h, y: 0, o: ownerFor(h, s.length > 1 ? s[s.length - 2].o : top().o) }; dir = "replace"; }
    else { s.push({ h, y: 0, o: ownerFor(h, top().o) }); dir = TABS.includes(key(h)) && isRoot(h) ? "tab" : "push"; }
    replacing = false; lastLen = len; lastAct = dir === "pop" ? "pop" : dir;
    view.dataset.nav = dir === "pop" ? "pop" : dir === "tab" ? "tab" : "push";
    persist(); showBars(); retries = 0; paint();
    if (dir === "pop") restore(top().y); else clearTimeout(restoreT); // new screens: route() already starts them at the top (no extra forced layout here)
  }
  /* back/forward restores where the reader was; async screens are waited for (up to 2.5 s) unless the user scrolls first */
  function restore(y) {
    clearTimeout(restoreT); userMoved = false; if (!y) return;
    const t0 = Date.now();
    const tick = () => {
      if (userMoved) return;
      const max = document.documentElement.scrollHeight - innerHeight;
      if (max >= y - 4) { scrollTo(0, y); if (Date.now() - t0 > 350) return; } else if (max > 0) scrollTo(0, max);
      if (Date.now() - t0 < 2500) restoreT = setTimeout(tick, 60);
    };
    tick();
  }
  ["touchstart", "wheel", "keydown"].forEach((ev) => addEventListener(ev, () => { userMoved = true; }, { passive: true }));

  /* ---------- top bar + tab state ---------- */
  let titleObs = null, watched = null;
  /* content screens whose first heading is not the screen's name (a post's first h2 is «التعليقات»): fixed title, watched element */
  const FIXED = { post: ["المنشور", ".post-card, article"] };
  function headingOf() { const f = FIXED[key()]; if (f) return view.querySelector(f[1]); return view.querySelector(".page-head h2") || view.querySelector(".wrap > h2, .wrap h2, h2"); }
  let retryT = 0, retries = 0;
  function paint() {
    const h = here(), r = key(h), root = isRoot(h), o = top().o || ownerFor(h);
    const ob = !(typeof DB !== "undefined" && DB.onboarded) || document.body.classList.contains("ob");
    document.body.classList.toggle("nav-deep", !root && !ob);
    document.body.classList.toggle("on-home", r === "home" && !ob); // v2.145 H2: thinner bar on Home (phones)
    back.hidden = root || ob;
    nav.querySelectorAll("a[data-r]").forEach((a) => { const on = a.dataset.r === o; a.classList.toggle("active", on); a.classList.toggle("owner", on && a.dataset.r !== r); });
    nav.querySelectorAll("a[data-side]").forEach((a) => a.classList.toggle("active", a.dataset.side === r && (r !== "me" || !seg(h)[1])));
    if (!back.hidden) { const p = parentOf(); const lbl = st.s.length > 1 ? "رجوع" : "رجوع إلى " + (labelFor(p) || "الصفحة السابقة"); if (back.dataset.src !== lbl) { back.setAttribute("aria-label", lbl); back.dataset.src = lbl; tr(back); } }
    // avatar of the signed-in member
    // v2.56: a signed-out visitor has a local placeholder profile — no avatar square (it showed a lone letter in a purple tile)
    try { const guest = window.MPSession?.state === "out", u = !guest && typeof S !== "undefined" && DB.me ? S.me() : null; const k = u ? (u.handle + "|" + (u.avatar ? (u.avatar["64"] || u.avatar["200"] || "") : "") + "|" + u.color) : "";
      if (me && me.dataset.k !== k) { me.dataset.k = k; me.hidden = !u; const sp = me.querySelector(".tb-av"); if (u) { sp.style.background = u.color || "var(--accent)"; sp.innerHTML = typeof avSrc === "function" && avSrc(u, "sm") ? `<img src="${esc(avSrc(u, "sm"))}" alt="" decoding="async">` : esc((u.name || "?")[0]); } } } catch { /* not signed in yet */ }
    me?.classList.toggle("on", r === "me" && !seg(h)[1]);
    setTitle(root ? "" : titleText());
    // a module that fills its screen deeper than the observed wrapper (e.g. a community page) — look again a few times
    clearTimeout(retryT); if (root || headingOf()) retries = 0; else if (retries < 8) retryT = setTimeout(() => { retries++; paint(); }, 250);
  }
  /* translate a shell node we just wrote (no-op in Arabic or before the i18n chunk has booted — its first pass covers it then) */
  function tr(el) { try { if (window.MPI18n && MPI18n.current() !== "ar") MPI18n.apply(el); } catch { /* i18n is optional */ } }
  function titleText() { const f = FIXED[key()]; if (f) return f[0]; const hd = headingOf(); return hd ? (window.UI ? UI.noEmo(hd.textContent.trim()) : hd.textContent.trim()) : (labelFor(here()) || ""); }
  function setTitle(t) {
    /* v2.144.1: compare with the source we last wrote, not the shown text — the i18n chunk turns «المنشور» into «Post», and
     * comparing the translated text with the Arabic source re-wrote it on every paint (retries, scroll) and left the title in
     * Arabic until the translator's next frame. Translate it now, in the same task, so it is never shown untranslated. */
    if (title.dataset.src !== t || (t && !title.firstChild)) { title.textContent = t; title.dataset.src = t; tr(title); }
    const hd = t ? headingOf() : null;
    if (hd === watched && (!hd || hd.isConnected)) return;
    if (titleObs) titleObs.disconnect(); watched = hd;
    if (!hd || !("IntersectionObserver" in window)) { bar.classList.toggle("titled", !!t); return; }
    bar.classList.remove("titled");
    titleObs = new IntersectionObserver((en) => { const x = en[en.length - 1]; if (!x.target.isConnected) return; bar.classList.toggle("titled", !x.isIntersecting && x.boundingClientRect.top < 80); }, { rootMargin: "-60px 0px 0px 0px" });
    titleObs.observe(hd);
  }
  function labelFor(h) {
    if (!h) return ""; const r = key(h);
    if (LBL[r] && isRoot(h)) return LBL[r];
    const it = window.MPMenu && MPMenu.find ? MPMenu.find(h) : null; if (it) return it.t;
    return LBL[r] || "";
  }
  function parentOf() {
    const h = here(), r = key(h), a = view.querySelector(".page-head a.back[href^='#/']");
    const p = a && norm(a.getAttribute("href"));
    if (p && p !== h) return p;
    if ((h.split("?")[1] || "").includes("s=") && r === "settings") return "#/settings";
    if (r === "admin" && seg(h)[1]) return "#/admin";
    return PARENT[r] || "#/" + (top().o || defOwner(r));
  }

  /* ---------- re-paint when a screen finishes rendering (async modules) — cheap, one frame ---------- */
  let raf = 0;
  let inner = null;
  const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; watchInner(); paint(); }); });
  /* #view itself plus its screen wrapper (async modules re-render inside .wrap) — not the whole subtree, so big screens pay nothing */
  function watchInner() { const w = view.firstElementChild; if (w === inner) return; mo.disconnect(); mo.observe(view, { childList: true }); inner = w; if (w) mo.observe(w, { childList: true }); }
  watchInner();
  const mb = $("#msgBadge"), ms = $("#msgBadgeSide");
  if (mb && ms) { const sync = () => { ms.textContent = mb.textContent; ms.classList.toggle("on", mb.classList.contains("on")); }; new MutationObserver(sync).observe(mb, { childList: true, attributes: true, characterData: true, subtree: true }); sync(); }

  /* ---------- tab bar: re-tap scrolls to the top ---------- */
  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='#/']"); if (!a) return;
    if (norm(a.getAttribute("href")) === here()) { e.preventDefault(); scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); showBars(); }
  });

  /* ---------- bars hide while reading down, come back on the way up (phones only) ---------- */
  let lastY = scrollY, saveT = 0;
  function showBars() { document.body.classList.remove("bars-off"); }
  addEventListener("scroll", () => {
    const y = scrollY, d = y - lastY; lastY = y;
    top().y = y; clearTimeout(saveT); saveT = setTimeout(persist, 250);
    if (watched && !watched.isConnected) paint(); // v2.53: the screen re-rendered its heading (a community page) — observe the new one
    if (innerWidth >= 760) return showBars();
    const busy = !$("#sheet")?.classList.contains("hidden") || document.body.classList.contains("composing") || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if (y < 80 || d < -6 || busy) showBars(); else if (d > 6 && y > 140) document.body.classList.add("bars-off");
  }, { passive: true });
  addEventListener("pagehide", persist);

  addEventListener("hashchange", onHash);
  addEventListener("mp:session", () => paint()); // signed in / out: the top-bar avatar follows

  window.MPNav = {
    tabs: TABS.slice(),
    /** back that never leaves the app: in-app history first, then the screen's logical parent (replacing this entry) */
    back() {
      if (st.s.length > 1 && history.length > 1) { history.back(); return "history"; }
      const p = parentOf(); replacing = true; location.replace(p); return p;
    },
    parentOf, ownerOf: () => top().o, isRoot, stack: () => st.s.map((x) => ({ ...x })),
    title: titleText, paint, version: "2.53"
  };
  paint();
})();
