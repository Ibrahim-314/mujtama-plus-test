/* مجتمع بلس — «لقطات» feature: comments sheet over the clip (video/clips/comments.js).
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips
 * (hooks / api / util / ext, documented in video/clips/core.js); block marker kept: v271-comments. */
(function ClipsComments() {
  const { ic, api, online } = Clips.util;
  /* === v271-comments === */
  /* Comments sheet over the clip: opens from the rail (document event "clips:comments" {post}) or the clip's own comment
   * link; lists the post's comments (local store, plus GET /api/posts/:id/comments merged in when online), posts with the
   * same Cmd.comment the post page uses, updates the count on the clip. Closes by ✕ / Esc / backdrop / back button
   * (history.pushState({clipsCm:1}) → popstate) and silently when the page is left (Clips.onLeave, no history.back()).
   * The video keeps playing under the sheet. Focus is trapped while open and goes back to the opener on close. */
  const CM = { el: null, pid: null, opener: null, pushed: false, skipPop: false };
  const cmUser = (id) => S.user(id) || { handle: "", name: "؟", color: "var(--accent)" };
  const cmCount = (pid) => S.commentsOf(pid).length || Clips.api.counts.get(pid)?.comments || 0;
  const cmItem = (c) => { const u = cmUser(c.author); return `<li class="cl-cm-item"><span class="cl-cm-av" aria-hidden="true">${av(u, "sm").replace(/^<a\b/, "<span").replace(/ href="[^"]*"/, "").replace(/<\/a>$/, "</span>")}</span><div class="cl-cm-body"><div class="cl-cm-meta"><b data-noi18n><bdi>${esc(u.name)}</bdi></b> <span class="muted">${typeof relTime === "function" ? relTime(c.createdAt) : ""}</span></div><p class="cl-cm-text" data-noi18n dir="auto">${richText(c.text)}</p></div></li>`; };
  function cmRender() {
    if (!CM.el) return; const all = S.commentsOf(CM.pid).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    CM.el.querySelector(".cl-cm-n").textContent = window.UI?.num ? UI.num(all.length || cmCount(CM.pid) || 0) : String(all.length);
    CM.el.querySelector(".cl-cm-list").innerHTML = all.length ? all.map(cmItem).join("") : `<li class="cl-cm-empty muted">كن أول من يعلّق</li>`;
  }
  const cmSec = (pid) => Clips.api.feed()?.querySelector(`.short[data-short="${CSS.escape(pid)}"]`) || null;
  function cmSyncCount(pid) {
    const sec = cmSec(pid); if (!sec) return; const n = cmCount(pid);
    const s = sec.querySelector('.short-actions a[href^="#/post/"] span'); if (s) s.textContent = n || "";
    try { Clips.rail?.sync?.(sec); } catch (e) { console.error("Clips.rail.sync", e); }
  }
  async function cmFetch(pid) {
    if (!online()) return;
    try {
      const r = await api("GET", `/api/posts/${encodeURIComponent(pid)}/comments`);
      if (!Array.isArray(r?.comments)) return; const have = new Set(DB.comments.map(c => c.id)); let add = 0;
      for (const c of r.comments) if (c?.id && !have.has(c.id)) { DB.comments.push({ parent: null, status: "published", ...c, post: c.post || pid }); add++; }
      if (add && CM.pid === pid) { cmRender(); cmSyncCount(pid); }
    } catch { /* offline / private: the local list stays */ }
  }
  function cmClose({ fromPop = false, leaving = false } = {}) {
    if (!CM.el) return; const el = CM.el, opener = CM.opener, pid0 = CM.pid; CM.el = null; CM.pid = null; CM.opener = null;
    document.removeEventListener("keydown", cmKey, true);
    el.classList.remove("open"); const done = () => el.remove();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || leaving) done(); else setTimeout(done, 220);
    if (CM.pushed) { CM.pushed = false; if (!fromPop && !leaving && history.state?.clipsCm) { CM.skipPop = true; history.back(); } }
    if (!leaving) cmRefocus(opener, pid0);
  }
  // focus back to the opener; the store re-sync after a comment can re-render the feed, so re-query the same clip's link
  // by post id (now and twice more after a re-render), falling back to the clip in view, then the back button
  const CM_BTN = '.short-actions a[href^="#/post/"], [data-cl-rail="comment"]'; // clip link, or the v271 rail button that replaces it
  const cmLink = (pid) => cmSec(pid)?.querySelector(CM_BTN) || Clips.api.feed()?.querySelector(CM_BTN) || document.querySelector(".shorts-back") || null; // empty feed: the clips back button
  function cmRefocus(opener, pid) {
    const go = () => { if (CM.el || !document.body.classList.contains("shorts-mode")) return; const a = document.activeElement; if (a && a !== document.body && a.isConnected) return; const t = opener?.isConnected ? opener : cmLink(pid); t?.focus({ preventScroll: true }); };
    const t0 = opener?.isConnected ? opener : cmLink(pid); t0?.focus({ preventScroll: true });
    setTimeout(go, 350); setTimeout(go, 1200);
  }
  function cmKey(e) {
    if (!CM.el) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cmClose(); return; }
    if (e.key !== "Tab") return;
    const f = [...CM.el.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!f.length) return; const first = f[0], last = f[f.length - 1];
    if (!CM.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function cmOpen(post, opener) {
    const pid = typeof post === "string" ? post : post?.id; if (!pid) return;
    const wasPushed = CM.pushed && !!CM.el; if (CM.el) { CM.pushed = false; cmClose({ leaving: true }); } // swap posts: keep the one history entry
    CM.pid = pid; CM.opener = opener || document.activeElement;
    const el = document.createElement("div"); el.className = "cl-cm";
    el.innerHTML = `<div class="cl-cm-backdrop" data-cm-close></div><div class="cl-cm-sheet" role="dialog" aria-modal="true" aria-labelledby="cl-cm-h">
      <header class="cl-cm-head"><span class="cl-cm-grip" aria-hidden="true"></span><h2 id="cl-cm-h">التعليقات <span class="cl-cm-n muted"></span></h2><button type="button" class="cl-cm-x" data-cm-close aria-label="إغلاق">${ic("x")}</button></header>
      <ul class="cl-cm-list" aria-live="polite"></ul>
      <form class="cl-cm-form"><input class="cl-cm-in" name="t" maxlength="2000" autocomplete="off" placeholder="اكتب تعليقاً…" aria-label="اكتب تعليقاً…"><button type="submit" class="btn cl-cm-send">إرسال</button></form></div>`;
    document.body.appendChild(el); CM.el = el; cmRender();
    el.addEventListener("click", (e) => { if (e.target.closest("[data-cm-close]")) cmClose(); });
    el.querySelector(".cl-cm-form").addEventListener("submit", (e) => {
      e.preventDefault(); const inp = el.querySelector(".cl-cm-in"), t = inp.value.trim(); if (!t) return;
      const r = Cmd.comment(pid, t); if (r?.error) { if (typeof toast === "function") toast(r.error); return; }
      inp.value = ""; cmRender(); cmSyncCount(pid);
      const list = el.querySelector(".cl-cm-list"); list.scrollTop = list.scrollHeight;
    });
    document.addEventListener("keydown", cmKey, true);
    if (!wasPushed) history.pushState({ ...(history.state || {}), clipsCm: 1 }, ""); CM.pushed = true;
    requestAnimationFrame(() => { el.classList.add("open"); el.querySelector(".cl-cm-x").focus({ preventScroll: true }); });
    cmFetch(pid);
  }
  addEventListener("popstate", () => { if (CM.skipPop) { CM.skipPop = false; return; } if (CM.el) cmClose({ fromPop: true }); });
  document.addEventListener("clips:comments", (e) => {
    const post = e.detail?.post; if (!post) return; e.preventDefault(); if (e.detail) e.detail.handled = true;
    cmOpen(post, document.activeElement);
  });
  Clips.onSection((sec, post) => {
    const a = sec.querySelector('.short-actions a[href^="#/post/"]'); if (!a || a._clCm) return; a._clCm = 1;
    a.setAttribute("aria-haspopup", "dialog");
    a.addEventListener("click", (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0) return; e.preventDefault(); cmOpen(post || sec.dataset.short, a); });
  });
  Clips.onLeave(() => cmClose({ leaving: true }));
  Clips.comments = { open: cmOpen, close: () => cmClose(), isOpen: () => !!CM.el };
  /* === end v271-comments === */
})();
