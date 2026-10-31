/* =====================================================================
 * مجتمع بلس — Phase 58 UI: digital products store (lazy "digital" chunk; 0 bytes in core). Extends the market (phase 39):
 *   #/digital               store: type chips, search, sell / my sales / my purchases
 *   #/digital/p/:id         product page: cover, files (names + sizes), preview + sample, refund policy, buy (market order →
 *                           MPPi.pay purpose "market"), report (copyright / abuse)
 *   #/digital/new, #/digital/edit/:id   seller form: cover images (/api/media), deliverables + preview (/api/digital/files)
 *   #/digital/sales         creator stats (per product, 30 days) + license keys
 *   #/purchases             «مشترياتي»: expiring download links, downloads left, license key, refund per policy
 *   #/admin/digital         abuse / copyright reports: takedown (± revoke downloads) or dismiss
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function DigitalUI() {
  if (window.MPDigital) return;
  const api = (m, p, b, raw) => Remote.api(m, p, b, raw);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const amt = (x) => `<bdi dir="ltr">${Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: 7 })} π</bdi>`;
  const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(iso)); } catch { return String(iso); } };
  const safe = (u) => (typeof u === "string" && /^\/(?!\/)/.test(u) ? u : "");
  const $ = (s) => view.querySelector(s);
  const page = (title, body, back, icon, actions) => { view.innerHTML = `<div class="wrap dg-page">${UI.pageHead({ back, title, icon, actions, id: "dg-h" })}${body}</div>`; $("#dg-h")?.focus({ preventScroll: true }); };
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const ICON = { ebook: "book", template: "grid", course: "cap", file: "box" }, ico = (t, c = "sm") => (ICON[t] ? MPFeat.ico(ICON[t], c) : "");
  let CFG = null;
  const cfg = async () => (CFG ||= await api("GET", "/api/digital/config"));
  if (!document.getElementById("dg-css")) document.head.insertAdjacentHTML("beforeend", `<style id="dg-css">
.dg-page{max-width:720px;margin:auto}.dg-page section .empty{padding:24px 16px}.dg-page section .empty::before{width:72px;height:58px;margin-bottom:8px}.dg-it{padding:12px;margin-bottom:10px}.dg-sp{justify-content:space-between}.dg-sm{font-size:var(--fs-sm)}.dg-page h2:focus{outline:none}.dg-bar{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.dg-bar .btn,.dg-bar a.btn{min-height:44px}

.dg-card .im{aspect-ratio:4/3;background:var(--surface-sunken) center/cover no-repeat}.dg-card .b{padding:10px 12px;display:grid;gap:2px}.dg-card .p{font-weight:700;color:var(--accent-ink)}.dg-card .t{font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dg-hero{border-radius:16px;aspect-ratio:16/9;background:#8881 center/cover no-repeat;margin-bottom:10px}.dg-files{list-style:none;padding:0;margin:8px 0}.dg-files li{display:flex;gap:8px;align-items:center;padding:10px;border-bottom:1px solid var(--line,#eee)}.dg-files .g{flex:1;min-width:0;word-break:break-word}
.dg-note{padding:10px 12px;border-radius:12px;background:#8881;font-size:14px;margin:8px 0}.dg-buy{width:100%;min-height:52px;font-size:var(--fs-lg)}.dg-key{font-family:ui-monospace,monospace;direction:ltr;user-select:all;padding:4px 8px;border-radius:8px;background:#8882}
.dg-f label{display:block;margin-top:10px}.dg-f input:not([type=checkbox]),.dg-f select,.dg-f textarea{width:100%;min-height:44px;box-sizing:border-box}.dg-f textarea{min-height:90px}
.dg-t{width:100%;border-collapse:collapse;font-size:14px}.dg-t th,.dg-t td{padding:8px 6px;border-bottom:1px solid var(--line,#eee);text-align:start}
</style>`);

  /* ---------- #/digital ---------- */
  const Q = { type: "", q: "" };
  async function storeView() {
    page("المنتجات الرقمية", `<form id="dg-s" class="fx-host" role="search"><input type="search" name="q" value="${h(Q.q)}" placeholder="ابحث عن كتاب أو قالب أو دورة" aria-label="بحث"><button class="btn">بحث</button></form><div class="f-chips" id="dg-ch"></div><div id="dg-list"><div class="skel"></div></div>`, ["#/market", "السوق"], "bag",
      `<a class="btn" href="#/digital/new">${UI.icon("plus", "sm")} بيع منتج رقمي</a><a class="btn outline" href="#/purchases">مشترياتي</a><a class="btn outline" href="#/digital/sales">${UI.icon("chart", "sm")} مبيعاتي</a>`);
    $("#dg-s").addEventListener("submit", (e) => { e.preventDefault(); Q.q = e.target.q.value.trim(); storeView(); });
    let d; try { d = await api("GET", `/api/digital/store?type=${enc(Q.type)}&q=${enc(Q.q)}`); } catch (e) { if ($("#dg-list")) $("#dg-list").innerHTML = errBox(e); return; }
    if (!$("#dg-ch") || !$("#dg-list")) return; // left the store while loading (or a newer render replaced it)
    $("#dg-ch").innerHTML = [{ key: "", label: "الكل" }, ...d.types].map((t) => `<a href="#/digital" class="chip f" data-t="${h(t.key)}"${Q.type === t.key ? ' aria-current="true"' : ""}>${ico(t.key)}${h(t.label)}</a>`).join("");
    view.querySelectorAll("[data-t]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); Q.type = a.dataset.t; storeView(); }));
    $("#dg-list").innerHTML = (d.enabled ? "" : `<div class="notice dg-note" role="status">${UI.icon("wallet")}<div>${h(d.note)}</div></div>`) + (d.items.length ? `<div class="dg-grid f-grid">${d.items.map((x) => `<a class="dg-card f-card" href="#/digital/p/${enc(x.id)}"><div class="im" style="background-image:url('${h(safe(x.cover?.thumb || x.cover?.url))}')"></div><div class="b"><div class="t">${h(x.title)}</div><div class="p">${amt(x.price)}</div><div class="muted dg-sm">${ico(x.type)}${h(x.typeLabel)} · @${h(x.seller?.handle || "")}</div></div></a>`).join("")}</div>` : UI.empty({ title: `لا منتجات بعد${Q.q || Q.type ? " بهذا البحث" : ""}`, text: Q.q || Q.type ? "جرّب كلمة أخرى أو اختر «الكل»." : "كن أول من يبيع كتاباً أو قالباً أو دورة." }));
  }

  /* ---------- #/digital/p/:id ---------- */
  async function productView(lid) {
    page("المنتج", `<div class="skel"></div><div class="skel"></div>`, ["#/digital", "المنتجات الرقمية"]);
    let d; try { d = await api("GET", "/api/digital/products/" + enc(lid)); } catch (e) { view.querySelectorAll(".skel").forEach((x) => x.remove()); $(".wrap").insertAdjacentHTML("beforeend", errBox(e)); return; }
    view.querySelectorAll(".skel").forEach((x) => x.remove());
    const L = d.listing, P = d.product, mine = L.mine;
    $("#dg-h").textContent = L.title;
    const why = { owned: "اشتريت هذا المنتج — تجده في «مشترياتي»", sign_in: "سجّل الدخول للشراء", own_listing: "هذا منتجك", minor_restricted: "غير متاح لمن هم دون ١٨ سنة", not_configured: "الشراء يعمل فور تفعيل مدفوعات Pi", unavailable: "المنتج غير متاح" };
    $(".wrap").insertAdjacentHTML("beforeend", `<div class="dg-hero" role="img" aria-label="${h(L.images?.[0]?.alt || L.title)}" style="background-image:url('${h(safe(L.images?.[0]?.url))}')"></div>
      <div class="u-jsb u-aic dg-bar"><b class="u-t-2xl">${amt(L.price)}</b><span class="muted">${ico(P.type)}${h(P.typeLabel)} · <a href="#/market/seller/${enc(L.seller?.handle || "")}">@${h(L.seller?.handle || "")}</a></span></div>
      ${L.canBuy ? `<button type="button" class="btn dg-buy" id="dg-buy">اشترِ الآن — تسليم فوري</button>` : `<button type="button" class="btn dg-buy" disabled aria-describedby="dg-why">${d.owned ? "تملكه" : "الشراء غير متاح"}</button><p class="muted" id="dg-why">${h(why[L.buyReason] || "")}</p>`}
      ${d.owned ? `<a class="u-db u-tc u-mt8 btn ghost" href="#/purchases">افتح «مشترياتي»</a>` : ""}
      <p class="u-pre">${h(L.description)}</p>
      <h3>المحتوى</h3><ul class="dg-files">${P.files.map((f) => `<li>${MPFeat.ico("doc")}<span class="g">${h(f.name)}</span><span class="muted" dir="ltr">${size(f.size)}</span></li>`).join("")}</ul>
      ${P.preview ? `<p><a class="btn ghost" href="${h(safe(P.preview))}" target="_blank" rel="noopener">عرض المعاينة</a></p>` : ""}
      ${P.sampleText ? `<details class="dg-note"><summary>عيّنة مجانية</summary><p class="u-pre">${h(P.sampleText)}</p></details>` : ""}
      <div class="dg-note">︎ ${h(P.refundPolicyText)}<br>${UI.icon("download","sm")} حتى ${P.downloadLimit} مرات تنزيل${P.license ? "<br>يأتي مع مفتاح ترخيص" : ""}</div>
      ${mine ? `<div class="dg-bar"><a class="btn" href="#/digital/edit/${enc(L.id)}">تعديل</a><a class="btn ghost" href="#/digital/sales">المبيعات</a></div>` : `<button type="button" class="btn ghost" id="dg-rep">إبلاغ عن المنتج</button>`}`);
    $("#dg-buy")?.addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { });
        if (!window.MPPi) throw new Error("تعذّر تحميل مدفوعات Pi");
        let order = null;
        await window.MPPi.pay({ amount: L.price, memo: `السوق: ${L.title}`.slice(0, 120), purpose: "market", refId: L.id, intent: async () => { const r = await api("POST", `/api/market/listings/${enc(L.id)}/order`, {}); order = r.order; return r.intent; } });
        say("تم الدفع — المنتج في «مشترياتي» ✓"); location.hash = "#/purchases";
        return order;
      } catch (x) { say(x.message); b.disabled = false; }
    });
    $("#dg-rep")?.addEventListener("click", async () => {
      const c = await cfg().catch(() => ({ reportReasons: [] }));
      if (typeof sheet !== "function") return;
      sheet(`<form id="dg-rf" class="dg-f"><h4 class="u-mt0">إبلاغ عن «${h(L.title)}»</h4><label>السبب<select name="r">${c.reportReasons.map((r) => `<option value="${h(r.key)}">${h(r.label)}</option>`).join("")}</select></label><label>تفاصيل (لبلاغات حقوق النشر: رابط عملك الأصلي)<textarea name="d" maxlength="2000"></textarea></label><button class="u-w100 u-mh48 u-mt10 btn">إرسال البلاغ</button></form>`);
      document.getElementById("dg-rf").addEventListener("submit", async (e) => { e.preventDefault(); try { const r = await api("POST", `/api/digital/products/${enc(L.id)}/report`, { reason: e.target.r.value, details: e.target.d.value || null }); closeSheet?.(); say(r.note); } catch (x) { say(x.message); } });
    });
  }

  /* ---------- #/digital/new, #/digital/edit/:id ---------- */
  async function formView(lid) {
    page(lid ? "تعديل المنتج الرقمي" : "بيع منتج رقمي", `<div class="skel"></div>`, ["#/digital", "المنتجات الرقمية"]);
    const W0 = $(".wrap"); let c, cur = null, mine;
    try { [c, mine] = await Promise.all([cfg(), api("GET", "/api/me/digital/files")]); if (lid) cur = await api("GET", "/api/digital/products/" + enc(lid)); } catch (e) { if (W0?.isConnected) $(".skel").outerHTML = errBox(e); return; }
    if (!W0?.isConnected) return; // a newer render replaced this view while we waited
    $(".skel")?.remove();
    if (!c.enabled) { W0.insertAdjacentHTML("beforeend", `<div class="notice warn dg-note" role="status">${UI.icon("wallet")}<div>${h(c.note)}</div></div>`); return; }
    const L = cur?.listing || {}, P = cur?.product || {};
    const st = { images: (L.images || []).map((i) => i.id), files: P.fileIds || [], preview: P.previewFile || null, all: mine.files };
    $(".wrap").insertAdjacentHTML("beforeend", `<form id="dg-f" class="dg-f" novalidate>
      <label>العنوان<input name="title" required minlength="3" maxlength="120" value="${h(L.title || "")}"></label>
      <label>الوصف<textarea name="description" maxlength="5000">${h(L.description || "")}</textarea></label>
      <label>السعر (π)<input name="price" type="number" step="any" min="0.01" required value="${L.price ?? ""}"></label>
      <label>النوع<select name="type">${c.types.map((t) => `<option value="${h(t.key)}"${P.type === t.key ? " selected" : ""}>${h(t.label)}</option>`).join("")}</select></label>
      <label>صورة الغلاف (صورة إلى ٨)<input type="file" accept="image/*" multiple id="dg-img"></label><div class="muted" id="dg-imgs"></div>
      <label>ملفات المنتج (PDF، ZIP، EPUB، قوالب Office، صور، MP3، MP4 — حتى ${c.limits.maxFileMb} MB للملف)<input type="file" multiple id="dg-up"></label><ul class="dg-files" id="dg-fl"></ul>
      <label>ملف معاينة عام (اختياري)<input type="file" id="dg-pv"></label><div class="muted" id="dg-pvn"></div>
      <label>عيّنة نصية مجانية (اختياري)<textarea name="sample" maxlength="4000">${h(P.sampleText || "")}</textarea></label>
      <label class="u-dflex u-g8 u-aic"><input type="checkbox" name="license"${P.license ? " checked" : ""}> مفتاح ترخيص لكل مشترٍ</label>
      <label>عدد مرات التنزيل لكل مشترٍ<input name="dl" type="number" min="1" max="${c.limits.downloadLimit.max}" value="${P.downloadLimit || c.limits.downloadLimit.default}"></label>
      <label>سياسة الاسترداد<select name="policy">${c.refundPolicies.map((p) => `<option value="${h(p.key)}"${(P.refundPolicy || "undownloaded") === p.key ? " selected" : ""}>${h(p.label)}</option>`).join("")}</select></label>
      <p class="u-t-sm muted">رسوم المنصة ${c.feePct}٪ · يُحفظ المبلغ في الضمان ويُفرج عنه بعد تأكيد المشتري أو تلقائياً. ارفع فقط ما تملك حقوقه.</p>
      <p role="alert" id="dg-err" style="color:var(--danger,#b91c1c)"></p><button class="u-w100 u-mh52 btn">${lid ? "حفظ" : "نشر المنتج"}</button></form>`);
    const draw = () => {
      $("#dg-imgs").textContent = st.images.length ? `${st.images.length} صورة مرفوعة` : "لم تُرفع صورة بعد";
      $("#dg-fl").innerHTML = st.all.filter((f) => f.role === "file").map((f) => `<li><input type="checkbox" data-f="${h(f.id)}"${st.files.includes(f.id) ? " checked" : ""} aria-label="تضمين ${h(f.name)}"><span class="g">${h(f.name)}</span><span class="muted" dir="ltr">${size(f.size)}</span></li>`).join("") || `<li class="muted">لا ملفات بعد</li>`;
      view.querySelectorAll("[data-f]").forEach((x) => x.addEventListener("change", () => { st.files = x.checked ? [...new Set([...st.files, x.dataset.f])] : st.files.filter((i) => i !== x.dataset.f); }));
      $("#dg-pvn").textContent = st.preview ? "ملف معاينة مرفق ✓" : "";
    };
    draw();
    const err = (m) => { $("#dg-err").textContent = m || ""; };
    $("#dg-img").addEventListener("change", async (e) => { for (const f of e.target.files) { try { st.images.push((await api("POST", "/api/media", null, f)).media.id); } catch (x) { err(x.message); } } draw(); });
    const upFile = async (f, role) => (await api("POST", `/api/digital/files?name=${enc(f.name)}${role ? "&role=" + role : ""}`, null, f)).file;
    $("#dg-up").addEventListener("change", async (e) => { for (const f of e.target.files) { try { const x = await upFile(f); st.all.unshift(x); st.files.push(x.id); } catch (er) { err(`«${f.name}»: ${er.message}`); } } draw(); });
    $("#dg-pv").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { const x = await upFile(f, "preview"); st.preview = x.id; } catch (er) { err(er.message); } draw(); });
    $("#dg-f").addEventListener("submit", async (e) => {
      e.preventDefault(); err(); const f = e.target;
      const body = { title: f.title.value.trim(), description: f.description.value, price: Number(f.price.value), type: f.type.value, files: st.files, previewFile: st.preview, sampleText: f.sample.value || null, license: f.license.checked, downloadLimit: Number(f.dl.value), refundPolicy: f.policy.value };
      if (!lid || st.images.length) body.images = st.images;
      try { const r = await api(lid ? "PATCH" : "POST", lid ? "/api/digital/products/" + enc(lid) : "/api/digital/products", body); say("حُفظ ✓"); location.hash = "#/digital/p/" + enc(r.listing.id); } catch (x) { err(x.message); }
    });
  }

  /* ---------- #/purchases: «مشترياتي» hub (v2.33) ----------
   * One page for everything bought: paid posts (filled by the paid chunk, MPPaid.purchases(host)) and digital products.
   * #/me/purchases (paid chunk) and notification links (/#/purchases) both land here. */
  async function libraryView() {
    const tok = (view._pu = { h: location.hash });
    view.innerHTML = `<div class="wrap dg-page pd-page">${UI.pageHead({ back: ["#/me", "حسابي"], title: "مشترياتي", sub: "المحتوى المدفوع الذي فتحته والمنتجات الرقمية التي اشتريتها.", id: "pd-h" })}
      <section aria-labelledby="pu-h1"><h3 class="set-h" id="pu-h1">المحتوى المدفوع</h3><div id="pd-sec"><div class="skel"></div></div></section>
      <section aria-labelledby="pu-h2"><h3 class="set-h" id="pu-h2">المنتجات الرقمية</h3><div id="dg-lib" aria-busy="true"><div class="skel"></div></div></section></div>`;
    view.querySelector("#pd-h")?.focus({ preventScroll: true });
    libraryInto(view.querySelector("#dg-lib"), tok);
    try { if (!window.MPPaid && window.MPChunks) { await MPChunks.load("tips"); await MPChunks.load("paid"); } } catch { /* paid section shows its fallback */ }
    const box = view._pu === tok && view.querySelector("#pd-sec"); if (!box) return;
    if (window.MPPaid?.purchases) MPPaid.purchases(box); else box.innerHTML = `<div class="card">${UI.empty({ title: "تعذّر تحميل المحتوى المدفوع", text: "أعد فتح الصفحة بعد قليل." })}</div>`;
  }
  async function libraryInto(host, tok) {
    let d; try { d = await api("GET", "/api/me/digital/library"); } catch (e) { if (host.isConnected) host.outerHTML = errBox(e); return; }
    if (view._pu !== tok || !host.isConnected) return;
    host.removeAttribute("aria-busy");
    const ST = { active: "", refunded: "مسترد", revoked: "أُوقف بقرار من الإشراف", unavailable: "غير متاح" };
    host.innerHTML = d.items.map((it) => `<section class="card dg-it" aria-label="${h(it.title)}"><div class="dg-bar dg-sp"><b><a href="#/digital/p/${enc(it.listingId)}">${h(it.title)}</a></b><span class="muted">${day(it.grantedAt)}${ST[it.status] ? " · " + ST[it.status] : ""}</span></div>
      ${it.product ? `<ul class="dg-files">${it.product.files.map((f) => `<li><span class="g">${h(f.name)} <small class="muted" dir="ltr">${size(f.size)}</small></span><button type="button" class="btn sm" data-dl="${h(it.id)}" data-f="${h(f.id)}"${it.downloadsLeft ? "" : " disabled"}>تنزيل</button></li>`).join("")}</ul><div class="muted dg-sm">متبقٍ ${UI.num(it.downloadsLeft)} من ${UI.num(it.downloadLimit)} مرات تنزيل · رابط التنزيل صالح ${UI.num(it.product.linkTtlMin)} دقيقة</div>` : ""}
      ${it.licenseKey ? `<p>مفتاح الترخيص: <span class="dg-key">${h(it.licenseKey)}</span></p>` : ""}
      ${it.refund?.allowed ? `<button type="button" class="btn ghost sm" data-rf="${h(it.id)}">طلب استرداد (حتى ${day(it.refund.until)})</button>` : ""}
      <a class="muted dg-sm" href="#/market/orders/${enc(it.orderId)}">صفحة الطلب والمحادثة ←</a></section>`).join("") || `<div class="card">${UI.empty({ title: "لم تشترِ منتجات رقمية بعد", text: "الكتب والقوالب والملفات التي تشتريها تظهر هنا للتنزيل.", action: `<a class="btn sm" href="#/digital">تصفّح المتجر</a>` })}</div>`;
    const again = () => libraryInto(host, tok);
    host.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { const r = await api("POST", `/api/digital/library/${enc(b.dataset.dl)}/link`, { fileId: b.dataset.f }); const a = document.createElement("a"); a.href = safe(r.url); a.download = r.name || ""; document.body.appendChild(a); a.click(); a.remove(); say(`بدأ التنزيل — متبقٍ ${r.downloadsLeft}`); setTimeout(again, 1500); }
      catch (x) { say(x.message); b.disabled = false; }
    }));
    host.querySelectorAll("[data-rf]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("طلب استرداد المبلغ؟ سيتوقف الوصول إلى المنتج.")) return; try { const r = await api("POST", `/api/digital/library/${enc(b.dataset.rf)}/refund`, {}); say(r.note); again(); } catch (x) { say(x.message); } }));
  }

  /* ---------- #/digital/sales ---------- */
  async function salesView() {
    page("مبيعاتي الرقمية", `<div class="dg-bar"><a class="btn" href="#/digital/new">منتج جديد</a></div><div class="skel"></div>`, ["#/digital", "المنتجات الرقمية"]);
    let d; try { d = await api("GET", "/api/me/digital/sales"); } catch (e) { $(".skel").outerHTML = errBox(e); return; }
    $(".skel").remove();
    const max = Math.max(1, ...d.series.map((s) => s.sales));
    $(".wrap").insertAdjacentHTML("beforeend", `<div class="dg-bar"><div class="u-f1 dg-note"><b>${d.totals.sales}</b> مبيعات</div><div class="u-f1 dg-note"><b>${amt(d.totals.net)}</b> صافي</div><div class="u-f1 dg-note"><b>${d.totals.downloads}</b> تنزيلات</div><div class="u-f1 dg-note"><b>${d.totals.refunds}</b> استرداد</div></div>
      <div role="img" aria-label="المبيعات خلال ٣٠ يوماً" style="display:flex;align-items:flex-end;gap:2px;height:80px">${d.series.map((s) => `<span title="${h(s.day)}: ${s.sales}" style="flex:1;height:${Math.max(3, Math.round((s.sales / max) * 100))}%;background:var(--brand,#5b2bd6);border-radius:3px 3px 0 0;opacity:${s.sales ? 1 : 0.25}"></span>`).join("")}</div>
      <p class="u-t-sm muted">${h(d.note)}</p>
      <div style="overflow-x:auto"><table class="dg-t"><thead><tr><th>المنتج</th><th>المبيعات</th><th>الصافي</th><th>التنزيلات</th><th>استرداد</th><th></th></tr></thead><tbody>${d.items.map((x) => `<tr><td><a href="#/digital/p/${enc(x.listingId)}">${h(x.title)}</a>${x.status === "blocked" ? " <small>(موقوف)</small>" : ""}</td><td>${x.sales}</td><td>${amt(x.net)}</td><td>${x.downloads}</td><td>${x.refunds}</td><td><button type="button" class="btn ghost" data-lic="${h(x.listingId)}">التراخيص</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">لا منتجات بعد</td></tr>`}</tbody></table></div><div id="dg-lic"></div>
      <form id="dg-vk" class="dg-bar"><input name="k" dir="ltr" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" aria-label="تحقق من مفتاح ترخيص" class="u-f1 u-mh44"><button class="btn ghost">تحقق</button></form>`);
    view.querySelectorAll("[data-lic]").forEach((b) => b.addEventListener("click", async () => { try { const r = await api("GET", "/api/me/digital/licenses?listingId=" + enc(b.dataset.lic)); $("#dg-lic").innerHTML = `<ul class="dg-files">${r.items.map((x) => `<li><span class="dg-key">${h(x.key)}</span><span class="g">@${h(x.buyer)} · ${day(x.grantedAt)}</span><span class="muted">${h(x.status)}</span></li>`).join("") || `<li class="muted">لا مفاتيح (المنتج بلا ترخيص أو لم يُبع بعد)</li>`}</ul>`; } catch (x) { say(x.message); } }));
    $("#dg-vk").addEventListener("submit", async (e) => { e.preventDefault(); try { const r = await api("GET", "/api/me/digital/licenses?key=" + enc(e.target.k.value.trim())); say(r.valid ? `✓ مفتاح صالح — ${r.title}` : "✗ المفتاح غير صالح أو ليس لمنتجاتك"); } catch (x) { say(x.message); } });
  }

  /* ---------- #/admin/digital ---------- */
  async function adminView() {
    page("بلاغات المنتجات الرقمية", `<div class="skel"></div>`, ["#/admin", "الإدارة"], "flag");
    const tok = (view._dgAdm = {}); // v2.51: a second render (chunk load + route) while this one waits must not crash it
    let d; try { d = await api("GET", "/api/admin/digital/reports"); } catch (e) { if (view._dgAdm === tok && $(".skel")) $(".skel").outerHTML = errBox(e); return; }
    if (view._dgAdm !== tok || !$(".wrap")) return;
    $(".skel")?.remove();
    $(".wrap").insertAdjacentHTML("beforeend", d.items.map((r) => `<section class="u-p12 u-mb10 card"><b>${h(r.reasonLabel)}</b> — <a href="#/digital/p/${enc(r.listingId)}">${h(r.title)}</a><div class="muted">من @${h(r.reporter || "")} · ${day(r.createdAt)}</div>${r.details ? `<p class="u-pre">${h(r.details)}</p>` : ""}
      <div class="dg-bar"><button type="button" class="btn" data-a="takedown" data-id="${h(r.id)}">إزالة المنتج</button><button type="button" class="btn" data-a="takedown" data-rv="1" data-id="${h(r.id)}" style="background:var(--danger,#b91c1c)">إزالة + إيقاف التنزيل للمشترين</button><button type="button" class="btn ghost" data-a="dismiss" data-id="${h(r.id)}">رفض البلاغ</button></div></section>`).join("") || `<div class="empty">لا بلاغات مفتوحة ✓</div>`);
    view.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", async () => { if (b.dataset.a === "takedown" && !confirm("إزالة المنتج ومنع رفع ملفاته مرة أخرى؟")) return; try { await api("POST", `/api/admin/digital/reports/${enc(b.dataset.id)}/resolve`, { action: b.dataset.a, revoke: !!b.dataset.rv }); adminView(); } catch (x) { say(x.message); } }));
  }

  MPRoutes.extend((a, b, prev) => {
    return { digital: () => (a === "p" && b ? productView(b) : a === "new" ? formView(null) : a === "edit" && b ? formView(b) : a === "sales" ? salesView() : storeView()),
      purchases: () => libraryView() };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "digital" ? adminView() : next()));
  window.MPDigital = { storeView, productView, formView, libraryView, purchases: libraryView, salesView, adminView, version: "2.26.0" };
  if (/^#\/(digital|purchases|admin\/digital)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
