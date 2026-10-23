/* =====================================================================
 * Phase 80 — professional reputation & verified reviews «السمعة المهنية» (lazy chunk `proreviews`, loads after the
 * `work` chunk and reuses its wk-* styles; proreviews.css adds the score, the rating inputs and the bars).
 *   #/reviews[?tab=pending|received|given]   to review (completed contracts / teams), received (respond), given (edit
 *                                             while hidden)
 *   #/reviews/new?kind=&ref=&to=             write a review (overall + three criteria + text + endorse skills)
 *   #/reviews/u/:handle                      a member's reputation: score, badges, endorsed skills, reviews, report,
 *                                             endorse (verified collaborators)
 *   #/admin/reviews                           staff: reported / flagged reviews, reciprocal pairs
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function ProReviewsUI() {
  if (window.MPProReviews) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => UI.icon(n, c);
  const num = (n, o) => UI.num(n, o);
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const errBox = (e) => UI.empty({ title: "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم" });
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const page = (head, body) => { view.innerHTML = `<div class="wrap wk-page">${UI.pageHead({ ...head, id: "pr-h" })}${body}</div>`; $("#pr-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const av = (u, cls = "") => { const src = u && typeof avSrc === "function" ? avSrc(u, "") : null; return `<span class="wk-av ${cls}" aria-hidden="true">${src ? `<img src="${h(src)}" alt="" loading="lazy" decoding="async">` : h(String(u?.name || "؟").trim()[0] || "؟")}</span>`; };
  const day = (s) => { try { return new Intl.DateTimeFormat("ar", { numberingSystem: "latn", day: "numeric", month: "long" }).format(new Date(s)); } catch { return String(s || "").slice(0, 10); } };
  const dec = (x) => num(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const stars = (n) => `<span class="pr-stars" role="img" aria-label="${num(n)} من ${num(5)}">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= n ? "on" : "off"}">${ic("star", "xs")}</span>`).join("")}</span>`;
  const KIND = { contract: "عقد", team: "مشروع جماعي" };
  const warnTxt = `<span class="notice warn">${ic("alert")}<span>تنبيه: يحتوي النص على ما يشبه طلب دفع أو تواصل خارج المنصة. لا تدفع ولا تشارك بياناتك.</span></span>`;

  /* ---------- shared pieces ---------- */
  function scoreCard(s, { title = "السمعة المهنية" } = {}) {
    const total = s.dist.reduce((a, d) => a + d.n, 0) || 1;
    return `<section class="card wk-sec pr-sum" aria-labelledby="pr-sum-h"><h3 id="pr-sum-h" class="wk-st">${ic("star")}${title}</h3>
      <div class="pr-top"><div class="pr-big">${s.avg !== null ? `<b>${dec(s.avg)}</b>${stars(Math.round(s.avg))}` : `<b class="pr-na">—</b>`}<small>${s.count ? `${num(s.count)} تقييم محتسب${s.total > s.count ? ` من ${num(s.total)}` : ""}` : "لا تقييمات محتسبة بعد"}</small></div>
        <dl class="wk-facts pr-facts"><div><dt>أعمال منجزة</dt><dd>${num(s.completed.total)}</dd></div><div><dt>عقود</dt><dd>${num(s.completed.contracts)}</dd></div><div><dt>مشاريع</dt><dd>${num(s.completed.teams)}</dd></div></dl></div>
      ${s.count ? `<ul class="pr-dist" aria-label="توزيع التقييمات">${s.dist.map((d) => `<li><span>${num(d.stars)} ${ic("star", "xs")}</span><meter min="0" max="${total}" value="${d.n}" aria-label="${num(d.stars)} نجوم: ${num(d.n)}"></meter><small>${num(d.n)}</small></li>`).join("")}</ul>` : ""}
      ${Object.values(s.as || {}).length ? `<div class="pr-as">${Object.values(s.as).map((g) => `<div class="pr-g"><b>${h(g.label)}: ${dec(g.avg)} <small>(${num(g.n)})</small></b><ul>${g.criteria.filter((c) => c.avg !== null).map((c) => `<li><span>${h(c.label)}</span><b>${dec(c.avg)}</b></li>`).join("")}</ul></div>`).join("")}</div>` : ""}
      ${s.isNew ? `<p class="f-hint">${ic("help", "xs")} يُعرض المعدّل بثقة بعد ${num(3)} تقييمات محتسبة. لا تُحتسب التقييمات المكرّرة من نفس العضو أو من حسابات جديدة أو تعاملات قصيرة جداً.</p>` : ""}
      ${badgesHtml(s.badges)}
      ${s.endorsements?.length ? `<div class="f-h">مهارات أيّدها زملاء عمل</div><ul class="wk-skills">${s.endorsements.map((e) => `<li><b>${h(e.name)}</b><small>${num(e.n)} تأييد${e.n >= 3 ? " · موثّقة" : ""}</small></li>`).join("")}</ul>` : ""}</section>`;
  }
  const badgesHtml = (b) => (b && b.length ? `<ul class="pr-badges" aria-label="الشارات المهنية">${b.map((x) => `<li><span class="pr-bdg">${ic(x.key === "trusted" || x.key === "top" ? "award" : x.key === "skills" ? "verified" : x.key === "team" ? "users" : "check", "xs")}<b>${h(x.label)}</b></span><small>${h(x.hint)}</small></li>`).join("")}</ul>` : "");
  function reviewHtml(r, { showTarget = false, actions = "", mine = false } = {}) {
    const who = showTarget ? r.target : r.author;
    return `<li class="card pr-rev" id="pr-${h(r.id)}"><div class="pr-rh">${av(who)}<span class="u-f1 u-mw0"><b>${showTarget ? "إلى " : ""}${who ? `<a href="#/cv/${enc(who.handle)}">${h(who.name)}</a>` : "عضو"}</b><small>${h(r.roleLabel)} · ${h(KIND[r.kind] || "")} · ${h(day(r.createdAt))}</small></span>${stars(r.overall)}</div>
      ${r.criteria.length ? `<ul class="pr-crit">${r.criteria.map((c) => `<li><span>${h(c.label)}</span><b>${num(c.value)}/${num(5)}</b></li>`).join("")}</ul>` : ""}
      ${r.body ? `<p class="pr-body">${h(r.body)}</p>` : ""}${r.warn ? warnTxt : ""}
      ${r.counted === false ? `<p class="f-hint">${ic("help", "xs")} لا يُحتسب في المعدّل${r.notCounted?.length ? `: ${h(r.notCounted.join("، "))}` : ""}</p>` : ""}
      ${r.status === "flagged" ? `<p class="notice">${ic("flag")}<span>قيد مراجعة فريق المنصة بعد بلاغات.</span></p>` : r.status === "hidden" ? `<p class="notice warn">${ic("eye")}<span>أخفاه فريق المنصة${r.staffNote ? `: «${h(r.staffNote)}»` : ""}.</span></p>` : ""}
      ${r.response ? `<div class="pr-resp"><b>${mine ? "ردّك" : `ردّ ${showTarget ? h(r.target?.name || "") : "صاحب الملف"}`}</b><p>${h(r.response.body)}</p></div>` : ""}${actions}</li>`;
  }
  const rateField = (name, legend, req) => `<fieldset class="pr-rate"><legend>${h(legend)}${req ? "" : " <small>(اختياري)</small>"}</legend><div class="pr-opts">${[1, 2, 3, 4, 5].map((i) => `<label><input type="radio" name="${name}" value="${i}" ${req ? "required" : ""}><span>${num(i)}${ic("star", "xs")}</span></label>`).join("")}</div></fieldset>`;

  /* ---------- #/reviews ---------- */
  async function hub() {
    if (!signed()) { page({ title: "التقييمات المهنية", icon: "star" }, UI.empty({ title: "سجّل الدخول", text: "لتقيّم من عملت معهم وتتابع سمعتك المهنية.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` })); return; }
    const q = qs();
    page({ title: "التقييمات المهنية", icon: "star", sub: "تقييمات موثّقة من عقود ومشاريع مكتملة فقط.", actions: `<a class="btn outline sm" href="#/cv">${ic("brief")}ملفي المهني</a>` }, `<div id="pr-l">${skel(4)}</div>`);
    const box = $("#pr-l");
    let d; try { d = await api("GET", "/api/proreviews"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    const tab = ["pending", "received", "given"].includes(q.get("tab")) ? q.get("tab") : d.pending.length ? "pending" : "received";
    const me = (typeof S !== "undefined" && S.me?.()) || null;
    const seg = `<nav class="seg u-mb12" aria-label="التقييمات"><a href="#/reviews?tab=pending" ${tab === "pending" ? 'aria-current="page"' : ""}>للتقييم <span class="n">${num(d.pending.length)}</span></a><a href="#/reviews?tab=received" ${tab === "received" ? 'aria-current="page"' : ""}>تلقيتها</a><a href="#/reviews?tab=given" ${tab === "given" ? 'aria-current="page"' : ""}>كتبتها</a></nav>`;
    let body = "";
    if (tab === "pending") body = d.pending.length ? `<ul class="list pr-pend">${d.pending.map((p) => `<li><span class="li">${av(p.to)}<span class="t"><b>${h(p.to?.name || "")}</b><small>${h(KIND[p.kind])}: ${h(p.title)} · أنت ${h(p.roleLabel)}</small><small>قيّم قبل ${h(day(p.closesAt))}${p.theyReviewed ? " · قيّمك بالفعل؛ قيّمه ليظهر التقييمان" : ""}</small></span></span><a class="btn sm" href="#/reviews/new?kind=${enc(p.kind)}&ref=${enc(p.ref)}&to=${enc(p.to?.id || "")}">${ic("star")}قيّم</a></li>`).join("")}</ul><p class="f-hint">${ic("lock", "xs")} لا يرى الطرف الآخر تقييمك حتى يقيّمك هو أيضاً أو تنتهي مهلة ${num(d.windowDays)} يوماً، فلا يتأثر أحد بتقييم الآخر.</p>`
      : UI.empty({ title: "لا شيء للتقييم الآن", text: "بعد إكمال عقد أو مشروع جماعي يظهر هنا من عملت معهم لتقيّمهم.", action: `<a class="btn outline" href="#/contracts">العقود</a>` });
    else if (tab === "received") body = `${scoreCard(d.summary, { title: "سمعتك المهنية" })}${d.waiting ? `<div class="notice">${ic("lock")}<span>${num(d.waiting)} تقييم بانتظار الظهور: يظهر عندما تقيّم الطرف الآخر أو تنتهي المهلة.</span></div>` : ""}
      ${me?.handle ? `<p class="wk-acts"><a class="btn ghost sm" href="#/reviews/u/${enc(me.handle)}">${ic("eye")}صفحة سمعتي كما يراها الآخرون</a></p>` : ""}
      ${d.received.length ? `<ol class="pr-list">${d.received.map((r) => reviewHtml(r, { mine: true, actions: r.can.respond ? `<details class="pr-more"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("comment", "xs")}${r.response ? "تعديل ردّك" : "الرد على التقييم"}</summary><form class="f-form u-mt8" data-resp="${h(r.id)}"><label>ردّك العلني (يظهر تحت التقييم)<textarea name="body" rows="2" maxlength="800">${h(r.response?.body || "")}</textarea></label><div class="wk-acts"><button class="btn sm" type="submit">نشر الرد</button>${r.response ? `<button class="btn ghost sm" type="button" data-unresp="${h(r.id)}">حذف الرد</button>` : ""}</div></form></details>` : "" })).join("")}</ol>` : UI.empty({ title: "لا تقييمات ظاهرة بعد", text: "تظهر هنا تقييمات من عملت معهم بعد إكمال العقود والمشاريع." })}`;
    else body = d.given.length ? `<ol class="pr-list">${d.given.map((r) => reviewHtml(r, { showTarget: true, actions: `${!r.revealed && r.status !== "hidden" ? `<p class="f-hint">${ic("lock", "xs")} مخفي عن ${h(r.target?.name || "")} حتى يقيّمك أو ${h(day(r.closesAt))}.</p>` : ""}${r.can.edit ? `<p><a class="btn outline sm" href="#/reviews/new?edit=${enc(r.id)}">${ic("pen")}تعديل</a></p>` : ""}` })).join("")}</ol>` : UI.empty({ title: "لم تكتب تقييمات بعد", text: "قيّم من عملت معهم لتساعد الآخرين على الاختيار." });
    box.innerHTML = seg + body;
    box.querySelectorAll("[data-resp]").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", `/api/proreviews/${enc(f.dataset.resp)}/response`, { body: f.body.value.trim() || null }); say("نُشر ردّك"); hub(); }); }));
    box.querySelectorAll("[data-unresp]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("PUT", `/api/proreviews/${enc(b.dataset.unresp)}/response`, { body: null }); say("حُذف الرد"); hub(); })));
  }

  /* ---------- #/reviews/new ---------- */
  async function form() {
    const q = qs(), editId = q.get("edit");
    page({ title: editId ? "تعديل التقييم" : "تقييم تعامل", icon: "star", back: ["#/reviews", "التقييمات"] }, `<div id="pr-f">${skel(4)}</div>`);
    const box = $("#pr-f");
    let d, p, prev = null, ends = null; try { d = await api("GET", "/api/proreviews"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (editId) { prev = d.given.find((r) => r.id === editId); if (!prev || !prev.can.edit) { box.innerHTML = UI.empty({ title: "لا يمكن تعديل هذا التقييم", text: "يمكن التعديل فقط قبل ظهور التقييم." }); return; } p = { kind: prev.kind, title: "", roleLabel: prev.roleLabel, to: prev.target, criteria: prev.criteria.map((c) => c.label) }; }
    else p = d.pending.find((x) => x.kind === q.get("kind") && x.ref === q.get("ref") && x.to?.id === q.get("to"));
    if (!box.isConnected) return;
    if (!p) { box.innerHTML = UI.empty({ title: "لا يمكن التقييم هنا", text: "التقييم متاح بعد إكمال عقد أو مشروع جماعي وخلال المهلة، ومرة واحدة لكل تعامل.", action: `<a class="btn outline" href="#/reviews">التقييمات</a>` }); return; }
    if (!editId) { try { ends = await api("GET", `/api/proreviews/endorse/${enc(p.to.handle)}`); } catch { ends = null; } }
    const crit = (p.criteria || []).length ? p.criteria : (prev?.criteria || []).map((c) => c.label);
    box.innerHTML = `<section class="card wk-sec"><span class="wk-ch">${av(p.to)}<span class="u-mw0"><b>${h(p.to?.name || "")}</b><small>${h(KIND[p.kind] || "")}${p.title ? `: ${h(p.title)}` : ""} · أنت ${h(p.roleLabel)}</small></span></span></section>
      <form class="f-form card wk-sec" id="pr-form" novalidate>
        ${rateField("overall", "التقييم العام", true)}
        ${crit.map((c, i) => rateField("c" + (i + 1), c, false)).join("")}
        <label>تجربتك (اختياري)<textarea name="body" rows="4" maxlength="1500" placeholder="ما الذي أعجبك؟ وما الذي يمكن تحسينه؟ كن منصفاً ومحدداً."></textarea></label>
        <p class="f-hint">${ic("shield", "xs")} اكتب عن العمل نفسه. لا تضع أرقام هواتف أو حسابات دفع؛ التقييمات المسيئة أو غير الحقيقية تُزال.</p>
        ${ends && ends.can && ends.skills.length ? `<fieldset class="pr-end"><legend>أيّد مهاراته التي رأيتها في العمل <small>(حتى ${num(ends.max)})</small></legend><div class="pr-chk">${ends.skills.map((s) => `<label><input type="checkbox" name="skill" value="${h(s.name)}" ${s.mine ? "checked disabled" : ""}><span>${h(s.name)}</span></label>`).join("")}</div></fieldset>` : ""}
        <p class="f-err" id="pr-err" role="alert" hidden></p>
        <div class="wk-acts"><button class="btn" type="submit">${ic("check")}${editId ? "حفظ التعديل" : "إرسال التقييم"}</button><a class="btn ghost" href="#/reviews">إلغاء</a></div>
      </form>`;
    const f = $("#pr-form");
    if (prev) { const set = (n, v) => { const el = f.querySelector(`input[name="${n}"][value="${v}"]`); if (el) el.checked = true; }; set("overall", prev.overall); prev.criteria.forEach((c, i) => set("c" + (i + 1), c.value)); f.body.value = prev.body || ""; }
    f.addEventListener("submit", (e) => {
      e.preventDefault(); const err = $("#pr-err"); const val = (n) => f.querySelector(`input[name="${n}"]:checked`)?.value;
      if (!val("overall")) { err.textContent = "اختر التقييم العام من 1 إلى 5"; err.hidden = false; f.querySelector('input[name="overall"]').focus(); return; }
      const body = f.body.value.trim(); if (body && body.length < 10) { err.textContent = "اكتب 10 أحرف على الأقل أو اترك النص فارغاً"; err.hidden = false; f.body.focus(); return; }
      err.hidden = true;
      const data = { overall: Number(val("overall")), body: body || null }; for (const k of ["c1", "c2", "c3"]) if (val(k)) data[k] = Number(val(k));
      busy(e.submitter, async () => {
        if (editId) { await api("PATCH", "/api/proreviews/" + enc(editId), data); say("حُفظ التعديل"); location.hash = "#/reviews?tab=given"; return; }
        const skills = [...f.querySelectorAll('input[name="skill"]:checked:not(:disabled)')].map((x) => x.value);
        const r = await api("POST", "/api/proreviews", { kind: p.kind, ref: p.ref, to: p.to.id, ...data, skills });
        say(r.revealed ? "نُشر التقييمان الآن" : "وصل تقييمك؛ يظهر عندما يقيّمك الطرف الآخر أو تنتهي المهلة");
        location.hash = "#/reviews?tab=given";
      });
    });
  }

  /* ---------- #/reviews/u/:handle ---------- */
  async function userPage(handle) {
    page({ title: "السمعة المهنية", icon: "star", back: [`#/cv/${enc(handle)}`, "الملف المهني"] }, `<div id="pr-u">${skel(5)}</div>`);
    const box = $("#pr-u");
    let d; try { d = await api("GET", `/api/proreviews/u/${enc(handle)}`); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const U = d.user;
    const hero = `<section class="card wk-hero">${av(U, "lg")}<div class="u-f1 u-mw0"><h3><a href="#/cv/${enc(U.handle)}">${h(U.name)}</a></h3><p class="wk-meta">@<bdi>${h(U.handle)}</bdi></p></div></section>`;
    if (d.locked) { box.innerHTML = hero + UI.empty({ title: "السمعة المهنية محدودة الظهور", text: "تتبع ظهور الملف المهني لصاحبه.", action: `<a class="btn outline" href="#/u/${enc(U.handle)}">الملف الشخصي</a>` }); return; }
    const reasons = Object.entries(d.reasons || {}).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("");
    box.innerHTML = `${hero}${d.self && d.waiting ? `<div class="notice">${ic("lock")}<span>${num(d.waiting)} تقييم بانتظار الظهور.</span></div>` : ""}${scoreCard(d.summary)}
      ${d.endorse && d.endorse.skills.length ? `<details class="card wk-sec pr-more"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("verified")} أيّد مهارات ${h(U.name)}</summary><form class="f-form u-mt8" id="pr-en"><p class="f-hint">لأنكما أكملتما عملاً معاً. اختر ما رأيته فعلاً (حتى ${num(d.endorse.max)}).</p><div class="pr-chk">${d.endorse.skills.map((s) => `<label><input type="checkbox" name="skill" value="${h(s.name)}" ${s.mine ? "checked" : ""}><span>${h(s.name)}</span></label>`).join("")}</div><button class="btn sm" type="submit">حفظ التأييد</button></form></details>` : ""}
      <h3 class="wk-st u-mt12">${ic("comment")}التقييمات ${d.reviews.length ? `<small class="pr-n">${num(d.reviews.length)}</small>` : ""}</h3>
      ${d.reviews.length ? `<ol class="pr-list">${d.reviews.map((r) => reviewHtml(r, { actions: r.can.report && signed() ? `<details class="pr-more"><summary class="u-mh44 u-dflex u-aic u-g8 u-cp">${ic("flag", "xs")} إبلاغ</summary><form class="f-form u-mt8" data-rep="${h(r.id)}"><label>السبب<select name="reason" required><option value="">اختر…</option>${reasons}</select></label><label>تفاصيل (اختياري)<textarea name="note" rows="2" maxlength="600"></textarea></label><button class="btn outline sm" type="submit">إرسال البلاغ</button></form></details>` : "" })).join("")}</ol>`
        : UI.empty({ title: "لا تقييمات ظاهرة بعد", text: "التقييمات هنا من عقود ومشاريع مكتملة فقط، ويكتبها من عمل مع صاحب الملف." })}
      ${d.staff ? `<p class="u-mt8"><a class="btn ghost sm" href="#/admin/reviews">${ic("shield")}إدارة التقييمات</a></p>` : ""}`;
    box.querySelectorAll("[data-rep]").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/proreviews/${enc(f.dataset.rep)}/report`, { reason: f.reason.value, note: f.note.value.trim() || undefined }); say("وصل بلاغك لفريق المنصة"); f.closest("details").open = false; f.reset(); }); }));
    $("#pr-en")?.addEventListener("submit", (e) => { e.preventDefault(); const skills = [...e.target.querySelectorAll('input[name="skill"]:checked')].map((x) => x.value); busy(e.submitter, async () => { await api("PUT", `/api/proreviews/endorse/${enc(U.handle)}`, { skills }); say("حُفظ التأييد"); userPage(handle); }); });
  }

  /* ---------- #/admin/reviews ---------- */
  async function adminView() {
    page({ title: "إدارة التقييمات المهنية", icon: "shield", back: ["#/admin", "الإدارة"] }, `<div id="pr-a">${skel(4)}</div>`);
    const box = $("#pr-a");
    let d; try { d = await api("GET", "/api/admin/proreviews"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const t = d.totals;
    box.innerHTML = `<dl class="wk-facts card wk-sec"><div><dt>التقييمات</dt><dd>${num(t.reviews)}</dd></div><div><dt>بلاغات مفتوحة</dt><dd>${num(t.reports)}</dd></div><div><dt>معلّقة</dt><dd>${num(t.flagged)}</dd></div><div><dt>تأييد المهارات</dt><dd>${num(t.endorsements)}</dd></div></dl>
      <h3 class="wk-st">${ic("flag")}بلاغات وتقييمات معلّقة</h3>
      ${d.queue.length ? `<ol class="pr-list">${d.queue.map((r) => reviewHtml(r, { actions: `<p class="f-hint">إلى: ${h(r.target?.name || "")}</p><ul class="pr-reps">${r.reports.map((x) => `<li>${ic("flag", "xs")}<span><b>${h(x.reason)}</b><small>${h(x.by?.name || "")} · ${h(day(x.at))}${x.note ? ` — ${h(x.note)}` : ""}</small></span></li>`).join("")}</ul>
          <form class="f-form" data-mod="${h(r.id)}"><label>ملاحظة للكاتب (مطلوبة عند الإخفاء)<input name="note" maxlength="600"></label><div class="wk-acts"><button class="btn outline sm" type="button" data-act="dismiss">رفض البلاغات</button><button class="btn sm" type="button" data-act="hide">إخفاء التقييم</button>${r.status === "hidden" ? `<button class="btn ghost sm" type="button" data-act="restore">إعادة النشر</button>` : ""}</div></form>` })).join("")}</ol>` : UI.empty({ title: "لا بلاغات مفتوحة", text: "تصل هنا التقييمات المبلّغ عنها." })}
      <h3 class="wk-st u-mt12">${ic("users")}أزواج تقييم متبادل متكرر</h3>
      ${d.pairs.length ? `<ul class="list">${d.pairs.map((p) => `<li><span class="li"><span class="ico">${ic("alert", "xs")}</span><span class="t"><b><a href="#/reviews/u/${enc(p.a?.handle || "")}">${h(p.a?.name || "")}</a> و<a href="#/reviews/u/${enc(p.b?.handle || "")}">${h(p.b?.name || "")}</a></b><small>${num(p.engagements)} تعاملات متبادلة · معدّل ${dec(p.avg)} — يُحتسب آخر تقييم فقط لكل زوج</small></span></span></li>`).join("")}</ul>` : `<p class="wk-none">لا أنماط متكررة.</p>`}`;
    box.querySelectorAll("[data-mod] [data-act]").forEach((b) => b.addEventListener("click", () => { const f = b.closest("form"); if (b.dataset.act === "hide" && !f.note.value.trim()) { say("اكتب سبب الإخفاء"); f.note.focus(); return; } busy(b, async () => { await api("POST", `/api/admin/proreviews/${enc(f.dataset.mod)}`, { action: b.dataset.act, note: f.note.value.trim() || undefined }); say("تم"); adminView(); }); }));
  }

  /* =================== routes =================== */
  MPRoutes.extend((a, b, prev) => {
    return { reviews: () => (a === "new" ? form() : a === "u" && b ? userPage(decodeURIComponent(b)) : hub()) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "reviews" ? adminView() : next()));
  window.MPProReviews = { hub, form, userPage, adminView, scoreCard, badgesHtml };
  if (!window.__deferRoute && /^#\/(reviews|admin\/reviews)(\/|\?|$)/.test(location.hash)) route();
})();
