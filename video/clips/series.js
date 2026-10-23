/* مجتمع بلس — «لقطات» feature: series experience inside the viewer (video/clips/series.js).
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips;
 * block marker kept: v273-series. Server side is the existing series API (phase 62) — nothing new on the server.
 *
 *  1. Ribbon: on a clip that is a part of a series, a glass card at the top shows the series title, «الجزء N من M» and
 *     a story-style segmented bar (one segment per part, ≤12; a continuous bar beyond that). Tapping it opens the
 *     episodes sheet. A «التالي» button beside it jumps to the next part.       (GET /api/cseries/for-post/:id, cached)
 *  2. Episodes sheet: series cover tile, author, parts count + how many the viewer has seen + upcoming, a follow toggle
 *     (PUT/DELETE /api/cseries/:id/follow, new-episode notifications), «تابع من حيث توقفت» (first unseen part),
 *     a horizontal strip of 9:16 part cards (now-playing badge, seen check) and a link to the full series page.
 *     Data: GET /api/cseries/:id (lazy, cached). Closes by ✕ / Esc / backdrop / back button; focus trapped while open,
 *     returned to the ribbon on close.
 *  3. Up next: near the end of a part's first play (80%) a card offers the next part with a 5-second ring; it moves on
 *     by itself unless cancelled (reduced motion: no auto-advance, the card just waits). Once per visit of the clip.
 *  4. On the creator's own clip that is not in a series: a quiet «＋ أضفها إلى سلسلة» text link under the sound line.
 */
