/* Help center + support resources + first versions of the content policies (Track 7, phase 33).
 * Static Arabic content. Everything here is INFORMATIONAL — it is not medical, legal or crisis advice.
 * Phone numbers: only numbers confirmed on an official source are filled in (`verified: true`, with the
 * source page). Anything we could not confirm is a placeholder (`phone: null, placeholder: true`) that an
 * admin fills from the dashboard (PUT /api/admin/help/resources/:key) after checking it.
 * Checked on 2026-10-16 against:
 *   my.gov.sa/en/emergency-contact (911, 997, 999) · moh.gov.sa contact page (937, 24/7)
 *   moh.gov.sa/ministry/information-and-services/pages/psychiatry.aspx (920033360, psychological consultations)
 *   hrsd.gov.sa family-protection page (1919, 24/7) · childhelplineinternational.org (116111, Saudi Child Helpline)
 *   my.gov.sa/ar/services/116567 (Qareboon app by the National Center for Mental Health Promotion) */

/** @typedef {{ key: string, category: string, name: string, desc: string, phone: string|null, url: string|null, hours: string|null, verified: boolean, placeholder?: boolean, source: string|null, country: string }} Resource */

const DISCLAIMER = "المحتوى في مركز المساعدة للتوعية والإرشاد العام فقط، وليس بديلاً عن استشارة طبيب أو مختص نفسي أو جهة رسمية. إن كنت أنت أو أي شخص في خطر فوري فاتصل بالرقم الموحد للطوارئ 911.";
const CATEGORIES = { emergency: "طوارئ", mental: "الدعم النفسي", family: "الحماية الأسرية", child: "الأطفال", online: "الابتزاز والجرائم الإلكترونية", platform: "مجتمع بلس" };

/** @type {Resource[]} */
const RESOURCES = [
  { key: "emergency", category: "emergency", name: "الرقم الموحد للطوارئ", desc: "للخطر الفوري على الحياة أو السلامة.", phone: "911", url: "https://my.gov.sa/en/emergency-contact", hours: "على مدار الساعة", verified: true, source: "https://my.gov.sa/en/emergency-contact", country: "SA" },
  { key: "ambulance", category: "emergency", name: "الإسعاف (الهلال الأحمر)", desc: "حالات إسعافية وطبية عاجلة.", phone: "997", url: null, hours: "على مدار الساعة", verified: true, source: "https://my.gov.sa/en/emergency-contact", country: "SA" },
  { key: "police", category: "emergency", name: "الشرطة", desc: "التهديد المباشر أو الاعتداء.", phone: "999", url: null, hours: "على مدار الساعة", verified: true, source: "https://my.gov.sa/en/emergency-contact", country: "SA" },
  { key: "moh937", category: "mental", name: "مركز اتصال وزارة الصحة 937", desc: "استشارات طبية هاتفية وتوجيه إلى الخدمات الصحية.", phone: "937", url: "https://www.moh.gov.sa/937/pages/default.aspx", hours: "على مدار الساعة", verified: true, source: "https://www.moh.gov.sa/ministry/about/pages/contactus.aspx", country: "SA" },
  { key: "psych_consult", category: "mental", name: "مركز الاستشارات النفسية", desc: "استشارات نفسية هاتفية يقدمها مختصون. تحقّق من ساعات العمل المعلنة قبل الاتصال.", phone: "920033360", url: "https://www.moh.gov.sa/ministry/information-and-services/pages/psychiatry.aspx", hours: null, verified: true, source: "https://www.moh.gov.sa/ministry/information-and-services/pages/psychiatry.aspx", country: "SA" },
  { key: "qareboon", category: "mental", name: "تطبيق «قريبون»", desc: "مكتبة توعوية واستشارات نفسية من المركز الوطني لتعزيز الصحة النفسية.", phone: null, url: "https://my.gov.sa/ar/services/116567", hours: null, verified: true, source: "https://my.gov.sa/ar/services/116567", country: "SA" },
  { key: "family1919", category: "family", name: "مركز بلاغات العنف الأسري", desc: "بلاغات العنف والإيذاء داخل الأسرة، بسرية تامة.", phone: "1919", url: "https://my.gov.sa/ar/services/2776570", hours: "على مدار الساعة", verified: true, source: "https://www.hrsd.gov.sa/ministry/about-ministry/about-us/ministry-sectors/767521/767581", country: "SA" },
  { key: "child116111", category: "child", name: "خط مساندة الطفل", desc: "استشارات ومساندة مجانية للأطفال ومن يرعاهم.", phone: "116111", url: null, hours: null, verified: true, source: "https://childhelplineinternational.org/saudi-arabia-saudi-child-helpline-116111/", country: "SA" },
  { key: "extortion", category: "online", name: "بلاغات الابتزاز الإلكتروني", desc: "لا تدفع ولا تحذف الأدلة؛ احتفظ بلقطات الشاشة وأبلغ الجهة المختصة.", phone: null, url: null, hours: null, verified: false, placeholder: true, source: null, country: "SA" },
  { key: "cybercrime", category: "online", name: "الإبلاغ عن الجرائم المعلوماتية", desc: "الاحتيال والاختراق وانتحال الهوية خارج المنصة.", phone: null, url: null, hours: null, verified: false, placeholder: true, source: null, country: "SA" },
  { key: "platform", category: "platform", name: "فريق السلامة في مجتمع بلس", desc: "أبلغ عن أي منشور أو حساب من زر الأمان بجانبه؛ نراجع البلاغات العاجلة أولاً.", phone: null, url: "#/help/reporting", hours: null, verified: true, source: null, country: "*" }
];

