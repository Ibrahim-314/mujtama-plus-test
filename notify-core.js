/* مجتمع بلس — notify core (v2.7, phases 28–29). Client logic only, no screens: the UI layer (notify-ui.js)
 * builds the notification center, toasts and preference pages on top of window.MPNotify.
 * • Push: feature detection, permission + subscription with the server's VAPID key, unsubscribe, test.
 * • API wrappers: notification center (tabs, groups, ranking), mark read, per-kind/quiet-hours settings,
 *   email preferences, account email + verification, password recovery/change.
 * • Events: MPNotify.on("notification", fn) for realtime in-app notifications (SSE "notification") and pushes
 *   that arrive while the app is focused (service-worker message "mp-push"); on("click", fn) when a push banner
 *   was tapped; on("unread", fn) whenever the unread count is known to change. */
(function NotifyCore() {
  const listeners = {};
  const emit = (ev, data) => (listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.warn("MPNotify listener", e); } });
  const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = listeners[ev].filter(f => f !== fn); }; };
  async function api(method, path, body) {
    if (typeof Remote !== "undefined" && Remote.api) return Remote.api(method, path, body);
    const r = await fetch(path, { method, credentials: "same-origin", headers: { "X-Requested-With": "mujtama", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || "HTTP " + r.status); e.status = r.status; e.code = j.code; throw e; } return j;
  }
  const q = (o) => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

  /* ---------- push ---------- */
  const b64uToBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  /** "unsupported" | "default" | "granted" | "denied"; iOS needs the app added to the home screen first ("needs-install") */
  function permission() {
    if (!pushSupported()) return /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone ? "needs-install" : "unsupported";
    return Notification.permission;
  }
  async function registration() { const r = await navigator.serviceWorker.getRegistration(); return r || navigator.serviceWorker.ready; }
  async function currentSubscription() { if (!pushSupported()) return null; const reg = await registration(); return reg?.pushManager ? reg.pushManager.getSubscription() : null; }
  /** asks permission (must be called from a user gesture), subscribes and registers with the server */
  async function enablePush() {
    const p = permission(); if (p === "unsupported" || p === "needs-install") return { ok: false, reason: p };
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: perm };
    const { publicKey } = await api("GET", "/api/push/vapid");
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    const same = sub && sub.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === publicKey;
    if (sub && !same) { await sub.unsubscribe().catch(() => { }); sub = null; } // server key rotated
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
    const r = await api("POST", "/api/push/subscribe", sub.toJSON());
    emit("push", { enabled: true }); return { ok: true, subscriptions: r.subscriptions };
  }
  async function disablePush() {
    const sub = await currentSubscription(); if (!sub) return { ok: true };
    await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => { });
    await sub.unsubscribe().catch(() => { }); emit("push", { enabled: false }); return { ok: true };
  }
  async function pushState() { const sub = await currentSubscription().catch(() => null); return { supported: pushSupported(), permission: permission(), subscribed: !!sub }; }
  /* keep the server in sync when permission is already granted (new device session, rotated subscription) */
  async function resync() { try { if (permission() === "granted") { const sub = await currentSubscription(); if (sub) await api("POST", "/api/push/subscribe", sub.toJSON()); } } catch { /* offline or signed out */ } }

  /* ---------- realtime ---------- */
  function attach(es) { if (!es || es._mpNotify) return; es._mpNotify = true; es.addEventListener("notification", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { /* keep {} */ } emit("notification", { source: "stream", ...d }); emit("unread", null); }); }
  if (typeof connectStream === "function") { const _cs = connectStream; connectStream = function () { const r = _cs.apply(this, arguments); try { attach(Remote.es); } catch { /* no stream */ } return r; }; }
  if (typeof Remote !== "undefined" && Remote.es) attach(Remote.es);
  navigator.serviceWorker?.addEventListener?.("message", (e) => {
    const d = e.data || {};
    if (d.type === "mp-push") { emit("notification", { source: "push", text: d.payload?.body, href: d.payload?.url, kind: d.payload?.kind, id: d.payload?.nid, groupKey: d.payload?.tag }); emit("unread", d.payload?.badge ?? null); }
    if (d.type === "mp-push-click") { emit("click", d); if (d.url) { const h = new URL(d.url).hash; if (h && location.hash !== h) location.hash = h; } }
  });

  window.MPNotify = {
    on, emit,
    /* push */
    pushSupported, permission, pushState, enablePush, disablePush, resync, testPush: () => api("POST", "/api/push/test"),
    /* center: { tabs:[{key,label,unread}], groups:[{key,kind,tab,ids,count,read,at,actors,names,verb,text,href,important,score}], unread } */
    center: ({ tab = "all", sort = "rank", limit } = {}) => api("GET", "/api/notifications?" + q({ view: "center", tab, sort, limit })),
    list: () => api("GET", "/api/notifications").then(r => r.notifications),
    markRead: async (opts = {}) => { const r = await api("POST", "/api/notifications/read", opts); emit("unread", r.unread); return r; },
    /* settings: { tabs, kinds:[{kind,label,tab,inapp,push,email,lock}], quiet:{enabled,start,end,tz,allowUrgent}, emailNotify, push, email } */
    settings: () => api("GET", "/api/notify/settings"),
    saveSettings: (patch) => api("PUT", "/api/notify/settings", patch),
    setChannel: (kind, channel, on) => api("PUT", "/api/notify/settings", { channels: { [kind]: { [channel]: !!on } } }),
    setQuiet: (quiet) => api("PUT", "/api/notify/settings", { quiet: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...quiet } }),
    /* email */
    emailPrefs: () => api("GET", "/api/email/prefs"),
    saveEmailPrefs: (patch) => api("PUT", "/api/email/prefs", patch),
    accountEmail: () => api("GET", "/api/account/email"),
    setEmail: (email, password) => api("PUT", "/api/account/email", { email, password }),
    resendVerification: () => api("POST", "/api/account/email/resend"),
    forgotPassword: (login) => api("POST", "/api/auth/forgot", { login }),
    resetPassword: (token, password) => api("POST", "/api/auth/reset", { token, password }),
    changePassword: (current, password) => api("POST", "/api/account/password", { current, password }),
    /* read ?t= / ?verified= from the current hash (#/reset?t=…, #/emailprefs?verified=1) */
    hashParam: (k) => new URLSearchParams((location.hash.split("?")[1] || "")).get(k)
  };
  if (document.readyState === "complete") setTimeout(resync, 3000); else addEventListener("load", () => setTimeout(resync, 3000));
})();
