/* =====================================================================
 * مجتمع بلس — v2.8 transparency & compliance UI (Track 7, phase 34), lazy chunk "compliance".
 * • #/mydata          بياناتي وخصوصيتي: download a copy (JSON / ZIP), consents per purpose, my requests + new
 *                     request (correction / objection / question), delete my account (grace period, cancel).
 * • #/my-reports      بلاغاتي: each report's status as a step timeline (received → review → decision).
 * • #/account-log     سجل قرارات حسابي: moderation decisions on my account/content with reasons + appeal form.
 * • #/legal[/slug] الشروط والخصوصية بلغة واضحة: «باختصار» box, contents, readable sections; /register = سجل المعالجة.
 * • #/transparency[/period] تقارير الشفافية (also server-rendered at /transparency for visitors).
 * • #/compliance      admin: data-subject request queue with deadlines, breach log (72 h clock), retention rules
 *                     (preview / enforce when allowed), transparency generation.
 * Talks only to the REST routes in server/services/compliance.js (docs/COMPLIANCE.md). Styles are injected here.
 * ===================================================================== */
(function ComplianceUI() {
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const h = (s) => esc(String(s ?? ""));
  const V = () => document.getElementById("view");
  const fmt = (iso, time = false) => { if (!iso) return ""; try { return new Intl.DateTimeFormat("ar", time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "long" }).format(new Date(iso)); } catch { return iso; } };
  const num = (v) => (typeof v === "number" ? v.toLocaleString("ar") : h(v ?? "—"));
  const query = () => Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""));
  /* the app re-renders the current route when realtime data arrives; keep half-typed text across re-renders */
  const drafts = {};
  const keep = (root) => root.querySelectorAll("textarea[id],input[type=text][id]").forEach(el => { if (drafts[el.id] !== undefined && !el.value) el.value = drafts[el.id]; el.addEventListener("input", () => { drafts[el.id] = el.value; }); });
  const say = (msg) => { const r = document.getElementById("cmp-say"); if (r) { r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); } if (typeof toast === "function") toast(msg); };

  (function css() {
    if (document.getElementById("cmp-css")) return;
    const s = document.createElement("style"); s.id = "cmp-css";
    s.textContent = `.cmp h2{font-size:21px;margin:6px 0 4px}.cmp h3{font-size:16px;margin:18px 0 8px}.cmp p{line-height:1.8}.cmp .lead{color:var(--muted);margin:0 0 12px}
.cmp a:not(.btn):not(.card):not(.tab){color:var(--accent);text-decoration:underline;text-underline-offset:3px}.cmp a.muted,.cmp .page-head .back,.cmp a.li{color:var(--muted);text-decoration:none}.cmp a.li{color:inherit}.cmp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.cmp a:focus-visible,.cmp button:focus-visible,.cmp input:focus-visible,.cmp select:focus-visible,.cmp textarea:focus-visible,.cmp summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.cmp-tldr{border-inline-start:5px solid var(--accent);background:var(--accent2)}.cmp-tldr ul{margin:6px 0 0;padding-inline-start:1.2em;line-height:1.9}
.cmp-doc{font-size:16.5px;line-height:1.95}.cmp-doc section{border-top:1px solid var(--line);padding-top:4px}.cmp-doc h3{font-size:17px}.cmp-doc p{max-width:68ch;margin:0 0 .7em}
.cmp-toc{columns:2;column-gap:18px;padding-inline-start:1.8em;font-size:14px;line-height:2}@media(max-width:420px){.cmp-toc{columns:1}}
.cmp-tl{list-style:none;margin:10px 0 0;padding:0}.cmp-tl li{position:relative;padding:0 26px 14px 0;border-inline-start:0}.cmp-tl li::before{content:"";position:absolute;inset-inline-start:auto;right:6px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--line);box-shadow:0 0 0 3px var(--card)}
.cmp-tl li::after{content:"";position:absolute;right:10.5px;top:18px;bottom:0;width:1px;background:var(--line)}.cmp-tl li:last-child::after{display:none}
.cmp-tl li.done::before{background:var(--accent)}.cmp-tl li.cur::before{background:#e88b2a}.cmp-tl b{display:block}.cmp-tl .muted{display:block}
.cmp-pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;background:var(--accent2);color:var(--accent)}
.cmp-pill.ok{background:#e3f6ec;color:#17643f}.cmp-pill.warn{background:#fff1dc;color:#8a4b00}.cmp-pill.bad{background:#fde6e6;color:#9b1c1c}
@media(prefers-color-scheme:dark){.cmp-pill.ok{background:#173527;color:#8fe0b5}.cmp-pill.warn{background:#3a2a12;color:#ffc77a}.cmp-pill.bad{background:#3d1717;color:#ffb0b0}}
.cmp-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:8px 0}.cmp-stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px}.cmp-stat b{display:block;font-size:22px}.cmp-stat span{color:var(--muted);font-size:13px}
.cmp table{width:100%;border-collapse:collapse;font-size:14px}.cmp th,.cmp td{text-align:start;padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:top}.cmp th{color:var(--muted);font-weight:600}
.cmp label.f{display:block;font-weight:600;margin:10px 0 4px}.cmp input[type=text],.cmp input[type=password],.cmp input[type=number],.cmp input[type=datetime-local],.cmp select,.cmp textarea{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:9px 12px;background:var(--bg);color:var(--text);font:inherit}
.cmp .sw{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}.cmp .sw:last-child{border:0}.cmp .sw input{width:22px;height:22px;margin-top:3px;accent-color:var(--accent);flex:none}
.cmp .danger{background:#c62f2f;color:#fff}.cmp .warnbox{border:1px solid #e3a33b;background:#fff7e8;color:#5a3700}@media(prefers-color-scheme:dark){.cmp .warnbox{background:#2c2213;color:#ffd99a;border-color:#7a5520}}
.cmp .row2{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.cmp details summary{cursor:pointer;font-weight:700;padding:4px 0}`;
    document.head.appendChild(s);
  })();

  function frame(title, back = "#/settings", backLabel = "الإعدادات") {
    V().innerHTML = `<div class="wrap cmp">${UI.pageHead({ back: [back, backLabel], title, id: "cmp-h" })}<p id="cmp-say" class="cmp-sr" role="status" aria-live="polite"></p><div id="cmp-body"><div class="skel"></div><div class="skel"></div></div></div>`;
    document.getElementById("cmp-h")?.focus({ preventScroll: true });
    return document.getElementById("cmp-body");
  }
  const offline = (b) => { b.innerHTML = `<div class="empty">هذه الصفحة تعمل عند الاتصال بخادم مجتمع بلس</div>`; };
  const fail = (b, e) => { b.innerHTML = `<div class="empty" role="alert">${h(e.message || "تعذّر التحميل")}</div>`; };
  /* Route may change while awaiting (fast tab switches): if this view's body was replaced, drop the stale result so it never writes into (or retitles) the new page. */
  async function load(b, fn) { if (!online()) return offline(b), null; try { const r = await fn(); return b.isConnected ? r : null; } catch (e) { if (b.isConnected) fail(b, e); return null; } }

  /* ---------- policies (in-app reading view) ---------- */
  async function policies(slug) {
    const b = frame(slug ? "السياسات" : "الشروط والخصوصية", slug ? "#/legal" : "#/settings", slug ? "كل السياسات" : "الإعدادات");
    if (slug === "register") return register(b);
    if (!slug) {
      const r = await load(b, () => api("GET", "/api/legal")); if (!r) return;
      b.innerHTML = `<p class="lead">نصوص قصيرة بلغة واضحة. ابدأ بالملخص، والتفاصيل تحته.</p>${r.policies.map(p => `<a class="u-db card" href="#/legal/${h(p.slug)}"><b>${h(p.title)}</b> <span class="muted">· الإصدار ${h(p.version)}</span><div class="u-mt4 muted">${h(p.summary[0])}</div></a>`).join("")}
        <a class="u-db card" href="#/legal/register"><b>سجل أنشطة المعالجة</b><div class="muted">كل نوع من البيانات: لماذا نعالجه، وعلى أي أساس، وكم نحتفظ به</div></a>
        <a class="u-db card" href="#/transparency"><b>تقارير الشفافية</b><div class="muted">أرقام البلاغات والقرارات والاستئنافات كل شهر</div></a><a class="u-db card" href="#/finance-report"><b>الشفافية المالية</b><div class="muted">حجم مدفوعات Pi والرسوم والمدفوعات والاحتياطيات (مجمّعة)</div></a>`;
      return;
    }
    const r = await load(b, () => api("GET", "/api/legal/" + encodeURIComponent(slug))); if (!r) return;
    const d = r.policy; document.getElementById("cmp-h").textContent = d.title;
    b.innerHTML = `<p class="muted">الإصدار ${h(d.version)} · سارية من ${h(fmt(d.effective))} · <a href="/legal/${h(d.slug)}" target="_blank" rel="noopener">رابط للمشاركة</a></p>
      <div class="card cmp-tldr" role="note"><b>باختصار</b><ul>${d.summary.map(s => `<li>${h(s)}</li>`).join("")}</ul></div>
      <nav aria-label="المحتويات"><ol class="cmp-toc">${d.sections.map(s => `<li><a href="#/legal/${h(d.slug)}" data-cmp-sec="${h(s.id)}">${h(s.heading)}</a></li>`).join("")}</ol></nav>
      <div class="card cmp-doc">${d.sections.map(s => `<section id="sec-${h(s.id)}" aria-labelledby="sh-${h(s.id)}"><h3 id="sh-${h(s.id)}" tabindex="-1">${h(s.heading)}</h3>${s.body.map(p => `<p>${h(p)}</p>`).join("")}</section>`).join("")}</div>`;
    b.querySelectorAll("[data-cmp-sec]").forEach(a => a.onclick = (e) => { e.preventDefault(); const t = document.getElementById("sh-" + a.dataset.cmpSec); t?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); t?.focus({ preventScroll: true }); });
  }
  async function register(b) {
    document.getElementById("cmp-h").textContent = "سجل أنشطة المعالجة";
    const r = await load(b, () => api("GET", "/api/privacy/register")); if (!r) return;
    b.innerHTML = `<p class="lead">جهة التحكم: ${h(r.controller)}${r.contact ? ` · للتواصل: ${h(r.contact)}` : ""}. ${h(r.disclaimer)}</p>
      <h3>الأغراض والأساس</h3><div class="card"><table><thead><tr><th scope="col">الغرض</th><th scope="col">الأساس</th></tr></thead><tbody>${r.purposes.map(p => `<tr><td><b>${h(p.label)}</b><div class="muted">${h(p.descr)}</div></td><td>${h(p.basisLabel)}${p.required ? "" : `<div class="muted">يمكن سحبها</div>`}</td></tr>`).join("")}</tbody></table></div>
      <h3>البيانات ومدد الاحتفاظ</h3><div class="card"><table><thead><tr><th scope="col">البيانات</th><th scope="col">الغرض</th><th scope="col">الاحتفاظ</th></tr></thead><tbody>${r.activities.map(a => `<tr><td>${h(a.category)}</td><td>${h(a.purposeLabel || "")}</td><td>${h(a.retention)}<div class="muted">${h(a.onErasure || "")}</div></td></tr>`).join("")}</tbody></table></div>
      <h3>من يعالج البيانات نيابةً عنا</h3><div class="card"><ul>${r.recipients.map(x => `<li>${h(x)}</li>`).join("")}</ul></div>`;
  }

  /* ---------- transparency ---------- */
  const LBL = { post: "منشور", comment: "تعليق", user: "حساب", community: "مجتمع", message: "رسالة", REMOVED: "إزالة محتوى", remove: "حذف محتوى", reject: "رفض منشور", warn: "إنذار", mute: "كتم مؤقت", ban: "حظر", dismiss: "رفض بلاغ", automod_reject: "رفض آلي", automod_queue: "تحويل آلي للمراجعة" };
  const stat = (v, l) => `<div class="cmp-stat"><b>${num(v)}</b><span>${h(l)}</span></div>`;
  const tbl = (o) => { const e = Object.entries(o || {}); return e.length ? `<table><thead><tr><th scope="col">النوع</th><th scope="col">العدد</th></tr></thead><tbody>${e.map(([k, v]) => `<tr><td>${h(LBL[k] || k)}</td><td>${num(v)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">لا شيء في هذه الفترة.</p>`; };
  async function transparency(period) {
    const b = frame("تقارير الشفافية", period ? "#/transparency" : "#/legal", period ? "كل التقارير" : "السياسات");
    if (!period) {
      const r = await load(b, () => api("GET", "/api/transparency")); if (!r) return;
      b.innerHTML = `<p class="lead">ننشر أرقاماً مجمّعة كل شهر وكل ربع سنة. لا تحتوي أي بيانات شخصية.</p>${r.reports.length ? r.reports.map(x => `<a class="u-dflex card row" href="#/transparency/${h(x.period)}"><div class="grow"><b>${h(x.label)}</b><div class="muted">${num(x.reports)} بلاغ · ${num(x.actioned)} إجراء · ${num(x.appeals)} استئناف</div></div><span class="fwd muted" aria-hidden="true">←</span></a>`).join("") : `<div class="empty">يصدر أول تقرير تلقائياً بعد انتهاء أول شهر.</div>`}`;
      return;
    }
    const r = await load(b, () => api("GET", "/api/transparency/" + encodeURIComponent(period))); if (!r) return;
    const t = r.report; document.getElementById("cmp-h").textContent = "تقرير الشفافية: " + t.label;
    b.innerHTML = `<p class="muted">أُعدّ ${h(fmt(t.generatedAt))} · <a href="/transparency/${h(t.period)}" target="_blank" rel="noopener">نسخة للمشاركة</a></p>
      <div class="cmp-grid">${stat(t.reports.received, "بلاغ وصلنا")}${stat(t.reports.actioned, "اتُّخذ فيه إجراء")}${stat(t.reports.dismissed, "بلا مخالفة")}${stat(t.reports.medianHoursToDecision, "ساعة حتى القرار (الوسيط)")}</div>
      <h3>البلاغات حسب النوع</h3><div class="card">${tbl(t.reports.byKind)}</div>
      <h3>قرارات الإشراف</h3><div class="cmp-grid">${stat(t.decisions.total, "قرار")}${stat(t.decisions.reversedOnAppeal, "أُلغي بعد استئناف")}</div><div class="card">${tbl(t.decisions.byAction)}</div>
      <h3>الاستئنافات</h3><div class="cmp-grid">${stat(t.appeals.received, "استئناف")}${stat(t.appeals.accepted, "قُبل")}${stat(t.appeals.rejected, "رُفض")}${stat(t.appeals.medianHoursToDecision, "ساعة حتى البتّ (الوسيط)")}</div>
      <h3>إشراف المجتمعات</h3><div class="card">${tbl(t.communityModeration.byAction)}<p class="muted">منها ${num(t.communityModeration.automated)} بقواعد آلية.</p></div>
      <h3>الحسابات وطلبات البيانات</h3><div class="cmp-grid">${stat(t.accounts.suspended, "حساب موقوف")}${stat(t.accounts.reinstated, "أُعيد تفعيله")}${stat(t.dataRequests.export, "طلب نسخة بيانات")}${stat(t.dataRequests.delete, "طلب حذف حساب")}</div>
      <details class="card"><summary>ملاحظات منهجية</summary>${t.notes.map(n => `<p>${h(n)}</p>`).join("")}</details>`;
  }

  /* ---------- my reports ---------- */
  const tone = (s) => (s === "actioned" ? "ok" : s === "dismissed" ? "" : "warn");
  const timeline = (steps) => `<ol class="cmp-tl">${steps.map(s => `<li class="${s.done ? "done" : ""} ${s.current ? "cur" : ""}"${s.current ? ` aria-current="step"` : ""}><b>${h(s.label)}</b>${s.at ? `<span class="muted">${h(fmt(s.at, true))}</span>` : ""}${s.detail ? `<span class="muted">${h(s.detail)}</span>` : ""}</li>`).join("")}</ol>`;
  async function myReports() {
    const b = frame("بلاغاتي", "#/mydata", "بياناتي وخصوصيتي");
    const r = await load(b, () => api("GET", "/api/me/reports")); if (!r) return;
    b.innerHTML = `<p class="lead">لا يعرف صاحب المحتوى من أبلغ عنه. سنرسل إليك إشعاراً عند اتخاذ القرار.</p>${r.reports.length ? r.reports.map(x => `<article class="card" aria-labelledby="rp-${h(x.id)}"><div class="row"><b class="grow" id="rp-${h(x.id)}">بلاغ عن ${h(x.kindLabel)}: «${h(x.reason)}»</b><span class="cmp-pill ${tone(x.status)}">${h(x.statusLabel)}</span></div>
      ${timeline(x.timeline)}${x.href ? `<a href="${h(x.href)}">عرض المحتوى</a>` : ""}</article>`).join("") : `<div class="empty">لم تقدّم أي بلاغ. يمكنك الإبلاغ من قائمة «…» على أي منشور.</div>`}`;
  }

  /* ---------- account decision log ---------- */
  const APPEAL = { open: ["قيد المراجعة", "warn"], accepted: ["قُبل الاستئناف", "ok"], rejected: ["رُفض الاستئناف", "bad"] };
  async function accountLog() {
    const b = frame("سجل قرارات حسابي", "#/mydata", "بياناتي وخصوصيتي");
    const r = await load(b, () => api("GET", "/api/me/account-log")); if (!r) return;
    const want = query().appeal;
    b.innerHTML = `<p class="lead">كل قرار اتُّخذ بحق حسابك أو محتواك، مع السبب. يمكنك الاستئناف على قرارات فريق مجتمع بلس مرة واحدة لكل قرار.</p>
      ${r.items.length ? r.items.map(i => `<article class="card" aria-labelledby="al-${h(i.id)}"><div class="row"><b class="grow" id="al-${h(i.id)}">${h(i.label)}</b>${i.restored ? `<span class="cmp-pill ok">أُلغي القرار</span>` : i.appeal ? `<span class="cmp-pill ${APPEAL[i.appeal.status]?.[1] || ""}">${h(APPEAL[i.appeal.status]?.[0] || i.appeal.status)}</span>` : ""}</div>
        <div class="muted">${h(i.sourceLabel || "")} · ${h(fmt(i.at, true))}</div>
        ${i.reason ? `<p class="u-m0 u-mt8"><span class="muted">السبب:</span> ${h(i.reason)}</p>` : ""}${i.excerpt ? `<p class="u-m0 u-mt4 muted">«${h(i.excerpt)}»</p>` : ""}
        ${i.canAppeal ? `<details ${want === i.id ? "open" : ""}><summary>استئناف القرار</summary><label class="f" for="apt-${h(i.id)}">لماذا تعتقد أن القرار خاطئ؟</label><textarea id="apt-${h(i.id)}" rows="3" maxlength="1000" placeholder="اشرح السياق باختصار"></textarea><div class="row2"><button class="btn" data-cmp-appeal="${h(i.id)}">إرسال الاستئناف</button></div></details>` : ""}
        ${i.appealNote ? `<p class="u-m0 u-mt6 muted">${h(i.appealNote)}${i.source === "community" && i.community?.id ? ` <a href="#/c/${h(i.community.id)}">صفحة المجتمع</a>` : ""}</p>` : ""}</article>`).join("") : `<div class="empty">لا توجد أي قرارات على حسابك.</div>`}
      <p class="muted"><a href="#/legal/terms">كيف نطبّق القواعد</a> · <a href="#/transparency">تقارير الشفافية</a></p>`;
    keep(b);
    if (want) document.getElementById("apt-" + want)?.focus();
    b.querySelectorAll("[data-cmp-appeal]").forEach(btn => btn.onclick = async () => {
      const t = document.getElementById("apt-" + btn.dataset.cmpAppeal).value.trim(); if (t.length < 5) return say("اكتب سبب الاستئناف أولاً");
      btn.disabled = true; try { await api("POST", "/api/appeals", { decision: btn.dataset.cmpAppeal, text: t }); delete drafts["apt-" + btn.dataset.cmpAppeal]; say("أُرسل الاستئناف ✓ سنراجعه ونخبرك"); accountLog(); } catch (e) { say(e.message); btn.disabled = false; }
    });
  }

  /* ---------- my data & privacy ---------- */
  const RSTATUS = { received: ["مستلم", "warn"], extended: ["مُدّد", "warn"], scheduled: ["مجدول", "warn"], processing: ["قيد التنفيذ", "warn"], completed: ["مكتمل", "ok"], rejected: ["مرفوض", "bad"], cancelled: ["أُلغي", ""] };
  async function myData() {
    const b = frame("بياناتي وخصوصيتي");
    const r = await load(b, () => api("GET", "/api/me/privacy")); if (!r) return;
    const del = r.deletion;
    b.innerHTML = `${del ? `<div class="card warnbox" role="alert"><b>حسابك مجدول للحذف في ${h(fmt(del.scheduledFor))}</b><p class="u-my6">حتى ذلك الحين يمكنك التراجع وسيبقى كل شيء كما هو.</p><button class="btn" id="cmp-undo">إلغاء الحذف والاحتفاظ بحسابي</button></div>` : ""}
      ${r.terms.upToDate ? "" : `<div class="card"><b>تحديث في شروط الاستخدام (الإصدار ${h(r.terms.version)})</b><p class="u-my4 muted">اقرأ <a href="#/legal/terms">الملخص</a> ثم وافق للمتابعة.</p><button class="btn ghost" id="cmp-terms">قرأتها وأوافق</button></div>`}
      <p class="lead">حقوقك وفق نظام حماية البيانات الشخصية: الاطلاع، والنسخ، والتصحيح، والحذف، وسحب الموافقة. نرد على كل طلب خلال ${num(r.deadlineDays)} يوماً.</p>
      <h3>نسخة من بياناتك</h3><div class="card"><p class="u-m0 u-mb8 muted">منشوراتك وتعليقاتك ورسائلك المرسلة ومتابعاتك وإعداداتك وسجل الجلسات. لا نضمّن كلمات المرور ولا رسائل الآخرين.</p>
        <div class="row2"><a class="btn" href="/api/me/privacy/export?format=zip" download>تنزيل ZIP (مع الصور)</a><a class="btn ghost" href="/api/me/privacy/export?format=json" download>تنزيل JSON</a></div></div>
      <h3>الموافقات</h3><div class="card" id="cmp-consents">${r.consents.map(c => `<div class="sw"><input type="checkbox" id="cs-${h(c.purpose)}" data-cmp-cs="${h(c.purpose)}" ${c.granted ? "checked" : ""} ${c.required ? "disabled" : ""} aria-describedby="csd-${h(c.purpose)}"><label for="cs-${h(c.purpose)}" class="grow"><b>${h(c.label)}</b><span class="u-db muted" id="csd-${h(c.purpose)}">${h(c.descr)} · الأساس: ${h(c.basisLabel)}${c.required ? " (لا تعمل الخدمة بدونها)" : ""}</span></label></div>`).join("")}</div>
      <h3>سجلات تخصّك</h3><a class="u-dflex card row" href="#/account-log"><div class="grow"><b>سجل قرارات حسابي</b><div class="muted">قرارات الإشراف وأسبابها والاستئناف</div></div><span aria-hidden="true" class="muted">←</span></a>
      <a class="u-dflex card row" href="#/my-reports"><div class="grow"><b>بلاغاتي</b><div class="muted">حالة كل بلاغ قدّمته</div></div><span aria-hidden="true" class="muted">←</span></a>
      <h3>طلباتك</h3><div class="card">${r.requests.length ? `<table><thead><tr><th scope="col">الطلب</th><th scope="col">الحالة</th><th scope="col">التاريخ</th></tr></thead><tbody>${r.requests.map(q => `<tr><td>${h(q.kindLabel)}${q.response ? `<div class="muted">الرد: ${h(q.response)}</div>` : ""}</td><td><span class="cmp-pill ${RSTATUS[q.status]?.[1] || ""}">${h(RSTATUS[q.status]?.[0] || q.status)}</span></td><td>${h(fmt(q.createdAt))}</td></tr>`).join("")}</tbody></table>` : `<p class="u-m0 muted">لا طلبات بعد.</p>`}
        <details class="u-mt10"><summary>طلب بخصوص بياناتي</summary><label class="f" for="cmp-rk">نوع الطلب</label><select id="cmp-rk">${Object.entries(r.requestKinds).map(([k, v]) => `<option value="${h(k)}">${h(v)}</option>`).join("")}</select>
          <label class="f" for="cmp-rt">التفاصيل</label><textarea id="cmp-rt" rows="3" maxlength="2000" placeholder="مثلاً: أريد تصحيح…"></textarea><div class="row2"><button class="btn" id="cmp-rsend">إرسال الطلب</button></div></details></div>
      <h3>حذف الحساب</h3><div class="card">${del ? `<p class="u-m0 muted">طلب الحذف مسجّل. استخدم الزر أعلاه للتراجع.</p>` : `<p class="u-m0 u-mb6">يُنفَّذ الحذف بعد ${num(r.graceDays)} يوماً يمكنك خلالها التراجع. بعدها تُمحى بياناتك الشخصية ويُمسح نص منشوراتك ورسائلك، ويظهر اسمك «مستخدم محذوف». لا يمكن التراجع بعد التنفيذ.</p>
        <details><summary>أريد حذف حسابي</summary>${r.hasPassword ? `<label class="f" for="cmp-pw">كلمة المرور</label><input type="password" id="cmp-pw" autocomplete="current-password">` : ""}
          <label class="f" for="cmp-why">لماذا تغادر؟ (اختياري)</label><input type="text" id="cmp-why" maxlength="500">
          <label class="f" for="cmp-cf">اكتب كلمة «حذف» للتأكيد</label><input type="text" id="cmp-cf" autocomplete="off">
          <div class="row2"><button class="btn danger" id="cmp-del">جدولة حذف الحساب</button><a class="btn ghost" href="/api/me/privacy/export?format=zip" download>نزّل نسخة أولاً</a></div></details>`}</div>
      <p class="muted"><a href="#/legal/privacy">سياسة الخصوصية</a> · <a href="#/legal/register">سجل المعالجة</a> · <a href="#/legal/retention">مدد الاحتفاظ</a></p>`;
    keep(b);
    document.getElementById("cmp-undo")?.addEventListener("click", async () => { try { await api("DELETE", "/api/me/privacy/deletion"); say("أُلغي طلب الحذف ✓ حسابك باقٍ"); myData(); } catch (e) { say(e.message); } });
    document.getElementById("cmp-terms")?.addEventListener("click", async () => { try { await api("PUT", "/api/me/consents", { acceptTerms: true }); say("شكراً ✓"); myData(); } catch (e) { say(e.message); } });
    b.querySelectorAll("[data-cmp-cs]").forEach(el => el.onchange = async () => {
      try { await api("PUT", "/api/me/consents", { purposes: { [el.dataset.cmpCs]: el.checked } }); say(el.checked ? "✓ فُعّلت الموافقة" : "سُحبت الموافقة"); }
      catch (e) { el.checked = !el.checked; say(e.message); }
    });
    document.getElementById("cmp-rsend")?.addEventListener("click", async (ev) => {
      const t = document.getElementById("cmp-rt").value.trim(); if (t.length < 5) return say("اكتب تفاصيل الطلب");
      ev.target.disabled = true; try { await api("POST", "/api/me/privacy/requests", { kind: document.getElementById("cmp-rk").value, text: t }); delete drafts["cmp-rt"]; say("استلمنا طلبك ✓"); myData(); } catch (e) { say(e.message); ev.target.disabled = false; }
    });
    document.getElementById("cmp-del")?.addEventListener("click", async (ev) => {
      const cf = document.getElementById("cmp-cf").value.trim(); if (cf !== "حذف") { say("اكتب كلمة «حذف» للتأكيد"); document.getElementById("cmp-cf").focus(); return; }
      ev.target.disabled = true;
      try { const x = await api("POST", "/api/me/privacy/deletion", { confirm: cf, password: document.getElementById("cmp-pw")?.value, reason: document.getElementById("cmp-why").value.trim() || undefined }); say(`جُدول الحذف في ${fmt(x.scheduledFor)}`); myData(); }
      catch (e) { say(e.message); ev.target.disabled = false; }
    });
  }

  /* ---------- admin: compliance console ---------- */
  const DL = { ok: ["ضمن المهلة", "ok"], soon: ["تقترب المهلة", "warn"], overdue: ["تجاوز المهلة", "bad"], done: ["تم", "ok"], "n/a": ["لا يلزم إبلاغ", ""] };
  const pill = (k) => `<span class="cmp-pill ${DL[k]?.[1] || ""}">${h(DL[k]?.[0] || k)}</span>`;
  async function admin(tab) {
    tab = tab || "requests";
    const b = frame("الامتثال وحماية البيانات", "#/admin", "لوحة الإدارة");
    const r = await load(b, () => api("GET", "/api/admin/compliance")); if (!r) return;
    const tabs = [["requests", `طلبات البيانات (${r.requests.length})`], ["breaches", "سجل التسرّب"], ["retention", "الاحتفاظ"], ["transparency", "الشفافية"]];
    b.innerHTML = `<div class="tabs" role="tablist" aria-label="أقسام الامتثال">${tabs.map(([k, l]) => `<a role="tab" class="tab ${k === tab ? "on" : ""}" aria-selected="${k === tab}" href="#/compliance/${k}">${h(l)}</a>`).join("")}</div><div id="cmp-tab" role="tabpanel"></div>
      <p class="muted">دعم هندسي للامتثال لنظام حماية البيانات الشخصية، وليس استشارة قانونية.</p>`;
    const T = document.getElementById("cmp-tab");
    if (!T) return;
    setTimeout(() => keep(T), 0);
    if (tab === "requests") {
      T.innerHTML = r.requests.length ? r.requests.map(q => `<article class="card"><div class="row"><b class="grow">${h(q.kindLabel)} · @${h(q.handle || q.user)}</b>${pill(q.deadline)}</div><div class="muted">${h(RSTATUS[q.status]?.[0] || q.status)} · المهلة ${h(fmt(q.dueAt))}${q.scheduledFor ? ` · التنفيذ ${h(fmt(q.scheduledFor))}` : ""}</div>${q.detail ? `<p>${h(q.detail)}</p>` : ""}
        ${["received", "extended"].includes(q.status) ? `<label class="f" for="rq-${h(q.id)}">الرد على صاحب الطلب</label><textarea id="rq-${h(q.id)}" rows="2"></textarea><div class="row2"><button class="btn" data-cmp-rq="${h(q.id)}" data-cmp-st="completed">إكمال</button><button class="btn ghost" data-cmp-rq="${h(q.id)}" data-cmp-st="extended" ${q.status === "extended" ? "disabled" : ""}>تمديد 30 يوماً</button><button class="btn ghost" data-cmp-rq="${h(q.id)}" data-cmp-st="rejected">رفض مع السبب</button></div>` : ""}</article>`).join("") : `<div class="empty">لا طلبات مفتوحة ✓</div>`;
      T.querySelectorAll("[data-cmp-rq]").forEach(btn => btn.onclick = async () => { const t = document.getElementById("rq-" + btn.dataset.cmpRq).value.trim(); if (t.length < 3) return say("اكتب الرد أولاً"); try { await api("POST", `/api/admin/compliance/requests/${btn.dataset.cmpRq}`, { status: btn.dataset.cmpSt, response: t }); say("حُفظ ✓"); admin("requests"); } catch (e) { say(e.message); } });
    } else if (tab === "breaches") {
      T.innerHTML = `<details class="card"><summary>تسجيل حادثة جديدة</summary><label class="f" for="br-t">العنوان</label><input type="text" id="br-t" maxlength="200"><label class="f" for="br-d">الوصف (الوقت والظروف)</label><textarea id="br-d" rows="3"></textarea>
        <label class="f" for="br-s">الخطورة</label><select id="br-s"><option value="low">منخفضة</option><option value="medium" selected>متوسطة</option><option value="high">عالية</option><option value="critical">حرجة</option></select>
        <label class="f" for="br-at">وقت العلم بالحادثة</label><input type="datetime-local" id="br-at"><label class="f" for="br-n">عدد المتأثرين (تقريبي)</label><input type="number" id="br-n" min="0">
        <label class="f" for="br-c">فئات البيانات (مفصولة بفواصل)</label><input type="text" id="br-c"><label class="f" for="br-m">الإجراءات المتخذة</label><textarea id="br-m" rows="2"></textarea><div class="row2"><button class="btn" id="br-go">تسجيل</button></div></details>
        <p class="muted">يُبلَّغ مركز سدايا خلال 72 ساعة من العلم بالحادثة متى كان من شأنها الإضرار بأصحاب البيانات (عبر المنصة الوطنية لحوكمة البيانات).</p>
        ${r.breaches.map(x => `<article class="card"><div class="row"><b class="grow">${h(x.title)}</b>${pill(x.authorityDeadline)}</div><div class="muted">${h(x.severity)} · ${h(x.status)} · العلم ${h(fmt(x.detectedAt, true))} · مهلة الإبلاغ ${h(fmt(x.authorityDueAt, true))}${x.affectedCount !== null && x.affectedCount !== undefined ? ` · المتأثرون ${num(x.affectedCount)}` : ""}</div>
          ${x.description ? `<p>${h(x.description)}</p>` : ""}${x.notes.length ? `<ul>${x.notes.map(n => `<li class="muted">${h(fmt(n.at, true))}: ${h(n.text)}</li>`).join("")}</ul>` : ""}
          <div class="row2">${x.authorityNotifiedAt ? "" : `<button class="btn ghost" data-cmp-br="${h(x.id)}" data-cmp-f="authorityNotifiedAt">أُبلغت الجهة المختصة الآن</button>`}${x.usersNotifiedAt ? "" : `<button class="btn ghost" data-cmp-br="${h(x.id)}" data-cmp-f="usersNotifiedAt">أُبلغ المتأثرون</button>`}${x.status === "open" ? `<button class="btn ghost" data-cmp-br="${h(x.id)}" data-cmp-f="contained">احتُويت</button>` : ""}${x.status !== "closed" ? `<button class="btn ghost" data-cmp-br="${h(x.id)}" data-cmp-f="closed">إغلاق</button>` : ""}</div></article>`).join("") || `<div class="empty">لا حوادث مسجلة.</div>`}`;
      document.getElementById("br-go").onclick = async () => {
        const at = document.getElementById("br-at").value;
        try { await api("POST", "/api/admin/breaches", { title: document.getElementById("br-t").value, description: document.getElementById("br-d").value, severity: document.getElementById("br-s").value, detectedAt: at ? new Date(at).toISOString() : undefined, affectedCount: document.getElementById("br-n").value || undefined, categories: document.getElementById("br-c").value.split(/[،,]/).map(s => s.trim()).filter(Boolean), measures: document.getElementById("br-m").value }); say("سُجّلت الحادثة"); admin("breaches"); } catch (e) { say(e.message); }
      };
      T.querySelectorAll("[data-cmp-br]").forEach(btn => btn.onclick = async () => { const f = btn.dataset.cmpF, body = f === "contained" || f === "closed" ? { status: f } : { [f]: new Date().toISOString() }; try { await api("PATCH", `/api/admin/breaches/${btn.dataset.cmpBr}`, body); admin("breaches"); } catch (e) { say(e.message); } });
    } else if (tab === "retention") {
      const R2 = r.retention;
      T.innerHTML = `<div class="card ${R2.enforceAllowed ? "" : "warnbox"}"><b>${R2.enforceAllowed ? "التنفيذ الفعلي مفعّل (RETENTION_ENFORCE=1)" : "وضع المعاينة فقط"}</b><p class="u-m0 u-mt4 muted">${R2.enforceAllowed ? "المهمة اليومية تحذف ما تجاوز المدة." : "المهمة اليومية تحسب ما كان سيُحذف دون حذف شيء. للتفعيل اضبط RETENTION_ENFORCE=1."} ملفات الوسائط ${R2.mediaBlobsAllowed ? "يمكن حذفها" : "لا تُحذف أبداً دون RETENTION_MEDIA_BLOBS=1"}.</p></div>
        <div class="card"><table><thead><tr><th scope="col">البيانات</th><th scope="col">المدة (يوم)</th><th scope="col">مفعّل</th><th scope="col">آخر معاينة</th></tr></thead><tbody>${R2.rules.map(x => { const last = R2.lastRun?.results.find(y => y.type === x.type); return `<tr><td>${h(x.label)}</td><td><input type="number" min="1" max="3650" value="${x.days}" data-cmp-days="${h(x.type)}" aria-label="مدة ${h(x.label)} بالأيام" style="width:90px"></td><td><input type="checkbox" data-cmp-en="${h(x.type)}" ${x.enabled ? "checked" : ""} aria-label="تفعيل ${h(x.label)}"></td><td>${last ? `${num(last.matched)}${last.affected ? ` / حُذف ${num(last.affected)}` : ""}${last.skipped ? `<div class="muted">${h(last.skipped)}</div>` : ""}` : "—"}</td></tr>`; }).join("")}</tbody></table>
        <div class="row2"><button class="btn ghost" id="rt-pv">معاينة الآن</button><button class="btn danger" id="rt-run" ${R2.enforceAllowed ? "" : "disabled aria-disabled=\"true\""}>تنفيذ الحذف الآن</button></div></div>
        <h3>لا تخضع للحذف الآلي</h3><div class="card"><ul>${R2.exempt.map(e => `<li><b>${h(e.label)}</b>: ${h(e.why)}</li>`).join("")}</ul></div>`;
      const save = async (type, body) => { try { await api("PUT", `/api/admin/retention/${type}`, body); say("حُفظ ✓"); } catch (e) { say(e.message); } };
      T.querySelectorAll("[data-cmp-days]").forEach(el => el.onchange = () => save(el.dataset.cmpDays, { days: +el.value }));
      T.querySelectorAll("[data-cmp-en]").forEach(el => el.onchange = () => save(el.dataset.cmpEn, { enabled: el.checked }));
      document.getElementById("rt-pv").onclick = async () => { try { await api("GET", "/api/admin/retention/preview"); admin("retention"); } catch (e) { say(e.message); } };
      document.getElementById("rt-run").onclick = async () => { if (!confirm("سيُحذف ما تجاوز المدة نهائياً. متابعة؟")) return; try { await api("POST", "/api/admin/retention/run", { enforce: true }); say("نُفّذ ✓"); admin("retention"); } catch (e) { say(e.message); } };
    } else {
      T.innerHTML = `<div class="card"><label class="f" for="tr-p">إصدار تقرير لفترة منتهية (YYYY-MM أو YYYY-Qn)</label><input type="text" id="tr-p" dir="ltr" placeholder="2026-09"><div class="row2"><button class="btn" id="tr-go">إصدار / إعادة إصدار</button><a class="btn ghost" href="/transparency" target="_blank" rel="noopener">الصفحة العامة</a></div></div>
        ${r.transparency.map(x => `<a class="u-dflex card row" href="#/transparency/${h(x.period)}"><div class="grow"><b>${h(x.label)}</b><div class="muted">${num(x.reports)} بلاغ · أُعدّ ${h(fmt(x.generatedAt))}</div></div></a>`).join("")}`;
      document.getElementById("tr-go").onclick = async () => { try { await api("POST", "/api/admin/transparency/generate", { period: document.getElementById("tr-p").value.trim() }); say("صدر التقرير ✓"); admin("transparency"); } catch (e) { say(e.message); } };
    }
  }

  /* ---------- routes + entry points ---------- */
  MPRoutes.extend((a, b, base) => {
    return { mydata: () => myData(), "my-reports": () => myReports(), "account-log": () => accountLog(), legal: () => policies(a), transparency: () => transparency(a), compliance: () => admin(a),
      decisions: () => (online() ? accountLog() : base.decisions ? base.decisions() : accountLog()) };
  });
  if (typeof Views !== "undefined" && Views.settings && !Views.settings.__cmp) {
    MPSettings.add(function () {
      const w = V()?.querySelector(".wrap"); if (!w || w.querySelector("#cmp-entry")) return;
      const first = w.querySelector(".card");
      const html = `<a href="#/mydata" id="cmp-entry" class="u-dflex card row"><span aria-hidden="true"><svg class=ei aria-hidden=true><use href=#i-shield /></svg></span><div class="grow"><b>بياناتي وخصوصيتي</b><div class="muted">نسخة من بياناتك، الموافقات، سجل القرارات، حذف الحساب</div></div><span class="fwd muted" aria-hidden="true">←</span></a>
        <a href="#/legal" class="u-dflex card row"><span aria-hidden="true"><svg class=ei aria-hidden=true><use href=#i-doc /></svg></span><div class="grow"><b>الشروط والخصوصية</b><div class="muted">بلغة واضحة، وتقارير الشفافية</div></div><span class="fwd muted" aria-hidden="true">←</span></a>`;
      first ? first.insertAdjacentHTML("beforebegin", html) : w.insertAdjacentHTML("beforeend", html);
    });
    Views.settings.__cmp = true;
  }
  if (typeof V12 !== "undefined" && V12.admin && !V12.admin.__cmp) {
    const _admin = V12.admin;
    V12.admin = function () { _admin.apply(this, arguments); const w = V()?.querySelector(".wrap"); if (w && online() && !w.querySelector("#cmp-admin")) (w.querySelector(":scope > .page-head") || w.querySelector("h2"))?.insertAdjacentHTML("afterend", `<a href="#/compliance" id="cmp-admin" class="u-dflex card row"><div class="grow"><b>الامتثال وحماية البيانات</b><div class="muted">طلبات البيانات، سجل التسرّب، الاحتفاظ، تقارير الشفافية</div></div><span class="fwd muted" aria-hidden="true">←</span></a>`); };
    V12.admin.__cmp = true;
  }
  window.MPCompliance = { myData, myReports, accountLog, policies, transparency, admin };
  const r = (location.hash.split("/")[1] || "").split("?")[0];
  if (["mydata", "my-reports", "account-log", "legal", "transparency", "compliance", "decisions"].includes(r) && typeof route === "function" && !window.__deferRoute) route();
})();
