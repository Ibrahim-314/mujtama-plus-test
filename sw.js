/* مجتمع بلس service worker (Phase 5).
 * • App shell: cache-first for versioned static assets, stale-while-revalidate for the rest.
 * • API: never cached except GET /api/bootstrap, which falls back to the last copy when offline.
 * • Media: cache-first with a size cap.
 * • Saved items (v2.6): GET /api/collections/sync is network-first with an offline fallback, and a
 *   Background Sync tag "mp-saved" asks open pages to replay their offline outbox (IndexedDB).
 * • Phase 46 (installable app): offline reading (network-first READ endpoints kept in the cross-version "mp-api" cache,
 *   cleared on logout), offline drafts (PUT/DELETE /api/drafts/:id queued in IndexedDB "mp-pwa", coalesced per draft,
 *   replayed by Background Sync "mp-drafts" / page message "mp-drafts-flush"), Web Share Target (POST /share-target →
 *   "mp-share" cache → /?source=share, composer opens), and store-less updates: an UPDATE waits until a page sends "mp-skip-waiting". */
const VERSION = "mp-2.68.0";
const APP_VER = "__APP_VERSION__"; // v2.68: human version (build fills it); VERSION is the cache key (content hash)
const SHELL = ["/", "/index.html", "/manifest.json", "/icons/icon-192.png"];
const API = "mp-api", SHARE = "mp-share", KEEP = [API, SHARE];
const READ = /^\/api\/(bootstrap|collections\/sync|feed|explore|stories|digest\/daily|posts\/[\w-]+(\/(paragraphs|summary|comments))?|topics\/[^/]+\/page|series\/[\w-]+|u\/[\w.-]+|users\/[\w.-]+)$/;
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => { if (!self.registration.active) return self.skipWaiting(); /* update: the page asks first («تحديث متوفر») */ })); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(VERSION) && !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
async function trim(name, max) { const c = await caches.open(name); const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k); }
const netFirst = (req) => fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(API).then(c => c.put(req, cl)).then(() => trim(API, 300)); } return r; }).catch(() => caches.match(req, { cacheName: API }).then(r => r || Response.error()));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.method === "POST" && url.pathname === "/share-target") { e.respondWith(shareIn(req)); return; }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") { e.waitUntil(caches.delete(API).then(() => idb("clear"))); return; }
  if ((req.method === "PUT" || req.method === "DELETE") && /^\/api\/drafts\/[\w-]+$/.test(url.pathname)) { e.respondWith(draftWrite(req)); return; }
  if (req.method !== "GET") return;
  if (url.pathname === "/whatsnew.json") return; // v2.68: release notes always come from the network
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/drafts") { e.respondWith(draftList(req)); return; }
    if (READ.test(url.pathname) && !(url.pathname === "/api/collections/sync" && url.search)) e.respondWith(netFirst(req));
    return;
  }
  if (url.pathname.startsWith("/media/")) {
    e.respondWith(caches.open(VERSION + "-media").then(async c => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok && r.status === 200 && !/no-store|private/i.test(r.headers.get("Cache-Control") || "") && !/\.(mp4|m4s|m4v|webm|mov|ts|m3u8|mp3|m4a|aac|ogg|opus)$/i.test(url.pathname) && !/^(video|audio)\/|mpegurl/i.test(r.headers.get("Content-Type") || "")) { c.put(req, r.clone()); trim(VERSION + "-media", 200); } /* v2.81: video/audio (HLS segments, MP4) streamed, never kept — 200 cached segments could take hundreds of MB on the phone; images only */ /* phase 38: paid media is private, no-store — never cached */ return r; }));
    return;
  }
  // v2.68: only a successful app-shell navigation (/ or /index.html) refreshes the offline shell, cloned before the page reads it
  if (req.mode === "navigate") { e.respondWith(fetch(req).then(r => { if (r.ok && r.status === 200 && (url.pathname === "/" || url.pathname === "/index.html") && /text\/html/.test(r.headers.get("Content-Type") || "")) { const cl = r.clone(); caches.open(VERSION).then(c => c.put("/index.html", cl)); } return r; }).catch(() => caches.match("/index.html"))); return; }
  if (/-[A-Za-z0-9_-]{8,}\.(js|css|png|svg|webp)$/.test(url.pathname)) { e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok && r.status === 200) { const cl = r.clone(); caches.open(VERSION).then(c => c.put(req, cl)); } return r; }))); return; }
  e.respondWith(caches.match(req).then(hit => { const net = fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(VERSION).then(c => c.put(req, cl)); } return r; }).catch(() => hit); return hit || net; }));
});
self.addEventListener("sync", (e) => { if (e.tag === "mp-saved") e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => cs.forEach(c => c.postMessage("mp-saved-sync")))); });
/* Web Push (v2.7, Phase 28). Payload (JSON, encrypted by the server with RFC 8291):
 *   { title, body, tag, url, nid, kind, badge, ts, renotify }
 * The tag is the notification's group key, so a newer push for the same group replaces the older banner
 * («أحمد و5 آخرون أعجبهم منشورك»). When a window of the app is visible and focused the banner is skipped
 * and the page gets { type: "mp-push", payload } instead (the UI shows its own in-app toast). */
