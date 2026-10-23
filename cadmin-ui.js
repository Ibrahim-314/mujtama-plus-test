/* =====================================================================
 * مجتمع بلس — v2.57 community admin panel «لوحة الإدارة» (#/cadmin, lazy chunk "cadmin" + cadmin.css,
 * loaded after the communities chunk). «المجتمع 3.0» stage 2/5.
 *  • #/cadmin               the communities I manage («مجتمعاتي التي أديرها»), incoming ownership transfers.
 *  • #/cadmin/:id           the panel home: status, what needs attention, setup checklist, recent log; on phones the
 *                           section list follows (52 px rows); on desktop (≥1180) the sections sit in a side list.
 *  • #/cadmin/:id?s=<key>   one section per page: general · privacy · members · roles · channels · moderation · automod · health · danger.
 *  • v2.60: insights (&d=7|30|90), events, integrations (bots, webhooks, study/courses/market, Pi OFF, MJT rewards), growth
 *    rebuilt (invite links with QR + revoke, partner search, challenges list) and the new-member notification default.
 *  • v2.59: moderation v2 (queue + claims/assign/bulk, appeals, saved replies, log, alerts; &t=<tab>) and automod v2 (own
 *    section); #/cappeal/:id is a member's decisions + appeal page; all confirmations use MPCommunities.ask.
 *    The old screens open their section: #/cset → general, #/cmod → moderation, #/chealth → health (community-ui.js).
 *  • Forms keep a draft: «تغييرات غير محفوظة: تجاهل / حفظ» bar; leaving through a link while dirty is held (the bar
 *    shakes); leaving any other way keeps the draft until you come back.
 *  • What a role cannot change is shown, locked, with one line on who can («للمالك» / «للمالك والمديرين»).
 * No inline handlers (CSP): delegated [data-ca] clicks + listeners. Icons: Lucide geometry in the sprite. No emoji.
 * ===================================================================== */
