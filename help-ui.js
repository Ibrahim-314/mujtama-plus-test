/* مجتمع بلس — page help «؟» (v2.61, lazy chunk "help" + help.css; content in help-content.js, chunk "helpcontent").
 * Every page head (UI.pageHead → header.page-head, or a hand-built .page-head) gets a small «؟» button next to its title when
 * the registry has an entry for the current route (also the hand-built heads .nf-head / .cm-head); screens without a page head
 * (Home, Explore) get it in the reserved top-bar slot #tbHelp — on mobile too since v2.61.1 (the wordmark shrinks under 400 px to
 * make room); the overlay row (.hp-strip) is only a last-resort fallback when the bar has no room.
 * v2.137: the icon is a small round «i» and opens a small bubble with an arrow (dark on light, light on dark) on every screen size;
 * the 7 main tabs (Home, Explore, Communities, Messages, Notifications, More, my profile) and Vidtik, voice rooms, «فاتك اليوم» show no icon — inner pages only.
 * (Before v2.137 it opened a bottom sheet on mobile / a popover on desktop:)
 * a popover anchored to the button on desktop (≥ 720 px). Both are modal dialogs with a focus trap; Esc and the close button
 * return focus to «؟». Text is in the interface language (ar/en; v2.67 retired fr/ur → en) with Arabic fallback, and it is never re-translated
 * by the i18n DOM walk (data-noi18n). No entry for the route → no icon.
 * Entries may carry a `section` (see help-content.js): the inner section on screen picks among same-route entries (sectionOf).
 * en text is a separate lazy chunk per language (help-content-<lang>.js), merged on first use in that language.
 * Public: window.MPHelp = { match, entryFor, sectionOf, open, close, decorate, ensureLang }. */