self.addEventListener("push", (e) => {
  let p = {}; try { p = e.data ? e.data.json() : {}; } catch { p = { body: e.data ? e.data.text() : "" }; }
  const title = p.title || "مجتمع بلس";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focused = wins.find(c => c.visibilityState === "visible" && c.focused);
    if ("setAppBadge" in self.navigator && typeof p.badge === "number") { try { await (p.badge ? self.navigator.setAppBadge(p.badge) : self.navigator.clearAppBadge()); } catch { /* unsupported */ } }
    if (focused && p.kind !== "call") { focused.postMessage({ type: "mp-push", payload: p }); return; }
    await self.registration.showNotification(title, { body: p.body || "", tag: p.tag || undefined, renotify: !!(p.tag && p.renotify), dir: "rtl", lang: "ar", timestamp: p.ts || Date.now(), requireInteraction: p.kind === "call", data: { url: p.url || "/#/notifications", nid: p.nid, kind: p.kind } });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/#/notifications", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find(c => new URL(c.url).origin === self.location.origin);
    if (win) { await win.focus(); win.postMessage({ type: "mp-push-click", url, nid: e.notification.data && e.notification.data.nid }); try { if ("navigate" in win) await win.navigate(url); } catch { /* cross-state navigation not allowed: the page handles the message */ } return; }
    await self.clients.openWindow(url);
  })());
});
/* the browser rotated the subscription: re-subscribe with the same VAPID key and tell the server */
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    const key = (e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey) || (await fetch("/api/push/vapid").then(r => r.json()).then(j => Uint8Array.from(atob(j.publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(j.publicKey.length / 4) * 4, "=")), c => c.charCodeAt(0))));
    const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const hdr = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
    if (e.oldSubscription) await fetch("/api/push/unsubscribe", { method: "POST", credentials: "same-origin", headers: hdr, body: JSON.stringify({ endpoint: e.oldSubscription.endpoint }) }).catch(() => { });
    await fetch("/api/push/subscribe", { method: "POST", credentials: "same-origin", headers: hdr, body: JSON.stringify(sub.toJSON()) });
  })());
});