(function CommunityAdmin() {
  const ic = (n, c = "") => UI.icon(n, c);
  const api = (...a) => Remote.api(...a);
  /* i18n for strings with variables: the Arabic source keeps {placeholders} so the en catalogue can reorder them; Arabic output is unchanged */
  const trI = (s) => (window.MPI18n?.t ? window.MPI18n.t(s) : s);
  const Tf = (s, v = {}) => trI(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k] ?? "") : m));
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (n) => UI.num(n);
  const loc = () => { const l = document.documentElement.lang; return l && l !== "ar" ? l : "ar"; }; // dates follow the interface language
  const when = (t) => { try { return new Date(t).toLocaleDateString(loc(), { day: "numeric", month: "long", year: "numeric", numberingSystem: "latn" }); } catch { return ""; } };
  const rel = (t) => (typeof relTime === "function" ? relTime(t) : when(t));
  const tr = (s) => (window.MPI18n ? window.MPI18n.t(s) : s); // strings built with variables (the DOM translator keys on the whole text)
  const ROLE = { owner: "المالك", admin: "مدير", moderator: "مشرف", member: "عضو", muted: "مكتوم", pending: "بانتظار الموافقة", banned: "محظور" };

  /* ---------- sprite: panel icons (Lucide geometry, 24 grid) ---------- */
  const P = {
    dash: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
    uplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    ucheck: '<path d="m16 11 2 2 4-4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    ux: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/>',
    octPause: '<path d="M10 15V9"/><path d="M14 15V9"/><path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/>',
    arrowDn: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    listChk: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
    infoC: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    webhook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>'
  };
  const sprite = document.querySelector("body > svg[aria-hidden]");
  if (sprite) sprite.insertAdjacentHTML("beforeend", Object.entries(P).filter(([k]) => !document.getElementById("i-" + k)).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${v}</symbol>`).join(""));

  /* ---------- sections: [key, title, icon, line, group, permission test] ---------- */
  const any = (...k) => (keys) => k.some((x) => keys.includes(x));
  const SECTIONS = [
    { k: "home", t: "الرئيسية", i: "dash", sub: "الحالة وما يحتاج انتباهك", g: 0, can: () => true },
    { k: "general", t: "عام والهوية", i: "palette", sub: "الاسم والغلاف والوسوم وقواعد النشر", g: 0, can: any("edit_identity", "edit_settings"), lock: "للمالك والمديرين" },
    { k: "privacy", t: "الخصوصية والعضوية", i: "lock", sub: "النوع والقواعد والطلبات والدعوات", g: 0, can: any("approve_requests", "invite", "edit_identity", "edit_settings"), lock: "لمن يقبل الطلبات" },
    { k: "members", t: "الأعضاء", i: "users", sub: "بحث وفلترة وأدوار وعقوبات", g: 1, can: any("queue_review", "manage_roles") },
    { k: "roles", t: "الأدوار والصلاحيات", i: "key", sub: "رتب المجتمع وأدوار مخصّصة", g: 1, can: any("manage_roles"), lock: "للمالك والمديرين" },
    { k: "rules", t: "القواعد والترحيب", i: "sparkle", sub: "قواعد منظّمة ورسالة الترحيب وخطوات البداية", g: 0, can: any("edit_rules", "edit_identity"), lock: "للمالك والمديرين" },
    { k: "channels", t: "القنوات والتصنيفات", i: "hash", sub: "التصنيفات والترتيب والأرشفة والوضع البطيء", g: 2, can: any("manage_channels"), lock: "للمالك والمديرين" },
    { k: "content", t: "المحتوى والتثبيت والإعلانات", i: "pin", sub: "الأنواع المسموحة والمثبّتات وشريط الإعلان", g: 2, can: any("pin", "announce", "edit_settings") },
    { k: "knowledge", t: "قاعدة المعرفة", i: "book", sub: "أقسام الويكي والقفل والأسئلة الشائعة", g: 2, can: any("wiki_lock", "faq_edit") },
    { k: "events", t: "الفعاليات", i: "cal", sub: "القادمة والسابقة والحضور وتقويم المجتمع", g: 2, can: any("queue_review") },
    { k: "moderation", t: "الإشراف", i: "shield", sub: "الطابور والاستئنافات والقوالب والسجل", g: 2, can: any("queue_review") },
    { k: "automod", t: "الإشراف الآلي", i: "bot", sub: "القواعد والإعدادات الجاهزة والتجربة والإحصاءات", g: 2, can: any("view_automod"), lock: "لمن يرى القواعد الآلية" },
    { k: "insights", t: "التحليلات والرؤى", i: "trendUp", sub: "النمو والتفاعل والنشطون وأفضل وقت للنشر", g: 3, can: any("view_analytics"), lock: "لفريق الإشراف" },
    { k: "growth", t: "النمو والشراكات", i: "handshake", sub: "روابط الدعوة وQR والشراكات والتحديات", g: 3, can: any("manage_integrations", "manage_challenges", "invite"), lock: "للمالك والمديرين" },
    { k: "integrations", t: "التكاملات", i: "plug", sub: "البوتات وWebhooks والدراسة والسوق ومجتمع كوين وميزات Pi", g: 3, can: any("manage_integrations", "view_analytics"), lock: "للمالك والمديرين" },
    { k: "health", t: "صحة المجتمع", i: "chart", sub: "النشاط والبقاء والتوصيات", g: 3, can: any("view_health"), lock: "للمالك والمديرين" },
    { k: "danger", t: "منطقة الخطر", i: "alert", sub: "نقل الملكية والأرشفة والتصدير والإيقاف", g: 3, can: any("manage_automod", "edit_settings"), lock: "للمالك والمديرين" }
  ];
  const GROUPS = ["الإدارة", "الناس", "المحتوى والإشراف", "النمو والمتقدم"];
  const sec = (k) => SECTIONS.find((s) => s.k === k) || SECTIONS[0];

  /* ---------- state ---------- */
  const st = { cid: null, data: null, s: "home", dirty: null, drafts: {}, saving: false };
  const hashParts = () => { const [p, q] = location.hash.replace(/^#\/?/, "").split("?"); return { seg: p.split("/"), q: new URLSearchParams(q || "") }; };
  const href = (cid, s, extra = "") => `#/cadmin/${cid}${s && s !== "home" ? "?s=" + s + extra : ""}`;
  const keys = () => (st.data ? st.data.keys : []);
  const has = (k) => keys().includes(k);
  const isOwner = () => st.data?.role === "owner";

  /* ---------- small components ---------- */
  const sw = (k, title, sub, on, dis) => `<label class="switch-row ca-sw"><span><b>${h(title)}</b>${sub ? `<small>${h(sub)}</small>` : ""}</span><input type="checkbox" class="switch" role="switch" data-k="${k}" ${on ? "checked" : ""} ${dis ? "disabled" : ""} aria-label="${h(tr(title))}"></label>`;
  const lockNote = (t) => `<p class="ca-lock">${ic("lock", "xs")}<span>${h(t)}</span></p>`;
  /* v2.63.1: log lines keep label / reason / time as separate text nodes (the DOM translator keys whole nodes); the auto-guard
   * reason's fixed phrase is translated, its masked words are not */
  const agReason = (r) => { const m = /^(الحارس التلقائي: عبارة ممنوعة)(?: \((.*)\))?$/.exec(String(r)); return m ? `<span>${m[1]}</span>${m[2] ? ` (<bdi data-noi18n>${h(m[2])}</bdi>)` : ""}` : `<span>${h(r)}</span>`; };
  const card = (title, icon, body, { id = "", lock = "", sub = "", act = "" } = {}) => `<section class="card ca-card${lock ? " is-locked" : ""}"${id ? ` id="${id}"` : ""}><header class="ca-ch"><span class="ca-ci">${ic(icon, "sm")}</span><div class="grow"><h3>${h(title)}</h3>${sub ? `<p>${h(sub)}</p>` : ""}</div>${act}</header>${lock ? lockNote(lock) : ""}${body}</section>`;
  const badge = (t, tone = "") => `<span class="ca-badge ${tone}">${h(t)}</span>`;
  const avatar = (u) => (typeof av === "function" ? av(u, "sm").replace(/^<a\b/, '<span aria-hidden="true"').replace(/ href="[^"]*"/, "").replace(/<\/a>$/, "</span>") : "");
  const busy = (el, on) => { if (!el) return; el.disabled = on; el.setAttribute("aria-busy", on ? "true" : "false"); };
  /* a confirmation sheet instead of confirm(); optional typed confirmation */
  /* v2.59: the panel uses the ONE action sheet of the community module (community-ui.js) — same options, plus choices,
   * saved replies, required input; resolves { ok, text, choice } or null */
  const ask = (o) => MPCommunities.ask({ idp: "ca-ask", ...o });
  const errBox = (e, retry) => `<div class="empty err" role="alert"><span class="empty-t">${ic("offline", "sm")} تعذّر التحميل</span><span class="empty-x">${h(e?.message || "حدث خطأ")}</span>${retry ? `<button type="button" class="btn ghost sm" data-ca="retry">إعادة المحاولة</button>` : ""}</div>`;

  /* ======================= index: communities I manage ======================= */
  async function indexView() {
    view.innerHTML = `<div class="wrap ca-index">${UI.pageHead({ title: "مجتمعاتي التي أديرها", icon: "dash", sub: "لوحة إدارة لكل مجتمع تملكه أو تشرف عليه." })}<div class="skel"></div></div>`;
    let r; try { r = await api("GET", "/api/me/communities/managed"); } catch (e) { view.querySelector(".skel")?.replaceWith(Object.assign(document.createElement("div"), { innerHTML: errBox(e, true) })); return; }
    const w = view.querySelector(".ca-index"); if (!w) return;
    const tr = r.transfers.map((t) => `<a class="card ca-alert" href="#/cadmin/${h(t.community.id)}">${ic("crown", "sm")}<div class="grow"><b>طلب نقل ملكية «${h(t.community.name)}» إليك</b><small>من ${h(t.from || "المالك")} · ينتهي ${h(rel(t.expiresAt))}</small></div><span class="chev" aria-hidden="true">←</span></a>`).join("");
    const rows = r.communities.map((c) => `<a class="li ca-crow" href="#/cadmin/${h(c.id)}"><span class="ca-tile" data-c="${h(c.accent || "")}" data-g="${h(c.color || "")}">${h(c.icon || (c.name || "?")[0])}</span><span class="t"><b>${h(c.name)}</b><small>${h(c.roleLabel)} · الأعضاء: ${num(c.members)}${c.archivedAt ? " · مؤرشف" : ""}</small></span>${c.pending + c.queued ? `<span class="ca-count" aria-label="${num(c.pending + c.queued)} بانتظار المراجعة">${num(c.pending + c.queued)}</span>` : ""}<span class="chev" aria-hidden="true">←</span></a>`).join("");
    w.querySelector(".skel").outerHTML = tr + (rows ? `<div class="list">${rows}</div>` : UI.empty({ title: "لا تدير أي مجتمع بعد", text: "أنشئ مجتمعاً أو اطلب من مالك مجتمع أن يعيّنك مشرفاً.", action: `<a class="btn sm" href="#/communities">${ic("plus", "xs")} المجتمعات</a>` }));
    paintTiles(w);
  }
  /* colours come from data (accent / gradient) — set through CSSOM, no inline style attributes */
  function paintTiles(root) {
    root.querySelectorAll("[data-c],[data-g]").forEach((el) => { const c = el.dataset.c, g = el.dataset.g; if (c && /^#[0-9a-f]{6}$/i.test(c)) el.style.setProperty("--tile", c); else if (g && /^linear-gradient\(/.test(g)) el.style.setProperty("--tile", g); });
    root.querySelectorAll("[data-sw]").forEach((el) => { if (/^#[0-9a-f]{6}$/i.test(el.dataset.sw)) el.style.setProperty("--sw", el.dataset.sw); });
    root.querySelectorAll("[data-cover]").forEach((el) => { const v = el.dataset.cover; if (/^\/media\/[\w.-]+$/.test(v)) el.style.setProperty("--cv", `url('${v}') center/cover no-repeat`); else if (/^linear-gradient\(/.test(v)) el.style.setProperty("--cv", v); else el.style.removeProperty("--cv"); });
  }

  /* ======================= panel shell ======================= */
  async function panel(cid) {
    const { q } = hashParts(); const s = sec(q.get("s") || "home").k;
    const sameC = st.cid === cid && st.data;
    if (st.dirty && (st.dirty.cid !== cid || st.dirty.s !== s)) { st.drafts[st.dirty.cid + ":" + st.dirty.s] = st.dirty; st.dirty = null; } // left another way: the draft waits
    st.cid = cid; st.s = s;
    if (!sameC) {
      view.innerHTML = `<div class="wrap ca"><div class="skel sm"></div><div class="skel"></div></div>`;
      try { // H3-06: ask whether this role may open the panel first, so a plain member never triggers a 403 + console error
        const acc = await api("GET", `/api/communities/${cid}/admin/access`); if (!acc?.allowed) throw Object.assign(new Error("forbidden"), { status: 403 });
        st.data = await api("GET", `/api/communities/${cid}/admin`); } catch (e) { view.innerHTML = `<div class="wrap">${UI.pageHead({ back: [`#/c/${h(cid)}`, "المجتمع"], title: "لوحة الإدارة", icon: "dash" })}${e.status === 403 ? UI.empty({ title: "اللوحة لفريق الإشراف", text: "تظهر لوحة الإدارة لمالك المجتمع ومديريه ومشرفيه.", action: `<a class="btn ghost sm" href="#/c/${h(cid)}">صفحة المجتمع</a>` }) : errBox(e, true)}</div>`; return; }
      if (st.cid !== cid) return;
    }
    render();
  }
  function navList(active) {
    const d = st.data, c = d.community;
    const groups = GROUPS.map((g, gi) => {
      const items = SECTIONS.filter((x) => x.g === gi).map((x) => { const ok = x.can(keys()); const cnt = x.k === "privacy" ? d.counts.requests : x.k === "moderation" ? d.counts.pendingPosts + d.counts.reports : 0;
        return `<a class="ca-nl${x.k === active ? " on" : ""}${ok ? "" : " locked"}" href="${href(st.cid, x.k)}" data-sec="${x.k}"${x.k === active ? ' aria-current="page"' : ""}>${ic(x.i, "sm")}<span>${h(x.t)}</span>${ok ? (cnt ? `<i class="ca-count">${num(cnt)}</i>` : "") : ic("lock", "xs")}</a>`; }).join("");
      return `<div class="ca-ng"><small>${h(g)}</small>${items}</div>`;
    }).join("");
    return `<nav class="ca-nav" aria-label="أقسام لوحة الإدارة"><a class="ca-nhead" href="#/c/${h(st.cid)}"><span class="ca-tile" data-c="${h(c.accent || "")}" data-g="${h(c.color || "")}">${h(c.icon || c.name[0])}</span><span><b>${h(c.name)}</b><small>${h(d.roleLabel || "")}</small></span></a>
      <input type="search" class="ca-q" id="ca-q" placeholder="${h(tr("ابحث في الإعدادات"))}" aria-label="${h(tr("ابحث في أقسام اللوحة"))}">${groups}</nav>`;
  }
  function render() {
    const d = st.data, s = sec(st.s), c = d.community, root = s.k === "home";
    document.body.classList.add("ca-wide");
    const head = root ? UI.pageHead({ back: [`#/c/${st.cid}`, c.name], title: "لوحة الإدارة", icon: "dash", sub: c.name })
      : UI.pageHead({ back: [href(st.cid, "home"), "لوحة الإدارة"], title: s.t, icon: s.i, sub: c.name });
    const flags = `${c.archivedAt ? `<div class="notice warn ca-flag">${ic("archive", "sm")}<span>المجتمع مؤرشف: للقراءة فقط${isOwner() ? ". يمكنك استعادته من «منطقة الخطر»." : "."}</span></div>` : ""}${c.lockdownUntil ? `<div class="notice danger ca-flag">${ic("octPause", "sm")}<span>النشر متوقف مؤقتاً حتى ${h(new Date(c.lockdownUntil).toLocaleString(loc(), { numberingSystem: "latn", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }))}</span></div>` : ""}`;
    const strip = root ? "" : `<div class="ca-strip" role="navigation" aria-label="الأقسام">${SECTIONS.filter((x) => x.can(keys())).map((x) => `<a class="ca-chip${x.k === s.k ? " on" : ""}" href="${href(st.cid, x.k)}"${x.k === s.k ? ' aria-current="page"' : ""}>${ic(x.i, "xs")}${h(x.t)}</a>`).join("")}</div>`;
    view.innerHTML = `<div class="wrap ca" data-sec="${s.k}">${navList(s.k)}${head}${flags}${strip}<div id="ca-body" class="ca-body"></div><div class="ca-save" id="ca-save" hidden role="region" aria-label="تغييرات غير محفوظة"><span>${ic("infoC", "sm")} لديك تغييرات غير محفوظة</span><button type="button" class="btn ghost sm" data-ca="discard">تجاهل</button><button type="button" class="btn sm" data-ca="save">حفظ التغييرات</button></div></div>`;
    paintTiles(view);
    wireNavSearch();
    const body = document.getElementById("ca-body");
    if (!s.can(keys())) { body.innerHTML = card(s.t, "lock", `<p class="muted">هذا القسم ${h(s.lock || "لفريق الإدارة")}. اطلب من مالك المجتمع إن احتجت تغييراً هنا.</p>`, { lock: s.lock }); return; }
    const fn = { home: secHome, general: secGeneral, privacy: secPrivacy, rules: secRules, members: secMembers, roles: secRoles, channels: secChannels, content: secContent, knowledge: secKnowledge, moderation: secModeration, automod: secAutomod, growth: secGrowth, health: secHealth, danger: secDanger, insights: secInsights, events: secEvents, integrations: secIntegrations }[s.k];
    Promise.resolve(fn(body)).then(() => autoDir(body)).catch((e) => { body.innerHTML = errBox(e, true); });
  }
  /* v2.61.1: free-text fields follow their own content direction (Arabic in an English UI and vice versa); fields that set
   * dir themselves (ids, URLs, amounts → ltr) are left alone. Rows/sheets added later get it on first focus. */
  const TXT = 'textarea:not([dir]), input:not([dir]):not([type]), input:not([dir])[type="text"], input:not([dir])[type="search"]';
  function autoDir(root) { root?.querySelectorAll?.(TXT).forEach((el) => el.setAttribute("dir", "auto")); }
  document.addEventListener("focusin", (e) => { const t = e.target; if (t?.matches?.(TXT) && t.closest("#ca-body, .sheet, [role=dialog]")) t.setAttribute("dir", "auto"); });
  function wireNavSearch() {
    const q = document.getElementById("ca-q"); if (!q) return;
    const norm = (t) => String(t || "").replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();
    q.oninput = () => { const v = norm(q.value.trim()); view.querySelectorAll(".ca-nl").forEach((a) => { const x = sec(a.dataset.sec); a.hidden = !!v && !norm(x.t + " " + x.sub).includes(v); }); };
  }

  /* ======================= dirty tracking (forms) ======================= */
  function collect(root) {
    const o = {};
    root.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (el.type === "checkbox") o[k] = el.checked;
      else if (el.type === "radio") { if (el.checked) o[k] = el.value; }
      else o[k] = el.value;
    });
    root.querySelectorAll("[data-list]").forEach((el) => { o[el.dataset.list] = [...el.querySelectorAll(".ca-li input, .ca-li textarea")].map((i) => i.value.trim()).filter(Boolean); });
    root.querySelectorAll("[data-tags]").forEach((el) => { o[el.dataset.tags] = [...el.querySelectorAll(".ca-tag")].map((t) => ({ name: t.dataset.name, color: t.dataset.color, slug: t.dataset.slug || undefined })); });
    root.querySelectorAll("[data-rules]").forEach((el) => { o.rules = el._get ? el._get() : []; }); // v2.58: structured rules
    return o;
  }
  /** a form: initial values, a saver; restores a draft left behind */
  function form(root, saver, { isNew = false } = {}) {
    const init = isNew ? "" : JSON.stringify(collect(root)); const key = st.cid + ":" + st.s;
    const draft = st.drafts[key]; delete st.drafts[key];
    const bar = document.getElementById("ca-save");
    const update = () => { const now = JSON.stringify(collect(root)); const dirty = now !== init; st.dirty = dirty ? { cid: st.cid, s: st.s, values: now, root, saver, init } : null; bar.hidden = !dirty; document.body.classList.toggle("ca-dirty", dirty); };
    root.addEventListener("input", update); root.addEventListener("change", update);
    root._caUpdate = update; root._caInit = init;
    if (draft && draft.values !== init) { applyValues(root, JSON.parse(draft.values)); toast("استعدنا تغييراتك غير المحفوظة"); }
    if (isNew || draft) update();
    return update;
  }
  function applyValues(root, v) {
    root.querySelectorAll("[data-k]").forEach((el) => { const k = el.dataset.k; if (!(k in v)) return; if (el.type === "checkbox") el.checked = !!v[k]; else if (el.type === "radio") el.checked = el.value === v[k]; else el.value = v[k]; el.dispatchEvent(new Event("ca-sync")); });
    root.querySelectorAll("[data-list]").forEach((el) => { const arr = v[el.dataset.list]; if (Array.isArray(arr) && el._set) el._set(arr); });
    root.querySelectorAll("[data-tags]").forEach((el) => { const arr = v[el.dataset.tags]; if (Array.isArray(arr) && el._set) el._set(arr); });
    root.querySelectorAll("[data-rules]").forEach((el) => { if (Array.isArray(v.rules) && el._set) el._set(v.rules); });
    root._caPreview?.();
  }
  async function doSave() {
    const d = st.dirty; if (!d || st.saving) return;
    const btn = view.querySelector('[data-ca="save"]'); st.saving = true; busy(btn, true);
    try { const ok = await d.saver(JSON.parse(d.values), d.init ? JSON.parse(d.init) : {}); if (ok === false) return; st.dirty = null; document.body.classList.remove("ca-dirty"); toast("✓ حُفظت التغييرات"); st.data = await api("GET", `/api/communities/${st.cid}/admin`).catch(() => st.data); render(); }
    catch (e) { toast(e.message || "تعذّر الحفظ"); }
    finally { st.saving = false; busy(btn, false); }
  }
  function doDiscard() { const d = st.dirty; if (!d) return; if (!d.init) { st.dirty = null; document.body.classList.remove("ca-dirty"); location.hash = href(st.cid, st.s); return; } applyValues(d.root, JSON.parse(d.init)); d.root._caUpdate?.(); st.dirty = null; document.getElementById("ca-save").hidden = true; document.body.classList.remove("ca-dirty"); }
  /* leaving through an in-app link while dirty: hold, shake the bar */
  document.addEventListener("click", (e) => {
    if (!st.dirty || !document.body.contains(st.dirty.root)) return;
    const a = e.target.closest('a[href^="#/"], #tbBack, .bottomnav a'); if (!a || a.closest("#ca-save") || a.closest("#sheet")) return;
    const to = a.getAttribute("href"); if (to && to === location.hash) return;
    e.preventDefault(); e.stopPropagation();
    const bar = document.getElementById("ca-save"); if (bar) { bar.classList.remove("shake"); void bar.offsetWidth; bar.classList.add("shake"); bar.querySelector('[data-ca="save"]')?.focus(); }
    toast("احفظ تغييراتك أو تجاهلها أولاً");
  }, true);
  addEventListener("beforeunload", (e) => { if (st.dirty && document.body.contains(st.dirty.root)) { e.preventDefault(); e.returnValue = ""; } });
  addEventListener("hashchange", () => { if (!/^#\/cadmin(\/|$|\?)/.test(location.hash)) { document.body.classList.remove("ca-wide", "ca-dirty"); if (st.dirty) { st.drafts[st.dirty.cid + ":" + st.dirty.s] = st.dirty; st.dirty = null; } } });

  /* delegated clicks inside the panel */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ca]"); if (!b || !view.contains(b)) return;
    const a = b.dataset.ca;
    if (a === "save") doSave(); else if (a === "discard") doDiscard();
    else if (a === "retry") { st.data = null; route(); }
  });

  /* ---------- list editor (rules, questions, steps): rows with ↑ ↓ ✕ ---------- */
  function listEditor(key, items, { max = 20, ph = "", long = false, label = "", dis = false } = {}) {
    return `<div class="ca-list" data-list="${key}" data-max="${max}" data-ph="${h(ph)}" data-long="${long ? 1 : 0}" data-label="${h(label)}" ${dis ? "data-dis=1" : ""}><ol class="ca-lis"></ol>${dis ? "" : `<button type="button" class="btn ghost sm ca-add">${ic("plus", "xs")} إضافة</button>`}</div>`;
  }
  function wireLists(root, init) {
    root.querySelectorAll("[data-list]").forEach((el) => {
      const ol = el.querySelector(".ca-lis"), max = +el.dataset.max, long = el.dataset.long === "1", dis = !!el.dataset.dis, lbl = el.dataset.label;
      const row = (v, i) => `<li class="ca-li"><span class="ca-n">${num(i + 1)}</span>${long ? `<textarea dir="auto" rows="2" aria-label="${h(tr(`${lbl} ${i + 1}`))}" placeholder="${h(tr(el.dataset.ph))}" maxlength="200" ${dis ? "disabled" : ""}>${h(v)}</textarea>` : `<input value="${h(v)}" aria-label="${h(tr(`${lbl} ${i + 1}`))}" placeholder="${h(tr(el.dataset.ph))}" maxlength="200" ${dis ? "disabled" : ""}>`}${dis ? "" : `<span class="ca-lia"><button type="button" class="btn ghost icon" data-mv="-1" aria-label="أعلى">${ic("arrowUp", "xs")}</button><button type="button" class="btn ghost icon" data-mv="1" aria-label="أسفل">${ic("arrowDn", "xs")}</button><button type="button" class="btn ghost icon" data-rm aria-label="حذف">${ic("x", "xs")}</button></span>`}</li>`;
      const set = (arr) => { ol.innerHTML = arr.map(row).join(""); const add = el.querySelector(".ca-add"); if (add) add.disabled = arr.length >= max; };
      const vals = () => [...ol.querySelectorAll("input,textarea")].map((i) => i.value);
      el._set = set; set(init[el.dataset.list] || []);
      el.addEventListener("click", (e) => {
        const t = e.target.closest("button"); if (!t || dis) return;
        const v = vals(), li = t.closest(".ca-li"), i = li ? [...ol.children].indexOf(li) : -1;
        if (t.classList.contains("ca-add")) { if (v.length >= max) return; v.push(""); set(v); ol.lastElementChild?.querySelector("input,textarea")?.focus(); }
        else if (t.hasAttribute("data-rm")) { v.splice(i, 1); set(v); }
        else if (t.dataset.mv) { const j = i + +t.dataset.mv; if (j < 0 || j >= v.length) return; [v[i], v[j]] = [v[j], v[i]]; set(v); ol.children[j]?.querySelector(`[data-mv="${t.dataset.mv}"]`)?.focus(); }
        else return;
        root.dispatchEvent(new Event("change"));
      });
    });
  }

  /* ======================= 0. home ======================= */
  const LOGL = { settings_updated: "تعديل الإعدادات", identity_updated: "تعديل الهوية", automod_updated: "تعديل القواعد الآلية", channel_created: "قناة جديدة", channel_deleted: "حذف قناة", role_changed: "تغيير رتبة", role_saved: "حفظ دور", role_deleted: "حذف دور", role_granted: "منح دور", role_revoked: "سحب دور", join_approve: "قبول عضو", join_reject: "رفض طلب", warn: "إنذار", mute: "كتم", unmute: "رفع كتم", ban: "حظر", unban: "رفع حظر", approve: "قبول منشور", reject: "رفض منشور", remove: "حذف محتوى", dismiss: "تجاهل بلاغ", invite_created: "رابط دعوة", invite_revoked: "إلغاء رابط", member_invited: "دعوة عضو", transfer_requested: "طلب نقل ملكية", transfer_cancelled: "إلغاء نقل الملكية", transfer_accepted: "نقل الملكية", transfer_declined: "رفض نقل الملكية", archived: "أرشفة", restored: "استعادة", lockdown: "إيقاف النشر مؤقتاً", lockdown_lifted: "استئناف النشر", exported: "تصدير البيانات", note_deleted: "حذف ملاحظة", partner_accepted: "شراكة", automod_reject: "رفض آلي", automod_queue: "تحويل آلي", channel_updated: "تعديل قناة", channel_archived: "أرشفة قناة", channel_restored: "استعادة قناة", channels_reordered: "ترتيب القنوات", channel_group_created: "تصنيف جديد", channel_group_deleted: "حذف تصنيف", pinned: "تثبيت منشور", unpinned: "إلغاء تثبيت", announcement_created: "إعلان جديد", announcement_updated: "تعديل إعلان", announcement_deleted: "حذف إعلان", rules_updated: "تعديل القواعد", automod_flag: "بلاغ آلي", automod_penalty: "عقوبة آلية", appeal_accepted: "قبول استئناف", appeal_rejected: "رفض استئناف", assign: "إسناد عنصر", macro_saved: "حفظ قالب", macro_deleted: "حذف قالب" };
  async function secHome(body) {
    const d = st.data, c = d.community, n = d.counts, it = d.incomingTransfer;
    const kpi = [["الأعضاء", n.members, "users", n.joined30 ? `+${num(n.joined30)} خلال 30 يوماً` : "إجمالي الأعضاء"], ["النشطون", n.wau, "trendUp", "آخر 7 أيام"], ["المنشورات", n.posts7d, "comment", "آخر 7 أيام"], ["المراجعة", n.queue, "listChk", n.queue ? "عناصر بانتظارك" : "لا شيء معلّق"]];
    const attn = [
      n.requests && has("approve_requests") ? [href(st.cid, "privacy", "&a=requests"), "uplus", `${num(n.requests)} طلب انضمام بانتظارك`, "اقبل أو ارفض من «الخصوصية والعضوية»"] : null,
      n.pendingPosts ? [href(st.cid, "moderation"), "doc", `${num(n.pendingPosts)} منشور ينتظر الموافقة`, "طابور الإشراف"] : null,
      n.reports ? [href(st.cid, "moderation"), "flag", `${num(n.reports)} بلاغ مفتوح`, "راجعها في طابور الإشراف"] : null,
      n.sanctions && has("queue_review") ? [href(st.cid, "members", "&f=muted"), "volumeX", `${num(n.sanctions)} عقوبة نشطة`, "كتم أو حظر قائم"] : null,
      d.transfer && !it ? [href(st.cid, "danger"), "crown", "طلب نقل ملكية قائم", `إلى ${d.transfer.to.name || ""} · ينتهي ${rel(d.transfer.expiresAt)}`] : null
    ].filter(Boolean);
    const todo = d.setup.filter((x) => !x.done), done = d.setup.length - todo.length, pct = Math.round((done / d.setup.length) * 100);
    const ring = `<svg viewBox="0 0 44 44" class="ca-ring" aria-hidden="true"><circle cx="22" cy="22" r="18" class="bg"/><circle cx="22" cy="22" r="18" class="fg" stroke-dasharray="${(pct * 1.131).toFixed(1)} 200"/></svg>`;
    body.innerHTML = `${it ? `<section class="card ca-transfer-in" id="ca-tin"><header class="ca-ch"><span class="ca-ci">${ic("crown", "sm")}</span><div class="grow"><h3>طلب نقل ملكية إليك</h3><p>${h(it.from.name || "المالك")} يريد نقل ملكية «${h(c.name)}» إليك. ينتهي الطلب ${h(rel(it.expiresAt))}.</p></div></header><p class="muted">بالقبول تصبح المالك، ويصبح المالك الحالي مديراً. يُسجَّل ذلك في سجل المجتمع.</p><div class="ca-ask-acts"><button type="button" class="btn grow" id="ca-tacc">${ic("check", "xs")} قبول الملكية</button><button type="button" class="btn ghost grow" id="ca-tdec">رفض</button></div></section>` : ""}
      <section class="card ca-hero"><div class="ca-hero-top"><span class="ca-tile lg" data-c="${h(c.accent || "")}" data-g="${h(c.color || "")}">${h(c.icon || c.name[0])}</span><div class="grow"><h3>${h(c.name)}</h3><p class="ca-meta">${badge(c.type === "public" ? "عام" : c.type === "private" ? "خاص" : "بالدعوة")}${badge("أنت: " + (d.roleLabel || ""), "acc")}${c.archivedAt ? badge("مؤرشف", "warn") : ""}${c.lockdownUntil ? badge("النشر متوقف", "danger") : ""}</p></div><a class="btn ghost sm" href="#/c/${h(st.cid)}">${ic("eye", "xs")} صفحة المجتمع</a></div>
        <div class="kpi-grid ca-kpis">${kpi.map(([l, v, i, x]) => `<div class="kpi-tile ca-kpi"><span class="ca-kpi-l">${ic(i, "xs")}${h(l)}</span><b>${num(v)}</b><small>${h(x)}</small></div>`).join("")}</div></section>
      ${card("يحتاج انتباهك", "bell", attn.length ? `<div class="list flat">${attn.map(([a, i, t, s]) => UI.li({ href: a, icon: i, title: t, sub: s })).join("")}</div>` : `<p class="ca-ok">${ic("okCircle", "sm")} لا شيء ينتظرك الآن.</p>`, { id: "ca-attn" })}
      <div class="ca-mlist"><h3 class="set-h">الأقسام</h3><div class="list">${SECTIONS.filter((x) => x.k !== "home").map((x) => UI.li({ href: href(st.cid, x.k), icon: x.can(keys()) ? x.i : "lock", title: x.t, sub: x.can(keys()) ? x.sub : x.lock, attrs: x.k === "danger" ? "data-danger" : "" })).join("")}</div></div>
      ${card("إعداد المجتمع", "listChk", `<div class="ca-setup-h">${ring}<div><b>${num(pct)}%</b><small>${num(done)} من ${num(d.setup.length)} خطوات مكتملة</small></div></div>${todo.length ? `<div class="list flat">${todo.map((x) => UI.li({ href: x.href || href(st.cid, x.section), icon: "target", title: x.label, sub: "خطوة مقترحة" })).join("")}</div>` : `<p class="ca-ok">${ic("okCircle", "sm")} اكتمل إعداد المجتمع.</p>`}${done ? `<details class="ca-donel"><summary>${ic("check", "xs")} المكتمل (${num(done)})</summary><ul>${d.setup.filter((x) => x.done).map((x) => `<li>${ic("okCircle", "xs")}${h(x.label)}</li>`).join("")}</ul></details>` : ""}`, { id: "ca-setup" })}
      ${card("آخر الإجراءات", "clock", d.recent.length ? `<ul class="ca-log">${d.recent.map((r) => `<li><span class="ca-dot ${h(r.category || "")}" aria-hidden="true"></span><span class="grow"><b>${h(LOGL[r.action] || r.action)}</b><small>${h(r.actor || "النظام")}${r.target ? " ← " + h(r.target) : ""}${r.reason ? " · " + h(r.reason) : ""}</small></span><time>${h(rel(r.at))}</time></li>`).join("")}</ul>${has("export_log") ? `<a class="btn ghost sm" href="${href(st.cid, "moderation")}" id="ca-fulllog">السجل الكامل</a>` : ""}` : `<p class="muted">لا إجراءات بعد.</p>`)}
`;
    paintTiles(body);
    body.querySelector("#ca-fulllog")?.addEventListener("click", () => { view._mtab = "log"; });
    if (it) {
      body.querySelector("#ca-tacc").onclick = async (e) => { const r = await ask({ title: "قبول ملكية المجتمع؟", text: `تصبح مالك «${c.name}»، ويصبح المالك الحالي مديراً.`, ok: "قبول الملكية" }); if (!r) return; busy(e.target, true); try { await api("POST", `/api/community-transfers/${it.id}/accept`); toast("✓ أصبحت مالك المجتمع"); if (typeof refresh === "function") refresh(); st.data = null; panel(st.cid); } catch (er) { toast(er.message); busy(e.target, false); } };
      body.querySelector("#ca-tdec").onclick = async () => { const r = await ask({ title: "رفض طلب نقل الملكية؟", ok: "رفض الطلب", danger: true }); if (!r) return; try { await api("POST", `/api/community-transfers/${it.id}/decline`); toast("رُفض الطلب"); st.data = null; panel(st.cid); } catch (er) { toast(er.message); } };
    }
  }

  /* ======================= 1. general & identity ======================= */
  const PALETTE = ["#6d3cf4", "#9333ea", "#c026d3", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#0284c7", "#2563eb", "#475569"];
  const GRADS = ["linear-gradient(135deg,#5b2bd6,#c04cf0)", "linear-gradient(135deg,#0f766e,#22c55e)", "linear-gradient(135deg,#1d4ed8,#06b6d4)", "linear-gradient(135deg,#be123c,#f97316)", "linear-gradient(135deg,#334155,#64748b)", "linear-gradient(135deg,#7c3aed,#ec4899)"];
  /* v2.61.1: inline field error — aria-invalid, message linked through aria-describedby, focus moved to the field */
  function nameErr(root, msg) {
    const inp = root.querySelector("#ca-name"), e = root.querySelector("#ca-name-e"); if (!inp || !e) return;
    e.textContent = msg ? tr(msg) : ""; e.hidden = !msg;
    if (msg) { inp.setAttribute("aria-invalid", "true"); inp.setAttribute("aria-describedby", "ca-name-c ca-name-e"); inp.focus(); }
    else if (inp.getAttribute("aria-invalid")) { inp.removeAttribute("aria-invalid"); inp.setAttribute("aria-describedby", "ca-name-c"); }
  }
  async function secGeneral(body) {
    const [cs, sp] = await Promise.all([api("GET", `/api/communities/${st.cid}/settings`), api("GET", `/api/communities/${st.cid}/space`)]);
    const g = cs.sections.general?.values || {}, idn = sp.identity, c = sp.community;
    const own = has("edit_settings"), idEd = has("edit_identity");
    const tags = idn.tags || [];
    body.innerHTML = `<div id="ca-form" class="ca-form">
      ${card("الاسم والوصف", "pen", `<label class="field"><span class="lbl">اسم المجتمع</span><input data-k="name" id="ca-name" dir="auto" value="${h(c.name)}" maxlength="60" minlength="3" ${own ? "" : "disabled"} aria-describedby="ca-name-c"><span class="hint" id="ca-name-c" data-count="name">${num(c.name.length)} من 60</span><span class="ca-ferr" id="ca-name-e" role="alert" hidden></span></label>
        <label class="field"><span class="lbl">الوصف</span><textarea data-k="desc" dir="auto" maxlength="300" rows="3" ${own ? "" : "disabled"} aria-describedby="ca-desc-c">${h(c.desc || "")}</textarea><span class="hint" id="ca-desc-c" data-count="desc">${num((c.desc || "").length)} من 300</span></label>
        <div class="ca-2"><label class="field"><span class="lbl">الموقع (اختياري)</span><input data-k="location" dir="auto" value="${h(c.location || "")}" maxlength="60" placeholder="${h(tr("مثل: جدة"))}" ${own ? "" : "disabled"}></label>
        <label class="field"><span class="lbl">التصنيف في الدليل</span><select data-k="category" ${idEd ? "" : "disabled"}><option value="none" ${idn.category ? "" : "selected"}>بدون</option>${(typeof TOPICS !== "undefined" ? TOPICS : []).map((t) => `<option value="${h(t.slug)}" ${idn.category === t.slug ? "selected" : ""}>${h(t.name)}</option>`).join("")}</select></label></div>`, { lock: own ? "" : "الاسم والوصف والموقع للمالك فقط" })}
      ${card("المظهر", "palette", `<div class="ca-look"><div class="ca-prev" aria-hidden="true"><div class="ca-prev-cv" data-cover="${h(idn.cover || c.color || "")}"></div><span class="ca-tile lg ca-prev-ic" data-c="${h(idn.accent || "")}" data-g="${h(c.color || "")}">${h(idn.icon || c.name[0])}</span><b class="ca-prev-n">${h(c.name)}</b><small class="ca-prev-d">${h(c.desc || "مجتمع جديد ينتظر أول مشاركاتك.")}</small></div>
        <div class="ca-look-f"><label class="field"><span class="lbl">الأيقونة</span><input data-k="icon" dir="auto" value="${h(idn.icon || "")}" maxlength="4" class="ca-icon-in" placeholder="${h(tr("مثل: ن"))}" ${idEd ? "" : "disabled"}><span class="hint">حرف أو رمز تختاره، يظهر في بلاطة المجتمع.</span></label>
        <div class="field"><span class="lbl" id="ca-acc-l">اللون المميز</span><div class="ca-sws" role="radiogroup" aria-labelledby="ca-acc-l">${PALETTE.map((x) => `<button type="button" class="ca-swb" role="radio" data-sw="${x}" aria-checked="${(idn.accent || "") === x}" aria-label="${h(tr("لون"))} ${x}" ${idEd ? "" : "disabled"}></button>`).join("")}<label class="ca-swc">${ic("palette", "xs")}<input type="color" value="${h(idn.accent || "#6d3cf4")}" aria-label="${h(tr("لون مخصّص"))}" ${idEd ? "" : "disabled"}></label></div><input type="hidden" data-k="accent" value="${h(idn.accent || "")}"></div>
        <div class="field"><span class="lbl" id="ca-cv-l">الغلاف</span><div class="ca-covers" role="radiogroup" aria-labelledby="ca-cv-l">${GRADS.map((x, i) => `<button type="button" class="ca-cvb" role="radio" data-cover="${h(x)}" data-cv="${h(x)}" aria-checked="${idn.cover === x}" aria-label="تدرج ${i + 1}" ${idEd ? "" : "disabled"}></button>`).join("")}<label class="btn ghost sm ca-up">${ic("image", "xs")} رفع صورة<input type="file" accept="image/*" id="ca-cover-f" hidden ${idEd ? "" : "disabled"}></label></div><input type="hidden" data-k="cover" value="${h(idn.cover || "")}"></div></div></div>`, { lock: idEd ? "" : "المظهر للمالك والمديرين" })}
      ${card("وسوم المنشورات", "tag", `<p class="muted">يختار الأعضاء وسماً عند النشر، وتُفلتر بها صفحة المجتمع.</p><div class="ca-tags" data-tags="tags"><div class="ca-tagl"></div>${idEd ? `<div class="ca-tagadd"><input id="ca-tag-in" dir="auto" maxlength="30" placeholder="${h(tr("وسم جديد مثل: سؤال"))}" aria-label="${h(tr("وسم جديد"))}"><button type="button" class="btn ghost sm" id="ca-tag-add">${ic("plus", "xs")} إضافة</button></div>` : ""}</div>${sw("memberBadges", "شارات الأعضاء", "شارة «عضو جديد» في أسبوعه الأول، وشارة في أسبوع ذكرى انضمامه", idn.memberBadges !== false, !idEd)}`, { lock: idEd ? "" : "الوسوم للمالك والمديرين" })}
      ${card("النشر والمحتوى", "sliders", `<div class="field"><span class="lbl">من ينشر</span><div class="seg" role="radiogroup" aria-label="من ينشر"><label class="ca-seg"><input type="radio" name="ca-who" data-k="whoCanPost" value="members" ${g.whoCanPost !== "mods" ? "checked" : ""} ${own ? "" : "disabled"}><span>كل الأعضاء</span></label><label class="ca-seg"><input type="radio" name="ca-who" data-k="whoCanPost" value="mods" ${g.whoCanPost === "mods" ? "checked" : ""} ${own ? "" : "disabled"}><span>المشرفون فقط</span></label></div></div>
        ${sw("requireApproval", "موافقة على المنشورات", "منشورات الأعضاء تنتظر مراجعة المشرفين قبل الظهور", !!g.requireApproval, !own)}
        ${sw("allowLinks", "السماح بالروابط", "روابط المواقع داخل المنشورات", g.allowLinks !== false, !own)}
        ${sw("allowMedia", "السماح بالوسائط", "الصور والفيديو والصوت", g.allowMedia !== false, !own)}
        ${sw("allowCommercial", "السماح بالمحتوى التجاري", "إعلانات وعروض بيع من الأعضاء", !!g.allowCommercial, !own)}
        ${sw("aiModeration", "مساعد الإشراف الذكي", "ينبّه قبل نشر ما قد يخالف القواعد أو يكون تجارياً", !!g.aiModeration, !own)}`, { lock: own ? "" : "قواعد النشر للمالك فقط" })}
    </div>`;
    const root = body.querySelector("#ca-form");
    // tag chips
    const tagBox = root.querySelector("[data-tags]"), tl = tagBox.querySelector(".ca-tagl");
    const COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0d9488"];
    const setTags = (arr) => { tl.innerHTML = arr.map((t, i) => `<span class="ca-tag" data-name="${h(t.name)}" data-color="${h(t.color)}" data-slug="${h(t.slug || "")}" data-sw="${h(t.color)}"><i class="ca-tdot" aria-hidden="true"></i>${h(t.name)}${idEd ? `<button type="button" class="ca-tmv" data-tmv="-1" data-i="${i}" aria-label="تقديم ${h(t.name)}">${ic("arrowUp", "xs")}</button><button type="button" class="ca-trm" data-i="${i}" aria-label="حذف ${h(t.name)}">${ic("x", "xs")}</button>` : ""}</span>`).join("") || `<span class="muted">لا وسوم بعد</span>`; paintTiles(tl); };
    tagBox._set = setTags; setTags(tags);
    const curTags = () => collect(root).tags;
    tagBox.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const arr = curTags(), i = +b.dataset.i;
      if (b.classList.contains("ca-trm")) arr.splice(i, 1); else if (b.dataset.tmv && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; else if (b.id === "ca-tag-add") { const inp = root.querySelector("#ca-tag-in"), v = inp.value.trim(); if (!v) return; if (arr.length >= 20) return toast("الحد الأقصى 20 وسماً"); if (arr.some((t) => t.name === v)) return toast("الوسم موجود"); arr.push({ name: v, color: COLORS[arr.length % COLORS.length] }); inp.value = ""; } else return;
      setTags(arr); root.dispatchEvent(new Event("change")); });
    root.querySelector("#ca-tag-in")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); root.querySelector("#ca-tag-add").click(); } });
    // counters + live preview
    const preview = () => { const v = collect(root); root.querySelector('[data-count="name"]').textContent = `${num(v.name.length)} من 60`; root.querySelector('[data-count="desc"]').textContent = `${num(v.desc.length)} من 300`;
      root.querySelector(".ca-prev-n").textContent = v.name || c.name; root.querySelector(".ca-prev-d").textContent = v.desc || "مجتمع جديد ينتظر أول مشاركاتك."; const ico = root.querySelector(".ca-prev-ic"); ico.textContent = v.icon || (v.name || c.name)[0]; ico.dataset.c = v.accent || ""; ico.style.removeProperty("--tile");
      root.querySelector(".ca-prev-cv").dataset.cover = v.cover || c.color || ""; root.querySelectorAll(".ca-swb").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sw === v.accent))); root.querySelectorAll(".ca-cvb").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.cv === v.cover))); paintTiles(root); };
    root._caPreview = preview;
    root.addEventListener("input", preview); root.addEventListener("change", preview);
    const setHidden = (k, v) => { const i = root.querySelector(`[data-k="${k}"]`); i.value = v; root.dispatchEvent(new Event("change")); };
    root.querySelectorAll(".ca-swb").forEach((b) => (b.onclick = () => setHidden("accent", b.dataset.sw)));
    root.querySelector('.ca-swc input')?.addEventListener("change", (e) => setHidden("accent", e.target.value));
    root.querySelectorAll(".ca-cvb").forEach((b) => (b.onclick = () => setHidden("cover", b.dataset.cv)));
    root.querySelector("#ca-cover-f")?.addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { const m = (await api("POST", "/api/media", null, f)).media; setHidden("cover", m.url); } catch (er) { toast(er.message); } });
    paintTiles(root); preview();
    root.querySelector("#ca-name")?.addEventListener("input", () => nameErr(root, ""));
    form(root, async (v, o) => {
      const base = {}, gen = {}, idk = {};
      if (own) { if (v.name !== o.name) { if (v.name.trim().length < 3) { nameErr(root, "اسم المجتمع 3 أحرف على الأقل"); toast("اسم المجتمع 3 أحرف على الأقل"); return false; } base.name = v.name.trim(); } if (v.desc !== o.desc) base.desc = v.desc; if (v.location !== o.location) base.location = v.location; for (const k of ["whoCanPost", "requireApproval", "allowLinks", "allowMedia", "allowCommercial", "aiModeration"]) if (v[k] !== o[k]) gen[k] = v[k]; }
      if (idEd) for (const k of ["icon", "accent", "cover", "category"]) if (v[k] !== o[k]) idk[k] = v[k] || null; if (idEd && v.memberBadges !== o.memberBadges) idk.memberBadges = !!v.memberBadges;
      if (idEd && JSON.stringify(v.tags) !== JSON.stringify(o.tags)) idk.tags = v.tags;
      if (Object.keys(base).length || Object.keys(gen).length) await api("PATCH", `/api/communities/${st.cid}`, { ...base, ...gen });
      if (Object.keys(idk).length) await api("PATCH", `/api/communities/${st.cid}/identity`, idk);
      if (typeof refresh === "function") refresh();
    });
  }

  /* ======================= 2. privacy & membership ======================= */
  async function secPrivacy(body) {
    const [cs, sp] = await Promise.all([api("GET", `/api/communities/${st.cid}/settings`).catch(() => ({ sections: {} })), api("GET", `/api/communities/${st.cid}/space`)]);
    const c = sp.community, j = cs.sections.joining?.values || { rulesRequired: sp.identity.rulesRequired, joinQuestions: sp.identity.joinQuestions || [], welcome: sp.identity.welcome || null };
    const own = has("edit_settings"), idEd = has("edit_identity"), canReq = has("approve_requests"), canInv = has("invite");
    const TYPES = [["public", "globe", "عام", "يراه الجميع ويستطيع أي أحد الانضمام فوراً."], ["private", "lock", "خاص", "يظهر في الدليل، والانضمام بطلب يوافق عليه المشرفون."], ["invite", "mail", "بالدعوة فقط", "لا يظهر في الدليل، ويدخله المدعوون فقط."]];
    body.innerHTML = `<div id="ca-form" class="ca-form">
      ${card("نوع المجتمع", "globe", `<div class="ca-types" role="radiogroup" aria-label="نوع المجتمع">${TYPES.map(([k, i, t, s]) => `<label class="ca-type"><input type="radio" name="ca-type" data-k="type" value="${k}" ${c.type === k ? "checked" : ""} ${own ? "" : "disabled"}><span class="ca-type-b">${ic(i, "sm")}<b>${t}</b><small>${s}</small></span></label>`).join("")}</div>`, { lock: own ? "" : "تغيير النوع للمالك فقط" })}
      ${card("أسئلة طلب الانضمام", "help", `<p class="muted">تُسأل لمن يطلب الانضمام إلى مجتمع خاص، وتظهر إجاباته مع الطلب.</p>${listEditor("joinQuestions", null, { max: 5, ph: "مثل: لماذا تريد الانضمام؟", label: "السؤال", dis: !idEd })}`, { lock: idEd ? "" : "للمالك والمديرين" })}
      <div class="list ca-lnk">${UI.li({ href: href(st.cid, "rules"), icon: "sparkle", title: "القواعد والترحيب", sub: "قواعد منظّمة، رسالة الترحيب، خطوات البداية، القناة الافتراضية" })}</div>
    </div>
    ${canReq ? `<section class="card ca-card" id="requests"><header class="ca-ch"><span class="ca-ci">${ic("uplus", "sm")}</span><div class="grow"><h3>طلبات الانضمام</h3><p>القرارات تبقى في السجل: من قرّر، ومتى، ولماذا.</p></div></header><div class="seg" role="tablist" aria-label="الطلبات"><button type="button" class="on" role="tab" aria-selected="true" data-rq="pending">بانتظار القرار</button><button type="button" role="tab" aria-selected="false" data-rq="history">السجل</button></div><div id="ca-rq"><div class="skel sm"></div></div></section>` : ""}
    ${idEd ? `<section class="card ca-card" id="ca-ndef"><header class="ca-ch"><span class="ca-ci">${ic("bell", "sm")}</span><div class="grow"><h3>الإشعار الافتراضي للأعضاء الجدد</h3><p>ما يصل العضو من هذا المجتمع حين ينضم.</p></div></header><div class="ca-ndb"><div class="skel sm"></div></div></section>` : ""}
    ${canInv ? `<section class="card ca-card" id="invites"><header class="ca-ch"><span class="ca-ci">${ic("link", "sm")}</span><div class="grow"><h3>روابط الدعوة</h3><p>رابط بتسمية وحدّ ومدة، ويمكن إلغاؤه في أي وقت.</p></div><button type="button" class="btn sm" id="ca-inv-new">${ic("plus", "xs")} رابط جديد</button></header><div id="ca-inv"><div class="skel sm"></div></div></section>
    <section class="card ca-card" id="direct"><header class="ca-ch"><span class="ca-ci">${ic("send", "sm")}</span><div class="grow"><h3>دعوة مباشرة</h3><p>ادعُ شخصاً باسم المستخدم. ${c.type === "invite" ? "هذه الطريقة الأساسية لمجتمع بالدعوة." : "يدخل المدعو دون انتظار الموافقة."}</p></div></header><div class="ca-inline"><input id="ca-dm-h" placeholder="${h(tr("@اسم_المستخدم"))}" dir="ltr" autocomplete="off" aria-label="${h(tr("اسم المستخدم"))}"><button type="button" class="btn sm" id="ca-dm-go">${ic("send", "xs")} دعوة</button></div><div id="ca-dm"></div></section>` : ""}`;
    const root = body.querySelector("#ca-form");
    wireLists(root, { joinQuestions: j.joinQuestions || [] });
    form(root, async (v, o) => {
      if (own && v.type !== o.type) { const T = { public: "عام", private: "خاص", invite: "بالدعوة فقط" }; const r = await ask({ title: `تحويل المجتمع إلى «${T[v.type]}»؟`, text: v.type === "public" ? "يصبح المحتوى العام مرئياً للجميع، ويستطيع أي أحد الانضمام فوراً." : v.type === "invite" ? "يختفي المجتمع من الدليل، ولا يدخله إلا المدعوون. الأعضاء الحاليون يبقون." : "يصبح الانضمام بطلب يوافق عليه المشرفون. الأعضاء الحاليون يبقون.", ok: "تحويل" }); if (!r) return false; }
      const base = {}; if (own && v.type !== o.type) base.type = v.type;
      const idk = {}; if (idEd && JSON.stringify(v.joinQuestions) !== JSON.stringify(o.joinQuestions)) idk.joinQuestions = v.joinQuestions; // v2.58: rules & welcome live in «القواعد والترحيب»
      if (Object.keys(base).length) await api("PATCH", `/api/communities/${st.cid}`, base);
      if (Object.keys(idk).length) await api("PATCH", `/api/communities/${st.cid}/identity`, idk);
      if (typeof refresh === "function") refresh();
    });
    if (canReq) wireRequests(body);
    if (canInv) { wireInvites(body, c); wireDirect(body); }
    if (idEd) wireNotifyDefault(body); // v2.60
    if (hashParts().q.get("a") === "requests") setTimeout(() => body.querySelector("#requests")?.scrollIntoView({ block: "start" }), 120);
  }
  async function wireRequests(body) {
    const box = body.querySelector("#ca-rq"); let tab = "pending";
    const load = async () => {
      box.innerHTML = `<div class="skel sm"></div>`;
      try {
        if (tab === "pending") {
          const { requests } = await api("GET", `/api/communities/${st.cid}/requests`);
          box.innerHTML = requests.length ? `<div class="ca-bulk"><label class="ca-chk"><input type="checkbox" id="ca-rq-all" aria-label="${h(tr("تحديد الكل"))}"> تحديد الكل</label><span class="grow"></span><button type="button" class="btn sm" data-bulk="approve" disabled>${ic("check", "xs")} قبول</button><button type="button" class="btn ghost sm" data-bulk="reject" disabled>${ic("x", "xs")} رفض</button></div>
            <ul class="ca-rows">${requests.map((r) => `<li class="ca-row"><label class="ca-chk"><input type="checkbox" data-u="${h(r.user.id)}" aria-label="تحديد ${h(r.user.name)}"></label>${avatar(r.user)}<div class="grow"><b>${h(r.user.name)}</b><small>@${h(r.user.handle)} · طلب ${h(rel(r.requestedAt))}</small>${r.answers.length ? `<details class="ca-ans"><summary>الإجابات (${num(r.answers.length)})</summary><dl>${r.answers.map((a) => `<dt>${h(a.q)}</dt><dd>${h(a.a || "—")}</dd>`).join("")}</dl></details>` : ""}</div><span class="ca-ra"><button type="button" class="btn ghost icon" data-one="approve" data-u="${h(r.user.id)}" aria-label="قبول ${h(r.user.name)}">${ic("check", "xs")}</button><button type="button" class="btn ghost icon" data-one="reject" data-u="${h(r.user.id)}" aria-label="رفض ${h(r.user.name)}">${ic("x", "xs")}</button></span></li>`).join("")}</ul>` : UI.empty({ title: "لا طلبات بانتظارك", text: "تظهر هنا طلبات الانضمام إلى المجتمع الخاص." });
          const sel = () => [...box.querySelectorAll("input[data-u]:checked")].map((i) => i.dataset.u);
          const sync = () => { const n = sel().length; box.querySelectorAll("[data-bulk]").forEach((b) => { b.disabled = !n; }); };
          box.querySelectorAll("input[data-u]").forEach((i) => (i.onchange = sync));
          box.querySelector("#ca-rq-all")?.addEventListener("change", (e) => { box.querySelectorAll("input[data-u]").forEach((i) => { i.checked = e.target.checked; }); sync(); });
          const decide = async (users, action) => { let reason = ""; if (action === "reject") { const r = await ask({ title: users.length > 1 ? `رفض ${num(users.length)} طلبات؟` : "رفض الطلب؟", input: "السبب (اختياري، يبقى في السجل)", ok: "رفض", danger: true }); if (!r) return; reason = r.text; }
            try { const r = await api("POST", `/api/communities/${st.cid}/requests/decide`, { users, action, reason }); toast(action === "approve" ? `✓ قُبل ${num(r.done)}` : `رُفض ${num(r.done)}`); st.data.counts.requests = Math.max(0, st.data.counts.requests - r.done); load(); } catch (e) { toast(e.message); } };
          box.querySelectorAll("[data-bulk]").forEach((b) => (b.onclick = () => decide(sel(), b.dataset.bulk)));
          box.querySelectorAll("[data-one]").forEach((b) => (b.onclick = () => decide([b.dataset.u], b.dataset.one)));
        } else {
          const { history } = await api("GET", `/api/communities/${st.cid}/requests/history`);
          const L = { approved: ["مقبول", "ok"], rejected: ["مرفوض", "danger"], cancelled: ["ألغاه صاحبه", ""] };
          box.innerHTML = history.length ? `<ul class="ca-rows">${history.map((r) => `<li class="ca-row">${avatar(r.user)}<div class="grow"><b>${h(r.user.name)}</b><small>${h(r.decidedBy || "")}${r.decidedBy ? " · " : ""}${h(rel(r.decidedAt))}${r.reason ? " · " + h(r.reason) : ""}</small></div>${badge(L[r.status]?.[0] || r.status, L[r.status]?.[1] || "")}</li>`).join("")}</ul>` : UI.empty({ title: "لا قرارات بعد", text: "كل قبول أو رفض يبقى هنا." });
        }
      } catch (e) { box.innerHTML = errBox(e); }
    };
    body.querySelectorAll("[data-rq]").forEach((b) => (b.onclick = () => { tab = b.dataset.rq; body.querySelectorAll("[data-rq]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }); load(); }));
    load();
  }
  async function wireInvites(body, c) {
    const box = body.querySelector("#ca-inv");
    const load = async () => {
      try {
        const { invites } = await api("GET", `/api/communities/${st.cid}/invites`);
        box.innerHTML = invites.length ? `<ul class="ca-rows">${invites.map((i) => { const dead = i.revokedAt || (i.expiresAt && new Date(i.expiresAt) < new Date()) || (i.maxUses && i.uses >= i.maxUses);
          return `<li class="ca-row ca-inv${dead ? " dead" : ""}"><span class="ca-ci">${ic("link", "sm")}</span><div class="grow"><b>${h(i.label || "رابط دعوة")}</b><small class="ca-ist"><span class="vh">${num(i.clicks)} نقرة، ${num(i.joins)} انضمام، ${num(i.active)} نشِط${i.maxUses ? `، ${num(i.uses)} من ${num(i.maxUses)}` : ""}</span><span aria-hidden="true" title="نقرات">${ic("eye", "xs")}${num(i.clicks)}</span><span aria-hidden="true" title="انضمام">${ic("uplus", "xs")}${num(i.joins)}</span><span aria-hidden="true" title="نشِط">${ic("trendUp", "xs")}${num(i.active)}</span>${i.maxUses ? `<span aria-hidden="true" title="الاستخدام">${ic("target", "xs")}${num(i.uses)}/${num(i.maxUses)}</span>` : ""}</small>${i.expiresAt ? `<small>ينتهي ${h(when(i.expiresAt))}</small>` : ""}<span class="ca-meta">${i.grantRole === "moderator" ? badge("يمنح: مشرف", "acc") : ""}${i.skipApproval ? badge("دون موافقة", "acc") : ""}${i.revokedAt ? badge("ملغى", "danger") : dead ? badge("منتهٍ", "warn") : ""}</span></div>${dead ? "" : `<span class="ca-ra"><button type="button" class="btn ghost icon" data-copy="${h(location.origin + i.url)}" aria-label="نسخ رابط ${h(i.label || "الدعوة")}">${ic("copy", "xs")}</button><button type="button" class="btn ghost icon" data-rev="${h(i.code)}" aria-label="إلغاء رابط ${h(i.label || "الدعوة")}">${ic("ban", "xs")}</button></span>`}</li>`; }).join("")}</ul>` : UI.empty({ title: "لا روابط بعد", text: "أنشئ رابطاً لكل مكان تشارك فيه المجتمع لتعرف أيها يجلب أعضاء نشطين." });
        box.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy).catch(() => {}); toast("✓ نُسخ الرابط"); }));
        box.querySelectorAll("[data-rev]").forEach((b) => (b.onclick = async () => { const r = await ask({ title: "إلغاء رابط الدعوة؟", text: "لن يفتح الرابط بعد الآن. تبقى إحصاءاته.", ok: "إلغاء الرابط", danger: true }); if (!r) return; try { await api("DELETE", `/api/communities/${st.cid}/invites/${b.dataset.rev}`); toast("أُلغي الرابط"); load(); } catch (e) { toast(e.message); } }));
      } catch (e) { box.innerHTML = errBox(e); }
    };
    body.querySelector("#ca-inv-new").onclick = () => {
      const canRole = has("manage_roles") && st.data.assignable.includes("moderator"), canSkip = has("approve_requests") && c.type === "private";
      sheet(`<h3 class="u-mt0">رابط دعوة جديد</h3><label class="field"><span class="lbl">التسمية</span><input id="iv-l" maxlength="40" placeholder="${h(tr("مثل: تويتر، الجامعة"))}"></label>
        <div class="ca-2"><label class="field"><span class="lbl">حد الاستخدام</span><select id="iv-m"><option value="">بلا حد</option><option>10</option><option>50</option><option>100</option><option>500</option></select></label><label class="field"><span class="lbl">ينتهي بعد</span><select id="iv-d"><option value="">بلا انتهاء</option><option value="1">يوم</option><option value="7">أسبوع</option><option value="30">شهر</option></select></label></div>
        ${canRole ? `<label class="field"><span class="lbl">الرتبة عند الانضمام</span><select id="iv-r"><option value="">عضو</option><option value="moderator">مشرف</option></select></label>` : ""}
        ${canSkip ? `<label class="switch-row"><span><b>دون انتظار الموافقة</b><small>من يدخل بهذا الرابط يصبح عضواً مباشرة</small></span><input type="checkbox" class="switch" role="switch" id="iv-s" aria-label="${h(tr("دون انتظار الموافقة"))}"></label>` : ""}
        <button type="button" class="btn block u-mt10" id="iv-go">${ic("link", "xs")} إنشاء ونسخ</button>`);
      document.getElementById("iv-go").onclick = async (e) => { busy(e.target, true); try { const r = await api("POST", `/api/communities/${st.cid}/invites`, { label: document.getElementById("iv-l").value.trim() || undefined, maxUses: +document.getElementById("iv-m").value || undefined, days: +document.getElementById("iv-d").value || undefined, grantRole: document.getElementById("iv-r")?.value || undefined, skipApproval: !!document.getElementById("iv-s")?.checked }); navigator.clipboard?.writeText(location.origin + r.invite.url).catch(() => {}); closeSheet(); toast("✓ أُنشئ الرابط ونُسخ"); load(); } catch (er) { toast(er.message); busy(e.target, false); } };
    };
    load();
  }
  async function wireDirect(body) {
    const box = body.querySelector("#ca-dm");
    const load = async () => { try { const { invites } = await api("GET", `/api/communities/${st.cid}/member-invites`); const L = { pending: ["بانتظار الرد", "acc"], accepted: ["انضم", "ok"], declined: ["اعتذر", ""], revoked: ["أُلغيت", "warn"] };
      box.innerHTML = invites.length ? `<ul class="ca-rows">${invites.slice(0, 20).map((i) => `<li class="ca-row">${avatar(i.user)}<div class="grow"><b>${h(i.user.name)}</b><small>@${h(i.user.handle)} · ${h(rel(i.createdAt))}${i.invitedBy ? " · من " + h(i.invitedBy) : ""}</small></div>${badge(L[i.status]?.[0] || i.status, L[i.status]?.[1] || "")}${i.status === "pending" ? `<button type="button" class="btn ghost icon" data-dmx="${h(i.id)}" aria-label="إلغاء دعوة ${h(i.user.name)}">${ic("x", "xs")}</button>` : ""}</li>`).join("")}</ul>` : "";
      box.querySelectorAll("[data-dmx]").forEach((b) => (b.onclick = async () => { await api("DELETE", `/api/communities/${st.cid}/member-invites/${b.dataset.dmx}`).catch((e) => toast(e.message)); load(); })); } catch { box.innerHTML = ""; } };
    const go = async () => { const inp = body.querySelector("#ca-dm-h"), v = inp.value.trim(); if (!v) return; const btn = body.querySelector("#ca-dm-go"); busy(btn, true); try { const r = await api("POST", `/api/communities/${st.cid}/member-invites`, { handle: v }); inp.value = ""; toast(`✓ دُعي ${r.invite.user.name}`); load(); } catch (e) { toast(e.message); } finally { busy(btn, false); } };
    body.querySelector("#ca-dm-go").onclick = go; body.querySelector("#ca-dm-h").onkeydown = (e) => { if (e.key === "Enter") go(); };
    load();
  }

  /* ======================= 3. members ======================= */
  const FILTERS = [["", "الكل"], ["staff", "الفريق"], ["member", "الأعضاء"], ["muted", "المكتومون"], ["banned", "المحظورون"]];
  async function secMembers(body) {
    const { q } = hashParts(); let f = q.get("f") || "", term = "", roles = null;
    try { roles = await api("GET", `/api/communities/${st.cid}/roles`); } catch { roles = { custom: [] }; }
    body.innerHTML = `<div class="ca-mtools"><input type="search" id="ca-mq" placeholder="${h(tr("ابحث بالاسم أو اسم المستخدم"))}" aria-label="${h(tr("بحث في الأعضاء"))}">${has("manage_roles") ? `<a class="btn ghost sm" href="/api/communities/${h(st.cid)}/members?format=csv" download id="ca-mcsv">${ic("download", "xs")} تصدير CSV</a>` : ""}</div>
      <div class="chips ca-filters" role="tablist" aria-label="فلترة الأعضاء">${FILTERS.map(([k, l]) => `<button type="button" class="tab${f === k ? " on" : ""}" role="tab" aria-selected="${f === k}" data-f="${k}">${l}</button>`).join("")}</div>
      <p class="muted ca-total" id="ca-mtot" aria-live="polite"></p><ul class="ca-rows ca-members" id="ca-ml"></ul><div id="ca-mmore"></div>`;
    const list = body.querySelector("#ca-ml"), more = body.querySelector("#ca-mmore"), tot = body.querySelector("#ca-mtot");
    const rname = Object.fromEntries((roles.custom || []).map((r) => [r.id, r]));
    const row = (m) => { const u = m.user, ext = (m.roles || []).map((id) => rname[id]).filter(Boolean);
      return `<li class="ca-row ca-mrow">${avatar(u)}<div class="grow"><b>${h(u.name)}</b><small>@${h(u.handle)} · ${h(tr("انضم " + when(m.joinedAt)))}</small><span class="ca-meta">${badge(ROLE[m.role] || m.roleLabel, ["owner", "admin", "moderator"].includes(m.role) ? "acc" : m.role === "banned" ? "danger" : m.role === "muted" ? "warn" : "")}${ext.map((r) => `<span class="ca-rbadge" data-sw="${h(r.color || "")}"><i class="ca-tdot" aria-hidden="true"></i>${h(r.name)}</span>`).join("")}${m.warnings ? badge(`${num(m.warnings)} إنذار`, "warn") : ""}${m.mutedUntil ? badge("مكتوم حتى " + new Date(m.mutedUntil).toLocaleString(loc(), { numberingSystem: "latn", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }), "warn") : ""}</span></div>${u.id !== DB.me && m.role !== "owner" ? `<button type="button" class="btn ghost sm" data-mm="${h(u.id)}" aria-label="إدارة ${h(u.name)}">إدارة</button>` : ""}</li>`; };
    const cache = {};
    const load = async (cursor) => {
      if (!cursor) list.innerHTML = `<li><div class="skel sm"></div></li>`;
      try {
        const qs = new URLSearchParams({ limit: "30" }); if (f) qs.set("role", f); if (term) qs.set("q", term); if (cursor) qs.set("cursor", cursor);
        const r = await api("GET", `/api/communities/${st.cid}/members?${qs}`);
        r.members.forEach((m) => { cache[m.user.id] = m; });
        if (!cursor) list.innerHTML = "";
        list.insertAdjacentHTML("beforeend", r.members.map(row).join("") || (cursor ? "" : `<li>${UI.empty({ title: term ? "لا نتائج" : f === "banned" ? "لا محظورين" : f === "muted" ? "لا عقوبات نشطة" : "لا أعضاء", text: term ? "جرّب اسماً آخر." : "" })}</li>`));
        tot.textContent = f || term ? "" : `عدد الأعضاء: ${num(r.total)}`;
        paintTiles(list);
        more.innerHTML = r.next ? `<button type="button" class="btn ghost block" id="ca-mnext">عرض المزيد</button>` : "";
        more.querySelector("#ca-mnext")?.addEventListener("click", (e) => { e.currentTarget.disabled = true; load(r.next); });
      } catch (e) { list.innerHTML = `<li>${errBox(e)}</li>`; }
    };
    list.addEventListener("click", (e) => { const b = e.target.closest("[data-mm]"); if (b) memberSheet(cache[b.dataset.mm], roles, () => load()); });
    body.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { f = b.dataset.f; body.querySelectorAll("[data-f]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }); load(); }));
    let t = 0; body.querySelector("#ca-mq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { term = e.target.value.trim(); load(); }, 300); };
    load();
  }
  async function memberSheet(m, roles, done) {
    if (!m) return; const u = m.user, mine = st.data;
    const myRank = mine.rank, R = { owner: 100, admin: 80, moderator: 60, member: 20, muted: 10, pending: 0, banned: -1 };
    const tRank = ["muted", "banned"].includes(m.role) && m.prevRole ? R[m.prevRole] : R[m.role];
    const above = myRank > tRank;
    const canRole = has("manage_roles") && above && !["banned", "pending"].includes(m.role);
    const opts = (mine.assignable || []).filter((r) => r !== m.role);
    let notes = { notes: [], history: [], member: {} }; try { notes = await api("GET", `/api/communities/${st.cid}/members/${u.id}/notes`); } catch { /* no view_notes */ }
    const custom = roles.custom || [];
    sheet(`<div class="ca-ms"><div class="ca-ms-h">${avatar(u)}<div class="grow"><h3 class="u-m0">${h(u.name)}</h3><small class="muted">@${h(u.handle)} · ${h(ROLE[m.role] || "")} · انضم ${h(when(m.joinedAt))}</small></div></div>
      ${!above ? `<p class="ca-lock">${ic("lock", "xs")}<span>لا يمكنك اتخاذ إجراء على عضو في رتبتك أو أعلى.</span></p>` : ""}
      ${canRole && opts.length ? `<div class="field"><span class="lbl">الرتبة</span><div class="ca-inline"><select id="ms-role" aria-label="الرتبة الجديدة">${opts.map((r) => `<option value="${r}">${ROLE[r]}</option>`).join("")}</select><button type="button" class="btn sm" id="ms-role-go">تغيير</button></div></div>` : ""}
      ${has("manage_roles") && above && custom.length && !["banned", "pending"].includes(m.role) ? `<div class="field"><span class="lbl">أدوار إضافية</span>${custom.map((r) => `<label class="switch-row"><span><b>${h(r.name)}</b><small>${num(r.perms.length)} صلاحية</small></span><input type="checkbox" class="switch" role="switch" data-cr="${h(r.id)}" ${(m.roles || []).includes(r.id) ? "checked" : ""} aria-label="${h(r.name)}"></label>`).join("")}</div>` : ""}
      ${above ? `<div class="ca-acts">${has("warn") && m.role !== "banned" ? `<button type="button" class="btn ghost sm" data-d="warn">${ic("alert", "xs")} إنذار</button>` : ""}${has("mute") && m.role !== "banned" ? (m.role === "muted" ? `<button type="button" class="btn ghost sm" data-d="unmute">${ic("volume", "xs")} رفع الكتم</button>` : `<button type="button" class="btn ghost sm" data-d="mute">${ic("volumeX", "xs")} كتم</button>`) : ""}${has("ban") ? (m.role === "banned" ? `<button type="button" class="btn ghost sm" data-d="unban">${ic("unlock", "xs")} رفع الحظر</button>` : `<button type="button" class="btn ghost sm ca-danger" data-d="ban">${ic("ban", "xs")} حظر</button>`) : ""}${has("manage_roles") && m.role !== "banned" ? `<button type="button" class="btn ghost sm ca-danger" data-d="remove">${ic("ux", "xs")} إزالة</button>` : ""}</div>` : ""}
      ${has("view_notes") ? `<h4>ملاحظات المشرفين <span class="muted">(خاصة)</span></h4>${notes.notes.map((n) => `<div class="note"><div>${h(n.text)}</div><small class="muted">${h(n.author)} · ${h(rel(n.created_at))}</small></div>`).join("") || '<p class="muted">لا ملاحظات</p>'}<div class="ca-inline"><input id="ms-note" placeholder="${h(tr("أضف ملاحظة للمشرفين"))}" aria-label="${h(tr("ملاحظة للمشرفين"))}"><button type="button" class="btn sm" id="ms-note-go">حفظ</button></div>
      <h4>السجل</h4>${notes.history.map((x) => `<div class="muted ca-hist"><span>${h(x.label)}</span>${x.reason ? ` · ${agReason(x.reason)}` : ""} · <span>${h(rel(x.created_at))}</span></div>`).join("") || '<p class="muted">لا إجراءات سابقة</p>'}` : ""}</div>`);
    const again = () => { closeSheet(); done(); };
    document.getElementById("ms-role-go")?.addEventListener("click", async (e) => { const to = document.getElementById("ms-role").value; const r = await ask({ title: `تغيير رتبة ${u.name} إلى «${ROLE[to]}»؟`, ok: "تغيير" }); if (!r) return; busy(e.target, true); try { await api("PATCH", `/api/communities/${st.cid}/members/${u.id}`, { role: to }); toast("✓ تغيّرت الرتبة"); again(); } catch (er) { toast(er.message); busy(e.target, false); } });
    document.querySelectorAll("#sheet [data-cr]").forEach((i) => (i.onchange = async () => { try { await api(i.checked ? "PUT" : "DELETE", `/api/communities/${st.cid}/members/${u.id}/roles/${i.dataset.cr}`); toast(i.checked ? "✓ مُنح الدور" : "سُحب الدور"); } catch (er) { i.checked = !i.checked; toast(er.message); } }));
    document.querySelectorAll("#sheet [data-d]").forEach((b) => (b.onclick = async () => {
      const a = b.dataset.d; const T = { warn: ["إنذار " + u.name, "إنذار"], mute: ["كتم " + u.name, "كتم"], unmute: ["رفع الكتم عن " + u.name, "رفع الكتم"], ban: ["حظر " + u.name + "؟", "حظر"], unban: ["رفع الحظر عن " + u.name, "رفع الحظر"], remove: ["إزالة " + u.name + " من المجتمع؟", "إزالة"] }[a];
      const r = await ask({ title: T[0], input: ["unmute", "unban"].includes(a) ? null : "السبب (يظهر في سجل الإشراف)", ok: T[1], danger: ["ban", "remove"].includes(a), choices: a === "mute" ? MPCommunities.MUTE_CHOICES : null, choice: 24, icon: { warn: "alert", mute: "volumeX", unmute: "volume", ban: "ban", unban: "unlock", remove: "ux" }[a] }); if (!r) return;
      const hours = +(r.choice || 24);
      try { if (a === "remove") await api("PATCH", `/api/communities/${st.cid}/members/${u.id}`, { role: "remove" }); else await api("POST", `/api/communities/${st.cid}/members/${u.id}/discipline`, { action: a, reason: r.text, hours }); toast("✓ تم"); done(); } catch (er) { toast(er.message); }
    }));
    document.getElementById("ms-note-go")?.addEventListener("click", async () => { const t = document.getElementById("ms-note").value.trim(); if (!t) return; try { await api("POST", `/api/communities/${st.cid}/members/${u.id}/notes`, { text: t }); toast("✓ حُفظت الملاحظة"); memberSheet(m, roles, done); } catch (er) { toast(er.message); } });
  }

  /* ======================= 4. roles & permissions ======================= */
  const PERM_HELP = { post: "نشر منشورات في المجتمع", comment: "التعليق على المنشورات", upload_media: "إرفاق صور وفيديو وصوت", post_links: "روابط داخل المنشورات", poll: "إنشاء استطلاعات", event: "إنشاء فعاليات للمجتمع", pin: "تثبيت منشور أعلى المجتمع", announce: "النشر في قنوات المشرفين والإعلانات", queue_review: "قبول ورفض المنشورات المعلّقة", remove_content: "حذف منشورات وتعليقات مخالفة", warn: "توجيه إنذار لعضو", mute: "منع عضو من النشر مؤقتاً", ban: "حظر عضو من المجتمع", view_notes: "قراءة وكتابة ملاحظات المشرفين", export_log: "رؤية سجل الإشراف وتصديره", view_automod: "رؤية القواعد الآلية", approve_requests: "قبول ورفض طلبات الانضمام", invite: "إنشاء روابط الدعوة ودعوة الأشخاص", manage_roles: "تعيين الأدوار للأعضاء الأدنى رتبة", edit_identity: "الأيقونة والغلاف والوسوم والترحيب", manage_channels: "إنشاء القنوات وتعديلها", edit_rules: "تعديل قواعد المجتمع", manage_automod: "تعديل القواعد الآلية والإيقاف المؤقت", edit_settings: "النوع والاسم وقواعد النشر", manage_integrations: "الشراكات والتكاملات", view_analytics: "رؤية تحليلات المجتمع", view_health: "تقرير صحة المجتمع", manage_challenges: "إطلاق التحديات وإدارتها", wiki_edit: "تحرير صفحات الويكي", wiki_lock: "قفل صفحات الويكي وترتيبها", faq_edit: "إدارة الأسئلة الشائعة" };
  const TEMPLATES = [["مُرحِّب", "#16a34a", ["approve_requests", "invite", "pin"]], ["خبير أسئلة", "#2563eb", ["pin", "faq_edit", "wiki_edit"]], ["منظّم فعاليات", "#d97706", ["event", "announce", "pin"]], ["محرر ويكي", "#7c3aed", ["wiki_edit", "wiki_lock", "faq_edit"]]];
  async function secRoles(body) {
    const { q } = hashParts(); const rid = q.get("r");
    const data = await api("GET", `/api/communities/${st.cid}/roles`);
    if (rid) return roleEditor(body, data, rid);
    const BASE_I = { owner: "crown", admin: "shield", moderator: "flag", member: "user" };
    const custom = data.custom;
    body.innerHTML = `${card("رتب المجتمع", "shield", `<p class="muted">الرتب ثابتة وتحدد التسلسل: لا يتخذ أحد إجراءً على من في رتبته أو أعلى.</p><div class="list flat">${data.base.map((b) => UI.li({ href: href(st.cid, "roles", "&r=base:" + b.key), icon: BASE_I[b.key], title: b.name, sub: `${num(b.perms.length)} صلاحية · رتبة ${num(b.rank)}` })).join("")}</div>`)}
      ${card("أدوار مخصّصة", "key", `<p class="muted">تضيف صلاحيات فوق رتبة العضو، مثل «مُرحِّب» أو «محرر ويكي». الترتيب من الأعلى للأدنى.</p>${custom.length ? `<ul class="ca-rows ca-roles">${custom.map((r, i) => `<li class="ca-row"><span class="ca-rdot" data-sw="${h(r.color || "")}" aria-hidden="true"></span><a class="grow ca-rlink" href="${href(st.cid, "roles", "&r=" + r.id)}"><b>${h(r.name)}</b><small>${num(r.perms.length)} صلاحية · ${num(r.members)} عضو</small></a><span class="ca-ra"><button type="button" class="btn ghost icon" data-rmv="up" data-r="${h(r.id)}" ${i === 0 ? "disabled" : ""} aria-label="رفع ${h(r.name)}">${ic("arrowUp", "xs")}</button><button type="button" class="btn ghost icon" data-rmv="down" data-r="${h(r.id)}" ${i === custom.length - 1 ? "disabled" : ""} aria-label="خفض ${h(r.name)}">${ic("arrowDn", "xs")}</button></span></li>`).join("")}</ul>` : UI.empty({ title: "لا أدوار مخصّصة بعد", text: "ابدأ من قالب جاهز أو أنشئ دوراً." })}
        <div class="ca-tpls"><a class="btn sm" href="${href(st.cid, "roles", "&r=new")}">${ic("plus", "xs")} دور جديد</a><span class="ca-tpl-l">أو من قالب:</span>${TEMPLATES.map(([n], i) => `<a class="btn ghost sm" href="${href(st.cid, "roles", "&r=new&t=" + i)}">${h(n)}</a>`).join("")}</div>`, { act: "" })}`;
    paintTiles(body);
    body.querySelectorAll("[data-rmv]").forEach((b) => (b.onclick = async () => {
      const i = custom.findIndex((r) => r.id === b.dataset.r), j = b.dataset.rmv === "up" ? i - 1 : i + 1; if (j < 0 || j >= custom.length) return;
      const order = custom.slice(); [order[i], order[j]] = [order[j], order[i]];
      try { for (let k = 0; k < order.length; k++) { const pos = order.length - k; if (order[k].position !== pos) await api("PATCH", `/api/communities/${st.cid}/roles/${order[k].id}`, { position: pos }); } secRoles(body); } catch (e) { toast(e.message); }
    }));
  }
  function roleEditor(body, data, rid) {
    const isBase = rid.startsWith("base:"), base = isBase ? data.base.find((b) => b.key === rid.slice(5)) : null;
    const { q } = hashParts(); const tpl = rid === "new" && q.get("t") !== null ? TEMPLATES[+q.get("t")] : null;
    const r = isBase ? { name: base.name, color: "", perms: base.perms } : rid === "new" ? { name: tpl ? tpl[0] : "", color: tpl ? tpl[1] : PALETTE[0], perms: tpl ? tpl[2] : [] } : data.custom.find((x) => x.id === rid);
    if (!r) { body.innerHTML = UI.empty({ title: "الدور غير موجود", action: `<a class="btn ghost sm" href="${href(st.cid, "roles")}">الأدوار</a>` }); return; }
    const mine = new Set(keys()), owner = new Set(data.ownerOnly || []);
    const groups = Object.entries(data.groups).map(([gk, g]) => `<fieldset class="ca-pg"><legend>${h(g.label)}</legend>${Object.entries(g.keys).map(([k, l]) => { const locked = isBase || owner.has(k) || !mine.has(k); const why = isBase ? "" : owner.has(k) ? "للمالك فقط، لا تُمنح بدور" : !mine.has(k) ? "لا تملك هذه الصلاحية لتمنحها" : "";
      return `<label class="switch-row ca-perm${locked ? " locked" : ""}"><span><b>${h(l)}</b><small>${h(PERM_HELP[k] || "")}${why ? ` · ${why}` : ""}</small></span><input type="checkbox" class="switch" role="switch" data-k="perm:${k}" ${r.perms.includes(k) ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="${h(tr(l))}"></label>`; }).join("")}</fieldset>`).join("");
    body.innerHTML = `<a class="ca-backl" href="${href(st.cid, "roles")}"><span class="fwd" aria-hidden="true">→</span> كل الأدوار</a><div id="ca-form" class="ca-form">
      ${card(isBase ? `رتبة «${r.name}»` : rid === "new" ? "دور جديد" : `الدور «${r.name}»`, isBase ? "shield" : "key", isBase ? `<p class="muted">رتب النظام ثابتة. يمكنك إضافة صلاحيات لأعضاء محددين بأدوار مخصّصة.</p>` : `<div class="ca-2"><label class="field"><span class="lbl">اسم الدور</span><input data-k="name" value="${h(r.name)}" maxlength="30" placeholder="${h(tr("مثل: مُرحِّب"))}"></label>
        <div class="field"><span class="lbl" id="ca-rc-l">اللون</span><div class="ca-sws" role="radiogroup" aria-labelledby="ca-rc-l">${PALETTE.map((x) => `<button type="button" class="ca-swb" role="radio" data-sw="${x}" aria-checked="${r.color === x}" aria-label="${h(tr("لون"))} ${x}"></button>`).join("")}</div><input type="hidden" data-k="color" value="${h(r.color || "")}"></div></div>`)}
      ${card("الصلاحيات", "listChk", groups, { sub: isBase ? "" : "لا يمنح أحد صلاحية لا يملكها، ولا صلاحيات المالك." })}
      ${!isBase && rid !== "new" ? `<button type="button" class="btn ghost ca-danger block" id="ca-rdel">${ic("trash", "xs")} حذف الدور</button>` : ""}</div>`;
    paintTiles(body);
    const root = body.querySelector("#ca-form");
    root.querySelectorAll(".ca-swb").forEach((b) => (b.onclick = () => { root.querySelector('[data-k="color"]').value = b.dataset.sw; root.querySelectorAll(".ca-swb").forEach((x) => x.setAttribute("aria-checked", String(x === b))); root.dispatchEvent(new Event("change")); }));
    if (isBase) return;
    root.querySelector('[data-k="color"]')?.addEventListener("ca-sync", (e) => root.querySelectorAll(".ca-swb").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.sw === e.target.value))));
    form(root, async (v) => {
      const perms = Object.keys(v).filter((k) => k.startsWith("perm:") && v[k]).map((k) => k.slice(5));
      if (!v.name.trim()) { toast("اكتب اسماً للدور"); return false; }
      if (rid === "new") { const res = await api("POST", `/api/communities/${st.cid}/roles`, { name: v.name.trim(), color: v.color || null, perms }); history.replaceState(null, "", href(st.cid, "roles", "&r=" + res.role.id)); st.shownHash = location.hash; }
      else await api("PATCH", `/api/communities/${st.cid}/roles/${rid}`, { name: v.name.trim(), color: v.color || null, perms });
    }, { isNew: rid === "new" });
    body.querySelector("#ca-rdel")?.addEventListener("click", async () => { const ok = await ask({ title: `حذف الدور «${r.name}»؟`, text: "يُسحب من كل من يحمله. لا تتأثر رتبهم.", ok: "حذف الدور", danger: true }); if (!ok) return; try { await api("DELETE", `/api/communities/${st.cid}/roles/${rid}`); st.dirty = null; toast("حُذف الدور"); location.hash = href(st.cid, "roles"); } catch (e) { toast(e.message); } });
  }

  /* ======================= hosted sections (the screens of v2.5–v2.56, inside the panel) ======================= */
  /* ======================= 5. channels & categories (v2.58) ======================= */
  const CH_ICONS = { hash: "وسم", mega: "مكبّر صوت", help: "سؤال", camera: "كاميرا", book: "كتاب", bulb: "فكرة", star: "نجمة", trophy: "كأس", calendar: "تقويم", comment: "محادثة", heart: "قلب", flag: "علم", globe: "عالم", sparkle: "لمعة", cap: "تخرّج", brief: "حقيبة", store: "متجر", party: "احتفال", mic: "ميكروفون", users: "أشخاص", lock: "قفل" };
  const KIND = { text: "نقاش", announcements: "إعلانات", questions: "أسئلة", media: "وسائط" }, KIND_I = { announcements: "mega", questions: "help", media: "camera" };
  const CTYPES = [["image", "الصور", "image"], ["video", "الفيديو", "clapper"], ["audio", "الصوت", "mic"], ["poll", "الاستطلاعات", "chart"], ["question", "الأسئلة", "help"], ["article", "المقالات", "doc"], ["event", "الفعاليات", "calendar"]];
  const SLOWS = [[0, "متوقف"], [5, "5 ثوانٍ"], [10, "10 ثوانٍ"], [30, "30 ثانية"], [60, "دقيقة"], [300, "5 دقائق"], [900, "15 دقيقة"], [3600, "ساعة"], [21600, "6 ساعات"]];
  const slowLbl = (s) => (SLOWS.find((x) => x[0] === s) || [0, `${num(s)} ث`])[1];
  const chIco = (x) => (x.archivedAt ? "archive" : x.icon || KIND_I[x.kind] || "hash");
  async function secChannels(body) {
    const can = has("manage_channels");
    const [data, roles] = await Promise.all([api("GET", `/api/communities/${st.cid}/channels`), api("GET", `/api/communities/${st.cid}/roles`).catch(() => ({ custom: [] }))]);
    let chans = data.channels, groups = data.groups;
    const rname = (t) => (t === "staff" ? "الفريق" : t === "member" ? "الأعضاء" : (roles.custom.find((r) => r.id === t) || {}).name || "دور");
    const row = (x, i, list) => `<li class="ca-row ca-chr${x.archivedAt ? " dead" : ""}" data-chid="${h(x.id)}" ${can && !x.archivedAt ? 'draggable="true"' : ""}><div class="grow"><b class="ca-chn">${ic(chIco(x), "xs")}${h(x.name)}</b><small>${h(KIND[x.kind] || "")}${x.desc ? " · " + h(x.desc) : ""}</small>
      <span class="ca-meta">${badge(x.viewPerm === "public" ? "يراها الجميع" : "للأعضاء")}${x.postPerm === "mods" ? badge("النشر للمشرفين") : ""}${x.viewRoles.length ? badge("ترى: " + x.viewRoles.map(rname).join("، "), "acc") : ""}${x.postRoles.length ? badge("تنشر: " + x.postRoles.map(rname).join("، "), "acc") : ""}${x.slowModeSec ? badge("بطيء: " + slowLbl(x.slowModeSec), "warn") : ""}${x.requireApproval ? badge("بمراجعة", "warn") : ""}${x.allowedTypes.length ? badge("أنواع محددة") : ""}${x.isDefault ? badge("للقادمين الجدد", "ok") : ""}${x.archivedAt ? badge("مؤرشفة", "warn") : ""}</span></div>
      ${can ? `<span class="ca-ra">${x.archivedAt ? "" : `<button type="button" class="btn ghost icon" data-mv="-1" aria-label="تقديم ${h(x.name)}" ${i === 0 ? "disabled" : ""}>${ic("arrowUp", "xs")}</button><button type="button" class="btn ghost icon" data-mv="1" aria-label="تأخير ${h(x.name)}" ${i === list.length - 1 ? "disabled" : ""}>${ic("arrowDn", "xs")}</button>`}<button type="button" class="btn ghost icon" data-ed="${h(x.id)}" aria-label="تعديل ${h(x.name)}">${ic("pen", "xs")}</button></span>` : ""}</li>`;
    const paint = () => {
      const live = chans.filter((x) => !x.archivedAt), arch = chans.filter((x) => x.archivedAt);
      const loose = live.filter((x) => !groups.some((g) => g.id === x.group));
      const block = (g, list, gi) => `<section class="ca-chg" data-gid="${g ? h(g.id) : ""}"><header class="ca-chgh"><b>${g ? h(g.name) : "بلا تصنيف"}</b><small>${num(list.length)} قناة</small>${g && can ? `<span class="ca-ra"><button type="button" class="btn ghost icon" data-gmv="-1" data-g="${h(g.id)}" aria-label="تقديم التصنيف ${h(g.name)}" ${gi === 0 ? "disabled" : ""}>${ic("arrowUp", "xs")}</button><button type="button" class="btn ghost icon" data-gmv="1" data-g="${h(g.id)}" aria-label="تأخير التصنيف ${h(g.name)}" ${gi === groups.length - 1 ? "disabled" : ""}>${ic("arrowDn", "xs")}</button><button type="button" class="btn ghost icon" data-ged="${h(g.id)}" aria-label="تعديل التصنيف ${h(g.name)}">${ic("pen", "xs")}</button></span>` : ""}</header>${list.length ? `<ul class="ca-rows">${list.map(row).join("")}</ul>` : `<p class="muted ca-chempty">اسحب قناة إلى هنا أو اختر التصنيف من تعديل القناة.</p>`}</section>`;
      body.innerHTML = `${card("القنوات والتصنيفات", "hash", `<p class="muted">رتّب القنوات بالأسهم أو بالسحب. الحذف أرشفة افتراضياً: تبقى المنشورات ومن يراها كما هم.</p>
        ${can ? `<div class="ca-durs"><button type="button" class="btn sm" id="ca-chnew">${ic("plus", "xs")} قناة جديدة</button><button type="button" class="btn ghost sm" id="ca-gnew">${ic("layers", "xs")} تصنيف جديد</button><span class="muted ca-chcount">${num(chans.length)} من 50 قناة</span></div>` : ""}
        ${chans.length ? `${loose.length || !groups.length ? block(null, loose, -1) : ""}${groups.map((g, gi) => block(g, live.filter((x) => x.group === g.id), gi)).join("")}${arch.length ? `<details class="ca-chg ca-arch"><summary class="ca-chgh"><b>${ic("archive", "xs")} مؤرشفة</b><small>${num(arch.length)}</small></summary><ul class="ca-rows">${arch.map(row).join("")}</ul></details>` : ""}` : UI.empty({ title: "لا قنوات بعد", text: "ابدأ بقناة للإعلانات وأخرى للنقاش.", action: can ? `<button type="button" class="btn sm" id="ca-chfirst">${ic("plus", "xs")} أنشئ أول قناة</button>` : "" })}`, { lock: can ? "" : "إدارة القنوات للمالك والمديرين", id: "ca-chs" })}`;
      wire();
    };
    const order = async () => {
      const live = chans.filter((x) => !x.archivedAt);
      const out = [...live.filter((x) => !groups.some((g) => g.id === x.group)), ...groups.flatMap((g) => live.filter((x) => x.group === g.id))].map((x) => ({ id: x.id, group: groups.some((g) => g.id === x.group) ? x.group : null }));
      try { const r = await api("PUT", `/api/communities/${st.cid}/channels/order`, { groups: groups.map((g) => g.id), channels: out }); chans = r.channels; groups = r.groups; paint(); toast("✓ حُفظ الترتيب"); } catch (e) { toast(e.message); }
    };
    const wire = () => {
      body.querySelector("#ca-chnew")?.addEventListener("click", () => chEditor(null));
      body.querySelector("#ca-chfirst")?.addEventListener("click", () => chEditor(null));
      body.querySelector("#ca-gnew")?.addEventListener("click", () => grpEditor(null));
      body.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => chEditor(chans.find((x) => x.id === b.dataset.ed))));
      body.querySelectorAll("[data-ged]").forEach((b) => (b.onclick = () => grpEditor(groups.find((g) => g.id === b.dataset.ged))));
      body.querySelectorAll("[data-mv]").forEach((b) => (b.onclick = () => { const id = b.closest("[data-chid]").dataset.chid, x = chans.find((c) => c.id === id); const sib = chans.filter((c) => !c.archivedAt && (c.group || null) === (groups.some((g) => g.id === x.group) ? x.group : null)); const i = sib.indexOf(x), j = i + +b.dataset.mv; if (j < 0 || j >= sib.length) return; const a = chans.indexOf(sib[i]), z = chans.indexOf(sib[j]); [chans[a], chans[z]] = [chans[z], chans[a]]; order().then(() => body.querySelector(`[data-chid="${id}"] [data-mv="${b.dataset.mv}"]`)?.focus()); }));
      body.querySelectorAll("[data-gmv]").forEach((b) => (b.onclick = () => { const i = groups.findIndex((g) => g.id === b.dataset.g), j = i + +b.dataset.gmv; if (j < 0 || j >= groups.length) return; [groups[i], groups[j]] = [groups[j], groups[i]]; order(); }));
      /* drag & drop on pointer devices (the arrows above stay the keyboard / touch way) */
      let drag = null;
      body.querySelectorAll("[draggable=true]").forEach((r) => { r.ondragstart = (e) => { drag = r.dataset.chid; e.dataTransfer.effectAllowed = "move"; r.classList.add("drag"); }; r.ondragend = () => r.classList.remove("drag"); });
      body.querySelectorAll(".ca-chg[data-gid]").forEach((sec) => {
        sec.ondragover = (e) => { if (drag) { e.preventDefault(); sec.classList.add("over"); } };
        sec.ondragleave = () => sec.classList.remove("over");
        sec.ondrop = (e) => { e.preventDefault(); sec.classList.remove("over"); if (!drag) return; const x = chans.find((c) => c.id === drag), over = e.target.closest("[data-chid]"); drag = null; if (!x) return;
          chans.splice(chans.indexOf(x), 1); x.group = sec.dataset.gid || null; const at = over ? chans.findIndex((c) => c.id === over.dataset.chid) : -1; if (at >= 0) chans.splice(at, 0, x); else chans.push(x); order(); };
      });
    };
    const reload = async () => { const r = await api("GET", `/api/communities/${st.cid}/channels`); chans = r.channels; groups = r.groups; paint(); };
    function grpEditor(g) {
      sheet(`<h3 class="u-mt0">${g ? "تعديل التصنيف" : "تصنيف جديد"}</h3><label class="field"><span class="lbl">الاسم</span><input id="gr-n" maxlength="30" value="${h(g?.name || "")}" placeholder="${h(tr("مثل: عام، المشاريع، المساعدة"))}"></label>
        <div class="ca-ask-acts"><button type="button" class="btn grow" id="gr-go">${g ? "حفظ" : "إنشاء"}</button>${g ? `<button type="button" class="btn ghost ca-danger grow" id="gr-del">${ic("trash", "xs")} حذف التصنيف</button>` : ""}</div>${g ? `<p class="muted ca-foot">حذف التصنيف يُبقي قنواته بلا تصنيف.</p>` : ""}`);
      setTimeout(() => document.getElementById("gr-n")?.focus(), 60);
      document.getElementById("gr-go").onclick = async (e) => { const n = document.getElementById("gr-n").value.trim(); if (!n) return toast("اكتب اسماً للتصنيف"); busy(e.target, true); try { if (g) await api("PATCH", `/api/communities/${st.cid}/channel-groups/${g.id}`, { name: n }); else await api("POST", `/api/communities/${st.cid}/channel-groups`, { name: n }); closeSheet(); toast("✓ حُفظ"); reload(); } catch (er) { toast(er.message); busy(e.target, false); } };
      document.getElementById("gr-del")?.addEventListener("click", async () => { try { await api("DELETE", `/api/communities/${st.cid}/channel-groups/${g.id}`); closeSheet(); toast("حُذف التصنيف"); reload(); } catch (er) { toast(er.message); } });
    }
    function chEditor(x) {
      const v = x || { name: "", desc: "", kind: "text", viewPerm: st.data.community.type === "public" ? "public" : "members", postPerm: "members", icon: null, slowModeSec: 0, requireApproval: false, topicRequired: false, allowedTypes: [], viewRoles: [], postRoles: [], isDefault: false, group: null };
      const rolesOpts = [["staff", "الفريق (المشرفون فأعلى)"], ...roles.custom.map((r) => [r.id, r.name])];
      const roleChecks = (key, sel) => `<div class="ca-chips" role="group" aria-label="${key === "vr" ? "أدوار ترى القناة" : "أدوار تنشر فيها"}">${rolesOpts.map(([k, l]) => `<label class="ca-pick"><input type="checkbox" data-${key}="${h(k)}" ${sel.includes(k) ? "checked" : ""}><span>${h(l)}</span></label>`).join("")}</div>`;
      sheet(`<div class="ca-ched"><h3 class="u-mt0">${x ? `تعديل «${h(x.name)}»` : "قناة جديدة"}</h3>
        <div class="ca-2"><label class="field"><span class="lbl">الاسم</span><input id="ce-n" maxlength="40" value="${h(v.name)}" placeholder="${h(tr("مثل: نقاش عام"))}"></label>
        <label class="field"><span class="lbl">النوع</span><select id="ce-k">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${v.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <label class="field"><span class="lbl">الوصف (اختياري)</span><input id="ce-d" maxlength="200" value="${h(v.desc || "")}" placeholder="${h(tr("عمّ تتحدث هذه القناة؟"))}"></label>
        <div class="field"><span class="lbl" id="ce-il">الأيقونة</span><div class="ca-icons" role="radiogroup" aria-labelledby="ce-il">${Object.entries(CH_ICONS).map(([i, l]) => `<button type="button" class="ca-icb" role="radio" data-ico="${i}" aria-checked="${(v.icon || KIND_I[v.kind] || "hash") === i}" aria-label="${l}" title="${l}">${ic(i, "sm")}</button>`).join("")}</div></div>
        ${groups.length ? `<label class="field"><span class="lbl">التصنيف</span><select id="ce-g"><option value="">بلا تصنيف</option>${groups.map((g) => `<option value="${h(g.id)}" ${v.group === g.id ? "selected" : ""}>${h(g.name)}</option>`).join("")}</select></label>` : ""}
        <h4 class="ca-sublbl">${ic("eye", "xs")} من يرى القناة</h4><div class="seg ca-segw" role="radiogroup" aria-label="من يرى القناة"><label class="ca-seg"><input type="radio" name="ce-v" value="public" ${v.viewPerm === "public" ? "checked" : ""}><span>الجميع</span></label><label class="ca-seg"><input type="radio" name="ce-v" value="members" ${v.viewPerm !== "public" ? "checked" : ""}><span>الأعضاء فقط</span></label></div>
        <details class="ca-more" ${v.viewRoles.length ? "open" : ""}><summary>قصرها على أدوار محددة</summary>${roleChecks("vr", v.viewRoles)}<small class="muted">بلا اختيار: يراها كل من سبق. الفريق يرى كل القنوات دائماً.</small></details>
        <h4 class="ca-sublbl">${ic("pen", "xs")} من ينشر</h4><div class="seg ca-segw" role="radiogroup" aria-label="من ينشر"><label class="ca-seg"><input type="radio" name="ce-p" value="members" ${v.postPerm !== "mods" ? "checked" : ""}><span>الأعضاء</span></label><label class="ca-seg"><input type="radio" name="ce-p" value="mods" ${v.postPerm === "mods" ? "checked" : ""}><span>المشرفون</span></label></div>
        <details class="ca-more" ${v.postRoles.length ? "open" : ""}><summary>النشر لأدوار محددة</summary>${roleChecks("pr", v.postRoles)}</details>
        <h4 class="ca-sublbl">${ic("sliders", "xs")} الضبط</h4>
        <label class="field"><span class="lbl">الوضع البطيء</span><select id="ce-s">${SLOWS.map(([s, l]) => `<option value="${s}" ${v.slowModeSec === s ? "selected" : ""}>${s ? "منشور كل " + l : l}</option>`).join("")}</select><span class="hint">يهدّئ النقاشات الساخنة. لا يشمل المشرفين.</span></label>
        ${sw("ce-a", "موافقة على المنشورات", "منشورات الأعضاء هنا تنتظر المراجعة", v.requireApproval)}
        ${(st.tags || []).length ? sw("ce-t", "الوسم إلزامي", "يختار الكاتب وسماً قبل النشر هنا", v.topicRequired) : ""}
        ${sw("ce-def", "القناة الافتراضية للقادمين", "يفتح عليها الأعضاء الجدد صفحة المجتمع", v.isDefault)}
        <div class="field"><span class="lbl" id="ce-tl">أنواع المحتوى المسموحة</span><div class="ca-chips" role="group" aria-labelledby="ce-tl">${CTYPES.map(([k, l, i]) => `<label class="ca-pick"><input type="checkbox" data-ty="${k}" ${!v.allowedTypes.length || v.allowedTypes.includes(k) ? "checked" : ""}><span>${ic(i, "xs")}${l}</span></label>`).join("")}</div><span class="hint">النص مسموح دائماً. كل الأنواع مفعّلة = يتبع إعداد المجتمع.</span></div>
        <div class="ca-ask-acts"><button type="button" class="btn grow" id="ce-go">${x ? "حفظ القناة" : "إنشاء القناة"}</button><button type="button" class="btn ghost grow" data-ui="close-sheet">إلغاء</button></div>
        ${x ? `<div class="ca-durs">${x.archivedAt ? `<button type="button" class="btn ghost sm" id="ce-res">${ic("unarchive", "xs")} استعادة القناة</button>` : `<button type="button" class="btn ghost sm" id="ce-arc">${ic("archive", "xs")} أرشفة (للقراءة فقط)</button>`}<button type="button" class="btn ghost sm ca-danger" id="ce-del">${ic("trash", "xs")} حذف نهائي</button></div>` : ""}</div>`);
      const S$ = (s) => document.querySelector("#sheet " + s);
      document.querySelectorAll("#sheet .switch[data-k]").forEach((i) => { i.id = i.dataset.k; });
      document.querySelectorAll("#sheet [data-ico]").forEach((b) => (b.onclick = () => document.querySelectorAll("#sheet [data-ico]").forEach((y) => y.setAttribute("aria-checked", String(y === b)))));
      S$("#ce-k").onchange = (e) => { if (e.target.value === "announcements") S$('input[name=ce-p][value=mods]').checked = true; const want = KIND_I[e.target.value] || "hash"; document.querySelectorAll("#sheet [data-ico]").forEach((y) => y.setAttribute("aria-checked", String(y.dataset.ico === want))); };
      S$("#ce-go").onclick = async (e) => {
        const name = S$("#ce-n").value.trim(); if (!name) return toast("اكتب اسماً للقناة");
        const types = [...document.querySelectorAll("#sheet [data-ty]")].filter((i) => i.checked).map((i) => i.dataset.ty);
        const b = { name, desc: S$("#ce-d").value.trim(), kind: S$("#ce-k").value, icon: S$("[data-ico][aria-checked=true]")?.dataset.ico || null, viewPerm: S$("input[name=ce-v]:checked").value, postPerm: S$("input[name=ce-p]:checked").value,
          viewRoles: [...document.querySelectorAll("#sheet [data-vr]:checked")].map((i) => i.dataset.vr), postRoles: [...document.querySelectorAll("#sheet [data-pr]:checked")].map((i) => i.dataset.pr), slowModeSec: +S$("#ce-s").value,
          requireApproval: !!S$("#ce-a")?.checked, topicRequired: !!S$("#ce-t")?.checked, isDefault: !!S$("#ce-def")?.checked, allowedTypes: types.length === CTYPES.length ? [] : types, group: S$("#ce-g")?.value || null };
        if (!types.length) b.allowedTypes = ["text"]; // nothing but text
        busy(e.target, true);
        try { if (x) await api("PATCH", `/api/communities/${st.cid}/channels/${x.id}`, b); else await api("POST", `/api/communities/${st.cid}/channels`, b); closeSheet(); toast(x ? "✓ حُفظت القناة" : "✓ أُنشئت القناة"); reload(); if (typeof refresh === "function") refresh(); }
        catch (er) { toast(er.message); busy(e.target, false); }
      };
      S$("#ce-arc")?.addEventListener("click", async () => { const r = await ask({ title: `أرشفة «${x.name}»؟`, text: "تصبح للقراءة فقط وتنتقل إلى «مؤرشفة». تبقى منشوراتها ومن يراها كما هم، ويمكنك الاستعادة.", ok: "أرشفة" }); if (!r) return; try { await api("POST", `/api/communities/${st.cid}/channels/${x.id}/archive`); toast("أُرشفت القناة"); reload(); } catch (er) { toast(er.message); } });
      S$("#ce-res")?.addEventListener("click", async () => { try { await api("POST", `/api/communities/${st.cid}/channels/${x.id}/restore`); closeSheet(); toast("✓ استُعيدت القناة"); reload(); } catch (er) { toast(er.message); } });
      S$("#ce-del")?.addEventListener("click", async () => { const r = await ask({ title: `حذف «${x.name}» نهائياً؟`, text: x.viewPerm === "public" ? "تنتقل منشوراتها إلى المجتمع العام. لا يمكن التراجع. الأرشفة بديل آمن." : "تبقى منشوراتها للأعضاء فقط. لا يمكن التراجع. الأرشفة بديل آمن.", ok: "حذف نهائي", danger: true, type: x.name }); if (!r) return; try { await api("DELETE", `/api/communities/${st.cid}/channels/${x.id}`); toast("حُذفت القناة"); reload(); } catch (er) { toast(er.message); } });
    }
    st.tags = (await api("GET", `/api/communities/${st.cid}/space`).catch(() => ({ identity: { tags: [] } }))).identity.tags;
    paint();
  }

  /* ======================= 6. content, pins & announcements (v2.58) ======================= */
  async function secContent(body) {
    const own = has("edit_settings"), canPin = has("pin"), canAnn = has("announce");
    const [cs, pins, anns, feed] = await Promise.all([api("GET", `/api/communities/${st.cid}/settings`).catch(() => ({ sections: {} })), api("GET", `/api/communities/${st.cid}/pins`).catch(() => ({ pins: [] })), canAnn ? api("GET", `/api/communities/${st.cid}/announcements`) : { announcements: [] }, canPin ? api("GET", `/api/communities/${st.cid}/posts`) : { posts: [] }]);
    const types = cs.sections.content?.values?.contentTypes || [];
    const LV = { info: ["عادي", ""], important: ["مهم", "danger"] }, STS = { live: ["ظاهر الآن", "ok"], scheduled: ["مجدول", "acc"], ended: ["انتهى", ""] };
    const dt = (t) => new Date(t).toLocaleString(loc(), { numberingSystem: "latn", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    body.innerHTML = `<div id="ca-form" class="ca-form">${card("الأنواع المسموحة في المجتمع", "layers", `<p class="muted">ما يستطيع الأعضاء نشره هنا. النص مسموح دائماً، وتستطيع كل قناة أن تضيّق أكثر.</p><div class="ca-chips" role="group" aria-label="الأنواع المسموحة">${CTYPES.map(([k, l, i]) => `<label class="ca-pick"><input type="checkbox" data-k="ty:${k}" ${!types.length || types.includes(k) ? "checked" : ""} ${own ? "" : "disabled"}><span>${ic(i, "xs")}${l}</span></label>`).join("")}</div>
      <div class="list flat ca-lnk">${UI.li({ href: href(st.cid, "general"), icon: "sliders", title: "الروابط والوسائط والمحتوى التجاري والمساعد الذكي", sub: "في «عام والهوية» ← النشر والمحتوى" })}</div>`, { lock: own ? "" : "الأنواع المسموحة للمالك" })}</div>
      ${card("المثبّتات", "pin", `<p class="muted">حتى 5 منشورات أعلى صفحة المجتمع، و3 لكل قناة. يمكن أن ينتهي التثبيت تلقائياً.</p><ul class="ca-rows" id="ca-pins"></ul>${canPin ? `<details class="ca-more" id="ca-pinpick"><summary>${ic("plus", "xs")} ثبّت منشوراً</summary><div class="ca-inline ca-pindur"><label class="lbl" for="ca-pind">المدة</label><select id="ca-pind"><option value="0">بلا انتهاء</option><option value="1">يوم</option><option value="7">أسبوع</option><option value="30">شهر</option></select></div><ul class="ca-rows" id="ca-recent"></ul></details>` : ""}`, { lock: canPin ? "" : "التثبيت لفريق الإشراف", id: "ca-pincard" })}
      ${card("الإعلانات", "mega", `<p class="muted">شريط أعلى صفحة المجتمع. المهم يُبرز بلون التنبيه، ويمكن أن يرسل إشعاراً مرة في اليوم.</p>${canAnn ? `<button type="button" class="btn sm" id="ca-annnew">${ic("plus", "xs")} إعلان جديد</button>` : ""}<ul class="ca-rows" id="ca-anns"></ul>`, { lock: canAnn ? "" : "الإعلانات لفريق الإشراف", id: "ca-anncard" })}`;
    let P = pins.pins;
    const paintPins = () => {
      const box = body.querySelector("#ca-pins"), groups = [[null, "للمجتمع"], ...[...new Set(P.filter((p) => p.channel).map((p) => p.channel))].map((c) => [c, "في قناة"])];
      box.innerHTML = P.length ? groups.map(([c]) => P.filter((p) => (p.channel || null) === c)).flat().map((p, i) => `<li class="ca-row"><span class="ca-ci">${ic("pin", "sm")}</span><div class="grow"><b class="ca-clamp">${h(p.post.title || p.post.text.slice(0, 140) || "منشور")}</b><small>${h(p.post.author?.name || "")} · ${p.channel ? "مثبّت في قناته" : "مثبّت للمجتمع"}${p.until ? " · ينتهي " + h(when(p.until)) : ""}</small></div>${canPin ? `<span class="ca-ra"><button type="button" class="btn ghost icon" data-pmv="-1" data-p="${h(p.id)}" aria-label="تقديم" ${i === 0 ? "disabled" : ""}>${ic("arrowUp", "xs")}</button><button type="button" class="btn ghost icon" data-unpin="${h(p.id)}" aria-label="إلغاء التثبيت">${ic("x", "xs")}</button></span>` : ""}</li>`).join("") : `<li class="ca-row">${UI.empty({ title: "لا مثبّتات بعد", text: canPin ? "ثبّت منشوراً مهماً ليبقى في الأعلى." : "" })}</li>`;
      box.querySelectorAll("[data-unpin]").forEach((b) => (b.onclick = async () => { try { await api("DELETE", `/api/communities/${st.cid}/pins/${b.dataset.unpin}`); P = P.filter((p) => p.id !== b.dataset.unpin); paintPins(); paintRecent(); toast("أُلغي التثبيت"); } catch (e) { toast(e.message); } }));
      box.querySelectorAll("[data-pmv]").forEach((b) => (b.onclick = async () => { const i = P.findIndex((p) => p.id === b.dataset.p); if (i < 1) return; [P[i - 1], P[i]] = [P[i], P[i - 1]]; try { P = (await api("PUT", `/api/communities/${st.cid}/pins/order`, { ids: P.map((p) => p.id) })).pins; paintPins(); } catch (e) { toast(e.message); } }));
    };
    const paintRecent = () => {
      const box = body.querySelector("#ca-recent"); if (!box) return; const pinned = new Set(P.map((p) => p.post.id));
      const list = feed.posts.filter((p) => !pinned.has(p.id)).slice(0, 12);
      box.innerHTML = list.length ? list.map((p) => `<li class="ca-row"><div class="grow"><b class="ca-clamp">${h((p.title || p.text || "منشور").slice(0, 140))}</b><small>${h(rel(p.createdAt))}</small></div><span class="ca-ra"><button type="button" class="btn ghost sm" data-pin="${h(p.id)}" data-scope="community">للمجتمع</button>${p.channel ? `<button type="button" class="btn ghost sm" data-pin="${h(p.id)}" data-scope="channel">في قناته</button>` : ""}</span></li>`).join("") : `<li class="ca-row muted">لا منشورات حديثة للتثبيت.</li>`;
      box.querySelectorAll("[data-pin]").forEach((b) => (b.onclick = async () => { busy(b, true); try { const r = await api("POST", `/api/communities/${st.cid}/pins`, { post: b.dataset.pin, scope: b.dataset.scope, days: +body.querySelector("#ca-pind").value || undefined }); P = (await api("GET", `/api/communities/${st.cid}/pins`)).pins; paintPins(); paintRecent(); toast(r.pin ? "✓ ثُبّت المنشور" : "✓"); } catch (e) { toast(e.message); busy(b, false); } }));
    };
    let A = anns.announcements;
    const paintAnns = () => {
      const box = body.querySelector("#ca-anns");
      box.innerHTML = A.length ? A.map((a) => `<li class="ca-row"><span class="ca-ci${a.level === "important" ? " ca-imp" : ""}">${ic(a.level === "important" ? "alert" : "mega", "sm")}</span><div class="grow"><b>${h(a.title)}</b><small>${h(dt(a.startsAt))}${a.endsAt ? " ← " + h(dt(a.endsAt)) : " · بلا انتهاء"}${a.dismissible ? "" : " · لا يُغلق"}${a.notified ? " · أُرسل إشعار" : ""}</small><span class="ca-meta">${badge(STS[a.status][0], STS[a.status][1])}${badge(LV[a.level][0], LV[a.level][1])}</span></div>${canAnn ? `<span class="ca-ra"><button type="button" class="btn ghost icon" data-aed="${h(a.id)}" aria-label="تعديل ${h(a.title)}">${ic("pen", "xs")}</button><button type="button" class="btn ghost icon" data-adel="${h(a.id)}" aria-label="حذف ${h(a.title)}">${ic("trash", "xs")}</button></span>` : ""}</li>`).join("") : `<li class="ca-row">${UI.empty({ title: "لا إعلانات", text: canAnn ? "أعلن عن لقاء أو تغيير مهم في أعلى الصفحة." : "" })}</li>`;
      box.querySelectorAll("[data-aed]").forEach((b) => (b.onclick = () => annEditor(A.find((a) => a.id === b.dataset.aed))));
      box.querySelectorAll("[data-adel]").forEach((b) => (b.onclick = async () => { const a = A.find((x) => x.id === b.dataset.adel); const r = await ask({ title: `حذف الإعلان «${a.title}»؟`, ok: "حذف", danger: true }); if (!r) return; try { await api("DELETE", `/api/communities/${st.cid}/announcements/${a.id}`); A = A.filter((x) => x.id !== a.id); paintAnns(); toast("حُذف الإعلان"); } catch (e) { toast(e.message); } }));
    };
    const local = (t) => (t ? new Date(new Date(t) - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 16) : "");
    function annEditor(a) {
      sheet(`<h3 class="u-mt0">${a ? "تعديل الإعلان" : "إعلان جديد"}</h3><label class="field"><span class="lbl">العنوان</span><input id="an-t" maxlength="120" value="${h(a?.title || "")}" placeholder="${h(tr("مثل: لقاء الأعضاء الخميس 9 مساءً"))}"></label>
        <label class="field"><span class="lbl">التفاصيل (اختياري)</span><textarea id="an-b" maxlength="600" rows="3">${h(a?.body || "")}</textarea></label>
        <div class="field"><span class="lbl">الأهمية</span><div class="seg ca-segw" role="radiogroup" aria-label="الأهمية"><label class="ca-seg"><input type="radio" name="an-l" value="info" ${a?.level !== "important" ? "checked" : ""}><span>عادي</span></label><label class="ca-seg"><input type="radio" name="an-l" value="important" ${a?.level === "important" ? "checked" : ""}><span>مهم</span></label></div></div>
        <div class="ca-2"><label class="field"><span class="lbl">يبدأ</span><input type="datetime-local" id="an-s" value="${h(local(a?.startsAt))}"><span class="hint">فارغ = الآن</span></label><label class="field"><span class="lbl">ينتهي</span><input type="datetime-local" id="an-e" value="${h(local(a?.endsAt))}"><span class="hint">فارغ = بلا انتهاء</span></label></div>
        ${sw("an-d", "يستطيع العضو إغلاقه", "يختفي عنده بعد الإغلاق", a ? a.dismissible : true)}
        ${a ? "" : sw("an-n", "أرسل إشعاراً للأعضاء", "للإعلان المهم فقط، مرة واحدة في اليوم", false)}
        <div class="ca-ask-acts"><button type="button" class="btn grow" id="an-go">${a ? "حفظ" : "نشر الإعلان"}</button><button type="button" class="btn ghost grow" data-ui="close-sheet">إلغاء</button></div>`);
      document.querySelectorAll("#sheet .switch[data-k]").forEach((i) => { i.id = i.dataset.k; });
      document.getElementById("an-go").onclick = async (e) => {
        const g = (s) => document.getElementById(s), lvl = document.querySelector("#sheet input[name=an-l]:checked").value;
        const b = { title: g("an-t").value.trim(), body: g("an-b").value.trim(), level: lvl, startsAt: g("an-s").value ? new Date(g("an-s").value).toISOString() : undefined, endsAt: g("an-e").value ? new Date(g("an-e").value).toISOString() : null, dismissible: g("an-d").checked, notify: !!g("an-n")?.checked && lvl === "important" };
        if (!b.title) return toast("اكتب عنواناً للإعلان"); busy(e.target, true);
        try { const r = a ? await api("PATCH", `/api/communities/${st.cid}/announcements/${a.id}`, b) : await api("POST", `/api/communities/${st.cid}/announcements`, b); closeSheet(); A = (await api("GET", `/api/communities/${st.cid}/announcements`)).announcements; paintAnns(); toast(r.notifySkipped ? "نُشر الإعلان دون إشعار: أُرسل إشعار مهم خلال آخر 24 ساعة" : r.notified ? `✓ نُشر الإعلان وأُشعر ${num(r.notified)} عضواً` : "✓ حُفظ الإعلان"); }
        catch (er) { toast(er.message); busy(e.target, false); }
      };
    }
    body.querySelector("#ca-annnew")?.addEventListener("click", () => annEditor(null));
    paintPins(); paintRecent(); paintAnns();
    const root = body.querySelector("#ca-form");
    form(root, async (v) => { const sel = CTYPES.map(([k]) => k).filter((k) => v["ty:" + k]); await api("PATCH", `/api/communities/${st.cid}/settings/content`, { contentTypes: sel.length === CTYPES.length ? [] : sel.length ? sel : ["text"] }); /* none ticked = text only */ });
  }

  /* ======================= 9. rules & welcome (v2.58) ======================= */
  const SEV = [["info", "معلومة"], ["warn", "تنبيه"], ["serious", "جسيمة"]];
  async function secRules(body) {
    const own = has("edit_rules"), idEd = has("edit_identity");
    const [rr, sp, chs, stats] = await Promise.all([api("GET", `/api/communities/${st.cid}/rules`), api("GET", `/api/communities/${st.cid}/space`), api("GET", `/api/communities/${st.cid}/channels`), api("GET", `/api/communities/${st.cid}/onboarding/stats`).catch(() => null)]);
    const w = sp.identity.welcome || { message: "", steps: [] }, live = chs.channels.filter((x) => !x.archivedAt), def = live.find((x) => x.isDefault);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    body.innerHTML = `<div id="ca-form" class="ca-form">
      ${card("قواعد المجتمع", "shield", `<p class="muted">عنوان قصير، وشرح اختياري، ودرجة الخطورة. تظهر مرقّمة في «عن المجتمع» وعند الانضمام.</p><div class="ca-rules" data-rules><ol class="ca-rl"></ol>${own ? `<button type="button" class="btn ghost sm ca-radd">${ic("plus", "xs")} إضافة قاعدة</button>` : ""}</div>
        ${sw("rulesRequired", "الموافقة على القواعد إلزامية", "يوافق العضو على القواعد قبل أول منشور", !!rr.required, !own)}`, { lock: own ? "" : "تعديل القواعد للمالك فقط" })}
      ${card("رسالة الترحيب وخطوات البداية", "sparkle", `<label class="field"><span class="lbl">الرسالة</span><textarea data-k="welcome" maxlength="1000" rows="3" placeholder="${h(tr("أهلاً بك! ابدأ بالتعريف بنفسك."))}" ${idEd ? "" : "disabled"}>${h(w.message || "")}</textarea></label><span class="lbl ca-sublbl">خطوات البداية</span>${listEditor("steps", null, { max: 6, ph: "مثل: عرّف بنفسك في قناة الترحيب", label: "الخطوة", dis: !idEd })}<p class="hint">خطوة فيها «منشور» أو «عرّف بنفسك» تكتمل تلقائياً عند أول منشور، وخطوة فيها «ملفك» تكتمل من الملف الشخصي.</p>
        <label class="field"><span class="lbl">القناة الافتراضية للقادمين</span><select data-k="defaultChannel" ${has("manage_channels") ? "" : "disabled"}><option value="">بلا قناة: يرون كل المنشورات</option>${live.map((x) => `<option value="${h(x.id)}" ${def?.id === x.id ? "selected" : ""}>${h(x.name)}</option>`).join("")}</select></label>`, { lock: idEd ? "" : "للمالك والمديرين" })}
    </div>
    ${stats ? card("هل يكمل الجدد خطوات البداية؟", "chart", stats.newMembers ? `<div class="kpi-grid ca-kpis ca-kpi3"><div class="kpi-tile ca-kpi"><span class="ca-kpi-l">${ic("users", "xs")}انضموا</span><b>${num(stats.newMembers)}</b><small>آخر 30 يوماً</small></div><div class="kpi-tile ca-kpi"><span class="ca-kpi-l">${ic("play", "xs")}بدؤوا</span><b>${num(pct(stats.started, stats.newMembers))}%</b><small>خطوة أو أكثر</small></div><div class="kpi-tile ca-kpi"><span class="ca-kpi-l">${ic("okCircle", "xs")}أكملوا</span><b>${num(pct(stats.completed, stats.newMembers))}%</b><small>كل الخطوات</small></div></div>
      ${stats.perStep.length ? `<ul class="ca-bars">${stats.perStep.map((s) => `<li><span>${h(s.label)}</span><i class="ca-bar" data-w="${pct(s.done, stats.newMembers)}"><b></b></i><small>${num(pct(s.done, stats.newMembers))}%</small></li>`).join("")}</ul>` : ""}` : `<p class="muted">لا أعضاء جدد خلال 30 يوماً بعد.</p>`, { id: "ca-obstats" }) : ""}
    ${card("معاينة تجربة العضو الجديد", "eye", `<ol class="ca-flow"><li><b>${ic("shield", "xs")} القواعد</b><small>${rr.rules.length ? `${num(rr.rules.length)} قاعدة${rr.required ? "، وموافقته إلزامية قبل أول منشور" : ""}` : "لا قواعد بعد"}</small></li><li><b>${ic("sparkle", "xs")} الترحيب</b><small>${h(w.message || "بلا رسالة ترحيب")}</small>${(w.steps || []).length ? `<ul>${w.steps.map((s) => `<li>${ic("check", "xs")}${h(s)}</li>`).join("")}</ul>` : ""}</li><li><b>${ic("hash", "xs")} أول قناة</b><small>${def ? `يفتح على «${h(def.name)}»` : "يرى كل المنشورات"}</small></li></ol>`, { id: "ca-flow" })}`;
    const root = body.querySelector("#ca-form"), rbox = root.querySelector("[data-rules]"), ol = rbox.querySelector(".ca-rl");
    const rowR = (r, i) => `<li class="ca-ru" data-id="${h(r.id || "")}"><span class="ca-n">${num(i + 1)}</span><div class="grow"><input class="ca-rt" value="${h(r.title)}" maxlength="200" placeholder="${h(tr("عنوان القاعدة"))}" aria-label="${h(tr(`عنوان القاعدة ${i + 1}`))}" ${own ? "" : "disabled"}><textarea class="ca-rb" rows="2" maxlength="1000" placeholder="${h(tr("شرح اختياري: ماذا تعني ولماذا"))}" aria-label="${h(tr(`شرح القاعدة ${i + 1}`))}" ${own ? "" : "disabled"}>${h(r.body || "")}</textarea>
      <div class="ca-sev" role="radiogroup" aria-label="خطورة القاعدة ${i + 1}">${SEV.map(([k, l]) => `<label class="ca-seg sev-${k}"><input type="radio" name="sev-${i}" value="${k}" ${r.severity === k ? "checked" : ""} ${own ? "" : "disabled"}><span>${l}</span></label>`).join("")}</div></div>
      ${own ? `<span class="ca-lia"><button type="button" class="btn ghost icon" data-rmv="-1" aria-label="تقديم القاعدة ${i + 1}">${ic("arrowUp", "xs")}</button><button type="button" class="btn ghost icon" data-rmv="1" aria-label="تأخير القاعدة ${i + 1}">${ic("arrowDn", "xs")}</button><button type="button" class="btn ghost icon" data-rrm aria-label="حذف القاعدة ${i + 1}">${ic("x", "xs")}</button></span>` : ""}</li>`;
    const get = () => [...ol.children].map((li) => ({ id: li.dataset.id || undefined, title: li.querySelector(".ca-rt").value.trim(), body: li.querySelector(".ca-rb").value.trim(), severity: li.querySelector("input[type=radio]:checked")?.value || "info" }));
    const set = (arr) => { ol.innerHTML = arr.map(rowR).join("") || `<li class="muted ca-rnone">لا قواعد بعد.</li>`; const add = rbox.querySelector(".ca-radd"); if (add) add.disabled = arr.length >= 20; };
    rbox._get = () => get().filter((r) => r.title); rbox._set = set; set(rr.rules);
    rbox.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || !own) return; const v = get(), li = b.closest(".ca-ru"), i = li ? [...ol.children].indexOf(li) : -1;
      if (b.classList.contains("ca-radd")) { v.push({ title: "", body: "", severity: "info" }); set(v.filter((r, k) => r.title || k === v.length - 1)); ol.lastElementChild?.querySelector(".ca-rt")?.focus(); }
      else if (b.hasAttribute("data-rrm")) { v.splice(i, 1); set(v); }
      else if (b.dataset.rmv) { const j = i + +b.dataset.rmv; if (j < 0 || j >= v.length) return; [v[i], v[j]] = [v[j], v[i]]; set(v); ol.children[j]?.querySelector(`[data-rmv="${b.dataset.rmv}"]`)?.focus(); }
      else return;
      root.dispatchEvent(new Event("change"));
    });
    wireLists(root, { steps: w.steps || [] });
    body.querySelectorAll(".ca-bar[data-w]").forEach((el) => el.style.setProperty("--w", el.dataset.w + "%"));
    form(root, async (v, o) => {
      if (own && (JSON.stringify(v.rules) !== JSON.stringify(o.rules) || v.rulesRequired !== o.rulesRequired)) { await api("PUT", `/api/communities/${st.cid}/rules`, { rules: v.rules, required: v.rulesRequired }); }
      if (idEd && (v.welcome !== o.welcome || JSON.stringify(v.steps) !== JSON.stringify(o.steps))) await api("PATCH", `/api/communities/${st.cid}/identity`, { welcome: v.welcome.trim() || v.steps.length ? { message: v.welcome.trim(), steps: v.steps } : null });
      if (v.defaultChannel !== o.defaultChannel) { if (v.defaultChannel) await api("PATCH", `/api/communities/${st.cid}/channels/${v.defaultChannel}`, { isDefault: true }); else if (o.defaultChannel) await api("PATCH", `/api/communities/${st.cid}/channels/${o.defaultChannel}`, { isDefault: false }); }
      if (typeof refresh === "function") refresh();
    });
  }

  /* ======================= 11. knowledge base (v2.58) ======================= */
  async function secKnowledge(body) {
    const lock = has("wiki_lock"), faqEd = has("faq_edit");
    const [wiki, faq, recent] = await Promise.all([api("GET", `/api/communities/${st.cid}/wiki`), api("GET", `/api/communities/${st.cid}/faq`), lock ? api("GET", `/api/communities/${st.cid}/wiki-recent`).catch(() => ({ edits: [] })) : { edits: [] }]);
    const secs = [...new Set(wiki.pages.map((p) => p.section).filter(Boolean))].sort();
    const bySec = [...secs.map((s) => [s, wiki.pages.filter((p) => p.section === s)]), ["", wiki.pages.filter((p) => !p.section)]].filter(([, l]) => l.length);
    const W = (slug) => `#/wiki/${h(st.cid)}/${encodeURIComponent(slug)}`;
    body.innerHTML = `${card("صفحات الويكي", "book", `<p class="muted">نظّم الصفحات في أقسام، واقفل ما لا يجب أن يعدّله الأعضاء.</p><div class="ca-durs"><a class="btn sm" href="#/wiki/${h(st.cid)}/new">${ic("plus", "xs")} صفحة جديدة</a></div>
      <datalist id="ca-secs">${secs.map((s) => `<option value="${h(s)}">`).join("")}</datalist>
      ${bySec.length ? bySec.map(([s, l]) => `<h4 class="ca-sublbl">${s ? h(s) : "بلا قسم"} <small class="muted">(${num(l.length)})</small></h4><ul class="ca-rows">${l.map((p) => `<li class="ca-row"><span class="ca-ci">${ic(p.locked ? "lock" : "doc", "sm")}</span><div class="grow"><a href="${W(p.slug)}"><b>${h(p.title)}</b></a><small>النسخة ${num(p.version)} · ${h(rel(p.updatedAt))}</small>
        ${lock ? `<div class="ca-inline ca-wsec"><input list="ca-secs" value="${h(p.section || "")}" maxlength="40" placeholder="${h(tr("القسم"))}" aria-label="قسم ${h(p.title)}" data-sec-of="${h(p.slug)}"><label class="ca-chk"><input type="checkbox" data-lock-of="${h(p.slug)}" ${p.locked ? "checked" : ""}> مقفلة</label></div>` : ""}</div>
        ${lock ? `<span class="ca-ra"><button type="button" class="btn ghost icon" data-wdel="${h(p.slug)}" aria-label="حذف ${h(p.title)}">${ic("trash", "xs")}</button></span>` : ""}</li>`).join("")}</ul>`).join("") : UI.empty({ title: "لا صفحات بعد", text: "ابدأ بصفحة «ابدأ هنا» تشرح المجتمع وقواعده." })}`, { lock: lock ? "" : "تنظيم الصفحات لفريق الإشراف", id: "ca-wiki" })}
      ${card("الأسئلة الشائعة", "help", `${faqEd ? `<div class="ca-durs"><a class="btn ghost sm" href="#/wiki/${h(st.cid)}/new?faq=1">${ic("plus", "xs")} سؤال شائع</a></div>` : ""}${faq.faq.length ? `<ul class="ca-rows">${faq.faq.map((f) => `<li class="ca-row"><span class="ca-ci">${ic("help", "sm")}</span><a class="grow" href="${W(f.slug)}"><b>${h(f.q)}</b></a></li>`).join("")}</ul>` : `<p class="muted">لا أسئلة شائعة بعد.</p>`}`, { id: "ca-faq" })}
      ${lock ? card("آخر التعديلات", "clock", recent.edits.length ? `<ul class="ca-log">${recent.edits.map((e) => `<li><span class="ca-dot" aria-hidden="true"></span><span class="grow"><b><a href="${W(e.slug)}">${h(e.title)}</a></b><small>${h(e.author || "")} · النسخة ${num(e.version)}${e.summary ? " · " + h(e.summary) : ""}</small></span><time>${h(rel(e.at))}</time></li>`).join("")}</ul>` : `<p class="muted">لا تعديلات بعد.</p>`, { id: "ca-wrecent" }) : ""}
      <div class="list ca-lnk">${UI.li({ href: `#/c/${h(st.cid)}/knowledge`, icon: "link", title: "الموارد والأسئلة والأجوبة", sub: "في تبويب «المعرفة» بصفحة المجتمع" })}${UI.li({ href: "#/knowledge", icon: "globe", title: "مكتبة المعرفة المفتوحة", sub: "انشر صفحة للعامة خارج المجتمع" })}</div>`;
    body.querySelectorAll("[data-sec-of]").forEach((i) => (i.onchange = async () => { try { await api("PATCH", `/api/communities/${st.cid}/wiki/${encodeURIComponent(i.dataset.secOf)}/section`, { section: i.value.trim() }); toast("✓ حُفظ القسم"); secKnowledge(body); } catch (e) { toast(e.message); } }));
    body.querySelectorAll("[data-lock-of]").forEach((i) => (i.onchange = async () => { try { await api("PATCH", `/api/communities/${st.cid}/wiki/${encodeURIComponent(i.dataset.lockOf)}`, { locked: i.checked }); toast(i.checked ? "قُفلت الصفحة" : "فُتحت الصفحة"); } catch (e) { i.checked = !i.checked; toast(e.message); } }));
    body.querySelectorAll("[data-wdel]").forEach((b) => (b.onclick = async () => { const r = await ask({ title: "حذف الصفحة؟", text: "تُحذف الصفحة ونسخها. لا يمكن التراجع.", ok: "حذف", danger: true }); if (!r) return; try { await api("DELETE", `/api/communities/${st.cid}/wiki/${encodeURIComponent(b.dataset.wdel)}`); toast("حُذفت الصفحة"); secKnowledge(body); } catch (e) { toast(e.message); } }));
  }

  /* the growth & health screens (v2.5–v2.56), hosted only here since v2.58 (moved out of the communities chunk) */
  const $ = (s) => document.querySelector(s);
  async function healthView(cid, host) {
    const root = host || view, wrap = (x) => host ? x : `<div class="wrap">${x}</div>`;
    root.innerHTML = wrap(`<div class="skel"></div>`);
    const h = await api("GET", `/api/communities/${cid}/health`).catch(e => ({ error: e.message })); if (h.error) { root.innerHTML = wrap(`<div class="empty">${esc(h.error)}</div>`); return; }
    const ring = (v) => `<svg viewBox="0 0 120 120" class="h-ring" aria-label="درجة الصحة ${v}"><circle cx="60" cy="60" r="52" stroke="var(--line)" stroke-width="12" fill="none"/><circle cx="60" cy="60" r="52" stroke="${v >= 80 ? "var(--ok)" : v >= 60 ? "var(--accent)" : v >= 40 ? "var(--warn)" : "var(--danger)"}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${v * 3.27} 400" transform="rotate(-90 60 60)"/><text x="60" y="68" text-anchor="middle" font-size="30" font-weight="800" fill="currentColor">${v}</text></svg>`;
    const series = h.series.map(s => s.active_users), max = Math.max(1, ...series);
    root.innerHTML = wrap(`${host ? "" : UI.pageHead({ back: [`#/cadmin/${cid}`, "لوحة الإدارة"], title: "تقرير صحة المجتمع", icon: "chart" })}
      <div class="card h-top">${ring(h.score)}<div><b class="u-t-2xl">${esc(h.grade)}</b><div class="muted">${h.members} عضو · ${h.wau} نشِط هذا الأسبوع</div></div></div>
      <div class="kpi-grid">${[["نشطون يومياً", h.dau], ["نشطون أسبوعياً", h.wau + ` (${h.activeShare}%)`], ["الالتصاق DAU/MAU", h.stickiness + "%"], ["بقاء الجدد 30 يوماً", h.retention30 + "%"], ["أسئلة مُجابة", h.answerRate + "%"], ["أول رد (وسيط)", h.medianReplyMin === null ? "—" : h.medianReplyMin < 60 ? h.medianReplyMin + " د" : Math.round(h.medianReplyMin / 60) + " س"], ["طابور المراجعة", h.backlog], ["إجراءات إشراف 30 يوماً", h.modActions30]].map(([l, v]) => `<div class="kpi-card"><span class="muted">${l}</span><b>${v}</b></div>`).join("")}</div>
      ${series.length ? `<div class="card"><b>الأعضاء النشطون يومياً</b><div class="h-bars">${h.series.map(s => `<i style="height:${Math.max(4, s.active_users / max * 100)}%" title="${s.day}: ${s.active_users}"></i>`).join("")}</div></div>` : ""}
      <div class="card"><b>${ic("sparkle", "sm")} توصيات</b><ul class="h-tips">${h.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`);
  }

  MPCommunities.growthPanel = growthPanel; MPCommunities.healthView = healthView; // the names other code may still call
  async function secGrowth(body) { await growthPanel(st.cid, body, { noChannels: true }); }
  async function secHealth(body) { await healthView(st.cid, body); }

  /* ======================= 16. danger zone ======================= */
  async function secDanger(body) {
    const d = st.data, c = d.community, own = isOwner(), lockOk = has("manage_automod");
    const t = own ? (await api("GET", `/api/communities/${st.cid}/transfer`).catch(() => ({ transfer: null }))).transfer : null;
    const lockOn = c.lockdownUntil && new Date(c.lockdownUntil) > new Date();
    let admins = []; if (own) { try { admins = (await api("GET", `/api/communities/${st.cid}/members?role=admin&limit=100`)).members; } catch { admins = []; } }
    body.innerHTML = `
      ${card("إيقاف مؤقت للنشر", "octPause", lockOn ? `<p class="ca-state danger">${ic("octPause", "xs")} النشر متوقف حتى ${h(new Date(c.lockdownUntil).toLocaleString(loc(), { numberingSystem: "latn", dateStyle: "medium", timeStyle: "short" }))}. المشرفون فقط يستطيعون النشر.</p><button type="button" class="btn" id="ca-unlock">${ic("play", "xs")} استئناف النشر الآن</button>`
        : `<p class="muted">عند هجمة سبام أو نقاش خرج عن السيطرة: يتوقف نشر الأعضاء، ويبقى المشرفون قادرين على النشر والإعلان.</p><span class="lbl ca-sublbl">أوقف النشر لمدة</span><div class="ca-durs">${[[1, "ساعة"], [6, "6 ساعات"], [24, "يوم"], [72, "3 أيام"]].map(([v, l]) => `<button type="button" class="btn ghost sm" data-lock="${v}" ${lockOk ? "" : "disabled"}>${l}</button>`).join("")}</div>`, { lock: lockOk ? "" : "للمالك والمديرين", id: "ca-lockdown" })}
      ${card("تصدير بيانات المجتمع", "download", `<p class="muted">ملف JSON بالأعضاء والمنشورات والقنوات والويكي والقواعد والسجل، وCSV للأعضاء.</p><div class="ca-durs"><a class="btn ghost sm${own ? "" : " is-dis"}" ${own ? `href="/api/communities/${h(st.cid)}/export" download` : 'aria-disabled="true"'} id="ca-exp">${ic("download", "xs")} تنزيل JSON</a><a class="btn ghost sm${has("manage_roles") ? "" : " is-dis"}" ${has("manage_roles") ? `href="/api/communities/${h(st.cid)}/members?format=csv" download` : 'aria-disabled="true"'}>${ic("download", "xs")} الأعضاء CSV</a></div>`, { lock: own ? "" : "التصدير الكامل للمالك فقط", id: "ca-export" })}
      ${card(c.archivedAt ? "المجتمع مؤرشف" : "أرشفة المجتمع", "archive", c.archivedAt ? `<p class="muted">مؤرشف منذ ${h(when(c.archivedAt))}: يبقى كل شيء مرئياً للقراءة، ولا نشر ولا تعليق ولا انضمام.</p>${own ? `<button type="button" class="btn" id="ca-restore">${ic("unarchive", "xs")} استعادة المجتمع</button>` : ""}`
        : `<p class="muted">للقراءة فقط: يبقى المحتوى والأعضاء، ويتوقف النشر والتعليق والانضمام، ويظهر وسم «مؤرشف». يمكنك الاستعادة في أي وقت.</p>${own ? `<button type="button" class="btn ghost ca-danger" id="ca-archive">${ic("archive", "xs")} أرشفة المجتمع</button>` : ""}`, { lock: own ? "" : "للمالك فقط", id: "ca-arch" })}
      ${card("نقل الملكية", "crown", own ? (t ? `<div class="ca-tpend"><p><b>بانتظار قبول ${h(t.to.name || "")}</b><br><small class="muted">أُرسل ${h(rel(t.createdAt))} · ينتهي ${h(rel(t.expiresAt))}</small></p><button type="button" class="btn ghost sm" id="ca-tcancel">إلغاء الطلب</button></div>`
          : admins.length ? `<p class="muted">اختر مديراً. يصله طلب ليقبله خلال 72 ساعة، وبعد القبول تصبح أنت مديراً.</p><div class="ca-inline"><select id="ca-tto" aria-label="المدير المستلم">${admins.map((m) => `<option value="${h(m.user.id)}">${h(m.user.name)}</option>`).join("")}</select><button type="button" class="btn ghost sm ca-danger" id="ca-tgo">${ic("swap", "xs")} نقل الملكية</button></div>`
          : `<p class="muted">لا يوجد مديرون بعد. عيّن عضواً موثوقاً مديراً من «الأعضاء» أولاً.</p><a class="btn ghost sm" href="${href(st.cid, "members", "&f=staff")}">الأعضاء</a>`) : "", { lock: own ? "" : "للمالك فقط", id: "ca-transfer" })}
      <p class="ca-foot muted">${ic("infoC", "xs")} الحذف النهائي غير متاح. للأرشفة استخدم الخيار أعلاه، ولطلب حذف المجتمع راسل فريق الدعم من «تذاكر الدعم».</p>`;
    const reload = async () => { st.data = await api("GET", `/api/communities/${st.cid}/admin`).catch(() => st.data); render(); };
    body.querySelectorAll("[data-lock]").forEach((b) => (b.onclick = async () => { const hours = +b.dataset.lock; const r = await ask({ title: `إيقاف النشر ${b.textContent.trim()}؟`, text: "يتوقف نشر الأعضاء حتى نهاية المدة أو حتى تستأنفه.", ok: "إيقاف النشر", danger: true }); if (!r) return; try { await api("POST", `/api/communities/${st.cid}/lockdown`, { hours }); toast("توقف النشر مؤقتاً"); reload(); } catch (e) { toast(e.message); } }));
    body.querySelector("#ca-unlock")?.addEventListener("click", async () => { try { await api("POST", `/api/communities/${st.cid}/lockdown`, { hours: 0 }); toast("✓ استؤنف النشر"); reload(); } catch (e) { toast(e.message); } });
    body.querySelector("#ca-archive")?.addEventListener("click", async () => { const r = await ask({ title: "أرشفة المجتمع؟", text: "يصبح للقراءة فقط حتى تستعيده.", ok: "أرشفة", danger: true, type: c.name }); if (!r) return; try { await api("POST", `/api/communities/${st.cid}/archive`, { confirm: c.name }); toast("أُرشف المجتمع"); reload(); } catch (e) { toast(e.message); } });
    body.querySelector("#ca-restore")?.addEventListener("click", async () => { try { await api("POST", `/api/communities/${st.cid}/restore`); toast("✓ استُعيد المجتمع"); reload(); } catch (e) { toast(e.message); } });
    body.querySelector("#ca-tcancel")?.addEventListener("click", async () => { try { await api("DELETE", `/api/communities/${st.cid}/transfer`); toast("أُلغي الطلب"); reload(); } catch (e) { toast(e.message); } });
    body.querySelector("#ca-tgo")?.addEventListener("click", async () => { const sel = body.querySelector("#ca-tto"), name = sel.options[sel.selectedIndex].textContent; const r = await ask({ title: `نقل ملكية «${c.name}» إلى ${name}؟`, text: "يصله طلب ليقبله خلال 72 ساعة. بعد القبول يصبح المالك وتصبح أنت مديراً.", ok: "إرسال الطلب", danger: true, type: c.name }); if (!r) return; try { await api("POST", `/api/communities/${st.cid}/transfer`, { to: sel.value, confirm: c.name }); toast("✓ أُرسل طلب النقل"); reload(); } catch (e) { toast(e.message); } });
  }

  /* ======================= wiring ======================= */
  /* v2.59: a background refresh (sync.js re-render, window.__softRender) does not repaint the panel or the appeal page — they
   * read their own API, and a repaint under the finger lost taps (a sheet about to open, a half-made selection) */
  const soft = (sel) => window.__softRender && st.shownHash === location.hash && !!view.querySelector(sel);
  MPRoutes.extend((a) => ({ cappeal: () => { if (soft(".ap")) return; st.shownHash = location.hash; return appealView(String(a || "").split("?")[0]); } })); // v2.59: a member's decisions + appeals
  MPRoutes.extend((a) => ({ cadmin: () => { if (soft(".ca[data-sec]")) return; st.shownHash = location.hash; const id = String(a || "").split("?")[0]; if (!id) { document.body.classList.remove("ca-wide"); return indexView(); } return panel(id); } }));
  /* ======================= v2.59 «الإشراف v2» — the moderation section, rebuilt inside the panel =======================
   * Every legacy feature stays (queue with J/K/A/R/D/W/M/N, approve/reject/remove/dismiss, warn/mute, member notes, the
   * transparent log + CSV) and gains: filters and sort, claim («سأتولاها») / assign, bulk decisions, saved replies
   * («القوالب»), appeals, moderator notification preferences. Touch-first: every action is a ≥44 px button, select mode
   * uses checkboxes (no long-press, no hover-only), destructive steps go through the unified action sheet. */
  const MKIND = { post: ["منشور معلّق", "doc"], comment: ["تعليق معلّق", "comment"], report: ["بلاغ", "flag"], join: ["طلب انضمام", "uplus"] };
  const MTABS = [["queue", "الطابور", "list"], ["appeals", "الاستئنافات", "scale"], ["macros", "القوالب", "copy"], ["log", "السجل", "clock"], ["alerts", "التنبيهات", "bell"]];
  const MACT = { none: "بلا إجراء", approve: "قبول", reject: "رفض", remove: "حذف المحتوى", dismiss: "تجاهل البلاغ" }, MPEN = { none: "بلا عقوبة", warn: "إنذار", mute: "كتم", ban: "حظر" };
  const DURS = MPCommunities.MUTE_CHOICES || { label: "مدة الكتم", items: [[1, "ساعة"], [24, "يوم"], [168, "أسبوع"], [720, "شهر"]] };
  const mst = { tab: "queue", kind: "all", sort: "risk", sel: new Set(), selMode: false, cur: 0, macros: null, apSt: "open" };
  const ikey = (it) => it.kind + ":" + it.id;
  let modKeys = null;
  const SHORTCUTS = `<div class="as"><div class="as-h"><span class="as-ic" aria-hidden="true">${ic("keyboard", "sm")}</span><h3 class="u-m0">اختصارات طابور الإشراف</h3></div><dl class="mq2-keys">${[["J / ↓", "العنصر التالي"], ["K / ↑", "العنصر السابق"], ["A", "قبول"], ["R", "رفض أو حذف"], ["D", "تجاهل البلاغ"], ["C", "تولّي العنصر أو إلغاؤه"], ["X", "تحديد العنصر"], ["W", "إنذار"], ["M", "كتم"], ["N", "ملاحظات العضو"], ["?", "هذه القائمة"]].map(([k, l]) => `<dt><kbd>${k}</kbd></dt><dd>${l}</dd>`).join("")}</dl><button type="button" class="btn ghost block" data-ui="close-sheet">إغلاق</button></div>`;

  async function secModeration(body) {
    const t = hashParts().q.get("t"); mst.tab = t && MTABS.some((x) => x[0] === t) ? t : "queue";
    const n = st.data.counts, qn = (n.pendingPosts || 0) + (n.reports || 0);
    body.innerHTML = `<div class="mq2-tabs" role="tablist" aria-label="أقسام الإشراف">${MTABS.map(([k, l, i]) => `<button type="button" role="tab" class="mq2-tab${mst.tab === k ? " on" : ""}" data-mtab="${k}" id="mt-${k}" aria-selected="${mst.tab === k}" aria-controls="m-body" tabindex="${mst.tab === k ? 0 : -1}">${ic(i, "xs")}<span>${l}</span>${k === "queue" && qn ? `<i class="ca-count">${num(qn)}</i>` : ""}</button>`).join("")}</div><div id="m-body" role="tabpanel" aria-labelledby="mt-${mst.tab}"><div class="skel"></div></div>`;
    const tabs = [...body.querySelectorAll("[data-mtab]")];
    tabs.forEach((b, i) => {
      b.onclick = () => { mst.tab = b.dataset.mtab; history.replaceState(null, "", href(st.cid, "moderation", mst.tab === "queue" ? "" : "&t=" + mst.tab)); st.shownHash = location.hash; secModeration(body).then(() => body.querySelector(`[data-mtab="${mst.tab}"]`)?.focus()); };
      b.onkeydown = (e) => { const d = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0; if (!d) return; e.preventDefault(); const nx = tabs[(i + d + tabs.length) % tabs.length]; nx.focus(); nx.click(); };
    });
    const mb = body.querySelector("#m-body");
    try { await ({ queue: modQueue2, appeals: modAppeals, macros: modMacros, log: modLog2, alerts: modAlerts })[mst.tab](mb); } catch (e) { mb.innerHTML = errBox(e, true); }
  }
  async function loadMacros(force) { if (!mst.macros || force) mst.macros = (await api("GET", `/api/communities/${st.cid}/macros`).catch(() => ({ macros: [] }))).macros; return mst.macros; }

  function itemHtml(it, i) {
    const [kl, ki] = MKIND[it.kind] || [it.kind, "flag"], cl = it.claim, other = cl && !cl.mine;
    const prim = it.kind === "report" ? `<button type="button" class="btn sm danger" data-act="remove">${ic("trash", "xs")} حذف المحتوى</button><button type="button" class="btn ghost sm" data-act="dismiss">تجاهل البلاغ</button>`
      : `<button type="button" class="btn sm" data-act="approve">${ic("check", "xs")} قبول</button><button type="button" class="btn ghost sm" data-act="reject">${ic("x", "xs")} رفض</button>`;
    return `<article class="card mq-item mq2-it${i === mst.cur ? " sel" : ""}${other ? " is-claimed" : ""}" data-i="${i}" tabindex="${i === mst.cur ? 0 : -1}" aria-label="${h(kl)}${it.user ? " من " + h(it.user.name) : ""}">
      <div class="mq2-top"><label class="mq2-chk"><input type="checkbox" data-sel ${mst.sel.has(ikey(it)) ? "checked" : ""} aria-label="${h(it.user ? Tf("تحديد: {kind} من {name}", { kind: trI(kl), name: it.user.name }) : Tf("تحديد: {kind}", { kind: trI(kl) }))}"></label>
        <span class="ca-badge k-${it.kind}">${ic(ki, "xs")} ${h(kl)}</span>${it.toxicity >= 0.6 ? badge("إساءة " + num(Math.round(it.toxicity * 100)) + "٪", "danger") : ""}${it.auto ? badge("آلي", "acc") : ""}${cl ? `<span class="ca-badge ${cl.mine ? "ok" : "warn"}">${ic("ucheck", "xs")} ${cl.mine ? (cl.assigned ? "مُسند إليك" : "أنت تتولاه") : "يتولاه " + h(cl.name || "مشرف")}</span>` : ""}<span class="grow"></span><time class="muted">${h(rel(it.at))}</time><button type="button" class="btn ghost sm icon-only mq2-more" data-act="more" aria-label="إجراءات أخرى" aria-haspopup="dialog">${ic("more", "xs")}</button></div>
      ${it.user ? `<div class="mq-user mq2-u">${avatar(it.user)}<span class="mq2-un"><b>${h(it.user.name)}</b><small class="muted">@${h(it.user.handle)}</small></span>${it.user.warnings ? badge(num(it.user.warnings) + " إنذار", "warn") : ""}${it.user.notes ? badge(num(it.user.notes) + " ملاحظة") : ""}</div>` : ""}
      ${it.text ? `<p class="mq-text mq2-t">${h(it.text)}</p>` : ""}${it.answers?.length ? `<dl class="mq-ans mq2-ans">${it.answers.map((a) => `<dt>${h(a.q)}</dt><dd>${h(a.a || "—")}</dd>`).join("")}</dl>` : ""}
      <p class="mq2-why">${ic("flag", "xs")}<span>${h(it.reason)}</span></p>
      <div class="mq2-acts">${prim}${other ? "" : `<button type="button" class="btn ghost sm" data-act="${cl?.mine ? "release" : "claim"}" aria-pressed="${!!cl?.mine}">${ic("ucheck", "xs")} ${cl?.mine ? "إلغاء التولّي" : "سأتولاها"}</button>`}</div></article>`;
  }
  async function modQueue2(mb) {
    const [q] = await Promise.all([api("GET", `/api/communities/${st.cid}/modqueue/v2?kind=${mst.kind}&sort=${mst.sort}`), loadMacros()]);
    if (!document.body.contains(mb)) return;
    const c = q.counts; mst.sel = new Set([...mst.sel].filter((k) => q.items.some((it) => ikey(it) === k))); mst.cur = Math.min(mst.cur, Math.max(0, q.items.length - 1));
    const F = [["all", "الكل", c.posts + (c.comments || 0) + c.reports + c.joins], ["post", "منشورات", c.posts], ["comment", "تعليقات", c.comments || 0], ["report", "بلاغات", c.reports], ["join", "طلبات", c.joins], ["mine", "معي", c.mine]];
    mb.innerHTML = `<div class="mq2-tools"><div class="mq2-f" role="group" aria-label="تصفية الطابور">${F.map(([k, l, v]) => `<button type="button" class="ca-chip${mst.kind === k ? " on" : ""}" data-mk="${k}" aria-pressed="${mst.kind === k}">${l}${v ? `<i class="mq2-n">${num(v)}</i>` : ""}</button>`).join("")}</div>
        <div class="mq2-row"><select id="mq-sort" class="mq2-sort" aria-label="ترتيب الطابور"><option value="risk">الأخطر أولاً</option><option value="old">الأقدم أولاً</option><option value="new">الأحدث أولاً</option></select><button type="button" class="btn ghost sm" id="mq-selm" aria-pressed="${mst.selMode}">${ic("listChk", "xs")} ${mst.selMode ? "إنهاء التحديد" : "تحديد عدة عناصر"}</button><button type="button" class="btn ghost sm icon-only mq2-kbd" id="mq-keys" aria-label="اختصارات لوحة المفاتيح" aria-haspopup="dialog">${ic("keyboard", "xs")}</button></div></div>
      ${mst.selMode && q.items.length ? `<label class="chk mq2-all"><input type="checkbox" id="mq-all" ${mst.sel.size === q.items.length ? "checked" : ""}> تحديد الكل (${num(q.items.length)})</label>` : ""}
      <div class="mq mq2${mst.selMode ? " selm" : ""}">${q.items.map(itemHtml).join("") || UI.empty({ title: mst.kind === "all" ? "لا شيء ينتظر المراجعة" : "لا عناصر هنا", text: mst.kind === "all" ? "عمل رائع! سنخبرك حين يصل جديد." : "جرّب تصنيفاً آخر من الأعلى." })}</div>
      <div class="mq2-bulk" id="mq-bulk" hidden role="region" aria-label="إجراء جماعي"><b id="mq-bn" aria-live="polite"></b><div class="mq2-bacts"><button type="button" class="btn sm" data-bulk="approve">${ic("check", "xs")} قبول</button><button type="button" class="btn ghost sm ca-danger" data-bulk="reject">${ic("x", "xs")} رفض/حذف</button><button type="button" class="btn ghost sm" data-bulk="dismiss">تجاهل البلاغات</button>${mst.macros.some((m) => m.action !== "none") ? `<button type="button" class="btn ghost sm" data-bulk="macro">${ic("copy", "xs")} قالب</button>` : ""}<button type="button" class="btn ghost sm icon-only" data-bulk="clear" aria-label="إلغاء التحديد">${ic("x", "xs")}</button></div></div>`;
    const items = [...mb.querySelectorAll(".mq-item")];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const focus = (i, move = true) => { if (!items.length) return; mst.cur = Math.max(0, Math.min(items.length - 1, i)); items.forEach((x, k) => { x.classList.toggle("sel", k === mst.cur); x.tabIndex = k === mst.cur ? 0 : -1; }); if (move) { items[mst.cur].focus({ preventScroll: true }); items[mst.cur].scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }); } };
    const paintBulk = () => { const bar = mb.querySelector("#mq-bulk"); bar.hidden = !mst.sel.size; document.body.classList.toggle("mq2-bulking", !!mst.sel.size); mb.querySelector("#mq-bn").textContent = `${num(mst.sel.size)} محدد`; };
    const reload = () => modQueue2(mb);
    const done = (i) => { items[i]?.classList.add("done"); setTimeout(reload, reduce ? 0 : 220); };
    mb.querySelector("#mq-sort").value = mst.sort; mb.querySelector("#mq-sort").onchange = (e) => { mst.sort = e.target.value; reload(); };
    mb.querySelectorAll("[data-mk]").forEach((b) => (b.onclick = () => { mst.kind = b.dataset.mk; mst.cur = 0; reload(); }));
    mb.querySelector("#mq-selm").onclick = () => { mst.selMode = !mst.selMode; if (!mst.selMode) mst.sel.clear(); reload(); };
    mb.querySelector("#mq-keys").onclick = () => sheet(SHORTCUTS);
    mb.querySelector("#mq-all")?.addEventListener("change", (e) => { q.items.forEach((it) => (e.target.checked ? mst.sel.add(ikey(it)) : mst.sel.delete(ikey(it)))); items.forEach((x) => { x.querySelector("[data-sel]").checked = e.target.checked; }); paintBulk(); });
    const toggleSel = (i, on) => { const it = q.items[i]; if (!it) return; const k = ikey(it); const v = on ?? !mst.sel.has(k); v ? mst.sel.add(k) : mst.sel.delete(k); items[i].querySelector("[data-sel]").checked = v; paintBulk(); };
    items.forEach((el, i) => {
      el.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) { e.stopPropagation(); act(i, b.dataset.act, b); return; } if (e.target.closest(".mq2-chk")) return; if (mst.selMode) toggleSel(i); focus(i, false); });
      el.querySelector("[data-sel]").addEventListener("change", (e) => toggleSel(i, e.target.checked));
    });
    paintBulk();

    async function penalize(it, a) {
      if (!it.user) return;
      const T = { warn: ["إنذار " + it.user.name, "إنذار", "alert"], mute: ["كتم " + it.user.name, "كتم", "volumeX"], ban: ["حظر " + it.user.name + "؟", "حظر", "ban"] }[a];
      const r = await ask({ title: T[0], ok: T[1], icon: T[2], danger: a === "ban", input: "السبب (يظهر في سجل الإشراف وللعضو)", value: it.reason || "", choices: a === "mute" ? DURS : null, choice: 24, macros: mst.macros.filter((m) => m.penalty === a), text: a === "ban" ? "يستطيع العضو تقديم استئناف يراجعه مشرف أعلى رتبة." : "" });
      if (!r) return;
      try { await api("POST", `/api/communities/${st.cid}/members/${it.user.id}/discipline`, { action: a, reason: r.text, hours: +(r.choice || 24) }); toast("✓ " + T[1]); reload(); } catch (e) { toast(e.message); }
    }
    async function more(it, i) {
      const post = it.kind === "post" || it.kind === "comment" ? (it.kind === "post" ? it.id : it.post) : it.post;
      const staff = (q.staff || []).filter((s) => s.id !== q.me.id || !it.claim?.mine);
      sheet(`<div class="as"><div class="as-h"><span class="as-ic" aria-hidden="true">${ic(MKIND[it.kind][1], "sm")}</span><h3 class="u-m0">${h(MKIND[it.kind][0])}${it.user ? " · " + h(it.user.name) : ""}</h3></div><div class="list flat">${[
        post ? UI.li({ href: `#/post/${h(post)}`, icon: "eye", title: "فتح المنشور", sub: "في صفحة المنشور", attrs: 'data-ui="close-sheet"' }) : "",
        staff.length ? UI.li({ icon: "ucheck", title: "إسناد إلى مشرف", sub: "يصله إشعار ويبقى معه 24 ساعة", attrs: 'data-mm="assign"' }) : "",
        mst.macros.length ? UI.li({ icon: "copy", title: "تطبيق قالب", sub: "إجراء وسبب وعقوبة جاهزة", attrs: 'data-mm="macro"' }) : "",
        it.user && it.kind !== "join" && has("warn") ? UI.li({ icon: "alert", title: "إنذار العضو", attrs: 'data-mm="warn"' }) : "",
        it.user && it.kind !== "join" && has("mute") ? UI.li({ icon: "volumeX", title: "كتم العضو", attrs: 'data-mm="mute"' }) : "",
        it.user && it.kind !== "join" && has("ban") ? UI.li({ icon: "ban", title: "حظر العضو", attrs: 'data-mm="ban" data-danger' }) : "",
        it.user && has("view_notes") ? UI.li({ icon: "pen", title: "ملاحظات المشرفين والسجل", sub: "خاصة بفريق الإشراف", attrs: 'data-mm="notes"' }) : ""].join("")}</div></div>`);
      document.querySelectorAll("#sheet [data-mm]").forEach((b) => (b.onclick = async () => {
        const a = b.dataset.mm; closeSheet();
        if (a === "notes") return MPCommunities.memberSheet(st.cid, it.user.id);
        if (["warn", "mute", "ban"].includes(a)) return penalize(it, a);
        if (a === "assign") {
          const r = await ask({ title: "إسناد العنصر", text: "يظهر العنصر عند المشرف في «معي» ولا يستطيع غيره البت فيه.", choices: { label: "إلى", items: staff.map((s) => [s.id, s.name + (s.id === q.me.id ? " (أنا)" : "")]) }, ok: "إسناد", icon: "ucheck" }); if (!r) return;
          try { await api("POST", `/api/communities/${st.cid}/modqueue/assign`, { kind: it.kind, id: it.id, to: r.choice }); toast("✓ أُسند العنصر"); reload(); } catch (e) { toast(e.message); }
        }
        if (a === "macro") {
          const r = await ask({ title: "تطبيق قالب", choices: { label: "القالب", items: mst.macros.map((m) => [m.id, m.title]) }, ok: "تطبيق", icon: "copy" }); if (!r) return;
          try { const x = await api("POST", `/api/communities/${st.cid}/macros/${r.choice}/apply`, { kind: it.kind, id: it.id, user: it.user?.id }); toast("✓ طُبّق القالب" + (x.penalty ? " · " + MPEN[x.penalty] : "")); x.action ? done(i) : reload(); mst.macros = null; } catch (e) { toast(e.message); }
        }
      }));
    }
    async function act(i, a, btn) {
      const it = q.items[i]; if (!it) return; focus(i, false);
      if (a === "claim" || a === "release") { busy(btn, true); try { await api("POST", `/api/communities/${st.cid}/modqueue/${a}`, { kind: it.kind, id: it.id }); toast(a === "claim" ? "✓ العنصر معك الآن لمدة 15 دقيقة" : "أُلغي التولّي"); reload(); } catch (e) { toast(e.message); busy(btn, false); } return; }
      if (a === "more") return more(it, i);
      if (a === "notes") return it.user && has("view_notes") ? MPCommunities.memberSheet(st.cid, it.user.id) : null;
      if (["warn", "mute", "ban"].includes(a)) return it.kind === "join" ? null : penalize(it, a);
      const x = a === "reject" && it.kind === "report" ? "remove" : a, valid = it.kind === "report" ? ["remove", "dismiss"] : ["approve", "reject"]; if (!valid.includes(x)) return;
      let reason = "";
      if (x === "reject" || x === "remove") {
        const r = await ask({ title: x === "remove" ? "حذف المحتوى المبلَّغ عنه؟" : Tf("رفض {type}؟", { type: trI(MKIND[it.kind][0]) }), ok: x === "remove" ? "حذف" : "رفض", danger: true, icon: x === "remove" ? "trash" : "x", input: "السبب (يظهر في سجل الإشراف)", macros: mst.macros.filter((m) => ["reject", "remove"].includes(m.action)), text: it.kind === "join" ? "" : "يستطيع صاحب المحتوى تقديم استئناف." });
        if (!r) return; reason = r.text;
      }
      busy(btn, true);
      try { await api("POST", `/api/communities/${st.cid}/modqueue/act`, { kind: it.kind, id: it.id, action: x, reason }); toast({ approve: "✓ قُبل", reject: "رُفض", remove: "حُذف المحتوى", dismiss: "تُجوهل البلاغ" }[x]); done(i); }
      catch (e) { toast(e.message); busy(btn, false); if (e.status === 409) reload(); }
    }
    mb.querySelectorAll("[data-bulk]").forEach((b) => (b.onclick = async () => {
      const a = b.dataset.bulk; if (a === "clear") { mst.sel.clear(); reload(); return; }
      const list = [...mst.sel].map((k) => { const j = k.indexOf(":"); return { kind: k.slice(0, j), id: k.slice(j + 1) }; });
      let payload = { items: list, action: a };
      if (a === "macro") { const ms = mst.macros.filter((m) => m.action !== "none"); const r = await ask({ title: `تطبيق قالب على ${num(list.length)} عنصر`, choices: { label: "القالب", items: ms.map((m) => [m.id, m.title + " · " + MACT[m.action]]) }, ok: "تطبيق", icon: "copy" }); if (!r) return; payload = { items: list, macro: r.choice }; }
      else if (a !== "approve") { const r = await ask({ title: a === "reject" ? `رفض أو حذف ${num(list.length)} عنصر؟` : `تجاهل البلاغات المحددة؟`, danger: a === "reject", icon: a === "reject" ? "x" : "flag", input: "السبب (يظهر في سجل الإشراف)", ok: "تنفيذ", macros: mst.macros, text: "لا يُطبَّق الإجراء على ما لا يناسبه من العناصر، وتظهر النتيجة لكل عنصر." }); if (!r) return; payload.reason = r.text; }
      busy(b, true);
      try { const r = await api("POST", `/api/communities/${st.cid}/modqueue/bulk`, payload); toast(`✓ نُفّذ على ${num(r.done)}${r.failed ? ` · تعذّر ${num(r.failed)}` : ""}${r.skipped ? ` · تُخطّي ${num(r.skipped)}` : ""}`); mst.sel.clear(); mst.selMode = false; document.body.classList.remove("mq2-bulking"); reload(); }
      catch (e) { toast(e.message); busy(b, false); }
    }));
    if (modKeys) document.removeEventListener("keydown", modKeys, true);
    modKeys = (e) => {
      if (!document.body.contains(mb)) { document.removeEventListener("keydown", modKeys, true); modKeys = null; return; }
      const sh = document.getElementById("sheet"); if ((sh && !sh.classList.contains("hidden")) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase(), inQ = mb.contains(document.activeElement), map = { a: "approve", r: "reject", d: "dismiss", w: "warn", m: "mute", n: "notes" };
      if (k === "j" || (inQ && e.key === "ArrowDown")) { e.preventDefault(); focus(mst.cur + 1); }
      else if (k === "k" || (inQ && e.key === "ArrowUp")) { e.preventDefault(); focus(mst.cur - 1); }
      else if (e.key === "?") { e.preventDefault(); e.stopImmediatePropagation(); sheet(SHORTCUTS); }
      else if (k === "x" && items.length) { e.preventDefault(); if (!mst.selMode) { mst.selMode = true; mst.sel.add(ikey(q.items[mst.cur])); reload(); } else toggleSel(mst.cur); }
      else if (k === "c" && items.length) { e.preventDefault(); const it = q.items[mst.cur]; if (!it.claim || it.claim.mine) act(mst.cur, it.claim?.mine ? "release" : "claim", items[mst.cur].querySelector('[data-act="claim"],[data-act="release"]')); }
      else if (map[k] && items.length) { e.preventDefault(); act(mst.cur, map[k], items[mst.cur].querySelector(`[data-act="${map[k] === "reject" && q.items[mst.cur].kind === "report" ? "remove" : map[k]}"]`)); }
    };
    document.addEventListener("keydown", modKeys, true); // capture: the queue's own «?» wins over the app-wide shortcuts sheet
  }

  /* ---------- appeals (moderators) ---------- */
  async function modAppeals(mb) {
    const r = await api("GET", `/api/communities/${st.cid}/appeals?status=${mst.apSt}`);
    const tone = (k) => (k === "ban" ? "danger" : k === "removal" ? "" : "warn");
    mb.innerHTML = `<div class="mq2-f" role="group" aria-label="حالة الاستئنافات">${[["open", "مفتوحة"], ["closed", "تم البت فيها"]].map(([k, l]) => `<button type="button" class="ca-chip${mst.apSt === k ? " on" : ""}" data-as="${k}" aria-pressed="${mst.apSt === k}">${l}</button>`).join("")}</div>
      <p class="mq2-help">${ic("infoC", "xs")}<span>يبت في الاستئناف مشرف أعلى رتبة من صاحبه، وليس صاحب القرار نفسه. القبول يرفع العقوبة ويعيد للعضو دوره السابق.</span></p>
      ${r.appeals.map((a) => `<article class="card ca-card mq2-ap" data-ap-id="${h(a.id)}"><div class="mq2-top">${badge(a.label, tone(a.kind))}${a.status !== "open" ? badge(a.status === "accepted" ? "قُبل" : "رُفض", a.status === "accepted" ? "ok" : "") : ""}<span class="grow"></span><time class="muted">${h(rel(a.at))}</time></div>
        <div class="mq-user mq2-u">${avatar(a.user)}<span class="mq2-un"><b>${h(a.user.name)}</b><small class="muted">@${h(a.user.handle)}</small></span></div>
        <div class="mq2-dec"><small>القرار الأصلي</small><p>${h(a.decision?.reason || a.decision?.preview || "بدون سبب مكتوب")}</p>${a.decision?.by || a.decision?.until ? `<small class="muted">${a.decision?.by ? h(Tf("بواسطة {name}", { name: a.decision.by })) : ""}${a.decision?.until ? " · " + h(Tf("حتى {date}", { date: when(a.decision.until) })) : ""}</small>` : ""}</div>
        <blockquote class="mq2-q"><small>طلب العضو</small>${h(a.text)}</blockquote>
        ${a.status === "open" ? (a.mineDecision && st.data.role !== "owner" ? `<p class="ca-lock">${ic("lock", "xs")}<span>القرار قرارك، فيبت فيه مشرف آخر.</span></p>` : `<div class="mq2-acts"><button type="button" class="btn sm" data-apd="accept">${ic("check", "xs")} قبول ورفع العقوبة</button><button type="button" class="btn ghost sm" data-apd="reject">رفض الاستئناف</button></div>`)
          : `<p class="muted mq2-note">${h(a.decider || "")}${a.note ? " · " + h(a.note) : ""}${a.decidedAt ? " · " + h(rel(a.decidedAt)) : ""}</p>`}</article>`).join("") || UI.empty({ title: mst.apSt === "open" ? "لا استئنافات مفتوحة" : "لا استئنافات سابقة", text: "تظهر هنا طلبات الأعضاء لمراجعة قرارات الإشراف." })}`;
    mb.querySelectorAll("[data-as]").forEach((b) => (b.onclick = () => { mst.apSt = b.dataset.as; modAppeals(mb); }));
    mb.querySelectorAll("[data-apd]").forEach((b) => (b.onclick = async () => {
      const id = b.closest("[data-ap-id]").dataset.apId, acc = b.dataset.apd === "accept";
      const r = await ask({ title: acc ? "قبول الاستئناف ورفع العقوبة؟" : "رفض الاستئناف؟", text: acc ? "يُرفع الحظر أو الكتم أو الإنذار، أو يعود المنشور، ويُبلَّغ العضو." : "يبقى القرار كما هو، ويُبلَّغ العضو بملاحظتك.", input: "ملاحظة تظهر للعضو", ok: acc ? "قبول" : "رفض", icon: "scale", danger: !acc });
      if (!r) return; busy(b, true);
      try { const x = await api("POST", `/api/communities/${st.cid}/appeals/${id}/decide`, { decision: acc ? "accept" : "reject", note: r.text }); toast(acc ? "✓ قُبل الاستئناف" + (x.restoredRole ? " · عاد دوره: " + (ROLE[x.restoredRole] || x.restoredRole) : "") : "رُفض الاستئناف"); modAppeals(mb); }
      catch (e) { toast(e.message); busy(b, false); }
    }));
  }

  /* ---------- saved replies («القوالب») ---------- */
  async function modMacros(mb) {
    const ms = await loadMacros(true);
    mb.innerHTML = `<div class="mq2-row mq2-mh"><p class="muted u-m0 grow">ردود جاهزة تختصر القرارات المتكررة: إجراء وسبب، وعقوبة اختيارية، ورسالة للعضو.</p><button type="button" class="btn sm" id="mc-new">${ic("plus", "xs")} قالب جديد</button></div>
      ${ms.length ? `<div class="list mq2-ml">${ms.map((m, i) => `<button type="button" class="li mq2-mc" data-mc="${i}"><span class="ca-ci" aria-hidden="true">${ic("copy", "xs")}</span><span class="t"><b>${h(m.title)}</b><small>${h([m.action !== "none" ? MACT[m.action] : "", m.penalty !== "none" ? MPEN[m.penalty] + (m.hours ? " " + DURS.items.find((d) => d[0] === m.hours)?.[1] : "") : ""].filter(Boolean).join(" + "))}${m.reason ? " · " + h(m.reason) : ""}</small></span><span class="ca-badge">${num(m.uses)} استخدام</span></button>`).join("")}</div>` : UI.empty({ title: "لا قوالب بعد", text: "أنشئ أول قالب لقراراتك المتكررة، مثل: «رفض: خارج الموضوع»." })}`;
    const edit = (m) => {
      const v = m || { title: "", action: "reject", penalty: "none", reason: "", message: "", hours: 24 };
      const seg = (name, map, cur) => `<div class="seg ca-segw mq2-seg" role="radiogroup" aria-label="${name === "mc-a" ? "الإجراء" : "العقوبة"}">${Object.entries(map).map(([k, l]) => `<label class="ca-seg"><input type="radio" name="${name}" value="${k}" ${cur === k ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>`;
      sheet(`<div class="as"><div class="as-h"><span class="as-ic" aria-hidden="true">${ic("copy", "sm")}</span><h3 class="u-m0">${m ? "تعديل القالب" : "قالب جديد"}</h3></div>
        <label class="field"><span class="lbl">الاسم</span><input id="mc-t" maxlength="60" value="${h(v.title)}" placeholder="مثل: رفض — خارج الموضوع"></label>
        <span class="ca-sublbl">الإجراء على العنصر</span>${seg("mc-a", MACT, v.action)}
        <span class="ca-sublbl">عقوبة على صاحبه</span>${seg("mc-p", MPEN, v.penalty)}
        <label class="field" id="mc-hw"${v.penalty === "mute" ? "" : " hidden"}><span class="lbl">مدة الكتم</span><select id="mc-h">${DURS.items.map(([k, l]) => `<option value="${k}" ${+v.hours === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span class="lbl">السبب (يظهر في سجل الإشراف)</span><textarea id="mc-r" rows="2" maxlength="300">${h(v.reason)}</textarea></label>
        <label class="field"><span class="lbl">رسالة للعضو <small class="muted">(اختياري، تظهر في صفحة قراراته)</small></span><textarea id="mc-m" rows="2" maxlength="500">${h(v.message)}</textarea></label>
        <div class="as-acts"><button type="button" class="btn grow" id="mc-go">حفظ</button>${m ? `<button type="button" class="btn ghost ca-danger" id="mc-del">${ic("trash", "xs")} حذف</button>` : ""}<button type="button" class="btn ghost" data-ui="close-sheet">إلغاء</button></div></div>`);
      const S$ = (s) => document.querySelector("#sheet " + s);
      document.querySelectorAll('#sheet input[name="mc-p"]').forEach((x) => (x.onchange = () => { S$("#mc-hw").hidden = S$('input[name="mc-p"]:checked').value !== "mute"; }));
      S$("#mc-go").onclick = async (e) => {
        const body = { title: S$("#mc-t").value.trim(), action: S$('input[name="mc-a"]:checked').value, penalty: S$('input[name="mc-p"]:checked').value, hours: +S$("#mc-h").value, reason: S$("#mc-r").value.trim(), message: S$("#mc-m").value.trim() };
        if (!body.title) { S$("#mc-t").focus(); toast("اكتب اسم القالب"); return; }
        busy(e.target, true);
        try { await api(m ? "PATCH" : "POST", `/api/communities/${st.cid}/macros${m ? "/" + m.id : ""}`, body); closeSheet(); toast("✓ حُفظ القالب"); modMacros(mb); } catch (er) { toast(er.message); busy(e.target, false); }
      };
      S$("#mc-del")?.addEventListener("click", async () => { closeSheet(); const r = await ask({ title: Tf("حذف القالب «{name}»؟", { name: m.title }), ok: "حذف", danger: true, icon: "trash" }); if (!r) return; try { await api("DELETE", `/api/communities/${st.cid}/macros/${m.id}`); toast("حُذف القالب"); modMacros(mb); } catch (er) { toast(er.message); } });
      setTimeout(() => S$("#mc-t")?.focus(), 60);
    };
    mb.querySelector("#mc-new").onclick = () => edit(null);
    mb.querySelectorAll("[data-mc]").forEach((b) => (b.onclick = () => edit(ms[+b.dataset.mc])));
  }

  /* ---------- the transparent log (legacy, kept) ---------- */
  async function modLog2(mb) {
    const { log } = await api("GET", `/api/communities/${st.cid}/modlog`);
    mb.innerHTML = `<div class="mq2-row"><span class="grow muted">${num(log.length)} إجراء</span>${has("export_log") ? `<a class="btn ghost sm" href="/api/communities/${h(st.cid)}/modlog?format=csv" download>${ic("download", "xs")} تصدير CSV</a>` : ""}</div>
      ${log.length ? `<div class="card m-log mq2-log">${log.map((l) => `<div class="m-log-row"><span class="ca-badge">${h(l.label)}</span><span class="grow">${h(l.actor || "")}${l.target ? " ← " + h(l.target) : ""}${l.reason ? `<small class="muted"> · ${h(l.reason)}</small>` : ""}</span><time class="muted">${h(rel(l.at))}</time></div>`).join("")}</div>` : `<div class="m-log">${UI.empty({ title: "لا إجراءات بعد", text: "كل قرار إشراف، يدوياً أو آلياً، يظهر هنا بسببه." })}</div>`}`;
  }

  /* ---------- moderator notifications ---------- */
  async function modAlerts(mb) {
    const { prefs } = await api("GET", `/api/communities/${st.cid}/modprefs`);
    mb.innerHTML = card("تنبيهات الإشراف", "bell", `<p class="muted u-mt0">تخصّك وحدك في هذا المجتمع.</p>
      <span class="ca-sublbl">ملخص الطابور</span><div class="seg ca-segw" role="radiogroup" aria-label="ملخص الطابور">${[["6h", "كل 6 ساعات"], ["daily", "يومياً"], ["off", "إيقاف"]].map(([k, l]) => `<label class="ca-seg"><input type="radio" name="mp-d" value="${k}" ${prefs.digest === k ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
      <label class="switch-row ca-sw"><span><b>استئنافات الأعضاء</b><small>إشعار فوري عند تقديم استئناف</small></span><input type="checkbox" class="switch" role="switch" id="mp-a" ${prefs.appeals ? "checked" : ""} aria-label="استئنافات الأعضاء"></label>
      <label class="switch-row ca-sw"><span><b>عناصر مُسندة إليّ</b><small>إشعار حين يسند إليك مشرف عنصراً</small></span><input type="checkbox" class="switch" role="switch" id="mp-s" ${prefs.assigned ? "checked" : ""} aria-label="عناصر مسندة إليّ"></label>
      <p class="mq2-saved muted" id="mp-st" aria-live="polite"></p>`);
    const save = async () => { const s = mb.querySelector("#mp-st"); try { await api("PUT", `/api/communities/${st.cid}/modprefs`, { digest: mb.querySelector('input[name="mp-d"]:checked').value, appeals: mb.querySelector("#mp-a").checked, assigned: mb.querySelector("#mp-s").checked }); s.textContent = "✓ حُفظت تلقائياً"; } catch (e) { s.textContent = e.message; } };
    mb.querySelectorAll("input").forEach((i) => i.addEventListener("change", save));
  }

  /* ======================= v2.59 «الإشراف الآلي v2» — its own section ======================= */
  const CATS_AR = { abuse: "إساءة", threat: "تهديد", hate: "كراهية", fraud: "احتيال" };
  async function secAutomod(body) {
    const canEdit = has("manage_automod"), dis = canEdit ? "" : "disabled";
    const [{ automod: am, publicLog }, meta, stats] = await Promise.all([api("GET", `/api/communities/${st.cid}/automod`), api("GET", `/api/communities/${st.cid}/automod/meta`), api("GET", `/api/communities/${st.cid}/automod/stats`).catch(() => null)]);
    const v2 = {}; for (const k of Object.keys(meta.rules)) v2[k] = { ...meta.defaults.v2[k], ...(am.v2?.[k] || {}) };
    const lad = { ...meta.defaults.ladder, ...(am.ladder || {}) };
    const nf = (k, label, v, min, max, step = 1) => `<label class="field am-num"><span class="lbl">${h(label)}</span><input type="number" data-k="${k}" value="${h(v)}" min="${min}" max="${max}" step="${step}" inputmode="decimal" ${dis}></label>`;
    const actSeg = (rk, cur) => `<span class="ca-sublbl">عند المطابقة</span><div class="seg ca-segw am-act" role="radiogroup" aria-label="${h(Tf("عند مطابقة {rule}", { rule: trI(meta.rules[rk].title) }))}">${Object.entries(meta.actions).map(([k, l]) => `<label class="ca-seg"><input type="radio" name="am-${rk}-a" data-k="v2.${rk}.action" value="${k}" ${cur === k ? "checked" : ""} ${dis}><span>${h(l)}</span></label>`).join("")}</div>`;
    const OPTS = {
      words: (r) => `<label class="field"><span class="lbl">الكلمات (كلمة أو عبارة في كل سطر، و«*» داخل الكلمة مثل: غب*)</span><textarea data-k="v2.words.words" rows="4" ${dis}>${h((r.words || []).join("\n"))}</textarea></label>`,
      links: (r) => `<div class="seg ca-segw" role="radiogroup" aria-label="وضع النطاقات"><label class="ca-seg"><input type="radio" name="am-lm" data-k="v2.links.mode" value="deny" ${r.mode !== "allow" ? "checked" : ""} ${dis}><span>منع هذه النطاقات</span></label><label class="ca-seg"><input type="radio" name="am-lm" data-k="v2.links.mode" value="allow" ${r.mode === "allow" ? "checked" : ""} ${dis}><span>السماح بها فقط</span></label></div><label class="field"><span class="lbl">النطاقات (نطاق في كل سطر)</span><textarea data-k="v2.links.domains" rows="3" dir="ltr" ${dis}>${h((r.domains || []).join("\n"))}</textarea></label>`,
      invites: () => `<p class="am-hint">${ic("infoC", "xs")}<span dir="ltr">${h(meta.inviteHosts.slice(0, 6).join(" · "))} …</span></p>`,
      mentions: (r) => nf("v2.mentions.max", "الحد الأعلى للإشارات في منشور", r.max, 1, 50),
      flood: (r) => `<div class="ca-2">${nf("v2.flood.maxRepeat", "أقصى تكرار متتالٍ لحرف", r.maxRepeat, 3, 100)}${nf("v2.flood.maxEmoji", "أقصى عدد للرموز التعبيرية", r.maxEmoji, 1, 200)}</div>`,
      duplicate: (r) => nf("v2.duplicate.windowMin", "النص نفسه خلال (دقائق)", r.windowMin, 1, 10080),
      newMember: (r) => nf("v2.newMember.firstPosts", "عدد أول المنشورات التي تُراجع", r.firstPosts, 1, 50),
      classify: (r) => `${nf("v2.classify.threshold", "الحد (من 0.3 إلى 0.99 — الأعلى أقل حساسية)", r.threshold, 0.3, 0.99, 0.05)}<span class="ca-sublbl">الفئات</span><div class="am-cats" role="group" aria-label="فئات المصنّف">${Object.entries(CATS_AR).map(([k, l]) => `<label class="ca-chk am-cat"><input type="checkbox" data-k="v2.classify.cat.${k}" ${(r.categories || []).includes(k) ? "checked" : ""} ${dis}><span>${l}</span></label>`).join("")}</div>`,
      comments: () => `<p class="am-hint">${ic("infoC", "xs")}<span>التعليق المطابق ينتظر موافقة المشرفين في الطابور، ولا يراه أحد قبلها.</span></p>`
    };
    const RI = { words: "doc", links: "link", invites: "share", mentions: "users", flood: "mega", duplicate: "copy", newMember: "uplus", classify: "sparkle", comments: "comment" };
    const ruleRow = (k) => { const r = v2[k], m = meta.rules[k]; return `<div class="am-rule${r.enabled ? " on" : ""}" data-rule="${k}"><label class="switch-row ca-sw am-sw"><span class="ca-ci am-ri" aria-hidden="true">${ic(RI[k] || "shield", "xs")}</span><span class="grow"><b>${h(m.title)}</b><small>${h(m.sub)}</small></span><input type="checkbox" class="switch" role="switch" data-k="v2.${k}.enabled" ${r.enabled ? "checked" : ""} ${dis} aria-label="${h(m.title)}"></label><div class="am-opts"${r.enabled ? "" : " hidden"}>${OPTS[k](r)}${k !== "comments" ? actSeg(k, r.action) : ""}</div></div>`; };
    const ladRow = (s, i) => `<div class="am-step"><span class="ca-n">${num(i + 1)}</span><label class="am-at"><span>عند</span><input type="number" min="1" max="100" data-k="ladder.s${i}.at" value="${h(s?.at || "")}" aria-label="عدد المخالفات للخطوة ${i + 1}" ${dis}><span>مخالفات</span></label><select data-k="ladder.s${i}.action" aria-label="العقوبة في الخطوة ${i + 1}" ${dis}>${[["", "بلا"], ["warn", "إنذار"], ["mute", "كتم"], ["ban", "حظر"]].map(([v, l]) => `<option value="${v}" ${(s?.action || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select><select data-k="ladder.s${i}.hours" aria-label="مدة الكتم في الخطوة ${i + 1}" ${dis}${s?.action === "mute" ? "" : " hidden"}>${DURS.items.map(([v, l]) => `<option value="${v}" ${(s?.hours || 24) === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
    const by = stats?.byAction || {}, mx = Math.max(1, ...(stats?.series || []).map((x) => x.n));
    const statsHtml = stats ? `<div class="am-kpis">${[["تحويل للمراجعة", by.automod_queue, "list"], ["منع", by.automod_reject, "ban"], ["بلاغ آلي", by.automod_flag, "flag"], ["عقوبات السُّلَّم", by.automod_penalty, "alert"]].map(([l, v, i]) => `<div class="mq2-k"><span class="ca-ci">${ic(i, "xs")}</span><span><b>${num(v || 0)}</b><small>${l}</small></span></div>`).join("")}</div>
      <div class="am-spark" role="img" aria-label="القرارات الآلية في آخر 14 يوماً">${stats.series.map((x) => `<i style="--v:${Math.round((x.n / mx) * 100)}%" title="${h(x.day)}: ${num(x.n)}"></i>`).join("")}</div>
      ${stats.byRule.length ? `<ul class="am-rules-st">${stats.byRule.map((r) => `<li><span>${h(r.title)}</span><b>${num(r.n)}</b></li>`).join("")}</ul>` : `<p class="muted">لا قرارات آلية في آخر ${num(stats.days)} يوماً.</p>`}
      ${stats.reviewed.falsePositiveRate !== null ? `<p class="am-fp">${ic("infoC", "xs")}<span>من المنشورات التي حُوّلت للمراجعة وبُتّ فيها، قُبل ${num(stats.reviewed.falsePositiveRate)}٪ (${num(stats.reviewed.approved)} من ${num(stats.reviewed.approved + stats.reviewed.rejected)}). نسبة عالية تعني أن القواعد أشدّ من اللازم.</span></p>` : ""}` : `<p class="muted">الإحصاءات غير متاحة الآن.</p>`;
    /* v2.62 T8 «الحارس التلقائي»: OFF by default; the recommended preset fills the form (saved only with «حفظ التغييرات») */
    const gd = { ...meta.guardDefaults, ...(am.guard || {}) }, gs = stats?.guard;
    /* v2.63.1 N1: state-aware copy — the header follows the SAVED state, the switch line follows the switch (unsaved changes say so) */
    let agOn = !!gd.enabled;
    const agHead = () => (agOn ? "يعمل الآن في هذا المجتمع." : "معطّل افتراضياً.");
    const agSw = (c) => (c ? (agOn ? "يعمل الآن" : "يعمل بعد «حفظ التغييرات»") : agOn ? "يتوقف بعد «حفظ التغييرات»" : "متوقف حتى تشغّله");
    const gSeg = (k, label, opts, cur) => { const o = opts.some(([v]) => String(v) === String(cur)) ? opts : [...opts, [cur, num(cur)]]; return `<span class="ca-sublbl">${h(label)}</span><div class="seg ca-segw ag-seg" role="radiogroup" aria-label="${h(tr(label))}">${o.map(([v, l]) => `<label class="ca-seg"><input type="radio" name="ag-${k}" data-k="g.${k}" value="${v}" ${String(cur) === String(v) ? "checked" : ""} ${dis}><span>${h(l)}</span></label>`).join("")}</div>`; };
    const gKpi = gs ? `<div class="am-kpis ag-kpis">${[["تحذيرات الحارس", gs.strikes, "alert"], ["إيقافات", gs.locks, "lock"], ["موقوفون الآن", gs.lockedNow, "users"]].map(([l, v, i]) => `<div class="mq2-k${v ? " has" : ""}"><span class="ca-ci">${ic(i, "xs")}</span><span><b>${num(v || 0)}</b><small>${l}</small></span></div>`).join("")}</div>` : "";
    const guardCard = card("الحارس التلقائي", "shield", `${gKpi}<p class="am-hint">${ic("infoC", "xs")}<span>اكتب الكلمات أو العبارات التي لا تريدها. نحذف النص فوراً، ونحذّر العضو ونكتمه مؤقتاً، وبعد آخر تحذير يتوقف عن الكتابة حتى يرفعه مشرف.</span></p>
      ${sw("g.enabled", "تشغيل الحارس", agSw(gd.enabled), gd.enabled, !canEdit)}
      ${canEdit ? `<button type="button" class="am-pb ag-pre" id="ag-pre"><b>${h(meta.guardPreset.title)}</b><small>${h(meta.guardPreset.sub)}</small></button>` : ""}
      <div class="ag-opts"${gd.enabled ? "" : " hidden"}>
      <label class="field"><span class="lbl">الكلمات والعبارات الممنوعة (سطر لكل عبارة) <small class="ag-cnt" id="ag-cnt" aria-live="polite">${num(gd.words.length)}/${num(300)}</small></span><textarea data-k="g.words" rows="4" dir="auto" ${dis}>${h(gd.words.join("\n"))}</textarea></label>
      <p class="am-hint">${ic("infoC", "xs")}<span>«غب*» تلتقط غبي وغبية · العبارات تُكتب كما هي.</span></p>
      <label class="field"><span class="lbl">استثناءات (اختياري)</span><textarea data-k="g.allow" rows="2" dir="auto" ${dis}>${h(gd.allow.join("\n"))}</textarea></label>
      ${gSeg("muteHours", "مدة الكتم بعد كل تحذير", [[0, "بدون"], [1, "ساعة"], [6, "6 ساعات"], [24, "يوم"], [72, "3 أيام"]], gd.muteHours)}
      ${gSeg("maxStrikes", "عدد التحذيرات قبل الإيقاف", [[1, num(1)], [2, num(2)], [3, num(3)], [5, num(5)]], gd.maxStrikes)}
      ${gSeg("fullLock", "بعد آخر تحذير", [["1", "إيقاف حتى يرفعه مشرف"], ["0", "كتم عادي"]], gd.fullLock ? "1" : "0")}
      ${gSeg("decayDays", "تُنسى التحذيرات بعد", [[7, "7 أيام"], [30, "30 يوماً"], [90, "90 يوماً"], [0, "لا تُنسى"]], gd.decayDays)}
      <span class="ca-sublbl">يطبَّق على</span><div class="am-cats" role="group" aria-label="${h(tr("يطبَّق على"))}">${[["posts", "المنشورات"], ["comments", "التعليقات"], ["edits", "التعديلات"]].map(([k, l]) => `<label class="ca-chk am-cat"><input type="checkbox" data-k="g.${k}" ${gd[k] ? "checked" : ""} ${dis}><span>${l}</span></label>`).join("")}</div>
      <label class="field"><span class="lbl">من يرفع الإيقاف</span><select data-k="g.liftMin" ${dis}>${[["moderator", "المشرفون فأعلى"], ["admin", "المديرون فأعلى"], ["owner", "المالك فقط"]].map(([v, l]) => `<option value="${v}" ${gd.liftMin === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${sw("g.resetOnLift", "رفع الإيقاف يصفّر التحذيرات", "بداية جديدة للعضو", gd.resetOnLift, !canEdit)}
      ${lad.enabled ? `<p class="am-hint">${ic("infoC", "xs")}<span>تحذيرات الحارس لا تُحسب في سُلَّم العقوبات.</span></p>` : ""}
      </div>
      <div class="ag-test"><label class="field"><span class="lbl">جرّب الحارس</span><input type="text" id="ag-tt" dir="auto" maxlength="5000" placeholder="${h(tr("اكتب نصاً كما قد يكتبه عضو…"))}"></label><button type="button" class="btn sm" id="ag-tgo">${ic("flask", "xs")} جرّب</button><div id="ag-tres" class="am-tres" aria-live="polite"></div></div>
      <p class="am-hint">${ic("infoC", "xs")}<span>المالك والمديرون والمشرفون معفَون.</span></p>`, { id: "ag-card", sub: agHead() });
    body.innerHTML = `<div class="ca-form" id="am-form">
      ${!canEdit ? `<p class="ca-lock">${ic("lock", "xs")}<span>تستطيع رؤية القواعد وتجربتها. تعديلها للمالك والمديرين.</span></p>` : ""}
      ${guardCard}
      ${card("القواعد الأساسية", "shield", `<label class="field"><span class="lbl">كلمات محظورة (كلمة في كل سطر)</span><textarea data-k="am.words" rows="4" ${dis}>${h((am.words || []).join("\n"))}</textarea></label>
        ${sw("am.blockLinks", "مراجعة المنشورات التي تحتوي روابط", "", am.blockLinks, !canEdit)}
        <div class="ca-2">${nf("am.newAccountDays", "تُراجع منشورات الحسابات الأحدث من (أيام)", am.newAccountDays, 0, 90)}
        <label class="field"><span class="lbl">المحتوى المسيء (مصنّف آلي)</span><select data-k="am.toxicity" ${dis}>${[["off", "إيقاف"], ["queue", "تحويل للمراجعة"], ["reject", "رفض الشديد تلقائياً"]].map(([v, l]) => `<option value="${v}" ${am.toxicity === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <label class="field"><span class="lbl">عند مطابقة قاعدة أساسية</span><select data-k="am.action" ${dis}>${[["queue", "تحويل للمراجعة"], ["reject", "رفض المنشور"]].map(([v, l]) => `<option value="${v}" ${am.action === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${sw("am.publicLog", "سجل إشراف شفاف يراه الأعضاء", "دون أسماء المشرفين", publicLog, !canEdit)}`, { sub: "تعمل كما كانت. المشرفون مستثنون، وكل قرار آلي يظهر في السجل بسببه." })}
      ${card("قواعد متقدمة", "sparkle", `${canEdit ? `<div class="am-presets" role="group" aria-label="إعدادات جاهزة"><span class="ca-sublbl">ابدأ بإعداد جاهز (لا يُحفظ قبل «حفظ التغييرات»)</span><div class="am-pbtns">${Object.entries(meta.presets).map(([k, p]) => `<button type="button" class="am-pb" data-preset="${k}"><b>${h(p.title)}</b><small>${h(p.sub)}</small></button>`).join("")}<button type="button" class="am-pb" data-preset="off"><b>إيقاف الكل</b><small>يعيد القواعد المتقدمة إلى وضعها الافتراضي</small></button></div></div>` : ""}
        <div class="am-list">${Object.keys(meta.rules).map(ruleRow).join("")}</div>`, { sub: "كلها معطّلة حتى تفعّلها. لا تمنع شيئاً قبل ذلك." })}
      ${card("سُلَّم العقوبات", "alert", `${sw("ladder.enabled", "تفعيل السُّلَّم", "عقوبة تلقائية حين تتكرر المخالفات الآلية لعضو", lad.enabled, !canEdit)}<div class="am-ladder"${lad.enabled ? "" : " hidden"}>${nf("ladder.windowDays", "خلال (أيام)", lad.windowDays, 1, 365)}${[0, 1, 2].map((i) => ladRow(lad.steps[i], i)).join("")}<p class="am-hint">${ic("infoC", "xs")}<span>تُطبَّق كل خطوة مرة واحدة عند بلوغ عددها، ويستطيع العضو الاستئناف.</span></p></div>`, { sub: "معطّل افتراضياً." })}
      </div>
      ${card("جرّب القاعدة", "flask", `<label class="field"><span class="lbl">نص للتجربة</span><textarea id="am-tt" rows="3" maxlength="5000" placeholder="اكتب نصاً كما قد يكتبه عضو…"></textarea></label>
        <div class="am-topts" role="group" aria-label="خيارات التجربة"><label class="ca-chk am-cat"><input type="checkbox" id="am-tc"><span>كتعليق</span></label><label class="ca-chk am-cat"><input type="checkbox" id="am-tn"><span>من عضو جديد</span></label><label class="ca-chk am-cat"><input type="checkbox" id="am-td"><span>نص مكرر</span></label></div>
        <button type="button" class="btn sm" id="am-tgo">${ic("flask", "xs")} جرّب بالقيم الظاهرة</button><div id="am-tres" class="am-tres" aria-live="polite"></div>`, { id: "am-tester", sub: "لا يُحفظ النص ولا يُسجَّل، وتُستخدم القيم الظاهرة في النموذج حتى قبل الحفظ." })}
      ${card("الإحصاءات", "chart", statsHtml, { sub: `آخر ${num(stats?.days || 30)} يوماً` })}`;
    const root = body.querySelector("#am-form");
    const lines = (t) => String(t || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const build = (v) => {
      const out = { words: lines(v["am.words"]), blockLinks: !!v["am.blockLinks"], newAccountDays: +v["am.newAccountDays"] || 0, toxicity: v["am.toxicity"], action: v["am.action"], publicLog: !!v["am.publicLog"], v2: {} };
      for (const k of Object.keys(meta.rules)) { out.v2[k] = { enabled: !!v[`v2.${k}.enabled`] }; if (v[`v2.${k}.action`]) out.v2[k].action = v[`v2.${k}.action`]; }
      Object.assign(out.v2.words, { words: lines(v["v2.words.words"]) }); Object.assign(out.v2.links, { mode: v["v2.links.mode"] || "deny", domains: lines(v["v2.links.domains"]) });
      out.v2.mentions.max = +v["v2.mentions.max"]; out.v2.flood.maxRepeat = +v["v2.flood.maxRepeat"]; out.v2.flood.maxEmoji = +v["v2.flood.maxEmoji"]; out.v2.duplicate.windowMin = +v["v2.duplicate.windowMin"]; out.v2.newMember.firstPosts = +v["v2.newMember.firstPosts"];
      out.v2.classify.threshold = +v["v2.classify.threshold"]; out.v2.classify.categories = Object.keys(CATS_AR).filter((c) => v["v2.classify.cat." + c]);
      out.ladder = { enabled: !!v["ladder.enabled"], windowDays: +v["ladder.windowDays"] || 30, steps: [0, 1, 2].map((i) => ({ at: +v[`ladder.s${i}.at`], action: v[`ladder.s${i}.action`], hours: +v[`ladder.s${i}.hours`] })).filter((s) => s.at && s.action) };
      out.guard = { enabled: !!v["g.enabled"], words: lines(v["g.words"]), allow: lines(v["g.allow"]), muteHours: +v["g.muteHours"] || 0, maxStrikes: +v["g.maxStrikes"] || 3, fullLock: v["g.fullLock"] !== "0", decayDays: +v["g.decayDays"] || 0, posts: !!v["g.posts"], comments: !!v["g.comments"], edits: !!v["g.edits"], liftMin: v["g.liftMin"], resetOnLift: !!v["g.resetOnLift"] };
      return out;
    };
    const sync = () => {
      const agc = root.querySelector('[data-k="g.enabled"]'); root.querySelector(".ag-opts").hidden = !agc.checked;
      const ags = agc.closest(".switch-row")?.querySelector("small"), agh = root.querySelector("#ag-card .ca-ch p");
      if (ags && ags.dataset.src !== agSw(agc.checked)) { ags.dataset.src = agSw(agc.checked); ags.textContent = agSw(agc.checked); } // new text node → re-translated
      if (agh && agh.dataset.src !== agHead()) { agh.dataset.src = agHead(); agh.textContent = agHead(); }
      const gc = root.querySelector("#ag-cnt"); if (gc) gc.textContent = `${num(lines(root.querySelector('[data-k="g.words"]').value).length)}/${num(300)}`;
      root.querySelectorAll(".am-rule").forEach((r) => { const on = r.querySelector('[data-k$=".enabled"]').checked; r.classList.toggle("on", on); r.querySelector(".am-opts").hidden = !on; });
      root.querySelector(".am-ladder").hidden = !root.querySelector('[data-k="ladder.enabled"]').checked;
      root.querySelectorAll(".am-step").forEach((s) => { s.querySelector('[data-k$=".hours"]').hidden = s.querySelector('[data-k$=".action"]').value !== "mute"; });
    };
    root.addEventListener("change", sync); root.querySelector('[data-k="g.words"]').addEventListener("input", sync); root._caPreview = sync;
    if (canEdit) form(root, async (v) => { const b = build(v); await api("PATCH", `/api/communities/${st.cid}/automod`, b); agOn = !!b.guard.enabled; sync(); });
    root.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => {
      const p = b.dataset.preset === "off" ? meta.defaults.v2 : meta.presets[b.dataset.preset].v2, flat = {};
      for (const [k, r] of Object.entries(p)) for (const [o, val] of Object.entries(r)) { if (o === "words" || o === "domains") continue; if (o === "categories") { for (const c of Object.keys(CATS_AR)) flat[`v2.classify.cat.${c}`] = val.includes(c); continue; } flat[`v2.${k}.${o}`] = val; }
      applyValues(root, flat); sync(); root._caUpdate?.();
      toast(b.dataset.preset === "off" ? "أُوقفت القواعد المتقدمة. راجعها ثم احفظ." : Tf("طُبّق «{name}». راجع القواعد ثم احفظ.", { name: trI(meta.presets[b.dataset.preset].title) }));
    }));
    const gp = root.querySelector("#ag-pre");
    if (gp) gp.onclick = () => { const g = meta.guardPreset.guard, flat = {}; for (const [k, val] of Object.entries(g)) flat["g." + k] = k === "fullLock" ? (val ? "1" : "0") : typeof val === "number" ? String(val) : val; applyValues(root, flat); sync(); root._caUpdate?.(); toast(Tf("طُبّق «{name}». راجع القواعد ثم احفظ.", { name: trI(meta.guardPreset.title) })); };
    const gres = root.querySelector("#ag-tres");
    root.querySelector("#ag-tgo").onclick = async (e) => {
      const ti = root.querySelector("#ag-tt"), text = ti.value; if (!text.trim()) { ti.focus(); return; }
      busy(e.currentTarget, true); const btn = e.currentTarget;
      try {
        const g = (await api("POST", `/api/communities/${st.cid}/automod/test`, { text, kind: "post", config: build(collect(root)) })).guard;
        const hit = g && g.hit, o = g?.outcome;
        gres.innerHTML = `<div class="am-verdict ${hit ? "danger" : "ok"}">${ic(hit ? "ban" : "check", "sm")}<b>${hit ? h(tr("سيُحذف")) : h(tr("لا يطابق الحارس · يُنشر"))}</b></div>${hit && o ? `<p class="ag-out" dir="auto">${h(Tf("تحذير {n} من {max}", { n: num(o.n), max: num(o.max) }))} · ${h(o.locked ? tr("إيقاف حتى يرفعه مشرف") : o.hours ? Tf("كتم {h} ساعة", { h: num(o.hours) }) : tr("بلا كتم"))}</p>${g.words.length ? `<p class="am-norm"><small>${h(tr("العبارات المطابقة"))}</small><span dir="auto">${g.words.map((w) => `<bdi>${h(w)}</bdi>`).join(" · ")}</span></p>` : ""}` : ""}${g && !g.applies && hit ? `<p class="muted u-m0">${h(tr("الحارس متوقف الآن، فلن يُطبَّق قبل تشغيله وحفظه."))}</p>` : ""}`;
      } catch (er) { gres.innerHTML = `<p class="ca-danger">${h(er.message)}</p>`; }
      finally { busy(btn, false); }
    };
    const tres = body.querySelector("#am-tres");
    body.querySelector("#am-tgo").onclick = async (e) => {
      const text = body.querySelector("#am-tt").value; if (!text.trim()) { body.querySelector("#am-tt").focus(); return; }
      busy(e.target, true);
      try {
        const r = await api("POST", `/api/communities/${st.cid}/automod/test`, { text, kind: body.querySelector("#am-tc").checked ? "comment" : "post", memberPosts: body.querySelector("#am-tn").checked ? 0 : undefined, accountAgeDays: body.querySelector("#am-tn").checked ? 0 : 365, duplicate: body.querySelector("#am-td").checked, config: build(collect(root)) });
        const tone = { allow: "ok", report: "warn", queue: "warn", reject: "danger" }[r.final];
        const rows = [...(r.legacy?.reasons || []).map((x) => ["القواعد الأساسية", x]), ...r.v2.map((m) => [m.title, m.reason + " · " + (meta.actions[m.action] || m.action)])];
        tres.innerHTML = `<div class="am-verdict ${tone}">${ic(r.final === "allow" ? "check" : r.final === "reject" ? "ban" : "flag", "sm")}<b>${h(r.label)}</b></div>${rows.length ? `<ul class="am-hits">${rows.map(([t, x]) => `<li><b>${h(t)}</b><span>${h(x)}</span></li>`).join("")}</ul>` : `<p class="muted u-m0">لا تطابق أي قاعدة.</p>`}${r.normalized ? `<p class="am-norm"><small>كما يقرؤه المحرك</small><span>${h(r.normalized)}</span></p>` : ""}`;
      } catch (er) { tres.innerHTML = `<p class="ca-danger">${h(er.message)}</p>`; }
      finally { busy(e.target, false); }
    };
  }

  /* ======================= v2.60 «التحليلات والنمو والتكاملات والإشعارات» =======================
   * insights (period 7/30/90, growth, engagement, actives, cohorts, best time to post, funnel, moderation health, health
   * card, CSV), events (server list + community calendar + default reminders), integrations (bots, signed webhooks,
   * study/courses/market, Pi features shown OFF «غير مفعّل بعد», MJT rewards paid by the owner), growth (invite links with
   * QR + revoke, partner search, challenges) and the default notifications for new members. Bars, heat cells and shares are
   * set through CSSOM custom properties (no inline style attributes). */
  const pctTxt = (v) => (v === null || v === undefined ? "—" : `${num(v)}%`);
  const chg = (d) => (d && d.change !== null && d.change !== undefined ? `<small class="ca-chg ${d.change > 0 ? "up" : d.change < 0 ? "down" : ""}">${d.change > 0 ? "+" : ""}${num(d.change)}% عن الفترة السابقة</small>` : `<small>لا مقارنة بعد</small>`);
  const mins = (m) => (m === null || m === undefined ? "—" : m < 60 ? `${num(m)} د` : m < 1440 ? `${num(Math.round(m / 60))} س` : `${num(Math.round(m / 1440))} ي`);
  const paintVars = (root) => root.querySelectorAll("[data-h],[data-v],[data-w]").forEach((el) => { for (const [a, p] of [["h", "--h"], ["v", "--v"], ["w", "--w"]]) if (el.dataset[a] !== undefined) el.style.setProperty(p, el.dataset[a]); });
  const dlCsv = (csv, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };

  /* ---------- 12. insights ---------- */
  const SERIES = [["active_users", "النشطون"], ["posts", "المنشورات"], ["comments", "التعليقات"], ["new_members", "الانضمام"]];
  async function secInsights(body) {
    let days = +(hashParts().q.get("d") || 30); if (![7, 30, 90].includes(days)) days = 30; let metric = "active_users";
    const load = async () => {
      body.innerHTML = `<div class="skel sm"></div><div class="skel"></div>`;
      let d; try { d = await api("GET", `/api/communities/${st.cid}/insights?days=${days}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh")}`); } catch (e) { body.innerHTML = errBox(e, true); return; }
      const g = d.growth, en = d.engagement, a = d.actives;
      const kpi = [["الانضمام", g.joins.value, "uplus", chg(g.joins)], ["صافي النمو", g.net, "trendUp", `<small>${num(g.leaves.value)} غادروا</small>`], ["المنشورات", en.posts.value, "doc", chg(en.posts)], ["التعليقات", en.comments.value, "comment", chg(en.comments)], ["التفاعلات", en.reactions.value, "heart", chg(en.reactions)], ["المشاهدات", en.views.value, "eye", chg(en.views)]];
      const max = (k) => Math.max(1, ...d.series.map((s) => s[k]));
      const bars = (k) => `<div class="ca-ibars" role="img" aria-label="${h(SERIES.find((x) => x[0] === k)[1])} يومياً: المجموع ${num(d.series.reduce((x, s) => x + s[k], 0))}، الأعلى ${num(max(k))}">${d.series.map((s) => `<i data-h="${Math.max(3, Math.round((s[k] / max(k)) * 100))}%" title="${h(s.day)}: ${num(s[k])}"></i>`).join("")}</div><div class="ca-iaxis" aria-hidden="true"><span>${h(when(d.series[0].day))}</span><span>اليوم</span></div>`;
      const heatMax = Math.max(1, ...d.heatmap.grid.flat());
      const heat = `<div class="ca-heat" role="img" aria-label="${d.heatmap.best ? `أفضل وقت للنشر: ${h(d.heatmap.best.label)} بتوقيت ${h(d.tz)}` : "لا نشاط كافٍ بعد"}"><span></span>${[0, 6, 12, 18].map((x) => `<b class="ca-hh" data-w="${x}">${num(x)}</b>`).join("")}${d.heatmap.grid.map((row, w) => `<small>${h(d.heatmap.weekdays[w].replace("ال", ""))}</small>${row.map((v) => `<i data-v="${(v / heatMax).toFixed(2)}"${v ? ` title="${num(v)}"` : ""}></i>`).join("")}`).join("")}</div>`;
      const cohort = d.cohorts.filter((c) => c.size).length ? `<div class="ca-twrap" tabindex="0" role="region" aria-label="بقاء الأعضاء الجدد أسبوعياً"><table class="ca-coh"><caption class="vh">بقاء الأعضاء الجدد أسبوعياً</caption><thead><tr><th scope="col">أسبوع الانضمام</th><th scope="col">العدد</th>${[1, 2, 3, 4].map((k) => `<th scope="col">أسبوع ${num(k)}</th>`).join("")}</tr></thead><tbody>${d.cohorts.filter((c) => c.size).map((c) => `<tr><th scope="row">${h(when(c.week))}</th><td>${num(c.size)}</td>${[0, 1, 2, 3].map((i) => (c.retention[i] === undefined ? `<td class="na">—</td>` : `<td data-v="${((c.retention[i] || 0) / 100).toFixed(2)}">${pctTxt(c.retention[i])}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">تظهر الدفعات بعد انضمام أعضاء جدد ومرور أسبوع على انضمامهم.</p>`;
      const fn = d.funnel, step = (l, v, s) => `<li><b>${num(v)}</b><span>${h(l)}</span>${s !== undefined ? `<small>${h(s)}</small>` : ""}</li>`;
      const mo = d.moderation;
      body.innerHTML = `<div class="ca-itools"><div class="seg" role="tablist" aria-label="الفترة">${[7, 30, 90].map((x) => `<button type="button" role="tab" data-days="${x}" class="${x === days ? "on" : ""}" aria-selected="${x === days}">${num(x)} يوماً</button>`).join("")}</div><span class="grow"></span><button type="button" class="btn ghost sm" id="ca-iexp">${ic("download", "xs")} تصدير CSV</button></div>
        <p class="ca-inote muted">${ic("infoC", "xs")} أرقام اليوم تُحدَّث لحظياً وتُراجَع كل ليلة، وأفضل وقت للنشر بتوقيت ${h(d.tz)}.${d.canExportMembers ? "" : " التصدير يشمل الأرقام المجمّعة فقط؛ بيانات الأعضاء للمالك."}</p>
        <div class="kpi-grid ca-kpis ca-ikpi">${kpi.map(([l, v, i, x]) => `<div class="kpi-tile ca-kpi"><span class="ca-kpi-l">${ic(i, "xs")}${h(l)}</span><b>${num(v)}</b>${x}</div>`).join("")}</div>
        ${card("النشطون", "users", `<div class="kpi-grid ca-kpis ca-kpi4">${[["يومياً", a.dau], ["أسبوعياً", a.wau], ["شهرياً", a.mau], ["الالتصاق", pctTxt(a.stickiness)]].map(([l, v]) => `<div class="kpi-tile ca-kpi"><span class="ca-kpi-l">${h(l)}</span><b>${typeof v === "number" ? num(v) : v}</b></div>`).join("")}</div><p class="muted">${num(a.activeShare)}% من الأعضاء نشطون هذا الأسبوع. الالتصاق = متوسط النشطين يومياً ÷ النشطين شهرياً.</p>`, { id: "ca-act" })}
        ${card("النشاط اليومي", "chart", `<div class="seg ca-iseg" role="tablist" aria-label="المؤشر">${SERIES.map(([k, l]) => `<button type="button" role="tab" data-metric="${k}" class="${k === metric ? "on" : ""}" aria-selected="${k === metric}">${h(l)}</button>`).join("")}</div><div id="ca-bars">${bars(metric)}</div>`)}
        <div class="ca-igrid">
        ${card("أفضل وقت للنشر", "clock", `${heat}<p class="ca-best">${d.heatmap.best ? `${ic("target", "xs")} أكثر الأوقات نشاطاً: <b>${h(d.heatmap.best.label)}</b>` : `<span class="muted">لا نشاط كافٍ في هذه الفترة.</span>`}</p>`, { id: "ca-heatc" })}
        ${card("بقاء الدفعات", "layers", cohort, { sub: "نسبة من بقي نشطاً من كل دفعة في الأسابيع التالية" })}
        ${card("أفضل المنشورات", "fire", d.topPosts.length ? `<ol class="ca-tops">${d.topPosts.map((p) => `<li><a href="#/post/${h(p.id)}"><b>${h(p.title || "منشور")}</b><small>${ic("heart", "xs")}${num(p.reactions)} · ${ic("comment", "xs")}${num(p.comments)} · ${ic("eye", "xs")}${num(p.views)}</small></a></li>`).join("")}</ol>` : `<p class="muted">لا منشورات في هذه الفترة.</p>`)}
        ${card("أفضل المساهمين", "award", d.contributors.length ? `<ul class="ca-rows">${d.contributors.slice(0, 8).map((x, i) => `<li class="ca-row"><span class="ca-n">${num(i + 1)}</span>${avatar(x.user)}<div class="grow"><b>${h(x.user.name)}</b><small>${num(x.posts)} منشور · ${num(x.comments)} تعليق</small></div></li>`).join("")}</ul>` : `<p class="muted">لا مساهمات في هذه الفترة.</p>`)}
        ${card("القنوات", "hash", d.channels.length ? `<ul class="ca-shares">${d.channels.map((x) => `<li><span class="grow">${h(x.name)}${x.archived ? " · مؤرشفة" : ""}</span><b>${num(x.posts)}</b><i data-w="${Math.round((x.posts / d.channels[0].posts) * 100)}%" aria-hidden="true"></i></li>`).join("")}</ul>` : `<p class="muted">لا منشورات في القنوات بعد.</p>`)}
        ${card("قمع الدعوات", "link", `<ol class="ca-funnel">${step("نقرة على روابط الدعوة", fn.clicks, `${num(fn.links)} رابط`)}${step("انضموا عبرها", fn.joins, fn.clicks ? `${pctTxt(Math.round((fn.joins / fn.clicks) * 100))} من النقرات` : undefined)}${step("نشطون منهم", fn.active, fn.joins ? `${pctTxt(Math.round((fn.active / fn.joins) * 100))} من المنضمين` : undefined)}</ol><p class="muted">في هذه الفترة: ${num(fn.inPeriod)} انضمام عبر الدعوات.</p>${has("invite") ? `<a class="btn ghost sm" href="${href(st.cid, "growth")}">روابط الدعوة</a>` : ""}`)}
        ${card("صحة الإشراف", "shield", `<div class="kpi-grid ca-kpis ca-kpi4">${[["أول قرار (وسيط)", mins(mo.firstDecisionMin)], ["في الطابور", num(mo.queue)], ["مسكه الآلي", num(mo.automodCaught)], ["استئنافات مفتوحة", num(mo.appeals)]].map(([l, v]) => `<div class="kpi-tile ca-kpi"><span class="ca-kpi-l">${h(l)}</span><b>${v}</b></div>`).join("")}</div><p class="muted">${num(mo.actions)} إجراء إشراف في الفترة · ${num(mo.decisions)} قرار على منشورات معلّقة.</p><a class="btn ghost sm" href="${href(st.cid, "moderation")}">طابور الإشراف</a>`)}
        ${d.health ? card("صحة المجتمع", "chart", `<div class="ca-setup-h"><svg viewBox="0 0 44 44" class="ca-ring" aria-hidden="true"><circle cx="22" cy="22" r="18" class="bg"/><circle cx="22" cy="22" r="18" class="fg" stroke-dasharray="${(d.health.score * 1.131).toFixed(1)} 200"/></svg><div><b>${num(d.health.score)}</b><small>${h(d.health.grade)}</small></div></div>${d.health.tips.length ? `<ul class="h-tips">${d.health.tips.map((t) => `<li>${h(t)}</li>`).join("")}</ul>` : ""}<a class="btn ghost sm" href="${href(st.cid, "health")}">التقرير الكامل</a>`, { id: "ca-hcard" }) : ""}
        </div>`;
      paintVars(body);
      body.querySelectorAll("[data-days]").forEach((b) => (b.onclick = () => { days = +b.dataset.days; history.replaceState(history.state, "", href(st.cid, "insights", days === 30 ? "" : "&d=" + days)); load(); }));
      body.querySelectorAll("[data-metric]").forEach((b) => (b.onclick = () => { metric = b.dataset.metric; body.querySelectorAll("[data-metric]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }); const box = body.querySelector("#ca-bars"); box.innerHTML = bars(metric); paintVars(box); }));
      body.querySelector("#ca-iexp").onclick = async (e) => { busy(e.target, true); try { const r = await api("GET", `/api/communities/${st.cid}/insights/export?days=${days}`); dlCsv(r.csv, r.filename); toast(r.members ? "✓ صُدّر الملف مع بيانات الأعضاء" : "✓ صُدّرت الأرقام المجمّعة"); } catch (er) { toast(er.message); } finally { busy(e.target, false); } };
    };
    await load();
  }

  /* ---------- 10. events ---------- */
  async function secEvents(body) {
    let tab = "upcoming";
    const load = async () => {
      let d; try { d = await api("GET", `/api/communities/${st.cid}/events/manage?tab=${tab}`); } catch (e) { body.innerHTML = errBox(e, true); return; }
      const rec = { weekly: "أسبوعية", biweekly: "كل أسبوعين", monthly: "شهرية" };
      const dt = (t) => new Date(t).toLocaleString(loc(), { numberingSystem: "latn", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const origin = location.origin;
      body.innerHTML = `${card("فعاليات المجتمع", "cal", `<div class="ca-itools"><div class="seg" role="tablist" aria-label="الفعاليات">${[["upcoming", "القادمة", d.counts.upcoming], ["past", "السابقة", d.counts.past]].map(([k, l, c]) => `<button type="button" role="tab" data-etab="${k}" class="${k === tab ? "on" : ""}" aria-selected="${k === tab}">${l} (${num(c)})</button>`).join("")}</div><span class="grow"></span>${d.canCreate ? `<button type="button" class="btn sm" id="ca-evnew">${ic("plus", "xs")} فعالية جديدة</button>` : ""}</div>
        ${d.events.length ? `<ul class="ca-rows">${d.events.map((e) => `<li class="ca-row ca-ev"><span class="ca-ci">${ic(e.online ? "globe" : "cal", "sm")}</span><a class="grow" href="${h(e.href)}"><b>${h(e.name)}</b><small>${h(dt(e.startsAt))}${e.place ? " · " + h(e.place) : ""}${e.organizer ? " · " + h(e.organizer) : ""}</small><span class="ca-evm">${e.recurrence ? badge(rec[e.recurrence] || "متكررة", "acc") : ""}${badge(e.capacity ? `${num(e.confirmed)} من ${num(e.capacity)} مقعد` : `${num(e.confirmed + e.going)} حضور`, e.capacity && e.confirmed >= e.capacity ? "warn" : "")}${e.waitlist ? badge(`${num(e.waitlist)} في الانتظار`, "warn") : ""}${tab === "past" && e.checkedIn ? badge(`${num(e.checkedIn)} حضروا`, "ok") : ""}</span></a><span class="chev" aria-hidden="true">←</span></li>`).join("")}</ul>` : UI.empty({ title: tab === "past" ? "لا فعاليات سابقة" : "لا فعاليات قادمة", text: "الفعالية تجمع الأعضاء: لقاء، ورشة، بث مباشر.", action: d.canCreate && tab === "upcoming" ? `<button type="button" class="btn sm" id="ca-evnew2">${ic("plus", "xs")} أنشئ أول فعالية</button>` : "" })}`)}
        ${card("تقويم المجتمع", "calendar", d.ics ? `<p class="muted">اشترك في تقويم المجتمع من تطبيق التقويم في جوالك أو حاسوبك، فتظهر كل فعالية جديدة تلقائياً.</p><div class="ca-inline"><input readonly dir="ltr" value="${h(origin + d.ics)}" aria-label="${h(tr("رابط تقويم المجتمع"))}" id="ca-icsv"><button type="button" class="btn ghost sm" id="ca-icsc">${ic("copy", "xs")} نسخ</button></div>` : lockNote(d.icsNote))}
        ${card("التذكير الافتراضي", "bell", `<p class="muted">يصل الحاضرين تذكير قبل الفعالية. اختر ما يُرسل في هذا المجتمع.</p>${sw("ev-day", "قبل يوم", "تذكير قبل 24 ساعة من البداية", d.reminders.day, !d.canEdit)}${sw("ev-hour", "قبل ساعة", "تذكير قبل ساعة من البداية", d.reminders.hour, !d.canEdit)}`, { lock: d.canEdit ? "" : "للمالك والمديرين" })}`;
      body.querySelectorAll("[data-etab]").forEach((b) => (b.onclick = () => { tab = b.dataset.etab; load(); }));
      const create = () => { if (MPCommunities.eventCreate) MPCommunities.eventCreate(st.cid); else location.hash = `#/c/${st.cid}/events`; };
      body.querySelector("#ca-evnew")?.addEventListener("click", create); body.querySelector("#ca-evnew2")?.addEventListener("click", create);
      body.querySelector("#ca-icsc")?.addEventListener("click", () => { navigator.clipboard?.writeText(body.querySelector("#ca-icsv").value).catch(() => {}); toast("✓ نُسخ رابط التقويم"); });
      body.querySelectorAll('[data-k="ev-day"],[data-k="ev-hour"]').forEach((i) => (i.onchange = async () => {
        const v = { day: body.querySelector('[data-k="ev-day"]').checked, hour: body.querySelector('[data-k="ev-hour"]').checked };
        try { await api("PATCH", `/api/communities/${st.cid}/settings/events`, { eventReminders: v }); toast("✓ حُفظ التذكير الافتراضي"); } catch (e) { i.checked = !i.checked; toast(e.message); }
      }));
    };
    await load();
  }

  /* ---------- 14. integrations ---------- */
  async function secIntegrations(body) {
    let d; try { d = await api("GET", `/api/communities/${st.cid}/integrations`); } catch (e) { body.innerHTML = errBox(e, true); return; }
    const m = d.mjt, rw = m.settings, mg = d.canManage;
    const hookRow = (w) => `<li class="ca-row ca-hook"><span class="ca-ci">${ic("webhook", "sm")}</span><div class="grow"><b>${h(w.label || (() => { try { return new URL(w.url).host; } catch { return w.url; } })())}</b><small dir="ltr" class="ca-url">${h(w.url)}</small><span class="ca-evm">${w.events.map((e) => badge((d.hookEvents.find((x) => x.key === e) || {}).label || e)).join("")}${w.status !== "active" ? badge("متوقف", "warn") : ""}${w.last ? badge(w.last.status === "ok" ? "آخر إرسال ناجح" : w.last.status === "failed" ? "فشل آخر إرسال" : "قيد الإرسال", w.last.status === "ok" ? "ok" : w.last.status === "failed" ? "danger" : "") : ""}</span></div><button type="button" class="btn ghost icon" data-hk="${h(w.id)}" aria-label="خيارات ${h(w.label || w.url)}">${ic("more", "sm")}</button></li>`;
    const piSw = (f) => `<label class="switch-row ca-sw is-off"><span><b>${h(f.label)} ${badge("غير مفعّل بعد", "warn")}</b><small>${h(f.desc)}</small></span><input type="checkbox" class="switch" role="switch" aria-checked="false" disabled aria-label="${h(tr(`${f.label} (غير مفعّل بعد)`))}"></label>`;
    const num7 = (k, l, s) => `<label class="field"><span class="lbl">${h(l)}</span><span class="ca-mjtin"><input type="text" inputmode="decimal" dir="ltr" data-rw="${k}" value="${h(rw[k])}" ${m.canEdit ? "" : "disabled"} aria-describedby="rw-${k}-h"><i>MJT</i></span><small class="muted" id="rw-${k}-h">${h(s)}</small></label>`;
    const RS = { paid: ["دُفعت", "ok"], capped: ["بلغ الحد اليومي", "warn"], unfunded: ["رصيد المالك لا يكفي", "danger"], skipped: ["لم تُدفع", ""], reversed: ["استُرجعت", ""], partially_reversed: ["استُرجعت جزئياً", "warn"], pending: ["قيد المعالجة", ""] };
    body.innerHTML = `
      ${card("البوتات", "bot", d.bots.available ? `${d.bots.items.length ? `<ul class="ca-rows">${d.bots.items.map((b) => `<li class="ca-row"><span class="ca-ci">${ic("bot", "sm")}</span><div class="grow"><b>${h(b.name)}</b><small dir="ltr">@${h(b.handle || "")}${b.commands.length ? " · /" + b.commands.map(h).join(" /") : ""}</small></div>${mg ? `<button type="button" class="btn ghost sm" data-unbot="${h(b.app)}">إزالة</button>` : ""}</li>`).join("")}</ul>` : `<p class="muted">لا بوتات مثبّتة. البوت يرد على أوامر مثل /مساعدة ويستقبل الإشارات إليه.</p>`}
        ${mg ? `<div class="ca-inline"><input id="ca-botid" dir="ltr" placeholder="${h(tr("معرّف التطبيق (client id)"))}" aria-label="${h(tr("معرّف تطبيق البوت"))}" autocomplete="off"><button type="button" class="btn sm" id="ca-botgo">${ic("plus", "xs")} تثبيت</button></div><a class="ca-rlink" href="#/dev">${ic("code", "xs")} واجهة المطورين</a>` : ""}` : lockNote(d.bots.note))}
      ${mg ? card("Webhooks المجتمع", "webhook", `<p class="muted">أرسل أحداث المجتمع إلى خادمك: انضمام عضو، منشور جديد، بلاغ جديد. كل طلب موقَّع بـ HMAC-SHA256 في الترويسة <code dir="ltr">X-Mujtama-Signature</code> كما في واجهة المطورين.</p>
        <ul class="ca-rows" id="ca-hooks">${d.webhooks.map(hookRow).join("")}</ul>${d.webhooks.length ? "" : `<p class="muted" id="ca-hk0">لا روابط بعد.</p>`}
        <div class="ca-acts"><button type="button" class="btn sm" id="ca-hknew">${ic("plus", "xs")} رابط Webhook</button><button type="button" class="btn ghost sm" id="ca-hklog">${ic("list", "xs")} سجل الإرسال</button></div><div id="ca-hkl"></div>`, { id: "ca-wh" }) : ""}
      ${card("الدراسة والدورات والسوق", "book", `<div class="list flat">${UI.li({ href: d.study.href || `#/study`, icon: "cap", title: d.study.linked ? (d.study.mode === "halaqa" ? "حلقة مرتبطة بالمجتمع" : "مجموعة دراسة مرتبطة") : "مجموعة دراسة أو حلقة", sub: d.study.linked ? (d.study.subject || "الجلسات والحضور والملاحظات") : "حوّل المجتمع إلى مجموعة دراسة من صفحة الدراسة" })}${UI.li({ href: d.courses.href || "#/courses", icon: "book", title: "الدورات", sub: `${num(d.courses.published)} منشورة${d.courses.drafts ? ` · ${num(d.courses.drafts)} مسودة` : ""}` })}${UI.li({ href: d.market.href, icon: "store", title: "سوق المجتمع", sub: `${num(d.market.listings)} قائمة نشطة` })}</div>
        ${sw("mk-tab", "تبويب السوق في صفحة المجتمع", "يعرض قوائم السوق المرتبطة بالمجتمع للأعضاء", d.market.marketTab, !mg)}`, { lock: mg ? "" : "للمالك والمديرين" })}
      ${card("ميزات Pi", "wallet", `<div class="notice warn ca-flag">${ic("infoC", "sm")}<span>${h(d.pi.note)}</span></div>${d.pi.features.map(piSw).join("")}`, { id: "ca-pi", sub: "ظاهرة ومتوقفة حتى التفعيل" })}
      ${card("مكافآت مجتمع كوين", "coin", `${m.platformEnabled ? "" : `<div class="notice warn ca-flag">${ic("infoC", "sm")}<span>مكافآت مجتمع كوين متوقفة على المنصة حالياً؛ لن تُدفع مكافآت حتى تعود.</span></div>`}
        <p class="muted">كافئ الأعضاء بـ MJT على المنشورات والإجابات المقبولة. <b>تُدفع من محفظة مالك المجتمع</b> عبر دفتر مجتمع كوين، بحد يومي لكل عضو وللمجتمع، وتُسترجع إذا حُذف المحتوى. لا تُصدر عملات جديدة.</p>
        ${m.ownerBalance !== null ? `<div class="kpi-grid ca-kpis ca-kpi4"><div class="kpi-tile ca-kpi"><span class="ca-kpi-l">رصيدك</span><b dir="ltr">${h(m.ownerBalance)}</b><small>MJT</small></div><div class="kpi-tile ca-kpi"><span class="ca-kpi-l">دُفع اليوم</span><b dir="ltr">${h(m.today.paid)}</b><small>${num(m.today.count)} مكافأة</small></div></div>` : ""}
        <div id="ca-rw" class="ca-form">${sw("rw-on", "تشغيل المكافآت", "كل منشور أو إجابة مقبولة من عضو (لا يُكافأ المالك نفسه)", rw.enabled, !m.canEdit)}
        <div class="ca-2">${num7("perPost", "لكل منشور", `0 إلى ${rw.max.perPost}`)}${num7("perAnswer", "لكل إجابة مقبولة", `0 إلى ${rw.max.perAnswer}`)}</div>
        <div class="ca-2">${num7("memberDailyCap", "حد العضو اليومي", `حتى ${rw.max.memberDailyCap}`)}${num7("communityDailyCap", "حد المجتمع اليومي", `حتى ${rw.max.communityDailyCap}`)}</div>
        ${m.canEdit ? `<button type="button" class="btn sm" id="ca-rwsave">${ic("check", "xs")} حفظ المكافآت</button>` : lockNote("المكافآت من رصيد المالك، فيعدّلها المالك فقط")}</div>
        ${m.recent.length ? `<details class="ca-donel"><summary>${ic("list", "xs")} آخر المكافآت (${num(m.recent.length)})</summary><ul class="ca-rows">${m.recent.map((r) => `<li class="ca-row"><div class="grow"><b>${h(r.member.name || "")}</b><small>${r.kind === "answer" ? "إجابة مقبولة" : "منشور"} · ${h(rel(r.at))}${r.reason && r.status !== "paid" ? " · " + h(r.reason) : ""}</small></div><b dir="ltr">${h(r.amount)}</b>${badge((RS[r.status] || [r.status])[0], (RS[r.status] || [])[1] || "")}</li>`).join("")}</ul></details>` : ""}`, { id: "ca-mjt" })}`;
    /* bots */
    body.querySelector("#ca-botgo")?.addEventListener("click", async (e) => { const v = body.querySelector("#ca-botid").value.trim(); if (!v) return; busy(e.target, true); try { await api("POST", `/api/dev/apps/${encodeURIComponent(v)}/installs`, { community: st.cid }); toast("✓ ثُبّت البوت"); secIntegrations(body); } catch (er) { toast(er.message); busy(e.target, false); } });
    body.querySelectorAll("[data-unbot]").forEach((b) => (b.onclick = async () => { const r = await ask({ title: "إزالة البوت من المجتمع؟", text: "يتوقف عن استقبال الأوامر والإشارات هنا.", ok: "إزالة", danger: true }); if (!r) return; try { await api("DELETE", `/api/dev/apps/${encodeURIComponent(b.dataset.unbot)}/installs/${st.cid}`); toast("أُزيل البوت"); secIntegrations(body); } catch (er) { toast(er.message); } }));
    /* webhooks */
    const secretSheet = (secret, note) => { sheet(`<h3 class="u-mt0">${ic("key", "sm")} سرّ التوقيع</h3><p class="muted">${h(note)}</p><div class="ca-inline"><input readonly dir="ltr" value="${h(secret)}" id="hk-sec" aria-label="${h(tr("سرّ التوقيع"))}"><button type="button" class="btn sm" id="hk-cp">${ic("copy", "xs")} نسخ</button></div><button type="button" class="btn ghost block u-mt10" data-ui="close-sheet">تم</button>`); document.getElementById("hk-cp").onclick = () => { navigator.clipboard?.writeText(secret).catch(() => {}); toast("✓ نُسخ السرّ"); }; };
    body.querySelector("#ca-hknew")?.addEventListener("click", () => {
      sheet(`<h3 class="u-mt0">رابط Webhook جديد</h3><label class="field"><span class="lbl">الرابط</span><input id="hk-u" dir="ltr" placeholder="https://example.com/hooks/mujtama" inputmode="url"></label><label class="field"><span class="lbl">التسمية (اختياري)</span><input id="hk-l" maxlength="40" placeholder="${h(tr("مثل: خادم الإحصاءات"))}"></label>
        <fieldset class="ca-fs"><legend class="lbl">الأحداث</legend>${d.hookEvents.map((e) => `<label class="chk"><input type="checkbox" data-he="${h(e.key)}" checked><span>${h(e.label)} <small dir="ltr">${h(e.key)}</small></span></label>`).join("")}</fieldset>
        <p class="muted">في المجتمعات الخاصة لا يُرسل نص المنشورات، ولا يُذكر صاحب البلاغ أبداً.</p><button type="button" class="btn block u-mt10" id="hk-go">${ic("plus", "xs")} إنشاء</button>`);
      document.getElementById("hk-go").onclick = async (e) => { busy(e.target, true); try { const r = await api("POST", `/api/communities/${st.cid}/webhooks`, { url: document.getElementById("hk-u").value.trim(), label: document.getElementById("hk-l").value.trim() || undefined, events: [...document.querySelectorAll("#sheet [data-he]:checked")].map((x) => x.dataset.he) }); d.webhooks.push(r.webhook); body.querySelector("#ca-hooks").insertAdjacentHTML("beforeend", hookRow(r.webhook)); body.querySelector("#ca-hk0")?.remove(); wireHooks(); secretSheet(r.secret, r.note); } catch (er) { toast(er.message); busy(e.target, false); } };
    });
    const wireHooks = () => body.querySelectorAll("[data-hk]").forEach((b) => (b.onclick = async () => {
      const w = d.webhooks.find((x) => x.id === b.dataset.hk); if (!w) return;
      const r = await ask({ title: w.label || w.url, choices: { label: "الإجراء", items: [["test", "إرسال تجربة"], [w.status === "active" ? "pause" : "resume", w.status === "active" ? "إيقاف مؤقت" : "استئناف"], ["rotate", "سرّ توقيع جديد"], ["delete", "حذف الرابط"]] }, choice: "test", ok: "تنفيذ" });
      if (!r?.choice) return; const base = `/api/communities/${st.cid}/webhooks/${w.id}`;
      try {
        if (r.choice === "test") { await api("POST", base + "/test"); toast("✓ أُرسلت تجربة — راجع سجل الإرسال"); }
        else if (r.choice === "pause" || r.choice === "resume") { const x = await api("PATCH", base, { status: r.choice === "pause" ? "paused" : "active" }); Object.assign(w, x.webhook); b.closest("li").outerHTML = hookRow(w); wireHooks(); }
        else if (r.choice === "rotate") { const ok = await ask({ title: "إنشاء سرّ توقيع جديد؟", text: "يتوقف السرّ الحالي فوراً؛ حدّث خادمك بالسرّ الجديد.", ok: "إنشاء", danger: true }); if (!ok) return; const x = await api("POST", base + "/rotate"); secretSheet(x.secret, x.note); }
        else if (r.choice === "delete") { const ok = await ask({ title: "حذف رابط Webhook؟", text: "يتوقف إرسال الأحداث إليه ويُحذف سجله.", ok: "حذف", danger: true }); if (!ok) return; await api("DELETE", base); d.webhooks = d.webhooks.filter((x) => x.id !== w.id); b.closest("li").remove(); toast("حُذف الرابط"); }
      } catch (er) { toast(er.message); }
    }));
    wireHooks();
    body.querySelector("#ca-hklog")?.addEventListener("click", async () => {
      const box = body.querySelector("#ca-hkl"); box.innerHTML = `<div class="skel sm"></div>`;
      try { const { items } = await api("GET", `/api/communities/${st.cid}/webhooks/deliveries`); const S = { ok: ["أُرسل", "ok"], failed: ["فشل", "danger"], pending: ["بانتظار المحاولة", "warn"] };
        box.innerHTML = items.length ? `<ul class="ca-rows">${items.map((x) => `<li class="ca-row"><div class="grow"><b dir="ltr">${h(x.event)}</b><small>${h(rel(x.createdAt))} · محاولات: ${num(x.attempts)}${x.lastCode ? " · HTTP " + num(x.lastCode) : ""}${x.lastError ? " · " + h(x.lastError) : ""}</small></div>${badge((S[x.status] || [x.status])[0], (S[x.status] || [])[1] || "")}${x.status !== "ok" ? `<button type="button" class="btn ghost sm" data-rt="${h(x.id)}">إعادة</button>` : ""}</li>`).join("")}</ul>` : `<p class="muted">لا إرسال بعد.</p>`;
        box.querySelectorAll("[data-rt]").forEach((b) => (b.onclick = async () => { await api("POST", `/api/communities/${st.cid}/webhooks/deliveries/${b.dataset.rt}/retry`).catch((e) => toast(e.message)); toast("أُعيدت المحاولة"); }));
      } catch (e) { box.innerHTML = errBox(e); }
    });
    /* market tab */
    body.querySelector('[data-k="mk-tab"]')?.addEventListener("change", async (e) => { try { await api("PATCH", `/api/communities/${st.cid}/settings/integrations`, { marketTab: e.target.checked }); toast(e.target.checked ? "✓ ظهر تبويب السوق" : "أُخفي تبويب السوق"); } catch (er) { e.target.checked = !e.target.checked; toast(er.message); } });
    /* MJT rewards (owner) */
    body.querySelector("#ca-rwsave")?.addEventListener("click", async (e) => {
      const v = { enabled: body.querySelector('[data-k="rw-on"]').checked }; body.querySelectorAll("[data-rw]").forEach((i) => { v[i.dataset.rw] = i.value.trim().replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace("٫", "."); });
      if (v.enabled) { const r = await ask({ title: "تشغيل مكافآت مجتمع كوين؟", text: `تُدفع من محفظتك: حتى ${v.communityDailyCap} MJT يومياً للمجتمع، و${v.memberDailyCap} MJT لكل عضو.`, ok: "تشغيل" }); if (!r) return; }
      busy(e.target, true); try { await api("PUT", `/api/communities/${st.cid}/mjt-rewards`, v); toast("✓ حُفظت المكافآت"); secIntegrations(body); } catch (er) { toast(er.message); busy(e.target, false); }
    });
  }

  /* ---------- 13. growth & partnerships (v2.60: invite links with QR + revoke, partner search, challenges list) ---------- */
  async function growthPanel(cid, host, opts = {}) { // v2.58: inside the panel the channels live in «القنوات والتصنيفات» (opts.noChannels)
    const root = host || view;
    const inPanel = !!host && st.cid === cid;
    const [sp, { partners }, ch, inv] = await Promise.all([api("GET", `/api/communities/${cid}/space`), api("GET", `/api/communities/${cid}/partners`), api("GET", `/api/communities/${cid}/challenges`).catch(() => ({ challenges: [] })), api("GET", `/api/communities/${cid}/invites`).catch(() => ({ invites: [] }))]);
    const again = () => growthPanel(cid, host, opts);
    const canP = !inPanel || has("manage_integrations"), canCh = !inPanel || has("manage_challenges"), canInv = !inPanel || has("invite");
    const CHS = { live: ["جارٍ", "ok"], upcoming: ["قادم", "acc"], ended: ["انتهى", ""] };
    const origin = location.origin;
    root.innerHTML = `${opts.noChannels ? "" : `<div class="card"><div class="row"><h4 class="u-m0 grow">${ic("hash", "sm")} القنوات</h4><button class="btn ghost sm" id="ch-new">${ic("plus", "xs")} قناة</button></div>${sp.channels.map(ch => `<div class="row ch-row"><b class="grow">${ic(ch.kind === "announcements" ? "mega" : ch.kind === "questions" ? "help" : ch.kind === "media" ? "camera" : "hash", "xs")} ${esc(ch.name)}</b><span class="chip">${ch.postPerm === "mods" ? "نشر للمشرفين" : "نشر للأعضاء"}</span><span class="chip">${ch.viewPerm === "public" ? "مرئية للجميع" : "للأعضاء"}</span><button class="btn ghost icon-only" data-chx="${ch.id}" aria-label="حذف القناة">${ic("trash", "xs")}</button></div>`).join("")}</div>`}
      ${canInv ? card("روابط الدعوة", "link", inv.invites.length ? `<ul class="ca-rows">${inv.invites.slice(0, 12).map((i) => { const dead = i.revokedAt || (i.expiresAt && new Date(i.expiresAt) < new Date()) || (i.maxUses && i.uses >= i.maxUses); return `<li class="ca-row ca-ginv"><span class="ca-ci">${ic("link", "sm")}</span><div class="grow"><b>${h(i.label || "رابط دعوة")}</b><small>${num(i.clicks)} نقرة · ${num(i.joins)} انضمام · ${num(i.active)} نشِط${i.maxUses ? ` · ${num(i.uses)} من ${num(i.maxUses)}` : ""}</small></div>${dead ? badge(i.revokedAt ? "أُلغي" : "منتهٍ") : `<button type="button" class="btn ghost icon" data-qr="${h(i.code)}" aria-label="رمز QR لـ ${h(i.label || "رابط الدعوة")}">${ic("qr", "sm")}</button><button type="button" class="btn ghost icon" data-cpi="${h(origin + i.url)}" aria-label="نسخ ${h(i.label || "رابط الدعوة")}">${ic("copy", "sm")}</button><button type="button" class="btn ghost icon" data-rvi="${h(i.code)}" aria-label="إلغاء ${h(i.label || "رابط الدعوة")}">${ic("x", "sm")}</button>`}</li>`; }).join("")}</ul>` : `<p class="muted">لا روابط بعد. أنشئ رابطاً لكل مكان تنشر فيه لتعرف أيها يجلب الأعضاء.</p>`, { act: `<button type="button" class="btn sm" id="s-inv">${ic("plus", "xs")} رابط</button>`, id: "ca-ginv" }) : ""}
      ${card("مجتمعات شريكة", "handshake", `${partners.map(p => `<div class="row ch-row"><b class="grow">${esc(p.icon || "")} ${esc(p.name)}</b>${p.incoming && canP ? `<button class="btn sm" data-pt="${p.id}">قبول</button>` : `<span class="chip">${p.status === "accepted" ? "شريك" : "بانتظار الرد"}</span>`}</div>`).join("") || '<p class="muted">شراكة واحدة تعرّف أعضاء مجتمعين على بعضهما.</p>'}
        ${canP ? `<label class="field"><span class="lbl">ابحث عن مجتمع لاقتراح شراكة</span><input type="search" id="pt-q" placeholder="${h(tr("اسم المجتمع"))}" autocomplete="off" aria-controls="pt-r"></label><ul class="ca-rows" id="pt-r" aria-live="polite"></ul>` : lockNote("الشراكات للمالك والمديرين")}`, { id: "ca-gpt" })}
      ${card("التحديات", "trophy", `<p class="muted">يكسب الأكثر تفاعلاً على منشورات تحمل وسم التحدي.</p>${ch.challenges.length ? `<ul class="ca-rows">${ch.challenges.map((x) => `<li class="ca-row"><span class="ca-ci">${ic("trophy", "sm")}</span><div class="grow"><b>${esc(x.title)}</b><small dir="auto">#${esc(x.tag)} · ينتهي ${h(when(x.endsAt))}${x.prize ? " · " + esc(x.prize) : ""}${x.winners?.length ? " · الفائز: " + esc(x.winners[0].user?.name || "") : x.leaderboard?.length ? ` · ${num(x.leaderboard.length)} مشاركة` : ""}</small></div>${badge((CHS[x.status] || [x.status])[0], (CHS[x.status] || [])[1] || "")}</li>`).join("")}</ul>` : ""}${canCh ? `<button class="btn ghost sm" id="cg-new">${ic("plus", "xs")} تحدٍّ</button>` : ""}`, { id: "ca-gch" })}`;
    if (!inPanel) root.querySelectorAll(".ca-card").forEach((x) => x.classList.add("card"));
    if ($("#ch-new")) $("#ch-new").onclick = () => { sheet(`<h4 class="u-mt0">قناة جديدة</h4><input id="cn-n" placeholder="${h(tr("اسم القناة"))}" aria-label="${h(tr("اسم القناة"))}"><input id="cn-d" placeholder="${h(tr("وصف (اختياري)"))}" class="u-mt8" aria-label="${h(tr("الوصف"))}"><label class="muted" for="cn-k">النوع</label><select id="cn-k"><option value="text">نقاش</option><option value="announcements">إعلانات</option><option value="questions">أسئلة</option><option value="media">وسائط</option></select><label class="muted" for="cn-v">من يرى القناة</label><select id="cn-v"><option value="public">الجميع</option><option value="members">الأعضاء فقط</option></select><label class="muted" for="cn-p">من ينشر</label><select id="cn-p"><option value="members">الأعضاء</option><option value="mods">المشرفون فقط</option></select><button class="btn block u-mt10" id="cn-go">إنشاء</button>`); $("#cn-go").onclick = async () => { try { await api("POST", `/api/communities/${cid}/channels`, { name: $("#cn-n").value, desc: $("#cn-d").value, kind: $("#cn-k").value, viewPerm: $("#cn-v").value, postPerm: $("#cn-p").value }); closeSheet(); again(); } catch (e) { toast(e.message); } }; };
    root.querySelectorAll("[data-chx]").forEach(b => b.onclick = () => { sheet(`<h4 class="u-mt0">حذف القناة؟</h4><p class="muted">تبقى منشوراتها، ولا تتغير من يراها.</p><div class="u-g8 row"><button class="btn danger grow" id="chx-go">حذف القناة</button><button class="btn ghost grow" data-ui="close-sheet">إلغاء</button></div>`); $("#chx-go").onclick = async () => { await api("DELETE", `/api/communities/${cid}/channels/${b.dataset.chx}`); closeSheet(); again(); }; });
    /* partners: search instead of a <select> of every community */
    const pq = root.querySelector("#pt-q"), pr = root.querySelector("#pt-r"); let pT = 0;
    const propose = async (other, btn) => { busy(btn, true); try { const r = await api("POST", `/api/communities/${cid}/partners`, { community: other }); toast(r.status === "accepted" ? "✓ أصبحتما شريكين" : "✓ أُرسل طلب الشراكة"); again(); } catch (e) { toast(e.message); busy(btn, false); } };
    const search = async () => { const q = pq.value.trim(); if (q.length < 2) { pr.innerHTML = ""; return; } try { const { results } = await api("GET", `/api/communities/${cid}/partners/search?q=${encodeURIComponent(q)}`); if (pq.value.trim() !== q) return; pr.innerHTML = results.length ? results.map((r) => `<li class="ca-row"><span class="ca-tile" data-g="${h(r.color || "")}">${h(r.icon || r.name[0])}</span><div class="grow"><b>${h(r.name)}</b><small>${num(r.members)} عضو${r.desc ? " · " + h(r.desc.slice(0, 60)) : ""}</small></div>${r.partner ? badge(r.partner === "accepted" ? "شريك" : "بانتظار الرد", r.partner === "accepted" ? "ok" : "") : `<button type="button" class="btn sm" data-pp="${h(r.id)}">اقتراح</button>`}</li>`).join("") : `<li class="ca-row"><span class="muted">لا نتائج لـ «${h(q)}»</span></li>`; paintTiles(pr); pr.querySelectorAll("[data-pp]").forEach((b) => (b.onclick = () => propose(b.dataset.pp, b))); } catch (e) { pr.innerHTML = `<li class="ca-row ca-danger">${h(e.message)}</li>`; } };
    if (pq) pq.oninput = () => { clearTimeout(pT); pT = setTimeout(search, 250); };
    root.querySelectorAll("[data-pt]").forEach(b => b.onclick = async () => { await api("POST", `/api/communities/${cid}/partners`, { community: b.dataset.pt }); toast("✓ قُبلت الشراكة"); again(); });
    /* invites: QR, copy, revoke */
    root.querySelectorAll("[data-cpi]").forEach((b) => (b.onclick = () => { navigator.clipboard?.writeText(b.dataset.cpi).catch(() => {}); toast("✓ نُسخ الرابط"); }));
    root.querySelectorAll("[data-qr]").forEach((b) => (b.onclick = async () => {
      const i = inv.invites.find((x) => x.code === b.dataset.qr), url = origin + i.url;
      let svg = ""; try { svg = await MPCommunities.qrSvg(url); } catch { svg = ""; }
      sheet(`<h3 class="u-mt0">${ic("qr", "sm")} ${h(i.label || "رابط دعوة")}</h3><div class="ca-qr" role="img" aria-label="رمز QR لرابط الدعوة">${svg || `<p class="muted">تعذّر إنشاء الرمز</p>`}</div><p class="ca-qru" dir="ltr">${h(url)}</p><p class="muted">اطبعه على ملصق أو اعرضه في لقاء: يفتح الرابط صفحة الانضمام مباشرة، وتُحسب نقراته.</p><div class="u-g8 row"><button type="button" class="btn grow" id="qr-cp">${ic("copy", "xs")} نسخ الرابط</button><button type="button" class="btn ghost grow" id="qr-dl">${ic("download", "xs")} تنزيل</button></div>`);
      document.getElementById("qr-cp").onclick = () => { navigator.clipboard?.writeText(url).catch(() => {}); toast("✓ نُسخ الرابط"); };
      document.getElementById("qr-dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); a.download = `invite-${i.code}.svg`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
    }));
    root.querySelectorAll("[data-rvi]").forEach((b) => (b.onclick = async () => { const r = await ask({ title: "إلغاء رابط الدعوة؟", text: "لن يفتح الرابط بعد الآن. تبقى إحصاءاته.", ok: "إلغاء الرابط", danger: true }); if (!r) return; try { await api("DELETE", `/api/communities/${cid}/invites/${b.dataset.rvi}`); toast("أُلغي الرابط"); again(); } catch (e) { toast(e.message); } }));
    paintTiles(root);
    $("#cg-new") && ($("#cg-new").onclick = () => { const d = new Date(Date.now() + 7 * 864e5); sheet(`<h4 class="u-mt0">تحدٍّ جديد</h4><input id="cg-t" placeholder="${h(tr("عنوان التحدي"))}" aria-label="${h(tr("عنوان التحدي"))}"><input id="cg-g" placeholder="${h(tr("الوسم (بدون #)"))}" class="u-mt8" aria-label="${h(tr("الوسم"))}"><textarea id="cg-d" placeholder="${h(tr("الوصف والشروط"))}" class="u-mh60 u-mt8" aria-label="${h(tr("الوصف"))}"></textarea><input id="cg-p" placeholder="${h(tr("الجائزة (اختياري)"))}" class="u-mt8" aria-label="${h(tr("الجائزة"))}"><label class="muted" for="cg-e">ينتهي</label><input type="date" id="cg-e" value="${d.toISOString().slice(0, 10)}"><button class="u-mt10 btn block" id="cg-go">إطلاق التحدي</button>`); $("#cg-go").onclick = async () => { try { await api("POST", `/api/communities/${cid}/challenges`, { title: $("#cg-t").value, tag: $("#cg-g").value, desc: $("#cg-d").value, prize: $("#cg-p").value, endsAt: new Date($("#cg-e").value + "T23:59:00").toISOString() }); closeSheet(); toast("✓ انطلق التحدي"); again(); } catch (e) { toast(e.message); } }; });
    root.querySelector("#s-inv")?.addEventListener("click", () => MPCommunities.invitesSheet(cid));
  }

  /* ---------- 15. the default notifications for NEW members (inside «الخصوصية والعضوية») ---------- */
  async function wireNotifyDefault(body) {
    const box = body.querySelector("#ca-ndef"); if (!box) return;
    let s; try { s = await api("GET", `/api/communities/${st.cid}/notify/summary`); } catch { box.remove(); return; }
    const OPTS = [["all", "bell", "كل شيء", "التعليقات والتفاعلات على منشوراتهم، والإعلانات والإشارات."], ["highlights", "mega", "الإعلانات والإشارات فقط", "أهدأ: لا تنبيه للتفاعلات والتعليقات."], ["digest", "clock", "ملخص يومي", "الإعلانات والإشارات، وملخص واحد في اليوم بالجديد."]];
    box.querySelector(".ca-ndb").innerHTML = `<div class="ca-types" role="radiogroup" aria-label="الإشعار الافتراضي للأعضاء الجدد">${OPTS.map(([k, i, t, x]) => `<label class="ca-type"><input type="radio" name="ca-nd" value="${k}" ${s.default === k ? "checked" : ""}><span class="ca-type-b">${ic(i, "sm")}<b>${t}</b><small>${x}</small></span></label>`).join("")}</div>
      <p class="muted">ينطبق على من ينضم من الآن، ويغيّره كل عضو من صفحة إشعارات المجتمع. ${s.custom ? `اختار ${num(s.custom)} عضواً إعداداً خاصاً (${num(s.highlights)} للمهم فقط، ${num(s.digest)} للملخص، ${num(s.muted)} كتموا المجتمع).` : ""}</p>`;
    box.querySelectorAll('input[name="ca-nd"]').forEach((r) => (r.onchange = async () => { try { await api("PATCH", `/api/communities/${st.cid}/settings/notify`, { notifyDefault: r.value }); toast("✓ حُفظ الإشعار الافتراضي"); } catch (e) { toast(e.message); } }));
  }

  /* ======================= v2.59 member appeal page (#/cappeal/:id) ======================= */
  async function appealView(cid) {
    document.body.classList.remove("ca-wide");
    if (!cid) { view.innerHTML = `<div class="wrap ca ap">${UI.pageHead({ back: ["#/communities", "المجتمعات"], title: "قراراتي والاستئناف", icon: "scale" })}${UI.empty({ title: "اختر مجتمعاً أولاً", text: "افتح صفحة المجتمع ثم «قراراتي والاستئناف» لترى القرارات التي تخصك فيه وتطلب مراجعتها.", action: `<a class="btn" href="#/communities">المجتمعات</a>` })}</div>`; return; } // v2.59: #/cappeal without a community never calls the API
    view.innerHTML = `<div class="wrap ca"><div class="skel sm"></div><div class="skel"></div></div>`;
    let d; try { d = await api("GET", `/api/communities/${cid}/appeals/mine`); } catch (e) { view.innerHTML = `<div class="wrap">${UI.pageHead({ back: [`#/c/${h(cid)}`, "المجتمع"], title: "قراراتي والاستئناف", icon: "scale" })}${errBox(e, false)}</div>`; return; }
    const ST = { open: ["قيد المراجعة", "warn", "hourglass"], accepted: ["قُبل استئنافك", "ok", "check"], rejected: ["رُفض الاستئناف", "danger", "x"] };
    const tone = (k) => (k === "ban" ? "danger" : k === "removal" ? "" : "warn"), m = d.membership;
    const dt = (t) => new Date(t).toLocaleString(loc(), { numberingSystem: "latn", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    view.innerHTML = `<div class="wrap ca ap">${UI.pageHead({ back: [`#/c/${h(cid)}`, d.community.name], title: "قراراتي والاستئناف", icon: "scale", sub: d.community.name })}
      ${m && ["muted", "banned"].includes(m.role) ? `<div class="notice ${m.role === "banned" ? "danger" : "warn"} ca-flag">${ic(m.role === "banned" ? "ban" : "volumeX", "sm")}<span>${m.role === "banned" ? "أنت محظور من هذا المجتمع." : `أنت مكتوم في هذا المجتمع${m.mutedUntil ? " حتى " + h(dt(m.mutedUntil)) : ""}.`} يمكنك طلب مراجعة القرار أدناه.</span></div>` : ""}
      ${card("كيف يعمل الاستئناف؟", "infoC", `<ol class="ap-steps"><li><b>اختر القرار</b><small>من القائمة أدناه</small></li><li><b>اكتب سبب طلبك</b><small>بهدوء ووضوح</small></li><li><b>انتظر النتيجة</b><small>يصلك إشعار</small></li></ol>`, { sub: d.guide })}
      <h3 class="set-h">القرارات</h3>
      ${d.items.map((it, i) => `<article class="card ca-card ap-it"><div class="mq2-top">${badge(it.label, tone(it.kind))}${it.automatic ? badge("قرار آلي", "acc") : ""}${!it.active && it.kind !== "removal" ? badge("لم يعد سارياً", "ok") : ""}<span class="grow"></span><time class="muted">${h(when(it.at))}</time></div>
        ${it.preview ? `<p class="mq2-t">${h(it.preview)}</p>` : ""}${it.reason ? `<p class="ap-r"><small>السبب</small><span>${h(it.reason)}</span></p>` : ""}${it.until && it.active ? `<p class="muted ap-u">${ic("clock", "xs")} حتى ${h(dt(it.until))}</p>` : ""}
        ${it.appeal ? `<div class="ap-st ${ST[it.appeal.status][1]}">${ic(ST[it.appeal.status][2], "xs")}<span><b>${ST[it.appeal.status][0]}</b>${it.appeal.note ? `<small>${h(it.appeal.note)}</small>` : ""}</span></div>` : it.canAppeal ? `<button type="button" class="btn sm ap-go" data-apx="${i}">${ic("scale", "xs")} طلب مراجعة القرار</button>` : ""}</article>`).join("") || UI.empty({ title: "لا قرارات بحقك", text: "سجلك في هذا المجتمع نظيف." })}</div>`;
    view.querySelectorAll("[data-apx]").forEach((b) => (b.onclick = async () => {
      const it = d.items[+b.dataset.apx];
      const r = await ask({ title: "طلب مراجعة: " + it.label, text: "اشرح ما حدث ولماذا ترى أن القرار يستحق المراجعة. يراجعه مشرف أعلى رتبة من صاحب القرار.", input: "سبب طلب المراجعة", required: true, max: 1000, ok: "إرسال الاستئناف", icon: "scale" });
      if (!r) return; if (r.text.length < 10) { toast("اكتب عشرة أحرف على الأقل"); return; }
      try { await api("POST", `/api/communities/${cid}/appeals`, { kind: it.kind, ref: it.ref, text: r.text }); toast("✓ أُرسل استئنافك"); appealView(cid); } catch (e) { toast(e.message); }
    }));
  }

  window.MPCAdmin = { panel, indexView, state: st, SECTIONS, version: "2.60", appealView };
})();
