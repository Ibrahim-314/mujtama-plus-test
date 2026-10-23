/* =====================================================================
 * مجتمع بلس — Phase 57 UI: creator monthly subscriptions (lazy "subs" chunk; 0 bytes in core).
 *   #/subs/:handle           tiers with benefits, my status (due / grace / scheduled downgrade), subscribe · renew ·
 *                            upgrade (prorated quote → Pi payment) · downgrade (scheduled) · cancel
 *   #/subs/:handle/channel   subscriber channel with badges
 *   #/subscribers            creator studio: churn stats, subscribers list, tier benefits editor, early access
 * Payments go through MPPi.pay (pi chunk) with the feature intent endpoint. CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function SubsUI() {
  if (window.MPSubs) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const amt = (n) => `<bdi dir="ltr">${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 7 })} π</bdi>`;
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(iso)); } catch { return String(iso); } };
  const $ = (s) => view.querySelector(s);
  const page = (title, body, back, icon = "star") => { view.innerHTML = `<div class="wrap sb-page">${UI.pageHead({ back, title, icon, id: "sb-h" })}${body}</div>`; $("#sb-h")?.focus({ preventScroll: true }); };
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const ST = { active: ["فعّال", "ok"], due: ["يستحق التجديد", "wait"], grace: ["فترة سماح", "bad"], cancelled: ["ملغى (فعّال حتى نهاية الفترة)", "mute"], lapsed: ["منتهٍ", "mute"], none: ["غير مشترك", "mute"] };
  const chip = (s) => { const [t, c] = ST[s] || [s, "mute"]; return `<span class="sbadge sb-chip ${{ wait: "warn", mute: "" }[c] ?? c}">${h(t)}</span>`; };
  const BEN = { posts: ["doc", "منشورات للمشتركين"], channel: ["comment", "قناة المشتركين"], badge: ["medal", "شارة مشترك"], early: ["clock", "وصول مبكر"] }, ben = (b) => (BEN[b] ? MPFeat.ico(BEN[b][0], "sm") + BEN[b][1] : h(b));
  if (!document.getElementById("sb-css")) document.head.insertAdjacentHTML("beforeend", `<style id="sb-css">
.sb-page{max-width:600px;margin:auto}
.sb-tier{padding:var(--s4);border-radius:var(--r);background:var(--card);box-shadow:var(--sh-1);border:1px solid color-mix(in srgb,var(--line) 70%,transparent);margin-bottom:var(--s3)}.sb-tier.cur{box-shadow:inset 0 0 0 2px var(--accent),var(--sh-1)}
.sb-tier .top{display:flex;justify-content:space-between;align-items:center;gap:8px}.sb-tier .price{font-weight:800;font-size:18px}
.sb-ben{list-style:none;padding:0;margin:8px 0;display:flex;flex-wrap:wrap;gap:6px}.sb-ben li{display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-xs);font-weight:600;padding:3px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent-ink)}
.sb-tier .btn{width:100%;min-height:48px;margin-top:8px}.sb-hero .sbadge{margin-inline-start:6px}
.sb-msgs{list-style:none;padding:0;margin:0}.sb-msgs li{padding:10px 12px;border-bottom:1px solid var(--line,#eee)}.sb-msgs .who{font-weight:700}.sb-msgs .bd{font-size:12px;margin-inline-start:6px}
.sb-form{display:flex;gap:8px;margin-top:10px}.sb-form textarea{flex:1;min-height:48px}.sb-form .btn{min-width:90px}
.sb-list{list-style:none;padding:0;margin:0}.sb-list li{display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--line,#eee)}.sb-list .g{flex:1;min-width:0}
.sb-ed label{display:flex;gap:8px;align-items:center;min-height:40px}.sb-ed input[type=text],.sb-ed input[type=number]{width:100%;min-height:44px;box-sizing:border-box}
</style>`);
  async function needPi() { if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { }); if (!window.MPPi) throw new Error("تعذّر تحميل مدفوعات Pi"); }
  async function payWith(endpoint, body, memo, amount) { await needPi(); let x = null; await window.MPPi.pay({ amount, memo, purpose: "subscription", intent: async () => { x = await api("POST", endpoint, body); return x.intent; } }); return x; }

  /* ---------- #/subs/:handle ---------- */
  async function subsView(handle) {
    // v2.51: #/subs without a creator used to request /api/subs/undefined (404) — show where subscriptions live instead
    if (!handle || handle === "undefined") {
      page("الاشتراك الشهري", `<div class="card empty" role="status">اختر صانع محتوى من ملفه الشخصي للاشتراك الشهري فيه.</div><div class="list">${UI.li({ href: "#/supporting", icon: "star", title: "من أدعمهم", sub: "اشتراكاتك ودعمك الشهري" })}${UI.li({ href: "#/subscribers", icon: "users", title: "مشتركيّ", sub: "المشتركون ومستويات الاشتراك" })}</div>`, ["#/me", "حسابي"]);
      return;
    }
    page("الاشتراك الشهري", `<div class="skel"></div><div class="skel"></div>`, ["#/u/" + enc(handle), "الملف الشخصي"]);
    let d; try { d = await api("GET", "/api/subs/" + enc(handle)); } catch (e) { $(".wrap").insertAdjacentHTML("beforeend", errBox(e)); view.querySelectorAll(".skel").forEach((x) => x.remove()); return; }
    view.querySelectorAll(".skel").forEach((x) => x.remove());
    const me = d.me || { state: "none" }, cur = me.tier?.id;
    $("#sb-h").textContent = `اشترك في @${d.creator.handle}`;
    let html = "";
    if (!d.creator.enabled || !d.tiers.length) html += `<div class="card empty">لا يقدّم هذا الحساب اشتراكات حالياً</div>`;
    if (!d.payments) html += `<div class="card empty" role="status">الاشتراكات تعمل فور تفعيل مدفوعات Pi — يمكنك تصفّح المستويات الآن</div>`;
    if (me.minor) html += `<div class="card empty" role="status">الاشتراكات غير متاحة لمن هم دون ١٨ سنة</div>`;
    if (me.state !== "none") html += `<section class="sb-hero f-cover"><b>اشتراكك: ${h(me.tier?.name || "—")}</b>${chip(me.state)}
      <p class="muted">${me.state === "grace" ? `انتهت الفترة؛ جدّد قبل ${day(me.graceUntil)} لتحتفظ بمزاياك` : `حتى ${day(me.activeUntil)} · بقي ${me.daysLeft} يوم`}</p>
      ${me.scheduled ? `<p>سيتحوّل إلى «${h((d.tiers.find((t) => t.id === me.scheduled.tierId) || {}).name || "")}» عند التجديد · <button type="button" class="btn ghost" data-sb="unschedule">إلغاء التخفيض</button></p>` : ""}
      <div class="tr-acts">${me.canRenew && d.payments ? `<button type="button" class="btn" data-sb="renew">جدّد الآن</button>` : ""}${me.channel ? `<a class="btn ghost" href="#/subs/${enc(d.creator.handle)}/channel">قناة المشتركين</a>` : ""}
      ${["active", "due"].includes(me.state) ? `<button type="button" class="btn ghost" data-sb="cancel">إلغاء التجديد</button>` : ""}</div></section>`;
    html += d.tiers.map((t) => {
      const isCur = t.id === cur && me.current, act = me.state === "none" || !me.current ? "subscribe" : t.amount > (me.tier?.amount || 0) ? "upgrade" : t.amount < (me.tier?.amount || 0) ? "downgrade" : null;
      const label = { subscribe: "اشترك", upgrade: "ترقية", downgrade: "تخفيض عند التجديد" }[act];
      return `<article class="sb-tier ${isCur ? "cur" : ""}"><div class="top"><b>${h(t.badgeEmoji || "")} ${h(t.name)}</b><span class="price">${amt(t.amount)}<small class="muted"> / شهر</small></span></div>
        ${t.description ? `<p class="muted">${h(t.description)}</p>` : ""}<ul class="sb-ben">${t.benefits.map((b) => `<li>${ben(b)}${b === "early" && t.earlyHours ? ` (${t.earlyHours} س)` : ""}</li>`).join("")}${t.perks ? `<li>${h(t.perks)}</li>` : ""}</ul>
        ${isCur ? `<p class="muted">✓ مستواك الحالي</p>` : label && !d.isOwner && !me.minor ? `<button type="button" class="btn ${act === "downgrade" ? "ghost" : ""}" data-sb="${act}" data-t="${h(t.id)}" ${d.payments ? "" : "disabled"}>${label}</button>` : ""}</article>`;
    }).join("");
    html += `<p class="u-t-sm muted">لا يوجد خصم تلقائي في Pi: كل شهر دفعة تؤكّدها بنفسك. نذكّرك قبل الانتهاء بـ${d.rules.remindDays} أيام، ولك ${d.rules.graceDays} أيام سماح بعده. الترقية تدفع الفرق للمدة المتبقية فقط؛ التخفيض يبدأ عند التجديد بلا استرداد.</p><div id="sb-out" role="status" aria-live="polite"></div>`;
    $(".wrap").insertAdjacentHTML("beforeend", html);
    const out = $("#sb-out"), H = d.creator.handle;
    view.querySelectorAll("[data-sb]").forEach((b) => b.addEventListener("click", async () => {
      const a = b.dataset.sb, tid = b.dataset.t; b.disabled = true;
      try {
        if (a === "subscribe" || a === "renew") { const tt = d.tiers.find((t) => t.id === (tid || me.scheduled?.tierId || cur)) || {}; await payWith(`/api/subs/${enc(H)}/renew`, tid ? { tierId: tid } : {}, "اشتراك شهري", tt.amount || me.tier?.amount || 1); say("تم الاشتراك ✓"); }
        else if (a === "upgrade") {
          const q = await api("GET", `/api/subs/${enc(H)}/quote?tierId=${enc(tid)}`);
          if (!confirm(q.charge > 0 ? `تدفع الآن ${q.charge} π (الفرق عن ${q.remainingDays} يوم متبقٍ) ويبدأ «${q.to.name}» فوراً. متابعة؟` : `تتم الترقية إلى «${q.to.name}» مجاناً للمدة المتبقية. متابعة؟`)) { b.disabled = false; return; }
          if (q.charge > 0) await payWith(`/api/subs/${enc(H)}/change`, { tierId: tid }, "ترقية اشتراك", q.charge); else await api("POST", `/api/subs/${enc(H)}/change`, { tierId: tid });
          say("تمت الترقية ✓");
        } else if (a === "downgrade") { const r = await api("POST", `/api/subs/${enc(H)}/change`, { tierId: tid }); say(r.note || "سيُطبّق عند التجديد"); }
        else if (a === "unschedule") { await api("DELETE", `/api/subs/${enc(H)}/change`); say("أُلغي التخفيض"); }
        else if (a === "cancel") { if (!confirm("يبقى اشتراكك فعّالاً حتى نهاية الفترة المدفوعة. إلغاء التجديد؟")) { b.disabled = false; return; } const r = await api("POST", `/api/support/${enc(me.supportId)}/cancel`); say(r.note || "تم"); }
        subsView(H);
      } catch (e) { out.innerHTML = errBox(e); b.disabled = false; }
    }));
  }

  /* ---------- #/subs/:handle/channel ---------- */
  async function channelView(handle) {
    page("قناة المشتركين", `<div class="skel"></div>`, ["#/subs/" + enc(handle), "الاشتراك"], "comment");
    let d; try { d = await api("GET", `/api/subs/${enc(handle)}/channel`); } catch (e) { view.querySelector(".skel")?.remove(); $(".wrap").insertAdjacentHTML("beforeend", errBox(e)); return; }
    view.querySelector(".skel")?.remove();
    $(".wrap").insertAdjacentHTML("beforeend", `<ul class="sb-msgs card" aria-live="polite">${d.items.map((m) => `<li><span class="who">${h(m.author?.name || "")}</span>${m.isCreator ? `<span class="sb-chip ok">صاحب القناة</span>` : ""}${m.badge ? `<span class="bd" title="${h(m.badge.tier || "")}">${h(m.badge.emoji)} ${h(m.badge.label)}</span>` : ""}
      <div>${h(m.text)}</div><small class="muted">${day(m.at)}</small>${m.canDelete ? ` <button type="button" class="btn ghost" data-del="${h(m.id)}" aria-label="حذف الرسالة">حذف</button>` : ""}</li>`).join("") || `<li class="muted">لا رسائل بعد — ابدأ المحادثة</li>`}</ul>
      <form class="sb-form" id="sb-send"><label class="pi-sr" for="sb-txt">رسالة</label><textarea id="sb-txt" maxlength="1000" required placeholder="اكتب رسالة للمشتركين"></textarea><button class="btn">إرسال</button></form>`);
    view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => { try { await api("DELETE", `/api/subs/${enc(handle)}/channel/${enc(b.dataset.del)}`); channelView(handle); } catch (e) { say(e.message); } }));
    $("#sb-send").addEventListener("submit", async (e) => { e.preventDefault(); const t = $("#sb-txt").value.trim(); if (!t) return; try { await api("POST", `/api/subs/${enc(handle)}/channel`, { text: t }); channelView(handle); } catch (x) { say(x.message); } });
  }

  /* ---------- #/subscribers (creator studio) ---------- */
  async function studioView(tab) {
    tab = tab || "stats";
    const tabs = [["stats", "الإحصاءات"], ["list", "المشتركون"], ["tiers", "مزايا المستويات"], ["early", "الوصول المبكر"]];
    page("المشتركون", `<nav class="sb-tabs seg" aria-label="أقسام">${tabs.map(([k, l]) => `<a href="#/subscribers/${k}" ${k === tab ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav><div id="sb-body"><div class="skel"></div></div>`, ["#/creator", "إعدادات الدعم"], "users");
    const body = $("#sb-body");
    try {
      if (tab === "stats") {
        const s = await api("GET", "/api/me/subscribers/stats");
        body.innerHTML = `<div class="sb-stats f-kpis"><div class="kpi-tile"><b>${UI.num(s.current)}</b><span>مشترك حالي</span></div><div class="kpi-tile"><b>${amt(s.mrr)}</b><span>دخل شهري متكرر</span></div><div class="kpi-tile"><b>${UI.num(s.churnRate)}٪</b><span>معدل الإلغاء (30 يوماً)</span></div><div class="kpi-tile"><b>${UI.num(s.last30.started)}</b><span>جديد (30 يوماً)</span></div>
          <div><b>${UI.num(s.last30.renewed)}</b> تجديد</div><div><b>${UI.num(s.inGrace)}</b> في فترة السماح</div><div><b>${UI.num(s.last30.upgraded)}</b> ترقية</div><div><b>${UI.num(s.last30.downgrades)}</b> تخفيض مجدول</div></div>
          <h3 class="u-t-md">حسب المستوى</h3><ul class="sb-list card">${s.byTier.map((t) => `<li><span class="g">${h(t.name || "—")}</span>${t.count} · ${amt(t.mrr)}</li>`).join("") || `<li class="muted">لا مشتركين بعد</li>`}</ul>
          <h3 class="u-t-md">آخر 6 أشهر</h3><table class="card" style="width:100%;border-collapse:collapse"><caption class="pi-sr">المشتركون شهرياً</caption><thead><tr><th scope="col">الشهر</th><th scope="col">جدد</th><th scope="col">تجديد</th><th scope="col">إلغاء/انتهاء</th></tr></thead><tbody>${s.months.map((m) => `<tr><td>${m.month}</td><td>${m.started}</td><td>${m.renewed}</td><td>${m.churned}</td></tr>`).join("")}</tbody></table>`;
      } else if (tab === "list") {
        const l = await api("GET", "/api/me/subscribers");
        body.innerHTML = `<ul class="sb-list card">${l.items.map((i) => `<li><span class="g"><b>${i.user ? h(i.user.name) + ` <small class="muted">@${h(i.user.handle)}</small>` : "مشترك مجهول"}</b><small class="u-db muted">${h(i.tier?.name || "—")} · ${i.months} شهر · حتى ${day(i.activeUntil)}</small></span>${chip(i.state)}</li>`).join("") || `<li class="muted">لا مشتركين بعد</li>`}</ul>`;
      } else if (tab === "tiers") {
        const d = await api("GET", "/api/me/subs/tiers");
        if (!d.tiers.length) { body.innerHTML = `<div class="card empty">أنشئ مستويات الدعم أولاً من <a href="#/creator">إعدادات الدعم</a></div>`; return; }
        body.innerHTML = `<form id="sb-tiers" class="sb-ed">${d.tiers.map((t, i) => `<fieldset class="sb-tier" data-id="${h(t.id)}"><legend><b>${h(t.name)}</b> · ${amt(t.amount)}</legend>
          ${d.benefits.map((b) => `<label><input type="checkbox" name="b${i}" value="${b.key}" ${t.benefits.includes(b.key) ? "checked" : ""}> ${h(b.label)}</label>`).join("")}
          <label for="bd${i}">اسم الشارة</label><input type="text" id="bd${i}" maxlength="24" value="${h(t.badge || "")}"><label for="be${i}">رمز الشارة</label><input type="text" id="be${i}" maxlength="4" value="${h(t.badgeEmoji || "")}">
          <label for="eh${i}">ساعات الوصول المبكر</label><input type="number" id="eh${i}" min="0" max="168" value="${t.earlyHours || 0}"><label for="ds${i}">وصف</label><input type="text" id="ds${i}" maxlength="300" value="${h(t.description || "")}"></fieldset>`).join("")}
          <button class="u-w100 u-mh50 btn">حفظ المزايا</button></form>`;
        $("#sb-tiers").addEventListener("submit", async (e) => { e.preventDefault(); const tiers = [...view.querySelectorAll("fieldset[data-id]")].map((f, i) => ({ id: f.dataset.id, benefits: [...f.querySelectorAll(`input[name=b${i}]:checked`)].map((x) => x.value), badge: $("#bd" + i).value.trim(), badgeEmoji: $("#be" + i).value.trim(), earlyHours: Number($("#eh" + i).value || 0), description: $("#ds" + i).value.trim() }));
          try { await api("PUT", "/api/me/subs/tiers", { tiers }); say("حُفظت المزايا ✓"); } catch (x) { say(x.message); } });
      } else {
        const l = await api("GET", "/api/me/subs/early");
        body.innerHTML = `<form id="sb-early" class="u-p12 sb-ed card"><label for="se-p">معرّف منشور للمشتركين</label><input type="text" id="se-p" required><label for="se-h">يصبح عاماً بعد (ساعات)</label><input type="number" id="se-h" min="1" max="168" value="24"><button class="u-w100 u-mh48 u-mt8 btn">تفعيل الوصول المبكر</button></form>
          <ul class="sb-list card">${l.items.map((i) => `<li><span class="g">${h(i.teaser || i.postId)}<small class="u-db muted">${i.releasedAt ? "أصبح عاماً " + day(i.releasedAt) : "يصبح عاماً " + day(i.publicAt)}</small></span>${i.releasedAt ? "" : `<button type="button" class="btn ghost" data-ce="${h(i.postId)}">إلغاء</button>`}</li>`).join("") || `<li class="muted">لا منشورات بوصول مبكر</li>`}</ul>`;
        $("#sb-early").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("POST", "/api/me/subs/early", { postId: $("#se-p").value.trim(), hours: Number($("#se-h").value) }); studioView("early"); } catch (x) { say(x.message); } });
        view.querySelectorAll("[data-ce]").forEach((b) => b.addEventListener("click", async () => { try { await api("DELETE", "/api/me/subs/early/" + enc(b.dataset.ce)); studioView("early"); } catch (x) { say(x.message); } }));
      }
    } catch (e) { body.innerHTML = errBox(e); }
  }

  MPRoutes.extend((a, b, prev) => {
    return { subs: () => (b === "channel" ? channelView(a) : subsView(a)), subscribers: () => studioView(a) };
  });
  window.MPSubs = { subsView, channelView, studioView, version: "2.25.0" };
  if (/^#\/(subs|subscribers)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
