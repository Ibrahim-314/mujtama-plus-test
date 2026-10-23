/* Track 5 — discovery & feed: ranking service (why, more/less, chronological, meaningful engagement,
 * diversity, cache, tabs, caught-up), pro search (Arabic normalisation, filters, typeahead, spelling,
 * saved searches + alerts, history, grouped results), trends (country/city, manipulation, summaries,
 * follows, curated topic pages, explore), lists & collections (privacy, folders, notes, sharing,
 * reminders, offline sync), smart summaries (thread, daily, weekly email, provider layer, cost limits,
 * anti-hallucination). Runs on SQLite and on PostgreSQL (TEST_DATABASE_URL). */
process.env.SMTP_URL = "memory:";
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { id } = require("../lib/core");
let H, db, A, B, C, ADM; // note: the first registered account (A) is an admin by design
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const enc = encodeURIComponent;
const mk = async (handle, name) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
/* bulk content goes straight to the DB (the API rate-limits posting) and is then indexed like an API post */
async function seed(author, text, o = {}) {
  const pid = id("p"), at = o.at || new Date(Date.now() - (o.ageMin || 0) * 60e3).toISOString();
  await db.run("INSERT INTO posts(id,author,type,title,text,topic,lang,visibility,status,community,location,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'published',$9,$10,$11)",
    [pid, author, o.type || "post", o.title || null, text, o.topic || null, o.lang || (/[a-z]/i.test(text) && !/[\u0600-\u06FF]/.test(text) ? "en" : "ar"), o.visibility || "public", o.community || null, o.location || null, at]);
  for (const tag of (text.match(/#[\p{L}\p{N}_]+/gu) || []).map(t => t.slice(1).replace(/^ال/, "").toLowerCase())) await db.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [pid, tag, at]);
  await H.app.ctx.services.search.indexPost(pid);
  return pid;
}
const asAdmin = async (c) => { await db.run("UPDATE users SET role='admin' WHERE id=$1", [c.id]); };

test.before(async () => {
  H = await boot(); db = H.app.ctx.db;
  A = await mk("reader_a", "قارئة"); B = await mk("writer_b", "أسامة المبرمج"); C = await mk("writer_c", "ليلى"); ADM = await mk("admin_d", "المشرف");
  await asAdmin(ADM);
});
test.after(() => H.app.close());

/* ======================= Phase 21 — smarter feed ======================= */
test("ranking: why-am-I-seeing-this lists weighted factors and controls; more/less feedback reorders, hides and can be undone", async () => {
  await A.req("PUT", `/api/follows/${B.id}`);
  const pb = await seed(B.id, "شرح عملي لبناء واجهات عربية متجاوبة", { topic: "dev", ageMin: 30 });
  const pc = await seed(C.id, "رأيي في أدوات التصميم الجديدة", { topic: "design", ageMin: 20 });
  const why = await A.req("GET", `/api/posts/${pb}/why`);
  assert.equal(why.status, 200);
  assert.ok(why.factors.some(f => f.code === "following" && f.w === 4), JSON.stringify(why.factors));
  assert.ok(why.reasons.some(r => r.includes("تتابعه")));
  assert.ok(why.controls.some(c => c.signal === "less" && c.scope === "author"));
  assert.match(why.model, /التعليق ×3/);

  let f = await A.req("GET", "/api/feed?mode=for");
  assert.ok(f.posts.findIndex(p => p.id === pb) < f.posts.findIndex(p => p.id === pc), "followed author ranks first");
  assert.ok(f.posts.find(p => p.id === pb).why, "each post carries a short reason");
  // «more of this» for C's design topic flips the order (and invalidates the ranking cache immediately)
  await A.req("POST", "/api/feed/feedback", { post: pc, signal: "more", scope: "author" });
  await A.req("POST", "/api/feed/feedback", { post: pc, signal: "more", scope: "author" });
  f = await A.req("GET", "/api/feed?mode=for");
  assert.ok(f.posts.findIndex(p => p.id === pc) < f.posts.findIndex(p => p.id === pb), "more-like-this lifts the post");
  assert.ok((await A.req("GET", `/api/posts/${pc}/why`)).factors.some(x => x.code === "more_author"));
  // «less of this» on a post hides it entirely
  const lr = await A.req("POST", "/api/feed/feedback", { post: pb, signal: "less" });
  assert.deepEqual(lr.applied.map(x => x.kind).sort(), ["author", "post", "topic"]);
  f = await A.req("GET", "/api/feed?mode=for");
  assert.ok(!f.posts.some(p => p.id === pb), "less-like-this hides the post");
  const fb = await A.req("GET", "/api/feed/feedback"); assert.ok(fb.feedback.length >= 3);
  for (const x of fb.feedback.filter(y => y.target === pb || y.target === B.id || y.kind === "topic")) await A.req("DELETE", `/api/feed/feedback/${x.kind}/${enc(x.target)}`);
  assert.ok((await A.req("GET", "/api/feed?mode=for")).posts.some(p => p.id === pb), "undo restores it");
  assert.equal((await A.req("POST", "/api/feed/feedback", { post: pb, signal: "sideways" })).status, 400);
});

test("ranking: meaningful engagement (comments, saves, long reads) outweighs clicks", async () => {
  const V = await mk("viewer_v");
  const X = await mk("author_x", "كاتب التعليقات"), Y = await mk("author_y", "كاتب النقرات");
  const x1 = await seed(X.id, "مقال أول عن الإنتاجية", { topic: "learn", ageMin: 300 }), y1 = await seed(Y.id, "منشور أول عن الإنتاجية", { topic: "learn", ageMin: 300 });
  // V comments once on X, and clicks Y's post repeatedly (only one click per post per day counts)
  assert.equal((await V.req("POST", "/api/comments", { post: x1, text: "فكرة رائعة، جربتها فعلاً" })).status, 200);
  for (let i = 0; i < 5; i++) await V.req("POST", "/api/feed/signal", { post: y1, kind: "click" });
  const short = await V.req("POST", "/api/feed/signal", { post: y1, kind: "dwell", ms: 1200 });
  assert.equal(short.kind, "click", "a short glance is not a read");
  await wait(150);
  const x2 = await seed(X.id, "مقال ثانٍ عن الإنتاجية", { topic: "learn", ageMin: 5 }), y2 = await seed(Y.id, "منشور ثانٍ عن الإنتاجية", { topic: "learn", ageMin: 5 });
  const wx = await V.req("GET", `/api/posts/${x2}/why`), wy = await V.req("GET", `/api/posts/${y2}/why`);
  assert.ok(wx.factors.some(f => f.code === "affinity_author"), "a comment builds author affinity: " + JSON.stringify(wx.factors));
  assert.ok(!wy.factors.some(f => f.code === "affinity_author"), "clicks do not");
  assert.ok(wx.score > wy.score);
  const rows = await db.all("SELECT kind, COUNT(*) n FROM engagement_signals WHERE user_id=$1 GROUP BY kind", [V.id]);
  assert.equal(rows.find(r => r.kind === "click").n, 1, "clicks de-duplicated per day");
  assert.equal(rows.find(r => r.kind === "comment").n, 1);
});

test("ranking: diversity caps stop one account or topic from dominating", async () => {
  const D = await mk("diverse_d"), P = await mk("prolific_p", "حساب غزير");
  for (let i = 0; i < 8; i++) await seed(P.id, `تحديث رقم ${i + 1} من الحساب الغزير`, { topic: "pi", ageMin: i });
  for (let i = 0; i < 6; i++) { const u = await mk("other_" + i); await seed(u.id, `منشور متنوع ${i}`, { topic: ["ai", "dev", "design", "games", "learn", "invest"][i], ageMin: 40 + i * 5 }); }
  await D.req("PUT", `/api/follows/${P.id}`);
  const f = await D.req("GET", "/api/feed?mode=for&limit=20");
  const first10 = f.posts.slice(0, 10);
  assert.ok(first10.filter(p => p.author === P.id).length <= 2, "≤ 2 per author in any 10: " + first10.map(p => p.author === P.id ? "P" : "o").join(""));
  for (let i = 1; i < f.posts.length; i++) if (f.posts.filter(p => p.author !== P.id).length > i) assert.ok(!(f.posts[i].author === P.id && f.posts[i - 1].author === P.id) || i > 12, "no back-to-back from the same author while alternatives exist");
});

test("ranking: chronological is a permanent option and a tab; tabs are customisable; caught-up marker", async () => {
  const T = await mk("tabs_t");
  const prefs = await T.req("GET", "/api/feed/prefs");
  assert.deepEqual(prefs.tabs.map(t => t.id).slice(0, 3), ["for", "following", "chrono"]);
  const saved = await T.req("PUT", "/api/feed/prefs", { tabs: [{ id: "chrono" }, { id: "for", label: "مختار لي" }, { id: "topic:ai" }, { id: "discover", hidden: true }, { id: "bogus mode" }, { id: "for" }] });
  assert.deepEqual(saved.tabs.map(t => t.id), ["chrono", "for", "topic:ai", "discover"], "invalid and duplicate tabs dropped, order kept");
  assert.equal(saved.tabs[1].label, "مختار لي"); assert.equal(saved.tabs[3].hidden, true);
  assert.equal((await T.req("PUT", "/api/feed/prefs", { tabs: [{ id: "for", hidden: true }] })).status, 400);
  await T.req("PUT", `/api/follows/${C.id}`);
  const old = await seed(C.id, "منشور قديم قبل الزيارة", { ageMin: 120 });
  await T.req("POST", "/api/feed/seen", { at: new Date(Date.now() - 60 * 60e3).toISOString() });
  const n1 = await seed(C.id, "جديد بعد الزيارة ١", { ageMin: 10 }), n2 = await seed(C.id, "جديد بعد الزيارة ٢", { ageMin: 5 });
  await T.req("PUT", "/api/feed/prefs", { chrono: true });
  const f = await T.req("GET", "/api/feed?mode=for");
  assert.equal(f.mode, "chrono", "permanent chronological option overrides «for»");
  const order = f.posts.map(p => p.id);
  assert.ok(order.indexOf(n2) < order.indexOf(n1) && order.indexOf(n1) < order.indexOf(old), "strictly newest first");
  assert.equal(f.freshCount, f.posts.filter(p => p.fresh).length);
  assert.equal(f.caughtUpIndex, order.indexOf(old), "marker sits right before the first already-seen post");
  assert.equal(f.posts[f.caughtUpIndex - 1].fresh, true); assert.equal(f.posts[f.caughtUpIndex].fresh, false);
  await T.req("POST", "/api/feed/seen", {});
  assert.equal((await T.req("GET", "/api/feed?mode=chrono")).freshCount, 0);
  await T.req("PUT", "/api/feed/prefs", { chrono: false, tabs: null });
  assert.equal((await T.req("GET", "/api/feed?mode=for")).mode, "for");
  assert.equal((await T.req("GET", "/api/feed?mode=nonsense")).status, 400);
});

/* ======================= Phase 22 — pro search ======================= */
test("search: Arabic normalisation (hamza, tashkeel, taa marbuta, alef maqsura), grouped results and filters", async () => {
  const ar = await seed(B.id, "مُبَرْمِجٌ يشرح إدارة الذاكرة في لغة رَست للمبتدئين", { topic: "dev", ageMin: 60 });
  const ar2 = await seed(C.id, "مكتبة أسامة للبرمجة: مستشفى الأفكار", { topic: "dev", ageMin: 60 * 24 * 20 });
  const en = await seed(C.id, "Memory management in Rust for beginners", { topic: "dev", lang: "en", ageMin: 30 });
  const q1 = await A.req("GET", "/api/search/full?q=" + enc("مبرمج"));
  assert.ok(q1.groups.posts.items.some(p => p.id === ar), "tashkeel ignored");
  const q2 = await A.req("GET", "/api/search/full?q=" + enc("اسامه"));
  assert.ok(q2.groups.posts.items.some(p => p.id === ar2), "hamza + taa marbuta");
  assert.ok(q2.groups.people.items.some(u => u.id === B.id), "people group (name «أسامة المبرمج»)");
  assert.equal(typeof q2.groups.communities.total, "number"); assert.ok(q2.groups.hashtags);
  const q3 = await A.req("GET", "/api/search/full?q=" + enc("مستشفي")); assert.ok(q3.groups.posts.items.some(p => p.id === ar2), "alef maqsura / ya");
  const q4 = await A.req("GET", "/api/search/full?q=" + enc("المكتبة")); assert.ok(q4.groups.posts.items.some(p => p.id === ar2), "definite article stemmed");
  // filters
  assert.ok(!(await A.req("GET", "/api/search/full?q=" + enc("مكتبة") + "&date=week")).groups.posts.items.some(p => p.id === ar2), "date filter");
  const lang = await A.req("GET", "/api/search/full?q=rust&lang=en&type=posts");
  assert.deepEqual(Object.keys(lang.groups), ["posts"], "type filter returns one group");
  assert.ok(lang.groups.posts.items.every(p => p.lang === "en") && lang.groups.posts.items.some(p => p.id === en));
  const cid = (await A.req("POST", "/api/communities", { name: "نادي رست", desc: "مجتمع لغة رست" })).community.id;
  await A.req("POST", "/api/posts", { text: "سؤال عن رست داخل النادي", community: cid }); await wait(120);
  const inC = await A.req("GET", `/api/search/full?q=${enc("رست")}&community=${cid}&type=posts`);
  assert.ok(inC.groups.posts.total >= 1 && inC.groups.posts.items.every(p => p.community === cid), "community filter");
  assert.ok((await A.req("GET", "/api/search/full?q=" + enc("نادي") + "&type=communities")).groups.communities.items.some(c => c.id === cid), "communities indexed on creation");
  const vid = await A.req("GET", "/api/search/full?q=" + enc("رست") + "&type=posts&ptype=video"); assert.equal(vid.groups.posts.total, 0, "post-type filter");
});

test("search: typeahead, spelling correction, history and trending suggestions", async () => {
  await seed(B.id, "دليل شامل للبرمجة الوظيفية بلغة هاسكل", { ageMin: 10 });
  const s = await A.req("GET", "/api/search/suggest?q=" + enc("هاس"));
  assert.ok(s.terms.some(t => t.startsWith("هاسكل")), JSON.stringify(s));
  assert.ok((await A.req("GET", "/api/search/suggest?q=" + enc("writer_"))).people.some(u => u.handle === "writer_b"), "people by handle prefix");
  const typo = await A.req("GET", "/api/search/full?q=" + enc("هاسكيل"));
  assert.equal(typo.corrected, "هاسكل", "auto-corrected when nothing matched"); assert.ok(typo.groups.posts.total >= 1);
  const h = await A.req("GET", "/api/search/history"); assert.equal(h.history[0].q, "هاسكيل");
  await A.req("GET", "/api/search/full?q=" + enc("هاسكيل")); // repeat → de-duplicated
  assert.equal((await A.req("GET", "/api/search/history")).history.filter(x => x.q === "هاسكيل").length, 1);
  const tr = await A.req("GET", "/api/search/trending"); assert.ok(Array.isArray(tr.popular) && tr.popular.length > 0); assert.ok(tr.topics.length === 8);
  await A.req("DELETE", "/api/search/history"); assert.equal((await A.req("GET", "/api/search/history")).history.length, 0);
  assert.equal((await A.req("GET", "/api/search/history")).status, 200); assert.equal((await new H.Client().req("GET", "/api/search/history")).status, 401);
});

test("search: saved searches alert on new matches through the leased job", async () => {
  const ss = await A.req("POST", "/api/search/saved", { q: "زلزال تقني", filters: { type: "posts" } });
  assert.equal(ss.saved.alert, true);
  await db.run("UPDATE saved_searches SET last_checked=$1 WHERE id=$2", [new Date(Date.now() - 5 * 60e3).toISOString(), ss.saved.id]);
  await seed(C.id, "زلزال تقني في عالم الشرائح هذا الأسبوع");
  const r = await H.app.ctx.services.search.checkAlerts(); assert.ok(r.notified >= 1);
  const list = await A.req("GET", "/api/search/saved"); assert.equal(list.saved[0].newCount, 1);
  const notes = (await A.req("GET", "/api/bootstrap")).notifications; assert.ok(notes.some(n => n.kind === "search_alert" && n.ref === ss.saved.id));
  await A.req("POST", `/api/search/saved/${ss.saved.id}/seen`); assert.equal((await A.req("GET", "/api/search/saved")).saved[0].newCount, 0);
  await A.req("PATCH", `/api/search/saved/${ss.saved.id}`, { alert: false }); assert.equal((await A.req("GET", "/api/search/saved")).saved[0].alert, false);
  await A.req("DELETE", `/api/search/saved/${ss.saved.id}`); assert.equal((await A.req("GET", "/api/search/saved")).saved.length, 0);
});

/* ======================= Phase 23 — trends & topics ======================= */
test("trends: per country and city, manipulation detection, summaries with citations, explore payload", async () => {
  const users = []; for (let i = 0; i < 4; i++) users.push(await mk("jed_" + i, "من جدة " + i));
  await db.run("UPDATE users SET location='جدة' WHERE handle LIKE 'jed_%'");
  const jedPosts = [];
  for (const [i, u] of users.entries()) jedPosts.push(await seed(u.id, ["افتتاح كورنيش جدة الجديد كان مزدحماً جداً. الأجواء رائعة", "زرت الكورنيش اليوم والمشهد جميل مع العائلة", "مواقف السيارات في الكورنيش تحتاج تنظيماً أفضل", "فعاليات الكورنيش مستمرة طوال الأسبوع"][i] + " #كورنيش_جدة", { ageMin: 30 + i }));
  for (let i = 0; i < 3; i++) { const u = await mk("cairo_" + i); await seed(u.id, ["القاهرة تحتفل بمعرض الكتاب هذا العام", "زحام جميل في معرض الكتاب اليوم", "اشتريت خمس روايات من معرض الكتاب"][i] + " #معرض_الكتاب", { location: i ? "القاهرة" : "القاهرة، مصر", ageMin: 60 + i }); }
  // manipulation: one fresh account pushes the same text over and over
  const spam = await mk("spammer_s");
  for (let i = 0; i < 6; i++) await seed(spam.id, `اشتروا عملة الصاروخ الآن قبل فوات الأوان #عملة_الصاروخ ${i}`, { location: "جدة", ageMin: i });
  const rc = await ADM.req("POST", "/api/admin/trends/recompute"); assert.equal(rc.status, 200, rc.error); assert.ok(rc.scopes >= 3, JSON.stringify(rc));
  assert.equal((await C.req("POST", "/api/admin/trends/recompute")).status, 403);
  const g = await A.req("GET", "/api/trending");
  assert.ok(g.trends.some(t => t.tag === "كورنيش_جدة")); assert.ok(!g.trends.some(t => t.tag === "عملة_الصاروخ"), "manipulated tag hidden from the public");
  const sa = await A.req("GET", "/api/trending?scope=country&key=SA"); assert.equal(sa.label, "السعودية"); assert.equal(sa.trends[0].tag, "كورنيش_جدة");
  const jed = await A.req("GET", "/api/trending?scope=city&key=" + enc("جدة")); assert.ok(jed.trends.some(t => t.tag === "كورنيش_جدة"));
  const eg = await A.req("GET", "/api/trending?scope=country&key=EG"); assert.ok(eg.trends.some(t => t.tag === "معرض_الكتاب")); assert.ok(!eg.trends.some(t => t.tag === "كورنيش_جدة"));
  const places = await A.req("GET", "/api/trending/places"); assert.ok(places.places.some(p => p.scope === "city" && p.key === "القاهرة"));
  const adm = await ADM.req("GET", "/api/trending?flagged=1");
  const flagged = adm.trends.find(t => t.tag === "عملة_الصاروخ"); assert.ok(flagged && flagged.flagged, "admins see flagged trends");
  assert.match(flagged.reason, /حساب واحد|متطابقة/);
  // extractive summary: AI label + citations to real post ids of that trend
  const t = sa.trends[0]; assert.equal(t.summary.ai, true); assert.match(t.summary.label, /آلياً/); assert.ok(t.summary.points.length >= 1);
  for (const p of t.summary.points) { assert.ok(p.cites.length && p.cites.every(c => jedPosts.includes(c.id) && c.kind === "post" && c.author), "cites only posts of the trend, with their authors"); }
  const det = await A.req("GET", "/api/trending/tag/" + enc("كورنيش_جدة")); assert.equal(det.posts.length, 4); assert.ok(det.trend.summary);
  // explore: magazine payload with coloured topic cards and the viewer's own location
  await db.run("UPDATE users SET location='حي الروضة، جدة' WHERE id=$1", [A.id]);
  const ex = await A.req("GET", "/api/explore?scope=city");
  assert.equal(ex.location.key, "جدة"); assert.equal(ex.hero.tag, "كورنيش_جدة");
  assert.equal(ex.topics.length, 8); assert.ok(ex.topics.every(x => /^#[0-9a-f]{6}$/i.test(x.color) && x.emoji));
  assert.ok(Array.isArray(ex.articles) && Array.isArray(ex.communities) && Array.isArray(ex.places));
});

test("topics: follow a topic or hashtag (feeds chronological + ranking), curated topic pages", async () => {
  const F = await mk("follower_f");
  const tagPost = await seed(C.id, "خبر عن #الشبكات_العصبية اليوم", { ageMin: 3 });
  const topicPost = await seed(B.id, "منشور في موضوع الألعاب", { topic: "games", ageMin: 4 });
  assert.ok(!(await F.req("GET", "/api/feed?mode=chrono")).posts.some(p => p.id === tagPost));
  assert.equal((await F.req("PUT", "/api/follows/tag/" + enc("#الشبكات_العصبية"))).ref, "شبكات_العصبية");
  await F.req("PUT", "/api/follows/topic/games");
  assert.equal((await F.req("PUT", "/api/follows/topic/nope")).status, 404);
  const mine = await F.req("GET", "/api/follows/topics"); assert.deepEqual(mine.topics, ["games"]); assert.deepEqual(mine.tags, ["شبكات_العصبية"]);
  const chrono = await F.req("GET", "/api/feed?mode=chrono"); assert.ok(chrono.posts.some(p => p.id === tagPost) && chrono.posts.some(p => p.id === topicPost), "followed tag/topic reach the chronological feed");
  assert.ok((await F.req("GET", `/api/posts/${tagPost}/why`)).factors.some(f => f.code === "follow_tag"));
  assert.ok((await F.req("GET", "/api/feed?mode=" + enc("tag:شبكات_العصبية"))).posts.some(p => p.id === tagPost), "a hashtag can be a feed tab");
  // curated page
  assert.equal((await F.req("PUT", "/api/topics/games/page", { title: "x" })).status, 403);
  const cur = await ADM.req("PUT", "/api/topics/games/page", { title: "عالم الألعاب", descr: "كل جديد الألعاب العربية", color: "#9d174d", emoji: "🕹️", featured: [topicPost], tags: ["#ألعاب_عربية"] });
  assert.equal(cur.topic.color, "#9d174d"); assert.equal(cur.topic.curated, true);
  const page = await F.req("GET", "/api/topics/games/page");
  assert.equal(page.topic.title, "عالم الألعاب"); assert.equal(page.following, true); assert.ok(page.followers >= 1);
  assert.equal(page.featured[0].id, topicPost); assert.ok(!page.posts.some(p => p.id === topicPost), "featured not repeated"); assert.ok(page.tags.includes("ألعاب_عربية"));
  await F.req("DELETE", "/api/follows/topic/games"); assert.equal((await F.req("GET", "/api/topics/games/page")).following, false);
});

/* ======================= Phase 24 — lists & collections ======================= */
test("people lists: public and private, members, list feed", async () => {
  const pub = (await A.req("POST", "/api/plists", { name: "مطورون أتابعهم", visibility: "public", members: [B.id] })).list;
  const priv = (await A.req("POST", "/api/plists", { name: "قائمة سرية" })).list;
  assert.equal(pub.members, 1); assert.equal(priv.visibility, "private");
  await A.req("PUT", `/api/plists/${pub.id}/members/writer_c`);
  const other = await mk("list_viewer");
  const d = await other.req("GET", `/api/plists/${pub.id}`); assert.equal(d.members.length, 2); assert.equal(d.mine, false);
  assert.equal((await other.req("GET", `/api/plists/${priv.id}`)).status, 404, "private list invisible to others");
  assert.equal((await other.req("PUT", `/api/plists/${pub.id}/members/${other.id}`)).status, 404, "only the owner edits");
  assert.deepEqual((await other.req("GET", "/api/users/reader_a/plists")).lists.map(l => l.id), [pub.id]);
  assert.equal((await A.req("GET", "/api/users/reader_a/plists")).lists.length, 2);
  const bp = await seed(B.id, "منشور من عضو في القائمة", { ageMin: 1 });
  assert.ok((await other.req("GET", "/api/feed?mode=list:" + pub.id)).posts.some(p => p.id === bp), "public list readable as a feed");
  assert.equal((await other.req("GET", "/api/feed?mode=list:" + priv.id)).status, 404);
  assert.equal((await A.req("GET", `/api/plists?for=${C.id}`)).lists.find(l => l.id === pub.id).includes, true);
  await A.req("PATCH", `/api/plists/${priv.id}`, { visibility: "public", name: "لم تعد سرية" });
  assert.equal((await other.req("GET", `/api/plists/${priv.id}`)).list.name, "لم تعد سرية");
  await A.req("DELETE", `/api/plists/${priv.id}/members/${B.id}`); await A.req("DELETE", `/api/plists/${priv.id}`);
  assert.equal((await A.req("GET", `/api/plists/${priv.id}`)).status, 404);
});

test("collections: legacy import, folders, notes, move, drag-and-drop order, sharing without private notes", async () => {
  const S = await mk("saver_s");
  const p1 = await seed(B.id, "منشور يستحق الحفظ ١", { ageMin: 9 }), p2 = await seed(C.id, "منشور يستحق الحفظ ٢", { ageMin: 8 }), p3 = await seed(C.id, "منشور يستحق الحفظ ٣", { ageMin: 7 });
  const hidden = await seed(C.id, "منشور للمتابعين فقط", { visibility: "followers" });
  await S.req("PUT", "/api/me/prefs", { collections: [{ id: "col1", name: "لاحقاً", items: [p1] }, { id: "col2", name: "تعلم", items: [] }] });
  let cols = (await S.req("GET", "/api/collections")).collections;
  assert.deepEqual(cols.map(c => c.name), ["لاحقاً", "تعلم"], "legacy prefs collections imported once"); assert.equal(cols[0].count, 1);
  assert.equal((await S.req("GET", "/api/collections")).collections.length, 2, "not imported twice");
  const ideas = (await S.req("POST", "/api/collections", { name: "أفكار", color: "#0f766e", emoji: "💡" })).collection;
  for (const p of [p2, p3]) assert.equal((await S.req("POST", `/api/collections/${ideas.id}/items`, { post: p })).added, true);
  assert.equal((await S.req("POST", `/api/collections/${ideas.id}/items`, { post: p2 })).added, false, "idempotent");
  assert.equal((await S.req("POST", `/api/collections/${ideas.id}/items`, { post: hidden })).status, 404, "cannot save what you cannot see");
  assert.equal((await S.req("POST", `/api/collections/${ideas.id}/items`, { post: "p_nope" })).status, 404);
  await S.req("PATCH", `/api/collections/${ideas.id}/items/${p2}`, { note: "ملاحظة خاصة: أعد قراءته" });
  let det = await S.req("GET", `/api/collections/${ideas.id}`);
  assert.equal(det.items[0].postId, p3, "newest saved first"); assert.equal(det.items.find(i => i.postId === p2).note, "ملاحظة خاصة: أعد قراءته");
  await S.req("PUT", `/api/collections/${ideas.id}/items/order`, { posts: [p2, p3] });
  det = await S.req("GET", `/api/collections/${ideas.id}`); assert.deepEqual(det.items.map(i => i.postId), [p2, p3], "item drag-and-drop order");
  // reorder folders (drag and drop on the grid)
  cols = (await S.req("PUT", "/api/collections/order", { ids: [ideas.id, cols[1].id, cols[0].id] })).collections;
  assert.deepEqual(cols.map(c => c.name), ["أفكار", "تعلم", "لاحقاً"]);
  assert.equal(cols[0].cover.length, 2, "grid cover thumbnails");
  // move an item to another folder
  await S.req("PATCH", `/api/collections/${ideas.id}/items/${p3}`, { moveTo: cols[1].id });
  assert.equal((await S.req("GET", `/api/collections/${cols[1].id}`)).items[0].postId, p3);
  assert.equal((await S.req("GET", `/api/collections/${ideas.id}`)).items.length, 1);
  // sharing: read-only link, no private notes, hidden posts filtered, revocable
  const sh = await S.req("POST", `/api/collections/${ideas.id}/share`, {}); assert.ok(sh.shareCode && sh.url.includes(sh.shareCode));
  const anon = await new H.Client().req("GET", `/api/shared/collections/${sh.shareCode}`);
  assert.equal(anon.collection.name, "أفكار"); assert.equal(anon.posts[0].id, p2); assert.equal(anon.owner.handle, "saver_s");
  assert.ok(!JSON.stringify(anon).includes("ملاحظة خاصة"), "private notes never shared");
  assert.equal((await A.req("GET", `/api/collections/${ideas.id}`)).status, 404, "others cannot open the folder itself");
  await S.req("POST", `/api/collections/${ideas.id}/share`, { on: false });
  assert.equal((await new H.Client().req("GET", `/api/shared/collections/${sh.shareCode}`)).status, 404);
  await S.req("PATCH", `/api/collections/${ideas.id}`, { name: "أفكار ملهمة" });
  assert.equal((await S.req("GET", `/api/collections/${ideas.id}`)).collection.name, "أفكار ملهمة");
  const sig = await db.get("SELECT COUNT(*) n FROM engagement_signals WHERE user_id=$1 AND kind='save'", [S.id]); assert.ok(sig.n >= 2, "saving is a meaningful-engagement signal");
});

test("collections: read-later reminders and offline sync (pull with tombstones, replay queued ops)", async () => {
  const R = await mk("remind_r");
  const p1 = await seed(B.id, "اقرأه لاحقاً", { ageMin: 3 }), p2 = await seed(C.id, "وهذا أيضاً", { ageMin: 2 });
  const col = (await R.req("GET", "/api/collections")).collections[0];
  await R.req("POST", `/api/collections/${col.id}/items`, { post: p1, remindAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await R.req("PATCH", `/api/collections/${col.id}/items/${p1}`, { remindAt: "غداً" })).status, 400);
  const later = await R.req("GET", "/api/collections/later"); assert.equal(later.items[0].postId, p1); assert.equal(later.items[0].collectionName, col.name);
  await H.app.ctx.services.collections.remindDue(); await H.app.ctx.services.collections.remindDue();
  const notes = (await R.req("GET", "/api/bootstrap")).notifications.filter(n => n.kind === "read_later");
  assert.equal(notes.length, 1, "exactly one reminder"); assert.equal(notes[0].post, p1);
  // pull everything, then only changes since serverTime
  const full = await R.req("GET", "/api/collections/sync"); assert.equal(full.full, true); assert.equal(full.items[0].post.id, p1); assert.ok(full.users.some(u => u.id === B.id), "authors shipped for offline rendering");
  await wait(10);
  const offlineId = "col_offline" + Date.now().toString(36);
  const push = await R.req("POST", "/api/collections/sync", { ops: [
    { op: "create", id: offlineId, name: "حُفظت دون اتصال" }, { op: "add", collection: offlineId, post: p2 }, { op: "update", collection: offlineId, post: p2, note: "من الطائرة" },
    { op: "remove", collection: col.id, post: p1 }, { op: "add", collection: offlineId, post: p2 }, { op: "explode" }] });
  assert.deepEqual(push.results.map(r => r.ok !== false), [true, true, true, true, true, false], JSON.stringify(push.results));
  const delta = await R.req("GET", "/api/collections/sync?since=" + enc(full.serverTime));
  assert.equal(delta.full, false); assert.ok(delta.items.every(i => i.collection === offlineId)); assert.equal(delta.items[0].note, "من الطائرة");
  assert.ok(delta.tombstones.some(t => t.collection === col.id && t.post === p1), "removal travels as a tombstone");
  assert.ok(delta.collections.some(c => c.id === offlineId), "client-generated id kept");
  await R.req("DELETE", `/api/collections/${offlineId}`);
  assert.ok((await R.req("GET", "/api/collections/sync?since=" + enc(push.serverTime))).tombstones.some(t => t.collection === offlineId && !t.post));
});

/* ======================= Phase 25 — smart summaries ======================= */
test("summaries: thread bullets cite real post/comment ids, are labelled AI-generated and cached", async () => {
  const p = (await B.req("POST", "/api/posts", { type: "discussion", title: "هل نعتمد العمل عن بعد؟", text: "نقاش مفتوح حول العمل عن بعد في الشركات الناشئة العربية. ما تجاربكم؟" })).post;
  assert.equal((await A.req("GET", `/api/posts/${p.id}/summary`)).summary, null, "short threads are not summarised");
  const lines = ["العمل عن بعد رفع إنتاجية فريقنا بوضوح بعد ستة أشهر من التجربة.", "التواصل غير المتزامن هو التحدي الأكبر في العمل عن بعد ويحتاج أدوات توثيق جيدة.", "نحن نعتمد نموذجاً هجيناً: يومان في المكتب وثلاثة أيام عن بعد.", "الإنتاجية في العمل عن بعد ارتفعت لكن الشعور بالعزلة زاد عند بعض الموظفين.", "التوثيق الجيد يحل معظم مشاكل التواصل في الفرق الموزعة."];
  const users = [A, C, ADM, A, C];
  const cids = []; for (const [i, t] of lines.entries()) { const r = await users[i].req("POST", "/api/comments", { post: p.id, text: t }); assert.equal(r.status, 200, r.error); cids.push(r.comment.id); }
  const s = await A.req("GET", `/api/posts/${p.id}/summary`);
  assert.equal(s.summary.ai, true); assert.match(s.summary.label, /مولّد آلياً/); assert.equal(s.summary.provider, "extractive");
  assert.ok(s.summary.points.length >= 2 && s.summary.points.length <= 5);
  const valid = new Set([p.id, ...cids]);
  for (const pt of s.summary.points) {
    assert.ok(pt.cites.length >= 1 && pt.cites.every(c => valid.has(c.id) && ["post", "comment"].includes(c.kind) && c.author), JSON.stringify(pt));
    const src = [p.title + ". " + p.text, ...lines][[p.id, ...cids].indexOf(pt.cites[0].id)];
    assert.ok(src.includes(pt.text.replace(/…$/, "")), "extractive points are verbatim source sentences");
  }
  assert.equal(s.summary.cached, false); assert.equal((await A.req("GET", `/api/posts/${p.id}/summary`)).summary.cached, true);
  await A.req("POST", "/api/comments", { post: p.id, text: "إضافة جديدة: الاجتماعات القصيرة اليومية تساعد كثيراً." });
  assert.equal((await A.req("GET", `/api/posts/${p.id}/summary`)).summary.cached, false, "new comment invalidates the cache");
});

test("summaries: provider layer — verified LLM output, hallucinations dropped, cost limits, provider errors → extractive", async () => {
  const llm = H.app.ctx.llm;
  const sources = [{ id: "p_1", text: "افتتحت المكتبة العامة فرعاً جديداً في حي النخيل يضم ثلاثة آلاف كتاب." }, { id: "c_2", text: "الفرع الجديد يفتح أبوابه من التاسعة صباحاً حتى العاشرة مساءً." }];
  llm.register("honest", { paid: true, model: "fake-1", complete: async () => ({ points: [{ text: "افتتاح فرع جديد للمكتبة العامة في حي النخيل", cites: ["p_1"] }, { text: "الفرع يفتح من التاسعة صباحاً حتى العاشرة مساءً", cites: ["c_2"] }], usage: { in: 120, out: 40 } }) });
  llm.register("liar", { paid: true, complete: async () => ({ points: [{ text: "المكتبة ستوزع خمسين جائزة مالية على الزوار", cites: ["p_1"] }, { text: "رئيس البلدية حضر حفل الافتتاح بنفسه", cites: ["c_9"] }, { text: "الفرع الجديد في حي النخيل", cites: [] }], usage: { in: 100, out: 30 } }) });
  llm.register("broken", { paid: true, complete: async () => { throw new Error("upstream 503"); } });
  const ok = await llm.summarize({ kind: "اختبار", sources, provider: "honest" });
  assert.equal(ok.provider, "honest"); assert.equal(ok.points.length, 2); assert.equal(ok.model, "fake-1");
  const usage = await db.get("SELECT * FROM llm_usage WHERE provider='honest'"); assert.equal(usage.calls, 1); assert.equal(usage.tokens_in, 120); assert.ok(usage.cost > 0);
  const lie = await llm.summarize({ kind: "اختبار", sources, provider: "liar" });
  assert.equal(lie.provider, "extractive"); assert.equal(lie.fallback, "verification", "every hallucinated point was rejected");
  const v = llm.verify([{ text: "المكتبة ستوزع خمسين جائزة مالية", cites: ["p_1"] }, { text: "يضم الفرع ثلاثة آلاف كتاب في حي النخيل", cites: ["p_1"] }, { text: "يضم 5000 كتاب", cites: ["p_1"] }], sources);
  assert.equal(v.kept.length, 1); assert.deepEqual(v.dropped.map(d => d.why).sort(), ["unsupported_content", "unsupported_number"]);
  assert.equal((await llm.summarize({ kind: "اختبار", sources, provider: "broken" })).fallback, "provider_error");
  const budget = llm.limits.dailyBudget; llm.limits.dailyBudget = 0;
  assert.equal((await llm.summarize({ kind: "اختبار", sources, provider: "honest" })).fallback, "budget", "cost limit enforced before calling");
  llm.limits.dailyBudget = budget;
  assert.ok(!llm.providers().includes("openai") || process.env.OPENAI_API_KEY, "OpenAI adapter only exists with a key");
  const st = await ADM.req("GET", "/api/summaries/status"); assert.equal(st.status, 200); assert.equal(typeof st.spentTodayUsd, "number"); assert.equal(st.mail.enabled, true);
  assert.equal((await C.req("GET", "/api/summaries/status")).budgetUsd, undefined, "budget details are admin-only");
});

test("summaries: daily «what you missed» and the optional weekly email digest", async () => {
  const W = await mk("weekly_w", "وفاء");
  await W.req("PUT", `/api/follows/${C.id}`);
  for (const t of ["أطلقنا اليوم النسخة الثانية من تطبيق المحفظة مع دعم كامل للعربية.", "ورشة مجانية عن تصميم الواجهات العربية مساء الخميس في جدة.", "تقرير جديد: الشركات الناشئة في الخليج جمعت تمويلاً قياسياً هذا الربع."]) await seed(C.id, t, { ageMin: 50 });
  const d = await W.req("GET", "/api/digest/daily");
  assert.ok(d.counts.posts >= 3); assert.ok(d.summary && d.summary.ai && d.summary.points.length >= 1);
  assert.ok(d.summary.points.every(p => p.cites.every(c => c.kind === "post")));
  assert.ok(d.posts.length >= 3 && d.posts.every(p => p.author !== W.id));
  assert.equal((await W.req("PUT", "/api/digest/settings", { weeklyEmail: true })).status, 400, "email required");
  assert.equal((await W.req("PUT", "/api/digest/settings", { weeklyEmail: true, email: "not-an-email" })).status, 400);
  const s = await W.req("PUT", "/api/digest/settings", { weeklyEmail: true, email: "wafa@example.com" }); assert.equal(s.weeklyEmail, true); assert.equal(s.mailEnabled, true);
  const prev = await W.req("GET", "/api/digest/weekly/preview"); assert.match(prev.html, /dir="rtl"/); assert.match(prev.html, /مولّد آلياً/);
  const outbox = H.app.ctx.mailer.outbox, before = outbox.length;
  const r1 = await H.app.ctx.services.summaries.weeklyJob(); assert.ok(r1.sent >= 1);
  const m = outbox.slice(before).find(x => x.to === "wafa@example.com"); assert.ok(m, "weekly email sent");
  assert.match(m.raw, /Subject: =\?UTF-8\?B\?/); assert.match(m.raw, /multipart\/alternative/);
  await H.app.ctx.services.summaries.weeklyJob();
  assert.equal(outbox.filter(x => x.to === "wafa@example.com").length, 1, "at most one email per week");
  await W.req("PUT", "/api/digest/settings", { weeklyEmail: false }); assert.equal((await W.req("GET", "/api/digest/settings")).weeklyEmail, false);
});

test("migration 009 rolls back and re-applies cleanly", async () => {
  const M = require("../lib/migrations");
  // newer migrations (010+) depend on 009's schema, so roll back down to and including 009, then re-apply all
  const st = await M.status(db), newer = st.slice(st.findIndex(m => m.id === "009_discovery")).map(m => m.id);
  assert.deepEqual(await M.down(db, newer.length), [...newer].reverse());
  assert.equal((await M.status(db)).find(m => m.id === "009_discovery").applied, false);
  assert.deepEqual(await M.up(db), newer);
});
