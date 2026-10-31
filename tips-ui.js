/* =====================================================================
 * مجتمع بلس — Phase 37 UI: tips & creator support (lazy "tips" chunk, loaded after the "pi" chunk).
 * • «إكرامية» on post cards / post page (only when /api/pi/config is enabled and the author opted in) → tip sheet:
 *   1 / 5 / 10 / custom, message, anonymous, Arabic limit errors, coins + confetti on success (reduced-motion aware).
 *   Flow: POST /api/tips/intent → {intent, tipId} → MPPi.pay({intent}) → Pi.createPayment(intent as returned).
 * • #/support/:handle — tiers, subscribe / renew / cancel, honour roll (month / all), stats.
 * • #/me/supporting — my monthly supports.  • #/creator — opt in, up to 3 tiers, show amounts (works while Pi is off).
 * • #/earnings — day / week / month, gross / fees / net, SVG chart, top posts & supporters, CSV.
 * • #/admin/tips — held tips (release / reject) + ledger balance check; a card on #/admin links to it.
 * REST contract: /workspace/wt/BRIEF-P37.md. Styles are injected here (core CSS budget).
 * ===================================================================== */
(function TipsUI() {
  if (window.MPTips) return;
  const A = () => (typeof PiAdapter !== "undefined" ? PiAdapter : null);
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => esc(String(s ?? ""));
  const enc = encodeURIComponent;
  const pi = (n) => { const x = Number(n); return `<bdi dir="ltr" class="tp-n">${Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: 7 }) : h(n)} π</bdi>`; };
  const cnt = (n) => Number(n || 0).toLocaleString("ar-EG");
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(iso)); } catch { return String(iso); } };
  const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const list = (r, ...keys) => Array.isArray(r) ? r : (keys.map(k => r?.[k]).find(Array.isArray) || []);
  const say = (msg) => { let r = document.getElementById("tp-say"); if (!r) { r = document.createElement("div"); r.id = "tp-say"; r.className = "tp-sr"; r.setAttribute("aria-live", "polite"); document.body.appendChild(r); } r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); };
  const live = (t) => view._tp === t && location.hash === t.h; // still on the screen this render started for (core views do not reset _tp)
  const focusH = () => { const t = document.getElementById("tp-h"); if (t && (!document.activeElement || document.activeElement === document.body)) t.focus({ preventScroll: true }); };
  const avatar = (u) => { const a = u?.avatar, src = !a ? "" : typeof a === "string" ? a : a["64"] || a["200"] || ""; return `<span class="tp-av" aria-hidden="true" style="background:${h(u?.color || "var(--accent2)")}">${src ? `<img src="${h(src)}" alt="">` : h((u?.name || u?.handle || "؟")[0])}</span>`; };
  const MAXTIP = 100, PRESETS = [1, 5, 10];
  const STATE = { none: ["لا دعم", "mute"], active: ["نشط", "ok"], due: ["مستحق التجديد", "wait"], lapsed: ["منتهٍ", "bad"], cancelled: ["ملغى", "mute"], held: ["قيد المراجعة", "wait"] };
  const chip = (s) => { const [t, c] = STATE[s] || [s || "—", "mute"]; return `<span class="pi-chip ${c}">${h(t)}</span>`; };
  // server error codes (BRIEF-P37 fraud rules) → Arabic; anything unknown falls back to the server's own message
  const ERR = {
    tip_max: `أقصى مبلغ للإكرامية الواحدة ${MAXTIP} Pi.`, tip_too_large: `أقصى مبلغ للإكرامية الواحدة ${MAXTIP} Pi.`,
    tip_daily_limit: "بلغت الحد اليومي للإكراميات (500 Pi). حاول غداً.", tip_hourly_limit: "أرسلت إكراميات كثيرة خلال ساعة، انتظر قليلاً ثم أعد المحاولة.",
    tip_new_account: "الحسابات الجديدة (أقل من 3 أيام) حدّها 10 Pi يومياً.", self_tip: "لا يمكنك إرسال إكرامية لنفسك.", tip_self: "لا يمكنك إرسال إكرامية لنفسك.",
    blocked: "لا يمكن الدعم بسبب حظر بينكما.", tip_blocked: "لا يمكن الدعم بسبب حظر بينكما.", minor: "الإكراميات والدعم غير متاحة لمن هم دون 18 عاماً.", tip_minor: "الإكراميات والدعم غير متاحة لمن هم دون 18 عاماً.",
    minor_restricted: "الإكراميات والدعم غير متاحة لمن هم دون 18 عاماً.", integrity_limited: "حسابك مقيّد مؤقتاً، لا يمكن إرسال الإكراميات الآن.",
    creator_disabled: "هذا المبدع لم يفعّل الدعم.", pi_not_linked: "اربط حساب Pi أولاً من الإعدادات ← Pi Network.", not_configured: "مدفوعات Pi غير مفعّلة بعد.", pi_disabled: "مدفوعات Pi غير مفعّلة بعد.", support_active: "دعمك فعّال؛ يمكنك التجديد قبل انتهائه بثلاثة أيام."
  };
  // the server's own Arabic message wins (it carries the exact limit); the code map covers non-Arabic / missing messages
  const errText = (e) => (e?.code && /[\u0600-\u06FF]/.test(e.message || "") && e.message !== "تعذر الاتصال بالخادم" ? e.message : ERR[e?.code]) || (e?.status === 429 ? "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة." : e?.status === 501 ? ERR.pi_disabled : e?.message || "تعذّرت العملية.");

  /* ---------- styles ---------- */
  if (!document.getElementById("tp-css")) document.head.insertAdjacentHTML("beforeend", `<style id="tp-css">
.tp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tp-page{max-width:640px;margin:auto}.tp-page h2:focus,.tp-sheet h3:focus{outline:none}
.tp-n{white-space:nowrap;font-variant-numeric:tabular-nums}.tp-page [hidden],.tp-sheet [hidden],#tp-post[hidden]{display:none!important}
.actions button.tp-tip{color:#8a5a00;font-weight:700}[data-theme=dark] .actions button.tp-tip{color:#ffd27a}
.tp-amts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;border:0;margin:0 0 12px;padding:0}.tp-amts legend{font-weight:700;margin-bottom:8px;padding:0}
.tp-amts label{position:relative;display:block}.tp-amts input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.tp-amts span{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:14px;border:2px solid var(--line);font-weight:800;background:var(--card)}
.tp-amts input:checked+span{border-color:#e8a412;background:#fff3d6;color:#5c3800}.tp-amts input:focus-visible+span{outline:3px solid #5b2bd6;outline-offset:2px}
.tp-f{display:block;margin:0 0 12px}.tp-f>span{display:block;font-weight:700;margin-bottom:6px}.tp-f input[type=number],.tp-f input[type=text],.tp-f textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;background:var(--card);color:inherit}
.tp-f textarea{min-height:64px;resize:vertical}.tp-chk{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-weight:600}.tp-chk input{width:20px;height:20px}
.tp-err{color:#a11616;font-weight:600;min-height:1em;margin:0 0 10px}[data-theme=dark] .tp-err{color:#ff9a9a}
.tp-done{text-align:center;padding:10px 4px}.tp-done .big{line-height:1;color:#e8a412}.tp-done .big .ic{width:56px;height:56px}.tp-done b{display:block;font-size:20px;margin:6px 0}
.tp-av{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:50%;color:var(--white);font-weight:800;overflow:hidden;flex:none}.tp-av img{width:100%;height:100%;object-fit:cover}
.tip-head{display:flex;align-items:center;gap:12px;margin:4px 0 12px}.tip-head h2{color:var(--text)}.tip-head .tp-av{width:56px;height:56px;font-size:var(--fs-2xl)}.tip-head .grow{flex:1;min-width:0}
.tp-btns,#tp-tipme,.tp-gap{margin-bottom:var(--s4)}.tp-ch{margin:0 0 6px;font-size:var(--fs-md)}.tp-list{list-style:none;margin:0;padding:6px 14px}.tp-page .seg{margin-bottom:var(--s3)}.tip-head .chip{flex:none}
.tp-tiers{display:grid;gap:10px;margin:0 0 16px}.tp-tier{border:2px solid var(--line);border-radius:18px;padding:14px;background:var(--card)}.tp-tier.on{border-color:#7b3fe4;box-shadow:0 6px 18px rgba(91,43,214,.18)}
.tp-tier h3{margin:0 0 4px;font-size:17px;display:flex;justify-content:space-between;gap:8px}.tp-tier p{margin:6px 0 10px;color:var(--text-2);white-space:pre-line}
.tp-wall{list-style:none;margin:0;padding:0}.tp-wall li{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line)}.tp-wall li:last-child{border:0}
.tp-wall .rk{width:26px;text-align:center;font-weight:800;color:var(--muted)}.tp-wall .grow{flex:1;min-width:0}.tp-wall .grow b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tp-wall li:nth-child(-n+3) .rk{color:#b07400}
.tp-chart{width:100%;height:auto;display:block;margin:6px 0}.tp-chart .g{fill:#7b3fe4}.tp-chart .n{fill:none;stroke:#e8a412;stroke-width:2.5}.tp-chart text{font-size:9px;fill:var(--muted)}
.tp-leg{display:flex;gap:14px;font-size:var(--fs-sm);color:var(--text-2)}.tp-leg i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-inline-end:4px;vertical-align:-2px}
.tp-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.tp-row:last-child{border:0}.tp-row .grow{flex:1;min-width:0}
.tp-btns{display:flex;flex-wrap:wrap;gap:8px}.tp-btns>*{flex:1 1 120px;text-align:center;text-decoration:none}
.tp-tierform{border:1.5px dashed var(--line);border-radius:16px;padding:12px;margin:0 0 10px}.tp-tierform legend{font-weight:800;padding:0 6px}
.tp-burst{position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden}
.tp-burst i{position:absolute;top:-24px;width:9px;height:14px;border-radius:2px;animation:tpfall var(--t,1.6s) cubic-bezier(.25,.6,.45,1) forwards;animation-delay:var(--d,0s)}
.tp-burst i.c{width:22px;height:22px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff2b8,#f6b52a 55%,#c27c0e);box-shadow:inset 0 0 0 2px rgba(150,90,0,.35)}
@keyframes tpfall{to{transform:translate(var(--dx,0),110vh) rotate(var(--r,540deg))}}
@media (prefers-reduced-motion:reduce){.tp-burst{display:none}}
</style>`);

  /* ---------- availability ---------- */
  async function piOn() { const c = online() ? await A()?.config?.().catch?.(() => null) : null; return !!c?.enabled; }
  const creators = new Map(); // handle → Promise<support payload | null>
  const creatorInfo = (handle) => { if (!creators.has(handle)) creators.set(handle, api("GET", `/api/creators/${enc(handle)}/support`).catch(() => null)); return creators.get(handle); };
  const offPage = (title) => `<div class="wrap tp-page">${UI.pageHead({ back: ["#/me", "حسابي"], title, icon: "wallet", id: "tp-h" })}<div class="notice">${UI.icon("wallet")}<div><b>مدفوعات Pi غير مفعّلة بعد</b><br>ستُفتح الإكراميات والدعم الشهري فور تفعيلها.</div></div>${/الأرباح/.test(title) ? UI.empty({ title: "جهّز صفحة دعمك", text: "أضف مستويات الدعم الشهري الآن لتكون جاهزة يوم التفعيل.", action: `<a class="btn" href="#/creator">إعدادات المبدع</a>` }) : ""}</div>`;
  async function guard(title) { if (await piOn()) return true; view.innerHTML = offPage(title); focusH(); return false; }

  /* ---------- celebration ---------- */
  function celebrate() {
    if (reduced()) return null; // no motion: the thank-you panel alone
    const b = document.createElement("div"); b.className = "tp-burst"; b.setAttribute("aria-hidden", "true");
    const C = ["#7b3fe4", "#f6b52a", "#13a86b", "#e8457a", "#3d8bfd"];
    let html = "";
    for (let i = 0; i < 36; i++) {
      const coin = i % 3 === 0, x = Math.round(Math.random() * 100), dx = Math.round((Math.random() - 0.5) * 160);
      html += `<i class="${coin ? "c" : ""}" style="left:${x}%;--dx:${dx}px;--r:${Math.round(Math.random() * 720)}deg;--d:${(Math.random() * 0.35).toFixed(2)}s;--t:${(1.3 + Math.random() * 0.7).toFixed(2)}s${coin ? "" : `;background:${C[i % C.length]}`}"></i>`;
    }
    b.innerHTML = html; document.body.appendChild(b); setTimeout(() => b.remove(), 2600);
    return b;
  }

  /* ---------- the pay step (reuses the pi chunk's flow) ---------- */
  async function payVia(mkIntent, { amount, memo, purpose, refId }) {
    if (!window.MPPi) await window.MPChunks?.load("pi");
    if (!window.MPPi) throw new Error(ERR.pi_disabled);
    let extra = {};
    const r = await window.MPPi.pay({ amount, memo, purpose, refId, intent: async () => { const x = await mkIntent(); extra = x; return x.intent; } });
    return { ...extra, ...r, intentId: r.id };
  }
  function payNote(av) { return av.ok ? (av.cfg?.network === "mainnet" ? "سيُطلب منك التأكيد في محفظة Pi." : "على الشبكة التجريبية (Testnet) — لا أموال حقيقية.") : h(av.reason); }

  /* ---------- tip sheet ---------- */
  async function tipSheet({ postId = null, toHandle, name }) {
    if (!(await piOn())) return toast(ERR.pi_disabled);
    if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { });
    const who = name || "@" + toHandle;
    const s = sheet(`<div class="tp-sheet" role="dialog" aria-modal="true" aria-labelledby="tp-st"><h3 id="tp-st" tabindex="-1" class="u-m0 u-mt4 u-mb12">${MPFeat.ico("coin")} إكرامية لـ ${h(who)}</h3>
      <form id="tp-form" novalidate>
        <fieldset class="tp-amts"><legend>المبلغ</legend>
          ${PRESETS.map((v, i) => `<label><input type="radio" name="tp-a" value="${v}" ${i === 0 ? "checked" : ""}><span>${pi(v)}</span></label>`).join("")}
          <label><input type="radio" name="tp-a" value="custom" id="tp-cr"><span>مبلغ آخر</span></label></fieldset>
        <label class="tp-f" id="tp-cw" hidden><span>المبلغ (Pi)</span><input type="number" id="tp-custom" inputmode="decimal" min="0.01" max="${MAXTIP}" step="0.01" dir="ltr" aria-describedby="tp-err"></label>
        <label class="tp-f"><span>رسالة (اختيارية)</span><textarea id="tp-msg" maxlength="140" placeholder="شكراً على المحتوى الرائع!"></textarea></label>
        <label class="tp-chk"><input type="checkbox" id="tp-anon"> إرسال كمجهول (لن يظهر اسمك في لوحة الشرف)</label>
        <label class="tp-chk"><input type="checkbox" id="tp-showamt" checked> إظهار المبلغ للعموم (إن سمح المبدع)</label>
        <p class="tp-err" id="tp-err" role="alert"></p>
        <button type="submit" class="pi-btn" id="tp-go" aria-describedby="tp-note"><span class="pi-logo" aria-hidden="true">π</span><span class="tp-lbl">أرسل ${PRESETS[0]} Pi</span></button>
        <p class="pi-note" id="tp-note" role="status">جارٍ التحقق من Pi…</p>
      </form>
      <div class="u-mt10 tp-btns"><a class="btn ghost" href="#/support/${enc(toHandle)}" id="tp-sup">صفحة الدعم</a><button type="button" class="btn ghost" id="tp-x">إغلاق</button></div></div>`);
    const $s = (q) => s.querySelector(q), go = $s("#tp-go"), err = $s("#tp-err"), note = $s("#tp-note");
    $s("#tp-x").onclick = () => closeSheet(); $s("#tp-sup").onclick = () => closeSheet();
    const amount = () => { const v = s.querySelector("input[name=tp-a]:checked")?.value; return v === "custom" ? Number($s("#tp-custom").value) : Number(v); };
    const sync = () => { const custom = $s("#tp-cr").checked; $s("#tp-cw").hidden = !custom; const a = amount(); $s(".tp-lbl").textContent = a > 0 ? `أرسل ${a.toLocaleString("en-US", { maximumFractionDigits: 7 })} Pi` : "أرسل الإكرامية"; err.textContent = ""; };
    s.querySelectorAll("input[name=tp-a]").forEach(r => r.addEventListener("change", () => { sync(); if ($s("#tp-cr").checked) $s("#tp-custom").focus(); }));
    $s("#tp-custom").addEventListener("input", sync);
    let av = { ok: false }; go.disabled = true;
    (window.MPPi ? window.MPPi.availability() : Promise.resolve({ ok: false, reason: ERR.pi_disabled })).then(a => { av = a; note.innerHTML = payNote(a); go.disabled = !a.ok; });
    $s("#tp-st").focus();
    $s("#tp-form").onsubmit = async (e) => {
      e.preventDefault(); if (go.disabled) return;
      const a = amount();
      if (!(a > 0)) { err.textContent = "اختر مبلغاً أكبر من صفر."; return $s("#tp-cr").checked && $s("#tp-custom").focus(); }
      if (a > MAXTIP) { err.textContent = ERR.tip_max; return $s("#tp-custom").focus(); }
      if (Math.round(a * 1e7) !== a * 1e7) { err.textContent = "المبلغ يقبل 7 خانات عشرية كحد أقصى."; return; }
      if (!av.ok) { err.textContent = av.reason || ERR.pi_disabled; return; }
      err.textContent = ""; go.disabled = true; go.setAttribute("aria-busy", "true"); $s(".tp-lbl").textContent = "جارٍ الإرسال…"; note.className = "pi-note"; note.textContent = "أكمل التأكيد في نافذة Pi…";
      const message = $s("#tp-msg").value.trim(), anonymous = $s("#tp-anon").checked, showAmount = $s("#tp-showamt").checked;
      try {
        const r = await payVia(() => api("POST", "/api/tips/intent", { postId, toHandle, amount: a, message: message || undefined, anonymous, showAmount }), { amount: a, memo: "إكرامية لـ @" + toHandle, purpose: "tip", refId: postId });
        const held = false; // a tip may silently go to review: the sender always sees the same success (server contract)
        celebrate();
        $s("#tp-form").outerHTML = `<div class="tp-done" id="tp-done" tabindex="-1"><div class="big" aria-hidden="true">${MPFeat.ico("coin")}</div><b>شكراً لك! ${held ? "إكراميتك قيد المراجعة" : "وصلت إكراميتك"}</b>
          <p class="u-m0 u-mb10 muted">${pi(a)} إلى ${h(who)}${anonymous ? " · مجهول الهوية" : ""}${held ? "<br>سنراجعها قريباً، ولن يُخصم شيء إن رُفضت." : ""}</p>
          <a href="#/receipt/${enc(r.intentId)}" class="btn ghost" id="tp-rc">عرض الإيصال</a></div>`;
        $s("#tp-rc").onclick = () => closeSheet(); $s("#tp-done").focus();
        say(held ? "أُرسلت الإكرامية وهي قيد المراجعة" : "أُرسلت الإكرامية، شكراً لك"); toast("شكراً! أُرسلت الإكرامية");
        creators.delete(toHandle); if (postId) postTips(postId);
      } catch (e2) {
        go.disabled = false; go.removeAttribute("aria-busy"); sync();
        if (e2.cancelled) { note.className = "pi-note"; note.textContent = "أُلغيت عملية الدفع، لم يُخصم شيء."; }
        else { err.textContent = errText(e2); note.textContent = ""; }
      }
    };
    return s;
  }

  /* ---------- post cards + post page ---------- */
  let on = false;
  async function decorate() {
    if (!on || typeof S === "undefined") return;
    for (const act of document.querySelectorAll("#view .actions:not([data-tp])")) {
      act.dataset.tp = "1";
      const pid = act.querySelector("[data-react]")?.dataset.react, p = pid && S.post(pid);
      if (!p || p.author === DB.me) continue;
      const u = S.user(p.author); if (!u?.handle) continue;
      creatorInfo(u.handle).then((c) => {
        if (!c?.creator?.enabled || act.querySelector("[data-tip]")) return;
        const b = document.createElement("button"); b.type = "button"; b.className = "tp-tip"; b.dataset.tip = pid; b.dataset.tipTo = u.handle; b.dataset.tipName = u.name || "";
        b.setAttribute("aria-label", `إكرامية لـ ${u.name || u.handle}`); b.innerHTML = `${MPFeat.ico("coin","sm")} إكرامية`;
        const views = act.querySelector("span.muted"); views ? act.insertBefore(b, views) : act.appendChild(b);
      });
    }
  }
  async function postTips(pid) {
    const box = document.getElementById("tp-post"); if (!box) return;
    try {
      const t = await api("GET", `/api/posts/${enc(pid)}/tips`);
      if (!t?.count) { box.hidden = true; return; }
      const recent = list(t, "recent").slice(0, 5).map(x => x.user ? "@" + h(x.user.handle) : "مجهول").join("، ");
      box.hidden = false;
      box.innerHTML = `${MPFeat.ico("coin","sm")} <b>${cnt(t.count)} ${t.count === 1 ? "إكرامية" : "إكراميات"}</b>${t.total != null ? ` · المجموع ${pi(t.total)}` : ""}${recent ? `<div class="u-t-sm u-mt4 muted">أحدث الداعمين: ${recent}</div>` : ""}`;
    } catch { box.hidden = true; }
  }
  async function enhancePost(pid) {
    const p = S.post(pid); if (!on || !p || document.getElementById("tp-post")) return;
    const u = S.user(p.author), c = await creatorInfo(u?.handle); if (!c?.creator?.enabled) return;
    const first = view.querySelector(".wrap .card") || view.querySelector(".card"); if (!first || document.getElementById("tp-post")) return;
    first.insertAdjacentHTML("afterend", `<div class="card" id="tp-post" role="region" aria-label="إكراميات المنشور" hidden></div>`);
    postTips(pid);
  }

  /* ---------- #/support/:handle ---------- */
  async function supportView(handle) {
    if (!handle) return Views.notFound();
    if (!(await guard("دعم المبدع"))) return;
    const v = view, token = (v._tp = { h: location.hash });
    if (v.querySelector("#tp-sup")?.dataset.h !== handle) v.innerHTML = `<div class="wrap tp-page"><div class="skel"></div><div class="skel"></div></div>`; // a re-render of the same page keeps it until fresh data arrives
    let d; try { d = await api("GET", `/api/creators/${enc(handle)}/support`); } catch (e) { if (live(token)) { v.innerHTML = `<div class="wrap tp-page">${UI.pageHead({ title: "دعم المبدع", icon: "heart", id: "tp-h" })}<div class="notice danger">${h(errText(e))}</div></div>`; focusH(); } return; }
    if (!live(token)) return;
    creators.set(handle, Promise.resolve(d));
    const c = d.creator || {}, me = typeof DB !== "undefined" && S.me?.()?.handle === c.handle, ms = d.myStatus || { state: "none" };
    const tierBtn = (t) => {
      if (me) return "";
      const mine = ms.tier && (ms.tier === t.id || ms.tier?.id === t.id);
      if (mine && ms.state === "active") return `<p class="u-m0 u-mb8 muted">تدعمه حتى ${h(day(ms.activeUntil))}</p><button type="button" class="u-w100 btn ghost block" data-tp-cancel>إلغاء الدعم</button>`;
      const label = mine && ms.state === "due" ? "جدّد الدعم" : mine && ms.state === "lapsed" ? "استأنف الدعم" : mine && ms.state === "cancelled" ? "ادعم مجدداً" : "ادعم شهرياً";
      return `<button type="button" class="pi-btn" data-tp-sub="${h(t.id)}" aria-label="${h(label)} — ${h(t.name)}، ${Number(t.amount)} Pi شهرياً"><span class="pi-logo" aria-hidden="true">π</span>${h(label)}</button>`;
    };
    v.innerHTML = `<div class="wrap tp-page" id="tp-sup" data-h="${h(handle)}">
      <div class="tip-head">${avatar(c)}<div class="grow"><h2 id="tp-h" tabindex="-1" class="u-m0">ادعم ${h(c.name || c.handle)}</h2><a href="#/u/${enc(c.handle)}" class="muted">@${h(c.handle)}</a></div>${ms.state && ms.state !== "none" ? chip(ms.state) : ""}</div>
      ${c.enabled ? `<div class="tip-stats f-kpis"><div class="kpi-tile"><b>${cnt(d.stats?.supporters)}</b><span>داعم شهري</span></div><div class="kpi-tile"><b>${cnt(d.stats?.tipsCount)}</b><span>إكرامية</span></div></div>
        ${me ? `<div class="tp-btns"><a class="btn" href="#/creator">${UI.icon("settings","sm")} إعدادات المبدع</a><a class="btn outline" href="#/earnings">${UI.icon("chart","sm")} الأرباح</a></div>` : `<button type="button" class="btn block" id="tp-tipme">${MPFeat.ico("coin","sm")} أرسل إكرامية</button>`}
        <h3 class="f-h">مستويات الدعم الشهري</h3>
        <div class="tp-tiers">${list(d.tiers).map(t => `<section class="tp-tier${ms.tier && (ms.tier === t.id || ms.tier?.id === t.id) && ms.state === "active" ? " on" : ""}" aria-labelledby="tp-t-${h(t.id)}"><h3 id="tp-t-${h(t.id)}"><span>${h(t.name)}</span><span>${pi(t.amount)} <small class="muted">/ شهرياً</small></span></h3>${t.perks ? `<p>${h(t.perks)}</p>` : ""}${tierBtn(t)}</section>`).join("") || `<p class="muted">لا مستويات دعم شهري بعد.</p>`}</div>
        ${me ? "" : `<label class="tp-chk"><input type="checkbox" id="tp-sanon"> دعم مجهول الهوية</label><label class="tp-chk"><input type="checkbox" id="tp-sshow" checked> إظهار المبلغ للعموم (إن سمح المبدع)</label>`}
        <p class="tp-err" id="tp-serr" role="alert"></p><p class="pi-note" id="tp-snote" role="status"></p>
        <p class="f-hint">الدعم الشهري دفعة تؤكدها بنفسك كل شهر (لا خصم تلقائي في Pi). سنذكّرك قبل موعد التجديد بثلاثة أيام، ويمكنك الإلغاء في أي وقت.</p>
        <h3 class="f-h" id="tp-wall-h">لوحة الشرف</h3>
        <div class="tp-tabs seg" role="tablist" aria-labelledby="tp-wall-h"><button type="button" role="tab" id="tp-tab-month" aria-controls="tp-wall" aria-selected="true" data-period="month">هذا الشهر</button><button type="button" role="tab" id="tp-tab-all" aria-controls="tp-wall" aria-selected="false" tabindex="-1" data-period="all">كل الأوقات</button></div>
        <div id="tp-wall" role="tabpanel" aria-labelledby="tp-tab-month" class="card">${wall(d.wall)}</div>`
        : UI.empty({ title: "الدعم غير مفعّل", text: `لم يفعّل ${c.name || "هذا المبدع"} الإكراميات والدعم الشهري بعد.`, action: me ? `<a class="btn" href="#/creator">فعّل الدعم</a>` : "" })}</div>`;
    focusH();
    if (!c.enabled) return;
    v.querySelector("#tp-tipme")?.addEventListener("click", () => tipSheet({ toHandle: c.handle, name: c.name }));
    const tabs = [...v.querySelectorAll(".tp-tabs [role=tab]")];
    let wseq = 0;
    const loadWall = async (btn) => {
      const my = ++wseq; // a slower earlier tab must not overwrite the one just chosen
      tabs.forEach(t => { const sel = t === btn; t.setAttribute("aria-selected", String(sel)); t.tabIndex = sel ? 0 : -1; });
      const box = v.querySelector("#tp-wall"); if (!box) return; box.setAttribute("aria-labelledby", btn.id); box.setAttribute("aria-busy", "true");
      try { const w = await api("GET", `/api/creators/${enc(handle)}/wall?period=${btn.dataset.period}`); if (live(token) && box.isConnected && my === wseq) box.innerHTML = wall(list(w, "wall", "entries", "items", "leaders")); }
      catch (e) { if (live(token) && box.isConnected && my === wseq) box.innerHTML = `<p class="muted">${h(errText(e))}</p>`; }
      if (my === wseq) box.removeAttribute("aria-busy");
    };
    tabs.forEach((t, i) => { t.onclick = () => loadWall(t); t.onkeydown = (e) => { const k = { ArrowLeft: 1, ArrowRight: -1, Home: -i, End: tabs.length - 1 - i }[e.key]; if (k === undefined) return; e.preventDefault(); const n = tabs[(i + k + tabs.length) % tabs.length]; n.focus(); loadWall(n); }; });
    loadWall(tabs[0]);
    const serr = v.querySelector("#tp-serr"), snote = v.querySelector("#tp-snote");
    v.querySelectorAll("[data-tp-sub]").forEach(b => b.onclick = async () => {
      const t = list(d.tiers).find(x => String(x.id) === b.dataset.tpSub); if (!t) return;
      const av = window.MPPi ? await window.MPPi.availability() : { ok: false, reason: ERR.pi_disabled };
      if (!av.ok) { serr.innerHTML = h(av.reason); return; }
      serr.textContent = ""; snote.textContent = "أكمل التأكيد في نافذة Pi…"; b.disabled = true; b.setAttribute("aria-busy", "true");
      try {
        await payVia(() => api("POST", "/api/support/intent", { toHandle: c.handle, tierId: t.id, anonymous: !!v.querySelector("#tp-sanon")?.checked, showAmount: !!v.querySelector("#tp-sshow")?.checked }), { amount: t.amount, memo: `دعم شهري: ${t.name}`, purpose: "subscription", refId: c.id });
        celebrate(); toast("شكراً لدعمك!"); say(`أصبحت داعماً لـ ${c.name || c.handle}`); creators.delete(handle);
        supportView(handle);
      } catch (e) { b.disabled = false; b.removeAttribute("aria-busy"); snote.textContent = e.cancelled ? "أُلغيت عملية الدفع، لم يُخصم شيء." : ""; if (!e.cancelled) serr.textContent = errText(e); }
    });
    v.querySelector("[data-tp-cancel]")?.addEventListener("click", () => confirmCancel({ handle, name: c.name, id: ms.id || ms.supportId, until: ms.activeUntil }, () => supportView(handle)));
  }
  function wall(rows) {
    rows = list(rows); if (!rows.length) return `<p class="u-m0 muted">لا داعمين بعد. كن أول من يدعم!</p>`;
    return `<ol class="tp-wall">${rows.map((r, i) => { const amt = r.amount ?? r.total; return `<li><span class="rk">${cnt(r.rank || i + 1)}</span>${r.user ? avatar(r.user) : `<span class="tp-av" aria-hidden="true" style="background:var(--bg-2);color:var(--text-2)">؟</span>`}
      <div class="grow"><b>${r.user ? h(r.user.name || r.user.handle) : "داعم مجهول"}</b><span class="u-t-xs muted">${(r.kinds || [r.kind || "tip"]).map(k => k === "support" ? "دعم شهري" : "إكرامية").join(" + ")}${r.count > 1 ? ` ×${cnt(r.count)}` : ""}${r.at ? " · " + h(day(r.at)) : ""}</span></div>
      <span>${amt != null ? pi(amt) : `<span class="muted" aria-label="المبلغ مخفي">—</span>`}</span></li>`; }).join("")}</ol>`;
  }
  async function supportIdFor(handle) { const r = await api("GET", "/api/me/supporting"); return list(r, "supporting", "items", "supports").find(x => (x.creator?.handle || x.handle) === handle && x.state !== "cancelled")?.id; }
  function confirmCancel({ handle, name, id, until }, done) {
    const s = sheet(`<div role="alertdialog" aria-modal="true" aria-labelledby="tp-ct" aria-describedby="tp-cd"><h3 id="tp-ct" tabindex="-1" class="u-m0 u-mt4 u-mb8">إلغاء دعم ${h(name || "@" + handle)}؟</h3>
      <p id="tp-cd" class="muted">${until ? `يبقى دعمك فعّالاً حتى ${h(day(until))}، ` : ""}ولن يُطلب منك التجديد بعد ذلك. لا يُسترد مبلغ الشهر الحالي إلا خلال 24 ساعة من الدفع وبمراجعة الإدارة.</p>
      <p class="tp-err" id="tp-cerr" role="alert"></p><div class="tp-btns"><button type="button" class="btn" id="tp-cy" style="background:var(--danger,#b42318);color:#fff">إلغاء الدعم</button><button type="button" class="btn ghost" id="tp-cn">تراجع</button></div></div>`);
    s.querySelector("#tp-cn").onclick = () => closeSheet(); s.querySelector("#tp-ct").focus();
    s.querySelector("#tp-cy").onclick = async (e) => {
      e.target.disabled = true;
      try { const sid = id || await supportIdFor(handle); if (!sid) throw new Error("لم نجد اشتراكك."); const res = await api("POST", `/api/support/${enc(sid)}/cancel`); closeSheet(); toast(res?.note || "أُلغي الدعم"); say("أُلغي الدعم. " + (res?.note || "")); creators.delete(handle); done?.(); }
      catch (err) { e.target.disabled = false; s.querySelector("#tp-cerr").textContent = errText(err); }
    };
  }

  /* ---------- #/me/supporting ---------- */
  async function supportingView() {
    if (!(await guard("من أدعمهم"))) return;
    const v = view, token = (v._tp = { h: location.hash });
    v.innerHTML = `<div class="wrap tp-page">${UI.pageHead({ back: ["#/me", "حسابي"], title: "من أدعمهم", icon: "heart", id: "tp-h" })}<div id="tp-sl" aria-busy="true"><div class="skel"></div></div></div>`;
    focusH();
    let rows; try { rows = list(await api("GET", "/api/me/supporting"), "supporting", "items", "supports"); } catch (e) { const sl = v.querySelector("#tp-sl"); if (live(token) && sl) sl.innerHTML = `<div class="card">${h(errText(e))}</div>`; return; }
    const box = v.querySelector("#tp-sl"); if (!live(token) || !box) return;
    box.removeAttribute("aria-busy");
    box.innerHTML = rows.length ? `<ul class="card tp-list">${rows.map(r => { const c = r.creator || { handle: r.handle, name: r.name }, t = r.tier || {}; return `<li class="tp-row">${avatar(c)}<div class="grow"><a href="#/support/${enc(c.handle)}"><b>${h(c.name || c.handle)}</b></a>
        <div class="u-t-sm muted">${h(t.name || "")}${t.amount != null ? " · " + pi(t.amount) + " شهرياً" : ""}${r.activeUntil ? ` · ${r.state === "active" ? "حتى" : "انتهى"} ${h(day(r.activeUntil))}` : ""}</div></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">${chip(r.state)}${["due", "lapsed", "cancelled"].includes(r.state) ? `<a class="btn" href="#/support/${enc(c.handle)}">${r.state === "due" ? "جدّد" : "ادعم مجدداً"}</a>` : r.state === "active" ? `<button type="button" class="btn ghost" data-tp-c="${h(r.id)}" data-h="${h(c.handle)}" data-n="${h(c.name || "")}" data-u="${h(r.activeUntil || "")}">إلغاء</button>` : ""}</div></li>`; }).join("")}</ul>`
      : `<div class="card empty">لا تدعم أحداً بعد. ابحث عن مبدعيك المفضلين وادعمهم من صفحاتهم.</div>`;
    box.querySelectorAll("[data-tp-c]").forEach(b => b.onclick = () => confirmCancel({ handle: b.dataset.h, name: b.dataset.n, id: b.dataset.tpC, until: b.dataset.u }, supportingView));
  }

  /* ---------- #/creator ---------- */
  async function creatorView() {
    const v = view, token = (v._tp = { h: location.hash }), enabled = await piOn(), me = S.me?.();
    v.innerHTML = `<div class="wrap tp-page">${UI.pageHead({ back: ["#/me", "حسابي"], title: "إعدادات المبدع", icon: "sparkle", id: "tp-h" })}<div class="skel"></div></div>`;
    let cur = { enabled: false, tiers: [], showAmounts: true };
    const MAXT = () => Number(cur.maxTier) > 0 ? Number(cur.maxTier) : 1000, NT = () => Math.min(3, Number(cur.maxTiers) || 3);
    if (online()) {
      const got = await api("GET", "/api/me/creator").catch(() => null) || await creatorInfo(me?.handle);
      if (got) cur = { enabled: !!(got.enabled ?? got.creator?.enabled), tiers: list(got.tiers), showAmounts: got.showAmounts ?? got.creator?.showAmounts ?? true, feeBps: got.feeBps, maxTier: got.limits?.maxTierAmount, maxTiers: got.limits?.maxTiers };
    }
    if (!live(token)) return;
    const tierFs = (t, i) => `<fieldset class="tp-tierform" data-i="${i}"><legend>المستوى ${cnt(i + 1)}</legend>${t.id ? `<input type="hidden" data-k="id" value="${h(t.id)}">` : ""}
      <label class="tp-f"><span>الاسم</span><input type="text" data-k="name" maxlength="40" required value="${h(t.name || "")}"></label>
      <label class="tp-f"><span>المبلغ الشهري (Pi)</span><input type="number" data-k="amount" min="0.01" max="${MAXT()}" step="0.01" dir="ltr" required value="${h(t.amount ?? "")}"></label>
      <label class="tp-f"><span>المزايا</span><textarea data-k="perks" maxlength="300">${h(t.perks || "")}</textarea></label>
      <button type="button" class="btn ghost" data-rm="${i}">حذف المستوى</button></fieldset>`;
    let tiers = cur.tiers.slice(0, NT()); // PUT sends the FULL list: a tier left out is retired
    v.innerHTML = `<div class="wrap tp-page">${UI.pageHead({ back: ["#/me", "حسابي"], title: "إعدادات المبدع", icon: "sparkle", id: "tp-h", actions: enabled ? `<a class="btn outline" href="#/earnings">${UI.icon("chart","sm")} لوحة الأرباح</a>${me ? `<a class="btn outline" href="#/support/${enc(me.handle)}">${UI.icon("heart","sm")} صفحة دعمي</a>` : ""}` : "" })}
      ${!enabled ? `<div class="notice warn" id="tp-offnote" role="note">${MPFeat.ico("alert")}<div><b>المدفوعات غير مفعّلة بعد</b><br>جهّز إعداداتك الآن؛ ستُفتح الإكراميات والدعم الشهري لمتابعيك فور تفعيل مدفوعات Pi.</div></div>` : ""}
      <form id="tp-cf" class="card" novalidate>
        <label class="tp-chk"><input type="checkbox" id="tp-en" ${cur.enabled ? "checked" : ""}> استقبال الإكراميات والدعم الشهري</label>
        <label class="tp-chk"><input type="checkbox" id="tp-show" ${cur.showAmounts ? "checked" : ""}> إظهار المبالغ في لوحة الشرف</label>
        <p class="f-hint tp-gap">يمكنك إضافة حتى ${cnt(NT())} مستويات للدعم الشهري. الحسابات دون 18 عاماً لا تستقبل الإكراميات.${cur.feeBps > 0 ? ` رسوم المنصة ${(cur.feeBps / 100).toLocaleString("ar-EG")}٪ من كل دفعة.` : " لا رسوم منصة حالياً."}</p>
        <div id="tp-tl"></div><button type="button" class="btn outline block tp-gap" id="tp-add">${UI.icon("plus","sm")} إضافة مستوى</button>
        <p class="tp-err" id="tp-cerr" role="alert"></p>
        <button type="submit" class="btn block" id="tp-save">حفظ الإعدادات</button></form></div>`;
    focusH();
    const tl = v.querySelector("#tp-tl"), add = v.querySelector("#tp-add"), cerr = v.querySelector("#tp-cerr");
    const read = () => [...tl.querySelectorAll(".tp-tierform")].map(f => { const o = {}; f.querySelectorAll("[data-k]").forEach(x => { o[x.dataset.k] = x.value; }); return o; });
    const draw = (focusIdx) => {
      tl.innerHTML = tiers.map(tierFs).join(""); add.hidden = tiers.length >= NT();
      tl.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { tiers = read(); tiers.splice(Number(b.dataset.rm), 1); draw(); add.hidden ? v.querySelector("#tp-en").focus() : add.focus(); say("حُذف المستوى"); });
      if (focusIdx != null) tl.querySelectorAll(".tp-tierform")[focusIdx]?.querySelector("input[data-k=name]")?.focus();
    };
    draw();
    add.onclick = () => { tiers = read(); if (tiers.length >= NT()) return; tiers.push({ name: "", amount: "", perks: "" }); draw(tiers.length - 1); };
    v.querySelector("#tp-cf").onsubmit = async (e) => {
      e.preventDefault(); cerr.textContent = "";
      const ts = read().map(t => ({ ...(t.id ? { id: t.id } : {}), name: t.name.trim(), amount: Number(t.amount), perks: t.perks.trim() }));
      const bad = ts.findIndex(t => !t.name || !(t.amount > 0) || t.amount > MAXT() || Math.round(t.amount * 1e7) !== t.amount * 1e7);
      if (bad >= 0) { cerr.textContent = `أكمل المستوى ${cnt(bad + 1)}: الاسم ومبلغ بين 0.01 و${MAXT()} Pi.`; tl.querySelectorAll(".tp-tierform")[bad]?.querySelector(ts[bad].name ? "input[data-k=amount]" : "input[data-k=name]")?.focus(); return; }
      if (!online()) { cerr.textContent = "الإعدادات تحتاج الاتصال بالخادم."; return; }
      const btn = v.querySelector("#tp-save"); btn.disabled = true;
      try {
        const r = await api("PUT", "/api/me/creator", { enabled: v.querySelector("#tp-en").checked, tiers: ts, showAmounts: v.querySelector("#tp-show").checked });
        tiers = list(r?.tiers).length ? list(r.tiers) : ts; draw(); creators.delete(me?.handle); toast("حُفظت إعدادات المبدع"); say("حُفظت إعدادات المبدع");
      } catch (err) { cerr.textContent = errText(err); }
      btn.disabled = false;
    };
  }

  /* ---------- #/earnings ---------- */
  const PERIODS = { day: "اليوم", week: "الأسبوع", month: "الشهر" };
  function chart(series) {
    const s = list(series); if (!s.length) return `<p class="muted">لا بيانات لهذه الفترة.</p>`;
    const W = 320, H = 150, P = 18, max = Math.max(...s.map(x => Number(x.gross) || 0), 0.0001), bw = (W - P * 2) / s.length;
    const y = (v) => H - P - (Number(v) || 0) / max * (H - P * 2);
    const bars = s.map((x, i) => `<rect class="g" x="${(P + i * bw + bw * 0.15).toFixed(1)}" y="${y(x.gross).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(H - P - y(x.gross)).toFixed(1)}" rx="2"><title>${h(x.date)}: ${Number(x.gross) || 0} Pi</title></rect>`).join("");
    const line = s.map((x, i) => `${(P + i * bw + bw / 2).toFixed(1)},${y(x.net).toFixed(1)}`).join(" ");
    const lab = (i) => `<text x="${(P + i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${h(String(s[i].date).slice(5, 10))}</text>`;
    const total = s.reduce((a, x) => a + (Number(x.gross) || 0), 0);
    return `<svg class="tp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="tp-ch-t" direction="ltr"><title id="tp-ch-t">رسم بياني للأرباح: ${s.length} نقطة، إجمالي ${total.toLocaleString("en-US", { maximumFractionDigits: 7 })} Pi، أعلى قيمة ${max.toLocaleString("en-US", { maximumFractionDigits: 7 })} Pi</title>
      <line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" stroke="currentColor" stroke-opacity=".2"/>${bars}${s.length > 1 ? `<polyline class="n" points="${line}"/>` : ""}${lab(0)}${s.length > 1 ? lab(s.length - 1) : ""}</svg>
      <div class="tp-leg" aria-hidden="true"><span><i style="background:#7b3fe4"></i>الإجمالي</span><span><i style="background:#e8a412"></i>الصافي</span></div>
      <table class="tp-sr"><caption>الأرباح حسب التاريخ</caption><thead><tr><th scope="col">التاريخ</th><th scope="col">الإجمالي</th><th scope="col">الصافي</th></tr></thead><tbody>${s.map(x => `<tr><td>${h(x.date)}</td><td>${Number(x.gross) || 0}</td><td>${Number(x.net) || 0}</td></tr>`).join("")}</tbody></table>`;
  }
  async function earningsView(period = "month") {
    if (!(await guard("الأرباح"))) return;
    if (!PERIODS[period]) period = "month";
    const v = view, token = (v._tp = { h: location.hash }), keep = v.querySelector("#tp-earn") && document.activeElement?.closest?.(".tp-tabs");
    v.innerHTML = `<div class="wrap tp-page" id="tp-earn">${UI.pageHead({ back: ["#/me", "حسابي"], title: "الأرباح", icon: "chart", id: "tp-h", row: true, actions: `<a class="btn outline" href="#/creator" aria-label="إعدادات المبدع">${UI.icon("settings","sm")}</a>` })}
      <div class="tp-tabs seg" role="group" aria-label="الفترة">${Object.entries(PERIODS).map(([k, t]) => `<button type="button" data-p="${k}" aria-pressed="${k === period}">${t}</button>`).join("")}</div>
      <div id="tp-eb" aria-busy="true" aria-live="polite"><div class="skel"></div><div class="skel"></div></div></div>`;
    v.querySelectorAll("[data-p]").forEach(b => b.onclick = () => earningsView(b.dataset.p));
    if (keep) v.querySelector(`[data-p=${period}]`).focus(); else focusH();
    let d; try { d = await api("GET", `/api/me/earnings?period=${period}`); } catch (e) { if (live(token)) { const b = v.querySelector("#tp-eb"); if (b) { b.removeAttribute("aria-busy"); b.innerHTML = `<div class="card">${h(errText(e))}</div>`; } } return; }
    const b = v.querySelector("#tp-eb"); if (!live(token) || !b) return; // left the page meanwhile
    b.removeAttribute("aria-busy");
    const csv = d.csvUrl || `/api/me/earnings.csv?period=${period}`, src = d.bySource || {};
    b.innerHTML = `<div class="tp-kpi f-kpis"><div class="kpi-tile"><b>${pi(d.gross)}</b><span>الإجمالي</span></div><div class="kpi-tile"><b>${pi(d.fees)}</b><span>رسوم المنصة</span></div><div class="kpi-tile"><b>${pi(d.net)}</b><span>الصافي</span></div><div class="kpi-tile"><b>${pi(d.refunds || 0)}</b><span>المستردّ</span></div></div>
      <div class="card"><h3 class="tp-ch">الأرباح خلال ${PERIODS[period]}</h3>${chart(d.series)}
        <p class="f-hint">من الإكراميات ${pi(src.tips || 0)} · من الدعم الشهري ${pi(src.support || 0)}${src.ppv != null ? ` · من المحتوى المدفوع ${pi(src.ppv)}` : ""}</p></div>
      <div class="card"><h3 class="tp-ch">أعلى المنشورات</h3>${list(d.topPosts).length ? `<ol style="margin:0;padding-inline-start:20px">${list(d.topPosts).map(p => { const lp = S.post(p.postId); return `<li class="tp-row" style="display:list-item"><a href="#/post/${enc(p.postId)}">${h(lp ? (lp.title || lp.text || "").slice(0, 60) || "منشور" : "منشور")}</a> — ${pi(p.total)}</li>`; }).join("")}</ol>` : `<p class="f-hint">لا إكراميات على منشوراتك بعد.</p>`}</div>
      <div class="card"><h3 class="tp-ch">أبرز الداعمين</h3>${wall(d.topSupporters)}</div>
      <a class="btn outline block" id="tp-csv" href="${h(csv)}" download="earnings-${period}.csv">${UI.icon("download","sm")} تنزيل CSV</a>`;
  }

  /* ---------- #/admin/tips ---------- */
  async function adminTips() {
    if (!DB.isAdmin) return Views.notFound();
    if (!(await guard("الإكراميات المعلّقة"))) return;
    const v = view, token = (v._tp = { h: location.hash });
    v.innerHTML = `<div class="wrap tp-page">${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "الإكراميات المعلّقة للمراجعة", icon: "coin", id: "tp-h" })}
      <div id="tp-held" aria-busy="true"><div class="skel"></div></div>
      <div class="card"><h3 class="tp-ch">سلامة دفتر الأستاذ</h3><button type="button" class="btn ghost" id="tp-lc">فحص توازن القيود</button><p class="pi-note" id="tp-lcr" role="status"></p></div></div>`;
    focusH();
    const lc = v.querySelector("#tp-lc"), lcr = v.querySelector("#tp-lcr");
    lc.onclick = async () => {
      lc.disabled = true; lcr.className = "pi-note"; lcr.textContent = "جارٍ الفحص…";
      try { const r = await api("GET", "/api/admin/ledger/check"); const im = list(r.imbalances); lcr.className = "pi-note " + (r.balanced ? "ok" : "err"); lcr.textContent = r.balanced ? `متوازن ✓ — ${cnt(r.journals)} قيد.` : `غير متوازن: ${cnt(im.length)} قيد من ${cnt(r.journals)} يحتاج مراجعة${im[0] ? ` (أولها ${im[0].journal || im[0].id || ""})` : ""}.`; }
      catch (e) { lcr.className = "pi-note err"; lcr.textContent = errText(e); }
      lc.disabled = false;
    };
    const load = async () => {
      const box = v.querySelector("#tp-held"); if (!box) return;
      let rows; try { rows = list(await api("GET", "/api/admin/tips/held"), "held", "tips", "items"); } catch (e) { if (live(token) && box.isConnected) { box.removeAttribute("aria-busy"); box.innerHTML = `<div class="card">${h(errText(e))}</div>`; } return; }
      if (!live(token) || !box.isConnected) return;
      box.removeAttribute("aria-busy");
      box.innerHTML = rows.length ? `<ul class="card" style="list-style:none;margin:0 0 12px;padding:6px 14px">${rows.map(t => { const fr = t.from || t.sender || {}, to = t.to || t.creator || {}; return `<li class="tp-row" data-held="${h(t.id)}"><div class="grow"><b>${pi(t.amount)}</b> <span class="muted">من</span> @${h(fr.handle || "؟")} <span class="muted">إلى</span> @${h(to.handle || "؟")}
          <div class="u-t-sm muted">${h(t.holdReason || t.reason || "نشاط غير معتاد")} · ${h(day(t.createdAt || t.at))}${t.postId ? ` · <a href="#/post/${enc(t.postId)}">المنشور</a>` : ""}</div></div>
          <div class="u-fn tp-btns"><button type="button" class="btn" data-act="release" aria-label="إفراج عن إكرامية ${Number(t.amount)} Pi من @${h(fr.handle || "")}">إفراج</button><button type="button" class="btn ghost" data-act="reject" aria-label="رفض إكرامية ${Number(t.amount)} Pi من @${h(fr.handle || "")}">رفض</button></div></li>`; }).join("")}</ul>`
        : `<div class="u-mb12 card empty">لا إكراميات معلّقة. ✓</div>`;
      box.querySelectorAll("[data-act]").forEach(b => b.onclick = async () => {
        const li = b.closest("[data-held]"), id = li.dataset.held, act = b.dataset.act; li.querySelectorAll("button").forEach(x => (x.disabled = true));
        try { await api("POST", `/api/admin/tips/${enc(id)}/${act}`); toast(act === "release" ? "أُفرج عن الإكرامية" : "رُفضت الإكرامية"); say(act === "release" ? "أُفرج عن الإكرامية" : "رُفضت الإكرامية"); await load(); v.querySelector("#tp-h")?.focus(); }
        catch (e) { li.querySelectorAll("button").forEach(x => (x.disabled = false)); toast(errText(e)); }
      });
    };
    load();
  }

  /* ---------- wiring ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-tip]"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); tipSheet({ postId: b.dataset.tip, toHandle: b.dataset.tipTo, name: b.dataset.tipName });
  });
  MPRoutes.extend((a, b, prev) => {
    const link = (r, href, text, idn) => Promise.resolve(r).then(() => { const t = view.querySelector(".wrap h2"); if (t && !document.getElementById(idn)) t.insertAdjacentHTML("afterend", `<a class="u-dflex u-g12 u-p12 u-ci u-tdn card" id="${idn}" href="${href}"><b class="u-f1">${text}</b><span class="fwd" aria-hidden="true">←</span></a>`); }).catch(() => { }); // phase 57 entry points
    return { support: () => { const r = supportView(a); link(r, "#/subs/" + encodeURIComponent(a || ""), "الاشتراك الشهري ومزايا المستويات", "sb-lnk"); return r; },
      creator: () => { const r = creatorView(); link(r, "#/subscribers", "المشتركون والإحصاءات ومزايا المستويات", "sb-lnk"); return r; }, earnings: () => earningsView(a),
      supporting: () => supportingView() };
  });
  MPRoutes.add("admin", (a, b, next) => {
        if (a === "tips") return adminTips();
        next();
        if (!a && DB.isAdmin && on && !document.getElementById("tp-adm")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-dflex u-aic u-g12 u-ci u-tdn card" id="tp-adm" href="#/admin/tips"><span class="ico" aria-hidden="true">${MPFeat.ico("coin")}</span><span class="u-f1"><b>الإكراميات المعلّقة</b><span class="u-db muted">مراجعة الإكراميات المشبوهة وتوازن الدفتر</span></span><span class="fwd" aria-hidden="true">←</span></a>`);
      });
  MPRoutes.add("u", (a, b, next) => (b === "support" ? supportView(a) : next()));
  MPRoutes.add("me", (a, b, next) => (a === "supporting" ? supportingView() : next()));
  if (typeof Views !== "undefined" && Views.post) { const _post = Views.post; Views.post = function (pid) { const r = _post.apply(this, arguments); enhancePost(pid).catch(() => { }); return r; }; }
  if (typeof Views !== "undefined" && Views.settings) {
    MPSettings.add(function () { piOn().then((en) => { if (document.getElementById("tp-set") || !/^#\/settings/.test(location.hash)) return; (view.querySelector(".wrap") || view).insertAdjacentHTML("beforeend", `<div class="card" id="tp-set"><h3 class="tp-ch">الإكراميات والدعم</h3><div class="tp-btns"><a class="btn ghost" href="#/creator">إعدادات المبدع</a>${en ? `<a class="btn ghost" href="#/me/supporting">من أدعمهم</a><a class="btn ghost" href="#/earnings">الأرباح</a>` : ""}</div></div>`); }); });
  }
  let dq = 0;
  new MutationObserver(() => { if (dq || !on) return; dq = requestAnimationFrame(() => { dq = 0; decorate(); }); }).observe(document.getElementById("view") || document.body, { childList: true, subtree: true });
  async function refresh() { creators.clear(); on = await piOn(); document.querySelectorAll("#view .actions[data-tp]").forEach(a => { delete a.dataset.tp; if (!on) a.querySelector("[data-tip]")?.remove(); }); if (on) decorate(); return on; }
  window.MPTips = { tipSheet, refresh, celebrate, support: supportView, supporting: supportingView, creator: creatorView, earnings: earningsView, admin: adminTips, version: "2.10.0" };
  refresh().then(() => { const m = /^#\/post\/([^/?]+)/.exec(location.hash); if (m && typeof S !== "undefined") enhancePost(decodeURIComponent(m[1])).catch(() => { }); });
  if (/^#\/(support|supporting|creator|earnings|me\/supporting|admin\/tips|u\/[^/]+\/support)/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
  window.MPChunks?.load("paid").catch(() => { }); // phase 38: subscriber-only / pay-per-view posts (needs MPPi + MPTips)
})();
