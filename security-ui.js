/* =====================================================================
 * مجتمع بلس — v2.2 account & operations UI (loaded last)
 * Security center (score, 2FA with QR, backup codes, passkeys, sessions), sign-in with 2FA and
 * passkeys, data export, data saver, lazy media, route-level error recovery, admin system status
 * (services, jobs, Web Vitals, client errors, feature flags, audit-chain check).
 * ===================================================================== */
(function AccountLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const fmt = (iso) => { try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; } };
  const rel = (iso) => (typeof relTime === "function" ? relTime(iso) : fmt(iso));

  /* ---------- base64url helpers for WebAuthn ---------- */
  const b64uToBuf = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer; };
  const bufToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const passkeysSupported = () => !!(window.PublicKeyCredential && navigator.credentials);

  async function loginWithPasskey(handle) {
    const { publicKey: o } = await api("POST", "/api/auth/passkey/options", handle ? { handle } : {});
    o.challenge = b64uToBuf(o.challenge); o.allowCredentials = (o.allowCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) }));
    const cred = await navigator.credentials.get({ publicKey: o }); const r = cred.response;
    return api("POST", "/api/auth/passkey", { id: cred.id, response: { clientDataJSON: bufToB64u(r.clientDataJSON), authenticatorData: bufToB64u(r.authenticatorData), signature: bufToB64u(r.signature) } });
  }

  /* ---------- Sign-in: second factor + passkeys ---------- */
  if (typeof showAuth === "function") {
    const _sa = showAuth;
    showAuth = function (mode = "login") {
      _sa(mode);
      const go = $("#a-go"); if (!go) return;
      const err = $("#a-err");
      if (mode === "login" && passkeysSupported() && MP.flag("passkeys", true)) go.insertAdjacentHTML("afterend", `<button class="u-mt10 btn ghost block" id="pk-login">${ic("lock", "sm")} الدخول بمفتاح المرور</button>`);
      go.onclick = async () => {
        const body = { handle: $("#a-handle").value.trim(), password: $("#a-pass").value, name: $("#a-name")?.value.trim(), code: $("#a-code")?.value.trim() || undefined };
        go.disabled = true;
        try { await api("POST", mode === "register" ? "/api/auth/register" : "/api/auth/login", body); await start(); }
        catch (e) {
          if (e.code === "2fa_required" && !$("#a-code")) {
            $("#a-pass").insertAdjacentHTML("afterend", `<label class="u-db u-mt10 muted">رمز التحقق</label><input id="a-code" inputmode="numeric" autocomplete="one-time-code" dir="ltr" placeholder="123456 أو رمز احتياطي" maxlength="11">`);
            $("#a-code").focus(); err.textContent = "";
          } else err.textContent = e.message;
        } finally { go.disabled = false; }
      };
      $("#pk-login")?.addEventListener("click", async () => {
        try { await loginWithPasskey($("#a-handle").value.trim() || undefined); await start(); }
        catch (e) { err.textContent = e.name === "NotAllowedError" ? "أُلغيت العملية" : e.message; }
      });
    };
  }

  /* security notification text */
  if (Views.notifications) { const _n = Views.notifications; Views.notifications = function () { _n.apply(this, arguments); $("#view").querySelectorAll(".card.row .grow").forEach(g => { if (g.innerHTML.includes("security_login")) g.innerHTML = g.innerHTML.replace("security_login", "تسجيل دخول جديد إلى حسابك. إن لم يكن أنت، راجع مركز الأمان"); }); }; }

  /* ---------- routes ---------- */
  window.MPSec = { api, ic, online, rel, b64uToBuf, bufToB64u, passkeysSupported }; // #/security and #/status live in the lazy "secx" chunk (secx-ui.js)

  /* ---------- Settings & admin entry points ---------- */
  MPSettings.add(function () {
    const first = $("#view .wrap .card"); if (!first) return;
    first.insertAdjacentHTML("beforebegin", `
      <a href="#/security" class="u-dflex card row">${ic("lock")}<div class="grow"><b>الأمان والأجهزة</b><div class="muted">التحقق بخطوتين، مفاتيح المرور، الجلسات، تنزيل بياناتك</div></div><span class="muted">←</span></a>
      <div class="card row"><div class="grow"><b>توفير البيانات</b><div class="muted">لا تُحمّل الصور والفيديو إلا عند لمسها</div></div><input type="checkbox" id="ds" ${MP.dataSaver() ? "checked" : ""}></div>
      <div class="card row"><div class="grow"><b>إخفاء الواجهة تلقائياً في فيديوتك</b><div class="muted">تختفي الأزرار والوصف أثناء المشاهدة بعد مدة، ولمسة واحدة تعيدها</div></div><select id="cl-ah">${[0,3,5,10].map(n => `<option value="${n}"${(+MP.pref("clipsAutoHide", 0) || 0) === n ? " selected" : ""}>${n ? n + " ثوانٍ" : "إيقاف"}</option>`).join("")}</select></div>
      <div class="card row"><div class="grow"><b>الانتقال التلقائي للقطة التالية</b><div class="muted">عند انتهاء اللقطة تنتقل للتالية بدل التكرار</div></div><input type="checkbox" id="cl-an" ${MP.pref("clipsAutoNext", false) ? "checked" : ""}></div>
      <div class="card row"><div class="grow"><b>تذكير بأخذ استراحة</b><div class="muted">يوقف فيديوتك بلطف بعد مدة مشاهدة تختارها</div></div><select id="cl-br">${[0,20,40,60].map(n => `<option value="${n}"${(+MP.pref("clipsBreak", 0) || 0) === n ? " selected" : ""}>${n ? n + " دقيقة" : "إيقاف"}</option>`).join("")}</select></div>`);
    // accessible names for every control in settings (WCAG 4.1.2)
    $("#view").querySelectorAll("input:not([type=hidden]),select,textarea").forEach(el => { if (el.labels?.length || el.getAttribute("aria-label")) return; const t = el.closest(".card,.row")?.querySelector("b")?.textContent || el.placeholder; if (t) el.setAttribute("aria-label", t.trim()); });
    $("#cl-ah").onchange = (e) => { const n = +e.target.value || 0; MP.setPref("clipsAutoHide", n); window.Clips?.clean?.arm(); toast(n ? "✓ الإخفاء التلقائي مفعّل" : "الإخفاء التلقائي متوقف"); };
    $("#cl-an").onchange = (e) => { MP.setPref("clipsAutoNext", e.target.checked); toast(e.target.checked ? "✓ الانتقال التلقائي مفعّل" : "الانتقال التلقائي متوقف"); };
    $("#cl-br").onchange = (e) => { const n = +e.target.value || 0; MP.setPref("clipsBreak", n); toast(n ? "✓ تذكير الاستراحة مفعّل" : "تذكير الاستراحة متوقف"); };
    $("#ds").onchange = (e) => { MP.setPref("dataSaver", e.target.checked); toast(e.target.checked ? "✓ وضع توفير البيانات مفعّل" : "وضع توفير البيانات متوقف"); };
  });
  if (typeof V12 !== "undefined" && V12.admin) {
    const _admin = V12.admin;
    V12.admin = function () { _admin.apply(this, arguments); const w = $("#view .wrap"); if (w && online()) (w.querySelector(":scope > .page-head") || w.querySelector("h2"))?.insertAdjacentHTML("afterend", `<a href="#/status" class="u-dflex card row">${ic("chart")}<div class="grow"><b>حالة النظام</b><div class="muted">الخدمات، المهام، الأداء، الأخطاء، أعلام الميزات</div></div><span class="muted">←</span></a>`); };
  }

  /* ---------- Lazy media + data saver (Phase 5) ---------- */
  const io = "IntersectionObserver" in window ? new IntersectionObserver((en) => en.forEach(e => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } }), { rootMargin: "600px 0px" }) : null;
  function show(el) { if (el.dataset.bg) { el.style.background = el.dataset.bg; el.removeAttribute("data-bg"); el.classList.remove("lazy"); } }
  const _pi = postInner;
  postInner = function (p, opts) {
    const h = _pi(p, opts);
    return h.replace(/(<div class="media[^"]*")([^>]*?) style="background:(url\([^"]*?\)[^"]*)"/g, (m, open, mid, bg) => `${open.replace('class="media', 'class="media lazy')}${mid} data-bg="${bg}" style="background:var(--bg-2)"`);
  };
  function hydrateMedia() {
    const saver = MP.dataSaver();
    document.querySelectorAll(".media.lazy[data-bg]").forEach(el => {
      if (saver) { if (!el.querySelector(".tap-load")) el.insertAdjacentHTML("beforeend", `<button class="tap-load">${ic("eye", "sm")} اضغط لعرض الوسائط</button>`); }
      else if (io) io.observe(el); else show(el);
    });
  }
  document.addEventListener("click", (e) => { const t = e.target.closest(".tap-load"); if (!t) return; e.preventDefault(); e.stopImmediatePropagation(); const m = t.closest(".media"); t.remove(); show(m); }, true);

  /* ---------- Route-level error recovery (Phase 1) ---------- */
  const _route = route;
  route = function () {
    try { _route(); }
    catch (err) {
      MP.report(err, { where: "route" });
      $("#view").innerHTML = `<div class="wrap"><div class="card" style="text-align:center;padding:36px 20px"><div class="u-p0 auth-hero"><div class="mark" style="width:64px;height:64px">${ic("refresh")}</div></div>
        <h3 class="u-my6">تعثّرت هذه الصفحة</h3><p class="muted">أبلغنا الفريق تلقائياً. بياناتك محفوظة.</p>
        <div class="u-jcc u-g8 u-mt12 row"><a class="btn" href="#/home">الرئيسية</a><button class="btn ghost" data-ui="reload">إعادة التحميل</button></div></div></div>`;
    }
    hydrateMedia();
  };
  window.addEventListener("hashchange", () => setTimeout(hydrateMedia, 0));
  new MutationObserver(() => { if (document.querySelector(".media.lazy[data-bg]:not([data-seen])")) { document.querySelectorAll(".media.lazy[data-bg]").forEach(e => e.dataset.seen = 1); hydrateMedia(); } }).observe($("#view"), { childList: true, subtree: true });

  /* refresh flags after sign-in */
  if (typeof start === "function") { const _start = start; start = async function () { await _start.apply(this, arguments); MP.loadFlags(); }; }
  if (!window.__deferRoute) route();
})();
