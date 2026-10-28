/* v2.134 — demo DMs + group chats for testing messages AI on Render test only.
 * On when DEMO_MESSAGES=1: every real user (cap 100) gets 22 demo conversations (12 DMs + 10 groups, ~320 messages)
 * with unread runs, dates/tasks, an English chat and a scam-like message. Everything is tagged:
 * conversation ids start with "cv_dmsg_", demo people with "u_dmsg", every message has meta.demo=true.
 * When DEMO_MESSAGES is not 1 at boot, the tagged rows are removed (only those rows). Real data is never touched. */
const PEOPLE = [
  ["01", "سارة الشهري", "#9b51e0"], ["02", "فهد القحطاني", "#3478f6"], ["03", "نورة الغامدي", "#e0559b"], ["04", "خالد الحربي", "#1f9d8b"],
  ["05", "ريم الدوسري", "#e88b2a"], ["06", "عبدالله العتيبي", "#2fa84f"], ["07", "لمى الزهراني", "#d6453a"], ["08", "يوسف المطيري", "#5b2bd6"],
  ["09", "Daniel Carter", "#3478f6"], ["10", "هيا السبيعي", "#e0559b"], ["11", "تركي العنزي", "#1f9d8b"], ["12", "مريم الشمري", "#9b51e0"],
  ["13", "بندر الأحمدي", "#e88b2a"], ["14", "جود القحطاني", "#2fa84f"], ["15", "خدمة العملاء (تجريبي)", "#d6453a"]
];
const pid = (n) => "u_dmsg" + n;
/* DMs: [peer, unreadTail, lines] — "m" = the user, "p" = the peer */
const DMS = [
  ["01", 6, [["p", "هلا هيمو، كيفك؟"], ["m", "هلا سارة، الحمدلله تمام وانتي؟"], ["p", "بخير. بغيت أسألك عن تصميم صفحة المجتمع الجديدة"], ["m", "تفضلي"], ["p", "الألوان حلوة بس الخط صغير شوي على الجوال"], ["m", "صح ملاحظة مهمة، بكبره درجة"], ["p", "وكمان زر النشر بعيد عن الإبهام"], ["p", "لو ننقله تحت يمين يكون أسهل"], ["p", "وبالمناسبة الاجتماع بكرة الساعة 4 العصر عن بُعد"], ["p", "أرسلت لك الرابط بالإيميل"], ["p", "لا تنسى تجهز العرض"], ["p", "ردّ علي إذا الوقت يناسبك"]]],
  ["02", 0, [["p", "السلام عليكم"], ["m", "وعليكم السلام فهد"], ["p", "متى نقدر نجتمع على موضوع الشراكة؟"], ["m", "الأحد بعد المغرب يناسبك؟"], ["p", "تمام الأحد 8 المساء في مقهى الحي"], ["m", "اتفقنا إن شاء الله"], ["p", "أجيب معي العقد المبدئي"], ["m", "ممتاز، وأنا أجهز الأرقام"], ["p", "الله يوفقنا"], ["m", "آمين"]]],
  ["03", 9, [["p", "هيمو عندي سؤال عن الدورة"], ["p", "هل التسجيل مجاني؟"], ["m", "إيه مجاني للأعضاء"], ["p", "طيب كم مدتها؟"], ["p", "وهل فيه شهادة؟"], ["p", "أبغى أسجل أختي بعد"], ["p", "عمرها 16 سنة يصير؟"], ["p", "ولا لازم موافقة ولي الأمر"], ["p", "آخر موعد للتسجيل الخميس صح؟"], ["p", "رد علي الله يعافيك"], ["p", "😅"], ["p", "سؤال أخير: الدروس مسجلة ولا مباشرة؟"]]],
  ["04", 2, [["m", "خالد وصلت الملفات؟"], ["p", "إيه وصلت، شكراً"], ["m", "شفت الملاحظات على التقرير؟"], ["p", "شفتها، أغلبها منطقية"], ["p", "بس نقطة الميزانية أختلف معك فيها"], ["m", "وش رأيك فيها؟"], ["p", "أشوف نخفض بند الإعلانات 20٪ ونحطها في المحتوى"], ["m", "فكرة، خلنا نناقشها مع الفريق"], ["p", "تمام، أنا أرتب المكالمة"], ["p", "الثلاثاء الساعة 10 الصبح مناسب؟"]]],
  ["05", 0, [["p", "مبروك على الإصدار الجديد 🎉"], ["m", "الله يبارك فيك ريم"], ["p", "ميزة الملخص حلوة مرة"], ["m", "يسعدني، أي ملاحظة قوليها"], ["p", "أبغى أقدر أختار طول الملخص"], ["m", "مسجلة عندي"], ["p", "تسلم"], ["m", "العفو"]]],
  ["06", 7, [["p", "يا هيمو فيه مشكلة بالتطبيق"], ["p", "لما أفتح الإشعارات يعلق شوي"], ["p", "جوالي آيفون 13"], ["p", "جربت أحذف وأنزله ما فاد"], ["m", "سلامات، من متى بدأت؟"], ["p", "من أمس تقريباً"], ["p", "وكمان الصور ما تطلع أحياناً"], ["p", "أرسلت لك لقطة شاشة"], ["p", "والفيديو يتأخر يشتغل"], ["p", "بس غير كذا التطبيق رهيب"], ["p", "متى التحديث الجاي؟"]]],
  ["07", 0, [["p", "تذكير: موعد طبيب الأسنان السبت 11 الصبح"], ["m", "شكراً لمى، كنت ناسي"], ["p", "ولازم تجيب بطاقة التأمين"], ["m", "تمام"], ["p", "وبعدها نروح نشتري هدية لأمي؟"], ["m", "أكيد، عيد ميلادها الاثنين صح؟"], ["p", "إيه الاثنين"], ["m", "خلاص بعد الطبيب نمر السوق"]]],
  ["08", 4, [["m", "يوسف وش أخبار المشروع؟"], ["p", "ماشي، خلصنا 70٪"], ["m", "ممتاز، فيه شي واقف؟"], ["p", "ننتظر موافقة التصميم من العميل"], ["p", "وأحتاج منك ترسل الفاتورة الثانية"], ["p", "المبلغ 4500 ريال"], ["p", "ويفضل قبل نهاية الشهر"], ["p", "وأرسل لي نسخة من العقد الموقع"]]],
  ["09", 5, [["p", "Hi Hemo, hope you're doing well!"], ["m", "Hi Daniel, all good thanks"], ["p", "We'd love to feature Mujtama+ in our newsletter next week"], ["p", "Could you send us a short description and two screenshots?"], ["p", "The deadline is Wednesday 5 PM (Riyadh time)"], ["p", "Also, would you be available for a 20-minute interview on Thursday?"], ["p", "Let me know what works best for you. Thanks!"]]],
  ["10", 0, [["p", "صباح الخير"], ["m", "صباح النور هيا"], ["p", "ممكن تضيفني لمجتمع المصممين؟"], ["m", "أرسلت لك دعوة الحين"], ["p", "وصلت، شكراً كثير"], ["m", "حياك"]]],
  ["11", 3, [["p", "تركي معك، شفت مباراة أمس؟"], ["m", "إيه، كانت قوية"], ["p", "الهدف الثاني كان خيالي"], ["m", "صح، والحارس أنقذ كثير"], ["p", "نتفق نحضر الجاية بالملعب؟"], ["p", "التذاكر تنزل الجمعة 9 الليل"], ["p", "إذا تبي أحجز لك معي"]]],
  ["15", 3, [["p", "عزيزي العميل، تم تعليق حسابك مؤقتاً"], ["p", "لإعادة التفعيل أرسل رمز التحقق الذي وصلك برسالة SMS خلال 10 دقائق"], ["p", "أو اضغط الرابط: bit.ly/verify-acc-now وأدخل بيانات بطاقتك"]]]
];
/* Groups: [title, members, unreadTail, lines]; "m" = the user, otherwise the peer number */
const GROUPS = [
  ["فريق مجتمع+ 🚀", ["01", "02", "04", "08"], 14, [["01", "صباح الخير يا فريق"], ["02", "صباح النور"], ["m", "صباحكم سعيد، عندنا إصدار اليوم"], ["04", "وش يشمل؟"], ["m", "ذكاء الرسائل: ملخص، ردود مقترحة، تحسين الصياغة"], ["08", "رهيب 👏"], ["01", "الاختبارات خلصت؟"], ["m", "باقي جولة أخيرة"], ["02", "أنا أراجع صفحة الإعدادات"], ["04", "لقيت مشكلة بسيطة بالوضع الليلي"], ["04", "لون الزر باهت شوي"], ["01", "أصلحها في نفس الإصدار؟"], ["08", "أقترح نأجلها للإصدار الجاي"], ["02", "أتفق مع يوسف"], ["01", "طيب نسجلها كمهمة"], ["04", "سجلتها، أولوية متوسطة"], ["08", "اجتماع المراجعة الخميس 3 العصر"], ["02", "مناسب لي"], ["01", "وأنا بعد"], ["04", "أجهز ملخص الأرقام"], ["08", "لا تنسون نحدّث صفحة المستجدات"], ["02", "تم 👍"]]],
  ["العائلة ❤️", ["07", "12", "13"], 16, [["12", "السلام عليكم يا أهل"], ["13", "وعليكم السلام"], ["07", "عشاء الجمعة عند أمي الساعة 8"], ["12", "أجيب الحلى"], ["13", "وأنا أجيب العصير"], ["m", "وأنا أجيب الخبز والسلطة"], ["07", "لا تتأخرون"], ["12", "فيه أحد يقدر يمر على جدتي ويجيبها؟"], ["13", "أنا أمر عليها 7:30"], ["07", "الله يجزاك خير"], ["12", "شفتوا صور العيد؟ نزلتها بالمجلد"], ["13", "حلوة مرة 😍"], ["07", "الصورة الثالثة أحلى وحدة"], ["12", "تذكير: عيد ميلاد أمي الاثنين"], ["13", "نسوي لها مفاجأة؟"], ["07", "إيه نحجز مطعم الثلاثاء"], ["12", "أنا أتواصل مع المطعم"], ["13", "الميزانية كم للشخص؟"], ["07", "حوالي 150 ريال"], ["12", "تمام، أحجز لـ 9 أشخاص"], ["13", "👍"], ["07", "هيمو وين ردك؟ 😄"]]],
  ["مجتمع المصممين", ["03", "05", "10", "14"], 12, [["10", "شاركوا أعمالكم لهذا الأسبوع"], ["05", "هذا تصميم شعار لمقهى محلي"], ["03", "الألوان دافئة وحلوة"], ["14", "الخط العربي يحتاج مسافة أكبر بين الحروف"], ["05", "ملاحظة في محلها، شكراً"], ["10", "مين يعرف أداة حلوة للتدرجات؟"], ["03", "أستخدم Coolors"], ["14", "وفيه Mesh Gradient برضو"], ["m", "أنصح بأدوات Figma الجديدة للتدرج"], ["10", "تحدي الأسبوع: تصميم بطاقة دعوة"], ["05", "متى آخر موعد؟"], ["10", "الأحد 11:59 الليل"], ["03", "داخلة 🔥"], ["14", "وأنا"], ["05", "فيه جوائز؟"], ["10", "شارة المصمم المميز"], ["03", "حماس"], ["14", "بالتوفيق للجميع"]]],
  ["شباب الحي ⚽", ["06", "11", "13", "02"], 10, [["11", "مباراة الخميس؟"], ["06", "أكيد، الساعة كم؟"], ["11", "9 الليل بالملعب الجديد"], ["13", "أنا معكم"], ["02", "ممكن أتأخر ربع ساعة"], ["m", "أنا جاهز"], ["11", "كل واحد يدفع 25 ريال للحجز"], ["06", "حولت"], ["13", "حولت بعد"], ["11", "باقي اثنين ما حولوا"], ["02", "أحول الحين"], ["06", "مين يجيب الكورة؟"], ["11", "أنا"], ["13", "نحتاج شخصين بعد عشان نكمل"], ["06", "أكلم أخوي"], ["11", "ممتاز"]]],
  ["Project Atlas (EN)", ["09", "04", "01"], 8, [["09", "Morning all, quick update on Atlas"], ["09", "The API integration is done, QA starts tomorrow"], ["04", "Great news! Any blockers?"], ["09", "We still need the final Arabic copy for the onboarding screens"], ["m", "I'll send the Arabic copy today"], ["01", "I can review the RTL layout once it's in"], ["09", "Perfect. Demo for the client is on Sunday at 1 PM"], ["04", "Should we prepare slides?"], ["09", "Yes, 10 slides max please"], ["01", "On it"], ["09", "Thanks team, let's keep it tight"], ["04", "👍"]]],
  ["دفعة الجامعة 2015", ["06", "08", "11", "13", "02"], 18, [["08", "يا جماعة تذكرون الدكتور سالم؟"], ["06", "إيه أكيد، وش فيه؟"], ["08", "تقاعد وبنسوي له حفل تكريم"], ["11", "فكرة حلوة"], ["13", "متى؟"], ["08", "مبدئياً 15 نوفمبر"], ["02", "أنا أتكفل بالقاعة"], ["06", "وأنا التصوير"], ["m", "أنا أصمم الدعوة"], ["08", "ممتاز يا هيمو"], ["11", "نجمع مبلغ للهدية؟"], ["13", "اقترح 100 ريال لكل واحد"], ["06", "موافق"], ["02", "موافق"], ["08", "أنا أجمع المبالغ"], ["11", "وش الهدية؟"], ["13", "ساعة فخمة؟"], ["06", "أو درع تذكاري"], ["02", "الدرع أفضل"], ["08", "نصوت؟"], ["11", "درع ✋"], ["13", "درع"], ["06", "درع"], ["08", "تم: درع تذكاري"]]],
  ["مشتريات البيت", ["07", "12"], 6, [["07", "ناقص البيت حليب وخبز وبيض"], ["12", "وأرز ودجاج"], ["m", "أنا أمر السوبرماركت بعد الدوام"], ["07", "وجيب منظف أرضيات"], ["12", "والفواتير؟ فاتورة الكهرباء آخر موعد لها 5 نوفمبر"], ["07", "أنا أدفعها اليوم"], ["12", "وموعد صيانة المكيف الأحد 10 الصبح"], ["07", "أنا بالبيت ذاك الوقت"], ["12", "تمام"], ["m", "وصلت السوبرماركت، شي ثاني؟"]]],
  ["مستثمري الشركات الناشئة", ["02", "08", "13", "09"], 9, [["02", "شفتوا تقرير الربع الثالث؟"], ["13", "النمو 18٪ ممتاز"], ["08", "بس المصاريف ارتفعت"], ["02", "طبيعي مع التوظيف"], ["m", "وش خطة الربع الجاي؟"], ["13", "التركيز على الاحتفاظ بالعملاء"], ["08", "اجتماع المستثمرين 20 نوفمبر"], ["02", "أحتاج العرض قبلها بأسبوع"], ["13", "أجهزه إن شاء الله"], ["08", "ولا تنسون تقرير التدفق النقدي"], ["02", "موجود في المجلد المشترك"], ["13", "شكراً"], ["08", "أي استفسار قبل الاجتماع؟"]]],
  ["حلقة تحفيظ الحي", ["06", "11", "13"], 5, [["06", "الحلقة اليوم بعد العصر بإذن الله"], ["11", "حاضر"], ["13", "أنا متأخر 10 دقائق"], ["m", "حاضر إن شاء الله"], ["06", "المراجعة من سورة الملك"], ["11", "تم"], ["06", "وفيه مسابقة آخر الشهر"], ["13", "متى بالضبط؟"], ["06", "الجمعة 28 بعد المغرب"], ["11", "حماس"]]],
  ["رحلة العلا 🏜️", ["05", "10", "03", "14"], 11, [["05", "متى نحجز رحلة العلا؟"], ["10", "إجازة نهاية الأسبوع الجاي"], ["03", "أنا أشوف الفنادق"], ["14", "أنا أشوف الطيران"], ["m", "ميزانيتي حوالي 2500 ريال"], ["05", "مناسبة"], ["03", "لقيت فندق 650 ريال الليلة"], ["14", "الطيران الخميس 7 الصبح والعودة السبت 9 الليل"], ["10", "ممتاز"], ["05", "نحجز جولة الهلال الأحمر؟"], ["03", "أكيد، والمرايا"], ["14", "أحجز الطيران الحين؟"], ["10", "انتظر نتأكد من الكل"], ["05", "أنا مؤكدة"], ["03", "مؤكدة"], ["10", "أنا بعد"], ["14", "باقي هيمو"]]]
];

