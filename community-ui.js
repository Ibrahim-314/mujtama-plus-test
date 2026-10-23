/* =====================================================================
 * مجتمع بلس — v2.5 communities layer (Track 4: phases 16–20)
 * Community page (cover, icon, accent, tabs, channels, tags, featured members, onboarding), join
 * flow with rules and questions, moderator dashboard with keyboard shortcuts, wiki with history &
 * diff, FAQ, Q&A with duplicate suggestions, resources, community search, advanced events (map,
 * countdown, tickets, waitlist, QR ticket & check-in scanner, calendar), settings, health report,
 * invite links, partners, challenges, directory and share card.
 * ===================================================================== */
(function CommunitiesLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const RT = window.RichText;
  const MOD = ["owner", "admin", "moderator"];
  const fmtN = (n) => (n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n || 0));
  const cssMedia = (u) => `url('${u}') center/cover no-repeat`;
  const asClientPost = (x) => { const y = { ...x }; if (y.media && y.media.startsWith("/media/")) y.media = cssMedia(y.media); if (y.images) y.images = y.images.map(i => i.startsWith("/media/") ? cssMedia(i) : i); return y; };
  const userChip = (u, extra = "") => `<a href="#/u/${esc(u.handle)}" class="m-chip">${av(u, "sm").replace(/^<a\b/, '<span aria-hidden="true"').replace(/ href="[^"]*"/, "").replace(/<\/a>$/, "</span>")}<span><b>${esc(u.name)}</b>${extra ? `<small class="muted">${extra}</small>` : ""}</span></a>`;
  const ROLE_AR = { owner: "المالك", admin: "مدير", moderator: "مشرف", member: "عضو", muted: "مكتوم", pending: "بانتظار الموافقة" };
  const loadQR = () => window.qrcode ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/qrcode.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const qrSvg = async (text) => { await loadQR(); const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); };

  /* =================== Community page =================== *
   * v2.58: announcement bar, members row, 4 stats, one «لوحة الإدارة» tile (queue count) + a «…» menu, server welcome
   * steps, tabs that repaint #c-body only (the tab lives in the link #/c/:id/<tab>; CLS 0), channels grouped by category
   * with unread counts (a side column ≥ 1180 px), pins, members from the server with search and filters. */
  const state = {};
  const _community = Views.community;
  const TABS = [["posts", "المنشورات", "comment"], ["knowledge", "المعرفة", "book"], ["events", "الفعاليات", "cal"], ["members", "الأعضاء", "users"], ["about", "عن المجتمع", "info"]];
  const MARKET_TAB = ["market", "السوق", "store"]; // v2.60: only when the community turned its market tab on (marketTab)
  const tabsFor = (sp) => (sp?.community?.marketTab ? [...TABS.slice(0, 3), MARKET_TAB, ...TABS.slice(3)] : TABS);
  const tabOf = () => { const t = location.hash.split("?")[0].split("/")[3]; return TABS.some((x) => x[0] === t) || t === "market" ? t : null; };
  Views.community = function (id, tab) {
    if (!online()) return _community.apply(this, arguments);
    if (location.hash.split("?")[0].split("/")[3] === "notify") return (window.MPChunks ? MPChunks.load("cnotify") : Promise.resolve()).then(() => (window.MPCNotify ? MPCNotify.page(id) : Views.notFound())); // v2.60: #/c/:id/notify (own tiny chunk)
    return communityPage(id, tab || tabOf() || view._ctab || "posts");
  };
  const sprite = document.querySelector("body > svg[aria-hidden]");
  if (sprite && !document.getElementById("i-dash")) sprite.insertAdjacentHTML("beforeend", '<symbol id="i-dash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></symbol>');
  const KIND_I = { announcements: "mega", questions: "help", media: "camera" };
  const chIcon = (x) => (x.archivedAt ? "archive" : x.icon || KIND_I[x.kind] || "hash");
  const face = (u) => av(u, "sm").replace(/^<a\b/, '<span aria-hidden="true"').replace(/ href="[^"]*"/, "").replace(/<\/a>$/, "</span>"); // an avatar inside a link or button: a span, not a nested <a>
  const dur = (s) => (s < 60 ? `${UI.num(s)} ث` : s < 3600 ? `${UI.num(Math.round(s / 60))} د` : `${UI.num(Math.round(s / 3600))} س`);
  /* v2.62: «عضو جديد» / anniversary badge after the author name (server sends only the kind, never joined_at) */
  const mBadge = (html, b) => { if (!b) return html; const y = b.years, t = b.kind === "new" ? "عضو جديد" : y === 1 ? "سنة معنا" : y === 2 ? "سنتان معنا" : `${y} ${y <= 10 ? "سنوات" : "سنة"} معنا`; return html.replace(/(class="name">[^<]*<\/a>)/, `$1 <span class="sbadge c-mb${b.kind === "new" ? "" : " an"}">${ic(b.kind === "new" ? "sparkle" : "gift", "xs")}${t}</span>`); };
  const annBar = (a) => `<div class="c-ann${a.level === "important" ? " imp" : ""}" role="${a.level === "important" ? "alert" : "status"}"><span class="c-ann-i">${ic(a.level === "important" ? "alert" : "mega", "sm")}</span><button type="button" class="c-ann-t" aria-expanded="false"><b>${esc(a.title)}</b>${a.body ? `<span>${esc(a.body)}</span>` : ""}</button>${a.dismissible ? `<button type="button" class="c-ann-x" data-annx="${esc(a.id)}" aria-label="إغلاق الإعلان">${ic("x", "xs")}</button>` : ""}</div>`;
  addEventListener("hashchange", () => { if (!/^#\/c\//.test(location.hash)) document.body.classList.remove("c-chwide"); });

  async function communityPage(id, tab) {
    if (!view.querySelector(`.c-page[data-cid="${CSS.escape(id)}"]`)) view.innerHTML = `<div class="c-cover skel c-skel"></div><div class="wrap"><div class="skel"></div><div class="skel"></div></div>`;
    let sp; try { sp = await api("GET", `/api/communities/${id}/space`); } catch (e) { return Views.notFound(); }
    if (tab === "market" && !sp.community.marketTab) tab = "posts";
    state[id] = sp; const c = sp.community, idn = sp.identity, r = sp.role, isMod = MOD.includes(r), member = r && !["pending", "banned"].includes(r);
    const accent = idn.accent || null, cover = idn.cover ? (idn.cover.startsWith("/media/") ? `${cssMedia(idn.cover)}` : idn.cover) : "var(--hero-grad)"; // v2.33: one cover gradient
    const TYPE = c.type === "public" ? ["globe", "عام"] : c.type === "private" ? ["lock", "خاص"] : ["mail", "بالدعوة"];
    const st = sp.stats, pv = sp.membersPreview || [];
    const acts = `${isMod ? `<a class="btn ghost c-admin" href="#/cadmin/${esc(id)}" aria-label="لوحة الإدارة${sp.queue ? `، ${UI.num(sp.queue)} بانتظار المراجعة` : ""}" title="لوحة الإدارة">${ic("dash", "sm")}${sp.queue ? `<i class="c-q">${UI.num(Math.min(sp.queue, 99))}</i>` : ""}</a>` : ""}${member ? `<button class="btn ghost c-role" id="c-leave" aria-haspopup="dialog">${ic("check", "xs")}${ROLE_AR[r] || "عضو"}</button>` : r === "pending" ? `<button class="btn ghost" disabled>بانتظار الموافقة</button>` : `<button class="btn c-join" id="c-join">${ic("plus", "xs")}انضم</button>`}<button class="btn ghost icon-only" id="c-more" aria-label="خيارات المجتمع" aria-haspopup="dialog">${ic("more", "sm")}</button>`;
    view.innerHTML = `<div class="c-page" data-cid="${esc(id)}" style="${accent ? `--c-accent:${accent}` : ""}">${sp.announcement ? annBar(sp.announcement) : ""}<div class="c-cover" style="background:${cover}"></div>
      <div class="wrap c-head"><section class="c-card" aria-label="${esc(c.name)}">
        <div class="c-top"><div class="c-icon" style="${accent ? `background:${accent}` : `background:${c.color}`}">${esc(idn.icon || c.name[0])}</div><div class="c-actions">${acts}</div></div>
        <header class="page-head c-ph"><div class="ph-main"><div><h2 class="c-name">${esc(c.name)}</h2><p class="sub c-meta"><span>${ic(TYPE[0], "xs")}${TYPE[1]}</span>${S.topic(c.topic)?.name ? `<span>${ic("hash", "xs")}${esc(S.topic(c.topic).name)}</span>` : ""}${c.location ? `<span>${ic("mapPin", "xs")}${esc(c.location)}</span>` : ""}${c.archivedAt ? `<span class="c-flag">${ic("archive", "xs")}مؤرشف</span>` : ""}${c.lockdownUntil && new Date(c.lockdownUntil) > new Date() ? `<span class="c-flag">${ic("pause", "xs")}النشر متوقف مؤقتاً</span>` : ""}</p></div></div></header>
        ${c.desc ? `<p class="c-desc">${esc(c.desc)}</p>` : ""}
        ${pv.length ? `<button type="button" class="c-mem" data-goto="members"><span class="c-faces">${pv.map(face).join("")}</span><span><b>${esc(pv[0].name)}</b>${((n) => (n < 1 ? "" : n === 1 ? " وعضو آخر" : n === 2 ? " وعضوان" : ` و${UI.num(n)} ${n > 10 ? "عضواً" : "أعضاء"}`))(st.members - 1)}</span><span class="chev" aria-hidden="true">←</span></button>` : ""}
        <dl class="c-stats c-st4"><div><dt data-i18n-n="${st.members | 0}">عضو</dt><dd>${fmtN(st.members)}</dd></div><div><dt>نشِط هذا الأسبوع</dt><dd>${UI.num(st.activeWeek || 0)}</dd></div><div><dt>منشور هذا الأسبوع</dt><dd>${UI.num(st.postsWeek)}</dd></div><div><dt>فعالية قادمة</dt><dd>${UI.num(st.events || 0)}</dd></div></dl>
      </section>
        <div id="c-ob"></div>
        ${member && idn.rulesRequired && !sp.rulesAccepted && !isMod ? `<div class="card c-rules-cta"><b>${ic("shield", "sm")} وافق على القواعد لتبدأ النشر</b><button class="btn" id="c-accept">مراجعة القواعد</button></div>` : ""}
        ${sp.study ? `<a class="card c-link" href="#/study/${id}"><span class="c-link-i">${ic("book", "sm")}</span><b class="grow">${sp.study.mode === "halaqa" ? "حلقة" : "مجموعة دراسة"}: الجلسات والحضور والملاحظات والأهداف${sp.study.mode === "halaqa" ? " وسجل الحفظ" : ""}</b><span class="chev" aria-hidden="true">←</span></a>` : r === "owner" || r === "admin" ? `<a class="c-link ghost" href="#/study/${id}/enable"><span class="c-link-i">${ic("book", "sm")}</span><span class="grow">تحويل المجتمع إلى مجموعة دراسة أو حلقة</span><span class="chev" aria-hidden="true">←</span></a>` : ""}
        <div class="c-search"><input id="c-q" type="search" placeholder="ابحث داخل ${esc(c.name)}" aria-label="بحث داخل المجتمع"></div>
        <div class="tabs c-tabs" role="tablist" aria-label="أقسام المجتمع">${tabsFor(sp).map(([k, l, i]) => `<button class="tab ${tab === k ? "on" : ""}" data-ctab="${k}" id="ct-${k}" role="tab" aria-selected="${tab === k}" aria-controls="c-body" tabindex="${tab === k ? 0 : -1}">${ic(i, "xs")}${l}</button>`).join("")}</div>
        <div id="c-body" role="tabpanel" aria-labelledby="ct-${tab}"></div></div></div>`;
    const tl = view.querySelector(".c-tabs");
    tl.onclick = (e) => { const b = e.target.closest("[data-ctab]"); if (b) showTab(id, b.dataset.ctab); };
    tl.onkeydown = (e) => { const k = { ArrowLeft: 1, ArrowRight: -1 }[e.key]; if (!k) return; const bs = [...tl.querySelectorAll("[data-ctab]")], i = bs.indexOf(document.activeElement); if (i < 0) return; const n = bs[(i + (document.dir === "ltr" ? -k : k) + bs.length) % bs.length]; n.focus(); showTab(id, n.dataset.ctab); };
    view.querySelector("[data-goto]")?.addEventListener("click", () => { showTab(id, "members"); tl.scrollIntoView({ block: "start" }); });
    view.querySelector(".c-ann-t")?.addEventListener("click", (e) => { const a = e.currentTarget; a.setAttribute("aria-expanded", String(a.getAttribute("aria-expanded") !== "true")); });
    view.querySelector("[data-annx]")?.addEventListener("click", (e) => { const bar = e.currentTarget.closest(".c-ann"); if (S.me()) api("POST", `/api/communities/${id}/announcements/${e.currentTarget.dataset.annx}/dismiss`).catch(() => {}); bar.remove(); });
    $("#c-join")?.addEventListener("click", () => joinFlow(id));
    $("#c-accept")?.addEventListener("click", () => rulesSheet(id, true));
    $("#c-leave")?.addEventListener("click", () => moreMenu(id));
    $("#c-more").onclick = () => moreMenu(id);
    let qT = 0; $("#c-q").oninput = (e) => { clearTimeout(qT); qT = setTimeout(() => searchIn(id, e.target.value.trim()), 300); };
    if (sp.onboarding) paintOnboard(id, sp);
    return showTab(id, tab);
  }
  /** v2.58: one tab at a time inside #c-body — the header, cover and tabs stay put (no re-render, no jump) */
  function showTab(id, tab) {
    const sp = state[id], body = $("#c-body"); if (!sp || !body) return;
    view._ctab = tab;
    view.querySelectorAll(".c-tabs [data-ctab]").forEach((b) => { const on = b.dataset.ctab === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    body.setAttribute("aria-labelledby", "ct-" + tab);
    const want = `#/c/${id}${tab === "posts" ? "" : "/" + tab}`; if (location.hash.split("?")[0] !== want) history.replaceState(history.state, "", want);
    document.body.classList.toggle("c-chwide", tab === "posts" && (sp.channels || []).length > 0);
    if (body.childElementCount) body.style.minHeight = body.offsetHeight + "px"; // hold the height while the next tab paints
    return ({ posts: tabPosts, knowledge: tabKnowledge, events: tabEvents, market: tabMarket, members: tabMembers, about: tabAbout })[tab](id, body, sp)
      .catch((e) => { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; })
      .finally(() => { body.style.minHeight = ""; });
  }
  function moreMenu(id) {
    const sp = state[id], c = sp.community, r = sp.role, member = r && !["pending", "banned"].includes(r);
    sheet(`<div class="c-menu"><h3 class="u-mt0">${esc(c.name)}</h3><div class="list flat">${[
      UI.li({ icon: "share", title: "مشاركة المجتمع", sub: "بطاقة ورابط", attrs: 'data-cm="share"' }),
      member ? UI.li({ icon: "link", title: "رابط دعوة", sub: "ادعُ أصدقاءك وتابع الانضمام", attrs: 'data-cm="invite"' }) : "",
      (c.rules || []).length ? UI.li({ icon: "shield", title: "قواعد المجتمع", attrs: 'data-cm="rules"' }) : "",
      MOD.includes(r) ? UI.li({ href: `#/cadmin/${esc(id)}`, icon: "dash", title: "لوحة الإدارة", sub: sp.queue ? `${UI.num(sp.queue)} بانتظار المراجعة` : "الإعدادات والقنوات والإشراف", attrs: 'data-ui="close-sheet"' }) : "",
      member ? UI.li({ href: `#/c/${esc(id)}/notify`, icon: "bell", title: "إشعارات المجتمع", sub: "كل شيء، المهم فقط، ملخص يومي أو كتم", attrs: 'data-ui="close-sheet"' }) : "",
      r && r !== "owner" && r !== "pending" ? UI.li({ href: `#/cappeal/${esc(id)}`, icon: "scale", title: "قراراتي والاستئناف", sub: r === "muted" || r === "banned" ? "اطلب مراجعة القرار" : "الإنذارات والمنشورات المحذوفة", attrs: 'data-ui="close-sheet"' }) : "",
      member && r !== "owner" ? UI.li({ icon: "x", title: "مغادرة المجتمع", attrs: 'data-cm="leave" data-danger' }) : ""].join("")}</div></div>`);
    document.querySelectorAll("#sheet [data-cm]").forEach((b) => (b.onclick = () => {
      const a = b.dataset.cm;
      if (a === "share") { closeSheet(); shareCard(id); } else if (a === "invite") { closeSheet(); invitesSheet(id); } else if (a === "rules") rulesSheet(id, false);
      else if (a === "leave") {
        sheet(`<h3 class="u-mt0">مغادرة ${esc(c.name)}؟</h3><p class="muted">تستطيع العودة لاحقاً${c.type === "public" ? " في أي وقت" : " بطلب جديد"}.</p><div class="u-g8 row"><button class="btn danger grow" id="lv-go">مغادرة</button><button class="btn ghost grow" data-ui="close-sheet">إلغاء</button></div>`);
        $("#lv-go").onclick = () => api("DELETE", `/api/communities/${id}/membership`).then(() => { closeSheet(); refresh?.(); communityPage(id, "posts"); }).catch((e) => toast(e.message));
      }
    }));
  }
  async function paintOnboard(id, sp) {
    const box = $("#c-ob"); if (!box) return; let ob = sp.onboarding;
    /* one-time move of the steps ticked before v2.58 (localStorage) to the server */
    const old = ob.steps.filter((s) => localStorage.getItem(`mp_ob_${id}_${s.i}`) && !s.done).map((s) => s.i);
    if (old.length) { try { ob = (await api("POST", `/api/communities/${id}/onboarding/import`, { done: old })).onboarding; ob.steps.forEach((s) => localStorage.removeItem(`mp_ob_${id}_${s.i}`)); } catch { /* next visit */ } }
    const draw = () => {
      const pct = ob.total ? Math.round((ob.done / ob.total) * 100) : 100, all = ob.total && ob.done === ob.total;
      box.innerHTML = `<section class="card c-onboard" aria-labelledby="c-ob-t"><div class="c-ob-h"><span class="c-ob-i">${ic(all ? "okCircle" : "sparkle", "sm")}</span><div class="grow"><b id="c-ob-t">${all ? "أكملت خطوات البداية" : `أهلاً بك في ${esc(sp.community.name)}`}</b>${ob.message ? `<p>${esc(ob.message)}</p>` : ""}</div></div>
        ${ob.total ? `<div class="c-ob-p" role="progressbar" aria-label="خطوات البداية" aria-valuemin="0" aria-valuemax="${ob.total}" aria-valuenow="${ob.done}"><i></i></div><small class="c-ob-n">${UI.num(ob.done)} من ${UI.num(ob.total)} خطوات</small>
        <ul class="c-ob-l">${ob.steps.map((s) => `<li><label class="chk${s.done ? " done" : ""}"><input type="checkbox" data-step="${s.i}" ${s.done ? "checked" : ""} ${s.auto && s.done ? "disabled" : ""}><span>${esc(s.label)}${s.auto && !s.done ? `<small>${s.auto === "post" ? "تكتمل تلقائياً مع أول منشور" : "تكتمل تلقائياً من ملفك"}</small>` : ""}</span></label></li>`).join("")}</ul>` : ""}</section>`;
      box.querySelector(".c-ob-p i")?.style.setProperty("--w", pct + "%");
      box.querySelectorAll("[data-step]").forEach((cb) => (cb.onchange = async () => { try { ob = (await api("PUT", `/api/communities/${id}/onboarding/${cb.dataset.step}`, { done: cb.checked })).onboarding; draw(); } catch (e) { cb.checked = !cb.checked; toast(e.message); } }));
    };
    draw();
  }
  async function searchIn(id, q) {
    const body = $("#c-body"); if (!body) return; if (q.length < 2) return showTab(id, view._ctab || "posts");
    const r = await api("GET", `/api/communities/${id}/search?q=${encodeURIComponent(q)}`);
    body.innerHTML = `<h4>نتائج «${esc(q)}» داخل المجتمع</h4>${r.pages.map(p => `<a class="card row s-hit" href="#/wiki/${id}/${encodeURIComponent(p.slug)}">${ic("bookmark", "sm")}<div class="grow"><b>${esc(p.title)}</b><div class="muted">${esc(p.snippet)}</div></div></a>`).join("")}${r.posts.map(p => `<a class="card s-hit" href="#/post/${p.id}"><b>${esc(p.title || "")}</b><div class="muted">${esc(p.snippet)}</div></a>`).join("")}${r.resources.map(x => `<a class="card row s-hit" href="${esc(x.url)}" target="_blank" rel="noopener">${ic("link", "sm")}<b class="grow">${esc(x.title)}</b><span class="chip">${esc(x.category)}</span></a>`).join("") || (!r.posts.length && !r.pages.length ? '<div class="empty">لا نتائج داخل هذا المجتمع</div>' : "")}`;
  }
  async function joinFlow(id, invite) {
    const sp = state[id] || await api("GET", `/api/communities/${id}/space`); const c = sp.community, idn = sp.identity;
    const needRules = idn.rulesRequired && (c.rules || []).length, qs = c.type !== "public" ? idn.joinQuestions : [];
    if (!needRules && !qs.length) return doJoin(id, { invite });
    sheet(`<h4 class="u-mt0">الانضمام إلى ${esc(c.name)}</h4>${needRules ? `<div class="c-rules"><b>قواعد المجتمع</b><ol>${c.rules.map(x => `<li>${esc(x)}</li>`).join("")}</ol><label class="chk"><input type="checkbox" id="j-acc"> قرأت القواعد وأوافق عليها</label></div>` : ""}
      ${qs.map((q, i) => `<label class="u-db u-mt10 muted">${esc(q)}</label><textarea class="u-mh60 j-a" data-i="${i}" aria-label="${esc(q)}"></textarea>`).join("")}
      <button class="u-mt12 btn block" id="j-go">${c.type === "public" ? "انضم" : "أرسل الطلب"}</button>`);
    $("#j-go").onclick = () => { if (needRules && !$("#j-acc").checked) return toast("وافق على القواعد أولاً"); doJoin(id, { acceptRules: needRules ? true : undefined, answers: [...document.querySelectorAll(".j-a")].map(t => t.value.trim()), invite }); };
  }
  async function doJoin(id, body) {
    try { const r = await api("POST", `/api/communities/${id}/join`, { acceptRules: true, ...body }); closeSheet(); toast(r.role === "pending" ? "✓ أُرسل طلبك إلى المشرفين" : "✓ انضممت إلى المجتمع"); if (typeof refresh === "function") await refresh(); view._ctab = "posts"; communityPage(id, "posts"); if (r.welcome && window.MPCelebrate) MPCelebrate("مرحباً بك"); }
    catch (e) { toast(e.message); }
  }
  function rulesSheet(id, accept) {
    const c = state[id].community;
    sheet(`<h4 class="u-mt0">قواعد ${esc(c.name)}</h4><ol class="c-rules">${(c.rules || []).map(x => `<li>${esc(x)}</li>`).join("")}</ol>${accept ? `<button class="btn block" id="r-acc">أوافق على القواعد</button>` : ""}`);
    $("#r-acc")?.addEventListener("click", async () => { await api("POST", `/api/communities/${id}/rules/accept`); closeSheet(); toast("✓ شكراً، يمكنك النشر الآن"); communityPage(id, "posts"); });
  }

  /* ---- posts tab: channels (grouped, unread, archived), tags, pins, composer, feed — switching a channel repaints the feed only ---- */
  async function tabPosts(id, body, sp) {
    const member = sp.role && !["pending", "banned"].includes(sp.role), isMod = MOD.includes(sp.role), chans = sp.channels || [], groups = sp.channelGroups || [];
    let ch = (view._cch || {})[id], tag = (view._ctag || {})[id] || "", tok = 0;
    if (ch === undefined) { const d = chans.find((x) => x.isDefault && !x.archivedAt); ch = d && sp.onboarding ? d.id : ""; } // newcomers land in the default channel
    if (ch && !chans.some((x) => x.id === ch)) ch = "";
    const chBtn = (x) => `<button type="button" class="c-chb${x.archivedAt ? " arch" : ""}" data-ch="${esc(x.id)}">${ic(chIcon(x), "xs")}<span>${esc(x.name)}</span>${x.viewPerm === "members" || x.viewRoles.length ? ic("lock", "xs") : ""}<i class="c-unr"${x.unread ? "" : " hidden"}>${x.unread > 9 ? "+9" : UI.num(x.unread)}</i></button>`;
    const live = chans.filter((x) => !x.archivedAt), arch = chans.filter((x) => x.archivedAt);
    const loose = live.filter((x) => !groups.some((g) => g.id === x.group));
    const grp = (label, list) => (list.length ? `<div class="c-chg" role="group" aria-label="${esc(label)}"><span class="c-chgl">${esc(label)}</span>${list.map(chBtn).join("")}</div>` : "");
    const nav = chans.length ? `<nav class="c-chs" aria-label="القنوات"><div class="c-chg"><span class="c-chgl c-chgt">القنوات</span><button type="button" class="c-chb" data-ch="">${ic("home", "xs")}<span>الكل</span></button>${loose.map(chBtn).join("")}</div>${groups.map((g) => grp(g.name, live.filter((x) => x.group === g.id))).join("")}${grp("مؤرشفة", arch)}</nav>` : "";
    const challenge = sp.challenges[0];
    body.innerHTML = `<div class="c-posts${chans.length ? " has-chs" : ""}">${nav}<div class="c-main"><div id="c-chhead"></div>
      ${sp.identity.tags.length ? `<div class="chips c-tags" role="group" aria-label="الوسوم">${sp.identity.tags.map((t) => `<button class="tab" data-tag="${esc(t.slug)}" aria-pressed="false">${esc(t.name)}</button>`).join("")}</div>` : ""}
      ${challenge ? `<a class="card c-challenge" href="#" data-goab="1">${ic("trophy", "sm")} <b>${esc(challenge.title)}</b> <span class="muted">· شارك بوسم #${esc(challenge.tag)}</span></a>` : ""}
      <div id="c-pins"></div><div id="c-guard"></div><div id="c-cmp"></div><div id="c-feed">${state["feed:" + id + ":" + ch + ":" + tag] || ""}</div><div id="c-feedmore" class="f-more" aria-live="polite"></div></div></div>`;
    body.querySelectorAll(".c-tags [data-tag]").forEach((b) => { const t = sp.identity.tags.find((x) => x.slug === b.dataset.tag); if (t && /^#[0-9a-f]{6}$/i.test(t.color)) b.style.setProperty("--t", t.color); });
    const cur = () => chans.find((x) => x.id === ch);
    const pinRow = (p) => `<li><a href="#/post/${esc(p.post.id)}"><b>${esc(p.post.title || p.post.text.slice(0, 110) || "منشور")}</b><small>${esc(p.post.author?.name || "")} · ${relTime(p.post.createdAt)}</small></a>${isMod ? `<button type="button" class="btn ghost icon-only" data-unpin="${esc(p.id)}" aria-label="إلغاء التثبيت">${ic("x", "xs")}</button>` : ""}</li>`;
    function paintSide() {
      const x = cur(), pins = (sp.pins || []).filter((p) => !p.channel || p.channel === ch); // the community's pins everywhere, a channel's in it
      body.querySelectorAll("[data-ch]").forEach((b) => { const on = b.dataset.ch === ch; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      body.querySelectorAll("[data-tag]").forEach((b) => { const on = b.dataset.tag === tag; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      const notes = x ? [x.archivedAt && ["archive", "مؤرشفة: للقراءة فقط"], x.slowModeSec && ["clock", `الوضع البطيء: منشور كل ${dur(x.slowModeSec)}`], x.requireApproval && !isMod && ["eye", "تُراجع المنشورات قبل ظهورها"], x.viewRoles.length && ["lock", "لأدوار محددة"], x.postPerm === "mods" && ["mega", "النشر للمشرفين"]].filter(Boolean) : [];
      body.querySelector("#c-chhead").innerHTML = x ? `<div class="c-chh"><span class="c-chh-i">${ic(chIcon(x), "sm")}</span><div class="grow"><b>${esc(x.name)}</b>${x.desc ? `<p>${esc(x.desc)}</p>` : ""}${notes.length ? `<span class="c-chn">${notes.map(([i, t]) => `<span>${ic(i, "xs")}${t}</span>`).join("")}</span>` : ""}</div></div>` : "";
      body.querySelector("#c-pins").innerHTML = pins.length ? `<details class="card c-pins" open><summary>${ic("pin", "sm")}<b>مثبّت</b><span class="c-pn">${UI.num(pins.length)}</span></summary><ul>${pins.slice(0, 3).map(pinRow).join("")}</ul>${pins.length > 3 ? `<button type="button" class="btn ghost sm block" data-allpins>عرض كل المثبّتات (${UI.num(pins.length)})</button>` : ""}</details>` : "";
      const can = member && !sp.community.archivedAt && (!x || x.canPost !== false);
      body.querySelector("#c-cmp").innerHTML = can ? `<button class="card c-compose" id="c-compose">${face(S.me())}<span class="muted c-cph">اكتب في ${esc(sp.community.name)}${x ? " · " + esc(x.name) : ""}…</span></button>` : "";
      body.querySelector("#c-compose")?.addEventListener("click", () => openComposer({ community: id, channel: ch, channels: chans, tags: sp.identity.tags, role: sp.role, icon: sp.identity.icon, contentTypes: sp.contentTypes || [], guard: sp.guard || null }));
    }
    if (member && !isMod) guardStrip(id, sp, body);
    /* v2.61.1: older posts page in by the server cursor (`next` → `?before=`): a sentinel loads the next 30 near the end,
     * «عرض المزيد» stays as the accessible fallback (and the only way in focus mode). Pages already loaded are cached
     * with the feed so a back navigation repaints the same length and the scroll position is kept.
     * v2.63 merge: every card carries its member badge (cached too); the «جديد منذ زيارتك» divider is never cached. */
    let next = null, busy = false, seen = new Set(), io = null, html = "";
    const fkey = () => "feed:" + id + ":" + ch + ":" + tag;
    const page = (before) => { const q = new URLSearchParams(); if (ch) q.set("channel", ch); if (tag) q.set("tag", tag); if (before) q.set("before", before); return api("GET", `/api/communities/${id}/posts?${q}`); };
    const fresh = (list) => list.filter((p) => p && !seen.has(p.id) && seen.add(p.id));
    const card = (p) => mBadge(postCard(S.post(p.id) || asClientPost(p)), p.memberBadge);
    function paintMore() {
      const more = body.querySelector("#c-feedmore"); if (!more) return;
      more.innerHTML = next ? `<button type="button" class="btn ghost" id="c-mb" aria-controls="c-feed">عرض المزيد</button>` : "";
      more.querySelector("#c-mb")?.addEventListener("click", () => loadMore());
      if (!next || !("IntersectionObserver" in window)) return;
      io ||= new IntersectionObserver((es) => { if (!more.isConnected) return io.disconnect(); if (document.body.dataset.wbFocus === "1") return; if (es.some((x) => x.isIntersecting)) loadMore(); }, { rootMargin: "600px 0px" });
      io.observe(more);
    }
    async function loadMore() {
      if (!next || busy) return; const my = tok, key = fkey(), feed = body.querySelector("#c-feed"), more = body.querySelector("#c-feedmore"); if (!feed || !more) return;
      busy = true; feed.setAttribute("aria-busy", "true"); more.innerHTML = `<div class="skel sm" role="status" aria-label="جارٍ التحميل…"></div>`;
      let r; try { r = await page(next); } catch (e) { busy = false; feed.removeAttribute("aria-busy"); if (my === tok) { paintMore(); toast(e.message); } return; }
      busy = false; feed.removeAttribute("aria-busy"); if (my !== tok || !feed.isConnected) return;
      const add = fresh(r.posts || []).map(card).join("");
      feed.insertAdjacentHTML("beforeend", add); html += add; next = r.next || null;
      state[key] = html; state[key + "#n"] = next; state[key + "#p"] = (state[key + "#p"] || 1) + 1;
      paintMore();
    }
    async function loadFeed(since) {
      const my = ++tok, key = fkey(), pages = Math.min(10, state[key + "#p"] || 1); busy = false; io?.disconnect();
      let r = await page(), posts = r.posts || [], got = 1;
      while (r.next && got < pages && my === tok) { r = await page(r.next); posts = posts.concat(r.posts || []); got++; } // refill what was open before
      if (my !== tok) return;
      const feed = body.querySelector("#c-feed"); if (!feed) return;
      seen = new Set(); next = r.next || null;
      const list = fresh(posts), cards = list.map(card); html = cards.join("");
      state[key] = html || UI.empty({ title: ch ? "لا منشورات في هذه القناة بعد" : "لا منشورات هنا بعد", text: member ? "ابدأ أول نقاش." : "" });
      // «جديد منذ زيارتك»: newest first, so the line sits under the last post newer than the member's previous read (not cached)
      const t = since ? +new Date(since) : 0, me = S.me()?.id; let i = t ? list.findIndex((p) => +new Date(p.createdAt) <= t) : -1;
      if (t && i < 0 && !next) i = list.length;
      if (i > 0 && list.slice(0, i).some((p) => p.author !== me)) cards.splice(i, 0, `<div class="c-new" role="separator" aria-label="جديد منذ زيارتك"><span>↑ جديد منذ زيارتك</span></div>`);
      feed.innerHTML = cards.length ? cards.join("") : state[key];
      state[key + "#n"] = next; state[key + "#p"] = got;
      paintMore();
    }
    const select = (next) => {
      ch = next; (view._cch ||= {})[id] = ch; paintSide();
      const x = cur(), since = x && member && x.unread && x.lastSeenAt ? x.lastSeenAt : null; // a previous read + unread → divider
      if (x && x.unread && member) { x.unread = 0; body.querySelector(`[data-ch="${CSS.escape(x.id)}"] .c-unr`)?.setAttribute("hidden", ""); }
      if (x && member) { x.lastSeenAt = new Date().toISOString(); api("POST", `/api/communities/${id}/channels/${x.id}/read`).catch(() => {}); }
      return loadFeed(since);
    };
    body.querySelector(".c-posts").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ch],[data-tag],[data-goab],[data-unpin],[data-allpins]"); if (!b) return;
      if (b.dataset.ch !== undefined) return select(b.dataset.ch);
      if (b.dataset.tag !== undefined) { tag = tag === b.dataset.tag ? "" : b.dataset.tag; (view._ctag ||= {})[id] = tag; paintSide(); return loadFeed(); }
      if (b.dataset.goab) { e.preventDefault(); return showTab(id, "about"); }
      if (b.dataset.unpin) { try { await api("DELETE", `/api/communities/${id}/pins/${b.dataset.unpin}`); sp.pins = sp.pins.filter((p) => p.id !== b.dataset.unpin); paintSide(); toast("أُلغي التثبيت"); } catch (er) { toast(er.message); } return; }
      if (b.dataset.allpins !== undefined) { const ps = (sp.pins || []).filter((p) => !p.channel || p.channel === ch); sheet(`<h3 class="u-mt0">${ic("pin", "sm")} المثبّتات</h3><ul class="c-pins c-pins-all">${ps.map(pinRow).join("")}</ul>`); }
    });
    await select(ch);
  }

  /* v2.62 T9 «الحارس التلقائي»: the member's own strip above the composer (warning n of max, mute countdown, lock + appeal).
   * GET /autoguard/me carries counts and times only. Nothing renders when the guard is off and nothing is active. */
  let gTick = 0, gAgain = null;
  document.addEventListener("mp:autoguard", () => gAgain?.());
  const gClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, p = (n) => String(n).padStart(2, "0"); return (h ? h + ":" + p(m) : String(m)) + ":" + p(s % 60); };
  async function guardStrip(id, sp, body) {
    const box = body.querySelector("#c-guard"); if (!box) return;
    gAgain = () => box.isConnected && guardStrip(id, sp, body);
    const g = await api("GET", `/api/communities/${encodeURIComponent(id)}/autoguard/me`).catch(() => null);
    if (!box.isConnected) return;
    sp.guard = g; clearInterval(gTick);
    const shut = sessionStorage.getItem("mp.ag." + id) === String(g?.strikes);
    if (!g || !g.member || g.exempt || (!g.enabled && !g.locked) || (!g.locked && !g.muted && (!g.strikes || shut))) { box.innerHTML = ""; return; }
    const ap = `<a class="c-ag-ap" href="${esc(g.appealUrl || "#/cappeal/" + id)}">${ic("scale", "xs")}<span>قراراتي والاستئناف</span></a>`;
    const n = `<b>تحذير ${UI.num(g.strikes)} من ${UI.num(g.max)}</b>`;
    const until = g.mutedUntil ? new Date(g.mutedUntil).getTime() : 0;
    box.innerHTML = `<section class="card c-ag${g.locked ? " lock" : g.muted ? " mute" : ""}" aria-label="حالة الكتابة"><span class="c-ag-i" aria-hidden="true">${ic(g.locked ? "lock" : g.muted ? "clock" : "alert", "sm")}</span><div class="c-ag-t">`
      + (g.locked ? `<b>أنت موقوف عن الكتابة في هذا المجتمع حتى يراجع مشرف وضعك.</b>${g.strikes ? `<small>${n}</small>` : ""}`
        : g.muted ? `<span class="c-ag-l">${n}<span> · </span><span>لا يمكنك الكتابة الآن</span></span>${until ? `<small><span>يُرفع الكتم بعد</span> <bdi dir="ltr" class="c-ag-c" role="timer">${gClock(until - Date.now())}</bdi></small>` : ""}`
          : `<b>لديك تحذير ${UI.num(g.strikes)} من ${UI.num(g.max)}</b>${g.decayDays ? `<small>تُنسى التحذيرات بعد ${UI.num(g.decayDays)} يوماً</small>` : ""}`)
      + `${g.locked || g.muted ? ap : ""}</div>${!g.locked && !g.muted ? `<button type="button" class="btn ghost icon-only c-ag-x" aria-label="إخفاء">${ic("x", "xs")}</button>` : ""}</section>`;
    box.querySelector(".c-ag-x")?.addEventListener("click", () => { sessionStorage.setItem("mp.ag." + id, String(g.strikes)); box.innerHTML = ""; });
    const c = box.querySelector(".c-ag-c");
    if (c) gTick = setInterval(() => { if (!c.isConnected) return clearInterval(gTick); const left = until - Date.now(); if (left <= 0) { clearInterval(gTick); return guardStrip(id, sp, body); } c.textContent = gClock(left); }, 1000);
  }

  /* ---- knowledge tab: FAQ, wiki, Q&A, resources ---- */
  async function tabKnowledge(id, body, sp) {
    const member = sp.role && !["pending", "banned"].includes(sp.role), isMod = MOD.includes(sp.role);
    const [faq, wiki, qa, res] = await Promise.all([api("GET", `/api/communities/${id}/faq`), api("GET", `/api/communities/${id}/wiki`), api("GET", `/api/communities/${id}/questions?filter=${view._qf || "all"}`), api("GET", `/api/communities/${id}/resources`)]);
    body.innerHTML = `${faq.faq.length ? `<h4>${ic("pin", "sm")} الأسئلة الشائعة</h4>${faq.faq.map(f => `<details class="card faq"><summary>${esc(f.q)}</summary><div class="rich">${f.html}</div></details>`).join("")}` : ""}
      <div class="row"><h4 class="grow">${ic("bookmark", "sm")} الويكي</h4>${member ? `<a class="btn ghost" href="#/wiki/${id}/new">${ic("plus", "xs")} صفحة</a>` : ""}${isMod ? `<a class="btn ghost" href="#/wiki/${id}/new?faq=1">${ic("plus", "xs")} سؤال شائع</a>` : ""}</div>
      <div class="wiki-grid">${wiki.pages.map(p => `<a class="card wiki-card" href="#/wiki/${id}/${encodeURIComponent(p.slug)}"><b>${esc(p.title)}</b><span class="muted">v${p.version} · ${relTime(p.updatedAt)}${p.locked ? " · " + ic("lock", "xs") : ""}</span></a>`).join("") || '<div class="muted">لا صفحات بعد. ابدأ أول صفحة معرفة.</div>'}</div>
      <div class="row"><h4 class="grow">؟ الأسئلة والأجوبة</h4>${member ? `<button class="btn ghost" id="ask">${ic("plus", "xs")} اسأل</button>` : ""}</div>
      <div class="chips">${[["all", "الكل"], ["open", "بلا إجابة"], ["answered", "مُجاب"]].map(([k, l]) => `<button class="tab ${(view._qf || "all") === k ? "on" : ""}" data-qf="${k}">${l}</button>`).join("")}</div>
      ${qa.questions.map(q => `<a class="card qa-row" href="#/post/${q.id}"><span class="qa-n ${q.accepted ? "ok" : ""}"><b>${q.answers}</b><small>${q.accepted ? "✓ محلول" : "إجابة"}</small></span><div class="grow"><b>${esc(q.title)}</b><div class="muted">${relTime(q.at)}</div></div></a>`).join("") || '<div class="muted">لا أسئلة</div>'}
      <div class="row"><h4 class="grow">${ic("link", "sm")} مكتبة الموارد</h4>${member ? `<button class="btn ghost" id="add-res">${ic("plus", "xs")} مورد</button>` : ""}</div>
      ${res.categories.map(cat => `<div class="res-cat"><b>${esc(cat)}</b>${res.resources.filter(x => x.category === cat).map(x => `<div class="card row res"><button class="vote ${x.voted ? "on" : ""}" data-vote="${x.id}" aria-label="تصويت">▲<small>${x.votes}</small></button><a class="grow" href="${esc(x.url)}" target="_blank" rel="noopener nofollow"><b>${esc(x.title)}</b><div class="muted">${esc(x.host)}${x.desc ? " · " + esc(x.desc) : ""}</div></a></div>`).join("")}</div>`).join("") || '<div class="muted">لا موارد بعد</div>'}`;
    body.querySelectorAll("[data-qf]").forEach(b => b.onclick = () => { view._qf = b.dataset.qf; showTab(id, "knowledge"); });
    $("#ask")?.addEventListener("click", () => askQuestion(id));
    $("#add-res")?.addEventListener("click", () => { sheet(`<h4 class="u-mt0">إضافة مورد</h4><input id="rs-t" placeholder="العنوان" aria-label="العنوان"><input id="rs-u" placeholder="https://" dir="ltr" class="u-mt8" aria-label="الرابط"><input id="rs-c" placeholder="التصنيف (مثل: توثيق، دورات)" list="rs-cats" class="u-mt8" aria-label="التصنيف"><datalist id="rs-cats">${res.categories.map(c => `<option value="${esc(c)}">`).join("")}</datalist><input id="rs-d" placeholder="وصف قصير (اختياري)" class="u-mt8"><button class="u-mt10 btn block" id="rs-go">إضافة</button>`); $("#rs-go").onclick = async () => { try { await api("POST", `/api/communities/${id}/resources`, { title: $("#rs-t").value, url: $("#rs-u").value.trim(), category: $("#rs-c").value || "عام", desc: $("#rs-d").value }); closeSheet(); showTab(id, "knowledge"); } catch (e) { toast(e.message); } }; });
    body.querySelectorAll("[data-vote]").forEach(b => b.onclick = async () => { if (!member) return toast("انضم للتصويت"); await api(b.classList.contains("on") ? "DELETE" : "PUT", `/api/communities/${id}/resources/${b.dataset.vote}/vote`); showTab(id, "knowledge"); });
  }
  function askQuestion(id) {
    sheet(`<h4 class="u-mt0">سؤال جديد</h4><input id="aq-t" placeholder="عنوان السؤال" maxlength="200" aria-label="العنوان"><textarea id="aq-b" placeholder="التفاصيل: ماذا جربت؟ ما الخطأ؟" class="u-mh100 u-mt8" aria-label="التفاصيل"></textarea><div id="aq-sim" aria-live="polite"></div><button class="u-mt10 btn block" id="aq-go">نشر السؤال</button>`);
    let t = 0; const check = () => { clearTimeout(t); t = setTimeout(async () => { const text = $("#aq-t").value + " " + $("#aq-b").value; if (text.trim().length < 8) return; const { similar } = await api("POST", `/api/communities/${id}/similar`, { text }); $("#aq-sim").innerHTML = similar.length ? `<div class="sim-box"><b>${ic("search", "xs")} قد تجد إجابتك هنا</b>${similar.map(s => `<a class="sim" href="${s.kind === "faq" ? `#/c/${id}` : `#/post/${s.id}`}" data-ui="close-sheet"><b>${esc(s.title)}</b>${s.answer ? `<span class="muted">${s.kind === "faq" ? "سؤال شائع" : "✓ أفضل إجابة"}: ${esc(s.answer.slice(0, 140))}</span>` : ""}</a>`).join("")}</div>` : ""; }, 500); };
    $("#aq-t").oninput = check; $("#aq-b").oninput = check;
    $("#aq-go").onclick = async () => { const title = $("#aq-t").value.trim(); if (title.length < 5) return toast("اكتب عنواناً واضحاً"); try { const r = await api("POST", "/api/posts", { id: "p_" + Math.random().toString(36).slice(2, 12), type: "question", title, text: $("#aq-b").value.trim() || title, community: id }); closeSheet(); toast(r.post.status === "pending" ? "✓ سؤالك بانتظار المراجعة" : "✓ نُشر سؤالك"); refresh?.(); showTab(id, "knowledge"); } catch (e) { toast(e.message); } };
  }

  /* ---- events tab ---- */
  const evRow = (e) => `<a class="card ev-row" href="#/event/${e.id}"><span class="ev-date" style="background:${e.color}"><b>${UI.num(new Date(e.startsAt).getDate())}</b><small>${new Date(e.startsAt).toLocaleDateString("ar", { month: "short" })}</small></span><div class="grow"><b>${esc(e.name)}</b><div class="muted">${new Date(e.startsAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })} · ${esc(e.place)}</div><div class="ev-meta">${ic("users", "xs")} ${UI.num(e.going.length)} سيحضر${e.community && S.community(e.community) ? ` · ${esc(S.community(e.community).name)}` : ""}</div></div><span class="chev" aria-hidden="true">←</span></a>`;
  /* v2.35: #/events — upcoming events with the shared page head (the core list stays as the offline fallback) */
  function eventsView() {
    const up = DB.events.filter(e => new Date(e.startsAt) > new Date()).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    view.innerHTML = `<div class="wrap">${UI.pageHead({ title: "الأحداث", icon: "cal", sub: "الفعاليات القادمة من مجتمعاتك ومن تتابعهم.", row: true, actions: `<button class="btn" id="ne">${ic("plus", "xs")} حدث</button>` })}${up.map(evRow).join("") || UI.empty({ title: "لا أحداث قادمة", text: "أنشئ حدثاً وادعُ متابعيك إليه." })}</div>`;
    $("#ne").onclick = () => openComposer({ type: "event" });
  }
  async function tabEvents(id, body, sp) {
    const evs = DB.events.filter(e => e.community === id && new Date(e.startsAt) > Date.now() - 864e5).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    const member = sp.role && !["pending", "banned"].includes(sp.role);
    body.innerHTML = `${member ? `<button class="btn block" id="ev-new">${ic("plus", "xs")} فعالية جديدة</button>` : ""}${evs.map(evRow).join("") || UI.empty({ title: "لا فعاليات قادمة", text: member ? "أنشئ أول فعالية لأعضاء المجتمع." : "تابع المجتمع لتعرف بفعالياته الجديدة." })}`;
    $("#ev-new")?.addEventListener("click", () => eventCreate(id));
  }
  function eventCreate(cid) {
    const d = new Date(Date.now() + 3 * 864e5); d.setHours(20, 0, 0, 0); const local = (x) => new Date(x - x.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    sheet(`<h4 class="u-mt0">فعالية جديدة</h4><input id="e-n" placeholder="اسم الفعالية" aria-label="الاسم"><textarea id="e-d" placeholder="الوصف" class="u-mh70 u-mt8"></textarea>
      <div class="u-g8 u-mt8 row"><label class="grow muted">يبدأ<input type="datetime-local" id="e-s" value="${local(d)}"></label><label class="grow muted">ينتهي<input type="datetime-local" id="e-e" value="${local(new Date(d.getTime() + 2 * 3600e3))}"></label></div>
      <input id="e-p" placeholder="المكان (مثل: جدة أو أونلاين)" class="u-mt8"><div class="u-g6 u-mt8 row"><input id="e-a" placeholder="العنوان للخريطة" class="grow"><button class="btn ghost" id="e-geo">${ic("search", "xs")}</button></div><div id="e-geo-r"></div>
      <input id="e-u" placeholder="رابط البث (اختياري) https://" dir="ltr" class="u-mt8">
      <div class="u-g8 u-mt8 row"><label class="grow muted">السعة (فارغ = بلا حد)<input type="number" id="e-c" min="1"></label><label class="grow muted">التكرار<select id="e-r"><option value="">مرة واحدة</option><option value="weekly">أسبوعياً</option><option value="biweekly">كل أسبوعين</option><option value="monthly">شهرياً</option></select></label></div>
      <button class="u-mt12 btn block" id="e-go">إنشاء</button>`);
    let geo = null;
    $("#e-geo").onclick = async () => { const { results } = await api("GET", "/api/geocode?q=" + encodeURIComponent($("#e-a").value)); $("#e-geo-r").innerHTML = results.map((r, i) => `<button class="geo-r" data-g="${i}">${esc(r.name.slice(0, 90))}</button>`).join("") || '<div class="muted">لم نجد العنوان. سيظهر نصاً فقط.</div>'; document.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { geo = results[+b.dataset.g]; $("#e-geo-r").innerHTML = `<div class="muted">✓ ${esc(geo.name.slice(0, 80))}</div>`; }); };
    $("#e-go").onclick = async () => {
      try { const r = await api("POST", "/api/events/plus", { name: $("#e-n").value.trim(), desc: $("#e-d").value, startsAt: new Date($("#e-s").value).toISOString(), endsAt: $("#e-e").value ? new Date($("#e-e").value).toISOString() : undefined, place: $("#e-p").value.trim() || "أونلاين", address: $("#e-a").value.trim() || undefined, lat: geo?.lat, lng: geo?.lng, onlineUrl: $("#e-u").value.trim() || undefined, capacity: $("#e-c").value ? +$("#e-c").value : undefined, recurrence: $("#e-r").value || undefined, community: cid });
        closeSheet(); if (typeof refresh === "function") await refresh(); location.hash = "#/event/" + r.event.id; } catch (e) { toast(e.message); }
    };
  }

  /* ---- members & about ---- */
  /* v2.58: search + filters (all · team · new · featured), 52 px rows, one page at a time from the server */
  async function tabMembers(id, body, sp) {
    const isMod = MOD.includes(sp.role); let f = "", term = "", tok = 0;
    const FILT = [["", "الكل"], ["staff", "المشرفون"], ["new", "الجدد"], ["top", "البارزون"]];
    const row = (m, u) => `<div class="row m-row">${userChip(u, m.joinedAt ? "انضم " + relTime(m.joinedAt) : "")}${MOD.includes(m.role) ? `<span class="c-rb">${esc(ROLE_AR[m.role])}</span>` : ""}${isMod && !MOD.includes(m.role) && u.id !== DB.me ? `<button class="btn ghost icon-only" data-mem="${esc(u.id)}" aria-label="إجراءات المشرف على ${esc(u.name)}">${ic("more", "xs")}</button>` : ""}</div>`;
    body.innerHTML = `<div class="c-mtools"><input type="search" id="m-q" placeholder="ابحث بالاسم أو اسم المستخدم" aria-label="ابحث في الأعضاء"></div>
      <div class="chips c-mf" role="group" aria-label="فلترة الأعضاء">${FILT.map(([k, l]) => `<button type="button" class="tab${k === f ? " on" : ""}" data-mf="${k}" aria-pressed="${k === f}">${l}</button>`).join("")}</div>
      <p class="muted c-mtot" id="m-tot" aria-live="polite"></p><div class="m-list" id="m-list"><div class="skel sm"></div><div class="skel sm"></div><div class="skel sm"></div></div><div id="m-more"></div>`;
    const list = body.querySelector("#m-list"), more = body.querySelector("#m-more"), tot = body.querySelector("#m-tot");
    list.addEventListener("click", (e) => { const b = e.target.closest("[data-mem]"); if (b) memberSheet(id, b.dataset.mem); });
    const load = async (cursor) => {
      const my = cursor ? tok : ++tok;
      if (f === "top") { const t = term.toLowerCase(), l = sp.featured.filter((u) => !t || (u.name + " " + u.handle).toLowerCase().includes(t)); list.innerHTML = l.map((u) => row({ role: "member" }, u)).join("") || `<div class="empty">لا أعضاء بارزين بعد</div>`; more.innerHTML = ""; tot.textContent = "الأكثر إسهاماً خلال 30 يوماً"; return; }
      try {
        const q = new URLSearchParams({ limit: "30" }); if (f) q.set("role", f); if (term) q.set("q", term); if (cursor) q.set("cursor", cursor);
        const r = await api("GET", `/api/communities/${id}/members?${q}`); if (my !== tok) return;
        if (!cursor) list.innerHTML = "";
        list.insertAdjacentHTML("beforeend", r.members.map((m) => row(m, m.user)).join("") || (cursor ? "" : `<div class="empty">${term ? "لا نتائج. جرّب اسماً آخر." : f === "new" ? "لا أعضاء جدد خلال 14 يوماً" : "لا أعضاء بعد"}</div>`));
        tot.textContent = !f && !term ? `عدد الأعضاء: ${UI.num(r.total)}` : f === "new" ? "انضموا خلال آخر 14 يوماً" : "";
        more.innerHTML = r.next ? `<button class="btn ghost block" type="button" id="m-next">عرض المزيد</button>` : "";
        more.querySelector("#m-next")?.addEventListener("click", (e) => { e.currentTarget.disabled = true; load(r.next); });
      } catch (e) {
        if (cursor) { toast(e.message); return; }
        const all = DB.memberships.filter((m) => m.community === id && !["pending", "banned"].includes(m.role)).map((m) => ({ m, u: S.user(m.user) })).filter((x) => x.u);
        list.innerHTML = all.length && e.status !== 403 ? all.map(({ m, u }) => row(m, u)).join("") : `<div class="empty">${esc(e.status === 403 ? "قائمة الأعضاء متاحة لأعضاء المجتمع" : e.message)}</div>`; tot.textContent = "";
      }
    };
    body.querySelectorAll("[data-mf]").forEach((b) => (b.onclick = () => { f = b.dataset.mf; body.querySelectorAll("[data-mf]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }); load(); }));
    let t = 0; body.querySelector("#m-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { term = e.target.value.trim(); load(); }, 300); };
    await load(null);
  }
  /* v2.58: rules as numbered cards with severity, then the team, partners, challenges, «أُنشئ في…» */
  /* v2.60: the community market tab — listings linked to this community (the market itself is unchanged) */
  async function tabMarket(id, body) {
    const r = await api("GET", `/api/market/listings?community=${encodeURIComponent(id)}&limit=24`).catch(() => ({ items: [] }));
    body.innerHTML = `<div class="c-mk-h"><p class="muted grow">قوائم من أعضاء المجتمع في السوق المجتمعي.</p><a class="btn ghost sm" href="#/market/new">${ic("plus", "xs")} أضف قائمة</a></div>${r.items.length ? `<div class="list">${r.items.map((x) => UI.li({ href: `#/market/item/${esc(x.id)}`, icon: "bag", title: x.title, sub: `${x.price} Pi` })).join("")}</div>` : UI.empty({ title: "لا قوائم بعد", text: "اعرض منتجاً أو خدمة واربطها بهذا المجتمع.", action: `<a class="btn sm" href="#/market/new">${ic("plus", "xs")} أضف قائمة</a>` })}`;
  }
  async function tabAbout(id, body, sp) {
    const c = sp.community;
    const [{ challenges }, rr] = await Promise.all([api("GET", `/api/communities/${id}/challenges`), api("GET", `/api/communities/${id}/rules`).catch(() => ({ rules: (c.rules || []).map((t) => ({ title: t, body: "", severity: "info" })) }))]);
    const SEV = { warn: "تنبيه", serious: "مخالفة جسيمة" };
    body.innerHTML = `${rr.rules.length ? `<h4>${ic("shield", "sm")} القواعد</h4><ol class="c-rcards">${rr.rules.map((x, i) => `<li class="card c-rc${x.severity !== "info" ? " sev-" + x.severity : ""}"><span class="c-rn" aria-hidden="true">${UI.num(i + 1)}</span><div class="grow"><b>${esc(x.title)}</b>${x.body ? `<p>${esc(x.body)}</p>` : ""}</div>${SEV[x.severity] ? `<span class="c-sev">${SEV[x.severity]}</span>` : ""}</li>`).join("")}</ol>` : ""}
      ${sp.moderators.length ? `<h4>${ic("shield", "sm")} فريق الإشراف</h4><div class="m-grid">${sp.moderators.map((u) => userChip(u, ROLE_AR[u.role])).join("")}</div>` : ""}
      ${sp.partners.length ? `<h4>${ic("users", "sm")} مجتمعات شريكة</h4><div class="m-grid">${sp.partners.map((p) => `<a class="m-chip" href="#/c/${p.id}"><span class="av sm" data-bg="${esc(p.color || "")}">${esc(p.icon || p.name[0])}</span><b>${esc(p.name)}</b></a>`).join("")}</div>` : ""}
      ${challenges.length ? `<h4>${ic("trophy", "sm")} التحديات</h4>${challenges.map((ch) => `<div class="card challenge"><div class="row"><b class="grow">${esc(ch.title)}</b><span class="chip ${ch.status}">${{ live: "جارٍ", upcoming: "قريباً", ended: "انتهى" }[ch.status]}</span></div><div class="muted">#${esc(ch.tag)}${ch.prize ? " · الجائزة: " + esc(ch.prize) : ""} · ينتهي ${new Date(ch.endsAt).toLocaleDateString("ar")}</div>${ch.desc ? `<p>${esc(ch.desc)}</p>` : ""}<ol class="lb">${(ch.winners || ch.leaderboard).slice(0, 5).map((x, i) => `<li>${i < 3 ? `<span class="rank r${i + 1}">${i + 1}</span>` : i + 1 + "."} <a href="#/post/${x.post}">${esc(x.user.name)}</a> <span class="muted">${x.score} نقطة</span></li>`).join("") || '<li class="muted">لا مشاركات بعد</li>'}</ol></div>`).join("")}` : ""}
      <div class="card muted c-born">${ic("cal", "xs")} أُنشئ ${new Date(c.createdAt).toLocaleDateString("ar", { year: "numeric", month: "long" })}${c.location ? " · " + esc(c.location) : ""}</div>
      ${sp.role && !["pending", "banned"].includes(sp.role) ? `<button class="btn ghost block" id="c-invite">${ic("link", "xs")} رابط دعوة</button>` : ""}`;
    body.querySelectorAll("[data-bg]").forEach((el) => { if (/^(#[0-9a-f]{3,8}|linear-gradient\([^;]+\))$/i.test(el.dataset.bg)) el.style.background = el.dataset.bg; });
    $("#c-invite")?.addEventListener("click", () => invitesSheet(id));
  }
  /* v2.59: ONE action sheet for the whole community module (communities + admin panel) — replaces prompt()/confirm().
   * Touch-first: 48 px actions, chips for choices and saved replies, Ctrl/⌘+Enter confirms, Esc / tap outside cancels.
   * Resolves { ok, text, choice } or null. */
  const MUTE_CHOICES = { label: "مدة الكتم", items: [[1, "ساعة"], [24, "يوم"], [168, "أسبوع"], [720, "شهر"]] };
  function actSheet({ title, text = "", ok = "تأكيد", danger = false, type = null, input = null, required = false, value = "", max = 300, choices = null, choice = null, macros = null, icon = null, idp = "as" } = {}) {
    return new Promise((res) => { // idp: element id prefix (the admin panel keeps its v2.57 ids: ca-ask-ok / -no / -i / -t)
      const ch = choices ? `<div class="as-ch" role="radiogroup" aria-label="${esc(choices.label || "الخيار")}">${choices.label ? `<span class="lbl">${esc(choices.label)}</span>` : ""}<div class="as-opts">${choices.items.map(([v, l]) => `<label class="as-opt"><input type="radio" name="as-c" value="${esc(String(v))}" ${String(v) === String(choice ?? choices.items[0][0]) ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div></div>` : "";
      const mac = input && macros?.length ? `<div class="as-mac"><span class="lbl">ردود جاهزة</span><div class="as-chips">${macros.map((m, i) => `<button type="button" class="as-m" data-i="${i}">${esc(m.title)}</button>`).join("")}</div></div>` : "";
      sheet(`<div class="as"><div class="as-h">${icon ? `<span class="as-ic${danger ? " danger" : ""}" aria-hidden="true">${ic(icon, "sm")}</span>` : ""}<h3 class="u-m0" id="as-title">${esc(title)}</h3></div>${text ? `<p class="as-t">${esc(text)}</p>` : ""}${ch}${mac}
        ${input ? `<label class="field as-f"><span class="lbl">${esc(input)}${required ? "" : ' <small class="muted">(اختياري)</small>'}</span><textarea id="${idp}-i" rows="3" maxlength="${max}" aria-label="${esc(input)}">${esc(value)}</textarea><small class="as-n muted" aria-live="polite"></small></label>` : ""}
        ${type ? `<label class="field"><span class="lbl">اكتب «${esc(type)}» للتأكيد</span><input id="${idp}-t" autocomplete="off" aria-label="اكتب ${esc(type)} للتأكيد"></label>` : ""}
        <div class="as-acts"><button type="button" class="btn ${danger ? "danger" : ""} grow" id="${idp}-ok">${esc(ok)}</button><button type="button" class="btn ghost grow" id="${idp}-no">إلغاء</button></div></div>`);
      const s = document.getElementById("sheet"), okB = document.getElementById(idp + "-ok"), ti = document.getElementById(idp + "-i"), ty = document.getElementById(idp + "-t"), n = s.querySelector(".as-n");
      s.querySelector(".panel")?.setAttribute("role", "dialog"); s.querySelector(".panel")?.setAttribute("aria-labelledby", "as-title");
      const check = () => { if (n && ti) n.textContent = ti.value.length ? `${UI.num(ti.value.length)} / ${UI.num(max)}` : ""; okB.disabled = (!!type && ty.value.trim() !== type) || (required && !!ti && ti.value.trim().length < 3); };
      ti?.addEventListener("input", check); ty?.addEventListener("input", check); check();
      s.querySelectorAll(".as-m").forEach((b) => (b.onclick = () => { const m = macros[+b.dataset.i]; ti.value = m.reason || m.title; check(); ti.focus(); s.querySelectorAll(".as-m").forEach((x) => x.classList.toggle("on", x === b)); }));
      let done = false; const fin = (v) => { if (done) return; done = true; res(v); };
      const yes = () => { if (okB.disabled) return; fin({ ok: true, text: ti?.value.trim() || "", choice: s.querySelector('input[name="as-c"]:checked')?.value ?? null, macro: macros?.[+s.querySelector(".as-m.on")?.dataset.i] || null }); closeSheet(); };
      okB.onclick = yes; document.getElementById(idp + "-no").onclick = () => { fin(null); closeSheet(); };
      s.querySelector(".as").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.target === ty)) { e.preventDefault(); yes(); } else if (e.key === "Escape") { fin(null); closeSheet(); } });
      s._onclose = () => fin(null);
      setTimeout(() => (ty || ti || okB).focus(), 60);
    });
  }
  /* v2.63.1: the member card is built from separate text nodes so the DOM translator can key each one (role, «{n} إنذار», log label,
   * relative time). Dates follow the UI language; the server keeps Arabic labels/reasons (backward compatible) and the client
   * splits the auto-guard reason «الحارس التلقائي: عبارة ممنوعة (…)» into its fixed phrase + the masked words (never translated). */
  const uiLoc = () => { const l = typeof DB !== "undefined" && DB.settings?.lang; return l === "en" || l === "fr" || l === "ur" ? "en" : "ar"; }; // v2.67: ar + en only (retired fr/ur → en)
  const AG_RE = /^(الحارس التلقائي: عبارة ممنوعة)(?: \((.*)\))?$/;
  const logReason = (r) => { const m = AG_RE.exec(String(r)); return m ? `<span>${m[1]}</span>${m[2] ? ` (<bdi data-noi18n>${esc(m[2])}</bdi>)` : ""}` : `<span>${esc(r)}</span>`; };
  async function memberSheet(cid, uid) {
    const u = S.user(uid), d = await api("GET", `/api/communities/${cid}/members/${uid}/notes`);
    sheet(`<div class="u-g10 row">${av(u)}<div class="grow"><b>${esc(u?.name || "")}</b><div class="muted">${ROLE_AR[d.member?.role] ? `<span>${ROLE_AR[d.member.role]}</span> · ` : ""}<span>${UI.num(d.member?.warnings || 0)} إنذار</span>${d.member?.mutedUntil ? ` · <span>مكتوم حتى</span> <bdi data-noi18n>${esc(new Date(d.member.mutedUntil).toLocaleString(uiLoc()))}</bdi>` : ""}</div></div></div>
      ${d.guard && (d.guard.strikes || d.guard.locked) ? `<div class="c-ag-ms" role="note">${ic("shield", "xs")}<span>تحذيرات الحارس ${UI.num(d.guard.strikes)} من ${UI.num(d.guard.max)}</span>${d.guard.locked ? `<span class="chip warn">موقوف حتى يرفعه مشرف</span><button type="button" class="btn sm" data-lift>رفع الإيقاف</button>` : ""}</div>` : ""}
      <div class="row mod-acts"><button class="btn ghost" data-d="warn"><svg class=ei aria-hidden=true><use href=#i-alert /></svg> إنذار</button><button class="btn ghost" data-d="mute"><svg class=ei aria-hidden=true><use href=#i-volumeX /></svg> كتم</button>${d.member?.role === "muted" ? `<button class="btn ghost" data-d="unmute">إلغاء الكتم</button>` : ""}<button class="btn danger" data-d="ban">حظر</button></div>
      <h4>ملاحظات المشرفين <span class="muted">(خاصة)</span></h4>${d.notes.map(n => `<div class="note"><div>${esc(n.text)}</div><small class="muted">${esc(n.author)} · ${relTime(n.created_at)}</small></div>`).join("") || '<p class="muted">لا ملاحظات</p>'}
      <div class="u-g6 row"><input id="mn-t" placeholder="أضف ملاحظة للمشرفين" class="grow"><button class="btn" id="mn-go">حفظ</button></div>
      <h4>السجل</h4>${d.history.map(h => `<div class="muted c-hist"><span>${esc(h.label)}</span>${h.reason ? ` — ${logReason(h.reason)}` : ""} · <span>${relTime(h.created_at)}</span></div>`).join("") || '<p class="muted">لا إجراءات سابقة</p>'}`);
    document.querySelectorAll("#sheet [data-d]").forEach(b => b.onclick = async () => { // v2.59: the unified action sheet instead of prompt()
      const a = b.dataset.d, T = { warn: ["إنذار " + (u?.name || "العضو"), "إنذار", "alert"], mute: ["كتم " + (u?.name || "العضو"), "كتم", "volumeX"], unmute: ["رفع الكتم عن " + (u?.name || "العضو"), "رفع الكتم", "volume"], ban: ["حظر " + (u?.name || "العضو") + "؟", "حظر", "ban"] }[a];
      const r = await actSheet({ title: T[0], ok: T[1], icon: T[2], danger: a === "ban", input: a === "unmute" ? null : "السبب (يظهر في سجل الإشراف)", choices: a === "mute" ? MUTE_CHOICES : null, choice: 24, text: a === "ban" ? "يستطيع العضو تقديم استئناف يراجعه مشرف أعلى رتبة." : "" });
      if (!r) return; try { await api("POST", `/api/communities/${cid}/members/${uid}/discipline`, { action: a, reason: r.text, hours: +(r.choice || 24) }); toast("✓ تم"); memberSheet(cid, uid); } catch (e) { toast(e.message); } });
    $("#mn-go").onclick = async () => { const t = $("#mn-t").value.trim(); if (!t) return; await api("POST", `/api/communities/${cid}/members/${uid}/notes`, { text: t }); memberSheet(cid, uid); };
    document.querySelector("#sheet [data-lift]")?.addEventListener("click", async () => { // v2.62 T9: lift a guard lock through the existing discipline unmute (server enforces liftMin + rank)
      const r = await actSheet({ title: "رفع الإيقاف عن " + (u?.name || "العضو"), ok: "رفع الإيقاف", icon: "volume", choices: { label: "التحذيرات", items: [[1, "تصفير التحذيرات"], [0, "إبقاء التحذيرات"]] }, choice: 1 });
      if (!r) return; try { await api("POST", `/api/communities/${cid}/members/${uid}/discipline`, { action: "unmute", reset: r.choice === "1" }); toast("✓ تم"); memberSheet(cid, uid); } catch (e) { toast(e.message); } });
  }
  async function invitesSheet(cid) {
    const { invites } = await api("GET", `/api/communities/${cid}/invites`);
    sheet(`<h4 class="u-mt0">${ic("link", "sm")} روابط الدعوة</h4><div class="u-g6 row"><input id="iv-l" placeholder="تسمية (مثل: تويتر، الجامعة)" class="grow"><button class="btn" id="iv-go">رابط جديد</button></div>
      ${invites.map(i => `<div class="card inv"><div class="row"><b class="grow">${esc(i.label || "رابط دعوة")}</b><button class="btn ghost" data-copy="${esc(location.origin + i.url)}">${ic("copy", "xs")} نسخ</button></div><div class="inv-stats"><span><b>${i.clicks}</b> نقرة</span><span><b>${i.joins}</b> انضمام</span><span><b>${i.active}</b> نشِط</span><span><b>${i.conversion}٪</b> تحويل</span></div><small class="muted" dir="ltr">${esc(location.origin + i.url)}</small></div>`).join("") || '<p class="muted">أنشئ رابطاً لكل قناة تنشر فيها لتعرف أيها يجلب أعضاء أكثر.</p>'}`);
    $("#iv-go").onclick = async () => { const r = await api("POST", `/api/communities/${cid}/invites`, { label: $("#iv-l").value.trim() || undefined }); navigator.clipboard?.writeText(location.origin + r.invite.url).catch(() => { }); toast("✓ نُسخ الرابط"); invitesSheet(cid); };
    document.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy).catch(() => { }); toast("✓ نُسخ"); });
  }
  /* ---- share card (canvas) ---- */
  async function shareCard(cid) {
    const sp = state[cid], c = sp.community, idn = sp.identity;
    sheet(`<canvas id="sc" width="1080" height="1080" class="share-canvas" aria-label="بطاقة المجتمع"></canvas><div class="u-g8 u-mt10 row"><button class="btn grow" id="sc-share">${ic("share", "xs")} مشاركة</button><button class="btn ghost grow" id="sc-link">${ic("copy", "xs")} نسخ الرابط</button></div>`);
    const cv = $("#sc"), g = cv.getContext("2d"), W = 1080;
    const m = /#([0-9a-f]{3,8}),\s?#([0-9a-f]{3,8})/i.exec(c.color || "") || [null, "5b2bd6", "c04cf0"];
    const bg = g.createLinearGradient(0, 0, W, W); bg.addColorStop(0, "#" + m[1]); bg.addColorStop(1, idn.accent || "#" + m[2]); g.fillStyle = bg; g.fillRect(0, 0, W, W);
    g.fillStyle = "rgba(255,255,255,.1)"; [[180, 160, 240], [930, 900, 300], [900, 200, 140]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
    g.fillStyle = "#fff"; g.beginPath(); g.roundRect(W / 2 - 110, 200, 220, 220, 56); g.fill();
    const F = (s, w = 800) => `${w} ${s}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
    g.textAlign = "center"; g.direction = "rtl"; g.font = F(120); g.fillStyle = "#1d1b26"; g.fillText(idn.icon || c.name[0], W / 2, 355);
    g.fillStyle = "#fff"; g.font = F(76); g.fillText(c.name.slice(0, 26), W / 2, 540);
    g.font = F(38, 500); g.globalAlpha = .9; const desc = (c.desc || "").slice(0, 60); if (desc) g.fillText(desc, W / 2, 610); g.globalAlpha = 1;
    g.font = F(44, 700); g.fillText(`${fmtN(sp.stats.members)} عضو · ${sp.stats.postsWeek} منشوراً هذا الأسبوع`, W / 2, 720);
    g.fillStyle = "rgba(255,255,255,.95)"; g.beginPath(); g.roundRect(W / 2 - 260, 800, 520, 110, 55); g.fill(); g.fillStyle = "#1d1b26"; g.font = F(44); g.fillText("انضم إلينا في مجتمع بلس", W / 2, 870);
    const url = `${location.origin}/c/${cid}`;
    $("#sc-link").onclick = () => { navigator.clipboard?.writeText(url).catch(() => { }); toast("✓ نُسخ الرابط"); };
    $("#sc-share").onclick = () => cv.toBlob(async (b) => { const f = new File([b], "community.png", { type: "image/png" }); if (navigator.canShare?.({ files: [f] })) navigator.share({ files: [f], title: c.name, url }).catch(() => { }); else { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "community.png"; a.click(); } }, "image/png");
  }

  /* v2.50: posting inside a community opens the simple community editor (composer-ui.js, mode "community"):
   * community fixed, channel + tag passed in from the page — no more wrapping the general editor or the API client. */

  /* =================== Moderator dashboard =================== */
  async function modView(cid, host) {
    const root = host || view, tab = view._mtab || "queue";
    const tabs = `<div class="tabs" role="tablist" aria-label="أقسام الإشراف">${[["queue", "طابور المراجعة"], ["rules", "القواعد الآلية"], ["log", "سجل الإشراف"]].map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-mtab="${k}" role="tab" aria-selected="${tab === k}">${l}</button>`).join("")}</div><div id="m-body"><div class="skel"></div></div>`;
    root.innerHTML = host ? tabs : `<div class="wrap">${UI.pageHead({ back: [`#/c/${cid}`, S.community(cid)?.name || "المجتمع"], title: "لوحة الإشراف", icon: "shield" })}${tabs}</div>`;
    root.querySelectorAll("[data-mtab]").forEach(b => b.onclick = () => { view._mtab = b.dataset.mtab; modView(cid, host); });
    const mBody = $("#m-body"); /* stale-route guard (fast navigation) */
    try { await ({ queue: modQueue, rules: modRules, log: modLog })[tab](cid, mBody); } catch (e) { if (mBody?.isConnected) mBody.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  let modKeys = null;
  async function modQueue(cid, body) {
    const q = await api("GET", `/api/communities/${cid}/modqueue`); let sel = 0;
    if (!body?.isConnected) return; /* stale-route guard (fast navigation) */
    const KIND = { post: "منشور معلّق", report: "بلاغ", join: "طلب انضمام" };
    body.innerHTML = `<div class="mq-counts"><span><b>${q.counts.posts}</b> منشورات</span><span><b>${q.counts.reports}</b> بلاغات</span><span><b>${q.counts.joins}</b> طلبات</span></div>
      <p class="muted mq-help">اختصارات: <kbd>J</kbd>/<kbd>K</kbd> تنقّل · <kbd>A</kbd> قبول · <kbd>R</kbd> رفض/حذف · <kbd>D</kbd> تجاهل · <kbd>W</kbd> إنذار · <kbd>M</kbd> كتم · <kbd>N</kbd> ملاحظات</p>
      <div class="mq">${q.items.map((it, i) => `<div class="card mq-item ${i === 0 ? "sel" : ""}" data-i="${i}" tabindex="0"><div class="row"><span class="chip k-${it.kind}">${KIND[it.kind]}</span>${it.toxicity >= 0.6 ? `<span class="chip tox">إساءة ${Math.round(it.toxicity * 100)}٪</span>` : ""}<span class="grow"></span><span class="muted">${relTime(it.at)}</span></div>
        ${it.user ? `<div class="row mq-user">${av(it.user, "sm")}<b>${esc(it.user.name)}</b><span class="muted">@${esc(it.user.handle)}</span>${it.user.warnings ? `<span class="chip warn">${it.user.warnings} إنذار</span>` : ""}${it.user.notes ? `<span class="chip">${it.user.notes} ملاحظة</span>` : ""}</div>` : ""}
        ${it.text ? `<p class="mq-text">${esc(it.text)}</p>` : ""}${it.answers?.length ? `<dl class="mq-ans">${it.answers.map(a => `<dt>${esc(a.q)}</dt><dd>${esc(a.a || "—")}</dd>`).join("")}</dl>` : ""}
        <div class="muted mq-reason">${ic("flag", "xs")} ${esc(it.reason)}</div>
        <div class="row mq-acts">${it.kind === "report" ? `<button class="btn danger" data-act="remove">حذف المحتوى</button><button class="btn ghost" data-act="dismiss">تجاهل البلاغ</button>` : `<button class="btn" data-act="approve">قبول</button><button class="btn ghost" data-act="reject">رفض</button>`}${it.user && it.kind !== "join" ? `<button class="btn ghost" data-act="warn">إنذار</button><button class="btn ghost" data-act="notes">${ic("more", "xs")}</button>` : ""}</div></div>`).join("") || `<div class="empty">${ic("check")} لا شيء ينتظر المراجعة. عمل رائع!</div>`}</div>`;
    const items = [...body.querySelectorAll(".mq-item")];
    const focus = (i) => { sel = Math.max(0, Math.min(items.length - 1, i)); items.forEach((x, k) => x.classList.toggle("sel", k === sel)); items[sel]?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
    const act = async (i, action) => {
      const it = q.items[i]; if (!it) return;
      if (action === "notes") return memberSheet(cid, it.user.id);
      if (["warn", "mute", "ban"].includes(action)) { if (!it.user) return; await api("POST", `/api/communities/${cid}/members/${it.user.id}/discipline`, { action, hours: 24, reason: it.reason }).then(() => toast("✓ تم")).catch(e => toast(e.message)); return; }
      const valid = it.kind === "report" ? ["remove", "dismiss"] : ["approve", "reject"]; const a = action === "reject" && it.kind === "report" ? "remove" : action; if (!valid.includes(a)) return;
      try { await api("POST", `/api/communities/${cid}/modqueue/act`, { kind: it.kind, id: it.id, action: a }); items[i].classList.add("done"); setTimeout(() => modQueue(cid, body), 220); } catch (e) { toast(e.message); }
    };
    items.forEach((el, i) => { el.onclick = () => focus(i); el.querySelectorAll("[data-act]").forEach(b => b.onclick = (e) => { e.stopPropagation(); act(i, b.dataset.act); }); });
    if (modKeys) document.removeEventListener("keydown", modKeys);
    modKeys = (e) => {
      if (!document.body.contains(body) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase(), map = { a: "approve", r: "reject", d: "dismiss", w: "warn", m: "mute", n: "notes" };
      if (k === "j") focus(sel + 1); else if (k === "k") focus(sel - 1); else if (map[k]) { e.preventDefault(); act(sel, map[k]); }
    };
    document.addEventListener("keydown", modKeys);
  }
  async function modRules(cid, body) {
    const { automod, publicLog } = await api("GET", `/api/communities/${cid}/automod`);
    if (!body?.isConnected) return; /* stale-route guard (fast navigation) */
    body.innerHTML = `<div class="card"><label class="muted">كلمات محظورة (كلمة في كل سطر)</label><textarea id="am-w" class="u-mh90">${esc(automod.words.join("\n"))}</textarea>
      <label class="chk"><input type="checkbox" id="am-l" ${automod.blockLinks ? "checked" : ""}> مراجعة المنشورات التي تحتوي روابط</label>
      <label class="muted">الحسابات الأحدث من (أيام) تُراجع منشوراتها</label><input type="number" id="am-n" min="0" max="90" value="${automod.newAccountDays}">
      <label class="muted">المحتوى المسيء (مصنّف آلي)</label><select id="am-t"><option value="off">إيقاف</option><option value="queue">تحويل للمراجعة</option><option value="reject">رفض الشديد تلقائياً</option></select>
      <label class="muted">عند مطابقة قاعدة</label><select id="am-a"><option value="queue">تحويل للمراجعة</option><option value="reject">رفض المنشور</option></select>
      <label class="chk"><input type="checkbox" id="am-p" ${publicLog ? "checked" : ""}> سجل إشراف شفاف يراه الأعضاء (دون أسماء المشرفين)</label>
      <button class="u-mt10 btn block" id="am-go">حفظ القواعد</button></div><p class="muted">المشرفون مستثنون من القواعد الآلية. كل قرار آلي يظهر في السجل بسببه.</p>`;
    $("#am-t").value = automod.toxicity; $("#am-a").value = automod.action;
    $("#am-go").onclick = async () => { try { await api("PATCH", `/api/communities/${cid}/automod`, { words: $("#am-w").value.split("\n").map(s => s.trim()).filter(Boolean), blockLinks: $("#am-l").checked, newAccountDays: +$("#am-n").value, toxicity: $("#am-t").value, action: $("#am-a").value, publicLog: $("#am-p").checked }); toast("✓ حُفظت القواعد"); } catch (e) { toast(e.message); } };
  }
  async function modLog(cid, body) {
    const { log } = await api("GET", `/api/communities/${cid}/modlog`);
    if (!body?.isConnected) return; /* stale-route guard (fast navigation) */
    body.innerHTML = `<div class="row"><span class="grow muted">${log.length} إجراء</span><a class="btn ghost" href="/api/communities/${cid}/modlog?format=csv" download>${ic("share", "xs")} تصدير CSV</a></div>
      <div class="m-log">${log.map(l => `<div class="m-log-row"><span class="chip">${esc(l.label)}</span><span class="grow">${esc(l.actor || "")}${l.target ? " ← " + esc(l.target) : ""}${l.reason ? `<small class="muted"> · ${esc(l.reason)}</small>` : ""}</span><span class="muted">${relTime(l.at)}</span></div>`).join("") || '<div class="empty">لا إجراءات بعد</div>'}</div>`;
  }

  /* =================== Wiki =================== */
  async function wikiView(cid, slug) {
    const isNew = slug === "new", faq = /faq=1/.test(location.hash);
    if (isNew) return wikiEdit(cid, null, faq);
    const [{ pages }, pg] = await Promise.all([api("GET", `/api/communities/${cid}/wiki`), api("GET", `/api/communities/${cid}/wiki/${encodeURIComponent(slug)}`).catch(() => null)]);
    if (!pg) return Views.notFound();
    const p = pg.page, role = state[cid]?.role || (DB.memberships.find(m => m.community === cid && m.user === DB.me)?.role), canEdit = role && !["pending", "banned", "muted"].includes(role) && (!p.locked || MOD.includes(role));
    view.innerHTML = `<div class="wrap docs"><a href="#/c/${cid}" class="muted">→ ${esc(S.community(cid)?.name || "المجتمع")}</a>
      <div class="docs-grid"><aside class="docs-nav" aria-label="صفحات الويكي"><b>${ic("bookmark", "xs")} الويكي</b>${pages.map(x => `<a href="#/wiki/${cid}/${encodeURIComponent(x.slug)}" class="${x.slug === p.slug ? "on" : ""}">${esc(x.title)}</a>`).join("")}${p.toc.length > 1 ? `<b class="u-mt12">في هذه الصفحة</b>${p.toc.map(t => `<a href="#" data-toc="${t.id}" class="l${t.level}">${esc(t.text)}</a>`).join("")}` : ""}</aside>
      <article class="docs-body"><div class="row"><h1 class="grow">${esc(p.title)}</h1>${canEdit ? `<button class="btn ghost" id="w-edit">${ic("pen", "xs")} تحرير</button>` : ""}<button class="btn ghost" id="w-hist">${ic("refresh", "xs")} السجل</button></div>
        <div class="muted">آخر تعديل ${relTime(p.updatedAt)} بواسطة ${esc(pg.page.editor?.name || "")} · النسخة ${p.version}${p.locked ? " · " + ic("lock", "xs") + " مقفلة" : ""} · ${p.readingMin} د قراءة</div>
        <div class="rich docs-content">${p.html}</div></article></div></div>`;
    const heads = view.querySelectorAll(".docs-content h2, .docs-content h3"); heads.forEach((h, i) => { if (p.toc[i]) h.id = p.toc[i].id; });
    view.querySelectorAll("[data-toc]").forEach(a => a.onclick = (e) => { e.preventDefault(); document.getElementById(a.dataset.toc)?.scrollIntoView({ behavior: "smooth" }); });
    $("#w-edit")?.addEventListener("click", () => wikiEdit(cid, p));
    $("#w-hist").onclick = () => wikiHistory(cid, p, MOD.includes(role));
  }
  function wikiEdit(cid, p, faq) {
    view.innerHTML = `<div class="wrap docs"><div class="row"><button class="btn ghost" id="we-x">${ic("x", "xs")} إلغاء</button><h2 class="u-tc grow">${p ? "تحرير الصفحة" : faq ? "سؤال شائع جديد" : "صفحة جديدة"}</h2><button class="btn" id="we-go">حفظ</button></div>
      <input id="we-t" class="c3-title" placeholder="${faq ? "السؤال" : "عنوان الصفحة"}" value="${esc(p?.title || "")}" aria-label="العنوان">
      <div class="c3-modes"><button data-m="w" class="on">كتابة</button><button data-m="p">معاينة</button></div>
      <textarea id="we-b" class="we-body" placeholder="${faq ? "الإجابة" : "# عنوان\n\nاكتب بالتنسيق: **عريض**، - قوائم، | جداول |"}" aria-label="المحتوى">${esc(p?.body || "")}</textarea><div id="we-p" class="rich we-body" hidden></div>
      <input id="we-s" placeholder="ملخص التعديل (اختياري)" class="u-mt8" aria-label="ملخص التعديل"></div>`;
    view.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { view.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b)); const pv = b.dataset.m === "p"; $("#we-p").hidden = !pv; $("#we-b").hidden = pv; if (pv) $("#we-p").innerHTML = RT.toHTML(RT.parse($("#we-b").value)); });
    $("#we-x").onclick = () => history.back();
    $("#we-go").onclick = async () => {
      try { const r = await api("PUT", `/api/communities/${cid}/wiki/${p ? encodeURIComponent(p.slug) : "new"}`, { title: $("#we-t").value.trim(), body: $("#we-b").value, summary: $("#we-s").value.trim() || undefined, baseVersion: p?.version, kind: faq ? "faq" : "page" }); toast("✓ حُفظت"); if (faq) view._ctab = "knowledge"; const target = faq ? `#/c/${cid}` : `#/wiki/${cid}/${encodeURIComponent(r.page.slug)}`; if (location.hash === target) (faq ? communityPage(cid, "knowledge") : wikiView(cid, r.page.slug)); else location.hash = target; }
      catch (e) { if (e.code === "wiki_conflict" || /أثناء تحريرك/.test(e.message)) { if (await actSheet({ title: "عدّل شخص آخر الصفحة أثناء تحريرك", text: "انسخ تعديلاتك أولاً، ثم افتح النسخة الأحدث وأضفها إليها.", ok: "فتح النسخة الأحدث", icon: "refresh" })) wikiView(cid, p.slug); } else toast(e.message); }
    };
  }
  async function wikiHistory(cid, p, isMod) {
    const { revisions } = await api("GET", `/api/communities/${cid}/wiki/${encodeURIComponent(p.slug)}/history`);
    sheet(`<h4 class="u-mt0">${ic("refresh", "sm")} سجل «${esc(p.title)}»</h4>${revisions.map(r => `<div class="rev row"><div class="grow"><b>v${r.version}</b> · ${esc(r.author.name)} <span class="muted">${relTime(r.at)}</span>${r.summary ? `<div class="muted">${esc(r.summary)}</div>` : ""}</div><span class="delta ${r.delta >= 0 ? "up" : "down"}">${r.delta >= 0 ? "+" : ""}${r.delta}</span>${r.version > 1 ? `<button class="btn ghost" data-diff="${r.version}">مقارنة</button>` : ""}${isMod && r.version !== p.version ? `<button class="btn ghost" data-rev="${r.version}">استرجاع</button>` : ""}</div>`).join("")}`);
    document.querySelectorAll("[data-diff]").forEach(b => b.onclick = async () => {
      const d = await api("GET", `/api/communities/${cid}/wiki/${encodeURIComponent(p.slug)}/diff?from=${+b.dataset.diff - 1}&to=${b.dataset.diff}`);
      sheet(`<h4 class="u-mt0">v${d.from} ← v${d.to} <span class="delta up">+${d.added}</span> <span class="delta down">−${d.removed}</span></h4>${d.titleChanged ? `<p class="muted">العنوان: <s>${esc(d.titleChanged.from)}</s> ← ${esc(d.titleChanged.to)}</p>` : ""}<pre class="diff">${d.lines.map(l => `<span class="d${l.op === "+" ? "a" : l.op === "-" ? "r" : "e"}">${l.op === "=" ? " " : l.op} ${esc(l.text) || " "}</span>`).join("")}</pre>`);
    });
    document.querySelectorAll("[data-rev]").forEach(b => b.onclick = async () => { if (!(await actSheet({ title: `استرجاع النسخة ${b.dataset.rev}؟`, text: "تُحفظ النسخة الحالية في السجل، ويمكنك العودة إليها.", ok: "استرجاع", icon: "undo" }))) return; await api("POST", `/api/communities/${cid}/wiki/${encodeURIComponent(p.slug)}/revert`, { version: +b.dataset.rev }); closeSheet(); toast("✓ استُرجعت"); wikiView(cid, p.slug); });
  }

  /* =================== Event page =================== */
  const _event = Views.event;
  Views.event = function (id) { if (!online()) return _event.apply(this, arguments); return eventPage(id); };
  let countdownT = 0;
  function tile(lat, lng, z = 15) { const n = 2 ** z, x = (lng + 180) / 360 * n, y = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n; return { x: Math.floor(x), y: Math.floor(y), fx: x % 1, fy: y % 1, z }; }
  async function eventPage(id) {
    view.innerHTML = `<div class="wrap"><div class="skel" style="height:200px"></div></div>`;
    let e; try { e = (await api("GET", `/api/events/${id}/details`)).event; } catch { return Views.notFound(); }
    const start = new Date(e.startsAt), end = e.endsAt ? new Date(e.endsAt) : null, c = e.community && S.community(e.community), t = e.tickets, my = e.myTicket;
    const REC = { weekly: "أسبوعياً", biweekly: "كل أسبوعين", monthly: "شهرياً" };
    let map = "";
    if (e.lat !== null && e.lat !== undefined) { const tl = tile(e.lat, e.lng); map = `<a class="ev-map" href="https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=16/${e.lat}/${e.lng}" target="_blank" rel="noopener" aria-label="فتح الخريطة"><div class="ev-tiles" style="--fx:${tl.fx};--fy:${tl.fy}">${[-1, 0, 1].map(dy => [-1, 0, 1].map(dx => `<img src="https://tile.openstreetmap.org/${tl.z}/${tl.x + dx}/${tl.y + dy}.png" alt="" loading="lazy">`).join("")).join("")}</div><span class="ev-pin"><svg class=ei aria-hidden=true><use href=#i-mapPin /></svg></span><small class="ev-attr">© OpenStreetMap</small></a>`; }
    view.innerHTML = `<div class="ev-hero" style="background:${e.color}"><div class="ev-cd" id="ev-cd" aria-live="polite"></div></div><div class="wrap ev-page">
      <h2>${esc(e.name)}</h2>${c ? `<a class="chip" href="#/c/${c.id}">${ic("users", "xs")} ${esc(c.name)}</a>` : ""}
      <div class="ev-facts"><div>${MPFeat.ico("cal", "sm")}<span><b>${start.toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" })}</b><small>${start.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}${end ? " – " + end.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : ""}${e.recurrence ? " · يتكرر " + REC[e.recurrence] : ""}</small></span></div>
        <div>${ic("mapPin", "sm")}<span><b>${esc(e.place)}</b>${e.address ? `<small>${esc(e.address)}</small>` : ""}</span></div>
        ${e.onlineUrl ? `<div>${ic("link", "sm")}<span><a href="${esc(e.onlineUrl)}" target="_blank" rel="noopener">رابط البث</a></span></div>` : ""}
        <div>${ic("users", "sm")}<span><b>${t.confirmed}${e.capacity ? " / " + e.capacity : ""} مقعداً محجوزاً</b>${t.waitlist ? `<small>${t.waitlist} في قائمة الانتظار</small>` : e.capacity ? `<small>${t.remaining} متبقٍ</small>` : ""}</span></div></div>
      ${map}
      <div class="ev-cta">${my ? (my.status === "waitlist" ? `<div class="card ev-wait"><b>${MPFeat.ico("clock", "sm")} أنت رقم ${my.position} في قائمة الانتظار</b><small class="muted">سنخبرك فور توفر مقعد</small></div><button class="btn outline" id="t-cancel">مغادرة القائمة</button>` : `<button class="btn" id="t-show">${MPFeat.ico("ticket", "sm")} تذكرتي ${my.status === "checked_in" ? "· حضرت" : ""}</button><button class="btn outline" id="t-cancel">إلغاء</button>`) : e.status === "upcoming" ? `<button class="btn block" id="t-get">${e.capacity && !t.remaining ? "انضم لقائمة الانتظار" : "احجز تذكرة مجانية"}</button>` : `<div class="muted">انتهت الفعالية</div>`}
        <a class="btn outline" href="${esc(e.ics)}" download>${MPFeat.ico("cal", "sm")} أضف للتقويم</a><button class="btn outline" id="ev-inv" aria-label="مشاركة الفعالية">${ic("share", "xs")}</button></div>
      ${e.desc ? `<div class="card"><p class="body">${richText(e.desc)}</p></div>` : ""}
      <div class="u-g10 u-mt10 row">${av(e.organizerUser, "sm")}<span class="muted">ينظمها <a href="#/u/${esc(e.organizerUser.handle)}">${esc(e.organizerUser.name)}</a></span></div>
      ${e.canManage ? `<div class="card ev-manage"><b>${ic("shield", "sm")} إدارة الفعالية</b><div class="inv-stats"><span><b>${t.confirmed}</b> مؤكد</span><span><b>${t.checkedIn}</b> حضر</span><span><b>${t.waitlist}</b> انتظار</span></div><div class="u-g8 row"><button class="btn grow" id="ev-scan">${ic("camera", "xs")} تسجيل الحضور</button><button class="btn ghost grow" id="ev-att">قائمة الحضور</button></div></div>` : ""}</div>`;
    clearInterval(countdownT);
    const cd = () => { const el = $("#ev-cd"); if (!el) return clearInterval(countdownT); const ms = start - Date.now(); if (ms <= 0) { el.innerHTML = end && end > Date.now() ? `<span class="live-dot">جارية الآن</span>` : ""; return; } const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 3600e3), m = Math.floor(ms % 3600e3 / 60e3), s = Math.floor(ms % 60e3 / 1e3); el.innerHTML = [[d, "يوم"], [h, "ساعة"], [m, "دقيقة"], [s, "ثانية"]].map(([v, l]) => `<span><b>${v}</b><small>${l}</small></span>`).join(""); };
    cd(); countdownT = setInterval(cd, 1000);
    $("#t-get")?.addEventListener("click", async () => { try { const r = await api("POST", `/api/events/${id}/tickets`); toast(r.event.myTicket.status === "waitlist" ? "أُضفت لقائمة الانتظار" : "حُجزت تذكرتك"); eventPage(id); } catch (er) { toast(er.message); } });
    $("#t-cancel")?.addEventListener("click", async () => { if (!(await actSheet({ title: "إلغاء الحجز؟", text: "قد لا يتوفر مقعد إن أردت الحجز مرة أخرى.", ok: "إلغاء الحجز", danger: true, icon: "ticket" }))) return; await api("DELETE", `/api/events/${id}/tickets`); toast("أُلغي الحجز"); eventPage(id); });
    $("#t-show")?.addEventListener("click", async () => { const svg = await qrSvg(`MPT:${id}:${my.code}`); sheet(`<div class="ticket"><div class="ticket-top" style="background:${e.color}"><b>${esc(e.name)}</b><small>${start.toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}</small></div><div class="ticket-qr">${svg}</div><div class="ticket-code" dir="ltr">${esc(my.code)}</div><small class="muted">${my.status === "checked_in" ? "✓ سُجّل حضورك" : "اعرض الرمز عند الدخول"}</small></div>`); });
    $("#ev-inv")?.addEventListener("click", () => { const url = `${location.origin}/#/event/${id}`; if (navigator.share) navigator.share({ title: e.name, url }).catch(() => { }); else { navigator.clipboard?.writeText(url); toast("✓ نُسخ الرابط"); } });
    $("#ev-att")?.addEventListener("click", async () => { const { attendees } = await api("GET", `/api/events/${id}/attendees`); sheet(`<h4 class="u-mt0">الحضور (${attendees.length})</h4>${attendees.map(a => `<div class="u-g8 u-py6 row">${av(a.user, "sm")}<b class="grow">${esc(a.user.name)}</b><span class="chip ${a.status}">${{ checked_in: "✓ حضر", confirmed: "مؤكد", waitlist: "انتظار" }[a.status]}</span></div>`).join("") || '<p class="muted">لا حجوزات بعد</p>'}`); });
    $("#ev-scan")?.addEventListener("click", () => scanner(id));
  }
  async function scanner(eid) {
    sheet(`<h4 class="u-mt0">${ic("camera", "sm")} تسجيل الحضور</h4><div class="scan-box"><video id="sc-v" playsinline muted></video><div class="scan-frame"></div></div><div id="sc-res" class="scan-res" aria-live="assertive"></div><div class="u-g6 u-mt8 row"><input id="sc-code" placeholder="أو أدخل رمز التذكرة" dir="ltr" class="grow" autocomplete="off"><button class="btn" id="sc-go">تحقق</button></div>`);
    const res = $("#sc-res"); let stream = null, stop = false, last = "";
    const check = async (code) => { if (!code || code === last) return; last = code; try { const r = await api("POST", `/api/events/${eid}/checkin`, { code }); res.className = "scan-res " + (r.already ? "warn" : "ok"); res.textContent = r.already ? `${r.attendee.name} سجّل حضوره مسبقاً` : `✓ أهلاً ${r.attendee.name}`; navigator.vibrate?.(r.already ? [60, 60, 60] : 120); } catch (e) { res.className = "scan-res bad"; res.textContent = "✗ " + e.message; navigator.vibrate?.([200]); } setTimeout(() => { last = ""; }, 2500); };
    $("#sc-go").onclick = () => check($("#sc-code").value.trim());
    $("#sc-code").onkeydown = (e) => { if (e.key === "Enter") check(e.target.value.trim()); };
    if ("BarcodeDetector" in window) {
      try {
        const det = new BarcodeDetector({ formats: ["qr_code"] }); stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const v = $("#sc-v"); v.srcObject = stream; await v.play();
        const loop = async () => { if (stop || !document.body.contains(v)) { stream.getTracks().forEach(t => t.stop()); return; } try { const codes = await det.detect(v); if (codes[0]) await check(codes[0].rawValue); } catch { } setTimeout(loop, 300); }; loop();
      } catch { $(".scan-box").innerHTML = `<p class="muted">لا يمكن فتح الكاميرا. أدخل الرمز يدوياً.</p>`; }
    } else $(".scan-box").innerHTML = `<p class="muted">متصفحك لا يدعم قراءة QR. أدخل الرمز المطبوع تحت الرمز.</p>`;
    $("#sheet")._onclose = () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
  }

  /* =================== Settings & health =================== */
  /* v2.57: the old #/cset screen. Identity, joining and tags moved into the admin panel (#/cadmin, «عام والهوية» and
   * «الخصوصية والعضوية»); channels, partners, challenges and invite links live on here, hosted by the panel's
   * «القنوات والنمو» section (host = the panel's content element). #/cset/:id redirects to the panel. */
  /* =================== Directory, suggestions, invite landing =================== */
  const _communities = Views.communities;
  Views.communities = async function () {
    if (!online()) return _communities.apply(this, arguments);
    const cat = view._dcat || "", sort = view._dsort || "active", q = view._dq || "";
    view.innerHTML = `<div class="wrap">${UI.pageHead({ title: "المجتمعات", sub: "مساحات حول اهتماماتك، بقواعدها ومشرفيها.", row: true, actions: `<button class="btn" id="newc">${ic("plus", "xs")} إنشاء</button>` })}
      <input id="d-q" type="search" placeholder="ابحث عن مجتمع" value="${esc(q)}" aria-label="بحث">
      <div id="d-mine"></div><div id="d-sug"></div><div id="d-cats" class="u-my10 chips"></div>
      <div class="row"><h4 class="grow">الدليل</h4><select id="d-sort" class="u-wa" aria-label="ترتيب الدليل"><option value="active">الأنشط</option><option value="members">الأكبر</option><option value="new">الأحدث</option></select></div><div id="d-list" class="dir-grid"><div class="skel"></div></div></div>`;
    $("#d-sort").value = sort;
    _communities.toString && ($("#newc").onclick = () => { _communities.apply(this); setTimeout(() => $("#newc")?.click(), 0); });
    let t = 0; $("#d-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { view._dq = e.target.value.trim(); Views.communities(); }, 350); };
    $("#d-sort").onchange = (e) => { view._dsort = e.target.value; Views.communities(); };
    const mine = DB.communities.filter(c => S.membership(c.id) && !["pending", "banned"].includes(S.membership(c.id).role));
    if (mine.length && !q) $("#d-mine").innerHTML = `<h4>مجتمعاتي</h4><div class="mine-row">${mine.map(c => `<a href="#/c/${c.id}" class="mine-c"><span class="c-mini" style="background:${c.accent || c.color}">${esc(c.icon || c.name[0])}</span><span class="mine-n">${esc(c.name)}</span></a>`).join("")}</div>`;
    const dirList = $("#d-list");
    const [dir, sug] = await Promise.all([api("GET", `/api/communities/directory?sort=${sort}${cat ? "&category=" + cat : ""}${q ? "&q=" + encodeURIComponent(q) : ""}`), q ? { suggestions: [] } : api("GET", "/api/communities/suggested").catch(() => ({ suggestions: [] }))]);
    if (!dirList.isConnected) return; // stale-route guard: the member left (or the directory re-rendered) while this loaded
    if (sug.suggestions.length) $("#d-sug").innerHTML = `<h3 class="sh4">${ic("sparkle", "sm")} مقترحة لك</h3><div class="sug-row">${sug.suggestions.map(s => `<a class="card sug-c" href="#/c/${s.id}" style="--cc:${s.color}"><span class="sug-band" aria-hidden="true"></span><span class="c-mini" style="background:${s.color}">${esc(s.icon || s.name[0])}</span><b>${esc(s.name)}</b><small class="sug-why">${ic("sparkle", "xs")}${esc(s.reasons[0])}</small><small class="muted">${ic("users", "xs")} ${fmtN(s.members)} عضو</small></a>`).join("")}</div>`;
    $("#d-cats").innerHTML = `<button class="tab ${!cat ? "on" : ""}" data-cat="">الكل</button>${dir.categories.map(c => `<button class="tab ${cat === c.slug ? "on" : ""}" data-cat="${c.slug}">${esc(c.name)} <small>${c.count}</small></button>`).join("")}`;
    view.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { view._dcat = b.dataset.cat; Views.communities(); });
    $("#d-list").innerHTML = dir.communities.map(c => { const m = S.membership(c.id), joined = m && !["pending", "banned"].includes(m.role), catN = dir.categories.find(k => k.slug === c.category)?.name;
      /* v2.53 community card: colour band with a soft pattern, the icon tile overlapping it, type badge, title, two-line description, then a meta footer (members · activity) and the member state */
      return `<a class="card dir-c" href="#/c/${c.id}" style="--cc:${c.color}"><div class="dir-cv" aria-hidden="true"><span class="dir-type">${ic(c.type === "private" ? "lock" : "globe", "xs")}${c.type === "private" ? "خاص" : "عام"}</span></div>
        <div class="dir-id"><span class="c-mini" style="background:${c.accent || c.color}">${esc(c.icon || c.name[0])}</span>${joined ? `<span class="dir-state on">${ic("check", "xs")}عضو</span>` : m?.role === "pending" ? `<span class="dir-state">بانتظار الموافقة</span>` : `<span class="dir-state">${ic("plus", "xs")}انضم</span>`}</div>
        <b class="dir-n">${esc(c.name)}</b>${catN ? `<small class="dir-cat">${esc(catN)}</small>` : ""}<p class="dir-d">${esc(c.desc || "مجتمع جديد ينتظر أول مشاركاتك.")}</p>
        <div class="dir-f"><span>${ic("users", "xs")}${fmtN(c.members)} عضو</span><span class="${c.postsTwoWeeks ? "live" : ""}">${ic("trendUp", "xs")}${UI.num(c.postsTwoWeeks)} منشوراً/أسبوعين</span></div></a>`; }).join("") || '<div class="empty">لا مجتمعات مطابقة</div>';
  };
  async function joinLanding(code) {
    view.innerHTML = `<div class="wrap"><div class="skel" style="height:240px"></div></div>`;
    let inv; try { inv = (await api("GET", "/api/invites/" + code)).invite; } catch (e) { view.innerHTML = `<div class="wrap"><div class="empty">${esc(e.message)}</div></div>`; return; }
    const c = inv.community;
    view.innerHTML = `<div class="wrap"><div class="card join-land"><div class="dir-cv" style="background:${c.color};height:110px"></div><span class="c-mini lg">${esc(c.icon || c.name[0])}</span><h2>${esc(c.name)}</h2>${inv.inviter ? `<p class="muted">${esc(inv.inviter.name)} يدعوك للانضمام</p>` : ""}<p>${esc(c.desc || "")}</p><p class="muted">${fmtN(inv.members)} عضو</p><button class="btn block" id="jl-go">انضم الآن</button></div></div>`;
    $("#jl-go").onclick = async () => { state[c.id] = await api("GET", `/api/communities/${c.id}/space`); if (state[c.id].role && state[c.id].role !== "pending") { location.hash = "#/c/" + c.id; return; } joinFlow(c.id, code); };
  }

  /* =================== wiring =================== */
  /* v2.57: the old settings, moderation and health screens open their section of the admin panel (#/cadmin/:id?s=…) —
   * every old link keeps working; the screens themselves are hosted inside the panel */
  const toPanel = (cid, s) => { const c = String(cid || "").split("?")[0]; location.replace(`#/cadmin/${c}${s ? "?s=" + s : ""}`); };
  MPRoutes.extend((a, b) => ({ cmod: () => toPanel(a, "moderation"), cset: () => toPanel(a, "general"), chealth: () => toPanel(a, "health"), wiki: () => wikiView(a, decodeURIComponent((b || "new").split("?")[0])), join: () => joinLanding(a), events: () => eventsView(), event: () => online() ? eventPage(a) : (window.V12 ? V12.event(a) : _event(a)) }));
  window.MPCommunities = { communityPage, eventPage, modView, wikiView, invitesSheet, memberSheet, ROLE_AR, ask: actSheet, MUTE_CHOICES, qrSvg, eventCreate }; // v2.60: + qrSvg (invite QR in the panel), eventCreate (events section) // v2.59: ask = the unified action sheet // v2.58: growthPanel + healthView moved into the cadmin chunk (only the panel hosts them)
})();
