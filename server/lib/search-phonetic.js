/* v2.124 cross-script sound key — how one engine matches «بايثون» to «python», «لابتوب» to «laptop», «رياكت» to «react»
 * for ANY loanword, with no word list. Both scripts are reduced to the same consonant skeleton:
 *   vowels and weak letters (a e i o u y w h · ا و ي ه ح ع ء) are dropped, letters that sound alike share one class
 *   (p/b/ب, v/f/ف, c/k/q/ك/ق/خ, t/ط/ت/ث, d/د/ض/ذ, s/س/ص/ش, z/ز/ظ, j/g/ج/غ), Latin digraphs first (th → t, sh → s, ph → f…),
 *   and doubled letters collapse. «python» → btn, «بايثون» → btn.
 * The key only PROPOSES candidates: the engine keeps a candidate only when it is a real word in the index (search_vocab), written
 * in the other script, with a key of at least 3 consonants — and ranks it below the reader's own word. Pure functions. */
const AR = { "ب": "b", "پ": "b", "ت": "t", "ط": "t", "ث": "t", "د": "d", "ض": "d", "ذ": "d", "ج": "j", "غ": "j", "ك": "k", "ق": "k", "خ": "k",
  "ف": "f", "ڤ": "f", "س": "s", "ص": "s", "ش": "s", "ز": "z", "ظ": "z", "ر": "r", "ل": "l", "م": "m", "ن": "n", "چ": "s", "گ": "j" };
const LAT_DI = [["sch", "s"], ["tch", "s"], ["th", "t"], ["sh", "s"], ["ch", "s"], ["kh", "k"], ["gh", "j"], ["ph", "f"], ["ck", "k"], ["qu", "k"], ["dh", "d"], ["x", "ks"]];
const LAT = { b: "b", p: "b", t: "t", d: "d", j: "j", g: "j", k: "k", c: "k", q: "k", f: "f", v: "f", s: "s", z: "z", r: "r", l: "l", m: "m", n: "n" };
const isAr = (w) => /[\u0600-\u06FF]/.test(w);
const isLat = (w) => /^[a-z]+$/.test(w);
function collapse(s) { let o = ""; for (const c of s) if (c !== o[o.length - 1]) o += c; return o; }
/** consonant skeleton of one normalised word, or "" when it has no letters in either script */
function key(w) {
  w = String(w || "");
  if (isAr(w)) { let o = ""; for (const c of w) o += AR[c] || ""; return collapse(o); }
  if (isLat(w)) { let x = w; for (const [a, b] of LAT_DI) x = x.split(a).join(b); let o = ""; for (const c of x) o += LAT[c] || ""; return collapse(o); }
  return "";
}
/** the script a word is written in: "ar", "lat" or null */
const script = (w) => (isAr(w) ? "ar" : isLat(w) ? "lat" : null);
module.exports = { key, script };
