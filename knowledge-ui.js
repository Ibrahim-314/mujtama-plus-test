/* =====================================================================
 * مجتمع بلس — Phase 75 UI: open knowledge library «المكتبة المعرفية» (lazy "knowledge" chunk + knowledge.css; 0 bytes in core
 * besides the route names). Articles are lightweight Markdown rendered by the shared RichText module (core).
 *   #/knowledge[?category=&tag=&q=&sort=]   hub: totals, search, categories, tags, sort, article cards
 *   #/knowledge/new                         write an article (licence choice + agreement, preview)
 *   #/knowledge/review                      reviewers: pending versions (new / edit, stale), reports
 *   #/knowledge/mine                        my articles and contributions with their review state
 *   #/kb/:id · #/kb/:id/edit · #/kb/:id/history · #/kb/rev/:rid   article, propose an edit, history, one version + diff
 *   #/admin/knowledge                       staff: reviewers, moderated articles (hide / restore / adults only / unflag)
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function KnowledgeUI() {
  if (window.MPKnowledge) return;
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
  const TONE = { review: "info", published: "ok", hidden: "bad", archived: "", pending: "warn", approved: "ok", rejected: "bad", withdrawn: "" };
  const page = (head, body) => { view.innerHTML = `<div class="wrap kb-page">${UI.pageHead({ ...head, id: "kb-h" })}${body}</div>`; $("#kb-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const RT = () => window.RichText;
  const md = (s) => { try { return RT() ? RT().toHTML(RT().parse(String(s || ""))) : `<p>${h(s)}</p>`; } catch { return `<p>${h(s)}</p>`; } };
  const who = (u) => (!u ? "—" : u.handle ? `<a href="#/u/${enc(u.handle)}">${h(u.name)}</a>` : `<span>${h(u.name)}</span>`);
  const delta = (n) => `<bdi class="kb-d ${n > 0 ? "up" : n < 0 ? "dn" : ""}">${n > 0 ? "+" : ""}${num(n)}</bdi>`;
  const card = (a) => `<li><a class="f-card kb-card" href="#/kb/${enc(a.id)}"><span class="kb-cat">${h(a.category.label)}</span><b>${h(a.title)}</b><p>${h(a.summary)}</p><span class="kb-ft"><span>${ic("clock", "xs")} ${num(a.minutes)} د</span><span>${ic("eye", "xs")} ${num(a.views)}</span><span>${h(a.license.label)}</span>${a.flagged ? badge("warn", "قيد المراجعة") : ""}</span></a></li>`;

  /* =================== #/knowledge =================== */
  async function hub() {
    const q = qs(), cat = q.get("category") || "", tag = q.get("tag") || "", text = q.get("q") || "", sort = q.get("sort") || "recent";
    page({ title: "المكتبة المعرفية", icon: "book", sub: "معرفة مفتوحة يكتبها الأعضاء ويراجعها مراجعون، بتراخيص المشاع الإبداعي.", actions: signed() ? `<a class="btn sm" href="#/knowledge/new">${ic("pen")}مقالة جديدة</a>` : "" }, `<div id="kb-b">${skel(5)}</div>`);
    const box = $("#kb-b");
    let d; try { d = await api("GET", `/api/knowledge?category=${enc(cat)}&tag=${enc(tag)}&q=${enc(text)}&sort=${enc(sort)}`); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const t = d.totals;
    const url = (o) => { const p = new URLSearchParams({ ...(cat && { category: cat }), ...(tag && { tag }), ...(text && { q: text }), ...(sort !== "recent" && { sort }), ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); const s = p.toString(); return "#/knowledge" + (s ? "?" + s : ""); };
    box.innerHTML = `<section class="f-cover"><h3>${num(t.articles)} مقالة من ${num(t.contributors)} مساهم</h3><small>${num(t.edits)} نسخة معتمدة · كل مقالة لها سجلّ نسخ كامل ويمكن لأي عضو اقتراح تحسينها.</small></section>
      <div class="kb-links">${signed() ? `<a class="btn ghost sm" href="#/knowledge/mine">${ic("doc")}مساهماتي</a>` : ""}${d.me.reviewer ? `<a class="btn ghost sm" href="#/knowledge/review">${ic("check")}المراجعة</a>` : ""}${d.me.staff ? `<a class="btn ghost sm" href="#/admin/knowledge">${ic("shield")}الإدارة</a>` : ""}</div>
      <form class="fx-q u-mb12" id="kb-sf" role="search"><label><span class="vh">ابحث في المكتبة</span><input type="search" name="q" value="${h(text)}" maxlength="80" placeholder="ابحث في العناوين والمحتوى والوسوم"></label></form>
      <ul class="f-chips" aria-label="التصنيفات"><li><a class="chip f" href="${url({ category: "" })}" ${!cat ? 'aria-current="true"' : ""}>الكل</a></li>${Object.entries(d.categories).filter(([k]) => d.counts[k]).map(([k, v]) => `<li><a class="chip f" href="${url({ category: k })}" ${cat === k ? 'aria-current="true"' : ""}>${h(v)} <span class="n">${num(d.counts[k])}</span></a></li>`).join("")}</ul>
      ${!text ? `<nav class="seg u-mb12" aria-label="الترتيب">${[["recent", "الأحدث"], ["popular", "الأكثر قراءة"], ["helpful", "الأكثر فائدة"]].map(([k, v]) => `<a href="${url({ sort: k === "recent" ? "" : k })}" ${sort === k ? 'aria-current="page"' : ""}>${h(v)}</a>`).join("")}</nav>` : ""}
      ${tag ? `<p class="kb-row">${ic("hash")}<span class="u-f1">الوسم <b>#${h(tag)}</b></span><a class="btn ghost sm" href="${url({ tag: "" })}">إزالة</a></p>` : ""}
      ${d.articles.length ? `<ul class="f-grid kb-grid">${d.articles.map(card).join("")}</ul>${d.more ? `<p class="u-mt12"><a class="btn ghost sm" href="${url({ page: String(d.page + 1) })}">المزيد</a></p>` : ""}`
        : UI.empty({ title: text || cat || tag ? "لا نتائج" : "المكتبة فارغة بعد", text: text ? "جرّب كلمات أخرى أو اكتب المقالة بنفسك." : "ابدأ أول مقالة؛ يراجعها فريق المراجعين ثم تُنشر للجميع.", action: signed() ? `<a class="btn" href="#/knowledge/new">${ic("pen")}اكتب مقالة</a>` : "" })}
      ${d.tags.length && !tag ? `<div class="f-h">وسوم شائعة</div><ul class="f-chips" aria-label="الوسوم">${d.tags.map((x) => `<li><a class="chip f" href="${url({ tag: x.tag })}">#${h(x.tag)} <span class="n">${num(x.count)}</span></a></li>`).join("")}</ul>` : ""}
      <p class="f-hint u-mt12">${ic("globe", "xs")} المحتوى متاح بتراخيص ${d.licenses.map((l) => `<a href="${h(l.url)}" target="_blank" rel="noopener noreferrer"><bdi>${h(l.label)}</bdi></a>`).join("، ")}.</p>`;
    $("#kb-sf").addEventListener("submit", (e) => { e.preventDefault(); location.hash = url({ q: e.target.q.value.trim(), page: "" }); });
  }

  /* =================== #/kb/:id =================== */
  async function articleView(aid) {
    page({ title: "المكتبة المعرفية", icon: "book", back: ["#/knowledge", "المكتبة"] }, `<div id="kb-a">${skel(6)}</div>`);
    const box = $("#kb-a");
    let d; try { d = await api("GET", "/api/knowledge/articles/" + enc(aid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const a = d.article, me = d.me;
    let toc = []; try { toc = RT() ? RT().toc(RT().parse(a.body)) : []; } catch { toc = []; }
    box.innerHTML = `<article class="kb-art" aria-labelledby="kb-t">
        <header class="kb-head"><span class="kb-cat">${h(a.category.label)}</span><h3 id="kb-t">${h(a.title)}</h3>${a.summary ? `<p class="kb-sum">${h(a.summary)}</p>` : ""}
          <p class="kb-meta"><span>${ic("clock", "xs")} ${num(a.minutes)} د قراءة</span><span>${ic("refresh", "xs")} حُدّثت ${h(day(a.updatedAt))}</span><span>${ic("eye", "xs")} ${num(a.views)}</span><a href="#/kb/${enc(a.id)}/history">${ic("doc", "xs")} النسخة ${num(a.rev)}</a></p>
          ${a.tags.length ? `<ul class="f-chips" aria-label="الوسوم">${a.tags.map((t) => `<li><a class="chip f" href="#/knowledge?tag=${enc(t)}">#${h(t)}</a></li>`).join("")}</ul>` : ""}</header>
        ${a.status !== "published" ? `<div class="notice">${ic("clock")}<span>${h(a.statusLabel)} — لا يراها غيرك وغير المراجعين حتى تُعتمد.</span></div>` : ""}
        ${a.flagged ? `<div class="notice warn">${ic("alert")}<span>أبلغ أعضاء عن هذه المقالة وهي قيد مراجعة الفريق؛ تحقّق من المعلومات بمصادرها.</span></div>` : ""}
        ${a.sensitive ? `<div class="notice">${ic("shield")}<span>مقالة للبالغين فقط.</span></div>` : ""}
        ${toc.length >= 3 ? `<nav class="card kb-toc" aria-label="المحتويات"><b>المحتويات</b><ol>${toc.slice(0, 20).map((x, i) => `<li class="${x.level === 3 && toc.some((y) => y.level === 2) ? "sub" : ""}"><a href="#/kb/${enc(a.id)}" data-to="${i}">${h(x.text)}</a></li>`).join("")}</ol></nav>` : ""}
        <div class="rich kb-body">${md(a.body)}</div>
        ${a.sources.length ? `<section class="kb-src"><div class="f-h">المصادر</div><ol>${a.sources.map((s) => `<li><a href="${h(s)}" target="_blank" rel="noopener noreferrer nofollow"><bdi>${h(s)}</bdi></a></li>`).join("")}</ol></section>` : ""}
        <section class="card kb-lic"><div class="kb-row">${ic("globe")}<span class="u-f1"><b>${h(a.license.label)} — ${h(a.license.name)}</b><small>يمكنك نسخها ومشاركتها وتعديلها وفق الترخيص مع نسبها إلى «${h(a.title)}» ومساهميها في مجتمع بلس.</small></span></div>
          <p class="kb-contrib"><b>المساهمون:</b> ${a.contributors.map((c) => `${who(c.user)} <small>(${num(c.edits)})</small>`).join("، ") || "—"}</p><a class="btn ghost sm u-mt8" href="${h(a.license.url)}" target="_blank" rel="noopener noreferrer">${ic("link")}نص الترخيص</a></section>
      </article>
      ${a.status === "published" ? `<section class="card kb-vote" aria-label="هل كانت المقالة مفيدة؟"><span class="u-f1 u-fw7">هل كانت مفيدة؟</span><button class="btn ${me.vote > 0 ? "" : "outline"} sm" type="button" data-v="1" aria-pressed="${me.vote > 0}" ${me.signedIn ? "" : "disabled"}>${ic("check")}نعم <bdi>${num(a.helpful.up)}</bdi></button><button class="btn ${me.vote < 0 ? "" : "outline"} sm" type="button" data-v="-1" aria-pressed="${me.vote < 0}" ${me.signedIn ? "" : "disabled"}>${ic("x")}لا <bdi>${num(a.helpful.down)}</bdi></button></section>` : ""}
      <div class="kb-acts">${me.canEdit ? (me.pendingEdit ? `<a class="btn outline sm" href="#/kb/rev/${enc(me.pendingEdit.id)}">${ic("clock")}تعديلك بانتظار المراجعة</a>` : `<a class="btn sm" href="#/kb/${enc(a.id)}/edit">${ic("pen")}اقترح تحسيناً</a>`) : !me.signedIn ? `<a class="btn outline sm" href="#/settings">سجّل الدخول لتساهم</a>` : ""}<a class="btn ghost sm" href="#/kb/${enc(a.id)}/history">${ic("doc")}سجلّ النسخ</a>${me.reviewer && me.pendingRevisions ? `<a class="btn ghost sm" href="#/knowledge/review">${ic("check")}${num(me.pendingRevisions)} بانتظار المراجعة</a>` : ""}</div>
      ${me.staff ? `<details class="card u-mt12"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("shield")} إجراءات الإدارة</summary><div class="kb-acts u-mt8">${a.status === "published" ? `<button class="btn ghost sm" type="button" data-mod="hide">إخفاء</button>` : `<button class="btn ghost sm" type="button" data-mod="restore">استعادة</button>`}<button class="btn ghost sm" type="button" data-mod="${a.sensitive ? "unsensitive" : "sensitive"}">${a.sensitive ? "إتاحة لليافعين" : "للبالغين فقط"}</button>${a.flagged ? `<button class="btn ghost sm" type="button" data-mod="unflag">رفع الإشارة</button>` : ""}</div></details>` : ""}
      ${me.canReport ? `<details class="card u-mt12"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("flag")} الإبلاغ عن المقالة</summary><form class="f-form u-mt8" id="kb-rp"><label>السبب<select name="reason" required><option value="">اختر…</option>${Object.entries(d.reasons).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></label><label>تفاصيل (اختياري)<textarea name="note" maxlength="600" rows="2" placeholder="ما الخطأ؟ وما المصدر الصحيح إن وُجد؟"></textarea></label><button class="btn outline" type="submit">إرسال البلاغ</button></form></details>` : ""}
      ${d.related.length ? `<div class="f-h">مقالات ذات صلة</div><ul class="f-grid kb-grid">${d.related.map(card).join("")}</ul>` : ""}`;
    box.querySelectorAll("[data-to]").forEach((x) => x.addEventListener("click", (e) => { e.preventDefault(); box.querySelectorAll(".kb-art .kb-body h2, .kb-art .kb-body h3")[Number(x.dataset.to)]?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    box.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { const cur = b.getAttribute("aria-pressed") === "true"; await api("POST", `/api/knowledge/articles/${enc(aid)}/vote`, { vote: cur ? 0 : Number(b.dataset.v) }); say(cur ? "أُلغي تقييمك" : "شكراً لتقييمك"); articleView(aid); })));
    box.querySelectorAll("[data-mod]").forEach((b) => b.addEventListener("click", () => { let reason; if (b.dataset.mod === "hide") { reason = prompt("سبب الإخفاء (يُسجَّل في سجل التدقيق)"); if (!reason || reason.trim().length < 3) return; } busy(b, async () => { await api("POST", "/api/admin/knowledge/articles/" + enc(aid), { action: b.dataset.mod, reason }); say("حُفظ"); articleView(aid); }); }));
    $("#kb-rp")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/knowledge/articles/${enc(aid)}/report`, { reason: e.target.reason.value, note: e.target.note.value.trim() || undefined }); say("وصل بلاغك للمراجعين"); e.target.closest("details").open = false; }); });
  }

  /* =================== editor: #/knowledge/new · #/kb/:id/edit =================== */
  const CATS = { science: "علوم", tech: "تقنية وبرمجة", islamic: "دراسات إسلامية", history: "تاريخ وحضارة", language: "لغة وأدب", health: "صحة", economy: "اقتصاد ومال", society: "مجتمع وثقافة", howto: "أدلة عملية", pi: "شبكة Pi", other: "أخرى" };
  const LIC = [["cc-by-sa-4.0", "CC BY-SA 4.0", "نسب المصنَّف — الترخيص بالمثل (يُنصح به: تبقى التعديلات مفتوحة)"], ["cc-by-4.0", "CC BY 4.0", "نسب المصنَّف"], ["cc0", "CC0 1.0", "إهداء للملك العام دون شروط"]];
  async function editor(aid) {
    const isNew = !aid;
    page({ title: isNew ? "مقالة جديدة" : "اقتراح تحسين", icon: "pen", back: isNew ? ["#/knowledge", "المكتبة"] : [`#/kb/${enc(aid)}`, "المقالة"] }, `<div id="kb-e">${skel(4)}</div>`);
    const box = $("#kb-e");
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول أولاً", text: "المساهمة متاحة لكل الأعضاء.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    let a = null; if (!isNew) { try { a = (await api("GET", "/api/knowledge/articles/" + enc(aid))).article; } catch (e) { box.innerHTML = errBox(e); return; } }
    if (!box.isConnected) return;
    box.innerHTML = `<div class="notice">${ic("help")}<span>${isNew ? "تُنشر المقالة بعد مراجعة أحد المراجعين. اكتب بلغة واضحة واذكر مصادرك." : `تعديلك على النسخة ${num(a.rev)} ويُعتمد بعد المراجعة؛ اذكر سبب التعديل.`}</span></div>
      <form class="card f-form" id="kb-f"><label>العنوان<input name="title" required minlength="4" maxlength="160" value="${h(a?.title || "")}"></label>
        <label>ملخّص في سطرين (اختياري)<textarea name="summary" maxlength="400" rows="2">${h(a?.summary || "")}</textarea></label>
        <div class="kb-two"><label>التصنيف<select name="category" required><option value="">اختر…</option>${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${a?.category?.key === k ? "selected" : ""}>${h(v)}</option>`).join("")}</select></label><label>الوسوم (افصل بفاصلة، حتى ٨)<input name="tags" maxlength="250" value="${h((a?.tags || []).join("، "))}"></label></div>
        <div class="kb-ed"><nav class="seg kb-tabs" aria-label="المحرّر"><a href="#/knowledge" data-tab="w" aria-current="page">كتابة</a><a href="#/knowledge" data-tab="p">معاينة</a></nav>
          <label id="kb-w">المحتوى<textarea name="body" required minlength="200" maxlength="60000" rows="16" dir="auto">${h(a?.body || "")}</textarea><small class="f-hint">التنسيق: ## عنوان قسم، - بند، **غامق**، *مائل*، [نص](https://رابط)، > اقتباس.</small></label>
          <div id="kb-p" class="rich kb-body card" hidden aria-live="polite"></div></div>
        <label>المصادر (رابط في كل سطر، حتى ١٢)<textarea name="sources" rows="3" maxlength="4000" dir="ltr" placeholder="https://">${h((a?.sources || []).join("\n"))}</textarea></label>
        ${isNew ? `<fieldset class="kb-lics"><legend>الترخيص المفتوح</legend>${LIC.map(([k, l, t], i) => `<label class="chk u-dflex u-aic u-g8 u-mh44"><input type="radio" name="license" value="${k}" ${i === 0 ? "checked" : ""}> <span><b>${h(l)}</b> <small>${h(t)}</small></span></label>`).join("")}</fieldset>`
          : `<label>سبب التعديل<input name="note" required minlength="3" maxlength="300" placeholder="مثال: تصحيح تاريخ، إضافة مصدر"></label><p class="f-hint">${ic("globe", "xs")} يُنشر تعديلك بترخيص المقالة: ${h(a.license.label)}.</p>`}
        <label class="chk u-dflex u-aic u-g8 u-mh44"><input type="checkbox" name="agree" required> أؤكد أن المساهمة من كتابتي أو منسوبة لمصادرها، وأوافق على نشرها بالترخيص المذكور</label>
        <button class="btn" type="submit">${ic("send")}${isNew ? "إرسال للمراجعة" : "إرسال التعديل"}</button></form>`;
    const f = $("#kb-f");
    box.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", (e) => { e.preventDefault(); const p = t.dataset.tab === "p"; box.querySelectorAll("[data-tab]").forEach((x) => (x === t ? x.setAttribute("aria-current", "page") : x.removeAttribute("aria-current"))); $("#kb-w").hidden = p; const pv = $("#kb-p"); pv.hidden = !p; if (p) pv.innerHTML = f.body.value.trim() ? md(f.body.value) : `<p class="f-hint">لا محتوى بعد.</p>`; }));
    f.addEventListener("submit", (e) => { e.preventDefault();
      const body = { title: f.title.value.trim(), summary: f.summary.value.trim() || undefined, category: f.category.value, tags: f.tags.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean), body: f.body.value, sources: f.sources.value.split(/\s+/).filter(Boolean), agree: f.agree.checked };
      if (isNew) body.license = f.querySelector("[name=license]:checked")?.value; else { body.note = f.note.value.trim(); body.base = a.rev; }
      busy(e.submitter, async () => {
        const r = isNew ? await api("POST", "/api/knowledge", body) : await api("POST", `/api/knowledge/articles/${enc(aid)}/edits`, body);
        if (isNew) { say(r.state === "published" ? "نُشرت المقالة" : "أُرسلت المقالة للمراجعة"); location.hash = "#/kb/" + enc(r.id); }
        else { say(r.state === "approved" ? "اعتُمد تعديلك" : "أُرسل تعديلك للمراجعة"); location.hash = r.state === "approved" ? "#/kb/" + enc(aid) : "#/kb/rev/" + enc(r.revision); }
      }); });
  }

  /* =================== history + one version =================== */
  async function historyView(aid) {
    page({ title: "سجلّ النسخ", icon: "doc", back: [`#/kb/${enc(aid)}`, "المقالة"] }, `<div id="kb-hi">${skel(4)}</div>`);
    const box = $("#kb-hi");
    let d; try { d = await api("GET", `/api/knowledge/articles/${enc(aid)}/history`); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    box.innerHTML = `<section class="f-cover"><h3>${h(d.article.title)}</h3><small>${num(d.revisions.filter((r) => r.status === "approved").length)} نسخة معتمدة · ${h(d.article.license.label)}</small></section>
      <ol class="list kb-hist">${d.revisions.map((r) => `<li><div class="li">${ic(r.status === "pending" ? "clock" : r.current ? "check" : "doc")}<a class="t u-tdn" href="#/kb/rev/${enc(r.id)}"><b>${r.n ? `النسخة ${num(r.n)}` : "مقترحة"} · ${h(r.note || "—")}</b><small>${who(r.author).replace(/<a [^>]*>|<\/a>/g, "")} · ${h(day(r.at))} · ${delta(r.size)} حرف</small></a>${r.current ? badge("ok", "الحالية") : r.status === "pending" ? badge("warn", r.statusLabel) : d.me.reviewer ? `<button class="btn ghost sm" type="button" data-rv="${r.n}">استرجاع</button>` : ""}</div></li>`).join("")}</ol>`;
    box.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => { if (!confirm(`استرجاع النسخة ${b.dataset.rv}؟ تُضاف نسخة جديدة ولا يُحذف شيء.`)) return; busy(b, async () => { await api("POST", `/api/knowledge/articles/${enc(aid)}/revert`, { n: Number(b.dataset.rv) }); say("استُرجعت النسخة"); historyView(aid); }); }));
  }
  async function revisionView(rid) {
    page({ title: "نسخة", icon: "doc", back: ["#/knowledge", "المكتبة"] }, `<div id="kb-r">${skel(4)}</div>`);
    const box = $("#kb-r");
    let d; try { d = await api("GET", "/api/knowledge/revisions/" + enc(rid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const r = d.revision, a = d.article, df = d.diff;
    box.innerHTML = `<p><a class="u-fw7 u-mh44 u-dflex u-aic" href="#/kb/${enc(a.id)}"><span aria-hidden="true">→</span>&nbsp;${h(a.title)}</a></p>
      <section class="card"><div class="kb-row">${ic(r.status === "approved" ? "check" : r.status === "pending" ? "clock" : "x")}<span class="u-f1"><b>${r.n ? `النسخة ${num(r.n)}` : `تعديل مقترح على النسخة ${num(r.base)}`}</b><small>${who(r.author).replace(/<a [^>]*>|<\/a>/g, "")} · ${h(day(r.at))} · ${h(r.note || "")}</small></span>${badge(TONE[r.status], r.statusLabel)}</div>
        ${r.reason ? `<p class="f-hint">${ic("help", "xs")} ملاحظة المراجع: ${h(r.reason)}</p>` : ""}${r.stale ? `<div class="notice warn u-mt8">${ic("alert")}<span>كُتب هذا التعديل على نسخة أقدم من الحالية (${num(a.rev)})؛ لا يمكن اعتماده كما هو.</span></div>` : ""}
        ${r.status === "pending" && d.me.reviewer ? `<div class="kb-acts u-mt8">${r.stale ? "" : `<button class="btn sm" type="button" id="kb-ok">${ic("check")}اعتماد</button>`}<button class="btn ghost sm" type="button" id="kb-no">رفض مع ملاحظة</button></div>` : r.status === "pending" && d.me.own ? `<button class="btn ghost sm u-mt8" type="button" id="kb-wd">سحب التعديل</button>` : ""}</section>
      <div class="f-h">التغييرات <small class="kb-dsum">${delta(df.added)} سطر مضاف · <bdi class="kb-d ${df.removed ? "dn" : ""}">${df.removed ? "−" : ""}${num(df.removed)}</bdi> سطر محذوف</small></div>
      <div class="kb-diff" aria-label="الفروق بين النسختين">${df.ops.map((o) => `<div class="kb-l ${o.op === "+" ? "add" : o.op === "-" ? "del" : o.op === "~" ? "gap" : ""}"><span class="kb-op" aria-hidden="true">${o.op === "=" ? "" : o.op === "~" ? "…" : o.op === "-" ? "−" : "+"}</span>${o.op === "+" ? '<span class="vh">مضاف: </span>' : o.op === "-" ? '<span class="vh">محذوف: </span>' : ""}<span class="kb-lt" dir="auto">${h(o.t) || "&nbsp;"}</span></div>`).join("")}</div>
      <details class="card u-mt12"><summary class="u-mh44 u-dflex u-aic u-g8 u-fw7 u-cp">${ic("eye")} عرض النسخة كاملة</summary><h3>${h(r.title)}</h3>${r.summary ? `<p class="kb-sum">${h(r.summary)}</p>` : ""}<div class="rich kb-body">${md(r.body)}</div></details>`;
    $("#kb-ok")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("POST", `/api/knowledge/revisions/${enc(rid)}/approve`, {}); say("اعتُمدت النسخة"); revisionView(rid); }));
    $("#kb-no")?.addEventListener("click", (e) => { const reason = prompt("ملاحظة للمساهم: لماذا رُفض التعديل؟"); if (!reason || reason.trim().length < 3) return; busy(e.currentTarget, async () => { await api("POST", `/api/knowledge/revisions/${enc(rid)}/reject`, { reason }); say("رُفض التعديل"); revisionView(rid); }); });
    $("#kb-wd")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("POST", `/api/knowledge/revisions/${enc(rid)}/withdraw`); say("سُحب التعديل"); revisionView(rid); }));
  }

  /* =================== review queue · mine · admin =================== */
  async function reviewView() {
    page({ title: "مراجعة المكتبة", icon: "check", back: ["#/knowledge", "المكتبة"] }, `<div id="kb-q">${skel(4)}</div>`);
    const box = $("#kb-q");
    let d; try { d = await api("GET", "/api/knowledge/review"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    box.innerHTML = `<div class="f-kpis"><div class="kpi-tile"><b>${num(d.revisions.length)}</b><span>نسخة بانتظار المراجعة</span></div><div class="kpi-tile"><b>${num(d.reports.length)}</b><span>بلاغ مفتوح</span></div></div>
      <div class="f-h">النسخ المقترحة</div>${d.revisions.length ? `<ul class="list">${d.revisions.map((r) => `<li><a class="li" href="#/kb/rev/${enc(r.id)}">${ic(r.article.isNew ? "pen" : "doc")}<span class="t"><b>${h(r.article.isNew ? r.title : r.article.title)}</b><small>${r.article.isNew ? "مقالة جديدة" : h(r.note)} · ${h(r.author?.name || "")} · ${h(day(r.at))} · ${delta(r.size)}</small></span><span class="kb-amt">${r.stale ? badge("warn", "على نسخة قديمة") : ""}${r.minor ? badge("info", "يافع") : ""}</span></a></li>`).join("")}</ul>` : UI.empty({ title: "لا شيء بانتظار المراجعة" })}
      <div class="f-h">البلاغات</div>${d.reports.length ? `<ul class="list">${d.reports.map((r) => `<li><div class="li">${ic("flag")}<a class="t u-tdn" href="#/kb/${enc(r.article.id)}"><b>${h(r.reason)}${r.article.flagged ? " · مُشار إليها" : ""}</b><small>${h(r.article.title)}${r.note ? " · " + h(r.note) : ""}</small></a><span class="kb-acts"><button class="btn ghost sm" type="button" data-rp="${h(r.id)}" data-act="dismiss">رفض</button><button class="btn sm" type="button" data-rp="${h(r.id)}" data-act="action">عولج</button></span></div></li>`).join("")}</ul>` : UI.empty({ title: "لا بلاغات مفتوحة" })}`;
    box.querySelectorAll("[data-rp]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", "/api/knowledge/reports/" + enc(b.dataset.rp), { action: b.dataset.act }); reviewView(); })));
  }
  async function mineView() {
    page({ title: "مساهماتي في المكتبة", icon: "doc", back: ["#/knowledge", "المكتبة"] }, `<div id="kb-m">${skel(4)}</div>`);
    const box = $("#kb-m");
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    let d; try { d = await api("GET", "/api/knowledge/me"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    box.innerHTML = `<div class="f-kpis"><div class="kpi-tile"><b>${num(d.articles.length)}</b><span>مقالة بدأتها</span></div><div class="kpi-tile"><b>${num(d.approved)}</b><span>مساهمة معتمدة</span></div></div>
      <div class="f-h">مقالاتي</div>${d.articles.length ? `<ul class="list">${d.articles.map((a) => `<li><a class="li" href="#/kb/${enc(a.id)}">${ic("book")}<span class="t"><b>${h(a.title)}</b><small>${h(a.category.label)} · ${h(day(a.updatedAt))}</small></span>${badge(TONE[a.status], a.statusLabel)}</a></li>`).join("")}</ul>` : UI.empty({ title: "لم تبدأ مقالات بعد", action: `<a class="btn" href="#/knowledge/new">${ic("pen")}اكتب مقالة</a>` })}
      <div class="f-h">كل مساهماتي</div>${d.revisions.length ? `<ul class="list">${d.revisions.map((r) => `<li><a class="li" href="#/kb/rev/${enc(r.id)}">${ic(r.status === "approved" ? "check" : r.status === "pending" ? "clock" : "doc")}<span class="t"><b>${h(r.article.title)}</b><small>${h(r.note)}${r.reason ? " · " + h(r.reason) : ""} · ${h(day(r.at))}</small></span>${badge(TONE[r.status], r.statusLabel)}</a></li>`).join("")}</ul>` : ""}`;
  }
  async function adminView() {
    if (!isAdmin()) { page({ title: "المكتبة — الإدارة", back: ["#/knowledge", "المكتبة"] }, UI.empty({ title: "للإدارة فقط" })); return; }
    page({ title: "المكتبة المعرفية — الإدارة", icon: "shield", back: ["#/admin", "الإدارة"] }, `<div id="kb-ad">${skel(3)}</div>`);
    const box = $("#kb-ad");
    let d; try { d = await api("GET", "/api/admin/knowledge"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const t = d.totals;
    box.innerHTML = `<div class="f-kpis"><div class="kpi-tile"><b>${num(t.published)}</b><span>مقالة منشورة</span></div><div class="kpi-tile"><b>${num(t.pending)}</b><span>نسخة بانتظار المراجعة</span></div><div class="kpi-tile"><b>${num(t.reports)}</b><span>بلاغ مفتوح</span></div><div class="kpi-tile"><b>${num(t.reviewers)}</b><span>مراجع</span></div></div>
      <p><a class="btn outline sm" href="#/knowledge/review">${ic("check")}قائمة المراجعة</a></p>
      <div class="f-h">المراجعون</div>${d.reviewers.length ? `<ul class="list">${d.reviewers.map((r) => `<li><div class="li">${ic("user")}<span class="t"><b>${h(r.name)}</b><small>@${h(r.handle)} · منذ ${h(day(r.since))}</small></span><button class="btn ghost sm" type="button" data-rm="${h(r.handle)}">إزالة</button></div></li>`).join("")}</ul>` : `<p class="f-hint">لا مراجعين بعد؛ أضف أعضاء موثوقين بالمعرّف.</p>`}
      <form class="card f-form" id="kb-addr"><label>إضافة مراجع (من البالغين)<input name="handle" required maxlength="40" placeholder="@handle" dir="ltr"></label><button class="btn outline" type="submit">إضافة</button></form>
      <div class="f-h">مقالات تحت الإدارة</div>${d.articles.length ? `<ul class="list">${d.articles.map((a) => `<li><a class="li" href="#/kb/${enc(a.id)}">${ic("book")}<span class="t"><b>${h(a.title)}</b><small>${a.reason ? h(a.reason) + " · " : ""}${a.sensitive ? "للبالغين · " : ""}${a.flagged ? "مُشار إليها · " : ""}${h(day(a.updatedAt))}</small></span>${badge(TONE[a.status], a.statusLabel)}</a></li>`).join("")}</ul>` : UI.empty({ title: "لا مقالات مخفية أو مُشار إليها" })}`;
    $("#kb-addr").addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", "/api/admin/knowledge/reviewers", { handle: e.target.handle.value.trim() }); say("أُضيف المراجع"); adminView(); }); });
    box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", "/api/admin/knowledge/reviewers", { handle: b.dataset.rm, remove: true }); adminView(); })));
  }

  MPRoutes.extend((a, b, base) => {
    return { knowledge: () => (a === "new" ? editor(null) : a === "review" ? reviewView() : a === "mine" ? mineView() : hub()),
      kb: () => (a === "rev" && b ? revisionView(b) : a && b === "edit" ? editor(a) : a && b === "history" ? historyView(a) : a ? articleView(a) : hub()) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "knowledge" ? adminView() : next()));
  window.MPKnowledge = { hub, articleView, editor, historyView, revisionView, reviewView, mineView, adminView, version: "__APP_VERSION__" };
  if (/^#\/(knowledge|kb|admin\/knowledge)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
