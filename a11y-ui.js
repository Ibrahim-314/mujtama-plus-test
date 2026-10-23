/* Full accessibility (phase 43). Lazy chunk `a11y`, loaded right after first paint for everyone (free).
 * • Display settings #/settings/display: font scale, high contrast, dyslexia mode (wider spacing, no letter-spacing on
 *   Arabic so letters stay joined), line/word spacing, motion, link underline, strong focus ring, captions by default,
 *   alt-text reminder. Stored locally (mp_a11y + generated CSS in mp_a11yCss, applied by a tiny snippet in platform.js
 *   before first paint) and on the server (/api/me/a11y, keys a11y.*) when signed in.
 * • Screen reader + keyboard: skip link, landmark labels, focus moved to the new page heading after navigation with an
 *   announcement, sheets as modal dialogs (focus trap, Escape, focus restored), names for icon/emoji buttons, image
 *   backgrounds exposed as role=img with alt text (user / auto / heuristic from /api/a11y/alt), poll options as buttons,
 *   j/k to move between posts.
 * • Alt-text editor on your own images, WebVTT caption editor on your own videos (#/a11y/captions/:mediaId).
 * • #/admin/a11y: periodic audit runs (server check + CI axe reports). No inline handlers (CSP). */
(function A11YUI() {
  const H = document.documentElement;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const online = () => typeof Remote !== "undefined" && Remote.on;
  const signed = () => online() && typeof DB !== "undefined" && DB.me && (!window.MPSession || MPSession.signedIn()); // v2.51: guests never call /api/me/a11y
  const api = (m, p, b) => Remote.api(m, p, b);
  const pref = (k, d) => (window.MP?.pref ? MP.pref(k, d) : d);
  const setPref = (k, v) => window.MP?.setPref?.(k, v);
  const DEF = { fontScale: 1, contrast: "normal", dyslexia: false, spacing: "normal", motion: "system", underlineLinks: false, focusRing: "normal", captions: false, altReminder: true };
  let P = { ...DEF, ...(pref("a11y", null) || {}) };

  /* ---------- CSS: base a11y helpers (always) + the user's display settings ---------- */
  const BASE = `.mp-skip{position:fixed;top:-60px;inset-inline-start:8px;z-index:9999;background:var(--text);color:var(--bg);padding:10px 16px;border-radius:10px;font-weight:700;text-decoration:none}
.mp-skip:focus{top:8px}.mp-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}#view:focus,[data-a11y-focus]:focus{outline:none}
.mp-a11y-f fieldset{border:0;border-top:1px solid var(--line);padding:var(--s3) 0 var(--s2);margin:0}.mp-a11y-f fieldset:first-child{border:0;padding-top:0}.mp-a11y-f legend{font-weight:700;font-size:var(--fs-lg);padding:var(--s3) 0 0;float:left;width:100%}.mp-a11y-f legend+*{clear:both}
.mp-a11y-f label{display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer}.mp-a11y-h{display:block;font-size:var(--fs-xs)}.mp-a11y-sh{margin:var(--s3) 0 0;font-weight:700;font-size:var(--fs-sm);color:var(--text-2)}.mp-a11y-f input[type=range]{width:100%}
.mp-a11y-prev{border:1px dashed var(--line-2,var(--line));border-radius:12px;padding:12px;margin:10px 0}.mp-alt-b{position:absolute;inset-inline-start:8px;bottom:8px;background:#000c;color:#fff;border:0;border-radius:6px;font:700 12px/1 system-ui;padding:5px 7px;cursor:pointer}
.mp-vtt{width:100%;min-height:180px;font:13px/1.5 ui-monospace,monospace;direction:ltr}.mp-a11y-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}`;
  function css(p) {
    const out = [];
    if (p.fontScale && p.fontScale !== 1) out.push(`body{zoom:${p.fontScale}}`);
    // high contrast must win over phase-44 palettes/OLED (html:root:root…, up to 0,3,1): 4× :root keeps these rules above them
    // v2.69.1: muted text inside gradient cards and the pressed filter chip stay readable under high contrast (light or dark)
    if (p.contrast === "high") out.push(`html:root:root:root:root #view [style*=gradient] :is(small,.muted,.sub){color:inherit!important}#view .lc-chips button[aria-pressed=true]{background:#3a00b8;border-color:#3a00b8;color:#fff}`);
    if (p.contrast === "high") out.push(`html:root:root:root:root{--bg:#fff;--bg-2:#fff;--card:#fff;--elev:#fff;--text:#000;--text-2:#000;--muted:#1d1d1d;--line:#000;--line-2:#000;--accent:#3a00b8;--accent2:#fff;--accent-ink:#2a0090;--glass:#fff;--sh-1:0 0 0 1px #000;--sh-2:0 0 0 2px #000;--sh-3:0 0 0 2px #000;color-scheme:light}
@media (prefers-color-scheme:dark){html:root:root:root:root:not([data-theme=light]){--bg:#000;--bg-2:#000;--card:#000;--elev:#000;--text:#fff;--text-2:#fff;--muted:#e6e6e6;--line:#fff;--line-2:#fff;--accent:#d9c9ff;--accent2:#000;--accent-ink:#efe6ff;--glass:#000;--sh-1:0 0 0 1px #fff;--sh-2:0 0 0 2px #fff;--sh-3:0 0 0 2px #fff;color-scheme:dark}}
html:root:root:root:root[data-theme=dark]{--bg:#000;--bg-2:#000;--card:#000;--elev:#000;--text:#fff;--text-2:#fff;--muted:#e6e6e6;--line:#fff;--line-2:#fff;--accent:#d9c9ff;--accent2:#000;--accent-ink:#efe6ff;--glass:#000;color-scheme:dark}
.card,.btn,input,textarea,select,.tab,.chip{border:1px solid var(--text)!important}*{text-shadow:none!important}.btn:not(.ghost){background:var(--accent)!important;color:var(--bg)!important}.muted,small{color:var(--muted)!important}`);
    const sp = Math.max(p.dyslexia ? 1 : 0, p.spacing === "wider" ? 2 : p.spacing === "wide" ? 1 : 0); // dyslexia mode implies at least wide spacing
    if (sp) out.push(`#view,.sheet{line-height:${sp === 2 ? 2 : 1.8}!important;word-spacing:${sp === 2 ? ".22em" : ".12em"}}#view p,#view .body,.sheet p{margin-bottom:${sp === 2 ? "1em" : ".7em"}}`);
    if (p.dyslexia) out.push(`#view,.sheet{text-align:start!important;font-weight:500}#view .body,#view p{max-width:62ch;hyphens:none}
#view :is(i,em){font-style:normal}[dir=ltr] #view,#view [dir=ltr],#view :lang(en),#view :lang(fr){letter-spacing:.06em;font-family:"Atkinson Hyperlegible","OpenDyslexic",Verdana,Tahoma,sans-serif}
#view .body,#view p,.sheet p{background:color-mix(in srgb,var(--card) 92%,#f5e9c8)}#view :is(.f-cover,[class*=hero],[class*=banner],[class*=cover],.notice,.btn,.toast,[style*=gradient],[style*=background]) :is(p,.body){background:none} /* v2.69.1: paper tint never sits under white text in coloured cards */`);
    const reduce = `*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}`;
    if (p.motion === "reduce") out.push(reduce); else if (p.motion === "system") out.push(`@media (prefers-reduced-motion:reduce){${reduce}}`);
    if (p.underlineLinks) out.push(`#view a:not(.btn):not(.tab):not(.chip):not(.card),.sheet a:not(.btn){text-decoration:underline!important;text-underline-offset:3px}`);
    if (p.focusRing === "strong") out.push(`:focus-visible{outline:3px solid #ffbf00!important;outline-offset:2px!important;box-shadow:0 0 0 6px #000!important;border-radius:4px}`);
    return out.join("\n");
  }
  function apply(p, persist = true) {
    P = { ...DEF, ...p };
    const c = css(P);
    let el = document.getElementById("a11yCss");
    if (!el) { el = document.createElement("style"); el.id = "a11yCss"; document.head.appendChild(el); }
    el.textContent = c;
    H.dataset.a11y = [P.contrast === "high" && "contrast", P.dyslexia && "dyslexia", P.spacing !== "normal" && "spacing-" + P.spacing, P.fontScale !== 1 && "scaled", P.motion === "reduce" && "reduce-motion", P.underlineLinks && "underline", P.focusRing === "strong" && "focus"].filter(Boolean).join(" ");
    if (!H.dataset.a11y) delete H.dataset.a11y;
    if (persist) { setPref("a11y", diff(P)); try { if (c && Object.keys(diff(P)).length) localStorage.setItem("mp_a11yCss", c); else localStorage.removeItem("mp_a11yCss"); } catch { /* private mode */ } }
    document.querySelectorAll("video").forEach(capMode);
  }
  const diff = (p) => { const o = {}; for (const k in DEF) if (p[k] !== DEF[k]) o[k] = p[k]; return o; };
  const base = document.createElement("style"); base.textContent = BASE; document.head.appendChild(base);
  apply(P, true);
  let dirty = !!pref("a11yDirty", false);
  let synced = false, tries = 0;
  async function syncServer() {
    if (synced || !online()) return;
    if (!signed()) { if (window.MPSession) { if (MPSession.state !== "out" && ++tries < 20) setTimeout(syncServer, 500); MPSession.whenIn(syncServer); return; } if (++tries < 20) setTimeout(syncServer, 500); return; } // bootstrap still loading; v2.51: or a guest → sync once signed in
    synced = true;
    try {
      if (dirty) { await api("PUT", "/api/me/a11y", { prefs: P }); dirty = false; setPref("a11yDirty", false); return; }
      const r = await api("GET", "/api/me/a11y"); if (r?.prefs) apply(r.prefs);
    } catch { /* offline: keep local */ }
  }
  async function save(patch) {
    apply({ ...P, ...patch });
    dirty = true; setPref("a11yDirty", true);
    if (signed()) { try { const r = await api("PUT", "/api/me/a11y", { prefs: patch }); dirty = false; setPref("a11yDirty", false); if (r?.prefs) P = { ...DEF, ...r.prefs }; } catch { /* retried on next load */ } }
  }

  /* ---------- live region + skip link + landmarks ---------- */
  const live = document.createElement("div"); live.className = "mp-sr"; live.setAttribute("aria-live", "polite"); live.setAttribute("role", "status"); live.id = "mp-a11y-live";
  document.body.appendChild(live);
  const say = (t) => { live.textContent = ""; setTimeout(() => { live.textContent = t; }, 60); };
  const view = document.getElementById("view");
  if (!document.querySelector(".mp-skip")) {
    const a = document.createElement("a"); a.className = "mp-skip"; a.href = "#view"; a.textContent = "تخطَّ إلى المحتوى";
    a.addEventListener("click", (e) => { e.preventDefault(); focusMain(true); });
    document.body.insertBefore(a, document.body.firstChild);
  }
  if (view) { view.setAttribute("tabindex", "-1"); if (!view.getAttribute("aria-label")) view.setAttribute("aria-label", "المحتوى"); }
  const nav = document.querySelector(".bottomnav"); if (nav && !nav.getAttribute("aria-label")) nav.setAttribute("aria-label", "التنقل الرئيسي");
  const top = document.querySelector(".top-actions"); if (top && !top.getAttribute("role")) { top.setAttribute("role", "navigation"); top.setAttribute("aria-label", "اختصارات"); }
  const toastEl = document.getElementById("toast"); if (toastEl) { toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite"); }
  function focusMain(force) {
    if (!view) return;
    const h = view.querySelector("h1, h2");
    const t = h || view;
    if (h) { h.setAttribute("tabindex", "-1"); h.setAttribute("data-a11y-focus", ""); }
    try { t.focus({ preventScroll: !force }); } catch { /* old browser */ }
  }
  /* the skip link is the first tab stop whenever focus is lost (on <body>): after a click removes the focused node or a page
   * re-renders, Chromium keeps a stale sequential-focus starting point inside the old view, so Tab skipped the link */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae !== document.documentElement) return;
    const sh = document.getElementById("sheet");
    if ((sh && !sh.classList.contains("hidden")) || document.querySelector("body > [role=dialog][aria-modal=true]:not(#sheet)")) return;
    const sk = document.querySelector(".mp-skip"); if (!sk) return;
    e.preventDefault(); sk.focus();
  }, true);
  function markNav() {
    const r = (location.hash.split("/")[1] || "home").split("?")[0];
    document.querySelectorAll(".bottomnav a[data-r]").forEach((a) => { if (a.dataset.r === r) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  /* after navigation: when focus was lost (body / removed node / inside the old view) move it to the new heading and announce it */
  let navAt = 0;
  addEventListener("hashchange", () => { navAt = Date.now(); markNav(); });
  function afterRender() {
    if (!navAt || Date.now() - navAt > 4000) return;
    const ae = document.activeElement;
    const lost = !ae || ae === document.body || !ae.isConnected || (view && view.contains(ae) && ae !== view);
    const sheetOpen = !document.getElementById("sheet")?.classList.contains("hidden");
    if (sheetOpen) return;
    const h = view?.querySelector("h1, h2"); if (!h && view?.querySelector(".skel")) return; // still loading
    navAt = 0;
    if (lost) focusMain(false);
    const name = (h?.textContent || "").trim().slice(0, 80);
    if (name) { say("صفحة " + name); document.title = name + " · مجتمع بلس"; } else document.title = "مجتمع بلس";
    const h1 = document.getElementById("pg-h1"); if (h1) h1.textContent = name || "مجتمع بلس";
  }

  /* ---------- names, roles and keyboard for core markup (small, idempotent fixes) ---------- */
  const ACT = { react: "إعجاب", go: "التعليقات", share: "إعادة النشر", save: "حفظ", more: "خيارات المنشور" };
  const altQ = new Map(); let altT = 0;
  const altCache = new Map();
  function label(root) {
    root.querySelectorAll(".post-head").forEach((h) => {
      const card = h.parentElement?.closest(".card") || h.parentElement; if (!card || card.getAttribute("role")) return;
      card.setAttribute("role", "article"); card.setAttribute("tabindex", "-1"); card.dataset.a11yFocus = "";
      const n = h.querySelector(".name")?.textContent?.trim(); if (n) card.setAttribute("aria-label", "منشور من " + n);
    });
    root.querySelectorAll("button:not([aria-label])").forEach((b) => {
      const k = Object.keys(ACT).find((x) => b.hasAttribute("data-" + x));
      const txt = (b.textContent || "").replace(/\p{Extended_Pictographic}|\uFE0F|\u200d|[⋯✎＋]/gu, "").trim();
      if (k) {
        const n = txt.replace(/\D/g, "");
        let l = ACT[k];
        if (k === "save" && b.classList.contains("on")) l = "إزالة من المحفوظات";
        b.setAttribute("aria-label", l + (n ? "، " + n : ""));
        if (k === "react" || k === "save") b.setAttribute("aria-pressed", b.classList.contains("on") ? "true" : "false");
      } else if (!txt) { const t = b.getAttribute("title"); if (t) b.setAttribute("aria-label", t); }
    });
    root.querySelectorAll("a.icon-btn:not([aria-label]), a[title]:not([aria-label])").forEach((a) => { if (!(a.textContent || "").replace(/\p{Extended_Pictographic}|\uFE0F/gu, "").trim() && a.title) a.setAttribute("aria-label", a.title.trim()); });
    root.querySelectorAll("input:not([type=hidden]):not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby]), select:not([aria-label]):not([aria-labelledby])").forEach((i) => {
      if (i.labels?.length || i.title) return;
      const p = i.getAttribute("placeholder") || (i.tagName === "SELECT" ? i.options?.[0]?.textContent : ""); if (p) i.setAttribute("aria-label", p.trim());
    });
    root.querySelectorAll(".opt[data-vote]:not([role])").forEach((o) => { o.setAttribute("role", "button"); o.setAttribute("tabindex", "0"); });
    root.querySelectorAll(".bottomnav span:first-child, .top-actions a > :not(.badge)").forEach((s) => { if (s.tagName === "SPAN" && /^\p{Extended_Pictographic}/u.test(s.textContent || "")) s.setAttribute("aria-hidden", "true"); });
    // media backgrounds: decorative gradients are hidden; uploaded images get role=img + alt text
    root.querySelectorAll(".media:not([data-a11y-m])").forEach((m) => {
      const st = m.getAttribute("style") || "", mm = /\/media\/(md_[\w]+)\.[a-z0-9]+/i.exec(st);
      if (!mm) { if (/gradient|^\s*background:\s*#/.test(st)) { m.dataset.a11yM = "1"; m.setAttribute("aria-hidden", "true"); } return; } // lazy images get their url later
      m.dataset.a11yM = "1"; m.removeAttribute("aria-hidden");
      m.setAttribute("role", "img"); m.dataset.mid = mm[1];
      const card = m.closest("[role=article]") || m.closest(".card");
      const txt = (card?.querySelector(".body")?.textContent || "").trim().split(/[.!؟?\n]/)[0].slice(0, 100);
      m.setAttribute("aria-label", altCache.get(mm[1]) || (txt ? "صورة: " + txt : "صورة"));
      if (online()) { altQ.set(mm[1], true); clearTimeout(altT); altT = setTimeout(fetchAlts, 120); }
    });
    ownerTries = 0; ownerAlt(root);
    root.querySelectorAll("img:not([alt])").forEach((i) => i.setAttribute("alt", ""));
    root.querySelectorAll('img[alt=""][src*="/media/md_"]:not([data-mid])').forEach((i) => { const mm = /\/media\/(md_[\w]+)\./.exec(i.getAttribute("src") || ""); if (!mm) return; i.dataset.mid = mm[1]; if (online()) { altQ.set(mm[1], true); clearTimeout(altT); altT = setTimeout(fetchAlts, 120); } });
    root.querySelectorAll("video:not([data-a11y-v])").forEach((v) => { v.dataset.a11yV = "1"; capMode(v); v.addEventListener("loadedmetadata", () => capMode(v)); });
    root.querySelectorAll("[data-video]:not([data-a11y-cc])").forEach((w) => {
      w.dataset.a11yCc = "1"; const card = w.closest(".card");
      if (!signed() || !card || !isMine(card)) return;
      const pid = w.dataset.video, p = typeof S !== "undefined" ? S.post(pid) : null, mid = p?.video?.mediaId;
      if (!mid) return;
      const a = document.createElement("a"); a.className = "btn ghost"; a.href = "#/a11y/captions/" + mid; a.textContent = "الترجمة النصية (CC)";
      a.style.marginTop = "6px"; w.insertAdjacentElement("afterend", a);
    });
  }
  // v2.52: the owner check is its own pass (not tied to the once-only media marker) and retries briefly
  // when the session/me record isn't known yet on first paint, so the post owner always gets the ALT editor
  let ownerT = 0, ownerTries = 0;
  function ownerAlt(root) {
    const ms = [...root.querySelectorAll(".media[role=img][data-mid]")].filter((m) => !m.querySelector(".mp-alt-b"));
    if (!ms.length) return;
    const me = signed() && typeof S !== "undefined" ? S.user(DB.me) : null;
    if (!me) { if (online() && ownerTries < 40 && !ownerT) ownerT = setTimeout(() => { ownerT = 0; ownerTries++; ownerAlt(document.getElementById("view") || document.body); }, 250); return; }
    ownerTries = 0;
    ms.forEach((m) => { const card = m.closest("[role=article]") || m.closest(".card"); if (card && isMine(card)) addAltButton(m, m.dataset.mid); });
  }
  // the session can turn "in" after the post is already painted (no DOM change follows) — re-check the owner then
  addEventListener("mp:session", (e) => { if (e.detail === "in") setTimeout(() => { ownerTries = 0; ownerAlt(document.getElementById("view") || document.body); }, 0); });
  const isMine = (card) => { const h = card.querySelector(".post-head .handle")?.textContent || ""; const me = typeof S !== "undefined" && DB.me ? S.user(DB.me) : null; return !!me && h.trim().startsWith("@" + me.handle + " "); };
  async function fetchAlts() {
    const ids = [...altQ.keys()].filter((x) => !altCache.has(x)).slice(0, 40); altQ.clear();
    if (!ids.length) return paintAlts();
    try { const r = await api("GET", "/api/a11y/alt?ids=" + ids.join(",")); for (const [k, v] of Object.entries(r?.alts || {})) altCache.set(k, v.alt); } catch { /* keep heuristic */ }
    paintAlts();
  }
  const paintAlts = () => document.querySelectorAll(".media[data-mid], img[data-mid]").forEach((m) => { const a = altCache.get(m.dataset.mid); if (a) m.setAttribute(m.tagName === "IMG" ? "alt" : "aria-label", a); });
  function capMode(v) {
    const tr = [...(v.textTracks || [])]; if (!tr.length) return;
    const want = P.captions ? (tr.find((t) => t.language === (H.lang || "ar")) || tr[0]) : null;
    tr.forEach((t) => { t.mode = t === want ? "showing" : P.captions ? "disabled" : t.mode; });
  }
  function addAltButton(m, mid) {
    if (m.querySelector(".mp-alt-b")) return;
    if (getComputedStyle(m).position === "static") m.style.position = "relative";
    const b = document.createElement("button"); b.type = "button"; b.className = "mp-alt-b"; b.textContent = "ALT"; b.setAttribute("aria-label", "تعديل النص البديل للصورة");
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); altSheet(mid); });
    m.appendChild(b);
  }
  async function altSheet(mid) {
    let cur = { alt: altCache.get(mid) || "", source: "heuristic" };
    try { cur = await api("GET", "/api/a11y/alt/" + mid); } catch { /* new */ }
    const s = sheet(`<h4 id="mp-alt-h">النص البديل للصورة</h4><p class="muted">يقرؤه قارئ الشاشة لمن لا يرى الصورة. صِف ما فيها باختصار.</p>
      <label for="mp-alt-t">الوصف</label><textarea id="mp-alt-t" maxlength="500" rows="3">${cur.source === "heuristic" ? "" : esc(cur.alt)}</textarea>
      <p class="muted" id="mp-alt-src">${cur.source === "auto" ? "وصف آلي — راجعه قبل الحفظ" : cur.source === "heuristic" ? "اقتراح من نص المنشور: " + esc(cur.alt) : ""}</p>
      <div class="mp-a11y-row"><button class="btn" type="button" id="mp-alt-save">حفظ</button><button class="btn ghost" type="button" id="mp-alt-auto">اقتراح تلقائي</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div>`);
    const t = s.querySelector("#mp-alt-t");
    s.querySelector("#mp-alt-save").addEventListener("click", async () => {
      try { const r = await api("PUT", "/api/a11y/alt/" + mid, { alt: t.value }); altCache.set(mid, r.alt); paintAlts(); closeSheet(); toast("تم حفظ النص البديل"); } catch (e) { toast(e?.message || "تعذّر الحفظ"); }
    });
    s.querySelector("#mp-alt-auto").addEventListener("click", async (e) => {
      e.currentTarget.setAttribute("aria-busy", "true");
      try { const r = await api("POST", `/api/a11y/alt/${mid}/auto`, { replace: true }); t.value = r.alt; s.querySelector("#mp-alt-src").textContent = r.source === "auto" ? "وصف آلي — راجعه قبل الحفظ" : "اقتراح من نص المنشور (الوصف الآلي غير مفعّل أو الصورة غير عامة)"; t.focus(); } catch { toast("تعذّر الاقتراح"); }
      e.currentTarget?.removeAttribute?.("aria-busy");
    });
  }

  /* ---------- sheets as modal dialogs ---------- */
  const sh = document.getElementById("sheet"); let opener = null;
  const focusables = (el) => [...el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null || x === document.activeElement);
  if (sh) {
    new MutationObserver(() => {
      const open = !sh.classList.contains("hidden");
      if (open && !sh.dataset.a11yOpen) {
        sh.dataset.a11yOpen = "1"; opener = document.activeElement !== document.body ? document.activeElement : opener;
        const pn = sh.querySelector(".panel") || sh, h = sh.querySelector("h2,h3,h4,b"); // ui.js makes .panel the modal dialog; we give it a name
        pn.setAttribute("role", "dialog"); pn.setAttribute("aria-modal", "true");
        if (h) { h.id ||= "mp-sheet-h"; pn.setAttribute("aria-labelledby", h.id); } else pn.setAttribute("aria-label", "نافذة");
        setTimeout(() => { if (sh.contains(document.activeElement)) return; const f = focusables(sh); (f.find((x) => /^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName)) || f[0] || sh).focus?.(); }, 30);
        label(sh);
      } else if (open) label(sh);
      else if (!open && sh.dataset.a11yOpen) { delete sh.dataset.a11yOpen; const o = opener; opener = null; if (o && o.isConnected) setTimeout(() => o.focus?.(), 0); else focusMain(false); }
    }).observe(sh, { attributes: true, attributeFilter: ["class"], childList: true });
  }
  /* other full-screen dialogs (composer, viewers) appended to <body>: same focus contract */
  const dlgOpeners = new WeakMap();
  new MutationObserver((recs) => {
    for (const r of recs) {
      r.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.getAttribute("role") === "dialog" && n !== sh) { n.setAttribute("aria-modal", "true"); dlgOpeners.set(n, document.activeElement); } });
      r.removedNodes.forEach((n) => { if (n.nodeType === 1 && n.getAttribute?.("role") === "dialog" && n !== sh) { const o = dlgOpeners.get(n); setTimeout(() => { if (document.activeElement && document.activeElement !== document.body) return; if (o && o.isConnected) o.focus?.(); else focusMain(false); }, 0); } });
    }
  }).observe(document.body, { childList: true });
  const topDialog = () => {
    if (sh && !sh.classList.contains("hidden")) return sh;
    return [...document.querySelectorAll("body > [role=dialog]")].filter((x) => { if (x === sh) return false; const c = getComputedStyle(x); return c.display !== "none" && c.visibility !== "hidden"; }).pop() || null;
  };
  document.addEventListener("keydown", (e) => {
    const dlg = topDialog(), open = !!dlg;
    if (open && e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      if (dlg === sh) closeSheet(); else (dlg.querySelector('[aria-label="إغلاق"], [data-ui=close-sheet], .close') || {}).click?.();
      return;
    }
    if (open && e.key === "Tab") {
      const f = focusables(dlg); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dlg.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !dlg.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      return;
    }
    const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if ((e.key === "Enter" || e.key === " ") && t?.getAttribute?.("role") === "button" && t.tagName !== "BUTTON") { e.preventDefault(); t.click(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || open) return;
    if (e.key === "j" || e.key === "k") {
      const posts = [...(view?.querySelectorAll("[role=article]") || [])]; if (!posts.length) return;
      const i = posts.findIndex((x) => x === document.activeElement || x.contains(document.activeElement));
      const n = posts[Math.max(0, Math.min(posts.length - 1, i < 0 ? 0 : i + (e.key === "j" ? 1 : -1)))];
      e.preventDefault(); n.focus(); n.scrollIntoView({ block: "center", behavior: P.motion === "full" ? "smooth" : "auto" });
    } else if (e.key === "Enter" && t?.getAttribute?.("role") === "article") { const a = t.querySelector("a.time"); if (a) { e.preventDefault(); a.click(); } }
    else if (e.key === "?") { e.preventDefault(); keysHelp(); }
  });
  function keysHelp() {
    sheet(`<h4>اختصارات لوحة المفاتيح</h4><ul><li><kbd>j</kbd> / <kbd>k</kbd>: المنشور التالي / السابق</li><li><kbd>Enter</kbd>: فتح المنشور</li><li><kbd>Tab</kbd>: التنقل بين العناصر، و<kbd>Esc</kbd> لإغلاق النوافذ</li><li><kbd>?</kbd>: هذه القائمة</li></ul><a class="btn ghost" href="#/settings/display" data-ui="close-sheet">إعدادات العرض</a>`);
  }

  /* ---------- observe renders ---------- */
  let lt = 0;
  const run = () => { lt = 0; if (view) label(view); label(document.querySelector(".topbar") || document.body); afterRender(); };
  if (view) new MutationObserver((recs) => { if (!lt && recs.some((r) => r.type === "childList" || (r.target.classList?.contains("media") && !r.target.dataset.a11yM))) lt = requestAnimationFrame(run); }).observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  markNav(); run();
  if (online()) setTimeout(syncServer, 50);
  addEventListener("hashchange", () => { if (!synced) { tries = 0; syncServer(); } }); // e.g. signed in after the chunk loaded

  /* ---------- #/settings/display ---------- */
  const radio = (name, val, opts) => opts.map(([v, l]) => `<label class="radio-row"><span>${l}</span><input type="radio" name="${name}" value="${v}" ${val === v ? "checked" : ""}></label>`).join(""); // v2.32: whole row tappable, control aligned to the end
  const check = (name, val, l, hint) => `<label class="switch-row"><span>${l}${hint ? `<small class="muted mp-a11y-h">${hint}</small>` : ""}</span><input type="checkbox" class="switch" name="${name}" ${val ? "checked" : ""}></label>`; // v2.33: shared switch row
  function displayView() {
    const p = P;
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "إعدادات العرض وإمكانية الوصول", icon: "access", sub: `مجانية للجميع، وتُحفظ على هذا الجهاز${signed() ? " وفي حسابك" : ""}.` })}
      <form class="card mp-a11y-f" id="mp-a11y-form">
        <fieldset><legend>حجم الخط</legend><label for="mp-fs">التكبير: <output id="mp-fs-o" for="mp-fs">${Math.round(p.fontScale * 100)}%</output></label>
          <input id="mp-fs" name="fontScale" type="range" min="0.85" max="2" step="0.05" value="${p.fontScale}" aria-describedby="mp-fs-o">
          <div class="mp-a11y-row">${[[1, "عادي"], [1.25, "كبير"], [1.5, "أكبر"], [2, "الأكبر"]].map(([v, l]) => `<button type="button" class="btn ghost" data-fs="${v}">${l}</button>`).join("")}</div></fieldset>
        <fieldset><legend>التباين</legend>${radio("contrast", p.contrast, [["normal", "عادي"], ["high", "تباين عالٍ"]])}</fieldset>
        <fieldset><legend>القراءة</legend>${check("dyslexia", p.dyslexia, "وضع عُسر القراءة", "تباعد أكبر بين الأسطر والكلمات، محاذاة إلى البداية، أسطر أقصر، خلفية دافئة")}
          <p class="mp-a11y-sh">التباعد</p>${radio("spacing", p.spacing, [["normal", "عادي"], ["wide", "واسع"], ["wider", "أوسع"]])}</fieldset>
        <fieldset><legend>الحركة</legend>${radio("motion", p.motion, [["system", "حسب إعداد الجهاز"], ["reduce", "تقليل الحركة"], ["full", "حركة كاملة"]])}</fieldset>
        <fieldset><legend>التنقل والتركيز</legend>${check("underlineLinks", p.underlineLinks, "تسطير الروابط")}${check("focusRing", p.focusRing === "strong", "إطار تركيز واضح", "إطار أصفر عريض حول العنصر المحدد بلوحة المفاتيح")}</fieldset>
        <fieldset><legend>الوسائط</legend>${check("captions", p.captions, "إظهار الترجمة النصية للفيديو تلقائياً")}${check("altReminder", p.altReminder, "تذكيري بإضافة نص بديل لصوري")}</fieldset>
        <div class="mp-a11y-prev" aria-label="معاينة"><b>معاينة</b><p>مجتمع بلس منصة عربية للتواصل. <a href="#/settings/display">رابط تجريبي</a> — اضغط <kbd>?</kbd> لاختصارات لوحة المفاتيح.</p></div>
        <div class="mp-a11y-row"><button type="button" class="btn ghost" id="mp-a11y-reset">استعادة الافتراضي</button></div>
        <p class="muted" role="status" id="mp-a11y-st"></p>
      </form></div>`;
    const f = view.querySelector("#mp-a11y-form"), st = view.querySelector("#mp-a11y-st");
    const read = () => ({ fontScale: +f.fontScale.value, contrast: f.contrast.value, dyslexia: f.dyslexia.checked, spacing: f.spacing.value, motion: f.motion.value, underlineLinks: f.underlineLinks.checked, focusRing: f.focusRing.checked ? "strong" : "normal", captions: f.captions.checked, altReminder: f.altReminder.checked });
    let t = 0, pend = {}, seq = 0;
    const changed = (e) => {
      if (e?.target?.name === "fontScale") view.querySelector("#mp-fs-o").textContent = Math.round(+f.fontScale.value * 100) + "%";
      const n = read(), patch = diffFrom(P, n); if (!Object.keys(patch).length) return;
      pend = { ...pend, ...patch }; apply({ ...P, ...n }); clearTimeout(t); st.textContent = ""; const my = ++seq;
      t = setTimeout(() => { const x = pend; pend = {}; save(x).then(() => { if (my === seq) st.textContent = "تم الحفظ"; }); }, 250); // only the newest change reports "saved"
    };
    f.addEventListener("change", changed); f.fontScale.addEventListener("input", changed);
    f.addEventListener("submit", (e) => e.preventDefault());
    view.querySelectorAll("[data-fs]").forEach((b) => b.addEventListener("click", () => { f.fontScale.value = b.dataset.fs; changed({ target: f.fontScale }); }));
    view.querySelector("#mp-a11y-reset").addEventListener("click", async () => {
      apply({ ...DEF }); if (signed()) { try { await api("DELETE", "/api/me/a11y"); } catch { dirty = true; setPref("a11yDirty", true); } }
      displayView(); say("تمت استعادة الإعدادات الافتراضية"); view.querySelector("#mp-a11y-st").textContent = "تمت استعادة الافتراضي";
    });
  }
  const diffFrom = (a, b) => { const o = {}; for (const k in b) if (a[k] !== b[k]) o[k] = b[k]; return o; };

  /* ---------- #/a11y/captions/:mediaId ---------- */
  async function captionsView(mid) {
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/me", "حسابي"], title: "الترجمة النصية للفيديو" })}<div id="mp-cc"><div class="skel"></div></div></div>`;
    const box = view.querySelector("#mp-cc");
    if (!signed()) { box.innerHTML = `<p class="muted">سجّل الدخول لإدارة الترجمة النصية.</p>`; return; }
    let list;
    try { list = await api("GET", "/api/a11y/captions/" + encodeURIComponent(mid)); } catch { box.textContent = "الفيديو غير موجود"; return; }
    const langs = [["ar", "العربية"], ["en", "English"], ["fr", "Français"], ["ur", "اردو"]];
    box.innerHTML = `<div class="card"><h3 class="u-m0 u-mb6 u-t-lg">الملفات الحالية</h3>${list.captions.length ? `<ul>${list.captions.map((c) => `<li>${esc(c.label)} (${esc(c.lang)}) · ${c.source === "auto" ? "آلية" : "يدوية"} <button type="button" class="btn ghost" data-cc-edit="${esc(c.lang)}">تعديل</button> <button type="button" class="btn ghost" data-cc-del="${esc(c.lang)}">حذف</button></li>`).join("")}</ul>` : `<p class="muted">لا توجد ترجمة نصية بعد.</p>`}</div>
      <form class="card mp-a11y-f" id="mp-cc-f"><h3 class="u-m0 u-mb6 u-t-lg">إضافة أو تعديل</h3>
        <label for="mp-cc-lang">اللغة</label><select id="mp-cc-lang">${langs.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <label for="mp-cc-file">رفع ملف WebVTT أو SRT</label><input id="mp-cc-file" type="file" accept=".vtt,.srt,text/vtt">
        <label for="mp-cc-t">النص (WebVTT)</label><textarea id="mp-cc-t" class="mp-vtt" spellcheck="false" dir="ltr">WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n</textarea>
        <div class="mp-a11y-row"><button class="btn" type="submit">حفظ</button>${list.autoAvailable ? `<button class="btn ghost" type="button" id="mp-cc-auto">توليد تلقائي</button>` : `<span class="muted">التوليد التلقائي غير مفعّل — الإضافة يدوية فقط</span>`}</div>
        <p class="muted" role="status" id="mp-cc-st"></p></form>`;
    const f = box.querySelector("#mp-cc-f"), t = box.querySelector("#mp-cc-t"), lang = box.querySelector("#mp-cc-lang"), st = box.querySelector("#mp-cc-st");
    box.querySelector("#mp-cc-file").addEventListener("change", (e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 512 * 1024) { st.textContent = "الملف كبير"; return; } const r = new FileReader(); r.onload = () => { t.value = String(r.result || ""); st.textContent = "تم تحميل الملف — راجعه ثم احفظ"; }; r.readAsText(file); });
    f.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("PUT", `/api/a11y/captions/${mid}/${lang.value}`, { vtt: t.value }); toast("تم حفظ الترجمة النصية"); captionsView(mid); } catch (er) { st.textContent = er?.message || "ملف غير صالح"; } });
    box.querySelector("#mp-cc-auto")?.addEventListener("click", async () => { st.textContent = "جارٍ التوليد…"; try { const r = await api("POST", `/api/a11y/captions/${mid}/auto`, { lang: lang.value }); t.value = r.vtt; st.textContent = "تم التوليد — راجع النص وعدّله إن لزم"; } catch (er) { st.textContent = er?.message || "تعذّر التوليد"; } });
    box.querySelectorAll("[data-cc-edit]").forEach((b) => b.addEventListener("click", async () => { try { const r = await api("GET", `/api/a11y/captions/${mid}/${b.dataset.ccEdit}/source`); lang.value = r.lang; t.value = r.vtt; t.focus(); } catch { /* gone */ } }));
    box.querySelectorAll("[data-cc-del]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("حذف هذه الترجمة؟")) return; try { await api("DELETE", `/api/a11y/captions/${mid}/${b.dataset.ccDel}`); captionsView(mid); } catch { toast("تعذّر الحذف"); } }));
  }

  /* ---------- #/admin/a11y ---------- */
  async function adminView() {
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "تدقيق الوصول الدوري", icon: "access" })}<div class="mp-a11y-row"><button class="btn" type="button" id="mp-aud-run">تشغيل الفحص الآن</button></div><div id="mp-aud"><div class="skel"></div></div></div>`;
    const box = view.querySelector("#mp-aud");
    const load = async () => {
      try {
        const r = await api("GET", "/api/admin/a11y/audits");
        box.innerHTML = r.items.length ? r.items.map((a) => `<div class="card"><b>${a.kind === "ci" ? "تقرير CI (axe)" : "فحص الخادم"}</b> · <span data-noi18n>${esc(new Date(a.startedAt).toLocaleString())}</span> · ${a.ok ? "✓ سليم" : `${a.issues} ملاحظة`}
          ${a.kind === "server" ? `<p class="muted">صور بنص بديل ${a.summary.altCoverage}% (${a.summary.missingAlt} بلا وصف) · فيديو بترجمة ${a.summary.captionCoverage}% (${a.summary.missingCaptions} بلا ترجمة) · آخر 7 أيام</p>` : `<ul>${(a.summary.pages || []).filter((p) => p.violations).map((p) => `<li data-noi18n>${esc(p.route)}: ${p.violations} (${esc(p.rules.join(", "))})</li>`).join("") || "<li>لا مخالفات</li>"}</ul>`}</div>`).join("") : `<p class="muted">لا توجد فحوص بعد.</p>`;
      } catch { box.innerHTML = `<p class="muted">للإدارة فقط</p>`; }
    };
    view.querySelector("#mp-aud-run").addEventListener("click", async () => { try { await api("POST", "/api/admin/a11y/audits/run"); load(); } catch { toast("تعذّر الفحص"); } });
    load();
  }

  /* ---------- routes + settings entry ---------- */
  MPRoutes.extend((a, b) => ({ a11y: () => (a === "captions" && b ? captionsView(b) : displayView()), accessibility: () => displayView() }));
  // only claim our own sub-routes; everything else stays with earlier chunks/core
  MPRoutes.add("settings", (a, b, next) => (a === "display" ? displayView() : next()));
  MPRoutes.add("admin", (a, b, next) => (a === "a11y" ? adminView() : next()));
  const setCard = () => {
    if (!/^#\/settings\/?(\?|$)/.test(location.hash) || document.getElementById("mp-a11y-set")) return;
    const w = view?.querySelector(".wrap"); if (!w || !w.querySelector("h2")) return;
    w.querySelector("h2").insertAdjacentHTML("afterend", `<a class="u-db u-ci card" id="mp-a11y-set" href="#/settings/display"><svg class=ei aria-hidden=true><use href=#i-access /></svg> <b>العرض وإمكانية الوصول</b><div class="muted">حجم الخط، التباين العالي، وضع عُسر القراءة، الحركة</div></a>`);
  };
  if (view) new MutationObserver(setCard).observe(view, { childList: true });
  const R = (location.hash.split("/")[1] || "").split("?")[0];
  if (["a11y", "accessibility"].includes(R) || /^#\/(settings\/display|admin\/a11y)/.test(location.hash)) { try { route(); } catch { /* not ready */ } }
  setCard();
  window.MPA11y = { apply, save, prefs: () => ({ ...P }), css, focusMain, say, label };
})();
