/* مجتمع بلس — «المدينة» boot (city/boot.js), the LAST file of the "town" chunk. Development loads every script up front:
 * render now when the app opened straight on #/town, or fill a profile slot already on the page. In production chunks.js
 * loads the chunk before route() runs (and city/entry.js mounts the profile slot), so this is a no-op there. */
(function CityBoot() {
  if (window.__deferRoute) return;
  if (/^#\/town/.test(location.hash) && typeof route === "function") route();
  const slot = document.getElementById("cy-slot"); if (slot && !slot._city && window.MPCityMountProfile) MPCityMountProfile(slot);
})();
