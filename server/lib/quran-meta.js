/* Quran metadata for halaqa progress tracking (phase 71): the 114 surahs in mushaf order with their ayah counts
 * (Hafs, total 6236). Used only to validate ayah ranges and to measure memorisation coverage — no text is stored. */
const NAMES = ["الفاتحة", "البقرة", "آل عمران", "النساء", "المائدة", "الأنعام", "الأعراف", "الأنفال", "التوبة", "يونس", "هود", "يوسف", "الرعد", "إبراهيم", "الحجر", "النحل", "الإسراء", "الكهف", "مريم", "طه",
  "الأنبياء", "الحج", "المؤمنون", "النور", "الفرقان", "الشعراء", "النمل", "القصص", "العنكبوت", "الروم", "لقمان", "السجدة", "الأحزاب", "سبأ", "فاطر", "يس", "الصافات", "ص", "الزمر", "غافر",
  "فصلت", "الشورى", "الزخرف", "الدخان", "الجاثية", "الأحقاف", "محمد", "الفتح", "الحجرات", "ق", "الذاريات", "الطور", "النجم", "القمر", "الرحمن", "الواقعة", "الحديد", "المجادلة", "الحشر", "الممتحنة",
  "الصف", "الجمعة", "المنافقون", "التغابن", "الطلاق", "التحريم", "الملك", "القلم", "الحاقة", "المعارج", "نوح", "الجن", "المزمل", "المدثر", "القيامة", "الإنسان", "المرسلات", "النبأ", "النازعات", "عبس",
  "التكوير", "الانفطار", "المطففين", "الانشقاق", "البروج", "الطارق", "الأعلى", "الغاشية", "الفجر", "البلد", "الشمس", "الليل", "الضحى", "الشرح", "التين", "العلق", "القدر", "البينة", "الزلزلة", "العاديات",
  "القارعة", "التكاثر", "العصر", "الهمزة", "الفيل", "قريش", "الماعون", "الكوثر", "الكافرون", "النصر", "المسد", "الإخلاص", "الفلق", "الناس"];
const AYAHS = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6];
const TOTAL = AYAHS.reduce((a, b) => a + b, 0);
const SURAHS = NAMES.map((name, i) => ({ n: i + 1, name, ayahs: AYAHS[i] }));
/** validates a range; returns { surah, from, to, count } or throws */
function range(surah, from, to) {
  const s = Math.round(+surah); if (!(s >= 1 && s <= 114)) throw new Error("surah");
  const max = AYAHS[s - 1], f = from === undefined || from === null || from === "" ? 1 : Math.round(+from), t = to === undefined || to === null || to === "" ? max : Math.round(+to);
  if (!(f >= 1 && t >= f && t <= max)) throw new Error("ayah");
  return { surah: s, from: f, to: t, count: t - f + 1 };
}
/** distinct ayahs covered by a list of ranges → { total, bySurah: { n: covered } } */
function coverage(ranges) {
  const sets = new Map();
  for (const r of ranges) { if (!r.surah) continue; const s = sets.get(r.surah) || new Set(); for (let a = r.from; a <= r.to; a++) s.add(a); sets.set(r.surah, s); }
  const bySurah = {}; let total = 0; for (const [n, s] of sets) { bySurah[n] = s.size; total += s.size; }
  return { total, bySurah, percent: Math.round((total / TOTAL) * 1000) / 10, completeSurahs: Object.entries(bySurah).filter(([n, c]) => c === AYAHS[+n - 1]).length };
}
module.exports = { SURAHS, AYAHS, TOTAL, range, coverage };
