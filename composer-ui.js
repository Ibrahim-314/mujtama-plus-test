/* =====================================================================
 * مجتمع بلس — the editors (v2.50). Lazy chunk `composer` (+ composer.css), loaded after `composercore` (composer-core.js).
 * One shell (#composer3: close · title · saved · publish), three front-ends chosen by MPComposerCore.resolveMode():
 *   • community — simple: the community is fixed, big text area, images or one video (v2.60), optional poll or question, channel / tag, rules
 *   • general   — creative: every post type, formatting toolbar + live preview, images (drag to reorder, alt text),
 *                 writing assistant, audience, topic, place, schedule + best time, series, sensitive flag, drafts, templates
 *   • edit      — the text of one's own post, in the simple layout
 * Entry: openComposer(init) / window.MPComposer(init) (app.js) → MPEditor.open(init). Other chunks extend the editor through
 * window.MPComposerHooks ({id, modes, mount, onType, check, apply}) instead of patching the DOM or the API client
 * (paid-ui: «الوصول», minors-ui: content labels). Strict CSP: no inline handlers, no style="" attributes.
 * ===================================================================== */
(function ComposerUI() {
  const K = window.MPComposerCore; if (!K) return;
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const T = (s) => (window.MPI18n ? window.MPI18n.t(s) : s);
  const RT = () => window.RichText;
  const lang = () => (typeof DB !== "undefined" && DB.settings && DB.settings.lang) || "ar";
  const num = (n) => Number(n).toLocaleString(lang() === "ar" ? "ar" : lang());
  const device = (() => { let d = localStorage.getItem("mp_device"); if (!d) { d = (/Mobi/.test(navigator.userAgent) ? "phone-" : "web-") + Math.random().toString(36).slice(2, 8); localStorage.setItem("mp_device", d); } return d; })();
  const fmtDur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, "0")}`;
  const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const MODS = ["owner", "admin", "moderator"];

  /* icons the editors need beyond the core sprite */
  (function sprite() {
    const P = {
      image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
      film: '<path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/>',
      poll: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><rect x="7" y="13" width="9" height="4" rx="1"/><rect x="7" y="5" width="12" height="4" rx="1"/>',
      doc: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
      thread: '<path d="M8 5h13"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="M3 10a2 2 0 0 0 2 2h3"/><path d="M3 5v12a2 2 0 0 0 2 2h3"/>',
      cal: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
      clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'
    };
    const host = document.querySelector("symbol[id^='i-']")?.parentNode; if (!host) return;
    host.insertAdjacentHTML("beforeend", Object.entries(P).filter(([k]) => !document.getElementById("i-" + k)).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join(""));
  })();

  const TYPES = { post: ["منشور", "pen"], article: ["مقال", "doc"], poll: ["استطلاع", "poll"], question: ["سؤال", "help"], discussion: ["نقاش", "comment"], thread: ["سلسلة", "thread"], event: ["حدث", "cal"], video: ["فيديو", "film"], audio: ["صوت", "mic"], story: ["قصة", "sparkle"] };
  const TITLES = { post: "منشور جديد", article: "مقال جديد", poll: "استطلاع جديد", question: "سؤال جديد", discussion: "نقاش جديد", thread: "سلسلة جديدة", event: "حدث جديد", video: "فيديو جديد", audio: "مقطع صوتي جديد", story: "قصة جديدة" };
  const PH = { post: "ماذا يدور في بالك؟ استخدم شريط الأدوات للتنسيق", article: "ابدأ مقالك… # للعناوين، و▦ للجداول", poll: "اكتب سؤال الاستطلاع…", question: "تفاصيل إضافية (اختياري): ماذا جربت؟", discussion: "قدّم النقاش في سطرين…", thread: "الجزء الأول من السلسلة…", event: "عن الحدث (اختياري)", video: "وصف الفيديو (اختياري)", audio: "وصف قصير للمقطع (اختياري)", story: "نص على القصة (اختياري)" };
  const TITLE_PH = { article: "عنوان المقال", discussion: "عنوان النقاش", question: "سؤالك باختصار…" };
  const IMG_TYPES = ["post", "article", "poll", "question"];
  const VIS = [["public", "عام", "globe"], ["followers", "المتابعون", "users"], ["close", "المقربون", "heart"], ["list", "قائمة", "bookmark"], ["private", "أنا فقط", "lock"]];
  const HOURS = [[1, "ساعة"], [24, "يوم"], [72, "٣ أيام"], [168, "أسبوع"]];
  const TOOLS = [["b", "عريض", "**", "**"], ["i", "مائل", "*", "*"], ["s", "يتوسطه خط", "~~", "~~"], ["code", "كود", "`", "`"], ["h", "عنوان", "\n# ", ""], ["quote", "اقتباس", "\n> ", ""], ["ul", "قائمة", "\n- ", ""], ["ol", "قائمة مرقمة", "\n1. ", ""], ["link", "رابط", "[", "](https://)"], ["block", "كتلة كود", "\n```\n", "\n```\n"], ["table", "جدول", "\n| العمود ١ | العمود ٢ |\n|---|---|\n| ", " |  |\n"]];
  const TOOL_ICON = { b: "<b>B</b>", i: "<i class='c3-serif'>I</i>", s: "<s>S</s>", code: "<code>&lt;/&gt;</code>", h: "<b>H</b>", quote: "❝", ul: "•≡", ol: "1≡", link: ic("link", "xs"), block: "{ }", table: "▦" };
  const ARTICLE_ONLY = ["h", "table", "block"];
  const STORY_BG = ["#5b2bd6,#e0559b", "#0f766e,#14b8a6", "#f59e0b,#ef4444", "#111827,#4b5563"].map(g => `linear-gradient(135deg,${g})`);

  const hooks = () => (window.MPComposerHooks || []);
  /* v2.60 M1: the real per-file limits from the server (min of the upload limit and the storage cap), fetched once */
  let LIM = null, limP = null;
  const loadLimits = () => (LIM || !online() ? Promise.resolve(LIM) : (limP ||= api("GET", "/api/media/limits").then(r => (LIM = r.limits)).catch(() => { limP = null; return null; })));
  let cur = null;
  { // a chunk that registers its hook after the editor opened still joins the open editor
    const H = (window.MPComposerHooks = window.MPComposerHooks || []), push = H.push.bind(H);
    H.push = (...hs) => { const n = push(...hs); hs.forEach(h => cur?.mountHook?.(h)); return n; };
  }

  function open(init = {}) {
    if (cur) cur.close(true);
    const st = K.normalize(init, { now: new Date() });
    const mode = st.mode; loadLimits();
    if (mode === "edit" && !(typeof S !== "undefined" && S.post(st.editOf))) return toast(T("المنشور غير متاح"));
    const comm = st.community && typeof S !== "undefined" ? S.community(st.community) || null : null;
    const role = init.role || (st.community && typeof S !== "undefined" && S.membership ? S.membership(st.community)?.role : null) || null;
    const isMod = MODS.includes(role);
    const chans = (init.channels || []).filter(c => (c.postPerm === "members" || isMod) && !c.archivedAt && c.canPost !== false); // v2.58: archived / role channels are not offered
    let chReview = false, slowBlock = false, slowT = 0;
    const tags = init.tags || [];
    const commName = comm?.name || init.communityName || "المجتمع";
    const G = mode === "community" ? init.guard || null : null; // v2.62 T9: the member's guard status from the community page
    const blocked = mode === "community" && (["pending", "banned", "muted"].includes(role) || !!(G && !isMod && (G.muted || G.locked)) || (comm?.whoCanPost === "mods" && !isMod && role));
    const review = mode === "community" && comm?.requireApproval && !isMod;

    const el = document.createElement("div");
    el.id = "composer3"; el.className = `ced ced-${mode}`; el.dataset.mode = mode;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "c3-ttl");
    el.innerHTML = `<header class="c3-head">
        <button type="button" class="c3-ib" id="c3-x" aria-label="إغلاق">${ic("x")}</button>
        <div class="c3-ht"><h2 id="c3-ttl"></h2><span class="c3-saved" aria-live="polite"></span></div>
        <button type="button" class="btn" id="c3-pub">نشر</button>
      </header>
      <p class="c3-err" id="c3-err" role="alert" hidden></p>
      <div class="c3-body" id="c3-body">${mode === "community" ? communityBody() : mode === "edit" ? editBody() : generalBody()}</div>
      <div class="c3-bar" role="toolbar" aria-label="أدوات المحرر">${mode === "community" ? communityBar() : mode === "edit" ? "" : generalBar()}<span class="c3-count" aria-live="off"></span></div>`;
    document.body.appendChild(el); document.body.classList.add("composing");
    const $c = (s) => el.querySelector(s), $$ = (s) => [...el.querySelectorAll(s)];
    const txt = $c("#c3-text"), title = $c("#c3-title"), pub = $c("#c3-pub"), bar = $c(".c3-bar"), errEl = $c("#c3-err");
    let published = false, uploading = 0, closed = false, dT = 0, aT = 0;

    /* ---------- markup ---------- */
    function communityBody() {
      const rules = (comm?.rules || []).filter(r => r && (typeof r === "string" || r.title || r.text || r.body)).slice(0, 8);
      return `<div class="c3-chead"><span class="c3-cav" aria-hidden="true">${esc((init.icon || commName).slice(0, init.icon ? 4 : 1))}</span><div class="c3-cinfo"><b>${esc(commName)}</b><span>${review ? "يراجع المشرفون منشورك قبل ظهوره" : "يظهر منشورك لأعضاء المجتمع فوراً"}</span></div></div>
        ${blocked ? `<p class="c3-note warn" role="status">${ic(G?.locked ? "lock" : G?.muted || role === "muted" ? "clock" : "lock", "xs")} <span class="c3-nt">${G?.locked ? "<b>أنت موقوف عن الكتابة في هذا المجتمع حتى يراجع مشرف وضعك.</b>" : G?.muted || role === "muted" ? `<b>أنت مكتوم مؤقتاً في هذا المجتمع.</b>${G?.mutedUntil ? `<small><span>يُرفع الكتم</span> <bdi>${esc(new Date(G.mutedUntil).toLocaleString(lang() === "ar" ? "ar" : lang(), { dateStyle: "medium", timeStyle: "short" }))}</bdi></small>` : ""}` : "لا تملك صلاحية النشر في هذا المجتمع الآن."}${G?.muted || G?.locked || role === "muted" ? `<a class="c3-ap" href="#/cappeal/${esc(st.community)}" data-c3close>قراراتي والاستئناف</a>` : ""}</span></p>` : ""}<p class="c3-note" id="c3-slow" role="status" hidden></p>${rulesHint()}
        ${chans.length || tags.length ? `<div class="c3-cmeta">${chans.length ? `<select id="c3-ch" aria-label="القناة"><option value="">كل القنوات</option>${chans.map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join("")}</select>` : ""}${tags.length ? `<div class="c3-tagset" role="group" aria-label="الوسم">${tags.map(t => `<button type="button" class="chip" data-ctag="${esc(t.slug)}" aria-pressed="false">${esc(t.name)}</button>`).join("")}</div>` : ""}</div>` : ""}
        <input id="c3-title" class="c3-title" maxlength="200" placeholder="${TITLE_PH.question}" aria-label="السؤال" hidden>
        <textarea id="c3-text" class="c3-text c3-big" aria-label="النص" placeholder="شارك شيئاً مع المجتمع…"></textarea>
        <p class="c3-note warn c3-guard" id="c3-guard" role="status" hidden></p>
        <div class="c3-mention" id="c3-mention"></div>
        <div id="c3-type-bottom"></div>
        <div id="c3-type-top"></div>
        <div id="c3-images" class="c3-images"></div>
        <div data-slot="content"></div>
        ${rules.length ? `<details class="c3-rules"><summary>${ic("shield", "xs")} قواعد المجتمع</summary><ol>${rules.map(ruleLi).join("")}</ol></details>` : ""}`;
    }
    /* rules may be plain strings or { title, text } objects (cadmin rules editor) — never print «[object Object]» */
    function ruleLi(r) {
      if (typeof r === "string") return `<li><bdi>${esc(r)}</bdi></li>`;
      const t = r?.title || "", d = r?.text || r?.body || "";
      return `<li>${t ? `<b><bdi>${esc(t)}</bdi></b>` : ""}${t && d ? " — " : ""}${d ? `<bdi>${esc(d)}</bdi>` : ""}</li>`;
    }
    /* v2.62 lf-rules-hint: a small collapsible line with the community's top 3 rules; collapsed state remembered per community */
    function rulesHint() {
      const top = (comm?.rules || []).map(r => (typeof r === "string" ? r : r?.title)).filter(Boolean).slice(0, 3);
      if (!top.length || !st.community) return "";
      let off = false; try { off = localStorage.getItem("mp_rh_" + st.community) === "0"; } catch { /* private mode */ }
      return `<div class="c3-rhint" id="c3-rhint"><div class="c3-rh-h"><button type="button" class="c3-rh-t" id="c3-rh-t" aria-expanded="${!off}" aria-controls="c3-rh-l">${ic("shield", "xs")}<b>أهم القواعد</b></button><a class="c3-rh-all" id="c3-rh-all" href="#/c/${encodeURIComponent(st.community)}/about"${off ? " hidden" : ""}>عرض الكل</a></div><p class="c3-rh-l" id="c3-rh-l"${off ? " hidden" : ""}>${top.map(r => `<span><bdi>${esc(r)}</bdi></span>`).join("")}</p></div>`;
    }
    function communityBar() {
      return `${comm?.allowMedia === false ? "" : `<button type="button" class="c3-act" data-act="img">${ic("image")}<span>صورة</span></button><button type="button" class="c3-act" data-act="video" aria-pressed="false">${ic("film")}<span>فيديو</span></button>`}<button type="button" class="c3-act" data-act="poll" aria-pressed="false">${ic("poll")}<span>استطلاع</span></button><button type="button" class="c3-act" data-act="question" aria-pressed="false">${ic("help")}<span>سؤال</span></button>`;
    }
    function editBody() {
      return `<p class="c3-note">${ic("pen", "xs")} يمكن تعديل النص فقط، ويظهر للقراء أن المنشور عُدّل.</p><textarea id="c3-text" class="c3-text c3-big" aria-label="النص"></textarea><input id="c3-title" hidden>`;
    }
    function generalBody() {
      const q = st.quoteOf && typeof S !== "undefined" ? S.post(st.quoteOf) : null;
      const lists = (typeof DB !== "undefined" && DB.lists) || [];
      return `${st.quoteOf ? `<div class="c3-quote card">${ic("repost", "xs")} <span>${esc(((q?.title || q?.text) || "منشور").slice(0, 160))}</span></div>` : `<div class="c3-types" role="tablist" aria-label="نوع المنشور">${K.GENERAL_TYPES.map(k => `<button type="button" role="tab" data-t="${k}" aria-selected="false">${ic(TYPES[k][1], "xs")}<span>${TYPES[k][0]}</span></button>`).join("")}</div>`}
        ${st.community ? `<div class="c3-incomm"><span class="chip">${ic("users", "xs")} في ${esc(commName)}</span></div>` : ""}
        <div class="c3-modes"><div class="seg c3-seg" role="group" aria-label="العرض"><button type="button" data-m="write" class="on" aria-pressed="true">كتابة</button><button type="button" data-m="preview" aria-pressed="false">معاينة</button></div><span class="grow"></span>${online() ? `<button type="button" class="c3-link" id="c3-drafts">${ic("bookmark", "xs")} المسودات</button><button type="button" class="c3-link" id="c3-tpl">${ic("copy", "xs")} القوالب</button>` : ""}</div>
        <div class="c3-cols"><div class="c3-write">
          <div id="c3-type-top"></div>
          <input id="c3-title" class="c3-title" maxlength="200" aria-label="العنوان">
          <textarea id="c3-text" class="c3-text" aria-label="النص" data-mp-assist></textarea>
          <div class="c3-mention" id="c3-mention"></div>
          <div id="c3-type-bottom"></div>
          <div id="c3-images" class="c3-images"></div>
          <div id="c3-assist" class="c3-assist" aria-live="polite"></div>
          <div data-slot="content"></div>
          <details class="c3-opts" id="c3-opts"><summary>${ic("settings", "xs")}<span>خيارات النشر</span><span class="c3-sum" id="c3-sum"></span></summary>
            <div class="c3-opt"><span class="c3-ol" id="c3-vis-l">الجمهور</span><div class="c3-chips" role="radiogroup" aria-labelledby="c3-vis-l">${VIS.filter(v => v[0] !== "list" || lists.length).map(([k, l, i]) => `<button type="button" class="chip" role="radio" data-vis="${k}" aria-checked="false">${ic(i, "xs")} ${l}</button>`).join("")}</div>
              ${lists.length ? `<select id="c3-list" aria-label="القائمة" hidden>${lists.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("")}</select>` : ""}</div>
            <div class="c3-opt c3-2"><label><span class="c3-ol">الموضوع</span><select id="c3-top"><option value="">تلقائي</option>${(typeof TOPICS !== "undefined" ? TOPICS : []).map(t => `<option value="${t.slug}">${esc(t.name)}</option>`).join("")}</select></label><label><span class="c3-ol">الموقع</span><input id="c3-loc" maxlength="80" placeholder="مثل: جدة"></label></div>
            <div class="c3-opt" id="c3-sch-w"><label class="c3-ol" for="c3-sch">جدولة النشر</label><div class="c3-row"><input type="datetime-local" id="c3-sch">${online() ? `<button type="button" class="btn ghost" id="c3-best">${ic("target", "xs")} أفضل وقت</button>` : ""}</div></div>
            <div class="c3-opt" id="c3-series-w"><label class="c3-ol" for="c3-series">ضمن سلسلة مقالات</label><select id="c3-series"><option value="">بدون سلسلة</option><option value="new">سلسلة جديدة…</option></select></div>
            <label class="c3-switch"><input type="checkbox" id="sens"><span>تحذير: محتوى حساس</span></label>
            <div data-slot="options"></div>
            ${online() ? `<button type="button" class="btn ghost block" id="c3-save-tpl">${ic("copy", "xs")} حفظ كقالب</button>` : ""}
          </details>
        </div><div id="c3-preview" class="c3-preview rich" aria-label="معاينة"></div></div>`;
    }
    function generalBar() {
      return `<button type="button" data-tool="img" class="c3-imgb" aria-label="إضافة صور" title="إضافة صور">${ic("image")}</button><div class="c3-tools">${TOOLS.map(([k, l]) => `<button type="button" data-tool="${k}" aria-label="${l}" title="${l}">${TOOL_ICON[k]}</button>`).join("")}</div>`;
    }

    /* ---------- state ↔ inputs ---------- */
    txt.value = st.markdown; if (title) title.value = st.title;
    if (mode === "community") {
      if ($c(".c3-cav")) $c(".c3-cav").style.background = comm?.accent || comm?.color || "var(--grad)";
      if ($c("#c3-ch")) $c("#c3-ch").value = chans.some(c => c.id === st.channel) ? st.channel : "";
      $$("[data-ctag]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.ctag === st.ctag)));
    }
    if (mode === "general") {
      $c("#c3-top").value = st.topic; $c("#c3-loc").value = st.location; $c("#c3-sch").value = st.publishAt; $c("#sens").checked = st.sensitive;
      if ($c("#c3-list")) $c("#c3-list").value = st.list || $c("#c3-list").value;
      const mySeries = typeof DB !== "undefined" ? [...new Map(DB.posts.filter(p => p.author === DB.me && p.series && p.type === "article").map(p => [p.series, p])).values()] : [];
      $c("#c3-series").insertAdjacentHTML("beforeend", mySeries.map(p => `<option value="${esc(p.series)}">${esc((p.title || p.text || "").slice(0, 40))}</option>`).join(""));
      $c("#c3-series").value = st.series && mySeries.some(p => p.series === st.series) ? st.series : "";
      $c("#c3-sch").min = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    }
    if (mode === "edit") txt.value = st.markdown;

    const grow = (t) => { if (!t) return; t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; };
    function read() {
      st.markdown = txt.value; if (title && !title.hidden) st.title = title.value;
      if (mode === "general") {
        st.topic = $c("#c3-top").value; st.location = $c("#c3-loc").value; st.publishAt = $c("#c3-sch").value; st.sensitive = $c("#sens").checked;
        if ($c("#c3-list")) st.list = st.visibility === "list" ? $c("#c3-list").value : "";
      }
      if (mode === "community" && $c("#c3-ch")) st.channel = $c("#c3-ch").value;
    }

    /* ---------- header, counter, publish label ---------- */
    function paintHead() {
      const h = $c("#c3-ttl");
      h.textContent = mode === "community" ? "منشور في المجتمع" : mode === "edit" ? "تعديل المنشور" : st.quoteOf ? "اقتباس مع رأيك" : TITLES[st.type];
      pub.textContent = mode === "edit" ? "حفظ" : mode === "community" ? (review || chReview ? "إرسال للمراجعة" : "نشر") : st.publishAt && st.type !== "story" ? "جدولة" : "نشر";
      pub.disabled = !!blocked || slowBlock;
      const c = K.counter(st), cnt = $c(".c3-count");
      cnt.textContent = `${num(c.n)}/${num(c.lim)}`; cnt.classList.toggle("over", c.over); cnt.classList.toggle("near", !c.over && c.left < 200);
      if (mode === "general") {
        const vis = VIS.find(v => v[0] === st.visibility)?.[1] || "عام";
        $c("#c3-sum").textContent = [vis, st.publishAt && st.type !== "story" ? "مجدول" : "", st.sensitive ? "حساس" : ""].filter(Boolean).join(" · ");
        $$("[data-vis]").forEach(b => { const on = b.dataset.vis === st.visibility; b.setAttribute("aria-checked", String(on)); b.classList.toggle("on", on); b.tabIndex = on ? 0 : -1; });
        if ($c("#c3-list")) $c("#c3-list").hidden = st.visibility !== "list";
      }
    }
    const showErr = (msg, field) => {
      errEl.textContent = T(msg); errEl.hidden = !msg;
      const f = { text: txt, title, event: $c("#c3-evn"), poll: $c("[data-po]"), parts: $c("[data-pt]"), stances: $c("[data-sn]"), publishAt: $c("#c3-sch"), list: $c("#c3-list") }[field];
      if (f && ["publishAt", "list"].includes(field)) $c("#c3-opts").open = true;
      if (f && !f.hidden) f.focus();
    };

    /* ---------- types ---------- */
    const imagesAllowed = () => mode !== "edit" && online() && (mode === "community" ? comm?.allowMedia !== false : IMG_TYPES.includes(st.type));
    function applyType() {
      if (mode === "general") {
        $$("[data-t]").forEach(b => { const on = b.dataset.t === st.type; b.setAttribute("aria-selected", String(on)); b.classList.toggle("on", on); b.tabIndex = on ? 0 : -1; });
        title.hidden = !TITLE_PH[st.type]; title.placeholder = TITLE_PH[st.type] || ""; title.setAttribute("aria-label", TITLE_PH[st.type] || "العنوان");
        txt.placeholder = PH[st.type];
        const rich = ["post", "article"].includes(st.type);
        $$("[data-tool]").forEach(b => { b.hidden = b.dataset.tool === "img" ? !imagesAllowed() : !rich || (ARTICLE_ONLY.includes(b.dataset.tool) && st.type !== "article"); });
        $c(".c3-tools").hidden = !rich;
        $c("#c3-series-w").hidden = st.type !== "article"; $c("#c3-sch-w").hidden = st.type === "story";
        typeTop();
      } else if (mode === "community") {
        title.hidden = st.type !== "question";
        txt.placeholder = st.type === "poll" ? "اكتب سؤال الاستطلاع…" : st.type === "question" ? "تفاصيل السؤال (اختياري)" : st.type === "video" ? "وصف الفيديو (اختياري)" : "شارك شيئاً مع المجتمع…";
        $$("[data-act=poll],[data-act=question],[data-act=video]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.act === st.type)));
        typeTop();
      }
      el.dataset.type = st.type;
      typeBottom();
      $c("#c3-images") && ($c("#c3-images").hidden = !imagesAllowed() && !st.images.length);
      hooks().forEach(h => { if (active(h)) try { h.onType?.(st.type, hx); } catch { } });
      paintHead();
    }
    function typeTop() {
      const top = $c("#c3-type-top"); if (!top) return;
      if (st.type === "event") {
        top.innerHTML = `<div class="c3-card"><input id="c3-evn" maxlength="100" placeholder="اسم الحدث" aria-label="اسم الحدث"><div class="c3-2"><label><span class="c3-ol">الموعد</span><input type="datetime-local" id="c3-evt"></label><label><span class="c3-ol">المكان</span><input id="c3-evp" maxlength="100" placeholder="المكان أو أونلاين"></label></div></div>`;
        const n = $c("#c3-evn"), t = $c("#c3-evt"), p = $c("#c3-evp");
        n.value = st.event.name; t.value = st.event.startsAt; p.value = st.event.place; t.min = $c("#c3-sch").min;
        [n, t, p].forEach(i => i.addEventListener("input", () => { st.event = { name: n.value, startsAt: t.value, place: p.value }; changed(); }));
      } else if (st.type === "video") {
        const vbusy = videoUp > 0;
        top.innerHTML = `<div class="c3-card c3-media">${st.video ? `<video src="${esc(st.video.url || "")}" controls playsinline preload="metadata"></video>` : `<button type="button" class="c3-drop" id="c3-vpick" ${vbusy ? "disabled aria-busy=\"true\"" : ""}>${vbusy ? `<span class="c3-spin"></span><b>جارٍ رفع الفيديو…</b>` : `${ic("film")}<b>اختر فيديو</b><span>قصير أو طويل · يُجهَّز تلقائياً بجودات متعددة</span>`}</button>`}
          <div class="c3-row">${st.video ? `<button type="button" class="btn ghost" id="c3-vpick">${ic("refresh", "xs")} استبدال</button>` : ""}${mode === "community" && st.video ? `<button type="button" class="btn ghost" id="c3-vrm">${ic("x", "xs")} إزالة</button>` : ""}<a class="c3-vidtik" href="#/clips/create" id="c3-vidtik">${ic("video", "xs")} ${T("انشر في فيديوتك")}</a></div><p class="c3-hint" id="c3-vlim">${esc(limitHint("video"))}</p><p class="c3-hint" id="c3-vst" aria-live="polite"></p></div>`;
        if (vbusy && vUp) { $c("#c3-vpick").insertAdjacentHTML("afterend", `<div class="c3-up"><div class="c3-prog" id="c3-vprog" role="progressbar" aria-label="تقدّم رفع الفيديو" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><div class="c3-row"><span class="grow c3-hint" id="c3-vpct" aria-hidden="true"></span><button type="button" class="btn ghost" id="c3-vcancel">${ic("x", "xs")} إلغاء الرفع</button></div></div>`); paintProg(); }
        $c("#c3-vcancel")?.addEventListener("click", () => { if (vUp) vUp.cancel = true; });
        $c("#c3-vpick").onclick = () => pick("video/*", false, ([f]) => f && addVideo(f));
        $c("#c3-vrm")?.addEventListener("click", () => { st.video = null; read(); st.type = "post"; applyType(); changed(); });
        
        if (!LIM) loadLimits().then(() => { const l = $c("#c3-vlim"); if (l) l.textContent = limitHint("video"); });
      } else if (st.type === "audio") {
        top.innerHTML = `<div class="c3-card rec"><div class="c3-row"><button type="button" class="btn" id="rec-go">${ic("mic", "sm")} تسجيل</button><span class="grow c3-hint" id="rec-t">${st.audioId ? "مقطع جاهز" : "حتى ١٠ دقائق"}</span><button type="button" class="btn ghost" id="rec-file">${ic("plus", "xs")} ملف</button></div><div class="rec-meter" aria-hidden="true"></div></div>`;
        recorder();
      } else if (st.type === "story") {
        top.innerHTML = `<div class="c3-card story-pick"><div class="sp-prev" id="sp-prev">${st.story?.url ? (st.story.kind === "video" ? `<video src="${esc(st.story.url)}" muted autoplay loop playsinline></video>` : `<img src="${esc(st.story.url)}" alt="">`) : ""}</div><div class="c3-row"><button type="button" class="btn ghost grow" id="sp-file">${ic("camera", "xs")} صورة أو فيديو</button>${STORY_BG.map((g, i) => `<button type="button" class="sp-bg" data-bg="${i}" aria-label="خلفية ${i + 1}"></button>`).join("")}</div><p class="c3-hint">تختفي القصة بعد ٢٤ ساعة</p></div>`;
        $c("#sp-prev").style.background = st.story?.bg || STORY_BG[0];
        $$(".sp-bg").forEach(b => { b.style.background = STORY_BG[+b.dataset.bg]; b.onclick = () => { st.story = { bg: STORY_BG[+b.dataset.bg] }; typeTop(); changed(); }; });
        $c("#sp-file").onclick = () => pick("image/*,video/*", false, async ([f]) => { if (!f) return; uploading++; try { const m = await upload(f); st.story = { kind: m.kind, url: m.url, id: m.id }; typeTop(); changed(); } catch (e) { toast(e.message); } finally { uploading--; } });
      } else top.innerHTML = "";
    }
    function typeBottom() {
      const box = $c("#c3-type-bottom"); if (!box) return;
      if (st.type === "poll") {
        const P = st.poll, full = mode === "general";
        box.innerHTML = `<fieldset class="c3-card c3-poll"><legend class="c3-ol">خيارات الاستطلاع</legend>${P.options.map((o, i) => `<div class="c3-po"><input data-po="${i}" maxlength="100" placeholder="الخيار ${i + 1}" aria-label="الخيار ${i + 1}">${i >= 2 ? `<button type="button" class="c3-ib" data-po-x="${i}" aria-label="حذف الخيار ${i + 1}">${ic("x", "xs")}</button>` : ""}</div>`).join("")}
          ${P.options.length < K.LIMITS.pollMax ? `<button type="button" class="c3-add" id="c3-po-add">${ic("plus", "xs")} خيار</button>` : ""}
          <div class="c3-row c3-poll-s"><label class="c3-inl"><span class="c3-ol">المدة</span><select id="c3-po-h">${HOURS.map(([h, l]) => `<option value="${h}">${l}</option>`).join("")}</select></label>${full ? `<label class="c3-switch"><input type="checkbox" id="c3-po-m"><span>عدة اختيارات</span></label><label class="c3-switch"><input type="checkbox" id="c3-po-r"><span>إخفاء النتائج حتى الانتهاء</span></label>` : ""}</div></fieldset>`;
        $$("[data-po]").forEach(i => { i.value = P.options[+i.dataset.po]; i.addEventListener("input", () => { P.options[+i.dataset.po] = i.value; changed(); }); i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const nx = $c(`[data-po="${+i.dataset.po + 1}"]`); if (nx) nx.focus(); else $c("#c3-po-add")?.click(); } }); });
        $$("[data-po-x]").forEach(b => b.onclick = () => { P.options.splice(+b.dataset.poX, 1); typeBottom(); changed(); });
        const add = $c("#c3-po-add"); if (add) add.onclick = () => { P.options.push(""); typeBottom(); changed(); $c(`[data-po="${P.options.length - 1}"]`)?.focus(); };
        $c("#c3-po-h").value = String(P.hours); $c("#c3-po-h").onchange = (e) => { P.hours = +e.target.value; changed(); };
        if (full) { $c("#c3-po-m").checked = P.multi; $c("#c3-po-r").checked = P.hideResults; $c("#c3-po-m").onchange = (e) => { P.multi = e.target.checked; changed(); }; $c("#c3-po-r").onchange = (e) => { P.hideResults = e.target.checked; changed(); }; }
      } else if (st.type === "thread") {
        box.innerHTML = `<ol class="c3-parts">${st.parts.map((p, i) => `<li><textarea data-pt="${i}" class="c3-part" maxlength="5000" placeholder="الجزء ${i + 2}" aria-label="الجزء ${i + 2}"></textarea>${st.parts.length > 1 ? `<button type="button" class="c3-ib" data-pt-x="${i}" aria-label="حذف الجزء ${i + 2}">${ic("x", "xs")}</button>` : ""}</li>`).join("")}</ol>${st.parts.length < K.LIMITS.parts ? `<button type="button" class="c3-add" id="c3-pt-add">${ic("plus", "xs")} جزء</button>` : ""}`;
        $$("[data-pt]").forEach(t => { t.value = st.parts[+t.dataset.pt]; t.addEventListener("input", () => { st.parts[+t.dataset.pt] = t.value; changed(); }); });
        $$("[data-pt-x]").forEach(b => b.onclick = () => { st.parts.splice(+b.dataset.ptX, 1); typeBottom(); changed(); });
        const add = $c("#c3-pt-add"); if (add) add.onclick = () => { st.parts.push(""); typeBottom(); $c(`[data-pt="${st.parts.length - 1}"]`)?.focus(); };
      } else if (st.type === "discussion") {
        box.innerHTML = `<fieldset class="c3-card"><legend class="c3-ol">المواقف</legend>${st.stances.map((s, i) => `<div class="c3-po"><input data-sn="${i}" maxlength="60" aria-label="الموقف ${i + 1}"></div>`).join("")}${st.stances.length < K.LIMITS.stances ? `<button type="button" class="c3-add" id="c3-sn-add">${ic("plus", "xs")} موقف</button>` : ""}</fieldset>`;
        $$("[data-sn]").forEach(i => { i.value = st.stances[+i.dataset.sn]; i.addEventListener("input", () => { st.stances[+i.dataset.sn] = i.value; changed(); }); });
        const add = $c("#c3-sn-add"); if (add) add.onclick = () => { st.stances.push(""); typeBottom(); $c(`[data-sn="${st.stances.length - 1}"]`)?.focus(); };
      } else box.innerHTML = "";
    }
    $$("[data-t]").forEach(b => b.onclick = () => { read(); st.type = b.dataset.t; applyType(); changed(); });
    $c(".c3-types")?.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      const tabs = $$("[data-t]"), i = tabs.findIndex(b => b.dataset.t === st.type), rtl = getComputedStyle(el).direction === "rtl";
      const step = (e.key === "ArrowLeft") !== rtl ? -1 : 1, n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + step + tabs.length) % tabs.length;
      e.preventDefault(); tabs[n].click(); tabs[n].focus();
    });
    $$("[data-act]").forEach(b => b.onclick = () => {
      if (b.dataset.act === "img") return pickImages(false);
      if (b.dataset.act === "video") {
        if (st.type === "video") { if (st.video || videoUp) return; read(); st.type = "post"; applyType(); changed(); return; }
        if (st.images.length) return showErr("منشور الفيديو لا يجمع معه صوراً: أزل الصور أولاً أو انشر الفيديو في منشور مستقل");
        read(); st.type = "video"; applyType(); changed();
        if (!st.video) pick("video/*", false, ([f]) => f && addVideo(f));
        return;
      }
      read(); st.type = st.type === b.dataset.act ? "post" : b.dataset.act; applyType(); changed();
      (st.type === "question" ? title : st.type === "poll" ? txt : txt).focus();
    });
    $$("[data-ctag]").forEach(b => b.onclick = () => { st.ctag = st.ctag === b.dataset.ctag ? "" : b.dataset.ctag; $$("[data-ctag]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.ctag === st.ctag))); changed(); });
    $$("[data-vis]").forEach(b => b.onclick = () => { st.visibility = b.dataset.vis; read(); paintHead(); changed(); if (st.visibility === "list") $c("#c3-list")?.focus(); });
    $c(".c3-chips")?.addEventListener("keydown", (e) => { if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return; const r = $$("[data-vis]"), i = r.findIndex(b => b.dataset.vis === st.visibility), rtl = getComputedStyle(el).direction === "rtl"; const n = r[(i + ((e.key === "ArrowLeft") !== rtl ? -1 : 1) + r.length) % r.length]; e.preventDefault(); n.click(); n.focus(); });

    /* ---------- write / preview ---------- */
    const wide = matchMedia("(min-width: 1100px)");
    const setView = (pv) => { el.classList.toggle("pv", pv); $$("[data-m]").forEach(b => { const on = (b.dataset.m === "preview") === pv; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }); if (pv || wide.matches) renderPreview(); };
    $$("[data-m]").forEach(b => b.onclick = () => setView(b.dataset.m === "preview"));
    function renderPreview() {
      const box = $c("#c3-preview"); if (!box) return; read();
      const R = RT(), md = st.markdown, ttl = st.title.trim(), para = (t) => esc(t).replace(/\n/g, "<br>");
      let h = "";
      if (st.type === "event" && st.event.name) h += `<div class="pv-event">${ic("cal", "sm")}<div><b>${esc(st.event.name)}</b><div class="muted">${st.event.startsAt ? esc(new Date(st.event.startsAt).toLocaleString(lang() === "ar" ? "ar" : lang(), { dateStyle: "medium", timeStyle: "short" })) : ""}${st.event.place ? " · " + esc(st.event.place) : ""}</div></div></div>`;
      if (ttl && TITLE_PH[st.type]) h += `<h1 class="pv-title">${esc(ttl)}</h1>${st.type === "article" && R ? `<div class="muted">${R.readingMinutes(R.parse(md))} د قراءة</div>` : ""}`;
      if (md.trim()) h += ["post", "article"].includes(st.type) && R ? R.toHTML(R.parse(md)) : `<p>${para(md)}</p>`;
      if (st.type === "poll") h += `<ul class="pv-poll">${st.poll.options.filter(o => o.trim()).map(o => `<li>${esc(o)}</li>`).join("")}</ul>`;
      if (st.type === "discussion") h += `<ul class="pv-poll">${st.stances.filter(o => o.trim()).map(o => `<li>${esc(o)}</li>`).join("")}</ul>`;
      if (st.type === "thread") h += st.parts.filter(p => p.trim()).map((p, i) => `<div class="pv-part"><span class="chip">${i + 2}</span><p>${para(p)}</p></div>`).join("");
      if (st.images.length && IMG_TYPES.includes(st.type)) h += `<div class="gallery g${Math.min(5, st.images.length)}">${st.images.slice(0, 5).map((u, i) => `<img src="${esc(u)}" alt="${esc(st.alts[i] || "")}">`).join("")}</div>`;
      if (st.type === "video" && st.video?.url) h += `<video src="${esc(st.video.url)}" controls playsinline preload="metadata"></video>`;
      box.innerHTML = `<div class="pv-label">${ic("eye", "xs")} معاينة</div>` + (h || `<p class="muted">لا شيء للمعاينة بعد</p>`);
    }

    /* ---------- toolbar (formatting) ---------- */
    bar.addEventListener("pointerdown", (e) => { if (e.target.closest("[data-tool]")) e.preventDefault(); }); // keep the keyboard open
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tool]"); if (!b) return;
      if (b.dataset.tool === "img") return pickImages(st.type === "article");
      const [, , pre, post] = TOOLS.find(t => t[0] === b.dataset.tool);
      const s = txt.selectionStart, en = txt.selectionEnd, sel = txt.value.slice(s, en) || (b.dataset.tool === "link" ? "النص" : "");
      const p0 = s === 0 || txt.value[s - 1] === "\n" ? pre.replace(/^\n/, "") : pre;
      txt.setRangeText(p0 + sel + post, s, en, "end"); if (!sel) txt.selectionStart = txt.selectionEnd = s + p0.length; txt.focus(); changed();
    });
    const vv = window.visualViewport ? () => { const off = innerHeight - visualViewport.height - visualViewport.offsetTop; bar.style.transform = `translateY(${-Math.max(0, off)}px)`; } : null;
    if (vv) { visualViewport.addEventListener("resize", vv); visualViewport.addEventListener("scroll", vv); }

    /* ---------- images: upload, paste, drop, reorder, alt text ---------- */
    function pick(accept, multiple, cb) { const inp = Object.assign(document.createElement("input"), { type: "file", accept, multiple }); inp.onchange = () => cb([...inp.files]); inp.click(); }
    /* v2.60 M3: a file bigger than one chunk goes up in resumable chunks (progress, 3 tries per chunk with backoff, resume
     * when the connection returns, cancel); a small file keeps the single POST /api/media. `ui` = { onProgress(0..1), cancelled() }
     * v2.70: a video above 20 MB ALWAYS takes the resumable path, even if the server announces chunks larger than that. */
    const VIDEO_CHUNKED_AT = 20 * 1024 * 1024;
    const chunkAt = (f) => (/^video\//.test(f.type || "") ? Math.min(upChunk, VIDEO_CHUNKED_AT) : upChunk);
    const upload = async (f, kind, ui) => (f.size > chunkAt(f) && kind !== "audio" ? await chunked(f, ui || {}) : (await api("POST", "/api/media" + (kind ? "?kind=" + kind : ""), null, f)).media);
    async function chunked(f, ui) {
      const stop = () => { if (ui.cancelled?.()) { const e = new Error(T("أُلغي الرفع")); e.code = "cancelled"; throw e; } };
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const offline = (e) => e?.status === 0 || e?.code === "offline" || navigator.onLine === false;
      const backOnline = () => new Promise(r => { const t = setInterval(() => { if (navigator.onLine || ui.cancelled?.()) { clearInterval(t); removeEventListener("online", on); r(); } }, 1000); const on = () => { clearInterval(t); r(); }; addEventListener("online", on, { once: true }); });
      const u = (await api("POST", "/api/media/uploads", { filename: f.name || "file", mime: f.type || "application/octet-stream", size: f.size })).upload;
      upChunk = u.chunkSize || upChunk;
      let todo = [...(u.missing || Array.from({ length: u.totalChunks }, (_, i) => i))], done = u.totalChunks - todo.length;
      const tick = () => ui.onProgress?.(Math.min(0.99, done / u.totalChunks)); tick();
      while (todo.length) {
        stop(); const i = todo[0];
        for (let n = 1; ; n++) {
          try { await api("PUT", `/api/media/uploads/${encodeURIComponent(u.uploadId)}/chunk?index=${i}`, null, f.slice(i * u.chunkSize, Math.min(f.size, (i + 1) * u.chunkSize))); break; }
          catch (e) {
            stop();
            if (offline(e)) { ui.onWait?.(true); await backOnline(); ui.onWait?.(false); stop(); const s = (await api("GET", `/api/media/uploads/${encodeURIComponent(u.uploadId)}`)).upload; todo = [...s.missing]; done = s.totalChunks - todo.length; tick(); n = 0; if (!todo.includes(i)) break; continue; }
            if (n >= 3 || (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status))) throw e;
            await wait(400 * 3 ** (n - 1));
          }
        }
        todo = todo.filter(x => x !== i); done++; tick();
      }
      stop();
      const m = (await api("POST", `/api/media/uploads/${encodeURIComponent(u.uploadId)}/complete`)).media; ui.onProgress?.(1); return m;
    }
    /* v2.60 M1: one picker for images AND videos where a video can go; nothing is dropped silently — every refusal is said */
    let videoUp = 0, upChunk = 5 * 1024 * 1024, vUp = null; // vUp: the running video upload { pct, wait, cancel }
    const isVid = (f) => /^video\//.test(f.type) || /\.(mp4|m4v|mov|webm|3gp|mkv)$/i.test(f.name || "");
    const isImg = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(f.name || "");
    const videoAllowed = () => mode !== "edit" && online() && (mode === "community" ? comm?.allowMedia !== false && !!$c('[data-act="video"]') && !$c('[data-act="video"]').hidden : true);
    const mb = (n) => `${num(Math.round(n / (1024 * 1024)))} ${T("ميغابايت")}`;
    function limitHint(kind) { const l = LIM && LIM[kind]; return l ? `${T("الحد الأقصى للملف")}: ${mb(l)}` : ""; }
    function tooBig(f, kind) { const l = LIM && LIM[kind]; return l && f.size > l ? `${T(kind === "video" ? "الفيديو أكبر من الحد المسموح" : "الصورة أكبر من الحد المسموح")} (${mb(l)}). ${T(kind === "video" ? "اختر مقطعاً أقصر أو بجودة أقل." : "اختر صورة أصغر.")}` : ""; }
    async function addVideo(f) {
      if (!videoAllowed()) return showErr(online() ? "الفيديو غير مسموح هنا" : "الفيديو يحتاج اتصالاً بالإنترنت");
      if (st.images.length) return showErr("منشور الفيديو لا يجمع معه صوراً: أزل الصور أولاً أو انشر الفيديو في منشور مستقل");
      if (!["post", "video"].includes(st.type)) return showErr(mode === "community" ? "أزل الاستطلاع أو السؤال أولاً لإضافة فيديو" : "اختر نوع «فيديو» لنشر مقطع فيديو");
      await loadLimits(); const big = tooBig(f, "video"); if (big) return showErr(big);
      if (st.type !== "video") { read(); st.type = "video"; applyType(); }
      const me = vUp = { pct: 0, wait: false, cancel: false };
      uploading++; videoUp++; typeTop(); const stEl = () => $c("#c3-vst"); if (stEl()) stEl().textContent = T("جارٍ رفع الفيديو…");
      const ui = { cancelled: () => me.cancel, onProgress: (p) => { me.pct = Math.round(p * 100); paintProg(); }, onWait: (w) => { me.wait = w; paintProg(); } };
      const end = () => { if (vUp === me) vUp = null; videoUp--; uploading--; };
      try { const m = await upload(f, undefined, ui); if (me.cancel) throw Object.assign(new Error(T("أُلغي الرفع")), { code: "cancelled" }); if (m.kind !== "video") throw new Error(T("الملف ليس فيديو مدعوماً")); st.video = { mediaId: m.id, url: m.url, short: false }; end(); typeTop(); changed(); }
      catch (e) { end(); typeTop(); if (e.code === "cancelled") { if (stEl()) stEl().textContent = T("أُلغي الرفع"); return; } const msg = e.message || T("تعذّر رفع الفيديو"); if (stEl()) stEl().textContent = msg; showErr(msg); }
    }
    /** v2.60 M3: the video card's progress bar (real percent from the chunked upload) */
    function paintProg() {
      const b = $c("#c3-vprog"); if (!b || !vUp) return;
      b.setAttribute("aria-valuenow", String(vUp.pct)); b.setAttribute("aria-valuetext", vUp.wait ? T("بانتظار الاتصال…") : `${num(vUp.pct)}%`);
      b.querySelector("i").style.width = vUp.pct + "%"; const t = $c("#c3-vpct"); if (t) t.textContent = vUp.wait ? T("بانتظار الاتصال… سيُستأنف الرفع تلقائياً") : `${num(vUp.pct)}%`;
    }
    /** route picked / pasted / dropped files: images to the gallery, a video to the video post, the rest refused with a reason */
    function addFiles(files, inline) {
      const vids = files.filter(isVid), imgs = files.filter(f => !isVid(f) && isImg(f)), other = files.length - vids.length - imgs.length;
      if (vids.length) {
        if (inline) return showErr("يمكن إدراج الصور فقط داخل المقال");
        if (imgs.length || vids.length > 1) return showErr("اختر فيديو واحداً، أو صوراً فقط: لا يجتمع الفيديو مع الصور في منشور واحد");
        return addVideo(vids[0]);
      }
      if (other && !imgs.length) return showErr("نوع الملف غير مدعوم: اختر صورة أو فيديو");
      if (other) toast(T("تم تجاهل ملفات غير مدعومة"));
      if (imgs.length) addImages(imgs, inline);
    }
    function pickImages(inline) {
      if (!imagesAllowed()) return toast(T(online() ? "الصور غير متاحة هنا" : "الصور تحتاج اتصالاً بالإنترنت"));
      if (st.type === "video") return showErr("منشور الفيديو لا يجمع معه صوراً: أزل الفيديو أولاً");
      const withVideo = !inline && videoAllowed() && ["post", "video"].includes(st.type) && !st.images.length;
      pick(withVideo ? "image/*,video/*" : "image/*", !inline, (files) => addFiles(files, inline));
    }
    async function addImages(files, inline) {
      await loadLimits(); const big = files.find(f => tooBig(f, "image")); if (big) { showErr(tooBig(big, "image")); files = files.filter(f => !tooBig(f, "image")); }
      const room = inline ? 1 : K.LIMITS.images - st.images.length - uploading;
      if (files.length > room && room > 0) toast(T("الحد الأقصى ١٠ صور"));
      files = files.filter(isImg).slice(0, room);
      if (!files.length) return files.length === 0 && st.images.length >= K.LIMITS.images ? toast(T("الحد الأقصى ١٠ صور")) : null;
      uploading += files.length; renderImages();
      await Promise.all(files.map(async (f) => {
        try { const m = await upload(f); if (inline) txt.setRangeText(`\n![](${m.url})\n`, txt.selectionStart, txt.selectionEnd, "end"); else { st.images.push(m.url); st.alts.push(""); K.setDim(st, m.url, m.width, m.height); } }
        catch (er) { toast(er.message); } finally { uploading--; }
      }));
      renderImages(); changed();
    }
    function renderImages() {
      const box = $c("#c3-images"); if (!box) return;
      box.hidden = !imagesAllowed() && !st.images.length;
      box.innerHTML = st.images.map((u, i) => `<div class="thumb" data-i="${i}"><img src="${esc(u)}" alt="${esc(st.alts[i] || "")}"><button type="button" class="th-alt ${st.alts[i] ? "has" : ""}" data-alt="${i}" aria-label="نص بديل للصورة ${i + 1}">ALT</button><button type="button" class="th-x" data-rm="${i}" aria-label="إزالة الصورة ${i + 1}">${ic("x", "xs")}</button><span class="th-n">${i + 1}</span></div>`).join("")
        + Array.from({ length: uploading }, () => `<div class="thumb up" role="status" aria-label="جارٍ الرفع"><span class="c3-spin"></span></div>`).join("")
        + (st.images.length && st.images.length + uploading < K.LIMITS.images ? `<button type="button" class="thumb add" id="c3-addimg" aria-label="إضافة صور">${ic("plus")}<span>${num(st.images.length)}/${num(K.LIMITS.images)}</span></button>` : "");
      box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { st.images.splice(+b.dataset.rm, 1); st.alts.splice(+b.dataset.rm, 1); renderImages(); changed(); });
      box.querySelectorAll("[data-alt]").forEach(b => b.onclick = () => { const i = +b.dataset.alt; const v = prompt(T("صف الصورة لمن لا يراها (نص بديل)"), st.alts[i] || ""); if (v !== null) { st.alts[i] = v.trim().slice(0, 300); renderImages(); changed(); } });
      $c("#c3-addimg")?.addEventListener("click", () => pickImages(false));
      let drag = null; // pointer-based reorder (touch too)
      box.querySelectorAll(".thumb[data-i]").forEach(t => {
        t.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; drag = { from: +t.dataset.i, el: t, x: e.clientX, y: e.clientY, moved: false }; t.setPointerCapture(e.pointerId); });
        t.addEventListener("pointermove", (e) => { if (!drag || drag.el !== t) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 6) drag.moved = true; t.style.transform = `translate(${dx}px,${dy}px)`; t.classList.add("dragging"); });
        t.addEventListener("pointerup", (e) => {
          if (!drag || drag.el !== t) return; t.style.transform = ""; t.classList.remove("dragging");
          if (drag.moved) { t.style.visibility = "hidden"; const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".thumb[data-i]"); t.style.visibility = ""; if (over && over !== t) { const to = +over.dataset.i; const [u] = st.images.splice(drag.from, 1), [a] = st.alts.splice(drag.from, 1); st.images.splice(to, 0, u); st.alts.splice(to, 0, a); renderImages(); changed(); } }
          drag = null;
        });
      });
    }
    txt.addEventListener("paste", (e) => { const files = [...(e.clipboardData?.files || [])].filter(f => isImg(f) || isVid(f)); if (files.length && imagesAllowed()) { e.preventDefault(); addFiles(files, false); } });
    el.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); el.classList.add("drop"); } });
    el.addEventListener("dragleave", (e) => { if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove("drop"); });
    el.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); el.classList.remove("drop"); if (imagesAllowed()) addFiles([...e.dataTransfer.files], false); else showErr(online() ? "الوسائط غير مسموحة هنا" : "الوسائط تحتاج اتصالاً بالإنترنت"); });

    /* ---------- audio recorder (general → صوت) ---------- */
    function recorder() {
      const go = $c("#rec-go"), t = $c("#rec-t"), meter = $c(".rec-meter"); let mr = null, chunks = [], started = 0, tick = 0;
      $c("#rec-file").onclick = () => pick("audio/*", false, async ([f]) => { if (!f) return; t.textContent = T("جارٍ الرفع…"); uploading++; try { st.audioId = (await upload(f, "audio")).id; t.textContent = f.name; changed(); } catch (er) { t.textContent = er.message; } finally { uploading--; } });
      go.onclick = async () => {
        if (mr?.state === "recording") { mr.stop(); return; }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          const ctxA = new AudioContext(), an = ctxA.createAnalyser(); an.fftSize = 64; ctxA.createMediaStreamSource(stream).connect(an);
          const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg"].find(x => MediaRecorder.isTypeSupported?.(x)) || "";
          mr = new MediaRecorder(stream, type ? { mimeType: type } : {}); chunks = []; mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          mr.onstop = async () => {
            clearInterval(tick); stream.getTracks().forEach(x => x.stop()); ctxA.close(); go.innerHTML = `${ic("mic", "sm")} ${T("إعادة التسجيل")}`; go.classList.remove("rec-on"); meter.innerHTML = "";
            const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" }); t.textContent = T("جارٍ الرفع…"); uploading++;
            try { st.audioId = (await upload(blob, "audio")).id; t.textContent = `${T("تسجيل")} ${fmtDur((Date.now() - started) / 1000)}`; changed(); } catch (er) { t.textContent = er.message; } finally { uploading--; }
          };
          mr.start(1000); started = Date.now(); go.innerHTML = `${ic("x", "sm")} ${T("إيقاف")}`; go.classList.add("rec-on");
          const buf = new Uint8Array(an.frequencyBinCount);
          tick = setInterval(() => { const s = (Date.now() - started) / 1000; t.textContent = fmtDur(s); if (s > 600) mr.stop(); an.getByteFrequencyData(buf); meter.replaceChildren(...[...buf.slice(0, 24)].map(v => { const i = document.createElement("i"); i.style.height = 6 + v / 255 * 34 + "px"; return i; })); }, 120);
        } catch { toast(T("لا يمكن الوصول إلى الميكروفون")); }
      };
    }

    /* ---------- @mentions ---------- */
    txt.addEventListener("input", () => {
      const box = $c("#c3-mention"); if (!box || typeof DB === "undefined") return;
      const m = txt.value.slice(0, txt.selectionStart).match(/@([a-zA-Z0-9_]{1,20})$/);
      const list = m ? DB.users.filter(u => u.id !== DB.me && u.handle && u.handle.startsWith(m[1])).slice(0, 4) : [];
      box.innerHTML = list.length ? `<div class="suggest" role="listbox" aria-label="إشارة">${list.map(u => `<button type="button" role="option" data-mh="${esc(u.handle)}">${esc(u.name)} <bdi class="muted">@${esc(u.handle)}</bdi></button>`).join("")}</div>` : "";
      box.querySelectorAll("[data-mh]").forEach(b => b.onclick = () => { const pos = txt.selectionStart; const before = txt.value.slice(0, pos).replace(/@[a-zA-Z0-9_]*$/, "@" + b.dataset.mh + " "); txt.value = before + txt.value.slice(pos); txt.selectionStart = txt.selectionEnd = before.length; box.innerHTML = ""; txt.focus(); changed(); });
    });

    /* ---------- writing assistant (general): spelling + hashtags ---------- */
    async function assist() {
      const box = $c("#c3-assist"); if (!box || !online()) return;
      if ((st.title + st.markdown).trim().length < 8) { box.innerHTML = ""; return; }
      try {
        const r = await api("POST", "/api/compose/assist", { text: txt.value }); if (closed) return;
        box.innerHTML = (r.spelling.length ? `<div class="as-row"><span class="muted">${ic("check", "xs")} إملاء:</span>${r.spelling.slice(0, 6).map(s => `<button type="button" class="chip fix" data-from="${esc(s.from)}" data-to="${esc(s.to)}"><s>${esc(s.from)}</s> ← ${esc(s.to)}</button>`).join("")}</div>` : "")
          + (r.tags.length ? `<div class="as-row"><span class="muted">${ic("hash", "xs")} وسوم:</span>${r.tags.map(t => `<button type="button" class="chip tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : "");
        box.querySelectorAll(".fix").forEach(b => b.onclick = () => { txt.value = txt.value.split(b.dataset.from).join(b.dataset.to); b.remove(); changed(true); });
        box.querySelectorAll(".tag").forEach(b => b.onclick = () => { txt.value = txt.value.replace(/\s*$/, "") + " #" + b.dataset.tag; b.remove(); changed(true); });
      } catch { }
    }

    /* ---------- drafts: autosave (synced across devices online, local offline) ---------- */
    const saved = $c(".c3-saved");
    const draftable = () => mode !== "edit" && !published;
    async function saveDraft(silent) {
      if (!draftable() || !K.hasContent(st)) return false;
      if (!online()) { if (silent) { const d = K.localDraft(st); Cmd.saveDraft(d); st.legacyId = d.id; } return true; }
      try { const r = await api("PUT", "/api/drafts/" + st.id, { data: K.draftData(st), device, base: st.base }); st.base = r.updatedAt; if (!silent && !closed) saved.innerHTML = `${ic("check", "xs")} ${T("حُفظت المسودة")}`; return true; }
      catch (e) {
        if (e.code === "draft_conflict" || /جهاز آخر/.test(e.message || "")) {
          if (!closed && confirm(T("عُدّلت هذه المسودة من جهاز آخر. تحميل النسخة الأحدث؟"))) { const d = await api("GET", "/api/drafts"); const c2 = d.drafts.find(x => x.id === st.id); if (c2) { close(true); open({ draftId: c2.id, data: { ...c2.data, updatedAt: c2.updatedAt } }); } }
          else st.base = new Date().toISOString();
        } else if (!silent && !closed) saved.textContent = "";
        return false;
      }
    }
    function changed(now) {
      read(); errEl.hidden = true; paintHead();
      if (draftable() && online()) { saved.textContent = "…"; clearTimeout(dT); dT = setTimeout(() => saveDraft(), now ? 200 : 1500); }
      if (mode === "general") { clearTimeout(aT); aT = setTimeout(assist, 1200); if (el.classList.contains("pv") || wide.matches) renderPreview(); }
    }
    [txt, title].forEach(x => x && x.addEventListener("input", () => changed()));
    /* v2.62 T9 «الحارس التلقائي» live check: debounced POST /autoguard/check (masked words only, never a strike). It only
     * warns — the server decides on publish. A 429 pauses checks for a minute; any other failure stays silent. */
    let gT = 0, gSeq = 0, gWait = 0;
    const gOn = mode === "community" && !!G?.enabled && !isMod && !blocked;
    const gBox = $c("#c3-guard");
    const gShow = (words, msg) => { if (!gBox) return; gBox.hidden = false; gBox.innerHTML = `${ic("alert", "xs")} <span class="c3-nt"><b>${esc(msg || "هذا النص يحتوي عبارة ممنوعة في هذا المجتمع ولن يُنشر. عدّله قبل الإرسال.")}</b>${words?.length ? `<small><bdi>${words.map(esc).join("، ")}</bdi></small>` : ""}</span>`; };
    const guardLive = () => {
      clearTimeout(gT); if (!gOn || !online()) return;
      gT = setTimeout(async () => {
        const text = `${title && !title.hidden ? title.value + " " : ""}${txt.value}`.trim();
        if (text.length < 3) { gBox.hidden = true; return; }
        if (Date.now() < gWait) return;
        const my = ++gSeq;
        try { const r = await api("POST", `/api/communities/${encodeURIComponent(st.community)}/autoguard/check`, { text: text.slice(0, 20000), kind: "post" }); if (my !== gSeq || closed) return; if (r.hit) gShow(r.words); else gBox.hidden = true; }
        catch (e) { if (e.status === 429) gWait = Date.now() + 60e3; }
      }, 600);
    };
    [txt, title].forEach(x => x && x.addEventListener("input", guardLive));
    el.addEventListener("click", (e) => { if (e.target.closest("[data-c3close]")) close(false); }); // the appeal link leaves the editor (draft kept)
    txt.addEventListener("input", () => grow(txt));
    ["#c3-top", "#c3-loc", "#c3-sch", "#sens", "#c3-list", "#c3-ch"].forEach(s => $c(s)?.addEventListener("change", () => changed()));
    /* v2.58: the channel (or the community) decides the allowed content types, slow mode and review */
    function applyChannel() {
      if (mode !== "community") return;
      const ch = chans.find(c => c.id === st.channel), list = ch?.allowedTypes?.length ? ch.allowedTypes : (init.contentTypes || []);
      const ok = (t) => !list.length || list.includes(t);
      $$("[data-act]").forEach(b => { b.hidden = !ok(b.dataset.act === "img" ? "image" : b.dataset.act); });
      if (["poll", "question"].includes(st.type) && !ok(st.type)) { st.type = "post"; applyType(); }
      if (st.type === "video" && !ok("video") && !st.video) { st.type = "post"; applyType(); }
      chReview = !!(ch?.requireApproval && !isMod);
      const note = $c("#c3-slow"); clearInterval(slowT); let wait = isMod ? 0 : ch?.waitSec || 0;
      const fmt = (x) => x < 60 ? `${num(x)} ث` : x < 3600 ? `${num(Math.round(x / 60))} د` : `${num(Math.round(x / 3600))} س`;
      /* v2.59: title + rule on their own lines, a mm:ss countdown chip (tabular digits, not re-announced every second) */
      const clock = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`;
      const draw = () => {
        if (!el.isConnected) return clearInterval(slowT); note.hidden = !(ch?.slowModeSec && !isMod);
        if (!note.hidden) { if (!note.firstElementChild) note.innerHTML = `<span class="c3-ni" aria-hidden="true">${ic("clock", "xs")}</span><span class="c3-nt"><b><span>الوضع البطيء في</span> <bdi>«${esc(ch.name)}»</bdi></b><small>منشور واحد كل ${fmt(ch.slowModeSec)}</small></span><span class="c3-wait" aria-hidden="true"></span>`; const w = note.querySelector(".c3-wait"); w.hidden = !(wait > 0); if (wait > 0) w.textContent = clock(wait); pub.title = wait > 0 ? `يمكنك النشر بعد ${clock(wait)}` : ""; }
        else { note.innerHTML = ""; pub.title = ""; }
        slowBlock = wait > 0; paintHead();
      };
      note.innerHTML = "";
      draw(); if (wait > 0) slowT = setInterval(() => { wait--; if (wait <= 0) { clearInterval(slowT); ch.waitSec = 0; } draw(); }, 1000);
    }
    $c("#c3-ch")?.addEventListener("change", () => { read(); applyChannel(); });
    applyChannel();
    $c("#c3-loc")?.addEventListener("input", () => changed());
    $c("#c3-series")?.addEventListener("change", (e) => { st.series = e.target.value === "new" ? K.rid("sr") : e.target.value; changed(); });

    /* ---------- drafts & templates pickers, best time (general) ---------- */
    $c("#c3-drafts")?.addEventListener("click", async () => {
      let drafts = []; try { ({ drafts } = await api("GET", "/api/drafts")); } catch (e) { return toast(e.message); }
      sheet(`<h4 class="u-mt0">${ic("bookmark", "sm")} المسودات <span class="muted">(${num(drafts.length)})</span></h4><p class="u-mt0 muted">تُحفظ تلقائياً وتظهر على كل أجهزتك.</p>${drafts.map(d => `<div class="row dr-row"><button type="button" class="grow dr-open" data-dr="${esc(d.id)}"><b>${esc(d.data.title || (d.data.markdown || "").slice(0, 60) || "مسودة فارغة")}</b><span class="muted">${esc(TYPES[d.data.type]?.[0] || "منشور")}${d.data.x?.community ? " · " + esc(S.community(d.data.x.community)?.name || "مجتمع") : ""} · ${relTime(d.updatedAt)}</span></button><button type="button" class="btn ghost" data-drx="${esc(d.id)}" aria-label="حذف المسودة">${ic("x", "xs")}</button></div>`).join("") || '<div class="empty">لا مسودات</div>'}`);
      document.querySelectorAll("#sheet [data-dr]").forEach(b => b.onclick = () => { const d = drafts.find(x => x.id === b.dataset.dr); closeSheet(); close(true); open({ draftId: d.id, type: d.data.type, data: { ...d.data, updatedAt: d.updatedAt } }); });
      document.querySelectorAll("#sheet [data-drx]").forEach(b => b.onclick = async () => { await api("DELETE", "/api/drafts/" + b.dataset.drx).catch(() => { }); b.closest(".dr-row").remove(); });
    });
    $c("#c3-tpl")?.addEventListener("click", async () => {
      let templates = []; try { ({ templates } = await api("GET", "/api/templates")); } catch (e) { return toast(e.message); }
      sheet(`<h4 class="u-mt0">${ic("copy", "sm")} القوالب</h4>${templates.map(t => `<div class="row dr-row"><button type="button" class="grow dr-open" data-tp="${esc(t.id)}"><b>${esc(t.name)}</b><span class="muted">${esc((t.data.markdown || "").slice(0, 60))} · استُخدم ${num(t.uses)} مرة</span></button><button type="button" class="btn ghost" data-tpx="${esc(t.id)}" aria-label="حذف القالب">${ic("x", "xs")}</button></div>`).join("") || '<div class="empty">احفظ منشوراً كقالب من «خيارات النشر» لتعيد استخدامه.</div>'}`);
      document.querySelectorAll("#sheet [data-tp]").forEach(b => b.onclick = async () => { const { template } = await api("POST", `/api/templates/${b.dataset.tp}/use`); closeSheet(); st.type = K.typeOf(template.data.type, "general"); txt.value = template.data.markdown || ""; title.value = template.data.title || ""; st.template = b.dataset.tp; applyType(); changed(); txt.focus(); });
      document.querySelectorAll("#sheet [data-tpx]").forEach(b => b.onclick = async () => { await api("DELETE", "/api/templates/" + b.dataset.tpx).catch(() => { }); b.closest(".dr-row").remove(); });
    });
    $c("#c3-save-tpl")?.addEventListener("click", async () => { read(); const name = prompt(T("اسم القالب"), st.title || T("قالب جديد")); if (!name) return; try { await api("POST", "/api/templates", { name, data: { type: st.type, title: st.title, markdown: st.markdown, visibility: st.visibility } }); toast(T("حُفظ القالب")); } catch (e) { toast(e.message); } });
    $c("#c3-best")?.addEventListener("click", async () => {
      try {
        const r = await api("GET", "/api/studio/best-time?tz=" + (-new Date().getTimezoneOffset())); const slot = r.best[0] || r.fallback[0]; const d = new Date();
        d.setDate(d.getDate() + ((slot.day - d.getDay() + 7) % 7 || (slot.hour <= d.getHours() ? 7 : 0))); d.setHours(slot.hour, 0, 0, 0);
        $c("#c3-sch").value = new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); changed(); toast(`${T(r.enough ? "جمهورك أنشط" : "وقت مقترح")}: ${T(DAYS[slot.day])} ${slot.hour}:00`);
      } catch (e) { toast(e.message); }
    });

    /* ---------- extensions (paid «الوصول», minors labels, …) ---------- */
    const active = (h) => !h.modes || h.modes.includes(mode);
    const hx = { el, mode, state: st, get type() { return st.type; }, online: online(), slot: (n) => el.querySelector(`[data-slot="${n}"]`), openOptions: () => { const o = $c("#c3-opts"); if (o) o.open = true; }, text: () => txt.value };
    hooks().forEach(h => { if (active(h)) try { h.mount?.(hx); } catch (e) { console.warn("composer hook", h.id, e); } });

    /* ---------- publish ---------- */
    async function publish() {
      read();
      if (uploading) return showErr("انتظر حتى يكتمل الرفع");
      const bad = K.validate(st, { online: online(), now: new Date() }); if (bad) return showErr(bad.msg, bad.field);
      if (mode === "edit") { Cmd.editPost(st.editOf, st.markdown.trim()); published = true; close(true); toast(T("تم التعديل")); if (typeof patchPost === "function") try { patchPost(st.editOf); } catch { rerender(); } else rerender(); return; }
      for (const h of hooks()) { if (!active(h) || !h.check) continue; const m = h.check(hx); if (m) return showErr(m); }
      if (!online()) {
        const r = Cmd.createPost(K.toLocal(st)); if (r.error) return showErr(r.error);
        if (st.legacyId && typeof DB !== "undefined") { DB.drafts = DB.drafts.filter(x => x.id !== st.legacyId); save(); }
        published = true; close(true); toast(T(r.post.status === "pending" ? "أُرسل لمراجعة مشرفي المجتمع" : r.post.status === "scheduled" ? "جُدول المنشور" : "تم النشر"));
        if (location.hash !== "#/home" && mode === "general") location.hash = "#/home"; else rerender(); return;
      }
      const p = K.plan(st, { now: new Date(), seriesParts: st.series && typeof DB !== "undefined" ? DB.posts.filter(x => x.series === st.series).length : 0 });
      hooks().forEach(h => { if (active(h)) try { h.apply?.(p.posts[0], hx); } catch { } });
      pub.disabled = true; pub.setAttribute("aria-busy", "true"); const label = pub.textContent; pub.textContent = "…";
      let first = null, done = 0;
      try {
        if (p.event) { const { event } = await api("POST", "/api/events", p.event); p.posts[0].event = event.id; }
        for (const body of p.posts) { const r = await api("POST", "/api/posts", body); first ||= r.post; done++; }
      } catch (e) {
        pub.disabled = false; pub.removeAttribute("aria-busy"); pub.textContent = label;
        if (done) { published = true; close(true); toast(e.message); return after(first); }
        if (e.code === "autoguard" || e.code === "muted") { // v2.62 T9: rejected by the guard — nothing was published, the text stays here and in drafts
          gShow(null, "نصّك محفوظ هنا وفي المسودات. عدّل العبارة الممنوعة ثم أرسل."); saveDraft(true); document.dispatchEvent(new CustomEvent("mp:autoguard", { detail: { community: st.community } }));
          if (e.code === "muted" || /موقوف|لا يمكنك الكتابة/.test(e.message || "")) pub.disabled = true;
        }
        return showErr(e.message || "تعذّر النشر");
      }
      published = true; clearTimeout(dT);
      api("DELETE", "/api/drafts/" + st.id).catch(() => { });
      close(true);
      const s = first?.status;
      toast(T(s === "pending" ? "أُرسل لمراجعة مشرفي المجتمع" : s === "scheduled" ? "جُدول المنشور" : s === "processing" ? "يُجهَّز الآن وسيُنشر خلال لحظات" : st.type === "story" ? "نُشرت قصتك" : st.type === "thread" ? "نُشرت السلسلة" : s === "held" ? "قيد مراجعة سريعة" : "تم النشر"));
      after(first);
    }
    async function after(first) {
      document.dispatchEvent(new CustomEvent("mp:post-created", { detail: { post: first, mode, type: st.type, community: st.community } }));
      const firstEver = typeof DB !== "undefined" && !DB.posts.some(p => p.author === DB.me && p.id !== first?.id);
      if (typeof refresh === "function") await refresh().catch(() => { });
      if (mode === "community" && /^#\/c\//.test(location.hash) && typeof route === "function") route();
      if (window.MPCelebrate && firstEver) MPCelebrate("أول منشور لك");
      if (st.type === "story") location.hash = "#/home";
    }
    pub.onclick = publish;

    /* ---------- close ---------- */
    function close(silent) {
      if (closed) return; closed = true; clearTimeout(dT); clearTimeout(aT);
      if (!silent && draftable() && K.hasContent(st)) { read(); saveDraft(true).then(ok => { if (ok) toast(T("حُفظت كمسودة")); }); }
      el.remove(); document.body.classList.remove("composing");
      if (vv) { visualViewport.removeEventListener("resize", vv); visualViewport.removeEventListener("scroll", vv); }
      wide.removeEventListener?.("change", onWide);
      if (cur && cur.el === el) cur = null;
    }
    $c("#c3-x").onclick = () => close(false);
    $c("#c3-rh-t")?.addEventListener("click", (e) => { const on = e.currentTarget.getAttribute("aria-expanded") !== "true"; e.currentTarget.setAttribute("aria-expanded", on); $c("#c3-rh-l").hidden = $c("#c3-rh-all").hidden = !on; try { if (on) localStorage.removeItem("mp_rh_" + st.community); else localStorage.setItem("mp_rh_" + st.community, "0"); } catch { /* private mode */ } });
    $c("#c3-rh-all")?.addEventListener("click", () => close(false)); // the draft is kept, then the link opens the rules (about tab)
    el.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); publish(); return; }
      if ((e.ctrlKey || e.metaKey) && ["b", "i"].includes(e.key) && e.target === txt && mode === "general") { e.preventDefault(); bar.querySelector(`[data-tool="${e.key}"]`)?.click(); return; }
      if (e.key === "Escape" && !e.defaultPrevented && document.getElementById("sheet")?.classList.contains("hidden") !== false) {
        if ($c(".suggest")) { $c("#c3-mention").innerHTML = ""; e.preventDefault(); return; }
        e.preventDefault(); close(false);
      }
    });
    const onWide = () => { if (wide.matches) renderPreview(); };
    wide.addEventListener?.("change", onWide);

    cur = { el, st, close, mountHook: (h) => { if (!active(h) || closed) return; try { h.mount?.(hx); h.onType?.(st.type, hx); } catch (e) { console.warn("composer hook", h.id, e); } } };
    applyType(); renderImages(); paintHead(); grow(txt); if (wide.matches) renderPreview();
    if (st.markdown && mode === "general") { clearTimeout(aT); aT = setTimeout(assist, 600); }
    if (!online() && mode === "general") saved.textContent = T("غير متصل: يُنشر عند عودة الاتصال");
    setTimeout(() => { if (closed) return; const f = !title.hidden && !title.value ? title : st.type === "event" && !st.event.name ? $c("#c3-evn") : txt; (f || txt).focus(); if (f === txt) txt.selectionStart = txt.selectionEnd = txt.value.length; }, 60);
    return cur;
  }

  window.MPEditor = { open, close: () => cur?.close(false), get current() { return cur; } };
})();
