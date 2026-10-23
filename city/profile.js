/* مجتمع بلس — «المدينة» on the profile and its own page (city/profile.js).
 *   MPCityMountProfile(slot)  fills the slot city/entry.js put at the top of #/me (kept alive across re-renders)
 *   #/town                    the city on its own page (deep link; ?debug=1 adds the calibration overlay)
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

  window.MPCityMountProfile = (slot) => {
    if (!slot || slot._city) return;
    slot._city = frame(slot, { scene: "main", place: "profile", keepAlive: true });
    slot.classList.add("cy-live");
  };

  // the city on its own page — a deep link and the calibration view
  MPRoutes.extend((a) => ({
    town: () => {
      const debug = /[?&]debug=1/.test(location.hash);
      // #/town/mjt — the MJT hall behind the vault door: its own page, its own scene, back to the city it came from
      if (a === "mjt") {
        let from = "#/me"; try { from = sessionStorage.getItem("mp.city.from") || from; } catch { }
        const t = (MPCityScenes.mjt.title || {})[MPCity.util.lang()] || "مجتمع كوين";
        view.innerHTML = `<div class="wrap cy-page cy-hall">${window.UI && UI.pageHead ? UI.pageHead({ back: [from, from === "#/town" ? T("مدينتك") : T("ملفي")], title: t }) : `<h2>${esc(t)}</h2>`}<div id="cy-page-slot" class="cy-slot cy-live"></div></div>`;
        frame(document.getElementById("cy-page-slot"), { scene: "mjt", place: "hall", debug });
        return;
      }
      view.innerHTML = `<div class="wrap cy-page">${window.UI && UI.pageHead ? UI.pageHead({ back: ["#/me", T("ملفي")], title: T("مدينتك") }) : `<h2>${esc(T("مدينتك"))}</h2>`}<div id="cy-page-slot" class="cy-slot cy-live"></div></div>`;
      frame(document.getElementById("cy-page-slot"), { scene: "main", place: "page", debug });
    }
  }));
})();
