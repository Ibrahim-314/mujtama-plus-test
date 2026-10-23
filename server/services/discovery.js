/* Legacy discovery endpoints: quick trends (/api/trends), intent-aware search (/api/search), topics, tags.
 * v2.6: the feed lives in services/ranking.js, full search in services/search.js, location trends in services/trends.js.
 * Trends = velocity × unique participants × engagement diversity, with single-actor manipulation dampening. */
const { str, TOPICS, canonTag, normalizeTag } = require("../lib/core");

module.exports = (ctx) => {
  const { db, cache, bus } = ctx;
  const content = () => ctx.services.content;

  /* Feed ranking moved to its own service in v2.6 (services/ranking.js); kept here as a delegate. */
  const feed = (...a) => ctx.services.ranking.feed(...a);

  /* ---- Trends ---- */
  let lastTop = new Set();
  async function computeTrends(scope = "global", key = null) {
    const since = new Date(Date.now() - 48 * 3600e3).toISOString(), six = Date.now() - 6 * 3600e3, day = Date.now() - 24 * 3600e3;
    let rows = await db.read.all(`SELECT h.tag, p.id, p.author, p.created_at, p.lang, p.topic, p.community,
        (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) + (SELECT COUNT(*) FROM comments c WHERE c.post=p.id) AS eng
      FROM post_hashtags h JOIN posts p ON p.id=h.post_id WHERE p.status='published' AND p.visibility='public' AND p.sponsored=0 AND h.created_at > $1`, [since]);
    if (scope === "lang") rows = rows.filter(r => r.lang === key); if (scope === "topic") rows = rows.filter(r => r.topic === key); if (scope === "community") rows = rows.filter(r => r.community === key);
    const m = {};
    for (const r of rows) {
      const t = (m[r.tag] ||= { tag: r.tag, users: new Set(), posts: 0, last6: 0, prev: 0, eng: 0, per: {} });
      t.users.add(r.author); t.posts++; t.eng += r.eng; t.per[r.author] = (t.per[r.author] || 0) + 1;
      const ts = new Date(r.created_at).getTime(); if (ts > six) t.last6++; else if (ts > day) t.prev++;
    }
    return Object.values(m).map(t => {
      const share = Math.max(...Object.values(t.per)) / t.posts;
      return { tag: t.tag, posts: t.posts, unique: t.users.size, last6: t.last6, velocity: t.last6 / Math.max(1, t.prev), engagement: t.eng,
        score: (t.users.size * 3 + t.last6 * 2 + Math.log2(1 + t.eng)) * (share > 0.8 && t.posts > 3 ? 0.3 : 1) };
    }).sort((a, b) => b.score - a.score).slice(0, 30);
  }
  async function trends(scope, key) { return cache.wrap(`trends:${scope}:${key}`, 5 * 60e3, () => computeTrends(scope, key)); }
  async function trendWorker() { // detects tags newly entering top 5 → TREND_DETECTED
    cache.del("trends"); const top = (await trends("global", null)).slice(0, 5);
    for (const t of top) if (!lastTop.has(t.tag)) bus.emit("TREND_DETECTED", { tag: t.tag, unique: t.unique });
    lastTop = new Set(top.map(t => t.tag));
  }

  /* ---- Search: intent-aware across people, posts, communities, topics, hashtags, events ---- */
  async function search(viewer, q) {
    q = str(q, 100, { required: true }); ctx.track(viewer?.id, "search_performed", { q });
    const loc = q.match(/في\s+(\S+)/); const city = loc ? loc[1].replace(/^ال/, "") : null;
    const terms = q.replace(/في\s+\S+/, "").replace(/[#@]/g, "").split(/\s+/).filter(w => w.length > 1 && !["أفضل", "عن", "من", "على", "best"].includes(w));
    const like = (t) => "%" + t.toLowerCase().replace(/[%_]/g, "") + "%";
    const term = terms[0] || q.replace(/[#@]/g, "");
    const users = await db.read.all("SELECT * FROM users WHERE LOWER(name) LIKE $1 OR LOWER(handle) LIKE $1 OR LOWER(bio) LIKE $1 LIMIT 10", [like(term)]);
    let postRows = await db.read.all("SELECT * FROM posts WHERE status='published' AND type<>'story' AND visibility='public' AND (LOWER(text) LIKE $1 OR LOWER(COALESCE(title,'')) LIKE $1) ORDER BY created_at DESC LIMIT 60", [like(term)]);
    if (city) postRows = postRows.concat(await db.read.all("SELECT * FROM posts WHERE status='published' AND visibility='public' AND LOWER(COALESCE(location,'')) LIKE $1 LIMIT 20", [like(city)]));
    const uniq = [...new Map(postRows.map(p => [p.id, p])).values()];
    const posts = await content().filterVisible(uniq, viewer?.id);
    const scoreP = (p) => terms.filter(t => (p.text + " " + (p.title || "")).toLowerCase().includes(t.toLowerCase())).length * 2 + (p.views > 300 ? 1 : 0);
    const communities = await db.read.all("SELECT * FROM communities WHERE type<>'invite' AND (LOWER(name) LIKE $1 OR LOWER(descr) LIKE $1" + (city ? " OR LOWER(COALESCE(location,'')) LIKE $2" : "") + ") LIMIT 10", city ? [like(term), like(city)] : [like(term)]);
    const tag = canonTag(normalizeTag(term));
    const tags = await db.read.all("SELECT tag, COUNT(*) n FROM post_hashtags WHERE tag LIKE $1 GROUP BY tag ORDER BY n DESC LIMIT 8", [like(tag)]);
    const events = await db.read.all("SELECT * FROM events WHERE status='upcoming' AND (LOWER(name) LIKE $1 OR LOWER(descr) LIKE $1) LIMIT 5", [like(term)]);
    return { users: users.map(ctx.services.users.pub), posts: posts.sort((a, b) => scoreP(b) - scoreP(a)).slice(0, 20).map(p => content().toClient(p)), communities: communities.map(ctx.services.communities.toClient),
      topics: TOPICS.filter(t => t.name.includes(term) || t.slug === term.toLowerCase()), hashtags: tags, events: await ctx.services.communities.evClients(await ctx.services.communities.visibleEvents(events, viewer?.id)) };
  }

  const r = ctx.router;
  r.get("/api/trends", async (req) => ({ trends: await trends(req.query.scope || "global", req.query.key || null) }));
  r.get("/api/search", async (req) => search(req.user, req.query.q));
  r.get("/api/topics", async () => ({ topics: TOPICS }));
  r.get("/api/tags/:tag", async (req) => {
    const tag = canonTag(normalizeTag(req.params.tag));
    const rows = await db.read.all("SELECT p.* FROM post_hashtags h JOIN posts p ON p.id=h.post_id WHERE h.tag=$1 AND p.status='published' ORDER BY p.created_at DESC LIMIT 50", [tag]);
    const out = []; for (const p of rows) if (await content().canSee(p, req.user?.id)) out.push(content().toClient(p));
    return { tag, posts: out };
  });
  return { feed, trends, trendWorker, search };
};
