/* =====================================================================
 * مجتمع بلس — Phase 35 UI: child safety & sensitive content (lazy "minors" chunk, needs minors-core.js).
 * • Age gate on sign-up: a birth-date field in the register form (sent as birthDate), a kind refusal screen
 *   below the minimum age. Settings → «العمر والمحتوى الحساس» (#/age): declare/correct the birth date, see the
 *   protections that apply to a minor, choose how sensitive content is shown (تغطية / عرض / إخفاء).
 * • Elegant cover over sensitive posts: frosted blur, the publisher's labels, «عرض» (tap to reveal, in place),
 *   «لماذا أرى هذا؟», support lines on self-harm labels. Follows the server's per-viewer decision (post.cover),
 *   falling back to the shared rules in MPMinorsCore for local posts.
 * • Publisher labels: label chips in the composer and «تصنيف المحتوى» in the menu of one's own posts.
 * • «بلاغ عاجل» in the report sheet (and #/urgent): child safety / self-harm / threats go to the priority queue.
 * • Family (#/family): guardian links with two-sided consent, the guardian's few controls, and what the
 *   guardian sees — shown to the minor too, with the activity log.
 * • Safety staff queue (#/safety-cases[/id]): priority list, case detail with preserved evidence and chain
 *   check, actions, authority-report drafts exported as JSON for MANUAL submission.
 * REST contract: docs/MINORS-SAFETY.md. Styles are injected here so the core CSS stays inside its budget.
 * ===================================================================== */
