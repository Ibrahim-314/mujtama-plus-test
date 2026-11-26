/* v2.155.0 «الرئيسية المتكاملة» (phase 1a) — lazy chunk `homehub` (homehub-ui.js + homehub.css), loaded right after sign-in.
 * The Home tab stays the same screen: this chunk adds a hub ABOVE the existing composer + feed (the feed stays last, endless).
 *   fixed top:   search · (stories strip slot) · welcome card (+ MJT balance when the account really has one)
 *   ordered:     quick actions · «يستحق اهتمامك» · communities · opportunities (jobs / freelance / teams & projects)
 *                + optional, hidden by default: creator studio · courses & library · AI hub
 *   fixed end:   «من المجتمع» header, then the existing composer, feed tabs and feed (unchanged).
 * Layout (order + hidden) is saved in the existing prefs store (namespace `home`, key `layout`: PUT /api/prefs), cached in
 * localStorage for the first paint; no new table. Each section loads its own data (local DB for posts/communities; API for
 * MJT, jobs, teams, studio, courses, only when the section is near the screen), cached in memory with a TTL. A soft re-render
 * (realtime refresh, feed tab switch) re-inserts the same hub node: no refetch, no redraw. Posts shown in «يستحق اهتمامك»
 * are filtered out of the feed (HomeHooks.feed) so a post never appears twice. Creates no data, shows no sample numbers. */
