/* Arabic text normalisation for search, trends and summaries (Phase 22).
 * normalize(): tashkeel/tatweel removed, hamza forms unified (أ إ آ ٱ → ا, ؤ → و, ئ → ي, standalone ء dropped),
 * taa marbuta → ه, alef maqsura → ي, Arabic-Indic digits → ASCII, Latin lowercased, punctuation → space.
 * tokens(): normalised words with a light prefix stemmer (ال، وال، بال، كال، فال، لل) so «المطورين» matches «مطورين».
 * Pure functions, shared by the built-in search engine, trends, summaries and unit tests. */
const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
const DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
const STOP = new Set(["في", "من", "على", "الى", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "ان", "او", "ثم", "كل", "قد", "لا", "ما", "هل", "كان", "كانت", "هو", "هي", "انا", "نحن", "انت", "لم", "لن", "و", "يا", "اي", "بعد", "قبل", "عند", "حتى", "لكن", "بين", "the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "for", "with", "at", "by", "it", "this", "that", "be"]);

/** @param {string} s */
function normalize(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩۰-۹]/g, d => DIGITS[d])
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_#@\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const PREFIXES = ["وال", "بال", "كال", "فال", "لل", "ال"];
/** light stem: strip one definite-article prefix when what remains is still a word (≥ 3 letters) */
function stem(w) {
  for (const p of PREFIXES) if (w.startsWith(p) && w.length - p.length >= 3) return w.slice(p.length);
  return w;
}
/** @param {string} s @param {{ keepStop?: boolean }} [o] */
function tokens(s, { keepStop = false } = {}) {
  return normalize(s)
    .split(" ")
    .map(w => w.replace(/^[#@]+/, ""))
    .filter(w => w && (keepStop || !STOP.has(w)))
    .map(stem)
    .filter(w => w.length > 1 || /\d/.test(w));
}
/** text as stored in the index: normalised tokens joined by spaces with sentinels, so LIKE '% tok%' is a prefix match */
const indexText = s => " " + tokens(s, { keepStop: true }).join(" ") + " ";

/** normalised token → the word as people wrote it (diacritics removed), for typeahead and «هل تقصد» */
function surfaces(s) {
  const m = new Map();
  for (const raw of String(s || "").split(/\s+/)) {
    const w = raw.replace(/^[#@]+/, "").replace(/[^\p{L}\p{N}_]+/gu, "").replace(TASHKEEL, "").replace(TATWEEL, "");
    if (!w) continue;
    const t = tokens(w, { keepStop: true })[0];
    if (t && !m.has(t)) m.set(t, w);
  }
  return m;
}
/** Levenshtein distance with an early exit once it exceeds max */
function distance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** language guess good enough for filters: share of Arabic letters */
function detectLang(s) {
  const ar = (String(s).match(/[\u0600-\u06FF]/g) || []).length,
    lat = (String(s).match(/[a-z]/gi) || []).length;
  if (!ar && !lat) return null;
  return ar >= lat ? "ar" : "en";
}
/** sentence splitter for Arabic + Latin punctuation (، is a clause comma, not a sentence end) */
function sentences(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?؟!…])\s+|\n+/)
    .map(x => x.trim())
    .filter(x => x.length > 0);
}
module.exports = { normalize, tokens, stem, indexText, surfaces, distance, detectLang, sentences, STOP };