(function PageHelp() {
  const RTL = { ar: 1 };
  const UIT = {
    ar: { btn: "كيف تعمل هذه الصفحة؟", tips: "نصائح", close: "إغلاق", ok: "فهمت" },
    en: { btn: "How does this page work?", tips: "Tips", close: "Close", ok: "Got it" }
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* ---------- registry matching (pure; unit-tested) ---------- */
  const norm = (h) => { let p = String(h || "").split("?")[0].replace(/^#?\/?/, ""); p = p.replace(/\/+$/, ""); return "#/" + (p || "home"); };
  /** score a pattern against a normalised path; -1 = no match. Higher = more specific. */
  function score(pat, path) {
    const prefix = /\/$/.test(pat) && pat !== "#/", ps = norm(pat).slice(2).split("/"), xs = path.slice(2).split("/");
    let s = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === "*" && i === ps.length - 1) return xs.length > i ? s * 4 + 1 : -1;
      if (i >= xs.length) return -1;
      if (p.startsWith(":")) { if (!xs[i]) return -1; s += 1; } else if (p === xs[i]) s += 3; else return -1;
    }
    if (xs.length === ps.length) return s * 4 + 3;
    return prefix ? s * 4 + 2 : -1;
  }
  /** an entry's section: its own field, or "?tab=<key>" written on its route ("#/studio?tab=calendar") */
  const secOf = (e) => e.section || (/[?&]tab=([\w-]+)/.exec(e.route) || [])[1] || "";
  /** best entry for a hash; with `section`, among equally specific routes the entry for that section wins, then a section-less
   * one, then any (so an unknown ?s= still gets the page's help) — "most specific wins" */
  function match(hash, list, section = "") {
    const path = norm(hash); let best = null, bs = -1;
    for (const e of list || []) {
      if (!e || !e.route || !e.title) continue;
      const sec = secOf(e), bonus = !sec ? 0.25 : sec === section ? 0.5 : 0;
      for (const pat of [e.route, ...(Array.isArray(e.aliases) ? e.aliases : [])]) { const s0 = score(pat, path); if (s0 < 0) continue; const s = s0 + (pat === e.route ? bonus : 0.25); if (s > bs) { bs = s; best = e; } }
    }
    return best;
  }
  /** the inner section a page is showing (pure; `st` = view state: _ctab, _cch, _stab):
   *  #/cadmin/:id → ?s= (home) · #/c/:id → the active tab, "channels" when a channel is open on the posts tab · #/studio → studio tab
   *  · anything else → ?tab= */
  function sectionOf(hash, st = {}) {
    const path = norm(hash), q = new URLSearchParams(String(hash || "").split("?")[1] || "");
    if (/^#\/cadmin\/[^/]+$/.test(path)) return q.get("s") || "home";
    if (/^#\/c\/[^/]+$/.test(path)) { const t = st._ctab || "posts", id = path.split("/")[2]; return t === "posts" && st._cch && st._cch[id] ? "channels" : t; }
    if (path === "#/studio") return st._stab || q.get("tab") || ""; // no tab picked yet → the page-wide studio entry
    return q.get("tab") || "";
  }
  /** v2.137: the main tabs carry no help icon (user's call) — Home, Explore, Communities, Messages, Notifications, More, my profile + Vidtik, voice rooms, «فاتك اليوم» (user, 2026-10-29) */
  const MAIN = new Set(["#/home", "#/explore", "#/communities", "#/messages", "#/notifications", "#/menu", "#/me", "#/profile", "#/clips", "#/shorts", "#/rooms", "#/digest"]);
  function isMain(hash, myHandle) {
    const path = norm(hash); if (MAIN.has(path)) return true;
    const m = /^#\/u\/([^/]+)$/.exec(path); return !!(m && myHandle && decodeURIComponent(m[1]).replace(/^@/, "").toLowerCase() === String(myHandle).toLowerCase());
  }
  /** one field in language L, falling back to Arabic: { text, lang } */
  const pick = (f, L) => (f && f[L] != null && f[L] !== "" && !(Array.isArray(f[L]) && !f[L].length) ? { v: f[L], lang: L } : { v: f ? f.ar : null, lang: "ar" });
  const lines = (v) => (Array.isArray(v) ? v : String(v ?? "").split("\n")).map((x) => String(x).trim()).filter(Boolean);
  /** fold one language file ({ "route|section": {title, body, tips} }) into the Arabic registry */
  function merge(list, L, map) {
    for (const e of list || []) { const t = map && map[e.route + "|" + (e.section || "")]; if (!t) continue; for (const f of ["title", "body", "tips"]) if (t[f] != null) (e[f] ||= {})[L] = t[f]; }
    return list;
  }
  const curLang = () => { const l = (typeof DB !== "undefined" && DB.settings && DB.settings.lang) || document.documentElement.lang || "ar"; const n = l === "fr" || l === "ur" ? "en" : l; return UIT[n] ? n : "ar"; };
  const T = () => UIT[curLang()];

  if (typeof module !== "undefined" && module.exports && typeof document === "undefined") { module.exports = { match, norm, lines, pick, sectionOf, merge, isMain }; return; }

  const list = () => window.MPHelpContent || [];
  const myHandle = () => { try { const u = typeof DB !== "undefined" && (DB.users || []).find((x) => x.id === DB.me); return u ? u.handle : ""; } catch { return ""; } };
  const entryFor = (hash = location.hash) => (isMain(hash, myHandle()) ? null : match(hash, list(), sectionOf(hash, document.getElementById("view") || {})));
  /* en text lives in its own lazy chunk ("helpcontent-<lang>"), merged once; Arabic is always present (fallback) */
  const merged = { ar: true }, langPend = {};
  function ensureLang(L = curLang()) {
    if (merged[L]) return Promise.resolve();
    const fold = () => { const m = (window.MPHelpContentL || {})[L]; if (m) { merge(list(), L, m); merged[L] = true; } };
    fold(); if (merged[L]) return Promise.resolve();
    return (langPend[L] ||= (window.MPChunks ? MPChunks.load("helpcontent-" + L) : Promise.resolve()).catch(() => { }).then(() => { fold(); delete langPend[L]; }));
  }

  /* ---------- the «؟» button ---------- */
  const glyph = () => "i"; // v2.137: the small round «i» (same in every language)
  const btnHtml = (top) => `<button type="button" class="hp-btn${top ? " icon-btn hp-top" : ""}" data-help aria-expanded="false" aria-label="${esc(T().btn)}" title="${esc(T().btn)}" data-noi18n><span class="hp-q" aria-hidden="true">${glyph()}</span></button>`;
  /* the top-bar «؟» is a slot nav.js reserves from the first paint (#tbHelp): turned on/off here, never inserted or removed, so the
   * bar never shifts (CLS 0). Off = invisible, unfocusable, no data-help. */
  const slotEl = () => document.getElementById("tbHelp");
  function setSlot(on) {
    const b = slotEl(); if (!b) return;
    if (!on) { if (!b.classList.contains("on")) return; b.classList.remove("on", "hp-btn", "hp-top"); b.removeAttribute("data-help"); b.removeAttribute("aria-haspopup"); b.removeAttribute("aria-expanded"); b.removeAttribute("aria-label"); b.removeAttribute("title"); b.setAttribute("aria-hidden", "true"); b.tabIndex = -1; return; }
    b.classList.add("on", "hp-btn", "hp-top"); b.setAttribute("data-help", ""); if (!b.hasAttribute("aria-expanded")) b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-label", T().btn); b.title = T().btn; b.removeAttribute("aria-hidden"); b.removeAttribute("tabindex");
    const q = b.querySelector(".hp-q"); if (q && q.textContent !== glyph()) q.textContent = glyph();
  }
  let lastKey = "";
  function decorate() {
    const v = document.getElementById("view"); if (!v) return;
    // page heads: UI.pageHead / .page-head, and the hand-built heads of Notifications (.nf-head) and Messages (.cm-head)
    const e = entryFor(), heads = [...v.querySelectorAll(".page-head, .nf-head, .cm-head")], top = document.querySelector(".topbar .top-actions");
    // a page with several heads (e.g. a hosted sub-screen) gets one icon, on its first head
    const head = heads.find((hd) => hd.querySelector("h2")) || null;
    const key = location.hash.split("?")[0] + "|" + curLang();
    const slot = slotEl(), onTop = () => !!(slot && slot.classList.contains("on"));
    if (!e) { v.querySelectorAll(".hp-strip, [data-help]").forEach((b) => b.remove()); setSlot(false); lastKey = key; return; }
    if (head) {
      setSlot(false); v.querySelector(".hp-strip")?.remove();
      const have = head.querySelector("[data-help]");
      if (have && lastKey === key) return;
      have?.remove();
      // .page-head: «؟» + title are one no-wrap group (.hp-has); .nf-head/.cm-head are already a flex row with their own icons at the
      // far end: «؟» sits right after the title (.hp-inl) and the icons stay where they were (no shift, no overlap)
      const h2 = head.querySelector("h2"), inl = !head.classList.contains("page-head") && h2.parentElement === head;
      (inl ? head : h2.parentElement).classList.add(inl ? "hp-inl" : "hp-has"); h2.insertAdjacentHTML("afterend", btnHtml(false));
    } else {
      // no page head (Home, legacy screens): the reserved top-bar slot when the bar shows it (desktop), else the overlay row
      if ((onTop() || v.querySelector(".hp-strip")) && lastKey === key) return;
      let ok = false;
      if (slot && top && getComputedStyle(slot).display !== "none") {
        const bar = top.closest(".topbar"), r = slot.getBoundingClientRect();
        ok = r.width > 0 && r.left >= 0 && r.right <= innerWidth && (!bar || bar.scrollWidth <= bar.clientWidth + 1);
      }
      setSlot(ok);
      if (ok) v.querySelector(".hp-strip")?.remove();
      else if (!v.querySelector(".hp-strip") || lastKey !== key) { v.querySelector(".hp-strip")?.remove(); (v.querySelector(".wrap") || v).insertAdjacentHTML("afterbegin", `<div class="hp-strip">${btnHtml(false)}</div>`); }
    }
    lastKey = key;
  }

  /* ---------- the bubble (v2.137): a small dark toggletip with an arrow under «i», same on phone and desktop ----------
   * Light theme: dark bubble; dark theme: light bubble. Tap «i» again, tap outside, or Esc closes it. Non-modal: the page stays usable. */
  let openFrom = null, pop = null;
  function content(e) {
    const L = curLang(), t = pick(e.title, L), b = pick(e.body, L), tp = pick(e.tips, L);
    const dirOf = (l) => (RTL[l] ? "rtl" : "ltr"), body = lines(b.v).slice(0, 4), tips = lines(tp.v).slice(0, 3);
    return `<span class="hp-sr" id="hp-t" lang="${t.lang}">${esc(t.v)}</span>
      <div class="hp-body" lang="${b.lang}" dir="${dirOf(b.lang)}">${body.map((x) => `<p>${esc(x)}</p>`).join("")}</div>
      ${tips.length ? `<ul class="hp-tips" lang="${tp.lang}" dir="${dirOf(tp.lang)}" aria-label="${esc(T().tips)}">${tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
  }
  function onKey(ev) { if (ev.key === "Escape" && pop) { ev.preventDefault(); ev.stopPropagation(); close(); } }
  function open(btn) {
    if (!merged[curLang()]) { ensureLang().then(() => open(btn)); return; }
    const e = entryFor(); if (!e || !btn) return;
    close(true); openFrom = btn; btn.setAttribute("aria-expanded", "true");
    pop = document.createElement("div"); pop.className = "hp-pop"; pop.id = "hp-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-labelledby", "hp-t"); pop.tabIndex = -1;
    pop.dir = document.documentElement.dir || "rtl"; pop.setAttribute("data-noi18n", ""); pop.innerHTML = content(e) + `<span class="hp-arrow" aria-hidden="true"></span>`;
    document.body.appendChild(pop); btn.setAttribute("aria-controls", "hp-pop"); place();
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    document.addEventListener("keydown", onKey, true); addEventListener("resize", place); addEventListener("scroll", place, { passive: true });
    pop.focus({ preventScroll: true });
  }
  /* focus goes back to «i»; a screen may re-render while the bubble is open, so the new button (re-added by decorate) takes it */
  function refocus(b) {
    if (b?.isConnected) { b.focus({ preventScroll: true }); return; }
    setTimeout(() => { const cur = document.querySelector("#view [data-help], .topbar [data-help]"); const a = document.activeElement; if (cur && !pop && (!a || a === document.body)) cur.focus({ preventScroll: true }); }, 150);
  }
  function place() {
    if (!pop || !openFrom) return;
    if (!openFrom.isConnected) { close(true); return; }
    const r = openFrom.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, cx = r.left + r.width / 2;
    let x = Math.max(12, Math.min(cx - w / 2, innerWidth - w - 12));
    let y = r.bottom - 6, up = false; if (y + h + 8 > innerHeight - 12 && r.top - h > 12) { y = r.top - h + 6; up = true; }
    pop.classList.toggle("up", up);
    pop.style.setProperty("--hp-x", x + "px"); pop.style.setProperty("--hp-y", y + "px"); pop.style.setProperty("--hp-ax", Math.max(14, Math.min(cx - x, w - 14)) + "px");
  }
  function outside(ev) { if (pop && !pop.contains(ev.target) && !(openFrom && openFrom.contains(ev.target))) close(); }
  function close(silent) {
    if (!pop) return;
    pop.remove(); pop = null; document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", onKey, true); removeEventListener("resize", place); removeEventListener("scroll", place);
    const b = openFrom; openFrom = null; b?.setAttribute("aria-expanded", "false"); if (!silent) refocus(b);
  }

  document.addEventListener("click", (ev) => { const b = ev.target.closest?.("[data-help]"); if (!b) return; ev.preventDefault(); if (pop && openFrom === b) close(); else open(b); });
  let raf = 0; const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; decorate(); }); };
  const v = document.getElementById("view"); if (v) new MutationObserver(soon).observe(v, { childList: true, subtree: true });
  addEventListener("hashchange", () => { close(true); soon(); });
  // the language can change without a route change (#/settings/language): redraw the button label/glyph
  new MutationObserver(() => { lastKey = ""; ensureLang(); soon(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });

  const ready = () => { window.MPHelp = { match, entryFor, sectionOf, isMain, open, close, decorate, ensureLang }; decorate(); ensureLang(); };
  if (window.MPHelpContent) ready();
  else if (window.MPChunks) MPChunks.load("helpcontent").then(ready, () => { window.MPHelpContent = window.MPHelpContent || []; ready(); });
  else ready();
})();
