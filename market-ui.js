/* =====================================================================
 * مجتمع بلس — Phase 39 UI: community marketplace «السوق المجتمعي» (lazy "market" chunk, routes #/market…).
 * • #/market grid: search, category chips, filters (kind / condition / price range), sort, infinite scroll, 2/3/4 columns.
 * • #/market/item/:id product page: multi-image gallery (swipe, thumbnails, arrow keys, alt text, lightbox, lazy images),
 *   seller card (rating stars, sales), buy flow: POST /api/market/listings/:id/order {qty} → {order, intent} → the intent goes
 *   unchanged through MPPi.pay (purpose "market") → order page. Pi off / canBuy:false → disabled button + Arabic reason.
 * • #/market/new, #/market/edit/:id listing form (1–8 images via POST /api/media, reorder, Arabic validation errors).
 * • #/market/orders (buyer / seller / my listings tabs), #/market/orders/:id (stepper + timeline, escrow state, role actions
 *   ship / deliver / confirm / cancel, order chat, review, dispute with evidence + dispute messages).
 * • #/market/seller/:handle (rating summary, reviews, seller replies), #/admin/market/disputes (queue + resolve).
 * REST contract: docs/integration/p39-contract.md. Styles injected here (#mk-css). CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function MarketUI() {
  if (window.MPMarket) return;
  const A = () => (typeof PiAdapter !== "undefined" ? PiAdapter : null);
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b, raw) => Remote.api(m, p, b, raw);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const num = (n) => { const x = Number(n); return Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: 7 }) : String(n ?? ""); };
  const pi = (n) => `<bdi dir="ltr" class="mk-n">${h(num(n))} π</bdi>`;
  const piTxt = (n) => `${num(n)} Pi`;
  const cnt = (n) => Number(n || 0).toLocaleString("ar-EG");
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso); } };
  const list = (r, ...keys) => Array.isArray(r) ? r : (keys.map(k => r?.[k]).find(Array.isArray) || []);
  const safeUrl = (u) => (typeof u === "string" && /^(\/(?!\/)|https:\/\/|blob:)/.test(u) ? u : "");
  const meId = () => (typeof DB !== "undefined" ? DB.me : null);
  const meHandle = () => { try { return S.me()?.handle; } catch { return null; } };
  const say = (msg) => { let r = document.getElementById("mk-say"); if (!r) { r = document.createElement("div"); r.id = "mk-say"; r.className = "mk-sr"; r.setAttribute("aria-live", "polite"); document.body.appendChild(r); } r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); };
  const live = (t) => view._mk === t && location.hash === t.h;
  const begin = () => (view._mk = { h: location.hash });
  const focusH = () => { const t = document.getElementById("mk-h"); if (t && (!document.activeElement || document.activeElement === document.body || !view.contains(document.activeElement))) t.focus({ preventScroll: true }); };
  const OFF = "مدفوعات Pi غير مفعّلة بعد";
  let maxPrice = 1000;
  const ERR = {
    sign_in: "سجّل الدخول أولاً للشراء.", own_listing: "هذا إعلانك، لا يمكنك شراؤه.", minor_restricted: "البيع والشراء في السوق غير متاحين لمن هم دون 18 عاماً.",
    not_configured: OFF + ". سيُتاح الشراء فور تفعيلها.", pi_disabled: OFF + ".", sold_out: "نفدت الكمية المتاحة.", pi_not_linked: "اربط حساب Pi أولاً من الإعدادات ← Pi Network.",
    listing_invalid: "بيانات الإعلان غير صالحة، راجع الحقول المطلوبة.", price_invalid: () => `السعر يجب أن يكون بين 0.01 و${num(maxPrice)} Pi.`, images_invalid: "أضف من صورة واحدة إلى 8 صور من رفعك أنت.",
    category_invalid: "اختر فئة من القائمة.", spam: "رُفض النص لأنه يبدو مزعجاً أو مخالفاً للإرشادات. عدّله ثم أعد المحاولة.", qty_invalid: "الكمية المطلوبة غير متاحة.",
    not_found: "غير موجود أو أُزيل.", forbidden: "لا تملك صلاحية هذا الإجراء.", invalid_state: "لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية.", order_state: "لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية.",
    review_exists: "قيّمت هذا الطلب من قبل.", dispute_exists: "يوجد نزاع مفتوح لهذا الطلب بالفعل.", dispute_invalid: "أكمل بيانات النزاع.", blocked: "لا يمكن إتمام العملية بسبب حظر بينكما.", amount_invalid: "المبلغ غير صالح.",
    unavailable: "هذا الإعلان غير متاح للشراء حالياً.", listing_rejected: "لم يُنشر الإعلان لأنه يحتاج مراجعة وفق إرشادات المجتمع. عدّل النص ثم أعد المحاولة.",
    insufficient_quantity: "الكمية المطلوبة أكبر من المتوفر.", review_invalid: "اختر تقييماً من 1 إلى 5، والنص حتى 1000 حرف.", evidence_invalid: "صور الأدلة غير صالحة، استخدم صوراً رفعتها أنت (حتى 8).",
    resolution_invalid: "اختر قراراً صالحاً للنزاع.", split_invalid: "مبلغ التقسيم يجب أن يكون أكبر من 0 وأقل من الإجمالي.", dispute_resolved: "حُسم هذا النزاع بالفعل.",
    bad_request: "الطلب غير صالح.", unauthorized: "سجّل الدخول أولاً."
  };
  const errText = (e) => { const m = ERR[e?.code]; return (e?.code && /[\u0600-\u06FF]/.test(e.message || "") && e.message !== "تعذر الاتصال بالخادم" ? e.message : typeof m === "function" ? m() : m) || (e?.status === 429 ? "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة." : e?.status === 501 ? OFF + "." : e?.message || "تعذّرت العملية."); };

  const CATS = [["electronics", "إلكترونيات", ""], ["fashion", "أزياء", ""], ["home", "المنزل", ""], ["books", "كتب", ""], ["digital", "منتجات رقمية", ""], ["services", "خدمات", ""], ["education", "تعليم", ""], ["crafts", "حِرف يدوية", ""], ["other", "أخرى", ""]];
  const CAT = Object.fromEntries(CATS.map(([k, l]) => [k, l]));
  const KIND = { product: "منتج", service: "خدمة" }, COND = { new: "جديد", used: "مستعمل", na: "لا ينطبق" };
  const DELIV = { pickup: "استلام شخصي", shipping: "شحن", digital: "تسليم رقمي", onsite: "في الموقع" };
  const SORT = { new: "الأحدث", price_asc: "السعر: الأقل أولاً", price_desc: "السعر: الأعلى أولاً", rating: "الأعلى تقييماً" };
  const OST = { pending_payment: ["بانتظار الدفع", "wait"], paid_held: ["مدفوع · محجوز في الضمان", "info"], shipped: ["تم الشحن", "info"], delivered: ["تم التسليم", "info"], completed: ["مكتمل", "ok"], cancelled: ["ملغى", "mute"], refunded: ["مُسترد للمشتري", "mute"], disputed: ["نزاع مفتوح", "bad"] };
  const EST = { held: "المبلغ محجوز لدى المنصة (ضمان) حتى يؤكد المشتري الاستلام.", released: "حُرّر المبلغ للبائع.", refunded: "أُعيد المبلغ للمشتري.", split: "قُسّم المبلغ بين المشتري والبائع بقرار الإدارة." };
  const LST = { draft: ["مسودة", "mute"], active: ["نشط", "ok"], paused: ["متوقف مؤقتاً", "wait"], sold_out: ["نفدت الكمية", "mute"], removed: ["محذوف", "bad"] };
  const REASON = { not_received: "لم يصلني الطلب", not_as_described: "مختلف عن الوصف", damaged: "وصل تالفاً", other: "سبب آخر" };
  const RES = { refund_buyer: "إعادة المبلغ للمشتري", release_seller: "تحرير المبلغ للبائع", split: "تقسيم المبلغ" };
  const chip = (map, s) => { const [t, c] = map[s] || [s || "—", "mute"]; return `<span class="mk-chip sbadge ${({ wait: "warn", mute: "" })[c] ?? c}">${h(t)}</span>`; };
  const stars = (avg, count) => { const a = Math.max(0, Math.min(5, Number(avg) || 0)); return `<span class="mk-stars" role="img" aria-label="${count != null && !count ? "لا تقييمات بعد" : `التقييم ${h(a.toLocaleString("ar-EG", { maximumFractionDigits: 1 }))} من 5${count != null ? ` (${cnt(count)} تقييم)` : ""}`}"><span class="mk-s0" aria-hidden="true">★★★★★</span><span class="mk-s1" aria-hidden="true" style="width:${(a / 5) * 100}%">★★★★★</span></span>`; };
  const imgOf = (x) => { const i = x?.image || x?.cover || (Array.isArray(x?.images) ? x.images[0] : null); return typeof i === "string" ? { url: i } : i || null; };
  const avatar = (u) => { const src = safeUrl(u?.avatar); return src ? `<img class="mk-av" src="${h(src)}" alt="" width="44" height="44" loading="lazy">` : `<span class="mk-av" aria-hidden="true">${h((u?.name || u?.handle || "؟").trim().charAt(0))}</span>`; };
  const back = (href, label) => `<a href="${href}" class="muted">→ ${h(label)}</a>`;
  const errBox = (e) => `<div class="card mk-errbox" role="alert">${h(errText(e))} <button type="button" class="btn ghost" data-ui="route">إعادة المحاولة</button></div>`;

  /* ---------- styles (kept out of the core CSS budget) ---------- */
  if (!document.getElementById("mk-css")) document.head.insertAdjacentHTML("beforeend", `<style id="mk-css">
.mk-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mk-n{white-space:nowrap;font-variant-numeric:tabular-nums}.mk-page{container-type:inline-size}.mk-page h2:focus,.mk-sheet h3:focus{outline:none}
.mk-page [hidden],.mk-sheet [hidden]{display:none!important}
@media (min-width:1180px){body.mk-wide{--col:976px}body.mk-wide #rail{display:none!important}}
.mk-f{display:grid;gap:6px;margin:0 0 var(--s3);font-size:var(--fs-sm);font-weight:600;color:var(--text-2)}.mk-f>span,.mk-f>legend{font-weight:600}.mk-hint{color:var(--muted);font-size:var(--fs-xs);margin:4px 0 0}.mk-f [aria-invalid=true]{border-color:var(--danger)}.mk-ferr{color:var(--danger);font-weight:600;font-size:var(--fs-xs);margin:4px 0 0}
.mk-filters{padding:4px 14px;margin:0 0 var(--s3)}.mk-acts{gap:6px}.mk-search .btn{display:none}.mk-page .mk-cb{gap:4px}.mk-filters summary{cursor:pointer;font-weight:800;padding:8px 0;min-height:28px}
.mk-fgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 10px;padding-bottom:8px}.mk-fgrid 
@container (min-width:560px){.mk-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.mk-fgrid{grid-template-columns:repeat(4,minmax(0,1fr))}}@container (min-width:860px){.mk-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.mk-ph{aspect-ratio:1;background:var(--bg-2);position:relative;overflow:hidden}.mk-ph img{width:100%;height:100%;object-fit:cover;display:block}
.mk-ph .mk-kind{position:absolute;top:8px;inset-inline-start:8px;background:rgba(20,10,40,.72);color:#fff;border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:700}
.mk-cb{padding:8px 10px 10px;display:flex;flex-direction:column;gap:3px;min-width:0}.mk-cb .mk-t{font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mk-cb .mk-pr{font-weight:850;font-size:15px;color:var(--brand-1,#6d3cf4)}[data-theme=dark] .mk-cb .mk-pr{color:#c9b6ff}.mk-cb .mk-m{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk-more{display:flex;justify-content:center;padding:14px}
.mk-stars{position:relative;display:inline-block;font-size:14px;line-height:1;letter-spacing:1px;vertical-align:-1px}.mk-s0{color:#d6d0e4}[data-theme=dark] .mk-s0{color:#4a4360}
.mk-s1{position:absolute;top:0;inset-inline-start:0;overflow:hidden;white-space:nowrap;color:#f5a524}
.mk-gal{position:relative;border-radius:20px;overflow:hidden;background:var(--bg-2);touch-action:pan-y;user-select:none}.mk-gal:focus-visible{outline:3px solid var(--brand-1,#6d3cf4);outline-offset:2px}
.mk-track{display:flex;transition:transform .3s var(--ease,ease)}.mk-slide{flex:0 0 100%;aspect-ratio:4/3;display:grid;place-items:center;margin:0;cursor:zoom-in}.mk-slide img{width:100%;height:100%;object-fit:contain;display:block}
.mk-gbtn{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:0;background:rgba(20,10,40,.6);color:#fff;font-size:22px;cursor:pointer;display:grid;place-items:center;direction:ltr}
.mk-gbtn[disabled]{opacity:.3;cursor:default}.mk-prev{inset-inline-start:8px}.mk-next{inset-inline-end:8px}
.mk-count{position:absolute;bottom:8px;inset-inline-end:10px;background:rgba(20,10,40,.7);color:#fff;border-radius:999px;padding:2px 10px;font-size:12.5px;font-weight:700}
.mk-thumbs{display:flex;gap:8px;overflow-x:auto;padding:8px 2px;margin:0;list-style:none;scrollbar-width:thin}.mk-thumbs button{flex:none;width:62px;height:62px;padding:0;border-radius:12px;border:2.5px solid transparent;overflow:hidden;background:var(--bg-2);cursor:pointer}
.mk-thumbs button[aria-current=true]{border-color:var(--brand-1,#6d3cf4)}.mk-thumbs img{width:100%;height:100%;object-fit:cover;display:block}
.mk-lb{position:fixed;inset:0;z-index:1000;background:rgba(8,4,18,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px}
.mk-lb img{max-width:100%;max-height:calc(100vh - 120px);object-fit:contain}.mk-lb .mk-lbx{position:absolute;top:12px;inset-inline-end:12px;width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font-size:22px;cursor:pointer}
.mk-lb .mk-gbtn{background:rgba(255,255,255,.18)}.mk-lb p{color:#fff;margin:10px 0 0;font-size:14px;text-align:center}
.mk-price{font-size:26px;font-weight:900;margin:2px 0 6px}.mk-tags{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
.mk-buy{border:1.5px solid #c9b6f2;border-radius:18px;padding:12px 14px;margin:12px 0;background:linear-gradient(160deg,#f6f1ff,#fff8e8);color:#2b1a4f}[data-theme=dark] .mk-buy{background:linear-gradient(160deg,#241a3a,#2a2416);border-color:#5b4a86;color:#efe8ff}
.mk-buy .mk-off{font-weight:700;color:#6e4300;background:#fff3d6;border-radius:10px;padding:6px 10px;margin:8px 0 0}[data-theme=dark] .mk-buy .mk-off{background:#3a2c0c;color:#ffd27a}
.mk-buy .row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}.mk-buy .row .mk-f{flex:0 0 110px;margin:0}.mk-buy .row .pi-btn{flex:1 1 180px}
.mk-desc{white-space:pre-wrap;line-height:1.75;overflow-wrap:anywhere}
.mk-seller{display:flex;align-items:center;gap:12px}.mk-av{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none;display:grid;place-items:center;background:var(--grad);color:#fff;font-weight:800}
.mk-seller .grow,.mk-row .grow{flex:1;min-width:0}.mk-row{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}.mk-row:last-child{border:0}
.mk-row .mk-th{width:56px;height:56px;border-radius:12px;object-fit:cover;flex:none;background:var(--bg-2)}.mk-row .grow>a,.mk-row .grow>b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.mk-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none}
.mk-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.mk-btns>*{flex:1 1 130px;text-align:center;text-decoration:none}
.mk-steps{display:flex;gap:4px;list-style:none;margin:6px 0 12px;padding:0;counter-reset:s}.mk-steps li{flex:1;text-align:center;font-size:11.5px;color:var(--muted);position:relative;padding-top:26px}
.mk-steps li::before{counter-increment:s;content:counter(s,arabic-indic);position:absolute;top:0;inset-inline-start:50%;transform:translateX(50%);width:22px;height:22px;border-radius:50%;background:var(--bg-2);display:grid;place-items:center;font-weight:800;color:var(--text-2)}
[dir=ltr] .mk-steps li::before{transform:translateX(-50%)}.mk-steps li.done{color:var(--text)}.mk-steps li.done::before{content:"✓";background:#13603a;color:#fff}.mk-steps li[aria-current=step]{color:var(--text);font-weight:800}.mk-steps li[aria-current=step]::before{background:var(--grad);color:#fff}
.mk-tl{list-style:none;margin:0;padding:0;border-inline-start:2px solid var(--line)}.mk-tl li{position:relative;padding:4px 14px 10px}.mk-tl li::before{content:"";position:absolute;inset-inline-start:-6px;top:9px;width:10px;height:10px;border-radius:50%;background:var(--brand-1,#6d3cf4)}
.mk-escrow{border-inline-start:4px solid #13603a}.mk-escrow.refunded,.mk-escrow.split{border-color:#e8a412}.mk-note{border-inline-start:4px solid #e8a412}
.mk-imgs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;list-style:none;margin:6px 0;padding:0}@container (min-width:560px){.mk-imgs{grid-template-columns:repeat(8,minmax(0,1fr))}}
.mk-imgs li{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;background:var(--bg-2)}.mk-imgs img{width:100%;height:100%;object-fit:cover;display:block}
.mk-imgs .mk-cover{position:absolute;top:4px;inset-inline-start:4px;background:var(--grad);color:#fff;border-radius:999px;padding:0 7px;font-size:11px;font-weight:800}
.mk-imgs .mk-ia{position:absolute;bottom:0;inset-inline:0;display:flex;justify-content:space-between;background:rgba(20,10,40,.65)}.mk-imgs .mk-ia button{border:0;background:none;color:#fff;min-width:28px;min-height:30px;font-size:15px;cursor:pointer;padding:0}
.mk-imgs .mk-ia button[disabled]{opacity:.35}.mk-imgs .mk-up{display:grid;place-items:center;font-size:12px;color:var(--muted)}
.mk-add{display:inline-flex;align-items:center;gap:6px;cursor:pointer}.mk-add input{position:absolute;opacity:0;width:1px;height:1px}.mk-add:focus-within{outline:3px solid var(--brand-1,#6d3cf4);outline-offset:2px;border-radius:12px}
.mk-rate{border:0;padding:0;margin:8px 0}.mk-rate legend{font-weight:700;margin-bottom:4px}.mk-rate .mk-rs{display:inline-flex;flex-direction:row-reverse;gap:2px}[dir=rtl] .mk-rate .mk-rs{flex-direction:row-reverse}
.mk-rate input{position:absolute;opacity:0;width:1px;height:1px}.mk-rate label{font-size:30px;line-height:1;color:#d6d0e4;cursor:pointer;padding:2px;min-width:40px;text-align:center}
.mk-rate label:hover,.mk-rate label:hover~label,.mk-rate input:checked~label{color:#f5a524}.mk-rate input:focus-visible+label{outline:3px solid var(--brand-1,#6d3cf4);border-radius:8px}
.mk-rev{padding:12px 0;border-bottom:1px solid var(--line)}.mk-rev:last-child{border:0}.mk-rev p{margin:6px 0;line-height:1.7;overflow-wrap:anywhere}.mk-reply{margin:8px 0 0;padding:8px 12px;border-radius:12px;background:var(--bg-2);font-size:14px}
.mk-sum{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.mk-sum .big{font-size:38px;font-weight:900;line-height:1}
.mk-msgs{list-style:none;margin:0 0 8px;padding:0;max-height:320px;overflow-y:auto}.mk-msgs li{padding:8px 10px;border-radius:12px;background:var(--bg-2);margin:6px 0;font-size:14px}.mk-msgs li.adm{background:#efe7ff}[data-theme=dark] .mk-msgs li.adm{background:#2f2350}
.mk-ev{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.mk-ev a,.mk-ev span{display:block;width:64px;height:64px;border-radius:10px;overflow:hidden;background:var(--bg-2)}.mk-ev img{width:100%;height:100%;object-fit:cover}
.mk-radio{display:flex;align-items:center;gap:8px;margin:6px 0;font-weight:600;min-height:32px}.mk-radio input{width:20px;height:20px;margin:0}
.mk-errsum{border:2px solid #c62828;border-radius:14px;padding:10px 14px;margin:8px 0}.mk-errsum:focus{outline:none}.mk-errsum ul{margin:6px 0 0;padding-inline-start:20px}
</style>`);

  /* ---------- Pi availability ---------- */
  async function piCfg() { const c = online() ? await A()?.config?.().catch?.(() => null) : null; if (Number(c?.marketMaxPrice) > 0) maxPrice = Number(c.marketMaxPrice); return c || { enabled: false }; }
  let mkc = null;
  async function mkCfg() { if (!mkc && online()) mkc = api("GET", "/api/market/config").catch(() => { mkc = null; return null; }); const c = mkc ? await mkc : null; if (Number(c?.maxPrice) > 0) maxPrice = Number(c.maxPrice); return c; }
  async function piOn() { return !!(await piCfg()).enabled; }

  /* ---------- #/market grid ---------- */
  const G = { q: "", category: "", kind: "", condition: "", min: "", max: "", sort: "new" };
  const card = (c) => {
    const im = imgOf(c), src = safeUrl(im?.thumb || im?.url), sel = c.seller || {}, r = sel.rating || {};
    return `<li class="mk-item" data-mk-id="${h(c.id)}"><a class="mk-card f-card" href="#/market/item/${enc(c.id)}">
      <div class="mk-ph">${src ? `<img src="${h(src)}" alt="${h(im.alt || c.title)}" loading="lazy" decoding="async"${im.w && im.h ? ` width="${Number(im.w) | 0}" height="${Number(im.h) | 0}"` : ""}>` : ""}<span class="mk-kind">${h(KIND[c.kind] || "")}</span></div>
      <div class="mk-cb"><b class="mk-t">${h(c.title)}</b><span class="mk-pr">${pi(c.price)}</span>
      <span class="mk-m">${r.count ? stars(r.avg, r.count) + " " : ""}${sel.handle ? `@${h(sel.handle)}` : ""}${c.condition && c.condition !== "na" ? ` · ${h(COND[c.condition] || "")}` : ""}${c.status === "sold_out" ? " · نفدت" : ""}</span></div></a></li>`;
  };
  const query = (cursor) => { const p = new URLSearchParams(); for (const k of ["q", "category", "kind", "condition", "min", "max"]) if (String(G[k]).trim()) p.set(k, String(G[k]).trim()); if (G.sort && G.sort !== "new") p.set("sort", G.sort); if (cursor) p.set("cursor", cursor); const s = p.toString(); return "/api/market/listings" + (s ? "?" + s : ""); };
  async function gridView() {
    const v = view, token = begin();
    if (!online()) { v.innerHTML = `<div class="wrap mk-page"><header class="page-head"><div class="ph-main"><div><h2 id="mk-h" tabindex="-1"><svg class="ic" aria-hidden="true"><use href="#i-bag"/></svg>السوق</h2></div></div></header><div class="empty mk-empty">السوق يحتاج الاتصال بالخادم.</div></div>`; return focusH(); }
    v.innerHTML = `<div class="wrap mk-page"><header class="page-head row-head"><div class="ph-main"><div><h2 id="mk-h" tabindex="-1"><svg class="ic" aria-hidden="true"><use href="#i-bag"/></svg>السوق</h2></div><div class="acts mk-acts"><a class="btn outline sm" href="#/market/orders"><svg class=ix aria-hidden=true><use href=#i-box /></svg>طلباتي</a><a class="btn sm" href="#/market/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>أضف إعلاناً</a></div></div></header>
      <form class="mk-search fx-host" role="search" id="mk-sf"><label class="mk-sr" for="mk-q">ابحث في السوق</label><input type="search" id="mk-q" placeholder="ابحث عن منتج أو خدمة…" value="${h(G.q)}" autocomplete="off" enterkeyhint="search"><button class="btn" type="submit">بحث</button></form>
      <ul class="mk-cats f-chips" role="list" aria-label="الفئات"><li><button type="button" class="chip f mk-cat" data-mk-cat="" aria-pressed="${!G.category}">الكل</button></li>${CATS.map(([k, l, e]) => `<li><button type="button" class="chip f mk-cat" data-mk-cat="${k}" aria-pressed="${G.category === k}"> ${h(l)}</button></li>`).join("")}</ul>
      <details class="mk-filters card flat" id="mk-fd"${G.kind || G.condition || G.min || G.max || G.sort !== "new" ? " open" : ""}><summary>تصفية وترتيب</summary><div class="mk-fgrid f-form">
        <label class="mk-f"><span>النوع</span><select id="mk-kind"><option value="">الكل</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${G.kind === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="mk-f"><span>الحالة</span><select id="mk-cond"><option value="">الكل</option><option value="new"${G.condition === "new" ? " selected" : ""}>جديد</option><option value="used"${G.condition === "used" ? " selected" : ""}>مستعمل</option></select></label>
        <label class="mk-f"><span>أقل سعر (Pi)</span><input type="number" id="mk-min" min="0" step="any" inputmode="decimal" dir="ltr" value="${h(G.min)}"></label>
        <label class="mk-f"><span>أعلى سعر (Pi)</span><input type="number" id="mk-max" min="0" step="any" inputmode="decimal" dir="ltr" value="${h(G.max)}"></label>
        <label class="mk-f"><span>الترتيب</span><select id="mk-sort">${Object.entries(SORT).map(([k, l]) => `<option value="${k}"${G.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <p class="mk-ferr" id="mk-ferr" role="alert"></p></details>
      <p class="mk-sr" id="mk-cnt" role="status"></p>
      <ul class="mk-grid f-grid" id="mk-grid" aria-busy="true" aria-label="الإعلانات"></ul><div class="mk-more" id="mk-more"></div></div>`;
    focusH();
    const $ = (q) => v.querySelector(q), grid = $("#mk-grid"), more = $("#mk-more");
    let next = null, busy = false, seq = 0, io = null, total = 0, want = false;
    const load = async (reset) => {
      if (busy && !reset) { want = true; return; } const my = ++seq; busy = true; want = false;
      if (reset) { next = null; total = 0; grid.innerHTML = `<li class="skel"></li><li class="skel"></li>`; grid.setAttribute("aria-busy", "true"); }
      more.innerHTML = reset ? "" : `<div class="skel sm" role="status" aria-label="جارٍ التحميل…"></div>`;
      let r; try { r = await api("GET", query(reset ? null : next)); } catch (e) { if (my === seq && live(token)) { busy = false; grid.removeAttribute("aria-busy"); if (reset) grid.innerHTML = ""; more.innerHTML = errBox(e); } return; }
      if (my !== seq || !live(token)) return;
      busy = false; grid.removeAttribute("aria-busy");
      let items = list(r, "items", "listings"); if (G.condition) items = items.filter(x => !x.condition || x.condition === G.condition);
      next = r?.next || null; total += items.length;
      if (reset) grid.innerHTML = ""; grid.insertAdjacentHTML("beforeend", items.map(card).join(""));
      if (!total && !next) { grid.innerHTML = ""; more.innerHTML = `<div class="empty mk-empty" id="mk-none" role="status"><span class="empty-t">لا توجد إعلانات مطابقة</span><span class="empty-x">جرّب كلمات أخرى أو أزل بعض عوامل التصفية.</span><a class="btn" href="#/market/new">أضف أول إعلان</a></div>`; }
      else more.innerHTML = next ? `<button type="button" class="btn ghost" id="mk-mb">عرض المزيد</button>` : total ? `<span class="muted">وصلت إلى نهاية النتائج</span>` : "";
      $("#mk-cnt").textContent = reset ? (total ? `${cnt(total)} نتيجة${next ? " وأكثر" : ""}` : "لا نتائج") : `حُمّل ${cnt(items.length)} إعلاناً إضافياً`;
      $("#mk-mb")?.addEventListener("click", () => load(false));
      // tall screens / a re-render that left the sentinel on screen: keep filling while it is near the viewport
      if (next && (want || items.length === 0 || more.getBoundingClientRect().top < innerHeight + 600)) setTimeout(() => { if (live(token) && next && !busy) load(false); }, 50);
    };
    if ("IntersectionObserver" in window) { io = new IntersectionObserver((es) => { if (!live(token)) return io.disconnect(); if (es.some(e => e.isIntersecting) && next && !busy) load(false); }, { rootMargin: "600px 0px" }); io.observe(more); }
    const filt = () => {
      const mn = $("#mk-min").value, mx = $("#mk-max").value;
      if (mn && mx && Number(mn) > Number(mx)) { $("#mk-ferr").textContent = "أقل سعر يجب ألا يتجاوز أعلى سعر."; return; }
      $("#mk-ferr").textContent = ""; Object.assign(G, { kind: $("#mk-kind").value, condition: $("#mk-cond").value, min: mn, max: mx, sort: $("#mk-sort").value }); load(true);
    };
    ["#mk-kind", "#mk-cond", "#mk-sort", "#mk-min", "#mk-max"].forEach(s => $(s).addEventListener("change", filt));
    let t = 0;
    $("#mk-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { if (!live(token)) return; G.q = $("#mk-q").value; load(true); }, 350); });
    $("#mk-sf").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(t); G.q = $("#mk-q").value; load(true); });
    v.querySelectorAll("[data-mk-cat]").forEach(b => b.addEventListener("click", () => { G.category = b.dataset.mkCat; v.querySelectorAll("[data-mk-cat]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); load(true); }));
    load(true);
  }

  /* ---------- gallery + lightbox ---------- */
  function gallery(imgs, title) {
    const n = imgs.length, alt = (im, i) => im.alt || `${title} — صورة ${cnt(i + 1)} من ${cnt(n)}`;
    if (!n) return `<div class="mk-gal"><div class="mk-slide" aria-hidden="true"></div></div>`;
    return `<section class="mk-gal" id="mk-gal" tabindex="0" role="region" aria-roledescription="معرض صور" aria-label="صور ${h(title)} (استخدم الأسهم للتنقل، Enter للتكبير)">
      <div class="mk-track" id="mk-track">${imgs.map((im, i) => `<figure class="mk-slide" data-mk-slide="${i}" role="group" aria-roledescription="شريحة" aria-label="${cnt(i + 1)} من ${cnt(n)}"${i ? ' aria-hidden="true"' : ""}><img src="${h(safeUrl(im.url))}" alt="${h(alt(im, i))}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async"${im.w && im.h ? ` width="${Number(im.w) | 0}" height="${Number(im.h) | 0}"` : ""}></figure>`).join("")}</div>
      ${n > 1 ? `<button type="button" class="mk-gbtn mk-prev" id="mk-gp" aria-label="الصورة السابقة">›</button><button type="button" class="mk-gbtn mk-next" id="mk-gn" aria-label="الصورة التالية">‹</button><span class="mk-count" id="mk-gc" aria-live="polite">${cnt(1)} / ${cnt(n)}</span>` : ""}</section>
      ${n > 1 ? `<ul class="mk-thumbs" aria-label="مصغّرات الصور">${imgs.map((im, i) => `<li><button type="button" data-mk-th="${i}" aria-label="عرض الصورة ${cnt(i + 1)}: ${h(alt(im, i))}" aria-current="${!i}"><img src="${h(safeUrl(im.thumb || im.url))}" alt="" loading="lazy" decoding="async"></button></li>`).join("")}</ul>` : ""}`;
  }
  function bindGallery(root, imgs, title) {
    const gal = root.querySelector("#mk-gal"); if (!gal) return;
    const n = imgs.length, track = gal.querySelector("#mk-track"), rtl = (document.documentElement.dir || "rtl") === "rtl";
    let i = 0;
    const show = (k, announce) => {
      i = Math.max(0, Math.min(n - 1, k)); track.style.transform = `translateX(${(rtl ? 1 : -1) * i * 100}%)`;
      gal.querySelectorAll("[data-mk-slide]").forEach((s, j) => s.toggleAttribute("aria-hidden", j !== i));
      root.querySelectorAll("[data-mk-th]").forEach((b, j) => b.setAttribute("aria-current", String(j === i)));
      const c = gal.querySelector("#mk-gc"); if (c) c.textContent = `${cnt(i + 1)} / ${cnt(n)}`;
      const p = gal.querySelector("#mk-gp"), nx = gal.querySelector("#mk-gn"); if (p) p.disabled = i === 0; if (nx) nx.disabled = i === n - 1;
      gal.dataset.index = String(i); if (announce) say(`الصورة ${cnt(i + 1)} من ${cnt(n)}`);
    };
    show(0);
    gal.querySelector("#mk-gp")?.addEventListener("click", (e) => { e.stopPropagation(); show(i - 1, true); });
    gal.querySelector("#mk-gn")?.addEventListener("click", (e) => { e.stopPropagation(); show(i + 1, true); });
    root.querySelectorAll("[data-mk-th]").forEach(b => b.addEventListener("click", () => show(Number(b.dataset.mkTh), true)));
    gal.addEventListener("keydown", (e) => {
      const fwd = rtl ? "ArrowLeft" : "ArrowRight", bwd = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === fwd) { e.preventDefault(); show(i + 1, true); } else if (e.key === bwd) { e.preventDefault(); show(i - 1, true); }
      else if (e.key === "Home") { e.preventDefault(); show(0, true); } else if (e.key === "End") { e.preventDefault(); show(n - 1, true); }
      else if ((e.key === "Enter" || e.key === " ") && e.target === gal) { e.preventDefault(); lightbox(imgs, i, title, gal, show); }
    });
    // swipe (pointer events; vertical scrolling stays native through touch-action: pan-y)
    let x0 = null, y0 = 0, moved = false;
    gal.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; x0 = e.clientX; y0 = e.clientY; moved = false; });
    gal.addEventListener("pointermove", (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 8) moved = true; });
    const up = (e) => { if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { show(i + ((dx > 0) === rtl ? 1 : -1), true); moved = true; } };
    gal.addEventListener("pointerup", up); gal.addEventListener("pointercancel", () => { x0 = null; });
    gal.addEventListener("click", (e) => { if (moved) { moved = false; return; } if (e.target.closest("[data-mk-slide]")) lightbox(imgs, i, title, gal, show); });
  }
  function lightbox(imgs, start, title, returnTo, sync) {
    document.getElementById("mk-lb")?.remove();
    const n = imgs.length; let i = start;
    const lb = document.createElement("div"); lb.className = "mk-lb"; lb.id = "mk-lb"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", `صور ${title}`);
    lb.innerHTML = `<button type="button" class="mk-lbx" id="mk-lbx" aria-label="إغلاق العارض">✕</button><img id="mk-lbi" alt=""><p id="mk-lbc" aria-live="polite"></p>${n > 1 ? `<button type="button" class="mk-gbtn mk-prev" id="mk-lbp" aria-label="الصورة السابقة">›</button><button type="button" class="mk-gbtn mk-next" id="mk-lbn" aria-label="الصورة التالية">‹</button>` : ""}`;
    document.body.appendChild(lb);
    const img = lb.querySelector("#mk-lbi"), rtl = (document.documentElement.dir || "rtl") === "rtl";
    const show = (k) => { i = (k + n) % n; const im = imgs[i]; img.src = safeUrl(im.url); img.alt = im.alt || `${title} — صورة ${cnt(i + 1)} من ${cnt(n)}`; lb.querySelector("#mk-lbc").textContent = `${img.alt} · ${cnt(i + 1)} / ${cnt(n)}`; };
    const close = () => { lb.remove(); document.removeEventListener("keydown", key, true); sync?.(i); returnTo?.focus?.(); };
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return close(); }
      if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) { e.preventDefault(); show(i + 1); } else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) { e.preventDefault(); show(i - 1); }
      else if (e.key === "Tab") { const f = [...lb.querySelectorAll("button")]; const at = f.indexOf(document.activeElement); e.preventDefault(); f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    };
    document.addEventListener("keydown", key, true);
    lb.querySelector("#mk-lbx").addEventListener("click", close);
    lb.querySelector("#mk-lbp")?.addEventListener("click", () => show(i - 1)); lb.querySelector("#mk-lbn")?.addEventListener("click", () => show(i + 1));
    lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
    let x0 = null; lb.addEventListener("pointerdown", (e) => { x0 = e.clientX; }); lb.addEventListener("pointerup", (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) show(i + ((dx > 0) === rtl ? 1 : -1)); });
    show(start); lb.querySelector("#mk-lbx").focus();
    return lb;
  }

  /* ---------- #/market/item/:id ---------- */
  const reasonText = (r) => r === "sign_in" ? ERR.sign_in : r === "own_listing" ? "هذا إعلانك." : r === "minor_restricted" ? ERR.minor_restricted : r === "sold_out" ? ERR.sold_out : r === "not_configured" ? OFF : r ? errText({ code: r }) : "";
  async function itemView(id) {
    const v = view, token = begin();
    v.innerHTML = `<div class="wrap mk-page">${back("#/market", "السوق")}<div class="skel"></div><div class="skel"></div></div>`;
    let L, on;
    try { [L, on] = await Promise.all([api("GET", `/api/market/listings/${enc(id)}`), piOn()]); L = L?.listing || L; if (L?.kind === "digital") return location.replace("#/digital/p/" + enc(id)); } catch (e) { if (live(token)) v.innerHTML = `<div class="wrap mk-page">${back("#/market", "السوق")}<h2 id="mk-h" tabindex="-1">الإعلان</h2>${e?.status === 404 ? `<div class="empty mk-empty">هذا الإعلان غير موجود أو أُزيل.</div>` : errBox(e)}</div>`; return focusH(); }
    if (!live(token)) return;
    const imgs = list(L.images).map(x => (typeof x === "string" ? { url: x } : x)).filter(x => safeUrl(x?.url)), sel = L.seller || {}, r = sel.rating || {};
    const mine = (sel.id && sel.id === meId()) || L.buyReason === "own_listing";
    const reason = !on ? "not_configured" : L.canBuy ? null : L.buyReason || "not_configured";
    const can = on && !!L.canBuy, qmax = L.quantity == null ? 99 : Math.max(0, Number(L.quantity) || 0);
    const off = !on || reason === "not_configured";
    document.title = `${L.title} · السوق · مجتمع بلس`;
    v.innerHTML = `<div class="wrap mk-page" data-mk-listing="${h(L.id)}">${back("#/market", "السوق")}
      ${gallery(imgs, L.title)}
      <h2 id="mk-h" tabindex="-1" class="u-mt12">${h(L.title)}</h2>
      <div class="mk-price">${pi(L.price)}</div>
      <div class="mk-tags">${L.status && L.status !== "active" ? chip(LST, L.status) : ""}<span class="mk-chip sbadge">${h(KIND[L.kind] || L.kind || "")}</span>${L.category ? `<a class="mk-chip sbadge role" href="#/market" data-mk-gocat="${h(L.category)}">${h(CAT[L.category] || L.category)}</a>` : ""}${L.condition && L.condition !== "na" ? `<span class="mk-chip sbadge">${h(COND[L.condition])}</span>` : ""}${L.delivery ? `<span class="mk-chip sbadge"><svg class=ix aria-hidden=true><use href=#i-truck /></svg> ${h(DELIV[L.delivery] || L.delivery)}</span>` : ""}${L.location ? `<span class="mk-chip sbadge"><svg class=ix aria-hidden=true><use href=#i-mapPin /></svg> ${h(L.location)}</span>` : ""}${L.quantity != null && L.kind === "product" ? `<span class="mk-chip sbadge">المتوفر: ${cnt(L.quantity)}</span>` : ""}</div>
      <section class="mk-buy" aria-labelledby="mk-bt"><h3 id="mk-bt" class="mk-sr">الشراء</h3>
        ${mine ? `<p class="u-m0 u-mb8">هذا إعلانك${L.views != null ? ` · ${cnt(L.views)} مشاهدة` : ""}.</p><div class="u-m0 mk-btns"><a class="btn" href="#/market/edit/${enc(L.id)}">تعديل الإعلان</a><a class="btn ghost" href="#/market/orders">مبيعاتي</a></div>`
        : `<div class="row">${L.kind !== "service" && qmax > 1 && can ? `<label class="mk-f"><span>الكمية</span><input type="number" id="mk-qty" min="1" max="${Math.min(qmax, 99)}" value="1" inputmode="numeric" dir="ltr"></label>` : ""}
          <button type="button" class="pi-btn" id="mk-buy" ${can ? "" : "disabled"} aria-describedby="mk-bn"><span class="pi-logo" aria-hidden="true">π</span>${L.kind === "service" ? "اطلب الخدمة" : "اشترِ الآن"} · ${h(piTxt(L.price))}</button></div>
          ${can ? `<p class="u-t-sm u-m0 u-mt8 muted" id="mk-bn">دفع آمن بالضمان: يُحجز المبلغ لدى المنصة ولا يصل للبائع حتى تؤكد الاستلام.</p>` : `<p class="mk-off" id="mk-bn" role="note">${h(off ? OFF : reasonText(reason))}</p>${off ? `<p class="u-t-sm u-m0 u-mt6 muted">سيُتاح الشراء فور تفعيل مدفوعات Pi. يمكنك تصفح الإعلانات ومراسلة البائع الآن.</p>` : ""}`}`}
      </section>
      <section class="card"><h3 class="u-m0 u-mb8 u-t-lg">الوصف</h3><div class="mk-desc">${h(L.description || "—")}</div></section>
      <section class="card mk-seller" aria-label="البائع">${avatar(sel)}<div class="grow"><b>${h(sel.name || sel.handle || "")}</b> ${sel.handle ? `<span class="muted">@${h(sel.handle)}</span>` : ""}
        <div class="u-t-sm muted">${r.count ? `${stars(r.avg, r.count)} ${h(Number(r.avg || 0).toLocaleString("ar-EG", { maximumFractionDigits: 1 }))} (${cnt(r.count)} تقييم)` : "لا تقييمات بعد"} · ${cnt(sel.sales)} عملية بيع</div></div>
        ${sel.handle ? `<a class="btn ghost" href="#/market/seller/${enc(sel.handle)}" aria-label="صفحة البائع ${h(sel.name || sel.handle)}">صفحة البائع</a>` : ""}</section>
      <p class="u-t-xs muted">نُشر ${h(day(L.createdAt))}${L.updatedAt && L.updatedAt !== L.createdAt ? ` · حُدّث ${h(day(L.updatedAt))}` : ""}</p></div>`;
    UI.vidtikStrip?.("product", L.id, v.querySelector(".mk-page")); // v2.76 «يظهر في فيديوتك» (nothing unless clips link this listing)
    focusH();
    bindGallery(v, imgs, L.title);
    v.querySelector("[data-mk-gocat]")?.addEventListener("click", (e) => { G.category = e.currentTarget.dataset.mkGocat; });
    v.querySelector("#mk-buy")?.addEventListener("click", () => { if (!can) return; const q = Math.max(1, Math.min(qmax || 1, parseInt(v.querySelector("#mk-qty")?.value || "1", 10) || 1)); buySheet(L, q); });
  }

  /* ---------- buy flow: order → intent → MPPi.pay ---------- */
  async function buySheet(L, qty) {
    if (!(await piOn())) return toast(OFF);
    if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { });
    const total = Math.round(Number(L.price) * qty * 1e7) / 1e7;
    const s = sheet(`<div class="mk-sheet" role="dialog" aria-modal="true" aria-labelledby="mk-st" aria-describedby="mk-sd"><h3 id="mk-st" tabindex="-1" class="u-m0 u-mt4 u-mb8"><svg class=ix aria-hidden=true><use href=#i-bag /></svg> تأكيد الطلب</h3>
      <div id="mk-sb"><p id="mk-sd" class="u-m0 u-mb6"><b>${h(L.title)}</b>${qty > 1 ? ` × ${cnt(qty)}` : ""} — الإجمالي ${pi(total)}</p>
      <p class="u-t-sm u-m0 u-mb10 muted">يُحجز المبلغ في الضمان لدى المنصة، ويُحرَّر للبائع عند تأكيدك الاستلام (أو تلقائياً بعد 7 أيام من التسليم). يمكنك فتح نزاع إن لم يصلك الطلب أو كان مختلفاً عن الوصف.</p>
      <p class="mk-ferr" id="mk-serr" role="alert"></p>
      <button type="button" class="pi-btn" id="mk-go" aria-describedby="mk-snote" disabled><span class="pi-logo" aria-hidden="true">π</span><span class="mk-lbl">ادفع ${h(piTxt(total))}</span></button>
      <p class="pi-note" id="mk-snote" role="status">جارٍ التحقق من Pi…</p></div>
      <div class="mk-btns"><button type="button" class="btn ghost" id="mk-sx">إغلاق</button></div></div>`);
    const $s = (q) => s.querySelector(q), go = $s("#mk-go"), err = $s("#mk-serr"), note = $s("#mk-snote");
    $s("#mk-sx").addEventListener("click", () => closeSheet());
    let av = { ok: false };
    (window.MPPi ? window.MPPi.availability() : Promise.resolve({ ok: false, reason: OFF + "." })).then(a => { av = a; note.textContent = a.ok ? (a.cfg?.network === "mainnet" ? "سيُطلب منك التأكيد في محفظة Pi." : "على الشبكة التجريبية (Testnet) — لا أموال حقيقية.") : a.reason; go.disabled = !a.ok; if (!s.contains(document.activeElement) || document.activeElement === go) $s("#mk-st")?.focus(); }); /* v2.54: keep the dialog title focused when availability resolves late (slow devices) */
    $s("#mk-st").focus(); setTimeout(() => { if (document.activeElement === go || document.activeElement === $s("#mk-sx")) $s("#mk-st")?.focus(); }, 90);
    let order = null;
    go.addEventListener("click", async () => {
      if (go.disabled) return;
      if (!av.ok) { err.textContent = av.reason || OFF; return; }
      err.textContent = ""; go.disabled = true; go.setAttribute("aria-busy", "true"); $s(".mk-lbl").textContent = "جارٍ الدفع…"; note.textContent = "أكمل التأكيد في نافذة Pi…";
      try {
        await window.MPPi.pay({ amount: total, memo: `السوق: ${L.title}`.slice(0, 120), purpose: "market", refId: L.id, intent: async () => { const r = await api("POST", `/api/market/listings/${enc(L.id)}/order`, { qty }); order = r.order; return r.intent; } });
        closeSheet(); toast("تم الدفع، المبلغ محجوز في الضمان ✓"); say("تم الدفع وأُنشئ الطلب");
        location.hash = `#/market/orders/${enc(order?.id || "")}`;
      } catch (e) {
        if (e?.paid && order?.id) { closeSheet(); toast("تم الدفع، جارٍ تأكيده…"); location.hash = `#/market/orders/${enc(order.id)}`; return; }
        go.disabled = false; go.removeAttribute("aria-busy"); $s(".mk-lbl").textContent = `ادفع ${piTxt(total)}`;
        if (e?.cancelled) note.textContent = "أُلغيت عملية الدفع، لم يُخصم شيء.";
        else { err.textContent = errText(e); note.textContent = ""; if (e?.code === "not_configured") go.disabled = true; }
      }
    });
    return s;
  }

  /* ---------- #/market/new, #/market/edit/:id ---------- */
  async function formView(id) {
    if (view._mkFormFor === location.hash && view._mkDirty && view.querySelector("#mk-form")) return; // a late chunk / sign-in re-render must not wipe what the seller typed
    const v = view, token = begin(), edit = !!id;
    if (!online()) { v.innerHTML = `<div class="wrap mk-page"><h2 id="mk-h" tabindex="-1">إعلان جديد</h2><div class="card">يحتاج الاتصال بالخادم.</div></div>`; return focusH(); }
    v.innerHTML = `<div class="wrap mk-page">${back(edit ? `#/market/item/${enc(id)}` : "#/market", edit ? "الإعلان" : "السوق")}<div class="skel"></div></div>`;
    let L = { kind: "product", category: "", condition: "new", delivery: "shipping", images: [], status: "active", quantity: 1 };
    try { await Promise.all([piCfg(), mkCfg()]); if (edit) { const r = await api("GET", `/api/market/listings/${enc(id)}`); L = r?.listing || r; } } catch (e) { if (live(token)) { v.innerHTML = `<div class="wrap mk-page">${back("#/market", "السوق")}<h2 id="mk-h" tabindex="-1">تعديل الإعلان</h2>${errBox(e)}</div>`; focusH(); } return; }
    if (!live(token)) return;
    if (edit && L.seller?.id && L.seller.id !== meId()) { v.innerHTML = `<div class="wrap mk-page">${back("#/market", "السوق")}<h2 id="mk-h" tabindex="-1">تعديل الإعلان</h2><div class="card">${ERR.forbidden}</div></div>`; return focusH(); }
    const imgs = list(L.images).map(x => (typeof x === "string" ? { id: x, url: x } : { id: x.id, url: x.thumb || x.url, alt: x.alt })).filter(x => x.id);
    const opt = (map, val) => Object.entries(map).map(([k, l]) => `<option value="${k}"${val === k ? " selected" : ""}>${h(l)}</option>`).join("");
    const fld = (name, label, input, hint = "") => `<label class="mk-f" id="mk-w-${name}"><span>${label}</span>${input}${hint ? `<p class="mk-hint" id="mk-hn-${name}">${hint}</p>` : ""}<p class="mk-ferr" id="mk-e-${name}"></p></label>`;
    const desc = (n, hint) => `aria-describedby="mk-e-${n}${hint ? ` mk-hn-${n}` : ""}"`;
    v.innerHTML = `<div class="wrap mk-page">${back(edit ? `#/market/item/${enc(id)}` : "#/market", edit ? "الإعلان" : "السوق")}<h2 id="mk-h" tabindex="-1">${edit ? "تعديل الإعلان" : "إعلان جديد في السوق"}</h2>
      <div id="mk-es" class="mk-errsum" role="alert" tabindex="-1" hidden></div>
      <form id="mk-form" class="card" novalidate>
        <fieldset class="u-b0 u-p0 u-m0 mk-f"><legend>نوع الإعلان</legend><label class="mk-radio"><input type="radio" name="kind" value="product"${L.kind !== "service" ? " checked" : ""}> منتج</label><label class="mk-radio"><input type="radio" name="kind" value="service"${L.kind === "service" ? " checked" : ""}> خدمة</label></fieldset>
        ${fld("title", "العنوان", `<input type="text" id="mk-title" name="title" maxlength="120" required value="${h(L.title || "")}" ${desc("title", 1)}>`, "من 3 إلى 120 حرفاً.")}
        ${fld("description", "الوصف", `<textarea id="mk-description" name="description" maxlength="5000" ${desc("description", 1)}>${h(L.description || "")}</textarea>`, "حتى 5000 حرف. اذكر الحالة والمواصفات وطريقة التسليم.")}
        ${fld("price", "السعر (Pi)", `<input type="number" id="mk-price" name="price" min="0.01" max="${maxPrice}" step="any" inputmode="decimal" dir="ltr" required value="${h(L.price ?? "")}" ${desc("price", 1)}>`, `من 0.01 إلى ${h(num(maxPrice))} Pi، حتى 7 خانات عشرية.`)}
        ${fld("category", "الفئة", `<select id="mk-category" name="category" required ${desc("category")}><option value="">اختر فئة…</option>${opt(CAT, L.category)}</select>`)}
        <div id="mk-pw">${fld("condition", "حالة المنتج", `<select id="mk-condition" name="condition" ${desc("condition")}>${opt({ new: "جديد", used: "مستعمل" }, L.condition)}</select>`)}</div>
        ${fld("quantity", "الكمية المتاحة", `<input type="number" id="mk-quantity" name="quantity" min="0" step="1" inputmode="numeric" dir="ltr" value="${h(L.quantity ?? "")}" ${desc("quantity", 1)}>`, `<span id="mk-qh">${L.kind === "service" ? "اتركها فارغة لخدمة غير محدودة." : "عدد القطع المتاحة للبيع."}</span>`)}
        ${fld("delivery", "طريقة التسليم", `<select id="mk-delivery" name="delivery" ${desc("delivery")}>${opt(DELIV, L.delivery)}</select>`)}
        ${fld("location", "الموقع (اختياري)", `<input type="text" id="mk-location" name="location" maxlength="120" value="${h(L.location || "")}" ${desc("location")}>`)}
        <fieldset class="u-b0 u-p0 u-my10 mk-f" id="mk-w-images" aria-describedby="mk-e-images mk-hn-images"><legend>الصور (<span id="mk-ic">${cnt(imgs.length)}</span> / ٨)</legend>
          <ul class="mk-imgs" id="mk-imgs" aria-label="صور الإعلان بالترتيب، الأولى هي الغلاف"></ul>
          <label class="btn ghost mk-add" id="mk-addw"><input type="file" id="mk-files" accept="image/*" multiple aria-describedby="mk-hn-images"><span aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-camera /></svg></span> إضافة صور</label>
          <p class="mk-hint" id="mk-hn-images">من صورة واحدة إلى 8 صور. الأولى غلاف الإعلان؛ استخدم الأسهم لإعادة الترتيب.</p><p class="mk-ferr" id="mk-e-images"></p><p class="mk-sr" id="mk-ist" role="status"></p></fieldset>
        <p class="mk-ferr" id="mk-e-form" role="alert"></p>
        <div class="mk-btns"><button type="submit" class="btn" id="mk-save" data-status="active">${edit ? "حفظ التغييرات" : "نشر الإعلان"}</button>${!edit || L.status === "draft" ? `<button type="submit" class="btn ghost" id="mk-draft" data-status="draft">حفظ كمسودة</button>` : ""}</div>
        ${edit ? `<div class="mk-btns">${L.status === "active" ? `<button type="button" class="btn ghost" id="mk-pause">إيقاف مؤقت</button>` : L.status === "paused" ? `<button type="button" class="btn ghost" id="mk-resume">إعادة التفعيل</button>` : ""}<button type="button" class="btn ghost" id="mk-del" style="color:#a11616">حذف الإعلان</button></div>` : ""}
      </form></div>`;
    focusH();
    const $ = (q) => v.querySelector(q), form = $("#mk-form");
    v._mkFormFor = location.hash; v._mkDirty = false; form.addEventListener("input", () => { v._mkDirty = true; }); form.addEventListener("change", () => { v._mkDirty = true; });
    const kind = () => form.querySelector("input[name=kind]:checked").value;
    const syncKind = () => { const svc = kind() === "service"; $("#mk-pw").hidden = svc; $("#mk-qh").textContent = svc ? "اتركها فارغة لخدمة غير محدودة." : "عدد القطع المتاحة للبيع."; };
    form.querySelectorAll("input[name=kind]").forEach(r => r.addEventListener("change", syncKind)); syncKind();
    let uploading = 0;
    const drawImgs = (focusSel) => {
      const ul = $("#mk-imgs"), n = imgs.length;
      ul.innerHTML = imgs.map((im, i) => `<li data-mk-img="${i}">${im.url ? `<img src="${h(safeUrl(im.url))}" alt="صورة ${cnt(i + 1)}${i ? "" : " (الغلاف)"}">` : `<span class="mk-up">جارٍ الرفع…</span>`}${i ? "" : `<span class="mk-cover" aria-hidden="true">غلاف</span>`}
        <div class="mk-ia"><button type="button" data-mv="-1" data-i="${i}" aria-label="نقل الصورة ${cnt(i + 1)} للأمام"${i ? "" : " disabled"}>→</button><button type="button" data-rm="${i}" aria-label="حذف الصورة ${cnt(i + 1)}">✕</button><button type="button" data-mv="1" data-i="${i}" aria-label="نقل الصورة ${cnt(i + 1)} للخلف"${i < n - 1 ? "" : " disabled"}>←</button></div></li>`).join("");
      $("#mk-ic").textContent = cnt(n); $("#mk-addw").hidden = n >= 8;
      ul.querySelectorAll("[data-mv]").forEach(b => b.addEventListener("click", () => { const i = Number(b.dataset.i), j = i + Number(b.dataset.mv); if (j < 0 || j >= imgs.length) return; [imgs[i], imgs[j]] = [imgs[j], imgs[i]]; drawImgs(`[data-mv="${b.dataset.mv}"][data-i="${j}"]`); $("#mk-ist").textContent = `نُقلت الصورة إلى الموضع ${cnt(j + 1)}`; }));
      ul.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { imgs.splice(Number(b.dataset.rm), 1); drawImgs(); $("#mk-ist").textContent = "حُذفت الصورة"; ($("#mk-imgs [data-rm]") || $("#mk-files")).focus(); }));
      if (focusSel) { const f = ul.querySelector(focusSel); (f && !f.disabled ? f : ul.querySelector(focusSel.replace(/data-mv="[^"]+"/, "data-rm")) || $("#mk-files"))?.focus(); }
    };
    drawImgs();
    $("#mk-files").addEventListener("change", async (e) => {
      const files = [...e.target.files].filter(f => /^image\//.test(f.type)), room = 8 - imgs.length; e.target.value = "";
      const err = $("#mk-e-images"); err.textContent = files.length > room ? `يمكن إضافة ${cnt(room)} صور فقط (الحد 8).` : "";
      for (const f of files.slice(0, room)) {
        const slot = { id: null, url: null }; imgs.push(slot); drawImgs(); uploading++;
        try { const m = (await api("POST", "/api/media", null, f)).media; slot.id = m.id; slot.url = m.thumb || m.url; } catch (er) { imgs.splice(imgs.indexOf(slot), 1); err.textContent = `تعذّر رفع «${f.name}»: ${errText(er)}`; }
        uploading--; if (form.isConnected) drawImgs();
      }
      if (form.isConnected) $("#mk-ist").textContent = `${cnt(imgs.length)} صور في الإعلان`;
    });
    const FIELDS = ["title", "description", "price", "category", "condition", "quantity", "delivery", "location", "images"];
    const LABEL = { title: "العنوان", description: "الوصف", price: "السعر", category: "الفئة", condition: "الحالة", quantity: "الكمية", delivery: "التسليم", location: "الموقع", images: "الصور" };
    const setErr = (errs) => {
      FIELDS.forEach(f => { const p = $(`#mk-e-${f}`); if (p) p.textContent = errs[f] || ""; const inp = $(`#mk-${f}`); if (inp) inp.setAttribute("aria-invalid", String(!!errs[f])); });
      const es = $("#mk-es"), keys = Object.keys(errs).filter(k => k !== "form");
      if (!keys.length && !errs.form) { es.hidden = true; es.innerHTML = ""; return; }
      es.hidden = false; es.innerHTML = `<b>لم يُحفظ الإعلان، صحّح ما يلي:</b><ul>${keys.map(k => `<li><a href="#/market" data-mk-jump="${k}">${LABEL[k]}: ${h(errs[k])}</a></li>`).join("")}${errs.form ? `<li>${h(errs.form)}</li>` : ""}</ul>`;
      es.querySelectorAll("[data-mk-jump]").forEach(a => a.addEventListener("click", (e) => { e.preventDefault(); const k = a.dataset.mkJump; (k === "images" ? $("#mk-files") : $(`#mk-${k}`))?.focus(); }));
      const first = keys[0]; const el = first === "images" ? $("#mk-files") : first ? $(`#mk-${first}`) : null; (el || es).focus();
    };
    const read = (status) => {
      const svc = kind() === "service", qv = $("#mk-quantity").value.trim();
      return { kind: svc ? "service" : "product", title: $("#mk-title").value.trim(), description: $("#mk-description").value.trim(), price: Number($("#mk-price").value), category: $("#mk-category").value,
        condition: svc ? "na" : $("#mk-condition").value, quantity: qv === "" ? (svc ? null : NaN) : Number(qv), delivery: $("#mk-delivery").value, location: $("#mk-location").value.trim() || null, images: imgs.map(x => x.id).filter(Boolean), status };
    };
    const validate = (b, raw) => {
      const e = {};
      if (b.title.length < 3 || b.title.length > 120) e.title = b.title ? "العنوان يجب أن يكون من 3 إلى 120 حرفاً." : "اكتب عنواناً للإعلان.";
      if (b.description.length > 5000) e.description = "الوصف أطول من 5000 حرف.";
      if (raw === "" || !Number.isFinite(b.price)) e.price = "اكتب السعر بعملة Pi.";
      else if (b.price < 0.01 || b.price > maxPrice) e.price = `السعر يجب أن يكون بين 0.01 و${num(maxPrice)} Pi.`;
      else if (Math.abs(Math.round(b.price * 1e7) - b.price * 1e7) > 1e-6) e.price = "السعر يقبل 7 خانات عشرية كحد أقصى.";
      if (!CAT[b.category]) e.category = "اختر فئة من القائمة.";
      if (b.quantity !== null && (!Number.isInteger(b.quantity) || b.quantity < 0)) e.quantity = b.kind === "product" ? "اكتب الكمية المتاحة (عدد صحيح 0 أو أكثر)." : "الكمية يجب أن تكون عدداً صحيحاً 0 أو أكثر.";
      if (!b.images.length) e.images = "أضف صورة واحدة على الأقل.";
      else if (b.images.length > 8) e.images = "الحد الأقصى 8 صور.";
      if (uploading) e.images = "انتظر حتى يكتمل رفع الصور.";
      return e;
    };
    const FIELD_OF = { price_invalid: "price", images_invalid: "images", category_invalid: "category" };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = e.submitter?.dataset.status || "active", b = read(status), errs = validate(b, $("#mk-price").value.trim());
      if (Object.keys(errs).length) return setErr(errs);
      setErr({}); const btns = form.querySelectorAll("button[type=submit]"); btns.forEach(x => (x.disabled = true));
      const body = { ...b }; if (edit && L.status !== "draft" && status === "active" && L.status !== "active") delete body.status;
      try {
        const r = await api(edit ? "PATCH" : "POST", edit ? `/api/market/listings/${enc(id)}` : "/api/market/listings", body), nl = r?.listing || r;
        const msg = status === "draft" ? "حُفظت المسودة" : edit ? "حُفظت التغييرات" : "نُشر إعلانك في السوق"; toast(msg); say(msg);
        location.hash = `#/market/item/${enc(nl?.id || id)}`;
      } catch (er) {
        btns.forEach(x => (x.disabled = false));
        const f = FIELD_OF[er?.code]; setErr(f ? { [f]: errText(er) } : { form: errText(er) }); $("#mk-e-form").textContent = f ? "" : errText(er);
      }
    });
    const setStatus = async (st, b) => { b.disabled = true; try { await api("PATCH", `/api/market/listings/${enc(id)}`, { status: st }); toast(st === "paused" ? "أُوقف الإعلان مؤقتاً" : "أُعيد تفعيل الإعلان"); formView(id); } catch (er) { b.disabled = false; $("#mk-e-form").textContent = errText(er); } };
    $("#mk-pause")?.addEventListener("click", (e) => setStatus("paused", e.currentTarget));
    $("#mk-resume")?.addEventListener("click", (e) => setStatus("active", e.currentTarget));
    $("#mk-del")?.addEventListener("click", () => confirmSheet("حذف الإعلان؟", "سيختفي الإعلان من السوق ونتائج البحث. الطلبات القائمة لا تتأثر.", "احذف الإعلان", async () => { await api("DELETE", `/api/market/listings/${enc(id)}`); toast("حُذف الإعلان"); O.tab = "listings"; location.hash = "#/market/orders"; }));
  }

  function confirmSheet(title, text, label, fn, extra = "") {
    const s = sheet(`<div class="mk-sheet" role="dialog" aria-modal="true" aria-labelledby="mk-ct" aria-describedby="mk-cd"><h3 id="mk-ct" tabindex="-1" class="u-m0 u-mt4 u-mb8">${h(title)}</h3><p id="mk-cd" class="u-m0 u-mb10">${h(text)}</p>${extra}
      <p class="mk-ferr" id="mk-cerr" role="alert"></p><div class="mk-btns"><button type="button" class="btn" id="mk-cgo">${h(label)}</button><button type="button" class="btn ghost" id="mk-cx">تراجع</button></div></div>`);
    s.querySelector("#mk-cx").addEventListener("click", () => closeSheet()); s.querySelector("#mk-ct").focus(); setTimeout(() => { if (document.activeElement === s.querySelector("#mk-cgo")) s.querySelector("#mk-ct")?.focus(); }, 90);
    s.querySelector("#mk-cgo").addEventListener("click", async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(s); closeSheet(); } catch (er) { b.disabled = false; s.querySelector("#mk-cerr").textContent = errText(er); } });
    return s;
  }

  /* ---------- #/market/orders (buyer / seller / my listings) ---------- */
  const O = { tab: "buyer" };
  const TABS = [["buyer", "مشترياتي"], ["seller", "مبيعاتي"], ["listings", "إعلاناتي"]];
  async function ordersView() {
    const v = view, token = begin();
    v.innerHTML = `<div class="wrap mk-page">${back("#/market", "السوق")}<h2 id="mk-h" tabindex="-1"><svg class=ix aria-hidden=true><use href=#i-box /></svg> طلباتي في السوق</h2>
      <div class="mk-tabs seg" role="tablist" aria-label="أقسام الطلبات">${TABS.map(([k, l]) => `<button type="button" role="tab" id="mk-tab-${k}" aria-controls="mk-panel" aria-selected="${O.tab === k}" tabindex="${O.tab === k ? 0 : -1}" data-mk-tab="${k}">${l}</button>`).join("")}</div>
      <div id="mk-panel" role="tabpanel" aria-labelledby="mk-tab-${O.tab}" tabindex="0"></div></div>`;
    focusH();
    const tabs = [...v.querySelectorAll("[data-mk-tab]")], panel = v.querySelector("#mk-panel");
    const pick = (k, focus) => { O.tab = k; tabs.forEach(t => { const on = t.dataset.mkTab === k; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); }); panel.setAttribute("aria-labelledby", "mk-tab-" + k); fill(); };
    tabs.forEach((t, i) => { t.addEventListener("click", () => pick(t.dataset.mkTab)); t.addEventListener("keydown", (e) => { const rtl = document.documentElement.dir !== "ltr", d = e.key === "ArrowLeft" ? (rtl ? 1 : -1) : e.key === "ArrowRight" ? (rtl ? -1 : 1) : 0; if (e.key === "Home" || e.key === "End") { e.preventDefault(); pick(tabs[e.key === "Home" ? 0 : tabs.length - 1].dataset.mkTab, true); } else if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length].dataset.mkTab, true); } }); });
    let seq = 0;
    const fill = async () => {
      const my = ++seq, k = O.tab; panel.setAttribute("aria-busy", "true"); panel.innerHTML = `<div class="skel"></div>`;
      let rows; try { rows = list(await api("GET", k === "listings" ? "/api/me/market/listings" : `/api/me/market/orders?role=${k}`), "items", "orders", "listings"); } catch (e) { if (my === seq && live(token)) { panel.removeAttribute("aria-busy"); panel.innerHTML = errBox(e); } return; }
      if (my !== seq || !live(token)) return;
      panel.removeAttribute("aria-busy");
      if (k === "listings") {
        panel.innerHTML = rows.length ? `<ul class="card" style="list-style:none;margin:0;padding:4px 14px">${rows.map(L => { const im = imgOf(L), src = safeUrl(im?.thumb || im?.url); return `<li class="mk-row" data-mk-l="${h(L.id)}">${src ? `<img class="mk-th" src="${h(src)}" alt="" loading="lazy">` : `<span class="mk-th" aria-hidden="true"></span>`}<div class="grow">${L.status === "removed" ? `<b>${h(L.title)}</b>` : `<a href="#/market/item/${enc(L.id)}">${h(L.title)}</a>`}<div class="u-t-sm muted">${pi(L.price)}${L.quantity != null ? ` · المتوفر ${cnt(L.quantity)}` : ""}${L.views != null ? ` · ${cnt(L.views)} مشاهدة` : ""}</div></div>
          <div class="mk-side">${chip(LST, L.status)}${L.status !== "removed" ? `<a class="u-t-sm muted" href="#/market/edit/${enc(L.id)}" aria-label="تعديل ${h(L.title)}">تعديل</a>` : ""}</div></li>`; }).join("")}</ul>`
          : `<div class="empty mk-empty">لم تنشر أي إعلان بعد.<br><br><a class="btn" href="#/market/new">أضف إعلاناً</a></div>`;
        return;
      }
      panel.innerHTML = rows.length ? `<ul class="card" style="list-style:none;margin:0;padding:4px 14px">${rows.map(o => { const L = o.listing || {}, im = imgOf(L), src = safeUrl(im?.thumb || im?.url), other = k === "buyer" ? o.seller : o.buyer; return `<li class="mk-row" data-mk-o="${h(o.id)}">${src ? `<img class="mk-th" src="${h(src)}" alt="" loading="lazy">` : `<span class="mk-th" aria-hidden="true"></span>`}<div class="grow"><a href="#/market/orders/${enc(o.id)}">${h(L.title || o.title || "طلب")}</a>
          <div class="u-t-sm muted">${pi(o.total)}${o.qty > 1 ? ` · ${cnt(o.qty)} قطع` : ""}${other?.handle ? ` · ${k === "buyer" ? "البائع" : "المشتري"} @${h(other.handle)}` : ""} · ${h(day(o.createdAt))}</div></div><div class="mk-side">${chip(OST, o.status)}</div></li>`; }).join("")}</ul>`
        : `<div class="empty mk-empty">${k === "buyer" ? "لم تشترِ شيئاً من السوق بعد.<br><br><a class=\"btn\" href=\"#/market\">تصفّح السوق</a>" : "لا مبيعات بعد."}</div>`;
    };
    fill();
  }

  /* ---------- #/market/orders/:id ---------- */
  const STEPS = [["pending_payment", "الدفع"], ["paid_held", "في الضمان"], ["shipped", "الشحن"], ["delivered", "التسليم"], ["completed", "مكتمل"]];
  const TLX = { ...Object.fromEntries(Object.entries(OST).map(([k, [l]]) => [k, l])), created: "أُنشئ الطلب", paid: "تم الدفع وحُجز المبلغ", review: "أُضيف تقييم", dispute: "فُتح نزاع", dispute_opened: "فُتح نزاع", dispute_resolved: "حُسم النزاع", released: "حُرّر المبلغ للبائع" };
  function actionsFor(o, role) {
    if (Array.isArray(o.actions)) return o.actions;
    const s = o.status, a = [];
    if (role === "seller") { if (s === "paid_held") a.push("ship", "deliver"); if (s === "shipped") a.push("deliver"); if (s === "pending_payment" || s === "paid_held") a.push("cancel"); }
    if (role === "buyer") { if (s === "shipped" || s === "delivered") a.push("confirm"); if (s === "pending_payment") a.push("cancel"); if (["paid_held", "shipped", "delivered"].includes(s) && !o.dispute && !o.disputeId) a.push("dispute"); if (s === "completed" && !o.review && !o.reviewId) a.push("review"); }
    return a;
  }
  const ACT = { ship: ["تم الشحن", "تأكيد الشحن؟", "سيُبلَّغ المشتري أن الطلب في الطريق."], deliver: ["تم التسليم", "تأكيد التسليم؟", "سيُبلَّغ المشتري، ويُحرَّر المبلغ تلقائياً بعد 7 أيام إن لم يؤكد أو يفتح نزاعاً."],
    confirm: ["استلمت الطلب", "تأكيد الاستلام؟", "سيُحرَّر المبلغ المحجوز للبائع نهائياً. أكّد فقط إذا وصلك الطلب كما وُصف."], cancel: ["إلغاء الطلب", "إلغاء الطلب؟", "يُلغى الطلب، وإن كان مدفوعاً يُعاد المبلغ المحجوز للمشتري."] };
  async function orderView(id) {
    const v = view, token = begin();
    v.innerHTML = `<div class="wrap mk-page">${back("#/market/orders", "طلباتي")}<div class="skel"></div><div class="skel"></div></div>`;
    let o; try { const r = await api("GET", `/api/market/orders/${enc(id)}`); o = r?.order || r; } catch (e) { if (live(token)) { v.innerHTML = `<div class="wrap mk-page">${back("#/market/orders", "طلباتي")}<h2 id="mk-h" tabindex="-1">الطلب</h2>${e?.status === 404 || e?.status === 403 ? `<div class="empty mk-empty">هذا الطلب غير موجود أو ليس لك.</div>` : errBox(e)}</div>`; focusH(); } return; }
    if (!live(token)) return;
    const me = meId(), buyerId = o.buyer?.id || o.buyerId, sellerId = o.seller?.id || o.sellerId;
    const role = o.role || (buyerId === me ? "buyer" : sellerId === me ? "seller" : DB.isAdmin ? "admin" : "");
    const L = o.listing || {}, im = imgOf(L), src = safeUrl(im?.thumb || im?.url), E = o.escrow || {}, acts = actionsFor(o, role);
    const si = STEPS.findIndex(([k]) => k === o.status), ended = ["cancelled", "refunded", "disputed"].includes(o.status);
    const tl = list(o.timeline);
    const other = role === "buyer" ? o.seller : o.buyer, cid = o.conversationId;
    v.innerHTML = `<div class="wrap mk-page" data-mk-order="${h(o.id)}">${back("#/market/orders", "طلباتي")}<h2 id="mk-h" tabindex="-1">طلب: ${h(L.title || "")}</h2>
      <section class="card mk-row" style="padding:12px 14px">${src ? `<img class="mk-th" src="${h(src)}" alt="">` : ""}<div class="grow">${L.id ? `<a href="#/market/item/${enc(L.id)}">${h(L.title || "الإعلان")}</a>` : `<b>${h(L.title || "")}</b>`}
        <div class="u-t-sm muted">${cnt(o.qty || 1)} × ${pi(o.unitPrice ?? L.price)} = <b>${pi(o.total)}</b></div>
        <div class="u-t-sm muted">${role === "buyer" ? "البائع" : role === "seller" ? "المشتري" : "الطرفان"}: ${role === "admin" ? `@${h(o.buyer?.handle || "؟")} ← @${h(o.seller?.handle || "؟")}` : other?.handle ? `<a href="#/${role === "buyer" ? "market/seller" : "u"}/${enc(other.handle)}">@${h(other.handle)}</a>` : "—"}</div></div><div class="mk-side">${chip(OST, o.status)}</div></section>
      ${ended ? "" : `<ol class="mk-steps" aria-label="مراحل الطلب">${STEPS.map(([k, l], i) => `<li class="${i < si || (i === si && k === "completed") ? "done" : ""}"${i === si && k !== "completed" ? ' aria-current="step"' : ""}>${l}</li>`).join("")}</ol>`}
      <section class="card mk-escrow ${h(E.state || "")}" aria-labelledby="mk-esc"><h3 id="mk-esc" class="u-m0 u-mb6 u-t-lg"><svg class=ix aria-hidden=true><use href=#i-lock /></svg> الضمان</h3>
        <p class="u-m0">${E.state ? h(EST[E.state] || E.state) : o.status === "pending_payment" ? "لم يُدفع بعد." : "—"}${E.amount != null ? ` · ${pi(E.amount ?? E.held)}` : ""}</p>
        ${E.state === "split" && (E.buyerAmount != null || E.sellerAmount != null) ? `<p class="u-m0 u-mt4 u-t-sm muted">للمشتري ${pi(E.buyerAmount)} · للبائع ${pi(E.sellerAmount)}</p>` : ""}
        ${o.status === "delivered" ? `<p class="u-m0 u-mt4 u-t-sm muted">يُحرَّر تلقائياً للبائع ${o.autoReleaseAt ? `في ${h(day(o.autoReleaseAt))}` : "بعد 7 أيام من التسليم"} ما لم يُفتح نزاع.</p>` : ""}</section>
      <div class="mk-btns" id="mk-acts">${acts.filter(a => ACT[a]).map(a => `<button type="button" class="btn${a === "cancel" ? " ghost" : ""}" data-mk-act="${a}">${ACT[a][0]}</button>`).join("")}
        ${cid ? `<a class="btn ghost" href="#/chat/${enc(cid)}" id="mk-chat"><svg class=ix aria-hidden=true><use href=#i-comment /></svg> محادثة الطلب</a>` : ""}${acts.includes("dispute") ? `<button type="button" class="btn ghost" id="mk-disp"><svg class=ix aria-hidden=true><use href=#i-alert /></svg> فتح نزاع</button>` : ""}</div>
      ${acts.includes("review") ? reviewForm() : o.review ? `<section class="card"><h3 class="u-m0 u-mb6 u-t-lg">تقييمك</h3>${stars(o.review.rating)}<p class="u-m0 u-mt6">${h(o.review.text || "")}</p></section>` : ""}
      <div id="mk-dsp"></div>
      <section class="card"><h3 class="u-m0 u-mb8 u-t-lg">سجل الطلب</h3>${tl.length ? `<ol class="mk-tl">${tl.map(t => `<li><b>${h(TLX[t.status || t.event || t.type] || t.label || t.status || t.event || "")}</b> <span class="u-t-xs muted">${h(day(t.at || t.createdAt))}</span>${t.note || t.text ? `<div class="u-t-sm muted">${h(t.note || t.text)}</div>` : ""}</li>`).join("")}</ol>` : `<p class="u-m0 muted">أُنشئ ${h(day(o.createdAt))}</p>`}</section></div>`;
    focusH();
    const reload = () => orderView(id).then(() => v.querySelector("#mk-h")?.focus());
    v.querySelectorAll("[data-mk-act]").forEach(b => b.addEventListener("click", () => { const a = b.dataset.mkAct, [label, t, d] = ACT[a]; confirmSheet(t, d, label, async () => { await api("POST", `/api/market/orders/${enc(id)}/${a}`); const m = { ship: "سُجّل الشحن", deliver: "سُجّل التسليم", confirm: "تم تأكيد الاستلام وحُرّر المبلغ للبائع", cancel: "أُلغي الطلب" }[a]; toast(m); say(m); setTimeout(reload, 0); }); }));
    v.querySelector("#mk-disp")?.addEventListener("click", () => disputeSheet(id, reload));
    const rf = v.querySelector("#mk-rf");
    rf?.addEventListener("submit", async (e) => {
      e.preventDefault(); const rating = Number(rf.querySelector("input[name=mk-rating]:checked")?.value || 0), text = rf.querySelector("#mk-rtext").value.trim(), err = rf.querySelector("#mk-rerr");
      if (!rating) { err.textContent = "اختر عدد النجوم من 1 إلى 5."; return rf.querySelector("input[name=mk-rating]").focus(); }
      if (text.length > 1000) { err.textContent = "التقييم أطول من 1000 حرف."; return; }
      const b = rf.querySelector("button[type=submit]"); b.disabled = true;
      try { await api("POST", `/api/market/orders/${enc(id)}/review`, { rating, text }); toast("شكراً، نُشر تقييمك"); say("نُشر تقييمك"); reload(); } catch (er) { b.disabled = false; err.textContent = errText(er); }
    });
    const did = o.dispute?.id || o.disputeId; if (did) disputePanel(v.querySelector("#mk-dsp"), did, role, token);
  }
  const reviewForm = () => `<form class="card" id="mk-rf" novalidate><h3 class="u-m0 u-mb4 u-t-lg">قيّم البائع</h3>
    <fieldset class="mk-rate"><legend>التقييم</legend><div class="mk-rs">${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="mk-rating" id="mk-r${n}" value="${n}"><label for="mk-r${n}" title="${cnt(n)} من 5"><span aria-hidden="true">★</span><span class="mk-sr">${cnt(n)} ${n === 1 ? "نجمة" : "نجوم"}</span></label>`).join("")}</div></fieldset>
    <label class="mk-f"><span>رأيك (اختياري، حتى 1000 حرف)</span><textarea id="mk-rtext" maxlength="1000"></textarea></label><p class="mk-ferr" id="mk-rerr" role="alert"></p><button type="submit" class="btn">نشر التقييم</button></form>`;

  /* ---------- disputes ---------- */
  function disputeSheet(orderId, done) {
    const ev = [];
    const s = sheet(`<div class="mk-sheet" role="dialog" aria-modal="true" aria-labelledby="mk-dt"><h3 id="mk-dt" tabindex="-1" class="u-m0 u-mt4 u-mb8"><svg class=ix aria-hidden=true><use href=#i-alert /></svg> فتح نزاع</h3>
      <form id="mk-df" novalidate><p class="u-t-sm u-m0 u-mb8 muted">يبقى المبلغ محجوزاً حتى تراجع الإدارة النزاع وتقرر: إعادة المبلغ، أو تحريره للبائع، أو تقسيمه.</p>
      <fieldset class="u-b0 u-p0 mk-f"><legend>السبب</legend>${Object.entries(REASON).map(([k, l], i) => `<label class="mk-radio"><input type="radio" name="mk-dr" value="${k}"${i ? "" : " checked"}> ${l}</label>`).join("")}</fieldset>
      <label class="mk-f"><span>اشرح المشكلة</span><textarea id="mk-dtext" maxlength="2000" aria-describedby="mk-derr"></textarea></label>
      <div class="mk-f"><span>أدلة (صور، حتى 4)</span><ul class="u-lsn u-p0 mk-ev" id="mk-dev"></ul><label class="btn ghost mk-add"><input type="file" id="mk-dfile" accept="image/*" multiple><span aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-link /></svg></span> إرفاق صور</label></div>
      <p class="mk-ferr" id="mk-derr" role="alert"></p>
      <div class="mk-btns"><button type="submit" class="btn" id="mk-dgo">إرسال النزاع</button><button type="button" class="btn ghost" id="mk-dx">تراجع</button></div></form></div>`);
    const $s = (q) => s.querySelector(q);
    $s("#mk-dx").addEventListener("click", () => closeSheet()); $s("#mk-dt").focus();
    const draw = () => { $s("#mk-dev").innerHTML = ev.map((m, i) => `<li><span><img src="${h(safeUrl(m.url))}" alt="دليل ${cnt(i + 1)}"></span></li>`).join(""); };
    $s("#mk-dfile").addEventListener("change", async (e) => {
      const files = [...e.target.files].filter(f => /^image\//.test(f.type)).slice(0, 4 - ev.length); e.target.value = "";
      for (const f of files) { try { const m = (await api("POST", "/api/media", null, f)).media; ev.push({ id: m.id, url: m.thumb || m.url }); draw(); } catch (er) { $s("#mk-derr").textContent = errText(er); } }
    });
    $s("#mk-df").addEventListener("submit", async (e) => {
      e.preventDefault(); const reason = $s("input[name=mk-dr]:checked").value, text = $s("#mk-dtext").value.trim();
      if (text.length < 10) { $s("#mk-derr").textContent = "اشرح المشكلة في 10 أحرف على الأقل."; return $s("#mk-dtext").focus(); }
      const b = $s("#mk-dgo"); b.disabled = true;
      try { await api("POST", `/api/market/orders/${enc(orderId)}/dispute`, { reason, text, ...(ev.length ? { evidence: ev.map(x => x.id) } : {}) }); closeSheet(); toast("فُتح النزاع، ستراجعه الإدارة"); say("فُتح النزاع"); done?.(); }
      catch (er) { b.disabled = false; $s("#mk-derr").textContent = errText(er); }
    });
  }
  async function disputePanel(box, did, role, token) {
    if (!box) return;
    box.innerHTML = `<div class="skel"></div>`;
    let d; try { const r = await api("GET", `/api/market/disputes/${enc(did)}`); d = r?.dispute || r; } catch (e) { if (live(token)) box.innerHTML = errBox(e); return; }
    if (!live(token)) return;
    const msgs = list(d.messages), evid = list(d.evidence).map(x => (typeof x === "string" ? { id: x } : x));
    box.innerHTML = `<section class="card mk-note" aria-labelledby="mk-dh"><h3 id="mk-dh" class="u-m0 u-mb6 u-t-lg"><svg class=ix aria-hidden=true><use href=#i-alert /></svg> النزاع · ${d.status === "resolved" ? `حُسم: ${h(RES[d.resolution] || d.resolution || "")}` : d.status === "seller_responded" ? "ردّ البائع" : "مفتوح"}</h3>
      <p class="u-m0 u-mb4"><b>${h(REASON[d.reason] || d.reason || "")}</b>${d.openedBy?.handle ? ` <span class="muted">— @${h(d.openedBy.handle)}</span>` : ""}</p>${d.text ? `<p class="u-m0 u-mb6 mk-desc">${h(d.text)}</p>` : ""}
      ${evid.length ? `<div class="mk-ev" aria-label="الأدلة">${evid.map((x, i) => safeUrl(x.url) ? `<a href="${h(safeUrl(x.url))}" target="_blank" rel="noopener"><img src="${h(safeUrl(x.thumb || x.url))}" alt="دليل ${cnt(i + 1)}" loading="lazy"></a>` : "").join("")}</div>` : ""}
      ${d.status === "resolved" && d.resolution === "split" && d.buyerAmount != null ? `<p class="u-t-sm muted">أُعيد للمشتري ${pi(d.buyerAmount)}</p>` : ""}
      <ul class="mk-msgs" aria-label="رسائل النزاع">${msgs.map(m => `<li class="${m.admin || m.role === "admin" || m.role === "staff" ? "adm" : ""}"><b>${m.admin || m.role === "admin" || m.role === "staff" ? "الإدارة" : "@" + h(m.author?.handle || m.by || "؟")}</b> <span class="u-t-xs muted">${h(day(m.at || m.createdAt))}</span><div>${h(m.text)}</div></li>`).join("")}</ul>
      ${d.status !== "resolved" ? `<form id="mk-dmf" novalidate><label class="mk-f"><span>أضف رداً أو توضيحاً</span><textarea id="mk-dm" maxlength="2000" class="u-mh70"></textarea></label><p class="mk-ferr" id="mk-dmerr" role="alert"></p><button class="btn ghost" type="submit">إرسال</button></form>` : ""}</section>`;
    const f = box.querySelector("#mk-dmf");
    f?.addEventListener("submit", async (e) => { e.preventDefault(); const t = f.querySelector("#mk-dm").value.trim(); if (!t) { f.querySelector("#mk-dmerr").textContent = "اكتب رسالتك أولاً."; return; } const b = f.querySelector("button"); b.disabled = true; try { await api("POST", `/api/market/disputes/${enc(did)}/messages`, { text: t }); toast("أُرسلت الرسالة"); disputePanel(box, did, role, token); } catch (er) { b.disabled = false; f.querySelector("#mk-dmerr").textContent = errText(er); } });
  }

  /* ---------- #/market/seller/:handle ---------- */
  async function sellerView(handle) {
    const v = view, token = begin();
    v.innerHTML = `<div class="wrap mk-page">${back("#/market", "السوق")}<div class="skel"></div></div>`;
    let d; try { d = await api("GET", `/api/market/sellers/${enc(handle)}`); } catch (e) { if (live(token)) { v.innerHTML = `<div class="wrap mk-page">${back("#/market", "السوق")}<h2 id="mk-h" tabindex="-1">@${h(handle)}</h2>${e?.status === 404 ? `<div class="empty mk-empty">لا يوجد بائع بهذا الاسم.</div>` : errBox(e)}</div>`; focusH(); } return; }
    if (!live(token)) return;
    const sel = d.seller || d.profile || d.user || {}, r = sel.rating || d.rating || {}, mine = (sel.id && sel.id === meId()) || sel.handle === meHandle();
    let reviews = Array.isArray(d.reviews) ? d.reviews : list(d.reviews || d, "items", "reviews"), next = d.reviews?.next || d.next || null;
    const dist = r.distribution || r.dist || sel.distribution;
    const revHtml = (x) => `<li class="mk-rev" data-mk-rev="${h(x.id)}"><div>${stars(x.rating)} <b>${h(x.buyer?.name || x.buyer?.handle || x.author?.handle || "مشترٍ")}</b> <span class="u-t-xs muted">${h(day(x.createdAt || x.at))}</span>${x.listing?.title ? ` <span class="u-t-xs muted">· ${h(x.listing.title)}</span>` : ""}</div>
      ${x.text ? `<p>${h(x.text)}</p>` : ""}${x.reply ? `<div class="mk-reply"><b>رد البائع:</b> ${h(typeof x.reply === "string" ? x.reply : x.reply.text)}</div>` : mine ? `<button type="button" class="u-mt6 btn ghost" data-mk-reply="${h(x.id)}" aria-label="الرد على تقييم ${h(x.buyer?.handle || "")}">ردّ</button>` : ""}</li>`;
    v.innerHTML = `<div class="wrap mk-page">${back("#/market", "السوق")}<section class="card"><div class="mk-seller">${avatar(sel)}<div class="grow"><h2 id="mk-h" tabindex="-1" class="u-m0 u-t-xl">${h(sel.name || handle)}</h2><span class="muted">@${h(sel.handle || handle)}</span></div><a class="btn ghost" href="#/u/${enc(sel.handle || handle)}">الملف الشخصي</a></div>
      <div class="u-mt12 mk-sum"><span class="big">${r.count ? h(Number(r.avg || 0).toLocaleString("ar-EG", { maximumFractionDigits: 1 })) : "—"}</span><div>${stars(r.avg, r.count || 0)}<div class="u-t-sm muted">${cnt(r.count)} تقييم · ${cnt(sel.sales ?? d.sales)} عملية بيع</div></div></div>
      ${dist && r.count ? `<ul class="u-lsn u-p0 u-m0 u-mt10" aria-label="توزيع التقييمات">${[5, 4, 3, 2, 1].map(n => { const c = Number(dist[n] || 0), w = r.count ? Math.round((c / r.count) * 100) : 0; return `<li class="u-dflex u-aic u-g8 u-t-xs"><span>${cnt(n)}★</span><span style="flex:1;height:6px;border-radius:3px;background:var(--bg-2);overflow:hidden" aria-hidden="true"><span style="display:block;height:100%;width:${w}%;background:#f5a524"></span></span><span class="mk-sr">${cnt(n)} نجوم:</span><span>${cnt(c)}</span></li>`; }).join("")}</ul>` : ""}</section>
      ${list(d.listings).length ? `<h3 class="u-t-lg">إعلانات البائع</h3><ul class="mk-grid">${list(d.listings).map(card).join("")}</ul>` : ""}
      <h3 class="u-t-lg">التقييمات</h3><div class="card" style="padding:4px 14px">${reviews.length ? `<ul class="u-lsn u-m0 u-p0" id="mk-revs">${reviews.map(revHtml).join("")}</ul>` : `<p class="muted">لا تقييمات بعد.</p>`}</div>
      <div class="mk-more" id="mk-rmore">${next ? `<button type="button" class="btn ghost" id="mk-rm">تقييمات أقدم</button>` : ""}</div></div>`;
    focusH();
    const bindReplies = () => v.querySelectorAll("[data-mk-reply]").forEach(b => { if (b._mk) return; b._mk = 1; b.addEventListener("click", () => {
      const li = b.closest("[data-mk-rev]"), rid = b.dataset.mkReply; b.remove();
      li.insertAdjacentHTML("beforeend", `<form class="mk-rpf" novalidate><label class="mk-f"><span>ردّك على التقييم</span><textarea maxlength="1000" class="u-mh70"></textarea></label><p class="mk-ferr" role="alert"></p><div class="mk-btns"><button type="submit" class="btn">نشر الرد</button></div></form>`);
      const f = li.querySelector(".mk-rpf"), ta = f.querySelector("textarea"); ta.focus();
      f.addEventListener("submit", async (e) => { e.preventDefault(); const t = ta.value.trim(); if (!t) { f.querySelector(".mk-ferr").textContent = "اكتب ردك أولاً."; return; } const sb = f.querySelector("button"); sb.disabled = true;
        try { await api("POST", `/api/market/reviews/${enc(rid)}/reply`, { text: t }); f.outerHTML = `<div class="mk-reply" tabindex="-1"><b>رد البائع:</b> ${h(t)}</div>`; li.querySelector(".mk-reply").focus(); toast("نُشر ردك"); } catch (er) { sb.disabled = false; f.querySelector(".mk-ferr").textContent = errText(er); } });
    }); });
    bindReplies();
    const more = async () => { const b = v.querySelector("#mk-rm"); if (!b) return; b.disabled = true; try { const r2 = await api("GET", `/api/market/sellers/${enc(handle)}?cursor=${enc(next)}`), add = Array.isArray(r2.reviews) ? r2.reviews : list(r2.reviews || r2, "items", "reviews"); next = r2.reviews?.next || r2.next || null; reviews = reviews.concat(add); v.querySelector("#mk-revs")?.insertAdjacentHTML("beforeend", add.map(revHtml).join("")); bindReplies(); v.querySelector("#mk-rmore").innerHTML = next ? `<button type="button" class="btn ghost" id="mk-rm">تقييمات أقدم</button>` : ""; v.querySelector("#mk-rm")?.addEventListener("click", more); say(`حُمّل ${cnt(add.length)} تقييماً`); } catch (e) { b.disabled = false; toast(errText(e)); } };
    v.querySelector("#mk-rm")?.addEventListener("click", more);
  }

  /* ---------- #/admin/market/disputes ---------- */
  async function adminDisputes() {
    if (!DB.isAdmin) return Views.notFound();
    const v = view, token = begin();
    v.innerHTML = `<div class="wrap mk-page">${back("#/admin", "الإدارة")}<h2 id="mk-h" tabindex="-1"><svg class=ix aria-hidden=true><use href=#i-shield /></svg> نزاعات السوق</h2><div id="mk-aq" aria-busy="true"><div class="skel"></div></div></div>`;
    focusH();
    const load = async () => {
      const box = v.querySelector("#mk-aq"); if (!box) return;
      let rows; try { rows = list(await api("GET", "/api/admin/market/disputes"), "items", "disputes"); } catch (e) { if (live(token) && box.isConnected) { box.removeAttribute("aria-busy"); box.innerHTML = errBox(e); } return; }
      if (!live(token) || !box.isConnected) return;
      box.removeAttribute("aria-busy");
      const open = rows.filter(d => d.status !== "resolved");
      box.innerHTML = open.length ? `<ul class="card" style="list-style:none;margin:0;padding:4px 14px">${open.map(d => { const o = d.order || {}, L = o.listing || d.listing || { title: d.title || o.title }, total = Number(o.total ?? d.total ?? d.amount), ev = list(d.evidence).map(x => (typeof x === "string" ? { id: x } : x)); return `<li class="mk-row" data-mk-d="${h(d.id)}" data-total="${h(total)}"><div class="grow" style="white-space:normal">
        <b>${h(REASON[d.reason] || d.reason || "")}</b> · ${pi(total)} ${d.status === "seller_responded" ? chip({ x: ["ردّ البائع", "info"] }, "x") : chip({ x: ["مفتوح", "bad"] }, "x")}
        <div class="u-t-sm muted">${o.id || d.orderId ? `<a href="#/market/orders/${enc(o.id || d.orderId)}">${h(L.title || "الطلب")}</a> · ` : ""}المشتري @${h(d.buyer?.handle || o.buyer?.handle || "؟")} · البائع @${h(d.seller?.handle || o.seller?.handle || "؟")} · ${h(day(d.createdAt))}</div>
        ${d.text ? `<p class="u-my6 u-t-md">«${h(d.text)}»</p>` : ""}${ev.length ? `<div class="mk-ev">${ev.map((x, i) => safeUrl(x.url) ? `<a href="${h(safeUrl(x.url))}" target="_blank" rel="noopener"><img src="${h(safeUrl(x.thumb || x.url))}" alt="دليل ${cnt(i + 1)}" loading="lazy"></a>` : "").join("")}</div>` : ""}
        <fieldset class="u-b0 u-p0 mk-f"><legend>القرار</legend>${Object.entries(RES).map(([k, l], i) => `<label class="mk-radio"><input type="radio" name="mk-res-${h(d.id)}" value="${k}"${i ? "" : " checked"}> ${l}</label>`).join("")}</fieldset>
        <label class="mk-f" data-split hidden><span>المبلغ المُعاد للمشتري (Pi)</span><input type="number" data-amt min="0.0000001" max="${h(total)}" step="any" dir="ltr" inputmode="decimal"><p class="mk-hint">والباقي يُحرَّر للبائع. الإجمالي ${h(piTxt(total))}.</p></label>
        <p class="mk-ferr" data-err role="alert"></p><button type="button" class="btn" data-mk-resolve aria-label="تنفيذ القرار في نزاع ${h(L.title || d.id)}">تنفيذ القرار</button></div></li>`; }).join("")}</ul>`
        : `<div class="empty mk-empty">لا نزاعات مفتوحة. ✓</div>`;
      box.querySelectorAll("[data-mk-d]").forEach(li => {
        const sp = li.querySelector("[data-split]");
        li.querySelectorAll("input[type=radio]").forEach(r => r.addEventListener("change", () => { sp.hidden = li.querySelector("input[type=radio]:checked").value !== "split"; }));
        li.querySelector("[data-mk-resolve]").addEventListener("click", async (e) => {
          const b = e.currentTarget, resolution = li.querySelector("input[type=radio]:checked").value, total = Number(li.dataset.total), err = li.querySelector("[data-err]"), body = { resolution };
          if (resolution === "split") { const a = Number(li.querySelector("[data-amt]").value); if (!(a > 0) || !(a < total)) { err.textContent = `المبلغ يجب أن يكون أكبر من 0 وأقل من ${piTxt(total)}.`; return li.querySelector("[data-amt]").focus(); } body.buyerAmount = a; }
          err.textContent = ""; b.disabled = true;
          try { await api("POST", `/api/admin/market/disputes/${enc(li.dataset.mkD)}/resolve`, body); const m = `حُسم النزاع: ${RES[resolution]}`; toast(m); say(m); await load(); v.querySelector("#mk-h")?.focus(); }
          catch (er) { b.disabled = false; err.textContent = errText(er); }
        });
      });
    };
    load();
  }

  /* ---------- wiring ---------- */
  function marketRoute(a, b) {
    document.body.classList.toggle("mk-wide", !a);
    const id = decodeURIComponent((b || "").split("?")[0]);
    if (!a) return gridView();
    if (a === "item" && id) return itemView(id);
    if (a === "new") return formView(null);
    if (a === "edit" && id) return formView(id);
    if (a === "orders") return id ? orderView(id) : ordersView();
    if (a === "seller" && id) return sellerView(id);
    return Views.notFound();
  }
  addEventListener("hashchange", () => { if (!/^#\/market\/?(\?|$)/.test(location.hash)) document.body.classList.remove("mk-wide"); if (!/^#\/market\/item\//.test(location.hash)) document.getElementById("mk-lb")?.remove(); });
  MPRoutes.extend((a, b, prev) => {
    return { market: () => { if (a === "edit" && b) { api("GET", `/api/market/listings/${enc(b)}`).then((r) => { if ((r?.listing || r)?.kind === "digital") location.replace("#/digital/edit/" + enc(b)); }).catch(() => { }); }
        const r = marketRoute(a, b); if (!a) Promise.resolve(r).then(() => { const t = document.getElementById("mk-h"); if (t && !document.getElementById("mk-dg")) (t.closest(".page-head") || t).insertAdjacentHTML("afterend", `<a id="mk-dg" class="list li" href="#/digital"><span class="ico"><svg class="ic sm" aria-hidden="true"><use href="#i-download"/></svg></span><span class="t"><b>المنتجات الرقمية</b><small>كتب وقوالب ودورات بتسليم فوري</small></span><span class="chev" aria-hidden="true">←</span></a>`); }); return r; } };
  });
  MPRoutes.add("admin", (a, b, next) => {
        if (a === "market") return b === "disputes" || !b ? adminDisputes() : Views.notFound();
        next();
        if (!a && DB.isAdmin) setTimeout(() => { if (location.hash === "#/admin" && !document.getElementById("mk-adm")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-dflex u-aic u-g12 u-ci u-tdn card" id="mk-adm" href="#/admin/market/disputes"><span aria-hidden="true" class="u-t-3xl"><svg class=ix aria-hidden=true><use href=#i-shield /></svg></span><span class="u-f1"><b>نزاعات السوق</b><span class="u-db muted">مراجعة النزاعات وحسمها: إعادة المبلغ أو تحريره أو تقسيمه</span></span><span class="fwd" aria-hidden="true">←</span></a>`); }, 0);
      });
  window.MPMarket = { grid: gridView, item: itemView, form: formView, orders: ordersView, order: orderView, seller: sellerView, admin: adminDisputes, lightbox, filters: G, version: "2.12.0" };
  piCfg().catch(() => { }); mkCfg().catch(() => { });
  if (/^#\/(market|admin\/market)(\/|$|\?)/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
