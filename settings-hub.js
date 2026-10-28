/* =====================================================================
 * مجتمع بلس — v2.81 «setx» lazy chunk: the settings hub (v2 cards + v2.38 sections/sub-pages/search) left the core bundle.
 * v12.js keeps a one-line MPSettings hook at the same registration position that forwards to window.MPSettingsV2, so the
 * hooks still run in their original order. chunks.js loads this chunk before #/settings renders.
 * ===================================================================== */
/* ---------- Settings v2 ---------- */
window.MPSettingsV2 = function () {
  const ver = $("#ver"); if (ver) ver.textContent = VERSION;
  const S2 = DB.settings;
  const first = view.querySelector(".wrap .card");
  first.insertAdjacentHTML("beforebegin", `
    <div class="card"><b>اللغة والمظهر</b>
      <div class="seg"><button data-lang="ar" class="${S2.lang === "ar" ? "on" : ""}">العربية (RTL)</button><button data-lang="en" class="${S2.lang === "en" ? "on" : ""}">English (LTR)</button></div>
      <div class="seg"><button data-theme="system" class="${S2.theme === "system" ? "on" : ""}">تلقائي</button><button data-theme="light" class="${S2.theme === "light" ? "on" : ""}">فاتح</button><button data-theme="dark" class="${S2.theme === "dark" ? "on" : ""}">داكن</button></div></div>
    <div class="card"><b>التحكم بالمحتوى</b>
      <div class="list flat">${UI.li({ href: "#/interests", icon: "target", title: "مركز الاهتمامات" })}</div>
      <h4>لغات المحتوى</h4><label class="chk"><input type="checkbox" data-cl="ar" ${S2.languages.includes("ar") ? "checked" : ""}> العربية</label><label class="chk"><input type="checkbox" data-cl="en" ${S2.languages.includes("en") ? "checked" : ""}> English</label>
      <h4>أنواع المحتوى</h4>${[["video", "الفيديو"], ["article", "المقالات"], ["poll", "الاستطلاعات"]].map(([k, l]) => `<label class="chk"><input type="checkbox" data-ct2="${k}" ${S2.contentTypes[k] ? "checked" : ""}> ${l}</label>`).join("")}
      <h4>المحتوى الحساس</h4><select id="sens2"><option value="show">إظهار</option><option value="warn">تحذير قبل العرض</option><option value="hide">إخفاء</option></select></div>
    <section class="set-grp"><h3 class="set-h">السلامة</h3><div class="list">${UI.li({ href: "#/decisions", icon: "flag", title: "القرارات على حسابي والاستئناف" })}${UI.li({ href: "#/admin", icon: "shield", title: "لوحة الإدارة (للمشرفين)" })}</div></section>`);
  $("#sens2").value = S2.sensitive;
  view.querySelectorAll("[data-lang]").forEach(b => b.onclick = () => { S2.lang = b.dataset.lang; save(); applyShell(); rerender(); });
  view.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => { S2.theme = b.dataset.theme; save(); applyShell(); rerender(); });
  view.querySelectorAll("[data-cl]").forEach(c => c.onchange = () => { S2.languages = c.checked ? [...new Set([...S2.languages, c.dataset.cl])] : S2.languages.filter(x => x !== c.dataset.cl); save(); });
  view.querySelectorAll("[data-ct2]").forEach(c => c.onchange = () => { S2.contentTypes[c.dataset.ct2] = c.checked; save(); });
  $("#sens2").onchange = e => { S2.sensitive = e.target.value; save(); };
  msgAiSetting();
  orgSettings();
};
/* v2.134: Settings switch for «الذكاء في الرسائل» (stored per account: user_prefs ai.messages; the server enforces it too) */
function msgAiSetting() {
  if (typeof Remote === "undefined" || !Remote.on || !DB.me || document.getElementById("msgai-set")) return;
  const first = view.querySelector(".wrap .card"); if (!first) return;
  first.insertAdjacentHTML("beforebegin", `<div class="card row" id="msgai-set"><b>الذكاء الاصطناعي في الرسائل</b><p class="muted">تلخيص ما فاتك واقتراح الردود. لا يعمل في المحادثات المشفرة</p><input type="checkbox" id="msgai-sw" checked></div>`);
  const sw = document.getElementById("msgai-sw");
  Remote.api("GET", "/api/aihub/messages/state").then((r) => { sw.checked = r.on !== false; }).catch(() => { });
  sw.addEventListener("change", async () => {
    const on = sw.checked;
    try { await Remote.api("PUT", "/api/prefs", { ns: "ai", values: { messages: on } }); window.dispatchEvent(new Event("mp:msgai")); toast(on ? "شُغّل الذكاء الاصطناعي في الرسائل" : "أُوقف الذكاء الاصطناعي في الرسائل"); }
    catch (e) { sw.checked = !on; toast(e.message); }
  });
}
/* v2.38 Settings: a hub of a few clear sections + one sub-page per section (#/settings?s=<key>) + search.
 * Feature modules (many lazy) still add their own entry cards to #/settings whenever they load; every entry becomes a row
 * filed into its section (ids, hrefs and listeners kept), duplicates (same link twice) are dropped, and rows keep one fixed
 * order (the v2.36 row-order fix). A MutationObserver files late arrivals while #/settings is open. Nothing is removed:
 * every setting stays reachable from its section and from the search. */
