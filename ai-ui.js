/* AI subscription «مجتمع+ ذكاء» + real translation UI (phase 41). Lazy chunk `ai`. Contract: docs/integration/p41-contract.md.
 * • «🌐 ترجمة» on posts / comments / messages whose language differs from the interface language (and is not in prefs.skip).
 *   Subscriber → POST /api/ai/translate, then a tap toggles «عرض الأصل» ⇄ «عرض الترجمة», labelled «ترجمة آلية».
 *   Auto-translate (prefs.auto) batches the visible items. Non-subscriber → upsell sheet (plan, price or «لم يُحدَّد…», Pi note).
 *   E2EE message → disclosure sheet, then the plaintext shown on this device is sent once with consent:true.
 * • #/ai subscription + usage, #/settings/translate prefs, #/admin/ai (price, limits, grants, finance). No inline handlers. */
(function AIUI() {
  const api = (m, p, b) => Remote.api(m, p, b);
  const on = () => typeof Remote !== "undefined" && Remote.on && typeof DB !== "undefined" && DB.me;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NAMES = { ar: "العربية", en: "English", fr: "Français", ur: "اردو" };
  const OFF_PI = "مدفوعات Pi غير مفعّلة بعد", OFF_TR = "خدمة الترجمة غير مفعّلة بعد";
  const ui = () => (DB.settings && NAMES[DB.settings.lang] ? DB.settings.lang : "ar");
  /** same heuristics as server/lib/translate.js detectLang */
  function detect(text) {
    const t = String(text || "").replace(/https?:\/\/\S+|[@#][\p{L}\p{N}_]+/gu, " ");
    const a = (t.match(/[\u0600-\u06FF]/g) || []).length, l = (t.match(/[A-Za-zÀ-ÿŒœ]/g) || []).length;
    if (!a && !l) return null;
    if (a >= l) { const u = (t.match(/[ٹڈڑںےۓ]/g) || []).length; return u >= 2 || (u >= 1 && a < 40) ? "ur" : "ar"; }
    const w = t.toLowerCase().split(/[^a-zà-ÿœ']+/);
    const fr = w.filter((x) => /^(le|la|les|des|du|est|une|un|et|pour|avec|dans|que|qui|pas|sur|nous|vous|je|très)$/.test(x)).length + (t.match(/[àâçéèêëîïôûùü]/gi) || []).length * 0.5;
    const en = w.filter((x) => /^(the|and|is|are|to|of|you|for|with|that|this|it|in|on|was)$/.test(x)).length;
    return fr > en ? "fr" : "en";
  }
  let me = null, cfg = null, meP = null;
  const loadMe = (force) => { if (!on()) return Promise.resolve(null); if (force || !meP) meP = Promise.all([api("GET", "/api/ai/me"), api("GET", "/api/ai/config")]).then(([m, c]) => { me = m; cfg = c; return m; }).catch(() => (meP = null)); return meP; };
  const subscribed = () => !!me?.entitlements?.translate;
  const skip = () => me?.prefs?.skip || [];
  const target = () => me?.prefs?.target || ui();
  const state = new Map(); // "kind:id" → {text, showing}
  const errText = (e) => ({ not_configured: OFF_TR, usage_limit: "بلغت حدّ الترجمة الشهري", budget_exhausted: "توقفت الترجمة مؤقتاً لبلوغ ميزانيتها الشهرية", provider_not_private: "لا تُرسل الرسائل الخاصة إلى خدمة ترجمة عامة", lang_unsupported: "اللغة غير مدعومة", provider_error: "تعذرت الترجمة الآن، حاول لاحقاً" }[e?.code] || e?.message || "تعذرت الترجمة");

  /* ---------- style ---------- */
  const st = document.createElement("style");
  st.textContent = `.mp-trb{border:0;background:none;color:var(--accent-ink);font:inherit;font-size:var(--fs-sm);font-weight:600;padding:4px 0;cursor:pointer;display:inline-flex;align-items:center;gap:5px}.mp-trb .ic{width:15px;height:15px;flex:none}.mp-trb[aria-busy=true]{opacity:.6}
.mp-tr-out{border-inline-start:3px solid var(--accent);padding-inline-start:8px;white-space:pre-wrap}.mp-tr-lbl{font-size:var(--fs-xs);color:var(--muted);margin-top:4px}
.cm-b .mp-trb{display:flex;font-size:var(--fs-xs)}.mp-ai-feat{margin:8px 0;padding-inline-start:18px}.mp-meter{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.mp-meter i{display:block;height:100%;background:var(--accent)}`;
  document.head.appendChild(st);

  /* ---------- where translatable text lives ---------- */
  function targetEl(btn) {
    const [kind] = btn.dataset.aitr.split(":");
    if (kind === "post") return btn.closest(".card")?.querySelector(".post-open .body");
    if (kind === "comment") return btn.closest(".comment")?.querySelector(".cbody");
    return btn.closest(".cm-b")?.querySelector("span[dir=auto]");
  }
  function show(btn, on) {
    const el = targetEl(btn); if (!el) return;
    const k = btn.dataset.aitr, s = state.get(k);
    let out = el.parentElement.querySelector(`.mp-tr-out[data-for="${CSS.escape(k)}"]`);
    if (on && s) {
      if (!out) { out = document.createElement("div"); out.className = "mp-tr-out"; out.dataset.for = k; out.dir = "auto"; out.setAttribute("lang", s.target); el.after(out); }
      out.textContent = s.text; out.insertAdjacentHTML("beforeend", `<div class="mp-tr-lbl" data-noi18n>${esc(MPT("ترجمة آلية"))} · ${esc(NAMES[s.source] || s.source)} → ${esc(NAMES[s.target] || s.target)}</div>`);
      el.hidden = true; out.hidden = false;
    } else { el.hidden = false; if (out) out.hidden = true; }
    s && (s.showing = on);
    trLabel(btn, on ? MPT("عرض الأصل") : MPT("ترجمة"));
    btn.setAttribute("aria-pressed", String(!!on));
  }
  const MPT = (s) => (window.MPI18n ? window.MPI18n.t(s) : s);
  /* v2.55: the translate button carries a Lucide «languages» icon; its textContent stays the plain label */
  (function trIcon() { const sp = document.querySelector("svg[aria-hidden] symbol")?.parentNode; if (sp && !document.getElementById("i-langs")) sp.insertAdjacentHTML("beforeend", '<symbol id="i-langs" viewBox="0 0 24 24"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></symbol>'); })();
  const TRI = '<svg class="ic" aria-hidden="true"><use href="#i-langs"/></svg>';
  function trLabel(btn, t) { btn.innerHTML = TRI; btn.append(t); }
  function itemOf(btn) { const [kind, ...r] = btn.dataset.aitr.split(":"); return { kind, id: r.join(":") }; }

  async function translateBtn(btn, { auto = false } = {}) {
    const k = btn.dataset.aitr, s = state.get(k);
    if (s) return show(btn, !s.showing);
    await loadMe();
    const it = itemOf(btn);
    // v2.135: chat messages use the free «الذكاء في الرسائل» translator (AI Hub) when the paid service is not available
    if (it.kind === "message" && !auto && (!subscribed() || !cfg?.features?.translate?.available || !cfg?.features?.translate?.private) && window.MPMsgAI?.ok()) {
      btn.setAttribute("aria-busy", "true"); trLabel(btn, MPT("جارٍ الترجمة…"));
      try { const r = await window.MPMsgAI.translate(it.id); state.set(k, { text: r.text, source: r.from || (r.to === "ar" ? "en" : "ar"), target: r.to, showing: true }); show(btn, true); }
      catch (e) { trLabel(btn, MPT("ترجمة")); toast(e?.message || MPT("تعذرت الترجمة")); }
      finally { btn.removeAttribute("aria-busy"); }
      return;
    }
    if (!subscribed()) return auto ? null : upsell();
    btn.setAttribute("aria-busy", "true"); trLabel(btn, MPT("جارٍ الترجمة…"));
    try {
      let r;
      try { r = await api("POST", "/api/ai/translate", { ...it, target: target() }); }
      catch (e) {
        if (e.code !== "e2ee_plaintext_required") throw e;
        if (auto || !(await disclose())) { trLabel(btn, MPT("ترجمة")); return; }
        r = await api("POST", "/api/ai/translate", { ...it, target: target(), text: targetEl(btn)?.textContent || "", consent: true });
      }
      state.set(k, { text: r.text, source: r.source, target: r.target, showing: true });
      if (r.same) { btn.remove(); return; }
      show(btn, true);
      if (r.cached === false) loadMe(true);
    } catch (e) { trLabel(btn, MPT("ترجمة")); if (!auto) toast(errText(e)); if (e.code === "subscription_required") { me = null; meP = null; upsell(); } }
    finally { btn.removeAttribute("aria-busy"); }
  }
  function disclose() {
    return new Promise((res) => {
      const s = sheet(`<h3>ترجمة رسالة مشفّرة</h3><p>${esc(cfg?.disclosure?.e2ee || "")}</p><div class="u-g8 row"><button class="btn" type="button" id="mp-ok">أوافق، ترجم</button><button class="btn ghost" type="button" id="mp-no">إلغاء</button></div>`);
      let done = false; const end = (v) => { if (done) return; done = true; closeSheet(); res(v); };
      s.querySelector("#mp-ok").addEventListener("click", () => end(true)); s.querySelector("#mp-no").addEventListener("click", () => end(false));
      s._onclose = () => { if (!done) { done = true; res(false); } };
      window.MPI18n?.apply(s);
    });
  }
  /* ---------- upsell + subscribe ---------- */
  async function upsell() {
    await loadMe();
    const p = cfg?.plans?.[0], trOff = cfg && !cfg.features?.translate?.available;
    const price = p?.price != null ? `${p.price} Pi / ${p.periodDays} يوم` : "لم يُحدَّد سعر الاشتراك بعد";
    const s = sheet(`<h3><svg class="ic hi" aria-hidden="true"><use href="#i-sparkle"/></svg>${esc(p?.name || "مجتمع+ ذكاء")}</h3><p>الترجمة الآلية ميزة لمشتركي «مجتمع+ ذكاء»</p>
      <p class="muted">اشتراك شهري اختياري بعملة Pi</p><ul class="mp-ai-feat">${(p?.featureLabels || ["ترجمة آلية للمنشورات والتعليقات والرسائل"]).map((f) => `<li>${esc(f)}</li>`).join("")}${(p?.features || []).includes("assistant") ? "" : "<li>المساعد الذكي (قريباً)</li>"}</ul>
      <p><b data-noi18n>${esc(MPT(price))}</b></p><p class="muted">واجهة التطبيق بكل اللغات مجانية للجميع</p>
      ${trOff ? `<p class="muted" role="status">${esc(OFF_TR)}</p>` : ""}<p id="mp-sub-n" class="muted" role="status"></p>
      <div class="u-g8 row"><button class="btn" type="button" id="mp-sub">اشترك الآن</button><button class="btn ghost" type="button" id="mp-not">ليس الآن</button></div>`);
    s.querySelector("#mp-not").addEventListener("click", closeSheet);
    s.querySelector("#mp-sub").addEventListener("click", () => subscribe(s.querySelector("#mp-sub"), s.querySelector("#mp-sub-n")));
    window.MPI18n?.apply(s);
  }
  async function subscribe(btn, note) {
    if (btn.disabled) return; btn.disabled = true; note.textContent = "";
    try {
      if (me?.minor) throw new Error("الاشتراكات المدفوعة غير متاحة لمن هم دون ١٨ سنة");
      if (cfg && !cfg.piEnabled) throw Object.assign(new Error(OFF_PI), { code: "not_configured" });
      if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { });
      if (!window.MPPi) throw new Error(OFF_PI);
      const p = cfg?.plans?.[0];
      await window.MPPi.pay({ amount: p?.price || 0, memo: `اشتراك شهري: ${p?.name || ""}`, purpose: "ai", refId: p?.slug, intent: async () => (await api("POST", "/api/ai/subscribe", { plan: p?.slug })).intent });
      await loadMe(true); toast("تم تفعيل الاشتراك ✓"); closeSheet(); if (/^#\/ai/.test(location.hash)) subView();
    } catch (e) {
      btn.disabled = false;
      note.textContent = MPT(e.code === "price_unset" ? "لم يُحدَّد سعر الاشتراك بعد" : e.cancelled ? "أُلغيت عملية الدفع، لم يُخصم شيء." : e.message || OFF_PI);
    }
  }

  /* ---------- buttons on posts / comments / messages ---------- */
  function needs(text) { const l = detect(text); return l && l !== ui() && !skip().includes(l); }
  const btnHtml = (k) => `<button type="button" class="mp-trb" data-aitr="${esc(k)}" aria-pressed="false">${TRI}${esc(MPT("ترجمة"))}</button>`;
  if (typeof postInner === "function") {
    
    PostHooks.inner("ai-ui#1", 450, (_pi) => function (p) {
      let h = _pi.apply(this, arguments);
      try { if (on() && p && p.status === "published" && !p.promoted && needs((p.title ? p.title + " " : "") + (p.text || ""))) h = h.replace('<div class="actions">', btnHtml("post:" + p.id) + '<div class="actions">'); } catch { /* keep the card */ }
      return h;
    });
  }
  function decorate(root = document.getElementById("view")) {
    if (!root || !on()) return;
    root.querySelectorAll('.post-open[data-open^="#/post/"]').forEach((po) => {
      const pid = po.dataset.open.slice(7), act = po.parentElement?.querySelector(":scope > .actions");
      if (!act || po.parentElement.querySelector(":scope > .mp-trb")) return;
      const p = typeof S !== "undefined" && S.post ? S.post(pid) : null;
      if (p && (p.status !== "published" || p.promoted)) return;
      const txt = p ? (p.title ? p.title + " " : "") + (p.text || "") : po.querySelector(".body")?.textContent || "";
      if (needs(txt)) act.insertAdjacentHTML("beforebegin", btnHtml("post:" + pid));
    });
    root.querySelectorAll(".comment").forEach((c) => {
      if (c.querySelector(":scope > .cact .mp-trb")) return;
      const id = c.querySelector(":scope > .cact [data-cr]")?.dataset.cr, body = c.querySelector(":scope > .cbody");
      if (id && body && needs(body.textContent)) c.querySelector(":scope > .cact").insertAdjacentHTML("afterbegin", btnHtml("comment:" + id));
    });
    root.querySelectorAll(".cm-m[data-id]").forEach((m) => {
      const b = m.querySelector(".cm-b"), sp = b?.querySelector(":scope > span[dir=auto]");
      if (!b || !sp || b.querySelector(".mp-trb") || b.classList.contains("del")) return;
      if (needs(sp.textContent)) sp.insertAdjacentHTML("afterend", btnHtml("message:" + m.dataset.id));
    });
    // restore toggled state after a re-render, then auto-translate what is visible
    const pend = [];
    root.querySelectorAll(".mp-trb[data-aitr]").forEach((b) => { const s = state.get(b.dataset.aitr); if (s) { if (s.showing && b.getAttribute("aria-pressed") !== "true") show(b, true); } else if (!b.dataset.auto) pend.push(b); });
    if (pend.length && subscribed() && me?.prefs?.auto) autoTranslate(pend);
  }
  let autoBusy = false;
  async function autoTranslate(btns) {
    if (autoBusy) return; autoBusy = true;
    try {
      const items = btns.filter((b) => !b.dataset.aitr.startsWith("message:")).slice(0, 25); // messages stay tap-to-translate (privacy)
      items.forEach((b) => (b.dataset.auto = 1));
      if (!items.length) return;
      const r = await api("POST", "/api/ai/translate/batch", { items: items.map(itemOf), target: target() });
      for (const it of r.items || []) {
        if (!it.ok) continue;
        const k = it.kind + ":" + it.id; state.set(k, { text: it.text, source: it.source, target: it.target, showing: !it.same });
        document.querySelectorAll(`.mp-trb[data-aitr="${CSS.escape(k)}"]`).forEach((b) => (it.same ? b.remove() : show(b, true)));
      }
    } catch { /* auto is best effort; the button still works */ } finally { autoBusy = false; }
  }
  document.addEventListener("click", (e) => { const b = e.target.closest?.(".mp-trb[data-aitr]"); if (!b) return; e.preventDefault(); e.stopPropagation(); translateBtn(b); }, true);
  let t0 = 0;
  new MutationObserver(() => { if (!t0) t0 = setTimeout(() => { t0 = 0; decorate(); }, 60); }).observe(document.getElementById("view") || document.body, { childList: true, subtree: true });

  /* ---------- #/ai, #/settings/translate, #/admin/ai ---------- */
  async function subView() {
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/me", "حسابي"], title: "اشتراك «مجتمع+ ذكاء»", icon: "sparkle" })}<div id="mp-ai"><div class="skel"></div></div></div>`;
    const box = view.querySelector("#mp-ai");
    if (!on()) { box.innerHTML = `<p class="muted">${esc(OFF_TR)}</p>`; return; }
    await loadMe(true);
    if (!me) { box.textContent = "تعذر الاتصال بالخادم"; return; }
    const s = me.subscription, live = s?.state === "active", u = me.usage.translate, p = cfg.plans[0];
    box.innerHTML = `<div class="card"><h3 class="u-m0 u-mb6 u-t-lg">${esc(p?.name || "مجتمع+ ذكاء")}</h3>
      <p>${live ? `<b>فعّال</b> · <span data-noi18n>${esc(new Date(s.periodEnd).toLocaleDateString())}</span>` : s ? "<b>منتهٍ</b>" : esc(p?.price != null ? p.price + " Pi" : "لم يُحدَّد سعر الاشتراك بعد")}</p>
      <ul class="mp-ai-feat">${(p?.featureLabels || []).map((f) => `<li>${esc(f)}</li>`).join("")}<li>المساعد الذكي (قريباً)</li></ul>
      ${cfg.features?.translate?.available ? "" : `<p class="muted">${esc(OFF_TR)}</p>`}${me.piEnabled ? "" : `<p class="muted">${esc(OFF_PI)}</p>`}
      <p id="mp-sub-n" class="muted" role="status"></p>
      <div class="u-g8 u-fww row"><button class="btn" type="button" id="mp-sub">${live ? "تجديد الاشتراك" : "اشترك الآن"}</button>
      ${live && s.source === "pi" ? `<button class="btn ghost" type="button" id="mp-cancel">${s.cancelAtPeriodEnd ? "استئناف التجديد" : "إلغاء التجديد"}</button>` : ""}</div></div>
      <div class="card"><h3 class="u-m0 u-mb6 u-t-lg">الاستخدام هذا الشهر</h3><div class="mp-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${u.pct}"><i style="width:${u.pct}%"></i></div>
      <p class="muted">${UI.num(u.chars)} / ${UI.num(u.limitChars)} حرف · ${UI.num(u.requests)} طلب · ${UI.num(u.cacheHits)} من الذاكرة المؤقتة</p></div>
      <div class="card"><a class="btn ghost" href="#/settings/translate">تفضيلات الترجمة</a> <a class="btn ghost" href="#/settings/language">لغة الواجهة</a></div>`;
    box.querySelector("#mp-sub").addEventListener("click", () => subscribe(box.querySelector("#mp-sub"), box.querySelector("#mp-sub-n")));
    box.querySelector("#mp-cancel")?.addEventListener("click", async () => { try { await api("POST", `/api/ai/subscription/${s.cancelAtPeriodEnd ? "resume" : "cancel"}`, {}); subView(); } catch (e) { toast(e.message); } });
    window.MPI18n?.apply(view);
  }
  async function prefsView() {
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "تفضيلات الترجمة", icon: "globe" })}<div id="mp-tp"><div class="skel"></div></div></div>`;
    const box = view.querySelector("#mp-tp");
    if (!on()) { box.innerHTML = `<p class="muted">${esc(OFF_TR)}</p>`; return; }
    let p; try { p = await api("GET", "/api/ai/translate/prefs"); } catch (e) { box.textContent = e.message; return; }
    box.innerHTML = `<div class="card">${subscribed() ? "" : `<p class="muted">الترجمة الآلية ميزة لمشتركي «مجتمع+ ذكاء» · <a href="#/ai">اشترك الآن</a></p>`}
      <label class="chk"><input type="checkbox" id="mp-auto" ${p.auto ? "checked" : ""}> ترجمة تلقائية لما أراه</label>
      <h4>الترجمة إلى</h4><select id="mp-tgt"><option value="">لغة الواجهة (افتراضي)</option>${Object.entries(NAMES).map(([k, v]) => `<option value="${k}" ${p.target === k ? "selected" : ""} data-noi18n>${v}</option>`).join("")}</select>
      <h4>لا تترجم هذه اللغات</h4>${Object.entries(NAMES).map(([k, v]) => `<label class="chk"><input type="checkbox" data-skip="${k}" ${p.skip.includes(k) ? "checked" : ""}> <span data-noi18n>${v}</span></label>`).join("")}</div>`;
    const put = async () => { try { const r = await api("PUT", "/api/ai/translate/prefs", { auto: box.querySelector("#mp-auto").checked, target: box.querySelector("#mp-tgt").value || null, skip: [...box.querySelectorAll("[data-skip]:checked")].map((x) => x.dataset.skip) }); if (me) me.prefs = r; toast("تم الحفظ"); } catch (e) { toast(e.message); } };
    box.querySelectorAll("input,select").forEach((x) => x.addEventListener("change", put));
    window.MPI18n?.apply(view);
  }
  async function adminView() {
    if (!DB.isAdmin) return Views.notFound();
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "إدارة الذكاء", icon: "sparkle" })}<div id="mp-aa"><div class="skel"></div></div></div>`;
    const box = view.querySelector("#mp-aa");
    try {
      const [pl, f] = await Promise.all([api("GET", "/api/admin/ai/plans"), api("GET", "/api/admin/ai/finance")]);
      const p = pl.plans[0];
      box.innerHTML = `<div class="card"><h3 class="u-m0 u-mb6 u-t-lg">${esc(p.name)}</h3>
        <label>السعر (Pi) <input id="mp-price" type="number" min="0" step="0.0000001" value="${p.price ?? ""}" placeholder="لم يُحدَّد سعر الاشتراك بعد"></label>
        <label>حد الأحرف الشهري <input id="mp-chars" type="number" min="0" value="${p.limits.translate.chars}"></label>
        <label>حد التكلفة الشهري (USD) <input id="mp-usd" type="number" min="0" step="0.01" value="${p.limits.translate.costUsd}"></label>
        <label class="chk"><input type="checkbox" id="mp-act" ${p.active ? "checked" : ""}> متاحة للاشتراك</label><button class="btn" type="button" id="mp-psave">حفظ</button></div>
        <div class="card"><h3 class="u-m0 u-mb6 u-t-lg">منح اشتراك</h3><input id="mp-gu" placeholder="@handle"> <input id="mp-gd" type="number" min="1" max="366" value="30" aria-label="أيام"> <button class="btn" type="button" id="mp-grant">منح</button> <button class="btn ghost" type="button" id="mp-revoke">سحب</button></div>
        <div class="card" data-noi18n><h3 class="u-m0 u-mb6 u-t-lg">${esc(f.period)}</h3><p>Revenue ${f.revenue} Pi · refunds ${f.refunds} · net ${f.net} Pi · ${f.payments} payments · ${f.activeSubscribers} active (${f.grants} grants)</p>
        <p>Provider cost $${f.providerCostUsd} / budget $${f.budgetUsd}${f.marginUsd != null ? ` · margin $${f.marginUsd}` : ""}</p>
        ${f.byFeature.map((x) => `<div class="muted">${esc(x.feature)} · ${esc(x.provider)} · ${x.requests} req · ${x.chars} chars · ${x.cacheHits} cache · $${x.costUsd}</div>`).join("")}</div>`;
      box.querySelector("#mp-psave").addEventListener("click", async () => {
        const v = box.querySelector("#mp-price").value;
        try { await api("PUT", "/api/admin/ai/plans/" + p.slug, { price: v === "" ? null : Number(v), active: box.querySelector("#mp-act").checked, limits: { translate: { chars: Number(box.querySelector("#mp-chars").value), costUsd: Number(box.querySelector("#mp-usd").value) } } }); toast("تم الحفظ"); } catch (e) { toast(e.message); }
      });
      const g = (path) => async () => { try { await api("POST", path, { user: box.querySelector("#mp-gu").value.trim(), days: Number(box.querySelector("#mp-gd").value) }); toast("تم"); } catch (e) { toast(e.message); } };
      box.querySelector("#mp-grant").addEventListener("click", g("/api/admin/ai/grants"));
      box.querySelector("#mp-revoke").addEventListener("click", g("/api/admin/ai/grants/revoke"));
    } catch (e) { box.textContent = e.message; }
    window.MPI18n?.apply(view);
  }
  MPRoutes.extend((a, b, prev) => {
    return { ai: () => subView() };
  });
  MPRoutes.add("admin", (a, b, next) => {
        if (a === "ai") return adminView();
        next();
        if (!a && DB.isAdmin) setTimeout(() => { if (location.hash === "#/admin" && !document.getElementById("mp-adm-ai")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-db u-ci card" id="mp-adm-ai" href="#/admin/ai"><svg class=ei aria-hidden=true><use href=#i-sparkle /></svg> <b>إدارة الذكاء</b></a>`); }, 0);
      });
  MPRoutes.add("settings", (a, b, next) => (a === "translate" ? prefsView() : next()));
  const setCard = () => { if (/^#\/settings\/?(\?|$)/.test(location.hash) && !document.getElementById("mp-ai-set")) (view.querySelector(".wrap") || view).insertAdjacentHTML("beforeend", `<div class="card" id="mp-ai-set"><h3 class="u-m0 u-mb8 u-t-lg"><svg class="ic hi" aria-hidden="true"><use href="#i-sparkle"/></svg>مجتمع+ ذكاء</h3><a class="btn ghost" href="#/ai">اشتراكي</a> <a class="btn ghost" href="#/settings/translate">تفضيلات الترجمة</a> <a class="btn ghost" href="#/settings/language">اللغة</a></div>`); };
  if (typeof Views !== "undefined" && Views.settings) { MPSettings.add(function () { setCard(); }); }
  window.MPAI = { upsell, subView, prefsView, adminView, detect, translateBtn, state, refresh: () => loadMe(true), version: "2.24.0" };
  loadMe(); window.MPChunks?.load("assistant").catch(() => { }); window.MPChunks?.load("launch").catch(() => { }); window.MPChunks?.load("beta").catch(() => { }); // phase 42/50: assistant button in the composer; help center, tickets, ambassadors, waitlist
  const dev = () => { if (/^#\/(developers|oauth|settings\/?(\?|$))/.test(location.hash) && window.MPChunks && !window.MPDev) window.MPChunks.load("dev").then(() => { if (!/^#\/settings/.test(location.hash)) route(); }).catch(() => { }); }; // phase 47: developer portal + OAuth consent (0 B in core)
  addEventListener("hashchange", dev); dev();
  if (typeof DB !== "undefined" && DB.onboarded) {
    if (/^#\/(ai|settings\/translate|admin\/ai)(\/|$|\?)/.test(location.hash) && typeof route === "function") route();
    else { if (/^#\/settings\/?(\?|$)/.test(location.hash)) setCard(); if (typeof rerender === "function" && document.getElementById("sheet")?.classList.contains("hidden") && !(window.formDirty && window.formDirty())) try { rerender(); } catch { /* ok */ } } // v2.52: never wipe a form the member started (e.g. the ad wizard)
  }
})();
