/* =====================================================================
 * مجتمع بلس — Phase 65 UI: verified creators program + creator support fund (lazy "vcreators" chunk + vcreators.css; 0 bytes in core).
 *   #/creator-program[?tab=program|directory]   benefits, transparent eligibility checklist, application + code of conduct,
 *                                                membership / renewal; directory of verified creators
 *   #/fund                                       transparency: pool, received, awarded, paid; rounds; grants; donations (Pi)
 *   #/fund/r/:id                                 one round: criteria, window, budget, apply / edit / withdraw, awards
 *   #/fund/g/:id                                 one grant: plan, milestones, award + payout state, progress updates, report
 *   #/admin/creator-program[?tab=apps|members|rounds|money&round=id]  staff review, revoke, rounds, decisions, payouts
 * Money (donations, pool funding, payouts) needs Pi payments; while they are off the server answers 501 and every screen says so.
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function VCreatorsUI() {
  if (window.MPVCreators) return;
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
  const errBox = (e) => UI.empty({ title: "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم" });
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const badge = (tone, t) => `<span class="sbadge ${tone || ""}">${h(t)}</span>`;
  const PAYS = { none: "معتمد", awaiting_pi: "بانتظار Pi", reserved: "محجوز", paid: "صُرف" };
  const TONE = { pending: "warn", approved: "ok", rejected: "bad", withdrawn: "", verified: "ok", revoked: "bad", lapsed: "warn", draft: "", open: "ok", review: "info", closed: "", submitted: "info", shortlisted: "warn", none: "", awaiting_pi: "warn", reserved: "info", paid: "ok" };
  const av = (u) => { const src = u && typeof avSrc === "function" ? avSrc(u, "") : null; return `<span class="vc-av" aria-hidden="true">${src ? `<img src="${h(src)}" alt="" loading="lazy" decoding="async">` : h(String(u?.name || "؟").trim()[0] || "؟")}</span>`; };
  const pi = (x) => `<bdi>${num(x, { maximumFractionDigits: 2 })} Pi</bdi>`;
  const page = (head, body) => { view.innerHTML = `<div class="wrap vc-page">${UI.pageHead({ ...head, id: "vc-h" })}${body}</div>`; $("#vc-h")?.focus({ preventScroll: true }); };
  const seg = (base, tabs, cur, label) => `<nav class="seg u-mb12" aria-label="${h(label)}">${tabs.map(([k, t]) => `<a href="${base}${base.includes("?") ? "&" : "?"}tab=${k}" ${cur === k ? 'aria-current="page"' : ""}>${h(t)}</a>`).join("")}</nav>`;
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const piNote = (d, text) => (!d.piEnabled ? `<div class="notice warn">${ic("wallet")}<span>${h(text || d.piNotice || "مدفوعات Pi غير مفعّلة بعد — التبرّع وصرف المنح متوقفان حتى تفعيلها.")}</span></div>` : "");
  const meter = (part, whole, label) => { const max = Math.max(Number(whole) || 0, 0.0001); return `<div class="vc-meter"><progress max="${max}" value="${Math.min(Number(part) || 0, max)}" aria-label="${h(label)}"></progress><small>${h(label)}</small></div>`; };

  /* =================== #/creator-program =================== */
  async function programView() {
    const tab = qs().get("tab") || "program";
    page({ title: "الصنّاع الموثّقون", icon: "verified", sub: "برنامج يوثّق الصنّاع الجادّين ويدعم مشاريعهم من صندوق شفاف.", actions: `<a class="btn outline sm" href="#/fund">${ic("gift")}صندوق الدعم</a>${isAdmin() ? `<a class="btn ghost sm" href="#/admin/creator-program">${ic("shield")}الإدارة</a>` : ""}` },
      `${seg("#/creator-program", [["program", "البرنامج"], ["directory", "الدليل"]], tab, "أقسام البرنامج")}<div id="vc-b">${skel(4)}</div>`);
    const box = $("#vc-b");
    try { if (tab === "directory") await directoryTab(box); else await programTab(box); } catch (e) { if (box.isConnected) box.innerHTML = errBox(e); }
  }
  async function programTab(box) {
    const d = await api("GET", "/api/creator-program"); if (!box.isConnected) return;
    const cats = Object.entries(d.categories);
    const checks = d.checks ? `<div class="f-h">شروط الانضمام</div><ul class="vc-checks">${d.checks.map((c) => `<li class="${c.ok ? "ok" : "no"}">${ic(c.ok ? "check" : "x")}<span class="u-f1"><b>${h(c.label)}</b><small>${c.ok ? "مكتمل" : `وضعك الآن: ${h(typeof c.value === "number" ? num(c.value) : c.value)}`}</small></span>${!c.ok && c.href ? `<a class="btn ghost sm" href="${h(c.href)}">إكمال</a>` : ""}</li>`).join("")}</ul>` : "";
    const m = d.member, a = d.application;
    const status = m ? `<section class="card vc-status"><div class="vc-row">${ic(m.status === "verified" ? "verified" : "alert")}<span class="u-f1"><b>${h(m.statusLabel)}</b><small>${m.status === "verified" ? `في مجال ${h(m.category.label)} حتى ${h(day(m.until))}` : m.reason ? h(m.reason) : "جدّد عضويتك لتعود شارتك"}</small></span>${badge(TONE[m.status], m.statusLabel)}</div>${m.renewable ? `<button class="btn u-mt8" type="button" id="vc-renew">${ic("refresh")}تجديد لسنة</button>` : ""}</section>`
      : a && a.status === "pending" ? `<section class="card vc-status"><div class="vc-row">${ic("clock")}<span class="u-f1"><b>طلبك قيد المراجعة</b><small>قدّمته في ${h(day(a.createdAt))} · مجال ${h(a.category.label)}</small></span>${badge("warn", a.statusLabel)}</div><button class="btn ghost sm u-mt8" type="button" id="vc-wd">سحب الطلب</button></section>`
      : a && a.status === "rejected" ? `<div class="notice warn">${ic("alert")}<span>لم يُقبل طلبك السابق: ${h(a.reason || "")}</span></div>` : "";
    const form = d.signedIn && d.canApply ? `<div class="f-h">قدّم طلبك</div><form class="card f-form" id="vc-af">
        <label>مجالك<select name="category" required><option value="">اختر…</option>${cats.map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></label>
        <label>عرّف بمحتواك وجمهورك<textarea name="statement" required minlength="40" maxlength="1500" rows="4" placeholder="ماذا تقدّم، ولمن، ومنذ متى؟"></textarea></label>
        <label>روابط لأعمالك (حتى ٣، رابط في كل سطر)<textarea name="links" rows="2" maxlength="900" placeholder="https://"></textarea></label>
        <fieldset class="vc-conduct"><legend>ميثاق الصنّاع</legend><ul>${d.conduct.map((c) => `<li>${h(c)}</li>`).join("")}</ul><label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="conduct" required> أوافق على الميثاق وألتزم به</label></fieldset>
        <button class="btn" type="submit">${ic("send")}إرسال الطلب</button></form>`
      : d.signedIn && !m && !(a && a.status === "pending") && d.why ? `<p class="f-hint u-mt8">${h(d.why)}</p>` : !d.signedIn ? UI.empty({ title: "سجّل الدخول", text: "لترى شروطك وتقدّم طلبك.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }) : "";
    box.innerHTML = `<section class="f-cover"><h3>${num(d.verified)} صانع موثّق</h3><small>التوثيق مجاني ويُراجع يدوياً من فريق المنصة، ويتجدّد كل سنة.</small></section>
      <div class="f-h">ماذا تحصل عليه</div><ul class="vc-benefits">${d.benefits.map((b, i) => `<li>${ic(["verified", "users", "gift", "shield"][i] || "check")}<span>${h(b)}</span></li>`).join("")}</ul>
      ${status}${checks}${form}`;
    $("#vc-af")?.addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; busy(e.submitter, async () => { await api("POST", "/api/creator-program/apply", { category: f.category.value, statement: f.statement.value.trim(), links: f.links.value.split(/\s+/).filter(Boolean), conduct: f.conduct.checked }); say("أُرسل طلبك للمراجعة"); programTab(box); }); });
    $("#vc-wd")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("POST", "/api/creator-program/withdraw"); say("سُحب الطلب"); programTab(box); }));
    $("#vc-renew")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("POST", "/api/creator-program/renew"); say("جُدّدت عضويتك لسنة"); programTab(box); }));
  }
  async function directoryTab(box) {
    const cat = qs().get("category") || "", text = qs().get("q") || "";
    const d = await api("GET", `/api/creator-program/directory?category=${enc(cat)}&q=${enc(text)}`); if (!box.isConnected) return;
    box.innerHTML = `<form class="fx-q u-mb12" id="vc-sf" role="search"><label><span class="vh">ابحث في الدليل</span><input type="search" name="q" value="${h(text)}" maxlength="60" placeholder="ابحث باسم أو مجال"></label></form>
      <ul class="f-chips" aria-label="المجالات"><li><a class="chip f" href="#/creator-program?tab=directory" ${!cat ? 'aria-current="true"' : ""}>الكل</a></li>${Object.entries(d.categories).filter(([k]) => d.counts[k]).map(([k, v]) => `<li><a class="chip f" href="#/creator-program?tab=directory&category=${k}" ${cat === k ? 'aria-current="true"' : ""}>${h(v)} <span class="n">${num(d.counts[k])}</span></a></li>`).join("")}</ul>
      ${d.creators.length ? `<ul class="f-grid vc-grid">${d.creators.map((c) => `<li><a class="f-card vc-card" href="#/u/${enc(c.user.handle)}"><span class="vc-row">${av(c.user)}<span class="u-f1 u-mw0"><b>${h(c.user.name)} ${ic("verified", "xs")}</b><small>@${h(c.user.handle)}</small></span></span><p>${h(c.bio || "")}</p><span class="vc-ft"><span class="chip">${h(c.category.label)}</span><span>${num(c.followers)} متابع</span></span></a></li>`).join("")}</ul>`
        : UI.empty({ title: cat || text ? "لا نتائج" : "لا صنّاع موثّقين بعد", text: "كن أول من ينضم إلى البرنامج.", action: `<a class="btn" href="#/creator-program">شروط الانضمام</a>` })}`;
    $("#vc-sf").addEventListener("submit", (e) => { e.preventDefault(); location.hash = `#/creator-program?tab=directory${cat ? "&category=" + enc(cat) : ""}&q=${enc(e.target.q.value.trim())}`; });
  }

  /* =================== #/fund =================== */
  async function fundView() {
    page({ title: "صندوق دعم الصنّاع", icon: "gift", sub: "منح لمشاريع الصنّاع الموثّقين، بأرقام معلنة للجميع.", back: ["#/creator-program", "الصنّاع الموثّقون"] }, `<div id="vc-f">${skel(4)}</div>`);
    const box = $("#vc-f");
    let d; try { d = await api("GET", "/api/fund"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const t = d.totals;
    const roundRow = (r) => `<li><a class="li" href="#/fund/r/${enc(r.id)}">${ic("cal")}<span class="t"><b>${h(r.title)}</b><small>${r.phase === "soon" ? "يبدأ " + h(day(r.opensAt)) : r.phase === "open" ? "التقديم حتى " + h(day(r.closesAt)) : h(r.statusLabel)} · الميزانية ${pi(r.budget)} · ${num(r.applications)} طلب</small></span>${badge(TONE[r.status], r.phase === "soon" ? "قريباً" : r.phase === "ended" ? "انتهى التقديم" : r.statusLabel)}</a></li>`;
    box.innerHTML = `${piNote(d)}
      <div class="f-kpis"><div class="kpi-tile"><b>${pi(t.pool)}</b><span>رصيد الصندوق</span></div><div class="kpi-tile"><b>${pi(t.donated)}</b><span>تبرّعات ${num(t.donors)} عضو</span></div><div class="kpi-tile"><b>${pi(t.awarded)}</b><span>منح معتمدة (${num(t.grants)})</span></div><div class="kpi-tile"><b>${pi(t.paid)}</b><span>صُرف فعلياً</span></div></div>
      ${t.awarded ? meter(t.paid, t.awarded, `صُرف ${num(t.paid)} من ${num(t.awarded)} Pi معتمدة`) : ""}
      <div class="f-h">الجولات</div>${d.rounds.length ? `<ul class="list">${d.rounds.map(roundRow).join("")}</ul>` : UI.empty({ title: "لا جولات بعد", text: "يعلن فريق المنصة الجولات هنا، ويُبلَّغ الصنّاع الموثّقون عند فتحها." })}
      <div class="f-h">المنح المعتمدة</div>${d.grants.length ? `<ul class="list">${d.grants.map((g) => `<li><a class="li" href="#/fund/g/${enc(g.id)}">${av(g.creator)}<span class="t"><b>${h(g.title)}</b><small>${h(g.creator?.name)} · ${h(g.round)}</small></span><span class="vc-amt"><b>${pi(g.award)}</b>${badge(TONE[g.payStatus], PAYS[g.payStatus] || g.payLabel)}</span></a></li>`).join("")}</ul>` : UI.empty({ title: "لا منح معتمدة بعد" })}
      <div class="f-h">ادعم الصندوق</div><form class="card f-form" id="vc-dn"><p class="f-hint u-mt0">تذهب التبرّعات كلها إلى رصيد الصندوق المعلن أعلاه، ويُصرف منه للمنح المعتمدة فقط.</p>
        <label>المبلغ بـ Pi<input name="amount" type="number" min="0.01" max="10000" step="0.01" required inputmode="decimal" ${d.piEnabled ? "" : "disabled"}></label>
        <label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="anonymous" ${d.piEnabled ? "" : "disabled"}> تبرّع دون إظهار اسمي</label>
        <button class="btn" type="submit" ${d.piEnabled && signed() && !d.me?.minor ? "" : "disabled"}>${ic("heart")}تبرّع</button>${d.me?.minor ? `<p class="f-hint">التبرّع غير متاح لمن هم دون ١٨ سنة.</p>` : !d.piEnabled ? `<p class="f-hint">متوقف حتى تفعيل مدفوعات Pi.</p>` : ""}</form>
      ${d.donations.length ? `<div class="f-h">آخر التبرّعات</div><ul class="list">${d.donations.map((x) => `<li><div class="li">${ic("heart")}<span class="t"><b>${pi(x.amount)}</b><small>${x.by ? h(x.by.name) : "متبرّع"} · ${h(day(x.at))}</small></span></div></li>`).join("")}</ul>` : ""}
      ${d.me?.applications?.length ? `<div class="f-h">طلباتي</div><ul class="list">${d.me.applications.map((a) => `<li><a class="li" href="#/fund/g/${enc(a.id)}">${ic("doc")}<span class="t"><b>${h(a.title)}</b><small>${h(a.round)}</small></span>${badge(TONE[a.status], a.statusLabel)}</a></li>`).join("")}</ul>` : ""}`;
    $("#vc-dn").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; busy(e.submitter, async () => {
      const r = await api("POST", "/api/fund/donate", { amount: Number(f.amount.value), anonymous: f.anonymous.checked });
      try { if (window.MPChunks) await MPChunks.load("pi"); } catch { /* offline */ }
      if (!window.MPPi?.pay) { say("افتح التطبيق داخل متصفح Pi لإتمام الدفع"); return; }
      await MPPi.pay({ amount: r.intent.amount, memo: r.intent.memo, purpose: "fund", refId: r.donation.id, intent: async () => r.intent }); say("شكراً لدعمك"); fundView(); }); });
  }
  async function roundView(rid) {
    page({ title: "جولة الدعم", icon: "cal", back: ["#/fund", "صندوق الدعم"] }, `<div id="vc-r">${skel(3)}</div>`);
    const box = $("#vc-r");
    let d; try { d = await api("GET", "/api/fund/rounds/" + enc(rid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const r = d.round, me = d.me, mine = me?.application;
    const appForm = (a) => `<form class="card f-form" id="vc-ff"><label>عنوان المشروع<input name="title" required minlength="6" maxlength="140" value="${h(a?.title || "")}"></label>
      <label>الخطة: ماذا ستنتج، ولمن، وكيف تقيس الأثر؟<textarea name="plan" required minlength="80" maxlength="4000" rows="6">${h(a?.plan || "")}</textarea></label>
      <label>المبلغ المطلوب بـ Pi (حتى ${num(r.maxGrant)})<input name="amount" type="number" min="0.01" max="${r.maxGrant}" step="0.01" required inputmode="decimal" value="${a ? a.amount : ""}"></label>
      <label>مراحل التنفيذ (مرحلة في كل سطر، حتى ٦)<textarea name="milestones" required rows="3" maxlength="1200">${h((a?.milestones || []).join("\n"))}</textarea></label>
      <div class="vc-acts"><button class="btn" type="submit">${a ? "حفظ التعديل" : "إرسال الطلب"}</button>${a ? `<button class="btn ghost" type="button" id="vc-fw">سحب الطلب</button>` : ""}</div></form>`;
    box.innerHTML = `<section class="f-cover"><h3>${h(r.title)}</h3><small>${r.phase === "open" ? "التقديم مفتوح حتى " + h(day(r.closesAt)) : r.phase === "soon" ? "يبدأ التقديم " + h(day(r.opensAt)) : h(r.statusLabel)}</small></section>
      <div class="f-kpis"><div class="kpi-tile"><b>${pi(r.budget)}</b><span>الميزانية</span></div><div class="kpi-tile"><b>${pi(r.maxGrant)}</b><span>أقصى منحة</span></div><div class="kpi-tile"><b>${num(r.applications)}</b><span>طلب</span></div><div class="kpi-tile"><b>${pi(r.awarded)}</b><span>معتمد</span></div></div>
      <div class="card"><p class="vc-pre">${h(r.descr)}</p>${r.criteria ? `<div class="f-h">معايير التقييم</div><p class="vc-pre">${h(r.criteria)}</p>` : ""}${r.categories.length ? `<ul class="f-chips u-mt8" aria-label="المجالات">${r.categories.map((c) => `<li><span class="chip">${h(c.label)}</span></li>`).join("")}</ul>` : ""}</div>
      ${mine ? `<div class="f-h">طلبي</div><div class="card"><div class="vc-row">${ic("doc")}<span class="u-f1"><b>${h(mine.title)}</b><small>${pi(mine.amount)}${mine.reason ? " · " + h(mine.reason) : ""}</small></span>${badge(TONE[mine.status], mine.statusLabel)}</div>${mine.status === "approved" ? `<a class="btn outline sm u-mt8" href="#/fund/g/${enc(mine.id)}">صفحة المنحة</a>` : ""}</div>${me.canEdit ? appForm(mine) : ""}`
        : me?.canApply ? `<div class="f-h">قدّم مشروعك</div>${appForm(null)}` : me ? `<p class="f-hint">${h(me.why || "")}${!me.verified ? ` <a class="u-fw7" href="#/creator-program">شروط التوثيق</a>` : ""}</p>` : `<p class="f-hint"><a class="u-fw7" href="#/settings">سجّل الدخول</a> لتقدّم إن كنت صانعاً موثّقاً.</p>`}
      ${d.awards.length ? `<div class="f-h">المنح المعتمدة في الجولة</div><ul class="list">${d.awards.map((g) => `<li><a class="li" href="#/fund/g/${enc(g.id)}">${av(g.creator)}<span class="t"><b>${h(g.title)}</b><small>${h(g.creator?.name)}</small></span><span class="vc-amt"><b>${pi(g.award)}</b>${badge(TONE[g.payStatus], PAYS[g.payStatus] || g.payLabel)}</span></a></li>`).join("")}</ul>` : ""}`;
    const ff = $("#vc-ff");
    ff?.addEventListener("submit", (e) => { e.preventDefault(); const body = { title: ff.title.value.trim(), plan: ff.plan.value.trim(), amount: Number(ff.amount.value), milestones: ff.milestones.value.split("\n").map((x) => x.trim()).filter(Boolean) };
      busy(e.submitter, async () => { if (mine) await api("PUT", "/api/fund/applications/" + enc(mine.id), body); else await api("POST", `/api/fund/rounds/${enc(rid)}/apply`, body); say(mine ? "حُفظ التعديل" : "أُرسل طلبك"); roundView(rid); }); });
    $("#vc-fw")?.addEventListener("click", (e) => { if (!confirm("سحب طلبك من هذه الجولة؟")) return; busy(e.currentTarget, async () => { await api("PUT", "/api/fund/applications/" + enc(mine.id), { withdraw: true }); say("سُحب الطلب"); roundView(rid); }); });
  }
  async function grantView(gid) {
    page({ title: "منحة", icon: "gift", back: ["#/fund", "صندوق الدعم"] }, `<div id="vc-g">${skel(3)}</div>`);
    const box = $("#vc-g");
    let d; try { d = await api("GET", "/api/fund/grants/" + enc(gid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const g = d.grant;
    box.innerHTML = `<section class="card vc-grant"><div class="vc-row">${av(g.creator)}<span class="u-f1 u-mw0"><b>${h(g.title)}</b><small><a href="#/u/${enc(g.creator?.handle || "")}">${h(g.creator?.name)}</a> · <a href="#/fund/r/${enc(g.round.id)}">${h(g.round.title)}</a></small></span>${badge(TONE[g.status], g.statusLabel)}</div>
        <div class="f-kpis u-mt12"><div class="kpi-tile"><b>${pi(g.amount)}</b><span>المطلوب</span></div><div class="kpi-tile"><b>${g.status === "approved" ? pi(g.award) : "—"}</b><span>المعتمد</span></div></div>
        ${g.status === "approved" ? `<p class="vc-row">${ic("wallet")}<span>حالة الصرف: ${badge(TONE[g.payStatus], g.payLabel)}${g.payoutTx ? ` <small class="u-c-mu">رقم المعاملة ${h(g.payoutTx)}</small>` : ""}</span></p>` : ""}
        ${g.reason ? `<p class="f-hint">${h(g.reason)}</p>` : ""}</section>
      ${piNote(d, "مدفوعات Pi غير مفعّلة بعد — المنح المعتمدة تُصرف بعد تفعيلها.")}
      <div class="f-h">الخطة</div><div class="card"><p class="vc-pre">${h(g.plan)}</p></div>
      <div class="f-h">مراحل التنفيذ</div><ol class="vc-steps">${g.milestones.map((m) => `<li>${h(m)}</li>`).join("")}</ol>
      <div class="f-h">تحديثات التقدّم</div>${d.me.canUpdate ? `<form class="card f-form" id="vc-up"><label><span class="vh">تحديث جديد</span><textarea name="body" required minlength="10" maxlength="2000" rows="3" placeholder="ماذا أنجزت؟ أضف روابط لما نشرته."></textarea></label><button class="btn" type="submit">نشر التحديث</button></form>` : ""}
      ${d.updates.length ? `<ul class="vc-updates">${d.updates.map((u) => `<li class="card"><small class="u-c-mu">${h(day(u.at))}</small><p class="vc-pre">${h(u.body)}</p></li>`).join("")}</ul>` : UI.empty({ title: "لا تحديثات بعد", text: "ينشر الصانع هنا ما ينجزه من مشروعه." })}
      ${d.me.canReport ? `<details class="card u-mt12"><summary class="u-mh44 u-dflex u-aic u-fw7 u-cp">${ic("flag")} الإبلاغ عن هذه المنحة</summary><form class="f-form u-mt8" id="vc-rp"><label>السبب<select name="reason" required><option value="">اختر…</option>${Object.entries(d.me.reasons).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></label><label>تفاصيل (اختياري)<textarea name="note" maxlength="600" rows="2"></textarea></label><button class="btn outline" type="submit">إرسال البلاغ</button></form></details>` : ""}`;
    $("#vc-up")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/fund/grants/${enc(gid)}/updates`, { body: e.target.body.value.trim() }); say("نُشر التحديث"); grantView(gid); }); });
    $("#vc-rp")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/fund/grants/${enc(gid)}/report`, { reason: e.target.reason.value, note: e.target.note.value.trim() || undefined }); say("وصل بلاغك لفريق المنصة"); e.target.closest("details").open = false; }); });
  }

  /* =================== #/admin/creator-program =================== */
  async function adminView() {
    if (!isAdmin()) { page({ title: "الصنّاع — الإدارة", back: ["#/creator-program", "الصنّاع الموثّقون"] }, UI.empty({ title: "للإدارة فقط" })); return; }
    const tab = qs().get("tab") || "apps", rid = qs().get("round");
    page({ title: "الصنّاع والصندوق — الإدارة", icon: "shield", back: ["#/admin", "الإدارة"] }, `${seg("#/admin/creator-program", [["apps", "الطلبات"], ["members", "الموثّقون"], ["rounds", "الجولات"], ["money", "الصرف"]], tab, "أقسام الإدارة")}<div id="vc-a">${skel(3)}</div>`);
    const box = $("#vc-a");
    try {
      if (rid) return await adminRound(box, rid);
      const d = await api("GET", "/api/admin/creator-program"); if (!box.isConnected) return; const t = d.totals;
      const kpis = `<div class="f-kpis"><div class="kpi-tile"><b>${num(t.pending)}</b><span>طلب توثيق</span></div><div class="kpi-tile"><b>${num(t.verified)}</b><span>صانع موثّق</span></div><div class="kpi-tile"><b>${pi(t.pool)}</b><span>رصيد الصندوق</span></div><div class="kpi-tile"><b>${pi(t.due)}</b><span>منح لم تُصرف</span></div></div>`;
      if (tab === "members") box.innerHTML = kpis + (d.members.length ? `<ul class="list">${d.members.map((m) => `<li><div class="li">${av(m.user)}<a class="t u-tdn" href="#/u/${enc(m.user?.handle || "")}"><b>${h(m.user?.name)}</b><small>${h(m.category.label)} · حتى ${h(day(m.until))}${m.reason ? " · " + h(m.reason) : ""}</small></a>${m.status === "verified" ? `<button class="btn ghost sm" type="button" data-rv="${h(m.user.id)}">سحب</button>` : m.status === "revoked" ? `<button class="btn sm" type="button" data-rs="${h(m.user.id)}">إعادة</button>` : badge(TONE[m.status], m.statusLabel)}</div></li>`).join("")}</ul>` : UI.empty({ title: "لا أعضاء بعد" }));
      else if (tab === "rounds") { box.innerHTML = kpis + `${d.rounds.length ? `<ul class="list">${d.rounds.map((r) => `<li><a class="li" href="#/admin/creator-program?tab=rounds&round=${enc(r.id)}">${ic("cal")}<span class="t"><b>${h(r.title)}</b><small>${pi(r.budget)} · ${num(r.applications)} طلب · معتمد ${pi(r.awarded)}</small></span>${badge(TONE[r.status], r.statusLabel)}</a></li>`).join("")}</ul>` : UI.empty({ title: "لا جولات بعد" })}<div class="f-h">جولة جديدة</div>`; box.append(roundForm(null, d.categories)); }
      else if (tab === "money") box.innerHTML = kpis + `${piNote(d)}${d.piEnabled ? `<form class="card f-form" id="vc-pool"><label>تمويل الصندوق من المنصة (Pi)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>ملاحظة (تظهر في السجل)<input name="memo" required minlength="3" maxlength="200"></label><button class="btn" type="submit">تسجيل التمويل</button></form>` : ""}
          <div class="f-h">منح تنتظر الصرف</div>${d.payouts.length ? `<ul class="list">${d.payouts.map((a) => `<li><div class="li">${av(a.creator)}<a class="t u-tdn" href="#/fund/g/${enc(a.id)}"><b>${pi(a.award)} · ${h(a.creator?.name)}</b><small>${h(a.title)} · ${h(a.payLabel)}</small></a>${d.piEnabled ? `<button class="btn sm" type="button" data-pay="${h(a.id)}">تسجيل الصرف</button>` : badge("warn", "متوقف")}</div></li>`).join("")}</ul>` : UI.empty({ title: "لا منح معلّقة" })}
          <div class="f-h">بلاغات المنح</div>${d.reports.length ? `<ul class="list">${d.reports.map((r) => `<li><div class="li">${ic("flag")}<a class="t u-tdn" href="#/fund/g/${enc(r.grantId)}"><b>${h(r.reason)}</b><small>${h(r.note || "")} · ${h(r.by?.name || "")}</small></a><button class="btn ghost sm" type="button" data-rp="${h(r.id)}" data-act="dismiss">رفض</button><button class="btn sm" type="button" data-rp="${h(r.id)}" data-act="action">تم التعامل</button></div></li>`).join("")}</ul>` : UI.empty({ title: "لا بلاغات مفتوحة" })}`;
      else box.innerHTML = kpis + (d.applications.length ? `<ul class="u-lsn u-p0 u-m0">${d.applications.map((a) => `<li class="card"><div class="vc-row">${av(a.user)}<span class="u-f1"><b>${h(a.user?.name)}</b><small>@${h(a.user?.handle)} · ${h(a.category.label)} · ${h(day(a.createdAt))}</small></span></div><p class="vc-pre">${h(a.statement)}</p>${a.links.length ? `<ul class="vc-links">${a.links.map((l) => `<li><a href="${h(l)}" target="_blank" rel="noopener noreferrer nofollow">${h(l)}</a></li>`).join("")}</ul>` : ""}<ul class="vc-checks sm">${a.checks.map((c) => `<li class="${c.ok ? "ok" : "no"}">${ic(c.ok ? "check" : "x")}<span>${h(c.label)}</span></li>`).join("")}</ul><div class="vc-acts"><button class="btn" type="button" data-ok="${h(a.id)}">قبول</button><button class="btn ghost" type="button" data-no="${h(a.id)}">رفض</button></div></li>`).join("")}</ul>` : UI.empty({ title: "لا طلبات توثيق معلّقة" }));
      box.querySelectorAll("[data-ok]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", `/api/admin/creator-program/applications/${enc(b.dataset.ok)}/approve`, {}); say("قُبل الطلب"); adminView(); })));
      box.querySelectorAll("[data-no]").forEach((b) => b.addEventListener("click", () => { const reason = prompt("سبب الرفض (يصل لصاحب الطلب)"); if (!reason || reason.trim().length < 3) return; busy(b, async () => { await api("POST", `/api/admin/creator-program/applications/${enc(b.dataset.no)}/reject`, { reason }); say("رُفض الطلب"); adminView(); }); }));
      box.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => { const reason = prompt("سبب سحب التوثيق"); if (!reason || reason.trim().length < 3) return; busy(b, async () => { await api("POST", `/api/admin/creator-program/members/${enc(b.dataset.rv)}/revoke`, { reason }); say("سُحب التوثيق"); adminView(); }); }));
      box.querySelectorAll("[data-rs]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", `/api/admin/creator-program/members/${enc(b.dataset.rs)}/restore`); say("أُعيد التوثيق"); adminView(); })));
      box.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => { const txid = prompt("رقم معاملة Pi التي صرفت بها المنحة من محفظة التطبيق"); if (!txid || txid.trim().length < 8) return; busy(b, async () => { await api("POST", `/api/admin/fund/applications/${enc(b.dataset.pay)}/payout`, { txid: txid.trim() }); say("سُجّل الصرف"); adminView(); }); }));
      box.querySelectorAll("[data-rp]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", `/api/admin/fund/reports/${enc(b.dataset.rp)}`, { action: b.dataset.act }); adminView(); })));
      $("#vc-pool")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", "/api/admin/fund/pool", { amount: Number(e.target.amount.value), memo: e.target.memo.value.trim() }); say("سُجّل التمويل"); adminView(); }); });
    } catch (e) { if (box.isConnected) box.innerHTML = errBox(e); }
  }
  const dt = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : "");
  function roundForm(r, cats) {
    const f = document.createElement("form"); f.className = "card f-form"; f.id = "vc-rf";
    const sel = new Set((r?.categories || []).map((c) => c.key));
    f.innerHTML = `<label>العنوان<input name="title" required minlength="6" maxlength="140" value="${h(r?.title || "")}"></label><label>الوصف<textarea name="descr" required minlength="20" maxlength="3000" rows="3">${h(r?.descr || "")}</textarea></label><label>معايير التقييم<textarea name="criteria" maxlength="2000" rows="2">${h(r?.criteria || "")}</textarea></label>
      <fieldset class="vc-cats"><legend>المجالات (اتركها فارغة لكل المجالات)</legend>${Object.entries(cats).map(([k, v]) => `<label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="categories" value="${k}" ${sel.has(k) ? "checked" : ""}> ${h(v)}</label>`).join("")}</fieldset>
      <div class="vc-two"><label>الميزانية (Pi)<input name="budget" type="number" min="0.01" step="0.01" required value="${r ? r.budget : ""}"></label><label>أقصى منحة (Pi)<input name="maxGrant" type="number" min="0.01" step="0.01" required value="${r ? r.maxGrant : ""}"></label></div>
      <div class="vc-two"><label>يبدأ التقديم<input name="opensAt" type="datetime-local" required value="${dt(r?.opensAt)}"></label><label>ينتهي التقديم<input name="closesAt" type="datetime-local" required value="${dt(r?.closesAt)}"></label></div>
      <button class="btn" type="submit">${r ? "حفظ" : "إنشاء كمسودة"}</button>`;
    f.addEventListener("submit", (e) => { e.preventDefault(); const body = { title: f.title.value.trim(), descr: f.descr.value.trim(), criteria: f.criteria.value.trim(), categories: [...f.querySelectorAll("[name=categories]:checked")].map((x) => x.value), budget: Number(f.budget.value), maxGrant: Number(f.maxGrant.value), opensAt: new Date(f.opensAt.value).toISOString(), closesAt: new Date(f.closesAt.value).toISOString() };
      busy(e.submitter, async () => { const res = r ? await api("PUT", "/api/admin/fund/rounds/" + enc(r.id), body) : await api("POST", "/api/admin/fund/rounds", body); say("حُفظت الجولة"); location.hash = "#/admin/creator-program?tab=rounds&round=" + enc(res.round.id); }); });
    return f;
  }
  async function adminRound(box, rid) {
    const [d, all] = await Promise.all([api("GET", "/api/admin/fund/rounds/" + enc(rid)), api("GET", "/api/admin/creator-program")]); if (!box.isConnected) return; const r = d.round;
    const next = { draft: [["open", "فتح التقديم"]], open: [["review", "إغلاق التقديم وبدء المراجعة"]], review: [["closed", "إغلاق الجولة نهائياً"], ["open", "إعادة فتح التقديم"]], closed: [] }[r.status] || [];
    box.innerHTML = `<p><a class="u-fw7" href="#/admin/creator-program?tab=rounds">← كل الجولات</a></p><section class="card"><div class="vc-row">${ic("cal")}<span class="u-f1"><b>${h(r.title)}</b><small>${pi(r.budget)} · المتبقي ${pi(r.remaining)} · ${num(r.applications)} طلب</small></span>${badge(TONE[r.status], r.statusLabel)}</div><div class="vc-acts u-mt8">${next.map(([k, t]) => `<button class="btn ${k === "closed" ? "ghost" : ""} sm" type="button" data-to="${k}">${h(t)}</button>`).join("")}</div></section>
      ${piNote(d, "مدفوعات Pi غير مفعّلة: تُسجَّل القرارات وتُصرف المنح بعد التفعيل.")}
      <div class="f-h">الطلبات</div>${d.applications.length ? `<ul class="u-lsn u-p0 u-m0">${d.applications.map((a) => `<li class="card"><div class="vc-row">${av(a.creator)}<span class="u-f1"><b>${h(a.title)}</b><small>${h(a.creator?.name)} · طلب ${pi(a.amount)}${a.score !== null ? " · تقييم " + num(a.score) : ""}</small></span>${badge(TONE[a.status], a.statusLabel)}</div><p class="vc-pre">${h(a.plan)}</p><ol class="vc-steps">${a.milestones.map((m) => `<li>${h(m)}</li>`).join("")}</ol>
        ${["submitted", "shortlisted"].includes(a.status) && ["open", "review"].includes(r.status) ? `<form class="f-form u-mt8" data-a="${h(a.id)}"><div class="vc-two"><label>المنحة (Pi)<input name="award" type="number" min="0.01" max="${a.amount}" step="0.01" value="${a.amount}"></label><label>التقييم (0–100)<input name="score" type="number" min="0" max="100" value="${a.score ?? ""}"></label></div><label>رسالة لصاحب الطلب<input name="reason" maxlength="600"></label><label>ملاحظة داخلية<input name="note" maxlength="1000" value="${h(a.note || "")}"></label><div class="vc-acts"><button class="btn" type="submit" value="approve">اعتماد</button><button class="btn outline" type="submit" value="shortlist">قائمة مختصرة</button><button class="btn ghost" type="submit" value="reject">رفض</button></div></form>` : a.status === "approved" ? `<p class="f-hint">المعتمد ${pi(a.award)} · ${h(a.payLabel)}</p>` : ""}</li>`).join("")}</ul>` : UI.empty({ title: "لا طلبات بعد" })}
      ${r.status !== "closed" ? `<div class="f-h">تعديل الجولة</div>` : ""}`;
    if (r.status !== "closed") box.append(roundForm(r, all.categories));
    box.querySelectorAll("[data-to]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", `/api/admin/fund/rounds/${enc(rid)}/status`, { status: b.dataset.to }); say("تغيّرت حالة الجولة"); adminRound(box, rid); })));
    box.querySelectorAll("form[data-a]").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); const action = e.submitter?.value || "approve";
      if (action === "reject" && f.reason.value.trim().length < 3) { say("اكتب سبب الرفض لصاحب الطلب"); f.reason.focus(); return; }
      busy(e.submitter, async () => { await api("POST", `/api/admin/fund/applications/${enc(f.dataset.a)}/decide`, { action, award: f.award.value, score: f.score.value, reason: f.reason.value.trim() || undefined, note: f.note.value.trim() || undefined }); say("حُفظ القرار"); adminRound(box, rid); }); }));
  }

  MPRoutes.extend((a, b, base) => {
    return { "creator-program": () => programView(),
      fund: () => (a === "r" && b ? roundView(b) : a === "g" && b ? grantView(b) : fundView()) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "creator-program" ? adminView() : next()));
  window.MPVCreators = { programView, fundView, roundView, grantView, adminView, version: "__APP_VERSION__" };
  if (/^#\/(creator-program|fund|admin\/creator-program)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
