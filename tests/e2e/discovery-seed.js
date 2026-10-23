/* A realistic small Arabic world for the discovery E2E tests and screenshots: authors in several cities,
 * posts across topics with hashtags, an article, a long discussion, engagement, collections and follows.
 * Server-side rows are written through the app context (fast, no rate limits); the signed-in viewer's own
 * actions go through the real API from the page. */
const { id } = require("../../server/lib/core");
const GRAD = ["linear-gradient(135deg, #6d3cf4, #c04cf0)", "linear-gradient(135deg, #0f766e, #22c55e)", "linear-gradient(135deg, #b45309, #f59e0b)", "linear-gradient(135deg, #1d4ed8, #38bdf8)", "linear-gradient(135deg, #be185d, #fb7185)"];
const AUTHORS = [
  ["khaled_dev", "خالد العتيبي", "الرياض", "#1d4ed8", "مطور واجهات ومحب للمصادر المفتوحة"],
  ["reem_ai", "ريم المصري", "القاهرة", "#be185d", "باحثة في معالجة اللغة العربية"],
  ["yousef_pi", "يوسف الحمادي", "دبي", "#047857", "أبني تطبيقات على شبكة Pi"],
  ["lyan_design", "ليان الزهراني", "جدة", "#b45309", "مصممة تجربة مستخدم وخطاطة"],
  ["omar_startup", "عمر الشهري", "جدة", "#6d28d9", "مؤسس شركة ناشئة في التقنية المالية"],
  ["sara_learn", "سارة القحطاني", "الرياض", "#0e7490", "معلمة برمجة للأطفال"]
];
async function seedDiscovery(ctx, page) {
  const { db } = ctx, at = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const call = (m, u, b) => page.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [m, u, b]);
  const users = {};
  for (const [handle, name, city, color, bio] of AUTHORS) {
    const uid = id("u"); users[handle] = uid;
    await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,location,created_at) VALUES($1,$2,$3,$4,$5,'user',$6,$7,$8)", [uid, handle, name, bio, color, { onboarded: true, interests: [] }, city, at(60 * 24 * 200)]);
  }
  const posts = {};
  const post = async (key, handle, text, o = {}) => {
    const pid = id("p"); posts[key] = pid;
    await db.run("INSERT INTO posts(id,author,type,title,text,topic,lang,visibility,status,location,data,created_at) VALUES($1,$2,$3,$4,$5,$6,'ar','public','published',$7,$8,$9)",
      [pid, users[handle], o.type || "post", o.title || null, text, o.topic || null, o.location || null, o.media || o.type === "discussion" ? { media: o.media || undefined, stances: o.type === "discussion" ? [{ t: "مناسب", v: 0 }, { t: "هجين أفضل", v: 0 }, { t: "غير مناسب", v: 0 }] : undefined } : null, at(o.ago || 30)]);
    for (const tag of (text.match(/#[\p{L}\p{N}_]+/gu) || []).map(t => t.slice(1).replace(/^ال/, "").toLowerCase())) await db.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [pid, tag, at(o.ago || 30)]);
    return pid;
  };
  await post("ai1", "reem_ai", "أطلقنا نموذجاً مفتوحاً يفهم اللهجات الخليجية والمصرية بدقة أعلى من السابق. التجربة متاحة للجميع اليوم #الذكاء_الاصطناعي #نماذج_عربية", { topic: "ai", ago: 25 });
  await post("ai2", "khaled_dev", "جربت النموذج العربي الجديد في مشروع خدمة العملاء، الردود أصبحت أقرب للهجة المستخدم #نماذج_عربية", { topic: "ai", ago: 40, location: "الرياض" });
  await post("ai3", "sara_learn", "علّمت طلابي اليوم كيف يعمل النموذج اللغوي ببطاقات ورقية بسيطة، كانت الحصة ممتعة جداً #نماذج_عربية #تعليم", { topic: "learn", ago: 70 });
  await post("ai4", "yousef_pi", "هل يمكن تشغيل نموذج عربي صغير داخل متصفح Pi؟ أجريت تجربة أولية والنتيجة مبشرة #نماذج_عربية", { topic: "pi", ago: 90 });
  await post("jed1", "lyan_design", "ورشة تصميم الواجهات العربية في جدة كانت ممتلئة! شكراً لكل من حضر #ورشة_جدة", { topic: "design", ago: 35, location: "جدة" });
  await post("jed2", "omar_startup", "لقاء رواد الأعمال على الكورنيش الليلة، نناقش التمويل في المراحل المبكرة #ورشة_جدة #ريادة", { topic: "startups", ago: 55, location: "جدة" });
  await post("jed3", "khaled_dev", "تابعت بث ورشة جدة عن بعد، أفضل جلسة كانت عن الخطوط العربية في الواجهات #ورشة_جدة", { topic: "design", ago: 80 });
  await post("dev1", "khaled_dev", "نصيحة للمطورين: اختبروا واجهاتكم باتجاه RTL من اليوم الأول، الإصلاح لاحقاً أصعب بكثير #برمجة", { topic: "dev", ago: 15 });
  await post("pi1", "yousef_pi", "نسخة جديدة من محفظة الإيصالات على Pi تدعم الفواتير المشتركة بين الأصدقاء #pinetwork", { topic: "pi", ago: 120, media: GRAD[1] });
  await post("art", "reem_ai", "تحليل المشاعر في التغريدات العربية يواجه تحدي اللهجات والسخرية. في هذا المقال أشرح ثلاث طرق عملية لتحسين الدقة، مع أمثلة من بيانات حقيقية وتجارب أجريناها خلال العام.", { type: "article", title: "دليل عملي لتحليل المشاعر بالعربية", topic: "ai", ago: 200, media: GRAD[0] });
  await post("art2", "omar_startup", "قصة تأسيس شركتنا الناشئة في التقنية المالية: من فكرة على ورقة إلى أول عشرة آلاف مستخدم، وما الأخطاء التي تعلمنا منها في الطريق.", { type: "article", title: "من فكرة إلى عشرة آلاف مستخدم", topic: "startups", ago: 260, media: GRAD[2] });
  const disc = await post("disc", "omar_startup", "هل العمل عن بعد مناسب للشركات الناشئة في مراحلها الأولى؟ أريد سماع تجاربكم الحقيقية قبل أن نقرر سياسة فريقنا.", { type: "discussion", title: "العمل عن بعد في الشركات الناشئة", topic: "startups", ago: 300 });
  const lines = [["khaled_dev", "العمل عن بعد رفع إنتاجية فريقنا بوضوح بعد ستة أشهر من التجربة."], ["reem_ai", "التواصل غير المتزامن هو التحدي الأكبر في العمل عن بعد ويحتاج أدوات توثيق جيدة."], ["lyan_design", "نعتمد نموذجاً هجيناً: يومان في المكتب وثلاثة أيام عن بعد، وهذا أفضل ما جربناه."],
    ["sara_learn", "الإنتاجية في العمل عن بعد ارتفعت لكن الشعور بالعزلة زاد عند بعض الموظفين."], ["yousef_pi", "التوثيق الجيد يحل معظم مشاكل التواصل في الفرق الموزعة."], ["khaled_dev", "الاجتماعات القصيرة اليومية تساعد الفريق الموزع على البقاء متزامناً."]];
  for (const [i, [hdl, text]] of lines.entries()) await db.run("INSERT INTO comments(id,post,author,text,status,created_at) VALUES($1,$2,$3,$4,'published',$5)", [id("c"), disc, users[hdl], text, at(280 - i * 20)]);
  for (const [k, n] of [["ai1", 5], ["ai2", 3], ["jed1", 4], ["dev1", 2], ["art", 4], ["pi1", 2]]) for (const h of Object.keys(users).slice(0, n)) await db.run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,'like',$3) ON CONFLICT DO NOTHING", [posts[k], users[h], at(10)]);
  await db.run("INSERT INTO communities(id,name,descr,topic,type,color,owner,created_at) VALUES($1,$2,$3,'dev','public','#1d4ed8',$4,$5)", [id("c"), "مطورو الويب العرب", "نقاشات يومية حول الواجهات والأداء", users.khaled_dev, at(9000)]);
  await db.run("INSERT INTO communities(id,name,descr,topic,type,color,owner,created_at) VALUES($1,$2,$3,'design','public','#be185d',$4,$5)", [id("c"), "تصميم بالعربي", "خطوط، هويات، وتجربة مستخدم", users.lyan_design, at(9000)]);
  ctx.cache.del("feed:"); // rows were written directly: drop ranked caches like any new post would
  await ctx.services.search.reindexAll();
  await ctx.services.trends.compute();
  // the viewer: in Jeddah, follows a few people and a topic, saved items in folders, last visit 2 hours ago
  const me = (await call("GET", "/api/me")).user;
  await db.run("UPDATE users SET location='جدة' WHERE id=$1", [me.id]);
  for (const hdl of ["reem_ai", "khaled_dev", "lyan_design"]) await call("PUT", "/api/follows/" + users[hdl]);
  await call("PUT", "/api/follows/topic/ai"); await call("PUT", "/api/follows/tag/" + encodeURIComponent("نماذج_عربية"));
  await db.run("INSERT INTO feed_prefs(user_id,tabs,chrono,seen_at,updated_at) VALUES($1,NULL,0,$2,$2) ON CONFLICT (user_id) DO UPDATE SET seen_at=$2", [me.id, at(60)]);
  const cols = (await call("GET", "/api/collections")).collections;
  const learn = (await call("POST", "/api/collections", { name: "أتعلم منها", emoji: "i:book", color: "#0f766e" })).collection;
  const ideas = (await call("POST", "/api/collections", { name: "أفكار لمشروعي", emoji: "i:bulb", color: "#b45309" })).collection;
  for (const k of ["art", "ai1", "dev1", "ai3"]) await call("POST", `/api/collections/${learn.id}/items`, { post: posts[k] });
  for (const k of ["art2", "pi1", "jed2"]) await call("POST", `/api/collections/${ideas.id}/items`, { post: posts[k] });
  await call("POST", `/api/collections/${cols[0].id}/items`, { post: posts.disc, remindAt: new Date(Date.now() + 3 * 3600e3).toISOString() });
  await call("PATCH", `/api/collections/${learn.id}/items/${posts.art}`, { note: "أطبّق الطريقة الثانية على بيانات المتجر الأسبوع القادم" });
  await call("POST", `/api/collections/${learn.id}/share`, {});
  for (const q of ["نماذج عربية", "ورشة جدة"]) await call("GET", "/api/search/full?q=" + encodeURIComponent(q));
  return { users, posts, discussion: disc, collection: learn.id, collections: [cols[0].id, learn.id, ideas.id], me };
}
module.exports = { seedDiscovery };
