/* =====================================================================
 * مجتمع بلس — composer core (v2.50). Lazy chunk `composercore`, loaded right before `composer` (composer-ui.js).
 * One source of truth for BOTH editors (docs/COMPOSER.md):
 *   • mode "community" — the simple editor opened inside a community (text, images or one video, poll or question; community fixed)
 *   • mode "general"   — the creative editor (every post type, rich text, audience, topic, place, schedule, series, …)
 *   • mode "edit"      — editing the text of one's own post (uses the simple layout)
 * Pure logic, no DOM: init normalisation (every legacy entry shape), validation, request plans for POST /api/posts
 * (+ /api/events for events, a numbered series for threads), offline local posts, and the synced-draft payload.
 * Unit-tested in tests/unit/composer-core.test.js.
 * ===================================================================== */
(function (root) {
  const LIMITS = { text: 5000, article: 60000, title: 200, pollOption: 100, pollMax: 6, images: 10, parts: 10, stances: 5, location: 80 };
  const GENERAL_TYPES = ["post", "article", "poll", "question", "discussion", "thread", "event", "video", "audio", "story"];
  const COMMUNITY_TYPES = ["post", "poll", "question", "video"]; // v2.60 M1: a video (short or long) from inside a community
  const VIS = ["public", "followers", "close", "list", "private"];
  const POLL_HOURS = [1, 24, 72, 168];
  const ONLINE_ONLY = ["video", "audio", "story"];
  const ALIAS = { image: "post", images: "post", share: "post", short: "video" };
  const ID_RE = /^[a-z]{1,3}_[a-z0-9]{6,24}$/i;

  const rand = () => {
    const c = root.crypto && root.crypto.getRandomValues ? root.crypto.getRandomValues(new Uint8Array(10)) : Array.from({ length: 10 }, () => Math.floor(Math.random() * 256));
    return Array.from(c, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  };
  const rid = (p) => p + "_" + rand();
  const s = (v, max) => String(v == null ? "" : v).slice(0, max);
  const arr = (v) => (Array.isArray(v) ? v : []);

  function typeOf(t, mode) {
    const k = ALIAS[t] || t;
    const list = mode === "community" ? COMMUNITY_TYPES : GENERAL_TYPES;
    return list.includes(k) ? k : "post";
  }

  /** which editor an entry point gets: explicit mode → edit → community (simple types only) → general */
  function resolveMode(init = {}) {
    if (init.mode === "general" || init.mode === "community" || init.mode === "edit") return init.mode === "community" && !communityOf(init) ? "general" : init.mode;
    if (init.edit) return "edit";
    const c = communityOf(init);
    const t = ALIAS[init.type || (init.data && init.data.type)] || init.type || (init.data && init.data.type);
    if (c && !init.quoteOf && (!t || COMMUNITY_TYPES.includes(t))) return "community";
    return "general";
  }
  function communityOf(init) { return init.community || (init.data && init.data.x && init.data.x.community) || null; }

  /** every entry shape → one editor state.
   *  Shapes: {} · {type,text,topic} · {community,channel,channels,tags,role} · {quoteOf} · {edit,text}
   *  · {draftId,type,data:{…synced draft, x:{…}}} · {data:{markdown,images,alts}} (share target) · legacy local draft {id:"d_…",text,title,…} */
  function normalize(init = {}, opts = {}) {
    const mode = resolveMode(init);
    const d = init.data || {}, x = d.x || {};
    const legacy = !init.data && init.id && /^d_/.test(init.id) ? init : null;
    const st = {
      id: init.draftId && /^dr_/.test(init.draftId) ? init.draftId : rid("dr"),
      legacyId: legacy ? legacy.id : null,
      mode,
      type: typeOf(init.type || d.type || (legacy && legacy.type) || "post", mode === "edit" ? "community" : mode),
      title: s(d.title != null ? d.title : init.title, LIMITS.title),
      markdown: String(d.markdown != null ? d.markdown : init.text != null ? init.text : ""),
      images: arr(d.images).filter((u) => typeof u === "string").slice(0, LIMITS.images),
      alts: [],
      visibility: VIS.includes(d.visibility || init.visibility) ? (d.visibility || init.visibility) : "public",
      list: x.list || init.list || "",
      publishAt: s(d.publishAt || init.publishAt || "", 40),
      series: d.series && ID_RE.test(d.series) ? d.series : "",
      topic: x.topic || init.topic || "",
      location: s(x.location || init.location || "", LIMITS.location),
      sensitive: !!(x.sensitive || init.sensitive),
      poll: normPoll(x.poll || (legacy && legacy.pollOpts ? { options: legacy.pollOpts } : null)),
      stances: arr(x.stances).length ? arr(x.stances).map((t) => s(t, 60)).slice(0, LIMITS.stances) : ["مع", "ضد", "محايد"],
      parts: arr(x.parts).length ? arr(x.parts).map((t) => s(t, LIMITS.text)).slice(0, LIMITS.parts) : [""],
      event: { name: s(x.event && x.event.name, 100), startsAt: s(x.event && x.event.startsAt, 40), place: s(x.event && x.event.place, 100) },
      video: null, audioId: null, story: null,
      community: mode === "community" || mode === "general" ? communityOf(init) || (legacy && legacy.community) || null : null,
      channel: init.channel || x.channel || "",
      ctag: init.ctag || x.ctag || "",
      quoteOf: init.quoteOf || x.quoteOf || null,
      template: init.template && ID_RE.test(init.template) ? init.template : null,
      editOf: mode === "edit" ? init.edit : null,
      base: d.updatedAt || null
    };
    st.alts = st.images.map((_, i) => s(arr(d.alts)[i] || "", 300));
    /* media M2: real size of each uploaded image, keyed by url (survives remove / reorder); sent as imageDims[] aligned with images[] */
    st.dims = {}; const xd = x.dims && typeof x.dims === "object" ? x.dims : {};
    st.images.forEach((u) => { const v = normDim(xd[u]); if (v) st.dims[u] = v; });
    if (st.quoteOf) st.type = "post";
    if (mode === "edit") { st.type = "post"; st.markdown = String(init.text != null ? init.text : ""); }
    if (opts.now && st.publishAt && new Date(st.publishAt) <= opts.now) st.publishAt = "";
    return st;
  }
  /** [w, h] of an image (array or {w,h} / {width,height}) → two positive integers, or null */
  function normDim(v) {
    if (!v) return null;
    const w = Math.round(+(Array.isArray(v) ? v[0] : v.w || v.width)), h = Math.round(+(Array.isArray(v) ? v[1] : v.h || v.height));
    return w > 0 && h > 0 && w <= 30000 && h <= 30000 ? [w, h] : null;
  }
  /** remember the real size of an uploaded image (POST /api/media returns media.width/height since media M2) */
  function setDim(st, url, w, h) { const v = normDim([w, h]); if (!st.dims) st.dims = {}; if (v && typeof url === "string") st.dims[url] = v; return !!v; }
  /** imageDims[] aligned with st.images (null where unknown), or null when no size is known at all */
  function dimsOf(st) { const dm = st.images.map((u) => (st.dims && st.dims[u]) || null); return dm.some(Boolean) ? dm : null; }
  function normPoll(p) {
    const o = { options: ["", ""], multi: false, hideResults: false, hours: 24 };
    if (!p) return o;
    const opts = arr(p.options).map((t) => s(typeof t === "string" ? t : t && t.t, LIMITS.pollOption)).slice(0, LIMITS.pollMax);
    while (opts.length < 2) opts.push("");
    return { options: opts, multi: !!p.multi, hideResults: !!p.hideResults, hours: POLL_HOURS.includes(+p.hours) ? +p.hours : 24 };
  }

  const limitOf = (st) => (st.type === "article" ? LIMITS.article : LIMITS.text);
  const counter = (st) => { const n = st.markdown.length, lim = limitOf(st); return { n, lim, over: n > lim, left: lim - n }; };
  const filled = (a) => a.map((t) => String(t || "").trim()).filter(Boolean);

  function hasContent(st) {
    return !!(st.markdown.trim() || st.title.trim() || st.images.length || st.audioId || st.story || st.video || filled(st.poll.options).length || filled(st.parts).length || st.event.name.trim());
  }

  /** first problem with the state, or null. ctx: { online, now: Date } */
  function validate(st, ctx = {}) {
    const now = ctx.now || new Date();
    const text = st.markdown.trim(), title = st.title.trim();
    if (st.mode === "edit") return text ? (text.length > LIMITS.text ? { field: "text", msg: "النص أطول من المسموح" } : null) : { field: "text", msg: "اكتب شيئاً أولاً" };
    if (st.markdown.length > limitOf(st)) return { field: "text", msg: "النص أطول من المسموح" };
    if (!ctx.online && (ONLINE_ONLY.includes(st.type) || st.images.length)) return { field: "type", msg: "هذا النوع يحتاج اتصالاً بالإنترنت" };
    if (st.publishAt && new Date(st.publishAt) <= now) return { field: "publishAt", msg: "اختر موعداً قادماً للجدولة" };
    if (st.visibility === "list" && !st.list) return { field: "list", msg: "اختر القائمة" };
    switch (st.type) {
      case "post": if (!text && !st.images.length && !st.quoteOf) return { field: "text", msg: "اكتب شيئاً أولاً" }; break;
      case "article": if (!title) return { field: "title", msg: "المقال يحتاج عنواناً" }; if (!text) return { field: "text", msg: "اكتب محتوى المقال" }; break;
      case "poll": {
        if (!text) return { field: "text", msg: "اكتب سؤال الاستطلاع" };
        const o = filled(st.poll.options);
        if (o.length < 2) return { field: "poll", msg: "أضف خيارين على الأقل" };
        if (new Set(o).size !== o.length) return { field: "poll", msg: "الخيارات مكررة" };
        break;
      }
      case "question": if (title.length < 5) return { field: "title", msg: "اكتب سؤالاً واضحاً (٥ أحرف على الأقل)" }; break;
      case "discussion": if (!title) return { field: "title", msg: "أضف عنواناً للنقاش" }; if (filled(st.stances).length < 2) return { field: "stances", msg: "أضف موقفين على الأقل" }; break;
      case "thread": if (!text) return { field: "text", msg: "اكتب الجزء الأول" }; if (!filled(st.parts).length) return { field: "parts", msg: "أضف جزءاً ثانياً للسلسلة" }; break;
      case "event": {
        if (!st.event.name.trim()) return { field: "event", msg: "أدخل اسم الحدث" };
        const at = new Date(st.event.startsAt);
        if (!st.event.startsAt || isNaN(at) || at <= now) return { field: "event", msg: "اختر موعداً قادماً للحدث" };
        break;
      }
      case "video": if (!st.video || !st.video.mediaId) return { field: "video", msg: "اختر فيديو أولاً" }; break;
      case "audio": if (!st.audioId) return { field: "audio", msg: "سجّل مقطعاً أو اختر ملفاً" }; break;
      case "story": if (!st.story && !text) return { field: "story", msg: "أضف صورة أو نصاً" }; break;
    }
    return null;
  }

  const iso = (v) => (v ? new Date(v).toISOString() : undefined);

  /** request plan for an online publish: { event?: body for POST /api/events, posts: [bodies for POST /api/posts, in order] }
   *  ctx: { now, seriesParts (existing parts of st.series), newId } */
  function plan(st, ctx = {}) {
    const now = ctx.now || new Date(), id = ctx.newId || rid;
    const text = st.markdown.trim();
    const base = { id: id("p"), type: st.type, visibility: st.visibility };
    if (st.visibility === "list") base.list = st.list;
    if (st.mode === "general") {
      if (st.topic) base.topic = st.topic;
      if (st.location.trim()) base.location = st.location.trim();
      if (st.publishAt) base.publishAt = iso(st.publishAt);
      if (st.sensitive) base.sensitive = true;
      if (st.template) base.template = st.template;
    }
    if (st.community) { base.community = st.community; if (st.channel) base.channel = st.channel; if (st.ctag) base.ctag = st.ctag; }
    if (st.quoteOf) base.quoteOf = st.quoteOf;
    const out = { posts: [] }, imgs = () => (st.images.length ? { images: st.images.slice(), alts: st.alts.slice(0, st.images.length), ...(dimsOf(st) ? { imageDims: dimsOf(st) } : {}) } : {});
    switch (st.type) {
      case "post": out.posts.push({ ...base, markdown: st.markdown, ...imgs() }); break;
      case "article": {
        const b = { ...base, title: st.title.trim(), markdown: st.markdown, ...imgs() };
        if (st.images[0]) b.cover = st.images[0];
        if (st.series) { const n = (ctx.seriesParts || 0) + 1; Object.assign(b, { series: st.series, part: n, parts: n }); }
        out.posts.push(b); break;
      }
      case "poll": {
        const endsAt = new Date(now.getTime() + st.poll.hours * 3600e3).toISOString();
        out.posts.push({ ...base, text, ...imgs(), poll: { options: filled(st.poll.options), multi: st.poll.multi, hideResults: st.poll.hideResults, endsAt } }); break;
      }
      case "question": out.posts.push({ ...base, title: st.title.trim(), text: text || st.title.trim(), ...imgs() }); break;
      case "discussion": out.posts.push({ ...base, title: st.title.trim(), text, stances: filled(st.stances) }); break;
      case "thread": {
        const parts = [text, ...filled(st.parts)], sid = id("s");
        parts.forEach((t, i) => out.posts.push({ ...base, id: i ? id("p") : base.id, type: "post", markdown: t, ...(i ? {} : imgs()), series: sid, part: i + 1, parts: parts.length }));
        break;
      }
      case "event": {
        const eid = id("e");
        out.event = { id: eid, name: st.event.name.trim(), desc: text, startsAt: iso(st.event.startsAt), place: st.event.place.trim() || "أونلاين", ...(st.community ? { community: st.community } : {}) };
        out.posts.push({ ...base, text: text || st.event.name.trim(), event: eid }); break;
      }
      case "video": out.posts.push({ ...base, text, short: !!st.video.short, video: { mediaId: st.video.mediaId, short: !!st.video.short, source: "post" } }); break;
      case "audio": out.posts.push({ ...base, text, audio: { mediaId: st.audioId } }); break;
      case "story": {
        const sv = st.story || {};
        const b = { ...base, text, media: sv.kind === "image" ? sv.url : sv.bg || "linear-gradient(135deg,#5b2bd6,#e0559b)" };
        if (sv.kind === "video") b.video = { mediaId: sv.id };
        delete b.publishAt; out.posts.push(b); break;
      }
    }
    return out;
  }

  /** offline publish through the local store (Cmd.createPost → diff sync later). Text-only types. */
  function toLocal(st, ctx = {}) {
    const now = ctx.now || new Date(), text = st.markdown.trim();
    const d = { type: st.type === "thread" ? "post" : st.type, text, visibility: st.visibility, list: st.visibility === "list" ? st.list : null, topic: st.topic || null, community: st.community || null, quoteOf: st.quoteOf || null };
    if (st.mode === "general") Object.assign(d, { location: st.location.trim() || null, publishAt: st.publishAt ? iso(st.publishAt) : null, sensitive: !!st.sensitive });
    if (st.type === "article") { d.title = st.title.trim(); d.media = "linear-gradient(135deg,#667eea,#764ba2)"; }
    if (st.type === "question") { d.title = st.title.trim(); d.text = text || d.title; d.acceptedAnswer = null; }
    if (st.type === "discussion") { d.title = st.title.trim(); d.stances = filled(st.stances).map((t) => ({ t, v: 0 })); d.stanceVoters = {}; }
    if (st.type === "poll") d.poll = { options: filled(st.poll.options).map((t) => ({ t, v: 0 })), voters: {}, multi: st.poll.multi, hideResults: st.poll.hideResults, endsAt: new Date(now.getTime() + st.poll.hours * 3600e3).toISOString() };
    if (st.type === "thread") d.threadParts = filled(st.parts);
    if (st.type === "event") { d.eventData = { name: st.event.name.trim(), desc: text, startsAt: iso(st.event.startsAt), place: st.event.place.trim() || "أونلاين" }; d.text = text || d.eventData.name; }
    return d;
  }

  /** payload for PUT /api/drafts/:id — the classic fields plus `x` (mode, community, poll, …) so a resumed draft
   *  reopens in the same editor with everything in place */
  function draftData(st) {
    const x = { mode: st.mode };
    if (st.community) { x.community = st.community; if (st.channel) x.channel = st.channel; if (st.ctag) x.ctag = st.ctag; }
    if (st.topic) x.topic = st.topic;
    if (st.location) x.location = st.location;
    if (st.sensitive) x.sensitive = true;
    if (st.visibility === "list" && st.list) x.list = st.list;
    if (st.type === "poll") x.poll = { options: st.poll.options.slice(), multi: st.poll.multi, hideResults: st.poll.hideResults, hours: st.poll.hours };
    if (st.type === "discussion") x.stances = st.stances.slice();
    if (st.type === "thread") x.parts = st.parts.slice();
    if (st.type === "event") x.event = { ...st.event };
    if (st.quoteOf) x.quoteOf = st.quoteOf;
    if (dimsOf(st)) x.dims = Object.fromEntries(st.images.filter((u) => st.dims[u]).map((u) => [u, st.dims[u]]));
    return { type: st.type, title: st.title, markdown: st.markdown, images: st.images.slice(), alts: st.alts.slice(), visibility: st.visibility, publishAt: st.publishAt, series: st.series, x };
  }

  /** local (offline) draft in the legacy DB.drafts shape */
  const localDraft = (st) => ({ id: st.legacyId || undefined, type: st.type, text: st.markdown, title: st.title, visibility: st.visibility, topic: st.topic, community: st.community || "", pollOpts: st.poll.options.slice() });

  root.MPComposerCore = { LIMITS, GENERAL_TYPES, COMMUNITY_TYPES, VIS, POLL_HOURS, ONLINE_ONLY, rid, typeOf, resolveMode, normalize, normPoll, counter, limitOf, hasContent, validate, plan, toLocal, draftData, localDraft, normDim, setDim, dimsOf };
})(typeof window !== "undefined" ? window : globalThis);
