/* مجتمع بلس — «لقطات» boot (video/clips/boot.js): the LAST file of the "clips" chunk. Development (file:// or the dev server)
 * loads every script up front: render now when the app opened straight on the clips page, after every feature file has
 * registered its hooks. In production chunks.js loads the chunk before route() runs, so this is a no-op there. */
(function ClipsBoot() {
  // development (file://) loads every script up front: render now when the app opened straight on the clips page
  if (!window.__deferRoute && location.hash.match(/^#\/(shorts|clips)/)) route();
})();
