/* =====================================================================
 * مجتمع بلس — v2.149.13 «بوابة Pi»: the signed-out screen (lazy "gate" chunk + gate.css), design C «القصة» approved by the owner.
 * • Three swipeable intro slides (community · messages · MJT rewards) with dots; the Pi button is docked under every slide;
 *   at >= 1024px the slides stand side by side as cards. Native scroll-snap, so the swipe follows RTL/LTR; arrow keys,
 *   Home/End on the focused track; dots are 44px buttons; reduced motion = no smooth scroll.
 * • Pi only: «الدخول بحساب Pi» runs the existing Pi sign-in (MPPi.signIn in the pi chunk: progress states, errors, one-tap
 *   account). Outside Pi Browser it becomes «افتح في متصفح Pi» + copy link (+ QR at >= 1024px) for /api/pi/config piUrl.
 *   «شبكة تجريبية» only on the Pi testnet; «دخول تجريبي» only when the server enables demo login (test copies).
 * • Owner recovery: the original username/password form (sign-in + registration) is kept, hidden — a 3-second press on the
 *   logo or #/login?recover=1 (keyboard / screen readers) opens it in a sheet. Server routes are unchanged.
 * After every render it fires `mp:auth` {mode}: the 2FA/passkey (security-ui) and birth-date (minors) layers attach to the form.
 * ===================================================================== */
