/* Malicious-link detection (Phase 31). Pure and local; no network calls.
 * extract(): URLs from plain text (with or without scheme: «bit.ly/x», «www.x.com»), Markdown links
 * [text](url), and rich-text runs [text, marks, href] (richtext.js documents).
 * analyze(): per-link risk 0–1 with Arabic reasons:
 *   • known-bad domains (built-in seed + the admin list in automod_domains) and allow-listed safe domains
 *   • URL shorteners (destination hidden), raw IP hosts, userinfo tricks (https://minepi.com@evil.tld)
 *   • punycode (xn--) and mixed-script hostnames (Latin+Cyrillic/Greek/Arabic), confusable characters
 *   • look-alikes of well-known brands (minepi.com, paypal, banks, stc pay…) by skeleton + edit distance
 *   • risky TLDs, many sub-domains, login/wallet/verify bait words on a non-brand host, non-https forms
 *   • javascript:/data: schemes, and *mismatched display text* (a link that shows one domain but goes to another)
 * An optional external reputation lookup can be plugged in by the service (env-gated); this file never calls out. */
const SHORTENERS = new Set([
  "bit.ly",
  "bitly.com",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "rb.gy",
  "t.ly",
  "tiny.cc",
  "v.gd",
  "s.id",
  "lnkd.in",
  "bl.ink",
  "shorte.st",
  "adf.ly",
  "ouo.io",
  "linktr.ee",
  "qrco.de",
  "x.co",
  "u.to",
  "clck.ru",
  "tny.im"
]);
const RISKY_TLDS = new Set([
  "zip",
  "mov",
  "tk",
  "ml",
  "ga",
  "cf",
  "gq",
  "xyz",
  "top",
  "click",
  "country",
  "kim",
  "work",
  "loan",
  "racing",
  "download",
  "rest",
  "fit",
  "cam",
  "buzz",
  "monster",
  "cyou",
  "icu",
  "sbs",
  "quest"
]);
/** brands people get phished with in this community: name → official domains */
const BRANDS = {
  minepi: ["minepi.com", "pi.app", "pinet.com"],
  paypal: ["paypal.com"],
  google: ["google.com", "gmail.com", "youtube.com"],
  apple: ["apple.com", "icloud.com"],
  microsoft: ["microsoft.com", "live.com", "outlook.com"],
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  whatsapp: ["whatsapp.com", "wa.me"],
  telegram: ["telegram.org", "t.me"],
  binance: ["binance.com"],
  coinbase: ["coinbase.com"],
  stcpay: ["stcpay.com.sa"],
  alrajhibank: ["alrajhibank.com.sa"],
  alinma: ["alinma.com"],
  snb: ["alahli.com", "snb.com"],
  absher: ["absher.sa"],
  amazon: ["amazon.com", "amazon.sa", "amazon.ae"],
  netflix: ["netflix.com"],
  tiktok: ["tiktok.com"],
  x: ["x.com", "twitter.com"]
};
const OFFICIAL = new Set(Object.values(BRANDS).flat());
/** seed of domains that are always treated as malicious (extend through the admin list) */
const SEED_BAD = new Set(["minepi-wallet.com", "pi-wallet-verify.com", "pinetwork-kyc.com", "mainnet-pi.com", "pi-airdrop.net"]);
const BAIT =
  /(login|signin|sign-in|verify|verification|wallet|secure|account|update|kyc|unlock|airdrop|claim|bonus|reward|gift|free|passphrase|seed|mainnet|support|confirm)/;
const CONFUSABLE = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ɡ: "g",
  ո: "n",
  ν: "v",
  ο: "o",
  ρ: "p",
  α: "a",
  ι: "i",
  κ: "k",
  τ: "t",
  ⅼ: "l",
  ı: "i",
  ӏ: "l"
};

/* ---------- helpers ---------- */
/** RFC 3492 punycode decoder (for xn-- labels), so the reason can show what the host really spells */
function punyDecode(input) {
  const base = 36,
    tMin = 1,
    tMax = 26,
    skew = 38,
    damp = 700;
  let n = 128,
    i = 0,
    bias = 72;
  const out = [];
  const b = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(0, b); j++) out.push(input.charCodeAt(j));
  const adapt = (delta, num, first) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / num);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let idx = b > 0 ? b + 1 : 0; idx < input.length;) {
    const oldi = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (idx >= input.length) return null;
      const c = input.charCodeAt(idx++),
        d = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (d >= base) return null;
      i += d * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}
const unicodeHost = h =>
  h
    .split(".")
    .map(l => (l.startsWith("xn--") ? punyDecode(l.slice(4)) || l : l))
    .join(".");
