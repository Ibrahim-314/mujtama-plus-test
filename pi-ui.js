/* =====================================================================
 * مجتمع بلس — Phase 36 UI: full Pi integration (lazy "pi" chunk; the small PiAdapter stays in the core).
 * • «الدخول بحساب Pi» on the sign-in screen and «ربط حساب Pi» in Settings (POST /api/pi/auth {accessToken, link}).
 * • One unified pay button: MPPi.payButton({amount, memo, purpose, refId, onDone}) → local intent
 *   (POST /api/pi/payments) → Pi.createPayment → server approve / complete (cancel on cancel/error),
 *   with loading / done / error states, and disabled with a clear Arabic note when Pi is off, the app is
 *   offline, or it is not running inside Pi Browser. MPPi.paySheet(opts) wraps it in a sheet.
 * • #/wallet: Pi account, network (testnet badge), transaction history with status chips, cursor paging.
 * • #/receipt/:id: amount, memo, status, txid + explorer link, dates, network, copy / share.
 * • #/admin/pi: daily reconciliation report and «تشغيل المطابقة الآن» (admins).
 * REST contract: /workspace/wt/BRIEF-P36.md (API contract). Styles are injected here (core CSS budget).
 * ===================================================================== */
(function PiUI() {
  if (window.MPPi) return; // loaded once (chunk + tests may both inject it)
  const A = () => (typeof PiAdapter !== "undefined" ? PiAdapter : null); // a top-level const, not a window property
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => esc(String(s ?? ""));
  const num = (n) => { const x = Number(n); return Number.isFinite(x) ? x.toLocaleString("ar-EG", { maximumFractionDigits: 7 }) : h(n); };
  const pi = (n, sign = "") => { const x = Number(n); return `<bdi dir="ltr" class="pi-n">${sign}${Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: 7 }) : h(n)} π</bdi>`; }; // amounts: Latin digits, isolated LTR
  const fmt = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso); } };
  const say = (msg) => { const r = document.getElementById("pi-say"); if (r) { r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); } };
  let uid = 0;

  const STATUS = { created: ["بانتظار الموافقة", "wait"], approved: ["قيد التنفيذ", "wait"], completed: ["مكتمل", "ok"], cancelled: ["ملغاة", "mute"], refunded: ["مستردّة", "info"], failed: ["فشلت", "bad"] };
  const PURPOSE = { transfer: "تحويل إلى عضو", tip: "دعم مبدع", donation: "تبرع", subscription: "اشتراك", boost: "ترويج", purchase: "شراء", event_ticket: "تذكرة فعالية", test: "دفعة تجريبية", refund: "استرداد", legacy: "دفعة سابقة", support: "دعم" };
  const MAX = 1000; // server default (PI max per payment)
  const NET = { testnet: "شبكة تجريبية", mainnet: "الشبكة الرئيسية" };
  const chip = (s) => { const [t, c] = STATUS[s] || [s || "—", "mute"]; return `<span class="pi-chip ${c}">${h(t)}</span>`; };
  const netBadge = (n) => n === "mainnet" ? `<span class="pi-net main">${NET.mainnet}</span>` : `<span class="pi-net test" title="Testnet — لا أموال حقيقية">Testnet · ${NET.testnet}</span>`;
  const purpose = (p) => PURPOSE[p] || p || "دفع";
  const authOn = (c) => !!(c && (c.authEnabled ?? c.enabled)); // sign-in can be on while payments (enabled) are off

  /* ---------- styles ---------- */
  if (!document.getElementById("pi-css")) document.head.insertAdjacentHTML("beforeend", `<style id="pi-css">
.pi-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pi-page{max-width:560px;margin:auto}.pi-page h2{font-size:20px;margin:6px 0 12px;display:flex;align-items:center;gap:8px}.pi-page h2:focus{outline:none}
.pi-logo{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:linear-gradient(135deg,#f6b52a,#e88a12);color:#2a1300;font:800 18px/1 system-ui,sans-serif;flex:none}
.pi-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:50px;border:0;border-radius:16px;padding:10px 18px;font:inherit;font-weight:800;font-size:16px;color:var(--white);cursor:pointer;
  background:linear-gradient(135deg,#5b2bd6,#7b3fe4 60%,#4a1fb8);box-shadow:0 6px 18px rgba(91,43,214,.32);transition:transform .15s,box-shadow .2s,opacity .2s}
.pi-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 24px rgba(91,43,214,.38)}.pi-btn:active:not(:disabled){transform:scale(.98)}
.pi-btn:focus-visible{outline:3px solid #f6b52a;outline-offset:3px}
.pi-btn:disabled{background:var(--bg-2);color:var(--text-2);box-shadow:none;cursor:not-allowed}.pi-btn:disabled .pi-logo{filter:grayscale(1);opacity:.7}
.pi-btn .pi-spin{display:none;width:18px;height:18px;border-radius:50%;border:2.5px solid rgba(255,255,255,.4);border-top-color:var(--white);animation:pispin .8s linear infinite}
.pi-pay[data-state=loading] .pi-spin{display:inline-block}.pi-pay[data-state=loading] .pi-btn:disabled{background:linear-gradient(135deg,#5b2bd6,#7b3fe4);color:#fff;opacity:.85}
.pi-pay[data-state=done] .pi-btn:disabled{background:#13603a;color:#fff}
@keyframes pispin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.pi-btn,.pi-btn .pi-spin{transition:none;animation-duration:2.4s}}
.pi-note{margin:8px 2px 0;font-size:var(--fs-sm);color:var(--muted);line-height:1.6;min-height:1em}.pi-note.err{color:#a11616;font-weight:600}.pi-note.ok{color:#13603a;font-weight:600}
[data-theme=dark] .pi-note.err{color:#ff9a9a}[data-theme=dark] .pi-note.ok{color:#7fe0aa}
.pi-sum{display:flex;align-items:center;gap:12px;margin:4px 0 14px}.pi-sum b{font-size:22px}
.pi-chip{display:inline-block;font-size:var(--fs-xs);font-weight:700;border-radius:999px;padding:2px 10px;white-space:nowrap}
.pi-chip.ok{background:#dcf5e7;color:#13603a}.pi-chip.wait{background:#fff3d6;color:#6e4300}.pi-chip.bad{background:#ffe1e1;color:#a11616}.pi-chip.info{background:#e1edff;color:#174a9c}.pi-chip.mute{background:var(--bg-2);color:var(--text-2)}
.pi-net{display:inline-block;font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 9px}.pi-net.test{background:#fff3d6;color:#6e4300;border:1px dashed #c98a1a}.pi-net.main{background:#dcf5e7;color:#13603a}
.pi-hero{border-radius:20px;padding:18px;color:var(--white);background:radial-gradient(120% 120% at 100% 0%,#7b3fe4,#3d1798);box-shadow:0 10px 28px rgba(61,23,152,.3);margin-bottom:14px}
.pi-hero .row{display:flex;align-items:center;gap:12px}.pi-hero .grow{flex:1;min-width:0}.pi-hero p{margin:10px 0 0;font-size:13px;opacity:.95;line-height:1.6}.pi-hero a{color:#fff}
.pi-tx{list-style:none;margin:0;padding:0}.pi-tx li{border-bottom:1px solid var(--line)}.pi-tx li:last-child{border:0}
.pi-txr{display:flex;align-items:center;gap:12px;padding:12px 4px;color:inherit;text-decoration:none;border-radius:12px}.pi-txr:hover{background:var(--bg-2)}
.pi-dir{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:none;background:var(--accent2);color:var(--accent-ink);font-weight:800}.pi-dir.in{background:#dcf5e7;color:#13603a}
.pi-txr .grow{flex:1;min-width:0}.pi-txr .grow b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-amt{text-align:end;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-weight:800}.pi-n{white-space:nowrap;font-variant-numeric:tabular-nums}
.pi-more{display:flex;justify-content:center;padding:12px}
.pi-rc{text-align:center;padding:22px 16px}.pi-rc .big{font-size:34px;font-weight:850;margin:10px 0 6px}.pi-rc .memo{margin:8px 0 0;color:var(--text-2)}
.pi-dl{display:grid;grid-template-columns:auto 1fr;gap:10px 14px;margin:0;text-align:start}.pi-dl dt{color:var(--muted);font-size:13.5px}.pi-dl dd{margin:0;min-width:0;overflow-wrap:anywhere;font-weight:600}
.pi-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;direction:ltr;unicode-bidi:isolate;background:var(--bg-2);padding:2px 6px;border-radius:6px}
.pi-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.pi-acts>*{flex:1 1 140px;text-align:center;text-decoration:none}
.pi-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}.pi-kpi div{background:var(--card);border-radius:14px;padding:10px;text-align:center;box-shadow:var(--sh-1)}.pi-kpi b{display:block;font-size:20px}
.pi-kpi .bad b{color:#a11616}[data-theme=dark] .pi-kpi .bad b{color:#ff9a9a}
.pi-or{display:flex;align-items:center;gap:10px;margin:14px 0 10px;color:var(--muted);font-size:var(--fs-sm)}.pi-or:before,.pi-or:after{content:"";flex:1;height:1px;background:var(--line)}
.pi-set .row{display:flex;align-items:center;gap:12px}.pi-set .grow{flex:1;min-width:0}
</style>`);

  /* ---------- availability ---------- */
  async function availability() {
    const cfg = (await A()?.config?.()) || { enabled: false };
    if (!online()) return { ok: false, cfg, reason: "مدفوعات Pi تحتاج الاتصال بالخادم." };
    if (!cfg.enabled) return { ok: false, cfg, reason: "مدفوعات Pi غير مفعّلة بعد." };
    if (!A().inPiBrowser()) return { ok: false, cfg, reason: "افتح مجتمع بلس من متصفح Pi (Pi Browser) لإتمام الدفع." };
    return { ok: true, cfg };
  }

  /* ---------- incomplete payments (queued by PiAdapter during authenticate) ---------- */
  async function flushIncomplete() {
    const res = await A().flushIncomplete().catch(() => []);
    for (const r of res) toast(r?.status === "completed" ? "اكتملت دفعة Pi سابقة" : r?.status === "pending" ? "دفعة Pi سابقة قيد التحقق" : "أُلغيت دفعة Pi سابقة لم تكتمل");
    return res;
  }
  const friendly = (e) => {
    if (e?.code === "pi_not_linked") return `اربط حساب Pi أولاً من <a href="#/settings">الإعدادات ← Pi Network</a>.`;
    if (e?.code === "pi_unverified") return "قيد التحقق: لم تؤكد شبكة Pi المعاملة بعد. ستظهر في محفظتك فور تأكيدها.";
    if (e?.status === 429) return "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة.";
    return h(e?.message || "تعذّرت عملية الدفع.");
  };

  /* ---------- payment flow ---------- */
  let authed = false;
  async function pay({ amount, memo, purpose: pp, refId = null, intent: mkIntent = null }) { // mkIntent: feature intent endpoint (tips/support) → pi intent
    const av = await availability(); if (!av.ok) throw new Error(av.reason);
    const n = Number(amount); if (!(n > 0) || n > MAX) throw new Error(`المبلغ يجب أن يكون بين 0 و${MAX} Pi.`);
    if (!(await A().init())) throw new Error("تعذّر تهيئة Pi SDK، حاول بعد قليل.");
    if (!authed) { const a = await A().authenticate(); if (!a) throw new Error("تعذّر التحقق من حساب Pi."); authed = true; } // the SDK needs the payments scope first
    await flushIncomplete(); // Pi refuses a new payment while an older one is incomplete; we are signed in here
    const intent = mkIntent ? await mkIntent() : await api("POST", "/api/pi/payments", { amount: n, memo, purpose: pp, refId });
    return new Promise((resolve, reject) => {
      let pid = null;
      const cancel = (id) => api("POST", "/api/pi/payments/cancel", (id || pid) ? { paymentId: id || pid } : { intentId: intent.id }).catch(() => { });
      const complete = async (id, txid, tries = 0) => {
        try { return await api("POST", "/api/pi/payments/complete", { paymentId: id, txid }); }
        catch (e) { if (e.code === "pi_unverified" && tries < 3) { await new Promise(r => setTimeout(r, (MPPi._retryMs ?? 2500) * (tries + 1))); return complete(id, txid, tries + 1); } throw e; }
      };
      // the intent's {amount, memo, metadata} go to Pi exactly as the server returned them (binding via metadata.intentId)
      window.Pi.createPayment({ amount: intent.amount, memo: intent.memo, metadata: intent.metadata }, {
        onReadyForServerApproval: (id) => { pid = id; api("POST", "/api/pi/payments/approve", { paymentId: id }).catch(reject); },
        onReadyForServerCompletion: (id, txid) => { pid = id; complete(id, txid).then((r) => resolve({ ...(r || {}), id: intent.id, paymentId: id, txid }), (e) => reject(Object.assign(e, { paid: true, intentId: intent.id }))); },
        onCancel: (id) => { cancel(id); reject(Object.assign(new Error("أُلغيت عملية الدفع."), { cancelled: true })); },
        onError: (err, p) => { cancel(p?.identifier); reject(new Error("تعذّرت عملية الدفع" + (err?.message ? ": " + err.message : "."))); }
      });
    });
  }

  /* ---------- the unified pay button ---------- */
  function payButton(opts = {}) {
    const id = "pi-pay-" + ++uid, label = opts.label || `ادفع ${Number(opts.amount).toLocaleString("en-US", { maximumFractionDigits: 7 })} Pi`;
    const box = document.createElement("div");
    box.className = "pi-pay"; box.dataset.state = "check";
    box.innerHTML = `<button type="button" class="pi-btn" id="${id}" aria-describedby="${id}-n" disabled><span class="pi-logo" aria-hidden="true">π</span><span class="pi-lbl">${h(label)}</span><span class="pi-spin" aria-hidden="true"></span></button>
      <p class="pi-note" id="${id}-n" role="status">جارٍ التحقق من Pi…</p>`;
    const btn = box.querySelector("button"), lbl = box.querySelector(".pi-lbl"), note = box.querySelector(".pi-note");
    const set = (state, text = "", cls = "", btnText = label) => {
      box.dataset.state = state; lbl.textContent = btnText; note.className = "pi-note " + cls; note.setAttribute("role", cls === "err" ? "alert" : "status");
      note.innerHTML = text; btn.disabled = ["check", "off", "loading", "done"].includes(state); btn.setAttribute("aria-busy", String(state === "loading"));
    };
    availability().then((av) => {
      if (!av.cfg.enabled) { box.hidden = true; return set("off", h(av.reason)); } // Pi off: no Pi UI at all
      if (!av.ok) return set("off", h(av.reason));
      set("idle", av.cfg.network !== "mainnet" ? "على الشبكة التجريبية (Testnet) — لا أموال حقيقية." : `سيُطلب منك التأكيد في محفظة Pi.`);
    });
    btn.onclick = async () => {
      if (btn.disabled) return;
      set("loading", "أكمل التأكيد في نافذة Pi…", "", "جارٍ الدفع…");
      try {
        const r = await pay(opts);
        set("done", `تمّ الدفع بنجاح. <a href="#/receipt/${encodeURIComponent(r.id)}" data-pi-rc>عرض الإيصال</a>`, "ok", "تمّ الدفع ✓");
        toast("تمّ الدفع بعملة Pi"); opts.onDone?.(r);
      } catch (e) {
        if (e.cancelled) set("idle", "أُلغيت عملية الدفع، لم يُخصم شيء.");
        else if (e.paid && e.code === "pi_unverified") set("done", friendly(e) + ` <a href="#/receipt/${encodeURIComponent(e.intentId)}" data-pi-rc>الإيصال</a>`, "", "قيد التحقق");
        else set("error", friendly(e), "err", "إعادة المحاولة");
        opts.onError?.(e);
      }
    };
    return box;
  }
  function paySheet(opts = {}) {
    return new Promise((resolve) => {
      let result = null;
      const s = sheet(`<div class="pi-page" role="dialog" aria-modal="true" aria-labelledby="pi-sh-t"><h3 id="pi-sh-t" tabindex="-1" class="u-m0 u-mt4 u-mb12">${h(opts.title || "الدفع بعملة Pi")}</h3>
        <div class="pi-sum"><span class="pi-logo" aria-hidden="true">π</span><div><b>${pi(opts.amount)}</b><div class="muted">${h(opts.memo || "")}</div></div></div>
        <div id="pi-sh-b"></div><button type="button" class="u-mt12 u-w100 btn ghost block" id="pi-sh-x">إغلاق</button></div>`);
      s.querySelector("#pi-sh-b").appendChild(payButton({ ...opts, onDone: (r) => { result = r; opts.onDone?.(r); } }));
      s.querySelector("#pi-sh-x").onclick = () => closeSheet();
      s._onclose = () => resolve(result);
      s.querySelector("#pi-sh-t").focus();
    });
  }

  /* ---------- sign in with Pi (auth screen) ---------- */
  async function authButton() {
    const go = document.getElementById("a-go"); if (!go || document.getElementById("pi-signin")) return;
    document.getElementById("pi-login")?.remove(); // the pre-phase-36 button
    const cfg = await A().config(); if (!authOn(cfg) || !document.getElementById("a-go") || document.getElementById("pi-signin")) return;
    const inPi = A().inPiBrowser();
    go.insertAdjacentHTML("afterend", `<div class="pi-auth"><div class="pi-or" aria-hidden="true"><span>أو</span></div>
      <button type="button" class="pi-btn" id="pi-signin" aria-describedby="pi-signin-n" ${inPi ? "" : "disabled"}><span class="pi-logo" aria-hidden="true">π</span><span class="pi-lbl">الدخول بحساب Pi</span><span class="pi-spin" aria-hidden="true"></span></button>
      <p class="pi-note" id="pi-signin-n" role="status">${inPi ? (cfg.network !== "mainnet" ? "الشبكة التجريبية (Testnet)" : "") : "الدخول بحساب Pi متاح عند فتح مجتمع بلس من متصفح Pi."}</p></div>`);
    const b = document.getElementById("pi-signin"), n = document.getElementById("pi-signin-n"), box = b.parentNode;
    b.onclick = async () => {
      b.disabled = true; box.dataset.state = "loading"; b.setAttribute("aria-busy", "true"); n.className = "pi-note"; n.textContent = "جارٍ التحقق من حساب Pi…";
      try {
        const auth = await A().authenticate(); if (!auth?.accessToken) throw new Error("تعذّر التحقق من حساب Pi.");
        const r = await api("POST", "/api/pi/auth", { accessToken: auth.accessToken });
        if (r.needsLink) {
          pendingLink = { accessToken: auth.accessToken, username: r.username };
          n.className = "pi-note err"; n.setAttribute("role", "alert");
          n.innerHTML = `حساب Pi <bdi>@${h(r.username)}</bdi> غير مربوط بعد. ادخل بكلمة مرور حسابك في مجتمع بلس (أو أنشئ حساباً جديداً) وسنربطه تلقائياً.
            <button type="button" class="u-mt8 u-w100 btn ghost" id="pi-new">إنشاء حساب جديد بحساب Pi</button>`;
          document.getElementById("a-handle")?.focus();
          document.getElementById("pi-new").onclick = async () => { try { await api("POST", "/api/auth/pi", { accessToken: auth.accessToken }); pendingLink = null; authed = true; await start(); await flushIncomplete(); } catch (e) { n.textContent = e.message; } };
          return;
        }
        authed = true; n.textContent = "تم الدخول"; await start(); await flushIncomplete();
      } catch (e) { n.className = "pi-note err"; n.setAttribute("role", "alert"); n.textContent = e.message; }
      finally { if (b.isConnected) { b.disabled = false; b.removeAttribute("aria-busy"); box.dataset.state = ""; } }
    };
  }

  /* after a password sign-in that followed a needsLink answer, link the Pi account with the same token */
  let pendingLink = null;
  if (typeof start === "function") {
    const _start = start;
    start = async function () {
      const r = await _start.apply(this, arguments);
      if (pendingLink) {
        const pl = pendingLink; pendingLink = null;
        try { const x = await api("POST", "/api/pi/auth", { accessToken: pl.accessToken, link: true }); link.piUsername = x.piUsername || pl.username; authed = true; toast(`رُبط حساب Pi @${link.piUsername}`); await flushIncomplete(); }
        catch (e) { toast("تعذّر ربط حساب Pi: " + e.message); }
      }
      return r;
    };
  }

  /* ---------- settings: link / unlink ---------- */
  const link = { piUsername: undefined, network: null, off: false };
  async function loadLink() {
    try { const w = await api("GET", "/api/pi/link"); Object.assign(link, { piUsername: w.piUsername || null, network: w.network, off: false }); }
    catch (e) { Object.assign(link, { piUsername: null, off: e.status === 501, err: e.status === 501 ? "" : e.message }); }
    return link;
  }
  async function settingsCard() {
    const old = document.getElementById("pi")?.closest(".card"); const host = old || document.getElementById("pi-set"); if (!host) return;
    const cfg = await A().config(); if (online() && link.piUsername === undefined && authOn(cfg)) await loadLink();
    const card = document.getElementById("pi")?.closest(".card") || document.getElementById("pi-set"); if (!card) return;
    if (!authOn(cfg) || link.off) { card.remove(); return; } // Pi sign-in off: hide the Pi UI (payments alone are gated by cfg.enabled)
    const inPi = A().inPiBrowser(), on = online();
    let body;
    if (!on) body = `<p class="pi-note" id="pi-set-n">${!online() ? "ربط Pi يحتاج الاتصال بالخادم." : "مدفوعات Pi وتسجيل الدخول بها غير مفعّلة بعد."}</p>`;
    else if (link.piUsername) body = `<p class="u-m0 u-mt10">مربوط بحساب Pi <b><bdi>@${h(link.piUsername)}</bdi></b></p>
      <div class="pi-acts">${cfg.enabled ? `<a class="btn" href="#/wallet" id="pi-set-w">المحفظة</a>` : ""}<button type="button" class="btn ghost" id="pi-unlink">إلغاء الربط</button></div>`;
    else body = `<p class="u-m0 u-mt8 u-mb12 muted">${cfg.enabled ? "اربط حسابك بحساب Pi لتدخل به وتدفع وتدعم المبدعين بعملة Pi." : "اربط حسابك بحساب Pi لتدخل به من متصفح Pi."}</p>
      <button type="button" class="pi-btn" id="pi-link" aria-describedby="pi-set-n" ${inPi ? "" : "disabled"}><span class="pi-logo" aria-hidden="true">π</span><span class="pi-lbl">ربط حساب Pi</span><span class="pi-spin" aria-hidden="true"></span></button>
      <p class="pi-note" id="pi-set-n" role="status">${inPi ? "" : "الربط متاح عند فتح مجتمع بلس من متصفح Pi."}</p>`;
    card.id = "pi-set"; card.className = "card pi-set";
    card.innerHTML = `<div class="row"><span class="pi-logo" aria-hidden="true">π</span><div class="grow"><b>Pi Network</b></div>${on ? netBadge(cfg.network) : ""}</div>${body}
      ${DB.isAdmin && on && cfg.enabled ? `<p class="u-m0 u-mt12"><a href="#/admin/pi">مطابقة مدفوعات Pi (الإدارة)</a></p>` : ""}`;
    const lb = document.getElementById("pi-link");
    if (lb) lb.onclick = async () => {
      const n = document.getElementById("pi-set-n"); lb.disabled = true; lb.setAttribute("aria-busy", "true"); lb.parentNode.dataset.state = "loading"; n.className = "pi-note"; n.textContent = "جارٍ الربط…";
      try {
        const auth = await A().authenticate(); if (!auth?.accessToken) throw new Error("تعذّر التحقق من حساب Pi.");
        const r = await api("POST", "/api/pi/auth", { accessToken: auth.accessToken, link: true });
        link.piUsername = r.piUsername || null; authed = true; toast("رُبط حساب Pi"); say("رُبط حساب Pi"); flushIncomplete(); settingsCard().then(() => (document.getElementById("pi-set-w") || document.getElementById("pi-unlink"))?.focus());
      } catch (e) { n.className = "pi-note err"; n.setAttribute("role", "alert"); n.textContent = e.message; lb.disabled = false; lb.removeAttribute("aria-busy"); }
    };
    const ub = document.getElementById("pi-unlink");
    if (ub) ub.onclick = () => {
      const s = sheet(`<div role="alertdialog" aria-modal="true" aria-labelledby="pi-ul-t" aria-describedby="pi-ul-d"><h3 id="pi-ul-t" tabindex="-1" class="u-m0 u-mt4 u-mb8">إلغاء ربط حساب Pi؟</h3>
        <p id="pi-ul-d" class="muted">لن تتمكن من الدخول بحساب <bdi>@${h(link.piUsername)}</bdi> أو الدفع به حتى تربطه من جديد. سجل معاملاتك يبقى محفوظاً.</p>
        <div class="pi-acts"><button type="button" class="u-bg-dg btn" id="pi-ul-go">إلغاء الربط</button><button type="button" class="btn ghost" id="pi-ul-x">تراجع</button></div></div>`);
      s.querySelector("#pi-ul-t").focus();
      s.querySelector("#pi-ul-x").onclick = () => { closeSheet(); ub.focus(); };
      s.querySelector("#pi-ul-go").onclick = async () => {
        try { await api("DELETE", "/api/pi/link"); link.piUsername = null; authed = false; closeSheet(); toast("أُلغي ربط حساب Pi"); await settingsCard(); document.getElementById("pi-link")?.focus(); }
        catch (e) { toast(e.message); }
      };
    };
  }

  /* ---------- #/wallet ---------- */
  const txRow = (t) => {
    const inn = t.direction === "in";
    return `<li><a class="pi-txr" href="#/receipt/${encodeURIComponent(t.id)}" aria-label="${h(`${inn ? "وارد" : "صادر"} ${t.amount} Pi، ${t.memo || purpose(t.purpose)}، ${(STATUS[t.status] || [t.status])[0]}، ${fmt(t.createdAt)}`)}">
      <span class="pi-dir ${inn ? "in" : "out"}" aria-hidden="true">${inn ? "↓" : "↑"}</span>
      <span class="grow"><b>${h(t.memo || purpose(t.purpose))}</b><span class="muted">${h(purpose(t.purpose))} · ${h(fmt(t.createdAt))}</span></span>
      <span class="pi-amt">${pi(t.amount, inn ? "+" : "−")}${chip(t.status)}</span></a></li>`;
  };
  const wq = (cursor) => { const q = new URLSearchParams({ limit: "20" }); if (view._piStatus) q.set("status", view._piStatus); if (cursor) q.set("cursor", cursor); return "/api/pi/wallet?" + q; };
  async function walletView() {
    const v = view, token = (v._piw = {});
    v.innerHTML = `<div class="wrap pi-page">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "محفظة Pi", icon: "wallet", id: "pi-h" })}<div class="list pi-links">${UI.li({ href: "#/statement", icon: "copy", title: "كشف الحساب والفواتير" })}${UI.li({ href: "#/annual", icon: "chart", title: "التقرير السنوي" })}</div><div class="skel"></div><div id="pi-say" class="pi-sr" aria-live="polite"></div></div>`;
    document.getElementById("pi-h").focus();
    const w = v.querySelector(".wrap");
    if (!online()) { w.querySelector(".skel").outerHTML = `<div class="empty">المحفظة تحتاج الاتصال بالخادم.</div>`; return; }
    // v2.51: while Pi payments are off, show the friendly "not active yet" state without calling the wallet API (it answers 501)
    const pc = await A()?.config?.().catch(() => null);
    if (v._piw !== token) return;
    if (pc && pc.enabled === false) { w.querySelector(".skel").outerHTML = UI.empty({ title: "مدفوعات Pi غير مفعّلة بعد.", text: "ستظهر معاملاتك هنا فور تفعيلها." }); return; }
    let d; try { d = await api("GET", wq()); } catch (e) {
      if (v._piw !== token) return;
      w.querySelector(".skel").outerHTML = e.status === 501 ? UI.empty({ title: "مدفوعات Pi غير مفعّلة بعد.", text: "ستظهر معاملاتك هنا فور تفعيلها." }) : `<div class="notice danger" role="status">${h(e.message)}</div>`; return;
    }
    if (v._piw !== token) return;
    link.piUsername = d.piUsername || null;
    w.querySelector(".skel").outerHTML = `<section class="pi-hero" aria-labelledby="pi-acct"><div class="row"><span class="pi-logo" aria-hidden="true">π</span><div class="grow"><b id="pi-acct">${d.piUsername ? `<bdi>@${h(d.piUsername)}</bdi>` : "لا يوجد حساب Pi مربوط"}</b></div>${netBadge(d.network)}</div>
        ${d.balanceNote ? `<p>${h(d.balanceNote)}</p>` : ""}${d.piUsername ? "" : `<p><a href="#/settings">اربط حساب Pi من الإعدادات</a></p>`}</section>
      <div style="display:flex;align-items:center;gap:8px;margin:6px 4px 8px"><h3 class="u-m0 u-t-md u-f1" id="pi-txh">المعاملات</h3>
        <label for="pi-st" class="pi-sr">تصفية حسب الحالة</label><select id="pi-st" class="u-wa">${[["", "كل الحالات"], ...Object.entries(STATUS).map(([k, x]) => [k, x[0]])].map(([k, t]) => `<option value="${k}" ${(v._piStatus || "") === k ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <ul class="pi-tx card" id="pi-tx" aria-labelledby="pi-txh" aria-busy="false"></ul><div class="pi-more" id="pi-more"></div>`;
    const list = document.getElementById("pi-tx"), more = document.getElementById("pi-more");
    let cursor = d.nextCursor || null, busy = false, io = null;
    const add = (tx) => list.insertAdjacentHTML("beforeend", tx.map(txRow).join(""));
    const tail = () => {
      if (!list.children.length) list.outerHTML = `<div class="empty card" id="pi-tx">لا معاملات بعد. عند الدفع أو دعم مبدع بعملة Pi ستظهر هنا.</div>`;
      more.innerHTML = cursor ? `<button type="button" class="btn ghost" id="pi-more-b">عرض المزيد</button>` : (list.children.length > 8 ? `<span class="muted">نهاية السجل</span>` : "");
      const b = document.getElementById("pi-more-b"); if (b) b.onclick = () => next(true);
      if (!cursor) io?.disconnect();
    };
    async function next(byButton) {
      if (busy || !cursor || v._piw !== token) return; busy = true; list.setAttribute("aria-busy", "true");
      const b = document.getElementById("pi-more-b"); if (b) { b.disabled = true; b.textContent = "جارٍ التحميل…"; }
      try {
        const r = await api("GET", wq(cursor)); if (v._piw !== token) return;
        const first = list.children.length; add(r.tx || []); cursor = r.nextCursor || null; say(`حُمّلت ${(r.tx || []).length} معاملة أخرى`);
        if (byButton) list.children[first]?.querySelector("a")?.focus();
      } catch (e) { toast(e.message); } finally { busy = false; list.setAttribute("aria-busy", "false"); tail(); }
    }
    document.getElementById("pi-st").onchange = (e) => { v._piStatus = e.target.value || null; walletView().then(() => document.getElementById("pi-st")?.focus()); };
    add(d.tx || []); tail();
    if (cursor && "IntersectionObserver" in window) { io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) next(false); }, { rootMargin: "300px" }); io.observe(more); }
  }

  /* ---------- #/receipt/:id ---------- */
  async function copy(text, done) { try { await navigator.clipboard.writeText(text); toast(done); } catch { toast("تعذّر النسخ"); } }
  async function receiptView(rid) {
    const v = view, token = (v._piw = {});
    v.innerHTML = `<div class="wrap pi-page">${UI.pageHead({ back: ["#/wallet", "المحفظة"], title: "إيصال الدفع", id: "pi-h" })}<div class="skel"></div></div>`;
    document.getElementById("pi-h").focus();
    const w = v.querySelector(".wrap");
    if (!online()) { w.querySelector(".skel").outerHTML = `<div class="empty">الإيصال يحتاج الاتصال بالخادم.</div>`; return; }
    const pc = await A()?.config?.().catch(() => null); if (v._piw !== token) return; // v2.51: no 501 request while Pi payments are off
    if (pc && pc.enabled === false) { w.querySelector(".skel").outerHTML = `<div class="empty" role="status">مدفوعات Pi غير مفعّلة بعد.</div>`; return; }
    let r; try { r = await api("GET", "/api/pi/receipts/" + encodeURIComponent(rid)); } catch (e) {
      if (v._piw !== token) return;
      w.querySelector(".skel").outerHTML = `<div class="empty" role="status">${e.status === 404 ? "لم يُعثر على هذا الإيصال." : e.status === 501 ? "مدفوعات Pi غير مفعّلة بعد." : h(e.message)}</div>`; return;
    }
    if (v._piw !== token) return;
    const [st] = STATUS[r.status] || [r.status];
    const lines = [`إيصال دفع — مجتمع بلس`, `المبلغ: ${r.amount} Pi`, `الحالة: ${st}`, r.memo && `الوصف: ${r.memo}`, `الشبكة: ${NET[r.network] || r.network}`, r.txid && `رقم المعاملة: ${r.txid}`, `التاريخ: ${fmt(r.completedAt || r.createdAt)}`, `رقم الإيصال: ${r.id}`].filter(Boolean).join("\n");
    w.querySelector(".skel").outerHTML = `<section class="card pi-rc" aria-labelledby="pi-amt-l">
        <span class="pi-logo" aria-hidden="true" style="width:52px;height:52px;font-size:28px;border-radius:16px">π</span>
        <div class="big" id="pi-amt-l"><span class="pi-sr">المبلغ </span>${pi(r.amount)}</div>${chip(r.status)}
        ${r.memo ? `<p class="memo">${h(r.memo)}</p>` : ""}</section>
      <section class="card" aria-label="تفاصيل الإيصال"><dl class="pi-dl">
        <dt>الحالة</dt><dd>${h(st)}</dd>
        <dt>الغرض</dt><dd>${h(purpose(r.purpose))}</dd>
        ${r.piUsername ? `<dt>حساب Pi</dt><dd><bdi>@${h(r.piUsername)}</bdi></dd>` : ""}
        <dt>الشبكة</dt><dd>${netBadge(r.network)}</dd>
        <dt>أُنشئ</dt><dd>${h(fmt(r.createdAt))}</dd>
        <dt>اكتمل</dt><dd>${r.completedAt ? h(fmt(r.completedAt)) : "—"}</dd>
        <dt>رقم المعاملة</dt><dd>${r.txid ? `<code class="pi-code" id="pi-txid">${h(r.txid)}</code> <button type="button" class="btn ghost" id="pi-cp-tx" aria-label="نسخ رقم المعاملة" style="padding:3px 10px;font-size:12.5px">${ic("copy", "sm")} نسخ</button>` : `<span class="muted">لم تُسجَّل على البلوكتشين بعد</span>`}</dd>
        <dt>رقم الإيصال</dt><dd><code class="pi-code">${h(r.id)}</code></dd></dl>
        <div class="pi-acts">${r.txid && r.explorerUrl ? `<a class="btn" id="pi-exp" href="${h(r.explorerUrl)}" target="_blank" rel="noopener noreferrer">${ic("eye", "sm")} عرض في مستكشف Pi<span class="pi-sr"> (يفتح في نافذة جديدة)</span></a>` : ""}
          <button type="button" class="btn ghost" id="pi-share">${ic("share", "sm")} مشاركة</button><button type="button" class="btn ghost" id="pi-copy">${ic("copy", "sm")} نسخ الإيصال</button></div></section>`;
    document.getElementById("pi-cp-tx")?.addEventListener("click", () => copy(r.txid, "نُسخ رقم المعاملة"));
    document.getElementById("pi-copy").onclick = () => copy(lines, "نُسخ الإيصال");
    document.getElementById("pi-share").onclick = async () => {
      if (navigator.share) { try { await navigator.share({ title: "إيصال دفع Pi", text: lines }); return; } catch (e) { if (e?.name === "AbortError") return; } }
      copy(lines, "نُسخ الإيصال للمشاركة");
    };
  }

  /* ---------- #/admin/pi ---------- */
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  function recon(rep) {
    const mm = rep.mismatched || [];
    return `<div class="pi-kpi" role="group" aria-label="ملخص المطابقة"><div><b>${num(rep.checked || 0)}</b>فُحصت</div><div><b>${num(rep.matched || 0)}</b>متطابقة</div><div class="${mm.length ? "bad" : ""}"><b>${num(mm.length)}</b>غير متطابقة</div><div><b>${num(rep.fixed || 0)}</b>أُصلحت</div></div>
      <h3 style="margin:14px 4px 8px;font-size:15px">الفروقات</h3>
      ${mm.length ? `<ul class="pi-tx card">${mm.map((m) => { const x = typeof m === "object" && m ? m : { id: m }; return `<li style="padding:10px 4px"><div class="u-dflex u-g8 u-aic u-fww"><code class="pi-code">${h(x.paymentId || x.id || "—")}</code>${x.status ? chip(x.status) : ""}${x.fixed ? `<span class="pi-chip ok">أُصلحت</span>` : ""}</div>
        <div class="u-mt4 muted">${h(x.reason || x.issue || x.note || "")}${x.local !== undefined || x.remote !== undefined ? ` · المحلي: ${h(typeof x.local === "object" ? JSON.stringify(x.local) : x.local)} · Pi: ${h(typeof x.remote === "object" ? JSON.stringify(x.remote) : x.remote)}` : ""}${x.amount !== undefined ? ` · ${pi(x.amount)}` : ""}</div></li>`; }).join("")}</ul>` : `<div class="empty card">لا فروقات في هذا اليوم ✓</div>`}`;
  }
  async function adminView() {
    const v = view, token = (v._piw = {});
    if (!DB.isAdmin) { v.innerHTML = `<div class="wrap pi-page"><h2 id="pi-h" tabindex="-1">مطابقة مدفوعات Pi</h2><div class="empty">هذه الصفحة لفريق الإدارة.</div></div>`; return; }
    v.innerHTML = `<div class="wrap pi-page"><a href="#/admin" class="muted">→ الإدارة</a><h2 id="pi-h" tabindex="-1"><span class="pi-logo" aria-hidden="true">π</span> مطابقة مدفوعات Pi</h2>
      <div class="card"><label for="pi-date" class="muted">اليوم</label><div class="u-dflex u-g8 u-mt6"><input type="date" id="pi-date" dir="ltr" value="${today()}" max="${today()}" class="u-f1"><button type="button" class="btn ghost" id="pi-load">عرض</button></div>
      <button type="button" class="u-mt10 u-w100 btn" id="pi-run">${ic("refresh", "sm")} تشغيل المطابقة الآن</button><p class="pi-note" id="pi-run-n" role="status"></p></div>
      <div id="pi-rep" aria-live="polite"><div class="skel"></div></div></div>`;
    document.getElementById("pi-h").focus();
    const out = document.getElementById("pi-rep"), n = document.getElementById("pi-run-n");
    const load = async () => {
      const date = document.getElementById("pi-date").value || today(); out.setAttribute("aria-busy", "true");
      const pc = await A()?.config?.().catch(() => null); // v2.51: no 501 request while Pi payments are off
      if (pc && pc.enabled === false) { if (v._piw === token) out.innerHTML = `<div class="empty" role="status">مدفوعات Pi غير مفعّلة بعد.</div>`; out.setAttribute("aria-busy", "false"); return; }
      try { const rep = await api("GET", "/api/admin/pi/reconciliation?date=" + encodeURIComponent(date)); if (v._piw === token) out.innerHTML = recon(rep); }
      catch (e) { if (v._piw === token) out.innerHTML = `<div class="empty" role="status">${e.status === 501 ? "مدفوعات Pi غير مفعّلة بعد." : h(e.message)}</div>`; }
      finally { out.setAttribute("aria-busy", "false"); }
    };
    document.getElementById("pi-load").onclick = load;
    document.getElementById("pi-date").onchange = load;
    document.getElementById("pi-run").onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; n.className = "pi-note"; n.textContent = "جارٍ المطابقة مع Pi…";
      try { const rep = await api("POST", "/api/admin/pi/reconcile"); n.className = "pi-note ok"; n.textContent = `اكتملت المطابقة: فُحصت ${num(rep.checked || 0)}، أُصلحت ${num(rep.fixed || 0)}.`; if (rep && rep.checked !== undefined) { if (rep.date) document.getElementById("pi-date").value = rep.date; out.innerHTML = recon(rep); } else load(); }
      catch (e) { n.className = "pi-note err"; n.setAttribute("role", "alert"); n.textContent = e.message; }
      finally { b.disabled = false; }
    };
    load();
  }

  /* ---------- wiring: routes, auth screen, settings, admin ---------- */
  MPRoutes.extend((a, b, prev) => {
    return { wallet: () => walletView(), receipt: () => receiptView(a) };
  });
  MPRoutes.add("admin", (a, b, next) => { if (DB.isAdmin && !document.getElementById("ops-js")) document.head.appendChild(Object.assign(document.createElement("script"), { id: "ops-js", src: "/ops-ui.js" })); /* phase 49: admin-only ops UI, served by the API (not in core) */ if (a === "pi") return adminView(); next(); if (DB.isAdmin && !a && !document.getElementById("fn-adm")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-dflex u-aic u-g12 u-ci u-tdn u-mh44 card" id="fn-adm" href="#/admin/finance"><span aria-hidden="true"><svg class=ei aria-hidden=true><use href=#i-receipt /></svg></span><span class="u-f1"><b>التقارير المالية والمطابقة</b><span class="u-db muted">السجل مقابل مدفوعات Pi، التقارير السنوية</span></span><span class="fwd" aria-hidden="true">←</span></a>`); if (DB.isAdmin && !a && !document.getElementById("bz-adm")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-dflex u-aic u-g12 u-ci u-tdn u-mh44 card" id="bz-adm" href="#/admin/biz"><span aria-hidden="true"><svg class=ei aria-hidden=true><use href=#i-tag /></svg></span><span class="u-f1"><b>طلبات إدارة الأنشطة التجارية</b><span class="u-db muted">توثيق ملكية الأنشطة في دليل الأعمال</span></span><span class="fwd" aria-hidden="true">←</span></a>`); /* phase 67 */ if (DB.isAdmin && A()?.cfg?.enabled && !document.getElementById("pi-adm")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-dflex u-aic u-g12 u-ci u-tdn card" id="pi-adm" href="#/admin/pi"><span class="pi-logo" aria-hidden="true">π</span><span class="u-f1"><b>مطابقة مدفوعات Pi</b><span class="u-db muted">تقرير يومي ومطابقة فورية مع Pi</span></span><span class="fwd" aria-hidden="true">←</span></a>`); });
  if (typeof showAuth === "function") { const _sa = showAuth; showAuth = function () { const r = _sa.apply(this, arguments); authButton(); return r; }; }
  if (typeof Views !== "undefined" && Views.settings) {
    MPSettings.add(function () { settingsCard(); });
  }
  window.MPPi = { payButton, paySheet, pay, availability, wallet: walletView, receipt: receiptView, admin: adminView, linkState: () => ({ ...link }),
    refresh() { if (A()) { A().cfg = null; A().ready = false; } link.piUsername = undefined; authed = false; }, version: "2.13.0" };
  if (document.getElementById("a-go")) authButton();
  if (/^#\/(wallet|receipt|admin|settings)/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
