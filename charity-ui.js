/* =====================================================================
 * مجتمع بلس — Phase 70 UI: volunteering, verified charities and transparent campaigns (lazy "charity" chunk + charity.css; 0 bytes in core
 * besides the route names).
 *   #/giving[?tab=campaigns|volunteer|orgs|mine]  hub: totals, campaigns by category, volunteering, verified organisations, «تطوّعي وتبرّعاتي»
 *   #/campaign/:id                               transparency page: goal, raised, donors, disbursed (Pi txid), spending + receipts, updates, donate, report
 *   #/organisation/:id | #/organisation/new      organisation profile (registry, licence), its campaigns and opportunities; managers edit, add editors,
 *                                                write campaigns and opportunities; new = registration form
 *   #/opportunity/:id                            one opportunity: sign up / withdraw; managers accept, decline, confirm hours (→ certificate)
 *   #/admin/charity[?tab=orgs|campaigns|reports] staff: verify organisations, review campaigns, disburse (Pi), reports
 * Money (donations, disbursements) needs Pi payments; while they are off the server answers 501 and every screen says so.
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function CharityUI() {
  if (window.MPCharity) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => UI.icon(n, c);
  const num = (n, o) => UI.num(n, o);
  const lang = () => (typeof DB !== "undefined" && DB.settings && DB.settings.lang) || "ar";
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const isAdmin = () => { try { return S.me()?.role === "admin"; } catch { return false; } };
  const day = (iso) => { try { return new Intl.DateTimeFormat(lang(), { numberingSystem: "latn", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)); } catch { return String(iso).slice(0, 10); } };
  const when = (iso) => { try { return new Intl.DateTimeFormat(lang(), { numberingSystem: "latn", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return String(iso).slice(0, 16); } };
  const sday = (iso) => { try { return new Intl.DateTimeFormat(lang(), { numberingSystem: "latn", day: "numeric", month: "short" }).format(new Date(iso)); } catch { return String(iso).slice(5, 10); } };
  const errBox = (e) => UI.empty({ title: "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم" });
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const badge = (tone, t) => `<span class="sbadge ${tone || ""}">${h(t)}</span>`;
  const TONE = { pending: "warn", verified: "ok", rejected: "bad", suspended: "bad", draft: "", review: "info", live: "ok", paused: "warn", ended: "", applied: "info", accepted: "ok", declined: "bad", withdrawn: "", attended: "ok", no_show: "warn", open: "ok", closed: "", cancelled: "bad" };
  const pi = (x) => `<bdi>${num(x, { maximumFractionDigits: 2 })} Pi</bdi>`;
  const page = (head, body) => { view.innerHTML = `<div class="wrap gv-page">${UI.pageHead({ ...head, id: "gv-h" })}${body}</div>`; $("#gv-h")?.focus({ preventScroll: true }); };
  const seg = (base, tabs, cur, label) => `<nav class="seg u-mb12" aria-label="${h(label)}">${tabs.map(([k, t]) => `<a href="${base}?tab=${k}" ${cur === k ? 'aria-current="page"' : ""}>${h(t)}</a>`).join("")}</nav>`;
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const piNote = (d) => (!d.piEnabled ? `<div class="notice warn">${ic("wallet")}<span>${h(d.piNotice || "مدفوعات Pi غير مفعّلة بعد — التبرّع وتحويل المبالغ متوقفان حتى تفعيلها.")}</span></div>` : "");
  const meter = (part, whole, label) => { const max = Math.max(Number(whole) || 0, 0.0001); return `<div class="gv-meter"><progress max="${max}" value="${Math.min(Number(part) || 0, max)}" aria-label="${h(label)}"></progress><small>${h(label)}</small></div>`; };
  const kpis = (rows) => `<div class="f-kpis">${rows.map(([v, t]) => `<div class="kpi-tile"><b>${v}</b><span>${h(t)}</span></div>`).join("")}</div>`;
  const dt = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : "");
  const isoOf = (v) => (v ? new Date(v).toISOString() : "");
  const vf = (o) => (o?.verified ? ` ${ic("verified", "xs")}` : "");
  const reportBox = (id, reasons) => `<details class="card u-mt12"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("flag")} إبلاغ فريق المنصة</summary><form class="f-form u-mt8" id="${id}"><label>السبب<select name="reason" required><option value="">اختر…</option>${Object.entries(reasons).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></label><label>تفاصيل (اختياري)<textarea name="note" maxlength="600" rows="2"></textarea></label><button class="btn outline" type="submit">إرسال البلاغ</button></form></details>`;
  const onReport = (fid, path) => $("#" + fid)?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", path, { reason: e.target.reason.value, note: e.target.note.value.trim() || undefined }); say("وصل بلاغك لفريق المنصة"); e.target.closest("details").open = false; }); });
  const campCard = (c) => `<li><a class="f-card gv-card" href="#/campaign/${enc(c.id)}"><span class="gv-cat">${h(c.category.label)}</span><b>${h(c.title)}</b><small>${h(c.org?.name || "")}${vf(c.org)}</small>${meter(c.raised, c.goal, `${num(c.raised, { maximumFractionDigits: 2 })} من ${num(c.goal)} Pi · ${num(c.percent)}٪`)}<span class="gv-ft"><span>${ic("users", "xs")} ${num(c.donors)} متبرّع</span><span>${c.status === "live" ? "حتى " + h(day(c.endsAt)) : h(c.statusLabel)}</span>${c.flagged ? badge("warn", "قيد المراجعة") : ""}</span></a></li>`;
  const oppRow = (o) => `<li><a class="li" href="#/opportunity/${enc(o.id)}">${ic(o.online ? "globe" : "mapPin")}<span class="t"><b>${h(o.title)}</b><small>${h(o.org?.name || "")} · ${h(when(o.startsAt))} · ${o.online ? "عن بُعد" : h(o.city)} · ${num(o.hours)} ساعة</small></span><span class="gv-amt">${o.left ? badge("ok", `${num(o.left)} مقعد`) : badge("", "مكتمل")}${o.minors ? badge("info", "مناسب لليافعين") : ""}</span></a></li>`;
  const orgRow = (o) => `<li><a class="li" href="#/organisation/${enc(o.id)}">${ic("building")}<span class="t"><b>${h(o.name)}${vf(o)}</b><small>${h(o.kind.label)}${o.city ? " · " + h(o.city) : ""}${o.campaigns !== undefined ? ` · ${num(o.campaigns)} حملة · ${num(o.opportunities)} فرصة` : ""}</small></span>${o.status !== "verified" || o.role ? badge(TONE[o.status], o.role ? (o.status === "verified" ? (o.role === "owner" ? "مالك" : "محرّر") : o.statusLabel) : o.statusLabel) : ""}</a></li>`;

  /* =================== #/giving =================== */
  async function hub() {
    const tab = qs().get("tab") || "campaigns";
    page({ title: "التطوّع والخير", icon: "heart", sub: "حملات خيرية بأرقام معلنة، وفرص تطوّع لدى جهات موثّقة.", actions: isAdmin() ? `<a class="btn ghost sm" href="#/admin/charity">${ic("shield")}الإدارة</a>` : "" },
      `${seg("#/giving", [["campaigns", "الحملات"], ["volunteer", "التطوّع"], ["orgs", "الجهات"], ["mine", "نشاطي"]], tab, "أقسام التطوّع والخير")}<div id="gv-b">${skel(4)}</div>`);
    const box = $("#gv-b");
    try { if (tab === "volunteer") await volTab(box); else if (tab === "orgs") await orgsTab(box); else if (tab === "mine") await mineTab(box); else await campTab(box); } catch (e) { if (box.isConnected) box.innerHTML = errBox(e); }
  }
  async function campTab(box) {
    const cat = qs().get("category") || "", text = qs().get("q") || "", ended = qs().get("status") === "ended";
    const d = await api("GET", `/api/charity/campaigns?category=${enc(cat)}&q=${enc(text)}${ended ? "&status=ended" : ""}`); if (!box.isConnected) return; const t = d.totals;
    const base = `#/giving?tab=campaigns${ended ? "&status=ended" : ""}`;
    box.innerHTML = `<section class="f-cover"><h3>${num(t.live)} حملة قائمة لدى ${num(t.orgs)} جهة موثّقة</h3><small>كل حملة تعرض ما جُمع وما حُوّل للجهة وما صُرف بإيصالاته.</small></section>
      ${kpis([[pi(t.raised), "جُمع عبر المنصة"], [num(t.orgs), "جهة موثّقة"], [num(t.opportunities), "فرصة تطوّع مفتوحة"], [num(t.hours, { maximumFractionDigits: 1 }), "ساعة تطوّع مؤكّدة"]])}${piNote(d)}
      <form class="fx-q u-mb12" id="gv-sf" role="search"><label><span class="vh">ابحث في الحملات</span><input type="search" name="q" value="${h(text)}" maxlength="60" placeholder="ابحث باسم الحملة أو الجهة"></label></form>
      <ul class="f-chips" aria-label="التصنيفات"><li><a class="chip f" href="${base}" ${!cat ? 'aria-current="true"' : ""}>الكل</a></li>${Object.entries(d.categories).filter(([k]) => d.counts[k]).map(([k, v]) => `<li><a class="chip f" href="${base}&category=${k}" ${cat === k ? 'aria-current="true"' : ""}>${h(v)} <span class="n">${num(d.counts[k])}</span></a></li>`).join("")}</ul>
      ${d.campaigns.length ? `<ul class="f-grid gv-grid">${d.campaigns.map(campCard).join("")}</ul>` : UI.empty({ title: cat || text ? "لا نتائج" : ended ? "لا حملات منتهية" : "لا حملات قائمة الآن", text: "تنشر الجهات الموثّقة حملاتها هنا بعد مراجعة فريق المنصة.", action: `<a class="btn" href="#/giving?tab=orgs">الجهات الموثّقة</a>` })}
      <p class="u-mt12"><a class="btn ghost sm" href="${ended ? "#/giving" : "#/giving?tab=campaigns&status=ended"}">${ended ? "الحملات القائمة" : "الحملات المنتهية وتقاريرها"}</a></p>`;
    $("#gv-sf").addEventListener("submit", (e) => { e.preventDefault(); location.hash = `${base}${cat ? "&category=" + enc(cat) : ""}&q=${enc(e.target.q.value.trim())}`; });
  }
  async function volTab(box) {
    const mode = qs().get("mode") || "", city = qs().get("city") || "", text = qs().get("q") || "";
    const d = await api("GET", `/api/charity/opportunities?mode=${enc(mode)}&city=${enc(city)}&q=${enc(text)}`); if (!box.isConnected) return;
    const base = "#/giving?tab=volunteer";
    box.innerHTML = `${d.minor ? `<div class="notice">${ic("shield")}<span>تظهر لك الفرص المناسبة لليافعين فقط، ويلزم ربط حسابك بوليّ أمر قبل التسجيل.</span></div>` : ""}
      <form class="fx-q u-mb12" id="gv-vf" role="search"><label><span class="vh">ابحث في فرص التطوّع</span><input type="search" name="q" value="${h(text)}" maxlength="60" placeholder="ابحث بمهارة أو مدينة أو جهة"></label></form>
      <ul class="f-chips" aria-label="نوع الفرصة">${[["", "الكل"], ["onsite", "حضوري"], ["online", "عن بُعد"]].map(([k, v]) => `<li><a class="chip f" href="${base}${k ? "&mode=" + k : ""}" ${mode === k ? 'aria-current="true"' : ""}>${h(v)}</a></li>`).join("")}</ul>
      ${d.opportunities.length ? `<ul class="list">${d.opportunities.map(oppRow).join("")}</ul>` : UI.empty({ title: "لا فرص مطابقة الآن", text: "تُعلن الجهات الموثّقة فرصها هنا؛ عُد قريباً." })}`;
    $("#gv-vf").addEventListener("submit", (e) => { e.preventDefault(); location.hash = `${base}${mode ? "&mode=" + mode : ""}&q=${enc(e.target.q.value.trim())}`; });
  }
  async function orgsTab(box) {
    const text = qs().get("q") || "";
    const d = await api("GET", `/api/charity/orgs?q=${enc(text)}`); if (!box.isConnected) return;
    box.innerHTML = `<form class="fx-q u-mb12" id="gv-of" role="search"><label><span class="vh">ابحث في الجهات</span><input type="search" name="q" value="${h(text)}" maxlength="60" placeholder="ابحث باسم الجهة أو المدينة"></label></form>
      ${d.mine.length ? `<div class="f-h">جهاتي</div><ul class="list">${d.mine.map(orgRow).join("")}</ul>` : ""}
      <div class="f-h">جهات موثّقة</div>${d.orgs.length ? `<ul class="list">${d.orgs.map(orgRow).join("")}</ul>` : UI.empty({ title: text ? "لا نتائج" : "لا جهات موثّقة بعد" })}
      ${signed() && !d.minor ? `<section class="card u-mt12"><div class="gv-row">${ic("building")}<span class="u-f1"><b>تدير جمعية أو مبادرة أو فريقاً تطوعياً؟</b><small>سجّلها برقم الترخيص؛ يتحقق منها فريق المنصة قبل أن تنشر حملات أو فرصاً.</small></span></div><a class="btn u-mt8" href="#/organisation/new">${ic("plus")}تسجيل جهة</a></section>` : ""}`;
    $("#gv-of").addEventListener("submit", (e) => { e.preventDefault(); location.hash = `#/giving?tab=orgs&q=${enc(e.target.q.value.trim())}`; });
  }
  async function mineTab(box) {
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول", text: "لترى ساعات تطوّعك وتبرّعاتك وشهاداتك.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    const d = await api("GET", "/api/charity/me"); if (!box.isConnected) return;
    const total = d.donations.reduce((a, x) => a + x.amount, 0);
    box.innerHTML = kpis([[num(d.hours, { maximumFractionDigits: 1 }), "ساعة تطوّع مؤكّدة"], [num(d.signups.filter((s) => s.status === "attended").length), "مشاركة مكتملة"], [pi(total), "تبرّعاتي"], [num(d.donations.length), "حملة دعمتها"]]) +
      `<div class="f-h">تطوّعي</div>${d.signups.length ? `<ul class="list">${d.signups.map((s) => `<li><div class="li">${ic(s.status === "attended" ? "award" : "cal")}<a class="t u-tdn" href="#/opportunity/${enc(s.opportunity.id)}"><b>${h(s.opportunity.title)}</b><small>${h(s.org.name)} · ${h(day(s.opportunity.startsAt))}${s.hours ? ` · ${num(s.hours)} ساعة` : ""}</small></a>${s.certCode ? `<a class="btn ghost sm" href="#/cert/${enc(s.certCode)}">${ic("award")}الشهادة</a>` : badge(TONE[s.status], s.statusLabel)}</div></li>`).join("")}</ul>` : UI.empty({ title: "لم تسجّل في فرص بعد", action: `<a class="btn" href="#/giving?tab=volunteer">تصفّح الفرص</a>` })}
      <div class="f-h">تبرّعاتي</div>${d.donations.length ? `<ul class="list">${d.donations.map((x) => `<li><a class="li" href="#/campaign/${enc(x.campaign.id)}">${ic("heart")}<span class="t"><b>${h(x.campaign.title)}</b><small>${h(day(x.at))}${x.anonymous ? " · دون إظهار الاسم" : ""}</small></span><b class="gv-amt">${pi(x.amount)}</b></a></li>`).join("")}</ul>` : UI.empty({ title: d.minor ? "التبرّع لمن هم ١٨ سنة فأكثر" : "لا تبرّعات بعد" })}
      ${d.mine.length ? `<div class="f-h">جهاتي</div><ul class="list">${d.mine.map(orgRow).join("")}</ul>` : ""}`;
  }

  /* =================== #/campaign/:id =================== */
  function campForm(c, cats) {
    return `<form class="card f-form" id="gv-cf"><label>عنوان الحملة<input name="title" required minlength="8" maxlength="140" value="${h(c?.title || "")}"></label>
      <label>التصنيف<select name="category" required><option value="">اختر…</option>${Object.entries(cats).map(([k, v]) => `<option value="${k}" ${c?.category?.key === k ? "selected" : ""}>${h(v)}</option>`).join("")}</select></label>
      <label>القصة: من المستفيد، وما الحاجة، وكيف ستُصرف الأموال؟<textarea name="story" required minlength="80" maxlength="5000" rows="6">${h(c?.story || "")}</textarea></label>
      <label>المستفيدون (اختياري)<input name="beneficiaries" maxlength="600" value="${h(c?.beneficiaries || "")}" placeholder="مثال: ٢٠٠ أسرة في حي…"></label>
      <label>الهدف بـ Pi<input name="goal" type="number" min="0.01" max="1000000" step="0.01" required inputmode="decimal" value="${c ? c.goal : ""}"></label>
      <div class="gv-two"><label>تبدأ<input name="startsAt" type="datetime-local" required value="${dt(c?.startsAt)}"></label><label>تنتهي (حتى ١٨٠ يوماً)<input name="endsAt" type="datetime-local" required value="${dt(c?.endsAt)}"></label></div>
      <button class="btn" type="submit">${c ? "حفظ المسودة" : "حفظ كمسودة"}</button></form>`;
  }
  const campBody = (f) => ({ title: f.title.value.trim(), category: f.category.value, story: f.story.value.trim(), beneficiaries: f.beneficiaries.value.trim() || undefined, goal: Number(f.goal.value), startsAt: isoOf(f.startsAt.value), endsAt: isoOf(f.endsAt.value) });
  async function campaignView(cid) {
    page({ title: "حملة خيرية", icon: "heart", back: ["#/giving", "التطوّع والخير"] }, `<div id="gv-c">${skel(4)}</div>`);
    const box = $("#gv-c");
    let d; try { d = await api("GET", "/api/charity/campaigns/" + enc(cid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const c = d.campaign, o = d.org, me = d.me, draft = ["draft", "rejected"].includes(c.status);
    const spending = d.updates.filter((u) => u.kind === "spending"), news = d.updates.filter((u) => u.kind !== "spending");
    box.innerHTML = `<section class="f-cover gv-cover"><span class="gv-cat">${h(c.category.label)}</span><h3>${h(c.title)}</h3><small><a href="#/organisation/${enc(o.id)}">${h(o.name)}</a>${vf(o)} · ${c.status === "live" ? (c.phase === "soon" ? "تبدأ " + h(day(c.startsAt)) : "حتى " + h(day(c.endsAt))) : h(c.statusLabel)}</small></section>
      ${c.flagged ? `<div class="notice warn">${ic("alert")}<span>هذه الحملة قيد مراجعة فريق المنصة بعد بلاغات من الأعضاء؛ التبرّعات متوقفة مؤقتاً.</span></div>` : ""}
      ${me.canManage && c.reviewReason ? `<div class="notice warn">${ic("alert")}<span>ملاحظة فريق المنصة: ${h(c.reviewReason)}</span></div>` : ""}
      ${meter(c.raised, c.goal, `جُمع ${num(c.raised, { maximumFractionDigits: 2 })} من ${num(c.goal)} Pi (${num(c.percent)}٪)`)}
      ${kpis([[pi(c.raised), `من ${num(c.donors)} متبرّع`], [pi(c.disbursed), "حُوّل للجهة"], [pi(c.spent), "صرف موثّق بإيصال"], [pi(c.unreported), "حُوّل ولم يُوثَّق صرفه"]])}
      ${piNote(d)}
      <div class="f-h">عن الحملة</div><div class="card"><p class="gv-pre">${h(c.story)}</p>${c.beneficiaries ? `<p class="gv-row u-mt8">${ic("users")}<span><b>المستفيدون:</b> ${h(c.beneficiaries)}</span></p>` : ""}</div>
      ${c.status === "live" || c.status === "paused" ? `<div class="f-h">تبرّع</div><form class="card f-form" id="gv-dn"><label>المبلغ بـ Pi<input name="amount" type="number" min="0.01" max="10000" step="0.01" required inputmode="decimal" ${me.canDonate ? "" : "disabled"}></label>
        <label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="anonymous" ${me.canDonate ? "" : "disabled"}> تبرّع دون إظهار اسمي</label>
        <button class="btn" type="submit" ${me.canDonate ? "" : "disabled"}>${ic("heart")}تبرّع للحملة</button>${me.why ? `<p class="f-hint">${h(me.why)}</p>` : ""}</form>` : ""}
      <div class="f-h">الشفافية: التحويلات للجهة</div>${d.disbursements.length ? `<ul class="list">${d.disbursements.map((x) => `<li><div class="li">${ic("swap")}<span class="t"><b>${pi(x.amount)}</b><small>${h(day(x.at))}${x.memo ? " · " + h(x.memo) : ""} · <bdi class="gv-tx">${h(x.txid)}</bdi></small></span></div></li>`).join("")}</ul>` : `<p class="f-hint">لم يُحوَّل شيء للجهة بعد. يحوّل فريق المنصة المبالغ إلى محفظة الجهة ويُسجَّل هنا رقم كل معاملة Pi.</p>`}
      <div class="f-h">الشفافية: تقارير الصرف</div>${spending.length ? `<ul class="list">${spending.map((u) => `<li><div class="li">${ic("doc")}<span class="t"><b>${pi(u.amount)} · ${h(u.body)}</b><small>${h(day(u.at))}</small></span>${u.receipt ? `<a class="btn ghost sm" href="${h(u.receipt)}" target="_blank" rel="noopener noreferrer nofollow">الإيصال</a>` : ""}</div></li>`).join("")}</ul>` : `<p class="f-hint">لم تنشر الجهة تقارير صرف بعد.</p>`}
      <div class="f-h">آخر الأخبار</div>${news.length ? `<ul class="gv-updates">${news.map((u) => `<li class="card"><small class="u-c-mu">${h(day(u.at))}</small><p class="gv-pre">${h(u.body)}</p></li>`).join("")}</ul>` : `<p class="f-hint">لا أخبار بعد.</p>`}
      ${d.donations.length ? `<div class="f-h">آخر التبرّعات</div><ul class="list">${d.donations.map((x) => `<li><div class="li">${ic("heart")}<span class="t"><b>${pi(x.amount)}</b><small>${x.by ? h(x.by.name) : "متبرّع"} · ${h(day(x.at))}</small></span></div></li>`).join("")}</ul>` : ""}
      <div class="f-h">عن الجهة</div><a class="card gv-org" href="#/organisation/${enc(o.id)}"><span class="gv-row">${ic("building")}<span class="u-f1"><b>${h(o.name)}${vf(o)}</b><small>${h(o.kind.label)} · ${h(o.registry)} · ترخيص <bdi>${h(o.licenseNo)}</bdi></small></span><span class="chev" aria-hidden="true">←</span></span></a>
      ${me.canManage ? `<div class="f-h">إدارة الحملة</div>${draft ? `${campForm(c, d.categories)}<button class="btn outline u-mt8" type="button" id="gv-sub">${ic("send")}إرسال للمراجعة</button>` : c.status === "review" ? `<p class="f-hint">الحملة لدى فريق المنصة للمراجعة.</p>` : `<form class="card f-form" id="gv-up"><label>النوع<select name="kind"><option value="update">خبر عن الحملة</option><option value="spending">تقرير صرف (مبلغ + إيصال)</option></select></label><label>النص<textarea name="body" required minlength="10" maxlength="2000" rows="3"></textarea></label><div class="gv-two"><label>المبلغ المصروف (Pi)<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal"></label><label>رابط الإيصال<input name="receipt" type="url" maxlength="300" placeholder="https://"></label></div><button class="btn" type="submit">نشر</button></form>`}` : ""}
      ${me.canReport ? reportBox("gv-rp", d.reasons) : ""}`;
    $("#gv-dn")?.addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; busy(e.submitter, async () => {
      const r = await api("POST", `/api/charity/campaigns/${enc(cid)}/donate`, { amount: Number(f.amount.value), anonymous: f.anonymous.checked });
      try { if (window.MPChunks) await MPChunks.load("pi"); } catch { /* offline */ }
      if (!window.MPPi?.pay) { say("افتح التطبيق داخل متصفح Pi لإتمام الدفع"); return; }
      await MPPi.pay({ amount: r.intent.amount, memo: r.intent.memo, purpose: "charity", refId: r.donation.id, intent: async () => r.intent }); say("شكراً لتبرّعك"); campaignView(cid); }); });
    $("#gv-cf")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", "/api/charity/campaigns/" + enc(cid), campBody(e.target)); say("حُفظت المسودة"); campaignView(cid); }); });
    $("#gv-sub")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("PUT", "/api/charity/campaigns/" + enc(cid), { submit: true }); say("أُرسلت الحملة للمراجعة"); campaignView(cid); }));
    $("#gv-up")?.addEventListener("submit", (e) => { e.preventDefault(); const f = e.target, sp = f.kind.value === "spending"; busy(e.submitter, async () => { await api("POST", `/api/charity/campaigns/${enc(cid)}/updates`, { kind: f.kind.value, body: f.body.value.trim(), amount: sp ? Number(f.amount.value) : undefined, receipt: sp ? f.receipt.value.trim() : undefined }); say("نُشر"); campaignView(cid); }); });
    onReport("gv-rp", `/api/charity/campaigns/${enc(cid)}/report`);
  }

  /* =================== #/organisation/:id =================== */
  function orgForm(o, kinds) {
    return `<form class="card f-form" id="gv-gf"><label>اسم الجهة<input name="name" required minlength="3" maxlength="120" value="${h(o?.name || "")}"></label>
      <label>النوع<select name="kind" required><option value="">اختر…</option>${Object.entries(kinds).map(([k, v]) => `<option value="${k}" ${o?.kind?.key === k ? "selected" : ""}>${h(v)}</option>`).join("")}</select></label>
      <label>جهة التسجيل أو الترخيص<input name="registry" required minlength="3" maxlength="160" value="${h(o?.registry || "")}" placeholder="مثال: المركز الوطني لتنمية القطاع غير الربحي"></label>
      <label>رقم الترخيص أو السجل<input name="licenseNo" required minlength="2" maxlength="60" value="${h(o?.licenseNo || "")}" dir="ltr"></label>
      <div class="gv-two"><label>الدولة<input name="country" maxlength="60" value="${h(o?.country || "")}"></label><label>المدينة<input name="city" maxlength="60" value="${h(o?.city || "")}"></label></div>
      <div class="gv-two"><label>الموقع (اختياري)<input name="website" type="url" maxlength="300" value="${h(o?.website || "")}" placeholder="https://" dir="ltr"></label><label>البريد (اختياري)<input name="email" type="email" maxlength="120" value="${h(o?.email || "")}" dir="ltr"></label></div>
      <label>نبذة: ماذا تعمل الجهة، وأين، ومنذ متى؟<textarea name="descr" required minlength="30" maxlength="3000" rows="4">${h(o?.descr || "")}</textarea></label>
      ${o?.verified ? `<p class="f-hint">تغيير جهة الترخيص أو رقمه يعيد الجهة للتحقق.</p>` : ""}<button class="btn" type="submit">${o ? "حفظ" : `${ic("send")}إرسال للتحقق`}</button></form>`;
  }
  const orgBody = (f) => ({ name: f.name.value.trim(), kind: f.kind.value, registry: f.registry.value.trim(), licenseNo: f.licenseNo.value.trim(), country: f.country.value.trim() || undefined, city: f.city.value.trim() || undefined, website: f.website.value.trim(), email: f.email.value.trim() || undefined, descr: f.descr.value.trim() });
  function oppForm(p) {
    return `<form class="card f-form" id="gv-pf"><label>عنوان الفرصة<input name="title" required minlength="6" maxlength="140" value="${h(p?.title || "")}"></label><label>الوصف والمهام<textarea name="descr" required minlength="30" maxlength="3000" rows="4">${h(p?.descr || "")}</textarea></label>
      <label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="online" ${p?.online ? "checked" : ""}> عن بُعد</label><label>المدينة<input name="city" maxlength="60" value="${h(p?.city || "")}"></label>
      <div class="gv-two"><label>البداية<input name="startsAt" type="datetime-local" required value="${dt(p?.startsAt)}"></label><label>النهاية<input name="endsAt" type="datetime-local" required value="${dt(p?.endsAt)}"></label></div>
      <div class="gv-two"><label>المقاعد<input name="slots" type="number" min="1" max="1000" required value="${p ? p.slots : 10}"></label><label>الساعات المتوقعة<input name="hours" type="number" min="0.5" max="200" step="0.5" required value="${p ? p.hours : 2}"></label></div>
      <label>المهارات (اختياري)<input name="skills" maxlength="200" value="${h(p?.skills || "")}"></label>
      <label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="minors" ${p?.minors ? "checked" : ""}> مناسبة لليافعين (بإذن وليّ الأمر)</label><button class="btn" type="submit">${p ? "حفظ" : "نشر الفرصة"}</button></form>`;
  }
  const oppBody = (f) => ({ title: f.title.value.trim(), descr: f.descr.value.trim(), online: f.online.checked, city: f.city.value.trim() || undefined, startsAt: isoOf(f.startsAt.value), endsAt: isoOf(f.endsAt.value), slots: Number(f.slots.value), hours: Number(f.hours.value), skills: f.skills.value.trim() || undefined, minors: f.minors.checked });
  async function orgView(oid) {
    if (oid === "new") {
      page({ title: "تسجيل جهة", icon: "building", sub: "جمعية أو مبادرة أو فريق تطوعي برقم ترخيص يتحقق منه فريق المنصة.", back: ["#/giving?tab=orgs", "الجهات"] }, `<div id="gv-o"></div>`);
      if (!signed()) { $("#gv-o").innerHTML = UI.empty({ title: "سجّل الدخول أولاً", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
      const kinds = { charity: "جمعية خيرية", association: "جمعية أهلية", initiative: "مبادرة مجتمعية", team: "فريق تطوعي" };
      $("#gv-o").innerHTML = `<div class="notice">${ic("shield")}<span>لا تُنشر الجهة ولا حملاتها قبل التحقق من ترخيصها. التسجيل لمن هم ١٨ سنة فأكثر.</span></div>${orgForm(null, kinds)}`;
      $("#gv-gf").addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { const r = await api("POST", "/api/charity/orgs", orgBody(e.target)); say("أُرسلت الجهة للتحقق"); location.hash = "#/organisation/" + enc(r.org.id); }); });
      return;
    }
    page({ title: "جهة", icon: "building", back: ["#/giving?tab=orgs", "الجهات"] }, `<div id="gv-o">${skel(4)}</div>`);
    const box = $("#gv-o");
    let d; try { d = await api("GET", "/api/charity/orgs/" + enc(oid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const o = d.org, me = d.me, owner = me.role === "owner" || (me.canManage && !me.role);
    box.innerHTML = `<section class="f-cover"><h3>${h(o.name)}${vf(o)}</h3><small>${h(o.kind.label)}${o.city ? " · " + h(o.city) : ""}${o.country ? "، " + h(o.country) : ""}</small></section>
      ${o.status !== "verified" ? `<div class="notice warn">${ic("alert")}<span>${h(o.statusLabel)}${o.reason ? ": " + h(o.reason) : ""}</span></div>` : ""}
      <div class="card"><p class="gv-pre">${h(o.descr)}</p><ul class="gv-facts"><li>${ic("shield")}<span>${h(o.registry)} · ترخيص <bdi>${h(o.licenseNo)}</bdi></span></li>${o.verifiedAt ? `<li>${ic("verified")}<span>تحقّق منها فريق المنصة في ${h(day(o.verifiedAt))}</span></li>` : ""}${o.website ? `<li>${ic("link")}<a href="${h(o.website)}" target="_blank" rel="noopener noreferrer nofollow"><bdi>${h(o.website)}</bdi></a></li>` : ""}${o.email ? `<li>${ic("mail")}<bdi>${h(o.email)}</bdi></li>` : ""}</ul></div>
      <div class="f-h">الحملات</div>${d.campaigns.length ? `<ul class="f-grid gv-grid">${d.campaigns.map((c) => campCard(c).replace("</small>", `</small>${me.canManage ? badge(TONE[c.status], c.statusLabel) : ""}`)).join("")}</ul>` : `<p class="f-hint">لا حملات بعد.</p>`}
      <div class="f-h">فرص التطوّع</div>${d.opportunities.length ? `<ul class="list">${d.opportunities.map(oppRow).join("")}</ul>` : `<p class="f-hint">لا فرص مفتوحة.</p>`}
      ${me.canManage ? `<div class="f-h">إدارة الجهة</div>
        ${o.verified ? `<details class="card"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("heart")} حملة جديدة</summary><div class="u-mt8" id="gv-nc">${campForm(null, d.categories)}</div></details>
        <details class="card u-mt8"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("users")} فرصة تطوّع جديدة</summary><div class="u-mt8">${oppForm(null)}</div></details>` : `<p class="f-hint">تنشر الجهة حملاتها وفرصها بعد توثيقها.</p>`}
        <details class="card u-mt8"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("pen")} بيانات الجهة</summary><div class="u-mt8">${orgForm(o, d.kinds)}</div></details>
        ${d.members ? `<details class="card u-mt8"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("users")} فريق الإدارة (${num(d.members.length)})</summary><ul class="list u-mt8">${d.members.map((m) => `<li><div class="li">${ic("user")}<span class="t"><b>${h(m.user?.name)}</b><small>@${h(m.user?.handle)} · ${m.role === "owner" ? "المالك" : "محرّر"}</small></span>${owner && m.role !== "owner" ? `<button class="btn ghost sm" type="button" data-rm="${h(m.user?.handle)}">إزالة</button>` : ""}</div></li>`).join("")}</ul>${owner ? `<form class="f-form u-mt8" id="gv-mf"><label>إضافة محرّر بالمعرّف<input name="handle" required maxlength="40" placeholder="@handle" dir="ltr"></label><button class="btn outline" type="submit">إضافة</button></form>` : ""}</details>` : ""}` : ""}
      ${me.canReport ? reportBox("gv-orp", d.reasons) : ""}`;
    $("#gv-nc form")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { const r = await api("POST", `/api/charity/orgs/${enc(oid)}/campaigns`, campBody(e.target)); say("حُفظت الحملة كمسودة"); location.hash = "#/campaign/" + enc(r.campaign.id); }); });
    $("#gv-pf")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { const r = await api("POST", `/api/charity/orgs/${enc(oid)}/opportunities`, oppBody(e.target)); say("نُشرت الفرصة"); location.hash = "#/opportunity/" + enc(r.opportunity.id); }); });
    $("#gv-gf")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", "/api/charity/orgs/" + enc(oid), orgBody(e.target)); say("حُفظت بيانات الجهة"); orgView(oid); }); });
    $("#gv-mf")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/charity/orgs/${enc(oid)}/members`, { handle: e.target.handle.value.trim() }); say("أُضيف المحرّر"); orgView(oid); }); });
    box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", `/api/charity/orgs/${enc(oid)}/members`, { handle: b.dataset.rm, remove: true }); orgView(oid); })));
    onReport("gv-orp", `/api/charity/orgs/${enc(oid)}/report`);
  }

  /* =================== #/opportunity/:id =================== */
  async function oppView(pid) {
    page({ title: "فرصة تطوّع", icon: "users", back: ["#/giving?tab=volunteer", "التطوّع"] }, `<div id="gv-p">${skel(4)}</div>`);
    const box = $("#gv-p");
    let d; try { d = await api("GET", "/api/charity/opportunities/" + enc(pid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const p = d.opportunity, o = d.org, me = d.me, s = me.signup;
    const act = (x) => x.status === "applied" ? `<button class="btn sm" type="button" data-sa="accept" data-id="${h(x.id)}">قبول</button><button class="btn ghost sm" type="button" data-sa="decline" data-id="${h(x.id)}">اعتذار</button>`
      : x.status === "accepted" ? (Date.parse(p.startsAt) <= Date.now() ? `<button class="btn sm" type="button" data-sa="attended" data-id="${h(x.id)}">حضر</button><button class="btn ghost sm" type="button" data-sa="no_show" data-id="${h(x.id)}">لم يحضر</button>` : `<button class="btn ghost sm" type="button" data-sa="decline" data-id="${h(x.id)}">إلغاء القبول</button>`) : badge(TONE[x.status], x.statusLabel + (x.hours ? ` · ${num(x.hours)} س` : ""));
    box.innerHTML = `<section class="f-cover"><h3>${h(p.title)}</h3><small><a href="#/organisation/${enc(o.id)}">${h(o.name)}</a>${vf(o)}</small></section>
      ${kpis([[h(sday(p.startsAt)), "الموعد"], [num(p.hours), "ساعات متوقعة"], [`${num(p.left)} / ${num(p.slots)}`, "مقاعد متاحة"]])}
      <div class="card"><p class="gv-pre">${h(p.descr)}</p><ul class="gv-facts"><li>${ic(p.online ? "globe" : "mapPin")}<span>${p.online ? "عن بُعد" : h(p.city)}</span></li><li>${ic("clock")}<span>${h(when(p.startsAt))} — ${h(when(p.endsAt))}</span></li>${p.skills ? `<li>${ic("star")}<span>${h(p.skills)}</span></li>` : ""}${p.minors ? `<li>${ic("shield")}<span>مناسبة لليافعين بإذن وليّ الأمر</span></li>` : ""}</ul></div>
      ${!me.canManage ? (!signed() ? `<p class="f-hint u-mt12"><a class="u-fw7" href="#/settings">سجّل الدخول</a> للتسجيل في الفرصة.</p>`
        : s && s.status !== "withdrawn" ? `<section class="card u-mt12"><div class="gv-row">${ic(s.status === "attended" ? "award" : "check")}<span class="u-f1"><b>مشاركتك</b><small>${s.hours ? `${num(s.hours)} ساعة مؤكّدة` : s.status === "accepted" ? "قبلتك الجهة؛ نراك في الموعد" : "سجّلت في هذه الفرصة"}</small></span>${badge(TONE[s.status], s.statusLabel)}</div>${s.certCode ? `<a class="btn outline sm u-mt8" href="#/cert/${enc(s.certCode)}">${ic("award")}شهادة التطوّع</a>` : ""}${["applied", "accepted"].includes(s.status) ? `<button class="btn ghost sm u-mt8" type="button" id="gv-wd">الانسحاب</button>` : ""}</section>`
        : me.canSignUp ? `<div class="f-h">سجّل للتطوّع</div><form class="card f-form" id="gv-su"><label>نبذة قصيرة عنك (اختياري)<textarea name="note" maxlength="500" rows="2" placeholder="خبرتك أو سبب اهتمامك"></textarea></label><button class="btn" type="submit">${ic("hand")}سجّلني</button></form>`
        : `<p class="f-hint u-mt12">${h(me.why || "")}</p>`) : ""}
      ${d.signups ? `<div class="f-h">المسجّلون (${num(d.signups.length)})</div>${d.signups.length ? `<ul class="list">${d.signups.map((x) => `<li><div class="li gv-su">${ic("user")}<span class="t"><b>${h(x.user?.name)}${x.minor ? " " + badge("info", "يافع") : ""}</b><small>@${h(x.user?.handle)}${x.note ? " · " + h(x.note) : ""}</small></span><span class="gv-acts">${act(x)}</span></div></li>`).join("")}</ul>` : `<p class="f-hint">لا مسجّلين بعد.</p>`}
        <details class="card u-mt12"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("pen")} تعديل الفرصة</summary><div class="u-mt8">${oppForm(p)}</div><div class="gv-acts u-mt8">${p.status === "open" ? `<button class="btn ghost sm" type="button" data-st="closed">إغلاق التسجيل</button>` : p.status === "closed" ? `<button class="btn ghost sm" type="button" data-st="open">إعادة فتح التسجيل</button>` : ""}${p.status !== "cancelled" ? `<button class="btn ghost sm" type="button" data-st="cancelled">إلغاء الفرصة</button>` : ""}</div></details>` : ""}`;
    $("#gv-su")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/charity/opportunities/${enc(pid)}/signup`, { note: e.target.note.value.trim() || undefined }); say("وصل تسجيلك للجهة"); oppView(pid); }); });
    $("#gv-wd")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("POST", `/api/charity/opportunities/${enc(pid)}/signup`, { withdraw: true }); say("انسحبت من الفرصة"); oppView(pid); }));
    $("#gv-pf")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", "/api/charity/opportunities/" + enc(pid), oppBody(e.target)); say("حُفظت الفرصة"); oppView(pid); }); });
    box.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.st === "cancelled" && !confirm("إلغاء الفرصة؟ يُبلَّغ المسجّلون.")) return; busy(b, async () => { await api("PUT", "/api/charity/opportunities/" + enc(pid), { status: b.dataset.st }); oppView(pid); }); }));
    box.querySelectorAll("[data-sa]").forEach((b) => b.addEventListener("click", () => {
      let hours; if (b.dataset.sa === "attended") { const v = prompt("عدد الساعات المؤكّدة", String(p.hours)); if (v === null) return; hours = Number(v); }
      busy(b, async () => { await api("POST", "/api/charity/signups/" + enc(b.dataset.id), { action: b.dataset.sa, hours }); say(b.dataset.sa === "attended" ? "أُكّدت الساعات وصدرت الشهادة" : "حُفظ"); oppView(pid); });
    }));
  }

  /* =================== #/admin/charity =================== */
  async function adminView() {
    if (!isAdmin()) { page({ title: "التطوّع والخير — الإدارة", back: ["#/giving", "التطوّع والخير"] }, UI.empty({ title: "للإدارة فقط" })); return; }
    const tab = qs().get("tab") || "orgs";
    page({ title: "التطوّع والخير — الإدارة", icon: "shield", back: ["#/admin", "الإدارة"] }, `${seg("#/admin/charity", [["orgs", "الجهات"], ["campaigns", "الحملات"], ["reports", "البلاغات"]], tab, "أقسام الإدارة")}<div id="gv-a">${skel(3)}</div>`);
    const box = $("#gv-a");
    try {
      const d = await api("GET", "/api/admin/charity"); if (!box.isConnected) return; const t = d.totals;
      const top = kpis([[num(t.pendingOrgs), "جهة بانتظار التحقق"], [num(t.review), "حملة للمراجعة"], [num(t.flagged), "حملة مُبلَّغ عنها"], [num(t.reports), "بلاغ مفتوح"]]);
      const campRow = (c, acts) => `<li class="card"><div class="gv-row">${ic("heart")}<a class="u-f1 u-tdn" href="#/campaign/${enc(c.id)}"><b>${h(c.title)}</b><small>${h(c.org?.name || "")} · الهدف ${pi(c.goal)} · جُمع ${pi(c.raised)} · الرصيد ${pi(c.balance)}</small></a>${badge(TONE[c.status], c.statusLabel)}${c.flagged ? badge("warn", "مُبلَّغ عنها") : ""}</div><div class="gv-acts u-mt8">${acts.map(([a, l, g]) => `<button class="btn ${g ? "ghost" : ""} sm" type="button" data-ca="${a}" data-id="${h(c.id)}">${h(l)}</button>`).join("")}</div></li>`;
      if (tab === "campaigns") box.innerHTML = top + piNote(d) + `<div class="f-h">للمراجعة</div>${d.review.length ? `<ul class="u-lsn u-p0 u-m0">${d.review.map((c) => campRow(c, c.status === "review" ? [["approve", "اعتماد ونشر"], ["reject", "رفض", 1]] : [["unflag", "رفع الإشارة"], ["pause", "إيقاف مؤقت", 1]])).join("")}</ul>` : UI.empty({ title: "لا حملات للمراجعة" })}
        <div class="f-h">قائمة ومتوقفة</div>${d.live.length ? `<ul class="u-lsn u-p0 u-m0">${d.live.map((c) => campRow(c, [...(c.status === "live" ? [["pause", "إيقاف مؤقت", 1]] : [["resume", "استئناف"]]), ["end", "إنهاء", 1], ...(d.piEnabled ? [["disburse", "تحويل للجهة"]] : [])])).join("")}</ul>` : UI.empty({ title: "لا حملات قائمة" })}`;
      else if (tab === "reports") box.innerHTML = top + (d.reports.length ? `<ul class="list">${d.reports.map((r) => `<li><div class="li">${ic("flag")}<a class="t u-tdn" href="#/${r.type === "org" ? "organisation" : "campaign"}/${enc(r.targetId)}"><b>${h(r.reason)}</b><small>${r.type === "org" ? "جهة" : "حملة"} · ${h(r.note || "")} · ${h(r.by?.name || "")}</small></a><button class="btn ghost sm" type="button" data-rp="${h(r.id)}" data-act="dismiss">رفض</button><button class="btn sm" type="button" data-rp="${h(r.id)}" data-act="action">تم التعامل</button></div></li>`).join("")}</ul>` : UI.empty({ title: "لا بلاغات مفتوحة" }));
      else box.innerHTML = top + (d.orgs.length ? `<ul class="u-lsn u-p0 u-m0">${d.orgs.map((o) => `<li class="card"><div class="gv-row">${ic("building")}<a class="u-f1 u-tdn" href="#/organisation/${enc(o.id)}"><b>${h(o.name)}</b><small>${h(o.kind.label)} · ${h(o.registry)} · ترخيص <bdi>${h(o.licenseNo)}</bdi> · @${h(o.owner?.handle || "")}</small></a>${badge(TONE[o.status], o.statusLabel)}</div>${o.reason ? `<p class="f-hint">${h(o.reason)}</p>` : ""}<div class="gv-acts u-mt8">${o.status !== "verified" ? `<button class="btn sm" type="button" data-os="verified" data-id="${h(o.id)}">توثيق</button>` : ""}${o.status === "pending" ? `<button class="btn ghost sm" type="button" data-os="rejected" data-id="${h(o.id)}">رفض</button>` : ""}${o.status === "verified" ? `<button class="btn ghost sm" type="button" data-os="suspended" data-id="${h(o.id)}">إيقاف</button>` : ""}</div></li>`).join("")}</ul>` : UI.empty({ title: "لا جهات مسجّلة بعد" }));
      box.querySelectorAll("[data-os]").forEach((b) => b.addEventListener("click", () => { let reason; if (b.dataset.os !== "verified") { reason = prompt("السبب (يصل للجهة)"); if (!reason || reason.trim().length < 3) return; } busy(b, async () => { await api("POST", "/api/admin/charity/orgs/" + enc(b.dataset.id), { status: b.dataset.os, reason }); say("حُفظ القرار"); adminView(); }); }));
      box.querySelectorAll("[data-ca]").forEach((b) => b.addEventListener("click", () => {
        const a = b.dataset.ca, id = enc(b.dataset.id);
        if (a === "disburse") { const amount = Number(prompt("المبلغ المحوَّل للجهة (Pi)") || 0); if (!amount) return; const txid = prompt("رقم معاملة Pi للتحويل"); if (!txid || txid.trim().length < 8) return; busy(b, async () => { await api("POST", `/api/admin/charity/campaigns/${id}/disburse`, { amount, txid: txid.trim() }); say("سُجّل التحويل"); adminView(); }); return; }
        let reason; if (a === "reject" || a === "pause") { reason = prompt("السبب (يصل للجهة)"); if (!reason || reason.trim().length < 3) return; }
        busy(b, async () => { await api("POST", "/api/admin/charity/campaigns/" + id, { action: a, reason }); say("حُفظ"); adminView(); });
      }));
      box.querySelectorAll("[data-rp]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", "/api/admin/charity/reports/" + enc(b.dataset.rp), { action: b.dataset.act }); adminView(); })));
    } catch (e) { if (box.isConnected) box.innerHTML = errBox(e); }
  }

  MPRoutes.extend((a, b, base) => {
    return { giving: () => hub(),
      campaign: () => (a ? campaignView(a) : hub()),
      organisation: () => (a ? orgView(a) : (location.hash = "#/giving?tab=orgs")),
      opportunity: () => (a ? oppView(a) : (location.hash = "#/giving?tab=volunteer")) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "charity" ? adminView() : next()));
  window.MPCharity = { hub, campaignView, orgView, oppView, adminView, version: "__APP_VERSION__" };
  if (/^#\/(giving|campaign|organisation|opportunity|admin\/charity)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