(function ClipsSeries() {
  const { ic, api, online } = Clips.util;
  /* === v273-series === */
  const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
  const en = () => (typeof DB !== "undefined" && DB.settings?.lang === "en");
  const num = (n) => (window.UI?.num ? UI.num(n) : String(n));
  const say = (m) => { if (typeof toast === "function") toast(m); };
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const partOf = (n, m) => (en() ? `Part ${num(n)} of ${num(m)}` : `الجزء ${num(n)} من ${num(m)}`);
  const partN = (n) => (en() ? `Part ${num(n)}` : `الجزء ${num(n)}`);
  const STACK = `<svg class="cl-sr-stack" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="13" height="13" rx="3"/><path d="M7 5h10a3 3 0 0 1 3 3v10"/></svg>`;
  const pct = (root) => root.querySelectorAll("i[data-p]").forEach((i) => i.style.setProperty("--p", i.dataset.p + "%"));
  const posterOf = (id, cover) => { const P = S.post(id); return cover || MPVideoSources.poster(P?.video) || ""; };

  const FOR = new Map(), FULL = new Map(); // post id → Promise<forPost>, series id → Promise<getSeries>
  const forPost = (id) => { if (!FOR.has(id)) FOR.set(id, online() ? api("GET", "/api/cseries/for-post/" + encodeURIComponent(id)).catch(() => null) : Promise.resolve(null)); return FOR.get(id); };
  const full = (sid) => { if (!FULL.has(sid)) FULL.set(sid, api("GET", "/api/cseries/" + encodeURIComponent(sid)).catch(() => null)); return FULL.get(sid); };

  const openPart = async (id) => {
    const inFeed = Clips.api.feed()?.querySelector(`.short[data-short="${CSS.escape(id)}"]`);
    if (inFeed) { inFeed.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" }); return; } // already in this feed: just move to it
    if (!S.post(id) && online()) { try { const r = await api("GET", "/api/posts/" + encodeURIComponent(id)); if (r?.post?.id && !S.post(r.post.id)) DB.posts.push(r.post); } catch { /* the viewer still opens */ } }
    location.hash = "#/clips?start=" + encodeURIComponent(id);
  };

  /* ---- 1. ribbon ---- */
  function segs(n, m) {
    if (m > 12) return `<span class="cl-sr-bar"><i data-p="${Math.round((n / m) * 100)}"></i></span>`;
    let h = ""; for (let k = 1; k <= m; k++) h += `<i class="${k < n ? "past" : k === n ? "now" : ""}"></i>`;
    return `<span class="cl-sr-segs">${h}</span>`;
  }
  function ribbon(sec, p, r) {
    const s = r.series, N = r.episode, M = Math.max(r.total || N, N);
    const box = document.createElement("div"); box.className = "cl-ser"; box.dataset.sid = s.id;
    box.innerHTML = `<button type="button" class="cl-ser-chip" aria-haspopup="dialog">`
      + `<span class="cl-sr-ic" aria-hidden="true">${STACK}</span><span class="cl-sr-txt"><b data-noi18n dir="auto">${esc(s.title || T("سلسلة"))}</b><small data-noi18n>${partOf(N, M)}</small></span>`
      + `<span class="cl-sr-more" aria-hidden="true"></span><span class="cl-sr-line" aria-hidden="true">${segs(N, M)}</span></button>`
      + (r.next?.id ? `<button type="button" class="cl-ser-next" data-cl-next="${esc(r.next.id)}" aria-label="${esc(T("الجزء التالي") + " — " + partN(r.next.episode || N + 1))}"><span class="cl-sr-skip" aria-hidden="true"></span></button>` : "");
    const host = sec.querySelector(".short-info.cl-ov .cl-ov-body") || sec.querySelector(".short-info.cl-ov"); if (host) host.prepend(box); else sec.appendChild(box); pct(box);
    box.querySelector(".cl-ser-chip").addEventListener("click", (e) => { e.stopPropagation(); sheet(r, p.id, e.currentTarget); });
    box.querySelector("[data-cl-next]")?.addEventListener("click", (e) => { e.stopPropagation(); openPart(e.currentTarget.dataset.clNext); });
    requestAnimationFrame(() => box.classList.add("in"));
  }
  function addLink(sec) {
    const snd = sec.querySelector(".cl-ov-snd"); if (!snd || sec.querySelector(".cl-ser-add")) return;
    const a = document.createElement("a"); a.className = "cl-ser-add"; a.href = "#/series";
    a.innerHTML = `<span aria-hidden="true">＋</span> ${T("أضفها إلى سلسلة")}`;
    snd.insertAdjacentElement("afterend", a);
  }
  Clips.onCurrent((sec, _i, p) => {
    if (!p) return; upNext.arm(sec);
    if (sec._clSer) return; sec._clSer = 1;
    forPost(p.id).then((r) => {
      if (!sec.isConnected || sec.querySelector(".cl-ser")) return;
      if (r?.series && r.episode) { sec._clSerR = r; ribbon(sec, p, r); upNext.arm(sec); }
      else if (p.author === DB.me && online()) addLink(sec);
    });
  });

  /* ---- 2. episodes sheet ---- */
  const SH = { el: null, opener: null, pushed: false, skipPop: false };
  function card(it, cur) {
    const poster = posterOf(it.id, it.cover), now = it.id === cur, ep = it.episode;
    const lbl = ep ? partN(ep) : (it.status === "scheduled" ? T("قريباً") : T("مسودة"));
    return `<li><button type="button" class="cl-sr-card${now ? " now" : ""}${it.seen && !now ? " seen" : ""}" data-part="${esc(it.id)}"${ep ? "" : " disabled"}${now ? ' aria-current="true"' : ""}>`
      + (poster ? `<img src="${esc(poster)}" alt="" loading="lazy" decoding="async">` : `<span class="cl-sr-ph" aria-hidden="true" data-noi18n>${ep ? num(ep) : "…"}</span>`)
      + `<span class="cl-sr-ep" data-noi18n>${esc(lbl)}</span>`
      + (now ? `<span class="cl-sr-flag">${T("الآن")}</span>` : it.seen ? `<span class="cl-sr-seen" role="img" aria-label="${esc(T("شاهدتها"))}">${ic("check", "sm")}</span>` : "")
      + `<span class="cl-sr-ct" dir="auto" data-noi18n>${esc(it.title || "")}</span></button></li>`;
  }
  function paint(d, r, cur) {
    if (!SH.el) return; const body = SH.el.querySelector(".cl-srs-body");
    if (!d?.series) { body.innerHTML = `<p class="cl-srs-msg muted">${T("تعذّر تحميل السلسلة")}</p>`; return; }
    const s = d.series, own = !!d.me?.owner, items = (d.items || []).filter((x) => x.episode || own || x.status === "scheduled"), eps = items.filter((x) => x.episode).length;
    const seen = Math.min(d.me?.seen || 0, eps), up = items.filter((x) => x.status === "scheduled").length || r?.upcoming || 0, fol = !!d.me?.following;
    const res = d.me?.resume && d.me.resume.id !== cur ? d.me.resume : null, auth = s.author?.name || "";
    body.innerHTML = `<div class="cl-srs-hero"><span class="cl-srs-cov" aria-hidden="true">${s.cover ? `<img src="${esc(s.cover)}" alt="">` : STACK}</span>`
      + `<div class="cl-srs-meta"><h2 id="clsrs-t" data-noi18n><bdi>${esc(s.title || "")}</bdi></h2>`
      + `<p class="cl-srs-stat muted">${auth ? `<bdi data-noi18n>${esc(auth)}</bdi> · ` : ""}${[`${num(eps)} ${T(eps === 1 ? "حلقة" : "حلقات")}`, seen ? `${T("شاهدت")} ${num(seen)}` : "", up ? `${num(up)} ${T("قادمة")}` : ""].filter(Boolean).join(" · ")}</p></div>`
      + (own ? "" : `<button type="button" class="btn sm cl-srs-fol${fol ? " ghost" : ""}" aria-pressed="${fol}">${T(fol ? "تتابع السلسلة" : "تابع السلسلة")}</button>`) + `</div>`
      + (eps ? `<div class="cl-srs-prog" role="img" aria-label="${esc((en() ? "Seen " : "شاهدت ") + num(seen) + (en() ? " of " : " من ") + num(eps))}"><i data-p="${Math.round((seen / eps) * 100)}"></i></div>` : "")
      + (res ? `<button type="button" class="cl-srs-res" data-part="${esc(res.id)}"><span class="cl-srs-res-play" aria-hidden="true"></span><span><b>${T("تابع من حيث توقفت")}</b><small data-noi18n dir="auto">${esc(partN(res.episode) + (res.title ? " · " + res.title : ""))}</small></span></button>` : "")
      + `<ul class="cl-srs-strip" aria-labelledby="clsrs-t">${items.map((x) => card(x, cur)).join("")}</ul>`
      + `<a class="cl-srs-all" href="#/series/${encodeURIComponent(s.id)}">${T("صفحة السلسلة")}<span class="cl-sr-chev" aria-hidden="true"></span></a>`;
    pct(body);
    body.querySelectorAll("[data-part]").forEach((b) => b.addEventListener("click", () => { const id = b.dataset.part; if (id === cur) { close(); return; } close({ quiet: true }); openPart(id); }));
    const fb = body.querySelector(".cl-srs-fol");
    fb?.addEventListener("click", async () => {
      const on = fb.getAttribute("aria-pressed") !== "true"; fb.disabled = true;
      try {
        await api(on ? "PUT" : "DELETE", `/api/cseries/${encodeURIComponent(s.id)}/follow`, on ? { notify: true } : undefined);
        fb.setAttribute("aria-pressed", String(on)); fb.classList.toggle("ghost", on); fb.textContent = T(on ? "تتابع السلسلة" : "تابع السلسلة");
        if (d.me) d.me.following = on; if (r) r.following = on; say(T(on ? "ستصلك الحلقات الجديدة" : "ألغيت متابعة السلسلة"));
      } catch { say(T("تعذّر الحفظ، حاول مجدداً")); }
      fb.disabled = false;
    });
    const now = body.querySelector(".cl-sr-card.now"); if (now) requestAnimationFrame(() => now.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" }));
  }
  function sheet(r, cur, opener) {
    if (SH.el) return; upNext.hide();
    const el = document.createElement("div"); el.className = "cl-srs";
    el.innerHTML = `<div class="cl-srs-backdrop"></div><div class="cl-srs-sheet" role="dialog" aria-modal="true" aria-label="${esc(T("حلقات السلسلة"))}"><span class="cl-srs-grip" aria-hidden="true"></span>`
      + `<button type="button" class="cl-srs-x" aria-label="${esc(T("إغلاق"))}">${ic("x")}</button>`
      + `<div class="cl-srs-body"><div class="cl-srs-skel" aria-hidden="true"><i></i><i></i><i></i></div></div></div>`;
    document.body.appendChild(el); SH.el = el; SH.opener = opener;
    el.querySelector(".cl-srs-backdrop").addEventListener("click", () => close());
    el.querySelector(".cl-srs-x").addEventListener("click", () => close());
    document.addEventListener("keydown", key, true);
    try { history.pushState({ clipsSr: 1 }, ""); SH.pushed = true; } catch { /* no history */ }
    requestAnimationFrame(() => { el.classList.add("open"); el.querySelector(".cl-srs-x").focus({ preventScroll: true }); });
    full(r.series.id).then((d) => paint(d, r, cur));
  }
  function close({ fromPop = false, leaving = false, quiet = false } = {}) {
    if (!SH.el) return; const el = SH.el, op = SH.opener; SH.el = null; SH.opener = null;
    document.removeEventListener("keydown", key, true);
    el.classList.remove("open"); if (still() || leaving) el.remove(); else setTimeout(() => el.remove(), 220);
    if (SH.pushed) { SH.pushed = false; if (!fromPop && !leaving && history.state?.clipsSr) { SH.skipPop = true; history.back(); } }
    if (!leaving && !quiet && op?.isConnected) op.focus({ preventScroll: true });
  }
  function key(e) {
    if (!SH.el) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...SH.el.querySelectorAll("button:not([disabled]),a[href]")].filter((x) => x.offsetParent !== null);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (!SH.el.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
    else if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
  addEventListener("popstate", () => { if (SH.skipPop) { SH.skipPop = false; return; } if (SH.el) close({ fromPop: true }); });

  /* ---- 3. up next ---- */
  const upNext = (() => {
    let sec = null, v = null, el = null, t = null, done = new WeakSet();
    const off = () => { if (v) v.removeEventListener("timeupdate", tick); v = null; };
    function hide() { clearTimeout(t); t = null; if (el) { const e = el; el = null; e.classList.remove("in"); if (still()) e.remove(); else setTimeout(() => e.remove(), 200); } }
    function show() {
      const r = sec?._clSerR; if (!r?.next?.id || el || SH.el) return; done.add(sec); off();
      const poster = posterOf(r.next.id), id = r.next.id;
      el = document.createElement("div"); el.className = "cl-up"; el.setAttribute("role", "status");
      el.innerHTML = `<span class="cl-up-th" aria-hidden="true">${poster ? `<img src="${esc(poster)}" alt="">` : STACK}<svg class="cl-up-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"/></svg></span>`
        + `<span class="cl-up-t"><small>${T("التالي")} · <span data-noi18n>${partN(r.next.episode || (r.episode || 0) + 1)}</span></small><b dir="auto" data-noi18n>${esc(r.next.title || r.series?.title || "")}</b></span>`
        + `<button type="button" class="cl-up-go">${T("شاهد الآن")}</button><button type="button" class="cl-up-x" aria-label="${esc(T("إلغاء"))}">${ic("x", "sm")}</button>`;
      sec.appendChild(el);
      el.querySelector(".cl-up-go").addEventListener("click", (e) => { e.stopPropagation(); hide(); openPart(id); });
      el.querySelector(".cl-up-x").addEventListener("click", (e) => { e.stopPropagation(); hide(); });
      const me = el; requestAnimationFrame(() => me.classList.add("in", still() ? "still" : "run"));
      if (!still()) t = setTimeout(() => { if (el === me && sec?.isConnected && document.body.classList.contains("shorts-mode") && !SH.el) { hide(); openPart(id); } }, 5000);
    }
    function tick() { if (!v || !v.duration || !isFinite(v.duration) || v.duration < 4) return; if (v.currentTime / v.duration >= 0.8) show(); }
    function arm(s) {
      if (s !== sec) { hide(); off(); sec = s; }
      if (!s._clSerR?.next?.id || done.has(s) || v) return;
      const vid = s.querySelector("video"); if (!vid) { setTimeout(() => { if (sec === s) arm(s); }, 600); return; }
      v = vid; v.addEventListener("timeupdate", tick);
    }
    return { arm, hide, show: () => show(), reset() { hide(); off(); sec = null; done = new WeakSet(); } };
  })();

  Clips.onLeave(() => { upNext.reset(); close({ leaving: true }); });
  Clips.onView(() => { upNext.reset(); if (FOR.size > 200) FOR.clear(); FULL.clear(); });
  Clips.series = { open: openPart, upNext };
  /* === end v273-series === */
})();
