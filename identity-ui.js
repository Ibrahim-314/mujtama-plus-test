/* =====================================================================
 * مجتمع بلس — v2.3 identity layer (Track 2: phases 6–10)
 * Rich profiles (cover parallax, avatar/cover cropper, links, expertise, 3 pins, ordered sections,
 * completion meter, achievements, reputation), hover cards, verification, privacy center with
 * "view as", follow requests, message requests, multiple accounts & organisations (act-as),
 * guided tour, first-week challenges, smart suggestions, celebrations, onboarding illustrations.
 * ===================================================================== */
(function IdentityLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const desktop = () => matchMedia("(hover:hover) and (min-width:1024px)").matches;
  const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n || 0));
  const img = (set, size) => set ? (set[size] || set["200"] || set["1200"] || Object.values(set)[0]) : null;
  const VERIFIED = { person: ["هوية موثقة", "#3478f6"], creator: ["منشئ محتوى", "#e0559b"], org: ["مؤسسة", "#e88b2a"], expert: ["خبير", "#1f9d8b"] };
  const vtick = (kind, size = "xs") => kind ? `<span class="vtick" data-vk="${kind}" title="${VERIFIED[kind]?.[0] || "موثق"}" style="color:${VERIFIED[kind]?.[1] || "var(--info)"}">${ic("verified", size)}</span>` : "";

  /* ---------- Acting as an organisation: every API call carries X-Act-As ---------- */
  const ACT_KEY = "mp_actAs";
  const actAs = () => { try { return JSON.parse(localStorage.getItem(ACT_KEY) || "null"); } catch { return null; } };
  // v2.51: the header rides on that one API request only (Remote.use middleware) — no global window.fetch patch, so concurrent
  // requests, uploads and third-party SDK calls never pick it up
  if (typeof Remote !== "undefined" && Remote.use) Remote.use(function actAsHeader(req, next) { const a = actAs(); return next(a ? { ...req, headers: { ...(req.headers || {}), "X-Act-As": a.id } } : req); });
  function actBanner() {
    document.getElementById("act-banner")?.remove(); const a = actAs(); if (!a || !online()) return;
    document.body.insertAdjacentHTML("beforeend", `<div id="act-banner" role="status">${ic("building", "sm")} تنشر الآن باسم <b>${esc(a.name)}</b><button id="act-exit">العودة لحسابي</button></div>`);
    $("#act-exit").onclick = () => { localStorage.removeItem(ACT_KEY); location.reload(); };
  }

  /* ---------- Post cards: verified ticks for server-verified accounts ---------- */
  const _pi = postInner;
  postInner = function (p, opts) {
    let h = _pi(p, opts); const u = S.user(p.author);
    if (u && u.verified && !h.includes('class="vtick"')) h = h.replace(`class="name">${esc(u.name)}</a>`, `class="name">${esc(u.name)}</a>${vtick(u.verified)}`);
    return h;
  };

  /* ---------- Rich profile ---------- */
  const profCache = new Map();
  async function loadProfile(handle, force) {
    if (!online()) return null;
    if (!force && profCache.has(handle) && Date.now() - profCache.get(handle).t < 1500) return profCache.get(handle).d;
    const d = await api("GET", "/api/profiles/" + encodeURIComponent(handle)); profCache.set(handle, { t: Date.now(), d }); return d;
  }
  const SECTION_LABEL = { works: "أعمال", articles: "مقالات", communities: "مجتمعات" };
  const _profile = Views.profile;
  Views.profile = function (handle) {
    // v2.67: a member who joined after this session synced is not in the local store yet, so a direct link (#/u/:handle)
    // showed «الصفحة غير موجودة» and the profile badge (#/cv link) never rendered. Fetch the public profile once, add the
    // public user to the store and render again; a handle the server does not know stays on the not-found page.
    if (handle && !S.byHandle(handle) && online()) {
      _profile(handle);
      const want = location.hash;
      loadProfile(handle).then(d => {
        const P = d?.profile; if (!P?.id || P.handle !== handle || S.byHandle(handle) || location.hash !== want) return;
        DB.users.push({ id: P.id, name: P.name, handle: P.handle, bio: P.bio || "", color: P.color, badge: P.badge, creator: !!P.badge, topics: P.topics || [], joinedAt: P.joinedAt, pinned: P.pinned, role: P.role, verified: P.verified, private: P.private, avatar: P.avatar, cover: P.cover, accountType: P.accountType });
        Views.profile(handle);
      }).catch(() => { });
      return;
    }
    _profile(handle);
    const u = handle ? S.byHandle(handle) : S.me(); if (!u || !online()) return;
    const viewAs = /[?&]as=public/.test(location.hash) && u.id === DB.me;
    const renderToken = Symbol(); view._prof = renderToken;
    loadProfile(u.handle).then(d => { if (d && view._prof === renderToken) enhanceProfile(u, d, viewAs); }).catch(() => { });
  };
  function enhanceProfile(u, d, viewAs) {
    const P = d.profile, me = u.id === DB.me && !viewAs, top = view.querySelector(".profile-top"), cover = view.querySelector(".cover"); if (!top || !cover) return;
    view.classList.add("profile-v2");
    if (viewAs) top.insertAdjacentHTML("beforebegin", `<div class="viewas-bar">${ic("eye", "sm")} هكذا يرى الآخرون ملفك <a href="#/me">إنهاء المعاينة</a></div>`);
    // cover with parallax
    const cv = img(P.cover, "1200");
    if (cv) cover.innerHTML = `<img src="${esc(cv)}" srcset="${esc(img(P.cover, "600"))} 600w, ${esc(cv)} 1200w, ${esc(img(P.cover, "1800"))} 1800w" sizes="(min-width:1024px) 640px, 100vw" alt="" decoding="async">`;
    cover.classList.add("cover-v2");
    // avatar
    const avEl = top.querySelector(".av.lg");
    if (avEl) { if (P.avatar) avEl.innerHTML = `<img src="${esc(img(P.avatar, "400"))}" alt="${esc(P.name)}">`; if (me) { avEl.classList.add("editable"); avEl.insertAdjacentHTML("beforeend", `<button class="av-cam" aria-label="تغيير الصورة">${ic("camera", "xs")}</button>`); avEl.querySelector(".av-cam").onclick = (e) => { e.preventDefault(); pickImage("avatar"); }; } }
    if (me) { cover.insertAdjacentHTML("beforeend", `<button class="cover-cam" aria-label="تغيير الغلاف">${ic("camera", "sm")} الغلاف</button>`); cover.querySelector(".cover-cam").onclick = () => pickImage("cover"); }
    // name line: verified + private + org
    const h2 = top.querySelector("h2");
    if (h2) { if (P.verified) h2.insertAdjacentHTML("beforeend", " " + vtick(P.verified, "sm")); if (P.private) h2.insertAdjacentHTML("beforeend", ` <span class="muted" title="حساب خاص">${ic("lock", "xs")}</span>`); if (P.accountType === "org") h2.insertAdjacentHTML("beforeend", ` <span class="chip org-chip">${ic("building", "xs")} مؤسسة</span>`); }
    h2?.querySelector(".vtick")?.addEventListener("click", () => sheet(`<div class="u-tc">${vtick(P.verified, "lg")}<h3 class="u-my8">${esc(P.verifiedLabel || "حساب موثق")}</h3><p class="muted">راجع فريق مجتمع بلس مستندات هذا الحساب وتأكد من هويته. الشارة لا تعني تأييد آرائه.</p><button class="btn block" data-ui="close-sheet">فهمت</button></div>`));
    // meta: location, links, expertise, reputation
    const p = top.querySelector("p");
    const meta = [P.location ? `<span>${ic("mapPin", "xs")} ${esc(P.location)}</span>` : "", d.pro ? `<a href="#/cv/${esc(P.handle)}">${ic("building", "xs")} الملف المهني</a>` : "", ...P.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener nofollow ugc">${ic("link", "xs")} ${esc(l.label || new URL(l.url).hostname)}</a>`)].filter(Boolean).join("");
    const chips = P.expertise.length ? `<div class="chips expertise">${P.expertise.map(x => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : "";
    const rep = `<button class="rep-chip" id="rep">${ic("star", "xs")} <b>${fmtN(P.reputation)}</b> سمعة</button>`;
    p?.insertAdjacentHTML("afterend", `${meta ? `<div class="pmeta">${meta}</div>` : ""}${chips}`);
    top.querySelector(".stats")?.insertAdjacentHTML("beforeend", rep);
    $("#rep")?.addEventListener("click", () => { const b = P.reputationBreakdown || {}; sheet(`<h4 class="u-mt0">${ic("star", "sm")} السمعة: ${P.reputation}</h4><p class="muted">تُحسب من جودة المساهمات لا كثرتها: أفضل ٢٠ منشوراً فقط، والتفاعل «مفيد» أثقل من الإعجاب.</p>${[["quality", "جودة المحتوى"], ["discussion", "نقاشات أثارها"], ["reach", "الوصول"], ["participation", "المشاركة"], ["penalties", "مخالفات"]].map(([k, l]) => `<div class="u-py8 u-bb row"><span class="grow">${l}</span><b dir="ltr">${k === "penalties" && b[k] ? "−" : ""}${b[k] ?? 0}</b></div>`).join("")}<button class="u-mt12 btn block" data-ui="close-sheet">تم</button>`); });
    // follow button states
    const fb = top.querySelector("[data-follow]");
    if (fb && d.relationship) { if (d.relationship.requested) { fb.textContent = "طلب مُرسل"; fb.classList.add("ghost"); } else if (!d.relationship.following && P.private) fb.textContent = "طلب متابعة"; }
    if (me) {
      top.querySelector("#edit")?.replaceWith(Object.assign(document.createElement("button"), { className: "btn ghost", id: "edit2", textContent: "تعديل الملف" }));
      $("#edit2").onclick = () => editProfile(P, d);
      top.querySelector(".row")?.insertAdjacentHTML("beforeend", `<a class="btn ghost icon" href="#/me?as=public" title="معاينة" aria-label="كيف يراك الآخرون">${ic("eye", "sm")}</a>`);
      if (d.completeness && d.completeness.percent < 100) top.insertAdjacentHTML("beforeend", `<div class="complete card"><div class="row"><b class="grow">اكتمال ملفك ${d.completeness.percent}٪</b><button class="btn ghost" id="cmp-go" style="padding:6px 12px">أكمل</button></div><div class="bar"><i style="width:${d.completeness.percent}%"></i></div><div class="muted">${esc(d.completeness.missing[0].text)}</div></div>`);
      $("#cmp-go")?.addEventListener("click", () => editProfile(P, d));
    }
    // achievements
    if (P.achievements.length) top.insertAdjacentHTML("beforeend", `<div class="ach-row">${P.achievements.map(a => `<button class="ach" data-ach="${esc(a.key)}" title="${esc(a.name)}">${achIcon(a.key)}<span>${esc(a.name)}</span></button>`).join("")}</div>`);
    top.querySelectorAll("[data-ach]").forEach(b => b.onclick = () => { const a = P.achievements.find(x => x.key === b.dataset.ach); sheet(`<div class="u-tc"><div class="ach big">${achIcon(a.key)}</div><h3 class="u-my8">${esc(a.name)}</h3><p class="muted">${esc(a.description)}</p><p class="muted">${relTime(a.at)}</p><button class="btn block" data-ui="close-sheet">رائع</button></div>`); });
    // org members / my orgs
    if (P.members?.length) top.insertAdjacentHTML("beforeend", `<div class="team-row"><span class="muted">الفريق</span>${P.members.slice(0, 6).map(m => `<a href="#/u/${esc(m.handle)}" class="av sm" style="background:var(--accent)" title="${esc(m.name)}">${m.avatar ? `<img src="${esc(img(m.avatar, "64"))}" alt="">` : esc(m.name[0])}</a>`).join("")}</div>`);
    // locked private account
    const wrap = view.querySelector(".wrap");
    if (d.locked && wrap) { wrap.innerHTML = `<div class="card locked">${ic("lock")}<h3>هذا الحساب خاص</h3><p class="muted">تابع ${esc(P.name)} لترى منشوراته${d.relationship?.requested ? "، وطلبك قيد المراجعة" : ""}.</p></div>`; return; }
    if (viewAs && wrap) { wrap.querySelectorAll(".tab").forEach(t => { if (["saved", "creator"].includes(t.dataset.pt)) t.remove(); }); if (P.private) wrap.insertAdjacentHTML("afterbegin", `<div class="u-p18 card locked">${ic("lock")}<b>حسابك خاص</b><p class="u-m0 u-mt4 muted">غير المتابعين يرون اسمك وصورتك ونبذتك فقط.</p></div>`); }
    // pinned (up to 3) + ordered sections on the posts tab
    if (wrap && (view._ptab || "posts") === "posts") {
      wrap.querySelectorAll(".muted").forEach(m => { if (m.textContent.includes("مثبت")) { m.nextElementSibling?.remove(); m.remove(); } });
      const tabs = wrap.querySelector(".tabs");
      const pinned = d.pinned.length ? `<div class="pinned"><h4>${ic("pin", "xs")} مثبّت</h4>${d.pinned.map(x => S.post(x.id) ? postCard(S.post(x.id)) : "").join("")}</div>` : "";
      const secs = P.sections.map(s => { const items = d.sectionsData[s] || []; if (!items.length) return "";
        if (s === "communities") return `<div class="psec"><h4>${SECTION_LABEL[s]}</h4><div class="comm-strip">${items.map(c => `<a href="#/c/${esc(c.id)}" class="comm-tile" style="background:${esc(c.color || "var(--grad)")}"><b>${esc(c.name)}</b><span>${c.role === "owner" ? "مؤسس" : c.role === "admin" ? "مشرف" : "عضو"}</span></a>`).join("")}</div></div>`;
        return `<div class="psec"><h4>${SECTION_LABEL[s]}</h4><div class="mini-grid">${items.slice(0, 4).map(x => `<a href="#/post/${esc(x.id)}" class="mini">${esc((x.title || x.text || "").slice(0, 90))}</a>`).join("")}</div></div>`; }).join("");
      tabs?.insertAdjacentHTML("afterend", pinned + secs);
      if (d.pinned.length) { const pinnedIds = new Set(d.pinned.map(x => x.id)); [...wrap.querySelectorAll(":scope > .post-card")].forEach(c => { if (pinnedIds.has(c.querySelector("[data-react]")?.dataset.react) && !c.closest(".pinned")) c.remove(); }); }
    }
    // shortcut chips: icons instead of emoji
    const CHIP_IC = { "القوائم": "users", "الأحداث": "sparkle", "الاهتمامات": "target", "المكتبة": "bookmark" };
    top.querySelectorAll(".chips a.tab").forEach(a => { const label = a.textContent.replace(/[^\u0600-\u06FF\s]/g, "").trim(); if (CHIP_IC[label]) a.innerHTML = `${ic(CHIP_IC[label], "xs")} ${label}`; });
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-follow]")) { profCache.clear(); cardCache.clear(); } }, true);
  /* parallax: cover drifts and fades as you scroll */
  let raf = 0;
  addEventListener("scroll", () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const c = document.querySelector(".profile-v2 .cover-v2"); if (!c) return; const y = Math.min(scrollY, 300); c.style.setProperty("--py", y * 0.4 + "px"); c.style.setProperty("--po", String(1 - y / 420)); }); }, { passive: true });

  const ACH = { first_post: "pen", first_comment: "comment", followers_10: "users", followers_100: "usersF", helpful_10: "star", helpful_100: "award", profile_complete: "check", community_member: "community", secure: "shield", conversation_starter: "fire" };
  const achIcon = (k) => ic(ACH[k] || "award", "sm");

  /* ---------- Edit profile ---------- */
  function editProfile(P, d) {
    const me = S.me();
    const linkRow = (l = {}) => `<div class="u-g6 u-mt6 row link-row"><input class="l-label" placeholder="الاسم" value="${esc(l.label || "")}" style="flex:0 0 32%"><input class="l-url" dir="ltr" placeholder="https://" value="${esc(l.url || "")}"><button class="btn ghost l-del" aria-label="حذف">${ic("x", "xs")}</button></div>`;
    const myPosts = DB.posts.filter(p => p.author === DB.me && p.status === "published").slice(0, 30);
    const pins = new Set((d.pinned || []).map(p => p.id));
    sheet(`<h4 class="u-mt0">تعديل الملف الشخصي</h4>
      <div class="edit-images"><div class="cover-prev" style="${P.cover ? `background-image:url('${esc(img(P.cover, "600"))}')` : "background:var(--grad)"}"><button class="btn ghost" data-pick="cover">${ic("camera", "xs")} الغلاف</button></div>
        <div class="av lg" style="background:${me.color}">${P.avatar ? `<img src="${esc(img(P.avatar, "200"))}" alt="">` : esc(me.name[0])}<button class="av-cam" data-pick="avatar" aria-label="الصورة">${ic("camera", "xs")}</button></div></div>
      <label class="muted">الاسم</label><input id="ep-name" value="${esc(me.name)}" maxlength="50">
      <label class="muted">نبذة</label><textarea id="ep-bio" maxlength="300" class="u-mh70">${esc(me.bio || "")}</textarea>
      <label class="muted">الموقع</label><input id="ep-loc" value="${esc(P.location || "")}" maxlength="60" placeholder="جدة، السعودية">
      <label class="muted">مجالات الخبرة <span class="muted">(افصل بفاصلة)</span></label><input id="ep-exp" value="${esc(P.expertise.join("، "))}" placeholder="تطوير الويب، التصميم">
      <label class="muted">روابط (حتى ٥)</label><div id="ep-links">${(P.links.length ? P.links : [{}]).map(linkRow).join("")}</div><button class="u-mt6 btn ghost" id="ep-addlink">${ic("plus", "xs")} رابط</button>
      <label class="u-db u-mt12 muted">ترتيب الأقسام</label><div id="ep-secs">${P.sections.map(s => `<div class="sec-row" data-s="${s}"><span class="grow">${SECTION_LABEL[s]}</span><button class="btn ghost" data-up aria-label="أعلى">↑</button><button class="btn ghost" data-down aria-label="أسفل">↓</button></div>`).join("")}</div>
      <label class="u-db u-mt12 muted">المنشورات المثبتة (حتى ٣)</label><div class="pin-list">${myPosts.map(p => `<label class="pin-opt"><input type="checkbox" value="${p.id}" ${pins.has(p.id) ? "checked" : ""}> <span>${esc((p.title || p.text).slice(0, 70))}</span></label>`).join("") || '<div class="muted">انشر أولاً لتتمكن من التثبيت</div>'}</div>
      <p class="u-c-dg u-mh1e muted" id="ep-err"></p><button class="btn block" id="ep-save">حفظ</button>`);
    const panel = $("#sheet .panel");
    panel.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => pickImage(b.dataset.pick));
    $("#ep-addlink").onclick = () => { if (panel.querySelectorAll(".link-row").length < 5) $("#ep-links").insertAdjacentHTML("beforeend", linkRow()); };
    panel.addEventListener("click", (e) => { if (e.target.closest(".l-del")) e.target.closest(".link-row").remove(); const r = e.target.closest(".sec-row"); if (!r) return; if (e.target.closest("[data-up]") && r.previousElementSibling) r.parentNode.insertBefore(r, r.previousElementSibling); if (e.target.closest("[data-down]") && r.nextElementSibling) r.parentNode.insertBefore(r.nextElementSibling, r); });
    panel.querySelectorAll(".pin-opt input").forEach(cb => cb.onchange = () => { if (panel.querySelectorAll(".pin-opt input:checked").length > 3) { cb.checked = false; toast("يمكن تثبيت ٣ منشورات كحد أقصى"); } });
    $("#ep-save").onclick = async () => {
      const name = $("#ep-name").value.trim(), bio = $("#ep-bio").value.trim();
      try {
        if (name !== me.name || bio !== (me.bio || "")) { await api("PATCH", "/api/me", { name, bio }); me.name = name; me.bio = bio; }
        await api("PATCH", "/api/profile", { location: $("#ep-loc").value.trim(), expertise: $("#ep-exp").value.split(/[,،]/).map(x => x.trim()).filter(Boolean), links: [...panel.querySelectorAll(".link-row")].map(r => ({ label: r.querySelector(".l-label").value.trim(), url: r.querySelector(".l-url").value.trim() })).filter(l => l.url),
          sections: [...panel.querySelectorAll(".sec-row")].map(r => r.dataset.s), pinnedPosts: [...panel.querySelectorAll(".pin-opt input:checked")].map(c => c.value) });
        closeSheet(); toast("✓ حُفظ ملفك"); profCache.clear(); rerender();
      } catch (e) { $("#ep-err").textContent = e.message; }
    };
  }

  /* ---------- Image cropper (pan, zoom, rotate) → WebP/JPEG upload ---------- */
  function pickImage(kind) {
    const inp = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
    inp.onchange = () => { const f = inp.files[0]; if (f) cropper(f, kind); }; inp.click();
  }
  function cropper(file, kind) {
    const W = 320, H = kind === "avatar" ? 320 : 120, OUT = kind === "avatar" ? [800, 800] : [1800, 675];
    sheet(`<h4 class="u-mt0">${kind === "avatar" ? "الصورة الشخصية" : "صورة الغلاف"}</h4><div class="crop-wrap ${kind}"><canvas id="crop" width="${W * 2}" height="${H * 2}" style="width:${W}px;height:${H}px;max-width:100%"></canvas></div>
      <div class="u-g10 u-my12 row"><span class="muted">${ic("search", "xs")}</span><input type="range" id="cz" min="1" max="4" step="0.01" value="1" class="grow" aria-label="تكبير"><button class="btn ghost" id="cr" aria-label="تدوير">${ic("rotate", "sm")}</button></div>
      <p class="u-tc u-m0 u-mb10 muted">اسحب لتحريك الصورة</p><button class="btn block" id="cs">حفظ</button>`);
    const cv = $("#crop"), g = cv.getContext("2d"), im = new Image(); let z = 1, rot = 0, ox = 0, oy = 0, base = 1;
    const draw = () => {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = "#111"; g.fillRect(0, 0, cv.width, cv.height);
      g.translate(cv.width / 2 + ox, cv.height / 2 + oy); g.rotate(rot * Math.PI / 2); const s = base * z; g.drawImage(im, -im.width * s / 2, -im.height * s / 2, im.width * s, im.height * s);
    };
    const fit = () => { const sw = rot % 2 ? im.height : im.width, sh = rot % 2 ? im.width : im.height; base = Math.max(cv.width / sw, cv.height / sh); };
    im.onload = () => { fit(); draw(); }; im.src = URL.createObjectURL(file);
    $("#cz").oninput = (e) => { z = +e.target.value; draw(); };
    $("#cr").onclick = () => { rot = (rot + 1) % 4; ox = oy = 0; fit(); draw(); };
    let drag = null;
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, ox, oy }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => { if (!drag) return; const k = cv.width / cv.clientWidth; ox = drag.ox + (e.clientX - drag.x) * k; oy = drag.oy + (e.clientY - drag.y) * k; draw(); });
    cv.addEventListener("pointerup", () => drag = null);
    $("#cs").onclick = async () => {
      const out = Object.assign(document.createElement("canvas"), { width: OUT[0], height: OUT[1] }), o = out.getContext("2d"), k = OUT[0] / cv.width;
      o.fillStyle = "#111"; o.fillRect(0, 0, OUT[0], OUT[1]); o.translate(OUT[0] / 2 + ox * k, OUT[1] / 2 + oy * k); o.rotate(rot * Math.PI / 2); const s = base * z * k; o.drawImage(im, -im.width * s / 2, -im.height * s / 2, im.width * s, im.height * s);
      const blob = await new Promise(r => out.toBlob(r, "image/jpeg", 0.9));
      $("#cs").disabled = true; $("#cs").textContent = "جارٍ الرفع…";
      try {
        const r = await api("POST", "/api/profile/image?kind=" + kind, null, blob);
        const me = S.me(); me[kind] = r[kind]; closeSheet(); toast("✓ حُدّثت الصورة"); profCache.clear(); rerender();
      } catch (e) { toast(e.message); $("#cs").disabled = false; $("#cs").textContent = "حفظ"; }
    };
  }

  /* ---------- Hover card (desktop) ---------- */
  let hoverT = 0, cardEl = null;
  const cardCache = new Map();
  document.addEventListener("mouseover", (e) => {
    if (!desktop() || !online()) return; const a = e.target.closest('a.name[href^="#/u/"], .rail-row a[href^="#/u/"]'); if (!a) return;
    clearTimeout(hoverT); hoverT = setTimeout(async () => {
      const handle = decodeURIComponent(a.getAttribute("href").slice(4)); let c = cardCache.get(handle);
      if (!c) { try { c = await api("GET", `/api/profiles/${encodeURIComponent(handle)}/card`); cardCache.set(handle, c); } catch { return; } }
      if (!a.matches(":hover")) return;
      cardEl?.remove(); const r = a.getBoundingClientRect();
      cardEl = Object.assign(document.createElement("div"), { className: "hovercard", role: "dialog" });
      cardEl.innerHTML = `<div class="hc-cover" style="${c.cover ? `background-image:url('${esc(img(c.cover, "600"))}')` : "background:var(--grad)"}"></div><div class="hc-body"><div class="row" style="align-items:flex-end;margin-top:-30px"><span class="av" style="background:${c.color};width:56px;height:56px;border:3px solid var(--card)">${c.avatar ? `<img src="${esc(img(c.avatar, "200"))}" alt="">` : esc(c.name[0])}</span><span class="grow"></span>${c.id !== DB.me ? `<button class="btn ${c.following ? "ghost" : ""}" data-follow="${c.id}" style="padding:6px 14px">${c.following ? "تتابعه" : "تابع"}</button>` : ""}</div>
        <b class="u-t-lg">${esc(c.name)}</b>${vtick(c.verified)}<div class="u-te muted" dir="ltr">@${esc(c.handle)}</div>${c.bio ? `<p class="u-my6">${esc(c.bio)}</p>` : ""}<div class="muted">${c.location ? ic("mapPin", "xs") + " " + esc(c.location) + " · " : ""}<b style="color:var(--text)">${fmtN(c.followers)}</b> متابِع · ${ic("star", "xs")} ${fmtN(c.reputation)}</div></div>`;
      document.body.appendChild(cardEl);
      const top = r.bottom + 8 + 260 > innerHeight ? r.top - cardEl.offsetHeight - 8 : r.bottom + 8;
      cardEl.style.top = Math.max(8, top + scrollY) + "px"; cardEl.style.left = Math.min(innerWidth - 316, Math.max(8, r.left + r.width / 2 - 150)) + "px";
      cardEl.addEventListener("mouseleave", () => { cardEl?.remove(); cardEl = null; });
    }, 450);
  });
  document.addEventListener("mouseout", (e) => { const a = e.target.closest('a.name[href^="#/u/"], .rail-row a[href^="#/u/"]'); if (!a) return; clearTimeout(hoverT); setTimeout(() => { if (cardEl && !cardEl.matches(":hover")) { cardEl.remove(); cardEl = null; } }, 250); });

  const roleName = (r) => ({ owner: "مالك", admin: "مدير", editor: "محرر" }[r] || r);
  window.MPId = { ic, online, api, fmtN, img, vtick, profCache, roleName, VERIFIED, ACT_KEY }; // privacy / verification / trust / organisations screens: lazy "secx" chunk (secx-ui.js)

  /* ---------- Account switcher ---------- */
  async function switcher() {
    if (!online()) return toast("تبديل الحسابات يتطلب الاتصال بالخادم");
    const [acc, { orgs }] = await Promise.all([api("GET", "/api/auth/accounts"), api("GET", "/api/orgs")]);
    const a = actAs(), row = (u, attrs, sub, on) => `<button class="sw-row ${on ? "on" : ""}" ${attrs}><span class="av sm" style="background:${u.color}">${u.avatar ? `<img src="${esc(img(u.avatar, "64"))}" alt="">` : esc(u.name[0])}</span><span class="u-ts grow"><b>${esc(u.name)}</b><span class="u-db muted">${sub}</span></span>${on ? ic("check", "sm") : ""}</button>`;
    sheet(`<h4 class="u-mt0">${ic("swap", "sm")} الحسابات</h4>
      ${row(acc.current, 'data-sw-me="1"', "@" + esc(acc.current.handle), !a)}
      ${acc.accounts.map(u => row(u, `data-sw="${u.id}"`, "@" + esc(u.handle), false)).join("")}
      ${orgs.length ? `<div class="u-m0 u-mt12 u-mb4 muted">انشر باسم مؤسسة</div>${orgs.map(o => row(o, `data-org='${esc(JSON.stringify({ id: o.id, name: o.name, handle: o.handle }))}'`, roleName(o.myRole), a?.id === o.id)).join("")}` : ""}
      <button class="u-mt12 btn ghost block" id="sw-add">${ic("plus", "xs")} إضافة حساب</button><a class="u-mt8 u-tc btn ghost block" href="#/orgs" data-ui="close-sheet">${ic("building", "xs")} إدارة المؤسسات</a>`);
    const p = $("#sheet .panel");
    p.querySelector("[data-sw-me]").onclick = () => { if (a) { localStorage.removeItem(ACT_KEY); location.reload(); } else closeSheet(); };
    p.querySelectorAll("[data-sw]").forEach(b => b.onclick = async () => { await api("POST", "/api/auth/switch", { userId: b.dataset.sw }); localStorage.removeItem(ACT_KEY); location.hash = "#/home"; location.reload(); });
    p.querySelectorAll("[data-org]").forEach(b => b.onclick = () => { localStorage.setItem(ACT_KEY, b.dataset.org); location.hash = "#/home"; location.reload(); });
    $("#sw-add").onclick = () => {
      sheet(`<h4 class="u-mt0">إضافة حساب</h4><input id="ad-h" dir="ltr" placeholder="username" autocomplete="username" aria-label="اسم المستخدم"><input id="ad-p" type="password" dir="ltr" placeholder="كلمة المرور" autocomplete="current-password" class="u-mt8" aria-label="كلمة المرور"><input id="ad-c" inputmode="numeric" dir="ltr" placeholder="رمز التحقق (إن وُجد)" style="margin-top:8px;display:none" aria-label="رمز التحقق"><p class="u-c-dg u-mh1e muted" id="ad-e"></p><button class="btn block" id="ad-go">دخول</button>`);
      $("#ad-go").onclick = async () => { try { await api("POST", "/api/auth/login", { handle: $("#ad-h").value.trim(), password: $("#ad-p").value, code: $("#ad-c").value.trim() || undefined, addAccount: true }); localStorage.removeItem(ACT_KEY); location.hash = "#/home"; location.reload(); } catch (e) { if (e.code === "2fa_required") { $("#ad-c").style.display = ""; $("#ad-c").focus(); } $("#ad-e").textContent = e.code === "2fa_required" ? "" : e.message; } };
    };
  }
  window.MPSwitcher = switcher;
  function decorateNav() {
    const nav = document.querySelector(".bottomnav"); if (!nav || nav.querySelector(".nav-switch") || !online()) return;
    const me = S.me(); if (!me) return;
    nav.insertAdjacentHTML("beforeend", `<button class="nav-switch" aria-label="تبديل الحساب"><span class="av sm" style="background:${me.color}">${me.avatar ? `<img src="${esc(img(me.avatar, "64"))}" alt="">` : esc(me.name[0])}</span><span class="ns-t"><b>${esc(me.name)}</b><small>@${esc(me.handle)}</small></span>${ic("swap", "sm")}</button>`);
    nav.querySelector(".nav-switch").onclick = switcher;
  }

  /* ---------- Onboarding: illustrations, smart suggestions, tour, challenges, celebrations ---------- */
  const ART = {
    1: `<svg viewBox="0 0 240 150" class="ob-art" aria-hidden="true"><defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0" stop-color="#7c4dff"/><stop offset="1" stop-color="#e0559b"/></linearGradient></defs><circle cx="120" cy="78" r="58" fill="url(#g1)" opacity=".12"/><g fill="url(#g1)"><circle cx="72" cy="62" r="16"/><circle cx="168" cy="62" r="16"/><circle cx="120" cy="44" r="19"/><path d="M44 118c4-20 18-32 28-32s24 12 28 32z" opacity=".7"/><path d="M140 118c4-20 18-32 28-32s24 12 28 32z" opacity=".7"/><path d="M88 124c5-26 20-40 32-40s27 14 32 40z"/></g><g stroke="#7c4dff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".55"><path d="M88 60q16-14 32-14"/><path d="M152 60q-16-14-32-14"/></g><g fill="#ffb020"><path d="m198 26 3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/><circle cx="36" cy="34" r="4"/><circle cx="210" cy="104" r="3"/></g></svg>`,
    2: `<svg viewBox="0 0 240 130" class="ob-art" aria-hidden="true"><defs><linearGradient id="g2" x1="0" x2="1"><stop offset="0" stop-color="#7c4dff"/><stop offset="1" stop-color="#1f9d8b"/></linearGradient></defs>${[[30, 30, 70], [110, 22, 90], [40, 72, 96], [146, 66, 64], [70, 104, 100]].map(([x, y, w], i) => `<rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="${i % 2 ? "url(#g2)" : "#7c4dff"}" opacity="${i % 2 ? .9 : .18}"/>`).join("")}<circle cx="206" cy="36" r="14" fill="#e0559b" opacity=".85"/><path d="m200 36 4 4 8-8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
    3: `<svg viewBox="0 0 240 130" class="ob-art" aria-hidden="true"><defs><linearGradient id="g3" x1="0" x2="1"><stop offset="0" stop-color="#e0559b"/><stop offset="1" stop-color="#7c4dff"/></linearGradient></defs><g stroke="url(#g3)" stroke-width="3" opacity=".5"><path d="M120 65 60 34M120 65l64-30M120 65 52 98M120 65l70 34"/></g><circle cx="120" cy="65" r="22" fill="url(#g3)"/><g fill="#7c4dff" opacity=".85"><circle cx="60" cy="34" r="13"/><circle cx="184" cy="35" r="11"/><circle cx="52" cy="98" r="10"/><circle cx="190" cy="99" r="14"/></g><path d="m112 65 6 6 11-12" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>`
  };
  let experiments = {};
  const _ob = Views.onboarding;
  Views.onboarding = function (step = 1) {
    _ob(step);
    const w = view.querySelector(".wrap"); if (!w) return;
    if (ART[step]) {
      const hero = w.querySelector(".auth-hero, .logo");
      if (step === 1 && hero) hero.replaceWith(Object.assign(document.createElement("div"), { innerHTML: ART[1] }));
      else { const steps = w.querySelector(".ob-steps"); steps ? steps.insertAdjacentHTML("afterend", ART[step]) : w.insertAdjacentHTML("afterbegin", ART[step]); }
    }
    if (!w.querySelector(".ob-steps")) w.insertAdjacentHTML("afterbegin", `<div class="ob-dots" aria-label="الخطوة ${step} من ٣">${[1, 2, 3].map(i => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>`);
    if (step === 3 && online()) {
      api("GET", "/api/suggestions/follow?limit=8").then(({ suggestions }) => {
        if (!suggestions.length || !view.querySelector("#n3")) return;
        const grid = experiments.onboarding_suggestions === "grid";
        w.querySelectorAll(".card.row, .user-row").forEach(x => x.remove());
        w.querySelector("h2")?.insertAdjacentHTML("afterend", `<div class="${grid ? "sug-grid" : "sug-list"}">${suggestions.map(s => `<div class="sug ${grid ? "card" : "card row"}">${av(s.user, grid ? "" : "sm")}<div class="grow"><b>${esc(s.user.name)}</b>${vtick(s.user.verified)}<div class="muted">${esc(s.reason)}</div></div><button class="btn" data-follow="${s.user.id}" style="padding:6px 14px">تابع</button></div>`).join("")}</div>`);
      }).catch(() => { });
      api("GET", "/api/experiments").then(r => experiments = r.experiments).catch(() => { });
    }
    const n3 = $("#n3"); if (n3) { const old = n3.onclick; n3.onclick = () => { old(); if (online()) api("POST", "/api/onboarding/onboarded").catch(() => { }); setTimeout(() => startTour(true), 600); }; }
  };

  const TOUR = [["#cbar", "انشر من هنا", "منشور، استطلاع، مقال أو فيديو. لمسة واحدة."], [".tabs", "خلاصتك", "«لك» مرتبة حسب اهتماماتك، و«الأحدث» بالترتيب الزمني."], ['.bottomnav a[data-r="explore"]', "استكشف", "الرائج والمجتمعات والأشخاص الذين قد يهمّونك."], ['.bottomnav a[data-r="notifications"]', "الإشعارات", "التفاعلات والإشارات وطلبات المتابعة."], ['.bottomnav a[data-r="menu"]', "المزيد", "كل الميزات في مكان واحد: ملفك، المحفوظات، المحفظة، التعلّم، العمل والإعدادات — مع بحث سريع."], ["#tbMe", "ملفك", "صورتك أعلى الشاشة تفتح ملفك. أكمله لتظهر للأشخاص المناسبين."]];
  async function startTour(force) {
    if (document.querySelector(".tour")) return;
    let st = { tourDone: localStorage.getItem("mp_tour") === "1", experiments: {} };
    if (online()) { try { st = await api("GET", "/api/onboarding"); experiments = st.experiments; } catch { } }
    if (st.tourDone && !force) return;
    if (st.tourDone && force !== "replay") return;
    // the home-render trigger waits 900 ms + a GET; if the user has left #/home by then, the tour (which points at home controls) must not
    // open over another page — it will open on the next home render instead
    if (!force && location.hash.split("/")[1] !== "home") return;
    if (document.querySelector(".tour")) return; // two triggers (onboarding + home render) can both pass the first check across the await
    const done = (skipped) => { document.querySelector(".tour")?.remove(); localStorage.setItem("mp_tour", "1"); if (online()) api("POST", "/api/onboarding/tour", { skipped }).catch(() => { }); };
    if (experiments.tour_style === "card") {
      document.body.insertAdjacentHTML("beforeend", `<div class="tour dim"><div class="tour-card center"><h3>${ic("sparkle", "sm")} جولة سريعة</h3>${TOUR.map(t => `<div class="u-g10 u-py6 row"><span class="dot"></span><div><b>${t[1]}</b><div class="muted">${t[2]}</div></div></div>`).join("")}<button class="u-mt12 btn block" id="t-ok">لنبدأ</button></div></div>`);
      $("#t-ok").onclick = () => done(false); return;
    }
    let i = 0; document.body.insertAdjacentHTML("beforeend", `<div class="tour"><div class="tour-hole"></div><div class="tour-card"></div></div>`);
    const show = () => {
      let el = null; while (i < TOUR.length && !(el = [...document.querySelectorAll(TOUR[i][0])].find(e => e.offsetParent !== null))) i++;
      if (i >= TOUR.length) return done(false);
      const r = el.getBoundingClientRect(), hole = $(".tour-hole"), card = $(".tour-card"), pad = 8;
      Object.assign(hole.style, { top: r.top - pad + "px", left: r.left - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
      card.innerHTML = `<b>${TOUR[i][1]}</b><p class="u-m0 u-mt4 u-mb10 muted">${TOUR[i][2]}</p><div class="row"><span class="muted">${i + 1}/${TOUR.length}</span><span class="grow"></span><button class="btn ghost" id="t-skip">تخطي</button><button class="u-ms6 btn" id="t-next">${i === TOUR.length - 1 ? "تم" : "التالي"}</button></div>`;
      const below = r.bottom + 180 < innerHeight; card.style.top = (below ? r.bottom + 16 : Math.max(12, r.top - card.offsetHeight - 16)) + "px"; card.style.left = Math.min(innerWidth - card.offsetWidth - 12, Math.max(12, r.left + r.width / 2 - card.offsetWidth / 2)) + "px";
      $("#t-next").onclick = () => { i++; show(); }; $("#t-skip").onclick = () => done(true);
    };
    requestAnimationFrame(show);
  }
  window.MPTour = () => startTour("replay");

  /* first-week challenges card on home (re-injected on every home render, state cached 30s) */
  let celebrated = null, chState = null, chAt = 0, chLoading = null;
  async function loadChallenges() {
    if (chState && Date.now() - chAt < 30e3) return chState;
    if (!chLoading) chLoading = api("GET", "/api/onboarding").then(st => { chState = st; chAt = Date.now(); return st; }).finally(() => { chLoading = null; });
    return chLoading;
  }
  function paintChallenges(st) {
    const c = st.challenges; document.querySelector(".challenges")?.remove();
    if (!c.active || location.hash.split("/")[1] !== "home") return;
    const anchor = view.querySelector("#cbar") || view.querySelector(".tabs"); if (!anchor) return;
    // v2.139: count + days in the head, a real progress bar, each open step is a button that takes you there, and the list folds
    // (remembered on this device) down to the next step only
    const folded = localStorage.getItem("mp_ch_fold") === "1", next = c.items.find(x => !x.done);
    const step = (x) => x.done ? `<div class="ch done"><span class="ck">${ic("check", "xs")}</span><span class="grow">${esc(x.text)}</span></div>`
      : `<button type="button" class="ch ch-go${x === next ? " next" : ""}" data-ch="${esc(x.key)}"><span class="ck"></span><span class="grow">${esc(x.text)}</span>${x.goal > 1 ? `<span class="muted ch-n">${x.progress}/${x.goal}</span>` : ""}<span class="ch-arr" aria-hidden="true">${ic("back", "xs")}</span></button>`;
    const list = folded ? (next ? [next] : []) : c.items;
    anchor.insertAdjacentHTML("afterend", `<section class="card challenges${folded ? " folded" : ""}" aria-labelledby="ch-h"><div class="ch-head"><span class="ch-ic" aria-hidden="true">${ic("target", "sm")}</span><div class="grow"><b id="ch-h">تحديات أسبوعك الأول</b><small class="muted"><span class="ch-cnt">${c.completed}/${c.items.length}</span> · <span>${c.daysLeft}</span> <span>أيام متبقية</span></small></div><button type="button" class="icon-btn ch-fold" aria-expanded="${!folded}" aria-label="${folded ? "عرض كل التحديات" : "طي التحديات"}">${ic("back", "xs")}</button></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.items.length}" aria-valuenow="${c.completed}" aria-label="تقدّم التحديات"><i style="width:${Math.max(c.completed ? 0 : 3, c.completed / c.items.length * 100)}%"></i></div>
      <div class="ch-list">${list.map(step).join("")}</div></section>`);
    const card = view.querySelector(".challenges");
    card.querySelector(".ch-fold").onclick = () => { localStorage.setItem("mp_ch_fold", folded ? "0" : "1"); paintChallenges(st); };
    const GO = { avatar: "#/me", follow: "#/explore", community: "#/communities", comment: "#/explore" };
    card.querySelectorAll("[data-ch]").forEach((b) => b.onclick = () => { const k = b.dataset.ch; if (k === "post") { if (typeof openComposer === "function") openComposer(); else document.getElementById("fab")?.click(); } else if (GO[k]) location.hash = GO[k]; });
  }
  async function challengesCard(force) {
    if (!online() || !DB.onboarded || actAs()) return;
    if (force) chAt = 0;
    let st; try { st = await loadChallenges(); } catch { return; }
    experiments = st.experiments || experiments;
    const firstLoad = !celebrated; if (firstLoad) celebrated = new Set(st.celebrated);
    const c = st.challenges, fresh = c.items.filter(x => x.done && !celebrated.has("ch:" + x.key));
    for (const x of fresh) { celebrated.add("ch:" + x.key); api("POST", "/api/onboarding/celebrated", { key: "ch:" + x.key }).catch(() => { }); }
    if (fresh.length && !firstLoad) celebrate(`أنجزت: ${fresh[0].text}`);
    if (c.completed === c.items.length && !celebrated.has("ch:all")) { celebrated.add("ch:all"); api("POST", "/api/onboarding/celebrated", { key: "ch:all" }).catch(() => { }); if (!firstLoad) celebrate("أكملت تحديات الأسبوع الأول"); }
    paintChallenges(st);
  }
  const _home = Views.home;
  Views.home = function () { _home.apply(this, arguments); if (chState) paintChallenges(chState); challengesCard(); };
  /* any action that may complete a challenge refreshes the card soon after */
  document.addEventListener("click", (e) => { if (e.target.closest("#pub, [data-follow], [data-join]")) setTimeout(() => challengesCard(true), 1200); }, true);
  function celebrate(text) {
    const n = 70, wrap = document.createElement("div"); wrap.className = "confetti"; wrap.setAttribute("aria-hidden", "true");
    const colors = ["#7c4dff", "#e0559b", "#ffb020", "#1f9d8b", "#3478f6"];
    for (let i = 0; i < n; i++) { const s = document.createElement("i"); s.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % 5]};animation-delay:${Math.random() * .4}s;animation-duration:${1.6 + Math.random() * 1.4}s;transform:rotate(${Math.random() * 360}deg);width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 8}px`; wrap.appendChild(s); }
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 3500); toast(text);
  }
  window.MPCelebrate = celebrate;

  /* realtime achievements */
  if (typeof connectStream === "function") {
    const _cs = connectStream;
    connectStream = function () { _cs(); try { Remote.es?.addEventListener("achievement", (e) => { const a = JSON.parse(e.data); celebrate(`شارة جديدة: ${a.name}`); profCache.clear(); }); } catch { } };
  }

  /* notifications for new kinds */
  const NK = { follow_request: "طلب متابعتك", follow_approved: "قبل طلب متابعتك", achievement: "حصلت على شارة جديدة", verified: "تم توثيق حسابك ✓", verification_rejected: "لم يُقبل طلب التوثيق", org_invite: "دعاك للانضمام إلى فريق مؤسسته" };
  const _n = Views.notifications;
  Views.notifications = function () {
    _n.apply(this, arguments);
    view.querySelectorAll(".card.row .grow").forEach(g => { for (const [k, t] of Object.entries(NK)) if (g.innerHTML.includes(k)) g.innerHTML = g.innerHTML.replace(k, t); });
    const fr = DB.notifications.some(n => n.kind === "follow_request");
    if (fr && online()) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-dflex card row" href="#/privacy">${ic("users")}<b class="grow">طلبات المتابعة</b><span class="muted">←</span></a>`);
  };

  /* compose: "close friends" audience */

  /* ---------- Settings entry points ---------- */
  MPSettings.add(function () {
    const sec = view.querySelector('a[href="#/security"]'); if (!sec) return;
    sec.insertAdjacentHTML("afterend", `<a href="#/privacy" class="u-dflex card row">${ic("shield")}<div class="grow"><b>الخصوصية</b><div class="muted">حساب خاص، من يراسلك ويذكرك، المقربون، الكلمات المكتومة</div></div><span class="muted">←</span></a>
      <a href="#/verify" class="u-dflex card row">${ic("verified")}<div class="grow"><b>التوثيق</b><div class="muted">اطلب شارة التوثيق لحسابك</div></div><span class="muted">←</span></a>
      <a href="#/orgs" class="u-dflex card row">${ic("building")}<div class="grow"><b>المؤسسات والحسابات</b><div class="muted">حسابات متعددة وفرق عمل</div></div><span class="muted">←</span></a>
      <button class="card row" id="replay-tour" style="display:flex;width:100%;border:0;text-align:start;font:inherit;color:inherit">${ic("sparkle")}<div class="grow"><b>الجولة التعريفية</b><div class="muted">أعد مشاهدة جولة الميزات</div></div></button>`);
    $("#replay-tour").onclick = () => { location.hash = "#/home"; setTimeout(() => startTour("replay"), 400); };
  });
  if (typeof V12 !== "undefined" && V12.admin) {
    const _admin = V12.admin;
    V12.admin = function () { _admin.apply(this, arguments); const h = $("#view .wrap h2"); if (h && online()) h.insertAdjacentHTML("afterend", `<a href="#/trust" class="u-dflex card row">${ic("shield")}<div class="grow"><b>الثقة والنمو</b><div class="muted">التوثيق، الانتحال، قمع التسجيل، تجارب A/B</div></div><span class="muted">←</span></a>`); };
  }

  /* ---------- routes & lifecycle ---------- */
  const _route = route;
  route = function () {
    // "#/me?as=public" → profile preview
    if (/^#\/me\?as=public/.test(location.hash)) { _route.call(this); return; }
    _route.apply(this, arguments);
    decorateNav(); actBanner();
    if (location.hash.split("/")[1] === "home" && !actAs() && online() && DB.onboarded) setTimeout(() => startTour(false), 900);
  };
  if (!window.__deferRoute) route();
})();

