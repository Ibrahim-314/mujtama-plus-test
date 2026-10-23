/* Small Arab-world gazetteer for location trends (Phase 23). Free-text locations ("جدة", "Jeddah",
 * "حي الشاطئ، جدة", "الرياض - السعودية") resolve to { city, country } using normalised matching.
 * Unknown places still count toward their country when a country name or ISO code is present. */
const A = require("./arabic");
const COUNTRIES = {
  SA: ["السعودية", "المملكة العربية السعودية", "saudi", "saudi arabia", "ksa"], EG: ["مصر", "egypt"], AE: ["الإمارات", "الامارات", "uae", "emirates"], KW: ["الكويت", "kuwait"],
  QA: ["قطر", "qatar"], BH: ["البحرين", "bahrain"], OM: ["عمان", "سلطنة عمان", "oman"], JO: ["الأردن", "الاردن", "jordan"], MA: ["المغرب", "morocco"], DZ: ["الجزائر", "algeria"],
  TN: ["تونس", "tunisia"], IQ: ["العراق", "iraq"], LB: ["لبنان", "lebanon"], SY: ["سوريا", "syria"], SD: ["السودان", "sudan"], LY: ["ليبيا", "libya"], YE: ["اليمن", "yemen"], PS: ["فلسطين", "palestine"]
};
const COUNTRY_AR = { SA: "السعودية", EG: "مصر", AE: "الإمارات", KW: "الكويت", QA: "قطر", BH: "البحرين", OM: "عُمان", JO: "الأردن", MA: "المغرب", DZ: "الجزائر", TN: "تونس", IQ: "العراق", LB: "لبنان", SY: "سوريا", SD: "السودان", LY: "ليبيا", YE: "اليمن", PS: "فلسطين" };
/** @type {[string, string, string[]][]} [city, ISO country, alternative spellings] */
const CITIES = [
  ["الرياض", "SA", ["riyadh"]], ["جدة", "SA", ["jeddah", "jedda", "جده"]], ["مكة", "SA", ["مكة المكرمة", "makkah", "mecca"]], ["المدينة المنورة", "SA", ["madinah", "medina"]],
  ["الدمام", "SA", ["dammam"]], ["الخبر", "SA", ["khobar"]], ["الطائف", "SA", ["taif"]], ["أبها", "SA", ["abha"]], ["تبوك", "SA", ["tabuk"]], ["بريدة", "SA", ["buraydah"]],
  ["القاهرة", "EG", ["cairo"]], ["الإسكندرية", "EG", ["alexandria"]], ["الجيزة", "EG", ["giza"]], ["دبي", "AE", ["dubai"]], ["أبوظبي", "AE", ["أبو ظبي", "abu dhabi"]], ["الشارقة", "AE", ["sharjah"]],
  ["الكويت", "KW", ["kuwait city"]], ["الدوحة", "QA", ["doha"]], ["المنامة", "BH", ["manama"]], ["مسقط", "OM", ["muscat"]], ["عمّان", "JO", ["amman", "عمان الأردن", "عمان الاردن"]], ["الرباط", "MA", ["rabat"]],
  ["الدار البيضاء", "MA", ["casablanca"]], ["مراكش", "MA", ["marrakech"]], ["الجزائر العاصمة", "DZ", ["algiers"]], ["تونس العاصمة", "TN", ["tunis"]], ["بغداد", "IQ", ["baghdad"]],
  ["بيروت", "LB", ["beirut"]], ["دمشق", "SY", ["damascus"]], ["الخرطوم", "SD", ["khartoum"]], ["طرابلس", "LY", ["tripoli"]], ["صنعاء", "YE", ["sanaa"]]
];
const key = (s) => " " + A.normalize(s).replace(/(^| )ال/g, "$1") + " ";
// «عمّان» (Amman) and «عُمان» (Oman) normalise to the same letters: Amman is only matched with its country
const AMBIGUOUS = new Set(["عمّان"]);
const CITY_IDX = CITIES.flatMap(([city, cc, alts]) => [...(AMBIGUOUS.has(city) ? [] : [city]), ...alts].map(n => ({ k: key(n), city, cc }))).sort((a, b) => b.k.length - a.k.length);
const COUNTRY_IDX = Object.entries(COUNTRIES).flatMap(([cc, ns]) => ns.map(n => ({ k: key(n), cc }))).sort((a, b) => b.k.length - a.k.length);
/** @param {string|null|undefined} text @param {string|null} [countryHint] */
function resolve(text, countryHint = null) {
  const k = key(text || "");
  const c = CITY_IDX.find(x => k.includes(x.k));
  if (c) return { city: c.city, country: c.cc };
  const co = COUNTRY_IDX.find(x => k.includes(x.k));
  const hint = countryHint && /^[A-Z]{2}$/i.test(countryHint) ? countryHint.toUpperCase() : countryHint ? COUNTRY_IDX.find(x => key(countryHint).includes(x.k))?.cc : null;
  return { city: null, country: co?.cc || hint || null };
}
module.exports = { resolve, COUNTRY_AR, CITIES };
