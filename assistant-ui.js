/* AI assistant «المساعد الذكي» UI (phase 42). Lazy chunk `assistant` (loaded by the `ai` chunk). Contract: docs/integration/p42.md.
 * • «✨ المساعد» next to the post composer (#txt) and the comment box (#cin). Non-subscriber → the existing «مجتمع+ ذكاء» upsell
 *   (MPAI.upsell) + «المساعد الذكي غير مفعّل بعد» when no provider. Subscriber → sheet: rephrase / improve / shorter / polite,
 *   polite reply suggestions (comment box), ask the community (cited answer), semantic search, and «ما الذي يراه المساعد؟».
 * • Suggestions are never applied silently: the user taps «استخدام». No inline handlers (CSP); CSS lives in this chunk. */
(function AssistantUI() {
  const api = (m, p, b) => Remote.api(m, p, b);
  const on = () => typeof Remote !== "undefined" && Remote.on && typeof DB !== "undefined" && DB.me;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const T = (s) => (window.MPI18n ? window.MPI18n.t(s) : s);
  const OFF = "المساعد الذكي غير مفعّل بعد";
  const MODES = [["rephrase", "إعادة صياغة"], ["improve", "تحسين"], ["shorter", "أقصر"], ["polite", "أكثر تهذيباً"]];
  const errText = (e) => ({ not_configured: OFF, usage_limit: "بلغت حدّ المساعد الشهري", budget_exhausted: "توقف المساعد مؤقتاً لبلوغ ميزانيته الشهرية", private_content: "لا يُرسل المساعد المحتوى غير العام", rate_limited: "تمهّل قليلاً" }[e?.code] || e?.message || "تعذّر الوصول إلى المساعد");
  let me = null, cfg = null, meP = null;
  const load = (force) => { if (!on()) return Promise.resolve(null); if (force || !meP) meP = Promise.all([api("GET", "/api/assistant/me"), api("GET", "/api/assistant/config")]).then(([m, c]) => { me = m; cfg = c; return m; }).catch(() => (meP = null)); return meP; };

  const st = document.createElement("style");
  st.textContent = `.mp-asb{border:1px solid var(--line);background:var(--card,transparent);color:var(--accent);font:inherit;font-size:var(--fs-sm);border-radius:999px;padding:4px 10px;cursor:pointer;margin-block:6px;flex:none}
.mp-as-acts{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.mp-as-acts .btn{font-size:var(--fs-sm);padding:6px 10px}.mp-as-out{border-inline-start:3px solid var(--accent);padding-inline-start:8px;white-space:pre-wrap;margin:8px 0}
.mp-as-lbl{font-size:var(--fs-xs);color:var(--muted)}.mp-as-sug{display:block;width:100%;text-align:start;margin:6px 0}.mp-as-src{display:block;font-size:var(--fs-sm);color:inherit;margin:4px 0}.mp-as-cite{font-size:11px;color:var(--accent);margin-inline-start:4px}
.mp-as-why li{margin:4px 0}.mp-as-row{display:flex;gap:6px;margin-top:8px}.mp-as-row input{flex:1}`;
  document.head.appendChild(st);

  /* ---------- the button inside the composer ---------- */
  function attach(root = document) {
    root.querySelectorAll?.("textarea[data-mp-assist]:not([data-mpas]), input#cin:not([data-mpas])").forEach((f) => {
      f.dataset.mpas = "1";
      const b = document.createElement("button"); b.type = "button"; b.className = "mp-asb"; b.innerHTML = window.UI ? UI.icon("sparkle", "xs") : ""; b.append(" " + T("المساعد").replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "")); // v2.32: sprite icon, not an emoji b.setAttribute("aria-label", T("المساعد الذكي"));
      b.addEventListener("click", () => open(f));
      f.after(b);
    });
  }
  const obs = new MutationObserver(() => attach());
  obs.observe(document.body, { childList: true, subtree: true });
  attach();

  async function open(field) {
    if (!on()) return toast(T("سجّل الدخول لاستخدام المساعد"));
    await load(true);
    if (!me?.entitled) {
      if (!window.MPAI) await window.MPChunks?.load("ai").catch(() => { });
      // v2.51: /api/assistant/* just seeded `assistant` into the «مجتمع+ ذكاء» plan — refresh the AI chunk's cached plan so the upsell lists it
      if (window.MPAI) { await window.MPAI.refresh?.(); await window.MPAI.upsell(); const s = document.getElementById("sheet"); if (s && !me?.available && !s.querySelector("#mp-as-off")) s.querySelector("#mp-sub-n")?.insertAdjacentHTML("beforebegin", `<p class="muted" id="mp-as-off" role="status">${esc(T(OFF))}</p>`); }
      else toast(T(OFF));
      return;
    }
    const comment = field.id === "cin", postId = (/^#\/post\/([^/?]+)/.exec(location.hash) || [])[1];
    const s = sheet(`<div id="mp-as-sheet"><h3><svg class="ic hi" aria-hidden="true"><use href="#i-sparkle"/></svg>${esc(T("المساعد الذكي"))}</h3>
      ${me.available ? "" : `<p class="muted" role="status" id="mp-as-off">${esc(T(OFF))}</p>`}
      <div class="mp-as-acts">${MODES.map(([k, l]) => `<button class="btn ghost" type="button" data-mode="${k}">${esc(T(l))}</button>`).join("")}${comment && postId ? `<button class="btn ghost" type="button" id="mp-as-rep">${esc(T("اقترح ردوداً مهذبة"))}</button>` : ""}</div>
      <div class="mp-as-row"><input id="mp-as-q" maxlength="500" placeholder="${esc(T("اسأل المجتمع أو ابحث بالمعنى…"))}" dir="auto"><button class="btn" type="button" id="mp-as-ask">${esc(T("اسأل"))}</button><button class="btn ghost" type="button" id="mp-as-find">${esc(T("بحث"))}</button></div>
      <div id="mp-as-res" role="status" aria-live="polite"></div>
      <p class="mp-as-lbl"><a href="#" id="mp-as-why">${esc(T("ما الذي يراه المساعد؟"))}</a>${me.usage ? ` · ${esc(T("استخدامك هذا الشهر"))} ${me.usage.pct}%` : ""}</p></div>`);
    const res = s.querySelector("#mp-as-res");
    const busy = (b, f) => async () => { if (b.disabled) return; b.disabled = true; res.textContent = T("جارٍ التفكير…"); try { await f(); } catch (e) { res.textContent = T(errText(e)); if (e.code === "subscription_required") { me = null; meP = null; } } finally { b.disabled = false; } };
    const use = (text) => { field.value = text; field.dispatchEvent(new Event("input", { bubbles: true })); closeSheet(); field.focus(); toast(T("أُدرج المقترح، راجعه قبل النشر")); };
    s.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", busy(b, async () => {
      if (!field.value.trim()) { res.textContent = T("اكتب نصاً أولاً"); return; }
      const r = await api("POST", "/api/assistant/write", { text: field.value, mode: b.dataset.mode });
      res.innerHTML = `<div class="mp-as-out" dir="auto"></div><div class="mp-as-lbl">${esc(T(r.label))}</div><div class="mp-as-row"><button class="btn" type="button" id="mp-as-use">${esc(T("استخدام"))}</button></div>`;
      res.querySelector(".mp-as-out").textContent = r.text;
      res.querySelector("#mp-as-use").addEventListener("click", () => use(r.text));
    })));
    const rep = s.querySelector("#mp-as-rep");
    rep?.addEventListener("click", busy(rep, async () => {
      const r = await api("POST", "/api/assistant/replies", { kind: "post", id: postId, draft: field.value || undefined });
      res.innerHTML = `<div class="mp-as-lbl">${esc(T(r.label))}</div>` + r.suggestions.map((_, i) => `<button class="btn ghost mp-as-sug" type="button" data-i="${i}" dir="auto"></button>`).join("");
      res.querySelectorAll(".mp-as-sug").forEach((b) => { b.textContent = r.suggestions[+b.dataset.i]; b.addEventListener("click", () => use(r.suggestions[+b.dataset.i])); });
    }));
    const q = s.querySelector("#mp-as-q"), ask = s.querySelector("#mp-as-ask"), find = s.querySelector("#mp-as-find");
    ask.addEventListener("click", busy(ask, async () => {
      const r = await api("POST", "/api/assistant/ask", { q: q.value });
      if (!r.points.length) { res.textContent = T(r.note || "لا توجد إجابة"); return; }
      res.innerHTML = r.points.map((p) => `<div class="mp-as-out" dir="auto"><span></span>${p.cites.map((c) => `<span class="mp-as-cite">[${esc(c)}]</span>`).join("")}</div>`).join("") +
        `<div class="mp-as-lbl">${esc(T(r.grounded === "extractive" ? "مقتطفات حرفية من محتوى المجتمع" : r.label))} · ${esc(T("المصادر"))}</div>` +
        r.sources.filter((x) => x.cited).map((x) => `<a class="mp-as-src" href="${esc(x.href)}" dir="auto"><b>[${esc(x.id)}]</b> <span></span></a>`).join("");
      res.querySelectorAll(".mp-as-out > span:first-child").forEach((el, i) => { el.textContent = r.points[i].text; });
      res.querySelectorAll(".mp-as-src span").forEach((el, i) => { el.textContent = r.sources.filter((x) => x.cited)[i].snippet; });
      res.querySelectorAll(".mp-as-src").forEach((a) => a.addEventListener("click", closeSheet));
    }));
    find.addEventListener("click", busy(find, async () => {
      const r = await api("POST", "/api/assistant/search", { q: q.value });
      if (!r.items.length) { res.textContent = T("لا نتائج"); return; }
      res.innerHTML = r.items.map(() => `<a class="mp-as-src" dir="auto"></a>`).join("");
      res.querySelectorAll(".mp-as-src").forEach((a, i) => { a.href = r.items[i].href; a.textContent = r.items[i].snippet; a.addEventListener("click", closeSheet); });
    }));
    s.querySelector("#mp-as-why").addEventListener("click", (e) => { e.preventDefault(); why(); });
    window.MPI18n?.apply(s);
  }

  /* ---------- transparency sheet ---------- */
  async function why() {
    if (!cfg) await load(true);
    const t = cfg?.transparency; if (!t) return toast(T(OFF));
    const s = sheet(`<div id="mp-as-why-s" class="mp-as-why"><h3>${esc(t.title)}</h3>
      <ul>${t.actions.map((a) => `<li><b>${esc(a.label)}:</b> ${esc(a.sends.join("، "))}</li>`).join("")}</ul>
      <h4>${esc(T("لا يرى أبداً"))}</h4><ul>${t.never.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="muted">${esc(t.storage)}</p><p class="muted">${esc(t.control)}</p>
      <p class="muted">${esc(cfg.available ? T("المزود") + ": " + cfg.provider : T(OFF))}</p><button class="btn ghost" type="button" id="mp-as-ok">${esc(T("حسناً"))}</button></div>`);
    s.querySelector("#mp-as-ok").addEventListener("click", closeSheet);
    window.MPI18n?.apply(s);
  }

  window.MPAssistant = { open, why, refresh: () => load(true), attach, version: "2.24.0" };
  load();
})();
