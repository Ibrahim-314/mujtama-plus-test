/* مجتمع بلس — v2.70 video quality-of-experience helper (video/player/qoe.js; lazy chunk "qoe", 0 bytes in core).
 * window.MPQoE.track(videoEl, postId, source[, stamps]) measures one playback of a <video>:
 *   startupMs  play request ('play' event or the moment track() is called while already requested) → first 'playing'
 *   stalls     'waiting' events after the first 'playing' (re-buffering), stallMs = time until the next 'playing'
 *   watchedMs  wall time actually playing (between 'playing' and pause/waiting/ended/finish)
 *   rung       current HLS level (_mpHls.currentLevel on the element or its player box) when hls.js drives it, else null
 *   stamps     optional {requestedAt, playingAt} (same clock: performance.now) recorded synchronously by the player, so a
 *              late attach (the chunk loads after play/'playing') still measures startup from the real play request.
 *              The object is read live: stamps written after track() are honoured too. Without it, the old behaviour.
 * A playback is finished on 'ended', when the element is reused for another src ('emptied'), when track() is called again
 * for the same element, or on page hide; finished playbacks are queued and sent to POST /api/video/qoe in batches
 * (navigator.sendBeacon on pagehide/visibilitychange=hidden, or as soon as 10 are queued). Numbers + post id only.
 * MPPlayer.mount wires it: MPChunks.load("qoe").then(() => window.MPQoE?.track(video, post.id, "clips" | "post", stamps)). */
/* global window, navigator, fetch, Blob, module */
(function QoE(root) {
  const ENDPOINT = "/api/video/qoe", FLUSH_AT = 10, BATCH_MAX = 20;
  const SOURCES = ["clips", "post"];
  const clock = () => (root.MPQoE && root.MPQoE._now ? root.MPQoE._now() : (root.performance && root.performance.now ? root.performance.now() : Date.now()));
  const queue = [];
  const live = new WeakMap(); // video element → session (re-tracking an element ends the previous session)
  const all = new Set();

  /* pure math — exported for the unit test */
  function summarize(s, t) {
    let watched = s.watchedMs, stallMs = s.stallMs;
    if (s.playingSince !== null) watched += t - s.playingSince;
    if (s.stallSince !== null) stallMs += t - s.stallSince;
    return {
      postId: s.postId, source: s.source,
      startupMs: Math.max(0, Math.round(s.startupMs)),
      stalls: s.stalls, stallMs: Math.max(0, Math.round(stallMs)), watchedMs: Math.max(0, Math.round(watched)),
      rung: s.rung
    };
  }
  function rungOf(el) {
    const box = el && (el.parentElement || el.parentNode), h = el && (el._mpHls || (box && box._mpHls)); if (!h) return null; // MPPlayer keeps hls.js on the box
    const lv = typeof h.currentLevel === "number" && h.currentLevel >= 0 ? h.currentLevel : (typeof h.loadLevel === "number" && h.loadLevel >= 0 ? h.loadLevel : null);
    return lv === null ? null : Math.min(15, lv);
  }

  function send(batch) {
    if (!batch.length) return;
    const body = JSON.stringify({ events: batch });
    try {
      if (navigator && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    } catch { /* fall through */ }
    try { if (typeof fetch === "function") fetch(ENDPOINT, { method: "POST", body, keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" } }).catch(() => { }); } catch { /* telemetry never throws */ }
  }
  function flush() { while (queue.length) send(queue.splice(0, BATCH_MAX)); }
  function enqueue(ev) { queue.push(ev); if (queue.length >= FLUSH_AT) flush(); }

  function track(el, postId, source, stamps) {
    if (!el || typeof el.addEventListener !== "function" || !postId || !SOURCES.includes(source)) return null;
    const prev = live.get(el); if (prev) prev.finish();
    const s = { postId: String(postId).slice(0, 64), source, requestedAt: null, startupMs: null, stalls: 0, stallMs: 0, watchedMs: 0, playingSince: null, stallSince: null, rung: null, done: false };
    const st = stamps && typeof stamps === "object" ? stamps : null, num = (x) => typeof x === "number" && isFinite(x) ? x : null;
    const reqAt = () => num(st && st.requestedAt) ?? s.requestedAt;
    if (st && num(st.requestedAt) !== null) {
      s.requestedAt = st.requestedAt;
      const pa = num(st.playingAt);
      if (pa !== null) { // attached after the first 'playing': startup is already known
        s.startupMs = Math.max(0, pa - s.requestedAt);
        if (el.paused === false) s.playingSince = pa;
        s.rung = rungOf(el);
      }
    } else if (!st && (el.autoplay || el.paused === false)) s.requestedAt = clock(); // legacy callers: autoplay may already have been requested
    const on = {
      play: () => { if (s.requestedAt === null) s.requestedAt = reqAt() ?? clock(); },
      playing: () => {
        const t = clock();
        if (s.startupMs === null) { const r = reqAt(); s.startupMs = t - (r === null ? t : r); }
        if (s.stallSince !== null) { s.stallMs += t - s.stallSince; s.stallSince = null; }
        if (s.playingSince === null) s.playingSince = t;
        s.rung = rungOf(el) ?? s.rung;
      },
      waiting: () => {
        const t = clock(); s.rung = rungOf(el) ?? s.rung;
        if (s.startupMs === null) return; // initial buffering counts as startup, not a stall
        if (s.playingSince !== null) { s.watchedMs += t - s.playingSince; s.playingSince = null; }
        if (s.stallSince === null) { s.stalls += 1; s.stallSince = t; }
      },
      pause: () => { const t = clock(); s.rung = rungOf(el) ?? s.rung; if (s.playingSince !== null) { s.watchedMs += t - s.playingSince; s.playingSince = null; } if (s.stallSince !== null) { s.stallMs += t - s.stallSince; s.stallSince = null; } },
      ended: () => finish(),
      emptied: () => { if (s.startupMs !== null) finish(); } // a source switch before the first frame (MP4 fallback) is still startup
    };
    function finish() {
      if (s.done) return null; s.done = true;
      for (const k in on) el.removeEventListener(k, on[k]);
      live.delete(el); all.delete(api);
      s.rung = rungOf(el) ?? s.rung;
      if (s.startupMs === null) return null; // never started playing: nothing to report
      const ev = summarize(s, clock()); enqueue(ev); return ev;
    }
    for (const k in on) el.addEventListener(k, on[k]);
    const api = { finish, snapshot: () => summarize(s, clock()), state: s };
    live.set(el, api); all.add(api);
    return api;
  }

  function finishAll() { for (const a of [...all]) a.finish(); flush(); }
  if (root.document && typeof root.addEventListener === "function") {
    root.addEventListener("pagehide", finishAll);
    root.document.addEventListener("visibilitychange", () => { if (root.document.visibilityState === "hidden") finishAll(); }); // the tab is going away or to the background: report what we have
  }

  const MPQoE = { track, flush, finishAll, summarize, rungOf, _queue: queue, _now: null, version: "2.70.0" };
  root.MPQoE = MPQoE;
  if (typeof module !== "undefined" && module.exports) module.exports = MPQoE;
})(typeof window !== "undefined" ? window : globalThis);
