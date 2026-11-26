/* =====================================================================
 * v2.165 — MJT phase 8.1 «محرك آمن» admin screens. Rides the lazy `mjt` chunk (index.html data-chunk) and its mjt.css;
 * 0 bytes in core. Admin only — the server answers 403 to members.
 *   #/admin/mjt-safety   the 8.1 switches (identity / linked-account checks, overall caps, course per lesson, active week),
 *                        all OFF by default, saved with a written reason; the new earn sources with their suggested values
 *                        and whether the app event behind them exists (amounts and caps are edited in #/admin/rewards).
 *   #/admin/mjt-review   the review queue: earns waiting for review and transfers held by the identity checks, with the
 *                        member's signals (account age, Pi, linked accounts); approve / reject (reject needs a reason).
 * Nothing here changes a balance by itself: an approval adds the reward / sends the transfer, a rejection moves nothing.
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function MjtSafetyUI() {
  if (window.MPMjtSafety) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => (window.MPFeat ? MPFeat.ico(n, c) : UI.icon(n, c));
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const amt = (s) => `<bdi dir="ltr" class="mj-n">${h(s)}</bdi>`;
  const day = (s) => { try { return new Intl.DateTimeFormat(window.MPI18n && MPI18n.current() === "en" ? "en" : "ar", { numberingSystem: "latn", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(s)); } catch { return String(s || "").slice(0, 16); } };
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const page = (head, body) => { view.innerHTML = `<div class="wrap mj-page">${UI.pageHead({ ...head, id: "sf-h" })}${body}</div>`; $("#sf-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); return null; } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const failBox = (el, e, again) => { el.innerHTML = UI.empty({ title: "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم", action: `<button type="button" class="btn outline" data-sf-retry>إعادة المحاولة</button>` }); el.querySelector("[data-sf-retry]")?.addEventListener("click", () => again()); };
  const onOff = (on) => `<span class="sbadge ${on ? "ok" : ""}">${on ? "مفعّل" : "متوقف"}</span>`;
  const chk = (name, on, label) => `<label class="chk"><input type="checkbox" name="${name}" ${on ? "checked" : ""}> ${h(label)}</label>`;
  const num = (name, v, label) => `<label>${h(label)}<input name="${name}" inputmode="numeric" value="${h(v)}"></label>`;
  const nav = (cur) => `<nav class="seg mj-seg" aria-label="حماية مكافآت مجتمع كوين"><a href="#/admin/mjt-safety" ${cur === "safety" ? 'aria-current="page"' : ""}>المفاتيح والسقوف</a><a href="#/admin/mjt-review" ${cur === "review" ? 'aria-current="page"' : ""}>قائمة المراجعة</a><a href="#/admin/mjt-reputation">السمعة</a></nav>`;

  const capTxt = (g) => [[g.dailyCap, "يومياً"], [g.weeklyCap, "أسبوعياً"], [g.monthlyCap, "شهرياً"]].filter(([v]) => v).map(([v, l]) => " · " + h(v) + " " + l).join("");
  /* ---------- #/admin/mjt-safety ---------- */
  async function safetyView() {
    const head = { title: "حماية مكافآت مجتمع كوين", icon: "shield", sub: "ضوابط الهوية والسقوف الشاملة ومصادر الكسب الجديدة — للإدارة فقط", back: ["#/admin/rewards", "مكافآت مجتمع كوين"] };
    if (!signed()) { page(head, UI.empty({ title: "للإدارة فقط", text: "هذه الصفحة لمديري المنصة." })); return; }
    page(head, `${nav("safety")}<div id="sf-a" aria-busy="true">${skel(5)}</div>`);
    const box = $("#sf-a");
    const load = async () => {
      let r; try { r = await api("GET", "/api/admin/mjt/safety"); } catch (e) { box.removeAttribute("aria-busy"); failBox(box, e, load); return; }
      if (!box.isConnected) return;
      box.removeAttribute("aria-busy");
      const I = r.settings.identity, C = r.settings.caps, K = r.settings.course;
      box.innerHTML = `<p class="mj-stage" role="note">${ic("lock", "xs")}<span>${h(r.note)}</span></p>
        <form id="sf-f">
        <section class="card mj-sec"><h3 class="f-h">${ic("shield")}<span>ضوابط الهوية والحسابات المرتبطة</span> ${onOff(I.enabled)}</h3>
          <p class="f-hint">عند التشغيل: المكافأة التي لا تجتاز الفحص تنتظر «قيد المراجعة» ولا تضيع، والتحويل يُحجز للمراجعة ولا يُخصم شيء حتى توافق الإدارة.</p>
          <div class="rw-src"><fieldset><legend><b>الفحص</b></legend>
            ${chk("i_enabled", I.enabled, "تشغيل ضوابط الهوية")}
            ${num("i_minAccountDays", I.minAccountDays, "أقل عمر للحساب (أيام)")}
            ${chk("i_requirePi", I.requirePi, "يشترط حساباً موثّقاً بـ Pi")}
            ${chk("i_linkedDetection", I.linkedDetection, "كشف الحسابات المرتبطة")}
            ${chk("i_sharedIp", I.sharedIp, "يشمل عنوان IP المشترك")}
            ${num("i_ipMaxAccounts", I.ipMaxAccounts, "تجاهل عنوان يشترك فيه أكثر من (حسابات)")}
            ${num("i_clusterMin", I.clusterMin, "مجموعة مرتبطة من (حسابات)")}
            ${num("i_fanInSenders", I.fanInSenders, "تحويلات من حسابات ضعيفة إلى حساب واحد (عدد المرسلين)")}
            ${num("i_fanInDays", I.fanInDays, "خلال (أيام)")}
            ${chk("i_applyEarn", I.applyEarn, "يطبّق على المكافآت")}
            ${chk("i_applyTransfers", I.applyTransfers, "يطبّق على التحويل بين الأعضاء")}
          </fieldset></div></section>
        <section class="card mj-sec"><h3 class="f-h">${ic("chart")}<span>السقوف الشاملة للكسب</span> ${onOff(C.enabled)}</h3>
          <p class="f-hint">لكل عضو من كل مصادر المكافآت معاً. ما يتجاوز السقف لا يُضاف.</p>
          <div class="rw-src"><fieldset><legend><b>السقوف (MJT)</b></legend>
            ${chk("c_enabled", C.enabled, "تشغيل السقوف الشاملة")}
            ${num("c_daily", C.daily, "يومي")}${num("c_weekly", C.weekly, "أسبوعي")}${num("c_monthly", C.monthly, "شهري")}
            ${chk("c_byLevel", C.byLevel, "السقف اليومي حسب المستوى")}
            ${num("c_level12", C.level12, "المستوى 1–2")}${num("c_level34", C.level34, "المستوى 3–4")}${num("c_level5", C.level5, "المستوى 5 فأعلى")}
            ${chk("c_countLegacy", C.countLegacy, "يحتسب التعدين والدخول ونقاط المساهمة ضمن السقف")}
          </fieldset></div></section>
        <section class="card mj-sec"><h3 class="f-h">${ic("award")}<span>إعدادات المصادر الجديدة</span></h3>
          <div class="rw-src"><fieldset><legend><b>إكمال دورة وأسبوع نشِط</b></legend>
            ${chk("k_perLesson", K.perLesson, "إكمال دورة: مبلغ لكل درس")}
            ${num("k_amountPerLesson", K.amountPerLesson, "لكل درس")}${num("k_min", K.min, "أقل مبلغ")}${num("k_max", K.max, "أعلى مبلغ")}
            ${num("w_days", r.settings.activeWeek.days, "أيام النشاط لأسبوع نشِط")}
            ${num("n_days", r.settings.newcomerDays, "العضو الجديد: عمر حسابه أقل من (أيام)")}
          </fieldset></div>
          <label class="sf-why">سبب التغيير (إلزامي)<input name="reason" required minlength="5"></label>
          <div class="mj-acts"><button class="btn">حفظ الإعدادات</button></div></section>
        </form>
        <section class="card mj-sec"><h3 class="f-h">${ic("list")}<span>مصادر الكسب</span></h3>
          <p class="f-hint">لكل مصدر مفتاحه الخاص ويبدأ متوقفاً وبلا مبلغ. حدّد المبلغ والحدود وفعّله من <a href="#/admin/rewards">مكافآت مجتمع كوين</a>.</p>
          <ul class="list">${r.sources.map((x) => `<li class="li"><span class="t"><b>${h(x.label)} ${onOff(x.enabled)}</b>
            <small>المقترح: ${amt(x.suggested.amount)} MJT${capTxt(x.suggested)} · الحالي: ${x.amount === null ? "غير محدد" : amt(x.amount) + " MJT"}</small>
            <small><span>${x.wired ? "موصول" : "غير موصول"}</span> — ${h(x.event)}</small></span></li>`).join("")}</ul></section>`;
      $("#sf-f").addEventListener("submit", (e) => {
        e.preventDefault(); const f = e.target, v = (n) => f.elements[n].value.trim(), c = (n) => f.elements[n].checked;
        const body = { reason: v("reason"), newcomerDays: +v("n_days"),
          identity: { enabled: c("i_enabled"), minAccountDays: +v("i_minAccountDays"), requirePi: c("i_requirePi"), linkedDetection: c("i_linkedDetection"), sharedIp: c("i_sharedIp"), ipMaxAccounts: +v("i_ipMaxAccounts"), clusterMin: +v("i_clusterMin"), fanInSenders: +v("i_fanInSenders"), fanInDays: +v("i_fanInDays"), applyEarn: c("i_applyEarn"), applyTransfers: c("i_applyTransfers") },
          caps: { enabled: c("c_enabled"), daily: +v("c_daily"), weekly: +v("c_weekly"), monthly: +v("c_monthly"), byLevel: c("c_byLevel"), level12: +v("c_level12"), level34: +v("c_level34"), level5: +v("c_level5"), countLegacy: c("c_countLegacy") },
          course: { perLesson: c("k_perLesson"), amountPerLesson: +v("k_amountPerLesson"), min: +v("k_min"), max: +v("k_max") }, activeWeek: { days: +v("w_days") } };
        busy(e.submitter, async () => { await api("PUT", "/api/admin/mjt/safety", body); say("حُفظت الإعدادات"); load(); });
      });
    };
    load();
  }

  /* ---------- #/admin/mjt-review ---------- */
  async function reviewView() {
    const head = { title: "قائمة مراجعة مجتمع كوين", icon: "clock", sub: "مكافآت وتحويلات تنتظر قرار الإدارة — للإدارة فقط", back: ["#/admin/rewards", "مكافآت مجتمع كوين"] };
    if (!signed()) { page(head, UI.empty({ title: "للإدارة فقط", text: "هذه الصفحة لمديري المنصة." })); return; }
    const kind = ["earn", "transfer"].includes(qs().get("kind")) ? qs().get("kind") : "all";
    page(head, `${nav("review")}<nav class="seg mj-seg" aria-label="النوع">${[["all", "الكل"], ["earn", "مكافآت"], ["transfer", "تحويلات"]].map(([k, l]) => `<a href="#/admin/mjt-review?kind=${k}" ${k === kind ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav><div id="sf-q" aria-busy="true">${skel(4)}</div>`);
    const box = $("#sf-q");
    const load = async () => {
      let r; try { r = await api("GET", "/api/admin/mjt/review?kind=" + kind); } catch (e) { box.removeAttribute("aria-busy"); failBox(box, e, load); return; }
      if (!box.isConnected) return;
      box.removeAttribute("aria-busy");
      const who = (m) => (m ? `@${h(m.handle)}` : "—");
      const item = (x) => `<li class="li"><span class="t"><b>${x.kind === "earn" ? `${who(x.member)} · مكافأة: ${h(x.sourceLabel || "")}` : `${who(x.from)} ← ${who(x.to)} · تحويل`}</b>
        <small>${h(day(x.createdAt))} · ${h(x.reasonsText || "")}</small></span><span class="mj-amt in">${amt(x.amount)}</span>
        <span class="mj-acts"><button type="button" class="btn" data-ok="${h(x.kind)}:${h(x.id)}">موافقة</button><button type="button" class="btn ghost" data-no="${h(x.kind)}:${h(x.id)}">رفض</button></span></li>`;
      const linkedTxt = (s) => (s.linked ? h(s.linked) + " " + "حساب مرتبط" : "لا حسابات مرتبطة");
      const sig = (s) => [s.ageDays === null ? "—" : h(s.ageDays) + " " + "يوم", s.piLinked ? "موثّق بـ Pi" : "غير موثّق بـ Pi", linkedTxt(s), s.flagged ? "معلَّم" : ""].filter(Boolean).join(" · ");
      box.innerHTML = `<p class="mj-stage" role="note">${ic("lock", "xs")}<span>${h(r.note)}</span></p>
        <p class="f-hint"><span>ضوابط الهوية:</span> ${onOff(r.switches.identity)} · <span>السقوف الشاملة:</span> ${onOff(r.switches.caps)} — <a href="#/admin/mjt-safety">المفاتيح والسقوف</a></p>
        <section class="card mj-sec"><h3 class="f-h">${ic("clock")}<span>بانتظار القرار</span> <small class="muted">${h(r.counts.earn)} <span>مكافأة</span> · ${h(r.counts.transfer)} <span>تحويل</span></small></h3>
          ${r.items.length ? `<ul class="list">${r.items.map(item).join("")}</ul>` : `<p class="f-hint">لا شيء بانتظار المراجعة.</p>`}</section>
        <section class="card mj-sec"><h3 class="f-h">${ic("users")}<span>الأعضاء في القائمة</span></h3>
          ${r.members.length ? `<ul class="list">${r.members.map((m) => `<li class="li"><span class="t"><b>${who(m.member)}</b><small>${h(m.earns)} <span>مكافأة</span> · ${h(m.transfers)} <span>تحويل</span> · ${sig(m.signals)}</small></span></li>`).join("")}</ul>` : `<p class="f-hint">لا أعضاء مشتبه بهم الآن.</p>`}</section>`;
      const act = (b, ok) => { const [k, id] = b.split(":"); return { k, id, ok }; };
      box.querySelectorAll("[data-ok]").forEach((b) => b.addEventListener("click", (e) => { const a = act(b.dataset.ok, true); busy(e.currentTarget, async () => { await api("POST", `/api/admin/mjt/review/${enc(a.k)}/${enc(a.id)}/approve`, {}); say("تمت الموافقة"); load(); }); }));
      box.querySelectorAll("[data-no]").forEach((b) => b.addEventListener("click", (e) => { const a = act(b.dataset.no, false); const reason = prompt("سبب الرفض (إلزامي)"); if (!reason) return; busy(e.currentTarget, async () => { await api("POST", `/api/admin/mjt/review/${enc(a.k)}/${enc(a.id)}/reject`, { reason }); say("رُفض الطلب"); load(); }); }));
    };
    load();
  }

  MPRoutes.add("admin", (a, b, next) => (a === "mjt-safety" ? safetyView() : a === "mjt-review" ? reviewView() : next()));
  window.MPMjtSafety = { safetyView, reviewView, version: "2.165.0" };
  if (/^#\/admin\/mjt-(safety|review)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
