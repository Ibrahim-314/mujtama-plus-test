/* Personalization «المظهر والتخصيص» (phase 44). Lazy chunk `prefs`. FREE for everyone. Contract: docs/integration/p44.md.
 * • Display mode system/light/dark keeps the existing data-theme attribute (DB.settings.theme, applyShell) so every dark-only
 *   rule in the app still applies; colour themes are CSS custom properties generated here per palette (html[data-palette]),
 *   plus a true-black OLED variant for dark (html[data-oled]) and a compact display density (html[data-density]).
 * • The generated CSS (palette + OLED + density + nav order via CSS `order`) is cached in localStorage "mp.ui"; the core
 *   (chunks.js) injects it before first render with a few bytes, so a saved theme never flashes. This chunk then reorders the
 *   nav DOM itself (focus order follows the visual order) and swaps manifest / apple-touch-icon / favicon to the chosen icon.
 * • #/settings/appearance: live preview card (hover/focus a swatch previews it in the card; a tap applies it app-wide with an
 *   «تراجع» back to how things were when the screen opened), mode + OLED, palettes, density, reorderable nav (↑/↓ buttons),
 *   alternate app icon, sync toggle.
 * • Sync: signed in → GET/PUT /api/prefs (namespace `ui`), last write wins per key; realtime "prefs" ping + tab focus re-fetch
 *   keep the user's devices in step. Offline edits stay "dirty" and are pushed on the next sync. No inline handlers (CSP). */
