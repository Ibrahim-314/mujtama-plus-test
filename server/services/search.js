/* Search service (Phase 22) — pluggable engine.
 * • Built-in engine (default): an Arabic-normalised inverted-ish index in `search_docs` (one row per post,
 *   person, community; body = normalised, prefix-stemmed tokens) + a term dictionary `search_terms`
 *   (document frequencies) that powers typeahead and spelling correction. PostgreSQL gets pg_trgm GIN
 *   indexes on both (migration 009).
 * • Meilisearch adapter (lib/meili.js) when MEILI_URL is set; the built-in index is still maintained and
 *   used as an automatic fallback if Meilisearch is unreachable.
 * • Filters: type (people/posts/communities/hashtags + post type), date (day/week/month/year or from/to),
 *   community, language. Results are grouped with per-group totals.
 * • History, saved searches with alerts (scheduled every 10 min, leased), trending suggestions. */
const { E, str, oneOf, id, now, TOPICS, canonTag, normalizeTag } = require("../lib/core");
const A = require("../lib/arabic");
const { createMeili } = require("../lib/meili");
const PTYPES = ["post", "article", "question", "poll", "discussion", "video", "audio", "event"];
const GROUPS = ["people", "posts", "communities", "hashtags"];
const RT = require("../../richtext.js");
const AN = require("../lib/search-analyzer"), LEX = require("../lib/search-lexicon");
const IV = 4; // search_docs index version (083_search_v2; 3 = v2.122 article bodies + poll options)
const DATES = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 };