(function MinorsUI() {
  if (window.MPMinorsUI) return; // loaded once (chunk + tests may both inject it)
  const C = () => window.MPMinorsCore;
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const h = (s) => esc(String(s ?? ""));
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const uiLang = () => window.MPI18n?.current?.() || "ar"; // v2.67 i18n: dates follow the UI language (Arabic output unchanged)
  const fmtDay = (iso) => { try { return new Intl.DateTimeFormat(uiLang(), { dateStyle: "long" }).format(new Date(iso)); } catch { return iso; } };
  const fmt = (iso) => { try { return new Intl.DateTimeFormat(uiLang(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; } };
  const say = (msg) => { const r = document.getElementById("mn-say"); if (r) { r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); } };
  const st = { age: null, ageAt: 0, labels: new Map(), revealed: new Set(), pending: null, pendingBatch: new Set(), batchT: null };

  /* ---------- icons + styles ---------- */
  const ICONS = {
    eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    family: '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    queue: '<path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/>'
  };
  (function sprite() { const s = document.querySelector("svg[aria-hidden] symbol")?.parentNode; if (!s) return; s.insertAdjacentHTML("beforeend", Object.entries(ICONS).filter(([k]) => !document.getElementById("i-" + k)).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("")); })();
  if (!document.getElementById("mn-css")) document.head.insertAdjacentHTML("beforeend", `<style id="mn-css">
.mn-cover{position:relative;border-radius:14px;overflow:hidden;isolation:isolate;display:grid}
.mn-cover>.mn-blur,.mn-cover>.mn-veil{grid-area:1/1}
.mn-cover .mn-blur{filter:blur(22px) saturate(1.15);transform:scale(1.04);pointer-events:none;user-select:none;transition:filter .45s ease,transform .45s ease;min-height:150px}
.mn-cover .mn-veil{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:18px;text-align:center;color:#fff;
  background:radial-gradient(120% 90% at 50% 0%,rgba(91,43,214,.55),rgba(15,13,22,.78));z-index:2;transition:opacity .35s ease}
.mn-cover .mn-veil b{font-size:16px}.mn-cover .mn-veil p{margin:0;font-size:13px;opacity:.92;max-width:34ch;line-height:1.6}
.mn-badge{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.16);backdrop-filter:blur(6px)}
.mn-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}.mn-chip{font-size:12px;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35)}
.mn-veil .btn{background:#fff;color:#2a1a66;font-weight:700;min-height:40px;padding:8px 20px}.mn-veil .btn:focus-visible,.mn-why:focus-visible{outline:3px solid #ffd76a;outline-offset:2px}
.mn-why{background:none;border:0;color:#fff;text-decoration:underline;font-size:13px;padding:6px;min-height:32px}
.mn-support{font-size:12.5px;background:rgba(255,255,255,.14);border-radius:10px;padding:6px 10px}
.mn-cover.on .mn-blur{filter:none;transform:none;pointer-events:auto;user-select:auto}.mn-cover.on .mn-veil{opacity:0;pointer-events:none;visibility:hidden}
.mn-recover{position:absolute;top:8px;inset-inline-start:8px;z-index:3;font-size:12px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted);padding:3px 10px;display:none}.mn-cover.on .mn-recover{display:block}
.mn-hidden{display:flex;gap:8px;align-items:center;padding:6px 2px}
.mn-page{max-width:560px;margin:auto}.mn-page h2:focus{outline:none}
.mn-row{display:flex;gap:10px;align-items:center}.mn-grow{flex:1;min-width:0}
.mn-pill{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;border-radius:999px;padding:3px 10px;background:var(--accent2);color:var(--accent)}
.mn-pill.warn{background:#fff3d6;color:#7a4b00}.mn-pill.crit{background:#ffe1e1;color:#a11616}.mn-pill.ok{background:#dcf5e7;color:#13603a}
.mn-list{list-style:none;padding:0;margin:8px 0 0}.mn-list li{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)}.mn-list li:last-child{border:0}
.mn-opt{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:12px;margin:6px 0;cursor:pointer}.mn-opt input{width:auto;margin-top:4px}
.mn-opt:has(input:checked){border-color:var(--accent);background:var(--accent2)}.mn-opt:has(input:disabled){opacity:.6;cursor:not-allowed}
.mn-err{color:var(--danger);font-size:13px;min-height:18px;margin-top:6px}
.mn-lbl{border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin:8px 0}.mn-lbl legend{font-size:13px;color:var(--muted);padding:0 4px}
.mn-chipset{display:flex;flex-wrap:wrap;gap:6px}.mn-chipset button{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:5px 12px;font-size:13px;min-height:32px}
.mn-chipset button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.mn-gate{position:fixed;inset:0;z-index:100;background:var(--bg);display:grid;place-items:center;padding:24px;text-align:center}
.mn-gate .card{max-width:420px}.mn-sev{font-weight:700}
.mn-case{display:block;color:inherit;text-decoration:none}.mn-case.crit{border-inline-start:4px solid #d63a3a}.mn-case.high{border-inline-start:4px solid #e88b2a}
.mn-ev pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:var(--bg);border-radius:10px;padding:8px;max-height:260px;overflow:auto;direction:ltr;text-align:left}
.mn-banner{display:flex;gap:10px;align-items:flex-start;border-radius:12px;padding:10px 12px;background:var(--accent2);margin-bottom:10px;font-size:14px}
@media (prefers-reduced-motion: reduce){.mn-cover .mn-blur,.mn-cover .mn-veil{transition:none}}
</style>`);
  if (!document.getElementById("mn-say")) document.body.insertAdjacentHTML("beforeend", `<div id="mn-say" class="sr-only" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"></div>`);

  /* ---------- age summary (cached) ---------- */
  async function loadAge(force) {
    if (!online() || (window.MPSession && !MPSession.signedIn())) return st.age; // v2.51: guests have no age record to read
    if (!force && st.age && Date.now() - st.ageAt < 60e3) return st.age;
    try { st.age = await api("GET", "/api/age"); st.ageAt = Date.now(); } catch { }
    return st.age;
  }
  const viewerInfo = () => {
    const a = st.age, legacy = { warn: "blur", hide: "hide", show: "show" }[(typeof DB !== "undefined" && DB.settings?.sensitive) || "warn"] || "blur";
    return { band: a?.band || "unknown", pref: a ? a.contentPref : legacy };
  };
  const labelName = (k) => C()?.LABELS[k]?.name || k;

  /* ---------- the cover ---------- */
  function labelsOf(p) { return p.contentLabels || st.labels.get(p.id)?.labels || null; }
  function coverState(p) {
    if (!p || p.author === (typeof DB !== "undefined" && DB.me) || st.revealed.has(p.id)) return "show";
    if (p.cover === "blur") return "cover";
    if (p.cover === "none") return "show";
    const labels = labelsOf(p);
    if (!labels && !p.sensitive) return "show";
    if (online() && !st.labels.has(p.id) && !p.contentLabels) queueBatch(p.id);
    const known = st.labels.get(p.id); if (known) return known.cover === "blur" ? "cover" : known.cover === "hidden" ? "hide" : "show";
    return C() ? C().decide(viewerInfo(), { labels, sensitive: !!p.sensitive }) : "cover";
  }
  function queueBatch(id) {
    if (!/^[\w-]{3,40}$/.test(id)) return;
    st.pendingBatch.add(id); clearTimeout(st.batchT);
    st.batchT = setTimeout(async () => {
      const ids = [...st.pendingBatch].slice(0, 50); st.pendingBatch.clear(); if (!ids.length) return;
      try {
        const r = await api("GET", "/api/content-labels/batch?ids=" + ids.join(","));
        let changed = false;
        for (const i of ids) { const it = r.items?.[i] || { labels: null, cover: "hidden" }; const before = st.labels.get(i); st.labels.set(i, it); if (!before || before.cover !== it.cover) changed = true; }
        if (changed && !document.querySelector("#sheet:not(.hidden)") && typeof rerender === "function") rerender();
      } catch { }
    }, 250);
  }
  function veil(p, inner) {
    const l = labelsOf(p), keys = l ? C()?.allLabels(l) || [] : [];
    const first = keys.map(k => C()?.LABELS[k]).find(Boolean);
    const support = keys.includes("self_harm") && st.age?.helplines?.length ? `<div class="mn-support">إن كنت تمرّ بوقت صعب، لست وحدك: ${st.age.helplines.map(x => `${h(x.name)} <bdi dir="ltr">${h(x.number)}</bdi>`).join(" · ")}</div>` : "";
    const media = l && Object.keys(l.media || {}).length ? `<p>${Object.entries(l.media).map(([i, v]) => `الصورة ${+i + 1}: ${v.map(labelName).join("، ")}`).join(" · ")}</p>` : "";
    return `<div class="mn-cover" data-mn-cover="${h(p.id)}"><button type="button" class="mn-recover" data-mn-recover="${h(p.id)}">${ic("eyeOff", "sm")} تغطية</button>
      <div class="mn-blur" aria-hidden="true" inert>${inner}</div>
      <div class="mn-veil" role="group" aria-labelledby="mn-t-${h(p.id)}">
        <div class="mn-badge" aria-hidden="true">${ic("eyeOff")}</div>
        <b id="mn-t-${h(p.id)}">محتوى قد يكون حساساً</b>
        ${keys.length ? `<div class="mn-chips">${keys.map(k => `<span class="mn-chip">${h(labelName(k))}</span>`).join("")}</div>` : ""}
        <p>${h(first ? first.hint : "صنّفه الناشر أو المراجعة الآلية كمحتوى حساس")}</p>${media}${support}
        <button type="button" class="btn" data-mn-reveal="${h(p.id)}">عرض المحتوى</button>
        <button type="button" class="mn-why" data-mn-why="${h(p.id)}">لماذا أرى هذا؟</button>
      </div></div>`;
  }
  if (typeof postInner === "function") {
    const _pi = postInner;
    postInner = function (p, opts = {}) {
      if (!p || p.status === "deleted" || p.status === "removed") return _pi.call(this, p, opts);
      const s = opts.revealed ? "show" : coverState(p);
      if (s === "hide") return `<div class="mn-hidden muted" role="note">${ic("eyeOff", "sm")} محتوى مخفي ${st.age?.minor ? "لحماية الحسابات دون ١٨ سنة" : "حسب إعداداتك"}</div>`;
      const inner = _pi.call(this, p, { ...opts, revealed: true }); // our cover replaces the legacy blur
      return s === "cover" ? veil(p, inner) : inner;
    };
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mn-reveal],[data-mn-why],[data-mn-recover]"); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset;
    if (d.mnReveal) {
      st.revealed.add(d.mnReveal);
      const box = t.closest(".mn-cover"); if (!box) return;
      const blur = box.querySelector(".mn-blur"); blur.removeAttribute("inert"); blur.removeAttribute("aria-hidden"); box.classList.add("on");
      setTimeout(() => (box.querySelector(".mn-blur a, .mn-blur button") || box.querySelector(".mn-recover"))?.focus({ preventScroll: true }), reduced() ? 0 : 200);
      say("ظهر المحتوى");
    } else if (d.mnRecover) {
      st.revealed.delete(d.mnRecover);
      const box = t.closest(".mn-cover"); const blur = box.querySelector(".mn-blur"); blur.setAttribute("inert", ""); blur.setAttribute("aria-hidden", "true"); box.classList.remove("on"); box.querySelector("[data-mn-reveal]")?.focus();
    } else if (d.mnWhy) {
      const p = typeof S !== "undefined" ? S.post(d.mnWhy) : null; const keys = p && labelsOf(p) ? C().allLabels(labelsOf(p)) : [];
      sheet(`<h4>لماذا هذا المحتوى مغطّى؟</h4>${keys.length ? `<ul class="mn-list">${keys.map(k => `<li>${ic("tag", "sm")}<div><b>${h(labelName(k))}</b><div class="muted">${h(C().LABELS[k]?.hint || "")}</div></div></li>`).join("")}</ul>` : `<p class="muted">اكتُشف تلقائياً أو علّمه الناشر كمحتوى حساس.</p>`}
        <p class="muted">التغطية تحميك من مفاجآت لا تريدها. يمكنك تغيير ذلك من «العمر والمحتوى الحساس».</p><a class="btn block" href="#/age" id="mn-why-go">إعدادات المحتوى الحساس</a>`);
      document.getElementById("mn-why-go").onclick = () => closeSheet();
    }
  }, true);

  /* ---------- sign-up: birth date + age gate ---------- */
  const todayIso = () => new Date().toISOString().slice(0, 10);
  function injectDob() {
    if (!document.getElementById("a-name") || document.getElementById("mn-dob")) return;
    const anchor = document.getElementById("a-handle"); if (!anchor) return;
    anchor.insertAdjacentHTML("afterend", `<label for="mn-dob" class="u-db u-mt10 muted">تاريخ الميلاد</label><input type="date" id="mn-dob" max="${todayIso()}" min="1900-01-01" aria-describedby="mn-dob-h" autocomplete="bday"><div id="mn-dob-h" class="u-mt4 muted">لا يظهر لأحد. نستخدمه لحماية من هم دون ١٨ سنة.</div>`);
    document.getElementById("mn-dob").addEventListener("change", (e) => { const a = C()?.ageOn(e.target.value); const hint = document.getElementById("mn-dob-h"); if (a !== null && a !== undefined && a < (st.age?.minAge || 13)) hint.textContent = `مجتمع بلس لمن هم ${st.age?.minAge || 13} سنة فأكثر.`; else if (a !== null && a < 18) hint.textContent = "سيكون حسابك خاصاً ومحميّاً بإعدادات إضافية حتى تبلغ ١٨ سنة."; else hint.textContent = "لا يظهر لأحد. نستخدمه لحماية من هم دون ١٨ سنة."; });
  }
  if (typeof showAuth === "function") { const _sa = showAuth; showAuth = function (mode) { const r = _sa.apply(this, arguments); if (mode === "register") injectDob(); return r; }; }
  injectDob();
  function showGate(msg) {
    if (document.querySelector(".mn-gate")) return;
    document.body.insertAdjacentHTML("beforeend", `<div class="mn-gate" role="alertdialog" aria-modal="true" aria-labelledby="mn-gate-t" aria-describedby="mn-gate-d"><div class="card">${ic("shield")}<h2 id="mn-gate-t" tabindex="-1">نراك قريباً</h2><p id="mn-gate-d">${h(msg || "مجتمع بلس لمن هم ١٣ سنة فأكثر.")}</p><p class="muted">يمكنك العودة عندما تبلغ السن المناسبة. اطلب من أحد والديك مساعدتك في استكشاف الإنترنت بأمان.</p><button type="button" class="btn block" id="mn-gate-ok">حسناً</button></div></div>`);
    document.getElementById("mn-gate-t").focus();
    document.getElementById("mn-gate-ok").onclick = () => { document.querySelector(".mn-gate")?.remove(); };
  }
  if (typeof Remote !== "undefined" && Remote.use && !Remote.__mn) {
    Remote.use(async function ageGate(req, next) {
      let { body } = req;
      if (req.method === "POST" && req.path === "/api/auth/register" && body && !body.birthDate) { const dob = document.getElementById("mn-dob")?.value; if (dob) body = { ...body, birthDate: dob }; }
      try { return await next({ ...req, body }); }
      catch (e) { if (e && e.code === "age_gate") showGate(e.message); throw e; }
    });
    Remote.__mn = true;
  }

  /* ---------- composer labels, own-post labels, urgent report ---------- */
  const chipset = (sel = []) => `<div class="mn-chipset" role="group" aria-label="التصنيفات">${(C()?.LABEL_KEYS || []).map(k => `<button type="button" data-mn-l="${k}" aria-pressed="${sel.includes(k)}" title="${h(C().LABELS[k].hint)}">${h(C().LABELS[k].name)}</button>`).join("")}</div>`;
  const picked = (root) => [...root.querySelectorAll("[data-mn-l][aria-pressed=true]")].map(b => b.dataset.mnL);
  function bindChips(root, onChange) { root.querySelectorAll("[data-mn-l]").forEach(b => b.onclick = () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); onChange(picked(root)); }); }
  /* v2.50: label chips in the general editor through window.MPComposerHooks (sent as `labels` on POST /api/posts) */
  (window.MPComposerHooks = window.MPComposerHooks || []).push({
    id: "minors-labels", modes: ["general"],
    mount(cx) {
      const host = cx.slot("options"); if (!host || !C()) return;
      host.insertAdjacentHTML("beforeend", `<fieldset id="mn-lbl" class="mn-lbl"><legend>${ic("tag", "sm")} تصنيف المحتوى الحساس (اختياري)</legend>${chipset([])}<div class="u-mt6 muted">يُغطّى المنشور لمن يختار التغطية، ويُخفى عمّن هم دون ١٨ سنة.</div></fieldset>`);
      const box = host.querySelector("#mn-lbl"), sens = cx.el.querySelector("#sens");
      bindChips(box, (labels) => { if (sens && labels.length && !sens.checked) { sens.checked = true; sens.dispatchEvent(new Event("change", { bubbles: true })); } });
      this.onType(cx.type, cx);
    },
    onType(type, cx) { const b = cx.el.querySelector("#mn-lbl"); if (b) b.hidden = type === "story"; },
    apply(body, cx) { const b = cx.el.querySelector("#mn-lbl"); if (!b || b.hidden) return; const labels = picked(b); if (labels.length) body.labels = labels; }
  });
  function labelSheet(pid) {
    const p = S.post(pid); const cur = (p && labelsOf(p)?.post) || [];
    const s = sheet(`<h4>${ic("tag", "sm")} تصنيف المحتوى</h4><p class="muted">اختر ما ينطبق على منشورك. يُغطّى لمن يختار ذلك ويُخفى عمّن هم دون ١٨.</p>${chipset(cur)}<div class="mn-err" id="mn-ls-e" role="alert"></div><button type="button" class="btn block" id="mn-ls-go">حفظ التصنيف</button>`);
    bindChips(s, () => { });
    s.querySelector("#mn-ls-go").onclick = async () => {
      try { const r = await api("PUT", `/api/posts/${encodeURIComponent(pid)}/labels`, { labels: picked(s) }); if (p) { p.contentLabels = r.labels; p.sensitive = C().allLabels(r.labels).length > 0 || p.sensitive; } closeSheet(); toast("تم حفظ التصنيف"); if (typeof rerender === "function") rerender(); }
      catch (e) { s.querySelector("#mn-ls-e").textContent = e.message || "تعذّر الحفظ"; }
    };
  }
  if (typeof moreMenu === "function") {
    const _mm = moreMenu;
    moreMenu = function (pid) {
      const r = _mm.apply(this, arguments); const p = S.post(pid);
      if (p && p.author === DB.me && online()) { const m = document.querySelector("#sheet .menu"); if (m && !m.querySelector("#mn-lb")) { m.insertAdjacentHTML("beforeend", `<button id="mn-lb" type="button"><svg class=ei aria-hidden=true><use href=#i-tag /></svg> تصنيف المحتوى الحساس</button>`); m.querySelector("#mn-lb").onclick = () => labelSheet(pid); } }
      return r;
    };
  }
  // the urgent-report button joins whichever report sheet is open: the base one (wrapped here) or the 3-step one from the
  // protection chunk, which replaces reportFlow and announces itself with «mp:report-open» (chunk load order varies)
  const addUrg = (target, kind) => {
      const panel = document.querySelector("#sheet .panel");
      if (panel && online() && !panel.querySelector("#mn-urg")) { panel.insertAdjacentHTML("beforeend", `<button type="button" class="btn ghost block" id="mn-urg" style="margin-top:10px;color:var(--danger);border-color:var(--danger)">${ic("alert", "sm")} خطر على طفل أو على حياة شخص؟ بلاغ عاجل</button>`); panel.querySelector("#mn-urg").onclick = () => urgentSheet(target, kind); }
    };
  document.addEventListener("mp:report-open", (e) => addUrg(e.detail?.target, e.detail?.kind));
  if (typeof reportFlow === "function") {
    const _rf = reportFlow;
    reportFlow = function (target, kind) {
      const r = _rf.apply(this, arguments);
      addUrg(target, kind);
      return r;
    };
  }
  function urgentSheet(target, kind) {
    const cats = [["child_safety", "سلامة طفل أو استغلاله"], ["self_harm", "إيذاء النفس أو الانتحار"], ["violent_threat", "تهديد بالعنف"], ["exploitation", "ابتزاز أو استغلال"], ["trafficking", "اتجار بالبشر"], ["other", "خطر آخر"]];
    const s = sheet(`<h4>${ic("alert", "sm")} بلاغ عاجل</h4><p class="muted">يصل مباشرة إلى فريق السلامة بأولوية عالية، ويُحفظ الدليل. هويتك لا تظهر للطرف الآخر.</p>
      <fieldset class="u-b0 u-p0 u-m0"><legend class="muted">نوع الخطر</legend>${cats.map(([k, n], i) => `<label class="mn-opt"><input type="radio" name="mn-cat" value="${k}" ${i === 0 ? "checked" : ""}><span>${n}</span></label>`).join("")}</fieldset>
      <label for="mn-ud" class="u-db u-mt8 muted">ماذا حدث؟ (اختياري)</label><textarea id="mn-ud" rows="3" maxlength="1000"></textarea>
      <div class="mn-err" id="mn-ue" role="alert"></div><button type="button" class="btn block" id="mn-ugo">إرسال البلاغ العاجل</button>
      <p class="u-mt8 muted">إن كان هناك خطر مباشر الآن فاتصل بالطوارئ أولاً.</p>`);
    s.querySelector("#mn-ugo").onclick = async () => {
      const b = s.querySelector("#mn-ugo"); b.disabled = true;
      try {
        const r = await api("POST", "/api/safety/escalate", { target: target || undefined, kind: target ? kind : undefined, category: s.querySelector("input[name=mn-cat]:checked")?.value, details: s.querySelector("#mn-ud").value.trim() });
        const lines = (r.helplines || []).map(x => `<li>${ic("bell", "sm")}<div><b>${h(x.name)}</b> <bdi dir="ltr">${h(x.number)}</bdi></div></li>`).join("");
        sheet(`<h4>${ic("check", "sm")} وصل بلاغك العاجل</h4><p>رقم المرجع: <bdi dir="ltr"><b>${h(r.reference)}</b></bdi></p><p class="muted">سيراجعه فريق السلامة بأسرع وقت. شكراً لأنك اهتممت.</p>${r.selfHarm ? `<div class="mn-banner">${ic("heart")}<div>إن كان أحدهم في خطر الآن، تواصل مع:</div></div>` : ""}${lines ? `<ul class="mn-list">${lines}</ul>` : ""}<button type="button" class="btn block" id="mn-udone">تم</button>`);
        document.getElementById("mn-udone").onclick = () => closeSheet();
      } catch (e) { s.querySelector("#mn-ue").textContent = e.message || "تعذّر الإرسال"; b.disabled = false; }
    };
  }

  /* ---------- #/age ---------- */
  const BANDS = { adult: ["بالغ (١٨+)", "ok"], teen: ["دون ١٨ — حساب محمي", "warn"], unknown: ["لم يُحدَّد العمر", ""], child: ["دون السن المسموح", "crit"] };
  /* v2.67 i18n: strings built into native dialogs / messages go through MPI18n.t; dynamic parts sit in their own spans so the DOM translator matches whole UI strings */
  const tr = (s) => (window.MPI18n?.t ? window.MPI18n.t(s) : s);
  async function ageView() {
    view.innerHTML = `<div class="wrap mn-page"><div class="skel"></div></div>`;
    if (!online()) { view.innerHTML = `<div class="wrap mn-page"><h2 tabindex="-1">العمر والمحتوى الحساس</h2><div class="card muted">يتطلب هذا القسم اتصالاً بالخادم.</div></div>`; return; }
    const a = await loadAge(true); if (!a) return;
    const [bname, btone] = BANDS[a.band] || BANDS.unknown;
    const prot = a.protections ? `<div class="card"><b>${ic("shield", "sm")} حمايات حسابك</b><ul class="mn-list">
        <li>${ic("lock", "sm")}<div class="mn-grow">حسابك خاص: يوافق على متابعيك بنفسك</div></li>
        <li>${ic("mail", "sm")}<div class="mn-grow">الرسائل والإشارات من الأشخاص الذين تتابعهم فقط</div></li>
        <li>${ic("mapPin", "sm")}<div class="mn-grow">لا يُعرض موقعك على حسابك أو منشوراتك</div></li>
        <li>${ic("eyeOff", "sm")}<div class="mn-grow">المحتوى الحساس مخفي عنك</div></li>
        <li>${ic("users", "sm")}<div class="mn-grow">لا يُقترح حسابك على البالغين في البحث والاقتراحات</div></li></ul>
        ${a.adultOn ? `<p class="muted"><span>تُرفع هذه القيود تلقائياً في</span> <bdi>${h(fmtDay(a.adultOn))}</bdi><span>، وتبقى إعداداتك كما هي.</span></p>` : ""}</div>` : "";
    const prefs = [["blur", "تغطية", "يظهر مغطّى وتختار عرضه بلمسة"], ["show", "عرض", "يظهر مباشرة (للبالغين فقط)"], ["hide", "إخفاء", "لا يظهر في الخلاصة والبحث"]];
    view.innerHTML = `<div class="wrap mn-page">
      ${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "العمر والمحتوى الحساس", icon: "user", id: "mn-h" })}
      <div class="card"><div class="mn-row">${ic("cake")}<div class="mn-grow"><b>تاريخ الميلاد</b><div class="muted">لا يظهر لأحد ولا نطلب صورة هوية.</div></div><span class="mn-pill ${btone}">${h(bname)}</span></div>
        <label for="mn-bd" class="u-db u-mt10 muted">${a.declared ? "تصحيح تاريخ الميلاد" : "أدخل تاريخ ميلادك"}</label>
        <input type="date" id="mn-bd" max="${todayIso()}" min="1900-01-01" value="${h(a.birthDate || "")}" autocomplete="bday" aria-describedby="mn-bd-h">
        <div class="u-mt4 muted" id="mn-bd-h">${a.declared ? `يمكن التصحيح ${h(Number(a.changesLeft).toLocaleString(uiLang() === "ar" ? "ar-SA" : uiLang()))} مرات. رفع العمر من دون ١٨ إلى ١٨+ يحتاج مراجعة فريق السلامة.` : "يساعدنا على حماية الأصغر سناً وعرض ما يناسبك."}</div>
        ${a.pending ? `<div class="mn-banner" role="status">${ic("sparkle")}<div><span>طلب تعديل العمر قيد المراجعة منذ</span> <bdi>${h(fmt(a.pending.since))}</bdi>.${a.kyc.enabled ? ` <span>يمكنك تسريعه بإشارة توثيق Pi.</span>` : ""}</div></div>${a.kyc.enabled ? `<button type="button" class="btn ghost block" id="mn-kyc">${ic("verified", "sm")} التحقق عبر توثيق Pi (KYC)</button>` : ""}` : ""}
        <div class="mn-err" id="mn-bd-e" role="alert"></div><button type="button" class="btn block" id="mn-bd-go">حفظ</button></div>
      ${prot}
      <div class="card"><fieldset class="u-b0 u-p0 u-m0"><legend><b>المحتوى الحساس</b></legend>
        ${prefs.map(([k, n, d]) => { const dis = a.minor ? k !== "hide" : k === "show" && a.band !== "adult"; return `<label class="mn-opt"><input type="radio" name="mn-pref" value="${k}" ${a.contentPref === k ? "checked" : ""} ${dis ? "disabled" : ""}><span><b>${n}</b><div class="muted">${d}</div></span></label>`; }).join("")}
        ${a.minor ? `<p class="muted">مخفي دائماً لمن هم دون ١٨ سنة.</p>` : a.band !== "adult" ? `<p class="muted">أكّد عمرك لتفعيل «عرض».</p>` : ""}</fieldset></div>
      <a class="u-dflex u-ci u-tdn card mn-row" href="#/family">${ic("family")}<div class="mn-grow"><b>الإعدادات العائلية</b><div class="muted">ربط وليّ أمر بموافقة الطرفين</div></div><span class="fwd" aria-hidden="true">←</span></a>
      <a class="u-dflex u-ci u-tdn card mn-row" href="#/urgent">${ic("alert")}<div class="mn-grow"><b>بلاغ عاجل</b><div class="muted">خطر على طفل أو على حياة شخص</div></div><span class="fwd" aria-hidden="true">←</span></a>
    </div>`;
    document.getElementById("mn-h").focus();
    const err = document.getElementById("mn-bd-e");
    document.getElementById("mn-bd-go").onclick = async () => {
      const v = document.getElementById("mn-bd").value; if (!v) { err.textContent = "اختر تاريخ الميلاد"; return; }
      const age = C().ageOn(v);
      if (age !== null && age < a.minAge && !confirm(tr(`مجتمع بلس لمن هم ${a.minAge} سنة فأكثر. إن كان هذا عمرك فسيُعلَّق الحساب. هل أنت متأكد؟`))) return;
      try { const r = await api("POST", "/api/age", { birthDate: v }); if (r.blocked) { showGate(tr(`عذراً، يجب أن يكون عمرك ${r.minAge} سنة على الأقل.`)); return; } toast(r.review ? "أُرسل طلبك للمراجعة" : "تم الحفظ"); st.age = null; st.labels.clear(); if (typeof refresh === "function") refresh().catch(() => { }); ageView(); }
      catch (e) { err.textContent = e.message || "تعذّر الحفظ"; }
    };
    view.querySelectorAll("input[name=mn-pref]").forEach(i => i.onchange = async () => {
      try { st.age = await api("PUT", "/api/age/preferences", { sensitive: i.value }); st.ageAt = Date.now(); st.labels.clear(); if (typeof DB !== "undefined" && DB.settings) DB.settings.sensitive = { blur: "warn", show: "show", hide: "hide" }[i.value]; say("تم حفظ تفضيل المحتوى الحساس"); }
      catch (e) { toast(e.message); ageView(); }
    });
    document.getElementById("mn-kyc")?.addEventListener("click", async () => {
      try { if (typeof Pi === "undefined") throw new Error("افتح التطبيق من متصفح Pi"); const auth = await Pi.authenticate(["username"], () => { }); await api("POST", "/api/age/pi-kyc", { accessToken: auth.accessToken }); st.age = null; ageView(); }
      catch (e) { err.textContent = e.message || "تعذّر التحقق"; }
    });
  }

  /* ---------- #/family ---------- */
  const CTRL_VAL = { everyone: "الجميع", following: "من يتابعهم", nobody: "لا أحد" };
  const FAM_EV = { family_requested: "طلب ربط عائلي", family_linked: "تفعيل الربط العائلي", family_declined: "رفض الربط", family_ended: "إنهاء الربط", guardian_controls: "غيّر وليّ الأمر إعداداً", defaults_applied: "تطبيق إعدادات الحماية", age_declared: "تحديد العمر", age_corrected: "تصحيح العمر", age_raise_requested: "طلب رفع العمر", age_raised: "رفع العمر", became_adult: "بلوغ ١٨ سنة" };
  /* v2.67: the server logs "name: value، name: value" with raw values ("nobody"); show each part as its own
   * translatable node and the value in words, so the log reads right in Arabic and English */
  const ctlDetail = (d) => String(d).split("، ").map(p => { const i = p.lastIndexOf(": "); if (i < 0) return `<span>${h(p)}</span>`; const v = p.slice(i + 2); return `<span>${h(p.slice(0, i))}</span>: <span>${h(CTRL_VAL[v] || v)}</span>`; }).join(`<span>${h(tr("، "))}</span>`);
  /* protection log: the minor's own page and (v2.67) the guardian's overview, which the API already returns (guardian_* events only) */
  const logCard = (act) => act?.length ? `<div class="card"><b>سجل الحماية</b><ul class="mn-list">${act.map(e => `<li>${ic("shield", "sm")}<div class="mn-grow"><b>${h(FAM_EV[e.action] || e.action)}</b>${e.detail && e.action === "guardian_controls" ? `<div class="muted">${ctlDetail(e.detail)}</div>` : ""}<div class="muted">${h(fmt(e.at))}</div></div></li>`).join("")}</ul></div>` : "";
  const userChip = (u) => u ? `<div class="mn-row">${typeof av === "function" ? av(u) : ""}<div class="mn-grow"><b>${h(u.name)}</b><div class="u-te muted" dir="ltr">@${h(u.handle)}</div></div></div>` : "";
  function seeCard(v) {
    return `<ul class="mn-list"><li>${ic("lock", "sm")}<div>${v.privacy.private ? "الحساب خاص" : "الحساب عام"}</div></li><li>${ic("mail", "sm")}<div><span>الرسائل:</span> <span>${h(CTRL_VAL[v.privacy.dm] || v.privacy.dm)}</span></div></li><li>${ic("comment", "sm")}<div><span>التعليقات:</span> <span>${h(CTRL_VAL[v.privacy.comments] || v.privacy.comments)}</span></div></li><li>${ic("users", "sm")}<div><span>${h(v.followers)} متابِع</span> · <span>يتابع ${h(v.following)}</span> · <span>طلبات معلّقة ${h(v.pendingFollowRequests)}</span></div></li></ul><p class="muted">${h(v.note)}</p>`;
  }
  async function familyView() {
    if (!online()) { view.innerHTML = `<div class="wrap mn-page"><h2 tabindex="-1">الإعدادات العائلية</h2><div class="card muted">يتطلب هذا القسم اتصالاً بالخادم.</div></div>`; return; }
    view.innerHTML = `<div class="wrap mn-page"><div class="skel"></div></div>`;
    let f; try { f = await api("GET", "/api/family"); } catch (e) { view.innerHTML = `<div class="wrap mn-page"><div class="card">${h(e.message)}</div></div>`; return; }
    const pendingIn = f.links.filter(l => l.status === "pending" && !l.initiatedByMe), pendingOut = f.links.filter(l => l.status === "pending" && l.initiatedByMe), active = f.links.filter(l => l.status === "active");
    view.innerHTML = `<div class="wrap mn-page">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "الإعدادات العائلية", icon: "users", id: "mn-h" })}
      <div class="mn-banner">${ic("family")}<div>ربط بسيط وشفاف بين وليّ أمر بالغ وحساب دون ١٨ سنة. يتطلب موافقة الطرفين ومتابعة متبادلة، ويرى صاحب الحساب كل ما يراه وليّ أمره.</div></div>
      ${pendingIn.map(l => `<div class="card"><b>${l.role === "guardian" ? "طلب أن تكون وليّ أمره" : "طلب أن يكون وليّ أمرك"}</b>${userChip(l.other)}<div class="u-mt10 mn-row"><button type="button" class="btn" data-mn-acc="${h(l.id)}">موافقة</button><button type="button" class="btn ghost" data-mn-dec="${h(l.id)}">رفض</button></div></div>`).join("")}
      ${pendingOut.map(l => `<div class="card"><span class="mn-pill">بانتظار الموافقة</span>${userChip(l.other)}<button type="button" class="u-mt8 btn ghost" data-mn-end="${h(l.id)}">إلغاء الطلب</button></div>`).join("")}
      ${active.map(l => l.role === "guardian" ? `<div class="card" data-link="${h(l.id)}"><span class="mn-pill ok">أنت وليّ الأمر</span>${userChip(l.other)}
          ${Object.entries(C().GUARDIAN_CONTROLS).map(([k, d]) => `<label for="mn-c-${k}-${h(l.id)}" class="u-db u-mt10 muted">${h(d.name)}</label><select id="mn-c-${k}-${h(l.id)}" data-mn-ctl="${k}" data-link="${h(l.id)}"><option value="">الافتراضي المحمي</option>${d.values.map(v => `<option value="${v}" ${l.controls[k] === v ? "selected" : ""}>${CTRL_VAL[v]}</option>`).join("")}</select>`).join("")}
          <p class="muted">يمكنك تشديد هذه الإعدادات فقط، ويُبلَّغ صاحب الحساب بكل تغيير.</p>
          <label class="switch-row u-mt8" for="mn-wk-${h(l.id)}"><span><b>ملخص الإرشاد الأسبوعي</b><small class="u-db muted">إشعار مرة في الأسبوع: الجلسات المكتملة والقادمة وتقدّم الأهداف — دون الملاحظات الخاصة</small></span><input type="checkbox" class="switch" role="switch" id="mn-wk-${h(l.id)}" data-mn-wk="${h(l.id)}" ${l.mentorWeekly !== false ? "checked" : ""} aria-label="ملخص الإرشاد الأسبوعي"></label><button type="button" class="btn ghost block" data-mn-ov="${h(l.id)}">${ic("eye", "sm")} ما أراه عن الحساب</button><div id="mn-ov-${h(l.id)}"></div>
          <button type="button" class="u-mt8 u-c-dg btn ghost block" data-mn-end="${h(l.id)}">إنهاء الربط</button></div>`
        : `<div class="card"><span class="mn-pill ok">وليّ أمرك</span>${userChip(l.other)}${Object.keys(l.controls).length ? `<p class="muted"><span>إعدادات اختارها:</span> ${Object.entries(l.controls).map(([k, v]) => `<span>${h(C().GUARDIAN_CONTROLS[k].name)}</span>: <span>${h(CTRL_VAL[v])}</span>`).join(tr("، "))}</p>` : ""}<button type="button" class="u-c-dg btn ghost block" data-mn-end="${h(l.id)}">إنهاء الربط</button></div>`).join("")}
      ${f.whatGuardiansSee ? `<div class="card"><b>${ic("eye", "sm")} ما يراه وليّ أمرك</b>${seeCard(f.whatGuardiansSee)}</div>` : ""}
      <div class="card"><b>إضافة ربط عائلي</b><label for="mn-fh" class="u-db u-mt8 muted">اسم المستخدم</label><input id="mn-fh" dir="ltr" placeholder="@handle" autocomplete="off">
        <fieldset class="u-b0 u-p0 u-m0 u-mt8"><legend class="muted">صفتك</legend><label class="mn-opt"><input type="radio" name="mn-as" value="guardian" ${f.me.minor ? "disabled" : "checked"}><span>أنا وليّ أمره (يجب أن يكون دون ١٨ سنة)</span></label><label class="mn-opt"><input type="radio" name="mn-as" value="minor" ${f.me.minor ? "checked" : "disabled"}><span>هذا وليّ أمري (بالغ)</span></label></fieldset>
        <div class="mn-err" id="mn-fe" role="alert"></div><button type="button" class="btn block" id="mn-fgo" ${f.me.band === "unknown" ? "disabled" : ""}>إرسال طلب الربط</button>${f.me.band === "unknown" ? `<p class="muted">حدّد عمرك أولاً من <a href="#/age">العمر والمحتوى الحساس</a>.</p>` : ""}</div>
      ${logCard(f.activity)}
    </div>`;
    document.getElementById("mn-h").focus();
    const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); familyView(); } catch (e) { toast(e.message || "تعذّر التنفيذ"); } };
    view.querySelectorAll("[data-mn-acc]").forEach(b => b.onclick = () => act(() => api("POST", `/api/family/links/${b.dataset.mnAcc}/accept`), "تم تفعيل الربط"));
    view.querySelectorAll("[data-mn-dec]").forEach(b => b.onclick = () => act(() => api("POST", `/api/family/links/${b.dataset.mnDec}/decline`), "تم الرفض"));
    view.querySelectorAll("[data-mn-end]").forEach(b => b.onclick = () => confirm(tr("إنهاء الربط العائلي؟ سيُبلَّغ الطرف الآخر.")) && act(() => api("DELETE", `/api/family/links/${b.dataset.mnEnd}`), "انتهى الربط"));
    view.querySelectorAll("[data-mn-ctl]").forEach(s => s.onchange = () => s.value && act(() => api("PUT", `/api/family/links/${s.dataset.link}/controls`, { [s.dataset.mnCtl]: s.value }), "تم التحديث وأُبلغ صاحب الحساب"));
    view.querySelectorAll("[data-mn-wk]").forEach(c => c.onchange = () => act(() => api("PUT", `/api/family/links/${c.dataset.mnWk}/weekly`, { on: c.checked }), c.checked ? "سيصلك ملخص الإرشاد كل أسبوع" : "أُوقف ملخص الإرشاد الأسبوعي"));
    view.querySelectorAll("[data-mn-ov]").forEach(b => b.onclick = async () => { try { const r = await api("GET", `/api/family/links/${b.dataset.mnOv}/overview`); document.getElementById("mn-ov-" + b.dataset.mnOv).innerHTML = seeCard(r.view) + logCard(r.activity); } catch (e) { toast(e.message); } });
    document.getElementById("mn-fgo").onclick = () => { const e = document.getElementById("mn-fe"); const handle = document.getElementById("mn-fh").value.trim(); if (!handle) { e.textContent = "اكتب اسم المستخدم"; return; } api("POST", "/api/family/links", { handle, as: view.querySelector("input[name=mn-as]:checked")?.value }).then(() => { toast("أُرسل الطلب"); familyView(); }, (x) => { e.textContent = x.message; }); };
  }

  /* ---------- #/urgent ---------- */
  function urgentView() { view.innerHTML = `<div class="wrap mn-page"><h2 tabindex="-1" id="mn-h">بلاغ عاجل</h2><div class="card"><p>للحالات الخطيرة: خطر على طفل، إيذاء النفس، تهديد بالعنف، ابتزاز أو استغلال.</p><button type="button" class="btn block" id="mn-u">${ic("alert", "sm")} بدء البلاغ</button></div></div>`; document.getElementById("mn-h").focus(); document.getElementById("mn-u").onclick = () => urgentSheet(null, null); }

  /* ---------- #/safety-cases (staff) ---------- */
  const SEVN = { critical: ["حرجة", "crit"], high: ["عالية", "warn"], normal: ["عادية", ""] };
  const STATN = { open: "مفتوحة", triage: "قيد الفرز", escalated: "مصعّدة", closed: "مغلقة" };
  const OUTN = { actioned: "اتُّخذ إجراء", no_violation: "لا مخالفة", referred: "أُحيلت لجهة رسمية", duplicate: "مكررة" };
  const BODYN = { ncmec: "NCMEC (CyberTipline)", national_hotline: "خط الإبلاغ الوطني", police: "جهة إنفاذ القانون" };
  async function casesView(caseId) {
    if (!online()) { view.innerHTML = `<div class="wrap mn-page"><div class="card muted">يتطلب اتصالاً بالخادم.</div></div>`; return; }
    if (caseId) return caseView(caseId);
    view.innerHTML = `<div class="wrap mn-page"><div class="skel"></div></div>`;
    const tab = (location.hash.split("?")[1] || "").match(/s=(\w+)/)?.[1] || "active";
    let r; try { r = await api("GET", "/api/safety/cases?status=" + tab); } catch (e) { view.innerHTML = `<div class="wrap mn-page"><h2 tabindex="-1">طابور السلامة</h2><div class="card">${h(e.status === 404 ? "غير متاح" : e.message)}</div></div>`; return; }
    view.innerHTML = `<div class="wrap mn-page"><h2 tabindex="-1" id="mn-h">${ic("queue", "sm")} طابور السلامة</h2>
      <div class="u-fww u-g6 u-mb10 mn-row">${Object.entries(SEVN).map(([k, [n, t]]) => `<span class="mn-pill ${t}">${n}: ${h(r.counts[k] || 0)}</span>`).join("")}</div>
      <div class="u-g6 u-mb10 row" role="tablist" aria-label="الحالات">${[["active", "النشطة"], ["closed", "المغلقة"], ["all", "الكل"]].map(([k, n]) => `<a role="tab" class="tab" aria-selected="${tab === k}" href="#/safety-cases?s=${k}" ${tab === k ? 'style="color:var(--accent);border-color:var(--accent)"' : ""}>${n}</a>`).join("")}</div>
      ${r.cases.length ? r.cases.map(c => `<a class="card mn-case ${SEVN[c.severity][1]}" href="#/safety-cases/${h(c.id)}"><div class="mn-row"><span class="mn-pill ${SEVN[c.severity][1]} mn-sev">${SEVN[c.severity][0]}</span><b class="mn-grow">${h(c.categoryName)}</b><span class="muted">${h(STATN[c.status] || c.status)}</span></div>
        <div class="u-mt6 muted">${h((c.summary || "").slice(0, 120))}</div><div class="muted">${h(fmt(c.createdAt))}${c.overdue ? ` · <b class="u-c-dg">تجاوزت مهلة الاستجابة</b>` : ""}${c.hold ? " · الدليل محجوز" : ""}${c.minorInvolved ? " · يشمل قاصراً" : ""}</div></a>`).join("") : `<div class="card muted">لا توجد حالات.</div>`}
      ${r.me.role === "admin" || r.me.role === "lead" ? `<a class="u-dflex u-ci u-tdn card mn-row" href="#/safety-cases/age-reviews">${ic("cake")}<div class="mn-grow"><b>مراجعات العمر</b><div class="muted">طلبات رفع العمر من دون ١٨ إلى ١٨+</div></div></a>` : ""}</div>`;
    document.getElementById("mn-h").focus();
  }
  async function reviewsView() {
    let r; try { r = await api("GET", "/api/safety/age-reviews"); } catch (e) { view.innerHTML = `<div class="wrap mn-page"><div class="card">${h(e.message)}</div></div>`; return; }
    view.innerHTML = `<div class="wrap mn-page"><h2 tabindex="-1" id="mn-h">مراجعات العمر</h2>${r.reviews.length ? r.reviews.map(x => `<div class="card"><b>${h(x.name)}</b> <span class="muted" dir="ltr">@${h(x.handle)}</span><div class="muted">الحالي ${h(x.current)} ← المطلوب ${h(x.requested)} · Pi KYC: ${h(x.kyc || "—")}</div><div class="u-mt8 mn-row"><button type="button" class="btn" data-mn-rv="${h(x.user)}" data-a="approve">قبول</button><button type="button" class="btn ghost" data-mn-rv="${h(x.user)}" data-a="reject">رفض</button></div></div>`).join("") : `<div class="card muted">لا توجد طلبات.</div>`}</div>`;
    document.getElementById("mn-h").focus();
    view.querySelectorAll("[data-mn-rv]").forEach(b => b.onclick = async () => { try { await api("POST", "/api/safety/age-reviews/" + b.dataset.mnRv, { action: b.dataset.a }); toast("تم"); reviewsView(); } catch (e) { toast(e.message); } });
  }
  function download(name, obj) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  async function caseView(cid) {
    if (cid === "age-reviews") return reviewsView();
    view.innerHTML = `<div class="wrap mn-page"><div class="skel"></div></div>`;
    let d; try { d = await api("GET", "/api/safety/cases/" + encodeURIComponent(cid)); } catch (e) { view.innerHTML = `<div class="wrap mn-page"><div class="card">${h(e.message)}</div></div>`; return; }
    const c = d.case, lead = !!d.access;
    view.innerHTML = `<div class="wrap mn-page"><a href="#/safety-cases" class="muted">‹ الطابور</a><h2 tabindex="-1" id="mn-h">${h(c.categoryName)} <span class="mn-pill ${SEVN[c.severity][1]}">${SEVN[c.severity][0]}</span></h2>
      <div class="card"><div class="muted">${h(STATN[c.status] || c.status)}${c.outcome ? " · " + h(OUTN[c.outcome] || c.outcome) : ""} · فُتحت ${h(fmt(c.createdAt))} · المهلة ${h(fmt(c.slaDueAt))}</div><p>${h(c.summary || "")}</p>
        ${d.subject ? `<div class="muted">الحساب المعني: <bdi dir="ltr">@${h(d.subject.handle)}</bdi>${d.subject.minor ? " · قاصر" : ""} · ${h(d.subject.status)}</div>` : ""}
        <div class="u-fww u-g6 u-mt8 mn-row">${c.hold ? `<span class="mn-pill crit">المحتوى محجوز</span>` : ""}${c.minorInvolved ? `<span class="mn-pill warn">يشمل قاصراً</span>` : ""}<span class="mn-pill ${d.chain.ok ? "ok" : "crit"}">${d.chain.ok ? `سلسلة الأدلة سليمة (${h(d.chain.checked)})` : `سلسلة الأدلة مكسورة عند ${h(d.chain.brokenAt)}`}</span></div></div>
      <div class="card"><b>إجراءات</b><div class="u-fww u-g6 u-mt8 mn-row">
        <button type="button" class="btn ghost" data-mn-a="assign">إسناد لي</button><button type="button" class="btn ghost" data-mn-a="triage">فرز</button><button type="button" class="btn ghost" data-mn-a="escalate">تصعيد</button><button type="button" class="btn ghost" data-mn-a="preserve">حفظ لقطة جديدة</button>
        ${c.hold ? (lead ? `<button type="button" class="btn ghost" data-mn-a="release">فك الحجز</button>` : "") : `<button type="button" class="btn ghost" data-mn-a="hold">حجز المحتوى</button>`}${c.status === "closed" ? `<button type="button" class="btn ghost" data-mn-a="reopen">إعادة فتح</button>` : ""}</div>
        <label for="mn-note" class="u-db u-mt10 muted">ملاحظة (تُحفظ في سلسلة الأدلة)</label><textarea id="mn-note" rows="2" maxlength="2000"></textarea><button type="button" class="btn ghost block" data-mn-a="note">إضافة ملاحظة</button>
        ${c.status !== "closed" ? `<label for="mn-out" class="u-db u-mt10 muted">إغلاق الحالة</label><select id="mn-out">${Object.entries(OUTN).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select><button type="button" class="u-mt6 btn block" data-mn-a="close">إغلاق</button>` : ""}
        <div class="mn-err" id="mn-ae" role="alert"></div></div>
      <div class="card"><b>الأدلة المحفوظة (${h(d.evidence.length)})</b>${d.evidence.map(e => `<details class="mn-ev"><summary>#${h(e.seq)} · ${h(e.kind)} · ${h(fmt(e.capturedAt))}</summary><div class="u-t-xs u-wba muted" dir="ltr">sha256 ${h(e.sha256)}</div><pre>${h(JSON.stringify(e.payload, null, 2))}</pre></details>`).join("")}</div>
      ${lead ? `<div class="card"><b>${ic("flag", "sm")} الإبلاغ للجهات الرسمية</b><div class="u-mt8 mn-banner">${ic("shield")}<div>لا يُرسل شيء تلقائياً. يُصدَّر سجل منظّم (JSON) ليسلّمه فريقك يدوياً ${d.channelConfigured ? `عبر: <b>${h(d.channel)}</b>` : "— لم يحدد المشغّل قناة رسمية بعد (MINORS_AUTHORITY_CHANNEL)"}.</div></div>
        ${d.authorityReports.map(a => `<div class="u-py8 u-bb mn-row"><div class="mn-grow"><b>${h(BODYN[a.body] || a.body)}</b> <span class="muted">${h(a.status)}${a.external_ref ? " · " + h(a.external_ref) : ""}</span></div><button type="button" class="btn ghost" data-mn-x="${h(a.id)}">تصدير</button><button type="button" class="btn ghost" data-mn-sub="${h(a.id)}">سُلّم</button></div>`).join("")}
        <label for="mn-body" class="u-db u-mt10 muted">الجهة</label><select id="mn-body">${d.bodies.map(b => `<option value="${h(b)}">${h(BODYN[b] || b)}</option>`).join("")}</select>
        <label for="mn-jur" class="u-db u-mt8 muted">الاختصاص (اختياري)</label><input id="mn-jur" maxlength="40" dir="ltr" placeholder="SA">
        <label for="mn-an" class="u-db u-mt8 muted">ملاحظات</label><textarea id="mn-an" rows="2" maxlength="2000"></textarea>
        <button type="button" class="u-mt8 btn block" id="mn-ar">إعداد سجل الإبلاغ</button></div>
        <div class="card"><b>سجل الوصول</b><ul class="mn-list">${d.access.map(x => `<li><div class="mn-grow"><span dir="ltr">${h(x.user)}</span> · ${h(x.action)}<div class="muted">${h(fmt(x.at))}</div></div></li>`).join("")}</ul></div>` : ""}
    </div>`;
    document.getElementById("mn-h").focus();
    const ae = document.getElementById("mn-ae");
    view.querySelectorAll("[data-mn-a]").forEach(b => b.onclick = async () => {
      const a = b.dataset.mnA, body = { action: a };
      if (a === "note") { body.note = document.getElementById("mn-note").value.trim(); if (!body.note) { ae.textContent = "اكتب الملاحظة"; return; } }
      if (a === "close") body.outcome = document.getElementById("mn-out").value;
      try { await api("POST", "/api/safety/cases/" + encodeURIComponent(cid), body); toast("تم"); caseView(cid); } catch (e) { ae.textContent = e.message; }
    });
    document.getElementById("mn-ar")?.addEventListener("click", async () => { try { await api("POST", `/api/safety/cases/${encodeURIComponent(cid)}/authority-reports`, { body: document.getElementById("mn-body").value, jurisdiction: document.getElementById("mn-jur").value.trim(), notes: document.getElementById("mn-an").value.trim() }); toast("أُعدّ السجل"); caseView(cid); } catch (e) { toast(e.message); } });
    view.querySelectorAll("[data-mn-x]").forEach(b => b.onclick = async () => { try { const x = await api("GET", `/api/safety/authority-reports/${b.dataset.mnX}/export`); download(x.filename, x.payload); toast(x.verified ? "صُدّر الملف (البصمة مطابقة)" : "تحذير: البصمة غير مطابقة"); } catch (e) { toast(e.message); } });
    view.querySelectorAll("[data-mn-sub]").forEach(b => b.onclick = async () => { const ref = prompt("رقم مرجع الجهة (إن وُجد)") ?? null; if (ref === null) return; try { await api("POST", `/api/safety/authority-reports/${b.dataset.mnSub}/submitted`, { externalRef: ref }); toast("سُجّل التسليم"); caseView(cid); } catch (e) { toast(e.message); } });
  }

  /* ---------- wiring: routes, settings entries ---------- */
  MPRoutes.extend((a, b) => ({ age: () => ageView(), family: () => familyView(), urgent: () => urgentView(), "safety-cases": () => casesView(a) }));
  if (typeof Views !== "undefined" && Views.settings) {
    MPSettings.add(function () {
      const first = view.querySelector(".wrap .card"); if (!first || view.querySelector("#mn-set")) return;
      const a = st.age;
      first.insertAdjacentHTML("beforebegin", `<a class="u-dflex u-aic u-g12 u-ci u-tdn card row" id="mn-set" href="#/age">${ic("shield")}<div class="grow"><b>العمر والمحتوى الحساس</b><div class="muted">${a && !a.declared ? "أكّد تاريخ ميلادك لحماية أفضل" : "التغطية، الإخفاء، حمايات من هم دون ١٨"}</div></div><span class="fwd" aria-hidden="true">←</span></a>
        <a class="u-dflex u-aic u-g12 u-ci u-tdn card row" id="mn-fam" href="#/family">${ic("family")}<div class="grow"><b>الإعدادات العائلية</b><div class="muted">ربط وليّ أمر بموافقة الطرفين</div></div><span class="fwd" aria-hidden="true">←</span></a>
        ${a?.staff ? `<a class="u-dflex u-aic u-g12 u-ci u-tdn card row" id="mn-q" href="#/safety-cases">${ic("queue")}<div class="grow"><b>طابور السلامة</b><div class="muted">الحالات الخطيرة والإبلاغ الرسمي</div></div><span class="fwd" aria-hidden="true">←</span></a>` : ""}`);
      if (!a) loadAge().then(x => { if (x && /^#\/settings/.test(location.hash) && (x.staff || !x.declared)) { view.querySelector("#mn-set")?.remove(); view.querySelector("#mn-fam")?.remove(); Views.settings(); } });
    });
  }
  const ageBoot = () => loadAge().then(() => { if (/^#\/(age|family|urgent|safety-cases|settings)/.test(location.hash) || document.querySelector(".card [data-more]")) route(); });
  if (window.MPSession) MPSession.whenIn(ageBoot); else ageBoot(); // v2.51: after sign-in, not for guests
  window.MPMinorsUI = { age: ageView, family: familyView, cases: casesView, urgent: urgentSheet, labels: labelSheet, coverState, reveal: (id) => st.revealed.add(id), version: "2.8.0" };
})();
