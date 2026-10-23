/* Trends & topics service (Phase 23).
 * • Trends per scope — global, country:<ISO>, city:<name> — computed every 5 minutes by a leased
 *   scheduled job into `trend_snapshots`, so reads are a single indexed lookup on any instance.
 *   Location comes from the post's place, falling back to the author's profile city/country (lib/geo.js).
 * • Manipulation detection per hashtag: one account dominating, swarms of brand-new accounts, copy-paste
 *   coordinated texts, and engagement coming from a closed circle. Flagged tags are dampened and hidden
 *   from public lists (admins can still see them with the reasons).
 * • Every trend ships an extractive summary of what people are saying, with citations to post ids.
 * • Follow a topic or a hashtag (feeds the ranking service and the chronological feed).
 * • Curated topic pages (title, description, colour, emoji, featured posts/communities) with defaults.
 * • /api/explore: the payload for the magazine-style explore page. */
const { E, str, now, TOPICS, canonTag, normalizeTag } = require("../lib/core");
const A = require("../lib/arabic");
const geo = require("../lib/geo");
const { extractive } = require("../lib/llm");
const PRESETS = {
  ai: { emoji: "🤖", color: "#5b21b6", descr: "نماذج لغوية، تعلم آلي، وأدوات تغيّر طريقة عملنا" },
  dev: { emoji: "💻", color: "#1d4ed8", descr: "برمجة، أدوات، ومشاريع مفتوحة المصدر من مطورين عرب" },
  startups: { emoji: "🚀", color: "#b45309", descr: "قصص التأسيس، التمويل، والنمو في المنطقة" },
  invest: { emoji: "📈", color: "#047857", descr: "أسواق، ادخار، واستثمار بوعي" },
  pi: { emoji: "π", color: "#6d28d9", descr: "كل ما يخص شبكة Pi وتطبيقاتها ومجتمعها" },
  design: { emoji: "🎨", color: "#be185d", descr: "تصميم واجهات، هوية بصرية، وخط عربي" },
  games: { emoji: "🎮", color: "#c2410c", descr: "ألعاب، رياضات إلكترونية، وصناعة الألعاب" },
  learn: { emoji: "📚", color: "#0e7490", descr: "تعلم مستمر، كتب، ودورات تستحق وقتك" }
};
const HEX = /^#[0-9a-f]{6}$/i;
const WINDOW_H = 48;

/* ---------- pure detection (unit-tested) ---------- */
/** @param {{author:string, text:string, created_at:string, authorCreated?:string, reactors?:string[]}[]} posts */
/* baselineFresh = share of ALL recent posts written by brand-new accounts: on a young platform (or during a
 * signup wave) new accounts are normal, so only a tag far above that baseline counts as a swarm. */
function manipulation(posts, { at = Date.now(), baselineFresh = 0 } = {}) {
  const n = posts.length, reasons = [];
  if (n < 4) return { flagged: false, reasons, signals: {} };
  const per = {}; for (const p of posts) per[p.author] = (per[p.author] || 0) + 1;
  const authors = Object.keys(per).length, top = Math.max(...Object.values(per)) / n;
  const fresh = posts.filter(p => p.authorCreated && at - Date.parse(p.authorCreated) < 3 * 864e5).length / n;
  const sig = {}; for (const p of posts) { const k = A.tokens(p.text).filter(t => !t.startsWith("#")).slice(0, 12).join(" "); if (k) sig[k] = (sig[k] || 0) + 1; }
  const dup = Math.max(0, ...Object.values(sig)) / n;
  const reactors = posts.flatMap(p => p.reactors || []), uniqueReactors = new Set(reactors).size;
  const closed = reactors.length >= 8 && uniqueReactors <= 2;
  if (top > 0.5) reasons.push("حساب واحد ينشر أغلب المحتوى");
  if (fresh > 0.6 && fresh - baselineFresh > 0.3 && authors >= 3) reasons.push("أغلب المشاركين حسابات أُنشئت حديثاً");
  if (dup > 0.5 && n >= 4) reasons.push("نصوص متطابقة منسوخة بشكل منسّق");
  if (closed) reasons.push("التفاعل يأتي من دائرة مغلقة من الحسابات");
  return { flagged: reasons.length > 0, reasons, signals: { topShare: +top.toFixed(2), newAccounts: +fresh.toFixed(2), baselineNew: +baselineFresh.toFixed(2), duplicates: +dup.toFixed(2), uniqueReactors } };
}
function trendScore(t) {
  const velocity = t.last6 / Math.max(1, t.prev);
  return (t.unique * 3 + t.last6 * 2 + Math.log2(1 + t.eng)) * (1 + Math.min(velocity, 4) * 0.25);
}

