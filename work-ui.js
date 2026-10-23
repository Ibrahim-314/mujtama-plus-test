/* =====================================================================
 * مجتمع بلس — Track 16 UI «العمل والفرص» (lazy "work" chunk + work.css; 0 bytes in core besides the route names, a profile
 * link and a settings row). Phase 76: professional profile & CV.
 *   #/cv                      my professional profile: completeness, basics, entries (experience / education / portfolio /
 *                             volunteering / awards) with reorder, skills, languages & links, privacy, export (PDF / HTML / JSON)
 *   #/cv/:handle[?as=stranger|member|follower]   a member's professional profile (owner preview as others see it)
 *   #/talent[?q=&open=&skill=&city=]             talent directory
 *   #/admin/pro               staff: reported profiles, hide / restore
 * Phase 77: jobs & freelance.
 *   #/jobs[?tab=mine&q=&kind=&category=&mode=&city=&skill=&minPay=&sort=]   browse (search + filter sheet) · my postings,
 *                             applications and saved · #/jobs/new · #/job/:id[/edit|/applicants[?status=]] · #/application/:id
 *                             (both sides: status, cover, answers, timeline + messages, employer next step + private note)
 *   #/admin/jobs              staff: review queue with reasons, reports
 * Phase 78: contracts & escrow.
 *   #/contracts[?tab=closed]  my contracts · #/contracts/new[?app=|to=] offer (milestones, revisions) · #/contract/:id (offer reply,
 *                             milestones: fund / submit / approve / revision / dispute, timeline + messages, cancel)
 *   #/admin/contracts         staff: open disputes → release / refund / split
 * PDF: the printable page /cv/<handle> is printed from a hidden same-origin frame («حفظ كملف PDF» in the print dialog).
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function WorkUI() {
  if (window.MPWork) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => UI.icon(n, c);
  const num = (n, o) => UI.num(n, o);
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const meHandle = () => { try { return S.me()?.handle || ""; } catch { return ""; } };
  const errBox = (e) => UI.empty({ title: e?.code === "no_profile" ? "لا يوجد ملف مهني" : "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم" });
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const page = (head, body) => { view.innerHTML = `<div class="wrap wk-page">${UI.pageHead({ ...head, id: "wk-h" })}${body}</div>`; $("#wk-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const av = (u, cls = "") => { const src = u && typeof avSrc === "function" ? avSrc(u, "") : null; return `<span class="wk-av ${cls}" aria-hidden="true">${src ? `<img src="${h(src)}" alt="" loading="lazy" decoding="async">` : h(String(u?.name || "؟").trim()[0] || "؟")}</span>`; };
  const sheetQ = (s) => document.querySelector("#sheet " + s);
  const ym = (s) => (s ? s.replace(/^(\d{4})-(\d{2})$/, "$2/$1") : "");
  const range = (i) => [ym(i.start), i.current ? "حتى الآن" : ym(i.end)].filter(Boolean).join(" – ");
  const LVL = ["", "مبتدئ", "أساسي", "متوسط", "متقدم", "خبير"];
  const KIND_ICO = { experience: "brief", education: "cap", portfolio: "grid", volunteering: "heart", award: "medal" };
  const ADD_TXT = { experience: "إضافة خبرة", education: "إضافة مؤهل", portfolio: "إضافة عمل", volunteering: "إضافة تطوّع", award: "إضافة جائزة" };
  const EMPTY_TXT = { experience: "أضف وظائفك ومشاريعك السابقة والحالية.", education: "أضف شهاداتك الدراسية ودوراتك.", portfolio: "اعرض أفضل أعمالك برابط أو بمنشور من منشوراتك.", volunteering: "التطوّع خبرة حقيقية؛ أضفه هنا.", award: "الجوائز والإنجازات تميّزك." };
  const dec1 = (x) => num(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  /* phase 80: reputation — compact «★ 4.8 (12)» and the CV strip */
  const rt = (r) => (r && r.count ? `<span class="wk-rt" aria-label="التقييم ${dec1(r.avg)} من ${num(5)} من ${num(r.count)} تقييمات">${ic("star", "xs")}${dec1(r.avg)} <small>(${num(r.count)})</small></span>` : r && r.completed ? `<span class="wk-ft">${num(r.completed)} أعمال منجزة</span>` : "");
  const repStrip = (r, handle, self) => (!r || (!r.count && !r.completed?.total && !self) ? "" : `<section class="card wk-sec wk-rep" aria-label="السمعة المهنية">${r.count ? `<span class="wk-sc">${ic("star")}${dec1(r.avg)}</span><small>${num(r.count)} تقييم موثّق${r.isNew ? " · جديد" : ""}</small>` : `<small>لا تقييمات موثّقة بعد</small>`}<small>${num(r.completed?.total || 0)} أعمال منجزة</small><a class="btn outline sm" href="#/reviews/u/${enc(handle)}">${ic("comment")}التقييمات${self ? " والردود" : ""}</a>${r.badges?.length ? `<ul class="wk-chips" aria-label="الشارات المهنية">${r.badges.map((b) => `<li><span class="sbadge info" title="${h(b.hint)}">${h(b.label)}</span></li>`).join("")}</ul>` : ""}</section>`);
  const chipList = (arr) => (arr && arr.length ? `<ul class="wk-chips" aria-label="منفتح على">${arr.map((o) => `<li><span class="sbadge info">${h(o.label)}</span></li>`).join("")}</ul>` : "");

  /* printable CV → hidden same-origin frame → the browser's print dialog («حفظ كملف PDF») */
  function printCv(handle) {
    document.querySelector("iframe.wk-print")?.remove();
    const f = document.createElement("iframe"); f.className = "wk-print"; f.title = "السيرة الذاتية للطباعة"; f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
    f.src = "/cv/" + enc(handle);
    f.addEventListener("load", () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(f.src, "_blank", "noopener"); } setTimeout(() => f.remove(), 120000); });
    document.body.appendChild(f); say("جارٍ تجهيز السيرة… اختر «حفظ كملف PDF» في نافذة الطباعة");
  }

  /* entry markup shared by the editor and the public page */
  function itemBody(i) {
    const sub = [i.org, i.place, range(i)].filter(Boolean).map(h).join(" · ");
    const link = i.url ? `<a class="wk-link" href="${h(i.url)}" target="_blank" rel="noopener noreferrer nofollow">${ic("link", "xs")}<bdi>${h(i.url.replace(/^https?:\/\//, "").slice(0, 60))}</bdi></a>` : "";
    const post = i.post ? `<a class="wk-link" href="#/post/${enc(i.post.id)}">${ic("doc", "xs")}${h(i.post.title || "منشور في مجتمع بلس")}</a>` : "";
    return `<b>${h(i.title)}</b>${sub ? `<small>${sub}</small>` : ""}${i.body ? `<p>${h(i.body)}</p>` : ""}${link || post ? `<span class="wk-links">${link}${post}</span>` : ""}`;
  }

  /* =================== #/cv — my professional profile =================== */
  async function editorView() {
    page({ title: "ملفي المهني", icon: "brief", sub: "سيرتك الذاتية داخل مجتمع بلس: خبراتك ومهاراتك وأعمالك، بخصوصية تتحكم فيها.", actions: `<a class="btn outline sm" href="#/jobs">${ic("brief")}الوظائف</a><a class="btn outline sm" href="#/talent">${ic("search")}دليل المواهب</a>` }, `<div id="wk-b">${skel(5)}</div>`);
    const box = $("#wk-b");
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول أولاً", text: "أنشئ ملفك المهني لتعرض خبراتك وتتقدّم للفرص.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    let d; try { d = await api("GET", "/api/pro/me"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    if (!d.profile) return startForm(box, d);
    const P = d.profile, mine = meHandle(), c = d.completeness;
    const items = (k) => d.items.filter((i) => i.kind === k);
    const sec = (k) => { const list = items(k); return `<section class="card wk-sec" aria-labelledby="wk-s-${k}"><div class="wk-sh"><h3 id="wk-s-${k}">${ic(KIND_ICO[k])}${h(d.options.kinds[k])}</h3><button class="btn ghost sm" type="button" data-add="${k}">${ic("plus")}${ADD_TXT[k]}</button></div>
      ${list.length ? `<ol class="wk-items">${list.map((i, n) => `<li class="wk-item">${itemBody(i)}<span class="wk-ia"><button class="btn ghost icon" type="button" data-up="${h(i.id)}" aria-label="تحريك «${h(i.title)}» للأعلى" ${n === 0 ? "disabled" : ""}>${ic("arrowUp")}</button><button class="btn ghost icon wk-dn" type="button" data-dn="${h(i.id)}" aria-label="تحريك «${h(i.title)}» للأسفل" ${n === list.length - 1 ? "disabled" : ""}>${ic("arrowUp")}</button><button class="btn ghost sm" type="button" data-ed="${h(i.id)}">تعديل</button><button class="btn ghost sm" type="button" data-del="${h(i.id)}" aria-label="حذف «${h(i.title)}»">حذف</button></span></li>`).join("")}</ol>` : `<p class="wk-none">${EMPTY_TXT[k]}</p>`}</section>`; };
    box.innerHTML = `${P.hidden ? `<div class="notice warn">${ic("alert")}<span>أخفى فريق المنصة ملفك المهني مؤقتاً${P.hiddenReason ? `: «${h(P.hiddenReason)}»` : ""}. عدّل ما يلزم وراسل الدعم من «تذاكر الدعم».</span></div>` : ""}
      ${d.minor ? `<div class="notice">${ic("shield")}<span>لأنك دون ١٨ سنة: ملفك لا يكون عاماً ولا يظهر في دليل المواهب، ولا يُعرض فيه عمل مدفوع.</span></div>` : ""}
      <section class="f-cover wk-done"><div class="u-f1"><h3>اكتمال ملفك ${num(c.percent)}٪</h3><progress max="100" value="${c.percent}" aria-label="نسبة اكتمال الملف">${c.percent}٪</progress><small>${c.missing.length ? `الخطوة التالية: ${h(c.missing[0].text)}` : "ملفك مكتمل — حدّثه كلما أنجزت شيئاً جديداً."}</small></div></section>
      <div class="wk-acts"><a class="btn sm" href="#/cv/${enc(mine)}">${ic("eye")}عرض ملفي</a><button class="btn outline sm" type="button" id="wk-pdf">${MPFeat.ico("doc", "sm")}تنزيل PDF</button><span class="wk-views">${ic("eye", "xs")} ${num(P.views)} مشاهدة</span></div>
      <section class="card wk-sec" aria-labelledby="wk-s-basic"><div class="wk-sh"><h3 id="wk-s-basic">${ic("user")}الأساسيات</h3><button class="btn ghost sm" type="button" id="wk-eb">تعديل</button></div>
        <p class="wk-hl">${h(P.headline)}</p>${P.city || P.country ? `<p class="wk-meta">${ic("mapPin", "xs")} ${h([P.city, P.country].filter(Boolean).join("، "))}</p>` : ""}
        ${chipList(P.openTo.map((k) => ({ label: (d.options.openTo.find((o) => o.key === k) || { label: k }).label })))}
        ${P.about ? `<p class="wk-about">${h(P.about)}</p>` : `<p class="wk-none">أضف نبذة قصيرة عنك وعمّا تتقنه.</p>`}</section>
      ${sec("experience")}${sec("education")}
      <section class="card wk-sec" aria-labelledby="wk-s-skills"><div class="wk-sh"><h3 id="wk-s-skills">${MPFeat.ico("bulb", "sm")}المهارات</h3><button class="btn ghost sm" type="button" id="wk-es">تعديل</button></div>
        ${d.skills.length ? `<ul class="wk-skills">${d.skills.map((s) => `<li><b>${h(s.name)}</b><small>${LVL[s.level]}${s.years ? ` · ${num(s.years)} سنوات` : ""}</small></li>`).join("")}</ul>` : `<p class="wk-none">أضف مهاراتك ليجدك أصحاب الفرص.</p>`}</section>
      ${sec("portfolio")}
      ${d.certificates ? `<section class="card wk-sec"><div class="wk-sh"><h3>${MPFeat.ico("medal", "sm")}الشهادات الموثّقة</h3><a class="btn ghost sm" href="#/certificates">إدارة</a></div><p class="wk-none">${num(d.certificates)} شهادة موثّقة تظهر في ملفك ويمكن لأي جهة التحقق منها.</p></section>` : ""}
      ${sec("volunteering")}${sec("award")}
      <section class="card wk-sec" aria-labelledby="wk-s-lang"><div class="wk-sh"><h3 id="wk-s-lang">${ic("globe")}اللغات والروابط</h3><button class="btn ghost sm" type="button" id="wk-el">تعديل</button></div>
        ${P.languages.length ? `<ul class="wk-skills">${P.languages.map((l) => `<li><b>${h(l.name)}</b><small>${h(d.options.levels[l.level] || "")}</small></li>`).join("")}</ul>` : `<p class="wk-none">لم تضف لغات بعد.</p>`}
        ${P.links.length ? `<span class="wk-links">${P.links.map((l) => `<a class="wk-link" href="${h(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${ic("link", "xs")}${h(l.label)}</a>`).join("")}</span>` : ""}</section>
      <section class="card wk-sec" aria-labelledby="wk-s-priv"><div class="wk-sh"><h3 id="wk-s-priv">${ic("lock")}الخصوصية والظهور</h3></div>
        <form class="f-form" id="wk-pv"><label>من يرى ملفك المهني؟<select name="visibility">${d.options.visibility.map((o) => `<option value="${o.key}" ${P.visibility === o.key ? "selected" : ""}>${h(o.label)}</option>`).join("")}</select></label>
          <details class="wk-det"><summary>خصوصية كل قسم</summary><p class="f-hint">يمكن أن يكون القسم أضيق ظهوراً من الملف، لا أوسع.</p><div class="wk-two">${Object.entries(d.options.sections).map(([k, v]) => `<label>${h(v)}<select name="s_${k}"><option value="">مثل الملف</option>${["members", "followers", "private"].map((x) => `<option value="${x}" ${P.sections[k] === x ? "selected" : ""}>${{ members: "الأعضاء", followers: "متابعيّ", private: "أنا فقط" }[x]}</option>`).join("")}</select></label>`).join("")}</div></details>
          <label class="wk-sw"><input type="checkbox" class="switch" name="searchable" ${P.searchable ? "checked" : ""} ${d.minor ? "disabled" : ""}><span>أظهِرني في دليل المواهب</span></label>
          <label class="wk-sw"><input type="checkbox" class="switch" name="showCerts" ${P.showCerts ? "checked" : ""}><span>اعرض شهاداتي الموثّقة العامة</span></label>
          <button class="btn" type="submit">حفظ الخصوصية</button></form>
        <p class="f-hint u-mt8">معاينة ملفك كما يراه: <a href="#/cv/${enc(mine)}?as=stranger">زائر</a> · <a href="#/cv/${enc(mine)}?as=member">عضو</a> · <a href="#/cv/${enc(mine)}?as=follower">متابع</a></p></section>
      <section class="card wk-sec" aria-labelledby="wk-s-exp"><div class="wk-sh"><h3 id="wk-s-exp">${ic("download")}التصدير</h3></div>
        <div class="wk-acts"><button class="btn outline sm" type="button" id="wk-pdf2">PDF للطباعة</button><a class="btn outline sm" href="${h(d.cvUrl)}?download=1" download>ملف HTML</a><button class="btn outline sm" type="button" id="wk-json">JSON Resume</button></div>
        <p class="f-hint">JSON Resume صيغة مفتوحة تنقل سيرتك إلى مواقع ومحررات أخرى.</p></section>
      <details class="card wk-danger"><summary>${ic("x")} حذف الملف المهني</summary><p class="f-hint">يُحذف ملفك المهني وكل خبراتك ومهاراتك نهائياً. لا يتأثر حسابك ولا منشوراتك.</p><button class="btn danger sm" type="button" id="wk-delp">حذف الملف المهني نهائياً</button></details>`;
    $("#wk-pdf").addEventListener("click", () => printCv(mine)); $("#wk-pdf2").addEventListener("click", () => printCv(mine));
    $("#wk-json").addEventListener("click", (e) => busy(e.currentTarget, async () => { const j = await api("GET", "/api/pro/me/export"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" })); a.download = `resume-${mine}.json`; document.body.appendChild(a); a.click(); a.remove(); }));
    $("#wk-eb").addEventListener("click", () => basicsSheet(d));
    $("#wk-es").addEventListener("click", () => skillsSheet(d));
    $("#wk-el").addEventListener("click", () => langSheet(d));
    box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => itemSheet(b.dataset.add, null)));
    box.querySelectorAll("[data-ed]").forEach((b) => b.addEventListener("click", () => itemSheet(null, d.items.find((i) => i.id === b.dataset.ed))));
    box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { if (!confirm("حذف هذا العنصر؟")) return; busy(b, async () => { await api("DELETE", "/api/pro/me/items/" + enc(b.dataset.del)); say("حُذف"); editorView(); }); }));
    const move = (iid, dir, b) => { const it = d.items.find((i) => i.id === iid); const list = items(it.kind).map((i) => i.id), n = list.indexOf(iid), m = n + dir; if (m < 0 || m >= list.length) return; [list[n], list[m]] = [list[m], list[n]]; busy(b, async () => { await api("POST", "/api/pro/me/items/reorder", { kind: it.kind, ids: list }); await editorView(); view.querySelector(`[data-${dir < 0 ? "up" : "dn"}="${CSS.escape(iid)}"]:not([disabled])`)?.focus(); }); };
    box.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => move(b.dataset.up, -1, b)));
    box.querySelectorAll("[data-dn]").forEach((b) => b.addEventListener("click", () => move(b.dataset.dn, 1, b)));
    $("#wk-pv").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target, sections = {}; for (const k of Object.keys(d.options.sections)) { const v = f["s_" + k].value; if (v) sections[k] = v; } busy(e.submitter, async () => { await api("PUT", "/api/pro/me", { visibility: f.visibility.value, sections, searchable: f.searchable.checked, showCerts: f.showCerts.checked }); say("حُفظت إعدادات الخصوصية"); }); });
    $("#wk-delp").addEventListener("click", (e) => { if (!confirm("حذف ملفك المهني نهائياً؟ لا يمكن التراجع.")) return; busy(e.currentTarget, async () => { await api("DELETE", "/api/pro/me"); say("حُذف ملفك المهني"); editorView(); }); });
  }
  const openToBoxes = (d, sel) => `<fieldset class="wk-fs"><legend>منفتح على</legend><div class="wk-checks">${d.options.openTo.map((o) => `<label class="wk-ck"><input type="checkbox" name="openTo" value="${o.key}" ${sel.includes(o.key) ? "checked" : ""}><span>${h(o.label)}</span></label>`).join("")}</div></fieldset>`;
  const basicsFields = (d, P = {}) => `<label>العنوان المهني<input name="headline" required minlength="3" maxlength="120" value="${h(P.headline || "")}" placeholder="مثلاً: مطوّر تطبيقات جوال — Flutter"></label>
      <label>نبذة عنك<textarea name="about" maxlength="2600" rows="5" placeholder="من أنت، ماذا تتقن، وما الذي تبحث عنه؟">${h(P.about || "")}</textarea></label>
      <div class="wk-two"><label>المدينة<input name="city" maxlength="60" value="${h(P.city || "")}"></label><label>البلد<input name="country" maxlength="60" value="${h(P.country || "")}"></label></div>
      ${openToBoxes(d, P.openTo || [])}`;
  const basicsBody = (f) => ({ headline: f.headline.value.trim(), about: f.about.value.trim() || null, city: f.city.value.trim() || null, country: f.country.value.trim() || null, openTo: [...f.querySelectorAll("[name=openTo]:checked")].map((x) => x.value) });
  function startForm(box, d) {
    box.innerHTML = `<section class="f-cover"><h3>ابدأ ملفك المهني</h3><small>عنوان مهني واحد يكفي للبداية؛ أضف خبراتك ومهاراتك بعد ذلك. أنت تختار من يراه.</small></section>
      <form class="card f-form" id="wk-new">${basicsFields(d)}<label>من يرى ملفك؟<select name="visibility">${d.options.visibility.map((o) => `<option value="${o.key}" ${o.key === (d.minor ? "followers" : "members") ? "selected" : ""}>${h(o.label)}</option>`).join("")}</select></label><button class="btn" type="submit">إنشاء الملف المهني</button></form>`;
    $("#wk-new").addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", "/api/pro/me", { ...basicsBody(e.target), visibility: e.target.visibility.value }); say("أُنشئ ملفك المهني"); editorView(); }); });
  }
  function basicsSheet(d) {
    sheet(`<h3 class="u-mt0">الأساسيات</h3><form class="f-form" id="wk-bf">${basicsFields(d, d.profile)}<div class="wk-acts"><button class="btn" type="submit">حفظ</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`);
    const f = sheetQ("#wk-bf"); f.headline.focus();
    f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", "/api/pro/me", basicsBody(f)); closeSheet(); say("حُفظ"); editorView(); }); });
  }
  function itemSheet(kind, it) {
    kind = kind || it.kind; const K = { experience: ["المسمى الوظيفي", "جهة العمل"], education: ["المؤهل أو التخصص", "الجامعة أو الجهة"], portfolio: ["اسم العمل", "العميل أو الجهة (اختياري)"], volunteering: ["الدور", "الجهة"], award: ["الجائزة أو الإنجاز", "الجهة المانحة"] }[kind];
    const dated = kind === "experience" || kind === "education", I = it || {};
    sheet(`<h3 class="u-mt0">${it ? "تعديل" : ADD_TXT[kind]}</h3><form class="f-form" id="wk-if">
      <label>${K[0]}<input name="title" required minlength="2" maxlength="120" value="${h(I.title || "")}"></label>
      <label>${K[1]}<input name="org" maxlength="120" value="${h(I.org || "")}"></label>
      ${kind !== "award" ? `<label>المكان<input name="place" maxlength="120" value="${h(I.place || "")}" placeholder="المدينة أو «عن بُعد»"></label>` : ""}
      <div class="wk-two"><label>${dated ? "من" : "التاريخ"}<input type="month" name="start" value="${h(I.start || "")}" ${dated ? "required" : ""} max="${new Date().toISOString().slice(0, 7)}"></label>${kind !== "award" ? `<label>إلى<input type="month" name="end" value="${h(I.end || "")}" max="${new Date().toISOString().slice(0, 7)}" ${I.current ? "disabled" : ""}></label>` : ""}</div>
      ${kind !== "award" ? `<label class="wk-sw"><input type="checkbox" class="switch" name="current" ${I.current ? "checked" : ""}><span>${kind === "education" ? "أدرس حالياً" : "مستمر حتى الآن"}</span></label>` : ""}
      <label>الوصف<textarea name="body" rows="4" maxlength="2000" placeholder="${kind === "portfolio" ? "ماذا أنجزت، وما الأدوات التي استخدمتها؟" : "المهام والإنجازات بأرقام إن أمكن"}">${h(I.body || "")}</textarea></label>
      <label>رابط (اختياري)<input type="url" name="url" maxlength="300" dir="ltr" value="${h(I.url || "")}" placeholder="https://"></label>
      ${kind === "portfolio" ? `<label>أو منشور من منشوراتك<input name="post" maxlength="200" dir="ltr" value="${h(I.postId || "")}" placeholder="رابط المنشور أو رقمه"></label>` : ""}
      <div class="wk-acts"><button class="btn" type="submit">حفظ</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`);
    const f = sheetQ("#wk-if"); f.title.focus();
    f.current?.addEventListener("change", () => { if (f.end) { f.end.disabled = f.current.checked; if (f.current.checked) f.end.value = ""; } });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const postRaw = f.post ? f.post.value.trim() : "", postId = postRaw ? (/#\/post\/([\w-]+)/.exec(postRaw)?.[1] || postRaw.replace(/^.*\//, "")) : null;
      const b = { title: f.title.value.trim(), org: f.org.value.trim() || null, place: f.place ? f.place.value.trim() || null : null, start: f.start.value || null, end: f.end && !f.end.disabled ? f.end.value || null : null, current: !!f.current?.checked, body: f.body.value.trim() || null, url: f.url.value.trim() || null, ...(f.post ? { postId } : {}) };
      busy(e.submitter, async () => { if (it) await api("PATCH", "/api/pro/me/items/" + enc(it.id), b); else await api("POST", "/api/pro/me/items", { kind, ...b }); closeSheet(); say("حُفظ"); editorView(); });
    });
  }
  function rowsSheet({ title, id, rows, row, empty, add, collect, save }) {
    sheet(`<h3 class="u-mt0">${title}</h3><form class="f-form" id="${id}"><ol class="wk-rows">${rows.map(row).join("")}</ol><button class="btn ghost sm" type="button" data-addrow>${ic("plus")}${add}</button><div class="wk-acts"><button class="btn" type="submit">حفظ</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`);
    const f = sheetQ("#" + id), ol = f.querySelector(".wk-rows");
    const wire = () => ol.querySelectorAll("[data-rm]:not([data-w])").forEach((b) => { b.dataset.w = "1"; b.addEventListener("click", () => b.closest("li").remove()); });
    f.querySelector("[data-addrow]").addEventListener("click", () => { ol.insertAdjacentHTML("beforeend", row(empty)); wire(); ol.lastElementChild.querySelector("input")?.focus(); });
    if (!rows.length) f.querySelector("[data-addrow]").click(); wire();
    f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await save(collect(ol)); closeSheet(); say("حُفظ"); editorView(); }); });
  }
  let rowSeq = 0;
  function skillsSheet(d) {
    rowsSheet({ title: "المهارات", id: "wk-sf", rows: d.skills, add: "إضافة مهارة", empty: { name: "", level: 3, years: "" },
      row: (s) => { const n = ++rowSeq; return `<li class="wk-row"><label class="u-f1"><span class="vh">المهارة ${n}</span><input name="name" maxlength="40" value="${h(s.name)}" placeholder="المهارة" required minlength="2"></label><label><span class="vh">المستوى</span><select name="level">${LVL.slice(1).map((t, i) => `<option value="${i + 1}" ${Number(s.level) === i + 1 ? "selected" : ""}>${t}</option>`).join("")}</select></label><label class="wk-yr"><span class="vh">سنوات الخبرة</span><input name="years" type="number" min="0" max="60" inputmode="numeric" value="${h(s.years ?? "")}" placeholder="سنوات"></label><button class="btn ghost icon" type="button" data-rm aria-label="إزالة المهارة">${ic("x")}</button></li>`; },
      collect: (ol) => [...ol.children].map((li) => ({ name: li.querySelector("[name=name]").value.trim(), level: Number(li.querySelector("[name=level]").value), years: li.querySelector("[name=years]").value })).filter((s) => s.name),
      save: (skills) => api("PUT", "/api/pro/me/skills", { skills }) });
  }
  function langSheet(d) {
    const P = d.profile, LV = d.options.levels;
    sheet(`<h3 class="u-mt0">اللغات والروابط</h3><form class="f-form" id="wk-lf"><div class="f-h">اللغات</div><ol class="wk-rows" id="wk-lr"></ol><button class="btn ghost sm" type="button" id="wk-al">${ic("plus")}إضافة لغة</button>
      <div class="f-h">الروابط</div><ol class="wk-rows" id="wk-kr"></ol><button class="btn ghost sm" type="button" id="wk-ak">${ic("plus")}إضافة رابط</button>
      <div class="wk-acts"><button class="btn" type="submit">حفظ</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`);
    const f = sheetQ("#wk-lf"), lr = f.querySelector("#wk-lr"), kr = f.querySelector("#wk-kr");
    const lrow = (l) => `<li class="wk-row"><label class="u-f1"><span class="vh">اللغة</span><input name="lname" maxlength="30" value="${h(l.name)}" placeholder="اللغة" required minlength="2"></label><label><span class="vh">المستوى</span><select name="llevel">${Object.entries(LV).map(([k, v]) => `<option value="${k}" ${l.level === k ? "selected" : ""}>${h(v)}</option>`).join("")}</select></label><button class="btn ghost icon" type="button" data-rm aria-label="إزالة اللغة">${ic("x")}</button></li>`;
    const krow = (l) => `<li class="wk-row"><label><span class="vh">اسم الرابط</span><input name="klabel" maxlength="40" value="${h(l.label)}" placeholder="الاسم"></label><label class="u-f1"><span class="vh">الرابط</span><input name="kurl" type="url" maxlength="300" dir="ltr" value="${h(l.url)}" placeholder="https://" required></label><button class="btn ghost icon" type="button" data-rm aria-label="إزالة الرابط">${ic("x")}</button></li>`;
    const wire = (ol) => ol.querySelectorAll("[data-rm]:not([data-w])").forEach((b) => { b.dataset.w = "1"; b.addEventListener("click", () => b.closest("li").remove()); });
    lr.innerHTML = P.languages.map(lrow).join(""); kr.innerHTML = P.links.map(krow).join(""); wire(lr); wire(kr);
    f.querySelector("#wk-al").addEventListener("click", () => { lr.insertAdjacentHTML("beforeend", lrow({ name: "", level: "good" })); wire(lr); lr.lastElementChild.querySelector("input").focus(); });
    f.querySelector("#wk-ak").addEventListener("click", () => { kr.insertAdjacentHTML("beforeend", krow({ label: "", url: "" })); wire(kr); kr.lastElementChild.querySelector("input").focus(); });
    f.addEventListener("submit", (e) => { e.preventDefault(); const languages = [...lr.children].map((li) => ({ name: li.querySelector("[name=lname]").value.trim(), level: li.querySelector("[name=llevel]").value })).filter((l) => l.name), links = [...kr.children].map((li) => ({ label: li.querySelector("[name=klabel]").value.trim() || undefined, url: li.querySelector("[name=kurl]").value.trim() })).filter((l) => l.url);
      busy(e.submitter, async () => { await api("PUT", "/api/pro/me", { languages, links }); closeSheet(); say("حُفظ"); editorView(); }); });
  }

  /* =================== #/cv/:handle — a member's professional profile =================== */
  async function profileView(handle) {
    const as = qs().get("as") || "";
    page({ title: "الملف المهني", icon: "brief", back: ["#/talent", "دليل المواهب"] }, `<div id="wk-p">${skel(5)}</div>`);
    const box = $("#wk-p");
    let v; try { v = await api("GET", `/api/pro/u/${enc(handle)}${as ? "?as=" + enc(as) : ""}`); } catch (e) { box.innerHTML = e?.code === "no_profile" ? UI.empty({ title: "لا يوجد ملف مهني", text: "لم يُنشئ هذا العضو ملفاً مهنياً بعد.", action: `<a class="btn outline" href="#/u/${enc(handle)}">الملف الشخصي</a>` }) : errBox(e); return; }
    if (!box.isConnected) return;
    const U = v.user, preview = as && v.preview ? `<div class="notice">${ic("eye")}<span>معاينة: هكذا يرى ملفك ${{ stranger: "زائر غير مسجّل", member: "عضو لا يتابعك", follower: "أحد متابعيك" }[v.preview] || "الآخرون"}. <a class="u-fw7" href="#/cv">العودة للتعديل</a></span></div>` : "";
    if (v.locked) { box.innerHTML = `${preview}<section class="card wk-hero">${av(U, "lg")}<div class="u-f1 u-mw0"><h3>${h(U.name)}</h3>${v.headline ? `<p class="wk-hl">${h(v.headline)}</p>` : ""}</div></section>${UI.empty({ title: "ملف مهني محدود الظهور", text: v.visibility === "members" ? "سجّل الدخول لعرض هذا الملف المهني." : v.visibility === "followers" ? "يظهر هذا الملف لمتابعي صاحبه فقط." : "صاحب الملف جعله خاصاً.", action: `<a class="btn outline" href="#/u/${enc(U.handle)}">الملف الشخصي</a>` })}`; return; }
    const P = v.profile, S = v.sections;
    const list = (k, title, icn) => (S[k] && S[k].length ? `<section class="card wk-sec" aria-labelledby="wk-v-${k}"><h3 id="wk-v-${k}" class="wk-st">${ic(icn)}${title}</h3><ol class="wk-items">${S[k].map((i) => `<li class="wk-item">${itemBody(i)}</li>`).join("")}</ol></section>` : "");
    const portfolio = S.portfolio && S.portfolio.length ? `<section class="card wk-sec" aria-labelledby="wk-v-pf"><h3 id="wk-v-pf" class="wk-st">${ic("grid")}معرض الأعمال</h3><ul class="f-grid wk-pf">${S.portfolio.map((i) => { const href = i.post ? `#/post/${enc(i.post.id)}` : i.url; const ext = !i.post && i.url; return `<li><${href ? `a href="${h(href)}"${ext ? ' target="_blank" rel="noopener noreferrer nofollow"' : ""}` : "div"} class="f-card wk-pfc"><b>${h(i.title)}</b>${i.org ? `<small>${h(i.org)}</small>` : ""}${i.body ? `<p>${h(i.body)}</p>` : ""}<span class="wk-ft">${i.post ? `${ic("doc", "xs")} منشور في مجتمع بلس` : i.url ? `${ic("link", "xs")} <bdi>${h(i.url.replace(/^https?:\/\//, "").split("/")[0])}</bdi>` : ""}</span></${href ? "a" : "div"}></li>`; }).join("")}</ul></section>` : "";
    box.innerHTML = `${preview}${v.hidden ? `<div class="notice warn">${ic("alert")}<span>هذا الملف مخفي من فريق المنصة${v.hiddenReason ? `: «${h(v.hiddenReason)}»` : ""}. لا يراه غيرك وغير الفريق.</span></div>` : ""}
      <section class="card wk-hero">${av(U, "lg")}<div class="u-f1 u-mw0"><h3><a href="#/u/${enc(U.handle)}">${h(U.name)}</a></h3><p class="wk-hl">${h(P.headline)}</p>${P.city || P.country ? `<p class="wk-meta">${ic("mapPin", "xs")} ${h([P.city, P.country].filter(Boolean).join("، "))}</p>` : ""}${chipList(P.openTo)}</div></section>
      ${repStrip(v.reputation, U.handle, v.self)}
      <div class="wk-acts">${v.self ? `<a class="btn sm" href="#/cv">${ic("pen")}تعديل ملفي</a>` : `<a class="btn sm" href="#/u/${enc(U.handle)}">${ic("user")}الملف الشخصي</a>`}<button class="btn outline sm" type="button" id="wk-pp">${MPFeat.ico("doc", "sm")}السيرة PDF</button>${v.mentor ? `<a class="btn ghost sm" href="#/mentor/${enc(U.handle)}">${ic("users")}مرشد في مجتمع بلس</a>` : ""}</div>
      ${P.about ? `<section class="card wk-sec" aria-labelledby="wk-v-ab"><h3 id="wk-v-ab" class="wk-st">${ic("user")}نبذة</h3><p class="wk-about">${h(P.about)}</p></section>` : ""}
      ${list("experience", "الخبرات", "brief")}${list("education", "التعليم", "cap")}
      ${v.skills && v.skills.length ? `<section class="card wk-sec" aria-labelledby="wk-v-sk"><h3 id="wk-v-sk" class="wk-st">${ic("bulb")}المهارات</h3><ul class="wk-skills">${v.skills.map((s) => `<li><b>${h(s.name)}</b><small>${LVL[s.level]}${s.years ? ` · ${num(s.years)} سنوات` : ""}</small></li>`).join("")}</ul></section>` : ""}
      ${portfolio}
      ${v.certificates && v.certificates.length ? `<section class="card wk-sec" aria-labelledby="wk-v-ce"><h3 id="wk-v-ce" class="wk-st">${ic("medal")}الشهادات الموثّقة</h3><ul class="list">${v.certificates.map((c) => `<li><a class="li" href="${h(c.url)}" target="_blank" rel="noopener"><span class="ico">${ic("verified")}</span><span class="t"><b>${h(c.title)}</b><small>${h(c.issuer || "مجتمع بلس")} · تحقّق: <bdi>${h(c.code)}</bdi></small></span><span class="chev" aria-hidden="true">←</span></a></li>`).join("")}</ul></section>` : ""}
      ${list("volunteering", "التطوّع", "heart")}${list("award", "الجوائز والإنجازات", "medal")}
      ${(P.languages && P.languages.length) || (P.links && P.links.length) ? `<section class="card wk-sec" aria-labelledby="wk-v-la"><h3 id="wk-v-la" class="wk-st">${ic("globe")}اللغات والروابط</h3>${P.languages && P.languages.length ? `<ul class="wk-skills">${P.languages.map((l) => `<li><b>${h(l.name)}</b><small>${h(l.levelLabel || "")}</small></li>`).join("")}</ul>` : ""}${P.links && P.links.length ? `<span class="wk-links">${P.links.map((l) => `<a class="wk-link" href="${h(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${ic("link", "xs")}${h(l.label)}</a>`).join("")}</span>` : ""}</section>` : ""}
      <p class="f-hint">آخر تحديث ${h(String(P.updatedAt || "").slice(0, 10))}${v.self ? ` · ${num(P.views || 0)} مشاهدة` : ""}</p>
      ${signed() && !v.self && !as ? `<details class="card u-mt12"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("flag")} الإبلاغ عن هذا الملف</summary><form class="f-form u-mt8" id="wk-rp"><label>السبب<select name="reason" required><option value="">اختر…</option><option value="fake">بيانات أو شهادات مزيّفة</option><option value="impersonation">انتحال شخصية</option><option value="scam">احتيال أو طلب أموال</option><option value="inappropriate">محتوى غير لائق</option><option value="other">سبب آخر</option></select></label><label>تفاصيل (اختياري)<textarea name="note" rows="2" maxlength="600"></textarea></label><button class="btn outline" type="submit">إرسال البلاغ</button></form></details>` : ""}
      ${v.staff && !v.self ? `<p class="u-mt8"><a class="btn ghost sm" href="#/admin/pro">${ic("shield")}إدارة الملفات المهنية</a></p>` : ""}`;
    $("#wk-pp").addEventListener("click", () => printCv(U.handle));
    $("#wk-rp")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/pro/u/${enc(U.handle)}/report`, { reason: e.target.reason.value, note: e.target.note.value.trim() || undefined }); say("وصل بلاغك لفريق المنصة"); e.target.closest("details").open = false; e.target.reset(); }); });
  }

  /* =================== #/talent — talent directory =================== */
  async function talentView() {
    const q = qs(), text = q.get("q") || "", open = q.get("open") || "", skill = q.get("skill") || "", city = q.get("city") || "";
    page({ title: "دليل المواهب", icon: "users", sub: "أعضاء اختاروا الظهور بملفاتهم المهنية. ابحث بمهارة أو مدينة.", actions: `${signed() ? `<a class="btn sm" href="#/cv">${ic("pen")}ملفي المهني</a>` : ""}<a class="btn outline sm" href="#/jobs">${ic("brief")}الوظائف</a>` }, `<div id="wk-t">${skel(4)}</div>`);
    const box = $("#wk-t");
    let d; try { d = await api("GET", `/api/pro/search?q=${enc(text)}&open=${enc(open)}&skill=${enc(skill)}&city=${enc(city)}&page=${enc(q.get("page") || "0")}`); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    const url = (o) => { const p = new URLSearchParams({ ...(text && { q: text }), ...(open && { open }), ...(skill && { skill }), ...(city && { city }), ...o }); for (const [k, x] of [...p]) if (!x) p.delete(k); const s = p.toString(); return "#/talent" + (s ? "?" + s : ""); };
    box.innerHTML = `<form class="fx-q u-mb12" id="wk-tf" role="search"><label><span class="vh">ابحث في دليل المواهب</span><input type="search" name="q" value="${h(text)}" maxlength="80" placeholder="مهارة، تخصص، أو اسم"></label>
        <label id="wk-tsk">المهارة<input name="skill" value="${h(skill)}" maxlength="40" placeholder="مثلاً: React"></label><label id="wk-tci">المدينة<input name="city" value="${h(city)}" maxlength="60"></label><button class="btn" type="submit">بحث</button></form>
      <ul class="f-chips" aria-label="منفتح على"><li><a class="chip f" href="${url({ open: "", page: "" })}" ${!open ? 'aria-current="true"' : ""}>الكل</a></li>${d.options.openTo.map((o) => `<li><a class="chip f" href="${url({ open: o.key, page: "" })}" ${open === o.key ? 'aria-current="true"' : ""}>${h(o.label)}</a></li>`).join("")}</ul>
      <p class="f-hint u-mb8">${num(d.total)} ملفاً مهنياً</p>
      ${d.profiles.length ? `<ul class="f-grid wk-grid">${d.profiles.map((p) => `<li><a class="f-card wk-card" href="#/cv/${enc(p.user.handle)}"><span class="wk-ch">${av(p.user)}<span class="u-f1 u-mw0"><b>${h(p.user.name)}</b><small>${h(p.headline)}</small></span></span>${p.city || p.country ? `<span class="wk-meta">${ic("mapPin", "xs")} ${h([p.city, p.country].filter(Boolean).join("، "))}</span>` : ""}${p.skills.length ? `<span class="wk-tags">${p.skills.map((s) => `<span>${h(s)}</span>`).join("")}</span>` : ""}${p.openTo.length ? `<span class="wk-ft">${p.openTo.map((o) => h(o.label)).join(" · ")}</span>` : ""}${rt(p.rep)}</a></li>`).join("")}</ul>${d.more ? `<p class="u-mt12"><a class="btn ghost sm" href="${url({ page: String(d.page + 1) })}">المزيد</a></p>` : ""}`
        : UI.empty({ title: text || open || skill || city ? "لا نتائج مطابقة" : "لا ملفات بعد", text: text || skill || city ? "جرّب كلمات أو مهارات أخرى." : "كن أول من يظهر في دليل المواهب.", action: signed() ? `<a class="btn" href="#/cv">أنشئ ملفك المهني</a>` : "" })}`;
    const tf = $("#wk-tf");
    tf.addEventListener("submit", (e) => { e.preventDefault(); location.hash = url({ q: tf.q.value.trim(), skill: tf.skill.value.trim(), city: tf.city.value.trim(), page: "" }); });
    window.MPFeat?.filters?.({ host: tf, move: [$("#wk-tsk"), $("#wk-tci")], form: tf, title: "تصفية", defaults: { skill: "", city: "" } });
  }

  /* =================== #/admin/pro =================== */
  async function adminView() {
    page({ title: "الملفات المهنية — الإشراف", icon: "shield", back: ["#/admin", "الإدارة"] }, `<div id="wk-a">${skel(3)}</div>`);
    const box = $("#wk-a");
    let d; try { d = await api("GET", "/api/admin/pro"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const T = d.totals;
    box.innerHTML = `<div class="f-kpis"><div class="kpi-tile"><b>${num(T.profiles)}</b><span>ملف مهني</span></div><div class="kpi-tile"><b>${num(T.listed)}</b><span>في الدليل</span></div><div class="kpi-tile"><b>${num(T.open)}</b><span>بلاغ مفتوح</span></div></div>
      <p class="f-hint">يُخرج الملف من دليل المواهب تلقائياً عند ${num(d.flagAt)} بلاغات مفتوحة حتى تقرّر.</p>
      <div class="f-h">بلاغات بانتظار القرار</div>${d.queue.length ? `<ul class="wk-q">${d.queue.map((g) => `<li class="card"><div class="wk-sh"><span class="u-f1 u-mw0"><a class="u-fw7" href="#/cv/${enc(g.user.handle)}">${h(g.user.name)}</a> <small class="f-hint">@${h(g.user.handle)}</small><br><small>${h(g.headline || "")}</small></span><span class="sbadge warn">${num(g.reports.length)} بلاغ</span></div>
          <ul class="wk-rl">${g.reports.map((r) => `<li><b>${h(r.reasonLabel)}</b>${r.note ? ` — ${h(r.note)}` : ""}</li>`).join("")}</ul>
          <div class="wk-acts"><button class="btn danger sm" type="button" data-mod="hide" data-u="${h(g.user.handle)}">إخفاء الملف</button><button class="btn ghost sm" type="button" data-mod="dismiss" data-u="${h(g.user.handle)}">رفض البلاغات</button></div></li>`).join("")}</ul>` : UI.empty({ title: "لا بلاغات مفتوحة", text: "كل شيء على ما يرام." })}
      <div class="f-h">ملفات مخفية</div>${d.hidden.length ? `<ul class="list">${d.hidden.map((x) => `<li class="li"><span class="t"><b>${h(x.user.name)}</b><small>${h(x.reason)}</small></span><button class="btn ghost sm" type="button" data-mod="restore" data-u="${h(x.user.handle)}">إعادة العرض</button></li>`).join("")}</ul>` : `<p class="f-hint">لا ملفات مخفية.</p>`}`;
    box.querySelectorAll("[data-mod]").forEach((b) => b.addEventListener("click", () => { let reason; if (b.dataset.mod === "hide") { reason = prompt("سبب الإخفاء (يصل لصاحب الملف ويُسجَّل)"); if (!reason || reason.trim().length < 3) return; } busy(b, async () => { await api("POST", "/api/admin/pro/" + enc(b.dataset.u), { action: b.dataset.mod, reason }); say("تم"); adminView(); }); }));
  }

  /* =================== Phase 77 — jobs & freelance =================== */
  const payTxt = (p) => (!p || p.type === "none" ? "بدون أجر" : `${p.min === p.max ? num(p.min, { maximumFractionDigits: 2 }) : `${num(p.min, { maximumFractionDigits: 2 })}–${num(p.max, { maximumFractionDigits: 2 })}`} π · ${p.label}`);
  const TONE = { open: "ok", review: "info", paused: "warn", closed: "", filled: "ok", removed: "bad", submitted: "info", viewed: "info", shortlisted: "warn", interview: "warn", offered: "ok", hired: "ok", rejected: "bad", withdrawn: "" };
  const badge = (st, label) => `<span class="sbadge ${TONE[st] || ""}">${h(label)}</span>`;
  const day = (s) => { try { return new Intl.DateTimeFormat("ar", { numberingSystem: "latn", day: "numeric", month: "long", year: "numeric" }).format(new Date(s)); } catch { return String(s || "").slice(0, 10); } };
  const jobCard = (j) => `<li><a class="f-card wk-card wk-job${j.featured ? " feat" : ""}" href="#/job/${enc(j.id)}">${j.featured ? `<span class="wk-featb">${ic("star", "xs")} مميّز</span>` : ""}<span class="wk-ch">${av(j.poster)}<span class="u-f1 u-mw0"><b>${h(j.title)}</b><small>${h(j.poster?.name || "")} · ${h(j.kind.label)}${j.employment ? " · " + h(j.employment.label) : ""}</small></span></span>
    <span class="wk-pay">${h(payTxt(j.pay))}</span><span class="wk-meta">${ic("mapPin", "xs")} ${h(j.mode.label)}${j.city ? " · " + h(j.city) : ""}</span>${j.skills.length ? `<span class="wk-tags">${j.skills.slice(0, 5).map((s) => `<span>${h(s)}</span>`).join("")}</span>` : ""}<span class="wk-ft">${h(j.category.label)} · ${h(day(j.publishedAt))}${j.deadline ? ` · حتى ${h(day(j.deadline))}` : ""}</span></a></li>`;

  async function jobsHub() {
    const q = qs(), tab = q.get("tab") === "mine" ? "mine" : "browse";
    page({ title: "الوظائف والعمل الحر", icon: "brief", sub: "فرص عمل ومشاريع بأجر بالـ Pi، تتقدّم لها بملفك المهني.", actions: `${signed() ? `<a class="btn sm" href="#/jobs/new">${ic("plus")}أضف فرصة</a><a class="btn outline sm" href="#/contracts">${ic("doc")}العقود</a><a class="btn outline sm" href="#/teams">${ic("users")}الفرق</a>` : ""}<a class="btn outline sm" href="#/talent">${ic("users")}دليل المواهب</a>` }, `<nav class="seg u-mb12" aria-label="الأقسام"><a href="#/jobs" ${tab === "browse" ? 'aria-current="page"' : ""}>تصفّح الفرص</a><a href="#/jobs?tab=mine" ${tab === "mine" ? 'aria-current="page"' : ""}>إعلاناتي وطلباتي</a></nav><div id="wk-j">${skel(4)}</div>`);
    const box = $("#wk-j");
    try { await (tab === "mine" ? jobsMine(box) : jobsBrowse(box, q)); } catch (e) { box.innerHTML = errBox(e); }
  }
  async function jobsBrowse(box, q) {
    const f = { q: q.get("q") || "", kind: q.get("kind") || "", category: q.get("category") || "", mode: q.get("mode") || "", city: q.get("city") || "", skill: q.get("skill") || "", minPay: q.get("minPay") || "", sort: q.get("sort") || "" };
    const d = await api("GET", "/api/jobs?" + new URLSearchParams({ ...f, page: q.get("page") || "0" }));
    if (!box.isConnected) return; const O = d.options;
    const url = (o) => { const p = new URLSearchParams({ ...f, ...o }); for (const [k, x] of [...p]) if (!x) p.delete(k); const s = p.toString(); return "#/jobs" + (s ? "?" + s : ""); };
    const sel = (name, label, map, cur) => `<label id="wk-f-${name}">${label}<select name="${name}"><option value="">الكل</option>${Object.entries(map).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${h(v)}</option>`).join("")}</select></label>`;
    box.innerHTML = `${d.minor ? `<div class="notice">${ic("shield")}<span>تظهر لك الفرص التطوعية المناسبة لمن هم دون ١٨ سنة فقط.</span></div>` : ""}
      <form class="fx-q u-mb12" id="wk-jf" role="search"><label><span class="vh">ابحث في الفرص</span><input type="search" name="q" value="${h(f.q)}" maxlength="80" placeholder="مسمى، مهارة، أو كلمة"></label>
        ${sel("category", "التصنيف", O.categories, f.category)}${sel("mode", "مكان العمل", O.modes, f.mode)}<label id="wk-f-city">المدينة<input name="city" value="${h(f.city)}" maxlength="60"></label><label id="wk-f-skill">المهارة<input name="skill" value="${h(f.skill)}" maxlength="40"></label><label id="wk-f-min">أقل أجر (π)<input name="minPay" type="number" min="0" inputmode="decimal" value="${h(f.minPay)}"></label>
        <label id="wk-f-sort">الترتيب<select name="sort"><option value="">الأحدث</option><option value="pay" ${f.sort === "pay" ? "selected" : ""}>الأعلى أجراً</option></select></label><button class="btn" type="submit">بحث</button></form>
      <ul class="f-chips" aria-label="النوع"><li><a class="chip f" href="${url({ kind: "", page: "" })}" ${!f.kind ? 'aria-current="true"' : ""}>الكل</a></li>${Object.entries(O.kinds).map(([k, v]) => `<li><a class="chip f" href="${url({ kind: k, page: "" })}" ${f.kind === k ? 'aria-current="true"' : ""}>${h(v === "مشروع عمل حر" ? "عمل حر" : "وظائف")}</a></li>`).join("")}</ul>
      <p class="f-hint u-mb8">${num(d.total)} فرصة متاحة</p>
      ${d.jobs.length ? `<ul class="f-grid wk-grid">${d.jobs.map(jobCard).join("")}</ul>${d.more ? `<p class="u-mt12"><a class="btn ghost sm" href="${url({ page: String(d.page + 1) })}">المزيد</a></p>` : ""}`
        : UI.empty({ title: Object.values(f).some(Boolean) ? "لا فرص مطابقة" : "لا فرص بعد", text: Object.values(f).some(Boolean) ? "جرّب تصفية أوسع." : "كن أول من ينشر فرصة عمل في مجتمع بلس.", action: signed() ? `<a class="btn" href="#/jobs/new">أضف فرصة</a>` : "" })}
      <p class="f-hint u-mt12">${ic("shield", "xs")} لا تدفع أي مبلغ للتقديم على عمل، ولا تشارك عبارة مرور محفظتك أبداً.</p>`;
    const jf = $("#wk-jf");
    jf.addEventListener("submit", (e) => { e.preventDefault(); const fd = new FormData(jf); location.hash = url({ ...Object.fromEntries([...fd].map(([k, x]) => [k, String(x).trim()])), page: "" }); });
    window.MPFeat?.filters?.({ host: jf, move: ["category", "mode", "city", "skill", "min", "sort"].map((k) => $("#wk-f-" + k)), form: jf, title: "تصفية", defaults: { category: "", mode: "", city: "", skill: "", minPay: "", sort: "" } });
  }
  async function jobsMine(box) {
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول", text: "لتتابع إعلاناتك وطلباتك.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    const d = await api("GET", "/api/jobs/me"); if (!box.isConnected) return;
    const sum = (c) => Object.entries(c).filter(([k]) => k !== "withdrawn").reduce((s, [, v]) => s + v, 0);
    box.innerHTML = `<div class="f-h">إعلاناتي</div>${d.postings.length ? `<ul class="list">${d.postings.map((j) => `<li><a class="li" href="#/job/${enc(j.id)}"><span class="ico">${ic(j.kind.key === "job" ? "brief" : "pen")}</span><span class="t"><b>${h(j.title)}</b><small>${num(sum(j.counts))} طلب · ${num(j.views)} مشاهدة</small></span>${badge(j.status, j.statusLabel)}</a></li>`).join("")}</ul>` : `<p class="wk-none">${d.minor ? "نشر الفرص متاح لمن هم ١٨ سنة فأكثر." : "لم تنشر فرصاً بعد."}</p>`}
      <div class="f-h">طلباتي</div>${d.applications.length ? `<ul class="list">${d.applications.map((a) => `<li><a class="li" href="#/application/${enc(a.id)}">${av(a.job.poster)}<span class="t"><b>${h(a.job.title)}</b><small>${h(a.job.poster?.name || "")} · ${h(a.job.kind)}</small></span>${badge(a.status, a.statusLabel)}</a></li>`).join("")}</ul>` : `<p class="wk-none">لم تتقدّم لأي فرصة بعد. <a class="u-fw7" href="#/jobs">تصفّح الفرص</a></p>`}
      <div class="f-h">المحفوظة</div>${d.saved.length ? `<ul class="f-grid wk-grid">${d.saved.map(jobCard).join("")}</ul>` : `<p class="wk-none">احفظ الفرص لتعود إليها لاحقاً.</p>`}`;
  }

  async function jobView(jid) {
    page({ title: "فرصة عمل", icon: "brief", back: ["#/jobs", "الوظائف"] }, `<div id="wk-jv">${skel(5)}</div>`);
    const box = $("#wk-jv");
    let d; try { d = await api("GET", "/api/jobs/" + enc(jid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const j = d.job, me = d.me;
    const facts = [["النوع", j.kind.label + (j.employment ? " · " + j.employment.label : "")], ["الأجر", payTxt(j.pay)], ["مكان العمل", j.mode.label + (j.city ? " · " + j.city : "") + (j.country ? "، " + j.country : "")], ["التصنيف", j.category.label], ["آخر موعد", j.deadline ? day(j.deadline) + (j.expired ? " (انتهى)" : "") : "مفتوح"], ["الطلبات", num(j.apps)]];
    box.innerHTML = `${j.status !== "open" ? `<div class="notice ${j.status === "removed" ? "warn" : ""}">${ic(j.status === "review" ? "clock" : "alert")}<span>${h(j.statusLabel)}${j.status === "review" && j.reviewReasons?.length ? ` — يراجعه فريق المنصة: ${j.reviewReasons.map((r) => h(r.label)).join("، ")}` : ""}${j.removedReason ? ` — ${h(j.removedReason)}` : ""}</span></div>` : ""}
      <section class="card wk-sec"><div class="wk-ch">${av(j.poster, "lg")}<span class="u-f1 u-mw0"><h3 class="wk-jt">${h(j.title)}</h3><small><a href="#/u/${enc(j.poster.handle)}">${h(j.poster.name)}</a>${j.poster.verified ? ` ${ic("verified", "xs")}` : ""} · <a href="#/cv/${enc(j.poster.handle)}">الملف المهني</a></small></span></div>
        <dl class="wk-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${h(v)}</dd></div>`).join("")}</dl>
        ${j.skills.length ? `<span class="wk-tags">${j.skills.map((s) => `<span>${h(s)}</span>`).join("")}</span>` : ""}</section>
      <section class="card wk-sec"><h3 class="wk-st">${ic("doc")}الوصف</h3><p class="wk-about">${h(j.body)}</p>${j.questions.length ? `<div class="f-h">أسئلة التقديم</div><ol class="wk-ql">${j.questions.map((x) => `<li>${h(x)}</li>`).join("")}</ol>` : ""}</section>
      <div class="notice">${ic("shield")}<span>${h(d.safety)}</span></div>
      <div class="wk-acts u-mt12" id="wk-ja">${me.owner ? `<a class="btn sm" href="#/job/${enc(j.id)}/applicants">${ic("users")}الطلبات (${num(j.apps)})</a><a class="btn outline sm" href="#/job/${enc(j.id)}/edit">${ic("pen")}تعديل</a>${j.status === "open" ? `<button class="btn ghost sm" type="button" data-st="paused">إيقاف مؤقت</button><button class="btn ghost sm" type="button" data-st="filled">تم التوظيف</button><button class="btn ghost sm" type="button" data-st="closed">إغلاق</button>` : ["paused", "closed", "filled"].includes(j.status) ? `<button class="btn ghost sm" type="button" data-st="open">إعادة الفتح</button>` : ""}`
        : me.application ? `<a class="btn sm" href="#/application/${enc(me.application.id)}">${ic("doc")}طلبك: ${h(me.application.statusLabel)}</a>` : me.canApply ? `<button class="btn" type="button" id="wk-apply">${ic("check")}قدّم الآن</button>` : me.whyCode === "no_profile" ? `<a class="btn" href="#/cv">${ic("pen")}أنشئ ملفك المهني للتقديم</a>` : me.whyCode === "auth" ? `<a class="btn" href="#/settings">سجّل الدخول للتقديم</a>` : `<span class="f-hint">${h(me.why || "")}</span>`}
        ${me.signedIn && !me.owner ? `<button class="btn ghost sm" type="button" id="wk-save" aria-pressed="${j.saved}">${ic(j.saved ? "bookmarkF" : "bookmark")}${j.saved ? "محفوظة" : "حفظ"}</button>` : ""}</div>
      ${me.owner && j.status === "open" ? `<section class="card wk-sec"><h3 class="wk-st">${ic("star")}تمييز الإعلان</h3><p class="f-hint">يظهر إعلانك أولاً في نتائج البحث. ${num(d.options.boostPerDay, { maximumFractionDigits: 2 })} π لليوم.</p>${d.piEnabled ? `<div class="wk-acts">${d.options.boostDays.map((n) => `<button class="btn outline sm" type="button" data-boost="${n}">${num(n)} يوماً · ${num(n * d.options.boostPerDay, { maximumFractionDigits: 2 })} π</button>`).join("")}</div>` : `<div class="notice">${ic("wallet")}<span>${h(d.piNotice)}</span></div>`}${j.featuredUntil ? `<p class="f-hint">مميّز حتى ${h(day(j.featuredUntil))}</p>` : ""}</section>` : ""}
      ${me.canReport ? `<details class="card u-mt12"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("flag")} الإبلاغ عن الإعلان</summary><form class="f-form u-mt8" id="wk-jr"><label>السبب<select name="reason" required><option value="">اختر…</option>${Object.entries(d.options.reasons).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></label><label>تفاصيل (اختياري)<textarea name="note" rows="2" maxlength="600"></textarea></label><button class="btn outline" type="submit">إرسال البلاغ</button></form></details>` : ""}
      ${me.staff && !me.owner ? `<p class="u-mt8"><a class="btn ghost sm" href="#/admin/jobs">${ic("shield")}مراجعة الإعلانات</a></p>` : ""}`;
    if (j.status === "open") UI.vidtikStrip?.("job", j.id, box); // v2.76 «يظهر في فيديوتك»
    $("#wk-apply")?.addEventListener("click", () => applySheet(j, d));
    try { if (sessionStorage.getItem("mp-auto-apply") === j.id) { sessionStorage.removeItem("mp-auto-apply"); $("#wk-apply")?.click(); } } catch { /* v2.76 «قدّم الآن» from a Vidtik clip opens the apply sheet at once */ }
    $("#wk-save")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; await api("POST", `/api/jobs/${enc(j.id)}/save`, { saved: on }); say(on ? "حُفظت الفرصة" : "أُزيلت من المحفوظة"); jobView(jid); }));
    box.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.st !== "open" && !confirm(b.dataset.st === "paused" ? "إيقاف استقبال الطلبات مؤقتاً؟" : "سيُغلق الإعلان وتُبلَّغ الطلبات المفتوحة. متابعة؟")) return; busy(b, async () => { await api("POST", `/api/jobs/${enc(j.id)}/state`, { status: b.dataset.st }); say("تم"); jobView(jid); }); }));
    box.querySelectorAll("[data-boost]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { const r = await api("POST", `/api/jobs/${enc(j.id)}/boost`, { days: Number(b.dataset.boost) }); if (!window.MPPi?.pay) return say("افتح التطبيق في متصفح Pi لإكمال الدفع"); await MPPi.pay({ amount: r.amount, memo: r.intent.memo, purpose: "jobs", refId: r.boost, intent: async () => r.intent }); say("سيظهر إعلانك مميّزاً بعد تأكيد الدفع"); jobView(jid); })));
    $("#wk-jr")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/jobs/${enc(j.id)}/report`, { reason: e.target.reason.value, note: e.target.note.value.trim() || undefined }); say("وصل بلاغك لفريق المنصة"); e.target.closest("details").open = false; e.target.reset(); }); });
  }
  function applySheet(j) {
    const bid = j.kind.key === "freelance" && j.pay.type !== "none";
    sheet(`<h3 class="u-mt0">التقديم: ${h(j.title)}</h3><p class="f-hint">سيرى ${h(j.poster.name)} ملفك المهني كاملاً لهذا الطلب فقط.</p><form class="f-form" id="wk-af">
      <label>رسالة التقديم<textarea name="cover" rows="6" required minlength="30" maxlength="3000" placeholder="لماذا أنت مناسب لهذه الفرصة؟ اذكر خبرة أو عملاً مشابهاً."></textarea></label>
      ${j.questions.map((x, i) => `<label>${h(x)}<textarea name="a${i}" rows="2" required maxlength="1000"></textarea></label>`).join("")}
      ${bid ? `<div class="wk-two"><label>عرضك (π)<input name="bid" type="number" min="0.01" step="0.01" inputmode="decimal" required></label><label>مدة التنفيذ (أيام)<input name="days" type="number" min="1" max="365" inputmode="numeric" required></label></div>` : ""}
      <div class="wk-acts"><button class="btn" type="submit">إرسال الطلب</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`);
    const f = sheetQ("#wk-af"); f.cover.focus();
    f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { const r = await api("POST", `/api/jobs/${enc(j.id)}/apply`, { cover: f.cover.value.trim(), answers: j.questions.map((_, i) => f["a" + i].value.trim()), ...(bid ? { bid: Number(f.bid.value), days: Number(f.days.value) } : {}) }); closeSheet(); say("أُرسل طلبك"); location.hash = "#/application/" + enc(r.id); }); });
  }

  async function jobForm(jid) {
    page({ title: jid ? "تعديل الفرصة" : "فرصة جديدة", icon: "brief", back: jid ? [`#/job/${enc(jid)}`, "الفرصة"] : ["#/jobs", "الوظائف"] }, `<div id="wk-jn">${skel(4)}</div>`);
    const box = $("#wk-jn");
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول أولاً", text: "لنشر فرصة عمل.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    let O, J = null; try { O = (await api("GET", "/api/jobs?page=50")).options; if (jid) J = (await api("GET", "/api/jobs/" + enc(jid))).job; } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${h(v)}</option>`).join("");
    const P = J?.pay || { type: "fixed" };
    box.innerHTML = `<div class="notice">${ic("shield")}<span>تُراجَع الإعلانات التي تطلب رسوماً من المتقدّمين أو تواصلاً خارج المنصة قبل نشرها. اكتب وصفاً واضحاً وأجراً حقيقياً.</span></div>
      <form class="card f-form u-mt12" id="wk-jform">
        ${J ? "" : `<fieldset class="wk-fs"><legend>النوع</legend><div class="wk-checks"><label class="wk-ck"><input type="radio" name="kind" value="job" checked><span>وظيفة</span></label><label class="wk-ck"><input type="radio" name="kind" value="freelance"><span>مشروع عمل حر</span></label></div></fieldset>`}
        <label>المسمى<input name="title" required minlength="6" maxlength="120" value="${h(J?.title || "")}" placeholder="مثلاً: مطوّر تطبيقات Flutter"></label>
        <label>الوصف<textarea name="body" rows="7" required minlength="60" maxlength="8000" placeholder="المهام، المتطلبات، ما الذي تقدّمه">${h(J?.body || "")}</textarea></label>
        <div class="wk-two"><label>التصنيف<select name="category" required><option value="">اختر…</option>${opt(O.categories, J?.category.key)}</select></label><label id="wk-emp">نوع الدوام<select name="employment">${opt(O.employment, J?.employment?.key || "full")}</select></label></div>
        <label>المهارات المطلوبة<input name="skills" maxlength="300" value="${h((J?.skills || []).join("، "))}" placeholder="افصل بينها بفاصلة"></label>
        <div class="wk-two"><label>مكان العمل<select name="mode">${opt(O.modes, J?.mode.key || "remote")}</select></label><label>المدينة<input name="city" maxlength="60" value="${h(J?.city || "")}"></label></div>
        <fieldset class="wk-fs"><legend>الأجر بالـ Pi</legend><label>طريقة الأجر<select name="payType">${opt(O.pay, P.type)}</select></label><div class="wk-two" id="wk-payr"><label>من (π)<input name="payMin" type="number" min="0" step="0.01" inputmode="decimal" value="${h(P.min ?? "")}"></label><label>إلى (π)<input name="payMax" type="number" min="0" step="0.01" inputmode="decimal" value="${h(P.max ?? "")}"></label></div>
          <label class="wk-sw" id="wk-mok"><input type="checkbox" class="switch" name="minorsOk" ${J?.minorsOk ? "checked" : ""}><span>مناسبة لمن هم دون ١٨ سنة (تطوعية فقط)</span></label></fieldset>
        <label>آخر موعد للتقديم (اختياري)<input type="date" name="deadline" value="${h(J?.deadline || "")}" min="${new Date().toISOString().slice(0, 10)}"></label>
        <fieldset class="wk-fs"><legend>أسئلة للمتقدّمين (حتى ٣، اختياري)</legend>${[0, 1, 2].map((i) => `<label><span class="vh">السؤال ${i + 1}</span><input name="q${i}" maxlength="200" value="${h(J?.questions?.[i] || "")}" placeholder="السؤال ${i + 1}"></label>`).join("")}</fieldset>
        <button class="btn" type="submit">${J ? "حفظ التعديلات" : "نشر الفرصة"}</button></form>`;
    const f = $("#wk-jform");
    const sync = () => { const k = J ? J.kind.key : f.querySelector("[name=kind]:checked").value, none = f.payType.value === "none"; $("#wk-emp").hidden = k !== "job"; $("#wk-payr").hidden = none; $("#wk-mok").hidden = !none; };
    f.addEventListener("change", sync); sync();
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const b = { title: f.title.value.trim(), body: f.body.value.trim(), category: f.category.value, employment: f.employment.value, skills: f.skills.value, mode: f.mode.value, city: f.city.value.trim() || null, payType: f.payType.value, payMin: f.payMin.value || null, payMax: f.payMax.value || null, minorsOk: f.minorsOk.checked, deadline: f.deadline.value || null, questions: [0, 1, 2].map((i) => f["q" + i].value.trim()).filter(Boolean) };
      if (!J) b.kind = f.querySelector("[name=kind]:checked").value;
      busy(e.submitter, async () => { const r = J ? await api("PATCH", "/api/jobs/" + enc(J.id), b) : await api("POST", "/api/jobs", b); say(r.state === "review" ? "أُرسل للمراجعة قبل النشر" : "نُشرت الفرصة"); location.hash = "#/job/" + enc(r.id); });
    });
  }

  async function applicantsView(jid) {
    const st = qs().get("status") || "";
    page({ title: "الطلبات", icon: "users", back: [`#/job/${enc(jid)}`, "الفرصة"] }, `<div id="wk-ap">${skel(4)}</div>`);
    const box = $("#wk-ap");
    let d; try { d = await api("GET", `/api/jobs/${enc(jid)}/applications${st ? "?status=" + enc(st) : ""}`); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    const tabs = [["", "الكل"], ["submitted", "جديدة"], ["shortlisted", "المختصرة"], ["interview", "مقابلات"], ["offered", "عروض"], ["hired", "تعيين"], ["rejected", "مرفوضة"]];
    const cnt = (k) => (k ? (d.counts[k] || 0) + (k === "submitted" ? d.counts.viewed || 0 : 0) : Object.values(d.counts).reduce((a, b) => a + b, 0));
    box.innerHTML = `<p class="wk-hl">${h(d.job.title)}</p><nav class="f-chips u-mb12 wk-pipe" aria-label="مراحل الطلبات">${tabs.map(([k, v]) => `<a class="chip f" href="#/job/${enc(jid)}/applicants${k ? "?status=" + k : ""}" ${st === k ? 'aria-current="true"' : ""}>${v} <span class="n">${num(cnt(k))}</span></a>`).join("")}</nav>
      ${d.applications.length ? `<ul class="list">${d.applications.map((a) => `<li><a class="li wk-arow" href="#/application/${enc(a.id)}">${av(a.applicant)}<span class="t"><b>${h(a.applicant.name)}</b><small>${h(a.headline || "")}${a.bid !== null ? ` · ${num(a.bid, { maximumFractionDigits: 2 })} π / ${num(a.days)} يوماً` : ""}</small><small>${h(a.excerpt)}</small>${rt(a.rep)}</span>${badge(a.status, a.statusLabel)}</a></li>`).join("")}</ul>` : UI.empty({ title: "لا طلبات هنا", text: st ? "لا طلبات في هذه المرحلة." : "شارك الإعلان ليصل لأصحاب المهارات." })}`;
  }

  async function applicationView(aid) {
    page({ title: "طلب التوظيف", icon: "doc", back: ["#/jobs?tab=mine", "إعلاناتي وطلباتي"] }, `<div id="wk-av">${skel(5)}</div>`);
    const box = $("#wk-av");
    let d; try { d = await api("GET", "/api/job-applications/" + enc(aid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const a = d.application, me = d.me, other = me.employer ? a.applicant : a.employer;
    const NX = { shortlisted: "إلى القائمة المختصرة", interview: "دعوة لمقابلة", offered: "تقديم عرض", hired: "تعيين", rejected: "اعتذار" };
    const P = d.profile;
    box.innerHTML = `<section class="card wk-sec"><div class="wk-sh"><span class="wk-ch">${av(other, "")}<span class="u-mw0"><b>${h(other.name)}</b><small><a href="#/job/${enc(a.job.id)}">${h(a.job.title)}</a></small></span></span>${badge(a.status, a.statusLabel)}</div>
        ${a.bid !== null ? `<p class="wk-pay">العرض: ${num(a.bid, { maximumFractionDigits: 2 })} π · ${num(a.days)} يوماً</p>` : ""}
        <div class="f-h">رسالة التقديم</div><p class="wk-about">${h(a.cover)}</p>${a.questions.length ? `<dl class="wk-qa">${a.questions.map((q, i) => `<div><dt>${h(q)}</dt><dd>${h(a.answers[i] || "")}</dd></div>`).join("")}</dl>` : ""}</section>
      ${me.employer && me.next.length ? `<section class="card wk-sec"><h3 class="wk-st">${ic("chart")}المرحلة التالية</h3><form class="f-form" id="wk-ns"><label>رسالة للمتقدّم (اختياري)<textarea name="message" rows="2" maxlength="1000" placeholder="مثلاً: موعد المقابلة وطريقتها"></textarea></label><div class="wk-acts">${me.next.map((s) => `<button class="btn ${s === "rejected" ? "ghost" : s === "hired" ? "" : "outline"} sm" type="button" data-next="${s}">${NX[s] || h(d.statuses[s])}</button>`).join("")}</div></form></section>` : ""}
      ${me.employer ? `<details class="card wk-sec"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("lock")} ملاحظة خاصة (لا يراها المتقدّم)</summary><form class="f-form u-mt8" id="wk-nt"><label><span class="vh">الملاحظة</span><textarea name="note" rows="3" maxlength="2000">${h(a.note || "")}</textarea></label><button class="btn outline sm" type="submit">حفظ الملاحظة</button></form></details>` : ""}
      <section class="card wk-sec" aria-labelledby="wk-tl"><h3 id="wk-tl" class="wk-st">${ic("comment")}المتابعة والرسائل</h3><ol class="wk-tline">${d.events.map((e) => `<li class="${e.kind} ${e.mine ? "mine" : ""}">${e.kind === "status" ? `<span class="wk-evs">${badge(e.status, e.statusLabel)} <small>${h(day(e.at))}</small></span>${e.body ? `<p>${h(e.body)}</p>` : ""}` : `<p>${h(e.body)}</p><small>${e.mine ? "أنت" : e.by === "employer" ? "صاحب الفرصة" : "المتقدّم"} · ${h(day(e.at))}</small>${e.warn ? `<span class="notice warn">${ic("alert")}<span>تنبيه: يبدو أن الرسالة تطلب دفعاً أو تواصلاً خارج المنصة أو بيانات محفظتك. لا تدفع ولا تشارك عبارة المرور.</span></span>` : ""}`}</li>`).join("")}</ol>
        ${me.canMessage ? `<form class="f-form wk-msgf" id="wk-mf"><label><span class="vh">رسالتك</span><textarea name="body" rows="2" maxlength="2000" required placeholder="اكتب رسالة…"></textarea></label><button class="btn sm" type="submit">إرسال</button></form>` : ""}</section>
      ${me.employer && ["offered", "hired"].includes(a.status) ? `<p><a class="btn sm" href="#/contracts/new?app=${enc(a.id)}">${ic("doc")}إنشاء عقد بمراحل</a></p>` : ""}
      ${me.canWithdraw ? `<p><button class="btn ghost sm" type="button" id="wk-wd">سحب الطلب</button></p>` : ""}
      ${P ? `<section class="card wk-sec" aria-labelledby="wk-pp-h"><div class="wk-sh"><h3 id="wk-pp-h">${ic("brief")}الملف المهني للمتقدّم</h3><a class="btn ghost sm" href="#/cv/${enc(a.applicant.handle)}">فتح</a></div><p class="wk-hl">${h(P.profile.headline)}</p>${P.reputation ? `<p class="wk-meta">${rt({ ...P.reputation, completed: P.reputation.completed?.total }) || "لا تقييمات موثّقة بعد"} · <a href="#/reviews/u/${enc(a.applicant.handle)}">التقييمات المهنية</a></p>` : ""}${P.profile.about ? `<p class="wk-about">${h(P.profile.about)}</p>` : ""}
          ${P.skills?.length ? `<ul class="wk-skills">${P.skills.map((s) => `<li><b>${h(s.name)}</b><small>${LVL[s.level]}</small></li>`).join("")}</ul>` : ""}${(P.sections.experience || []).length ? `<div class="f-h">الخبرات</div><ol class="wk-items">${P.sections.experience.map((i) => `<li class="wk-item">${itemBody(i)}</li>`).join("")}</ol>` : ""}</section>` : ""}`;
    box.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", () => { if (["rejected", "hired"].includes(b.dataset.next) && !confirm(b.dataset.next === "hired" ? "تأكيد التعيين؟" : "إرسال اعتذار للمتقدّم؟")) return; busy(b, async () => { await api("POST", `/api/job-applications/${enc(aid)}/status`, { status: b.dataset.next, message: $("#wk-ns").message.value.trim() || undefined }); say("تم تحديث الطلب"); applicationView(aid); }); }));
    $("#wk-nt")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", `/api/job-applications/${enc(aid)}/note`, { note: e.target.note.value }); say("حُفظت الملاحظة"); }); });
    $("#wk-mf")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/job-applications/${enc(aid)}/messages`, { body: e.target.body.value.trim() }); await applicationView(aid); $("#wk-mf textarea")?.focus(); }); });
    $("#wk-wd")?.addEventListener("click", (e) => { if (!confirm("سحب طلبك؟ لا يمكن التراجع.")) return; busy(e.currentTarget, async () => { await api("POST", `/api/job-applications/${enc(aid)}/withdraw`); say("سُحب الطلب"); applicationView(aid); }); });
  }

  async function adminJobs() {
    page({ title: "الوظائف — المراجعة", icon: "shield", back: ["#/admin", "الإدارة"] }, `<div id="wk-aj">${skel(3)}</div>`);
    const box = $("#wk-aj");
    let d; try { d = await api("GET", "/api/admin/jobs"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const T = d.totals;
    box.innerHTML = `<div class="f-kpis"><div class="kpi-tile"><b>${num(T.open)}</b><span>فرصة مفتوحة</span></div><div class="kpi-tile"><b>${num(T.review)}</b><span>بانتظار المراجعة</span></div><div class="kpi-tile"><b>${num(T.reports)}</b><span>بلاغ مفتوح</span></div><div class="kpi-tile"><b>${num(T.applications)}</b><span>طلب توظيف</span></div></div>
      <div class="f-h">بانتظار المراجعة</div>${d.review.length ? `<ul class="wk-q">${d.review.map((j) => `<li class="card"><div class="wk-sh"><a class="u-fw7 u-f1" href="#/job/${enc(j.id)}">${h(j.title)}</a>${badge("review", j.kind.label)}</div><small class="f-hint">${h(j.poster?.name || "")} · ${h(payTxt(j.pay))}</small><ul class="wk-rl">${j.reasons.map((r) => `<li>${h(r.label)}</li>`).join("")}</ul><p class="wk-about">${h(j.body)}</p>
          <div class="wk-acts"><button class="btn sm" type="button" data-jm="approve" data-j="${h(j.id)}">اعتماد ونشر</button><button class="btn danger sm" type="button" data-jm="remove" data-j="${h(j.id)}">إزالة</button></div></li>`).join("")}</ul>` : UI.empty({ title: "لا إعلانات بانتظار المراجعة", text: "كل شيء على ما يرام." })}
      <div class="f-h">بلاغات</div>${d.reports.length ? `<ul class="wk-q">${d.reports.map((g) => `<li class="card"><div class="wk-sh"><a class="u-fw7 u-f1" href="#/job/${enc(g.job.id)}">${h(g.job.title)}</a><span class="sbadge warn">${num(g.reports.length)} بلاغ</span></div><ul class="wk-rl">${g.reports.map((r) => `<li><b>${h(r.reasonLabel)}</b>${r.note ? ` — ${h(r.note)}` : ""}</li>`).join("")}</ul>
          <div class="wk-acts"><button class="btn danger sm" type="button" data-jm="remove" data-j="${h(g.job.id)}">إزالة الإعلان</button><button class="btn ghost sm" type="button" data-jm="dismiss" data-j="${h(g.job.id)}">رفض البلاغات</button></div></li>`).join("")}</ul>` : `<p class="f-hint">لا بلاغات مفتوحة.</p>`}`;
    box.querySelectorAll("[data-jm]").forEach((b) => b.addEventListener("click", () => { let reason; if (b.dataset.jm === "remove") { reason = prompt("سبب الإزالة (يصل لصاحب الإعلان ويُسجَّل)"); if (!reason || reason.trim().length < 3) return; } busy(b, async () => { await api("POST", "/api/admin/jobs/" + enc(b.dataset.j), { action: b.dataset.jm, reason }); say("تم"); adminJobs(); }); }));
  }


  /* =================== Phase 78 — contracts, milestones & escrow =================== */
  const piv = (x) => `${num(x, { maximumFractionDigits: 2 })} π`;
  const CT_TONE = { offer: "info", active: "ok", completed: "ok", declined: "bad", cancelled: "", pending: "", funded: "info", submitted: "warn", revision: "warn", approved: "ok", released: "ok", refunded: "", };
  const ctBadge = (st, label) => `<span class="sbadge ${CT_TONE[st] || ""}">${h(label)}</span>`;
  const EV_TXT = { offer: "أرسل العميل عرض العقد", accepted: "قبل المنفّذ العقد", declined: "رفض المنفّذ العرض", withdrawn: "سحب العميل العرض", funded: "مُوّلت المرحلة بالضمان", submitted: "سلّم المنفّذ المرحلة", revision: "طلب العميل تعديلاً", approved: "اعتمد العميل المرحلة", auto_approved: "اعتُمدت المرحلة تلقائياً بعد انتهاء مهلة المراجعة", dispute: "فُتح نزاع", resolved: "قرار فريق المنصة", cancelled: "انتهى العقد", completed: "اكتمل العقد" };

  async function contractsHub() {
    const tab = qs().get("tab") === "closed" ? "closed" : "open";
    page({ title: "العقود", icon: "doc", sub: "اتفاقات عمل بمراحل واضحة، والمبالغ في الضمان حتى تعتمد التسليم.", back: ["#/jobs", "الوظائف"], actions: signed() ? `<a class="btn sm" href="#/contracts/new">${ic("plus")}عقد جديد</a>` : "" },
      `<nav class="seg u-mb12" aria-label="العقود"><a href="#/contracts" ${tab === "open" ? 'aria-current="page"' : ""}>الجارية</a><a href="#/contracts?tab=closed" ${tab === "closed" ? 'aria-current="page"' : ""}>المنتهية</a></nav><div id="wk-cl">${skel(3)}</div>`);
    const box = $("#wk-cl");
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول", text: "لتتابع عقودك.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    let d; try { d = await api("GET", "/api/contracts"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    const rows = d[tab];
    box.innerHTML = `${d.piNotice ? `<div class="notice u-mb12">${ic("wallet")}<span>${h(d.piNotice)}</span></div>` : ""}
      ${rows.length ? `<ul class="list wk-ctl">${rows.map((c) => { const o = c.role === "client" ? c.worker : c.client; return `<li><a class="li" href="#/contract/${enc(c.id)}">${av(o)}<span class="t"><b>${h(c.title)}</b><small>${c.role === "client" ? "أنت العميل" : "أنت المنفّذ"} · ${h(o?.name || "")}</small><small>${c.paid ? piv(c.total) : "غير مدفوع"} · ${num(c.done)}/${num(c.milestones)} مراحل${c.held ? ` · في الضمان ${piv(c.held)}` : ""}</small></span>${ctBadge(c.status, c.statusLabel)}</a></li>`; }).join("")}</ul>`
        : UI.empty({ title: tab === "open" ? "لا عقود جارية" : "لا عقود منتهية", text: tab === "open" ? "تبدأ العقود من طلب توظيف قبلته، أو بعرض مباشر لعضو." : "تظهر هنا العقود المكتملة والملغاة.", action: tab === "open" ? `<a class="btn" href="#/contracts/new">عقد جديد</a>` : "" })}`;
  }

  async function contractForm() {
    const q = qs(), appId = q.get("app") || "";
    page({ title: "عقد جديد", icon: "doc", back: appId ? [`#/application/${enc(appId)}`, "الطلب"] : ["#/contracts", "العقود"] }, `<div id="wk-cn">${skel(4)}</div>`);
    const box = $("#wk-cn");
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول أولاً", text: "لإنشاء عقد.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    let d; try { d = await api("GET", "/api/contracts/draft" + (appId ? "?app=" + enc(appId) : "")); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const D = d.draft;
    const msRow = (m = {}) => `<li class="wk-ms-row card"><div class="wk-two"><label>عنوان المرحلة<input name="mt" required minlength="3" maxlength="120" value="${h(m.title || "")}"></label><label>المبلغ (π، صفر لعمل غير مدفوع)<input name="ma" type="number" min="0" step="0.01" inputmode="decimal" value="${h(m.amount ?? "")}"></label></div>
      <div class="wk-two"><label>الموعد (اختياري)<input name="md" type="date" min="${new Date().toISOString().slice(0, 10)}"></label><label>التفاصيل (اختياري)<input name="mb" maxlength="1000"></label></div><button class="btn ghost sm" type="button" data-rm>${ic("x")}حذف المرحلة</button></li>`;
    box.innerHTML = `${D && !D.ready ? `<div class="notice warn">${ic("alert")}<span>انقل الطلب إلى «عرض مقدّم» أو «تم التعيين» أولاً، ثم أنشئ العقد.</span></div>` : ""}
      <div class="notice">${ic("shield")}<span>${d.piNotice ? h(d.piNotice) : `يموّل العميل كل مرحلة مدفوعة بالضمان قبل بدء العمل، ويُصرف المبلغ للمنفّذ عند اعتماد التسليم${d.options.feePct ? ` (رسوم المنصة ${num(d.options.feePct)}٪)` : ""}.`}</span></div>
      <form class="card f-form u-mt12" id="wk-cform">
        ${D ? `<p class="wk-hl">${av(D.worker)} <span>مع ${h(D.worker.name)}${D.bid !== null ? ` · عرضه ${piv(D.bid)}${D.days ? ` خلال ${num(D.days)} يوماً` : ""}` : ""}</span></p>` : `<label>المنفّذ (اسم المستخدم)<input name="to" required maxlength="40" dir="ltr" value="${h(q.get("to") || "")}" placeholder="@handle"></label>`}
        <label>عنوان العقد<input name="title" required minlength="6" maxlength="120" value="${h(D?.title || "")}"></label>
        <label>نطاق العمل<textarea name="scope" rows="5" required minlength="30" maxlength="6000" placeholder="ما المطلوب بالضبط، وما الذي يُسلَّم، وما الخارج عن الاتفاق"></textarea></label>
        <label>عدد التعديلات المسموحة لكل مرحلة<select name="rev">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === 2 ? "selected" : ""}>${num(n)}</option>`).join("")}</select></label>
        <fieldset class="wk-fs"><legend>المراحل</legend><ol class="wk-ms-list" id="wk-msl">${msRow(D?.bid ? { title: "التسليم الكامل", amount: D.bid } : {})}</ol><button class="btn outline sm" type="button" id="wk-addms">${ic("plus")}إضافة مرحلة</button></fieldset>
        <p class="wk-total" id="wk-total" aria-live="polite"></p>
        <button class="btn" type="submit" ${D && !D.ready ? "disabled" : ""}>إرسال العرض</button></form>`;
    const f = $("#wk-cform"), list = $("#wk-msl");
    const total = () => { const t = [...list.querySelectorAll("[name=ma]")].reduce((s, i) => s + (Number(i.value) || 0), 0); $("#wk-total").textContent = t > 0 ? `الإجمالي: ${piv(t)}` : "عقد غير مدفوع"; list.querySelectorAll("[data-rm]").forEach((b) => { b.hidden = list.children.length < 2; }); $("#wk-addms").hidden = list.children.length >= 10; };
    f.addEventListener("input", total); total();
    $("#wk-addms").addEventListener("click", () => { list.insertAdjacentHTML("beforeend", msRow()); total(); list.lastElementChild.querySelector("[name=mt]").focus(); });
    list.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { b.closest("li").remove(); total(); } });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const milestones = [...list.children].map((li) => ({ title: li.querySelector("[name=mt]").value.trim(), amount: Number(li.querySelector("[name=ma]").value) || 0, due: li.querySelector("[name=md]").value || null, body: li.querySelector("[name=mb]").value.trim() || null }));
      const b = { title: f.title.value.trim(), scope: f.scope.value.trim(), maxRevisions: Number(f.rev.value), milestones, ...(D ? { appId: D.appId } : { to: f.to.value.trim() }) };
      busy(e.submitter, async () => { const r = await api("POST", "/api/contracts", b); say("أُرسل العرض"); location.hash = "#/contract/" + enc(r.id); });
    });
  }

  async function contractView(cid) {
    page({ title: "العقد", icon: "doc", back: ["#/contracts", "العقود"] }, `<div id="wk-cv">${skel(5)}</div>`);
    const box = $("#wk-cv");
    let d; try { d = await api("GET", "/api/contracts/" + enc(cid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const c = d.contract, me = d.me;
    const msCard = (m) => `<li class="card wk-ms" id="wk-ms-${h(m.id)}"><div class="wk-sh"><b class="u-f1">${num(m.pos + 1)}. ${h(m.title)}</b>${ctBadge(m.status, m.statusLabel)}</div>
      <p class="wk-meta">${m.paid ? `<span class="wk-pay">${piv(m.amount)}</span>` : "غير مدفوعة"}${m.due ? ` · الموعد ${h(day(m.due))}${m.overdue ? " (متأخرة)" : ""}` : ""}${m.revisions ? ` · التعديلات ${num(m.revisions)}/${num(c.maxRevisions)}` : ""}${m.workerAmount !== null && m.status === "released" && m.workerAmount !== m.amount ? ` · صُرف للمنفّذ ${piv(m.workerAmount)}` : ""}</p>
      ${m.body ? `<p class="wk-about">${h(m.body)}</p>` : ""}
      ${m.deliverables.length ? `<ol class="wk-dl">${m.deliverables.map((x) => `<li><p>${h(x.note)}</p>${x.links.length ? `<span class="wk-links">${x.links.map((l) => `<a class="wk-link" href="${h(l)}" target="_blank" rel="noopener noreferrer nofollow">${ic("link", "xs")}<bdi>${h(l.replace(/^https?:\/\//, "").slice(0, 60))}</bdi></a>`).join("")}</span>` : ""}<small>${h(day(x.at))}</small></li>`).join("")}</ol>` : ""}
      ${m.dispute ? `<div class="notice warn">${ic("alert")}<span>نزاع مفتوح (${h(m.dispute.reason)}) — المرحلة مجمّدة حتى قرار فريق المنصة.</span></div>` : ""}
      ${me.worker && m.paid && m.status === "pending" && d.contract.status === "active" ? `<p class="f-hint">${ic("wallet", "xs")} تبدأ بعد أن يموّلها العميل بالضمان${d.piEnabled ? "" : " (متاح عند تفعيل Pi)"}.</p>` : ""}
      ${m.autoReleaseAt && me.client ? `<p class="f-hint">تُعتمد تلقائياً في ${h(day(m.autoReleaseAt))} إن لم تراجعها.</p>` : ""}
      ${m.actions.length ? `<div class="wk-acts">${m.actions.map((a) => a === "fund" ? (d.piEnabled ? `<button class="btn sm" type="button" data-ma="fund" data-m="${h(m.id)}">${ic("wallet")}موّل بالضمان ${piv(m.amount)}</button>` : `<span class="f-hint">${ic("wallet", "xs")} التمويل بالضمان متاح عند تفعيل Pi</span>`)
        : a === "submit" ? `<button class="btn sm" type="button" data-ma="submit" data-m="${h(m.id)}">${ic("check")}تسليم المرحلة</button>`
        : a === "approve" ? `<button class="btn sm" type="button" data-ma="approve" data-m="${h(m.id)}">${ic("check")}${m.paid ? "اعتماد وصرف المبلغ" : "اعتماد"}</button>`
        : a === "revision" ? `<button class="btn outline sm" type="button" data-ma="revision" data-m="${h(m.id)}">${ic("refresh")}طلب تعديل</button>`
        : `<button class="btn ghost sm" type="button" data-ma="dispute" data-m="${h(m.id)}">${ic("flag")}فتح نزاع</button>`).join("")}</div>` : ""}</li>`;
    const evTxt = (e) => (e.kind === "message" ? h(e.body) : `${h(EV_TXT[e.kind] || e.kind)}${e.milestoneId ? ` — ${h(d.milestones.find((m) => m.id === e.milestoneId)?.title || "")}` : ""}${e.body ? `: ${h(e.body)}` : ""}`);
    box.innerHTML = `<section class="card wk-sec"><div class="wk-sh"><h3 class="wk-jt u-f1">${h(c.title)}</h3>${ctBadge(c.status, c.statusLabel)}</div>
        <dl class="wk-facts"><div><dt>العميل</dt><dd><a href="#/u/${enc(c.client.handle)}">${h(c.client.name)}</a></dd></div><div><dt>المنفّذ</dt><dd><a href="#/cv/${enc(c.worker.handle)}">${h(c.worker.name)}</a></dd></div><div><dt>القيمة</dt><dd>${c.paid ? piv(c.total) : "غير مدفوع"}</dd></div><div><dt>في الضمان</dt><dd>${piv(c.held)}</dd></div><div><dt>المراحل</dt><dd>${num(c.done)}/${num(c.milestones)}</dd></div><div><dt>التعديلات</dt><dd>${num(c.maxRevisions)} لكل مرحلة</dd></div></dl>
        ${c.jobId ? `<p class="f-hint">${ic("brief", "xs")} من <a href="#/job/${enc(c.jobId)}">إعلان الوظيفة</a></p>` : ""}
        ${(d.teams || []).length ? `<p class="f-hint">${ic("users", "xs")} الفريق: ${d.teams.map((t) => `<a href="#/team/${enc(t.id)}">${h(t.name)}</a>`).join("، ")}</p>` : ["active", "completed"].includes(c.status) && (me.client || me.worker) ? `<p class="f-hint">${ic("users", "xs")} <a href="#/teams/new?contract=${enc(c.id)}">أنشئ فريقاً لهذا العقد</a> لتوزيع المهام والملفات.</p>` : ""}</section>
      ${c.status === "completed" && (me.client || me.worker) ? `<div class="notice">${ic("star")}<span>اكتمل العقد. <a class="u-fw7" href="#/reviews?tab=pending">قيّم التعامل</a> خلال 30 يوماً — يظهر تقييمك عندما يقيّمك الطرف الآخر.</span></div>` : ""}
      ${c.status === "offer" ? `<section class="card wk-sec"><h3 class="wk-st">${ic("mail")}${me.worker ? "عرض بانتظار ردك" : "بانتظار رد المنفّذ"}</h3>${me.canRespond ? `<form class="f-form" id="wk-resp"><label>رسالة (اختياري)<textarea name="note" rows="2" maxlength="600"></textarea></label><div class="wk-acts"><button class="btn" type="button" data-resp="accept">${ic("check")}قبول العقد</button><button class="btn ghost" type="button" data-resp="decline">رفض</button></div></form>` : ""}${me.canWithdraw ? `<button class="btn ghost sm" type="button" id="wk-wdc">سحب العرض</button>` : ""}</section>` : ""}
      ${c.declineNote ? `<div class="notice">${ic("comment")}<span>${h(c.declineNote)}</span></div>` : ""}
      ${d.piNotice && c.paid && ["offer", "active"].includes(c.status) ? `<div class="notice">${ic("wallet")}<span>${h(d.piNotice)}</span></div>` : ""}
      <section class="card wk-sec"><h3 class="wk-st">${ic("doc")}نطاق العمل</h3><p class="wk-about">${h(c.scope)}</p></section>
      <h3 class="f-h">المراحل</h3><ol class="wk-msl">${d.milestones.map(msCard).join("")}</ol>
      <div class="notice">${ic("shield")}<span>${h(d.safety)}</span></div>
      <section class="card wk-sec u-mt12" aria-labelledby="wk-ctl-h"><h3 id="wk-ctl-h" class="wk-st">${ic("comment")}المتابعة والرسائل</h3><ol class="wk-tline">${d.events.map((e) => `<li class="${e.kind === "message" ? "message" : "status"} ${e.mine ? "mine" : ""}"><p>${evTxt(e)}</p><small>${e.kind === "message" ? (e.mine ? "أنت" : e.by === "client" ? "العميل" : e.by === "worker" ? "المنفّذ" : "فريق المنصة") + " · " : ""}${h(day(e.at))}</small>${e.warn ? `<span class="notice warn">${ic("alert")}<span>تنبيه: يبدو أن الرسالة تطلب دفعاً أو تواصلاً خارج المنصة أو بيانات محفظتك. لا تدفع ولا تشارك عبارة المرور.</span></span>` : ""}</li>`).join("")}</ol>
        ${me.canMessage ? `<form class="f-form wk-msgf" id="wk-cmf"><label><span class="vh">رسالتك</span><textarea name="body" rows="2" maxlength="2000" required placeholder="اكتب رسالة…"></textarea></label><button class="btn sm" type="submit">إرسال</button></form>` : ""}</section>
      ${me.canCancel ? `<p class="u-mt12"><button class="btn ghost sm" type="button" id="wk-cc">${me.worker ? "إنهاء العقد (يُعاد ما في الضمان للعميل)" : "إلغاء العقد"}</button></p>` : ""}`;
    const reload = () => contractView(cid);
    box.querySelectorAll("[data-resp]").forEach((b) => b.addEventListener("click", () => { const accept = b.dataset.resp === "accept"; if (!accept && !confirm("رفض العرض؟")) return; busy(b, async () => { await api("POST", `/api/contracts/${enc(cid)}/respond`, { accept, note: $("#wk-resp").note.value.trim() || undefined }); say(accept ? "بدأ العقد" : "رُفض العرض"); reload(); }); }));
    $("#wk-wdc")?.addEventListener("click", (e) => { if (!confirm("سحب العرض؟")) return; busy(e.currentTarget, async () => { await api("POST", `/api/contracts/${enc(cid)}/withdraw`); say("سُحب العرض"); reload(); }); });
    $("#wk-cc")?.addEventListener("click", (e) => { if (!confirm(me.worker ? "إنهاء العقد؟ ستُعاد المبالغ المموّلة غير المعتمدة للعميل." : "إلغاء العقد؟")) return; busy(e.currentTarget, async () => { await api("POST", `/api/contracts/${enc(cid)}/cancel`, {}); say("انتهى العقد"); reload(); }); });
    $("#wk-cmf")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/contracts/${enc(cid)}/messages`, { body: e.target.body.value.trim() }); await reload(); $("#wk-cmf textarea")?.focus(); }); });
    box.querySelectorAll("[data-ma]").forEach((b) => b.addEventListener("click", () => {
      const mid = b.dataset.m, m = d.milestones.find((x) => x.id === mid), a = b.dataset.ma, P = `/api/contract-milestones/${enc(mid)}/`;
      if (a === "approve") { if (!confirm(m.paid ? `اعتماد «${m.title}» وصرف ${piv(m.amount)} للمنفّذ؟` : `اعتماد «${m.title}»؟`)) return; return busy(b, async () => { await api("POST", P + "review", { action: "approve" }); say("اعتُمدت المرحلة"); reload(); }); }
      if (a === "fund") return busy(b, async () => { const r = await api("POST", P + "fund"); if (!window.MPPi?.pay) return say("افتح التطبيق في متصفح Pi لإكمال الدفع"); await MPPi.pay({ amount: r.amount, memo: r.intent.memo, purpose: "contract", refId: mid, intent: async () => r.intent }); say("ستظهر المرحلة مموّلة بعد تأكيد الدفع"); reload(); });
      const forms = {
        submit: `<h3 class="u-mt0">تسليم: ${h(m.title)}</h3><form class="f-form" id="wk-mf"><label>ما الذي سلّمته؟<textarea name="note" rows="4" required minlength="10" maxlength="3000"></textarea></label>${[0, 1, 2].map((i) => `<label>رابط ${num(i + 1)} (اختياري)<input name="l${i}" type="url" dir="ltr" maxlength="500" placeholder="https://"></label>`).join("")}<div class="wk-acts"><button class="btn" type="submit">تسليم</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`,
        revision: `<h3 class="u-mt0">طلب تعديل: ${h(m.title)}</h3><p class="f-hint">المتبقي ${num(d.contract.maxRevisions - m.revisions)} من ${num(d.contract.maxRevisions)} تعديلات.</p><form class="f-form" id="wk-mf"><label>ما المطلوب تعديله؟<textarea name="note" rows="4" required minlength="5" maxlength="2000"></textarea></label><div class="wk-acts"><button class="btn" type="submit">إرسال الطلب</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`,
        dispute: `<h3 class="u-mt0">فتح نزاع: ${h(m.title)}</h3><p class="f-hint">تُجمَّد المرحلة ويراجع فريق المنصة التسليم والرسائل، ثم يقرّر صرف المبلغ أو إعادته أو تقسيمه.</p><form class="f-form" id="wk-mf"><label>السبب<select name="reason" required><option value="">اختر…</option>${Object.entries(d.options.reasons).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></label><label>اشرح ما حدث<textarea name="body" rows="4" required minlength="20" maxlength="3000"></textarea></label><div class="wk-acts"><button class="btn danger" type="submit">فتح النزاع</button><button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`
      };
      sheet(forms[a]); const f = sheetQ("#wk-mf"); f.querySelector("textarea, select")?.focus();
      f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => {
        if (a === "submit") await api("POST", P + "submit", { note: f.note.value.trim(), links: [0, 1, 2].map((i) => f["l" + i].value.trim()).filter(Boolean) });
        else if (a === "revision") await api("POST", P + "review", { action: "revision", note: f.note.value.trim() });
        else await api("POST", P + "dispute", { reason: f.reason.value, body: f.body.value.trim() });
        closeSheet(); say(a === "submit" ? "سُلّمت المرحلة" : a === "revision" ? "أُرسل طلب التعديل" : "فُتح النزاع"); reload(); }); });
    }));
  }

  async function adminContracts() {
    page({ title: "العقود — النزاعات", icon: "shield", back: ["#/admin", "الإدارة"] }, `<div id="wk-ac">${skel(3)}</div>`);
    const box = $("#wk-ac");
    let d; try { d = await api("GET", "/api/admin/contracts"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const T = d.totals;
    box.innerHTML = `<div class="f-kpis"><div class="kpi-tile"><b>${num(T.active)}</b><span>عقد نشط</span></div><div class="kpi-tile"><b>${num(T.completed)}</b><span>عقد مكتمل</span></div><div class="kpi-tile"><b>${num(T.disputes)}</b><span>نزاع مفتوح</span></div><div class="kpi-tile"><b>${piv(T.escrow)}</b><span>في الضمان</span></div></div>
      <div class="f-h">نزاعات مفتوحة</div>${d.disputes.length ? `<ul class="wk-q">${d.disputes.map((x) => `<li class="card"><div class="wk-sh"><a class="u-fw7 u-f1" href="#/contract/${enc(x.contractId)}">${h(x.contract)}</a><span class="sbadge warn">${piv(x.amount)}</span></div>
          <small class="f-hint">المرحلة: ${h(x.milestone)} · العميل ${h(x.client?.name || "")} · المنفّذ ${h(x.worker?.name || "")} · فتحه ${x.openedBy === "client" ? "العميل" : "المنفّذ"}</small>
          <p class="wk-about"><b>${h(x.reason)}:</b> ${h(x.body)}</p>${x.deliverables.length ? `<ol class="wk-dl">${x.deliverables.map((v) => `<li><p>${h(v.note)}</p>${v.links.map((l) => `<a class="wk-link" href="${h(l)}" target="_blank" rel="noopener noreferrer nofollow"><bdi>${h(l)}</bdi></a>`).join(" ")}</li>`).join("")}</ol>` : `<p class="f-hint">لا تسليم بعد.</p>`}
          <form class="f-form" data-dsp="${h(x.id)}"><div class="wk-two"><label>القرار<select name="outcome" required><option value="release">صرف المبلغ للمنفّذ</option><option value="refund">إعادته للعميل</option><option value="split">تقسيم</option></select></label><label>حصة المنفّذ عند التقسيم (π)<input name="share" type="number" min="0" step="0.01" max="${h(x.amount)}" inputmode="decimal"></label></div><label>ملاحظة يراها الطرفان<textarea name="note" rows="2" required minlength="5" maxlength="2000"></textarea></label><button class="btn sm" type="submit">تنفيذ القرار</button></form></li>`).join("")}</ul>`
        : UI.empty({ title: "لا نزاعات مفتوحة", text: "كل العقود تسير على ما يرام." })}`;
    box.querySelectorAll("[data-dsp]").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", "/api/admin/contract-disputes/" + enc(f.dataset.dsp), { outcome: f.outcome.value, workerShare: f.share.value ? Number(f.share.value) : undefined, note: f.note.value.trim() }); say("نُفّذ القرار"); adminContracts(); }); }));
  }

  /* =================== routes =================== */
  MPRoutes.extend((a, b, prev) => {
    return { cv: () => (a ? profileView(decodeURIComponent(a)) : editorView()), talent: () => talentView(),
      jobs: () => (a === "new" ? jobForm(null) : jobsHub()),
      job: () => (b === "edit" ? jobForm(a) : b === "applicants" ? applicantsView(a) : jobView(a)),
      application: () => applicationView(a),
      contracts: () => (a === "new" ? contractForm() : contractsHub()), contract: () => contractView(a) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "pro" ? adminView() : a === "jobs" ? adminJobs() : a === "contracts" ? adminContracts() : next()));
  window.MPWork = { editorView, profileView, talentView, adminView, printCv, jobsHub, jobView, jobForm, applicantsView, applicationView, adminJobs, contractsHub, contractForm, contractView, adminContracts };
  if (!window.__deferRoute && /^#\/(cv|talent|jobs|job|application|contracts|contract|admin\/(pro|jobs|contracts))(\/|\?|$)/.test(location.hash)) route();
})();
