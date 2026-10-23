/* Hijri calendar (phase 68) — zero dependencies. Umm al-Qura via the ICU calendar built into Node / every modern browser
 * ("islamic-umalqura"), plus admin moon-sighting overrides: an override says "Hijri month Y/M actually started on Gregorian
 * day G" (an official announcement can differ from the Umm al-Qura tables by a day). Every conversion goes through month
 * starts, so an override moves the whole month consistently (and the previous month's length with it).
 * Dates are plain civil days "YYYY-MM-DD" (no time zone: the caller decides which day "today" is, Asia/Riyadh by default).
 * The same algorithm runs on the client (hijri-ui.js) with the overrides the API returns. */
const DAY = 864e5;
const MONTHS = ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"];
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const G_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const dn = (ymd) => { const m = YMD.exec(String(ymd)); if (!m) throw new Error("bad date"); return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY; };
const ymdOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const validYmd = (s) => { if (!YMD.test(String(s))) return false; const n = dn(s); return ymdOf(n) === s; };
/** today's civil date in a time zone */
const today = (tz = "Asia/Riyadh", at = Date.now()) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at)); } catch { return new Date(at).toISOString().slice(0, 10); } };

/* ICU without the Umm al-Qura calendar (small-icu builds) → tabular Islamic calendar (civil epoch), ±1 day */
const ICU_OK = (() => { try { return fmt.resolvedOptions().calendar === "islamic-umalqura"; } catch { return false; } })();
function tabular(n) {
  const jd = n + 2440588; let l = jd - 1948440 + 10632; const k = Math.floor((l - 1) / 10631); l = l - 10631 * k + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const m = Math.floor((24 * l) / 709), d = l - Math.floor((709 * m) / 24), y = 30 * k + j - 30;
  return { y, m, d };
}
function uqOfDay(n) { // raw Umm al-Qura (no overrides)
  if (!ICU_OK) return tabular(n);
  const p = {}; for (const x of fmt.formatToParts(new Date(n * DAY + DAY / 2))) p[x.type] = x.value;
  return { y: +String(p.year).replace(/\D/g, ""), m: +p.month, d: +p.day };
}
const startCache = new Map();
function uqStart(y, m) { // Gregorian day number on which Umm al-Qura month y/m begins
  const k = y * 12 + m; if (startCache.has(k)) return startCache.get(k);
  let n = Math.floor((y - 1) * 354.36707 + (m - 1) * 29.530589) + 227015 - 719528 + 1; // islamic epoch 622-07-16 → days since 1970
  for (let i = 0; i < 8; i++) { const u = uqOfDay(n), diff = (y - u.y) * 354 + (m - u.m) * 29.5 + (1 - u.d); if (Math.abs(diff) < 0.5) break; n += Math.round(diff); }
  for (let i = 0; i < 40 && uqOfDay(n - 1).m === m && uqOfDay(n - 1).y === y; i++) n--;
  for (let i = 0; i < 40 && !(uqOfDay(n).m === m && uqOfDay(n).y === y && uqOfDay(n).d === 1); i++) n++;
  if (startCache.size > 5000) startCache.clear();
  startCache.set(k, n); return n;
}
const norm = (y, m) => { while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return [y, m]; };

/** A calendar bound to a set of overrides { "1448-9": "2027-02-08", … } */
function calendar(overrides = {}) {
  const start = (y, m) => { [y, m] = norm(y, m); const o = overrides[`${y}-${m}`]; return o && validYmd(o) ? dn(o) : uqStart(y, m); };
  const length = (y, m) => { const [ny, nm] = norm(y, m + 1); return start(ny, nm) - start(y, m); };
  function toHijri(ymd) {
    const n = typeof ymd === "number" ? ymd : dn(ymd), u = uqOfDay(n);
    let best = null;
    for (const dm of [-1, 0, 1]) { const [y, m] = norm(u.y, u.m + dm), s = start(y, m); if (s <= n && (!best || s > best.s)) best = { y, m, s }; }
    const d = n - best.s + 1;
    return { y: best.y, m: best.m, d, monthName: MONTHS[best.m - 1], length: length(best.y, best.m), weekday: WEEKDAYS[new Date(n * DAY).getUTCDay()], g: ymdOf(n) };
  }
  function toGregorian(y, m, d) {
    y = Math.round(+y); m = Math.round(+m); d = Math.round(+d);
    if (!(y >= 1300 && y <= 1600 && m >= 1 && m <= 12 && d >= 1 && d <= 30)) throw new Error("bad hijri date");
    const len = length(y, m); if (d > len) throw new Error("day out of range");
    return ymdOf(start(y, m) + d - 1);
  }
  return { start, length, toHijri, toGregorian, startYmd: (y, m) => ymdOf(start(y, m)), overrides };
}

