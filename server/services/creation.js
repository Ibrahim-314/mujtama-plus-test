/* Creation Service (Phases 11–13): synced drafts, writing assistant (hashtag suggestions and Arabic
 * spelling), reusable templates, stories, article series, paragraph comments, and server-rendered,
 * indexable article pages with sitemap and robots. */
const { E, str, id, now, Classifier, TOPICS } = require("../lib/core");
const RT = require("../../richtext.js");

/* Common Arabic misspellings → correction. Conservative on purpose: only unambiguous cases. */
const SPELLING = {
  "انشاء الله": "إن شاء الله", "إنشاء الله": "إن شاء الله", "انشالله": "إن شاء الله", "ان شاء الله": "إن شاء الله", "لاكن": "لكن", "لاكنه": "لكنه", "هاذا": "هذا", "هاذه": "هذه", "هاذي": "هذي",
  "ذالك": "ذلك", "اللذي": "الذي", "اللتي": "التي", "الذى": "الذي", "التى": "التي", "مسؤل": "مسؤول", "مسئول": "مسؤول", "مسؤلية": "مسؤولية", "شيئ": "شيء", "شي": "شيء", "إنشاالله": "إن شاء الله",
  "ماشاء الله": "ما شاء الله", "ماشالله": "ما شاء الله", "مشاءالله": "ما شاء الله", "إلي": "إلى", "علي الرغم": "على الرغم", "بالضبت": "بالضبط", "ضروف": "ظروف", "الضروف": "الظروف", "إظافة": "إضافة",
  "اظافة": "إضافة", "بالإظافة": "بالإضافة", "بالاظافة": "بالإضافة", "مبروووك": "مبروك", "إنشاؤه": "إنشاؤه", "لم يكون": "لم يكن", "أنشاء": "إنشاء", "إستخدام": "استخدام", "إستراتيجية": "استراتيجية",
  "إجتماع": "اجتماع", "إختيار": "اختيار", "إنتظار": "انتظار", "إستثمار": "استثمار", "إنتهاء": "انتهاء", "إقتصاد": "اقتصاد", "إبتكار": "ابتكار", "إحتياج": "احتياج", "إنطلاق": "انطلاق", "إستفادة": "استفادة",
  "أستخدام": "استخدام", "أختيار": "اختيار", "طبعن": "طبعاً", "اكيد": "أكيد", "ابدا": "أبداً", "ايضا": "أيضاً", "أيضا": "أيضاً", "جدا": "جداً", "شكرا": "شكراً", "عفوا": "عفواً", "تقريبا": "تقريباً", "دائما": "دائماً"
};
const TOPIC_TAGS = { ai: ["الذكاء_الاصطناعي", "AI"], dev: ["برمجة", "تطوير"], startups: ["شركات_ناشئة", "ريادة_أعمال"], pi: ["PiNetwork", "Pi"], design: ["تصميم", "UX"], crypto: ["كريبتو", "بلوكتشين"], sports: ["رياضة"], tech: ["تقنية"] };
const norm = (s) => String(s).toLowerCase().replace(/[\u064B-\u065F\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

module.exports = (ctx) => {
  const { db, router: R, rl, config } = ctx; const A = ctx.requireUser;
  const content = () => ctx.services.content, users = () => ctx.services.users;

  /* ---------- Drafts synced across devices (last writer wins, with conflict detection) ---------- */
  R.get("/api/drafts", A(async (req) => ({ drafts: (await db.all("SELECT id, data, device, updated_at FROM drafts WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50", [req.user.id])).map(d => ({ id: d.id, data: d.data, device: d.device, updatedAt: d.updated_at })) })));
  /* v2.50 composer: the extra state a draft needs to reopen in the same editor (simple community editor or the creative one) */
  function draftExtra(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const id = (v) => (typeof v === "string" && /^[a-z]{1,4}_[a-z0-9]{4,32}$/i.test(v) ? v : undefined);
    const list = (v, n, len) => (Array.isArray(v) ? v.slice(0, n).map(t => String(t ?? "").slice(0, len)) : undefined);
    const o = { mode: ["community", "general"].includes(x.mode) ? x.mode : undefined, community: id(x.community), channel: id(x.channel), ctag: str(x.ctag, 40) || undefined,
      topic: str(x.topic, 40) || undefined, location: str(x.location, 80) || undefined, sensitive: x.sensitive === true || undefined, list: str(x.list, 40) || undefined, quoteOf: id(x.quoteOf),
      stances: list(x.stances, 5, 60), parts: list(x.parts, 10, 5000) };
    if (x.poll && typeof x.poll === "object") o.poll = { options: list(x.poll.options, 6, 100) || [], multi: !!x.poll.multi, hideResults: !!x.poll.hideResults, hours: [1, 24, 72, 168].includes(+x.poll.hours) ? +x.poll.hours : 24 };
    if (x.event && typeof x.event === "object") o.event = { name: str(x.event.name, 100) || "", startsAt: str(x.event.startsAt, 40) || "", place: str(x.event.place, 100) || "" };
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    return Object.keys(o).length ? o : null;
  }
  R.put("/api/drafts/:id", A(async (req) => {
    if (!/^dr_[a-z0-9]{6,24}$/i.test(req.params.id)) throw E.bad("معرف غير صالح");
    if (!rl.hit("draft", req.user.id)) throw E.rate();
    const data = req.body.data; if (!data || typeof data !== "object" || JSON.stringify(data).length > 200e3) throw E.bad("المسودة كبيرة جداً");
    const clean = { type: str(data.type, 20) || "post", title: str(data.title, 200) || "", markdown: String(data.markdown || "").slice(0, 60000), images: (Array.isArray(data.images) ? data.images : []).filter(m => /^\/media\/[\w.-]{6,100}$/.test(m)).slice(0, 10), alts: (Array.isArray(data.alts) ? data.alts : []).map(a => String(a).slice(0, 300)).slice(0, 10), visibility: str(data.visibility, 20) || "public", series: str(data.series, 40), publishAt: str(data.publishAt, 40) };
    const x = draftExtra(data.x); if (x) clean.x = x; // v2.50: editor mode, community, poll, … (whitelisted; drafts.data is JSON, no migration)
    const ex = await db.get("SELECT updated_at, device FROM drafts WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    const device = str(req.body.device, 40) || "web";
    if (ex && req.body.base && new Date(ex.updated_at) > new Date(req.body.base) && ex.device !== device) {
      const cur = await db.get("SELECT data, updated_at FROM drafts WHERE id=$1", [req.params.id]);
      throw Object.assign(E.conflict("عُدّلت هذه المسودة من جهاز آخر"), { code: "draft_conflict", details: { draft: { data: cur.data, updatedAt: cur.updated_at } } });
    }
    const at = now();
    if (ex) await db.run("UPDATE drafts SET data=$1, device=$2, updated_at=$3 WHERE id=$4", [clean, device, at, req.params.id]);
    else { const n = (await db.get("SELECT COUNT(*) n FROM drafts WHERE user_id=$1", [req.user.id])).n; if (n >= 50) throw E.bad("الحد الأقصى ٥٠ مسودة"); await db.run("INSERT INTO drafts(id,user_id,data,device,updated_at,created_at) VALUES($1,$2,$3,$4,$5,$5)", [req.params.id, req.user.id, clean, device, at]); }
    ctx.realtime.send(req.user.id, "draft", { id: req.params.id, updatedAt: at, device });
    return { id: req.params.id, updatedAt: at };
  }));
  R.del("/api/drafts/:id", A(async (req) => (await db.run("DELETE FROM drafts WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]), { ok: true })));

  /* ---------- Writing assistant ---------- */
  async function assist(text) {
    const n = norm(text), existing = new Set(Classifier.hashtags(text).map(norm));
    const popular = await ctx.cache.wrap("assist:tags", 5 * 60e3, () => db.all("SELECT tag, COUNT(*) n FROM post_hashtags WHERE created_at > $1 GROUP BY tag ORDER BY n DESC LIMIT 300", [new Date(Date.now() - 30 * 864e5).toISOString()]));
    const scored = new Map();
    for (const { tag, n: c } of popular) { const words = norm(tag).split("_").filter(w => w.length > 2); if (words.length && words.every(w => n.includes(w)) && !existing.has(norm(tag))) scored.set(tag, (scored.get(tag) || 0) + 2 + Math.log2(1 + Number(c))); }
    const topic = Classifier.topic(text); for (const t of TOPIC_TAGS[topic] || []) if (!existing.has(norm(t))) scored.set(t, (scored.get(t) || 0) + 1.5);
    const tags = [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
    const spelling = []; const seen = new Set();
    for (const [wrong, right] of Object.entries(SPELLING).sort((a, b) => b[0].length - a[0].length)) {
      const re = new RegExp(`(^|[\\s.,،؛:!؟?"'()«»])(${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[\\s.,،؛:!؟?"'()«»])`, "g"); let m;
      while ((m = re.exec(text))) { const at = m.index + m[1].length; if ([...seen].some(([s, e]) => at < e && at + wrong.length > s)) continue; seen.add([at, at + wrong.length]); spelling.push({ from: wrong, to: right, index: at }); }
    }
    for (const m of text.matchAll(/(\S)\1{3,}/g)) if (!/[0-9.!؟?]/.test(m[1])) spelling.push({ from: m[0], to: m[1].repeat(2), index: m.index, note: "تكرار حروف" });
    return { tags, spelling: spelling.sort((a, b) => a.index - b.index).slice(0, 30), topic, topicName: TOPICS.find(t => t.slug === topic)?.name || null, readingMin: RT.readingMinutes(RT.parse(text)) };
  }
  R.post("/api/compose/assist", A(async (req) => { if (!rl.hit("assist", req.user.id)) throw E.rate(); return assist(String(req.body.text || "").slice(0, 60000)); }));
  R.post("/api/compose/preview", A(async (req) => { const doc = RT.parse(String(req.body.markdown || "").slice(0, 60000)); return { doc, html: RT.toHTML(doc), text: RT.toText(doc), readingMin: RT.readingMinutes(doc), toc: RT.toc(doc) }; }));

  /* ---------- Templates ---------- */
  R.get("/api/templates", A(async (req) => ({ templates: (await db.all("SELECT id, name, data, uses, created_at FROM post_templates WHERE user_id=$1 ORDER BY uses DESC, created_at DESC", [req.user.id])).map(t => ({ ...t, data: t.data })) })));
  R.post("/api/templates", A(async (req) => {
    const name = str(req.body.name, 60, { required: true }); const d = req.body.data || {};
    if ((await db.get("SELECT COUNT(*) n FROM post_templates WHERE user_id=$1", [req.user.id])).n >= 30) throw E.bad("الحد الأقصى ٣٠ قالباً");
    const data = { type: str(d.type, 20) || "post", title: str(d.title, 200) || "", markdown: String(d.markdown || "").slice(0, 20000), visibility: str(d.visibility, 20) || "public" };
    const tid = id("tp"); await db.run("INSERT INTO post_templates(id,user_id,name,data,created_at) VALUES($1,$2,$3,$4,$5)", [tid, req.user.id, name, data, now()]);
    return { template: { id: tid, name, data, uses: 0 } };
  }));
  R.post("/api/templates/:id/use", A(async (req) => { const t = await db.get("SELECT * FROM post_templates WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); if (!t) throw E.nf(); await db.run("UPDATE post_templates SET uses=uses+1 WHERE id=$1", [t.id]); return { template: { id: t.id, name: t.name, data: t.data } }; }));
  R.del("/api/templates/:id", A(async (req) => (await db.run("DELETE FROM post_templates WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]), { ok: true })));

  /* ---------- Stories (24h) ---------- */
  R.get("/api/stories", A(async (req) => {
    const u = req.user;
    const rows = await db.all(`SELECT * FROM posts WHERE type='story' AND status='published' AND expires_at > $1 AND (author=$2 OR author IN (SELECT dst FROM follows WHERE src=$2)) ORDER BY created_at`, [now(), u.id]);
    const visible = await content().filterVisible(rows, u.id);
    const seen = new Set(visible.length ? (await db.all(`SELECT story FROM story_views WHERE user_id=$1 AND story IN (${visible.map((_, i) => "$" + (i + 2)).join(",")})`, [u.id, ...visible.map(p => p.id)])).map(r => r.story) : []);
    const groups = new Map();
    for (const p of visible) { if (!groups.has(p.author)) groups.set(p.author, []); groups.get(p.author).push({ ...content().toClient(p, u.id), seen: seen.has(p.id) || p.author === u.id }); }
    const authors = groups.size ? Object.fromEntries((await db.all(`SELECT * FROM users WHERE id IN (${[...groups.keys()].map((_, i) => "$" + (i + 1)).join(",")})`, [...groups.keys()])).map(x => [x.id, users().pub(x)])) : {};
    const list = [...groups.entries()].map(([a, items]) => ({ user: authors[a], items, allSeen: items.every(i => i.seen), latest: items[items.length - 1].createdAt }));
    list.sort((a, b) => (a.user.id === u.id ? -1 : b.user.id === u.id ? 1 : 0) || (a.allSeen - b.allSeen) || (b.latest > a.latest ? 1 : -1));
    return { stories: list };
  }));
  R.post("/api/stories/:id/view", A(async (req) => {
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND type='story'", [req.params.id]); if (!p || !(await content().canSee(p, req.user.id))) throw E.nf();
    if (p.author !== req.user.id) await db.run("INSERT INTO story_views(story,user_id,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, req.user.id, now()]);
    return { ok: true };
  }));
  R.get("/api/stories/:id/viewers", A(async (req) => {
    const p = await db.get("SELECT author FROM posts WHERE id=$1 AND type='story'", [req.params.id]); if (!p || p.author !== req.user.id) throw E.nf();
    return { viewers: (await db.all("SELECT u.id, u.name, u.handle, u.avatar, u.color, v.at FROM story_views v JOIN users u ON u.id=v.user_id WHERE v.story=$1 ORDER BY v.at DESC", [req.params.id])).map(x => ({ ...x })) };
  }));

  /* ---------- Series & paragraph comments ---------- */
  R.get("/api/series/:id", async (req) => {
    const rows = await db.all("SELECT * FROM posts WHERE series=$1 AND status='published' ORDER BY part", [req.params.id]);
    const vis = await content().filterVisible(rows, req.user?.id);
    return { parts: vis.map(p => ({ id: p.id, part: p.part, title: p.title || p.text.slice(0, 80), readingMin: p.data?.readingMin || null })) };
  });
  R.get("/api/posts/:id/paragraphs", async (req) => {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [req.params.id]); if (!(await content().canSee(p, req.user?.id))) throw E.nf();
    const rows = await db.all("SELECT anchor, COUNT(*) n FROM comments WHERE post=$1 AND anchor IS NOT NULL AND status='published' GROUP BY anchor", [p.id]);
    const anchor = req.query.anchor; const list = anchor ? await db.all("SELECT id, author, text, created_at AS \"createdAt\" FROM comments WHERE post=$1 AND anchor=$2 AND status='published' ORDER BY created_at", [p.id, anchor]) : undefined;
    return { counts: Object.fromEntries(rows.map(r => [r.anchor, Number(r.n)])), comments: list };
  });

  /* ---------- Server-rendered article pages (SEO) ---------- */
  const esc = RT.esc;
  const origin = (req) => process.env.PUBLIC_URL || `${config.trustProxy && req.headers["x-forwarded-proto"] ? req.headers["x-forwarded-proto"] : "http"}://${req.headers.host}`;
  const slugify = (t = "") => t.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60);
  const articleUrl = (p) => `/a/${p.id}${p.title ? "-" + encodeURIComponent(slugify(p.title)) : ""}`;
  async function publicArticle(pid) {
    const p = await db.get("SELECT p.*, u.name an, u.handle ah, u.private ap, u.avatar av FROM posts p JOIN users u ON u.id=p.author WHERE p.id=$1 AND p.type='article' AND p.status='published' AND p.visibility='public' AND u.status='active'", [pid]);
    return p && !p.ap && !p.community ? p : null;
  }
  function page(res, status, html, extra = {}) {
    res.writeHead(status, { ...require("../lib/http").SEC_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300, stale-while-revalidate=3600", ...extra });
    res.end(html);
  }
  async function ssr(req, res, url) {
    if (url.pathname === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }); res.end(`User-agent: *\nAllow: /a/\nDisallow: /api/\nDisallow: /media/pf-\nSitemap: ${origin(req)}/sitemap.xml\n`); return true; }
    if (url.pathname === "/sitemap.xml") {
      const rows = await db.all("SELECT p.id, p.title, p.updated_at, p.created_at FROM posts p JOIN users u ON u.id=p.author WHERE p.type='article' AND p.status='published' AND p.visibility='public' AND p.community IS NULL AND u.private=0 AND u.status='active' ORDER BY p.created_at DESC LIMIT 5000");
      const o = origin(req);
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map(p => `<url><loc>${esc(o + articleUrl(p))}</loc><lastmod>${new Date(p.updated_at || p.created_at).toISOString()}</lastmod></url>`).join("\n")}\n</urlset>\n`);
      return true;
    }
    const m = /^\/a\/([a-z]{1,3}_[a-z0-9]{6,24})(?:-[^/]*)?\/?$/i.exec(url.pathname); if (!m) return false;
    const p = await publicArticle(m[1]);
    if (!p) { page(res, 404, `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>غير موجود · مجتمع بلس</title><meta name="robots" content="noindex"><body style="font-family:system-ui;text-align:center;padding:60px"><h1>المقال غير متاح</h1><a href="/">العودة إلى مجتمع بلس</a></body></html>`); return true; }
    const doc = p.data?.doc || RT.parse(p.text), o = origin(req), canonical = o + articleUrl(p);
    const desc = RT.toText(doc).replace(/\s+/g, " ").slice(0, 160), cover = p.data?.paid ? null : p.data?.cover || (doc.blocks.find(b => b.t === "img") || {}).media || null; // phase 38: a paid cover is never a public og:image
    const toc = RT.toc(doc), mins = p.data?.readingMin || RT.readingMinutes(doc);
    const series = p.series ? (await db.all("SELECT id, title, part FROM posts WHERE series=$1 AND status='published' AND visibility='public' ORDER BY part", [p.series])) : [];
    const ld = { "@context": "https://schema.org", "@type": "Article", headline: p.title, description: desc, datePublished: new Date(p.created_at).toISOString(), dateModified: new Date(p.updated_at || p.created_at).toISOString(), author: { "@type": "Person", name: p.an, url: `${o}/#/u/${p.ah}` }, inLanguage: "ar", mainEntityOfPage: canonical, ...(cover ? { image: o + cover } : {}), wordCount: RT.toText(doc).split(/\s+/).length };
    const date = new Date(p.created_at).toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" });
    page(res, 200, `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)} · ${esc(p.an)} · مجتمع بلس</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:site_name" content="مجتمع بلس"><meta property="og:locale" content="ar_AR">${cover ? `<meta property="og:image" content="${esc(o + cover)}"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
<meta property="article:published_time" content="${esc(ld.datePublished)}"><meta property="article:author" content="${esc(p.an)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<style>:root{--fg:#1d1b26;--mut:#6b6880;--bg:#fbfaff;--acc:#6d3df5;--line:#ebe8f5}@media(prefers-color-scheme:dark){:root{--fg:#efedf7;--mut:#a6a2ba;--bg:#121019;--line:#2a2738}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:19px/1.9 "IBM Plex Sans Arabic","Noto Naskh Arabic",system-ui,sans-serif}
.bar{position:fixed;inset:0 0 auto;height:3px;background:var(--acc);transform-origin:right;animation:grow linear both;animation-timeline:scroll(root)}@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
header.top{display:flex;justify-content:space-between;align-items:center;max-width:720px;margin:auto;padding:14px 20px}header.top a{color:var(--acc);text-decoration:none;font-weight:700;font-size:15px}
main{max-width:720px;margin:auto;padding:10px 20px 80px}h1{font-size:2.1em;line-height:1.35;margin:.4em 0}.meta{color:var(--mut);font-size:15px;margin-bottom:1.6em}
h2{font-size:1.45em;margin:1.6em 0 .5em}h3{font-size:1.2em;margin:1.4em 0 .4em}p{margin:0 0 1.1em}blockquote{margin:1.2em 0;padding:.2em 1em;border-inline-start:4px solid var(--acc);color:var(--mut)}
pre{background:#1d1b26;color:#f3f1ff;padding:14px;border-radius:12px;overflow:auto;font-size:15px;line-height:1.6;text-align:left}code{font-family:ui-monospace,monospace;font-size:.9em}
figure{margin:1.5em 0}figure img{width:100%;border-radius:14px}figcaption{color:var(--mut);font-size:14px;text-align:center}.tbl{overflow:auto}table{border-collapse:collapse;width:100%;font-size:16px}th,td{border:1px solid var(--line);padding:8px 10px}th{background:color-mix(in srgb,var(--acc) 8%,transparent)}
nav.toc{border:1px solid var(--line);border-radius:14px;padding:12px 18px;margin:0 0 1.6em;font-size:16px}nav.toc a{color:inherit}nav.toc .l3{padding-inline-start:16px}nav.series{background:color-mix(in srgb,var(--acc) 7%,transparent);border-radius:14px;padding:12px 18px;margin:1.6em 0;font-size:16px}
a{color:var(--acc)}.cta{display:block;text-align:center;margin-top:40px;padding:14px;border-radius:14px;background:var(--acc);color:#fff;text-decoration:none;font-weight:700}</style></head>
<body><div class="bar" aria-hidden="true"></div><header class="top"><a href="/">مجتمع بلس</a><a href="/#/post/${esc(p.id)}">افتح في التطبيق</a></header>
<main><article><h1>${esc(p.title)}</h1><div class="meta">${esc(p.an)} · <time datetime="${esc(ld.datePublished)}">${esc(date)}</time> · ${mins} د قراءة</div>
${series.length > 1 ? `<nav class="series" aria-label="السلسلة"><b>سلسلة من ${series.length} أجزاء</b><ol>${series.map(s => s.id === p.id ? `<li><b>${esc(s.title || "")}</b></li>` : `<li><a href="${esc(articleUrl(s))}">${esc(s.title || "")}</a></li>`).join("")}</ol></nav>` : ""}
${toc.length >= 3 ? `<nav class="toc" aria-label="المحتويات"><b>المحتويات</b>${toc.map(t => `<div class="l${t.level}"><a href="#${esc(t.id)}">${esc(t.text)}</a></div>`).join("")}</nav>` : ""}
${RT.toHTML(doc, { anchors: false }).replace(/<(h2|h3)>/g, (x, h) => x)}
</article><a class="cta" href="/#/post/${esc(p.id)}">ناقش المقال في مجتمع بلس</a></main></body></html>`.replace(/<(h2|h3)>/g, "<$1>").replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (all, l, inner) => { const t = toc.find(x => RT.esc(x.text) === inner); return t ? `<h${l} id="${esc(t.id)}">${inner}</h${l}>` : all; }));
    return true;
  }

  return { ssr, assist, articleUrl };
};
