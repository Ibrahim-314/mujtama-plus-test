/* =====================================================================
 * مجتمع بلس — Phase 54 UI: invite-based beta (lazy "beta" chunk, loaded by the "ai" chunk on idle; 0 bytes in core).
 *   floating «ملاحظة» button for beta testers + staff → feedback sheet (bug / idea / other, optional screenshot, device info)
 *   NPS / satisfaction micro-survey sheet (at most every 14 days)
 *   #/beta            my beta: wave, badge on/off, personal invite codes (quota), my feedback + replies
 *   #/beta/f/:id      one feedback thread (reply)
 *   #/admin/beta      waves (open next wave, invite waitlist, add testers), triage board, cohort dashboard, flag kill switches
 *   🧪 badge on profiles (#/u/:handle) of testers who keep it on. CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function BetaUI() {
  if (window.MPBeta) return;
  const api = (m, p, b, raw) => Remote.api(m, p, b, raw);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(iso)); } catch { return String(iso); } };
  const $ = (s) => view.querySelector(s);
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const page = (title, body, back) => { view.innerHTML = `<div class="wrap bt-page">${UI.pageHead({ back, title, icon: /تجريبية/.test(title) ? "flask" : "feedback", id: "bt-h" })}${body}</div>`; $("#bt-h")?.focus({ preventScroll: true }); };
  const KIND = { bug: "خطأ", idea: "فكرة", other: "أخرى" };
  const PRI = { low: "منخفضة", normal: "عادية", high: "عالية", urgent: "عاجلة" };
  const online = () => typeof Remote !== "undefined" && Remote.on && typeof DB !== "undefined" && DB.me;
  let ME = null;
  if (!document.getElementById("bt-css")) document.head.insertAdjacentHTML("beforeend", `<style id="bt-css">
.bt-page{max-width:760px;margin:auto}.bt-page h2:focus{outline:none}.bt-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.bt-row .btn{min-height:44px}

.bt-sheet{border:0;border-radius:18px 18px 0 0;max-width:560px;width:100%;margin:auto auto 0;padding:16px;box-sizing:border-box}.bt-sheet::backdrop{background:#0006}
.bt-sheet label{display:block;margin-top:10px}.bt-sheet textarea,.bt-f input:not([type=checkbox]):not([type=radio]),.bt-f select,.bt-f textarea{width:100%;min-height:44px;box-sizing:border-box}.bt-sheet textarea{min-height:110px}
.bt-kinds{display:flex;gap:6px}.bt-kinds label{flex:1;margin:0;text-align:center;padding:10px;border:1px solid var(--line,#ddd);border-radius:12px;cursor:pointer}.bt-kinds input{position:absolute;opacity:0}.bt-kinds label:has(input:checked){border-color:var(--brand,#5b2bd9);font-weight:700}
.bt-scale{display:flex;gap:4px;flex-wrap:wrap}.bt-scale button{min-width:40px;min-height:44px}.bt-note{padding:10px 12px;border-radius:12px;background:#8881;font-size:14px;margin:8px 0}
.bt-chips{display:flex;gap:6px;overflow-x:auto;padding:4px 0}.bt-chips a{white-space:nowrap;min-height:40px}.bt-kpi{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.bt-kpi div{padding:12px;border-radius:14px;background:#8881}.bt-kpi b{display:block;font-size:22px}
.bt-card{padding:12px;margin-bottom:10px}.bt-st{font-size:12px;padding:2px 8px;border-radius:999px;background:#8882}.bt-code{font-family:ui-monospace,monospace;direction:ltr;user-select:all;padding:4px 8px;border-radius:8px;background:#8882}
.bt-badge{display:inline-flex;align-items:center;gap:4px;vertical-align:middle;font-size:12.5px;font-weight:700;padding:3px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent-ink);margin-inline-start:6px;white-space:nowrap}.bt-badge .ic{width:14px;height:14px}
.bt-t{width:100%;border-collapse:collapse;font-size:14px}.bt-t th,.bt-t td{padding:8px 6px;border-bottom:1px solid var(--line,#eee);text-align:start;vertical-align:top}
</style>`);

  /* ---------- device info (no fingerprinting: coarse, user-visible, optional) ---------- */
  function deviceInfo() {
    const n = navigator, c = n.connection || {};
    return { ua: n.userAgent, platform: (n.userAgentData && n.userAgentData.platform) || n.platform || "", lang: n.language, screen: `${screen.width}x${screen.height}`, viewport: `${innerWidth}x${innerHeight}`, dpr: String(devicePixelRatio || 1), conn: c.effectiveType || "", memory: n.deviceMemory ? String(n.deviceMemory) : "", standalone: matchMedia("(display-mode: standalone)").matches, piBrowser: /PiBrowser/i.test(n.userAgent), release: (typeof DB !== "undefined" && DB.serverVersion) || "" };
  }

  /* ---------- feedback sheet ---------- */
  function sheet(html) {
    document.getElementById("bt-dlg")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<dialog id="bt-dlg" class="bt-sheet" aria-labelledby="bt-dt">${html}</dialog>`);
    const d = document.getElementById("bt-dlg"); d.addEventListener("close", () => d.remove()); d.showModal(); return d;
  }
  function feedbackSheet(kind) {
    const d = sheet(`<form id="bt-ff" method="dialog"><h3 id="bt-dt" class="u-m0">أرسل ملاحظة للفريق</h3>
      <div class="u-mt10 bt-kinds" role="radiogroup" aria-label="نوع الملاحظة">${Object.entries(KIND).map(([k, v]) => `<label><input type="radio" name="kind" value="${k}" ${k === (kind || "bug") ? "checked" : ""}>${v}</label>`).join("")}</div>
      <label for="bt-tx">ماذا حدث أو ما الذي تقترحه؟</label><textarea id="bt-tx" name="text" required minlength="3" maxlength="4000" placeholder="اكتب بالتفصيل، مثلاً: ضغطت «نشر» فلم يحدث شيء"></textarea>
      <label for="bt-shot">لقطة شاشة (اختياري)</label><input id="bt-shot" name="shot" type="file" accept="image/*">
      <label class="u-dflex u-g8 u-aic"><input type="checkbox" name="dev" checked> أرفق معلومات الجهاز (نوع الجهاز واللغة وحجم الشاشة والإصدار)</label>
      <div class="u-mt14 bt-row"><button class="btn" id="bt-send" type="submit" value="send">إرسال</button><button class="btn ghost" type="button" id="bt-x">إلغاء</button></div></form>`);
    d.querySelector("#bt-x").addEventListener("click", () => d.close());
    d.querySelector("#bt-ff").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = e.target, btn = d.querySelector("#bt-send"); btn.disabled = true;
      try {
        let mediaId = null; const file = f.shot.files[0];
        if (file) { if (file.size > 8 * 1048576) throw new Error("حجم الصورة كبير (٨ ميغابايت كحد أقصى)"); mediaId = (await api("POST", "/api/media", null, file)).media.id; }
        await api("POST", "/api/beta/feedback", { kind: f.kind.value, text: f.text.value.trim(), mediaId, route: location.hash.slice(0, 200), device: f.dev.checked ? deviceInfo() : { release: deviceInfo().release } });
        d.close(); say("شكراً! وصلت ملاحظتك إلى الفريق — تابع الرد في «النسخة التجريبية»");
      } catch (err) { btn.disabled = false; say(err.message); }
    });
  }
  function surveySheet(s) {
    const n = s.max - s.min + 1;
    const d = sheet(`<h3 id="bt-dt" class="u-m0">${h(s.question)}</h3><p class="u-my6 muted">${s.kind === "nps" ? "0 = غير محتمل إطلاقاً · 10 = محتمل جداً" : "1 = غير راضٍ · 5 = راضٍ جداً"}</p>
      <div class="bt-scale" role="group" aria-label="الدرجة">${Array.from({ length: n }, (_, i) => `<button type="button" class="btn ghost" data-sc="${s.min + i}">${s.min + i}</button>`).join("")}</div>
      <label for="bt-sc" class="u-mt10 u-db">تعليق (اختياري)</label><textarea id="bt-sc" maxlength="1000" style="width:100%;min-height:70px;box-sizing:border-box"></textarea>
      <div class="bt-row"><button type="button" class="btn ghost" id="bt-later">لاحقاً</button></div>`);
    api("POST", "/api/beta/survey/shown", { kind: s.kind }).catch(() => { });
    d.querySelector("#bt-later").addEventListener("click", () => { api("POST", "/api/beta/survey/shown", { kind: s.kind, dismissed: true }).catch(() => { }); d.close(); });
    d.querySelectorAll("[data-sc]").forEach((b) => b.addEventListener("click", async () => {
      try { await api("POST", "/api/beta/survey", { kind: s.kind, score: +b.dataset.sc, comment: d.querySelector("#bt-sc").value.trim() || undefined }); d.close(); say("شكراً لرأيك"); } catch (e) { say(e.message); }
    }));
  }
  /* v2.32: one floating button only (compose). Beta feedback is a row in Settings and in your profile, not a second FAB. */
  function fab() {
    if (!ME || !(ME.member || ME.staff)) return;
    const put = () => {
      if (!/^#\/(settings|me)\/?(\?|$)/.test(location.hash) || document.getElementById("bt-fab")) return;
      const w = view.querySelector(".wrap"); if (!w) return;
      const row = `<button type="button" id="bt-fab" class="list li bt-entry" aria-label="أرسل ملاحظة عن النسخة التجريبية"><span class="ico">${window.UI ? UI.icon("feedback", "sm") : ""}</span><span class="t"><b>ملاحظة عن النسخة التجريبية</b><small>أخبرنا بخطأ أو فكرة، تصل مباشرة لفريق التطوير</small></span><span class="chev" aria-hidden="true">←</span></button>`;
      const h2 = w.querySelector(":scope > h2, :scope > .page-head"); if (h2 && /settings/.test(location.hash)) h2.insertAdjacentHTML("afterend", row); else w.insertAdjacentHTML("beforeend", row);
      document.getElementById("bt-fab").addEventListener("click", () => feedbackSheet());
    };
    put(); addEventListener("hashchange", () => setTimeout(put, 400));
    if (typeof Views !== "undefined" && Views.settings) { MPSettings.add(function () { setTimeout(put, 0); }); }
  }
  /* v2.51: starts only for a signed-in session (MPSession.whenIn — guests never poll); a 401/403 answer stops for good (until the
   * next sign-in), other failures retry with backoff 2 s → 4 s → 8 s … capped at 60 s, at most 6 tries (was: 40 tries every 1.5 s). */
  let tries = 0, booting = false;
  async function boot() {
    if (booting || ME) return;
    if (window.MPSession && !MPSession.signedIn()) { MPSession.whenIn(boot); return; }
    if (!online()) { if (tries++ < 6) setTimeout(boot, Math.min(60e3, 2000 * 2 ** (tries - 1))); return; } // the session/hydration may finish after the chunk loads
    booting = true;
    try { ME = await api("GET", "/api/beta/me"); }
    catch (e) {
      booting = false;
      if (e && (e.status === 401 || e.status === 403)) { tries = 0; if (window.MPSession) addEventListener("mp:session", function again(ev) { if (ev.detail === "in") { removeEventListener("mp:session", again); boot(); } }); return; }
      if (tries++ < 6) setTimeout(boot, Math.min(60e3, 2000 * 2 ** (tries - 1))); return;
    }
    booting = false;
    fab();
    const today = new Date().toISOString().slice(0, 10);
    try { if (ME.member && localStorage.getItem("mp.beta.ping") !== today) { localStorage.setItem("mp.beta.ping", today); api("POST", "/api/beta/ping").catch(() => { }); } } catch { /* storage off */ }
    if (ME.member && ME.survey) setTimeout(() => { if (!document.querySelector("dialog[open]")) surveySheet(ME.survey); }, 20000);
  }

  /* ---------- #/beta ---------- */
  async function mineView() {
    page("النسخة التجريبية", `<div id="bt-m"><div class="skel"></div></div>`, ["#/settings", "الإعدادات"]);
    const box = $("#bt-m"); /* stale-route guard (fast navigation) */
    let m, f; try { [m, f] = await Promise.all([api("GET", "/api/beta/me"), api("GET", "/api/beta/feedback")]); ME = m; } catch (e) { if (box?.isConnected) box.innerHTML = errBox(e); return; }
    if (!box?.isConnected) return;
    const inv = m.member ? `<section class="card bt-card"><h3 class="u-m0 u-mb6 u-t-lg">دعوات لأصدقائك</h3><p class="u-m0 muted">بقي لك <b>${m.invitesLeft}</b> من ${m.quota} دعوات. كل رمز يُستخدم مرة واحدة.</p>
        <div class="bt-row"><button type="button" class="btn" id="bt-inv" ${m.invitesLeft > 0 && m.cohort.status === "open" ? "" : "disabled"}>إنشاء رمز دعوة</button></div>
        <ul class="u-lsn u-p0 u-m0">${m.invites.map((i) => `<li class="bt-row"><span class="bt-code">${h(i.code)}</span><span class="muted">${i.used ? "استُخدم" : i.revoked ? "أُلغي" : "صالح حتى " + day(i.expiresAt)}</span>${!i.used && !i.revoked ? `<button type="button" class="btn ghost" data-copy="${h(i.code)}">نسخ الرابط</button>` : ""}</li>`).join("")}</ul></section>` : "";
    $("#bt-m").innerHTML = (m.member ? `<section class="card bt-card"><b>${h(m.cohort.name)}</b> <span class="bt-st">${m.cohort.status === "open" ? "مفتوحة" : m.cohort.status === "closed" ? "مغلقة" : "مخطط لها"}</span><div class="muted">انضممت ${day(m.joinedAt)}</div>
        <label class="u-mt8 bt-row"><input type="checkbox" id="bt-bdg" ${m.badge ? "checked" : ""}> أظهر شارة «مختبر تجريبي» في ملفي</label></section>` : `<div class="bt-note">لست ضمن موجات الاختبار حالياً، ويمكنك مع ذلك إرسال ملاحظاتك للفريق.</div>`) + inv +
      `<div class="bt-row"><button type="button" class="btn" id="bt-new"><svg class=ei aria-hidden=true><use href=#i-comment /></svg> أرسل ملاحظة</button>${m.staff ? `<a class="btn ghost" href="#/admin/beta">إدارة النسخة التجريبية</a>` : ""}</div>
      <h3 class="u-t-lg">ملاحظاتي</h3>${f.items.length ? f.items.map((x) => `<a class="u-db u-ci u-tdn card bt-card" href="#/beta/f/${enc(x.id)}"><b>${KIND[x.kind] || x.kind}</b> <span class="bt-st">${h(x.statusLabel)}</span><div class="u-mt4">${h(x.text.slice(0, 160))}</div><div class="u-t-sm muted">${day(x.createdAt)}${x.lastBy === "staff" ? " · ردّ الفريق" : ""}</div></a>`).join("") : `<div class="empty">لم ترسل ملاحظات بعد</div>`}`;
    $("#bt-new").addEventListener("click", () => feedbackSheet());
    $("#bt-bdg")?.addEventListener("change", async (e) => { try { await api("PUT", "/api/beta/badge", { show: e.target.checked }); say(e.target.checked ? "الشارة ظاهرة" : "الشارة مخفية"); } catch (err) { say(err.message); } });
    $("#bt-inv")?.addEventListener("click", async () => { try { const r = await api("POST", "/api/beta/invites"); say("رمز جديد: " + r.code); mineView(); } catch (e) { say(e.message); } });
    view.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => { const link = `${location.origin}/?invite=${enc(b.dataset.copy)}#/waitlist`; navigator.clipboard?.writeText(link).then(() => say("نُسخ الرابط"), () => say(link)); }));
  }
  async function threadView(fid) {
    page("ملاحظة", `<div id="bt-th"><div class="skel"></div></div>`, ["#/beta", "النسخة التجريبية"]);
    const box = $("#bt-th"); /* stale-route guard (fast navigation) */
    let d; try { d = await api("GET", "/api/beta/feedback/" + enc(fid)); } catch (e) { if (box?.isConnected) box.innerHTML = errBox(e); return; }
    if (!box?.isConnected) return;
    const F = d.feedback;
    $("#bt-th").innerHTML = `<section class="card bt-card"><b>${KIND[F.kind] || F.kind}</b> <span class="bt-st">${h(F.statusLabel)}</span><p class="u-pre">${h(F.text)}</p>${F.screenshot ? `<img src="${h(F.screenshot)}" alt="لقطة الشاشة المرفقة" style="max-width:100%;border-radius:12px">` : ""}<div class="u-t-sm muted">${day(F.createdAt)} · ${h(F.device?.platform || "")} ${h(F.device?.screen || "")}</div></section>
      ${d.messages.map((x) => `<div class="card bt-card" style="${x.staff ? "border-inline-start:4px solid var(--brand,#5b2bd9)" : ""}"><b>${h(x.by)}</b> <span class="u-t-sm muted">${day(x.createdAt)}</span><p class="u-pre u-m0 u-mt6">${h(x.text)}</p></div>`).join("")}
      <form id="bt-rf" class="bt-f"><label for="bt-rt">أضف تفاصيل أو ردّاً</label><textarea id="bt-rt" required maxlength="4000"></textarea><div class="bt-row"><button class="btn">إرسال</button></div></form>`;
    $("#bt-rf").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("POST", `/api/beta/feedback/${enc(fid)}/reply`, { text: $("#bt-rt").value.trim() }); threadView(fid); } catch (err) { say(err.message); } });
  }

  /* ---------- #/admin/beta ---------- */
  const tabs = (cur) => `<div class="bt-chips">${[["waves", "الموجات"], ["board", "لوحة الملاحظات"], ["dash", "المؤشرات"], ["flags", "مفاتيح الإيقاف"]].map(([k, v]) => `<a class="btn ghost" href="#/admin/beta/${k}" aria-current="${k === cur ? "page" : "false"}">${v}</a>`).join("")}</div>`;
  async function adminView(tab) {
    tab = ["waves", "board", "dash", "flags"].includes(tab) ? tab : "waves";
    page("إدارة النسخة التجريبية", tabs(tab) + `<div id="bt-a"><div class="skel"></div></div>`, ["#/admin", "الإدارة"]);
    const box = $("#bt-a");
    try {
      if (tab === "waves") {
        const d = await api("GET", "/api/admin/beta/cohorts");
        box.innerHTML = `<div class="bt-note">وضع التسجيل الحالي: <b>${d.mode === "invite" ? "بالدعوة فقط" : "مفتوح للجميع"}</b>. يتغير من متغير البيئة LAUNCH_MODE على Railway (open أو invite) — لا يغيّره هذا الزر.</div>` +
          d.items.map((c) => `<section class="card bt-card"><b>${h(c.name)}</b> <span class="bt-st">${c.status === "open" ? "مفتوحة" : c.status === "closed" ? "مغلقة" : "مخطط لها"}</span>
            <div class="u-mt8 bt-kpi"><div><b>${c.members}</b>مختبر</div><div><b>${c.capacity}</b>السعة</div><div><b>${c.pendingInvites}</b>دعوات معلّقة</div><div><b>${c.room}</b>مقاعد متاحة</div></div>
            <div class="bt-row">${c.status !== "open" ? `<button type="button" class="btn" data-open="${h(c.id)}">فتح الموجة${c.room ? " ودعوة قائمة الانتظار" : ""}</button>` : `<button type="button" class="btn" data-inv="${h(c.id)}">دعوة من قائمة الانتظار</button><button type="button" class="btn ghost" data-close="${h(c.id)}">إغلاق</button>`}<button type="button" class="btn ghost" data-add="${h(c.id)}">إضافة مختبرين</button><button type="button" class="btn ghost" data-cap="${h(c.id)}" data-v="${c.capacity}">تعديل السعة</button></div></section>`).join("") +
          `<div class="bt-row"><button type="button" class="btn ghost" id="bt-nw">+ موجة جديدة</button></div><div id="bt-out"></div>`;
        const out = (r) => { $("#bt-out").innerHTML = r.invited?.length ? `<div class="bt-note">${h(r.note || "")}</div><table class="bt-t"><tr><th>قائمة الانتظار</th><th>الرمز</th></tr>${r.invited.map((x) => `<tr><td>${h(x.contact)}</td><td><span class="bt-code">${h(x.code)}</span></td></tr>`).join("")}</table>` : ""; };
        box.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", async () => { const n = prompt("كم شخصاً تدعو من قائمة الانتظار الآن؟ (0 = بدون دعوات)", "0"); if (n === null) return; try { const r = await api("POST", `/api/admin/beta/cohorts/${enc(b.dataset.open)}/open`, { inviteWaitlist: +n > 0, count: +n }); await adminView("waves"); out(r); } catch (e) { say(e.message); } }));
        box.querySelectorAll("[data-inv]").forEach((b) => b.addEventListener("click", async () => { const n = prompt("عدد المدعوين من قائمة الانتظار", "10"); if (!n) return; try { const r = await api("POST", `/api/admin/beta/cohorts/${enc(b.dataset.inv)}/invite`, { count: +n }); await adminView("waves"); out({ ...r, note: "أرسل الرموز يدوياً لأصحابها." }); } catch (e) { say(e.message); } }));
        box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("إغلاق الموجة يوقف دعوات المختبرين فيها. متابعة؟")) return; try { await api("POST", `/api/admin/beta/cohorts/${enc(b.dataset.close)}/close`); adminView("waves"); } catch (e) { say(e.message); } }));
        box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", async () => { const v = prompt("أسماء المستخدمين مفصولة بمسافة أو فاصلة"); if (!v) return; try { const r = await api("POST", `/api/admin/beta/cohorts/${enc(b.dataset.add)}/members`, { handles: v }); say(`أُضيف ${r.added.length}، وتُخطّي ${r.skipped.length}`); adminView("waves"); } catch (e) { say(e.message); } }));
        box.querySelectorAll("[data-cap]").forEach((b) => b.addEventListener("click", async () => { const v = prompt("السعة الجديدة", b.dataset.v); if (!v) return; try { await api("PUT", `/api/admin/beta/cohorts/${enc(b.dataset.cap)}`, { capacity: +v }); adminView("waves"); } catch (e) { say(e.message); } }));
        $("#bt-nw").addEventListener("click", async () => { const name = prompt("اسم الموجة", "الموجة التالية"); if (!name) return; const cap = prompt("السعة", "1000"); if (!cap) return; try { await api("POST", "/api/admin/beta/cohorts", { name, capacity: +cap }); adminView("waves"); } catch (e) { say(e.message); } });
      } else if (tab === "board") {
        const st = new URLSearchParams(location.hash.split("?")[1] || "").get("status") || "";
        const d = await api("GET", "/api/admin/beta/feedback" + (st ? "?status=" + enc(st) : ""));
        box.innerHTML = `<div class="bt-chips"><a class="btn ghost" href="#/admin/beta/board" aria-current="${!st}">الكل</a>${d.statuses.map((s) => `<a class="btn ghost" href="#/admin/beta/board?status=${s.key}" aria-current="${st === s.key}">${h(s.label)} (${d.columns[s.key] || 0})</a>`).join("")}</div>` +
          (d.items.length ? d.items.map((f) => `<section class="card bt-card" data-f="${h(f.id)}"><b>${KIND[f.kind] || f.kind}</b> <span class="bt-st">${h(f.statusLabel)}</span> <span class="bt-st">${PRI[f.priority] || f.priority}</span> <span class="muted">${h(f.author || "")} · ${day(f.createdAt)}</span>
            <p class="u-pre u-my6">${h(f.text)}</p>${f.screenshot ? `<a href="${h(f.screenshot)}" target="_blank" rel="noopener"><svg class=ei aria-hidden=true><use href=#i-clip /></svg> لقطة الشاشة</a>` : ""}<div class="u-t-xs muted">${h([f.route, f.device?.platform, f.device?.screen, f.device?.lang, f.device?.piBrowser ? "Pi Browser" : "", f.release].filter(Boolean).join(" · "))}</div>
            <div class="bt-row bt-f"><select aria-label="الحالة" data-s>${d.statuses.map((s) => `<option value="${s.key}" ${s.key === f.status ? "selected" : ""}>${h(s.label)}</option>`).join("")}</select><select aria-label="الأولوية" data-p>${d.priorities.map((p) => `<option value="${p}" ${p === f.priority ? "selected" : ""}>${PRI[p]}</option>`).join("")}</select></div>
            <div class="bt-row bt-f"><input data-r placeholder="ردّ على المختبر (يصله إشعار)" aria-label="الرد"><button type="button" class="btn" data-save>حفظ</button><a class="btn ghost" href="#/beta/f/${enc(f.id)}">المحادثة</a></div></section>`).join("") : `<div class="empty">لا ملاحظات هنا</div>`);
        box.querySelectorAll("[data-f]").forEach((c) => c.querySelector("[data-save]").addEventListener("click", async () => {
          try { await api("PUT", "/api/admin/beta/feedback/" + enc(c.dataset.f), { status: c.querySelector("[data-s]").value, priority: c.querySelector("[data-p]").value, reply: c.querySelector("[data-r]").value.trim() || undefined }); say("حُفظ"); adminView("board"); } catch (e) { say(e.message); }
        }));
      } else if (tab === "dash") {
        const cs = await api("GET", "/api/admin/beta/cohorts"), cur = new URLSearchParams(location.hash.split("?")[1] || "").get("cohort") || "";
        const d = await api("GET", "/api/admin/beta/dashboard" + (cur ? "?cohort=" + enc(cur) : ""));
        const pct = (x) => (x === null || x === undefined ? "—" : x + "٪");
        box.innerHTML = `<div class="bt-chips"><a class="btn ghost" href="#/admin/beta/dash" aria-current="${!cur}">كل الموجات</a>${cs.items.map((c) => `<a class="btn ghost" href="#/admin/beta/dash?cohort=${enc(c.id)}" aria-current="${cur === c.id}">${h(c.name)}</a>`).join("")}</div>
          <div class="bt-kpi"><div><b>${d.members}</b>مختبر</div><div><b>${pct(d.activation.rate)}</b>التفعيل</div><div><b>${pct(d.retention.d1.rate)}</b>العودة D1 (${d.retention.d1.eligible})</div><div><b>${pct(d.retention.d7.rate)}</b>العودة D7 (${d.retention.d7.eligible})</div><div><b>${d.activeToday}</b>نشط اليوم</div><div><b>${d.errors.last7d}</b>أخطاء ٧ أيام</div><div><b>${d.surveys.nps ?? "—"}</b>NPS (${d.surveys.npsAnswers})</div><div><b>${d.surveys.csat ?? "—"}</b>الرضا /5 (${d.surveys.csatAnswers})</div></div>
          <p class="u-t-sm muted">${h(d.activation.rule)}</p>
          <h3 class="u-t-lg">أكثر الأخطاء تكراراً لدى المختبرين</h3>${d.errors.top.length ? `<table class="bt-t">${d.errors.top.map((e) => `<tr><td>${h(e.message)}</td><td>${e.count}×</td><td>${h(e.release || "")}</td></tr>`).join("")}</table>` : `<div class="empty">لا أخطاء مسجلة</div>`}
          <h3 class="u-t-lg">أداء الواجهة (p75، ٧ أيام)</h3><div class="muted">${Object.entries(d.webVitals).map(([k, v]) => `${k}: ${v.p75} (${v.n})`).join(" · ") || "لا قياسات بعد"}</div>
          <h3 class="u-t-lg">أهم الملاحظات المفتوحة</h3>${d.feedback.top.map((f) => `<a class="u-db u-ci u-tdn card bt-card" href="#/beta/f/${enc(f.id)}"><b>${KIND[f.kind]}</b> <span class="bt-st">${PRI[f.priority]}</span> ${h(f.text.slice(0, 140))}</a>`).join("") || `<div class="empty">لا شيء مفتوح</div>`}`;
      } else {
        const [d, cs] = await Promise.all([api("GET", "/api/admin/beta/flags"), api("GET", "/api/admin/beta/cohorts")]);
        box.innerHTML = `<p class="muted">«إيقاف طارئ» يطفئ الميزة للجميع فوراً. اختيار موجة يعطي مختبريها الميزة مبكراً حتى لو كانت مطفأة للبقية.</p>` + d.items.map((f) => `<section class="card bt-card" data-k="${h(f.key)}"><b dir="ltr">${h(f.key)}</b> <span class="muted">${h(f.description || "")}</span> <span class="bt-st">${f.killed ? "موقوفة: " + h(f.killReason || "") : f.enabled ? `مفعّلة ${f.rollout}٪` : "مطفأة"}</span>
          <div class="bt-row">${cs.items.map((c) => `<label class="u-dflex u-g4 u-aic"><input type="checkbox" data-c="${h(c.id)}" ${f.cohorts.includes(c.id) ? "checked" : ""}> ${h(c.name)}</label>`).join("")}<button type="button" class="btn ghost" data-sv>حفظ الموجات</button>
          <button type="button" class="btn" data-kill="${f.killed ? 0 : 1}" style="${f.killed ? "" : "background:var(--danger,#b91c1c)"}">${f.killed ? "إعادة التشغيل" : "إيقاف طارئ"}</button></div></section>`).join("");
        box.querySelectorAll("[data-k]").forEach((c) => {
          const key = c.dataset.k;
          c.querySelector("[data-sv]").addEventListener("click", async () => { try { await api("PUT", "/api/admin/beta/flags/" + enc(key), { cohorts: [...c.querySelectorAll("[data-c]:checked")].map((x) => x.dataset.c) }); say("حُفظ"); } catch (e) { say(e.message); } });
          c.querySelector("[data-kill]").addEventListener("click", async (e) => { const on = e.target.dataset.kill === "1"; const reason = on ? prompt("سبب الإيقاف الطارئ") : ""; if (on && !reason) return; try { await api("PUT", "/api/admin/beta/flags/" + enc(key), { killed: on, reason }); adminView("flags"); } catch (err) { say(err.message); } });
        });
      }
    } catch (e) { box.innerHTML = errBox(e); }
  }

  /* ---------- badge on profiles + settings entry ---------- */
  async function profileBadge() {
    const m = /^#\/u\/([A-Za-z0-9_]+)/.exec(location.hash); if (!m || !online()) return;
    try { const b = await api("GET", "/api/beta/badge/" + enc(m[1])); const h2 = view.querySelector(".profile-top h2"); if (b.badge && h2 && !h2.querySelector(".bt-badge")) h2.insertAdjacentHTML("beforeend", `<span class="bt-badge" title="${h(b.cohort || "")}">${window.UI ? UI.icon("flask", "sm") : ""}${h(window.UI ? UI.noEmo(b.label) : b.label)}</span>`); } catch { /* no badge */ }
  }
  const setCard = () => { if (/^#\/settings\/?(\?|$)/.test(location.hash) && !document.getElementById("bt-set") && online()) (view.querySelector(".wrap") || view).insertAdjacentHTML("beforeend", `<div class="card" id="bt-set"><h3 class="u-m0 u-mb8 u-t-lg"><svg class="ic hi" aria-hidden="true"><use href="#i-flask"/></svg>النسخة التجريبية والمساهمة</h3><div class="u-m0 bt-row"><a class="btn ghost" href="#/beta">النسخة التجريبية</a><a class="btn ghost" href="#/points">نقاط المساهمة</a><a class="btn ghost" href="#/leaderboard">لوحة الصدارة</a>${ME?.staff ? `<a class="btn ghost" href="#/admin/beta">إدارة التجربة</a><a class="btn ghost" href="#/admin/points">إدارة النقاط</a>` : ""}</div></div>`); };
  addEventListener("hashchange", () => setTimeout(() => { profileBadge(); setCard(); }, 300));

  MPRoutes.extend((a, b, prev) => {
    return { beta: () => (a === "f" && b ? threadView(b) : mineView()) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "beta" ? adminView((b || "").split("?")[0]) : next()));
  window.MPBeta = { feedbackSheet, surveySheet, mineView, threadView, adminView, deviceInfo, boot, me: () => ME, version: "2.27.0" };
  boot();
  setTimeout(() => { profileBadge(); setCard(); }, 300);
  if (/^#\/(beta|admin\/beta)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
