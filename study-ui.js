/* =====================================================================
 * مجتمع بلس — Phase 71 UI: study groups and halaqat (lazy "study" chunk; 0 bytes in core).
 *   #/study                         my groups + discover (mode filter, search)
 *   #/study/new                     create a study group or a halaqa (weekly schedule in your time zone)
 *   #/study/:id[/tab]               sessions · attendance · notes · goals · progress (halaqa) · settings
 *   #/study/:id/enable              turn an existing community into a study group (owner / admin)
 *   #/study/session/:sid            one session: start / join the live room (phase 13/14) / end
 * A study group is a community (phase 16): posts, members, rules and moderation stay on #/c/:id.
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function StudyUI() {
  if (window.MPStudy) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const num = (x, d = 0) => `<bdi dir="ltr">${Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: d })}</bdi>`;
  const pc = (x) => `<bdi dir="ltr">${Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}%</bdi>`;
  const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const when = (iso) => { try { return new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch { return iso; } };
  const localInput = (iso) => { const d = iso ? new Date(iso) : new Date(Date.now() + 3600e3); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
  const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh"; } catch { return "Asia/Riyadh"; } };
  const due = (iso) => { if (!iso) return "بلا موعد تسليم"; const ms = Date.parse(iso) - Date.now(), d = Math.round(ms / 864e5); return ms < 0 ? `انتهى الموعد ${when(iso)}` : d >= 1 ? `يُسلَّم خلال ${d} ${d === 1 ? "يوم" : d === 2 ? "يومين" : d <= 10 ? "أيام" : "يوماً"}` : `يُسلَّم اليوم ${when(iso)}`; };
  const SUBL = { submitted: ["sd-chip late", "بانتظار التصحيح"], reviewed: ["sd-chip present", "صُحّح"], returned: ["sd-chip absent", "أُعيد للتعديل"] };
  const subChip = (m) => (m ? `<span class="${SUBL[m.status][0]}">${SUBL[m.status][1]}${m.grade !== null && m.status === "reviewed" ? ` · ${num(m.grade)}` : ""}</span>` : `<span class="sd-chip">لم يُسلَّم</span>`);
  const ATT_LBL = { present: "حاضر", late: "متأخر", excused: "معتذر", absent: "غائب" };
  const schedText = (s) => (s ? `كل ${s.days.map((d) => DAYS[d]).join(" و")} الساعة <bdi dir="ltr">${h(s.time)}</bdi> (${h(s.tz)}) · ${s.durationMin} دقيقة` : "بلا جدول ثابت");
  const page = (title, body, back) => { view.innerHTML = `<div class="wrap sd-page"><header class="page-head">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${h(back[1])}</a>` : ""}<div class="ph-main"><div><h2 id="sd-h" tabindex="-1">${String(title).replaceAll("<svg class=ix", "<svg class=ic")}</h2></div></div></header>${body}</div>`; $("#sd-h")?.focus({ preventScroll: true }); };
  if (!document.getElementById("sd-css")) document.head.insertAdjacentHTML("beforeend", `<style id="sd-css">
.sd-page{max-width:820px;margin:auto}.sd-page h2:focus{outline:none}.sd-page h3{font-size:var(--fs-lg);font-weight:800;margin:22px 0 8px}.sd-top{margin:0 0 var(--s3)}.sd-ico{width:40px;height:40px;border-radius:var(--r-sm);display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-ink);flex:none}
.sd-row{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:10px 0}.sd-row .btn,.sd-row a.btn,.sd-row select,.sd-row input{min-height:44px}.sd-row label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted)}

.sd-card{padding:14px 16px;border-radius:var(--r);border:1px solid color-mix(in srgb,var(--line) 70%,transparent);margin:8px 0;background:var(--card);box-shadow:var(--sh-1)}.sd-live{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,var(--card))}.sd-note{padding:12px 14px;border-radius:var(--r-sm);background:var(--bg-2);color:var(--text-2);font-size:14px;line-height:1.7;margin:10px 0}
.sd-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}@media(min-width:620px){.sd-g{grid-template-columns:repeat(3,minmax(0,1fr))}}.sd-k{padding:12px 16px;border-radius:var(--r);background:var(--card);border:1px solid color-mix(in srgb,var(--line) 70%,transparent);box-shadow:var(--sh-1);min-width:0}.sd-k b{display:block;font-size:24px;font-weight:800;line-height:1.25}.sd-k span{font-size:12.5px;color:var(--muted)}
.sd-list{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}.sd-list:empty{display:none}.sd-list li{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);min-height:44px;flex-wrap:wrap}.sd-list li:last-child{border-bottom:0}.sd-list .grow{flex:1;min-width:0}.sd-list a{color:inherit}
.sd-chip{display:inline-block;font-size:var(--fs-xs);font-weight:600;padding:2px 10px;border-radius:999px;background:var(--bg-2);color:var(--text-2)}.sd-chip.present{background:color-mix(in srgb,var(--ok) 16%,transparent);color:color-mix(in srgb,var(--ok) 55%,var(--text))}.sd-chip.late{background:color-mix(in srgb,var(--warn) 18%,transparent);color:color-mix(in srgb,var(--warn) 55%,var(--text))}.sd-chip.excused{background:color-mix(in srgb,var(--info) 15%,transparent);color:color-mix(in srgb,var(--info) 60%,var(--text))}.sd-chip.absent{background:color-mix(in srgb,var(--danger) 14%,transparent);color:color-mix(in srgb,var(--danger) 65%,var(--text))}
.sd-bar{height:10px;border-radius:6px;background:var(--bg-2);overflow:hidden;margin:6px 0}.sd-bar i{display:block;height:100%;background:var(--accent);border-radius:6px}
.sd-f label{display:flex;flex-direction:column;gap:6px;margin:10px 0;font-size:14px;font-weight:600;color:var(--text-2)}.sd-f input,.sd-f select,.sd-f textarea{min-height:44px;width:100%;box-sizing:border-box;font-weight:400}.sd-days{display:flex;gap:6px;flex-wrap:wrap}.sd-days label{flex-direction:row;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-radius:999px;border:1px solid var(--line-2);background:var(--card);margin:0;font-weight:600}.sd-days label:has(input:checked){background:var(--accent2);border-color:var(--accent);color:var(--accent-ink)}
.sd-t{width:100%;border-collapse:collapse;font-size:14px}.sd-t th{font-size:12.5px;color:var(--muted);font-weight:600}.sd-t th,.sd-t td{padding:9px 6px;border-bottom:1px solid var(--line);text-align:start}.sd-t tr:last-child td{border-bottom:0}.sd-t .n{text-align:end;font-variant-numeric:tabular-nums}
#sd-s{display:flex;flex-direction:column}#sd-s>p:first-child{order:-2}#sd-s>.sd-row{order:-1}.sd-risk{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--danger) 14%,transparent);color:color-mix(in srgb,var(--danger) 65%,var(--text));margin:2px}.sd-ok{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ok) 16%,transparent);color:color-mix(in srgb,var(--ok) 55%,var(--text))}
.sd-cert{display:flex;gap:12px;align-items:center;padding:16px;border-radius:var(--r);border:1px solid var(--line);background:linear-gradient(135deg,color-mix(in srgb,var(--warn) 14%,var(--card)),color-mix(in srgb,var(--accent) 12%,var(--card)));margin:10px 0}.sd-cert .grow{flex:1;min-width:0}
.sd-agenda{counter-reset:ag;list-style:none;padding:0;margin:8px 0}.sd-agenda li{counter-increment:ag;display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px dashed var(--line-2);line-height:1.7}.sd-agenda li:last-child{border-bottom:0}.sd-agenda li::before{content:counter(ag);flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--accent2);color:var(--accent-ink);font-size:13px;font-weight:700}
.sd-sub{padding:12px 14px;border-radius:var(--r);background:var(--bg-2);margin:8px 0}.sd-sub p{margin:6px 0;white-space:pre-wrap;line-height:1.8}.sd-fb{border-inline-start:3px solid var(--accent);padding:8px 12px;margin:8px 0;background:var(--card);border-radius:var(--r-xs)}
.sd-chart{width:100%;height:auto;display:block}.sd-chart rect{fill:var(--accent)}.sd-chart text{font-size:11px;fill:var(--muted)}
.sd-seg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;width:100%}.sd-seg button{min-height:44px;min-width:44px;padding:0 6px;border-radius:999px;white-space:nowrap}@media(min-width:560px){.sd-seg{width:auto;display:flex}}.sd-seg button[aria-pressed="true"]{background:var(--accent2);border-color:var(--accent);color:var(--accent-ink);outline:0}
.sd-fig{margin:8px 0;padding:12px 14px 6px}.sd-fig .sd-chart{max-height:140px}.sd-st{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0 0;font-size:12.5px}.sd-st div{display:flex;gap:4px}.sd-st dt{color:var(--muted)}.sd-st dd{margin:0;font-weight:700;font-variant-numeric:tabular-nums}.sd-stu .btn{min-height:44px}

</style>`);

  /* ---------- #/study ---------- */
  async function listView() {
    const q = qs(), mine = q.get("mine") !== "0", mode = q.get("mode") || "", text = q.get("q") || "";
    page("مجموعات الدراسة والحلقات", `<div class="sd-row sd-top"><a class="btn sm" href="#/study/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>أنشئ مجموعة أو حلقة</a></div>
      <nav class="sd-tabs seg" aria-label="عرض"><a href="#/study" ${mine ? 'aria-current="page"' : ""}>مجموعاتي</a><a href="#/study?mine=0" ${!mine ? 'aria-current="page"' : ""}>اكتشف</a></nav>
      <form id="sd-lf" class="sd-row" role="search"><label>بحث<input name="q" type="search" enterkeyhint="search" value="${h(text)}" maxlength="60" placeholder="المادة أو الاسم"></label><label>النوع<select name="mode"><option value="">الكل</option><option value="group" ${mode === "group" ? "selected" : ""}>مجموعات دراسة</option><option value="halaqa" ${mode === "halaqa" ? "selected" : ""}>حلقات</option></select></label><button class="btn ghost">بحث</button></form>
      <div id="sd-l"><div class="skel"></div></div>`);
    { const F = $("#sd-lf"); if (F && window.MPFeat) MPFeat.filters({ host: F, form: F, move: [...F.querySelectorAll(":scope > label:not(:first-child), :scope > button")] }); }
    $("#sd-lf")?.addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target), p = new URLSearchParams(); if (!mine) p.set("mine", "0"); if (f.get("q")) p.set("q", f.get("q")); if (f.get("mode")) p.set("mode", f.get("mode")); location.hash = "#/study" + (p.toString() ? "?" + p : ""); });
    let d; try { d = await api("GET", `/api/study/groups?${mine ? "mine=1&" : ""}${mode ? "mode=" + enc(mode) + "&" : ""}${text ? "q=" + enc(text) : ""}`); } catch (e) { if (!$("#sd-l")) return; $("#sd-l").innerHTML = errBox(e); return; }
    if (!$("#sd-l")) return; $("#sd-l").innerHTML = d.groups.length ? `<ul class="sd-list">${d.groups.map((g) => `<li><span class="sd-ico" aria-hidden="true">${window.MPFeat ? MPFeat.ico(g.mode === "halaqa" ? "book" : "cap", "sm") : ""}</span><a class="grow" href="#/study/${enc(g.id)}"><b>${h(g.name)}</b> <span class="sd-chip">${h(g.modeLabel)}</span>${g.type !== "public" ? ` <svg class=ix aria-label="خاصة" role="img"><use href=#i-lock /></svg>` : ""}<span class="u-db u-t-sm muted">${h(g.subject || "")}${g.levelLabel ? " · " + h(g.levelLabel) : ""}${g.nextSession ? " · الجلسة القادمة: " + when(g.nextSession) : ""}</span></a>${g.mine ? "" : `<span class="u-t-sm muted">انضم من الصفحة</span>`}</li>`).join("")}</ul>`
      : `<div class="empty" role="status">${mine ? `<b>لم تنضم إلى مجموعة بعد</b>اكتشف المجموعات القائمة أو أنشئ واحدة لزملائك.<br><a class="btn" href="#/study?mine=0">اكتشف المجموعات</a>` : `<b>لا توجد مجموعات مطابقة</b>جرّب كلمة أخرى أو نوعاً مختلفاً.`}</div>`;
  }

  /* ---------- create / enable / settings form ---------- */
  function groupForm(g, { create, enable } = {}) {
    const s = g?.schedule || { days: [], time: "19:30", tz: myTz(), durationMin: 60 }, st = g?.settings || { remindMinutes: 60, lateAfterMin: 10 };
    return `<form id="sd-gf" class="sd-f">${create ? `<label>اسم المجموعة<input name="name" required minlength="3" maxlength="60"></label><label>نبذة<textarea name="desc" maxlength="300" rows="2"></textarea></label>
      <label>الخصوصية<select name="type"><option value="public">عامة — يراها الجميع</option><option value="private">خاصة — بموافقة المشرف</option></select></label>` : ""}
      <fieldset class="u-b0 u-p0"><legend class="u-t-md">النوع</legend><div class="sd-days"><label><input type="radio" name="mode" value="group" ${!g || g.mode === "group" ? "checked" : ""}> مجموعة دراسة</label><label><input type="radio" name="mode" value="halaqa" ${g?.mode === "halaqa" ? "checked" : ""}> حلقة (معلّم وطلاب وتتبع للحفظ)</label></div></fieldset>
      <label>المادة أو الموضوع<input name="subject" maxlength="80" value="${h(g?.subject || "")}" placeholder="مثل: جزء عمّ، الرياضيات، اللغة الإنجليزية"></label>
      <label>المستوى<select name="level">${[["all", "كل المستويات"], ["beginner", "مبتدئ"], ["intermediate", "متوسط"], ["advanced", "متقدم"]].map(([k, l]) => `<option value="${k}" ${g?.level === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <fieldset class="u-b0 u-p0"><legend class="u-t-md">الجدول الأسبوعي (اختياري)</legend><div class="sd-days">${DAYS.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${s.days.includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
        <div class="sd-row"><label>الوقت<input type="time" name="time" value="${h(s.time)}"></label><label>المدة (دقيقة)<input type="number" name="durationMin" min="15" max="300" value="${s.durationMin}"></label><label>المنطقة الزمنية<input name="tz" value="${h(s.tz)}" dir="ltr"></label></div></fieldset>
      <div class="sd-row"><label>التذكير قبل الجلسة (دقيقة)<input type="number" name="remindMinutes" min="5" max="1440" value="${st.remindMinutes}"></label><label>يُحسب متأخراً بعد (دقيقة)<input type="number" name="lateAfterMin" min="0" max="120" value="${st.lateAfterMin}"></label></div>
      ${create || enable ? "" : `<fieldset class="u-b0 u-p0"><legend class="u-t-md">معايير إتمام المجموعة (أساس الشهادة)</legend><div class="sd-row"><label>أقل نسبة حضور %<input type="number" name="completionAttendance" min="0" max="100" value="${st.completionAttendance ?? 75}"></label><label>أقل نسبة واجبات مسلّمة %<input type="number" name="completionAssignments" min="0" max="100" value="${st.completionAssignments ?? 70}"></label></div></fieldset>`}
      <button class="btn block">${create ? "إنشاء" : enable ? "تحويل إلى مجموعة دراسة" : "حفظ"}</button></form>`;
  }
  function readGroupForm(f) {
    const days = f.getAll("day").map(Number);
    return { mode: f.get("mode"), subject: f.get("subject")?.trim() || null, level: f.get("level"), remindMinutes: +f.get("remindMinutes"), lateAfterMin: +f.get("lateAfterMin"), ...(f.get("completionAttendance") !== null ? { completionAttendance: +f.get("completionAttendance"), completionAssignments: +f.get("completionAssignments") } : {}),
      schedule: days.length ? { days, time: f.get("time"), tz: f.get("tz").trim() || myTz(), durationMin: +f.get("durationMin") || 60 } : null };
  }
  function newView() {
    page("مجموعة دراسة أو حلقة جديدة", `<p class="muted">تُنشأ المجموعة كمجتمع كامل (منشورات وأعضاء وقواعد وإشراف)، وتُضاف إليها أدوات الدراسة.</p>${groupForm(null, { create: true })}`, ["#/study", "المجموعات"]);
    $("#sd-gf")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { const r = await api("POST", "/api/study/groups", { name: f.get("name").trim(), desc: f.get("desc").trim(), type: f.get("type"), ...readGroupForm(f) }); say("أُنشئت المجموعة"); location.hash = "#/study/" + enc(r.group.id); } catch (x) { say(x.message); } });
  }
  function enableView(cid) {
    page("تحويل المجتمع إلى مجموعة دراسة", `<p class="muted">يبقى المجتمع كما هو، وتُضاف إليه الجلسات والحضور والملاحظات والأهداف.</p>${groupForm(null, { enable: true })}`, ["#/c/" + enc(cid), "المجتمع"]);
    $("#sd-gf")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("POST", `/api/study/groups/${enc(cid)}/enable`, readGroupForm(f)); location.hash = "#/study/" + enc(cid); } catch (x) { say(x.message); } });
  }

  /* ---------- #/study/:id ---------- */
  async function groupView(cid, tab) {
    tab = tab || "sessions";
    page("", `<div id="sd-g"><div class="skel"></div><div class="skel"></div></div>`, ["#/study", "المجموعات"]);
    let d; try { d = await api("GET", "/api/study/groups/" + enc(cid)); } catch (e) { if (!$("#sd-g")) return; $("#sd-g").innerHTML = errBox(e); return; }
    const G = d.group, me = d.me, halaqa = G.mode === "halaqa";
    if ($("#sd-h")) $("#sd-h").textContent = `${halaqa ? "" : ""} ${G.name}`;
    const TABS = [["sessions", "الجلسات"], ...(me.member || me.admin ? [["assignments", "الواجبات"]] : []), ...(me.manager ? [["dashboard", "لوحة المعلّم"]] : []), ["attendance", "الحضور"], ["notes", "الملاحظات والموارد"], ["goals", "الأهداف"], ...(halaqa ? [["progress", "الحفظ والتسميع"]] : []), ...(me.admin ? [["settings", "الإعدادات"]] : [])];
    const S = me.stats;
    if (!$("#sd-g")) return; $("#sd-g").innerHTML = `<p><span class="sd-chip">${h(G.modeLabel)}</span> ${G.subject ? `<b>${h(G.subject)}</b>` : ""} ${G.levelLabel ? `· ${h(G.levelLabel)}` : ""} · ${num(G.members)} عضو</p>
      <p class="u-t-md muted">${schedText(G.schedule)}${G.teachers.length ? ` · ${halaqa ? "المعلّم" : "الميسّر"}: ${G.teachers.map((t) => h(t.name)).join("، ")}` : ""}</p>
      <div class="sd-row"><a class="btn ghost" href="#/c/${enc(cid)}">صفحة المجتمع والمنشورات</a><a class="btn ghost" href="#/courses?group=${enc(cid)}"><svg class=ix aria-hidden=true><use href=#i-cap /></svg> الدورات</a><a class="btn ghost" href="#/exams?group=${enc(cid)}"><svg class=ix aria-hidden=true><use href=#i-doc /></svg> الاختبارات</a>${!me.member ? `<button type="button" class="btn" id="sd-join">انضم إلى المجموعة</button>` : ""}</div>
      ${d.live ? `<div class="sd-card sd-live" role="status"><b>جلسة مباشرة الآن: ${h(d.live.title)}</b><div class="sd-row">${me.member ? `<a class="btn" href="#/study/session/${enc(d.live.id)}">انضم الآن</a>` : ""}</div></div>` : ""}
      ${S && !me.teacher ? `<div class="sd-g"><div class="sd-k"><b>${S.rate === null ? "—" : pc(S.rate)}</b><span>نسبة حضورك</span></div><div class="sd-k"><b><svg class=ix aria-hidden=true><use href=#i-fire /></svg> ${num(S.streak)}</b><span>جلسات متتالية</span></div><div class="sd-k"><b>${num(S.longestStreak)}</b><span>أطول سلسلة</span></div>${halaqa ? `<div class="sd-k"><b>${num(S.recitationDays)}</b><span>أيام تسميع متتالية</span></div>` : ""}</div>` : ""}
      <div id="sd-cmp"></div><nav class="sd-tabs seg" aria-label="أقسام المجموعة">${TABS.map(([k, l]) => `<a href="#/study/${enc(cid)}/${k}" ${k === tab ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav><div id="sd-b" aria-live="polite"><div class="skel"></div></div>`;
    $("#sd-join")?.addEventListener("click", async () => { try { const r = await api("PUT", `/api/communities/${enc(cid)}/membership`); say(r.role === "pending" ? "أُرسل طلب الانضمام" : "انضممت إلى المجموعة"); groupView(cid, tab); } catch (x) { say(x.message); } });
    if (me.member && !me.teacher) completionCard(cid);
    const T = { sessions: sessionsTab, assignments: assignmentsTab, dashboard: dashboardTab, attendance: attendanceTab, notes: notesTab, goals: goalsTab, progress: progressTab, settings: settingsTab }[(tab || "").split("?")[0]] || sessionsTab;
    try { await T(cid, d); } catch (e) { if (!$("#sd-b")) return; $("#sd-b").innerHTML = errBox(e); }
  }

  async function sessionsTab(cid, d) {
    const me = d.me;
    const [up, past] = await Promise.all([api("GET", `/api/study/groups/${enc(cid)}/sessions`), api("GET", `/api/study/groups/${enc(cid)}/sessions?range=past`)]);
    const row = (s) => `<li><span class="grow"><a href="#/study/session/${enc(s.id)}"><b>${h(s.title)}</b></a><span class="u-db u-t-sm muted">${when(s.startsAt)} · ${s.durationMin} دقيقة${s.status === "live" ? " · مباشرة" : s.status === "cancelled" ? " · ملغاة" : ""}</span></span>
      ${s.myAttendance ? `<span class="sd-chip ${s.myAttendance}">${ATT_LBL[s.myAttendance]}</span>` : ""}${me.manager && s.status === "scheduled" ? `<button type="button" class="btn ghost" data-start="${h(s.id)}">ابدأ</button><button type="button" class="btn ghost" data-cancel="${h(s.id)}">إلغاء</button>` : ""}</li>`;
    if (!$("#sd-b")) return; $("#sd-b").innerHTML = `${me.manager ? `<details class="sd-card"><summary class="u-mh44 u-dflex u-aic u-cp"><b><svg class=ix aria-hidden=true><use href=#i-plus /></svg> جلسة إضافية</b></summary><form id="sd-sf" class="sd-f"><label>العنوان<input name="title" required minlength="2" maxlength="100"></label><label>الموعد<input type="datetime-local" name="at" required value="${localInput()}"></label><label>المدة (دقيقة)<input type="number" name="durationMin" min="15" max="300" value="${d.group.schedule?.durationMin || 60}"></label><label>المحاور (اختياري)<textarea name="agenda" maxlength="1000" rows="2"></textarea></label><button class="btn">إضافة</button></form></details>` : ""}
      <h3>القادمة</h3>${up.sessions.length ? `<ul class="sd-list">${up.sessions.map(row).join("")}</ul>` : `<div class="empty">لا جلسات قادمة${me.manager ? " — أضف جدولاً من الإعدادات أو جلسة إضافية" : ""}.</div>`}
      <h3>السابقة</h3>${past.sessions.length ? `<ul class="sd-list">${past.sessions.slice(0, 20).map(row).join("")}</ul>` : `<p class="muted">لا جلسات سابقة بعد.</p>`}`;
    $("#sd-sf")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("POST", `/api/study/groups/${enc(cid)}/sessions`, { title: f.get("title").trim(), startsAt: new Date(f.get("at")).toISOString(), durationMin: +f.get("durationMin"), agenda: f.get("agenda").trim() }); say("أُضيفت الجلسة"); groupView(cid, "sessions"); } catch (x) { say(x.message); } });
    view.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => startSheet(b.dataset.start)));
    view.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("إلغاء هذه الجلسة؟")) return; try { await api("DELETE", "/api/study/sessions/" + enc(b.dataset.cancel)); groupView(cid, "sessions"); } catch (x) { say(x.message); } }));
  }
  function startSheet(sid) {
    sheet(`<h4 class="u-mt0">بدء الجلسة</h4><p class="muted">تُفتح غرفة صوتية مباشرة لأعضاء المجموعة فقط، أو سجّل الحضور يدوياً لجلسة حضورية.</p><div class="sd-row"><button type="button" class="btn" id="sd-st-r"><svg class=ix aria-hidden=true><use href=#i-mic /></svg> غرفة مباشرة</button><button type="button" class="btn ghost" id="sd-st-p"><svg class=ix aria-hidden=true><use href=#i-cap /></svg> جلسة حضورية</button></div>`);
    const go = async (room) => { try { const r = await api("POST", `/api/study/sessions/${enc(sid)}/start`, { room }); closeSheet(); say("بدأت الجلسة"); location.hash = r.session.roomId ? "#/room/" + enc(r.session.roomId) : "#/study/session/" + enc(sid); } catch (x) { say(x.message); } };
    document.getElementById("sd-st-r").addEventListener("click", () => go(true)); document.getElementById("sd-st-p").addEventListener("click", () => go(false));
  }

  async function attendanceTab(cid, d) {
    if (!d.me.manager) { const S = d.me.stats; if (!$("#sd-b")) return; $("#sd-b").innerHTML = S ? `<div class="sd-note">حضرت ${num(S.attended)} من ${num(S.sessions)} جلسة. الاعتذار لا يقطع سلسلتك ولا يُحسب غياباً.</div>` : `<div class="empty">انضم إلى المجموعة لتتبّع حضورك.</div>`; return; }
    const [g, past] = await Promise.all([api("GET", `/api/study/groups/${enc(cid)}/attendance`), api("GET", `/api/study/groups/${enc(cid)}/sessions?range=past`)]);
    const live = d.live ? [d.live] : [], sel = qs().get("session") || live[0]?.id || past.sessions.find((s) => s.status !== "cancelled")?.id || "";
    if (!$("#sd-b")) return; $("#sd-b").innerHTML = `<div class="sd-row"><label>الجلسة<select id="sd-as">${[...live, ...past.sessions.filter((s) => s.status !== "cancelled")].map((s) => `<option value="${h(s.id)}" ${s.id === sel ? "selected" : ""}>${h(s.title)} — ${when(s.startsAt)}</option>`).join("")}</select></label><a class="btn ghost" download href="/api/study/groups/${enc(cid)}/attendance.csv">CSV</a></div><div id="sd-am"></div>
      <h3>ملخص الأعضاء (${num(g.sessionsEnded)} جلسة منتهية)</h3><div style="overflow-x:auto" tabindex="0" role="region" aria-label="ملخص الحضور"><table class="sd-t"><thead><tr><th scope="col">العضو</th><th scope="col" class="n">الحضور</th><th scope="col" class="n">السلسلة</th><th scope="col" class="n">الأطول</th></tr></thead><tbody>${g.members.map((m) => `<tr><td>${h(m.name)} <bdi dir="ltr" class="muted">@${h(m.handle)}</bdi></td><td class="n">${m.rate === null || m.rate === undefined ? "—" : pc(m.rate)}</td><td class="n"><svg class=ix aria-hidden=true><use href=#i-fire /></svg> ${num(m.streak)}</td><td class="n">${num(m.longestStreak)}</td></tr>`).join("")}</tbody></table></div>`;
    const load = async (sid) => {
      if (!sid) { if (!$("#sd-am")) return; $("#sd-am").innerHTML = `<p class="muted">لا جلسات بعد.</p>`; return; }
      const a = await api("GET", `/api/study/sessions/${enc(sid)}/attendance`);
      if (!$("#sd-am")) return; $("#sd-am").innerHTML = `<p class="u-t-sm muted">${Object.entries(a.counts).map(([k, v]) => `${ATT_LBL[k]}: ${v}`).join(" · ")}</p><ul class="sd-list">${a.members.map((m) => `<li><span class="grow">${h(m.name)}${m.minutes ? ` <span class="u-t-xs muted">(${m.minutes} د)</span>` : ""}</span><span class="sd-seg" role="group" aria-label="حضور ${h(m.name)}">${Object.entries(ATT_LBL).map(([k, l]) => `<button type="button" class="btn ghost" data-mk="${k}" data-u="${h(m.id)}" aria-pressed="${m.status === k}">${l}</button>`).join("")}</span></li>`).join("")}</ul>`;
      $("#sd-am")?.querySelectorAll("[data-mk]").forEach((b) => b.addEventListener("click", async () => { try { await api("PUT", `/api/study/sessions/${enc(sid)}/attendance/${enc(b.dataset.u)}`, { status: b.dataset.mk }); b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); } catch (x) { say(x.message); } }));
    };
    $("#sd-as")?.addEventListener("change", (e) => load(e.target.value));
    await load(sel);
  }

  async function notesTab(cid, d) {
    if (!d.me.member && !d.me.admin) { if (!$("#sd-b")) return; $("#sd-b").innerHTML = `<div class="empty">الملاحظات لأعضاء المجموعة. انضم أولاً.</div>`; return; }
    const r = await api("GET", `/api/study/groups/${enc(cid)}/notes`);
    if (!$("#sd-b")) return; $("#sd-b").innerHTML = `<details class="sd-card"><summary class="u-mh44 u-dflex u-aic u-cp"><b><svg class=ix aria-hidden=true><use href=#i-plus /></svg> ملاحظة أو رابط</b></summary><form id="sd-nf" class="sd-f"><div class="sd-days"><label><input type="radio" name="kind" value="note" checked> ملاحظة</label><label><input type="radio" name="kind" value="link"> رابط مورد</label></div>
      <label>العنوان<input name="title" required minlength="2" maxlength="120"></label><label>النص<textarea name="body" maxlength="5000" rows="4"></textarea></label><label>الرابط (https)<input name="url" type="url" dir="ltr" maxlength="500" placeholder="https://"></label><button class="btn">إضافة</button></form></details>
      ${r.notes.length ? r.notes.map((n) => `<div class="sd-card"><b>${n.pinned ? "" : ""}${n.kind === "link" ? "" : ""}${h(n.title)}</b><div class="u-t-xs muted">${h(n.author.name)} · ${when(n.createdAt)}</div>${n.body ? `<p class="u-pre u-my6">${h(n.body)}</p>` : ""}${n.url ? `<a href="${h(n.url)}" target="_blank" rel="noopener nofollow ugc" dir="ltr">${h(n.url.replace(/^https:\/\//, ""))}</a>` : ""}
        <div class="sd-row">${d.me.manager ? `<button type="button" class="btn ghost" data-pin="${h(n.id)}" data-on="${n.pinned ? "0" : "1"}">${n.pinned ? "إلغاء التثبيت" : "تثبيت"}</button>` : ""}${n.canEdit ? `<button type="button" class="btn ghost" data-del="${h(n.id)}">حذف</button>` : ""}</div></div>`).join("") : `<div class="empty">لا ملاحظات بعد. شارك ملخصاً أو مورداً مفيداً.</div>`}`;
    $("#sd-nf")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("POST", `/api/study/groups/${enc(cid)}/notes`, { kind: f.get("kind"), title: f.get("title").trim(), body: f.get("body").trim(), url: f.get("url").trim() || null }); groupView(cid, "notes"); } catch (x) { say(x.message); } });
    view.querySelectorAll("[data-pin]").forEach((b) => b.addEventListener("click", async () => { try { await api("POST", `/api/study/notes/${enc(b.dataset.pin)}/pin`, { pinned: b.dataset.on === "1" }); groupView(cid, "notes"); } catch (x) { say(x.message); } }));
    view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("حذف الملاحظة؟")) return; try { await api("DELETE", `/api/study/notes/${enc(b.dataset.del)}`); groupView(cid, "notes"); } catch (x) { say(x.message); } }));
  }

  async function goalsTab(cid, d) {
    if (!d.me.member && !d.me.admin) { if (!$("#sd-b")) return; $("#sd-b").innerHTML = `<div class="empty">الأهداف لأعضاء المجموعة.</div>`; return; }
    const r = await api("GET", `/api/study/groups/${enc(cid)}/goals`);
    const goal = (g, can) => `<div class="sd-card"><b>${g.done ? "" : ""}${h(g.title)}</b> <span class="muted">${num(g.progress)} / ${num(g.target)} ${h(g.unit)}</span><div class="sd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${g.percent}" aria-label="${h(g.title)}"><i style="width:${g.percent}%"></i></div>
      ${can ? `<div class="sd-row"><button type="button" class="btn ghost" data-gp="${h(g.id)}" data-add="1">+1</button><button type="button" class="btn ghost" data-gp="${h(g.id)}" data-add="-1">−1</button><button type="button" class="btn ghost" data-gd="${h(g.id)}">حذف</button></div>` : ""}</div>`;
    if (!$("#sd-b")) return; $("#sd-b").innerHTML = `<h3>أهداف المجموعة</h3>${r.group.length ? r.group.map((g) => goal(g, r.canManage)).join("") : `<p class="muted">لا أهداف للمجموعة بعد.</p>`}
      <h3>أهدافي (خاصة بي)</h3>${r.mine.length ? r.mine.map((g) => goal(g, true)).join("") : `<p class="muted">أضف هدفاً شخصياً تتابعه بنفسك.</p>`}
      <form id="sd-gl" class="sd-f sd-card"><b><svg class=ix aria-hidden=true><use href=#i-plus /></svg> هدف جديد</b><label>الهدف<input name="title" required minlength="2" maxlength="120" placeholder="مثل: حفظ ٣ سور هذا الشهر"></label><div class="sd-row"><label>الرقم المستهدف<input type="number" name="target" min="1" required value="10"></label><label>الوحدة<input name="unit" maxlength="30" placeholder="سورة، صفحة، درس"></label></div>
        ${r.canManage ? `<label class="chk" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" name="group"> هدف للمجموعة كلها</label>` : ""}<button class="btn">إضافة</button></form>`;
    $("#sd-gl")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("POST", `/api/study/groups/${enc(cid)}/goals`, { title: f.get("title").trim(), target: +f.get("target"), unit: f.get("unit").trim(), personal: !f.get("group") }); groupView(cid, "goals"); } catch (x) { say(x.message); } });
    view.querySelectorAll("[data-gp]").forEach((b) => b.addEventListener("click", async () => { try { await api("POST", `/api/study/goals/${enc(b.dataset.gp)}/progress`, { add: +b.dataset.add }); groupView(cid, "goals"); } catch (x) { say(x.message); } }));
    view.querySelectorAll("[data-gd]").forEach((b) => b.addEventListener("click", async () => { try { await api("DELETE", `/api/study/goals/${enc(b.dataset.gd)}`); groupView(cid, "goals"); } catch (x) { say(x.message); } }));
  }

  let SURAHS = null;
  async function progressTab(cid, d) {
    if (!d.me.member && !d.me.admin) { if (!$("#sd-b")) return; $("#sd-b").innerHTML = `<div class="empty">سجل الحفظ لأعضاء الحلقة.</div>`; return; }
    SURAHS ||= (await api("GET", "/api/study/quran/surahs")).surahs;
    const student = qs().get("student") || "";
    let roster = null; if (d.me.manager) roster = (await api("GET", `/api/study/groups/${enc(cid)}/students`)).students;
    const p = await api("GET", `/api/study/groups/${enc(cid)}/progress${student ? "?student=" + enc(student) : ""}`);
    const M = p.memorised, surahOpts = SURAHS.map((s) => `<option value="${s.n}">${s.n}. ${h(s.name)} (${s.ayahs})</option>`).join("");
    if (!$("#sd-b")) return; $("#sd-b").innerHTML = `${roster ? `<div class="sd-row"><label>الطالب<select id="sd-ps"><option value="">سجلي أنا</option>${roster.map((s) => `<option value="${h(s.id)}" ${s.id === student ? "selected" : ""}>${h(s.name)} — ${num(s.memorisedAyahs)} آية</option>`).join("")}</select></label></div>` : `<p class="u-t-sm muted">سجلك يراه معلّمك ومشرفو الحلقة فقط.</p>`}
      <h3>${p.student ? h(p.student.name) : ""}</h3>
      <div class="sd-g"><div class="sd-k"><b>${num(M.ayahs)}</b><span>آية محفوظة</span></div><div class="sd-k"><b>${num(M.percent, 1)}%</b><span>من القرآن (${num(p.total)} آية)</span></div><div class="sd-k"><b>${num(M.completeSurahs)}</b><span>سورة كاملة</span></div><div class="sd-k"><b><svg class=ix aria-hidden=true><use href=#i-fire /></svg> ${num(p.recitationDays)}</b><span>أيام تسميع متتالية</span></div></div>
      <div class="sd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${M.percent}" aria-label="نسبة الحفظ"><i style="width:${Math.min(100, M.percent)}%"></i></div>
      ${p.canLog && student ? `<form id="sd-pl" class="sd-f sd-card"><b>تسجيل تسميع</b><label>النوع<select name="kind"><option value="memorisation">حفظ جديد</option><option value="recitation">تسميع</option><option value="review">مراجعة</option></select></label><label>السورة<select name="surah" required>${surahOpts}</select></label>
        <div class="sd-row"><label>من آية<input type="number" name="fromAyah" min="1" value="1"></label><label>إلى آية<input type="number" name="toAyah" min="1" placeholder="آخر السورة"></label></div>
        <label>التقدير<select name="grade"><option value="">—</option><option value="excellent">ممتاز</option><option value="very_good">جيد جداً</option><option value="good">جيد</option><option value="needs_work">يحتاج إعادة</option></select></label><label>ملاحظة للطالب<input name="note" maxlength="500"></label><button class="btn">حفظ</button></form>` : p.canLog ? `<p class="muted">اختر طالباً لتسجيل تسميعه.</p>` : ""}
      ${M.bySurah.length ? `<h3>السور</h3><ul class="sd-list">${M.bySurah.map((s) => `<li><span class="grow">${h(s.name)}</span><span class="muted">${num(s.covered)} / ${num(s.ayahs)}</span>${s.covered === s.ayahs ? "" : ""}</li>`).join("")}</ul>` : ""}
      <h3>آخر التسجيلات</h3>${p.entries.length ? `<ul class="sd-list">${p.entries.map((e) => `<li><span class="grow"><b>${h(e.kindLabel)}: ${h(e.surahName)}</b> <bdi dir="ltr">${e.fromAyah}–${e.toAyah}</bdi>${e.gradeLabel ? ` <span class="sd-chip">${h(e.gradeLabel)}</span>` : ""}<span class="u-db u-t-xs muted">${when(e.at)}${e.teacherName ? " · " + h(e.teacherName) : ""}${e.note ? " · " + h(e.note) : ""}</span></span>${p.canLog ? `<button type="button" class="btn ghost" data-pd="${h(e.id)}" aria-label="حذف التسجيل">حذف</button>` : ""}</li>`).join("")}</ul>` : `<p class="muted">لا تسجيلات بعد.</p>`}`;
    $("#sd-ps")?.addEventListener("change", (e) => { location.hash = `#/study/${enc(cid)}/progress${e.target.value ? "?student=" + enc(e.target.value) : ""}`; });
    $("#sd-pl")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("POST", `/api/study/groups/${enc(cid)}/progress`, { studentId: student, kind: f.get("kind"), surah: +f.get("surah"), fromAyah: f.get("fromAyah") || null, toAyah: f.get("toAyah") || null, grade: f.get("grade") || null, note: f.get("note").trim() || null }); say("سُجّل"); groupView(cid, "progress"); } catch (x) { say(x.message); } });
    view.querySelectorAll("[data-pd]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("حذف هذا التسجيل؟")) return; try { await api("DELETE", `/api/study/progress/${enc(b.dataset.pd)}`); groupView(cid, "progress"); } catch (x) { say(x.message); } }));
  }

  async function settingsTab(cid, d) {
    if (!d.me.admin) { if (!$("#sd-b")) return; $("#sd-b").innerHTML = `<div class="empty">للمشرفين فقط.</div>`; return; }
    const g = await api("GET", `/api/study/groups/${enc(cid)}/attendance`);
    if (!$("#sd-b")) return; $("#sd-b").innerHTML = `${groupForm(d.group)}<h3>${d.group.mode === "halaqa" ? "المعلّمون" : "الميسّرون"}</h3><form id="sd-tf" class="sd-f"><div class="sd-days">${g.members.map((m) => `<label><input type="checkbox" name="t" value="${h(m.id)}" ${d.group.teachers.some((t) => t.id === m.id) ? "checked" : ""}> ${h(m.name)}</label>`).join("")}</div><p class="u-t-sm muted">لا يمكن تعيين حساب قاصر معلّماً.</p><button class="btn ghost">حفظ</button></form>`;
    $("#sd-gf")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("PATCH", "/api/study/groups/" + enc(cid), readGroupForm(new FormData(e.target))); say("حُفظ"); groupView(cid, "settings"); } catch (x) { say(x.message); } });
    $("#sd-tf")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("PATCH", "/api/study/groups/" + enc(cid), { teachers: new FormData(e.target).getAll("t") }); say("حُفظ"); groupView(cid, "settings"); } catch (x) { say(x.message); } });
  }

  /* ---------- completion (the certificate hook for phase 73) ---------- */
  async function completionCard(cid) {
    let c; try { c = await api("GET", `/api/study/groups/${enc(cid)}/completion`); } catch { return; }
    const box = $("#sd-cmp"); if (!box) return;
    const bar = (v, min) => `<div class="sd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v ?? 0}"><i style="width:${Math.min(100, v ?? 0)}%"></i></div><span class="u-t-xs muted">${v === null ? "—" : pc(v)} من ${num(min)}% مطلوبة</span>`;
    box.innerHTML = c.completed ? `<div class="sd-cert" role="status"><div class="grow"><b>أتممت هذه المجموعة</b><div class="u-t-sm muted">سجّل معلّمك إتمامك ${c.issuedAt ? when(c.issuedAt) : ""}${c.note ? " — " + h(c.note) : ""}. ستتحول إلى شهادة قابلة للتحقق قريباً.</div></div></div>`
      : `<details class="sd-card"><summary class="u-mh44 u-dflex u-aic u-g8 u-cp"><span aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-target /></svg></span><b>طريقك إلى إتمام المجموعة</b>${c.eligible ? `<span class="sd-ok">مستوفٍ للمعايير</span>` : ""}</summary>
        <p class="u-t-sm u-my4 muted">حين تستوفي المعايير يستطيع معلّمك تسجيل إتمامك، وهو أساس شهادة الإتمام.</p>
        <b class="u-t-md">الحضور</b>${bar(c.attendance, c.criteria.minAttendance)}${c.assignmentsTotal ? `<div class="u-mt8"><b class="u-t-md">الواجبات (${num(c.assignmentsDone)} من ${num(c.assignmentsTotal)})</b>${bar(c.assignmentsPct, c.criteria.minAssignments)}</div>` : ""}</details>`;
  }

  /* ---------- assignments ---------- */
  async function assignmentsTab(cid, d) {
    const r = await api("GET", `/api/study/groups/${enc(cid)}/assignments`);
    const open = r.assignments.filter((a) => a.status === "open"), closed = r.assignments.filter((a) => a.status !== "open");
    const row = (a) => `<li><span class="grow"><a href="#/study/assignment/${enc(a.id)}"><b>${h(a.title)}</b></a><span class="u-db u-t-sm muted">${due(a.dueAt)} · ${num(a.points)} درجة${a.status === "closed" ? " · مغلق" : ""}</span></span>${r.canCreate ? `<span class="sd-chip">${num(a.submissions)} تسليم</span>${a.toReview ? `<span class="sd-chip late">${num(a.toReview)} للتصحيح</span>` : ""}` : subChip(a.mine)}</li>`;
    if (!$("#sd-b")) return; $("#sd-b").innerHTML = `${r.canCreate ? `<details class="sd-card" ${r.assignments.length ? "" : "open"}><summary class="u-mh44 u-dflex u-aic u-cp"><b><svg class=ix aria-hidden=true><use href=#i-plus /></svg> واجب جديد</b></summary>${asgForm(d)}</details>` : ""}
      ${open.length ? `<h3>المفتوحة</h3><ul class="sd-list">${open.map(row).join("")}</ul>` : `<div class="empty"><div class="u-t-num" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-doc /></svg></div>${r.canCreate ? "لا واجبات بعد. أضف واجباً قصيراً بعد كل جلسة ليثبت ما تعلّمه الطلاب." : "لا واجبات مفتوحة الآن."}</div>`}
      ${closed.length ? `<h3>المغلقة</h3><ul class="sd-list">${closed.map(row).join("")}</ul>` : ""}`;
    wireAsgForm(cid, () => groupView(cid, "assignments"));
  }
  const asgForm = (d, sid) => `<form id="sd-af" class="sd-f"><label>العنوان<input name="title" required minlength="2" maxlength="120" placeholder="${d.group.mode === "halaqa" ? "مثال: مراجعة سورة النبأ" : "مثال: حل تمارين الفصل الثاني"}"></label><label>التعليمات<textarea name="body" rows="4" maxlength="4000" placeholder="ماذا يفعل الطالب؟ وكيف يسلّم؟"></textarea></label>
    <div class="sd-row"><label>موعد التسليم<input type="datetime-local" name="due" value="${localInput(new Date(Date.now() + 3 * 864e5).toISOString())}"></label><label>الدرجة<input type="number" name="points" min="1" max="1000" value="10" style="width:100px"></label></div>${sid ? `<input type="hidden" name="sid" value="${h(sid)}">` : ""}<button class="btn">نشر الواجب وإشعار الأعضاء</button></form>`;
  function wireAsgForm(cid, done) {
    $("#sd-af")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("POST", `/api/study/groups/${enc(cid)}/assignments`, { title: f.get("title").trim(), body: f.get("body").trim(), dueAt: f.get("due") ? new Date(f.get("due")).toISOString() : undefined, points: +f.get("points") || 10, sessionId: f.get("sid") || undefined }); say("نُشر الواجب"); done(); } catch (x) { say(x.message); } });
  }
  async function assignmentView(aid) {
    page("الواجب", `<div id="sd-as"><div class="skel"></div></div>`, ["#/study", "المجموعات"]);
    let d; try { d = await api("GET", "/api/study/assignments/" + enc(aid)); } catch (e) { if (!$("#sd-as")) return; $("#sd-as").innerHTML = errBox(e); return; }
    const A = d.assignment, M = d.mine; if ($("#sd-h")) $("#sd-h").textContent = "" + A.title;
    const back = view.querySelector(".sd-page > a"); if (back) { back.setAttribute("href", `#/study/${enc(d.group.id)}/assignments`); back.textContent = "→ " + d.group.name; }
    const sub = (x, review) => `<div class="sd-sub">${review ? `<b>${h(x.name)}</b> <span class="muted">@<bdi dir="ltr">${h(x.handle || "")}</bdi></span> ` : ""}${subChip(x)} <span class="u-t-xs muted">${when(x.submittedAt)}</span>${x.body ? `<p>${h(x.body)}</p>` : ""}${x.url ? `<a href="${h(x.url)}" target="_blank" rel="noopener nofollow ugc" dir="ltr">${h(x.url.replace(/^https:\/\//, ""))}</a>` : ""}${x.feedback ? `<div class="sd-fb"><b>ملاحظة المعلّم:</b> ${h(x.feedback)}</div>` : ""}
      ${review ? `<form class="sd-row" data-rv="${h(x.userId)}"><label>الدرجة / ${num(A.points)}<input type="number" name="grade" min="0" max="${A.points}" value="${x.grade ?? ""}" style="width:90px"></label><label style="flex:1;min-width:180px">ملاحظة<input name="feedback" maxlength="2000" value="${h(x.feedback || "")}"></label><button class="btn">حفظ التصحيح</button><button type="button" class="btn ghost" data-ret="${h(x.userId)}">إعادة للتعديل</button></form>` : ""}</div>`;
    if (!$("#sd-as")) return; $("#sd-as").innerHTML = `<p><span class="sd-chip ${A.overdue ? "absent" : ""}">${due(A.dueAt)}</span> <span class="sd-chip">${num(A.points)} درجة</span>${A.status !== "open" ? ` <span class="sd-chip">مغلق</span>` : ""}${A.sessionId ? ` <a href="#/study/session/${enc(A.sessionId)}">الجلسة المرتبطة</a>` : ""}</p>${A.body ? `<div class="u-pre u-lh18 sd-card">${h(A.body)}</div>` : ""}
      ${d.canReview ? `<div class="sd-row"><button type="button" class="btn ghost" id="sd-atog">${A.status === "open" ? "إغلاق التسليم" : "إعادة فتح التسليم"}</button><button type="button" class="btn ghost" id="sd-adel">حذف الواجب</button></div>
        <h3>التسليمات (${num(d.roster.submissions.length)})</h3>${d.roster.submissions.length ? d.roster.submissions.map((x) => sub(x, true)).join("") : `<p class="muted">لم يسلّم أحد بعد.</p>`}
        ${d.roster.missing.length ? `<h3>لم يسلّموا (${num(d.roster.missing.length)})</h3><ul class="sd-list">${d.roster.missing.map((m) => `<li>${h(m.name)} <span class="muted">@<bdi dir="ltr">${h(m.handle || "")}</bdi></span></li>`).join("")}</ul>` : ""}`
      : `<h3>إجابتي</h3>${M ? sub(M) : ""}${A.status === "open" && (!M || M.status !== "reviewed") ? `<form id="sd-sub" class="sd-f"><label>${M ? "تعديل الإجابة" : "إجابتك"}<textarea name="body" rows="5" maxlength="8000">${h(M?.body || "")}</textarea></label><label>رابط (اختياري، https)<input name="url" type="url" dir="ltr" maxlength="400" value="${h(M?.url || "")}" placeholder="https://"></label><button class="btn">${M ? "إعادة التسليم" : "تسليم"}</button></form>` : ""}`}`;
    $("#sd-sub")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("POST", `/api/study/assignments/${enc(aid)}/submit`, { body: f.get("body").trim() || undefined, url: f.get("url").trim() || undefined }); say("سُلّم الواجب ✓"); assignmentView(aid); } catch (x) { say(x.message); } });
    view.querySelectorAll("[data-rv]").forEach((fm) => fm.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(fm); try { await api("POST", `/api/study/assignments/${enc(aid)}/review/${enc(fm.dataset.rv)}`, { grade: +f.get("grade"), feedback: f.get("feedback").trim() }); say("حُفظ التصحيح وأُشعر الطالب"); assignmentView(aid); } catch (x) { say(x.message); } }));
    view.querySelectorAll("[data-ret]").forEach((b) => b.addEventListener("click", async () => { const fb = b.closest("form").querySelector("[name=feedback]").value.trim(); try { await api("POST", `/api/study/assignments/${enc(aid)}/review/${enc(b.dataset.ret)}`, { action: "return", feedback: fb }); say("أُعيد للطالب للتعديل"); assignmentView(aid); } catch (x) { say(x.message); } }));
    $("#sd-atog")?.addEventListener("click", async () => { try { await api("POST", `/api/study/assignments/${enc(aid)}/toggle`); assignmentView(aid); } catch (x) { say(x.message); } });
    $("#sd-adel")?.addEventListener("click", async () => { if (!confirm("حذف الواجب وكل تسليماته من القائمة؟")) return; try { await api("DELETE", "/api/study/assignments/" + enc(aid)); location.hash = `#/study/${enc(d.group.id)}/assignments`; } catch (x) { say(x.message); } });
  }

  /* ---------- teacher dashboard ---------- */
  async function dashboardTab(cid, d) {
    const r = await api("GET", `/api/study/groups/${enc(cid)}/dashboard`), S = r.summary;
    const chart = r.perSession.length ? (() => { const w = 320, hh = 90, n = r.perSession.length, max = Math.max(1, S.students, ...r.perSession.map((x) => x.present)), bw = (w - 20) / n; return `<svg class="sd-chart" viewBox="0 0 ${w} ${hh + 16}" role="img" aria-label="الحضور في آخر ${n} جلسات: ${r.perSession.map((x) => x.present).join("، ")}" dir="ltr">${r.perSession.map((x, i) => { const bh = Math.max(2, (x.present / max) * hh); return `<rect x="${(10 + i * bw + 3).toFixed(1)}" y="${(hh - bh).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${bh.toFixed(1)}" rx="3"><title>${h(new Date(x.at).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn"))}: ${x.present}</title></rect><text x="${(10 + i * bw + bw / 2 - 4).toFixed(1)}" y="${hh + 13}">${x.present}</text>`; }).join("")}</svg>`; })() : "";
    if (!$("#sd-b")) return; $("#sd-b").innerHTML = `<div class="sd-g"><div class="sd-k"><b>${num(S.students)}</b><span>طالب</span></div><div class="sd-k"><b>${S.avgAttendance === null ? "—" : pc(S.avgAttendance)}</b><span>متوسط الحضور</span></div><div class="sd-k"><b>${num(S.atRisk)}</b><span>يحتاجون متابعة</span></div><div class="sd-k"><b>${num(S.toReview)}</b><span>تسليمات للتصحيح</span></div><div class="sd-k"><b>${num(S.completed)}</b><span>أتمّوا المجموعة</span></div></div>
      ${chart ? `<h3>الحضور في آخر الجلسات</h3><figure class="sd-card sd-fig">${chart}</figure>` : `<div class="sd-note">ستظهر هنا أرقام الحضور بعد أول جلسة منتهية.</div>`}
      ${S.toReview ? `<div class="sd-row"><a class="btn" href="#/study/${enc(cid)}/assignments"><svg class=ix aria-hidden=true><use href=#i-doc /></svg> صحّح ${num(S.toReview)} تسليماً</a></div>` : ""}
      <h3>الطلاب</h3>${r.students.length ? `<ul class="sd-list sd-stu" aria-label="الطلاب">
        ${r.students.map((x) => `<li><div class="grow"><b>${h(x.name)}</b>${x.completed ? ` <span class="sd-ok"><svg class=ix aria-hidden=true><use href=#i-cap /></svg> أتمّ</span>` : ""}${x.risk.length ? `<div>${x.risk.map((k) => `<span class="sd-risk">${h(k)}</span>`).join("")}</div>` : ""}
          <dl class="sd-st"><div><dt>الحضور</dt><dd>${x.attendanceRate === null ? "—" : pc(x.attendanceRate)}</dd></div><div><dt>السلسلة</dt><dd><svg class=ix aria-hidden=true><use href=#i-fire /></svg> ${num(x.streak)}</dd></div><div><dt>الواجبات</dt><dd><bdi dir="ltr">${num(x.submitted)}/${num(x.assigned)}</bdi></dd></div><div><dt>الدرجات</dt><dd>${x.score === null ? "—" : pc(x.score)}</dd></div></dl></div>
          ${x.completed ? `<button type="button" class="btn ghost" data-rev="${h(x.id)}" aria-label="إلغاء إتمام ${h(x.name)}">إلغاء الإتمام</button>` : `<button type="button" class="btn ghost" data-cmp="${h(x.id)}" data-name="${h(x.name)}">تسجيل الإتمام</button>`}</li>`).join("")}</ul>` : `<div class="empty">لا طلاب بعد — شارك رابط المجموعة ليجتمع طلابك.</div>`}
      <p class="u-t-sm muted">معايير الإتمام: حضور ${num(r.criteria.minAttendance)}% وتسليم ${num(r.criteria.minAssignments)}% من الواجبات (تُعدّل من الإعدادات).</p>`;
    view.querySelectorAll("[data-cmp]").forEach((b) => b.addEventListener("click", async () => {
      const go = (override) => api("POST", `/api/study/groups/${enc(cid)}/completions/${enc(b.dataset.cmp)}`, { override, note: undefined });
      try { await go(false); say("سُجّل الإتمام"); groupView(cid, "dashboard"); }
      catch (x) { if (x.code === "not_eligible" && confirm(`${b.dataset.name} لم يستوفِ المعايير بعد. تسجيل الإتمام يدوياً؟`)) { try { await go(true); say("سُجّل الإتمام"); groupView(cid, "dashboard"); } catch (y) { say(y.message); } } else if (x.code !== "not_eligible") say(x.message); }
    }));
    view.querySelectorAll("[data-rev]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("إلغاء تسجيل الإتمام؟")) return; try { await api("POST", `/api/study/groups/${enc(cid)}/completions/${enc(b.dataset.rev)}`, { revoke: true }); groupView(cid, "dashboard"); } catch (x) { say(x.message); } }));
  }

  /* ---------- #/study/session/:sid ---------- */
  async function sessionView(sid) {
    page("الجلسة", `<div id="sd-s"><div class="skel"></div></div>`, ["#/study", "المجموعات"]);
    let d; try { d = await api("GET", "/api/study/sessions/" + enc(sid)); } catch (e) { if (!$("#sd-s")) return; $("#sd-s").innerHTML = errBox(e); return; }
    const s = d.session; if ($("#sd-h")) $("#sd-h").textContent = s.title;
    const back = view.querySelector(".sd-page > a"); if (back) { back.setAttribute("href", "#/study/" + enc(d.group.id)); back.textContent = "→ " + d.group.name; }
    if (!$("#sd-s")) return; $("#sd-s").innerHTML = `<p>${when(s.startsAt)} · ${s.durationMin} دقيقة · ${s.status === "live" ? "مباشرة الآن" : s.status === "ended" ? "انتهت" : s.status === "cancelled" ? "ملغاة" : "قادمة"}</p><section aria-labelledby="sd-agh"><h3 id="sd-agh" class="u-t-lg">جدول أعمال الجلسة</h3>${s.agenda ? `<ol class="sd-agenda">${s.agenda.split(/\n+/).map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)-])\s*/, "").trim()).filter(Boolean).map((x) => `<li>${h(x)}</li>`).join("")}</ol>` : `<p class="muted">${d.me.manager ? "لم يُضف جدول أعمال بعد — أضف البنود ليعرف الطلاب ما يحضّرونه." : "لم يُضف جدول أعمال لهذه الجلسة."}</p>`}
        ${d.me.manager && s.status !== "cancelled" ? `<details class="sd-card"><summary class="u-mh44 u-dflex u-aic u-cp"><b><svg class=ix aria-hidden=true><use href=#i-pen /></svg> ${s.agenda ? "تعديل" : "إضافة"} جدول الأعمال</b></summary><form id="sd-agf" class="sd-f"><label>بند في كل سطر<textarea name="agenda" rows="5" maxlength="1000" placeholder="مراجعة الواجب السابق\nشرح الدرس الجديد\nأسئلة ونقاش">${h(s.agenda || "")}</textarea></label><button class="btn">حفظ</button></form></details>` : ""}</section>
      <section aria-labelledby="sd-ash"><h3 id="sd-ash" class="u-t-lg">واجبات الجلسة</h3><div id="sd-sas"><p class="muted">…</p></div></section>
      <div class="sd-row">${s.status === "live" && d.me.member ? `<button type="button" class="btn" id="sd-j">${s.roomId ? "انضم إلى الغرفة" : "سجّل حضوري"}</button>` : ""}${s.status === "scheduled" && d.me.manager ? `<button type="button" class="btn" id="sd-go">ابدأ الجلسة</button>` : ""}${s.status === "live" && d.me.manager ? `<button type="button" class="btn ghost" id="sd-end">إنهاء الجلسة</button><a class="btn ghost" href="#/study/${enc(d.group.id)}/attendance?session=${enc(s.id)}">الحضور</a>` : ""}<a class="btn ghost" href="#/study/${enc(d.group.id)}/notes">الملاحظات</a></div>`;
    $("#sd-j")?.addEventListener("click", async () => { try { const r = await api("POST", `/api/study/sessions/${enc(sid)}/join`); say(r.attendance === "late" ? "سُجّل حضورك (متأخر)" : "سُجّل حضورك"); if (r.roomId) location.hash = "#/room/" + enc(r.roomId); } catch (x) { say(x.message); } });
    $("#sd-go")?.addEventListener("click", () => startSheet(sid));
    $("#sd-end")?.addEventListener("click", async () => { if (!confirm("إنهاء الجلسة؟ يُسجّل غياب من لم يحضر.")) return; try { await api("POST", `/api/study/sessions/${enc(sid)}/end`); say("انتهت الجلسة"); sessionView(sid); } catch (x) { say(x.message); } });
    $("#sd-agf")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await api("PATCH", "/api/study/sessions/" + enc(sid), { agenda: new FormData(e.target).get("agenda").trim() }); say("حُفظ جدول الأعمال"); sessionView(sid); } catch (x) { say(x.message); } });
    if (d.me.member || d.me.manager) api("GET", `/api/study/groups/${enc(d.group.id)}/assignments`).then((r) => {
      const box = $("#sd-sas"); if (!box) return; const mine = r.assignments.filter((a) => a.sessionId === s.id);
      box.innerHTML = `${mine.length ? `<ul class="sd-list">${mine.map((a) => `<li><span class="grow"><a href="#/study/assignment/${enc(a.id)}"><b>${h(a.title)}</b></a><span class="u-db u-t-sm muted">${due(a.dueAt)}</span></span>${r.canCreate ? "" : subChip(a.mine)}</li>`).join("")}</ul>` : `<p class="muted">لا واجبات مرتبطة بهذه الجلسة.</p>`}${r.canCreate ? `<details class="sd-card"><summary class="u-mh44 u-dflex u-aic u-cp"><b><svg class=ix aria-hidden=true><use href=#i-plus /></svg> واجب لهذه الجلسة</b></summary>${asgForm({ group: d.group }, s.id)}</details>` : ""}`;
      wireAsgForm(d.group.id, () => sessionView(sid));
    }, () => { const box = $("#sd-sas"); if (box) box.innerHTML = ""; });
  }

  MPRoutes.extend((a, b) => ({ study: () => (!a ? listView() : a === "new" ? newView() : a === "session" ? sessionView(b) : a === "assignment" ? assignmentView(b) : b === "enable" ? enableView(a) : groupView(a, b)) }));
  window.MPStudy = { assignmentView, listView, newView, groupView, sessionView, enableView, version: "__APP_VERSION__" };
  if (/^#\/study\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
