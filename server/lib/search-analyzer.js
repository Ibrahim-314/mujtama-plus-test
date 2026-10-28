/* v2.123 search analyzer — stage 1 of the X-style search plan. Pure functions shared by indexing and querying.
 *
 * Every word becomes a small set of FORMS, each with a weight:
 *   surface (1.0)  the normalised word as written («الالعاب», «python»)
 *   base    (0.9)  clitics removed: و ف ب ك ل + ال / لل («وبالمحامص» → «محامص», «ببايثون» → «بايثون»)
 *   stem    (0.75) light suffix stem of the base: plural/feminine/possessive endings («محامص» stays, «مشاريع»,
 *                  «محمصات» → «محمص», «تطبيقاتنا» → «تطبيق»); Latin: plural/-ing/-ed («projects» → «project»)
 * Forms are emitted on BOTH sides (index and query), so a match needs only one shared form; the weaker of the two
 * weights is what the match is worth. Prefix stripping is ambiguous in Arabic («وزن»), so a stripped form is never
 * shorter than 3 letters and always ranks below the surface form.
 *
 * Arabic orthography is unified by arabic.normalize() first (أ/إ/آ → ا, ة → ه, ى → ي, digits, tashkeel). */
const A = require("./arabic");

const CLITIC2 = ["وال", "بال", "كال", "فال", "لل", "ول", "وب", "فب", "فل", "وك"];
const CLITIC1 = ["و", "ف", "ب", "ك", "ل"];
const SUFFIX = ["اتها", "اتهم", "اتنا", "اتكم", "يات", "ات", "ون", "ين", "ان", "يه", "ها", "هم", "كم", "نا", "تي", "ه", "ي"];
const EN_SUFFIX = [["ies", "y"], ["sses", "ss"], ["ing", ""], ["ed", ""], ["es", ""], ["s", ""]];
const isAr = (w) => /[\u0600-\u06FF]/.test(w);

/** base form: strip the definite article and attached prepositions/conjunctions (one pass, never below 3 letters) */
function base(w) {
  if (!isAr(w)) return w;
  let x = w;
  if (x.startsWith("ال") && x.length - 2 >= 3) return x.slice(2);
  for (const p of CLITIC2) if (x.startsWith(p) && x.length - p.length >= 3) { x = x.slice(p.length); if (x.startsWith("ال") && x.length - 2 >= 3) x = x.slice(2); return x; }
  for (const p of CLITIC1) if (x.startsWith(p) && x.length - 1 >= 4) { x = x.slice(1); if (x.startsWith("ال") && x.length - 2 >= 3) x = x.slice(2); return x; }
  return x;
}
/** light suffix stem of a base form (never below 3 letters) */
function stem(w) {
  if (!isAr(w)) {
    if (!/^[a-z]+$/.test(w) || w.length < 4) return w;
    for (const [s, r] of EN_SUFFIX) if (w.endsWith(s) && w.length - s.length + r.length >= 3) return w.slice(0, w.length - s.length) + r;
    return w;
  }
  for (const s of SUFFIX) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, w.length - s.length);
  return w;
}
/** the forms of one normalised word: [[form, weight], …] strongest first, de-duplicated */
function forms(w) {
  const out = new Map([[w, 1]]);
  const b = base(w); if (b !== w && !out.has(b)) out.set(b, 0.9);
  const s = stem(b); if (s !== b && !out.has(s)) out.set(s, 0.75);
  if (b === w) { const s2 = stem(w); if (s2 !== w && !out.has(s2)) out.set(s2, 0.75); }
  return [...out];
}
/** normalised words of a text (hashtag/mention marks dropped, «_» splits hashtags into words) */
function words(text) {
  return A.normalize(String(text || "").replace(/_/g, " ")).split(" ").map((w) => w.replace(/^[#@]+/, "")).filter((w) => w && (w.length > 1 || /\d/.test(w)));
}
/** document side: Map(form → { tf, w }) where w is the strongest weight the form appeared with */
function analyze(text, { max = 4000 } = {}) {
  const m = new Map(); let n = 0;
  for (const w of words(text)) {
    if (++n > max) break;
    for (const [f, wt] of forms(w)) {
      if (f.length > 40) continue;
      const e = m.get(f); if (e) { e.tf++; if (wt > e.w) e.w = wt; } else m.set(f, { tf: 1, w: wt });
    }
  }
  return { terms: m, len: n };
}
module.exports = { analyze, forms, base, stem, words };
