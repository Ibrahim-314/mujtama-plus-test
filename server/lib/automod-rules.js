/* Community automod v2 rules (v2.59.0, «المجتمع 3.0» stage 4). Pure and synchronous: no DB, no clock except what the
 * caller passes in, so every rule is unit-tested in isolation and the «جرّب القاعدة» tester runs the exact same code.
 *
 * SAFETY CONTRACT: every rule here is OFF by default, and a community with no `automod.v2` key evaluates to "no match".
 * The legacy rules (words / blockLinks / newAccountDays / toxicity / action) live in services/cmod.js and are untouched.
 *
 * Rules (each { enabled, action, ...options }; action ∈ queue | reject | report):
 *   words       smart blocked words: tashkeel, tatweel, presentation forms, letter separators (غ.ب.ي), repeated letters
 *               and Arabic clitics (ال/و/ف/ب/ل) are normalised away; `*` is a wildcard inside one word (غب*).
 *               Matching is linear (no RegExp is built from user input) → no ReDoS even on 100k-char input.
 *   links       domain list: mode "deny" (only listed domains match) or "allow" (any link outside the list matches).
 *   invites     invitation links to other platforms (wa.me, chat.whatsapp.com, t.me, discord.gg …).
 *   mentions    more than `max` @mentions in one text.
 *   flood       one character repeated more than `maxRepeat` times in a row, or more than `maxEmoji` emoji.
 *   duplicate   the same text (normalised fingerprint) repeated by the same member inside `windowMin` minutes —
 *               the caller passes `ctx.duplicate` (services/cmod2.js reads content_fingerprints).
 *   newMember   a member's first `firstPosts` posts in the community go to review — caller passes `ctx.memberPosts`.
 *   classify    the Arabic classifier (lib/ar-classify.js) over `threshold` in one of `categories`.
 *   comments    { enabled } — apply the rules above to comments too (a matching comment waits as status 'pending').
 * Penalty ladder (`ladder`, OFF by default): after N automod hits within `windowDays`, warn → mute … (services/cmod2.js). */
const crypto = require("node:crypto");
const C = require("./ar-classify");

const ACTIONS = ["queue", "reject", "report"];
const ACTION_AR = { queue: "تحويل للمراجعة", reject: "منع النشر", report: "نشر مع بلاغ للمشرفين" };
const CATS = ["abuse", "threat", "hate", "fraud"];
const MAX_TEXT = 20000; // longer texts are evaluated on their first 20k characters (posts cap at 10k anyway)
const INVITE_HOSTS = ["wa.me", "chat.whatsapp.com", "t.me", "telegram.me", "telegram.dog", "discord.gg", "discord.com/invite", "snapchat.com/add", "join.skype.com", "signal.group"];

const RULES = {
  words: { t: "كلمات محظورة ذكية", sub: "تتجاوز التشكيل والتمويه وتكرار الحروف، وتدعم * داخل الكلمة", def: { enabled: false, action: "queue", words: [] } },
  links: { t: "قائمة النطاقات", sub: "منع نطاقات بعينها أو السماح بقائمة فقط", def: { enabled: false, action: "queue", mode: "deny", domains: [] } },
  invites: { t: "روابط دعوة خارجية", sub: "واتساب وتيليجرام وديسكورد وأمثالها", def: { enabled: false, action: "queue" } },
  mentions: { t: "إشارات كثيرة", sub: "أكثر من عدد محدد من @الإشارات", def: { enabled: false, action: "queue", max: 5 } },
  flood: { t: "تكرار وإغراق", sub: "حرف مكرر كثيراً أو رموز تعبيرية كثيرة", def: { enabled: false, action: "queue", maxRepeat: 8, maxEmoji: 12 } },
  duplicate: { t: "منشورات مكررة", sub: "النص نفسه من العضو نفسه خلال مدة قصيرة", def: { enabled: false, action: "queue", windowMin: 60 } },
  newMember: { t: "أول منشورات العضو الجديد", sub: "تُراجع أول منشورات العضو في المجتمع", def: { enabled: false, action: "queue", firstPosts: 3 } },
  classify: { t: "المصنّف العربي", sub: "إساءة وتهديد وكراهية واحتيال، مقاوم للتمويه", def: { enabled: false, action: "queue", threshold: 0.7, categories: CATS.slice() } },
  comments: { t: "تطبيق القواعد على التعليقات", sub: "التعليق المطابق ينتظر الموافقة", def: { enabled: false } }
};
const LADDER_DEF = { enabled: false, windowDays: 30, steps: [{ at: 3, action: "warn" }, { at: 5, action: "mute", hours: 24 }, { at: 8, action: "mute", hours: 168 }] };