/** registrable domain, good enough without the full public-suffix list (handles com.sa, co.uk…) */
function registrable(host) {
  const p = host.split(".");
  if (p.length <= 2) return host;
  const sld = p[p.length - 2];
  return (["com", "net", "org", "gov", "edu", "co", "ac", "sch", "med"].includes(sld) && p[p.length - 1].length === 2 ? p.slice(-3) : p.slice(-2)).join(".");
}
function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** visual skeleton of a label: confusables folded, rn→m, digits as letters, separators removed */
const skel = s =>
  [...s.toLowerCase()]
    .map(c => CONFUSABLE[c] || c)
    .join("")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/[1l|]/g, "i")
    .replace(/3/g, "e")
    .replace(/5/g, "s")
    .replace(/[-_.]/g, "");
const scriptsOf = s => {
  const set = new Set();
  for (const c of s) {
    if (/[a-z]/i.test(c)) set.add("latin");
    else if (/[\u0400-\u04FF]/.test(c)) set.add("cyrillic");
    else if (/[\u0370-\u03FF]/.test(c)) set.add("greek");
    else if (/[\u0600-\u06FF]/.test(c)) set.add("arabic");
    else if (c.charCodeAt(0) > 127 && /\p{L}/u.test(c)) set.add("other");
  }
  return set;
};

/* ---------- extraction ---------- */
const URL_RE =
  /\b((?:https?:\/\/|www\.)[^\s<>"'()]+|(?:[a-z0-9-]+\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]+)\/[^\s<>"'()]*)|\b((?:[a-z0-9-]+\.)+(?:com|net|org|io|ly|me|co|app|xyz|top|tk|ml|ga|cf|gq|sa|ae|info|link|click|site|online|shop|store|zip|mov)\b)/gi;
/**
 * @param {string} text
 * @param {any} [doc] richtext document (runs carry [text, marks, href])
 * @returns {{ url: string, display: string|null }[]}
 */
function extract(text, doc) {
  /** @type {{ url: string, display: string|null }[]} */ const out = [];
  const t = String(text || "");
  for (const m of t.matchAll(/\[([^\]]{1,300})\]\(([^)\s]{1,2000})\)/g)) out.push({ url: m[2], display: m[1] });
  const stripped = t.replace(/\[([^\]]{1,300})\]\(([^)\s]{1,2000})\)/g, " ");
  for (const m of stripped.matchAll(URL_RE)) out.push({ url: (m[1] || m[2]).replace(/[.,،؛!?؟]+$/, ""), display: null });
  for (const m of stripped.matchAll(/\b(javascript|data|vbscript):[^\s]{3,}/gi)) out.push({ url: m[0], display: null });
  const walk = (n, depth = 0) => {
    if (!n || depth > 12) return;
    if (Array.isArray(n)) {
      if (n.length >= 3 && typeof n[0] === "string" && typeof n[2] === "string" && /^(https?:|javascript:|data:|www\.)/i.test(n[2]))
        out.push({ url: n[2], display: n[0] });
      else for (const x of n) walk(x, depth + 1);
    } else if (typeof n === "object") for (const v of Object.values(n)) walk(v, depth + 1);
  };
  if (doc) walk(doc);
  const seen = new Set();
  return out
    .filter(l => {
      const k = l.url + "|" + (l.display || "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 50);
}

/** @param {string} raw */
function parse(raw) {
  let s = String(raw || "").trim();
  if (/^(javascript|data|vbscript):/i.test(s)) return { scheme: s.split(":")[0].toLowerCase(), host: "", path: "", userinfo: false, raw: s };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return {
      scheme: u.protocol.replace(":", ""),
      host: u.hostname.toLowerCase().replace(/\.$/, ""),
      path: u.pathname + u.search,
      userinfo: !!(u.username || u.password),
      raw: String(raw),
      port: u.port
    };
  } catch {
    return null;
  }
}
/** display text that names a domain, e.g. «minepi.com» or «https://minepi.com/wallet» */
const displayHost = d => {
  const m = String(d || "").match(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,24})/i);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : null;
};

/**
 * @param {{ url: string, display?: string|null }} link
 * @param {{ bad?: Set<string>|string[], allow?: Set<string>|string[] }} [lists]
 * @returns {{ url: string, host: string, domain: string, risk: number, verdict: "ok"|"suspicious"|"malicious", reasons: string[], codes: string[] }}
 */
