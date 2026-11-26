/* =====================================================================
 * v2.166 — MJT phase 8.3 «السمعة 2». Rides the lazy `mjt` chunk (index.html data-chunk) and its mjt.css; 0 bytes in core.
 *   #/reputation              member page: your number, level and progress, and the 8 levels with what each adds (perks not
 *                             built yet say «قريباً»). Switch OFF → the route falls through to the usual not-found page,
 *                             exactly as before v2.166.
 *   #/admin/mjt-reputation    admin: the «السمعة 2» switch (saved with a reason), level distribution, look up a member,
 *                             apply a penalty (−10…−200, expires after 12 months, reason required) and revoke one.
 * Nothing here changes a balance, a point or the stored reputation: the unified number is derived on the server.
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function ReputationUI() {
  if (window.MPReputation) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const ic = (n, c = "sm") => (window.MPFeat ? MPFeat.ico(n, c) : UI.icon(n, c));
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const num = (n) => `<bdi dir="ltr" class="mj-n">${h(Number(n || 0).toLocaleString("en-US"))}</bdi>`;
  const day = (s) => String(s || "").slice(0, 10);
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const page = (head, body) => { view.innerHTML = `<div class="wrap mj-page">${UI.pageHead({ ...head, id: "rp-h" })}${body}</div>`; $("#rp-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); return null; } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const failBox = (el, e, again) => { el.innerHTML = UI.empty({ title: "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم", action: `<button type="button" class="btn outline" data-rp-retry>إعادة المحاولة</button>` }); el.querySelector("[data-rp-retry]")?.addEventListener("click", () => again()); };
  const onOff = (on) => `<span class="sbadge ${on ? "ok" : ""}">${on ? "مفعّل" : "متوقف"}</span>`;
  const perk = (p) => `<li>${h(p.text)}${p.built ? "" : ` <span class="rp-soon">· قريباً</span>`}</li>`;
  const levelCard = (L, cur) => `<section class="card mj-sec rp-lv ${cur ? "cur" : ""}" ${cur ? 'aria-current="true"' : ""}>
      <h3 class="f-h">${ic(L.icon || "star")}<span>${h(L.level)}. ${h(L.name)}</span> <small class="muted">${num(L.at)}+</small>${cur ? ` <span class="sbadge ok">مستواك</span>` : ""}</h3>
      <ul>${L.perks.map(perk).join("")}</ul>
      ${L.opens.length ? `<p class="f-hint"><b>يُفتح للشراء بمجتمع كوين:</b> ${L.opens.map((o) => h(o.name)).join("، ")} <span class="rp-soon">· قريباً</span></p>` : ""}</section>`;

  /* ---------- #/reputation (member) ---------- */
  async function memberView(next) {
    let r; try { r = await api("GET", "/api/rep-levels"); } catch { r = null; }
    if (!r || !r.enabled) return next(); // switch off → exactly the pre-v2.166 behaviour (not-found page)
    const me = r.me;
    page({ title: "السمعة", icon: "star", sub: "رقم واحد يبيّن قد إيش المجتمع يثق فيك" },
      `${me ? `<section class="card mj-sec rp-me"><h3 class="f-h">${ic(me.icon || "star")}<span>${h(me.name)}</span> <small class="muted">المستوى ${h(me.level)} من 8</small></h3>
        <b class="u-t-lg">${num(me.score)} <span>سمعة</span></b>
        <progress max="100" value="${h(me.progress)}" aria-label="التقدّم للمستوى التالي"></progress>
        <small class="muted">${me.next ? `${num(me.next.remaining)} <span>للمستوى التالي</span>: ${h(me.next.name)} (${num(me.next.at)})` : "وصلت أعلى مستوى"}</small>
        <div class="u-py8 u-bb row"><span class="grow">جودة المحتوى والمشاركة</span>${num(me.breakdown.quality)}</div>
        <div class="u-py8 u-bb row"><span class="grow">المساهمات (نقاط المساهمة × ${h(String(r.pointsFactor ?? 0.5))})</span>${num(me.breakdown.contributions)}</div>
        <div class="u-py8 row"><span class="grow">عقوبات سارية</span><bdi dir="ltr">${me.breakdown.penalties ? "−" : ""}${h(me.breakdown.penalties)}</bdi></div></section>` : ""}
      <section class="card mj-sec"><h3 class="f-h">${ic("info")}<span>ما هي السمعة؟</span></h3>
        <p>سمعتك تبيّن قد إيش المجتمع يثق فيك. تكبر لما محتواك يفيد الناس وتتصرف باحترام، وتنقص مع المخالفات. ما تنصرف، ولا تنقص بسبب الغياب، لكنها ترفع مستواك وتفتح لك مزايا.</p>
        <p class="f-hint">نقاط المساهمة السابقة محفوظة كلها وتدخل في حساب سمعتك. المستوى يضيف مزايا فقط ولا يسحب شيئاً موجوداً، ولا يضاعف مكافآت مجتمع كوين. العقوبات (من 10 إلى 200) تنتهي بعد ${h(r.penaltyMonths)} شهراً.</p></section>
      <h3 class="f-h">${ic("list")}<span>المستويات الثمانية</span></h3>
      ${r.levels.map((L) => levelCard(L, me && me.level === L.level)).join("")}`);
  }

  /* ---------- #/admin/mjt-reputation ---------- */
  async function adminView() {
    const head = { title: "السمعة 2", icon: "star", sub: "السمعة الموحّدة ومستوياتها والعقوبات — للإدارة فقط", back: ["#/admin/rewards", "مكافآت مجتمع كوين"] };
    if (!signed()) { page(head, UI.empty({ title: "للإدارة فقط", text: "هذه الصفحة لمديري المنصة." })); return; }
    const nav = `<nav class="seg mj-seg" aria-label="حماية مكافآت مجتمع كوين"><a href="#/admin/mjt-safety">المفاتيح والسقوف</a><a href="#/admin/mjt-review">قائمة المراجعة</a><a href="#/admin/mjt-reputation" aria-current="page">السمعة</a></nav>`;
    page(head, `${nav}<div id="rp-a" aria-busy="true">${skel(5)}</div>`);
    const box = $("#rp-a");
    const load = async () => {
      let r; try { r = await api("GET", "/api/admin/reputation"); } catch (e) { box.removeAttribute("aria-busy"); failBox(box, e, load); return; }
      if (!box.isConnected) return;
      box.removeAttribute("aria-busy");
      const S = r.settings;
      const pen = (p) => `<li class="li"><span class="t"><b>@${h(p.member?.handle || "—")} · −${h(p.amount)} · ${h(p.kindLabel)}</b>
        <small>${h(p.reason)}</small><small>${h(day(p.createdAt))} ← ${h(day(p.expiresAt))} · ${p.status === "active" ? "سارية" : p.status === "expired" ? "منتهية" : "ملغاة"}${p.revokeReason ? " · " + h(p.revokeReason) : ""}</small></span>
        ${p.status === "active" ? `<span class="mj-acts"><button type="button" class="btn ghost" data-rv="${h(p.id)}">إلغاء</button></span>` : ""}</li>`;
      box.innerHTML = `<p class="mj-stage" role="note">${ic("lock", "xs")}<span>${h(r.note)}</span></p>
        <form id="rp-f"><section class="card mj-sec"><h3 class="f-h">${ic("star")}<span>السمعة الموحّدة والمستويات</span> ${onOff(S.enabled)}</h3>
          <p class="f-hint">عند التشغيل: يظهر للأعضاء مستواهم وتقدّمهم في الملف الشخصي وصفحة «السمعة»، ويُحسب السقف اليومي لمجتمع كوين من مستوى السمعة (1–2: 30 · 3–4: 40 · 5+: 50). عند الإيقاف: لا يتغيّر شيء للأعضاء.</p>
          <div class="rw-src"><fieldset><legend><b>الإعدادات</b></legend>
            <label class="chk"><input type="checkbox" name="enabled" ${S.enabled ? "checked" : ""}> تشغيل «السمعة 2» للأعضاء</label>
            <label>معامل نقاط المساهمة<input name="pointsFactor" inputmode="decimal" value="${h(S.pointsFactor)}"></label>
          </fieldset></div>
          <label class="sf-why">سبب التغيير (إلزامي)<input name="reason" required minlength="5"></label>
          <div class="mj-acts"><button class="btn">حفظ</button></div></section></form>
        <section class="card mj-sec"><h3 class="f-h">${ic("chart")}<span>توزيع الأعضاء على المستويات</span></h3>
          <ul class="list">${r.distribution.map((d) => `<li class="li"><span class="t"><b>${h(d.level)}. ${h(d.name)}</b></span>${num(d.members)}</li>`).join("")}</ul></section>
        <form id="rp-p"><section class="card mj-sec"><h3 class="f-h">${ic("flag")}<span>تطبيق عقوبة</span></h3>
          <p class="f-hint">من −10 إلى −200، تنتهي تلقائياً بعد ${h(r.penaltyMonths)} شهراً، وتُسجَّل مع السبب واسم المدير.</p>
          <div class="rw-src"><fieldset><legend><b>العقوبة</b></legend>
            <label>اسم المستخدم<input name="handle" required dir="ltr" placeholder="@handle"></label>
            <label>النوع<select name="kind">${r.kinds.map((k) => `<option value="${h(k.key)}">${h(k.label)}${k.amount ? " (−" + h(k.amount) + ")" : ""}</option>`).join("")}</select></label>
            <label>المقدار (10–200، اختياري)<input name="amount" inputmode="numeric"></label>
          </fieldset></div>
          <label class="sf-why">سبب العقوبة (إلزامي)<input name="reason" required minlength="5"></label>
          <div class="mj-acts"><button class="btn">تطبيق العقوبة</button></div></section></form>
        <section class="card mj-sec"><h3 class="f-h">${ic("clock")}<span>سجل العقوبات</span></h3>
          ${r.penalties.length ? `<ul class="list">${r.penalties.map(pen).join("")}</ul>` : `<p class="f-hint">لا عقوبات بعد.</p>`}</section>
        <section class="card mj-sec"><h3 class="f-h">${ic("list")}<span>المستويات</span></h3>
          <ul class="list">${r.levels.map((L) => `<li class="li"><span class="t"><b>${h(L.level)}. ${h(L.name)} · ${num(L.at)}</b><small>${h(L.badge)}</small></span></li>`).join("")}</ul></section>`;
      $("#rp-f").addEventListener("submit", (e) => {
        e.preventDefault(); const f = e.target;
        const body = { reason: f.elements.reason.value.trim(), enabled: f.elements.enabled.checked, pointsFactor: Number(f.elements.pointsFactor.value) };
        busy(e.submitter, async () => { await api("PUT", "/api/admin/reputation", body); say("حُفظت الإعدادات"); load(); });
      });
      $("#rp-p").addEventListener("submit", (e) => {
        e.preventDefault(); const f = e.target, a = f.elements.amount.value.trim();
        const body = { handle: f.elements.handle.value.trim(), kind: f.elements.kind.value, reason: f.elements.reason.value.trim(), ...(a ? { amount: Number(a) } : {}) };
        busy(e.submitter, async () => { await api("POST", "/api/admin/reputation/penalties", body); say("طُبّقت العقوبة"); load(); });
      });
      box.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", (e) => { const reason = prompt("سبب الإلغاء (إلزامي)"); if (!reason) return; busy(e.currentTarget, async () => { await api("POST", `/api/admin/reputation/penalties/${enc(b.dataset.rv)}/revoke`, { reason }); say("أُلغيت العقوبة"); load(); }); }));
    };
    load();
  }

  MPRoutes.add("reputation", (a, b, next) => memberView(next));
  MPRoutes.add("admin", (a, b, next) => (a === "mjt-reputation" ? adminView() : next()));
  window.MPReputation = { memberView, adminView, version: "2.166.0" };
  if (/^#\/(reputation|admin\/mjt-reputation)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