(function PrefsUI() {
  const NAV = ["home", "explore", "communities", "notifications", "menu"];
  const fixNav = (v) => (Array.isArray(v) ? v.map((x) => (x === "me" ? "menu" : x)) : v); // v2.52: «حسابي» → «المزيد» (orders saved before the hub)
  const NAV_L = { home: "الرئيسية", explore: "استكشف", communities: "المجتمعات", notifications: "الإشعارات", menu: "المزيد" };
  /* same table as server/lib/prefs-lib.js: brand gradient, light [accent, accent2, ink], dark [accent, accent2, ink] */
  const PAL = {
    violet: ["بنفسجي", ["#6d3cf4", "#c04cf0", "#ff7ab6"], ["#6d3cf4", "#efe9ff", "#4f22d1"], ["#9a7bff", "#231c3d", "#b9a4ff"]],
    ocean: ["محيط", ["#0b6bcb", "#1aa3c8", "#4fd1c5"], ["#0b63c1", "#e3f0ff", "#084e98"], ["#5aa9ff", "#0f2338", "#9cccff"]],
    forest: ["غابة", ["#1e7a46", "#3fa34d", "#a3d65c"], ["#1d7a44", "#e3f5e9", "#135a31"], ["#4fd18b", "#10291b", "#9ff0c3"]],
    sunset: ["غروب", ["#e8590c", "#f0396b", "#ffb347"], ["#c2410c", "#fff0e6", "#9a3412"], ["#ff9a5c", "#3a1d0e", "#ffc49e"]],
    rose: ["وردي", ["#d6336c", "#f06595", "#ffa8c5"], ["#c2255c", "#ffe8f0", "#9c1d4a"], ["#ff7aa8", "#3a1424", "#ffb3cd"]],
    gold: ["ذهبي", ["#b7791f", "#d69e2e", "#f6e05e"], ["#8a5a00", "#fff5d6", "#6e4300"], ["#f2c14e", "#33270c", "#ffe08a"]],
    graphite: ["رمادي", ["#374151", "#6b7280", "#9ca3af"], ["#374151", "#eceef2", "#1f2937"], ["#c4cad4", "#1f232a", "#e5e7eb"]]
  };
  const ICONS = { classic: ["الأصلية", "#6d3cf4", "#c04cf0", "#fff"], ocean: ["محيط", "#0b6bcb", "#4fd1c5", "#fff"], forest: ["غابة", "#1e7a46", "#a3d65c", "#fff"], sunset: ["غروب", "#e8590c", "#ffb347", "#fff"], rose: ["وردي", "#d6336c", "#ffa8c5", "#fff"], gold: ["ذهبي", "#8a5a00", "#f6e05e", "#fff"], midnight: ["منتصف الليل", "#000", "#15131d", "#9a7bff"] };
  const LIGHT = { bg: "#f5f4fa", card: "#ffffff", text: "#15121f", muted: "#625c76", line: "#e9e6f2" };
  const DARK = { bg: "#0b0a10", card: "#15131d", text: "#f3f1fa", muted: "#8f89a3", line: "#24212f" };
  const OLED = { bg: "#000", "bg-2": "#000", card: "#000", elev: "#0a0a0a", line: "#1f1f1f", "line-2": "#2a2a2a", glass: "rgba(0,0,0,.85)" };
  const DEF = { theme: "system", palette: "violet", oled: false, density: "comfortable", nav: NAV, icon: "classic" };
  const KEYS = Object.keys(DEF);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } } };
  const on = () => typeof Remote !== "undefined" && Remote.on && typeof DB !== "undefined" && DB.me;
  const H = document.documentElement;

  /* ---------- state ---------- */
  let saved = {}; try { saved = JSON.parse(ls.get("mp.prefs") || "{}") || {}; } catch { saved = {}; }
  const st = { ...DEF, ...(saved.v || {}) };
  if (typeof DB !== "undefined" && DB.settings && DB.settings.theme) st.theme = DB.settings.theme;
  const dirty = new Set(saved.dirty || []);
  let rev = saved.rev || null, sync = saved.sync !== false;
  const persist = () => ls.set("mp.prefs", JSON.stringify({ v: st, dirty: [...dirty], rev, sync, user: saved.user || null }));
  const valid = (k, v) => k === "theme" ? ["system", "light", "dark"].includes(v) : k === "palette" ? !!PAL[v] : k === "oled" ? typeof v === "boolean" : k === "density" ? ["comfortable", "compact"].includes(v) : k === "icon" ? !!ICONS[v] : k === "nav" ? Array.isArray(v) && v.length === NAV.length && NAV.every((x) => v.includes(x)) : false;
  st.nav = fixNav(st.nav); if (!valid("nav", st.nav)) st.nav = NAV;

  /* ---------- CSS generation ---------- */
  const vars = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v}`).join(";");
  function palVars(id, dark, oled) {
    const p = PAL[id] || PAL.violet, a = dark ? p[3] : p[2];
    return { "brand-1": p[1][0], "brand-2": p[1][1], "brand-3": p[1][2], accent: a[0], accent2: a[1], "accent-ink": a[2], ...(dark && oled ? OLED : {}) };
  }
  function css(s) {
    let out = "";
    if (s.palette !== "violet") out += `html:root:root{${vars(palVars(s.palette, false))}}`;
    if (s.palette !== "violet" || s.oled) {
      const d = vars(palVars(s.palette, true, s.oled));
      out += `html:root:root[data-theme=dark]{${d}}@media (prefers-color-scheme:dark){html:root:root:not([data-theme=light]){${d}}}`;
    }
    if (s.density === "compact") out += "html:root:root{--s3:8px;--s4:12px;--s5:15px;--s6:18px;--r:14px;--nav-h:58px;--top-h:50px}.card{margin-bottom:8px}.post-card{padding:10px 12px 6px}.post-card .actions{margin-top:2px}body{line-height:1.45}";
    if (s.nav.join() !== NAV.join()) out += s.nav.map((r, i) => `.bottomnav a[data-r=${r}]{order:${i + 1}}`).join("") + ".bottomnav .side-only{order:7}.bottomnav .side-compose{order:9}";
    return out;
  }
  const darkNow = () => st.theme === "dark" || (st.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

  /* ---------- apply to the page ---------- */
  function link(rel, href, extra) {
    let l = document.head.querySelector(`link[rel="${rel}"]`);
    if (!l) { l = document.createElement("link"); l.rel = rel; document.head.appendChild(l); }
    if (l.getAttribute("href") !== href) l.href = href;
    if (extra) Object.assign(l, extra);
  }
  function applyIcon() {
    if (!location.protocol.startsWith("http")) return;
    if (st.icon === "classic") { // default icon → the one default manifest in index.html (phase 46: share target, shortcuts, full icon set)
      link("manifest", "/manifest.json");
      link("apple-touch-icon", "/icons/apple-touch-icon-180.png");
      link("icon", "/icons/favicon-32.png", { type: "image/png" });
      return;
    }
    link("manifest", "/api/prefs/manifest.webmanifest?icon=" + st.icon);
    link("apple-touch-icon", `/api/prefs/icons/${st.icon}-180.png`);
    link("icon", `/api/prefs/icons/${st.icon}-192.png`, { type: "image/png" });
  }
  function orderNav() {
    const n = document.querySelector(".bottomnav"); if (!n) return;
    const first = n.querySelector("a[data-r]"), anchor = first ? first.previousElementSibling : null; // keep side-brand etc. in place
    let at = anchor;
    for (const r of st.nav) { const a = n.querySelector(`a[data-r="${r}"]`); if (!a) continue; if (at) at.after(a); else n.prepend(a); at = a; }
  }
  function apply() {
    const c = css(st);
    let el = document.getElementById("mp-ui");
    if (!el) { el = document.createElement("style"); el.id = "mp-ui"; document.head.appendChild(el); }
    if (el !== document.head.lastElementChild) document.head.appendChild(el); // stay after every other stylesheet
    el.textContent = c;
    ls.set("mp.ui", c || null);
    H.dataset.palette = st.palette; H.dataset.density = st.density;
    if (st.oled) H.dataset.oled = ""; else delete H.dataset.oled;
    if (typeof DB !== "undefined" && DB.settings && DB.settings.theme !== st.theme) { DB.settings.theme = st.theme; if (typeof save === "function") save(); }
    const eff = st.theme === "dark" || st.theme === "light" ? st.theme : darkNow() ? "dark" : "light"; // "system" → effective scheme (v2.36)
    if (H.dataset.theme !== eff) { // v2.53: switch with transitions off so no colour animates between schemes (a11y contrast race)
      H.classList.add("no-tx"); H.dataset.theme = eff;
      requestAnimationFrame(() => requestAnimationFrame(() => H.classList.remove("no-tx")));
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = darkNow() ? (st.oled ? "#000000" : DARK.bg) : (PAL[st.palette] || PAL.violet)[2][0];
    orderNav(); applyIcon();
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => apply());

  /* ---------- server sync ---------- */
  const api = (m, p, b) => Remote.api(m, p, b);
  let pushT = 0, syncing = null;
  function adopt(r) {
    if (!r || !r.prefs) return;
    const ui = r.prefs.ui || {};
    for (const k of KEYS) if (!dirty.has(k)) { const u = k === "nav" ? fixNav(ui[k]) : ui[k], v = k in ui && valid(k, u) ? u : undefined; if (v !== undefined) st[k] = v; }
    rev = r.rev; persist(); apply();
    if (/^#\/settings\/appearance/.test(location.hash) && !document.getElementById("mp-ap")?.contains(document.activeElement)) render();
  }
  async function push() {
    if (!on() || !sync || !dirty.size) return;
    const keys = [...dirty], values = Object.fromEntries(keys.map((k) => [k, st[k]]));
    try { const r = await api("PUT", "/api/prefs", { ns: "ui", values }); keys.forEach((k) => { if (JSON.stringify(st[k]) === JSON.stringify(values[k])) dirty.delete(k); }); adopt(r); }
    catch { persist(); /* stays dirty, retried on the next sync */ }
  }
  function pull(force) {
    if (!on() || !sync) return Promise.resolve();
    return (syncing ||= (async () => {
      try {
        if (dirty.size) await push();
        const r = await api("GET", "/api/prefs?ns=ui" + (!force && rev ? "&rev=" + rev : ""));
        if (!r.unchanged) adopt(r);
      } catch { /* offline: local prefs keep working */ }
      finally { syncing = null; }
    })());
  }
  function set(k, v, opts = {}) {
    if (k === "nav") v = fixNav(v);
    if (!valid(k, v)) return false;
    st[k] = v; if (!opts.local) dirty.add(k);
    persist(); apply();
    clearTimeout(pushT); pushT = setTimeout(push, 400);
    return true;
  }
  // first sign-in on this device (or a different account): adopt that account's prefs; never push another user's edits
  let pulledFor = saved.user || null;
  const meCheck = () => { if (!on() || pulledFor === DB.me) return; if (pulledFor && pulledFor !== DB.me) dirty.clear(); pulledFor = DB.me; saved.user = DB.me; persist(); pull(true); };
  if (typeof hydrate === "function") {
    const _h = hydrate;
    hydrate = function () { const r = _h.apply(this, arguments); setTimeout(meCheck, 0); return r; };
  }
  let esBound = null;
  function bindStream() { const es = typeof Remote !== "undefined" && Remote.es; if (es && es !== esBound) { esBound = es; es.addEventListener("prefs", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { /* */ } if (!d.rev || d.rev !== rev) pull(true); }); } }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { bindStream(); pull(); } });
  addEventListener("online", () => pull());
  // the old «تلقائي/فاتح/داكن» buttons in #/settings call applyShell(): mirror their choice into these prefs
  if (typeof applyShell === "function") {
    const _as = applyShell;
    applyShell = function () { const r = _as.apply(this, arguments); if (DB.settings.theme && DB.settings.theme !== st.theme && valid("theme", DB.settings.theme)) set("theme", DB.settings.theme); else apply(); return r; };
  }

  /* ---------- #/settings/appearance ---------- */
  let undo = null;
  const tile = (id, pressed, label, body, cls) => `<button type="button" class="pf-t ${cls || ""}" data-pf="${id}" aria-pressed="${pressed}">${body}<span>${esc(label)}</span></button>`;
  const iconArt = (c) => `<i class="pf-ic" style="background:linear-gradient(135deg,${c[1]},${c[2]});color:${c[3]}" aria-hidden="true">+</i>`;
  function previewInto(box, s) {
    const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const base = dark ? { ...DARK, ...(s.oled ? { bg: "#000", card: "#000", line: "#1f1f1f" } : {}) } : LIGHT;
    const v = { ...base, ...palVars(s.palette, dark, s.oled) };
    for (const [k, x] of Object.entries(v)) box.style.setProperty("--pv-" + k, x);
    box.classList.toggle("pf-compact", s.density === "compact");
  }
  function render() {
    const box = document.getElementById("mp-ap"); if (!box) return;
    if (!undo) undo = { ...st, nav: [...st.nav] };
    box.innerHTML = `
      <div class="card pf-pv" id="pf-pv" aria-label="معاينة فورية" role="img"><div class="pf-pvh"><b>+</b> مجتمع بلس</div>
        <div class="pf-pvc"><div class="pf-av"></div><div><b>سارة</b> <small>· الآن</small><p>هكذا ستبدو منشوراتك بهذه السمة</p><span class="pf-btn">متابعة</span> <span class="pf-chip">#تصميم</span></div></div>
        <div class="pf-pvn">${st.nav.map((r, i) => `<span class="${i === 0 ? "on" : ""}">${esc(NAV_L[r])}</span>`).join("")}</div></div>
      <div class="u-g8 u-m0 u-mb10 row"><button type="button" class="btn ghost" id="pf-undo">↶ تراجع</button><button type="button" class="btn ghost" id="pf-reset">الإعدادات الافتراضية</button></div>
      <div class="card"><h3>وضع العرض</h3><div class="seg" role="group" aria-label="وضع العرض">${[["system", "تلقائي"], ["light", "فاتح"], ["dark", "داكن"]].map(([k, l]) => `<button type="button" data-pfmode="${k}" aria-pressed="${st.theme === k}" class="${st.theme === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <label class="chk"><input type="checkbox" id="pf-oled" ${st.oled ? "checked" : ""}> أسود حقيقي لشاشات OLED (في الوضع الداكن)</label></div>
      <div class="card"><h3>سمة الألوان</h3><div class="pf-grid" role="group" aria-label="سمة الألوان">${Object.entries(PAL).map(([id, p]) => tile("pal:" + id, st.palette === id, p[0], `<i class="pf-sw" style="background:linear-gradient(135deg,${p[1][0]},${p[1][1]} 60%,${p[1][2]})" aria-hidden="true"></i>`)).join("")}</div></div>
      <div class="card"><h3>كثافة العرض</h3><div class="seg" role="group" aria-label="كثافة العرض">${[["comfortable", "مريح"], ["compact", "مضغوط"]].map(([k, l]) => `<button type="button" data-pfden="${k}" aria-pressed="${st.density === k}" class="${st.density === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="card"><h3>ترتيب شريط التنقل</h3><ol class="pf-nav">${st.nav.map((r, i) => `<li><span>${esc(NAV_L[r])}</span><button type="button" class="btn ghost" data-pfup="${r}" ${i === 0 ? "disabled" : ""} aria-label="تحريك ${esc(NAV_L[r])} للأعلى">↑</button><button type="button" class="btn ghost" data-pfdn="${r}" ${i === NAV.length - 1 ? "disabled" : ""} aria-label="تحريك ${esc(NAV_L[r])} للأسفل">↓</button></li>`).join("")}</ol></div>
      <div class="card"><h3>أيقونة التطبيق</h3><div class="pf-grid" role="group" aria-label="أيقونة التطبيق">${Object.entries(ICONS).map(([id, c]) => tile("ic:" + id, st.icon === id, c[0], iconArt(c))).join("")}</div>
        <p class="muted pf-note">تظهر الأيقونة الجديدة عند إضافة التطبيق إلى الشاشة الرئيسية؛ على بعض الأجهزة يلزم إعادة إضافته.</p></div>
      <div class="card"><label class="chk"><input type="checkbox" id="pf-sync" ${sync ? "checked" : ""} ${on() ? "" : "disabled"}> مزامنة هذه الإعدادات بين أجهزتي</label>
        <p class="muted pf-note" id="pf-st" role="status">${on() ? (sync ? "تُحفظ في حسابك وتصل إلى أجهزتك الأخرى تلقائياً." : "محفوظة على هذا الجهاز فقط.") : "سجّل الدخول لمزامنتها بين أجهزتك."}</p></div>`;
    previewInto(box.querySelector("#pf-pv"), st);
    const re = () => { render(); };
    box.querySelectorAll("[data-pfmode]").forEach((b) => b.addEventListener("click", () => { set("theme", b.dataset.pfmode); if (typeof applyShell === "function") applyShell(); re(); }));
    box.querySelector("#pf-oled").addEventListener("change", (e) => { set("oled", e.target.checked); re(); });
    box.querySelectorAll("[data-pfden]").forEach((b) => b.addEventListener("click", () => { set("density", b.dataset.pfden); re(); }));
    box.querySelectorAll("[data-pf]").forEach((b) => {
      const [kind, id] = b.dataset.pf.split(":");
      b.addEventListener("click", () => { set(kind === "pal" ? "palette" : "icon", id); re(); setTimeout(() => document.querySelector(`[data-pf="${kind}:${id}"]`)?.focus(), 0); });
      if (kind === "pal") {
        const pv = () => previewInto(box.querySelector("#pf-pv"), { ...st, palette: id });
        const back = () => previewInto(box.querySelector("#pf-pv"), st);
        b.addEventListener("pointerenter", pv); b.addEventListener("focus", pv); b.addEventListener("pointerleave", back); b.addEventListener("blur", back);
      }
    });
    const move = (r, d) => { const n = [...st.nav], i = n.indexOf(r), j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; set("nav", n); re(); setTimeout(() => (document.querySelector(`[data-pf${d < 0 ? "up" : "dn"}="${r}"]:not([disabled])`) || document.querySelector(`[data-pf${d < 0 ? "dn" : "up"}="${r}"]`))?.focus(), 0); };
    box.querySelectorAll("[data-pfup]").forEach((b) => b.addEventListener("click", () => move(b.dataset.pfup, -1)));
    box.querySelectorAll("[data-pfdn]").forEach((b) => b.addEventListener("click", () => move(b.dataset.pfdn, 1)));
    box.querySelector("#pf-undo").addEventListener("click", () => { const u = undo; for (const k of KEYS) if (JSON.stringify(st[k]) !== JSON.stringify(u[k])) set(k, u[k]); if (typeof applyShell === "function") applyShell(); re(); });
    box.querySelector("#pf-reset").addEventListener("click", () => { for (const k of KEYS) if (JSON.stringify(st[k]) !== JSON.stringify(DEF[k])) set(k, DEF[k]); if (typeof applyShell === "function") applyShell(); re(); });
    box.querySelector("#pf-sync").addEventListener("change", (e) => { sync = e.target.checked; if (sync) KEYS.forEach((k) => dirty.add(k)); persist(); if (sync) pull(true); re(); });
    window.MPI18n?.apply?.(view);
  }
  function screen() {
    undo = null;
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "المظهر والتخصيص" })}<div id="mp-ap"></div></div>`;
    render(); pull();
  }
  MPRoutes.extend((a, b, prev) => {
    return {  };
  });
  MPRoutes.add("settings", (a, b, next) => (a === "appearance" ? screen() : next()));
  const setCard = () => { if (/^#\/settings\/?(\?|$)/.test(location.hash) && !document.getElementById("mp-pf-set")) (view.querySelector(".wrap .card") || view).insertAdjacentHTML("beforebegin", `<a class="u-db u-ci card" id="mp-pf-set" href="#/settings/appearance"><svg class=ei aria-hidden=true><use href=#i-palette /></svg> <b>المظهر والتخصيص</b><div class="muted">السمات، الوضع الداكن OLED، الكثافة، شريط التنقل، أيقونة التطبيق</div></a>`); };
  if (typeof Views !== "undefined" && Views.settings) { MPSettings.add(function () { setCard(); }); }

  /* ---------- chunk styles (settings screen only; themes themselves are generated above) ---------- */
  const sty = document.createElement("style");
  sty.textContent = `.pf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
.pf-t{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border:2px solid var(--line);border-radius:14px;background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-sm);cursor:pointer}
.pf-t[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent2)}.pf-t:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.pf-sw{display:block;width:40px;height:40px;border-radius:50%}.pf-ic{display:grid;place-items:center;width:44px;height:44px;border-radius:11px;font-style:normal;font-size:30px;font-weight:900;line-height:1}
.pf-pv{background:var(--pv-bg);color:var(--pv-text);border:1px solid var(--pv-line);overflow:hidden;padding:0}
.pf-pvh{padding:10px 14px;font-weight:800;border-bottom:1px solid var(--pv-line);background:var(--pv-card)}.pf-pvh b{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;color:#fff;background:linear-gradient(135deg,var(--pv-brand-1),var(--pv-brand-2) 60%,var(--pv-brand-3))}
.pf-pvc{display:flex;gap:10px;margin:12px;padding:12px;border-radius:14px;background:var(--pv-card);border:1px solid var(--pv-line)}.pf-pvc p{margin:4px 0 8px}.pf-pvc small{color:var(--pv-muted)}
.pf-av{flex:none;width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--pv-brand-1),var(--pv-brand-3))}
.pf-btn{display:inline-block;padding:5px 14px;border-radius:999px;background:var(--pv-accent);color:var(--white);font-weight:700;font-size:var(--fs-sm)}.pf-chip{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--pv-accent2);color:var(--pv-accent-ink);font-size:12.5px}
.pf-pvn{display:flex;justify-content:space-around;padding:8px;border-top:1px solid var(--pv-line);background:var(--pv-card);font-size:11.5px;color:var(--pv-muted)}.pf-pvn .on{color:var(--pv-accent);font-weight:800}
.pf-compact .pf-pvc{margin:8px;padding:8px}.pf-compact .pf-pvh{padding:6px 12px}
.pf-nav{list-style:none;margin:0;padding:0}.pf-nav li{display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--line)}.pf-nav li span{flex:1}.pf-nav .btn{padding:4px 12px;min-width:40px}
.pf-note{font-size:12.5px;margin:6px 0 0}#mp-ap h3{margin:0 0 8px;font-size:16px}`;
  document.head.appendChild(sty);

  window.MPPrefs = { get: () => ({ ...st, nav: [...st.nav], sync }), set, pull, apply, css: (s) => css({ ...DEF, ...s }), palettes: Object.keys(PAL), icons: Object.keys(ICONS) };
  apply(); bindStream(); meCheck(); pull();
  if (/^#\/settings\/appearance/.test(location.hash) && typeof route === "function") route();
})();