module.exports = (ctx) => {
  const { db, log } = ctx;
  const on = process.env.DEMO_MESSAGES === "1";
  const cap = +(process.env.DEMO_MESSAGES_USERS || 100);
  const iso = (ms) => new Date(ms).toISOString();

  async function ensurePeople(t) {
    for (const [n, name, color] of PEOPLE)
      await t.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,$4,$5,'user',$6,$7) ON CONFLICT DO NOTHING",
        [pid(n), "msgdemo_" + n, name, "حساب تجريبي لاختبار الرسائل", color, { onboarded: true, demo: true }, iso(Date.now() - 60 * 864e5)]);
  }
  async function writeConv(t, uid, cid, kind, title, peers, unread, lines, endMs) {
    const step = 4 * 60e3, start = endMs - lines.length * step;
    const firstUnread = lines.length - unread;
    const lastRead = unread > 0 ? iso(start + (firstUnread - 1) * step + 1000) : iso(endMs + 1000);
    await t.run("INSERT INTO conversations(id,created_at,updated_at,kind,title,owner) VALUES($1,$2,$3,$4,$5,$6)", [cid, iso(start - 864e5), iso(endMs), kind, title, kind === "group" ? uid : null]);
    await t.run("INSERT INTO conversation_members(conv,user_id,state,role,joined_at,last_read_at) VALUES($1,$2,'accepted',$3,$4,$5)", [cid, uid, kind === "group" ? "admin" : "member", iso(start - 864e5), lastRead]);
    for (const p of peers) await t.run("INSERT INTO conversation_members(conv,user_id,state,role,joined_at,last_read_at) VALUES($1,$2,'accepted','member',$3,$4)", [cid, pid(p), iso(start - 864e5), iso(endMs)]);
    let i = 0;
    for (const [who, text] of lines) {
      const sender = who === "m" ? uid : pid(who === "p" ? peers[0] : who);
      await t.run("INSERT INTO messages(id,conv,sender,text,created_at,kind,meta) VALUES($1,$2,$3,$4,$5,'text',$6)", [`${cid}_${String(i).padStart(3, "0")}`, cid, sender, text, iso(start + i * step), { demo: true }]);
      i++;
    }
    return lines.length;
  }
  async function seedFor(uid) {
    const tag = "cv_dmsg_" + uid.replace(/[^a-zA-Z0-9]/g, "").slice(-16) + "_";
    if (await db.get("SELECT id FROM conversations WHERE id LIKE $1 LIMIT 1", [tag + "%"])) return 0;
    let n = 0; const t0 = Date.now();
    await db.tx(async (t) => {
      await ensurePeople(t);
      let k = 0;
      for (const [peer, unread, lines] of DMS) n += await writeConv(t, uid, tag + "d" + k, "dm", null, [peer], unread, lines, t0 - (k++ * 47 + 5) * 60e3);
      k = 0;
      for (const [title, members, unread, lines] of GROUPS) n += await writeConv(t, uid, tag + "g" + k, "group", title, members, unread, lines, t0 - (k++ * 31 + 2) * 60e3);
    });
    return n;
  }
  async function seedAll() {
    const users = await db.all("SELECT id FROM users WHERE id NOT LIKE 'u_dmsg%' AND id NOT LIKE 'u_demo%' ORDER BY created_at LIMIT $1", [cap]);
    let total = 0; for (const u of users) total += await seedFor(u.id);
    return total;
  }
  async function removeAll() {
    const c = await db.get("SELECT COUNT(*) n FROM conversations WHERE id LIKE 'cv_dmsg_%'");
    if (!Number(c?.n)) return 0;
    await db.tx(async (t) => {
      await t.run("DELETE FROM message_reactions WHERE msg IN (SELECT id FROM messages WHERE conv LIKE 'cv_dmsg_%')");
      await t.run("DELETE FROM messages WHERE conv LIKE 'cv_dmsg_%'");
      await t.run("DELETE FROM conversation_members WHERE conv LIKE 'cv_dmsg_%'");
      await t.run("DELETE FROM conversations WHERE id LIKE 'cv_dmsg_%'");
    });
    for (const [n] of PEOPLE) { try { await db.run("DELETE FROM users WHERE id=$1", [pid(n)]); } catch { /* still referenced elsewhere: keep the demo account */ } }
    return Number(c.n);
  }
  async function boot() {
    try {
      if (on) { const n = await seedAll(); if (n) log?.info?.("demo messages seeded", { messages: n }); }
      else { const n = await removeAll(); if (n) log?.info?.("demo messages removed", { conversations: n }); }
    } catch (e) { log?.error?.("demo messages failed", { err: e }); }
  }
  if (on) { const t = setInterval(() => seedAll().catch(() => { }), 10 * 60e3); t.unref?.(); } // new sign-ups get the demo chats too
  return { on, boot, seedFor, seedAll, removeAll, counts: { conversations: DMS.length + GROUPS.length, messages: [...DMS, ...GROUPS].reduce((s, x) => s + x[x.length - 1].length, 0) } };
};