const clampN = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const act = (v) => (ACTIONS.includes(v) ? v : "queue");
const cleanList = (a, max, len) => [...new Set((Array.isArray(a) ? a : typeof a === "string" ? a.split(/\r?\n|،|,/) : []).map(w => String(w ?? "").trim().slice(0, len)).filter(Boolean))].slice(0, max);
const normDomain = (d) => String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").slice(0, 253);

/** validate a v2 rules bag; unknown keys dropped; every rule keeps enabled:false unless it was explicitly true */
function parseV2(b) {
  const x = b && typeof b === "object" ? b : {};
  const on = (r) => !!(x[r] && x[r].enabled === true);
  const g = (r) => (x[r] && typeof x[r] === "object" ? x[r] : {});
  return {
    words: { enabled: on("words"), action: act(g("words").action), words: cleanList(g("words").words, 300, 40) },
    links: { enabled: on("links"), action: act(g("links").action), mode: g("links").mode === "allow" ? "allow" : "deny", domains: cleanList(g("links").domains, 200, 253).map(normDomain).filter(d => /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(d)) },
    invites: { enabled: on("invites"), action: act(g("invites").action) },
    mentions: { enabled: on("mentions"), action: act(g("mentions").action), max: clampN(g("mentions").max, 1, 50, 5) },
    flood: { enabled: on("flood"), action: act(g("flood").action), maxRepeat: clampN(g("flood").maxRepeat, 3, 100, 8), maxEmoji: clampN(g("flood").maxEmoji, 1, 200, 12) },
    duplicate: { enabled: on("duplicate"), action: act(g("duplicate").action), windowMin: clampN(g("duplicate").windowMin, 1, 7 * 24 * 60, 60) },
    newMember: { enabled: on("newMember"), action: act(g("newMember").action), firstPosts: clampN(g("newMember").firstPosts, 1, 50, 3) },
    classify: { enabled: on("classify"), action: act(g("classify").action), threshold: Math.max(0.3, Math.min(0.99, Math.round((Number(g("classify").threshold) || 0.7) * 100) / 100)), categories: (Array.isArray(g("classify").categories) ? g("classify").categories : CATS).filter(c => CATS.includes(c)) },
    comments: { enabled: on("comments") }
  };
}
function parseLadder(b) {
  const x = b && typeof b === "object" ? b : {};
  const steps = (Array.isArray(x.steps) ? x.steps : LADDER_DEF.steps).map(s => ({ at: clampN(s?.at, 1, 100, 3), action: ["warn", "mute", "ban"].includes(s?.action) ? s.action : "warn", ...(s?.action === "mute" ? { hours: clampN(s?.hours, 1, 720, 24) } : {}) }))
    .sort((a, b2) => a.at - b2.at).filter((s, i, a) => !i || s.at !== a[i - 1].at).slice(0, 5);
  return { enabled: x.enabled === true, windowDays: clampN(x.windowDays, 1, 365, 30), steps };
}
const anyOn = (v2) => !!v2 && Object.entries(v2).some(([k, r]) => k !== "comments" && r && r.enabled);

/* ---------- normalisation ---------- */
const PREFIX = ["وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل"];
const collapse = (t) => t.replace(/(.)\1+/gu, "$1"); // غبيييي → غبي (only used for comparison, both sides)
/** normalise a text into word tokens (deobfuscated, repeated letters collapsed) */
function tokens(text) {
  const n = C.deobfuscate(String(text || "").slice(0, MAX_TEXT));
  return n ? n.split(" ").filter(Boolean).map(collapse) : [];
}
const normWord = (w) => String(w || "").replace(/\*+/g, "*").split("*").map(x => (x.trim() ? collapse(C.deobfuscate(x)).replace(/\s+/g, " ") : "")).join("*").trim();