/* v2.139 Home cards CSS (compact «add story» row + first-week challenges): injected here, not in theme.css, to keep the core CSS budget */
(function () { if (document.getElementById("mp-home139-css")) return; const st = document.createElement("style"); st.id = "mp-home139-css"; st.textContent = ".stories-bar.st-solo { padding: 2px 0 10px; overflow: visible; } .st-add-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 8px 12px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--line)); border-radius: 18px; background: color-mix(in srgb, var(--accent) 6%, transparent); color: var(--text); font: inherit; text-align: start; cursor: pointer; transition: background .15s, transform .15s; } .st-add-row:hover { background: color-mix(in srgb, var(--accent) 11%, transparent); } .st-add-row:active { transform: scale(.98); } .st-add-row .st-ring { padding: 0; flex: none; } .st-add-row .st-ring .av { width: 44px; height: 44px; font-size: 17px; border-width: 2px; } .st-add-row .st-ring i { width: 18px; height: 18px; inset-block-end: -3px; inset-inline-end: -3px; } .st-add-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; } .st-add-t b { font-size: var(--fs-md); font-weight: 750; } .st-add-t small { color: var(--muted); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .st-add-go { flex: none; color: var(--muted); display: grid; } [dir=rtl] .st-add-go { transform: scaleX(-1); } .st-item .st-ring .av { width: 58px; height: 58px; } .challenges { padding: 14px 16px 10px; } .ch-head { display: flex; align-items: center; gap: 10px; } .ch-ic { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--accent2); color: var(--accent); } .ch-head b { display: block; font-size: var(--fs-md); font-weight: 800; } .ch-head small { display: block; font-size: 12.5px; margin-top: 1px; } .ch-cnt { color: var(--accent); font-weight: 800; } .ch-fold { margin-inline-end: -8px; color: var(--muted); } .ch-fold .ic, .ch-fold svg { transform: rotate(90deg); transition: transform .2s; } .challenges.folded .ch-fold .ic, .challenges.folded .ch-fold svg { transform: rotate(-90deg); } .challenges .bar { margin: 12px 0 6px; height: 6px; } .ch-list { gap: 0; } .ch { min-height: 44px; padding: 4px 0; } button.ch { width: 100%; border: 0; background: none; color: var(--text); font: inherit; font-size: 14px; text-align: start; cursor: pointer; border-radius: 12px; padding-inline: 6px; margin-inline: -6px; width: calc(100% + 12px); } button.ch:hover { background: var(--bg-2); } button.ch:active { transform: scale(.99); } .ch.next .ck { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); } .ch.next .grow { font-weight: 700; } .ch-arr { color: var(--muted); display: grid; } [dir=ltr] .ch-arr { transform: scaleX(-1); } .ch-n { font-variant-numeric: tabular-nums; } .ch .grow { flex: 1; min-width: 0; } .challenges .ch-fold { background: none; border: 0; box-shadow: none; width: 40px; height: 40px; min-width: 44px; min-height: 44px; } .challenges .ch-fold:hover { background: var(--bg-2); }"; document.head.appendChild(st); })();
/* v2.141: one look for every AI sparkle (quiet buttons, idle tabs) + soft edge on scrolling profile chips — runtime CSS (core CSS budget 16 KB br) */
(function () { if (document.getElementById("mp-v2141-css")) return; const st = document.createElement("style"); st.id = "mp-v2141-css"; st.textContent = "@media (prefers-reduced-motion: reduce) { #view.enter > *, #view.enter .wrap > .card { animation: none !important; } } .btn.ghost svg.ic:has(> use[href=\"#i-sparkle\"]), .tab:not(.on) svg.ic:has(> use[href=\"#i-sparkle\"]) { color: var(--accent); } .profile-top .chips { mask-image: linear-gradient(to left, black 88%, transparent); -webkit-mask-image: linear-gradient(to left, black 88%, transparent); } [dir=\"ltr\"] .profile-top .chips { mask-image: linear-gradient(to right, black 88%, transparent); -webkit-mask-image: linear-gradient(to right, black 88%, transparent); }"; document.head.appendChild(st); })();