const SET_SECS = [["acct", "الحساب", "user", "التوثيق، الحسابات المتعددة، أدوات المبدع والنقاط"], ["privacy", "الخصوصية والأمان", "lock", "الدخول والأجهزة، من يراك ويراسلك، الحظر، بياناتك"],
  ["notif", "الإشعارات والوقت", "bell", "ما يصلك وأوقات الهدوء، الرفاهية الرقمية"], ["content", "المحتوى والخلاصة", "target", "الاهتمامات والمكتوم، ترتيب الخلاصة، الترجمة، الإعلانات"],
  ["display", "المظهر واللغة", "palette", "اللغة والسمة، الخط وإمكانية الوصول، التطبيق"], ["money", "المدفوعات والمحفظة", "wallet", "مجتمع كوين، حساب Pi، مشترياتي، الاشتراكات"],
  ["family", "الأسرة والحماية", "users", "العمر والمحتوى الحساس، ربط وليّ الأمر"], ["help", "المساعدة والقانوني", "help", "المساعدة والدعم، السياسات والشروط، عن التطبيق"],
  ["admin", "الإدارة", "shield", "لوحة الإدارة وأدوات المشرفين"]];
/* row key (href or id) → section, [title, helper] (empty keeps the module's own text); order inside a section = order here */
const SET_ROWS = [["msgai-set", "privacy", "الذكاء الاصطناعي في الرسائل", "تلخيص ما فاتك واقتراح الردود. لا يعمل في المحادثات المشفرة"], ["#/verify", "acct"], ["#/integrity", "acct"], ["#/orgs", "acct"], ["#/studio", "acct"], ["#/cv", "acct", "الملف المهني والسيرة الذاتية", "خبراتك ومهاراتك وأعمالك ومن يراها"], ["#/jobs", "acct", "الوظائف والعمل الحر", "فرص العمل والمشاريع، إعلاناتك وطلباتك"], ["#/contracts", "acct", "العقود", "مراحل العمل والتسليم والضمان"], ["#/teams", "acct", "الفرق والمشاريع", "مهام وملفات ونقاشات مع فريقك"], ["#/reviews", "acct", "التقييمات المهنية", "قيّم من عملت معهم وتابع سمعتك"], ["#/points", "acct", "نقاط المساهمة", "مستواك وسجل نقاطك"], ["#/leaderboard", "acct", "لوحة الصدارة", "أكثر الأعضاء مساهمة"],
  ["#/security", "privacy"], ["#/privacy", "privacy"], ["#/protection", "privacy", "الحظر والكتم ووضع الحماية", "من تحظره وتكتمه، والحماية من الإزعاج"], ["#/mydata", "privacy"], ["#/decisions", "privacy", "القرارات على حسابي", "البلاغات والاستئناف"],
  ["#/notifsettings", "notif"], ["#/wellbeing", "notif"],
  ["#/feedprefs", "content"], ["#/settings/translate", "content", "تفضيلات الترجمة", "لغة الترجمة والترجمة التلقائية"], ["#/settings/ads", "content", "تفضيلات الإعلانات", "اهتمامات الإعلانات وما تخفيه منها"],
  ["#/settings/language", "display", "لغة الواجهة", "العربية، English"], ["#/settings/appearance", "display"], ["#/settings/display", "display"], ["ds", "display"], ["#/app", "display"],
  ["#/mjt", "money", "مجتمع كوين (MJT)", "رصيدك داخل التطبيق، سجله وطرق كسبه"], ["#/wallet", "money"], ["#/me/purchases", "money", "مشترياتي", "ما اشتريته من محتوى ومنتجات"], ["#/purchases", "money", "مشترياتي", "ما اشتريته من محتوى ومنتجات"], ["#/me/paid-posts", "money", "منشوراتي المدفوعة", "المحتوى الذي تبيعه"],
  ["#/ai", "money", "اشتراك مجتمع+ ذكاء", "الترجمة الآلية والمساعد الذكي"], ["#/creator", "money", "الإكراميات ودعم المبدع", "استقبال الدعم والإحصائيات"], ["#/ads", "money", "حملاتي الإعلانية", "روّج منشوراتك بميزانية Pi"],
  ["#/age", "family"], ["#/family", "family"],
  ["#/faq", "help", "الأسئلة الشائعة", "شروحات وإجابات سريعة"], ["#/tickets", "help", "تذاكر الدعم", "راسل فريق الدعم وتابع ردوده"], ["#/help", "help", "المساعدة العاجلة والدعم النفسي", "جهات الدعم والإبلاغ العاجل"],
  ["bt-fab", "help"], ["replay-tour", "help"], ["#/beta", "help", "النسخة التجريبية", "الموجات وملاحظاتك"], ["#/ambassadors", "help", "سفراء المجتمع", "انضم لبرنامج السفراء"], ["#/policies", "help", "سياسات المحتوى", "ما يُسمح به وما لا يُسمح"],
  ["#/legal", "help"], ["#/developers", "help", "بوابة المطورين", "التطبيقات ومفاتيح API"], ["#/developers/docs", "help", "وثائق المطورين", "REST وOAuth والويب هوك"], ["#/about", "help", "عن مجتمع بلس", "الإصدار والقيم وفريق العمل"],
  ["#/admin", "admin", "لوحة الإدارة", "للمشرفين"], ["#/safety-cases", "admin"], ["#/admin/beta", "admin", "إدارة التجربة"], ["#/admin/points", "admin", "إدارة النقاط"]];
