/* ===== Feed Engine, Trend Engine, Search, AI-lite helpers ===== */
const Feed = {
  // Score = Relevance + Relationship + Freshness + Quality + Engagement + Interest − Negative − Spam
  score(p, reasons) {
    const me = DB.me, ageH = (Date.now() - new Date(p.createdAt)) / 3600e3;
    const reacts = S.reactionsOf(p.id).length, comms = S.commentsOf(p.id).length, reposts = S.repostsOf(p.id);
    const engagement = Math.log2(1 + reacts + 2 * comms + 3 * reposts);
    const freshness = 6 / (1 + ageH / 6); // decays, but strong posts survive via engagement
    const interestW = (DB.interestWeights || {})[p.topic] || 0;
    const interest = (DB.interests.includes(p.topic) ? 3 : 0) + interestW;
    const following = S.follows(me, p.author) ? 2.5 : 0;
    const interacted = DB.reactions.filter(r => r.user === me && S.post(r.target)?.author === p.author).length;
    const relationship = following + Math.min(interacted, 4) * 0.5;
    const quality = (p.type === "article" ? 1.2 : 0) + (p.type === "question" ? 0.8 : 0) + (p.text && p.text.length > 80 ? 0.5 : 0);
    const negative = DB.muted.topics.includes(p.topic) || DB.muted.users.includes(p.author) || DB.muted.posts.includes(p.id) ? 100 : 0;
    if (reasons) {
      if (DB.interests.includes(p.topic)) reasons.push(`لأنك تتابع موضوع ${S.topic(p.topic)?.name}`);
      if (following) reasons.push(`لأنك تتابع ${S.user(p.author).name}`);
      if (interacted) reasons.push("لأنك تفاعلت مع محتوى مشابه");
      if (engagement > 3) reasons.push("لأنه يحصل على تفاعل كبير الآن");
      if (!reasons.length) reasons.push("لاكتشاف محتوى جديد خارج دائرتك");
    }
    const ownFresh = p.author === me && ageH < 0.5 ? 50 : 0;
    return ownFresh + interest + relationship + freshness + quality + engagement - negative;
  },
  // Diversity: avoid consecutive same author/topic
  diversify(list) {
    const out = [], pool = [...list];
    while (pool.length) {
      const last = out[out.length - 1];
      let i = pool.findIndex(p => !last || (p.author !== last.author && p.topic !== last.topic));
      if (i < 0) i = 0;
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  },
  build(mode) {
    const posts = S.visiblePosts().filter(p => !p.community || S.community(p.community)?.type === "public" || S.membership(p.community));
    if (mode === "following") return posts.filter(p => S.follows(DB.me, p.author) || p.author === DB.me).sort(byNew);
    if (mode === "latest") return posts.filter(p => !DB.muted.posts.includes(p.id)).sort(byNew);
    if (mode === "discover") return Feed.diversify(posts.filter(p => p.author !== DB.me && !S.follows(DB.me, p.author) && !DB.interests.includes(p.topic) && !DB.muted.posts.includes(p.id)).sort((a, b) => Feed.score(b) - Feed.score(a)));
    if (mode.startsWith("list:")) { const l = DB.lists.find(x => "list:" + x.id === mode); return l ? posts.filter(p => l.members.includes(p.author)).sort(byNew) : []; }
    if (mode === "communities") return posts.filter(p => p.community && S.membership(p.community)).sort(byNew);
    const scored = posts.map(p => ({ p, s: Feed.score(p) })).filter(x => x.s > -50).sort((a, b) => b.s - a.s).map(x => x.p);
    return Feed.diversify(scored);
  },
  why(p) { const r = []; Feed.score(p, r); return r; }
};
const byNew = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

const Trends = {
  // Measures velocity + unique users + engagement, not raw counts (resists single-user spam)
  list(limit = 8) {
    const map = {};
    S.visiblePosts().forEach(p => S.hashtags(p.text).forEach(t => {
      const m = (map[t] ||= { tag: t, users: new Set(), recent: 0, eng: 0, posts: 0 });
      m.users.add(p.author); m.posts++; (m.per ||= {})[p.author] = (m.per[p.author] || 0) + 1;
      const ageH = (Date.now() - new Date(p.createdAt)) / 3600e3;
      if (ageH < 24) m.recent++;
      m.eng += S.reactionsOf(p.id).length + S.commentsOf(p.id).length;
    }));
    // manipulation guard: a tag dominated (>80%) by one account is heavily down-weighted
    return Object.values(map).map(m => { const dom = Math.max(...Object.values(m.per)) / m.posts; return { ...m, unique: m.users.size, score: (m.users.size * 3 + m.recent * 2 + Math.log2(1 + m.eng)) * (dom > 0.8 && m.posts > 3 ? 0.3 : 1) }; }).sort((a, b) => b.score - a.score).slice(0, limit);
  }
};

const Search = {
  run(q) {
    q = q.trim().toLowerCase(); if (!q) return null;
    const words = q.replace(/[#@]/g, "").split(/\s+/).filter(w => w.length > 1);
    const hit = (s) => { s = (s || "").toLowerCase(); return words.some(w => s.includes(w) || s.includes(w.replace(/^ال/, ""))); };
    const intentCommunities = /مجتمع|مجتمعات|community/.test(q);
    const intentPeople = /أشخاص|حسابات|مطور|people/.test(q);
    const topicMatch = TOPICS.filter(t => hit(t.name) || words.some(w => t.name.includes(w.replace(/^ال/, ""))));
    const res = {
      users: DB.users.filter(u => u.id !== DB.me && (hit(u.name) || hit(u.handle) || hit(u.bio) || u.topics.some(t => topicMatch.find(x => x.slug === t)))),
      communities: DB.communities.filter(c => hit(c.name) || hit(c.desc) || topicMatch.find(t => t.slug === c.topic)),
      topics: topicMatch,
      posts: S.visiblePosts().filter(p => hit(p.text) || hit(p.title) || topicMatch.find(t => t.slug === p.topic)).slice(0, 20)
    };
    res.order = intentCommunities ? ["communities", "users", "topics", "posts"] : intentPeople ? ["users", "communities", "topics", "posts"] : ["posts", "users", "communities", "topics"];
    return res;
  }
};

/* AI-lite (local heuristics; swap for an AI service later) */
const AI = {
  summarize(comments) {
    if (!comments.length) return "لا توجد تعليقات بعد.";
    const ranked = [...comments].sort((a, b) => S.reactionsOf(b.id).length - S.reactionsOf(a.id).length);
    const freq = {}; comments.forEach(c => c.text.split(/\s+/).filter(w => w.length > 3).forEach(w => freq[w] = (freq[w] || 0) + 1));
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
    const qs = comments.filter(c => c.text.includes("؟") || c.text.includes("?")).length;
    return `عدد المشاركين: ${new Set(comments.map(c => c.author)).size}\nأبرز رأي: «${ranked[0].text}»\nكلمات متكررة: ${top.join("، ") || "—"}\nأسئلة مطروحة: ${qs}`;
  },
  hashtags(text) { const t = TOPICS.filter(x => text.includes(x.name.replace(/^ال/, "").slice(0, 4))); return t.map(x => "#" + x.name.replace(/\s/g, "_")).slice(0, 3); },
  shorten(text) { const s = text.split(/(?<=[.!؟?\n])/); return s.length > 2 ? s.slice(0, Math.ceil(s.length / 2)).join("").trim() : text; }
};
