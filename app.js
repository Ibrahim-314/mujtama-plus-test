/* ===== UI layer: router + views ===== */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s = "") => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const view = $("#view");
const relTime = (iso) => {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return "الآن"; if (d < 3600) return `منذ ${Math.floor(d / 60)} د`;
  if (d < 86400) return `منذ ${Math.floor(d / 3600)} س`; if (d < 604800) return `منذ ${Math.floor(d / 86400)} يوم`;
  return new Date(iso).toLocaleDateString("ar", { day: "numeric", month: "short" });
};
const avSrc = (u, cls = "") => u && u.avatar ? (u.avatar[cls.includes("lg") ? "400" : cls.includes("sm") ? "64" : "200"] || u.avatar["200"] || "") : "";
const av = (u, cls = "") => `<a href="#/u/${u.handle}" class="av ${cls}" style="background:${u.color}">${avSrc(u, cls) ? `<img src="${esc(avSrc(u, cls))}" alt="" loading="lazy" decoding="async">` : esc(u.name[0])}</a>`;
const richText = (t = "") => esc(t)
  .replace(/#([\p{L}\p{N}_]+)/gu, (m, h) => `<a class="tag" href="#/tag/${encodeURIComponent(normalizeTag(h))}">#${h}</a>`)
  .replace(/@([a-zA-Z0-9_]+)/g, (m, h) => S.byHandle(h) ? `<a class="men" href="#/u/${h}">@${h}</a>` : m);
function toast(msg) { const t = $("#toast") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "toast", className: "toast" })); t.textContent = msg; t.classList.add("on"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("on"), 2200); }
function sheet(html) { const s = $("#sheet"); s.innerHTML = `<div class="panel">${html}</div>`; s.classList.remove("hidden"); s.onclick = e => { if (e.target === s) closeSheet(); }; return s; }
function closeSheet() { const s = $("#sheet"); if (s._onclose) { s._onclose(); s._onclose = null; } s.classList.add("hidden"); s.innerHTML = ""; }
/* v2.140.2: in-app confirm sheet. Native confirm() is suppressed by some embedded browsers (e.g. Pi Browser webviews), which
 * silently cancelled deletes. MPConfirm(text, {ok, cancel, danger}) resolves true/false; Escape/backdrop = false. */
window.MPConfirm = function (text, o = {}) {
  const tr = (x) => (window.MPI18n && window.MPI18n.t ? window.MPI18n.t(x) : x);
  return new Promise((res) => {
    const ret = document.activeElement; let done = false;
    const fin = (v) => { if (done) return; done = true; document.removeEventListener("keydown", key, true); const sh = $("#sheet"); sh._onclose = null; closeSheet(); if (ret && ret.isConnected && ret.focus) try { ret.focus(); } catch { /* gone */ } res(v); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fin(false); } };
    const s = sheet(`<div class="mp-cf" role="alertdialog" aria-modal="true" aria-labelledby="mp-cf-t"><p id="mp-cf-t" class="mp-cf-t" tabindex="-1">${esc(tr(text))}</p><div class="mp-cf-b"><button type="button" class="btn${o.danger === false ? "" : " danger"}" id="mp-cf-ok">${esc(tr(o.ok || "تأكيد"))}</button><button type="button" class="btn ghost" id="mp-cf-x">${esc(tr(o.cancel || "تراجع"))}</button></div></div>`);
    s._onclose = () => { if (!done) { done = true; document.removeEventListener("keydown", key, true); res(false); } };
    s.onclick = (e) => { if (e.target === s) fin(false); };
    s.querySelector("#mp-cf-ok").onclick = () => fin(true);
    s.querySelector("#mp-cf-x").onclick = () => fin(false);
    document.addEventListener("keydown", key, true);
    setTimeout(() => s.querySelector("#mp-cf-t")?.focus(), 30);
  });
};

