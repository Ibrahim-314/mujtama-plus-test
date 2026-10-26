/* Core platform primitives: event bus, cache, rate limiting/anti-abuse, content classifier,
 * ids, password hashing, HTTP helpers. Each is an interface that can be swapped for
 * Redis/Kafka/etc. without touching services (spec §105–§107, §113, §132–§134). */
const crypto = require("node:crypto");

/* ---- Internal event system (spec §107) ---- */
const EVENTS = [
  "USER_REGISTERED",
  "USER_FOLLOWED",
  "USER_UNFOLLOWED",
  "USER_MENTIONED",
  "POST_CREATED",
  "POST_UPDATED",
  "POST_DELETED",
  "POST_LIKED",
  "POST_REACTED",
  "POST_PUBLISHED",
  "POST_APPROVED",
  "COMMENT_CREATED",
  "COMMUNITY_CREATED",
  "COMMUNITY_JOINED",
  "COMMUNITY_JOIN_REQUESTED",
  "MEMBER_ROLE_CHANGED",
  "REPORT_CREATED",
  "CONTENT_REMOVED",
  "APPEAL_CREATED",
  "VIDEO_PROCESSED",
  "TREND_DETECTED",
  "MESSAGE_SENT",
  "EVENT_CREATED",
  "EVENT_REMINDER",
  "INVITE_SENT",
  "ABUSE_DETECTED"
];
class EventBus {
  constructor() {
    this.subs = new Map();
    this.log = [];
  }
  on(evt, fn) {
    if (!this.subs.has(evt)) this.subs.set(evt, []);
    this.subs.get(evt).push(fn);
    return this;
  }
  emit(evt, payload) {
    this.log.push({ evt, at: Date.now() });
    if (this.log.length > 500) this.log.shift();
    const handlers = [...(this.subs.get(evt) || []), ...(this.subs.get("*") || [])];
    // async, isolated delivery: one failing consumer never breaks the producer
    for (const h of handlers)
      setImmediate(() =>
        Promise.resolve()
          .then(() => h(payload, evt))
          .catch(e => console.error(`[bus] ${evt} handler failed:`, e.message))
      );
  }
}

/* ---- Cache (spec §113): TTL map; swap for Redis in production ---- */
class Cache {
  constructor() {
    this.m = new Map();
  }
  get(k) {
    const e = this.m.get(k);
    if (!e) return;
    if (e.exp < Date.now()) {
      this.m.delete(k);
      return;
    }
    return e.v;
  }
  set(k, v, ttlMs = 30e3) {
    this.m.set(k, { v, exp: Date.now() + ttlMs });
    if (this.m.size > 5000) this.m.delete(this.m.keys().next().value);
    return v;
  }
  del(prefix) {
    for (const k of this.m.keys()) if (k.startsWith(prefix)) this.m.delete(k);
  }
  // single-flight: concurrent misses for the same key share one computation (no cache stampede)
  async wrap(k, ttl, fn) {
    const v = this.get(k);
    if (v !== undefined) return v;
    if (!this.inflight) this.inflight = new Map();
    if (this.inflight.has(k)) return this.inflight.get(k);
    const p = Promise.resolve()
      .then(fn)
      .then(val => this.set(k, val, ttl))
      .finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }
}

/* ---- Rate limiting + mass-action detection (spec §132, §133) ---- */
const LIMITS = {
  register: [5, 3600e3],
  login: [10, 600e3],
  post: [8, 60e3],
  comment: [15, 60e3],
  follow: [30, 60e3],
  unfollow: [30, 60e3],
  react: [60, 60e3],
  invite: [15, 60e3],
  report: [6, 60e3],
  message: [30, 60e3],
  upload: [20, 600e3],
  community: [3, 3600e3],
  qoe: [12, 60e3], // v2.70: video QoE beacons (≤20 playbacks each) per member
  guardcheck: [20, 60e3], // v2.62 T6: live «الحارس التلقائي» pre-check in the composer (per member)
  ai_hub: [20, 60e3], // v2.77: «مركز الذكاء» chat requests per member per minute
  ai_hub_link: [10, 600e3], // v2.77: link attempts (key checks / one-tap starts) per member per 10 min
  clip_draft: [30, 60e3], // v2.80: Vidtik draft saves per member per minute
  game_mission: [30, 60e3], // Phase 2D-A: game mission completions per member per minute
  default: [120, 60e3]
};
class RateLimiter {
  constructor(bus) {
    this.w = new Map();
    this.bus = bus;
  }
  hit(action, key) {
    const [max, ms] = LIMITS[action] || LIMITS.default,
      k = action + ":" + key,
      t = Date.now();
    const arr = (this.w.get(k) || []).filter(x => t - x < ms);
    if (arr.length >= max) {
      this.w.set(k, arr);
      if (arr.length === max) this.bus?.emit("ABUSE_DETECTED", { action, key });
      return false;
    }
    arr.push(t);
    this.w.set(k, arr);
    return true;
  }
}

