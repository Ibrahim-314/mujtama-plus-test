/* =====================================================================
 * مجتمع بلس — security center (#/security: 2FA with QR, backup codes, passkeys, sessions, data export) and admin system
 * status (#/status). Lazy "secx" chunk since v2.26.0 (moved out of security-ui.js to free core bundle bytes); sign-in with
 * 2FA/passkeys, data saver and lazy media stay in the core. CSP: no inline handlers.
 * ===================================================================== */
(function SecurityScreens() {
  if (window.MPSecScreens) return;
  const { api, ic, online, rel, b64uToBuf, bufToB64u, passkeysSupported } = window.MPSec;
  async function registerPasskey() {
    const { publicKey: o } = await api("POST", "/api/security/passkeys/options");
    o.challenge = b64uToBuf(o.challenge); o.user.id = b64uToBuf(o.user.id); o.excludeCredentials = (o.excludeCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) }));
    const cred = await navigator.credentials.create({ publicKey: o });
    const r = cred.response;
    const name = /iPhone|iPad/.test(navigator.userAgent) ? "آيفون" : /Android/.test(navigator.userAgent) ? "أندرويد" : /Mac/.test(navigator.userAgent) ? "ماك" : /Windows/.test(navigator.userAgent) ? "ويندوز" : "هذا الجهاز";
    await api("POST", "/api/security/passkeys", { name, response: { clientDataJSON: bufToB64u(r.clientDataJSON), attestationObject: bufToB64u(r.attestationObject) } });
  }
  /* ---------- QR (vendor/qrcode.js loaded on demand) ---------- */
  function loadQR() { return window.qrcode ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/qrcode.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function qrSvg(text) { await loadQR(); const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); }

  /* ---------- Security center ---------- */
  async function securityView() {
    const v = $("#view");
    v.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "مركز الأمان", icon: "lock" })}<div class="skel"></div><div class="skel"></div></div>`;
    if (!online()) { v.querySelector(".wrap").innerHTML += ""; v.querySelectorAll(".skel").forEach(s => s.remove()); v.querySelector(".wrap").insertAdjacentHTML("beforeend", `<div class="empty">مركز الأمان يعمل عند الاتصال بخادم مجتمع بلس</div>`); return; }
    let s; try { s = await api("GET", "/api/security"); } catch (e) { v.querySelector(".wrap").innerHTML += `<div class="empty">${esc(e.message)}</div>`; return; }
    const ring = (n) => { const c = 2 * Math.PI * 34, col = n >= 80 ? "var(--ok)" : n >= 60 ? "var(--warn)" : "var(--danger)"; return `<svg viewBox="0 0 80 80" width="92" height="92" class="u-fn"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="40" cy="40" r="34" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - n / 100)}" transform="rotate(-90 40 40)" style="transition:stroke-dashoffset 1s var(--ease)"/><text x="40" y="46" text-anchor="middle" font-size="20" font-weight="800" fill="var(--text)">${n}</text></svg>`; };
    v.querySelector(".wrap").innerHTML = `${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "مركز الأمان", icon: "lock" })}
      ${staffCard(s)}<div class="u-g16 card row">${ring(s.score)}<div class="grow"><b class="u-t-lg">${s.score >= 80 ? "حسابك محمي جيداً" : s.score >= 60 ? "حماية متوسطة" : "حسابك يحتاج حماية أكبر"}</b>
        ${s.tips.length ? s.tips.map(t => `<div class="u-mt6 muted">• ${esc(t.text)}</div>`).join("") : `<div class="u-mt6 muted">كل التوصيات مطبّقة ✓</div>`}</div></div>
      <h4>التحقق بخطوتين</h4>
      <div class="card" id="tfa">${s.twoFactor.enabled
        ? `<div class="row"><div class="grow"><b>مفعّل ${ic("check", "sm")}</b><div class="muted">${s.twoFactor.backupCodesLeft} رموز احتياطية متبقية</div></div><button class="btn ghost" id="tfa-codes">رموز جديدة</button><button class="u-c-dg btn ghost" id="tfa-off">إيقاف</button></div>`
        : `<div class="row"><div class="grow"><b>غير مفعّل</b><div class="muted">رمز من تطبيق المصادقة عند كل دخول من جهاز جديد</div></div><button class="btn" id="tfa-on">تفعيل</button></div>`}</div>
      <h4>مفاتيح المرور</h4>
      <div class="card">${s.passkeys.map(k => `<div class="u-py8 u-bb row"><span class="av sm" style="background:var(--grad)">${ic("lock", "xs").replace('class="ic', 'style="stroke:#fff" class="ic')}</span><div class="grow"><b>${esc(k.name)}</b><div class="muted">أضيف ${rel(k.createdAt)}${k.lastUsedAt ? " · آخر استخدام " + rel(k.lastUsedAt) : ""}</div></div><button class="btn ghost" data-pk-del="${esc(k.id)}">حذف</button></div>`).join("") || `<div class="muted">ادخل ببصمتك أو وجهك بدل كلمة المرور.</div>`}
        ${passkeysSupported() ? `<button class="u-mt12 btn block" id="pk-add">${ic("plus", "sm")} إضافة مفتاح مرور</button>` : `<div class="u-mt8 muted">متصفحك لا يدعم مفاتيح المرور</div>`}</div>
      <h4>الأجهزة المتصلة <span class="muted">(${s.sessions.length})</span></h4>
      <div class="card">${s.sessions.map(x => `<div class="u-py10 u-bb row"><div class="grow"><b>${esc(x.device)}</b> ${x.current ? '<span class="chip" style="background:var(--accent2);color:var(--accent)">هذا الجهاز</span>' : ""}<div class="muted"><span dir="ltr">${esc(x.ip || "")}</span> · نشط ${rel(x.lastSeen)}</div></div>${x.current ? "" : `<button class="btn ghost" data-sess="${esc(x.sid)}">خروج</button>`}</div>`).join("")}
        ${s.sessions.length > 1 ? `<button class="u-mt12 u-c-dg btn ghost block" id="sess-all">تسجيل الخروج من كل الأجهزة الأخرى</button>` : ""}</div>
      <h4>سجل نشاط الأمان</h4>
      <div class="card" id="sec-act"><button class="btn ghost block" id="act-load">${ic("clock", "sm")} عرض آخر النشاطات</button></div>
      <h4>بياناتك</h4>
      <div class="card row"><div class="grow"><b>تنزيل نسخة من بياناتك</b><div class="muted">منشوراتك وتعليقاتك ومتابعاتك ورسائلك بصيغة JSON</div></div><a class="btn ghost" href="/api/me/export" download>تنزيل</a></div>`;
    const reload = () => securityView();
    $("#tfa-on")?.addEventListener("click", async () => {
      try {
        const r = await api("POST", "/api/security/2fa/setup");
        sheet(`<h4 class="u-mt0">${ic("lock", "sm")} تفعيل التحقق بخطوتين</h4><p class="muted">١. امسح الرمز بتطبيق المصادقة (Google Authenticator أو Microsoft Authenticator أو 1Password)</p>
          <div style="background:#fff;border-radius:16px;padding:10px;width:210px;margin:8px auto">${await qrSvg(r.uri)}</div>
          <details class="u-tc u-mb10 muted"><summary>لا أستطيع المسح</summary><code dir="ltr" style="user-select:all;word-break:break-all">${r.secret.replace(/(.{4})/g, "$1 ")}</code></details>
          <p class="muted">٢. اكتب الرمز المكوّن من ٦ أرقام</p><input id="tfa-code" inputmode="numeric" maxlength="6" dir="ltr" autocomplete="one-time-code" placeholder="123456" style="text-align:center;font-size:22px;letter-spacing:6px">
          <p class="u-c-dg u-mh1e muted" id="tfa-err"></p><button class="btn block" id="tfa-confirm">تأكيد</button>`);
        $("#tfa-confirm").onclick = async () => {
          try { const out = await api("POST", "/api/security/2fa/enable", { code: $("#tfa-code").value.trim() }); showCodes(out.backupCodes); reload(); }
          catch (e) { $("#tfa-err").textContent = e.message; }
        };
      } catch (e) { toast(e.message); }
    });
    function showCodes(codes) {
      sheet(`<h4 class="u-mt0">${ic("check", "sm")} احفظ رموزك الاحتياطية</h4><p class="muted">كل رمز يُستخدم مرة واحدة إذا فقدت هاتفك. لن تظهر مرة أخرى.</p>
        <div dir="ltr" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-family:ui-monospace,monospace;font-size:16px;text-align:center;margin:12px 0">${codes.map(c => `<div style="background:var(--bg);border-radius:10px;padding:8px">${c}</div>`).join("")}</div>
        <button class="btn block" id="codes-copy">نسخ الرموز</button><button class="u-mt8 btn ghost block" data-ui="close-sheet">حفظتها</button>`);
      $("#codes-copy").onclick = () => navigator.clipboard?.writeText(codes.join("\n")).then(() => toast("✓ تم النسخ"));
    }
    $("#tfa-codes")?.addEventListener("click", () => {
      sheet(`<h4 class="u-mt0">رموز احتياطية جديدة</h4><p class="muted">أدخل رمزاً من تطبيق المصادقة. الرموز القديمة ستتوقف.</p><input id="rc-code" inputmode="numeric" dir="ltr" maxlength="6" placeholder="123456"><p class="u-c-dg u-mh1e muted" id="rc-err"></p><button class="btn block" id="rc-go">إنشاء</button>`);
      $("#rc-go").onclick = async () => { try { showCodes((await api("POST", "/api/security/2fa/backup-codes", { code: $("#rc-code").value.trim() })).backupCodes); reload(); } catch (e) { $("#rc-err").textContent = e.message; } };
    });
    $("#tfa-off")?.addEventListener("click", () => {
      sheet(`<h4 class="u-mt0">إيقاف التحقق بخطوتين</h4><p class="muted">أكّد بكلمة المرور.</p><input id="off-pass" type="password" dir="ltr" autocomplete="current-password"><p class="u-c-dg u-mh1e muted" id="off-err"></p><button class="u-bg-dg btn block" id="off-go">إيقاف</button>`);
      $("#off-go").onclick = async () => { try { await api("POST", "/api/security/2fa/disable", { password: $("#off-pass").value }); closeSheet(); toast("تم إيقاف التحقق بخطوتين"); reload(); } catch (e) { $("#off-err").textContent = e.message; } };
    });
    $("#act-load")?.addEventListener("click", () => loadActivity($("#sec-act")));
    $("#staff-2fa")?.addEventListener("click", () => $("#tfa-on")?.click());
    // v2.82 fix: passkey add/delete and session sign-out handlers were dropped by mistake in v2.79
    $("#pk-add")?.addEventListener("click", async () => { try { await registerPasskey(); toast("✓ أضيف مفتاح المرور"); reload(); } catch (e) { toast(e.name === "NotAllowedError" ? "أُلغيت العملية" : e.message); } });
    v.querySelectorAll("[data-pk-del]").forEach(b => b.onclick = async () => { if (!confirm("حذف مفتاح المرور؟")) return; await api("DELETE", "/api/security/passkeys/" + encodeURIComponent(b.dataset.pkDel)); reload(); });
    v.querySelectorAll("[data-sess]").forEach(b => b.onclick = async () => { await api("DELETE", "/api/security/sessions/" + encodeURIComponent(b.dataset.sess)); toast("✓ تم تسجيل الخروج من الجهاز"); reload(); });
    $("#sess-all")?.addEventListener("click", async () => { if (!confirm("تسجيل الخروج من كل الأجهزة الأخرى؟")) return; const r = await api("POST", "/api/security/sessions/revoke-others"); toast(`✓ تم الخروج من ${r.revoked} جهاز`); reload(); });
  }

  /* ---------- Admin: system status ---------- */
  async function statusView() {
    const v = $("#view");
    v.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "حالة النظام", icon: "chart" })}<div class="skel"></div></div>`;
    if (!online()) { v.querySelector(".skel").outerHTML = `<div class="empty">حالة النظام تتطلب الاتصال بالخادم</div>`; return; }
    let s, errs, flags; try { [s, errs, flags] = await Promise.all([api("GET", "/api/status"), api("GET", "/api/admin/errors"), api("GET", "/api/admin/flags")]); } catch (e) { v.querySelector(".skel").outerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const dot = (ok) => `<span style="width:10px;height:10px;border-radius:50%;display:inline-block;background:${ok ? "var(--ok)" : "var(--warn)"};box-shadow:0 0 0 4px color-mix(in srgb,${ok ? "var(--ok)" : "var(--warn)"} 20%,transparent)"></span>`;
    const names = { database: "قاعدة البيانات", realtime: "التحديث الفوري", eventBus: "ناقل الأحداث", media: "الوسائط", pi: "Pi Network" };
    const VT = { LCP: [2500, "ms", "أكبر عرض"], FCP: [1800, "ms", "أول عرض"], CLS: [.1, "", "ثبات التخطيط"], INP: [200, "ms", "سرعة الاستجابة"], TTFB: [800, "ms", "استجابة الخادم"] };
    const up = s.uptimeSec > 86400 ? Math.floor(s.uptimeSec / 86400) + " يوم" : s.uptimeSec > 3600 ? Math.floor(s.uptimeSec / 3600) + " ساعة" : Math.max(1, Math.floor(s.uptimeSec / 60)) + " دقيقة";
    v.querySelector(".wrap").innerHTML = `${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "حالة النظام", icon: "chart" })}
      <div class="kpi"><div><b>${s.version}</b><span>الإصدار</span></div><div><b>${up}</b><span>مدة التشغيل</span></div><div><b>${s.memoryMb.rss}MB</b><span>الذاكرة</span></div><div><b>${s.errors24h}</b><span>أخطاء ٢٤ ساعة</span></div></div>
      <a href="#/admin/storage" class="u-dflex card row">${ic("folder")}<div class="grow"><b>التخزين</b><div class="muted">المساحة حسب النوع وتنظيف الملفات اليتيمة</div></div><span class="muted">←</span></a>
      <h4>الخدمات</h4><div class="card">${Object.entries(s.services).map(([k, x]) => `<div class="row" style="padding:9px 0;border-bottom:1px solid var(--line)">${dot(x.ok)}<b class="grow">${names[k] || k}</b><span class="muted">${k === "database" ? `${x.dialect} · ${x.latencyMs}ms${x.replica ? " · نسخة قراءة" : ""}` : k === "realtime" ? `${x.online} متصل` : x.note || "يعمل"}</span></div>`).join("")}</div>
      <h4>المهام الخلفية</h4><div class="card">${Object.keys(s.jobs).length ? Object.entries(s.jobs).map(([k, j]) => `<div class="row" style="padding:9px 0;border-bottom:1px solid var(--line)">${dot(j.ok)}<b class="u-ts grow" dir="ltr">${k}</b><span class="muted">${rel(j.lastRun)}${j.ms !== undefined ? ` · ${j.ms}ms` : ""}</span></div>`).join("") : `<div class="muted">لم تعمل أي مهمة بعد</div>`}</div>
      <h4>أداء المستخدمين الحقيقيين (P75 · ٢٤ ساعة)</h4><div class="card">${Object.keys(VT).map(k => { const m = s.webVitals[k]; if (!m) return `<div class="u-py8 row"><b class="grow">${VT[k][2]} <span class="muted" dir="ltr">${k}</span></b><span class="muted">لا بيانات</span></div>`; const good = m.p75 <= VT[k][0]; return `<div class="u-py8 u-bb row">${dot(good)}<b class="grow">${VT[k][2]} <span class="muted" dir="ltr">${k}</span></b><span dir="ltr">${k === "CLS" ? m.p75.toFixed(3) : Math.round(m.p75) + VT[k][1]}</span><span class="muted">&nbsp;(${m.n})</span></div>`; }).join("")}</div>
      <h4>أخطاء الواجهة</h4><div class="card">${errs.errors.slice(0, 8).map(e => `<div class="u-py8 u-bb"><b dir="ltr" class="u-db u-ts u-t-sm">${esc(e.message)}</b><span class="muted">${e.count}× · ${esc(e.url || "")} · ${rel(e.last_at)}</span></div>`).join("") || `<div class="muted">لا توجد أخطاء ✓</div>`}</div>
      <h4>أعلام الميزات</h4><div class="card">${flags.flags.map(f => `<div class="row" style="padding:9px 0;border-bottom:1px solid var(--line)"><div class="grow"><b>${esc(f.description || f.key)}</b><div class="u-ts muted" dir="ltr">${esc(f.key)}</div></div><select data-fl="${esc(f.key)}" style="width:auto;padding:6px 10px">${[0, 5, 25, 50, 100].map(p => `<option value="${p}" ${(f.enabled ? f.rollout : 0) === p ? "selected" : ""}>${p === 0 ? "متوقف" : p + "٪"}</option>`).join("")}</select></div>`).join("")}</div>
      <h4>سجل التدقيق</h4><div class="card row"><div class="grow"><b>سلسلة التحقق من السجل</b><div class="muted" id="audit-res">كل قرار إداري مرتبط ببصمة القرار السابق</div></div><button class="btn ghost" id="audit-go">تحقق الآن</button></div>`;
    v.querySelectorAll("[data-fl]").forEach(sel => sel.onchange = async () => { const p = +sel.value; await api("PUT", "/api/admin/flags/" + sel.dataset.fl, { enabled: p > 0, rollout: p }); toast("✓ تم تحديث العلم"); });
    $("#audit-go").onclick = async () => { const r = await api("GET", "/api/admin/audit/verify"); $("#audit-res").innerHTML = r.ok ? `<span class="u-c-ok">${ic("check", "xs")} السجل سليم · ${r.checked} قيد</span>` : `<span class="u-c-dg">تم اكتشاف تعديل عند القيد ${r.brokenAt}</span>`; };
  }

  /* ---------- v2.79 «حماية الحساب»: staff policy card, own activity, admin platform security ---------- */
  const ACT = {
    new_device_login: ["دخول من جهاز جديد", "mobile"],
    login_failed_burst: ["محاولات دخول فاشلة متكررة", "alert"],
    "2fa_enabled": ["تفعيل التحقق بخطوتين", "lock"],
    "2fa_disabled": ["إيقاف التحقق بخطوتين", "lock"],
    "2fa_backup_used": ["استخدام رمز احتياطي", "lock"],
    passkey_added: ["إضافة مفتاح مرور", "lock"],
    passkey_removed: ["حذف مفتاح مرور", "lock"],
    session_revoked: ["تسجيل الخروج من جهاز", "x"],
    sessions_revoked_others: ["تسجيل الخروج من الأجهزة الأخرى", "x"],
    password_changed: ["تغيير كلمة المرور", "lock"],
    email_changed: ["تغيير البريد الإلكتروني", "mail"],
    pi_link: ["ربط حساب Pi", "wallet"],
    pi_unlink: ["فك ربط حساب Pi", "wallet"]
  };
  const dt = iso => {
    try {
      return new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en" : "ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
    } catch {
      return iso;
    }
  };
  const lockedTitle = role => `صلاحيات ${role} موقوفة مؤقتاً`;
  function staffCard(s) {
    const st = s.staff;
    if (!st || (!st.required && !st.locked) || s.twoFactor.enabled) return "";
    const role = st.role === "admin" ? "المدير" : "المشرف";
    const when = st.enforceAt && Date.parse(st.enforceAt) > Date.now() ? `قبل ${dt(st.enforceAt)}` : "";
    return `<div class="card sec-staff ${st.locked ? "is-locked" : ""}" role="${st.locked ? "alert" : "status"}"><div class="u-g12 row"><span class="sec-staff-ic">${ic("shield", "sm")}</span><div class="grow">
      <b>${st.locked ? lockedTitle(role) : "مطلوب منك التحقق بخطوتين"}</b>
      <div class="muted">${st.locked ? "سياسة أمان الفريق تتطلب التحقق بخطوتين. فعّله وتعود صلاحياتك فوراً." : `سياسة أمان الفريق تتطلب التحقق بخطوتين لحسابات المشرفين. فعّله ${when} لتبقى صلاحياتك.`}</div></div></div>
      <button class="u-mt10 btn block" id="staff-2fa">${ic("lock", "sm")} تفعيل التحقق بخطوتين الآن</button></div>`;
  }
  async function loadActivity(box, before) {
    if (!box) return;
    const more = box.querySelector("#act-more");
    if (more) more.disabled = true;
    let r;
    try {
      r = await api("GET", "/api/security/activity" + (before ? "?before=" + before : ""));
    } catch (e) {
      if (more) more.disabled = false;
      toast(e.message);
      return;
    }
    const rows = r.items
      .map(x => {
        const [t, i] = ACT[x.action] || [x.action, "lock"];
        const d = x.action === "login_failed_burst" && x.detail ? ` (${esc(x.detail)})` : x.detail ? ` · ${esc(x.detail)}` : "";
        return `<li class="u-py8 u-bb row sec-act-row${x.action === "login_failed_burst" || x.action === "2fa_disabled" ? " is-warn" : ""}"><span class="sec-act-ic">${ic(i, "xs")}</span><div class="grow"><b>${t}</b>${d}<div class="muted"><time datetime="${esc(x.at)}">${dt(x.at)}</time></div></div></li>`;
      })
      .join("");
    if (!before)
      box.innerHTML = r.items.length ? `<ul class="sec-act" aria-label="سجل نشاط الأمان">${rows}</ul>` : `<div class="muted">لا نشاطات أمنية مسجّلة بعد</div>`;
    else {
      box.querySelector(".sec-act").insertAdjacentHTML("beforeend", rows);
      more?.remove();
    }
    box.querySelector("#act-more")?.remove();
    if (r.more) {
      box.insertAdjacentHTML("beforeend", `<button class="u-mt10 btn ghost block" id="act-more">عرض الأقدم</button>`);
      box.querySelector("#act-more").onclick = () => loadActivity(box, r.items[r.items.length - 1].id);
    }
    box.insertAdjacentHTML(
      "beforeend",
      r.items.length && !before ? `<p class="u-mt8 muted u-t-sm">إن رأيت نشاطاً لا تعرفه: سجّل الخروج من الأجهزة الأخرى وغيّر كلمة المرور.</p>` : ""
    );
  }
  async function adminSecurityView() {
    const v = $("#view"),
      head = UI.pageHead({ back: ["#/admin", "الإدارة"], title: "أمان المنصة", icon: "shield" });
    v.innerHTML = `<div class="wrap">${head}<div class="skel"></div></div>`;
    if (!online()) {
      v.querySelector(".skel").outerHTML = `<div class="empty">هذه الصفحة تتطلب الاتصال بالخادم</div>`;
      return;
    }
    let s;
    try {
      s = await api("GET", "/api/admin/security/policy");
    } catch (e) {
      v.querySelector(".skel").outerHTML = `<div class="empty">${esc(e.status === 403 ? "للإدارة فقط" : e.message)}</div>`;
      return;
    }
    const p = s.policy,
      without = s.staff.filter(x => !x.twoFactor).length;
    const state = !p.staff2fa ? "اختياري" : p.enforced ? "مُلزم الآن" : `يُلزم ${dt(p.enforceAt)}`;
    v.querySelector(".wrap").innerHTML = `${head}
      <div class="kpi"><div><b>${s.staff.length}</b><span>حسابات الفريق</span></div><div><b class="${without ? "u-c-dg" : ""}">${without}</b><span>بلا تحقق بخطوتين</span></div><div><b>${s.sessions}</b><span>جلسات نشطة</span></div></div>
      <h4>التحقق بخطوتين للفريق</h4>
      <div class="card"><div class="row"><div class="grow"><b>إلزام المديرين والمشرفين</b><div class="muted">الحالة: ${state}${p.killSwitch ? " · معطّل من الخادم" : ""}</div></div>
        <input type="checkbox" id="pol-on" role="switch" aria-label="إلزام المديرين والمشرفين بالتحقق بخطوتين" ${p.staff2fa ? "checked" : ""} ${p.killSwitch ? "disabled" : ""}></div>
        <label class="u-mt10 u-db" id="pol-grace-l" ${p.staff2fa ? "hidden" : ""}><span class="muted">مهلة قبل الإلزام</span>
          <select id="pol-grace" class="u-mt6"><option value="0">فوراً</option><option value="24">٢٤ ساعة</option><option value="72" selected>٣ أيام</option><option value="168">أسبوع</option></select></label>
        <p class="u-mt8 muted u-t-sm">من لم يفعّل التحقق بخطوتين بعد المهلة يُعامل كعضو عادي حتى يفعّله، ثم تعود صلاحياته فوراً. لا يُحذف أي دور.${s.me2fa ? "" : " يجب أن تفعّله لحسابك أولاً."}</p><p class="u-mt6 muted u-t-sm">${ic("check", "xs")} الدخول عبر Pi يُعدّ تحققاً قوياً ويكفي لاستيفاء السياسة.</p>
        ${s.me2fa ? "" : `<a class="u-mt6 btn ghost block" href="#/security">${ic("lock", "sm")} فعّله لحسابي</a>`}</div>
      <div class="card">${
        s.staff
          .map(
            x => `<div class="u-py8 u-bb row"><div class="grow"><b>${esc(x.name)}</b> <span class="muted">@${esc(x.handle)} · ${x.role === "admin" ? "مدير" : "مشرف"}</span></div>
        <span class="chip ${x.twoFactor ? "sec-ok" : "sec-no"}">${x.twoFactor ? "مفعّل ✓" : "غير مفعّل"}</span></div>`
          )
          .join("") || `<div class="muted">لا حسابات فريق</div>`
      }</div>
      <h4>الاستجابة للحوادث</h4>
      <div class="card sec-danger"><b>تسجيل خروج الجميع</b><div class="muted">يُخرج كل الأعضاء من كل الأجهزة ما عدا جلستك هذه. استخدمه فقط عند الاشتباه بتسرّب جلسات. يحتاج التحقق بخطوتين.</div>
        <button class="u-mt10 u-bg-dg btn block" id="rv-all" ${s.me2fa ? "" : "disabled"}>${ic("x", "sm")} تسجيل خروج الجميع…</button></div>`;
    const reload = () => adminSecurityView();
    $("#pol-on")?.addEventListener("change", async e => {
      const on = e.target.checked;
      if (!on && !confirm("إيقاف إلزام الفريق بالتحقق بخطوتين؟")) {
        e.target.checked = true;
        return;
      }
      try {
        await api("PUT", "/api/admin/security/policy", { staff2fa: on, graceHours: +$("#pol-grace").value });
        toast(on ? "✓ أُرسل تنبيه لمن لم يفعّله بعد" : "صار التحقق بخطوتين اختيارياً للفريق");
        reload();
      } catch (err) {
        e.target.checked = !on;
        toast(err.message);
      }
    });
    $("#rv-all")?.addEventListener("click", () => {
      sheet(`<h4 class="u-mt0">${ic("x", "sm")} تسجيل خروج الجميع</h4><p class="muted">سيُطلب من كل الأعضاء تسجيل الدخول من جديد. لا يمكن التراجع.</p>
        <label class="u-db"><span class="muted">اكتب: تسجيل خروج الجميع</span><input id="rv-phrase" class="u-mt6" autocomplete="off"></label>
        <label class="u-db u-mt10"><span class="muted">رمز التحقق أو رمز احتياطي</span><input id="rv-code" class="u-mt6" inputmode="numeric" dir="ltr" autocomplete="one-time-code" maxlength="11"></label>
        <p class="u-c-dg u-mh1e muted" id="rv-err" role="alert"></p><button class="u-bg-dg btn block" id="rv-go">تأكيد</button>`);
      $("#rv-go").onclick = async () => {
        $("#rv-go").disabled = true;
        try {
          const r = await api("POST", "/api/admin/security/revoke-all", { confirm: $("#rv-phrase").value.trim(), code: $("#rv-code").value.trim() });
          closeSheet();
          toast(`✓ أُنهيت ${r.revoked} جلسة`);
          reload();
        } catch (e) {
          $("#rv-err").textContent = e.message;
          $("#rv-go").disabled = false;
        }
      };
    });
  }

  /* ---------- v2.82 Admin: storage «التخزين» — totals by kind + safe orphan cleanup (dry run list → confirm) ---------- */
  const fmtB = (n) => { n = +n || 0; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + " " + u[i]; };
  async function storageView() {
    const v = $("#view"), head = UI.pageHead({ back: ["#/status", "حالة النظام"], title: "التخزين", icon: "folder" });
    v.innerHTML = `<div class="wrap">${head}<div class="skel"></div></div>`;
    if (!online()) { v.querySelector(".skel").outerHTML = `<div class="empty">التخزين يتطلب الاتصال بالخادم</div>`; return; }
    let s; try { s = (await api("GET", "/api/admin/storage")).storage; } catch (e) { v.querySelector(".skel").outerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const KN = { originals: "الملفات الأصلية", hls: "البث التكيفي (HLS)", mp4: "نسخ MP4", thumbs: "الأغلفة والمعاينات", captions: "الترجمات", temp: "ملفات مؤقتة" };
    const rows = Object.entries(s.byKind).sort((a, b) => b[1].bytes - a[1].bytes);
    v.querySelector(".wrap").innerHTML = `${head}
      <div class="kpi"><div><b dir="ltr">${fmtB(s.total)}</b><span>المساحة المستخدمة</span></div><div><b>${s.files}</b><span>عدد الملفات</span></div>${s.db ? `<div><b dir="ltr">${Math.round(s.db.total / Math.max(1, s.db.maxTotal) * 100)}%</b><span>من سعة قاعدة البيانات</span></div>` : ""}</div>
      <h4>حسب النوع</h4><div class="card">${rows.map(([k, x]) => `<div class="u-py8 u-bb row"><b class="grow">${KN[k] || k}</b><span class="muted">${x.files} ملف · <bdi dir="ltr">${fmtB(x.bytes)}</bdi></span></div>`).join("") || `<div class="muted">لا ملفات بعد</div>`}</div>
      <p class="muted">نسخ الفيديو الجديدة: ${s.mp4Policy === "360" ? "البث التكيفي + نسخة MP4 بجودة 360p فقط" : "البث التكيفي + نسخة MP4 بجودة 720p"}.</p>
      <h4>تنظيف الملفات اليتيمة</h4><div class="card"><p class="muted u-mt0">يعرض أولاً قائمة بما يمكن حذفه بأمان، ولا يُحذف شيء قبل تأكيدك: ملفات بلا سجل وسائط، وفيديو أو صوت عمره أكثر من 7 أيام لا يذكره أي منشور أو مسودة أو درس. الصور لا تُنظَّف تلقائياً.</p><button class="btn" id="st-scan">${ic("search", "sm")} افحص الآن</button><div id="st-or" aria-live="polite"></div></div>`;
    $("#st-scan").onclick = async (e) => {
      const b = e.currentTarget, box = $("#st-or"); b.disabled = true; box.innerHTML = `<div class="skel"></div>`;
      let o; try { o = (await api("GET", "/api/admin/storage?orphans=1")).storage.orphans; } catch (er) { box.innerHTML = `<p class="u-c-dg">${esc(er.message)}</p>`; b.disabled = false; return; }
      b.disabled = false;
      if (!o.files.length && !o.unused.length) { box.innerHTML = `<p class="muted">لا توجد ملفات يتيمة ✓</p>`; return; }
      box.innerHTML = `<p><b>يمكن توفير <bdi dir="ltr">${fmtB(o.bytes)}</bdi></b></p>
        ${o.unused.length ? `<h5>وسائط غير مستخدمة (${o.unused.length})</h5><ul class="list">${o.unused.slice(0, 50).map(u => `<li class="row u-py8"><span class="grow" dir="ltr">${esc(u.id)}</span><span class="muted">${u.kind === "video" ? "فيديو" : "صوت"} · ${rel(u.createdAt)} · <bdi dir="ltr">${fmtB(u.bytes)}</bdi></span></li>`).join("")}</ul>` : ""}
        ${o.files.length ? `<h5>ملفات بلا سجل (${o.files.length})</h5><ul class="list">${o.files.slice(0, 50).map(f => `<li class="row u-py8"><span class="grow u-ts" dir="ltr">${esc(f.name)}</span><bdi class="muted" dir="ltr">${fmtB(f.bytes)}</bdi></li>`).join("")}</ul>` : ""}
        <button class="u-bg-dg btn" id="st-clean">${ic("trash", "sm")} حذف المعروض</button>`;
      $("#st-clean").onclick = async (ev) => {
        if (!confirm("حذف الملفات المعروضة نهائياً؟ لا يمكن التراجع.")) return;
        ev.currentTarget.disabled = true;
        try { const r = (await api("POST", "/api/admin/storage/cleanup", { files: o.files.slice(0, 50).map(f => f.name), unused: o.unused.slice(0, 50).map(u => u.id) })).cleaned; toast(`✓ حُذف ${r.files + r.media} عنصر ووُفّر ${fmtB(r.bytes)}`); storageView(); }
        catch (er) { ev.currentTarget.disabled = false; toast(er.message); }
      };
    };
  }

  MPRoutes.extend((a, b) => ({ security: () => securityView(), status: () => statusView() }));
  MPRoutes.add("admin", (a, b, next) => (a === "security" ? adminSecurityView() : a === "storage" ? storageView() : next()));
  window.MPSecScreens = { securityView, statusView, adminSecurityView, storageView };
})();
/* identity screens moved out of identity-ui.js (core) in v2.26.0: privacy center, message requests, verification, admin trust &
 * growth, organisations — same code, now loaded on demand with the "secx" chunk */
(function IdentityScreens() {
  if (window.MPIdScreens) return;
  const { ic, online, api, fmtN, img, vtick, profCache, roleName, VERIFIED, ACT_KEY } = window.MPId;
  /* ---------- Privacy center ---------- */
  async function privacyView() {
    const v = $("#view");
    v.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "الخصوصية", icon: "shield" })}<div class="skel"></div><div class="skel"></div></div>`;
    if (!online()) { v.querySelectorAll(".skel").forEach(s => s.remove()); v.querySelector(".wrap").insertAdjacentHTML("beforeend", `<div class="empty">مركز الخصوصية يعمل عند الاتصال بالخادم</div>`); return; }
    const p = await api("GET", "/api/privacy").catch(e => ({ error: e.message })); if (p.error) { v.querySelector(".wrap").innerHTML += `<div class="empty">${esc(p.error)}</div>`; return; }
    const sel = (k, label, help) => `<div class="pv-row"><div class="grow"><b>${label}</b><div class="muted">${help}</div></div><select data-pv="${k}" aria-label="${label}">${[["everyone", "الجميع"], ["following", "من أتابعهم"], ["nobody", "لا أحد"]].map(([v2, l]) => `<option value="${v2}" ${p[k] === v2 ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
    v.querySelector(".wrap").innerHTML = `${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "الخصوصية", icon: "shield" })}
      <a class="u-dflex card row" href="#/me?as=public">${ic("eye")}<div class="grow"><b>كيف يرى الآخرون ملفك؟</b><div class="muted">معاينة ملفك بعين زائر</div></div><span class="muted">←</span></a>
      <h4>الحساب</h4><div class="card"><div class="pv-row"><div class="grow"><b>حساب خاص</b><div class="muted">لا يرى منشوراتك إلا من توافق على متابعته. عند إلغائه تُقبل الطلبات المعلّقة تلقائياً.</div></div><input type="checkbox" id="pv-private" aria-label="حساب خاص" ${p.private ? "checked" : ""}></div></div>
      ${p.followRequests.length ? `<h4>طلبات المتابعة <span class="muted">(${p.followRequests.length})</span></h4><div class="card">${p.followRequests.map(r => `<div class="u-py8 u-bb row">${av(r, "sm")}<a class="grow" href="#/u/${esc(r.handle)}"><b>${esc(r.name)}</b><div class="muted">@${esc(r.handle)} · ${relTime(r.at)}</div></a><button class="btn" data-fr="${r.id}" data-d="approve" style="padding:6px 12px">قبول</button><button class="btn ghost" data-fr="${r.id}" data-d="deny" style="padding:6px 12px;margin-inline-start:6px">رفض</button></div>`).join("")}</div>` : ""}
      <h4>من يستطيع…</h4><div class="card">${sel("dm", "مراسلتك", "الرسائل من غيرهم لن تصلك")}${sel("mentions", "الإشارة إليك", "الإشارات من غيرهم لا تصلك كإشعار")}${sel("comments", "التعليق على منشوراتك", "يطبّق على كل منشوراتك")}
        <div class="pv-row"><div class="grow"><b>فلترة الرسائل من غير من تتابعهم</b><div class="muted">تذهب إلى «طلبات الرسائل» بدل صندوقك الرئيسي</div></div><input type="checkbox" id="pv-filter" aria-label="فلترة الرسائل" ${p.filterRequests ? "checked" : ""}></div></div>
      <h4>المقربون <span class="muted">(${p.closeFriends.length})</span></h4><div class="card"><p class="u-mt0 muted">اختر «المقربون» عند النشر ليرى المنشور هؤلاء فقط. لا يُبلَّغون بإضافتهم.</p>
        <div id="cf-list">${p.closeFriends.map(f => `<span class="chip cf">${esc(f.name)} <button data-cf-del="${f.id}" aria-label="إزالة">${ic("x", "xs")}</button></span>`).join("")}</div>
        <input id="cf-q" placeholder="ابحث عن شخص لإضافته" class="u-mt8" aria-label="إضافة مقرب"><div id="cf-res"></div></div>
      <h4>الكلمات المكتومة</h4><div class="card"><p class="u-mt0 muted">لن ترى منشورات تحتوي هذه الكلمات في خلاصتك.</p><div id="mw-list">${p.mutedWords.map(w => `<span class="chip">${esc(w)} <button data-mw-del="${esc(w)}" aria-label="إزالة">${ic("x", "xs")}</button></span>`).join("")}</div>
        <div class="u-g6 u-mt8 row"><input id="mw-in" placeholder="كلمة أو عبارة" aria-label="كلمة مكتومة"><button class="btn" id="mw-add">إضافة</button></div></div>
      <a class="u-dflex card row" href="#/message-requests">${ic("mail")}<div class="grow"><b>طلبات الرسائل</b><div class="muted">رسائل من أشخاص لا تتابعهم</div></div><span class="muted">←</span></a>`;
    const save = async (body) => { try { await api("PUT", "/api/privacy", body); toast("✓ حُفظ"); profCache.clear(); } catch (e) { toast(e.message); } };
    $("#pv-private").onchange = (e) => save({ private: e.target.checked }).then(() => { S.me().private = e.target.checked; });
    $("#pv-filter").onchange = (e) => save({ filterRequests: e.target.checked });
    v.querySelectorAll("[data-pv]").forEach(s => s.onchange = () => save({ [s.dataset.pv]: s.value }));
    v.querySelectorAll("[data-fr]").forEach(b => b.onclick = async () => { await api("POST", `/api/follow-requests/${b.dataset.fr}/${b.dataset.d}`); toast(b.dataset.d === "approve" ? "✓ قُبل الطلب" : "رُفض الطلب"); privacyView(); });
    v.querySelectorAll("[data-cf-del]").forEach(b => b.onclick = async () => { await api("DELETE", "/api/close-friends/" + b.dataset.cfDel); privacyView(); });
    $("#cf-q").oninput = (e) => { const q = e.target.value.trim(); const res = q.length < 2 ? [] : DB.users.filter(u => u.id !== DB.me && (u.name.includes(q) || u.handle.includes(q))).slice(0, 5); $("#cf-res").innerHTML = res.map(u => `<button class="row cf-pick" data-cf="${u.id}">${av(u, "sm").replace(/<a /, "<span ").replace(/<\/a>/, "</span>")}<span class="u-ts grow">${esc(u.name)} <span class="muted">@${esc(u.handle)}</span></span>${ic("plus", "xs")}</button>`).join(""); $("#cf-res").querySelectorAll("[data-cf]").forEach(b => b.onclick = async () => { await api("PUT", "/api/close-friends/" + b.dataset.cf); privacyView(); }); };
    const words = p.mutedWords.slice();
    $("#mw-add").onclick = () => { const w = $("#mw-in").value.trim(); if (!w) return; save({ mutedWords: [...new Set([...words, w])] }).then(privacyView); };
    v.querySelectorAll("[data-mw-del]").forEach(b => b.onclick = () => save({ mutedWords: words.filter(w => w !== b.dataset.mwDel) }).then(privacyView));
  }
  async function messageRequestsView() {
    const v = $("#view"); v.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/privacy", "الخصوصية"], title: "طلبات الرسائل", icon: "mail" })}<div class="skel"></div></div>`;
    if (!online()) return;
    const { requests } = await api("GET", "/api/conversations/requests");
    const w = v.querySelector(".wrap"); w.querySelector(".skel").remove();
    w.insertAdjacentHTML("beforeend", requests.map(r => { const c = DB.conversations.find(x => x.id === r.id); const other = c && S.user(c.members.find(m => m !== DB.me)); const last = DB.messages.filter(m => m.conv === r.id).slice(-1)[0];
      return `<div class="card"><div class="row">${other ? av(other, "sm") : ""}<div class="grow"><b>${esc(other?.name || "مستخدم")}</b><div class="muted">${esc((last?.text || "").slice(0, 80))}</div></div></div><div class="u-g8 u-mt10 row"><button class="btn grow" data-acc="${r.id}">قبول</button><button class="btn ghost grow" data-dec="${r.id}">حذف</button></div></div>`; }).join("") || `<div class="empty">لا طلبات رسائل</div>`);
    w.querySelectorAll("[data-acc]").forEach(b => b.onclick = async () => { await api("POST", `/api/conversations/${b.dataset.acc}/accept`); location.hash = "#/chat/" + b.dataset.acc; });
    w.querySelectorAll("[data-dec]").forEach(b => b.onclick = async () => { await api("POST", `/api/conversations/${b.dataset.dec}/decline`); DB.conversations = DB.conversations.filter(c => c.id !== b.dataset.dec); messageRequestsView(); });
  }

  /* ---------- Verification ---------- */
  async function verifyView() {
    const v = $("#view"); v.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "طلب التوثيق", icon: "verified" })}<div class="skel"></div></div>`;
    if (!online()) { v.querySelector(".skel").outerHTML = `<div class="empty">التوثيق يتطلب الاتصال بالخادم</div>`; return; }
    const st = await api("GET", "/api/verification"); const w = v.querySelector(".wrap"); w.querySelector(".skel").remove();
    if (st.verified) { w.insertAdjacentHTML("beforeend", `<div class="card" style="text-align:center;padding:30px">${vtick(st.verified, "lg")}<h3>حسابك موثق</h3><p class="muted">${esc(VERIFIED[st.verified][0])}</p></div>`); return; }
    if (st.request?.status === "pending") { w.insertAdjacentHTML("beforeend", `<div class="card" style="text-align:center;padding:30px">${ic("refresh")}<h3>طلبك قيد المراجعة</h3><p class="muted">أُرسل ${relTime(st.request.created_at)}. نراجع الطلبات يدوياً عادةً خلال أيام.</p></div>`); return; }
    w.insertAdjacentHTML("beforeend", `${st.request?.status === "rejected" ? `<div class="card" style="border:1px solid var(--danger)"><b>لم يُقبل طلبك السابق</b><div class="muted">${esc(st.request.reason || "")}</div></div>` : ""}
      <p class="muted">الشارة تؤكد أن الحساب يمثل صاحبه فعلاً. يطّلع على مستنداتك فريق المراجعة فقط، ولا تظهر لأحد.</p>
      <div class="card"><b>نوع التوثيق</b><div class="vkinds">${Object.entries(VERIFIED).map(([k, [l]]) => `<label class="vkind"><input type="radio" name="vk" value="${k}" ${k === "person" ? "checked" : ""}>${vtick(k, "sm")}<span>${l}</span></label>`).join("")}</div>
      <label class="muted">نبذة تدعم طلبك</label><textarea id="v-note" maxlength="1000" placeholder="مثلاً: روابط أعمالك أو المنصب أو الجهة"></textarea>
      <label class="muted">المستندات (هوية، سجل تجاري، شهادة)</label><input type="file" id="v-docs" accept="image/*" multiple aria-label="المستندات"><div id="v-list" class="muted"></div>
      <p class="u-c-dg u-mh1e muted" id="v-err"></p><button class="btn block" id="v-go">إرسال الطلب</button></div>`);
    const docs = [];
    $("#v-docs").onchange = async (e) => { for (const f of [...e.target.files].slice(0, 5 - docs.length)) { try { docs.push((await api("POST", "/api/media", null, f)).media.id); } catch (er) { toast(er.message); } } $("#v-list").textContent = `${docs.length} مستند مرفق`; };
    $("#v-go").onclick = async () => { try { await api("POST", "/api/verification", { kind: v.querySelector("[name=vk]:checked").value, note: $("#v-note").value, docs }); toast("✓ أُرسل الطلب"); verifyView(); } catch (e) { $("#v-err").textContent = e.message; } };
  }

  /* ---------- Admin: trust & growth ---------- */
  async function trustView() {
    const v = $("#view"); v.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "الثقة والنمو", icon: "shield" })}<div class="skel"></div></div>`;
    if (!online()) return;
    let q, f, fn, ex; try { [q, f, fn, ex] = await Promise.all([api("GET", "/api/admin/verification"), api("GET", "/api/admin/impersonation"), api("GET", "/api/admin/funnel"), api("GET", "/api/admin/experiments")]); } catch (e) { v.querySelector(".skel").outerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const max = fn.steps[0].users || 1;
    v.querySelector(".wrap").innerHTML = `${UI.pageHead({ back: ["#/admin", "الإدارة"], title: "الثقة والنمو", icon: "shield" })}
      <h4>طلبات التوثيق <span class="muted">(${q.requests.length})</span></h4>${q.requests.map(r => `<div class="card"><div class="row"><b class="grow">${esc(r.name)} <span class="muted">@${esc(r.handle)}</span></b>${vtick(r.kind, "sm")} <span class="muted">${esc(VERIFIED[r.kind][0])}</span></div><div class="muted">${r.followers} متابِع · سمعة ${r.reputation} · ${relTime(r.created_at)}</div>${r.note ? `<p>${esc(r.note)}</p>` : ""}<div class="u-g6 u-fww row">${r.docs.map((d, i) => `<a class="chip" href="${esc(d)}" target="_blank" rel="noopener">مستند ${i + 1}</a>`).join("")}</div><div class="u-g8 u-mt10 row"><button class="btn grow" data-vr="${r.id}" data-d="approve">توثيق</button><button class="btn ghost grow" data-vr="${r.id}" data-d="reject">رفض</button></div></div>`).join("") || `<div class="card muted">لا طلبات</div>`}
      <h4>اشتباه انتحال <span class="muted">(${f.flags.length})</span></h4>${f.flags.map(x => `<div class="card"><div class="u-g10 row"><div class="grow"><b>${esc(x.suspect.name)}</b> <span class="muted">@${esc(x.suspect.handle)}</span><div class="muted">يشبه ${esc(x.original.name)} (@${esc(x.original.handle)})</div><div class="u-mt6 chip">${esc(x.reason)} · ${Math.round(x.score * 100)}٪</div></div></div><div class="u-g8 u-mt10 row"><button class="u-bg-dg btn grow" data-if="${x.id}" data-d="confirm">انتحال: إيقاف</button><button class="btn ghost grow" data-if="${x.id}" data-d="dismiss">ليس انتحالاً</button></div></div>`).join("") || `<div class="card muted">لا اشتباهات</div>`}
      <h4>قمع التسجيل (آخر ${fn.days} يوماً)</h4><div class="card funnel">${fn.steps.map(s => `<div class="fn-row"><span class="fn-l">${esc(s.label)}</span><div class="fn-bar"><i style="width:${Math.max(2, s.users / max * 100)}%"></i></div><b>${s.users}</b><span class="muted">${s.rate}٪${s.dropFromPrev ? ` · −${s.dropFromPrev}٪` : ""}</span></div>`).join("")}</div>
      <h4>تجارب A/B</h4>${ex.experiments.map(e => `<div class="card"><div class="row"><b class="grow">${esc(e.description)}</b><input type="checkbox" data-exp="${esc(e.key)}" ${e.enabled ? "checked" : ""} aria-label="تفعيل التجربة"></div><div class="u-ts muted" dir="ltr">${esc(e.key)} · goal: ${esc(e.goal)}</div>${e.variants.map(x => `<div class="u-py6 row"><span class="chip">${esc(x.variant)}</span><span class="grow muted">${x.exposed} مستخدم</span><b>${x.rate}٪</b></div>`).join("")}</div>`).join("")}`;
    v.querySelectorAll("[data-vr]").forEach(b => b.onclick = async () => { const reason = b.dataset.d === "reject" ? prompt("سبب الرفض (يظهر لصاحب الطلب)") : null; await api("POST", "/api/admin/verification/" + b.dataset.vr, { decision: b.dataset.d, reason }); trustView(); });
    v.querySelectorAll("[data-if]").forEach(b => b.onclick = async () => { if (b.dataset.d === "confirm" && !confirm("إيقاف هذا الحساب؟")) return; await api("POST", "/api/admin/impersonation/" + b.dataset.if, { decision: b.dataset.d }); trustView(); });
    v.querySelectorAll("[data-exp]").forEach(c => c.onchange = () => api("PUT", "/api/admin/experiments/" + c.dataset.exp, { enabled: c.checked }));
  }

  /* ---------- Organisations ---------- */
  async function orgsView() {
    const v = $("#view"); v.innerHTML = `<div class="wrap"><h2>${ic("building")} المؤسسات</h2><div class="skel"></div></div>`;
    if (!online()) { v.querySelector(".skel").outerHTML = `<div class="empty">حسابات المؤسسات تتطلب الاتصال بالخادم</div>`; return; }
    const [{ orgs }, { invites }] = await Promise.all([api("GET", "/api/orgs"), api("GET", "/api/org-invites")]);
    const w = v.querySelector(".wrap"); w.querySelector(".skel").remove();
    w.insertAdjacentHTML("beforeend", `${invites.map(i => `<div class="card row">${ic("mail")}<div class="grow"><b>دعوة للانضمام إلى ${esc(i.name)}</b><div class="muted">بدور ${roleName(i.role)}</div></div><button class="btn" data-inv="${i.id}" data-d="accept">قبول</button><button class="u-ms6 btn ghost" data-inv="${i.id}" data-d="decline">رفض</button></div>`).join("")}
      ${orgs.map(o => `<a class="u-dflex card row" href="#/org/${o.id}"><span class="av" style="background:${o.color}">${o.avatar ? `<img src="${esc(img(o.avatar, "200"))}" alt="">` : esc(o.name[0])}</span><div class="grow"><b>${esc(o.name)}</b>${vtick(o.verified)}<div class="muted">@${esc(o.handle)} · ${roleName(o.myRole)}</div></div><span class="muted">←</span></a>`).join("") || `<div class="u-p24 empty">${ic("building")}<p>أنشئ حساباً لشركتك أو جهتك، وأضف فريقك لينشروا باسمها دون مشاركة كلمة المرور.</p></div>`}
      <div class="card"><b>مؤسسة جديدة</b><input id="o-name" placeholder="اسم المؤسسة" class="u-mt8"><input id="o-handle" dir="ltr" placeholder="handle" class="u-mt8"><p class="u-c-dg u-mh1e muted" id="o-err"></p><button class="btn block" id="o-go">إنشاء</button></div>`);
    w.querySelectorAll("[data-inv]").forEach(b => b.onclick = async () => { await api("POST", `/api/org-invites/${b.dataset.inv}/${b.dataset.d}`); orgsView(); });
    $("#o-go").onclick = async () => { try { const r = await api("POST", "/api/orgs", { name: $("#o-name").value.trim(), handle: $("#o-handle").value.trim() }); location.hash = "#/org/" + r.org.id; } catch (e) { $("#o-err").textContent = e.message; } };
  }
  async function orgView(id) {
    const v = $("#view"); v.innerHTML = `<div class="wrap"><a href="#/orgs" class="muted">→ المؤسسات</a><div class="skel"></div></div>`;
    if (!online()) return;
    let d; try { d = await api("GET", "/api/orgs/" + id); } catch (e) { v.querySelector(".skel").outerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const o = d.org, canManage = ["owner", "admin"].includes(d.myRole);
    const ACT = { org_created: "أنشأ المؤسسة", invite_sent: "أرسل دعوة", joined_team: "انضم للفريق", role_changed: "غيّر دوراً", member_removed: "أزال عضواً", left_team: "غادر الفريق" };
    const actText = (a) => ACT[a.action] || (a.action.startsWith("POST /api/posts") ? "نشر منشوراً" : a.action.startsWith("POST /api/comments") ? "علّق" : a.action.startsWith("PUT /api/reactions") ? "تفاعل" : a.action.startsWith("PATCH") ? "عدّل" : a.action.startsWith("DELETE") ? "حذف" : "إجراء");
    v.querySelector(".wrap").innerHTML = `<a href="#/orgs" class="muted">→ المؤسسات</a>
      <div class="org-hero"><span class="av lg" style="background:${o.color}">${o.avatar ? `<img src="${esc(img(o.avatar, "400"))}" alt="">` : esc(o.name[0])}</span><div class="grow"><h2 class="u-m0">${esc(o.name)} ${vtick(o.verified, "sm")}</h2><div class="muted">@${esc(o.handle)} · دورك: ${roleName(d.myRole)}</div></div></div>
      <div class="u-g8 u-my12 row"><button class="btn grow" id="act">${ic("pen", "sm")} انشر باسم المؤسسة</button><a class="btn ghost" href="#/u/${esc(o.handle)}">الملف العام</a></div>
      <div class="kpi"><div><b>${fmtN(d.stats.followers)}</b><span>متابِع</span></div><div><b>${d.stats.posts30}</b><span>منشور · ٣٠ يوماً</span></div><div><b>${fmtN(d.stats.reactions30)}</b><span>تفاعل</span></div><div><b>${fmtN(d.stats.views30)}</b><span>مشاهدة</span></div></div>
      <h4>الفريق <span class="muted">(${d.members.length})</span></h4><div class="card">${d.members.map(m => `<div class="u-py8 u-bb row">${av(m, "sm")}<div class="grow"><b>${esc(m.name)}</b><div class="muted">@${esc(m.handle)}</div></div>${canManage && m.role !== "owner" && m.id !== DB.me ? `<select data-role="${m.id}" aria-label="الدور" style="width:auto;padding:6px 10px">${["admin", "editor"].map(r => `<option value="${r}" ${m.role === r ? "selected" : ""}>${roleName(r)}</option>`).join("")}</select><button class="u-ms6 btn ghost" data-rm="${m.id}" aria-label="إزالة">${ic("x", "xs")}</button>` : `<span class="chip">${roleName(m.role)}</span>`}</div>`).join("")}
        ${canManage ? `<div class="u-g6 u-mt10 row"><input id="inv-h" dir="ltr" placeholder="handle" aria-label="اسم المستخدم"><select id="inv-r" class="u-wa" aria-label="الدور"><option value="editor">محرر</option><option value="admin">مدير</option></select><button class="btn" id="inv-go">دعوة</button></div>${d.invites.length ? `<div class="u-mt8 muted">دعوات معلقة: ${d.invites.map(i => "@" + esc(i.handle)).join("، ")}</div>` : ""}` : ""}
        <p class="u-mb0 muted">المحرر ينشر ويعلّق باسم المؤسسة. المدير يدير الفريق أيضاً. لا أحد يحتاج كلمة مرور المؤسسة.</p></div>
      <h4>سجل نشاط الفريق</h4><div class="card">${d.activity.map(a => `<div class="row" style="padding:7px 0;border-bottom:1px solid var(--line)"><b>${esc(a.name)}</b><span class="grow">&nbsp;${actText(a)}</span><span class="muted">${relTime(a.at)}</span></div>`).join("") || `<div class="muted">لا نشاط بعد</div>`}</div>`;
    $("#act").onclick = () => { localStorage.setItem(ACT_KEY, JSON.stringify({ id: o.id, name: o.name, handle: o.handle })); location.hash = "#/home"; location.reload(); };
    $("#inv-go")?.addEventListener("click", async () => { try { await api("POST", `/api/orgs/${id}/invites`, { handle: $("#inv-h").value.trim(), role: $("#inv-r").value }); toast("✓ أُرسلت الدعوة"); orgView(id); } catch (e) { toast(e.message); } });
    v.querySelectorAll("[data-role]").forEach(s => s.onchange = async () => { await api("PUT", `/api/orgs/${id}/members/${s.dataset.role}`, { role: s.value }); toast("✓ تغيّر الدور"); });
    v.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { if (!confirm("إزالة العضو من الفريق؟")) return; await api("DELETE", `/api/orgs/${id}/members/${b.dataset.rm}`); orgView(id); });
  }

  MPRoutes.extend((a, b) => ({ privacy: () => privacyView(), "message-requests": () => messageRequestsView(), verify: () => verifyView(), trust: () => trustView(), orgs: () => orgsView(), org: () => orgView(a) }));
  window.MPIdScreens = { privacyView, messageRequestsView, verifyView, trustView, orgsView, orgView };
})();
