/* Arabic-first text classifier for automatic moderation (Phase 31).
 * Categories: abuse (insults/profanity/harassment), threat, hate (slurs + dehumanising a group), fraud (scams,
 * passphrase phishing, "guaranteed profit"). Fully local, zero-dependency and transparent: every hit is
 * returned with its category and the term that matched, so authors and moderators can see *why*.
 *
 * Evasion-resistant normalisation (deobfuscate):
 *  • diacritics/tatweel, hamza and alef variants, taa marbuta, alef maqsura, Persian/Urdu letter variants
 *  • zero-width and bidi control characters, NFKC presentation forms
 *  • elongation (حماااار → حمار), doubled letters as an alternative form
 *  • letters split by separators or spaces (غ.ب.ي، ح_م_ا_ر، غ ب ي)
 *  • Arabizi (7mar, kalb, 8abi) via an explicit list + a consonant skeleton transliteration
 *  • English leetspeak (1d10t, $tupid)
 * Context: second-person targeting (يا/انت/you) raises a hit, negation (مو/مش/ليس/not) halves it; animal
 * words only count fully when aimed at someone («عندي كلب» is fine, «يا كلب» is not).
 * The lexicon score is combined with lib/toxicity.js (Phase 17), so existing community automod and this
 * classifier never disagree downwards. */
const A = require("./arabic");
const Tox = require("./toxicity");

/** @typedef {"abuse"|"threat"|"hate"|"fraud"} Category */
/** @typedef {{ cat: Category, term: string, w: number }} Hit */

/* ---------- normalisation ---------- */
const ZW = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\u061C\uFEFF\u00AD]/g;
const VARIANTS = {
  ک: "ك",
  ګ: "ك",
  گ: "ك",
  ی: "ي",
  ې: "ي",
  ێ: "ي",
  ڤ: "ف",
  پ: "ب",
  چ: "ج",
  ژ: "ز",
  ھ: "ه",
  ە: "ه",
  ۀ: "ه",
  ۃ: "ه",
  ٸ: "ي",
  ٶ: "و",
  ٲ: "ا",
  ٳ: "ا",
  ٵ: "ا"
};
const VAR_RE = new RegExp("[" + Object.keys(VARIANTS).join("") + "]", "g");

