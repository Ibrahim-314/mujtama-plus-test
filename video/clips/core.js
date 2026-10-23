/* =====================================================================
 * مجتمع بلس — «لقطات» (Clips) core: feed paging + windowed players + watch beacons (video/clips/core.js)
 * Part of the lazy "clips" chunk. Since v2.73 the chunk is split into one file per feature (see video/README.md); the build
 * concatenates every <script data-chunk="clips"> in index.html order into ONE hashed file, so the split costs nothing at
 * runtime. Route #/shorts and its alias #/clips; core (content-ui.js) keeps the route registration and the shorts-mode
 * cleanup, and the shared player lives in video/player/.
 *
 * Behaviour: pages from GET /api/clips/feed (local-store fallback), ≤3 mounted <video> elements (current ±1), next clip
 * preloaded "auto" + the one after it "metadata", a clip passed in <250 ms never mounts, watch beacon
 * POST /api/clips/:id/watch on leave (sendBeacon on pagehide/hidden), view beacon /api/posts/:id/view {source:"shorts"},
 * double-tap like with a heart burst.
 *
 * EXTENSION POINT — a new clips feature is a NEW FILE in video/clips/ (plus its .css), listed in index.html after the
 * others with data-chunk="clips". Never edit the core loop for a feature:
 *   Clips.onSection(fn)  fn(sectionEl, post)    once for every rendered <section class="short"> (first page and later pages)
 *   Clips.onCurrent(fn)  fn(sectionEl, index, post)  each time a clip becomes the one on screen (>60% visible)
 *   Clips.onView(fn)     fn()                   at the start of every visit to the screen (before the first page loads)
 *   Clips.onLeave(fn)    fn()                   when the visitor leaves the screen (hash change)
 *   Clips.api            { page(cursor), html(post), counts: Map(id → {likes, comments}), feed() → the .shorts element or null }
 *   Clips.util           { ic(name, cls), api(method, url, body), online(), fmtDur(seconds) } shared helpers for feature files
 *   Clips.ext            replaceable feed policies: tab() → "foryou"|"following", start(page, cursor) → page, src(section) → watch source,
 *                        followEmpty() → html (set by tabs.js; the core falls back to «لك» / no-op / "")
 *   Clips.view()         renders the screen (called by the core route)
 * A hook that throws is logged and skipped, so one add-on never breaks the feed. Each on*() returns an unsubscribe fn.
 * ===================================================================== */
