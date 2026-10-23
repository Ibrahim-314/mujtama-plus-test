/* =====================================================================
 * مجتمع بلس — Phase 38 UI: subscriber-only posts & pay-per-view (lazy "paid" chunk, loaded by the "tips" chunk).
 * • Locked post card / post page: teaser only, blurred media placeholder (no media URL is ever rendered), lock card with
 *   the minimum tier + tiers CTA (#/support/:handle) for supporters-only posts, or «افتح مقابل X π» for PPV posts.
 *   Unlock: POST /api/paid/:postId/intent → {intent, purchaseId} → MPPi.pay({intent}) → Pi.createPayment(intent as returned)
 *   → re-hydrate (/api/bootstrap) so the full post replaces the teaser.
 * • Composer (composer v3 «خيارات النشر»): مجاني / للداعمين فقط (+ minimum tier) / دفع مرة واحدة (+ price, teaser).
 *   Sent as `paid:{mode, minTierId?, price?, teaser?}` on POST /api/posts (v2.50: through the composer hook API).
 * • #/me/purchases (+ refund request), #/me/paid-posts (creator: unlocks + revenue), #/admin/paid (refunds queue),
 *   a card on #/admin, links on #/creator and in Settings.
 * • Pi off → no buy buttons, Arabic «not enabled yet» note; locked teasers still render; composer paid options disabled.
 * REST contract: /workspace/wt/BRIEF-P38.md (+ docs/integration/p38.md of the server branch). Styles injected here.
 * ===================================================================== */
(function PaidUI() {
  if (window.MPPaid) return;
  const A = () => (typeof PiAdapter !== "undefined" ? PiAdapter : null);
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => esc(String(s ?? ""));
  const enc = encodeURIComponent;
  const pi = (n) => { const x = Number(n); return `<bdi dir="ltr" class="pd-n">${Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: 7 }) : h(n)} π</bdi>`; };
  const piTxt = (n) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 7 })} Pi`;
  const cnt = (n) => Number(n || 0).toLocaleString("ar-EG");
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso); } };
  const list = (r, ...keys) => Array.isArray(r) ? r : (keys.map(k => r?.[k]).find(Array.isArray) || []);
  const say = (msg) => { let r = document.getElementById("pd-say"); if (!r) { r = document.createElement("div"); r.id = "pd-say"; r.className = "pd-sr"; r.setAttribute("aria-live", "polite"); document.body.appendChild(r); } r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); };
  const live = (t) => view._pd === t && location.hash === t.h;
  const focusH = () => { const t = document.getElementById("pd-h"); if (t && (!document.activeElement || document.activeElement === document.body || !view.contains(document.activeElement))) t.focus({ preventScroll: true }); };
  const OFF = "مدفوعات Pi غير مفعّلة بعد. سيُتاح فتح المحتوى المدفوع فور تفعيلها.";
  const ERR = {
    already_unlocked: "هذا المحتوى مفتوح لك بالفعل.", own_post: "هذا منشورك، لا تحتاج لشرائه.", minor_restricted: "المحتوى المدفوع غير متاح لمن هم دون 18 عاماً.",
    not_configured: OFF, pi_disabled: OFF, pi_not_linked: "اربط حساب Pi أولاً من الإعدادات ← Pi Network.", creator_disabled: "هذا المبدع لم يفعّل المحتوى المدفوع.",
    blocked: "لا يمكن الشراء بسبب حظر بينكما.", not_ppv: "هذا المنشور للداعمين، يُفتح بالدعم الشهري لا بالشراء.", sign_in: "سجّل الدخول أولاً.", not_paid: "هذا المنشور لم يعد مدفوعاً.", price_invalid: "السعر يجب أن يكون بين 0.01 و100 Pi.", paid_price: "السعر يجب أن يكون بين 0.01 و100 Pi.",
    refund_window: "انتهت مهلة طلب الاسترداد (24 ساعة).", refund_window_passed: "انتهت مهلة طلب الاسترداد (24 ساعة من التغيير).", refund_pending: "طلب الاسترداد قيد المراجعة.", not_refundable: "هذه العملية غير قابلة للاسترداد.", paid_locked: "هذا المحتوى مقفل.", refund_not_eligible: "لا يحق الاسترداد إلا إذا عدّل الناشر المنشور أو حذفه أو أزالته الإدارة.", refund_exists: "طلبت الاسترداد لهذه العملية من قبل.", tier_not_found: "مستوى الدعم المختار لم يعد موجوداً."
  };
  const errText = (e) => (e?.code && /[\u0600-\u06FF]/.test(e.message || "") && e.message !== "تعذر الاتصال بالخادم" ? e.message : ERR[e?.code]) || (e?.status === 429 ? "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة." : e?.status === 501 ? OFF : e?.message || "تعذّرت العملية.");
  const PST = { completed: ["مفتوح لك", "ok"], active: ["مفتوح لك", "ok"], pending: ["قيد المراجعة", "wait"], duplicate: ["مفتوح لك", "ok"], refund_requested: ["طلب استرداد قيد المراجعة", "wait"], requested: ["قيد المراجعة", "wait"], refunded: ["مُسترد", "info"], approved: ["مُسترد", "info"], refund_rejected: ["رُفض الاسترداد", "bad"], rejected: ["مرفوض", "bad"], revoked: ["أُلغي الوصول", "mute"] };
  const chip = (s) => { const [t, c] = PST[s] || [s || "—", "mute"]; return `<span class="pi-chip ${c}">${h(t)}</span>`; };
  const KINDS = { edited: "عدّل الناشر المنشور", edit: "عدّل الناشر المنشور", deleted: "حذف الناشر المنشور", delete: "حذف الناشر المنشور", removed: "أزالته الإدارة", moderation: "أزالته الإدارة", duplicate: "شراء مكرر (تلقائي)" };

  /* ---------- styles (kept out of the core CSS budget) ---------- */
  if (!document.getElementById("pd-css")) document.head.insertAdjacentHTML("beforeend", `<style id="pd-css">
