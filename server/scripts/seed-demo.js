/* Realistic Arabic demo data generator for staging & load tests (Phase 2).
 *   SEED_USERS=300 SEED_POSTS=3000 node scripts/seed-demo.js   (uses DATABASE_URL / SQLITE_FILE)
 * Every account's password is "demo1234". Idempotent per run (unique handles with a run suffix). */
const { connect } = require("../lib/db"); const { migrate } = require("../lib/schema"); const { secret } = require("../lib/secrets");
const { hashPassword, id, Classifier, now } = require("../lib/core");
const N_USERS = +(process.env.SEED_USERS || 120), N_POSTS = +(process.env.SEED_POSTS || 1200);
const FIRST = ["محمد", "أحمد", "عبدالله", "فهد", "خالد", "سارة", "نورة", "ريم", "هيا", "لمى", "يوسف", "عمر", "مريم", "دانة", "سلمان", "جود", "رغد", "تركي", "بندر", "لينا"];
const LAST = ["العتيبي", "القحطاني", "الشهري", "الغامدي", "الحربي", "الدوسري", "الزهراني", "المطيري", "السبيعي", "العنزي", "الشمري", "الأحمدي"];
const BIOS = ["مطوّر ويب ومحب للكود النظيف", "باحثة في الذكاء الاصطناعي", "رائد أعمال ومهتم بالشركات الناشئة", "مصممة واجهات وتجربة مستخدم", "مهتم بـ Pi Network والاقتصاد الرقمي", "معلم وأحب مشاركة المعرفة", "لاعب ومراجع ألعاب", "مستثمر ومتابع للأسواق"];
const TOPICS = { ai: ["النماذج اللغوية الصغيرة صارت أسرع وأرخص", "كيف تختار نموذج ذكاء اصطناعي لمشروعك؟", "تجربتي مع أدوات البرمجة بالذكاء الاصطناعي"], dev: ["نصيحة اليوم: اكتب الاختبار قبل الإصلاح", "أفضل طريقة لتنظيم مشروع Node.js كبير", "تعلمت اليوم شيئاً جديداً عن قواعد البيانات"],
  startups: ["أول ١٠٠ عميل أصعب من أول مليون", "فكرة المنتج أقل أهمية من التنفيذ", "دروس من فشل مشروعي الأول"], pi: ["ما التطبيقات التي تنتظرونها على Pi؟", "نظام Pi يحتاج تطبيقات عربية أكثر", "بدأت أبني تطبيقاً صغيراً على Pi Browser"],
  design: ["المسافات البيضاء ليست فراغاً", "الخط العربي على الشاشة يحتاج عناية خاصة", "التصميم الجيد لا تلاحظه"], invest: ["التنويع أهم قاعدة في الاستثمار", "لا تستثمر ما لا تستطيع خسارته"], games: ["أفضل لعبة جربتها هذا الشهر", "الألعاب المستقلة العربية تستحق الدعم"], learn: ["خطة تعلم لمدة ٣٠ يوماً", "كيف أحفظ ما أتعلمه؟"] };
const TAGS = { ai: "#ذكاء_اصطناعي", dev: "#برمجة", startups: "#شركات_ناشئة", pi: "#PiNetwork", design: "#تصميم", invest: "#استثمار", games: "#ألعاب", learn: "#تعلم" };
const COMMENTS = ["فكرة ممتازة 👏", "أتفق معك تماماً", "ممكن توضح أكثر؟", "شكراً على المشاركة", "تجربة مشابهة حصلت معي", "معلومة مفيدة جداً"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const COLORS = ["#5b2bd6", "#e0559b", "#1f9d8b", "#e88b2a", "#3478f6", "#9b51e0", "#2fa84f", "#d6453a"];
(async () => {
  const db = await connect(secret("DATABASE_URL") || undefined); await migrate(db);
  const run = Date.now().toString(36).slice(-4), pw = hashPassword("demo1234"), users = [];
  const t0 = Date.now();
  await db.tx(async (t) => {
    for (let i = 0; i < N_USERS; i++) {
      const u = { id: id("u"), handle: `demo_${run}_${i}`, name: `${pick(FIRST)} ${pick(LAST)}`, interests: Object.keys(TOPICS).sort(() => Math.random() - .5).slice(0, 3) };
      users.push(u);
      await t.run("INSERT INTO users(id,handle,name,bio,color,role,password_hash,prefs,created_at) VALUES($1,$2,$3,$4,$5,'user',$6,$7,$8)", [u.id, u.handle, u.name, pick(BIOS), pick(COLORS), pw, { onboarded: true, interests: u.interests }, new Date(Date.now() - Math.random() * 90 * 864e5).toISOString()]);
    }
    for (const u of users) for (const v of users.sort(() => Math.random() - .5).slice(0, 8 + Math.floor(Math.random() * 25))) if (v.id !== u.id) await t.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [u.id, v.id, now()]);
    for (let i = 0; i < N_POSTS; i++) {
      const u = pick(users), topic = pick(u.interests), text = `${pick(TOPICS[topic])} ${TAGS[topic]}`, at = new Date(Date.now() - Math.pow(Math.random(), 2) * 30 * 864e5).toISOString(), pid = id("p");
      await t.run("INSERT INTO posts(id,author,type,text,topic,lang,visibility,status,views,data,created_at) VALUES($1,$2,'post',$3,$4,'ar','public','published',$5,$6,$7)", [pid, u.id, text, topic, Math.floor(Math.random() * 2000), {}, at]);
      for (const tag of Classifier.hashtags(text)) await t.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [pid, tag, at]);
      for (const r of users.slice(0, Math.floor(Math.random() * 12))) await t.run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [pid, r.id, pick(["like", "like", "useful", "insightful"]), at]);
      for (let c = 0; c < Math.floor(Math.random() * 4); c++) await t.run("INSERT INTO comments(id,post,author,text,status,created_at) VALUES($1,$2,$3,$4,'published',$5)", [id("c"), pid, pick(users).id, pick(COMMENTS), at]);
    }
  });
  console.log(`✓ seeded ${N_USERS} users and ${N_POSTS} posts in ${((Date.now() - t0) / 1000).toFixed(1)}s (run ${run}, password demo1234)`);
  await db.close();
})().catch(e => { console.error(e); process.exit(1); });
