/* مجتمع بلس — «لقطات» feature: creator info overlay over each clip (video/clips/overlay.js).
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips
 * (hooks / api / util / ext, documented in video/clips/core.js); block marker kept: v271-overlay. */
(function ClipsOverlay() {
  /* === v271-overlay === */
  /* global richText */
  /* Info overlay (v2.71): restyles the existing .short-info of every clip (clipHTML is untouched) into a clean bottom
   * overlay: avatar + name (<bdi>) + verified mark, Follow (the app-wide [data-follow] handler + patchFollow, so guests get
   * the usual sign-in path; hidden on own clips), caption clamped to 2 lines with «المزيد/أقل» (aria-expanded), hashtags
   * as #/tag/… links (richText), and a «الصوت:» line (original sound by the author when the post has no sound). */
  (function ClipsOverlay() {
    const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
    const soundOf = (p) => {
      const s = p.sound || p.video?.sound;
      if (s && typeof s === "string") return { title: s, by: "" };
      if (s && typeof s === "object" && (s.title || s.name)) return { title: s.title || s.name, by: s.author || s.by || "" };
      return null;
    };
    const fit = (cap, more) => { // show the toggle only when the caption is really clamped
      if (!cap.isConnected || cap.classList.contains("open")) return;
      const h = cap.clientHeight;
      more.hidden = h ? cap.scrollHeight <= h + 1 : (cap.textContent || "").length < 70;
    };
    Clips.onSection((sec, p) => {
      const info = sec.querySelector(".short-info"); if (!info || !p || info.classList.contains("cl-ov")) return;
      const u = S.user(p.author) || {}, id = String(p.id).replace(/[^\w-]/g, ""), mine = p.author === DB.me;
      const verified = !!(u.verified || u.badge), snd = soundOf(p), name = u.name || "", fol = !!(u.id && S.follows(DB.me, u.id));
      info.classList.add("cl-ov"); sec.classList.add("cl-ov-on");
      const avA = info.querySelector(":scope > .av"); if (avA) { avA.classList.add("cl-ov-av"); avA.setAttribute("tabindex", "-1"); avA.setAttribute("aria-hidden", "true"); } // the name link below is the accessible one
      const box = info.querySelector(":scope > div"); if (!box) return;
      box.className = "cl-ov-body";
      box.innerHTML = `<div class="cl-ov-head"><a class="cl-ov-name" id="clov-n-${id}" href="#/u/${encodeURIComponent(u.handle || "")}"><bdi data-noi18n>${esc(name)}</bdi></a>${verified ? `<span class="cl-ov-badge" role="img" aria-label="موثّق" title="${esc(u.badge || "")}"></span>` : ""}${!mine && u.id ? `<button type="button" class="cl-ov-follow${fol ? " ghost" : ""}" data-follow="${esc(u.id)}" aria-pressed="${fol}" aria-describedby="clov-n-${id}">${fol ? "تتابعه" : "تابع"}</button>` : ""}</div>`
        + (p.text ? `<p class="cl-ov-cap" id="clov-c-${id}" dir="auto" data-noi18n>${typeof richText === "function" ? richText(p.text) : esc(p.text)}</p><button type="button" class="cl-ov-more" aria-expanded="false" aria-controls="clov-c-${id}" hidden>المزيد</button>` : "")
        + `<p class="cl-ov-snd"><span class="cl-ov-note" aria-hidden="true"></span><span>الصوت:</span> ${snd ? `<bdi data-noi18n>${esc(snd.title)}</bdi>${snd.by ? ` · <bdi data-noi18n>${esc(snd.by)}</bdi>` : ""}` : `<span>صوت أصلي</span> · <bdi data-noi18n>${esc(name)}</bdi>`}</p>`;
      const cap = box.querySelector(".cl-ov-cap"), more = box.querySelector(".cl-ov-more");
      if (!cap) return;
      more.addEventListener("click", (e) => {
        e.stopPropagation(); const open = more.getAttribute("aria-expanded") !== "true";
        cap.classList.toggle("open", open); info.classList.toggle("cl-ov-open", open);
        more.setAttribute("aria-expanded", String(open)); more.textContent = T(open ? "أقل" : "المزيد");
        if (!open) cap.scrollTop = 0;
      });
      requestAnimationFrame(() => fit(cap, more));
    });
    Clips.onCurrent((sec) => { const cap = sec.querySelector(".cl-ov-cap"), more = sec.querySelector(".cl-ov-more"); if (cap && more) fit(cap, more); });
  })();
  /* === end v271-overlay === */
})();
