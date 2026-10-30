/* =====================================================================
 * مجتمع بلس — Phase 50 UI: launch readiness (lazy "launch" chunk, loaded by the "ai" chunk; 0 bytes in core).
 * • #/faq (help center + FAQ + search), #/faq/:slug article, #/tickets (mine), #/tickets/new, #/tickets/:id (thread + reply + attachments),
 *   #/ambassadors (apply / status / referral link + stats + invites), #/waitlist (join + enter invite code), #/about (also path /about).
 * • Staff (admin|moderator): #/staff/tickets queue, #/staff/help article editor, #/staff/ambassadors review, #/staff/launch (waitlist + invites).
 * • ?invite= / ?ref= in the URL are kept in sessionStorage and added to /api/auth/register and /api/auth/pi (Remote.api wrapper).
 * • Design-review pass: small consistency fixes as chunk CSS (.lc-design) — nothing added to the core bundle.
 * CSP: no inline handlers, no javascript: URLs. Styles injected (#lc-css).
 * ===================================================================== */
(function LaunchUI() {
  if (window.MPLaunch) return;
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b, raw) => Remote.api(m, p, b, raw);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const day = (iso) => { try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso || ""); } };
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const $v = (s) => view.querySelector(s) || document.createElement("div"); // a view re-rendered mid-await writes into a detached stub instead of throwing
  const back = (href, label) => [href, label];
  const page = (title, body, b) => { view.innerHTML = `<div class="wrap lc-page">${UI.pageHead({ back: b, title, icon: { "مركز المساعدة": "help", "تذاكر الدعم": "ticket", "تذكرة دعم جديدة": "ticket", "سفراء المجتمع": "medal", "طلبات السفراء": "medal", "قائمة الانتظار": "hourglass", "طابور الدعم": "headset", "مقالات مركز المساعدة": "book", "الإطلاق التدريجي": "trendUp" }[title], id: "lc-h" })}${body}</div>`; const t = $v("#lc-h"); if (t) t.focus({ preventScroll: true }); };
  const skel = '<div class="skel"></div><div class="skel"></div>';
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const ST = { open: "مفتوحة", pending: "قيد المعالجة", answered: "تم الرد", resolved: "تم الحل", closed: "مغلقة" };
  const CAT = { general: "عام", account: "الحساب", pi: "Pi والمدفوعات", safety: "الأمان والإبلاغ", bug: "خلل تقني", content: "المحتوى", other: "أخرى" };
  const HCAT = { start: "البدء", account: "الحساب", pi: "Pi", safety: "الأمان", communities: "المجتمعات", general: "عام" };
  const AST = { pending: "قيد المراجعة", approved: "سفير معتمد", rejected: "لم يُقبل", revoked: "أُلغيت العضوية" };
  let cfg = null;
  const config = (force) => (cfg && !force ? Promise.resolve(cfg) : (online() ? api("GET", "/api/launch/config") : Promise.resolve({ mode: "open", staff: false })).then((c) => (cfg = c)).catch(() => (cfg = { mode: "open", staff: false })));

  /* ---------- invite / referral carried into sign-up ---------- */
  try {
    const q = new URLSearchParams(location.search || (location.hash.split("?")[1] || ""));
    for (const k of ["invite", "ref"]) { const v = q.get(k); if (v && /^[A-Za-z0-9-]{4,32}$/.test(v)) sessionStorage.setItem("mp_" + k, v); }
  } catch { /* storage unavailable */ }
  if (typeof Remote !== "undefined" && Remote.use && !Remote.__lc) {
    Remote.use(function inviteCarry(req, next) {
      const { method: m, path: p } = req; let b = req.body;
      if (m === "POST" && (p === "/api/auth/register" || p === "/api/auth/pi") && b && typeof b === "object") {
        try { const inv = sessionStorage.getItem("mp_invite"), ref = sessionStorage.getItem("mp_ref"); b = { ...b, ...(inv && !b.invite ? { invite: inv } : {}), ...(ref && !b.ref ? { ref } : {}) }; } catch { /* ignore */ }
        return next({ ...req, body: b }).catch((e) => { if (e.code === "invite_required") e.message += " — افتح «قائمة الانتظار» من صفحة التعريف (/about) لإدخال رمز دعوة."; throw e; });
      }
      return next(req);
    });
    Remote.__lc = true;
  }

  /* ---------- styles (incl. the design-review pass) ---------- */
  if (!document.getElementById("lc-css")) document.head.insertAdjacentHTML("beforeend", `<style id="lc-css">
.lc-search{display:flex;gap:6px;margin:0 0 12px}.lc-search input{flex:1}
.lc-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.lc-chips button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
.lc-item{display:block;color:inherit;text-decoration:none}.lc-item b{display:block}.lc-faq summary{cursor:pointer;font-weight:700;padding:4px 0;min-height:32px}.lc-faq p{margin:6px 0 2px;white-space:pre-line}
.lc-body{white-space:pre-line;line-height:1.8}.lc-badge{display:inline-block;font-size:12px;border-radius:999px;padding:2px 8px;border:1px solid var(--line);margin-inline-start:6px;vertical-align:middle}
.lc-badge.open,.lc-badge.pending{color:var(--accent)}.lc-badge.answered{color:#0a7d3b}.lc-badge.closed,.lc-badge.resolved{color:var(--muted)}.lc-badge.urgent,.lc-badge.high{color:#b42318}
.lc-msg{border-inline-start:3px solid var(--line);padding:6px 10px;margin:8px 0}.lc-msg.staff{border-color:var(--accent)}.lc-msg.internal{border-color:#b54708;background:rgba(181,71,8,.06)}
.lc-msg .muted{font-size:12px}.lc-att{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.lc-att img{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.lc-form label{display:block;font-weight:700;margin:10px 0 4px}.lc-form input,.lc-form textarea,.lc-form select{width:100%;box-sizing:border-box}.lc-form textarea{min-height:110px}
.lc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}.lc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:8px 0}
.lc-kpis div{border:1px solid var(--line);border-radius:12px;padding:10px;text-align:center}.lc-kpis b{display:block;font-size:20px}.lc-code{font-family:ui-monospace,monospace;direction:ltr;unicode-bidi:isolate;user-select:all}
.lc-hero{text-align:center;padding:24px 8px}.lc-mark{width:64px;height:64px;border-radius:20px;background:var(--grad);color:#fff;display:grid;place-items:center;margin:0 auto}.lc-mark .ic{width:32px;height:32px}.lc-hero h1{font-size:28px;margin:8px 0}.lc-hero p{font-size:16px}.lc-feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.lc-amb{font-size:.9em;margin-inline-start:4px}.lc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
/* design-review pass (phase 50): non-layout consistency only (no size/spacing change → visual baselines unaffected):
   one focus ring everywhere, form controls inherit the Arabic font, vertical-only textarea resize, bidi-isolated numbers, no image overflow */
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}input,textarea,select,button{font-family:inherit}textarea{resize:vertical}bdi,.num{unicode-bidi:isolate}.wrap img{max-width:100%}
</style>`);

  /* ======================= help center + FAQ ======================= */
  async function helpView(slug) {
    if (slug) return articleView(slug);
    const st = view._lcHelp ||= { q: "", cat: "" };
    page("مركز المساعدة", `<p class="u-m0 u-mb10 muted">ابحث في المقالات والأسئلة الشائعة، أو تواصل مع فريق الدعم.</p>
      <form class="lc-search" id="lc-hs" role="search"><label class="lc-sr" for="lc-hq">ابحث في مركز المساعدة</label><input id="lc-hq" type="search" value="${h(st.q)}" placeholder="مثال: ربط حساب Pi"><button class="btn">بحث</button></form>
      <div class="lc-chips" role="group" aria-label="التصنيفات"><button class="btn ghost" data-cat="" aria-pressed="${!st.cat}">الكل</button>${Object.entries(HCAT).map(([k, v]) => `<button class="btn ghost" data-cat="${k}" aria-pressed="${st.cat === k}">${v}</button>`).join("")}</div>
      <div id="lc-hl" aria-busy="true" aria-live="polite">${skel}</div>
      <div class="card lc-row"><a class="btn" href="#/tickets/new">تواصل مع الدعم</a><a class="btn ghost" href="#/tickets">تذاكري</a><a class="btn ghost" href="#/help">موارد الأمان والطوارئ</a></div>`, back("#/settings", "الإعدادات"));
    const t = view._lcT = {};
    $v("#lc-hs").addEventListener("submit", (e) => { e.preventDefault(); st.q = $v("#lc-hq").value.trim(); helpView(); });
    view.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => { st.cat = b.dataset.cat; helpView(); }));
    try {
      const r = await api("GET", `/api/helpcenter/articles?q=${enc(st.q)}&category=${enc(st.cat)}`); if (view._lcT !== t) return;
      const arts = r.items.filter((a) => a.kind === "article"), faqs = r.items.filter((a) => a.kind === "faq");
      const box = $v("#lc-hl"); box.removeAttribute("aria-busy");
      box.innerHTML = (!r.items.length ? `<div class="empty">لا نتائج${st.q ? ` لـ «${h(st.q)}»` : ""}. جرّب كلمات أخرى أو افتح تذكرة دعم.</div>` : "")
        + (arts.length ? `<h3>مقالات</h3>${arts.map((a) => `<a class="card lc-item" href="#/faq/${enc(a.slug)}"><b>${h(a.title)}</b><span class="muted">${h(a.summary)}</span></a>`).join("")}` : "")
        + (faqs.length ? `<h3>أسئلة شائعة</h3><div class="card">${faqs.map((a) => `<details class="lc-faq"><summary>${h(a.title)}</summary><p>${h(a.body)}</p></details>`).join("")}</div>` : "");
    } catch (e) { if (view._lcT === t) $v("#lc-hl").innerHTML = errBox(e); }
  }
  async function articleView(slug) {
    page("…", `<div id="lc-a">${skel}</div>`, back("#/faq", "مركز المساعدة"));
    try {
      const { article: a } = await api("GET", "/api/helpcenter/articles/" + enc(slug));
      $v("#lc-h").textContent = a.title; document.title = a.title + " — " + (window.MPI18n?.t ? window.MPI18n.t("مجتمع بلس") : "مجتمع بلس");
      $v("#lc-a").innerHTML = `<div class="card"><p class="muted">${h(HCAT[a.category] || "")}</p><div class="lc-body">${h(a.body)}</div></div><p class="muted">هل ما زلت تحتاج مساعدة؟ <a href="#/tickets/new">افتح تذكرة دعم</a></p>`;
    } catch (e) { $v("#lc-a").innerHTML = errBox(e); }
  }

  /* ======================= support tickets ======================= */
  const badge = (s) => `<span class="lc-badge ${h(s)}">${h(ST[s] || s)}</span>`;
  async function ticketsView(idv) {
    if (!online() || !DB.onboarded) return page("الدعم", `<div class="empty">سجّل الدخول لفتح تذكرة دعم.</div>`);
    if (idv === "new") return newTicket();
    if (idv) return threadView(idv);
    page("تذاكر الدعم", `<div class="u-m0 u-mb10 lc-row"><a class="btn" href="#/tickets/new">${UI.icon("plus", "sm")} تذكرة جديدة</a></div><div id="lc-tl" aria-busy="true">${skel}</div>`, back("#/faq", "مركز المساعدة"));
    try {
      const r = await api("GET", "/api/tickets"); const box = $v("#lc-tl"); box.removeAttribute("aria-busy");
      box.innerHTML = r.items.map((t) => `<a class="card lc-item" href="#/tickets/${enc(t.id)}"><b>${h(t.subject)} ${badge(t.status)}</b><span class="muted">${h(CAT[t.category] || "")} · آخر تحديث ${h(day(t.updatedAt))}</span></a>`).join("") || UI.empty({ title: "لا تذاكر بعد", text: "إن واجهت مشكلة، افتح تذكرة وسيرد عليك فريق الدعم هنا." });
    } catch (e) { $v("#lc-tl").innerHTML = errBox(e); }
  }
  const attField = (idp) => `<label for="${idp}">مرفقات (صور، حتى 4)</label><input id="${idp}" type="file" accept="image/*" multiple><div class="lc-att" id="${idp}-p"></div>`;
  function bindAtt(idp, list) {
    $v("#" + idp).addEventListener("change", async (e) => {
      for (const f of [...e.target.files].slice(0, 4 - list.length)) {
        try { const m = (await api("POST", "/api/media", null, f)).media; list.push(m.id); $v("#" + idp + "-p").insertAdjacentHTML("beforeend", `<img alt="مرفق" src="${h(m.url)}">`); } catch (er) { say(er.message); }
      }
      e.target.value = "";
    });
  }
  function newTicket() {
    const att = [];
    page("تذكرة دعم جديدة", `<form class="card lc-form" id="lc-tf"><label for="lc-ts">الموضوع</label><input id="lc-ts" required minlength="3" maxlength="140">
      <label for="lc-tc">التصنيف</label><select id="lc-tc">${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <label for="lc-tb">اشرح المشكلة</label><textarea id="lc-tb" required minlength="3" maxlength="5000" placeholder="ماذا حدث؟ ومتى؟ وما الذي جرّبته؟"></textarea>
      ${attField("lc-ta")}<p class="muted">لا تكتب كلمة المرور أو عبارة محفظة Pi أبداً.</p><div class="lc-row"><button class="btn" id="lc-tsub">إرسال</button></div></form>`, back("#/tickets", "تذاكري"));
    bindAtt("lc-ta", att);
    $v("#lc-tf").addEventListener("submit", async (e) => {
      e.preventDefault(); const b = $v("#lc-tsub"); b.disabled = true;
      try { const r = await api("POST", "/api/tickets", { subject: $v("#lc-ts").value, category: $v("#lc-tc").value, body: $v("#lc-tb").value, attachments: att }); say("تم إرسال التذكرة ✓"); location.hash = "#/tickets/" + r.ticket.id; }
      catch (er) { say(er.message); b.disabled = false; }
    });
  }
  async function threadView(idv, staffMode) {
    page("…", `<div id="lc-th">${skel}</div>`, back(staffMode ? "#/staff/tickets" : "#/tickets", staffMode ? "طابور الدعم" : "تذاكري"));
    let r; try { r = await api("GET", "/api/tickets/" + enc(idv)); } catch (e) { $v("#lc-th").innerHTML = errBox(e); return; }
    const c = await config(), st = !!c.staff, t = r.ticket, att = [];
    $v("#lc-h").innerHTML = `${h(t.subject)} ${badge(t.status)}${t.priority !== "normal" ? `<span class="lc-badge ${h(t.priority)}">${t.priority === "urgent" ? "عاجلة" : "مهمة"}</span>` : ""}`;
    $v("#lc-th").innerHTML = `${st && t.owner ? `<p class="muted">من <a href="#/u/${h(t.owner.handle)}">@${h(t.owner.handle)}</a> · ${h(CAT[t.category] || "")}</p>` : ""}
      ${r.messages.map((m) => `<div class="lc-msg${m.staff ? " staff" : ""}${m.internal ? " internal" : ""}"><div class="muted">${h(m.author?.name || "")}${m.internal ? " · ملاحظة داخلية" : ""} · ${h(day(m.createdAt))}</div><div class="lc-body">${h(m.body)}</div>
        ${m.attachments.length ? `<div class="lc-att">${m.attachments.map((a) => { const u = a.variants?.thumb || a.variants?.original || a.variants?.full; return u ? `<a href="${h(u)}" target="_blank" rel="noopener"><img alt="مرفق" src="${h(u)}"></a>` : ""; }).join("")}</div>` : ""}</div>`).join("")}
      ${t.status === "closed" && !st ? `<div class="empty">التذكرة مغلقة. <a href="#/tickets/new">افتح تذكرة جديدة</a></div>` : `<form class="card lc-form" id="lc-rf"><label for="lc-rb">ردّك</label><textarea id="lc-rb" required maxlength="5000"></textarea>${attField("lc-ra")}
        ${st ? `<label><input type="checkbox" id="lc-ri"> ملاحظة داخلية (لا يراها المستخدم)</label>` : ""}<div class="lc-row"><button class="btn" id="lc-rs">إرسال</button>
        ${st ? `<select id="lc-ss" aria-label="الحالة">${Object.entries(ST).map(([k, v]) => `<option value="${k}"${k === t.status ? " selected" : ""}>${v}</option>`).join("")}</select><select id="lc-sp" aria-label="الأولوية">${[["normal", "عادية"], ["high", "مهمة"], ["urgent", "عاجلة"]].map(([k, v]) => `<option value="${k}"${k === t.priority ? " selected" : ""}>${v}</option>`).join("")}</select><button type="button" class="btn ghost" id="lc-sset">حفظ الحالة</button><button type="button" class="btn ghost" id="lc-sme">إسناد إليّ</button>`
          : `<button type="button" class="btn ghost" id="lc-done">تم حل مشكلتي</button><button type="button" class="btn ghost" id="lc-close">إغلاق التذكرة</button>`}</div></form>`}`;
    const again = () => threadView(idv, staffMode);
    const form = view.querySelector("#lc-rf"); if (!form) return;
    bindAtt("lc-ra", att);
    form.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("POST", `/api/tickets/${enc(idv)}/messages`, { body: $v("#lc-rb").value, attachments: att, internal: !!$v("#lc-ri")?.checked }); say("تم الإرسال ✓"); again(); } catch (er) { say(er.message); } });
    const status = (s, p) => api("POST", `/api/tickets/${enc(idv)}/status`, { status: s, ...(p ? { priority: p } : {}) }).then(again, (er) => say(er.message));
    $v("#lc-done")?.addEventListener("click", () => status("resolved"));
    $v("#lc-close")?.addEventListener("click", () => status("closed"));
    $v("#lc-sset")?.addEventListener("click", () => status($v("#lc-ss").value, $v("#lc-sp").value));
    $v("#lc-sme")?.addEventListener("click", () => api("POST", `/api/staff/tickets/${enc(idv)}/assign`, { assignee: "me" }).then(again, (er) => say(er.message)));
  }

  /* ======================= ambassadors ======================= */
  async function ambassadorsView() {
    page("سفراء المجتمع", `<p class="u-m0 u-mb10 muted">السفراء أعضاء يرحّبون بالقادمين الجدد وينشرون ثقافة الحوار المحترم. يحصل السفير على شارة ورابط دعوة خاص وإحصاءات لمن انضم عن طريقه.</p><div id="lc-am" aria-busy="true">${skel}</div>`, back("#/settings", "الإعدادات"));
    const box = $v("#lc-am");
    if (!online() || !DB.onboarded) { box.innerHTML = `<div class="empty">سجّل الدخول للتقديم.</div>`; return; }
    let r; try { r = await api("GET", "/api/ambassadors/me"); } catch (e) { box.innerHTML = errBox(e); return; }
    box.removeAttribute("aria-busy");
    const a = r.ambassador;
    if (a?.status === "approved") {
      const link = `${location.origin}/?ref=${enc(a.refCode)}`, s = r.stats;
      box.innerHTML = `<div class="card"><b>${AST.approved}</b><p>رابط الإحالة الخاص بك:</p><p class="lc-code" id="lc-link">${h(link)}</p><div class="lc-row"><button class="btn ghost" id="lc-copy">نسخ الرابط</button></div></div>
        <div class="lc-kpis"><div><b class="num">${s.referrals}</b>انضموا عن طريقك</div><div><b class="num">${s.last30d}</b>آخر 30 يوماً</div><div><b class="num">${s.activeLast30d}</b>نشطون (30 يوماً)</div><div><b class="num">${s.invitesUsed}/${s.invitesIssued}</b>دعوات مستخدمة</div></div>
        <div class="card"><b>رموز الدعوة</b><p class="muted">تفيد عندما يكون التسجيل بالدعوة فقط. كل رمز يصلح لـ5 أشخاص لمدة 30 يوماً.</p>${r.invites.map((i) => `<p><span class="lc-code">${h(i.code)}</span> <span class="muted">${i.uses}/${i.maxUses}${i.revoked ? " · ملغى" : ""}</span></p>`).join("")}<div class="lc-row"><button class="btn ghost" id="lc-inv">رمز دعوة جديد</button></div></div>`;
      $v("#lc-copy").addEventListener("click", () => navigator.clipboard?.writeText(link).then(() => say("تم النسخ ✓"), () => say("انسخ الرابط يدوياً")));
      $v("#lc-inv").addEventListener("click", () => api("POST", "/api/ambassadors/me/invites").then(ambassadorsView, (er) => say(er.message)));
      return;
    }
    const status = a ? `<div class="card"><b>حالة طلبك: ${h(AST[a.status] || a.status)}</b>${a.note ? `<p class="muted">${h(a.note)}</p>` : ""}</div>` : "";
    if (a && ["pending", "revoked"].includes(a.status)) { box.innerHTML = status; return; }
    box.innerHTML = `${status}<form class="card lc-form" id="lc-af"><label for="lc-am1">لماذا تريد أن تكون سفيراً؟</label><textarea id="lc-am1" required minlength="20" maxlength="1500"></textarea>
      <label for="lc-am2">المدينة أو المنطقة (اختياري)</label><input id="lc-am2" maxlength="80"><label for="lc-am3">روابط لحساباتك أو مجتمعاتك (https، اختياري، سطر لكل رابط)</label><textarea id="lc-am3" rows="3" class="u-mh0"></textarea>
      <div class="lc-row"><button class="btn">إرسال الطلب</button></div></form>`;
    $v("#lc-af").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("POST", "/api/ambassadors/apply", { motivation: $v("#lc-am1").value, region: $v("#lc-am2").value || undefined, links: $v("#lc-am3").value.split(/\s+/).filter(Boolean) }); say("تم إرسال طلبك ✓"); ambassadorsView(); } catch (er) { say(er.message); } });
  }
  let ambSet = null;
  const ambassadors = () => (ambSet ||= (online() ? api("GET", "/api/ambassadors").then((r) => new Set(r.items.map((x) => x.handle))) : Promise.resolve(new Set())).catch(() => new Set()));
  function decorateProfile() {
    const m = /^#\/u\/([^/?]+)/.exec(location.hash) || (/^#\/me/.test(location.hash) && DB.me ? [0, (typeof S !== "undefined" && S.me?.()?.handle) || ""] : null);
    if (!m) return;
    ambassadors().then((set) => { if (!set.has(decodeURIComponent(m[1]))) return; const n = view.querySelector(".profile-top h2"); if (n && !n.querySelector(".lc-amb")) n.insertAdjacentHTML("beforeend", `<span class="lc-amb" title="سفير المجتمع" aria-label="سفير المجتمع"><svg class=ei aria-hidden=true><use href=#i-medal /></svg></span>`); });
  }

  /* ======================= waitlist + about ======================= */
  async function waitlistView() {
    const c = await config();
    page("قائمة الانتظار", `<p class="muted">${c.inviteRequired ? "التسجيل حالياً بالدعوة فقط أثناء الإطلاق التدريجي." : "التسجيل مفتوح للجميع الآن — يمكنك إنشاء حسابك مباشرة."}</p>
      <form class="card lc-form" id="lc-ic"><label for="lc-icv">لديك رمز دعوة؟</label><input id="lc-icv" class="lc-code" placeholder="XXXX-XXXX" maxlength="32" autocomplete="off"><div class="lc-row"><button class="btn">استخدام الرمز</button></div><p class="muted" id="lc-icm" aria-live="polite"></p></form>
      <form class="card lc-form" id="lc-wf"><label for="lc-wc">بريدك الإلكتروني أو اسم مستخدم Pi</label><input id="lc-wc" maxlength="120" ${online() && DB.onboarded ? "disabled placeholder=\"سنستخدم حسابك الحالي\"" : "required"}><label for="lc-wn">الاسم (اختياري)</label><input id="lc-wn" maxlength="50">
        <div class="lc-row"><button class="btn">انضم إلى قائمة الانتظار</button></div><p class="muted" id="lc-wm" aria-live="polite"></p><p class="muted">نستخدم بياناتك فقط لإرسال الدعوة، وتُحذف بعد انتهاء الإطلاق التدريجي.</p></form>`, back("#/about", "عن مجتمع بلس"));
    $v("#lc-ic").addEventListener("submit", async (e) => {
      e.preventDefault(); const code = $v("#lc-icv").value.trim().toUpperCase(), out = $v("#lc-icm");
      try { const r = await api("GET", "/api/launch/invites/" + enc(code)); if (!r.valid) { out.textContent = { used: "استُخدم هذا الرمز بالكامل.", expired: "انتهت صلاحية الرمز.", revoked: "أُلغي هذا الرمز." }[r.reason] || "رمز غير صحيح."; return; }
        try { sessionStorage.setItem("mp_invite", code); } catch { /* ignore */ } out.textContent = "الرمز صالح ✓ — أنشئ حسابك الآن أو سجّل بحساب Pi."; } catch (er) { out.textContent = er.message; }
    });
    $v("#lc-wf").addEventListener("submit", async (e) => {
      e.preventDefault(); const out = $v("#lc-wm");
      try { let ref; try { ref = sessionStorage.getItem("mp_ref") || undefined; } catch { /* ignore */ }
        const r = await api("POST", "/api/launch/waitlist", { contact: $v("#lc-wc").value || undefined, name: $v("#lc-wn").value || undefined, ref });
        out.textContent = r.position ? `${r.already ? "أنت مسجّل بالفعل" : "تم تسجيلك ✓"} — ترتيبك ${r.position.toLocaleString("ar-EG")} في القائمة.` : "تمت دعوتك بالفعل ✓"; } catch (er) { out.textContent = er.message; }
    });
  }
  function aboutView() {
    page("عن مجتمع بلس", `<div class="lc-hero"><span class="lc-mark" aria-hidden="true">${UI.icon("plus")}</span><h1>مجتمع بلس</h1><p>منصة اجتماعية عربية على Pi Network: مجتمعات حقيقية، حوار محترم، وتحكم كامل في خصوصيتك.</p>
      <div class="u-jcc lc-row"><a class="btn" href="#/home">ابدأ الآن</a><a class="btn ghost" href="#/waitlist">قائمة الانتظار ورموز الدعوة</a></div></div>
      <div class="list">${[["users", "مجتمعات", "انضم إلى مجتمعات حول اهتماماتك أو أنشئ مجتمعك بقواعدك ومشرفيك."], ["shield", "أمان أولاً", "حظر وكتم وإبلاغ بلمسة، وحماية خاصة للقُصّر، ومراجعة بشرية للبلاغات."], ["award", "Pi Network", "ادعم صناع المحتوى، وتسوّق في سوق المجتمع، وادفع بأمان عبر نافذة Pi الرسمية."], ["lock", "خصوصيتك", "رسائل مشفرة، وتنزيل بياناتك أو حذف حسابك في أي وقت، ودون تتبع إعلاني."], ["globe", "عربي أولاً", "واجهة عربية كاملة مع الإنجليزية."], ["star", "سفراء المجتمع", "أعضاء يرحّبون بالقادمين الجدد. <a href=\"#/ambassadors\">كن سفيراً</a>"]]
        .map(([i, t, d]) => `<div class="li"><span class="ico">${UI.icon(i, "sm")}</span><span class="t"><b>${t}</b><small>${d}</small></span></div>`).join("")}</div>
      <div class="card lc-row"><a href="#/faq">مركز المساعدة</a><a href="#/legal">الشروط والخصوصية</a><a href="#/transparency">تقارير الشفافية</a></div>`);
    document.title = window.MPI18n?.t ? window.MPI18n.t("عن مجتمع بلس") : "عن مجتمع بلس";
  }

  /* ======================= staff screens ======================= */
  const staffGate = async () => { const c = await config(true); if (!c.staff) { page("غير مسموح", `<div class="empty">هذه الصفحة لفريق الدعم فقط.</div>`); return false; } return true; };
  const tabs = (cur) => `<div class="lc-chips">${[["tickets", "التذاكر"], ["help", "المقالات"], ["ambassadors", "السفراء"], ["launch", "الإطلاق"]].map(([k, v]) => `<a class="btn ghost" href="#/staff/${k}" aria-current="${k === cur ? "page" : "false"}">${v}</a>`).join("")}</div>`;
  async function staffView(a, b) {
    if (!(await staffGate())) return;
    if (a === "tickets" && b) return threadView(b, true);
    if (a === "help") return staffHelp(b);
    if (a === "ambassadors") return staffAmb();
    if (a === "launch") return staffLaunch();
    const st = view._lcQ ||= { status: "" };
    page("طابور الدعم", tabs("tickets") + `<div class="lc-chips">${[["", "المفتوحة"], ["answered", "تم الرد"], ["resolved", "تم الحل"], ["closed", "مغلقة"], ["all", "الكل"]].map(([k, v]) => `<button class="btn ghost" data-st="${k}" aria-pressed="${st.status === k}">${v}</button>`).join("")}</div><div id="lc-q">${skel}</div>`, back("#/admin", "الإدارة"));
    view.querySelectorAll("[data-st]").forEach((x) => x.addEventListener("click", () => { st.status = x.dataset.st; staffView("tickets"); }));
    try {
      const r = await api("GET", "/api/staff/tickets?status=" + enc(st.status));
      $v("#lc-q").innerHTML = `<p class="muted">${Object.entries(r.counts).map(([k, n]) => `${h(ST[k] || k)}: ${n}`).join(" · ") || "لا تذاكر"}</p>` + (r.items.map((t) => `<a class="card lc-item" href="#/staff/tickets/${enc(t.id)}"><b>${h(t.subject)} ${badge(t.status)}${t.priority !== "normal" ? `<span class="lc-badge ${h(t.priority)}">${t.priority === "urgent" ? "عاجلة" : "مهمة"}</span>` : ""}</b><span class="muted">@${h(t.owner?.handle)} · ${h(CAT[t.category] || "")} · ${h(day(t.updatedAt))}${t.lastBy === "user" ? " · بانتظار ردّنا" : ""}</span></a>`).join("") || `<div class="empty">لا تذاكر هنا.</div>`);
    } catch (e) { $v("#lc-q").innerHTML = errBox(e); }
  }
  async function staffHelp(editId) {
    page("مقالات مركز المساعدة", tabs("help") + `<div id="lc-se">${skel}</div>`, back("#/admin", "الإدارة"));
    let r; try { r = await api("GET", "/api/helpcenter/articles?all=1"); } catch (e) { $v("#lc-se").innerHTML = errBox(e); return; }
    const cur = r.items.find((x) => x.id === editId);
    const full = cur ? (await api("GET", "/api/helpcenter/articles/" + enc(cur.slug))).article : null;
    $v("#lc-se").innerHTML = `<form class="card lc-form" id="lc-ef"><b>${full ? "تعديل: " + h(full.title) : "مقالة أو سؤال جديد"}</b>
      <label for="lc-e1">العنوان</label><input id="lc-e1" required maxlength="160" value="${h(full?.title)}"><label for="lc-e2">الملخص (للمقالات)</label><input id="lc-e2" maxlength="300" value="${h(full?.summary)}">
      <label for="lc-e3">المحتوى</label><textarea id="lc-e3" required maxlength="20000">${h(full?.body)}</textarea>
      <div class="lc-row"><select id="lc-e4" aria-label="النوع"><option value="article">مقالة</option><option value="faq"${full?.kind === "faq" ? " selected" : ""}>سؤال شائع</option></select>
      <select id="lc-e5" aria-label="التصنيف">${Object.entries(HCAT).map(([k, v]) => `<option value="${k}"${full?.category === k ? " selected" : ""}>${v}</option>`).join("")}</select>
      <select id="lc-e6" aria-label="الحالة"><option value="published">منشورة</option><option value="draft"${full?.status === "draft" ? " selected" : ""}>مسودة</option></select>
      <input id="lc-e7" aria-label="المعرّف في الرابط" placeholder="slug" class="u-wa lc-code" value="${h(full?.slug)}"></div>
      <div class="lc-row"><button class="btn">حفظ</button>${full ? `<a class="btn ghost" href="#/staff/help">جديد</a><button type="button" class="btn ghost" id="lc-edel">حذف</button>` : ""}</div></form>
      ${r.items.map((x) => `<a class="card lc-item" href="#/staff/help/${enc(x.id)}"><b>${h(x.title)} <span class="lc-badge">${x.kind === "faq" ? "سؤال" : "مقالة"}</span>${x.status === "draft" ? '<span class="lc-badge">مسودة</span>' : ""}</b><span class="muted">${h(HCAT[x.category] || "")} · ${h(x.slug)}</span></a>`).join("")}`;
    $v("#lc-ef").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { title: $v("#lc-e1").value, summary: $v("#lc-e2").value, body: $v("#lc-e3").value, kind: $v("#lc-e4").value, category: $v("#lc-e5").value, status: $v("#lc-e6").value, ...($v("#lc-e7").value ? { slug: $v("#lc-e7").value } : {}) };
      try { const o = full ? await api("PUT", "/api/admin/helpcenter/articles/" + enc(full.id), body) : await api("POST", "/api/admin/helpcenter/articles", body); say("تم الحفظ ✓"); location.hash = "#/staff/help/" + o.article.id; if (full) staffHelp(full.id); } catch (er) { say(er.message); }
    });
    $v("#lc-edel")?.addEventListener("click", async () => { if (!confirm("حذف هذه المقالة نهائياً؟")) return; try { await api("DELETE", "/api/admin/helpcenter/articles/" + enc(full.id)); location.hash = "#/staff/help"; } catch (er) { say(er.message); } });
  }
  async function staffAmb() {
    const st = view._lcA ||= "pending";
    page("طلبات السفراء", tabs("ambassadors") + `<div class="lc-chips">${Object.entries(AST).map(([k, v]) => `<button class="btn ghost" data-as="${k}" aria-pressed="${st === k}">${v}</button>`).join("")}</div><div id="lc-al">${skel}</div>`, back("#/admin", "الإدارة"));
    view.querySelectorAll("[data-as]").forEach((x) => x.addEventListener("click", () => { view._lcA = x.dataset.as; staffAmb(); }));
    try {
      const r = await api("GET", "/api/admin/ambassadors?status=" + st);
      $v("#lc-al").innerHTML = r.items.map((a) => `<div class="card"><b><a href="#/u/${h(a.handle)}">${h(a.name)} @${h(a.handle)}</a></b><p class="lc-body">${h(a.motivation)}</p><p class="muted">${h(a.region || "")} ${a.links.map((l) => `<a href="${h(l)}" target="_blank" rel="noopener nofollow">${h(l)}</a>`).join(" ")}</p>
        ${a.stats ? `<p class="muted">إحالات: ${a.stats.referrals} · نشطون: ${a.stats.activeLast30d} · دعوات: ${a.stats.invitesUsed}/${a.stats.invitesIssued}</p>` : ""}
        <div class="lc-row">${st === "pending" ? `<button class="btn" data-dec="approve" data-u="${h(a.userId)}">قبول</button><button class="btn ghost" data-dec="reject" data-u="${h(a.userId)}">رفض</button>` : st === "approved" ? `<button class="btn ghost" data-dec="revoke" data-u="${h(a.userId)}">إلغاء العضوية</button>` : ""}</div></div>`).join("") || `<div class="empty">لا طلبات.</div>`;
      view.querySelectorAll("[data-dec]").forEach((x) => x.addEventListener("click", async () => {
        const note = x.dataset.dec === "approve" ? undefined : prompt("سبب القرار (يُرسل لصاحب الطلب):"); if (note === null) return;
        try { await api("POST", `/api/admin/ambassadors/${enc(x.dataset.u)}/review`, { decision: x.dataset.dec, note }); say("تم ✓"); staffAmb(); } catch (er) { say(er.message); }
      }));
    } catch (e) { $v("#lc-al").innerHTML = errBox(e); }
  }
  async function staffLaunch() {
    page("الإطلاق التدريجي", tabs("launch") + `<div id="lc-ls">${skel}</div>`, back("#/admin", "الإدارة"));
    try {
      const [s, w, inv] = await Promise.all([api("GET", "/api/launch/stats"), api("GET", "/api/admin/launch/waitlist"), api("GET", "/api/admin/launch/invites")]);
      $v("#lc-ls").innerHTML = `<p>وضع التسجيل: <b>${s.mode === "invite" ? "بالدعوة فقط" : "مفتوح للجميع"}</b> <span class="muted">(يُضبط بمتغير البيئة LAUNCH_MODE)</span></p>
        <div class="lc-kpis"><div><b>${s.users}</b>حساب نشط</div><div><b>${s.waitlist}</b>في الانتظار</div><div><b>${s.invited}</b>تمت دعوتهم</div><div><b>${s.invitesRedeemed}</b>دعوات مستخدمة</div><div><b>${s.ambassadors}</b>سفير</div><div><b>${s.ticketsOpen}</b>تذكرة مفتوحة</div></div>
        <div class="card lc-row"><label for="lc-ln">ادعُ أول</label><input id="lc-ln" type="number" min="1" max="200" value="10" style="width:80px"><span>من قائمة الانتظار</span><button class="btn" id="lc-lnext">إصدار الدعوات</button></div>
        <div class="card lc-row"><label for="lc-gc">رموز عامة:</label><input id="lc-gc" type="number" min="1" max="100" value="5" style="width:70px"><label for="lc-gu">استخدامات لكل رمز</label><input id="lc-gu" type="number" min="1" max="10000" value="1" style="width:80px"><button class="btn ghost" id="lc-gen">إنشاء</button></div>
        <div id="lc-out" aria-live="polite"></div><h3>قائمة الانتظار</h3>${w.items.slice(0, 100).map((x) => `<p>${h(x.contact)} <span class="muted">${h(x.name || "")} · ${h(day(x.createdAt))}</span></p>`).join("") || '<p class="muted">فارغة</p>'}
        <h3>آخر الرموز</h3>${inv.items.slice(0, 50).map((i) => `<p><span class="lc-code">${h(i.code)}</span> <span class="muted">${i.uses}/${i.maxUses}${i.revoked ? " · ملغى" : ""}${i.note ? " · " + h(i.note) : ""}</span></p>`).join("")}`;
      const show = (rows) => { $v("#lc-out").innerHTML = `<div class="card"><b>انسخ الرموز وأرسلها يدوياً:</b>${rows.map((x) => `<p><span class="lc-code">${h(x)}</span></p>`).join("")}</div>`; };
      $v("#lc-lnext").addEventListener("click", async () => { try { const r = await api("POST", "/api/admin/launch/waitlist/next/invite", { count: +$v("#lc-ln").value }); show(r.invited.map((x) => `${x.contact} → ${x.code}`)); } catch (er) { say(er.message); } });
      $v("#lc-gen").addEventListener("click", async () => { try { show((await api("POST", "/api/admin/launch/invites", { count: +$v("#lc-gc").value, maxUses: +$v("#lc-gu").value })).codes); } catch (er) { say(er.message); } });
    } catch (e) { $v("#lc-ls").innerHTML = errBox(e); }
  }

  /* ======================= routing + entry points ======================= */
  const card = (idv, href, icon, title, sub) => `<a class="u-dflex u-aic u-g12 card lc-item" id="${idv}" href="${href}"><span aria-hidden="true" class="u-t-3xl">${icon}</span><span class="u-f1"><b>${title}</b><span class="muted">${sub}</span></span><span class="fwd" aria-hidden="true">←</span></a>`;
  const setCard = () => { if (/^#\/settings\/?(\?|$)/.test(location.hash) && !document.getElementById("lc-set")) (view.querySelector(".wrap") || view).insertAdjacentHTML("beforeend", `<div class="card" id="lc-set"><h3 class="u-m0 u-mb8 u-t-lg"><svg class="ic hi" aria-hidden="true"><use href="#i-comment"/></svg>المساعدة والمجتمع</h3><div class="u-m0 lc-row"><a class="btn ghost" href="#/faq">مركز المساعدة</a><a class="btn ghost" href="#/tickets">تذاكر الدعم</a><a class="btn ghost" href="#/ambassadors">سفراء المجتمع</a><a class="btn ghost" href="#/about">عن التطبيق</a></div></div>`); };
  if (typeof Views !== "undefined" && Views.settings) { MPSettings.add(function () { setCard(); }); }
  if (typeof Views !== "undefined" && Views.profile) { const _p = Views.profile; Views.profile = function () { const r = _p.apply(this, arguments); decorateProfile(); return r; }; }
  MPRoutes.extend((a, b, prev) => {
    return { faq: () => helpView(a), tickets: () => ticketsView(a), ambassadors: () => ambassadorsView(), waitlist: () => waitlistView(), about: () => aboutView(), staff: () => staffView(a || "tickets", b) };
  });
  MPRoutes.add("admin", (a, b, next) => {
        next();
        if (!a) config(true).then((c) => { if (c.staff && location.hash === "#/admin" && !document.getElementById("lc-adm")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", card("lc-adm", "#/staff/tickets", "<svg class=ei aria-hidden=true><use href=#i-headset /></svg>", "الدعم والإطلاق", "طابور التذاكر، مقالات المساعدة، السفراء، قائمة الانتظار والدعوات")); });
      });
  /* signed-out visitors (onboarding screen) can still open the landing page, the waitlist and the help center */
  const PUBLIC = /^#\/(about|waitlist|faq)(\/|$|\?)/;
  const pub = () => { if (typeof DB === "undefined" || DB.onboarded || !PUBLIC.test(location.hash)) return false; const [r, a] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/"); ({ about: aboutView, waitlist: waitlistView, faq: () => helpView(a) })[r](); return true; };
  if (typeof route === "function") { const _r = route; route = function () { if (pub()) return; return _r.apply(this, arguments); }; }
  addEventListener("hashchange", () => setTimeout(pub, 0));
  // v2.51: on /about this chunk now loads before boot finishes, so the guest auth screen (showAuth → MPSession "out") would paint
  // over the landing; re-show the public page right after it (same result as v2.50, where the chunk simply arrived later).
  addEventListener("mp:session", (e) => { if (e.detail === "out") setTimeout(pub, 0); });
  window.MPLaunch = { help: helpView, tickets: ticketsView, ambassadors: ambassadorsView, waitlist: waitlistView, about: aboutView, staff: staffView, config };
  if (location.pathname === "/about" && !location.hash) { history.replaceState(null, "", "/#/about"); pub(); }
  if (/^#\/(faq|tickets|ambassadors|waitlist|about|staff)(\/|$|\?)/.test(location.hash) && typeof route === "function" && typeof DB !== "undefined" && DB.onboarded) route();
  else if (/^#\/settings\/?(\?|$)/.test(location.hash)) setCard();
  else if (!pub()) decorateProfile();
})();