function analyze(link, lists = {}) {
  const bad = new Set([...SEED_BAD, ...(lists.bad || [])]),
    allow = new Set([...(lists.allow || [])]);
  const p = parse(link.url);
  /** @type {string[]} */ const reasons = [],
    codes = [];
  let risk = 0;
  const flag = (code, why, w) => {
    codes.push(code);
    reasons.push(why);
    risk += w * (1 - risk);
  };
  if (!p) return { url: link.url, host: "", domain: "", risk: 0.3, verdict: "suspicious", reasons: ["رابط غير صالح"], codes: ["invalid"] };
  if (["javascript", "data", "vbscript"].includes(p.scheme)) {
    flag("script", "رابط ينفّذ شيفرة بدل فتح صفحة", 0.95);
    return { url: link.url, host: "", domain: "", risk: 0.95, verdict: "malicious", reasons, codes };
  }
  const host = p.host,
    uhost = unicodeHost(host),
    domain = registrable(host);
  if (allow.has(domain) || allow.has(host)) return { url: link.url, host, domain, risk: 0, verdict: "ok", reasons: [], codes: [] };
  if (bad.has(domain) || bad.has(host)) flag("known_bad", "النطاق مدرج في قائمة الروابط الضارة", 0.95);
  if (SHORTENERS.has(domain) || SHORTENERS.has(host)) flag("shortener", "رابط مختصر يخفي وجهته الحقيقية", 0.35);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) flag("ip_host", "الرابط يشير إلى عنوان IP مباشرة", 0.45);
  if (p.userinfo) flag("userinfo", "الرابط يخفي وجهته خلف علامة @", 0.7);
  if (host.split(".").some(l => l.startsWith("xn--"))) flag("punycode", `نطاق مُرمّز (يظهر كـ «${uhost}»)`, 0.4);
  const scripts = scriptsOf(uhost.replace(/[.\-0-9]/g, ""));
  if (scripts.size > 1) flag("mixed_script", "اسم النطاق يخلط حروفاً من لغات مختلفة (تمويه)", 0.6);
  // look-alike of a brand (skeleton distance), unless it is the official domain
  if (!OFFICIAL.has(domain)) {
    const label = skel(unicodeHost(domain).split(".")[0]),
      full = skel(unicodeHost(host));
    for (const [brand, official] of Object.entries(BRANDS)) {
      if (brand.length < 4) continue;
      const near = label === brand || (label.length >= 4 && lev(label, brand) <= (brand.length >= 7 ? 2 : 1));
      const contains = full.includes(brand) && !official.some(o => host === o || host.endsWith("." + o));
      if (near) {
        flag("lookalike", `يشبه نطاق «${official[0]}» لكنه ليس هو`, 0.75);
        break;
      }
      if (contains && BAIT.test(host + p.path)) {
        flag("brand_bait", `يستخدم اسم «${brand}» في نطاق غير رسمي`, 0.6);
        break;
      }
    }
  }
  const tld = host.split(".").pop();
  if (RISKY_TLDS.has(tld)) flag("risky_tld", `امتداد النطاق «.${tld}» يكثر استخدامه في الاحتيال`, 0.25);
  if (host.split(".").length >= 5) flag("deep_subdomain", "نطاقات فرعية كثيرة (أسلوب تمويه شائع)", 0.25);
  if (BAIT.test(host) && !OFFICIAL.has(domain)) flag("bait_words", "النطاق يحتوي كلمات استدراج (تحقق، محفظة، مكافأة…)", 0.3);
  if (p.scheme === "http" && BAIT.test(p.path)) flag("insecure_form", "صفحة تطلب بيانات دون اتصال آمن", 0.2);
  if (p.port && !["80", "443", ""].includes(p.port)) flag("odd_port", "منفذ غير معتاد", 0.15);
  // mismatched display text: shows one domain, goes to another
  const shown = link.display ? displayHost(link.display) : null;
  if (shown && registrable(shown) !== domain && registrable(shown) !== registrable(host.replace(/^www\./, "")))
    flag("mismatch", `النص يعرض «${shown}» بينما الرابط يذهب إلى «${uhost}»`, 0.7);
  risk = Math.min(1, Math.round(risk * 100) / 100);
  return { url: link.url, host, domain, risk, verdict: risk >= 0.7 ? "malicious" : risk >= 0.3 ? "suspicious" : "ok", reasons, codes };
}

/**
 * Scan a text (and optional rich-text document) for links.
 * @param {string} text @param {any} [doc] @param {{ bad?: Iterable<string>, allow?: Iterable<string> }} [lists]
 */
function scan(text, doc, lists = {}) {
  const l = { bad: [...(lists.bad || [])], allow: [...(lists.allow || [])] };
  const links = extract(text, doc).map(x => analyze(x, l));
  const risk = links.reduce((m, x) => Math.max(m, x.risk), 0);
  return { links, risk, verdict: risk >= 0.7 ? "malicious" : risk >= 0.3 ? "suspicious" : "ok", count: links.length };
}

module.exports = {
  extract,
  analyze,
  scan,
  parse,
  registrable,
  unicodeHost,
  punyDecode,
  skel,
  SHORTENERS,
  BRANDS,
  SEED_BAD,
  normalizeDomain: d =>
    registrable(
      String(d || "")
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .split("/")[0]
        .replace(/^www\./, "")
    )
};
