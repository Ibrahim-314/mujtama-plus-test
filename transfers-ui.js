/* =====================================================================
 * مجتمع بلس — Phase 51 + 56 UI (lazy "transfers" chunk; 0 bytes in core).
 * Phase 56 · Pi transfers & payment requests:
 *   #/transfers (balance, send / request buttons, history tabs, receive on/off), #/transfers/send?to=&amount=,
 *   #/transfers/request?from=, #/transfers/requests (incoming: pay / decline · outgoing: cancel), #/transfers/:id (receipt),
 *   #/admin/transfers (held review: release / reject, payouts). A «التحويلات» link is added to #/wallet.
 * Phase 51 · Pi activation: #/admin/pi-activation (checklist with fixes, key probe, in-memory dry run, 0.01 π test payment);
 *   incomplete-payment recovery on sign-in (POST /api/pi/recover once per session when payments are on).
 * Payments go through MPPi.pay (pi chunk) with the feature intent endpoint. CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function TransfersUI() {
  if (window.MPTransfers) return;
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const amt = (n, sign = "") => `<bdi dir="ltr" class="tr-n">${sign}${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 7 })} π</bdi>`;
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso); } };
  const q = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const $ = (s) => view.querySelector(s);
  const page = (title, body, back, icon = "swap", actions = "") => { view.innerHTML = `<div class="wrap tr-page">${UI.pageHead({ back, title, icon, actions, id: "tr-h" })}${body}</div>`; $("#tr-h")?.focus({ preventScroll: true }); };
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const ST = { pending: ["بانتظار الدفع", "wait"], held: ["قيد المراجعة", "wait"], completed: ["مكتمل", "ok"], cancelled: ["ملغى", "mute"], rejected: ["مرفوض", "bad"], refunded: ["مُسترد", "info"],
    open: ["مفتوح", "wait"], paid: ["مدفوع", "ok"], declined: ["مرفوض", "bad"], expired: ["منتهي", "mute"] };
  const chip = (s) => { const [t, c] = ST[s] || [s, "mute"]; return `<span class="sbadge tr-chip ${{ wait: "warn", mute: "" }[c] ?? c}">${h(t)}</span>`; };
  const HOLD = { new_account: "حساب جديد", amount: "مبلغ كبير", integrity_limited: "مراجعة أمان" };

  if (!document.getElementById("tr-css")) document.head.insertAdjacentHTML("beforeend", `<style id="tr-css">
.tr-page{max-width:560px;margin:auto}.tr-page h2:focus{outline:none}.tr-lim{padding:12px;margin-top:10px}.tr-lim summary{display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer}.tr-list li.tr-none{display:block;border:0}.tr-acts .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.tr-hero .big{font-size:var(--fs-3xl);font-weight:800;margin-top:4px}
.tr-acts{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.tr-acts>*{flex:1;min-height:46px;text-align:center}
.tr-list{list-style:none;margin:0;padding:0}.tr-list li{display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid var(--line,#eee)}.tr-list li:last-child{border:0}
.tr-list a{color:inherit;text-decoration:none;display:flex;gap:10px;align-items:center;flex:1;min-width:0}.tr-grow{flex:1;min-width:0}.tr-grow .muted{display:block;font-size:var(--fs-sm)}
.tr-dir{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:800;flex:none}.tr-dir.in{background:#16a34a22;color:#15803d}.tr-dir.out{background:#dc262622;color:#b91c1c}
.tr-form label{display:block;font-weight:700;margin:10px 0 4px}.tr-form input,.tr-form textarea{width:100%;min-height:46px;box-sizing:border-box}.tr-form .btn{width:100%;min-height:50px;margin-top:14px}
.tr-note{font-size:var(--fs-sm);margin-top:6px}.tr-ck{list-style:none;padding:0;margin:0}.tr-ck li{padding:10px 12px;border-bottom:1px solid var(--line,#eee);display:flex;gap:10px}.tr-ck .ic{flex:none;font-weight:800}.tr-ck .ok{color:#15803d}.tr-ck .no{color:#b91c1c}.tr-ck .opt{color:#b45309}
.tr-ck small{display:block;color:var(--muted,#666);margin-top:2px}.tr-steps{margin:8px 0;padding-inline-start:20px}.tr-sw{display:flex;align-items:center;gap:10px;padding:12px}
</style>`);

  let cfg = null;
  const config = (force) => (cfg && !force ? Promise.resolve(cfg) : api("GET", "/api/transfers/config").then((c) => (cfg = c)));
  const offCard = (c) => `<div class="notice" role="status">${UI.icon("wallet")}<div><b>${h(c?.note || "تحويلات Pi غير مفعّلة بعد — تعمل فور تفعيل مدفوعات Pi")}</b><br>يمكنك تصفّح هذه الصفحة؛ الإرسال والطلب يعملان بعد التفعيل.</div></div>`;
  async function needPi() { if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { }); if (!window.MPPi) throw new Error("تعذّر تحميل مدفوعات Pi"); }

  /* ---------- #/transfers ---------- */
  async function home() {
    page("التحويلات", `<div class="skel"></div><div class="skel"></div>`, ["#/wallet", "المحفظة"], "swap");
    if (!online()) { $(".skel").outerHTML = `<div class="empty">التحويلات تحتاج الاتصال بالخادم.</div>`; return; }
    let c; try { c = await config(true); } catch (e) { $(".wrap").insertAdjacentHTML("beforeend", errBox(e)); view.querySelectorAll(".skel").forEach((x) => x.remove()); return; }
    view.querySelectorAll(".skel").forEach((x) => x.remove());
    const w = $(".wrap");
    if (!c.enabled) { w.insertAdjacentHTML("beforeend", offCard(c) + limitsCard(c)); return; }
    if (c.minor) { w.insertAdjacentHTML("beforeend", `<div class="card empty">تحويلات Pi غير متاحة لمن هم دون ١٨ سنة.</div>`); return; }
    w.insertAdjacentHTML("beforeend", `<section class="tr-hero f-cover" aria-label="الرصيد"><span class="muted">الرصيد المستلم</span><div class="big" id="tr-bal">…</div><p class="tr-note muted" id="tr-bal-n"></p></section>
      <div class="tr-acts"><a class="btn" href="#/transfers/send">${MPFeat.ico("send","sm")} إرسال Pi</a><a class="btn outline" href="#/transfers/request">${MPFeat.ico("hand","sm")} طلب Pi</a><a class="btn outline" href="#/transfers/requests" id="tr-rq">الطلبات</a></div>
      <div class="tr-tabs seg" role="group" aria-label="تصفية"><button type="button" data-box="" aria-pressed="true">الكل</button><button type="button" data-box="sent" aria-pressed="false">المرسلة</button><button type="button" data-box="received" aria-pressed="false">المستلمة</button></div>
      <ul class="tr-list card" id="tr-list" aria-live="polite"></ul><div id="tr-more"></div>
      <div class="card tr-sw"><label for="tr-recv" class="grow">استقبال التحويلات من الآخرين</label><input type="checkbox" id="tr-recv" ${c.receive ? "checked" : ""}></div>${limitsCard(c)}`);
    $("#tr-recv").addEventListener("change", async (e) => { try { const r = await api("PUT", "/api/transfers/settings", { receive: e.target.checked }); say(r.receive ? "تم تفعيل الاستقبال" : "أوقفت استقبال التحويلات"); } catch (x) { e.target.checked = !e.target.checked; say(x.message); } });
    api("GET", "/api/transfers/requests").then((r) => { if (r.openIncoming) $("#tr-rq").textContent = `الطلبات (${r.openIncoming})`; }).catch(() => { });
    let box = "", cursor = null;
    const load = async (more) => {
      const list = $("#tr-list"); if (!list) return;
      try {
        const r = await api("GET", "/api/transfers?" + new URLSearchParams({ ...(box ? { box } : {}), ...(more && cursor ? { cursor } : {}) }));
        if (!more) list.innerHTML = "";
        list.insertAdjacentHTML("beforeend", r.items.map(row).join(""));
        if (!list.children.length) list.innerHTML = `<li class="tr-none">${UI.empty({ title: "لا تحويلات بعد", text: box ? "لا شيء في هذا التصنيف." : "ما ترسله أو تستلمه من Pi يظهر هنا." })}</li>`;
        cursor = r.nextCursor; $("#tr-more").innerHTML = cursor ? `<div class="f-more"><button type="button" class="btn outline" id="tr-mb">عرض المزيد</button></div>` : "";
        $("#tr-mb")?.addEventListener("click", () => load(true));
        $("#tr-bal").innerHTML = amt(r.balance.available); $("#tr-bal-n").textContent = r.balance.note || "";
      } catch (e) { list.innerHTML = `<li>${h(e.message)}</li>`; }
    };
    view.querySelectorAll(".tr-tabs button").forEach((b) => b.addEventListener("click", () => { box = b.dataset.box; view.querySelectorAll(".tr-tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); load(false); }));
    load(false);
  }
  const limitsCard = (c) => c?.limits ? `<details class="card tr-lim"><summary>${UI.icon("shield","sm")} حدود التحويل والحماية</summary><ul class="muted">
      <li>أعلى مبلغ للتحويل الواحد: ${amt(c.limits.maxSingle)}</li><li>الحد اليومي: ${amt(c.limits.maxDaily)} (الحسابات الأحدث من ${c.limits.newAccountDays} أيام: ${amt(c.limits.newAccountDaily)})</li>
      <li>حتى ${c.limits.maxPerHour} تحويلات في الساعة</li><li>تحويلات الحسابات الجديدة والمبالغ من ${amt(c.limits.holdAmount)} تُراجع قبل وصولها</li><li>غير متاحة لمن دون ١٨ سنة، ولا مع الحسابات المحظورة</li></ul></details>` : "";
  const row = (t) => { const inn = t.direction === "in", who = inn ? t.sender : t.recipient;
    return `<li><a href="#/transfers/${enc(t.id)}"><span class="tr-dir ${inn ? "in" : "out"}" aria-hidden="true">${inn ? "↓" : "↑"}</span><span class="tr-grow"><b>${inn ? "من" : "إلى"} <bdi>@${h(who?.handle)}</bdi></b><span class="muted">${h(t.note || "")} ${h(day(t.createdAt))}</span></span>${amt(t.amount, inn ? "+" : "−")}${chip(t.status)}</a></li>`; };

  /* ---------- send / request ---------- */
  async function sendView() {
    const p = q(), rid = p.get("request");
    page("إرسال Pi", `<form class="u-p14 tr-form card" id="tr-f" novalidate>
      <label for="tr-to">إلى (اسم المستخدم)</label><input id="tr-to" dir="ltr" autocomplete="off" placeholder="@handle" value="${h(p.get("to") || "")}" ${rid ? "readonly" : ""} required>
      <label for="tr-a">المبلغ (π)</label><input id="tr-a" inputmode="decimal" dir="ltr" value="${h(p.get("amount") || "")}" ${rid ? "readonly" : ""} required>
      <label for="tr-n">ملاحظة (اختياري)</label><input id="tr-n" maxlength="200" value="${h(p.get("note") || "")}">
      <p class="tr-note muted" id="tr-st" role="status">يُخصم المبلغ من محفظة Pi عبر متصفح Pi ويُسجَّل في سجل التحويلات.</p>
      <button class="btn" type="submit" id="tr-go">متابعة الدفع عبر Pi</button></form>`, ["#/transfers", "التحويلات"]);
    const c = await config().catch(() => null); if (!c?.enabled) { $("#tr-f").insertAdjacentHTML("beforebegin", offCard(c)); $("#tr-go").disabled = true; return; }
    $("#tr-f").addEventListener("submit", async (e) => {
      e.preventDefault(); const go = $("#tr-go"), st = $("#tr-st");
      const to = $("#tr-to").value.trim().replace(/^@/, ""), amount = Number($("#tr-a").value.replace(",", ".")), note = $("#tr-n").value.trim();
      if (!rid && (!to || !(amount > 0))) { st.textContent = "أدخل اسم المستخدم ومبلغاً صحيحاً."; return; }
      go.disabled = true; st.textContent = "جارٍ التحضير…"; let extra = null;
      try {
        await needPi();
        const r = await window.MPPi.pay({ amount, memo: "تحويل", purpose: "transfer", intent: async () => { const x = await api("POST", "/api/transfers/intent", rid ? { requestId: rid, note } : { toHandle: to, amount, note }); extra = x; return x.intent; } });
        say(extra?.held ? extra.holdNote : "تم التحويل ✓"); location.hash = "#/transfers/" + enc(extra?.transferId || r.id);
      } catch (x) { st.textContent = x.message || "تعذّر التحويل"; go.disabled = false; }
    });
  }
  async function requestView() {
    page("طلب Pi", `<form class="u-p14 tr-form card" id="tr-f" novalidate>
      <label for="tr-fr">من (اسم المستخدم)</label><input id="tr-fr" dir="ltr" autocomplete="off" placeholder="@handle" value="${h(q().get("from") || "")}" required>
      <label for="tr-a">المبلغ (π)</label><input id="tr-a" inputmode="decimal" dir="ltr" required>
      <label for="tr-n">السبب (اختياري)</label><input id="tr-n" maxlength="200">
      <p class="tr-note muted" id="tr-st" role="status">يصل للطرف الآخر إشعار، ويمكنه الدفع أو الرفض. ينتهي الطلب بعد ${h(cfg?.limits?.requestDays || 7)} أيام.</p>
      <button class="btn" type="submit" id="tr-go">إرسال الطلب</button></form>`, ["#/transfers", "التحويلات"]);
    const c = await config().catch(() => null); if (!c?.enabled) { $("#tr-f").insertAdjacentHTML("beforebegin", offCard(c)); $("#tr-go").disabled = true; return; }
    $("#tr-f").addEventListener("submit", async (e) => {
      e.preventDefault(); const go = $("#tr-go"), st = $("#tr-st"); go.disabled = true;
      try { await api("POST", "/api/transfers/requests", { fromHandle: $("#tr-fr").value.trim(), amount: Number($("#tr-a").value.replace(",", ".")), note: $("#tr-n").value.trim() }); say("أُرسل الطلب ✓"); location.hash = "#/transfers/requests?box=out"; }
      catch (x) { st.textContent = x.message; go.disabled = false; }
    });
  }
  async function requestsView() {
    const box = q().get("box") === "out" ? "out" : "in";
    page("طلبات الدفع", `<div class="tr-tabs" role="group"><a class="btn ${box === "in" ? "" : "ghost"}" href="#/transfers/requests">الواردة</a><a class="btn ${box === "out" ? "" : "ghost"}" href="#/transfers/requests?box=out">المرسلة</a></div><ul class="tr-list card" id="tr-list"><li class="muted">…</li></ul>`, ["#/transfers", "التحويلات"]);
    let r; try { r = await api("GET", "/api/transfers/requests?box=" + box); } catch (e) { $("#tr-list").outerHTML = errBox(e); return; }
    $("#tr-list").innerHTML = r.items.length ? r.items.map((x) => { const who = box === "in" ? x.requester : x.payer;
      const acts = x.status !== "open" ? "" : box === "in" ? `<a class="btn" href="#/transfers/send?request=${enc(x.id)}&to=${enc(x.requester?.handle || "")}&amount=${enc(x.amount)}">ادفع</a><button type="button" class="btn ghost" data-act="decline" data-id="${h(x.id)}">رفض</button>` : `<button type="button" class="btn ghost" data-act="cancel" data-id="${h(x.id)}">إلغاء</button>`;
      return `<li><span class="tr-grow"><b>${box === "in" ? "من" : "إلى"} <bdi>@${h(who?.handle)}</bdi> · ${amt(x.amount)}</b><span class="muted">${h(x.note)} ${h(day(x.createdAt))}</span></span>${chip(x.status)}${acts}</li>`; }).join("") : `<li class="muted">لا طلبات.</li>`;
    view.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { await api("POST", `/api/transfers/requests/${enc(b.dataset.id)}/${b.dataset.act}`); say("تم"); requestsView(); } catch (e) { say(e.message); b.disabled = false; } }));
  }
  async function receiptView(id) {
    page("إيصال التحويل", `<div class="skel"></div>`, ["#/transfers", "التحويلات"]);
    let r; try { r = (await api("GET", "/api/transfers/" + enc(id))).receipt; } catch (e) { $(".skel").outerHTML = errBox(e); return; }
    $(".skel").outerHTML = `<section class="u-p16 card"><div class="tr-hero"><div class="big">${amt(r.amount)}</div>${chip(r.status)}${r.holdReason ? `<p class="tr-note">قيد المراجعة: ${h(HOLD[r.holdReason] || r.holdReason)}</p>` : ""}</div>
      <dl><dt class="muted">من</dt><dd><bdi>@${h(r.sender?.handle)}</bdi></dd><dt class="muted">إلى</dt><dd><bdi>@${h(r.recipient?.handle)}</bdi></dd>${r.note ? `<dt class="muted">ملاحظة</dt><dd>${h(r.note)}</dd>` : ""}
      <dt class="muted">التاريخ</dt><dd>${h(day(r.createdAt))}</dd><dt class="muted">الشبكة</dt><dd>${h(r.network === "mainnet" ? "Mainnet" : "Testnet")}</dd>
      ${r.txid ? `<dt class="muted">رقم المعاملة</dt><dd dir="ltr" class="u-wba">${h(r.txid)}</dd>` : ""}</dl>
      ${r.explorerUrl ? `<a class="btn ghost" href="${h(r.explorerUrl)}" target="_blank" rel="noopener">عرض في مستكشف البلوكتشين</a>` : ""}</section>`;
  }

  /* ---------- #/admin/transfers ---------- */
  async function adminHeld() {
    page("تحويلات قيد المراجعة", `<ul class="tr-list card" id="tr-list"><li class="muted">…</li></ul>
      <form class="u-p14 u-mt12 tr-form card" id="tr-po"><b>تسجيل صرف رصيد (بعد الدفع من محفظة التطبيق)</b>
      <label for="po-h">المستخدم</label><input id="po-h" dir="ltr" required><label for="po-a">المبلغ</label><input id="po-a" inputmode="decimal" dir="ltr" required>
      <label for="po-t">رقم المعاملة (txid)</label><input id="po-t" dir="ltr" required><button class="btn" type="submit">تسجيل الصرف</button></form>`, ["#/admin", "الإدارة"]);
    const pc = typeof PiAdapter !== "undefined" ? await PiAdapter.config().catch(() => null) : null; // v2.51: no 501 request while Pi payments are off
    if (pc && pc.enabled === false) { if ($("#tr-list")) $("#tr-list").innerHTML = `<li class="muted" role="status">مدفوعات Pi غير مفعّلة بعد — ستظهر التحويلات المعلّقة هنا فور تفعيلها.</li>`; $("#tr-po")?.addEventListener("submit", (e) => { e.preventDefault(); say("مدفوعات Pi غير مفعّلة بعد."); }); return; }
    let r; try { r = await api("GET", "/api/admin/transfers/held"); } catch (e) { $("#tr-list").outerHTML = errBox(e); return; }
    $("#tr-list").innerHTML = r.items.length ? r.items.map((x) => `<li><span class="tr-grow"><b>@${h(x.sender.handle)} ← @${h(x.recipient.handle)} · ${amt(x.amount)}</b><span class="muted">${h(HOLD[x.holdReason] || x.holdReason)} · ${h(day(x.paidAt))}</span></span>
      <button type="button" class="btn" data-a="release" data-id="${h(x.id)}">اعتماد</button><button type="button" class="btn ghost" data-a="reject" data-id="${h(x.id)}">رفض</button></li>`).join("") : `<li class="muted">لا تحويلات معلّقة.</li>`;
    view.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { const x = await api("POST", `/api/admin/transfers/${enc(b.dataset.id)}/${b.dataset.a}`, {}); say(x.refundNote || "تم"); adminHeld(); } catch (e) { say(e.message); b.disabled = false; } }));
    $("#tr-po").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("POST", "/api/admin/transfers/payouts", { handle: $("#po-h").value.trim(), amount: Number($("#po-a").value), txid: $("#po-t").value.trim() }); say("سُجّل الصرف ✓"); e.target.reset(); } catch (x) { say(x.message); } });
  }

  /* ---------- #/admin/pi-activation (phase 51) ---------- */
  async function activationView() {
    page("تفعيل مدفوعات Pi", `<div class="skel"></div><div class="skel"></div>`, ["#/admin", "الإدارة"]);
    let c; try { c = await api("GET", "/api/admin/pi/activation"); } catch (e) { view.querySelectorAll(".skel").forEach((x) => x.remove()); $(".wrap").insertAdjacentHTML("beforeend", errBox(e)); return; }
    view.querySelectorAll(".skel").forEach((x) => x.remove());
    const li = (i) => `<li><span class="ic ${i.ok ? "ok" : i.blocks ? "no" : "opt"}" aria-hidden="true">${i.ok ? "✓" : i.blocks ? "✗" : "!"}</span><span><b>${h(i.label)}</b>${i.ok ? "" : `<small>${h(i.fix || "")}</small>`}</span><span class="pi-sr">${i.ok ? "جاهز" : i.blocks ? "ناقص" : "اختياري"}</span></li>`;
    const grp = (g, t) => `<h3 style="font-size:15px;margin:14px 4px 6px">${t}</h3><ul class="tr-ck card">${c.items.filter((i) => i.group === g).map(li).join("")}</ul>`;
    $(".wrap").insertAdjacentHTML("beforeend", `<section class="tr-hero"><b>الوضع الحالي: ${h(c.modeLabel)}</b><p class="tr-note">${c.paymentsReady ? "✓ المدفوعات جاهزة" : "المدفوعات تنتظر: " + h(c.missing.filter((k) => c.items.find((i) => i.key === k)?.group === "payments").length) + " بند"} · ${c.directoryReady ? "✓ جاهز لدليل تطبيقات Pi" : "دليل التطبيقات: بنود ناقصة"}</p></section>
      ${grp("payments", "المدفوعات")}${grp("directory", "دليل تطبيقات Pi (App Directory)")}
      <h3 style="font-size:15px;margin:14px 4px 6px">خطوات التفعيل من الجوال</h3><ol class="tr-steps card" style="padding:12px 30px">${c.steps.map((s) => `<li>${h(s)}</li>`).join("")}</ol>
      <div class="tr-acts"><button type="button" class="btn ghost" id="pa-probe" ${c.items.find((i) => i.key === "api_key")?.ok ? "" : "disabled"}>فحص مفتاح Pi API</button><button type="button" class="btn ghost" id="pa-dry">تجربة آمنة (محاكاة)</button><button type="button" class="btn" id="pa-test" ${c.mode === "off" ? "disabled" : ""}>دفعة تجريبية 0.01 π</button></div>
      <div id="pa-out" role="status" aria-live="polite"></div>`);
    const out = $("#pa-out");
    $("#pa-probe").addEventListener("click", async () => { out.textContent = "جارٍ الفحص…"; try { const r = await api("POST", "/api/admin/pi/activation/probe"); out.innerHTML = `<div class="u-p12 card">${r.ok ? "✓ قبلت شبكة Pi المفتاح" : r.reason === "key_refused" ? "✗ رفضت شبكة Pi المفتاح — انسخه مجدداً من Developer Portal" : r.reason === "unreachable" ? "تعذّر الوصول إلى شبكة Pi الآن" : "لا يوجد مفتاح"}</div>`; } catch (e) { out.innerHTML = errBox(e); } });
    $("#pa-dry").addEventListener("click", async () => { out.textContent = "جارٍ التشغيل…"; try { const r = await api("POST", "/api/admin/pi/dryrun"); out.innerHTML = `<div class="u-p12 card"><b>${r.ok ? "✓ نجحت كل الخطوات" : "✗ خطوة فشلت"}</b> <span class="muted">(محاكاة داخل الذاكرة، بلا شبكة ولا قاعدة بيانات الإنتاج · ${h(r.ms)}ms)</span><ul class="tr-ck">${(r.steps || []).map((s) => `<li><span class="ic ${s.ok ? "ok" : "no"}">${s.ok ? "✓" : "✗"}</span><span>${h(s.name)}<small>${h(s.detail)}</small></span></li>`).join("")}</ul></div>`; } catch (e) { out.innerHTML = errBox(e); } });
    $("#pa-test").addEventListener("click", async () => { try { await needPi(); const r = await window.MPPi.pay({ amount: 0.01, memo: "دفعة تجريبية لتفعيل Pi", purpose: "test" }); out.innerHTML = `<div class="u-p12 card">✓ اكتملت الدفعة التجريبية · <a href="#/receipt/${enc(r.id)}">الإيصال</a></div>`; } catch (e) { out.innerHTML = errBox(e); } });
  }


  /* ---------- #/admin/activation (phase 52): unified checklist — Pi, push, email, translation ---------- */
  async function activationHub() {
    page("التفعيل", `<div class="skel"></div><div class="skel"></div>`, ["#/admin", "الإدارة"]);
    let c, em, ts; try { [c, em, ts] = await Promise.all([api("GET", "/api/admin/activation"), api("GET", "/api/admin/activation/email"), api("GET", "/api/admin/activation/translate")]); }
    catch (e) { view.querySelectorAll(".skel").forEach((x) => x.remove()); $(".wrap").insertAdjacentHTML("beforeend", errBox(e)); return; }
    view.querySelectorAll(".skel").forEach((x) => x.remove());
    const G = { pi: "مدفوعات Pi", push: "إشعارات الجهاز (Push)", email: "البريد الإلكتروني", translate: "الترجمة الآلية" };
    const li = (i) => `<li><span class="ic ${i.ok ? "ok" : i.blocks ? "no" : "opt"}" aria-hidden="true">${i.ok ? "✓" : i.blocks ? "✗" : "!"}</span><span><b>${h(i.label)}</b>${i.ok ? "" : `<small>${h(i.fix || "")}</small>`}${i.link ? ` <a href="${h(i.link)}">فتح</a>` : ""}</span><span class="pi-sr">${i.ok ? "جاهز" : "غير مكتمل"}</span></li>`;
    const steps = (k) => (c.steps[k] ? `<details><summary>خطوات التفعيل من الجوال</summary><ol class="tr-steps">${c.steps[k].map((x) => `<li>${h(x)}</li>`).join("")}</ol></details>` : "");
    const sec = (g, extra = "") => `<h3 style="font-size:16px;margin:16px 4px 6px">${G[g]} ${c.groups.find((x) => x.id === g)?.ready ? `<span class="tr-chip ok">مفعّل</span>` : `<span class="tr-chip wait">غير مفعّل</span>`}</h3><ul class="tr-ck card">${c.items.filter((i) => i.group === g).map(li).join("")}</ul>${steps(g)}${extra}`;
    const st = em.stored || {}, tst = ts.stored || {};
    const emailForm = em.envOverrides ? `<p class="tr-note">البريد مضبوط من متغير SMTP_URL في Railway.</p>` : `<form id="ac-em" class="u-p12 tr-form card"><label for="em-h">خادم SMTP</label><input id="em-h" dir="ltr" required placeholder="smtp.gmail.com" value="${h(st.host || "")}">
      <label for="em-p">المنفذ</label><input id="em-p" type="number" dir="ltr" value="${h(st.port || 465)}"><label for="em-u">اسم المستخدم (البريد)</label><input id="em-u" dir="ltr" autocomplete="off" value="${h(st.user || "")}">
      <label for="em-w">كلمة المرور ${st.passSet ? "(محفوظة — اتركها فارغة للإبقاء)" : ""}</label><input id="em-w" type="password" dir="ltr" autocomplete="new-password"><label for="em-f">المرسل</label><input id="em-f" placeholder="مجتمع بلس <you@example.com>" value="${h(st.from || "")}">
      <button class="btn">حفظ البريد</button></form>`;
    const emailActs = `<div class="tr-acts"><button type="button" class="btn ghost" id="ac-emt" ${em.enabled ? "" : "disabled"}>إرسال رسالة تجريبية</button>${st.host ? `<button type="button" class="btn ghost" id="ac-emx">إيقاف البريد</button>` : ""}<select id="ac-tpl" aria-label="معاينة قالب">${em.templates.map((t) => `<option>${t}</option>`).join("")}</select><button type="button" class="btn ghost" id="ac-prev">معاينة القالب</button></div>`;
    const trForm = ts.envOverrides ? `<p class="tr-note">الترجمة مضبوطة من متغيرات Railway.</p>` : `<form id="ac-tr" class="u-p12 tr-form card"><label for="tr-pv">المزود</label><select id="tr-pv"><option value="deepl" ${tst.provider === "deepl" ? "selected" : ""}>DeepL API Free (مفتاح ينتهي بـ :fx)</option><option value="libre" ${tst.provider === "libre" ? "selected" : ""}>LibreTranslate (رابط خادم)</option><option value="openai" ${tst.provider === "openai" ? "selected" : ""}>خادم متوافق مع OpenAI</option></select>
      <label for="tr-url">الرابط (LibreTranslate / خادم OpenAI)</label><input id="tr-url" dir="ltr" placeholder="https://…" value="${h(tst.url || tst.baseUrl || "")}"><label for="tr-key">المفتاح ${tst.keySet ? "(محفوظ — اتركه فارغاً للإبقاء)" : ""}</label><input id="tr-key" type="password" dir="ltr" autocomplete="new-password">
      <label for="tr-md">النموذج (OpenAI فقط)</label><input id="tr-md" dir="ltr" value="${h(tst.model || "")}"><label class="tr-sw"><input type="checkbox" id="tr-pr" ${tst.private ? "checked" : ""}> الخادم لي (مسموح بترجمة الرسائل الخاصة)</label>
      <div class="tr-acts"><button type="button" class="btn ghost" id="ac-trt">تجربة</button><button class="btn">حفظ الترجمة</button></div></form>${tst.provider ? `<button type="button" class="btn ghost" id="ac-trx">إيقاف الترجمة</button>` : ""}`;
    $(".wrap").insertAdjacentHTML("beforeend", `<section class="tr-hero"><b>المفعّل الآن:</b> ${Object.entries(c.active).filter(([, v]) => v).map(([k]) => G[k]).join("، ") || "لا شيء بعد"}</section>
      ${sec("pi")}${sec("push", `<div class="tr-acts"><button type="button" class="btn ghost" id="ac-pt">إشعار تجريبي لأجهزتي</button></div>`)}${sec("email", emailForm + emailActs)}${sec("translate", trForm)}<div id="ac-out" role="status" aria-live="polite"></div>`);
    const out = $("#ac-out"), show = (x) => { out.innerHTML = `<div class="u-p12 card">${x}</div>`; out.scrollIntoView?.({ block: "nearest" }); };
    const run = (sel, fn) => $(sel)?.addEventListener("click", async (e) => { e.preventDefault(); try { await fn(); } catch (x) { show("✗ " + h(x.message)); } });
    run("#ac-pt", async () => { const r = await api("POST", "/api/push/test"); show(`✓ أُرسل إشعار تجريبي إلى ${r.devices} جهاز`); });
    $("#ac-em")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("PUT", "/api/admin/activation/email", { host: $("#em-h").value.trim(), port: Number($("#em-p").value), user: $("#em-u").value.trim(), pass: $("#em-w").value, from: $("#em-f").value.trim() }); say("حُفظ البريد ✓"); activationHub(); } catch (x) { show("✗ " + h(x.message)); } });
    run("#ac-emt", async () => { const to = prompt("أرسل الرسالة التجريبية إلى:", ""); if (to === null) return; const r = await api("POST", "/api/admin/activation/email/test", to ? { to } : {}); show(r.ok ? `✓ أُرسلت إلى ${h(r.to)} (${r.ms} ms)` : `✗ فشل الإرسال: ${h(r.error)}`); });
    run("#ac-emx", async () => { await api("DELETE", "/api/admin/activation/email"); activationHub(); });
    run("#ac-prev", async () => { const r = await api("GET", "/api/admin/activation/email/preview/" + enc($("#ac-tpl").value)); show(`<b>${h(r.subject)}</b><iframe title="معاينة القالب" sandbox="" style="width:100%;height:420px;border:0;margin-top:8px" srcdoc="${h(r.html)}"></iframe>`); });
    const trBody = () => { const p = $("#tr-pv").value, u = $("#tr-url").value.trim(); return { provider: p, ...(p === "libre" ? { url: u } : p === "openai" ? { baseUrl: u, model: $("#tr-md").value.trim() } : {}), key: $("#tr-key").value, private: $("#tr-pr").checked }; };
    run("#ac-trt", async () => { const r = await api("POST", "/api/admin/activation/translate/test", trBody()); show(r.ok ? `✓ ${h(r.provider)}: «${h(r.text)}» (${r.ms} ms)` : `✗ ${h(r.error)}`); });
    $("#ac-tr")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("PUT", "/api/admin/activation/translate", trBody()); say("حُفظت الترجمة ✓"); activationHub(); } catch (x) { show("✗ " + h(x.message)); } });
    run("#ac-trx", async () => { await api("DELETE", "/api/admin/activation/translate"); activationHub(); });
  }

  /* ---------- recovery on sign-in (phase 51) ---------- */
  let recovered = false;
  async function recover() {
    if (recovered || !online() || !(typeof DB !== "undefined" && DB.onboarded)) return; recovered = true;
    try { const c = await (window.PiAdapter || (typeof PiAdapter !== "undefined" ? PiAdapter : null))?.config?.(); if (!c?.enabled) return;
      const r = await api("POST", "/api/pi/recover");
      for (const x of r.results || []) say(x.status === "completed" ? "اكتملت دفعة Pi سابقة" : x.status === "cancelled" ? "أُلغيت دفعة Pi سابقة لم تكتمل" : x.status === "pending" ? "دفعة Pi سابقة قيد التحقق" : "");
    } catch { /* payments off or offline */ }
  }
  if (typeof start === "function" && !start.__tr) { const _s = start; start = async function () { const r = await _s.apply(this, arguments); recovered = false; recover(); return r; }; start.__tr = true; }
  setTimeout(recover, 1500);

  /* ---------- wiring ---------- */
  MPRoutes.extend((a, b, prev) => {
    return { transfers: () => (!a ? home() : a === "send" ? sendView() : a === "request" ? requestView() : a === "requests" ? requestsView() : receiptView(a)) };
  });
  MPRoutes.add("wallet", (a, b, next) => { const r = next(); Promise.resolve(r).then(() => { const w = view.querySelector(".pi-page .pi-links"); if (w && !document.getElementById("tr-wl")) w.insertAdjacentHTML("afterbegin", UI.li({ href: "#/transfers", icon: "swap", title: "تحويلات وطلبات Pi بين الأعضاء", id: "tr-wl" }) + UI.li({ href: "#/purchases", icon: "bag", title: "مشترياتي" })); }); return r; });
  MPRoutes.add("admin", (a, b, next) => { if (a === "pi-activation") return activationView(); if (a === "activation") return activationHub(); if (a === "transfers") return adminHeld(); const r = next();
        if (!a && typeof DB !== "undefined" && DB.isAdmin) Promise.resolve(r).then(() => { const t = view.querySelector(".wrap h2"); if (t && !document.getElementById("tr-adm")) t.insertAdjacentHTML("afterend", `<div id="tr-adm"><a class="u-dflex u-g12 u-p12 u-ci u-tdn card" href="#/admin/activation"><b class="u-f1"><svg class=ix aria-hidden=true><use href=#i-settings /></svg> التفعيل — Pi والإشعارات والبريد والترجمة</b><span class="fwd" aria-hidden="true">←</span></a><a class="u-dflex u-g12 u-p12 u-ci u-tdn card" href="#/admin/pi-activation"><b class="u-f1">π تفعيل مدفوعات Pi — قائمة الجاهزية</b><span class="fwd" aria-hidden="true">←</span></a><a class="u-dflex u-g12 u-p12 u-ci u-tdn card" href="#/admin/transfers"><b class="u-f1">تحويلات Pi قيد المراجعة</b><span class="fwd" aria-hidden="true">←</span></a>${[["#/admin/pricing", "الأسعار والرسوم — سجل الأسعار والتغييرات المجدولة"], ["#/admin/revenue", "الإيرادات والتكاليف والهامش"], ["#/admin/digital", "بلاغات المنتجات الرقمية"]].map(([u, t]) => `<a class="u-dflex u-g12 u-p12 u-ci u-tdn card" href="${u}"><b class="u-f1">${t}</b><span class="fwd" aria-hidden="true">←</span></a>`).join("")}</div>`); });
        return r; });
  window.MPTransfers = { home, send: sendView, request: requestView, requests: requestsView, receipt: receiptView, activation: activationView, hub: activationHub, recover, version: "2.25.0" };
  if (/^#\/(transfers|admin\/(pi-activation|activation|transfers)|wallet)/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
