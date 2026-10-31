/* =====================================================================
 * مجتمع بلس — Phase 59 UI: contribution points (lazy "points" chunk; 0 bytes in core).
 *   #/points        my points: level + progress, rank, how to earn, campaigns, history, leaderboard opt-out, redeem into Pi
 *   #/leaderboard   all time / this month / campaign leaderboards
 *   #/admin/points  rules + caps + trust, redemption rate / monthly cap / on-off, pool funding, pending redemptions (pay with txid
 *                   or reject), campaigns, scan now, manual adjustment. CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function PointsUI() {
  if (window.MPPoints) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const num = (x) => `<bdi dir="ltr">${Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: 7 })}</bdi>`;
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(iso)); } catch { return String(iso); } };
  const $ = (s) => view.querySelector(s);
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const page = (title, body, back, icon, actions) => { view.innerHTML = `<div class="wrap pt-page">${UI.pageHead({ back, title, icon, actions, id: "pt-h" })}${body}</div>`; $("#pt-h")?.focus({ preventScroll: true }); };
  const ST = { pending: "قيد التنفيذ", paid: "أُرسلت", rejected: "مرفوضة", active: "", reversed: "أُلغيت" };
  if (!document.getElementById("pts-css")) document.head.insertAdjacentHTML("beforeend", `<style id="pts-css">
.pt-page{max-width:720px;margin:auto}.pt-page [hidden]{display:none!important}.pt-page h2:focus{outline:none}.pts-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.pts-row .btn{min-height:44px}
.pt-hero b.big{font-size:40px;line-height:1.15;display:block;font-variant-numeric:tabular-nums}.pt-hero b.big small{font-size:var(--fs-md);font-weight:600}.pt-lv{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.pt-bar{height:8px;border-radius:999px;background:#ffffff38;overflow:hidden;margin:12px 0 6px}.pt-bar span{display:block;height:100%;background:#fff;border-radius:inherit}.pt-sm{font-size:var(--fs-sm)}.pt-xs{font-size:var(--fs-xs)}.pt-camp{padding:12px;margin-bottom:8px}.pt-sw{padding:4px var(--s4)}
.pts-list{list-style:none;margin:0 0 var(--s3);padding:0 var(--s4);background:var(--card);border-radius:var(--r);box-shadow:var(--sh-1)}.pts-list li{display:flex;gap:10px;align-items:center;min-height:48px;padding:8px 0;border-bottom:1px solid var(--line)}.pts-list li:last-child{border:0}.pts-list:empty{display:none}.pts-list .grow{flex:1}
.pt-lb{padding:0}.pt-lb li{padding:10px 16px;gap:12px;border-bottom:1px solid var(--line)}.pt-lb li:last-child{border-bottom:0}.pt-lb .grow{min-width:0;color:inherit;text-decoration:none}.pt-lb .grow b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pt-lb small{display:block;font-size:var(--fs-xs)}.pt-rk{width:32px;height:32px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:var(--fs-sm);background:var(--surface-sunken);color:var(--text-2);font-variant-numeric:tabular-nums}.pt-rk.top{background:var(--grad);color:var(--white)}.pt-rk.r1{box-shadow:0 0 0 3px color-mix(in srgb,var(--brand-3,#f5a524) 45%,transparent)}.pt-pts{text-align:end;flex:none}.pt-me{background:var(--accent-soft)}.pt-note{font-size:var(--fs-xs);margin-top:var(--s3)}
.pt-f label{display:block;margin-top:8px}.pt-f input:not([type=checkbox]),.pt-f select,.pt-f textarea{width:100%;min-height:44px;box-sizing:border-box}.pt-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.pt-mjt{display:flex;gap:12px;align-items:center;min-height:56px;padding:12px 16px;margin-bottom:var(--s3);color:inherit;text-decoration:none}.pt-mjt .grow b,.pt-mjt .grow span{display:block}.pt-mjt .chev{color:var(--muted)}
.pt-t{width:100%;border-collapse:collapse;font-size:14px}.pt-t th,.pt-t td{padding:8px 6px;border-bottom:1px solid var(--line,#eee);text-align:start}
</style>`);

  /* ---------- #/points ---------- */
  async function mineView() {
    page("نقاط المساهمة", `<div id="pt-m"><div class="skel"></div><div class="skel"></div></div>`, ["#/settings", "الإعدادات"], "star", `<a class="btn outline" href="#/leaderboard">${UI.icon("trophy", "sm")} لوحة الصدارة</a>`);
    let me, cfg, hist, camps;
    try { [me, cfg, hist, camps] = await Promise.all([api("GET", "/api/points/me"), api("GET", "/api/points/config"), api("GET", "/api/points/history"), api("GET", "/api/points/campaigns")]); } catch (e) { if ($("#pt-m")) $("#pt-m").innerHTML = errBox(e); return; }
    if (!$("#pt-m")) return; // v2.52: the member left this screen while it loaded
    const L = me.level, prog = L.next ? Math.round(((me.total - L.min) / (L.next.at - L.min)) * 100) : 100, R = me.redemption;
    $("#pt-m").innerHTML = `<section class="pt-hero f-cover"><span class="muted">رصيدك</span><b class="big">${num(me.total)} <small>نقطة</small></b><div class="pt-lv">${MPFeat.ico("medal", "sm")} المستوى ${num(L.level)}: <b>${h(L.name)}</b>${me.rank ? ` · الترتيب ${num(me.rank)}` : ""}</div>
        <div class="pt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${prog}" aria-label="التقدم إلى المستوى التالي"><span style="width:${prog}%"></span></div>
        <div class="muted pt-sm">${L.next ? `بقي ${num(L.next.remaining)} نقطة إلى «${h(L.next.name)}»` : "أعلى مستوى"}</div></section>
      ${me.minor ? `<div class="notice pts-note">نقاطك تُحتسب لمستواك، لكنها لا تُستبدل بمكافآت Pi ولا تظهر في لوحة الصدارة لمن هم دون ١٨ سنة.</div>` : ""}
      <h3 class="f-h">كيف تكسب النقاط؟</h3><ul class="pts-list">${cfg.kinds.map((k) => `<li><span class="grow">${h(k.label)}</span><span class="muted pt-xs">حتى ${num(cfg.rules.kinds[k.key]?.dailyCap ?? 0)} يومياً</span><span class="sbadge role">+${num(cfg.rules.kinds[k.key]?.points ?? 0)}</span></li>`).join("")}</ul>
      <p class="f-hint">النقاط للمساهمات المفيدة فقط، بحد أقصى ${cfg.rules.dailyCap} نقطة يومياً. التفاعل من حسابات مرتبطة أو مشبوهة لا يُحتسب، وتُلغى نقاط المحتوى المحذوف.</p>
      ${camps.items.length ? `<h3 class="f-h">حملات الموسم</h3>${camps.items.map((c) => `<section class="card pt-camp"><b>${h(c.name)}</b> ${c.live ? "· جارية" : "· قادمة"}<div class="muted">${h(c.description)} ${c.multiplier > 1 ? `· ×${c.multiplier}` : ""}${c.bonus ? ` · +${c.bonus}` : ""} · حتى ${day(c.endsAt)}</div><a href="#/leaderboard?p=${enc("campaign:" + c.id)}">لوحة صدارة الحملة</a></section>`).join("")}` : ""}
      <a class="card pt-mjt" href="#/mjt">${UI.icon("wallet")}<span class="grow"><b>مجتمع كوين (MJT)</b><span class="muted pt-sm">كل نقطة مساهمة جديدة تضيف 1 MJT إلى رصيدك داخل التطبيق</span></span><span class="chev" aria-hidden="true">←</span></a>
      ${R.reason === "mjt" ? "" : `<h3 class="f-h">استبدال النقاط بمكافأة Pi</h3>`}
      <div id="pt-r">${R.reason === "mjt" ? "" : R.available ? `<div class="notice pts-note">لديك ${num(me.redeemable)} نقطة قابلة للاستبدال. السعر: ${num(R.rate)} نقطة = 1 π. الحد الأدنى ${num(R.minPoints)} نقطة. المتاح في صندوق هذا الشهر ${num(R.leftThisMonth)} π.</div>
        <form id="pt-rf" class="pts-row"><input type="number" name="p" min="${R.minPoints}" max="${me.redeemable}" step="1" required aria-label="عدد النقاط" class="grow"><button class="btn">استبدال</button></form>` : `<div class="notice pts-note">${UI.icon("wallet")}<div>${h(R.note || "غير متاح")}</div></div>`}</div>
      <div class="card pt-sw"><label class="switch-row"><span>لا تُظهرني في لوحة الصدارة</span><input type="checkbox" role="switch" id="pt-oo" ${me.optOut ? "checked" : ""}></label></div>
      <h3 class="f-h">السجل</h3><ul class="pts-list" id="pt-hl"></ul><div class="f-more"><button type="button" class="btn outline" id="pt-more" hidden>المزيد</button></div>
      ${hist.redemptions.length ? `<h3 class="f-h">طلبات الاستبدال</h3><ul class="pts-list">${hist.redemptions.map((r) => `<li><span class="grow">${num(r.points)} نقطة → ${num(r.amount)} π</span><span>${h(ST[r.status] || r.status)}</span><span class="u-t-xs muted">${day(r.createdAt)}</span></li>`).join("")}</ul>` : ""}`;
    let next = hist.next;
    const add = (items) => $("#pt-hl").insertAdjacentHTML("beforeend", items.map((a) => `<li><span class="grow">${h(a.label)}${a.status === "reversed" ? " <s class='muted'>(أُلغيت)</s>" : ""}${a.redeemable ? "" : " <span class='muted' style='font-size:12px'>غير قابلة للاستبدال</span>"}</span><b>${a.points > 0 ? "+" : ""}${num(a.points)}</b><span class="u-t-xs muted">${day(a.createdAt)}</span></li>`).join("") || (next ? "" : `<li class="muted">لا نقاط بعد — ابدأ بإجابة سؤال أو تحسين صفحة ويكي</li>`));
    add(hist.items); $("#pt-more").hidden = !next;
    $("#pt-more").addEventListener("click", async () => { try { const r = await api("GET", "/api/points/history?cursor=" + enc(next)); next = r.next; add(r.items); $("#pt-more").hidden = !next; } catch (e) { say(e.message); } });
    $("#pt-oo").addEventListener("change", async (e) => { try { await api("PUT", "/api/points/leaderboard-optout", { optOut: e.target.checked }); say(e.target.checked ? "لن تظهر في لوحة الصدارة" : "ستظهر في لوحة الصدارة"); } catch (err) { say(err.message); } });
    $("#pt-rf")?.addEventListener("submit", async (e) => { e.preventDefault(); const p = +e.target.p.value; if (!confirm(`استبدال ${p} نقطة؟ لا يمكن التراجع بعد إرسال المكافأة.`)) return; try { const r = await api("POST", "/api/points/redeem", { points: p }); say(r.note); mineView(); } catch (err) { say(err.message); } });
  }

  /* ---------- #/leaderboard ---------- */
  async function boardView() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "").get("p") || "all";
    page("لوحة الصدارة", `<nav class="pt-chips seg" aria-label="الفترة"><a href="#/leaderboard?p=all" ${p === "all" ? 'class="on" aria-current="page"' : ""}>كل الأوقات</a><a href="#/leaderboard?p=month" ${p === "month" ? 'class="on" aria-current="page"' : ""}>هذا الشهر</a></nav><div id="pt-b"><div class="skel"></div></div>`, ["#/points", "نقاطي"]);
    let d; try { d = await api("GET", "/api/points/leaderboard?period=" + enc(p)); } catch (e) { if ($("#pt-b")) $("#pt-b").innerHTML = errBox(e); return; }
    if (!$("#pt-b")) return; // v2.52: the member left this screen while it loaded
    $("#pt-b").innerHTML = (d.items.length ? `<ol class="pts-list pt-lb list">${d.items.map((x) => `<li class="${x.me ? "pt-me" : ""}"><span class="pt-rk${x.rank <= 3 ? " top r" + x.rank : ""}" aria-label="المركز ${x.rank}">${num(x.rank)}</span><a class="grow" href="#/u/${enc(x.handle || "")}"><b>${h(x.name || "")}</b><small class="muted ltr-iso">@${h(x.handle || "")}</small></a><span class="pt-pts"><b class="num">${num(x.points)}</b>${x.level ? `<small class="muted">م${num(x.level)}</small>` : ""}</span></li>`).join("")}</ol>` : UI.empty({ title: "لا أحد في اللوحة بعد", text: "شارك وتفاعل لتجمع نقاط المساهمة وتظهر هنا.", action: `<a class="btn" href="#/points">كيف أجمع النقاط؟</a>` })) + `<p class="muted pt-note">${h(d.note)}</p>`;
  }

  /* ---------- #/admin/points ---------- */
  async function adminView() {
    page("إدارة نقاط المساهمة", `<div id="pt-a"><div class="skel"></div></div>`, ["#/admin", "الإدارة"]);
    let d, camps; try { [d, camps] = await Promise.all([api("GET", "/api/admin/points"), api("GET", "/api/admin/points/campaigns")]); } catch (e) { if ($("#pt-a")) $("#pt-a").innerHTML = errBox(e); return; }
    if (!$("#pt-a")) return; // v2.52: the member left this screen while it loaded
    const S = d.settings, P = d.pool, Rd = S.redemption;
    $("#pt-a").innerHTML = `<div class="pts-row"><button type="button" class="btn ghost" id="pt-scan">احتساب الآن</button></div>
      <h3 class="f-h">آخر ٣٠ يوماً</h3><table class="pt-t"><tr><th>النوع</th><th>مرات</th><th>نقاط</th></tr>${d.last30d.map((r) => `<tr><td>${h(r.label)}</td><td>${r.awards}</td><td>${num(r.points)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">لا شيء بعد</td></tr>`}</table>
      ${d.topToday.length ? `<h3 class="f-h">الأعلى اليوم</h3><ul class="pts-list">${d.topToday.map((t) => `<li><span class="grow">@${h(t.handle)}</span><b>${num(t.points)}</b>${t.atCap ? `<span class="muted">بلغ الحد</span>` : ""}</li>`).join("")}</ul>` : ""}
      <h3 class="f-h">القواعد ومكافحة التلاعب</h3><form id="pt-sf" class="pt-f"><div class="pt-g">${d.kinds.map((k) => `<div><label>${h(k.label)}<input type="number" min="0" name="k_${k.key}" value="${S.kinds[k.key].points}"></label><label>حد يومي<input type="number" min="0" name="c_${k.key}" value="${S.kinds[k.key].dailyCap}"></label></div>`).join("")}</div>
        <div class="pt-g"><label>الحد اليومي للنقاط<input type="number" name="dailyCap" value="${S.dailyCap}"></label><label>فاصل بين المكافآت (ثانية)<input type="number" name="cooldownSec" value="${S.cooldownSec}"></label><label>أدنى درجة ثقة (0–100)<input type="number" name="minTrust" value="${S.minTrust}"></label><label>أدنى عمر للحساب (يوم)<input type="number" name="minAccountDays" value="${S.minAccountDays}"></label><label>أقل عدد أشخاص لتفاعل حقيقي<input type="number" name="engagementMin" value="${S.engagementMin}"></label><label>عمر حساب المتفاعل (يوم)<input type="number" name="engagerMinAgeDays" value="${S.engagerMinAgeDays}"></label></div>
        <div class="pts-row"><button class="btn">حفظ القواعد</button></div></form>
      <h3 class="f-h">مكافآت Pi من صندوق المنصة</h3>
      <div class="pts-note">${P.piEnabled ? "" : "مدفوعات Pi غير مفعّلة بعد — الاستبدال والتمويل متوقفان حتى تفعيلها. "}الصندوق: <b>${num(P.poolBalance)} π</b> · سقف ${h(P.month)}: ${num(P.monthlyCap)} π · مستخدم: ${num(P.usedThisMonth)} π · الحالة: <b>${P.enabled ? "مفعّل" : "متوقف"}</b></div>
      <form id="pt-rf" class="pt-f"><div class="pt-g"><label>نقاط لكل 1 π<input type="number" min="0" name="rate" value="${Rd.rate}"></label><label>السقف الشهري (π)<input type="number" min="0" step="0.0000001" name="monthlyCap" value="${Rd.monthlyCap}"></label><label>الحد الأدنى للاستبدال<input type="number" min="1" name="minPoints" value="${Rd.minPoints}"></label><label>طلبات لكل مستخدم شهرياً<input type="number" min="1" name="perUserMonthly" value="${Rd.perUserMonthly}"></label></div>
        <label class="u-dflex u-g8 u-aic"><input type="checkbox" name="enabled" ${Rd.enabled ? "checked" : ""}> تفعيل الاستبدال</label><div class="pts-row"><button class="btn">حفظ</button></div></form>
      <form id="pt-ff" class="pts-row pt-f"><input type="number" min="0" step="0.0000001" name="amount" placeholder="مبلغ التمويل π" aria-label="مبلغ التمويل" class="u-f1"><input name="txid" placeholder="رقم المعاملة (اختياري)" aria-label="رقم المعاملة" dir="ltr" class="u-f1"><button class="btn ghost" ${P.piEnabled ? "" : "disabled"}>تمويل الصندوق</button></form>
      <h3 class="f-h">طلبات بانتظار الإرسال</h3>${d.pending.length ? d.pending.map((r) => `<section class="u-p12 u-mb8 card" data-r="${h(r.id)}"><b>@${h(r.handle)}</b> · ${num(r.points)} نقطة → <b>${num(r.amount)} π</b> <span class="muted">${day(r.createdAt)}</span>
        <div class="pts-row pt-f"><input data-tx placeholder="رقم معاملة Pi بعد الإرسال من محفظة التطبيق" aria-label="رقم المعاملة" dir="ltr" class="u-f1"><button type="button" class="btn" data-pay>تم الإرسال</button><button type="button" class="btn ghost" data-rej>رفض</button></div></section>`).join("") : `<div class="empty">لا طلبات</div>`}
      <h3 class="f-h">الحملات الموسمية</h3><ul class="pts-list">${camps.items.map((c) => `<li><span class="grow"><b>${h(c.name)}</b> <span class="muted">×${c.multiplier}${c.bonus ? " +" + c.bonus : ""} · ${day(c.startsAt)} – ${day(c.endsAt)}</span></span>${c.status === "active" ? `<button type="button" class="btn ghost" data-end="${h(c.id)}">إنهاء</button>` : `<span class="muted">منتهية</span>`}</li>`).join("") || `<li class="muted">لا حملات</li>`}</ul>
      <form id="pt-cf" class="pt-f"><div class="pt-g"><label>الاسم<input name="name" required></label><label>المضاعف<input type="number" step="0.1" min="1" max="5" name="multiplier" value="2"></label><label>مكافأة إضافية<input type="number" min="0" name="bonus" value="0"></label><label>تبدأ<input type="date" name="startsAt" required></label><label>تنتهي<input type="date" name="endsAt" required></label></div>
        <div class="pts-row">${d.kinds.map((k) => `<label class="u-dflex u-g4 u-aic u-m0"><input type="checkbox" name="kinds" value="${k.key}"> ${h(k.label)}</label>`).join("")}</div><div class="pts-row"><button class="btn ghost">إنشاء حملة</button></div></form>
      <h3 class="f-h">تعديل يدوي</h3><form id="pt-af" class="pts-row pt-f"><input name="handle" placeholder="@اسم_المستخدم" aria-label="المستخدم" dir="ltr" class="u-f1"><input type="number" name="points" placeholder="± نقاط" aria-label="النقاط" style="width:110px"><input name="reason" placeholder="السبب" aria-label="السبب" style="flex:2"><button class="btn ghost">تطبيق</button></form>
      <p class="u-t-xs muted">التعديل اليدوي لا يصبح قابلاً للاستبدال بـ Pi.</p>`;
    const go = async (fn, ok) => { try { await fn(); if (ok) say(ok); adminView(); } catch (e) { say(e.message); } };
    $("#pt-scan").addEventListener("click", () => go(async () => { const r = await api("POST", "/api/admin/points/scan"); say(`احتُسب: ${["answer_accepted", "engaged_post", "report_confirmed", "wiki_edit", "mentoring"].reduce((s, k) => s + (r[k] || 0), 0)} مكافأة`); }));
    $("#pt-sf").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target), kinds = {}; for (const k of d.kinds) kinds[k.key] = { points: +f.get("k_" + k.key), dailyCap: +f.get("c_" + k.key) }; const b = { kinds }; for (const n of ["dailyCap", "cooldownSec", "minTrust", "minAccountDays", "engagementMin", "engagerMinAgeDays"]) b[n] = +f.get(n); go(() => api("PUT", "/api/admin/points/settings", b), "حُفظت القواعد"); });
    $("#pt-rf").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); go(() => api("PUT", "/api/admin/points/settings", { redemption: { rate: +f.get("rate"), monthlyCap: +f.get("monthlyCap"), minPoints: +f.get("minPoints"), perUserMonthly: +f.get("perUserMonthly"), enabled: f.get("enabled") === "on" } }), "حُفظ"); });
    $("#pt-ff").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); if (!confirm(`تسجيل تمويل ${f.get("amount")} π في صندوق المكافآت؟`)) return; go(() => api("POST", "/api/admin/points/pool/fund", { amount: +f.get("amount"), txid: f.get("txid") || undefined }), "سُجّل التمويل"); });
    view.querySelectorAll("[data-r]").forEach((c) => {
      c.querySelector("[data-pay]").addEventListener("click", () => { const tx = c.querySelector("[data-tx]").value.trim(); if (!tx) return say("أدخل رقم المعاملة"); go(() => api("POST", `/api/admin/points/redemptions/${enc(c.dataset.r)}/pay`, { txid: tx }), "سُجّل الإرسال"); });
      c.querySelector("[data-rej]").addEventListener("click", () => { const n = prompt("سبب الرفض (تُعاد النقاط للمستخدم)"); if (n === null) return; go(() => api("POST", `/api/admin/points/redemptions/${enc(c.dataset.r)}/reject`, { note: n }), "رُفض الطلب"); });
    });
    view.querySelectorAll("[data-end]").forEach((b) => b.addEventListener("click", () => go(() => api("PUT", "/api/admin/points/campaigns/" + enc(b.dataset.end), { status: "ended" }), "انتهت الحملة")));
    $("#pt-cf").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); go(() => api("POST", "/api/admin/points/campaigns", { name: f.get("name"), multiplier: +f.get("multiplier"), bonus: +f.get("bonus"), kinds: f.getAll("kinds"), startsAt: new Date(f.get("startsAt")).toISOString(), endsAt: new Date(f.get("endsAt") + "T23:59:59").toISOString() }), "أُنشئت الحملة"); });
    $("#pt-af").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); go(() => api("POST", "/api/admin/points/adjust", { handle: f.get("handle"), points: +f.get("points"), reason: f.get("reason") }), "طُبّق"); });
  }

  MPRoutes.extend((a, b, prev) => {
    return { points: () => mineView(), leaderboard: () => boardView() };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "points" ? adminView() : next()));
  window.MPPoints = { mineView, boardView, adminView, version: "2.27.0" };
  if (/^#\/(points|leaderboard|admin\/points)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
