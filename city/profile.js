/* مجتمع بلس — «مدينة المجتمع الرقمية» page (city/profile.js).
 *   #/city                    «مدينة المجتمع الرقمية» on its own page, reached from «المزيد» (?debug=1 adds the calibration overlay)
 * A one-time hint tells a newcomer how the city works; it leaves after the first walk and never returns. */
(function CityProfile() {
  "use strict";
  const { el, T, esc } = MPCity.util;
  const HINT = "mp.city.hinted";
  const hinted = () => { try { return localStorage.getItem(HINT) === "1"; } catch { return true; } };

  function frame(host, opts) {
    host.innerHTML = "";
    const box = el("div", "cy-frame");
    host.append(box);
    const city = MPCity.mount(box, opts); if (!city) return null;
    const head = el("div", "cy-head");
    const st = city.scene.title, chipT = st ? (st[MPCity.util.lang()] || st.ar) : T("مدينتك");
    head.innerHTML = `<span class="cy-chip"><svg class="ic sm" aria-hidden="true"><use href="#i-${st ? "coin" : "building"}"/></svg><span>${esc(chipT)}</span></span>`;
    // «شخصيتي»: the member's character, top corner of the city — opens the picker (ذكر 3 · أنثى 2)
    if (MPCity.chars) {
      const b = el("button", "cy-me", { type: "button", "aria-haspopup": "dialog" });
      const paint = () => { const c = MPCity.chars.find((x) => x.id === MPCity.charId()) || MPCity.chars[0]; b.innerHTML = `<span>${esc(T("شخصيتي"))}</span><img src="/city/chars/${c.id}.webp" alt="" width="40" height="50" decoding="async">`; b.setAttribute("aria-label", T("شخصيتي") + ": " + label(c)); };
      paint(); if (MPCity.pullChar) MPCity.pullChar().then(paint, () => { });
      b.addEventListener("click", () => picker(city, paint, b));
      head.append(b);
    }
    box.append(head);
    if (!hinted()) {
      const h = el("p", "cy-hint", { role: "note" });
      h.textContent = T("اضغط على مبنى أو شارع، وستمشي شخصيتك إليه");
      box.append(h);
      city.on("walk", () => { h.classList.add("bye"); setTimeout(() => h.remove(), 400); try { localStorage.setItem(HINT, "1"); } catch { } });
    }
    return city;
  }

  const label = (c) => (c.label && c.label[MPCity.util.lang()]) || c.label.ar;

  /* the character picker: a small sheet over the city. Gender first (ذكر · أنثى), then that gender's characters as
   * portraits; the pick is saved (this device + the member's synced prefs) and the city re-dresses at once. */
  function picker(city, paint, opener) {
    if (document.querySelector(".cy-pick")) return;
    const cur = MPCity.charId(), curC = MPCity.chars.find((c) => c.id === cur) || MPCity.chars[0];
    let g = curC.g, sel = cur;
    const o = el("div", "cy-pick", { role: "dialog", "aria-modal": "true", "aria-labelledby": "cy-pick-t" });
    const pal = city.scene.palette || {}; for (const k in pal) o.style.setProperty(k, pal[k]);
    o.innerHTML = `<div class="cy-pick-bg" data-x="1"></div><div class="cy-pick-card">
      <div class="cy-pick-h"><h3 id="cy-pick-t">${esc(T("شخصيتي"))}</h3><button type="button" class="cy-pick-x" data-x="1" aria-label="${esc(T("إغلاق"))}">×</button></div>
      <p class="cy-pick-s">${esc(T("اختر شخصيتك في المدينة. تظهر شخصيتك وحدها في مدينتك."))}</p>
      <div class="cy-seg" role="radiogroup" aria-label="${esc(T("الجنس"))}"><button type="button" role="radio" data-g="m">${esc(T("ذكر"))}</button><button type="button" role="radio" data-g="f">${esc(T("أنثى"))}</button></div>
      <div class="cy-chars" role="radiogroup" aria-label="${esc(T("الشخصيات"))}"></div>
      <button type="button" class="cy-pick-ok">${esc(T("اعتماد الشخصية"))}</button></div>`;
    const grid = o.querySelector(".cy-chars"), ok = o.querySelector(".cy-pick-ok");
    function render() {
      o.querySelectorAll(".cy-seg button").forEach((b) => { const on = b.dataset.g === g; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
      const list = MPCity.chars.filter((c) => c.g === g);
      if (!list.some((c) => c.id === sel)) sel = list[0].id;
      grid.dataset.n = String(list.length);
      grid.innerHTML = list.map((c) => `<button type="button" role="radio" class="cy-char${c.id === sel ? " on" : ""}" aria-checked="${c.id === sel}" data-c="${esc(c.id)}">
        <span class="cy-char-p"><img src="/city/chars/${esc(c.id)}.webp" alt="" width="128" height="160" decoding="async"></span><b>${esc(label(c))}</b>${c.id === cur ? `<small>${esc(T("الحالية"))}</small>` : ""}</button>`).join("");
      ok.disabled = sel === cur;
    }
    const close = () => { o.classList.remove("on"); setTimeout(() => o.remove(), 220); removeEventListener("keydown", key, true); if (opener && opener.isConnected) opener.focus(); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    o.addEventListener("click", (e) => {
      const t = e.target.closest("[data-x],[data-g],[data-c],.cy-pick-ok"); if (!t) return;
      if (t.dataset.x) return close();
      if (t.dataset.g) { g = t.dataset.g; render(); return; }
      if (t.dataset.c) { sel = t.dataset.c; render(); grid.querySelector(`[data-c="${sel}"]`).focus(); return; }
      if (t.classList.contains("cy-pick-ok") && MPCity.setChar(sel)) { city.setActor(window.MPCityActor || "token"); paint(); close(); }
    });
    addEventListener("keydown", key, true);
    render(); document.body.append(o);
    requestAnimationFrame(() => { o.classList.add("on"); (grid.querySelector(".on") || ok).focus(); });
  }

  /* «مدينة المجتمع الرقمية» — its own page, reached from «المزيد» only, never from the app's other pages (owner 2026-10-23).
   *   #/city              the city
   *   #/city/mjt          the MJT hall behind the vault door
   *   #/city/mjt/<room>   one of the hall's rooms (city/rooms.js): balance · history · send · earn · stats
   *   #/town[/…]          the old address, sent to #/city */
  const head = (back, title) => UI.pageHead({ back, title, id: "cy-pg-h" });

  /* v2.85 «دليل المدينة»: every building as a neon card under the map (one tap walks the character there and opens its
   * hall), so the city is quick to use and works fully without the map (keyboard, screen readers) */
  const DIR_SUB = { vidtik: "مقاطعك وأرقامها والرائج", communities: "مجتمعاتك وما يناسبك", work: "طلباتك وأحدث الفرص", courses: "تقدمك في الدورات", store: "منتجاتك وجديد السوق",
    mjt: "خزنة مجتمع كوين", local: "أنشطتك والأعلى تقييماً", records: "كل حركات رصيدك", harvest: "تعدين اليوم", wallet: "أرسل واستقبل" };
  function directory() {
    const pl = ((MPCityScenes.main || {}).places || []).filter((p) => p.href);
    return `<section class="cy-dir" aria-labelledby="cy-dir-h"><h3 id="cy-dir-h">${esc(T("دليل المدينة"))}</h3><ul>${pl.map((p) => `<li><a href="${esc(p.href)}" data-place="${esc(p.id)}" data-acc="${esc(p.accent || "#a875ff")}"><span class="cy-dir-i"><svg class="ic" aria-hidden="true"><use href="#i-${esc(p.icon)}"/></svg></span><span class="cy-dir-t"><b>${esc((p.label && p.label[MPCity.util.lang()]) || p.label.ar)}</b><small>${esc(T(DIR_SUB[p.id] || ""))}</small></span></a></li>`).join("")}</ul></section>`;
  }
  function wireDir(city) {
    const box = document.querySelector(".cy-dir"); if (!box) return;
    box.querySelectorAll("a[data-acc]").forEach((a) => a.style.setProperty("--cy-acc", a.dataset.acc));
    box.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-place]"); if (!a || !city || MPCity.util.reduced()) return;
      if (city.walkTo(a.dataset.place)) { e.preventDefault(); document.getElementById("cy-page-slot")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
  }
  /* the city's gold balance chip, top of the map: the member's real MJT balance, opens the balance room */
  function hud(city) {
    if (!city || typeof DB === "undefined" || !DB.me) return;
    const h = city.root.closest(".cy-frame")?.querySelector(".cy-head"); if (!h) return;
    const a = el("a", "cy-bal", { href: "#/city/mjt/balance" });
    a.innerHTML = `<svg class="ic sm" aria-hidden="true"><use href="#i-coin"/></svg><span class="cy-sr">${esc(T("رصيدك"))}</span><bdi dir="ltr">…</bdi><small>MJT</small>`;
    h.querySelector(".cy-chip")?.after(a);
    Remote.api("GET", "/api/mjt/me").then((m) => { const b = a.querySelector("bdi"); if (b) b.textContent = String(m.balance.mjt); }, () => a.remove());
  }
  MPRoutes.extend((a, b) => {
    const city = () => {
      const debug = /[?&]debug=1/.test(location.hash);
      a = (a || "").split("?")[0]; b = (b || "").split("?")[0];
      if (a === "mjt" && b && MPCity.room && MPCity.room(b)) return;
      if (a && a !== "mjt" && MPCity.hall && MPCity.hall(a)) return; // a building's own hall (city/halls.js)
      if (a === "mjt") {
        const t = (MPCityScenes.mjt.title || {})[MPCity.util.lang()] || "مجتمع كوين";
        view.innerHTML = `<div class="wrap cy-page cy-hall">${head(["#/city", T("مدينة المجتمع الرقمية")], t)}<div id="cy-page-slot" class="cy-slot cy-live"></div></div>`;
        frame(document.getElementById("cy-page-slot"), { scene: "mjt", place: "hall", debug });
        return;
      }
      view.innerHTML = `<div class="wrap cy-page cy-main">${head(["#/menu", T("المزيد")], T("مدينة المجتمع الرقمية"))}<div id="cy-page-slot" class="cy-slot cy-live"></div>${directory()}</div>`;
      const c = frame(document.getElementById("cy-page-slot"), { scene: "main", place: "page", debug });
      hud(c); wireDir(c);
    };
    return { city, town: () => { location.replace("#/city" + (a ? "/" + a : "") + (b ? "/" + b : "")); } };
  });
})();