(function Gate() {
  if (window.MPGate) return;
  const h = (s) => esc(String(s ?? ""));
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const svg = (p, c = "ic") => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const I = {
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A4.6 4.6 0 0 1 21 18.6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
    spark: '<path d="M12 2c.6 4.8 2.2 7.4 10 10-7.8 2.6-9.4 5.2-10 10-.6-4.8-2.2-7.4-10-10 7.8-2.6 9.4-5.2 10-10Z" fill="currentColor" stroke="none"/>'
  };
  const authOn = (c) => !!(c && (c.authEnabled ?? c.enabled));
  /* inside Pi Browser (UA), the Pi Developers sandbox frame, or the official *.pinet.com frame. Not PiAdapter.host(): index.html
   * loads the Pi SDK in every browser, so window.Pi alone does not mean Pi Browser */
  const inPi = (c) => { const A = PiAdapter; return A.inPiBrowser() || !!A.useSandbox?.(c) || /(^|\.)pinet\.com$/.test(A.parent?.() || ""); };
  /* v2.149.11 kept: the Pi sign-in stays usable whenever the Pi SDK is present, even if this browser was not recognised as Pi Browser
   * (an unusual UA, an unframed open). Outside the detected Pi Browser it is the quiet «داخل متصفح Pi؟» button under the open link. */
  const usable = (c) => inPi(c) || !!PiAdapter.host?.();
  const tryPi = (c) => authOn(c) ? `<div class="pi-auth gt-try"><button type="button" class="gt-demo" id="gt-pi-try" aria-describedby="pi-signin-n" ${usable(c) ? "" : "disabled"}>داخل متصفح Pi؟ ادخل بحساب Pi</button></div>` : "";
  const recoverAsked = () => /^#\/login\?(?:.*&)?recover=1\b/.test(location.hash);

  const SLIDES = () => [
    `<div class="gt-art" aria-hidden="true"><div class="gt-ring"></div><div class="gt-ring r2"></div><span class="gt-center"></span>
      <span class="gt-chip c1">#تقنية</span><span class="gt-chip c2">#قراءة</span><span class="gt-chip c3">#رياضة</span><span class="gt-chip c4">#طبخ</span>
      ${(document.documentElement.lang === "en" ? ["S", "M", "N"] : ["س", "م", "ن"]).map((l, i) => `<span class="gt-av a${i + 1}" data-noi18n>${l}</span>`).join("")}</div>
     <h2>مجتمعك في مكان واحد</h2><p><span class="gt-nw">انضم لناس يشاركونك اهتمامك،</span> <span class="gt-nw">بدخول واحد من Pi.</span></p>`,
    `<div class="gt-art chatart" aria-hidden="true"><div class="gt-chat"><div class="hd"><span class="g">${svg(I.users)}</span><div><b>نادي القراءة</b><small>١٢ عضوًا</small></div></div>
      <div class="gt-b in"><small>سارة</small>متى لقاء هذا الأسبوع؟</div><div class="gt-b me">الخميس ٨ مساءً</div><div class="gt-b in"><small>منى</small>تمام، أجهّز الكتاب</div>
      <div class="gt-typing"><i></i><i></i><i></i></div></div></div>
     <h2>تواصل بلا حواجز</h2><p>رسائل خاصة ومجموعات مع من يهمّك.</p>`,
    // +1 MJT = the server's daily sign-in reward (mining.js DEFAULTS.checkin = 1 MJT, once per UTC day); v2.164: no «له قيمة» wording
    `<div class="gt-art" aria-hidden="true"><div class="gt-coin"><span>MJT</span></div>
      ${svg(I.spark, "gt-spark s1")}${svg(I.spark, "gt-spark s2")}${svg(I.spark, "gt-spark s3")}
      <span class="gt-pill p1"><em dir="ltr">+1 MJT</em> دخول يومي</span><span class="gt-pill p2">${svg(I.trophy, "ic")}<span>تحدّي الأسبوع</span></span></div>
     <h2>ساهم واكسب مكافآت</h2><p>اكسب «مجتمع كوين» من مساهماتك المفيدة ودخولك اليومي — رصيد مكافآت داخل التطبيق.</p>`
  ];

  function dock(cfg, demo) {
    let main;
    if (!authOn(cfg)) main = `<p class="gt-off" role="status">الدخول بحساب Pi غير متاح الآن.</p><button type="button" class="btn block" data-gt-rec>الدخول بكلمة المرور</button>`;
    else if (inPi(cfg)) main = `<div class="pi-auth"><button type="button" class="pi-btn" id="pi-signin" aria-describedby="pi-signin-n"><span class="pi-logo" aria-hidden="true">π</span><span class="pi-lbl">الدخول بحساب Pi</span><span class="pi-spin" aria-hidden="true"></span></button>
      <p class="pi-note" id="pi-signin-n" role="status">${svg(I.lock)}<span>بدون كلمة مرور، يكفي حسابك في Pi</span></p></div>`;
    else if (cfg.piUrl) {
      const host = cfg.piUrl.replace(/^https:\/\//, "");
      main = `<div class="gt-out"><a class="pi-btn" id="gt-open" href="${h(cfg.piUrl)}" rel="noopener" aria-describedby="pi-signin-n"><span class="pi-logo" aria-hidden="true">π</span><span>افتح في متصفح Pi</span></a>
        <p class="pi-note" id="pi-signin-n">الدخول بحساب Pi فقط، ويعمل داخل متصفح Pi.</p>
        <div class="gt-url"><code>${h(host)}</code><button type="button" class="gt-copy" id="gt-copy">${svg(I.copy)}<span>نسخ الرابط</span></button></div>
        <div class="gt-qr"><span class="q" id="gt-qr" role="img" aria-label="رمز QR لرابط التطبيق في Pi"></span><p><b>امسح الرمز بجوالك</b>افتح متصفح Pi وامسح الرمز لتدخل مباشرة.</p></div></div${tryPi(cfg)}</div>`;
    } else main = `<div class="gt-out"><p class="pi-note" id="pi-signin-n">افتح مجتمع بلس من متصفح Pi لتدخل بحساب Pi.</p>${tryPi(cfg)}</div>`;
    return main + (demo ? `<button type="button" class="gt-demo" id="demo-login">دخول تجريبي<small>(للتجربة فقط)</small></button>` : "")
      + `<p class="gt-err" id="gt-err" role="alert"></p><p class="gt-ver">الإصدار <bdi>${h(verLabel(Remote.health?.version || APP_VERSION))}</bdi></p>`;
  }
  /* the original form, unchanged ids (a-name, a-handle, a-pass, a-go, a-err): tests, password managers and the 2FA layer rely on them */
  const form = (mode) => `<div class="u-my8 seg"><button type="button" data-m="login" class="${mode === "login" ? "on" : ""}">تسجيل الدخول</button><button type="button" data-m="register" class="${mode === "register" ? "on" : ""}">حساب جديد</button></div>
    <div class="card">
      ${mode === "register" ? `<label class="muted" for="a-name">الاسم</label><input id="a-name" autocomplete="name" placeholder="اسمك كما يظهر للناس">` : ""}
      <label class="u-db u-mt8 muted" for="a-handle">اسم المستخدم</label><input id="a-handle" dir="ltr" autocomplete="username" placeholder="username">
      <label class="u-db u-mt8 muted" for="a-pass">كلمة المرور</label><input id="a-pass" type="password" dir="ltr" autocomplete="${mode === "register" ? "new-password" : "current-password"}" placeholder="8 أحرف على الأقل">
      <button type="button" class="u-mt14 btn block" id="a-go">${mode === "register" ? "إنشاء الحساب" : "دخول"}</button>
      <p class="u-c-dg u-mh1e muted" id="a-err" role="alert"></p></div>`;

  function render(mode = "login") {
    const cfg = PiAdapter.cfg || { enabled: false }, demo = !!Remote.health?.demo;
    const rec = mode === "register" || !!view._authRecover || recoverAsked() || !!window.MP_PASSWORD_FORM;
    const slides = SLIDES();
    view.innerHTML = `<div class="gt" id="gate"><div class="gt-main" id="gt-main">
      <div class="gt-top"><div class="gt-brand"><span class="gt-mark" id="gt-logo" role="img" aria-label="شعار مجتمع بلس"></span><span>مجتمع بلس</span></div>
        <div class="gt-tools">${authOn(cfg) && cfg.network !== "mainnet" ? `<span class="gt-net">شبكة تجريبية</span>` : ""}<button type="button" class="gt-lang" id="ob-lang" aria-label="اللغة" title="اللغة">${svg(I.globe)}</button></div></div>
      <section class="gt-car" aria-roledescription="شرائح" aria-label="تعرّف على مجتمع بلس">
        <div class="gt-track" id="gt-track" tabindex="0" aria-label="اسحب أو استخدم الأسهم للتنقل">${slides.map((s, i) => `<div class="gt-slide" role="group" aria-roledescription="شريحة" aria-label="${i + 1} من ${slides.length}">${s}</div>`).join("")}</div>
        <div class="gt-dots" role="group" aria-label="الشرائح">${slides.map((_, num) => `<button type="button" data-gt-dot="${num}" aria-label="الشريحة ${num + 1}" aria-current="${num === 0}"><i></i></button>`).join("")}</div>
      </section>
      <div class="gt-dock" id="gt-dock">${dock(cfg, demo)}</div></div>
      <div class="gt-rec" id="gt-rec" role="dialog" aria-modal="true" aria-labelledby="gt-rec-h" hidden><div class="panel">
        <div class="hd"><h2 id="gt-rec-h" tabindex="-1">دخول المالك</h2><button type="button" id="gt-rec-x" aria-label="إغلاق">${svg(I.x)}</button></div>
        <p class="lead">مدخل احتياطي لصاحب الحساب: اسم المستخدم وكلمة المرور.</p>${form(mode)}</div></div></div>`;
    /* a saved English screen is translated before its first paint, not left to the i18n observer's timing */
    const L = document.documentElement.lang; if (L && L !== "ar" && window.MPI18n?.apply) MPI18n.apply(view, L);
    wire(mode, cfg);
    if (rec) openRec(false); else if (cfg.piUrl && !inPi(cfg) && matchMedia("(min-width:1024px)").matches) qr(cfg.piUrl);
    document.dispatchEvent(new CustomEvent("mp:auth", { detail: { mode } }));
  }

  /* ---------- recovery sheet ---------- */
  function openRec(focus = true) {
    const r = document.getElementById("gt-rec"); if (!r) return;
    view._authRecover = true; r.hidden = false; document.getElementById("gt-main")?.setAttribute("inert", "");
    if (focus) (document.getElementById("a-handle") || document.getElementById("gt-rec-h"))?.focus();
  }
  function closeRec() {
    const r = document.getElementById("gt-rec"); if (!r) return;
    view._authRecover = false; r.hidden = true; document.getElementById("gt-main")?.removeAttribute("inert");
    if (recoverAsked()) history.replaceState(null, "", location.pathname + location.search + "#/login");
    if (view._authMode === "register") return showAuth("login"); // registration lives in the sheet only
    (document.getElementById("pi-signin") || document.getElementById("gt-open") || document.getElementById("gt-track"))?.focus();
  }

  function wire(mode, cfg) {
    const $i = (id) => document.getElementById(id);
    /* owner recovery: press and hold the logo for 3 seconds */
    const logo = $i("gt-logo"); let t = 0;
    const stop = () => { clearTimeout(t); t = 0; };
    logo.addEventListener("pointerdown", () => { stop(); t = setTimeout(() => { t = 0; openRec(); }, 3000); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((e) => logo.addEventListener(e, stop));
    logo.addEventListener("contextmenu", (e) => e.preventDefault());
    $i("gt-rec-x").onclick = closeRec;
    $i("gt-rec").addEventListener("click", (e) => { if (e.target.id === "gt-rec") closeRec(); });
    $i("gt-rec").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeRec(); } });
    view.querySelectorAll("[data-gt-rec]").forEach((b) => (b.onclick = () => openRec()));
    view.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { view._authRecover = true; showAuth(b.dataset.m); document.getElementById("a-handle")?.focus(); }));
    $i("a-go").onclick = async () => {
      const body = { handle: $i("a-handle").value.trim(), password: $i("a-pass").value, name: $i("a-name")?.value.trim() };
      try { await Remote.api("POST", mode === "register" ? "/api/auth/register" : "/api/auth/login", body); await start(); }
      catch (e) { $i("a-err").textContent = e.message; }
    };
    /* Pi sign-in: the existing flow of the pi chunk */
    const piGo = (pb) => async () => {
      const n = $i("pi-signin-n");
      if (!window.MPPi?.signIn) await window.MPChunks?.load("pi").catch(() => { });
      if (!window.MPPi?.signIn) { n.className = "pi-note err"; n.setAttribute("role", "alert"); n.textContent = "تعذّر تحميل Pi، حاول مرة أخرى."; return; }
      MPPi.signIn(pb, n, { onNeedsLink: () => openRec() });
    };
    const pb = $i("pi-signin"); if (pb) pb.onclick = piGo(pb);
    const tb = $i("gt-pi-try");
    if (tb) {
      tb.onclick = piGo(tb);
      // the async Pi SDK arrived after this screen: the button becomes usable then
      if (tb.disabled) PiAdapter.sdk?.().then(() => { if (tb.isConnected && usable(cfg) && tb.parentNode.dataset.state !== "loading") tb.disabled = false; }, () => { });
    }
    const cp = $i("gt-copy");
    if (cp) cp.onclick = async () => {
      const l = cp.querySelector("span"), done = () => { l.textContent = "تم النسخ"; setTimeout(() => { if (l.isConnected) l.textContent = "نسخ الرابط"; }, 1600); };
      try { await navigator.clipboard.writeText(cfg.piUrl); done(); }
      catch { const r = document.createRange(); r.selectNodeContents(cp.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    };
    const dm = $i("demo-login");
    if (dm) dm.onclick = async () => {
      dm.disabled = true;
      try { await Remote.api("POST", "/api/auth/demo", {}); await start(); }
      catch (e) { $i("gt-err").textContent = e.message; dm.disabled = false; }
    };
    carousel();
  }

  /* ---------- carousel: native scroll-snap (RTL/LTR), dots, keys ----------
   * The slide index and scroll targets come from the slides' on-screen positions against the track, so they are the same in RTL
   * and LTR whatever sign scrollLeft takes. While a smooth scroll runs, keys/dots step from its target (`want`), not from the half-way
   * position, so quick presses are not lost and the dots do not flicker back; a swipe repaints when the scroll settles. */
  function carousel() {
    const tr = document.getElementById("gt-track"), dots = [...view.querySelectorAll("[data-gt-dot]")], sl = [...tr.children];
    const n = sl.length;
    let want = -1, idle = 0;
    const off = (s) => s.getBoundingClientRect().left - tr.getBoundingClientRect().left; // 0 = this slide is in view
    const at = () => { let b = 0, d = Infinity; sl.forEach((s, k) => { const e = Math.abs(off(s)); if (e < d) { d = e; b = k; } }); return b; };
    const cur = () => (want >= 0 ? want : at());
    const paint = (i) => dots.forEach((d, k) => d.setAttribute("aria-current", String(k === i)));
    const go = (i) => {
      i = Math.max(0, Math.min(n - 1, i)); paint(i);
      if (Math.abs(off(sl[i])) < 1) { want = -1; return; } // already there: no scroll, so no scrollend to wait for
      want = i;
      tr.scrollTo({ left: tr.scrollLeft + off(sl[i]), behavior: reduce() ? "auto" : "smooth" });
    };
    const settle = () => { clearTimeout(idle); idle = 0; want = -1; paint(at()); };
    /* scrollend where supported; elsewhere the scroll is taken as settled 120 ms after its last event */
    if ("onscrollend" in tr) tr.addEventListener("scrollend", settle);
    tr.addEventListener("scroll", () => { if (want < 0) paint(at()); if (!("onscrollend" in tr)) { clearTimeout(idle); idle = setTimeout(settle, 120); } }, { passive: true });
    dots.forEach((d) => (d.onclick = () => go(+d.dataset.gtDot)));
    tr.addEventListener("keydown", (e) => {
      const rtl = getComputedStyle(tr).direction === "rtl", next = rtl ? "ArrowLeft" : "ArrowRight", prev = rtl ? "ArrowRight" : "ArrowLeft";
      const k = { [next]: cur() + 1, [prev]: cur() - 1, Home: 0, End: n - 1 }[e.key];
      if (k === undefined) return; e.preventDefault(); go(k);
    });
  }

  /* ---------- QR (>= 1024px, outside Pi Browser) — the vendored generator the safety-number screen uses ---------- */
  function qr(url) {
    const put = () => { const box = document.getElementById("gt-qr"); if (!box || !window.qrcode) return; const q = qrcode(0, "M"); q.addData(url); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); };
    if (window.qrcode) return put();
    const s = document.createElement("script"); s.src = "/vendor/qrcode.js"; s.onload = put; document.head.appendChild(s);
  }

  window.MPGate = { render, openRec, closeRec, version: "2.149.13" };
})();
