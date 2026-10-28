/* v2.123 search lexicon — synonym / transliteration / dialect groups used for QUERY expansion only (the index keeps what
 * people actually wrote). A query word that belongs to a group also matches every other member, at a lower weight than
 * the word itself. Groups are deliberately conservative: true equivalents, common Arabizi/English spellings of loanwords
 * and Gulf/Levantine/Egyptian everyday words. Meaning-level matches beyond this list are the job of stage 2 (vectors).
 * Words are written naturally; they are normalised when the module loads. */
const A = require("./arabic");
const RAW = [
  // technology & programming
  ["بايثون", "بايثن", "بايتون", "python"], ["جافاسكربت", "جافا سكربت", "جافاسكريبت", "javascript", "js"], ["جافا", "java"],
  ["رياكت", "react"], ["فيو", "vue"], ["نود", "node", "nodejs"], ["تايب سكربت", "typescript"], ["سي شارب", "csharp", "c#"],
  ["فلاتر", "flutter"], ["سويفت", "swift"], ["كوتلن", "kotlin"], ["لينكس", "linux"], ["ويندوز", "windows"], ["ماك", "mac", "macbook", "ماك بوك"],
  ["ايفون", "آيفون", "iphone"], ["اندرويد", "android"], ["ايباد", "ipad"], ["قيم", "game", "games", "لعبه", "العاب", "قيمز"],
  ["برمجه", "برمجيات", "كود", "كودنق", "coding", "programming"], ["مبرمج", "مطور", "developer", "دفلوبر"],
  ["لابتوب", "لاب توب", "حاسب محمول", "كمبيوتر محمول", "laptop", "notebook"], ["كمبيوتر", "حاسوب", "حاسب", "computer", "pc"],
  ["جوال", "موبايل", "تلفون", "هاتف", "mobile", "phone"], ["تطبيق", "ابلكيشن", "برنامج", "app", "application"],
  ["ذكاء اصطناعي", "ai", "الذكاء الاصطناعي", "artificial intelligence"], ["تشات جي بي تي", "شات جي بي تي", "chatgpt", "gpt"],
  ["قاعده بيانات", "داتابيس", "database", "db"], ["سيرفر", "خادم", "server"], ["موقع", "ويب", "website", "web"],
  ["كورس", "دوره", "دورات", "course", "courses", "كورسات"], ["شهاده", "certificate", "سرتفكيت"], ["مشروع", "project", "بروجكت"],
  ["امن سيبراني", "سايبر", "cybersecurity", "cyber"], ["تصميم", "ديزاين", "design"], ["واجهه", "ui", "يو اي"], ["تجربه مستخدم", "ux"],
  ["فيديو", "مقطع", "video", "كليب"], ["صوره", "صور", "photo", "image", "picture"], ["بث", "لايف", "live", "stream"],
  // work & study
  ["سيره ذاتيه", "سي في", "cv", "resume", "ريزيوم"], ["وظيفه", "شغل", "دوام", "job", "وظايف"], ["مقابله", "انترفيو", "interview"],
  ["راتب", "معاش", "salary"], ["تدريب", "تدريب تعاوني", "internship", "انترنشب"], ["جامعه", "university", "كليه"], ["ماجستير", "master", "masters"],
  ["منحه", "ابتعاث", "scholarship"], ["ريادة اعمال", "ريادي", "startup", "ستارت اب", "شركه ناشئه"], ["استثمار", "investment", "invest"],
  ["فريلانس", "عمل حر", "freelance", "freelancer"], ["تسويق", "ماركتنق", "marketing"],
  // food & places
  ["قهوه", "كوفي", "coffee", "كافي"], ["مقهي", "كافيه", "كوفي شوب", "cafe", "كوفيه", "كوفيهات"], ["محمصه", "محامص", "roastery"],
  ["مطعم", "restaurant", "مطاعم"], ["برقر", "برجر", "burger"], ["بيتزا", "pizza"], ["شاورما", "shawarma"], ["حلا", "حلويات", "dessert"],
  ["جده", "jeddah", "jedda"], ["الرياض", "رياض", "riyadh"], ["مكه", "makkah", "mecca"], ["المدينه", "madinah", "medina"], ["الدمام", "dammam"],
  ["ابها", "abha"], ["الطايف", "طايف", "taif"], ["العلا", "alula"], ["دبي", "dubai"], ["القاهره", "cairo"],
  ["شقه", "شقق", "apartment", "flat"], ["فيلا", "villa"], ["ايجار", "اجار", "rent"], ["حي", "منطقه", "district"],
  // everyday & dialect
  ["سياره", "سيارات", "موتر", "car", "عربيه"], ["دركسون", "سكان", "مقود", "steering"], ["كفرات", "اطارات", "tires", "تواير"],
  ["رجيم", "دايت", "diet", "حميه"], ["نادي", "جيم", "gym"], ["تمارين", "رياضه", "workout", "exercise"], ["وزن", "تنحيف", "تخسيس"],
  ["طفل", "بيبي", "رضيع", "baby"], ["اطفال", "عيال", "بزران", "kids", "children"], ["زوجه", "مدام", "حرمه"], ["ام", "والده", "امي"],
  ["تاشيره", "فيزا", "visa"], ["شنغن", "شينغن", "schengen"], ["سفر", "سفريات", "travel", "رحله", "رحلات"], ["فندق", "hotel", "فنادق"],
  ["طيران", "رحله جويه", "flight", "flights", "تذكره"], ["مطار", "airport"], ["عطله", "اجازه", "holiday", "vacation"],
  ["فلوس", "مال", "بيزات", "money"], ["رخيص", "ارخص", "cheap"], ["غالي", "expensive"], ["عرض", "عروض", "خصم", "تخفيض", "offer", "discount", "sale"],
  ["كويس", "زين", "حلو", "ممتاز", "good"], ["افضل", "احسن", "best"], ["مشكله", "خلل", "عطل", "problem", "issue"], ["سؤال", "استفسار", "question"],
  ["كتاب", "كتب", "book", "books"], ["روايه", "novel"], ["فلم", "فيلم", "movie", "film", "افلام"], ["مسلسل", "series", "مسلسلات"],
  ["كوره", "كره قدم", "football", "soccer"], ["الهلال", "هلال", "alhilal"], ["النصر", "نصر", "alnassr"], ["الاتحاد", "اتحاد", "ittihad"], ["الاهلي", "اهلي", "alahli"],
  ["باي", "pi", "عمله باي", "pi network"],
];
const GROUPS = RAW.map((g) => [...new Set(g.map((w) => A.normalize(w)).filter(Boolean))]);
const BY = new Map(); // word or phrase (normalised) → group index list
GROUPS.forEach((g, i) => { for (const w of g) { const l = BY.get(w) || []; l.push(i); BY.set(w, l); } });
/** members of every group the (normalised) word or phrase belongs to, itself excluded */
function related(w) {
  const out = new Set();
  for (const i of BY.get(w) || []) for (const x of GROUPS[i]) if (x !== w) out.add(x);
  return [...out];
}
/** multi-word entries («سيره ذاتيه») found in a normalised query string */
function phrases(nq) {
  const out = [];
  for (const k of BY.keys()) if (k.includes(" ") && (" " + nq + " ").includes(" " + k + " ")) out.push(k);
  return out;
}
module.exports = { related, phrases, GROUPS };
