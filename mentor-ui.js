/* =====================================================================
 * مجتمع بلس — Phase 74 UI: mentorship «الإرشاد» (lazy "mentor" chunk + mentor.css; 0 bytes in core).
 *   #/mentors[?tab=find|sessions|requests|family]   discover + «اقترح لي مرشداً», my sessions (+ calendar feed), my requests,
 *                                                   sessions of guardian-linked minors
 *   #/mentor/:handle                                 expert profile: rating, topics, slot picker + booking, direct request, reviews
 *   #/msession/:id                                   one session: time in my zone, actions, live room, notes, rating, .ics
 *   #/mentoring[?tab=sessions|requests|insights|profile|availability]  mentor dashboard: confirm, requests (direct + open), profile, weekly grid
 *   #/admin/mentors                                  staff: totals, refund-due paid sessions, low-rated mentors, suspend / restore
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function MentorUI() {
  if (window.MPMentor) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  /* M1-5: user-written text (names, headlines, goals, replies, comments) → own node with dir=auto, never run through the UI translator */
  const u = (s) => `<bdi dir="auto" data-noi18n>${h(s)}</bdi>`;
  const lt = (s) => `<bdi dir="ltr" data-noi18n>${h(s)}</bdi>`;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => UI.icon(n, c);
  const num = (n, o) => UI.num(n, o);
  const lang = () => (typeof DB !== "undefined" && DB.settings && DB.settings.lang) || "ar";
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const fmt = (iso, o) => { try { return new Intl.DateTimeFormat(lang(), { numberingSystem: "latn", ...o }).format(new Date(iso)); } catch { return new Date(iso).toLocaleString(); } };
  const dayLong = (iso) => fmt(iso, { weekday: "long", day: "numeric", month: "long" });
  const timeOf = (iso) => fmt(iso, { hour: "numeric", minute: "2-digit" });
  const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const myTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh"; } catch { return "Asia/Riyadh"; } })();
  const errBox = (e) => UI.empty({ title: "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم" });
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const WD = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const PAY = { pending: "بانتظار الدفع", held: "محفوظة حتى الإتمام", released: "حُوّلت للمرشد", refund_due: "تُعاد إليك", refunded: "أُعيدت" };
  const TONE = { pending: "warn", confirmed: "ok", completed: "info", cancelled: "bad", no_show: "bad", open: "warn", accepted: "ok", declined: "bad", withdrawn: "", closed: "" };
  const badge = (tone, t) => `<span class="sbadge ${tone || ""}">${h(t)}</span>`;
  const tr = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s); /* strings the DOM translator never reaches: prompt(), textarea placeholders */
  const avUrl = (u, cls) => { const a = u?.avatar; if (typeof a === "string") return /^(\/(?!\/)|https:\/\/)/.test(a) ? a : null; return a && typeof avSrc === "function" ? avSrc(u, cls) || null : null; };
  const av = (u, cls = "") => { const src = avUrl(u, cls); return `<span class="mt-av ${cls}" aria-hidden="true" data-noi18n>${src ? `<img src="${h(src)}" alt="" loading="lazy" decoding="async">` : h(String(u?.name || "؟").trim()[0] || "؟")}</span>`; };
  const stars = (r) => (r && r.count ? `<span class="mt-rate">${ic("star", "xs")}${num(r.avg, { maximumFractionDigits: 1 })}<span class="u-c-mu u-fw6">(${num(r.count)})</span></span>` : `<span class="u-c-mu">جديد</span>`);
  /* M5-2: staff-review badge (server sends a boolean only) */
  const revBadge = (m, cls = "") => (m.reviewed ? `<span class="sbadge ok mt-rev ${cls}">${ic("check", "xs")}<span>مراجَع من الفريق</span></span>` : "");
  const price = (m) => (m.paid ? badge(m.bookable ? "info" : "warn", `${num(m.price)} Pi`) : badge("ok", "مجاني"));
  const page = (head, body) => { view.innerHTML = `<div class="wrap mt-page">${UI.pageHead({ ...head, id: "mt-h" })}${body}</div>`; $("#mt-h")?.focus({ preventScroll: true }); };
  const seg = (base, tabs, cur, label) => `<nav class="seg u-mb12" aria-label="${h(label)}">${tabs.map(([k, t]) => `<a href="${base}${base.includes("?") ? "&" : "?"}tab=${k}" ${cur === k ? 'aria-current="page"' : ""}>${h(t)}</a>`).join("")}</nav>`;
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  /* M4-3 «حفظ»: bookmark toggle (aria-pressed), shared by the profile page, directory cards and the saved list */
  const saveBtn = (handle, on, card) => card
    ? `<button class="icon-btn mt-save mt-save-c" type="button" data-msave="${h(handle)}" aria-pressed="${!!on}" aria-label="حفظ المرشد" title="حفظ المرشد">${ic(on ? "bookmarkF" : "bookmark")}</button>`
    : `<button class="btn outline mt-save" type="button" data-msave="${h(handle)}" aria-pressed="${!!on}">${ic(on ? "bookmarkF" : "bookmark")}<span>حفظ</span></button>`;
  const wireSave = (root, after) => root.querySelectorAll("[data-msave]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const on = b.getAttribute("aria-pressed") === "true";
    const r = await api(on ? "DELETE" : "POST", `/api/mentors/${enc(b.dataset.msave)}/save`);
    b.setAttribute("aria-pressed", String(!!r.saved)); const svg = b.querySelector("svg"); if (svg) svg.outerHTML = ic(r.saved ? "bookmarkF" : "bookmark");
    say(r.saved ? "حُفظ المرشد — نُبلغك حين يفتح مواعيد جديدة" : "أُزيل من المحفوظين"); if (after) after(r);
  })));
  const payIntent = async (intent, refId, amount, memo) => {
    try { if (window.MPChunks) await MPChunks.load("pi"); } catch { /* offline */ }
    if (!window.MPPi?.pay) { say("افتح التطبيق داخل متصفح Pi لإتمام الدفع"); return false; }
    try { await MPPi.pay({ amount, memo, purpose: "mentor", refId, intent: async () => intent }); return true; } catch (e) { say(e.message || "لم يكتمل الدفع"); return false; }
  };

  /* =================== #/mentors =================== */
  async function hub() {
    const tab = qs().get("tab") || "find";
    const tabs = [["find", "اكتشف"], ["sessions", "جلساتي"], ["requests", "طلباتي"]];
    if (tab === "family") tabs.push(["family", "العائلة"]);
    page({ title: "الإرشاد", icon: "users", sub: "تعلّم من أصحاب الخبرة: جلسات فردية مباشرة بمواعيد تناسبك.", actions: signed() ? `<a class="btn outline sm" href="#/mentoring">${ic("cap")}لوحة المرشد</a>` : "", row: true },
      `${seg("#/mentors", tabs, tab, "أقسام الإرشاد")}<div id="mt-b">${skel(4)}</div>`);
    const box = () => $("#mt-b");
    try {
      if (tab === "sessions") return await sessionsTab(box());
      if (tab === "requests") return await requestsTab(box());
      if (tab === "family") return await familyTab(box());
      return await findTab(box());
    } catch (e) { if (box()) box().innerHTML = errBox(e); }
  }
  const mentorCard = (m) => `<li class="mt-cardw${m.saved !== undefined ? " has-save" : ""}"><a class="f-card mt-card" href="#/mentor/${enc(m.user.handle)}"><span class="hd">${av(m.user)}<span class="u-f1 u-mw0"><b>${u(m.user.name)}</b><small>${lt("@" + m.user.handle)}</small>${revBadge(m)}</span>${price(m)}</span><p dir="auto" data-noi18n>${h(m.headline)}</p><ul class="mt-tags">${m.topics.slice(0, 3).map((t) => `<li><span class="chip">${h(t.label)}</span></li>`).join("")}</ul><span class="ft">${stars(m.rating)}${m.sessions ? `<span>${num(m.sessions)} جلسة</span>` : ""}<span>${num(m.minutes)} دقيقة</span>${m.hasSlots ? "" : `<span>لا مواعيد بعد</span>`}</span></a>${m.saved !== undefined ? saveBtn(m.user.handle, m.saved, true) : ""}</li>`;
  async function findTab(box) {
    const p = qs(), topic = p.get("topic") || "", text = p.get("q") || "", priceF = p.get("price") || "";
    const d = await api("GET", `/api/mentors?topic=${enc(topic)}&q=${enc(text)}&price=${enc(priceF)}`);
    if (!box.isConnected) return;
    const opts = Object.entries(d.topics).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("");
    box.innerHTML = `${signed() ? `<section class="f-cover mt-match"><div><h3>اقترح لي مرشداً</h3><small>اختر الموضوع واكتب هدفك، ونرشّح لك أنسب ثلاثة مع السبب.</small></div>
        <form id="mt-mf"><label><span class="vh">الموضوع</span><select name="topic" required><option value="">الموضوع…</option>${opts}</select></label><label><span class="vh">هدفك</span><input name="goal" dir="auto" maxlength="200" placeholder="مثلاً: أبني أول تطبيق ويب خلال شهر"></label><button class="btn" type="submit">${ic("sparkle")}رشّح لي</button></form><div id="mt-mr" aria-live="polite"></div></section>` : ""}
      ${d.minor ? `<div class="notice">${ic("shield")}<span>تظهر لك المرشدات والمرشدون الذين يقبلون من هم دون ١٨ سنة، والجلسات المجانية فقط. يُبلَّغ وليّ أمرك بكل حجز.</span></div>` : ""}
      <form class="fx-q" id="mt-sf" role="search"><label><span class="vh">ابحث</span><input type="search" name="q" dir="auto" value="${h(text)}" placeholder="ابحث باسم أو مهارة" maxlength="60"></label>
        <label id="mt-pf">السعر<select name="price"><option value="">الكل</option><option value="free" ${priceF === "free" ? "selected" : ""}>مجاني</option><option value="paid" ${priceF === "paid" ? "selected" : ""}>مدفوع بـ Pi</option></select></label><button class="btn" type="submit">بحث</button></form>
      <ul class="f-chips" aria-label="المواضيع"><li><a class="chip f" href="#/mentors?tab=find" ${!topic ? 'aria-current="true"' : ""}>الكل</a></li>${Object.entries(d.topics).filter(([k]) => d.counts[k]).map(([k, v]) => `<li><a class="chip f" href="#/mentors?tab=find&topic=${k}" ${topic === k ? 'aria-current="true"' : ""}>${h(v)} <span class="n">${num(d.counts[k])}</span></a></li>`).join("")}</ul>
      ${!d.piEnabled ? `<p class="f-hint u-mb8">الجلسات المدفوعة بـ Pi متوقفة حتى تفعيل مدفوعات Pi؛ الإرشاد المجاني متاح الآن.</p>` : ""}
      ${d.mentors.length ? `<ul class="f-grid mt-grid">${d.mentors.map(mentorCard).join("")}</ul>` : UI.empty({ title: topic || text ? "لا نتائج مطابقة" : "لا يوجد مرشدون بعد", text: topic || text ? "جرّب موضوعاً آخر أو اكتب طلباً مفتوحاً يراه المرشدون." : "كن أول من يشارك خبرته مع المجتمع.", action: `<a class="btn" href="${topic || text ? "#/mentors?tab=requests" : "#/mentoring"}">${topic || text ? "اكتب طلباً مفتوحاً" : "كن مرشداً"}</a>` })}`;
    wireSave(box);
    const sf = $("#mt-sf");
    sf.addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(sf); location.hash = `#/mentors?tab=find${topic ? "&topic=" + enc(topic) : ""}&q=${enc(f.get("q") || "")}&price=${enc(f.get("price") || "")}`; });
    window.MPFeat?.filters?.({ host: sf, move: [$("#mt-pf")], form: sf, title: "تصفية", defaults: { price: "" } });
    $("#mt-mf")?.addEventListener("submit", async (e) => {
      e.preventDefault(); const f = new FormData(e.target), out = $("#mt-mr"); if (!f.get("topic")) return;
      out.innerHTML = `<div class="skel row"></div>`;
      try {
        const r = await api("GET", `/api/mentors/match?topic=${enc(f.get("topic"))}&goal=${enc(f.get("goal") || "")}`);
        out.innerHTML = r.matches.length ? `<ul class="list u-mt8">${r.matches.map((x) => `<li><a class="li" href="#/mentor/${enc(x.mentor.user.handle)}">${av(x.mentor.user)}<span class="t"><b>${u(x.mentor.user.name)} ${x.mentor.rating?.count ? `<span>· ${num(x.mentor.rating.avg, { maximumFractionDigits: 1 })}</span>` : ""}</b><small><span>${h(x.reasons.slice(0, 3).join(" · "))}</span>${x.nextSlot ? `<span> · أقرب موعد </span><span>${h(dayLong(x.nextSlot))} ${h(timeOf(x.nextSlot))}</span>` : ""}</small></span><span class="chev" aria-hidden="true">←</span></a></li>`).join("")}</ul>`
          : `<p class="u-m0">لا يوجد مرشد متاح في «<b>${h(r.topic.label)}</b>» الآن. <a class="u-fw7" href="#/mentors?tab=requests&topic=${enc(r.topic.key)}">اكتب طلباً مفتوحاً</a> وسيصلك ردّ حين يتوفر مرشد.</p>`;
      } catch (er) { out.textContent = er.message; }
    });
  }
  const sessionRow = (s) => { const other = s.role === "mentor" ? s.learner : s.mentor; return `<li><a class="li" href="#/msession/${enc(s.id)}">${av(other)}<span class="t"><b>${h(dayLong(s.startsAt))} · ${h(timeOf(s.startsAt))}</b><small>${s.role === "guardian" ? `${u(s.learner?.name)} ` : ""}<span>${s.role === "mentor" ? "مع المتعلّم" : "مع"}</span> ${u(other?.name)} · <span>${h(s.topic.label)}</span>${s.minor ? "<span> · بإشراف وليّ الأمر</span>" : ""}</small></span>${badge(TONE[s.status], s.statusLabel)}</a></li>`; };
  async function sessionsTab(box) {
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول", text: "لترى جلساتك وتحجز مع المرشدين.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    const when = qs().get("when") === "past" ? "past" : "upcoming";
    const d = await api("GET", `/api/mentor/sessions?when=${when}`); if (!box.isConnected) return;
    box.innerHTML = `<div class="seg u-mb12" role="group" aria-label="الفترة"><button type="button" data-w="upcoming" aria-pressed="${when === "upcoming"}">القادمة</button><button type="button" data-w="past" aria-pressed="${when === "past"}">السابقة</button></div>
      ${d.sessions.length ? `<ul class="list">${d.sessions.map(sessionRow).join("")}</ul>` : UI.empty({ title: when === "past" ? "لا جلسات سابقة" : "لا جلسات قادمة", text: "اختر مرشداً واحجز موعداً يناسبك.", action: `<a class="btn" href="#/mentors">اكتشف المرشدين</a>` })}
      ${d.family ? `<div class="list u-mt12"><a class="li" href="#/mentors?tab=family">${ic("shield")}<span class="t"><b>جلسات الحسابات المرتبطة</b><small>بصفتك وليّ أمر</small></span><span class="chev" aria-hidden="true">←</span></a></div>` : ""}
      <div class="f-h">التقويم</div><div class="card"><p class="u-mt0 u-t-sm">أضف جلساتك إلى أي تطبيق تقويم برابط خاص بك. لا يحتوي الرابط على ملاحظاتك، ويمكنك تغييره متى شئت.</p><div id="mt-feed"><button class="btn outline" type="button" id="mt-feed-on">${ic("cal")}إنشاء رابط التقويم</button></div></div>`;
    box.querySelectorAll("[data-w]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/mentors?tab=sessions&when=${b.dataset.w}`; }));
    const feedBox = $("#mt-feed");
    const showFeed = (path) => { const url = location.origin + path; feedBox.innerHTML = `<div class="mt-feed"><label class="vh" for="mt-feed-u">رابط التقويم</label><input id="mt-feed-u" readonly value="${h(url)}"><button class="btn" type="button" id="mt-feed-cp">نسخ</button></div><div class="mt-acts"><a class="btn ghost sm" href="${h(url.replace(/^https?:/, "webcal:"))}">فتح في التقويم</a><button class="btn ghost sm" type="button" id="mt-feed-rot">تغيير الرابط</button><button class="btn ghost sm" type="button" id="mt-feed-off">إيقاف</button></div>`;
      $("#mt-feed-cp").addEventListener("click", async () => { try { await navigator.clipboard.writeText(url); say("نُسخ الرابط"); } catch { $("#mt-feed-u").select(); } });
      $("#mt-feed-rot").addEventListener("click", (e) => busy(e.currentTarget, async () => { showFeed((await api("POST", "/api/mentor/feed", { rotate: true })).path); say("تغيّر الرابط؛ الرابط القديم لم يعد يعمل"); }));
      $("#mt-feed-off").addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("DELETE", "/api/mentor/feed"); feedBox.innerHTML = `<p class="u-m0 u-t-sm u-c-mu">أوقِف رابط التقويم.</p>`; })); };
    $("#mt-feed-on").addEventListener("click", (e) => busy(e.currentTarget, async () => showFeed((await api("POST", "/api/mentor/feed", {})).path)));
  }
  async function familyTab(box) {
    const d = await api("GET", "/api/mentor/sessions?role=family"); if (!box.isConnected) return;
    box.innerHTML = `<div class="notice">${ic("shield")}<span>ترى مواعيد جلسات الإرشاد للحسابات المرتبطة بك ومرشديها ومواضيعها، ولا ترى الملاحظات. يمكنك الانضمام إلى غرفة الجلسة.</span></div>
      ${d.sessions.length ? `<ul class="list">${d.sessions.map(sessionRow).join("")}</ul>` : UI.empty({ title: "لا جلسات قادمة", text: "حين يحجز حساب مرتبط بك جلسة إرشاد ستظهر هنا ويصلك إشعار." })}
      ${[...new Map(d.sessions.filter((s) => s.learner?.id).map((s) => [s.learner.id, s.learner])).values()].map((l) => `<p class="u-mt12"><a class="u-fw7" href="#/mentor-certs?minor=${enc(l.id)}">شهادات الإرشاد: <bdi>${h(l.name)}</bdi></a></p>`).join("")}`;
  }
  async function requestsTab(box) {
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول", text: "لتكتب طلب إرشاد.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    const d = await api("GET", "/api/mentor/requests"); if (!box.isConnected) return;
    const pre = qs().get("topic") || "";
    box.innerHTML = `<details class="card" ${d.sent.length ? "" : "open"}><summary class="u-mh44 u-dflex u-aic u-fw7 u-cp">${ic("plus")} طلب إرشاد مفتوح</summary><p class="u-t-sm u-c-mu">يراه كل مرشد في هذا الموضوع، ويقبله من يستطيع مساعدتك.</p>
      <form class="f-form" id="mt-rf"><label>الموضوع<select name="topic" required><option value="">اختر…</option>${Object.entries(d.topics).map(([k, v]) => `<option value="${k}" ${pre === k ? "selected" : ""}>${h(v)}</option>`).join("")}</select></label>
      <label>مستواك<select name="level"><option value="">—</option>${Object.entries(d.levels).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></label>
      <label>ما الذي تريد الوصول إليه؟<textarea name="goal" dir="auto" required minlength="10" maxlength="1000" rows="3" placeholder="اكتب هدفك وما جرّبته حتى الآن"></textarea></label><button class="btn" type="submit">إرسال الطلب</button></form></details>
      <div class="f-h">طلباتي</div>${d.sent.length ? `<ul class="list">${d.sent.map((r) => `<li><div class="li">${ic(r.direct ? "user" : "users")}<span class="t"><b><span>${h(r.topic.label)}</span>${r.mentor ? ` · ${u(r.mentor.name)}` : "<span> · طلب مفتوح</span>"}</b><small dir="auto" data-noi18n>${h(r.goal.slice(0, 120))}</small>${r.reply ? `<small class="u-c-ac"><span>ردّ المرشد:</span> ${u(r.reply)}</small>` : ""}</span><span class="u-dflex u-fdc u-g4 u-aic">${badge(TONE[r.status], r.statusLabel)}${r.status === "open" ? `<button class="btn ghost sm" type="button" data-wd="${h(r.id)}">سحب</button>` : r.status === "accepted" && r.mentor ? `<a class="btn sm" href="#/mentor/${enc(r.mentor.handle)}?request=${enc(r.id)}">احجز</a>` : ""}</span></div></li>`).join("")}</ul>` : UI.empty({ title: "لا طلبات بعد", text: "اكتب طلباً مفتوحاً، أو افتح ملف مرشد وأرسل له طلباً مباشراً." })}`;
    $("#mt-rf").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); busy(e.submitter, async () => { await api("POST", "/api/mentor/requests", { topic: f.get("topic"), level: f.get("level") || undefined, goal: String(f.get("goal") || "").trim() }); say("أُرسل الطلب"); requestsTab(box); }); });
    box.querySelectorAll("[data-wd]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", `/api/mentor/requests/${enc(b.dataset.wd)}/withdraw`); say("سُحب الطلب"); requestsTab(box); })));
  }

  /* =================== #/mentor/:handle =================== */
  /* M3 full profile: every key below is ABSENT when the mentor hid it (server-side field levels), so each block renders only if present */
  const has = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "");
  const yr = (n) => (n ? lt(String(n)) : "");
  const facts = (m) => { const f = [has(m.age) ? `<li id="mt-age">${ic("user", "xs")}<span>${num(m.age)} سنة</span></li>` : "", has(m.city) ? `<li id="mt-city">${ic("building", "xs")}${u(m.city)}</li>` : "", has(m.years) ? `<li id="mt-years">${ic("medal", "xs")}<span>${num(m.years)} سنوات خبرة</span></li>` : ""].join(""); return f ? `<ul class="mt-facts" aria-label="معلومات المرشد">${f}</ul>` : ""; };
  const fullProfile = (m) => [
    has(m.approach) ? `<section class="mt-sec" id="mt-approach" aria-labelledby="mt-approach-h"><h3 class="f-h" id="mt-approach-h">${ic("bulb")}أسلوبي في الإرشاد</h3><div class="card u-lh18" dir="auto" data-noi18n>${h(m.approach)}</div></section>` : "",
    has(m.skills) ? `<section class="mt-sec" id="mt-skills" aria-labelledby="mt-skills-h"><h3 class="f-h" id="mt-skills-h">${ic("award")}المهارات</h3><ul class="mt-tags mt-skills">${m.skills.map((x) => `<li><span class="chip">${u(x)}</span></li>`).join("")}</ul></section>` : "",
    has(m.experience) ? `<section class="mt-sec" id="mt-exp" aria-labelledby="mt-exp-h"><h3 class="f-h" id="mt-exp-h">${ic("brief")}الخبرات</h3><ul class="list">${m.experience.map((x) => `<li><div class="li">${ic("brief")}<span class="t"><b>${u(x.title)}</b><small>${x.org ? `${u(x.org)} · ` : ""}${yr(x.from)} – ${x.to ? yr(x.to) : "<span>حتى الآن</span>"}</small></span></div></li>`).join("")}</ul></section>` : "",
    has(m.qualifications) ? `<section class="mt-sec" id="mt-qual" aria-labelledby="mt-qual-h"><h3 class="f-h" id="mt-qual-h">${ic("cap")}المؤهلات والشهادات</h3><ul class="list">${m.qualifications.map((x) => `<li><div class="li">${ic("medal")}<span class="t"><b>${u(x.name)}</b>${x.issuer || x.year ? `<small>${x.issuer ? u(x.issuer) : ""}${x.issuer && x.year ? " · " : ""}${yr(x.year)}</small>` : ""}</span>${x.link ? `<a class="btn ghost sm" href="${h(x.link)}" target="_blank" rel="noopener noreferrer nofollow">${ic("eye")}<span>عرض الشهادة</span></a>` : ""}</div></li>`).join("")}</ul></section>` : ""
  ].join("");
  /* ---------- M4-2 «الموارد» (PLAN F8): read-only block on #/mentor/:handle + preview, manager in #/mentoring?tab=profile.
   *  Every user-written value (title, note, url) goes through textContent / setAttribute — never innerHTML. Links: https only,
   *  target=_blank rel="noopener noreferrer". The server already filtered what this viewer may see (public / mentees). */
  const RES_KIND = { link: ["clip", "رابط"], file: ["doc", "ملف"], note: ["pen", "ملاحظة"] };
  const RES_VIS = { mentees: ["lock", "لمتعلّميّ فقط"], public: ["globe", "للجميع"] };
  const httpsOk = (s) => typeof s === "string" && /^https:\/\/[^\s]+$/i.test(s);
  const el = (tag, cls, attrs = {}) => { const n = document.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const userTxt = (tag, text, cls) => { const n = el(tag, cls, { dir: "auto", "data-noi18n": "" }); n.textContent = text; return n; };
  const hostOf = (s) => { try { return new URL(s).hostname; } catch { return ""; } };
  function resItem(r, ownerView) {
    const li = el("li"), link = r.url && httpsOk(r.url);
    const row = link ? el("a", "li", { href: r.url, target: "_blank", rel: "noopener noreferrer", "data-res": r.id }) : el("div", "li", { "data-res": r.id });
    row.insertAdjacentHTML("afterbegin", ic((RES_KIND[r.kind] || RES_KIND.link)[0]));
    const t = el("span", "t"); t.append(userTxt("b", r.title));
    if (r.note) t.append(userTxt("small", r.note, "mt-res-note"));
    if (link) { const s = el("small", "mt-res-host", { dir: "ltr", "data-noi18n": "" }); s.textContent = hostOf(r.url); t.append(s); }
    row.append(t);
    if (ownerView || r.visibility === "mentees") row.insertAdjacentHTML("beforeend", `<span class="sbadge ${r.visibility === "mentees" ? "" : "ok"}">${h(r.visibility === "mentees" ? "للمتعلّمين" : "للجميع")}</span>`);
    if (link) row.insertAdjacentHTML("beforeend", `<span class="f-sr">(يفتح في نافذة جديدة)</span>`);
    li.append(row); return li;
  }
  /** read-only «الموارد» section, or null when there is nothing this viewer may see */
  function resBlock(list, id = "mt-res", title = "الموارد", cls = "") {
    if (!Array.isArray(list) || !list.length) return null;
    const s = el("section", "mt-sec mt-res" + (cls ? " " + cls : ""), { id, "aria-labelledby": id + "-h" });
    s.innerHTML = `<h3 class="f-h" id="${id}-h">${ic("book")}${h(title)}</h3>`;
    const ul = el("ul", "list"); list.forEach((r) => ul.append(resItem(r, false))); s.append(ul); return s;
  }
  /** mentor-side manager: list + add/edit form + up/down reorder + delete (GET/POST/PUT/DELETE /api/mentor/me/resources) */
  async function resManager(host) {
    const s = el("section", "mt-sec mt-resm", { id: "mt-resm", "aria-labelledby": "mt-resm-h" });
    s.innerHTML = `<h3 class="f-h" id="mt-resm-h">${ic("book")}الموارد</h3>
      <p class="f-hint">روابط وملفات وملاحظات تشاركها في صفحتك. «لمتعلّميّ فقط» يراها من حجز معك جلسة وأولياء أمورهم فقط، و«للجميع» يراها كل من يرى صفحتك.</p>
      <div id="mt-resm-b">${skel(2)}</div><p class="f-sr" id="mt-resm-st" role="status" aria-live="polite"></p>`;
    host.append(s);
    const body = s.querySelector("#mt-resm-b"), st = s.querySelector("#mt-resm-st");
    let data, editing = null;
    const load = async () => { data = await api("GET", "/api/mentor/me/resources"); render(); };
    const formHtml = (m) => `<form class="f-form card u-mt8" id="mt-resf" novalidate>
        <label>العنوان<input name="title" dir="auto" required maxlength="${m.titleMax}" autocomplete="off"></label>
        <label>النوع<select name="kind">${m.kinds.map((k) => `<option value="${k}">${h(RES_KIND[k]?.[1] || k)}</option>`).join("")}</select></label>
        <label id="mt-resf-url">الرابط (https:// فقط)<input name="url" type="url" dir="ltr" inputmode="url" maxlength="${m.urlMax}" placeholder="https://" autocomplete="off"></label>
        <label>ملاحظة (اختياري)<textarea name="note" dir="auto" rows="2" maxlength="${m.noteMax}"></textarea></label>
        <label>من يراه<select name="visibility">${m.visibility.map((k) => `<option value="${k}" ${k === m.visibilityDefault ? "selected" : ""}>${h(RES_VIS[k]?.[1] || k)}</option>`).join("")}</select></label>
        <div class="u-dflex u-g8 u-fww"><button class="btn" type="submit" id="mt-resf-go">إضافة المورد</button>${editing ? `<button class="btn ghost" type="button" id="mt-resf-x">إلغاء</button>` : ""}</div></form>`;
    function render() {
      const list = data.resources, m = data.meta;
      body.textContent = "";
      const head = el("p", "u-t-sm u-c-mu u-m0"); head.textContent = `${num(list.length)} / ${num(m.max)}`; head.setAttribute("aria-label", tr("عدد الموارد"));
      body.append(head);
      if (!list.length) body.insertAdjacentHTML("beforeend", UI.empty({ title: "لا موارد بعد", text: "أضف أول رابط أو ملاحظة لمتعلّميك." }));
      else {
        const ul = el("ul", "list mt-resm-list", { id: "mt-resm-list" });
        list.forEach((r, i) => {
          const li = resItem(r, true), row = li.firstChild;
          const tools = el("span", "mt-resm-tools", { role: "group", "aria-label": tr("أدوات المورد") });
          const btn = (act, icon, label, dis) => { const b = el("button", "btn ghost sm mt-resm-btn", { type: "button", "data-act": act, "data-id": r.id, "aria-label": tr(label) }); b.innerHTML = ic(icon, "xs"); if (dis) b.disabled = true; return b; };
          tools.append(btn("up", "arrowUp", "نقل لأعلى", i === 0), btn("down", "arrowUp", "نقل لأسفل", i === list.length - 1), btn("edit", "pen", "تعديل"), btn("del", "trash", "حذف"));
          tools.querySelector("[data-act=down]").classList.add("mt-down");
          const wrap = el("div", "mt-resm-row"); wrap.append(row, tools); li.replaceChildren(wrap); ul.append(li);
        });
        body.append(ul);
      }
      if (list.length < m.max || editing) { body.insertAdjacentHTML("beforeend", formHtml(m)); wireForm(); }
      else body.insertAdjacentHTML("beforeend", `<div class="notice warn">${ic("alert")}<span>بلغت الحد الأقصى للموارد. احذف مورداً لإضافة غيره.</span></div>`);
      body.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => onAct(b)));
    }
    function wireForm() {
      const f = body.querySelector("#mt-resf"), kind = f.kind, urlL = f.querySelector("#mt-resf-url");
      const sync = () => { urlL.hidden = kind.value === "note"; };
      if (editing) { const r = data.resources.find((x) => x.id === editing); if (r) { f.title.value = r.title; kind.value = r.kind; f.url.value = r.url || ""; f.note.value = r.note || ""; f.visibility.value = r.visibility; f.querySelector("#mt-resf-go").textContent = tr("حفظ التعديل"); } }
      sync(); kind.addEventListener("change", sync);
      f.querySelector("#mt-resf-x")?.addEventListener("click", () => { editing = null; render(); });
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        const b = { title: f.title.value.trim(), kind: kind.value, url: kind.value === "note" ? null : f.url.value.trim(), note: f.note.value.trim() || null, visibility: f.visibility.value };
        if (!b.title) { say(tr("اكتب عنوان المورد")); f.title.focus(); return; }
        if (b.kind !== "note" && !httpsOk(b.url)) { say(tr("الروابط المقبولة تبدأ بـ https:// فقط")); f.url.focus(); return; }
        busy(e.submitter, async () => {
          if (editing) await api("PUT", `/api/mentor/me/resources/${enc(editing)}`, b); else await api("POST", "/api/mentor/me/resources", b);
          const was = editing; editing = null; await load(); st.textContent = tr(was ? "حُفظ المورد" : "أُضيف المورد"); say(tr(was ? "حُفظ المورد" : "أُضيف المورد"));
        });
      });
      if (editing) f.title.focus();
    }
    function onAct(b) {
      const rid = b.dataset.id, act = b.dataset.act, ids = data.resources.map((r) => r.id), i = ids.indexOf(rid);
      if (act === "edit") { editing = rid; render(); return; }
      if (act === "del") { if (!confirm(tr("حذف هذا المورد؟"))) return; busy(b, async () => { await api("DELETE", `/api/mentor/me/resources/${enc(rid)}`); if (editing === rid) editing = null; await load(); st.textContent = tr("حُذف المورد"); }); return; }
      const j = act === "up" ? i - 1 : i + 1; if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      busy(b, async () => { data = await api("PUT", "/api/mentor/me/resources/order", { order: ids }); render(); st.textContent = tr("تغيّر الترتيب"); body.querySelector(`[data-act="${act}"][data-id="${CSS.escape(rid)}"]:not(:disabled)`)?.focus() || body.querySelector(`[data-id="${CSS.escape(rid)}"][data-act=edit]`)?.focus(); });
    }
    try { await load(); } catch (e) { body.innerHTML = errBox(e); }
  }
  /* M2-4: one review row (shared by the first page and «عرض المزيد») */
  const reviewRow = (r) => `<li><div class="li"><span class="mt-rate">${ic("star", "xs")}${num(r.rating)}</span><span class="t"><b>${u(r.by.name)} · <span>${h(r.topic)}</span></b>${r.comment ? `<small dir="auto" data-noi18n>${h(r.comment)}</small>` : ""}</span><small class="u-c-mu">${h(fmt(r.at, { day: "numeric", month: "short" }))}</small></div></li>`;
  /* M2-4: guardian card — the server sends it only to an active guardian of a linked minor learner (counts + safety, never notes) */
  const guardianCard = (g) => {
    if (!g) return "";
    const sf = g.safety || {}, n = g.sessions || {};
    const safe = [sf.verified ? "حساب المرشد موثّق" : "", sf.allowMinors ? "يقبل من هم دون ١٨ بإشراف وليّ الأمر" : "", sf.guardianNotified ? "يصلك إشعار بكل طلب وحجز وتغيير" : "", sf.guardianCanJoin ? "يمكنك الانضمام إلى غرفة الجلسة" : "", sf.notesPrivate ? "ملاحظات الجلسات خاصة بالطرفين ولا تظهر هنا" : ""].filter(Boolean);
    return `<section class="mt-sec" id="mt-guard" aria-labelledby="mt-guard-h"><h3 class="f-h" id="mt-guard-h">${ic("shield")}بطاقة وليّ الأمر</h3><div class="card mt-guard">
      <p class="u-m0"><span>تتابع جلسات:</span> ${g.learners.map((l) => u(l.name)).join("، ")}</p>
      <ul class="mt-gstats" aria-label="ملخص الجلسات"><li><b>${num(n.total || 0)}</b><small>كل الجلسات</small></li><li><b>${num(n.upcoming || 0)}</b><small>قادمة</small></li><li><b>${num(n.completed || 0)}</b><small>مكتملة</small></li><li><b>${num(n.cancelled || 0)}</b><small>ملغاة</small></li></ul>
      ${g.next ? `<p class="u-m0 mt-gnext">${ic("cal", "xs")}<span>الجلسة القادمة:</span> <span>${h(dayLong(g.next.startsAt))} · ${h(timeOf(g.next.startsAt))}</span> ${badge(TONE[g.next.status], g.next.statusLabel)}</p>` : ""}
      ${safe.length ? `<ul class="mt-why" aria-label="معلومات الأمان">${safe.map((x) => `<li>${ic("check", "xs")}<span>${h(x)}</span></li>`).join("")}${sf.since ? `<li>${ic("cal", "xs")}<span>في المنصة منذ</span> <span>${h(fmt(sf.since, { month: "long", year: "numeric" }))}</span></li>` : ""}</ul>` : ""}
      <a class="btn outline sm u-mt8" href="#/mentors?tab=family">${ic("users")}<span>جلسات العائلة</span></a></div></section>`;
  };
  /* M2-4: public communities (present only when the mentor shows the «communities» field to this viewer) */
  const commsBlock = (cs) => (has(cs) ? `<section class="mt-sec" id="mt-comms" aria-labelledby="mt-comms-h"><h3 class="f-h" id="mt-comms-h">${ic("users")}المجتمعات</h3><ul class="list">${cs.map((c) => `<li><a class="li" href="#/c/${enc(c.id)}">${ic("users")}<span class="t"><b>${u(c.name)}</b><small><span>${h(tr("{n} عضو").replace("{n}", num(c.members)))}</span></small></span><span class="chev" aria-hidden="true">←</span></a></li>`).join("")}</ul></section>` : "");
  /* M2-4: sticky bottom CTA on phones (book / request / sign in); hides itself while the booking box is on screen */
  function ctaBar(d) {
    const me = d.me; if (me.self) return "";
    const act = !me.signedIn ? `<a class="btn" href="#/settings" id="mt-cta-go">${ic("cal")}<span>سجّل الدخول للحجز</span></a>`
      : me.canBook ? `<button class="btn" type="button" id="mt-cta-go" data-cta="book">${ic("cal")}<span>احجز جلسة</span></button>`
      : !me.request && d.mentor.contact ? `<button class="btn" type="button" id="mt-cta-go" data-cta="req">${ic("mail")}<span>أرسل طلباً قبل الحجز</span></button>` : "";
    if (!act) return "";
    return `<div class="mt-cta" id="mt-cta" role="region" aria-label="إجراء سريع"><span class="mt-cta-t"><b>${d.mentor.paid ? `${num(d.mentor.price)} Pi` : "<span>مجاني</span>"}</b><small><span>${h(tr("{n} دقيقة").replace("{n}", num(d.mentor.minutes)))}</span></small></span>${act}</div>`;
  }
  function wireCta(box) {
    const bar = box.querySelector("#mt-cta"); if (!bar) return;
    view.querySelector(".mt-page")?.classList.add("has-cta");
    bar.querySelector("[data-cta=book]")?.addEventListener("click", () => { const t = $("#mt-book"); if (!t) return; t.scrollIntoView({ behavior: "smooth", block: "start" }); (t.querySelector("[data-day], button, a") || t).focus?.({ preventScroll: true }); });
    bar.querySelector("[data-cta=req]")?.addEventListener("click", () => { const dt = $("#mt-dr")?.closest("details"); if (!dt) return; dt.open = true; dt.scrollIntoView({ behavior: "smooth", block: "center" }); dt.querySelector("select,textarea")?.focus({ preventScroll: true }); });
    const tgt = $("#mt-book"); if (!tgt || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver((es) => { if (!bar.isConnected) { io.disconnect(); return; } const on = es.some((e) => e.isIntersecting); bar.classList.toggle("off", on); bar.toggleAttribute("inert", on); bar.setAttribute("aria-hidden", String(on)); }, { rootMargin: "0px 0px -30% 0px" });
    io.observe(tgt);
  }
  function wireMore(box, handle, next) {
    const btn = box.querySelector("#mt-more"); if (!btn) return; let cur = next;
    btn.addEventListener("click", () => busy(btn, async () => {
      const r = await api("GET", `/api/mentors/${enc(handle)}?reviewsBefore=${enc(cur)}`);
      const list = $("#mt-revs"); if (!list) return;
      const first = list.children.length; list.insertAdjacentHTML("beforeend", r.reviews.map(reviewRow).join(""));
      const st = $("#mt-more-st"); if (st) st.textContent = tr("أُضيفت {n} تقييمات").replace("{n}", num(r.reviews.length));
      const li = list.children[first]?.querySelector(".li"); if (li) { li.tabIndex = -1; li.focus({ preventScroll: false }); }
      cur = r.reviewsNext; if (!cur) btn.closest(".mt-more")?.remove();
    }));
  }
  async function profileView(handle) {
    page({ title: "…", back: ["#/mentors", "الإرشاد"] }, `<div id="mt-p">${skel(4)}</div>`);
    let d; try { d = await api("GET", "/api/mentors/" + enc(handle)); } catch (e) { const b = $("#mt-p"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#mt-p"); if (!box) return;
    const m = d.mentor, me = d.me, hd = $("#mt-h"); if (hd) { hd.textContent = m.user.name; hd.dir = "auto"; hd.setAttribute("data-noi18n", ""); }
    const reqId = qs().get("request") || "";
    const total = (d.distribution || []).reduce((a, b) => a + b, 0);
    box.innerHTML = `<section class="f-cover"><div class="mt-hero">${av(m.user, "lg")}<div class="u-mw0"><b class="mt-name">${u(m.user.name)}</b><h3 dir="auto" data-noi18n>${h(m.headline)}</h3><small>${lt("@" + m.user.handle)}${m.languages ? ` · ${u(m.languages)}` : ""}</small>${revBadge(m, "mt-rev-hero")}${facts(m)}</div></div>
        <div class="mt-stats">${m.rating === undefined ? "" : `<span><b>${m.rating?.count ? num(m.rating.avg, { maximumFractionDigits: 1 }) : "—"}</b><small>${m.rating?.count ? `من ${num(m.rating.count)} تقييم` : "لا تقييمات بعد"}</small></span><span><b>${m.sessions != null ? num(m.sessions) : "—"}</b><small>جلسة مكتملة</small></span>`}<span><b>${num(m.minutes)}</b><small>دقيقة للجلسة</small></span><span><b>${m.paid ? `${num(m.price)} Pi` : "مجاني"}</b><small>السعر</small></span></div></section>
      ${m.status !== "active" ? `<div class="notice danger">${ic("flag")}<span>هذا الملف موقوف من فريق المنصة.</span></div>` : ""}
      ${me.self ? `<div class="notice">${ic("user")}<span>هذه صفحتك كما يراها المتعلّمون. <a class="u-fw7" href="#/mentoring?tab=profile">تعديل الملف</a></span></div>` : ""}
      <ul class="mt-tags u-mb12">${m.topics.map((t) => `<li><a class="chip" href="#/mentors?tab=find&topic=${enc(t.key)}">${h(t.label)}</a></li>`).join("")}${m.allowMinors ? `<li><span class="chip">${ic("shield", "xs")} يقبل من هم دون ١٨ بإشراف وليّ الأمر</span></li>` : ""}</ul>
      ${!me.self && me.signedIn && (me.saved || me.canSave) ? `<div class="mt-saverow">${saveBtn(m.user.handle, me.saved)}<small class="u-c-mu">نُبلغك حين يفتح مواعيد جديدة (مرة في اليوم على الأكثر)</small></div>` : ""}
      ${m.bio ? `<div class="card u-lh18 mt-bio" dir="auto" data-noi18n>${h(m.bio)}</div>` : ""}
      ${fullProfile(m)}
      <div id="mt-res-slot"></div>
      ${me.upcoming.length ? `<div class="f-h">جلساتك القادمة معه</div><ul class="list">${me.upcoming.map((s) => `<li><a class="li" href="#/msession/${enc(s.id)}">${ic("cal")}<span class="t"><b>${h(dayLong(s.startsAt))} · ${h(timeOf(s.startsAt))}</b></span>${badge(TONE[s.status], s.statusLabel)}</a></li>`).join("")}</ul>` : ""}
      ${guardianCard(d.guardian)}
      ${me.self ? "" : `<div class="f-h">احجز جلسة</div><div id="mt-book"></div>`}
      ${!me.self && me.signedIn && !me.request ? `<details class="card"><summary class="u-mh44 u-dflex u-aic u-fw7 u-cp">${ic("mail")} أرسل طلباً قبل الحجز</summary><form class="f-form u-mt8" id="mt-dr"><label>الموضوع<select name="topic">${m.topics.map((t) => `<option value="${t.key}">${h(t.label)}</option>`).join("")}</select></label><label>هدفك<textarea name="goal" dir="auto" required minlength="10" maxlength="1000" rows="3"></textarea></label><button class="btn" type="submit">إرسال</button></form></details>` : ""}
      ${me.request ? `<div class="notice ${me.request.status === "accepted" ? "ok" : ""}">${ic("mail")}<span><span>طلبك:</span> <span>${h(me.request.statusLabel)}</span>${me.request.reply ? ` — «${u(me.request.reply)}»` : ""}</span></div>` : ""}
      ${d.distribution == null ? "" : `<div class="f-h">التقييمات <span class="grow"></span></div>
      ${total ? `<div class="card"><div class="mt-dist">${[5, 4, 3, 2, 1].map((k) => `<div><span>${num(k)}</span><span class="mt-bar" role="img" aria-label="${num(d.distribution[k - 1])} تقييم بـ ${num(k)}"><i class="w-${Math.round((d.distribution[k - 1] / total) * 10) * 10}"></i></span><span>${num(d.distribution[k - 1])}</span></div>`).join("")}</div></div>
        <ul class="list" id="mt-revs">${d.reviews.map(reviewRow).join("")}</ul>${d.reviewsNext ? `<div class="mt-more"><button class="btn outline sm" type="button" id="mt-more" aria-controls="mt-revs">عرض المزيد</button></div>` : ""}<p class="f-sr" id="mt-more-st" role="status" aria-live="polite"></p>` : UI.empty({ title: "لا تقييمات بعد", text: "تظهر تقييمات المتعلّمين بعد جلساتهم المكتملة." })}`}
      ${commsBlock(d.communities)}
      ${ctaBar(d)}`;
    { const slot = box.querySelector("#mt-res-slot"), rb = resBlock(d.resources); if (slot) { if (rb) slot.replaceWith(rb); else slot.remove(); } }
    wireMore(box, m.user.handle, d.reviewsNext); wireCta(box); wireSave(box);
    box.querySelectorAll(".mt-bar i").forEach((i) => { const w = /w-(\d+)/.exec(i.className); if (w) i.style.width = w[1] + "%"; });
    $("#mt-dr")?.addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); busy(e.submitter, async () => { await api("POST", "/api/mentor/requests", { mentor: m.user.handle, topic: f.get("topic"), goal: String(f.get("goal") || "").trim() }); say("أُرسل الطلب للمرشد"); profileView(handle); }); });
    if (!me.self) bookBox($("#mt-book"), d, reqId);
  }
  async function bookBox(el, d, reqId) {
    const m = d.mentor, me = d.me;
    if (!me.signedIn) { el.innerHTML = UI.empty({ title: "سجّل الدخول للحجز", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    if (!me.canBook) { el.innerHTML = `<div class="notice warn">${ic("lock")}<span>${h(me.why)}</span></div>`; return; }
    el.innerHTML = `<div class="skel row"></div>`;
    let s; try { s = await api("GET", `/api/mentors/${enc(m.user.handle)}/slots`); } catch (e) { el.innerHTML = errBox(e); return; }
    if (!el.isConnected) return;
    if (!s.slots.length) { el.innerHTML = UI.empty({ title: "لا مواعيد متاحة خلال أسبوعين", text: "أرسل طلباً للمرشد، وسيخبرك حين يضيف مواعيد." }); return; }
    const days = {}; for (const x of s.slots) (days[dayKey(x)] ||= []).push(x);
    const keys = Object.keys(days); let day = keys[0], pick = null;
    const tzNote = s.tz !== myTz ? `<p class="f-hint"><span>الأوقات بتوقيت جهازك. المرشد في منطقة</span> ${lt(s.tz)}</p>` : "";
    el.innerHTML = `<div class="card"><ul class="mt-days" aria-label="الأيام المتاحة">${keys.map((k) => { const x = days[k][0]; return `<li><button class="mt-day" type="button" data-day="${k}" aria-pressed="${k === day}"><small>${h(fmt(x, { weekday: "short" }))}</small><b>${h(fmt(x, { day: "numeric" }))}</b><small>${h(fmt(x, { month: "short" }))}</small></button></li>`; }).join("")}</ul>
      <div id="mt-times" role="group" aria-label="الأوقات"></div>${tzNote}
      <form class="f-form u-mt12" id="mt-bf"><label>الموضوع<select name="topic">${m.topics.map((t) => `<option value="${t.key}">${h(t.label)}</option>`).join("")}</select></label><label>ملاحظة للمرشد (اختياري)<textarea name="note" dir="auto" maxlength="1000" rows="2" placeholder="ما الذي تريد التركيز عليه؟"></textarea></label>
      <button class="btn u-w100" type="submit" id="mt-bk" disabled>اختر وقتاً</button><p class="f-hint">${m.paid ? `تدفع ${num(m.price)} Pi عند الحجز وتبقى محفوظة حتى تكتمل الجلسة؛ تُعاد إليك إن أُلغيت.` : "الجلسة مجانية. يؤكدها المرشد ويصلك إشعار."}</p></form></div>`;
    const times = () => { const t = $("#mt-times"); t.innerHTML = `<ul class="mt-times">${days[day].map((x) => `<li><button class="mt-time" type="button" data-t="${x}" aria-pressed="${pick === x}">${h(timeOf(x))}</button></li>`).join("")}</ul>`; t.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => { pick = b.dataset.t; times(); const bk = $("#mt-bk"); bk.disabled = false; bk.innerHTML = `<span>احجز</span> <span>${h(dayLong(pick))} · ${h(timeOf(pick))}</span>`; })); };
    times();
    el.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => { day = b.dataset.day; el.querySelectorAll("[data-day]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); times(); }));
    $("#mt-bf").addEventListener("submit", (e) => {
      e.preventDefault(); if (!pick) return; const f = new FormData(e.target);
      busy($("#mt-bk"), async () => {
        const r = await api("POST", `/api/mentors/${enc(m.user.handle)}/book`, { startsAt: pick, topic: f.get("topic"), note: String(f.get("note") || "").trim() || undefined, requestId: reqId || undefined });
        if (r.intent) await payIntent(r.intent, r.session.id, m.price, r.intent.memo);
        say(r.intent ? "حُجز الموعد" : "حُجز الموعد؛ بانتظار تأكيد المرشد"); location.hash = "#/msession/" + enc(r.session.id);
      });
    });
  }

  /* =================== #/msession/:id =================== */
  async function sessionView(id) {
    page({ title: "جلسة إرشاد", back: ["#/mentors?tab=sessions", "جلساتي"] }, `<div id="mt-s">${skel(3)}</div>`);
    let d; try { d = await api("GET", "/api/mentor-sessions/" + enc(id)); } catch (e) { const b = $("#mt-s"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#mt-s"); if (!box) return;
    const s = d.session, A = s.actions, mine = s.role === "mentor" || s.role === "learner";
    const hd = $("#mt-h"); if (hd) hd.innerHTML = `<span><span>جلسة إرشاد:</span> <span>${h(s.topic.label)}</span></span>`; /* one flex item: the two text nodes translate separately but wrap as one line */
    const back = view.querySelector(".page-head .back"); if (back && s.role === "mentor") { back.href = "#/mentoring?tab=sessions"; back.lastChild.textContent = " لوحة المرشد"; }
    box.innerHTML = `<section class="card hero"><div class="mt-when"><span class="d"><small>${h(fmt(s.startsAt, { month: "short" }))}</small><b>${h(fmt(s.startsAt, { day: "numeric" }))}</b></span><div><b class="u-t-lg u-db">${h(dayLong(s.startsAt))}</b><span class="muted"><bdi dir="auto">${h(timeOf(s.startsAt))} – ${h(timeOf(s.endsAt))}</bdi> · <span>${num(s.minutes)} دقيقة</span></span></div></div>
        <div class="u-mt12 u-dflex u-g6 u-fww">${badge(TONE[s.status], s.statusLabel)}${s.price ? `<span class="sbadge info"><span>${num(s.price)} Pi</span>${(PAY[s.payStatus]) ? ` · <span>${h(PAY[s.payStatus])}</span>` : ""}</span>` : ""}${s.minor ? badge("role", "بإشراف وليّ الأمر") : ""}</div>
        ${A.length ? `<div class="mt-acts">${A.includes("join") ? `<button class="btn" type="button" data-a="join">${ic("mic")}${s.role === "mentor" && !s.roomId ? "افتح غرفة الجلسة" : "انضم إلى الجلسة"}</button>` : ""}${A.includes("pay") ? `<button class="btn" type="button" data-a="pay">${ic("wallet")}ادفع ${num(s.price)} Pi</button>` : ""}${A.includes("confirm") ? `<button class="btn" type="button" data-a="confirm">${ic("check")}تأكيد الموعد</button>` : ""}${A.includes("complete") ? `<button class="btn" type="button" data-a="complete">${ic("check")}اكتملت الجلسة</button>` : ""}${A.includes("no_show") ? `<button class="btn ghost" type="button" data-a="no-show">لم يحضر المتعلّم</button>` : ""}${A.includes("decline") ? `<button class="btn ghost" type="button" data-a="decline">اعتذار</button>` : ""}</div>` : ""}</section>
      ${s.status === "confirmed" && !A.includes("join") && mine ? `<p class="f-hint">تُفتح غرفة الجلسة قبل الموعد بعشر دقائق${s.role === "learner" ? " حين يفتحها المرشد" : ""}.</p>` : ""}
      ${s.cancelReason ? `<div class="notice warn">${ic("flag")}<span><span>${s.cancelledBy === "mentor" ? "ألغاها المرشد:" : s.cancelledBy === "learner" ? "ألغاها المتعلّم:" : "أُلغيت:"}</span> ${u(s.cancelReason)}</span></div>` : ""}
      <div class="f-h">الطرفان</div><div class="card mt-who"><span>${av(s.mentor)}<span><a class="u-fw7" href="#/mentor/${enc(s.mentor.handle)}">${u(s.mentor.name)}</a><small>المرشد</small></span></span><span>${av(s.learner)}<span><b>${u(s.learner.name)}</b><small><span>المتعلّم</span>${s.minor ? "<span> · دون ١٨</span>" : ""}</small></span></span></div>
      ${s.role === "learner" || s.role === "guardian" ? `<div id="mt-sres-slot" hidden></div>` : ""}
      <section id="mt-goals" class="mt-goals" aria-labelledby="mt-g-h"></section>
      <section id="mt-ag" class="mt-ag"></section>
      ${s.note ? `<div class="f-h">ملاحظة الحجز</div><p class="mt-quote" dir="auto" data-noi18n>${h(s.note)}</p>` : ""}
      ${A.includes("feedback") ? `<div class="f-h">${s.role === "learner" ? "قيّم الجلسة" : "ملاحظاتك للمتعلّم"}</div><form class="card f-form" id="mt-fb">${s.role === "learner" ? `<fieldset class="mt-stars"><legend>كيف كانت الجلسة؟</legend>${[1, 2, 3, 4, 5].map((k) => `<label><input type="radio" name="rating" value="${k}" required aria-label="${num(k)} من 5">${ic("star")}</label>`).join("")}</fieldset>` : ""}<label>${s.role === "learner" ? "تعليق (يظهر في صفحة المرشد)" : "ملاحظة خاصة يراها المتعلّم وحده"}<textarea name="comment" dir="auto" maxlength="600" rows="3" ${s.role === "mentor" ? 'required minlength="3"' : ""}></textarea></label><button class="btn" type="submit">إرسال</button></form>` : ""}
      ${s.feedback?.mine || s.feedback?.other ? `<div class="f-h">التقييم</div><ul class="list">${s.feedback.mine ? `<li><div class="li">${ic("star")}<span class="t"><b>تقييمك${s.feedback.mine.rating ? `: ${num(s.feedback.mine.rating)} من 5` : ""}</b>${s.feedback.mine.comment ? `<small dir="auto" data-noi18n>${h(s.feedback.mine.comment)}</small>` : ""}</span></div></li>` : ""}${s.feedback.other ? `<li><div class="li">${ic("comment")}<span class="t"><b>${s.role === "learner" ? "ملاحظة المرشد لك" : `تقييم المتعلّم${s.feedback.other.rating ? `: ${num(s.feedback.other.rating)} من 5` : ""}`}</b>${s.feedback.other.comment ? `<small dir="auto" data-noi18n>${h(s.feedback.other.comment)}</small>` : ""}</span></div></li>` : ""}</ul>` : ""}
      ${s.sharedNote ? `<div class="f-h">${s.sharedNote.by === "mentor" ? "ملخص المرشد" : "ملاحظة المتعلّم"}</div><p class="mt-quote" dir="auto" data-noi18n>${h(s.sharedNote.body)}</p>` : ""}
      ${mine && s.status !== "cancelled" ? `<div class="f-h">ملاحظاتي</div><form class="card f-form" id="mt-nf"><label><span class="vh">ملاحظاتي على الجلسة</span><textarea name="body" dir="auto" maxlength="4000" rows="4" placeholder="${h(tr(s.role === "mentor" ? "نقاط الجلسة والخطوات القادمة" : "ما تعلّمته وما تريد السؤال عنه"))}">${h(s.myNote?.body || "")}</textarea></label><label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="shared" ${s.myNote?.shared ? "checked" : ""}> مشاركتها مع ${s.role === "mentor" ? "المتعلّم" : "المرشد"}</label><button class="btn outline" type="submit">حفظ</button></form>` : ""}
      ${s.role === "guardian" ? `<div class="notice">${ic("shield")}<span>بصفتك وليّ أمر ترى موعد الجلسة وطرفيها، ويمكنك الانضمام إلى غرفتها. الملاحظات خاصة بالطرفين.</span></div>` : ""}
      <div class="mt-acts">${s.status !== "cancelled" ? `<a class="btn ghost sm" href="${h(s.icsUrl)}" download>${ic("cal")}أضف إلى التقويم</a>` : ""}${A.includes("cancel") ? `<button class="btn ghost sm u-c-dg" type="button" id="mt-cx">إلغاء الجلسة</button>` : ""}</div>
      <form class="card f-form u-mt8" id="mt-cf" hidden><label>سبب الإلغاء (يصل للطرف الآخر)<input name="reason" dir="auto" required minlength="3" maxlength="300"></label><div class="mt-acts"><button class="btn" type="submit">تأكيد الإلغاء</button><button class="btn ghost" type="button" id="mt-cf-x">تراجع</button></div></form>`;
    sessionResources(s, $("#mt-sres-slot"));
    agendaCard(id, $("#mt-ag")); /* M3-4: own section + own function (no coupling with the goals card) */
    const run = (a, body) => busy(box.querySelector(`[data-a="${a}"]`), async () => {
      const r = await api("POST", `/api/mentor-sessions/${enc(id)}/${a}`, body || {});
      if (a === "join") { if (r.roomId) location.hash = "#/room/" + enc(r.roomId); return; }
      if (a === "pay") { if (r.intent && (await payIntent(r.intent, id, s.price, r.intent.memo))) say("تم الدفع"); return sessionView(id); }
      say({ confirm: "أُكّد الموعد", decline: "أُرسل الاعتذار", complete: "اكتملت الجلسة", "no-show": "سُجّل عدم الحضور" }[a] || "تم"); sessionView(id);
    });
    box.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => run(b.dataset.a)));
    goalsCard($("#mt-goals"), id);
    const cf = $("#mt-cf");
    $("#mt-cx")?.addEventListener("click", () => { cf.hidden = false; cf.reason.focus(); });
    $("#mt-cf-x")?.addEventListener("click", () => { cf.hidden = true; $("#mt-cx")?.focus(); });
    cf.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/mentor-sessions/${enc(id)}/cancel`, { reason: cf.reason.value.trim() }); say("أُلغيت الجلسة"); sessionView(id); }); });
    $("#mt-nf")?.addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; busy(e.submitter, async () => { await api("PUT", `/api/mentor-sessions/${enc(id)}/note`, { body: f.body.value.trim(), shared: f.shared.checked }); say("حُفظت الملاحظات"); }); });
    $("#mt-fb")?.addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); busy(e.submitter, async () => { await api("POST", `/api/mentor-sessions/${enc(id)}/feedback`, { rating: f.get("rating") ? Number(f.get("rating")) : undefined, comment: String(f.get("comment") || "").trim() || undefined }); say("شكراً لتقييمك"); sessionView(id); }); });
    $("#mt-fb")?.querySelectorAll(".mt-stars input").forEach((i) => i.addEventListener("change", () => { const v = +i.value; $("#mt-fb").querySelectorAll(".mt-stars label").forEach((l, k) => l.classList.toggle("on", k < v)); }));
  }

  /* =================== v2.67 «موارد من مرشدك» (#/msession/:id) ===================
   *  Learner (and a minor's guardian, read-only) see what the mentor shared, via the existing GET /api/mentors/:handle —
   *  the server already filters resources (public for all; mentees-only for mentees with a pending/confirmed/completed
   *  session and their active guardians). No new endpoint, no migration. Nothing to show / any error → card stays absent. */
  async function sessionResources(s, slot) {
    if (!slot || !s.mentor?.handle) return;
    let d; try { d = await api("GET", "/api/mentors/" + enc(s.mentor.handle)); } catch { slot.remove(); return; }
    if (!slot.isConnected) return;
    const rb = resBlock(d?.resources, "mt-sres", s.role === "guardian" ? "موارد من المرشد" : "موارد من مرشدك", "card mt-sres");
    if (rb) slot.replaceWith(rb); else slot.remove();
  }

  /* =================== M3-3 shared goals card (#/msession/:id) ===================
   *  mentor + mentee: add (≤10), edit title/due inline, status chips, delete · guardian of a minor / staff: read-only list. */
  const GST = { todo: "لم يبدأ", doing: "قيد التنفيذ", done: "أُنجز" }, GTONE = { todo: "", doing: "warn", done: "ok" };
  async function goalsCard(el, sid, editing = null) {
    if (!el) return;
    let d; try { d = await api("GET", `/api/mentor-sessions/${enc(sid)}/goals`); } catch { el.hidden = true; return; }
    if (!el.isConnected) return;
    const ed = d.access === "edit", full = d.total >= d.max;
    const form = (g) => `<form class="f-form mt-g-form" data-gid="${g ? h(g.id) : ""}"><label>${g ? "عنوان الهدف" : "هدف جديد"}<input name="title" dir="auto" required maxlength="${d.titleMax}" value="${g ? h(g.title) : ""}" autocomplete="off"></label><label>تاريخ الاستحقاق (اختياري)<input name="due" type="date" value="${g?.due ? h(g.due) : ""}"></label><div class="mt-acts"><button class="btn${g ? "" : " sm"}" type="submit">${g ? "حفظ" : `${ic("plus")}أضف الهدف`}</button>${g ? `<button class="btn ghost" type="button" data-gx>تراجع</button>` : ""}</div></form>`;
    const row = (g) => editing === g.id ? `<li class="mt-g">${form(g)}</li>` : `<li class="mt-g${g.status === "done" ? " is-done" : ""}"><div class="mt-g-t"><b dir="auto" data-noi18n>${h(g.title)}</b>${g.due ? `<small><span>الاستحقاق:</span> <bdi dir="ltr">${h(g.due)}</bdi></small>` : ""}</div>
        ${ed ? `<div class="mt-g-st" role="group" aria-label="${h(tr("حالة الهدف"))}: ${h(g.title)}">${d.statuses.map((k) => `<button type="button" class="chip" data-gs="${k}" data-gid="${h(g.id)}" aria-pressed="${g.status === k}">${h(GST[k])}</button>`).join("")}</div>
        <div class="mt-g-act"><button class="btn ghost sm" type="button" data-ge="${h(g.id)}" aria-label="${h(tr("تعديل الهدف"))}">${ic("pen")}</button><button class="btn ghost sm u-c-dg" type="button" data-gd="${h(g.id)}" aria-label="${h(tr("حذف الهدف"))}">${ic("trash")}</button></div>` : badge(GTONE[g.status], GST[g.status])}</li>`;
    el.innerHTML = `<h3 class="f-h" id="mt-g-h">${ic("flag")}<span>الأهداف المشتركة</span>${d.total ? ` <span class="sbadge info mt-g-n"><bdi>${num(d.done)}/${num(d.total)}</bdi> <span>أُنجز</span></span>` : ""}</h3>
      <div class="card">${d.goals.length ? `<ul class="mt-g-list">${d.goals.map(row).join("")}</ul>` : UI.empty({ title: "لا أهداف بعد", text: ed ? "أضف هدفاً تعملان عليه معاً وتابعا تقدّمه من جلسة لأخرى." : "حين يضيف المرشد والمتعلّم أهدافاً ستظهر هنا." })}
      ${ed ? (full ? `<p class="f-hint"><span>بلغتما الحد الأقصى للأهداف.</span> <span>احذف هدفاً لإضافة آخر.</span></p>` : editing ? "" : form(null)) : `<p class="f-hint">${ic("eye", "xs")} للعرض فقط.</p>`}</div>`;
    if (!ed) return;
    const again = (eid = null) => goalsCard(el, sid, eid);
    el.querySelectorAll("[data-gs]").forEach((b) => b.addEventListener("click", () => { if (b.getAttribute("aria-pressed") === "true") return; busy(b, async () => { await api("PUT", `/api/mentor-goals/${enc(b.dataset.gid)}`, { status: b.dataset.gs }); say(b.dataset.gs === "done" ? "أحسنت! أُنجز الهدف" : "حُدّثت حالة الهدف"); await again(); el.querySelector(`[data-gid="${b.dataset.gid}"][data-gs="${b.dataset.gs}"]`)?.focus(); }); }));
    el.querySelectorAll("[data-ge]").forEach((b) => b.addEventListener("click", async () => { await again(b.dataset.ge); el.querySelector(".mt-g-form input[name=title]")?.focus(); }));
    el.querySelectorAll("[data-gd]").forEach((b) => b.addEventListener("click", () => { if (!confirm(tr("حذف هذا الهدف؟"))) return; busy(b, async () => { await api("DELETE", `/api/mentor-goals/${enc(b.dataset.gd)}`); say("حُذف الهدف"); await again(); }); }));
    el.querySelector("[data-gx]")?.addEventListener("click", () => again());
    el.querySelectorAll(".mt-g-form").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); const gid = f.dataset.gid, body = { title: f.title.value.trim(), due: f.due.value || null };
      busy(e.submitter, async () => { if (gid) await api("PUT", `/api/mentor-goals/${enc(gid)}`, body); else await api("POST", "/api/mentor-goals", { ...body, mentorId: d.mentorId, menteeId: d.menteeId }); say(gid ? "حُفظ الهدف" : "أُضيف الهدف"); await again(); el.querySelector(".mt-g-form input[name=title]")?.focus(); }); }));
  }

  /* =================== M3-4 session agenda (#/msession/:id) ===================
   * The learner adds ≤ 5 points (≤ 140 chars) before the start; the mentor ticks them once confirmed (during/after);
   * a minor's guardian reads them. Self-contained: fetches /agenda itself, re-renders only its own section. */
  async function agendaCard(id, el) {
    if (!el) return;
    const head = `<div class="f-h" id="mt-ag-h">أجندة الجلسة</div>`;
    let a; try { a = (await api("GET", `/api/mentor-sessions/${enc(id)}/agenda`)).agenda; } catch (e) { if (el.isConnected) { if (e?.status === 404) el.remove(); else { el.innerHTML = head + errBox(e); el.setAttribute("aria-labelledby", "mt-ag-h"); } } return; }
    const draw = (focusAdd) => {
      if (!el.isConnected) return;
      const it = a.items, n = it.length;
      const row = (x, i) => a.canTick
        ? `<li><label class="mt-ag-i${x.done ? " done" : ""}"><input type="checkbox" data-ag-tick="${i}" ${x.done ? "checked" : ""}><span class="t" dir="auto" data-noi18n>${h(x.t)}</span></label></li>`
        : `<li><div class="mt-ag-i${x.done ? " done" : ""}">${ic(x.done ? "check" : "list", "sm")}<span class="t" dir="auto" data-noi18n>${h(x.t)}</span>${x.done ? `<span class="vh">تمّت مناقشتها</span>` : ""}${a.canEdit ? `<button class="btn ghost sm icon" type="button" data-ag-del="${i}" aria-label="${h(tr("حذف النقطة"))}">${ic("x", "sm")}</button>` : ""}</div></li>`;
      const done = it.filter((x) => x.done).length;
      el.innerHTML = `${head}<div class="card mt-ag-card">${n ? `<p class="mt-ag-meta muted"><span>${num(done)} من ${num(n)}</span> · <span>${a.canTick ? "علّم ما ناقشتماه" : a.canEdit ? "يراها المرشد قبل الجلسة" : "نقاط المتعلّم للجلسة"}</span></p><ul class="mt-ag-list">${it.map(row).join("")}</ul>`
          : UI.empty({ title: "لا أجندة بعد", text: a.canEdit ? "أضف حتى 5 نقاط تريد مناقشتها مع المرشد" : a.role === "mentor" ? "لم يضف المتعلّم نقاطاً لهذه الجلسة" : "لم تُضف نقاط لهذه الجلسة" })}
        ${a.canEdit && n < a.max ? `<form class="mt-ag-add" id="mt-ag-f"><label class="vh" for="mt-ag-in">نقطة جديدة للأجندة</label><input id="mt-ag-in" name="t" dir="auto" required maxlength="${a.maxLen}" autocomplete="off" placeholder="${h(tr("مثلاً: مراجعة سيرتي الذاتية"))}"><button class="btn sm" type="submit">${ic("plus")}إضافة</button></form>` : ""}
        ${a.canEdit && n >= a.max ? `<p class="f-hint">بلغت الحد الأقصى: 5 نقاط</p>` : ""}
        ${a.role === "guardian" ? `<p class="f-hint">للاطلاع فقط</p>` : ""}</div>`;
      el.setAttribute("aria-labelledby", "mt-ag-h");
      if (focusAdd) el.querySelector("#mt-ag-in")?.focus();
    };
    const save = (body, ctl) => busy(ctl, async () => { a = (await api("PUT", `/api/mentor-sessions/${enc(id)}/agenda`, body)).agenda; draw(!!body.items); });
    el.addEventListener("submit", (e) => { if (e.target.id !== "mt-ag-f") return; e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; save({ items: [...a.items.map((x) => x.t), t] }, e.submitter); });
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-ag-del]"); if (!b) return; const i = +b.dataset.agDel; save({ items: a.items.filter((_, k) => k !== i).map((x) => x.t) }, b); });
    el.addEventListener("change", (e) => { const c = e.target.closest("[data-ag-tick]"); if (!c) return; const prev = !c.checked; save({ index: +c.dataset.agTick, done: c.checked }, c).then(() => { if (a.items[+c.dataset.agTick]?.done === prev) draw(); }); });
    draw(false);
  }

  /* =================== #/mentoring (mentor dashboard) =================== */
  async function dashboard() {
    if (!signed()) { page({ title: "لوحة المرشد", back: ["#/mentors", "الإرشاد"] }, UI.empty({ title: "سجّل الدخول", text: "لتشارك خبرتك كمرشد.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` })); return; }
    page({ title: "لوحة المرشد", icon: "cap", back: ["#/mentors", "الإرشاد"] }, `<div id="mt-d">${skel(3)}</div>`);
    let d; try { d = await api("GET", "/api/mentor/me"); } catch (e) { const b = $("#mt-d"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#mt-d"); if (!box) return;
    if (d.minor) { box.innerHTML = UI.empty({ title: "الإرشاد كمرشد متاح لمن هم ١٨ سنة فأكثر", text: "يمكنك الاستفادة من المرشدين وحجز جلسات مجانية بإشراف وليّ أمرك.", action: `<a class="btn" href="#/mentors">اكتشف المرشدين</a>` }); savedSection(box, true); return; }
    if (!d.profile) { box.innerHTML = `<section class="f-cover"><h3>شارك خبرتك</h3><small>أنشئ ملفك كمرشد، وحدّد مواعيدك الأسبوعية، واستقبل طلبات المتعلّمين وجلساتهم. مجاني، ويمكنك إيقافه متى شئت.</small></section><div class="f-h">ملفك</div>`; box.append(profileForm(d)); savedSection(box, true); return; }
    const tab = qs().get("tab") || "sessions", p = d.profile;
    box.innerHTML = `${p.status === "suspended" ? `<div class="notice danger">${ic("flag")}<span>ملفك موقوف من فريق المنصة. لا يظهر للمتعلّمين ولا يمكن حجزه.</span></div>` : !p.open ? `<div class="notice warn">${ic("lock")}<span>ملفك متوقف مؤقتاً ولا يظهر في الاكتشاف. فعّله من «الملف».</span></div>` : ""}
      ${p.allowMinors && !p.reviewed && p.status !== "suspended" ? `<div class="notice warn" id="mt-rev-need">${ic("shield")}<span>تقبل متعلّمين دون ١٨ سنة، وهذا يتطلّب مراجعة فريق المنصة لملفك. ملفك يعمل كالمعتاد أثناء المراجعة، وستظهر شارة «مراجَع من الفريق» بعد اعتماده.</span></div>` : ""}
      ${p.paid && !d.piEnabled ? `<div class="notice warn">${ic("wallet")}<span>حدّدت سعراً بـ Pi، والجلسات المدفوعة متوقفة حتى تفعيل مدفوعات Pi؛ لن يتمكن أحد من حجزك الآن. اجعل السعر 0 لتستقبل جلسات مجانية.</span></div>` : ""}
      ${!d.slots.length ? `<div class="notice warn">${ic("clock")}<span>لم تحدّد مواعيد بعد. <a class="u-fw7" href="#/mentoring?tab=availability">أضف أوقاتك الأسبوعية</a> ليتمكن المتعلّمون من الحجز.</span></div>` : ""}
      <div class="f-kpis"><div class="kpi-tile"><b>${num(d.counts.upcoming)}</b><span>جلسات قادمة</span></div><div class="kpi-tile"><b>${num(d.counts.toConfirm)}</b><span>بانتظار تأكيدك</span></div><div class="kpi-tile"><b>${num(d.counts.requests)}</b><span>طلبات جديدة</span></div><div class="kpi-tile"><b>${p.rating.count ? num(p.rating.avg, { maximumFractionDigits: 1 }) : "—"}</b><span>${p.rating.count ? `تقييمك من ${num(p.rating.count)}` : "لا تقييمات بعد"}</span></div></div>
      ${seg("#/mentoring", [["sessions", "الجلسات"], ["requests", "الطلبات"], ["insights", "إحصاءاتي"], ["availability", "المواعيد"], ["profile", "الملف"]], tab, "أقسام لوحة المرشد")}<div id="mt-dt"></div>
      <div class="list u-mt12"><a class="li" href="#/mentor/${enc(p.user.handle)}">${ic("eye")}<span class="t"><b>معاينة صفحتي العامة</b><small>كما يراها المتعلّمون</small></span><span class="chev" aria-hidden="true">←</span></a></div>`;
    const el = $("#mt-dt");
    try {
      if (tab === "profile") { el.append(completeness(d), profileForm(d), tplManager(d)); await resManager(el); previewBox(el, d); }
      else if (tab === "availability") availability(el, d);
      else if (tab === "requests") await mentorRequests(el, p.extra?.templates || []);
      else if (tab === "insights") await mentorInsights(el);
      else await mentorSessions(el);
    } catch (e) { el.innerHTML = errBox(e); }
    savedSection(box, false);
  }
  /* M4-3 «المرشدون المحفوظون» (learner side of #/mentoring): open a mentor, bell = new-slot notice on/off, remove */
  async function savedSection(box, always) {
    const sec = document.createElement("section"); sec.className = "mt-sec mt-saved"; sec.id = "mt-saved"; sec.setAttribute("aria-labelledby", "mt-saved-h");
    let d; try { d = await api("GET", "/api/mentor/saved"); } catch { return; }
    if (!box.isConnected || (!d.saved.length && !always)) return;
    const row = (x) => `<li><div class="li">${av(x.mentor.user)}<a class="t u-tdn" href="#/mentor/${enc(x.mentor.user.handle)}"><b>${u(x.mentor.user.name)}</b><small dir="auto" data-noi18n>${h(x.mentor.headline)}</small></a>
      <button class="icon-btn mt-bell" type="button" data-bell="${h(x.mentor.user.handle)}" aria-pressed="${x.notifySlots}" aria-label="تنبيه بالمواعيد الجديدة" title="تنبيه بالمواعيد الجديدة">${ic(x.notifySlots ? "bell" : "bellOff")}</button>
      <button class="icon-btn mt-save" type="button" data-msave="${h(x.mentor.user.handle)}" aria-pressed="true" aria-label="حفظ المرشد" title="حفظ المرشد">${ic("bookmarkF")}</button></div></li>`;
    sec.innerHTML = `<h3 class="f-h" id="mt-saved-h">${ic("bookmark")}المرشدون المحفوظون</h3>${d.saved.length ? `<p class="f-hint u-mb8">الجرس: نُبلغك مرة في اليوم على الأكثر حين يفتح المرشد مواعيد جديدة.</p><ul class="list">${d.saved.map(row).join("")}</ul>` : UI.empty({ title: "لا مرشدين محفوظين", text: "اضغط «حفظ» في صفحة أي مرشد لتجده هنا ويصلك تنبيه بمواعيده الجديدة.", action: `<a class="btn" href="#/mentors">اكتشف المرشدين</a>` })}`;
    box.querySelector("#mt-saved")?.remove(); if (always) box.prepend(sec); else box.append(sec); /* learner-only view: list first, above «شارك خبرتك» */
    wireSave(sec, (r) => { if (!r.saved) savedSection(box, always); });
    sec.querySelectorAll("[data-bell]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
      const on = b.getAttribute("aria-pressed") === "true";
      const r = await api("PUT", `/api/mentor/saved/${enc(b.dataset.bell)}`, { notify: !on });
      b.setAttribute("aria-pressed", String(r.notifySlots)); const svg = b.querySelector("svg"); if (svg) svg.outerHTML = ic(r.notifySlots ? "bell" : "bellOff");
      say(r.notifySlots ? "سيصلك تنبيه بالمواعيد الجديدة" : "أُوقف تنبيه المواعيد لهذا المرشد");
    })));
  }
  function profileForm(d) {
    const p = d.profile || {}, mine = new Set((p.topics || []).map((t) => t.key));
    const f = document.createElement("form"); f.className = "card f-form"; f.id = "mt-pfm";
    f.innerHTML = `<label>عنوان تعريفي<input name="headline" dir="auto" required minlength="6" maxlength="120" value="${h(p.headline || "")}" placeholder="مثلاً: مطوّرة ويب بخبرة عشر سنوات"></label>
      <label>نبذة عنك<textarea name="bio" dir="auto" maxlength="2000" rows="4" placeholder="خبرتك، كيف تساعد، ولمن تناسب جلساتك">${h(p.bio || "")}</textarea></label>
      <fieldset class="u-b0 u-p0 u-m0 u-mb12"><legend class="u-fw7 u-t-sm u-mb8">المواضيع (حتى 5)</legend><div class="mt-topics">${Object.entries(d.topics).map(([k, v]) => `<label><input type="checkbox" name="topics" value="${k}" ${mine.has(k) ? "checked" : ""}>${h(v)}</label>`).join("")}</div></fieldset>
      <label>اللغات<input name="languages" dir="auto" maxlength="80" value="${h(p.languages || "")}" placeholder="العربية، English"></label>
      <label>مدة الجلسة<select name="minutes">${d.lengths.map((n) => `<option value="${n}" ${Number(p.minutes || 45) === n ? "selected" : ""}>${num(n)} دقيقة</option>`).join("")}</select></label>
      <label>السعر بـ Pi (0 = مجانية)<input name="price" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${h(p.price ?? 0)}"><span class="f-hint">${d.piEnabled ? "تُحفظ قيمة الجلسة حتى تكتمل ثم تُحوّل إليك بعد رسوم المنصة." : "الجلسات المدفوعة متوقفة حتى تفعيل مدفوعات Pi؛ اتركها 0 لتستقبل جلسات الآن."}</span></label>
      <label>منطقتك الزمنية<input name="tz" autocomplete="off" maxlength="60" value="${h(p.tz || myTz)}" dir="ltr"><span class="f-hint">تُحسب مواعيدك الأسبوعية بهذه المنطقة، وتظهر لكل متعلّم بتوقيته.</span></label>
      ${fullEditor(p, d)}
      <label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="allowMinors" ${p.allowMinors ? "checked" : ""}> أقبل متعلّمين دون ١٨ سنة (بإشراف وليّ الأمر وجلسات مجانية فقط)</label>
      <label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="open" ${p.open !== false ? "checked" : ""}> أستقبل طلبات وجلسات جديدة</label>
      <button class="btn" type="submit">${d.profile ? "حفظ" : "إنشاء ملف المرشد"}</button>${d.profile ? `<button class="btn ghost u-c-dg u-mt8" type="button" id="mt-del">حذف ملف المرشد</button>` : ""}`;
    wireRows(f);
    f.addEventListener("submit", (e) => {
      e.preventDefault(); const topics = [...f.querySelectorAll("[name=topics]:checked")].map((x) => x.value);
      if (!topics.length) { say("اختر موضوعاً واحداً على الأقل"); return; } if (topics.length > 5) { say("اختر 5 مواضيع على الأكثر"); return; }
      const more = d.profileMeta ? readFull(f) : {};
      busy(e.submitter, async () => { await api("PUT", "/api/mentor/me", { headline: f.headline.value.trim(), bio: f.bio.value.trim() || undefined, topics, languages: f.languages.value.trim() || undefined, minutes: Number(f.minutes.value), price: Number(f.price.value || 0), tz: f.tz.value.trim(), allowMinors: f.allowMinors.checked, open: f.open.checked, ...more }); say("حُفظ الملف"); location.hash = d.profile ? "#/mentoring?tab=profile" : "#/mentoring?tab=availability"; dashboard(); });
    });
    f.querySelector("#mt-del")?.addEventListener("click", (e) => { if (!confirm("حذف ملف المرشد ومواعيده؟ تبقى جلساتك السابقة وتقييماتها.")) return; busy(e.currentTarget, async () => { await api("DELETE", "/api/mentor/me"); say("حُذف الملف"); location.hash = "#/mentors"; }); });
    return f;
  }
  /* M3 editor: approach, city, years, skills, experience, qualifications + whole-page visibility + per-field levels (adds, never replaces) */
  const VIS = { public: "عامة: يراها الجميع", members: "للأعضاء المسجّلين فقط", hidden: "مخفية: لمتعلّميّ وأولياء أمورهم فقط" };
  const LVL = { public: "للجميع", mentees: "لمتعلّميّ فقط", off: "مخفي" };
  const FLD = { photo: "الصورة", age: "العمر", city: "المدينة", experience: "الخبرات وسنواتها", qualifications: "المؤهلات", stats: "التقييمات والإحصاءات", contact: "الحجز والتواصل", communities: "مجتمعاتي" };
  const expRow = (x = {}) => `<div class="mt-row" data-row="exp"><input name="x_title" dir="auto" maxlength="80" value="${h(x.title || "")}" aria-label="المسمّى" placeholder="المسمّى"><input name="x_org" dir="auto" maxlength="80" value="${h(x.org || "")}" aria-label="الجهة" placeholder="الجهة"><input name="x_from" type="number" inputmode="numeric" min="1950" max="2100" value="${h(x.from ?? "")}" aria-label="من سنة" placeholder="من"><input name="x_to" type="number" inputmode="numeric" min="1950" max="2100" value="${h(x.to ?? "")}" aria-label="إلى سنة (فارغ = حتى الآن)" placeholder="إلى"><button class="btn ghost icon" type="button" data-rx aria-label="حذف">${ic("x")}</button></div>`;
  const qRow = (x = {}) => `<div class="mt-row" data-row="q"><input name="q_name" dir="auto" maxlength="100" value="${h(x.name || "")}" aria-label="اسم المؤهل" placeholder="اسم المؤهل"><input name="q_issuer" dir="auto" maxlength="80" value="${h(x.issuer || "")}" aria-label="الجهة المانحة" placeholder="الجهة المانحة"><input name="q_year" type="number" inputmode="numeric" min="1950" max="2100" value="${h(x.year ?? "")}" aria-label="السنة" placeholder="السنة"><input name="q_link" type="url" dir="ltr" maxlength="300" value="${h(x.link || "")}" aria-label="رابط الشهادة (https)" placeholder="https://"><button class="btn ghost icon" type="button" data-rx aria-label="حذف">${ic("x")}</button></div>`;
  function fullEditor(p, d) {
    if (!d.profileMeta) return "";
    const x = p.extra || {}, fl = { ...(d.profileMeta.fieldDefaults || {}), ...(p.fields || {}) }, vis = p.visibility || "public";
    const sel = (name, opts, cur, label) => `<label class="mt-lvl"><span>${h(label)}</span><select name="${name}">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${h(v)}</option>`).join("")}</select></label>`;
    return `<fieldset class="mt-fs" id="mt-full"><legend>الملف الكامل</legend>
      <label>أسلوبي في الإرشاد<textarea name="approach" dir="auto" maxlength="600" rows="3" placeholder="كيف تدير الجلسة، وماذا يخرج به المتعلّم">${h(x.approach || "")}</textarea></label>
      <div class="mt-two"><label>المدينة<input name="city" dir="auto" maxlength="60" value="${h(x.city || "")}"></label><label>سنوات الخبرة<input name="years" type="number" inputmode="numeric" min="0" max="60" value="${h(x.years ?? "")}"></label></div>
      <label>المهارات (افصل بينها بفاصلة، حتى 10)<input name="skills" dir="auto" maxlength="450" value="${h((x.skills || []).join("، "))}" placeholder="JavaScript، تصميم الواجهات"></label>
      <div class="mt-sub"><b>الخبرات (حتى 8)</b><div class="mt-rows" data-rows="exp">${(x.experience || []).map(expRow).join("")}</div><button class="btn ghost sm" type="button" data-radd="exp">${ic("plus")}إضافة خبرة</button></div>
      <div class="mt-sub"><b>المؤهلات والشهادات (حتى 8)</b><div class="mt-rows" data-rows="q">${(x.qualifications || []).map(qRow).join("")}</div><button class="btn ghost sm" type="button" data-radd="q">${ic("plus")}إضافة مؤهل</button></div>
      <p class="f-hint">يُحسب العمر من تاريخ ميلادك في إعدادات العمر، ولا يظهر تاريخ الميلاد لأحد.</p></fieldset>
      <fieldset class="mt-fs" id="mt-vis"><legend>الخصوصية والظهور</legend>
      ${sel("visibility", VIS, vis, "من يرى صفحتي؟")}
      <p class="f-hint">لكل معلومة اختر من يراها في صفحتك. أنت تراها دائماً هنا.</p>
      <div class="mt-lvls">${Object.keys(FLD).filter((k) => k in fl).map((k) => sel("lvl_" + k, LVL, fl[k], FLD[k])).join("")}</div></fieldset>`;
  }
  function wireRows(f) {
    f.addEventListener("click", (e) => {
      const a = e.target.closest("[data-radd]"), x = e.target.closest("[data-rx]");
      if (a) { const box = f.querySelector(`[data-rows="${a.dataset.radd}"]`); if (box.children.length >= 8) { say("الحد الأقصى 8"); return; } box.insertAdjacentHTML("beforeend", a.dataset.radd === "exp" ? expRow() : qRow()); box.lastElementChild.querySelector("input").focus(); }
      if (x) { const row = x.closest(".mt-row"), add = row.parentElement.nextElementSibling; row.remove(); add?.focus(); }
    });
  }
  function readFull(f) {
    const v = (el, n) => el.querySelector(`[name=${n}]`).value.trim(), yn = (s) => (s === "" ? null : Number(s));
    const experience = [...f.querySelectorAll('[data-row="exp"]')].map((r) => ({ title: v(r, "x_title"), org: v(r, "x_org"), from: yn(v(r, "x_from")), to: yn(v(r, "x_to")) })).filter((x) => x.title || x.from);
    const qualifications = [...f.querySelectorAll('[data-row="q"]')].map((r) => ({ name: v(r, "q_name"), issuer: v(r, "q_issuer"), year: yn(v(r, "q_year")), link: v(r, "q_link") || null })).filter((x) => x.name);
    const skills = [...new Set(f.skills.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean))];
    const fields = Object.fromEntries([...f.querySelectorAll("[name^=lvl_]")].map((s) => [s.name.slice(4), s.value]));
    return { visibility: f.visibility.value, fields, extra: { approach: f.approach.value.trim(), city: f.city.value.trim(), years: yn(f.years.value.trim()), skills, experience, qualifications } };
  }
  /* M2-5 completeness meter (CSS only, from what /api/mentor/me already returns) + «معاينة كما يراه» (server-side preview) */
  const CHECK = [["photo", "الصورة", (p) => !!p.user?.avatar], ["approach", "أسلوبي في الإرشاد", (p) => has(p.extra?.approach)], ["skills", "المهارات", (p) => has(p.extra?.skills)], ["experience", "الخبرات", (p) => has(p.extra?.experience)], ["qualifications", "المؤهلات", (p) => has(p.extra?.qualifications)], ["city", "المدينة", (p) => has(p.extra?.city)], ["slots", "المواعيد الأسبوعية", (p, d) => d.slots.length > 0]];
  function completeness(d) {
    const p = d.profile, done = CHECK.filter(([, , ok]) => ok(p, d)), miss = CHECK.filter(([, , ok]) => !ok(p, d)), pct = Math.round((done.length / CHECK.length) * 100);
    const s = document.createElement("section"); s.className = "card mt-cm"; s.id = "mt-cm"; s.setAttribute("aria-labelledby", "mt-cm-h");
    s.innerHTML = `<div class="mt-cm-hd"><h3 id="mt-cm-h">اكتمال الملف</h3><b class="mt-cm-pct" data-pct="${pct}">${num(pct)}٪</b></div>
      <div class="mt-cm-bar" role="progressbar" aria-labelledby="mt-cm-h" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i data-n="${done.length}"></i></div>
      ${miss.length ? `<p class="f-hint">أكمل ملفك ليثق بك المتعلّمون:</p><ul class="mt-cm-list">${miss.map(([k, t]) => `<li data-miss="${k}">${ic("plus", "xs")}<span>${h(t)}</span></li>`).join("")}</ul>` : `<p class="mt-cm-ok">${ic("check", "xs")}<span>ملفك مكتمل</span></p>`}`;
    return s;
  }
  const AS = [["visitor", "زائر"], ["member", "عضو"], ["mentee", "متعلّمي"], ["guardian", "وليّ أمر"]];
  function previewBox(el, d) {
    const s = document.createElement("section"); s.className = "mt-pv"; s.id = "mt-pv"; s.setAttribute("aria-labelledby", "mt-pv-h");
    s.innerHTML = `<h3 class="f-h" id="mt-pv-h">${ic("eye")}معاينة كما يراه</h3>
      <div class="seg mt-pv-seg" role="group" aria-label="معاينة كما يراه">${AS.map(([k, t], i) => `<button type="button" data-as="${k}" aria-pressed="${i ? "false" : "true"}">${h(t)}</button>`).join("")}</div>
      <p class="f-hint">تعرض المعاينة آخر ما حفظته، بقواعد الظهور نفسها التي يطبّقها الخادم.</p>
      <div class="card mt-pv-body" id="mt-pv-b" aria-live="polite">${skel(2)}</div>`;
    el.append(s);
    const load = async (as) => {
      s.querySelectorAll(".mt-pv-seg button[data-as]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.as === as)));
      const box = s.querySelector("#mt-pv-b"); box.dataset.as = as; box.innerHTML = skel(2);
      let r; try { r = await api("GET", "/api/mentor/me/preview?as=" + enc(as)); } catch (e) { if (box.dataset.as === as) box.innerHTML = errBox(e); return; }
      if (box.dataset.as !== as || !box.isConnected) return;
      if (!r.visible) { box.innerHTML = `<div class="notice warn" id="mt-pv-hidden">${ic("lock")}<span><span>لا يرى هذا الشخص صفحتك</span> — <span>${h(VIS[r.visibility] || "")}</span></span></div>`; return; }
      const m = r.mentor;
      box.innerHTML = `<div class="mt-hero">${av(m.user, "lg")}<div class="u-mw0"><b class="mt-name">${u(m.user.name)}</b><h3 dir="auto" data-noi18n>${h(m.headline)}</h3>${facts(m)}</div></div>
        <div class="mt-stats"><span><b>${m.rating?.count ? num(m.rating.avg, { maximumFractionDigits: 1 }) : "—"}</b><small>${m.rating ? (m.rating.count ? `من ${num(m.rating.count)} تقييم` : "لا تقييمات بعد") : "مخفي"}</small></span><span><b>${m.sessions != null ? num(m.sessions) : "—"}</b><small>جلسة مكتملة</small></span><span><b>${m.paid ? `${num(m.price)} Pi` : "مجاني"}</b><small>السعر</small></span></div>
        ${m.bio ? `<div class="u-lh18 mt-bio u-mt8" dir="auto" data-noi18n>${h(m.bio)}</div>` : ""}
        ${fullProfile(m)}
        <div class="mt-pv-res"></div>
        <p class="mt-pv-ct ${r.canContact ? "ok" : ""}" id="mt-pv-ct">${ic(r.canContact ? "check" : "lock", "xs")}<span>${r.canContact ? "يستطيع الحجز والتواصل معك" : "لا يستطيع الحجز أو التواصل عبر الملف"}</span></p>`;
      { const slot = box.querySelector(".mt-pv-res"), rb = resBlock(r.resources, "mt-pv-res"); if (slot) { if (rb) slot.replaceWith(rb); else slot.remove(); } }
    };
    s.querySelector(".mt-pv-seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-as]"); if (b && b.getAttribute("aria-pressed") !== "true") load(b.dataset.as); });
    load("visitor");
  }
  function availability(el, d) {
    const rows = WD.map((_, i) => d.slots.filter((s) => s.weekday === i));
    const per = (s = { start: "18:00", end: "20:00" }) => `<div class="mt-per"><input type="time" name="start" value="${h(s.start)}" step="900" aria-label="من"><span aria-hidden="true">–</span><input type="time" name="end" value="${h(s.end)}" step="900" aria-label="إلى"><button class="btn ghost icon" type="button" data-x aria-label="حذف الفترة">${ic("x")}</button></div>`;
    el.innerHTML = `<p class="u-t-sm u-c-mu u-mt0"><span>حدّد أوقاتك الأسبوعية بتوقيت</span> ${lt(d.profile.tz)}<span>. نقسّمها تلقائياً إلى جلسات من ${num(d.profile.minutes)} دقيقة، ولا يُحجز وقت قبل ١٢ ساعة من بدايته.</span></p>
      <form id="mt-av"><div class="mt-week">${WD.map((w, i) => `<section class="mt-wd" data-wd="${i}"><div class="hd"><span class="grow">${w}</span><button class="btn ghost sm" type="button" data-add>${ic("plus")}إضافة فترة</button></div><div class="pers">${rows[i].map(per).join("")}</div></section>`).join("")}</div><button class="btn u-w100 u-mt12" type="submit">حفظ المواعيد</button></form>`;
    const f = $("#mt-av");
    f.addEventListener("click", (e) => { const a = e.target.closest("[data-add]"), x = e.target.closest("[data-x]"); if (a) { const p = a.closest(".mt-wd").querySelector(".pers"); p.insertAdjacentHTML("beforeend", per()); p.lastElementChild.querySelector("input").focus(); } if (x) x.closest(".mt-per").remove(); });
    f.addEventListener("submit", (e) => { e.preventDefault(); const slots = [...f.querySelectorAll(".mt-wd")].flatMap((s) => [...s.querySelectorAll(".mt-per")].map((p) => ({ weekday: Number(s.dataset.wd), start: p.querySelector("[name=start]").value, end: p.querySelector("[name=end]").value }))); busy(e.submitter, async () => { await api("PUT", "/api/mentor/me/slots", { slots }); say("حُفظت المواعيد"); }); });
  }
  async function mentorSessions(el) {
    const [d, gs] = await Promise.all([api("GET", "/api/mentor/sessions?role=mentor&when=upcoming"), api("GET", "/api/mentor-goals/summary").catch(() => ({ mentees: {} }))]); if (!el.isConnected) return;
    const gp = (id) => { const g = gs.mentees?.[id]; return g?.total ? `<span class="mt-g-p"> · <span>الأهداف:</span> <bdi>${num(g.done)}/${num(g.total)}</bdi></span>` : ""; };
    el.innerHTML = d.sessions.length ? `<ul class="list">${d.sessions.map((s) => `<li><div class="li">${av(s.learner)}<a class="t u-tdn" href="#/msession/${enc(s.id)}"><b>${h(dayLong(s.startsAt))} · ${h(timeOf(s.startsAt))}</b><small>${u(s.learner.name)} · <span>${h(s.topic.label)}</span>${s.minor ? "<span> · دون ١٨</span>" : ""}${gp(s.learner.id)}</small></a>${s.actions.includes("confirm") ? `<button class="btn sm" type="button" data-ok="${h(s.id)}">تأكيد</button>` : badge(TONE[s.status], s.statusLabel)}</div></li>`).join("")}</ul><p class="u-mt12"><a href="#/mentors?tab=sessions&when=past" class="u-fw7">الجلسات السابقة</a> · <a href="#/mentor-certs" class="u-fw7">شهادات الإتمام</a></p>`
      : UI.empty({ title: "لا جلسات قادمة", text: "حين يحجز متعلّم موعداً يصلك إشعار لتأكيده.", action: `<a class="btn ghost" href="#/mentor-certs">شهادات الإتمام</a>` });
    el.querySelectorAll("[data-ok]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", `/api/mentor-sessions/${enc(b.dataset.ok)}/confirm`); say("أُكّد الموعد"); mentorSessions(el); })));
  }
  /* M3-6 «إحصاءاتي»: the mentor's own numbers (GET /api/mentor/insights) — KPI tiles + CSS-only month bars, no chart library.
   * Labels and numbers sit in separate nodes so the DOM translator handles the words; month names come from Intl (data-noi18n). */
  async function mentorInsights(el) {
    el.innerHTML = skel(2);
    const d = await api("GET", "/api/mentor/insights"); if (!el.isConnected) return;
    const dash = `<span class="u-c-mu">—</span>`;
    const ltr = (x) => `<bdi dir="ltr" data-noi18n>${x}</bdi>`; // number + symbol unit (%, /5) stays in reading order in RTL
    const pctOf = (x) => (x.rate === null ? dash : ltr(`${num(x.rate, { maximumFractionDigits: 1 })}<small class="mt-ins-u">%</small>`));
    const dur = (m) => { if (m === null) return dash; const [v, unit] = m < 60 ? [m, "دقائق"] : m < 1440 ? [Math.round(m / 6) / 10, "ساعات"] : [Math.round(m / 144) / 10, "أيام"]; return `${num(v, { maximumFractionDigits: 1 })} <small class="mt-ins-u">${unit}</small>`; };
    const sub = (label, n) => `<small class="mt-ins-sub"><span>${label}</span> <bdi dir="ltr" data-noi18n>${num(n)}</bdi></small>`;
    const tile = (val, label, extra = "") => `<div class="kpi-tile"><b>${val}</b><span>${label}</span>${extra}</div>`;
    const empty = !d.sessionsTotal && !d.rating.count && !d.responseMinutes.count && !d.noShow.of && !d.repeat.of;
    const max = Math.max(1, ...d.sessionsByMonth.map((x) => x.count));
    const month = (m) => fmt(m + "-15T12:00:00Z", { month: "short", year: "2-digit" });
    el.innerHTML = `${empty ? UI.empty({ title: "لا إحصاءات بعد", text: "ستظهر أرقامك هنا بعد أول جلسة مكتملة أو أول طلب تردّ عليه.", action: `<a class="btn" href="#/mentoring?tab=availability">حدّد مواعيدك</a>` }) : ""}
      <div class="f-kpis mt-ins-kpis">
        ${tile(d.rating.count ? ltr(`${num(d.rating.avg, { maximumFractionDigits: 1 })}<small class="mt-ins-u">/5</small>`) : dash, "متوسط التقييم", sub("عدد التقييمات", d.rating.count))}
        ${tile(dur(d.responseMinutes.median), "وسيط زمن الرد", sub("طلبات رددت عليها", d.responseMinutes.count))}
        ${tile(pctOf(d.noShow), "نسبة عدم الحضور", sub("جلسات منتهية", d.noShow.of))}
        ${tile(pctOf(d.repeat), "متعلّمون عادوا", sub("متعلّمون", d.repeat.of))}
      </div>
      <section class="card mt-ins-card" aria-labelledby="mt-ins-h">
        <h3 class="sh4" id="mt-ins-h">الجلسات المكتملة شهرياً</h3>
        <p class="u-m0 u-t-sm u-c-mu"><span>آخر ٦ أشهر</span> · <span>المجموع</span> <bdi dir="ltr" data-noi18n>${num(d.sessionsTotal)}</bdi></p>
        <ol class="mt-bars">${d.sessionsByMonth.map((x) => `<li><span class="mt-bar-l" data-noi18n>${h(month(x.month))}</span><span class="mt-bar-t" aria-hidden="true"><i data-v="${Math.round((x.count / max) * 100)}"></i></span><b class="mt-bar-n" data-noi18n>${num(x.count)}</b></li>`).join("")}</ol>
      </section>
      <p class="u-t-sm u-c-mu u-mt12">تُحسب الأرقام من جلساتك وطلباتك أنت فقط، ولا يراها غيرك. التقييم ونسبة العائدين منذ البداية، والباقي عن آخر ٦ أشهر.</p>`;
    el.querySelectorAll(".mt-bar-t i").forEach((i) => i.style.setProperty("--v", i.dataset.v + "%"));
  }
  async function mentorRequests(el, tpls = []) {
    const d = await api("GET", "/api/mentor/requests"); if (!el.isConnected) return;
    const pick = (rid) => (tpls.length ? `<label class="mt-tplpick"><span>${ic("mail")}<span>ردّ جاهز</span></span><select name="tpl" aria-describedby="mt-tplh-${h(rid)}"><option value="">اختر ردّاً جاهزاً</option>${tpls.map((t) => `<option value="${h(t.id)}" data-noi18n>${h(t.title)}</option>`).join("")}</select><small class="f-hint" id="mt-tplh-${h(rid)}">يُدرج النص في ردّك ويمكنك تعديله قبل الإرسال.</small></label>` : "");
    const card = (r, open) => `<li class="card"><div class="mt-who"><span>${av(r.learner)}<span><b>${u(r.learner.name)}</b><small><span>${h(r.topic.label)}</span>${r.level ? ` · <span>${h(r.level.label)}</span>` : ""}${r.minor ? "<span> · دون ١٨ بإشراف وليّ الأمر</span>" : ""}</small></span></span>${badge(TONE[r.status], open ? "طلب مفتوح" : r.statusLabel)}</div><p class="mt-quote" dir="auto" data-noi18n>${h(r.goal)}</p>
      ${r.status === "open" ? `<form class="f-form u-mt8" data-r="${h(r.id)}">${pick(r.id)}<label>ردّك (يصل للمتعلّم)<textarea name="reply" dir="auto" maxlength="600" rows="2" placeholder="أهلاً، احجز موعداً يناسبك من صفحتي"></textarea></label><div class="mt-acts"><button class="btn" type="submit" value="accept">${open ? "أستطيع المساعدة" : "قبول"}</button>${open ? "" : `<button class="btn ghost" type="submit" value="decline">اعتذار</button>`}</div></form>` : r.reply ? `<p class="f-hint"><span>ردّك:</span> ${u(r.reply)}</p>` : ""}</li>`;
    const anyOpen = [...d.received, ...d.open].some((r) => r.status === "open");
    el.innerHTML = `${!tpls.length && anyOpen ? `<p class="f-hint mt-tplnone">${ic("mail")}<span><span>وفّر وقتك:</span> <a class="u-fw7" href="#/mentoring?tab=profile">أضف ردوداً جاهزة</a> <span>واستخدمها عند الرد.</span></span></p>` : ""}<div class="f-h">طلبات وصلتك</div>${d.received.length ? `<ul class="u-lsn u-p0 u-m0">${d.received.map((r) => card(r, false)).join("")}</ul>` : UI.empty({ title: "لا طلبات مباشرة", text: "يرسل المتعلّمون طلباتهم من صفحتك العامة." })}
      <div class="f-h">طلبات مفتوحة في مواضيعك</div>${d.open.length ? `<ul class="u-lsn u-p0 u-m0">${d.open.map((r) => card(r, true)).join("")}</ul>` : UI.empty({ title: "لا طلبات مفتوحة الآن", text: "تظهر هنا طلبات المتعلّمين في المواضيع التي اخترتها." })}`;
    el.querySelectorAll("form[data-r]").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); const act = e.submitter?.value || "accept"; busy(e.submitter, async () => { await api("POST", `/api/mentor/requests/${enc(f.dataset.r)}/${act}`, { reply: f.reply.value.trim() || undefined }); say(act === "accept" ? "قُبل الطلب وأُبلغ المتعلّم" : "أُرسل الاعتذار"); mentorRequests(el, tpls); }); }));
    el.querySelectorAll("form[data-r] select[name=tpl]").forEach((sel) => sel.addEventListener("change", () => {
      const t = tpls.find((x) => x.id === sel.value); if (!t) return; const ta = sel.form.reply;
      ta.value = t.body.slice(0, 600); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); say("أُدرج الرد الجاهز — عدّله إن شئت ثم أرسل");
    }));
  }

  /* M4-5/F10 «الردود الجاهزة»: up to 8 private short replies (extra.templates, owner-only — never on the public page or preview).
   *  Add / edit / delete here; picked in the requests tab, inserted into the reply and editable before send. */
  function tplManager(d) {
    const lim = d.profileMeta?.templates || { max: 8, title: 40, body: 500 };
    let list = [...(d.profile?.extra?.templates || [])];
    const sec = document.createElement("section"); sec.className = "card f-form mt-tpl"; sec.id = "mt-tpl"; sec.setAttribute("aria-labelledby", "mt-tpl-h");
    const render = (editId = "") => {
      const ed = list.find((t) => t.id === editId), full = !ed && list.length >= lim.max;
      sec.innerHTML = `<h3 class="mt-tpl-h" id="mt-tpl-h" tabindex="-1">${ic("mail")}<span>الردود الجاهزة</span></h3>
        <p class="f-hint u-mt0">ردود قصيرة تحفظها لتستخدمها عند الرد على الطلبات. خاصة بك ولا تظهر في صفحتك.</p>
        ${list.length ? `<ul class="list mt-tpl-list">${list.map((t) => `<li><div class="li"><span class="t"><b>${u(t.title)}</b><small>${u(t.body.length > 120 ? t.body.slice(0, 120) + "…" : t.body)}</small></span><span class="mt-tpl-acts"><button class="btn ghost sm" type="button" data-tedit="${h(t.id)}" aria-label="تعديل الرد"><span>تعديل</span></button><button class="btn ghost sm" type="button" data-tdel="${h(t.id)}" aria-label="حذف الرد"><span>حذف</span></button></span></div></li>`).join("")}</ul>` : `<p class="mt-tpl-empty">لا ردود جاهزة بعد. أضف أول ردّ بالأسفل.</p>`}
        <p class="u-t-sm u-c-mu u-m0"><span>المحفوظ</span> <bdi dir="ltr" data-noi18n>${num(list.length)} / ${num(lim.max)}</bdi></p>
        ${full ? `<p class="notice warn">${ic("info")}<span>وصلت للحد الأقصى. احذف ردّاً لتضيف غيره.</span></p>` : `<form class="f-form mt-tpl-f" id="mt-tpl-f" novalidate>
          <div class="f-h u-mt0">${ed ? "تعديل الرد" : "ردّ جديد"}</div>
          <label>العنوان<input name="title" dir="auto" required maxlength="${lim.title}" value="${h(ed?.title || "")}" placeholder="مثلاً: ترحيب وحجز"></label>
          <label>النص<textarea name="body" dir="auto" required maxlength="${lim.body}" rows="3" placeholder="أهلاً بك، يسعدني مساعدتك. احجز موعداً يناسبك من صفحتي.">${h(ed?.body || "")}</textarea></label>
          <div class="mt-acts"><button class="btn" type="submit">${ed ? "حفظ التعديل" : "إضافة الرد"}</button>${ed ? `<button class="btn ghost" type="button" id="mt-tpl-x">إلغاء</button>` : ""}</div></form>`}`;
      const f = sec.querySelector("#mt-tpl-f");
      f?.addEventListener("submit", (e) => {
        e.preventDefault(); const title = f.title.value.trim(), body = f.body.value.trim();
        if (!title || !body) { say("العنوان والنص مطلوبان"); (title ? f.body : f.title).focus(); return; }
        const next = ed ? list.map((t) => (t.id === ed.id ? { ...t, title, body } : t)) : [...list, { title, body }];
        save(e.submitter, next, ed ? "حُفظ التعديل" : "أُضيف الرد الجاهز");
      });
      sec.querySelector("#mt-tpl-x")?.addEventListener("click", () => { render(); sec.querySelector(`[data-tedit="${CSS.escape(ed.id)}"]`)?.focus(); });
      if (ed) f?.title.focus();
    };
    const save = (btn, next, msg) => busy(btn, async () => {
      const r = await api("PUT", "/api/mentor/me", { extra: { templates: next } });
      list = [...(r.profile?.extra?.templates || [])]; if (d.profile) d.profile.extra = { ...(d.profile.extra || {}), templates: list };
      say(msg); render(); sec.querySelector("#mt-tpl-h")?.focus?.();
    });
    sec.addEventListener("click", (e) => {
      const ed = e.target.closest("[data-tedit]"), del = e.target.closest("[data-tdel]");
      if (ed) render(ed.dataset.tedit);
      if (del) { if (!confirm("حذف هذا الرد الجاهز؟")) return; save(del, list.filter((t) => t.id !== del.dataset.tdel), "حُذف الرد"); }
    });
    render();
    return sec;
  }

  /* =================== #/admin/mentors =================== */
  async function adminView() {
    page({ title: "الإرشاد — الإدارة", icon: "shield", back: ["#/admin", "الإدارة"] }, `<div id="mt-a">${skel(3)}</div>`);
    let d; try { d = await api("GET", "/api/admin/mentors"); } catch (e) { const b = $("#mt-a"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#mt-a"); if (!box) return; const t = d.totals;
    const f = ["all", "reviewed", "unreviewed", "minors"].includes(qs().get("tab")) ? qs().get("tab") : "all";
    const keep = (m) => f === "reviewed" ? m.reviewed : f === "unreviewed" ? !m.reviewed : f === "minors" ? m.needsReview : true;
    let rid = 0; // unique ids per render: a mentor can appear in two lists (low-rated + all)
    const revBtn = (m, k) => `<button class="btn ${m.reviewed ? "" : "outline "}sm mt-rev-t" type="button" data-rv="${m.reviewed ? "0" : "1"}" data-u="${h(m.user.id)}" aria-pressed="${m.reviewed}" aria-labelledby="mt-rv-l${k} mt-rv-n${k}">${ic(m.reviewed ? "check" : "shield", "xs")}<span id="mt-rv-l${k}">مراجَع</span></button>`;
    const row = (m) => { const k = ++rid; return `<li><div class="li">${av(m.user)}<a class="t u-tdn" href="#/mentor/${enc(m.user.handle)}"><b id="mt-rv-n${k}">${u(m.user.name)}</b><small>${u(m.headline.length > 60 ? m.headline.slice(0, 58) + "…" : m.headline)}${m.statusReason ? ` · ${u(m.statusReason)}` : ""}</small></a>${stars(m.rating)}${revBtn(m, k)}${m.status === "suspended" ? `<button class="btn sm" type="button" data-st="active" data-u="${h(m.user.id)}">إعادة</button>` : `<button class="btn ghost sm" type="button" data-st="suspended" data-u="${h(m.user.id)}">إيقاف</button>`}</div>${m.needsReview ? `<p class="mt-rev-warn" role="note">${ic("shield", "xs")}<span>يقبل متعلّمين دون ١٨ ولم يُراجَع بعد — راجِع ملفه.</span></p>` : ""}</li>`; };
    const shown = d.mentors.filter(keep);
    box.innerHTML = `<div class="f-kpis"><div class="kpi-tile"><b>${num(t.mentors)}</b><span>مرشد نشط</span></div><div class="kpi-tile"><b>${num(t.upcoming)}</b><span>جلسة قادمة</span></div><div class="kpi-tile"><b>${num(t.completed)}</b><span>جلسة مكتملة</span></div><div class="kpi-tile"><b>${num(t.openRequests)}</b><span>طلب مفتوح</span></div></div>
      ${!d.piEnabled ? `<div class="notice warn">${ic("wallet")}<span>مدفوعات Pi غير مفعّلة: لا جلسات مدفوعة.</span></div>` : ""}
      <div class="f-h">مبالغ يجب إعادتها</div>${d.refunds.length ? `<ul class="list">${d.refunds.map((s) => `<li><a class="li" href="#/msession/${enc(s.id)}">${ic("wallet")}<span class="t"><b><span>${num(s.price)} Pi</span> · ${u(s.learner?.name)}</b><small>${s.cancelReason ? `${u(s.cancelReason)} · ` : ""}<span>${h(dayLong(s.startsAt))}</span></small></span>${badge("warn", "إعادة المبلغ")}</a></li>`).join("")}</ul>` : UI.empty({ title: "لا مبالغ معلّقة" })}
      ${d.lowRated.length ? `<div class="f-h">تقييمات منخفضة</div><ul class="list">${d.lowRated.map(row).join("")}</ul>` : ""}
      ${t.needsReview ? `<div class="notice warn" id="mt-rev-flag">${ic("shield")}<span><span>مرشدون يقبلون متعلّمين دون ١٨ بانتظار مراجعة الفريق:</span> <b>${num(t.needsReview)}</b></span></div>` : ""}
      <div class="f-h">المرشدون (${num(t.mentors + t.suspended)})</div>${seg("#/admin/mentors", [["all", "الكل"], ["reviewed", "مراجَعون"], ["unreviewed", "غير مراجَعين"], ["minors", "تحتاج مراجعة"]], f, "تصفية المرشدين حسب المراجعة")}${shown.length ? `<ul class="list" id="mt-a-list">${shown.map(row).join("")}</ul>` : UI.empty({ title: d.mentors.length ? "لا نتائج لهذا التصنيف" : "لا مرشدين بعد" })}`;
    box.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { const on = b.dataset.rv === "1"; await api("POST", `/api/admin/mentors/${enc(b.dataset.u)}/review`, { reviewed: on }); say(on ? "عُلِّم الملف مراجَعاً" : "أُزيلت علامة المراجعة"); adminView(); })));
    box.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { let reason; if (b.dataset.st === "suspended") { reason = prompt(tr("سبب الإيقاف (يُلغي الجلسات القادمة ويُبلَّغ المتعلّمون)")); if (!reason || reason.trim().length < 3) return; } busy(b, async () => { await api("POST", `/api/admin/mentors/${enc(b.dataset.u)}/status`, { status: b.dataset.st, reason }); say(b.dataset.st === "suspended" ? "أُوقف الملف" : "أُعيد الملف"); adminView(); }); }));
  }

  MPRoutes.extend((a, b, base) => {
    return { mentors: () => hub(), mentor: () => (a ? profileView(decodeURIComponent(a)) : hub()), msession: () => sessionView(a), mentoring: () => dashboard() };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "mentors" ? ((() => { try { return S.me()?.role === "admin"; } catch { return false; } })() ? adminView() : page({ title: "الإرشاد — الإدارة", back: ["#/mentors", "الإرشاد"] }, UI.empty({ title: "للإدارة فقط" }))) : next()));
  window.MPMentor = { hub, profileView, sessionView, dashboard, adminView, version: "__APP_VERSION__" };
  if (/^#\/(mentors|mentor|msession|mentoring|admin\/mentors)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