/* ---- Content classification (sensitive, spam, language, hashtags, mentions, topics) ---- */
const TOPICS = [
  { slug: "ai", name: "الذكاء الاصطناعي" },
  { slug: "dev", name: "البرمجة" },
  { slug: "startups", name: "الشركات الناشئة" },
  { slug: "invest", name: "الاستثمار" },
  { slug: "pi", name: "Pi Network" },
  { slug: "design", name: "التصميم" },
  { slug: "games", name: "الألعاب" },
  { slug: "learn", name: "التعلم" }
];
const TOPIC_ALIASES = {
  ذكاء_اصطناعي: "ai",
  ذكاء_الاصطناعي: "ai",
  ai: "ai",
  برمجة: "dev",
  تطوير: "dev",
  dev: "dev",
  شركات_ناشئة: "startups",
  startups: "startups",
  ريادة: "startups",
  استثمار: "invest",
  invest: "invest",
  pinetwork: "pi",
  pi: "pi",
  باي: "pi",
  تصميم: "design",
  design: "design",
  ألعاب: "games",
  العاب: "games",
  تعلم: "learn"
};
const CANON = { ai: "ذكاء_اصطناعي", dev: "برمجة", startups: "شركات_ناشئة", invest: "استثمار", pi: "pinetwork", design: "تصميم", games: "ألعاب", learn: "تعلم" };
const SENSITIVE = ["عنف", "دم", "مقامرة", "violence", "gore", "nsfw"];
const SPAM = [/اربح\s*\d+/, /ضاعف\s*أموالك/, /(https?:\/\/\S+[\s\S]*){3,}/, /free\s*money/i, /(.)\1{15,}/];
const normalizeTag = h => h.replace("#", "").replace(/^ال/, "").toLowerCase();
const canonTag = t => (TOPIC_ALIASES[t] ? CANON[TOPIC_ALIASES[t]] : t);
const Classifier = {
  hashtags: (text = "") => [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map(h => canonTag(normalizeTag(h))))].slice(0, 20),
  mentions: (text = "") => [...new Set((text.match(/@([a-zA-Z0-9_]{2,30})/g) || []).map(m => m.slice(1)))].slice(0, 20),
  topic(text = "") {
    for (const h of text.match(/#[\p{L}\p{N}_]+/gu) || []) {
      const t = TOPIC_ALIASES[normalizeTag(h)];
      if (t) return t;
    }
    return null;
  },
  lang: (text = "") => (/[\u0600-\u06FF]/.test(text) ? "ar" : "en"),
  sensitive: (text = "") => SENSITIVE.some(w => text.toLowerCase().includes(w)),
  spam: (text = "") => SPAM.some(r => r.test(text)),
  commercial: (text = "") => /إعلان|خصم|اشترِ|اشتر الآن|sale|discount/i.test(text)
};

/* ---- ids, passwords, tokens ---- */
const id = p => p + "_" + crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toLowerCase() + Date.now().toString(36).slice(-3);
const CLIENT_ID = /^[a-z]{1,3}_[a-z0-9]{6,24}$/i;
const acceptId = (candidate, prefix) => (typeof candidate === "string" && CLIENT_ID.test(candidate) ? candidate : id(prefix));
const hashPassword = pw => {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + h.toString("hex");
};
const verifyPassword = (pw, stored) => {
  if (!stored) return false;
  const [, s, h] = stored.split("$");
  const c = crypto.scryptSync(pw, Buffer.from(s, "hex"), 64);
  return crypto.timingSafeEqual(c, Buffer.from(h, "hex"));
};
const token = () => crypto.randomBytes(32).toString("base64url");
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();

/* ---- HTTP helpers ---- */
class HttpError extends Error {
  constructor(status, msg, code) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}
const E = {
  bad: (m = "طلب غير صالح") => new HttpError(400, m, "bad_request"),
  auth: () => new HttpError(401, "يلزم تسجيل الدخول", "unauthorized"),
  forbid: (m = "لا تملك الصلاحية") => new HttpError(403, m, "forbidden"),
  nf: (m = "غير موجود") => new HttpError(404, m, "not_found"),
  conflict: m => new HttpError(409, m, "conflict"),
  rate: () => new HttpError(429, "تمهّل قليلاً، محاولات كثيرة", "rate_limited"),
  off: m => new HttpError(501, m, "not_configured")
};
const str = (v, max, { required = false, min = 0 } = {}) => {
  if (v === undefined || v === null || v === "") {
    if (required) throw E.bad("حقل مطلوب ناقص");
    return null;
  }
  if (typeof v !== "string") throw E.bad();
  v = v.trim();
  if (v.length < min || v.length > max) throw E.bad("طول النص غير مقبول");
  return v;
};
const oneOf = (v, list, def) => (list.includes(v) ? v : def);

module.exports = {
  EVENTS,
  EventBus,
  Cache,
  RateLimiter,
  LIMITS,
  Classifier,
  TOPICS,
  normalizeTag,
  canonTag,
  id,
  acceptId,
  hashPassword,
  verifyPassword,
  token,
  sha,
  now,
  HttpError,
  E,
  str,
  oneOf
};