/** linear-time glob match: `*` = any run of characters (inside a word). Classic two-pointer algorithm, O(|s|·|p|) worst case, no backtracking explosion. */
function glob(s, p) {
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < s.length) {
    if (j < p.length && p[j] !== "*" && p[j] === s[i]) { i++; j++; }
    else if (j < p.length && p[j] === "*") { star = j++; mark = i; }
    else if (star !== -1) { j = star + 1; i = ++mark; }
    else return false;
  }
  while (j < p.length && p[j] === "*") j++;
  return j === p.length;
}
/** does one normalised token match one normalised pattern (with clitic prefixes stripped)? */
function tokMatch(tok, pat) {
  const forms = [tok];
  for (const p of PREFIX) if (tok.startsWith(p) && tok.length - p.length >= 2) forms.push(tok.slice(p.length));
  return pat.includes("*") ? forms.some(f => glob(f, pat)) : forms.includes(pat);
}
/** smart word list match → the patterns that matched (original spelling) */
function matchWords(text, words) {
  const toks = tokens(text); if (!toks.length || !words?.length) return [];
  const joined = " " + toks.join(" ") + " ", hits = [];
  for (const w of words) {
    const pat = normWord(w); if (!pat || pat.replace(/\*/g, "").length < 2) continue;
    if (pat.includes(" ")) { if (!pat.includes("*") && joined.includes(" " + pat + " ")) hits.push(w); continue; } // phrases: exact, no wildcard
    for (let i = 0; i < toks.length; i++) if (toks[i].length <= 64 && tokMatch(toks[i], pat)) { hits.push(w); break; }
  }
  return hits;
}