/* ---------- Phase 46: offline drafts queue (IndexedDB "mp-pwa" / store "drafts", key = draft id) ---------- */
function idb(op, key, val) {
  return new Promise((res, rej) => {
    const o = indexedDB.open("mp-pwa", 1);
    o.onupgradeneeded = () => o.result.createObjectStore("drafts");
    o.onerror = () => rej(o.error);
    o.onsuccess = () => {
      const tx = o.result.transaction("drafts", op === "all" ? "readonly" : "readwrite"), st = tx.objectStore("drafts");
      const r = op === "all" ? st.getAll() : op === "put" ? st.put(val, key) : op === "del" ? st.delete(key) : st.clear();
      tx.oncomplete = () => { o.result.close(); res(r.result); }; tx.onerror = () => rej(tx.error);
    };
  });
}
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json; charset=utf-8", "X-Mp-Offline": "1" } });
async function draftWrite(req) {
  const body = req.method === "PUT" ? await req.clone().text() : null, id = new URL(req.url).pathname.split("/").pop();
  try { return await fetch(req); } catch {
    let base = null; try { base = JSON.parse(body || "{}").base || null; } catch { /* not JSON */ }
    await idb("put", id, { id, method: req.method, body, at: new Date().toISOString() });
    try { await self.registration.sync?.register("mp-drafts"); } catch { /* no Background Sync: pages flush on "online" */ }
    return json(req.method === "PUT" ? { id, updatedAt: base, queued: true } : { ok: true, queued: true }, 202);
  }
}
async function draftList(req) {
  let list = null, offline = false;
  try { const r = await fetch(req); if (!r.ok) return r; list = (await r.clone().json()).drafts; caches.open(API).then(c => c.put(req, r)); }
  catch { offline = true; const hit = await caches.match(req, { cacheName: API }); list = hit ? (await hit.json()).drafts : []; }
  const q = await idb("all").catch(() => []);
  for (const it of q) {
    list = list.filter(d => d.id !== it.id);
    if (it.method === "PUT") { try { list.unshift({ id: it.id, data: JSON.parse(it.body).data, device: "offline", updatedAt: it.at, queued: true }); } catch { /* skip */ } }
  }
  return json({ drafts: list, ...(offline || q.length ? { offline, queued: q.length } : {}) });
}
let flushing = null;
function flushDrafts() {
  return flushing ||= (async () => {
    let sent = 0, conflicts = 0;
    for (const it of await idb("all").catch(() => [])) {
      let r; try { r = await fetch("/api/drafts/" + it.id, { method: it.method, credentials: "same-origin", headers: { "X-Requested-With": "mujtama", ...(it.body ? { "Content-Type": "application/json" } : {}) }, body: it.body || undefined }); }
      catch { break; } // still offline
      if (r.status === 401 || r.status === 429 || r.status >= 500) break; // retry later
      if (r.status === 409) conflicts++; else sent++;
      await idb("del", it.id);
    }
    const left = (await idb("all").catch(() => [])).length;
    (await self.clients.matchAll({ type: "window" })).forEach(c => c.postMessage({ type: "mp-drafts-flushed", sent, conflicts, left }));
    if (left) throw new Error("drafts pending"); // Background Sync retries
  })().finally(() => { flushing = null; });
}
/* ---------- Phase 46: Web Share Target ---------- */
async function shareIn(req) {
  try {
    const f = await req.formData(), c = await caches.open(SHARE);
    for (const k of await c.keys()) await c.delete(k);
    const files = f.getAll("media").filter(x => x && typeof x === "object" && /^image\//.test(x.type) && x.size <= 15e6).slice(0, 4);
    for (let i = 0; i < files.length; i++) await c.put("/__share/file-" + i, new Response(files[i], { headers: { "Content-Type": files[i].type, "X-Name": encodeURIComponent(files[i].name || "image") } }));
    const s = (k) => String(f.get(k) || "").slice(0, 4000);
    await c.put("/__share/meta", json({ title: s("title"), text: s("text"), url: s("url"), files: files.length, at: Date.now() }));
  } catch { /* malformed share: open the composer empty */ }
  return Response.redirect("/?source=share#/home", 303);
}
self.addEventListener("message", (e) => {
  if (e.data === "mp-skip-waiting") self.skipWaiting();
  else if (e.data === "mp-drafts-flush") e.waitUntil(flushDrafts().catch(() => { }));
  else if (e.data === "mp-version" && e.ports[0]) e.ports[0].postMessage(VERSION);
  else if (e.data === "mp-app-version" && e.ports[0]) e.ports[0].postMessage(APP_VER);
});
self.addEventListener("sync", (e) => { if (e.tag === "mp-drafts") e.waitUntil(flushDrafts()); });
