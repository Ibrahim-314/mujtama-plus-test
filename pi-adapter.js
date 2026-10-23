/* PiAdapter (phase 36, App Studio sign-in in 36b) — the single integration point with Pi Network, kept small (core bundle).
 * • config(): GET /api/pi/config (public) → {enabled (payments), authEnabled (sign-in), network, sandbox}.
 * • init(): the Pi SDK is loaded by index.html (<script src="https://sdk.minepi.com/pi-sdk.js" async id="pi-sdk">; v2.51: async,
 *   so a slow minepi.com never blocks the first paint; sdk() waits for that tag, an on-demand load stays as the fallback) and
 *   initialised once with await Pi.init({version:"2.0"}) — no sandbox option (App Studio requirement).
 * • authenticate(): scopes username + payments; resolves with { accessToken } only (the SDK's user object is dropped:
 *   the server learns uid/username from its own App Studio exchange). An incomplete payment found by the SDK is
 *   queued and handed to the server (POST /api/pi/payments/incomplete) only after /api/pi/auth succeeds.
 *   The access token is never logged or stored client-side.
 * • createPayment(): kept for old callers; opens the unified pay sheet of the lazy "pi" chunk (pi-ui.js) and
 *   resolves with the result, or null when the sheet is closed without paying. */
const PiAdapter = {
  ready: false, cfg: null,
  available() { return typeof window.Pi !== "undefined"; },
  inPiBrowser() { return /PiBrowser/i.test(navigator.userAgent) || !!window.MP_PI_BROWSER; },
  async config() {
    if (!this.cfg) try { const r = await fetch("/api/pi/config", { credentials: "same-origin" }); this.cfg = r.ok ? await r.json() : { enabled: false }; } catch { return { enabled: false }; }
    return this.cfg;
  },
  sdk() {
    if (this.available()) return Promise.resolve();
    const inject = () => new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://sdk.minepi.com/pi-sdk.js"; s.onload = res; s.onerror = () => rej(new Error("تعذر تحميل Pi SDK")); document.head.appendChild(s); });
    // the async tag from index.html may still be downloading: wait for it (load/error, or up to 10 s), then inject a fresh copy if it failed
    const tag = document.getElementById("pi-sdk");
    const waitTag = () => new Promise((res) => {
      if (!tag || this.available()) return res();
      try { if (performance.getEntriesByName(tag.src).some((e) => e.responseEnd > 0)) return setTimeout(res, 0); } catch { /* no resource timing */ } // already finished
      let done = false; const fin = () => { if (!done) { done = true; clearInterval(t); res(); } };
      tag.addEventListener("load", fin, { once: true }); tag.addEventListener("error", fin, { once: true });
      const t0 = Date.now(), t = setInterval(() => { if (this.available() || Date.now() - t0 > 10e3) fin(); }, 100);
    });
    return (this._sdk ||= waitTag().then(() => (this.available() ? undefined : inject())).catch((e) => { this._sdk = null; throw e; }));
  },
  async init() {
    if (this.ready) return true;
    const c = await this.config(); if (!c.enabled && !c.authEnabled) return false;
    try { await this.sdk(); await (this._init ||= Promise.resolve(window.Pi.init({ version: "2.0" }))); this.ready = true; } catch (e) { this._init = null; console.warn("Pi init failed", e?.message); }
    return this.ready;
  },
  serverCall(path, body) { return Remote.api("POST", path, body); },
  async authenticate() {
    if (!(await this.init())) return null;
    // fires during authenticate, before our session may exist: queued, sent by flushIncomplete() after /api/pi/auth
    const onIncompletePaymentFound = (payment) => { if (payment) this.incomplete.push(payment); };
    const r = await window.Pi.authenticate(["username", "payments"], onIncompletePaymentFound);
    return r?.accessToken ? { accessToken: r.accessToken } : null; // only the token goes to POST /api/pi/auth
  },
  incomplete: [],
  async flushIncomplete() { // → [{status: completed|cancelled|pending}] (needs a signed-in, linked account)
    const q = this.incomplete.splice(0), out = [];
    for (const payment of q) try { out.push(await this.serverCall("/api/pi/payments/incomplete", { payment })); } catch (e) { if (e.status === 409 || e.status >= 500) this.incomplete.push(payment); }
    return out;
  },
  async createPayment(amount, memo, metadata = {}) {
    if (!window.MPPi) await window.MPChunks?.load("pi");
    if (!window.MPPi) throw new Error("مدفوعات Pi غير مفعّلة بعد");
    return window.MPPi.paySheet({ amount, memo, purpose: metadata.purpose || (metadata.post ? "tip" : "donation"), refId: metadata.post || metadata.refId || null });
  }
};
