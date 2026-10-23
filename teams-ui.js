/* =====================================================================
 * Phase 79 — teams & group projects «الفرق والمشاريع» (lazy chunk `teams`, loads after the `work` chunk and reuses its
 * wk-* styles; teams.css adds the board).
 *   #/teams[?tab=directory&q=]     my teams + pending invites · directory of listed projects
 *   #/teams/new                     create (kind, about, visibility, my title, linked contract)
 *   #/teams/join/:code              invite link
 *   #/team/:id[?tab=board|updates|files|members]   board (to do / doing / review / done), updates & discussion,
 *                                   files & links, members (roles, invites, links, requests, transfer, status)
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function TeamsUI() {
  if (window.MPTeams) return;
  const api = (m, p, b, f) => Remote.api(m, p, b, f);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => UI.icon(n, c);
  const num = (n, o) => UI.num(n, o);
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const errBox = (e) => UI.empty({ title: "تعذّر التحميل", text: e?.message || "تعذّر الاتصال بالخادم" });
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const page = (head, body) => { view.innerHTML = `<div class="wrap wk-page">${UI.pageHead({ ...head, id: "wt-h" })}${body}</div>`; $("#wt-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const av = (u, cls = "") => { const src = u && typeof avSrc === "function" ? avSrc(u, "") : null; return `<span class="wk-av ${cls}" aria-hidden="true">${src ? `<img src="${h(src)}" alt="" loading="lazy" decoding="async">` : h(String(u?.name || "؟").trim()[0] || "؟")}</span>`; };
  const sheetQ = (s) => document.querySelector("#sheet " + s);
  const day = (s) => { try { return new Intl.DateTimeFormat("ar", { numberingSystem: "latn", day: "numeric", month: "long" }).format(new Date(s)); } catch { return String(s || "").slice(0, 10); } };
  const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${h(v)}</option>`).join("");
  const TONE = { active: "ok", completed: "info", archived: "", owner: "ok", admin: "info", member: "", viewer: "", high: "bad", normal: "", low: "" };
  const badge = (k, label) => `<span class="sbadge ${TONE[k] || ""}">${h(label)}</span>`;
  const COLS = ["todo", "doing", "review", "done"];
  const warnTxt = `<span class="notice warn">${ic("alert")}<span>تنبيه: يبدو أن الرسالة تطلب دفعاً أو تواصلاً خارج المنصة أو بيانات محفظتك. لا تدفع ولا تشارك عبارة المرور.</span></span>`;

  /* ---------- #/teams ---------- */
  async function hub() {
    const q = qs(), tab = q.get("tab") === "directory" ? "directory" : "mine";
    page({ title: "الفرق والمشاريع", icon: "users", sub: "اعمل مع آخرين: مهام، ملفات، تحديثات، وربط بالعقود.", actions: signed() ? `<a class="btn sm" href="#/teams/new">${ic("plus")}فريق جديد</a>` : "" },
      `<nav class="seg u-mb12" aria-label="الفرق"><a href="#/teams" ${tab === "mine" ? 'aria-current="page"' : ""}>فرقي</a><a href="#/teams?tab=directory" ${tab === "directory" ? 'aria-current="page"' : ""}>دليل المشاريع</a></nav><div id="wt-l">${skel(3)}</div>`);
    const box = $("#wt-l");
    try {
      if (tab === "directory") {
        const d = await api("GET", "/api/teams/directory?q=" + enc(q.get("q") || "")); if (!box.isConnected) return;
        box.innerHTML = `<form class="fx-q u-mb12" id="wt-sf" role="search"><label><span class="vh">ابحث في المشاريع</span><input type="search" name="q" value="${h(q.get("q") || "")}" maxlength="80" placeholder="اسم المشروع أو فكرته"></label><button class="btn" type="submit">بحث</button></form>
          ${d.teams.length ? `<ul class="list">${d.teams.map((t) => `<li><a class="li" href="#/team/${enc(t.id)}">${av(t.owner)}<span class="t"><b>${h(t.name)}</b><small>${h(t.kind.label)} · ${num(t.members)} أعضاء · ${h(t.owner?.name || "")}</small>${t.about ? `<small>${h(t.about)}</small>` : ""}</span>${t.member ? badge("member", "عضو") : ""}</a></li>`).join("")}</ul>` : UI.empty({ title: "لا مشاريع مطابقة", text: "المشاريع الظاهرة هنا اختار أصحابها عرضها في الدليل." })}`;
        $("#wt-sf").addEventListener("submit", (e) => { e.preventDefault(); location.hash = "#/teams?tab=directory&q=" + enc(e.target.q.value.trim()); });
        return;
      }
      if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول", text: "لتتابع فرقك.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
      const d = await api("GET", "/api/teams"); if (!box.isConnected) return;
      box.innerHTML = `${d.invites.length ? `<div class="f-h">دعوات بانتظارك</div><ul class="list">${d.invites.map((i) => `<li class="wt-inv"><span class="li">${av(i.by)}<span class="t"><b>${h(i.team.name)}</b><small>${h(i.by?.name || "")} يدعوك ك${h(i.role)}${i.note ? ` — ${h(i.note)}` : ""}</small></span></span><span class="wk-acts"><button class="btn sm" type="button" data-inv="${h(i.id)}" data-ok="1">قبول</button><button class="btn ghost sm" type="button" data-inv="${h(i.id)}">رفض</button></span></li>`).join("")}</ul>` : ""}
        ${d.teams.length ? `<ul class="list">${d.teams.map((t) => `<li><a class="li" href="#/team/${enc(t.id)}"><span class="ico">${ic(t.kind.key === "team" ? "users" : "brief")}</span><span class="t"><b>${h(t.name)}</b><small>${h(t.kind.label)} · ${h(t.role?.label || "")} · ${num(t.members)} أعضاء · ${num(t.tasks.open)} مهام مفتوحة${t.contract ? " · مرتبط بعقد" : ""}</small></span>${badge(t.status, t.statusLabel)}</a></li>`).join("")}</ul>`
          : UI.empty({ title: "لا فرق بعد", text: "أنشئ فريقاً أو مشروعاً وادعُ زملاءك، أو تصفّح دليل المشاريع.", action: `<a class="btn" href="#/teams/new">فريق جديد</a>` })}`;
      box.querySelectorAll("[data-inv]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { const r = await api("POST", `/api/team-invites/${enc(b.dataset.inv)}/respond`, { accept: !!b.dataset.ok }); say(r.joined ? "انضممت إلى الفريق" : "رُفضت الدعوة"); if (r.joined) location.hash = "#/team/" + enc(r.team); else hub(); })));
    } catch (e) { box.innerHTML = errBox(e); }
  }

  /* ---------- #/teams/new ---------- */
  async function form() {
    page({ title: "فريق جديد", icon: "users", back: ["#/teams", "الفرق"] }, `<div id="wt-n">${skel(3)}</div>`);
    const box = $("#wt-n");
    if (!signed()) { box.innerHTML = UI.empty({ title: "سجّل الدخول أولاً", text: "لإنشاء فريق.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` }); return; }
    let mine, cts; try { mine = await api("GET", "/api/teams"); cts = await api("GET", "/api/contracts").catch(() => ({ open: [], closed: [] })); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const O = mine.options, all = [...cts.open, ...cts.closed];
    box.innerHTML = `<form class="card f-form" id="wt-f">
      <fieldset class="wk-fs"><legend>النوع</legend><div class="wk-checks">${Object.entries(O.kinds).map(([k, v], i) => `<label class="wk-ck"><input type="radio" name="kind" value="${k}" ${i === 1 ? "checked" : ""}><span>${h(v)}</span></label>`).join("")}</div></fieldset>
      <label>الاسم<input name="name" required minlength="3" maxlength="80" placeholder="مثلاً: تطبيق مكتبة الحي" value="${h(all.find((c) => c.id === qs().get("contract"))?.title || "")}"></label>
      <label>الفكرة والهدف (اختياري)<textarea name="about" rows="4" maxlength="2000"></textarea></label>
      <label>الظهور<select name="visibility">${Object.entries(O.visibility).filter(([k]) => !(mine.minor && k === "listed")).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></label>
      <label>دورك في الفريق (اختياري)<input name="title" maxlength="60" placeholder="مثلاً: مديرة المشروع"></label>
      ${all.length ? `<label>ربط بعقد (اختياري)<select name="contract"><option value="">بدون</option>${all.map((c) => `<option value="${h(c.id)}" ${qs().get("contract") === c.id ? "selected" : ""}>${h(c.title)}</option>`).join("")}</select></label>` : ""}
      <button class="btn" type="submit">إنشاء</button></form>`;
    const f = $("#wt-f");
    f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { const r = await api("POST", "/api/teams", { kind: f.querySelector("[name=kind]:checked").value, name: f.name.value.trim(), about: f.about.value.trim() || null, visibility: f.visibility.value, title: f.title.value.trim() || null, contractId: f.contract?.value || undefined }); say("أُنشئ الفريق"); location.hash = "#/team/" + enc(r.id); }); });
  }

  /* ---------- #/teams/join/:code ---------- */
  async function join(code) {
    page({ title: "دعوة إلى فريق", icon: "users", back: ["#/teams", "الفرق"] }, `<div id="wt-j">${skel(2)}</div>`);
    const box = $("#wt-j");
    let d; try { d = await api("GET", "/api/teams/join/" + enc(code)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const t = d.team;
    box.innerHTML = `<section class="card wk-sec"><div class="wk-ch">${av(t.owner, "lg")}<span class="u-f1 u-mw0"><h3 class="wk-jt">${h(t.name)}</h3><small>${h(t.kind)} · ${num(t.members)} أعضاء · ${h(t.owner?.name || "")}</small></span></div>${t.about ? `<p class="wk-about">${h(t.about)}</p>` : ""}<p class="f-hint">ستنضم ك${h(d.role)}. الرابط صالح حتى ${h(day(d.expiresAt))}.</p>
      <div class="wk-acts">${d.member ? `<a class="btn" href="#/team/${enc(t.id)}">فتح الفريق</a>` : signed() ? `<button class="btn" type="button" id="wt-join">${ic("check")}انضمام</button>` : `<a class="btn" href="#/settings">سجّل الدخول للانضمام</a>`}</div></section>`;
    $("#wt-join")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { const r = await api("POST", "/api/teams/join", { code }); say("انضممت إلى الفريق"); location.hash = "#/team/" + enc(r.team); }));
  }

  /* ---------- #/team/:id ---------- */
  async function team(tid) {
    const tab = ["board", "updates", "files", "members"].includes(qs().get("tab")) ? qs().get("tab") : "board";
    page({ title: "الفريق", icon: "users", back: ["#/teams", "الفرق"] }, `<div id="wt-v">${skel(5)}</div>`);
    const box = $("#wt-v");
    let d; try { d = await api("GET", "/api/teams/" + enc(tid)); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!box.isConnected) return; const t = d.team, me = d.me;
    if (me.outsider) {
      box.innerHTML = `<section class="card wk-sec"><div class="wk-ch">${av(t.owner, "lg")}<span class="u-f1 u-mw0"><h3 class="wk-jt">${h(t.name)}</h3><small>${h(t.kind.label)} · ${num(t.members)} أعضاء · ${h(t.owner?.name || "")}</small></span></div>${t.about ? `<p class="wk-about">${h(t.about)}</p>` : ""}
        <div class="wk-acts">${me.request === "pending" ? `<span class="sbadge info">طلبك بانتظار الرد</span>` : me.canRequest ? `<button class="btn" type="button" id="wt-rq">${ic("plus")}طلب الانضمام</button>` : !me.signedIn ? `<a class="btn" href="#/settings">سجّل الدخول للانضمام</a>` : ""}</div></section>`;
      $("#wt-rq")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { const note = prompt("رسالة قصيرة لصاحب المشروع (اختياري)") || undefined; await api("POST", `/api/teams/${enc(tid)}/request`, { note }); say("أُرسل طلبك"); team(tid); }));
      return;
    }
    const C = d.contract, tabs = [["board", "اللوحة"], ["updates", "النقاش"], ["files", "الملفات"], ["members", "الأعضاء"]];
    box.innerHTML = `<section class="card wk-sec"><div class="wk-sh"><h3 class="wk-jt u-f1">${h(t.name)}</h3>${badge(t.status, t.statusLabel)}</div><p class="f-hint">${h(t.kind.label)} · ${h(t.visibilityLabel)} · دورك: ${h(me.roleLabel || "فريق المنصة")}</p>${t.about ? `<p class="wk-about">${h(t.about)}</p>` : ""}
        ${C ? `<p class="wt-ct">${ic("shield", "xs")} مرتبط بعقد: ${C.party ? `<a href="#/contract/${enc(C.id)}">${h(C.title)}</a>` : h(C.title)} ${badge(C.status === "active" ? "active" : "", C.statusLabel)}</p>` : ""}
        ${t.status === "archived" ? `<div class="notice">${ic("lock")}<span>الفريق مؤرشف للقراءة فقط.</span></div>` : ""}
        ${t.status === "completed" && me.role && me.role !== "viewer" ? `<div class="notice">${ic("star")}<span>اكتمل المشروع. <a class="u-fw7" href="#/reviews?tab=pending">قيّم زملاءك</a> وأيّد مهاراتهم خلال 30 يوماً.</span></div>` : ""}</section>
      <nav class="seg u-mb12" aria-label="أقسام الفريق">${tabs.map(([k, v]) => `<a href="#/team/${enc(tid)}?tab=${k}" ${tab === k ? 'aria-current="page"' : ""}>${v}</a>`).join("")}</nav><div id="wt-tab"></div>`;
    const pane = $("#wt-tab"), reload = () => team(tid);
    ({ board, updates, files, members })[tab](pane, d, reload);
  }

  function board(pane, d, reload) {
    const me = d.me, can = me.can.tasks, mem = d.members.filter((m) => m.role !== "viewer");
    const ms = d.contract?.milestones || [];
    const card = (k) => { const i = COLS.indexOf(k.status); return `<li class="card wt-task${k.mine ? " mine" : ""}"><b>${h(k.title)}</b>${k.body ? `<p>${h(k.body)}</p>` : ""}
      <span class="wt-meta">${k.assignee ? `${av(k.assignee, "sm")}<span>${h(k.assignee.name)}</span>` : `<span class="f-hint">غير مُسندة</span>`}${k.due ? `<span class="${k.overdue ? "wt-late" : ""}">${ic("clock", "xs")} ${h(day(k.due))}</span>` : ""}${k.priority !== "normal" ? badge(k.priority, k.priorityLabel) : ""}${k.milestoneId ? `<span class="sbadge info">${h(ms.find((m) => m.id === k.milestoneId)?.title || "مرحلة")}</span>` : ""}</span>
      ${can ? `<span class="wk-acts wt-ta">${i > 0 ? `<button class="btn ghost sm" type="button" data-mv="${h(k.id)}" data-to="${COLS[i - 1]}" aria-label="إلى «${h(d.options.columns[COLS[i - 1]])}»">→ ${h(d.options.columns[COLS[i - 1]])}</button>` : ""}${i < 3 ? `<button class="btn outline sm" type="button" data-mv="${h(k.id)}" data-to="${COLS[i + 1]}" aria-label="إلى «${h(d.options.columns[COLS[i + 1]])}»">${h(d.options.columns[COLS[i + 1]])} ←</button>` : ""}<button class="btn ghost sm" type="button" data-ed="${h(k.id)}" aria-label="تعديل «${h(k.title)}»">${ic("pen")}</button></span>` : ""}</li>`; };
    pane.innerHTML = `${can ? `<p><button class="btn sm" type="button" id="wt-add">${ic("plus")}مهمة جديدة</button></p>` : ""}
      <div class="wt-board">${COLS.map((c) => { const ks = d.tasks.filter((k) => k.status === c).sort((a, b) => a.pos - b.pos); return `<section class="wt-col" aria-labelledby="wt-c-${c}"><h3 id="wt-c-${c}" class="wt-ch">${h(d.options.columns[c])} <span class="n">${num(ks.length)}</span></h3>${ks.length ? `<ol class="wt-tasks">${ks.map(card).join("")}</ol>` : `<p class="wk-none">لا مهام.</p>`}</section>`; }).join("")}</div>`;
    const taskSheet = (k) => {
      sheet(`<h3 class="u-mt0">${k ? "تعديل المهمة" : "مهمة جديدة"}</h3><form class="f-form" id="wt-tf"><label>العنوان<input name="title" required minlength="2" maxlength="160" value="${h(k?.title || "")}"></label><label>التفاصيل (اختياري)<textarea name="body" rows="3" maxlength="3000">${h(k?.body || "")}</textarea></label>
        <div class="wk-two"><label>المكلَّف<select name="assignee"><option value="">بدون</option>${mem.map((m) => `<option value="${h(m.user.id)}" ${k?.assignee?.id === m.user.id ? "selected" : ""}>${h(m.user.name)}</option>`).join("")}</select></label><label>الأولوية<select name="priority">${opt(d.options.priorities, k?.priority || "normal")}</select></label></div>
        <div class="wk-two"><label>الموعد (اختياري)<input type="date" name="due" value="${h(k?.due || "")}"></label><label>العمود<select name="status">${opt(d.options.columns, k?.status || "todo")}</select></label></div>
        ${ms.length ? `<label>مرحلة العقد (اختياري)<select name="milestone"><option value="">بدون</option>${ms.map((m) => `<option value="${h(m.id)}" ${k?.milestoneId === m.id ? "selected" : ""}>${h(m.title)}</option>`).join("")}</select></label>` : ""}
        <div class="wk-acts"><button class="btn" type="submit">${k ? "حفظ" : "إضافة"}</button>${k ? `<button class="btn ghost" type="button" data-up="up">تحريك لأعلى</button><button class="btn ghost" type="button" data-up="down">تحريك لأسفل</button><button class="btn danger" type="button" id="wt-del">حذف</button>` : ""}<button class="btn ghost" type="button" data-ui="close-sheet">إلغاء</button></div></form>`);
      const f = sheetQ("#wt-tf"); f.title.focus();
      const body = () => ({ title: f.title.value.trim(), body: f.body.value.trim() || null, assignee: f.assignee.value || null, priority: f.priority.value, due: f.due.value || null, status: f.status.value, milestoneId: f.milestone ? f.milestone.value || null : undefined });
      f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { if (k) await api("PATCH", "/api/team-tasks/" + enc(k.id), body()); else await api("POST", `/api/teams/${enc(d.team.id)}/tasks`, body()); closeSheet(); say(k ? "حُفظت المهمة" : "أُضيفت المهمة"); reload(); }); });
      f.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("PATCH", "/api/team-tasks/" + enc(k.id), { move: b.dataset.up }); closeSheet(); reload(); })));
      sheetQ("#wt-del")?.addEventListener("click", (e) => { if (!confirm("حذف المهمة؟")) return; busy(e.currentTarget, async () => { await api("DELETE", "/api/team-tasks/" + enc(k.id)); closeSheet(); say("حُذفت المهمة"); reload(); }); });
    };
    $("#wt-add")?.addEventListener("click", () => taskSheet(null));
    pane.querySelectorAll("[data-ed]").forEach((b) => b.addEventListener("click", () => taskSheet(d.tasks.find((k) => k.id === b.dataset.ed))));
    pane.querySelectorAll("[data-mv]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("PATCH", "/api/team-tasks/" + enc(b.dataset.mv), { status: b.dataset.to }); say("نُقلت المهمة"); reload(); })));
  }

  function updates(pane, d, reload) {
    const can = d.me.can;
    const one = (x, reply) => `<li class="${reply ? "wt-reply" : "card wt-up"}"><div class="wt-uh">${av(x.user, "sm")}<b>${h(x.user?.name || "")}</b>${!reply && x.kind === "question" ? badge("normal", "سؤال") : ""}<small>${h(day(x.at))}</small>${x.canDelete ? `<button class="btn ghost sm" type="button" data-dp="${h(x.id)}" aria-label="حذف">${ic("x")}</button>` : ""}</div><p>${h(x.body)}</p>${x.warn ? warnTxt : ""}
      ${reply ? "" : `${x.replies.length ? `<ol class="wt-replies">${x.replies.map((r) => one(r, true)).join("")}</ol>` : ""}${can.post ? `<form class="f-form wk-msgf" data-rp="${h(x.id)}"><label><span class="vh">ردّك</span><textarea name="body" rows="1" maxlength="4000" required placeholder="اكتب رداً…"></textarea></label><button class="btn sm" type="submit">رد</button></form>` : ""}`}</li>`;
    pane.innerHTML = `${can.announce ? `<form class="card f-form" id="wt-pf"><label>شارك تحديثاً أو اطرح سؤالاً<textarea name="body" rows="3" required maxlength="4000" placeholder="ما الجديد؟"></textarea></label><div class="wk-acts"><select name="kind" aria-label="النوع">${opt({ update: "تحديث", question: "سؤال" }, "update")}</select><button class="btn sm" type="submit">نشر</button></div></form>` : ""}
      ${d.updates.length ? `<ol class="wt-ups">${d.updates.map((x) => one(x)).join("")}</ol>` : UI.empty({ title: "لا تحديثات بعد", text: "شارك أول تحديث عن سير العمل." })}`;
    $("#wt-pf")?.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/teams/${enc(d.team.id)}/updates`, { body: e.target.body.value.trim(), kind: e.target.kind.value }); say("نُشر"); reload(); }); });
    pane.querySelectorAll("[data-rp]").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/api/teams/${enc(d.team.id)}/updates`, { body: f.body.value.trim(), parentId: f.dataset.rp }); reload(); }); }));
    pane.querySelectorAll("[data-dp]").forEach((b) => b.addEventListener("click", () => { if (!confirm("حذف؟")) return; busy(b, async () => { await api("DELETE", "/api/team-updates/" + enc(b.dataset.dp)); reload(); }); }));
  }

  function files(pane, d, reload) {
    const can = d.me.can.items;
    pane.innerHTML = `${can ? `<form class="card f-form" id="wt-if"><div class="wk-two"><label>العنوان<input name="title" required minlength="2" maxlength="120"></label><label>الرابط<input name="url" type="url" dir="ltr" maxlength="600" placeholder="https://"></label></div>
        <label>أو صورة (تصميم، لقطة شاشة)<input name="file" type="file" accept="image/*"></label><label>ملاحظة (اختياري)<input name="note" maxlength="600"></label><button class="btn sm" type="submit">${ic("plus")}إضافة</button></form>` : ""}
      ${d.items.length ? `<ul class="list wt-items">${d.items.map((x) => `<li><span class="li"><span class="ico">${ic(x.kind === "file" ? "camera" : "link")}</span><span class="t">${x.url ? `<a class="u-fw7" href="${h(x.url)}" target="_blank" rel="noopener noreferrer nofollow">${h(x.title)}</a>` : `<b>${h(x.title)}</b>`}<small>${h(x.by?.name || "")} · ${h(day(x.at))}${x.note ? ` · ${h(x.note)}` : ""}</small></span>${x.canDelete ? `<button class="btn ghost sm" type="button" data-di="${h(x.id)}" aria-label="حذف «${h(x.title)}»">${ic("x")}</button>` : ""}</span></li>`).join("")}</ul>` : UI.empty({ title: "لا ملفات أو روابط", text: "أضف روابط المستودع والتصاميم والمستندات المشتركة." })}`;
    $("#wt-if")?.addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; busy(e.submitter, async () => {
      let mediaId; const file = f.file.files[0];
      if (file) { if (file.size > 8 * 1048576) throw new Error("حجم الصورة كبير (٨ ميغابايت كحد أقصى)"); mediaId = (await api("POST", "/api/media", null, file)).media.id; }
      else if (!f.url.value.trim()) throw new Error("أضف رابطاً أو صورة");
      await api("POST", `/api/teams/${enc(d.team.id)}/items`, { title: f.title.value.trim(), url: mediaId ? undefined : f.url.value.trim(), mediaId, note: f.note.value.trim() || null }); say("أُضيف"); reload(); }); });
    pane.querySelectorAll("[data-di]").forEach((b) => b.addEventListener("click", () => { if (!confirm("حذف؟")) return; busy(b, async () => { await api("DELETE", "/api/team-items/" + enc(b.dataset.di)); reload(); }); }));
  }

  function members(pane, d, reload) {
    const me = d.me, t = d.team, admin = me.can.invite || me.can.edit, owner = me.can.owner, T = enc(t.id);
    const roleOpts = (cur) => opt(Object.fromEntries(Object.entries(d.options.roles).filter(([k]) => k !== "owner" && (owner || k !== "admin"))), cur);
    pane.innerHTML = `<ul class="list wt-mem">${d.members.map((m) => `<li><span class="li">${av(m.user)}<span class="t"><b>${h(m.user?.name || "")}</b><small>${m.title ? h(m.title) + " · " : ""}منذ ${h(day(m.joinedAt))}</small></span>${badge(m.role, m.roleLabel)}</span>
        ${admin && m.role !== "owner" && m.user.id !== (typeof DB !== "undefined" ? DB.me : "") && (owner || m.role !== "admin") ? `<span class="wk-acts"><label class="wt-rl"><span class="vh">دور ${h(m.user.name)}</span><select data-role="${h(m.user.id)}">${roleOpts(m.role)}</select></label><button class="btn ghost sm" type="button" data-rm="${h(m.user.id)}">إزالة</button></span>` : ""}</li>`).join("")}</ul>
      ${d.invites.length ? `<div class="f-h">دعوات وطلبات معلّقة</div><ul class="list wt-mem">${d.invites.map((i) => `<li><span class="li"><span class="ico">${ic(i.kind === "link" ? "link" : "mail")}</span><span class="t"><b>${i.kind === "link" ? "رابط دعوة" : h(i.user?.name || "")}</b><small>${i.kind === "request" ? "طلب انضمام" : i.kind === "link" ? `${num(i.uses)}${i.maxUses ? "/" + num(i.maxUses) : ""} استخدام · حتى ${h(day(i.expiresAt))}` : "دعوة"} · ${h(i.roleLabel)}${i.note ? ` — ${h(i.note)}` : ""}</small>${i.code ? `<small dir="ltr"><bdi>${h(location.origin + "/#/teams/join/" + i.code)}</bdi></small>` : ""}</span></span><span class="wk-acts">${i.kind === "request" ? `<button class="btn sm" type="button" data-rq="${h(i.id)}" data-ok="1">قبول</button><button class="btn ghost sm" type="button" data-rq="${h(i.id)}">رفض</button>` : `${i.code ? `<button class="btn outline sm" type="button" data-cp="${h(i.code)}">نسخ الرابط</button>` : ""}<button class="btn ghost sm" type="button" data-rv="${h(i.id)}">إلغاء</button>`}</span></li>`).join("")}</ul>` : ""}
      ${me.can.invite ? `<section class="card wk-sec"><h3 class="wk-st">${ic("plus")}دعوة أعضاء</h3><form class="f-form" id="wt-inv"><div class="wk-two"><label>اسم المستخدم<input name="handle" required maxlength="40" dir="ltr" placeholder="@handle"></label><label>الدور<select name="role">${roleOpts("member")}</select></label></div><button class="btn sm" type="submit">إرسال الدعوة</button></form>
        <form class="f-form u-mt12" id="wt-lnk"><div class="wk-two"><label>صلاحية الرابط (أيام)<input name="days" type="number" min="1" max="30" value="7" inputmode="numeric"></label><label>أقصى عدد للاستخدام (اختياري)<input name="max" type="number" min="1" max="50" inputmode="numeric"></label></div><button class="btn outline sm" type="submit">${ic("link")}إنشاء رابط دعوة</button></form></section>` : ""}
      ${me.role ? `<section class="card wk-sec"><h3 class="wk-st">${ic("user")}دورك في الفريق</h3><form class="f-form" id="wt-me"><label>المسمى (يظهر للأعضاء)<input name="title" maxlength="60" value="${h(d.members.find((m) => m.user.id === (typeof DB !== "undefined" ? DB.me : ""))?.title || "")}"></label><div class="wk-acts"><button class="btn outline sm" type="submit">حفظ</button>${me.can.leave ? `<button class="btn ghost sm" type="button" id="wt-leave">مغادرة الفريق</button>` : ""}</div></form></section>` : ""}
      ${owner || me.staff ? `<section class="card wk-sec"><h3 class="wk-st">${ic("shield")}إدارة الفريق</h3>${owner ? `<form class="f-form" id="wt-ed"><label>الاسم<input name="name" required minlength="3" maxlength="80" value="${h(t.name)}"></label><label>الفكرة<textarea name="about" rows="3" maxlength="2000">${h(t.about)}</textarea></label><label>الظهور<select name="visibility">${opt(d.options.visibility, t.visibility)}</select></label><button class="btn outline sm" type="submit">حفظ الإعدادات</button></form>
          ${d.members.length > 1 ? `<form class="f-form u-mt12" id="wt-tr"><label>نقل الملكية إلى<select name="user" required><option value="">اختر…</option>${d.members.filter((m) => m.role !== "owner").map((m) => `<option value="${h(m.user.id)}">${h(m.user.name)}</option>`).join("")}</select></label><button class="btn ghost sm" type="submit">نقل الملكية</button></form>` : ""}` : ""}
        <div class="wk-acts u-mt12">${t.status !== "completed" && owner ? `<button class="btn outline sm" type="button" data-st="completed">${ic("check")}تعليم كمكتمل</button>` : ""}${t.status !== "archived" ? `<button class="btn ghost sm" type="button" data-st="archived">أرشفة</button>` : ""}${t.status !== "active" ? `<button class="btn outline sm" type="button" data-st="active">إعادة التفعيل</button>` : ""}</div></section>` : ""}`;
    const call = (b, fn, msg) => busy(b, async () => { await fn(); if (msg) say(msg); reload(); });
    pane.querySelectorAll("[data-role]").forEach((s) => s.addEventListener("change", () => call(null, () => api("PATCH", `/api/teams/${T}/members/${enc(s.dataset.role)}`, { role: s.value }), "تم تغيير الدور")));
    pane.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { if (confirm("إزالة العضو من الفريق؟")) call(b, () => api("DELETE", `/api/teams/${T}/members/${enc(b.dataset.rm)}`), "أُزيل العضو"); }));
    pane.querySelectorAll("[data-rq]").forEach((b) => b.addEventListener("click", () => call(b, () => api("POST", `/api/teams/${T}/requests/${enc(b.dataset.rq)}`, { accept: !!b.dataset.ok }), b.dataset.ok ? "قُبل الطلب" : "رُفض الطلب")));
    pane.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => call(b, () => api("POST", `/api/teams/${T}/invites/${enc(b.dataset.rv)}/revoke`), "أُلغيت")));
    pane.querySelectorAll("[data-cp]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.origin + "/#/teams/join/" + b.dataset.cp); say("نُسخ الرابط"); } catch { say("انسخ الرابط من القائمة"); } }));
    pane.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.st !== "active" && !confirm(b.dataset.st === "archived" ? "أرشفة الفريق؟ يصبح للقراءة فقط." : "تعليم المشروع كمكتمل؟")) return; call(b, () => api("POST", `/api/teams/${T}/state`, { status: b.dataset.st }), "تم"); }));
    $("#wt-inv")?.addEventListener("submit", (e) => { e.preventDefault(); call(e.submitter, () => api("POST", `/api/teams/${T}/invites`, { handle: e.target.handle.value.trim(), role: e.target.role.value }), "أُرسلت الدعوة"); });
    $("#wt-lnk")?.addEventListener("submit", (e) => { e.preventDefault(); call(e.submitter, () => api("POST", `/api/teams/${T}/invites`, { link: true, role: "member", days: Number(e.target.days.value) || 7, maxUses: e.target.max.value ? Number(e.target.max.value) : undefined }), "أُنشئ الرابط"); });
    $("#wt-me")?.addEventListener("submit", (e) => { e.preventDefault(); call(e.submitter, () => api("PUT", `/api/teams/${T}/me`, { title: e.target.title.value.trim() || null }), "حُفظ"); });
    $("#wt-leave")?.addEventListener("click", (e) => { if (!confirm("مغادرة الفريق؟")) return; busy(e.currentTarget, async () => { await api("DELETE", `/api/teams/${T}/members/${enc(DB.me)}`); say("غادرت الفريق"); location.hash = "#/teams"; }); });
    $("#wt-ed")?.addEventListener("submit", (e) => { e.preventDefault(); call(e.submitter, () => api("PATCH", `/api/teams/${T}`, { name: e.target.name.value.trim(), about: e.target.about.value.trim() || null, visibility: e.target.visibility.value }), "حُفظت الإعدادات"); });
    $("#wt-tr")?.addEventListener("submit", (e) => { e.preventDefault(); if (!confirm("نقل الملكية؟ ستصبح مشرفاً.")) return; call(e.submitter, () => api("POST", `/api/teams/${T}/transfer`, { userId: e.target.user.value }), "نُقلت الملكية"); });
  }

  /* =================== routes =================== */
  MPRoutes.extend((a, b, prev) => {
    return { teams: () => (a === "new" ? form() : a === "join" && b ? join(decodeURIComponent(b)) : hub()), team: () => team(a) };
  });
  window.MPTeams = { hub, form, join, team };
  if (!window.__deferRoute && /^#\/(teams|team)(\/|\?|$)/.test(location.hash)) route();
})();
