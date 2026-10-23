/* مجتمع بلس — «المدينة» portal (city/portal.js). Arriving at a building door: the character steps into the light, then a
 * full-screen portal takes over — the building's emblem assembles from light inside orbiting rings, «جارٍ الدخول إلى …»
 * and a progress line — and the building's own system opens underneath. The city only opens the door; the system it
 * leads to stays independent. Reduced motion: a short cross-fade, no rings or particles.
 * MPCity.portal(place, href) can also be called by a feature (e.g. an interior's «خروج»).
 * The city links only to its own pages (#/city/…): a building with no hall yet shows a «قيد البناء» card instead. */
(function CityPortal() {
  "use strict";
  const { el, esc, T, label, reduced } = MPCity.util;
  let busy = false;

  /* the MJT vault door: a round gold door with its bolts and wheel turns, unlocks and swings open into gold light */
  const vaultHTML = (name) => `<div class="cy-p-grid" aria-hidden="true"></div><div class="cy-v" aria-hidden="true"><span class="cy-v-glow"></span>`
    + `<span class="cy-v-door"><span class="cy-v-bolts">${"<i></i>".repeat(12)}</span><span class="cy-v-ring"></span><span class="cy-v-wheel"><i></i><i></i><i></i><b></b></span></span></div>`
    + `<p class="cy-p-t">${esc(T("جارٍ فتح خزنة"))} <bdi>${esc(name)}</bdi></p><div class="cy-p-bar" aria-hidden="true"><span></span></div>`;

  function portal(place, href, opts) {
    if (busy) return; busy = true; opts = opts || {};
    const rm = reduced(), name = label(place), acc = place.accent || "#a875ff", vault = !!opts.vault;
    const o = el("div", "cy-portal" + (rm ? " rm" : "") + (vault ? " cy-vault" : ""), { role: "status", "aria-live": "polite" });
    o.style.setProperty("--cy-acc", acc);
    const pal = ((window.MPCityScenes || {}).main || {}).palette || {}; for (const k in pal) o.style.setProperty(k, pal[k]);
    const dots = rm ? "" : "<i></i>".repeat(14);
    o.innerHTML = vault ? vaultHTML(name) : `<div class="cy-p-grid" aria-hidden="true"></div><div class="cy-p-core" aria-hidden="true"><span class="cy-p-ring r1"></span><span class="cy-p-ring r2"></span><span class="cy-p-ring r3"></span><span class="cy-p-sparks">${dots}</span><span class="cy-p-emblem">${place.icon ? `<svg class="ic" aria-hidden="true"><use href="#i-${esc(place.icon)}"/></svg>` : `<b>${esc(name.charAt(0))}</b>`}</span></div>`
      + `<p class="cy-p-t">${opts.text ? `<bdi>${esc(opts.text)}</bdi>` : `${esc(T("جارٍ الدخول إلى"))} <bdi>${esc(name)}</bdi>`}</p><div class="cy-p-bar" aria-hidden="true"><span></span></div>`;
    o.querySelectorAll(".cy-p-sparks i, .cy-v-bolts i").forEach((n, i) => n.style.setProperty("--i", String(i)));
    document.body.append(o);
    requestAnimationFrame(() => o.classList.add("on"));
    const hold = rm ? 260 : opts.hold || (vault ? 1900 : 1250);
    setTimeout(() => {
      const leave = () => { o.classList.add("out"); setTimeout(() => { o.remove(); busy = false; }, rm ? 120 : 380); };
      if (href && location.hash !== href) { addEventListener("hashchange", () => setTimeout(leave, 220), { once: true }); location.hash = href; setTimeout(() => { if (o.isConnected && !o.classList.contains("out")) leave(); }, 2500); }
      else leave();
    }, hold);
  }

  /* a building whose own hall is not built yet: a small neon card over the city — the city never sends the member to the
   * app's pages (owner 2026-10-23) */
  function soon(pl, city) {
    const old = city.root.querySelector(".cy-soon"); if (old) old.remove();
    const c = el("div", "cy-soon", { role: "status", "aria-live": "polite" });
    c.style.setProperty("--cy-acc", pl.accent || "#a875ff");
    c.innerHTML = `${pl.icon ? `<svg class="ic" aria-hidden="true"><use href="#i-${esc(pl.icon)}"/></svg>` : ""}<span><b>${esc(label(pl))}</b><small>${esc(T("قاعة هذا المبنى قيد البناء، وستُفتح قريباً داخل المدينة"))}</small></span>`;
    city.root.append(c); requestAnimationFrame(() => c.classList.add("on"));
    setTimeout(() => { c.classList.remove("on"); setTimeout(() => c.remove(), 300); }, 3200);
  }

  MPCity.portal = portal;
  MPCity.use((city) => {
    city.on("arrive", (goal) => {
      if (!goal || goal.kind !== "place") return;
      const pl = goal.place, a = city.actor;
      if (a && a.enter) a.enter();
      city.root.classList.add("cy-entering");
      setTimeout(() => {
        if (pl.back) { // an interior's «خروج»: back to the city the member came from (profile or #/town)
          portal(pl, "#/city", { text: T("العودة إلى المدينة") });
        } else if (pl.vault) { // the MJT vault: remember which city opened it, and walk in at the gate
          try { sessionStorage.removeItem("mp.city.at.mjt"); } catch { }
          portal(pl, pl.href, { vault: true });
        } else if (pl.href) portal(pl, pl.href);
        else soon(pl, city); // a building whose hall is still being built
        // when the member comes back the character waits at the door it entered
        setTimeout(() => { if (a && a.exit) a.exit(); city.root.classList.remove("cy-entering"); }, 900);
      }, MPCity.util.reduced() ? 0 : 380);
    });
  });
})();