const SET_CARDS = [[/^(pi-set$|Pi Network|π)/, "money"], [/^اللغة والمظهر/, "display", "اللغة والسمة"], [/^التحكم بالمحتوى/, "content"], [/^إدارة ما تراه/, "content"], [/^سجل القرارات والبلاغات/, "privacy"], [/^أخرى/, "help", "متقدّم"]];
const SET_ICO = { "msgai-set": "sparkle", "#/cv": "building", "#/jobs": "bag", "#/contracts": "shield", "#/teams": "users", "#/reviews": "star", "#/security": "lock", "#/privacy": "eye", "#/integrity": "verified", "#/verify": "verified", "#/age": "user", "#/family": "users", "#/orgs": "building", "#/mydata": "download", "#/safety-cases": "flag", "#/legal": "flag", "#/settings/display": "access", "#/settings/appearance": "palette", "#/settings/language": "globe", "#/settings/translate": "globe", "#/settings/ads": "target", "#/notifsettings": "bell", "#/feedprefs": "target", "#/wellbeing": "heart", "#/app": "download", "#/studio": "chart", "#/me/purchases": "bag", "#/purchases": "bag", "#/me/paid-posts": "star", "#/ads": "chart", "#/ai": "sparkle", "#/creator": "award", "#/developers": "link", "#/developers/docs": "copy", "#/beta": "feedback", "#/points": "trophy", "#/leaderboard": "trophy", "#/faq": "help", "#/help": "help", "#/tickets": "mail", "#/about": "community", "#/ambassadors": "users", "#/protection": "shield", "#/policies": "flag", "#/wallet": "wallet", "#/mjt": "wallet", "#/decisions": "flag", "#/admin": "shield" };
const setNorm = (s) => String(s || "").toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
let setObs = null;
function orgSettings() {
  const w = view.querySelector(".wrap.set-page"); if (!w || !window.UI || !/^#\/settings\/?(\?|$)/.test(location.hash)) return;
  const head = w.querySelector(".page-head"); let gs = w.querySelector(".set-grps");
  if (!gs) {
    (head || w.firstChild).insertAdjacentHTML(head ? "afterend" : "beforebegin", `<div class="set-hub"><div class="set-search"><label><span class="vh">ابحث في الإعدادات</span><input type="search" id="set-q" placeholder="${esc(window.MPI18n?.t ? MPI18n.t("ابحث في الإعدادات") : "ابحث في الإعدادات")}" autocomplete="off" maxlength="40"></label></div><div class="list set-me" hidden></div><nav class="list set-nav" aria-label="أقسام الإعدادات">${SET_SECS.map(([k, t, i, s]) => UI.li({ href: "#/settings?s=" + k, icon: i, title: t, sub: s, attrs: `data-s="${k}"` })).join("")}</nav></div>
      <div class="set-grps">${SET_SECS.map(([k, t]) => `<section class="set-sec" data-s="${k}" hidden><h3 class="set-h">${t}</h3><div class="list"></div></section>`).join("")}<p class="empty set-none" role="status" hidden>لا نتائج مطابقة في الإعدادات</p></div><div class="set-foot"><div class="list set-out"></div></div>`);
    gs = w.querySelector(".set-grps");
    const q = w.querySelector("#set-q"); q.value = view._setq || "";
    q.addEventListener("input", () => { view._setq = q.value; setView(w); });
  }
  for (const x of w.querySelectorAll(".set-sec > .list > :not([data-org]), .set-sec > :not(.list):not(.set-h):not([data-org]), .page-head .card, .page-head .bt-entry")) w.append(x); // a module inserted next to a filed row
  const meta = (key) => SET_ROWS.find((r) => r[0] === key);
  const secOf = (key) => meta(key)?.[1] || (/^#\/admin/.test(key) ? "admin" : "help");
  const sec = (k) => gs.querySelector(`.set-sec[data-s="${k}"]`);
  const put = (el, key) => { // a row into its section; the same link twice is kept once
    if (key && [...gs.querySelectorAll(".set-sec > .list > .li")].some((x) => x !== el && (x.getAttribute("href") || x.id) === key)) { el.remove(); return; }
    sec(secOf(key)).querySelector(":scope > .list").append(el);
  };
  const row = (el, key, t, sub, svg) => { const m = meta(key) || []; el.className = "li" + (el.classList.contains("danger") ? " danger" : ""); el.removeAttribute("style"); el.dataset.org = "1";
    const inp = el.querySelector(":scope input"); el.replaceChildren(); el.insertAdjacentHTML("beforeend", `<span class="ico">${svg ? "" : UI.icon(SET_ICO[key] || "settings", "sm")}</span><span class="t"><b>${esc(m[2] || t)}</b>${m[3] || sub ? `<small>${esc(m[3] || sub)}</small>` : ""}</span>`);
    if (svg) { svg.setAttribute("class", "ic sm"); el.firstChild.append(svg); }
    if (inp) { inp.classList.add("switch"); if (!inp.getAttribute("aria-label")) inp.setAttribute("aria-label", m[2] || t); el.append(inp); } else if (el.getAttribute("href")) el.insertAdjacentHTML("beforeend", `<span class="chev" aria-hidden="true">←</span>`);
    put(el, key); };
  for (const el of [...w.children]) {
    if (el === head || el.matches(".set-hub, .set-grps, .set-foot") || el.dataset.org) continue;
    const title = UI.noEmo((el.querySelector(":scope > b, :scope > h3, :scope .set-h, :scope > .row b")?.textContent || el.querySelector("b")?.textContent || "").trim());
    if (el.matches("section.set-grp") && el.querySelector("#logout")) { // the account block: profile row → top of the hub, sign-out → bottom
      const me = el.querySelector(".li:not([href]):not(button)"); if (me) { const box = w.querySelector(".set-me"); box.replaceChildren(me); box.hidden = false; }
      const out = el.querySelector("#logout"); if (out) w.querySelector(".set-out").replaceChildren(out);
      for (const a of el.querySelectorAll("a.li")) { a.dataset.org = "1"; put(a, a.getAttribute("href")); }
      el.remove(); continue;
    }
    if (el.matches("a.card, button.card, button.bt-entry, div.card.row") && el.querySelectorAll("a").length <= (el.tagName === "A" ? 0 : 1) && (el.tagName !== "DIV" || el.querySelector(":scope > input[type=checkbox]"))) {
      const href = el.getAttribute("href") || "", key = href || el.id || el.querySelector("input")?.id || "";
      const sub = [...el.querySelectorAll(".muted, p, small")].find((x) => x.textContent.trim().length > 1)?.textContent.trim() || "";
      row(el, key, title, sub, el.querySelector("svg")); continue;
    }
    if (el.querySelector("a") && !el.querySelector("input, select, textarea, .seg, button:not(.li)") && el.id !== "pi-set") { // a module's group of links → each link into its section
      for (const a of [...el.querySelectorAll("a")]) { const href = a.getAttribute("href") || ""; const t = UI.noEmo((a.querySelector(".t b") || a).textContent.trim()), sub = a.querySelector(".t small")?.textContent.trim() || ""; row(a, href, t, sub, null); }
      el.replaceChildren(); el.hidden = true; el.dataset.org = "1"; gs.append(el); continue; // keep the module's id so it does not add its card again
    }
    // a card with its own controls (language, content, Pi, …) → the end of its section
    const c = SET_CARDS.find(([re]) => re.test(el.id) || re.test(title)), k = c ? c[1] : "help";
    if (c?.[2]) { const b = el.querySelector(":scope > b, :scope > h3"); if (b && b.childElementCount === 0) b.textContent = c[2]; }
    if (/^سجل القرارات والبلاغات/.test(title) && typeof Remote !== "undefined" && Remote.on) { el.remove(); continue; } // local demo log: on the server the same record is #/decisions
    const ver = el.querySelector("#ver"); if (ver) w.querySelector(".set-foot").append(ver.closest("p") || ver);
    el.dataset.org = "1"; el.classList.add("set-card"); el.removeAttribute("style"); sec(k).append(el);
  }
  for (const l of gs.querySelectorAll(".set-sec > .list")) { // one fixed order inside each section
    const rows = [...l.children], rk = (x) => { const i = SET_ROWS.findIndex((r) => r[0] === (x.getAttribute("href") || x.id)); return i < 0 ? 999 : i; }, sorted = [...rows].sort((x, y) => rk(x) - rk(y));
    if (sorted.some((x, i) => x !== rows[i])) l.append(...sorted);
  }
  setView(w);
  if (!setObs) setObs = new MutationObserver(() => { if (!/^#\/settings\/?(\?|$)/.test(location.hash) || !view.querySelector(".wrap.set-page")) return; orgSettings(); });
  setObs.disconnect(); setObs.observe(w, { childList: true }); if (head) setObs.observe(head, { childList: true, subtree: true });
  for (const s of w.querySelectorAll(".set-sec > .list")) setObs.observe(s, { childList: true });
}
/* hub · one section · search results */
function setView(w) {
  const s = new URLSearchParams(location.hash.split("?")[1] || "").get("s"), cur = SET_SECS.find((x) => x[0] === s), q = setNorm(view._setq), gs = w.querySelector(".set-grps");
  const mode = cur ? "sec" : q ? "find" : "hub"; w.dataset.sv = mode;
  const filled = (el) => !!(el.querySelector(".list > .li") || el.querySelector(".set-card"));
  for (const el of gs.querySelectorAll(".set-sec")) {
    const k = el.dataset.s; let show = mode === "sec" ? k === s : mode === "find" && filled(el);
    if (mode === "find") { const all = setNorm(el.querySelector(".set-h").textContent).includes(q); let any = all;
      for (const r of el.querySelectorAll(".list > .li, .set-card")) { const m = all || setNorm(r.textContent).includes(q); r.hidden = !m; any = any || m; } show = any; }
    else for (const r of el.querySelectorAll(".list > .li, .set-card")) r.hidden = false;
    el.hidden = !show;
    const nav = w.querySelector(`.set-nav [data-s="${k}"]`); if (nav) nav.hidden = !filled(el);
  }
  w.querySelector(".set-none").hidden = !(mode === "find" && ![...gs.querySelectorAll(".set-sec")].some((x) => !x.hidden));
  w.querySelector(".set-nav").hidden = mode !== "hub"; w.querySelector(".set-me").hidden = mode !== "hub" || !w.querySelector(".set-me > .li"); w.querySelector(".set-hub").hidden = mode === "sec"; w.querySelector(".set-foot").hidden = mode === "sec";
  const h2 = w.querySelector(".page-head h2"), back = w.querySelector(".page-head .back"), title = cur ? cur[1] : "الإعدادات";
  if (h2 && h2.textContent !== title) h2.textContent = title;
  if (back) { const want = cur ? ["#/settings", "الإعدادات"] : ["#/menu", "المزيد"]; if (back.getAttribute("href") !== want[0]) { back.setAttribute("href", want[0]); back.innerHTML = `<span class="fwd" aria-hidden="true">→</span> ${want[1]}`; } }
  if (view._setsec !== (cur ? s : "")) { view._setsec = cur ? s : ""; scrollTo(0, 0); }
}
/* dev mode (no build): this script arrives after the first route() — repaint #/settings once */
if (!(window.__CHUNKS || {}).setx && typeof route === "function" && /^#\/settings\/?(\?|$)/.test(location.hash)) route();