/* ---------- occasions ---------- */
/* Hijri occasions: [key, name, month, fromDay, toDay (0 = month end), kind, emoji]. kind: season (has a hub) | day | sunnah */
/** @type {Array<[string, string, number, number, number, string, string]>} */
const HIJRI_OCCASIONS = [
  ["new_year", "رأس السنة الهجرية", 1, 1, 1, "day", "i:moon"],
  ["ashura", "يوم عاشوراء", 1, 10, 10, "day", "i:moon"],
  ["ramadan", "شهر رمضان", 9, 1, 0, "season", "i:moon"],
  ["last10", "العشر الأواخر", 9, 21, 0, "day", "i:sparkle"],
  ["eid_fitr", "عيد الفطر", 10, 1, 3, "season", "i:party"],
  ["dhul_hijjah", "عشر ذي الحجة", 12, 1, 10, "day", "i:calendar"],
  ["hajj", "موسم الحج", 12, 8, 13, "season", "i:mapPin"],
  ["arafah", "يوم عرفة", 12, 9, 9, "day", "i:mapPin"],
  ["eid_adha", "عيد الأضحى", 12, 10, 13, "season", "i:party"]
];
/* Gregorian national days by country (fixed dates) */
const NATIONAL = {
  SA: [["sa_founding", "يوم التأسيس السعودي", "02-22"], ["sa_national", "اليوم الوطني السعودي", "09-23"]],
  AE: [["ae_national", "عيد الاتحاد الإماراتي", "12-02"]],
  KW: [["kw_national", "العيد الوطني الكويتي", "02-25"]],
  QA: [["qa_national", "اليوم الوطني القطري", "12-18"]],
  BH: [["bh_national", "العيد الوطني البحريني", "12-16"]]
};
const FLAGS = { SA: "i:flag", AE: "i:flag", KW: "i:flag", QA: "i:flag", BH: "i:flag" }; /* v2.55: Lucide sprite ids, not emoji */
/* Seasons with a hub page: hashtags (canonicalised by the caller), greeting, tips, hue */
const SEASONS = {
  ramadan: { name: "رمضان", emoji: "i:moon", hue: 265, greeting: "رمضان كريم، تقبّل الله منا ومنكم", tags: ["رمضان", "رمضان_كريم", "رمضانيات"],
    tips: ["فعّل وضع التركيز وقت الإفطار من «الاستخدام الصحي» لتبقى مع أهلك", "انضم إلى حلقة قرآن أو مجموعة دراسة لختمة جماعية", "شارك إفطاراً أو فعالية خيرية قريبة منك من صفحة «بالقرب منك»"] },
  eid_fitr: { name: "عيد الفطر", emoji: "i:party", hue: 160, greeting: "عيدكم مبارك، وكل عام وأنتم بخير", tags: ["عيد_الفطر", "العيد", "عيدكم_مبارك"],
    tips: ["هنّئ من تتابعهم برسالة قصيرة", "شارك صور العيد مع وصف بديل لمن يستخدم قارئ الشاشة", "اكتشف فعاليات العيد في مدينتك"] },
  hajj: { name: "موسم الحج", emoji: "i:mapPin", hue: 35, greeting: "حجاً مبروراً وسعياً مشكوراً", tags: ["الحج", "عرفة", "يوم_عرفة", "عيد_الأضحى"],
    tips: ["تابع أخبار الحج من المصادر الرسمية فقط", "يوم عرفة يوم دعاء — جرّب الوضع الهادئ للإشعارات", "تعرّف على الأعمال الموثقة التي تقدّم خدمات الحجاج"] },
  eid_adha: { name: "عيد الأضحى", emoji: "i:party", hue: 20, greeting: "عيد أضحى مبارك، تقبّل الله طاعتكم", tags: ["عيد_الأضحى", "العيد", "عيدكم_مبارك"],
    tips: ["هنّئ أصدقاءك برسالة", "شارك لحظات العيد مع عائلتك ومجتمعك", "ابحث عن الجمعيات الخيرية الموثوقة لتوزيع الأضاحي"] }
};

