/* =====================================================================
 * مجتمع بلس — integrity UI (Track 7, phase 32: مكافحة الحسابات الوهمية)
 * • MPIntegrity: privacy-preserving device signal — coarse device traits and a random device id are
 *   hashed (SHA-256) in the browser; only the hashes are sent, at most once a day per account.
 * • Transparent «حساب جديد» badge on profiles (with an explanation sheet).
 * • #/integrity — the member's own trust center: signals, optional phone verification (OTP), Pi KYC.
 * • #/investigations, #/investigation/<id>, #/inv-user/<handle> — staff-only investigations dashboard:
 *   review queue, evidence, relationship graph, soft limits, hidden fake followers, manual scans.
 * ===================================================================== */
(function IntegrityLayer() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : typeof icon === "function" ? icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const ar = n => Number(n || 0).toLocaleString("ar-EG");
  const me = () => (typeof S !== "undefined" && S.me ? S.me() : null);
  const isStaff = () => me()?.role === "admin";
  const KIND = { network: "شبكة منسقة", multi_account: "حسابات متعددة", cluster: "مجموعة كثيفة" };
  const LEVEL = { limited: "قيود تلقائية", restricted: "قيود من الفريق" };

  /* ---------- styles ---------- */
  if (!document.getElementById("integrity-css")) {
    const st = document.createElement("style");
    st.id = "integrity-css";
    st.textContent = `.newacct{display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-xs);font-weight:600;padding:2px 10px;border-radius:999px;border:1px solid var(--line);background:var(--bg-2);color:var(--text);cursor:pointer;vertical-align:middle;font-family:inherit}
.newacct:focus-visible,.ig-btn:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.ig-sig{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.ig-sig:last-child{border-bottom:0}
.ig-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--line)}.ig-dot.on{background:var(--ok)}.ig-dot.warn{background:var(--warn)}.ig-dot.bad{background:var(--danger)}
.ig-score{font-size:30px;font-weight:800}.ig-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0}
.ig-kpi>div{background:var(--bg-2);border:1px solid var(--line);border-radius:14px;padding:10px;text-align:center}.ig-kpi b{display:block;font-size:20px}
.ig-graph{width:100%;height:auto;background:var(--bg-2);border-radius:14px;border:1px solid var(--line)}
.ig-mem{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}.ig-tabs{display:flex;gap:6px;margin:8px 0}
.ig-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ig-ev{font-size:var(--fs-sm);background:var(--bg-2);border-radius:10px;padding:8px;margin:6px 0;white-space:pre-wrap;word-break:break-word}`;
    document.head.appendChild(st);
  }

  /* ---------- device signal (hashes only) ---------- */
  async function sha256(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  function traits() {
    const n = navigator,
      sc = screen || {};
    const ua = (n.userAgent || "").replace(/[\d._]+/g, "");
    return [ua, n.language, (n.languages || []).join(","), Intl.DateTimeFormat().resolvedOptions().timeZone, `${sc.width}x${sc.height}x${sc.colorDepth}`, window.devicePixelRatio, n.hardwareConcurrency, n.deviceMemory, n.platform, n.maxTouchPoints].map(v => String(v ?? "")).join("|");
  }
  async function reportDevice(force) {
    if (!online() || !window.crypto?.subtle || !DB?.me || (window.MPSession && !MPSession.signedIn())) return null; // v2.51: never for guests
    const k = "mp_ig_at:" + DB.me;
    if (!force && Date.now() - +(localStorage.getItem(k) || 0) < 864e5) return null;
    let did = localStorage.getItem("mp_did");
    if (!did) {
      did = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("mp_did", did);
    }
    const body = { fp: await sha256("fp|" + traits()), did: await sha256("did|" + did) };
    const r = await api("POST", "/api/integrity/device", body).catch(() => null);
    if (r) localStorage.setItem(k, String(Date.now()));
    return r;
  }
  window.MPIntegrity = { reportDevice, traits };
  if (typeof start === "function") {
    const _start = start;
    start = async function () {
      const out = await _start.apply(this, arguments);
      setTimeout(() => reportDevice().catch(() => {}), 1500);
      return out;
    };
  }
  setTimeout(() => reportDevice().catch(() => {}), 3000);

  /* ---------- «حساب جديد» badge ---------- */
  const badgeCache = new Map();
  async function badgeFor(handle) {
    const c = badgeCache.get(handle);
    if (c && Date.now() - c.t < 60e3) return c.d;
    const r = await api("GET", "/api/integrity/badges?handle=" + encodeURIComponent(handle));
    const d = { b: Object.values(r.badges)[0], days: r.newAccountDays };
    badgeCache.set(handle, { t: Date.now(), d });
    return d;
  }
  function explainNew(b, days) {
    sheet(`<div class="u-tc"><span class="u-cd newacct">${ic("sparkle", "xs")} حساب جديد</span>
      <h3 class="u-m0 u-mt10 u-mb6">أُنشئ هذا الحساب ${b.ageDays === 0 ? "اليوم" : `قبل ${ar(b.ageDays)} ${b.ageDays === 1 ? "يوم" : "أيام"}`}</h3>
      <p class="muted">نعرض هذه الشارة على كل الحسابات في أول ${ar(days)} يوماً لتساعدك على التمييز قبل التفاعل أو مشاركة معلومات أو أموال. الشارة لا تعني أن الحساب مخالف.</p>
      ${b.signals.length ? `<p class="muted">إشارات ثقة: ${b.signals.map(s => (s === "phone" ? "رقم جوال موثّق" : "هوية Pi موثّقة")).join("، ")}</p>` : ""}
      <button class="btn block" data-ui="close-sheet">فهمت</button></div>`);
  }
  if (typeof Views !== "undefined" && Views.profile) {
    const _profile = Views.profile;
    Views.profile = function (handle) {
      _profile.apply(this, arguments);
      const u = handle ? S.byHandle?.(handle) : me();
      if (!u || !online()) return;
      const token = Symbol();
      view._igp = token;
      badgeFor(u.handle)
        .then(d => {
          if (view._igp !== token || !d?.b?.newAccount) return;
          const h2 = view.querySelector(".profile-top h2");
          if (!h2 || h2.querySelector(".newacct")) return;
          h2.insertAdjacentHTML("beforeend", ` <button class="newacct" aria-label="حساب جديد: ما معنى هذه الشارة؟">${ic("sparkle", "xs")} حساب جديد</button>`);
          h2.querySelector(".newacct").onclick = () => explainNew(d.b, d.days);
        })
        .catch(() => {});
    };
  }

  /* ---------- member trust center ---------- */
  async function trustCenter() {
    const v = $("#view");
    v.innerHTML = `<div class="wrap"><a href="#/settings" class="muted">→ الإعدادات</a><h2>${ic("shield")} التحقق والثقة</h2><div class="skel"></div></div>`;
    const w = v.querySelector(".wrap");
    if (!online()) {
      w.querySelector(".skel").outerHTML = `<div class="empty">هذه الصفحة تعمل عند الاتصال بخادم مجتمع بلس</div>`;
      return;
    }
    let s;
    try {
      s = await api("GET", "/api/integrity/me");
    } catch (e) {
      w.querySelector(".skel").outerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const sig = (on, title, sub, cls) => `<div class="ig-sig"><span class="ig-dot ${cls || (on ? "on" : "")}" aria-hidden="true"></span><div class="grow"><b>${title}</b><div class="muted">${sub}</div></div><span class="ig-sr">${on ? "مفعّل" : "غير مفعّل"}</span></div>`;
    w.innerHTML = `<a href="#/settings" class="muted">→ الإعدادات</a><h2>${ic("shield")} التحقق والثقة</h2>
      <p class="muted">نستخدم هذه الإشارات لحماية المجتمع من الحسابات الوهمية. كلها اختيارية، ولا نعرض رقمك لأحد.</p>
      ${s.limit ? `<div class="card" role="status" style="border:1px solid var(--warn)"><b>${ic("lock", "sm")} ${esc(LEVEL[s.limit.level] || "قيود مؤقتة")}</b><p class="u-m0 u-mt6 muted">${esc(s.limit.text)}</p></div>` : ""}
      <div class="u-g14 card row"><div class="ig-score" aria-label="درجة الثقة ${s.score} من ١٠٠">${ar(s.score)}</div><div class="grow"><b>درجة الثقة</b><div class="muted">تزيد مع عمر الحساب والتحقق والمساهمات الجيدة</div></div></div>
      <div class="card">
        ${sig(!s.newAccount, "عمر الحساب", s.newAccount ? `حساب جديد (${ar(s.ageDays)} يوم). تظهر شارة «حساب جديد» على ملفك حتى يكمل ${ar(s.newAccountDays)} يوماً.` : `${ar(s.ageDays)} يوماً`, s.newAccount ? "warn" : "on")}
        ${sig(s.phone.verified, "رقم الجوال", s.phone.verified ? `موثّق ${esc(s.phone.hint)}` : "غير موثّق — اختياري")}
        ${sig(s.pi.status === "verified", "هوية Pi (KYC)", !s.pi.enabled ? "غير متاح حالياً" : s.pi.status === "verified" ? "موثّقة" : s.pi.status === "linked" ? "حساب Pi مرتبط، التوثيق غير مؤكد" : "غير مرتبط")}
        ${sig(s.twoFactor, "التحقق بخطوتين", s.twoFactor ? "مفعّل" : `<a href="#/security">فعّله من مركز الأمان</a>`)}
        ${s.hiddenFollowers ? sig(true, "متابعون مخفيون", `أخفينا ${ar(s.hiddenFollowers)} متابعاً يبدو أنهم وهميون من العدّ العام. يمكن استعادتهم إن ثبت خلاف ذلك.`, "warn") : ""}
      </div>
      <h4>توثيق رقم الجوال</h4>
      <div class="card" id="ig-phone">${
        s.phone.verified
          ? `<div class="row"><div class="grow">رقمك المنتهي بـ <b dir="ltr">${esc(s.phone.hint)}</b> موثّق.</div><button class="btn ghost ig-btn" id="ig-unphone">إزالة</button></div>`
          : `<label for="ig-num" class="muted">رقم الجوال</label><input id="ig-num" dir="ltr" inputmode="tel" autocomplete="tel" placeholder="05xxxxxxxx" maxlength="20">
             <div id="ig-code-wrap" hidden><label for="ig-code" class="u-db u-mt10 muted">رمز التحقق المرسل إليك</label><input id="ig-code" dir="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></div>
             <p class="u-c-dg u-mh1e muted" id="ig-perr" role="alert"></p>
             <button class="btn block ig-btn" id="ig-send">إرسال الرمز</button>
             <p class="u-mb0 muted">نحفظ بصمة مشفّرة للرقم فقط، ولا نستخدمه للتسويق.</p>`
      }</div>
      ${s.pi.enabled ? `<h4>هوية Pi</h4><div class="card"><p class="u-mt0 muted">إن كنت أكملت التحقق من هويتك في Pi Network، نستخدمه كإشارة ثقة دون الاطلاع على مستنداتك.</p><button class="btn block ig-btn" id="ig-pi">${s.pi.status === "verified" ? "إعادة التحقق" : "التحقق عبر Pi"}</button><p class="u-c-dg u-mh1e muted" id="ig-pierr" role="alert"></p></div>` : ""}`;
    $("#ig-unphone")?.addEventListener("click", async () => {
      if (!confirm("إزالة رقم الجوال من حسابك؟")) return;
      await api("DELETE", "/api/integrity/phone");
      trustCenter();
    });
    const send = $("#ig-send");
    if (send) {
      let stage = "start";
      send.onclick = async () => {
        const err = $("#ig-perr");
        err.textContent = "";
        send.disabled = true;
        try {
          if (stage === "start") {
            const r = await api("POST", "/api/integrity/phone/start", { phone: $("#ig-num").value.trim() });
            stage = "verify";
            $("#ig-code-wrap").hidden = false;
            $("#ig-num").readOnly = true;
            send.textContent = "تأكيد";
            $("#ig-code").focus();
            toast(`أرسلنا رمزاً إلى ${r.hint}`);
          } else {
            await api("POST", "/api/integrity/phone/verify", { code: $("#ig-code").value.trim() });
            toast("✓ تم توثيق رقم الجوال");
            trustCenter();
          }
        } catch (e) {
          err.textContent = e.message;
        } finally {
          send.disabled = false;
        }
      };
    }
    $("#ig-pi")?.addEventListener("click", async () => {
      try {
        const auth = typeof PiAdapter !== "undefined" ? await PiAdapter.authenticate() : null;
        if (!auth) throw new Error("افتح مجتمع بلس من Pi Browser للتحقق");
        const r = await api("POST", "/api/integrity/pi-kyc", { accessToken: auth.accessToken });
        toast(r.kyc === "verified" ? "✓ هوية Pi موثّقة" : "حساب Pi مرتبط");
        trustCenter();
      } catch (e) {
        $("#ig-pierr").textContent = e.message;
      }
    });
  }

  /* ---------- staff: graph drawing (deterministic circular layout, grouped by cluster) ---------- */
  function graphSvg(nodes, edges, center) {
    if (!nodes.length) return `<div class="muted">لا علاقات كافية للرسم</div>`;
    const W = 340,
      H = 340,
      R = 140,
      cx = W / 2,
      cy = H / 2;
    const sorted = [...nodes].sort((a, b) => (a.cluster ?? 999) - (b.cluster ?? 999) || (a.id < b.id ? -1 : 1));
    const pos = {};
    const ring = sorted.filter(n => n.id !== center);
    ring.forEach((n, i) => {
      const t = (2 * Math.PI * i) / Math.max(1, ring.length);
      pos[n.id] = [cx + R * Math.cos(t), cy + R * Math.sin(t)];
    });
    if (center) pos[center] = [cx, cy];
    const pal = ["#5b2bd6", "#1f9d8b", "#e88b2a", "#3478f6", "#e0559b", "#2fa84f", "#9b51e0", "#00a3c4"];
    const lines = edges
      .filter(e => pos[e.a] && pos[e.b])
      .map(e => `<line x1="${pos[e.a][0].toFixed(1)}" y1="${pos[e.a][1].toFixed(1)}" x2="${pos[e.b][0].toFixed(1)}" y2="${pos[e.b][1].toFixed(1)}" stroke="${e.kinds.includes("device") ? "var(--danger)" : e.kinds.includes("content") || e.kinds.includes("timing") ? "var(--warn)" : "var(--muted, #888)"}" stroke-opacity="${Math.min(0.9, 0.25 + e.w / 6).toFixed(2)}" stroke-width="${Math.min(4, 0.8 + e.w / 2).toFixed(1)}"/>`)
      .join("");
    const dots = sorted
      .filter(n => pos[n.id])
      .map(n => `<g><title>${esc(n.name || "")} @${esc(n.handle || "")}${n.flagged ? " · مُعلَّم" : ""}${n.limit ? " · " + (LEVEL[n.limit] || n.limit) : ""}</title><circle cx="${pos[n.id][0].toFixed(1)}" cy="${pos[n.id][1].toFixed(1)}" r="${n.id === center ? 11 : 7}" fill="${n.cluster != null ? pal[n.cluster % pal.length] : "#999"}" stroke="${n.flagged ? "var(--danger)" : "var(--bg)"}" stroke-width="${n.flagged ? 3 : 1.5}"/></g>`)
      .join("");
    return `<svg class="ig-graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="رسم العلاقات: ${ar(nodes.length)} حساباً و${ar(edges.length)} صلة. الخطوط الحمراء جهاز مشترك، والبرتقالية محتوى أو توقيت متزامن.">${lines}${dots}</svg>
      <div class="u-t-xs u-mt4 muted">الألوان = مجموعات مكتشفة · إطار أحمر = حساب مُعلَّم · خط أحمر = جهاز مشترك · برتقالي = محتوى/توقيت متزامن</div>`;
  }
  const memRow = m => `<div class="ig-mem"><span class="av sm" style="background:${esc(m.color || "var(--accent)")}">${esc((m.name || "?")[0])}</span><div class="grow"><a href="#/inv-user/${encodeURIComponent(m.handle)}"><b>${esc(m.name)}</b></a> <span class="muted">@${esc(m.handle)}</span><div class="muted">عمر الحساب ${ar(m.ageDays)} يوم${m.status !== "active" ? " · موقوف" : ""}${m.limit ? " · " + (LEVEL[m.limit] || m.limit) : ""}</div></div></div>`;
  const denied = v => (v.innerHTML = `<div class="wrap"><div class="empty">${ic("lock")} هذه اللوحة لفريق الأمان فقط</div></div>`);

  /* ---------- staff: investigations dashboard ---------- */
  async function investigations() {
    const v = $("#view");
    if (!isStaff()) return denied(v);
    v.innerHTML = `<div class="wrap"><a href="#/admin" class="muted">→ الإدارة</a><h2>${ic("target")} لوحة التحقيقات</h2><div class="skel"></div><div class="skel"></div></div>`;
    if (!online()) return;
    const tab = view._igtab || "open";
    let o, list;
    try {
      [o, list] = await Promise.all([api("GET", "/api/admin/integrity/overview"), api("GET", "/api/admin/integrity/flags?status=" + tab)]);
    } catch (e) {
      v.querySelector(".wrap").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const s = o.stats;
    v.querySelector(".wrap").innerHTML = `<a href="#/admin" class="muted">→ الإدارة</a><h2>${ic("target")} لوحة التحقيقات</h2>
      <div class="ig-kpi"><div><b>${ar(s.openFlags)}</b>حالة مفتوحة</div><div><b>${ar(s.limited)}</b>حساب مقيّد</div><div><b>${ar(s.hiddenFollowers)}</b>متابع وهمي مخفي</div><div><b>${ar(s.newAccounts7d)}</b>حساب جديد · ٧ أيام</div><div><b>${ar(s.phoneVerified)}</b>جوال موثّق</div><div><b>${ar(s.piVerified)}</b>Pi KYC</div></div>
      <form class="u-g8 card row" id="ig-find"><label for="ig-h" class="ig-sr">ابحث عن حساب</label><input id="ig-h" dir="ltr" placeholder="handle" aria-label="اسم المستخدم للتحقيق"><button class="btn ig-btn">فحص الحساب</button></form>
      <div class="u-g8 u-fww row"><button class="btn ghost ig-btn" id="ig-scan">${ic("refresh", "sm")} فحص الشبكات الآن</button><button class="btn ghost ig-btn" id="ig-clean">تنظيف المتابعين الوهميين</button><a class="btn ghost" href="#/inv-user/followers">المتابعون المخفيون</a></div>
      <p class="u-mh1e muted" id="ig-msg" role="status"></p>
      <div class="ig-tabs" role="tablist">${[["open", "مفتوحة"], ["confirmed", "مؤكدة"], ["dismissed", "مرفوضة"]].map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" role="tab" aria-selected="${tab === k}" data-igt="${k}">${l}</button>`).join("")}</div>
      ${list.flags.map(f => `<a class="u-db card" href="#/investigation/${esc(f.id)}"><div class="row"><b class="grow">${esc(KIND[f.kind] || f.kind)} · ${ar(f.size)} حسابات</b><span class="chip">${ar(Math.round(f.score * 100))}٪</span></div><div class="muted">${esc(f.reason || "")} · ${relTime(f.updatedAt || f.createdAt)}</div><div class="u-g4 u-mt6 u-fww row">${f.members.map(m => `<span class="chip">@${esc(m.handle)}</span>`).join("")}${f.size > f.members.length ? `<span class="muted">+${ar(f.size - f.members.length)}</span>` : ""}</div></a>`).join("") || `<div class="card muted">لا حالات ${tab === "open" ? "مفتوحة ✓" : ""}</div>`}
      <p class="muted">المؤشرات آلية وتقريبية: تُرتّب الحالات للمراجعة البشرية ولا تحذف أي حساب أو بيانات. كل القيود قابلة للتراجع وتُسجَّل في سجل التدقيق.</p>`;
    v.querySelectorAll("[data-igt]").forEach(b => (b.onclick = () => ((view._igtab = b.dataset.igt), investigations())));
    $("#ig-find").onsubmit = e => {
      e.preventDefault();
      const h = $("#ig-h").value.trim().replace(/^@/, "");
      if (h) location.hash = "#/inv-user/" + encodeURIComponent(h);
    };
    $("#ig-scan").onclick = async () => {
      $("#ig-msg").textContent = "جارٍ الفحص…";
      const r = await api("POST", "/api/admin/integrity/scan", { days: 1 });
      $("#ig-msg").textContent = `اكتمل: ${ar(r.networks.flags.length)} شبكة، ${ar(r.clusters.flags.length)} مجموعة كثيفة`;
      setTimeout(investigations, 900);
    };
    $("#ig-clean").onclick = async () => {
      $("#ig-msg").textContent = "جارٍ التنظيف…";
      const r = await api("POST", "/api/admin/integrity/cleanup");
      $("#ig-msg").textContent = `فُحص ${ar(r.scanned)} حساباً · أُخفي ${ar(r.hidden)} · استُعيد ${ar(r.restored)}`;
    };
  }
  async function investigation(fid) {
    const v = $("#view");
    if (!isStaff()) return denied(v);
    v.innerHTML = `<div class="wrap"><a href="#/investigations" class="muted">→ التحقيقات</a><div class="skel"></div></div>`;
    let d;
    try {
      d = await api("GET", "/api/admin/integrity/flags/" + encodeURIComponent(fid));
    } catch (e) {
      v.querySelector(".skel").outerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const f = d.flag,
      ev = f.evidence || {};
    const nodes = f.members.map((m, i) => ({ ...m, cluster: 0, flagged: true, i }));
    v.querySelector(".wrap").innerHTML = `<a href="#/investigations" class="muted">→ التحقيقات</a>
      <h2>${esc(KIND[f.kind] || f.kind)} <span class="chip">${ar(Math.round(f.score * 100))}٪</span></h2>
      <p class="muted">${esc(f.reason || "")} · الحالة: ${f.status === "open" ? "مفتوحة" : f.status === "confirmed" ? "مؤكدة" : "مرفوضة"}${f.note ? " · " + esc(f.note) : ""}</p>
      <div class="ig-kpi"><div><b>${ar(f.size)}</b>حساب</div><div><b>${ar(Math.round(d.graph.density * 100))}٪</b>كثافة المتابعة</div><div><b>${ar(Math.round(d.graph.reciprocity * 100))}٪</b>متابعة متبادلة</div></div>
      ${graphSvg(nodes, d.graph.edges, null)}
      <h4>الأدلة</h4><div class="card">
        ${ev.signals ? `<div class="muted">إشارات: محتوى ${ar(ev.signals.content || 0)} · توقيت ${ar(ev.signals.timing || 0)} · جهاز ${ar(ev.signals.device || 0)}</div>` : ""}
        ${(ev.content || []).map(c => `<div class="ig-ev">«${esc(c.sample)}» — ${ar(c.accounts)} حسابات</div>`).join("")}
        ${(ev.bursts || []).map(b => `<div class="muted">• ${ar(b.actors)} حسابات تفاعلت مع الهدف نفسه خلال ${ar(b.seconds)} ثانية (${relTime(b.at)})</div>`).join("")}
        ${ev.density !== undefined ? `<div class="muted">كثافة ${ar(Math.round(ev.density * 100))}٪ · تبادل ${ar(Math.round(ev.reciprocity * 100))}٪ · انغلاق ${ar(Math.round((1 - ev.conductance) * 100))}٪</div>` : ""}
        ${ev.device !== undefined ? `<div class="muted">معرّف جهاز مشترك: ${ar(ev.device)} · بصمة وشبكة مشتركة: ${ar(ev.weak)}</div>` : ""}
      </div>
      <h4>الحسابات</h4><div class="card">${f.members.map(memRow).join("")}</div>
      <label for="ig-note" class="muted">ملاحظة القرار (تُسجّل في سجل التدقيق)</label><textarea id="ig-note" maxlength="300"></textarea>
      <div class="u-g8 u-mt10 row">${f.status !== "confirmed" ? `<button class="btn grow ig-btn" data-igd="confirm" style="background:#b42318;color:#fff">تأكيد وتقييد الحسابات</button>` : ""}${f.status !== "dismissed" ? `<button class="btn ghost grow ig-btn" data-igd="dismiss">ليست مخالفة</button>` : ""}${f.status !== "open" ? `<button class="btn ghost grow ig-btn" data-igd="reopen">إعادة فتح</button>` : ""}</div>
      <p class="muted">التأكيد يضع قيوداً مؤقتة قابلة للرفع ولا يوقف الحسابات. للإيقاف استخدم أدوات الإدارة بعد المراجعة.</p>`;
    v.querySelectorAll("[data-igd]").forEach(
      b =>
        (b.onclick = async () => {
          if (b.dataset.igd === "confirm" && !confirm(`تقييد ${f.size} حسابات؟`)) return;
          await api("POST", "/api/admin/integrity/flags/" + encodeURIComponent(fid), { decision: b.dataset.igd, note: $("#ig-note").value.trim() || undefined });
          toast("✓ حُفظ القرار");
          investigation(fid);
        })
    );
  }
  async function hiddenFollowers() {
    const v = $("#view");
    v.innerHTML = `<div class="wrap"><a href="#/investigations" class="muted">→ التحقيقات</a><h2>المتابعون المخفيون</h2><div class="skel"></div></div>`;
    const r = await api("GET", "/api/admin/integrity/followers").catch(e => ({ error: e.message, followers: [] }));
    v.querySelector(".skel").outerHTML = r.followers.length
      ? `<p class="muted">متابعات أُخفيت من العدّ العام لأن المتابِع يبدو وهمياً. لا شيء محذوف، والاستعادة فورية.</p>${r.followers.map(x => `<div class="card row"><div class="grow"><b>@${esc(x.src.handle)}</b> ← <span>@${esc(x.dst.handle)}</span><div class="muted">${esc(x.reason || "")} · ${ar(Math.round(x.score * 100))}٪</div></div><button class="btn ghost ig-btn" data-rs="${esc(x.src.id)}" data-rd="${esc(x.dst.id)}">استعادة</button></div>`).join("")}`
      : `<div class="card muted">${esc(r.error || "لا متابعين مخفيين")}</div>`;
    v.querySelectorAll("[data-rs]").forEach(b => (b.onclick = async () => (await api("POST", "/api/admin/integrity/followers/restore", { src: b.dataset.rs, dst: b.dataset.rd }), hiddenFollowers())));
  }
  async function invUser(handle) {
    const v = $("#view");
    if (!isStaff()) return denied(v);
    if (handle === "followers") return hiddenFollowers();
    v.innerHTML = `<div class="wrap"><a href="#/investigations" class="muted">→ التحقيقات</a><div class="skel"></div></div>`;
    let d;
    try {
      d = await api("GET", "/api/admin/integrity/users/" + encodeURIComponent(handle));
    } catch (e) {
      v.querySelector(".skel").outerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const s = d.signals,
      g = d.graph;
    v.querySelector(".wrap").innerHTML = `<a href="#/investigations" class="muted">→ التحقيقات</a>
      <h2>${esc(d.user.name)} <span class="u-t-md muted">@${esc(d.user.handle)}</span></h2>
      <div class="ig-kpi"><div><b>${ar(s.score)}</b>درجة الثقة</div><div><b>${ar(s.ageDays)}</b>يوم</div><div><b>${s.phone.verified ? "✓" : "—"}</b>جوال</div><div><b>${s.pi.status === "verified" ? "✓" : s.pi.status ? "مرتبط" : "—"}</b>Pi</div><div><b>${ar(s.openFlags)}</b>حالة مفتوحة</div><div><b>${ar(s.hiddenFollowers)}</b>متابع مخفي</div></div>
      <div class="card"><div class="u-g8 row"><label for="ig-lvl" class="grow"><b>القيود</b><div class="muted">${s.limit ? esc(LEVEL[s.limit.level]) + " · " + esc(s.limit.reason || "") : "لا قيود"}</div></label>
        <select id="ig-lvl" class="u-wa"><option value="none">بلا قيود</option><option value="limited" ${s.limit?.level === "limited" ? "selected" : ""}>قيود خفيفة</option><option value="restricted" ${s.limit?.level === "restricted" ? "selected" : ""}>قيود مشددة</option></select><button class="btn ig-btn" id="ig-setl">حفظ</button></div></div>
      <h4>حسابات على الجهاز نفسه <span class="muted">(${ar(d.linked.length)})</span></h4><div class="card">${d.linked.map(m => memRow(m).replace("</div></div></div>", ` · ${m.via === "device" ? "معرّف جهاز" : "بصمة + شبكة"}</div></div></div>`)).join("") || `<div class="muted">لا شيء</div>`}</div>
      <h4>شبكة العلاقات</h4>${graphSvg(g.nodes, g.edges, g.center)}
      ${g.suspicious.length ? `<div class="card" style="border:1px solid var(--warn)"><b>مجموعات كثيفة مشبوهة</b>${g.suspicious.map(c => `<div class="muted">• ${ar(c.size)} حسابات · كثافة ${ar(Math.round(c.density * 100))}٪ · تبادل ${ar(Math.round(c.reciprocity * 100))}٪ · ${ar(Math.round(c.score * 100))}٪</div>`).join("")}</div>` : ""}
      <h4>الحالات</h4>${d.flags.map(f => `<a class="u-db card" href="#/investigation/${esc(f.id)}"><b>${esc(KIND[f.kind] || f.kind)}</b> <span class="chip">${ar(Math.round(f.score * 100))}٪</span><div class="muted">${esc(f.reason || "")} · ${esc(f.status)}</div></a>`).join("") || `<div class="card muted">لا حالات</div>`}`;
    $("#ig-setl").onclick = async () => {
      await api("POST", "/api/admin/integrity/users/" + encodeURIComponent(d.user.id) + "/limit", { level: $("#ig-lvl").value });
      toast("✓ حُفظ");
      invUser(handle);
    };
  }

  /* ---------- routes & entry points ---------- */
  MPRoutes.extend((a, b) => ({ integrity: () => trustCenter(), investigations: () => investigations(), investigation: () => investigation(a), "inv-user": () => invUser(decodeURIComponent(a || "")) }));
  if (typeof Views !== "undefined" && Views.settings) {
    MPSettings.add(function () {
      if (!online()) return;
      const first = $("#view .wrap .card");
      first?.insertAdjacentHTML("beforebegin", `<a href="#/integrity" class="u-dflex card row" id="ig-entry">${ic("shield")}<div class="grow"><b>التحقق والثقة</b><div class="muted">توثيق الجوال، هوية Pi، شارة الحساب الجديد</div></div><span class="muted">←</span></a>`);
    });
  }
  if (typeof V12 !== "undefined" && V12.admin) {
    const _admin = V12.admin;
    V12.admin = function () {
      _admin.apply(this, arguments);
      if (online() && isStaff()) $("#view .wrap h2")?.insertAdjacentHTML("afterend", `<a href="#/investigations" class="u-dflex card row">${ic("target")}<div class="grow"><b>لوحة التحقيقات</b><div class="muted">الشبكات المنسقة، الحسابات المتعددة، المتابعون الوهميون</div></div><span class="muted">←</span></a>`);
    };
  }
  window.MPIntegrity.views = { trustCenter, investigations, investigation, invUser };
})();
