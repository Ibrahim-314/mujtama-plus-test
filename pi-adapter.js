/* PiAdapter (phase 36, App Studio sign-in in 36b) — the single integration point with Pi Network, kept small (core bundle).
 * • config(): GET /api/pi/config (public) → {enabled (payments), authEnabled (sign-in), network, sandbox}.
 * • init(): the Pi SDK is loaded by index.html (<script src="https://sdk.minepi.com/pi-sdk.js" async id="pi-sdk">; v2.51: async,
 *   so a slow minepi.com never blocks the first paint; sdk() waits for that tag, an on-demand load stays as the fallback) and
 *   initialised once with await Pi.init({version:"2.0"}) — no sandbox option (App Studio requirement); v2.149.9: sandbox:true
 *   only when the server says sdkSandbox (PI_SDK_SANDBOX=1, testnet; Pi Developers Sandbox).
 * • authenticate(): scopes username (+ payments only while Pi payments are on, v2.149.11); resolves with { accessToken } only (the SDK's user object is dropped:
 *   the server learns uid/username from its own App Studio exchange). An incomplete payment found by the SDK is
 *   queued and handed to the server (POST /api/pi/payments/incomplete) only after /api/pi/auth succeeds.
 *   The access token is never logged or stored client-side.
 * • createPayment(): kept for old callers; opens the unified pay sheet of the lazy "pi" chunk (pi-ui.js) and
 *   resolves with the result, or null when the sheet is closed without paying. */
/* v2.149.11: boot() runs Pi.init at app start; diag() sends step beacons (POST /api/pi/diag) so a stuck sign-in shows where. */
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
    const t0 = Date.now();
    try {
      await this.sdk(); this.diag("sdk_loaded", "", t0);
      // v2.149.11: Pi.init answers at once in Pi Browser; 15 s without an answer = not a Pi host (diag init_err)
      await (this._init ||= Promise.race([Promise.resolve(window.Pi.init(this.useSandbox(c) ? { version: "2.0", sandbox: true } : { version: "2.0" })), new Promise((_, rej) => setTimeout(() => rej(new Error("init timeout")), 15e3))]));
      this.ready = true; this.diag("init_ok", "", t0);
    } catch (e) { this._init = null; this.diag("init_err", e?.message, t0); console.warn("Pi init failed", e?.message); }
    return this.ready;
  },
  // v2.149.11: started at app start (eager Pi.init) so a tap on «الدخول بحساب Pi» goes straight to Pi.authenticate
  boot() { return (this._boot ||= this.init().catch(() => false)); },
  host() { return this.inPiBrowser() || this.available(); }, // the sign-in button is usable: Pi Browser UA or the SDK is present
  framed() { try { return window.self !== window.top; } catch { return true; } },
  // v2.149.11: step beacons for Render logs (no token, no PII) — only in a Pi host or during a sign-in attempt
  diag(step, msg, t0, force) {
    if (!force && !this.inPiBrowser() && !this.framed() && !/^auth|^server/.test(step)) return;
    if ((this._dn = (this._dn || 0) + 1) > 40) return;
    try { fetch("/api/pi/diag", { method: "POST", keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ step, msg: String(msg || "").slice(0, 200), ua: navigator.userAgent.slice(0, 160), framed: this.framed(), ms: t0 ? Date.now() - t0 : 0 }) }).catch(() => { }); } catch { /* no fetch */ }
  },
  scopes(c) { return c?.enabled ? ["username", "payments"] : ["username"]; }, // v2.149.11: payments scope only while Pi payments are on
  // v2.149.10: sandbox mode only inside the sandbox.minepi.com frame — in Pi Browser (or a top-level tab) it waits forever for a parent
  useSandbox(c) { return !!c?.sdkSandbox && this.framed() && !this.inPiBrowser(); },
  serverCall(path, body) { return Remote.api("POST", path, body); },
  async authenticate() {
    if (!(await this.init())) return null;
    // fires during authenticate, before our session may exist: queued, sent by flushIncomplete() after /api/pi/auth
    const onIncompletePaymentFound = (payment) => { if (payment) this.incomplete.push(payment); };
    // v2.149.10: never spin forever — a Pi sign-in that does not answer in 90 s ends with a clear message
    let to; const t0 = Date.now(); const timeout = new Promise((_, rej) => { to = setTimeout(() => { this.diag("auth_timeout", "90s", t0); rej(new Error("انتهت مهلة الدخول بحساب Pi. افتح مجتمع بلس من متصفح Pi وحاول مرة أخرى.")); }, 90e3); });
    this.diag("auth_start", this.scopes(this.cfg).join(","), t0);
    const r = await Promise.race([window.Pi.authenticate(this.scopes(this.cfg), onIncompletePaymentFound), timeout]).then((x) => { this.diag(x?.accessToken ? "auth_ok" : "auth_err", x?.accessToken ? "" : "no token", t0); return x; }, (e) => { if (!/مهلة/.test(e?.message)) this.diag("auth_err", e?.message, t0); throw e; }).finally(() => clearTimeout(to));
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
