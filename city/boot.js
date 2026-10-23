/* مجتمع بلس — «المدينة» boot (city/boot.js), the LAST file of the "town" chunk. Development loads every script up front:
 * render now when the app opened straight on #/city (or the old #/town). In production chunks.js loads the chunk before
 * route() runs, so this is a no-op there. */
(function CityBoot() {
  if (window.__deferRoute) return;
  if (/^#\/(city|town)/.test(location.hash) && typeof route === "function") route();
})();