module.exports = (ctx) => {
  const { db, bus } = ctx;
  const content = () => ctx.services.content;
  const meili = process.env.MEILI_URL ? createMeili({ url: process.env.MEILI_URL, key: require("../lib/secrets").secret("MEILI_KEY") }) : null;
  const like = (s) => s.replace(/[%_\\]/g, "");

  /* ---------- built-in index ---------- */
  async function bumpTerms(oldBody, newBody, raw = "") {
    const o = new Set((oldBody || "").trim().split(" ").filter(Boolean)), n = new Set((newBody || "").trim().split(" ").filter(Boolean)), surf = A.surfaces(raw);
    for (const t of n) if (!o.has(t) && t.length > 1 && t.length <= 40) await db.run("INSERT INTO search_terms(term, df, display) VALUES($1, 1, $2) ON CONFLICT (term) DO UPDATE SET df = search_terms.df + 1, display = COALESCE(search_terms.display, $2)", [t, (surf.get(t) || t).slice(0, 60)]);
    for (const t of o) if (!n.has(t)) await db.run("UPDATE search_terms SET df = df - 1 WHERE term=$1", [t]);
  }
  /* ---------- v2.123 inverted index (search_postings / search_vocab) ---------- */
  async function vocabDelta(add, del) {
    for (const t of add) await db.run("INSERT INTO search_vocab(term, df, len) VALUES($1, 1, $2) ON CONFLICT (term) DO UPDATE SET df = search_vocab.df + 1", [t, t.length]);
    for (const t of del) await db.run("UPDATE search_vocab SET df = df - 1 WHERE term=$1 AND df > 0", [t]);
  }
  async function dropPostings(kind, ref) {
    const old = (await db.all("SELECT DISTINCT term FROM search_postings WHERE kind=$1 AND ref_id=$2", [kind, ref])).map((r) => r.term);
    if (!old.length) return;
    await db.run("DELETE FROM search_postings WHERE kind=$1 AND ref_id=$2", [kind, ref]);
    await vocabDelta([], old);
  }
  async function writePostings(doc) {
    const fields = [AN.analyze(doc.title || ""), AN.analyze(doc.body || ""), AN.analyze(doc.extra || "", { max: 3000 })];
    const rows = []; const terms = new Set();
    fields.forEach((fa, f) => { for (const [t, e] of fa.terms) { rows.push([t, f, e.tf]); terms.add(t); } });
    const old = new Set((await db.all("SELECT DISTINCT term FROM search_postings WHERE kind=$1 AND ref_id=$2", [doc.kind, doc.id])).map((r) => r.term));
    await db.run("DELETE FROM search_postings WHERE kind=$1 AND ref_id=$2", [doc.kind, doc.id]);
    for (let i = 0; i < rows.length; i += 150) {
      const part = rows.slice(i, i + 150), p = [doc.kind, doc.id];
      const vals = part.map(([t, f, tf]) => { p.push(t, f, tf); return `($${p.length - 2},$1,$2,$${p.length - 1},$${p.length})`; });
      await db.run(`INSERT INTO search_postings(term,kind,ref_id,f,tf) VALUES ${vals.join(",")} ON CONFLICT (term,kind,ref_id,f) DO UPDATE SET tf=excluded.tf`, p);
    }
    await vocabDelta([...terms].filter((t) => !old.has(t)), [...old].filter((t) => !terms.has(t)));
    await db.run("UPDATE search_docs SET len=$1 WHERE kind=$2 AND ref_id=$3", [fields[0].len + fields[1].len, doc.kind, doc.id]);
  }
  async function indexDoc(doc) {
    const body = A.indexText(`${doc.title || ""} ${doc.body || ""}`);
    const old = await db.get("SELECT body FROM search_docs WHERE kind=$1 AND ref_id=$2", [doc.kind, doc.id]);
    const extra = doc.extra ? A.indexText(doc.extra) : null;
    await db.run(`INSERT INTO search_docs(kind,ref_id,title,body,ptype,community,lang,author,visibility,created_at,extra,quality,iv) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (kind, ref_id) DO UPDATE SET title=$3, body=$4, ptype=$5, community=$6, lang=$7, author=$8, visibility=$9, extra=$11, quality=$12, iv=$13`,
    [doc.kind, doc.id, doc.title || null, body, doc.ptype || null, doc.community || null, doc.lang || A.detectLang(doc.body || doc.title || "") || null, doc.author || null, doc.visibility || "public", doc.created_at || now(), extra, Number(doc.quality) || 0, IV]);
    await bumpTerms(old?.body, body, `${doc.title || ""} ${doc.body || ""}`);
    await writePostings(doc);
    if (meili) meili.index(doc).catch(e => ctx.jobsState && (ctx.jobsState.meili = { ok: false, error: e.message }));
  }
  async function removeDoc(kind, ref) {
    const old = await db.get("SELECT body FROM search_docs WHERE kind=$1 AND ref_id=$2", [kind, ref]); if (!old) return;
    await db.run("DELETE FROM search_docs WHERE kind=$1 AND ref_id=$2", [kind, ref]); await bumpTerms(old.body, "");
    await dropPostings(kind, ref);
    if (meili) meili.remove(kind, ref).catch(() => { });
  }
  /* v2.122: the searchable text of a post = its text + the article body (data.doc, rich text) + poll options, de-duplicated.
   * A paid post's body is hidden from non-buyers, so only its public text is indexed. */
  function bodyOf(p) {
    const parts = [p.text || ""];
    let d = null; try { d = typeof p.data === "string" ? JSON.parse(p.data) : (p.data || null); } catch { d = null; }
    if (d && !d.paid) {
      try { if (d.doc) parts.push(RT.toText(d.doc)); } catch { /* malformed doc */ }
      for (const o of (d.poll && Array.isArray(d.poll.options) ? d.poll.options : [])) parts.push(typeof o === "string" ? o : (o?.text || o?.label || ""));
    }
    const seen = new Set(), out = [];
    for (const t of parts.map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean)) if (!seen.has(t)) { seen.add(t); out.push(t); }
    return out.join(" \n ").slice(0, 20000);
  }
  const postDoc = (p, x = {}) => ({ kind: "post", id: p.id, title: p.title, body: bodyOf(p), ptype: p.type, community: p.community, lang: p.lang, author: p.author, visibility: p.visibility, created_at: p.created_at, ...x });
  /* v2.121: a post's document also carries its published comments (answers to a question live there; matched at half weight)
   * and an engagement score log(1 + reactions + 2·comments) used as a small ranking signal. */
  async function postExtras(pid) {
    const cs = await db.all("SELECT text FROM comments WHERE post=$1 AND status='published' ORDER BY created_at DESC LIMIT 40", [pid]);
    const rx = Number((await db.get("SELECT COUNT(*) n FROM reactions WHERE target=$1", [pid]))?.n) || 0;
    return { extra: cs.map(c => c.text || "").join(" ").slice(0, 4000) || null, quality: Math.round(Math.log1p(rx + 2 * cs.length) * 100) / 100 };
  }
  async function indexPost(pid) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!p || p.status !== "published" || p.type === "story" || p.sponsored) return removeDoc("post", pid);
    return indexDoc(postDoc(p, await postExtras(pid)));
  }
  const indexUser = (u) => indexDoc({ kind: "user", id: u.id, title: u.name, body: `${u.handle} ${u.bio || ""} ${u.location || ""}`, created_at: u.created_at });
  const indexCommunity = (c) => indexDoc({ kind: "community", id: c.id, title: c.name, body: `${c.descr || ""} ${c.location || ""}`, community: c.id, visibility: c.type, created_at: c.created_at });
  async function reindexAll() {
    let n = 0;
    for (const u of await db.all("SELECT id, name, handle, bio, location, created_at FROM users WHERE status='active'")) { await indexUser(u); n++; }
    for (const c of await db.all("SELECT * FROM communities")) { await indexCommunity(c); n++; }
    for (const p of await db.all("SELECT * FROM posts WHERE status='published' AND type<>'story' AND sponsored=0 ORDER BY created_at DESC LIMIT 20000")) { await indexDoc(postDoc(p, await postExtras(p.id))); n++; }
    return n;
  }
  bus.on("POST_CREATED", e => indexPost(e.post.id).catch(() => { }));
  bus.on("POST_PUBLISHED", e => indexPost(e.post.id).catch(() => { }));
  bus.on("POST_UPDATED", e => indexPost(e.post).catch(() => { }));
  bus.on("POST_APPROVED", e => indexPost(e.post).catch(() => { }));
  bus.on("POST_DELETED", e => removeDoc("post", e.post).catch(() => { }));
  bus.on("COMMENT_CREATED", e => e.post && indexPost(e.post).catch(() => { }));
  bus.on("CONTENT_REMOVED", e => e.post && removeDoc("post", e.post).catch(() => { }));
  bus.on("USER_REGISTERED", async e => { const u = await db.get("SELECT * FROM users WHERE id=$1", [e.user]); if (u) await indexUser(u); });
  bus.on("COMMUNITY_CREATED", async e => { const c = await db.get("SELECT * FROM communities WHERE id=$1", [e.community]); if (c) await indexCommunity(c); });
  // profile/community edits emit no event: a leased job re-syncs people & communities (cheap) and backfills
  ctx.scheduler.every("searchSync", 15 * 60e3, async () => {
    const empty = !(await db.get("SELECT 1 x FROM search_docs LIMIT 1"));
    if (empty) return reindexAll();
    for (const u of await db.all("SELECT id, name, handle, bio, location, created_at FROM users WHERE status='active'")) await indexUser(u);
    for (const c of await db.all("SELECT * FROM communities")) await indexCommunity(c);
  });
  /* v2.121 background upgrade: rows indexed before v2 (iv < 2) are re-indexed in small batches — no blocking reindex on boot.
   * The same job refreshes the engagement score of last week's posts. */
  /* v2.122 coverage reconciler — the root cause of «no answer» on Render: posts written without an event (demo seed, imports,
   * restores, direct SQL) never entered the index, and reindexAll() only ran on an EMPTY index. Every run now indexes published
   * posts that have no document and drops documents whose post is gone or no longer published. Batched, idempotent. */
  async function reconcile(batch = 500) {
    const missing = await db.all(`SELECT p.id FROM posts p LEFT JOIN search_docs d ON d.kind='post' AND d.ref_id=p.id
      WHERE d.ref_id IS NULL AND p.status='published' AND p.type<>'story' AND (p.sponsored IS NULL OR p.sponsored=0) ORDER BY p.created_at DESC LIMIT ${batch}`);
    for (const r of missing) await indexPost(r.id).catch(() => { });
    const orphans = await db.all(`SELECT d.ref_id FROM search_docs d LEFT JOIN posts p ON p.id=d.ref_id
      WHERE d.kind='post' AND (p.id IS NULL OR p.status<>'published' OR p.type='story') LIMIT ${batch}`);
    for (const r of orphans) await removeDoc("post", r.ref_id).catch(() => { });
    return { added: missing.length, removed: orphans.length };
  }
  async function coverage() {
    const n = async (sql) => Number((await db.get(sql))?.n) || 0;
    const posts = await n("SELECT COUNT(*) n FROM posts WHERE status='published' AND type<>'story' AND (sponsored IS NULL OR sponsored=0)");
    const docs = await n("SELECT COUNT(*) n FROM search_docs WHERE kind='post'");
    const current = await n(`SELECT COUNT(*) n FROM search_docs WHERE kind='post' AND iv >= ${IV}`);
    return { posts, docs, current, iv: IV, ratio: posts ? Math.round((Math.min(docs, posts) / posts) * 1000) / 1000 : 1 };
  }
  async function upgradeIndex(batch = 300) {
    const rec = await reconcile();
    const old = await db.all("SELECT ref_id FROM search_docs WHERE kind='post' AND iv < $1 LIMIT " + batch, [IV]);
    for (const r of old) await indexPost(r.ref_id).catch(() => { });
    for (const r of await db.all("SELECT kind, ref_id FROM search_docs WHERE kind IN ('user','community') AND iv < $1 LIMIT " + batch, [IV])) {
      if (r.kind === "user") { const u = await db.get("SELECT id, name, handle, bio, location, created_at FROM users WHERE id=$1", [r.ref_id]); if (u) await indexUser(u).catch(() => { }); else await removeDoc("user", r.ref_id); }
      else { const c = await db.get("SELECT * FROM communities WHERE id=$1", [r.ref_id]); if (c) await indexCommunity(c).catch(() => { }); else await removeDoc("community", r.ref_id); }
    }
    const recent = await db.all("SELECT ref_id FROM search_docs WHERE kind='post' AND created_at > $1 ORDER BY created_at DESC LIMIT 400", [new Date(Date.now() - 7 * 864e5).toISOString()]);
    for (const r of recent) { const x = await postExtras(r.ref_id); await db.run("UPDATE search_docs SET quality=$1 WHERE kind='post' AND ref_id=$2", [x.quality, r.ref_id]); }
    return { upgraded: old.length, refreshed: recent.length, ...rec };
  }
  ctx.scheduler.every("searchUpgrade", 5 * 60e3, () => upgradeIndex());
  if (!process.env.NODE_TEST_CONTEXT) setTimeout(() => upgradeIndex().catch(() => { }), 20e3).unref?.(); // first pass shortly after boot

  /* ---------- spelling correction ---------- */
  async function correctToken(t) {
    if (t.length < 3 || /\d/.test(t)) return null;
    const hit = await db.get("SELECT df FROM search_terms WHERE term=$1 AND df > 0", [t]); if (hit) return null;
    const max = t.length <= 4 ? 1 : 2;
    const cands = await db.all("SELECT term, df, display FROM search_terms WHERE df > 0 AND LENGTH(term) BETWEEN $1 AND $2 AND (SUBSTR(term,1,1)=$3 OR SUBSTR(term,2,1)=$4 OR SUBSTR(term,LENGTH(term),1)=$5) ORDER BY df DESC LIMIT 3000",
      [t.length - max, t.length + max, t[0], t[1], t[t.length - 1]]);
    let best = null;
    for (const c of cands) { const d = A.distance(t, c.term, max); if (d <= max && (!best || d < best.d || (d === best.d && c.df > best.df))) best = { term: c.display || c.term, d, df: c.df }; }
    return best?.term || null;
  }
  async function correct(q) {
    // v2.121: keep the reader's own words; only a word that is unknown in every variant («بجده» is fine: جده is known) is replaced
    let changed = false; const out = [];
    for (const w of String(q).trim().split(/\s+/).slice(0, 12)) {
      const t = A.tokens(w)[0];
      if (!t || A.QSTOP.has(t)) { out.push(w); continue; }
      const vs = variants(t).filter(v => v !== t);
      const known = vs.length && await db.get(`SELECT 1 x FROM search_terms WHERE df > 0 AND term IN (${vs.map((_, i) => "$" + (i + 1)).join(",")})`, vs);
      const c = known ? null : await correctToken(t);
      if (c) { changed = true; out.push(c); } else out.push(w);
    }
    return changed ? out.join(" ") : null;
  }

  /* ---------- query ---------- */
  function parseFilters(qs = {}) {
    const f = { type: oneOf(qs.type, ["all", ...GROUPS], "all"), ptype: oneOf(qs.ptype, PTYPES, null), community: str(qs.community, 80), lang: oneOf(qs.lang, ["ar", "en"], null), date: oneOf(qs.date, Object.keys(DATES), null), from: null, to: null };
    if (f.date) f.from = new Date(Date.now() - DATES[f.date]).toISOString();
    if (qs.from && !isNaN(Date.parse(qs.from))) f.from = new Date(qs.from).toISOString();
    if (qs.to && !isNaN(Date.parse(qs.to))) f.to = new Date(qs.to).toISOString();
    return f;
  }
  /* v2.121 ranking. A query becomes CONCEPTS (a word and its variants: «بجده» → جده, «محمصات» → محمص; the AI query plan can add
   * synonyms). Candidates match any variant in the post (body) or its comments (extra); each concept is scored BM25-style with
   * idf from search_terms, comment hits at half weight, title hits boosted, plus freshness and engagement. Coverage: with one or
   * two concepts every concept must match (the old AND behaviour); with three or more, 60% of them — natural questions carry
   * words nobody wrote. */
  function concepts(q, plan) {
    if (plan?.concepts?.length) return plan.concepts.slice(0, 6);
    return A.queryTokens(q).slice(0, 6).map(variants);
  }
  function variants(t) {
    const v = new Set([t]);
    if (/^[وبلكف]/.test(t) && t.length >= 4) v.add(A.stem(t.slice(1)));
    if (/^(وب|ول|فب|فل|وك)/.test(t) && t.length >= 5) v.add(A.stem(t.slice(2)));
    for (const w of [...v]) { // plural / feminine endings → the stem, as a prefix («محمصات», «محمصه» → محمص); never below 3 letters
      if (/(ات|ين|ون|يه)$/.test(w) && w.length >= 5) v.add(w.slice(0, -2));
      else if (/[هي]$/.test(w) && w.length >= 5) v.add(w.slice(0, -1));
    }
    return [...v].filter(x => x.length > 1);
  }
  let NCACHE = { at: 0, n: 1, avg: 12 };
  async function corpus() {
    if (Date.now() - NCACHE.at < 10 * 60e3) return NCACHE;
    const r = await db.read.get("SELECT COUNT(*) n, AVG(LENGTH(body)) l FROM search_docs");
    return (NCACHE = { at: Date.now(), n: Math.max(1, Number(r?.n) || 1), avg: Math.max(1, (Number(r?.l) || 60) / 6) });
  }
  const count = (hay, needle) => { if (!hay) return 0; let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; };
  async function builtinIds(q, kinds, f, limit = 200) {
    const cs = concepts(q, f._plan); if (!cs.length) return [];
    const all = [...new Set(cs.flat())].slice(0, 16);
    const where = ["kind IN (" + kinds.map((_, i) => "$" + (i + 1)).join(",") + ")"], p = [...kinds], ors = [];
    for (const t of all) { p.push("% " + like(t) + "%"); ors.push(`body LIKE $${p.length} OR extra LIKE $${p.length}`); }
    where.push("(" + ors.join(" OR ") + ")");
    if (f.ptype) { p.push(f.ptype); where.push(`(kind<>'post' OR ptype=$${p.length})`); }
    if (f.community) { p.push(f.community); where.push(`(kind='user' OR community=$${p.length})`); }
    if (f.lang) { p.push(f.lang); where.push(`(kind<>'post' OR lang=$${p.length})`); }
    if (f.from) { p.push(f.from); where.push(`(kind<>'post' OR created_at >= $${p.length})`); }
    if (f.to) { p.push(f.to); where.push(`(kind<>'post' OR created_at <= $${p.length})`); }
    const rows = await db.read.all(`SELECT kind, ref_id, title, body, extra, quality, created_at FROM search_docs WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${Math.max(limit, 600)}`, p);
    if (!rows.length) return [];
    const { n: N, avg } = await corpus();
    const dfs = Object.fromEntries((await db.read.all(`SELECT term, df FROM search_terms WHERE term IN (${all.map((_, i) => "$" + (i + 1)).join(",")})`, all)).map(r => [r.term, Number(r.df) || 0]));
    const idf = (t) => { const df = Math.min(N, dfs[t] || 1); return Math.log(1 + (N - df + 0.5) / (df + 0.5)); };
    const need = cs.length <= 2 ? cs.length : Math.ceil(cs.length * 0.6), k1 = 1.2, b = 0.6;
    const out = [];
    for (const r of rows) {
      const len = r.body.length / 6, ti = r.title ? A.indexText(r.title) : "";
      let s = 0, cov = 0;
      for (const c of cs) {
        let best = 0;
        for (const t of c) {
          const nd = " " + t, tf = count(r.body, nd) + 0.5 * count(r.extra, nd); if (!tf) continue;
          const w = idf(t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * len / avg)) * (t === c[0] ? 1 : 0.8) + (ti.includes(nd) ? idf(t) * 0.8 : 0) + (count(r.body, nd + " ") ? 0.15 : 0);
          if (w > best) best = w;
        }
        if (best) { s += best; cov++; }
      }
      if (cov < need) continue;
      if (r.kind === "post") s += 1.5 / (1 + (Date.now() - Date.parse(r.created_at)) / (7 * 864e5)) + 0.3 * (Number(r.quality) || 0);
      out.push({ kind: r.kind, id: r.ref_id, s: s * (cov / cs.length) });
    }
    return out.sort((a, b2) => b2.s - a.s).slice(0, limit);
  }
  async function engineIds(q, kinds, f) {
    if (meili && !f._plan) {
      try { return { engine: "meilisearch", ids: await meili.search(q, { kinds, ptype: f.ptype, community: f.community, lang: f.lang, from: f.from, to: f.to, limit: 200 }) }; }
      catch (e) { ctx.jobsState.meili = { ok: false, error: e.message, lastRun: now() }; }
    }
    return { engine: "builtin", ids: await builtinIds(q, kinds, f) };
  }
  async function run(viewer, q, f, { limit = 20 } = {}) {
    const want = f.type === "all" ? GROUPS : [f.type];
    const kinds = want.map(g => ({ people: "user", posts: "post", communities: "community" }[g])).filter(Boolean);
    const { engine, ids } = kinds.length ? await engineIds(q, kinds, f) : { engine: meili ? "meilisearch" : "builtin", ids: [] };
    const of = (k) => ids.filter(x => x.kind === k).map(x => x.id);
    const fetchRows = async (table, list) => { if (!list.length) return []; const rows = await db.read.all(`SELECT * FROM ${table} WHERE id IN (${list.map((_, i) => "$" + (i + 1)).join(",")})`, list); const m = new Map(rows.map(r => [r.id, r])); return list.map(i => m.get(i)).filter(Boolean); };
    const out = { engine, groups: {} };
    if (want.includes("people")) { const rows = (await fetchRows("users", of("user").slice(0, 100))).filter(u => u.status === "active" && !((viewer?.prefs?.blocked) || []).includes(u.id)); out.groups.people = { total: rows.length, items: rows.slice(0, limit).map(ctx.services.users.pub) }; }
    if (want.includes("posts")) { const rows = await content().filterVisible(await fetchRows("posts", of("post").slice(0, 200)), viewer?.id); out.groups.posts = { total: rows.length, items: rows.slice(0, limit).map(p => content().toClient(p, viewer?.id)) }; out.users = await ctx.services.ranking.authors(out.groups.posts.items); }
    if (want.includes("communities")) { const rows = (await fetchRows("communities", of("community").slice(0, 100))).filter(c => c.type !== "invite"); out.groups.communities = { total: rows.length, items: rows.slice(0, limit).map(ctx.services.communities.toClient) }; }
    if (want.includes("hashtags")) { // tags are stored canonical but not normalised: compare in normalised space
      const toks = A.tokens(q);
      const rows = toks.length ? await db.read.all("SELECT tag, COUNT(*) n FROM post_hashtags WHERE created_at > $1 GROUP BY tag ORDER BY n DESC LIMIT 500", [new Date(Date.now() - 180 * 864e5).toISOString()]) : [];
      const hits = rows.filter(r => { const nt = A.tokens(r.tag.replace(/_/g, " ")); return toks.every(t => nt.some(x => x.startsWith(t) || (t.length > 3 && x.startsWith(t.slice(0, -1))))); });
      out.groups.hashtags = { total: hits.length, items: hits.slice(0, 12).map(r => ({ tag: r.tag, posts: r.n })) };
    }
    out.topics = TOPICS.filter(t => A.tokens(t.name).some(x => A.tokens(q).some(y => x.startsWith(y) || y.startsWith(x))) || t.slug === q.toLowerCase());
    out.total = Object.values(out.groups).reduce((a, g) => a + g.total, 0);
    return out;
  }
  async function search(viewer, qs) {
    const q = str(qs.q, 120, { required: true }), f = parseFilters(qs);
    let res = await run(viewer, q, f), corrected = null, didYouMean = null;
    if (res.total < 3 && qs.exact !== "1") { // spelling correction: auto-apply when nothing matched, otherwise suggest (exact=1 opts out)
      const c = await correct(q);
      if (c && A.normalize(c) !== A.normalize(q)) {
        if (res.total === 0) { const r2 = await run(viewer, c, f); if (r2.total) { res = r2; corrected = c; } else didYouMean = c; }
        else didYouMean = c;
      }
    }
    if (viewer) {
      await db.run("DELETE FROM search_history WHERE user_id=$1 AND q=$2", [viewer.id, q]);
      await db.run("INSERT INTO search_history(id,user_id,q,at) VALUES($1,$2,$3,$4)", [id("sh"), viewer.id, q, now()]);
      const old = await db.all("SELECT id FROM search_history WHERE user_id=$1 ORDER BY at DESC LIMIT 100 OFFSET 30", [viewer.id]);
      for (const o of old) await db.run("DELETE FROM search_history WHERE id=$1", [o.id]);
    }
    ctx.track(viewer?.id, "search_performed", { q, engine: res.engine });
    return { q, normalized: A.normalize(q), corrected, didYouMean, filters: f, ...res };
  }

  /* ---------- typeahead ---------- */
  async function suggest(viewer, qRaw) {
    const q = String(qRaw || "").slice(0, 60), n = A.normalize(q).replace(/^[#@]/, ""), last = A.tokens(q).pop() || n;
    if (!n) return { q, terms: [], people: [], hashtags: [], communities: [], history: viewer ? (await history(viewer.id)).slice(0, 6) : [] };
    const head = A.tokens(q).slice(0, -1).join(" ");
    const headRaw = q.trim().split(/\s+/).slice(0, -1).join(" ");
    const terms = (await db.read.all("SELECT term, df, display FROM search_terms WHERE term LIKE $1 AND df > 0 ORDER BY df DESC, term LIMIT 6", [like(last) + "%"])).map(t => (head ? headRaw + " " : "") + (t.display || t.term));
    const pre = like(n) + "%";
    let people = await db.read.all("SELECT * FROM users WHERE status='active' AND (LOWER(handle) LIKE $1 OR LOWER(name) LIKE $1 OR LOWER(name) LIKE $2) ORDER BY reputation DESC LIMIT 4", [pre, "% " + pre]);
    if (!people.length) people = await db.read.all("SELECT u.* FROM users u JOIN search_docs d ON d.ref_id=u.id AND d.kind='user' WHERE u.status='active' AND d.body LIKE $1 LIMIT 4", ["% " + like(last) + "%"]);
    const tags = await db.read.all("SELECT tag, COUNT(*) n FROM post_hashtags WHERE tag LIKE $1 GROUP BY tag ORDER BY n DESC LIMIT 4", [like(canonTag(normalizeTag(q.replace(/\s+/g, "_")))) + "%"]);
    const comms = await db.read.all("SELECT c.* FROM communities c JOIN search_docs d ON d.ref_id=c.id AND d.kind='community' WHERE d.body LIKE $1 LIMIT 3", ["% " + like(last) + "%"]);
    const mine = viewer ? (await db.read.all("SELECT q FROM search_history WHERE user_id=$1 ORDER BY at DESC LIMIT 20", [viewer.id])).filter(h => A.normalize(h.q).startsWith(n)).slice(0, 3).map(h => h.q) : [];
    const tagNorm = new Set(tags.map(t => A.normalize(t.tag)));
    return { q, terms: terms.filter(t => !tagNorm.has(A.normalize(t.split(" ").pop()))), history: mine, people: people.map(ctx.services.users.pub), hashtags: tags.map(t => ({ tag: t.tag, posts: t.n })), communities: comms.map(ctx.services.communities.toClient) };
  }

  /* ---------- history, saved searches, trending ---------- */
  async function history(uid) { return (await db.all("SELECT id, q, at FROM search_history WHERE user_id=$1 ORDER BY at DESC LIMIT 30", [uid])).map(h => ({ id: h.id, q: h.q, at: h.at })); }
  const savedClient = (s) => ({ id: s.id, q: s.q, filters: s.filters || {}, alert: !!s.alert, newCount: s.new_count, lastChecked: s.last_checked, createdAt: s.created_at });
  async function saveSearch(uid, b) {
    const q = str(b.q, 120, { required: true }), f = parseFilters(b.filters || {});
    const n = await db.get("SELECT COUNT(*) n FROM saved_searches WHERE user_id=$1", [uid]); if (n.n >= 25) throw E.bad("وصلت للحد الأقصى من عمليات البحث المحفوظة (25)");
    const filters = { type: f.type, ptype: f.ptype, community: f.community, lang: f.lang };
    const row = { id: id("ss"), q, filters, alert: b.alert === false ? 0 : 1, at: now() };
    await db.run("INSERT INTO saved_searches(id,user_id,q,filters,alert,last_checked,new_count,created_at) VALUES($1,$2,$3,$4,$5,$6,0,$6)", [row.id, uid, q, filters, row.alert, row.at]);
    return savedClient(await db.get("SELECT * FROM saved_searches WHERE id=$1", [row.id]));
  }
  /* alerts: count new matching posts since the last check, notify once per batch */
  async function checkAlerts() {
    const due = await db.all("SELECT s.*, u.prefs FROM saved_searches s JOIN users u ON u.id=s.user_id WHERE s.alert=1 AND s.last_checked < $1 LIMIT 500", [new Date(Date.now() - 60e3).toISOString()]);
    let notified = 0;
    for (const s of due) {
      const viewer = { id: s.user_id, prefs: s.prefs || {} };
      const f = { ...parseFilters(s.filters || {}), type: "posts", from: s.last_checked, to: null };
      const res = await run(viewer, s.q, f, { limit: 1 });
      const fresh = res.groups.posts ? res.groups.posts.total : 0;
      await db.run("UPDATE saved_searches SET last_checked=$1, new_count=new_count+$2 WHERE id=$3", [now(), fresh, s.id]);
      if (fresh > 0) { await ctx.services.messaging.notify(s.user_id, "search_alert", { ref: s.id }); notified++; }
    }
    return { checked: due.length, notified };
  }
  ctx.scheduler.every("savedSearchAlerts", 10 * 60e3, checkAlerts);
  async function trending(viewer) {
    const tr = ctx.services.trends ? await ctx.services.trends.list({ scope: "global" }) : { trends: [] };
    const popular = await db.read.all("SELECT q, COUNT(DISTINCT user_id) n FROM search_history WHERE at > $1 GROUP BY q ORDER BY n DESC, q LIMIT 8", [new Date(Date.now() - 7 * 864e5).toISOString()]);
    return { trends: tr.trends.slice(0, 8).map(t => ({ tag: t.tag, posts: t.posts, unique: t.unique })), popular: popular.map(p => p.q), topics: TOPICS, history: viewer ? (await history(viewer.id)).slice(0, 8) : [] };
  }

  const r = ctx.router, AU = ctx.requireUser;
  r.get("/api/search/full", async (req) => search(req.user, req.query));
  r.get("/api/search/suggest", async (req) => suggest(req.user, req.query.q));
  r.get("/api/search/trending", async (req) => trending(req.user));
  r.get("/api/search/history", AU(async (req) => ({ history: await history(req.user.id) })));
  r.del("/api/search/history", AU(async (req) => { await db.run("DELETE FROM search_history WHERE user_id=$1", [req.user.id]); return { ok: true }; }));
  r.del("/api/search/history/:id", AU(async (req) => { await db.run("DELETE FROM search_history WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); return { ok: true }; }));
  r.get("/api/search/saved", AU(async (req) => ({ saved: (await db.all("SELECT * FROM saved_searches WHERE user_id=$1 ORDER BY created_at DESC", [req.user.id])).map(savedClient) })));
  r.post("/api/search/saved", AU(async (req) => ({ saved: await saveSearch(req.user.id, req.body) })));
  r.patch("/api/search/saved/:id", AU(async (req) => { await db.run("UPDATE saved_searches SET alert=$1 WHERE id=$2 AND user_id=$3", [req.body.alert ? 1 : 0, req.params.id, req.user.id]); return { ok: true }; }));
  r.post("/api/search/saved/:id/seen", AU(async (req) => { await db.run("UPDATE saved_searches SET new_count=0 WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); return { ok: true }; }));
  r.del("/api/search/saved/:id", AU(async (req) => { await db.run("DELETE FROM saved_searches WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); return { ok: true }; }));
  r.get("/api/admin/search/coverage", AU(async (req) => { if (req.user.role !== "admin") throw E.forbid(); return coverage(); }));
  r.post("/api/admin/search/reindex", AU(async (req) => { if (req.user.role !== "admin") throw E.forbid(); return { indexed: await reindexAll() }; }));
  return { IV, search, run, parseFilters, concepts, variants, upgradeIndex, reconcile, coverage, bodyOf, suggest, correct, checkAlerts, reindexAll, indexPost, indexDoc, removeDoc, engineIds, engine: meili ? "meilisearch" : "builtin" };
};
