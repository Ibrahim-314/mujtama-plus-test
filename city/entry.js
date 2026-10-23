/* مجتمع بلس — «المدينة» entry (city/entry.js, core bundle, tiny). Own profile (#/me) only: reserves the city's place at
 * the very top of the page — above the cover and the profile info — and loads the lazy "town" chunk that fills it.
 * The slot is created once and moved back on every profile re-render (tabs, edits), so the city keeps its state and the
 * character never jumps. Turned off with localStorage "mp.city" = "off" (Settings toggle arrives with the city settings). */
(function CityEntry() {
  if (typeof Views === "undefined" || !Views.profile) return;
  let slot = null;
  const off = () => { try { return localStorage.getItem("mp.city") === "off"; } catch { return false; } };
  const own = (handle) => { const me = typeof S !== "undefined" && S.me && S.me(); return !!me && (!handle || handle === me.handle) && !/[?&]as=public/.test(location.hash); };
  const _p = Views.profile;
  Views.profile = function (handle) {
    const r = _p.apply(this, arguments);
    try {
      if (off() || !own(handle) || typeof view === "undefined" || !view) return r;
      if (!slot) {
        slot = document.createElement("section"); slot.className = "cy-slot"; slot.id = "cy-slot";
        slot.setAttribute("aria-label", window.MPI18n && MPI18n.t ? MPI18n.t("مدينتك") : "مدينتك");
        slot.innerHTML = '<div class="cy-skel" aria-hidden="true"></div>';
      }
      if (view.firstElementChild !== slot) view.prepend(slot);
      if (!slot._city && !slot._loading && window.MPChunks) {
        slot._loading = true;
        MPChunks.load("town").then(() => { slot._loading = false; if (window.MPCityMountProfile) MPCityMountProfile(slot); }, () => { slot._loading = false; slot.remove(); slot = null; });
      } else if (!window.MPChunks && window.MPCityMountProfile && !slot._city) MPCityMountProfile(slot); // development: every script is on the page
    } catch (e) { console.error("[city]", e); }
    return r;
  };
})();
