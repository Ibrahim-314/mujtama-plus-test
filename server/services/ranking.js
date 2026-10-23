/* Ranking service (Phase 21) — a separate service behind /api/feed with its own cache.
 * • Candidates per mode: for · discover · following · communities · latest · chrono · list:<id> · topic:<slug> · tag:<tag>.
 * • Scoring learns from MEANINGFUL engagement (comments, replies, saves, shares, long reads), never from
 *   raw clicks or views: a click weighs 0.2, a comment 3. Per-viewer affinity to authors/topics decays
 *   with a 14-day half-life.
 * • Explicit control: «أكثر من هذا / أقل من هذا» feedback per author/topic/tag/community/post.
 * • Diversity caps: ≤ 2 posts per author and ≤ 3 per topic in any window of 10, never the same author
 *   back-to-back.
 * • «لماذا أرى هذا»: every factor that contributed, with its weight and an undo-able control.
 * • Chronological feed is a permanent option (feed_prefs.chrono) and a tab of its own.
 * • Customisable/reorderable tabs and the «وصلت لآخر الجديد» marker (seen_at) live in feed_prefs. */
const { E, str, now } = require("../lib/core");
const PAGE = 20, TTL = 60e3;
const SIGNAL_W = { comment: 3, reply: 3, save: 2.5, quote: 2.5, share: 2, dwell: 1.5, react: 1, vote: 1, click: 0.2 };
const HALF_LIFE_MS = 14 * 864e5;
const DEFAULT_TABS = [{ id: "for", label: "لك" }, { id: "following", label: "أتابع" }, { id: "chrono", label: "زمني" }, { id: "latest", label: "الأحدث" }, { id: "discover", label: "استكشف" }, { id: "communities", label: "مجتمعاتي" }];
const TAB_ID = /^(for|following|latest|chrono|discover|communities|(list|topic|tag):[\p{L}\p{N}_-]{1,60})$/u;
const FEEDBACK_KINDS = ["author", "topic", "tag", "community", "post"];

/* ---------- pure model (unit-tested) ---------- */
/** post-level quality from meaningful engagement only; views and clicks are ignored on purpose */
function meaningful(st = {}) {
  const v = (st.uniqueCommenters || 0) * 3 + (st.comments || 0) + (st.saves || 0) * 2.5 + (st.shares || 0) * 2 + (st.dwells || 0) * 1.5 + (st.reactions || 0) * 0.6;
  return Math.log2(1 + v);
}
/** viewer affinity map from their own signals: key → decayed weight (log-scaled) */
function affinity(signals, at = Date.now()) {
  const raw = { author: {}, topic: {} };
  for (const s of signals) {
    const w = (SIGNAL_W[s.kind] ?? 0) * Math.pow(0.5, (at - new Date(s.at).getTime()) / HALF_LIFE_MS);
    if (s.author) raw.author[s.author] = (raw.author[s.author] || 0) + w;
    if (s.topic) raw.topic[s.topic] = (raw.topic[s.topic] || 0) + w;
  }
  const out = { author: {}, topic: {} };
  for (const k of ["author", "topic"]) for (const [x, w] of Object.entries(raw[k])) out[k][x] = Math.log2(1 + w);
  return out;
}
/**
 * @param {any} p post row  @param {any} c context { following:Set, comms:Set, interests:[], followTopics:Set, followTags:Set,
 *   tagsOf:{}, stats:{}, aff:{author,topic}, fb:{}, followerCounts:{}, muted:{}, settings:{} , names:{} }
 * @returns {{ score: number, factors: {code:string,label:string,w:number,control?:any}[] }}
 */