/** every occasion (hijri + national for the country) that touches the Gregorian range [fromYmd, toYmd] */
function occasions(cal, fromYmd, toYmd, { country = "SA", sunnah = false } = {}) {
  const a = dn(fromYmd), b = dn(toYmd), out = [];
  const h0 = cal.toHijri(a), h1 = cal.toHijri(b);
  for (let y = h0.y; y <= h1.y; y++) for (const [key, name, m, f, t, kind, emoji] of HIJRI_OCCASIONS) {
    let s, e; try { s = dn(cal.toGregorian(y, m, f)); e = t === 0 ? dn(cal.toGregorian(y, m, 1)) + cal.length(y, m) - 1 : dn(cal.toGregorian(y, m, Math.min(t, cal.length(y, m)))); } catch { continue; }
    if (e >= a && s <= b) out.push({ key, name, kind, emoji, hijriYear: y, start: ymdOf(s), end: ymdOf(e), days: e - s + 1 });
  }
  if (sunnah) for (let y = h0.y, m = h0.m; y * 12 + m <= h1.y * 12 + h1.m; [y, m] = norm(y, m + 1)) {
    try { const s = dn(cal.toGregorian(y, m, 13)), e = s + 2; if (e >= a && s <= b) out.push({ key: "white_days", name: "الأيام البيض", kind: "sunnah", emoji: "i:moon", hijriYear: y, start: ymdOf(s), end: ymdOf(e), days: 3 }); } catch { /* month too short */ }
  }
  const gy0 = +fromYmd.slice(0, 4), gy1 = +toYmd.slice(0, 4);
  for (const [key, name, md] of NATIONAL[String(country).toUpperCase()] || []) for (let gy = gy0; gy <= gy1; gy++) {
    const s = dn(`${gy}-${md}`); if (s >= a && s <= b) out.push({ key, name, kind: "national", emoji: FLAGS[String(country).toUpperCase()] || "i:flag", hijriYear: cal.toHijri(s).y, start: ymdOf(s), end: ymdOf(s), days: 1, country: String(country).toUpperCase() });
  }
  return out.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
}

/** state of a season relative to today: the next (or current) occurrence */
function seasonState(cal, key, todayYmd) {
  const def = HIJRI_OCCASIONS.find((o) => o[0] === key); if (!def) return null;
  const t = dn(todayYmd), h = cal.toHijri(t);
  for (const y of [h.y - 1, h.y, h.y + 1, h.y + 2]) {
    const [, , m, f, to] = def; let s, e;
    try { s = dn(cal.toGregorian(y, m, f)); e = to === 0 ? s - f + cal.length(y, m) : dn(cal.toGregorian(y, m, Math.min(to, cal.length(y, m)))); } catch { continue; }
    if (e < t) continue;
    const active = s <= t;
    return { key, hijriYear: y, start: ymdOf(s), end: ymdOf(e), days: e - s + 1, active, dayOf: active ? t - s + 1 : null, daysLeft: active ? null : s - t, remaining: active ? e - t : null };
  }
  return null;
}

/** validate a proposed override against the Umm al-Qura start and its neighbours (months stay 29–30 days) */
function checkOverride(overrides, y, m, ymd) {
  if (!validYmd(ymd)) return "تاريخ غير صالح";
  const base = uqStart(y, m), n = dn(ymd);
  if (Math.abs(n - base) > 2) return "الفرق عن تقويم أم القرى أكثر من يومين";
  const cal = calendar({ ...overrides, [`${y}-${m}`]: ymd });
  const [py, pm] = norm(y, m - 1);
  for (const [yy, mm] of [[py, pm], [y, m]]) { const l = cal.length(yy, mm); if (l < 29 || l > 30) return `يصبح طول شهر ${MONTHS[mm - 1]} ${l} يوماً`; }
  return null;
}

module.exports = { ICU_OK, MONTHS, WEEKDAYS, G_MONTHS, HIJRI_OCCASIONS, NATIONAL, SEASONS, calendar, occasions, seasonState, checkOverride, today, dn, ymdOf, validYmd, uqStart };
