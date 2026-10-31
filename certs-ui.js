/* =====================================================================
 * مجتمع بلس — Phase 73 UI: quizzes and verifiable certificates (lazy "certs" chunk; 0 bytes in core).
 *   #/exams[?group=]          available quizzes (status, best score) + the ones I teach
 *   #/exam/new?group=         builder (single / multiple / true-false / short answer, points, explanation, settings)
 *   #/exam/:id                quiz page: rules card, my attempts, start / resume, certificate
 *   #/exam/:id/edit           builder for an existing quiz (questions lock after the first submission)
 *   #/exam/:id/results        teacher: summary, score distribution, hardest questions, attempts, CSV
 *   #/attempt/:id             taking (server timer, autosave, progress, submit) or the result (score ring, review)
 *   #/certificates            my certificates (share, print, show on profile)
 *   #/cert/:code              certificate in the app (status, verify link, print, share, issuer revoke)
 *   #/verify-cert                enter a code → /cert/<code>
 *   #/mentor-certs[?minor=]      M5-1/F11: mentor issues a mentorship completion certificate (≥1 completed session);
 *                                ?minor=<id> → an active guardian sees a minor's mentorship certificates
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function CertsUI() {
  if (window.MPCerts) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty ex-empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const AR = (n) => Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { useGrouping: false });
  const pc = (x) => `${AR(Math.round(x || 0))}٪`;
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const rel = (iso) => (typeof relTime === "function" ? relTime(iso) : "");
  const dateAr = (iso) => new Date(iso).toLocaleDateString("ar-SA-u-ca-gregory-nu-arab", { day: "numeric", month: "long", year: "numeric" });
  const TYPES = { single: ["◉", "اختيار واحد"], multi: ["☑", "اختيار متعدد"], tf: ["", "صح أو خطأ"], short: ["✎", "إجابة قصيرة"] };
  const KIND = { course: ["", "إتمام دورة"], study: ["", "إتمام مجموعة دراسة"], exam: ["", "اجتياز اختبار"], volunteer: ["", "شهادة تطوّع"], mentorship: ["", "إتمام برنامج إرشاد"] };
  const page = (title, body, back, sub) => { view.innerHTML = `<div class="wrap ex-page"><header class="page-head">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${h(back[1])}</a>` : ""}<div class="ph-main"><div><h2 id="ex-h" tabindex="-1">${String(title).replaceAll("<svg class=ix", "<svg class=ic")}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div></div></header>${body}</div>`; $("#ex-h")?.focus({ preventScroll: true }); };
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel ex-skel"></div>`).join("");
  const ring = (p, ok, size = 112) => { const r = size / 2 - 9, c = 2 * Math.PI * r; return `<svg class="ex-ring ${ok ? "ok" : "no"}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="الدرجة ${Math.round(p)}٪"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle">${AR(Math.round(p))}٪</text></svg>`; };
  const qN = (n) => (n === 1 ? "سؤال واحد" : n === 2 ? "سؤالان" : n <= 10 ? `${AR(n)} أسئلة` : `${AR(n)} سؤالاً`);
  const minN = (n) => (n === 1 ? "دقيقة" : n === 2 ? "دقيقتان" : n <= 10 ? `${AR(n)} دقائق` : `${AR(n)} دقيقة`);
  const certUrl = (code) => `${location.origin}/cert/${code}`;

  if (!document.getElementById("ex-css")) document.head.insertAdjacentHTML("beforeend", `<style id="ex-css">
.ex-page{max-width:760px;margin:auto}.ex-page h2:focus{outline:none}.ex-page h3{font-size:16px;font-weight:800;margin:22px 0 8px}
.ex-skel{height:92px;border-radius:var(--r);margin:8px 0}.ex-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.ex-row .btn{min-height:44px}.ex-grow{flex:1;min-width:0}
.ex-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}.ex-item{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);color:inherit;text-decoration:none;min-height:64px}.ex-item:hover{border-color:var(--accent)}
.ex-ic{width:44px;height:44px;flex:none;border-radius:14px;display:grid;place-items:center;font-size:var(--fs-xl);background:var(--accent2);color:var(--accent-ink)}.ex-ic.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:color-mix(in srgb,var(--ok) 60%,var(--text))}
.ex-item b{display:block;font-size:15.5px;line-height:1.45}.ex-m{font-size:12.5px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}.ex-m span:not(:last-child):after{content:"·";margin-inline-start:6px}
.ex-hero{border-radius:var(--r-lg);border:1px solid var(--line);background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 12%,var(--card)),var(--card) 60%);box-shadow:var(--sh-1);padding:16px;margin:8px 0}.ex-hero p{margin:6px 0 0;line-height:1.7;color:var(--text-2)}
.ex-rules{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:12px 0 4px}.ex-rules div{padding:10px;border-radius:var(--r-sm);background:var(--card);border:1px solid var(--line)}.ex-rules b{display:block;font-size:16px}.ex-rules span{font-size:12px;color:var(--muted)}
.ex-cta{width:100%;min-height:52px;font-size:16px;margin-top:6px}
.ex-att{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh-1)}.ex-att li{border-bottom:1px solid var(--line)}.ex-att li:last-child{border-bottom:0}.ex-att a,.ex-att .r{display:flex;gap:10px;align-items:center;padding:10px 14px;min-height:52px;color:inherit;text-decoration:none}
.ex-top{position:sticky;top:0;z-index:5;background:var(--glass,var(--bg));backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:8px 2px;margin:0 -2px 6px;display:flex;align-items:center;gap:10px}.ex-top .pg{flex:1;height:8px;border-radius:6px;background:color-mix(in srgb,var(--text) 12%,transparent);overflow:hidden}.ex-top .pg i{display:block;height:100%;background:var(--accent);border-radius:6px;transition:width .3s}
.ex-timer{font-variant-numeric:tabular-nums;font-weight:800;min-width:76px;text-align:center;padding:6px 10px;border-radius:999px;background:var(--bg-2);font-size:var(--fs-md)}.ex-timer.low{background:color-mix(in srgb,var(--danger) 16%,var(--card));color:color-mix(in srgb,var(--danger) 70%,var(--text))}
.ex-saved{font-size:var(--fs-xs);color:var(--muted);margin:-2px 0 0;min-height:16px;text-align:end}.ex-cnt{font-weight:800;font-size:13.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
.ex-q{border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;margin:10px 0;background:var(--card);box-shadow:var(--sh-1)}.ex-q legend{font-weight:800;padding:0;line-height:1.65;font-size:15.5px;float:right;width:100%;margin-bottom:2px}[dir=ltr] .ex-q legend{float:left}.ex-q legend+*{clear:both}.ex-q .qh{display:flex;gap:8px;align-items:center;margin-bottom:4px;font-size:var(--fs-xs);color:var(--muted)}
.ex-q label.o{display:flex;gap:10px;align-items:center;min-height:50px;padding:6px 12px;border-radius:var(--r-sm);border:1px solid var(--line-2);margin:6px 0;cursor:pointer;line-height:1.5}.ex-q label.o:has(input:checked){border-color:var(--accent);background:var(--accent2)}.ex-q input[type=radio],.ex-q input[type=checkbox]{width:20px;height:20px;flex:none;accent-color:var(--accent)}
.ex-q input[type=text]{width:100%;min-height:48px;box-sizing:border-box}.ex-q label.o.right,.ex-q label.o.right:has(input:checked){border-color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--card))}.ex-q label.o.wrong,.ex-q label.o.wrong:has(input:checked){border-color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,var(--card))}
.ex-q.res-ok{border-inline-start:4px solid var(--ok)}.ex-q.res-no{border-inline-start:4px solid var(--danger)}.ex-ex{font-size:13.5px;color:var(--text-2);line-height:1.7;padding:8px 12px;border-radius:var(--r-xs);background:var(--bg-2);margin-top:6px}
.ex-res{display:flex;gap:16px;align-items:center;padding:16px;border-radius:var(--r-lg);margin:10px 0;border:1px solid var(--line);box-shadow:var(--sh-1)}.ex-res.pass{background:linear-gradient(140deg,color-mix(in srgb,var(--ok) 14%,var(--card)),var(--card))}.ex-res.fail{background:linear-gradient(140deg,color-mix(in srgb,var(--warn) 14%,var(--card)),var(--card))}.ex-res b{font-size:19px;display:block}.ex-res p{margin:4px 0 0;color:var(--text-2);line-height:1.6}
.ex-ring .bg{fill:none;stroke:var(--bg-2);stroke-width:9}.ex-ring .fg{fill:none;stroke-width:9;stroke-linecap:round}.ex-ring.ok .fg{stroke:var(--ok)}.ex-ring.no .fg{stroke:var(--warn)}.ex-ring text{font-size:22px;font-weight:800;fill:var(--text)}
.ex-certcta{display:flex;gap:12px;align-items:center;padding:14px;border-radius:var(--r);margin:10px 0;text-decoration:none;color:inherit;border:1px solid color-mix(in srgb,#c79a3a 50%,var(--line));background:linear-gradient(135deg,color-mix(in srgb,#c79a3a 16%,var(--card)),var(--card))}.ex-certcta b{display:block}.ex-certcta span{font-size:13px;color:var(--text-2)}
.ex-f{display:flex;flex-direction:column;gap:10px}.ex-f label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--text-2)}.ex-f input:not([type=checkbox]):not([type=radio]),.ex-f select,.ex-f textarea{min-height:44px;width:100%;box-sizing:border-box;font-weight:400}.ex-f textarea{min-height:90px;line-height:1.7}
.ex-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ex-sw{flex-direction:row !important;align-items:center;gap:10px !important;min-height:48px;font-weight:600}.ex-sw input{width:22px;height:22px;accent-color:var(--accent);flex:none}
.ex-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);padding:12px 14px;margin:8px 0}
.ex-qb{border:1px solid var(--line);border-radius:var(--r);background:var(--card);box-shadow:var(--sh-1);margin:10px 0;overflow:hidden}.ex-qb .hd{display:flex;gap:6px;align-items:center;padding:8px 10px;background:var(--bg-2);flex-wrap:wrap}.ex-qb .hd b{flex:1;min-width:0;font-size:14px}.ex-qb .bd{padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.ex-qb select,.ex-qb input,.ex-qb textarea{min-height:44px;width:100%;box-sizing:border-box}.ex-qb textarea{min-height:64px;line-height:1.6}.ex-opt{display:flex;gap:8px;align-items:center}.ex-opt input[type=radio],.ex-opt input[type=checkbox]{width:24px !important;height:24px;min-height:0 !important;flex:none;accent-color:var(--ok)}.ex-opt input[type=text]{flex:1}
.ex-mv{display:flex;gap:4px}.ex-mv button{min-width:44px;min-height:44px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--card);color:var(--text-2);cursor:pointer;font-size:15px}.ex-mv button:disabled{opacity:.35}.ex-mv .x{color:var(--danger)}
.ex-add{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.ex-add button{min-height:48px;border-radius:var(--r-sm);border:1px dashed var(--line-2);background:var(--card);color:var(--accent-ink);font:inherit;font-weight:700;cursor:pointer}
.ex-k{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}@media(min-width:620px){.ex-k{grid-template-columns:repeat(4,minmax(0,1fr))}}.ex-k div{padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1)}.ex-k b{display:block;font-size:24px;font-weight:800;line-height:1.25}.ex-k span{font-size:12.5px;color:var(--muted)}
.ex-hist{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));align-items:end;gap:4px;height:120px;padding:10px 8px 0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1)}.ex-hist div{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:2px}.ex-hist i{display:block;width:100%;border-radius:6px 6px 0 0;background:var(--accent);min-height:2px}.ex-hist i.p{background:var(--ok)}.ex-hist small{font-size:10px;color:var(--muted);padding-bottom:4px}
.ex-bar{height:8px;border-radius:6px;background:var(--bg-2);overflow:hidden;flex-basis:100%}.ex-bar i{display:block;height:100%;border-radius:6px;background:var(--accent)}.ex-bar.low i{background:var(--danger)}
.ex-cert{position:relative;border-radius:var(--r-lg);padding:6px;background:linear-gradient(135deg,#d8b65a,#a8741a 45%,#e7cf8a);box-shadow:var(--sh-1);margin:10px 0}.ex-cert .in{border-radius:calc(var(--r-lg) - 4px);background:#fffdf8;color:#1d1b26;padding:18px 16px;text-align:center}.ex-cert .k{display:inline-block;padding:2px 12px;border-radius:999px;background:#f1eafc;color:#5b2bd6;font-weight:700;font-size:12.5px}.ex-cert .hd{font-size:var(--fs-2xl);font-weight:800;color:#8a5d10;margin:8px 0 2px}.ex-cert .who{font-size:var(--fs-2xl);font-weight:800;margin:4px 0}.ex-cert .t{font-size:16px;font-weight:700;line-height:1.6}.ex-cert .by{color:#5f5b72;font-size:13.5px}.ex-cert code{direction:ltr;unicode-bidi:isolate;font-family:ui-monospace,monospace;background:#f4f1fb;padding:2px 8px;border-radius:6px;color:#1d1b26}
.ex-cert.revoked .in{filter:grayscale(.9);opacity:.7}.ex-state{display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:var(--r);font-weight:700;margin:8px 0}.ex-state.ok{background:color-mix(in srgb,var(--ok) 14%,var(--card));color:color-mix(in srgb,var(--ok) 55%,var(--text))}.ex-state.bad{background:color-mix(in srgb,var(--danger) 12%,var(--card));color:color-mix(in srgb,var(--danger) 65%,var(--text))}.ex-state small{display:block;font-weight:400}
.ex-cl{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:560px){.ex-cl{grid-template-columns:1fr 1fr}}.ex-cc{display:flex;flex-direction:column;border-radius:var(--r);overflow:hidden;border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);color:inherit;text-decoration:none}.ex-cc .tp{padding:14px;background:linear-gradient(135deg,#f6ecd2,#fffaf0);color:#1d1b26;border-bottom:3px solid #c79a3a;min-height:92px}.ex-cc .tp .e{font-size:var(--fs-2xl)}.ex-cc .tp b{display:block;font-size:15.5px;line-height:1.45;margin-top:4px}.ex-cc .bt{padding:10px 14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--muted)}
.ex-page 
.ex-mc{display:flex;flex-direction:column;gap:10px}.ex-mc .ex-f{margin-top:8px}.ex-cnt2{font-size:var(--fs-xs);color:var(--muted);text-align:end;font-variant-numeric:tabular-nums}
@media print{body *{visibility:hidden}.ex-cert,.ex-cert *{visibility:visible}.ex-cert{position:absolute;inset:0 0 auto 0;box-shadow:none;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.ex-code{display:flex;gap:8px}.ex-code input{flex:1;min-width:0;min-height:52px;font-size:20px;text-align:center;letter-spacing:2px;direction:ltr;font-family:ui-monospace,monospace;text-transform:uppercase}.ex-code button{min-height:52px}
</style>`);

  /* =================== #/exams =================== */
  const window2 = (w) => (w && !w.open ? `<span class="ex-chip sbadge warn">${h(w.why)}</span>` : "");
  async function listView() {
    const p = qs(), group = p.get("group"), tab = p.get("tab") || "take";
    const base = "#/exams" + (group ? "?group=" + enc(group) + "&" : "?");
    page("الاختبارات", `<nav class="ex-tabs seg" aria-label="الاختبارات"><a href="${base}tab=take" ${tab === "take" ? 'aria-current="page"' : ""}>اختباراتي</a><a href="${base}tab=teach" ${tab === "teach" ? 'aria-current="page"' : ""}>أُعدّها</a></nav><div id="ex-l">${skel(3)}</div>`, group ? ["#/study/" + enc(group), "المجموعة"] : null, "اختبارات المجموعات والحلقات الدراسية — تُصحَّح على الخادم، وقد تمنحك شهادة موقّعة عند النجاح.");
    let d; try { d = await api("GET", "/api/exams" + (group ? "?group=" + enc(group) : "")); } catch (e) { const b = $("#ex-l"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#ex-l"); if (!box) return;
    if (tab === "teach") {
      box.innerHTML = `<div class="ex-row"><a class="btn" href="#/exam/new${group ? "?group=" + enc(group) : ""}"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>اختبار جديد</a></div>${d.teaching.length ? `<ul class="ex-list">${d.teaching.map((x) => `<li><a class="ex-item" href="#/exam/${enc(x.id)}"><span class="ex-ic" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-doc /></svg></span><span class="ex-grow"><b>${h(x.title)}</b><span class="ex-m"><span>${qN(x.questions)}</span><span>${AR(x.attempts)} محاولة</span></span></span><span class="ex-chip sbadge ${x.status === "published" ? "ok" : x.status === "draft" ? "warn" : ""}">${{ draft: "مسودة", published: "منشور", closed: "مغلق" }[x.status]}</span></a></li>`).join("")}</ul>` : `<div class="empty ex-empty"><b>لم تُعدّ اختبارات بعد</b>أنشئ اختباراً لمجموعتك: أسئلة اختيار وصح/خطأ وإجابات قصيرة، بوقت محدد وشهادة عند النجاح.</div>`}`;
      return;
    }
    box.innerHTML = d.exams.length ? `<ul class="ex-list">${d.exams.map((x) => `<li><a class="ex-item" href="#/exam/${enc(x.id)}"><span class="ex-ic ${x.mine?.passed ? "ok" : ""}" aria-hidden="true">${x.mine?.passed ? "✓" : ""}</span><span class="ex-grow"><b>${h(x.title)}</b><span class="ex-m"><span>${h(x.group.name)}</span><span>${qN(x.questions)}</span>${x.settings.timeLimit ? `<span>${minN(x.settings.timeLimit)}</span>` : ""}${x.settings.certificate ? "<span><svg class=ix aria-hidden=true><use href=#i-medal /></svg> شهادة</span>" : ""}</span></span>${x.mine ? `<span class="ex-chip sbadge ${x.mine.passed ? "ok" : "warn"}">${pc(x.mine.best)}</span>` : window2(x.window)}</a></li>`).join("")}</ul>`
      : `<div class="empty ex-empty"><b>لا اختبارات متاحة لك الآن</b>انضم إلى مجموعة دراسة أو حلقة لتظهر اختباراتها هنا.<br><a class="btn" href="#/study">تصفّح المجموعات</a></div>`;
  }

  /* =================== #/exam/:id =================== */
  async function examView(id) {
    page("…", `<div id="ex-x">${skel(3)}</div>`, ["#/exams", "الاختبارات"]);
    let d; try { d = await api("GET", "/api/exams/" + enc(id)); } catch (e) { const b = $("#ex-x"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#ex-x"); if (!box) return;
    const x = d.exam, s = x.settings, me = d.me; const hd = $("#ex-h"); if (hd) hd.textContent = x.title;
    const rules = [[qN(x.questions), x.points === 1 ? "نقطة واحدة" : x.points === 2 ? "نقطتان" : x.points <= 10 ? `${AR(x.points)} نقاط` : `${AR(x.points)} نقطة`], [s.timeLimit ? minN(s.timeLimit) : "بلا وقت", "المدة"], [pc(s.passPct), "للنجاح"], [s.maxAttempts ? `${AR(s.maxAttempts)}` : "∞", me.attemptsLeft !== null ? `محاولات · بقي ${AR(me.attemptsLeft)}` : "محاولات"]];
    box.innerHTML = `<section class="ex-hero"><div class="u-m0 ex-row"><span class="ex-chip sbadge">${h(x.group.name)}</span>${x.course ? `<a class="ex-chip sbadge" href="#/course/${enc(x.course.id)}"><svg class=ix aria-hidden=true><use href=#i-cap /></svg> ${h(x.course.title)}</a>` : ""}${s.certificate ? `<span class="ex-chip sbadge ok"><svg class=ix aria-hidden=true><use href=#i-medal /></svg> شهادة عند النجاح</span>` : ""}${x.status !== "published" ? `<span class="ex-chip sbadge warn">${{ draft: "مسودة", closed: "مغلق" }[x.status] || ""}</span>` : ""}</div>${x.descr ? `<p>${h(x.descr)}</p>` : ""}
      <div class="ex-rules">${rules.map(([a, b]) => `<div><b>${h(a)}</b><span>${h(b)}</span></div>`).join("")}</div>
      ${s.closesAt ? `<p class="ex-sub">يُغلق ${h(dateAr(s.closesAt))}</p>` : ""}
      ${me.inProgress ? `<a class="btn ex-cta" href="#/attempt/${enc(me.inProgress)}">متابعة المحاولة ←</a>` : me.canStart ? `<button class="btn ex-cta" id="ex-start" type="button">${me.attempts.length ? "محاولة جديدة" : "ابدأ الاختبار"}</button><p class="u-mt8 ex-sub">${s.timeLimit ? `يبدأ العدّاد عند الضغط ويستمر حتى لو أغلقت الصفحة. ` : ""}تُحفظ إجاباتك تلقائياً.</p>` : signed() ? `<p class="u-mt10 ex-sub">${h(d.window.why || (me.attemptsLeft === 0 ? "استنفدت المحاولات" : "انضم إلى المجموعة لتؤدي الاختبار"))}</p>` : `<a class="btn ex-cta" href="#/settings">سجّل الدخول لتؤدي الاختبار</a>`}</section>
      ${me.certificate ? `<a class="ex-certcta" href="#/cert/${enc(me.certificate.code)}"><span class="ex-grow"><b>شهادتك جاهزة</b><span>رمز التحقق <bdi dir="ltr">${h(me.certificate.code)}</bdi></span></span><span aria-hidden="true">←</span></a>` : ""}
      ${me.attempts.length ? `<h3>محاولاتي</h3><ul class="ex-att">${me.attempts.slice().reverse().map((t, i) => `<li><a href="#/attempt/${enc(t.id)}"><span class="ex-ic ${t.passed ? "ok" : ""}" aria-hidden="true">${t.passed ? "✓" : AR(me.attempts.length - i)}</span><span class="ex-grow"><b>${pc(t.score)}</b><span class="ex-m"><span>${h(rel(t.at))}</span>${t.expired ? "<span>انتهى الوقت</span>" : ""}</span></span><span class="ex-chip sbadge ${t.passed ? "ok" : "warn"}">${t.passed ? "ناجح" : "لم يجتز"}</span></a></li>`).join("")}</ul>` : ""}
      ${me.manager ? `<h3 class="f-h">للمعلّم</h3><div class="ex-row"><a class="btn outline" href="#/exam/${enc(x.id)}/results"><svg class=ix aria-hidden=true><use href=#i-chart /></svg> النتائج</a><a class="btn outline" href="#/exam/${enc(x.id)}/edit"><svg class=ix aria-hidden=true><use href=#i-pen /></svg> تعديل</a>${x.status === "draft" ? `<button class="btn ghost" type="button" data-st="published">نشر</button>` : x.status === "published" ? `<button class="btn ghost" type="button" data-st="closed">إغلاق</button>` : `<button class="btn ghost" type="button" data-st="published">إعادة فتح</button>`}</div>` : ""}`;
    $("#ex-start")?.addEventListener("click", async (e) => { e.currentTarget.disabled = true; try { const a = await api("POST", `/api/exams/${enc(x.id)}/start`); location.hash = "#/attempt/" + enc(a.attempt.id); } catch (er) { say(er.message); e.currentTarget.disabled = false; } });
    box.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", async () => { try { await api("PATCH", "/api/exams/" + enc(x.id), { status: b.dataset.st }); say(b.dataset.st === "published" ? "نُشر الاختبار" : "أُغلق الاختبار"); examView(id); } catch (er) { say(er.message); } }));
  }

  /* =================== #/attempt/:id =================== */
  let tick = null;
  async function attemptView(id) {
    clearInterval(tick);
    page("…", `<div id="ex-a">${skel(4)}</div>`, ["#/exams", "الاختبارات"]);
    let d; try { d = await api("GET", "/api/exam-attempts/" + enc(id)); } catch (e) { const b = $("#ex-a"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#ex-a"); if (!box) return;
    const hd = $("#ex-h"); if (hd) hd.textContent = d.exam.title;
    const back = view.querySelector(".ex-back"); if (back) { back.href = "#/exam/" + enc(d.exam.id); back.textContent = "→ صفحة الاختبار"; }
    if (d.attempt.status === "in_progress") return takeView(box, d); else return resultView(box, d);
  }
  function qHTML(q, ans, rv) {
    const a = ans[q.id], r = rv?.find((x) => x.id === q.id), cls = r ? (r.correct ? " res-ok" : " res-no") : "", dis = rv ? "disabled" : "";
    let body;
    if (q.type === "short") body = `<input type="text" name="${h(q.id)}" value="${h(a ?? "")}" maxlength="200" autocomplete="off" aria-label="إجابتك" ${dis}>${r && r.answer ? `<div class="ex-ex">الإجابات المقبولة: ${h(r.answer.join("، "))}</div>` : ""}`;
    else body = q.options.map((o, i) => { const on = q.type === "multi" ? Array.isArray(a) && a.includes(i) : a === i; const right = r && r.answer !== undefined && (q.type === "multi" ? r.answer.includes(i) : r.answer === i); const st = r && r.answer !== undefined ? (right ? " right" : on ? " wrong" : "") : ""; return `<label class="o${st}"><input type="${q.type === "multi" ? "checkbox" : "radio"}" name="${h(q.id)}" value="${i}" ${on ? "checked" : ""} ${dis}><span>${h(o)}</span>${right ? '<span class="ex-grow"></span><span aria-label="الإجابة الصحيحة">✓</span>' : ""}</label>`; }).join("");
    return `<fieldset class="ex-q${cls}" data-q="${h(q.id)}"><legend>${AR(q.n)}. ${h(q.q)}</legend><div class="qh"><span>${TYPES[q.type][1]}${q.type === "multi" ? " — اختر كل الإجابات الصحيحة" : ""}</span><span>· ${q.points === 1 ? "نقطة" : AR(q.points) + " نقاط"}</span>${r ? `<span class="ex-chip sbadge ${r.correct ? "ok" : "bad"}">${r.correct ? "صحيحة" : "خاطئة"}</span>` : ""}</div>${body}${r?.explain ? `<div class="ex-ex"><svg class=ix aria-hidden=true><use href=#i-bulb /></svg> ${h(r.explain)}</div>` : ""}</fieldset>`;
  }
  function takeView(box, d) {
    const total = d.questions.length, ans = { ...d.answers };
    const due = d.attempt.dueAt ? Date.parse(d.attempt.dueAt) : null, skew = Date.now() - Date.parse(d.attempt.serverNow);
    box.innerHTML = `<div class="ex-top" role="region" aria-label="حالة الاختبار"><span class="ex-cnt" id="ex-cnt">${AR(0)} من ${AR(total)}</span><div class="pg" role="progressbar" aria-label="الأسئلة المجابة" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="0"><i style="width:0"></i></div>${due ? `<span class="ex-timer" id="ex-tm" role="timer" aria-label="الوقت المتبقي">--:--</span>` : ""}</div><p class="ex-saved" id="ex-sv" aria-live="polite"></p>
      <form id="ex-f">${d.questions.map((q) => qHTML(q, ans)).join("")}<button class="btn ex-cta" type="submit">تسليم الإجابات</button><p class="u-tc u-mt8 ex-sub">يمكنك مراجعة إجاباتك قبل التسليم</p></form>`;
    const f = $("#ex-f");
    const read = () => { const o = {}; for (const q of d.questions) { if (q.type === "short") { const v = f.elements[q.id]?.value?.trim(); if (v) o[q.id] = v; } else if (q.type === "multi") { const v = [...f.querySelectorAll(`[name="${CSS.escape(q.id)}"]:checked`)].map((x) => +x.value); if (v.length) o[q.id] = v; } else { const v = f.querySelector(`[name="${CSS.escape(q.id)}"]:checked`); if (v) o[q.id] = +v.value; } } return o; };
    const prog = () => { const n = Object.keys(read()).length, pg = box.querySelector(".pg"); pg.setAttribute("aria-valuenow", n); pg.firstElementChild.style.width = `${(n / total) * 100}%`; const c = $("#ex-cnt"); if (c) c.textContent = `${AR(n)} من ${AR(total)}`; };
    let timer = null, dirty = false;
    const persist = async () => { if (!dirty) return; dirty = false; const sv = $("#ex-sv"); try { await api("PUT", `/api/exam-attempts/${enc(d.attempt.id)}/answers`, { answers: read() }); if (sv) sv.textContent = "✓ حُفظ"; } catch (e) { if (e.code === "closed") { location.reload(); return; } if (sv) sv.textContent = "لم يُحفظ"; dirty = true; } };
    f.addEventListener("input", () => { dirty = true; prog(); const sv = $("#ex-sv"); if (sv) sv.textContent = "…"; clearTimeout(timer); timer = setTimeout(persist, 900); });
    prog();
    const submit = async (auto) => { clearInterval(tick); clearTimeout(timer); try { await api("POST", `/api/exam-attempts/${enc(d.attempt.id)}/submit`, { answers: read() }); say(auto ? "انتهى الوقت — سُلّمت إجاباتك" : "✓ سُلّمت إجاباتك"); attemptView(d.attempt.id); } catch (e) { say(e.message); } };
    f.addEventListener("submit", (e) => { e.preventDefault(); const left = total - Object.keys(read()).length; if (left && !confirm(`لم تُجب عن ${qN(left)}. هل تريد التسليم؟`)) return; submit(false); });
    if (due) {
      const tm = $("#ex-tm"), run = () => { const ms = due - (Date.now() - skew); if (!tm.isConnected) { clearInterval(tick); return; } if (ms <= 0) { tm.textContent = "00:00"; submit(true); return; } const m = Math.floor(ms / 60e3), s = Math.floor((ms % 60e3) / 1000); tm.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; tm.classList.toggle("low", ms < 60e3); if (ms < 60e3 && !tm.dataset.warned) { tm.dataset.warned = "1"; tm.setAttribute("aria-label", "أقل من دقيقة متبقية"); say("بقيت أقل من دقيقة"); } };
      run(); tick = setInterval(run, 1000);
    }
  }
  function resultView(box, d) {
    const a = d.attempt, pass = a.passed;
    box.innerHTML = `<section class="ex-res ${pass ? "pass" : "fail"}" role="status">${ring(a.score, pass)}<div class="ex-grow"><b>${pass ? "نجحت!" : a.expired ? "انتهى الوقت" : "لم تجتز هذه المرة"}</b><p>${AR(a.correct)} من ${qN(d.questions.length)} صحيحة · ${AR(a.points)} من ${AR(a.maxPoints)} نقطة · النجاح من ${pc(d.exam.passPct)}</p>${d.attemptsLeft !== null ? `<p>المحاولات المتبقية: ${AR(d.attemptsLeft)}</p>` : ""}</div></section>
      ${d.certificate ? `<a class="ex-certcta" href="#/cert/${enc(d.certificate.code)}"><span class="ex-grow"><b>صدرت شهادتك الموقّعة</b><span>يمكن لأي جهة التحقق منها بالرمز <bdi dir="ltr">${h(d.certificate.code)}</bdi></span></span><span aria-hidden="true">←</span></a>` : ""}
      <div class="ex-row">${!pass && (d.attemptsLeft === null || d.attemptsLeft > 0) ? `<a class="btn" href="#/exam/${enc(d.exam.id)}">محاولة أخرى</a>` : ""}<a class="btn ghost" href="#/exam/${enc(d.exam.id)}">صفحة الاختبار</a></div>
      <h3>مراجعة الإجابات</h3>${d.reveal ? "" : `<p class="ex-sub">${d.exam.review === "never" ? "لا يعرض المعلّم الإجابات الصحيحة لهذا الاختبار." : "تظهر الإجابات الصحيحة بعد النجاح."}</p>`}
      <form aria-label="إجاباتك">${d.questions.map((q) => qHTML(q, d.answers, d.review)).join("")}</form>`;
  }

  /* =================== builder: #/exam/new, #/exam/:id/edit =================== */
  const blankQ = (type) => (type === "tf" ? { type, q: "", answer: true } : type === "short" ? { type, q: "", accepted: [""] } : { type, q: "", options: ["", ""], answer: type === "multi" ? [] : 0 });
  function qEditor(q, i, n, locked) {
    const dis = locked ? "disabled" : "";
    const opts = q.type === "tf" ? `<div class="ex-opt"><label class="ex-sw"><input type="radio" name="a${i}" value="1" ${q.answer ? "checked" : ""} ${dis}> صح</label><label class="ex-sw"><input type="radio" name="a${i}" value="0" ${!q.answer ? "checked" : ""} ${dis}> خطأ</label></div>`
      : q.type === "short" ? `<label class="u-t-sm ex-f">الإجابات المقبولة (افصل بينها بفاصلة)<input type="text" data-acc value="${h((q.accepted || []).join("، "))}" placeholder="مثال: رمضان، شهر رمضان" ${dis}></label><p class="u-m0 ex-sub">تُقارن بعد توحيد الهمزات والتشكيل والتاء المربوطة.</p>`
        : `${(q.options || []).map((o, k) => `<div class="ex-opt"><input type="${q.type === "multi" ? "checkbox" : "radio"}" name="a${i}" value="${k}" aria-label="الإجابة الصحيحة: الخيار ${k + 1}" ${q.type === "multi" ? ((q.answer || []).includes(k) ? "checked" : "") : q.answer === k ? "checked" : ""} ${dis}><input type="text" data-opt="${k}" value="${h(o)}" maxlength="200" placeholder="الخيار ${AR(k + 1)}" aria-label="نص الخيار ${k + 1}" ${dis}>${(q.options.length > 2 && !locked) ? `<div class="ex-mv"><button type="button" class="x" data-rmopt="${k}" aria-label="حذف الخيار ${k + 1}">✕</button></div>` : ""}</div>`).join("")}${q.options.length < 8 && !locked ? `<button type="button" class="u-mh44 btn ghost" data-addopt><svg class=ix aria-hidden=true><use href=#i-plus /></svg>خيار</button>` : ""}`;
    return `<section class="ex-qb" data-i="${i}" data-type="${q.type}"><div class="hd"><b>${AR(i + 1)}. ${TYPES[q.type][0]} ${TYPES[q.type][1]}</b>${locked ? "" : `<div class="ex-mv"><button type="button" data-mq="-1" ${i === 0 ? "disabled" : ""} aria-label="أعلى">↑</button><button type="button" data-mq="1" ${i === n - 1 ? "disabled" : ""} aria-label="أسفل">↓</button><button type="button" class="x" data-rmq aria-label="حذف السؤال ${i + 1}">✕</button></div>`}</div>
      <div class="bd"><label class="u-t-sm ex-f">نص السؤال<textarea data-q maxlength="500" required ${dis}>${h(q.q)}</textarea></label>${opts}
      <div class="ex-two"><label class="u-t-sm ex-f">النقاط<select data-pts ${dis}>${[1, 2, 3, 4, 5].map((p) => `<option ${(q.points || 1) === p ? "selected" : ""}>${p}</option>`).join("")}</select></label><label class="u-t-sm ex-f">شرح بعد الإجابة<input type="text" data-exp value="${h(q.explain || "")}" maxlength="600" placeholder="اختياري" ${dis}></label></div></div></section>`;
  }
  async function builderView(id) {
    const isNew = !id; let x = null, group = qs().get("group"), groups = [];
    page(isNew ? "اختبار جديد" : "تعديل الاختبار", `<div id="ex-b">${skel(3)}</div>`, isNew ? ["#/exams?tab=teach" + (group ? "&group=" + enc(group) : ""), "الاختبارات"] : ["#/exam/" + enc(id), "صفحة الاختبار"]);
    try {
      if (!isNew) { const d = await api("GET", "/api/exams/" + enc(id)); x = d.exam; if (!d.me.manager) throw new Error("لمعلمي المجموعة فقط"); group = x.groupId; }
      else if (!group) groups = (await api("GET", "/api/study/groups?mine=1")).groups;
    } catch (e) { const b = $("#ex-b"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#ex-b"); if (!box) return;
    const st = { qs: x ? x.bank.map((q) => ({ ...q })) : [blankQ("single")], s: x ? { ...x.settings } : { timeLimit: 0, maxAttempts: 0, passPct: 70, shuffle: true, shuffleOptions: true, review: "submit", certificate: true } };
    const locked = !!x?.locked;
    box.innerHTML = `<form class="ex-f" id="ex-bf" novalidate>
      ${isNew && !group ? `<label>المجموعة أو الحلقة<select name="group" required>${groups.length ? groups.map((g) => `<option value="${h(g.id)}">${h(g.name)}</option>`).join("") : `<option value="">لا مجموعات — انضم أو أنشئ مجموعة دراسة</option>`}</select></label>` : ""}
      <label>عنوان الاختبار<input name="title" required minlength="3" maxlength="120" value="${h(x?.title || "")}" placeholder="مثال: اختبار الوحدة الأولى"></label>
      <label>تعليمات للطلاب<textarea name="descr" maxlength="2000" placeholder="ما الذي يغطيه الاختبار؟">${h(x?.descr || "")}</textarea></label>
      <div class="ex-card"><h3 class="u-m0 u-mb8">الإعدادات</h3><div class="ex-two"><label>المدة بالدقائق<input name="timeLimit" type="number" inputmode="numeric" min="0" max="300" value="${st.s.timeLimit}" aria-describedby="ex-h0"></label><label>عدد المحاولات<input name="maxAttempts" type="number" inputmode="numeric" min="0" max="20" value="${st.s.maxAttempts}" aria-describedby="ex-h0"></label><label>درجة النجاح ٪<input name="passPct" type="number" inputmode="numeric" min="1" max="100" value="${st.s.passPct}"></label><label>عرض الإجابات<select name="review">${[["submit", "بعد التسليم"], ["pass", "بعد النجاح"], ["never", "لا تُعرض"]].map(([k, l]) => `<option value="${k}" ${st.s.review === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <p class="ex-sub" id="ex-h0" style="margin:0;grid-column:1/-1">0 يعني بلا حد</p><label class="ex-sw"><input type="checkbox" name="certificate" ${st.s.certificate ? "checked" : ""}> شهادة موقّعة عند النجاح</label><label class="ex-sw"><input type="checkbox" name="shuffle" ${st.s.shuffle ? "checked" : ""}> ترتيب عشوائي للأسئلة</label><label class="ex-sw"><input type="checkbox" name="shuffleOptions" ${st.s.shuffleOptions ? "checked" : ""}> ترتيب عشوائي للخيارات</label></div>
      <h3>الأسئلة</h3>${locked ? `<p class="ex-sub"><svg class=ix aria-hidden=true><use href=#i-lock /></svg> الأسئلة مقفلة بعد أول تسليم حتى تبقى الدرجات قابلة للمقارنة. <button type="button" class="u-mh44 btn ghost" id="ex-dup">إنشاء نسخة للتعديل</button></p>` : ""}<div id="ex-qs"></div>
      ${locked ? "" : `<div class="ex-add" role="group" aria-label="إضافة سؤال">${Object.entries(TYPES).map(([k, [i, l]]) => `<button type="button" data-addq="${k}"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>${i} ${l}</button>`).join("")}</div>`}
      <div class="ex-row"><button class="u-f1 btn" type="submit">${isNew ? "حفظ كمسودة" : "حفظ التغييرات"}</button></div></form>`;
    const host = $("#ex-qs");
    const sync = () => { host.querySelectorAll(".ex-qb").forEach((el) => { const i = +el.dataset.i, q = st.qs[i]; if (!q) return; q.q = el.querySelector("[data-q]").value; q.points = +el.querySelector("[data-pts]").value; q.explain = el.querySelector("[data-exp]").value.trim() || null;
      if (q.type === "short") q.accepted = el.querySelector("[data-acc]").value.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean);
      else if (q.type === "tf") q.answer = el.querySelector(`[name="a${i}"]:checked`)?.value === "1";
      else { q.options = [...el.querySelectorAll("[data-opt]")].map((o) => o.value); q.answer = q.type === "multi" ? [...el.querySelectorAll(`[name="a${i}"]:checked`)].map((o) => +o.value) : +(el.querySelector(`[name="a${i}"]:checked`)?.value ?? -1); } }); };
    const draw = () => { host.innerHTML = st.qs.map((q, i) => qEditor(q, i, st.qs.length, locked)).join("") || `<div class="empty ex-empty">أضف سؤالاً من الأزرار بالأسفل</div>`; };
    draw();
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "ex-dup") { try { const r = await api("POST", `/api/exams/${enc(id)}/duplicate`); location.hash = `#/exam/${enc(r.exam.id)}/edit`; say("✓ أُنشئت نسخة"); } catch (x2) { say(x2.message); } return; }
      if (b.dataset.addq) { sync(); st.qs.push(blankQ(b.dataset.addq)); draw(); host.lastElementChild?.querySelector("[data-q]")?.focus(); return; }
      const el = b.closest(".ex-qb"); if (!el) return; sync(); const i = +el.dataset.i;
      if (b.hasAttribute("data-rmq")) { if (!confirm("حذف السؤال؟")) return; st.qs.splice(i, 1); }
      else if (b.dataset.mq) { const j = i + +b.dataset.mq; [st.qs[i], st.qs[j]] = [st.qs[j], st.qs[i]]; }
      else if (b.hasAttribute("data-addopt")) st.qs[i].options.push("");
      else if (b.dataset.rmopt) { const k = +b.dataset.rmopt, q = st.qs[i]; q.options.splice(k, 1); if (q.type === "multi") q.answer = q.answer.filter((v) => v !== k).map((v) => (v > k ? v - 1 : v)); else if (q.answer === k) q.answer = 0; else if (q.answer > k) q.answer--; }
      else return;
      draw();
    });
    $("#ex-bf").addEventListener("submit", async (e) => {
      e.preventDefault(); sync(); const f = e.target;
      const body = { title: f.title.value.trim(), descr: f.descr.value.trim(), settings: { timeLimit: +f.timeLimit.value, maxAttempts: +f.maxAttempts.value, passPct: +f.passPct.value, review: f.review.value, certificate: f.certificate.checked, shuffle: f.shuffle.checked, shuffleOptions: f.shuffleOptions.checked } };
      if (!locked) body.questions = st.qs.map((q) => ({ id: q.id, type: q.type, q: q.q.trim(), points: q.points, explain: q.explain, ...(q.type === "short" ? { accepted: q.accepted } : q.type === "tf" ? { answer: q.answer } : { options: q.options.map((o) => o.trim()), answer: q.answer }) }));
      try {
        const r = isNew ? await api("POST", "/api/exams", { communityId: group || f.group?.value, ...body }) : await api("PATCH", "/api/exams/" + enc(id), body);
        say(isNew ? "✓ حُفظ الاختبار مسودة — انشره من صفحته" : "✓ حُفظت التغييرات"); location.hash = "#/exam/" + enc(r.exam.id);
      } catch (x2) { say(x2.message); }
    });
  }

  /* =================== #/exam/:id/results =================== */
  async function resultsView(id) {
    page("النتائج", `<div id="ex-r">${skel(3)}</div>`, ["#/exam/" + enc(id), "صفحة الاختبار"]);
    let d; try { d = await api("GET", `/api/exams/${enc(id)}/results`); } catch (e) { const b = $("#ex-r"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#ex-r"); if (!box) return;
    const S = d.summary, mx = Math.max(1, ...d.distribution.map((b) => b.n)), pass = d.exam.settings.passPct; const hd = $("#ex-h"); if (hd) hd.textContent = "" + d.exam.title;
    box.innerHTML = `<div class="ex-k"><div><b>${AR(S.learners)}</b><span>متعلم</span></div><div><b>${S.learners ? pc((S.passed / S.learners) * 100) : "—"}</b><span>نسبة النجاح</span></div><div><b>${S.avg === null ? "—" : pc(S.avg)}</b><span>متوسط أفضل درجة</span></div><div><b>${AR(S.inProgress)}</b><span>يؤدّون الآن</span></div></div>
      <h3>توزيع الدرجات</h3><div class="ex-hist" role="img" aria-label="توزيع الدرجات: ${d.distribution.map((b) => `${b.from}–${b.to}: ${b.n}`).join("، ")}">${d.distribution.map((b) => `<div><i class="${b.from >= pass ? "p" : ""}" style="height:${(b.n / mx) * 82}%"></i><small>${AR(b.from)}</small></div>`).join("")}</div>
      <h3>الأسئلة الأصعب أولاً</h3>${d.items.length ? `<ul class="ex-att">${d.items.map((it) => `<li><div class="u-fww r"><span class="ex-ic" aria-hidden="true">${TYPES[it.type][0]}</span><span class="ex-grow"><b style="display:block;font-size:14.5px;line-height:1.5">${AR(it.n)}. ${h(it.q)}</b><span class="ex-m"><span>${AR(it.answered)} إجابة</span></span></span><b>${it.correctPct === null ? "—" : pc(it.correctPct)}</b><div class="ex-bar ${it.correctPct !== null && it.correctPct < 50 ? "low" : ""}" aria-hidden="true"><i style="width:${it.correctPct || 0}%"></i></div></div></li>`).join("")}</ul>` : ""}
      <div class="u-jsb ex-row"><h3 class="u-m0">المحاولات</h3><a class="btn ghost" href="/api/exams/${enc(id)}/results?format=csv" download>CSV</a></div>
      ${d.attempts.length ? `<ul class="ex-att">${d.attempts.map((t) => `<li><div class="r"><span class="ex-ic" style="background:${h(t.user.color || "var(--accent)")};color:#fff" aria-hidden="true">${h((t.user.name || "?").slice(0, 1))}</span><span class="ex-grow"><b>${h(t.user.name)}</b><span class="ex-m"><span>${h(rel(t.submittedAt || t.startedAt))}</span>${t.minutes ? `<span>${minN(t.minutes)}</span>` : ""}${t.status === "expired" ? "<span>انتهى الوقت</span>" : ""}</span></span>${t.status === "in_progress" ? `<span class="ex-chip sbadge">يؤدّي الآن</span>` : `<span class="ex-chip sbadge ${t.passed ? "ok" : "warn"}">${pc(t.score)}</span>`}</div></li>`).join("")}</ul>` : `<div class="empty ex-empty">لا محاولات بعد</div>`}`;
  }

  /* =================== certificates =================== */
  const certCard = (c) => `<a class="ex-cc" href="#/cert/${enc(c.code)}"><div class="tp"><span class="e" aria-hidden="true">${KIND[c.kind][0]}</span> <span style="font-size:12px;font-weight:700;color:#8a5d10">${h(KIND[c.kind][1])}</span><b>${h(c.title)}</b><span style="font-size:12.5px;color:#5f5b72">${h(c.issuer)}</span></div><div class="bt"><span>${h(dateAr(c.issuedAt))}</span>${c.status === "revoked" ? `<span class="ex-chip sbadge bad">مسحوبة</span>` : `<span class="ex-chip sbadge ok">✓ صالحة</span>`}${c.visibility === "unlisted" ? `<span class="ex-chip sbadge">مخفية من الملف</span>` : ""}${c.verifications ? `<span>تحقق منها ${AR(c.verifications)}</span>` : ""}</div></a>`;
  async function myCertsView() {
    page("شهاداتي", `<div id="ex-c">${skel(2)}</div>`, null, "شهادات موقّعة رقمياً عند إتمام دورة أو مجموعة دراسة أو اجتياز اختبار — يتحقق منها أي أحد برمزها.");
    if (!signed()) { $("#ex-c").innerHTML = `<div class="empty ex-empty">سجّل الدخول لعرض شهاداتك</div>`; return; }
    let d; try { d = await api("GET", "/api/certificates"); } catch (e) { const b = $("#ex-c"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#ex-c"); if (!box) return;
    box.innerHTML = `${d.certificates.length ? `<div class="ex-cl">${d.certificates.map(certCard).join("")}</div>` : `<div class="empty ex-empty"><b>لا شهادات بعد</b>أتمّ دورة أو اجتز اختباراً لتحصل على أول شهادة.<br><a class="btn" href="#/courses">تصفّح الدورات</a></div>`}
      <div class="ex-row"><a class="btn ghost" href="#/verify-cert"><svg class=ix aria-hidden=true><use href=#i-search /></svg> التحقق من شهادة</a></div>${d.minor ? `<p class="ex-sub">لحمايتك، تظهر شهاداتك بالاسم الأول والحرف الأول من اسم العائلة ولا تُعرض على ملفك.</p>` : ""}`;
  }
  async function certView(code) {
    page("الشهادة", `<div id="ex-cv">${skel(2)}</div>`, ["#/certificates", "شهاداتي"]);
    let d; try { d = await api("GET", "/api/certificates/verify/" + enc(code)); } catch (e) { const b = $("#ex-cv"); if (b) b.innerHTML = errBox(e) + `<div class="ex-row"><a class="btn ghost" href="#/verify-cert">جرّب رمزاً آخر</a></div>`; return; }
    const box = $("#ex-cv"); if (!box) return;
    const c = d.certificate, url = certUrl(c.code);
    let mine = null; if (d.mine) { try { mine = (await api("GET", "/api/certificates")).certificates.find((x) => x.code === c.code); } catch { /* optional */ } }
    const facts = []; const dt = c.details || {};
    if (c.kind === "course") { if (dt.lessons) facts.push(`${AR(dt.lessons)} درساً`); if (dt.avgQuiz !== null && dt.avgQuiz !== undefined) facts.push(`متوسط الاختبارات ${pc(dt.avgQuiz)}`); }
    if (c.kind === "exam") { facts.push(`الدرجة ${pc(dt.score)}`); }
    if (c.kind === "study" && dt.attendance !== null && dt.attendance !== undefined) facts.push(`الحضور ${pc(dt.attendance)}`);
    if (c.kind === "mentorship" && dt.sessions) facts.push(`${AR(dt.sessions)} جلسة إرشاد مكتملة`);
    const mc = c.kind === "mentorship";
    box.innerHTML = `${d.valid ? `<div class="ex-state ok" role="status"><span aria-hidden="true">✓</span><div>شهادة صحيحة وموقّعة<small>التوقيع الرقمي سليم ومطابق لمفتاح مجتمع بلس المعلن</small></div></div>` : `<div class="ex-state bad" role="alert"><span aria-hidden="true">✕</span><div>${c.status === "revoked" ? "سُحبت هذه الشهادة" : "التوقيع غير صحيح"}<small>${h(c.revokeReason || "")}</small></div></div>`}
      <article class="ex-cert ${c.status === "revoked" ? "revoked" : ""}" aria-label="الشهادة"><div class="in"><span class="k">${KIND[c.kind][0]} ${h(c.kindLabel)}</span><div class="hd">${mc ? "شهادة إتمام إرشاد" : `شهادة ${c.kind === "exam" ? "اجتياز" : "إتمام"}`}</div><div class="by">${mc ? "يشهد المرشد" : "تشهد"} <bdi>${h(c.issuer)}</bdi> بأن</div><div class="who"><bdi>${h(c.holder)}</bdi></div><div class="t">${mc ? "أتمّ برنامج الإرشاد" : c.kind === "exam" ? "اجتاز" : "أتمّ"} «<bdi>${h(c.title)}</bdi>»</div>${facts.length ? `<div class="u-mt6 by">${h(facts.join(" · "))}</div>` : ""}${mc && dt.note ? `<div class="u-mt6 by"><bdi>${h(dt.note)}</bdi></div>` : ""}<div class="u-mt10 by">${h(dateAr(c.issuedAt))}${dt.teacher ? " · " + h(dt.teacher) : ""}</div><div class="u-mt10"><code>${h(c.code)}</code></div></div></article>
      <div class="ex-row"><a class="btn" href="/cert/${enc(c.code)}" target="_blank" rel="noopener">صفحة الشهادة للطباعة</a><button class="btn ghost" type="button" id="ex-print"><svg class=ix aria-hidden=true><use href=#i-doc /></svg> طباعة</button><button class="btn ghost" type="button" id="ex-share"><svg class=ix aria-hidden=true><use href=#i-link /></svg> مشاركة رابط التحقق</button></div>
      ${mine ? `<div class="ex-card"><label class="u-t-md ex-sw"><input type="checkbox" id="ex-vis" ${mine.visibility === "public" ? "checked" : ""}> إظهارها في ملفي الشخصي</label><p class="u-m0 ex-sub">حتى المخفية يمكن التحقق منها بالرمز. تحقق منها ${AR(mine.verifications)} مرة.</p></div>` : ""}
      <div id="ex-iss"></div>`;
    $("#ex-share").addEventListener("click", async () => { try { if (navigator.share) await navigator.share({ title: c.title, text: `شهادة ${c.kindLabel}: ${c.title}`, url }); else { await navigator.clipboard.writeText(url); say("✓ نُسخ الرابط"); } } catch { /* cancelled */ } });
    $("#ex-print")?.addEventListener("click", () => window.print());
    $("#ex-vis")?.addEventListener("change", async (e) => { try { await api("PATCH", "/api/certificates/" + enc(c.code), { visibility: e.target.checked ? "public" : "unlisted" }); say(e.target.checked ? "✓ تظهر في ملفك" : "أُخفيت من ملفك"); } catch (x) { say(x.message); e.target.checked = !e.target.checked; } });
    // issuer tools: teachers / group admins of the issuing group (the server checks again)
    if (d.canManage) {
      const iss = $("#ex-iss");
      iss.innerHTML = `<details class="ex-card"><summary class="u-mh44 u-dflex u-aic u-fw7 u-cp">أدوات الجهة المانحة</summary><form class="ex-f" id="ex-rv">${c.status === "revoked" ? `<button class="btn ghost" type="button" id="ex-restore">إعادة الشهادة</button>` : `<label>سبب السحب<input name="reason" minlength="3" maxlength="300" required></label><button class="u-c-dg btn ghost" type="submit">سحب الشهادة</button>`}</form></details>`;
      $("#ex-rv").addEventListener("submit", async (e) => { e.preventDefault(); if (!confirm("سحب الشهادة يظهر لكل من يتحقق منها. متابعة؟")) return; try { await api("POST", `/api/certificates/${enc(c.code)}/revoke`, { reason: e.target.reason.value.trim() }); say("سُحبت الشهادة"); certView(code); } catch (x) { say(x.message); } });
      $("#ex-restore")?.addEventListener("click", async () => { try { await api("POST", `/api/certificates/${enc(c.code)}/restore`); say("✓ أُعيدت"); certView(code); } catch (x) { say(x.message); } });
    }
  }
  function verifyView() {
    page("التحقق من شهادة", `<form id="ex-vf" class="ex-card"><label for="ex-code" class="u-db u-fw7 u-mb8">اكتب رمز التحقق المطبوع على الشهادة</label><div class="ex-code"><input id="ex-code" name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="MP-XXXX-XXXX" maxlength="16"><button class="btn" type="submit">تحقق</button></div></form><p class="ex-sub">أو امسح رمز QR على الشهادة بكاميرا جوالك. التحقق مجاني ولا يحتاج حساباً.</p>`, ["#/certificates", "شهاداتي"]);
    $("#ex-vf").addEventListener("submit", (e) => { e.preventDefault(); const v = e.target.code.value.trim(); if (v) location.hash = "#/cert/" + enc(v.toUpperCase()); });
  }

  /* =================== M5-1/F11: #/mentor-certs =================== */
  async function mentorCertsView() {
    const minor = qs().get("minor");
    if (minor) {
      page("شهادات الإرشاد", `<div id="ex-mc">${skel(2)}</div>`, ["#/mentors?tab=family", "العائلة"], "شهادات إتمام الإرشاد للحساب المرتبط بك.");
      let d; try { d = await api("GET", "/api/guardian/certificates/" + enc(minor)); } catch (e) { const b = $("#ex-mc"); if (b) b.innerHTML = errBox(e); return; }
      const box = $("#ex-mc"); if (!box) return;
      box.innerHTML = d.certificates.length ? `<div class="ex-cl">${d.certificates.map(certCard).join("")}</div>` : `<div class="empty ex-empty"><b>لا شهادات إرشاد بعد</b>تظهر هنا حين يمنح المرشد شهادة إتمام.</div>`;
      return;
    }
    page("شهادات الإتمام", `<div id="ex-mc">${skel(2)}</div>`, ["#/mentoring", "لوحة المرشد"], "امنح متدرّبك شهادة إتمام موقّعة بعد جلسة مكتملة واحدة على الأقل — يتحقق منها أي أحد برمزها.");
    if (!signed()) { $("#ex-mc").innerHTML = `<div class="empty ex-empty">سجّل الدخول لإدارة شهادات الإتمام</div>`; return; }
    let d; try { d = await api("GET", "/api/mentor-certificates"); } catch (e) { const b = $("#ex-mc"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#ex-mc"); if (!box) return;
    const L = d.limits, todo = d.mentees.filter((m) => !m.certificate);
    box.innerHTML = `<h3>متدرّبون أتمّوا جلسات</h3>${todo.length ? `<div class="ex-mc">${todo.map((m) => `<details class="ex-card" data-m="${h(m.id)}"><summary class="u-mh44 u-dflex u-aic u-fw7 u-cp"><span class="ex-grow"><bdi>${h(m.name)}</bdi> <span class="ex-m"><span><bdi>${AR(m.sessions)}</bdi> <span>جلسة مكتملة</span></span>${m.minor ? "<span>دون ١٨</span>" : ""}</span></span></summary>
      <form class="ex-f" novalidate><label>عنوان الشهادة<input name="title" required minlength="3" maxlength="${L.title}" placeholder="مثال: برنامج إرشاد تطوير الويب" aria-describedby="mc-t-${h(m.id)}"></label><p class="u-m0 ex-cnt2" id="mc-t-${h(m.id)}" aria-live="polite">0/${AR(L.title)}</p>
      <label>ملاحظة من المرشد (اختياري)<textarea name="note" maxlength="${L.note}" aria-describedby="mc-n-${h(m.id)}"></textarea></label><p class="u-m0 ex-cnt2" id="mc-n-${h(m.id)}" aria-live="polite">0/${AR(L.note)}</p>
      ${m.minor ? `<p class="u-m0 ex-sub">لحماية المتدرّب تظهر الشهادة بالاسم الأول والحرف الأول فقط، ولا تُعرض على ملفه، ويطّلع عليها وليّ أمره.</p>` : ""}<button class="btn" type="submit"><svg class=ix aria-hidden=true><use href=#i-medal /></svg> إصدار الشهادة</button></form></details>`).join("")}</div>`
      : `<div class="empty ex-empty"><b>${d.mentees.length ? "منحت كل متدرّبيك شهاداتهم" : "لا متدرّبين أتمّوا جلسات بعد"}</b>تُمنح الشهادة بعد جلسة مكتملة واحدة على الأقل مع المتدرّب.</div>`}
      <h3>شهادات أصدرتها</h3>${d.certificates.length ? `<div class="ex-cl">${d.certificates.map(certCard).join("")}</div>` : `<div class="empty ex-empty">لم تُصدر شهادات بعد</div>`}`;
    box.querySelectorAll("details[data-m] form").forEach((f) => {
      const mid = f.closest("details").dataset.m;
      const cnt = () => { $(`#mc-t-${CSS.escape(mid)}`).textContent = `${AR([...f.title.value].length)}/${AR(L.title)}`; $(`#mc-n-${CSS.escape(mid)}`).textContent = `${AR([...f.note.value].length)}/${AR(L.note)}`; };
      f.addEventListener("input", cnt);
      f.addEventListener("submit", async (e) => {
        e.preventDefault(); const t = f.title.value.trim(); if (t.length < 3) { say("اكتب عنوان الشهادة (٣ أحرف على الأقل)"); f.title.focus(); return; }
        const b = f.querySelector("button[type=submit]"); b.disabled = true;
        try { const r = await api("POST", "/api/mentor-certificates", { menteeId: mid, title: t, note: f.note.value.trim() }); say(r.created ? "✓ صدرت الشهادة" : "سبق إصدار شهادة لهذا المتدرّب"); location.hash = "#/cert/" + enc(r.certificate.code); }
        catch (x) { say(x.message); b.disabled = false; }
      });
    });
  }

  MPRoutes.extend((a, b) => ({ exams: () => listView(),
    exam: () => (a === "new" ? builderView(null) : b === "edit" ? builderView(a) : b === "results" ? resultsView(a) : examView(a)),
    attempt: () => attemptView(a), certificates: () => myCertsView(), cert: () => certView(a), "verify-cert": () => verifyView(), "mentor-certs": () => mentorCertsView() }));
  window.MPCerts = { listView, examView, attemptView, builderView, resultsView, myCertsView, certView, verifyView, mentorCertsView, version: "__APP_VERSION__" };
  if (/^#\/(exams|exam|attempt|certificates|cert|verify-cert|mentor-certs)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
