/* Installable app (Phase 46). Lazy chunk `pwa` (chunks.js: idle load, and routes #/share #/app). No inline handlers (CSP).
 * • Install: Chromium `beforeinstallprompt` (caught once this chunk is up; before that Chrome's own install UI applies) → «ثبّت التطبيق» card on Home;
 *   iOS Safari → «أضف إلى الشاشة الرئيسية» steps. Apple meta + startup-image (splash) links are added here, not in index.html.
 * • Store-less updates: sw.js waits as an UPDATE; we show «تحديث متوفر» and send "mp-skip-waiting" when tapped, then reload once.
 *   reg.update() on focus (≥ 30 min apart) and hourly.
 * • Offline: «أنت بلا اتصال» pill; drafts written offline are queued by sw.js and flushed on "online" ("mp-drafts-flush").
 * • Share target: #/share opens the composer with the shared title/text/url (+ up to 4 images, uploaded when online).
 * • #/app: install state, push availability (GET /api/pwa/config), offline queue, version, «تحقق من التحديثات».
 * • Gestures (touch only): swipe from the inline-start edge (right edge in RTL) goes back; in the installed app the browser's own
 *   pull-to-reload is disabled (overscroll-behavior) so the app's pull-to-refresh (ui.js) is the only one. */
(function PWAUI() {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const T = (m) => (typeof toast === "function" ? toast(m) : console.info(m));
  const remote = () => typeof Remote !== "undefined" && Remote.on;
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true || document.referrer.startsWith("android-app://");
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iosVer = () => { const m = /OS (\d+)_(\d+)/.exec(navigator.userAgent); return m ? +m[1] + +m[2] / 100 : 0; };
  const SW = navigator.serviceWorker;
  let cfg = null;
  const loadCfg = () => (cfg ? Promise.resolve(cfg) : fetch("/api/pwa/config", { credentials: "same-origin" }).then((r) => r.json()).then((j) => (cfg = j)).catch(() => null));

  /* ---------- style (chunk-only CSS) ---------- */
  const st = document.createElement("style");
  st.textContent = `.mp-pwa-bar{position:fixed;inset-inline:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:60;display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:16px;background:var(--card);color:var(--text);box-shadow:0 10px 30px -10px rgba(0,0,0,.35);border:1px solid var(--line);max-width:560px;margin:auto}
.mp-pwa-bar b{flex:1;font-size:14px}.mp-pwa-bar .btn{white-space:nowrap}.mp-pwa-x{border:0;background:none;color:var(--muted);font-size:18px;cursor:pointer;padding:4px}
.mp-off{position:fixed;top:calc(8px + env(safe-area-inset-top));inset-inline:0;margin:auto;width:max-content;max-width:92vw;z-index:70;padding:6px 14px;border-radius:999px;background:#2b2140;color:#fff;font-size:13px;pointer-events:none;opacity:0;transform:translateY(-8px);transition:.25s}
body.mp-offline .mp-off{opacity:1;transform:none}
.mp-swipe{position:fixed;top:50%;inset-inline-start:0;width:44px;height:44px;margin-top:-22px;border-radius:50%;background:var(--card);box-shadow:0 4px 14px rgba(0,0,0,.2);display:grid;place-items:center;font-size:22px;z-index:80;opacity:0;pointer-events:none;transform:translateX(0)}
.mp-app-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.mp-app-row:last-child{border:0}
.mp-ios-steps{padding-inline-start:20px;line-height:1.9}
.mp-upd{flex-wrap:wrap;align-items:flex-start}.mp-upd .mp-upd-h{flex:1;min-width:0}.mp-upd .mp-upd-h b{display:block;font-size:14px}.mp-upd .mp-upd-v{display:inline-block;margin-top:2px;font-size:12px;color:var(--muted)}
.mp-upd ul{flex-basis:100%;margin:2px 0 0;padding-inline-start:20px;font-size:13px;line-height:1.7;color:var(--text)}.mp-upd ul li::marker{color:var(--accent,var(--muted))}
.mp-upd .mp-upd-more{flex-basis:100%;border:0;background:none;color:var(--accent,var(--text));font:inherit;font-size:13px;padding:0;cursor:pointer;text-align:start}
@media (display-mode: standalone){html,body{overscroll-behavior-y:contain}}`;
  document.head.appendChild(st);

  /* ---------- iOS meta + splash (added at runtime to keep index.html minimal) ---------- */
  const SPLASH = [[640, 1136], [750, 1334], [828, 1792], [1080, 2340], [1125, 2436], [1170, 2532], [1179, 2556], [1206, 2622], [1242, 2688], [1284, 2778], [1290, 2796], [1320, 2868], [1536, 2048], [1668, 2388], [2048, 2732]];
  function head(tag, attrs) { const el = document.createElement(tag); for (const k in attrs) el.setAttribute(k, attrs[k]); document.head.appendChild(el); return el; }
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    head("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    head("meta", { name: "mobile-web-app-capable", content: "yes" });
    head("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
    head("meta", { name: "apple-mobile-web-app-title", content: "مجتمع بلس" });
    if (!document.querySelector('link[rel="icon"]')) head("link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/icons/favicon-32.png" });
    if (ios()) for (const [w, h] of SPLASH) { const dpr = w <= 828 || w >= 1536 ? 2 : 3;
      head("link", { rel: "apple-touch-startup-image", href: `/icons/splash-${w}x${h}.png`, media: `(device-width: ${Math.round(w / dpr)}px) and (device-height: ${Math.round(h / dpr)}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)` }); }
  }

  /* ---------- bars ---------- */
  function bar(id, html, actions) {
    document.getElementById(id)?.remove();
    const el = document.createElement("div"); el.id = id; el.className = "mp-pwa-bar"; el.setAttribute("role", "status"); el.innerHTML = html;
    document.body.appendChild(el);
    for (const sel in actions) el.querySelector(sel)?.addEventListener("click", () => actions[sel](el));
    return el;
  }

  /* ---------- install ---------- */
  let bip = window.__bip || null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); bip = window.__bip = e; maybeOffer(); });
  addEventListener("appinstalled", () => { bip = window.__bip = null; document.getElementById("mp-install")?.remove(); localStorage.setItem("mp-installed", "1"); T("ثُبّت مجتمع بلس على جهازك ✓"); });
  const installable = () => !standalone() && (!!bip || (ios() && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)));
  async function install() {
    if (bip) { bip.prompt(); const c = await bip.userChoice.catch(() => ({})); bip = window.__bip = null; if (c.outcome !== "accepted") localStorage.setItem("mp-install-x", String(Date.now())); document.getElementById("mp-install")?.remove(); return; }
    if (ios() && typeof sheet === "function") sheet(`<h4 class="u-mt0">أضف مجتمع بلس إلى الشاشة الرئيسية</h4><ol class="mp-ios-steps"><li>اضغط زر المشاركة <b>⎋</b> في Safari</li><li>اختر «إضافة إلى الشاشة الرئيسية»</li><li>اضغط «إضافة»</li></ol>
      <p class="muted">${iosVer() && iosVer() < 16.4 ? "تحتاج iOS ‏16.4 أو أحدث لتصلك الإشعارات." : "بعد التثبيت افتح التطبيق من الشاشة الرئيسية لتفعيل الإشعارات."}</p><button class="btn block" id="mp-ios-ok">حسناً</button>`).querySelector("#mp-ios-ok")?.addEventListener("click", () => closeSheet());
  }
  function maybeOffer() {
    if (!installable() || document.getElementById("mp-install")) return;
    const x = +localStorage.getItem("mp-install-x") || 0; if (Date.now() - x < 14 * 864e5) return;
    const visits = +localStorage.getItem("mp-visits") || 0; if (visits < 2) return;
    if (!/^#\/(home)?$/.test(location.hash || "#/")) return;
    bar("mp-install", `<b>ثبّت مجتمع بلس على جهازك: أسرع، يعمل بلا اتصال، وإشعارات فورية</b><button class="btn" data-a="go">تثبيت</button><button class="mp-pwa-x" data-a="x" aria-label="لاحقاً">×</button>`,
      { '[data-a="go"]': () => install(), '[data-a="x"]': (el) => { localStorage.setItem("mp-install-x", String(Date.now())); el.remove(); } });
  }
  if (!sessionStorage.getItem("mp-visit")) { sessionStorage.setItem("mp-visit", "1"); localStorage.setItem("mp-visits", String((+localStorage.getItem("mp-visits") || 0) + 1)); }
  setTimeout(maybeOffer, 4000);

  /* ---------- store-less updates ---------- */
  let reloading = false, wantReload = false, lastCheck = Date.now();
  /* v2.68: «يوجد تحديث» shows the new version number (Arabic digits in Arabic) and a short what's-new list from /whatsnew.json */
  const isEn = () => (document.documentElement.lang || "ar").startsWith("en");
  const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
  const fmtVer = (v) => { v = String(v || "").replace(/^mp-/, "").replace(/^v/i, ""); return isEn() ? v : v.replace(/\d/g, (d) => AR_DIGITS[d]).replace(/\./g, "٫"); };
  const notesFetch = () => fetch("/whatsnew.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const notesOf = (list, v) => { v = String(v || "").replace(/^mp-/, ""); const n = (Array.isArray(list) ? list : []).find((x) => x && x.v === v) || (Array.isArray(list) ? list[0] : null); return n ? { v: n.v, ...(isEn() ? n.en : n.ar) } : null; };
  const swVersion = (w) => new Promise((res) => { if (!w) return res(null); try { const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(/^\d+\.\d+/.test(String(e.data || "")) ? e.data : null); w.postMessage("mp-app-version", [ch.port2]); } catch { return res(null); } setTimeout(() => res(null), 800); });
  const listHtml = (items, max) => `<ul>${(items || []).slice(0, max).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  async function offerUpdate(reg) {
    if (!reg.waiting || !SW.controller) return;
    const [list, wv] = await Promise.all([notesFetch(), swVersion(reg.waiting)]);
    if (!reg.waiting) return;
    const n = notesOf(list, wv), ver = (wv || n?.v || "").replace(/^mp-/, "");
    const en = isEn(), items = n?.items || [];
    const html = `<div class="mp-upd-h"><b>${en ? "A new update is available" : "يوجد تحديث جديد"}</b>${ver ? `<span class="mp-upd-v">${en ? "Version" : "الإصدار"} <bdi>${esc(fmtVer(ver))}</bdi>${n?.title ? " · " + esc(n.title) : ""}</span>` : ""}</div>`
      + `<button class="btn" data-a="up">${en ? "Update" : "تحديث"}</button><button class="mp-pwa-x" data-a="x" aria-label="${en ? "Later" : "لاحقاً"}">×</button>`
      + (items.length ? listHtml(items, 3) + (items.length > 3 ? `<button class="mp-upd-more" data-a="more">${en ? "Show all changes" : "عرض كل التعديلات"}</button>` : "") : "");
    const el = bar("mp-update", html, {
      '[data-a="up"]': (el) => { wantReload = true; try { localStorage.setItem("mp-upd-from", String((typeof DB !== "undefined" && DB.serverVersion) || "")); } catch { } const b = el.querySelector('[data-a="up"]'); if (b) { b.disabled = true; b.textContent = en ? "Updating…" : "جارٍ التحديث…"; } reg.waiting?.postMessage("mp-skip-waiting"); setTimeout(() => { if (!reloading) location.reload(); }, 4000); },
      '[data-a="x"]': (el) => el.remove(),
      '[data-a="more"]': (el) => { el.querySelector("ul")?.replaceWith(Object.assign(document.createElement("div"), { innerHTML: listHtml(items, 20) }).firstChild); el.querySelector('[data-a="more"]')?.remove(); }
    });
    el.classList.add("mp-upd");
  }
  /* after an update: one short «تم التحديث إلى الإصدار …» card with what changed */
  async function showUpdated() {
    const cur = String((typeof DB !== "undefined" && DB.serverVersion) || "__APP_VERSION__").replace(/^mp-/, "");
    if (!/^\d+\.\d+/.test(cur)) return;
    let last = "", visits = 0; try { last = localStorage.getItem("mp-last-ver") || ""; visits = +localStorage.getItem("mp-visits") || 0; localStorage.setItem("mp-last-ver", cur); localStorage.removeItem("mp-upd-from"); } catch { return; }
    // show once after a version change; a returning visitor who predates this card also sees it once
    if (last ? last === cur : visits < 2) return;
    const n = notesOf(await notesFetch(), cur); if (!n || n.v !== cur) return;
    const en = isEn();
    bar("mp-updated", `<div class="mp-upd-h"><b>${en ? "Updated to version" : "تم التحديث إلى الإصدار"} <bdi>${esc(fmtVer(cur))}</bdi></b>${n.title ? `<span class="mp-upd-v">${esc(n.title)}</span>` : ""}</div><button class="mp-pwa-x" data-a="x" aria-label="${en ? "Close" : "إغلاق"}">×</button>${listHtml(n.items, 5)}`,
      { '[data-a="x"]': (el) => el.remove() }).classList.add("mp-upd");
  }
  setTimeout(showUpdated, 2500);
  async function checkUpdate(manual) {
    const reg = SW && await SW.getRegistration().catch(() => null); if (!reg) { if (manual) T("التحديثات غير متاحة في هذا المتصفح"); return false; }
    lastCheck = Date.now();
    try { await reg.update(); } catch { if (manual) T("تعذّر التحقق من التحديثات بلا اتصال"); return false; }
    if (reg.waiting) { offerUpdate(reg); return true; }
    if (manual) T(reg.installing ? "يجري تنزيل التحديث…" : "أنت على أحدث إصدار ✓");
    return !!reg.installing;
  }
  if (SW) {
    SW.addEventListener("controllerchange", () => { if (wantReload && !reloading) { reloading = true; location.reload(); } });
    SW.getRegistration().then((reg) => {
      if (!reg) return;
      if (reg.waiting) offerUpdate(reg);
      reg.addEventListener("updatefound", () => { const w = reg.installing; w?.addEventListener("statechange", () => { if (w.state === "installed") offerUpdate(reg); }); });
    }).catch(() => { });
    addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - lastCheck > 30 * 60e3) checkUpdate(false); });
    setInterval(() => checkUpdate(false), 60 * 60e3);
  }

  /* ---------- offline + drafts queue ---------- */
  const pill = document.createElement("div"); pill.className = "mp-off"; pill.setAttribute("aria-live", "polite"); pill.textContent = "أنت بلا اتصال · تقرأ آخر نسخة محفوظة، ومسوداتك تُحفظ وتُرسل لاحقاً";
  document.body.appendChild(pill);
  const net = () => { document.body.classList.toggle("mp-offline", !navigator.onLine); if (navigator.onLine) flush(); };
  async function flush() { const reg = SW && await SW.getRegistration().catch(() => null); (reg?.active || SW?.controller)?.postMessage("mp-drafts-flush"); }
  addEventListener("online", net); addEventListener("offline", net); net();
  SW?.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.type === "mp-drafts-flushed" && (d.sent || d.conflicts)) T(d.conflicts ? `أُرسلت ${d.sent} مسودة، و${d.conflicts} عُدّلت من جهاز آخر فبقيت نسخته` : `أُرسلت ${d.sent} مسودة حُفظت بلا اتصال ✓`);
  });
  async function queued() {
    return new Promise((res) => { try { const o = indexedDB.open("mp-pwa", 1); o.onupgradeneeded = () => o.result.createObjectStore("drafts"); o.onerror = () => res(0);
      o.onsuccess = () => { try { const r = o.result.transaction("drafts").objectStore("drafts").count(); r.onsuccess = () => { res(r.result); o.result.close(); }; r.onerror = () => res(0); } catch { res(0); } }; } catch { res(0); } });
  }

  /* ---------- share target (#/share) ---------- */
  async function readShare() {
    if (!("caches" in window)) return null;
    const c = await caches.open("mp-share"), m = await c.match("/__share/meta"); if (!m) return null;
    const meta = await m.json(), files = [];
    for (let i = 0; i < (meta.files || 0); i++) { const r = await c.match("/__share/file-" + i); if (r) { const b = await r.blob(); files.push(new File([b], decodeURIComponent(r.headers.get("X-Name") || "image"), { type: b.type })); } }
    return { ...meta, files, clear: async () => { for (const k of await c.keys()) await c.delete(k); } };
  }
  async function shareView() {
    if (typeof view !== "undefined" && view) view.innerHTML = `<div class="wrap"><div class="card"><b>جارٍ تجهيز المشاركة…</b></div></div>`;
    const s = await readShare().catch(() => null);
    const text = s ? [s.title, s.text, s.url && !String(s.text || "").includes(s.url) ? s.url : ""].filter(Boolean).join("\n\n") : "";
    const images = [], alts = [];
    if (s?.files.length) {
      if (!remote() || !navigator.onLine) T("ستُرفق الصور بعد الاتصال بالخادم");
      else for (const f of s.files) { try { const r = await Remote.api("POST", "/api/media", null, f); if (r?.media?.url) { images.push(r.media.url); alts.push(""); } } catch (e) { T(e.message || "تعذّر رفع صورة"); } }
    }
    if (s && (images.length || !s.files.length)) await s.clear();
    if (location.search || /^#\/share/.test(location.hash)) { history.replaceState(null, "", "/#/home"); if (typeof route === "function") route(); }
    if (typeof window.MPComposer === "function") window.MPComposer({ data: { markdown: text, images, alts } });
  }

  /* opened by the share target / «منشور جديد» shortcut: /?source=share (no chunks.js route → 0 B in core) */
  function fromShare() {
    if (new URLSearchParams(location.search).get("source") !== "share") return;
    const go = () => { if (typeof DB !== "undefined" && DB.onboarded && typeof window.MPComposer === "function") shareView(); else setTimeout(go, 500); };
    go();
  }
  /* ---------- #/app ---------- */
  async function appView() {
    const [c, q, reg] = await Promise.all([loadCfg(), queued(), SW ? SW.getRegistration().catch(() => null) : null]);
    const ver = (reg?.active && await swVersion(reg.active)) || "__APP_VERSION__"; // v2.68: a number like ٢٫٦٨٫٠, never the cache hash
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    const push = !c ? "تعذّر الاتصال بالخادم" : !c.push.enabled ? c.push.note : ios() && !standalone() ? "على iPhone وiPad: ثبّت التطبيق أولاً (iOS ‏16.4+) ثم فعّل الإشعارات من داخله" : perm === "granted" ? "مفعّلة على هذا الجهاز" : perm === "denied" ? "مرفوضة من إعدادات المتصفح" : "غير مفعّلة بعد";
    const row = (k, v) => `<div class="mp-app-row"><span>${k}</span><b class="muted">${esc(v)}</b></div>`;
    view.innerHTML = `<div class="wrap"><h2>التطبيق</h2><div class="card">
      ${row("التثبيت", standalone() ? "مثبّت ويعمل كتطبيق" : installable() ? "يمكن تثبيته" : "افتح الموقع في Chrome أو Safari لتثبيته")}
      ${row("الإشعارات", push)}
      ${row("بلا اتصال", (navigator.onLine ? "متصل" : "غير متصل") + (q ? ` · ${q} مسودة بانتظار الإرسال` : ""))}
      ${row("الإصدار", ver ? fmtVer(ver) : "—")}</div>
      ${installable() ? '<button class="u-mt10 btn block" id="mp-app-install">تثبيت التطبيق</button>' : ""}
      <button class="u-mt10 btn ghost block" id="mp-app-up">تحقق من التحديثات</button>
      ${c?.push.enabled && perm !== "granted" && !(ios() && !standalone()) ? '<a class="u-mt10 u-db u-tc btn ghost block" href="#/notifsettings">إعدادات الإشعارات</a>' : ""}
      <p class="muted">يعمل مجتمع بلس كتطبيق على Android وiPhone وسطح المكتب، ويتحدّث تلقائياً دون متجر. المنشورات التي فتحتها تبقى متاحة للقراءة بلا اتصال.</p></div>`;
    view.querySelector("#mp-app-install")?.addEventListener("click", install);
    view.querySelector("#mp-app-up")?.addEventListener("click", () => checkUpdate(true));
  }
  MPRoutes.extend((a, b) => ({ share: () => shareView(), app: () => appView() }));
  if (typeof Views !== "undefined" && Views.settings) {
    MPSettings.add(function () { view.querySelector(".wrap")?.insertAdjacentHTML("beforeend", `<a class="u-db card" href="#/app" id="mp-app-link"><b><svg class=ei aria-hidden=true><use href=#i-mobile /></svg> التطبيق</b><p class="u-m0 u-mt4 muted">التثبيت، العمل بلا اتصال، التحديثات</p></a>`); });
  }

  /* ---------- gestures: edge swipe back (touch, RTL-aware) ---------- */
  if ("ontouchstart" in window) {
    const ind = document.createElement("div"); ind.className = "mp-swipe"; ind.textContent = document.dir === "rtl" ? "›" : "‹"; ind.setAttribute("aria-hidden", "true"); document.body.appendChild(ind);
    let x0 = null, y0 = 0, dx = 0;
    const rtl = () => (document.documentElement.dir || document.dir) === "rtl";
    const blocked = () => !$("#sheet")?.classList.contains("hidden") || document.body.classList.contains("composing") || document.body.classList.contains("ob") || (window.MPNav ? MPNav.isRoot() : /^#\/(home)?$/.test(location.hash || "#/"));
    addEventListener("touchstart", (e) => { const t = e.touches[0], edge = rtl() ? innerWidth - t.clientX : t.clientX; x0 = e.touches.length === 1 && edge < 24 && !blocked() ? t.clientX : null; y0 = t.clientY; dx = 0; }, { passive: true });
    addEventListener("touchmove", (e) => { if (x0 === null) return; const t = e.touches[0]; dx = (rtl() ? x0 - t.clientX : t.clientX - x0); if (Math.abs(t.clientY - y0) > 40 && dx < 30) { x0 = null; ind.style.opacity = 0; return; }
      const p = Math.max(0, Math.min(1, dx / 90)); ind.style.opacity = p; ind.style.transform = `translateX(${(rtl() ? -1 : 1) * p * 24}px) scale(${0.7 + p * 0.3})`; }, { passive: true });
    addEventListener("touchend", () => { if (x0 === null) return; x0 = null; ind.style.opacity = 0; ind.style.transform = ""; if (dx > 90) { try { navigator.vibrate?.(8); } catch { /* no haptics */ } if (window.MPNav) MPNav.back(); else if (history.length > 1) history.back(); else location.hash = "#/home"; } }, { passive: true });
  }
  fromShare();
  if (/^#\/(share|app)(\/|$)/.test(location.hash) && typeof route === "function") route(); // chunk arrived after a direct visit
  window.MPPwa = { install, checkUpdate, standalone, installable, config: loadCfg, flush };
})();
