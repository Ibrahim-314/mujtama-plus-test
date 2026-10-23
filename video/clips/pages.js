/* مجتمع بلس — «لقطات» feature: sound / hashtag pages, resume row hooks (video/clips/pages.js).
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips
 * (hooks / api / util / ext, documented in video/clips/core.js); block marker kept: v273-pages. */
(function ClipsPages() {
  const { ic, api, online, fmtDur } = Clips.util;
  /* === v273-pages === */
  /* v2.73 «لقطات» features (slice 1), add-on only — the core loop is untouched:
   *  1. Sound / hashtag pages: the «♪ الصوت:» line and every #وسم in a clip caption open #/clips/sound/<key> or
   *     #/clips/tag/<tag>: a 9:16 grid of the clips using it, with the count; a tile opens the viewer at that clip
   *     (#/clips?start=<id>). Tag page = GET /api/tags/:tag (videos only) merged with the local store; sound page = the
   *     local store (clips seen in the feed) — there is no server sound index yet. The general #/tag/<tag> page stays
   *     linked from the tag page («كل المنشورات بهذا الوسم»).
   *  2. Series: moved to video/clips/series.js (ribbon, episodes sheet, up-next card).
   *  3. Resume watching lives in the shared player (window.MPResume in content-ui.js): clips ≥20 s resume too. */
  (function ClipsPages() {
    const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
    const norm = (t) => (typeof normalizeTag === "function" ? normalizeTag(t) : String(t || "").toLowerCase());
    const sndRaw = (p) => p?.sound || p?.video?.sound || null;
    const sndTitle = (p) => { const s = sndRaw(p); return typeof s === "string" ? s : (s && (s.title || s.name)) || ""; };
    /** sound key: an explicit sound id, else the sound title, else «original sound» of that clip (o:<post id>) */
    const sndKey = (p) => { const s = sndRaw(p); if (s && typeof s === "object" && s.id) return "s:" + s.id; const t = sndTitle(p).trim().toLowerCase(); return t ? "t:" + t : "o:" + p.id; };
    const clipsAll = () => S.visiblePosts().filter((p) => p.type === "video" && p.status === "published" && (p.video?.source === "clips" || (p.video?.source !== "post" && !!(p.video?.short || p.video?.variants))));
    const tagsOf = (p) => (typeof S.hashtags === "function" ? S.hashtags(p.text || "") : (String(p.text || "").match(/#([\p{L}\p{N}_]+)/gu) || []).map((x) => norm(x.slice(1))));

    /* ---- 1a. links inside each clip ---- */
    Clips.onSection((sec, p) => {
      if (!p || sec._clPg) return; sec._clPg = 1;
      const snd = sec.querySelector(".cl-ov-snd");
      if (snd && !snd.querySelector(".cl-snd-a")) {
        const t = sndTitle(p) || (T("صوت أصلي") + " · " + (S.user(p.author)?.name || ""));
        snd.innerHTML = `<a class="cl-snd-a" href="#/clips/sound/${encodeURIComponent(sndKey(p))}" title="${esc(T("صفحة الصوت") + ": " + t)}">${snd.innerHTML}</a>`; // name = the visible «الصوت: …» text (no aria-label: WCAG 2.5.3)
      }
      sec.querySelectorAll('.cl-ov-cap a.tag[href^="#/tag/"]').forEach((a) => { a.setAttribute("href", "#/clips/tag/" + a.getAttribute("href").slice(6)); a.classList.add("cl-tag-a"); });
    });

    /* ---- 1b. the grid page ---- */
    const dur = (s) => fmtDur(s);
    const tile = (p) => {
      const v = p.video || {}, po = MPVideoSources.poster(v), cap = String(p.text || "").replace(/\s+/g, " ").slice(0, 60), d = +v.duration || 0, u = S.user(p.author);
      return `<li><a class="clp-tile" href="#/clips?start=${encodeURIComponent(p.id)}" style="${po ? "" : `background:${esc(p.media || "")}`}">${po ? `<img src="${esc(po)}" alt="" loading="lazy" decoding="async" width="180" height="320">` : `<span class="clp-tile-ph" aria-hidden="true">${ic("play", "lg")}</span>`}${cap ? `<span class="clp-tile-cap"><bdi data-noi18n>${esc(cap)}</bdi></span>` : `<span class="clp-sr">${T("لقطة")}</span>`}${u?.name ? `<span class="clp-sr"> — <bdi data-noi18n>${esc(u.name)}</bdi></span>` : ""}${d > 0 ? `<span class="clp-tile-dur" aria-hidden="true"><bdi>${dur(d)}</bdi></span>` : ""}</a></li>`;
    };
    function page(kind, key) {
      document.body.classList.remove("shorts-mode");
      let items = [], title = "";
      if (kind === "tag") { const tg = norm(key); title = "#" + tg; items = clipsAll().filter((p) => tagsOf(p).includes(tg)); }
      else { items = clipsAll().filter((p) => sndKey(p) === key); const f = items[0] || (key.startsWith("o:") ? S.post(key.slice(2)) : null); title = (f && sndTitle(f)) || (f ? T("صوت أصلي") + " · " + (S.user(f.author)?.name || "") : T("الصوت")); }
      const tok = {}; view._clPg = tok;
      const paint = () => {
        if (view._clPg !== tok) return; items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        view.innerHTML = `<div class="wrap clp-pg"><header class="clp-pg-head"><a class="clp-pg-back" href="#/clips" aria-label="${T("رجوع إلى فيديوتك")}">${ic("x")}</a><span class="clp-pg-ic" aria-hidden="true">${kind === "tag" ? "#" : "♪"}</span><div class="clp-pg-t"><h1><bdi data-noi18n>${esc(kind === "tag" ? title : title.replace(/^#/, ""))}</bdi></h1><p class="muted"><span class="clp-pg-n" data-noi18n>${items.length}</span> <span>${items.length === 1 ? T("لقطة") : T("لقطات")}</span></p></div></header>`
          + (kind === "tag" ? `<p class="clp-pg-more"><a href="#/tag/${encodeURIComponent(norm(key))}">${T("كل المنشورات بهذا الوسم")}</a></p>` : "")
          + (items.length ? `<ul class="clp-grid" aria-label="${T(kind === "tag" ? "لقطات الوسم" : "لقطات بهذا الصوت")}">${items.map(tile).join("")}</ul>` : `<div class="empty" role="status">${T("لا لقطات بعد")}</div>`) + `</div>`;
      };
      paint();
      if (kind === "tag" && online()) api("GET", "/api/tags/" + encodeURIComponent(norm(key))).then((r) => {
        const have = new Set(items.map((p) => p.id)); let add = 0;
        for (const x of r?.posts || []) { if (!x || x.type !== "video" || x.status === "deleted" || have.has(x.id)) continue; if (!S.post(x.id)) DB.posts.push(x); items.push(S.post(x.id) || x); add++; }
        if (add) paint();
      }).catch(() => { /* offline: local list stays */ });
    }
    const base = Clips.view;
    Clips.view = function () {
      const m = /^#\/clips\/(sound|tag)\/([^?]+)/.exec(location.hash);
      if (m) { let k = m[2]; try { k = decodeURIComponent(k); } catch { /* keep raw */ } return page(m[1], k); }
      return base.apply(this, arguments);
    };

    Clips.pages = { soundKey: sndKey, open: page };
  })();
  /* === end v273-pages === */
})();