(function ClipsLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const fmtDur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, "0")}`;
  const hooks = { section: [], current: [], view: [], leave: [] };
  const fire = {
    run(k, ...a) { for (const fn of hooks[k].slice()) { try { fn(...a); } catch (e) { console.error("Clips." + k, e); } } },
    section: (sec) => fire.run("section", sec, S.post(sec.dataset.short)),
    current: (sec, i) => fire.run("current", sec, i, S.post(sec.dataset.short)),
    view: () => fire.run("view"),
    leave: () => fire.run("leave"),
  };
  /* feed policies another file may replace (tabs.js sets all three); defaults keep a working «لك» feed on their own */
  const ext = { tab: () => "foryou", start: (r) => r, followEmpty: () => "", src: () => ext.tab() };
  const clipsSrc = (sec) => { try { return ext.src(sec) || "other"; } catch { return "other"; } };
  const clipsTab = () => ext.tab(), clipsStart = (r, cursor) => ext.start(r, cursor), clipsFollowEmpty = () => ext.followEmpty();
  const on = (k) => (fn) => { if (typeof fn !== "function") return () => { }; hooks[k].push(fn); return () => { const j = hooks[k].indexOf(fn); if (j >= 0) hooks[k].splice(j, 1); }; };

  /* =================== «لقطات» (Clips, v2.70): vertical, snap scrolling, autoplay, paged + windowed =================== */
  /* Pages come from GET /api/clips/feed (falls back to the local store when that endpoint is missing or offline); at most
   * three players stay mounted (current ±1), the next two clips are preloaded, a clip passed in <250 ms never mounts, and
   * leaving a clip reports its watch time (fire-and-forget). */
  const localClips = () => S.visiblePosts().filter(p => p.type === "video" && p.status === "published" && (p.video?.source === "clips" || (p.video?.source !== "post" && !!(p.video?.short || p.video?.variants)))).sort((a, b) => (b.video?.variants ? 1 : 0) - (a.video?.variants ? 1 : 0) || new Date(b.createdAt) - new Date(a.createdAt));
  const CLIP_PAGE = 8;
  const clipCounts = new Map(); // server counts per clip id (used when the local store has none)
  let clipsLocal = false; // the server feed failed / had no first page: page the local store until the page is opened again
  async function clipsPage(cursor) {
    if (!clipsLocal && online()) {
      try {
        const r = await api("GET", `/api/clips/feed?tab=${clipsTab()}&cursor=${encodeURIComponent(cursor || "")}`);
        if (r && Array.isArray(r.items)) {
          const items = r.items.map(x => {
            if (typeof x === "string") return S.post(x);
            if (!x || !x.id) return null;
            if (x.user?.id && !S.user(x.user.id)) DB.users.push({ topics: [], ...x.user }); // remote author → local users store (names/avatars)
            const { user: _u, ...post } = x; if (!S.post(x.id)) DB.posts.push(post);
            const lp = S.post(x.id) || post; if (x.counts) clipCounts.set(lp.id, x.counts);
            return lp;
          }).filter(p => p && p.type === "video");
          if (items.length || cursor) return { items, next: r.next || null };
          // first page empty on the server (e.g. clips only in the local store yet): page the local store instead
        }
      } catch { /* endpoint not there yet or offline: local fallback below */ }
      clipsLocal = true;
    }
    const all = clipsTab() === "following" ? localClips().filter(p => S.follows(DB.me, p.author)) : localClips(), from = +cursor || 0;
    return { items: all.slice(from, from + CLIP_PAGE), next: from + CLIP_PAGE < all.length ? String(from + CLIP_PAGE) : null };
  }
  const clipHTML = (p) => { const u = S.user(p.author); return `<section class="short" role="article" data-short="${p.id}" aria-label="${esc(u?.name || "لقطة")}" style="${MPVideoSources.poster(p.video) ? `background-image:url('${esc(MPVideoSources.poster(p.video))}')` : `background:${p.media || "#111"}`}"><div class="short-player"></div>
      <div class="short-info">${av(u)}<div><b><bdi>${esc(u?.name || "")}</bdi></b><p>${esc((p.text || "").slice(0, 140))}</p></div></div>
      <div class="short-actions"><button data-react="${p.id}" aria-label="إعجاب">${ic(S.reactionsOf(p.id).some(r => r.user === DB.me) ? "heartF" : "heart")}<span>${S.reactionsOf(p.id).length || clipCounts.get(p.id)?.likes || ""}</span></button><a href="#/post/${p.id}" aria-label="التعليقات">${ic("comment")}<span>${S.commentsOf(p.id).length || clipCounts.get(p.id)?.comments || ""}</span></a><button data-share="${p.id}" aria-label="مشاركة">${ic("share")}</button></div>${!p.video?.variants ? `<div class="short-ph">${ic("play", "lg")}<span>${fmtDur(p.video?.duration)}</span></div>` : ""}</section>`; };
  function shortsView() {
    fire.view(); // extension point: a fresh visit (reset per-visit state)
    document.body.classList.add("shorts-mode"); clipsLocal = false; // each visit asks the server feed again
    view.innerHTML = `<div class="shorts" role="feed" aria-label="فيديوتك" aria-busy="true"></div><button class="shorts-back" aria-label="رجوع" data-ui="back">${ic("x")}</button>`;
    const feed = view.querySelector(".shorts"), token = {}; view._clips = token;
    let next = "", loading = false, cur = -1, curAt = 0, mountT = 0;
    const secs = () => [...feed.querySelectorAll(".short")];
    const alive = () => view._clips === token && feed.isConnected;
    const destroy = (sec) => { const box = sec.querySelector(".short-player"); if (!box.querySelector("video")) return; box.querySelector("video").pause(); if (window.MPPlayer?.destroy) MPPlayer.destroy(box); box.innerHTML = ""; box.classList.remove("mounted"); sec._mounted = false; }; // drop the <video> too: ≤3 elements stay in the DOM
    const mount = (sec, { autoplay = false, preload = "metadata" } = {}) => {
      const p = S.post(sec.dataset.short), box = sec.querySelector(".short-player");
      if (!p?.video?.variants) return;
      if (!box.querySelector("video")) {
        MPPlayer.mount(box, p, { autoplay, loop: true, preload, source: "clips" }); sec._mounted = true;
        const sk = box.querySelector('.mp-seek[role="slider"]'); // slider needs a value for AT (kept in sync until MPPlayer sets it itself)
        if (sk && !sk.hasAttribute("aria-valuenow")) { sk.setAttribute("aria-valuemin", "0"); sk.setAttribute("aria-valuemax", "100"); sk.setAttribute("aria-valuenow", "0"); box.querySelector("video")?.addEventListener("timeupdate", (e) => { const v = e.target; sk.setAttribute("aria-valuenow", String(v.duration > 0 ? Math.round(v.currentTime / v.duration * 100) : 0)); }); }
      }
      const v = box.querySelector("video"); if (v && !v._mpW0) { v._mpW0 = 1; v.addEventListener("timeupdate", () => { const t = v.currentTime, dt = t - (v._mpT || 0); if (dt > 0 && dt < 1.5) v._mpW = (v._mpW || 0) + dt; v._mpT = t; if (t > (v._mpMax || 0)) v._mpMax = t; }); } // played time: forward steps only (seeks/loop wraps ignored)
      if (v && v.preload !== "auto") v.preload = preload; // honoured even before MPPlayer gains {preload}
      if (autoplay) v?.play().catch(() => { if (v) { v.muted = true; v.play().catch(() => { }); } });
    };
    const leave = (i, bye) => { // ms = media time actually played (timeupdate deltas, capped at the duration); sent once per on-screen visit
      const sec = secs()[i]; if (!sec || sec._sent === curAt) return; const v = sec.querySelector(".short-player video"); if (!bye) v?.pause();
      if (Date.now() - curAt < 250 || !online()) return; sec._sent = curAt;
      const d = v && isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration * 1000) : Math.round((S.post(sec.dataset.short)?.video?.duration || 0) * 1000);
      let ms = Math.round((v?._mpW || 0) * 1000); if (d > 0) ms = Math.min(ms, d);
      const completed = ms > 0 && !!(v && (v.ended || (d > 0 && (v._mpMax || 0) * 1000 >= d * 0.9) || (d > 0 && ms >= d * 0.9)));
      const url = `/api/clips/${encodeURIComponent(sec.dataset.short)}/watch`, body = { ms, durationMs: d, completed, src: sec._src || clipsSrc(sec) }; // v2.80: src feeds the creator's «من أين جاء المشاهدون»
      if (!bye) return api("POST", url, body).catch(() => { });
      const json = JSON.stringify(body); let ok = false; try { ok = navigator.sendBeacon?.(url, new Blob([json], { type: "application/json" })); } catch { }
      if (!ok) fetch(url, { method: "POST", body: json, keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" } }).catch(() => { });
    };
    const hide = (e) => { if (!alive()) return; if (e.type === "pagehide" || document.visibilityState === "hidden") { if (cur >= 0) leave(cur, 1); } else if (cur >= 0) curAt = Date.now(); }; // back to the tab = a new visit
    addEventListener("pagehide", hide); document.addEventListener("visibilitychange", hide);
    const settle = (i) => { // the clip has stayed in view ≥250 ms: mount it + neighbours, drop the rest
      if (!alive() || i !== cur) return; const all = secs(), sec = all[i]; if (!sec) return;
      all.forEach((s, j) => { if (Math.abs(j - i) > 1) destroy(s); });
      mount(sec, { autoplay: true, preload: "auto" });
      if (all[i + 1]) mount(all[i + 1], { preload: "auto" });
      if (all[i + 2]) { const v = all[i + 2].querySelector(".short-player video"); if (v) v.preload = "metadata"; } // stays unmounted (≤3 players); metadata hint only
      if (all[i - 1]) all[i - 1].querySelector(".short-player video")?.pause();
      const p = S.post(sec.dataset.short); if (p && !sec._viewed) { sec._viewed = true; api("POST", `/api/posts/${p.id}/view`, { source: "shorts" }).catch(() => { }); }
    };
    const io = new IntersectionObserver((ents) => ents.forEach(en => {
      if (!(en.isIntersecting && en.intersectionRatio > 0.6)) { en.target.querySelector(".short-player video")?.pause(); return; }
      const i = secs().indexOf(en.target); if (i < 0 || i === cur) return;
      if (cur >= 0) leave(cur); cur = i; curAt = Date.now(); if (!en.target._src) en.target._src = clipsSrc(en.target); // v2.80: source fixed when the visit starts (the hash may change before leave)
      fire.current(en.target, i); // extension point: the clip now on screen
      clearTimeout(mountT); mountT = setTimeout(() => settle(i), 250);
      if (next !== null && i >= secs().length - 3) load(); // two clips from the end → fetch the next page
    }), { threshold: [0, 0.6, 1] });
    const load = async () => {
      if (loading || next === null) return; loading = true;
      const r = await clipsPage(next).then(x => clipsStart(x, next)).catch(() => ({ items: [], next: null })); loading = false; if (!alive()) return;
      next = r.next; const have = new Set(secs().map(s => s.dataset.short));
      const add = r.items.filter(p => !have.has(p.id));
      feed.querySelector(".empty")?.remove();
      feed.insertAdjacentHTML("beforeend", add.map(clipHTML).join(""));
      if (add.length) secs().slice(-add.length).forEach(fire.section); // extension point: each new .short section
      secs().slice(-add.length || secs().length).forEach(s => { if (!s._obs) { s._obs = true; io.observe(s); } });
      if (!secs().length) { feed.removeAttribute("role"); feed.innerHTML = clipsTab() === "following" ? clipsFollowEmpty() : `<div class="empty" role="status" style="color:#fff;padding-top:40vh">لا لقطات بعد</div>`; } // a feed with no articles is invalid ARIA
      feed.setAttribute("aria-busy", "false");
      if (add.length && next !== null && secs().length - Math.max(cur, 0) <= 3) load();
    };
    load();
    addEventListener("hashchange", function off() { removeEventListener("hashchange", off); removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", hide); if (cur >= 0) leave(cur); clearTimeout(mountT); io.disconnect(); fire.leave(); }, { once: true });
    let lastTap = 0; feed.addEventListener("pointerup", (e) => { const sec = e.target.closest(".short"); if (!sec || e.target.closest("button,a,.mp-bar,.mp-seek")) return; const t = Date.now(); if (t - lastTap < 280) { const b = sec.querySelector("[data-react]"); b?.click(); sec.insertAdjacentHTML("beforeend", `<span class="burst">${ic("heartF", "lg")}</span>`); setTimeout(() => sec.querySelector(".burst")?.remove(), 700); } lastTap = t; });
  }

  window.Clips = {
    view: shortsView,
    onSection: on("section"), onCurrent: on("current"), onView: on("view"), onLeave: on("leave"),
    api: { page: clipsPage, html: clipHTML, get counts() { return clipCounts; }, feed: () => (typeof view !== "undefined" && view.querySelector(".shorts")) || null },
    util: { ic, api, online, fmtDur },
    ext,
  };
})();