/* ---------- links ---------- */
const TLD = /^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,6}\.(?:com|net|org|me|gg|io|ly|sa|co|info|xyz|app|link|site|online|top|ru|cn|tk)(?:[/?#:]|$)/i;
/** links in a text, token by token (bounded, anchored patterns only → linear time) */
function links(text) {
  const out = [], s = String(text || "").slice(0, MAX_TEXT).split(/\s+/);
  for (const t0 of s) {
    if (out.length >= 50) break;
    if (!t0 || t0.length > 400 || t0.indexOf(".") < 0) continue;
    const t = t0.replace(/^[^a-z0-9]+/i, "").replace(/[.,،!?؟)\]]+$/, "");
    if (!/^(?:https?:\/\/|www\.)/i.test(t) && !TLD.test(t)) continue;
    const rest = t.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();
    out.push({ raw: t, host: rest.split(/[/?#:]/)[0], path: rest });
  }
  return out;
}
const hostIn = (host, list) => list.some(d => host === d || host.endsWith("." + d));
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** content fingerprint for the duplicate rule (sha1 of the normalised, collapsed token stream) */
function fingerprint(text) { const t = tokens(text).join(" "); return t.length >= 8 ? crypto.createHash("sha1").update(t).digest("hex").slice(0, 32) : null; }

/**
 * Evaluate the v2 rules.
 * @param {any} v2 parsed rules (parseV2)
 * @param {{ text?: string, kind?: "post"|"comment", ctx?: { duplicate?: boolean, memberPosts?: number } }} input
 * @returns {{ matches: { rule: string, action: string, reason: string, detail?: any }[], action: string|null }}
 */
function evaluate(v2, { text = "", kind = "post", ctx = {} } = {}) {
  const none = { matches: [], action: null };
  if (!v2 || !anyOn(v2)) return none;
  if (kind === "comment" && !v2.comments?.enabled) return none;
  const r = v2, m = [];
  if (r.words?.enabled && r.words.words?.length) { const w = matchWords(text, r.words.words); if (w.length) m.push({ rule: "words", action: r.words.action, reason: "كلمات محظورة: " + w.slice(0, 3).join("، "), detail: w.slice(0, 10) }); }
  const ls = (r.links?.enabled || r.invites?.enabled) ? links(text) : [];
  if (r.links?.enabled && ls.length) {
    const bad = r.links.mode === "allow" ? ls.filter(l => !hostIn(l.host, r.links.domains || [])) : ls.filter(l => hostIn(l.host, r.links.domains || []));
    if (bad.length) m.push({ rule: "links", action: r.links.action, reason: (r.links.mode === "allow" ? "رابط خارج النطاقات المسموحة: " : "نطاق محظور: ") + [...new Set(bad.map(l => l.host))].slice(0, 3).join("، "), detail: bad.map(l => l.host).slice(0, 10) });
  }
  if (r.invites?.enabled && ls.length) { const inv = ls.filter(l => INVITE_HOSTS.some(h => l.path === h || l.path.startsWith(h + "/") || (h.indexOf("/") < 0 && l.host === h))); if (inv.length) m.push({ rule: "invites", action: r.invites.action, reason: "رابط دعوة خارجي: " + [...new Set(inv.map(l => l.host))].slice(0, 2).join("، ") }); }
  if (r.mentions?.enabled) { const n = new Set((String(text).slice(0, MAX_TEXT).match(/@[\p{L}\p{N}_.]{2,30}/gu) || []).map(x => x.toLowerCase())).size; if (n > r.mentions.max) m.push({ rule: "mentions", action: r.mentions.action, reason: `${n} إشارات (الحد ${r.mentions.max})` }); }
  if (r.flood?.enabled) {
    const s = String(text).slice(0, MAX_TEXT); let run = 1, best = 1;
    const cps = Array.from(s); for (let i = 1; i < cps.length; i++) { if (cps[i] === cps[i - 1] && cps[i] !== " ") { run++; if (run > best) best = run; } else run = 1; }
    const emoji = (s.match(EMOJI_RE) || []).length;
    if (best > r.flood.maxRepeat) m.push({ rule: "flood", action: r.flood.action, reason: `حرف مكرر ${best} مرة متتالية` });
    else if (emoji > r.flood.maxEmoji) m.push({ rule: "flood", action: r.flood.action, reason: `${emoji} رمزاً تعبيرياً` });
  }
  if (r.duplicate?.enabled && ctx.duplicate) m.push({ rule: "duplicate", action: r.duplicate.action, reason: "نص مكرر خلال " + r.duplicate.windowMin + " دقيقة" });
  if (r.newMember?.enabled && kind === "post" && typeof ctx.memberPosts === "number" && ctx.memberPosts < r.newMember.firstPosts) m.push({ rule: "newMember", action: r.newMember.action, reason: `من أول ${r.newMember.firstPosts} منشورات للعضو` });
  if (r.classify?.enabled) {
    const c = C.classify(String(text).slice(0, MAX_TEXT)), hit = (r.classify.categories || CATS).filter(k => (c.categories[k] || 0) >= r.classify.threshold);
    if (hit.length) m.push({ rule: "classify", action: r.classify.action, reason: "المصنّف: " + C.explain(hit).join(" "), detail: Object.fromEntries(hit.map(k => [k, c.categories[k]])) });
  }
  if (!m.length) return none;
  const order = { reject: 3, queue: 2, report: 1 };
  return { matches: m, action: m.reduce((a, x) => (order[x.action] > order[a] ? x.action : a), "report") };
}

/* ---------- «الحارس التلقائي» (v2.62, OFF by default) ----------
 * A separate, stricter word/phrase list: a matching text is not published (and not stored), the member gets a strike
 * (warning + optional temporary mute) and after `maxStrikes` strikes a full lock until a moderator lifts it. This file
 * only parses the config and matches text; strikes/sanctions live in services/cmod2.js. Matching reuses the same
 * normalisation as `matchWords` (no RegExp from user input, linear per pattern) and adds:
 *   • phrases with `*` inside any word («يا غ*»), clitic prefixes stripped from every word («ويا غبي» → «يا غبي»)
 *   • an allow-list (`allow`): a match whose span touches a token covered by an exception never counts («غبار» with «غب*»,
 *     «يا غبار» with «يا غ*»); other occurrences in the same text still count. */
const LIFT_MIN = ["moderator", "admin", "owner"];
const GUARD_KINDS = { post: "posts", comment: "comments", edit: "edits" };
const GUARD_DEF = Object.freeze({ enabled: false, words: [], allow: [], muteHours: 1, maxStrikes: 3, decayDays: 30, fullLock: true, posts: true, comments: true, edits: true, muteBlocksComments: true, resetOnLift: true, liftMin: "moderator" });
/** the «الإعداد الموصى به» button: fills the form (3 strikes · 1 hour · 30 days); nothing is saved until «حفظ» */
const GUARD_PRESET = Object.freeze({ t: "الإعداد الموصى به", sub: "3 تحذيرات · كتم ساعة بعد كل تحذير · تُنسى بعد 30 يوماً · إيقاف حتى يرفعه مشرف", guard: { enabled: true, muteHours: 1, maxStrikes: 3, decayDays: 30, fullLock: true, posts: true, comments: true, edits: true, muteBlocksComments: true, resetOnLift: true, liftMin: "moderator" } });

/** validate a guard config; unknown keys dropped. `enabled` is true only when sent as `true`; the other booleans keep
 * their default (true) unless sent as `false`. Lists: words ≤300, allow ≤100, each ≤60 characters, deduplicated. */
function parseGuard(b) {
  const x = b && typeof b === "object" && !Array.isArray(b) ? b : {};
  const yes = (k) => (typeof x[k] === "boolean" ? x[k] : GUARD_DEF[k]);
  return {
    enabled: x.enabled === true,
    words: cleanList(x.words, 300, 60),
    allow: cleanList(x.allow, 100, 60),
    muteHours: clampN(x.muteHours, 0, 720, GUARD_DEF.muteHours),
    maxStrikes: clampN(x.maxStrikes, 1, 10, GUARD_DEF.maxStrikes),
    decayDays: clampN(x.decayDays, 0, 365, GUARD_DEF.decayDays),
    fullLock: yes("fullLock"), posts: yes("posts"), comments: yes("comments"), edits: yes("edits"),
    muteBlocksComments: yes("muteBlocksComments"), resetOnLift: yes("resetOnLift"),
    liftMin: LIFT_MIN.includes(x.liftMin) ? x.liftMin : GUARD_DEF.liftMin
  };
}
/** is the guard on for this kind of text? kind ∈ post | comment | edit */
const guardApplies = (g, kind = "post") => !!(g && g.enabled === true && Array.isArray(g.words) && g.words.length && g[GUARD_KINDS[kind] || "posts"] !== false);

/** compile patterns once: each → array of normalised word patterns (phrase = several); too-short/invalid dropped */
function compile(list) {
  const out = [];
  for (const w of list || []) {
    const parts = normWord(String(w || "").slice(0, 60)).split(" ").filter(Boolean);
    if (!parts.length || parts.length > 8 || parts.join("").replace(/\*/g, "").length < 2 || parts.some(p => !p.replace(/\*/g, ""))) continue;
    out.push({ src: w, parts });
  }
  return out;
}
/** clitic-stripped forms of every token, computed once per text */
const formsOf = (tok) => { const f = [tok]; if (tok.length <= 64) for (const p of PREFIX) if (tok.startsWith(p) && tok.length - p.length >= 2) f.push(tok.slice(p.length)); return f; };
/* a wildcard part carries its literal head/tail so most tokens are rejected by two string compares before glob() */
const globPart = (f, pat) => { const h = pat.slice(0, pat.indexOf("*")), t = pat.slice(pat.lastIndexOf("*") + 1); return f.length <= 64 && f.length >= h.length + t.length && f.startsWith(h) && f.endsWith(t) && glob(f, pat); };
const partMatch = (forms, pat) => (pat.includes("*") ? forms.some(f => globPart(f, pat)) : forms.includes(pat));
/** per-text index: distinct tokens (with their clitic-stripped forms) and where each occurs, so a pattern is tested
 * once per distinct token, not once per occurrence (a 20k-char text has few distinct words). */
function indexText(toks) {
  const pos = new Map();
  toks.forEach((t, i) => { const a = pos.get(t); if (a) a.push(i); else pos.set(t, [i]); });
  const uniq = [...pos.keys()].map(t => ({ t, forms: formsOf(t) })), memo = new Map();
  /** set of distinct tokens matching one word pattern (memoised for this text) */
  const set = (pat) => { let r = memo.get(pat); if (!r) { r = new Set(uniq.filter(u => partMatch(u.forms, pat)).map(u => u.t)); memo.set(pat, r); } return r; };
  return { toks, pos, set };
}
/** every start index where the compiled pattern matches → callback(start, len); stop when the callback returns false */
function spans(X, c, cb) {
  const k = c.parts.length, first = X.set(c.parts[0]); if (!first.size) return;
  const rest = c.parts.slice(1).map(p => X.set(p)); if (rest.some(r => !r.size)) return;
  const starts = []; for (const t of first) starts.push(...X.pos.get(t)); starts.sort((x, y) => x - y);
  outer: for (const i of starts) {
    if (i + k > X.toks.length) continue;
    for (let j = 1; j < k; j++) if (!rest[j - 1].has(X.toks[i + j])) continue outer;
    if (cb(i, k) === false) return;
  }
}

/**
 * Match a text against the guard list, honouring the allow-list. Pure; does not check `enabled`.
 * @param {string} text
 * @param {{ words?: string[], allow?: string[] }} g parsed guard (parseGuard)
 * @returns {{ hit: boolean, words: string[] }} the guard patterns that matched (original spelling, ≤10)
 */
function matchGuard(text, g) {
  const none = { hit: false, words: [] };
  const pats = compile(g && g.words); if (!pats.length) return none;
  const toks = tokens(text); if (!toks.length) return none;
  const X = indexText(toks);
  const allowed = new Uint8Array(toks.length);
  for (const c of compile(g && g.allow)) spans(X, c, (i, k) => { allowed.fill(1, i, i + k); });
  const hits = [];
  for (const c of pats) {
    let found = false;
    spans(X, c, (i, k) => { for (let t = i; t < i + k; t++) if (allowed[t]) return true; found = true; return false; }); // a span touching an exception never counts
    if (found) { hits.push(c.src); if (hits.length >= 10) break; }
  }
  return { hit: hits.length > 0, words: hits };
}
/** quick boolean form for the live «فحص» endpoint (same matching as matchGuard) */
const guardHit = (text, g) => matchGuard(text, g).hit;
/** mask a matched pattern for members («غبي» → «غ**», «يا غبي» → «ي* غ**») so the list cannot be read back */
const maskWord = (w) => String(w || "").trim().split(/\s+/).map(p => { const a = Array.from(p.replace(/\*/g, "")); return a.length ? a[0] + "*".repeat(Math.max(1, Math.min(a.length - 1, 6))) : ""; }).filter(Boolean).join(" ");

/**
 * What strike number `n` (1-based, already counted inside the decay window) means under this guard.
 * @returns {{ n: number, max: number, hours: number, locked: boolean, message: string }}
 */
function guardStep(n, g) {
  const G = g && typeof g === "object" ? g : GUARD_DEF;
  const max = clampN(G.maxStrikes, 1, 10, 3), hours = clampN(G.muteHours, 0, 720, 1), k = Math.max(1, Math.round(Number(n) || 1));
  const last = k >= max, locked = last && G.fullLock !== false;
  const dur = (h) => (h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h < 24 ? h + " ساعات" : h % 24 ? h + " ساعة" : (h / 24 === 1 ? "يوم" : h / 24 + " أيام"));
  const tail = locked ? "أنت موقوف عن الكتابة في هذا المجتمع حتى يراجع مشرف وضعك." : hours ? `لا يمكنك الكتابة لمدة ${dur(hours)}.` : "";
  const message = `لم يُنشر نصك لأنه يحتوي عبارة ممنوعة في هذا المجتمع. تحذير ${Math.min(k, max)} من ${max}` + (tail ? ` · ${tail}` : ".");
  return { n: Math.min(k, max), max, hours: locked ? 0 : hours, locked, message };
}

/* presets: suggestions applied in the panel form (nothing is saved until the owner presses «حفظ») */
const PRESETS = {
  light: { t: "خفيف", sub: "كلمات ذكية وروابط الدعوة فقط، كلها للمراجعة", v2: { words: { enabled: true, action: "queue" }, invites: { enabled: true, action: "queue" } } },
  balanced: { t: "متوازن", sub: "يضيف التكرار والإشارات الكثيرة والمصنّف للحالات الواضحة", v2: { words: { enabled: true, action: "queue" }, invites: { enabled: true, action: "queue" }, duplicate: { enabled: true, action: "queue", windowMin: 60 }, mentions: { enabled: true, action: "queue", max: 8 }, classify: { enabled: true, action: "queue", threshold: 0.8 } } },
  strict: { t: "صارم", sub: "مراجعة أول منشورات الأعضاء الجدد، والإغراق، والمصنّف بحساسية أعلى، والتعليقات", v2: { words: { enabled: true, action: "queue" }, invites: { enabled: true, action: "reject" }, duplicate: { enabled: true, action: "reject", windowMin: 120 }, mentions: { enabled: true, action: "queue", max: 5 }, flood: { enabled: true, action: "queue" }, newMember: { enabled: true, action: "queue", firstPosts: 3 }, classify: { enabled: true, action: "queue", threshold: 0.65 }, comments: { enabled: true } } }
};

module.exports = { GUARD_DEF, GUARD_PRESET, LIFT_MIN, parseGuard, guardApplies, matchGuard, guardHit, maskWord, guardStep, RULES, ACTIONS, ACTION_AR, CATS, LADDER_DEF, PRESETS, INVITE_HOSTS, parseV2, parseLadder, anyOn, evaluate, matchWords, glob, tokens, links, fingerprint, normWord };
