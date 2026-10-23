/* =====================================================================
 * مجتمع بلس — Client platform layer v2.2 (loaded first)
 * Error reporting, real-user performance (Web Vitals), service worker, feature flags, data saver.
 * Everything degrades silently when opened as a local file (offline demo).
 * ===================================================================== */
(function () {
  const ONLINE = location.protocol.startsWith("http");
  const MP = window.MP = { release: "2.3.0", online: ONLINE, flags: {}, lastRequestId: null };
  const pref = (k, d) => { try { const v = localStorage.getItem("mp_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  MP.pref = pref; MP.setPref = (k, v) => { try { localStorage.setItem("mp_" + k, JSON.stringify(v)); } catch { } };
  try { const c = localStorage.getItem("mp_a11yCss"); if (c) { const s = document.createElement("style"); s.id = "a11yCss"; s.textContent = c; document.head.appendChild(s); } } catch { } // phase 43: display settings before first paint (CSS made by a11y-ui.js)
  /* v2.82: also on by itself on a 2G-class connection; a member who switched the setting off explicitly (stored false) is respected */
  MP.dataSaver = () => { const c = navigator.connection, set = pref("dataSaver", null); if (set !== null) return !!set || !!(c && c.saveData); return !!(c && (c.saveData || /^(slow-)?2g$/.test(c.effectiveType || ""))); };

  /* ---- Declarative UI actions (phase 36b): the CSP has no 'unsafe-inline' for scripts, so markup uses
   * data-ui="close-sheet|back|compose|route|reload" instead of inline onclick="…" / javascript: URLs ---- */
  const UI_ACTS = {
    "close-sheet": () => window.closeSheet?.(),
    back: (e) => { e.preventDefault(); history.back(); },
    compose: () => window.MPComposer?.(),
    route: () => window.route?.(),
    reload: () => location.reload()
  };
  document.addEventListener("click", (e) => { const el = e.target?.closest?.("[data-ui]"); const fn = el && UI_ACTS[el.dataset.ui]; if (fn) fn(e); }, true);

  /* ---- Error reporting (Phase 1): grouped server-side by fingerprint, throttled client-side ---- */
  const sent = new Set();
  MP.report = function (err, extra = {}) {
    try {
      const message = String(err && (err.message || err) || "unknown").slice(0, 500), stack = String(err && err.stack || "").slice(0, 4000);
      const key = message + (stack.split("\n")[1] || ""); if (sent.has(key) || sent.size > 20) return; sent.add(key);
      if (!ONLINE) return console.warn("[mujtama]", message);
      fetch("/api/client-errors", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ message, stack, url: location.hash || "/", release: MP.release, requestId: MP.lastRequestId, ...extra }) }).catch(() => { });
    } catch { }
  };
  addEventListener("error", (e) => { if (e.error || e.message) MP.report(e.error || e.message); });
  addEventListener("unhandledrejection", (e) => { const r = e.reason; if (r && (r.status === 401 || r.status === 429)) return; MP.report(r || "unhandled rejection"); });

  /* ---- Real-user monitoring (Phase 5): LCP, FCP, CLS, INP (approx.), TTFB, long tasks ---- */
  const vit = {}; let cls = 0, inp = 0, longTasks = 0;
  const obs = (type, fn, opts = {}) => { try { new PerformanceObserver(l => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts }); } catch { } };
  obs("largest-contentful-paint", e => vit.LCP = e.startTime);
  obs("paint", e => { if (e.name === "first-contentful-paint") vit.FCP = e.startTime; });
  obs("layout-shift", e => { if (!e.hadRecentInput) cls += e.value; });
  obs("event", e => { if (e.interactionId) inp = Math.max(inp, e.duration); }, { durationThreshold: 40 });
  obs("longtask", () => longTasks++);
  let flushed = false;
  function flushVitals() {
    if (flushed || !ONLINE || !MP.flags.rum && MP.flags.rum !== undefined) return; flushed = true;
    const nav = performance.getEntriesByType("navigation")[0];
    const metrics = [["LCP", vit.LCP], ["FCP", vit.FCP], ["CLS", cls], ["INP", inp || undefined], ["TTFB", nav && nav.responseStart], ["LONGTASK", longTasks]]
      .filter(([, v]) => v !== undefined && v !== null).map(([name, value]) => ({ name, value: Math.round(value * 1000) / 1000, route: (location.hash.split("/")[1] || "home") }));
    const body = JSON.stringify({ metrics, conn: navigator.connection && navigator.connection.effectiveType, device: matchMedia("(max-width:760px)").matches ? "mobile" : "desktop" });
    try { navigator.sendBeacon ? navigator.sendBeacon("/api/rum", new Blob([body], { type: "text/plain" })) : fetch("/api/rum", { method: "POST", body, keepalive: true }); } catch { }
  }
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushVitals(); });
  addEventListener("pagehide", flushVitals);

  /* ---- Feature flags (Phase 2): evaluated server-side per user, cached for offline starts ---- */
  MP.flags = pref("flags", {});
  MP.loadFlags = async () => { if (!ONLINE) return MP.flags; try { const r = await fetch("/api/flags", { credentials: "same-origin" }); if (r.ok) { MP.flags = (await r.json()).flags; MP.setPref("flags", MP.flags); } } catch { } return MP.flags; };
  MP.flag = (k, d = false) => (k in MP.flags ? MP.flags[k] : d);
  if (ONLINE) MP.loadFlags();

  /* ---- Service worker (Phase 5): instant repeat visits + offline shell ---- */
  if (ONLINE && "serviceWorker" in navigator && !/[?&]nosw/.test(location.search)) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { }));

  /* capture request ids from failed API calls for correlation */
  const _fetch = window.fetch.bind(window);
  window.fetch = async (...a) => { const r = await _fetch(...a); if (!r.ok) MP.lastRequestId = r.headers.get("x-request-id") || MP.lastRequestId; return r; };
})();
