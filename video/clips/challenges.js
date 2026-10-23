/* مجتمع بلس — «لقطات» feature: «تحدي الأسبوع» weekly Vidtik challenges (video/clips/challenges.js) — v278-challenges.
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips
 * (hooks / api / util, documented in video/clips/core.js) and wraps Clips.view for its own routes:
 *   #/clips/challenges         the live challenge, upcoming ones, past ones with their winners; staff add / edit / cancel here
 *   #/clips/challenge/<id>     brief + countdown + counts, «شارك بلقطة», my rank, top / newest grid, winners podium
 *   #/clips/create?tag=<tag>   opens the Vidtik editor with «#tag » already in the caption (create.js itself is untouched)
 * In the feed: a small pill under the tabs opens the live challenge (hidden in clean-screen mode with the other overlays),
 * and a clip that takes part shows a «مشارك في التحدي» chip in its caption block.
 * Server: GET/POST /api/clips/challenges, GET/PATCH /api/clips/challenges/:id, POST …/cancel, …/restore (services/challenges.js). */
(function ClipsChallenges() {
  const { ic, api, online, fmtDur } = Clips.util;
  const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
  const say = (m) => { if (typeof toast === "function") toast(m); };
  const norm = (t) => (typeof normalizeTag === "function" ? normalizeTag(t) : String(t || "").toLowerCase());
  const tagsOf = (p) => (typeof S.hashtags === "function" ? S.hashtags(p.text || "") : (String(p.text || "").match(/#([\p{L}\p{N}_]+)/gu) || []).map((x) => norm(x.slice(1))));
  const nf = (n) => (window.UI?.nfmt ? UI.nfmt(n) : String(n));
  const en = () => document.documentElement.lang === "en" || document.documentElement.dir === "ltr";

  /* ---------- data: one shared, short-lived copy of the list ---------- */
  let cache = null, cacheAt = 0;
  function load(force) {
    if (!online()) return Promise.resolve(null);
    if (!force && cache && Date.now() - cacheAt < 5 * 60e3) return cache;
    cacheAt = Date.now();
    cache = api("GET", "/api/clips/challenges").catch(() => { cacheAt = 0; return null; });
    return cache;
  }
  const inWindow = (c, p) => { const t = Date.parse(p.createdAt || p.created_at || 0); return t >= Date.parse(c.startsAt) && t < Date.parse(c.endsAt); };

  /* ---------- time words ---------- */
  function left(ms) {
    ms = Math.max(0, ms);
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
    if (en()) return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
    const unit = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
    const dd = unit(d, "يوم", "يومين", "أيام", "يوماً"), hh = unit(h, "ساعة", "ساعتين", "ساعات", "ساعة"), mm = unit(Math.max(1, m), "دقيقة", "دقيقتين", "دقائق", "دقيقة");
    return d ? (h ? `${dd} و${hh}` : dd) : h ? (m ? `${hh} و${mm}` : hh) : mm;
  }
  function when(c) {
    const now = Date.now();
    if (c.status === "cancelled") return T("أُلغي");
    if (c.phase === "upcoming") return (en() ? "Starts in " : "يبدأ بعد ") + left(Date.parse(c.startsAt) - now);
    if (c.phase === "live") return (en() ? "Ends in " : "ينتهي بعد ") + left(Date.parse(c.endsAt) - now);
    return T("انتهى");
  }
  const dateTxt = (s) => { try { return new Date(s).toLocaleDateString(en() ? "en-GB" : "ar-SA-u-ca-gregory", { day: "numeric", month: "short" }); } catch { return ""; } };

  /* ---------- 1. feed pill + participant chip ---------- */
  Clips.onView(() => queueMicrotask(() => {
    const feed = Clips.api.feed(); if (!feed || window.MPSession?.state === "out") return;
    load().then((r) => {
      const c = r?.current; if (!c || !feed.isConnected || feed.parentNode.querySelector(".cl-chl-pill")) return;
      feed.insertAdjacentHTML("beforebegin", `<a class="cl-chl-pill" href="#/clips/challenge/${encodeURIComponent(c.id)}">${ic("trophy", "sm")}<span>${T("تحدي الأسبوع")}</span><bdi data-noi18n>#${esc(c.tag)}</bdi></a>`);
      const pill = feed.parentNode.querySelector(".cl-chl-pill");
      const place = () => { if (!feed.isConnected) return; const b = feed.getBoundingClientRect(); pill.style.setProperty("--cl-tabs-x", Math.round(b.left + b.width / 2) + "px"); };
      place(); requestAnimationFrame(place); setTimeout(place, 500); addEventListener("resize", place);
      const off = Clips.onLeave(() => { off(); removeEventListener("resize", place); });
      document.querySelectorAll(".shorts section.short").forEach((sec) => chip(sec, S.post(sec.dataset.short)));
    });
  }));
  function chip(sec, p) {
    if (!sec || !p || sec._clChl) return;
    load().then((r) => {
      const c = r?.current; if (!c || sec._clChl || !sec.isConnected) return;
      if (!tagsOf(p).includes(norm(c.tag)) || !inWindow(c, p)) return;
      const info = sec.querySelector(".short-info"); if (!info) return;
      sec._clChl = 1;
      info.insertAdjacentHTML("beforeend", `<a class="cl-chl-chip" href="#/clips/challenge/${encodeURIComponent(c.id)}">${ic("trophy", "sm")}<span>${T("مشارك في التحدي")}</span></a>`);
    });
  }
  Clips.onSection((sec, p) => { if (cache) chip(sec, p); });

  /* ---------- 2. pages ---------- */
  const tok = () => { const t = {}; view._clChl = t; return () => view._clChl === t; };
  const avatar = (u) => (u?.avatar ? `<img src="${esc(u.avatar)}" alt="" width="40" height="40" loading="lazy">` : `<span aria-hidden="true">${esc((u?.name || "؟").trim().charAt(0))}</span>`);
  const store = (x) => { if (!x || !x.id) return x; if (x.user?.id && !S.user(x.user.id)) DB.users.push({ topics: [], ...x.user }); if (!S.post(x.id)) DB.posts.push(x); return S.post(x.id) || x; };

  function card(c, big) {
    const n = c.counts;
    return `<a class="clc-card${big ? " clc-card-big" : ""}" href="#/clips/challenge/${encodeURIComponent(c.id)}">
      <span class="clc-card-ic" aria-hidden="true">${ic("trophy")}</span>
      <span class="clc-card-t"><strong><bdi data-noi18n>${esc(c.title)}</bdi></strong><small><bdi data-noi18n dir="auto">#${esc(c.tag)}</bdi> · <span>${esc(when(c))}</span></small>
      ${n ? `<small class="clc-card-n"><span>${nf(n.entries)}</span> ${T(n.entries === 1 ? "لقطة" : "لقطات")} · <span>${nf(n.creators)}</span> ${T(n.creators === 1 ? "صانع" : "صنّاع")}</small>` : ""}</span>
      ${c.winners?.length ? `<span class="clc-card-w" aria-label="${T("الفائزون")}">${c.winners.slice(0, 3).map((w) => `<span class="clc-av clc-av-${w.rank}" title="${esc(w.user?.name || "")}">${avatar(w.user)}</span>`).join("")}</span>` : ""}
    </a>`;
  }

  function form(c) {
    const pad = (x) => String(x).padStart(2, "0");
    const local = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const s0 = c ? Date.parse(c.startsAt) : Math.floor(Date.now() / 6e4) * 6e4, e0 = c ? Date.parse(c.endsAt) : s0 + 7 * 864e5;
    const started = c && c.phase !== "upcoming";
    return `<form class="clc-form" novalidate>
      <h3>${T(c ? "تعديل التحدي" : "تحدٍّ جديد")}</h3>
      <label for="clc-title">${T("العنوان")}</label><input id="clc-title" name="title" required minlength="3" maxlength="80" value="${esc(c?.title || "")}" placeholder="${T("مثال: تحدي أسرع وصفة")}">
      <label for="clc-tag">${T("الوسم")}</label><input id="clc-tag" name="tag" required maxlength="41" dir="auto" value="${esc(c ? "#" + c.tag : "")}" placeholder="#تحدي_الطبخ" ${started ? "disabled" : ""}>
      ${started ? `<p class="clc-hint">${T("لا يتغيّر الوسم وموعد البداية بعد بدء التحدي")}</p>` : `<p class="clc-hint">${T("كل لقطة تُنشر خلال الفترة وفيها هذا الوسم تدخل التحدي تلقائياً")}</p>`}
      <label for="clc-body">${T("الفكرة باختصار")}</label><textarea id="clc-body" name="body" rows="3" maxlength="500" placeholder="${T("ماذا يصوّر المشاركون؟")}">${esc(c?.body || "")}</textarea>
      <div class="clc-dates">
        <span><label for="clc-s">${T("البداية")}</label><input id="clc-s" name="startsAt" type="datetime-local" value="${local(s0)}" ${started ? "disabled" : ""}></span>
        <span><label for="clc-e">${T("النهاية")}</label><input id="clc-e" name="endsAt" type="datetime-local" value="${local(e0)}"></span>
      </div>
      ${c ? "" : `<div class="clc-quick" role="group" aria-label="${T("مدة سريعة")}">${[3, 7, 14].map((d) => `<button type="button" class="chip" data-days="${d}">${en() ? d + " days" : d + " " + (d <= 10 ? "أيام" : "يوماً")}</button>`).join("")}</div>`}
      <p class="clc-err" role="alert"></p>
      <div class="clc-acts"><button class="btn" type="submit">${T(c ? "حفظ" : "إطلاق التحدي")}</button><button class="btn ghost" type="button" data-clc="cancel-form">${T("إلغاء")}</button></div>
    </form>`;
  }
  function bindForm(host, c, done) {
    const f = host.querySelector(".clc-form"); if (!f) return;
    const err = f.querySelector(".clc-err");
    f.querySelector("#clc-title").focus();
    f.addEventListener("click", (e) => {
      const q = e.target.closest("[data-days]");
      if (q) { const s = Date.parse(f.startsAt.value) || Date.now(); const d = new Date(s + +q.dataset.days * 864e5); const pad = (x) => String(x).padStart(2, "0"); f.endsAt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
      if (e.target.closest('[data-clc="cancel-form"]')) done(false);
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); err.textContent = "";
      const b = { title: f.title.value.trim(), body: f.body.value.trim(), endsAt: new Date(f.endsAt.value).toISOString() };
      if (!c || c.phase === "upcoming") { b.tag = f.tag.value.trim(); b.startsAt = new Date(f.startsAt.value).toISOString(); }
      if (b.title.length < 3) { err.textContent = T("اكتب عنواناً من 3 أحرف على الأقل"); f.title.focus(); return; }
      if (!c && !b.tag.replace(/^#/, "")) { err.textContent = T("اكتب وسماً للتحدي"); f.tag.focus(); return; }
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
      try {
        const r = c ? await api("PATCH", "/api/clips/challenges/" + encodeURIComponent(c.id), b) : await api("POST", "/api/clips/challenges", b);
        load(true); say(T(c ? "حُفظ التحدي" : "أُطلق التحدي")); done(r.challenge);
      } catch (x) { err.textContent = x?.message || T("تعذّر الحفظ، حاول مجدداً"); btn.disabled = false; }
    });
  }

  function listPage() {
    document.body.classList.remove("shorts-mode");
    const alive = tok();
    view.innerHTML = `<div class="wrap clc">${UI.pageHead({ back: ["#/clips", T("فيديوتك")], title: T("تحديات فيديوتك"), icon: "trophy", sub: T("كل أسبوع فكرة جديدة — صوّر لقطتك بالوسم وتنافس") })}<div class="clc-body" aria-busy="true"><div class="skel"></div><div class="skel"></div></div></div>`;
    const paint = (r) => {
      if (!alive()) return;
      const body = view.querySelector(".clc-body"); body.removeAttribute("aria-busy");
      if (!r) { body.innerHTML = `<div class="empty" role="status">${T("تعذّر تحميل التحديات")}</div>`; return; }
      const none = !r.current && !r.others?.length && !r.upcoming.length && !r.past.length;
      body.innerHTML = (r.staff ? `<div class="clc-staff"><button class="btn" type="button" data-clc="new">${ic("plus", "sm")}<span>${T("تحدٍّ جديد")}</span></button></div><div class="clc-form-host"></div>` : "")
        + (r.current ? `<section aria-labelledby="clc-h-live"><h3 class="clc-h" id="clc-h-live">${T("التحدي الحالي")}</h3>${card(r.current, true)}${(r.others || []).map((c) => card(c)).join("")}</section>` : "")
        + (r.upcoming.length ? `<section aria-labelledby="clc-h-up"><h3 class="clc-h" id="clc-h-up">${T("قريباً")}</h3>${r.upcoming.map((c) => card(c)).join("")}</section>` : "")
        + (r.past.length ? `<section aria-labelledby="clc-h-past"><h3 class="clc-h" id="clc-h-past">${T("تحديات سابقة")}</h3>${r.past.map((c) => card(c)).join("")}</section>` : "")
        + (r.staff && r.cancelled?.length ? `<section aria-labelledby="clc-h-x"><h3 class="clc-h" id="clc-h-x">${T("ملغاة (للفريق)")}</h3>${r.cancelled.map((c) => card(c)).join("")}</section>` : "")
        + (none ? `<div class="empty clc-empty" role="status">${ic("trophy", "lg")}<p>${T("لا يوجد تحدٍّ الآن — ترقّب تحدي الأسبوع القادم")}</p></div>` : "");
      const nb = body.querySelector('[data-clc="new"]');
      if (nb) nb.onclick = () => { const h = body.querySelector(".clc-form-host"); h.innerHTML = form(null); nb.hidden = true; bindForm(h, null, (c) => { if (c) location.hash = "#/clips/challenge/" + encodeURIComponent(c.id); else { h.innerHTML = ""; nb.hidden = false; nb.focus(); } }); };
    };
    load(true).then(paint);
  }

  function detailPage(cid) {
    document.body.classList.remove("shorts-mode");
    const alive = tok();
    let sort = new URLSearchParams(location.hash.split("?")[1] || "").get("sort") === "new" ? "new" : "top";
    let items = [], next = null, data = null, busy = false;
    view.innerHTML = `<div class="wrap clc">${UI.pageHead({ back: ["#/clips/challenges", T("التحديات")], title: T("تحدي الأسبوع"), icon: "trophy" })}<div class="clc-body" aria-busy="true"><div class="skel"></div><div class="skel"></div></div></div>`;
    const body = () => view.querySelector(".clc-body");
    const tile = (p) => {
      const v = p.video || {}, po = MPVideoSources.poster(v), cap = String(p.text || "").replace(/\s+/g, " ").slice(0, 60), d = +v.duration || 0, u = p.user || S.user(p.author);
      const medal = sort === "top" && p.rank && p.rank <= 3 ? ` clc-rank-${p.rank}` : "";
      return `<li><a class="clp-tile" href="#/clips?start=${encodeURIComponent(p.id)}">${po ? `<img src="${esc(po)}" alt="" loading="lazy" decoding="async" width="180" height="320">` : `<span class="clp-tile-ph" aria-hidden="true">${ic("play", "lg")}</span>`}`
        + (sort === "top" && p.rank ? `<span class="clc-rank${medal}"><span class="clp-sr">${T("المركز")} </span><bdi>${p.rank}</bdi></span>` : "")
        + `<span class="clp-tile-cap"><bdi data-noi18n>${esc(u?.name || "")}</bdi>${cap ? ` · <bdi data-noi18n>${esc(cap)}</bdi>` : ""}</span>`
        + `<span class="clc-score" aria-label="${T("إعجابات")}: ${p.counts?.likes || 0}">${ic("heart", "sm")}<bdi>${nf(p.counts?.likes || 0)}</bdi></span>`
        + (d > 0 ? `<span class="clp-tile-dur" aria-hidden="true"><bdi>${fmtDur(d)}</bdi></span>` : "") + `</a></li>`;
    };
    const podium = (w) => !w?.length ? "" : `<section class="clc-pod" aria-labelledby="clc-h-w"><h3 class="clc-h" id="clc-h-w">${ic("medal", "sm")}<span>${T("الفائزون")}</span></h3><ol>${w.map((x) => `<li class="clc-pod-${x.rank}"><a href="${x.live ? `#/clips?start=${encodeURIComponent(x.postId)}` : `#/clips/@${encodeURIComponent(x.user?.handle || "")}`}"><span class="clc-av clc-av-${x.rank}">${avatar(x.user)}</span><strong><bdi data-noi18n>${esc(x.user?.name || "")}</bdi></strong><small>${T("المركز")} <bdi>${x.rank}</bdi></small></a></li>`).join("")}</ol></section>`;
    function paint() {
      if (!alive() || !data) return;
      const c = data.challenge, me = data.me, h = view.querySelector(".page-head h2");
      if (h) h.lastChild.textContent = c.title;
      const live = c.phase === "live", n = c.counts || { entries: 0, creators: 0 };
      const meTxt = me.rank ? `${T("ترتيبك الآن")} <strong><bdi>#${me.rank}</bdi></strong>` : me.entries ? T("لقطتك مشاركة") : "";
      body().removeAttribute("aria-busy");
      body().innerHTML = `<section class="clc-hero clc-${c.phase}">
          <span class="clc-hero-ic" aria-hidden="true">${ic("trophy", "lg")}</span>
          <p class="clc-hero-tag"><a href="#/clips/tag/${encodeURIComponent(c.tag)}"><bdi data-noi18n dir="auto">#${esc(c.tag)}</bdi></a></p>
          ${c.body ? `<p class="clc-hero-b"><bdi data-noi18n dir="auto">${esc(c.body)}</bdi></p>` : ""}
          <p class="clc-hero-when">${ic("clock", "sm")}<span data-clc-when>${esc(when(c))}</span><span class="clc-dot" aria-hidden="true">·</span><span>${esc(dateTxt(c.startsAt))} – ${esc(dateTxt(c.endsAt))}</span></p>
          <dl class="clc-stats"><div><dt>${T("لقطات")}</dt><dd>${nf(n.entries)}</dd></div><div><dt>${T("صنّاع")}</dt><dd>${nf(n.creators)}</dd></div>${meTxt ? `<div class="clc-me"><dt>${T("أنت")}</dt><dd>${meTxt}</dd></div>` : ""}</dl>
          ${live ? `<a class="btn clc-join" href="#/clips/create?tag=${encodeURIComponent(c.tag)}">${ic("plus", "sm")}<span>${T(me.entries ? "شارك بلقطة أخرى" : "شارك بلقطة")}</span></a>` : ""}
          ${data.staff && !c.winners ? `<div class="clc-staff-row"><button class="btn ghost" type="button" data-clc="edit">${T("تعديل")}</button>${c.status === "cancelled" ? `<button class="btn ghost" type="button" data-clc="restore">${T("استعادة التحدي")}</button>` : `<button class="btn ghost clc-danger" type="button" data-clc="cancel">${T("إلغاء التحدي")}</button>`}</div><div class="clc-form-host"></div>` : ""}
        </section>`
        + podium(c.winners)
        + (c.phase === "upcoming" ? `<div class="empty" role="status">${T("يبدأ التحدي قريباً — جهّز فكرتك")}</div>`
          : `<div class="clc-tabs seg" role="tablist" aria-label="${T("ترتيب اللقطات")}">${[["top", "الأفضل"], ["new", "الأحدث"]].map(([k, l]) => `<button type="button" role="tab" data-sort="${k}" aria-selected="${k === sort}" tabindex="${k === sort ? 0 : -1}">${T(l)}</button>`).join("")}</div>`
            + (items.length ? `<ul class="clp-grid clc-grid" aria-label="${T("لقطات التحدي")}">${items.map(tile).join("")}</ul>` : `<div class="empty" role="status">${live ? T("كن أول المشاركين!") : T("لا لقطات في هذا التحدي")}</div>`)
            + (next ? `<div class="clc-more"><button class="btn ghost" type="button" data-clc="more">${T("عرض المزيد")}</button></div>` : ""));
    }
    async function fetchPage(more) {
      if (busy) return; busy = true;
      try {
        const r = await api("GET", `/api/clips/challenges/${encodeURIComponent(cid)}?sort=${sort}${more && next ? `&offset=${encodeURIComponent(next)}` : ""}`);
        if (!alive()) return;
        const got = (r.items || []).map((x) => ({ ...store(x), rank: x.rank, counts: x.counts, user: x.user }));
        items = more ? items.concat(got) : got; next = r.next; data = r; paint();
        if (more) view.querySelectorAll(".clc-grid li")[items.length - got.length]?.querySelector("a")?.focus();
      } catch (x) {
        if (!alive()) return;
        body().removeAttribute("aria-busy");
        body().innerHTML = `<div class="empty" role="status">${x?.status === 404 ? T("التحدي غير موجود") : T("تعذّر تحميل التحدي")}</div>`;
      } finally { busy = false; }
    }
    view.querySelector(".clc").addEventListener("click", async (e) => {
      if (!alive()) return;
      const s = e.target.closest("[data-sort]");
      if (s && s.dataset.sort !== sort) { sort = s.dataset.sort; history.replaceState(null, "", "#/clips/challenge/" + encodeURIComponent(cid) + (sort === "new" ? "?sort=new" : "")); items = []; next = null; await fetchPage(false); view.querySelector(`[data-sort="${sort}"]`)?.focus(); return; }
      const b = e.target.closest("[data-clc]"); if (!b) return;
      const a = b.dataset.clc;
      if (a === "more") return fetchPage(true);
      if (a === "edit") { const h = body().querySelector(".clc-form-host"); h.innerHTML = form(data.challenge); bindForm(h, data.challenge, (c) => { if (c) fetchPage(false); else { h.innerHTML = ""; view.querySelector('[data-clc="edit"]')?.focus(); } }); return; }
      if (a === "cancel" && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = T("اضغط مرة أخرى للتأكيد"); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = T("إلغاء التحدي"); } }, 4000); return; }
      if (a === "cancel" || a === "restore") {
        b.disabled = true;
        try { await api("POST", `/api/clips/challenges/${encodeURIComponent(cid)}/${a}`); load(true); say(T(a === "cancel" ? "أُلغي التحدي ويمكن استعادته" : "عاد التحدي")); fetchPage(false); }
        catch (x) { b.disabled = false; say(x?.message || T("تعذّر الحفظ، حاول مجدداً")); }
      }
    });
    const tick = setInterval(() => { if (!alive() || !view.isConnected) return clearInterval(tick); const w = view.querySelector("[data-clc-when]"); if (w && data) w.textContent = when(data.challenge); }, 30e3);
    fetchPage(false);
  }

  function guest() {
    document.body.classList.remove("shorts-mode");
    view.innerHTML = `<div class="wrap"><div class="empty"><p>${T("سجّل الدخول لتشاهد تحديات فيديوتك وتشارك فيها")}</p><button type="button" class="btn" data-clc-login>${T("تسجيل الدخول")}</button></div></div>`;
    view.querySelector("[data-clc-login]").onclick = () => { if (typeof showAuth === "function") showAuth("login"); };
  }

  const base = Clips.view;
  Clips.view = function () {
    const h = location.hash;
    const d = /^#\/clips\/challenge\/([^?/]+)/.exec(h);
    if (d || /^#\/clips\/challenges(\?|$)/.test(h)) {
      if (window.MPSession?.state === "out") return guest();
      if (d) { let k = d[1]; try { k = decodeURIComponent(k); } catch { /* keep raw */ } return detailPage(k); }
      return listPage();
    }
    const out = base.apply(this, arguments);
    const pre = /^#\/clips\/create\?(.*)$/.exec(h);
    if (pre) {
      const tag = new URLSearchParams(pre[1]).get("tag"), cap = view.querySelector("#vt-cap");
      if (tag && cap && !cap.value) {
        const t = String(tag).replace(/^#/, "").slice(0, 40);
        cap.value = "#" + t + " "; cap.dispatchEvent(new Event("input", { bubbles: true }));
        view.querySelector(".vt-err")?.insertAdjacentHTML("beforebegin", `<p class="vt-chl-note">${ic("trophy", "sm")}<span>${T("ستشارك في تحدي الأسبوع")}</span> <bdi data-noi18n dir="auto">#${esc(t)}</bdi></p>`);
      }
    }
    const tg = /^#\/clips\/tag\/([^?]+)/.exec(h);
    if (tg) load().then((r) => {
      const c = r?.current; let k = tg[1]; try { k = decodeURIComponent(k); } catch { /* raw */ }
      const head = view.querySelector(".clp-pg-head"); if (!c || !head || norm(k) !== norm(c.tag) || view.querySelector(".clc-tagbar")) return;
      head.insertAdjacentHTML("afterend", `<a class="clc-tagbar" href="#/clips/challenge/${encodeURIComponent(c.id)}">${ic("trophy", "sm")}<span>${T("هذا وسم تحدي الأسبوع")} — <bdi data-noi18n>${esc(c.title)}</bdi></span></a>`);
    });
    return out;
  };
  Clips.challenges = { load, open: (id) => { location.hash = id ? "#/clips/challenge/" + encodeURIComponent(id) : "#/clips/challenges"; } };
})();
