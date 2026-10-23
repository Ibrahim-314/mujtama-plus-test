/* =====================================================================
 * مجتمع بلس — v2.51 registries (core, loaded right after app.js)
 * Replaces the old override chains, where every module re-assigned a global and wrapped the previous one:
 *   window.ExtraRoutes = (a, b) => ({ ...prev(a, b), key })   (49 files)
 *   Views.settings = function () { prev(); addCard(); }        (23 files)
 * Now every module registers into ONE ordered list. The semantics are kept exactly:
 *  • MPRoutes.extend((a, b, prev) => ({ key: () => … }))  — a layer of routes; prev is the table built by the layers registered
 *    before it (same as the old `prev = _extra(a, b)`), later layers win for the same key (same as `{ ...prev, key }`).
 *  • MPRoutes.add(name, (a, b, next) => …)  — one route with an explicit hand-off: next() runs the handler registered before it
 *    for that name, or the core screen (settings → Views.settings, me/u → Views.profile, anything else → Views.notFound).
 *    This is how the shared `admin` route is built: each module claims its own #/admin/<x> and calls next() otherwise.
 *  • MPSettings.add(fn)  — runs after the settings screen rendered, in registration order (same order the wrappers ran).
 *    A hook that throws is logged and skipped; it no longer stops the hooks after it.
 *  • MPSession — "is someone signed in?" for modules that call protected APIs (set by sync.js): state "unknown" | "in" | "out";
 *    whenIn(fn) runs fn once the session is signed in (now, or after a later sign-in). Guests never start those calls.
 * window.ExtraRoutes stays the read side used by route() in app.js.
 * ===================================================================== */
(function Registries() {
  const layers = [];
  const CORE = { settings: () => Views.settings(), me: () => Views.profile(), u: (a) => Views.profile(a) }; // core screens of app.js route()
  function table(a, b) {
    let t = {};
    for (const l of layers) { try { t = { ...t, ...(l(a, b, t) || {}) }; } catch (e) { console.error("[MPRoutes]", e); } }
    return t;
  }
  function extend(fn) { if (typeof fn === "function") layers.push(fn); return fn; }
  function add(name, handler) {
    if (name && typeof name === "object") { for (const [k, h] of Object.entries(name)) add(k, h); return; }
    extend((a, b, prev) => {
      const before = prev[name];
      return { [name]: () => handler(a, b, () => (before ? before() : (CORE[name] ? CORE[name](a, b) : Views.notFound()))) };
    });
  }
  window.MPRoutes = { extend, add, table, layers: () => layers.length, version: "2.51" };
  window.ExtraRoutes = (a, b) => table(a, b);

  const hooks = [];
  if (typeof Views !== "undefined" && typeof Views.settings === "function") {
    const base = Views.settings;
    Views.settings = function () {
      const r = base.apply(this, arguments);
      for (const h of hooks) { try { h.apply(this, arguments); } catch (e) { console.error("[MPSettings]", e); } }
      return r;
    };
    Views.settings.__registry = true;
  }
  window.MPSettings = { add(fn) { if (typeof fn === "function" && !hooks.includes(fn)) hooks.push(fn); return fn; }, hooks: () => hooks.length, version: "2.51" };

  let state = "unknown"; const waiting = [];
  window.MPSession = {
    get state() { return state; },
    signedIn: () => state === "in",
    set(s) {
      if (s === state) return; state = s;
      if (s === "in") for (const f of waiting.splice(0)) { try { f(); } catch (e) { console.error("[MPSession]", e); } }
      try { dispatchEvent(new CustomEvent("mp:session", { detail: s })); } catch { /* old browsers */ }
    },
    whenIn(fn) { if (state === "in") { try { fn(); } catch (e) { console.error("[MPSession]", e); } } else waiting.push(fn); }
  };
})();
