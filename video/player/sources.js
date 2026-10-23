/* مجتمع بلس — video source picker (video/player/sources.js, core bundle; v2.73). Pure: no DOM writes, unit-tested.
 * MPVideoSources.pick(variants[, env]) → { all, srcs, useHlsJs }
 *   all       unique sources in preference order: HLS master → MP4 720p → MP4 360p → original upload
 *   srcs      the chain the <video> element tries, in order (the HLS master is left out when hls.js drives it)
 *   useHlsJs  true when there is a master, the browser has no native HLS but has MediaSource (Chrome/Firefox/Android)
 * env (tests): { canPlayType(mime) → "", "maybe" or "probably"; mediaSource: boolean; saver?: boolean }. Defaults read the browser. */
(function (root) {
  const HLS = "application/vnd.apple.mpegurl";
  const typeOf = (u) => /\.m3u8(\?|$)/.test(u) ? HLS : /\.webm(\?|$)/.test(u) ? "video/webm" : /\.(mp4|m4v|mov)(\?|$)/.test(u) ? "video/mp4" : "";
  let probe = null;
  const browserEnv = () => {
    probe ||= typeof document !== "undefined" ? document.createElement("video") : null;
    return { canPlayType: (t) => (probe ? probe.canPlayType(t) : ""), mediaSource: typeof (root.MediaSource || root.ManagedMediaSource) === "function" };
  };
  const saverOn = () => { try { return !!(root.MP && root.MP.dataSaver && root.MP.dataSaver()); } catch { return false; } };
  function pick(v, env) {
    const e = env || browserEnv(), can = (t) => !t || e.canPlayType(t) !== "";
    // v2.82 data saver: 360p MP4 first and no adaptive master (it would climb to 720p); falls back to the normal chain when there is no 360p
    const saver = e.saver !== undefined ? !!e.saver : saverOn();
    if (saver && v["360p"]) { const all = [v["360p"], v.original].filter((u, i, a) => u && a.indexOf(u) === i); let srcs = all.filter((u) => can(typeOf(u))); if (!srcs.length) srcs = all.slice(-1); return { all, srcs, useHlsJs: false, saver: true }; }
    const all = [v.master, v["720p"], v["360p"], v.original].filter((u, i, a) => u && a.indexOf(u) === i);
    let srcs = all.filter((u) => can(typeOf(u))); if (!srcs.length) srcs = all.slice(-1); // nothing claims support: still try the original
    const useHlsJs = !!v.master && !can(HLS) && !!e.mediaSource;
    if (useHlsJs) { const mp4 = srcs.filter((u) => u !== v.master); srcs = mp4.length ? mp4 : all.filter((u) => u !== v.master).slice(-1); } // the MP4 chain after hls.js
    return { all, srcs, useHlsJs };
  }
  /** v2.82: the poster to show — WebP (≈ 30–50% smaller) when the server made one, else the JPEG. Takes a post's video
   *  ({variants, poster}) or a variants object. */
  function poster(x) { const v = (x && x.variants) || x || {}; return v.posterWebp || v.poster || (x && x.poster) || ""; }
  const MPVideoSources = { pick, typeOf, poster };
  root.MPVideoSources = MPVideoSources;
  if (typeof module !== "undefined" && module.exports) module.exports = MPVideoSources;
})(typeof window !== "undefined" ? window : globalThis);
