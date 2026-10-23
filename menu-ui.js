/* =====================================================================
 * مجتمع بلس — v2.52 «المزيد» hub (#/menu, lazy chunk "menu" + menu.css, after the feat chunk for its icons)
 * Every screen of the app that is not one of the four main tabs is listed here, once, in a clear category —
 * nothing is removed or hidden: Pi screens sit in their category with a «غير مفعّل بعد» tag while Pi payments are off,
 * and the admin category appears for staff. Search filters every entry (Arabic-normalised, English aliases too).
 * The same catalogue names deep screens in the top bar (MPMenu.find) and is what the e2e reachability test checks.
 * ===================================================================== */
(function MenuHub() {
  const ic = (n, c = "sm") => UI.icon(n, c);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  /* [route, title, icon, subtitle, flags]  flags: p = needs Pi payments (tagged while off) · k = extra search words */
  const CATS = [
    { id: "you", t: "أنت", i: "user", items: [
      ["me", "ملفك الشخصي", "user", "منشوراتك ومتابعوك وصورتك"], ["city", "مدينة المجتمع الرقمية", "building", "مدينتك وشخصيتك وقاعة مجتمع كوين"], ["aihub", "مركز الذكاء", "sparkle", "اربط حسابك في الذكاء الاصطناعي واستخدمه هنا"], ["library", "المحفوظات", "bookmark", "مجموعاتك وما حفظته لتقرأه لاحقاً"], ["lists", "قوائم الأشخاص", "users", "قوائمك وقوائم تتابعها"],
      ["interests", "الاهتمامات", "target", "المواضيع التي تهمّك"], ["purchases", "مشترياتي", "bag", "المحتوى المدفوع والمنتجات الرقمية"], ["points", "نقاط المساهمة", "award", "رصيدك ومستواك"],
      ["leaderboard", "لوحة الصدارة", "trophy", "الأكثر مساهمة"], ["verify", "طلب التوثيق", "verified", "شارة التوثيق لحسابك"], ["integrity", "التحقق والثقة", "shield", "الجوال وهوية Pi وإشارات الثقة"],
      ["orgs", "المؤسسات", "building", "حساب لجهتك وفريقك"], ["beta", "النسخة التجريبية", "feedback", "الموجات والملاحظات"]] },
    { id: "connect", t: "التواصل", i: "mail", items: [
      ["messages", "الرسائل", "mail", "المحادثات والمجموعات"], ["notifications", "الإشعارات", "bell", "التفاعلات والإشارات"], ["calls", "المكالمات", "phone", "سجل المكالمات الصوتية والمرئية"],
      ["newgroup", "مجموعة جديدة", "users", "محادثة جماعية"], ["message-requests", "طلبات الرسائل", "mail", "رسائل ممن لا تتابعهم"], ["e2ee", "التشفير طرفاً لطرف", "lock", "كيف تُحمى رسائلك"],
      ["devices", "الأجهزة المرتبطة", "link", "مفاتيح التشفير لكل جهاز"]] },
    { id: "discover", t: "اكتشف", i: "compass", items: [
      ["explore", "استكشف", "compass", "الرائج والمواضيع"], ["search", "البحث", "search", "منشورات وأشخاص ومجتمعات ووسوم"], ["trends", "الترند", "fire", "عالمي وحسب اللغة والموضوع"],
      ["digest", "فاتك اليوم", "sparkle", "خلاصة آخر ٢٤ ساعة"], ["shorts", "فيديوتك", "film", "مقاطع فيديو عمودية قصيرة"], ["clips/challenges", "تحديات فيديوتك", "trophy", "تحدٍّ أسبوعي بوسم — صوّر لقطتك وتنافس"], ["rooms", "الغرف الصوتية", "mic", "نقاشات صوتية مباشرة"],
      ["nearby", "بالقرب منك", "mapPin", "ما حولك بمنطقة تقريبية"], ["places", "أماكني", "pin", "الأماكن التي أضفتها"], ["cities", "المدن", "building", "أماكن كل مدينة"],
      ["hijri", "التقويم الهجري", "moon", "أم القرى والمواسم"]] },
    { id: "community", t: "المجتمعات والخير", i: "community", items: [
      ["communities", "المجتمعات", "users", "مساحات حول اهتماماتك"], ["cadmin", "مجتمعاتي التي أديرها", "settings", "لوحة إدارة لكل مجتمع تملكه أو تشرف عليه"], ["events", "الأحداث", "cal", "الفعاليات القادمة"], ["giving", "التطوّع والخير", "hand", "حملات وفرص تطوّع موثّقة"],
      ["ambassadors", "سفراء المجتمع", "medal", "يرحّبون بالقادمين الجدد"]] },
    { id: "create", t: "الإبداع والنشر", i: "pen", items: [
      ["studio", "استوديو المنشئ", "chart", "التقويم وأفضل وقت للنشر"], ["analytics", "التحليلات المتقدمة", "chart", "الجمهور والمحتوى"], ["drafts", "المسودات", "doc", "تتزامن بين أجهزتك"],
      ["scheduled", "النشر المجدول", "clock", "منشورات بموعد"], ["series", "السلاسل", "book", "حلقات مرتبة"], ["collabs", "التعاونات والرعايات", "link", "اتفاقات بإفصاح واضح"],
      ["creator-program", "الصنّاع الموثّقون", "verified", "برنامج التوثيق والدعم"], ["fund", "صندوق دعم الصنّاع", "gift", "منح بأرقام معلنة"],
      ["creator", "إعدادات المبدع", "sparkle", "المستويات والمزايا", "p"], ["subscribers", "المشتركون", "users", "من يدعمك شهرياً", "p"],
      ["me/paid-posts", "منشوراتي المدفوعة", "lock", "المحتوى المدفوع", "p"], ["ads", "حملاتي الإعلانية", "mega", "روّج منشوراتك دون تتبّع", "p"]] },
    { id: "learn", t: "التعلّم والمعرفة", i: "cap", items: [
      ["study", "مجموعات الدراسة والحلقات", "users", "مجموعات وحلقات قرآن"], ["courses", "الدورات", "cap", "تعلّم بخطوتك"], ["exams", "الاختبارات", "doc", "تُصحَّح على الخادم"],
      ["certificates", "شهاداتي", "award", "شهادات موقّعة رقمياً"], ["verify-cert", "التحقق من شهادة", "verified", "برمز أو QR"], ["knowledge", "المكتبة المعرفية", "book", "معرفة مفتوحة بمراجعة"],
      ["mentors", "الإرشاد", "bulb", "جلسات مع أصحاب الخبرة"], ["mentoring", "لوحة المرشد", "bulb", "شارك خبرتك"],
      ["mentor-certs", "شهاداتي في الإرشاد", "award", "شهادات إتمام الإرشاد"]] },
    { id: "work", t: "العمل والمهن", i: "brief", items: [
      ["cv", "ملفي المهني", "doc", "سيرتك الذاتية"], ["talent", "دليل المواهب", "users", "ابحث بمهارة أو مدينة"], ["jobs", "الوظائف والعمل الحر", "brief", "فرص ومشاريع"],
      ["contracts", "العقود", "doc", "مراحل وضمان"], ["teams", "الفرق والمشاريع", "users", "مهام وملفات وتحديثات"], ["reviews", "التقييمات المهنية", "star", "من عقود مكتملة فقط"],
      ["biz", "أعمال محلية", "store", "أنشطة تقبل Pi"]] },
    { id: "money", t: "المحفظة والمتجر", i: "wallet", items: [
      ["mjt", "مجتمع كوين (MJT)", "coin", "رصيدك داخل التطبيق"], ["wallet", "محفظة Pi", "wallet", "التحويلات والطلبات", "p"], ["transfers", "التحويلات", "swap", "بين الأعضاء", "p"],
      ["statement", "كشف الحساب", "doc", "كل حركة Pi", "p"], ["annual", "التقرير السنوي", "chart", "ملخص سنتك", "p"], ["market", "السوق", "bag", "منتجات وطلبات"],
      ["digital", "المنتجات الرقمية", "box", "كتب وقوالب ودورات"], ["subs", "الاشتراك الشهري", "star", "صنّاع تدعمهم", "p"], ["supporting", "من أدعمهم", "heart", "الإكراميات والدعم", "p"],
      ["earnings", "الأرباح", "coin", "إكرامياتك ومبيعاتك", "p"], ["ai", "مجتمع+ ذكاء", "sparkle", "الترجمة والمساعد", "p"], ["finance-report", "الشفافية المالية", "chart", "أرقام المنصة المجمّعة"]] },
    { id: "safety", t: "الأمان والخصوصية", i: "shield", items: [
      ["security", "مركز الأمان", "shield", "التحقق بخطوتين ومفاتيح المرور"], ["privacy", "الخصوصية", "lock", "من يرى ملفك ويراسلك"], ["protection", "وضع الحماية", "shield", "عند موجة إساءة"],
      ["mydata", "بياناتي وخصوصيتي", "download", "تنزيل بياناتك والموافقات"], ["my-reports", "بلاغاتي", "flag", "ما أبلغت عنه"], ["account-log", "سجل قرارات حسابي", "doc", "كل قرار مع سببه"],
      ["age", "العمر والمحتوى الحساس", "user", "حماية أفضل"], ["family", "الإعدادات العائلية", "users", "ولي الأمر والحساب المرتبط"], ["urgent", "بلاغ عاجل", "alert", "للحالات الخطيرة"],
      ["wellbeing", "الرفاهية الرقمية", "clock", "وقت الاستخدام والتذكيرات"]] },
    { id: "help", t: "المساعدة والمعلومات", i: "help", items: [
      ["help", "مركز المساعدة والأمان", "help", "إرشادات وتوعية"], ["faq", "الأسئلة الشائعة", "help", "شروحات وإجابات سريعة"], ["tickets", "تذاكر الدعم", "ticket", "راسل فريق الدعم"],
      ["policies", "سياسات المحتوى", "doc", "إرشادات المجتمع"], ["legal", "الشروط والخصوصية", "doc", "بلغة واضحة"], ["transparency", "تقارير الشفافية", "chart", "أرقام شهرية مجمّعة"],
      ["about", "عن مجتمع بلس", "sparkle", "من نحن"], ["waitlist", "قائمة الانتظار", "clock", "الدعوات والتسجيل"], ["app", "التطبيق", "download", "التثبيت والإشعارات"],
      ["developers", "بوابة المطورين", "code", "REST وOAuth وWebhooks"]] },
    { id: "settings", t: "الإعدادات", i: "settings", items: [
      ["settings", "كل الإعدادات", "settings", "بحث في كل الإعدادات"], ["settings?s=acct", "الحساب", "user", "التوثيق والحسابات المتعددة"], ["settings?s=privacy", "الخصوصية والأمان", "lock", "الدخول والأجهزة والحظر"],
      ["settings?s=notif", "الإشعارات والوقت", "bell", "ما يصلك وأوقات الهدوء"], ["settings?s=content", "المحتوى والخلاصة", "target", "الاهتمامات والترتيب والترجمة"], ["settings?s=display", "المظهر واللغة", "palette", "اللغة والخط والسمة"],
      ["settings?s=money", "المدفوعات والمحفظة", "wallet", "مجتمع كوين وPi والاشتراكات"], ["settings?s=family", "الأسرة والحماية", "users", "العمر والإعدادات العائلية"], ["settings?s=help", "المساعدة والقانوني", "help", "الدعم والشروط"],
      ["settings/appearance", "المظهر والتخصيص", "palette", "السمات والكثافة وترتيب الشريط"], ["settings/display", "العرض وإمكانية الوصول", "access", "حجم الخط والتباين والحركة"], ["settings/language", "اللغة", "globe", "العربية و English"],
      ["settings/translate", "تفضيلات الترجمة", "globe", "الترجمة الآلية"], ["settings/ads", "تفضيلات الإعلانات", "mega", "إعلانات حسب اهتماماتك"], ["notifsettings", "الإشعارات والبريد", "bell", "قنوات الإشعارات"],
      ["emailprefs", "تفضيلات البريد", "mail", "الملخصات والتنبيهات"], ["feedprefs", "الخلاصة والملخصات", "sliders", "الترتيب والتبويبات"]] },
    { id: "admin", t: "الإدارة", i: "shield", staff: true, items: [
      ["admin", "لوحة الإدارة", "shield", "كل أدوات المشرفين"], ["settings?s=admin", "إعدادات الإدارة", "settings"], ["staff", "طابور الدعم", "ticket"], ["trust", "الثقة والنمو", "verified"],
      ["investigations", "لوحة التحقيقات", "search"], ["safety-cases", "طابور السلامة", "alert"], ["compliance", "الامتثال وحماية البيانات", "lock"], ["status", "حالة النظام", "chart"],
      ["admin/security", "أمان المنصة", "shield"], ["admin/ops", "العمليات والمراقبة", "chart"], ["admin/activation", "التفعيل", "check"], ["admin/pi-activation", "تفعيل مدفوعات Pi", "wallet"], ["admin/pi", "مطابقة مدفوعات Pi", "wallet"],
      ["admin/transfers", "تحويلات قيد المراجعة", "swap"], ["admin/finance", "التقارير المالية والمطابقة", "doc"], ["admin/pricing", "الأسعار والرسوم", "coin"], ["admin/revenue", "الإيرادات والتكاليف", "chart"],
      ["admin/mjt", "إدارة مجتمع كوين", "coin"], ["admin/points", "إدارة نقاط المساهمة", "award"], ["admin/beta", "إدارة النسخة التجريبية", "feedback"], ["admin/ai", "إدارة الذكاء", "sparkle"], ["admin/aihub", "إدارة مركز الذكاء", "sparkle"],
      ["admin/i18n", "نصوص الواجهة", "globe"], ["admin/a11y", "تدقيق الوصول", "access"], ["admin/ads", "مراجعة الإعلانات", "mega"], ["admin/market", "نزاعات السوق", "bag"],
      ["admin/digital", "بلاغات المنتجات الرقمية", "box"], ["admin/paid", "استرداد المحتوى المدفوع", "lock"], ["admin/tips", "الإكراميات المعلّقة", "heart"], ["admin/biz", "طلبات الأنشطة المحلية", "store"],
      ["admin/places", "مراجعة الأماكن", "pin"], ["admin/hijri", "إعلانات الرؤية", "moon"], ["admin/charity", "التطوّع والخير", "hand"], ["admin/collabs", "إشراف التعاونات", "link"],
      ["admin/knowledge", "المكتبة المعرفية", "book"], ["admin/mentors", "الإرشاد", "bulb"], ["admin/creator-program", "الصنّاع والصندوق", "verified"], ["admin/pro", "الملفات المهنية", "doc"],
      ["admin/jobs", "مراجعة الوظائف", "brief"], ["admin/contracts", "العقود والنزاعات", "doc"], ["admin/reviews", "التقييمات المهنية", "star"]] }
  ];
  /* screens that are the same page under another address (reachable through the entry they alias) */
  const ALIAS = { decisions: "account-log", kb: "knowledge", a11y: "settings/display", accessibility: "settings/display", nsettings: "notifsettings", "email-prefs": "emailprefs", "me/purchases": "purchases", "me/supporting": "supporting", share: "home", clips: "shorts" };
  /* English / colloquial search words */
  const KW = { messages: "dm chat inbox", library: "saved bookmarks", mjt: "coin token wallet", wallet: "pi payments", settings: "options preferences", jobs: "work freelance", courses: "learn", security: "2fa password passkey",
    "settings/language": "language english", "settings/appearance": "theme dark mode colors", studio: "creator", market: "shop store", help: "support", developers: "api" };
  const SHORT = ["messages", "library", "mjt", "events", "studio", "jobs", "courses", "settings"];
  const all = () => CATS.flatMap((c) => c.items.map(([r, t, i, s, f]) => ({ r, h: "#/" + r, t, i, s: s || "", pi: (f || "").includes("p"), cat: c.id, ct: c.t, staff: !!c.staff })));
  const byHash = new Map(all().map((x) => [x.h, x]));
  const nrm = (s) => String(s || "").toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/\s+/g, " ").trim();
  let piOn = null;
  const staff = () => typeof DB !== "undefined" && !!DB.isAdmin;
  const RK = "mp.menu.recent", OK = "mp.menu.open";
  const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
  const ss = { get(k, d) { try { return JSON.parse(sessionStorage.getItem(k) || "null") ?? d; } catch { return d; } }, set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

  /* remember the hub entries a member opens (most recent first, 4) */
  addEventListener("hashchange", () => {
    const h = location.hash.split("&")[0], it = byHash.get(h) || byHash.get(h.split("?")[0]);
    if (!it || it.r === "settings" && h.includes("?")) return;
    const r = ls.get(RK, []).filter((x) => x !== it.h); r.unshift(it.h); ls.set(RK, r.slice(0, 4));
  });

  const tag = (it) => (it.pi && piOn === false ? `<span class="mn-tag">غير مفعّل بعد</span>` : "");
  const row = (it, withCat) => UI.li({ href: it.h, icon: it.i, title: it.t, sub: withCat ? it.ct + (it.s ? " · " + it.s : "") : it.s, end: tag(it) + `<span class="chev" aria-hidden="true">←</span>`, attrs: `data-mn="${esc(it.r)}"` });

  function render() {
    const u = typeof S !== "undefined" && DB.me ? S.me() : null, items = all().filter((x) => !x.staff || staff()), open = new Set(ss.get(OK, []));
    const recent = ls.get(RK, []).map((h) => byHash.get(h)).filter((x) => x && (!x.staff || staff()));
    const avatar = u ? `<span class="av" aria-hidden="true">${typeof avSrc === "function" && avSrc(u, "sm") ? `<img src="${esc(avSrc(u, "sm"))}" alt="">` : esc((u.name || "?")[0])}</span>` : "";
    view.innerHTML = `<div class="wrap mn-page">
      ${UI.pageHead({ title: "المزيد", sub: "كل ما في مجتمع بلس في مكان واحد.", id: "mn-h" })}
      ${u ? `<a class="mn-me card" href="#/me" id="mn-me">${avatar}<span class="t"><b>${esc(u.name)}</b><small><bdi>@${esc(u.handle)}</bdi> · عرض ملفك الشخصي</small></span><span class="chev" aria-hidden="true">←</span></a>` : ""}
      <label class="mn-q">${ic("search")}<input id="mn-q" type="search" placeholder="ابحث في الميزات والإعدادات" aria-label="ابحث في الميزات والإعدادات" autocomplete="off" enterkeyhint="search"></label>
      <p class="vh" id="mn-live" role="status" aria-live="polite"></p>
      <div id="mn-find" hidden></div>
      <div id="mn-hub">
        <nav class="mn-short" aria-label="اختصارات">${SHORT.map((r) => byHash.get("#/" + r)).filter(Boolean).map((it) => `<a href="${it.h}" class="mn-tile" data-mn="${esc(it.r)}"><span class="ico">${ic(it.i)}</span><span>${esc(it.t.replace(/ \(.+\)$/, ""))}</span></a>`).join("")}</nav>
        ${recent.length ? `<h3 class="set-h">زرتها مؤخراً</h3><div class="list">${recent.map((it) => row(it, true)).join("")}</div>` : ""}
        <h3 class="set-h">كل الأقسام</h3>
        <div class="mn-cats">${CATS.filter((c) => !c.staff || staff()).map((c) => { const its = items.filter((x) => x.cat === c.id);
          return `<details class="mn-cat card" data-cat="${c.id}" ${open.has(c.id) ? "open" : ""}><summary><span class="ico">${ic(c.i)}</span><span class="t"><b>${esc(c.t)}</b><small>${esc(its.slice(0, 3).map((x) => x.t.replace(/ \(.+\)$/, "")).join("، "))}${its.length > 3 ? "…" : ""}</small></span><span class="mn-n">${UI.num(its.length)}</span><span class="mn-chev" aria-hidden="true">${ic("back", "xs")}</span></summary><div class="list flat">${open.has(c.id) ? its.map((it) => row(it)).join("") : ""}</div></details>`; }).join("")}</div>
        <p class="mn-foot muted">مجتمع بلس ${esc(UI.version || "")} · <a href="#/about">عن مجتمع بلس</a> · <a href="#/legal">الشروط</a> · <a href="#/help">المساعدة</a></p>
      </div></div>`;
    /* closed categories fill their rows right after the first paint, so opening the hub is instant (links are in the page a frame later) */
    const hubEl = view.querySelector("#mn-hub"), fill = () => { if (!hubEl.isConnected) return; for (const d of view.querySelectorAll("details.mn-cat")) { const l = d.querySelector(".list"); if (!l.firstChild) l.innerHTML = items.filter((x) => x.cat === d.dataset.cat).map((it) => row(it)).join(""); } hubEl.dataset.full = "1"; };
    requestAnimationFrame(() => setTimeout(fill, 0));
    view.querySelectorAll("details.mn-cat").forEach((d) => d.addEventListener("toggle", () => { if (d.open && !d.querySelector(".list").firstChild) fill(); }, { once: false }));
    const avEl = view.querySelector(".mn-me .av"); if (avEl && u) avEl.style.background = u.color || "var(--accent)";
    view.querySelectorAll("details.mn-cat").forEach((d) => d.addEventListener("toggle", () => { const s = new Set(ss.get(OK, [])); d.open ? s.add(d.dataset.cat) : s.delete(d.dataset.cat); ss.set(OK, [...s]); }));
    const q = view.querySelector("#mn-q");
    if (view._mnq) { q.value = view._mnq; find(view._mnq); }
    q.addEventListener("input", () => { view._mnq = q.value; find(q.value); });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { const a = view.querySelector("#mn-find a.li"); if (a) { e.preventDefault(); location.hash = a.getAttribute("href"); } } else if (e.key === "Escape" && q.value) { e.preventDefault(); q.value = ""; view._mnq = ""; find(""); } });
    if (piOn === null && typeof PiAdapter !== "undefined" && PiAdapter.config) PiAdapter.config().then((c) => { const on = !!(c && c.enabled); if (piOn !== on) { piOn = on; if (location.hash.startsWith("#/menu")) { const y = scrollY; render(); scrollTo(0, y); } } }).catch(() => { piOn = false; });
  }
  function find(raw) {
    const q = nrm(raw), box = view.querySelector("#mn-find"), hub = view.querySelector("#mn-hub"), live = view.querySelector("#mn-live");
    if (!box) return;
    if (!q) { box.hidden = true; hub.hidden = false; box.innerHTML = ""; live.textContent = ""; return; }
    const words = q.split(" ");
    const hits = all().filter((x) => !x.staff || staff()).map((x) => { const t = nrm(x.t), hay = nrm([x.t, x.s, x.ct, KW[x.r] || "", x.r].join(" "));
      return { x, score: words.every((w) => hay.includes(w)) ? (t.startsWith(q) ? 3 : t.includes(q) ? 2 : 1) : 0 }; }).filter((h) => h.score).sort((a, b) => b.score - a.score).map((h) => h.x);
    hub.hidden = true; box.hidden = false;
    box.innerHTML = hits.length ? `<div class="list">${hits.slice(0, 40).map((it) => row(it, true)).join("")}</div>`
      : UI.empty({ title: "لا نتائج في القائمة", text: "جرّب كلمة أخرى، أو ابحث في المنشورات والأشخاص.", action: `<a class="btn ghost" href="#/explore">${ic("search")} ابحث في مجتمع بلس</a>` });
    live.textContent = hits.length ? `${UI.num(hits.length)} نتيجة` : "لا نتائج";
  }

  MPRoutes.extend(() => ({ menu: () => render() }));
  window.MPMenu = {
    /** every hub entry: { r, h, t, i, s, pi, cat, ct, staff } */
    items: all, categories: () => CATS.map((c) => ({ id: c.id, t: c.t, staff: !!c.staff, n: c.items.length })), aliases: () => ({ ...ALIAS }),
    /** the hub entry for a hash (exact, then without its query) — used for top-bar titles */
    find: (h) => byHash.get(h) || byHash.get(String(h).split("?")[0]) || null,
    version: "2.52"
  };
  if (window.MPNav) MPNav.paint();
})();
