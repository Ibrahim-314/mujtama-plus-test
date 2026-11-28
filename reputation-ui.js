/* =====================================================================
 * v2.166 — MJT phase 8.3 «السمعة 2». Rides the lazy `mjt` chunk (index.html data-chunk) and its mjt.css; 0 bytes in core.
 *   #/reputation              member page: your number, level and progress, and the 8 levels with what each adds (perks not
 *                             built yet say «قريباً»). Switch OFF → the route falls through to the usual not-found page,
 *                             exactly as before v2.166.
 *   v2.167: always on (no switch); the admin page #/admin/mjt-reputation was removed. «تقدير» received adds reputation.
 * Nothing here changes a balance, a point or the stored reputation: the unified number is derived on the server.
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function ReputationUI() {
  if (window.MPReputation) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s) => view.querySelector(s);
  const ic = (n, c = "sm") => (window.MPFeat ? MPFeat.ico(n, c) : UI.icon(n, c));
  const num = (n) => `<bdi dir="ltr" class="mj-n">${h(Number(n || 0).toLocaleString("en-US"))}</bdi>`;
  const page = (head, body) => { view.innerHTML = `<div class="wrap mj-page">${UI.pageHead({ ...head, id: "rp-h" })}${body}</div>`; $("#rp-h")?.focus({ preventScroll: true }); };
  const perk = (p) => `<li>${h(p.text)}${p.built ? "" : ` <span class="rp-soon">· قريباً</span>`}</li>`;
  const levelCard = (L, cur) => `<section class="card mj-sec rp-lv ${cur ? "cur" : ""}" ${cur ? 'aria-current="true"' : ""}>
      <h3 class="f-h">${ic(L.icon || "star")}<span>${h(L.level)}. ${h(L.name)}</span> <small class="muted">${num(L.at)}+</small>${cur ? ` <span class="sbadge ok">مستواك</span>` : ""}</h3>
      <ul>${L.perks.map(perk).join("")}</ul>
      ${L.opens.length ? `<p class="f-hint"><b>يُفتح للشراء بمجتمع كوين:</b> ${L.opens.map((o) => `${h(o.name)}${o.built ? "" : ` <span class="rp-soon">(قريباً)</span>`}`).join("، ")}</p>` : ""}</section>`;

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
        <div class="u-py8 u-bb row"><span class="grow">تقدير من الأعضاء</span>${num(me.breakdown.appreciation || 0)}</div>
        <div class="u-py8 row"><span class="grow">عقوبات سارية</span><bdi dir="ltr">${me.breakdown.penalties ? "−" : ""}${h(me.breakdown.penalties)}</bdi></div></section>` : ""}
      <section class="card mj-sec"><h3 class="f-h">${ic("info")}<span>ما هي السمعة؟</span></h3>
        <p>سمعتك تبيّن قد إيش المجتمع يثق فيك. تكبر لما محتواك يفيد الناس وتتصرف باحترام، وتنقص مع المخالفات. ما تنصرف، ولا تنقص بسبب الغياب، لكنها ترفع مستواك وتفتح لك مزايا.</p>
        <p class="f-hint">نقاط المساهمة السابقة محفوظة كلها وتدخل في حساب سمعتك. المستوى يضيف مزايا فقط ولا يسحب شيئاً موجوداً، ولا يضاعف مكافآت مجتمع كوين. العقوبات (من 10 إلى 200) تنتهي بعد ${h(r.penaltyMonths)} شهراً.</p></section>
      <h3 class="f-h">${ic("list")}<span>المستويات الثمانية</span></h3>
      ${r.levels.map((L) => levelCard(L, me && me.level === L.level)).join("")}`);
  }

  MPRoutes.add("reputation", (a, b, next) => memberView(next));
  window.MPReputation = { memberView, version: "2.167.0" };
  if (/^#\/(reputation|admin\/mjt-reputation)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