/** help-center articles; body = blocks: ["p", text] | ["ul", [items]] | ["h", text] | ["link", label, href] */
const ARTICLES = [
  { slug: "start", title: "أدوات الأمان في مجتمع بلس", topic: "safety", summary: "كل ما يمكنك فعله لحماية نفسك، في مكان واحد.", body: [
    ["p", "زر الأمان موجود على كل منشور. منه تستطيع بلمسة واحدة: كتم الكاتب أو كلمة، الحظر، التحكم في من يرد، إخفاء الردود على منشوراتك، الإبلاغ، أو تشغيل وضع الحماية."],
    ["ul", ["الكتم يخفي المحتوى عنك دون أن يعلم الطرف الآخر.", "الحظر يمنع الحساب من رؤية ملفك والتفاعل معك ومراسلتك.", "وضع الحماية يحدّ مؤقتاً من الردود والرسائل والإشارات أثناء موجة إساءة."]],
    ["link", "إدارة الحظر والكتم ووضع الحماية", "#/protection"]] },
  { slug: "block-mute", title: "الحظر والكتم والحسابات المرتبطة", topic: "safety", summary: "الفرق بين الكتم والحظر، وكيف نمنع التحايل بحسابات أخرى.", body: [
    ["h", "الكتم"], ["p", "يمكنك كتم حساب أو كلمة أو وسم لمدة ساعة أو يوم أو أسبوع أو شهر أو بشكل دائم، وتحديد مكان الكتم: الخلاصة أو الإشعارات أو الردود أو الكل. نطابق الكلمات العربية بذكاء: «إساءة» تطابق «اساءه» ونتجاهل التشكيل."],
    ["h", "الحظر"], ["p", "عند حظر حساب نقطع المتابعة بالاتجاهين، ونمنعه من التعليق على منشوراتك والإشارة إليك ومراسلتك ورؤية ملفك."],
    ["h", "الحسابات المرتبطة"], ["p", "افتراضياً يشمل الحظر الحسابات المرتبطة بالحساب نفسه: المؤسسات التي يملكها أو يديرها، ومالكي المؤسسة المحظورة، والحسابات التي سُجّل الدخول إليها معاً على الجهاز نفسه. لحماية الخصوصية نخبرك بعدد هذه الحسابات فقط دون كشف هويتها، ويمكنك إلغاء ذلك من خيارات الحظر."]] },
  { slug: "protection-mode", title: "وضع الحماية", topic: "safety", summary: "حين تتعرض لموجة ردود مسيئة أو رسائل من غرباء.", body: [
    ["p", "عند تشغيل وضع الحماية لعدد من الساعات تختاره، تصلك الردود والرسائل والإشارات فقط من الحسابات التي تتابعها، ومن متابعيك الذين تابعوك قبل تشغيل الوضع. المتابعون الجدد أثناء الموجة لا يُحتسبون."],
    ["p", "إذا رصدنا تفاعلاً غير معتاد من حسابات غريبة أو ردوداً مسيئة متكررة نقترح عليك تشغيل الوضع. الاقتراح لا يعاقب أحداً ولا يُفعّل إلا بموافقتك، إلا إذا اخترت التفعيل التلقائي."],
    ["ul", ["ينتهي الوضع تلقائياً في الوقت الذي حددته.", "يمكنك اختيار ما يُقيَّد: الردود، الرسائل، الإشارات.", "لا يُخطر أحد بأنك فعّلت الوضع."]]] },
  { slug: "reply-controls", title: "من يمكنه الرد، وإخفاء الردود", topic: "safety", summary: "تحكّم في النقاش على منشوراتك.", body: [
    ["p", "لكل منشور تختار من يمكنه الرد: الجميع، متابعوك، من أشرت إليهم فقط، أو أعضاء المجتمع إن كان المنشور في مجتمع. من أشرت إليه يستطيع الرد دائماً."],
    ["p", "يمكنك إخفاء أي رد على منشورك. الرد المخفي لا يُحذف: يظهر للجميع خلف عبارة «رد مخفي من الكاتب» ويُعرض بلمسة، ويمكنك إظهاره متى شئت."]] },
  { slug: "reporting", title: "كيف أبلّغ؟ وماذا يحدث بعدها؟", topic: "reporting", summary: "بلاغ من ثلاث خطوات، والبلاغات العاجلة أولاً.", body: [
    ["ul", ["١. ماذا حدث؟ اختر النوع (إساءة، كراهية، إيذاء النفس…).", "٢. التفاصيل: اختر الوصف الأقرب وأضف ملاحظة إن أردت.", "٣. احمِ نفسك: يمكنك الحظر أو الكتم أو إخفاء الرد مع البلاغ نفسه."]],
    ["p", "لا نخبر صاحب المحتوى بمن أبلغ عنه. البلاغات المتعلقة بالتهديد أو إيذاء النفس أو استغلال القاصرين تُراجع بأولوية. إن قررنا إزالة المحتوى يحق لصاحبه الاستئناف."],
    ["link", "سياسات المحتوى", "#/policies"]] },
  { slug: "harassment-wave", title: "إذا تعرضت لحملة إساءة", topic: "safety", summary: "خطوات عملية تحميك الآن.", body: [
    ["ul", ["فعّل وضع الحماية لمدة ٢٤ ساعة على الأقل.", "قيّد الردود على منشوراتك الأخيرة إلى متابعيك.", "اكتم الكلمات والوسوم المستخدمة في الحملة.", "احتفظ بلقطات شاشة قبل الحظر إن كنت ستلجأ لجهة رسمية.", "أبلغ عن الحسابات الأكثر إساءة؛ اختيار «هجوم جماعي منسّق» يساعدنا على الربط بينها.", "خذ استراحة من الشاشة واطلب دعم شخص تثق به."]]] },
  { slug: "mental-health", title: "صحتك النفسية على الإنترنت", topic: "wellbeing", summary: "معلومات عامة للتوعية، وأين تجد دعماً مختصاً.", body: [
    ["p", "من الطبيعي أن تتأثر بالتعليقات السلبية أو المقارنة المستمرة. هذه بعض الممارسات التي يذكرها المختصون عادةً، وهي للتوعية فقط:"],
    ["ul", ["حدّد أوقاتاً بلا إشعارات، واستخدم ساعات الهدوء.", "اكتم ما يزعجك بدل الدخول في جدال.", "تواصل مع أشخاص تثق بهم خارج الإنترنت.", "إذا استمر الحزن أو القلق أو اضطراب النوم فاطلب استشارة مختص."]],
    ["p", "إن راودتك أفكار بإيذاء نفسك فلست وحدك: تحدّث الآن مع شخص تثق به، أو تواصل مع إحدى جهات الدعم أدناه، وفي الخطر الفوري اتصل بـ 911."]] },
  { slug: "supporting-friend", title: "كيف أساعد صديقاً يمر بوقت صعب؟", topic: "wellbeing", summary: "إرشادات عامة للتوعية.", body: [
    ["ul", ["استمع دون حكم أو تقليل من مشاعره.", "اسأله مباشرة وبهدوء إن كان يفكر في إيذاء نفسه؛ السؤال لا يزيد الخطر.", "شجّعه على التواصل مع مختص أو جهة دعم، وساعده في ذلك إن أراد.", "إن كان في خطر فوري فلا تتركه وحده واتصل بـ 911.", "يمكنك الإبلاغ عن منشور يقلقك باختيار «إيذاء النفس»؛ نراجعه بأولوية."]]] },
  { slug: "account-security", title: "تأمين حسابك", topic: "safety", summary: "التحقق بخطوتين ومفاتيح المرور والأجهزة.", body: [
    ["ul", ["فعّل التحقق بخطوتين واحفظ الرموز الاحتياطية.", "راجع الأجهزة المتصلة وسجّل الخروج مما لا تعرفه.", "لا تشارك رموز الدخول مع أحد، ولا حتى مع من يدّعي أنه من فريقنا."]],
    ["link", "مركز الأمان", "#/security"]] }
];

