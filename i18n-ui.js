/* Interface languages (phase 41) — FREE for everyone. Lazy chunk `i18n`.
 * • Languages ar (RTL, source) and en (LTR) only (v2.67). The en catalogue is a separate lazy chunk `i18n-en`
 *   (window.MPI18N[lang] = {Arabic source string: translation}); admin overrides from GET /api/i18n/strings win.
 * • DOM translator: text nodes + title / placeholder / aria-label, numbers kept via a {n} pattern, MutationObserver for
 *   dynamic screens. User content is never touched (.body, .cbody, chat text, inputs, [data-noi18n], translations).
 * • Untranslated UI strings are batched to POST /api/i18n/missing (aggregated, no user ids) for the admin string manager.
 * • Switcher: 🌐 in the top bar, the language block in #/settings, #/settings/language; admin manager #/admin/i18n.
 * Strict CSP: no inline handlers. */
(function I18nUI() {
  const LANGS = { ar: { name: "العربية", dir: "rtl" }, en: { name: "English", dir: "ltr" } };
  /* v2.67: fr / ur were retired — a saved fr or ur (device or account) falls back to English */
  const norm = (l) => (l === "fr" || l === "ur" ? "en" : l);
  const CAT = (window.MPI18N = window.MPI18N || {});
  const SKIP = ".body,.cbody,.cm-b span[dir=auto],.mp-tr-out,textarea,input,select,[contenteditable],script,style,code,pre,[data-noi18n],.bio";
  /* <select> is skipped by the walker (its value and user-typed state are never touched); its <option> text and <optgroup>/<option>
   * label attributes are translated separately by doSelect, unless the select, option or an ancestor carries data-noi18n */
  const SKIP_SEL = SKIP.replace("select,", "");
  /* text fields: their value is never touched, but their placeholder / aria-label / title are UI chrome and get translated,
   * unless the field sits in user content (SKIP minus the field tags themselves) */
  const FIELD = "input,textarea"; const SKIP_FIELD = SKIP.replace("textarea,input,", "");
  const fieldOk = (el) => !el.closest("[data-noi18n]") && !el.parentElement?.closest(SKIP_FIELD);
  const AR = /[\u0600-\u06FF]/;
  const orig = new WeakMap(), origAttr = new WeakMap();
  const over = {}; const misses = new Set(); const sent = new Set();
  const on = () => typeof Remote !== "undefined" && Remote.on;
  const cur = () => { if (typeof DB === "undefined" || !DB.settings) return "ar"; const l = norm(DB.settings.lang); return LANGS[l] ? l : "ar"; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NUM = /[0-9٠-٩۰-۹]+(?:[.,٫][0-9٠-٩۰-۹]+)?/g;
  function lookup(s, L = cur()) {
    if (L === "ar") return null;
    const o = over[L] || {}, c = CAT[L] || {};
    if (o[s] != null) return o[s];
    if (c[s] != null) return c[s];
    if (/[0-9٠-٩۰-۹]/.test(s)) { const nums = []; const k = s.replace(NUM, (m) => (nums.push(m), "{n}")); const v = o[k] ?? c[k]; if (v != null) return fillN(v, nums, L); }
    return tpl(s, L);
  }
  /* LTR languages read Latin digits (the Arabic source may build «الخطوة ١ من ٣»); {p:one|other} picks a plural form from the
   * first number of the string. */
  const latin = (x) => x.replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace("٫", ".");
  function fillN(v, nums, L) {
    if (L === "en") nums = nums.map(latin);
    const n0 = Number(latin(nums[0] ?? "").replace(",", ""));
    let i = 0;
    return v.replace(/\{n\}/g, () => nums[i++] ?? "").replace(/\{p:([^|}]*)\|([^}]*)\}/g, (_, one, other) => (n0 === 1 ? one : other));
  }
  /* templated keys: «اكتب في {name}…» keeps the user-supplied {name} as is; {t} must itself be a UI string (a relative time, a
   * date) or carry no Arabic, so «انضم {t}» never turns unrelated text into «Joined …». Compiled once per catalogue size. */
  const tplCache = {};
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function tpls(L) {
    const o = over[L] || {}, c = CAT[L] || {}, size = Object.keys(o).length + ":" + Object.keys(c).length;
    if (tplCache[L]?.size === size) return tplCache[L].list;
    const list = [];
    for (const src of [o, c]) for (const k in src) {
      if (!/\{(name|t)\}/.test(k)) continue;
      const vars = []; const re = new RegExp("^" + k.split(/(\{name\}|\{t\}|\{n\})/).map((part) => (part === "{name}" || part === "{t}" ? (vars.push(part), "([\\s\\S]+?)") : part === "{n}" ? (vars.push(part), "([0-9٠-٩۰-۹]+(?:[.,٫][0-9٠-٩۰-۹]+)?)") : reEsc(part))).join("") + "$");
      list.push({ k, re, vars, v: src[k], len: k.replace(/\{(name|t|n)\}/g, "").length });
    }
    list.sort((a, b) => b.len - a.len);
    tplCache[L] = { size, list };
    return list;
  }
  function tpl(s, L) {
    if (!s || s.length > 300) return null;
    for (const T of tpls(L)) {
      const m = T.re.exec(s); if (!m) continue;
      const vals = {}, nums = []; let ok = true;
      T.vars.forEach((name, i) => {
        const x = m[i + 1];
        if (name === "{n}") nums.push(x);
        else { const tr = name === "{t}" ? (CAT[L]?.[x] != null || over[L]?.[x] != null || /[0-9٠-٩۰-۹]/.test(x) ? lookup(x, L) : null) : null; if (name === "{t}" && tr == null && AR.test(x)) ok = false; (vals[name] ||= []).push(tr ?? x); }
      });
      if (!ok) continue;
      const used = {}; const v = T.v.replace(/\{(name|t)\}/g, (_, nm) => { const a = vals["{" + nm + "}"] || []; const i = (used[nm] = (used[nm] ?? -1) + 1); return a[i] ?? ""; });
      return fillN(v, nums, L);
    }
    return null;
  }
  /** translate a source string for code that builds its own markup (other chunks may call MPI18n.t) */
  const t = (s) => lookup(s) ?? s;
  function miss(s) { if (s.length <= 300 && !sent.has(s) && !/^[\s\d٠-٩.,،:%+\-–()…]*$/.test(s)) misses.add(s); }
  function doText(n, L) {
    if (!orig.has(n)) { if (!AR.test(n.nodeValue)) return; orig.set(n, n.nodeValue); }
    const src = orig.get(n), m = /^(\s*)([\s\S]*?)(\s*)$/.exec(src);
    if (L === "ar") { if (n.nodeValue !== src) n.nodeValue = src; return; }
    const pn = n.parentElement?.dataset?.i18nN;
    const tr = (pn != null && Number(pn) !== 1 ? lookup(m[2] + "#pl", L) : null) ?? lookup(m[2], L);
    if (tr != null) { const v = m[1] + tr + m[3]; if (n.nodeValue !== v) n.nodeValue = v; } else miss(m[2]);
  }
  function doAttrs(el, L, attrs = ["title", "placeholder", "aria-label"]) {
    for (const a of attrs) {
      if (!el.hasAttribute(a)) continue;
      let o = origAttr.get(el); if (!o) origAttr.set(el, (o = {}));
      // a new Arabic value written by the app (not the translation this file set) becomes the new source
      const v = el.getAttribute(a);
      if (o[a] == null || (v !== o[a] && v !== o["\0" + a] && AR.test(v))) { if (!AR.test(v)) continue; o[a] = v; }
      const tr = L === "ar" ? o[a] : lookup(o[a].trim(), L);
      if (tr != null) { if (v !== tr) el.setAttribute(a, tr); o["\0" + a] = tr; } else miss(o[a].trim());
    }
  }
  /** translate the visible text of a select's options (text nodes + label attr) and optgroup labels; values are never changed */
  function doSelect(sel, L) {
    if (sel.closest(SKIP_SEL)) return;
    doAttrs(sel, L);
    for (const o of sel.querySelectorAll("option,optgroup")) {
      if (o.closest("[data-noi18n]")) continue;
      if (o.tagName === "OPTION") for (const n of o.childNodes) if (n.nodeType === 3) doText(n, L);
      doAttrs(o, L, ["label"]);
    }
  }
  let busy = false;
  function apply(root = document.body, L = cur()) {
    if (!root || busy) return;
    busy = true;
    try {
      const sel = root.nodeType === 3 ? root.parentElement?.closest("select") : root.nodeType === 1 ? root.closest("select") : null;
      if (sel) { doSelect(sel, L); return; }
      if (root.nodeType === 3) { if (!root.parentElement?.closest(SKIP)) doText(root, L); return; }
      if (root.nodeType === 1 && root.matches(FIELD)) { if (fieldOk(root)) doAttrs(root, L); return; }
      if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      if (root.nodeType === 1) doAttrs(root, L);
      for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? doText(n, L) : doAttrs(n, L);
      for (const s of root.querySelectorAll("select")) doSelect(s, L);
      for (const f of root.querySelectorAll(FIELD)) if (fieldOk(f)) doAttrs(f, L);
    } finally { busy = false; }
  }
  const queue = new Set(); let raf = 0;
  const mo = new MutationObserver((list) => {
    if (busy) return;
    for (const r of list) { if (r.type === "characterData") queue.add(r.target); else if (r.type === "attributes") queue.add(r.target); else r.addedNodes.forEach((n) => queue.add(n)); }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const L = cur(); const q = [...queue]; queue.clear(); if (L === "ar") return; mo.disconnect(); for (const n of q) if (n.isConnected) { if (n.nodeType === 3 && orig.has(n) && n.nodeValue !== orig.get(n) && AR.test(n.nodeValue)) orig.set(n, n.nodeValue); apply(n, L); } watch(); });
  });
  const watch = () => mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "placeholder", "aria-label", "label"] });

  /* ---------- catalogues + overrides ---------- */
  async function ensure(L) {
    if (L === "ar") return;
    if (!CAT[L]) await window.MPChunks?.load("i18n-" + L).catch(() => { });
    /* v2.69: the en catalogue is split in two lazy chunks (each under the per-chunk budget); the second merges into the first */
    if (L === "en" && !ensure.plus) { await Promise.all([window.MPChunks?.load("i18n-enplus"), window.MPChunks?.load("i18n-enextra")]).then(() => { ensure.plus = true; tplCache.en = null; }).catch(() => { }); }
    if (!over[L] && on()) { try { over[L] = (await Remote.api("GET", "/api/i18n/strings?lang=" + L)).strings || {}; } catch { over[L] = {}; } }
  }
  function setDir(L) {
    const d = document.documentElement; d.lang = L; d.dir = LANGS[L].dir; d.dataset.lang = L;
  }
  let shown = "ar"; // language whose catalogue is actually applied to the DOM (cur() can change under us on hydrate)
  async function setLang(L, { save: persist = true } = {}) {
    L = norm(L); if (!LANGS[L]) return;
    await ensure(L); shown = L;
    if (typeof DB !== "undefined" && DB.settings) { DB.settings.lang = L; if (persist && typeof save === "function") save(); }
    if (persist && on()) Remote.api("PUT", "/api/me/lang", { lang: L }).catch(() => { });
    setDir(L);
    try { if (typeof applyShell === "function") applyShell(); } catch { /* shell is optional */ }
    setDir(L);
    apply(document.body, L);
    if (typeof rerender === "function") try { rerender(); } catch { /* view may not support rerender */ }
    apply(document.body, L);
  }
  // flush misses every 15 s (signed-in server mode only)
  setInterval(() => {
    const L = cur(); if (L === "ar" || !misses.size || !on()) return;
    const keys = [...misses].slice(0, 50); keys.forEach((k) => { misses.delete(k); sent.add(k); });
    Remote.api("POST", "/api/i18n/missing", { lang: L, keys }).catch(() => { });
  }, 15000);

  /* ---------- styles: LTR/RTL details ---------- */
  const st = document.createElement("style");
  st.textContent = `.mp-lang{display:grid;gap:8px}.mp-lang button{display:flex;justify-content:space-between;align-items:center;width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--text);font:inherit;text-align:start}
.mp-lang button[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent2)}.mp-lang small{color:var(--muted)}[dir=ltr] .mp-flip{transform:scaleX(-1)}
.mp-i18n-row{display:grid;gap:6px;border-bottom:1px solid var(--line);padding:8px 0}.mp-i18n-row input{width:100%}`;
  document.head.appendChild(st);

  /* ---------- switcher ---------- */
  const list = (L) => `<div class="mp-lang" role="group" aria-label="لغة الواجهة">${Object.entries(LANGS).map(([k, v]) => `<button type="button" data-mplang="${k}" aria-pressed="${k === L}" lang="${k}" dir="${v.dir}"><b data-noi18n>${esc(v.name)}</b><small data-noi18n>${v.dir.toUpperCase()}</small></button>`).join("")}</div>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-mplang]"); if (!b) return;
    e.preventDefault(); setLang(b.dataset.mplang).then(() => { if (/^#\/settings\/language/.test(location.hash)) languageView(); });
  });
  function languageView() {
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "اللغة" })}<div class="card"><h3 class="u-m0 u-mb6 u-t-lg">لغة الواجهة</h3><p class="muted">الواجهة مجانية بكل اللغات. اختيار اللغة يغيّر اتجاه الصفحة تلقائياً.</p>${list(cur())}</div>
      <div class="card"><a class="btn ghost" href="#/settings/translate">تفضيلات الترجمة</a></div></div>`;
    apply(view);
  }
  function enhanceSettings() {
    if (!/^#\/settings\/?(\?|$)/.test(location.hash)) return;
    const seg = view.querySelector(".seg [data-lang]")?.closest(".seg");
    if (seg && !seg.dataset.mp) { seg.dataset.mp = 1; seg.outerHTML = list(cur()); }
  }
  /* ---------- admin string manager ---------- */
  async function adminView() {
    if (!DB.isAdmin) return Views.notFound();
    const L = "en"; // v2.67: en is the only translatable language (#/admin/i18n?lang=… links resolve to en)
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "إدارة نصوص الواجهة", icon: "globe" })}
      <div class="chips" data-noi18n>${["en"].map((k) => `<a class="tab ${k === L ? "on" : ""}" href="#/admin/i18n?lang=${k}">${LANGS[k].name}</a>`).join("")}</div>
      <div class="card"><h3 class="u-m0 u-mb6 u-t-lg">نصوص تحتاج ترجمة</h3><div id="mp-miss" data-noi18n><div class="skel"></div></div></div>
      <div class="card"><h3 class="u-m0 u-mb6 u-t-lg">النصوص المعدّلة</h3><div id="mp-ov" data-noi18n><div class="skel"></div></div></div></div>`;
    const row = (k, v) => `<div class="mp-i18n-row"><span dir="rtl">${esc(k)}</span><input dir="${LANGS[L].dir}" lang="${L}" value="${esc(v || "")}" data-k="${esc(k)}" aria-label="الترجمة"><div><button class="btn" type="button" data-mpsave>حفظ</button>${v ? ` <button class="btn ghost" type="button" data-mpdel>حذف</button>` : ""}</div></div>`;
    try {
      const [m, o] = await Promise.all([Remote.api("GET", "/api/admin/i18n/missing?lang=" + L), Remote.api("GET", "/api/admin/i18n/strings?lang=" + L)]);
      view.querySelector("#mp-miss").innerHTML = m.items.length ? m.items.map((x) => row(x.key, (CAT[L] || {})[x.key] || "")).join("") : `<p class="muted">لا شيء</p>`;
      view.querySelector("#mp-ov").innerHTML = o.items.length ? o.items.map((x) => row(x.key, x.text)).join("") : `<p class="muted">لا شيء</p>`;
    } catch (e) { view.querySelector("#mp-miss").textContent = e.message; }
    view.querySelectorAll("[data-mpsave],[data-mpdel]").forEach((b) => b.addEventListener("click", async () => {
      const inp = b.closest(".mp-i18n-row").querySelector("input");
      try {
        if (b.hasAttribute("data-mpdel")) await Remote.api("DELETE", "/api/admin/i18n/strings", { key: inp.dataset.k, lang: L });
        else await Remote.api("PUT", "/api/admin/i18n/strings", { key: inp.dataset.k, lang: L, text: inp.value });
        delete over[L]; toast("تم الحفظ");
      } catch (e) { toast(e.message); }
    }));
    apply(view);
  }
  MPRoutes.extend((a, b, prev) => {
    return {  };
  });
  MPRoutes.add("admin", (a, b, next) => {
        if (a && a.split("?")[0] === "i18n") return adminView();
        next();
        if (!a && DB.isAdmin) setTimeout(() => { if (location.hash === "#/admin" && !document.getElementById("mp-adm-i18n")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-db u-ci card" id="mp-adm-i18n" href="#/admin/i18n"><svg class=ei aria-hidden=true><use href=#i-globe /></svg> <b>إدارة نصوص الواجهة</b></a>`); }, 0);
      });
  MPRoutes.add("settings", (a, b, next) => (a === "language" ? languageView() : next()));
  if (typeof Views !== "undefined" && Views.settings) { MPSettings.add(function () { enhanceSettings(); }); }
  // language button in the top bar (v2.32: sprite globe icon, not an emoji)
  const top = document.querySelector(".top-actions");
  if (top && !top.querySelector("#mp-lang-btn")) top.insertAdjacentHTML("afterbegin", `<a href="#/settings/language" class="icon-btn" id="mp-lang-btn" title="اللغة" aria-label="اللغة">${window.UI ? UI.icon("globe") : "<svg class=ei aria-hidden=true><use href=#i-globe /></svg>"}</a>`);

  window.MPI18n = { t, apply, setLang, lookup, languages: LANGS, current: cur, version: "2.23.0" };
  watch();
  const L0 = cur();
  if (L0 !== "ar") ensure(L0).then(() => { shown = L0; setDir(L0); apply(document.body, L0); });
  // the account's interface language (users.lang) is the source of truth across devices and reloads
  let tries = 0; const sync = () => {
    if (!(on() && typeof DB !== "undefined" && DB.me)) { if (++tries < 30) setTimeout(sync, 500); return; } // wait for the server hydrate
    // the server hydrate may already have switched DB.settings.lang (and the shell's dir/lang) before this chunk booted with "ar":
    // compare with what is actually shown, not only with cur(), or the catalogue never loads after a reload
    Remote.api("GET", "/api/me/lang").then((r) => { const L = LANGS[norm(r?.lang)] ? norm(r.lang) : cur(); if (L !== cur() || L !== shown) setLang(L, { save: false }).then(() => { if (typeof save === "function") save(); }); }).catch(() => { });
  };
  sync();
  if (/^#\/(settings\/language|admin\/i18n)/.test(location.hash) && typeof route === "function") route();
  else enhanceSettings();
})();