/* ---------- Post card ---------- */
function postCard(p, opts = {}) {
  if (!p || p.status === "deleted") return `<div class="card muted">المنشور الأصلي غير متاح</div>`;
  if (p.repostOf) {
    const o = S.post(p.repostOf); const u = S.user(p.author);
    return `<div class="card" style="padding-top:10px"><div class="repost-label"><svg class=ei aria-hidden=true><use href=#i-repost /></svg> أعاد ${esc(u.name)} النشر</div>${postInner(o, opts)}</div>`;
  }
  return `<div class="card">${postInner(p, opts)}</div>`;
}
function postInner(p, opts = {}) {
  if (!p || p.status === "deleted") return `<div class="muted">المنشور الأصلي غير متاح</div>`;
  const u = S.user(p.author), mine = S.myReaction(p.id), rs = S.reactionsOf(p.id);
  const comm = p.community && S.community(p.community), topic = S.topic(p.topic);
  const rIcon = mine ? REACTIONS.find(r => r.key === mine.type).icon : "🤍";
  let body = "";
  if (p.type === "article") body += `<div class="media" style="background:${p.media || "var(--accent2)"};height:120px"></div><div class="body"><h3>${esc(p.title)}</h3>${richText(opts.full ? p.text : p.text.slice(0, 180) + (p.text.length > 180 ? "…" : ""))}</div>`;
  else body += p.text ? `<div class="body">${p.type === "question" ? '<span class="chip"><svg class=ei aria-hidden=true><use href=#i-help /></svg> سؤال</span>\n' : ""}${richText(p.text)}</div>` : "";
  if (p.media && p.type !== "article") body += `<div class="media" style="background:${p.media}"></div>`;
  if (p.poll) {
    const total = p.poll.options.reduce((a, o) => a + o.v, 0) || 1, voted = p.poll.voters[DB.me];
    body += `<div class="poll">${p.poll.options.map((o, i) => `<div class="opt" data-vote="${p.id}:${i}">${voted !== undefined ? `<div class="bar" style="width:${Math.round(o.v / total * 100)}%"></div>` : ""}<span>${esc(o.t)}${voted !== undefined ? ` · ${Math.round(o.v / total * 100)}%` : ""}${voted === i ? " ✓" : ""}</span></div>`).join("")}<div class="muted">${total} صوت</div></div>`;
  }
  if (p.quoteOf) { const q = S.post(p.quoteOf); body += `<a href="#/post/${p.quoteOf}" class="u-db quote">${q && q.status !== "deleted" ? `<b>${esc(S.user(q.author).name)}</b><div>${esc((q.title || q.text).slice(0, 140))}</div>` : "المنشور الأصلي غير متاح"}</a>`; }
  return `
  <div class="post-head">${av(u)}
    <div class="meta"><a href="#/u/${u.handle}" class="name">${esc(u.name)}</a> ${u.badge ? `<span class="badge-v">✦ ${u.badge}</span>` : ""}
      <div class="handle"><bdi>@${u.handle}</bdi> · <a class="time" href="#/post/${p.id}">${relTime(p.createdAt)}</a>${p.edited ? " · تم التعديل" : ""}${p.visibility !== "public" ? " · <svg class=ei aria-hidden=true><use href=#i-lock /></svg>" : ""}${p.status === "pending" ? " · بانتظار الموافقة" : ""}</div>
      ${comm ? `<a class="chip" href="#/c/${comm.id}"><svg class=ei aria-hidden=true><use href=#i-users /></svg> ${esc(comm.name)}</a> ` : ""}${topic ? `<a class="chip" href="#/topic/${topic.slug}">${topic.name}</a>` : ""}
    </div><button class="more" data-more="${p.id}">⋯</button></div>
  <div class="post-open" data-open="#/post/${p.id}">${body}<!--mp:media--></div>
  <div class="actions">
    <button data-react="${p.id}" class="${mine ? "on" : ""}">${rIcon} ${rs.length || ""}</button>
    <button data-go="#/post/${p.id}"><svg class=ei aria-hidden=true><use href=#i-comment /></svg> ${S.commentsOf(p.id).length || ""}</button>
    <button data-share="${p.id}"><svg class=ei aria-hidden=true><use href=#i-repost /></svg> ${S.repostsOf(p.id) || ""}</button>
    <button data-save="${p.id}" class="${S.saved(p.id) ? "on" : ""}">${S.saved(p.id) ? "<svg class=ei aria-hidden=true><use href=#i-bookmarkF /></svg>" : "<svg class=ei aria-hidden=true><use href=#i-bookmark /></svg>"}</button>
    <span class="muted" style="align-self:center"><svg class=ei aria-hidden=true><use href=#i-eye /></svg> ${p.views}</span>
  </div>`;
}

/* Global delegated actions for post cards */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-react],[data-go],[data-share],[data-save],[data-more],[data-vote],[data-follow],[data-join]");
  if (!t) return;
  e.preventDefault(); e.stopPropagation();
  const d = t.dataset;
  if (d.go) location.hash = d.go;
  if (d.vote) { const [pid, i] = d.vote.split(":"); Cmd.vote(pid, +i); patchPost(pid); }
  if (d.react) reactPicker(d.react);
  if (d.share) shareMenu(d.share);
  if (d.save) saveMenu(d.save);
  if (d.more) moreMenu(d.more);
  if (d.follow) { Cmd.toggleFollow(d.follow); patchFollow(d.follow); }
  if (d.join) { Cmd.toggleJoin(d.join); toast(S.membership(d.join)?.role === "pending" ? "تم إرسال طلب الانضمام" : S.membership(d.join) ? "انضممت للمجتمع" : "غادرت المجتمع"); rerender(); }
});
function reactPicker(pid) {
  const p = S.post(pid);
  sheet(`<h4>تفاعل</h4><div class="row" style="justify-content:space-around">${REACTIONS.map(r => `<button class="u-t-2xl u-p12 btn ghost" data-r="${r.key}">${r.icon}<div class="u-t-xs">${r.label}</div></button>`).join("")}</div>`)
    .querySelectorAll("[data-r]").forEach(b => b.onclick = () => { Cmd.react(pid, b.dataset.r, p.author); closeSheet(); patchPost(pid); });
}
function shareMenu(pid) {
  const s = sheet(`<div class="menu"><button data-a="repost"><svg class=ei aria-hidden=true><use href=#i-repost /></svg> إعادة نشر</button><button data-a="quote"><svg class=ei aria-hidden=true><use href=#i-pen /></svg> اقتباس مع رأيك</button><button data-a="dm"><svg class=ei aria-hidden=true><use href=#i-mail /></svg> إرسال في رسالة</button><button data-a="link"><svg class=ei aria-hidden=true><use href=#i-link /></svg> نسخ الرابط</button></div>`);
  s.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
    const a = b.dataset.a; closeSheet();
    if (a === "repost") { const r = Cmd.createPost({ repostOf: pid, topic: S.post(pid).topic }); toast(r.error || "تمت إعادة النشر"); rerender(); }
    if (a === "quote") openComposer({ quoteOf: pid });
    if (a === "link") { const url = location.href.split("#")[0] + "#/post/" + pid; navigator.clipboard?.writeText(url).catch(() => { }); toast("تم نسخ الرابط"); }
    if (a === "dm") { const others = DB.users.filter(u => u.id !== DB.me).slice(0, 8); const s2 = sheet(`<h4>إرسال إلى</h4><div class="menu">${others.map(u => `<button data-u="${u.id}">${esc(u.name)}</button>`).join("")}</div>`); s2.querySelectorAll("[data-u]").forEach(x => x.onclick = () => { const c = Cmd.openConversation(x.dataset.u); Cmd.sendMessage(c.id, "" + location.href.split("#")[0] + "#/post/" + pid); closeSheet(); toast("تم الإرسال"); }); }
  });
}
function saveMenu(pid) {
  const s = sheet(`<h4>حفظ في مجموعة</h4><div class="menu">${DB.collections.map(c => `<button data-c="${c.id}">${c.items.includes(pid) ? "✓ " : ""}${esc(c.name)}</button>`).join("")}${S.saved(pid) ? `<button data-c="">إزالة من المحفوظات</button>` : ""}<button data-new="1">＋ مجموعة جديدة</button></div>`);
  s.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { Cmd.save(pid, b.dataset.c); closeSheet(); toast(b.dataset.c ? "تم الحفظ" : "تمت الإزالة"); patchPost(pid); });
  s.querySelector("[data-new]").onclick = () => { const n = prompt("اسم المجموعة"); if (n) { const c = { id: uid("col"), name: n, items: [] }; DB.collections.push(c); Cmd.save(pid, c.id); closeSheet(); toast("تم الحفظ"); patchPost(pid); } };
}
function moreMenu(pid) {
  const p = S.post(pid), mine = p.author === DB.me, u = S.user(p.author);
  const s = sheet(`<div class="menu">
    <button data-a="why"><svg class=ei aria-hidden=true><use href=#i-bulb /></svg> لماذا أرى هذا؟</button>
    ${mine ? `<button data-a="edit"><svg class=ei aria-hidden=true><use href=#i-pen /></svg> تعديل</button><button data-a="del" class="u-c-dg"><svg class=ei aria-hidden=true><use href=#i-trash /></svg> حذف</button>` :
      `<button data-a="ni"><svg class=ei aria-hidden=true><use href=#i-eyeOff /></svg> غير مهتم</button><button data-a="mt"><svg class=ei aria-hidden=true><use href=#i-volumeX /></svg> كتم موضوع ${esc(S.topic(p.topic)?.name || "")}</button><button data-a="mu"><svg class=ei aria-hidden=true><use href=#i-bellOff /></svg> كتم ${esc(u.name)}</button><button data-a="bl"><svg class=ei aria-hidden=true><use href=#i-ban /></svg> حظر ${esc(u.name)}</button><button data-a="rep" class="u-c-dg"><svg class=ei aria-hidden=true><use href=#i-flag /></svg> إبلاغ</button>`}
  </div>`);
  s.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === "why") { sheet(`<h4>لماذا أرى هذا؟</h4>${Feed.why(p).map(r => `<p>• ${r}</p>`).join("")}<p class="muted">يمكنك التحكم من «إدارة ما تراه» في حسابك.</p>`); return; }
    closeSheet();
    if (a === "edit") openComposer({ edit: pid, text: p.text });
    if (a === "del") window.MPConfirm("حذف المنشور؟", { ok: "حذف" }).then((y) => { if (y) { Cmd.deletePost(pid); toast("تم الحذف"); } });
    if (a === "ni") { Cmd.notInterested(pid); toast("سنعرض لك محتوى أقل مثل هذا"); }
    if (a === "mt") { Cmd.mute("topics", p.topic); toast("تم كتم الموضوع"); }
    if (a === "mu") { Cmd.mute("users", p.author); toast("تم الكتم"); }
    if (a === "bl") { Cmd.block(p.author); toast("تم الحظر"); }
    if (a === "rep") return reportFlow(pid, "post");
    rerender();
  });
}
function reportFlow(target, kind) {
  const reasons = ["Spam / محتوى مزعج", "انتحال شخصية", "محتوى ضار", "تحرش أو إساءة", "معلومات مضللة", "أخرى"];
  const s = sheet(`<h4>سبب الإبلاغ</h4><div class="menu">${reasons.map(r => `<button data-r="${r}">${r}</button>`).join("")}</div>`);
  s.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { Cmd.report(target, kind, b.dataset.r); closeSheet(); toast("شكراً، سيراجع فريق السلامة البلاغ"); });
}

/* ---------- Composer entry (v2.50) ----------
 * Both editors — the simple community editor and the creative general editor — live in the lazy "composer" chunk
 * (composer-core.js + composer-ui.js + composer.css, prefetched on idle; docs/COMPOSER.md). Every entry point calls
 * openComposer(init) / window.MPComposer(init); init.community → community editor, init.edit → edit, otherwise general.
 * Other chunks extend the editors through window.MPComposerHooks. */
window.MPComposerHooks = window.MPComposerHooks || [];
function openComposer(init = {}) {
  const go = () => window.MPEditor ? window.MPEditor.open(init) : toast("تعذّر فتح المحرر، تحقق من اتصالك");
  return !window.MPEditor && window.MPChunks ? window.MPChunks.load("composer").then(go, go) : go();
}
window.MPComposer = (init) => openComposer(init);
$("#fab").onclick = () => openComposer();

/* ---------- Views ---------- */
let feedMode = "for", feedLimit = 10;
/* v2.145 H1: one home assembly point. Modules register a section hook (fixed rank, so the order no longer depends on
 * which chunk loaded first) or a feed mapper, instead of wrapping Views.home. Each hook is isolated: one failure never
 * blanks the home. Ranks: 10 circle card · 20 challenges · 30 stories · 40 discovery · 50 wellbeing. */
const HomeHooks = (() => {
  const secs = [], feeds = [], after = [];
  const put = (arr, name, rank, fn) => { const i = arr.findIndex(h => h.name === name); if (i >= 0) arr.splice(i, 1); arr.push({ name, rank, fn }); arr.sort((a, b) => a.rank - b.rank); };
  return {
    section(name, rank, fn) { put(secs, name, rank, fn); },
    feed(name, rank, fn) { put(feeds, name, rank, fn); },
    after(name, rank, fn) { put(after, name, rank, fn); },
    list() { return secs.map(h => h.name); },
    run(base, ctx, args) {
      const b = Feed.build, maps = feeds.slice();
      if (maps.length) Feed.build = function (mode) { return maps.reduce((arr, h) => { try { return h.fn(arr, mode); } catch (e) { console.warn("home feed " + h.name, e); return arr; } }, b.apply(Feed, arguments)); };
      try { base.apply(ctx, args); for (const h of secs.slice()) { try { h.fn(); } catch (e) { console.warn("home " + h.name, e); } } }
      finally { Feed.build = b; for (const h of after.slice()) setTimeout(() => { try { h.fn(); } catch (e) { console.warn("home after " + h.name, e); } }, 0); }
    }
  };
})();
/* v2.145 H1b: post card / post body middleware in a fixed rank order (was ~13 ad-hoc wrappers whose order depended on
 * which lazy chunk loaded first). A wrapper registers (next) => function (p, opts) {...}; lower rank sits closer to the
 * base renderer. A wrapper assigned the old way is absorbed as the new base, so nothing is ever dropped. */
const PostHooks = (() => {
  const st = { inner: { base: postInner, built: null, mws: [] }, card: { base: postCard, built: null, mws: [] } };
  const cur = (k) => (k === "inner" ? postInner : postCard);
  const set = (k, fn) => { if (k === "inner") postInner = fn; else postCard = fn; };
  function add(k, name, rank, mw) {
    const s = st[k]; if (s.built && cur(k) !== s.built) s.base = cur(k); /* someone wrapped directly: keep it */
    else if (!s.built) s.base = cur(k);
    const i = s.mws.findIndex(h => h.name === name); if (i >= 0) s.mws.splice(i, 1);
    s.mws.push({ name, rank, mw }); s.mws.sort((a, b) => a.rank - b.rank);
    s.built = s.mws.reduce((next, h) => h.mw(next), s.base); set(k, s.built);
  }
  return { inner: (n, r, mw) => add("inner", n, r, mw), card: (n, r, mw) => add("card", n, r, mw), list: (k) => st[k].mws.map(h => h.name + ":" + h.rank) };
})();
/* v2.145 H2 «أول 5 ثواني»: the Home composer = one row (avatar + «ماذا تريد أن تنشر؟») and one row of 7 icon-only shortcuts, each
 * opening the EXISTING editor flow for that type (no new feature). Icons from the approved mockup; the thread icon is dots on a
 * vertical line with text lines. The avatar slot also carries the add-story «+» when nobody has an active story (content-ui.js). */
const HOME_Q = [["img", "صورة", "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM21 16l-5-5-9 9"],
  ["video", "فيديو", "M5 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM16 10l5-3v10l-5-3"],
  ["audio", "مقطع صوتي", "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"],
  ["poll", "استطلاع", "M5 20V10M12 20V4M19 20v-7"],
  ["thread", "سلسلة", "M6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM6 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM6 7v10M11 5h9M11 9h6M11 19h9"],
  ["article", "مقال", "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"],
  ["ai", "ساعدني في الكتابة", "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"]];
const homeAv = () => av(S.me()).replace(/^<a href="[^"]*"/, '<span aria-hidden="true"').replace(/<\/a>$/, "</span>"); /* no link inside the composer card */
function homeCompose(k) {
  const type = ["video", "audio", "poll", "thread", "article"].includes(k) ? k : "post";
  const inEd = (sel, then) => { let n = 0; const t = setInterval(() => { const el = document.querySelector("#composer3 " + sel); if (el || ++n > 60) { clearInterval(t); if (el) then(el); } }, 50); };
  return Promise.resolve(openComposer({ type })).then(() => {
    if (k === "img") inEd("[data-tool=img]", (b) => b.click()); /* the editor's own image picker */
    if (k === "ai") { const C = window.MPChunks; (C ? C.load("ai").catch(() => { }).then(() => C.load("assistant")).catch(() => { }) : Promise.resolve()).then(() => inEd(".mp-asb", (b) => b.click())); } /* «✨ المساعد» of the editor */
  });
}
const Views = {
  home() { return HomeHooks.run(Views._homeBase, this, arguments); },
  _homeBase() {
    const list = Feed.build(feedMode), shown = list.slice(0, feedLimit);
    const trends = Trends.list(3), sugComm = DB.communities.find(c => !S.membership(c.id)), sugUser = DB.users.find(u => u.id !== DB.me && !S.follows(DB.me, u.id) && !DB.blocked.includes(u.id));
    let html = `<div class="wrap">
      <div class="card composer-bar h2c" id="hcomp"><div class="h2c-r1"><span class="h2c-av">${homeAv()}</span><button type="button" class="fake" id="cbar">ماذا تريد أن تنشر؟</button></div>
      <div class="h2c-q" role="group" aria-label="نوع المنشور">${HOME_Q.map(([k, l, d]) => `<button type="button" class="h2c-b" data-q="${k}" aria-label="${l}" title="${l}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg></button>`).join("")}</div></div>
      <div class="tabs">${[["for", "لك"], ["following", "أتابع"], ["latest", "الأحدث"], ["discover", "استكشف"], ["communities", "مجتمعاتي"], ...DB.lists.map(l => ["list:" + l.id, l.name])].map(([k, l]) => `<button class="tab ${feedMode === k ? "on" : ""}" data-mode="${k}">${l}</button>`).join("")}</div>`;
    if (!shown.length) html += `${UI.empty({ title: "لا يوجد محتوى هنا بعد", text: "تابع أشخاصاً وانضم إلى مجتمعات لتمتلئ خلاصتك.", action: '<a class="btn" href="#/explore">اكتشف أشخاصاً ومجتمعات</a>' })}`;
    shown.forEach((p, i) => {
      html += postCard(p);
      if (i === 2 && trends.length) html += `<div class="card discover"><b><svg class=ei aria-hidden=true><use href=#i-fire /></svg> رائج الآن</b>${trends.map(t => `<a class="trend" href="#/tag/${encodeURIComponent(t.tag)}"><span><bdi>#${esc(t.tag)}</bdi></span><span class="muted">${t.unique} مشارك</span></a>`).join("")}</div>`;
      if (i === 5 && sugComm) html += `<div class="card discover"><div class="muted">مجتمع مقترح لك</div><div class="u-mt8 row"><div class="av" style="background:${sugComm.color}"><svg class=ei aria-hidden=true><use href=#i-users /></svg></div><a href="#/c/${sugComm.id}" class="grow"><b>${esc(sugComm.name)}</b><div class="muted">${esc(sugComm.desc)}</div></a><button class="btn" data-join="${sugComm.id}">انضم</button></div></div>`;
      if (i === 8 && sugUser) html += `<div class="card discover"><div class="muted">شخص قد يهمك</div><div class="u-mt8 row">${av(sugUser)}<a href="#/u/${sugUser.handle}" class="grow"><b>${esc(sugUser.name)}</b><div class="muted">${esc(sugUser.bio)}</div></a><button class="btn" data-follow="${sugUser.id}">تابع</button></div></div>`;
    });
    if (list.length > feedLimit) html += `<div class="skel" id="more-sentinel"></div>`;
    else if (shown.length) html += `<div class="empty">وصلت للنهاية <a href="#/explore" class="u-c-ac">استكشف المزيد</a></div>`;
    view.innerHTML = html + "</div>";
    $("#cbar").onclick = () => openComposer();
    $("#hcomp").onclick = (e) => { const q = e.target.closest("[data-q]"); if (q) homeCompose(q.dataset.q); else if (!e.target.closest("button")) openComposer(); };
    view.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { feedMode = b.dataset.mode; feedLimit = 10; rerender(); });
    const sen = $("#more-sentinel");
    if (sen) new IntersectionObserver((en, ob) => { if (en[0].isIntersecting) { ob.disconnect(); setTimeout(() => { feedLimit += 10; const y = scrollY; rerender(); scrollTo(0, y); }, 400); } }).observe(sen);
  },

  post(id) {
    const p = S.post(id); if (!p) return view.innerHTML = `<div class="empty">المنشور غير موجود</div>`;
    Cmd.view(id);
    const sort = view._csort || "relevant";
    const all = S.commentsOf(id);
    const sorter = sort === "new" ? byNew : (a, b) => (S.reactionsOf(b.id).length * 2 + all.filter(c => c.parent === b.id).length) - (S.reactionsOf(a.id).length * 2 + all.filter(c => c.parent === a.id).length);
    const renderC = (c, depth) => {
      const u = S.user(c.author), kids = all.filter(x => x.parent === c.id).sort(byNew).reverse(), mine = S.myReaction(c.id);
      const accepted = p.acceptedAnswer === c.id;
      return `<div class="comment${accepted ? " accepted" : ""}">
        <div class="row">${av(u, "sm")}<div class="grow"><b>${esc(u.name)}</b> <span class="muted">${relTime(c.createdAt)}</span>${accepted ? ' <span class="sbadge ok">أفضل إجابة</span>' : ""}</div></div>
        <div class="cbody">${richText(c.text)}</div>
        <div class="cact"><button data-cr="${c.id}" class="${mine ? "on" : ""}" aria-label="إعجاب" aria-pressed="${!!mine}">${UI.icon(mine ? "heartF" : "heart", "sm")} ${UI.num(S.reactionsOf(c.id).length || "") || ""}</button>
        ${depth < 3 ? `<button data-reply="${c.id}" data-name="${esc(u.name)}">ردّ</button>` : ""}
        ${p.type === "question" && p.author === DB.me && !c.parent ? `<button data-accept="${c.id}">${accepted ? "إلغاء" : "أفضل إجابة"}</button>` : ""}
        <button data-crep="${c.id}">إبلاغ</button></div>
        ${kids.length ? (depth < 3 ? kids.map(k => renderC(k, depth + 1)).join("") : `<a class="muted" href="#/post/${id}">عرض ${kids.length} ردود أخرى</a>`) : ""}
      </div>`;
    };
    let roots = all.filter(c => !c.parent).sort(sorter);
    if (p.acceptedAnswer) roots = [roots.find(c => c.id === p.acceptedAnswer), ...roots.filter(c => c.id !== p.acceptedAnswer)].filter(Boolean);
    view.innerHTML = `<div class="wrap">
      <header class="page-head"><a href="#" data-ui="back" class="back"><span class="fwd" aria-hidden="true">→</span> رجوع</a></header>
      <div class="card">${postInner(p, { full: true })}</div>
      <section class="card cm-sec" aria-labelledby="cm-h">
        <div class="row cm-hd"><h2 class="grow" id="cm-h">التعليقات <span class="muted">${UI.num(all.length)}</span></h2>${all.length > 2 ? `<button class="btn ghost sm" id="sum">${UI.icon("sparkle", "sm")} تلخيص النقاش</button>` : ""}</div>
        <div class="seg"><button data-sort="relevant" class="${sort === "relevant" ? "on" : ""}">الأكثر صلة</button><button data-sort="new" class="${sort === "new" ? "on" : ""}">الأحدث</button></div>
        ${all.length > 4 ? `<input id="csearch" placeholder="ابحث داخل النقاش…">` : ""}
        <div id="clist">${roots.map(c => renderC(c, 1)).join("") || '<p class="muted cm-empty">كن أول من يعلّق</p>'}</div>
      </section>
      <div class="cm-pad"></div></div>
      <div class="chatbar"><input id="cin" placeholder="${p.type === "question" ? "اكتب إجابتك…" : "اكتب تعليقاً…"}"><button class="btn" id="csend">إرسال</button></div>`;
    let replyTo = null;
    $("#csend").onclick = () => { const t = $("#cin").value.trim(); if (!t) return; const r = Cmd.comment(id, t, replyTo); if (r.error) return toast(r.error); rerender(); };
    $("#cin").onkeydown = e => { if (e.key === "Enter") $("#csend").click(); };
    view.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { view._csort = b.dataset.sort; rerender(); });
    view.querySelectorAll("[data-reply]").forEach(b => b.onclick = () => { replyTo = b.dataset.reply; $("#cin").placeholder = "ردّ على " + b.dataset.name; $("#cin").focus(); });
    view.querySelectorAll("[data-cr]").forEach(b => b.onclick = () => { Cmd.react(b.dataset.cr, "like"); const on = !!S.myReaction(b.dataset.cr), n = S.reactionsOf(b.dataset.cr).length; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.innerHTML = `${UI.icon(on ? "heartF" : "heart", "sm")} ${n ? UI.num(n) : ""}`; });
    view.querySelectorAll("[data-accept]").forEach(b => b.onclick = () => { p.acceptedAnswer = p.acceptedAnswer === b.dataset.accept ? null : b.dataset.accept; save(); rerender(); });
    view.querySelectorAll("[data-crep]").forEach(b => b.onclick = () => reportFlow(b.dataset.crep, "comment"));
    if ($("#sum")) $("#sum").onclick = () => sheet(`<h4><svg class="ic hi" aria-hidden="true"><use href="#i-sparkle"/></svg>ملخص النقاش</h4><div class="body">${esc(AI.summarize(all))}</div>`);
    if ($("#csearch")) $("#csearch").oninput = e => { const q = e.target.value.trim(); $("#clist").innerHTML = q ? all.filter(c => c.text.includes(q)).map(c => renderC(c, 3)).join("") || '<div class="muted">لا نتائج</div>' : roots.map(c => renderC(c, 1)).join(""); };
  },

  explore() {
    const q = view._q || "";
    const res = Search.run(q);
    const trends = Trends.list(8);
    let html = `<div class="wrap"><input id="sq" placeholder="ابحث عن أشخاص، منشورات، مجتمعات، مواضيع…" value="${esc(q)}">`;
    if (res) {
      const sec = { users: ["الأشخاص", res.users.map(u => userRow(u)).join("")], communities: ["المجتمعات", res.communities.map(c => commRow(c)).join("")], topics: ["المواضيع", `<div class="chips">${res.topics.map(t => `<a class="tab" href="#/topic/${t.slug}">${t.name}</a>`).join("")}</div>`], posts: ["المنشورات", res.posts.map(p => postCard(p)).join("")] };
      const parts = res.order.filter(k => res[k].length).map(k => `<h4>${sec[k][0]}</h4>${sec[k][1]}`);
      html += parts.join("") || `<div class="empty">لا نتائج لـ «${esc(q)}»</div>`;
    } else {
      html += `<div class="u-mt12 card"><b><svg class=ei aria-hidden=true><use href=#i-fire /></svg> الترند</b>${trends.map((t, i) => `<a class="trend" href="#/tag/${encodeURIComponent(t.tag)}"><span><span class="muted">${i + 1}.</span> <bdi>#${esc(t.tag)}</bdi></span><span class="muted">${t.posts} منشور · ${t.unique} مشارك</span></a>`).join("")}</div>
      <div class="card discover"><b><svg class=ei aria-hidden=true><use href=#i-comment /></svg> سؤال اليوم</b><p>ما الشيء الذي تعلمته اليوم؟</p><button class="btn" id="dq">شارك إجابتك</button></div>
      <h4>مواضيع</h4><div class="chips">${TOPICS.map(t => `<a class="tab" href="#/topic/${t.slug}">${t.name}</a>`).join("")}</div>
      <h4>أشخاص مقترحون</h4>${DB.users.filter(u => u.id !== DB.me && !S.follows(DB.me, u.id) && !DB.blocked.includes(u.id)).slice(0, 4).map(userRow).join("")}
      <h4>مجتمعات مقترحة</h4>${DB.communities.filter(c => !S.membership(c.id)).map(commRow).join("") || '<div class="muted">انضممت لكل المجتمعات</div>'}`;
    }
    view.innerHTML = html + "</div>";
    const sq = $("#sq"); let tm;
    sq.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { view._q = sq.value; rerender(); const n = $("#sq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
    if ($("#dq")) $("#dq").onclick = () => openComposer({ text: "ما الشيء الذي تعلمته اليوم؟\n\n", topic: "learn" });
  },

  tag(tag) {
    tag = decodeURIComponent(tag);
    const posts = S.visiblePosts().filter(p => S.hashtags(p.text).includes(tag)).sort(byNew);
    view.innerHTML = `<div class="wrap"><h2><bdi>#${esc(tag)}</bdi></h2><div class="u-mb10 muted">${posts.length} منشور</div>${posts.map(p => postCard(p)).join("") || '<div class="empty">لا منشورات</div>'}</div>`;
  },

  topic(slug) {
    const t = S.topic(slug); if (!t) return Views.notFound();
    const following = DB.interests.includes(slug), muted = DB.muted.topics.includes(slug);
    const posts = S.visiblePosts().filter(p => p.topic === slug).sort(byNew);
    view.innerHTML = `<div class="wrap"><div class="card discover"><h2>${t.name}</h2><div class="muted">${posts.length} منشور · ${DB.users.filter(u => u.topics.includes(slug)).length} شخص مهتم</div>
      <div class="u-mt10 u-g8 row"><button class="btn ${following ? "ghost" : ""}" id="tf">${following ? "✓ تتابعه" : "تابع الموضوع"}</button><button class="btn ghost" id="tm">${muted ? "إلغاء الكتم" : "كتم"}</button></div></div>
      ${DB.communities.filter(c => c.topic === slug).map(commRow).join("")}
      <h4>أشخاص</h4>${DB.users.filter(u => u.topics.includes(slug) && u.id !== DB.me).map(userRow).join("")}
      <h4>المنشورات</h4>${posts.map(p => postCard(p)).join("")}</div>`;
    $("#tf").onclick = () => { DB.interests = following ? DB.interests.filter(x => x !== slug) : [...DB.interests, slug]; save(); rerender(); };
    $("#tm").onclick = () => { DB.muted.topics = muted ? DB.muted.topics.filter(x => x !== slug) : [...DB.muted.topics, slug]; save(); rerender(); };
  },

  communities() {
    const mine = DB.communities.filter(c => S.membership(c.id)), other = DB.communities.filter(c => !S.membership(c.id) && c.type !== "invite");
    view.innerHTML = `<div class="wrap"><div class="row"><h2 class="grow">المجتمعات</h2><button class="btn" id="newc">＋ إنشاء مجتمع</button></div>
      <h4>مجتمعاتي</h4>${mine.map(commRow).join("") || '<div class="muted">لم تنضم لأي مجتمع بعد</div>'}
      <h4>اكتشف</h4>${other.map(commRow).join("") || '<div class="muted">لا يوجد المزيد</div>'}</div>`;
    $("#newc").onclick = () => {
      const s = sheet(`<h4>مجتمع جديد</h4><input id="cn" placeholder="اسم المجتمع"><textarea id="cd" placeholder="وصف المجتمع" class="u-mh70 u-mt8"></textarea>
        <select id="ct" class="u-mt8"><option value="public">عام: أي شخص ينضم</option><option value="private">خاص: الانضمام بموافقة</option><option value="invite">بالدعوة فقط</option></select>
        <select id="ctop" class="u-mt8">${TOPICS.map(t => `<option value="${t.slug}">${t.name}</option>`).join("")}</select>
        <textarea id="cr" placeholder="القواعد (قاعدة في كل سطر)" class="u-mh70 u-mt8"></textarea>
        <label class="u-my10 row"><input type="checkbox" id="cap" class="u-wa"> المنشورات تحتاج موافقة المشرف</label>
        <button class="btn block" id="cc">إنشاء</button>`);
      $("#cc", s).onclick = () => { const name = $("#cn", s).value.trim(); if (!name) return toast("أدخل اسماً"); const c = Cmd.createCommunity({ name, desc: $("#cd", s).value.trim(), type: $("#ct", s).value, topic: $("#ctop", s).value, rules: $("#cr", s).value.split("\n").filter(Boolean), requireApproval: $("#cap", s).checked }); closeSheet(); location.hash = "#/c/" + c.id; };
    };
  },

  community(id) {
    const c = S.community(id); if (!c) return Views.notFound();
    const m = S.membership(id), role = m?.role, isMod = ["owner", "admin", "moderator"].includes(role), tab = view._ctab || "home";
    const canSee = c.type === "public" || (m && role !== "pending");
    const posts = DB.posts.filter(p => p.community === id && p.status === "published").sort(byNew);
    const queue = DB.posts.filter(p => p.community === id && p.status === "pending");
    const members = S.members(id);
    const roleName = { owner: "المالك", admin: "مدير", moderator: "مشرف", member: "عضو", pending: "بانتظار الموافقة" };
    let body = "";
    if (!canSee) body = `<div class="empty"><svg class=ei aria-hidden=true><use href=#i-lock /></svg> مجتمع خاص. انضم لرؤية المحتوى.</div>`;
    else if (tab === "home") body = (m && role !== "pending" ? `<div class="card composer-bar" id="cpost">${av(S.me())}<div class="fake">انشر في ${esc(c.name)}…</div></div>` : "") + (posts.map(p => postCard(p)).join("") || '<div class="empty">لا منشورات بعد</div>');
    else if (tab === "members") body = members.map(x => { const u = S.user(x.user); return `<div class="card row">${av(u)}<a class="grow" href="#/u/${u.handle}"><b>${esc(u.name)}</b><div class="muted">${roleName[x.role] || x.role}${c.owner === x.user ? " · عضو مؤسس" : ""}</div></a>${role === "owner" && x.user !== DB.me ? `<button class="btn ghost" data-promote="${x.user}">${x.role === "moderator" ? "إزالة الإشراف" : "تعيين مشرف"}</button>` : ""}</div>`; }).join("");
    else if (tab === "rules") body = `<div class="card">${c.rules.map((r, i) => `<p>${i + 1}. ${esc(r)}</p>`).join("") || '<p class="muted">لا قواعد</p>'}</div>`;
    else if (tab === "about") body = `<div class="card"><p>${esc(c.desc)}</p><p class="muted">النوع: ${{ public: "عام", private: "خاص", invite: "بالدعوة" }[c.type]} · الموضوع: ${S.topic(c.topic)?.name}</p><p class="muted">تأسس ${new Date(c.createdAt).toLocaleDateString("ar")}</p><p class="muted">المنشورات تحتاج موافقة: ${c.requireApproval ? "نعم" : "لا"}</p></div>`;
    else if (tab === "queue") body = queue.map(p => `<div class="card">${postInner(p)}<div class="u-g8 u-mt8 row"><button class="btn" data-approve="${p.id}">قبول</button><button class="btn ghost" data-reject="${p.id}">رفض</button></div></div>`).join("") || '<div class="empty">لا يوجد شيء للمراجعة ✓</div>';
    else if (tab === "stats") { const eng = posts.reduce((a, p) => a + S.reactionsOf(p.id).length + S.commentsOf(p.id).length, 0); body = `<div class="card"><div class="stats" style="justify-content:space-around;text-align:center"><div><b>${members.length}</b><div class="muted">عضو</div></div><div><b>${posts.length}</b><div class="muted">منشور</div></div><div><b>${eng}</b><div class="muted">تفاعل</div></div><div><b>${queue.length}</b><div class="muted">بانتظار</div></div></div></div><h4>أفضل المنشورات</h4>${[...posts].sort((a, b) => S.reactionsOf(b.id).length - S.reactionsOf(a.id).length).slice(0, 3).map(p => postCard(p)).join("")}`; }
    const tabs = [["home", "الرئيسية"], ["members", "الأعضاء"], ["rules", "القواعد"], ["about", "حول"], ...(isMod ? [["queue", `المراجعة${queue.length ? " (" + queue.length + ")" : ""}`], ["stats", "الإحصائيات"]] : [])];
    view.innerHTML = `<div class="cover" style="background:${c.color}"></div><div class="profile-top"><div class="av lg" style="background:${c.color}"><svg class=ei aria-hidden=true><use href=#i-users /></svg></div>
      <div class="row"><h2 class="grow">${esc(c.name)}</h2>${role === "owner" ? '<span class="chip">المالك</span>' : `<button class="btn ${m ? "ghost" : ""}" data-join="${id}">${!m ? (c.type === "private" ? "طلب انضمام" : "انضم") : role === "pending" ? "بانتظار الموافقة" : "مغادرة"}</button>`}</div>
      <div class="muted">${esc(c.desc)}</div><div class="stats"><span><b>${members.length}</b> عضو</span><span><b>${posts.length}</b> منشور</span></div></div>
      <div class="wrap"><div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-ct="${k}">${l}</button>`).join("")}</div>${body}</div>`;
    view.querySelectorAll("[data-ct]").forEach(b => b.onclick = () => { view._ctab = b.dataset.ct; rerender(); });
    if ($("#cpost")) $("#cpost").onclick = () => openComposer({ community: id, topic: c.topic });
    view.querySelectorAll("[data-approve]").forEach(b => b.onclick = () => { S.post(b.dataset.approve).status = "published"; DB.audit.push({ action: "POST_APPROVED", target: b.dataset.approve, by: DB.me, at: now() }); save(); rerender(); });
    view.querySelectorAll("[data-reject]").forEach(b => b.onclick = () => { S.post(b.dataset.reject).status = "removed"; DB.audit.push({ action: "POST_REJECTED", target: b.dataset.reject, by: DB.me, at: now() }); save(); rerender(); });
    view.querySelectorAll("[data-promote]").forEach(b => b.onclick = () => { const x = S.membership(id, b.dataset.promote); x.role = x.role === "moderator" ? "member" : "moderator"; DB.audit.push({ action: "ROLE_CHANGED", target: b.dataset.promote, to: x.role, by: DB.me, at: now() }); save(); rerender(); });
  },

  notifications() {
    const list = DB.notifications.filter(n => n.user === DB.me);
    const text = n => ({ reaction: "تفاعل مع منشورك", comment: "علّق على منشورك", follow: "بدأ بمتابعتك", welcome: "يرحب بك في مجتمع بلس", mention: "أشار إليك", reply: "ردّ على تعليقك", join_request: "طلب الانضمام إلى مجتمعك", approved: "قبل طلب انضمامك", post_approved: "وافق على منشورك في المجتمع", invite: "دعاك للانضمام", event: "تذكير: حدث يبدأ قريباً", video: "اكتملت معالجة الفيديو الخاص بك ✓", scheduled: "نُشر منشورك المجدول ✓", removed: "أُزيل منشور لك لمخالفته القواعد، يمكنك الاستئناف من الإعدادات", community_welcome: "رحّب بك في المجتمع، اطّلع على خطوات البداية", mod_warning: "وجّه لك إنذاراً في المجتمع", autoguard_strike: "وصلك تحذير من الحارس التلقائي في المجتمع", autoguard_lock: "أُوقفت عن الكتابة في المجتمع حتى يرفع مشرف الإيقاف", mod_digest: "عناصر تنتظر مراجعتك في المجتمع", partner_request: "يقترح شراكة مع مجتمعك", challenge_won: "فزت في تحدي المجتمع", waitlist_promoted: "تأكد مقعدك في الفعالية بعد قائمة الانتظار", event_24h: "تذكير: فعاليتك غداً", event_1h: "تذكير: فعاليتك تبدأ خلال ساعة" }[n.kind] || n.kind);
    view.innerHTML = `<div class="wrap"><div class="row"><h2 class="grow">الإشعارات</h2>${list.some(n => !n.read) ? '<button class="btn ghost" id="mr">تعليم الكل كمقروء</button>' : ""}</div>
      ${list.map(n => { const u = S.user(n.actor) || { name: "مجتمع بلس", handle: "", color: "#5b2bd6" }; const href = n.post ? "#/post/" + n.post : n.ref && DB.events.find(e => e.id === n.ref) ? "#/event/" + n.ref : n.ref && S.community(n.ref) ? "#/c/" + n.ref : u.handle ? "#/u/" + u.handle : "#/home"; return `<a class="card row ${n.read ? "" : "unread"}" href="${href}"><span class="av" style="background:${u.color}" aria-hidden="true">${esc(u.name[0])}</span><div class="grow"><b>${esc(u.name)}</b> ${text(n)}<div class="muted">${relTime(n.at)}</div></div></a>`; }).join("") || '<div class="empty">لا إشعارات بعد</div>'}</div>`;
    if ($("#mr")) $("#mr").onclick = () => { list.forEach(n => n.read = true); save(); App.refreshBadges(); rerender(); };
  },

  profile(handle) {
    const u = handle ? S.byHandle(handle) : S.me(); if (!u) return Views.notFound();
    const me = u.id === DB.me, tab = view._ptab || "posts";
    let posts = DB.posts.filter(p => p.author === u.id && p.status === "published" && (me || p.visibility === "public" || (p.visibility === "followers" && S.follows(DB.me, u.id)))).sort(byNew);
    if (u.pinned) posts = [S.post(u.pinned), ...posts.filter(p => p.id !== u.pinned)].filter(Boolean);
    let body = "";
    if (tab === "posts") body = posts.map(p => (p.id === u.pinned ? '<div class="muted"><svg class=ei aria-hidden=true><use href=#i-pin /></svg> مثبت</div>' : "") + postCard(p)).join("") || '<div class="empty">لا منشورات بعد</div>';
    if (tab === "replies") body = DB.comments.filter(c => c.author === u.id).sort(byNew).map(c => `<a class="u-db card" href="#/post/${c.post}"><div class="muted">ردًا على منشور</div><div class="body">${esc(c.text)}</div></a>`).join("") || '<div class="empty">لا ردود</div>';
    if (tab === "media") body = posts.filter(p => p.media).map(p => postCard(p)).join("") || '<div class="empty">لا وسائط</div>';
    if (tab === "saved") body = DB.collections.map(c => `<h4>${esc(c.name)} (${c.items.length})</h4>${c.items.map(id => postCard(S.post(id))).join("")}`).join("");
    if (tab === "creator") {
      const all = DB.posts.filter(p => p.author === u.id && p.status === "published");
      const views = all.reduce((a, p) => a + p.views, 0), eng = all.reduce((a, p) => a + S.reactionsOf(p.id).length + S.commentsOf(p.id).length, 0);
      const pts = Array.from({ length: 7 }, (_, i) => 10 + i * 3 + Math.round(Math.random() * 6) + S.followers(u.id).length);
      const max = Math.max(...pts), path = pts.map((v, i) => `${i * 50},${100 - v / max * 90}`).join(" ");
      body = `<div class="card"><div class="stats" style="justify-content:space-around;text-align:center"><div><b>${views}</b><div class="muted">مشاهدة</div></div><div><b>${eng}</b><div class="muted">تفاعل</div></div><div><b>${views ? (eng / views * 100).toFixed(1) : 0}%</b><div class="muted">معدل التفاعل</div></div></div>
        <h4>نمو المتابعين (٧ أيام)</h4><svg viewBox="0 0 300 100" style="width:100%;height:110px"><polyline points="${path}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/></svg>
        <p class="muted">أفضل وقت للنشر: ٨–١٠ مساءً</p></div><h4>أفضل منشوراتك</h4>${[...all].sort((a, b) => b.views - a.views).slice(0, 3).map(p => postCard(p)).join("") || '<div class="muted">انشر أول منشور</div>'}`;
    }
    const tabs = [["posts", "المنشورات"], ["replies", "الردود"], ["media", "الوسائط"], ...(me ? [["saved", "المحفوظ"]] : []), ...(me && u.creator ? [["creator", "إحصائيات"]] : [])];
    view.innerHTML = `<div class="cover" style="background:linear-gradient(135deg,${u.color},#c04cf0)"></div>
      <div class="profile-top"><div class="row" style="align-items:flex-end"><div class="av lg" style="background:${u.color}">${esc(u.name[0])}</div><div class="grow"></div>
        <a class="btn ghost icon" href="#/search/${encodeURIComponent("from:" + u.handle + " ")}" aria-label="${me ? "ابحث في منشوراتك" : "ابحث في منشوراته"}" title="${me ? "ابحث في منشوراتك" : "ابحث في منشوراته"}">${window.UI ? UI.icon("search", "sm") : ""}</a>${me ? `<button class="btn ghost" id="edit">تعديل</button><button class="btn ghost icon" id="settings" aria-label="الإعدادات">${window.UI ? UI.icon("settings", "sm") : "<svg class=ei aria-hidden=true><use href=#i-settings /></svg>"}</button>` :
        `<button class="btn ghost icon" id="msg" aria-label="مراسلة">${window.UI ? UI.icon("mail", "sm") : "<svg class=ei aria-hidden=true><use href=#i-mail /></svg>"}</button><button class="btn ghost icon" id="pmore" aria-label="المزيد">${window.UI ? UI.icon("more", "sm") : "⋯"}</button><button class="btn ${S.follows(DB.me, u.id) ? "ghost" : ""}" data-follow="${u.id}">${S.follows(DB.me, u.id) ? "تتابعه" : "تابع"}</button>`}</div>
        <h2 class="u-mb0">${esc(u.name)} ${u.badge ? `<span class="badge-v">✦ ${u.badge}</span>` : ""}</h2><div class="muted"><bdi>@${u.handle}</bdi>${S.follows(u.id, DB.me) && !me ? " · يتابعك" : ""}</div>
        <p>${esc(u.bio || "")}</p>
        <div class="stats"><a href="#/follows/${u.handle}/following"><b>${S.following(u.id).length}</b> يتابع</a><a href="#/follows/${u.handle}/followers"><b>${S.followers(u.id).length}</b> متابِع</a></div></div>
      <div class="wrap"><div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-pt="${k}">${l}</button>`).join("")}</div>${body}</div>`;
    view.querySelectorAll("[data-pt]").forEach(b => b.onclick = () => { view._ptab = b.dataset.pt; rerender(); });
    if (me) {
      $("#edit").onclick = () => { const s = sheet(`<h4>تعديل الملف الشخصي</h4><input id="en" value="${esc(u.name)}" placeholder="الاسم"><input id="eh" value="${esc(u.handle)}" placeholder="اسم المستخدم" class="u-mt8 u-ltr"><textarea id="eb" placeholder="نبذة" class="u-mh70 u-mt8">${esc(u.bio)}</textarea><label class="u-my10 row"><input type="checkbox" id="ecr" class="u-wa" ${u.creator ? "checked" : ""}> تفعيل وضع المبدع (إحصائيات وأدوات)</label><button class="btn block" id="es">حفظ</button>`); $("#es", s).onclick = () => { const h = $("#eh", s).value.trim().replace(/[^a-zA-Z0-9_]/g, ""); if (h && DB.users.some(x => x.handle === h && x.id !== u.id)) return toast("اسم المستخدم محجوز"); u.name = $("#en", s).value.trim() || u.name; u.handle = h || u.handle; u.bio = $("#eb", s).value.trim(); u.creator = $("#ecr", s).checked; save(); closeSheet(); rerender(); }; };
      $("#settings").onclick = () => location.hash = "#/settings";
    } else {
      $("#msg").onclick = () => { const c = Cmd.openConversation(u.id); location.hash = "#/chat/" + c.id; };
      $("#pmore").onclick = () => { const s = sheet(`<div class="menu"><button data-a="mute"><svg class=ei aria-hidden=true><use href=#i-bellOff /></svg> كتم</button><button data-a="block"><svg class=ei aria-hidden=true><use href=#i-ban /></svg> حظر</button><button data-a="report" class="u-c-dg"><svg class=ei aria-hidden=true><use href=#i-flag /></svg> إبلاغ عن الحساب</button></div>`); s.querySelectorAll("[data-a]").forEach(b => b.onclick = () => { closeSheet(); if (b.dataset.a === "mute") { Cmd.mute("users", u.id); toast("تم الكتم"); } if (b.dataset.a === "block") { Cmd.block(u.id); toast("تم الحظر"); location.hash = "#/home"; } if (b.dataset.a === "report") reportFlow(u.id, "user"); }); };
    }
  },

  follows(handle, kind) {
    const u = S.byHandle(handle); const ids = kind === "followers" ? S.followers(u.id) : S.following(u.id);
    view.innerHTML = `<div class="wrap"><a href="#/u/${handle}" class="muted">→ ${esc(u.name)}</a><h2>${kind === "followers" ? "المتابِعون" : "يتابع"}</h2>${ids.map(id => userRow(S.user(id))).join("") || '<div class="empty">لا أحد بعد</div>'}</div>`;
  },

  messages() {
    const convs = DB.conversations.filter(c => c.members.includes(DB.me)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    view.innerHTML = `<div class="wrap"><div class="row"><h2 class="grow">الرسائل</h2><button class="btn" id="nm">＋ رسالة</button></div>${convs.map(c => {
      const u = S.user(c.members.find(m => m !== DB.me)), last = DB.messages.filter(m => m.conv === c.id).slice(-1)[0], unread = DB.messages.some(m => m.conv === c.id && !m.read && m.from !== DB.me);
      return `<a class="card row ${unread ? "unread" : ""}" href="#/chat/${c.id}">${av(u)}<div class="grow"><b>${esc(u.name)}</b><div class="muted ell" dir="auto">${esc(last?.text || "ابدأ المحادثة")}</div></div><span class="muted">${last ? relTime(last.at) : ""}</span></a>`;
    }).join("") || '<div class="empty">لا محادثات بعد</div>'}</div>`;
    $("#nm").onclick = () => { const s = sheet(`<h4>رسالة جديدة</h4><div class="menu">${DB.users.filter(u => u.id !== DB.me && !DB.blocked.includes(u.id)).map(u => `<button data-u="${u.id}">${esc(u.name)} <span class="muted"><bdi>@${u.handle}</bdi></span></button>`).join("")}</div>`); s.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { const c = Cmd.openConversation(b.dataset.u); closeSheet(); location.hash = "#/chat/" + c.id; }); };
  },

  chat(id) {
    const c = DB.conversations.find(x => x.id === id); if (!c) return Views.notFound();
    const u = S.user(c.members.find(m => m !== DB.me));
    DB.messages.filter(m => m.conv === id).forEach(m => m.read = true); save(); App.refreshBadges();
    view.innerHTML = `<div class="wrap"><div class="u-mb10 row"><a href="#/messages" class="muted">→</a>${av(u, "sm")}<a href="#/u/${u.handle}" class="grow"><b>${esc(u.name)}</b></a></div>
      <div id="msgs">${DB.messages.filter(m => m.conv === id).map(m => `<div class="bubble ${m.from === DB.me ? "me" : "them"}">${esc(m.text)}<div style="font-size:10px;opacity:.7">${relTime(m.at)}</div></div>`).join("")}</div><div style="height:70px"></div></div>
      <div class="chatbar"><input id="mi" placeholder="اكتب رسالة…"><button class="btn" id="ms">إرسال</button></div>`;
    scrollTo(0, document.body.scrollHeight);
    $("#ms").onclick = () => { const t = $("#mi").value.trim(); if (!t) return; Cmd.sendMessage(id, t); rerender();
      setTimeout(() => { DB.messages.push({ id: uid("ms"), conv: id, from: u.id, text: ["👍", "تمام، اتفقنا", "فكرة حلوة!", "سأرد عليك قريباً"][Math.floor(Math.random() * 4)], at: now(), read: location.hash === "#/chat/" + id }); save(); if (location.hash === "#/chat/" + id) rerender(); else App.refreshBadges(); }, 2500); };
    $("#mi").onkeydown = e => { if (e.key === "Enter") $("#ms").click(); };
  },

  library() {
    const tab = view._ltab || "saved";
    const body = tab === "saved" ? DB.collections.map(c => `<h4><svg class="ic hi" aria-hidden="true"><use href="#i-folder"/></svg>${esc(c.name)} (${c.items.length})</h4>${c.items.map(id => postCard(S.post(id))).join("") || '<div class="muted">فارغة</div>'}`).join("")
      : tab === "history" ? DB.history.slice(0, 30).map(id => postCard(S.post(id))).join("") || '<div class="empty">لا سجل بعد</div>'
        : DB.drafts.map(d => `<div class="card row"><div class="grow"><svg class=ei aria-hidden=true><use href=#i-doc /></svg> ${esc((d.title || d.text).slice(0, 80))}<div class="muted">${relTime(d.at)}</div></div><button class="btn ghost" data-od="${d.id}">فتح</button></div>`).join("") || '<div class="empty">لا مسودات</div>';
    view.innerHTML = `<div class="wrap"><h2>مكتبتي</h2><div class="tabs">${[["saved", "المحفوظات"], ["history", "سجل المشاهدة"], ["drafts", "المسودات"]].map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-lt="${k}">${l}</button>`).join("")}</div>${body}</div>`;
    view.querySelectorAll("[data-lt]").forEach(b => b.onclick = () => { view._ltab = b.dataset.lt; rerender(); });
    view.querySelectorAll("[data-od]").forEach(b => b.onclick = () => { const d = DB.drafts.find(x => x.id === b.dataset.od); DB.drafts = DB.drafts.filter(x => x !== d); save(); openComposer(d); });
  },

  settings() {
    const mutedU = DB.muted.users.map(S.user), blocked = DB.blocked.map(S.user);
    const uRows = (us, k, lbl) => us.length ? `<div class="list">${us.map(u => `<div class="li"><span class="t"><b>${esc(u.name)}</b><small dir="ltr">@${esc(u.handle)}</small></span><button type="button" class="btn sm ghost" data-${k}="${u.id}" aria-label="${lbl}: ${esc(u.name)}">${lbl}</button></div>`).join("")}</div>` : '<p class="muted">لا أحد</p>';
    view.innerHTML = `<div class="wrap set-page">${window.UI ? UI.pageHead({ back: ["#/me", "حسابي"], title: "الإعدادات" }) : "<h2>الإعدادات</h2>"}
      <div class="card"><b>إدارة ما تراه</b>
        <h4>اهتماماتك</h4><div class="chips">${TOPICS.map(t => `<button class="tab ${DB.interests.includes(t.slug) ? "on" : ""}" data-int="${t.slug}">${t.name}</button>`).join("")}</div>
        <h4>مواضيع مكتومة</h4><div class="chips">${DB.muted.topics.map(t => `<button class="tab" data-umt="${t}">${S.topic(t)?.name} ✕</button>`).join("") || '<span class="muted">لا شيء</span>'}</div>
        <h4>حسابات مكتومة</h4>${uRows(mutedU, "umu", "إلغاء الكتم")}
        <h4>المحظورون</h4>${uRows(blocked, "ub", "إلغاء الحظر")}
        ${DB.muted.posts.length ? `<button class="u-mt12 btn ghost" id="clrni">إعادة ضبط «غير مهتم» (${DB.muted.posts.length})</button>` : ""}</div>
      <div class="card"><b>Pi Network</b><p class="muted">تسجيل الدخول والمدفوعات عبر Pi تُفعَّل في مرحلة الربط.</p><button class="btn" id="pi">تسجيل الدخول عبر Pi</button></div>
      <div class="card"><b>سجل القرارات والبلاغات</b>${DB.audit.slice(-8).reverse().map(a => `<div class="trend"><span>${a.action}</span><span class="muted">${relTime(a.at)}</span></div>`).join("") || '<p class="muted">لا شيء بعد</p>'}</div>
      <div class="card"><b>أخرى</b><p><button class="btn ghost" id="reset">إعادة ضبط البيانات التجريبية</button></p><p class="muted">مجتمع بلس · الإصدار <span id="ver"></span></p><p><a class="btn ghost" href="#/versions" id="mp-versions-link">سجل الإصدارات: ماذا تغيّر في كل إصدار</a></p></div></div>`;
    view.querySelectorAll("[data-int]").forEach(b => b.onclick = () => { const s = b.dataset.int; DB.interests = DB.interests.includes(s) ? DB.interests.filter(x => x !== s) : [...DB.interests, s]; save(); rerender(); });
    view.querySelectorAll("[data-umt]").forEach(b => b.onclick = () => { DB.muted.topics = DB.muted.topics.filter(x => x !== b.dataset.umt); save(); rerender(); });
    view.querySelectorAll("[data-umu]").forEach(b => b.onclick = () => { DB.muted.users = DB.muted.users.filter(x => x !== b.dataset.umu); save(); rerender(); });
    view.querySelectorAll("[data-ub]").forEach(b => b.onclick = () => { DB.blocked = DB.blocked.filter(x => x !== b.dataset.ub); save(); rerender(); });
    if ($("#clrni")) $("#clrni").onclick = () => { DB.muted.posts = []; DB.interestWeights = {}; save(); rerender(); };
    $("#pi").onclick = async () => { const u = await PiAdapter.authenticate(); toast(u ? "تم الدخول" : "الربط مع Pi قريباً"); };
    $("#reset").onclick = () => { if (confirm("مسح كل البيانات والبدء من جديد؟")) { resetDemo(); location.hash = "#/home"; location.reload(); } };
  },

  onboarding(step = 1) {
    document.body.classList.add("ob");
    if (step === 1) view.innerHTML = `<div class="wrap" style="text-align:center;padding-top:40px"><div class="logo" style="width:80px;height:80px;font-size:56px;border-radius:26px;margin:auto">+</div><h2 class="u-t-num u-mt20">أهلاً بك في مجتمع بلس</h2><p class="muted">اكتشف أشخاصاً ومجتمعات ونقاشات تهمك، وشارك أفكارك مع العالم.</p><br><button class="btn block" id="n1">ابدأ</button>${(() => { const en = !!(window.MPI18n && MPI18n.current() === "en"); return `<button type="button" class="btn ghost block u-mt12" id="ob-lang" data-mplang="${en ? "ar" : "en"}" lang="${en ? "ar" : "en"}" data-noi18n>${en ? "العربية" : "English"}</button>`; })()}</div>`; /* v2.140: visitors pick the language right on the welcome screen */
    if (step === 2) view.innerHTML = `<div class="wrap"><h2>ما الذي يهمك؟</h2><p class="muted">اختر ٣ اهتمامات على الأقل لنخصص لك المحتوى.</p><div class="chips">${TOPICS.map(t => `<button class="tab ${DB.interests.includes(t.slug) ? "on" : ""}" data-i="${t.slug}">${t.name}</button>`).join("")}</div><br><button class="btn block" id="n2" ${DB.interests.length < 3 ? "disabled" : ""}>التالي (${DB.interests.length}/3)</button></div>`;
    if (step === 3) {
      const sug = DB.users.filter(u => u.id !== DB.me).sort((a, b) => b.topics.filter(t => DB.interests.includes(t)).length - a.topics.filter(t => DB.interests.includes(t)).length).slice(0, 5);
      const comms = DB.communities.filter(c => DB.interests.includes(c.topic) && c.type === "public");
      view.innerHTML = `<div class="wrap"><h2>أشخاص ومجتمعات لك</h2>${sug.map(userRow).join("")}${comms.length ? "<h4>مجتمعات</h4>" + comms.map(commRow).join("") : ""}<br><button class="btn block" id="n3">ادخل إلى المجتمع</button></div>`;
    }
    if ($("#n1")) $("#n1").onclick = () => Views.onboarding(2);
    view.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { const s = b.dataset.i; DB.interests = DB.interests.includes(s) ? DB.interests.filter(x => x !== s) : [...DB.interests, s]; save(); Views.onboarding(2); });
    if ($("#n2")) $("#n2").onclick = () => Views.onboarding(3);
    if ($("#n3")) $("#n3").onclick = () => { DB.onboarded = true; save(); document.body.classList.remove("ob"); location.hash = "#/home"; route(); };
    view._ob = step;
  },

  notFound() { view.innerHTML = `<div class="wrap nf-page">${UI.empty({ title: "الصفحة غير موجودة", text: "ربما تغيّر الرابط أو حُذف المحتوى. ابحث عمّا تريد أو عُد إلى الرئيسية.", action: `<div class="empty-acts"><a class="btn" href="#/home">الرئيسية</a><a class="btn ghost" href="#/search">بحث</a></div>` })}</div>`; }
};

function userRow(u) { return `<div class="card row">${av(u)}<a class="u-mw0 grow" href="#/u/${u.handle}"><b>${esc(u.name)}</b> ${u.badge ? `<span class="badge-v">✦</span>` : ""}<div class="muted ell" dir="auto">${esc(u.bio)}</div></a>${u.id !== DB.me ? `<button class="btn ${S.follows(DB.me, u.id) ? "ghost" : ""}" data-follow="${u.id}">${S.follows(DB.me, u.id) ? "تتابعه" : "تابع"}</button>` : ""}</div>`; }
function commRow(c) { const m = S.membership(c.id); return `<div class="card row"><div class="av" style="background:${c.color}"><svg class=ei aria-hidden=true><use href=#i-users /></svg></div><a class="u-mw0 grow" href="#/c/${c.id}"><b>${esc(c.name)}</b> ${c.type !== "public" ? "<svg class=ei aria-hidden=true><use href=#i-lock /></svg>" : ""}<div class="muted">${S.members(c.id).length} عضو · ${esc(c.desc)}</div></a>${m?.role === "owner" ? "" : `<button class="btn ${m ? "ghost" : ""}" data-join="${c.id}">${!m ? "انضم" : m.role === "pending" ? "معلّق" : "عضو ✓"}</button>`}</div>`; }