function scorePost(p, c, at = Date.now()) {
  const f = [];
  const add = (code, label, w, control) => { if (w) f.push({ code, label, w: Math.round(w * 100) / 100, ...(control ? { control } : {}) }); };
  const ageH = Math.max(0, (at - new Date(p.created_at).getTime()) / 3600e3);
  const tags = (c.tagsOf && c.tagsOf[p.id]) || [];
  const name = (c.names && c.names[p.author]) || "هذا الحساب";
  if (c.following?.has(p.author)) add("following", `من ${name} الذي تتابعه`, 4);
  if (p.community && c.comms?.has(p.community)) add("community", "من مجتمع أنت عضو فيه", 2.5, { kind: "community", target: p.community });
  if (p.topic && (c.interests || []).includes(p.topic)) add("interest", "يطابق اهتماماتك", 3);
  if (p.topic && c.followTopics?.has(p.topic)) add("follow_topic", "من موضوع تتابعه", 2.5, { kind: "topic", target: p.topic });
  const ft = tags.find(t => c.followTags?.has(t)); if (ft) add("follow_tag", `يحمل الوسم #${ft} الذي تتابعه`, 2.5, { kind: "tag", target: ft });
  const aa = Math.min(3, (c.aff?.author?.[p.author] || 0)); if (aa >= 0.5) add("affinity_author", `تتفاعل بعمق مع ${name} (تعليقات وحفظ)`, aa, { kind: "author", target: p.author });
  const at2 = Math.min(2, (c.aff?.topic?.[p.topic] || 0) * 0.7); if (at2 >= 0.4) add("affinity_topic", "تتفاعل كثيراً مع هذا الموضوع", at2, { kind: "topic", target: p.topic });
  const fb = c.fb || {};
  if (fb["post:" + p.id] < 0) add("less_post", "طلبت رؤية أقل من هذا المنشور", -100);
  for (const [k, tgt, lbl] of [["author", p.author, "الحساب"], ["topic", p.topic, "الموضوع"], ["community", p.community, "المجتمع"], ...tags.map(t => ["tag", t, "الوسم"])]) {
    const w = tgt && fb[k + ":" + tgt]; if (w) add(w > 0 ? "more_" + k : "less_" + k, w > 0 ? `طلبت المزيد من هذا ${lbl}` : `طلبت أقل من هذا ${lbl}`, w * 2.5, { kind: k, target: tgt });
  }
  add("recency", ageH < 3 ? "منشور حديث" : "حداثة النشر", 6 / (1 + ageH / 6));
  const m = meaningful(c.stats?.[p.id]); if (m) add("engagement", "نقاش وتفاعل هادف حوله", m);
  if (["article", "discussion"].includes(p.type) || p.quote_of) add("depth", "محتوى معمّق", 0.5);
  const st = c.stats?.[p.id] || {};
  if ((c.followerCounts?.[p.author] || 0) < 3 && ageH < 48 && (st.reactions || 0) + (st.comments || 0) >= 2) add("new_creator", "منشئ جديد يحصل على تفاعل جيد", 1.5);
  if (p.moderation === "reported") add("reported", "عليه بلاغات قيد المراجعة", -3);
  const mu = c.muted || {};
  if ((mu.users || []).includes(p.author) || (mu.topics || []).includes(p.topic) || (mu.posts || []).includes(p.id) || (p.community && (mu.communities || []).includes(p.community)) || tags.some(t => (mu.hashtags || []).includes(t))) add("muted", "مكتوم", -100);
  const s = c.settings || {};
  if (s.languages && p.lang && !s.languages.includes(p.lang)) add("lang", "لغة لا تتابعها", -100);
  if (s.contentTypes && s.contentTypes[p.type] === false) add("type", "نوع محتوى أخفيته", -100);
  return { score: f.reduce((a, x) => a + x.w, 0), factors: f };
}
/** diversity caps: authorCap per author and topicCap per topic inside any sliding window; no back-to-back author */
function diversify(list, { window = 10, authorCap = 2, topicCap = 3 } = {}) {
  const out = [], rest = [...list];
  while (rest.length) {
    const recent = out.slice(-(window - 1)), last = out[out.length - 1];
    const notBack = (p) => !last || p.author !== last.author;
    const authorOk = (p) => notBack(p) && recent.filter(x => x.author === p.author).length < authorCap;
    const allOk = (p) => authorOk(p) && (!p.topic || recent.filter(x => x.topic === p.topic).length < topicCap);
    // relax progressively when the pool runs out: topic cap first, then the author cap, never order
    let i = rest.findIndex(allOk);
    if (i < 0) i = rest.findIndex(authorOk);
    if (i < 0) i = rest.findIndex(notBack);
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

function factory(ctx) {
  const { db, cache, bus } = ctx;
  const content = () => ctx.services.content;
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const invalidate = (uid) => cache.del(`feed:${uid}:`);
  /* Every service already invalidates "feed:<prefix>" when content changes (new/edited/removed posts,
   * approvals, follows, prefs). Mirror those onto the ranking cache so semantics stay identical. */
  const del = cache.del.bind(cache);
  cache.del = (prefix) => { del(prefix); if (prefix.startsWith("feed:")) del("rank:" + prefix.slice(5)); };

  /* ---------- prefs: tabs, chrono default, seen marker ---------- */
  async function prefs(uid) {
    const r = await db.get("SELECT * FROM feed_prefs WHERE user_id=$1", [uid]);
    return { tabs: r?.tabs?.length ? r.tabs : DEFAULT_TABS, chrono: !!r?.chrono, seenAt: r?.seen_at || null, custom: !!r?.tabs?.length };
  }
  async function savePrefs(uid, b) {
    const cur = await prefs(uid);
    let tabs = cur.custom ? cur.tabs : null;
    if (b.tabs !== undefined) {
      if (b.tabs === null) tabs = null;
      else {
        if (!Array.isArray(b.tabs) || b.tabs.length > 14) throw E.bad("قائمة تبويبات غير صالحة");
        const seen = new Set();
        tabs = b.tabs.map(t => ({ id: String(t?.id || ""), label: str(t?.label, 24) || undefined, hidden: t?.hidden ? true : undefined }))
          .filter(t => TAB_ID.test(t.id) && !seen.has(t.id) && seen.add(t.id));
        if (!tabs.some(t => !t.hidden)) throw E.bad("أبقِ تبويباً واحداً ظاهراً على الأقل");
      }
    }
    const chrono = b.chrono !== undefined ? (b.chrono ? 1 : 0) : (cur.chrono ? 1 : 0);
    await db.run("INSERT INTO feed_prefs(user_id,tabs,chrono,seen_at,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO UPDATE SET tabs=$2, chrono=$3, updated_at=$5", [uid, tabs, chrono, cur.seenAt, now()]);
    invalidate(uid);
    return prefs(uid);
  }
  async function markSeen(uid, at) {
    const t = at && !isNaN(Date.parse(at)) ? new Date(Math.min(Date.parse(at), Date.now())).toISOString() : now();
    await db.run("INSERT INTO feed_prefs(user_id,tabs,chrono,seen_at,updated_at) VALUES($1,NULL,0,$2,$2) ON CONFLICT (user_id) DO UPDATE SET seen_at=$2, updated_at=$2", [uid, t]);
    return { seenAt: t };
  }

  /* ---------- engagement signals & feedback ---------- */
  async function signal(uid, postId, kind, extra = {}) {
    if (!SIGNAL_W[kind]) throw E.bad("إشارة غير معروفة");
    const p = await db.get("SELECT id, author, topic FROM posts WHERE id=$1", [postId]); if (!p || p.author === uid) return { ok: false };
    if (kind === "dwell" && !(+extra.ms >= 8000)) kind = "click"; // short glances are clicks, not reads
    if (["dwell", "click"].includes(kind)) { // one read per post per day
      const dup = await db.get("SELECT id FROM engagement_signals WHERE user_id=$1 AND post=$2 AND kind=$3 AND at > $4", [uid, p.id, kind, new Date(Date.now() - 864e5).toISOString()]);
      if (dup) return { ok: true, kind, duplicate: true };
    }
    await db.run("INSERT INTO engagement_signals(user_id,post,author,topic,kind,weight,at) VALUES($1,$2,$3,$4,$5,$6,$7)", [uid, p.id, p.author, p.topic, kind, SIGNAL_W[kind], now()]);
    cache.del(`aff:${uid}`);
    return { ok: true, kind };
  }
  bus.on("COMMENT_CREATED", e => signal(e.actor, e.post, e.parentAuthor ? "reply" : "comment").catch(() => { }));
  bus.on("POST_REACTED", e => signal(e.actor, e.target, "react").catch(() => { }));

  async function feedback(uid, b) {
    const p = b.post ? await db.get("SELECT id, author, topic, community FROM posts WHERE id=$1", [b.post]) : null;
    const dir = b.signal === "more" ? 1 : b.signal === "less" ? -1 : 0; if (!dir) throw E.bad("اختر «أكثر» أو «أقل»");
    let items = [];
    if (b.scope) {
      if (!FEEDBACK_KINDS.includes(b.scope)) throw E.bad("نطاق غير صالح");
      const target = str(b.target, 80) || (p && { author: p.author, topic: p.topic, community: p.community, post: p.id }[b.scope]);
      if (!target) throw E.bad("لا يوجد هدف لهذا النطاق");
      items = [[b.scope, target, dir]];
    } else {
      if (!p) throw E.nf();
      items = dir > 0 ? [["author", p.author, 1], ["topic", p.topic, 0.5]] : [["post", p.id, -1], ["author", p.author, -1], ["topic", p.topic, -0.5]];
    }
    items = items.filter(([, t]) => t);
    for (const [kind, target, w] of items) {
      const old = await db.get("SELECT weight FROM feed_feedback WHERE user_id=$1 AND kind=$2 AND target=$3", [uid, kind, target]);
      const nw = Math.max(-3, Math.min(3, (old?.weight || 0) + w));
      await db.run("INSERT INTO feed_feedback(user_id,kind,target,weight,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id,kind,target) DO UPDATE SET weight=$4, created_at=$5", [uid, kind, target, nw, now()]);
    }
    invalidate(uid);
    return { ok: true, applied: items.map(([kind, target, w]) => ({ kind, target, weight: w })) };
  }
  async function listFeedback(uid) { return (await db.all("SELECT kind, target, weight, created_at FROM feed_feedback WHERE user_id=$1 ORDER BY created_at DESC", [uid])).map(r => ({ kind: r.kind, target: r.target, weight: r.weight, at: r.created_at })); }

  /* ---------- candidates & context ---------- */
  async function candidates(viewer, mode) {
    const since = new Date(Date.now() - 14 * 864e5).toISOString(), base = "status='published' AND type<>'story' AND sponsored=0";
    const [kind, ref] = mode.includes(":") ? [mode.slice(0, mode.indexOf(":")), mode.slice(mode.indexOf(":") + 1)] : [mode, null];
    if (kind === "following") return db.read.all(`SELECT p.* FROM posts p JOIN follows f ON f.dst=p.author AND f.src=$1 WHERE p.${base.replace(/ AND /g, " AND p.")} ORDER BY p.created_at DESC LIMIT 400`, [viewer.id]);
    if (kind === "communities") return db.read.all(`SELECT p.* FROM posts p JOIN memberships m ON m.community=p.community AND m.user_id=$1 AND m.role NOT IN ('pending','banned') WHERE p.${base.replace(/ AND /g, " AND p.")} ORDER BY p.created_at DESC LIMIT 400`, [viewer.id]);
    if (kind === "chrono") return db.read.all(`SELECT * FROM posts WHERE ${base} AND (author=$1 OR author IN (SELECT dst FROM follows WHERE src=$1) OR community IN (SELECT community FROM memberships WHERE user_id=$1 AND role NOT IN ('pending','banned'))
      OR topic IN (SELECT ref FROM topic_follows WHERE user_id=$1 AND kind='topic') OR id IN (SELECT h.post_id FROM post_hashtags h JOIN topic_follows tf ON tf.ref=h.tag AND tf.kind='tag' AND tf.user_id=$1)) ORDER BY created_at DESC LIMIT 400`, [viewer.id]);
    if (kind === "list") {
      const l = await db.get("SELECT * FROM people_lists WHERE id=$1", [ref]); if (!l || (l.owner !== viewer.id && l.visibility !== "public")) throw E.nf("القائمة غير موجودة");
      return db.read.all(`SELECT p.* FROM posts p JOIN people_list_members m ON m.user_id=p.author AND m.list=$1 WHERE p.${base.replace(/ AND /g, " AND p.")} ORDER BY p.created_at DESC LIMIT 300`, [ref]);
    }
    if (kind === "topic") return db.read.all(`SELECT * FROM posts WHERE ${base} AND topic=$1 ORDER BY created_at DESC LIMIT 300`, [ref]);
    if (kind === "tag") return db.read.all(`SELECT p.* FROM posts p JOIN post_hashtags h ON h.post_id=p.id AND h.tag=$1 WHERE p.${base.replace(/ AND /g, " AND p.")} ORDER BY p.created_at DESC LIMIT 300`, [ref]);
    if (!["for", "discover", "latest"].includes(kind)) throw E.bad("نمط خلاصة غير معروف");
    return db.read.all(`SELECT * FROM posts WHERE ${base} AND (created_at > $1 OR author=$2) ORDER BY created_at DESC LIMIT 800`, [since, viewer.id]);
  }
  async function context(viewer, posts) {
    const ids = posts.map(p => p.id), pr = viewer.prefs || {}, uid = viewer.id;
    const c = { interests: pr.interests || [], muted: pr.muted || {}, settings: pr.settings || {}, stats: {}, tagsOf: {}, names: {} };
    c.following = new Set((await db.read.all("SELECT dst FROM follows WHERE src=$1", [uid])).map(r => r.dst));
    c.comms = new Set((await db.read.all("SELECT community FROM memberships WHERE user_id=$1 AND role NOT IN ('pending','banned')", [uid])).map(r => r.community));
    const tf = await db.read.all("SELECT kind, ref FROM topic_follows WHERE user_id=$1", [uid]);
    c.followTopics = new Set(tf.filter(x => x.kind === "topic").map(x => x.ref)); c.followTags = new Set(tf.filter(x => x.kind === "tag").map(x => x.ref));
    c.fb = Object.fromEntries((await db.read.all("SELECT kind, target, weight FROM feed_feedback WHERE user_id=$1", [uid])).map(r => [r.kind + ":" + r.target, r.weight]));
    c.aff = await cache.wrap(`aff:${uid}`, 5 * 60e3, async () => affinity(await db.read.all("SELECT author, topic, kind, at FROM engagement_signals WHERE user_id=$1 AND at > $2", [uid, new Date(Date.now() - 90 * 864e5).toISOString()])));
    c.followerCounts = await cache.wrap("followerCounts", 120e3, async () => Object.fromEntries((await db.read.all("SELECT dst, COUNT(*) n FROM follows GROUP BY dst")).map(r => [r.dst, r.n])));
    for (let i = 0; i < ids.length; i += 400) { // chunked IN lists keep every dialect happy
      const part = ids.slice(i, i + 400), q = ph(part);
      for (const r of await db.read.all(`SELECT target, COUNT(*) n FROM reactions WHERE target IN (${q}) GROUP BY target`, part)) (c.stats[r.target] ||= {}).reactions = r.n;
      for (const r of await db.read.all(`SELECT post, COUNT(*) n, COUNT(DISTINCT author) u FROM comments WHERE post IN (${q}) AND status='published' GROUP BY post`, part)) Object.assign((c.stats[r.post] ||= {}), { comments: r.n, uniqueCommenters: r.u });
      for (const r of await db.read.all(`SELECT post, kind, COUNT(*) n FROM engagement_signals WHERE post IN (${q}) AND kind IN ('save','share','dwell','quote') GROUP BY post, kind`, part)) (c.stats[r.post] ||= {})[{ save: "saves", share: "shares", dwell: "dwells", quote: "shares" }[r.kind]] = r.n;
      for (const r of await db.read.all(`SELECT post_id, tag FROM post_hashtags WHERE post_id IN (${q})`, part)) (c.tagsOf[r.post_id] ||= []).push(r.tag);
    }
    const authors = [...new Set(posts.map(p => p.author))];
    for (let i = 0; i < authors.length; i += 400) { const part = authors.slice(i, i + 400); for (const u of await db.read.all(`SELECT id, name FROM users WHERE id IN (${ph(part)})`, part)) c.names[u.id] = u.name; }
    return c;
  }

  /** public profiles of the authors of client posts, so any screen can render cards for posts it never hydrated */
  async function authors(posts) {
    const ids = [...new Set(posts.filter(Boolean).map(p => p.author))]; if (!ids.length) return [];
    return (await db.read.all(`SELECT * FROM users WHERE id IN (${ph(ids)})`, ids)).map(ctx.services.users.pub);
  }

  /* ---------- feed ---------- */
  async function ranked(viewer, mode) {
    return cache.wrap(`rank:${viewer.id}:${mode}`, TTL, async () => {
      const pr = viewer.prefs || {};
      const raw = (await candidates(viewer, mode)).filter(p => !(pr.blocked || []).includes(p.author) && (p.author === viewer.id || !ctx.policy.mutedWordHit((p.title || "") + " " + p.text, pr.mutedWords)));
      const visible = await content().filterVisible(raw, viewer.id);
      const kind = mode.split(":")[0];
      if (["latest", "chrono", "following", "communities", "list"].includes(kind)) { // time-ordered modes: no ranking, only hard filters
        const c = await context(viewer, visible);
        return visible.filter(p => scorePost(p, c).score > -50).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(p => ({ id: p.id, at: p.created_at, why: null }));
      }
      const c = await context(viewer, visible);
      let list = visible.map(p => { const s = scorePost(p, c); return { p, s: s.score, top: s.factors.filter(f => f.w > 0 && f.code !== "recency").sort((a, b) => b.w - a.w)[0] }; }).filter(x => x.s > -50);
      if (kind === "discover") list = list.filter(x => !c.following.has(x.p.author) && !c.interests.includes(x.p.topic) && x.p.author !== viewer.id);
      list.sort((a, b) => b.s - a.s);
      const top = new Map(list.map(x => [x.p.id, x.top ? x.top.label : null]));
      return diversify(list.map(x => x.p)).map(p => ({ id: p.id, at: p.created_at, why: top.get(p.id) }));
    });
  }
  async function feed(viewer, mode = "for", cursor = 0, limit = PAGE) {
    limit = Math.min(Math.max(+limit || PAGE, 1), 50); cursor = Math.max(+cursor || 0, 0);
    mode = String(mode || "for");
    const fp = await prefs(viewer.id);
    if (mode === "for" && fp.chrono) mode = "chrono"; // the permanent chronological option
    const list = await ranked(viewer, mode);
    const page = list.slice(cursor, cursor + limit), ids = page.map(x => x.id);
    const rows = ids.length ? await db.read.all(`SELECT * FROM posts WHERE id IN (${ph(ids)})`, ids) : [];
    if (ctx.services.paid) await ctx.services.paid.annotate(rows, viewer.id); // phase 38: rows re-read after the cached ranking need the viewer's paid entitlement
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    let posts = page.filter(x => byId[x.id]).map(x => ({ ...content().toClient(byId[x.id], viewer.id), why: x.why || undefined, fresh: fp.seenAt ? x.at > fp.seenAt : undefined }));
    // phase 40: promoted posts (services/ads.js) — ≤ 1 per ADS_FEED_INTERVAL organic posts, never first, home modes only; cursors stay organic
    if (ctx.services.ads) posts = await ctx.services.ads.inject(viewer, posts, { mode, cursor });
    // «وصلت لآخر الجديد»: number of posts newer than the last visit, and (time-ordered modes) where they end
    const fresh = fp.seenAt ? list.filter(x => x.at > fp.seenAt).length : null;
    const timeOrdered = ["latest", "chrono", "following", "communities", "list"].includes(mode.split(":")[0]);
    ctx.track(viewer.id, "feed_viewed", { mode, cursor });
    return { mode, posts, users: await authors(posts), nextCursor: cursor + limit < list.length ? cursor + limit : null, seenAt: fp.seenAt, freshCount: fresh, caughtUpIndex: timeOrdered && fresh !== null ? fresh : null };
  }
  async function why(viewer, pid) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]); if (!p || !(await content().canSee(p, viewer.id))) throw E.nf();
    const c = await context(viewer, [p]), s = scorePost(p, c);
    const factors = s.factors.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    const shown = factors.filter(f => f.w > 0);
    const controls = [{ signal: "more", scope: "author", target: p.author, label: `المزيد من ${c.names[p.author] || "هذا الحساب"}` }, { signal: "less", scope: "author", target: p.author, label: `أقل من ${c.names[p.author] || "هذا الحساب"}` }];
    if (p.topic) controls.push({ signal: "less", scope: "topic", target: p.topic, label: "أقل من هذا الموضوع" });
    return { reasons: shown.length ? shown.map(f => f.label) : ["محتوى رائج قد يهمك"], factors, score: Math.round(s.score * 100) / 100, controls,
      model: "تفاعل هادف: التعليق ×3، الحفظ ×2.5، المشاركة ×2، القراءة الطويلة ×1.5، الإعجاب ×1، النقرة ×0.2" };
  }

  const r = ctx.router, A = ctx.requireUser;
  r.get("/api/feed/prefs", A(async (req) => prefs(req.user.id)));
  r.put("/api/feed/prefs", A(async (req) => savePrefs(req.user.id, req.body)));
  r.post("/api/feed/seen", A(async (req) => markSeen(req.user.id, req.body.at)));
  r.post("/api/feed/feedback", A(async (req) => feedback(req.user.id, req.body)));
  r.get("/api/feed/feedback", A(async (req) => ({ feedback: await listFeedback(req.user.id) })));
  r.del("/api/feed/feedback/:kind/:target", A(async (req) => { await db.run("DELETE FROM feed_feedback WHERE user_id=$1 AND kind=$2 AND target=$3", [req.user.id, req.params.kind, req.params.target]); invalidate(req.user.id); return { ok: true }; }));
  r.post("/api/feed/signal", A(async (req) => signal(req.user.id, str(req.body.post, 80, { required: true }), String(req.body.kind || ""), { ms: req.body.ms })));
  r.get("/api/feed", A(async (req) => feed(req.user, req.query.mode || "for", req.query.cursor, req.query.limit)));
  r.get("/api/posts/:id/why", A(async (req) => why(req.user, req.params.id)));
  return { feed, why, signal, feedback, prefs, savePrefs, markSeen, invalidate, ranked, authors };
}
module.exports = factory;
Object.assign(module.exports, { scorePost, diversify, meaningful, affinity, SIGNAL_W, DEFAULT_TABS });