module.exports = (ctx) => {
  const { db, bus, cache } = ctx;
  const content = () => ctx.services.content;
  const ph = (a) => a.map((_, i) => "$" + (i + 1)).join(",");
  let lastTop = new Set();

  async function compute() {
    const since = new Date(Date.now() - WINDOW_H * 3600e3).toISOString(), six = Date.now() - 6 * 3600e3, day = Date.now() - 24 * 3600e3;
    const rows = await db.all(`SELECT h.tag, p.id, p.author, p.text, p.title, p.created_at, p.location, u.name AS uname, u.location AS ulocation, u.country AS ucountry, u.created_at AS ucreated
      FROM post_hashtags h JOIN posts p ON p.id=h.post_id JOIN users u ON u.id=p.author
      WHERE p.status='published' AND p.visibility='public' AND p.sponsored=0 AND p.type<>'story' AND h.created_at > $1`, [since]);
    const ids = [...new Set(rows.map(r => r.id))], reactors = {}, eng = {};
    for (let i = 0; i < ids.length; i += 400) {
      const part = ids.slice(i, i + 400);
      for (const r of await db.all(`SELECT target, user_id FROM reactions WHERE target IN (${ph(part)})`, part)) (reactors[r.target] ||= []).push(r.user_id);
      for (const r of await db.all(`SELECT post, COUNT(*) n FROM comments WHERE post IN (${ph(part)}) AND status='published' GROUP BY post`, part)) eng[r.post] = r.n;
    }
    const scopes = {}; // "global|" , "country|SA", "city|جدة" → tag → bucket
    for (const r of rows) {
      const loc = geo.resolve(r.location || r.ulocation, r.ucountry);
      const keys = ["global|"]; if (loc.country) keys.push("country|" + loc.country); if (loc.city) keys.push("city|" + loc.city);
      for (const k of keys) {
        const t = ((scopes[k] ||= {})[r.tag] ||= { tag: r.tag, posts: [], users: new Set(), last6: 0, prev: 0, eng: 0 });
        t.posts.push({ id: r.id, author: r.author, uname: r.uname, text: `${r.title || ""} ${r.text}`, created_at: r.created_at, authorCreated: r.ucreated, reactors: reactors[r.id] || [], eng: (reactors[r.id] || []).length + (eng[r.id] || 0) });
        t.users.add(r.author); t.eng += (reactors[r.id] || []).length + (eng[r.id] || 0);
        const ts = Date.parse(r.created_at); if (ts > six) t.last6++; else if (ts > day) t.prev++;
      }
    }
    const isFresh = (r) => r.ucreated && Date.now() - Date.parse(r.ucreated) < 3 * 864e5;
    const baselineFresh = ids.length ? new Set(rows.filter(isFresh).map(r => r.id)).size / ids.length : 0;
    const at = now(), out = [];
    for (const [k, tags] of Object.entries(scopes)) {
      const [scope, key] = k.split("|");
      const list = Object.values(tags).filter(t => t.posts.length >= 2).map(t => {
        const m = manipulation(t.posts, { baselineFresh });
        const base = { tag: t.tag, posts: t.posts.length, unique: t.users.size, last6: t.last6, prev: t.prev, eng: t.eng };
        const score = trendScore(base) * (m.flagged ? 0.2 : 1);
        const top = [...t.posts].sort((a, b) => b.eng - a.eng).slice(0, 8);
        const names = Object.fromEntries(t.posts.map(p => [p.id, p.uname]));
        const pts = extractive({ sources: top.map(p => ({ id: p.id, text: p.text.replace(/#[\p{L}\p{N}_]+/gu, "").trim(), weight: p.eng })), maxPoints: 3 }).points;
        const brief = { ai: true, provider: "extractive", points: pts.map(x => ({ text: x.text, cites: x.cites.map(id => ({ id, kind: "post", author: names[id] || null })) })), signals: m.signals, reasons: m.reasons };
        return { ...base, score, velocity: t.last6 / Math.max(1, t.prev), flagged: m.flagged, reason: m.reasons.join("، ") || null, brief };
      }).sort((a, b) => b.score - a.score).slice(0, 25);
      if (scope !== "global" && list.filter(x => !x.flagged).length === 0) continue;
      out.push({ scope, key, list });
    }
    await db.tx(async (t) => {
      await t.run("DELETE FROM trend_snapshots", []);
      for (const s of out) for (const [i, x] of s.list.entries())
        await t.run("INSERT INTO trend_snapshots(scope,key,tag,rank,score,posts,uniq,velocity,flagged,reason,brief,computed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [s.scope, s.key, x.tag, i + 1, x.score, x.posts, x.unique, x.velocity, x.flagged ? 1 : 0, x.reason, x.brief, at]);
    });
    cache.del("trends2:");
    const top = (out.find(s => s.scope === "global")?.list || []).filter(x => !x.flagged).slice(0, 5);
    for (const t of top) if (!lastTop.has(t.tag)) bus.emit("TREND_DETECTED", { tag: t.tag, unique: t.unique });
    lastTop = new Set(top.map(t => t.tag));
    return { scopes: out.length, computedAt: at };
  }
  ctx.scheduler.every("trendsCompute", 5 * 60e3, compute);
  const ensure = async () => { if (!(await db.get("SELECT 1 x FROM trend_snapshots LIMIT 1"))) await ctx.scheduler.runOnce("trendsCompute", compute, 60e3); };

  const trendClient = (r, admin) => ({ tag: r.tag, rank: r.rank, posts: r.posts, unique: r.uniq, velocity: Math.round(r.velocity * 10) / 10, score: Math.round(r.score * 10) / 10,
    summary: r.brief ? { ai: true, provider: r.brief.provider, label: "ملخص مولّد آلياً من المنشورات", points: r.brief.points } : null,
    ...(admin ? { flagged: !!r.flagged, reason: r.reason, signals: r.brief?.signals } : {}), computedAt: r.computed_at });
  async function list({ scope = "global", key = "", admin = false, flagged = false } = {}) {
    await ensure();
    scope = ["global", "country", "city"].includes(scope) ? scope : "global"; key = scope === "global" ? "" : String(key || "");
    const rows = await cache.wrap(`trends2:${scope}:${key}`, 60e3, () => db.read.all("SELECT * FROM trend_snapshots WHERE scope=$1 AND key=$2 ORDER BY rank", [scope, key]));
    const vis = rows.filter(r => (admin && flagged) || !r.flagged);
    return { scope, key, label: scope === "country" ? geo.COUNTRY_AR[key] || key : scope === "city" ? key : "العالم العربي", trends: vis.map(r => trendClient(r, admin)), computedAt: rows[0]?.computed_at || null };
  }
  async function places() {
    await ensure();
    const rows = await db.read.all("SELECT scope, key, COUNT(*) n FROM trend_snapshots WHERE flagged=0 AND scope<>'global' GROUP BY scope, key ORDER BY n DESC");
    return rows.map(r => ({ scope: r.scope, key: r.key, label: r.scope === "country" ? geo.COUNTRY_AR[r.key] || r.key : r.key, trends: r.n }));
  }
  async function detail(viewer, tagRaw) {
    await ensure();
    const tag = canonTag(normalizeTag(tagRaw));
    const row = await db.get("SELECT * FROM trend_snapshots WHERE scope='global' AND tag=$1", [tag]);
    const posts = await db.read.all("SELECT p.* FROM post_hashtags h JOIN posts p ON p.id=h.post_id WHERE h.tag=$1 AND p.status='published' ORDER BY p.created_at DESC LIMIT 60", [tag]);
    const visible = await content().filterVisible(posts, viewer?.id);
    const following = viewer ? !!(await db.get("SELECT 1 x FROM topic_follows WHERE user_id=$1 AND kind='tag' AND ref=$2", [viewer.id, tag])) : false;
    const followers = (await db.get("SELECT COUNT(*) n FROM topic_follows WHERE kind='tag' AND ref=$1", [tag])).n;
    return { tag, trend: row && (!row.flagged || viewer?.role === "admin") ? trendClient(row, viewer?.role === "admin") : null, following, followers, posts: visible.slice(0, 30).map(p => content().toClient(p, viewer?.id)), users: await ctx.services.ranking.authors(visible.slice(0, 30)) };
  }

  /* ---------- follows ---------- */
  async function follow(uid, kind, ref, on) {
    if (!["topic", "tag"].includes(kind)) throw E.bad();
    ref = kind === "tag" ? canonTag(normalizeTag(str(ref, 60, { required: true }))) : str(ref, 40, { required: true });
    if (kind === "topic" && !TOPICS.some(t => t.slug === ref) && !(await db.get("SELECT 1 x FROM topic_pages WHERE slug=$1", [ref]))) throw E.nf("الموضوع غير موجود");
    if (on) await db.run("INSERT INTO topic_follows(user_id,kind,ref,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [uid, kind, ref, now()]);
    else await db.run("DELETE FROM topic_follows WHERE user_id=$1 AND kind=$2 AND ref=$3", [uid, kind, ref]);
    ctx.services.ranking?.invalidate(uid);
    return { kind, ref, following: on };
  }
  async function myFollows(uid) {
    const rows = await db.all("SELECT kind, ref FROM topic_follows WHERE user_id=$1 ORDER BY created_at DESC", [uid]);
    return { topics: rows.filter(r => r.kind === "topic").map(r => r.ref), tags: rows.filter(r => r.kind === "tag").map(r => r.ref) };
  }

  /* ---------- curated topic pages ---------- */
  async function topicMeta(slug) {
    const t = TOPICS.find(x => x.slug === slug), row = await db.get("SELECT * FROM topic_pages WHERE slug=$1", [slug]);
    if (!t && !row) return null;
    const pre = PRESETS[slug] || { emoji: "✨", color: "#4f22d1", descr: "" };
    return { slug, title: row?.title || t?.name, descr: row?.descr || pre.descr, color: row?.color || pre.color, emoji: row?.emoji || pre.emoji, featured: row?.data?.featured || [], communities: row?.data?.communities || [], tags: row?.data?.tags || [], curated: !!row, updatedAt: row?.updated_at || null };
  }
  async function topicPage(viewer, slug) {
    const meta = await topicMeta(slug); if (!meta) throw E.nf("الموضوع غير موجود");
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const featuredRows = meta.featured.length ? await db.read.all(`SELECT * FROM posts WHERE id IN (${ph(meta.featured)}) AND status='published'`, meta.featured) : [];
    const recent = await db.read.all("SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post=p.id AND c.status='published') * 3 + (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) AS eng FROM posts p WHERE p.topic=$1 AND p.status='published' AND p.type<>'story' AND p.created_at > $2 ORDER BY eng DESC, p.created_at DESC LIMIT 40", [slug, since]);
    const visF = await content().filterVisible(featuredRows, viewer?.id), visR = await content().filterVisible(recent, viewer?.id);
    const comms = meta.communities.length ? await db.read.all(`SELECT * FROM communities WHERE id IN (${ph(meta.communities)})`, meta.communities) : await db.read.all("SELECT c.*, (SELECT COUNT(*) FROM memberships m WHERE m.community=c.id) n FROM communities c WHERE c.topic=$1 AND c.type='public' ORDER BY n DESC LIMIT 6", [slug]);
    const people = await db.read.all("SELECT u.*, COUNT(p.id) n FROM posts p JOIN users u ON u.id=p.author WHERE p.topic=$1 AND p.status='published' AND p.visibility='public' AND p.created_at > $2 GROUP BY u.id ORDER BY n DESC LIMIT 6", [slug, since]);
    const followers = (await db.get("SELECT COUNT(*) n FROM topic_follows WHERE kind='topic' AND ref=$1", [slug])).n;
    const following = viewer ? !!(await db.get("SELECT 1 x FROM topic_follows WHERE user_id=$1 AND kind='topic' AND ref=$2", [viewer.id, slug])) : false;
    // trends inside the topic: global snapshot tags whose posts carry this topic
    const tags = (await db.read.all("SELECT h.tag, COUNT(*) n FROM post_hashtags h JOIN posts p ON p.id=h.post_id WHERE p.topic=$1 AND p.status='published' AND h.created_at > $2 GROUP BY h.tag ORDER BY n DESC LIMIT 8", [slug, since])).map(r => ({ tag: r.tag, posts: r.n }));
    const seen = new Set(visF.map(p => p.id));
    const users = await ctx.services.ranking.authors([...visF, ...visR.slice(0, 22)]);
    return { users, topic: meta, following, followers, tags: [...new Set([...meta.tags, ...tags.map(t => t.tag)])].slice(0, 8), featured: visF.map(p => content().toClient(p, viewer?.id)),
      posts: visR.filter(p => !seen.has(p.id)).slice(0, 20).map(p => content().toClient(p, viewer?.id)), communities: comms.map(ctx.services.communities.toClient), people: people.map(ctx.services.users.pub) };
  }
  async function curate(user, slug, b) {
    if (user.role !== "admin") throw E.forbid("تنسيق صفحات المواضيع للإدارة");
    const meta = await topicMeta(slug); if (!meta && !/^[a-z0-9-]{2,30}$/.test(slug)) throw E.bad("معرّف موضوع غير صالح");
    const title = str(b.title, 60) || meta?.title; if (!title) throw E.bad("العنوان مطلوب");
    const color = b.color && HEX.test(b.color) ? b.color : meta?.color || null;
    const arr = (v, max) => (Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, max) : []);
    const data = { featured: arr(b.featured, 6), communities: arr(b.communities, 6), tags: arr(b.tags, 8).map(t => canonTag(normalizeTag(t))) };
    await db.run("INSERT INTO topic_pages(slug,title,descr,color,emoji,data,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (slug) DO UPDATE SET title=$2, descr=$3, color=$4, emoji=$5, data=$6, updated_by=$7, updated_at=$8",
      [slug, title, str(b.descr, 240) ?? meta?.descr ?? "", color, str(b.emoji, 8) || meta?.emoji || null, data, user.id, now()]);
    ctx.audit("TOPIC_CURATED", slug, null, user.id);
    return topicMeta(slug);
  }

  /* ---------- explore (magazine) ---------- */
  async function explore(viewer, q = {}) {
    const me = viewer ? await db.get("SELECT location, country FROM users WHERE id=$1", [viewer.id]) : null;
    const mine = me ? geo.resolve(me.location, me.country) : { city: null, country: null };
    const scope = ["country", "city"].includes(q.scope) ? q.scope : "global", key = scope === "global" ? "" : q.key || (scope === "city" ? mine.city : mine.country) || "";
    const tr = await list({ scope, key });
    const all = await places();
    const follows = viewer ? await myFollows(viewer.id) : { topics: [], tags: [] };
    const week = new Date(Date.now() - 7 * 864e5).toISOString();
    const counts = Object.fromEntries((await db.read.all("SELECT topic, COUNT(*) n FROM posts WHERE status='published' AND created_at > $1 AND topic IS NOT NULL GROUP BY topic", [week])).map(r => [r.topic, r.n]));
    const fcounts = Object.fromEntries((await db.read.all("SELECT ref, COUNT(*) n FROM topic_follows WHERE kind='topic' GROUP BY ref")).map(r => [r.ref, r.n]));
    const topics = [];
    for (const t of TOPICS) { const m = await topicMeta(t.slug); topics.push({ slug: t.slug, title: m.title, emoji: m.emoji, color: m.color, descr: m.descr, posts7d: counts[t.slug] || 0, followers: fcounts[t.slug] || 0, following: follows.topics.includes(t.slug) }); }
    topics.sort((a, b) => Number(b.following) - Number(a.following) || b.posts7d - a.posts7d);
    const articles = await content().filterVisible(await db.read.all("SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post=p.id) * 3 + (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) eng FROM posts p WHERE p.type IN ('article','discussion') AND p.status='published' AND p.visibility='public' ORDER BY eng DESC, p.created_at DESC LIMIT 12"), viewer?.id);
    const comms = await db.read.all("SELECT c.*, (SELECT COUNT(*) FROM memberships m WHERE m.community=c.id AND m.role NOT IN ('pending','banned')) members FROM communities c WHERE c.type='public' ORDER BY members DESC LIMIT 8");
    const rising = [...tr.trends].filter(t => t.velocity > 1).sort((a, b) => b.velocity - a.velocity).slice(0, 5);
    return { location: { scope: tr.scope, key: tr.key, label: tr.label, mine }, places: all, hero: tr.trends[0] || null, trends: tr.trends.slice(0, 10), rising, topics, followedTags: follows.tags,
      articles: articles.slice(0, 6).map(p => content().toClient(p, viewer?.id)), users: await ctx.services.ranking.authors(articles.slice(0, 6)), communities: comms.map(c => ({ ...ctx.services.communities.toClient(c), members: c.members })), computedAt: tr.computedAt };
  }

  const r = ctx.router, AU = ctx.requireUser;
  r.get("/api/trending", async (req) => list({ scope: req.query.scope, key: req.query.key, admin: req.user?.role === "admin", flagged: req.query.flagged === "1" }));
  r.get("/api/trending/places", async () => ({ places: await places() }));
  r.get("/api/trending/tag/:tag", async (req) => detail(req.user, req.params.tag));
  r.post("/api/admin/trends/recompute", AU(async (req) => { if (req.user.role !== "admin") throw E.forbid(); return compute(); }));
  r.get("/api/explore", async (req) => explore(req.user, req.query));
  r.get("/api/topics/:slug/page", async (req) => topicPage(req.user, req.params.slug));
  r.put("/api/topics/:slug/page", AU(async (req) => ({ topic: await curate(req.user, req.params.slug, req.body) })));
  r.get("/api/follows/topics", AU(async (req) => myFollows(req.user.id)));
  r.put("/api/follows/:kind/:ref", AU(async (req) => follow(req.user.id, req.params.kind, req.params.ref, true)));
  r.del("/api/follows/:kind/:ref", AU(async (req) => follow(req.user.id, req.params.kind, req.params.ref, false)));
  return { compute, list, places, detail, follow, topicPage, explore };
};
Object.assign(module.exports, { manipulation, trendScore, PRESETS });
