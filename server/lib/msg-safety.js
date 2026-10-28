/* v2.135 — local scam/phishing signals for chat messages (no AI, no network, runs on every history load).
 * Returns reason codes; a score of 3+ (one strong signal, or two weaker ones) = risky. Arabic (incl. dialect) + English.
 * Only messages from OTHER people are checked, and never encrypted ones (the server cannot read them). */
const AR = require("./arabic");
const RULES = [
  ["otp", 3, /(رمز|كود|كوود|code|otp|pin)\s*(ال)?(تحقق|التفعيل|التأكيد|السري|verification|security)?.{0,40}(ارسل|أرسل|ارسله|أرسله|عطني|اعطني|ابعث|send|share|give)|(ارسل|أرسل|ابعث|عطني|اعطني|send|share).{0,40}(رمز|كود|otp|pin|verification code)/i],
  ["card", 3, /(رقم|بيانات|معلومات)\s*(ال)?(بطاق|كرت|الفيزا|الحساب البنكي|الآيبان|الايبان)|(card number|cvv|cvc|expiry date|bank details|iban)/i],
  ["password", 3, /(ارسل|أرسل|عطني|اعطني|send|share).{0,30}(كلمة (ال)?(سر|مرور)|الباسورد|باسوورد|password)/i],
  ["suspended", 2, /(تم|سيتم)\s*(تعليق|إيقاف|ايقاف|حظر|إغلاق|اغلاق|تجميد)\s*(حسابك|بطاقتك|محفظتك)|(account|card|wallet)\s*(has been|will be)\s*(suspended|locked|blocked|closed)/i],
  ["prize", 2, /(مبروك|تهانينا).{0,40}(ربحت|فزت|جائزة|سحب)|(ربحت|فزت)\s*(بـ|ب)?\s*(جائزة|مبلغ|آيفون|ايفون|سيارة)|(you (have )?won|claim your (prize|reward))/i],
  ["urgent", 1, /(خلال|في غضون)\s*\d+\s*(دقيقة|دقائق|ساعة|ساعات)|(فوراً|فورا|حالاً|حالا|عاجل)|(within \d+ (minutes|hours)|immediately|urgent)/i],
  ["transfer", 2, /(حوّل|حول|تحويل)\s*(لي|مبلغ|رسوم).{0,40}(ريال|دولار|sar|usd|\d)|(send|transfer) (me )?(money|\$\d|fee)|رسوم\s*(تفعيل|استلام|شحن)/i],
  ["shortlink", 2, /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|is\.gd|rb\.gy|shorturl\.at|tiny\.cc)\/\S+/i],
  ["fakeofficial", 1, /(خدمة العملاء|الدعم الفني|إدارة|ادارة)\s*(البنك|أبشر|ابشر|المرور|التطبيق|مجتمع)|(customer service|support team|bank security)/i]
];
function scamSignals(text) {
  const t = String(text || ""); if (t.length < 8) return { risky: false, score: 0, reasons: [] };
  const n = t + " " + AR.normalize(t);
  let score = 0; const reasons = [];
  for (const [code, w, re] of RULES) if (re.test(n)) { score += w; reasons.push(code); }
  return { risky: score >= 3, score, reasons };
}
module.exports = { scamSignals };
