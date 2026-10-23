/* =====================================================================
 * مجتمع بلس — v2.81 «v12x» lazy chunk: the v1.2 screens (series, events, lists, interests, trends, admin, decisions)
 * moved out of the core bundle (v12.js keeps a tiny V12 facade whose methods forward here, so every wrapper of
 * V12.admin etc. in core and in other chunks keeps working). chunks.js loads this chunk before any of its routes render.
 * ===================================================================== */
window.V12X = {
  series(sid) {
    const parts = DB.posts.filter(p => p.series === sid && p.status === "published").sort((a, b) => a.part - b.part);
    view.innerHTML = `<div class="wrap"><a href="#" data-ui="back" class="muted">→ رجوع</a><h2><svg class="ic hi" aria-hidden="true"><use href="#i-layers"/></svg>سلسلة (${parts.length} أجزاء)</h2>${parts.map(p => postCard(p)).join("")}</div>`;
  },
  events() {
    const up = DB.events.filter(e => new Date(e.startsAt) > new Date()).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    view.innerHTML = `<div class="wrap"><div class="row"><h2 class="grow">الأحداث</h2><button class="btn" id="ne">حدث</button></div>${up.map(eventRow).join("") || '<div class="empty">لا أحداث قادمة</div>'}</div>`;
    $("#ne").onclick = () => openComposer({ type: "event" });
  },
  event(id) {
    const e = DB.events.find(x => x.id === id); if (!e) return Views.notFound();
    const org = S.user(e.organizer), c = e.community && S.community(e.community), going = e.going.includes(DB.me), intr = e.interested.includes(DB.me);
    view.innerHTML = `<div class="cover" style="background:${e.color};height:160px"></div><div class="wrap">
      <h2>${esc(e.name)}</h2><p><svg class=ei aria-hidden=true><use href=#i-calendar /></svg> ${fmtDate(e.startsAt)}<br><svg class=ei aria-hidden=true><use href=#i-mapPin /></svg> ${esc(e.place)}<br><svg class=ei aria-hidden=true><use href=#i-user /></svg> المنظم: <a href="#/u/${org.handle}" class="u-c-ac">${esc(org.name)}</a>${c ? `<br><svg class=ei aria-hidden=true><use href=#i-users /></svg> <a href="#/c/${c.id}" class="u-c-ac">${esc(c.name)}</a>` : ""}</p>
      <div class="u-g8 row"><button class="btn ${going ? "ghost" : ""}" data-going="${id}">${going ? "✓ سأحضر" : "سأحضر"}</button><button class="btn ghost" data-interested="${id}">${intr ? "✓ مهتم" : "مهتم"}</button><button class="btn ghost" id="inv"><svg class=ei aria-hidden=true><use href=#i-mail /></svg> دعوة</button><button class="btn ghost" id="rem">${(e.reminders || []).includes(DB.me) ? "مفعل" : "تذكير"}</button></div>
      <div class="u-mt12 card"><p class="body">${richText(e.desc || "")}</p><div class="muted">${e.going.length} سيحضر · ${e.interested.length} مهتم</div><div class="u-g4 u-mt8 u-fww row">${e.going.map(u => av(S.user(u), "sm")).join("")}</div></div></div>`;
    $("#inv").onclick = () => inviteFlow("event", id);
    $("#rem").onclick = () => { e.reminders = (e.reminders || []).includes(DB.me) ? e.reminders.filter(x => x !== DB.me) : [...(e.reminders || []), DB.me]; save(); toast("سيصلك تذكير قبل الحدث"); rerender(); };
  },
  lists() {
    view.innerHTML = `<div class="wrap"><div class="row"><h2 class="grow"><svg class="ic hi" aria-hidden="true"><use href="#i-list"/></svg>قوائمي</h2><button class="btn" id="nl">＋ قائمة</button></div><p class="muted">القوائم تعطيك خلاصة خاصة بأشخاص تختارهم، بعيداً عن الخوارزمية.</p>
      ${DB.lists.map(l => `<a class="card row" href="#/list/${l.id}"><div class="av" style="background:var(--accent)"><svg class=ei aria-hidden=true><use href=#i-list /></svg></div><div class="grow"><b>${esc(l.name)}</b><div class="muted">${l.members.length} حساب</div></div></a>`).join("") || '<div class="empty">لا قوائم بعد</div>'}</div>`;
    $("#nl").onclick = () => { const n = prompt("اسم القائمة"); if (n) { DB.lists.push({ id: uid("l"), name: n, members: [], createdAt: now() }); save(); rerender(); } };
  },
  list(id) {
    const l = DB.lists.find(x => x.id === id); if (!l) return Views.notFound();
    const posts = Feed.build("list:" + id);
    view.innerHTML = `<div class="wrap"><a href="#/lists" class="muted">→ القوائم</a><div class="row"><h2 class="grow"><svg class="ic hi" aria-hidden="true"><use href="#i-list"/></svg>${esc(l.name)}</h2><button class="btn ghost" id="lm">الأعضاء (${l.members.length})</button><button class="btn ghost" id="ld"><svg class=ei aria-hidden=true><use href=#i-trash /></svg></button></div>${posts.map(p => postCard(p)).join("") || '<div class="empty">أضف حسابات للقائمة من ملفاتهم أو من قائمة ⋯ على أي منشور</div>'}</div>`;
    $("#lm").onclick = () => { const s = sheet(`<h4>أعضاء القائمة</h4><div class="menu">${DB.users.filter(u => u.id !== DB.me).map(u => `<button data-u="${u.id}">${l.members.includes(u.id) ? "✓ " : "＋ "}${esc(u.name)}</button>`).join("")}</div>`); s.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { const x = b.dataset.u; l.members = l.members.includes(x) ? l.members.filter(y => y !== x) : [...l.members, x]; save(); closeSheet(); rerender(); }); };
    $("#ld").onclick = () => { if (confirm("حذف القائمة؟")) { DB.lists = DB.lists.filter(x => x !== l); save(); location.hash = "#/lists"; } };
  },
  interests() {
    const w = DB.interestWeights, learned = Object.entries(w).filter(([k, v]) => v > 0.5 && !DB.interests.includes(k)).map(([k]) => k);
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "مركز الاهتمامات", icon: "target" })}
      <div class="card"><b>اهتماماتك</b>${TOPICS.filter(t => DB.interests.includes(t.slug)).map(t => `<div class="trend"><a href="#/topic/${t.slug}">${t.name}</a><span><button class="btn ghost" data-less="${t.slug}" style="padding:4px 10px">أقل</button> <button class="btn ghost" data-more2="${t.slug}" style="padding:4px 10px">أكثر</button> <button class="btn ghost" data-rm="${t.slug}" style="padding:4px 10px">✕</button></span></div>`).join("") || '<p class="muted">لا اهتمامات</p>'}</div>
      ${learned.length ? `<div class="card"><b>تعلّمها النظام من تفاعلك</b><p class="muted">نراك تتفاعل مع هذه المواضيع، هل تضيفها؟</p><div class="chips">${learned.map(k => `<button class="tab" data-add="${k}">＋ ${S.topic(k)?.name}</button>`).join("")}</div></div>` : ""}
      <div class="card"><b>مواضيع مقترحة</b><div class="u-mt8 chips">${TOPICS.filter(t => !DB.interests.includes(t.slug) && !learned.includes(t.slug)).map(t => `<button class="tab" data-add="${t.slug}">＋ ${t.name}</button>`).join("")}</div></div>
      <div class="card"><b>المكتوم</b><div class="u-mt8 chips">${[...DB.muted.topics.map(t => `<button class="tab" data-umt="${t}">${S.topic(t)?.name} ✕</button>`), ...DB.muted.hashtags.map(h => `<button class="tab" data-umh="${h}"><bdi>#${esc(h)}</bdi> ✕</button>`), ...DB.muted.communities.map(c => `<button class="tab" data-umc="${c}"><svg class=ei aria-hidden=true><use href=#i-users /></svg> ${esc(S.community(c)?.name || "")} ✕</button>`)].join("") || '<span class="muted">لا شيء</span>'}</div></div></div>`;
    const act = (sel, fn) => view.querySelectorAll(sel).forEach(b => b.onclick = () => { fn(Object.values(b.dataset)[0]); save(); rerender(); });
    act("[data-less]", k => w[k] = (w[k] || 0) - 1.5); act("[data-more2]", k => w[k] = (w[k] || 0) + 1.5);
    act("[data-rm]", k => DB.interests = DB.interests.filter(x => x !== k)); act("[data-add]", k => DB.interests.push(k));
    act("[data-umt]", k => DB.muted.topics = DB.muted.topics.filter(x => x !== k)); act("[data-umh]", k => DB.muted.hashtags = DB.muted.hashtags.filter(x => x !== k)); act("[data-umc]", k => DB.muted.communities = DB.muted.communities.filter(x => x !== k));
  },
  trends() {
    const scope = view._ts || "global", key = view._tk || (scope === "lang" ? "ar" : scope === "topic" ? "ai" : "");
    const list = Trends.multi(scope, key).slice(0, 15), rising = Trends.rising();
    view.innerHTML = `<div class="wrap"><h2><svg class="ic hi" aria-hidden="true"><use href="#i-fire"/></svg>الترند</h2>
      <div class="seg">${[["global", "عالمي"], ["lang", "حسب اللغة"], ["topic", "حسب الموضوع"], ["community", "حسب المجتمع"]].map(([k, l]) => `<button data-ts="${k}" class="${scope === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${scope === "lang" ? `<div class="chips">${[["ar", "العربية"], ["en", "English"]].map(([k, l]) => `<button class="tab ${key === k ? "on" : ""}" data-tk="${k}">${l}</button>`).join("")}</div>` : ""}
      ${scope === "topic" ? `<div class="chips">${TOPICS.map(t => `<button class="tab ${key === t.slug ? "on" : ""}" data-tk="${t.slug}">${t.name}</button>`).join("")}</div>` : ""}
      ${scope === "community" ? `<div class="chips">${DB.communities.map(c => `<button class="tab ${key === c.id ? "on" : ""}" data-tk="${c.id}">${esc(c.name)}</button>`).join("")}</div>` : ""}
      <div class="u-mt10 card">${list.map((t, i) => `<a class="trend" href="#/tag/${encodeURIComponent(t.tag)}"><span><span class="muted">${i + 1}.</span> <bdi>#${esc(t.tag)}</bdi></span><span class="muted">${t.posts} منشور · ${t.unique} مشارك</span></a>`).join("") || '<p class="muted">لا ترند هنا بعد</p>'}</div>
      ${scope === "global" && rising.length ? `<h4><svg class="ic hi" aria-hidden="true"><use href="#i-trendUp"/></svg>ترند صاعد مبكراً</h4><div class="card">${rising.map(t => `<a class="trend" href="#/tag/${encodeURIComponent(t.tag)}"><span><bdi>#${esc(t.tag)}</bdi></span><span class="muted">+${t.last6} خلال ٦ ساعات</span></a>`).join("")}</div>` : ""}
      <p class="muted">يُحسب الترند من سرعة النمو وعدد المشاركين المختلفين وتنوع التفاعل، وليس عدد المنشورات فقط.</p></div>`;
    view.querySelectorAll("[data-ts]").forEach(b => b.onclick = () => { view._ts = b.dataset.ts; view._tk = b.dataset.ts === "community" ? DB.communities[0].id : ""; rerender(); });
    view.querySelectorAll("[data-tk]").forEach(b => b.onclick = () => { view._tk = b.dataset.tk; rerender(); });
  },
  admin() {
    const day = 864e5, nowT = Date.now();
    const activeUsers = (ms) => new Set([...DB.posts.filter(p => nowT - new Date(p.createdAt) < ms).map(p => p.author), ...DB.comments.filter(c => nowT - new Date(c.createdAt) < ms).map(c => c.author)]).size;
    const open = DB.reports.filter(r => r.status === "open"), appeals = DB.appeals.filter(a => a.status === "open");
    const topCreators = DB.users.map(u => ({ u, s: DB.posts.filter(p => p.author === u.id).reduce((a, p) => a + S.reactionsOf(p.id).length, 0) })).sort((a, b) => b.s - a.s).slice(0, 3);
    const topComms = DB.communities.map(c => ({ c, s: S.members(c.id).length + DB.posts.filter(p => p.community === c.id).length })).sort((a, b) => b.s - a.s).slice(0, 3);
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "لوحة الإدارة", icon: "shield" })}
      <div class="kpi"><div><b>${activeUsers(day)}</b>نشط يومياً (DAU)</div><div><b>${activeUsers(30 * day)}</b>نشط شهرياً (MAU)</div><div><b>${DB.posts.filter(p => p.status === "published").length}</b>منشور</div><div><b>${DB.comments.length}</b>تعليق</div><div><b>${DB.posts.reduce((a, p) => a + p.views, 0)}</b>مشاهدة</div><div><b>${DB.reactions.length}</b>تفاعل</div><div><b>${DB.communities.length}</b>مجتمع</div><div><b>${open.length}</b>بلاغ مفتوح</div></div>
      <h4>أدوات الإدارة</h4><div class="list adm-tools" id="adm-tools"></div>
      <h4>البلاغات (${open.length})</h4>${open.map(r => { const p = S.post(r.target); return `<div class="card"><div class="muted">${esc(r.reason)} · ${r.kind} · ${relTime(r.at)} · دقة المُبلِّغ: ${reporterAccuracy(r.by)}%</div>${p ? `<div class="body">${esc((p.title || p.text).slice(0, 140))}</div>` : `<div class="body">${esc(S.user(r.target)?.name || r.target)}</div>`}<div class="u-g8 row"><button class="btn" data-rem="${r.id}">إزالة المحتوى</button><button class="btn ghost" data-keep="${r.id}">إبقاء</button></div></div>`; }).join("") || '<p class="muted adm-none">لا بلاغات مفتوحة</p>'}
      <h4>الاستئنافات (${appeals.length})</h4>${appeals.map(a => `<div class="card"><div class="body">${esc(a.text)}</div><div class="muted">على قرار: ${esc(a.decision)}</div><div class="u-g8 row"><button class="btn" data-acc="${a.id}">قبول واستعادة</button><button class="btn ghost" data-rej="${a.id}">رفض</button></div></div>`).join("") || '<p class="muted adm-none">لا استئنافات</p>'}
      <h4>أفضل المبدعين</h4>${topCreators.map(x => userRow(x.u)).join("")}
      <h4>أنشط المجتمعات</h4>${topComms.map(x => commRow(x.c)).join("")}
      <h4>الترند الحالي</h4><div class="card">${Trends.multi().slice(0, 5).map(t => `<div class="trend"><span><bdi>#${esc(t.tag)}</bdi></span><span class="muted">${t.unique} مشارك</span></div>`).join("") || '<p class="muted u-m0">لا وسوم رائجة بعد</p>'}</div>
      <h4>سجل القرارات (Audit Log)</h4><div class="card">${DB.audit.slice(-15).reverse().map(a => `<div class="trend"><span>${a.action} <span class="muted">${esc(a.reason || "")}</span></span><span class="muted">${a.by === "system" ? "النظام" : esc(S.user(a.by)?.name || a.by || "")} · ${relTime(a.at)}</span></div>`).join("") || '<p class="muted">فارغ</p>'}</div></div>`;
    adminTools(view.querySelector(".wrap"));
    view.querySelectorAll("[data-rem]").forEach(b => b.onclick = () => { const r = DB.reports.find(x => x.id === b.dataset.rem); r.status = "actioned"; const p = S.post(r.target); if (p) { p.status = "removed"; DB.decisions.push({ id: uid("dc"), target: p.id, user: p.author, action: "REMOVED", reason: r.reason, by: DB.me, at: now() }); } DB.audit.push({ action: "CONTENT_REMOVED", target: r.target, reason: r.reason, by: DB.me, at: now() }); save(); rerender(); });
    view.querySelectorAll("[data-keep]").forEach(b => b.onclick = () => { const r = DB.reports.find(x => x.id === b.dataset.keep); r.status = "dismissed"; const p = S.post(r.target); if (p) p.moderation = null; DB.audit.push({ action: "REPORT_DISMISSED", target: r.target, by: DB.me, at: now() }); save(); rerender(); });
    view.querySelectorAll("[data-acc]").forEach(b => b.onclick = () => { const a = DB.appeals.find(x => x.id === b.dataset.acc); a.status = "accepted"; const d = DB.decisions.find(x => x.id === a.decisionId); if (d) { const p = S.post(d.target); if (p) p.status = "published"; d.restored = true; } DB.audit.push({ action: "APPEAL_ACCEPTED", target: a.decisionId, by: DB.me, at: now() }); save(); rerender(); });
    view.querySelectorAll("[data-rej]").forEach(b => b.onclick = () => { const a = DB.appeals.find(x => x.id === b.dataset.rej); a.status = "rejected"; DB.audit.push({ action: "APPEAL_REJECTED", target: a.decisionId, by: DB.me, at: now() }); save(); rerender(); });
  },
  decisions() {
    const mine = DB.decisions.filter(d => d.user === DB.me);
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "القرارات على حسابي", icon: "scale" })}><p class="muted">إذا أُزيل محتوى لك بالخطأ، يمكنك الاستئناف وسيُراجع القرار.</p>
      ${mine.map(d => { const ap = DB.appeals.find(a => a.decisionId === d.id); return `<div class="card"><b>${d.action === "REMOVED" ? "إزالة منشور" : d.action}</b><div class="muted">السبب: ${esc(d.reason)} · ${relTime(d.at)}</div>${d.restored ? '<div class="chip">✓ تمت الاستعادة</div>' : ap ? `<div class="chip">الاستئناف: ${{ open: "قيد المراجعة", accepted: "مقبول", rejected: "مرفوض" }[ap.status]}</div>` : `<button class="u-mt8 btn ghost" data-appeal="${d.id}">تقديم استئناف</button>`}</div>`; }).join("") || '<div class="empty">لا قرارات على حسابك ✓</div>'}</div>`;
    view.querySelectorAll("[data-appeal]").forEach(b => b.onclick = () => { const t = prompt("لماذا تعتقد أن القرار خاطئ؟"); if (t) { const d = DB.decisions.find(x => x.id === b.dataset.appeal); DB.appeals.push({ id: uid("ap"), decisionId: d.id, decision: d.reason, text: t, by: DB.me, status: "open", at: now() }); save(); toast("أُرسل الاستئناف"); rerender(); } });
  }
};
/* v2.55: every module injects its admin shortcut right after the title with its own markup (cards with or without an icon,
 * different arrows, different heights). Collect them into one grouped list of uniform rows (icon tile · title · sub · chevron),
 * keeping each element's id and href (tests and deep links rely on them) and its click handlers (the <a> itself is reused). */
const ADM_IC = { "#/admin/activation": "settings", "#/admin/pi-activation": "coin", "#/admin/transfers": "swap", "#/admin/pricing": "tag", "#/admin/revenue": "chart", "#/admin/digital": "doc", "#/compliance": "lock", "#/status": "chart", "#/trust": "shield", "#/investigations": "target" };
function adminTools(w) {
  const list = w?.querySelector("#adm-tools"); if (!list) return;
  const fix = (a) => {
    if (a.classList.contains("li") || !a.matches("a[href^='#/']")) return;
    const href = a.getAttribute("href"), b = a.querySelector("b"), sub = a.querySelector(".muted:not(.fwd), small");
    const use = a.querySelector("use")?.getAttribute("href")?.replace("#i-", "") || ADM_IC[href] || "settings", pi = a.querySelector(".pi-logo");
    const title0 = (b || a).textContent.replace(/^\s*π\s*/, "").replace(/[←‹›→]/g, "").trim(), st0 = sub && sub !== b ? sub.textContent.replace(/[←‹›→]/g, "").trim() : "";
    let title = title0, st = st0; if (!st && title.includes(" — ")) [title, st] = [title.slice(0, title.indexOf(" — ")), title.slice(title.indexOf(" — ") + 3)];
    a.className = "li"; a.removeAttribute("style");
    a.innerHTML = `<span class="ico">${pi || /^#\/admin\/pi/.test(href) ? '<b class="pi-g" aria-hidden="true">π</b>' : UI.icon(use, "sm")}</span><span class="t"><b></b>${st ? "<small></small>" : ""}</span><span class="chev" aria-hidden="true">←</span>`;
    a.querySelector(".t b").textContent = title; if (st) a.querySelector(".t small").textContent = st;
  };
  const sweep = () => {
    if (!list.isConnected) return mo.disconnect();
    const h2 = w.querySelector(":scope > .page-head, :scope > h2"), kpi = w.querySelector(":scope > .kpi"); if (!h2 || !kpi) return;
    const got = [];
    for (let n = h2.nextElementSibling; n && n !== kpi; n = n.nextElementSibling) got.push(n);
    got.forEach((n) => { if (n.matches("a")) { fix(n); list.appendChild(n); } else { n.querySelectorAll("a[href^='#/']").forEach(fix); n.classList.add("adm-grp"); list.appendChild(n); } });
    [...list.children].forEach((n) => { if (n.matches("a:not(.li)")) fix(n); else if (n.matches("div")) n.querySelectorAll("a:not(.li)").forEach(fix); });
  };
  const mo = new MutationObserver(sweep); mo.observe(w, { childList: true, subtree: true }); sweep();
}
function reporterAccuracy(u) { const rs = DB.reports.filter(r => r.by === u && r.status !== "open"); return rs.length ? Math.round(rs.filter(r => r.status === "actioned").length / rs.length * 100) : 100; }
/* dev mode (no build): this script arrives after the first route() ran with the facade empty — repaint once */
if (!(window.__CHUNKS || {}).v12x && typeof route === "function" && /^#\/(series|events|event|lists|list|interests|trends|admin|decisions)(\/|\?|$)/.test(location.hash)) route();
