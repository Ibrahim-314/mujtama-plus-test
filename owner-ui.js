/* =====================================================================
 * v2.167 «لوحة المالك» (#/owner) — the ONE admin page left after the app became fully automatic.
 * Rides the lazy `v12x` chunk (index.html data-chunk). Owner (admin role) only; everyone else sees «للمالك فقط».
 *   • read-only status: version, network, Pi keys present (names only), Plus price, AI keys, counts, MJT supply, what the automatic
 *     rules are waiting on, the last automatic sweep and the fixed rule values (server/config/app-defaults.js);
 *   • emergency ban / unban of one account by handle (POST /api/owner/ban | /api/owner/unban). A ban suspends the account and
 *     ends its sessions — no member data, balance, membership or purchase is deleted.
 * Nothing here switches, prices or approves anything. CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function OwnerUI() {
  if (window.MPOwner) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s) => view.querySelector(s);
  const ic = (n, c = "sm") => UI.icon(n, c);
  const num = (n) => `<bdi dir="ltr">${h(Number(n || 0).toLocaleString("en-US"))}</bdi>`;
  const yes = (on, a = "يعمل", b = "غير مفعّل") => `<span class="sbadge ${on ? "ok" : "warn"}">${on ? a : b}</span>`;
  const row = (k, v) => `<div class="u-py8 u-bb row"><span class="grow">${k}</span>${v}</div>`;
  const isOwner = () => { try { return typeof DB !== "undefined" && !!DB.isAdmin; } catch { return false; } };
  const page = (body) => { view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/menu", "المزيد"], title: "لوحة المالك", icon: "shield", id: "ow-h" })}${body}</div>`; $("#ow-h")?.focus?.({ preventScroll: true }); };
  const when = (iso) => { if (!iso) return "لم يعمل بعد"; try { return `<bdi dir="ltr">${h(new Date(iso).toLocaleString("en-GB", { hour12: false }))}</bdi>`; } catch { return h(iso); } };
  const SRC = { answer_accepted: "إجابة مقبولة", useful_post: "منشور مفيد", article_published: "نشر مقال", wiki_edit: "تعديل في الويكي", report_confirmed: "بلاغ مؤكَّد", newcomer_help: "مساعدة عضو جديد", friend_active: "صديق صار نشطاً", quiz_passed: "اجتياز اختبار قصير", course_completed: "إكمال دورة", exam_certified: "شهادة اختبار", study_session: "جلسة مذاكرة", daily_activity: "نشاط يومي", active_week: "أسبوع نشط" };
  const per = (s) => [s.daily ? `${s.daily} يومياً` : "", s.weekly ? `${s.weekly} أسبوعياً` : "", s.monthly ? `${s.monthly} شهرياً` : ""].filter(Boolean).join(" · ");

  async function ownerView() {
    if (!isOwner()) { page(`<div class="empty">للمالك فقط</div>`); return; }
    page(`<div id="ow-b"><div class="skel"></div></div>`);
    let d; try { d = await api("GET", "/api/owner/status"); } catch (e) { const b = $("#ow-b"); if (b) b.innerHTML = `<div class="empty">${h(e.message || "تعذّر التحميل")}</div>`; return; }
    const box = $("#ow-b"); if (!box) return;
    const A = d.autoRules?.rules || {}, W = d.waiting || {}, C = d.counts || {}, last = d.autoRules?.last || null;
    const missing = [...(d.ai?.missingKeys || []), ...(d.assistantNeeds ? [d.assistantNeeds] : []), ...(!d.pi?.enabled ? ["مدفوعات Pi: PI_ENABLED=1"] : []), ...(!d.pi?.apiKeyPresent ? ["مدفوعات Pi: PI_API_KEY"] : [])];
    box.innerHTML = `<p class="muted">${h(d.note || "")}</p>
      <section class="card"><h4>${ic("chart")} الحالة</h4>
        ${row("الإصدار", `<bdi dir="ltr">${h(d.version)}</bdi>`)}${row("الشبكة", `<bdi dir="ltr">${h(d.network)}</bdi>`)}${row("قاعدة البيانات", `<bdi dir="ltr">${h(d.database)}</bdi>`)}${d.dbSize ? row("حجم قاعدة البيانات", `<bdi dir="ltr">${h((d.dbSize.bytes / 1048576).toFixed(1))} MB · ${num(d.dbSize.bytes)} bytes</bdi>`) + (d.dbSize.tables?.length ? `<div class="u-py8 u-bb"><small class="muted">أكبر الجداول (عدد الصفوف): ${d.dbSize.tables.map((t) => `<bdi dir="ltr">${h(t.name)}</bdi> ${num(t.rows)}`).join(" · ")}</small></div>` : "") : ""}
        ${row("مدفوعات Pi", yes(d.pi?.enabled))}${row("مفتاح Pi", yes(d.pi?.apiKeyPresent, "موجود", "غير موجود"))}
        ${row("الترجمة", yes(d.ai?.translate))}${row("المساعد", yes(d.ai?.assistant))}
        ${row("سعر بلس", d.plus?.pricePi === null || d.plus?.pricePi === undefined ? "السعر يُحدد قريباً" : `${num(d.plus.pricePi)} Pi / ${num(d.plus.periodDays)} يوماً · بلا تجديد تلقائي`)}
        ${row("مشتركو بلس الآن", num(d.plus?.subscribers))}
        ${missing.length ? `<div class="u-py8"><b>مفاتيح ناقصة (الأسماء فقط):</b><ul>${missing.map((m) => `<li>${h(m)}</li>`).join("")}</ul></div>` : ""}</section>
      <section class="card"><h4>${ic("users")} الأعداد</h4>
        ${row("الأعضاء", num(C.users))}${row("حسابات موقوفة", num(C.suspended))}${row("منشورات منشورة", num(C.posts))}${row("بلاغات مفتوحة", num(C.openReports))}
        ${d.mjt ? `${row("مجتمع كوين المتداول", num(d.mjt.circulating))}${row("المُصدَر", num(d.mjt.minted))}${row("المحروق", num(d.mjt.burned))}${row("الحاملون", num(d.mjt.holders))}` : ""}</section>
      <section class="card"><h4>${ic("clock")} القواعد التلقائية</h4>
        ${row("آخر تشغيل", when(d.autoRules?.lastRun))}
        ${row("مكافآت محجوزة تنتظر الإفراج", num(W.earns))}${row("تحويلات محجوزة", num(W.transfers))}${row("محتوى بانتظار النشر التلقائي", num(W.heldContent))}${row("محتوى خطير مخفي (بانتظار اعتراض صاحبه)", num(W.escalated))}
        <ul class="u-py8">
          <li>المكافآت والتحويلات المحجوزة تُفرج تلقائياً بعد ${num(A.holdReleaseHours)} ساعة إذا لم يُوقف الحساب أو يُبلَّغ عنه.</li>
          <li>التحويل الذي يتعذّر إرساله يُلغى بعد ${num(A.transferHoldExpireDays)} يوماً دون أي خصم.</li>
          <li>المحتوى الذي يجتاز الفحص الآلي ويكون صاحبه في المستوى ${num(A.trustedLevel)} فأعلى يُنشر فوراً، وغيره بعد ${num(A.publishAfterHours)} ساعة إن لم يُبلَّغ عنه.</li>
          <li>يُخفى المنشور أو التعليق إذا أبلغ عنه ${num(A.reportHide?.reports)} أعضاء مختلفون من المستوى ${num(A.reportHide?.minLevel)} فأعلى، ويعود بعد ${num(A.reportHide?.restoreDays)} أيام ما لم يتأكد البلاغ (${num(A.reportHide?.upholdReports)} مبلّغين موثوقين أو إيقاف صاحبه).</li>
          <li>طلب ملكية النشاط التجاري يُقبل تلقائياً لحساب موثّق بـ Pi وغير قاصر وعمره ${num(A.bizClaimMinAccountDays)} أيام فأكثر.</li>
        </ul>
        ${last ? `<p class="f-hint">آخر دورة: أُفرج عن ${num(last.holds?.earns)} مكافأة و${num(last.holds?.transfers)} تحويل · نُشر ${num(Object.values(last.content || {}).reduce((a, x) => a + Number(x || 0), 0))} عنصر · أُخفي ${num(last.reports?.hidden)} وأُعيد ${num(last.reports?.restored)}</p>` : ""}</section>
      <section class="card"><h4>${ic("coin")} قيم مجتمع كوين الثابتة</h4>
        ${d.defaults?.caps ? row("الحد اليومي / الأسبوعي / الشهري", `${num(d.defaults.caps.daily)} / ${num(d.defaults.caps.weekly)} / ${num(d.defaults.caps.monthly)}`) + row("الحد اليومي حسب المستوى (1–2 / 3–4 / 5+)", `${num(d.defaults.caps.level12)} / ${num(d.defaults.caps.level34)} / ${num(d.defaults.caps.level5)}`) : ""}
        ${Object.entries(d.defaults?.sources || {}).map(([k, s]) => row(h(SRC[k] || k), `${num(s.amount)} MJT <small class="muted">${h(per(s))}</small>`)).join("")}</section>
      <section class="card"><h4>${ic("ban")} إيقاف طارئ لحساب</h4>
        <p class="muted">الإيقاف يُنهي جلسات الحساب ويمنعه من الدخول. لا يُحذف أي محتوى أو رصيد أو اشتراك أو مشتريات، ويمكن رفعه في أي وقت.</p>
        <form id="ow-f" class="u-g8"><label>اسم المستخدم<input name="handle" dir="ltr" required maxlength="60" autocomplete="off" placeholder="@handle"></label>
          <label>السبب (مطلوب للإيقاف)<input name="reason" maxlength="300" autocomplete="off"></label>
          <div class="u-g8 row"><button class="btn danger grow" type="submit" data-act="ban">إيقاف الحساب</button><button class="btn ghost grow" type="submit" data-act="unban">رفع الإيقاف</button></div>
          <p id="ow-r" class="muted" role="status" aria-live="polite"></p></form></section>`;
    const f = $("#ow-f");
    f?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const act = e.submitter?.dataset.act || "ban", handle = f.handle.value.trim(), reason = f.reason.value.trim();
      const out = $("#ow-r");
      if (!handle) return;
      if (act === "ban" && reason.length < 5) { if (out) out.textContent = "اكتب سبب الإيقاف (5 أحرف على الأقل)"; return; }
      if (act === "ban" && !confirm(`إيقاف @${handle.replace(/^@/, "")}؟`)) return;
      try { const r = await api("POST", "/api/owner/" + act, { handle, reason }); if (out) out.textContent = `${act === "ban" ? "أُوقف" : "رُفع الإيقاف عن"} @${r.member?.handle || handle}`; }
      catch (err) { if (out) out.textContent = err.message || "تعذّر التنفيذ"; }
    });
  }

  MPRoutes.add("owner", () => ownerView());
  window.MPOwner = { ownerView, version: "__APP_VERSION__" };
  if (/^#\/owner\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded && typeof route === "function") route();
})();