/** first published versions of the centrally-managed content policies (admins publish new versions) */
const DEFAULT_POLICIES = [
  { slug: "community-guidelines", title: "إرشادات المجتمع", summary: "ما المسموح وما الممنوع في مجتمع بلس.", body: `نريد مجتمعاً عربياً آمناً للحوار والتعلم والإبداع. تنطبق هذه الإرشادات على المنشورات والتعليقات والرسائل والملفات الشخصية والمجتمعات.

## الممنوع
- الإساءة والتنمر والتحرش، بما فيه الهجوم الجماعي المنسّق.
- التهديد بالأذى أو التحريض على العنف.
- خطاب الكراهية ضد أي شخص بسبب أصله أو دينه أو جنسه أو إعاقته.
- نشر المعلومات الشخصية الخاصة لأي شخص دون إذنه.
- المحتوى الجنسي الصريح، وأي محتوى يستغل القاصرين (يُحال للجهات المختصة).
- تشجيع إيذاء النفس أو اضطرابات الأكل.
- الاحتيال والروابط المضللة والرسائل المزعجة والحسابات الوهمية.
- انتحال شخصية الأفراد أو الجهات.

## ما نفعله عند المخالفة
- نزيل المحتوى أو نقيّد ظهوره، ونخبر صاحبه بالقرار وسببه.
- قد نوقف الحساب مؤقتاً أو نهائياً عند تكرار المخالفة أو خطورتها.
- يحق لصاحب المحتوى الاستئناف على أي قرار.` },
  { slug: "harassment", title: "سياسة الإساءة والتحرش", summary: "كيف نتعامل مع الإساءة الفردية والجماعية.", body: `## تعريفات
- الإساءة: محتوى يهين شخصاً محدداً أو يحقّره.
- الهجوم الجماعي: مشاركة حسابات متعددة في استهداف شخص في وقت متقارب.
- التحايل على الحظر: استخدام حسابات أخرى للوصول إلى شخص حظرك.

## أدواتك
- الكتم والحظر (ويشمل الحسابات المرتبطة افتراضياً).
- وضع الحماية المؤقت.
- تقييد الردود وإخفاؤها.

## إجراءاتنا
- نعطي أولوية لبلاغات التهديد ونشر المعلومات الخاصة.
- الحسابات التي تتحايل على الحظر تُعامل كمخالفة مستقلة.` },
  { slug: "reporting", title: "سياسة البلاغات", summary: "كيف نراجع البلاغات ونحمي المبلّغين.", body: `- لا نكشف هوية المبلّغ لصاحب المحتوى.
- البلاغات المتعلقة بالتهديد وإيذاء النفس واستغلال القاصرين تُراجع أولاً.
- البلاغات الكيدية المتكررة تقلل وزن بلاغات صاحبها.
- عند إزالة محتوى يحق لصاحبه الاستئناف ويراجع الاستئناف شخص مختلف متى أمكن.` }
];

module.exports = { DISCLAIMER, CATEGORIES, RESOURCES, ARTICLES, DEFAULT_POLICIES };
