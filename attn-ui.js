/* =====================================================================
 * مجتمع بلس — Phase 61 attention beacon (lazy "attn" chunk, loaded when idle; 0 bytes in core).
 * On a post page (#/post/:id) and in short videos (#/shorts) it measures, for signed-in members only:
 *   • visible time on the page (only while the tab is visible), • how far the article was read (scroll),
 *   • how long the video / audio actually played and the furthest point reached.
 * It sends one small report when the member leaves the post, hides the tab, or every 60 s while reading,
 * to /api/analytics/attention. The creator only ever sees aggregates. CSP: no inline handlers.
 * ===================================================================== */
(function AttentionBeacon() {
  if (window.MPAttn) return;
  let cur = null, timer = 0;
  const signedIn = () => typeof DB !== "undefined" && DB.me && DB.onboarded && !(typeof online === "function" && !online());
  const postId = () => { const m = /^#\/post\/([^/?]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };
  const fresh = (id, kind = "page") => ({ id, kind, ms: 0, mediaMs: 0, progress: 0, since: document.visibilityState === "visible" ? Date.now() : 0, media: new Map() });
  function tick() { if (cur && cur.since) { cur.ms += Date.now() - cur.since; cur.since = document.visibilityState === "visible" ? Date.now() : 0; } }
  function scrollProgress() {
    if (!cur || cur.kind !== "page") return;
    const el = document.scrollingElement || document.documentElement, max = el.scrollHeight - el.clientHeight;
    const p = max <= 0 ? 100 : Math.round(((el.scrollTop + 1) / max) * 100);
    if (p > cur.progress) cur.progress = Math.min(100, p);
  }
  function send(final) {
    if (!cur) return;
    tick();
    const body = { post: cur.id, kind: cur.kind, ms: Math.round(cur.ms), mediaMs: Math.round(cur.mediaMs), progress: cur.progress };
    if (body.ms >= 1000 || body.mediaMs >= 1000) {
      try { fetch("/api/analytics/attention", { method: "POST", keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify(body) }).catch(() => { }); } catch { /* best effort */ }
      cur.ms = 0; cur.mediaMs = 0; // progress is a maximum: kept
    }
    if (final) cur = null;
  }
  /* media: any <video>/<audio> on the post page (or the visible short) adds playing time + furthest point */
  function onMedia(e) {
    const m = e.target; if (!(m instanceof HTMLMediaElement) || !signedIn()) return;
    const short = m.closest("[data-short]"), pid = short ? short.dataset.short : postId(); if (!pid) return;
    if (!cur || cur.id !== pid) { send(true); cur = fresh(pid, m.tagName === "AUDIO" ? "audio" : "video"); }
    if (cur.kind === "page") cur.kind = m.tagName === "AUDIO" ? "audio" : "video";
    const st = cur.media.get(m) || { last: null }; cur.media.set(m, st);
    if (e.type === "timeupdate") {
      const t = m.currentTime; if (st.last !== null && t > st.last && t - st.last < 5) cur.mediaMs += (t - st.last) * 1000;
      st.last = t;
      if (m.duration && isFinite(m.duration)) cur.progress = Math.max(cur.progress, Math.min(100, Math.round((t / m.duration) * 100)));
    } else if (e.type === "seeking") st.last = null;
    else if (e.type === "ended") { cur.progress = 100; send(false); }
  }
  ["timeupdate", "seeking", "ended"].forEach((t) => document.addEventListener(t, onMedia, true));
  function onRoute() {
    const id = postId();
    if (cur && cur.id !== id && !/^#\/shorts/.test(location.hash)) send(true);
    if (id && signedIn() && (!cur || cur.id !== id)) { cur = fresh(id); setTimeout(scrollProgress, 400); }
  }
  addEventListener("hashchange", onRoute);
  addEventListener("scroll", () => { if (cur) scrollProgress(); }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") send(false); else if (cur) cur.since = Date.now(); });
  addEventListener("pagehide", () => send(true));
  timer = setInterval(() => { if (cur) send(false); }, 60e3);
  onRoute();
  window.MPAttn = { send, state: () => cur && { ...cur, media: undefined }, stop: () => clearInterval(timer), version: "__APP_VERSION__" };
})();
