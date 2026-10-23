/* =====================================================================
 * مجتمع بلس — Phase 72 UI: courses and lessons with progress (lazy "courses" chunk; 0 bytes in core).
 *   #/courses[?group=]           learning (resume, progress), discover (search, level), teaching
 *   #/course/new?group=          create a course in a study group (teachers / admins)
 *   #/course/:id                 course page: outline with ✓, progress ring, enrol / resume, completion card
 *   #/course/:id/learn/:lesson   lesson player: text (richtext.js), video link, quiz (server-scored, explanations),
 *                                mark done (updates progress in place), previous / next
 *   #/course/:id/edit            authoring: details, publish, modules + lessons (add / edit / move / delete), quiz builder
 *   #/course/:id/learners        teacher view: learners, progress, quiz average, per-lesson funnel
 * CSP: no inline handlers, no javascript: URLs. Videos open in a new tab (no third-party frames).
 * ===================================================================== */
(function CoursesUI() {
  if (window.MPCourses) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const num = (x) => `<bdi dir="ltr">${Number(x || 0).toLocaleString("en-US")}</bdi>`;
  const pc = (x) => `<bdi dir="ltr">${Math.round(x || 0)}%</bdi>`;
  const rel = (iso) => (typeof relTime === "function" ? relTime(iso) : "");
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const KIND = { text: ["", "درس مقروء"], video: ["", "فيديو"], quiz: ["", "اختبار"] };
  const LEVEL = { beginner: "مبتدئ", intermediate: "متوسط", advanced: "متقدم", all: "كل المستويات" };
  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} س${m % 60 ? ` ${m % 60} د` : ""}` : `${m} د`);
  const ring = (p, size = 64) => { const r = size / 2 - 6, c = 2 * Math.PI * r; return `<svg class="cx-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="التقدم ${Math.round(p)}%"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle">${Math.round(p)}%</text></svg>`; };
  const page = (title, body, back, sub) => { view.innerHTML = `<div class="wrap cx-page"><header class="page-head">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${h(back[1])}</a>` : ""}<div class="ph-main"><div><h2 id="cx-h" tabindex="-1">${String(title).replaceAll("<svg class=ix", "<svg class=ic")}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div></div></header>${body}</div>`; $("#cx-h")?.focus({ preventScroll: true }); };
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel cx-skel"></div>`).join("");
  const srOnly = (el) => { if (el) el.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"; };
  const md = (s) => { try { const RT = window.RichText; return RT ? RT.toHTML(RT.parse(String(s || ""))) : `<p>${h(s)}</p>`; } catch { return `<p>${h(s)}</p>`; } };
  const HUES = [262, 282, 228, 205, 322, 248, 190];
  const hue = (id) => HUES[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7) % HUES.length];
  const lessonsN = (n) => (n === 1 ? "درس واحد" : n === 2 ? "درسان" : n >= 3 && n <= 10 ? `${num(n)} دروس` : `${num(n)} درساً`);
  const cover = (c) => `style="--cx-h:${hue(c.id)}"`;

  if (!document.getElementById("cx-css")) document.head.insertAdjacentHTML("beforeend", `<style id="cx-css">
.cx-page{max-width:820px;margin:auto}.cx-page .sub{max-width:60ch}.cx-cv .ix{width:28px;height:28px;opacity:.9}.cx-page h2:focus{outline:none}.cx-page h3{font-size:16px;font-weight:800;margin:22px 0 8px}
.cx-skel{height:96px;border-radius:var(--r);margin:8px 0}.cx-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.cx-row .btn{min-height:44px}.cx-grow{flex:1;min-width:0}
.cx-grid{display:grid;grid-template-columns:1fr;gap:10px;margin:10px 0}@media(min-width:560px){.cx-grid{grid-template-columns:1fr 1fr}}
.cx-c{display:flex;flex-direction:column;border-radius:var(--r);border:1px solid color-mix(in srgb,var(--line) 70%,transparent);background:var(--card);box-shadow:var(--sh-1);overflow:hidden;color:var(--text);text-decoration:none;min-width:0}.cx-c:hover{border-color:var(--accent)}
.cx-cv{height:92px;background:var(--hero-grad);display:flex;align-items:flex-end;justify-content:space-between;padding:10px 12px;color:#fff;font-size:30px;position:relative}.cx-cv .lv{font-size:11.5px;font-weight:700;background:#0005;padding:2px 10px;border-radius:999px}
.cx-c .bd{padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px;min-width:0}.cx-c .bd b{font-size:15.5px;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.cx-c .m{font-size:12.5px;color:var(--muted);display:flex;gap:8px;flex-wrap:wrap}
.cx-bar{height:8px;border-radius:6px;background:var(--bg-2);overflow:hidden;margin:4px 0}.cx-bar i{display:block;height:100%;background:var(--accent);border-radius:6px;transition:width .4s var(--ease)}.cx-bar.ok i{background:var(--ok)}
.cx-ring .bg{fill:none;stroke:var(--bg-2);stroke-width:6}.cx-ring .fg{fill:none;stroke:var(--accent);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset .5s var(--ease)}.cx-ring text{font-size:14px;font-weight:800;fill:var(--text)}
.cx-hero{border-radius:var(--r-lg);overflow:hidden;border:1px solid color-mix(in srgb,var(--line) 70%,transparent);background:var(--card);box-shadow:var(--sh-1);margin:10px 0}.cx-hero .cx-cv{height:auto;min-height:130px;flex-direction:column;align-items:flex-start;justify-content:flex-end;gap:6px;font-size:15px}.cx-hero h1{margin:0;font-size:22px;line-height:1.35;font-weight:800;color:#fff}.cx-hero .st{font-size:13.5px;opacity:.92}
.cx-hero .bd{padding:12px 16px 16px}.cx-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:4px 0 8px;text-align:center}.cx-stats div{padding:8px 4px;border-radius:var(--r-sm);background:var(--bg-2)}.cx-stats b{display:block;font-size:17px;font-weight:800}.cx-stats span{font-size:11.5px;color:var(--muted)}
.cx-me{display:flex;gap:14px;align-items:center;padding:14px;border-radius:var(--r);border:1px solid var(--line);background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,var(--card)),var(--card));box-shadow:var(--sh-1);margin:10px 0}.cx-me .btn{min-height:44px}
.cx-done{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:16px;border-radius:var(--r);border:1px solid var(--line);background:linear-gradient(135deg,color-mix(in srgb,var(--warn) 14%,var(--card)),color-mix(in srgb,var(--accent) 12%,var(--card)));margin:10px 0}
.cx-mod{border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:8px 0;overflow:hidden}.cx-mod>summary{list-style:none;display:flex;gap:10px;align-items:center;padding:12px 14px;min-height:52px;cursor:pointer}.cx-mod>summary::-webkit-details-marker{display:none}.cx-mod>summary b{flex:1;min-width:0}.cx-mod>summary .n{font-size:12.5px;color:var(--muted);white-space:nowrap}.cx-mod>summary::after{content:"⌄";color:var(--muted);transition:transform .2s}.cx-mod[open]>summary::after{transform:rotate(180deg)}
.cx-ls{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}.cx-ls li{border-bottom:1px solid var(--line)}.cx-ls li:last-child{border-bottom:0}.cx-ls a,.cx-ls .lk{display:flex;gap:12px;align-items:center;padding:10px 14px;min-height:52px;color:inherit;text-decoration:none}.cx-ls .lk{opacity:.7}
.cx-ic{width:34px;height:34px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--bg-2);font-size:15px}.cx-ic.ok{background:color-mix(in srgb,var(--ok) 18%,transparent);color:color-mix(in srgb,var(--ok) 60%,var(--text));font-weight:800}.cx-ls .t{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cx-ls .m{font-size:12.5px;color:var(--muted)}

.cx-top{position:sticky;top:0;z-index:5;background:var(--glass,var(--bg));backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:6px 4px 8px;margin:0 -4px 4px;border-radius:0 0 var(--r-sm) var(--r-sm)}.cx-top .row{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted)}.cx-top a{color:var(--muted);text-decoration:none;min-height:44px;display:inline-flex;align-items:center;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cx-lesson{font-size:17px;line-height:1.95;color:var(--text)}.cx-lesson.rich{word-break:break-word}
.cx-video{display:flex;gap:12px;align-items:center;padding:16px;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:10px 0}.cx-video .pl{width:56px;height:56px;border-radius:50%;flex:none;display:grid;place-items:center;background:var(--accent);color:#fff;font-size:22px}
.cx-q{border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;margin:10px 0;background:var(--card);box-shadow:var(--sh-1)}.cx-q legend{float:left;width:100%;font-weight:800;padding:0;margin:0 0 4px;line-height:1.6}.cx-q legend+*{clear:both}.cx-q label{display:flex;gap:10px;align-items:center;min-height:48px;padding:6px 12px;border-radius:var(--r-sm);border:1px solid var(--line-2);margin:6px 0;cursor:pointer;line-height:1.5}.cx-q label:has(input:checked){border-color:var(--accent);background:var(--accent2)}.cx-q input{width:20px;height:20px;flex:none;accent-color:var(--accent)}
.cx-q label.right{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--card))}.cx-q label.wrong{border-color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,var(--card))}.cx-q .ex{font-size:13.5px;color:var(--text-2);line-height:1.7;padding:8px 12px;border-radius:var(--r-xs);background:var(--bg-2);margin-top:6px}
.cx-res{display:flex;gap:14px;align-items:center;padding:14px;border-radius:var(--r);margin:10px 0;border:1px solid var(--line)}.cx-res.pass{background:color-mix(in srgb,var(--ok) 10%,var(--card));border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}.cx-res.fail{background:color-mix(in srgb,var(--warn) 10%,var(--card));border-color:color-mix(in srgb,var(--warn) 40%,var(--line))}
.cx-mark{width:100%;min-height:52px;font-size:15px}.btn.cx-mark[aria-pressed="true"]{background:color-mix(in srgb,var(--ok) 62%,#000);border-color:color-mix(in srgb,var(--ok) 62%,#000);color:#fff}
.cx-pn{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.cx-pn a,.cx-pn span{min-height:56px;display:flex;flex-direction:column;justify-content:center;padding:6px 12px;border-radius:var(--r-sm);background:var(--bg-2);color:var(--text);text-decoration:none;min-width:0}.cx-pn small{font-size:11.5px;color:var(--muted)}.cx-pn b{font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cx-pn .nx{text-align:end}.cx-pn span{opacity:.5}
.cx-f{display:flex;flex-direction:column;gap:10px}.cx-f label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--text-2)}.cx-f input,.cx-f select,.cx-f textarea{min-height:44px;width:100%;box-sizing:border-box;font-weight:400}.cx-f textarea{min-height:120px;line-height:1.7}
.cx-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cx-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;background:var(--bg-2);border-radius:999px;border:0;margin:0}.cx-seg legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.cx-seg label{flex-direction:row !important;justify-content:center;align-items:center;min-height:44px;border-radius:999px;cursor:pointer;font-size:14px;gap:6px}.cx-seg input{position:absolute;opacity:0;width:1px !important;height:1px}.cx-seg label:has(input:checked){background:var(--card);color:var(--accent-ink);box-shadow:var(--sh-1)}.cx-seg label:has(input:focus-visible){outline:2px solid var(--accent)}
.cx-ed{border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:10px 0;overflow:hidden}.cx-ed .hd{display:flex;gap:6px;align-items:center;padding:10px 12px;background:var(--bg-2);flex-wrap:wrap}.cx-ed .hd b{flex:1 1 60%;min-width:0;line-height:1.5}.cx-ed .hd .cx-mv{margin-inline-start:auto}
.cx-mv{display:flex;gap:4px;flex:none}.cx-mv button{min-width:44px;min-height:44px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--card);color:var(--text-2);cursor:pointer;font-size:15px}.cx-mv button:disabled{opacity:.35;cursor:default}.cx-mv .x{color:var(--danger)}
.cx-el{list-style:none;padding:0;margin:0}.cx-el>li{display:flex;gap:4px 10px;align-items:center;padding:10px 12px;border-top:1px solid var(--line);min-height:56px;flex-wrap:wrap}.cx-el>li>.cx-grow{flex:1 1 calc(100% - 48px)}.cx-el>li>.cx-mv{margin-inline-start:auto}.cx-el .t{font-weight:600;display:block;line-height:1.5}.cx-el .m{font-size:12px;color:var(--muted)}.cx-el>li.form{display:block;background:color-mix(in srgb,var(--accent) 4%,var(--card))}
.cx-qb{border:1px dashed var(--line-2);border-radius:var(--r-sm);padding:10px;margin:6px 0;display:flex;flex-direction:column;gap:8px}.cx-opt{display:flex;gap:8px;align-items:center}.cx-opt input[type=radio]{width:22px !important;height:22px;min-height:0 !important;flex:none;accent-color:var(--ok)}.cx-opt input[type=text]{flex:1}
.cx-k{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}@media(min-width:620px){.cx-k{grid-template-columns:repeat(4,minmax(0,1fr))}}.cx-k div{padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1)}.cx-k b{display:block;font-size:24px;font-weight:800;line-height:1.25}.cx-k span{font-size:12.5px;color:var(--muted)}
.cx-ul{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}.cx-ul li{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);min-height:56px;flex-wrap:wrap}.cx-ul li:last-child{border-bottom:0}.cx-ul .tr{flex-basis:100%}
.cx-av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;flex:none;background:var(--accent)}



</style>`);

  /* =================== #/courses =================== */
  const card = (c, mode) => `<a class="cx-c" href="#/course/${enc(c.id)}"><div class="cx-cv" ${cover(c)}><span aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-cap /></svg></span><span class="lv">${h(c.levelLabel)}</span></div><div class="bd"><b>${h(c.title)}</b>${c.subtitle ? `<span class="m">${h(c.subtitle)}</span>` : ""}
    ${mode === "learn" ? `<div class="cx-bar${c.completed ? " ok" : ""}" aria-hidden="true"><i style="width:${c.progress}%"></i></div><div class="m"><span>${c.completed ? "أتممتها" : `${pc(c.progress)} مكتمل`}</span>${c.resume ? `<span><svg class=ix aria-hidden=true><use href=#i-play /></svg> تابع: ${h(c.resume.title)}</span>` : ""}</div>`
      : mode === "teach" ? `<div class="m"><span class="cx-chip ${c.status === "published" ? "ok" : "draft"}">${c.status === "published" ? "منشورة" : c.status === "archived" ? "مؤرشفة" : "مسودة"}</span><span><svg class=ix aria-hidden=true><use href=#i-users /></svg> ${num(c.enrolled)} متعلم</span></div>`
      : `<div class="m">${c.group ? `<span><svg class=ix aria-hidden=true><use href=#i-book /></svg> ${h(c.group.name)}</span>` : ""}<span>${lessonsN(c.lessons)}</span>${c.minutes ? `<span><svg class=ix aria-hidden=true><use href=#i-clock /></svg> ${mins(c.minutes)}</span>` : ""}<span><svg class=ix aria-hidden=true><use href=#i-users /></svg> ${num(c.enrolled)}</span>${c.access === "product" ? `<span><svg class=ix aria-hidden=true><use href=#i-lock /></svg> ضمن منتج</span>` : `<span>مجانية</span>`}</div>`}</div></a>`;
  async function listView() {
    const q = qs(), group = q.get("group") || "", lvl = q.get("level") || "", text = q.get("q") || "";
    page("الدورات", `<div id="cx-l">${skel(3)}</div>`, group ? ["#/study/" + enc(group), "مجموعة الدراسة"] : null, "دورات قصيرة يقدّمها معلمو مجموعات الدراسة — تعلّم بخطوتك، وتابع من حيث توقفت.");
    let r; try { r = await api("GET", "/api/courses?" + new URLSearchParams({ ...(group ? { group } : {}), ...(lvl ? { level: lvl } : {}), ...(text ? { q: text } : {}) })); } catch (e) { if ($("#cx-l")) $("#cx-l").innerHTML = errBox(e); return; }
    const box = $("#cx-l"); if (!box) return;
    const tab = q.get("tab") || (r.learning.length && !group ? "learn" : "discover");
    const T = [["learn", `أتعلّم${r.learning.length ? ` (${r.learning.length})` : ""}`], ["discover", "اكتشف"], ...(r.teaching.length || group ? [["teach", "أُدرّس"]] : [])];
    const base = (t) => "#/courses?" + new URLSearchParams({ ...(group ? { group } : {}), tab: t });
    let body = "";
    if (tab === "learn") body = r.learning.length ? `<div class="cx-grid">${r.learning.map((c) => card(c, "learn")).join("")}</div>` : `<div class="empty"><b>لم تسجّل في دورة بعد</b>اختر دورة من «اكتشف» وابدأ أول درس اليوم.<br><a class="btn" href="${base("discover")}">اكتشف الدورات</a></div>`;
    else if (tab === "teach") body = `${group ? `<div class="cx-row"><a class="btn sm" href="#/course/new?group=${enc(group)}"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>دورة جديدة في هذه المجموعة</a></div>` : `<p class="cx-sub">لإنشاء دورة افتح مجموعتك الدراسية ثم «الدورات».</p>`}${r.teaching.length ? `<div class="cx-grid">${r.teaching.map((c) => card(c, "teach")).join("")}</div>` : `<div class="empty"><b>لا دورات بعد</b>حوّل خبرتك إلى دروس قصيرة واختبارات تساعد طلابك على التقدّم.</div>`}`;
    else body = `<form class="cx-search fx-host" id="cx-sf" role="search"><input type="search" name="q" value="${h(text)}" maxlength="60" placeholder="ابحث عن دورة" aria-label="ابحث عن دورة"><button class="btn" aria-label="بحث"><svg class=ix aria-hidden=true><use href=#i-search /></svg></button></form>
      <nav class="cx-chips f-chips" aria-label="المستوى"><a class="chip f" data-fx-all href="${base("discover")}" ${!lvl ? 'aria-current="true"' : ""}>كل المستويات</a>${Object.entries(LEVEL).filter(([k]) => k !== "all").map(([k, l]) => `<a class="chip f" href="${base("discover")}&level=${k}" ${lvl === k ? 'aria-current="true"' : ""}>${l}</a>`).join("")}</nav>
      ${r.courses.length ? `<div class="cx-grid">${r.courses.map((c) => card(c)).join("")}</div>` : `<div class="empty"><b>لا دورات مطابقة</b>${group ? "لم تُنشر دورات في هذه المجموعة بعد." : "جرّب كلمة أخرى أو مستوى مختلفاً."}</div>`}`;
    box.innerHTML = `<nav class="cx-tabs seg" aria-label="الدورات">${T.map(([k, l]) => `<a href="${base(k)}" ${k === tab ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>${body}`;
    { const sf = $("#cx-sf"); if (sf && window.MPFeat) MPFeat.filters({ host: sf, move: [view.querySelector(".cx-chips")], title: "المستوى" }); }
    $("#cx-sf")?.addEventListener("submit", (e) => { e.preventDefault(); const v = e.target.q.value.trim(); location.hash = base("discover") + (lvl ? `&level=${lvl}` : "") + (v ? `&q=${enc(v)}` : ""); });
  }
  function newView() {
    const group = qs().get("group");
    if (!signed() || !group) { page("دورة جديدة", `<div class="empty">افتح مجموعتك الدراسية ثم اختر «الدورات» لإنشاء دورة.</div>`, ["#/study", "مجموعات الدراسة"]); return; }
    page("دورة جديدة", `<form class="cx-f" id="cx-nf"><label>عنوان الدورة<input name="title" required minlength="3" maxlength="100" placeholder="مثال: أساسيات التجويد"></label><label>وصف قصير<input name="subtitle" maxlength="160" placeholder="ماذا سيتعلّم الطالب؟"></label>
      <label>المستوى<select name="level">${Object.entries(LEVEL).map(([k, l]) => `<option value="${k}" ${k === "all" ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>عن الدورة<textarea name="descr" maxlength="4000" placeholder="لمن الدورة، ومتطلباتها، وما الذي ستنجزه بنهايتها"></textarea></label><label>اسم الوحدة الأولى<input name="firstModule" maxlength="80" value="الوحدة الأولى"></label>
      <div class="cx-row"><button class="btn" type="submit">إنشاء والانتقال لإضافة الدروس</button></div></form>`, ["#/courses?group=" + enc(group) + "&tab=teach", "الدورات"], "تبدأ الدورة مسودة لا يراها الطلاب حتى تنشرها.");
    $("#cx-nf").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { const r = await api("POST", "/api/courses", { communityId: group, title: f.title.value.trim(), subtitle: f.subtitle.value.trim(), level: f.level.value, descr: f.descr.value.trim(), firstModule: f.firstModule.value.trim() }); location.hash = `#/course/${enc(r.course.id)}/edit`; say("✓ أُنشئت الدورة — أضف أول درس"); } catch (x) { say(x.message); } });
  }

  /* =================== #/course/:id =================== */
  async function courseView(id) {
    page("…", `<div id="cx-c">${skel(3)}</div>`, ["#/courses", "الدورات"]);
    let d; try { d = await api("GET", "/api/courses/" + enc(id)); } catch (e) { if ($("#cx-c")) $("#cx-c").innerHTML = errBox(e); return; }
    const box = $("#cx-c"); if (!box) return;
    const c = d.course, me = d.me; const hd = $("#cx-h"); if (hd) { hd.textContent = c.title; srOnly(hd); }
    const back = view.querySelector(".cx-back"); if (back) { back.href = "#/courses?group=" + enc(d.group.id); back.textContent = "→ دورات " + d.group.name; }
    const canOpen = me.enrolled || me.manager;
    box.innerHTML = `<section class="cx-hero" aria-labelledby="cx-t"><div class="cx-cv" ${cover(c)}><span class="lv" style="font-size:12px;font-weight:700;background:#0005;padding:3px 10px;border-radius:999px">${h(c.levelLabel)}${c.status !== "published" ? ` · ${c.status === "draft" ? "مسودة" : "مؤرشفة"}` : ""}</span><h1 id="cx-t">${h(c.title)}</h1>${c.subtitle ? `<span class="st">${h(c.subtitle)}</span>` : ""}</div>
      <div class="bd"><p class="u-m0 u-mb8 cx-sub">${c.author ? `بإشراف <a href="#/u/${enc(c.author.handle)}" style="color:var(--accent-ink);font-weight:700">${h(c.author.name)}</a> · ` : ""}<a href="#/study/${enc(d.group.id)}" class="u-ci"><svg class=ix aria-hidden=true><use href=#i-book /></svg> ${h(d.group.name)}</a></p>
        <div class="cx-stats"><div><b>${num(c.lessons)}</b><span>درس</span></div><div><b>${mins(c.minutes)}</b><span>المدة</span></div><div><b>${num(c.quizzes)}</b><span>اختبار</span></div><div><b>${num(c.enrolled)}</b><span>متعلم</span></div></div>
        ${me.manager ? `<div class="cx-row"><a class="btn" href="#/course/${enc(id)}/edit"><svg class=ix aria-hidden=true><use href=#i-pen /></svg> تعديل المحتوى</a><a class="btn ghost" href="#/course/${enc(id)}/learners"><svg class=ix aria-hidden=true><use href=#i-users /></svg> المتعلمون</a></div>` : ""}</div></section>
      <div id="cx-me">${meCard(d)}</div>
      ${c.descr ? `<h3>عن الدورة</h3><div class="u-t-md rich cx-lesson">${md(c.descr)}</div>` : ""}
      <h3>محتوى الدورة</h3>${d.outline.filter((m) => m.lessons.length).length ? d.outline.map((m, i) => !m.lessons.length ? "" : `<details class="cx-mod" ${i < 2 || m.done < m.total ? "open" : ""}><summary><b>${h(m.title)}</b><span class="n">${me.enrolled ? `<bdi dir="ltr">${m.done}/${m.total}</bdi> مكتمل` : lessonsN(m.lessons.length)}</span></summary><ol class="cx-ls">${m.lessons.map((l) => { const inner = `<span class="cx-ic ${l.done ? "ok" : ""}" aria-hidden="true">${l.done ? "✓" : KIND[l.kind][0]}</span><span class="cx-grow"><span class="t">${h(l.title)}</span><span class="m">${KIND[l.kind][1]} · ${mins(l.minutes)}${l.kind === "quiz" && l.score !== null ? ` · أفضل نتيجة ${pc(l.score)}` : ""}${l.status === "draft" ? " · مسودة" : ""}${l.done ? " · مكتمل" : ""}</span></span>`; return `<li>${canOpen ? `<a href="#/course/${enc(id)}/learn/${enc(l.id)}">${inner}</a>` : `<span class="lk" aria-label="${h(l.title)} — سجّل لفتحه">${inner}<span aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-lock /></svg></span></span>`}</li>`; }).join("")}</ol></details>`).join("") : `<div class="empty"><b>لا دروس بعد</b>${me.manager ? `أضف أول درس من صفحة التعديل.<br><a class="btn" href="#/course/${enc(id)}/edit"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>إضافة درس</a>` : "ستظهر الدروس هنا قريباً."}</div>`}
      ${me.enrolled && !me.completed ? `<p class="u-mt18"><button type="button" class="u-mh44 btn ghost" id="cx-leave">مغادرة الدورة</button></p>` : ""}`;
    wireMe(d);
    $("#cx-leave")?.addEventListener("click", async () => { if (!confirm("مغادرة الدورة؟ يبقى تقدّمك محفوظاً إن عدت.")) return; try { await api("DELETE", `/api/courses/${enc(id)}/enrol`); courseView(id); } catch (x) { say(x.message); } });
  }
  function meCard(d) {
    const me = d.me, c = d.course;
    if (me.completed) return `<div class="cx-done" role="status"><div class="cx-grow"><b>أتممت الدورة — مبارك!</b><div class="u-m0 u-mt2 cx-sub">${me.completion ? `${num(me.completion.lessons)} دروس${me.completion.avgQuiz !== null ? ` · متوسط الاختبارات ${pc(me.completion.avgQuiz)}` : ""} · ${rel(me.completedAt)}` : ""}</div></div><a class="u-mh44 u-fn btn" href="#/certificates">شهادتك</a></div>${me.progress < 100 && me.resume ? `<div class="cx-row"><a class="btn ghost" href="#/course/${enc(c.id)}/learn/${enc(me.resume.id)}">درس جديد: ${h(me.resume.title)}</a></div>` : ""}`;
    if (me.enrolled) return `<div class="cx-me">${ring(me.progress)}<div class="cx-grow"><b>${me.progress ? "تقدّمك في الدورة" : "مرحباً بك في الدورة"}</b><div class="u-m0 u-mt2 u-mb6 cx-sub">${me.resume ? `التالي: ${h(me.resume.title)}` : ""}</div>${me.resume ? `<a class="btn" href="#/course/${enc(c.id)}/learn/${enc(me.resume.id)}">${me.progress ? "تابع التعلّم" : "ابدأ أول درس"}</a>` : ""}</div></div>`;
    if (me.manager && !me.enrolled) return `<div class="cx-me"><span class="u-t-num" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-cap /></svg></span><div class="cx-grow"><b>أنت من معلمي هذه الدورة</b><div class="u-m0 u-mt2 cx-sub">تستطيع فتح كل الدروس للمعاينة؛ تقدّم الطلاب يظهر في «المتعلمون».</div></div></div>`;
    if (me.locked) return `<div class="cx-me"><span class="u-t-num" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-lock /></svg></span><div class="cx-grow"><b>الدورة ضمن منتج رقمي</b><div class="u-m0 u-mt2 cx-sub">تُفتح بعد شراء المنتج من متجر المنشئ عند تفعيل مدفوعات Pi.</div></div></div>`;
    if (me.canEnrol) return `<div class="cx-me"><span class="u-t-num" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-rocket /></svg></span><div class="cx-grow"><b>${c.access === "free" ? "دورة مجانية" : "متاحة لك"}</b><div class="u-m0 u-mt2 u-mb6 cx-sub">سجّل لتتبّع تقدّمك وتكمل من حيث توقفت.</div><button type="button" class="btn" id="cx-enrol">سجّل في الدورة</button></div></div>`;
    if (!signed()) return `<div class="cx-me"><div class="cx-grow"><b>سجّل الدخول للتسجيل في الدورة</b></div></div>`;
    return "";
  }
  function wireMe(d) {
    $("#cx-enrol")?.addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const r = await api("POST", `/api/courses/${enc(d.course.id)}/enrol`); say("✓ سُجّلت في الدورة"); const box = $("#cx-me"); if (box) { box.innerHTML = meCard(r); wireMe(r); } courseView(d.course.id); }
      catch (x) { say(x.message); b.disabled = false; }
    });
  }

  /* =================== lesson player =================== */
  async function lessonView(cid, lid) {
    page("…", `<div id="cx-lv">${skel(3)}</div>`, ["#/course/" + enc(cid), "الدورة"]);
    let d; try { d = await api("GET", "/api/course-lessons/" + enc(lid)); } catch (e) { if ($("#cx-lv")) $("#cx-lv").innerHTML = e.code === "not_enrolled" ? `<div class="empty"><b>سجّل في الدورة أولاً</b><a class="btn" href="#/course/${enc(cid)}">صفحة الدورة</a></div>` : errBox(e); return; }
    const box = $("#cx-lv"); if (!box) return;
    const L = d.lesson, me = d.me;
    const back = view.querySelector(".cx-back"); back?.remove();
    const hd = $("#cx-h"); if (hd) { hd.textContent = L.title; hd.style.cssText = "font-size:21px"; }
    hd?.insertAdjacentHTML("beforebegin", `<div class="cx-top"><div class="row"><a href="#/course/${enc(cid)}">→ ${h(d.course.title)}</a><span class="u-nw">درس ${num(d.index)} من ${num(d.total)}</span></div>${me.enrolled ? `<div class="cx-bar" role="progressbar" aria-label="تقدّمك في الدورة" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${me.progress}"><i id="cx-pb" style="width:${me.progress}%"></i></div>` : ""}</div>`);
    hd?.insertAdjacentHTML("afterend", `<p class="cx-sub">${KIND[L.kind][0]} ${KIND[L.kind][1]} · ${h(d.module.title)} · ${mins(L.minutes)}${L.status === "draft" ? " · مسودة (للمعلمين فقط)" : ""}</p>`);
    let body = "";
    if (L.kind === "video") body = `<div class="cx-video"><span class="pl" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-play /></svg></span><div class="cx-grow"><b>شاهد الفيديو</b><div class="u-m0 u-mt2 u-mb8 cx-sub">يفتح على ${h(L.videoHost || "موقع الفيديو")} في نافذة جديدة. عد هنا بعد المشاهدة.</div><a class="btn" href="${h(L.videoUrl)}" target="_blank" rel="noopener noreferrer">فتح الفيديو</a></div></div>`;
    if (L.body) body += `<div class="rich cx-lesson">${md(L.body)}</div>`;
    if (L.kind === "quiz") body += quizHtml(L, me);
    box.innerHTML = `${body}<div id="cx-act" class="u-mt16">${L.kind !== "quiz" && me.enrolled ? `<button type="button" class="btn cx-mark" id="cx-done" aria-pressed="${me.done}">${me.done ? "✓ أتممت هذا الدرس" : "أتممت الدرس ✓"}</button>` : ""}</div>
      <nav class="cx-pn" aria-label="التنقل بين الدروس">${d.prev ? `<a href="#/course/${enc(cid)}/learn/${enc(d.prev.id)}"><small>→ السابق</small><b>${h(d.prev.title)}</b></a>` : `<span><small>→ السابق</small><b>بداية الدورة</b></span>`}${d.next ? `<a class="nx" href="#/course/${enc(cid)}/learn/${enc(d.next.id)}"><small>التالي ←</small><b>${h(d.next.title)}</b></a>` : `<a class="nx" href="#/course/${enc(cid)}"><small>انتهت الدروس</small><b>صفحة الدورة</b></a>`}</nav><div id="cx-fin"></div>`;
    $("#cx-done")?.addEventListener("click", async (e) => {
      const b = e.currentTarget, undo = b.getAttribute("aria-pressed") === "true"; b.disabled = true;
      try { const r = await api("POST", `/api/course-lessons/${enc(lid)}/complete`, undo ? { undo: true } : {}); b.setAttribute("aria-pressed", String(!undo)); b.textContent = undo ? "أتممت الدرس ✓" : "✓ أتممت هذا الدرس"; progress(r); if (!undo && !r.completedNow && d.next) say("أحسنت! انتقل للدرس التالي ←"); }
      catch (x) { say(x.message); } finally { b.disabled = false; }
    });
    wireQuiz(L, lid, d);
    function progress(r) { const pb = $("#cx-pb"); if (pb && r.progress !== undefined) { pb.style.width = r.progress + "%"; pb.parentElement.setAttribute("aria-valuenow", r.progress); } if (r.completedNow) { const f = $("#cx-fin"); if (f) f.innerHTML = `<div class="cx-done" role="status"><div class="cx-grow"><b>أتممت الدورة كاملة!</b><div class="u-m0 u-mt2 u-mb6 cx-sub">عمل رائع — سُجّل إتمامك.</div><a class="btn" href="#/course/${enc(cid)}">عرض الإنجاز</a></div></div>`; f?.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }
    lessonView.progress = progress;
  }
  function quizHtml(L, me) {
    const qz = L.quiz?.questions || [];
    const qn = qz.length === 1 ? "سؤال واحد" : qz.length === 2 ? "سؤالان" : qz.length <= 10 ? `${num(qz.length)} أسئلة` : `${num(qz.length)} سؤالاً`;
    return `<div class="u-my10 cx-sub">${qn} · النجاح من ${pc(L.passPct)}${me.bestScore !== null ? ` · أفضل نتيجة لك ${pc(me.bestScore)}` : ""}${me.done ? " · ✓ اجتزته" : ""}</div>
      <form id="cx-qf">${qz.map((q, i) => `<fieldset class="cx-q" data-q="${i}"><legend>${num(i + 1)}. ${h(q.q)}</legend>${q.options.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}" ${me.manager && q.answer === j ? "checked" : ""}> <span>${h(o)}</span></label>`).join("")}${me.manager && q.explain ? `<div class="ex"><svg class=ix aria-hidden=true><use href=#i-bulb /></svg> ${h(q.explain)}</div>` : ""}</fieldset>`).join("")}
      ${me.enrolled ? `<button class="btn cx-mark" type="submit">تسليم الإجابات</button>` : me.manager ? `<p class="cx-sub">معاينة المعلم: الإجابات الصحيحة محددة.</p>` : ""}</form><div id="cx-qr" aria-live="polite"></div>`;
  }
  function wireQuiz(L, lid, d) {
    const f = $("#cx-qf"); if (!f || !d.me.enrolled) return;
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const qz = L.quiz.questions, ans = qz.map((_, i) => f.querySelector(`input[name=q${i}]:checked`)?.value);
      const miss = ans.findIndex((a) => a === undefined); if (miss >= 0) { say(`أجب عن السؤال ${miss + 1}`); f.querySelector(`[data-q="${miss}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const r = await api("POST", `/api/course-lessons/${enc(lid)}/quiz`, { answers: ans.map(Number) });
        if (!f.isConnected) return; /* stale-route guard (fast navigation) */
        r.results.forEach((x, i) => { const fs = f.querySelector(`[data-q="${i}"]`); fs.querySelectorAll("label").forEach((lb, j) => { lb.classList.toggle("right", j === x.answer); lb.classList.toggle("wrong", j === x.chosen && !x.correct); }); fs.querySelector(".ex")?.remove(); if (x.explain) fs.insertAdjacentHTML("beforeend", `<div class="ex">${x.correct ? "" : ""} ${h(x.explain)}</div>`); });
        $("#cx-qr").innerHTML = `<div class="cx-res ${r.passed ? "pass" : "fail"}" role="status">${ring(r.score, 60)}<div class="cx-grow"><b>${r.passed ? "اجتزت الاختبار" : "قريب! راجع الإجابات وحاول مجدداً"}</b><div class="u-m0 u-mt2 u-mb6 cx-sub">النجاح من ${pc(r.passPct)} · المحاولات المتبقية اليوم: ${num(Math.max(0, r.attemptsLeft))}</div>${!r.passed && r.attemptsLeft > 0 ? `<button type="button" class="btn ghost" id="cx-retry">إعادة المحاولة</button>` : r.passed && d.next ? `<a class="btn" href="#/course/${enc(d.course.id)}/learn/${enc(d.next.id)}">الدرس التالي ←</a>` : ""}</div></div>`;
        $("#cx-qr").scrollIntoView({ block: "nearest", behavior: "smooth" });
        btn.hidden = true; lessonView.progress?.(r);
        $("#cx-retry")?.addEventListener("click", () => { f.querySelectorAll("label").forEach((lb) => lb.classList.remove("right", "wrong")); f.querySelectorAll(".ex").forEach((x) => x.remove()); f.querySelectorAll("input").forEach((i) => { i.checked = false; }); const qr = $("#cx-qr"); if (qr) qr.innerHTML = ""; btn.hidden = false; btn.disabled = false; f.querySelector("fieldset")?.scrollIntoView({ block: "start", behavior: "smooth" }); });
      } catch (x) { say(x.message); if (f.isConnected) btn.disabled = false; }
    });
  }

  /* =================== authoring =================== */
  function lessonForm(l = {}, mods = [], modId) {
    const kind = l.kind || "text", qz = l.quiz?.questions?.length ? l.quiz.questions : [{ q: "", options: ["", ""], answer: 0, explain: "" }];
    return `<form class="u-p12 cx-f" data-lf="${h(l.id || "")}" novalidate>
      <fieldset class="cx-seg"><legend>نوع الدرس</legend>${Object.entries(KIND).map(([k, [ic, lb]]) => `<label><input type="radio" name="kind" value="${k}" ${k === kind ? "checked" : ""}>${ic} ${lb}</label>`).join("")}</fieldset>
      <label>عنوان الدرس<input name="title" required maxlength="120" value="${h(l.title || "")}"></label>
      <div class="cx-two"><label>المدة (دقائق)<input name="minutes" type="number" min="1" max="600" inputmode="numeric" value="${l.minutes || 5}"></label>${l.id && mods.length > 1 ? `<label>الوحدة<select name="moduleId">${mods.map((m) => `<option value="${h(m.id)}" ${m.id === modId ? "selected" : ""}>${h(m.title)}</option>`).join("")}</select></label>` : `<label>الحالة<select name="status"><option value="published" ${l.status !== "draft" ? "selected" : ""}>منشور</option><option value="draft" ${l.status === "draft" ? "selected" : ""}>مسودة</option></select></label>`}</div>
      <label data-k="video" ${kind === "video" ? "" : "hidden"}>رابط الفيديو (https)<input name="videoUrl" type="url" dir="ltr" maxlength="400" value="${h(l.videoUrl || "")}" placeholder="https://www.youtube.com/watch?v=…"></label>
      <label data-k="body"><span data-bl>${kind === "text" ? "محتوى الدرس" : "ملاحظات (اختياري)"}</span><textarea name="body" maxlength="30000" placeholder="اكتب بـ Markdown بسيط: ## عنوان، **غامق**، - قائمة">${h(l.body || "")}</textarea></label>
      <div data-k="quiz" ${kind === "quiz" ? "" : "hidden"}><div class="cx-qs">${qz.map((q, i) => qBlock(q, i)).join("")}</div><div class="cx-row"><button type="button" class="btn ghost" data-addq><svg class=ix aria-hidden=true><use href=#i-plus /></svg>سؤال</button><label style="flex-direction:row;align-items:center;gap:8px;margin:0">النجاح من<input name="passPct" type="number" min="0" max="100" inputmode="numeric" value="${l.passPct ?? ""}" placeholder="70" style="width:90px">%</label></div></div>
      <div class="cx-row"><button class="btn" type="submit">${l.id ? "حفظ الدرس" : "إضافة الدرس"}</button><button class="btn ghost" type="button" data-cl>إلغاء</button></div></form>`;
  }
  const qBlock = (q, i) => `<div class="cx-qb" data-qi="${i}"><div class="u-m0 cx-row"><b class="cx-grow">السؤال ${i + 1}</b><button type="button" class="u-mh44 u-c-dg btn ghost" data-rmq aria-label="حذف السؤال ${i + 1}">✕</button></div><input type="text" data-qq maxlength="300" value="${h(q.q)}" placeholder="نص السؤال" aria-label="نص السؤال ${i + 1}">
    <div data-opts>${q.options.map((o, j) => optRow(i, j, o, q.answer === j)).join("")}</div><button type="button" class="btn ghost" data-addo style="min-height:44px;align-self:flex-start"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>خيار</button><input type="text" data-qe maxlength="400" value="${h(q.explain || "")}" placeholder="شرح الإجابة (اختياري)" aria-label="شرح إجابة السؤال ${i + 1}"></div>`;
  const optRow = (i, j, o, on) => `<div class="cx-opt"><input type="radio" name="ans${i}" value="${j}" ${on ? "checked" : ""} aria-label="الإجابة الصحيحة: الخيار ${j + 1}"><input type="text" data-o maxlength="160" value="${h(o)}" placeholder="الخيار ${j + 1}" aria-label="الخيار ${j + 1}"></div>`;
  function wireLessonForm(f, cid, done) {
    const sync = () => { const k = f.querySelector("input[name=kind]:checked").value; f.querySelector('[data-k="video"]').hidden = k !== "video"; f.querySelector('[data-k="quiz"]').hidden = k !== "quiz"; f.querySelector("[data-bl]").textContent = k === "text" ? "محتوى الدرس" : "ملاحظات (اختياري)"; };
    f.addEventListener("change", (e) => { if (e.target.name === "kind") sync(); });
    f.addEventListener("click", (e) => {
      if (e.target.closest("[data-cl]")) return done(null);
      if (e.target.closest("[data-addq]")) { const box = f.querySelector(".cx-qs"), i = box.children.length; if (i >= 30) return; box.insertAdjacentHTML("beforeend", qBlock({ q: "", options: ["", ""], answer: 0 }, i)); box.lastElementChild.querySelector("[data-qq]").focus(); }
      const qb = e.target.closest(".cx-qb"); if (!qb) return;
      if (e.target.closest("[data-rmq]")) { if (f.querySelectorAll(".cx-qb").length > 1) qb.remove(); }
      if (e.target.closest("[data-addo]")) { const o = qb.querySelector("[data-opts]"); if (o.children.length < 6) { o.insertAdjacentHTML("beforeend", optRow(+qb.dataset.qi, o.children.length, "", false)); o.lastElementChild.querySelector("[data-o]").focus(); } }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const k = f.querySelector("input[name=kind]:checked").value, b = { kind: k, title: f.title.value.trim(), minutes: +f.minutes.value || 5, body: f.body.value, videoUrl: f.videoUrl.value.trim() || null };
      if (f.status) b.status = f.status.value; if (f.moduleId) b.moduleId = f.moduleId.value;
      if (k === "quiz") { b.quiz = { questions: [...f.querySelectorAll(".cx-qb")].map((qb) => { const opts = [...qb.querySelectorAll("[data-o]")]; return { q: qb.querySelector("[data-qq]").value.trim(), options: opts.map((o) => o.value.trim()), answer: +(qb.querySelector("input[type=radio]:checked")?.value ?? -1), explain: qb.querySelector("[data-qe]").value.trim() }; }) }; b.passPct = f.passPct.value === "" ? null : +f.passPct.value; }
      if (!b.title) { say("اكتب عنوان الدرس"); f.title.focus(); return; }
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
      try { await done(b); } catch (x) { say(x.message); } finally { btn.disabled = false; }
    });
  }
  async function editView(id) {
    page("تعديل الدورة", `<div id="cx-e">${skel(3)}</div>`, ["#/course/" + enc(id), "صفحة الدورة"]);
    let d; try { d = await api("GET", "/api/courses/" + enc(id)); } catch (e) { if ($("#cx-e")) $("#cx-e").innerHTML = errBox(e); return; }
    const box = $("#cx-e"); if (!box) return;
    if (!d.me.manager) { box.innerHTML = `<div class="empty">التعديل لمعلمي المجموعة فقط.</div>`; return; }
    const c = d.course; let outline = d.outline;
    const hd = $("#cx-h"); if (hd) hd.textContent = "" + c.title;
    box.innerHTML = `<div class="u-fww u-g10 cx-me" id="cx-pubbar"></div>
      <details class="cx-ed"><summary class="u-cp u-mh44 u-lsn hd"><b><svg class=ix aria-hidden=true><use href=#i-settings /></svg> تفاصيل الدورة</b></summary><form class="u-p12 cx-f" id="cx-df"><label>العنوان<input name="title" maxlength="100" value="${h(c.title)}"></label><label>وصف قصير<input name="subtitle" maxlength="160" value="${h(c.subtitle)}"></label><div class="cx-two"><label>المستوى<select name="level">${Object.entries(LEVEL).map(([k, l]) => `<option value="${k}" ${k === c.level ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>درجة النجاح الافتراضية<input name="passPct" type="number" min="0" max="100" value="${c.passPct}"></label></div><label>عن الدورة<textarea name="descr" maxlength="4000">${h(c.descr)}</textarea></label><p class="u-m0 cx-sub">الوصول: ${c.access === "product" ? "ضمن منتج رقمي" : "مجانية لأعضاء المجموعة"}.</p><div class="cx-row"><button class="btn" type="submit">حفظ التفاصيل</button></div></form></details>
      <h3>الوحدات والدروس</h3><div id="cx-ol"></div><div class="cx-row"><button type="button" class="btn ghost" id="cx-addm"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>وحدة جديدة</button></div>`;
    const pubbar = () => { const pb = $("#cx-pubbar"); if (!pb) return; /* stale-route guard (fast navigation) */ const n = outline.reduce((t, m) => t + m.lessons.length, 0); pb.innerHTML = `<div style="flex:1 1 100%;display:flex;gap:8px;align-items:center"><span class="u-t-sm cx-chip ${c.status === "published" ? "ok" : "draft"}">${c.status === "published" ? "● منشورة" : c.status === "archived" ? "مؤرشفة" : "مسودة — لا يراها الطلاب"}</span><span class="u-m0 cx-sub">${lessonsN(n)}</span></div>${c.status !== "published" ? `<button type="button" class="btn" data-pub="published" ${n ? "" : "disabled"}>نشر الدورة</button>` : `<button type="button" class="btn ghost" data-pub="draft">إرجاع لمسودة</button>`}<a class="btn ghost" href="#/course/${enc(id)}">معاينة</a>`; };
    const draw = () => {
      pubbar();
      const ol = $("#cx-ol"); if (!ol) return; /* stale-route guard (fast navigation) */
      ol.innerHTML = outline.map((m, mi) => `<section class="cx-ed" data-m="${h(m.id)}"><div class="hd"><b>${h(m.title)}</b><span class="cx-mv"><button type="button" data-mm="up" ${mi ? "" : "disabled"} aria-label="تقديم الوحدة ${h(m.title)}">↑</button><button type="button" data-mm="down" ${mi < outline.length - 1 ? "" : "disabled"} aria-label="تأخير الوحدة ${h(m.title)}">↓</button><button type="button" data-mr aria-label="إعادة تسمية الوحدة ${h(m.title)}">✎</button><button type="button" class="x" data-md aria-label="حذف الوحدة ${h(m.title)}">✕</button></span></div>
        <ul class="cx-el">${m.lessons.map((l, li) => `<li data-l="${h(l.id)}"><span class="cx-ic" aria-hidden="true">${KIND[l.kind][0]}</span><span class="cx-grow"><span class="t">${h(l.title)}</span><span class="m">${KIND[l.kind][1]} · ${mins(l.minutes)}${l.status === "draft" ? " · مسودة" : ""}</span></span><span class="cx-mv"><button type="button" data-lm="up" ${mi || li ? "" : "disabled"} aria-label="تقديم ${h(l.title)}">↑</button><button type="button" data-lm="down" ${mi < outline.length - 1 || li < m.lessons.length - 1 ? "" : "disabled"} aria-label="تأخير ${h(l.title)}">↓</button><button type="button" data-le aria-label="تعديل ${h(l.title)}">✎</button><button type="button" class="x" data-ld aria-label="حذف ${h(l.title)}">✕</button></span></li>`).join("")}
        <li><button type="button" class="u-mh44 btn ghost" data-addl><svg class=ix aria-hidden=true><use href=#i-plus /></svg>درس في «${h(m.title)}»</button></li></ul></section>`).join("") || `<div class="empty">لا وحدات.</div>`;
    };
    draw();
    const apply = (r) => { if (r?.outline) outline = r.outline; draw(); };
    box.addEventListener("click", async (e) => {
      const t = e.target.closest("button"); if (!t || t.disabled) return;
      if (t.dataset.pub) { try { const r = await api("PATCH", "/api/courses/" + enc(id), { status: t.dataset.pub }); c.status = r.course.status; pubbar(); say(c.status === "published" ? "نُشرت الدورة" : "أُعيدت مسودة"); } catch (x) { say(x.message); } return; }
      if (t.id === "cx-addm") { const n = prompt("اسم الوحدة الجديدة"); if (!n) return; try { apply(await api("POST", `/api/courses/${enc(id)}/modules`, { title: n })); } catch (x) { say(x.message); } return; }
      const sec = t.closest("[data-m]"); if (!sec) return; const mid = sec.dataset.m, li = t.closest("[data-l]");
      try {
        if (t.dataset.mm) apply(await api("POST", `/api/courses/${enc(id)}/move`, { moduleId: mid, dir: t.dataset.mm }));
        else if (t.hasAttribute("data-mr")) { const n = prompt("اسم الوحدة", outline.find((m) => m.id === mid)?.title); if (n) apply(await api("PATCH", "/api/course-modules/" + enc(mid), { title: n })); }
        else if (t.hasAttribute("data-md")) { if (confirm("حذف الوحدة؟")) apply(await api("DELETE", "/api/course-modules/" + enc(mid))); }
        else if (t.dataset.lm) { apply(await api("POST", `/api/courses/${enc(id)}/move`, { lessonId: li.dataset.l, dir: t.dataset.lm })); view.querySelector(`[data-l="${CSS.escape(li.dataset.l)}"] [data-lm="${t.dataset.lm}"]:not(:disabled)`)?.focus(); }
        else if (t.hasAttribute("data-ld")) { if (confirm("حذف الدرس؟ يُزال من تقدّم الطلاب.")) apply(await api("DELETE", "/api/course-lessons/" + enc(li.dataset.l))); }
        else if (t.hasAttribute("data-addl") || t.hasAttribute("data-le")) {
          view.querySelectorAll(".cx-el>li.form").forEach((x) => x.remove());
          let l = {}; if (li) { const full = await api("GET", "/api/course-lessons/" + enc(li.dataset.l)); l = { ...full.lesson }; }
          const host = li || t.closest("li"); host.insertAdjacentHTML(li ? "afterend" : "beforebegin", `<li class="form">${lessonForm(l, outline, mid)}</li>`);
          const f = (li ? host.nextElementSibling : host.previousElementSibling).querySelector("form"); f.title.focus();
          wireLessonForm(f, id, async (b) => { if (!b) { f.closest("li").remove(); return; } const r = l.id ? await api("PATCH", "/api/course-lessons/" + enc(l.id), b) : await api("POST", `/api/courses/${enc(id)}/lessons`, { ...b, moduleId: mid }); apply(r); say(l.id ? "✓ حُفظ الدرس" : "✓ أُضيف الدرس"); });
        }
      } catch (x) { say(x.message); }
    });
    $("#cx-df").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { const r = await api("PATCH", "/api/courses/" + enc(id), { title: f.title.value.trim(), subtitle: f.subtitle.value.trim(), level: f.level.value, passPct: +f.passPct.value, descr: f.descr.value }); Object.assign(c, r.course); if ($("#cx-h")) $("#cx-h").textContent = "" + c.title; say("✓ حُفظت التفاصيل"); } catch (x) { say(x.message); } });
  }
  async function learnersView(id) {
    page("المتعلمون", `<div id="cx-lr">${skel(3)}</div>`, ["#/course/" + enc(id), "صفحة الدورة"]);
    let d; try { d = await api("GET", `/api/courses/${enc(id)}/learners`); } catch (e) { if ($("#cx-lr")) $("#cx-lr").innerHTML = errBox(e); return; }
    const box = $("#cx-lr"); if (!box) return;
    const S = d.summary; const hd = $("#cx-h"); if (hd) hd.textContent = "" + d.course.title;
    box.innerHTML = `<div class="cx-k"><div><b>${num(S.learners)}</b><span>متعلم</span></div><div><b>${num(S.completed)}</b><span>أتمّوا الدورة</span></div><div><b>${pc(S.avgProgress)}</b><span>متوسط التقدّم</span></div><div><b>${num(S.active7d)}</b><span>نشطون هذا الأسبوع</span></div></div>
      <h3>الإتمام في كل درس</h3>${d.funnel.length ? `<ul class="cx-ul">${d.funnel.map((f) => `<li><span class="cx-ic" aria-hidden="true">${KIND[f.kind][0]}</span><span class="cx-grow"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${num(f.index)}. ${h(f.title)}</b><span class="u-m0 cx-sub">${num(f.done)} أتمّوه${f.avgScore !== null ? ` · متوسط ${pc(f.avgScore)}` : ""}</span></span><b>${pc(f.pct)}</b><div class="cx-bar tr" aria-hidden="true"><i style="width:${f.pct}%"></i></div></li>`).join("")}</ul>` : `<div class="empty">لا دروس منشورة.</div>`}
      <h3>المتعلمون</h3>${d.learners.length ? `<ul class="cx-ul">${d.learners.map((u) => `<li><span class="cx-av" style="background:${h(u.color || "var(--accent)")}" aria-hidden="true">${h((u.name || "?").slice(0, 1))}</span><span class="cx-grow"><b>${h(u.name)}</b>${u.completed ? ` <span class="cx-chip sbadge ok"><svg class=ix aria-hidden=true><use href=#i-cap /></svg> أتمّ</span>` : ""}<span class="u-db u-m0 cx-sub">آخر نشاط ${rel(u.lastAt)}${u.quizAvg !== null ? ` · الاختبارات ${pc(u.quizAvg)}` : ""}</span></span><b>${pc(u.progress)}</b><div class="cx-bar tr${u.completed ? " ok" : ""}" aria-hidden="true"><i style="width:${u.progress}%"></i></div></li>`).join("")}</ul>` : `<div class="empty"><b>لا متعلمين بعد</b>شارك رابط الدورة مع طلاب مجموعتك.</div>`}`;
  }

  MPRoutes.extend((a, b) => ({ courses: () => listView(),
    course: () => (a === "new" ? newView() : b === "edit" ? editView(a) : b === "learners" ? learnersView(a) : b === "learn" ? lessonView(a, location.hash.split("?")[0].split("/")[4]) : courseView(a)) }));
  window.MPCourses = { listView, courseView, lessonView, editView, learnersView, newView, version: "__APP_VERSION__" };
  if (/^#\/(courses|course)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
