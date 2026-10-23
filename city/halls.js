/* مجتمع بلس — «مدينة المجتمع الرقمية»: the city buildings' own halls (city/halls.js, lazy "town" chunk).
 * v2.85 (owner 2026-10-23: «قم بتطوير المدينه الرقميه بشكل أكبر واهتم بتحسين التصميم»). Every building on the main
 * street now opens a hall of its own inside the city, with the member's REAL data in the city's neon design, and never
 * a link out to the app's pages (owner rule, 2026-10-23):
 *   #/city/communities  ساحة المجتمعات       — the member's communities (role, topic), and ones that may suit them
 *   #/city/vidtik       استوديو فيديوتك       — the member's clips and their numbers, and what is trending in the city
 *   #/city/work         برج العمل الحر        — postings, applications and their status, saved and the newest openings
 *   #/city/courses      أكاديمية المدينة       — what the member is learning (progress), teaching, and the catalogue
 *   #/city/store        سوق المدينة           — the member's listings and the newest in the market
 *   #/city/local        حيّ الأعمال المحلية    — the member's businesses and the best-rated around
 * Items open in place (a disclosure with their details), so the member stays in the city. Same server APIs and rules as
 * the app's own screens; nothing here writes. CSP: no inline handlers or styles. */
(function CityHalls() {
  "use strict";
  const api = (p) => Remote.api("GET", p);
  const { T, esc, reduced } = MPCity.util;
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const ic = (n, c = "sm") => (window.UI && UI.icon ? UI.icon(n, c) : "");
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const num = (s) => `<bdi dir="ltr" class="cy-rm-n">${esc(String(s))}</bdi>`;
  const day = (s) => { try { return new Intl.DateTimeFormat(MPCity.util.lang() === "en" ? "en" : "ar", { numberingSystem: "latn", day: "numeric", month: "short" }).format(new Date(s)); } catch { return ""; } };
  const settle = (p) => p.then((v) => v, () => null);

  const HALLS = {
    communities: { t: "ساحة المجتمعات", b: "المجتمعات", i: "community", acc: "#a875ff" },
    vidtik: { t: "استوديو فيديوتك", b: "فيديوتك", i: "clapper", acc: "#ff4fd8" },
    work: { t: "برج العمل الحر", b: "العمل الحر", i: "brief", acc: "#46e3d4" },
    courses: { t: "أكاديمية المدينة", b: "الدورات", i: "cap", acc: "#5d7bff" },
    store: { t: "سوق المدينة", b: "المتجر", i: "bag", acc: "#ff7a59" },
    local: { t: "حيّ الأعمال المحلية", b: "أعمال محلية", i: "store", acc: "#ffc94d" }
  };
  MPCity.halls = HALLS;

  const strip = (cur) => `<nav class="cy-rm-nav" aria-label="${esc(T("دليل المدينة"))}">${Object.keys(HALLS).map((k) => `<a href="#/city/${k}"${k === cur ? ' aria-current="page"' : ""} data-acc="${HALLS[k].acc}">${ic(HALLS[k].i, "xs")}<span>${esc(T(HALLS[k].b))}</span></a>`).join("")}</nav>`;

  function shell(id) {
    const h = HALLS[id];
    view.innerHTML = `<div class="wrap cy-page cy-room cy-hallpg" data-hall="${id}">
      ${UI.pageHead({ back: ["#/city", T("مدينة المجتمع الرقمية")], title: T(h.t), id: "cy-rm-h" })}
      ${strip(id)}<div class="cy-rm-body" id="cy-rm"><div class="cy-rm-skel" aria-hidden="true"><i></i><i></i><i></i></div></div></div>`;
    $(".cy-room").style.setProperty("--cy-acc", h.acc);
    const pal = ((window.MPCityScenes || {}).main || {}).palette || {}; for (const k in pal) $(".cy-room").style.setProperty(k, pal[k]);
    view.querySelectorAll(".cy-rm-nav a").forEach((a) => a.style.setProperty("--cy-acc", a.dataset.acc));
    const on = view.querySelector(".cy-rm-nav a[aria-current]"), nav = view.querySelector(".cy-rm-nav");
    if (on && nav) nav.scrollLeft += (on.getBoundingClientRect().left + on.offsetWidth / 2) - (nav.getBoundingClientRect().left + nav.clientWidth / 2);
    $("#cy-rm-h")?.focus({ preventScroll: true });
    return $("#cy-rm");
  }
  const fail = (box, e) => { box.innerHTML = `<section class="cy-rm-card cy-rm-err" role="alert"><b>${esc(T("تعذّر التحميل"))}</b><p>${esc(e?.message || T("تعذّر الاتصال بالخادم"))}</p></section>`; };
  const guest = (box) => { box.innerHTML = `<section class="cy-rm-card cy-rm-err"><b>${esc(T("سجّل الدخول"))}</b><p>${esc(T("ادخل بحسابك لترى بياناتك داخل مدينة المجتمع الرقمية."))}</p></section>`; };

  /* the hall's sign: the building's emblem in orbiting neon, one big real number and what it counts */
  const hero = (id, n, label, note) => `<section class="cy-rm-card cy-hl-hero" aria-labelledby="cy-hl-l">
      <div class="cy-rm-core cy-hl-core" aria-hidden="true"><span class="cy-rm-orbit o1"></span><span class="cy-rm-orbit o2"></span><span class="cy-hl-pulse"></span><span class="cy-rm-coin">${ic(HALLS[id].i)}</span></div>
      <p class="cy-rm-big"><bdi dir="ltr" class="cy-rm-n" data-count>${esc(String(n))}</bdi></p>
      <p class="cy-rm-lbl" id="cy-hl-l">${esc(label)}</p>${note ? `<p class="cy-rm-note">${esc(note)}</p>` : ""}</section>`;
  const tiles = (arr) => `<div class="cy-rm-tiles${arr.length === 3 ? " three" : ""}">${arr.map(([l, v, s]) => `<div class="cy-rm-tile"><span>${esc(l)}</span><b>${num(v)}</b>${s ? `<small>${esc(s)}</small>` : ""}</div>`).join("")}</div>`;
  /* a list of items that open in place: [title, sub, side, detail-html, icon, tone] */
  const list = (title, icon, items, empty) => `<section class="cy-rm-card"><h3 class="cy-rm-h3">${ic(icon, "xs")}${esc(title)}</h3>${items.length
    ? `<ul class="cy-hl-list">${items.map((x) => `<li><details class="cy-hl-it${x.tone ? " " + x.tone : ""}"><summary><span class="cy-rm-ico">${ic(x.icon || icon, "xs")}</span><span class="cy-rm-t"><b>${esc(x.title || T("بلا عنوان"))}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</span>${x.side != null ? `<span class="cy-hl-side">${x.side}</span>` : ""}<span class="cy-hl-chev" aria-hidden="true"></span></summary>${x.detail ? `<div class="cy-hl-d">${x.detail}</div>` : ""}</details></li>`).join("")}</ul>`
    : `<p class="cy-rm-hint">${esc(empty)}</p>`}</section>`;
  const facts = (pairs) => `<dl class="cy-hl-facts">${pairs.filter((p) => p[1] != null && p[1] !== "").map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const pill = (s, tone) => `<span class="cy-hl-pill${tone ? " " + tone : ""}">${esc(s)}</span>`;
  const clip = (s, n = 90) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  function countUp(node) {
    const end = Number(node && node.textContent); if (!node || !isFinite(end) || reduced() || end === 0) return;
    const t0 = performance.now(), dur = 800;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur); node.textContent = String(Math.round(end * (1 - Math.pow(1 - k, 3)))); if (k < 1 && node.isConnected) requestAnimationFrame(tick); else node.textContent = String(end); };
    requestAnimationFrame(tick);
  }
  const done = (box, html) => { if (!box.isConnected) return; box.innerHTML = html; countUp(box.querySelector("[data-count]")); box.querySelectorAll(".cy-hl-bar i").forEach((i) => i.style.setProperty("--p", i.dataset.pct + "%")); };
  const bar = (pct) => `<span class="cy-hl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i data-pct="${Math.max(0, Math.min(100, pct)).toFixed(1)}"></i></span>`;

  /* ---------- ساحة المجتمعات (the member's synced communities) ---------- */
  async function communities(box) {
    const me = DB.me, live = (DB.communities || []).filter((c) => !c.archivedAt);
    const mine = (DB.memberships || []).filter((m) => m.user === me && !["pending", "banned"].includes(m.role));
    const byId = new Map(live.map((c) => [c.id, c]));
    const joined = mine.map((m) => ({ m, c: byId.get(m.community) })).filter((x) => x.c);
    const ROLE = { owner: "المالك", admin: "مشرف", mod: "مراقب", moderator: "مراقب", member: "عضو" };
    const members = (cid) => (DB.memberships || []).filter((m) => m.community === cid && !["pending", "banned"].includes(m.role)).length;
    const lead = joined.filter((x) => ["owner", "admin", "mod", "moderator"].includes(x.m.role)).length;
    const ids = new Set(joined.map((x) => x.c.id));
    const others = live.filter((c) => !ids.has(c.id) && c.type !== "invite").sort((a, b) => members(b.id) - members(a.id)).slice(0, 5);
    const item = (c, role) => ({ title: c.name, sub: [c.topic, role ? T(ROLE[role] || role) : null].filter(Boolean).join(" · "), icon: "community",
      side: role && role !== "member" ? pill(T(ROLE[role] || role), "gold") : num(members(c.id)),
      detail: `${c.desc ? `<p>${esc(clip(c.desc, 220))}</p>` : ""}${facts([[T("الأعضاء"), num(members(c.id))], [T("القواعد"), num((c.rules || []).length)], [T("تأسس"), esc(day(c.createdAt))], [T("الموقع"), c.location ? esc(String(c.location.name || c.location)) : null]])}` });
    done(box, hero("communities", joined.length, T("مجتمع أنت عضو فيه"), T("ساحة المدينة تجمع كل مجتمعاتك في مكان واحد"))
      + tiles([[T("تقودها"), lead, T("مالك أو مشرف")], [T("في المدينة"), live.length, T("مجتمع")], [T("أعضاء مجتمعاتك"), joined.reduce((s, x) => s + members(x.c.id), 0)]])
      + list(T("مجتمعاتك"), "community", joined.map((x) => item(x.c, x.m.role)), T("لم تنضم إلى مجتمع بعد."))
      + list(T("مجتمعات قد تناسبك"), "sparkle", others.map((c) => item(c, null)), T("لا توجد مجتمعات أخرى الآن.")));
  }

  /* ---------- استوديو فيديوتك ---------- */
  async function vidtik(box) {
    const h = (S.me && S.me().handle) || "";
    const [mine, feed] = await Promise.all([settle(api("/api/clips/creator/" + enc(h) + "?limit=10")), settle(api("/api/clips/feed"))]);
    if (!mine && !feed) return fail(box);
    const cn = (mine && mine.counts) || {}, items = (mine && mine.items) || [];
    const views = items.reduce((s, x) => s + (Number(x.views) || 0), 0);
    const it = (x, who) => ({ title: clip(x.title || x.text, 60), sub: [who ? x.user?.name : null, day(x.createdAt)].filter(Boolean).join(" · "), icon: "clapper",
      side: `${ic("heart", "xs")}${num(x.counts?.likes || 0)}`, tone: x.pinned ? "pin" : "",
      detail: `${x.text && x.title ? `<p>${esc(clip(x.text, 200))}</p>` : ""}${facts([[T("المشاهدات"), num(x.views || 0)], [T("الإعجابات"), num(x.counts?.likes || 0)], [T("التعليقات"), num(x.counts?.comments || 0)], [T("المشاركات"), num(x.counts?.shares || 0)], [T("مثبّت"), x.pinned ? pill(T("نعم"), "gold") : null]])}` });
    done(box, hero("vidtik", cn.clips || 0, T("مقطع نشرته"), T("استوديو المدينة يعرض أرقام مقاطعك كما هي"))
      + tiles([[T("الإعجابات"), cn.likes || 0], [T("المتابعون"), cn.followers || 0], [T("مشاهدات آخر مقاطعك"), views]])
      + list(T("مقاطعك"), "clapper", items.map((x) => it(x, false)), T("لم تنشر مقطعاً بعد."))
      + list(T("الرائج في المدينة"), "star", ((feed && feed.items) || []).slice(0, 6).map((x) => it(x, true)), T("لا مقاطع رائجة الآن.")));
  }

  /* ---------- برج العمل الحر ---------- */
  async function work(box) {
    const [me, open] = await Promise.all([settle(api("/api/jobs/me")), settle(api("/api/jobs"))]);
    if (!me && !open) return fail(box);
    const posts = (me && me.postings) || [], apps = (me && me.applications) || [], saved = (me && me.saved) || [];
    const active = apps.filter((a) => ["submitted", "viewed", "shortlisted", "interview"].includes(a.status)).length;
    const pay = (j) => j.pay ? [j.pay.label, j.pay.min != null ? j.pay.min + (j.pay.max != null && j.pay.max !== j.pay.min ? "–" + j.pay.max : "") + " π" : null].filter(Boolean).join(" ") : "";
    const job = (j) => ({ title: j.title, sub: [j.kind?.label, j.mode?.label, j.city].filter(Boolean).join(" · "), icon: "brief", tone: j.featured ? "pin" : "",
      side: j.statusLabel && j.status !== "open" ? pill(j.statusLabel) : (j.apps ? num(j.apps) : null),
      detail: `${(j.skills || []).length ? `<p class="cy-hl-tags">${j.skills.slice(0, 6).map((s) => pill(s)).join("")}</p>` : ""}${facts([[T("التصنيف"), esc(j.category?.label || "")], [T("الدوام"), esc(j.employment?.label || "")], [T("الأجر"), pay(j) ? `<bdi>${esc(pay(j))}</bdi>` : null], [T("المتقدمون"), num(j.apps || 0)], [T("آخر موعد"), j.deadline ? esc(day(j.deadline)) : null], [T("نُشر"), esc(day(j.publishedAt))]])}` });
    const TONE = { shortlisted: "ok", interview: "ok", hired: "gold", accepted: "gold", rejected: "bad", withdrawn: "bad" };
    const app = (a) => ({ title: a.job?.title, sub: [a.job?.kind, a.job?.poster?.name].filter(Boolean).join(" · "), icon: "send", side: pill(a.statusLabel || a.status, TONE[a.status]),
      detail: facts([[T("الحالة"), esc(a.statusLabel || a.status)], [T("آخر تحديث"), esc(day(a.updatedAt))]]) });
    done(box, hero("work", active, T("طلب قيد المتابعة"), T("كل طلباتك وفرصك في برج واحد"))
      + tiles([[T("طلباتك"), apps.length], [T("فرص نشرتها"), posts.length], [T("محفوظة"), saved.length]])
      + list(T("طلباتك"), "send", apps.slice(0, 8).map(app), T("لم تتقدم لفرصة بعد."))
      + (posts.length ? list(T("فرص نشرتها"), "brief", posts.slice(0, 6).map(job), "") : "")
      + list(T("أحدث الفرص في المدينة"), "sparkle", ((open && open.jobs) || []).slice(0, 6).map(job), T("لا فرص منشورة الآن.")));
  }

  /* ---------- أكاديمية المدينة ---------- */
  async function courses(box) {
    let d; try { d = await api("/api/courses"); } catch (e) { return fail(box, e); }
    const L = d.learning || [], done1 = L.filter((c) => c.completed).length;
    const avg = L.length ? Math.round(L.reduce((s, c) => s + (Number(c.progress) || 0), 0) / L.length) : 0;
    const course = (c, learn) => ({ title: c.title, sub: [c.levelLabel, c.group?.name].filter(Boolean).join(" · "), icon: "cap", tone: c.completed ? "ok" : "",
      side: learn ? (c.completed ? pill(T("مكتملة"), "ok") : num(Math.round(c.progress || 0) + "%")) : num(c.enrolled || 0),
      detail: `${learn ? bar(Number(c.progress) || 0) : ""}${c.subtitle ? `<p>${esc(clip(c.subtitle, 200))}</p>` : ""}${facts([[T("المستوى"), esc(c.levelLabel || "")], [T("الدروس"), c.lessons != null ? num(c.lessons) : null], [T("الدقائق"), c.minutes ? num(c.minutes) : null], [T("المسجلون"), num(c.enrolled || 0)], [T("تكمل من"), c.resume ? `<bdi>${esc(c.resume.title)}</bdi>` : null], [T("آخر نشاط"), c.lastAt ? esc(day(c.lastAt)) : null]])}` });
    done(box, hero("courses", L.length, T("دورة تتعلمها"), L.length ? `${T("متوسط تقدمك")} ${avg}%` : T("أكاديمية المدينة تحفظ تقدمك في كل دورة"))
      + tiles([[T("أكملتها"), done1], [T("تدرّسها"), (d.teaching || []).length], [T("في الأكاديمية"), (d.courses || []).length]])
      + list(T("تتعلمها الآن"), "cap", L.map((c) => course(c, true)), T("لم تسجل في دورة بعد."))
      + list(T("من مكتبة الأكاديمية"), "sparkle", (d.courses || []).filter((c) => !c.mine).slice(0, 6).map((c) => course(c, false)), T("لا دورات منشورة الآن.")));
  }

  /* ---------- سوق المدينة ---------- */
  async function store(box) {
    const [mine, latest] = await Promise.all([settle(api("/api/me/market/listings")), settle(api("/api/market/listings?limit=6"))]);
    if (!mine && !latest) return fail(box);
    const M = (mine && mine.items) || [], act = M.filter((x) => x.status === "active").length;
    const ST = { active: "معروض", sold_out: "نفد", paused: "موقوف", draft: "مسودة", review: "قيد المراجعة" };
    const it = (x, own) => ({ title: x.title, sub: [own ? null : x.seller?.name, x.location?.name || x.location, day(x.createdAt)].filter((v) => v && typeof v === "string").join(" · "), icon: "bag",
      side: `<bdi dir="ltr" class="cy-rm-n">${esc(String(x.price))} π</bdi>`, tone: x.soldOut ? "bad" : "",
      detail: facts([[T("الحالة"), esc(T(ST[x.status] || x.status))], [T("الكمية"), x.quantity != null ? num(x.quantity) : null], [T("الصور"), num(x.imageCount || 0)], [T("تقييم البائع"), x.seller?.rating?.count ? num(x.seller.rating.avg + " ★") : null]]) });
    done(box, hero("store", act, T("منتج معروض لك"), T("مدفوعات Pi غير مفعّلة بعد"))
      + tiles([[T("كل منتجاتك"), M.length], [T("نفدت"), M.filter((x) => x.soldOut).length], [T("جديد في السوق"), ((latest && latest.items) || []).length]])
      + list(T("منتجاتك"), "bag", M.slice(0, 8).map((x) => it(x, true)), T("لم تعرض منتجاً بعد."))
      + list(T("جديد في سوق المدينة"), "sparkle", ((latest && latest.items) || []).slice(0, 6).map((x) => it(x, false)), T("لا منتجات معروضة الآن.")));
  }

  /* ---------- حيّ الأعمال المحلية ---------- */
  async function local(box) {
    const [mine, near] = await Promise.all([settle(api("/api/biz/mine")), settle(api("/api/biz"))]);
    if (!mine && !near) return fail(box);
    const B = (mine && mine.businesses) || [], items = (near && near.items) || [];
    const biz = (x) => ({ title: x.name, sub: [x.categoryLabel, x.city || x.area].filter(Boolean).join(" · "), icon: "store",
      side: x.rating && x.rating.count ? `${ic("star", "xs")}${num(x.rating.avg)}` : null, tone: x.verified ? "ok" : "",
      detail: `${x.desc || x.about ? `<p>${esc(clip(x.desc || x.about, 200))}</p>` : ""}${facts([[T("التصنيف"), esc(x.categoryLabel || "")], [T("التقييم"), x.rating && x.rating.count ? `${num(x.rating.avg)} · ${num(x.rating.count)} ${esc(T("تقييم"))}` : null], [T("المدينة"), x.city ? esc(x.city) : null]])}` });
    done(box, hero("local", B.length, T("نشاط تجاري تديره"), T("حيّ يجمع أنشطة المدينة القريبة منك"))
      + tiles([[T("طلبات التوثيق"), ((mine && mine.claims) || []).length], [T("في الحي"), near ? near.total : 0], [T("بنطاق"), near ? near.radiusKm + " km" : "—"]])
      + (B.length ? list(T("أنشطتك"), "store", B.map(biz), "") : "")
      + list(T("الأعلى تقييماً"), "star", items.slice(0, 6).map(biz), T("لا أنشطة في الحي بعد.")));
  }

  const VIEWS = { communities, vidtik, work, courses, store, local };
  MPCity.hall = (id) => {
    if (!VIEWS[id]) return false;
    const box = shell(id);
    if (!signed()) { guest(box); return true; }
    VIEWS[id](box).catch((e) => fail(box, e));
    return true;
  };
})();
