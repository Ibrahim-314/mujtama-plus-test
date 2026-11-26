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
  /* v2.154 stage 1: six sections; each shows its core rows, the rest sit under a folded «أدوات أخرى» (moved, never removed; search finds all) */
  const CATS = [
    { id: "you", t: "أنا", i: "user", items: [["me", "ملفك الشخصي", "user", "منشوراتك ومتابعوك وصورتك"], ["library", "المحفوظات", "bookmark", "مجموعاتك وما حفظته لتقرأه لاحقاً"], ["purchases", "مشترياتي", "bag", "المحتوى المدفوع والمنتجات الرقمية"], ["points", "نقاط المساهمة", "award", "رصيدك ومستواك"], ["interests", "الاهتمامات", "target", "المواضيع التي تهمّك"]],
      more: [{ h: "", items: [["lists", "قوائم الأشخاص", "users", "قوائمك وقوائم تتابعها"], ["leaderboard", "لوحة الصدارة", "trophy", "الأكثر مساهمة"], ["verify", "طلب التوثيق", "verified", "شارة التوثيق لحسابك"], ["integrity", "التحقق والثقة", "shield", "الجوال وهوية Pi وإشارات الثقة"], ["orgs", "المؤسسات", "building", "حساب لجهتك وفريقك"], ["beta", "النسخة التجريبية", "feedback", "الموجات والملاحظات"]] }] },
    { id: "connect", t: "التواصل والمجتمعات", i: "community", items: [["messages", "الرسائل", "mail", "المحادثات والمجموعات"], ["notifications", "الإشعارات", "bell", "التفاعلات والإشارات"], ["communities", "المجتمعات", "users", "مساحات حول اهتماماتك"], ["events", "الأحداث", "cal", "الفعاليات القادمة"], ["rooms", "الغرف الصوتية", "mic", "نقاشات صوتية مباشرة"], ["giving", "التطوّع والخير", "hand", "حملات وفرص تطوّع موثّقة"]],
      more: [{ h: "التواصل", items: [["calls", "المكالمات", "phone", "سجل المكالمات الصوتية والمرئية"], ["newgroup", "مجموعة جديدة", "users", "محادثة جماعية"], ["message-requests", "طلبات الرسائل", "mail", "رسائل ممن لا تتابعهم"], ["e2ee", "التشفير طرفاً لطرف", "lock", "كيف تُحمى رسائلك"], ["devices", "الأجهزة المرتبطة", "link", "مفاتيح التشفير لكل جهاز"]] }, { h: "المجتمعات", items: [["cadmin", "مجتمعاتي التي أديرها", "settings", "لوحة إدارة لكل مجتمع تملكه أو تشرف عليه"], ["ambassadors", "سفراء المجتمع", "medal", "يرحّبون بالقادمين الجدد"]] }] },
    { id: "discover", t: "اكتشف", i: "compass", items: [["explore", "استكشف", "compass", "الرائج والمواضيع"], ["shorts", "فيديوتك", "film", "مقاطع فيديو عمودية قصيرة"], ["digest", "فاتك اليوم", "sparkle", "خلاصة آخر ٢٤ ساعة"], ["nearby", "بالقرب منك", "mapPin", "ما حولك بمنطقة تقريبية"], ["aihub", "مركز الذكاء", "sparkle", "اربط حسابك في الذكاء الاصطناعي واستخدمه هنا"]],
      more: [{ h: "", items: [["search", "البحث", "search", "منشورات وأشخاص ومجتمعات ووسوم"], ["trends", "الترند", "fire", "عالمي وحسب اللغة والموضوع"], ["clips/challenges", "تحديات فيديوتك", "trophy", "تحدٍّ أسبوعي بوسم — صوّر لقطتك وتنافس"], ["places", "أماكني", "pin", "الأماكن التي أضفتها"], ["cities", "المدن", "building", "أماكن كل مدينة"], ["hijri", "التقويم الهجري", "moon", "أم القرى والمواسم"], ["city", "نبض النواة", "sparkle", "لعبة ثلاثية الأبعاد: أنقذ مدينة 2077"]] }] },
    { id: "create", t: "الإبداع والعمل والتعلّم", i: "pen", items: [["studio", "استوديو المنشئ", "chart", "التقويم وأفضل وقت للنشر"], ["jobs", "الوظائف والعمل الحر", "brief", "فرص ومشاريع"], ["cv", "ملفي المهني", "doc", "سيرتك الذاتية"], ["courses", "الدورات", "cap", "تعلّم بخطوتك"], ["mentors", "الإرشاد", "bulb", "جلسات مع أصحاب الخبرة"], ["knowledge", "المكتبة المعرفية", "book", "معرفة مفتوحة بمراجعة"]],
      more: [{ h: "النشر", items: [["analytics", "التحليلات المتقدمة", "chart", "الجمهور والمحتوى"], ["drafts", "المسودات", "doc", "تتزامن بين أجهزتك"], ["scheduled", "النشر المجدول", "clock", "منشورات بموعد"], ["series", "السلاسل", "book", "حلقات مرتبة"], ["collabs", "التعاونات والرعايات", "link", "اتفاقات بإفصاح واضح"], ["creator-program", "الصنّاع الموثّقون", "verified", "برنامج التوثيق والدعم"], ["fund", "صندوق دعم الصنّاع", "gift", "منح بأرقام معلنة"], ["creator", "إعدادات المبدع", "sparkle", "المستويات والمزايا", "p"], ["subscribers", "المشتركون", "users", "من يدعمك شهرياً", "p"], ["me/paid-posts", "منشوراتي المدفوعة", "lock", "المحتوى المدفوع", "p"], ["ads", "حملاتي الإعلانية", "mega", "روّج منشوراتك دون تتبّع", "p"]] }, { h: "العمل", items: [["talent", "دليل المواهب", "users", "ابحث بمهارة أو مدينة"], ["contracts", "العقود", "doc", "مراحل وضمان"], ["teams", "الفرق والمشاريع", "users", "مهام وملفات وتحديثات"], ["reviews", "التقييمات المهنية", "star", "من عقود مكتملة فقط"], ["biz", "أعمال محلية", "store", "أنشطة تقبل Pi"]] }, { h: "التعلّم", items: [["study", "مجموعات الدراسة والحلقات", "users", "مجموعات وحلقات قرآن"], ["exams", "الاختبارات", "doc", "تُصحَّح على الخادم"], ["certificates", "شهاداتي", "award", "شهادات موقّعة رقمياً"], ["verify-cert", "التحقق من شهادة", "verified", "برمز أو QR"], ["mentoring", "لوحة المرشد", "bulb", "شارك خبرتك"], ["mentor-certs", "شهاداتي في الإرشاد", "award", "شهادات إتمام الإرشاد"]] }] },
    { id: "money", t: "المحفظة والسوق", i: "wallet", items: [["mjt", "مجتمع كوين (MJT)", "coin", "رصيدك وسجله داخل التطبيق"], ["mjt/earn", "كيف أكسب", "award", "طرق كسب مجتمع كوين"], ["wallet", "محفظة Pi", "wallet", "التحويلات والطلبات", "p"], ["market", "السوق", "bag", "منتجات وطلبات"], ["digital", "المنتجات الرقمية", "box", "كتب وقوالب ودورات"], ["subs", "الاشتراك الشهري", "star", "صنّاع تدعمهم", "p"]],
      more: [{ h: "", items: [["mjt/services", "خدمات مجتمع كوين", "bag", "استخدم رصيد مجتمع كوين"], ["mjt/terms", "شروط مجتمع كوين", "doc", "رصيد داخلي بلا قيمة نقدية"], ["transfers", "التحويلات", "swap", "بين الأعضاء", "p"], ["statement", "كشف الحساب", "doc", "كل حركة Pi", "p"], ["annual", "التقرير السنوي", "chart", "ملخص سنتك", "p"], ["supporting", "من أدعمهم", "heart", "الإكراميات والدعم", "p"], ["earnings", "الأرباح", "coin", "إكرامياتك ومبيعاتك", "p"], ["membership", "العضوية", "star", "Free وPlus", "p"], ["ai", "الترجمة والمساعد الذكي", "sparkle", "ضمن Plus", "p"], ["finance-report", "الشفافية المالية", "chart", "أرقام المنصة المجمّعة"]] }] },
    { id: "settings", t: "الإعدادات والمساعدة", i: "settings", items: [["settings", "كل الإعدادات", "settings", "بحث في كل الإعدادات"], ["security", "مركز الأمان", "shield", "التحقق بخطوتين ومفاتيح المرور"], ["privacy", "الخصوصية", "lock", "من يرى ملفك ويراسلك"], ["help", "مركز المساعدة والأمان", "help", "إرشادات وتوعية"], ["tickets", "تذاكر الدعم", "ticket", "راسل فريق الدعم"], ["urgent", "بلاغ عاجل", "alert", "للحالات الخطيرة"]],
      more: [{ h: "الإعدادات", items: [["settings?s=acct", "الحساب", "user", "التوثيق والحسابات المتعددة"], ["settings?s=privacy", "الخصوصية والأمان", "lock", "الدخول والأجهزة والحظر"], ["settings?s=notif", "الإشعارات والوقت", "bell", "ما يصلك وأوقات الهدوء"], ["settings?s=content", "المحتوى والخلاصة", "target", "الاهتمامات والترتيب والترجمة"], ["settings?s=display", "المظهر واللغة", "palette", "اللغة والخط والسمة"], ["settings?s=money", "المدفوعات والمحفظة", "wallet", "مجتمع كوين وPi والاشتراكات"], ["settings?s=family", "الأسرة والحماية", "users", "العمر والإعدادات العائلية"], ["settings?s=help", "المساعدة والقانوني", "help", "الدعم والشروط"], ["settings/appearance", "المظهر والتخصيص", "palette", "السمات والكثافة وترتيب الشريط"], ["settings/display", "العرض وإمكانية الوصول", "access", "حجم الخط والتباين والحركة"], ["settings/language", "اللغة", "globe", "العربية و English"], ["settings/translate", "تفضيلات الترجمة", "globe", "الترجمة الآلية"], ["settings/ads", "تفضيلات الإعلانات", "mega", "إعلانات حسب اهتماماتك"], ["notifsettings", "الإشعارات والبريد", "bell", "قنوات الإشعارات"], ["emailprefs", "تفضيلات البريد", "mail", "الملخصات والتنبيهات"], ["feedprefs", "الخلاصة والملخصات", "sliders", "الترتيب والتبويبات"]] }, { h: "الأمان والخصوصية", items: [["protection", "وضع الحماية", "shield", "عند موجة إساءة"], ["mydata", "بياناتي وخصوصيتي", "download", "تنزيل بياناتك والموافقات"], ["my-reports", "بلاغاتي", "flag", "ما أبلغت عنه"], ["account-log", "سجل قرارات حسابي", "doc", "كل قرار مع سببه"], ["age", "العمر والمحتوى الحساس", "user", "حماية أفضل"], ["family", "الإعدادات العائلية", "users", "ولي الأمر والحساب المرتبط"], ["wellbeing", "الرفاهية الرقمية", "clock", "وقت الاستخدام والتذكيرات"]] }, { h: "المساعدة والمعلومات", items: [["faq", "الأسئلة الشائعة", "help", "شروحات وإجابات سريعة"], ["policies", "سياسات المحتوى", "doc", "إرشادات المجتمع"], ["legal", "الشروط والخصوصية", "doc", "بلغة واضحة"], ["transparency", "تقارير الشفافية", "chart", "أرقام شهرية مجمّعة"], ["about", "عن مجتمع بلس", "sparkle", "من نحن"], ["versions", "سجل الإصدارات", "clock", "ما الجديد في كل إصدار"], ["waitlist", "قائمة الانتظار", "clock", "الدعوات والتسجيل"], ["app", "التطبيق", "download", "التثبيت والإشعارات"], ["developers", "بوابة المطورين", "code", "REST وOAuth وWebhooks"]] }] },
    { id: "admin", t: "الإدارة", i: "shield", staff: true, items: [
      ["admin", "لوحة الإدارة", "shield", "كل أدوات المشرفين"], ["settings?s=admin", "إعدادات الإدارة", "settings"], ["staff", "طابور الدعم", "ticket"], ["trust", "الثقة والنمو", "verified"],
      ["investigations", "لوحة التحقيقات", "search"], ["safety-cases", "طابور السلامة", "alert"], ["compliance", "الامتثال وحماية البيانات", "lock"], ["status", "حالة النظام", "chart"],
      ["admin/security", "أمان المنصة", "shield"], ["admin/ops", "العمليات والمراقبة", "chart"], ["admin/activation", "التفعيل", "check"], ["admin/pi-activation", "تفعيل مدفوعات Pi", "wallet"], ["admin/pi", "مطابقة مدفوعات Pi", "wallet"],
      ["admin/transfers", "تحويلات قيد المراجعة", "swap"], ["admin/finance", "التقارير المالية والمطابقة", "doc"], ["admin/pricing", "الأسعار والرسوم", "coin"], ["admin/revenue", "الإيرادات والتكاليف", "chart"],
      ["admin/mjt", "إدارة مجتمع كوين", "coin"], ["admin/rewards", "إدارة مكافآت مجتمع كوين", "award"], ["admin/mjt-services", "إدارة خدمات مجتمع كوين", "bag"], ["admin/mjt-safety", "حماية مكافآت مجتمع كوين", "shield"], ["admin/mjt-review", "قائمة مراجعة مجتمع كوين", "clock"], ["admin/mjt-reputation", "السمعة 2", "star"], ["admin/points", "إدارة نقاط المساهمة", "award"], ["admin/beta", "إدارة النسخة التجريبية", "feedback"], ["admin/ai", "إدارة الذكاء", "sparkle"], ["admin/aihub", "إدارة مركز الذكاء", "sparkle"],
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
  const one = (c, x, g) => ([r, t, i, s, f]) => ({ r, h: "#/" + r, t, i, s: s || "", pi: (f || "").includes("p"), cat: c.id, ct: c.t, staff: !!c.staff, x, g });
  const all = () => CATS.flatMap((c) => [...c.items.map(one(c, false, "")), ...(c.more || []).flatMap((m) => m.items.map(one(c, true, m.h)))]);
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
  const tr = (x) => (window.MPI18n?.t ? window.MPI18n.t(x) : x);
  const row = (it, withCat) => UI.li({ href: it.h, icon: it.i, title: it.t, sub: withCat ? tr(it.ct) + (it.s ? " · " + tr(it.s) : "") : it.s, /* v2.140.2: category and subtitle translate one by one (the joined line has no catalogue key) */ end: tag(it) + `<span class="chev" aria-hidden="true">←</span>`, attrs: `data-mn="${esc(it.r)}"` });

  const catRows = (items, cid) => { const core = items.filter((x) => x.cat === cid && !x.x), more = items.filter((x) => x.cat === cid && x.x);
    let g = null; const rest = more.map((it) => { const h = it.g !== g ? (g = it.g, it.g ? `<h4 class="mn-sub">${esc(it.g)}</h4>` : "") : ""; return h + row(it); }).join("");
    return core.map((it) => row(it)).join("") + (more.length ? `<details class="mn-more"><summary><span class="ico">${ic("more", "xs")}</span><b>أدوات أخرى</b><span class="mn-n">${UI.num(more.length)}</span><span class="mn-chev" aria-hidden="true">${ic("back", "xs")}</span></summary><div class="list flat">${rest}</div></details>` : ""); };
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
        <div class="mn-cats">${CATS.filter((c) => !c.staff || staff()).map((c) => { const its = items.filter((x) => x.cat === c.id && !x.x);
          return `<details class="mn-cat card" data-cat="${c.id}" ${open.has(c.id) ? "open" : ""}><summary><span class="ico">${ic(c.i)}</span><span class="t"><b>${esc(c.t)}</b><small>${esc(its.slice(0, 3).map((x) => { const v = x.t.replace(/ \(.+\)$/, ""); return window.MPI18n ? MPI18n.t(v) : v; }).join(window.MPI18n && MPI18n.current() !== "ar" ? ", " : "، "))}${its.length > 3 ? "…" : ""}</small></span><span class="mn-n">${UI.num(its.length)}</span><span class="mn-chev" aria-hidden="true">${ic("back", "xs")}</span></summary><div class="list flat">${open.has(c.id) ? catRows(items, c.id) : ""}</div></details>`; }).join("")}</div>
        <p class="mn-foot muted">مجتمع بلس ${esc(UI.version || "")} · <a href="#/about">عن مجتمع بلس</a> · <a href="#/legal">الشروط</a> · <a href="#/help">المساعدة</a></p>
      </div></div>`;
    /* closed categories fill their rows right after the first paint, so opening the hub is instant (links are in the page a frame later) */
    const hubEl = view.querySelector("#mn-hub"), fill = () => { if (!hubEl.isConnected) return; for (const d of view.querySelectorAll("details.mn-cat")) { const l = d.querySelector(".list"); if (!l.firstChild) l.innerHTML = catRows(items, d.dataset.cat); } hubEl.dataset.full = "1"; };
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
