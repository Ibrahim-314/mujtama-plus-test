/* The prologue — «الإشارة» (Season 1: The Signal). Words only: the subtitles and the closing title. The camera shots
 * live in scenes/prologue-shots.js, the places in bjs/prologue-sets.js, the scene itself in scenes/prologue.js.
 * Lines are { ar, en }. `at` and `dur` are seconds from the start of the sequence. Yousuf's message is the user's exact
 * Arabic text, split over three cards (joined with a space they give the line back word for word). */
export const YOUSUF_MESSAGE = "إذا وصلتك هذي، فأنا ما قدرت أرجع. الطابق الأربعين… المفتاح عندك من زمان. لا تثق بالشاشات…";

const WHO = {
  narrator: { ar: "الراوي", en: "Narrator" },
  yousuf: { ar: "يوسف — تسجيل", en: "Yousuf — recording" },
  mother: { ar: "الأم", en: "Mother" }
};

export const PROLOGUE = {
  id: "prologue",
  season: { ar: "الموسم الأول", en: "Season 1" },
  /** the closing title, exactly as the season is named (Arabic always; the English line sits under it) */
  title: { ar: "مجتمع — الموسم الأول: الإشارة", en: "Mujtama — Season 1: The Signal" },
  skip: { ar: "تخطٍّ", en: "Skip" },
  subtitles: [
    { at: 2.5, dur: 6, who: WHO.narrator, text: { ar: "جنوب الجزيرة، عام 2077… بعد عشر سنين من الانطفاء الكبير.", en: "The far south, 2077… ten years after the Great Blackout." } },
    { at: 18.2, dur: 3.6, who: WHO.narrator, text: { ar: "جهاز أبوك… ساكت من عشر سنين.", en: "Your father's device… silent for ten years." } },
    { at: 25.8, dur: 4.6, who: WHO.yousuf, text: { ar: "إذا وصلتك هذي، فأنا ما قدرت أرجع.", en: "If this reaches you, I couldn't make it back." } },
    { at: 30.8, dur: 3.6, who: WHO.yousuf, text: { ar: "الطابق الأربعين… المفتاح عندك من زمان.", en: "The fortieth floor… you've had the key for a long time." } },
    { at: 34.6, dur: 2.4, who: WHO.yousuf, text: { ar: "لا تثق بالشاشات…", en: "Don't trust the screens…" } },
    { at: 39.4, dur: 5.4, who: WHO.mother, text: { ar: "خذه… أبوك قال إنك بتعرف متى تحتاجه.", en: "Take it… your father said you'd know when you needed it." } },
    { at: 45.0, dur: 2.8, who: WHO.narrator, text: { ar: "مفتاح نحاسي قديم… محفور عليه رقم 40.", en: "An old brass key… the number 40 struck into it." } },
    { at: 50, dur: 5, who: WHO.narrator, text: { ar: "بعد ثلاثة أيام… القطار المغناطيسي إلى المدينة الرقمية.", en: "Three days later… the magnetic train to the Digital City." } },
    { at: 62.5, dur: 4.6, who: WHO.narrator, text: { ar: "المدينة الرقمية… وفي قلبها برج MJT الذهبي.", en: "The Digital City… and at its heart, the golden MJT Tower." } },
    { at: 67.6, dur: 3.8, who: WHO.narrator, text: { ar: "في مكانٍ ما بين طوابقه… ينقطع أثر يوسف.", en: "Somewhere among its floors… Yousuf's trail goes cold." } },
    { at: 76.0, dur: 4.2, who: WHO.narrator, text: { ar: "إشارة مجهولة تخترق شاشة القطار… ومعها رقم واحد: 40.", en: "An unknown signal breaks into the train's screen… carrying one number: 40." } }
  ]
};
