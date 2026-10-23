/* مجتمع بلس — v2.82 «أول صورة أسرع» (video/clips/warm.js, chunk "clips").
 * On every clip change: decode the posters of the next 3 clips ahead of time (so a swipe shows a picture instantly),
 * and under data saver keep the next clip at preload="metadata" instead of "auto" (no video bytes until you get there). */
(function ClipsWarm() {
  const seen = new Set(), MAX = 60;
  const posterOf = (sec) => { const m = /url\(['"]?([^'")]+)['"]?\)/.exec(sec && sec.style && sec.style.backgroundImage || ""); return m && m[1]; };
  const warm = (url) => {
    if (!url || seen.has(url)) return; seen.add(url); if (seen.size > MAX) seen.delete(seen.values().next().value);
    const img = new Image(); img.decoding = "async"; img.fetchPriority = "low"; img.src = url; if (img.decode) img.decode().catch(() => {});
  };
  Clips.onCurrent((sec) => {
    let n = sec, ahead = 0; while (n && ahead < 3) { n = n.nextElementSibling; if (n && n.matches && n.matches("section.short")) { warm(posterOf(n)); ahead++; } }
    const saver = !!(window.MP && MP.dataSaver && MP.dataSaver());
    if (saver) { const nx = sec.nextElementSibling, v = nx && nx.querySelector && nx.querySelector(".short-player video"); if (v && v.preload === "auto" && v.paused) v.preload = "metadata"; }
  });
  Clips.onLeave(() => seen.clear());
})();