.pd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pd-n{white-space:nowrap;font-variant-numeric:tabular-nums}.pd-page{max-width:640px;margin:auto}.pd-page h2:focus,.pd-sheet h3:focus,#pd-done:focus{outline:none}
.pd-lock{margin:10px 0 4px;border:1.5px solid #c9b6f2;border-radius:16px;padding:12px 14px;background:linear-gradient(160deg,#f6f1ff,#fff8e8);color:#2b1a4f}
[data-theme=dark] .pd-lock{background:linear-gradient(160deg,#241a3a,#2a2416);border-color:#5b4a86;color:#efe8ff}
.pd-lock h4{margin:0 0 4px;font-size:15px;display:flex;align-items:center;gap:6px}.pd-lock p{margin:4px 0 8px;font-size:13.5px;line-height:1.6}
.pd-lock .pd-tiers{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;padding:0;list-style:none}.pd-lock .pd-tiers li{border:1px solid #c9b6f2;border-radius:999px;padding:2px 10px;font-size:12.5px;background:rgba(255,255,255,.6)}
[data-theme=dark] .pd-lock .pd-tiers li{background:rgba(0,0,0,.2);border-color:#5b4a86}
.pd-lock .pd-cta{display:flex;flex-wrap:wrap;gap:8px}.pd-lock .pd-cta>*{flex:1 1 150px;text-align:center;text-decoration:none}
.pd-lock .pd-off{font-weight:700;color:#6e4300;background:#fff3d6;border-radius:10px;padding:6px 10px;margin:0}[data-theme=dark] .pd-lock .pd-off{background:#3a2c0c;color:#ffd27a}
.pd-blur{position:relative;height:150px;border-radius:14px;margin:8px 0;overflow:hidden;background:linear-gradient(135deg,#8f7bd0,#e7b65a 55%,#6fb3c9);display:grid;place-items:center}
.pd-blur::before{content:"";position:absolute;inset:-20px;background:inherit;filter:blur(18px);opacity:.85}.pd-blur span{position:relative;background:rgba(20,10,40,.72);color:#fff;border-radius:999px;padding:6px 14px;font-weight:700;font-size:13px}
.pd-blur::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.28) 50%,transparent 70%);transform:translateX(-100%);animation:pdshine 2.8s ease-in-out infinite}
@keyframes pdshine{to{transform:translateX(100%)}}@media (prefers-reduced-motion:reduce){.pd-blur::after{animation:none;display:none}}
.pd-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;margin:6px 0 0;background:#efe7ff;color:#4a2a9a}[data-theme=dark] .pd-badge{background:#2f2350;color:#dccfff}
.pd-opts{border:1.5px dashed var(--line);border-radius:14px;padding:10px 12px;margin:10px 0}.pd-opts legend{font-weight:800;padding:0 6px}
.pd-opts .pd-r{display:flex;align-items:center;gap:8px;margin:6px 0;font-weight:600}.pd-tnote{font-weight:400;font-size:13px}.pd-opts .pd-r input{width:20px;height:20px;margin:0}
.pd-f{display:block;margin:8px 0}.pd-f>span{display:block;font-weight:700;margin-bottom:4px;font-size:14px}.pd-f input,.pd-f select,.pd-f textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--line);border-radius:12px;padding:9px 12px;font:inherit;background:var(--card);color:inherit}
.pd-f textarea{min-height:60px;resize:vertical}.pd-err{color:#a11616;font-weight:600;min-height:1em;margin:4px 0}[data-theme=dark] .pd-err{color:#ff9a9a}
.pd-opts [hidden],.pd-page [hidden],.pd-sheet [hidden]{display:none!important}
.pd-ul{list-style:none;margin:0;padding:0 var(--s4)}.pd-row{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}.pd-row:last-child{border:0}.pd-row .grow{flex:1;min-width:0}.pd-row .grow>b,.pd-row .grow>a{display:block;overflow:hidden;text-overflow:ellipsis}
.pd-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none}
.pd-kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 12px}.pd-kpi div{background:var(--card);border-radius:14px;padding:10px;text-align:center;box-shadow:var(--sh-1)}.pd-kpi b{display:block;font-size:18px}
.pd-btns{display:flex;flex-wrap:wrap;gap:8px}.pd-btns>*{flex:1 1 120px;text-align:center;text-decoration:none}
.pd-done{text-align:center;padding:10px 4px}.pd-done .big{font-size:42px;line-height:1.2}.pd-done b{display:block;font-size:19px;margin:6px 0}
.pd-note{border-inline-start:4px solid #e8a412}
</style>`);

  /* ---------- availability ---------- */
  let on = false, maxPrice = 100;
  async function piOn() { const c = online() ? await A()?.config?.().catch?.(() => null) : null; if (Number(c?.paidMaxPrice) > 0) maxPrice = Number(c.paidMaxPrice); return !!c?.enabled; }
  const offNote = (msg = OFF) => `<div class="notice warn" id="pd-off" role="note">${UI.icon("lock", "sm")}<span><b>المدفوعات غير مفعّلة بعد.</b> ${h(msg)}</span></div>`; // v2.33: shared notice

  /* ---------- store hygiene: a locked post never carries body/media on the client ---------- */
  const scrub = (p) => { if (!p?.locked) return p; if (typeof p.text !== "string") p.text = String(p.teaser ?? ""); return p; };
  if (typeof hydrate === "function") { const _hy = hydrate; hydrate = function (b) { const r = _hy.apply(this, arguments); (DB.posts || []).forEach(scrub); return r; }; }
  if (typeof DB !== "undefined") (DB.posts || []).forEach(scrub);

  /* ---------- locked / paid rendering (wraps postInner: covers feed, profile, search, post page, quotes) ---------- */
  const teaserOf = (p) => { const t = String(p.teaser ?? p.text ?? ""); return t.length > 220 ? t.slice(0, 200) + "…" : t; };
  const tierName = (t) => t ? (typeof t === "string" ? t : t.name || "") : "";
  function lockCard(p) {
    const L = p.lock || {}, u = S.user(p.author) || {}, ppv = L.mode === "ppv" || (L.mode !== "supporters" && L.price != null);
    const M = L.media, media = (M && typeof M === "object" ? (Number(M.images) || 0) + ["media", "cover", "video", "audio"].filter(k => M[k]).length - (M.images && M.media ? 1 : 0) : Number(L.mediaCount ?? M) || 0), lid = "pd-l-" + h(p.id);
    const blur = media ? `<div class="pd-blur" role="img" aria-label="${media > 1 ? `${cnt(media)} وسائط مقفلة` : "وسائط مقفلة"}"><span aria-hidden="true">${UI.icon("lock", "sm")} ${media > 1 ? cnt(media) + " وسائط" : "وسائط"} مقفلة</span></div>` : "";
    const minor = L.reason === "minor_restricted";
    let body;
    if (ppv) {
      body = `<h4 id="${lid}"><span aria-hidden="true">${UI.icon("lock", "sm")}</span> محتوى مدفوع · ${pi(L.price)}</h4><p>دفعة واحدة ويبقى المنشور مفتوحاً لك دائماً.</p>
        ${minor ? `<p class="pd-off">${ERR.minor_restricted}</p>` : on && L.reason !== "not_configured" && L.purchasable !== false ? `<div class="pd-cta"><button type="button" class="pi-btn" data-pd-buy="${h(p.id)}" aria-label="افتح المنشور مقابل ${h(piTxt(L.price))}"><span class="pi-logo" aria-hidden="true">π</span>افتح مقابل ${h(piTxt(L.price))}</button></div>` : `<p class="pd-off" role="note">${OFF}</p>`}`;
    } else {
      const tiers = list(L.tiers), min = tierName(L.minTier);
      body = `<h4 id="${lid}"><span aria-hidden="true">${UI.icon("heart", "sm")}</span> للداعمين فقط${min ? ` · من مستوى «${h(min)}» فأعلى` : ""}</h4><p>ادعم ${h(u.name || "@" + (u.handle || ""))} شهرياً لقراءة هذا المنشور وكل منشورات الداعمين.</p>
        ${tiers.length ? `<ul class="pd-tiers" aria-label="مستويات الدعم">${tiers.map(t => `<li>${h(t.name)} · ${pi(t.amount)}<span class="pd-sr"> شهرياً</span></li>`).join("")}</ul>` : ""}
        ${minor ? `<p class="pd-off">${ERR.minor_restricted}</p>` : `<div class="pd-cta">${u.handle ? `<a class="btn" href="#/support/${enc(u.handle)}" data-pd-tiers="${h(p.id)}">اعرض مستويات الدعم</a>` : ""}</div>${on ? "" : `<p class="u-mt8 pd-off" role="note">${OFF}</p>`}`}`;
    }
    return `${blur}<section class="pd-lock" data-pd-lock="${h(p.id)}" aria-labelledby="${lid}">${body}</section>`;
  }
  function badge(p) {
    const P = p.paid || {}, mine = p.author === DB.me;
    if (P.mode === "ppv") return `<span class="pd-badge">${UI.icon("lock", "xs")} ${mine ? `منشورك المدفوع · ${pi(P.price)}${P.unlocks != null ? ` · ${cnt(P.unlocks)} فتح` : ""}` : `محتوى مدفوع · مفتوح لك`}</span>`;
    if (P.mode === "supporters") return `<span class="pd-badge">${UI.icon("heart", "xs")} للداعمين${tierName(P.minTier) ? ` · «${h(tierName(P.minTier))}» فأعلى` : ""}</span>`;
    return "";
  }
  if (typeof postInner === "function") {
    const _pin = postInner;
    postInner = function (p, opts = {}) {
      if (!p || p.status === "deleted") return _pin(p, opts);
      if (!p.locked) { const html = _pin(p, opts); return p.paid?.mode ? html.replace('<div class="actions"', badge(p) + '<div class="actions"') : html; }
      // render a body-free clone: teaser text only; media, images, video, audio, poll, doc never reach the renderers
      const q = { ...p, text: teaserOf(p), doc: null, media: null, images: null, alts: null, video: null, audio: null, poll: null, quoteOf: null, stances: null, translations: null, type: p.type === "article" ? "article" : "post" };
      const html = _pin(q, opts);
      return html.includes('<div class="actions"') ? html.replace('<div class="actions"', lockCard(p) + '<div class="actions"') : html + lockCard(p);
    };
  }

  /* ---------- unlock (PPV) ---------- */
  // after a purchase: re-fetch the post (server contract), swap it into the store, then re-hydrate in the background
  const asLocal = (np) => { const y = { ...np }; if (typeof y.media === "string" && y.media.startsWith("/media/")) y.media = `url('${y.media}') center/cover no-repeat`;
    if (Array.isArray(y.images)) y.images = y.images.map(i => typeof i === "string" && i.startsWith("/media/") ? `url('${i}') center/cover no-repeat` : i); return y; };
  async function reloadPost(pid) {
    let ok = false;
    try {
      const r = await api("GET", `/api/posts/${enc(pid)}`), np = r?.post || r;
      if (np && np.id === pid && np.locked === false) { const y = asLocal(np), i = DB.posts.findIndex(x => x.id === pid); if (i >= 0) { DB.posts[i] = { ...DB.posts[i], ...y }; Remote.snap?.posts?.set(pid, JSON.stringify(DB.posts[i])); } ok = true; }
    } catch { }
    if (typeof rerender === "function") rerender();
    const bg = (typeof refresh === "function" ? Promise.resolve().then(() => refresh()) : Promise.resolve()).catch(() => { });
    if (!ok) { await bg; ok = !S.post(pid)?.locked; }
    return ok;
  }
  async function unlockSheet(pid) {
    const p = S.post(pid); if (!p?.locked) return;
    if (!(await piOn())) return toast(OFF);
    if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { });
    const L = p.lock || {}, u = S.user(p.author) || {}, price = Number(L.price);
    const s = sheet(`<div class="pd-sheet" role="dialog" aria-modal="true" aria-labelledby="pd-st" aria-describedby="pd-sd"><h3 id="pd-st" tabindex="-1" class="u-m0 u-mt4 u-mb8"><svg class="ic hi" aria-hidden="true"><use href="#i-unlock"/></svg>فتح منشور ${h(u.name || "@" + (u.handle || ""))}</h3>
      <div id="pd-body"><p id="pd-sd" class="u-m0 u-mb8">السعر ${pi(price)} — دفعة واحدة، ويبقى المنشور مفتوحاً لك دائماً.</p>
      <p class="u-t-sm u-m0 u-mb10 muted">يمكنك طلب الاسترداد خلال 24 ساعة إذا عدّل الناشر المنشور أو حذفه، أو أزالته الإدارة.</p>
      <p class="pd-err" id="pd-err" role="alert"></p>
      <button type="button" class="pi-btn" id="pd-go" aria-describedby="pd-note" disabled><span class="pi-logo" aria-hidden="true">π</span><span class="pd-lbl">ادفع ${h(piTxt(price))}</span></button>
      <p class="pi-note" id="pd-note" role="status">جارٍ التحقق من Pi…</p></div>
      <div class="u-mt10 pd-btns"><button type="button" class="btn ghost" id="pd-x">إغلاق</button></div></div>`);
    const $s = (q) => s.querySelector(q), go = $s("#pd-go"), err = $s("#pd-err"), note = $s("#pd-note");
    $s("#pd-x").addEventListener("click", () => closeSheet());
    let av = { ok: false };
    (window.MPPi ? window.MPPi.availability() : Promise.resolve({ ok: false, reason: OFF })).then(a => { av = a; note.textContent = a.ok ? (a.cfg?.network === "mainnet" ? "سيُطلب منك التأكيد في محفظة Pi." : "على الشبكة التجريبية (Testnet) — لا أموال حقيقية.") : a.reason; go.disabled = !a.ok; });
    $s("#pd-st").focus(); setTimeout(() => { if (document.activeElement === go) $s("#pd-st")?.focus(); }, 90); // the core sheet helper focuses the first button after 60 ms; keep the title first
    const done = async (already) => {
      if (!already) window.MPTips?.celebrate?.();
      $s("#pd-body").outerHTML = `<div class="pd-done" id="pd-done" tabindex="-1"><div class="big" aria-hidden="true"><svg class=ei aria-hidden=true><use href=#i-unlock /></svg></div><b>${already ? "المنشور مفتوح لك بالفعل" : "فُتح المنشور، استمتع بالقراءة!"}</b><p class="u-m0 u-mb10 muted">جارٍ عرض المحتوى الكامل…</p></div>`;
      $s("#pd-done").focus(); say(already ? "المنشور مفتوح لك بالفعل" : "تم الدفع وفُتح المنشور"); toast(already ? "المنشور مفتوح لك بالفعل" : "فُتح المنشور");
      const ok = await reloadPost(pid);
      closeSheet();
      if (/^#\/post\//.test(location.hash) && typeof rerender === "function") rerender();
      const t = document.querySelector(`#view [data-react="${CSS.escape(pid)}"]`)?.closest(".card")?.querySelector(".body,.post-open");
      if (t) { t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: false }); }
      if (!ok) toast("تم الدفع، سيظهر المحتوى خلال لحظات");
    };
    go.addEventListener("click", async () => {
      if (go.disabled) return;
      if (!av.ok) { err.textContent = av.reason || OFF; return; }
      err.textContent = ""; go.disabled = true; go.setAttribute("aria-busy", "true"); $s(".pd-lbl").textContent = "جارٍ الدفع…"; note.className = "pi-note"; note.textContent = "أكمل التأكيد في نافذة Pi…";
      try {
        await window.MPPi.pay({ amount: price, memo: "فتح منشور مدفوع", purpose: "ppv", refId: pid, intent: async () => (await api("POST", `/api/paid/${enc(pid)}/intent`)).intent });
        await done(false);
      } catch (e) {
        if (e?.code === "already_unlocked" || e?.status === 409 && !e.code) return done(true);
        go.disabled = false; go.removeAttribute("aria-busy"); $s(".pd-lbl").textContent = `ادفع ${piTxt(price)}`;
        if (e?.cancelled) { note.textContent = "أُلغيت عملية الدفع، لم يُخصم شيء."; }
        else { err.textContent = errText(e); note.textContent = ""; }
      }
    });
    return s;
  }

  /* ---------- composer v3: «الوصول» options ---------- */
  let creatorP = null;
  const myCreator = () => (creatorP ||= online() ? api("GET", "/api/me/creator").catch(() => null) : Promise.resolve(null));
  function readChoice(box) {
    const mode = box.querySelector("input[name=pd-mode]:checked")?.value || "free";
    if (mode === "free") return { mode };
    const teaser = box.querySelector("#pd-teaser").value.trim(), o = { mode };
    if (teaser) o.teaser = teaser;
    if (mode === "supporters") { const t = box.querySelector("#pd-tier").value; if (t) o.minTierId = t; }
    if (mode === "ppv") o.price = Number(box.querySelector("#pd-price").value);
    return o;
  }
  function checkChoice(c) {
    if (c.mode !== "ppv") return null;
    if (!(c.price >= 0.01) || c.price > maxPrice) return `السعر يجب أن يكون بين 0.01 و${maxPrice} Pi.`;
    if (Math.abs(Math.round(c.price * 1e7) - c.price * 1e7) > 1e-6) return "السعر يقبل 7 خانات عشرية كحد أقصى.";
    return null;
  }
  /* v2.50: «الوصول» in the general editor through window.MPComposerHooks (no DOM observer, no API-client wrapper):
   * mount → fieldset in the options slot, check → price validation before publishing, apply → body.paid */
  (window.MPComposerHooks = window.MPComposerHooks || []).push({
    id: "paid", modes: ["general"],
    mount(cx) { const host = cx.slot("options"); if (host) enhanceComposer(cx.el, host, cx.type); },
    onType(type, cx) { const box = cx.el.querySelector("#pd-opts"); if (box) box.hidden = type === "story"; },
    check(cx) {
      const box = cx.el.querySelector("#pd-opts"); if (!box || box.hidden) return null;
      const c = readChoice(box); if (c.mode === "free") return null;
      const bad = checkChoice(c); if (!bad) return null;
      cx.openOptions(); box.querySelector("#pd-cerr").textContent = bad; box.querySelector("#pd-price").focus(); return bad;
    },
    apply(body, cx) { const box = cx.el.querySelector("#pd-opts"); if (!box || box.hidden) return; const c = readChoice(box); if (c.mode !== "free") body.paid = c; }
  });
  async function enhanceComposer(el, host, type) {
    if (el.querySelector("#pd-opts")) return;
    const box = document.createElement("fieldset"); box.className = "pd-opts"; box.id = "pd-opts";
    box.innerHTML = `<legend>الوصول إلى المنشور</legend>
      <label class="pd-r"><input type="radio" name="pd-mode" value="free" checked> مجاني للجميع</label>
      <label class="pd-r"><input type="radio" name="pd-mode" value="supporters"> للداعمين فقط</label>
      <label class="pd-r"><input type="radio" name="pd-mode" value="ppv"> مدفوع مرة واحدة (Pay-per-view)</label>
      <p class="u-t-sm u-m0 u-mt4 muted" id="pd-cnote">جارٍ التحقق من إعدادات المبدع…</p>
      <label class="pd-f" id="pd-tierw" hidden><span>الحد الأدنى من مستويات الدعم</span><select id="pd-tier"><option value="">أي مستوى دعم</option></select></label>
      <label class="pd-f" id="pd-pricew" hidden><span>السعر (Pi)</span><input type="number" id="pd-price" inputmode="decimal" min="0.01" max="${maxPrice}" step="0.01" dir="ltr" aria-describedby="pd-cerr"></label>
      <label class="pd-f" id="pd-teaserw" hidden><span>نص تشويقي يراه الجميع (اختياري، حتى 200 حرف)</span><textarea id="pd-teaser" maxlength="200" placeholder="بدونه يظهر أول 200 حرف من المنشور"></textarea></label>
      <p class="pd-err" id="pd-cerr" role="alert"></p>`;
    host.appendChild(box); box.hidden = type === "story";
    const radios = [...box.querySelectorAll("input[name=pd-mode]")], cnote = box.querySelector("#pd-cnote"), cerr = box.querySelector("#pd-cerr");
    const sync = () => {
      const m = box.querySelector("input[name=pd-mode]:checked").value;
      box.querySelector("#pd-tierw").hidden = m !== "supporters"; box.querySelector("#pd-pricew").hidden = m !== "ppv"; box.querySelector("#pd-teaserw").hidden = m === "free"; cerr.textContent = "";
    };
    radios.forEach(r => r.addEventListener("change", sync));
    sync();
    const [en, c] = await Promise.all([piOn(), myCreator()]);
    if (!box.isConnected) return;
    const enabled = !!(c?.enabled ?? c?.creator?.enabled);
    if (!en) { radios.slice(1).forEach(r => (r.disabled = true)); cnote.textContent = "المحتوى المدفوع يُتاح فور تفعيل مدفوعات Pi."; return; }
    if (!enabled) { radios.slice(1).forEach(r => (r.disabled = true)); cnote.innerHTML = `فعّل <a href="#/creator">إعدادات المبدع</a> أولاً لنشر محتوى مدفوع.`; return; }
    const tiers = list(c?.tiers).filter(t => !t.retired);
    if (!tiers.length) { radios[1].disabled = true; radios[1].closest("label").insertAdjacentHTML("beforeend", ` <span class="muted pd-tnote">(أضف مستوى دعم من <a href="#/creator">إعدادات المبدع</a>)</span>`); }
    box.querySelector("#pd-tier").insertAdjacentHTML("beforeend", tiers.map(t => `<option value="${h(t.id)}">${h(t.name)} — ${h(piTxt(t.amount))} فأعلى</option>`).join(""));
    const fee = Number(c?.feeBps) > 0 ? ` رسوم المنصة ${(c.feeBps / 100).toLocaleString("ar-EG")}٪.` : "";
    cnote.textContent = `الداعمون النشطون يرون منشورات الداعمين، والمدفوع يُفتح لكل مشترٍ للأبد.${fee}`;
  }

  /* ---------- #/me/purchases ---------- */
  const postTitle = (x) => { const lp = x?.id && S.post(x.id); return String(x?.title || x?.teaser || lp?.title || lp?.text || "منشور").slice(0, 80); };
  /* v2.33: «مشترياتي» is one hub (#/purchases, owned by the digital chunk); this fills its paid-content section (host).
   * Without a host (digital chunk unavailable) it renders the paid list as its own page. */
  async function purchasesView(host) {
    const v = view, token = (v._pd = { h: location.hash }), en = await piOn();
    if (!live(token) || (host && !host.isConnected)) return;
    const body = `${en ? "" : offNote("يمكنك مراجعة مشترياتك السابقة؛ الشراء وطلبات الاسترداد تُتاح فور تفعيل مدفوعات Pi.")}<div id="pd-pl" aria-busy="true"><div class="skel"></div></div>`;
    if (host) host.innerHTML = body; else { v.innerHTML = `<div class="wrap pd-page">${UI.pageHead({ back: ["#/me", "حسابي"], title: "مشترياتي", id: "pd-h" })}${body}</div>`; focusH(); }
    let rows; try { rows = list(await api("GET", "/api/me/purchases"), "purchases", "items"); } catch (e) { const b = v.querySelector("#pd-pl"); if (live(token) && b) { b.removeAttribute("aria-busy"); b.innerHTML = `<div class="card">${h(errText(e))}</div>`; } return; }
    const box = v.querySelector("#pd-pl"); if (!live(token) || !box) return;
    box.removeAttribute("aria-busy");
    box.innerHTML = rows.length ? `<ul class="list pd-ul">${rows.map(r => { const post = r.post || { id: null, title: "منشور لم يعد متاحاً" }, au = post.author || r.creator || {}, rq = r.refundRequest, can = r.refundEligible ?? r.refundable, gone = !post.id || ["deleted", "removed"].includes(post.status) || post.deleted; return `<li class="pd-row" data-pur="${h(r.id)}"><div class="grow">
        ${!gone ? `<a href="#/post/${enc(post.id)}"><b>${h(postTitle(post))}</b></a>` : `<b>${h(postTitle(post))}</b>`}
        <div class="u-t-sm muted">${au.handle ? `@${h(au.handle)} · ` : ""}${pi(r.amount ?? r.price)} · ${h(day(r.completedAt || r.createdAt || r.at))}${gone && post.status ? ` · ${post.status === "removed" ? "أزالته الإدارة" : "حذفه الناشر"}` : ""}${can && r.refundUntil ? ` · يمكن طلب الاسترداد حتى ${h(day(r.refundUntil))}` : ""}</div></div>
        <div class="pd-side">${chip(rq && rq.status === "pending" && r.status === "completed" ? "refund_requested" : rq && rq.status === "rejected" && r.status === "completed" ? "refund_rejected" : r.status)}${r.receiptId || r.intentId ? `<a class="u-t-sm muted" href="#/receipt/${enc(r.receiptId || r.intentId)}">الإيصال</a>` : ""}${en && can ? `<button type="button" class="btn ghost" data-pd-ref="${h(r.id)}" aria-label="طلب استرداد: ${h(postTitle(post))}">طلب استرداد</button>` : ""}</div></li>`; }).join("")}</ul>
        <p class="u-t-sm muted">يحق طلب الاسترداد خلال 24 ساعة من الشراء إذا عدّل الناشر المنشور أو حذفه، أو أزالته الإدارة. تراجع الإدارة كل طلب.</p>`
      : `<div class="card">${UI.empty({ title: "لم تشترِ أي محتوى مدفوع بعد", text: "المنشورات المدفوعة التي تفتحها تظهر هنا مع إيصالها." })}</div>`;
    box.querySelectorAll("[data-pd-ref]").forEach(b => b.addEventListener("click", () => refundSheet(rows.find(x => String(x.id) === b.dataset.pdRef), () => purchasesView(host))));
  }
  function refundSheet(r, done) {
    if (!r) return;
    const s = sheet(`<div class="pd-sheet" role="dialog" aria-modal="true" aria-labelledby="pd-rt"><h3 id="pd-rt" tabindex="-1" class="u-m0 u-mt4 u-mb8">طلب استرداد ${pi(r.amount ?? r.price)}</h3>
      <form id="pd-rf" novalidate><p class="u-m0 u-mb8">تغيّر هذا المنشور بعد شرائك (عُدّل أو حُذف أو أزالته الإدارة)، لذا يحق لك طلب الاسترداد${r.refundUntil ? ` حتى ${h(day(r.refundUntil))}` : " خلال 24 ساعة"}.</p>
      <label class="pd-f"><span>سبب الطلب (اختياري)</span><textarea id="pd-rn" maxlength="500" placeholder="مثلاً: حُذف الجزء الذي اشتريت المنشور من أجله"></textarea></label>
      <p class="u-t-sm u-m0 u-mb8 muted">عند الموافقة يعود المبلغ إلى محفظتك ويُلغى وصولك إلى المنشور.</p>
      <p class="pd-err" id="pd-rerr" role="alert"></p>
      <div class="pd-btns"><button type="submit" class="btn" id="pd-rgo">إرسال الطلب</button><button type="button" class="btn ghost" id="pd-rx">تراجع</button></div></form></div>`);
    s.querySelector("#pd-rx").addEventListener("click", () => closeSheet()); s.querySelector("#pd-rt").focus();
    s.querySelector("#pd-rf").addEventListener("submit", async (e) => {
      e.preventDefault(); const b = s.querySelector("#pd-rgo"); b.disabled = true;
      try { await api("POST", `/api/paid/purchases/${enc(r.id)}/refund-request`, s.querySelector("#pd-rn").value.trim() ? { reason: s.querySelector("#pd-rn").value.trim() } : {}); closeSheet(); toast("أُرسل طلب الاسترداد"); say("أُرسل طلب الاسترداد، ستراجعه الإدارة"); done?.(); }
      catch (err) { b.disabled = false; s.querySelector("#pd-rerr").textContent = errText(err); }
    });
  }

  /* ---------- #/me/paid-posts (creator) ---------- */
  async function paidPostsView() {
    const v = view, token = (v._pd = { h: location.hash }), en = await piOn();
    if (!live(token)) return;
    v.innerHTML = `<div class="wrap pd-page">${UI.pageHead({ back: ["#/creator", "إعدادات المبدع"], title: "منشوراتي المدفوعة", id: "pd-h" })}${en ? "" : offNote("ستبدأ المبيعات فور تفعيل مدفوعات Pi؛ منشورات الداعمين تبقى مقفلة لغير الداعمين.")}<div id="pd-cl" aria-busy="true"><div class="skel"></div></div></div>`;
    focusH();
    let d; try { d = await api("GET", "/api/me/paid-posts"); } catch (e) { const b = v.querySelector("#pd-cl"); if (live(token) && b) { b.removeAttribute("aria-busy"); b.innerHTML = `<div class="card">${h(errText(e))}</div>`; } return; }
    const box = v.querySelector("#pd-cl"); if (!live(token) || !box) return;
    const rows = list(d, "posts", "items"), sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0), tot = d?.totals || {};
    box.removeAttribute("aria-busy");
    box.innerHTML = `<div class="pd-kpi"><div><b>${cnt(rows.length)}</b><span class="muted">منشور مدفوع</span></div><div><b>${cnt(tot.unlocks ?? sum("unlocks"))}</b><span class="muted">مرات الفتح</span></div><div><b>${pi(tot.revenue ?? tot.net ?? sum("revenue"))}</b><span class="muted">الإيراد</span></div></div>
      ${rows.length ? `<ul class="card" style="list-style:none;margin:0;padding:4px 14px">${rows.map(r => { const pid = r.postId || r.id, P = r.paid || r; return `<li class="pd-row"><div class="grow"><a href="#/post/${enc(pid)}"><b>${h(postTitle({ id: pid, title: r.title, teaser: r.teaser }))}</b></a>
          <div class="u-t-sm muted">${P.mode === "ppv" ? `مدفوع · ${pi(P.price)}` : `للداعمين${tierName(P.minTier) ? ` · «${h(tierName(P.minTier))}» فأعلى` : ""}`} · ${h(day(r.createdAt))}</div></div>
          <div class="pd-side"><span><b>${cnt(r.unlocks)}</b> <span class="muted">فتح</span></span><span>${pi(r.revenue ?? r.net ?? 0)}</span>${r.refunds ? `<span class="u-t-xs muted">${cnt(r.refunds)} استرداد</span>` : ""}</div></li>`; }).join("")}</ul>`
        : `<div class="card empty">لا منشورات مدفوعة بعد. اختر «للداعمين فقط» أو «مدفوع مرة واحدة» من خيارات النشر.</div>`}
      ${en ? `<div class="u-mt12 pd-btns"><a class="btn ghost" href="#/earnings">لوحة الأرباح</a></div>` : ""}`;
  }

  /* ---------- #/admin/paid (refunds queue) ---------- */
  async function adminRefunds() {
    if (!DB.isAdmin) return Views.notFound();
    const v = view, token = (v._pd = { h: location.hash }), en = await piOn();
    if (!live(token)) return;
    v.innerHTML = `<div class="wrap pd-page">${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "طلبات استرداد المحتوى المدفوع", id: "pd-h" })}${en ? "" : offNote("لا يمكن تنفيذ الاسترداد قبل تفعيل مدفوعات Pi.")}<div id="pd-aq" aria-busy="true"><div class="skel"></div></div></div>`;
    focusH();
    const load = async () => {
      const box = v.querySelector("#pd-aq"); if (!box) return;
      let rows; try { rows = list(await api("GET", "/api/admin/paid/refunds"), "refunds", "items", "requests"); } catch (e) { if (live(token) && box.isConnected) { box.removeAttribute("aria-busy"); box.innerHTML = `<div class="card">${h(errText(e))}</div>`; } return; }
      if (!live(token) || !box.isConnected) return;
      box.removeAttribute("aria-busy");
      box.innerHTML = rows.length ? `<ul class="list pd-ul">${rows.map(r => { const by = r.buyer || r.user || {}, cr = r.creator || r.post?.author || {}, post = r.post || { id: r.postId }; return `<li class="pd-row" data-rq="${h(r.id)}"><div class="grow"><b>${pi(r.amount)}</b> <span class="muted">من</span> @${h(by.handle || "؟")} <span class="muted">لمنشور</span> @${h(cr.handle || "؟")}
          <div class="u-t-sm muted">${h(KINDS[r.kind] || r.kind || "—")} · طُلب ${h(day(r.requestedAt || r.createdAt))}${post.id && !["deleted"].includes(post.status) ? ` · <a href="#/post/${enc(post.id)}">المنشور</a>` : ""}</div>${r.reason ? `<div class="u-t-sm u-mt4">«${h(r.reason)}»</div>` : ""}
          <label class="pd-f"><span>ملاحظة القرار (اختيارية)</span><input type="text" data-note maxlength="300"></label>
          <label class="pd-f"><span>معرّف معاملة الإرجاع txid (اختياري، عند الموافقة)</span><input type="text" data-txid maxlength="128" dir="ltr"></label></div>
          <div class="pd-side"><button type="button" class="btn" data-act="approve" ${en ? "" : "disabled"} aria-label="موافقة على استرداد ${h(piTxt(r.amount))} لـ @${h(by.handle || "")}">موافقة</button><button type="button" class="btn ghost" data-act="reject" aria-label="رفض استرداد ${h(piTxt(r.amount))} لـ @${h(by.handle || "")}">رفض</button></div></li>`; }).join("")}</ul>`
        : `<div class="card empty">لا طلبات استرداد. ✓</div>`;
      box.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", async () => {
        const li = b.closest("[data-rq]"), id = li.dataset.rq, act = b.dataset.act, note = li.querySelector("[data-note]")?.value.trim(), txid = li.querySelector("[data-txid]")?.value.trim();
        li.querySelectorAll("button").forEach(x => (x.disabled = true));
        try { await api("POST", `/api/admin/paid/refunds/${enc(id)}/${act}`, { ...(note ? { note } : {}), ...(txid && act === "approve" ? { txid } : {}) }); const m = act === "approve" ? "تمت الموافقة وأُعيد المبلغ" : "رُفض طلب الاسترداد"; toast(m); say(m); await load(); v.querySelector("#pd-h")?.focus(); }
        catch (e) { li.querySelectorAll("button").forEach(x => (x.disabled = x.dataset.act === "approve" && !en)); toast(errText(e)); }
      }));
    };
    load();
  }

  /* ---------- wiring ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-pd-buy]"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); unlockSheet(b.dataset.pdBuy);
  });
  MPRoutes.add("admin", (a, b, next) => {
        if (a === "paid") return adminRefunds();
        next();
        if (!a && DB.isAdmin) setTimeout(() => { if (location.hash === "#/admin" && !document.getElementById("pd-adm")) (view.querySelector("#tp-adm") || view.querySelector(".wrap h2"))?.insertAdjacentHTML("afterend", `<a class="u-dflex u-aic u-g12 u-ci u-tdn card" id="pd-adm" href="#/admin/paid"><span aria-hidden="true" class="u-t-3xl"><svg class=ei aria-hidden=true><use href=#i-undo /></svg></span><span class="u-f1"><b>استرداد المحتوى المدفوع</b><span class="u-db muted">مراجعة طلبات الاسترداد للمنشورات المدفوعة</span></span><span class="fwd" aria-hidden="true">←</span></a>`); }, 0);
      });
  MPRoutes.add("creator", (a, b, next) => { next(); addLink("#/creator", "pd-crl", `<a class="u-dflex u-aic u-g12 u-ci u-tdn u-mt12 card" id="pd-crl" href="#/me/paid-posts"><span aria-hidden="true" class="u-c-ac">${UI.icon("wallet")}</span><span class="u-f1"><b>منشوراتي المدفوعة</b><span class="u-db muted">منشورات الداعمين والمدفوعة: مرات الفتح والإيراد</span></span><span class="fwd" aria-hidden="true">←</span></a>`); });
  MPRoutes.add("me", (a, b, next) => (a === "purchases" ? hub() : a === "paid-posts" ? paidPostsView() : next()));
  // #/me/purchases is an alias of the «مشترياتي» hub (#/purchases in the digital chunk); the paid list alone is the fallback
  function hub() { const go = () => (window.MPDigital?.purchases ? MPDigital.purchases() : purchasesView()); if (window.MPDigital || !window.MPChunks) return go(); MPChunks.load("digital").then(go, go); }
  // #/creator renders asynchronously (tips chunk): append the link once its form is on the page
  function addLink(hash, id, html) {
    let n = 0; const t = setInterval(() => { if (location.hash !== hash || ++n > 40) return clearInterval(t); const w = view.querySelector(".tp-page,.pd-page,.wrap"); if (!w || document.getElementById(id) || !view.querySelector("#tp-cf")) return; w.insertAdjacentHTML("beforeend", html); clearInterval(t); }, 100);
  }
  if (typeof Views !== "undefined" && Views.settings) {
    MPSettings.add(function () { if (!document.getElementById("pd-set")) (view.querySelector(".wrap") || view).insertAdjacentHTML("beforeend", `<div class="card" id="pd-set"><h3 class="u-m0 u-mb8 u-t-lg">المحتوى المدفوع</h3><div class="pd-btns"><a class="btn ghost" href="#/me/purchases">مشترياتي</a><a class="btn ghost" href="#/me/paid-posts">منشوراتي المدفوعة</a></div></div>`); });
  }
  async function refreshPaid() { creatorP = null; const was = on; on = await piOn(); if (was !== on && document.querySelector("#view [data-pd-lock]") && typeof rerender === "function") rerender(); return on; }
  window.MPPaid = { unlock: unlockSheet, refresh: refreshPaid, purchases: purchasesView, paidPosts: paidPostsView, admin: adminRefunds, version: "2.11.0" };
  refreshPaid().then(() => {
    const hasLocked = typeof DB !== "undefined" && (DB.posts || []).some(p => p.locked || p.paid?.mode);
    if (/^#\/(me\/purchases|me\/paid-posts|admin\/paid)/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
    else if (hasLocked && DB.onboarded && typeof rerender === "function" && document.getElementById("sheet")?.classList.contains("hidden")) rerender();
  });
})();