(function HomeHub() {
  if (window.MPHub || typeof HomeHooks === "undefined") return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const ic = (n, c = "sm") => (window.UI && UI.icon ? UI.icon(n, c) : "");
  const h = (s) => esc(String(s == null ? "" : s));
  const enc = encodeURIComponent;
  const rel = (iso) => (typeof relTime === "function" && iso ? relTime(iso) : "");
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

  /* ---------- layout (order + hidden) ---------- */
  const SECTIONS = { quick: "الاختصارات الرئيسية", attention: "يستحق اهتمامك", communities: "اكتشف مجتمعات تهمك", opps: "فرصتك القادمة", studio: "استوديو المنشئ", learn: "تعلّم وطوّر مهاراتك", ai: "مساعدك الذكي" };
  const DEF = { order: ["quick", "attention", "communities", "opps", "studio", "learn", "ai"], hidden: ["studio", "learn", "ai"] };
  const clean = (l) => {
    const keys = Object.keys(SECTIONS), order = (Array.isArray(l?.order) ? l.order : []).filter((k, i, a) => keys.includes(k) && a.indexOf(k) === i);
    for (const k of DEF.order) if (!order.includes(k)) order.splice(Math.min(DEF.order.indexOf(k), order.length), 0, k); /* a section added later lands at its default place */
    const hidden = Array.isArray(l?.hidden) ? l.hidden.filter((k) => keys.includes(k)) : DEF.hidden.slice();
    return { order, hidden };
  };
  let layout = null, prefsAt = 0;
  const myLayout = () => { if (!layout) { const c = ls.get("mp_home_layout"); layout = clean(c && c.me === DB.me ? c.l : DEF); } return layout; };
  const visible = () => myLayout().order.filter((k) => !myLayout().hidden.includes(k));
  const on = (k) => visible().includes(k);
  async function pullPrefs(force) {
    if (!online() || (!force && Date.now() - prefsAt < 10 * 60e3)) return;
    prefsAt = Date.now();
    try {
      const r = await api("GET", "/api/prefs?ns=home"), l = r && r.prefs && r.prefs.home && r.prefs.home.layout;
      const next = clean(l || DEF);
      if (JSON.stringify(next) !== JSON.stringify(myLayout())) { layout = next; ls.set("mp_home_layout", { me: DB.me, l: next }); remount(); }
    } catch { prefsAt = 0; }
  }
  async function saveLayout(next) {
    layout = clean(next); ls.set("mp_home_layout", { me: DB.me, l: layout }); remount(true);
    if (!online()) return true;
    try { await api("PUT", "/api/prefs", { ns: "home", values: { layout } }); prefsAt = Date.now(); return true; } catch { toast("حُفظ على هذا الجهاز، وتعذّرت مزامنته الآن"); return false; }
  }

  /* ---------- per-section data, cached (TTL), fetched only when needed ---------- */
  const C = {};
  const TTL = 5 * 60e3;
  function want(key, url, ttl = TTL) {
    const c = C[key] ||= { st: "idle" };
    if (!online()) { if (c.st === "idle") { c.st = "off"; setTimeout(() => paintSection(owner(key)), 0); } return; }
    if (c.st === "loading" || (c.at && Date.now() - c.at < ttl && c.st !== "error")) return;
    if (c.st !== "ok") c.st = "loading";
    api("GET", url).then((d) => { C[key] = { st: "ok", d, at: Date.now() }; }, (e) => { C[key] = { st: e && e.status === 404 ? "none" : "error", at: Date.now() }; }).then(() => paintSection(owner(key)));
  }
  const owner = (key) => (key === "mjt" ? "welcome" : key.startsWith("opps:") ? "opps" : key);

  /* ---------- «يستحق اهتمامك»: picked once, kept stable, never repeated in the feed ---------- */
  let picks = null, picksAt = 0, picksMe = null;
  function pickPosts() {
    if (picks && picksMe === DB.me && (window.__softRender || Date.now() - picksAt < 10 * 60e3)) return picks;
    const since = Date.now() - 7 * 864e5, me = DB.me;
    const pool = S.visiblePosts().filter((p) => p.author !== me && p.type !== "story" && !p.locked && !p.paid && !p.lock && /* v2.156.1: paid posts stay in the feed, where their lock card renders */ (!p.community || S.community(p.community)?.type === "public" || S.membership(p.community)) && new Date(p.createdAt) > since && !DB.muted.posts.includes(p.id) && !DB.muted.users.includes(p.author) && !DB.muted.topics.includes(p.topic))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 200);
    const scored = pool.map((p) => {
      const rx = S.reactionsOf(p.id).length, cm = S.commentsOf(p.id).length, ageH = (Date.now() - new Date(p.createdAt)) / 3600e3;
      const interest = DB.interests.includes(p.topic) ? 3 : 0, follow = S.follows(me, p.author) ? 2.5 : 0, eng = Math.log2(1 + rx + 2 * cm), fresh = 4 / (1 + ageH / 12);
      const quality = (p.type === "article" ? 1 : 0) + ((p.text || "").length > 80 ? 0.5 : 0);
      return { p, s: interest + follow + eng + fresh + quality, rx, cm, why: follow ? "ممن تتابع" : interest ? "من اهتماماتك" : eng >= 2 ? "يتفاعل معه المجتمع" : "" };
    }).filter((x) => x.rx + x.cm > 0 || x.why).sort((a, b) => b.s - a.s);
    const out = [];
    for (const x of scored) { if (out.length >= 2) break; if (!out.some((o) => o.p.author === x.p.author)) out.push(x); }
    /* one discovery pick outside the member's interests and circle, so recommendations do not only echo past activity */
    const disc = scored.find((x) => !out.includes(x) && !DB.interests.includes(x.p.topic) && !S.follows(me, x.p.author) && x.rx + x.cm > 0 && !out.some((o) => o.p.author === x.p.author));
    if (disc) out.push({ ...disc, why: "اكتشف شيئًا جديدًا" });
    picks = out; picksAt = Date.now(); picksMe = DB.me;
    return picks;
  }
  HomeHooks.feed("hub-dedupe", 5, (arr) => { if (!on("attention")) return arr; const ids = new Set(pickPosts().map((x) => x.p.id)); return ids.size ? arr.filter((p) => !ids.has(p.id)) : arr; });

  /* ---------- section renderers (each returns one <section>) ---------- */
  const sh = (title, href, more) => `<div class="hb-sh"><h2>${h(title)}</h2>${href ? `<a class="hb-more" href="${href}">${h(more || "عرض الكل")}</a>` : ""}</div>`;
  const avData = (u) => /* no link inside a card link; the colour is painted after insertion (no inline style in source) */ av(u, "sm").replace(/^<a [^>]*?style="background:([^"]*)"[^>]*>/, '<span class="av sm" aria-hidden="true" data-bg="$1">').replace(/<\/a>$/, "</span>");
  const state = (c, empty) => !c || c.st === "idle" || c.st === "loading" ? `<div class="hb-load" aria-busy="true"><div class="skel line"></div><div class="skel line"></div><div class="skel line"></div></div>`
    : c.st === "off" ? `<p class="hb-note">يظهر هذا القسم عند الاتصال بالإنترنت.</p>`
    : c.st === "error" ? `<p class="hb-note">تعذّر تحميل هذا القسم. <button type="button" class="hb-link" data-hb="retry">إعادة المحاولة</button></p>` : `<p class="hb-note">${h(empty)}</p>`;
  const greet = () => { const hr = new Date().getHours(); return hr >= 4 && hr < 12 ? "صباح الخير،" : "مساء الخير،"; };
  const num = (v) => v;

  const R = {
    welcome() {
      const me = S.me(), m = C.mjt;
      const coin = m && m.st === "ok" && m.d && m.d.balance && !m.d.frozen ? `<a class="hb-pill" href="#/mjt">${ic("coin")}<span>مجتمع كوين</span> <b data-noi18n dir="ltr">${h(m.d.balance.mjt)}</b></a>` : "";
      return `<section class="hb-hi" id="hb-s-welcome" aria-label="الترحيب">${avData(me)}<div class="hb-hi-t"><p class="hb-hi-g"><span>${greet()}</span> <b data-noi18n>${h(me.name)}</b></p><p class="hb-hi-s">مجتمعك، عملك، ونموّك</p>
        <div class="hb-hi-a"><a class="hb-pill" href="#/me">${ic("user")}<span>ملفي الشخصي</span></a>${coin}</div></div></section>`;
    },
    quick() {
      const Q = [["#/home", "إنشاء منشور", "pen", "compose"], ["#/studio", "استوديو المنشئ", "clapper"], ["#/courses", "الدورات والمكتبة", "cap"], ["#/jobs", "العمل والوظائف", "brief"], ["#/teams", "المشاريع والفرق", "users"], ["#/aihub", "مركز الذكاء", "sparkle"]];
      return `<section class="hb-sec" id="hb-s-quick" aria-label="الاختصارات الرئيسية"><div class="hb-qa">${Q.map(([href, t, i, act]) => `<a class="hb-q" href="${href}"${act ? ` data-hb="${act}" role="button"` : ""}><span class="hb-qi">${ic(i)}</span><span>${t}</span></a>`).join("")}</div></section>`;
    },
    attention() {
      const list = pickPosts();
      const card = ({ p, rx, cm, why }) => { const u = S.user(p.author); if (!u) return ""; const t = (p.title || p.text || "").replace(/\s+/g, " ").trim();
        return `<a class="hb-pc" href="#/post/${enc(p.id)}"><span class="hb-pa">${avData(u)}<span><b data-noi18n>${h(u.name)}</b><small>${h(rel(p.createdAt))}</small></span></span><p class="hb-pt" data-noi18n dir="auto">${h(t.slice(0, 140))}${t.length > 140 ? "…" : ""}</p>
          <span class="hb-pm">${ic("heart", "xs")} ${rx} · ${ic("comment", "xs")} ${cm}${why ? ` · <span class="hb-why">${h(why)}</span>` : ""}</span></a>`; };
      return `<section class="hb-sec" id="hb-s-attention">${sh("يستحق اهتمامك", "#/explore", "المزيد")}${list.length ? `<div class="hb-row">${list.map(card).join("")}</div>` : `<p class="hb-note">لا يوجد ما نرشحه الآن. تابع أشخاصًا واختر اهتماماتك ليصبح هذا القسم أذكى.</p>`}</section>`;
    },
    communities() {
      const list = DB.communities.filter((c) => c.type === "public" && !S.membership(c.id)).map((c) => ({ c, n: S.members(c.id).length, s: (DB.interests.includes(c.topic) ? 5 : 0) + Math.log2(1 + S.members(c.id).length) })).sort((a, b) => b.s - a.s).slice(0, 6);
      const card = ({ c, n }) => `<a class="hb-cc" href="#/c/${enc(c.id)}"><span class="hb-ci" data-bg="${h(c.color || "")}">${ic("users")}</span><b data-noi18n>${h(c.name)}</b>${c.desc ? `<small class="hb-cd" data-noi18n dir="auto">${h(c.desc)}</small>` : ""}${n ? `<small>${n} عضو</small>` : ""}<span class="btn sm">زيارة</span></a>`;
      return `<section class="hb-sec" id="hb-s-communities">${sh("اكتشف مجتمعات تهمك", "#/communities")}${list.length ? `<div class="hb-row">${list.map(card).join("")}</div>` : `<p class="hb-note">انضممت إلى كل المجتمعات المقترحة لك. <a href="#/communities">تصفّح المجتمعات</a></p>`}</section>`;
    },
    opps() {
      const tab = ["job", "freelance", "teams"].includes(ls.get("mp_hub_opps")) ? ls.get("mp_hub_opps") : "job";
      const T = [["job", "وظائف"], ["freelance", "عمل حر"], ["teams", "مشاريع وفرق"]];
      const c = C["opps:" + tab];
      let body;
      if (c && c.st === "ok") {
        if (tab === "teams") { const ts = (c.d.teams || []).slice(0, 3); body = ts.length ? `<ul class="hb-list">${ts.map((t) => `<li><a href="#/team/${enc(t.id)}"><b data-noi18n dir="auto">${h(t.name)}</b><small>${h(t.kind?.label || "")}${t.members ? ` · <span>${num(t.members)} عضو</span>` : ""}${t.owner ? ` · <bdi data-noi18n>${h(t.owner.name)}</bdi>` : ""}</small>${t.about ? `<small class="hb-cd" data-noi18n dir="auto">${h(t.about)}</small>` : ""}</a></li>`).join("")}</ul>` : state({ st: "empty" }, "لا توجد فرق أو مشاريع منشورة الآن."); }
        else { const js = (c.d.jobs || []).slice(0, 3); body = js.length ? `<ul class="hb-list">${js.map((j) => `<li><a href="#/job/${enc(j.id)}"><b data-noi18n dir="auto">${h(j.title)}</b><small>${h(j.category?.label || "")}${j.mode?.label ? ` · ${h(j.mode.label)}` : ""} · ${h(rel(j.publishedAt))}${j.poster ? ` · <bdi data-noi18n>${h(j.poster.name)}</bdi>` : ""}</small></a></li>`).join("")}</ul>` : state({ st: "empty" }, tab === "job" ? "لا توجد وظائف منشورة الآن." : "لا توجد مشاريع عمل حر منشورة الآن."); }
      } else body = state(c, "");
      const all = tab === "teams" ? "#/teams" : `#/jobs?kind=${tab}`;
      return `<section class="hb-sec" id="hb-s-opps" data-lazy="opps">${sh("فرصتك القادمة", all, "كل الفرص")}<div class="hb-seg" role="group" aria-label="نوع الفرصة">${T.map(([k, l]) => `<button type="button" class="tab ${k === tab ? "on" : ""}" data-hb="opps" data-k="${k}" aria-pressed="${k === tab}">${l}</button>`).join("")}</div>${body}</section>`;
    },
    studio() {
      const c = C.studio, mine = DB.posts.filter((p) => p.author === DB.me && p.status === "published").length;
      const t = c && c.st === "ok" && c.d && c.d.totals;
      const stats = `<div class="hb-stats"><span><b>${mine}</b><small>منشور</small></span>${t ? `<span><b>${t.views}</b><small>مشاهدة (٢٨ يومًا)</small></span><span><b>${t.engagement}</b><small>تفاعل (٢٨ يومًا)</small></span>` : ""}</div>`;
      return `<section class="hb-sec hb-card" id="hb-s-studio" data-lazy="studio">${sh("استوديو المنشئ")}<p class="hb-sub">أدواتك لصناعة المحتوى وإدارة إبداعك.</p>${stats}<a class="btn" href="#/studio">افتح الاستوديو</a></section>`;
    },
    learn() {
      const c = C.learn; let body = "";
      if (c && c.st === "ok") {
        const go = (c.d.learning || []).find((x) => x.resume);
        const list = (c.d.courses || []).filter((x) => !go || x.id !== go.id).slice(0, 2);
        body = (go ? `<a class="hb-resume" href="#/course/${enc(go.id)}/learn/${enc(go.resume.id)}"><span class="hb-qi">${ic("book")}</span><span><small>تابع التعلّم</small><b data-noi18n dir="auto">${h(go.title)}</b><small data-noi18n dir="auto">${h(go.resume.title)}</small></span></a>` : "") +
          (list.length ? `<ul class="hb-list">${list.map((x) => `<li><a href="#/course/${enc(x.id)}"><b data-noi18n dir="auto">${h(x.title)}</b><small>${x.lessons ? `<span>${num(x.lessons)} درس</span>` : ""}${x.group ? ` · <bdi data-noi18n>${h(x.group.name)}</bdi>` : ""}</small></a></li>`).join("")}</ul>` : go ? "" : state({ st: "empty" }, "لا توجد دورات منشورة بعد."));
      } else body = state(c, "");
      return `<section class="hb-sec hb-card" id="hb-s-learn" data-lazy="learn">${sh("تعلّم وطوّر مهاراتك", "#/courses", "كل الدورات")}${body}<div class="hb-acts"><a class="btn ghost" href="#/courses">استكشف الدورات</a><a class="btn ghost" href="#/knowledge">المكتبة المعرفية</a></div></section>`;
    },
    ai() {
      return `<section class="hb-sec hb-card" id="hb-s-ai">${sh("مساعدك الذكي في مجتمع بلس")}<p class="hb-sub">ساعدني في التعلّم والكتابة والعمل وتطوير أفكاري.</p><div class="hb-acts"><a class="btn" href="#/aihub">${ic("sparkle")} مركز الذكاء</a><button type="button" class="btn ghost" data-hb="aiwrite">ساعدني في الكتابة</button></div></section>`;
    }
  };
  const LAZY = { opps: () => { const t = ["job", "freelance", "teams"].includes(ls.get("mp_hub_opps")) ? ls.get("mp_hub_opps") : "job"; want("opps:" + t, t === "teams" ? "/api/teams/directory" : `/api/jobs?kind=${t}`); }, studio: () => want("studio", "/api/studio/overview?days=28"), learn: () => want("learn", "/api/courses") };

  /* ---------- mount ---------- */
  let hubEl = null, hubSig = "", io = null;
  const isHome = () => (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] || "home") === "home";
  const sig = () => JSON.stringify([DB.me, myLayout(), (window.MPI18n && MPI18n.current && MPI18n.current()) || "ar", pickPosts().map((x) => x.p.id), Object.entries(C).map(([k, v]) => k + v.st + (v.at || 0)), DB.communities.length, DB.memberships.length]);
  function build() {
    const el = document.createElement("div");
    el.id = "hub"; el.className = "hub"; el.dataset.me = DB.me;
    el.innerHTML = `<form class="hb-search" role="search" action="#/search"><input type="search" name="q" enterkeyhint="search" autocomplete="off" placeholder="ابحث في مجتمع بلس..." aria-label="ابحث في مجتمع بلس"><button type="submit" class="hb-sb" aria-label="بحث">${ic("search")}</button></form>
      <div id="hub-st"></div>${R.welcome()}${visible().map((k) => { try { return R[k](); } catch (e) { console.warn("hub " + k, e); return ""; } }).join("")}
      <button type="button" class="hb-cust" data-hb="customize">${ic("list")}<span>تخصيص صفحتي الرئيسية</span></button>
      <div class="hb-sh hb-feedh"><h2>من المجتمع</h2></div>`;
    paintBg(el); bind(el);
    return el;
  }
  const paintBg = (root) => root.querySelectorAll("[data-bg]").forEach((n) => { if (n.dataset.bg) n.style.background = n.dataset.bg; });
  function paintSection(k) {
    if (!hubEl || !hubEl.isConnected) return;
    const cur = hubEl.querySelector("#hb-s-" + k); if (!cur || !R[k]) return;
    const t = document.createElement("div"); t.innerHTML = R[k](); const n = t.firstElementChild; if (!n) return;
    /* keep a horizontal row where the member scrolled it */
    const row = cur.querySelector(".hb-row"), x = row ? row.scrollLeft : 0;
    cur.replaceWith(n); paintBg(n); const r2 = n.querySelector(".hb-row"); if (r2) r2.scrollLeft = x;
    observe(n); hubSig = sig();
  }
  function observe(root) {
    if (!("IntersectionObserver" in window)) { root.querySelectorAll("[data-lazy]").forEach((s) => LAZY[s.dataset.lazy]?.()); return; }
    io ||= new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); LAZY[e.target.dataset.lazy]?.(); } }), { rootMargin: "400px 0px" });
    (root.matches?.("[data-lazy]") ? [root] : root.querySelectorAll("[data-lazy]")).forEach((s) => io.observe(s));
  }
  function mount() {
    if (!isHome() || !DB.me || !DB.onboarded || typeof view === "undefined") return;
    const anchor = view.querySelector("#hcomp"); if (!anchor) return;
    const soft = !!window.__softRender, s = sig();
    let node = hubEl && hubEl.dataset.me === DB.me && hubSig === s ? hubEl : null;
    if (!node) { node = build(); hubSig = s; }
    const slot = view.querySelector("#hub-slot");
    if (slot) slot.replaceWith(node); else if (node.nextElementSibling !== anchor || !node.isConnected) anchor.before(node);
    view.querySelectorAll(".hub").forEach((x) => { if (x !== node) x.remove(); });
    hubEl = node; observe(node);
    if (!soft) { if (online()) want("mjt", "/api/mjt/me"); pullPrefs(); }
    requestAnimationFrame(() => { if (node.isConnected) try { localStorage.setItem("mp_hub_h", String(Math.round(node.offsetHeight))); } catch { /* */ } });
  }
  function remount(force) {
    if (!hubEl || !hubEl.isConnected) return;
    const n = build(), sb = hubEl.querySelector(".stories-bar"); hubEl.replaceWith(n); if (sb) n.querySelector("#hub-st").before(sb); hubEl = n; hubSig = sig(); observe(n);
    if (force) { /* a section shown again: drop the feed duplicates its picks would cause */ dropDupes(); }
  }
  function dropDupes() {
    if (!on("attention")) return;
    for (const x of pickPosts()) view.querySelectorAll(`.wrap > .post-card [data-open="#/post/${CSS.escape(x.p.id)}"]`).forEach((n) => n.closest(".post-card")?.remove());
  }

  /* ---------- actions ---------- */
  function bind(el) {
    el.querySelector(".hb-search").addEventListener("submit", (e) => { e.preventDefault(); const q = e.target.q.value.trim(); location.hash = q ? "#/search/" + enc(q) : "#/search"; });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-hb]"); if (!b) return;
      const a = b.dataset.hb;
      if (a === "compose") { e.preventDefault(); openComposer(); }
      else if (a === "aiwrite") { e.preventDefault(); typeof homeCompose === "function" ? homeCompose("ai") : openComposer(); }
      else if (a === "customize") customize(b);
      else if (a === "opps") { ls.set("mp_hub_opps", b.dataset.k); paintSection("opps"); LAZY.opps(); hubEl.querySelector("#hb-s-opps [aria-pressed=true]")?.focus(); }
      else if (a === "retry") { const s = b.closest("[data-lazy]"); if (s) { const k = s.dataset.lazy, key = k === "opps" ? "opps:" + (ls.get("mp_hub_opps") || "job") : k; delete C[key]; paintSection(k); LAZY[k](); } }
    });
  }

  /* ---------- «تخصيص صفحتي الرئيسية» ---------- */
  function customize(ret) {
    let draft = { order: myLayout().order.slice(), hidden: myLayout().hidden.slice() };
    const s = sheet(`<div class="hb-cz" role="dialog" aria-modal="true" aria-labelledby="hb-cz-t"></div>`);
    const box = s.querySelector(".hb-cz");
    s._onclose = () => { if (ret && ret.isConnected) ret.focus(); };
    const draw = (focusSel) => {
      box.innerHTML = `<h2 id="hb-cz-t">تخصيص صفحتي الرئيسية</h2><p class="hb-sub">اختر الأقسام التي تظهر لك ورتّبها كما تحب.</p>
        <ul class="hb-czl">
          <li class="hb-lock"><span>البحث والترحيب</span><small>ثابت في الأعلى</small></li>
          ${draft.order.map((k, i) => { const shown = !draft.hidden.includes(k); return `<li><label class="hb-czn"><input type="checkbox" data-k="${k}" ${shown ? "checked" : ""}> <span>${SECTIONS[k]}</span></label>
            <span class="hb-czm"><button type="button" class="hb-ib" data-up="${i}" aria-label="تحريك «${SECTIONS[k]}» للأعلى" ${i ? "" : "disabled"}>${ic("arrowUp")}</button><button type="button" class="hb-ib hb-dn" data-dn="${i}" aria-label="تحريك «${SECTIONS[k]}» للأسفل" ${i < draft.order.length - 1 ? "" : "disabled"}>${ic("arrowUp")}</button></span></li>`; }).join("")}
          <li class="hb-lock"><span>من المجتمع (المنشورات)</span><small>دائمًا في الأخير</small></li>
        </ul>
        <div class="hb-acts"><button type="button" class="btn ghost" data-cz="reset">استعادة الافتراضي</button><button type="button" class="btn" data-cz="save">حفظ</button></div>`;
      const f = focusSel && box.querySelector(focusSel); (f && !f.disabled ? f : box.querySelector("input"))?.focus();
    };
    box.addEventListener("change", (e) => { const k = e.target.dataset.k; if (!k) return; draft.hidden = e.target.checked ? draft.hidden.filter((x) => x !== k) : [...draft.hidden, k]; });
    box.addEventListener("click", async (e) => {
      const up = e.target.closest("[data-up]"), dn = e.target.closest("[data-dn]"), cz = e.target.closest("[data-cz]");
      if (up || dn) { const i = +(up ? up.dataset.up : dn.dataset.dn), j = up ? i - 1 : i + 1; if (j < 0 || j >= draft.order.length) return; [draft.order[i], draft.order[j]] = [draft.order[j], draft.order[i]]; draw(up ? `[data-up="${j}"]` : `[data-dn="${j}"]`); }
      else if (cz && cz.dataset.cz === "reset") { draft = { order: DEF.order.slice(), hidden: DEF.hidden.slice() }; draw(); }
      else if (cz && cz.dataset.cz === "save") { cz.disabled = true; const ok = await saveLayout(draft); closeSheet(); if (ok) toast("تم حفظ ترتيب صفحتك الرئيسية"); }
    });
    draw();
  }

  /* ---------- wiring ---------- */
  HomeHooks.section("hub", 5, mount);
  /* another device saved a new layout: the prefs stream ping re-reads it (the hub only, nothing else redraws) */
  let esBound = null;
  const bindStream = () => { const es = typeof Remote !== "undefined" && Remote.es; if (es && es !== esBound) { esBound = es; es.addEventListener("prefs", () => { prefsAt = 0; if (isHome()) pullPrefs(true); }); } };
  setInterval(bindStream, 5000); bindStream();
  window.MPHub = { on, layout: () => myLayout(), mount, sections: () => Object.keys(SECTIONS), _picks: () => pickPosts().map((x) => x.p.id) };
  /* the chunk usually lands after the first Home paint: put the hub in place now (no full re-render) and drop the feed cards it picked */
  if (isHome() && typeof view !== "undefined" && view.querySelector("#hcomp")) { mount(); dropDupes(); }
})();