/** base normalisation shared with search (lib/arabic.js) + letter variants and invisible characters */
function base(s) {
  const t = String(s || "")
    .normalize("NFKC")
    .replace(ZW, "")
    .replace(VAR_RE, c => VARIANTS[c])
    .replace(/(?<=[a-z0-9])[$@!]+|[$@!]+(?=[a-z0-9]*[a-z])(?<![#@\s]@)/gi, m => m.replace(/\$/g, "s").replace(/@/g, "a").replace(/!/g, "i")); // leet symbols inside Latin words
  return A.normalize(t.replace(/[_*•·~|^]+/g, " "));
}
/** join letters split by spaces: «غ ب ي» → «غبي» (three or more single letters in a row) */
const joinSpaced = s => s.replace(/(?:^|(?<=\s))((?:\p{L}\s){2,}\p{L})(?=\s|$)/gu, m => m.replace(/\s/g, ""));
/** elongation: three or more repeats → one */
const squeeze = s => s.replace(/(\p{L})\1{2,}/gu, "$1");
const collapseAll = s => s.replace(/(\p{L})\1+/gu, "$1");
function deobfuscate(text) {
  return squeeze(joinSpaced(base(text)));
}

/* ---------- Arabizi & leet ---------- */
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" };
const leet = w => w.replace(/[013457@$!]/g, c => LEET[c]);
const DIGRAPH = [
  ["sh", "ش"],
  ["ch", "ش"],
  ["kh", "خ"],
  ["gh", "غ"],
  ["th", "ث"],
  ["dh", "ذ"]
];
const MONO = {
  2: "",
  3: "ع",
  5: "خ",
  6: "ط",
  7: "ح",
  8: "غ",
  9: "ص",
  b: "ب",
  t: "ت",
  j: "ج",
  g: "ج",
  d: "د",
  r: "ر",
  z: "ز",
  s: "س",
  f: "ف",
  q: "ق",
  k: "ك",
  l: "ل",
  m: "م",
  n: "ن",
  h: "ه",
  w: "",
  y: "",
  a: "",
  e: "",
  i: "",
  o: "",
  u: "",
  c: "ك",
  v: "ف",
  p: "ب",
  x: "كس"
};
/** Arabizi → Arabic consonant skeleton («7mar» → «حمر») */
function arabiziSkeleton(w) {
  let s = w.toLowerCase();
  for (const [k, v] of DIGRAPH) s = s.split(k).join(v);
  return collapseAll([...s].map(c => (c in MONO ? MONO[c] : /[\u0600-\u06FF]/.test(c) ? c : "")).join(""));
}
/** Arabic word → consonant skeleton (long vowels and hamza dropped) */
const skeleton = w => collapseAll(w.replace(/[اويء]/g, ""));

/* ---------- lexicon ----------
 * entry: [term, weight, flags]; flags: t = only full weight when aimed at someone (animal words),
 * z = also match its Arabizi skeleton. Terms are written plainly and normalised at load time. */
/** @type {Record<Category, Array<[string, number, string?]>>} */
const LEX = {
  abuse: [
    ["غبي", 0.4, "z"],
    ["اغبى", 0.4],
    ["اهبل", 0.4, "z"],
    ["هبله", 0.4],
    ["تافه", 0.35, "z"],
    ["حقير", 0.45, "z"],
    ["وسخ", 0.4, "z"],
    ["زباله", 0.4, "z"],
    ["معفن", 0.4, "z"],
    ["قذر", 0.45, "z"],
    ["منحط", 0.45],
    ["وقح", 0.3],
    ["سافل", 0.5, "z"],
    ["نذل", 0.45],
    ["حثاله", 0.5],
    ["عبيط", 0.4, "z"],
    ["مغفل", 0.35],
    ["متخلف", 0.45, "z"],
    ["خايس", 0.35],
    ["لعين", 0.4],
    ["ملعون", 0.4],
    ["حيوان", 0.4, "t"],
    ["حمار", 0.45, "tz"],
    ["كلب", 0.45, "tz"],
    ["خنزير", 0.5, "tz"],
    ["بقره", 0.4, "t"],
    ["تيس", 0.4, "t"],
    ["جحش", 0.4, "t"],
    ["بهيمه", 0.45, "t"],
    ["قرد", 0.4, "t"],
    ["ثور", 0.35, "t"],
    ["ابن الكلب", 0.6],
    ["ابن الحرام", 0.6],
    ["يلعن ابوك", 0.6],
    ["يلعن امك", 0.6],
    ["الله يلعنك", 0.55],
    ["تف عليك", 0.45],
    ["تفو عليك", 0.45],
    ["انقلع", 0.35],
    ["اسكت يا", 0.3],
    ["روح موت", 0.45],
    ["روح انتحر", 0.7],
    ["مين سالك", 0.2],
    ["شرموط", 0.75, "z"],
    ["شرموطه", 0.75],
    ["عاهره", 0.7],
    ["قحبه", 0.8, "z"],
    ["منيوك", 0.8, "z"],
    ["كس امك", 0.85],
    ["كسمك", 0.85, "z"],
    ["طيز", 0.5],
    ["زق", 0.35, "t"],
    ["stupid", 0.4],
    ["idiot", 0.45],
    ["moron", 0.45],
    ["loser", 0.3],
    ["dumb", 0.35],
    ["pathetic", 0.3],
    ["trash", 0.3, "t"],
    ["bitch", 0.7],
    ["bastard", 0.6],
    ["asshole", 0.7],
    ["fuck you", 0.8],
    ["shut up", 0.3],
    ["go die", 0.6],
    ["kill yourself", 0.85],
    ["kys", 0.8]
  ],
  threat: [
    ["اقتلك", 0.8],
    ["قتلك", 0.75],
    ["نقتلك", 0.8],
    ["اذبحك", 0.85],
    ["نذبحك", 0.85],
    ["ذبحك", 0.8],
    ["اطعنك", 0.85],
    ["اموتك", 0.8],
    ["ادفنك", 0.7],
    ["اخلص عليك", 0.75],
    ["اكسر راسك", 0.7],
    ["كسر راسك", 0.65],
    ["اعرف وين ساكن", 0.85],
    ["اعرف بيتك", 0.8],
    ["اعرف عنوانك", 0.8],
    ["انتظرني برا", 0.6],
    ["راح تندم", 0.45],
    ["بتندم", 0.4],
    ["دمك حلال", 0.9],
    ["بفضحك", 0.55],
    ["افضحك", 0.55],
    ["انشر صورك", 0.75],
    ["i will kill", 0.85],
    ["ill kill", 0.85],
    ["i know where you live", 0.85],
    ["you will pay", 0.4]
  ],
  hate: [
    ["عبد اسود", 0.85],
    ["كافر نجس", 0.85],
    ["روافض", 0.7],
    ["رافضي", 0.65],
    ["نواصب", 0.65],
    ["ناصبي", 0.6],
    ["مجوس", 0.5],
    ["صفوي", 0.45],
    ["طرش بحر", 0.7],
    ["زط", 0.25],
    ["faggot", 0.9],
    ["retard", 0.7],
    ["nigger", 0.95],
    ["n1gger", 0.95],
    ["subhuman", 0.85],
    ["vermin", 0.6]
  ],
  fraud: [
    ["ربح مضمون", 0.6],
    ["ارباح مضمونه", 0.6],
    ["ارباح يوميه", 0.5],
    ["ضاعف اموالك", 0.7],
    ["ضاعف رصيدك", 0.7],
    ["استثمر معي", 0.45],
    ["بدون مخاطره", 0.35],
    ["دخل يومي", 0.35],
    ["ارسل لي", 0.15],
    ["حول لي", 0.2],
    ["عبارة المرور", 0.85],
    ["عباره المرور", 0.85],
    ["الكلمات السريه", 0.75],
    ["كلمات الاسترداد", 0.85],
    ["24 كلمه", 0.8],
    ["كلماتك ال 24", 0.9],
    ["passphrase", 0.8],
    ["seed phrase", 0.85],
    ["recovery phrase", 0.85],
    ["private key", 0.6],
    ["مفتاحك الخاص", 0.75],
    ["توثيق محفظتك", 0.6],
    ["تحقق من محفظتك", 0.6],
    ["سيتم ايقاف حسابك", 0.6],
    ["سيتم اغلاق حسابك", 0.6],
    ["سيتم حذف حسابك", 0.55],
    ["حسابك معرض للحظر", 0.55],
    ["فزت بجائزه", 0.55],
    ["مبروك ربحت", 0.55],
    ["هديه مجانيه", 0.3],
    ["تواصل واتساب", 0.3],
    ["راسلني خاص", 0.2],
    ["كاش باك", 0.15],
    ["airdrop", 0.3],
    ["giveaway", 0.2],
    ["double your", 0.7],
    ["guaranteed profit", 0.6],
    ["free pi", 0.6],
    ["pi مجانا", 0.6],
    ["باي مجانا", 0.6]
  ]
};
const ARABIZI = {
  abuse: {
    "7mar": 0.45,
    hmar: 0.45,
    "7mara": 0.45,
    "7ayawan": 0.4,
    hayawan: 0.4,
    ghabi: 0.4,
    "8abi": 0.4,
    ghaby: 0.4,
    "8aby": 0.4,
    kalb: 0.45,
    "kalb!": 0.45,
    "5ra": 0.5,
    khara: 0.5,
    tafeh: 0.35,
    "7aqeer": 0.45,
    haqeer: 0.45,
    wa9e5: 0.4,
    wase5: 0.4,
    zbala: 0.4,
    sharmoota: 0.75,
    sharmouta: 0.75,
    ka7ba: 0.8,
    kos: 0.6,
    "kos omak": 0.85,
    kosomak: 0.85,
    "ya kalb": 0.6
  },
  threat: { a2tlak: 0.8, ba2tlak: 0.8, aqtlak: 0.8, athba7ak: 0.85, adb7ak: 0.85 }
};
const NEG = new Set(["مو", "مب", "مش", "ليس", "لست", "ليست", "مانت", "ماني", "مهو", "not", "isnt", "arent", "no"]);
const TARGET = new Set(["يا", "انت", "انتي", "انتم", "انتو", "انتى", "يابن", "يبن", "you", "your", "ur", "u"]);
const PREFIX = ["وال", "بال", "فال", "كال", "لل", "ال", "يا", "و", "ف", "ب", "ل", "س", "ح", "ه", "ع"];
const SUFFIX = ["هم", "كم", "ها", "ين", "ون", "ات", "ه", "ك", "ي", "ا", "s", "es"];

/* compiled lexicon */
const WORDS = new Map(),
  PHRASES = [],
  SKEL = new Map();
for (const [cat, list] of Object.entries(LEX))
  for (const [term, w, flags = ""] of list) {
    const n = base(term);
    const e = { cat: /** @type {Category} */ (cat), term, w, target: flags.includes("t") };
    if (n.includes(" ")) PHRASES.push({ ...e, n });
    else {
      WORDS.set(n, e);
      if (/[\u0600-\u06FF]/.test(n) && flags.includes("z")) {
        const k = skeleton(n);
        if (k.length >= 3) SKEL.set(k, e);
      }
    }
  }
for (const [cat, m] of Object.entries(ARABIZI))
  for (const [term, w] of Object.entries(m)) {
    const e = { cat: /** @type {Category} */ (cat), term, w, target: false };
    if (term.includes(" ")) PHRASES.push({ ...e, n: term });
    else WORDS.set(term, e);
  }

/* group terms for the dehumanisation pattern (group + dehumaniser within a short window) */
const GROUPS = [
  "يهود",
  "نصارى",
  "مسيحيين",
  "شيعه",
  "سنه",
  "اكراد",
  "هنود",
  "باكستانيين",
  "بنغال",
  "افارقه",
  "سود",
  "عرب",
  "بدو",
  "اجانب",
  "لاجئين",
  "مهاجرين",
  "نساء",
  "حريم",
  "مثليين",
  "ملحدين",
  "مسلمين",
  "اقباط",
  "عمال",
  "jews",
  "muslims",
  "christians",
  "blacks",
  "immigrants",
  "refugees",
  "women",
  "gays",
  "arabs"
].map(base);
const DEHUMAN = [
  "حيوانات",
  "حشرات",
  "قرده",
  "خنازير",
  "كلاب",
  "نجس",
  "انجاس",
  "وباء",
  "سرطان",
  "قذاره",
  "جراثيم",
  "animals",
  "vermin",
  "insects",
  "parasites",
  "disease"
].map(base);
const EXTERMINATE = ["يجب قتلهم", "لازم ينقتلون", "ابادتهم", "ابيدوهم", "اطردوهم", "يستاهلون الموت", "should die", "must die", "kill them all"].map(base);

/** candidate forms of one token: itself, fully collapsed, with clitics stripped */
function forms(tok) {
  const out = new Set();
  for (const t of new Set([tok, collapseAll(tok)])) {
    out.add(t);
    for (const p of PREFIX)
      if (t.startsWith(p) && t.length - p.length >= 2) {
        const r = t.slice(p.length);
        out.add(r);
        for (const s of SUFFIX) if (r.endsWith(s) && r.length - s.length >= 2) out.add(r.slice(0, -s.length));
      }
    for (const s of SUFFIX) if (t.endsWith(s) && t.length - s.length >= 2) out.add(t.slice(0, -s.length));
  }
  return out;
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Classify a text. Pure and synchronous (~sub-millisecond for a post).
 * @param {string} text
 * @returns {{ score: number, categories: Record<Category, number>, hits: Hit[], reasons: string[], hostile: boolean, targeted: boolean, label: Category|null, normalized: string }}
 */
function classify(text) {
  const raw = String(text || "");
  const norm = deobfuscate(raw);
  /** @type {Record<Category, number>} */
  const cats = { abuse: 0, threat: 0, hate: 0, fraud: 0 };
  /** @type {Hit[]} */ const hits = [];
  if (!norm) return { score: 0, categories: cats, hits, reasons: [], hostile: false, targeted: false, label: null, normalized: "" };
  const toks = norm.split(" ");
  let targeted = toks.some(t => TARGET.has(t)) || /(^|\s)(يا|انت|انتي)(?=\s)/.test(norm);
  const seen = new Set();
  const add = (e, mult = 1) => {
    const k = e.cat + ":" + (e.n || base(e.term));
    if (seen.has(k)) return;
    seen.add(k);
    hits.push({ cat: e.cat, term: e.term, w: Math.round(e.w * mult * 100) / 100 });
  };
  // single words, with clitics, collapse, Arabizi skeleton and leet variants
  toks.forEach((tok, i) => {
    const prev = toks.slice(Math.max(0, i - 2), i);
    const aimed = prev.some(p => TARGET.has(p)) || /^(يا|يابن|ياابن)/.test(tok) || toks[i + 1] === "انت" || toks[i + 1] === "you";
    const negated = prev.some(p => NEG.has(p));
    let e = null;
    for (const f of forms(tok)) {
      e = WORDS.get(f);
      if (e) break;
    }
    if (!e && /[a-z]/.test(tok)) e = WORDS.get(tok) || WORDS.get(leet(tok)) || WORDS.get(leet(tok).replace(/(.)\1+/g, "$1")) || null;
    if (!e && /^[a-z0-9]+$/.test(tok) && /[a-z]/.test(tok) && tok.length >= 3) {
      const k = arabiziSkeleton(tok);
      if (k.length >= 3) e = SKEL.get(k) || null;
    }
    if (!e) return;
    let m = 1;
    if (e.target && !aimed) m = 0.25; // «عندي كلب» ≠ «يا كلب»
    if (aimed) {
      m *= 1.25;
      targeted = true;
    }
    if (negated) m *= 0.5;
    add(e, m);
  });
  // phrases (matched on the normalised text with word boundaries; prefixes allowed)
  const padded = " " + norm + " ",
    collapsed = " " + collapseAll(norm) + " ";
  for (const p of PHRASES) {
    const re = new RegExp(`(^|\\s)(و|ف|ب|ل|س|ح|ال)?${escRe(p.n)}(?=\\s|$)`, "u");
    if (re.test(padded) || re.test(collapsed)) add(p);
  }
  // hate: dehumanising a group, or calling for violence against it
  for (let i = 0; i < toks.length; i++) {
    const fs = forms(toks[i]);
    if (!GROUPS.some(g => fs.has(g))) continue;
    const win = toks.slice(Math.max(0, i - 4), i + 5).join(" ");
    const winForms = new Set(toks.slice(Math.max(0, i - 4), i + 5).flatMap(t => [...forms(t)]));
    if (DEHUMAN.some(d => winForms.has(d))) add({ cat: "hate", term: "تجريد جماعة من إنسانيتها", w: 0.75 });
    if (EXTERMINATE.some(x => (" " + win + " ").includes(" " + x + " ") || padded.includes(" " + x + " ")))
      add({ cat: "hate", term: "دعوة للعنف ضد جماعة", w: 0.9 });
  }
  // fraud combos: money promise + contact/transfer + urgency; phone numbers next to money talk
  const money = /(ربح|ارباح|اربح|ضعف|مضمون|دولار|ريال|usdt|بيتكوين|bitcoin|btc|pi|باي|محفظه|wallet|crypto|كريبتو|استثمار|invest)/.test(norm);
  const contact = /(واتساب|واتس|whatsapp|تيليجرام|telegram|راسلني|تواصل|ارسل|حول|اضغط|سجل|click|dm)/.test(norm);
  const urgent = /(الان|فوري|سارع|محدود|اخر فرصه|قبل فوات|اليوم فقط|now|hurry|limited)/.test(norm);
  if (money && contact) add({ cat: "fraud", term: "وعد مالي مع طلب تواصل/تحويل", w: urgent ? 0.5 : 0.35 });
  if (money && /(\+?\d[\d\s-]{8,}\d)/.test(raw.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))))
    add({ cat: "fraud", term: "رقم هاتف مع حديث عن المال", w: 0.3 });
  // combine per category: strongest hit + diminishing extra
  for (const c of /** @type {Category[]} */ (Object.keys(cats))) {
    const ws = hits
      .filter(h => h.cat === c)
      .map(h => h.w)
      .sort((a, b) => b - a);
    if (!ws.length) continue;
    let s = ws[0];
    for (const w of ws.slice(1)) s += w * 0.25 * (1 - s);
    cats[c] = Math.min(1, Math.round(s * 100) / 100);
  }
  // Phase 17 scorer as a floor so community automod and this classifier stay consistent
  const tox = Tox.score(raw);
  if (cats.abuse >= 0.3 && tox.score > cats.abuse && (tox.reasons.includes("insult") || tox.reasons.includes("harass"))) cats.abuse = tox.score;
  if (tox.reasons.includes("threat") && cats.threat < 0.8) cats.threat = Math.max(cats.threat, 0.8);
  if (tox.reasons.includes("slur") && cats.hate < 0.85) cats.hate = Math.max(cats.hate, 0.85);
  if (targeted && cats.abuse > 0) cats.abuse = Math.min(1, Math.round((cats.abuse + 0.1) * 100) / 100);
  const score = Math.min(1, Math.round((1 - Object.values(cats).reduce((p, v) => p * (1 - v), 1)) * 100) / 100);
  const label = /** @type {Category|null} */ (score ? /** @type {Category[]} */ (Object.keys(cats)).sort((a, b) => cats[b] - cats[a])[0] : null);
  const reasons = /** @type {Category[]} */ (Object.keys(cats)).filter(c => cats[c] >= 0.3);
  const hostile = cats.abuse >= 0.45 || cats.threat >= 0.45 || cats.hate >= 0.45;
  return { score, categories: cats, hits, reasons, hostile, targeted, label, normalized: norm };
}

/** gentle Arabic explanations shown to authors and readers (no blame, always a way forward) */
const EXPLAIN = {
  abuse: "قد تُفهم بعض الكلمات كإساءة لشخص ما.",
  threat: "يبدو أن النص يحمل تهديداً، وسلامة الجميع أولوية لدينا.",
  hate: "قد يسيء النص إلى مجموعة من الناس بسبب هويتهم.",
  fraud: "يشبه النص أساليب الاحتيال المعروفة (وعود أرباح أو طلب بيانات سرية).",
  link: "يحتوي رابطاً قد يكون غير آمن.",
  image: "قد تحتوي الصورة على محتوى حساس.",
  account: "الحسابات الجديدة تمر بمراجعة أهدأ في أيامها الأولى."
};
/** @param {string[]} reasons */
function explain(reasons) {
  return [...new Set(reasons)].map(r => EXPLAIN[/** @type {keyof typeof EXPLAIN} */ (r)]).filter(Boolean);
}

module.exports = { classify, deobfuscate, base, arabiziSkeleton, skeleton, leet, explain, EXPLAIN, LEX };