/* ---------- Router ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
  const [r, a, b] = h.split("/");
  if (window.MPSession?.state === "out" && typeof showAuth === "function") return showAuth(view._authMode || "login"); /* v2.140: a signed-out visitor keeps the sign-in screen (re-render, language switch, deep links) instead of the onboarding gate */
  if (!DB.onboarded) { $(".bottomnav").style.display = "none"; $("#fab").style.display = "none"; document.body.classList.remove("has-fab"); return Views.onboarding(view._ob || 1); }
  $(".bottomnav").style.display = ""; { const fabOn = ["home", "communities", "c", "u", "me", "topic", "tag", "list", "events"].includes(r); void fabOn; document.body.classList.remove("has-fab"); } /* v2.139: no floating button */
  if (window.MPNav) MPNav.paint(); else document.querySelectorAll(".bottomnav a[data-r]").forEach(x => x.classList.toggle("active", x.dataset.r === r));
  if (view._route !== h) { view._ctab = view._ptab = view._csort = view._ltab = null; if (r !== "explore") view._q = ""; scrollTo(0, 0); }
  view._route = h;
  ({ home: () => Views.home(), explore: () => Views.explore(), communities: () => Views.communities(), c: () => Views.community(a), notifications: () => Views.notifications(),
    me: () => Views.profile(), u: () => Views.profile(a), post: () => Views.post(a), topic: () => Views.topic(a), tag: () => Views.tag(a), follows: () => Views.follows(a, b),
    messages: () => Views.messages(), chat: () => Views.chat(a), library: () => Views.library(), settings: () => Views.settings(), ...(window.ExtraRoutes ? window.ExtraRoutes(a, b) : {}) }[r] || Views.notFound)();
  App.refreshBadges();
}
/* v2.29 flicker fix: a re-render of the SAME route keeps the page still — scroll position, focus and height are held,
 * nodes added later by async enhancers ([data-keep], e.g. the stories bar) stay in place, and the entrance animation
 * only runs on real navigation (ui.js afterRoute). Actions on a post patch just that post (patchPost). */
