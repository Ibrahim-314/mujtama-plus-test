/* Abusive-content scorer (Phase 17). A transparent lexicon + signal model for Arabic and English:
 * insults, threats, slurs, harassment patterns, shouting and repetition. Returns a 0–1 score and
 * the reasons, so moderators always see *why* something was flagged. A hosted classifier can
 * replace score() behind the same interface. */
const norm = (s) => String(s).toLowerCase().replace(/[\u064B-\u065F\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/(.)\1{2,}/g, "$1$1");
const LEX = {
  insult: ["غبي", "حمار", "حيوان", "كلب", "تافه", "حقير", "وسخ", "زبالة", "اهبل", "معفن", "خنزير", "قذر", "منحط", "stupid", "idiot", "moron", "loser", "trash", "dumb", "pathetic"],
  threat: ["ساقتلك", "راح اقتلك", "اذبحك", "بكسر راسك", "اعرف وين ساكن", "انتظرني برا", "i will kill", "i'll kill", "kill yourself", "kys", "i know where you live"],
  slur: ["عبد اسود", "كافر نجس", "faggot", "retard", "n1gger", "nigger"],
  harass: ["اسكت يا", "انقلع", "روح موت", "مين سالك", "shut up", "nobody asked", "go die"]
};
const W = { insult: 0.35, threat: 0.8, slur: 0.9, harass: 0.3 };
const NLEX = Object.fromEntries(Object.entries(LEX).map(([k, v]) => [k, v.map(norm)]));
function score(text) {
  const t = norm(text || ""); if (!t.trim()) return { score: 0, reasons: [] };
  let s = 0; const reasons = [];
  for (const [cat, words] of Object.entries(NLEX)) { const hits = words.filter(w => new RegExp(`(^|[^\\p{L}])(وال|ال|و|ف|ب|ل)?${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(ه|ين|ون|ات|ا|s|es)?(?=$|[^\\p{L}])`, "u").test(t)); if (hits.length) { s += W[cat] + (hits.length - 1) * 0.1; reasons.push(cat); } }
  const letters = (text.match(/[A-Z]/g) || []).length, latin = (text.match(/[A-Za-z]/g) || []).length;
  if (latin > 12 && letters / latin > 0.7) { s += 0.1; reasons.push("shouting"); }
  if (/[!؟?]{4,}/.test(text)) { s += 0.05; reasons.push("shouting"); }
  if (/(^|\s)(انت|انتي|you)\s/.test(t) && reasons.includes("insult")) { s += 0.15; reasons.push("targeted"); }
  return { score: Math.min(1, Math.round(s * 100) / 100), reasons: [...new Set(reasons)] };
}
module.exports = { score, norm };
