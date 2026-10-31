/* =====================================================================
 * مجتمع بلس — automatic moderation UI (Track 7, phase 31)
 * • «هل أنت متأكد؟»: before a comment/reply or post is sent, its text is checked by POST /api/automod/check
 *   (classified in memory, never stored). A hostile reply opens a calm dialog: «تعديل الرد» (default) or
 *   «النشر على أي حال». Never blocks posting: a slow or failed check lets the post through.
 * • Gentle explanations: posts held for review show their author a soft banner on the card; realtime
 *   "automod" events become a toast; MPAutomod.openHeld() lists everything waiting with what to do next.
 * • Unsafe links in private messages ("automod_flag"): the recipient gets a warning, and tapping a flagged
 *   link anywhere opens an interstitial before leaving the app.
 * Public API: window.MPAutomod = { check, confirmBeforePost, openHeld, explain, heldBanner, flagsFor, lib }.
 * ===================================================================== */
(function AutomodLayer() {
  if (window.MPAutomod) return; // already loaded (bundle + test injection)
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  async function api(method, path, body) {
    if (typeof Remote !== "undefined" && Remote.api && Remote.__amOrig) return Remote.__amOrig(method, path, body);
    if (typeof Remote !== "undefined" && Remote.api) return Remote.api(method, path, body);
    const r = await fetch(path, { method, credentials: "same-origin", headers: { "X-Requested-With": "mujtama", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || "HTTP " + r.status); /** @type {any} */ (e).status = r.status; throw e; } return j;
  }
  const say = (m) => (typeof toast === "function" ? toast(m) : console.info(m));

  /* ---------- pure helpers (unit-tested) ---------- */
  const EXPLAIN = {
    abuse: "قد تُفهم بعض الكلمات كإساءة لشخص ما.",
    threat: "يبدو أن النص يحمل تهديداً، وسلامة الجميع أولوية لدينا.",
    hate: "قد يسيء النص إلى مجموعة من الناس بسبب هويتهم.",
    fraud: "يشبه النص أساليب الاحتيال المعروفة (وعود أرباح أو طلب بيانات سرية).",
    link: "يحتوي رابطاً قد يكون غير آمن.",
    image: "قد تحتوي الصورة على محتوى حساس.",
    account: "الحسابات الجديدة تمر بمراجعة أهدأ في أيامها الأولى."
  };
  const STATE = {
    delayed: { title: "سيُنشر بعد قليل", body: "أخّرنا نشره قليلاً للتأكد من أنه مناسب. سيظهر تلقائياً إن لم تصل بلاغات." },
    held: { title: "بانتظار مراجعة سريعة", body: "منشورك ظاهر لك وحدك الآن. يمكنك تعديله ليُعاد فحصه فوراً، أو انتظار مراجعة الفريق." },
    escalated: { title: "قيد المراجعة من الفريق", body: "يراجعه أحد أعضاء الفريق. لن يُحذف شيء دون مراجعة بشرية." },
    removed: { title: "أُزيل بعد المراجعة", body: "إن رأيت أن القرار خاطئ، يمكنك تقديم استئناف من «قراراتي»." },
    released: { title: "نُشر ✓", body: "انتهت المراجعة وأصبح منشورك ظاهراً للجميع." }
  };
  /** @param {string[]} reasons */
  const explain = (reasons = []) => [...new Set(reasons)].map(r => EXPLAIN[r]).filter(Boolean);
  /** which outgoing requests deserve a check, and the text to check */
  function target(method, path, body) {
    if (method !== "POST" || !body || typeof body !== "object") return null;
    if (path === "/api/comments" && typeof body.text === "string") return { kind: body.parent ? "reply" : "comment", text: body.text };
    if (path === "/api/posts" && !body.repostOf) { const text = [body.title, body.text].filter(x => typeof x === "string").join(" ").trim(); return text ? { kind: body.quoteOf ? "quote" : "post", text } : null; }
    return null;
  }
  const worthChecking = (text) => typeof text === "string" && text.replace(/\s+/g, "").length >= 2 && text.length <= 5000;
  const lib = { EXPLAIN, STATE, explain, target, worthChecking };

  /* ---------- styles (theme variables, AA contrast in light & dark) ---------- */
  if (typeof document !== "undefined" && !document.getElementById("am-style")) {
    const st = document.createElement("style"); st.id = "am-style";
    st.textContent = `
.am-ov{position:fixed;inset:0;z-index:1200;background:rgba(10,8,20,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px}
@media(min-width:700px){.am-ov{align-items:center}}
.am-dlg{background:var(--card,var(--white));color:var(--text,#15121f);border-radius:var(--r-lg,24px);box-shadow:var(--sh-3);max-width:440px;width:100%;padding:22px 20px 18px;text-align:start}
.am-dlg h2{font-size:1.1rem;margin:0 0 8px;display:flex;gap:8px;align-items:center}
.am-dlg p{margin:0 0 10px;color:var(--text-2,#3d3850);line-height:1.7}
.am-dlg ul{margin:0 0 12px;padding:0 18px 0 0;color:var(--text-2,#3d3850);line-height:1.7}
.am-dlg .am-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.am-dlg .am-row .btn{flex:1;min-height:44px}
.am-dlg .btn:focus-visible,.am-banner button:focus-visible{outline:3px solid var(--accent,#6d3cf4);outline-offset:2px}
.am-banner{display:flex;gap:10px;align-items:flex-start;background:color-mix(in srgb,var(--warn,#e8932a) 14%,var(--card,var(--white)));border:1px solid color-mix(in srgb,var(--warn,#e8932a) 45%,transparent);color:var(--text,#15121f);border-radius:var(--r-sm,12px);padding:10px 12px;margin:0 0 10px;font-size:.92rem;line-height:1.6}
.am-banner b{display:block}
.am-banner button{background:none;border:0;color:var(--accent-ink,#4f22d1);font-weight:700;padding:4px 0;cursor:pointer;text-decoration:underline}
.am-item{border:1px solid var(--line,#e9e6f2);border-radius:var(--r-sm,12px);padding:12px;margin:0 0 10px}
.am-item q{display:block;color:var(--muted,#625c76);margin:6px 0;quotes:none}
.am-msgwarn{font-size:.85rem;color:var(--text,#15121f);background:color-mix(in srgb,var(--danger,#e0394a) 12%,var(--card,var(--white)));border-radius:10px;padding:6px 10px;margin-top:4px}`;
    document.head.appendChild(st);
  }

  /* ---------- accessible dialog (own overlay, so it can sit above an open composer sheet) ---------- */
  /** @returns {Promise<string>} the id of the chosen button ("cancel" on Escape/backdrop) */
  function dialog({ title, icon = "comment", html, buttons }) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const ov = document.createElement("div"); ov.className = "am-ov"; ov.id = "am-nudge";
      ov.innerHTML = `<div class="am-dlg" role="alertdialog" aria-modal="true" aria-labelledby="am-t" aria-describedby="am-d"><h2 id="am-t"><span aria-hidden="true"><svg class="ic hi" aria-hidden="true"><use href="#i-${icon}"/></svg></span>${esc(title)}</h2><div id="am-d">${html}</div><div class="am-row">${buttons.map((b, i) => `<button type="button" class="btn ${i ? "ghost" : ""}" data-am="${esc(b.id)}">${esc(b.label)}</button>`).join("")}</div></div>`;
      const done = (v) => { ov.remove(); document.removeEventListener("keydown", key, true); try { prev?.focus?.(); } catch { } resolve(v); };
      const key = (e) => {
        if (e.key === "Escape") { e.preventDefault(); done("cancel"); }
        if (e.key === "Tab") { const f = [...ov.querySelectorAll("button")]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      };
      ov.addEventListener("click", (e) => { const b = e.target.closest?.("[data-am]"); if (b) done(b.dataset.am); else if (e.target === ov) done("cancel"); });
      document.addEventListener("keydown", key, true);
      document.body.appendChild(ov);
      ov.querySelector("button")?.focus();
    });
  }

  /* ---------- 8. «هل أنت متأكد؟» ---------- */
  async function check(text) {
    if (!worthChecking(text)) return { nudge: false, level: "none" };
    const timeout = new Promise(r => setTimeout(() => r({ nudge: false, level: "none", timeout: true }), 1500));
    return Promise.race([api("POST", "/api/automod/check", { text }).catch(() => ({ nudge: false, level: "none", error: true })), timeout]);
  }
  /** resolves true to send, false when the author chose to edit */
  async function confirmBeforePost(text, kind = "comment") {
    const r = await check(text);
    if (!r?.nudge) return true;
    const reply = kind === "comment" || kind === "reply";
    const title = r.level === "risky" ? "قبل النشر، تحقّق من هذا" : reply ? "هل أنت متأكد من هذا الرد؟" : "هل أنت متأكد؟";
    const why = (r.explanations || []).map(x => `<li>${esc(x)}</li>`).join("");
    const choice = await dialog({
      title, icon: r.level === "risky" ? "shield" : "handshake",
      html: `<p>${esc(r.message || "قد يُفهم هذا النص بطريقة لا تقصدها.")}</p>${why ? `<ul>${why}</ul>` : ""}<p class="muted" style="font-size:.88rem">الكلمات اللطيفة تصنع نقاشاً أفضل، والقرار لك.</p>`,
      buttons: [{ id: "edit", label: reply ? "تعديل الرد" : "تعديل النص" }, { id: "post", label: "النشر على أي حال" }]
    });
    api("POST", "/api/automod/nudge", { level: r.level, outcome: choice === "post" ? "posted" : choice === "edit" ? "edited" : "cancelled" }).catch(() => { });
    return choice === "post";
  }
  /* wrap the shared API client once: comments/replies/posts pass through the nudge first */
  function install() {
    if (typeof Remote === "undefined" || !Remote.api || Remote.__amOrig) return false;
    const mw = Remote.use(async function automodNudge(req, next) {
      const { method, path, body } = req;
      const t = target(method, path, body);
      if (t && !(body && body.__amConfirmed)) {
        const go = await confirmBeforePost(t.text, t.kind);
        if (!go) { const e = new Error("لم يُنشر بعد — يمكنك تعديل النص ثم النشر"); /** @type {any} */ (e).code = "automod_edit"; throw e; }
      }
      const out = await next(req);
      if (path === "/api/posts" && out?.post?.status === "held") say("منشورك ظاهر لك وحدك حتى تنتهي مراجعة سريعة");
      return out;
    });
    Remote.__amOrig = (method, path, body, raw) => Remote.below(mw, method, path, body, raw); // the client without the nudge
    // community-ui re-wraps Remote.api for its composer; keep our wrapper outermost-compatible
    return true;
  }

  /* ---------- 7. gentle explanations ---------- */
  function heldBanner(p) {
    const s = STATE.held;
    return `<div class="am-banner" role="status"><span aria-hidden="true"><svg class=ei aria-hidden=true><use href=#i-hourglass /></svg></span><div><b>${esc(s.title)}</b>${esc(s.body)} <button type="button" data-am-why="${esc(p.id)}">لماذا؟</button></div></div>`;
  }
  async function openWhy(targetId) {
    let it = null; try { it = (await api("GET", "/api/automod/explain/" + encodeURIComponent(targetId))).item; } catch { }
    const s = STATE[it?.state] || STATE.held;
    await dialog({ title: s.title, icon: "hourglass", html: `<p>${esc(s.body)}</p>${it?.explanations?.length ? `<ul>${it.explanations.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${it?.help ? `<p>${esc(it.help)}</p>` : ""}`, buttons: [{ id: "ok", label: "حسناً" }] });
  }
  async function openHeld() {
    let items = []; try { items = (await api("GET", "/api/automod/mine")).items || []; } catch (e) { say(e.message); return; }
    const html = `<h3 id="am-held-t" class="u-m0 u-mb10">قيد المراجعة</h3>` + (items.length ? items.map(i => { const s = STATE[i.state] || STATE.held; return `<div class="am-item" role="group" aria-label="${esc(s.title)}"><b>${esc(s.title)}</b><q>${esc((i.preview || "").slice(0, 160))}</q><div class="muted">${(i.explanations || []).map(esc).join(" ")}</div>${i.help ? `<div class="u-mt6">${esc(i.help)}</div>` : ""}${i.kind === "post" && i.state !== "removed" ? `<a class="u-mt8 u-dib btn ghost" href="#/post/${esc(i.target)}">عرض وتعديل</a>` : ""}</div>`; }).join("") : `<p class="muted">لا يوجد شيء قيد المراجعة</p>`);
    if (typeof sheet === "function") sheet(`<div role="region" aria-labelledby="am-held-t">${html}</div>`);
    else await dialog({ title: "قيد المراجعة", html, buttons: [{ id: "ok", label: "إغلاق" }] });
  }
  if (typeof postCard === "function") {
    
    PostHooks.card("automod-ui#1", 120, (_pc) => function (p, opts) { const html = _pc(p, opts); return p && p.status === "held" ? html.replace(/^\s*<div class="card[^"]*"[^>]*>/, (m) => m + heldBanner(p)) : html; });
  }
  if (typeof document !== "undefined") document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-am-why]"); if (b) { e.preventDefault(); openWhy(b.getAttribute("data-am-why")); return; }
    // interstitial for links flagged in private messages
    const a = e.target.closest?.("a[href^='http']"); if (!a || !flaggedHosts.size) return;
    let host = ""; try { host = new URL(a.href).hostname.toLowerCase(); } catch { return; }
    if (!flaggedHosts.has(host)) return;
    e.preventDefault();
    dialog({ title: "هذا الرابط قد يكون ضاراً", icon: "shield", html: `<p>«${esc(host)}» ${esc(flaggedHosts.get(host) || "يبدو غير آمن")}. لا تُدخل كلمات مرورك أو عبارة المرور الخاصة بمحفظتك.</p>`, buttons: [{ id: "back", label: "الرجوع بأمان" }, { id: "go", label: "المتابعة على مسؤوليتي" }] })
      .then(c => { if (c === "go") window.open(a.href, "_blank", "noopener"); });
  }, true);

  /* ---------- realtime ---------- */
  const flags = new Map(), flaggedHosts = new Map();
  function remember(f) { flags.set(f.message, f); for (const l of f.links || []) flaggedHosts.set(String(l.host).toLowerCase(), (l.reasons || [])[0] || ""); }
  async function flagsFor(conv) { try { const r = await api("GET", "/api/automod/flags/" + encodeURIComponent(conv)); (r.flags || []).forEach(remember); return r.flags || []; } catch { return []; } }
  function attach(es) {
    if (!es || es._amAttached) return; es._amAttached = true;
    es.addEventListener("automod", (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch { }
      const s = STATE[d.state]; if (!s) return;
      say(d.state === "released" ? "نُشر منشورك ✓" : `${s.title}: ${(d.explanations || [])[0] || s.body}`);
    });
    es.addEventListener("automod_flag", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { } remember(d); say("وصلتك رسالة قد تحتوي رابطاً غير آمن — تحقّق قبل فتحه"); });
  }
  if (typeof connectStream === "function") { const _cs = connectStream; connectStream = function () { const r = _cs.apply(this, arguments); try { attach(Remote.es); } catch { } return r; }; }
  try { if (typeof Remote !== "undefined" && Remote.es) attach(Remote.es); } catch { }
  install();

  window.MPAutomod = { check, confirmBeforePost, openHeld, openWhy, explain, heldBanner, flagsFor, messageWarning: (id) => flags.get(id) ? `<div class="am-msgwarn" role="note"><svg class=ei aria-hidden=true><use href=#i-shield /></svg> ${esc((flags.get(id).explanations || [])[0] || EXPLAIN.link)}</div>` : "", install, lib };
})();
