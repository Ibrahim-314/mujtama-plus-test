/* مجتمع بلس — «فيديوتك» (Vidtik) v2.75: the creator's short-video profile (video/clips/creator.js).
 * Part of the lazy "clips" chunk; block marker: v275-creator. Route: #/clips/@<handle>.
 * GET /api/clips/creator/:handle → header (avatar, name, @handle, bio, counts: videos · likes · followers · following,
 * Follow through the app-wide [data-follow] handler, «الملف الكامل» → #/u/<handle>) + a 3-column 9:16 grid, newest first,
 * paged with an IntersectionObserver (no scroll handlers). A tile opens the viewer on that clip (#/clips?start=<id>).
 * The owner also sees «＋ فيديو جديد» and their clips still being processed. The overlay name in the viewer links here. */
(function VidtikCreator() {
  const { ic, api, online, fmtDur } = Clips.util;
  /* === v275-creator === */
  const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (n) => { n = +n || 0; return n >= 1e6 ? (Math.round(n / 1e5) / 10) + "M" : n >= 1e4 ? (Math.round(n / 1e2) / 10) + "K" : n.toLocaleString("en-US"); };
  const dur = (s) => (typeof fmtDur === "function" ? fmtDur(s) : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
  const poster = (p) => { const v = p.video || {}; return MPVideoSources.poster(v) || p.cover || ""; };

  let selfView = false; // v2.76: the owner gets a pin toggle on each tile
  function tile(p) {
    const po = poster(p), d = +(p.video?.duration) || 0, cap = String(p.text || "").replace(/\s+/g, " ").slice(0, 60);
    const pinBtn = selfView ? `<button type="button" class="vt-pin" data-vt-pin="${esc(p.id)}" aria-pressed="${!!p.pinned}" aria-label="${p.pinned ? T("إلغاء التثبيت") : T("ثبّته أعلى ملفك")}" title="${p.pinned ? T("إلغاء التثبيت") : T("ثبّته أعلى ملفك")}">${ic("pin", "xs")}</button>` : "";
    const statBtn = selfView ? `<a class="vt-stat" href="#/clips/stats/${encodeURIComponent(p.id)}" aria-label="${T("إحصاءات الفيديو")}" title="${T("إحصاءات الفيديو")}">${ic("chart", "xs")}</a>` : ""; // v2.80
    return `<li class="vt-li${p.pinned ? " is-pinned" : ""}">${pinBtn}${statBtn}<a class="vt-tile" href="#/clips?start=${encodeURIComponent(p.id)}">${p.pinned ? `<span class="vt-tile-pin">${ic("pin", "xs")}<span>${T("مثبّت")}</span></span>` : ""}${po ? `<img src="${esc(po)}" alt="" loading="lazy" decoding="async" width="180" height="320">` : `<span class="vt-tile-ph" aria-hidden="true">${ic("play", "lg")}</span>`}`
      + `<span class="vt-tile-st" aria-hidden="true">${ic("heart", "xs")}<bdi>${num(p.counts?.likes)}</bdi></span>`
      + (d > 0 ? `<span class="vt-tile-dur" aria-hidden="true"><bdi>${dur(d)}</bdi></span>` : "")
      + `<span class="vt-sr">${p.pinned ? T("مثبّت") + " · " : ""}${cap ? `<bdi data-noi18n>${esc(cap)}</bdi>` : T("فيديو")}</span></a></li>`;
  }
  function procTile(x) {
    return `<li><div class="vt-tile vt-tile-proc" role="img" aria-label="${T("جارٍ تجهيز الفيديو")}">${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy" decoding="async" width="180" height="320">` : ""}<span class="vt-proc"><span class="vt-spin" aria-hidden="true"></span>${T("جارٍ التجهيز")}</span></div></li>`;
  }

  /* v2.80: a scheduled clip (owner only) — tap opens «المنشورات المجدولة» to change the time or cancel */
  function schedTile(x) {
    const when = x.publishAt ? new Date(x.publishAt).toLocaleString(document.documentElement.lang === "en" ? "en-GB" : "ar-SA-u-nu-latn", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
    return `<li><a class="vt-tile vt-tile-sched" href="#/scheduled">${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy" decoding="async" width="180" height="320">` : ""}<span class="vt-proc">${ic("clock", "xs")}<span>${T("مجدول")}</span><bdi>${esc(when)}</bdi></span></a></li>`;
  }

  async function page(handle) {
    document.body.classList.remove("shorts-mode");
    const token = {}; view._vt = token;
    // v2.140.2: a refresh of the profile already on screen (sync / realtime re-render) keeps it until the new data lands — no skeleton flash
    const same = view._vtHandle === handle && view.querySelector(".vt-pf .vt-grid"); view._vtHandle = handle;
    if (!same) view.innerHTML = `<div class="wrap vt-pf" aria-busy="true"><div class="vt-pf-skel"><span></span><span></span><span></span></div></div>`;
    let r;
    try { r = await api("GET", "/api/clips/creator/" + encodeURIComponent(handle)); }
    catch (e) {
      if (view._vt !== token) return;
      view.innerHTML = `<div class="wrap vt-pf"><div class="empty" role="status"><p>${esc(e?.status === 404 ? T("المستخدم غير موجود") : (online() ? (e?.message || T("تعذّر التحميل")) : T("لا يوجد اتصال")))}</p><a class="btn ghost" href="#/clips">${T("رجوع إلى فيديوتك")}</a></div></div>`;
      return;
    }
    if (view._vt !== token) return;
    const u = r.user || {}, c = r.counts || {};
    selfView = !!r.self;
    if (window.DB?.users && u.id && !DB.users.some((x) => x.id === u.id)) DB.users.push(u);
    if (Array.isArray(window.DB?.follows) && u.id && !r.self) { // keep the local follow state in line with the server so the shared toggle goes the right way
      const has = DB.follows.some((f) => f.from === DB.me && f.to === u.id);
      if (r.following && !has) DB.follows.push({ from: DB.me, to: u.id, at: new Date().toISOString() });
      else if (!r.following && has) DB.follows = DB.follows.filter((f) => !(f.from === DB.me && f.to === u.id));
    }
    const followBtn = r.self ? `<a class="btn vt-pf-new" href="#/clips/create">${ic("plus", "sm")}<span>${T("فيديو جديد")}</span></a>`
      : `<button type="button" class="btn vt-pf-follow" data-follow="${esc(u.id)}" aria-pressed="${!!r.following}">${r.following ? "تتابعه" : "تابع"}</button>`;
    view.innerHTML = `<div class="wrap vt-pf">
      <header class="vt-pf-top"><a class="vt-ib" href="#/clips" aria-label="${T("رجوع إلى فيديوتك")}">${ic("x")}</a><span class="vt-pf-brand">${T("فيديوتك")}</span><span class="vt-ib-sp" aria-hidden="true"></span></header>
      <section class="vt-pf-head">
        <span class="vt-pf-av" aria-hidden="true">${esc(String(u.name || "?").trim().charAt(0))}</span>
        <h1 class="vt-pf-name"><bdi data-noi18n>${esc(u.name || "")}</bdi>${u.badge ? `<span class="vt-pf-badge" role="img" aria-label="${T("موثّق")}">${ic("verified", "xs")}</span>` : ""}</h1>
        <p class="vt-pf-h" dir="ltr">@<bdi data-noi18n>${esc(u.handle || "")}</bdi></p>
        <ul class="vt-pf-counts">
          <li><b><bdi>${num(c.following)}</bdi></b><span>${T("يتابع")}</span></li>
          <li><b><bdi>${num(c.followers)}</bdi></b><span>${T("متابِع")}</span></li>
          <li><b><bdi>${num(c.likes)}</bdi></b><span>${T("إعجاب")}</span></li>
          <li><b><bdi>${num(c.clips)}</bdi></b><span>${T("فيديو")}</span></li>
        </ul>
        <div class="vt-pf-acts">${followBtn}<a class="btn ghost" href="#/u/${encodeURIComponent(u.handle || "")}">${T("الملف الكامل")}</a></div>
        ${u.bio ? `<p class="vt-pf-bio"><bdi data-noi18n>${esc(u.bio)}</bdi></p>` : ""}
      </section>
      ${r.self ? `<section class="vt-tools" data-vt-tools aria-label="${T("أدوات الصانع")}"><a class="vt-tool" href="#/clips/drafts">${ic("doc", "sm")}<span>${T("المسودات")}</span><b class="vt-tool-n" data-vt-drafts hidden></b></a><div class="vt-best" data-vt-best hidden></div></section>` : ""}
      <h2 class="vt-sr">${T("فيديوهات")}</h2>
      <ul class="vt-grid">${(r.scheduled || []).map(schedTile).join("")}${(r.processing || []).map(procTile).join("")}${(r.items || []).map(tile).join("")}</ul>
      ${!(r.items || []).length && !(r.processing || []).length && !(r.scheduled || []).length ? `<div class="empty vt-pf-empty" role="status"><p>${r.self ? T("لم تنشر أي فيديو بعد") : T("لا توجد فيديوهات بعد")}</p>${r.self ? `<a class="btn" href="#/clips/create">${T("انشر أول فيديو")}</a>` : ""}</div>` : ""}
      <div class="vt-more" aria-hidden="true"></div>
    </div>`;
    if (r.self) try { dispatchEvent(new CustomEvent("vt:creator-self", { detail: { root: view.querySelector("[data-vt-tools]") } })); } catch { /* studio add-on optional */ } // v2.80 studio.js fills drafts count + best time
    { const avEl = view.querySelector(".vt-pf-av"); if (avEl) avEl.style.background = u.color || "var(--accent)"; } // the user's colour, set as a property (never interpolated into HTML)
    for (const p of r.items || []) if (window.DB?.posts && !DB.posts.some((x) => x.id === p.id)) DB.posts.push(p); // the viewer opens on it at once
    const grid = view.querySelector(".vt-grid"), sentinel = view.querySelector(".vt-more");
    grid.addEventListener("click", async (e) => { // v2.76 pin / unpin (owner only; the server checks ownership too)
      const b = e.target.closest("[data-vt-pin]"); if (!b) return;
      e.preventDefault(); b.disabled = true;
      const on = b.getAttribute("aria-pressed") !== "true";
      try { await api(on ? "PUT" : "DELETE", on ? `/api/clips/${encodeURIComponent(b.dataset.vtPin)}/pin` : "/api/clips/pin"); if (typeof toast === "function") toast(on ? T("ثُبّت الفيديو أعلى ملفك") : T("أُلغي التثبيت")); if (view._vt === token) page(handle); }
      catch (x) { if (typeof toast === "function") toast(x?.message || T("تعذّر الإجراء")); b.disabled = false; }
    });
    let next = r.next, loading = false;
    const io = new IntersectionObserver(async (ents) => {
      if (!ents.some((e) => e.isIntersecting) || loading || !next || view._vt !== token) return;
      loading = true;
      try {
        const m = await api("GET", "/api/clips/creator/" + encodeURIComponent(handle) + "?cursor=" + encodeURIComponent(next));
        if (view._vt !== token) return;
        for (const p of m.items || []) if (window.DB?.posts && !DB.posts.some((x) => x.id === p.id)) DB.posts.push(p);
        grid.insertAdjacentHTML("beforeend", (m.items || []).map(tile).join("")); next = m.next;
      } catch { /* try again on the next intersection */ } finally { loading = false; if (!next) io.disconnect(); }
    }, { rootMargin: "600px 0px" });
    if (next) io.observe(sentinel);
    addEventListener("hashchange", function off() { removeEventListener("hashchange", off); io.disconnect(); if (view._vt === token) view._vt = null; });
  }

  const base = Clips.view;
  Clips.view = function () {
    const m = /^#\/clips\/@([^?/]+)/.exec(location.hash);
    if (m) { let h = m[1]; try { h = decodeURIComponent(h); } catch { /* keep raw */ } return page(h); }
    return base.apply(this, arguments);
  };
  // the creator name in the viewer overlay opens their فيديوتك profile (the full profile stays one tap away there)
  Clips.onSection((sec) => {
    const a = sec.querySelector('a.cl-ov-name[href^="#/u/"]'); if (a) a.setAttribute("href", "#/clips/@" + a.getAttribute("href").slice(4));
  });
  Clips.creator = { open: (h) => { location.hash = "#/clips/@" + encodeURIComponent(h); } };
  /* === /v275-creator === */
})();