const rerender = () => {
  const y = scrollY, a = document.activeElement, fk = a && a !== document.body && view.contains(a) ? (a.id ? "#" + a.id : [...a.attributes].filter(x => x.name.startsWith("data-")).map(x => `[${x.name}="${CSS.escape(x.value)}"]`).join("")) : "";
  const keep = [...view.querySelectorAll("[data-keep]")];
  view.style.minHeight = view.offsetHeight + "px"; window.__softRender = true; const old = [...view.childNodes], at = location.hash;
  try { route(); } finally { window.__softRender = false; }
  // screens that load async paint a skeleton first — on a re-render keep the current screen until the real one arrives
  if (old.length && location.hash === at && view.querySelector(".skel") && !view.textContent.trim()) view.replaceChildren(...old);
  for (const k of keep) if (!view.querySelector(`[data-keep="${k.dataset.keep}"]`)) { const at = k.dataset.keepBefore && view.querySelector(k.dataset.keepBefore); if (at) at.before(k); }
  if (Math.abs(scrollY - y) > 1) scrollTo(0, y);
  if (fk) { try { const n = view.querySelector(fk); if (n && n !== document.activeElement) n.focus({ preventScroll: true }); } catch { } }
  requestAnimationFrame(() => requestAnimationFrame(() => { view.style.minHeight = ""; }));
};
/** re-render only what an action on post `pid` changes (its action bar and poll), everywhere it is shown */
function patchPost(pid) {
  const p = S.post(pid); if (!p) return rerender();
  const t = document.createElement("div"); t.innerHTML = postInner(p);
  const acts = t.querySelector(".actions"), poll = t.querySelector(".poll"); let hit = false;
  document.querySelectorAll(`#view [data-react="${CSS.escape(pid)}"]`).forEach(b => { const box = b.closest(".actions"); if (!box || !acts) return; hit = true; box.replaceWith(acts.cloneNode(true)); });
  if (poll) document.querySelectorAll(`#view [data-vote^="${CSS.escape(pid)}:"]`).forEach(o => { const box = o.closest(".poll"); if (box && box.isConnected) { box.replaceWith(poll.cloneNode(true)); hit = true; } });
  if (!hit) rerender();
}
/** follow / unfollow buttons for `uid` flip in place */
function patchFollow(uid) {
  const on = S.follows(DB.me, uid);
  document.querySelectorAll(`#view [data-follow="${CSS.escape(uid)}"]`).forEach(b => { if (!b.dataset.followLabel) b.dataset.followLabel = on ? b.textContent.trim() : "تابع"; b.textContent = on ? "تتابعه" : b.dataset.followLabel; b.classList.toggle("ghost", on); b.setAttribute("aria-pressed", String(on)); });
}
const App = {
  refreshBadges() {
    const n = DB.notifications.filter(x => (!x.user || x.user === DB.me) && !x.read).length /* v2.140.2: same rule as the notification center (server rows may omit user) */, m = DB.messages.filter(x => x.from !== DB.me && !x.read).length;
    const nb = $("#notifBadge"), mb = $("#msgBadge");
    nb.textContent = n; nb.classList.toggle("on", n > 0); mb.textContent = m; mb.classList.toggle("on", m > 0);
  }
};
window.App = App;
window.addEventListener("hashchange", route);
// Scheduled posts publisher hook (future: server cron)
setInterval(() => { let ch = false; DB.posts.forEach(p => { if (p.status === "scheduled" && new Date(p.publishAt) <= new Date()) { p.status = "published"; p.createdAt = now(); ch = true; } }); if (ch) save(); }, 30e3);
PiAdapter.init();
// route() is started by v12.js after extensions load
