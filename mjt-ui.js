/* =====================================================================
 * v2.47 — «مجتمع كوين» (MJT) stage 1 UI (lazy chunk `mjt`, loads after `feat`; styles in mjt.css). 0 bytes in core.
 *   #/mjt[?tab=history|earn|send]   balance (in-app only, not on any blockchain), today's rewards vs the cap, conversion note,
 *                                   history (keyset «المزيد»), how to earn, send to a member (idempotency key per attempt),
 *                                   receive on/off, Pi → MJT purchase shown as unavailable while Pi payments are off
 *   #/admin/mjt                     staff: supply + ledger verification, conversion dry run / apply / rollback, settings,
 *                                   adjustments with a reason, freeze, recent transactions
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function MjtUI() {
  if (window.MPMjt) return;
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
  const errBox = (e) => UI.empty({ title: "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم" });
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const page = (head, body) => { view.innerHTML = `<div class="wrap mj-page">${UI.pageHead({ ...head, id: "mj-h" })}${body}</div>`; $("#mj-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); return null; } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const newKey = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* fallback below */ } const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, "0")).join(""); };
  const KIND_ICO = { reward: "award", conversion: "swap", conversion_reversal: "swap", transfer: "send", tip: "gift", adjustment: "shield", clawback: "flag", spend: "bag", refund: "refresh" };
  const STAGE = "رصيد داخل التطبيق فقط — ليس عملة على أي بلوكشين، ولا يُسحب ولا يُباع.";

  /* ---------- #/mjt ---------- */
  async function walletView() {
    if (!signed()) { page({ title: "مجتمع كوين", icon: "wallet" }, UI.empty({ title: "سجّل الدخول", text: "لترى رصيدك من مجتمع كوين وتكسب المزيد بمساهماتك.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` })); return; }
    const tab = ["history", "earn", "send"].includes(qs().get("tab")) ? qs().get("tab") : "history";
    page({ title: "مجتمع كوين", icon: "wallet", sub: "MJT — رصيدك داخل التطبيق", back: ["#/settings?s=money", "المدفوعات والمحفظة"] }, `<div id="mj-w">${skel(4)}</div>`);
    const box = $("#mj-w");
    let me, cfg; try { [me, cfg] = await Promise.all([api("GET", "/api/mjt/me"), api("GET", "/api/mjt/config")]); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    const earned = Number(me.today.earned), cap = Number(me.today.cap) || 1;
    box.innerHTML = `<section class="f-cover mj-hero" aria-labelledby="mj-bal-l">
        <span class="mj-lbl" id="mj-bal-l">رصيدك</span>
        <p class="mj-big">${amt(me.balance.mjt)} <small>MJT</small></p>
        <p class="mj-stage">${ic("lock", "xs")}<span>${h(STAGE)}</span></p>
        <div class="mj-today"><label for="mj-prog">مكافآت اليوم: ${amt(me.today.earned)} من ${amt(me.today.cap)} MJT</label><progress id="mj-prog" max="${cap}" value="${Math.min(earned, cap)}"></progress></div>
        <div class="mj-acts"><a class="btn" href="#/mjt?tab=send">${ic("send")}إرسال</a><button type="button" class="btn ghost" id="mj-buy" aria-describedby="mj-buy-n">${ic("coin")}شراء بـ Pi</button></div>
        <p class="mj-buy-n" id="mj-buy-n">${h(cfg.buy.note)}</p></section>
      ${me.conversion ? `<p class="notice">${ic("swap")}<span>حوّلنا ${amt(me.conversion.pts)} نقطة مساهمة إلى ${amt(me.conversion.mjt)} MJT بسعر ${h(cfg.rate.text)}. نقاطك ومستواك باقية كما هي.</span></p>` : ""}
      ${me.frozen ? `<p class="notice warn">${ic("lock")}<span>محفظتك موقوفة مؤقتاً للمراجعة: يمكنك الاستلام فقط. <a href="#/tickets">تواصل مع الدعم</a>.</span></p>` : ""}
      ${!me.verified ? `<p class="notice warn" role="alert">${ic("alert")}<span>نراجع رصيدك الآن. لا داعي لأي إجراء.</span></p>` : ""}
      <nav class="seg mj-seg" aria-label="مجتمع كوين"><a href="#/mjt?tab=history" ${tab === "history" ? 'aria-current="page"' : ""}>السجل</a><a href="#/mjt?tab=earn" ${tab === "earn" ? 'aria-current="page"' : ""}>طرق الكسب</a><a href="#/mjt?tab=send" ${tab === "send" ? 'aria-current="page"' : ""}>إرسال</a></nav>
      <div id="mj-tab"></div>`;
    $("#mj-buy").addEventListener("click", (e) => busy(e.currentTarget, async () => { try { await api("POST", "/api/mjt/buy", {}); } catch (err) { say(err.message); } }));
    const t = $("#mj-tab");
    if (tab === "earn") earnTab(t, cfg);
    else if (tab === "send") sendTab(t, me, cfg);
    else historyTab(t);
  }
  async function historyTab(t) {
    t.innerHTML = skel(3);
    let d; try { d = await api("GET", "/api/mjt/history"); } catch (e) { t.innerHTML = errBox(e); return; }
    if (!t.isConnected) return;
    if (!d.items.length) { t.innerHTML = UI.empty({ title: "لا حركات بعد", text: "ساهم بإجابة مفيدة أو تحسين صفحة في الويكي لتكسب أول مجتمع كوين.", action: `<a class="btn outline" href="#/mjt?tab=earn">طرق الكسب</a>` }); return; }
    t.innerHTML = `<ul class="list mj-hist" id="mj-hl"></ul><div class="f-more"><button type="button" class="btn outline" id="mj-more">المزيد</button></div>`;
    let next = d.next;
    const row = (i) => { const neg = i.amount.startsWith("-"); return `<li class="li"><span class="ico">${ic(KIND_ICO[i.kind] || "wallet")}</span><span class="t"><b>${h(i.label)}${i.with ? ` · <bdi>${h(i.with.name || "")}</bdi>` : ""}</b><small>${h(day(i.createdAt))}${i.note ? ` · ${h(i.note)}` : ""}${i.post ? ` · <a href="#/post/${enc(i.post)}">عرض اللقطة</a>` : ""}${i.room ? ` · <a href="#/room/${enc(i.room)}">البث</a>` : ""}</small></span><span class="mj-amt ${neg ? "out" : "in"}">${amt((neg ? "" : "+") + i.amount)}<small>الرصيد ${amt(i.balanceAfter)}</small></span></li>`; };
    const add = (items) => $("#mj-hl").insertAdjacentHTML("beforeend", items.map(row).join(""));
    const more = () => { if (!next) $("#mj-more")?.closest(".f-more")?.remove(); }; // `hidden` loses to .btn's display
    add(d.items); more();
    $("#mj-more")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { const r = await api("GET", "/api/mjt/history?cursor=" + enc(next)); next = r.next; add(r.items); more(); }));
  }
  function earnTab(t, cfg) {
    t.innerHTML = `<section class="card mj-sec"><h3 class="f-h">${ic("award")}تكسب مجتمع كوين بمساهماتك</h3>
        <p class="mj-rate">${h(cfg.rate.text)}</p>
        <ul class="list mj-kinds">${cfg.earn.kinds.map((k) => `<li class="li"><span class="t"><b>${h(k.label)}</b>${k.dailyCap != null ? `<small>حتى ${amt(k.dailyCap)} مرات يومياً</small>` : ""}</span><span class="sbadge role">${amt("+" + k.mjt + " MJT")}</span></li>`).join("")}</ul>
        <p class="f-hint">بحد أقصى ${amt(cfg.earn.dailyCap)} MJT من المكافآت يومياً. لا تُحتسب المساهمات من حسابات جديدة جداً أو مرتبطة أو مشبوهة، ويُسترجع ما كُسب من محتوى حُذف.${cfg.earn.enabled ? "" : " المكافآت متوقفة مؤقتاً."}</p>
        <p><a class="btn outline" href="#/points">${ic("trophy")}نقاط المساهمة ومستواك</a></p></section>
      <section class="card mj-sec"><h3 class="f-h">${ic("help")}عن مجتمع كوين</h3>
        <ul class="mj-facts"><li>${h(cfg.token.stageNote)}</li><li>لا يُشترى الآن بـ Pi: ${h(cfg.buy.note)}.</li><li>التحويل بين الأعضاء بحدود: ${amt(cfg.transfers.maxSingle)} MJT للتحويل الواحد و${amt(cfg.transfers.maxDaily)} MJT يومياً.</li><li>من هم دون ١٨ سنة يكسبون ولا يحوّلون.</li></ul></section>`;
  }
  function sendTab(t, me, cfg) {
    const off = !me.send.allowed;
    t.innerHTML = `<section class="card mj-sec"><h3 class="f-h">${ic("send")}إرسال إلى عضو</h3>
        ${off ? `<p class="notice">${ic("lock")}<span>${h(me.send.note)}</span></p>` : ""}
        <form class="f-form mj-send" id="mj-sf" novalidate>
          <label>إلى<input name="to" required autocomplete="off" dir="ltr" placeholder="@handle" maxlength="60" ${off ? "disabled" : ""}></label>
          <label>المبلغ (MJT)<input name="amount" required inputmode="decimal" dir="ltr" autocomplete="off" placeholder="0" maxlength="17" ${off ? "disabled" : ""}></label>
          <label>ملاحظة <small>(اختياري)</small><input name="note" maxlength="140" ${off ? "disabled" : ""}></label>
          <p class="f-err" id="mj-err" role="alert" hidden></p>
          <p class="f-hint">رصيدك ${amt(me.balance.mjt)} MJT · أرسلت اليوم ${amt(me.today.sent)} من ${amt(me.today.sendLimit)} MJT · حد التحويل الواحد ${amt(cfg.transfers.maxSingle)} MJT. التحويل نهائي ولا يُسترد.</p>
          <div class="mj-acts"><button class="btn" type="submit" ${off ? "disabled" : ""}>${ic("send")}إرسال</button></div></form></section>
      <section class="card mj-sec"><label class="switch-row mj-sw"><span><b>استقبال التحويلات</b><small>عند الإيقاف لا يستطيع أحد إرسال مجتمع كوين إليك</small></span><input type="checkbox" role="switch" class="switch" id="mj-rcv" ${me.receive ? "checked" : ""}></label></section>`;
    const f = $("#mj-sf"), err = $("#mj-err");
    let ikey = newKey(); // one key per attempt: a retried request (double tap, flaky network) is answered once
    f.addEventListener("input", () => { ikey = newKey(); err.hidden = true; });
    f.addEventListener("submit", (e) => {
      e.preventDefault(); err.hidden = true;
      const to = f.to.value.trim().replace(/^@/, ""), amount = f.amount.value.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace("٫", ".");
      if (!to || !/^\d{1,8}(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) { err.textContent = !to ? "اكتب اسم المستخدم" : "اكتب مبلغاً صحيحاً (حتى ٧ منازل عشرية)"; err.hidden = false; (to ? f.amount : f.to).focus(); return; }
      if (!confirm(`إرسال ${amount} MJT إلى @${to}؟ لا يمكن التراجع.`)) return;
      busy(e.submitter, async () => {
        try {
          const r = await api("POST", "/api/mjt/transfers", { to, amount, note: f.note.value.trim() || undefined, ikey });
          ikey = newKey(); say(`أُرسل ${r.transfer.amount} MJT إلى ${r.transfer.to?.name || "@" + to}`); location.hash = "#/mjt?tab=history";
        } catch (x) { err.textContent = x.message; err.hidden = false; }
      });
    });
    $("#mj-rcv").addEventListener("change", (e) => busy(null, async () => { const r = await api("PUT", "/api/mjt/receive", { receive: e.target.checked }); say(r.receive ? "سيصلك ما يرسله الأعضاء" : "أوقفت استقبال التحويلات"); }));
  }

  /* ---------- #/admin/mjt ---------- */
  async function adminView() {
    page({ title: "إدارة مجتمع كوين", icon: "wallet", back: ["#/admin", "الإدارة"] }, `<div id="mj-a">${skel(4)}</div>`);
    const box = $("#mj-a");
    let d; try { d = await api("GET", "/api/admin/mjt"); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return;
    const S = d.settings;
    box.innerHTML = `<p class="notice">${ic("lock")}<span>${h(d.token.stageNote)}</span></p>
      <div class="f-kpis"><div class="kpi-tile"><span>المتداول</span><b>${amt(d.supply.circulating)}</b></div><div class="kpi-tile"><span>المُصدَر</span><b>${amt(d.supply.minted)}</b></div><div class="kpi-tile"><span>المحروق</span><b>${amt(d.supply.burned)}</b></div><div class="kpi-tile"><span>حاملون</span><b>${UI.num(d.supply.holders)}</b></div></div>
      <section class="card mj-sec"><h3 class="f-h">${ic("check")}سلامة الدفتر</h3><p class="${d.verify.ok ? "mj-ok" : "mj-bad"}" role="status">${d.verify.ok ? "متوازن: كل رصيد يطابق قيوده، ومجموع كل معاملة صفر، ولا رصيد سالب." : "تنبيه: " + h(d.verify.problems.join("، "))}</p><p class="f-hint">آخر فحص ${h(day(d.verify.checkedAt))} · خزينة المنصة ${amt(d.supply.treasury)} MJT</p></section>
      <section class="card mj-sec"><h3 class="f-h">${ic("swap")}تحويل نقاط المساهمة (1 نقطة = 1 MJT)</h3>
        <div class="mj-acts"><button type="button" class="btn outline" id="mj-dry">تجربة بلا كتابة</button><button type="button" class="btn" id="mj-apply">تطبيق التحويل</button></div><div id="mj-dr"></div>
        ${d.batches.length ? `<ul class="list mj-batches">${d.batches.map((b) => `<li class="li"><span class="t"><b>${h(b.id)} · ${b.status === "applied" ? "مطبّق" : "أُلغي"}</b><small>${UI.num(b.users)} عضو · ${amt(b.amount)} MJT · ${h(day(b.createdAt))}</small></span>${b.status === "applied" ? `<button type="button" class="btn ghost sm" data-rb="${h(b.id)}">إلغاء</button>` : ""}</li>`).join("")}</ul>` : `<p class="f-hint">لم يُطبّق تحويل بعد.</p>`}</section>
      <section class="card mj-sec"><h3 class="f-h">${ic("settings")}الإعدادات</h3><form class="f-form" id="mj-set">
        <label class="switch-row"><span>المكافآت مفعّلة</span><input type="checkbox" role="switch" class="switch" name="rew" ${S.rewards.enabled ? "checked" : ""}></label>
        <label>الحد اليومي للمكافآت (MJT)<input name="cap" dir="ltr" inputmode="decimal" value="${h(S.rewards.dailyCap)}"></label>
        <label class="switch-row"><span>التحويل بين الأعضاء مفعّل</span><input type="checkbox" role="switch" class="switch" name="tr" ${S.transfers.enabled ? "checked" : ""}></label>
        <label>حد التحويل الواحد (MJT)<input name="single" dir="ltr" inputmode="decimal" value="${h(S.transfers.maxSingle)}"></label>
        <label>الحد اليومي للتحويل (MJT)<input name="daily" dir="ltr" inputmode="decimal" value="${h(S.transfers.maxDaily)}"></label>
        <label>تحويلات في الساعة<input name="hour" type="number" min="1" dir="ltr" value="${S.transfers.maxPerHour}"></label>
        <label>عمر الحساب للتحويل (أيام)<input name="age" type="number" min="0" dir="ltr" value="${S.transfers.minAccountDays}"></label>
        <div class="mj-acts"><button class="btn" type="submit">حفظ</button></div></form></section>
      <section class="card mj-sec"><h3 class="f-h">${ic("shield")}تعديل رصيد عضو</h3><form class="f-form" id="mj-adj">
        <label>العضو<input name="handle" dir="ltr" required placeholder="@handle"></label><label>المبلغ (موجب أو سالب)<input name="amount" dir="ltr" inputmode="decimal" required placeholder="-5 أو 10"></label>
        <label>السبب (يُحفظ في السجل)<input name="reason" required minlength="5" maxlength="300"></label><div class="mj-acts"><button class="btn" type="submit">تطبيق</button></div></form></section>
      <section class="card mj-sec"><h3 class="f-h">${ic("lock")}إيقاف محفظة</h3><form class="f-form" id="mj-frz">
        <label>العضو<input name="handle" dir="ltr" required placeholder="@handle"></label><label>السبب<input name="reason" required minlength="5" maxlength="300"></label>
        <div class="mj-acts"><button class="btn" type="submit" name="on" value="1">إيقاف</button><button class="btn ghost" type="submit" name="on" value="0">إعادة تفعيل</button></div></form>
        ${d.frozen.length ? `<p class="f-hint">موقوفة: ${d.frozen.map((x) => "@" + h(x)).join("، ")}</p>` : ""}</section>
      <section class="card mj-sec"><h3 class="f-h">${ic("chart")}آخر المعاملات</h3>${d.recent.length ? `<ul class="list mj-hist">${d.recent.map((r) => `<li class="li"><span class="t"><b>${h(r.label)}${r.handle ? ` · @${h(r.handle)}` : ""}</b><small>${h(day(r.createdAt))}${r.memo ? " · " + h(r.memo) : ""}</small></span><span class="mj-amt">${amt(r.amount)}</span></li>`).join("")}</ul>` : `<p class="f-hint">لا معاملات بعد.</p>`}</section>`;
    const reload = () => adminView();
    $("#mj-dry").addEventListener("click", (e) => busy(e.currentTarget, async () => {
      const r = await api("GET", "/api/admin/mjt/conversion/dry-run");
      $("#mj-dr").innerHTML = `<p class="notice" role="status">${ic("help")}<span>سيُحوَّل ${UI.num(r.totals.users)} عضو: ${UI.num(r.totals.pts)} نقطة = ${amt(r.totals.amount)} MJT. مستبعد (تعديلات إدارية موجبة): ${UI.num(r.totals.excludedPts)} نقطة · مخصوم (طلبات استبدال سابقة): ${UI.num(r.totals.redeemedPts)} نقطة.</span></p>`;
    }));
    $("#mj-apply").addEventListener("click", (e) => { if (!confirm("تطبيق تحويل نقاط المساهمة إلى مجتمع كوين؟ لا يُحوَّل أحد مرتين، ويمكن الإلغاء لاحقاً.")) return; busy(e.currentTarget, async () => { const r = await api("POST", "/api/admin/mjt/conversion", {}); say(r.applied ? `حُوّل ${r.batch.users} عضو (${r.batch.amount} MJT)` : "لا شيء للتحويل"); reload(); }); });
    box.querySelectorAll("[data-rb]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
      const chk = await api("POST", `/api/admin/mjt/conversion/${enc(b.dataset.rb)}/rollback`, { dryRun: true });
      if (!chk.possible) { say(`لا يمكن الإلغاء: ${chk.blocked} عضو صرفوا جزءاً من الرصيد`); return; }
      if (!confirm(`إلغاء تحويل ${chk.users} عضو (${chk.amount} MJT)؟`)) return;
      await api("POST", `/api/admin/mjt/conversion/${enc(b.dataset.rb)}/rollback`, {}); say("أُلغي التحويل"); reload();
    })));
    $("#mj-set").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; busy(e.submitter, async () => { await api("PUT", "/api/admin/mjt/settings", { rewards: { enabled: f.rew.checked, dailyCap: f.cap.value.trim() }, transfers: { enabled: f.tr.checked, maxSingle: f.single.value.trim(), maxDaily: f.daily.value.trim(), maxPerHour: +f.hour.value, minAccountDays: +f.age.value } }); say("حُفظت الإعدادات"); reload(); }); });
    let adjKey = newKey(); $("#mj-adj").addEventListener("input", () => { adjKey = newKey(); });
    $("#mj-adj").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; if (!confirm(`تعديل رصيد @${f.handle.value.trim().replace(/^@/, "")} بمقدار ${f.amount.value.trim()} MJT؟`)) return; busy(e.submitter, async () => { const r = await api("POST", "/api/admin/mjt/adjust", { handle: f.handle.value.trim(), amount: f.amount.value.trim(), reason: f.reason.value.trim(), ikey: adjKey }); adjKey = newKey(); say(`رصيد @${r.handle} الآن ${r.balance.mjt} MJT`); reload(); }); });
    $("#mj-frz").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target, on = e.submitter?.value === "1"; busy(e.submitter, async () => { await api("POST", `/api/admin/mjt/accounts/${enc(f.handle.value.trim().replace(/^@/, ""))}/freeze`, { frozen: on, reason: f.reason.value.trim() }); say(on ? "أُوقفت المحفظة" : "أُعيد تفعيل المحفظة"); reload(); }); });
  }

  MPRoutes.extend((a, b, prev) => {
    return { mjt: () => walletView() };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "mjt" ? adminView() : next()));
  window.MPMjt = { walletView, adminView, version: "2.47.0" };
  if (/^#\/(mjt|admin\/mjt)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
