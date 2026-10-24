/* Arabic first, English second (the app's two languages). The game follows the app's language. */
let lang = "ar";
export const setLang = (l) => { lang = l === "en" ? "en" : "ar"; };
export const getLang = () => lang;
export const isRtl = () => lang !== "en";
/** t("نص عربي", "English text") — every string in the game is written as a pair, next to where it is used. */
export const t = (ar, en) => (lang === "en" ? en ?? ar : ar);
/** Pick from an object with ar/en keys (story data). */
export const tl = (o) => (o == null ? "" : typeof o === "string" ? o : lang === "en" ? o.en ?? o.ar : o.ar);
/** Fill {name} style slots. */
export const fill = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
